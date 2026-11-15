"""Verify the ORIGINAL server entry point with isolated data and real dsh.

The application in this source root is used with temporary test data.
Only the model HTTP endpoint is simulated. Credentials stay in memory.
"""
from __future__ import annotations

import argparse
from contextlib import ExitStack
import hashlib
import http.client
import importlib.util
import json
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "deepseek-harness-base"
sys.path.insert(0, str(ROOT))
from auth import AuthStore, COOKIE
from harness.adapters import DemoAdapter
from harness.engine import Engine

_spec = importlib.util.spec_from_file_location("embedded_local_model_fixture", BASE / "scripts" / "mock_model.py")
_mock_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mock_module)
MockModel, RESPONSE = _mock_module.MockModel, _mock_module.RESPONSE


class Client:
    def __init__(self, port, token=""):
        self.port = port
        self.cookie = COOKIE + "=" + token if token else ""

    def request(self, method, path, payload=None, timeout=60):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=timeout)
        data = json.dumps(payload, ensure_ascii=False).encode() if payload is not None else None
        headers = {"Cookie": self.cookie}
        if data is not None:
            headers["Content-Type"] = "application/json"
        try:
            connection.request(method, path, data, headers)
            response = connection.getresponse()
            raw = response.read()
            result = json.loads(raw) if "application/json" in response.getheader("Content-Type", "") else raw
            cookie = response.getheader("Set-Cookie")
            if cookie:
                self.cookie = cookie.split(";", 1)[0]
            return response.status, result
        finally:
            connection.close()

    def checked(self, method, path, payload=None):
        status, result = self.request(method, path, payload)
        if status != 200:
            raise AssertionError(f"{method} {path}: HTTP {status}")
        return result

    def action(self, action, **fields):
        return self.checked("POST", "/api/action", {"type": action, **fields})

    def state(self):
        return self.checked("GET", "/api/state")


class OriginalServer:
    def __init__(self, directory, config):
        self.root = Path(directory)
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            self.port = listener.getsockname()[1]
        # No --runtime argument: the original system must default to DeepSeek.
        self.command = [sys.executable, str(ROOT / "server.py"),
                        "--port", str(self.port), "--db", str(self.root / "business.sqlite"),
                        "--auth-db", str(self.root / "auth.sqlite"), "--config", str(config),
                        "--runtime-root", str(self.root / "dsh-runtime")]
        self.lines = []
        self.process = subprocess.Popen(self.command, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                        text=True, encoding="utf-8", errors="replace")
        self.reader = threading.Thread(target=self._read, daemon=True)
        self.reader.start()
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            if self.process.poll() is not None:
                self.close()
                raise AssertionError("Original server exited during startup: " + " | ".join(self.lines[-3:]))
            try:
                status, _ = Client(self.port).request("GET", "/api/auth/state", timeout=0.5)
                if status == 200:
                    return
            except (OSError, http.client.HTTPException):
                pass
            time.sleep(0.05)
        self.close()
        raise AssertionError("Original server did not become ready")

    def _read(self):
        for line in self.process.stdout:
            self.lines.append(line.strip())
            self.lines = self.lines[-100:]

    def close(self):
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)
        self.reader.join(timeout=2)
        self.process.stdout.close()


def task_for(state, goal_id):
    return next(item for item in state["tasks"] if item["goal_id"] == goal_id)


