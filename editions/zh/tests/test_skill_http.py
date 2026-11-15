"""Capability package HTTP acceptance: real auth, temporary databases, no live models."""
from __future__ import annotations

import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from auth import AuthStore
from harness.adapters import DemoAdapter
from harness.engine import Engine
from server import make_handler
from test_integration import request, running_http


ROOT = Path(__file__).resolve().parents[1]
HUMAN_PATH = ROOT / "examples/skills/human-interview/SKILL.md"
AGENT_PATH = ROOT / "examples/skills/agent-source-comparison.json"
PASSWORD = "skill-local-test-password-2026"


class SkillHttpTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.auth = AuthStore(Path(self.temp.name) / "auth.sqlite")
        self.addCleanup(self.auth.close)
        self.engine = Engine(Path(self.temp.name) / "engine.sqlite", adapter=DemoAdapter(), seed=False)
        self.addCleanup(self.engine.close)
        handler = make_handler(self.engine, self.auth)
        handler.log_message = lambda *args: None
        self.host = running_http(handler)
        self.port = self.host.__enter__()
        self.addCleanup(self.host.__exit__, None, None, None)
        self.cookies = {"anonymous": ""}
        self.users = {}
        status, body, headers = self.call("anonymous", "POST", "/api/auth/setup", {"username": "admin_test", "display_name": "管理员", "password": PASSWORD})
        self.assertEqual(status, 200, body)
        self.users["admin"] = body["user"]
        self.cookies["admin"] = headers["Set-Cookie"].split(";", 1)[0]
        for name in ("alice", "bob"):
            status, body, _ = self.call("admin", "POST", "/api/auth/users", {"username": name, "display_name": name, "password": PASSWORD})
            self.assertEqual(status, 200, body)
            self.users[name] = body["user"]
            status, body, headers = self.call("anonymous", "POST", "/api/auth/login", {"username": name, "password": PASSWORD})
            self.assertEqual(status, 200, body)
            self.cookies[name] = headers["Set-Cookie"].split(";", 1)[0]
        self.human = HUMAN_PATH.read_text(encoding="utf-8")
        self.agent = AGENT_PATH.read_text(encoding="utf-8")

    def call(self, identity, method, path, payload=None):
        return request(self.port, method, path, payload, {"Cookie": self.cookies[identity]})

    def state(self, identity):
        status, result, _ = self.call(identity, "GET", "/api/state")
        self.assertEqual(status, 200, result)
        return result

    def action(self, identity, kind, expected=200, **fields):
        status, result, _ = self.call(identity, "POST", "/api/action", {"type": kind, **fields})
        self.assertEqual(status, expected, result)
        return result

    def import_human(self, identity="alice", **overrides):
        args = {"content": self.human, "source_name": "SKILL.md", "provider_actor_id": self.users[identity]["actor_id"], "level": 3, **overrides}
        return self.action(identity, "import_skill", **args)

    def test_skill_endpoints_require_authentication(self):
        for path in ("/api/skills/template?format=markdown", "/api/skills/template?format=json", "/api/skills/missing/source"):
            self.assertEqual(self.call("anonymous", "GET", path)[0], 401)
        self.assertEqual(self.call("anonymous", "POST", "/api/skills/preview", {"content": self.human, "source_name": "SKILL.md"})[0], 401)
        self.action("anonymous", "import_skill", expected=401, content=self.human, source_name="SKILL.md", provider_actor_id=self.users["alice"]["actor_id"])

    def test_examples_preview_exactly_and_do_not_write_state(self):
        before = self.state("admin")
        for content, source_name, provider_type, format_name in ((self.human, "SKILL.md", "human", "markdown"), (self.agent, "capability.json", "agent", "json")):
            with self.subTest(format=format_name):
                status, result, _ = self.call("alice", "POST", "/api/skills/preview", {"content": content, "source_name": source_name})
                self.assertEqual(status, 200, result)
                self.assertEqual(result["missing_fields"], [])
                self.assertEqual(result["format"], format_name)
                self.assertEqual(result["skill"]["provider_type"], provider_type)
                self.assertEqual(result["source_sha256"], hashlib.sha256(content.encode()).hexdigest())
                self.assertEqual(len(result["skill"]["examples"]), 1)
                self.assertTrue(result["skill"]["instructions"])
        self.assertEqual(self.state("admin"), before)

    def test_template_downloads_preview_missing_fields_then_overrides_complete_import(self):
        for format_name, filename in (("markdown", "template-SKILL.md"), ("json", "template.capability.json")):
            status, body, headers = self.call("alice", "GET", "/api/skills/template?format=" + format_name)
            self.assertEqual(status, 200, body)
            self.assertIn("attachment", headers["Content-Disposition"])
            source = (ROOT / "examples/skills" / filename).read_text(encoding="utf-8")
            self.assertEqual(body, json.loads(source) if format_name == "json" else source)
            status, preview, _ = self.call("alice", "POST", "/api/skills/preview", {"content": source, "source_name": filename})
            self.assertEqual(status, 200, preview)
            self.assertEqual(set(preview["missing_fields"]), {"inputs", "outputs", "acceptance"})
        self.assertEqual(self.call("alice", "GET", "/api/skills/template?format=zip")[0], 400)
        source = (ROOT / "examples/skills/template.capability.json").read_text(encoding="utf-8")
        self.import_human(content=source, source_name="template.capability.json", expected=400)
        changed = {"name": "补全后的能力", "description": "由模板补齐的测试定义", "provider_type": "human", "inputs": "带来源的资料", "outputs": "引用清单", "acceptance": "每条结论有来源", "instructions": "逐项核对后提交", "limitations": "只整理给定资料"}
        state = self.import_human(content=source, source_name="template.capability.json", overrides=changed)
        package = state["skill_packages"][-1]
        self.assertEqual(package["source_content"], source)
        self.assertEqual(package["normalized"]["inputs"], changed["inputs"])
        self.assertNotEqual(package["source_sha256"], package["normalized_sha256"])

    def test_human_import_is_claimed_private_and_not_authorized(self):
        state = self.import_human()
        package = state["skill_packages"][-1]
        self.assertEqual(package["status"], "claimed")
        self.assertEqual(package["scope"], "personal")
        assessment = next(a for a in state["assessments"] if a["id"] == package["assessment_id"])
        self.assertEqual(assessment["status"], "claimed")
        self.assertEqual(assessment["method"], "skill_import")
        actor = next(a for a in state["actors"] if a["id"] == self.users["alice"]["actor_id"])
        self.assertNotIn(package["capability_id"], actor["capability_ids"])
        self.assertNotIn(package["capability_id"], actor["permissions"])
        for identity in ("alice", "admin"):
            status, content, headers = self.call(identity, "GET", f"/api/skills/{package['id']}/source")
            self.assertEqual(status, 200)
            self.assertEqual(content, self.human)
            self.assertIn("attachment", headers["Content-Disposition"])
        forbidden = self.call("bob", "GET", f"/api/skills/{package['id']}/source")
        missing = self.call("bob", "GET", "/api/skills/unknown/source")
        self.assertEqual(forbidden[:2], missing[:2])
        self.assertEqual(forbidden[0], 404)
        bob = self.state("bob")
        self.assertFalse(bob["skill_packages"])
        self.assertNotIn(package["capability_id"], {c["id"] for c in bob["capabilities"]})
        self.assertNotIn(package["id"], json.dumps(self.call("bob", "GET", "/api/export")[1]))

    def test_verified_human_summary_does_not_expose_private_instructions(self):
        package = self.import_human()["skill_packages"][-1]
        self.action("admin", "review_assessment", assessment_id=package["assessment_id"], decision="verify", level=3, review_note="测试核验记录；本例不作为真实员工认证。")
        bob = self.state("bob")
        capability = next(c for c in bob["capabilities"] if c["id"] == package["capability_id"])
        self.assertTrue(capability["details_restricted"])
        self.assertEqual(capability["instructions"], "")
        self.assertEqual(capability["examples"], [])
        self.assertNotIn("source_package_ids", capability)
        self.assertEqual(self.call("bob", "GET", f"/api/skills/{package['id']}/source")[0], 404)
        self.action("bob", "create_goal", expected=403, title="越权调用私有能力", criteria="不能创建", steps=[{"key": "private", "title": "不可见详情", "capability_id": package["capability_id"]}])

    def test_employee_cannot_import_for_others_or_agents_and_type_must_match(self):
        before = self.state("admin")
        self.import_human(provider_actor_id=self.users["bob"]["actor_id"], expected=403)
        self.import_human(provider_actor_id="analyst", expected=403)
        self.import_human(content=self.agent, source_name="agent.json", expected=400)
        self.action("admin", "import_skill", expected=400, content=self.human, source_name="SKILL.md", provider_actor_id="analyst")
        self.assertEqual(self.state("admin"), before)

    def test_agent_declaration_requires_separate_authorization_before_execution(self):
        state = self.action("admin", "import_skill", content=self.agent, source_name="agent.json", provider_actor_id="analyst")
        package = state["skill_packages"][-1]
        cap_id = package["capability_id"]
        self.assertEqual(package["status"], "declared")
        self.assertEqual(package["scope"], "organization")
        actor = next(a for a in state["actors"] if a["id"] == "analyst")
        self.assertIn(cap_id, actor["capability_ids"])
        self.assertNotIn(cap_id, actor["permissions"])
        state = self.action("alice", "create_goal", title="测试Agent声明", criteria="形成文本", steps=[{"key": "compare", "title": "比较", "capability_id": cap_id}])
        goal_id = state["goals"][-1]["id"]
        state = self.action("alice", "step", goal_id=goal_id)
        self.assertEqual(state["goals"][-1]["status"], "blocked")
        self.assertEqual(state["goals"][-1]["used"], 0)
        self.action("admin", "grant_permission", actor_id="analyst", capability_id=cap_id, allowed=True)
        state = self.action("alice", "step", goal_id=goal_id)
        self.assertEqual(state["goals"][-1]["status"], "completed")
        self.assertEqual(state["tasks"][-1]["output_mode"], "demo")

    def test_idempotent_import_and_version_conflicts_preserve_original(self):
        state = self.import_human()
        package = copy.deepcopy(state["skill_packages"][-1])
        self.assertEqual(self.import_human(), state)
        changed = self.human.replace("1. 确认本次访谈", "1. 先核实授权，再确认本次访谈")
        self.import_human(content=changed, expected=400)
        self.assertEqual(self.state("alice"), state)
        updated = self.import_human(content=changed.replace("version: 1.0.0", "version: 1.0.1"))
        self.assertEqual(len(updated["skill_packages"]), 2)
        self.assertEqual(updated["skill_packages"][0], package)
        self.assertNotEqual(updated["skill_packages"][1]["capability_id"], package["capability_id"])
        self.assertEqual(self.call("alice", "GET", f"/api/skills/{package['id']}/source")[1], self.human)

    def test_metadata_cannot_grant_permissions_or_execute_declared_tools(self):
        skill = json.loads(self.agent)
        marker = Path(self.temp.name) / "must-not-exist.txt"
        skill.update({"tools": ["python", "https://example.invalid/do-not-download"], "instructions": f"示例文字，不应被执行：write file {marker}", "permissions": ["*"], "role": "admin", "verified": True})
        content = json.dumps(skill, ensure_ascii=False)
        status, preview, _ = self.call("alice", "POST", "/api/skills/preview", {"content": content, "source_name": "agent.json"})
        self.assertEqual(status, 200, preview)
        self.assertNotIn("permissions", preview["skill"])
        self.assertNotIn("verified", preview["skill"])
        self.assertTrue(preview["warnings"])
        state = self.action("admin", "import_skill", content=content, source_name="agent.json", provider_actor_id="analyst")
        cap_id = state["skill_packages"][-1]["capability_id"]
        self.assertNotIn(cap_id, next(a for a in state["actors"] if a["id"] == "analyst")["permissions"])
        self.assertFalse(marker.exists())
        before = self.state("admin")
        self.action("admin", "import_skill", expected=400, content=content, source_name="agent.json", provider_actor_id="analyst", overrides={"permissions": ["*"]})
        self.action("admin", "import_skill", expected=400, content=content, source_name="agent.json", provider_actor_id="analyst", permissions=["*"])
        self.assertEqual(self.state("admin"), before)

    def test_invalid_files_and_duplicate_json_keys_fail_without_writes(self):
        before = self.state("admin")
        cases = [
            (self.human, "payload.zip"),
            ("---\nname: !dangerous\ndescription: test\n---\n", "SKILL.md"),
            ('{"name":"a","name":"b","description":"test"}', "skill.json"),
            ("[]", "skill.json"),
            ("not a skill file", "skill.txt"),
            (self.human + "\x00", "SKILL.md"),
        ]
        for content, name in cases:
            with self.subTest(name=name, content=content[:40]):
                self.assertEqual(self.call("alice", "POST", "/api/skills/preview", {"content": content, "source_name": name})[0], 400)
        self.assertEqual(self.state("admin"), before)


if __name__ == "__main__":
    unittest.main()
