"""Benchmark-only model pool; never imported by the production worker."""
from contextvars import ContextVar
import asyncio
from queue import Queue
from threading import Lock
import time


class BenchmarkPool:
    def __init__(self, engines):
        if not engines:
            raise ValueError("At least one engine is required")
        self.available = Queue()
        for engine in engines:
            self.available.put(engine)
        self.started = ContextVar("benchmark_inference_wait", default=None)
        self.lease = ContextVar("benchmark_model_lease", default=None)
        self.admission = asyncio.Semaphore(len(engines))
        self.lock = Lock()
        self.calls = 0
        self.wait_seconds = 0.0
        self.inference_seconds = 0.0
        self.active = 0
        self.peak_active = 0

    async def __aenter__(self):
        self.started.set(time.perf_counter())
        await self.admission.acquire()
        self.lease.set({"state": "pending", "loop": asyncio.get_running_loop()})
        return self

    async def __aexit__(self, *_):
        lease = self.lease.get()
        with self.lock:
            if lease["state"] == "pending":
                lease["state"] = "cancelled"
                self.admission.release()
        self.lease.set(None)
        self.started.set(None)

    def get(self, image, **kwargs):
        queued_at = self.started.get() or time.perf_counter()
        lease = self.lease.get()
        if lease is not None:
            with self.lock:
                if lease["state"] == "cancelled":
                    raise RuntimeError("Benchmark request cancelled before native inference")
                lease["state"] = "running"
        engine = self.available.get()
        started = time.perf_counter()
        with self.lock:
            self.active += 1
            self.peak_active = max(self.peak_active, self.active)
        try:
            return engine.get(image, **kwargs)
        finally:
            # The native thread owns the slot, not the cancellable HTTP task.
            with self.lock:
                self.active -= 1
                self.calls += 1
                self.wait_seconds += started - queued_at
                self.inference_seconds += time.perf_counter() - started
            self.available.put(engine)
            if lease is not None:
                with self.lock:
                    lease["state"] = "done"
                lease["loop"].call_soon_threadsafe(self.admission.release)

    def snapshot(self):
        with self.lock:
            return {"inferences": self.calls, "inferenceSeconds": self.inference_seconds,
                    "waitSeconds": self.wait_seconds, "nativeActive": self.active,
                    "peakNativeActive": self.peak_active}
