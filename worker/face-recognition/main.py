from __future__ import annotations

import asyncio
import json
import logging
import os
import secrets
import time
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlparse

import httpx
import numpy as np
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from starlette.datastructures import FormData, UploadFile
from starlette.exceptions import HTTPException as StarletteHTTPException
from python_multipart.exceptions import MultipartParseError
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, Field

from engine import FaceEngine, MODEL_VERSION, sensitivity_threshold
from embedding_cache import CacheCapacityError, EmbeddingCache, IndexKey, PreparedIndex, prepare_index

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("orbit-face-worker")

WORKER_TOKEN = os.getenv("FACE_WORKER_TOKEN", "").strip()
CALLBACK_ORIGIN = os.getenv("FACE_WORKER_CALLBACK_ORIGIN", "").strip().rstrip("/")
CALLBACK_TOKEN = os.getenv("FACE_WORKER_CALLBACK_TOKEN", "").strip()
MEDIA_ROOT = Path(os.getenv("FACE_WORKER_MEDIA_ROOT", "").strip()).resolve() if os.getenv("FACE_WORKER_MEDIA_ROOT", "").strip() else None
MODEL_NAME = MODEL_VERSION
MODEL_DIR = Path(os.getenv("FACE_WORKER_MODEL_DIR", "").strip() or Path(__file__).parent / "models")
HTTP_TIMEOUT = float(os.getenv("FACE_WORKER_HTTP_TIMEOUT_SECONDS", "30"))
MAX_CONCURRENT = max(1, int(os.getenv("FACE_WORKER_MAX_CONCURRENT", "1")))
PHOTO_CONCURRENCY = min(4, max(1, int(os.getenv("FACE_WORKER_PHOTO_CONCURRENCY", "3"))))
INTRA_OP_THREADS = max(1, int(os.getenv("FACE_WORKER_INTRA_OP_THREADS", "2")))
MAX_IMAGE_SIDE = 1280
MAX_IMAGE_BYTES = max(1, int(os.getenv("FACE_WORKER_MAX_IMAGE_BYTES", str(15 * 1024 * 1024))))
MAX_IMAGE_PIXELS = max(1, int(os.getenv("FACE_WORKER_MAX_IMAGE_PIXELS", str(40_000_000))))
MAX_PHOTOS_PER_JOB = max(1, int(os.getenv("FACE_WORKER_MAX_PHOTOS_PER_JOB", "10000")))
MAX_EMBEDDING_JSON_BYTES = max(1, int(os.getenv("FACE_WORKER_MAX_EMBEDDING_JSON_BYTES", str(20 * 1024 * 1024))))
MAX_EMBEDDING_RECORDS = max(1, int(os.getenv("FACE_WORKER_MAX_EMBEDDING_RECORDS", "100000")))
CACHE_MAX_BYTES = max(1, int(os.getenv("FACE_WORKER_CACHE_MAX_BYTES", str(128 * 1024 * 1024))))
CACHE_MAX_ENTRIES = max(1, int(os.getenv("FACE_WORKER_CACHE_MAX_ENTRIES", "16")))
CACHE_TTL_SECONDS = max(1, int(os.getenv("FACE_WORKER_CACHE_TTL_SECONDS", "900")))
embedding_cache = EmbeddingCache(CACHE_MAX_BYTES, CACHE_MAX_ENTRIES, CACHE_TTL_SECONDS)
cache_cleanup_task: asyncio.Task[None] | None = None

Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS

app = FastAPI(title="Orbit Face Recognition Worker", docs_url=None, redoc_url=None)
face_app: Any = None
model_lock = asyncio.Lock()
inference_semaphore = asyncio.Semaphore(1)
model_task: asyncio.Task[None] | None = None
model_state = "not_loaded"
model_error_code: str | None = None
job_tasks: dict[int, asyncio.Task[None]] = {}
job_semaphore = asyncio.Semaphore(MAX_CONCURRENT)
http_client: httpx.AsyncClient | None = None


class PhotoInput(BaseModel):
    driveFileId: str
    filename: str = ""
    mimeType: str = "image/jpeg"
    displayOrder: int = 0
    sourceVersion: str = ""
    cachedFaces: list[dict[str, Any]] | None = None


