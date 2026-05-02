from __future__ import annotations

import json
import tempfile
import time
import unittest
from pathlib import Path

from services.image_task_service import ImageTaskService


OWNER = {"id": "owner-1", "name": "Owner", "role": "admin"}
OTHER_OWNER = {"id": "owner-2", "name": "Other", "role": "admin"}


def wait_for_task(service: ImageTaskService, identity: dict[str, object], task_id: str, status: str, timeout: float = 2.0):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        result = service.list_tasks(identity, [task_id])
        last = (result.get("items") or [None])[0]
        if last and last.get("status") == status:
            return last
        time.sleep(0.02)
    raise AssertionError(f"task {task_id} did not reach {status}, last={last}")


class ImageTaskServiceTests(unittest.TestCase):
    def make_service(self, path: Path, generation_handler=None, edit_handler=None) -> ImageTaskService:
        return ImageTaskService(
            path,
            generation_handler=generation_handler or (lambda _payload: {"data": [{"url": "http://example.test/image.png"}]}),
            edit_handler=edit_handler or (lambda payload: {"data": [{"url": f"http://example.test/{len(payload.get('images') or [])}.png"}]}),
            retention_days_getter=lambda: 30,
        )

    def test_duplicate_submit_uses_existing_generation_task(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            calls = 0

            def handler(_payload):
                nonlocal calls
                calls += 1
                time.sleep(0.05)
                return {"data": [{"url": "http://example.test/image.png"}]}

            service = self.make_service(Path(tmp_dir) / "image_tasks.json", generation_handler=handler)
            first = service.submit_generation(
                OWNER,
                client_task_id="task-1",
                prompt="cat",
                model="gpt-image-2",
                n=1,
                size=None,
                base_url="http://local.test",
            )
            second = service.submit_generation(
                OWNER,
                client_task_id="task-1",
                prompt="cat",
                model="gpt-image-2",
                n=1,
                size=None,
                base_url="http://local.test",
            )

            self.assertEqual(first["id"], "task-1")
            self.assertEqual(second["id"], "task-1")
            task = wait_for_task(service, OWNER, "task-1", "success")
            self.assertEqual(task["mode"], "generate")
            self.assertEqual(task["data"][0]["url"], "http://example.test/image.png")
            self.assertEqual(calls, 1)

    def test_submit_generation_passes_n_to_handler(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            captured: list[dict[str, object]] = []

            def handler(payload: dict[str, object]):
                captured.append(payload)
                count = int(payload.get("n") or 1)
                return {
                    "data": [
                        {"url": f"http://example.test/image-{index}.png"}
                        for index in range(1, count + 1)
                    ]
                }

            service = self.make_service(Path(tmp_dir) / "image_tasks.json", generation_handler=handler)
            service.submit_generation(
                OWNER,
                client_task_id="multi-task",
                prompt="cat",
                model="gpt-image-2",
                n=3,
                size="1024x1024",
                base_url="http://local.test",
            )

            task = wait_for_task(service, OWNER, "multi-task", "success")
            self.assertEqual(captured[0]["n"], 3)
            self.assertEqual(len(task["data"]), 3)
            self.assertEqual(task["data"][2]["url"], "http://example.test/image-3.png")

    def test_submit_edit_passes_images_to_handler(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            captured: list[dict[str, object]] = []

            def edit_handler(payload: dict[str, object]):
                captured.append(payload)
                return {"data": [{"url": "http://example.test/edited.png"}]}

            service = self.make_service(Path(tmp_dir) / "image_tasks.json", edit_handler=edit_handler)
            service.submit_edit(
                OWNER,
                client_task_id="edit-task",
                prompt="edit this",
                model="gpt-image-2",
                n=1,
                size="1024x1024",
                base_url="http://local.test",
                images=[{"filename": "a.png", "content_type": "image/png", "data": b"abc"}],
            )

            task = wait_for_task(service, OWNER, "edit-task", "success")
            self.assertEqual(task["mode"], "edit")
            self.assertEqual(captured[0]["images"][0]["filename"], "a.png")
            self.assertEqual(task["data"][0]["url"], "http://example.test/edited.png")

    def test_different_owner_cannot_query_task(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = self.make_service(Path(tmp_dir) / "image_tasks.json")
            service.submit_generation(
                OWNER,
                client_task_id="private-task",
                prompt="cat",
                model="gpt-image-2",
                n=1,
                size=None,
                base_url="http://local.test",
            )

            wait_for_task(service, OWNER, "private-task", "success")
            result = service.list_tasks(OTHER_OWNER, ["private-task"])

            self.assertEqual(result["items"], [])
            self.assertEqual(result["missing_ids"], ["private-task"])

    def test_success_task_persists_to_new_service_instance(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "image_tasks.json"
            service = self.make_service(path)
            service.submit_generation(
                OWNER,
                client_task_id="persisted-task",
                prompt="cat",
                model="gpt-image-2",
                n=1,
                size=None,
                base_url="http://local.test",
            )
            wait_for_task(service, OWNER, "persisted-task", "success")

            reloaded = self.make_service(path)
            result = reloaded.list_tasks(OWNER, ["persisted-task"])

            self.assertEqual(result["missing_ids"], [])
            self.assertEqual(result["items"][0]["status"], "success")
            self.assertEqual(result["items"][0]["data"][0]["url"], "http://example.test/image.png")

    def test_startup_marks_unfinished_tasks_as_error(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "image_tasks.json"
            path.write_text(
                json.dumps(
                    {
                        "tasks": [
                            {
                                "id": "queued-task",
                                "owner_id": "owner-1",
                                "status": "queued",
                                "mode": "generate",
                                "model": "gpt-image-2",
                                "created_at": "2099-01-01 00:00:00",
                                "updated_at": "2099-01-01 00:00:00",
                            },
                            {
                                "id": "running-task",
                                "owner_id": "owner-1",
                                "status": "running",
                                "mode": "edit",
                                "model": "gpt-image-2",
                                "created_at": "2099-01-01 00:00:00",
                                "updated_at": "2099-01-01 00:00:00",
                            },
                        ]
                    }
                ),
                encoding="utf-8",
            )

            service = self.make_service(path)
            result = service.list_tasks(OWNER, ["queued-task", "running-task"])

            self.assertEqual([item["status"] for item in result["items"]], ["error", "error"])
            self.assertEqual([item["mode"] for item in result["items"]], ["generate", "edit"])
            self.assertTrue(all("已中断" in item.get("error", "") for item in result["items"]))


if __name__ == "__main__":
    unittest.main()
