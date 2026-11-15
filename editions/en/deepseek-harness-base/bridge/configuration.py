"""Shared, side-effect-free configuration loading for original app and CLI.

Only the explicitly named credential environment variable is read. Loading a
configuration never launches dsh, contacts a provider, or imports an app copy.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import re

from .adapter import BridgeConfig


BASE = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = BASE / "config" / "connection.json"


class ConfigurationError(ValueError):
    """An operator-facing, sanitized configuration error with a stable code."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def load_config(path: Path | str, *, runtime_root: Path | str | None = None) -> BridgeConfig:
    path = Path(path)
    try:
        if path.stat().st_size > 65536:
            raise ConfigurationError("CONFIG_INVALID", "The model configuration file exceeds the 64 KB limit.")
        raw = json.loads(path.read_text(encoding="utf-8-sig"))
    except FileNotFoundError:
        raise ConfigurationError(
            "CONFIG_MISSING", "No model is configured. Fill in the model connection configuration using a local or cloud example."
        ) from None
    except (json.JSONDecodeError, UnicodeError):
        raise ConfigurationError("CONFIG_INVALID", "The model configuration is not valid UTF-8 JSON.") from None
    except OSError:
        raise ConfigurationError("CONFIG_UNREADABLE", "The model configuration could not be read. Check the file and access permissions.") from None
    allowed = {"connection", "protocol", "base_url", "model", "api_key_env", "timeout_seconds",
               "max_tokens", "max_concurrency", "context_window"}
    if not isinstance(raw, dict) or set(raw) - allowed:
        raise ConfigurationError(
            "CONFIG_INVALID", "The configuration must be a JSON object containing only the example fields. Set credentials through environment variables."
        )
    for name in ("connection", "protocol", "base_url", "model"):
        if not isinstance(raw.get(name), str) or not raw[name].strip():
            raise ConfigurationError("CONFIG_INVALID", f"Fill in {name} in the model configuration file.")
        raw[name] = raw[name].strip()
    if raw["model"].startswith("REPLACE_"):
        raise ConfigurationError("CONFIG_INCOMPLETE", "Set model to a name actually provided by the model service.")
    key_env = raw.pop("api_key_env", "")
    if not isinstance(key_env, str) or (key_env and not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key_env)):
        raise ConfigurationError("CONFIG_INVALID", "api_key_env must be an environment variable name, not the API key itself.")
    if key_env.upper() in {"PATH", "HOME", "USERPROFILE", "CODEX_HOME", "SYSTEMROOT", "TEMP", "TMP"}:
        raise ConfigurationError("CONFIG_INVALID", "Use a dedicated credential variable for api_key_env, such as ORG_MODEL_API_KEY.")
    api_key = os.environ.get(key_env, "").strip() if key_env else None
    if key_env and not api_key:
        raise ConfigurationError("CREDENTIAL_MISSING", "The credential environment variable specified by the configuration is not set. Provide the API key at startup.")
    if (raw["connection"] == "cloud" or raw["protocol"] == "deepseek-messages") and not api_key:
        raise ConfigurationError("CREDENTIAL_MISSING", "This connection requires authentication configured through api_key_env.")
    try:
        return BridgeConfig(**raw, api_key=api_key, runtime_root=runtime_root or BASE / "runtime")
    except (ValueError, TypeError):
        # Do not reflect malformed URL, model, or JSON values into an API error.
        raise ConfigurationError(
            "CONFIG_INVALID", "Invalid connection parameters. Check the protocol, API base URL, model name, timeout, context window and concurrency limits."
        ) from None
