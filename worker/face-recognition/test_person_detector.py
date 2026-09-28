import unittest
from pathlib import Path
from unittest.mock import Mock

import cv2
import numpy as np

from model_assets import MODELS, verify_models
from person_detector import PersonDetector


MODEL_DIR = Path(__file__).resolve().parent / "models"


class PersonDetectorTests(unittest.TestCase):
    def detector_without_model(self) -> PersonDetector:
        detector = PersonDetector.__new__(PersonDetector)
        detector.cv2 = cv2
        detector.input_size = (416, 416)
        detector.strides = (8,)
        detector.reg_max = 7
        detector.project = np.arange(8, dtype=np.float32)
        detector.mean = np.array([103.53, 116.28, 123.675], dtype=np.float32).reshape(1, 1, 3)
        detector.std = np.array([57.375, 57.12, 58.395], dtype=np.float32).reshape(1, 1, 3)
        detector.anchors = (np.array([[3.5, 3.5]], dtype=np.float32),)
        return detector

    def test_letterbox_is_centered_and_keeps_416_shape(self):
        detector = self.detector_without_model()
        source = np.full((100, 200, 3), 255, dtype=np.uint8)
        output = detector._letterbox(source)
        self.assertEqual(output.shape, (416, 416, 3))
        self.assertTrue(np.all(output[:104] == 0))
        self.assertTrue(np.all(output[104:312] == 255))
        self.assertTrue(np.all(output[312:] == 0))

    def test_decode_keeps_only_person_class_above_threshold(self):
        detector = self.detector_without_model()
        classes = np.zeros((1, 1, 80), dtype=np.float32)
        boxes = np.zeros((1, 1, 32), dtype=np.float32)
        classes[0, 0, 1] = 0.99
        decoded_boxes, scores = detector._decode([classes, boxes])
        self.assertEqual((decoded_boxes, scores), ([], []))
        classes[0, 0, 1] = 0
        classes[0, 0, 0] = 0.18
        decoded_boxes, scores = detector._decode([classes, boxes])
        self.assertEqual(len(decoded_boxes), 1)
        self.assertAlmostEqual(scores[0], 0.18)

    def test_count_applies_person_nms(self):
        detector = self.detector_without_model()
        detector.net = Mock()
        detector.net.getUnconnectedOutLayersNames.return_value = ["output"]
        detector.net.forward.return_value = []
        detector._decode = Mock(return_value=([[10, 10, 100, 100], [12, 12, 100, 100]], [0.9, 0.8]))
        self.assertEqual(detector.count(np.zeros((100, 100, 3), dtype=np.uint8)), 1)

    def test_pinned_model_checksum_and_native_warmup(self):
        expected = next(item for item in MODELS if item[0] == "object_detection_nanodet")
        self.assertEqual(expected[2], "4b82da9944b88577175ee23a459dce2e26e6e4be573def65b1055dc2d9720186")
        verify_models(MODEL_DIR)
        detector = PersonDetector(MODEL_DIR / expected[1])
        self.assertEqual(detector.count(np.zeros((416, 416, 3), dtype=np.uint8)), 0)


if __name__ == "__main__":
    unittest.main()
