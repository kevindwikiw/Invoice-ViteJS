from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime
import hashlib
import json
import logging
import os
from pathlib import Path, PurePosixPath
import re
import secrets
import shutil
import time
from typing import Any, Literal
from uuid import uuid4
import zipfile

import httpx
from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from shared.drive_source import DriveSource

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("orbit-archive-worker")
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)

WORKER_TOKEN = os.getenv("FACE_ARCHIVE_WORKER_TOKEN", "").strip()
CALLBACK_ORIGIN = os.getenv("FACE_ARCHIVE_WORKER_CALLBACK_ORIGIN", "").strip().rstrip("/")
CALLBACK_TOKEN = os.getenv("FACE_ARCHIVE_WORKER_CALLBACK_TOKEN", "").strip()
HTTP_TIMEOUT = float(os.getenv("FACE_ARCHIVE_WORKER_HTTP_TIMEOUT_SECONDS", "30"))
ARCHIVE_ROOT = Path(os.getenv("FACE_ARCHIVE_WORKER_DIR", str(Path(__file__).parent / "archives"))).resolve()
ARCHIVE_MAX_BYTES = max(1, int(os.getenv("FACE_ARCHIVE_WORKER_MAX_BYTES", str(20 * 1024 * 1024 * 1024))))
ARCHIVE_MAX_PHOTOS = max(1, int(os.getenv("FACE_ARCHIVE_WORKER_MAX_PHOTOS", "2000")))
ARCHIVE_MAX_ACTIVE = max(1, int(os.getenv("FACE_ARCHIVE_WORKER_MAX_ACTIVE", "4")))
ARCHIVE_CONCURRENCY = max(1, int(os.getenv("FACE_ARCHIVE_WORKER_CONCURRENCY", "1")))
ARCHIVE_TTL_SECONDS = max(60, int(os.getenv("FACE_ARCHIVE_WORKER_TTL_SECONDS", str(6 * 60 * 60))))
ARCHIVE_UNDOWNLOADED_TTL_SECONDS = 7 * 24 * 60 * 60
ARCHIVE_PREBUILD_TTL_SECONDS = max(ARCHIVE_TTL_SECONDS, int(os.getenv("FACE_ARCHIVE_WORKER_PREBUILD_TTL_SECONDS", str(30 * 24 * 60 * 60))))
ARCHIVE_CACHE_MAX_BYTES = max(1, int(os.getenv("FACE_ARCHIVE_WORKER_CACHE_MAX_BYTES", str(80 * 1024 * 1024 * 1024))))
ARCHIVE_MIN_FREE_BYTES = max(0, int(os.getenv("FACE_ARCHIVE_WORKER_MIN_FREE_BYTES", str(5 * 1024 * 1024 * 1024))))
ARCHIVE_MAX_PREBUILD_JOBS = max(1, int(os.getenv("FACE_ARCHIVE_WORKER_MAX_PREBUILD_JOBS", "128")))

archive_semaphore = asyncio.Semaphore(ARCHIVE_CONCURRENCY)
archive_jobs: dict[str, dict[str, Any]] = {}
archive_tasks: dict[str, asyncio.Task[None]] = {}
archive_tickets: dict[str, dict[str, float]] = {}
gallery_snapshots: dict[int, str | None] = {}
drive_source: DriveSource | None = None
SNAPSHOT_STATE = "gallery-snapshots.json"
ZIP_ENTRY_OVERHEAD_BYTES = 64 * 1024


class ArchiveStorageError(RuntimeError):
    code = "archive_storage_full"


def prebuilt_expires_at(access_expires_at: str | None) -> float:
    deadline = time.time() + ARCHIVE_PREBUILD_TTL_SECONDS
    if access_expires_at:
        try:
            deadline = min(deadline, datetime.fromisoformat(access_expires_at.replace("Z", "+00:00")).timestamp())
        except ValueError:
            raise HTTPException(status_code=400, detail="invalid_access_expiry") from None
    return deadline


