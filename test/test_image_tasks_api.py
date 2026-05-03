from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest import mock

try:
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
except ImportError:  # pragma: no cover - depends on optional test deps
    FastAPI = None  # type: ignore[assignment]
    TestClient = None  # type: ignore[assignment]
    image_tasks_api = None  # type: ignore[assignment]
else:
    import api.image_tasks as image_tasks_api


@unittest.skipIf(FastAPI is None or TestClient is None, "fastapi test dependencies are not installed")
class ImageTasksApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fake_service = SimpleNamespace(
            list_tasks=mock.Mock(return_value={"items": [], "missing_ids": []}),
            clear_history=mock.Mock(return_value=0),
            delete_conversation=mock.Mock(return_value=0),
            list_all_tasks=mock.Mock(return_value={"items": []}),
            list_admin_tasks=mock.Mock(return_value={"items": []}),
            get_admin_task=mock.Mock(return_value=None),
            submit_generation=mock.Mock(return_value={"id": "task-1", "status": "queued", "n": 4}),
            submit_edit=mock.Mock(return_value={"id": "task-1", "status": "queued", "n": 4}),
        )
        self.identity_patcher = mock.patch.object(
            image_tasks_api,
            "require_identity",
            return_value={
                "id": "user-1",
                "name": "User",
                "role": "user",
                "upstream_api_url": "https://user.example.com/v1",
                "upstream_api_key": "sk-user",
            },
        )
        self.patches = [
            self.identity_patcher,
            mock.patch.object(image_tasks_api, "require_admin", return_value={"id": "admin", "role": "admin"}),
            mock.patch.object(image_tasks_api, "resolve_image_base_url", return_value="http://local.test"),
            mock.patch.object(image_tasks_api, "image_task_service", self.fake_service),
            mock.patch.object(image_tasks_api, "config", SimpleNamespace(max_images_per_request=4)),
        ]
        for patcher in self.patches:
            patcher.start()
            self.addCleanup(patcher.stop)

        app = FastAPI()
        app.include_router(image_tasks_api.create_router())
        self.client = TestClient(app)

    def test_generation_rejects_n_above_configured_max(self) -> None:
        response = self.client.post(
            "/api/image-tasks/generations",
            json={
                "client_task_id": "task-1",
                "prompt": "cat",
                "model": "gpt-image-2",
                "n": 5,
            },
            headers={"Authorization": "Bearer token"},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"]["error"], "n must be between 1 and 4")
        self.fake_service.submit_generation.assert_not_called()

    def test_generation_accepts_n_at_configured_max(self) -> None:
        response = self.client.post(
            "/api/image-tasks/generations",
            json={
                "client_task_id": "task-1",
                "prompt": "cat",
                "model": "gpt-image-2",
                "n": 4,
            },
            headers={"Authorization": "Bearer token"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.fake_service.submit_generation.call_args.kwargs["n"], 4)

    def test_edit_rejects_n_above_configured_max(self) -> None:
        response = self.client.post(
            "/api/image-tasks/edits",
            data={
                "client_task_id": "task-1",
                "prompt": "cat",
                "model": "gpt-image-2",
                "n": "5",
            },
            files={"image": ("cat.png", b"png-bytes", "image/png")},
            headers={"Authorization": "Bearer token"},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"]["error"], "n must be between 1 and 4")
        self.fake_service.submit_edit.assert_not_called()

    def test_admin_generation_accepts_up_to_10(self) -> None:
        with mock.patch.object(
            image_tasks_api,
            "require_identity",
            return_value={
                "id": "admin",
                "name": "系统管理员",
                "role": "admin",
                "upstream_api_url": "https://admin.example.com/v1",
                "upstream_api_key": "sk-admin",
            },
        ):
            response = self.client.post(
                "/api/image-tasks/generations",
                json={
                    "client_task_id": "task-1",
                    "prompt": "cat",
                    "model": "gpt-image-2",
                    "n": 10,
                },
                headers={"Authorization": "Bearer token"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.fake_service.submit_generation.call_args.kwargs["n"], 10)

    def test_admin_edit_accepts_up_to_10(self) -> None:
        with mock.patch.object(
            image_tasks_api,
            "require_identity",
            return_value={
                "id": "admin",
                "name": "系统管理员",
                "role": "admin",
                "upstream_api_url": "https://admin.example.com/v1",
                "upstream_api_key": "sk-admin",
            },
        ):
            response = self.client.post(
                "/api/image-tasks/edits",
                data={
                    "client_task_id": "task-1",
                    "prompt": "cat",
                    "model": "gpt-image-2",
                    "n": "10",
                },
                files={"image": ("cat.png", b"png-bytes", "image/png")},
                headers={"Authorization": "Bearer token"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.fake_service.submit_edit.call_args.kwargs["n"], 10)

    def test_admin_list_uses_filters(self) -> None:
        response = self.client.get(
            "/api/admin/image-tasks?limit=50&credential_query=1234&mode=edit&updated_from=2026-05-01T00:00&updated_to=2026-05-03T23:59",
            headers={"Authorization": "Bearer token"},
        )

        self.assertEqual(response.status_code, 200)
        self.fake_service.list_admin_tasks.assert_called_once_with(
            limit=50,
            credential_query="1234",
            mode="edit",
            updated_from="2026-05-01T00:00",
            updated_to="2026-05-03T23:59",
        )

    def test_admin_detail_returns_item(self) -> None:
        self.fake_service.get_admin_task.return_value = {"id": "task-1", "owner_id": "owner-1"}

        response = self.client.get(
            "/api/admin/image-tasks/detail?owner_id=owner-1&task_id=task-1",
            headers={"Authorization": "Bearer token"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["item"]["id"], "task-1")

    def test_admin_detail_returns_404_when_missing(self) -> None:
        response = self.client.get(
            "/api/admin/image-tasks/detail?owner_id=owner-1&task_id=missing",
            headers={"Authorization": "Bearer token"},
        )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["detail"]["error"], "image task not found")


if __name__ == "__main__":
    unittest.main()
