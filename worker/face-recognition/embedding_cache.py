from __future__ import annotations

import asyncio
import logging
import sys
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import Awaitable, Callable

import numpy as np

logger = logging.getLogger("orbit-face-worker")


@dataclass(frozen=True)
class IndexKey:
    gallery_id: int
    model_version: str
    source_version: str
    completed_job_id: int


@dataclass(frozen=True)
class PreparedIndex:
    matrix: np.ndarray
    file_ids: tuple[str, ...]
    total: int
    byte_size: int

    def match(self, query: np.ndarray, threshold: float) -> list[dict]:
        if not len(self.file_ids):
            return []
        distances = np.clip(1 - self.matrix @ query, 0, 2)
        best: dict[str, float] = {}
        for file_id, distance in zip(self.file_ids, distances):
            if distance <= threshold and distance < best.get(file_id, float("inf")):
                best[file_id] = float(distance)
        return sorted(({"driveFileId": key, "distance": value} for key, value in best.items()), key=lambda item: item["distance"])


def prepare_index(records: list[dict]) -> PreparedIndex:
    vectors, ids = [], []
    for record in records:
        try:
            vector = np.asarray(record["embedding"], dtype=np.float32)
            file_id = record["driveFileId"]
            if not isinstance(file_id, str) or not file_id or vector.shape != (128,) or not np.isfinite(vector).all():
                continue
            norm = float(np.linalg.norm(vector))
            if norm <= 0:
                continue
            vectors.append(vector / norm)
            ids.append(file_id)
        except (KeyError, TypeError, ValueError):
            continue
    matrix = np.stack(vectors) if vectors else np.empty((0, 128), dtype=np.float32)
    matrix.setflags(write=False)
    file_ids = tuple(ids)
    # Account for retained arrays and identifiers, not only the numeric matrix.
    byte_size = sys.getsizeof(matrix) + sys.getsizeof(file_ids) + sum(sys.getsizeof(value) for value in file_ids) + 512
    return PreparedIndex(matrix, file_ids, len({str(record.get("driveFileId")) for record in records}), byte_size)


class CacheCapacityError(Exception):
    pass


class EmbeddingCache:
    def __init__(self, max_bytes: int, max_entries: int, ttl_seconds: float, clock: Callable[[], float] = time.monotonic):
        self.max_bytes, self.max_entries, self.ttl = max_bytes, max_entries, ttl_seconds
        self.clock = clock
        self.entries: OrderedDict[IndexKey, tuple[PreparedIndex, float]] = OrderedDict()
        self.pending: dict[IndexKey, asyncio.Task[PreparedIndex]] = {}
        self.load_slots = asyncio.Semaphore(2)
        self.byte_size = 0

    def _remove(self, key: IndexKey) -> None:
        entry, _ = self.entries.pop(key)
        self.byte_size -= entry.byte_size

    def expire(self) -> None:
        now = self.clock()
        for key, (_, used) in list(self.entries.items()):
            if now - used >= self.ttl:
                self._remove(key)

    async def get(self, key: IndexKey, loader: Callable[[IndexKey], Awaitable[PreparedIndex]]) -> PreparedIndex:
        self.expire()
        if key in self.entries:
            entry, _ = self.entries.pop(key)
            self.entries[key] = (entry, self.clock())
            logger.info("Face cache hit entries=%s bytes=%s", len(self.entries), self.byte_size)
            return entry
        task = self.pending.get(key)
        if task is None:
            task = asyncio.create_task(self._load(key, loader))
            self.pending[key] = task
            # A cancelled HTTP request must not cancel another caller's load.
            task.add_done_callback(lambda done: None if done.cancelled() else done.exception())
        return await asyncio.shield(task)

    async def _load(self, key: IndexKey, loader: Callable[[IndexKey], Awaitable[PreparedIndex]]) -> PreparedIndex:
        started = time.perf_counter()
        try:
            async with self.load_slots:
                entry = await loader(key)
            if entry.byte_size > self.max_bytes:
                raise CacheCapacityError()
            self.expire()
            while self.entries and (len(self.entries) >= self.max_entries or self.byte_size + entry.byte_size > self.max_bytes):
                self._remove(next(iter(self.entries)))
            self.entries[key] = (entry, self.clock())
            self.byte_size += entry.byte_size
            logger.info("Face cache miss entries=%s bytes=%s load_ms=%.0f", len(self.entries), self.byte_size, (time.perf_counter() - started) * 1000)
            return entry
        finally:
            self.pending.pop(key, None)

    async def close(self) -> None:
        tasks = list(self.pending.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self.entries.clear()
        self.byte_size = 0