def create_fixture(directory):
    """Persist an existing organization before changing its runtime adapter."""
    engine = Engine(Path(directory) / "business.sqlite", adapter=DemoAdapter(), seed=False)
    auth = AuthStore(Path(directory) / "auth.sqlite")
    admin_password, employee_password = secrets.token_urlsafe(24), secrets.token_urlsafe(24)
    try:
        admin, admin_token = auth.setup({"username": "embedded_admin", "display_name": "原组织管理员", "password": admin_password})
        employee = auth.create_employee({"username": "existing_employee", "display_name": "已有员工", "password": employee_password}, admin)
        _, employee_token = auth.login({"username": "existing_employee", "password": employee_password})
        engine.provision_employee(admin)
        engine.provision_employee(employee)
        def action(principal, kind, **fields):
            return engine.action({"type": kind, **fields}, principal)
        text = "EXISTING_PRIVATE_KNOWLEDGE：已有员工的资料分析记录，包含事实来源、论证步骤及适用边界。"
        state = action(employee, "import_document", title="原组织已有知识", content=text, scope="personal", source_name="existing-knowledge.txt")
        doc = state["documents"][-1]
        state = action(employee, "claim_capability", capability_id="analyze", level=3, description="原有能力申报", evidence_doc_id=doc["id"], evidence_excerpt=text)
        action(admin, "review_assessment", assessment_id=state["assessments"][-1]["id"], decision="verify", level=3, review_note="原有独立能力核验")
        action(admin, "grant_permission", actor_id=employee["actor_id"], capability_id="analyze", allowed=True)
        def goal(title, *, collaborative=False, risk="low"):
            state = action(employee, "create_goal", title=title, brief="EXISTING_PRIVATE_BRIEF", criteria="保留既有业务状态", collaborative=collaborative, steps=[{"key": "analyze", "title": "资料分析", "capability_id": "analyze", "risk": risk}])
            return state["goals"][-1]["id"]
        historical_goal = goal("既有演示模式历史交付")
        action(employee, "step", goal_id=historical_goal)
        pending_goal = goal("原有尚未执行的Agent任务")
        human_goal = goal("已有人工协作任务", collaborative=True, risk="high")
        task = task_for(engine.snapshot(employee), human_goal)
        action(employee, "assign_task", task_id=task["id"], expected_version=task["version"], actor_id=employee["actor_id"])
        before = engine.snapshot(admin)
        return {"admin": admin, "employee": employee, "admin_token": admin_token, "employee_token": employee_token,
                "employee_password": employee_password, "before": before, "historical_goal": historical_goal,
                "pending_goal": pending_goal, "human_goal": human_goal, "private_text": text}
    finally:
        engine.close()
        auth.close()


