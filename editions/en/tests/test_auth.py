"""Authentication and cross-employee isolation, using temporary local stores only."""
from __future__ import annotations

import hashlib
import json
import tempfile
import time
import unittest
from pathlib import Path
from urllib.parse import quote

from auth import AuthError, AuthStore, COOKIE, ITERATIONS
from harness.adapters import DemoAdapter, ModelAdapter
from harness.engine import Engine
from server import make_handler
from test_integration import local_model, request, running_http


PASSWORD = "local-only-strong-password-2026"


class AuthStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "auth.sqlite"
        self.auth = AuthStore(str(self.path))
        self.addCleanup(self.auth.close)

    def setup_admin(self):
        return self.auth.setup({"username": "admin_test", "display_name": "测试管理员", "password": PASSWORD})

    def test_setup_once_and_no_plaintext_secrets(self):
        self.assertFalse(self.auth.has_users())
        admin, token = self.setup_admin()
        self.assertTrue(self.auth.has_users())
        self.assertEqual(admin["role"], "admin")
        self.assertEqual(self.auth.resolve(token), admin)
        with self.assertRaises(AuthError) as failed:
            self.setup_admin()
        self.assertEqual(failed.exception.status, 409)
        row = dict(self.auth.db.execute("SELECT * FROM users").fetchone())
        self.assertEqual(row["iterations"], ITERATIONS)
        self.assertGreaterEqual(row["iterations"], 600_000)
        expected = hashlib.pbkdf2_hmac("sha256", PASSWORD.encode(), bytes.fromhex(row["salt"]), row["iterations"]).hex()
        self.assertEqual(row["password_hash"], expected)
        self.assertNotIn(PASSWORD, json.dumps(row))
        sessions = [dict(r) for r in self.auth.db.execute("SELECT * FROM sessions")]
        self.assertNotIn(token, json.dumps(sessions))
        self.assertNotIn("password_hash", admin)
        self.assertNotIn("salt", admin)

    def test_login_restart_expiration_and_logout(self):
        admin, token = self.setup_admin()
        self.auth.close()
        reopened = AuthStore(str(self.path))
        self.addCleanup(reopened.close)
        self.assertEqual(reopened.resolve(token), admin)
        user, second = reopened.login({"username": "ADMIN_TEST", "password": PASSWORD})
        self.assertEqual(user, admin)
        self.assertNotEqual(second, token)
        reopened.logout(token)
        self.assertIsNone(reopened.resolve(token))
        self.assertEqual(reopened.resolve(second), admin)
        with reopened.db:
            reopened.db.execute("UPDATE sessions SET expires_at=?", (time.time() - 1,))
        self.assertIsNone(reopened.resolve(second))

    def test_employee_cannot_create_users_and_role_cannot_be_injected(self):
        admin, _ = self.setup_admin()
        employee = self.auth.create_employee({"username": "employee_one", "display_name": "员工一", "password": PASSWORD, "role": "admin", "actor_id": admin["actor_id"]}, admin)
        self.assertEqual(employee["role"], "employee")
        self.assertNotEqual(employee["actor_id"], admin["actor_id"])
        for principal in (None, employee):
            with self.assertRaises(AuthError) as failed:
                self.auth.create_employee({"username": "unauthorized", "display_name": "无权创建", "password": PASSWORD}, principal)
            self.assertEqual(failed.exception.status, 403)
            with self.assertRaises(AuthError):
                self.auth.list_users(principal)
        users = self.auth.list_users(admin)
        self.assertEqual(len(users), 2)
        rows = [dict(row) for row in self.auth.db.execute("SELECT salt,password_hash FROM users")]
        self.assertNotEqual(rows[0]["salt"], rows[1]["salt"])
        self.assertNotEqual(rows[0]["password_hash"], rows[1]["password_hash"])
        self.assertNotIn("password_hash", json.dumps(users))

    def test_credentials_validation_and_case_insensitive_uniqueness(self):
        base = {"username": "valid_user", "display_name": "有效姓名", "password": PASSWORD}
        for override in ({"username": "ab"}, {"username": "bad user"}, {"username": "中文账号"}, {"display_name": " "}, {"password": "short"}, {"password": 12345}):
            with self.subTest(override=override), self.assertRaises(AuthError):
                self.auth.setup({**base, **override})
            self.assertFalse(self.auth.has_users())
        admin, _ = self.setup_admin()
        with self.assertRaises(AuthError) as failed:
            self.auth.create_employee({**base, "username": "ADMIN_TEST"}, admin)
        self.assertEqual(failed.exception.status, 409)

    def test_wrong_password_and_unknown_user_have_same_error(self):
        self.setup_admin()
        messages = []
        for username in ("admin_test", "missing_user"):
            with self.assertRaises(AuthError) as failed:
                self.auth.login({"username": username, "password": "wrong-password-2026"})
            messages.append((failed.exception.status, str(failed.exception)))
        self.assertEqual(messages[0], messages[1])
        self.assertEqual(messages[0][0], 401)
        self.assertIsNone(self.auth.resolve("invalid-token-value-long-enough"))
        self.assertIsNone(self.auth.resolve(None))

    def test_repeated_failed_login_is_rate_limited(self):
        self.setup_admin()
        self.auth.failures["admin_test"] = [time.time()] * 10
        with self.assertRaises(AuthError) as failed:
            self.auth.login({"username": "admin_test", "password": PASSWORD})
        self.assertEqual(failed.exception.status, 429)
        self.auth.failures["admin_test"] = [time.time() - 61] * 10
        user, _ = self.auth.login({"username": "admin_test", "password": PASSWORD})
        self.assertEqual(user["role"], "admin")


class AuthHttpIsolationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.auth = AuthStore(str(Path(self.temp.name) / "auth.sqlite"))
        self.addCleanup(self.auth.close)
        self.engine = Engine(str(Path(self.temp.name) / "engine.sqlite"), adapter=DemoAdapter(), seed=False)
        self.addCleanup(self.engine.close)
        handler = make_handler(self.engine, self.auth)
        handler.log_message = lambda *args: None
        self.host = running_http(handler)
        self.port = self.host.__enter__()
        self.addCleanup(self.host.__exit__, None, None, None)
        self.cookies = {"anonymous": ""}
        status, result, headers = self.call("anonymous", "POST", "/api/auth/setup", {"username": "admin_test", "display_name": "管理员", "password": PASSWORD})
        self.assertEqual(status, 200, result)
        self.admin = result["user"]
        self.admin_cookie_header = headers["Set-Cookie"]
        self.cookies["admin"] = headers["Set-Cookie"].split(";", 1)[0]
        self.users = {}
        for name in ("alice", "bob"):
            status, result, _ = self.call("admin", "POST", "/api/auth/users", {"username": name, "display_name": name, "password": PASSWORD})
            self.assertEqual(status, 200, result)
            self.users[name] = result["user"]
            status, result, headers = self.call("anonymous", "POST", "/api/auth/login", {"username": name, "password": PASSWORD})
            self.assertEqual(status, 200, result)
            self.cookies[name] = headers["Set-Cookie"].split(";", 1)[0]

    def call(self, identity, method, path, payload=None, headers=None):
        return request(self.port, method, path, payload, {"Cookie": self.cookies[identity], **(headers or {})})

    def action(self, identity, kind, expected=200, **fields):
        status, result, _ = self.call(identity, "POST", "/api/action", {"type": kind, **fields})
        self.assertEqual(status, expected, result)
        return result

    def state(self, identity):
        status, result, _ = self.call(identity, "GET", "/api/state")
        self.assertEqual(status, 200, result)
        return result

    def goal(self, identity, **overrides):
        state = self.action(identity, "create_goal", **{"title": identity + " private goal", "criteria": "只验证本地流程", **overrides})
        return state["goals"][-1]["id"]

    def document(self, identity, scope, content):
        state = self.action(identity, "import_document", title=identity + " source", content=content, scope=scope, source_name="local-test.txt")
        return state["documents"][-1]["id"]

    def test_anonymous_has_no_business_or_document_access(self):
        paths = ("/api/state", "/api/export", "/api/analysis", "/api/auth/users", "/docs/" + quote("04-员工能力与知识接入.md"))
        for path in paths:
            with self.subTest(path=path):
                self.assertEqual(self.call("anonymous", "GET", path)[0], 401)
        self.action("anonymous", "create_goal", expected=401, title="unauthorized", criteria="none")
        status, result, _ = self.call("anonymous", "GET", "/api/auth/state")
        self.assertEqual(status, 200)
        self.assertFalse(result["authenticated"])
        self.assertFalse(result["setup_required"])

    def test_cookie_logout_and_role_boundaries(self):
        self.assertIn("HttpOnly", self.admin_cookie_header)
        self.assertIn("SameSite=Strict", self.admin_cookie_header)
        self.assertIn("Path=/", self.admin_cookie_header)
        self.assertIn("Max-Age=43200", self.admin_cookie_header)
        self.assertEqual(self.call("alice", "GET", "/api/auth/users")[0], 403)
        self.assertEqual(self.call("alice", "POST", "/api/auth/users", {"username": "eve", "display_name": "eve", "password": PASSWORD, "role": "admin"})[0], 403)
        status, body, _ = self.call("admin", "GET", "/api/auth/users")
        self.assertEqual(status, 200)
        self.assertEqual(len(body["users"]), 3)
        self.assertNotIn("password_hash", json.dumps(body))
        status, body, headers = self.call("alice", "POST", "/api/auth/logout", {})
        self.assertEqual(status, 200)
        self.assertIn("Max-Age=0", headers["Set-Cookie"])
        self.assertEqual(self.call("alice", "GET", "/api/state")[0], 401)
        self.assertEqual(self.call("bob", "GET", "/api/state")[0], 200)

    def test_cross_site_login_and_mutations_are_rejected(self):
        for path, payload in (("/api/auth/login", {"username": "alice", "password": PASSWORD}), ("/api/auth/logout", {}), ("/api/action", {"type": "create_goal", "title": "cross-site", "criteria": "none"})):
            with self.subTest(path=path):
                self.assertEqual(self.call("alice", "POST", path, payload, {"Origin": "https://attacker.invalid"})[0], 403)

    def test_goal_and_export_isolation_and_forged_owner_ignored(self):
        alice_goal = self.goal("alice", owner_id=self.users["bob"]["id"], owner_actor_id=self.users["bob"]["actor_id"], role="admin")
        bob_goal = self.goal("bob")
        self.assertEqual([g["id"] for g in self.state("alice")["goals"]], [alice_goal])
        self.assertEqual([g["id"] for g in self.state("bob")["goals"]], [bob_goal])
        self.assertEqual(len(self.state("admin")["goals"]), 2)
        self.action("bob", "step", expected=403, goal_id=alice_goal)
        self.action("bob", "pause", expected=403, goal_id=alice_goal)
        alice_state = self.state("alice")
        alice_task = next(t for t in alice_state["tasks"] if t["goal_id"] == alice_goal)
        self.action("bob", "retry", expected=403, task_id=alice_task["id"])
        status, exported, _ = self.call("bob", "GET", "/api/export")
        self.assertEqual(status, 200)
        self.assertNotIn(alice_goal, {goal["id"] for goal in exported["goals"]})
        self.assertFalse(any(task["goal_id"] == alice_goal for task in exported["tasks"]))
        public_goal = next(goal for goal in exported["coordination"]["goals"] if goal["id"] == alice_goal)
        self.assertEqual(public_goal["title"], "alice private goal")
        self.assertNotIn("brief", public_goal)
        self.assertNotIn("criteria", public_goal)
        for task in exported["coordination"]["tasks"]:
            self.assertNotIn("output", task)
            self.assertNotIn("submission", task)
            self.assertNotIn("feedback", task)
        self.assertEqual(exported["current_user"]["id"], self.users["bob"]["id"])

    def test_private_documents_and_assessment_evidence_do_not_leak(self):
        private_text = "ALICE_PRIVATE_EVIDENCE_2026：我根据三个客户访谈完成需求分析并给出原文引用。"
        alice_doc = self.document("alice", "personal", private_text)
        shared_doc = self.document("admin", "organization", "SHARED_GUIDE：需求分析包含原文引用和待核实假设。")
        self.document("bob", "personal", "BOB_PRIVATE_EVIDENCE：本人分析记录。")
        alice_state = self.action("alice", "claim_capability", capability_id="analyze", level=3, description="独立完成访谈需求提取。", evidence_doc_id=alice_doc, evidence_excerpt="我根据三个客户访谈完成需求分析并给出原文引用。")
        assessment = alice_state["assessments"][-1]
        bob_state = self.state("bob")
        self.assertIn(shared_doc, {d["id"] for d in bob_state["documents"]})
        self.assertNotIn(alice_doc, {d["id"] for d in bob_state["documents"]})
        self.assertNotIn(private_text, json.dumps(bob_state, ensure_ascii=False))
        self.assertNotIn(assessment["id"], {a["id"] for a in bob_state["assessments"]})
        self.action("bob", "suggest_capabilities", expected=403, document_id=alice_doc)
        self.action("bob", "claim_capability", expected=403, capability_id="analyze", level=3, description="伪造读取", evidence_doc_id=alice_doc, evidence_excerpt="我根据三个客户访谈完成需求分析并给出原文引用。")
        self.action("alice", "import_document", expected=403, title="不能由员工公开", content="content", scope="organization", source_name="test")
        self.assertIn(alice_doc, {d["id"] for d in self.state("admin")["documents"]})

    def test_verified_capability_and_permission_are_separate_and_revocable(self):
        excerpt = "本人已完成来源核对和需求提取，产物由业务负责人审核。"
        doc = self.document("alice", "personal", excerpt)
        state = self.action("alice", "claim_capability", capability_id="analyze", level=3, description="提交本人的实践证据", evidence_doc_id=doc, evidence_excerpt=excerpt)
        assessment = state["assessments"][-1]
        actor_id = self.users["alice"]["actor_id"]
        self.action("alice", "review_assessment", expected=403, assessment_id=assessment["id"], decision="verify", level=5, review_note="试图自我认证")
        self.action("alice", "grant_permission", expected=403, actor_id=actor_id, capability_id="analyze", allowed=True)
        self.action("admin", "grant_permission", expected=400, actor_id=actor_id, capability_id="analyze", allowed=True)
        state = self.action("admin", "review_assessment", assessment_id=assessment["id"], decision="verify", level=3, review_note="已核对本人贡献、资料来源与验收产物。")
        actor = next(a for a in state["actors"] if a["id"] == actor_id)
        self.assertIn("analyze", actor["capability_ids"])
        self.assertNotIn("analyze", actor["permissions"])
        state = self.action("admin", "grant_permission", actor_id=actor_id, capability_id="analyze", allowed=True)
        self.assertIn("analyze", next(a for a in state["actors"] if a["id"] == actor_id)["permissions"])
        state = self.action("admin", "review_assessment", assessment_id=assessment["id"], decision="reject", level=3, review_note="复核发现贡献归属待澄清，撤回核验。")
        actor = next(a for a in state["actors"] if a["id"] == actor_id)
        self.assertNotIn("analyze", actor["capability_ids"])
        self.assertNotIn("analyze", actor["permissions"])

    def test_claim_requires_real_visible_excerpt_and_cannot_target_another_employee(self):
        excerpt = "可以核对的真实原文片段。"
        doc = self.document("alice", "personal", excerpt)
        self.action("alice", "claim_capability", expected=400, capability_id="analyze", level=3, description="未匹配原文", evidence_doc_id=doc, evidence_excerpt="文档中不存在的证据")
        state = self.action("alice", "claim_capability", capability_id="analyze", level=3, description="引用本人证据", evidence_doc_id=doc, evidence_excerpt=excerpt, actor_id=self.users["bob"]["actor_id"])
        self.assertEqual(state["assessments"][-1]["actor_id"], self.users["alice"]["actor_id"])

    def test_rule_candidates_do_not_certify_or_authorize(self):
        doc = self.document("alice", "personal", "资料介绍数据分析、SQL、数据清洗，以及需求分析的方法，未证明上传者已掌握。")
        state = self.action("alice", "suggest_capabilities", document_id=doc)
        candidates = state["assessments"]
        self.assertTrue(candidates)
        self.assertTrue(all(a["status"] == "suggested" and a["method"] == "keyword_rule" and a["level"] == 1 for a in candidates))
        actor = next(a for a in state["actors"] if a["id"] == self.users["alice"]["actor_id"])
        self.assertEqual(actor["capability_ids"], [])
        self.assertEqual(actor["permissions"], [])
        self.assertEqual(actor["capability_levels"], {})

    def test_model_context_uses_goal_owner_visibility_even_when_admin_runs_it(self):
        alice_doc = self.document("alice", "personal", "ALICE_CONTEXT_ONLY：本人可见的资料。")
        bob_doc = self.document("bob", "personal", "BOB_CONTEXT_SECRET：不能进入Alice的模型上下文。")
        admin_doc = self.document("admin", "personal", "ADMIN_CONTEXT_SECRET：管理员代跑也不能混入。")
        shared_doc = self.document("admin", "organization", "ORG_CONTEXT_SHARED：组织公开的方法说明。")
        response = {"choices": [{"message": {"content": "这是本地模型模拟器提供的充足长度文本，仅用来验证按目标所有者过滤上下文，不是业务分析结果。"}}]}
        with local_model([(200, response)]) as (url, captured):
            self.engine.adapter = ModelAdapter(url, "local-auth-test")
            goal_id = self.goal("alice")
            self.action("admin", "step", goal_id=goal_id)
        self.assertEqual(len(captured), 1)
        context = json.loads(captured[0]["messages"][1]["content"])["context"]
        documents = context["knowledge_documents"]
        self.assertEqual({d["document_id"] for d in documents}, {alice_doc, shared_doc})
        serialized = json.dumps(captured, ensure_ascii=False)
        self.assertNotIn(bob_doc, serialized)
        self.assertNotIn(admin_doc, serialized)
        self.assertNotIn("BOB_CONTEXT_SECRET", serialized)
        self.assertNotIn("ADMIN_CONTEXT_SECRET", serialized)

    def test_cross_employee_assignment_shares_only_task_and_dependency_ancestors(self):
        excerpt = "Bob完成高风险分析的本人贡献和验收证据。"
        doc_id = self.document("bob", "personal", excerpt)
        state = self.action("bob", "claim_capability", capability_id="analyze", level=3, description="承担人工分析", evidence_doc_id=doc_id, evidence_excerpt=excerpt)
        self.action("admin", "review_assessment", assessment_id=state["assessments"][-1]["id"], decision="verify", level=3, review_note="已核实本人贡献与合格产物。")
        self.action("admin", "grant_permission", actor_id=self.users["bob"]["actor_id"], capability_id="analyze", allowed=True)
        steps = [
            {"key": "other", "title": "与Bob无关的独立草稿", "capability_id": "draft", "depends_on": []},
            {"key": "assigned", "title": "交给Bob的分析", "capability_id": "analyze", "risk": "high", "depends_on": []},
            {"key": "later", "title": "后续汇总", "capability_id": "reflect", "depends_on": ["other", "assigned"]},
        ]
        goal_id = self.goal("alice", steps=steps)
        self.action("alice", "step", goal_id=goal_id)
        state = self.action("alice", "step", goal_id=goal_id)
        assigned = next(t for t in state["tasks"] if t["key"] == "assigned")
        self.assertEqual(assigned["actor_id"], self.users["bob"]["actor_id"])
        bob_state = self.state("bob")
        self.assertEqual([g["id"] for g in bob_state["goals"]], [goal_id])
        self.assertFalse(bob_state["goals"][0]["can_manage"])
        self.assertEqual([t["id"] for t in bob_state["tasks"]], [assigned["id"]])
        self.action("bob", "step", expected=403, goal_id=goal_id)
        self.action("alice", "approve", expected=403, task_id=assigned["id"], feedback="不能替Bob提交")
        self.action("admin", "approve", expected=403, task_id=assigned["id"], feedback="管理员也不能代签")
        state = self.action("bob", "approve", task_id=assigned["id"], feedback="Bob本人提交人工分析结果和证据。")
        self.assertEqual(next(t for t in state["tasks"] if t["id"] == assigned["id"])["status"], "completed")


if __name__ == "__main__":
    unittest.main()