class IndexJobInput(BaseModel):
    jobId: int
    galleryId: int
    modelVersion: str
    sourceVersion: str = ""
    photos: list[PhotoInput] = Field(default_factory=list)


def require_worker_token(authorization: str | None) -> None:
    expected = f"Bearer {WORKER_TOKEN}"
    if not WORKER_TOKEN or not authorization or not secrets.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="Unauthorized")


def callback_config() -> tuple[str, str]:
    if not CALLBACK_ORIGIN or not CALLBACK_TOKEN:
        raise RuntimeError("FACE_WORKER_CALLBACK_ORIGIN and FACE_WORKER_CALLBACK_TOKEN must be configured")
    parsed = urlparse(CALLBACK_ORIGIN)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise RuntimeError("FACE_WORKER_CALLBACK_ORIGIN must be an absolute http(s) URL")
    return CALLBACK_ORIGIN, CALLBACK_TOKEN


def bounded_payload(payload: bytes, label: str = "payload") -> bytes:
    if len(payload) > MAX_IMAGE_BYTES:
        raise ValueError(f"{label} exceeds the {MAX_IMAGE_BYTES} byte limit")
    return payload


def decode_image(payload: bytes) -> np.ndarray:
    with Image.open(io_bytes(bounded_payload(payload, "image"))) as image:
        if image.width * image.height > MAX_IMAGE_PIXELS:
            raise ValueError(f"image exceeds the {MAX_IMAGE_PIXELS} pixel limit")
        image.draft("RGB", (MAX_IMAGE_SIDE, MAX_IMAGE_SIDE))
        rgb = ImageOps.exif_transpose(image).convert("RGB")
        rgb.thumbnail((MAX_IMAGE_SIDE, MAX_IMAGE_SIDE), Image.Resampling.LANCZOS)
        return np.asarray(rgb)[:, :, ::-1].copy()


def io_bytes(payload: bytes):
    from io import BytesIO

    return BytesIO(payload)


def load_face_app_sync() -> Any:
    logger.info("Loading OpenCV model %s", MODEL_NAME)
    return FaceEngine(MODEL_DIR, INTRA_OP_THREADS)


async def get_face_app() -> Any:
    global face_app, model_state, model_error_code
    if face_app is not None:
        return face_app
    async with model_lock:
        if face_app is None:
            model_state = "loading"
            model_error_code = None
            try:
                face_app = await asyncio.to_thread(load_face_app_sync)
                model_state = "ready"
                logger.info("OpenCV model %s is ready", MODEL_NAME)
            except (ImportError, ModuleNotFoundError):
                model_state = "failed"
                model_error_code = "dependency_missing"
                logger.exception("Face worker ML dependencies are missing")
                raise
            except Exception:
                model_state = "failed"
                model_error_code = "model_load_failed"
                logger.exception("Unable to load OpenCV model %s", MODEL_NAME)
                raise
    return face_app


async def initialize_model() -> None:
    try:
        await get_face_app()
    except Exception:
        # Readiness reports the failure without stopping the liveness endpoint.
        pass


@app.on_event("startup")
async def start_model_initialization() -> None:
    global model_task, http_client, cache_cleanup_task
    http_client = httpx.AsyncClient(timeout=HTTP_TIMEOUT, limits=httpx.Limits(max_connections=8, max_keepalive_connections=8))
    model_task = asyncio.create_task(initialize_model())
    cache_cleanup_task = asyncio.create_task(expire_cache())


async def expire_cache() -> None:
    while True:
        await asyncio.sleep(min(60, CACHE_TTL_SECONDS))
        embedding_cache.expire()


@app.on_event("shutdown")
async def shutdown_worker() -> None:
    tasks = list(job_tasks.values())
    if model_task is not None:
        tasks.append(model_task)
    if cache_cleanup_task is not None:
        tasks.append(cache_cleanup_task)
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    await embedding_cache.close()
    if http_client is not None:
        await http_client.aclose()


def ready_model() -> Any:
    if model_state != "ready" or face_app is None:
        raise HTTPException(status_code=503, detail=model_error_code or "model_loading")
    return face_app


