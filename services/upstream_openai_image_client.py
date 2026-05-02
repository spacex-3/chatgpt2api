from __future__ import annotations

import base64
import time
from typing import Any, TypedDict
from urllib.parse import urlparse

try:
    from curl_cffi import requests
except ImportError:  # pragma: no cover
    requests = None  # type: ignore[assignment]

from services.config import config
from services.image_errors import ImageGenerationError
from services.local_image_store import save_image_bytes
from services.proxy_service import proxy_settings

SUPPORTED_IMAGE_MODEL = "gpt-image-2"
ALLOWED_IMAGE_SIZES = {"auto", "1024x1024", "1536x1024", "1024x1536"}


class UpstreamImageInput(TypedDict):
    filename: str
    content_type: str
    data: bytes


def normalize_upstream_api_url(value: object) -> str:
    url = str(value or "").strip().rstrip("/")
    if not url:
        raise ValueError("upstream_api_url is required")
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("upstream_api_url must be a valid http(s) url")
    return url


def build_upstream_url(api_url: str, path: str) -> str:
    base = normalize_upstream_api_url(api_url)
    suffix = path if path.startswith("/") else f"/{path}"
    if base.endswith("/v1"):
        return f"{base}{suffix}"
    return f"{base}/v1{suffix}"


def validate_image_request(prompt: object, model: object, n: object, size: object) -> tuple[str, str, int, str | None]:
    normalized_prompt = str(prompt or "").strip()
    if not normalized_prompt:
        raise ValueError("prompt is required")
    normalized_model = str(model or SUPPORTED_IMAGE_MODEL).strip() or SUPPORTED_IMAGE_MODEL
    if normalized_model != SUPPORTED_IMAGE_MODEL:
        raise ValueError(f"model must be {SUPPORTED_IMAGE_MODEL}")
    try:
        normalized_n = int(n or 1)
    except (TypeError, ValueError) as exc:
        raise ValueError("n must be an integer") from exc
    if normalized_n < 1 or normalized_n > 10:
        raise ValueError("n must be between 1 and 10")
    normalized_size = str(size or "").strip() or None
    if normalized_size and normalized_size not in ALLOWED_IMAGE_SIZES:
        raise ValueError("size must be one of auto, 1024x1024, 1536x1024, 1024x1536")
    return normalized_prompt, normalized_model, normalized_n, normalized_size


def normalize_image_inputs(images: object) -> list[UpstreamImageInput]:
    normalized: list[UpstreamImageInput] = []
    if isinstance(images, list):
        for index, item in enumerate(images, start=1):
            if not isinstance(item, dict):
                continue
            data = item.get("data")
            if not isinstance(data, (bytes, bytearray)) or not data:
                continue
            normalized.append({
                "filename": str(item.get("filename") or f"image-{index}.png").strip() or f"image-{index}.png",
                "content_type": str(item.get("content_type") or "image/png").strip() or "image/png",
                "data": bytes(data),
            })
    if not normalized:
        raise ValueError("image is required")
    return normalized


