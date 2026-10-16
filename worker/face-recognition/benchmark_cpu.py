"""Offline CPU benchmark: production indexing/search, or paired synthetic A/B.

No .env loading, real network requests, database writes or persisted embeddings.
"""
from __future__ import annotations

import argparse
import asyncio
import csv
import hashlib
import json
import logging
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np
from benchmark_metrics import accuracy_metrics, distribution, memory_usage, runtime_metadata


def resources(start_wall, start_cpu):
    wall, cpu = time.perf_counter() - start_wall, time.process_time() - start_cpu
    return {"wall_seconds": wall, "cpu_seconds": cpu,
            "cpu_percent_one_core": cpu / wall * 100 if wall else 0, **memory_usage()}


def micro_benchmark(args):
    import main
    from embedding_cache import prepare_index
    from engine import Face, sensitivity_threshold
    rng = np.random.default_rng(20261016)
    query = rng.normal(size=128).astype(np.float32)
    query /= np.linalg.norm(query)
    cases = []
    for count in (3000, 10000, 50000):
        for density in (.02, 1.0):
            vectors = rng.normal(size=(count, 128)).astype(np.float32)
            vectors[:int(count * density)] = query
            vectors /= np.linalg.norm(vectors, axis=1, keepdims=True)
            index = prepare_index([{"driveFileId": str(i // 2), "embedding": vector,
                                    "isSolo": False} for i, vector in enumerate(vectors)])
            baseline = index.match(query, sensitivity_threshold("balanced"))
            assert baseline == index.match(query, sensitivity_threshold("balanced"), candidate_filter=True)
            for repeat in range(args.repeat):
                for enabled in ((False, True) if repeat % 2 == 0 else (True, False)):
                    timings = []
                    start_wall, start_cpu = time.perf_counter(), time.process_time()
                    for _ in range(args.samples):
                        started = time.perf_counter()
                        result = index.match(query, sensitivity_threshold("balanced"), candidate_filter=enabled)
                        timings.append((time.perf_counter() - started) * 1000)
                        assert result == baseline
                    cases.append({"workload": "cached_match", "variant": "candidate" if enabled else "baseline",
                                  "records": count, "density": density, "repeat": repeat + 1,
                                  "exact_parity": True, **distribution(timings),
                                  "operations_per_second": len(timings) / (sum(timings) / 1000),
                                  **resources(start_wall, start_cpu)})
    faces = [Face(np.array([0, 0, 10, 10]), rng.normal(size=128).astype(np.float32)) for _ in range(100)]
    photo = main.PhotoInput(driveFileId="synthetic")
    expected = main.photo_face_payloads(faces, photo)
    for repeat in range(args.repeat):
        for enabled in ((False, True) if repeat % 2 == 0 else (True, False)):
            timings = []
            start_wall, start_cpu = time.perf_counter(), time.process_time()
            for _ in range(args.samples):
                started = time.perf_counter()
                result = main.photo_face_payloads(faces, photo, normalize_once=enabled)
                timings.append((time.perf_counter() - started) * 1000)
                assert result == expected
            cases.append({"workload": "serialize_100_faces", "variant": "candidate" if enabled else "baseline",
                          "repeat": repeat + 1, "exact_parity": True, **distribution(timings),
                          "operations_per_second": len(timings) / (sum(timings) / 1000),
                          **resources(start_wall, start_cpu)})
    return {"workload": "synthetic_micro", "accuracy": "NOT MEASURED",
            "note": "No model inference or Drive. Synthetic match/serialization parity only.", "cases": cases}


def load_manifest(path, media_root=None):
    manifest = json.loads(path.read_text(encoding="utf-8"))
    root = (media_root or path.parent).resolve()
    if not manifest.get("photos") or not manifest.get("queries"):
        raise ValueError("Manifest requires nonempty photos and queries")
    fingerprint = hashlib.sha256()
    for kind in ("photos", "queries"):
        seen = set()
        for item in manifest[kind]:
            if not isinstance(item.get("id"), str) or item["id"] in seen:
                raise ValueError("Manifest IDs must be unique strings within each collection")
            seen.add(item["id"])
            media = (root / item["path"]).resolve()
            media.relative_to(root)
            if not media.is_file():
                raise ValueError("Manifest media file is missing")
            with media.open("rb") as source:
                fingerprint.update(hashlib.file_digest(source, "sha256").digest())
            item["resolved_path"] = media
            if manifest.get("labeled"):
                if kind == "photos":
                    if not isinstance(item.get("faces"), list) or not isinstance(item.get("person_count"), int) or item["person_count"] < 0:
                        raise ValueError("Labeled photos require faces and person_count")
                    for face in item["faces"]:
                        if not isinstance(face.get("identity"), str) or len(face.get("bbox", [])) != 4:
                            raise ValueError("Faces require identity and decoded-coordinate xywh bbox")
                        box = np.asarray(face["bbox"], dtype=float)
                        if not np.isfinite(box).all() or min(box[2:]) <= 0:
                            raise ValueError("Face boxes must have finite coordinates and positive dimensions")
                elif "identity" not in item or item["identity"] is not None and not isinstance(item["identity"], str):
                    raise ValueError("Labeled queries require identity (null for unknown)")
    # Includes evaluation labels/order/config without exposing their values in reports.
    fingerprint.update(path.read_bytes())
    return manifest, fingerprint.hexdigest()


class MetricCapture(logging.Handler):
    def __init__(self):
        super().__init__()
        self.rows = []

    def emit(self, record):
        text = record.getMessage()
        if text.startswith("Face metrics "):
            self.rows.append(json.loads(text[len("Face metrics "):]))


async def cpu_benchmark(args):
    import httpx
    import main
    import telemetry
    from embedding_cache import EmbeddingCache
    from engine import FaceEngine, MODEL_VERSION
    manifest, fingerprint = load_manifest(args.manifest, args.media_root)
    capture = MetricCapture()
    logger = logging.getLogger("orbit-face-worker")
    # Keep only sanitized aggregate telemetry; library URLs and photo IDs stay off stdout.
    logger.handlers = [capture]
    logger.propagate = False
    logger.setLevel(logging.INFO)
    telemetry.ENABLED = True
    main.MATCH_CANDIDATE_FILTER = args.variant == "candidate"
    main.NORMALIZE_ONCE = args.variant == "candidate"
    main.PHOTO_CONCURRENCY = args.photo_concurrency
    started = time.perf_counter()
    engine = FaceEngine(main.MODEL_DIR, args.threads)
    startup_ms = (time.perf_counter() - started) * 1000
    main.face_app, main.model_state = engine, "ready"
    last_query_vector = None
    original_get = engine.get

    def capture_query(image, *, selfie=False):
        nonlocal last_query_vector
        faces = original_get(image, selfie=selfie)
        if selfie:
            face = main.largest_face(faces)
            last_query_vector = np.asarray(main.normalized_embedding(face), dtype=np.float32) if face is not None else None
        return faces

    engine.get = capture_query
    main.WORKER_TOKEN = "offline-benchmark"
    main.CALLBACK_ORIGIN, main.CALLBACK_TOKEN = "http://offline.invalid", "offline"
    paths = {p["id"]: p["resolved_path"] for p in manifest["photos"]}
    completed = None

    async def local_fetch(job, photo):
        return await asyncio.to_thread(paths[photo.driveFileId].read_bytes)

    async def callback(job, route, payload):
        nonlocal completed
        if route.endswith("/complete"):
            completed = payload
        elif route.endswith("/fail"):
            completed = None

    main.fetch_photo, main.callback = local_fetch, callback
    # Warm one representative frame beyond the engine's fixed-size startup warmup.
    image = main.decode_image(next(iter(paths.values())).read_bytes())
    warm_started = time.perf_counter()
    warm_faces = engine.get(image)
    if len(warm_faces) == 1:
        engine.count_people(image)
    warmup_ms = (time.perf_counter() - warm_started) * 1000
    runs = []
    reference = None
    for repeat in range(args.repeat):
        completed = None
        capture.rows.clear()
        wall, cpu = time.perf_counter(), time.process_time()
        await main.process_index_job(main.IndexJobInput(
            jobId=repeat + 1, galleryId=1, modelVersion=MODEL_VERSION, sourceVersion="a" * 64,
            photos=[main.PhotoInput(driveFileId=photo["id"], sourceVersion="local") for photo in manifest["photos"]]))
        usage = resources(wall, cpu)
        index_rows = [row for row in capture.rows if row.get("workload") == "index_photo"]
        stages = {key: distribution([row[key] for row in index_rows if key in row])
                  for key in sorted({k for row in index_rows for k in row if k.endswith("_ms")})}
        result = {"repeat": repeat + 1, "variant": args.variant, "index_stages": stages,
                  "index_resources": usage, "index_errors": sum(row["status"] != "complete" for row in index_rows),
                  "index_complete": completed is not None,
                  "photos_per_second": len(paths) / usage["wall_seconds"] if completed is not None else None}
        if completed is None:
            result["accuracy"] = {"status": "NOT MEASURED", "reason": "index failed"}
            runs.append(result)
            continue
        solo = {p["driveFileId"]: p["isSolo"] for p in completed["indexedPhotos"]}
        records = [{**r, "isSolo": solo[r["driveFileId"]]} for r in completed["embeddings"]]
        snapshot = {"galleryId": 1, "modelVersion": MODEL_VERSION, "sourceVersion": "a" * 64,
                    "completedJobId": repeat + 1, "soloMetadata": True, "embeddings": records}
        transferred = 0

        def snapshot_callback(request):
            nonlocal transferred
            response = httpx.Response(200, json=snapshot)
            transferred += len(response.content)
            return response

        main.embedding_cache = EmbeddingCache(main.CACHE_MAX_BYTES, main.CACHE_MAX_ENTRIES, main.CACHE_TTL_SECONDS)
        ranked, query_vectors, search_rows, failures = {}, {}, {"cold": [], "warm": []}, 0
        search_wall, search_cpu = time.perf_counter(), time.process_time()
        async with httpx.AsyncClient(transport=httpx.MockTransport(snapshot_callback)) as backend:
            main.http_client = backend
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://offline.invalid",
                                         headers={"Authorization": "Bearer offline-benchmark"}) as client:
                for query in manifest["queries"]:
                    payload = query["resolved_path"].read_bytes()
                    for mode in ("cold", "warm"):
                        if mode == "cold":
                            await main.embedding_cache.close()
                        start = time.perf_counter()
                        response = await client.post("/v1/search", data={"galleryId": "1", "modelVersion": MODEL_VERSION,
                            "sourceVersion": "a" * 64, "completedJobId": str(repeat + 1), "sensitivity": "balanced", "soloOnly": "false"},
                            files={"selfie": ("benchmark.jpg", payload, "image/jpeg")})
                        search_rows[mode].append((time.perf_counter() - start) * 1000)
                        if response.status_code == 200:
                            ranked[query["id"]] = [match["driveFileId"] for match in response.json()["matches"]]
                            query_vectors[query["id"]] = last_query_vector
                        else:
                            failures += 1
                            ranked[query["id"]] = []
        await main.embedding_cache.close()
        search_metrics = [row for row in capture.rows if row.get("workload") == "search"]
        result.update({"search": {mode: {**distribution(values), "requests_per_second": len(values) / (sum(values) / 1000)}
                                  for mode, values in search_rows.items()},
                       "search_resources": resources(search_wall, search_cpu),
                       "search_stages": {key: distribution([row[key] for row in search_metrics if key in row])
                                         for key in sorted({key for row in search_metrics for key in row if key.endswith("_ms")})},
                       "search_errors": failures, "snapshot_bytes": transferred,
                       "faces": len(records), "accuracy": accuracy_metrics(manifest, records, ranked, completed["indexedPhotos"], query_vectors)})
        # Compare repeated results in memory only. Never persist embeddings or IDs.
        canonical = sorted(completed["embeddings"], key=lambda r: (r["driveFileId"], r["faceIndex"]))
        current = (canonical, ranked, sorted(solo.items()))
        result["repeat_exact_parity"] = reference is None or current == reference
        if reference is None:
            reference = current
        runs.append(result)
    return {"workload": "offline_production_pipeline", "dataset_sha256": fingerprint,
            "model_startup_ms": startup_ms, "representative_warmup_ms": warmup_ms,
            "configuration": {"jobs": 1, "photo_concurrency": args.photo_concurrency, "opencv_threads": args.threads},
            "note": "Local disk + mocked HTTP snapshot/complete callback. No Drive, Hono, DB write or concurrent query load.",
            "runs": runs}


