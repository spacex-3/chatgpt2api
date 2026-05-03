from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field

from api.support import require_admin, require_identity
from services.config import config
from services.image_errors import ImageGenerationError
from services.session_service import build_session_name, build_subject_id, session_service
from services.upstream_openai_image_client import UpstreamOpenAIImageClient


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    upstream_api_url: str | None = None
    upstream_api_key: str | None = None
    api_url: str | None = None
    api_key: str | None = None

    def resolved_api_url(self) -> str:
        return str(self.upstream_api_url or self.api_url or "").strip()

    def resolved_api_key(self) -> str:
        return str(self.upstream_api_key or self.api_key or "").strip()


class SettingsUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    upstream_api_url: str | None = None
    upstream_api_key: str | None = None
    proxy: str | None = None
    base_url: str | None = None
    image_retention_days: int | None = Field(default=None, ge=1)
    max_images_per_request: int | None = Field(default=None, ge=1, le=10)


class AdminLoginRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    password: str | None = None


def _validate_upstream_or_raise(api_url: str, api_key: str) -> UpstreamOpenAIImageClient:
    if not api_url:
        raise HTTPException(status_code=400, detail={"error": "upstream_api_url is required"})
    if not api_key:
        raise HTTPException(status_code=400, detail={"error": "upstream_api_key is required"})
    try:
        client = UpstreamOpenAIImageClient(api_url=api_url, api_key=api_key)
        client.validate_credentials()
        return client
    except ImageGenerationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.to_openai_error()) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail={"error": str(exc)}) from exc


def _build_user_auth_payload(api_url: str, api_key: str) -> dict[str, str]:
    subject_id = build_subject_id(api_url, api_key)
    name = build_session_name(api_url, api_key)
    return {
        "role": "user",
        "subject_id": subject_id,
        "name": name,
        "session_token": session_service.create_session(
            subject_id=subject_id,
            name=name,
            role="user",
            upstream_api_url=api_url,
            upstream_api_key=api_key,
            credential_id=subject_id,
            credential_label=name,
        ),
    }


def _build_admin_auth_payload() -> dict[str, str]:
    return {
        "role": "admin",
        "subject_id": "admin",
        "name": "系统管理员",
        "session_token": session_service.create_session(
            subject_id="admin",
            name="系统管理员",
            role="admin",
        ),
    }


def _user_settings_config(identity: dict[str, object]) -> dict[str, object]:
    return {
        "upstream_api_url": str(identity.get("upstream_api_url") or "").strip(),
        "upstream_api_key": str(identity.get("upstream_api_key") or "").strip(),
        "base_url": config.base_url,
        "max_images_per_request": config.max_images_per_request,
        "model": "gpt-image-2",
    }


def _admin_settings_config() -> dict[str, object]:
    return config.get_admin_public()


def create_router(app_version: str) -> APIRouter:
    router = APIRouter()

    @router.post("/auth/login")
    async def login(body: LoginRequest):
        client = await run_in_threadpool(_validate_upstream_or_raise, body.resolved_api_url(), body.resolved_api_key())
        auth_payload = _build_user_auth_payload(client.api_url, body.resolved_api_key())
        return {
            "ok": True,
            "version": app_version,
            **auth_payload,
            "config": _user_settings_config({
                "upstream_api_url": client.api_url,
                "upstream_api_key": body.resolved_api_key(),
            }),
        }

    @router.post("/auth/admin/login")
    async def admin_login(body: AdminLoginRequest):
        configured_password = str(config.admin_password or "").strip()
        if not configured_password:
            raise HTTPException(status_code=400, detail={"error": "CHATGPT2API_ADMIN_PASSWORD is not configured"})
        if str(body.password or "").strip() != configured_password:
            raise HTTPException(status_code=401, detail={"error": "admin password is invalid"})
        return {
            "ok": True,
            "version": app_version,
            **_build_admin_auth_payload(),
            "config": _admin_settings_config(),
        }

    @router.get("/version")
    async def get_version():
        return {"version": app_version}

    @router.get("/api/settings")
    async def get_settings(authorization: str | None = Header(default=None)):
        identity = require_identity(authorization)
        if identity.get("role") == "admin":
            return {
                "config": _admin_settings_config(),
                "role": "admin",
                "scope": "admin",
                "subject_id": identity.get("id"),
                "name": identity.get("name"),
            }
        return {
            "config": _user_settings_config(identity),
            "role": "user",
            "scope": "user",
            "subject_id": identity.get("id"),
            "name": identity.get("name"),
        }

    @router.post("/api/settings")
    async def save_settings(body: SettingsUpdateRequest, authorization: str | None = Header(default=None)):
        identity = require_identity(authorization)
        if identity.get("role") != "admin":
            next_api_url = str(body.upstream_api_url or "").strip()
            next_api_key = str(body.upstream_api_key or "").strip()
            if not next_api_url or not next_api_key:
                raise HTTPException(status_code=400, detail={"error": "upstream_api_url and upstream_api_key are required"})
            validated = await run_in_threadpool(_validate_upstream_or_raise, next_api_url, next_api_key)
            auth_payload = _build_user_auth_payload(validated.api_url, next_api_key)
            return {
                "config": _user_settings_config({
                    "upstream_api_url": validated.api_url,
                    "upstream_api_key": next_api_key,
                }),
                "scope": "user",
                **auth_payload,
            }
        require_admin(authorization)
        current = config.get()
        current_api_key = str(current.get("upstream_api_key") or "").strip()
        requested_api_key = body.upstream_api_key
        next_api_key = (
            current_api_key
            if requested_api_key is None or (not str(requested_api_key or "").strip() and current_api_key)
            else str(requested_api_key or "").strip()
        )
        next_values = {
            "upstream_api_url": body.upstream_api_url if body.upstream_api_url is not None else current.get("upstream_api_url"),
            "upstream_api_key": next_api_key,
            "proxy": body.proxy if body.proxy is not None else current.get("proxy"),
            "base_url": body.base_url if body.base_url is not None else current.get("base_url"),
            "image_retention_days": body.image_retention_days if body.image_retention_days is not None else current.get("image_retention_days"),
            "max_images_per_request": body.max_images_per_request if body.max_images_per_request is not None else current.get("max_images_per_request"),
        }
        next_api_url = str(next_values.get("upstream_api_url") or "").strip()
        next_api_key = str(next_values.get("upstream_api_key") or "").strip()
        if not next_api_url or not next_api_key:
            raise HTTPException(status_code=400, detail={"error": "upstream_api_url and upstream_api_key are required"})
        current_api_url = str(current.get("upstream_api_url") or "").strip()
        if next_api_url != current_api_url or next_api_key != current_api_key:
            validated = await run_in_threadpool(_validate_upstream_or_raise, next_api_url, next_api_key)
            next_values["upstream_api_url"] = validated.api_url
        config.update(next_values)
        return {
            "config": config.get_admin_public(),
            "role": "admin",
            "scope": "admin",
            "subject_id": identity.get("id"),
            "name": identity.get("name"),
        }

    return router
