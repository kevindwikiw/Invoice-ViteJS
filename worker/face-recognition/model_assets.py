"""Pinned OpenCV Zoo assets; no model downloads during serving."""

import hashlib
from pathlib import Path
from urllib.request import urlopen

REVISION = "47534e27c9851bb1128ccc0102f1145e27f23f98"
MODELS = (
    ("face_detection_yunet", "face_detection_yunet_2023mar.onnx", "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"),
    ("face_recognition_sface", "face_recognition_sface_2021dec.onnx", "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79"),
)


def valid_model(path: Path, checksum: str) -> bool:
    if not path.is_file():
        return False
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest() == checksum


def verify_models(directory: Path) -> None:
    for _, name, checksum in MODELS:
        if not valid_model(directory / name, checksum):
            raise ValueError(f"Missing or invalid {name}; run python model_assets.py first")


def download_models(directory: Path) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    for folder, name, checksum in MODELS:
        target = directory / name
        if valid_model(target, checksum):
            print(f"Verified {name}")
            continue
        url = f"https://media.githubusercontent.com/media/opencv/opencv_zoo/{REVISION}/models/{folder}/{name}"
        temporary = target.with_suffix(".download")
        print(f"Downloading {name} from OpenCV Zoo", flush=True)
        try:
            with urlopen(url, timeout=120) as response, temporary.open("wb") as output:
                while chunk := response.read(1024 * 1024):
                    output.write(chunk)
            if not valid_model(temporary, checksum):
                raise ValueError(f"Checksum mismatch for {name}")
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)
    verify_models(directory)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", type=Path, default=Path(__file__).parent / "models")
    download_models(parser.parse_args().directory)
