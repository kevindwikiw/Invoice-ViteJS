from pathlib import Path

import numpy as np


PERSON_CLASS_ID = 0
PERSON_SCORE_THRESHOLD = 0.18
PERSON_NMS_THRESHOLD = 0.60


class PersonDetector:
    """NanoDet Plus person counter using OpenCV DNN on a 416px letterbox."""

    input_size = (416, 416)
    strides = (8, 16, 32, 64)
    reg_max = 7

    def __init__(self, model_path: Path):
        import cv2

        self.cv2 = cv2
        self.net = cv2.dnn.readNetFromONNX(str(model_path))
        self.net.setPreferableBackend(cv2.dnn.DNN_BACKEND_OPENCV)
        self.net.setPreferableTarget(cv2.dnn.DNN_TARGET_CPU)
        self.project = np.arange(self.reg_max + 1, dtype=np.float32)
        self.mean = np.array([103.53, 116.28, 123.675], dtype=np.float32).reshape(1, 1, 3)
        self.std = np.array([57.375, 57.12, 58.395], dtype=np.float32).reshape(1, 1, 3)
        self.anchors = tuple(self._anchors_for_stride(stride) for stride in self.strides)

    def _anchors_for_stride(self, stride: int) -> np.ndarray:
        height = self.input_size[1] // stride
        width = self.input_size[0] // stride
        shift_x, shift_y = np.meshgrid(np.arange(width), np.arange(height))
        offset = 0.5 * (stride - 1)
        return np.column_stack((shift_x.reshape(-1) * stride + offset, shift_y.reshape(-1) * stride + offset))

    def _letterbox(self, image: np.ndarray) -> np.ndarray:
        if image.ndim != 3 or image.shape[2] != 3 or image.shape[0] <= 0 or image.shape[1] <= 0:
            raise ValueError("NanoDet expects a non-empty BGR image")
        target_width, target_height = self.input_size
        scale = min(target_width / image.shape[1], target_height / image.shape[0])
        width = max(1, min(target_width, round(image.shape[1] * scale)))
        height = max(1, min(target_height, round(image.shape[0] * scale)))
        resized = self.cv2.resize(image, (width, height), interpolation=self.cv2.INTER_AREA)
        top = (target_height - height) // 2
        bottom = target_height - height - top
        left = (target_width - width) // 2
        right = target_width - width - left
        return self.cv2.copyMakeBorder(resized, top, bottom, left, right, self.cv2.BORDER_CONSTANT, value=0)

    def _decode(self, outputs: list[np.ndarray]) -> tuple[list[list[float]], list[float]]:
        if len(outputs) % 2 or not 2 <= len(outputs) <= len(self.strides) * 2:
            raise ValueError(f"Unexpected NanoDet output count: {len(outputs)}")
        boxes: list[list[float]] = []
        scores: list[float] = []
        for stride, anchors, class_output, box_output in zip(self.strides, self.anchors, outputs[::2], outputs[1::2]):
            classes = np.asarray(class_output).squeeze(axis=0) if np.asarray(class_output).ndim == 3 else np.asarray(class_output)
            distribution = np.asarray(box_output).squeeze(axis=0) if np.asarray(box_output).ndim == 3 else np.asarray(box_output)
            if classes.ndim != 2 or classes.shape[0] != anchors.shape[0] or classes.shape[1] <= PERSON_CLASS_ID:
                raise ValueError("Unexpected NanoDet class output shape")
            if distribution.shape != (anchors.shape[0], 4 * (self.reg_max + 1)):
                raise ValueError("Unexpected NanoDet box output shape")

            class_ids = np.argmax(classes, axis=1)
            confidences = np.max(classes, axis=1)
            candidate_indexes = np.flatnonzero(
                (class_ids == PERSON_CLASS_ID) & (confidences >= PERSON_SCORE_THRESHOLD)
            )
            if candidate_indexes.size == 0:
                continue
            if candidate_indexes.size > 1000:
                order = np.argsort(confidences[candidate_indexes])[-1000:]
                candidate_indexes = candidate_indexes[order]

            logits = distribution[candidate_indexes].reshape(-1, self.reg_max + 1)
            logits -= logits.max(axis=1, keepdims=True)
            probabilities = np.exp(logits)
            probabilities /= probabilities.sum(axis=1, keepdims=True)
            distances = (probabilities @ self.project).reshape(-1, 4) * stride
            points = anchors[candidate_indexes]
            x1 = np.clip(points[:, 0] - distances[:, 0], 0, self.input_size[0])
            y1 = np.clip(points[:, 1] - distances[:, 1], 0, self.input_size[1])
            x2 = np.clip(points[:, 0] + distances[:, 2], 0, self.input_size[0])
            y2 = np.clip(points[:, 1] + distances[:, 3], 0, self.input_size[1])
            boxes.extend(np.column_stack((x1, y1, x2 - x1, y2 - y1)).tolist())
            scores.extend(confidences[candidate_indexes].astype(float).tolist())
        return boxes, scores

    def count(self, image: np.ndarray) -> int:
        prepared = self.cv2.cvtColor(self._letterbox(image), self.cv2.COLOR_BGR2RGB).astype(np.float32)
        prepared = (prepared - self.mean) / self.std
        self.net.setInput(self.cv2.dnn.blobFromImage(prepared))
        outputs = self.net.forward(self.net.getUnconnectedOutLayersNames())
        boxes, scores = self._decode(outputs)
        if not boxes:
            return 0
        indexes = self.cv2.dnn.NMSBoxes(boxes, scores, PERSON_SCORE_THRESHOLD, PERSON_NMS_THRESHOLD)
        return len(indexes)