class UpstreamOpenAIImageClient:
    def __init__(self, api_url: str | None = None, api_key: str | None = None) -> None:
        self.api_url = normalize_upstream_api_url(api_url or config.upstream_api_url)
        self.api_key = str(api_key or config.upstream_api_key).strip()
        if not self.api_key:
            raise ValueError("upstream_api_key is required")

    @staticmethod
    def _require_requests() -> Any:
        if requests is None:
            raise RuntimeError("curl_cffi is not installed")
        return requests

    def _session(self):
        client = self._require_requests()
        session = client.Session(**proxy_settings.build_session_kwargs(verify=True))
        session.headers.update({
            "Accept": "application/json",
            "Authorization": f"Bearer {self.api_key}",
            "User-Agent": "chatgpt2api-image-workspace/1.0",
        })
        return session

    @staticmethod
    def _error_from_response(response: Any, *, default_message: str) -> ImageGenerationError:
        status_code = int(getattr(response, "status_code", 0) or 502)
        message = default_message
        error_type = "server_error"
        code = "upstream_error"
        param = None
        try:
            payload = response.json()
        except Exception:
            payload = None
        if isinstance(payload, dict):
            error = payload.get("error") if isinstance(payload.get("error"), dict) else payload
            if isinstance(error, dict):
                message = str(error.get("message") or message)
                error_type = str(error.get("type") or error_type)
                code = str(error.get("code") or code)
                param = str(error.get("param") or "") or None
        elif getattr(response, "text", ""):
            message = str(response.text)[:500]
        return ImageGenerationError(
            message,
            status_code=status_code if 400 <= status_code < 600 else 502,
            error_type=error_type,
            code=code,
            param=param,
        )

    def _download_image_bytes(self, url: str) -> bytes | None:
        candidate = str(url or "").strip()
        if not candidate:
            return None
        client = self._require_requests()
        session = client.Session(**proxy_settings.build_session_kwargs(verify=True))
        session.headers.update({"User-Agent": "chatgpt2api-image-workspace/1.0"})
        try:
            response = session.get(candidate, timeout=120)
            if 200 <= response.status_code < 300:
                return bytes(response.content or b"") or None
        except Exception:
            return None
        finally:
            session.close()
        return None

    def _normalize_result(self, payload: dict[str, Any], *, prompt: str, base_url: str | None) -> dict[str, Any]:
        created = int(payload.get("created") or time.time())
        items = payload.get("data") if isinstance(payload.get("data"), list) else []
        data: list[dict[str, Any]] = []
        for raw_item in items:
            if not isinstance(raw_item, dict):
                continue
            revised_prompt = str(raw_item.get("revised_prompt") or prompt).strip() or prompt
            b64_json = str(raw_item.get("b64_json") or "").strip()
            image_url = str(raw_item.get("url") or "").strip()
            image_bytes: bytes | None = None
            if b64_json:
                try:
                    image_bytes = base64.b64decode(b64_json)
                except Exception as exc:
                    raise ImageGenerationError(f"failed to decode upstream image payload: {exc}") from exc
            elif image_url:
                image_bytes = self._download_image_bytes(image_url)
                if image_bytes:
                    b64_json = base64.b64encode(image_bytes).decode("ascii")
            local_url = save_image_bytes(image_bytes, base_url) if image_bytes else ""
            item: dict[str, Any] = {"revised_prompt": revised_prompt}
            if b64_json:
                item["b64_json"] = b64_json
            if local_url:
                item["url"] = local_url
            elif image_url:
                item["url"] = image_url
            if item.get("b64_json") or item.get("url"):
                data.append(item)
        result: dict[str, Any] = {"created": created, "data": data}
        if isinstance(payload.get("usage"), dict):
            result["usage"] = payload["usage"]
        if not data and payload.get("message"):
            result["message"] = str(payload.get("message"))
        return result

    def validate_credentials(self) -> dict[str, Any]:
        session = self._session()
        try:
            response = session.get(build_upstream_url(self.api_url, "/models"), timeout=30)
            if not (200 <= response.status_code < 300):
                raise self._error_from_response(response, default_message="upstream validation failed")
            payload = response.json()
        finally:
            session.close()
        if isinstance(payload, dict):
            data = payload.get("data")
            if isinstance(data, list):
                model_ids = {str(item.get("id") or "").strip() for item in data if isinstance(item, dict)}
                if model_ids and SUPPORTED_IMAGE_MODEL not in model_ids:
                    raise ImageGenerationError(
                        f"upstream does not expose {SUPPORTED_IMAGE_MODEL}",
                        status_code=400,
                        error_type="invalid_request_error",
                        code="model_not_available",
                    )
        return payload if isinstance(payload, dict) else {"ok": True}

    def generate(self, *, prompt: str, model: str, n: int, size: str | None, base_url: str | None) -> dict[str, Any]:
        normalized_prompt, normalized_model, normalized_n, normalized_size = validate_image_request(prompt, model, n, size)
        session = self._session()
        payload: dict[str, Any] = {"model": normalized_model, "prompt": normalized_prompt, "n": normalized_n}
        if normalized_size:
            payload["size"] = normalized_size
        try:
            response = session.post(build_upstream_url(self.api_url, "/images/generations"), json=payload, timeout=300)
            if not (200 <= response.status_code < 300):
                raise self._error_from_response(response, default_message="upstream image generation failed")
            raw = response.json()
        finally:
            session.close()
        if not isinstance(raw, dict):
            raise ImageGenerationError("upstream image generation returned an invalid payload")
        return self._normalize_result(raw, prompt=normalized_prompt, base_url=base_url)

    def edit(
        self,
        *,
        prompt: str,
        model: str,
        n: int,
        size: str | None,
        images: list[UpstreamImageInput],
        base_url: str | None,
    ) -> dict[str, Any]:
        normalized_prompt, normalized_model, normalized_n, normalized_size = validate_image_request(prompt, model, n, size)
        normalized_images = normalize_image_inputs(images)
        session = self._session()
        payload: dict[str, Any] = {"model": normalized_model, "prompt": normalized_prompt, "n": normalized_n}
        if normalized_size:
            payload["size"] = normalized_size
        files = [
            ("image", (item["filename"], item["data"], item["content_type"]))
            for item in normalized_images
        ]
        try:
            response = session.post(build_upstream_url(self.api_url, "/images/edits"), data=payload, files=files, timeout=300)
            if not (200 <= response.status_code < 300):
                raise self._error_from_response(response, default_message="upstream image edit failed")
            raw = response.json()
        finally:
            session.close()
        if not isinstance(raw, dict):
            raise ImageGenerationError("upstream image edit returned an invalid payload")
        return self._normalize_result(raw, prompt=normalized_prompt, base_url=base_url)
