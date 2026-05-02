from __future__ import annotations

import unittest

from services.upstream_openai_image_client import (
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


if __name__ == "__main__":
    unittest.main()
