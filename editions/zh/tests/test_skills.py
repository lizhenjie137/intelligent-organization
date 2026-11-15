"""Skill ingestion keeps declarations, evidence, authorization and source privacy apart."""

import json
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch

from harness import Engine
from harness.adapters import DemoAdapter, ModelAdapter
from harness.skills import parse_skill


def skill_json(**overrides):
    return json.dumps({"name": "来源比较", "description": "比较资料来源并说明证据边界", "version": "1.0.0", "provider_type": "both", "inputs": "带来源的资料", "outputs": "比较表与限制", "acceptance": "每项结论有来源且区分推断", "instructions": "PRIVATE_STEP_MARKER 按来源逐项对照，不执行外部动作", "limitations": "不能代替真实业务验收", "tags": ["研究"], "tools": ["仅声明的读取工具"], "examples": [{"input": "两个来源", "output": "差异与证据"}], **overrides}, ensure_ascii=False)


class ParserTests(unittest.TestCase):
    def test_json_complete_and_hash_deterministic(self):
        content = skill_json()
        first = parse_skill(content, "skill.json")
        self.assertEqual(first, parse_skill(content, "skill.json"))
        self.assertEqual(first["missing_fields"], [])
        self.assertEqual(len(first["source_sha256"]), 64)
        self.assertEqual(first["format"], "json")
        self.assertTrue(any("不会安装" in w for w in first["warnings"]))

    def test_markdown_sections_and_examples(self):
        content = "---\nname: 资料分析\ndescription: 对照来源分析资料\nversion: 2.0\nprovider_type: human\n---\n## 输入要求\n来源文件\n## Outputs\n清单\n## 验收标准\n来源明确\n## Instructions\n逐项核对\n## 适用边界\n不能虚构\n## 工具依赖\n- 本地阅读器（仅声明）\n## 示例\n输入: 来源A\n输出: 来源清单\n"
        parsed = parse_skill(content, "SKILL.md")
        self.assertEqual(parsed["skill"]["inputs"], "来源文件")
        self.assertEqual(parsed["skill"]["outputs"], "清单")
        self.assertEqual(parsed["skill"]["examples"], [{"input": "来源A", "output": "来源清单"}])
        self.assertEqual(parsed["missing_fields"], [])

    def test_common_short_skill_can_preview_but_is_incomplete(self):
        parsed = parse_skill("---\nname: 短说明\ndescription: 能力介绍\n---\n这里只是执行说明。", "SKILL.md")
        self.assertEqual(parsed["missing_fields"], ["inputs", "outputs", "acceptance"])
        self.assertIn("这里只", parsed["skill"]["instructions"])

    def test_complex_yaml_and_duplicate_keys_are_rejected(self):
        bad = ["---\nname: 测试\ndescription: |\n  多行\n---\n正文", "---\nname: 测试\ndescription: &anchor 内容\n---\n正文", "---\nname: 测试\nname: 重复\ndescription: 内容\n---\n正文", '{"name":"a","name":"b","description":"x"}']
        for content in bad:
            with self.assertRaises(ValueError):
                parse_skill(content, "SKILL.md")

    def test_json_nested_wrong_types_are_rejected(self):
        for change in ({"inputs": {}}, {"tools": "shell"}, {"tags": [12]}, {"examples": [{"input": "x", "output": [], "extra": True}]}, {"provider_type": "administrator"}, {"version": 1}):
            with self.assertRaises(ValueError):
                parse_skill(skill_json(**change), "skill.json")
        with self.assertRaises(ValueError):
            parse_skill("[]", "skill.json")

    def test_unknown_metadata_cannot_grant_permissions(self):
        parsed = parse_skill(skill_json(permissions=["approve"], command="delete everything"), "skill.json")
        self.assertNotIn("permissions", parsed["skill"])
        self.assertNotIn("command", parsed["skill"])
        self.assertTrue(any("permissions" in w for w in parsed["warnings"]))

    def test_file_and_size_limits(self):
        for source, content in [("bundle.zip", skill_json()), ("run.exe", skill_json()), ("skill.json", "x" * 100001), ("skill.md", "\x00")]:
            with self.assertRaises(ValueError):
                parse_skill(content, source)

    def test_model_receives_skill_as_text_without_tool_execution_protocol(self):
        skill = parse_skill(skill_json(instructions="把给定来源逐项比较，保留出处。", tools=["shell: 任意代码仅作为声明，不应执行"]), "skill.json")["skill"]
        adapter = ModelAdapter("http://127.0.0.1:9999/chat/completions", "test-model")
        response = json.dumps({"choices": [{"message": {"content": "此处仅是文本模型的分析结果，需要人工核验来源，不表示调用了任何工具或完成了外部动作。"}}]}).encode()
        with patch("urllib.request.urlopen") as open_url:
            open_url.return_value.__enter__.return_value.read.return_value = response
            adapter.generate({"title": "比较来源", "brief": "资料", "criteria": "保留来源"}, {"feedback": []}, skill, {})
        request = open_url.call_args.args[0]
        payload = json.loads(request.data)
        user_data = json.loads(payload["messages"][1]["content"])
        self.assertEqual(user_data["capability"]["instructions"], skill["instructions"])
        self.assertEqual(user_data["capability"]["tools"], skill["tools"])
        self.assertNotIn("tools", payload)
        self.assertNotIn("functions", payload)


class SkillEngineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "skills.sqlite3"
        self.engine = Engine(self.path, adapter=DemoAdapter())
        self.admin = self.person("admin", "admin")
        self.alice = self.person("alice")
        self.bob = self.person("bob")

    def tearDown(self):
        self.engine.close()
        self.temp.cleanup()

    def person(self, name, role="employee"):
        principal = {"id": name, "username": name, "display_name": name, "role": role, "actor_id": "person_" + name}
        self.engine.provision_employee(principal)
        return principal

    def act(self, person, kind, **kwargs):
        return self.engine.action({"type": kind, **kwargs}, person)

    def upload(self, person, actor_id=None, content=None, **kwargs):
        state = self.act(person, "import_skill", provider_actor_id=actor_id or person["actor_id"], content=content or skill_json(), source_name="skill.json", **kwargs)
        return state, state["skill_packages"][-1]

    def verify(self, package):
        return self.act(self.admin, "review_assessment", assessment_id=package["assessment_id"], decision="verify", level=3, review_note="核对本人提供的实际产物；声明范围内具备独立交付能力。")

    def test_preview_has_no_mutation(self):
        before = self.engine.snapshot(self.alice)
        result = self.engine.preview_skill({"content": skill_json(), "source_name": "skill.json"}, self.alice)
        self.assertEqual(result["missing_fields"], [])
        self.assertEqual(self.engine.snapshot(self.alice), before)

    def test_human_import_is_claim_not_certification_or_permission(self):
        state, package = self.upload(self.alice)
        cap_id = package["capability_id"]
        actor = next(a for a in state["actors"] if a["id"] == self.alice["actor_id"])
        self.assertNotIn(cap_id, actor["capability_ids"])
        self.assertNotIn(cap_id, actor["permissions"])
        claim = next(a for a in state["assessments"] if a["id"] == package["assessment_id"])
        doc = next(d for d in state["documents"] if d["id"] == claim["evidence_doc_id"])
        self.assertEqual(claim["status"], "claimed")
        self.assertIn(claim["evidence_excerpt"], doc["content"])
        state = self.verify(package)
        actor = next(a for a in state["actors"] if a["id"] == self.alice["actor_id"])
        self.assertIn(cap_id, actor["capability_ids"])
        self.assertNotIn(cap_id, actor["permissions"])
        self.act(self.admin, "grant_permission", actor_id=actor["id"], capability_id=cap_id, allowed=True)

    def test_agent_import_declares_without_granting_or_executing_tools(self):
        state, package = self.upload(self.admin, "planner", skill_json(provider_type="agent"))
        cap_id = package["capability_id"]
        actor = next(a for a in state["actors"] if a["id"] == "planner")
        self.assertIn(cap_id, actor["capability_ids"])
        self.assertNotIn(cap_id, actor["permissions"])
        self.assertEqual(package["status"], "declared")
        self.assertIn("未实测", actor["capability_declarations"][cap_id])
        self.assertIn(package["id"], [p["id"] for p in self.engine.snapshot(self.bob)["skill_packages"]])
        state = self.act(self.bob, "create_goal", title="使用公开Skill", criteria="形成输出", steps=[{"key": "s", "title": "比较", "capability_id": cap_id}])
        goal = state["goals"][-1]
        state = self.act(self.bob, "step", goal_id=goal["id"])
        self.assertEqual(state["goals"][-1]["status"], "blocked")
        self.act(self.admin, "grant_permission", actor_id="planner", capability_id=cap_id, allowed=True)
        state = self.act(self.bob, "step", goal_id=goal["id"])
        self.assertIn("脚本、工具和依赖均未执行", state["tasks"][-1]["output"])

    def test_employee_cannot_import_for_others_or_agents(self):
        for actor_id in ("planner", self.bob["actor_id"]):
            with self.assertRaises(PermissionError):
                self.upload(self.alice, actor_id)

    def test_type_mismatch_and_permission_overrides_are_rejected(self):
        for kwargs in ({"overrides": {"permissions": ["approve"]}}, {"permissions": ["approve"]}, {"overrides": {"inputs": {}}}):
            with self.assertRaises(ValueError):
                self.upload(self.alice, **kwargs)
        with self.assertRaises(ValueError):
            self.upload(self.alice, content=skill_json(provider_type="agent"))

    def test_incomplete_skill_requires_reviewed_overrides(self):
        content = "---\nname: 简短能力\ndescription: 只有介绍\n---\n执行正文"
        with self.assertRaises(ValueError):
            self.act(self.alice, "import_skill", content=content, source_name="SKILL.md", provider_actor_id=self.alice["actor_id"])
        state = self.act(self.alice, "import_skill", content=content, source_name="SKILL.md", provider_actor_id=self.alice["actor_id"], overrides={"inputs": "资料", "outputs": "清单", "acceptance": "每项注明来源"})
        self.assertEqual(len(state["skill_packages"]), 1)

    def test_exact_reimport_is_idempotent_and_version_conflict_is_atomic(self):
        state, package = self.upload(self.alice)
        before = self.engine.snapshot(self.alice)
        self.upload(self.alice)
        self.assertEqual(self.engine.snapshot(self.alice), before)
        with self.assertRaises(ValueError):
            self.upload(self.alice, content=skill_json(instructions="完全不同的执行流程"))
        self.assertEqual(self.engine.snapshot(self.alice), before)
        state, second = self.upload(self.alice, content=skill_json(version="2.0.0", instructions="新的版本流程"))
        self.assertNotEqual(package["capability_id"], second["capability_id"])
        self.assertEqual(len(state["skill_packages"]), 2)

    def test_same_source_can_be_shared_without_duplicate_capability(self):
        _, first = self.upload(self.alice)
        _, second = self.upload(self.bob)
        self.assertEqual(first["capability_id"], second["capability_id"])
        self.assertNotEqual(first["id"], second["id"])
        self.assertEqual(len(self.engine.snapshot(self.alice)["skill_packages"]), 1)
        self.assertEqual(len(self.engine.snapshot(self.bob)["skill_packages"]), 1)

    def test_source_and_private_instructions_are_hidden_from_others(self):
        _, package = self.upload(self.alice)
        cap_id = package["capability_id"]
        bob = self.engine.snapshot(self.bob)
        self.assertEqual(bob["skill_packages"], [])
        self.assertNotIn(cap_id, [c["id"] for c in bob["capabilities"]])
        with self.assertRaises(KeyError):
            self.engine.skill_source(package["id"], self.bob)
        self.verify(package)
        bob = self.engine.snapshot(self.bob)
        summary = next(c for c in bob["capabilities"] if c["id"] == cap_id)
        self.assertTrue(summary["details_restricted"])
        self.assertNotIn("PRIVATE_STEP_MARKER", str(bob))
        self.assertEqual(self.engine.skill_source(package["id"], self.alice)["content"], skill_json())
        with self.assertRaises(PermissionError):
            self.act(self.bob, "create_goal", title="猜测私有ID", criteria="不可访问", steps=[{"key": "s", "title": "私有", "capability_id": cap_id}])

    def test_private_capability_cannot_be_claimed_by_guessing_id(self):
        _, package = self.upload(self.alice)
        state = self.act(self.bob, "import_document", title="本人资料", content="本文是本人工作记录", scope="personal")
        doc = state["documents"][-1]
        with self.assertRaises(PermissionError):
            self.act(self.bob, "claim_capability", capability_id=package["capability_id"], level=3, description="试图冒用私有Skill", evidence_doc_id=doc["id"], evidence_excerpt=doc["content"])

    def test_skill_packages_survive_restart(self):
        _, package = self.upload(self.alice)
        self.engine.close()
        self.engine = Engine(self.path, adapter=DemoAdapter())
        stored = self.engine.snapshot(self.alice)["skill_packages"][0]
        self.assertEqual(stored["source_sha256"], package["source_sha256"])
        self.assertEqual(stored["normalized_sha256"], package["normalized_sha256"])


if __name__ == "__main__":
    unittest.main()
