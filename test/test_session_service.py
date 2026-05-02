from __future__ import annotations

import unittest

from services.session_service import build_session_name, build_subject_id, session_service


class SessionServiceTests(unittest.TestCase):
    def test_create_and_authenticate_session(self):
        subject_id = build_subject_id("https://example.com/v1", "sk-test-1234")
        name = build_session_name("https://example.com/v1", "sk-test-1234")
        token = session_service.create_session(subject_id=subject_id, name=name)
        identity = session_service.authenticate(token)

        self.assertIsNotNone(identity)
        assert identity is not None
        self.assertEqual(identity["role"], "admin")
        self.assertEqual(identity["id"], subject_id)
        self.assertEqual(identity["name"], name)

    def test_rejects_invalid_token(self):
        self.assertIsNone(session_service.authenticate("invalid-token"))

    def test_build_subject_id_is_stable(self):
        first = build_subject_id("https://example.com/v1/", "sk-abc")
        second = build_subject_id("https://example.com/v1", "sk-abc")
        third = build_subject_id("https://example.com/v1", "sk-def")

        self.assertEqual(first, second)
        self.assertNotEqual(first, third)


if __name__ == "__main__":
    unittest.main()
