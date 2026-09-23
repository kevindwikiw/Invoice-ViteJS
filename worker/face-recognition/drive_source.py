"""Bounded direct Drive downloads. Credentials and signed URLs never leave RAM/log-safe errors."""
from __future__ import annotations

import asyncio
import json
import logging
import math
import re
import time
from urllib.parse import quote, urljoin, urlsplit, urlunsplit

import httpx

logger = logging.getLogger("orbit-face-worker")


class DriveError(RuntimeError):
    def __init__(self, code: str, status: int = 0):
        self.code = code
        self.status = status
        super().__init__(f"{code} status={status}")


def trusted_google_url(url: str) -> str:
    try:
        parsed = urlsplit(url)
        host = parsed.hostname or ""
        allowed = host in {"www.googleapis.com", "drive.google.com", "googleusercontent.com"} or host.endswith(".googleusercontent.com")
        if parsed.scheme != "https" or not allowed or parsed.port not in {None, 443} or parsed.username or parsed.password:
            raise ValueError()
    except ValueError:
        raise DriveError("drive_url_rejected") from None
    return url


def thumbnail_url(url: str, webp: bool = True) -> str:
    parsed = urlsplit(trusted_google_url(url))
    suffix = "=w1280-rw" if webp else "=w1280"
    path = re.sub(r"=(?:s|w)\d+(?:-[^/]*)?$", "", parsed.path) + suffix
    return urlunsplit(parsed._replace(path=path))


class DriveSource:
    def __init__(self, client: httpx.AsyncClient, origin: str, callback_token: str, max_bytes: int):
        self.client = client
        self.origin = origin
        self.callback_token = callback_token
        self.max_bytes = max_bytes
        self._token = ""
        self._expires_at = 0.0
        self._lock = asyncio.Lock()

    async def token(self, rejected: str | None = None) -> str:
        async with self._lock:
            if self._token and self._expires_at > time.time() + 300 and self._token != rejected:
                return self._token
            try:
                url = f"{self.origin}/api/internal/face-index/drive-token"
                if rejected is not None:
                    url += "?refresh=1"
                async with self.client.stream("POST", url, headers={"x-face-worker-token": self.callback_token}, follow_redirects=False) as response:
                    if response.status_code != 200:
                        raise DriveError("drive_token_unavailable", response.status_code)
                    payload = json.loads(await self._read(response, 64 * 1024))
                token = payload["accessToken"]
                expires_at = float(payload["expiresAt"]) / 1000
                if not isinstance(token, str) or not token or not math.isfinite(expires_at) or expires_at <= time.time() + 300:
                    raise ValueError()
                self._token, self._expires_at = token, expires_at
                return token
            except DriveError:
                raise
            except (httpx.HTTPError, ValueError, KeyError, TypeError):
                raise DriveError("drive_token_unavailable") from None

    @staticmethod
    async def _read(response: httpx.Response, limit: int) -> bytes:
        length = response.headers.get("content-length")
        if length and length.isdigit() and int(length) > limit:
            raise DriveError("drive_payload_too_large")
        chunks = []
        total = 0
        async for chunk in response.aiter_bytes():
            total += len(chunk)
            if total > limit:
                raise DriveError("drive_payload_too_large")
            chunks.append(chunk)
        return b"".join(chunks)

    async def get(self, url: str, limit: int) -> bytes:
        url = trusted_google_url(url)
        token = await self.token()
        refreshed = False
        redirects = 0
        try:
            while True:
                async with self.client.stream("GET", url, headers={"Authorization": f"Bearer {token}"}, follow_redirects=False) as response:
                    if response.status_code == 401 and not refreshed:
                        token = await self.token(rejected=token)
                        refreshed = True
                        continue
                    if response.status_code in {301, 302, 303, 307, 308}:
                        redirects += 1
                        if redirects > 3 or not response.headers.get("location"):
                            raise DriveError("drive_redirect_failed")
                        url = trusted_google_url(urljoin(url, response.headers["location"]))
                        continue
                    if not response.is_success:
                        raise DriveError("drive_fetch_failed", response.status_code)
                    return await self._read(response, limit)
        except httpx.HTTPError:
            raise DriveError("drive_network_failed") from None

    async def thumbnail(self, url: str) -> bytes:
        try:
            return await self.get(thumbnail_url(url), self.max_bytes)
        except DriveError as error:
            if error.code != "drive_fetch_failed":
                raise
        return await self.get(thumbnail_url(url, webp=False), self.max_bytes)

    async def fetch(self, file_id: str, thumbnail: str | None, job_id: int) -> bytes:
        started = time.perf_counter()
        base = f"https://www.googleapis.com/drive/v3/files/{quote(file_id, safe='')}"
        if thumbnail:
            try:
                payload = await self.thumbnail(thumbnail)
                return self._result(payload, file_id, job_id, "thumbnail", started)
            except DriveError as error:
                if error.code not in {"drive_fetch_failed", "drive_network_failed"}:
                    raise
        try:
            metadata = json.loads(await self.get(f"{base}?supportsAllDrives=true&fields=id,thumbnailLink", 64 * 1024))
            fresh = metadata.get("thumbnailLink")
            if fresh:
                payload = await self.thumbnail(fresh)
                return self._result(payload, file_id, job_id, "refreshed_thumbnail", started)
        except (ValueError, TypeError, AttributeError):
            raise DriveError("drive_metadata_invalid") from None
        except DriveError as error:
            if error.code not in {"drive_fetch_failed", "drive_network_failed"}:
                raise
        payload = await self.get(f"{base}?alt=media&supportsAllDrives=true", self.max_bytes)
        return self._result(payload, file_id, job_id, "original", started)

    @staticmethod
    def _result(payload: bytes, file_id: str, job_id: int, kind: str, started: float) -> bytes:
        logger.info("Job %s photo %s: source=drive kind=%s bytes=%s fetch_ms=%.0f", job_id, file_id, kind, len(payload), (time.perf_counter() - started) * 1000)
        return payload
