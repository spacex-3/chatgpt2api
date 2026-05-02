from __future__ import annotations

import json
import threading
import time
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Any

from services.config import DATA_DIR, config
from services.upstream_openai_image_client import UpstreamImageInput, UpstreamOpenAIImageClient

TASK_STATUS_QUEUED = "queued"
TASK_STATUS_RUNNING = "running"
TASK_STATUS_SUCCESS = "success"
TASK_STATUS_ERROR = "error"
TERMINAL_STATUSES = {TASK_STATUS_SUCCESS, TASK_STATUS_ERROR}
UNFINISHED_STATUSES = {TASK_STATUS_QUEUED, TASK_STATUS_RUNNING}
SUPPORTED_IMAGE_MODEL = "gpt-image-2"


def _now_iso() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _timestamp(value: object) -> float:
    if not isinstance(value, str) or not value.strip():
        return 0.0
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(value[:26], fmt).timestamp()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except Exception:
        return 0.0


def _clean(value: object, default: str = "") -> str:
    return str(value or default).strip()


def _owner_id(identity: dict[str, object]) -> str:
    return _clean(identity.get("id")) or "anonymous"


def _owner_name(identity: dict[str, object]) -> str:
    return _clean(identity.get("name")) or _owner_id(identity)


def _owner_role(identity: dict[str, object]) -> str:
    return _clean(identity.get("role"), "user") or "user"


def _credential_id(identity: dict[str, object]) -> str:
    return _clean(identity.get("credential_id")) or _owner_id(identity)


def _credential_label(identity: dict[str, object]) -> str:
    return _clean(identity.get("credential_label")) or _owner_name(identity)


def _safe_credential_label(value: object) -> str:
    normalized = _clean(value)
    if not normalized:
        return ""
    if " · " in normalized:
        host, suffix = normalized.rsplit(" · ", 1)
        safe_suffix = suffix[-4:] if len(suffix) >= 4 else ("key" if suffix else "anon")
        return f"{host} · {safe_suffix}"
    if normalized.startswith("sk-"):
        return f"sk-...{normalized[-4:]}" if len(normalized) > 7 else "••••"
    return normalized


def _task_key(owner_id: str, task_id: str) -> str:
    return f"{owner_id}:{task_id}"


def _public_task(task: dict[str, Any], *, include_owner: bool = False, include_data: bool = True) -> dict[str, Any]:
    raw_data = task.get("data") if isinstance(task.get("data"), list) else []
    item = {
        "id": task.get("id"),
        "status": task.get("status"),
        "mode": task.get("mode") or "generate",
        "model": task.get("model"),
        "size": task.get("size"),
        "n": task.get("n") or 1,
        "prompt": task.get("prompt") or "",
        "conversation_id": task.get("conversation_id") or task.get("id"),
        "conversation_title": task.get("conversation_title") or "",
        "created_at": task.get("created_at"),
        "updated_at": task.get("updated_at"),
        "result_count": len(raw_data),
    }
    if include_owner:
        item["owner_id"] = task.get("owner_id")
        item["owner_name"] = task.get("owner_name")
        item["owner_role"] = task.get("owner_role") or "user"
        item["credential_id"] = task.get("credential_id") or task.get("owner_id")
        item["credential_label"] = _safe_credential_label(task.get("credential_label") or task.get("owner_name"))
    if include_data and task.get("data") is not None:
        item["data"] = task.get("data")
    if task.get("error"):
        item["error"] = task.get("error")
    return item


def _default_generation_handler(payload: dict[str, Any]) -> dict[str, Any]:
    return UpstreamOpenAIImageClient(
        api_url=str(payload.get("upstream_api_url") or "") or None,
        api_key=str(payload.get("upstream_api_key") or "") or None,
    ).generate(
        prompt=str(payload.get("prompt") or ""),
        model=str(payload.get("model") or SUPPORTED_IMAGE_MODEL),
        n=int(payload.get("n") or 1),
        size=str(payload.get("size") or "").strip() or None,
        base_url=str(payload.get("base_url") or "").strip() or None,
    )


def _default_edit_handler(payload: dict[str, Any]) -> dict[str, Any]:
    return UpstreamOpenAIImageClient(
        api_url=str(payload.get("upstream_api_url") or "") or None,
        api_key=str(payload.get("upstream_api_key") or "") or None,
    ).edit(
        prompt=str(payload.get("prompt") or ""),
        model=str(payload.get("model") or SUPPORTED_IMAGE_MODEL),
        n=int(payload.get("n") or 1),
        size=str(payload.get("size") or "").strip() or None,
        images=list(payload.get("images") or []),
        base_url=str(payload.get("base_url") or "").strip() or None,
    )


