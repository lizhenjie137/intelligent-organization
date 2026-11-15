"""One isolated 13-session HTTP scenario, with separate acceptance assertions."""
import unittest

from scripts.verify_collaboration import run_verification


class MultiUserHttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.report = run_verification()
        cls.checks = {check["name"]: check for check in cls.report["checks"]}

    def check(self, name):
        result = self.checks.get(name)
        self.assertIsNotNone(result, self.report.get("error", f"Missing check: {name}"))
        self.assertTrue(result["passed"], result)
        return result

    def test_twelve_independent_workers_and_concurrent_progress(self):
        self.assertEqual(self.report["employees"], 12)
        self.assertEqual(self.check("independent_authenticated_sessions")["sessions"], 13)
        self.check("parallel_progress_updates_not_lost")
        self.check("twelve_distinct_private_submissions")

    def test_revision_conflict_duplicate_and_cross_user_mutation(self):
        self.assertEqual(self.check("same_version_competing_writes")["statuses"], [200, 409])
        self.check("duplicate_and_unauthorized_submission_rejected")

    def test_independent_review_and_return_to_worker(self):
        result = self.check("independent_review_and_rework_complete")
        self.assertEqual(result["completed_tasks"], 12)
        self.assertEqual(result["reworked_tasks"], 1)

    def test_shared_public_state_and_private_content_boundary(self):
        result = self.check("all_sessions_observe_identical_public_state")
        self.assertEqual(result["sessions_checked"], 13)
        self.assertEqual(result["distinct_public_digests"], 1)
        self.check("public_coordination_does_not_leak_private_content")
        self.check("coordination_requires_login")

    def test_slow_agent_does_not_block_other_employee_requests(self):
        self.check("slow_agent_entered_adapter")
        self.check("slow_agent_does_not_block_other_users")
        self.check("agent_success_preserves_concurrent_progress")
        self.check("agent_failure_preserves_concurrent_progress")
        self.assertIn("get_during_slow_agent", self.report["timings_seconds"])
        self.assertIn("action_during_slow_agent", self.report["timings_seconds"])

    def test_restart_preserves_all_session_views(self):
        self.check("restart_preserves_sessions_versions_and_updates")
        self.assertTrue(self.report["passed"], self.report.get("error"))


if __name__ == "__main__":
    unittest.main()
