"""Run an isolated multi-employee acceptance scenario through the real HTTP API.

No production database, external model or business service is used. Passwords
and session cookies stay in memory and are never included in the report.
"""
from __future__ import annotations

import argparse
import contextlib
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import http.client
import json
from pathlib import Path
import secrets
import sys
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from auth import AuthStore
from harness.adapters import DemoAdapter
from harness.engine import Engine
from server import HarnessHTTPServer, make_handler


WORK = [
    ("市场资料研究", "business_research"),
    ("业务数据校对", "data_analysis"),
    ("产品需求澄清", "analyze"),
    ("交付计划编制", "draft"),
    ("业务内容初稿", "content_writing"),
    ("交付质量检查", "review"),
    ("项目经验复盘", "reflect"),
    ("可用资源盘点", "analyze"),
    ("执行风险梳理", "review"),
    ("客户反馈归纳", "business_research"),
    ("实施步骤设计", "draft"),
    ("验收清单核对", "review"),
]


class VerificationFailure(AssertionError):
    pass


class Client:
    def __init__(self, port, cookie=""):
        self.port = port
        self.cookie = cookie

    def request(self, method, path, payload=None, timeout=15):
        headers = {"Cookie": self.cookie}
        body = None
        if payload is not None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=timeout)
        started = time.perf_counter()
        try:
            connection.request(method, path, body, headers)
            response = connection.getresponse()
            raw = response.read()
            data = json.loads(raw)
            cookie = response.getheader("Set-Cookie")
            if cookie:
                self.cookie = cookie.split(";", 1)[0]
            return response.status, data, round(time.perf_counter() - started, 6)
        finally:
            connection.close()

    def checked(self, method, path, payload=None, timeout=15):
        status, data, elapsed = self.request(method, path, payload, timeout)
        if status != 200:
            # Report the endpoint and status only, never credentials or payload.
            raise VerificationFailure(f"{method} {path} returned HTTP {status}: {data.get('error', 'request failed')}")
        return data, elapsed

    def action(self, kind, **fields):
        return self.checked("POST", "/api/action", {"type": kind, **fields})[0]

    def state(self):
        return self.checked("GET", "/api/state")[0]

    def coordination(self):
        return self.checked("GET", "/api/coordination")[0]


class LocalRuntime:
    def __init__(self, directory, adapter=None):
        self.directory = Path(directory)
        self.engine = Engine(self.directory / "workflow.sqlite", adapter=adapter or DemoAdapter(), seed=False)
        self.auth = AuthStore(self.directory / "accounts.sqlite")
        handler = make_handler(self.engine, self.auth)
        handler.log_message = lambda *args: None
        self.http = HarnessHTTPServer(("127.0.0.1", 0), handler)
        self.thread = threading.Thread(target=self.http.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True)
        self.thread.start()
        self.port = self.http.server_address[1]
        self.closed = False

    def close(self):
        if self.closed:
            return
        self.closed = True
        self.http.shutdown()
        self.http.server_close()
        self.thread.join(timeout=3)
        self.engine.close()
        self.auth.close()


class GatedAdapter(DemoAdapter):
    """A local slow Agent whose completion is explicitly controlled by the test."""
    model = "local gated adapter; no network"

    def __init__(self, fail=False):
        self.started = threading.Event()
        self.release = threading.Event()
        self.fail = fail

    def generate(self, *args):
        self.started.set()
        if not self.release.wait(timeout=12):
            raise RuntimeError("Local verification gate timed out")
        if self.fail:
            raise RuntimeError("PRIVATE-MODEL-ERROR：本地模拟失败，不应回滚其他员工的进度。")
        return super().generate(*args)


def stable_digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def task_in(state, task_id):
    return next(task for task in state["tasks"] if task["id"] == task_id)


def record(report, name, condition, **details):
    result = {"name": name, "passed": bool(condition), **details}
    report["checks"].append(result)
    if not condition:
        raise VerificationFailure(name)


