"""Aggregate-only benchmark metrics. No identities or media paths in reports."""
import math
import hashlib
import os
from pathlib import Path
import platform
import sys

import numpy as np

SLICES = ("small_face", "profile", "low_light", "backlight", "crowd")


def distribution(values):
    if not values:
        return {"samples": 0, "p50_ms": None, "p95_ms": None}
    ordered = sorted(values)
    return {"samples": len(values), "p50_ms": float(np.median(values)),
            "p95_ms": float(ordered[math.ceil(len(ordered) * .95) - 1])}


def memory_usage():
    if sys.platform == "win32":
        from load_test import memory_usage as windows_memory
        return windows_memory()
    import resource
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return {"processPeakRssBytes": int(peak * (1 if sys.platform == "darwin" else 1024))}


def runtime_metadata():
    import cv2
    from engine import MODEL_VERSION, sensitivity_threshold
    from model_assets import MODELS
    return {
        "platform": platform.system(), "architecture": platform.machine(),
        "python": platform.python_version(), "logical_cpus": os.cpu_count(),
        "affinity": sorted(os.sched_getaffinity(0)) if hasattr(os, "sched_getaffinity") else None,
        "opencv": cv2.__version__, "opencv_threads": cv2.getNumThreads(),
        "numpy": np.__version__, "opencv_build": cv2.getBuildInformation(),
        "numpy_build": np.show_config(mode="dicts"),
        "thread_environment": {key: os.environ.get(key) for key in
                               ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS")},
        "engine_policy": "readNetFromONNX automatic; effective per-net engine not measured",
        "model_version": MODEL_VERSION,
        "model_checksums": {name: checksum for _, name, checksum in MODELS},
        "implementation_sha256": {name: hashlib.sha256((Path(__file__).parent / name).read_bytes()).hexdigest()
                                  for name in ("main.py", "engine.py", "opencv5_models.py", "person_detector.py",
                                               "embedding_cache.py", "telemetry.py", "benchmark_cpu.py", "benchmark_metrics.py")},
        "thresholds": {key: sensitivity_threshold(key) for key in ("strict", "balanced", "wide")},
    }


def iou(a, b):
    x = max(0, min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]))
    y = max(0, min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
    intersection = x * y
    union = a[2] * a[3] + b[2] * b[3] - intersection
    return intersection / union if union > 0 else 0.0


def detection_metrics(photos, records):
    tp = fp = fn = 0
    for photo in photos:
        expected = [face["bbox"] for face in photo["faces"]]
        actual = [[record["boundingBox"][key] for key in ("x", "y", "width", "height")]
                  for record in records if record["driveFileId"] == photo["id"]]
        pairs = sorted(((iou(a, b), i, j) for i, a in enumerate(actual)
                        for j, b in enumerate(expected)), reverse=True)
        used_actual, used_expected = set(), set()
        for overlap, i, j in pairs:
            if overlap >= .5 and i not in used_actual and j not in used_expected:
                used_actual.add(i)
                used_expected.add(j)
        tp += len(used_actual)
        fp += len(actual) - len(used_actual)
        fn += len(expected) - len(used_expected)
    return {"true_positive": tp, "false_positive": fp, "false_negative": fn,
            "recall": tp / (tp + fn) if tp + fn else None}


def retrieval_metrics(queries, ranked, photos, k=5):
    precisions, recalls, at_k_precision, at_k_recall = [], [], [], []
    unknown = false_accept = positive = missed = tp = fp = fn = 0
    for query in queries:
        expected = {photo["id"] for photo in photos if query["identity"] is not None
                    and any(face["identity"] == query["identity"] for face in photo["faces"])}
        returned = ranked.get(query["id"], [])
        found = set(returned)
        tp += len(found & expected)
        fp += len(found - expected)
        fn += len(expected - found)
        precisions.append(len(found & expected) / len(found) if found else 0.0)
        at_k_precision.append(len(set(returned[:k]) & expected) / min(k, len(photos)) if photos else 0.0)
        if expected:
            positive += 1
            missed += not bool(found & expected)
            recalls.append(len(found & expected) / len(expected))
            at_k_recall.append(len(set(returned[:k]) & expected) / len(expected))
        else:
            unknown += 1
            false_accept += bool(found)
    return {"queries": len(queries), "positive_queries": positive, "negative_queries": unknown,
            "photo_true_positive": tp, "photo_false_positive": fp, "photo_false_negative": fn,
            "mean_precision": float(np.mean(precisions)) if precisions else None,
            "mean_recall": float(np.mean(recalls)) if recalls else None,
            f"precision_at_{k}": float(np.mean(at_k_precision)) if at_k_precision else None,
            f"recall_at_{k}": float(np.mean(at_k_recall)) if at_k_recall else None,
            "unknown_false_accept_rate": false_accept / unknown if unknown else None,
            "positive_query_miss_rate": missed / positive if positive else None}


def face_identity_metrics(photos, records, queries, query_vectors):
    from engine import sensitivity_threshold
    assignments = {}
    for photo in photos:
        indexes = [i for i, record in enumerate(records) if record["driveFileId"] == photo["id"]]
        pairs = sorted(((iou([records[i]["boundingBox"][key] for key in ("x", "y", "width", "height")], face["bbox"]), i, j)
                        for i in indexes for j, face in enumerate(photo["faces"])), reverse=True)
        used = set()
        for overlap, i, j in pairs:
            if overlap >= .5 and i not in assignments and j not in used:
                assignments[i] = (photo["id"], j, photo["faces"][j]["identity"])
                used.add(j)
    matrix = np.asarray([record["embedding"] for record in records], dtype=np.float32).reshape(-1, 128)
    if len(matrix):
        matrix = matrix / np.linalg.norm(matrix, axis=1, keepdims=True)
    tp = fp = fn = 0
    for query in queries:
        expected = {(photo["id"], j) for photo in photos for j, face in enumerate(photo["faces"])
                    if query["identity"] is not None and face["identity"] == query["identity"]}
        found = set()
        vector = query_vectors.get(query["id"])
        if vector is not None:
            for i in np.flatnonzero(np.clip(1 - matrix @ vector, 0, 2) <= sensitivity_threshold("balanced")):
                assignment = assignments.get(i)
                if assignment is not None and assignment[:2] in expected:
                    found.add(assignment[:2])
                else:
                    fp += 1
        tp += len(found)
        fn += len(expected - found)
    return {"true_positive": tp, "false_positive": fp, "false_negative": fn}


def accuracy_metrics(manifest, records, ranked, indexed_photos, query_vectors=None):
    if not manifest.get("labeled", False):
        return {"status": "NOT MEASURED", "reason": "unlabeled smoke dataset"}
    photos, queries = manifest["photos"], manifest["queries"]
    solo = {item["driveFileId"]: item["isSolo"] for item in indexed_photos}
    counts = {"true_positive": 0, "false_positive": 0, "true_negative": 0, "false_negative": 0}
    for photo in photos:
        expected, actual = photo["person_count"] == 1, solo.get(photo["id"], False)
        counts[("true_" if actual == expected else "false_") + ("positive" if actual else "negative")] += 1
    return {"status": "MEASURED", "detection": detection_metrics(photos, records),
            "face_identity": face_identity_metrics(photos, records, queries, query_vectors or {}),
            "retrieval": retrieval_metrics(queries, ranked, photos), "solo": counts,
            "slices": {tag: {
                "detection": detection_metrics([p for p in photos if tag in p.get("tags", [])], records),
                "retrieval": retrieval_metrics([q for q in queries if tag in q.get("tags", [])], ranked, photos),
            } for tag in SLICES}}
