import asyncio
from datetime import datetime, timezone
import io
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch
import zipfile

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import archive_worker as worker
from shared.drive_source import DriveError


class ArchiveTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)

        async def download(file_id, path, limit):
            content = f"bytes:{file_id}".encode()
            if len(content) > limit:
                raise DriveError("drive_payload_too_large")
            path.write_bytes(content)
            return len(content)

        self.drive = SimpleNamespace(download_to_path=AsyncMock(side_effect=download))
        for target, value in {
            "WORKER_TOKEN": "archive-token",
            "CALLBACK_ORIGIN": "https://api.test",
            "CALLBACK_TOKEN": "callback",
            "ARCHIVE_ROOT": Path(self.directory.name),
            "archive_jobs": {},
            "archive_tasks": {},
            "archive_tickets": {},
            "gallery_snapshots": {},
            "archive_semaphore": asyncio.Semaphore(1),
            "drive_source": self.drive,
        }.items():
            self.enterContext(patch.object(worker, target, value))
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=worker.app), base_url="http://test", headers={"Authorization": "Bearer archive-token"})
        self.payload = {
            "galleryId": 17,
            "folderId": "folder-id",
            "folderName": "Details",
            "photos": [
                {"driveFileId": "photo-a", "filename": "a.jpg", "archivePath": "Details/a.jpg"},
                {"driveFileId": "photo-b", "filename": "b.jpg", "archivePath": "Details/Nested/b.jpg"},
            ],
        }

    async def asyncTearDown(self):
        for task in worker.archive_tasks.values():
            task.cancel()
        await asyncio.gather(*worker.archive_tasks.values(), return_exceptions=True)
        await self.client.aclose()

    async def complete_job(self):
        response = await self.client.post("/v1/archive/jobs", json=self.payload)
        self.assertEqual(response.status_code, 202)
        job_id = response.json()["jobId"]
        await worker.archive_tasks[job_id]
        return job_id

    async def test_builds_nested_zip_with_ticket_auth_and_no_recompression(self):
        job_id = await self.complete_job()
        status = (await self.client.get(f"/v1/archive/jobs/{job_id}")).json()
        self.assertEqual(status["status"], "completed")
        self.assertEqual(status["processed"], 2)
        ticket = status["downloadTicket"]
        self.assertEqual((await self.client.get(f"/v1/archive/download/{job_id}?ticket=wrong")).status_code, 404)
        refreshed = (await self.client.get(f"/v1/archive/jobs/{job_id}")).json()["downloadTicket"]
        self.assertNotEqual(ticket, refreshed)
        self.assertEqual((await self.client.get(f"/v1/archive/download/{job_id}?ticket={ticket}")).status_code, 200)
        download = await self.client.get(f"/v1/archive/download/{job_id}?ticket={refreshed}")
        self.assertEqual(download.status_code, 200)
        self.assertEqual(download.headers["cache-control"], "private, no-store")
        with zipfile.ZipFile(io.BytesIO(download.content)) as archive:
            self.assertEqual(archive.namelist(), ["Details/a.jpg", "Details/Nested/b.jpg"])
            self.assertEqual(archive.read("Details/a.jpg"), b"bytes:photo-a")
            self.assertTrue(all(entry.compress_type == zipfile.ZIP_STORED for entry in archive.infolist()))
        self.assertEqual(self.drive.download_to_path.await_count, 2)

    async def test_gallery_archive_keeps_root_photos_and_folder_paths(self):
        self.payload.update({
            "folderId": "__all__",
            "folderName": "Edited Photos",
            "photos": [
                {"driveFileId": "root-photo", "filename": "root.jpg", "archivePath": "root.jpg"},
                {"driveFileId": "nested-photo", "filename": "nested.jpg", "archivePath": "Details/Day 1/nested.jpg"},
            ],
        })
        job_id = await self.complete_job()
        status = (await self.client.get(f"/v1/archive/jobs/{job_id}")).json()
        self.assertEqual(status["folderId"], "__all__")
        download = await self.client.get(f"/v1/archive/download/{job_id}?ticket={status['downloadTicket']}")
        with zipfile.ZipFile(io.BytesIO(download.content)) as archive:
            self.assertEqual(archive.namelist(), ["root.jpg", "Details/Day 1/nested.jpg"])

    async def test_root_direct_archive_does_not_reuse_whole_gallery_job(self):
        self.payload.update({
            "folderId": "__all__",
            "folderName": "Edited Photos",
            "photos": [
                {"driveFileId": "root-photo", "filename": "root.jpg", "archivePath": "root.jpg"},
                {"driveFileId": "nested-photo", "filename": "nested.jpg", "archivePath": "Details/nested.jpg"},
            ],
        })
        subtree_id = await self.complete_job()
        self.payload["scope"] = "direct"
        self.payload["photos"] = [{"driveFileId": "root-photo", "filename": "root.jpg", "archivePath": "root.jpg"}]
        response = await self.client.post("/v1/archive/jobs", json=self.payload)
        direct_id = response.json()["jobId"]
        self.assertNotEqual(direct_id, subtree_id)
        await worker.archive_tasks[direct_id]
        status = (await self.client.get(f"/v1/archive/jobs/{direct_id}")).json()
        self.assertEqual(status["filename"], "Edited Photos.zip")
        download = await self.client.get(f"/v1/archive/download/{direct_id}?ticket={status['downloadTicket']}")
        with zipfile.ZipFile(io.BytesIO(download.content)) as archive:
            self.assertEqual(archive.namelist(), ["root.jpg"])

    async def test_prebuild_survives_restart_and_deduplicates_client_request(self):
        self.payload["scope"] = "direct"
        self.payload["snapshotVersion"] = "published:v1"
        self.payload["photos"] = [{"driveFileId": "photo-a", "filename": "a.jpg", "archivePath": "a.jpg", "sizeBytes": 6}]
        response = await self.client.post("/v1/archive/prebuild", json={"jobs": [self.payload]})
        self.assertEqual(response.status_code, 202)
        job_id = response.json()["jobs"][0]["jobId"]
        await worker.archive_tasks[job_id]
        self.assertTrue(worker.archive_jobs[job_id]["prebuilt"])
        self.assertGreater(worker.archive_jobs[job_id]["expiresAt"], time.time() + worker.ARCHIVE_TTL_SECONDS)
        prebuild_status = await self.client.get("/v1/archive/prebuild/galleries/17", params={"snapshotVersion": "published:v1"})
        self.assertEqual(prebuild_status.json()["jobs"][0]["status"], "completed")
        worker.archive_jobs.clear()
        worker.archive_tasks.clear()
        worker.archive_tickets.clear()
        async with worker.lifespan(worker.app):
            status = (await self.client.get(f"/v1/archive/jobs/{job_id}")).json()
            self.assertEqual(status["status"], "completed")
            self.assertEqual((await self.client.get(f"/v1/archive/download/{job_id}?ticket={status['downloadTicket']}")).status_code, 200)
            duplicate = await self.client.post("/v1/archive/jobs", json=self.payload)
            self.assertEqual(duplicate.json()["jobId"], job_id)
            self.assertTrue(duplicate.json()["duplicate"])
            self.payload["snapshotVersion"] = "published:v2"
            changed = await self.client.post("/v1/archive/jobs", json=self.payload)
            self.assertNotEqual(changed.json()["jobId"], job_id)

    async def test_queued_prebuild_resumes_after_restart(self):
        self.payload["photos"] = [{**photo, "sizeBytes": 10} for photo in self.payload["photos"]]
        gate = asyncio.Event()
        original = self.drive.download_to_path.side_effect

        async def delayed_download(*args):
            await gate.wait()
            return await original(*args)

        self.drive.download_to_path.side_effect = delayed_download
        response = await self.client.post("/v1/archive/prebuild", json={"jobs": [self.payload]})
        job_id = response.json()["jobs"][0]["jobId"]
        await asyncio.sleep(0)
        worker.archive_tasks[job_id].cancel()
        await asyncio.gather(worker.archive_tasks[job_id], return_exceptions=True)
        worker.archive_jobs.clear()
        worker.archive_tasks.clear()
        gate.set()
        with patch.object(worker, "DriveSource", return_value=self.drive):
            async with worker.lifespan(worker.app):
                await worker.archive_tasks[job_id]
                self.assertEqual(worker.archive_jobs[job_id]["status"], "completed")

    async def test_cache_limit_evicts_old_completed_zip(self):
        self.payload["photos"] = [{"driveFileId": "photo-a", "filename": "a.jpg", "archivePath": "a.jpg"}]
        with patch.object(worker, "ARCHIVE_CACHE_MAX_BYTES", 180):
            first = await self.complete_job()
            self.payload["folderId"] = "another-folder"
            second = await self.complete_job()
        self.assertNotIn(first, worker.archive_jobs)
        self.assertIn(second, worker.archive_jobs)
        self.assertFalse((worker.ARCHIVE_ROOT / first).exists())

    async def test_direct_folder_is_flat_and_does_not_reuse_subtree_job(self):
        subtree_id = await self.complete_job()
        self.payload["scope"] = "direct"
        self.payload["photos"] = [
            {"driveFileId": "photo-a", "filename": "a.jpg", "archivePath": "a.jpg"},
            {"driveFileId": "photo-b", "filename": "a.jpg", "archivePath": "Nested/a.jpg"},
        ]
        response = await self.client.post("/v1/archive/jobs", json=self.payload)
        self.assertEqual(response.status_code, 202)
        direct_id = response.json()["jobId"]
        self.assertNotEqual(direct_id, subtree_id)
        duplicate = await self.client.post("/v1/archive/jobs", json=self.payload)
        self.assertEqual(duplicate.json()["jobId"], direct_id)
        self.assertTrue(duplicate.json()["duplicate"])
        await worker.archive_tasks[direct_id]
        self.assertEqual(worker.archive_jobs[direct_id]["scope"], "direct")
        status = (await self.client.get(f"/v1/archive/jobs/{direct_id}")).json()
        self.assertEqual(status["filename"], "Details.zip")
        download = await self.client.get(f"/v1/archive/download/{direct_id}?ticket={status['downloadTicket']}")
        with zipfile.ZipFile(io.BytesIO(download.content)) as archive:
            self.assertEqual(archive.namelist(), ["a.jpg", "a (2).jpg"])
            self.assertEqual(archive.read("a (2).jpg"), b"bytes:photo-b")

    async def test_archive_token_is_required_and_selfie_routes_are_absent(self):
        for path in ("/readyz", "/v1/archive/jobs/missing"):
            self.assertEqual((await self.client.get(path, headers={"Authorization": "Bearer selfie-token"})).status_code, 401)
        self.assertEqual((await self.client.post("/v1/archive/jobs", json=self.payload, headers={"Authorization": ""})).status_code, 401)
        self.assertEqual((await self.client.post("/v1/search")).status_code, 404)
        self.assertEqual((await self.client.post("/v1/index/jobs", json={})).status_code, 404)

    async def test_untrusted_paths_and_photo_limit_are_rejected(self):
        self.payload["photos"][0]["archivePath"] = "../outside.jpg"
        self.assertEqual((await self.client.post("/v1/archive/jobs", json=self.payload)).status_code, 400)
        self.payload["photos"][0]["archivePath"] = "Details/a.jpg"
        with patch.object(worker, "ARCHIVE_MAX_PHOTOS", 1):
            self.assertEqual((await self.client.post("/v1/archive/jobs", json=self.payload)).status_code, 413)
        self.assertFalse(worker.archive_jobs)

    async def test_progress_deduplication_and_queue_limits(self):
        gate = asyncio.Event()
        original = self.drive.download_to_path.side_effect

        async def slow_download(*args):
            await gate.wait()
            return await original(*args)

        self.drive.download_to_path.side_effect = slow_download
        with patch.object(worker, "ARCHIVE_MAX_ACTIVE", 1):
            response = await self.client.post("/v1/archive/jobs", json=self.payload)
            job_id = response.json()["jobId"]
            await asyncio.sleep(0)
            progress = (await self.client.get(f"/v1/archive/jobs/{job_id}")).json()
            self.assertEqual(progress["status"], "running")
            self.assertEqual(progress["processed"], 0)
            duplicate = await self.client.post("/v1/archive/jobs", json=self.payload)
            self.assertEqual(duplicate.json()["jobId"], job_id)
            self.assertTrue(duplicate.json()["duplicate"])
            self.payload["folderId"] = "other-folder"
            self.assertEqual((await self.client.post("/v1/archive/jobs", json=self.payload)).status_code, 429)
            gate.set()
            await worker.archive_tasks[job_id]

    async def test_failed_download_is_cleaned_and_can_retry(self):
        with patch.object(worker, "ARCHIVE_MAX_BYTES", 1):
            failed_id = await self.complete_job()
        self.assertEqual(worker.archive_jobs[failed_id]["status"], "failed")
        self.assertEqual(worker.archive_jobs[failed_id]["errorCode"], "drive_payload_too_large")
        self.assertFalse((worker.ARCHIVE_ROOT / failed_id).exists())
        retry_id = await self.complete_job()
        self.assertNotEqual(failed_id, retry_id)
        self.assertEqual(worker.archive_jobs[retry_id]["status"], "completed")

    async def test_ticket_is_capped_by_edited_expiry_and_archives_expire(self):
        expiry = datetime.fromtimestamp(time.time() + 120, timezone.utc)
        deadline = expiry.timestamp()
        self.payload["accessExpiresAt"] = expiry.isoformat()
        job_id = await self.complete_job()
        status = (await self.client.get(f"/v1/archive/jobs/{job_id}")).json()
        self.assertLessEqual(status["downloadTicketExpiresAt"], deadline)
        worker.archive_jobs[job_id]["accessExpiresAt"] = "2000-01-01T00:00:00Z"
        self.assertEqual((await self.client.get(f"/v1/archive/jobs/{job_id}")).status_code, 409)
        worker.archive_jobs[job_id]["expiresAt"] = time.time() - 1
        worker.prune_archives()
        self.assertFalse((worker.ARCHIVE_ROOT / job_id).exists())
        self.assertEqual((await self.client.get(f"/v1/archive/jobs/{job_id}")).status_code, 404)

    async def test_archive_ttl_defaults_to_six_hours_and_active_jobs_are_not_pruned(self):
        self.assertEqual(worker.ARCHIVE_TTL_SECONDS, 6 * 60 * 60)
        active_id = "active-job"
        active_dir = worker.ARCHIVE_ROOT / active_id
        active_dir.mkdir()
        worker.archive_jobs[active_id] = {"status": "running", "expiresAt": time.time() - 1}
        worker.prune_archives()
        self.assertTrue(active_dir.exists())
        self.assertIn(active_id, worker.archive_jobs)

    async def test_startup_and_shutdown_own_only_archive_resources(self):
        orphan = worker.ARCHIVE_ROOT / "orphan.zip"
        orphan.write_bytes(b"orphan")
        lost_found = worker.ARCHIVE_ROOT / "lost+found"
        lost_found.mkdir()
        with patch.object(worker, "drive_source", None):
            async with worker.lifespan(worker.app):
                self.assertFalse(orphan.exists())
                self.assertTrue(lost_found.is_dir())
                self.assertEqual((await self.client.get("/readyz")).status_code, 200)
                task = asyncio.create_task(asyncio.Event().wait())
                worker.archive_tasks["pending"] = task
            self.assertTrue(task.cancelled())
            self.assertIsNone(worker.drive_source)
            self.assertFalse(worker.archive_tasks)
            self.assertEqual((await self.client.get("/readyz")).status_code, 503)

    async def test_gallery_snapshot_revokes_existing_download_ticket_and_persists(self):
        self.payload.update({"snapshotVersion": "published:v1", "photos": [{"driveFileId": "photo-a", "filename": "a.jpg", "archivePath": "a.jpg"}]})
        job_id = await self.complete_job()
        status = (await self.client.get(f"/v1/archive/jobs/{job_id}")).json()
        ticket = status["downloadTicket"]
        revoked = await self.client.put("/v1/archive/galleries/17/snapshot", json={"snapshotVersion": None})
        self.assertEqual(revoked.status_code, 200)
        self.assertEqual((await self.client.get(f"/v1/archive/download/{job_id}?ticket={ticket}")).status_code, 404)
        self.assertEqual((await self.client.get(f"/v1/archive/jobs/{job_id}")).status_code, 404)
        self.assertIsNone(worker.gallery_snapshots[17])
        self.assertTrue((worker.ARCHIVE_ROOT / worker.SNAPSHOT_STATE).is_file())
        worker.gallery_snapshots.clear()
        async with worker.lifespan(worker.app):
            self.assertIsNone(worker.gallery_snapshots[17])
            self.assertEqual((await self.client.get(f"/v1/archive/jobs/{job_id}")).status_code, 404)

    async def test_prebuild_capacity_estimate_blocks_unknown_or_over_capacity(self):
        self.payload.update({"snapshotVersion": "published:v1", "photos": [{"driveFileId": "photo-a", "filename": "a.jpg", "archivePath": "a.jpg", "sizeBytes": 500}]})
        with patch.object(worker, "ARCHIVE_CACHE_MAX_BYTES", 100), patch.object(worker, "ARCHIVE_MIN_FREE_BYTES", 0):
            response = await self.client.post("/v1/archive/prebuild", json={"jobs": [self.payload]})
            self.assertEqual(response.status_code, 507)
        self.payload["photos"][0].pop("sizeBytes")
        self.assertEqual((await self.client.post("/v1/archive/prebuild", json={"jobs": [self.payload]})).status_code, 422)

    def test_archive_import_does_not_require_selfie_or_ml_dependencies(self):
        script = """
import builtins
original = builtins.__import__
def isolated_import(name, globals=None, locals=None, fromlist=(), level=0):
    if level == 0 and name.split('.')[0] in {'main', 'engine', 'embedding_cache', 'cv2', 'numpy', 'PIL'}:
        raise AssertionError('Archive attempted to load ' + name)
    return original(name, globals, locals, fromlist, level)
builtins.__import__ = isolated_import
import archive_worker
assert archive_worker.app.title == 'Orbit Archive Worker'
"""
        env = os.environ.copy()
        env["PYTHONPATH"] = os.pathsep.join(filter(None, [str(Path(__file__).resolve().parent.parent), env.get("PYTHONPATH", "")]))
        result = subprocess.run([sys.executable, "-c", script], cwd=Path(__file__).parent, env=env, capture_output=True, text=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)