def public_projection(board):
    """Role-specific action buttons and response timestamps are not shared state."""
    def shared_task(task):
        shared = {key: value for key, value in task.items()
                  if not key.startswith("can_") and key != "assignment_disabled_reason"}
        if "assignment_candidates" in shared:
            # Assignment permission belongs to the viewer; provider readiness,
            # identity and all execution blockers must still match for everyone.
            shared["assignment_candidates"] = [
                {key: value for key, value in candidate.items() if key != "can_assign"}
                for candidate in shared["assignment_candidates"]
            ]
        return shared

    return {
        "revision": board["revision"],
        "goals": sorted(({key: value for key, value in goal.items() if key != "tasks" and not key.startswith("can_")} for goal in board["goals"]), key=lambda item: item["id"]),
        "tasks": sorted((shared_task(task) for task in board["tasks"]), key=lambda item: item["id"]),
    }


def run_verification():
    started = time.perf_counter()
    report = {"passed": False, "started_at_utc": datetime.now(timezone.utc).isoformat(), "employees": len(WORK), "administrators": 1, "scope": "temporary local databases; random loopback port; no external services", "checks": [], "timings_seconds": {}}
    runtime = None
    try:
        with contextlib.ExitStack() as cleanup:
            temporary = tempfile.TemporaryDirectory(prefix="harness-collaboration-")
            cleanup.callback(temporary.cleanup)
            directory = temporary.name
            runtime = LocalRuntime(directory)
            cleanup.callback(lambda: runtime.close())
            admin = Client(runtime.port)
            admin_user = admin.checked("POST", "/api/auth/setup", {"username": "collab_admin", "display_name": "独立验收管理员", "password": secrets.token_urlsafe(24)})[0]["user"]
            workers = []
            credentials = []
            for index, (title, capability) in enumerate(WORK):
                username = f"worker_{index + 1:02}"
                password = secrets.token_urlsafe(24)
                user = admin.checked("POST", "/api/auth/users", {"username": username, "display_name": f"员工{index + 1:02} · {title}", "password": password})[0]["user"]
                workers.append({"client": Client(runtime.port), "user": user, "title": title, "capability": capability, "index": index})
                credentials.append({"username": username, "password": password})
            with ThreadPoolExecutor(max_workers=len(WORK)) as pool:
                list(pool.map(lambda item: item[0]["client"].checked("POST", "/api/auth/login", item[1]), zip(workers, credentials)))
            credentials.clear()
            record(report, "independent_authenticated_sessions", len({worker["client"].cookie for worker in workers} | {admin.cookie}) == 13, sessions=13)

            def parallel_stage(name, operation):
                stage_started = time.perf_counter()
                with ThreadPoolExecutor(max_workers=len(WORK)) as pool:
                    results = list(pool.map(operation, workers))
                report["timings_seconds"][name] = round(time.perf_counter() - stage_started, 6)
                return results

            def prepare_evidence(worker):
                marker = f"PRIVATE-DOCUMENT-{worker['index']:02}"
                content = marker + "：这是用于本地验收的虚构员工实践说明与产物出处，不代表真实人员认证。"
                state = worker["client"].action("import_document", title=worker["title"] + "证据", content=content, scope="personal", source_name="verification-fixture.txt")
                document = state["documents"][-1]
                state = worker["client"].action("claim_capability", capability_id=worker["capability"], level=3, description="仅用于验证身份、能力与授权分离的测试记录。", evidence_doc_id=document["id"], evidence_excerpt=content)
                assessment = state["assessments"][-1]
                admin.action("review_assessment", assessment_id=assessment["id"], decision="verify", level=3, review_note="仅限临时验收数据，已经核对测试证据关系。")
                admin.action("grant_permission", actor_id=worker["user"]["actor_id"], capability_id=worker["capability"], allowed=True)
            parallel_stage("evidence_and_authorization", prepare_evidence)
            state = admin.action("create_goal", title="12人并行后台协作验收", brief="PRIVATE-GOAL-BRIEF：不应出现在公共协作面板。", criteria="每人独立交付，管理员验收，至少一项返工。", collaborative=True, budget=50, steps=[{"key": f"work_{index:02}", "title": title, "capability_id": capability, "risk": "high", "depends_on": []} for index, (title, capability) in enumerate(WORK)])
            goal_id = state["goals"][-1]["id"]
            tasks = {task["key"]: task for task in state["tasks"] if task["goal_id"] == goal_id}
            for worker in workers:
                worker["task_id"] = tasks[f"work_{worker['index']:02}"]["id"]

            def mutate(worker, client, kind, **fields):
                task = task_in(client.state(), worker["task_id"])
                return client.action(kind, task_id=task["id"], expected_version=task["version"], **fields)

            parallel_stage("assign_12_tasks", lambda worker: mutate(worker, admin, "assign_task", actor_id=worker["user"]["actor_id"]))
            parallel_stage("accept_12_tasks", lambda worker: mutate(worker, worker["client"], "accept_task"))
            parallel_stage("start_12_tasks", lambda worker: mutate(worker, worker["client"], "start_task"))
            parallel_stage("progress_12_tasks", lambda worker: mutate(worker, worker["client"], "update_progress", progress=10 + worker["index"], note=f"公开进度{worker['index']:02}：{worker['title']}已开始整理。"))
            current = admin.state()
            record(report, "parallel_progress_updates_not_lost", all(task_in(current, worker["task_id"])["progress"] == 10 + worker["index"] for worker in workers), distinct_tasks=12)

            # Two simultaneous writes with the exact same expected task version.
            race_worker = workers[1]
            race_task = task_in(race_worker["client"].state(), race_worker["task_id"])
            barrier = threading.Barrier(2)
            def race_update(progress):
                barrier.wait(timeout=5)
                return race_worker["client"].request("POST", "/api/action", {"type": "update_progress", "task_id": race_task["id"], "expected_version": race_task["version"], "progress": progress, "note": f"公开竞态进度{progress}"})
            with ThreadPoolExecutor(max_workers=2) as pool:
                raced = list(pool.map(race_update, (45, 55)))
            race_statuses = sorted(result[0] for result in raced)
            conflict = next((result[1] for result in raced if result[0] == 409), {})
            after_race = task_in(admin.state(), race_task["id"])
            record(report, "same_version_competing_writes", race_statuses == [200, 409] and after_race["version"] == race_task["version"] + 1 and conflict.get("code") == "version_conflict" and conflict.get("refresh_required") is True, statuses=race_statuses)

            # A blocked local Agent must not hold the shared engine lock.
            gate = GatedAdapter()
            runtime.engine.adapter = gate
            slow_state = admin.action("create_goal", title="本地慢Agent并发验证", criteria="返回本地演示文本", steps=[{"key": "slow", "title": "慢速分析", "capability_id": "analyze", "risk": "low"}])
            slow_goal_id = slow_state["goals"][-1]["id"]
            with ThreadPoolExecutor(max_workers=1) as pool:
                slow_future = pool.submit(admin.action, "step", goal_id=slow_goal_id)
                try:
                    record(report, "slow_agent_entered_adapter", gate.started.wait(timeout=5))
                    read_started = time.perf_counter()
                    get_status, _, _ = workers[2]["client"].request("GET", "/api/coordination", timeout=3)
                    report["timings_seconds"]["get_during_slow_agent"] = round(time.perf_counter() - read_started, 6)
                    updating = workers[0]
                    update_task = task_in(updating["client"].state(), updating["task_id"])
                    action_status, _, update_elapsed = updating["client"].request("POST", "/api/action", {"type": "update_progress", "task_id": update_task["id"], "expected_version": update_task["version"], "progress": 60, "note": "公开进度：慢Agent执行期间，人工任务继续工作。"}, timeout=3)
                    report["timings_seconds"]["action_during_slow_agent"] = update_elapsed
                    record(report, "slow_agent_does_not_block_other_users", get_status == 200 and action_status == 200 and not slow_future.done(), get_status=get_status, action_status=action_status)
                finally:
                    gate.release.set()
                slow_future.result(timeout=5)
            record(report, "agent_success_preserves_concurrent_progress", task_in(admin.state(), workers[0]["task_id"])["progress"] == 60)

            # A failing slow call must also preserve concurrent committed work.
            failing_gate = GatedAdapter(fail=True)
            runtime.engine.adapter = failing_gate
            failure_state = admin.action("create_goal", title="本地慢Agent失败回写验证", criteria="失败不能覆盖其他任务更新", steps=[{"key": "failure", "title": "模拟失败", "capability_id": "analyze", "risk": "low"}])
            failure_goal_id = failure_state["goals"][-1]["id"]
            with ThreadPoolExecutor(max_workers=1) as pool:
                failure_future = pool.submit(admin.action, "step", goal_id=failure_goal_id)
                try:
                    record(report, "failing_agent_entered_adapter", failing_gate.started.wait(timeout=5))
                    mutate(workers[3], workers[3]["client"], "update_progress", progress=70, note="公开进度：其他Agent失败期间仍正常完成资料整理。")
                    saved_version = task_in(workers[3]["client"].state(), workers[3]["task_id"])["version"]
                finally:
                    failing_gate.release.set()
                failure_result = failure_future.result(timeout=5)
            preserved = task_in(admin.state(), workers[3]["task_id"])
            failed_goal = next(goal for goal in failure_result["goals"] if goal["id"] == failure_goal_id)
            record(report, "agent_failure_preserves_concurrent_progress", preserved["progress"] == 70 and preserved["version"] == saved_version and failed_goal["status"] == "failed", failure_status=failed_goal["status"])
            runtime.engine.adapter = DemoAdapter()

            submit_results = parallel_stage("submit_12_tasks", lambda worker: mutate(worker, worker["client"], "submit_task", output=f"PRIVATE-OUTPUT-{worker['index']:02}：{worker['title']}的独立交付、证据与限制说明，仅供有权验收者阅读。"))
            record(report, "twelve_distinct_private_submissions", all(f"PRIVATE-OUTPUT-{worker['index']:02}" in json.dumps(task_in(result, worker["task_id"]), ensure_ascii=False) for worker, result in zip(workers, submit_results)), submissions=12)
            submitted = task_in(workers[0]["client"].state(), workers[0]["task_id"])
            duplicate_status, _, _ = workers[0]["client"].request("POST", "/api/action", {"type": "submit_task", "task_id": submitted["id"], "expected_version": submitted["version"], "output": "重复提交不应生效"})
            unauthorized_status, _, _ = workers[1]["client"].request("POST", "/api/action", {"type": "submit_task", "task_id": submitted["id"], "expected_version": submitted["version"], "output": "越权提交不应生效"})
            self_review_status, _, _ = workers[0]["client"].request("POST", "/api/action", {"type": "review_task", "task_id": submitted["id"], "expected_version": submitted["version"], "approved": True, "feedback": "试图批准自己的交付"})
            record(report, "duplicate_and_unauthorized_submission_rejected", duplicate_status in (400, 403, 409) and unauthorized_status == 403 and self_review_status == 403, duplicate_status=duplicate_status, unauthorized_status=unauthorized_status, self_review_status=self_review_status)

            parallel_stage("review_12_submissions", lambda worker: mutate(worker, admin, "review_task", approved=worker["index"] != 0, feedback="PRIVATE-REVIEW-FEEDBACK：补充交付证据后重新提交。" if worker["index"] == 0 else "已由独立管理员核对这份测试产物。"))
            first = workers[0]
            rework_started = time.perf_counter()
            # Rejection explicitly returns this assignment to in-progress work.
            mutate(first, first["client"], "update_progress", progress=90, note="公开进度：已按验收意见补充，准备再次提交。")
            mutate(first, first["client"], "submit_task", output="PRIVATE-OUTPUT-00-REVISED：已补充证据、明确限制，重新提交独立验收。")
            mutate(first, admin, "review_task", approved=True, feedback="独立管理员确认返工后的测试版本满足要求。")
            report["timings_seconds"]["one_task_rework"] = round(time.perf_counter() - rework_started, 6)
            completed = admin.state()
            completed_tasks = [task for task in completed["tasks"] if task["goal_id"] == goal_id]
            reworked = task_in(completed, first["task_id"])
            independent = all(review["reviewer_id"] == admin_user["id"] for task in completed_tasks for review in task["reviews"])
            rework_preserved = len(reworked["submission_history"]) == 2 and [review["approved"] for review in reworked["reviews"]] == [False, True]
            record(report, "independent_review_and_rework_complete", len(completed_tasks) == 12 and all(task["status"] == "completed" for task in completed_tasks) and independent and rework_preserved, completed_tasks=len(completed_tasks), reworked_tasks=1, retained_submission_versions=len(reworked["submission_history"]))

            read_started = time.perf_counter()
            with ThreadPoolExecutor(max_workers=13) as pool:
                boards = list(pool.map(lambda client: client.coordination(), [admin] + [worker["client"] for worker in workers]))
            report["timings_seconds"]["public_state_read_13_sessions"] = round(time.perf_counter() - read_started, 6)
            projections = [public_projection(board) for board in boards]
            digests = {stable_digest(projection) for projection in projections}
            record(report, "all_sessions_observe_identical_public_state", len(digests) == 1, sessions_checked=13, distinct_public_digests=len(digests), revision=boards[0]["revision"])
            public_text = json.dumps(boards, ensure_ascii=False)
            markers = ("PRIVATE-DOCUMENT-", "PRIVATE-OUTPUT-", "PRIVATE-REVIEW-FEEDBACK", "PRIVATE-GOAL-BRIEF", "PRIVATE-MODEL-ERROR")
            record(report, "public_coordination_does_not_leak_private_content", not any(marker in public_text for marker in markers), private_categories_checked=5)
            anonymous = Client(runtime.port)
            record(report, "coordination_requires_login", anonymous.request("GET", "/api/coordination")[0] == 401)
            before_restart = projections[0]
            runtime.close()
            restart_started = time.perf_counter()
            runtime = LocalRuntime(directory)
            for client in [admin] + [worker["client"] for worker in workers]:
                client.port = runtime.port
            with ThreadPoolExecutor(max_workers=13) as pool:
                restarted_boards = list(pool.map(lambda client: client.coordination(), [admin] + [worker["client"] for worker in workers]))
            report["timings_seconds"]["restart_and_read_13_sessions"] = round(time.perf_counter() - restart_started, 6)
            record(report, "restart_preserves_sessions_versions_and_updates", all(public_projection(board) == before_restart for board in restarted_boards), sessions_restored=13)
            report["completed_tasks"] = len(completed_tasks)
            report["public_state_sha256"] = next(iter(digests))
            report["passed"] = True
            runtime.close()
    except Exception as error:
        report["error"] = f"{type(error).__name__}: {error}"
    finally:
        if runtime is not None:
            runtime.close()
        report["elapsed_seconds"] = round(time.perf_counter() - started, 6)
    return report


def main():
    parser = argparse.ArgumentParser(description="以12名独立员工的真实HTTP会话验证多人协作；只使用临时数据库")
    parser.add_argument("--report", type=Path, help="可选JSON报告路径；不写入密码或Cookie")
    args = parser.parse_args()
    try:
        report = run_verification()
    except Exception as error:
        report = {"passed": False, "error": str(error), "scope": "temporary local databases; no external services"}
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
