from __future__ import annotations

import unittest

from services.session_service import session_service


class SessionServiceTests(unittest.TestCase):
    def test_create_and_authenticate_session(self):
        token = session_service.create_session(name="Tester")
        identity = session_service.authenticate(token)

        self.assertIsNotNone(identity)
        assert identity is not None
        self.assertEqual(identity["role"], "admin")
        self.assertEqual(identity["name"], "Tester")

    def test_rejects_invalid_token(self):
        self.assertIsNone(session_service.authenticate("invalid-token"))


if __name__ == "__main__":
    unittest.main()
