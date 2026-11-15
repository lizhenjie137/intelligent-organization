"""Text-only bridge through official SDK JSON-RPC and its bundled dsh process.

Every generate() uses a fresh process, home, workspace and Session. Sessions are
retained for an operator's local audit, never replayed into another task. Model
requests are made by official dsh provider plugins, not by Python HTTP code.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from hashlib import sha256
from importlib.metadata import version
import json
import math
import os
from pathlib import Path
import queue
import threading
import time
from typing import Any
from urllib.parse import urlsplit
from uuid import uuid4


_PINNED_VERSION = "0.2.2rc2"
_ROUTE = "organization-endpoint"
_KEY_ENV = "ORGANIZATION_DSH_API_KEY"
_SAFE_PATCH = Path(__file__).resolve().parents[1] / "config" / "text-only.patch.yml"


@dataclass(frozen=True)
class BridgeConfig:
    connection: str
    protocol: str
    base_url: str
    model: str
    runtime_root: Path | str
    api_key: str | None = field(default=None, repr=False)
    timeout_seconds: float = 90.0
    max_tokens: int = 4096
    max_concurrency: int = 4
    context_window: int = 32768

    def __post_init__(self):
        if self.connection not in ("local", "cloud"):
            raise ValueError("connection must be local or cloud.")
        if self.protocol not in ("openai-completions", "deepseek-messages"):
            raise ValueError("protocol must be openai-completions or deepseek-messages.")
        if not isinstance(self.base_url, str):
            raise ValueError("base_url must be text.")
        parsed = urlsplit(self.base_url)
        if (parsed.scheme not in ("http", "https") or not parsed.hostname
                or parsed.username or parsed.password or parsed.query or parsed.fragment
                or any(ord(c) < 32 for c in self.base_url)):
            raise ValueError("base_url must be an HTTP(S) API base URL without credentials, a query string or a fragment.")
        try:
            parsed.port
        except ValueError:
            raise ValueError("base_url contains an invalid port.") from None
        if parsed.path.rstrip("/").endswith(("/chat/completions", "/messages")):
            raise ValueError("Use the API base URL for base_url (for example http://localhost:1234/v1), not the full inference endpoint.")
        if (not isinstance(self.model, str) or not self.model.strip() or len(self.model) > 200
                or any(ord(c) < 32 for c in self.model)):
            raise ValueError("model must be a model name containing 1 to 200 characters.")
        if self.api_key is not None and (not isinstance(self.api_key, str)
                                        or any(ord(c) < 32 for c in self.api_key)):
            raise ValueError("api_key must be single-line text.")
        if (isinstance(self.timeout_seconds, bool) or not isinstance(self.timeout_seconds, (int, float))
                or not math.isfinite(self.timeout_seconds) or not 1 <= self.timeout_seconds <= 1800):
            raise ValueError("timeout_seconds must be between 1 and 1800 seconds.")
        for name, low, high in (("max_tokens", 32, 131072), ("max_concurrency", 1, 32),
                                ("context_window", 1024, 2000000)):
            value = getattr(self, name)
            if type(value) is not int or not low <= value <= high:
                raise ValueError(f"{name} must be an integer from {low} to {high}.")
        if self.max_tokens >= self.context_window:
            raise ValueError("max_tokens must be less than context_window.")
        object.__setattr__(self, "runtime_root", Path(self.runtime_root).resolve())
        object.__setattr__(self, "base_url", self.base_url.rstrip("/"))
        object.__setattr__(self, "model", self.model.strip())


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


class DeepSeekHarnessAdapter:
    mode = "model"

    def __init__(self, config: BridgeConfig):
        if not isinstance(config, BridgeConfig):
            raise TypeError("config must be a BridgeConfig.")
        self.config = config
        self.model = config.model
        self._slots = threading.BoundedSemaphore(config.max_concurrency)
        self._lock = threading.RLock()
        self._active: dict[str, Any] = {}
        self._closed = False

    def describe(self):
        """Safe operational metadata; this never includes the key or task text."""
        return {"runtime": "official-deepseek-harness-sdk", "sdk_version": _PINNED_VERSION,
                "connection": self.config.connection, "protocol": self.config.protocol,
                "model": self.model, "tool_policy": "no-model-tools; read-only",
                "session_policy": "fresh-process-home-workspace-session-per-attempt"}

    def close(self):
        """Stop accepting calls and cancel all active SDK processes."""
        with self._lock:
            self._closed = True
            active = list(self._active.values())
        for app in active:
            try:
                self._close_runtime(app)
            except Exception:
                pass

    @staticmethod
    def _close_runtime(app, started_process=None):
        # SDK 0.2.2rc2 waits for its child/readers but drops _proc without
        # closing the two parent pipe wrappers. Preserve that verified pinned
        # handle and release them only after the process has actually exited.
        # This is a narrow resource-cleanup shim, not a replacement transport.
        proc = started_process if started_process is not None else getattr(app.client, "_proc", None)
        try:
            app.close()
        finally:
            if proc is not None and proc.poll() is not None:
                for stream in (proc.stdout, proc.stderr):
                    if stream is not None and not stream.closed:
                        stream.close()

    def _provider_patch(self):
        config = self.config
        common = {"baseURL": config.base_url, "defaultContextWindow": config.context_window,
                  "streamIdleTimeoutMs": int(config.timeout_seconds * 1000),
                  "retryPolicy": {"mode": "normal", "maxRetries": 0}}
        if config.protocol == "deepseek-messages":
            return [{"id": "llm-deepseek", "config": {
                **common, "apiKeyEnv": _KEY_ENV, "thinking": "disabled",
                "models": [{"id": config.model, "contextWindow": config.context_window,
                            "maxTokens": config.max_tokens, "inputModalities": ["text"]}]}}]
        route = {**common, "api": "openai-completions", "displayName": "Organization endpoint",
                 "defaultMaxTokens": config.max_tokens,
                 "models": [{"id": config.model, "contextWindow": config.context_window,
                             "maxTokens": config.max_tokens, "reasoningEfforts": False}],
                 "compat": {"supportsStore": False, "supportsDeveloperRole": False,
                            "supportsReasoningEffort": False, "supportsUsageInStreaming": False,
                            "maxTokensField": "max_tokens"}}
        # pi-ai's OpenAI transport requires an auth-shaped value even for a
        # server with authentication disabled. In that case a fixed, public,
        # non-secret marker satisfies the client; no user key is required.
        route["apiKeyEnv"] = _KEY_ENV
        return [{"id": "llm-deepseek", "disabled": True}, {"insert": [{
            "id": "organization-llm", "name": "@deepseek-ai/dsh-llm-pi-ai",
            "config": {"providers": {_ROUTE: route}}}]}]

    @staticmethod
    def _write_record(path: Path, record: dict):
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(temporary, path)

    def generate(self, goal, task, capability, context):
        with self._lock:
            if self._closed:
                raise RuntimeError("The model execution engine has closed.")
        if not self._slots.acquire(blocking=False):
            raise RuntimeError("The model execution concurrency limit has been reached. Try again later.")
        try:
            return self._generate(goal, task, capability, context)
        finally:
            self._slots.release()

    def _generate(self, goal, task, capability, context):
        # Dependency checks do not connect to the endpoint. No environment
        # credential discovery, direct HTTP path, or fallback adapter exists.
        try:
            if version("deepseek-harness-sdk") != _PINNED_VERSION or version("deepseek-harness-runtime-bin") != _PINNED_VERSION:
                raise RuntimeError("The model runtime version does not match. Use the runtime bundled with the application.")
            from deepseek_harness import DeepSeekHarness
        except ImportError:
            raise RuntimeError("The model runtime is not ready. Use the application startup script.") from None
        if self.config.protocol == "deepseek-messages" and not self.config.api_key:
            raise RuntimeError("deepseek-messages requires an API key. Use openai-completions for local services without authentication.")

        deadline = time.monotonic() + self.config.timeout_seconds
        run_id = uuid4().hex
        run_root = self.config.runtime_root / "runs" / run_id
        home, workspace = run_root / "dsh-home", run_root / "workspace"
        home.mkdir(parents=True, exist_ok=False)
        workspace.mkdir()
        provider_patch = run_root / "provider.patch.yml"
        provider_patch.write_text(json.dumps(self._provider_patch(), ensure_ascii=False, indent=2), encoding="utf-8")
        session_id = "org-" + run_id
        prompt = "Organization task data follows. Complete only this text task and write the result in English.\n" + json.dumps({
            "goal": {k: goal.get(k, "") for k in ("title", "brief", "criteria")},
            "task": {"title": task.get("title", ""), "feedback": task.get("feedback", [])},
            "capability": capability, "context": context,
        }, ensure_ascii=False)
        record = {**self.describe(), "id": run_id, "session_id": session_id,
                  "goal_id": goal.get("id"), "task_id": task.get("id"),
                  "owner_id": goal.get("owner_id"), "actor_id": task.get("actor_id"),
                  "attempt": task.get("attempts"), "created_at": _now(), "status": "starting",
                  "prompt_sha256": sha256(prompt.encode("utf-8")).hexdigest(),
                  "finish_reason": None, "event_count": 0}
        record_path = run_root / "run.json"
        self._write_record(record_path, record)
        # SDK env applies only to its subprocess. Unique custom provider avoids
        # ambient catalog credentials; no process-global os.environ mutation.
        transport_key = self.config.api_key or "local-no-auth-required"
        env = {_KEY_ENV: transport_key, "DEEPSEEK_API_KEY": "",
               "DEEPSEEK_BASE_URL": "", "DSH_PERMISSION_MODE": "read-only",
               "DSH_SYSTEM_PROMPT": "", "DSH_PRIMARY_RUNTIME": ""}
        # The pinned Windows single-file runtime resolves /snapshot native
        # modules on C: (upstream discussion #10269). Decouple process cwd from
        # the actual Session workspace; all task/home files still stay in the
        # isolated run directory. This does not create or write anything in C:\.
        runtime_cwd = Path("C:/") if os.name == "nt" and Path("C:/").is_dir() else workspace
        record["runtime_cwd"] = str(runtime_cwd)
        if runtime_cwd != workspace:
            record["windows_workaround"] = "https://github.com/deepseek-ai/deepseek-harness/discussions/10269"
        app = DeepSeekHarness(
            profile="sdk-minimal", provider=("deepseek-official" if self.config.protocol == "deepseek-messages" else _ROUTE),
            model=self.model, max_tokens=self.config.max_tokens, cwd=str(workspace), runtime_cwd=str(runtime_cwd),
            dsh_home=str(home), patches=(str(_SAFE_PATCH), str(provider_patch)), env=env,
            initialize_timeout_seconds=min(30.0, self.config.timeout_seconds),
            request_timeout_seconds=min(30.0, self.config.timeout_seconds), shutdown_timeout_seconds=0.5,
            on_user_question=lambda _: {"cancelled": True},
        )
        with self._lock:
            if self._closed:
                raise RuntimeError("The model execution engine has closed.")
            self._active[run_id] = app
        results: queue.Queue = queue.Queue(maxsize=1)
        worker = None
        started_process = None
        failure_code = "SDK_INITIALIZATION_FAILED"
        try:
            # initialize has its own SDK deadline. The separate run deadline is
            # necessary: request_timeout_seconds does NOT bound Session.run().
            # Keep the handle before initialize: SDK itself may close and drop
            # it on initialization errors, which also need pipe cleanup.
            app.client.start()
            started_process = getattr(app.client, "_proc", None)
            session = app.start_session(session_id=session_id)
            failure_code = "SDK_RUN_FAILED"
            record["status"] = "running"
            self._write_record(record_path, record)

            def run_session():
                try:
                    results.put((True, session.run(prompt)))
                except Exception as exc:
                    results.put((False, exc))

            worker = threading.Thread(target=run_session, name="dsh-run-" + run_id[:8], daemon=True)
            worker.start()
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise queue.Empty
            success, result = results.get(timeout=remaining)
            if not success:
                raise RuntimeError("runtime-failed") from None
            record["finish_reason"] = result.finish_reason
            record["event_count"] = len(result.events)
            record["event_types"] = sorted({str(e.get("type", "unknown")) for e in result.events})
            if result.session_id != session_id:
                failure_code = "SESSION_MISMATCH"
                raise RuntimeError("session-mismatch")
            if result.finish_reason != "completed":
                failure_code = "INCOMPLETE_RESULT"
                raise RuntimeError("incomplete-result")
            if any(e.get("type", "").startswith("tool/") for e in result.events):
                failure_code = "UNEXPECTED_TOOL_CALL"
                raise RuntimeError("unexpected-tool-call")
            output = result.final_response
            if not isinstance(output, str) or not 30 <= len(output.strip()) <= 100000:
                failure_code = "INVALID_OUTPUT"
                raise RuntimeError("invalid-output")
            record["status"] = "completed"
            return "[AI-generated output; human verification required]\n\n" + output.strip()
        except queue.Empty:
            record["status"] = "timed_out"
            record["error_code"] = "DEADLINE_EXCEEDED"
            raise RuntimeError("Model execution timed out. The process was terminated; the task can be retried manually.") from None
        except Exception:
            record["status"] = "failed"
            record["error_code"] = failure_code
            # SDK errors may contain provider bodies/stderr. Do not send them
            # to public workflow events or logs; provider details stay local.
            raise RuntimeError("Model execution failed or returned an incomplete result. Check the model service, protocol and local run records before retrying.") from None
        finally:
            try:
                self._close_runtime(app, started_process)
                record["runtime_closed"] = True
            except Exception:
                # Cleanup errors must not replace the sanitized public error
                # with SDK stderr/provider details (or expose credentials).
                record["cleanup_error"] = "SDK_CLOSE_FAILED"
                record["runtime_closed"] = False
                record["status"] = "failed"
                record["error_code"] = "SDK_CLOSE_FAILED"
            finally:
                if worker is not None:
                    worker.join(timeout=1.0)
                with self._lock:
                    if record["runtime_closed"]:
                        self._active.pop(run_id, None)
                record["finished_at"] = _now()
                self._write_record(record_path, record)
            if not record["runtime_closed"]:
                raise RuntimeError("The model execution engine failed to close. Its output was not accepted. Inspect local processes before retrying.") from None
