from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import threading
from base64 import urlsafe_b64decode
from pathlib import Path
from urllib.parse import urlparse

from services.config import DATA_DIR


def _normalize_api_url(value: str) -> str:
    return str(value or "").strip().rstrip("/")


def _normalize_role(value: object) -> str:
    return "admin" if str(value or "").strip() == "admin" else "user"


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
    suffix = normalized_key[-4:] if len(normalized_key) > 4 else ("key" if normalized_key else "anon")
    return f"{host} · {suffix}"


class SessionService:
    def __init__(
        self,
        path: Path = DATA_DIR / "sessions.json",
        *,
        secret_path: Path = DATA_DIR / "session_secret.txt",
    ):
        self.path = path
        self.secret_path = secret_path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._sessions = self._load_sessions()

    def _get_secret(self) -> bytes:
        if self.secret_path.exists():
            return self.secret_path.read_text(encoding="utf-8").encode("utf-8")
        digest = hashlib.sha256(str(self.secret_path).encode("utf-8")).hexdigest()
        self.secret_path.write_text(digest, encoding="utf-8")
        return digest.encode("utf-8")

    def _load_sessions(self) -> dict[str, dict[str, str]]:
        if not self.path.exists():
            return {}
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except Exception:
            return {}
        sessions = raw.get("sessions") if isinstance(raw, dict) else None
        if not isinstance(sessions, dict):
            return {}
        items: dict[str, dict[str, str]] = {}
        for token, payload in sessions.items():
            if not isinstance(token, str) or not token.strip() or not isinstance(payload, dict):
                continue
            role = _normalize_role(payload.get("role"))
            item = {
                "sub": str(payload.get("sub") or "").strip() or "upstream-anonymous",
                "role": role,
                "name": str(payload.get("name") or "").strip() or ("系统管理员" if role == "admin" else "图片用户"),
            }
            if role == "user":
                item["upstream_api_url"] = _normalize_api_url(str(payload.get("upstream_api_url") or ""))
                item["upstream_api_key"] = str(payload.get("upstream_api_key") or "").strip()
                item["credential_id"] = str(payload.get("credential_id") or item["sub"]).strip() or item["sub"]
                item["credential_label"] = str(payload.get("credential_label") or item["name"]).strip() or item["name"]
            items[token.strip()] = item
        return items

    def _save_sessions(self) -> None:
        self.path.write_text(json.dumps({"sessions": self._sessions}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    def create_session(
        self,
        *,
        subject_id: str = "upstream-anonymous",
        name: str = "图片用户",
        role: str = "user",
        upstream_api_url: str = "",
        upstream_api_key: str = "",
        credential_id: str = "",
        credential_label: str = "",
    ) -> str:
        normalized_role = _normalize_role(role)
        record = {
            "sub": str(subject_id or "upstream-anonymous").strip() or "upstream-anonymous",
            "role": normalized_role,
            "name": str(name or ("系统管理员" if normalized_role == "admin" else "图片用户")).strip()
            or ("系统管理员" if normalized_role == "admin" else "图片用户"),
        }
        if normalized_role == "user":
            record["upstream_api_url"] = _normalize_api_url(upstream_api_url)
            record["upstream_api_key"] = str(upstream_api_key or "").strip()
            record["credential_id"] = str(credential_id or record["sub"]).strip() or record["sub"]
            record["credential_label"] = str(credential_label or record["name"]).strip() or record["name"]
        token = secrets.token_urlsafe(32)
        with self._lock:
            self._sessions[token] = record
            self._save_sessions()
        return token

    def _authenticate_legacy_token(self, token: str):
        try:
            decoded = urlsafe_b64decode(token.encode("utf-8"))
            payload_bytes, sig = decoded.rsplit(b".", 1)
            expected = hmac.new(self._get_secret(), payload_bytes, "sha256").digest()
            if not hmac.compare_digest(sig, expected):
                return None
            payload = json.loads(payload_bytes.decode("utf-8"))
        except Exception:
            return None
        role = _normalize_role(payload.get("role") or "admin")
        return {
            "id": str(payload.get("sub") or "upstream-admin"),
            "role": role,
            "name": str(payload.get("name") or ("系统管理员" if role == "admin" else "图片用户")),
        }

    def authenticate(self, token: str):
        normalized_token = str(token or "").strip()
        if not normalized_token:
            return None
        with self._lock:
            record = self._sessions.get(normalized_token)
        if isinstance(record, dict):
            identity = {
                "id": str(record.get("sub") or "upstream-anonymous"),
                "role": _normalize_role(record.get("role")),
                "name": str(record.get("name") or "图片用户"),
            }
            if identity["role"] == "user":
                identity["upstream_api_url"] = _normalize_api_url(str(record.get("upstream_api_url") or ""))
                identity["upstream_api_key"] = str(record.get("upstream_api_key") or "").strip()
                identity["credential_id"] = str(record.get("credential_id") or identity["id"]).strip() or identity["id"]
                identity["credential_label"] = str(record.get("credential_label") or identity["name"]).strip() or identity["name"]
            return identity
        return self._authenticate_legacy_token(normalized_token)


session_service = SessionService()
