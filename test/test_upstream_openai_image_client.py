from __future__ import annotations

import unittest
from unittest.mock import patch

from services.image_errors import ImageGenerationError
from services.upstream_openai_image_client import (
    UpstreamOpenAIImageClient,
    build_upstream_url,
    normalize_image_inputs,
    normalize_upstream_api_url,
    validate_image_request,
)


class UpstreamClientHelperTests(unittest.TestCase):
    def test_normalize_upstream_api_url(self):
        self.assertEqual(normalize_upstream_api_url("https://example.com/v1/"), "https://example.com/v1")

    def test_build_upstream_url_with_v1_suffix(self):
        self.assertEqual(build_upstream_url("https://example.com/v1", "/models"), "https://example.com/v1/models")

    def test_build_upstream_url_without_v1_suffix(self):
        self.assertEqual(build_upstream_url("https://example.com", "/images/generations"), "https://example.com/v1/images/generations")

    def test_invalid_upstream_api_url(self):
        with self.assertRaises(ValueError):
            normalize_upstream_api_url("not-a-url")

    def test_validate_image_request_accepts_supported_values(self):
        prompt, model, n, size = validate_image_request("cat", "gpt-image-2", 3, "1024x1024")
        self.assertEqual((prompt, model, n, size), ("cat", "gpt-image-2", 3, "1024x1024"))

    def test_validate_image_request_rejects_invalid_size(self):
        with self.assertRaisesRegex(ValueError, "size must be"):
            validate_image_request("cat", "gpt-image-2", 1, "512x512")

    def test_validate_image_request_rejects_invalid_n(self):
        with self.assertRaisesRegex(ValueError, "between 1 and 10"):
            validate_image_request("cat", "gpt-image-2", 11, None)

    def test_normalize_image_inputs_rejects_empty_value(self):
        with self.assertRaisesRegex(ValueError, "image is required"):
            normalize_image_inputs([])

    def test_normalize_image_inputs_accepts_bytes(self):
        images = normalize_image_inputs([{"filename": "a.png", "content_type": "image/png", "data": b"123"}])
        self.assertEqual(images[0]["filename"], "a.png")
        self.assertEqual(images[0]["content_type"], "image/png")
        self.assertEqual(images[0]["data"], b"123")


class UpstreamClientBehaviorTests(unittest.TestCase):
    def make_client(self) -> UpstreamOpenAIImageClient:
        return UpstreamOpenAIImageClient(api_url="https://example.com/v1", api_key="sk-test")

    def test_generate_single_image_uses_single_upstream_call(self):
        client = self.make_client()
        captured: list[tuple[str, str, str | None, str | None]] = []

        def fake_generate_once(*, prompt: str, model: str, size: str | None, base_url: str | None):
            captured.append((prompt, model, size, base_url))
            return {"created": 100, "data": [{"url": "http://example.test/1.png"}]}

        with patch.object(client, "_generate_once", side_effect=fake_generate_once):
            result = client.generate(prompt="cat", model="gpt-image-2", n=1, size="1024x1024", base_url="http://local.test")

        self.assertEqual(len(captured), 1)
        self.assertEqual(captured[0], ("cat", "gpt-image-2", "1024x1024", "http://local.test"))
        self.assertEqual(len(result["data"]), 1)
        self.assertEqual(result["data"][0]["url"], "http://example.test/1.png")

    def test_generate_multiple_images_fans_out_to_parallel_single_image_calls(self):
        client = self.make_client()
        call_indexes: list[int] = []

        def fake_generate_once(*, prompt: str, model: str, size: str | None, base_url: str | None):
            next_index = len(call_indexes) + 1
            call_indexes.append(next_index)
            return {"created": 100 + next_index, "data": [{"url": f"http://example.test/{next_index}.png"}]}

        with patch.object(client, "_generate_once", side_effect=fake_generate_once):
            result = client.generate(prompt="cat", model="gpt-image-2", n=3, size=None, base_url="http://local.test")

        self.assertEqual(len(call_indexes), 3)
        self.assertEqual(len(result["data"]), 3)
        self.assertEqual([item["url"] for item in result["data"]], [
            "http://example.test/1.png",
            "http://example.test/2.png",
            "http://example.test/3.png",
        ])

    def test_edit_multiple_images_fans_out_to_parallel_single_image_calls(self):
        client = self.make_client()
        call_indexes: list[int] = []
        images = [{"filename": "a.png", "content_type": "image/png", "data": b"123"}]

        def fake_edit_once(*, prompt: str, model: str, size: str | None, images, base_url: str | None):
            next_index = len(call_indexes) + 1
            call_indexes.append(next_index)
            self.assertEqual(images[0]["filename"], "a.png")
            return {"created": 200 + next_index, "data": [{"url": f"http://example.test/edit-{next_index}.png"}]}

        with patch.object(client, "_edit_once", side_effect=fake_edit_once):
            result = client.edit(prompt="edit cat", model="gpt-image-2", n=2, size="1024x1024", images=images, base_url="http://local.test")

        self.assertEqual(len(call_indexes), 2)
        self.assertEqual(len(result["data"]), 2)
        self.assertEqual([item["url"] for item in result["data"]], [
            "http://example.test/edit-1.png",
            "http://example.test/edit-2.png",
        ])

    def test_generate_parallel_failure_surfaces_count_and_original_error(self):
        client = self.make_client()

        def fake_generate_once(*, prompt: str, model: str, size: str | None, base_url: str | None):
            raise ImageGenerationError("upstream timeout", status_code=504, error_type="server_error", code="timeout")

        with patch.object(client, "_generate_once", side_effect=fake_generate_once):
            with self.assertRaisesRegex(ImageGenerationError, "3/3 concurrent upstream requests"):
                client.generate(prompt="cat", model="gpt-image-2", n=3, size=None, base_url="http://local.test")

    def test_generate_parallel_retries_transient_failure(self):
        client = self.make_client()
        calls = 0

        def fake_generate_once(*, prompt: str, model: str, size: str | None, base_url: str | None):
            nonlocal calls
            calls += 1
            if calls == 1:
                raise RuntimeError("connection closed abruptly")
            return {"created": 100 + calls, "data": [{"url": f"http://example.test/{calls}.png"}]}

        with patch.object(client, "_generate_once", side_effect=fake_generate_once):
            result = client.generate(prompt="cat", model="gpt-image-2", n=1, size=None, base_url="http://local.test")

        self.assertEqual(calls, 2)
        self.assertEqual(len(result["data"]), 1)

    def test_generate_parallel_accepts_more_than_requested_when_upstream_returns_extra_images(self):
        client = self.make_client()
        calls = 0

        def fake_generate_once(*, prompt: str, model: str, size: str | None, base_url: str | None):
            nonlocal calls
            calls += 1
            if calls == 1:
                return {
                    "created": 100,
                    "data": [
                        {"url": "http://example.test/1.png"},
                        {"url": "http://example.test/2.png"},
                    ],
                }
            return {"created": 100 + calls, "data": [{"url": f"http://example.test/{calls + 1}.png"}]}

        with patch.object(client, "_generate_once", side_effect=fake_generate_once):
            result = client.generate(prompt="cat", model="gpt-image-2", n=3, size=None, base_url="http://local.test")

        self.assertEqual(len(result["data"]), 4)
        self.assertEqual({item["url"] for item in result["data"]}, {
            "http://example.test/1.png",
            "http://example.test/2.png",
            "http://example.test/3.png",
            "http://example.test/4.png",
        })


if __name__ == "__main__":
    unittest.main()
