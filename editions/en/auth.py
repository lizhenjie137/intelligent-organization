"""Local employee accounts and expiring server-side sessions."""
from __future__ import annotations

import hashlib
import hmac
import re
import secrets
import sqlite3
import threading
import time
from pathlib import Path
from uuid import uuid4

COOKIE = "xiaolajiao_en_session"
SESSION_SECONDS = 12 * 60 * 60
ITERATIONS = 600_000


class AuthError(ValueError):
    def __init__(self, message, status=401):
        super().__init__(message)
        self.status = status


class AuthStore:
    def __init__(self, db_path):
        if str(db_path) != ":memory:":
            Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(db_path), check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.lock = threading.RLock()
        self.failures = {}
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS users (
              id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL,
              display_name TEXT NOT NULL, role TEXT NOT NULL,
              actor_id TEXT UNIQUE NOT NULL, salt TEXT NOT NULL,
              password_hash TEXT NOT NULL, iterations INTEGER NOT NULL,
              created_at REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS sessions (
              token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL,
              expires_at REAL NOT NULL);
        """)
        self.db.commit()

    def close(self):
        with self.lock:
            self.db.close()

    @staticmethod
    def public(row):
        return {k: row[k] for k in ("id", "username", "display_name", "role", "actor_id")}

    def has_users(self):
        with self.lock:
            return self.db.execute("SELECT 1 FROM users LIMIT 1").fetchone() is not None

    @staticmethod
    def _credentials(payload):
        username = payload.get("username", "")
        name = payload.get("display_name", "")
        password = payload.get("password", "")
        if not isinstance(username, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{3,40}", username):
            raise AuthError("Username must contain 3–40 letters, numbers, underscores, dots or hyphens.", 400)
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 80:
            raise AuthError("Display name must contain 1–80 characters.", 400)
        if not isinstance(password, str) or not 12 <= len(password) <= 256:
            raise AuthError("Password must contain 12–256 characters.", 400)
        return username.lower(), name.strip(), password

    def _create(self, payload, role):
        """Insert within the caller's transaction; never commit a partial signup."""
        username, name, password = self._credentials(payload)
        user_id = "user_" + uuid4().hex[:16]
        salt = secrets.token_bytes(32)
        digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, ITERATIONS).hex()
        try:
            self.db.execute("INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?)", (user_id, username, name, role, "person_" + user_id, salt.hex(), digest, ITERATIONS, time.time()))
        except sqlite3.IntegrityError:
            raise AuthError("This username is already in use.", 409) from None
        return self.public(self.db.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone())

    def _session(self, user):
        token = secrets.token_urlsafe(32)
        digest = hashlib.sha256(token.encode()).hexdigest()
        self.db.execute("DELETE FROM sessions WHERE expires_at <= ?", (time.time(),))
        self.db.execute("INSERT INTO sessions VALUES (?,?,?)", (digest, user["id"], time.time() + SESSION_SECONDS))
        return token

    def setup(self, payload):
        return self._register(payload, first_only=True)

    def register(self, payload):
        """The first account is an admin; all later self-registrations are members."""
        return self._register(payload, first_only=False)

    def _register(self, payload, *, first_only):
        with self.lock:
            # Serialize the first-account decision across AuthStore instances too.
            # Account and session commit together; no caller-supplied role is used.
            try:
                self.db.execute("BEGIN IMMEDIATE")
                existing = self.has_users()
                if first_only and existing:
                    raise AuthError("This workspace already has an administrator. Sign in with your account.", 409)
                user = self._create(payload, "employee" if existing else "admin")
                token = self._session(user)
                self.db.commit()
                return user, token
            except Exception:
                self.db.rollback()
                raise

    def create_employee(self, payload, principal):
        if not principal or principal.get("role") != "admin":
            raise AuthError("Only administrators can create member accounts.", 403)
        with self.lock, self.db:
            return self._create(payload, "employee")

    def login(self, payload):
        username, password = payload.get("username", ""), payload.get("password", "")
        if not isinstance(username, str) or not isinstance(password, str) or len(username) > 40 or len(password) > 256:
            raise AuthError("Incorrect username or password.")
        username = username.lower()
        with self.lock:
            recent = [t for t in self.failures.get(username, []) if t > time.time() - 60]
            if len(recent) >= 10:
                raise AuthError("Too many sign-in attempts. Try again in one minute.", 429)
            row = self.db.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
            salt = bytes.fromhex(row["salt"]) if row else bytes(32)
            iterations = row["iterations"] if row else ITERATIONS
            digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations).hex()
            if not row or not hmac.compare_digest(digest, row["password_hash"]):
                self.failures[username] = recent + [time.time()]
                raise AuthError("Incorrect username or password.")
            self.failures.pop(username, None)
            user = self.public(row)
            with self.db:
                return user, self._session(user)

    def resolve(self, token):
        if not isinstance(token, str) or not 20 <= len(token) <= 128:
            return None
        with self.lock:
            row = self.db.execute("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?", (hashlib.sha256(token.encode()).hexdigest(), time.time())).fetchone()
            return self.public(row) if row else None

    def logout(self, token):
        if isinstance(token, str):
            with self.lock, self.db:
                self.db.execute("DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),))

    def list_users(self, principal):
        if not principal or principal.get("role") != "admin":
            raise AuthError("Only administrators can view the account list.", 403)
        with self.lock:
            return [self.public(row) for row in self.db.execute("SELECT * FROM users ORDER BY created_at")]
