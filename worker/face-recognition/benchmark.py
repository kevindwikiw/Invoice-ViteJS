"""Local, non-persistent inference benchmark. Does not contact the application DB."""

import argparse
import json
import statistics
import time
from pathlib import Path

import numpy as np
import httpx
from dotenv import dotenv_values

from main import decode_image, largest_face, load_face_app_sync, match_records, normalized_embedding
from engine import sensitivity_threshold


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--photos", type=Path, required=True)
    parser.add_argument("--selfie", type=Path, required=True)
    parser.add_argument("--repeat", type=int, default=3)
    parser.add_argument("--worker-url", help="Optional local HTTP smoke test, e.g. http://127.0.0.1:8088")
    args = parser.parse_args()
    paths = sorted(path for path in args.photos.iterdir() if path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"})
    started = time.perf_counter()
    engine = load_face_app_sync()
    warmup_ms = (time.perf_counter() - started) * 1000
    records, durations = [], []
    started = time.perf_counter()
    for index, path in enumerate(paths):
        photo_start = time.perf_counter()
        faces = engine.get(decode_image(path.read_bytes()))
        durations.append((time.perf_counter() - photo_start) * 1000)
        records.extend({"driveFileId": str(index), "embedding": normalized_embedding(face)} for face in faces)
    index_ms = (time.perf_counter() - started) * 1000
    search_durations = []
    payload = args.selfie.read_bytes()
    matches = []
    for _ in range(max(1, args.repeat)):
        started = time.perf_counter()
        face = largest_face(engine.get(decode_image(payload)))
        if face is None:
            raise ValueError("No face detected in benchmark selfie")
        query = np.asarray(normalized_embedding(face), dtype=np.float32)
        matches = match_records(query, records, sensitivity_threshold("balanced"))
        search_durations.append((time.perf_counter() - started) * 1000)
    http_search_ms = None
    if args.worker_url:
        from urllib.parse import urlparse
        from io import BytesIO
        from PIL import Image

        if urlparse(args.worker_url).hostname not in {"127.0.0.1", "localhost"}:
            raise ValueError("HTTP benchmark only accepts a local worker URL")
        token = dotenv_values(Path(__file__).parent / ".env").get("FACE_WORKER_TOKEN", "")
        with httpx.Client(base_url=args.worker_url, headers={"Authorization": f"Bearer {token}"}, timeout=30) as client:
            client.get("/readyz").raise_for_status()
            started = time.perf_counter()
            response = client.post("/v1/search", data={"galleryId": "1", "embeddings": json.dumps(records)}, files={"selfie": ("selfie.jpg", payload)})
            response.raise_for_status()
            http_search_ms = round((time.perf_counter() - started) * 1000)
            assert [m["driveFileId"] for m in response.json()["matches"]] == [m["driveFileId"] for m in matches]
            blank = BytesIO()
            Image.new("RGB", (128, 128)).save(blank, format="JPEG")
            for invalid in (blank.getvalue(), b"invalid image"):
                response = client.post("/v1/search", data={"galleryId": "1", "embeddings": "[]"}, files={"selfie": ("selfie.jpg", invalid)})
                assert response.status_code == 422, response.status_code
    print(json.dumps({
        "photos": len(paths), "faces": len(records), "matching_photos": len(matches),
        "model_load_warmup_ms": round(warmup_ms), "local_index_ms": round(index_ms),
        "photo_median_ms": round(statistics.median(durations)) if durations else 0,
        "warm_search_median_ms": round(statistics.median(search_durations)),
        "local_http_search_ms": http_search_ms,
        "note": "Local disk only; excludes Drive/network/API/database. Not a gallery accuracy benchmark.",
    }, indent=2))


if __name__ == "__main__":
    main()