def callback_client() -> httpx.AsyncClient:
    if http_client is None:
        raise RuntimeError("Worker HTTP client has not started")
    return http_client


def normalized_embedding(face: Any) -> list[float]:
    vector = np.asarray(face.embedding, dtype=np.float32)
    norm = float(np.linalg.norm(vector))
    if norm <= 0:
        return []
    return (vector / norm).astype(np.float32).tolist()


def face_payload(face: Any, photo: PhotoInput, face_index: int) -> dict[str, Any]:
    bbox = np.asarray(face.bbox, dtype=np.float32).tolist() if getattr(face, "bbox", None) is not None else []
    return {
        "driveFileId": photo.driveFileId,
        "faceIndex": face_index,
        "embedding": normalized_embedding(face),
        "boundingBox": {
            "x": float(bbox[0]),
            "y": float(bbox[1]),
            "width": float(bbox[2] - bbox[0]),
            "height": float(bbox[3] - bbox[1]),
        } if len(bbox) >= 4 else None,
        "sourceVersion": photo.sourceVersion,
    }


def local_candidates(gallery_id: int, photo: PhotoInput) -> list[Path]:
    if MEDIA_ROOT is None:
        return []
    safe_name = Path(photo.filename).name if photo.filename else ""
    return [
        MEDIA_ROOT / str(gallery_id) / photo.driveFileId,
        MEDIA_ROOT / str(gallery_id) / safe_name,
        MEDIA_ROOT / photo.driveFileId,
        MEDIA_ROOT / safe_name,
    ]


async def fetch_photo(job: IndexJobInput, photo: PhotoInput) -> bytes:
    for candidate in local_candidates(job.galleryId, photo):
        try:
            resolved = candidate.resolve()
            if MEDIA_ROOT is not None:
                resolved.relative_to(MEDIA_ROOT)
            if resolved.is_file():
                return bounded_payload(await asyncio.to_thread(resolved.read_bytes), "photo")
        except ValueError:
            logger.warning("Rejected photo path outside media root: %s", photo.driveFileId)
        except OSError:
            logger.warning("Unable to read local photo: %s", photo.driveFileId)

    callback_origin, callback_token = callback_config()
    url = f"{callback_origin}/api/internal/face-index/assets/galleries/{job.galleryId}/photos/{quote(photo.driveFileId, safe='')}"
    async with callback_client().stream("GET", url, headers={"x-face-worker-token": callback_token}) as response:
        response.raise_for_status()
        chunks: list[bytes] = []
        total = 0
        async for chunk in response.aiter_bytes():
            total += len(chunk)
            if total > MAX_IMAGE_BYTES:
                raise ValueError(f"photo exceeds the {MAX_IMAGE_BYTES} byte limit")
            chunks.append(chunk)
        payload = b"".join(chunks)
        logger.debug("Fetched photo %s from callback (%s bytes)", photo.driveFileId, len(payload))
        return payload


async def callback(job: IndexJobInput, path: str, payload: dict[str, Any]) -> None:
    callback_origin, callback_token = callback_config()
    url = f"{callback_origin}/api/internal/face-index/{path}"
    response = await callback_client().post(url, json=payload, headers={"x-face-worker-token": callback_token})
    response.raise_for_status()


