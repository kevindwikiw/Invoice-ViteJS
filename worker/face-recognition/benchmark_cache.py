"""Local transport benchmark: real OpenCV, synthetic repeated index, no database."""
import argparse
import asyncio
import json
import statistics
import time
from pathlib import Path

import httpx

import main
from embedding_cache import EmbeddingCache
from engine import FaceEngine, MODEL_VERSION


async def benchmark(image_path: Path, record_count: int) -> None:
    main.face_app = FaceEngine(main.MODEL_DIR, main.INTRA_OP_THREADS)
    main.model_state = "ready"
    main.WORKER_TOKEN = "local-benchmark"
    main.CALLBACK_ORIGIN = "http://benchmark.test"
    main.CALLBACK_TOKEN = "local-callback"
    main.embedding_cache = EmbeddingCache(main.CACHE_MAX_BYTES, main.CACHE_MAX_ENTRIES, main.CACHE_TTL_SECONDS)
    image = image_path.read_bytes()
    face = main.largest_face(main.face_app.get(main.decode_image(image), selfie=True))
    if face is None:
        raise ValueError("No face detected in the evaluation image")
    vector = main.normalized_embedding(face)
    records = [{"driveFileId": f"evaluation-{i}", "embedding": vector} for i in range(record_count)]
    snapshot = {"galleryId": 1, "modelVersion": MODEL_VERSION, "sourceVersion": "a"*64, "completedJobId": 1, "embeddings": records}
    transferred = 0
    def callback(_):
        nonlocal transferred
        response = httpx.Response(200, json=snapshot)
        transferred += len(response.content)
        return response
    async with httpx.AsyncClient(transport=httpx.MockTransport(callback)) as backend:
        main.http_client = backend
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://worker.test", headers={"Authorization": "Bearer local-benchmark"}) as client:
            fields = {"galleryId": "1", "modelVersion": MODEL_VERSION, "sensitivity": "balanced", "sourceVersion": "a"*64, "completedJobId": "1"}
            legacy = client.build_request("POST", "/v1/search", data={"galleryId": "1", "embeddings": json.dumps(records)}, files={"selfie": ("sample.jpg", image, "image/jpeg")})
            times, bytes_per_search = [], []
            for _ in range(4):
                before = transferred
                request = client.build_request("POST", "/v1/search", data=fields, files={"selfie": ("sample.jpg", image, "image/jpeg")})
                started = time.perf_counter()
                response = await client.send(request)
                times.append(round((time.perf_counter() - started) * 1000, 1))
                bytes_per_search.append(transferred - before)
                if response.status_code != 200 or len(response.json()["matches"]) != record_count:
                    raise RuntimeError("Cache search did not produce the expected sample matches")
            print(json.dumps({"realModel": True, "transport": "in-process ASGI + mocked snapshot callback", "syntheticRecords": record_count,
                "coldSearchMs": times[0], "warmMedianMs": statistics.median(times[1:]),
                "snapshotBytesPerSearch": bytes_per_search, "legacyRequestBytes": int(legacy.headers["content-length"]),
                "cachedRequestBytes": int(request.headers["content-length"]), "retainedCacheBytes": main.embedding_cache.byte_size}))
    await main.embedding_cache.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument("--records", type=int, default=900)
    args = parser.parse_args()
    if not 1 <= args.records <= main.MAX_EMBEDDING_RECORDS:
        parser.error("records is outside the configured embedding record limit")
    asyncio.run(benchmark(args.image, args.records))
