"""Workspace-scoped model configuration with real dsh tests and protected keys."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import replace
from datetime import datetime, timezone
import ctypes
from ctypes import wintypes
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import threading
import time
from urllib.parse import urlsplit
from uuid import uuid4

from .runtime import (BASE, ROOT, UnavailableDeepSeekAdapter, _bridge_modules,
                      build_configured_adapter, runtime_status)


class ModelConfigConflict(ValueError):
    """A model run is active, or the administrator edited a stale revision."""


class ModelSettingsError(ValueError):
    """A sanitized configuration/storage error, safe to show to an admin."""


_FIELDS = ("connection", "protocol", "base_url", "model", "max_tokens",
           "timeout_seconds", "context_window", "max_concurrency")
_DEFAULTS = {"connection": "local", "protocol": "openai-completions",
             "base_url": "http://127.0.0.1:8000/v1", "model": "",
             "max_tokens": 4096, "timeout_seconds": 90, "context_window": 32768, "max_concurrency": 4}
_SUCCESS = "Connection test passed. The selected model returned valid text."
_FAILURE = "Connection test failed. Check the service URL, protocol, model name and credentials. No business output was saved."


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def _json_bytes(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + "." + uuid4().hex + ".tmp")
    try:
        with temporary.open("wb") as handle:
            handle.write(_json_bytes(value))
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _dpapi(data: bytes, entropy: bytes, *, decrypt=False) -> bytes:
    """Windows current-user DPAPI; no machine-wide scope or interactive prompt."""
    class Blob(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_ubyte))]

    def blob(raw):
        buffer = (ctypes.c_ubyte * len(raw)).from_buffer_copy(raw)
        return Blob(len(raw), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte))), buffer

    incoming, in_buffer = blob(data)
    salt, salt_buffer = blob(entropy)
    outgoing = Blob()
    try:
        crypto = ctypes.WinDLL("crypt32", use_last_error=True)
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        protect = crypto.CryptUnprotectData if decrypt else crypto.CryptProtectData
        protect.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.POINTER(Blob),
                            ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
        protect.restype = wintypes.BOOL
        kernel.LocalFree.argtypes = [ctypes.c_void_p]
        kernel.LocalFree.restype = ctypes.c_void_p
        if not protect(ctypes.byref(incoming), None, ctypes.byref(salt), None, None, 1, ctypes.byref(outgoing)):
            raise ModelSettingsError("Windows could not protect or read the model credentials. Enter the API key again.")
        try:
            return ctypes.string_at(outgoing.pbData, outgoing.cbData)
        finally:
            kernel.LocalFree(ctypes.cast(outgoing.pbData, ctypes.c_void_p))
    except (AttributeError, OSError):
        raise ModelSettingsError("Windows credential protection is unavailable. The configuration was not saved.") from None


class RuntimeManager:
    mode = "model"

    def __init__(self, config_path=None, runtime_root=None, settings_path=None):
        self.config_path = Path(config_path).resolve() if config_path is not None else BASE / "config" / "connection.json"
        self.runtime_root = Path(runtime_root).resolve() if runtime_root is not None else BASE / "runtime"
        default_store = (self.config_path.parent / "model-settings.json") if config_path is not None else ROOT / "data" / "model-settings.json"
        self.settings_path = Path(settings_path).resolve() if settings_path is not None else default_store
        self._credential_dir = self.settings_path.with_name(self.settings_path.stem + ".credentials")
        self._entropy = hashlib.sha256(("organization-model-key/v1:" + str(self.settings_path)).encode("utf-8")).digest()
        self._lock = threading.RLock()
        self._active = 0
        self._testing = False
        self._closed = False
        self._revision = 0
        self._draft = deepcopy(_DEFAULTS)
        self._api_key = None
        self._secret_storage = "none"
        self._last_test = None
        self._test_cache = {}
        self._test_adapters = set()
        self._record = None
        self._adapter = UnavailableDeepSeekAdapter("CONFIG_MISSING", "No model is configured. A workspace administrator can save a local or cloud connection in Model settings.")
        self._bootstrap()

    @property
    def model(self):
        with self._lock:
            return self._adapter.model

    @property
    def _runtime_status(self):
        with self._lock:
            value = runtime_status(self._adapter)
            value.update(has_api_key=bool(self._api_key), secret_storage=self._secret_storage,
                         busy=bool(self._active), last_test=deepcopy(self._last_test))
            value["model_connection_verified"] = bool(value["available"] and self._last_test and self._last_test["ok"])
            return value

    def get_settings(self):
        with self._lock:
            return {"draft": deepcopy(self._draft), "has_api_key": bool(self._api_key),
                    "secret_storage": self._secret_storage, "last_test": deepcopy(self._last_test),
                    "status": self._runtime_status, "revision": self._revision, "busy": bool(self._active)}

    @staticmethod
    def _fingerprint(draft, key):
        # Used only in memory, never returned or persisted. Key changes invalidate tests.
        return hashlib.sha256(_json_bytes(draft) + b"\0" + (key or "").encode("utf-8")).hexdigest()

    def _credential_entropy(self, draft):
        # A manual edit to the saved endpoint must not redirect a previously
        # protected key either. DPAPI binds it to workspace AND endpoint/protocol.
        binding = _json_bytes({k: draft[k] for k in ("base_url", "protocol")})
        return self._entropy + hashlib.sha256(binding).digest()

    def _config(self, draft, key):
        try:
            bridge, _ = _bridge_modules()
            config = bridge.BridgeConfig(**draft, api_key=key, runtime_root=self.runtime_root)
            host = urlsplit(config.base_url)
            loopback = host.hostname == "localhost"
            try:
                loopback = loopback or ipaddress.ip_address(host.hostname).is_loopback
            except ValueError:
                pass
            if config.connection == "cloud" and host.scheme != "https" and not loopback:
                raise ModelSettingsError("Cloud endpoints must use HTTPS. Loopback test addresses may use HTTP.")
            if config.model.startswith("REPLACE_"):
                raise ModelSettingsError("Enter a model name actually provided by the model service.")
            return config
        except ModelSettingsError:
            raise
        except Exception:
            raise ModelSettingsError("Invalid model parameters. Check the API base URL, protocol, model name, timeout, context window and concurrency limits.") from None

    @staticmethod
    def _needs_key(config):
        return config.connection == "cloud" or config.protocol == "deepseek-messages"

    def _activate(self, config):
        if self._needs_key(config) and not config.api_key:
            return UnavailableDeepSeekAdapter("CREDENTIAL_MISSING", "This connection is missing credentials. Enter the API key again in Model settings.",
                                              configured=True, connection=config.connection, protocol=config.protocol)
        try:
            return build_configured_adapter(config)
        except Exception:
            return UnavailableDeepSeekAdapter("SDK_UNAVAILABLE", "The model runtime is not ready. Use the application startup script.",
                                              configured=True, connection=config.connection, protocol=config.protocol)

    def _bootstrap(self):
        try:
            if self.settings_path.exists():
                self._load_managed()
                return
            if not self.config_path.exists():
                return
            if self.config_path.stat().st_size > 65536:
                raise ModelSettingsError("The initial model configuration file is too large.")
            raw = json.loads(self.config_path.read_text(encoding="utf-8-sig"))
            if not isinstance(raw, dict) or set(raw) - (set(_FIELDS) | {"api_key_env"}):
                raise ModelSettingsError("The initial model configuration has an invalid format.")
            draft = {**_DEFAULTS, **{k: v for k, v in raw.items() if k in _FIELDS}}
            config = self._config(draft, None)
            self._draft = {k: getattr(config, k) for k in _FIELDS}
            key_env = raw.get("api_key_env", "")
            if not isinstance(key_env, str) or (key_env and not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key_env)):
                raise ModelSettingsError("The initial configuration has an invalid api_key_env.")
            if key_env.upper() in {"PATH", "HOME", "USERPROFILE", "CODEX_HOME", "SYSTEMROOT", "TEMP", "TMP"}:
                raise ModelSettingsError("The initial configuration must use a dedicated credential environment variable.")
            self._api_key = (os.environ.get(key_env, "").strip() or None) if key_env else None
            self._secret_storage = "environment" if self._api_key else "none"
            self._adapter = self._activate(self._config(self._draft, self._api_key))
        except Exception:
            self._api_key = None
            self._secret_storage = "none"
            self._adapter = UnavailableDeepSeekAdapter("CONFIG_INVALID", "The saved model configuration or credentials could not be read. Ask a workspace administrator to reconfigure the connection.")

    def _load_managed(self):
        if self.settings_path.stat().st_size > 65536:
            raise ModelSettingsError("The model settings record is too large.")
        record = json.loads(self.settings_path.read_text(encoding="utf-8"))
        if not isinstance(record, dict) or record.get("version") != 1 or not isinstance(record.get("config"), dict):
            raise ModelSettingsError("The model settings record has an invalid format.")
        draft = record["config"]
        if set(draft) != set(_FIELDS):
            raise ModelSettingsError("The model settings contain invalid fields.")
        config = self._config(draft, None)
        self._draft = {k: getattr(config, k) for k in _FIELDS}
        revision = record.get("revision")
        if type(revision) is not int or revision < 0:
            raise ModelSettingsError("The model settings version is invalid.")
        self._revision = revision
        storage = record.get("secret_storage", "none")
        if storage not in ("none", "windows-dpapi", "memory-only"):
            raise ModelSettingsError("The credential storage format is invalid.")
        self._secret_storage = storage
        if storage == "windows-dpapi":
            key_ref = record.get("key_ref")
            if os.name != "nt" or not isinstance(key_ref, str) or not re.fullmatch(r"[0-9a-f]{32}", key_ref):
                raise ModelSettingsError("This device cannot read the protected credentials.")
            ciphertext = (self._credential_dir / (key_ref + ".dpapi")).read_bytes()
            if len(ciphertext) > 65536:
                raise ModelSettingsError("The credential file is invalid.")
            self._api_key = _dpapi(ciphertext, self._credential_entropy(self._draft), decrypt=True).decode("utf-8")
        self._record = record
        config = self._config(self._draft, self._api_key)
        self._adapter = self._activate(config)
        test = record.get("last_test")
        binding = hashlib.sha256(_json_bytes(self._draft)).hexdigest()
        if (isinstance(test, dict) and test.get("config_fingerprint") == binding
                and test.get("credential_id") == record.get("key_ref")
                and type(test.get("ok")) is bool and isinstance(test.get("tested_at"), str)
                and (storage != "memory-only" or bool(self._api_key))):
            self._last_test = {"ok": test["ok"], "message": _SUCCESS if test["ok"] else _FAILURE,
                               "latency": test.get("latency", 0), "tested_at": test["tested_at"], "draft": False}

    def _candidate(self, payload, *, allow_remove=False):
        if not isinstance(payload, dict) or set(payload) - (set(_FIELDS) | {"key_action", "api_key", "expected_revision"}):
            raise ModelSettingsError("The model settings contain unknown fields.")
        expected = payload.get("expected_revision")
        if expected is not None and (type(expected) is not int or expected != self._revision):
            raise ModelConfigConflict("The model configuration has changed. Refresh the settings before retrying.")
        action = payload.get("key_action", "keep")
        if action not in ("keep", "replace", "remove"):
            raise ModelSettingsError("key_action must be keep, replace or remove.")
        supplied = payload.get("api_key", "")
        if not isinstance(supplied, str) or len(supplied) > 8192:
            raise ModelSettingsError("The API key format is invalid.")
        if action != "replace" and supplied:
            raise ModelSettingsError("Select replace when providing a new API key.")
        key = self._api_key if action == "keep" else (supplied.strip() if action == "replace" else None)
        if action == "replace" and not key:
            raise ModelSettingsError("Choose whether to keep or remove the API key, or enter a replacement key.")
        draft = {**self._draft, **{k: v for k, v in payload.items() if k in _FIELDS}}
        config = self._config(draft, key)
        draft = {k: getattr(config, k) for k in _FIELDS}
        if (action == "keep" and self._api_key
                and (draft["base_url"], draft["protocol"]) != (self._draft["base_url"], self._draft["protocol"])):
            raise ModelSettingsError("The service URL or protocol has changed. Enter the API key again or explicitly remove the old key.")
        if self._needs_key(config) and not key and not (allow_remove and action == "remove"):
            raise ModelSettingsError("This connection requires an API key. Enter credentials first.")
        return draft, key, config

    def _persist(self, draft, key, test):
        self.settings_path.parent.mkdir(parents=True, exist_ok=True)
        key_ref = None
        storage = "none"
        if key:
            storage = "windows-dpapi" if os.name == "nt" else "memory-only"
            if storage == "windows-dpapi":
                ciphertext = _dpapi(key.encode("utf-8"), self._credential_entropy(draft))
                key_ref = uuid4().hex
                self._credential_dir.mkdir(parents=True, exist_ok=True)
                with (self._credential_dir / (key_ref + ".dpapi")).open("xb") as handle:
                    handle.write(ciphertext)
                    handle.flush()
                    os.fsync(handle.fileno())
        record = {"version": 1, "revision": self._revision + 1, "config": draft,
                  "secret_storage": storage, "key_ref": key_ref, "last_test": None}
        if test:
            record["last_test"] = {**test, "draft": False,
                "config_fingerprint": hashlib.sha256(_json_bytes(draft)).hexdigest(), "credential_id": key_ref}
        _atomic_json(self.settings_path, record)
        return record

    def save(self, payload):
        old_adapter = None
        with self._lock:
            if self._closed:
                raise ModelConfigConflict("The model runtime has closed.")
            if self._active:
                raise ModelConfigConflict("An Agent task or connection test is running. Wait for it to finish before changing the model configuration.")
            draft, key, config = self._candidate(payload, allow_remove=True)
            new_adapter = self._activate(config)
            fingerprint = self._fingerprint(draft, key)
            test = self._test_cache.get(fingerprint)
            if test is None and fingerprint == self._fingerprint(self._draft, self._api_key):
                test = self._last_test
            try:
                record = self._persist(draft, key, test)
            except Exception:
                new_adapter.close()
                raise ModelSettingsError("The configuration or protected credentials could not be saved. The current connection is unchanged.") from None
            old_adapter = self._adapter
            self._adapter, self._draft, self._api_key = new_adapter, draft, key
            self._revision = record["revision"]
            self._secret_storage = record["secret_storage"]
            self._record = record
            self._last_test = ({**test, "draft": False} if test else None)
            result = self.get_settings()
            # Old encrypted versions are no longer referenced. Never follow a
            # filename from input, and never recursively delete directories.
            if self._credential_dir.exists():
                for path in self._credential_dir.glob("*.dpapi"):
                    if re.fullmatch(r"[0-9a-f]{32}\.dpapi", path.name) and path.stem != record["key_ref"]:
                        try:
                            path.unlink()
                        except OSError:
                            pass
        old_adapter.close()
        return result

    def test(self, payload):
        with self._lock:
            if self._closed:
                raise ModelConfigConflict("The model runtime has closed.")
            if self._testing:
                raise ModelConfigConflict("A connection test is already running. Wait for it to finish before retrying.")
            draft, key, config = self._candidate(payload)
            if self._active >= config.max_concurrency:
                raise ModelConfigConflict("Model tasks and connection tests have reached the concurrency limit. Try again later.")
            fingerprint = self._fingerprint(draft, key)
            self._testing = True
            self._active += 1
        started = time.monotonic()
        adapter = None
        ok = False
        try:
            test_config = replace(config, runtime_root=self.runtime_root / "connection-tests",
                                  max_tokens=min(config.max_tokens, 256), timeout_seconds=min(config.timeout_seconds, 45))
            adapter = self._activate(test_config)
            with self._lock:
                if self._closed:
                    raise RuntimeError("The model runtime has closed.")
                self._test_adapters.add(adapter)
            adapter.generate(
                {"id": "connection-test-" + uuid4().hex, "title": "Model connection test", "owner_id": None,
                 "brief": "This is a fixed connection test containing no workspace information. Confirm in English, using at least 60 characters, that you received the test input. Do not claim to perform external actions.",
                 "criteria": "Return valid English text to verify the model connection."},
                {"id": "connection-test", "title": "Fixed-text response", "actor_id": None, "attempts": 1},
                {"id": "connection-test", "name": "Connection test", "description": "Return only a short explanation of this fixed test.",
                 "input_schema": "Fixed test text", "output_schema": "At least 60 English characters", "acceptance": "Valid text",
                 "instructions": "Respond in English with at least 60 characters. Do not call tools."}, [],
            )
            ok = True
        except Exception:
            ok = False
        finally:
            if adapter:
                try:
                    adapter.close()
                except Exception:
                    ok = False
            result = {"ok": ok, "message": _SUCCESS if ok else _FAILURE,
                      "latency": round(time.monotonic() - started, 3), "tested_at": _now()}
            with self._lock:
                self._test_adapters.discard(adapter)
                self._active -= 1
                self._testing = False
                same = fingerprint == self._fingerprint(self._draft, self._api_key)
                result["draft"] = not same
                self._test_cache[fingerprint] = {**result, "draft": False}
                if len(self._test_cache) > 8:
                    self._test_cache.pop(next(iter(self._test_cache)))
                if same:
                    self._last_test = {**result, "draft": False}
                    if self._record is not None:
                        updated = deepcopy(self._record)
                        updated["last_test"] = {**self._last_test,
                            "config_fingerprint": hashlib.sha256(_json_bytes(self._draft)).hexdigest(),
                            "credential_id": updated.get("key_ref")}
                        try:
                            _atomic_json(self.settings_path, updated)
                            self._record = updated
                        except OSError:
                            result["message"] += " The test record could not be persisted."
        return result

    def generate(self, goal, task, capability, context):
        with self._lock:
            if self._closed:
                raise RuntimeError("The model runtime has closed.")
            adapter = self._adapter
            self._active += 1
        try:
            return adapter.generate(goal, task, capability, context)
        finally:
            with self._lock:
                self._active -= 1

    def close(self):
        with self._lock:
            self._closed = True
            adapters = [self._adapter, *self._test_adapters]
        for adapter in adapters:
            adapter.close()
