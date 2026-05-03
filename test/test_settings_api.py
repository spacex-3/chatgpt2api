from __future__ import annotations

import unittest
from unittest import mock

try:
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
except ImportError:  # pragma: no cover - depends on optional test deps
    FastAPI = None  # type: ignore[assignment]
    TestClient = None  # type: ignore[assignment]
    system_api = None  # type: ignore[assignment]
else:
    import api.system as system_api


class FakeConfig:
    def __init__(self) -> None:
        self.data = {
            "upstream_api_url": "https://admin.example.com/v1",
            "upstream_api_key": "sk-admin",
            "proxy": "",
            "base_url": "https://public.example.com",
            "image_retention_days": 30,
            "max_images_per_request": 10,
        }

    @property
    def base_url(self) -> str:
        return str(self.data.get("base_url") or "")

    @property
    def max_images_per_request(self) -> int:
        return int(self.data.get("max_images_per_request") or 10)

    def get(self) -> dict[str, object]:
        return {
            **self.data,
            "model": "gpt-image-2",
        }

    def get_admin_public(self) -> dict[str, object]:
        current = self.get()
        return {
            **current,
            "upstream_api_key": "",
            "upstream_api_key_configured": True,
            "upstream_api_key_masked": "sk-...dmin",
        }

    def update(self, data: dict[str, object]) -> dict[str, object]:
        self.data.update(data)
        return self.get()


@unittest.skipIf(FastAPI is None or TestClient is None, "fastapi test dependencies are not installed")
class SettingsApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fake_config = FakeConfig()
        app = FastAPI()
        app.include_router(system_api.create_router("0.1.0"))
        self.client = TestClient(app)

    def test_user_get_settings_includes_max_images_per_request(self) -> None:
        with mock.patch.object(
            system_api,
            "require_identity",
            return_value={
                "id": "user-1",
                "name": "User",
                "role": "user",
                "upstream_api_url": "https://user.example.com/v1",
                "upstream_api_key": "sk-user",
            },
        ), mock.patch.object(system_api, "config", self.fake_config):
            self.fake_config.data["max_images_per_request"] = 4

            response = self.client.get("/api/settings", headers={"Authorization": "Bearer token"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["config"]["max_images_per_request"], 4)
        self.assertEqual(response.json()["config"]["model"], "gpt-image-2")

    def test_admin_can_update_max_images_per_request(self) -> None:
        admin_identity = {"id": "admin", "name": "系统管理员", "role": "admin"}
        with mock.patch.object(system_api, "require_identity", return_value=admin_identity), mock.patch.object(
            system_api,
            "require_admin",
            return_value=admin_identity,
        ), mock.patch.object(system_api, "config", self.fake_config):
            response = self.client.post(
                "/api/settings",
                json={"max_images_per_request": 3},
                headers={"Authorization": "Bearer token"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["config"]["max_images_per_request"], 3)
        self.assertEqual(self.fake_config.max_images_per_request, 3)


if __name__ == "__main__":
    unittest.main()
