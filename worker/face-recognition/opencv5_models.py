from __future__ import annotations

import cv2
import numpy as np

YUNET_STRIDES = (8, 16, 32)


class YuNetDetector:
    input_size = (320, 320)
    strides = YUNET_STRIDES
    output_names = tuple(
        f"{kind}_{stride}"
        for kind in ("cls", "obj", "bbox", "kps")
        for stride in YUNET_STRIDES
    )

    def __init__(self, model_path: str, score_threshold: float, nms_threshold: float, top_k: int):
        self.net = cv2.dnn.readNetFromONNX(model_path)
        self.score_threshold = score_threshold
        self.nms_threshold = nms_threshold
        self.top_k = top_k

    def setInputSize(self, size: tuple[int, int]) -> None:
        self.input_size = size

    def setScoreThreshold(self, threshold: float) -> None:
        self.score_threshold = threshold

    def detect(self, image: np.ndarray) -> tuple[int, np.ndarray | None]:
        width, height = self.input_size
        if image.shape[1] != width or image.shape[0] != height:
            raise ValueError("Image size does not match the configured YuNet input size")

        padded_width = ((width - 1) // 32 + 1) * 32
        padded_height = ((height - 1) // 32 + 1) * 32
        padded = cv2.copyMakeBorder(
            image, 0, padded_height - height, 0, padded_width - width,
            cv2.BORDER_CONSTANT, value=0,
        )
        self.net.setInput(cv2.dnn.blobFromImage(padded))
        outputs = dict(zip(self.output_names, self.net.forward(self.output_names)))

        faces: list[list[float]] = []
        for stride in self.strides:
            columns = padded_width // stride
            rows = padded_height // stride
            classes = outputs[f"cls_{stride}"].reshape(-1)
            objects = outputs[f"obj_{stride}"].reshape(-1)
            bbox = outputs[f"bbox_{stride}"].reshape(-1, 4)
            landmarks = outputs[f"kps_{stride}"].reshape(-1, 10)
            scores = np.sqrt(np.clip(classes, 0, 1) * np.clip(objects, 0, 1))
            indexes = np.flatnonzero(scores >= self.score_threshold)
            if indexes.size == 0:
                continue

            grid_y, grid_x = np.divmod(indexes, columns)
            distances = bbox[indexes]
            centers_x = (grid_x + distances[:, 0]) * stride
            centers_y = (grid_y + distances[:, 1]) * stride
            widths = np.exp(distances[:, 2]) * stride
            heights = np.exp(distances[:, 3]) * stride
            level_faces = np.column_stack((
                centers_x - widths / 2,
                centers_y - heights / 2,
                widths,
                heights,
            ))
            points = landmarks[indexes].reshape(-1, 5, 2)
            points[:, :, 0] = (points[:, :, 0] + grid_x[:, None]) * stride
            points[:, :, 1] = (points[:, :, 1] + grid_y[:, None]) * stride
            faces.extend(np.column_stack((
                level_faces,
                points.reshape(-1, 10),
                scores[indexes],
            )).tolist())

        if not faces:
            return 1, None

        boxes = [face[:4] for face in faces]
        confidences = [face[14] for face in faces]
        kept = cv2.dnn.NMSBoxes(
            boxes, confidences, self.score_threshold, self.nms_threshold, top_k=self.top_k,
        )
        if len(kept) == 0:
            return 1, None
        return 1, np.asarray(faces, dtype=np.float32)[np.asarray(kept).reshape(-1)]


class SFaceRecognizer:
    target_points = np.array([
        [38.2946, 51.6963],
        [73.5318, 51.5014],
        [56.0252, 71.7366],
        [41.5493, 92.3655],
        [70.7299, 92.2041],
    ], dtype=np.float32)
    target_mean = np.array([np.float32(56.0262), np.float32(71.9008)], dtype=np.float64)

    def __init__(self, model_path: str):
        self.net = cv2.dnn.readNetFromONNX(model_path)

    def alignCrop(self, image: np.ndarray, face: np.ndarray) -> np.ndarray:
        source = np.asarray(face, dtype=np.float32).reshape(-1)[4:14].reshape(5, 2)
        source_mean = np.zeros(2, dtype=np.float32)
        for point in source:
            source_mean = np.float32(source_mean + point)
        source_mean = np.float32(source_mean / 5)
        target_mean = self.target_mean.astype(np.float32)
        source_centered = source - source_mean
        target_centered = self.target_points - target_mean
        covariance = np.zeros((2, 2), dtype=np.float64)
        for index in range(5):
            for row in range(2):
                for column in range(2):
                    product = np.float32(target_centered[index, row] * source_centered[index, column])
                    covariance[row, column] += float(product)
        covariance /= 5
        singular_values, left, right = cv2.SVDecomp(covariance)
        singular_values = singular_values.reshape(-1)
        correction = np.array([1.0, -1.0 if np.linalg.det(covariance) < 0 else 1.0])
        rotation = left @ np.diag(correction) @ right
        variance = sum(
            float(np.float32(source_centered[index, axis] * source_centered[index, axis]))
            for index in range(5)
            for axis in range(2)
        ) / 5
        scale = np.dot(singular_values, correction) / variance
        translation = target_mean.astype(np.float64) - scale * rotation @ source_mean.astype(np.float64)
        transform = np.column_stack((scale * rotation, translation))
        return cv2.warpAffine(image, transform, (112, 112), flags=cv2.INTER_LINEAR)

    def feature(self, aligned: np.ndarray) -> np.ndarray:
        blob = cv2.dnn.blobFromImage(aligned, 1, (112, 112), (0, 0, 0), True, False)
        self.net.setInput(blob)
        return self.net.forward()
