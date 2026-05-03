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
            submit_generation=mock.Mock(return_value={"id": "task-1", "status": "queued", "n": 4}),
            submit_edit=mock.Mock(return_value={"id": "task-1", "status": "queued", "n": 4}),
        )
        self.patches = [
            mock.patch.object(
                image_tasks_api,
                "require_identity",
                return_value={
                    "id": "user-1",
                    "name": "User",
                    "role": "user",
                    "upstream_api_url": "https://user.example.com/v1",
                    "upstream_api_key": "sk-user",
                },
            ),
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


if __name__ == "__main__":
    unittest.main()
