"""Acceptance for the original server entrypoint, never the copied app."""
import unittest

from scripts.verify_embedded_harness import verify


class EmbeddedHarnessTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.report = verify()
        cls.results = {item["name"]: item for item in cls.report["checks"]}

    def checked(self, *names):
        for name in names:
            result = self.results.get(name)
            self.assertIsNotNone(result, self.report.get("error", name))
            self.assertTrue(result["passed"], result)

    def test_original_database_and_existing_login_are_retained(self):
        self.checked("original_accounts_and_all_business_collections_preserved",
                     "original_session_cookie_remains_valid", "existing_password_login_works_without_model",
                     "restart_with_model_preserves_accounts_knowledge_and_tasks")

    def test_original_entrypoint_uses_factory_and_defaults_to_real_runtime(self):
        self.assertFalse(self.report["copied_application_used"])
        self.checked("original_entrypoint_defaults_to_deepseek_factory", "original_factory_loads_official_runtime",
                     "runtime_configuration_is_admin_only")

    def test_unconfigured_agent_fails_but_human_work_completes(self):
        self.checked("human_collaboration_works_without_model", "human_submission_and_independent_review_complete",
                     "missing_configuration_fails_agent_without_demo")

    def test_real_dsh_receives_existing_task_and_private_knowledge(self):
        self.checked("original_task_executes_through_real_dsh", "original_private_knowledge_reaches_its_owner_runtime",
                     "official_runtime_records_original_task_identity")

    def test_existing_demo_history_is_not_rewritten(self):
        self.checked("historical_demo_outputs_are_retained_without_relabeling")

    def test_original_interface_is_unchanged(self):
        self.checked("original_ui_served_byte_for_byte", "original_ui_files_unchanged")
        self.assertTrue(self.report["passed"], self.report.get("error"))


if __name__ == "__main__":
    unittest.main()
