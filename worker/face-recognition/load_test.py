"""Isolated localhost HTTP burst test with real inference and a synthetic index."""
from __future__ import annotations

import argparse
import asyncio
from collections import Counter
import json
import logging
import math
import os
from pathlib import Path
import secrets
import socket
import statistics
import sys
import time
from types import SimpleNamespace

import httpx


def memory_usage() -> dict:
    if sys.platform != "win32":
        return {}
    import ctypes
    from ctypes import wintypes
    class Counters(ctypes.Structure):
        _fields_ = [("cb", wintypes.DWORD), ("faults", wintypes.DWORD)] + [
            (name, ctypes.c_size_t) for name in (
                "peak", "current", "peak_paged", "paged", "peak_nonpaged", "nonpaged", "pagefile", "peak_pagefile",
            )
        ]
    counters = Counters()
    counters.cb = ctypes.sizeof(counters)
    read = ctypes.windll.psapi.GetProcessMemoryInfo
    read.argtypes = [wintypes.HANDLE, ctypes.POINTER(Counters), wintypes.DWORD]
    read.restype = wintypes.BOOL
    if not read(wintypes.HANDLE(-1), ctypes.byref(counters), counters.cb):
        return {}
    return {"rssBytes": counters.current, "processPeakRssBytes": counters.peak}


def serve(image_path: Path, records_count: int, instances: int) -> None:
    import uvicorn
    from fastapi import Header
    import main
    from benchmark_pool import BenchmarkPool
    from engine import FaceEngine
    from embedding_cache import prepare_index

    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("orbit-face-worker").setLevel(logging.WARNING)
    main.CALLBACK_ORIGIN = "http://load-test.invalid"
    main.CALLBACK_TOKEN = "isolated-callback"
    metrics = {"active": 0, "completed": 0, "snapshotFetches": 0, "snapshotBytes": 0, "inferences": 0, "inferenceSeconds": 0.0}
    pool = None
    reference = None

    @main.app.on_event("startup")
    async def prepare_fixture():
        nonlocal pool, reference
        await main.get_face_app()
        sample = image_path.read_bytes()
        image = main.decode_image(sample)
        face = main.largest_face(await asyncio.to_thread(main.face_app.get, image, selfie=True))
        if face is None:
            raise ValueError("Evaluation image has no detectable face")
        vector = main.normalized_embedding(face)
        snapshot = {"galleryId": 1, "modelVersion": main.MODEL_VERSION, "sourceVersion": "a" * 64,
                    "completedJobId": 1, "embeddings": [{"driveFileId": f"sample-{i}", "embedding": vector} for i in range(records_count)]}
        snapshot_bytes = json.dumps(snapshot, separators=(",", ":")).encode()
        import numpy as np
        reference = prepare_index(snapshot["embeddings"]).match(np.asarray(vector, dtype=np.float32), .637)
        if len(snapshot_bytes) > main.MAX_EMBEDDING_JSON_BYTES:
            raise ValueError("Synthetic snapshot exceeds configured size limit")
        metrics.update({"imageBytes": len(sample), "decodedWidth": image.shape[1], "decodedHeight": image.shape[0],
                        "model": main.MODEL_VERSION, "threads": main.INTRA_OP_THREADS, "instances": instances})
        def callback(_):
            metrics["snapshotFetches"] += 1
            metrics["snapshotBytes"] += len(snapshot_bytes)
            return httpx.Response(200, content=snapshot_bytes, headers={"Content-Type": "application/json"})
        await main.http_client.aclose()
        main.http_client = httpx.AsyncClient(transport=httpx.MockTransport(callback))
        engines = [main.face_app]
        for _ in range(instances - 1):
            engines.append(await asyncio.to_thread(FaceEngine, main.MODEL_DIR, main.INTRA_OP_THREADS))
        for engine in engines:
            await asyncio.to_thread(engine.get, image, selfie=True)
        pool = BenchmarkPool(engines)
        main.face_app = pool
        main.inference_semaphore = pool

    @main.app.middleware("http")
    async def count_searches(request, call_next):
        if request.url.path != "/v1/search":
            return await call_next(request)
        metrics["active"] += 1
        try:
            return await call_next(request)
        finally:
            metrics["active"] -= 1
            metrics["completed"] += 1

    @main.app.get("/__load_test/metrics")
    async def get_metrics(authorization: str | None = Header(default=None)):
        main.require_worker_token(authorization)
        return {**metrics, **pool.snapshot(), **memory_usage(), "cpuSeconds": time.process_time(), "cacheBytes": main.embedding_cache.byte_size}

    @main.app.get("/__load_test/reference")
    async def get_reference(authorization: str | None = Header(default=None)):
        main.require_worker_token(authorization)
        return {"matches": reference}

    @main.app.post("/__load_test/reset")
    async def reset(authorization: str | None = Header(default=None)):
        main.require_worker_token(authorization)
        if metrics["active"] or pool.snapshot()["nativeActive"]:
            return main.JSONResponse({"error": "requests still active"}, status_code=409)
        await main.embedding_cache.close()
        return {"ok": True}

    # Bind once and pass the socket to Uvicorn; never replace an existing worker.
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        print(f"LOAD_TEST_PORT={sock.getsockname()[1]}", flush=True)
        config = uvicorn.Config(main.app, workers=1, access_log=False, log_level="error")
        uvicorn.Server(config).run(sockets=[sock])


