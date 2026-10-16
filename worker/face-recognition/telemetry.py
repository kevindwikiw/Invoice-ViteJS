"""Opt-in, request-local timings; never serialize request payloads or exceptions."""
from contextlib import contextmanager
from contextvars import ContextVar
from functools import wraps
import json
import logging
import os
import time

ENABLED = os.getenv("FACE_WORKER_METRICS", "0") == "1"
CURRENT = ContextVar("face_worker_metrics", default=None)
logger = logging.getLogger("orbit-face-worker")
FIELDS = frozenset({"gallery_id", "job_id", "bytes", "width", "height", "faces",
                    "people", "cached", "attempt", "matches", "records", "wait_ms"})


def annotate(**values):
    metrics = CURRENT.get()
    if metrics is not None:
        for key, value in values.items():
            if key in FIELDS and isinstance(value, (int, float, bool)):
                metrics[key] = value


@contextmanager
def measure(stage):
    metrics = CURRENT.get()
    if metrics is None:
        yield
        return
    started = time.perf_counter()
    try:
        yield
    finally:
        metrics[stage] = metrics.get(stage, 0.0) + (time.perf_counter() - started) * 1000


@contextmanager
def observation(workload, *, enabled=None, emit=True):
    if not (ENABLED if enabled is None else enabled):
        yield None
        return
    metrics = {"workload": workload, "status": "complete"}
    token = CURRENT.set(metrics)
    started = time.perf_counter()
    try:
        yield metrics
    except BaseException as error:
        metrics["status"] = "failed"
        metrics["error_category"] = type(error).__name__
        raise
    finally:
        metrics["total_ms"] = (time.perf_counter() - started) * 1000
        CURRENT.reset(token)
        if emit:
            logger.info("Face metrics %s", json.dumps(metrics, separators=(",", ":")))


def observed(workload):
    def decorate(function):
        @wraps(function)
        async def wrapper(*args, **kwargs):
            with observation(workload):
                return await function(*args, **kwargs)
        return wrapper
    return decorate
