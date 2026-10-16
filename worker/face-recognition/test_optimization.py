import asyncio
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np
from PIL import Image

import main
import telemetry
from benchmark_metrics import detection_metrics, distribution, face_identity_metrics, retrieval_metrics
from embedding_cache import prepare_index
from engine import Face


class OptimizationTests(unittest.TestCase):
    def test_candidate_matches_exactly_including_boundaries_ties_duplicates_and_solo(self):
        rng = np.random.default_rng(13)
        query = rng.normal(size=128).astype(np.float32)
        query /= np.linalg.norm(query)
        records = [{"driveFileId": str(i // 2), "embedding": rng.normal(size=128).astype(np.float32), "isSolo": False}
                   for i in range(300)]
        records += [{"driveFileId": "solo", "embedding": query, "isSolo": True},
                    {"driveFileId": "tie", "embedding": query, "isSolo": True},
                    {"driveFileId": "invalid", "embedding": [0] * 128}]
        index = prepare_index(records, True)
        boundary = float(np.clip(1 - index.matrix @ query, 0, 2)[8])
        for threshold in (0., .50, .637, .68, 2., boundary, np.nextafter(np.float32(boundary), np.float32(0))):
            for solo in (False, True):
                self.assertEqual(index.match(query, threshold, solo),
                                 index.match(query, threshold, solo, candidate_filter=True))
        empty = prepare_index([])
        self.assertEqual(empty.match(query, .637, candidate_filter=True), [])

    def test_single_normalization_preserves_payload_and_invalid_vector_filter(self):
        faces = [Face(np.array([1, 2, 10, 20]), np.arange(128, dtype=np.float32)),
                 Face("invalid box that must never be read", np.zeros(128)),
                 Face(np.array([0, 1, 8, 9]), np.ones(128))]
        photo = main.PhotoInput(driveFileId="local", sourceVersion="v1")
        expected = main.photo_face_payloads(faces, photo)
        with patch.object(main, "normalized_embedding", wraps=main.normalized_embedding) as normalize:
            actual = main.photo_face_payloads(faces, photo, normalize_once=True)
        self.assertEqual(json.dumps(expected), json.dumps(actual))
        self.assertEqual(normalize.call_count, len(faces))
        self.assertEqual([r["faceIndex"] for r in actual], [0, 2])

    def test_decode_pixels_unchanged_with_exif_and_timings(self):
        from PIL import ImageOps
        rng = np.random.default_rng(1)
        source = Image.fromarray(rng.integers(0, 256, (1600, 900, 3), dtype=np.uint8))
        exif = Image.Exif()
        exif[274] = 6
        output = io.BytesIO()
        source.save(output, "JPEG", exif=exif)
        payload = output.getvalue()
        with Image.open(io.BytesIO(payload)) as image:
            image.draft("RGB", (1280, 1280))
            rgb = ImageOps.exif_transpose(image).convert("RGB")
            rgb.thumbnail((1280, 1280), Image.Resampling.LANCZOS)
            expected = np.asarray(rgb)[:, :, ::-1].copy()
        with telemetry.observation("test", enabled=True, emit=False) as metrics:
            actual = main.decode_image(payload)
        np.testing.assert_array_equal(actual, expected)
        self.assertTrue(actual.flags.c_contiguous)
        self.assertTrue({"decode_ms", "resize_ms", "color_ms"} <= metrics.keys())

    def test_metrics_math_counts_misses_false_accepts_and_detection_errors(self):
        photos = [{"id": "a", "faces": [{"identity": "person", "bbox": [0, 0, 10, 10]}]},
                  {"id": "b", "faces": []}]
        query = [{"id": "q", "identity": "person"}, {"id": "u", "identity": None}]
        metrics = retrieval_metrics(query, {"q": [], "u": ["b"]}, photos)
        self.assertEqual(metrics["positive_query_miss_rate"], 1)
        self.assertEqual(metrics["unknown_false_accept_rate"], 1)
        self.assertEqual(metrics["photo_false_negative"], 1)
        records = [{"driveFileId": "b", "boundingBox": {"x": 0, "y": 0, "width": 10, "height": 10}}]
        self.assertEqual(detection_metrics(photos, records), {
            "true_positive": 0, "false_positive": 1, "false_negative": 1, "recall": 0.0})
        self.assertEqual(distribution(list(range(1, 101)))["p95_ms"], 95)
        self.assertIsNone(distribution([])["p50_ms"])

    def test_face_identity_metrics_include_missed_detection_and_wrong_identity(self):
        photos = [{"id": "a", "faces": [{"identity": "p", "bbox": [0, 0, 10, 10]},
                                         {"identity": "other", "bbox": [20, 0, 10, 10]}]}]
        vector = np.eye(1, 128, dtype=np.float32)[0]
        records = [{"driveFileId": "a", "embedding": vector,
                    "boundingBox": {"x": 20, "y": 0, "width": 10, "height": 10}}]
        self.assertEqual(face_identity_metrics(photos, records, [{"id": "q", "identity": "p"}], {"q": vector}),
                         {"true_positive": 0, "false_positive": 1, "false_negative": 1})


class TelemetryTests(unittest.IsolatedAsyncioTestCase):
    async def test_threads_and_concurrent_requests_keep_metrics_isolated(self):
        async def operation(value):
            with telemetry.observation("test", enabled=True, emit=False) as metrics:
                telemetry.annotate(gallery_id=value, token="PRIVATE", filename="PRIVATE")
                def work():
                    with telemetry.measure("detect_ms"):
                        telemetry.annotate(faces=value)
                await asyncio.to_thread(work)
                await asyncio.sleep(0)
            return metrics
        left, right = await asyncio.gather(operation(1), operation(2))
        self.assertEqual((left["faces"], right["faces"]), (1, 2))
        self.assertNotIn("PRIVATE", json.dumps([left, right]))
        self.assertIsNone(telemetry.CURRENT.get())

    async def test_failure_logs_category_without_exception_payload(self):
        with self.assertLogs("orbit-face-worker", level="INFO") as captured:
            with self.assertRaises(ValueError):
                with telemetry.observation("test", enabled=True):
                    raise ValueError("https://private.invalid/?token=SECRET")
        self.assertNotIn("SECRET", str(captured.output))
        self.assertIn("ValueError", str(captured.output))


if __name__ == "__main__":
    unittest.main()
