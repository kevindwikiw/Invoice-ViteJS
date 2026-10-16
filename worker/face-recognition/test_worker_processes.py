import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest

import httpx


class ProcessIsolationTests(unittest.TestCase):
    def test_workers_can_stop_and_restart_independently(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        env = {key: value for key, value in os.environ.items() if not key.startswith(("FACE_WORKER_", "FACE_ARCHIVE_WORKER_"))}
        env.update({
            "FACE_WORKER_TOKEN": "selfie-token",
            "FACE_WORKER_MODEL_DIR": str(Path(directory.name) / "missing-models"),
            "FACE_ARCHIVE_WORKER_TOKEN": "archive-token",
            "FACE_ARCHIVE_WORKER_CALLBACK_ORIGIN": "https://api.test",
            "FACE_ARCHIVE_WORKER_CALLBACK_TOKEN": "callback",
            "FACE_ARCHIVE_WORKER_DIR": str(Path(directory.name) / "archives"),
        })
        worker_root = Path(__file__).resolve().parent.parent
        env["PYTHONPATH"] = os.pathsep.join(filter(None, [str(worker_root), env.get("PYTHONPATH", "")]))

        def stop(process):
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=10)

        def start(module, port=None):
            if port is None:
                with socket.socket() as listener:
                    listener.bind(("127.0.0.1", 0))
                    port = listener.getsockname()[1]
            app_dir = worker_root / "archive-worker" if module == "archive_worker" else Path(__file__).parent
            process = subprocess.Popen([sys.executable, "-m", "uvicorn", f"{module}:app", "--host", "127.0.0.1", "--port", str(port), "--workers", "1", "--no-access-log"], cwd=app_dir, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            self.addCleanup(stop, process)
            origin = f"http://127.0.0.1:{port}"
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline and process.poll() is None:
                try:
                    if httpx.get(f"{origin}/healthz", timeout=0.5, trust_env=False).status_code == 200:
                        return process, port, origin
                except httpx.TransportError:
                    pass
                time.sleep(0.05)
            self.fail(f"{module} failed to start; exit={process.poll()}")

        face, _, face_origin = start("main")
        archive, archive_port, archive_origin = start("archive_worker")
        with httpx.Client(timeout=3, trust_env=False) as client:
            self.assertEqual(client.get(f"{face_origin}/healthz").json()["service"], "orbit-face-worker")
            self.assertEqual(client.post(f"{face_origin}/v1/archive/jobs", json={}).status_code, 404)
            self.assertEqual(client.get(f"{archive_origin}/readyz", headers={"Authorization": "Bearer archive-token"}).status_code, 200)
            stop(archive)
            self.assertIsNone(face.poll())
            self.assertEqual(client.get(f"{face_origin}/healthz").status_code, 200)
            archive, _, archive_origin = start("archive_worker", archive_port)
            stop(face)
            self.assertIsNone(archive.poll())
            self.assertEqual(client.get(f"{archive_origin}/readyz", headers={"Authorization": "Bearer archive-token"}).status_code, 200)
            self.assertEqual(client.get(f"{archive_origin}/readyz", headers={"Authorization": "Bearer selfie-token"}).status_code, 401)