class ImageTaskService:
    def __init__(
        self,
        path: Path,
        *,
        generation_handler: Callable[[dict[str, Any]], dict[str, Any]] = _default_generation_handler,
        edit_handler: Callable[[dict[str, Any]], dict[str, Any]] = _default_edit_handler,
        retention_days_getter: Callable[[], int] | None = None,
    ):
        self.path = path
        self.generation_handler = generation_handler
        self.edit_handler = edit_handler
        self.retention_days_getter = retention_days_getter or (lambda: config.image_retention_days)
        self._lock = threading.RLock()
        self._tasks: dict[str, dict[str, Any]] = {}
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._lock:
            self._tasks = self._load_locked()
            changed = self._recover_unfinished_locked()
            changed = self._cleanup_locked() or changed
            if changed:
                self._save_locked()

    def submit_generation(
        self,
        identity: dict[str, object],
        *,
        client_task_id: str,
        prompt: str,
        model: str,
        n: int,
        size: str | None,
        base_url: str,
        conversation_id: str | None = None,
        conversation_title: str | None = None,
    ) -> dict[str, Any]:
        payload = {
            "prompt": prompt,
            "model": model,
            "n": n,
            "size": size,
            "base_url": base_url,
            "upstream_api_url": _clean(identity.get("upstream_api_url")),
            "upstream_api_key": _clean(identity.get("upstream_api_key")),
        }
        return self._submit(
            identity,
            client_task_id=client_task_id,
            mode="generate",
            payload=payload,
            handler=self.generation_handler,
            conversation_id=conversation_id,
            conversation_title=conversation_title,
        )

    def submit_edit(
        self,
        identity: dict[str, object],
        *,
        client_task_id: str,
        prompt: str,
        model: str,
        n: int,
        size: str | None,
        base_url: str,
        images: list[UpstreamImageInput],
        conversation_id: str | None = None,
        conversation_title: str | None = None,
    ) -> dict[str, Any]:
        payload = {
            "prompt": prompt,
            "model": model,
            "n": n,
            "size": size,
            "base_url": base_url,
            "images": images,
            "upstream_api_url": _clean(identity.get("upstream_api_url")),
            "upstream_api_key": _clean(identity.get("upstream_api_key")),
        }
        return self._submit(
            identity,
            client_task_id=client_task_id,
            mode="edit",
            payload=payload,
            handler=self.edit_handler,
            conversation_id=conversation_id,
            conversation_title=conversation_title,
        )

    def list_tasks(self, identity: dict[str, object], task_ids: list[str]) -> dict[str, Any]:
        owner = _owner_id(identity)
        requested_ids = [_clean(task_id) for task_id in task_ids if _clean(task_id)]
        with self._lock:
            if self._cleanup_locked():
                self._save_locked()
            items: list[dict[str, Any]] = []
            missing_ids: list[str] = []
            for task_id in requested_ids:
                task = self._tasks.get(_task_key(owner, task_id))
                if task is None:
                    missing_ids.append(task_id)
                else:
                    items.append(_public_task(task))
            if not requested_ids:
                items = [
                    _public_task(task, include_data=False)
                    for task in self._tasks.values()
                    if task.get("owner_id") == owner
                ]
                items.sort(key=lambda item: str(item.get("updated_at") or ""), reverse=True)
                missing_ids = []
            return {"items": items, "missing_ids": missing_ids}

    def list_all_tasks(self, limit: int = 200) -> dict[str, Any]:
        try:
            safe_limit = max(1, min(int(limit), 1000))
        except Exception:
            safe_limit = 200
        with self._lock:
            if self._cleanup_locked():
                self._save_locked()
            items = [_public_task(task, include_owner=True) for task in self._tasks.values()]
            items.sort(key=lambda item: str(item.get("updated_at") or ""), reverse=True)
            return {"items": items[:safe_limit], "missing_ids": []}

    def delete_conversation(self, identity: dict[str, object], conversation_id: str) -> int:
        owner = _owner_id(identity)
        target = _clean(conversation_id)
        if not target:
            return 0
        with self._lock:
            keys = [
                key for key, task in self._tasks.items()
                if task.get("owner_id") == owner and _clean(task.get("conversation_id") or task.get("id")) == target
            ]
            for key in keys:
                self._tasks.pop(key, None)
            if keys:
                self._save_locked()
            return len(keys)

    def clear_history(self, identity: dict[str, object]) -> int:
        owner = _owner_id(identity)
        with self._lock:
            keys = [key for key, task in self._tasks.items() if task.get("owner_id") == owner]
            for key in keys:
                self._tasks.pop(key, None)
            if keys:
                self._save_locked()
            return len(keys)

    def _submit(
        self,
        identity: dict[str, object],
        *,
        client_task_id: str,
        mode: str,
        payload: dict[str, Any],
        handler: Callable[[dict[str, Any]], dict[str, Any]],
        conversation_id: str | None,
        conversation_title: str | None,
    ) -> dict[str, Any]:
        task_id = _clean(client_task_id)
        if not task_id:
            raise ValueError("client_task_id is required")
        owner = _owner_id(identity)
        key = _task_key(owner, task_id)
        now = _now_iso()
        with self._lock:
            cleaned = self._cleanup_locked()
            task = self._tasks.get(key)
            if task is not None:
                if cleaned:
                    self._save_locked()
                return _public_task(task)
            task = {
                "id": task_id,
                "owner_id": owner,
                "owner_name": _owner_name(identity),
                "owner_role": _owner_role(identity),
                "credential_id": _credential_id(identity),
                "credential_label": _credential_label(identity),
                "status": TASK_STATUS_QUEUED,
                "mode": mode,
                "model": _clean(payload.get("model"), SUPPORTED_IMAGE_MODEL),
                "size": _clean(payload.get("size")),
                "n": int(payload.get("n") or 1),
                "prompt": _clean(payload.get("prompt")),
                "conversation_id": _clean(conversation_id) or task_id,
                "conversation_title": _clean(conversation_title),
                "created_at": now,
                "updated_at": now,
            }
            self._tasks[key] = task
            self._save_locked()
        thread = threading.Thread(target=self._run_task, args=(key, handler, payload), name=f"image-task-{task_id[:16]}", daemon=True)
        thread.start()
        return _public_task(task)

    def _run_task(self, key: str, handler: Callable[[dict[str, Any]], dict[str, Any]], payload: dict[str, Any]) -> None:
        self._update_task(key, status=TASK_STATUS_RUNNING, error="")
        try:
            result = handler(payload)
            if not isinstance(result, dict):
                raise RuntimeError("image task returned invalid payload")
            data = result.get("data")
            if not isinstance(data, list) or not data:
                message = _clean(result.get("message")) or "image task returned no image data"
                raise RuntimeError(message)
            self._update_task(key, status=TASK_STATUS_SUCCESS, data=data, error="")
        except Exception as exc:
            self._update_task(key, status=TASK_STATUS_ERROR, error=str(exc) or "image task failed", data=[])

    def _update_task(self, key: str, **updates: Any) -> None:
        with self._lock:
            task = self._tasks.get(key)
            if task is None:
                return
            task.update(updates)
            task["updated_at"] = _now_iso()
            self._save_locked()

    def _load_locked(self) -> dict[str, dict[str, Any]]:
        if not self.path.exists():
            return {}
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except Exception:
            return {}
        raw_items = raw.get("tasks") if isinstance(raw, dict) else raw
        if not isinstance(raw_items, list):
            return {}
        tasks: dict[str, dict[str, Any]] = {}
        for item in raw_items:
            if not isinstance(item, dict):
                continue
            task_id = _clean(item.get("id"))
            owner = _clean(item.get("owner_id"))
            if not task_id or not owner:
                continue
            status = _clean(item.get("status"))
            if status not in {TASK_STATUS_QUEUED, TASK_STATUS_RUNNING, TASK_STATUS_SUCCESS, TASK_STATUS_ERROR}:
                status = TASK_STATUS_ERROR
            task = {
                "id": task_id,
                "owner_id": owner,
                "owner_name": _clean(item.get("owner_name"), owner),
                "owner_role": _clean(item.get("owner_role"), "user") or "user",
                "credential_id": _clean(item.get("credential_id")) or owner,
                "credential_label": _clean(item.get("credential_label")) or _clean(item.get("owner_name"), owner),
                "status": status,
                "mode": _clean(item.get("mode"), "generate") or "generate",
                "model": _clean(item.get("model"), SUPPORTED_IMAGE_MODEL),
                "size": _clean(item.get("size")),
                "n": int(item.get("n") or 1),
                "prompt": _clean(item.get("prompt")),
                "conversation_id": _clean(item.get("conversation_id")) or task_id,
                "conversation_title": _clean(item.get("conversation_title")),
                "created_at": _clean(item.get("created_at"), _now_iso()),
                "updated_at": _clean(item.get("updated_at"), _clean(item.get("created_at"), _now_iso())),
            }
            data = item.get("data")
            if isinstance(data, list):
                task["data"] = data
            error = _clean(item.get("error"))
            if error:
                task["error"] = error
            tasks[_task_key(owner, task_id)] = task
        return tasks

    def _save_locked(self) -> None:
        items = sorted(self._tasks.values(), key=lambda item: str(item.get("updated_at") or ""), reverse=True)
        tmp_path = self.path.with_suffix(self.path.suffix + ".tmp")
        tmp_path.write_text(json.dumps({"tasks": items}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        tmp_path.replace(self.path)

    def _recover_unfinished_locked(self) -> bool:
        changed = False
        for task in self._tasks.values():
            if task.get("status") in UNFINISHED_STATUSES:
                task["status"] = TASK_STATUS_ERROR
                task["error"] = "服务已重启，未完成的图片任务已中断"
                task["updated_at"] = _now_iso()
                changed = True
        return changed

    def _cleanup_locked(self) -> bool:
        try:
            retention_days = max(1, int(self.retention_days_getter()))
        except Exception:
            retention_days = 30
        cutoff = time.time() - retention_days * 86400
        removed_keys = [
            key
            for key, task in self._tasks.items()
            if task.get("status") in TERMINAL_STATUSES and _timestamp(task.get("updated_at")) < cutoff
        ]
        for key in removed_keys:
            self._tasks.pop(key, None)
        return bool(removed_keys)


image_task_service = ImageTaskService(DATA_DIR / "image_tasks.json")
