from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field

from api.support import require_identity
from services.config import config
from services.image_errors import ImageGenerationError
from services.session_service import session_service
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


def create_router(app_version: str) -> APIRouter:
    router = APIRouter()

    @router.post("/auth/login")
    async def login(body: LoginRequest):
        client = await run_in_threadpool(_validate_upstream_or_raise, body.resolved_api_url(), body.resolved_api_key())
        saved = config.update({
            "upstream_api_url": client.api_url,
            "upstream_api_key": body.resolved_api_key(),
        })
        return {
            "ok": True,
            "version": app_version,
            "role": "admin",
            "subject_id": "upstream-admin",
            "name": "绘图管理员",
            "session_token": session_service.create_session(),
            "config": saved,
        }

    @router.get("/version")
    async def get_version():
        return {"version": app_version}

    @router.get("/api/settings")
    async def get_settings(authorization: str | None = Header(default=None)):
        require_identity(authorization)
        return {"config": config.get()}

    @router.post("/api/settings")
    async def save_settings(body: SettingsUpdateRequest, authorization: str | None = Header(default=None)):
        require_identity(authorization)
        current = config.get()
        next_values = {
            "upstream_api_url": body.upstream_api_url if body.upstream_api_url is not None else current.get("upstream_api_url"),
            "upstream_api_key": body.upstream_api_key if body.upstream_api_key is not None else current.get("upstream_api_key"),
            "proxy": body.proxy if body.proxy is not None else current.get("proxy"),
            "base_url": body.base_url if body.base_url is not None else current.get("base_url"),
            "image_retention_days": body.image_retention_days if body.image_retention_days is not None else current.get("image_retention_days"),
        }
        next_api_url = str(next_values.get("upstream_api_url") or "").strip()
        next_api_key = str(next_values.get("upstream_api_key") or "").strip()
        if not next_api_url or not next_api_key:
            raise HTTPException(status_code=400, detail={"error": "upstream_api_url and upstream_api_key are required"})
        current_api_url = str(current.get("upstream_api_url") or "").strip()
        current_api_key = str(current.get("upstream_api_key") or "").strip()
        if next_api_url != current_api_url or next_api_key != current_api_key:
            await run_in_threadpool(_validate_upstream_or_raise, next_api_url, next_api_key)
        return {"config": config.update(next_values)}

    return router
