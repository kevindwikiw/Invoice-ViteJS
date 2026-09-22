import asyncio
import io
import json
import unittest
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
import numpy as np
from PIL import Image

import main
from embedding_cache import CacheCapacityError, EmbeddingCache, IndexKey, prepare_index
from engine import Face, MODEL_VERSION

KEY = IndexKey(1, MODEL_VERSION, "a" * 64, 1)
VECTOR = [1.0] + [0.0] * 127
RECORDS = [{"driveFileId": "a", "embedding": VECTOR}, {"driveFileId": "a", "embedding": VECTOR}]


class CacheTests(unittest.IsolatedAsyncioTestCase):
    async def test_same_key_singleflight_and_cancellation_does_not_abort_shared_load(self):
        cache = EmbeddingCache(100_000, 16, 900)
        entered, release = asyncio.Event(), asyncio.Event()
        async def load(_):
            entered.set()
            await release.wait()
            return prepare_index(RECORDS)
        loader = AsyncMock(side_effect=load)
        first = asyncio.create_task(cache.get(KEY, loader))
        await entered.wait()
        other = asyncio.create_task(cache.get(KEY, loader))
        first.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await first
        release.set()
        result = await other
        self.assertIs(result, await cache.get(KEY, loader))
        self.assertEqual(loader.await_count, 1)
        self.assertFalse(result.matrix.flags.writeable)
        self.assertEqual(result.match(np.array(VECTOR, dtype=np.float32), .637), [{"driveFileId": "a", "distance": 0.0}])
        await cache.close()

    async def test_at_most_two_fills_and_keys_include_all_version_fields(self):
        cache = EmbeddingCache(1_000_000, 16, 900)
        gate, two = asyncio.Event(), asyncio.Event()
        active = peak = 0
        async def load(_):
            nonlocal active, peak
            active += 1
            peak = max(peak, active)
            if active == 2:
                two.set()
            await gate.wait()
            active -= 1
            return prepare_index([])
        keys = [KEY, replace(KEY, gallery_id=2), replace(KEY, model_version="other"), replace(KEY, source_version="b"*64), replace(KEY, completed_job_id=2)]
        tasks = [asyncio.create_task(cache.get(key, load)) for key in keys]
        await two.wait()
        self.assertEqual(active, 2)
        gate.set()
        await asyncio.gather(*tasks)
        self.assertEqual(peak, 2)
        self.assertEqual(len(cache.entries), 5)
        await cache.close()

    async def test_lru_ttl_memory_limit_and_restart(self):
        now = [0.0]
        item = prepare_index(RECORDS)
        cache = EmbeddingCache(item.byte_size * 2, 2, 10, clock=lambda: now[0])
        loader = AsyncMock(return_value=item)
        second, third = replace(KEY, completed_job_id=2), replace(KEY, completed_job_id=3)
        await cache.get(KEY, loader)
        await cache.get(second, loader)
        await cache.get(KEY, loader)
        await cache.get(third, loader)
        self.assertNotIn(second, cache.entries)
        self.assertEqual(cache.byte_size, item.byte_size * 2)
        now[0] = 9
        await cache.get(KEY, loader)
        now[0] = 11
        cache.expire()
        self.assertIn(KEY, cache.entries)
        self.assertNotIn(third, cache.entries)
        now[0] = 19
        cache.expire()
        self.assertEqual(cache.byte_size, 0)
        tiny = EmbeddingCache(item.byte_size - 1, 2, 10)
        with self.assertRaises(CacheCapacityError):
            await tiny.get(KEY, loader)
        self.assertEqual(tiny.byte_size, 0)
        self.assertFalse(tiny.pending)
        # Memory alone must evict even when the entry-count limit is not reached.
        one = EmbeddingCache(item.byte_size, 16, 10)
        await one.get(KEY, loader)
        await one.get(second, loader)
        self.assertNotIn(KEY, one.entries)
        await one.close()
        self.assertEqual(one.byte_size, 0)
        fresh = EmbeddingCache(item.byte_size, 16, 10)
        count = loader.await_count
        await fresh.get(KEY, loader)
        self.assertEqual(loader.await_count, count + 1)
        await fresh.close()

    async def test_failed_load_is_retryable_and_empty_index_is_cached(self):
        cache = EmbeddingCache(100_000, 2, 10)
        loader = AsyncMock(side_effect=[RuntimeError("callback failed"), prepare_index([])])
        with self.assertRaises(RuntimeError):
            await cache.get(KEY, loader)
        self.assertFalse(cache.entries)
        result = await cache.get(KEY, loader)
        self.assertIs(result, await cache.get(KEY, loader))
        self.assertEqual(result.total, 0)
        self.assertEqual(result.match(np.array(VECTOR), .637), [])
        self.assertEqual(loader.await_count, 2)
        await cache.close()


class CachedSearchTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.calls = 0
        self.snapshot = {"galleryId": 1, "modelVersion": MODEL_VERSION, "sourceVersion": KEY.source_version,
                         "completedJobId": 1, "embeddings": RECORDS}
        self.callback_status = 200
        async def callback(request):
            self.calls += 1
            self.assertEqual(request.headers["x-face-worker-token"], "callback-test")
            return httpx.Response(self.callback_status, json=self.snapshot)
        self.backend = httpx.AsyncClient(transport=httpx.MockTransport(callback))
        self.cache = EmbeddingCache(1_000_000, 16, 900)
        self.patches = [patch.object(main, "WORKER_TOKEN", "test"), patch.object(main, "model_state", "ready"),
            patch.object(main, "face_app", SimpleNamespace(get=lambda _, **kwargs: [Face(np.array([0,0,10,10]), np.array(VECTOR))])),
            patch.object(main, "embedding_cache", self.cache), patch.object(main, "http_client", self.backend),
            patch.object(main, "CALLBACK_ORIGIN", "http://api.test"), patch.object(main, "CALLBACK_TOKEN", "callback-test"),
            patch.object(main, "inference_semaphore", asyncio.Semaphore(1))]
        for p in self.patches:
            p.start()
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://worker.test", headers={"Authorization": "Bearer test"})
        output = io.BytesIO()
        Image.new("RGB", (32,32)).save(output, "JPEG")
        self.selfie = output.getvalue()

    async def asyncTearDown(self):
        await self.cache.close()
        await self.client.aclose()
        await self.backend.aclose()
        for p in reversed(self.patches):
            p.stop()

    async def search(self):
        return await self.client.post("/v1/search", data={"galleryId": "1", "modelVersion": MODEL_VERSION,
            "sourceVersion": KEY.source_version, "completedJobId": "1", "sensitivity": "balanced"},
            files={"selfie": ("selfie.jpg", self.selfie, "image/jpeg")})

    async def test_cold_and_warm_match_legacy_without_another_transfer(self):
        cold, warm = await self.search(), await self.search()
        self.assertEqual(cold.status_code, 200, cold.text)
        self.assertEqual(warm.json(), cold.json())
        self.assertEqual(self.calls, 1)
        legacy = await self.client.post("/v1/search", data={"galleryId":"1", "embeddings":json.dumps(RECORDS)}, files={"selfie":("selfie.jpg",self.selfie,"image/jpeg")})
        self.assertEqual(legacy.json(), cold.json())
        self.assertIn("embedding-cache-v1", (await self.client.get("/readyz")).json()["capabilities"])

    async def test_changed_index_and_callback_failure_are_not_cached(self):
        self.snapshot["completedJobId"] = 2
        self.assertEqual((await self.search()).status_code, 409)
        self.snapshot["completedJobId"] = 1
        self.callback_status = 503
        self.assertEqual((await self.search()).status_code, 503)
        self.callback_status = 409
        self.assertEqual((await self.search()).status_code, 409)
        self.callback_status = 200
        self.assertEqual((await self.search()).status_code, 200)
        self.assertEqual(self.calls, 4)

    async def test_snapshot_limits_and_empty_index(self):
        with patch.object(main, "MAX_EMBEDDING_JSON_BYTES", 1024):
            self.assertEqual((await self.search()).status_code, 413)
        with patch.object(main, "MAX_EMBEDDING_RECORDS", 1):
            self.assertEqual((await self.search()).status_code, 413)
        self.snapshot["embeddings"] = []
        response = await self.search()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["matches"], [])
        count = self.calls
        await self.search()
        self.assertEqual(self.calls, count)


if __name__ == "__main__":
    unittest.main()
