from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Any

from services.config import config


SESSION_TTL_SECONDS = 30 * 24 * 60 * 60
DEFAULT_SUBJECT_ID = "upstream-admin"
DEFAULT_NAME = "绘图管理员"
DEFAULT_ROLE = "admin"


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("utf-8").rstrip("=")


def _b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


class SessionService:
    def _sign(self, payload: dict[str, Any]) -> str:
        message = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        secret = config.session_secret.encode("utf-8")
        signature = hmac.new(secret, message, hashlib.sha256).digest()
        return f"{_b64url_encode(message)}.{_b64url_encode(signature)}"

    def create_session(
        self,
        *,
        subject_id: str = DEFAULT_SUBJECT_ID,
        name: str = DEFAULT_NAME,
        role: str = DEFAULT_ROLE,
        ttl_seconds: int = SESSION_TTL_SECONDS,
    ) -> str:
        now = int(time.time())
        payload = {
            "sub": subject_id,
            "name": name,
            "role": role,
            "iat": now,
            "exp": now + max(60, int(ttl_seconds or SESSION_TTL_SECONDS)),
        }
        return self._sign(payload)

    def authenticate(self, token: str) -> dict[str, object] | None:
        candidate = str(token or "").strip()
        if not candidate or "." not in candidate:
            return None
        encoded_payload, encoded_signature = candidate.rsplit(".", 1)
        try:
            payload_bytes = _b64url_decode(encoded_payload)
            signature_bytes = _b64url_decode(encoded_signature)
        except Exception:
            return None
        expected_signature = hmac.new(
            config.session_secret.encode("utf-8"),
            payload_bytes,
            hashlib.sha256,
        ).digest()
        if not hmac.compare_digest(signature_bytes, expected_signature):
            return None
        try:
            payload = json.loads(payload_bytes.decode("utf-8"))
        except Exception:
            return None
        if not isinstance(payload, dict):
            return None
        try:
            exp = int(payload.get("exp") or 0)
        except (TypeError, ValueError):
            return None
        if exp <= int(time.time()):
            return None
        role = str(payload.get("role") or DEFAULT_ROLE).strip() or DEFAULT_ROLE
        return {
            "id": str(payload.get("sub") or DEFAULT_SUBJECT_ID).strip() or DEFAULT_SUBJECT_ID,
            "name": str(payload.get("name") or DEFAULT_NAME).strip() or DEFAULT_NAME,
            "role": role,
        }


session_service = SessionService()
