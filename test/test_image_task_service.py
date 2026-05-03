from __future__ import annotations

import base64
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

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
ADMIN_OWNER = {
    **OWNER,
    "id": "admin-1",
    "name": "Admin",
    "role": "admin",
    "credential_id": "cred-admin-1",
    "credential_label": "upstream-admin.example.com · 9012",
}
PNG_1X1 = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc`\x00\x01"
    b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)
PNG_1X1_B64 = base64.b64encode(PNG_1X1).decode("ascii")


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

    def test_submit_generation_keeps_raw_prompt_in_service_payload_and_history(self):
        captured_payload: dict[str, object] = {}

        def generation_handler(payload):
            captured_payload.update(payload)
            return {"data": [{"url": "http://example.test/1.png"}]}

        service = self.make_service(generation_handler=generation_handler)
        service.submit_generation(
            OWNER,
            client_task_id="task-1",
            prompt="我的头发是白色的",
            model="gpt-image-2",
            n=1,
            size=None,
            base_url="http://local.test",
        )
        finished = wait_for_task(service, OWNER, "task-1", "success")

        self.assertEqual(captured_payload["prompt"], "我的头发是白色的")
        self.assertEqual(finished["prompt"], "我的头发是白色的")

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

    def test_submit_generation_admin_can_use_up_to_ten_even_when_user_limit_is_lower(self):
        captured_payload: dict[str, object] = {}

        def generation_handler(payload):
            captured_payload.update(payload)
            return {"data": [{"url": "http://example.test/1.png"}]}

        service = self.make_service(generation_handler=generation_handler)
        with mock.patch("services.image_task_service.config", SimpleNamespace(max_images_per_request=4)):
            queued = service.submit_generation(
                ADMIN_OWNER,
                client_task_id="task-admin-1",
                prompt="cat",
                model="gpt-image-2",
                n=10,
                size=None,
                base_url="http://local.test",
            )
        wait_for_task(service, ADMIN_OWNER, "task-admin-1", "success")

        self.assertEqual(queued["n"], 10)
        self.assertEqual(captured_payload["n"], 10)

    def test_submit_generation_user_still_respects_configured_max(self):
        service = self.make_service()
        with mock.patch("services.image_task_service.config", SimpleNamespace(max_images_per_request=4)):
            with self.assertRaisesRegex(ValueError, "n must be between 1 and 4"):
                service.submit_generation(
                    OWNER,
                    client_task_id="task-user-limit",
                    prompt="cat",
                    model="gpt-image-2",
                    n=5,
                    size=None,
                    base_url="http://local.test",
                )

    def test_admin_listing_keeps_preview_thumbnails_lightweight_but_detail_returns_full_media(self):
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        images_dir = Path(temp_dir.name) / "images"
        image_store_config = SimpleNamespace(images_dir=images_dir, base_url="", cleanup_old_images=lambda: 0)

        def edit_handler(_payload):
            return {
                "data": [
                    {
                        "b64_json": PNG_1X1_B64,
                        "url": "http://example.test/generated.png",
                    },
                ],
            }

        service = self.make_service(edit_handler=edit_handler)
        with mock.patch("services.local_image_store.config", image_store_config):
            queued = service.submit_edit(
                OWNER,
                client_task_id="task-edit-1",
                prompt="make it blue",
                model="gpt-image-2",
                n=1,
                size=None,
                base_url="http://local.test",
                images=[{
                    "filename": "source.png",
                    "content_type": "image/png",
                    "data": PNG_1X1,
                }],
                conversation_id="conv-edit-1",
            )
            finished = wait_for_task(service, OWNER, "task-edit-1", "success")

        self.assertEqual(len(queued.get("source_images") or []), 1)
        self.assertTrue(str(queued["source_images"][0]["url"]).startswith("http://local.test/images/sources/"))
        self.assertTrue(str(queued["source_images"][0]["thumbnail_url"]).startswith("http://local.test/images/_thumbs/sources/"))
        self.assertEqual(len(finished.get("preview_images") or []), 1)
        self.assertTrue(str(finished["preview_images"][0]["thumbnail_url"]).startswith("http://local.test/images/_thumbs/results/"))

        admin_list = service.list_admin_tasks(limit=200)
        self.assertEqual(len(admin_list["items"]), 1)
        list_item = admin_list["items"][0]
        self.assertNotIn("data", list_item)
        self.assertEqual(list_item["source_images"][0]["filename"], "source.png")
        self.assertNotIn("url", list_item["source_images"][0])

        detail = service.get_admin_task("owner-1", "task-edit-1")
        self.assertIsNotNone(detail)
        assert detail is not None
        self.assertEqual(len(detail.get("data") or []), 1)
        self.assertTrue(str(detail["source_images"][0]["url"]).startswith("http://local.test/images/sources/"))

    def test_list_admin_tasks_supports_filters(self):
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        images_dir = Path(temp_dir.name) / "images"
        image_store_config = SimpleNamespace(images_dir=images_dir, base_url="", cleanup_old_images=lambda: 0)

        service = self.make_service(edit_handler=lambda _payload: {"data": [{"b64_json": PNG_1X1_B64}]})
        service.submit_generation(
            OWNER,
            client_task_id="task-gen-1",
            prompt="cat",
            model="gpt-image-2",
            n=1,
            size=None,
            base_url="http://local.test",
        )
        wait_for_task(service, OWNER, "task-gen-1", "success")

        with mock.patch("services.local_image_store.config", image_store_config):
            service.submit_edit(
                OTHER_OWNER,
                client_task_id="task-edit-2",
                prompt="dog",
                model="gpt-image-2",
                n=1,
                size=None,
                base_url="http://local.test",
                images=[{
                    "filename": "source.png",
                    "content_type": "image/png",
                    "data": PNG_1X1,
                }],
            )
            wait_for_task(service, OTHER_OWNER, "task-edit-2", "success")

        with service._lock:
            service._tasks["owner-1:task-gen-1"]["updated_at"] = "2026-05-03 10:00:00"
            service._tasks["owner-2:task-edit-2"]["updated_at"] = "2026-05-03 11:00:00"
            service._save_locked()

        filtered = service.list_admin_tasks(
            limit=200,
            credential_query="5678",
            mode="edit",
            updated_from="2026-05-03T10:30",
            updated_to="2026-05-03T11:30",
        )

        self.assertEqual([item["id"] for item in filtered["items"]], ["task-edit-2"])
        self.assertEqual(filtered["items"][0]["credential_label"], "upstream-b.example.com · 5678")


if __name__ == "__main__":
    unittest.main()
