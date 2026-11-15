"""Independent HTTP and engine acceptance tests; temporary DBs and local models only."""
from __future__ import annotations

import contextlib
import http.client
import json
import tempfile
import threading
import unittest
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from harness.engine import Engine
from harness.adapters import DemoAdapter, ModelAdapter
from auth import AuthStore
from server import MAX_BODY, make_handler

PORT_COOKIES = {}


@contextlib.contextmanager
def running_http(handler):
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    worker = threading.Thread(target=httpd.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True)
    worker.start()
    try:
        yield httpd.server_address[1]
    finally:
        httpd.shutdown()
        httpd.server_close()
        worker.join(timeout=2)


def request(port, method, path, payload=None, headers=None, raw=None):
    combined = {"Cookie": PORT_COOKIES[port]} if port in PORT_COOKIES else {}
    body = raw
    if payload is not None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        combined["Content-Type"] = "application/json"
    combined.update(headers or {})
    client = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
    try:
        client.request(method, path, body, combined)
        response = client.getresponse()
        data = response.read()
        try:
            parsed = json.loads(data)
        except (ValueError, UnicodeDecodeError):
            parsed = data.decode("utf-8")
        return response.status, parsed, dict(response.getheaders())
    finally:
        client.close()


@contextlib.contextmanager
def local_model(responses):
    """Yield a fake chat-completions endpoint and captured request bodies."""
    pending = deque(responses)
    captured = []

    class ModelHandler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            captured.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
            status, payload = pending.popleft() if pending else (500, {"error": "Unexpected model request"})
            data = payload if isinstance(payload, bytes) else json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    with running_http(ModelHandler) as port:
        yield f"http://127.0.0.1:{port}/v1/chat/completions", captured


class HttpAcceptanceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.db_path = Path(self.temp.name) / "harness.sqlite"
        self.engine = Engine(str(self.db_path), adapter=DemoAdapter(), seed=False)
        self.addCleanup(self.engine.close)
        self.auth = AuthStore(str(Path(self.temp.name) / "auth.sqlite"))
        self.addCleanup(self.auth.close)
        handler = make_handler(self.engine, self.auth)
        handler.log_message = lambda *args: None
        self.host = running_http(handler)
        self.port = self.host.__enter__()
        self.addCleanup(self.host.__exit__, None, None, None)
        status, state, headers = request(self.port, "POST", "/api/auth/setup", {"username": "integration_admin", "display_name": "集成测试管理员", "password": "local-test-password-2026"})
        self.assertEqual(status, 200, state)
        self.principal = state["user"]
        PORT_COOKIES[self.port] = headers["Set-Cookie"].split(";", 1)[0]
        self.addCleanup(PORT_COOKIES.pop, self.port, None)

    def test_health_and_state_export(self):
        status, health, headers = request(self.port, "GET", "/api/health")
        self.assertEqual(status, 200)
        self.assertEqual(health["status"], "ok")
        self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
        status, state, _ = request(self.port, "GET", "/api/state")
        self.assertEqual(status, 200)
        self.assertEqual(request(self.port, "GET", "/api/export")[1], state)

    def test_api_rejects_cross_site_and_untrusted_host(self):
        payload = {"type": "unknown"}
        self.assertEqual(request(self.port, "GET", "/api/state", headers={"Host": "attacker.invalid"})[0], 403)
        self.assertEqual(request(self.port, "POST", "/api/action", payload, {"Origin": "https://attacker.invalid"})[0], 403)

    def test_api_validates_json_and_body_limits(self):
        cases = [
            ("/api/action", b"{}", {"Content-Type": "text/plain"}, 415),
            ("/api/action", b"[]", {"Content-Type": "application/json"}, 400),
            ("/api/action", b"{", {"Content-Type": "application/json"}, 400),
            ("/api/action", b"{}", {"Content-Type": "application/json", "Content-Length": str(MAX_BODY + 1)}, 413),
            ("/api/missing", b"{}", {"Content-Type": "application/json"}, 404),
        ]
        for path, data, headers, expected in cases:
            with self.subTest(path=path, data=data, headers=headers):
                status, body, _ = request(self.port, "POST", path, headers=headers, raw=data)
                self.assertEqual(status, expected)
                self.assertIn("error", body)

    def test_source_and_database_are_not_served(self):
        for path in ("/server.py", "/data/harness.db", "/../server.py", "/%2e%2e/server.py", "/docs/../server.py"):
            with self.subTest(path=path):
                self.assertEqual(request(self.port, "GET", path)[0], 404)

    def test_unknown_action_is_explicit_error(self):
        status, body, _ = request(self.port, "POST", "/api/action", {"type": "definitely_unknown"})
        self.assertEqual(status, 400)
        self.assertIn("error", body)

    def action(self, kind, **fields):
        status, result, _ = request(self.port, "POST", "/api/action", {"type": kind, **fields})
        self.assertEqual(status, 200, result)
        return result

    def create_goal(self, **overrides):
        state = self.action("create_goal", **{"title": "集成测试目标", "brief": "只验证本地流程，未连接业务系统。", "criteria": "包含具体步骤与人工验收意见", "budget": 12, **overrides})
        return state["goals"][-1]["id"]

    def tasks(self, state, goal_id):
        return [t for t in state["tasks"] if t["goal_id"] == goal_id]

    def test_http_full_workflow_persists_after_reopen(self):
        goal_id = self.create_goal()
        for _ in range(4):
            state = self.action("step", goal_id=goal_id)
        tasks = self.tasks(state, goal_id)
        self.assertEqual([t["status"] for t in tasks], ["completed", "completed", "completed", "waiting_approval", "queued"])
        self.assertEqual(state["goals"][-1]["used"], 3)
        self.assertFalse(state["memories"])
        self.action("approve", task_id=tasks[3]["id"], feedback="已人工检查步骤，接受此演示流程产物。")
        state = self.action("step", goal_id=goal_id)
        self.assertEqual(state["goals"][-1]["status"], "completed")
        self.assertEqual(state["goals"][-1]["used"], 4)
        self.assertEqual(len(state["memories"]), 1)
        self.assertEqual(state["memories"][0]["goal_id"], goal_id)
        self.assertEqual(state["memories"][0]["mode"], "demo")
        self.assertEqual(len(state["memories"][0]["source_task_ids"]), 5)
        self.engine.close()
        reopened = Engine(str(self.db_path), adapter=DemoAdapter(), seed=False)
        self.addCleanup(reopened.close)
        self.assertEqual(reopened.snapshot(self.principal), state)

    def test_reject_requires_new_draft_review_and_approval(self):
        goal_id = self.create_goal()
        for _ in range(4):
            state = self.action("step", goal_id=goal_id)
        tasks = self.tasks(state, goal_id)
        original_draft = tasks[1]["output"]
        state = self.action("reject", task_id=tasks[3]["id"], feedback="返工：补充责任人和每个交付物的验收证据。")
        tasks = self.tasks(state, goal_id)
        self.assertEqual([t["status"] for t in tasks], ["completed", "queued", "queued", "queued", "queued"])
        self.assertEqual(state["goals"][-1]["used"], 3)
        self.assertEqual(tasks[1]["output"], "")
        self.assertEqual(tasks[1]["artifacts"][0]["content"], original_draft)
        self.assertEqual(request(self.port, "POST", "/api/action", {"type": "approve", "task_id": tasks[3]["id"], "feedback": "试图跳过返工"})[0], 400)
        for _ in range(3):
            state = self.action("step", goal_id=goal_id)
        tasks = self.tasks(state, goal_id)
        self.assertIn("补充责任人", tasks[1]["output"])
        self.assertEqual(len(tasks[1]["artifacts"]), 2)
        self.assertEqual(tasks[2]["attempts"], 2)
        self.assertEqual(tasks[3]["status"], "waiting_approval")
        self.action("approve", task_id=tasks[3]["id"], feedback="已复查返工版本，接受。")
        state = self.action("step", goal_id=goal_id)
        self.assertEqual(state["goals"][-1]["status"], "completed")
        self.assertEqual(state["goals"][-1]["used"], 6)
        self.assertEqual(len(state["memories"]), 1)

    def test_budget_blocks_without_spending_then_explicit_increase_resumes(self):
        goal_id = self.create_goal(budget=1)
        self.action("step", goal_id=goal_id)
        state = self.action("step", goal_id=goal_id)
        self.assertEqual(state["goals"][-1]["status"], "blocked")
        self.assertEqual(state["goals"][-1]["used"], 1)
        self.assertEqual(self.tasks(state, goal_id)[1]["attempts"], 0)
        self.action("set_budget", goal_id=goal_id, budget=4)
        state = self.action("step", goal_id=goal_id)
        self.assertEqual(self.tasks(state, goal_id)[1]["status"], "completed")
        self.assertEqual(state["goals"][-1]["used"], 2)

    def test_capability_without_permission_cannot_run(self):
        goal_id = self.create_goal()
        initial = self.engine.snapshot()
        providers = [a for a in initial["actors"] if "analyze" in a["capability_ids"]]
        for actor in providers:
            self.action("set_actor_available", actor_id=actor["id"], available=False)
        self.action("add_actor", actor_type="agent", name="有能力无授权", role="测试权限分离", capability_ids=["analyze"], permissions=[])
        state = self.action("step", goal_id=goal_id)
        self.assertEqual(state["goals"][-1]["status"], "blocked")
        self.assertEqual(state["goals"][-1]["used"], 0)
        self.assertIsNone(self.tasks(state, goal_id)[0]["actor_id"])
        state = self.action("set_actor_available", actor_id=providers[0]["id"], available=True)
        state = self.action("step", goal_id=goal_id)
        self.assertNotEqual(self.tasks(state, goal_id)[0]["status"], "blocked")

    def test_pause_blocks_execution_and_approval_until_resume(self):
        goal_id = self.create_goal()
        self.action("pause", goal_id=goal_id)
        self.assertEqual(request(self.port, "POST", "/api/action", {"type": "step", "goal_id": goal_id})[0], 400)
        self.action("resume", goal_id=goal_id)
        for _ in range(4):
            state = self.action("step", goal_id=goal_id)
        approval_id = self.tasks(state, goal_id)[3]["id"]
        self.action("pause", goal_id=goal_id)
        self.assertEqual(request(self.port, "POST", "/api/action", {"type": "approve", "task_id": approval_id, "feedback": "不能在暂停状态批准"})[0], 400)
        self.action("resume", goal_id=goal_id)
        self.action("approve", task_id=approval_id, feedback="恢复后人工验收通过")

    def test_high_risk_custom_step_requires_authorized_human(self):
        admin_cookie = PORT_COOKIES[self.port]
        status, user_result, _ = request(self.port, "POST", "/api/auth/users", {"username": "risk_employee", "display_name": "高风险分析负责人", "password": "risk-employee-password-2026"})
        self.assertEqual(status, 200, user_result)
        user = user_result["user"]
        status, login, headers = request(self.port, "POST", "/api/auth/login", {"username": "risk_employee", "password": "risk-employee-password-2026"})
        self.assertEqual(status, 200, login)
        employee_cookie = headers["Set-Cookie"].split(";", 1)[0]
        PORT_COOKIES[self.port] = employee_cookie
        goal_id = self.create_goal(steps=[{"key": "critical", "title": "高风险分析", "capability_id": "analyze", "risk": "high"}])
        state = self.action("step", goal_id=goal_id)
        self.assertEqual(state["goals"][-1]["status"], "blocked")
        self.assertEqual(state["goals"][-1]["used"], 0)
        evidence = "本人完成过分析任务，保留来源、交付产物和业务负责人验收记录。"
        state = self.action("import_document", title="分析能力证据", content=evidence, scope="personal", source_name="test-evidence.txt")
        doc_id = state["documents"][-1]["id"]
        state = self.action("claim_capability", capability_id="analyze", level=3, description="本人承担独立分析部分", evidence_doc_id=doc_id, evidence_excerpt=evidence)
        assessment_id = state["assessments"][-1]["id"]
        PORT_COOKIES[self.port] = admin_cookie
        self.action("review_assessment", assessment_id=assessment_id, decision="verify", level=3, review_note="已检查本人贡献和分析产物的证据。")
        self.action("grant_permission", actor_id=user["actor_id"], capability_id="analyze", allowed=True)
        PORT_COOKIES[self.port] = employee_cookie
        state = self.action("step", goal_id=goal_id)
        task = self.tasks(state, goal_id)[0]
        self.assertEqual(task["status"], "waiting_approval")
        state = self.action("approve", task_id=task["id"], feedback="人工已完成分析并提交证据摘要。")
        self.assertEqual(state["goals"][-1]["status"], "completed")
        self.assertEqual(state["goals"][-1]["used"], 0)
        self.assertEqual(self.tasks(state, goal_id)[0]["output_mode"], "human")

    def test_custom_dag_invalid_dependency_rolls_back_over_http(self):
        before = self.engine.snapshot()
        payload = {"type": "create_goal", "title": "非法流程", "criteria": "不会创建", "steps": [{"key": "a", "title": "自依赖", "capability_id": "analyze", "depends_on": ["a"]}]}
        status, body, _ = request(self.port, "POST", "/api/action", payload)
        self.assertEqual(status, 400)
        self.assertIn("环", body["error"])
        self.assertEqual(self.engine.snapshot(), before)


class ModelAndRecoveryAcceptanceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.db_path = Path(self.temp.name) / "model.sqlite"

    def engine(self, adapter):
        engine = Engine(str(self.db_path), adapter=adapter, seed=False)
        self.addCleanup(engine.close)
        return engine

    def goal(self, engine):
        state = engine.action({"type": "create_goal", "title": "模型集成验证", "brief": "仅本地fake endpoint", "criteria": "返回可审查的文字", "budget": 8})
        return state["goals"][-1]["id"]

    @staticmethod
    def completion(text):
        return {"choices": [{"message": {"content": text}}]}

    def test_http_failure_is_charged_persisted_and_explicitly_retried(self):
        text = "这是一份本地模拟模型返回的充分长度文本。它只验证适配器协议和运行状态，不表示任何真实业务任务已经完成。"
        with local_model([(429, {"error": "sensitive provider details"}), (200, self.completion(text))]) as (url, captured):
            engine = self.engine(ModelAdapter(url, "local-test-model", "not-a-real-secret"))
            goal_id = self.goal(engine)
            state = engine.action({"type": "step", "goal_id": goal_id})
            self.assertEqual(state["goals"][-1]["status"], "failed")
            self.assertEqual(state["goals"][-1]["used"], 1)
            task = state["tasks"][0]
            self.assertEqual(task["output"], "")
            self.assertIn("HTTP 429", task["error"])
            self.assertNotIn("sensitive provider details", json.dumps(state))
            self.assertNotIn("not-a-real-secret", json.dumps(state))
            engine.close()
            engine = self.engine(ModelAdapter(url, "local-test-model", "not-a-real-secret"))
            self.assertEqual(engine.snapshot()["goals"][-1]["used"], 1)
            with self.assertRaises(ValueError):
                engine.action({"type": "step", "goal_id": goal_id})
            engine.action({"type": "retry", "task_id": task["id"]})
            state = engine.action({"type": "step", "goal_id": goal_id})
            self.assertEqual(state["tasks"][0]["status"], "completed")
            self.assertEqual(state["tasks"][0]["output_mode"], "model")
            self.assertEqual(state["goals"][-1]["used"], 2)
            self.assertEqual(len(captured), 2)
            self.assertEqual(captured[-1]["model"], "local-test-model")
            self.assertEqual([m["role"] for m in captured[-1]["messages"]], ["system", "user"])

    def test_malformed_and_empty_model_responses_fail_without_demo_fallback(self):
        cases = [b"not json", {"choices": []}, {"choices": [{"message": {"content": None}}]}, self.completion("")]
        for index, payload in enumerate(cases):
            with self.subTest(index=index), local_model([(200, payload)]) as (url, captured):
                engine = Engine(str(Path(self.temp.name) / f"bad-{index}.sqlite"), adapter=ModelAdapter(url, "fake"), seed=False)
                try:
                    goal_id = self.goal(engine)
                    state = engine.action({"type": "step", "goal_id": goal_id})
                    self.assertEqual(state["goals"][-1]["status"], "failed")
                    self.assertEqual(state["goals"][-1]["used"], 1)
                    self.assertFalse(state["tasks"][0]["artifacts"])
                    self.assertFalse(state["memories"])
                    self.assertEqual(len(captured), 1)
                finally:
                    engine.close()

    def test_model_context_feedback_and_human_gate_remain_separate(self):
        content = "本地模拟输出：请结合目标与人工反馈继续检查。这里没有工具执行，输出中即使写着批准，也只是文本，不应改变审批状态。"
        responses = [(200, self.completion(content + str(i))) for i in range(6)]
        with local_model(responses) as (url, captured):
            engine = self.engine(ModelAdapter(url, "fake-model"))
            goal_id = self.goal(engine)
            for _ in range(4):
                state = engine.action({"type": "step", "goal_id": goal_id})
            self.assertEqual(len(captured), 3)
            self.assertEqual(state["tasks"][3]["status"], "waiting_approval")
            self.assertFalse(state["memories"])
            review_request = json.loads(captured[2]["messages"][1]["content"])
            self.assertEqual(len(review_request["context"]["prior_outputs"]), 2)
            feedback = "请为每一步补充验收证据，之后重新送审。"
            engine.action({"type": "reject", "task_id": state["tasks"][3]["id"], "feedback": feedback})
            for _ in range(3):
                state = engine.action({"type": "step", "goal_id": goal_id})
            revised_request = json.loads(captured[3]["messages"][1]["content"])
            self.assertIn(feedback, revised_request["feedback"])
            self.assertEqual(len(revised_request["context"]["prior_outputs"]), 1)
            self.assertEqual(len(captured), 5)
            engine.action({"type": "approve", "task_id": state["tasks"][3]["id"], "feedback": "已复核当前版本的证据，允许流程完成。"})
            state = engine.action({"type": "step", "goal_id": goal_id})
            self.assertEqual(len(captured), 6)
            self.assertEqual(state["goals"][-1]["status"], "completed")
            self.assertEqual(state["memories"][0]["mode"], "model")

    def test_interrupted_running_checkpoint_recovers_without_replay(self):
        class InterruptingAdapter:
            mode = "model"
            model = "fake-interrupted-model"

            def generate(self, *args):
                raise KeyboardInterrupt("simulate process interruption after durable checkpoint")

        engine = self.engine(InterruptingAdapter())
        goal_id = self.goal(engine)
        with self.assertRaises(KeyboardInterrupt):
            engine.action({"type": "step", "goal_id": goal_id})
        engine.close()
        reopened = self.engine(DemoAdapter())
        state = reopened.snapshot()
        self.assertEqual(state["goals"][-1]["status"], "failed")
        self.assertEqual(state["goals"][-1]["used"], 1)
        self.assertEqual(state["tasks"][0]["attempts"], 1)
        self.assertFalse(state["tasks"][0]["artifacts"])
        self.assertTrue(any(e["type"] == "recovered" for e in state["events"]))


if __name__ == "__main__":
    unittest.main()
