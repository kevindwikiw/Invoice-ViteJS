from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime
import logging
import os
from pathlib import Path, PurePosixPath
import re
import secrets
import shutil
import time
from typing import Any
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
ARCHIVE_TTL_SECONDS = max(60, int(os.getenv("FACE_ARCHIVE_WORKER_TTL_SECONDS", str(12 * 60 * 60))))

archive_semaphore = asyncio.Semaphore(ARCHIVE_CONCURRENCY)
archive_jobs: dict[str, dict[str, Any]] = {}
archive_tasks: dict[str, asyncio.Task[None]] = {}
drive_source: DriveSource | None = None


def prune_archives() -> None:
    now = time.time()
    for job_id, job in list(archive_jobs.items()):
        if job["status"] in {"queued", "running"} or now < job["expiresAt"]:
            continue
        archive_jobs.pop(job_id, None)
        archive_tasks.pop(job_id, None)
        shutil.rmtree(ARCHIVE_ROOT / job_id, ignore_errors=True)


async def expire_archives() -> None:
    while True:
        await asyncio.sleep(60)
        prune_archives()


@asynccontextmanager
async def lifespan(_: FastAPI):
    global drive_source
    ARCHIVE_ROOT.mkdir(parents=True, exist_ok=True)
    # Jobs live in this process, so files left by an earlier process are orphans.
    for child in ARCHIVE_ROOT.iterdir():
        if child.name == "lost+found":
            continue
        if child.is_dir():
            shutil.rmtree(child)
        else:
            child.unlink()
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT, limits=httpx.Limits(max_connections=8, max_keepalive_connections=8)) as client:
        drive_source = DriveSource(client, CALLBACK_ORIGIN, CALLBACK_TOKEN, ARCHIVE_MAX_BYTES)
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
            drive_source = None


app = FastAPI(title="Orbit Archive Worker", docs_url=None, redoc_url=None, lifespan=lifespan)


class ArchivePhotoInput(BaseModel):
    driveFileId: str = Field(min_length=1, max_length=256)
    filename: str = Field(min_length=1, max_length=512)
    archivePath: str = Field(min_length=1, max_length=2048)


class ArchiveJobInput(BaseModel):
    galleryId: int = Field(gt=0)
    folderId: str = Field(min_length=1, max_length=256)
    folderName: str = Field(min_length=1, max_length=256)
    accessExpiresAt: str | None = None
    photos: list[ArchivePhotoInput] = Field(min_length=1)


def require_worker_token(authorization: str | None) -> None:
    if not WORKER_TOKEN or not authorization or not secrets.compare_digest(authorization, f"Bearer {WORKER_TOKEN}"):
        raise HTTPException(status_code=401, detail="Unauthorized")


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
            total_bytes = 0
            seen_paths: set[str] = set()
            with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
                for photo in payload.photos:
                    member = safe_archive_path(photo.archivePath)
                    unique_member = member
                    serial = 2
                    while unique_member.casefold() in seen_paths:
                        path = PurePosixPath(member)
                        unique_member = str(path.with_name(f"{path.stem} ({serial}){path.suffix}"))
                        serial += 1
                    seen_paths.add(unique_member.casefold())
                    file_bytes = await drive_source.download_to_path(photo.driveFileId, staging_path, ARCHIVE_MAX_BYTES - total_bytes)
                    total_bytes += file_bytes
                    await asyncio.to_thread(archive.write, staging_path, unique_member)
                    staging_path.unlink(missing_ok=True)
                    job["processed"] += 1
                    job["bytes"] = total_bytes
            job["status"] = "completed"
            job["filename"] = zip_path.name
            job["expiresAt"] = time.time() + ARCHIVE_TTL_SECONDS
            job["accessExpiresAt"] = payload.accessExpiresAt
            logger.info("Archive job %s completed: gallery=%s photos=%s bytes=%s", job_id, payload.galleryId, job["processed"], total_bytes)
    except Exception as error:
        job["status"] = "failed"
        job["errorCode"] = getattr(error, "code", None) or "archive_failed"
        shutil.rmtree(job_dir, ignore_errors=True)
        logger.warning("Archive job %s failed: gallery=%s code=%s", job_id, payload.galleryId, job["errorCode"])


