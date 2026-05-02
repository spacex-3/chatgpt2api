from __future__ import annotations

import json
import os
import secrets
import sys
import time
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BASE_DIR / "data"
CONFIG_FILE = BASE_DIR / "config.json"
VERSION_FILE = BASE_DIR / "VERSION"
SESSION_SECRET_FILE = DATA_DIR / "session_secret.txt"


def _clean(value: object) -> str:
    return str(value or "").strip()


def _normalize_positive_int(value: object, default: int) -> int:
    try:
        return max(1, int(value or default))
    except (TypeError, ValueError):
        return default


def _read_json_object(path: Path, *, name: str) -> dict[str, object]:
    if not path.exists():
        return {}
    if path.is_dir():
        print(
            f"Warning: {name} at '{path}' is a directory, ignoring it and falling back to other configuration sources.",
            file=sys.stderr,
        )
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


class ConfigStore:
    def __init__(self, path: Path):
        self.path = path
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        self.data = self._load()

    def _load(self) -> dict[str, object]:
        return _read_json_object(self.path, name="config.json")

    def _save(self) -> None:
        self.path.write_text(json.dumps(self.data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    @property
    def session_secret(self) -> str:
        from_env = _clean(os.getenv("CHATGPT2API_SESSION_SECRET"))
        if from_env:
            return from_env
        try:
            secret = _clean(SESSION_SECRET_FILE.read_text(encoding="utf-8"))
        except FileNotFoundError:
            secret = ""
        if secret:
            return secret
        secret = secrets.token_urlsafe(32)
        SESSION_SECRET_FILE.parent.mkdir(parents=True, exist_ok=True)
        SESSION_SECRET_FILE.write_text(secret + "\n", encoding="utf-8")
        return secret

    @property
    def upstream_api_url(self) -> str:
        return _clean(os.getenv("CHATGPT2API_UPSTREAM_API_URL") or self.data.get("upstream_api_url")).rstrip("/")

    @property
    def upstream_api_key(self) -> str:
        return _clean(os.getenv("CHATGPT2API_UPSTREAM_API_KEY") or self.data.get("upstream_api_key"))

    @property
    def proxy(self) -> str:
        return _clean(os.getenv("CHATGPT2API_PROXY") or self.data.get("proxy"))

    @property
    def base_url(self) -> str:
        return _clean(os.getenv("CHATGPT2API_BASE_URL") or self.data.get("base_url")).rstrip("/")

    @property
    def image_retention_days(self) -> int:
        return _normalize_positive_int(
            os.getenv("CHATGPT2API_IMAGE_RETENTION_DAYS") or self.data.get("image_retention_days"),
            30,
        )

    @property
    def images_dir(self) -> Path:
        path = DATA_DIR / "images"
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def app_version(self) -> str:
        try:
            value = VERSION_FILE.read_text(encoding="utf-8").strip()
        except FileNotFoundError:
            return "0.0.0"
        return value or "0.0.0"

    def cleanup_old_images(self) -> int:
        cutoff = time.time() - self.image_retention_days * 86400
        removed = 0
        for path in self.images_dir.rglob("*"):
            if path.is_file() and path.stat().st_mtime < cutoff:
                path.unlink()
                removed += 1
        for path in sorted((p for p in self.images_dir.rglob("*") if p.is_dir()), key=lambda p: len(p.parts), reverse=True):
            try:
                path.rmdir()
            except OSError:
                pass
        return removed

    def get(self) -> dict[str, object]:
        return {
            "upstream_api_url": self.upstream_api_url,
            "upstream_api_key": self.upstream_api_key,
            "proxy": self.proxy,
            "base_url": self.base_url,
            "image_retention_days": self.image_retention_days,
            "model": "gpt-image-2",
        }

    def get_proxy_settings(self) -> str:
        return self.proxy

    def update(self, data: dict[str, object]) -> dict[str, object]:
        next_data = dict(self.data)
        if "upstream_api_url" in data:
            next_data["upstream_api_url"] = _clean(data.get("upstream_api_url")).rstrip("/")
        if "upstream_api_key" in data:
            next_data["upstream_api_key"] = _clean(data.get("upstream_api_key"))
        if "proxy" in data:
            next_data["proxy"] = _clean(data.get("proxy"))
        if "base_url" in data:
            next_data["base_url"] = _clean(data.get("base_url")).rstrip("/")
        if "image_retention_days" in data:
            next_data["image_retention_days"] = _normalize_positive_int(data.get("image_retention_days"), self.image_retention_days)
        self.data = next_data
        self._save()
        return self.get()


config = ConfigStore(CONFIG_FILE)
