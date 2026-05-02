from __future__ import annotations

import tempfile
import time
import unittest
from pathlib import Path

from services.image_task_service import ImageTaskService


OWNER = {
    "id": "owner-1",
    "name": "Owner",
    "role": "user",
    "upstream_api_url": "https://upstream-a.example.com/v1",
    "upstream_api_key": "sk-owner-1234",
    "credential_id": "cred-owner-1",
    "credential_label": "upstream-a.example.com · 1234",
}
OTHER_OWNER = {
    "id": "owner-2",
    "name": "Other",
    "role": "user",
    "upstream_api_url": "https://upstream-b.example.com/v1",
    "upstream_api_key": "sk-other-5678",
    "credential_id": "cred-owner-2",
    "credential_label": "upstream-b.example.com · 5678",
}


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
    def make_service(self, generation_handler=None, edit_handler=None) -> ImageTaskService:
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        path = Path(temp_dir.name) / "image_tasks.json"
        return ImageTaskService(
            path,
            generation_handler=generation_handler or (lambda payload: {"data": [{"url": "http://example.test/1.png"}]}),
            edit_handler=edit_handler or (lambda payload: {"data": [{"url": "http://example.test/edit.png"}]}),
            retention_days_getter=lambda: 30,
        )

    def test_submit_generation_and_list_history(self):
        service = self.make_service()
        queued = service.submit_generation(
            OWNER,
            client_task_id="task-1",
            prompt="orange cat",
            model="gpt-image-2",
            n=3,
            size="1024x1024",
            base_url="http://local.test",
            conversation_id="conv-1",
            conversation_title="橘猫",
        )
        self.assertEqual(queued["conversation_id"], "conv-1")
        self.assertEqual(queued["prompt"], "orange cat")
        self.assertEqual(queued["n"], 3)

        finished = wait_for_task(service, OWNER, "task-1", "success")
        self.assertEqual(finished["conversation_title"], "橘猫")
        self.assertEqual(len(finished.get("data") or []), 1)

        history = service.list_tasks(OWNER, [])
        self.assertEqual(len(history["items"]), 1)
        self.assertEqual(history["items"][0]["id"], "task-1")

    def test_list_tasks_keeps_owners_isolated(self):
        service = self.make_service()
        service.submit_generation(
            OWNER,
            client_task_id="task-1",
            prompt="cat",
            model="gpt-image-2",
            n=1,
            size=None,
            base_url="http://local.test",
        )
        service.submit_generation(
            OTHER_OWNER,
            client_task_id="task-1",
            prompt="dog",
            model="gpt-image-2",
            n=1,
            size=None,
            base_url="http://local.test",
        )
        wait_for_task(service, OWNER, "task-1", "success")
        wait_for_task(service, OTHER_OWNER, "task-1", "success")

        owner_history = service.list_tasks(OWNER, [])
        other_history = service.list_tasks(OTHER_OWNER, [])
        self.assertEqual(len(owner_history["items"]), 1)
        self.assertEqual(len(other_history["items"]), 1)
        self.assertEqual(owner_history["items"][0]["prompt"], "cat")
        self.assertEqual(other_history["items"][0]["prompt"], "dog")

    def test_list_all_tasks_includes_owner_fields(self):
        service = self.make_service()
        service.submit_generation(
            OWNER,
            client_task_id="task-1",
            prompt="cat",
            model="gpt-image-2",
            n=1,
            size=None,
            base_url="http://local.test",
        )
        wait_for_task(service, OWNER, "task-1", "success")

        result = service.list_all_tasks()
        self.assertEqual(len(result["items"]), 1)
        self.assertEqual(result["items"][0]["owner_id"], "owner-1")
        self.assertEqual(result["items"][0]["owner_name"], "Owner")
        self.assertEqual(result["items"][0]["owner_role"], "user")
        self.assertEqual(result["items"][0]["credential_id"], "cred-owner-1")
        self.assertEqual(result["items"][0]["credential_label"], "upstream-a.example.com · 1234")

    def test_list_all_tasks_sanitizes_short_credential_labels(self):
        service = self.make_service()
        short_owner = {
            **OWNER,
            "id": "owner-short",
            "credential_id": "cred-owner-short",
            "credential_label": "upstream-a.example.com · abc",
        }
        service.submit_generation(
            short_owner,
            client_task_id="task-1",
            prompt="cat",
            model="gpt-image-2",
            n=1,
            size=None,
            base_url="http://local.test",
        )
        wait_for_task(service, short_owner, "task-1", "success")

        result = service.list_all_tasks()
        self.assertEqual(result["items"][0]["credential_label"], "upstream-a.example.com · key")

    def test_submit_generation_uses_identity_upstream_credentials(self):
        captured_payload: dict[str, object] = {}

        def generation_handler(payload):
            captured_payload.update(payload)
            return {"data": [{"url": "http://example.test/1.png"}]}

        service = self.make_service(generation_handler=generation_handler)
        service.submit_generation(
            OWNER,
            client_task_id="task-1",
            prompt="cat",
            model="gpt-image-2",
            n=1,
            size=None,
            base_url="http://local.test",
        )
        wait_for_task(service, OWNER, "task-1", "success")

        self.assertEqual(captured_payload["upstream_api_url"], OWNER["upstream_api_url"])
        self.assertEqual(captured_payload["upstream_api_key"], OWNER["upstream_api_key"])

    def test_delete_conversation_only_removes_matching_owner_records(self):
        service = self.make_service()
        for task_id in ("task-1", "task-2"):
            service.submit_generation(
                OWNER,
                client_task_id=task_id,
                prompt="cat",
                model="gpt-image-2",
                n=1,
                size=None,
                base_url="http://local.test",
                conversation_id="conv-1",
            )
        service.submit_generation(
            OWNER,
            client_task_id="task-3",
            prompt="dog",
            model="gpt-image-2",
            n=1,
            size=None,
            base_url="http://local.test",
            conversation_id="conv-2",
        )
        for task_id in ("task-1", "task-2", "task-3"):
            wait_for_task(service, OWNER, task_id, "success")

        deleted = service.delete_conversation(OWNER, "conv-1")
        self.assertEqual(deleted, 2)
        history = service.list_tasks(OWNER, [])
        self.assertEqual([item["id"] for item in history["items"]], ["task-3"])

    def test_clear_history_only_removes_current_owner(self):
        service = self.make_service()
        service.submit_generation(OWNER, client_task_id="task-1", prompt="cat", model="gpt-image-2", n=1, size=None, base_url="http://local.test")
        service.submit_generation(OTHER_OWNER, client_task_id="task-2", prompt="dog", model="gpt-image-2", n=1, size=None, base_url="http://local.test")
        wait_for_task(service, OWNER, "task-1", "success")
        wait_for_task(service, OTHER_OWNER, "task-2", "success")

        deleted = service.clear_history(OWNER)
        self.assertEqual(deleted, 1)
        self.assertEqual(service.list_tasks(OWNER, [])["items"], [])
        self.assertEqual(len(service.list_tasks(OTHER_OWNER, [])["items"]), 1)


if __name__ == "__main__":
    unittest.main()
