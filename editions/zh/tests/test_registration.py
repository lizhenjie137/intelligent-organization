"""Self-registration boundaries; all accounts, databases and HTTP hosts are temporary."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import http.client
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest
from unittest.mock import patch

from auth import AuthError, AuthStore, COOKIE, ITERATIONS
from harness.adapters import DemoAdapter
from harness.engine import Engine
from server import make_handler


PASSWORD = "registration-fixture-password-2026"


def credentials(username="registered_member", **extra):
    return {"username": username, "display_name": "Registration fixture", "password": PASSWORD, **extra}


class RegistrationStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "auth.sqlite"
        self.auth = AuthStore(self.path)
        self.addCleanup(self.auth.close)

    def test_first_is_admin_later_is_employee_and_payload_cannot_override_identity(self):
        admin, token = self.auth.register(credentials("first_member", role="employee", actor_id="forged", id="forged-user"))
        employee, second = self.auth.register(credentials("later_member", role="admin", actor_id=admin["actor_id"], id=admin["id"]))
        self.assertEqual(admin["role"], "admin")
        self.assertEqual(employee["role"], "employee")
        self.assertNotEqual(admin["actor_id"], "forged")
        self.assertNotEqual(admin["id"], "forged-user")
        self.assertNotEqual(employee["actor_id"], admin["actor_id"])
        self.assertEqual(self.auth.resolve(token), admin)
        self.assertEqual(self.auth.resolve(second), employee)
        with self.assertRaises(AuthError) as error:
            self.auth.setup(credentials("replacement_admin"))
        self.assertEqual(error.exception.status, 409)
        self.assertEqual(self.auth.login(credentials("LATER_MEMBER"))[0], employee)

    def test_validation_and_case_insensitive_duplicates_leave_no_partial_account(self):
        for fields in ({"username": "ab"}, {"username": "invalid username"}, {"username": "中文账号"},
                       {"display_name": " "}, {"password": "short"}, {"password": 123},
                       {"username": None}, {"display_name": []}):
            with self.subTest(fields=fields), self.assertRaises(AuthError) as error:
                self.auth.register(credentials(**fields))
            self.assertEqual(error.exception.status, 400)
            self.assertFalse(self.auth.has_users())
        admin, _ = self.auth.register(credentials("MixedCase"))
        self.assertEqual(admin["username"], "mixedcase")
        with self.assertRaises(AuthError) as error:
            self.auth.register(credentials("MIXEDCASE"))
        self.assertEqual(error.exception.status, 409)
        self.assertEqual(self.auth.db.execute("SELECT COUNT(*) FROM users").fetchone()[0], 1)
        self.assertEqual(self.auth.db.execute("SELECT COUNT(*) FROM sessions").fetchone()[0], 1)
        self.assertFalse(self.auth.db.in_transaction)

    def test_credentials_and_sessions_persist_only_as_salted_hashes(self):
        users = [self.auth.register(credentials(name)) for name in ("persist_one", "persist_two")]
        rows = [dict(row) for row in self.auth.db.execute("SELECT * FROM users ORDER BY created_at")]
        sessions = [dict(row) for row in self.auth.db.execute("SELECT * FROM sessions")]
        self.assertNotEqual(rows[0]["salt"], rows[1]["salt"])
        self.assertNotEqual(rows[0]["password_hash"], rows[1]["password_hash"])
        for row, (user, token) in zip(rows, users):
            expected = hashlib.pbkdf2_hmac("sha256", PASSWORD.encode(), bytes.fromhex(row["salt"]), ITERATIONS).hex()
            self.assertEqual(row["password_hash"], expected)
            self.assertNotIn(PASSWORD, json.dumps(row))
            self.assertNotIn(token, json.dumps(sessions))
            self.assertEqual(set(user), {"id", "username", "display_name", "role", "actor_id"})
        other = AuthStore(self.path)
        try:
            for user, token in users:
                self.assertEqual(other.resolve(token), user)
                self.assertEqual(other.login(credentials(user["username"]))[0], user)
        finally:
            other.close()

    def test_session_insert_failure_rolls_back_account_and_first_admin_decision(self):
        with patch.object(self.auth, "_session", side_effect=sqlite3.OperationalError("fixture failure")):
            with self.assertRaises(sqlite3.OperationalError):
                self.auth.register(credentials())
        self.assertFalse(self.auth.has_users())
        self.assertFalse(self.auth.db.in_transaction)
        self.assertEqual(self.auth.db.execute("SELECT COUNT(*) FROM sessions").fetchone()[0], 0)
        self.assertEqual(self.auth.register(credentials())[0]["role"], "admin")

    def test_concurrent_independent_connections_create_exactly_one_admin(self):
        stores = [AuthStore(self.path) for _ in range(5)]
        barrier = threading.Barrier(len(stores))
        def register(index):
            barrier.wait(timeout=5)
            return stores[index].register(credentials("parallel_" + str(index)))
        try:
            with ThreadPoolExecutor(max_workers=len(stores)) as executor:
                created = list(executor.map(register, range(len(stores))))
            self.assertEqual(sum(user["role"] == "admin" for user, _ in created), 1)
            self.assertEqual(sum(user["role"] == "employee" for user, _ in created), 4)
            self.assertEqual(len({user["id"] for user, _ in created}), 5)
            self.assertEqual(self.auth.db.execute("SELECT COUNT(*) FROM users").fetchone()[0], 5)
            self.assertTrue(all(self.auth.resolve(token) == user for user, token in created))
        finally:
            for store in stores:
                store.close()

    def test_setup_and_registration_race_does_not_create_two_admins(self):
        other = AuthStore(self.path)
        barrier = threading.Barrier(2)
        def create(method, name):
            barrier.wait(timeout=5)
            try:
                return method(credentials(name))[0]
            except AuthError as error:
                return error.status
        try:
            with ThreadPoolExecutor(max_workers=2) as executor:
                tasks = [executor.submit(create, self.auth.setup, "setup_racer"),
                         executor.submit(create, other.register, "registration_racer")]
                results = [task.result(timeout=10) for task in tasks]
            self.assertEqual(self.auth.db.execute("SELECT COUNT(*) FROM users WHERE role='admin'").fetchone()[0], 1)
            self.assertTrue(any(isinstance(result, dict) for result in results))
            self.assertTrue(all(isinstance(result, dict) or result == 409 for result in results))
        finally:
            other.close()


class RegistrationHttpTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.auth = AuthStore(root / "auth.sqlite")
        self.addCleanup(self.auth.close)
        self.engine = Engine(root / "engine.sqlite", adapter=DemoAdapter(), seed=False, placeholder_owner=False)
        self.addCleanup(self.engine.close)
        handler = make_handler(self.engine, self.auth)
        handler.log_message = lambda *args: None
        self.host = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.worker = threading.Thread(target=self.host.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True)
        self.worker.start()
        self.addCleanup(self.stop_host)

    def stop_host(self):
        self.host.shutdown()
        self.host.server_close()
        self.worker.join(timeout=3)

    def call(self, method, path, payload=None, *, cookie="", headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.host.server_port, timeout=10)
        data = json.dumps(payload).encode() if payload is not None else None
        fields = {"Cookie": cookie, **({"Content-Type": "application/json"} if data else {}), **(headers or {})}
        try:
            connection.request(method, path, data, fields)
            response = connection.getresponse()
            return response.status, json.loads(response.read()), dict(response.getheaders())
        finally:
            connection.close()

    def register(self, name, **extra):
        status, result, headers = self.call("POST", "/api/auth/register", credentials(name, **extra))
        self.assertEqual(status, 200, result)
        return result, headers["Set-Cookie"]

    def test_auto_login_real_actor_binding_and_no_employee_privilege_escalation(self):
        first, cookie = self.register("http_admin", role="employee", actor_id="forged")
        self.assertTrue(first["authenticated"])
        self.assertFalse(first["setup_required"])
        self.assertEqual(first["user"]["role"], "admin")
        self.assertTrue(cookie.startswith(COOKIE + "="))
        self.assertIn("HttpOnly", cookie)
        self.assertIn("SameSite=Strict", cookie)
        self.assertEqual(self.call("GET", "/api/auth/state", cookie=cookie)[1]["user"], first["user"])
        second, member_cookie = self.register("http_member", role="admin", actor_id=first["user"]["actor_id"], permissions=["approve"])
        state_status, state, _ = self.call("GET", "/api/state", cookie=member_cookie)
        self.assertEqual(state_status, 200)
        self.assertEqual(state["current_user"], second["user"])
        person = next(actor for actor in state["actors"] if actor["id"] == second["user"]["actor_id"])
        self.assertEqual(person["user_id"], second["user"]["id"])
        self.assertEqual(person["account_role"], "employee")
        self.assertEqual(person["permissions"], [])
        self.assertEqual(person["capability_ids"], [])
        self.assertEqual(self.call("GET", "/api/auth/users", cookie=member_cookie)[0], 403)
        self.assertEqual(self.call("POST", "/api/action", {"type": "add_actor", "name": "forged"}, cookie=member_cookie)[0], 403)
        self.assertEqual(self.call("POST", "/api/auth/setup", credentials("new_admin"))[0], 409)
        self.assertEqual(self.call("POST", "/api/auth/login", credentials("HTTP_MEMBER"))[1]["user"], second["user"])
        self.assertEqual(len(self.engine.state["actors"]), 6)

    def test_register_errors_and_responses_do_not_expose_secrets(self):
        user, cookie = self.register("secret_check")
        self.assertEqual(set(user), {"authenticated", "setup_required", "user"})
        self.assertEqual(set(user["user"]), {"id", "username", "display_name", "role", "actor_id"})
        for path, payload, expected in (
            ("/api/auth/register", credentials("SECRET_CHECK"), 409),
            ("/api/auth/register", credentials("invalid", password="short"), 400),
            ("/api/auth/register", [], 400),
            ("/api/auth/login", credentials("secret_check", password="wrong-password"), 401)):
            with self.subTest(path=path, expected=expected):
                status, result, headers = self.call("POST", path, payload)
                self.assertEqual(status, expected)
                self.assertNotIn("Set-Cookie", headers)
                self.assertNotIn(PASSWORD, json.dumps(result))
                self.assertNotIn("password_hash", json.dumps(result))
                self.assertNotIn("salt", result)

    def test_cross_origin_and_untrusted_host_cannot_create_any_account(self):
        for headers in ({"Origin": "https://untrusted.example"}, {"Host": "untrusted.example"}):
            status, _, response_headers = self.call("POST", "/api/auth/register", credentials(), headers=headers)
            self.assertEqual(status, 403)
            self.assertNotIn("Set-Cookie", response_headers)
        self.assertFalse(self.auth.has_users())
        self.assertEqual(len(self.engine.state["actors"]), 4)

    def test_saved_account_can_recover_by_login_if_workspace_provisioning_fails(self):
        with patch.object(self.engine, "provision_employee", side_effect=sqlite3.OperationalError("fixture failure")):
            status, result, headers = self.call("POST", "/api/auth/register", credentials("recover_member"))
        self.assertEqual(status, 503)
        self.assertEqual(result["code"], "account_saved")
        self.assertNotIn("Set-Cookie", headers)
        self.assertTrue(self.auth.has_users())
        self.assertEqual(self.auth.db.execute("SELECT COUNT(*) FROM sessions").fetchone()[0], 0)
        status, result, headers = self.call("POST", "/api/auth/login", credentials("recover_member"))
        self.assertEqual(status, 200)
        self.assertEqual(result["user"]["role"], "admin")
        self.assertEqual(self.call("GET", "/api/state", cookie=headers["Set-Cookie"])[0], 200)
        self.assertEqual(len(self.engine.state["actors"]), 5)


if __name__ == "__main__":
    unittest.main()
