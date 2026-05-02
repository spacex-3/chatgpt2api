from __future__ import annotations

import hashlib
import hmac
import json
from base64 import urlsafe_b64decode, urlsafe_b64encode
from urllib.parse import urlparse

from services.config import DATA_DIR


def _normalize_api_url(value: str) -> str:
    return str(value or "").strip().rstrip("/")


def build_subject_id(api_url: str, api_key: str) -> str:
    normalized_url = _normalize_api_url(api_url)
    normalized_key = str(api_key or "").strip()
    digest = hashlib.sha256(f"{normalized_url}\n{normalized_key}".encode("utf-8")).hexdigest()[:24]
    return f"upstream-{digest}"


def build_session_name(api_url: str, api_key: str) -> str:
    normalized_url = _normalize_api_url(api_url)
    normalized_key = str(api_key or "").strip()
    parsed = urlparse(normalized_url)
    host = parsed.netloc or parsed.path or "upstream"
    suffix = normalized_key[-4:] if len(normalized_key) >= 4 else normalized_key or "anon"
    return f"{host} · {suffix}"


class SessionService:
    def __init__(self, secret_path=DATA_DIR / "session_secret.txt"):
        self.secret_path = secret_path
        self.secret_path.parent.mkdir(parents=True, exist_ok=True)

    def _get_secret(self) -> bytes:
        if self.secret_path.exists():
            return self.secret_path.read_text(encoding="utf-8").encode("utf-8")
        digest = hashlib.sha256(str(self.secret_path).encode("utf-8")).hexdigest()
        self.secret_path.write_text(digest, encoding="utf-8")
        return digest.encode("utf-8")

    def create_session(self, *, subject_id: str = "upstream-admin", name: str = "绘图管理员") -> str:
        payload = json.dumps({
            "sub": str(subject_id or "upstream-admin").strip() or "upstream-admin",
            "role": "admin",
            "name": str(name or "绘图管理员").strip() or "绘图管理员",
        }, ensure_ascii=False).encode("utf-8")
        sig = hmac.new(self._get_secret(), payload, "sha256").digest()
        return urlsafe_b64encode(payload + b"." + sig).decode("utf-8")

    def authenticate(self, token: str):
        if not token:
            return None
        try:
            decoded = urlsafe_b64decode(token.encode("utf-8"))
            payload_bytes, sig = decoded.rsplit(b".", 1)
            expected = hmac.new(self._get_secret(), payload_bytes, "sha256").digest()
            if not hmac.compare_digest(sig, expected):
                return None
            payload = json.loads(payload_bytes.decode("utf-8"))
            return {
                "id": str(payload.get("sub") or "upstream-admin"),
                "role": str(payload.get("role") or "admin"),
                "name": str(payload.get("name") or "绘图管理员"),
            }
        except Exception:
            return None


session_service = SessionService()
