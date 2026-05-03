from __future__ import annotations

import hashlib
import time
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageOps

from services.config import config


def detect_image_extension(image_data: bytes) -> str:
    if image_data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if image_data.startswith(b"RIFF") and image_data[8:12] == b"WEBP":
        return ".webp"
    if image_data.startswith((b"GIF87a", b"GIF89a")):
        return ".gif"
    return ".png"


def _build_relative_dir(bucket: str = "") -> Path:
    date_dir = Path(time.strftime("%Y"), time.strftime("%m"), time.strftime("%d"))
    normalized_bucket = str(bucket or "").strip().strip("/")
    return Path(normalized_bucket) / date_dir if normalized_bucket else date_dir


def _save_image_bytes(image_data: bytes, *, base_url: str | None = None, bucket: str = "") -> str:
    config.cleanup_old_images()
    file_hash = hashlib.md5(image_data).hexdigest()
    extension = detect_image_extension(image_data)
    filename = f"{int(time.time())}_{file_hash}{extension}"
    relative_dir = _build_relative_dir(bucket)
    file_path = config.images_dir / relative_dir / filename
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_bytes(image_data)
    root = (base_url or config.base_url or "").rstrip("/")
    return f"{root}/images/{relative_dir.as_posix()}/{filename}" if root else f"/images/{relative_dir.as_posix()}/{filename}"


def save_image_bytes(image_data: bytes, base_url: str | None = None) -> str:
    return _save_image_bytes(image_data, base_url=base_url)


def save_image_asset_bytes(image_data: bytes, *, base_url: str | None = None, bucket: str) -> str:
    return _save_image_bytes(image_data, base_url=base_url, bucket=bucket)


def build_thumbnail_bytes(image_data: bytes, *, max_size: tuple[int, int] = (320, 320)) -> bytes:
    with Image.open(BytesIO(image_data)) as image:
        normalized = ImageOps.exif_transpose(image)
        if "A" in normalized.getbands():
            output_image = normalized.convert("RGBA")
            output_format = "PNG"
            save_kwargs = {"optimize": True}
        else:
            output_image = normalized.convert("RGB")
            output_format = "JPEG"
            save_kwargs = {"quality": 85, "optimize": True}
        output_image.thumbnail(max_size, Image.Resampling.LANCZOS)
        buffer = BytesIO()
        output_image.save(buffer, format=output_format, **save_kwargs)
        return buffer.getvalue()


def save_thumbnail_bytes(image_data: bytes, *, base_url: str | None = None, bucket: str = "_thumbs") -> str:
    thumbnail_bytes = build_thumbnail_bytes(image_data)
    return _save_image_bytes(thumbnail_bytes, base_url=base_url, bucket=bucket)