def percentile(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    return sorted(values)[max(0, math.ceil(len(values) * fraction) - 1)]


async def run(args) -> dict:
    token = secrets.token_urlsafe(32)
    env = {key: value for key, value in os.environ.items() if not key.startswith("FACE_WORKER_")}
    env.update({"FACE_WORKER_TOKEN": token, "FACE_WORKER_INTRA_OP_THREADS": str(args.threads), "LOG_LEVEL": "WARNING"})
    process = await asyncio.create_subprocess_exec(
        sys.executable, "-B", str(Path(__file__).resolve()), "--serve", "--image", str(args.image.resolve()),
        "--records", str(args.records), "--instances", str(args.instances), "--threads", str(args.threads),
        env=env, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
    )
    ready = asyncio.Future()
    async def read_output():
        async for raw in process.stdout:
            line = raw.decode(errors="replace").strip()
            if line.startswith("LOAD_TEST_PORT=") and not ready.done():
                ready.set_result(int(line.partition("=")[2]))
        if not ready.done():
            ready.set_exception(RuntimeError("Test worker exited before binding"))
    reader = asyncio.create_task(read_output())
    try:
        port = await asyncio.wait_for(ready, 30)
        async with httpx.AsyncClient(base_url=f"http://127.0.0.1:{port}", headers={"Authorization": f"Bearer {token}"},
                                     timeout=5, trust_env=False) as control:
            for _ in range(120):
                if process.returncode is not None:
                    raise RuntimeError("Test worker startup failed")
                try:
                    response = await control.get("/readyz")
                    if response.status_code == 200:
                        break
                except httpx.HTTPError:
                    pass
                await asyncio.sleep(.25)
            else:
                raise RuntimeError("Test worker not ready after 30 seconds")
            initial = (await control.get("/__load_test/metrics")).json()
            if args.reference is None:
                args.reference = (await control.get("/__load_test/reference")).json()["matches"]
            report = {"transport": "localhost HTTP/Uvicorn; mocked snapshot callback; no API/DB/Drive",
                      "pattern": "one simultaneous burst per stage, one gallery, identical selfie; no background indexing",
                      "logicalCpus": os.cpu_count(), "cpuThreads": initial["threads"], "instances": args.instances,
                      "repetition": args.repetition, "records": args.records,
                      "imageBytes": initial["imageBytes"], "decodedDimensions": [initial["decodedWidth"], initial["decodedHeight"]],
                      "deadlineSeconds": args.deadline, "stages": []}
            print(json.dumps({key: value for key, value in report.items() if key != "stages"}), flush=True)
            payload = args.image.read_bytes()
            for count in args.concurrency:
                for mode in ("cold", "warm"):
                    if mode == "cold":
                        (await control.post("/__load_test/reset")).raise_for_status()
                    before = (await control.get("/__load_test/metrics")).json()
                    gate = asyncio.Event()
                    async with httpx.AsyncClient(base_url=f"http://127.0.0.1:{port}", headers={"Authorization": f"Bearer {token}"},
                                                 limits=httpx.Limits(max_connections=count, max_keepalive_connections=count),
                                                 timeout=args.deadline, trust_env=False) as client:
                        async def search():
                            await gate.wait()
                            started = time.perf_counter()
                            status = "error"
                            try:
                                async with asyncio.timeout(args.deadline):
                                    response = await client.post("/v1/search", data={"galleryId": "1", "modelVersion": initial["model"],
                                        "sourceVersion": "a" * 64, "completedJobId": "1", "sensitivity": "balanced"},
                                        files={"selfie": ("evaluation.jpg", payload, "image/jpeg")})
                                    status = str(response.status_code)
                                    if response.status_code == 200 and not matches_reference(response.json().get("matches", []), args.reference):
                                        status = "wrong_result"
                            except (TimeoutError, httpx.TimeoutException):
                                status = "timeout"
                            except httpx.HTTPError:
                                status = "network_error"
                            return status, time.perf_counter() - started
                        tasks = [asyncio.create_task(search()) for _ in range(count)]
                        stage_started = time.perf_counter()
                        gate.set()
                        results = await asyncio.gather(*tasks)
                        burst_seconds = time.perf_counter() - stage_started
                    # Disconnected HTTP clients can leave inference running.
                    # Drain before resetting the cache or starting another burst.
                    for _ in range(240):
                        after = (await control.get("/__load_test/metrics")).json()
                        if after["active"] == 0 and after["nativeActive"] == 0 and after["inferences"] - before["inferences"] == count:
                            break
                        await asyncio.sleep(.5)
                    else:
                        raise RuntimeError("Worker did not drain; stopping test")
                    elapsed = time.perf_counter() - stage_started
                    statuses = Counter(status for status, _ in results)
                    latencies = [seconds for status, seconds in results if status == "200"]
                    stage = {"concurrency": count, "cache": mode, "statuses": dict(statuses),
                             "successP50Seconds": round(statistics.median(latencies), 3) if latencies else None,
                             "successP95Seconds": round(percentile(latencies, .95), 3) if latencies else None,
                             "maxObservedSeconds": round(max(seconds for _, seconds in results), 3),
                             "burstSeconds": round(burst_seconds, 3), "drainSeconds": round(elapsed - burst_seconds, 3),
                             "successfulRequestsPerSecond": round(statuses["200"] / burst_seconds, 2),
                             "snapshotFetches": after["snapshotFetches"] - before["snapshotFetches"],
                             "snapshotBytes": after["snapshotBytes"] - before["snapshotBytes"],
                             "cpuCoreEquivalent": round((after["cpuSeconds"] - before["cpuSeconds"]) / elapsed, 2),
                             "inferences": after["inferences"] - before["inferences"],
                             "inferenceMeanMs": round(1000 * (after["inferenceSeconds"] - before["inferenceSeconds"]) / max(1, after["inferences"] - before["inferences"]), 1),
                             "waitMeanMs": round(1000 * (after["waitSeconds"] - before["waitSeconds"]) / max(1, after["inferences"] - before["inferences"]), 1),
                             "peakNativeActive": after["peakNativeActive"],
                             "cacheBytes": after["cacheBytes"], **{key: after[key] for key in ("rssBytes", "processPeakRssBytes") if key in after}}
                    report["stages"].append(stage)
                    print(json.dumps(stage), flush=True)
            return report
    finally:
        await stop_process(process, reader)


async def stop_process(process, reader):
    if process.returncode is None:
        process.terminate()
    try:
        await asyncio.wait_for(process.wait(), 10)
    except TimeoutError:
        process.kill()
        await process.wait()
    await reader


def matches_reference(matches, reference):
    return len(matches) == len(reference) and all(
        actual.get("driveFileId") == expected.get("driveFileId")
        and isinstance(actual.get("distance"), (int, float))
        and abs(actual["distance"] - expected["distance"]) <= 1e-5
        for actual, expected in zip(matches, reference)
    )


def summarize(runs):
    groups = {}
    for run_result in runs:
        key = (run_result["instances"], run_result["cpuThreads"])
        for stage in run_result["stages"]:
            groups.setdefault((*key, stage["concurrency"], stage["cache"]), []).append(stage)
    summaries = []
    for (instances, threads, concurrency, cache), stages in groups.items():
        summary = {"instances": instances, "threads": threads, "concurrency": concurrency, "cache": cache,
                   "statuses": dict(sum((Counter(stage["statuses"]) for stage in stages), Counter())), "repetitions": len(stages)}
        for field in ("successP50Seconds", "successP95Seconds", "successfulRequestsPerSecond", "inferenceMeanMs",
                      "waitMeanMs", "cpuCoreEquivalent", "processPeakRssBytes", "drainSeconds", "snapshotBytes"):
            values = [stage[field] for stage in stages if stage.get(field) is not None]
            if values:
                summary[field] = {"median": statistics.median(values), "min": min(values), "max": max(values)}
        summaries.append(summary)
    return summaries


def rank_candidates(runs):
    groups = {}
    for run_result in runs:
        key = (run_result["instances"], run_result["cpuThreads"])
        for stage in run_result["stages"]:
            if stage["concurrency"] == 100:
                groups.setdefault(key, []).append(stage)
    ranking = []
    for (instances, threads), stages in groups.items():
        statuses = sum((Counter(stage["statuses"]) for stage in stages), Counter())
        p95 = [stage["successP95Seconds"] for stage in stages if stage["successP95Seconds"] is not None]
        if statuses["wrong_result"] or not p95:
            continue
        ranking.append({"instances": instances, "threads": threads, "successes": statuses["200"],
                        "requests": sum(statuses.values()), "statuses": dict(statuses),
                        "p95MedianSeconds": statistics.median(p95),
                        "throughputMedian": statistics.median(stage["successfulRequestsPerSecond"] for stage in stages)})
    ranking.sort(key=lambda item: (-item["successes"], item["p95MedianSeconds"], -item["throughputMedian"]))
    if not ranking:
        return {"ranking": [], "candidate": None}
    best = ranking[0]
    tied = [item for item in ranking if item["requests"] == best["requests"] and item["successes"] == best["successes"]
            and item["p95MedianSeconds"] <= best["p95MedianSeconds"] * 1.05
            and item["throughputMedian"] >= best["throughputMedian"] * .95]
    return {"ranking": ranking, "candidate": min(tied, key=lambda item: (item["instances"], item["threads"]))}


async def experiment(args):
    configurations = [(1, 2), (1, 1), (2, 1), (2, 2), (4, 1), (4, 2)] if args.matrix else [(args.instances, args.threads)]
    result = {"runs": [], "summary": [], "complete": False}
    reference = None
    try:
        for repetition in range(1, args.repeats + 1):
            offset = (repetition - 1) * 2 % len(configurations)
            for instances, threads in configurations[offset:] + configurations[:offset]:
                case = SimpleNamespace(**{**vars(args), "instances": instances, "threads": threads,
                                          "repetition": repetition, "reference": reference})
                result["runs"].append(await run(case))
                reference = case.reference
                result["summary"] = summarize(result["runs"])
                if args.output:
                    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        result["complete"] = True
        result["decision"] = rank_candidates(result["runs"])
        return result
    finally:
        if args.output:
            args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True, type=Path)
    parser.add_argument("--records", type=int, default=900)
    parser.add_argument("--concurrency", type=int, nargs="+", default=[10, 30, 100])
    parser.add_argument("--deadline", type=float, default=30)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--instances", type=int, choices=[1, 2, 4], default=1)
    parser.add_argument("--threads", type=int, choices=[1, 2], default=2, help="Process-global OpenCV thread setting")
    parser.add_argument("--repeats", type=int, default=1)
    parser.add_argument("--matrix", action="store_true", help="All six configurations, rotating order per repetition")
    parser.add_argument("--serve", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if not args.image.is_file() or not 1 <= args.records <= 10000 or any(not 1 <= n <= 100 for n in args.concurrency) or not 1 <= args.deadline <= 60 or not 1 <= args.repeats <= 10:
        parser.error("Use an existing image, 1-10000 records, concurrency 1-100 and deadline 1-60 seconds")
    if args.serve:
        serve(args.image, args.records, args.instances)
    else:
        asyncio.run(experiment(args))
