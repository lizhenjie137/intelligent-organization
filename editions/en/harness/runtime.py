"""Production runtime selection for the original organization application.

Engine's default demo remains useful to unit tests. Production server entry
points explicitly inject the adapter returned here. No configuration failure
silently selects a demo or directly calls a model API.
"""

from __future__ import annotations

from copy import deepcopy
import importlib
import importlib.metadata
import importlib.util
from pathlib import Path
import sys
import threading

from .adapters import DemoAdapter


ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "deepseek-harness-base"
_BRIDGE_PACKAGE = "_organization_official_dsh_bridge"
_IMPORT_LOCK = threading.RLock()
_VERSION = "0.2.2rc2"


class UnavailableDeepSeekAdapter:
    """Keeps human collaboration available while Agent work fails explicitly."""

    mode = "model"
    model = "Model not configured"

    def __init__(self, code: str, message: str, *, configured=False, connection=None, protocol=None):
        self._runtime_status = {
            "runtime": "deepseek", "mode": self.mode, "model": self.model,
            "configured": configured, "available": False,
            "connection": connection, "protocol": protocol,
            "error_code": code, "message": message, "model_connection_verified": False,
        }

    def generate(self, goal, task, capability, context):
        raise RuntimeError("The model is currently unavailable: " + self._runtime_status["message"] + " No model was called and no rule-generated output was produced.")

    def close(self):
        pass


def _bridge_modules():
    """Load only the adapter package; never put the copied app on sys.path."""
    with _IMPORT_LOCK:
        if _BRIDGE_PACKAGE not in sys.modules:
            init_path = BASE / "bridge" / "__init__.py"
            if not init_path.is_file():
                raise FileNotFoundError("bridge package missing")
            spec = importlib.util.spec_from_file_location(
                _BRIDGE_PACKAGE, init_path, submodule_search_locations=[str(init_path.parent)]
            )
            if spec is None or spec.loader is None:
                raise ImportError("bridge loader unavailable")
            package = importlib.util.module_from_spec(spec)
            sys.modules[_BRIDGE_PACKAGE] = package
            try:
                spec.loader.exec_module(package)
            except Exception:
                for name in list(sys.modules):
                    if name == _BRIDGE_PACKAGE or name.startswith(_BRIDGE_PACKAGE + "."):
                        sys.modules.pop(name, None)
                raise
        package = sys.modules[_BRIDGE_PACKAGE]
        configuration = importlib.import_module(_BRIDGE_PACKAGE + ".configuration")
        return package, configuration


def build_runtime_adapter(config_path=None, runtime="deepseek", *, runtime_root=None):
    """Select a production adapter without any model/network call.

    Relative config paths are resolved against the original application root.
    runtime_root is an optional isolated audit directory, useful to test hosts.
    Missing/invalid configuration yields a visibly unavailable model adapter.
    """
    if runtime == "demo":
        return DemoAdapter()
    if runtime != "deepseek":
        raise ValueError("runtime must be deepseek or demo.")
    try:
        bridge, configuration = _bridge_modules()
    except Exception:
        return UnavailableDeepSeekAdapter("BRIDGE_UNAVAILABLE", "The model execution component is missing or cannot be loaded. Check the application installation.")
    path = Path(config_path) if config_path is not None else configuration.DEFAULT_CONFIG
    if not path.is_absolute():
        path = ROOT / path
    try:
        config = configuration.load_config(path, runtime_root=runtime_root)
    except configuration.ConfigurationError as exc:
        return UnavailableDeepSeekAdapter(exc.code, str(exc))
    except Exception:
        return UnavailableDeepSeekAdapter("CONFIG_INVALID", "The model configuration could not be loaded. Check the local or cloud connection settings.")
    return build_configured_adapter(config, bridge=bridge)


def build_configured_adapter(config, *, bridge=None):
    """Build from already validated in-memory configuration, without network I/O."""
    if bridge is None:
        bridge, _ = _bridge_modules()
    try:
        versions = [importlib.metadata.version(name) for name in
                    ("deepseek-harness-sdk", "deepseek-harness-runtime-bin")]
        if versions != [_VERSION, _VERSION]:
            return UnavailableDeepSeekAdapter(
                "SDK_VERSION_MISMATCH", "The model runtime version does not match. Run the application installation script.",
                configured=True, connection=config.connection, protocol=config.protocol,
            )
        from deepseek_harness_runtime import bundled_runtime_path
        if not Path(bundled_runtime_path()).is_file():
            raise ImportError("bundled runtime missing")
    except Exception:
        return UnavailableDeepSeekAdapter(
            "SDK_UNAVAILABLE", "The model runtime is not ready. Use the application startup script.",
            configured=True, connection=config.connection, protocol=config.protocol,
        )
    adapter = bridge.DeepSeekHarnessAdapter(config=config)
    adapter._runtime_status = {
        "runtime": "deepseek", "mode": "model", "model": config.model,
        "configured": True, "available": True, "connection": config.connection,
        "protocol": config.protocol, "error_code": None,
        "message": "The model execution engine is configured. The connection will be verified when an Agent task runs.",
        "model_connection_verified": False,
    }
    return adapter


def runtime_status(adapter):
    """Detached public diagnostic metadata, never credentials or raw errors."""
    status = getattr(adapter, "_runtime_status", None)
    if isinstance(status, dict):
        return deepcopy(status)
    if getattr(adapter, "mode", None) == "demo":
        return {
            "runtime": "demo", "mode": "demo", "model": adapter.model,
            "configured": True, "available": True, "connection": None, "protocol": None,
            "error_code": None, "message": "Rule-based example mode was explicitly selected. No model calls are made.",
            "model_connection_verified": False,
        }
    return {
        "runtime": "custom", "mode": getattr(adapter, "mode", "model"),
        "model": getattr(adapter, "model", "Unidentified adapter"),
        "configured": False, "available": False, "connection": None, "protocol": None,
        "error_code": "UNMANAGED_ADAPTER", "message": "This adapter was not configured through the application runtime entry point.",
        "model_connection_verified": False,
    }
