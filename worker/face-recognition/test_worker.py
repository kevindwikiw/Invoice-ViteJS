import asyncio
import io
import json
import unittest
import tempfile
from types import SimpleNamespace
from threading import Lock
from unittest.mock import AsyncMock, Mock, patch

import httpx
import numpy as np
from PIL import Image

import main
from engine import Face, FaceEngine, MODEL_VERSION, sensitivity_threshold


def blank_jpeg(size=(80, 60)):
    output = io.BytesIO()
    Image.new("RGB", size).save(output, format="JPEG")
    return output.getvalue()


class ImageTests(unittest.TestCase):
    def test_selfie_retry_is_bounded_and_does_not_change_indexing(self):
        image = np.zeros((32, 32, 3), dtype=np.uint8)
        face = Face(np.array([0, 0, 10, 10]), np.ones(128))
        for selfie, results, expected_thresholds in [
            (True, [[face]], []),
            (False, [[]], []),
            (True, [[], [face]], [0.8, 0.9]),
            (True, [[], []], [0.8, 0.9]),
        ]:
            with self.subTest(selfie=selfie, passes=len(results)):
                engine = FaceEngine.__new__(FaceEngine)
                engine.lock = Lock()
                engine.detector = SimpleNamespace(setScoreThreshold=Mock())
                def detect(_):
                    self.assertTrue(engine.lock.locked())
                    return results.pop(0)
                engine._get = Mock(side_effect=detect)
                expected = results[-1]
                passes = len(results)
                self.assertEqual(engine.get(image, selfie=selfie), expected)
                self.assertEqual(engine._get.call_count, passes)
                self.assertEqual([call.args[0] for call in engine.detector.setScoreThreshold.call_args_list], expected_thresholds)
                self.assertFalse(engine.lock.locked())

    def test_selfie_retry_restores_threshold_after_inference_failure(self):
        engine = FaceEngine.__new__(FaceEngine)
        engine.lock = Lock()
        thresholds = []
        def set_threshold(value):
            self.assertTrue(engine.lock.locked())
            thresholds.append(value)
        engine.detector = SimpleNamespace(setScoreThreshold=set_threshold)
        engine._get = Mock(side_effect=[[], RuntimeError("inference failed")])
        image = np.zeros((32, 32, 3), dtype=np.uint8)
        with self.assertRaises(RuntimeError):
            engine.get(image, selfie=True)
        self.assertEqual(thresholds, [0.8, 0.9])
        self.assertFalse(engine.lock.locked())
        engine._get = Mock(return_value=[])
        self.assertEqual(engine.get(image), [])
        engine._get.assert_called_once()
        self.assertEqual(thresholds, [0.8, 0.9])

    def test_decode_bounds_dimensions(self):
        image = main.decode_image(blank_jpeg((3000, 1800)))
        self.assertLessEqual(max(image.shape[:2]), 1280)
        self.assertEqual(image.shape[2], 3)

    def test_corrupt_photo_is_an_error(self):
        with self.assertRaises(OSError):
            main.decode_image(b"not an image")

    def test_alignment_and_embedding_are_copied_for_multiple_faces(self):
        buffer = np.ones((1, 128), dtype=np.float32)
        engine = FaceEngine.__new__(FaceEngine)
        engine.lock = Lock()
        engine.detector = SimpleNamespace(setInputSize=lambda _: None, detect=lambda _: (2, [np.array([1, 2, 3, 4]), np.array([5, 6, 7, 8])]))
        engine.recognizer = SimpleNamespace(alignCrop=lambda image, face: image, feature=lambda _: buffer)
        faces = engine.get(np.zeros((32, 32, 3), dtype=np.uint8))
        buffer[:] = 0
        self.assertEqual(len(faces), 2)
        self.assertEqual(faces[0].bbox.tolist(), [1, 2, 4, 6])
        self.assertTrue(np.all(faces[0].embedding == 1))
        self.assertIs(main.largest_face(faces), faces[1])

    def test_sface_threshold_and_best_face_per_photo(self):
        query = np.array([1, 0], dtype=np.float32)
        records = [
            {"driveFileId": "a", "embedding": [1, 0]},
            {"driveFileId": "a", "embedding": [0.8, 0.2]},
            {"driveFileId": "b", "embedding": [0, 1]},
            {"driveFileId": "invalid", "embedding": [float("nan"), 0]},
            {"driveFileId": "invalid2", "embedding": [[1, 0]]},
        ]
        self.assertAlmostEqual(sensitivity_threshold("balanced"), 1 - 0.363)
        self.assertEqual(main.match_records(query, records, sensitivity_threshold("balanced")), [{"driveFileId": "a", "distance": 0.0}])


class WorkerTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.patches = [
            patch.object(main, "WORKER_TOKEN", "test-token"),
            patch.object(main, "face_app", SimpleNamespace(get=lambda _, **kwargs: [])),
            patch.object(main, "model_state", "ready"),
            patch.object(main, "model_error_code", None),
            patch.object(main, "model_lock", asyncio.Lock()),
            patch.object(main, "inference_semaphore", asyncio.Semaphore(1)),
            patch.object(main, "job_semaphore", asyncio.Semaphore(1)),
            patch.object(main, "job_tasks", {}),
        ]
        for item in self.patches:
            item.start()
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test", headers={"Authorization": "Bearer test-token"})

    async def asyncTearDown(self):
        await self.client.aclose()
        for item in reversed(self.patches):
            item.stop()

    async def test_ready_requires_auth_and_successful_model(self):
        self.assertEqual((await self.client.get("/readyz", headers={"Authorization": ""})).status_code, 401)
        self.assertEqual((await self.client.get("/readyz")).json()["model"], MODEL_VERSION)
        main.face_app = None
        for failure, code in [(ModuleNotFoundError("cv2"), "dependency_missing"), (ValueError("bad model"), "model_load_failed")]:
            with patch.object(main, "load_face_app_sync", side_effect=failure):
                await main.initialize_model()
                response = await self.client.get("/readyz")
                self.assertEqual(response.status_code, 503)
                self.assertEqual(response.json()["code"], code)
                self.assertEqual((await self.client.get("/healthz")).status_code, 200)

    async def test_no_face_and_corrupt_selfie_are_422(self):
        for payload in (blank_jpeg(), b"bad jpeg"):
            response = await self.client.post("/v1/search", data={"galleryId": "1", "embeddings": "[]"}, files={"selfie": ("selfie.jpg", payload, "image/jpeg")})
            self.assertEqual(response.status_code, 422)

    async def test_search_matches_and_rejects_mismatched_model(self):
        vector = np.ones(128, dtype=np.float32) / np.sqrt(128)
        main.face_app = SimpleNamespace(get=Mock(return_value=[Face(np.array([0, 0, 10, 10]), vector)]))
        data = {"galleryId": "1", "modelVersion": MODEL_VERSION, "embeddings": json.dumps([{"driveFileId": "page-2-photo", "embedding": vector.tolist()}])}
        response = await self.client.post("/v1/search", data=data, files={"selfie": ("selfie.jpg", blank_jpeg())})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["matches"][0]["driveFileId"], "page-2-photo")
        self.assertEqual(main.face_app.get.call_args.kwargs, {"selfie": True})
        data["modelVersion"] = "unsupported-model-version"
        self.assertEqual((await self.client.post("/v1/search", data=data, files={"selfie": ("selfie.jpg", blank_jpeg())})).status_code, 409)

    async def test_cache_includes_no_face_photos(self):
        job = main.IndexJobInput(jobId=1, galleryId=1, modelVersion=MODEL_VERSION, photos=[
            main.PhotoInput(driveFileId="cached-empty", cachedFaces=[]),
            main.PhotoInput(driveFileId="new"),
        ])
        fetch = AsyncMock(return_value=blank_jpeg())
        report = AsyncMock()
        with patch.object(main, "fetch_photo", fetch), patch.object(main, "callback", report):
            await main.process_index_job(job)
        self.assertEqual(fetch.await_count, 1)
        self.assertEqual(fetch.call_args.args[1].driveFileId, "new")
        self.assertTrue(report.call_args.args[1].endswith("/complete"))
        self.assertEqual(report.call_args.args[2]["embeddings"], [])

    async def test_search_accepts_two_megabyte_embedding_field(self):
        vector = np.ones(128, dtype=np.float32) / np.sqrt(128)
        main.face_app = SimpleNamespace(get=lambda _, **kwargs: [Face(np.array([0, 0, 10, 10]), vector)])
        records = [{"driveFileId": f"photo-{i}", "embedding": vector.tolist()} for i in range(850)]
        encoded = json.dumps(records)
        self.assertGreater(len(encoded.encode()), 2 * 1024 * 1024)
        response = await self.client.post("/v1/search", data={"galleryId": "1", "embeddings": encoded}, files={"selfie": ("selfie.jpg", blank_jpeg())})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(response.json()["matches"]), 850)

    async def test_search_authentication_precedes_form_parsing(self):
        with patch.object(main, "parse_search_form", new_callable=AsyncMock) as parse:
            response = await self.client.post("/v1/search", headers={"Authorization": ""}, content=b"broken multipart")
            self.assertEqual(response.status_code, 401)
            parse.assert_not_awaited()

    async def test_embedding_size_boundary_and_file_cleanup_on_parse_error(self):
        opened = []
        def spool(*args, **kwargs):
            file = tempfile.SpooledTemporaryFile(*args, **kwargs)
            opened.append(file)
            return file
        with patch.object(main, "MAX_EMBEDDING_JSON_BYTES", 256), patch("starlette.formparsers.SpooledTemporaryFile", side_effect=spool):
            for size, expected in [(256, 422), (257, 413)]:
                response = await self.client.post("/v1/search", files=[
                    ("selfie", ("selfie.jpg", blank_jpeg(), "image/jpeg")),
                    ("galleryId", (None, "1")),
                    ("embeddings", (None, "[]" + " " * (size - 2))),
                ])
                self.assertEqual(response.status_code, expected, response.text)
                self.assertEqual(response.json()["detail"]["code"], "no_face" if size == 256 else "embeddings_too_large")
        self.assertEqual(len(opened), 2)
        self.assertTrue(all(file.closed for file in opened))

    async def test_invalid_search_fields_and_json_are_rejected(self):
        for fields, expected in [
            ({"galleryId": "1", "embeddings": "broken"}, 400),
            ({"galleryId": "1", "embeddings": "{}"}, 400),
            ({"galleryId": "1", "embeddings": "[null]"}, 400),
            ({"galleryId": "0", "embeddings": "[]"}, 400),
            ({"galleryId": "bad", "embeddings": "[]"}, 422),
            ({"galleryId": "1"}, 422),
        ]:
            response = await self.client.post("/v1/search", data=fields, files={"selfie": ("selfie.jpg", blank_jpeg())})
            self.assertEqual(response.status_code, expected, response.text)
        response = await self.client.post("/v1/search", content=b"broken", headers={"Content-Type": "multipart/form-data"})
        self.assertEqual(response.status_code, 400)
        response = await self.client.post("/v1/search", content=b"broken", headers={"Content-Type": "multipart/form-data; boundary=test"})
        self.assertEqual(response.status_code, 400)

    async def test_record_and_selfie_size_limits_are_413(self):
        with patch.object(main, "MAX_EMBEDDING_RECORDS", 1):
            response = await self.client.post("/v1/search", data={"galleryId": "1", "embeddings": "[{},{}]"}, files={"selfie": ("selfie.jpg", blank_jpeg())})
            self.assertEqual(response.status_code, 413)
            self.assertEqual(response.json()["detail"]["code"], "too_many_embeddings")
        with patch.object(main, "MAX_IMAGE_BYTES", 10):
            response = await self.client.post("/v1/search", data={"galleryId": "1", "embeddings": "[]"}, files={"selfie": ("selfie.jpg", blank_jpeg())})
            self.assertEqual(response.status_code, 413)
            self.assertEqual(response.json()["detail"]["code"], "selfie_too_large")

    async def test_upload_closes_on_success_and_validation_failure(self):
        vector = np.ones(128, dtype=np.float32) / np.sqrt(128)
        main.face_app = SimpleNamespace(get=lambda _, **kwargs: [Face(np.array([0, 0, 10, 10]), vector)])
        closed = []
        original_close = main.UploadFile.close
        async def close(upload):
            await original_close(upload)
            closed.append(upload.file.closed)
        with patch.object(main.UploadFile, "close", close):
            for embeddings, expected in [("[]", 200), ("broken", 400)]:
                response = await self.client.post("/v1/search", data={"galleryId": "1", "embeddings": embeddings}, files={"selfie": ("selfie.jpg", blank_jpeg())})
                self.assertEqual(response.status_code, expected)
        self.assertEqual(closed, [True, True])

    async def test_bad_photo_retries_and_never_publishes_partial_index(self):
        job = main.IndexJobInput(jobId=1, galleryId=1, modelVersion=MODEL_VERSION, photos=[main.PhotoInput(driveFileId="bad")])
        report = AsyncMock()
        fetch = AsyncMock(return_value=b"corrupt")
        with patch.object(main, "fetch_photo", fetch), patch.object(main, "callback", report):
            await main.process_index_job(job)
        self.assertEqual(fetch.await_count, 2)
        self.assertFalse(any(call.args[1].endswith("/complete") for call in report.call_args_list))
        self.assertTrue(report.call_args.args[1].endswith("/fail"))

    async def test_callback_failure_is_reported_and_job_is_released(self):
        job = main.IndexJobInput(jobId=2, galleryId=1, modelVersion=MODEL_VERSION, photos=[])
        report = AsyncMock(side_effect=[None, RuntimeError("callback failed"), None])
        main.job_tasks[2] = asyncio.current_task()
        with patch.object(main, "callback", report):
            await main.process_index_job(job)
        self.assertTrue(report.call_args.args[1].endswith("/fail"))
        self.assertNotIn(2, main.job_tasks)


if __name__ == "__main__":
    unittest.main()