def write_report(report, output):
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    rows = []

    def flatten(value, prefix=""):
        if isinstance(value, dict):
            for key, item in value.items():
                flatten(item, f"{prefix}.{key}" if prefix else key)
        elif isinstance(value, list):
            for i, item in enumerate(value):
                flatten(item, f"{prefix}.{i}")
        elif not prefix.startswith("runtime."):
            rows.append((prefix, value))

    flatten(report)
    with output.with_suffix(".csv").open("w", encoding="utf-8", newline="") as target:
        writer = csv.writer(target)
        writer.writerow(("metric", "value"))
        writer.writerows(rows)


def cli():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--micro", action="store_true")
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--media-root", type=Path, help="Local media root; default manifest directory")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--repeat", type=int, default=3)
    parser.add_argument("--samples", type=int, default=20)
    parser.add_argument("--variant", choices=("baseline", "candidate"), default="baseline")
    parser.add_argument("--photo-concurrency", type=int, choices=(1, 2, 3), default=3)
    parser.add_argument("--threads", type=int, choices=(1, 2), default=2)
    args = parser.parse_args()
    if args.micro == bool(args.manifest) or args.repeat < 3 or args.samples < 1:
        parser.error("Choose --micro OR --manifest; use repeat >= 3 and samples >= 1")
    report = micro_benchmark(args) if args.micro else asyncio.run(cpu_benchmark(args))
    report["runtime"] = runtime_metadata()
    report["arm_production_performance"] = "NOT MEASURED" if report["runtime"]["architecture"].lower() not in {"aarch64", "arm64"} else "Requires confirming 2-vCPU/12-GB host and service-equivalent settings"
    write_report(report, args.output)
    print(json.dumps({"workload": report["workload"], "report_written": True, "arm_production_performance": report["arm_production_performance"]}))


if __name__ == "__main__":
    cli()
