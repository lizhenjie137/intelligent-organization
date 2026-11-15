"""Designation is independent from permission to execute; temporary stores only."""
from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest

from harness.adapters import DemoAdapter
from harness.engine import Engine, VersionConflict
from harness.runtime import UnavailableDeepSeekAdapter


class RecordingAdapter(DemoAdapter):
    def __init__(self):
        self.calls = []

    def generate(self, goal, task, capability, context):
        self.calls.append(task["actor_id"])
        return super().generate(goal, task, capability, context)


class AssignmentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "assignment.sqlite"
        self.adapter = RecordingAdapter()
        self.engine = Engine(self.path, adapter=self.adapter, seed=False)
        self.addCleanup(lambda: self.engine.close())
        self.admin = self.person("admin", "admin")
        self.owner = self.person("owner")
        self.alice = self.person("alice")
        self.bob = self.person("bob")

    def person(self, name, role="employee"):
        principal = {"id": "test_" + name, "username": name, "display_name": name,
                     "role": role, "actor_id": "person_test_" + name}
        self.engine.provision_employee(principal)
        return principal

    def act(self, principal, kind, **fields):
        return self.engine.action({"type": kind, **fields}, principal)

    def create_goal(self, *, steps=None, collaborative=True, budget=8):
        state = self.act(self.owner, "create_goal", title="Assignment fixture", brief="PRIVATE_GOAL_INPUT",
                         criteria="PRIVATE_ACCEPTANCE_CRITERIA", collaborative=collaborative, budget=budget,
                         steps=steps or [{"key": "work", "title": "Analyze requirements", "capability_id": "analyze"}])
        return state["goals"][-1]

    def task(self, goal, key="work"):
        return deepcopy(next(task for task in self.engine.state["tasks"] if task["goal_id"] == goal["id"] and task["key"] == key))

    def transition(self, principal, kind, task, **fields):
        self.act(principal, kind, task_id=task["id"], expected_version=task["version"], **fields)
        return deepcopy(next(item for item in self.engine.state["tasks"] if item["id"] == task["id"]))

    def public(self, task, principal=None):
        return next(item for item in self.engine.coordination(principal or self.owner)["tasks"] if item["id"] == task["id"])

    @staticmethod
    def codes(value):
        return {reason["code"] for reason in value["blocking_reasons"]}

    def qualify(self, person, cap_id="analyze", *, grant=True):
        state = self.act(person, "import_document", title="Private evidence", content="PRIVATE_WORK_EVIDENCE", scope="personal")
        doc = state["documents"][-1]
        state = self.act(person, "claim_capability", capability_id=cap_id, level=2, description="PRIVATE_DESCRIPTION",
                         evidence_doc_id=doc["id"], evidence_excerpt=doc["content"])
        claim = state["assessments"][-1]
        self.act(self.admin, "review_assessment", assessment_id=claim["id"], decision="verify", level=2,
                 review_note="PRIVATE_REVIEW_NOTE")
        if grant:
            self.act(self.admin, "grant_permission", actor_id=person["actor_id"], capability_id=cap_id, allowed=True)

    def test_candidates_include_every_real_member_and_agent_without_private_evidence(self):
        goal = self.create_goal()
        task = self.task(goal)
        self.qualify(self.alice)
        self.act(self.admin, "set_actor_available", actor_id=self.bob["actor_id"], available=False)
        before = deepcopy(self.engine.state)
        public = self.public(task)
        by_id = {item["actor_id"]: item for item in public["assignment_candidates"]}
        expected = {actor["id"] for actor in self.engine.state["actors"] if actor["type"] == "agent" or actor.get("user_id")}
        self.assertEqual(set(by_id), expected)
        self.assertNotIn("owner", by_id)  # Legacy, unbound placeholder.
        self.assertTrue(all(item["can_assign"] for item in by_id.values()))
        self.assertTrue(by_id[self.alice["actor_id"]]["ready_to_execute"])
        self.assertFalse(by_id[self.bob["actor_id"]]["ready_to_execute"])
        self.assertTrue({"provider_unavailable", "capability_missing", "verification_missing", "permission_missing"} <= self.codes(by_id[self.bob["actor_id"]]))
        self.assertFalse(public["assignment_ready_to_execute"])
        self.assertEqual(public["assignment_blocking_reasons"][0]["code"], "unassigned")
        watcher = self.public(task, self.bob)
        self.assertFalse(any(item["can_assign"] for item in watcher["assignment_candidates"]))
        serialized = json.dumps(watcher)
        for private in ("PRIVATE_WORK_EVIDENCE", "PRIVATE_DESCRIPTION", "PRIVATE_REVIEW_NOTE", "PRIVATE_GOAL_INPUT", "PRIVATE_ACCEPTANCE_CRITERIA"):
            self.assertNotIn(private, serialized)
        self.assertEqual(self.engine.state, before)

    def test_unqualified_member_is_designated_then_verified_and_authorized_without_reassignment(self):
        goal = self.create_goal()
        task = self.transition(self.owner, "assign_task", self.task(goal), actor_id=self.alice["actor_id"])
        self.assertEqual(task["work_status"], "assigned")
        self.assertEqual(task["status"], "waiting_approval")
        self.assertTrue(task["assignment_manual"])
        person = next(actor for actor in self.engine.state["actors"] if actor["id"] == self.alice["actor_id"])
        self.assertEqual(person["capability_ids"], [])
        self.assertEqual(person["permissions"], [])
        self.assertEqual(self.engine.state["assessments"], [])
        with self.assertRaises(PermissionError):
            self.transition(self.alice, "accept_task", task)
        self.qualify(self.alice, grant=False)
        self.assertFalse(self.public(task, self.alice)["can_accept"])
        self.assertEqual(self.codes({"blocking_reasons": self.public(task)["assignment_blocking_reasons"]}), {"permission_missing"})
        self.act(self.admin, "grant_permission", actor_id=self.alice["actor_id"], capability_id="analyze", allowed=True)
        self.assertTrue(self.public(task, self.alice)["can_accept"])
        self.assertEqual(self.task(goal)["version"], task["version"])
        task = self.transition(self.alice, "accept_task", task)
        task = self.transition(self.alice, "start_task", task)
        task = self.transition(self.alice, "submit_task", task, output="A member deliverable with evidence and limitations.")
        task = self.transition(self.owner, "review_task", task, approved=True, feedback="Independently checked against the criteria.")
        self.assertEqual(task["status"], "completed")

    def test_unavailable_member_can_be_designated_but_revocation_still_blocks_all_execution(self):
        self.qualify(self.alice)
        self.act(self.admin, "set_actor_available", actor_id=self.alice["actor_id"], available=False)
        goal = self.create_goal()
        task = self.transition(self.admin, "assign_task", self.task(goal), actor_id=self.alice["actor_id"])
        with self.assertRaises(PermissionError):
            self.transition(self.alice, "accept_task", task)
        self.act(self.admin, "set_actor_available", actor_id=self.alice["actor_id"], available=True)
        task = self.transition(self.alice, "accept_task", task)
        self.act(self.admin, "grant_permission", actor_id=self.alice["actor_id"], capability_id="analyze", allowed=False)
        self.assertFalse(self.public(task, self.alice)["can_start"])
        with self.assertRaises(PermissionError):
            self.transition(self.alice, "start_task", task)
        self.act(self.admin, "grant_permission", actor_id=self.alice["actor_id"], capability_id="analyze", allowed=True)
        task = self.transition(self.alice, "start_task", task)
        self.act(self.admin, "grant_permission", actor_id=self.alice["actor_id"], capability_id="analyze", allowed=False)
        public = self.public(task, self.alice)
        self.assertFalse(public["can_update"] or public["can_submit"] or public["can_publish"])
        with self.assertRaises(PermissionError):
            self.transition(self.alice, "update_progress", task, progress=50, note="Not allowed after revocation")
        with self.assertRaises(PermissionError):
            self.transition(self.alice, "submit_task", task, output="Not allowed after revocation")
        with self.assertRaises(PermissionError):
            self.engine.workboard.check_upload(task["id"], task["version"], self.alice)
        self.assertEqual(self.task(goal)["actor_id"], self.alice["actor_id"])

    def test_agent_waits_for_its_own_capability_and_permission_without_fallback(self):
        spec = json.dumps({"name": "Assignment analysis fixture", "description": "Text analysis for a routing test",
                           "version": "1.0", "provider_type": "agent", "inputs": "Requirements",
                           "outputs": "Reviewable analysis", "acceptance": "Traceable reasoning", "instructions": "Explain assumptions."})
        state = self.act(self.admin, "import_skill", content=spec, source_name="assignment.json", provider_actor_id="analyst")
        cap = state["skill_packages"][-1]["capability_id"]
        self.act(self.admin, "grant_permission", actor_id="analyst", capability_id=cap, allowed=True)
        goal = self.create_goal(steps=[{"key": "work", "title": "Use a declared Skill", "capability_id": cap}])
        task = self.transition(self.owner, "assign_task", self.task(goal), actor_id="planner")
        self.act(self.owner, "step", goal_id=goal["id"])
        self.assertEqual(self.task(goal)["status"], "blocked")
        self.assertEqual(self.task(goal)["actor_id"], "planner")
        self.assertTrue(self.task(goal)["assignment_manual"])
        self.assertEqual(self.adapter.calls, [])
        self.act(self.admin, "import_skill", content=spec, source_name="assignment.json", provider_actor_id="planner")
        self.act(self.owner, "step", goal_id=goal["id"])
        self.assertEqual(self.task(goal)["status"], "blocked")
        self.assertEqual(self.adapter.calls, [])
        self.act(self.admin, "grant_permission", actor_id="planner", capability_id=cap, allowed=True)
        self.act(self.owner, "step", goal_id=goal["id"])
        self.assertEqual(self.task(goal)["status"], "completed")
        self.assertEqual(self.adapter.calls, ["planner"])

    def test_high_risk_review_and_provider_type_still_block_designated_agents_or_members(self):
        for capability, risk in (("analyze", "high"), ("approve", "low")):
            with self.subTest(capability=capability):
                goal = self.create_goal(steps=[{"key": "work", "title": "Human-only execution", "capability_id": capability, "risk": risk}])
                task = self.transition(self.owner, "assign_task", self.task(goal), actor_id="analyst")
                self.assertIn("human_required", self.codes({"blocking_reasons": self.public(task)["assignment_blocking_reasons"]}))
                self.act(self.owner, "step", goal_id=goal["id"])
                self.assertEqual(self.task(goal)["status"], "blocked")
                self.assertEqual(self.task(goal)["actor_id"], "analyst")
                self.assertEqual(self.task(goal)["output"], "")
        self.assertEqual(self.adapter.calls, [])
        with self.assertRaises(ValueError):
            self.act(self.admin, "grant_permission", actor_id="analyst", capability_id="approve", allowed=True)
        spec = json.dumps({"name": "Agent-only fixture", "description": "Type boundary", "provider_type": "agent",
                           "inputs": "Text", "outputs": "Text", "acceptance": "Reviewable result"})
        state = self.act(self.admin, "import_skill", content=spec, source_name="type.json", provider_actor_id="analyst")
        cap = state["skill_packages"][-1]["capability_id"]
        goal = self.create_goal(steps=[{"key": "work", "title": "Agent-only capability", "capability_id": cap}])
        task = self.transition(self.owner, "assign_task", self.task(goal), actor_id=self.alice["actor_id"])
        self.assertIn("provider_type_mismatch", self.codes({"blocking_reasons": self.public(task)["assignment_blocking_reasons"]}))
        with self.assertRaises(PermissionError):
            self.transition(self.alice, "accept_task", task)

    def test_readiness_includes_dependencies_pause_budget_and_safe_model_diagnostics(self):
        goal = self.create_goal(budget=1, steps=[{"key": "first", "title": "First", "capability_id": "analyze"},
                                                {"key": "work", "title": "Next", "capability_id": "analyze", "depends_on": ["first"]}])
        task = self.transition(self.owner, "assign_task", self.task(goal), actor_id="analyst")
        self.assertIn("dependencies_incomplete", self.codes({"blocking_reasons": self.public(task)["assignment_blocking_reasons"]}))
        self.act(self.owner, "pause", goal_id=goal["id"])
        self.assertIn("goal_paused", self.codes({"blocking_reasons": self.public(task)["assignment_blocking_reasons"]}))
        self.assertFalse(self.public(task)["can_assign"])
        self.act(self.owner, "resume", goal_id=goal["id"])
        self.act(self.owner, "step", goal_id=goal["id"])
        self.assertIn("budget_exhausted", self.codes({"blocking_reasons": self.public(task)["assignment_blocking_reasons"]}))
        self.engine.adapter = UnavailableDeepSeekAdapter("CONFIG_MISSING", "PRIVATE_RUNTIME_DIAGNOSTIC")
        current = self.public(task)
        reasons = current["assignment_blocking_reasons"]
        self.assertIn("model_unavailable", self.codes({"blocking_reasons": reasons}))
        self.assertIn("execution_mode_mismatch", self.codes({"blocking_reasons": reasons}))
        self.assertNotIn("PRIVATE_RUNTIME_DIAGNOSTIC", json.dumps(reasons))

    def test_manual_selection_survives_restart_and_unavailable_agent_recovers(self):
        goal = self.create_goal()
        self.act(self.admin, "set_actor_available", actor_id="analyst", available=False)
        task = self.transition(self.owner, "assign_task", self.task(goal), actor_id="analyst")
        self.act(self.owner, "step", goal_id=goal["id"])
        self.assertEqual(self.task(goal)["status"], "blocked")
        self.engine.close()
        self.engine = Engine(self.path, adapter=self.adapter, seed=False)
        self.assertEqual(self.task(goal)["actor_id"], "analyst")
        self.assertTrue(self.task(goal)["assignment_manual"])
        self.act(self.admin, "set_actor_available", actor_id="analyst", available=True)
        self.assertTrue(self.public(task)["assignment_ready_to_execute"])
        self.act(self.owner, "step", goal_id=goal["id"])
        self.assertEqual(self.task(goal)["status"], "completed")
        self.assertEqual(self.adapter.calls, ["analyst"])

    def test_reassignment_updates_public_board_and_removes_former_assignee_private_access(self):
        goal = self.create_goal()
        task = self.transition(self.owner, "assign_task", self.task(goal), actor_id=self.alice["actor_id"])
        self.assertTrue(self.engine.snapshot(self.alice)["tasks"])
        old_version = task["version"]
        task = self.transition(self.owner, "assign_task", task, actor_id=self.bob["actor_id"])
        for principal in (self.owner, self.alice, self.bob, self.admin):
            self.assertEqual(self.public(task, principal)["actor_id"], self.bob["actor_id"])
        former = self.engine.snapshot(self.alice)
        self.assertEqual(former["goals"], [])
        self.assertEqual(former["tasks"], [])
        self.assertEqual(former["events"], [])
        self.assertEqual(self.engine.snapshot(self.bob)["tasks"][0]["id"], task["id"])
        with self.assertRaises(PermissionError):
            self.transition(self.alice, "accept_task", task)
        with self.assertRaises(VersionConflict):
            self.act(self.owner, "assign_task", task_id=task["id"], expected_version=old_version, actor_id=self.alice["actor_id"])
        self.assertEqual(self.task(goal)["actor_id"], self.bob["actor_id"])

    def test_manager_phase_and_legacy_guards_remain_intact(self):
        goal = self.create_goal()
        task = self.task(goal)
        with self.assertRaises(PermissionError):
            self.transition(self.alice, "assign_task", task, actor_id=self.alice["actor_id"])
        with self.assertRaises(PermissionError):
            self.transition(self.owner, "assign_task", task, actor_id="owner")
        self.qualify(self.alice)
        task = self.transition(self.owner, "assign_task", task, actor_id=self.alice["actor_id"])
        task = self.transition(self.alice, "accept_task", task)
        task = self.transition(self.alice, "start_task", task)
        with self.assertRaises(PermissionError):
            self.transition(self.owner, "assign_task", task, actor_id=self.bob["actor_id"])
        task = self.transition(self.alice, "submit_task", task, output="Deliverable pending review")
        self.assertFalse(self.public(task)["can_assign"])
        task = self.transition(self.owner, "review_task", task, approved=True, feedback="Reviewed")
        with self.assertRaises(ValueError):
            self.transition(self.owner, "assign_task", task, actor_id=self.bob["actor_id"])
        legacy = self.create_goal(collaborative=False)
        old_task = self.task(legacy)
        public = self.public(old_task)
        self.assertFalse(public["can_assign"])
        self.assertTrue(public["assignment_disabled_reason"])
        self.assertFalse(any(candidate["can_assign"] for candidate in public["assignment_candidates"]))
        with self.assertRaises(ValueError):
            self.transition(self.owner, "assign_task", old_task, actor_id=self.alice["actor_id"])
        self.assertFalse(next(g for g in self.engine.state["goals"] if g["id"] == legacy["id"])["collaborative"])


if __name__ == "__main__":
    unittest.main()