async def process_index_job(job: IndexJobInput) -> None:
    async with job_semaphore:
        embeddings: list[dict[str, Any]] = []
        processed = 0
        heartbeat_stop = asyncio.Event()
        heartbeat_task: asyncio.Task[None] | None = None
        try:
            logger.info("Starting face job %s: %s photos", job.jobId, len(job.photos))
            recognizer = await get_face_app()
            await callback(job, f"callbacks/jobs/{job.jobId}/progress", {"processed": 0})
            async def heartbeat() -> None:
                while not heartbeat_stop.is_set():
                    try:
                        await asyncio.wait_for(heartbeat_stop.wait(), timeout=5)
                    except asyncio.TimeoutError:
                        try:
                            await callback(job, f"callbacks/jobs/{job.jobId}/progress", {"processed": processed})
                        except Exception as error:
                            logger.warning("Heartbeat failed for job %s: %s", job.jobId, error)

            heartbeat_task = asyncio.create_task(heartbeat())

            async def index_photo(photo: PhotoInput) -> list[dict[str, Any]]:
                if photo.cachedFaces is not None:
                    logger.info("Job %s photo %s: cached (%s faces)", job.jobId, photo.driveFileId, len(photo.cachedFaces))
                    return photo.cachedFaces
                last_error: Exception | None = None
                for attempt in range(2):
                    started_at = time.perf_counter()
                    try:
                        payload = await fetch_photo(job, photo)
                        fetched_at = time.perf_counter()
                        image = await asyncio.to_thread(decode_image, payload)
                        decoded_at = time.perf_counter()
                        async with inference_semaphore:
                            inference_at = time.perf_counter()
                            faces = await asyncio.to_thread(recognizer.get, image)
                        finished_at = time.perf_counter()
                        logger.info(
                            "Job %s photo %s: faces=%s fetch_ms=%.0f decode_ms=%.0f wait_ms=%.0f inference_ms=%.0f",
                            job.jobId, photo.driveFileId, len(faces), (fetched_at - started_at) * 1000,
                            (decoded_at - fetched_at) * 1000, (inference_at - decoded_at) * 1000,
                            (finished_at - inference_at) * 1000,
                        )
                        return [face_payload(face, photo, face_index) for face_index, face in enumerate(faces) if normalized_embedding(face)]
                    except Exception as error:
                        last_error = error
                        logger.warning("Unable to index %s (attempt %s/2): %s", photo.driveFileId, attempt + 1, error)
                        if attempt == 0:
                            await asyncio.sleep(0.25)
                raise RuntimeError(f"Unable to index photo {photo.driveFileId} after 2 attempts: {last_error}")

            pending_photos = iter(job.photos)

            async def consume_photos() -> None:
                nonlocal processed
                for photo in pending_photos:
                    embeddings.extend(await index_photo(photo))
                    processed += 1

            # A bounded pool overlaps downloads/decode with one shared inference engine.
            async with asyncio.TaskGroup() as group:
                for _ in range(PHOTO_CONCURRENCY):
                    group.create_task(consume_photos())
            heartbeat_stop.set()
            await heartbeat_task
            heartbeat_task = None
            await callback(job, f"callbacks/jobs/{job.jobId}/complete", {
                "galleryId": job.galleryId,
                "modelVersion": job.modelVersion,
                "sourceVersion": job.sourceVersion,
                "embeddings": embeddings,
            })
            logger.info("Completed face job %s: %s photos, %s faces", job.jobId, processed, len(embeddings))
        except Exception as error:
            logger.exception("Face job %s failed", job.jobId)
            try:
                await callback(job, f"callbacks/jobs/{job.jobId}/fail", {"error": str(error)[:1000]})
            except Exception:
                logger.exception("Unable to report failed face job %s", job.jobId)
        finally:
            heartbeat_stop.set()
            if heartbeat_task is not None:
                await heartbeat_task
            job_tasks.pop(job.jobId, None)


@app.get("/healthz")
async def healthz() -> dict[str, Any]:
    return {"ok": True, "service": "orbit-face-worker", "model": MODEL_NAME, "jobs": len(job_tasks)}


@app.get("/readyz")
async def readyz(authorization: str | None = Header(default=None)) -> JSONResponse:
    require_worker_token(authorization)
    if model_state != "ready" or face_app is None:
        return JSONResponse({
            "ok": False,
            "service": "orbit-face-worker",
            "state": model_state,
            "code": model_error_code or "model_loading",
        }, status_code=503)
    return JSONResponse({"ok": True, "service": "orbit-face-worker", "state": "ready", "model": MODEL_NAME, "capabilities": ["embedding-cache-v1"]})


