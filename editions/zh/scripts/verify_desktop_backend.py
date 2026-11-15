"""Exercise the frozen backend with temporary data and a loopback model fixture."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import http.client
import importlib.util
import json
import os
from pathlib import Path
import queue
import secrets
import shutil
import subprocess
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("desktop_mock_model", ROOT / "deepseek-harness-base/scripts/mock_model.py")
fixture_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture_module)


@contextmanager
def temporary_workspace():
    directory = Path(tempfile.mkdtemp(prefix="xiaolajiao-frozen-"))
    # The SDK encodes absolute workspace names in session directories.
    # Use extended Windows paths for cleanup beyond MAX_PATH.
    assert directory.resolve().parent == Path(tempfile.gettempdir()).resolve()
    assert directory.name.startswith("xiaolajiao-frozen-")
    try:
        yield directory
    finally:
        for attempt in range(30):
            try:
                shutil.rmtree("\\\\?\\" + str(directory.resolve()) if os.name == "nt" else directory)
                break
            except FileNotFoundError:
                break
            except OSError:
                if attempt == 29:
                    raise
                time.sleep(0.1)


class FrozenServer:
    def __init__(self, executable, directory):
        self.directory = Path(directory)
        self.lines = []
        ready = queue.Queue()
        environment = {**os.environ, "XIAOLAJIAO_DATA_DIR": str(self.directory),
                       "PATH": str(Path(os.environ.get("SystemRoot", "C:/Windows")) / "System32")}
        self.process = subprocess.Popen([str(executable), "--port", "0", "--desktop-stdio"], cwd=self.directory,
                                        env=environment, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")

        def read():
            for line in self.process.stdout:
                self.lines.append(line.rstrip())
                if line.startswith("XIAOLAJIAO_READY "):
                    ready.put(json.loads(line.split(" ", 1)[1])["port"])
            ready.put(None)

        self.reader = threading.Thread(target=read, daemon=True)
        self.reader.start()
        try:
            self.port = ready.get(timeout=25)
            if not self.port:
                raise RuntimeError("Frozen backend failed before readiness: " + " | ".join(self.lines[-6:]))
        except Exception:
            self.close(force=True)
            raise
        self.cookie = ""

    def request(self, method, path, payload=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=60)
        data = json.dumps(payload).encode() if payload is not None else None
        headers = {"Cookie": self.cookie}
        if data is not None:
            headers["Content-Type"] = "application/json"
        try:
            connection.request(method, path, data, headers)
            response = connection.getresponse()
            raw = response.read()
            result = json.loads(raw) if "application/json" in response.getheader("Content-Type", "") else raw
            if response.getheader("Set-Cookie"):
                self.cookie = response.getheader("Set-Cookie").split(";", 1)[0]
            if response.status != 200:
                raise AssertionError(f"Unexpected HTTP {response.status}: {path}: {result}")
            return result
        finally:
            connection.close()

    def close(self, force=False, eof=False):
        if self.process.poll() is None:
            if force:
                self.process.terminate()
            elif not self.process.stdin.closed:
                if not eof:
                    self.process.stdin.write("shutdown\n")
                    self.process.stdin.flush()
                self.process.stdin.close()
            try:
                self.process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)
                raise AssertionError("Frozen backend did not shut down within 15 seconds")
        self.reader.join(timeout=3)
        for stream in (self.process.stdin, self.process.stdout):
            if stream and not stream.closed:
                stream.close()
        return self.process.returncode


def verify(executable):
    executable = Path(executable).resolve()
    checks = []

    def check(name, passed):
        assert passed, name
        checks.append({"name": name, "passed": True})

    with temporary_workspace() as temporary, fixture_module.MockModel() as model:
        root = Path(temporary)
        server = FrozenServer(executable, root)
        username, password = "desktop-check", secrets.token_urlsafe(24)
        try:
            check("port_zero_and_stdio_ready", 0 < server.port < 65536)
            state = server.request("GET", "/api/auth/state")
            check("clean_workspace_requires_registration", state["setup_required"])
            server.request("POST", "/api/auth/register", {"username": username, "display_name": "Desktop test", "password": password})
            state = server.request("GET", "/api/state")
            check("no_seeded_business_tasks", not state["goals"] and not state["tasks"])
            check("missing_model_is_unavailable", not state["settings"]["runtime"]["available"])
            check("bundled_ui_is_served", b"<!doctype html" in server.request("GET", "/").lower())
            current = server.request("GET", "/api/model-config")
            draft = {"connection": "local", "protocol": "openai-completions", "base_url": model.origin + "/v1",
                     "model": "local-test-model", "max_tokens": 1024, "timeout_seconds": 25,
                     "context_window": 32768, "max_concurrency": 2, "key_action": "remove"}
            server.request("POST", "/api/model-config", {**draft, "expected_revision": current["revision"]})
            tested = server.request("POST", "/api/model-config/test", {**draft, "key_action": "keep"})
            check("frozen_official_sdk_connection_test", tested["ok"] and len(model.requests) == 1)
            state = server.request("POST", "/api/action", {"type": "create_goal", "title": "Frozen backend check", "brief": "Temporary fixture", "criteria": "Return a verified protocol response", "priority": "P2", "budget": 8, "collaborative": True})
            goal = state["goals"][-1]
            state = server.request("POST", "/api/action", {"type": "step", "goal_id": goal["id"]})
            completed = [task for task in state["tasks"] if task["goal_id"] == goal["id"] and task["status"] == "completed"]
            check("real_agent_task_completes_without_python_or_node_on_path", len(completed) == 1 and len(model.requests) == 2)
            check("model_output_is_not_demo", completed[0].get("output_mode") == "model")
            check("all_business_data_uses_appdata_override", (root / "workspace/harness.db").is_file() and (root / "workspace/harness.auth.db").is_file())
            check("runtime_records_use_workspace", any((root / "workspace/runtime").rglob("run.json")))
        finally:
            check("shutdown_command_exits_cleanly", server.close() == 0)
        restarted = FrozenServer(executable, root)
        try:
            restarted.request("POST", "/api/auth/login", {"username": username, "password": password})
            state = restarted.request("GET", "/api/state")
            check("restart_preserves_account_and_goal", any(item["id"] == goal["id"] for item in state["goals"]))
        finally:
            check("stdin_eof_exits_cleanly", restarted.close(eof=True) == 0)
    return {"passed": True, "checks": checks, "count": len(checks), "live_workspaces_used": False, "model_endpoint": "temporary loopback fixture", "external_python_or_node_required": False}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--executable", type=Path, default=ROOT / "build/backend/xiaolajiao-server/xiaolajiao-server.exe")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    report = verify(args.executable)
    rendered = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.report:
        args.report.write_text(rendered, encoding="utf-8")
    print(rendered)
