"""Behavior tests for the runtime's dependency and governance boundaries."""

from copy import deepcopy
import tempfile
from pathlib import Path
import unittest

from harness import Engine
from harness.adapters import DemoAdapter


class FailingAdapter(DemoAdapter):
    def generate(self, *args):
        raise RuntimeError("模拟服务故障")


class EngineTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "runtime.sqlite3"
        self.engine = Engine(self.path, adapter=DemoAdapter())
        self.goal_id = self.engine.snapshot()["goals"][0]["id"]

    def tearDown(self):
        self.engine.close()
        self.temp.cleanup()

    def action(self, kind, **kwargs):
        return self.engine.action({"type": kind, **kwargs})

    def step(self):
        return self.action("step", goal_id=self.goal_id)

    def tasks(self):
        return [t for t in self.engine.snapshot()["tasks"] if t["goal_id"] == self.goal_id]

    def goal(self):
        return next(g for g in self.engine.snapshot()["goals"] if g["id"] == self.goal_id)

    def to_approval(self):
        for _ in range(4):
            self.step()
        return self.tasks()[3]

    def custom(self, steps, **kwargs):
        state = self.action("create_goal", title="自定义目标", brief="资料", criteria="提交可核验结果", steps=steps, **kwargs)
        self.goal_id = state["goals"][-1]["id"]
        return state

    def test_seed_has_no_fabricated_execution(self):
        self.assertEqual(len(self.tasks()), 5)
        self.assertTrue(all(t["status"] == "queued" and not t["output"] for t in self.tasks()))
        self.assertEqual(self.goal()["used"], 0)
        self.assertEqual(self.engine.snapshot()["memories"], [])

    def test_dependency_and_human_approval_closed_loop(self):
        approval = self.tasks()[3]
        with self.assertRaises(ValueError):
            self.action("approve", task_id=approval["id"], feedback="提前通过")
        self.step()
        self.assertEqual([t["status"] for t in self.tasks()], ["completed", "queued", "queued", "queued", "queued"])
        self.step()
        self.step()
        self.step()
        self.assertEqual(self.goal()["status"], "waiting_approval")
        self.assertEqual(self.goal()["used"], 3)
        with self.assertRaises(ValueError):
            self.step()
        with self.assertRaises(ValueError):
            self.action("approve", task_id=approval["id"], feedback=" ")
        self.action("approve", task_id=approval["id"], feedback="通过机制演示检查。")
        self.assertEqual(self.goal()["status"], "queued")
        self.step()
        self.assertEqual(self.goal()["status"], "completed")
        self.assertEqual(self.goal()["used"], 4)
        self.assertEqual(self.engine.snapshot()["memories"][0]["mode"], "demo")
        with self.assertRaises(ValueError):
            self.step()
        self.assertEqual(len(self.engine.snapshot()["memories"]), 1)

    def test_rejection_invalidates_downstream_but_keeps_history_and_budget(self):
        task = self.to_approval()
        original_artifacts = deepcopy(self.tasks()[1]["artifacts"])
        self.action("reject", task_id=task["id"], feedback="需要补充负责人和时间。")
        self.assertEqual([t["status"] for t in self.tasks()], ["completed", "queued", "queued", "queued", "queued"])
        self.assertEqual(self.tasks()[1]["artifacts"], original_artifacts)
        self.assertEqual(self.tasks()[1]["output"], "")
        self.assertEqual(self.goal()["used"], 3)
        self.step()
        self.assertIn("需要补充负责人和时间", self.tasks()[1]["output"])
        self.assertEqual(len(self.tasks()[1]["artifacts"]), 2)
        self.step()
        self.step()
        self.action("approve", task_id=task["id"], feedback="返工意见已确认。")
        self.step()
        self.assertEqual(self.goal()["used"], 6)
        self.assertEqual(self.goal()["status"], "completed")

    def test_budget_block_and_resume(self):
        self.action("set_budget", goal_id=self.goal_id, budget=1)
        self.step()
        self.step()
        self.assertEqual(self.goal()["status"], "blocked")
        self.assertEqual(self.goal()["used"], 1)
        self.action("set_budget", goal_id=self.goal_id, budget=10)
        self.step()
        self.assertEqual(self.tasks()[1]["status"], "completed")
        with self.assertRaises(ValueError):
            self.action("set_budget", goal_id=self.goal_id, budget=1)
        with self.assertRaises(ValueError):
            self.action("set_budget", goal_id=self.goal_id, budget=True)

    def test_permission_is_independent_from_capability_and_priority(self):
        self.action("set_actor_available", actor_id="analyst", available=False)
        self.action("add_actor", name="没有授权的分析师", role="仅登记技能", actor_type="agent", capability_ids=["analyze"], permissions=[])
        self.step()
        self.assertEqual(self.goal()["status"], "blocked")
        self.assertEqual(self.goal()["used"], 0)
        self.action("add_actor", name="授权分析师", role="可执行分析", actor_type="agent", capability_ids=["analyze"], permissions=["analyze"])
        self.step()
        self.assertEqual(self.tasks()[0]["status"], "completed")

    def test_agent_cannot_receive_approval_permission(self):
        with self.assertRaises(ValueError):
            self.action("add_actor", name="越权", role="审批", actor_type="agent", capability_ids=["approve"], permissions=["approve"])

    def test_human_fallback_and_availability_recheck(self):
        self.action("set_actor_available", actor_id="analyst", available=False)
        state = self.action("add_actor", name="人工分析", role="补充真实分析产物", actor_type="human", capability_ids=["analyze"], permissions=["analyze"])
        actor = state["actors"][-1]
        self.step()
        task = self.tasks()[0]
        self.assertEqual(task["status"], "waiting_approval")
        self.action("set_actor_available", actor_id=actor["id"], available=False)
        with self.assertRaises(ValueError):
            self.action("approve", task_id=task["id"], feedback="实际分析内容")
        self.action("set_actor_available", actor_id=actor["id"], available=True)
        self.action("approve", task_id=task["id"], feedback="实际分析内容与证据。")
        self.assertEqual(self.tasks()[0]["output_mode"], "human")
        self.assertEqual(self.goal()["used"], 0)

    def test_pause_blocks_execution_and_approval_and_preserves_state(self):
        task = self.to_approval()
        self.action("pause", goal_id=self.goal_id)
        with self.assertRaises(ValueError):
            self.step()
        with self.assertRaises(ValueError):
            self.action("approve", task_id=task["id"], feedback="通过")
        self.action("resume", goal_id=self.goal_id)
        self.assertEqual(self.goal()["status"], "waiting_approval")

    def test_failure_consumes_budget_and_retry_requires_explicit_action(self):
        self.engine.adapter = FailingAdapter()
        self.step()
        self.assertEqual(self.tasks()[0]["status"], "failed")
        self.assertEqual(self.goal()["used"], 1)
        with self.assertRaises(ValueError):
            self.step()
        self.engine.adapter = DemoAdapter()
        self.action("retry", task_id=self.tasks()[0]["id"])
        self.step()
        self.assertEqual(self.tasks()[0]["attempts"], 2)
        self.assertEqual(self.goal()["used"], 2)
        self.assertEqual(self.tasks()[0]["status"], "completed")

    def test_persistence_and_snapshot_is_detached(self):
        self.step()
        copy = self.engine.snapshot()
        copy["goals"][0]["used"] = 999
        self.assertEqual(self.goal()["used"], 1)
        self.engine.close()
        self.engine = Engine(self.path, adapter=DemoAdapter())
        self.assertEqual(self.tasks()[0]["status"], "completed")
        self.assertEqual(self.goal()["used"], 1)

    def test_interrupted_run_is_failed_without_replay(self):
        task = self.engine.state["tasks"][0]
        task["status"] = "running"
        task["attempts"] = 1
        self.engine.state["goals"][0]["used"] = 1
        self.engine._save()
        self.engine.close()
        self.engine = Engine(self.path, adapter=DemoAdapter())
        self.assertEqual(self.tasks()[0]["status"], "failed")
        self.assertIn("上次进程", self.tasks()[0]["error"])
        self.assertEqual(self.goal()["used"], 1)

    def test_invalid_operation_rolls_back(self):
        before = self.engine.snapshot()
        with self.assertRaises(ValueError):
            self.engine.action({"type": []})
        with self.assertRaises(ValueError):
            self.action("create_goal", title="", criteria="有效标准")
        self.assertEqual(self.engine.snapshot(), before)
        with self.assertRaises(KeyError):
            self.action("add_actor", name="错误", role="错误", actor_type="agent", capability_ids=["missing"], permissions=[])
        self.assertEqual(self.engine.snapshot(), before)

    def test_custom_dag_executes_dependencies_in_topological_order(self):
        self.custom([
            {"key": "c", "title": "汇总", "capability_id": "reflect", "depends_on": ["a", "b"]},
            {"key": "a", "title": "分析 A", "capability_id": "analyze", "depends_on": []},
            {"key": "b", "title": "分析 B", "capability_id": "analyze", "depends_on": []},
        ])
        self.assertEqual([t["key"] for t in self.tasks()], ["a", "b", "c"])
        self.step()
        self.step()
        self.step()
        self.assertEqual(self.goal()["status"], "completed")
        self.assertIn("未经人工验收", self.engine.snapshot()["memories"][0]["content"])

    def test_custom_validation_cycles_unknown_dependencies_and_duplicate_keys(self):
        base = {"key": "a", "title": "分析", "capability_id": "analyze"}
        bad_steps = [[base, base], [{**base, "depends_on": ["a"]}], [{**base, "depends_on": ["missing"]}], [{**base, "capability_id": "unknown"}], []]
        count = len(self.engine.snapshot()["goals"])
        for steps in bad_steps:
            with self.assertRaises((ValueError, KeyError)):
                self.custom(steps)
        self.assertEqual(len(self.engine.snapshot()["goals"]), count)

    def test_custom_high_risk_blocks_agent_and_routes_to_authorized_human(self):
        self.custom([{"key": "high", "title": "高风险分析", "capability_id": "analyze", "risk": "high"}])
        self.step()
        self.assertEqual(self.goal()["status"], "blocked")
        self.assertEqual(self.goal()["used"], 0)
        self.action("add_actor", name="高级分析负责人", role="人工处理高风险分析", actor_type="human", capability_ids=["analyze"], permissions=["analyze"])
        self.step()
        self.assertEqual(self.goal()["status"], "waiting_approval")
        self.action("approve", task_id=self.tasks()[0]["id"], feedback="人工分析结果与验证记录。")
        self.assertEqual(self.goal()["status"], "completed")

    def test_custom_rejection_only_invalidates_descendants(self):
        self.custom([
            {"key": "a", "title": "前置分析", "capability_id": "analyze"},
            {"key": "p", "title": "验收", "capability_id": "approve", "depends_on": ["a"]},
            {"key": "r", "title": "复盘", "capability_id": "reflect", "depends_on": ["p"]},
        ])
        self.step()
        self.step()
        self.action("reject", task_id=self.tasks()[1]["id"], feedback="需要更详细的人工意见。")
        self.assertEqual([t["status"] for t in self.tasks()], ["completed", "queued", "queued"])

    def test_registered_capability_is_reusable_in_custom_steps(self):
        state = self.action("add_capability", name="证据整理", description="整理资料", input_schema="来源", output_schema="清单", acceptance="标明来源")
        cap_id = state["capabilities"][-1]["id"]
        self.action("add_actor", name="资料员", role="整理证据", actor_type="agent", capability_ids=[cap_id], permissions=[cap_id])
        self.custom([{"key": "collect", "title": "收集", "capability_id": cap_id}])
        self.step()
        self.assertEqual(self.goal()["status"], "completed")
        self.assertIn("规则演示", self.tasks()[0]["output"])

    def test_execution_modes_cannot_be_mixed(self):
        self.step()
        adapter = DemoAdapter()
        adapter.mode = "model"
        self.engine.adapter = adapter
        with self.assertRaises(ValueError):
            self.step()
        self.assertEqual(self.goal()["used"], 1)

    def test_unstarted_goal_can_use_new_mode(self):
        adapter = DemoAdapter()
        adapter.mode = "model"
        self.engine.adapter = adapter
        self.step()
        self.assertEqual(self.goal()["mode"], "model")


if __name__ == "__main__":
    unittest.main()
