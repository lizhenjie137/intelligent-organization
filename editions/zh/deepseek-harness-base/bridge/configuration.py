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
            raise ConfigurationError("CONFIG_INVALID", "模型配置文件超过 64 KB 限制。")
        raw = json.loads(path.read_text(encoding="utf-8-sig"))
    except FileNotFoundError:
        raise ConfigurationError(
            "CONFIG_MISSING", "尚未配置模型。请按本地或云端示例填写模型连接配置文件。"
        ) from None
    except (json.JSONDecodeError, UnicodeError):
        raise ConfigurationError("CONFIG_INVALID", "模型配置不是有效的 UTF-8 JSON。") from None
    except OSError:
        raise ConfigurationError("CONFIG_UNREADABLE", "无法读取模型配置，请检查文件及访问权限。") from None
    allowed = {"connection", "protocol", "base_url", "model", "api_key_env", "timeout_seconds",
               "max_tokens", "max_concurrency", "context_window"}
    if not isinstance(raw, dict) or set(raw) - allowed:
        raise ConfigurationError(
            "CONFIG_INVALID", "配置必须是 JSON 对象且仅包含示例中的字段；密钥请通过环境变量设置。"
        )
    for name in ("connection", "protocol", "base_url", "model"):
        if not isinstance(raw.get(name), str) or not raw[name].strip():
            raise ConfigurationError("CONFIG_INVALID", f"请在模型配置文件填写 {name}。")
        raw[name] = raw[name].strip()
    if raw["model"].startswith("REPLACE_"):
        raise ConfigurationError("CONFIG_INCOMPLETE", "请将 model 改为模型服务实际提供的模型名称。")
    key_env = raw.pop("api_key_env", "")
    if not isinstance(key_env, str) or (key_env and not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key_env)):
        raise ConfigurationError("CONFIG_INVALID", "api_key_env 必须是环境变量名称，不能填写密钥本身。")
    if key_env.upper() in {"PATH", "HOME", "USERPROFILE", "CODEX_HOME", "SYSTEMROOT", "TEMP", "TMP"}:
        raise ConfigurationError("CONFIG_INVALID", "api_key_env 请使用专用密钥变量，例如 ORG_MODEL_API_KEY。")
    api_key = os.environ.get(key_env, "").strip() if key_env else None
    if key_env and not api_key:
        raise ConfigurationError("CREDENTIAL_MISSING", "尚未设置模型配置指定的密钥环境变量，请在启动时提供密钥。")
    if (raw["connection"] == "cloud" or raw["protocol"] == "deepseek-messages") and not api_key:
        raise ConfigurationError("CREDENTIAL_MISSING", "当前连接需要通过 api_key_env 配置认证。")
    try:
        return BridgeConfig(**raw, api_key=api_key, runtime_root=runtime_root or BASE / "runtime")
    except (ValueError, TypeError):
        # Do not reflect malformed URL, model, or JSON values into an API error.
        raise ConfigurationError(
            "CONFIG_INVALID", "模型连接参数无效；请检查协议、API 根地址、模型名、超时、上下文与并发范围。"
        ) from None
