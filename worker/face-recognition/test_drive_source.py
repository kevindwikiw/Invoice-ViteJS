import asyncio
import time
import unittest
from unittest.mock import AsyncMock, patch

import httpx

from drive_source import DriveError, DriveSource, thumbnail_url
import main


class DriveTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.requests = []
        self.issued = 0
        self.handler = lambda request: httpx.Response(200, content=b"image")

        async def transport(request):
            self.requests.append(request)
            if request.url.host == "api.test":
                self.assertEqual(request.url.path, "/api/internal/face-index/drive-token")
                self.assertEqual(request.headers["x-face-worker-token"], "callback-secret")
                self.assertNotIn("authorization", request.headers)
                self.issued += 1
                await asyncio.sleep(0.001)
                return httpx.Response(200, json={"accessToken": f"token-{self.issued}", "expiresAt": (time.time() + 3600) * 1000})
            self.assertNotIn("x-face-worker-token", request.headers)
            self.assertTrue(request.headers["authorization"].startswith("Bearer token-"))
            return self.handler(request)

        self.client = httpx.AsyncClient(transport=httpx.MockTransport(transport))
        self.source = DriveSource(self.client, "https://api.test", "callback-secret", 100)

    async def asyncTearDown(self):
        await self.client.aclose()

    async def test_cold_concurrency_and_warm_token_reuse(self):
        results = await asyncio.gather(*(self.source.fetch(str(i), "https://lh3.googleusercontent.com/image=s220", 1) for i in range(3)))
        self.assertEqual(results, [b"image"] * 3)
        self.assertEqual(self.issued, 1)
        await self.source.fetch("next", "https://lh3.googleusercontent.com/image=s220", 1)
        self.assertEqual(self.issued, 1)

    async def test_expiry_and_401_refresh(self):
        await self.source.token()
        self.source._expires_at = time.time() + 299
        await self.source.token()
        self.assertEqual(self.issued, 2)
        self.handler = lambda r: httpx.Response(401) if r.headers["authorization"] == "Bearer token-2" else httpx.Response(200, content=b"ok")
        self.assertEqual(await self.source.get("https://www.googleapis.com/test", 100), b"ok")
        self.assertEqual(self.issued, 3)
        self.assertEqual(self.requests[-2].url.params["refresh"], "1")

    async def test_stale_thumbnail_refreshes_metadata(self):
        def handler(r):
            if r.url.host == "www.googleapis.com":
                return httpx.Response(200, json={"thumbnailLink": "https://lh3.googleusercontent.com/fresh=s220"})
            return httpx.Response(404) if "stale" in r.url.path else httpx.Response(200, content=b"fresh")
        self.handler = handler
        self.assertEqual(await self.source.fetch("a", "https://lh3.googleusercontent.com/stale=s220", 1), b"fresh")
        self.assertFalse(any("alt=media" in str(r.url) for r in self.requests))

    async def test_missing_thumbnail_uses_bounded_original_directly(self):
        self.handler = lambda r: httpx.Response(200, content=b"original") if "alt" in r.url.params else httpx.Response(200, json={"id": "a"})
        self.assertEqual(await self.source.fetch("a", None, 1), b"original")
        self.assertEqual(self.requests[-1].url.host, "www.googleapis.com")

    async def test_oversized_original_and_thumbnail_rejected(self):
        self.handler = lambda r: httpx.Response(200, content=b"x" * 101)
        with self.assertRaisesRegex(DriveError, "drive_payload_too_large"):
            await self.source.fetch("a", "https://lh3.googleusercontent.com/image=s220", 1)
        self.handler = lambda r: httpx.Response(200, content=b"x" * 101) if "alt" in r.url.params else httpx.Response(200, json={})
        with self.assertRaisesRegex(DriveError, "drive_payload_too_large"):
            await self.source.fetch("a", None, 1)

    async def test_redirects_validated_before_token_forwarded(self):
        self.handler = lambda r: httpx.Response(302, headers={"location": "https://evil.test/token"})
        with self.assertRaisesRegex(DriveError, "drive_url_rejected"):
            await self.source.fetch("a", "https://lh3.googleusercontent.com/image=s220", 1)
        self.assertFalse(any(r.url.host == "evil.test" for r in self.requests))
        for url in ["http://lh3.googleusercontent.com/a", "https://googleusercontent.com.evil.test/a", "https://user:pass@drive.google.com/a", "https://127.0.0.1/a"]:
            with self.assertRaises(DriveError):
                thumbnail_url(url)

    async def test_drive_failure_never_calls_fly_photo_proxy(self):
        self.handler = lambda r: httpx.Response(403, text="PRIVATE SIGNED URL")
        with self.assertRaises(DriveError) as caught:
            await self.source.fetch("a", None, 1)
        self.assertNotIn("PRIVATE", str(caught.exception))
        self.assertFalse(any("/assets/" in r.url.path for r in self.requests))

    async def test_worker_drive_failure_does_not_use_callback_or_local_photo(self):
        job = main.IndexJobInput(jobId=1, galleryId=1, modelVersion=main.MODEL_VERSION, photoSource="drive")
        source = AsyncMock()
        source.fetch.side_effect = DriveError("drive_fetch_failed", 403)
        with patch.object(main, "drive_source", source), patch.object(main, "callback_config", return_value=("https://api.test", "test")), patch.object(main, "local_candidates") as local:
            with self.assertRaises(DriveError):
                await main.fetch_photo(job, main.PhotoInput(driveFileId="a"))
            local.assert_not_called()

    async def test_failed_token_is_not_cached(self):
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(503, text="SECRET"))) as client:
            source = DriveSource(client, "https://api.test", "test", 100)
            with self.assertRaises(DriveError) as caught:
                await source.token()
            self.assertNotIn("SECRET", str(caught.exception))
            self.assertEqual(source._token, "")
