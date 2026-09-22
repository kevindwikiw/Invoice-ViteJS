from dataclasses import dataclass
from pathlib import Path
from threading import Lock

import numpy as np

MODEL_VERSION = "opencv-yunet-2023mar-sface-2021dec-1"
DETECTION_THRESHOLD = 0.9
SELFIE_RETRY_THRESHOLD = 0.8


@dataclass
class Face:
    bbox: np.ndarray
    embedding: np.ndarray


class FaceEngine:
    def __init__(self, model_dir: Path, threads: int = 2):
        import cv2

        from model_assets import verify_models

        verify_models(model_dir)
        self.lock = Lock()
        cv2.setNumThreads(threads)
        cv2.ocl.setUseOpenCL(False)
        self.detector = cv2.FaceDetectorYN.create(
            str(model_dir / "face_detection_yunet_2023mar.onnx"), "", (320, 320),
            DETECTION_THRESHOLD, 0.3, 5000, cv2.dnn.DNN_BACKEND_OPENCV, cv2.dnn.DNN_TARGET_CPU,
        )
        self.recognizer = cv2.FaceRecognizerSF.create(
            str(model_dir / "face_recognition_sface_2021dec.onnx"), "",
            cv2.dnn.DNN_BACKEND_OPENCV, cv2.dnn.DNN_TARGET_CPU,
        )
        # Warm both networks, including recognition when detection finds no face.
        self.get(np.zeros((320, 320, 3), dtype=np.uint8))
        self.recognizer.feature(np.zeros((112, 112, 3), dtype=np.uint8))

    def get(self, image: np.ndarray, *, selfie: bool = False) -> list[Face]:
        # Cancelling asyncio.to_thread does not stop its native call. Keep the
        # buffers protected until the actual inference thread exits as well.
        with self.lock:
            faces = self._get(image)
            if faces or not selfie:
                return faces
            # The detector is shared with indexing; restore its threshold even
            # when native inference fails, before releasing the lock.
            try:
                self.detector.setScoreThreshold(SELFIE_RETRY_THRESHOLD)
                return self._get(image)
            finally:
                self.detector.setScoreThreshold(DETECTION_THRESHOLD)

    def _get(self, image: np.ndarray) -> list[Face]:
        self.detector.setInputSize((image.shape[1], image.shape[0]))
        _, detections = self.detector.detect(image)
        if detections is None:
            return []
        faces = []
        for detection in detections:
            aligned = self.recognizer.alignCrop(image, detection)
            embedding = self.recognizer.feature(aligned).reshape(-1).copy()
            if embedding.size != 128 or not np.isfinite(embedding).all() or np.linalg.norm(embedding) <= 0:
                raise ValueError("Invalid SFace embedding")
            x, y, width, height = detection[:4]
            faces.append(Face(np.array([x, y, x + width, y + height]), embedding))
        return faces


def sensitivity_threshold(value: str) -> float:
    # Cosine distance = 1 - similarity. Balanced uses OpenCV's LFW baseline;
    # strict/wide are provisional product settings, requiring gallery calibration.
    return {"strict": 0.50, "balanced": 0.637, "wide": 0.68}.get(value, 0.637)
