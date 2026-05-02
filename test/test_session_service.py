from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from services.session_service import SessionService, build_session_name, build_subject_id


class SessionServiceTests(unittest.TestCase):
    def setUp(self):
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        base_path = Path(temp_dir.name)
        self.session_service = SessionService(
            path=base_path / "sessions.json",
            secret_path=base_path / "session_secret.txt",
        )

    def test_create_and_authenticate_user_session(self):
        subject_id = build_subject_id("https://example.com/v1", "sk-test-1234")
        name = build_session_name("https://example.com/v1", "sk-test-1234")
        token = self.session_service.create_session(
            subject_id=subject_id,
            name=name,
            role="user",
            upstream_api_url="https://example.com/v1",
            upstream_api_key="sk-test-1234",
            credential_id=subject_id,
            credential_label=name,
        )
        identity = self.session_service.authenticate(token)

        self.assertIsNotNone(identity)
        assert identity is not None
        self.assertEqual(identity["role"], "user")
        self.assertEqual(identity["id"], subject_id)
        self.assertEqual(identity["name"], name)
        self.assertEqual(identity["upstream_api_url"], "https://example.com/v1")
        self.assertEqual(identity["upstream_api_key"], "sk-test-1234")

    def test_create_and_authenticate_admin_session(self):
        token = self.session_service.create_session(subject_id="admin", name="系统管理员", role="admin")
        identity = self.session_service.authenticate(token)

        self.assertIsNotNone(identity)
        assert identity is not None
        self.assertEqual(identity["role"], "admin")
        self.assertEqual(identity["id"], "admin")
        self.assertEqual(identity["name"], "系统管理员")
        self.assertNotIn("upstream_api_key", identity)

    def test_rejects_invalid_token(self):
        self.assertIsNone(self.session_service.authenticate("invalid-token"))

    def test_build_subject_id_is_stable(self):
        first = build_subject_id("https://example.com/v1/", "sk-abc")
        second = build_subject_id("https://example.com/v1", "sk-abc")
        third = build_subject_id("https://example.com/v1", "sk-def")

        self.assertEqual(first, second)
        self.assertNotEqual(first, third)

    def test_build_session_name_does_not_echo_short_key(self):
        self.assertEqual(build_session_name("https://example.com/v1", "abcd"), "example.com · key")
        self.assertEqual(build_session_name("https://example.com/v1", "abc"), "example.com · key")


if __name__ == "__main__":
    unittest.main()
