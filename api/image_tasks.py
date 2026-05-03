from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, File, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field

from api.support import require_admin, require_identity, resolve_image_base_url
from services.config import config
from services.image_task_service import image_task_service
from services.upstream_openai_image_client import UpstreamImageInput

SUPPORTED_IMAGE_MODEL = "gpt-image-2"
ALLOWED_IMAGE_SIZES = ("auto", "1024x1024", "1536x1024", "1024x1536")


class ImageGenerationTaskRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    client_task_id: str = Field(..., min_length=1)
    prompt: str = Field(..., min_length=1)
    model: Literal["gpt-image-2"] = SUPPORTED_IMAGE_MODEL
    n: int = Field(default=1, ge=1, le=10)
    size: Literal["auto", "1024x1024", "1536x1024", "1024x1536"] | None = None
    conversation_id: str | None = None
    conversation_title: str | None = None


def _parse_task_ids(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def _parse_n_or_raise(value: object, *, max_n: int = 10) -> int:
    allowed_max = max(1, min(10, int(max_n or 10)))
    try:
        normalized = int(value or 1)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail={"error": "n must be an integer"}) from exc
    if normalized < 1 or normalized > allowed_max:
        raise HTTPException(status_code=400, detail={"error": f"n must be between 1 and {allowed_max}"})
    return normalized


def _parse_edit_uploads_or_raise(image: list[UploadFile] | None, image_list: list[UploadFile] | None) -> list[UploadFile]:
    uploads = [*(image or []), *(image_list or [])]
    if not uploads:
        raise HTTPException(status_code=400, detail={"error": "image file is required"})
    return uploads


def create_router() -> APIRouter:
    router = APIRouter()

    @router.get("/api/image-tasks")
    async def list_image_tasks(ids: str = Query(default=""), authorization: str | None = Header(default=None)):
        identity = require_identity(authorization)
        return await run_in_threadpool(image_task_service.list_tasks, identity, _parse_task_ids(ids))

    @router.delete("/api/image-tasks/history")
    async def clear_image_tasks(authorization: str | None = Header(default=None)):
        identity = require_identity(authorization)
        deleted = await run_in_threadpool(image_task_service.clear_history, identity)
        return {"ok": True, "deleted": deleted}

    @router.delete("/api/image-tasks/conversations/{conversation_id}")
    async def delete_image_task_conversation(conversation_id: str, authorization: str | None = Header(default=None)):
        identity = require_identity(authorization)
        deleted = await run_in_threadpool(image_task_service.delete_conversation, identity, conversation_id)
        return {"ok": True, "deleted": deleted}

    @router.get("/api/admin/image-tasks")
    async def list_admin_image_tasks(limit: int = Query(default=200, ge=1, le=1000), authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return await run_in_threadpool(image_task_service.list_all_tasks, limit)

    @router.post("/api/image-tasks/generations")
    async def create_generation_task(
        body: ImageGenerationTaskRequest,
        request: Request,
        authorization: str | None = Header(default=None),
    ):
        identity = require_identity(authorization)
        parsed_n = _parse_n_or_raise(body.n, max_n=config.max_images_per_request)
        try:
            return await run_in_threadpool(
                image_task_service.submit_generation,
                identity,
                client_task_id=body.client_task_id,
                prompt=body.prompt,
                model=body.model,
                n=parsed_n,
                size=body.size,
                base_url=resolve_image_base_url(request),
                conversation_id=body.conversation_id,
                conversation_title=body.conversation_title,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    @router.post("/api/image-tasks/edits")
    async def create_edit_task(
        request: Request,
        authorization: str | None = Header(default=None),
        image: list[UploadFile] | None = File(default=None),
        image_list: list[UploadFile] | None = File(default=None, alias="image[]"),
        client_task_id: str = Form(...),
        prompt: str = Form(...),
        model: str = Form(default=SUPPORTED_IMAGE_MODEL),
        n: int = Form(default=1),
        size: str | None = Form(default=None),
        conversation_id: str | None = Form(default=None),
        conversation_title: str | None = Form(default=None),
    ):
        identity = require_identity(authorization)
        if model != SUPPORTED_IMAGE_MODEL:
            raise HTTPException(status_code=400, detail={"error": f"model must be {SUPPORTED_IMAGE_MODEL}"})
        uploads = _parse_edit_uploads_or_raise(image, image_list)
        parsed_n = _parse_n_or_raise(n, max_n=config.max_images_per_request)
        images_payload: list[UpstreamImageInput] = []
        for upload in uploads:
            image_data = await upload.read()
            if not image_data:
                raise HTTPException(status_code=400, detail={"error": "image file is empty"})
            images_payload.append({
                "filename": upload.filename or "image.png",
                "content_type": upload.content_type or "image/png",
                "data": image_data,
            })
        try:
            return await run_in_threadpool(
                image_task_service.submit_edit,
                identity,
                client_task_id=client_task_id,
                prompt=prompt,
                model=model,
                n=parsed_n,
                size=size,
                base_url=resolve_image_base_url(request),
                images=images_payload,
                conversation_id=conversation_id,
                conversation_title=conversation_title,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    return router