def archive_key(payload: "ArchiveJobInput") -> str:
    entries = [(photo.driveFileId, photo.archivePath) for photo in payload.photos]
    source = [payload.galleryId, payload.folderId, payload.folderName, payload.scope, payload.snapshotVersion, entries]
    return hashlib.sha256(json.dumps(source, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def save_job(job_id: str, payload: "ArchiveJobInput") -> None:
    job_dir = ARCHIVE_ROOT / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    record = {"job": {key: value for key, value in archive_jobs[job_id].items() if key not in {"downloadTicket", "downloadTicketExpiresAt"}}, "payload": payload.model_dump()}
    temporary = job_dir / "job.json.tmp"
    temporary.write_text(json.dumps(record, separators=(",", ":")), encoding="utf-8")
    temporary.replace(job_dir / "job.json")


def save_job_state(job_id: str) -> None:
    manifest = ARCHIVE_ROOT / job_id / "job.json"
    record = json.loads(manifest.read_text(encoding="utf-8"))
    record["job"] = {key: value for key, value in archive_jobs[job_id].items() if key not in {"downloadTicket", "downloadTicketExpiresAt"}}
    temporary = manifest.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(record, separators=(",", ":")), encoding="utf-8")
    temporary.replace(manifest)


def save_gallery_snapshots() -> None:
    temporary = ARCHIVE_ROOT / f"{SNAPSHOT_STATE}.tmp"
    temporary.write_text(json.dumps({str(key): value for key, value in gallery_snapshots.items()}), encoding="utf-8")
    temporary.replace(ARCHIVE_ROOT / SNAPSHOT_STATE)


def archive_capacity() -> dict[str, int]:
    cached = sum((ARCHIVE_ROOT / job_id / job["filename"]).stat().st_size for job_id, job in archive_jobs.items() if job["status"] == "completed" and (ARCHIVE_ROOT / job_id / job.get("filename", "")).is_file())
    reserved = sum(job.get("estimatedBytes", 0) for job in archive_jobs.values() if job.get("prebuilt") and job["status"] in {"queued", "running"})
    disk_available = max(0, shutil.disk_usage(ARCHIVE_ROOT).free - ARCHIVE_MIN_FREE_BYTES)
    cache_available = max(0, ARCHIVE_CACHE_MAX_BYTES - cached - reserved)
    return {"diskFreeBytes": shutil.disk_usage(ARCHIVE_ROOT).free, "cacheUsedBytes": cached, "reservedBytes": reserved, "availableBytes": min(disk_available, cache_available), "cacheMaxBytes": ARCHIVE_CACHE_MAX_BYTES, "minimumFreeBytes": ARCHIVE_MIN_FREE_BYTES}


def estimate_prebuild_bytes(jobs: list["ArchiveJobInput"]) -> int:
    if any(photo.sizeBytes is None for job in jobs for photo in job.photos):
        raise HTTPException(status_code=422, detail="photo_size_unknown_sync_gallery")
    return sum(int(photo.sizeBytes or 0) + ZIP_ENTRY_OVERHEAD_BYTES for job in jobs for photo in job.photos)


def estimate_new_prebuild_bytes(jobs: list["ArchiveJobInput"]) -> int:
    new_jobs = [job for job in jobs if not any(existing.get("snapshotKey") == archive_key(job) and existing["status"] in {"queued", "running", "completed"} and time.time() < existing["expiresAt"] for existing in archive_jobs.values())]
    return estimate_prebuild_bytes(new_jobs) if new_jobs else 0


def evict_completed(exclude: str, required_free: int = 0) -> None:
    candidates = sorted(((job.get("finishedAt", 0), job_id) for job_id, job in archive_jobs.items() if job_id != exclude and job["status"] == "completed" and not any(deadline > time.time() for deadline in archive_tickets.get(job_id, {}).values())))
    for _, job_id in candidates:
        cached = sum((ARCHIVE_ROOT / key / job["filename"]).stat().st_size for key, job in archive_jobs.items() if job["status"] == "completed" and (ARCHIVE_ROOT / key / job["filename"]).is_file())
        if cached <= ARCHIVE_CACHE_MAX_BYTES and shutil.disk_usage(ARCHIVE_ROOT).free >= ARCHIVE_MIN_FREE_BYTES + required_free:
            break
        archive_jobs.pop(job_id, None)
        archive_tasks.pop(job_id, None)
        archive_tickets.pop(job_id, None)
        shutil.rmtree(ARCHIVE_ROOT / job_id, ignore_errors=True)


def prune_archives() -> None:
    now = time.time()
    for job_id, job in list(archive_jobs.items()):
        if job["status"] in {"queued", "running"} or now < job["expiresAt"]:
            continue
        archive_jobs.pop(job_id, None)
        archive_tasks.pop(job_id, None)
        archive_tickets.pop(job_id, None)
        shutil.rmtree(ARCHIVE_ROOT / job_id, ignore_errors=True)


async def expire_archives() -> None:
    while True:
        await asyncio.sleep(60)
        prune_archives()


@asynccontextmanager
async def lifespan(_: FastAPI):
    global drive_source
    ARCHIVE_ROOT.mkdir(parents=True, exist_ok=True)
    try:
        raw_snapshots = json.loads((ARCHIVE_ROOT / SNAPSHOT_STATE).read_text(encoding="utf-8"))
        gallery_snapshots.update({int(key): value if isinstance(value, str) else None for key, value in raw_snapshots.items()})
    except FileNotFoundError:
        pass
    except (ValueError, TypeError, json.JSONDecodeError):
        logger.exception("Invalid gallery snapshot state; refusing startup")
        raise RuntimeError("invalid_gallery_snapshot_state")
    for child in ARCHIVE_ROOT.iterdir():
        if child.name in {"lost+found", SNAPSHOT_STATE}:
            continue
        if child.is_symlink() or not child.is_dir():
            child.unlink()
            continue
        try:
            if not re.fullmatch(r"[a-f0-9]{32}", child.name):
                raise ValueError("invalid_job_directory")
            record = json.loads((child / "job.json").read_text(encoding="utf-8"))
            payload = ArchiveJobInput.model_validate(record["payload"])
            job = record["job"]
            active_snapshot = gallery_snapshots.get(payload.galleryId, "__unmanaged__")
            if job["galleryId"] != payload.galleryId or job["snapshotKey"] != archive_key(payload) or time.time() >= job["expiresAt"] or active_snapshot != "__unmanaged__" and active_snapshot != payload.snapshotVersion:
                raise ValueError("stale_archive")
            if job["status"] == "completed":
                if not (child / job["filename"]).is_file():
                    raise ValueError("missing_archive")
                archive_jobs[child.name] = job
            elif job["status"] in {"queued", "running"}:
                job["status"] = "queued"
                job["processed"] = 0
                archive_jobs[child.name] = job
            else:
                raise ValueError("finished_job_without_archive")
        except (OSError, ValueError, KeyError, TypeError):
            shutil.rmtree(child, ignore_errors=True)
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT, limits=httpx.Limits(max_connections=8, max_keepalive_connections=8)) as client:
        drive_source = DriveSource(client, CALLBACK_ORIGIN, CALLBACK_TOKEN, ARCHIVE_MAX_BYTES)
        for job_id, job in archive_jobs.items():
            if job["status"] == "queued":
                record = json.loads((ARCHIVE_ROOT / job_id / "job.json").read_text(encoding="utf-8"))
                archive_tasks[job_id] = asyncio.create_task(process_archive_job(job_id, ArchiveJobInput.model_validate(record["payload"])))
        cleanup_task = asyncio.create_task(expire_archives())
        try:
            yield
        finally:
            tasks = [cleanup_task, *archive_tasks.values()]
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            archive_tasks.clear()
            archive_jobs.clear()
            archive_tickets.clear()
            drive_source = None


