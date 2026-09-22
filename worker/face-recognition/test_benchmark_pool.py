import asyncio
from concurrent.futures import ThreadPoolExecutor
from threading import Event, Lock
import time
import unittest
from unittest.mock import AsyncMock, Mock

from benchmark_pool import BenchmarkPool
from load_test import matches_reference, rank_candidates, stop_process, summarize


class Engine:
    def __init__(self):
        self.lock = Lock()

    def get(self, image, **kwargs):
        if not self.lock.acquire(blocking=False):
            raise AssertionError("Engine used concurrently")
        try:
            time.sleep(.01)
            if image == "error":
                raise ValueError("inference failed")
            return image
        finally:
            self.lock.release()


class PoolTests(unittest.TestCase):
    def test_exclusive_engines_and_metrics(self):
        pool = BenchmarkPool([Engine(), Engine()])
        with ThreadPoolExecutor(max_workers=8) as executor:
            self.assertEqual(list(executor.map(pool.get, range(32))), list(range(32)))
        stats = pool.snapshot()
        self.assertEqual(stats["inferences"], 32)
        self.assertEqual(stats["nativeActive"], 0)
        self.assertEqual(stats["peakNativeActive"], 2)
        self.assertGreater(stats["waitSeconds"], 0)

    def test_failure_releases_slot(self):
        pool = BenchmarkPool([Engine()])
        with self.assertRaises(ValueError):
            pool.get("error")
        self.assertEqual(pool.get("ok"), "ok")
        self.assertEqual(pool.available.qsize(), 1)

    def test_reference_checks_ids_order_and_distance(self):
        ref = [{"driveFileId": "a", "distance": .1}, {"driveFileId": "b", "distance": .2}]
        self.assertTrue(matches_reference(ref, ref))
        self.assertTrue(matches_reference([{**ref[0], "distance": .100001}, ref[1]], ref))
        self.assertFalse(matches_reference(ref[::-1], ref))
        self.assertFalse(matches_reference([{**ref[0], "distance": .11}, ref[1]], ref))
        self.assertFalse(matches_reference([{**ref[0], "distance": float("nan")}, ref[1]], ref))

    def test_summary_keeps_failures(self):
        runs = [{"instances": 1, "cpuThreads": 2, "stages": [{"concurrency": 100, "cache": "warm",
                 "statuses": {"200": n, "timeout": 100-n}, "successP95Seconds": p95}]}
                for n, p95 in [(70, 28), (80, 29), (75, 30)]]
        summary = summarize(runs)[0]
        self.assertEqual(summary["statuses"], {"200": 225, "timeout": 75})
        self.assertEqual(summary["successP95Seconds"], {"median": 29, "min": 28, "max": 30})

    def test_ranking_prefers_success_then_smaller_near_tie(self):
        runs = [{"instances": n, "cpuThreads": 1, "stages": [{"concurrency": 100, "cache": "warm",
                 "statuses": {"200": successes, "timeout": 100-successes}, "successP95Seconds": p95,
                 "successfulRequestsPerSecond": throughput}]}
                for n, successes, p95, throughput in [(1, 99, 10, 10), (2, 100, 20.5, 5), (4, 100, 20, 5.1)]]
        result = rank_candidates(runs)
        self.assertEqual(result["ranking"][0]["instances"], 4)
        self.assertEqual(result["candidate"]["instances"], 2)


class CancellationTests(unittest.IsolatedAsyncioTestCase):
    async def test_waiting_for_slot_does_not_block_executor(self):
        pool = BenchmarkPool([Engine()])
        async with pool:
            tasks = []
            async def waiting():
                async with pool:
                    return await asyncio.to_thread(pool.get, "ok")
            for _ in range(100):
                tasks.append(asyncio.create_task(waiting()))
            await asyncio.sleep(.01)
            self.assertEqual(await asyncio.wait_for(asyncio.to_thread(lambda: 42), 1), 42)
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
        async with pool:
            self.assertEqual(await asyncio.to_thread(pool.get, "ok"), "ok")

    async def test_error_with_admission_releases_slot(self):
        pool = BenchmarkPool([Engine()])
        with self.assertRaises(ValueError):
            async with pool:
                await asyncio.to_thread(pool.get, "error")
        async with asyncio.timeout(1):
            async with pool:
                self.assertEqual(await asyncio.to_thread(pool.get, "ok"), "ok")

    async def test_cancel_does_not_release_running_native_slot(self):
        entered, release, second_entered = Event(), Event(), Event()

        class BlockingEngine:
            def get(self, image):
                if image == 1:
                    entered.set()
                    if not release.wait(5):
                        raise TimeoutError("Test did not release native call")
                else:
                    second_entered.set()
                return image

        pool = BenchmarkPool([BlockingEngine()])

        async def request(image):
            async with pool:
                return await asyncio.to_thread(pool.get, image)

        first = asyncio.create_task(request(1))
        second = None
        try:
            self.assertTrue(await asyncio.to_thread(entered.wait, 2))
            first.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await first
            second = asyncio.create_task(request(2))
            await asyncio.sleep(.05)
            self.assertFalse(second_entered.is_set())
            self.assertEqual(pool.available.qsize(), 0)
        finally:
            release.set()
            if second:
                self.assertEqual(await asyncio.wait_for(second, 2), 2)
        self.assertEqual(pool.available.qsize(), 1)
        self.assertEqual(pool.snapshot()["inferences"], 2)

    async def test_process_cleanup(self):
        process = Mock(returncode=None, wait=AsyncMock(return_value=0))
        reader = asyncio.create_task(asyncio.sleep(0))
        await stop_process(process, reader)
        process.terminate.assert_called_once()
        process.wait.assert_awaited_once()
        self.assertTrue(reader.done())

    async def test_process_cleanup_kills_unresponsive_child(self):
        process = Mock(returncode=None, wait=AsyncMock(side_effect=[TimeoutError(), 0]))
        await stop_process(process, asyncio.create_task(asyncio.sleep(0)))
        process.kill.assert_called_once()
        self.assertEqual(process.wait.await_count, 2)
