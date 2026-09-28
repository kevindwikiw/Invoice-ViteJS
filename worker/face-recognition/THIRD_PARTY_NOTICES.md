# Third-Party Notices

## OpenCV Zoo NanoDet Plus

The face worker downloads `object_detection_nanodet_2022nov.onnx` from the
OpenCV Zoo. The model and the corresponding reference implementation in
`models/object_detection_nanodet` are licensed under the Apache License 2.0.

- Pinned source: https://github.com/opencv/opencv_zoo/tree/47534e27c9851bb1128ccc0102f1145e27f23f98/models/object_detection_nanodet
- Upstream model: https://github.com/RangiLyu/nanodet
- License: https://www.apache.org/licenses/LICENSE-2.0

Downloaded file SHA-256:
`4b82da9944b88577175ee23a459dce2e26e6e4be573def65b1055dc2d9720186`

The worker implementation is adapted to count only the COCO `person` class.