app = FastAPI(title="Orbit Archive Worker", docs_url=None, redoc_url=None, lifespan=lifespan)


class ArchivePhotoInput(BaseModel):
    driveFileId: str = Field(min_length=1, max_length=256)
    filename: str = Field(min_length=1, max_length=512)
    archivePath: str = Field(min_length=1, max_length=2048)
    sizeBytes: int | None = Field(default=None, ge=0)


class ArchiveJobInput(BaseModel):
    galleryId: int = Field(gt=0)
    folderId: str = Field(min_length=1, max_length=256)
    folderName: str = Field(min_length=1, max_length=256)
    scope: Literal["subtree", "direct"] = "subtree"
    snapshotVersion: str = Field(default="", max_length=256)
    accessExpiresAt: str | None = None
    photos: list[ArchivePhotoInput] = Field(min_length=1)


class ArchivePrebuildInput(BaseModel):
    jobs: list[ArchiveJobInput] = Field(min_length=1)


def require_worker_token(authorization: str | None) -> None:
    if not WORKER_TOKEN or not authorization or not secrets.compare_digest(authorization, f"Bearer {WORKER_TOKEN}"):
        raise HTTPException(status_code=401, detail="Unauthorized")


class GallerySnapshotInput(BaseModel):
    snapshotVersion: str | None = Field(default=None, max_length=256)