def verify():
    started = time.perf_counter()
    report = {"passed": False, "entrypoint": str(ROOT / "server.py"), "copied_application_used": False,
              "scope": "original server + factory + actual official dsh + loopback model", "checks": []}
    def check(name, condition, **details):
        report["checks"].append({"name": name, "passed": bool(condition), **details})
        if not condition:
            raise AssertionError(name)
    original_ui = {str(path.relative_to(ROOT / "web")): path.read_bytes() for path in (ROOT / "web").rglob("*") if path.is_file()}
    try:
        with ExitStack() as stack:
            temporary = Path(stack.enter_context(tempfile.TemporaryDirectory(prefix="embedded-harness-", ignore_cleanup_errors=True)))
            fixture = create_fixture(temporary)
            missing_config = temporary / "missing-connection.json"
            server = OriginalServer(temporary, missing_config)
            stack.callback(lambda: server.close())
            admin, employee = Client(server.port, fixture["admin_token"]), Client(server.port, fixture["employee_token"])
            state = admin.state()
            keys = ("goals", "tasks", "documents", "assessments", "actors", "capabilities", "memories", "events", "skill_packages")
            check("original_accounts_and_all_business_collections_preserved", all(state[key] == fixture["before"][key] for key in keys), collections=list(keys))
            check("original_session_cookie_remains_valid", state["current_user"]["id"] == fixture["admin"]["id"] and employee.state()["current_user"]["id"] == fixture["employee"]["id"])
            runtime = admin.checked("GET", "/api/runtime")
            check("original_entrypoint_defaults_to_deepseek_factory", runtime["mode"] == "model" and runtime["runtime"] == "deepseek" and not runtime["available"] and "--runtime" not in server.command)
            check("runtime_configuration_is_admin_only", employee.request("GET", "/api/runtime")[0] == 403 and Client(server.port).request("GET", "/api/runtime")[0] == 401)
            auth = Client(server.port)
            logged = auth.checked("POST", "/api/auth/login", {"username": "existing_employee", "password": fixture["employee_password"]})
            check("existing_password_login_works_without_model", logged["user"]["id"] == fixture["employee"]["id"])

            def mutate(client, kind, **fields):
                task = task_for(client.state(), fixture["human_goal"])
                return client.action(kind, task_id=task["id"], expected_version=task["version"], **fields)
            mutate(employee, "accept_task")
            mutate(employee, "start_task")
            mutate(employee, "update_progress", progress=65, note="原系统的人工协作在未配置模型时继续正常同步。")
            public = admin.checked("GET", "/api/coordination")
            task = task_for(public, fixture["human_goal"])
            check("human_collaboration_works_without_model", task["progress"] == 65 and fixture["private_text"] not in json.dumps(public, ensure_ascii=False))
            mutate(employee, "submit_task", output="这是原有人工任务的私有交付，包含分析依据和限制，待管理员独立验收。")
            reviewed = mutate(admin, "review_task", approved=True, feedback="管理员已独立核对交付，完成未配置模型情况下的人工协作验收。")
            check("human_submission_and_independent_review_complete", task_for(reviewed, fixture["human_goal"])["status"] == "completed")
            failed = employee.action("step", goal_id=fixture["pending_goal"])
            failed_task = task_for(failed, fixture["pending_goal"])
            check("missing_configuration_fails_agent_without_demo", failed_task["status"] == "failed" and not failed_task["output"] and not failed_task["artifacts"] and failed["settings"]["mode"] == "model")
            ui_matches = all(employee.checked("GET", "/" + path) == content for path, content in original_ui.items())
            check("original_ui_served_byte_for_byte", ui_matches, files=len(original_ui))
            after_unconfigured = admin.state()
            server.close()

            mock = stack.enter_context(MockModel())
            config_path = temporary / "connection.json"
            config_path.write_text(json.dumps({"connection": "local", "protocol": "openai-completions", "base_url": mock.origin + "/v1", "model": "local-test-model", "api_key_env": "", "timeout_seconds": 30, "max_tokens": 1024, "max_concurrency": 4, "context_window": 32768}), encoding="utf-8")
            server = OriginalServer(temporary, config_path)
            admin.port = employee.port = server.port
            restored = admin.state()
            check("restart_with_model_preserves_accounts_knowledge_and_tasks", all(restored[key] == after_unconfigured[key] for key in keys))
            runtime = admin.checked("GET", "/api/runtime")
            check("original_factory_loads_official_runtime", runtime["runtime"] == "deepseek" and runtime["configured"] and runtime["available"] and runtime["mode"] == "model" and runtime["model"] == "local-test-model")
            employee.action("retry", task_id=failed_task["id"])
            completed = employee.action("step", goal_id=fixture["pending_goal"])
            actual_task = task_for(completed, fixture["pending_goal"])
            check("original_task_executes_through_real_dsh", actual_task["status"] == "completed" and actual_task["output_mode"] == "model" and RESPONSE in actual_task["output"] and len(mock.requests) == 1)
            prompt = json.dumps(mock.requests[0]["body"], ensure_ascii=False)
            check("original_private_knowledge_reaches_its_owner_runtime", fixture["private_text"] in prompt and mock.requests[0]["local_placeholder_only"])
            manifests = [json.loads(path.read_text(encoding="utf-8")) for path in (temporary / "dsh-runtime").rglob("run.json")]
            check("official_runtime_records_original_task_identity", len(manifests) == 1 and manifests[0]["goal_id"] == fixture["pending_goal"] and manifests[0]["task_id"] == actual_task["id"] and manifests[0]["owner_id"] == fixture["employee"]["id"] and manifests[0]["runtime"] == "official-deepseek-harness-sdk" and manifests[0]["runtime_closed"] and manifests[0]["status"] == "completed")
            historic_before = task_for(fixture["before"], fixture["historical_goal"])
            historic_after = task_for(admin.state(), fixture["historical_goal"])
            check("historical_demo_outputs_are_retained_without_relabeling", historic_before == historic_after and historic_after["output_mode"] == "demo")
            current = {str(path.relative_to(ROOT / "web")): path.read_bytes() for path in (ROOT / "web").rglob("*") if path.is_file()}
            check("original_ui_files_unchanged", current == original_ui)
            report["passed"] = True
    except Exception as error:
        report["error"] = f"{type(error).__name__}: {error}"
    report["elapsed_seconds"] = round(time.perf_counter() - started, 6)
    return report


def main():
    parser = argparse.ArgumentParser(description="验证原系统默认接入官方DeepSeek Harness")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    report = verify()
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
