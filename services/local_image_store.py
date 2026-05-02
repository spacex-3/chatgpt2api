from __future__ import annotations

import hashlib
import time
from pathlib import Path

from services.config import config


def detect_image_extension(image_data: bytes) -> str:
    if image_data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if image_data.startswith(b"RIFF") and image_data[8:12] == b"WEBP":
        return ".webp"
    if image_data.startswith((b"GIF87a", b"GIF89a")):
        return ".gif"
    return ".png"


def save_image_bytes(image_data: bytes, base_url: str | None = None) -> str:
    config.cleanup_old_images()
    file_hash = hashlib.md5(image_data).hexdigest()
    extension = detect_image_extension(image_data)
    filename = f"{int(time.time())}_{file_hash}{extension}"
    relative_dir = Path(time.strftime("%Y"), time.strftime("%m"), time.strftime("%d"))
    file_path = config.images_dir / relative_dir / filename
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_bytes(image_data)
    root = (base_url or config.base_url or "").rstrip("/")
    return f"{root}/images/{relative_dir.as_posix()}/{filename}" if root else f"/images/{relative_dir.as_posix()}/{filename}"
