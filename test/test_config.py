from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from services.config import ConfigStore, _read_json_object


class ConfigLoadingTests(unittest.TestCase):
    def test_read_json_object_ignores_directory_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "config.json"
            path.mkdir()

            settings = _read_json_object(path, name="config.json")

            self.assertEqual(settings, {})

    def test_config_store_normalizes_values(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "config.json"
            path.write_text(json.dumps({"image_retention_days": 15}), encoding="utf-8")

            store = ConfigStore(path)
            updated = store.update({
                "upstream_api_url": "https://unit.test/v1/",
                "upstream_api_key": "sk-unit",
                "proxy": " http://127.0.0.1:7890 ",
                "base_url": "https://public.test/",
                "image_retention_days": "7",
                "max_images_per_request": "6",
            })

            self.assertEqual(updated["upstream_api_url"], "https://unit.test/v1")
            self.assertEqual(updated["upstream_api_key"], "sk-unit")
            self.assertEqual(updated["proxy"], "http://127.0.0.1:7890")
            self.assertEqual(updated["base_url"], "https://public.test")
            self.assertEqual(updated["image_retention_days"], 7)
            self.assertEqual(updated["max_images_per_request"], 6)
            self.assertEqual(updated["model"], "gpt-image-2")

    def test_get_admin_public_masks_upstream_api_key(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "config.json"
            path.write_text(json.dumps({
                "upstream_api_url": "https://unit.test/v1",
                "upstream_api_key": "sk-secret-9876",
            }), encoding="utf-8")

            store = ConfigStore(path)
            public = store.get_admin_public()

            self.assertEqual(public["upstream_api_url"], "https://unit.test/v1")
            self.assertEqual(public["upstream_api_key"], "")
            self.assertEqual(public["upstream_api_key_masked"], "sk-...9876")
            self.assertTrue(public["upstream_api_key_configured"])

    def test_max_images_per_request_defaults_to_10_when_value_is_too_large(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "config.json"
            path.write_text(json.dumps({"max_images_per_request": 99}), encoding="utf-8")

            store = ConfigStore(path)

            self.assertEqual(store.max_images_per_request, 10)

    def test_max_images_per_request_can_be_overridden_by_env(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir, mock.patch.dict(
            os.environ,
            {"CHATGPT2API_MAX_IMAGES_PER_REQUEST": "4"},
            clear=False,
        ):
            path = Path(tmp_dir) / "config.json"
            path.write_text(json.dumps({"max_images_per_request": 9}), encoding="utf-8")

            store = ConfigStore(path)

            self.assertEqual(store.max_images_per_request, 4)

    def test_config_store_can_migrate_legacy_root_config(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            data_path = Path(tmp_dir) / "data" / "config.json"
            legacy_path = Path(tmp_dir) / "config.json"
            legacy_path.write_text(json.dumps({"base_url": "https://legacy.test"}), encoding="utf-8")

            store = ConfigStore(data_path, legacy_path=legacy_path)

            self.assertEqual(store.base_url, "https://legacy.test")
            self.assertTrue(data_path.exists())


if __name__ == "__main__":
    unittest.main()
