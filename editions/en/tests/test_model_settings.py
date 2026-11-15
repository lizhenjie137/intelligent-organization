"""Self-service settings over real HTTP, real SDK, loopback-only providers."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
import hashlib
import json
from pathlib import Path
import secrets
import tempfile
import threading
import time
import unittest

from auth import AuthStore
from harness.engine import Engine
from harness.model_settings import RuntimeManager
from server import HarnessHTTPServer, make_handler
from scripts.verify_embedded_harness import Client, MockModel, RESPONSE, create_fixture, task_for


class InspectingModel(MockModel):
    """Record credential hashes, never cleartext headers, at the local fixture."""
    def __init__(self):
        super().__init__()
        self.credential_digests = []
        original = self.server.RequestHandlerClass
        fixture = self

        class Handler(original):
            def do_POST(self):
                value = self.headers.get("Authorization") or self.headers.get("x-api-key") or ""
                fixture.credential_digests.append(hashlib.sha256(value.encode()).hexdigest())
                super().do_POST()

        self.server.RequestHandlerClass = Handler


class SettingsHost:
    def __init__(self, root, config_path):
        self.root = Path(root)
        self.manager = RuntimeManager(config_path=config_path, runtime_root=self.root / "runtime", settings_path=self.root / "model-settings.json")
        self.engine = Engine(self.root / "business.sqlite", adapter=self.manager, seed=False)
        self.auth = AuthStore(self.root / "auth.sqlite")
        handler = make_handler(self.engine, self.auth, self.manager)
        handler.log_message = lambda *args: None
        self.server = HarnessHTTPServer(("127.0.0.1", 0), handler)
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True)
        self.thread.start()
        self.port = self.server.server_address[1]
        self.closed = False

    def close(self):
        if self.closed:
            return
        self.closed = True
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.manager.close()
        self.engine.close()
        self.auth.close()


def verify_settings():
    started = time.perf_counter()
    report = {"passed": False, "scope": "original HTTP settings API + Windows DPAPI + official SDK; loopback only", "checks": [], "timings_seconds": {}}
    def check(name, condition, **detail):
        report["checks"].append({"name": name, "passed": bool(condition), **detail})
        if not condition:
            raise AssertionError(name)
    try:
        with ExitStack() as stack:
            directory = Path(stack.enter_context(tempfile.TemporaryDirectory(prefix="model-settings-", ignore_cleanup_errors=True)))
            fixture = create_fixture(directory)
            model = stack.enter_context(InspectingModel())
            alternate = stack.enter_context(InspectingModel())
            bootstrap = directory / "bootstrap.json"
            bootstrap.write_text(json.dumps({"connection": "local", "protocol": "openai-completions", "base_url": model.origin + "/v1", "model": "bootstrap-model", "api_key_env": "", "timeout_seconds": 25}), encoding="utf-8")
            bootstrap_bytes = bootstrap.read_bytes()
            host = SettingsHost(directory, bootstrap)
            stack.callback(lambda: host.close())
            admin = Client(host.port, fixture["admin_token"])
            employee = Client(host.port, fixture["employee_token"])
            guest = Client(host.port)
            api = "/api/model-config"
            key = "synthetic-fixture-key-" + secrets.token_hex(24)
            key_digest = hashlib.sha256(("Bearer " + key).encode()).hexdigest()
            draft = {"connection": "cloud", "protocol": "openai-completions", "base_url": model.origin + "/v1", "model": "configured-model", "max_tokens": 1024, "timeout_seconds": 25, "context_window": 32768, "max_concurrency": 4}
            replace = {**draft, "key_action": "replace", "api_key": key}
            keep = {**draft, "key_action": "keep"}

            for client, expected in ((guest, 401), (employee, 403)):
                statuses = [client.request("GET", api)[0], client.request("GET", api + "?include_secret=true")[0],
                            client.request("POST", api, replace)[0], client.request("POST", api + "/test", replace)[0]]
                check("configuration_admin_only_" + str(expected), statuses == [expected] * 4, statuses=statuses)
            check("unauthorized_requests_do_not_contact_provider", not model.requests and not alternate.requests)
            initial = admin.checked("GET", api)
            saved = admin.checked("POST", api, {**replace, "expected_revision": initial["revision"]})
            check("saving_is_local_and_keeps_bootstrap_file", saved["draft"]["model"] == draft["model"] and saved["has_api_key"] and bootstrap.read_bytes() == bootstrap_bytes and not model.requests)
            before = admin.state()
            tested = admin.checked("POST", api + "/test", keep)
            check("real_sdk_connection_test_succeeds", tested["ok"] is True and len(model.requests) == 1 and model.credential_digests[-1] == key_digest)
            business_keys = ("goals", "tasks", "documents", "assessments", "actors", "capabilities", "memories", "events", "skill_packages")
            after = admin.state()
            check("connection_test_does_not_mutate_business", all(before[k] == after[k] for k in business_keys))
            check("connection_test_does_not_send_business_context", fixture["private_text"] not in json.dumps(model.requests[0]["body"], ensure_ascii=False) and "EXISTING_PRIVATE_BRIEF" not in json.dumps(model.requests[0]["body"]))
            for label, client, path in (("settings", admin, api), ("secret_query", admin, api + "?include_secret=true"), ("runtime", admin, "/api/runtime"), ("admin_state", admin, "/api/state"), ("employee_state", employee, "/api/state"), ("admin_export", admin, "/api/export"), ("employee_export", employee, "/api/export")):
                payload = client.checked("GET", path)
                encoded = json.dumps(payload, ensure_ascii=False)
                check("secret_not_returned_in_" + label, key not in encoded and '"api_key"' not in encoded)
            files = [path for path in directory.rglob("*") if path.is_file()]
            check("persistent_files_do_not_contain_plaintext_key", all(key.encode() not in path.read_bytes() for path in files), files_checked=len(files))
            stored = admin.checked("GET", api)
            check("windows_secret_is_dpapi_protected", stored["secret_storage"] == "windows-dpapi" and stored["has_api_key"])

            # Failed draft probes cannot replace the working configuration.
            model.failure_status = 401
            failed = admin.checked("POST", api + "/test", {**keep, "model": "rejected-draft-model"})
            unchanged = admin.checked("GET", api)
            check("provider_failure_keeps_active_settings_and_secret", failed["ok"] is False and unchanged["draft"] == stored["draft"] and unchanged["has_api_key"])
            check("provider_failure_response_is_sanitized", key not in json.dumps(failed) and "LOCAL-MOCK-ERROR-DETAIL" not in json.dumps(failed))
            model.failure_status = None
            changed_endpoint = {**keep, "base_url": alternate.origin + "/v1"}
            no_key_statuses = [admin.request("POST", api, changed_endpoint)[0], admin.request("POST", api + "/test", changed_endpoint)[0]]
            check("new_endpoint_cannot_reuse_old_secret", no_key_statuses == [400, 400] and not alternate.requests, statuses=no_key_statuses)
            changed_protocol = {**keep, "protocol": "deepseek-messages"}
            check("new_protocol_cannot_reuse_old_secret", admin.request("POST", api + "/test", changed_protocol)[0] == 400)
            invalid = admin.request("POST", api, {**keep, "base_url": "not-a-url"})
            latest = admin.checked("GET", api)
            stale = admin.request("POST", api, {**keep, "expected_revision": initial["revision"]})
            check("invalid_and_stale_saves_preserve_settings", invalid[0] == 400 and stale[0] == 409 and latest["draft"] == stored["draft"] and latest["has_api_key"])
            local_candidate = {**draft, "connection": "local", "base_url": alternate.origin + "/v1", "model": "alternate-model", "key_action": "remove"}
            candidate_test = admin.checked("POST", api + "/test", local_candidate)
            current = admin.checked("GET", api)
            check("explicit_key_removal_tests_new_endpoint_without_old_key", candidate_test["ok"] and alternate.requests[-1]["local_placeholder_only"] and current["draft"] == stored["draft"] and current["has_api_key"])

            # Each workspace keeps its own GUI settings even with a shared
            # read-only bootstrap configuration.
            isolated = RuntimeManager(config_path=bootstrap, runtime_root=directory / "isolated-runtime", settings_path=directory / "isolated-settings.json")
            try:
                isolated_settings = isolated.get_settings()
                check("settings_are_isolated_between_workspaces", isolated_settings["draft"]["model"] == "bootstrap-model" and not isolated_settings["has_api_key"] and bootstrap.read_bytes() == bootstrap_bytes)
            finally:
                isolated.close()
            host.close()
            host = SettingsHost(directory, bootstrap)
            admin.port = employee.port = guest.port = host.port
            rebooted = admin.checked("GET", api)
            probe = admin.checked("POST", api + "/test", keep)
            check("restart_restores_configuration_and_dpapi_secret", rebooted["draft"] == stored["draft"] and rebooted["has_api_key"] and probe["ok"] and model.credential_digests[-1] == key_digest)

            def human_action(kind, **fields):
                task = task_for(employee.state(), fixture["human_goal"])
                return employee.action(kind, task_id=task["id"], expected_version=task["version"], **fields)
            human_action("accept_task")
            human_action("start_task")
            # A real dsh call is held at the provider boundary. The save path
            # must fail fast while unrelated employee progress keeps moving.
            model.entered.clear()
            model.release.clear()
            with ThreadPoolExecutor(max_workers=1) as executor:
                running = executor.submit(employee.action, "step", goal_id=fixture["pending_goal"])
                try:
                    check("active_real_agent_reached_provider", model.entered.wait(15))
                    tick = time.perf_counter()
                    blocked_status, _ = admin.request("POST", api, local_candidate, timeout=3)
                    coor_status, _ = employee.request("GET", "/api/coordination", timeout=3)
                    human_action("update_progress", progress=62, note="模型正在执行，员工的公共进度仍正常同步。")
                    report["timings_seconds"]["save_rejection_and_collaboration"] = round(time.perf_counter() - tick, 6)
                    check("active_agent_blocks_model_switch_not_collaboration", blocked_status == 409 and coor_status == 200 and not running.done())
                finally:
                    model.release.set()
                outcome = running.result(timeout=30)
            check("agent_finishes_on_original_model_and_keeps_progress", task_for(outcome, fixture["pending_goal"])["status"] == "completed" and task_for(employee.state(), fixture["human_goal"])["progress"] == 62 and admin.checked("GET", api)["draft"] == stored["draft"])

            model.entered.clear()
            model.release.clear()
            with ThreadPoolExecutor(max_workers=1) as executor:
                running_test = executor.submit(admin.checked, "POST", api + "/test", keep)
                try:
                    check("active_connection_test_reached_provider", model.entered.wait(15))
                    blocked_status, _ = admin.request("POST", api, local_candidate, timeout=3)
                    read_status, _ = employee.request("GET", "/api/coordination", timeout=3)
                    check("active_test_blocks_model_switch_not_reads", blocked_status == 409 and read_status == 200 and not running_test.done())
                finally:
                    model.release.set()
                check("active_connection_test_completes", running_test.result(timeout=30)["ok"])
            switched = admin.checked("POST", api, local_candidate)
            check("idle_switch_applies_and_removes_secret", switched["draft"]["base_url"] == alternate.origin + "/v1" and not switched["has_api_key"] and bootstrap.read_bytes() == bootstrap_bytes)
            next_state = employee.action("create_goal", title="切换后的新模型任务", criteria="使用当前生效的本地模型", steps=[{"key": "one", "title": "分析", "capability_id": "analyze"}])
            next_goal = next_state["goals"][-1]["id"]
            next_state = employee.action("step", goal_id=next_goal)
            check("new_tasks_use_new_endpoint_without_secret", task_for(next_state, next_goal)["status"] == "completed" and RESPONSE in task_for(next_state, next_goal)["output"] and alternate.requests[-1]["body"]["model"] == "alternate-model" and alternate.requests[-1]["local_placeholder_only"])
            report["provider_requests"] = len(model.requests) + len(alternate.requests)
            report["passed"] = True
    except Exception as error:
        report["error"] = f"{type(error).__name__}: {error}"
    report["elapsed_seconds"] = round(time.perf_counter() - started, 6)
    return report


class ModelSettingsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.report = verify_settings()
        cls.results = {item["name"]: item for item in cls.report["checks"]}

    def checked(self, *names):
        for name in names:
            item = self.results.get(name)
            self.assertIsNotNone(item, self.report.get("error", name))
            self.assertTrue(item["passed"], item)

    def test_access_control_and_no_unauthorized_probe(self):
        self.checked("configuration_admin_only_401", "configuration_admin_only_403", "unauthorized_requests_do_not_contact_provider")

    def test_real_sdk_probe_is_independent_of_business(self):
        self.checked("saving_is_local_and_keeps_bootstrap_file", "real_sdk_connection_test_succeeds", "connection_test_does_not_mutate_business", "connection_test_does_not_send_business_context")

    def test_no_read_api_returns_secret_and_disk_uses_dpapi(self):
        self.checked(*( "secret_not_returned_in_" + name for name in ("settings", "secret_query", "runtime", "admin_state", "employee_state", "admin_export", "employee_export")))
        self.checked("persistent_files_do_not_contain_plaintext_key", "windows_secret_is_dpapi_protected")

    def test_failure_and_endpoint_changes_preserve_credential_boundary(self):
        self.checked("provider_failure_keeps_active_settings_and_secret", "provider_failure_response_is_sanitized", "new_endpoint_cannot_reuse_old_secret", "new_protocol_cannot_reuse_old_secret", "invalid_and_stale_saves_preserve_settings", "explicit_key_removal_tests_new_endpoint_without_old_key")

    def test_workspace_and_restart_isolation(self):
        self.checked("settings_are_isolated_between_workspaces", "restart_restores_configuration_and_dpapi_secret")

    def test_active_agent_and_probe_prevent_switch_but_allow_collaboration(self):
        self.checked("active_real_agent_reached_provider", "active_agent_blocks_model_switch_not_collaboration", "agent_finishes_on_original_model_and_keeps_progress", "active_connection_test_reached_provider", "active_test_blocks_model_switch_not_reads", "active_connection_test_completes")

    def test_idle_switch_is_used_by_next_agent(self):
        self.checked("idle_switch_applies_and_removes_secret", "new_tasks_use_new_endpoint_without_secret")
        self.assertTrue(self.report["passed"], self.report.get("error"))


if __name__ == "__main__":
    unittest.main()
