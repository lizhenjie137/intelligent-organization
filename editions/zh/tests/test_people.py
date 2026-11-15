"""Account boundaries, evidence provenance, certification and permission tests."""

import tempfile
from pathlib import Path
import unittest

from harness import Engine
from harness.adapters import DemoAdapter


class RecordingAdapter(DemoAdapter):
    def generate(self, goal, task, capability, context):
        self.last_context = context
        return super().generate(goal, task, capability, context)


class PeopleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "people.sqlite3"
        self.adapter = RecordingAdapter()
        self.engine = Engine(self.path, adapter=self.adapter)
        self.admin = self.account("admin", "admin")
        self.alice = self.account("alice", "employee")
        self.bob = self.account("bob", "employee")

    def tearDown(self):
        self.engine.close()
        self.temp.cleanup()

    def account(self, user_id, role):
        principal = {"id": user_id, "username": user_id, "display_name": user_id, "role": role, "actor_id": "person_" + user_id}
        actor = self.engine.provision_employee(principal)
        self.assertEqual(actor["id"], principal["actor_id"])
        return principal

    def act(self, principal, kind, **payload):
        return self.engine.action({"type": kind, **payload}, principal)

    def doc(self, principal, content="我完成数据分析，保留清洗脚本、字段口径和计算复核报告。", scope="personal"):
        state = self.act(principal, "import_document", title="工作证据", content=content, scope=scope, source_name="本人项目记录.md")
        return state["documents"][-1]

    def claim(self, principal, document, capability="data_analysis"):
        state = self.act(principal, "claim_capability", capability_id=capability, level=3, description="本人负责分析过程，可展示计算与核验记录", evidence_doc_id=document["id"], evidence_excerpt=document["content"])
        return state["assessments"][-1]

    def verify(self, assessment):
        return self.act(self.admin, "review_assessment", assessment_id=assessment["id"], decision="verify", level=3, review_note="核对产物归属与复核过程，支持独立执行此范围工作。")

    def new_goal(self, principal, **payload):
        state = self.act(principal, "create_goal", title="本人工作目标", criteria="提交可核验材料", **payload)
        return state["goals"][-1]

    def test_account_provision_is_idempotent_and_migrates_legacy(self):
        first = self.engine.provision_employee(self.admin)
        second = self.engine.provision_employee(self.admin)
        self.assertEqual(first, second)
        self.assertEqual(len([a for a in self.engine.snapshot()["actors"] if a.get("user_id") == "admin"]), 1)
        self.assertEqual(self.engine.snapshot()["goals"][0]["owner_id"], "admin")
        self.assertFalse(next(a for a in self.engine.snapshot()["actors"] if a["id"] == "owner")["available"])
        alice = self.engine.provision_employee(self.alice)
        self.assertEqual(alice["capability_ids"], [])
        self.assertEqual(alice["permissions"], [])

    def test_unprovisioned_or_mismatched_identity_is_rejected(self):
        with self.assertRaises((KeyError, ValueError, PermissionError)):
            self.engine.snapshot({**self.alice, "actor_id": "person_bob"})
        with self.assertRaises((ValueError, PermissionError)):
            self.act({**self.alice, "role": "admin"}, "add_capability", name="伪造管理员")

    def test_employee_goal_access_and_budget_are_owner_scoped(self):
        goal = self.new_goal(self.alice, owner_id="bob")
        self.assertEqual(goal["owner_id"], "alice")
        self.assertEqual(self.engine.snapshot(self.bob)["goals"], [])
        for action in ("step", "pause", "resume", "set_budget"):
            with self.assertRaises((ValueError, PermissionError)):
                self.act(self.bob, action, goal_id=goal["id"], budget=99)
        self.act(self.alice, "set_budget", goal_id=goal["id"], budget=15)
        self.act(self.alice, "step", goal_id=goal["id"])
        task = self.engine.snapshot(self.alice)["tasks"][0]
        with self.assertRaises((ValueError, PermissionError)):
            self.act(self.bob, "retry", task_id=task["id"])
        events = self.engine.snapshot(self.alice)["events"]
        self.assertTrue(all(e["user_id"] == "alice" for e in events))

    def test_employees_cannot_mutate_catalog_or_permissions(self):
        for kind, payload in [("add_actor", {}), ("add_capability", {}), ("set_actor_available", {"actor_id": "analyst", "available": False}), ("grant_permission", {}), ("review_assessment", {})]:
            with self.assertRaises((ValueError, PermissionError)):
                self.act(self.alice, kind, **payload)
        with self.assertRaises((ValueError, PermissionError)):
            self.act(self.admin, "add_actor", name="无账号人员", role="执行者", actor_type="human", capability_ids=["analyze"], permissions=["analyze"])

    def test_personal_documents_and_assessments_do_not_leak(self):
        private = self.doc(self.alice)
        public = self.doc(self.admin, "组织流程：需求分析与质量检查", "organization")
        assessment = self.claim(self.alice, private)
        bob = self.engine.snapshot(self.bob)
        self.assertEqual([d["id"] for d in bob["documents"]], [public["id"]])
        self.assertEqual(bob["assessments"], [])
        self.assertNotIn(private["content"], str(bob))
        self.assertIn(private["id"], [d["id"] for d in self.engine.snapshot(self.admin)["documents"]])
        self.assertIn(assessment["id"], [a["id"] for a in self.engine.snapshot(self.admin)["assessments"]])
        with self.assertRaises((ValueError, PermissionError)):
            self.claim(self.bob, private)
        with self.assertRaises((ValueError, PermissionError)):
            self.act(self.bob, "suggest_capabilities", document_id=private["id"])
        with self.assertRaises((ValueError, PermissionError)):
            self.doc(self.alice, scope="organization")

    def test_import_limits_and_evidence_quote_validation(self):
        private = self.doc(self.alice)
        with self.assertRaises((ValueError, PermissionError)):
            self.act(self.alice, "import_document", title="过长", content="文" * 100001, scope="personal")
        with self.assertRaises((ValueError, PermissionError)):
            self.act(self.alice, "claim_capability", capability_id="data_analysis", level=3, description="自报", evidence_doc_id=private["id"], evidence_excerpt="原文没有这段话")
        with self.assertRaises((ValueError, PermissionError)):
            self.act(self.alice, "claim_capability", capability_id="data_analysis", level=True, description="自报", evidence_doc_id=private["id"], evidence_excerpt=private["content"])

    def test_claim_uses_current_employee_not_payload_actor(self):
        private = self.doc(self.alice)
        state = self.act(self.alice, "claim_capability", actor_id=self.bob["actor_id"], user_id="bob", capability_id="data_analysis", level=3, description="本人工作", evidence_doc_id=private["id"], evidence_excerpt=private["content"])
        self.assertEqual(state["assessments"][-1]["actor_id"], self.alice["actor_id"])

    def test_suggestion_is_explainable_and_neither_certifies_nor_grants(self):
        private = self.doc(self.alice, "这份教程介绍数据分析和内容写作，同时讲解需求分析与复盘。")
        state = self.act(self.alice, "suggest_capabilities", document_id=private["id"])
        self.assertGreaterEqual(len(state["assessments"]), 4)
        for assessment in state["assessments"]:
            self.assertEqual(assessment["status"], "suggested")
            self.assertEqual(assessment["method"], "keyword_rule")
            self.assertIn(assessment["evidence_excerpt"], private["content"])
            self.assertIn("不能证明", assessment["description"])
        actor = next(a for a in state["actors"] if a["id"] == self.alice["actor_id"])
        self.assertEqual(actor["capability_ids"], [])
        self.assertEqual(actor["permissions"], [])
        count = len(state["assessments"])
        again = self.act(self.alice, "suggest_capabilities", document_id=private["id"])
        self.assertEqual(len(again["assessments"]), count)

    def test_verified_evidence_is_distinct_from_execution_permission(self):
        private = self.doc(self.alice)
        assessment = self.claim(self.alice, private)
        with self.assertRaises((ValueError, PermissionError)):
            self.act(self.admin, "grant_permission", actor_id=self.alice["actor_id"], capability_id="data_analysis", allowed=True)
        state = self.verify(assessment)
        actor = next(a for a in state["actors"] if a["id"] == self.alice["actor_id"])
        self.assertIn("data_analysis", actor["capability_ids"])
        self.assertNotIn("data_analysis", actor["permissions"])
        self.assertEqual(actor["capability_levels"]["data_analysis"], 3)
        self.act(self.admin, "grant_permission", actor_id=self.alice["actor_id"], capability_id="data_analysis", allowed=True)
        goal = self.new_goal(self.alice, steps=[{"key": "analysis", "title": "分析", "capability_id": "data_analysis", "risk": "high"}])
        state = self.act(self.alice, "step", goal_id=goal["id"])
        task = state["tasks"][-1]
        self.assertEqual(task["actor_id"], self.alice["actor_id"])
        self.assertEqual(task["status"], "waiting_approval")
        with self.assertRaises((ValueError, PermissionError)):
            self.act(self.admin, "approve", task_id=task["id"], feedback="替员工提交")
        self.act(self.admin, "grant_permission", actor_id=self.alice["actor_id"], capability_id="data_analysis", allowed=False)
        with self.assertRaises((ValueError, PermissionError)):
            self.act(self.alice, "approve", task_id=task["id"], feedback="撤权后提交")
        self.act(self.admin, "grant_permission", actor_id=self.alice["actor_id"], capability_id="data_analysis", allowed=True)
        state = self.act(self.alice, "approve", task_id=task["id"], feedback="本人分析结果及复核证据。")
        self.assertEqual(state["goals"][-1]["status"], "completed")

    def test_rejecting_last_verified_evidence_revokes_capability_and_permission(self):
        assessment = self.claim(self.alice, self.doc(self.alice))
        self.verify(assessment)
        self.act(self.admin, "grant_permission", actor_id=self.alice["actor_id"], capability_id="data_analysis", allowed=True)
        state = self.act(self.admin, "review_assessment", assessment_id=assessment["id"], decision="reject", level=2, review_note="复核发现证据不能证明本人独立完成。")
        actor = next(a for a in state["actors"] if a["id"] == self.alice["actor_id"])
        self.assertNotIn("data_analysis", actor["capability_ids"])
        self.assertNotIn("data_analysis", actor["permissions"])
        self.assertEqual(len(state["assessments"][-1]["review_history"]), 2)

    def test_admin_cannot_certify_their_own_claim(self):
        assessment = self.claim(self.admin, self.doc(self.admin))
        with self.assertRaises((ValueError, PermissionError)):
            self.verify(assessment)
        another_admin = self.account("admin2", "admin")
        self.act(another_admin, "review_assessment", assessment_id=assessment["id"], decision="verify", review_note="由另一管理员核对证据", level=3)

    def test_model_context_uses_goal_owner_permissions_not_operator_permissions(self):
        alice_doc = self.doc(self.alice, "ALICE_ONLY 数据分析")
        bob_doc = self.doc(self.bob, "BOB_SECRET 数据分析")
        org_doc = self.doc(self.admin, "ORGANIZATION_SHARED 工作规范", "organization")
        bob_goal = self.new_goal(self.bob, steps=[{"key": "one", "title": "分析", "capability_id": "analyze"}])
        self.act(self.bob, "step", goal_id=bob_goal["id"])
        goal = self.new_goal(self.alice)
        self.act(self.admin, "step", goal_id=goal["id"])
        context = self.adapter.last_context
        ids = {d["document_id"] for d in context["knowledge_documents"]}
        self.assertIn(alice_doc["id"], ids)
        self.assertIn(org_doc["id"], ids)
        self.assertNotIn(bob_doc["id"], ids)
        self.assertEqual(context["reference_memories"], [])
        self.assertNotIn("BOB_SECRET", str(context))

    def test_new_records_survive_reopen_and_permission_revocation_survives_login(self):
        assessment = self.claim(self.alice, self.doc(self.alice))
        self.verify(assessment)
        self.act(self.admin, "grant_permission", actor_id=self.admin["actor_id"], capability_id="approve", allowed=False)
        self.engine.close()
        self.engine = Engine(self.path, adapter=self.adapter)
        actor = self.engine.provision_employee(self.admin)
        self.assertNotIn("approve", actor["permissions"])
        state = self.engine.snapshot(self.alice)
        self.assertEqual(state["assessments"][0]["status"], "verified")
        self.assertEqual(len(state["documents"]), 1)

    def test_cross_employee_assignment_shares_only_task_context_and_not_management(self):
        assessment = self.claim(self.alice, self.doc(self.alice))
        self.verify(assessment)
        self.act(self.admin, "grant_permission", actor_id=self.alice["actor_id"], capability_id="data_analysis", allowed=True)
        bob_doc = self.doc(self.bob, "BOB_PRIVATE_INPUT 私有工作资料")
        goal = self.new_goal(self.bob, steps=[
            {"key": "source", "title": "准备背景", "capability_id": "analyze"},
            {"key": "handoff", "title": "请分析师交付", "capability_id": "data_analysis", "risk": "high", "depends_on": ["source"]},
            {"key": "unrelated", "title": "仅创建者可见的后续", "capability_id": "reflect", "depends_on": ["source"]},
        ])
        self.act(self.bob, "step", goal_id=goal["id"])
        self.act(self.bob, "step", goal_id=goal["id"])
        assigned = self.engine.snapshot(self.alice)
        shared_goal = next(g for g in assigned["goals"] if g["id"] == goal["id"])
        self.assertFalse(shared_goal["can_manage"])
        self.assertEqual(assigned["current_user"], self.alice)
        shared_tasks = [t for t in assigned["tasks"] if t["goal_id"] == goal["id"]]
        self.assertEqual({t["key"] for t in shared_tasks}, {"source", "handoff"})
        self.assertNotIn(bob_doc["id"], [d["id"] for d in assigned["documents"]])
        self.assertFalse(any(e["type"] == "goal_created" and e["goal_id"] == goal["id"] for e in assigned["events"]))
        self.assertEqual(assigned["memories"], [])
        for kind in ("step", "pause", "set_budget"):
            with self.assertRaises(PermissionError):
                self.act(self.alice, kind, goal_id=goal["id"], budget=99)
        task = next(t for t in shared_tasks if t["key"] == "handoff")
        with self.assertRaises(PermissionError):
            self.act(self.bob, "approve", task_id=task["id"], feedback="创建者不能替员工交付。")
        self.act(self.alice, "approve", task_id=task["id"], feedback="本人完成分析，已提交计算口径与核验记录。")
        final = self.act(self.bob, "step", goal_id=goal["id"])
        self.assertEqual(final["goals"][-1]["status"], "completed")
        self.assertEqual(self.engine.snapshot(self.alice)["memories"], [])


if __name__ == "__main__":
    unittest.main()