@app.post("/v1/index/jobs", status_code=202)
async def create_index_job(payload: IndexJobInput, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_worker_token(authorization)
    ready_model()
    if payload.modelVersion != MODEL_VERSION:
        raise HTTPException(status_code=409, detail="model_version_mismatch")
    if payload.jobId <= 0 or payload.galleryId <= 0:
        raise HTTPException(status_code=400, detail="jobId and galleryId are required")
    if len(payload.photos) > MAX_PHOTOS_PER_JOB:
        raise HTTPException(status_code=413, detail=f"Too many photos; maximum is {MAX_PHOTOS_PER_JOB}")
    if payload.jobId in job_tasks:
        return {"accepted": True, "jobId": payload.jobId, "duplicate": True}
    if len(job_tasks) >= MAX_CONCURRENT:
        raise HTTPException(status_code=503, detail="worker_busy")
    job_tasks[payload.jobId] = asyncio.create_task(process_index_job(payload))
    return {"accepted": True, "jobId": payload.jobId, "photos": len(payload.photos)}


def largest_face(faces: list[Any]) -> Any | None:
    if not faces:
        return None
    return max(faces, key=lambda face: float((face.bbox[2] - face.bbox[0]) * (face.bbox[3] - face.bbox[1])))


def match_records(query: np.ndarray, records: list, threshold: float) -> list[dict[str, Any]]:
    candidates, file_ids = [], []
    for record in records:
        try:
            vector = np.asarray(record["embedding"], dtype=np.float32)
            file_id = record["driveFileId"]
            if not isinstance(file_id, str) or not file_id or vector.shape != query.shape or not np.isfinite(vector).all():
                continue
            norm = float(np.linalg.norm(vector))
            if norm <= 0:
                continue
            candidates.append(vector / norm)
            file_ids.append(file_id)
        except (KeyError, TypeError, ValueError):
            continue
    if not candidates:
        return []
    distances = np.clip(1 - np.stack(candidates) @ query, 0, 2)
    best_by_photo: dict[str, float] = {}
    for file_id, distance in zip(file_ids, distances):
        if distance <= threshold and distance < best_by_photo.get(file_id, float("inf")):
            best_by_photo[file_id] = float(distance)
    return sorted(({"driveFileId": key, "distance": value} for key, value in best_by_photo.items()), key=lambda item: item["distance"])


def search_error(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message})


async def parse_search_form(request: Request) -> FormData:
    try:
        return await request.form(max_files=1, max_fields=5, max_part_size=MAX_EMBEDDING_JSON_BYTES)
    except StarletteHTTPException as error:
        if error.status_code == 400 and str(error.detail).startswith(("Part exceeded maximum size", "Field exceeded maximum size")):
            raise search_error(413, "embeddings_too_large", "Embeddings payload is too large") from error
        raise search_error(400, "invalid_search_form", "Invalid search form") from error
    except MultipartParseError as error:
        raise search_error(400, "invalid_search_form", "Invalid search form") from error


