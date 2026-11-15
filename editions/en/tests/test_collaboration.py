"""Shared coordination, strict human lifecycle and concurrent runtime guarantees."""

from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest

from harness import Engine
from harness.adapters import DemoAdapter
from harness.engine import VersionConflict


class SlowAdapter(DemoAdapter):
    def __init__(self):
        self.started = threading.Event()
        self.release = threading.Event()

    def generate(self, *args):
        self.started.set()
        if not self.release.wait(5):
            raise RuntimeError("测试等待超时")
        return super().generate(*args)


class CollaborationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "collaboration.sqlite3"
        self.engine = Engine(self.path, adapter=DemoAdapter(), seed=False)
        self.admin = self.person("admin", "admin")
        self.alice = self.person("alice")
        self.bob = self.person("bob")
        for person in (self.alice, self.bob):
            state = self.act(person, "import_document", title="本人证据", content="本人数据分析产物与核验过程。", scope="personal")
            doc = state["documents"][-1]
            state = self.act(person, "claim_capability", capability_id="data_analysis", level=3, description="本人完成分析", evidence_doc_id=doc["id"], evidence_excerpt=doc["content"])
            assessment = state["assessments"][-1]
            self.act(self.admin, "review_assessment", assessment_id=assessment["id"], decision="verify", level=3, review_note="核对本人真实产物与复核过程。")
            self.act(self.admin, "grant_permission", actor_id=person["actor_id"], capability_id="data_analysis", allowed=True)

    def tearDown(self):
        self.engine.close()
        self.temp.cleanup()

    def person(self, name, role="employee"):
        p = {"id": name, "username": name, "display_name": name, "role": role, "actor_id": "person_" + name}
        self.engine.provision_employee(p)
        return p

    def act(self, person, kind, **payload):
        return self.engine.action({"type": kind, **payload}, person)

    def goal(self, person=None, *, steps=None, title="组织共同目标"):
        return self.act(person or self.admin, "create_goal", title=title, brief="PRIVATE_BRIEF", criteria="PRIVATE_CRITERIA", collaborative=True, steps=steps or [{"key": "human", "title": "分析任务", "capability_id": "data_analysis"}])["goals"][-1]

    def task(self, goal, key="human"):
        return next(t for t in self.engine.snapshot(self.admin)["tasks"] if t["goal_id"] == goal["id"] and t["key"] == key)

    def transition(self, person, action, task, **kwargs):
        self.act(person, action, task_id=task["id"], expected_version=task["version"], **kwargs)
        return next(t for t in self.engine.snapshot(self.admin)["tasks"] if t["id"] == task["id"])

    def working(self, goal=None, person=None, key="human"):
        goal = goal or self.goal()
        person = person or self.alice
        task = self.task(goal, key)
        task = self.transition(self.admin, "assign_task", task, actor_id=person["actor_id"])
        task = self.transition(person, "accept_task", task)
        task = self.transition(person, "start_task", task)
        return goal, task

    def test_board_shares_goals_process_and_progress_but_not_private_content(self):
        goal, task = self.working()
        task = self.transition(self.alice, "update_progress", task, progress=57, note="已核对三份来源，正在整理结论")
        task = self.transition(self.alice, "submit_task", task, output="PRIVATE_UNREVIEWED_DRAFT")
        board = self.engine.coordination(self.bob)
        self.assertEqual(board["goals"][0]["title"], goal["title"])
        public_task = board["tasks"][0]
        self.assertEqual(public_task["phase"], "submitted")
        self.assertEqual(public_task["progress"], 99)
        self.assertEqual(public_task["public_note"], "已核对三份来源，正在整理结论")
        self.assertEqual(self.engine.snapshot(self.bob)["goals"], [])
        for secret in ("PRIVATE_BRIEF", "PRIVATE_CRITERIA", "PRIVATE_UNREVIEWED_DRAFT", "本人数据分析产物"):
            self.assertNotIn(secret, json.dumps(board, ensure_ascii=False))
        self.assertFalse(public_task["can_review"])
        self.assertEqual(self.engine.coordination(self.admin)["revision"], board["revision"])

    def test_strict_lifecycle_independent_review_and_rework(self):
        goal = self.goal()
        task = self.task(goal)
        task = self.transition(self.admin, "assign_task", task, actor_id=self.alice["actor_id"])
        with self.assertRaises(PermissionError):
            self.transition(self.alice, "submit_task", task, output="跳过阶段")
        with self.assertRaises(PermissionError):
            self.transition(self.alice, "approve", task, feedback="旧接口绕过")
        task = self.transition(self.alice, "accept_task", task)
        task = self.transition(self.alice, "start_task", task)
        task = self.transition(self.alice, "submit_task", task, output="PRIVATE_FIRST_DRAFT")
        self.assertEqual(task["output"], "")
        with self.assertRaises(PermissionError):
            self.transition(self.alice, "review_task", task, approved=True, feedback="自己通过")
        task = self.transition(self.admin, "review_task", task, approved=False, feedback="PRIVATE_REVIEW_NEEDS_REVISION")
        self.assertEqual(task["work_status"], "in_progress")
        task = self.transition(self.alice, "submit_task", task, output="经修订的真实交付与来源。")
        task = self.transition(self.admin, "review_task", task, approved=True, feedback="核对产物与来源，验收通过。")
        self.assertEqual(task["work_status"], "completed")
        self.assertEqual(task["progress"], 100)
        self.assertEqual(len(task["submission_history"]), 2)
        self.assertEqual(len(task["reviews"]), 2)
        memory = self.engine.snapshot(self.admin)["memories"][0]["content"]
        self.assertIn("All deliverables in this workflow received independent human review.", memory)
        self.assertNotIn("Its result has not been reviewed by a person.", memory)
        with self.assertRaises(ValueError):
            self.transition(self.alice, "submit_task", task, output="重复完成")

    def test_assignment_before_dependencies_is_visible_but_not_acceptable(self):
        goal = self.goal(steps=[{"key": "first", "title": "前置分析", "capability_id": "data_analysis"}, {"key": "next", "title": "后续分析", "capability_id": "data_analysis", "depends_on": ["first"]}])
        task = self.transition(self.admin, "assign_task", self.task(goal, "next"), actor_id=self.alice["actor_id"])
        public = next(t for t in self.engine.coordination(self.alice)["tasks"] if t["id"] == task["id"])
        self.assertEqual(public["work_status"], "assigned")
        self.assertFalse(public["dependencies_ready"])
        self.assertFalse(public["can_accept"])
        with self.assertRaises(PermissionError):
            self.transition(self.alice, "accept_task", task)

    def test_stale_version_and_concurrent_progress_have_single_winner(self):
        _, task = self.working()
        version = task["version"]
        barrier = threading.Barrier(2)
        def update(value):
            barrier.wait(timeout=3)
            try:
                self.act(self.alice, "update_progress", task_id=task["id"], expected_version=version, progress=value, note=f"并发进度 {value}")
                return "ok"
            except VersionConflict:
                return "conflict"
        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(update, (40, 60)))
        self.assertCountEqual(outcomes, ["ok", "conflict"])
        current = next(t for t in self.engine.snapshot(self.admin)["tasks"] if t["id"] == task["id"])
        self.assertEqual(current["version"], version + 1)
        self.assertEqual(len([h for h in current["history"] if h["type"] == "progress_updated"]), 1)

    def test_permissions_and_revocation_are_checked_at_each_stage(self):
        goal, task = self.working()
        with self.assertRaises(PermissionError):
            self.transition(self.bob, "update_progress", task, progress=20, note="冒用他人")
        self.act(self.admin, "grant_permission", actor_id=self.alice["actor_id"], capability_id="data_analysis", allowed=False)
        with self.assertRaises(PermissionError):
            self.transition(self.alice, "submit_task", task, output="授权撤销后不能提交")
        self.assertEqual(self.task(goal)["work_status"], "in_progress")

    def test_parallel_dag_can_advance_while_another_human_waits(self):
        goal = self.goal(steps=[{"key": "human", "title": "人类分析", "capability_id": "data_analysis"}, {"key": "agent", "title": "并行Agent", "capability_id": "analyze"}])
        self.transition(self.admin, "assign_task", self.task(goal), actor_id=self.alice["actor_id"])
        self.act(self.admin, "step", goal_id=goal["id"])
        self.assertEqual(self.task(goal, "agent")["status"], "completed")
        self.assertEqual(self.task(goal)["work_status"], "assigned")

    def test_approval_node_requires_accept_start_and_version(self):
        goal = self.goal(steps=[{"key": "human", "title": "人工验收节点", "capability_id": "approve"}])
        task = self.transition(self.admin, "assign_task", self.task(goal), actor_id=self.admin["actor_id"])
        with self.assertRaises(PermissionError):
            self.transition(self.admin, "approve", task, feedback="未接取开工")
        task = self.transition(self.admin, "accept_task", task)
        task = self.transition(self.admin, "start_task", task)
        with self.assertRaises(ValueError):
            self.act(self.admin, "approve", task_id=task["id"], feedback="缺少版本")
        task = self.transition(self.admin, "approve", task, feedback="已核验前置资料与结果。")
        self.assertEqual(task["work_status"], "completed")

    def test_slow_agent_does_not_block_others_and_preserves_interleaved_mutations(self):
        _, task = self.working()
        slow = SlowAdapter()
        self.engine.adapter = slow
        goal = self.goal(self.bob, steps=[{"key": "agent", "title": "慢Agent", "capability_id": "analyze"}], title="慢Agent目标")
        with ThreadPoolExecutor(max_workers=2) as pool:
            future = pool.submit(self.act, self.bob, "step", goal_id=goal["id"])
            self.assertTrue(slow.started.wait(2))
            started = time.monotonic()
            board = self.engine.coordination(self.alice)
            self.assertEqual(next(t for t in board["tasks"] if t["goal_id"] == goal["id"])["status"], "running")
            updated = self.transition(self.alice, "update_progress", task, progress=72, note="慢Agent运行时独立更新")
            with self.assertRaises(ValueError):
                self.act(self.admin, "create_goal", title="", criteria="非法操作不应覆盖并发状态")
            self.assertLess(time.monotonic() - started, 1.0)
            slow.release.set()
            future.result(timeout=3)
        final = next(t for t in self.engine.snapshot(self.admin)["tasks"] if t["id"] == task["id"])
        self.assertEqual(final["progress"], 72)
        self.assertEqual(final["version"], updated["version"])
        agent_events = [e for e in self.engine.snapshot(self.admin)["events"] if e.get("goal_id") == goal["id"]]
        self.assertTrue(all(e["user_id"] == "bob" for e in agent_events))
        self.assertEqual(final["history"][-1]["user_id"], "alice")

    def test_pause_during_agent_call_is_preserved_after_result(self):
        slow = SlowAdapter()
        self.engine.adapter = slow
        goal = self.goal(steps=[{"key": "agent", "title": "慢Agent", "capability_id": "analyze"}])
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(self.act, self.admin, "step", goal_id=goal["id"])
            self.assertTrue(slow.started.wait(2))
            self.act(self.admin, "pause", goal_id=goal["id"])
            slow.release.set()
            result = future.result(timeout=3)
        self.assertEqual(result["goals"][-1]["status"], "paused")
        self.assertEqual(self.task(goal, "agent")["status"], "completed")
        result = self.act(self.admin, "resume", goal_id=goal["id"])
        self.assertEqual(result["goals"][-1]["status"], "completed")

    def test_superseded_run_token_does_not_overwrite_new_state(self):
        slow = SlowAdapter()
        self.engine.adapter = slow
        goal = self.goal(steps=[{"key": "agent", "title": "慢Agent", "capability_id": "analyze"}])
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(self.act, self.admin, "step", goal_id=goal["id"])
            self.assertTrue(slow.started.wait(2))
            with self.engine.lock:
                task = next(t for t in self.engine.state["tasks"] if t["goal_id"] == goal["id"])
                task["run_token"] = "new-attempt-token"
                task["output"] = "NEWER_STATE_MUST_SURVIVE"
                self.engine._save()
            slow.release.set()
            future.result(timeout=3)
        self.assertEqual(self.task(goal, "agent")["output"], "NEWER_STATE_MUST_SURVIVE")

    def test_rejected_drafts_not_shared_as_dependency_context(self):
        goal = self.goal(steps=[{"key": "first", "title": "前置", "capability_id": "data_analysis"}, {"key": "next", "title": "后继", "capability_id": "data_analysis", "depends_on": ["first"]}])
        _, task = self.working(goal, self.alice, "first")
        task = self.transition(self.alice, "submit_task", task, output="REJECTED_SECRET_DRAFT")
        task = self.transition(self.admin, "review_task", task, approved=False, feedback="PRIVATE_REJECT_REASON")
        task = self.transition(self.alice, "submit_task", task, output="可以交接的已验收产物")
        self.transition(self.admin, "review_task", task, approved=True, feedback="PRIVATE_PASS_REASON")
        self.transition(self.admin, "assign_task", self.task(goal, "next"), actor_id=self.bob["actor_id"])
        bob = self.engine.snapshot(self.bob)
        for secret in ("REJECTED_SECRET_DRAFT", "PRIVATE_REJECT_REASON", "PRIVATE_PASS_REASON"):
            self.assertNotIn(secret, json.dumps(bob, ensure_ascii=False))
        self.assertIn("可以交接的已验收产物", json.dumps(bob, ensure_ascii=False))

    def test_restart_preserves_normal_work_version_and_public_history(self):
        goal, task = self.working()
        task = self.transition(self.alice, "update_progress", task, progress=61, note="可恢复的进度")
        before = self.engine.coordination(self.bob)
        self.engine.close()
        self.engine = Engine(self.path, adapter=DemoAdapter())
        after = self.engine.coordination(self.bob)
        self.assertEqual(before, after)
        self.assertEqual(self.task(goal)["version"], task["version"])


if __name__ == "__main__":
    unittest.main()
