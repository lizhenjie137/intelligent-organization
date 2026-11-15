"""Formal bootstrap uses isolated temporary databases and no model network."""
from __future__ import annotations

from contextlib import contextmanager
import http.client
import json
from pathlib import Path
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest

from auth import AuthStore
from harness.adapters import DemoAdapter
from harness.engine import Engine


ROOT = Path(__file__).resolve().parents[1]
# Avoid the Windows venv redirector outliving its launcher on termination.
# These bootstrap tests never need the optional model SDK installation.
PYTHON = getattr(sys, "_base_executable", sys.executable)
ACCOUNT = {"username": "formal_fixture", "display_name": "临时验证管理员", "password": "temporary-only-password-2026"}


class Client:
    def __init__(self, port):
        self.port, self.cookie = port, ""

    def request(self, method, path, payload=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        headers = {"Cookie": self.cookie}
        data = None
        if payload is not None:
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"
        try:
            connection.request(method, path, data, headers)
            response = connection.getresponse()
            result = json.loads(response.read())
            if response.getheader("Set-Cookie"):
                self.cookie = response.getheader("Set-Cookie").split(";", 1)[0]
            if response.status != 200:
                raise AssertionError(f"HTTP {response.status}: {method} {path}: {result}")
            return result
        finally:
            connection.close()

    def action(self, kind, **payload):
        return self.request("POST", "/api/action", {"type": kind, **payload})


@contextmanager
def running_original(directory, *options):
    directory = Path(directory)
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    command = [PYTHON, str(ROOT / "server.py"), "--port", str(port),
               "--db", str(directory / "business.sqlite"),
               "--config", str(directory / "deliberately-unconfigured.json"),
               "--runtime-root", str(directory / "runtime"), *options]
    process = subprocess.Popen(command, cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    try:
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise AssertionError("Temporary server failed: " + process.stderr.read().decode("utf-8", errors="replace"))
            try:
                client = Client(port)
                client.request("GET", "/api/auth/state")
                break
            except (OSError, http.client.HTTPException):
                time.sleep(0.03)
        else:
            raise AssertionError("Temporary server did not start")
        yield client
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        process.stderr.close()


def checkpoint(directory):
    db = sqlite3.connect(f"file:{Path(directory).as_posix()}/business.sqlite?mode=ro", uri=True)
    try:
        return db.execute("SELECT data FROM checkpoint WHERE id=1").fetchone()[0]
    finally:
        db.close()


class FormalWorkspaceTests(unittest.TestCase):
    def test_original_entrypoint_starts_empty_and_setup_binds_only_real_human(self):
        with tempfile.TemporaryDirectory() as directory, running_original(directory) as client:
            self.assertTrue(client.request("GET", "/api/auth/state")["setup_required"])
            principal = client.request("POST", "/api/auth/setup", ACCOUNT)["user"]
            state = client.request("GET", "/api/state")
            for key in ("goals", "tasks", "events", "memories", "documents", "assessments", "skill_packages", "work_updates", "handoffs"):
                self.assertEqual(state[key], [], key)
            people = [actor for actor in state["actors"] if actor["type"] == "human"]
            self.assertEqual(len(people), 1)
            self.assertEqual(people[0]["user_id"], principal["id"])
            self.assertEqual(people[0]["permissions"], ["approve"])
            self.assertNotIn("owner", [actor["id"] for actor in state["actors"]])
            self.assertEqual(len([actor for actor in state["actors"] if actor["type"] == "agent"]), 4)
            self.assertEqual(state["settings"]["version"], "1.0.0")
            self.assertEqual(state["settings"]["mode"], "model")
            state = client.action("create_goal", title="人工录入的验证目标", brief="验证缺配置时明确失败", criteria="不生成规则占位产物", budget=4)
            state = client.action("step", goal_id=state["goals"][0]["id"])
            task = state["tasks"][0]
            self.assertEqual(task["actor_id"], "analyst")
            self.assertEqual(task["status"], "failed")
            self.assertEqual(task["output"], "")
            self.assertIn("未调用模型", task["error"])

    def test_formal_agents_route_and_real_admin_approves_without_placeholder(self):
        class ModelFixture:
            mode, model = "model", "isolated-test-adapter"

            def __init__(self):
                self.capabilities = []

            def generate(self, goal, task, capability, context):
                self.capabilities.append(capability["id"])
                return "测试适配器的临时产物，用于检查新空间的能力路由与审批状态机，不代表任何真实模型调用或业务成果。"

        adapter = ModelFixture()
        engine = Engine(":memory:", adapter=adapter, seed=False, placeholder_owner=False)
        self.addCleanup(engine.close)
        principal = {"id": "fixture-admin", "actor_id": "fixture-person", "role": "admin", "username": "fixture", "display_name": "临时管理员"}
        engine.provision_employee(principal)
        state = engine.action({"type": "create_goal", "title": "路由测试", "brief": "临时输入", "criteria": "人工审核明确", "budget": 8}, principal)
        goal_id = state["goals"][0]["id"]
        for _ in range(4):
            state = engine.action({"type": "step", "goal_id": goal_id}, principal)
        approval = next(task for task in state["tasks"] if task["capability_id"] == "approve")
        self.assertEqual(approval["actor_id"], principal["actor_id"])
        engine.action({"type": "approve", "task_id": approval["id"], "feedback": "确认临时流程结果"}, principal)
        state = engine.action({"type": "step", "goal_id": goal_id}, principal)
        self.assertEqual(state["goals"][0]["status"], "completed")
        self.assertEqual(adapter.capabilities, ["analyze", "draft", "review", "reflect"])
        self.assertTrue(all(task["output_mode"] in ("model", "human") for task in state["tasks"]))

    def test_existing_accounts_checkpoint_and_demo_evidence_are_not_changed(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            engine = Engine(path / "business.sqlite", adapter=DemoAdapter())
            auth = AuthStore(path / "business.auth.db")
            try:
                principal, _ = auth.setup(ACCOUNT)
                engine.provision_employee(principal)
                engine.action({"type": "step", "goal_id": engine.state["goals"][0]["id"]}, principal)
                # An old catalog sentence must not be silently rewritten on restart.
                next(cap for cap in engine.state["capabilities"] if cap["id"] == "reflect")["acceptance"] = "保留旧空间的验收定义"
                engine._save()
            finally:
                engine.close()
                auth.close()
            before = checkpoint(directory)
            old = json.loads(before)
            with running_original(directory) as client:
                self.assertFalse(client.request("GET", "/api/auth/state")["setup_required"])
                logged_in = client.request("POST", "/api/auth/login", ACCOUNT)["user"]
                self.assertEqual(logged_in, principal)
                state = client.request("GET", "/api/state")
                for key in ("goals", "tasks", "actors", "capabilities", "events", "revision"):
                    if key == "goals":
                        self.assertEqual([g["id"] for g in state[key]], [g["id"] for g in old[key]])
                    elif key == "capabilities":
                        self.assertEqual([{k: cap[k] for k in original} for cap, original in zip(state[key], old[key])], old[key])
                    else:
                        self.assertEqual(state[key], old[key], key)
                self.assertIn("规则演示产物", state["tasks"][0]["output"])
                self.assertEqual(state["tasks"][0]["output_mode"], "demo")
                self.assertEqual(state["settings"]["version"], "0.4.0")
                self.assertEqual(checkpoint(directory), before)
            self.assertEqual(checkpoint(directory), before)

    def test_development_seed_requires_explicit_demo_and_rule_results_stay_labeled(self):
        with tempfile.TemporaryDirectory() as directory, running_original(directory, "--runtime", "demo", "--seed-example") as client:
            client.request("POST", "/api/auth/setup", ACCOUNT)
            state = client.request("GET", "/api/state")
            self.assertEqual(len(state["goals"]), 1)
            self.assertTrue(state["goals"][0]["is_example"])
            self.assertEqual(len(state["tasks"]), 5)
            self.assertEqual(state["settings"]["mode"], "demo")
            self.assertIn("不调用模型", state["settings"]["runtime"]["message"])
            state = client.action("step", goal_id=state["goals"][0]["id"])
            self.assertIn("规则演示产物", state["tasks"][0]["output"])
            self.assertEqual(state["tasks"][0]["output_mode"], "demo")

    def test_rule_mode_does_not_implicitly_seed_example(self):
        with tempfile.TemporaryDirectory() as directory, running_original(directory, "--runtime", "demo") as client:
            client.request("POST", "/api/auth/setup", ACCOUNT)
            state = client.request("GET", "/api/state")
            self.assertEqual(state["goals"], [])
            self.assertNotIn("owner", [actor["id"] for actor in state["actors"]])
            self.assertEqual(state["settings"]["mode"], "demo")

    def test_invalid_seed_switch_is_rejected_before_creating_database(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "must-not-be-created" / "business.sqlite"
            result = subprocess.run([PYTHON, str(ROOT / "server.py"), "--db", str(path), "--seed-example"],
                                    cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15)
            self.assertEqual(result.returncode, 2)
            self.assertFalse(path.parent.exists())
            self.assertIn(b"--runtime demo", result.stderr)

    def test_public_source_markers_do_not_expose_private_goal_or_artifact_text(self):
        engine = Engine(":memory:", adapter=DemoAdapter())
        self.addCleanup(engine.close)
        before = json.dumps(engine.state, ensure_ascii=False)
        board = engine.coordination()
        self.assertTrue(board["goals"][0]["is_example"])
        self.assertEqual(board["goals"][0]["mode"], "demo")
        self.assertEqual(board["goals"][0]["owner_name"], "未指定负责人")
        self.assertNotIn("brief", board["goals"][0])
        self.assertNotIn("criteria", board["goals"][0])
        self.assertTrue(all("output" not in task and "submission" not in task for task in board["tasks"]))
        self.assertEqual(json.dumps(engine.state, ensure_ascii=False), before)


if __name__ == "__main__":
    unittest.main()