@app.put("/v1/archive/galleries/{gallery_id}/snapshot")
async def set_gallery_snapshot(gallery_id: int, payload: GallerySnapshotInput, authorization: str | None = Header(default=None)) -> JSONResponse:
    require_worker_token(authorization)
    if gallery_id < 1:
        raise HTTPException(status_code=400, detail="invalid_gallery_id")
    gallery_snapshots[gallery_id] = payload.snapshotVersion
    save_gallery_snapshots()
    stale_ids = [job_id for job_id, job in archive_jobs.items() if job["galleryId"] == gallery_id and (payload.snapshotVersion is None or job.get("snapshotVersion") != payload.snapshotVersion)]
    tasks = [archive_tasks[job_id] for job_id in stale_ids if job_id in archive_tasks]
    for task in tasks:
        task.cancel()
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)
    for job_id in stale_ids:
        archive_jobs.pop(job_id, None)
        archive_tasks.pop(job_id, None)
        archive_tickets.pop(job_id, None)
        shutil.rmtree(ARCHIVE_ROOT / job_id, ignore_errors=True)
    return JSONResponse({"ok": True, "revokedJobs": len(stale_ids)})


@app.get("/v1/archive/capacity")
async def get_archive_capacity(authorization: str | None = Header(default=None)) -> JSONResponse:
    require_worker_token(authorization)
    return JSONResponse(archive_capacity())


@app.get("/healthz")
async def healthz() -> dict[str, Any]:
    return {"ok": True, "service": "orbit-archive-worker", "jobs": len(archive_tasks)}


@app.get("/readyz")
async def readyz(authorization: str | None = Header(default=None)) -> JSONResponse:
    require_worker_token(authorization)
    ready = bool(drive_source and CALLBACK_ORIGIN and CALLBACK_TOKEN)
    return JSONResponse({"ok": ready, "service": "orbit-archive-worker", "state": "ready" if ready else "not_configured", "capabilities": ["folder-archive-v1"]}, status_code=200 if ready else 503)


def safe_archive_path(value: str) -> str:
    normalized = value.replace("\\", "/")
    path = PurePosixPath(normalized)
    if path.is_absolute() or not path.parts or any(part in {"", ".", ".."} for part in path.parts):
        raise ValueError("invalid_archive_path")
    parts = [re.sub(r"[\x00-\x1f<>:\"|?*]", "_", part).strip(" .") for part in path.parts]
    if any(not part for part in parts):
        raise ValueError("invalid_archive_path")
    return "/".join(parts)