@app.post("/v1/search")
async def search_faces(request: Request, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_worker_token(authorization)
    recognizer = ready_model()
    form = await parse_search_form(request)
    try:
        return await search_form(form, recognizer)
    finally:
        await form.close()


async def search_form(form: FormData, recognizer: Any) -> dict[str, Any]:
    allowed = {"galleryId", "embeddings", "sensitivity", "modelVersion", "selfie", "sourceVersion", "completedJobId"}
    if any(key not in allowed or len(form.getlist(key)) != 1 for key in form):
        raise search_error(400, "invalid_search_form", "Invalid search form")
    gallery_id = form.get("galleryId")
    embeddings = form.get("embeddings")
    sensitivity = form.get("sensitivity", "balanced")
    modelVersion = form.get("modelVersion", MODEL_VERSION)
    selfie = form.get("selfie")
    if not all(isinstance(value, str) for value in (gallery_id, sensitivity, modelVersion)) or not isinstance(selfie, UploadFile):
        raise search_error(422, "invalid_search_form", "Required search fields are missing or invalid")
    try:
        galleryId = int(gallery_id)
    except ValueError as error:
        raise search_error(422, "invalid_search_form", "Invalid galleryId") from error
    if modelVersion != MODEL_VERSION:
        raise search_error(409, "model_version_mismatch", "Model version does not match")
    if galleryId <= 0:
        raise search_error(400, "invalid_search_form", "Invalid galleryId")
    cached_index: PreparedIndex | None = None
    if embeddings is not None:
        if not isinstance(embeddings, str) or "sourceVersion" in form or "completedJobId" in form:
            raise search_error(400, "invalid_search_form", "Invalid search form")
        if len(embeddings.encode("utf-8")) > MAX_EMBEDDING_JSON_BYTES:
            raise search_error(413, "embeddings_too_large", "Embeddings payload is too large")
        try:
            records = json.loads(embeddings)
        except json.JSONDecodeError as error:
            raise search_error(400, "invalid_embeddings", "Invalid embeddings payload") from error
        validate_records(records)
    else:
        source = form.get("sourceVersion")
        job_id = form.get("completedJobId")
        if not isinstance(source, str) or len(source) != 64 or any(c not in "0123456789abcdef" for c in source) or not isinstance(job_id, str) or not 1 <= len(job_id) <= 16 or not job_id.isascii() or not job_id.isdigit() or not 0 < int(job_id) <= 9007199254740991:
            raise search_error(422, "invalid_search_form", "Index identity is required")
        try:
            cached_index = await embedding_cache.get(IndexKey(galleryId, modelVersion, source, int(job_id)), load_cached_index)
        except CacheCapacityError as error:
            raise search_error(503, "cache_capacity", "Index exceeds cache capacity") from error
        records = []
    if selfie.size is not None and selfie.size > MAX_IMAGE_BYTES:
        raise search_error(413, "selfie_too_large", "Selfie image is too large")
    try:
        payload = await selfie.read(MAX_IMAGE_BYTES + 1)
        if len(payload) > MAX_IMAGE_BYTES:
            raise search_error(413, "selfie_too_large", "Selfie image is too large")
        image = await asyncio.to_thread(decode_image, payload)
    except (ValueError, OSError, UnidentifiedImageError, Image.DecompressionBombError) as error:
        raise search_error(422, "invalid_selfie", "Invalid selfie image") from error
    async with inference_semaphore:
        selfie_face = largest_face(await asyncio.to_thread(recognizer.get, image, selfie=True))
    if selfie_face is None:
        raise search_error(422, "no_face", "No face found in the selfie")
    query = np.asarray(normalized_embedding(selfie_face), dtype=np.float32)
    threshold = sensitivity_threshold(sensitivity)
    if cached_index is not None:
        matches = await asyncio.to_thread(cached_index.match, query, threshold)
        total = cached_index.total
    else:
        matches = await asyncio.to_thread(match_records, query, records, threshold)
        total = len({str(record.get('driveFileId')) for record in records})
    return {"status": "complete", "galleryId": galleryId, "total": total, "matches": matches}


def validate_records(records: Any) -> None:
    if not isinstance(records, list):
        raise search_error(400, "invalid_embeddings", "Embeddings must be a list")
    if len(records) > MAX_EMBEDDING_RECORDS:
        raise search_error(413, "too_many_embeddings", "Too many embeddings")
    if any(not isinstance(record, dict) for record in records):
        raise search_error(400, "invalid_embeddings", "Invalid embedding record")


async def load_cached_index(key: IndexKey) -> PreparedIndex:
    try:
        origin, token = callback_config()
        url = f"{origin}/api/internal/face-index/indexes/{key.completed_job_id}"
        async with callback_client().stream("GET", url, headers={"x-face-worker-token": token}) as response:
            if response.status_code in (404, 409):
                raise search_error(409, "index_changed", "Index changed")
            response.raise_for_status()
            payload = bytearray()
            async for chunk in response.aiter_bytes():
                if len(payload) + len(chunk) > MAX_EMBEDDING_JSON_BYTES:
                    raise search_error(413, "embeddings_too_large", "Embeddings payload is too large")
                payload.extend(chunk)
        snapshot = json.loads(payload)
        if not isinstance(snapshot, dict) or (snapshot.get("galleryId"), snapshot.get("modelVersion"), snapshot.get("sourceVersion"), snapshot.get("completedJobId")) != (key.gallery_id, key.model_version, key.source_version, key.completed_job_id):
            raise search_error(409, "index_changed", "Index identity does not match")
        records = snapshot.get("embeddings")
        validate_records(records)
        result = await asyncio.to_thread(prepare_index, records)
        logger.info("Face cache transfer bytes=%s records=%s", len(payload), len(records))
        return result
    except (httpx.HTTPError, ValueError, RuntimeError) as error:
        logger.warning("Face cache load failed code=index_unavailable")
        raise search_error(503, "index_unavailable", "Index is temporarily unavailable") from error