@app.post("/v1/archive/jobs", status_code=202)
async def create_archive_job(payload: ArchiveJobInput, authorization: str | None = Header(default=None)) -> JSONResponse:
    require_worker_token(authorization)
    if len(payload.photos) > ARCHIVE_MAX_PHOTOS:
        raise HTTPException(status_code=413, detail="too_many_photos")
    if not drive_source or not CALLBACK_ORIGIN or not CALLBACK_TOKEN:
        raise HTTPException(status_code=503, detail="drive_source_unavailable")
    for photo in payload.photos:
        try:
            safe_archive_path(photo.archivePath)
        except ValueError as error:
            raise HTTPException(status_code=400, detail="invalid_archive_path") from error
    for existing_id, existing in archive_jobs.items():
        if existing["galleryId"] == payload.galleryId and existing["folderId"] == payload.folderId and existing["status"] in {"queued", "running", "completed"} and time.time() < existing["expiresAt"]:
            return JSONResponse({"jobId": existing_id, "status": existing["status"], "duplicate": True}, status_code=202)
    active = sum(job["status"] in {"queued", "running"} for job in archive_jobs.values())
    if active >= ARCHIVE_MAX_ACTIVE:
        raise HTTPException(status_code=429, detail="archive_queue_full")
    job_id = uuid4().hex
    archive_jobs[job_id] = {"galleryId": payload.galleryId, "folderId": payload.folderId, "status": "queued", "processed": 0, "total": len(payload.photos), "bytes": 0, "expiresAt": time.time() + 3600}
    archive_tasks[job_id] = asyncio.create_task(process_archive_job(job_id, payload))
    return JSONResponse({"jobId": job_id, "status": "queued", "duplicate": False}, status_code=202)


@app.get("/v1/archive/jobs/{job_id}")
async def get_archive_job(job_id: str, authorization: str | None = Header(default=None)) -> JSONResponse:
    require_worker_token(authorization)
    job = archive_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="archive_job_not_found")
    if job["status"] == "completed":
        ticket_expires_at = time.time() + 900
        if job.get("accessExpiresAt"):
            try:
                ticket_expires_at = min(ticket_expires_at, datetime.fromisoformat(job["accessExpiresAt"].replace("Z", "+00:00")).timestamp())
            except ValueError:
                raise HTTPException(status_code=409, detail="invalid_access_expiry") from None
        if ticket_expires_at <= time.time():
            raise HTTPException(status_code=409, detail="edited_access_expired")
        job["downloadTicket"] = secrets.token_urlsafe(32)
        job["downloadTicketExpiresAt"] = ticket_expires_at
    return JSONResponse({key: job[key] for key in ("galleryId", "folderId", "status", "processed", "total", "bytes", "filename", "downloadTicket", "downloadTicketExpiresAt", "expiresAt", "errorCode") if key in job})


@app.get("/v1/archive/download/{job_id}")
async def download_archive(job_id: str, ticket: str) -> FileResponse:
    job = archive_jobs.get(job_id)
    if not job or job["status"] != "completed" or time.time() >= job["expiresAt"] or time.time() >= job.get("downloadTicketExpiresAt", 0) or not secrets.compare_digest(ticket, job.get("downloadTicket", "")):
        raise HTTPException(status_code=404, detail="archive_not_available")
    path = ARCHIVE_ROOT / job_id / job["filename"]
    if not path.is_file():
        raise HTTPException(status_code=404, detail="archive_not_available")
    return FileResponse(path, media_type="application/zip", filename=job["filename"], headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})