async def process_archive_job(job_id: str, payload: ArchiveJobInput) -> None:
    job = archive_jobs[job_id]
    job_dir = ARCHIVE_ROOT / job_id
    zip_stem = re.sub(r"[\x00-\x1f<>:/\\|?*]", "_", payload.folderName).strip(" .") or "Edited Photos"
    zip_path = job_dir / f"{zip_stem}.zip"
    staging_path = job_dir / "current-download"
    try:
        job_dir.mkdir(parents=True, exist_ok=True)
        if drive_source is None:
            raise RuntimeError("drive_unavailable")
        async with archive_semaphore:
            job["status"] = "running"
            save_job(job_id, payload)
            total_bytes = 0
            seen_paths: set[str] = set()
            with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
                for photo in payload.photos:
                    member = safe_archive_path(photo.archivePath)
                    if payload.scope == "direct":
                        member = PurePosixPath(member).name
                    unique_member = member
                    serial = 2
                    while unique_member.casefold() in seen_paths:
                        path = PurePosixPath(member)
                        unique_member = str(path.with_name(f"{path.stem} ({serial}){path.suffix}"))
                        serial += 1
                    seen_paths.add(unique_member.casefold())
                    evict_completed(job_id, required_free=256 * 1024 * 1024)
                    available = shutil.disk_usage(ARCHIVE_ROOT).free - ARCHIVE_MIN_FREE_BYTES
                    if available <= 0:
                        raise ArchiveStorageError("archive_storage_full")
                    limit = min(ARCHIVE_MAX_BYTES - total_bytes, available // 2)
                    if limit <= 0:
                        raise ArchiveStorageError("archive_storage_full")
                    file_bytes = await drive_source.download_to_path(photo.driveFileId, staging_path, limit)
                    total_bytes += file_bytes
                    await asyncio.to_thread(archive.write, staging_path, unique_member)
                    staging_path.unlink(missing_ok=True)
                    job["processed"] += 1
                    job["bytes"] = total_bytes
            job["status"] = "completed"
            job["filename"] = zip_path.name
            ready_at = time.time()
            job["readyAt"] = ready_at
            job["expiresAt"] = prebuilt_expires_at(payload.accessExpiresAt) if job["prebuilt"] else ready_at + ARCHIVE_UNDOWNLOADED_TTL_SECONDS
            job["accessExpiresAt"] = payload.accessExpiresAt
            job["finishedAt"] = ready_at
            save_job(job_id, payload)
            evict_completed(job_id)
            if zip_path.stat().st_size > ARCHIVE_CACHE_MAX_BYTES:
                raise ArchiveStorageError("archive_storage_full")
            logger.info("Archive job %s completed: gallery=%s photos=%s bytes=%s", job_id, payload.galleryId, job["processed"], total_bytes)
    except Exception as error:
        job["status"] = "failed"
        job["errorCode"] = getattr(error, "code", None) or "archive_failed"
        shutil.rmtree(job_dir, ignore_errors=True)
        logger.warning("Archive job %s failed: gallery=%s code=%s error_class=%s", job_id, payload.galleryId, job["errorCode"], type(error).__name__)


def enqueue_archive_job(payload: ArchiveJobInput, prebuilt: bool) -> dict[str, Any]:
    if len(payload.photos) > ARCHIVE_MAX_PHOTOS:
        raise HTTPException(status_code=413, detail="too_many_photos")
    if not drive_source or not CALLBACK_ORIGIN or not CALLBACK_TOKEN:
        raise HTTPException(status_code=503, detail="drive_source_unavailable")
    if payload.galleryId in gallery_snapshots and gallery_snapshots[payload.galleryId] != payload.snapshotVersion:
        raise HTTPException(status_code=409, detail="gallery_snapshot_inactive")
    for photo in payload.photos:
        try:
            safe_archive_path(photo.archivePath)
        except ValueError as error:
            raise HTTPException(status_code=400, detail="invalid_archive_path") from error
    snapshot_key = archive_key(payload)
    for existing_id, existing in archive_jobs.items():
        if existing["snapshotKey"] == snapshot_key and existing["status"] in {"queued", "running", "completed"} and time.time() < existing["expiresAt"]:
            if prebuilt and not existing["prebuilt"]:
                existing["prebuilt"] = True
                if existing["status"] == "completed":
                    existing["expiresAt"] = prebuilt_expires_at(payload.accessExpiresAt)
                save_job(existing_id, payload)
            return {"jobId": existing_id, "status": existing["status"], "duplicate": True}
    active = sum(job["status"] in {"queued", "running"} and not job.get("prebuilt") for job in archive_jobs.values())
    if not prebuilt and active >= ARCHIVE_MAX_ACTIVE:
        raise HTTPException(status_code=429, detail="archive_queue_full")
    job_id = uuid4().hex
    estimated_bytes = sum((photo.sizeBytes or 0) + ZIP_ENTRY_OVERHEAD_BYTES for photo in payload.photos) if prebuilt else 0
    archive_jobs[job_id] = {"galleryId": payload.galleryId, "folderId": payload.folderId, "scope": payload.scope, "snapshotVersion": payload.snapshotVersion, "snapshotKey": snapshot_key, "prebuilt": prebuilt, "estimatedBytes": estimated_bytes, "status": "queued", "processed": 0, "total": len(payload.photos), "bytes": 0, "readyAt": None, "firstDownloadAt": None, "expiresAt": prebuilt_expires_at(payload.accessExpiresAt) if prebuilt else time.time() + 3600}
    save_job(job_id, payload)
    archive_tasks[job_id] = asyncio.create_task(process_archive_job(job_id, payload))
    return {"jobId": job_id, "status": "queued", "duplicate": False}


@app.post("/v1/archive/jobs", status_code=202)
async def create_archive_job(payload: ArchiveJobInput, authorization: str | None = Header(default=None)) -> JSONResponse:
    require_worker_token(authorization)
    return JSONResponse(enqueue_archive_job(payload, prebuilt=False), status_code=202)


@app.post("/v1/archive/prebuild", status_code=202)
async def prebuild_archives(payload: ArchivePrebuildInput, authorization: str | None = Header(default=None)) -> JSONResponse:
    require_worker_token(authorization)
    if len(payload.jobs) > ARCHIVE_MAX_PREBUILD_JOBS or sum(len(job.photos) for job in payload.jobs) > 50_000:
        raise HTTPException(status_code=413, detail="prebuild_batch_too_large")
    if len({job.galleryId for job in payload.jobs}) != 1:
        raise HTTPException(status_code=400, detail="mixed_galleries")
    requested_bytes = estimate_prebuild_bytes(payload.jobs)
    if payload.jobs[0].galleryId in gallery_snapshots and gallery_snapshots[payload.jobs[0].galleryId] != payload.jobs[0].snapshotVersion:
        raise HTTPException(status_code=409, detail="gallery_snapshot_inactive")
    if estimate_new_prebuild_bytes(payload.jobs) > archive_capacity()["availableBytes"]:
        raise HTTPException(status_code=507, detail="archive_capacity_insufficient")
    for job in payload.jobs:
        if len(job.photos) > ARCHIVE_MAX_PHOTOS:
            raise HTTPException(status_code=413, detail="too_many_photos")
        for photo in job.photos:
            try:
                safe_archive_path(photo.archivePath)
            except ValueError as error:
                raise HTTPException(status_code=400, detail="invalid_archive_path") from error
    jobs = [enqueue_archive_job(job, prebuilt=True) for job in payload.jobs]
    return JSONResponse({"jobs": jobs, "estimatedBytes": requested_bytes, **archive_capacity()}, status_code=202)


@app.get("/v1/archive/prebuild/galleries/{gallery_id}")
async def prebuild_status(gallery_id: int, snapshotVersion: str, authorization: str | None = Header(default=None)) -> JSONResponse:
    require_worker_token(authorization)
    jobs = [{"folderId": job["folderId"], "scope": job["scope"], "status": job["status"], "processed": job["processed"], "total": job["total"], "errorCode": job.get("errorCode")} for job in archive_jobs.values() if job["galleryId"] == gallery_id and job.get("prebuilt") and job.get("snapshotVersion") == snapshotVersion]
    return JSONResponse({"jobs": jobs, **archive_capacity()})


@app.get("/v1/archive/jobs/{job_id}")
async def get_archive_job(job_id: str, authorization: str | None = Header(default=None)) -> JSONResponse:
    require_worker_token(authorization)
    job = archive_jobs.get(job_id)
    if not job or (job["galleryId"] in gallery_snapshots and gallery_snapshots[job["galleryId"]] != job.get("snapshotVersion")):
        raise HTTPException(status_code=404, detail="archive_job_not_found")
    response = {key: job[key] for key in ("galleryId", "folderId", "snapshotVersion", "status", "processed", "total", "bytes", "filename", "expiresAt", "errorCode") if key in job}
    if job["status"] == "completed":
        ticket_expires_at = time.time() + 900
        if job.get("accessExpiresAt"):
            try:
                ticket_expires_at = min(ticket_expires_at, datetime.fromisoformat(job["accessExpiresAt"].replace("Z", "+00:00")).timestamp())
            except ValueError:
                raise HTTPException(status_code=409, detail="invalid_access_expiry") from None
        if ticket_expires_at <= time.time():
            raise HTTPException(status_code=409, detail="edited_access_expired")
        tickets = archive_tickets.setdefault(job_id, {})
        for old_ticket, deadline in list(tickets.items()):
            if deadline <= time.time():
                tickets.pop(old_ticket)
        while len(tickets) >= 256:
            tickets.pop(next(iter(tickets)))
        ticket = secrets.token_urlsafe(32)
        tickets[ticket] = ticket_expires_at
        response["downloadTicket"] = ticket
        response["downloadTicketExpiresAt"] = ticket_expires_at
    return JSONResponse(response)


@app.get("/v1/archive/download/{job_id}")
async def download_archive(job_id: str, ticket: str) -> FileResponse:
    job = archive_jobs.get(job_id)
    if not job or (job["galleryId"] in gallery_snapshots and gallery_snapshots[job["galleryId"]] != job.get("snapshotVersion")) or job["status"] != "completed" or time.time() >= job["expiresAt"] or time.time() >= archive_tickets.get(job_id, {}).get(ticket, 0):
        raise HTTPException(status_code=404, detail="archive_not_available")
    path = ARCHIVE_ROOT / job_id / job["filename"]
    if not path.is_file():
        raise HTTPException(status_code=404, detail="archive_not_available")
    if not job.get("prebuilt") and job.get("readyAt") is not None and job.get("firstDownloadAt") is None:
        first_download_at = time.time()
        previous_expiry = job["expiresAt"]
        job["firstDownloadAt"] = first_download_at
        job["expiresAt"] = first_download_at + ARCHIVE_TTL_SECONDS
        try:
            save_job_state(job_id)
        except (OSError, ValueError, KeyError):
            job["firstDownloadAt"] = None
            job["expiresAt"] = previous_expiry
            logger.exception("Unable to persist first-download expiry for archive job %s", job_id)
            raise HTTPException(status_code=503, detail="archive_expiry_state_unavailable") from None
    return FileResponse(path, media_type="application/zip", filename=job["filename"], headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})
