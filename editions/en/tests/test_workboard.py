"""Authenticated HTTP work-materials and handoff acceptance in temporary stores."""
import base64
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
import copy
import hashlib
import http.client
import json
from pathlib import Path
import secrets
import sqlite3
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from urllib.parse import urlencode

from auth import AuthStore
from harness.adapters import DemoAdapter
from harness.engine import Engine
from server import HarnessHTTPServer, make_handler

PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=")
# A genuine one-frame 16x16 H.264 MP4 generated once with ffmpeg. Tests need no encoder.
MP4 = base64.b64decode("AAAAJGZ0eXBpc29tAAACAGlzb21pc282aXNvMmF2YzFtcDQxAAAC7G1vb3YAAABsbXZoZAAAAAAAAAAAAAAAAAAAA+gAAAAAAAEAAAEAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAHvdHJhawAAAFx0a2hkAAAAAwAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAQAAAAAAQAAAAEAAAAAABi21kaWEAAAAgbWRoZAAAAAAAAAAAAAAAAAAAQAAAAAAAVcQAAAAAAC1oZGxyAAAAAAAAAAB2aWRlAAAAAAAAAAAAAAAAVmlkZW9IYW5kbGVyAAAAATZtaW5mAAAAFHZtaGQAAAABAAAAAAAAAAAAAAAkZGluZgAAABxkcmVmAAAAAAAAAAEAAAAMdXJsIAAAAAEAAAD2c3RibAAAAKpzdHNkAAAAAAAAAAEAAACaYXZjMQAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAQABAASAAAAEgAAAAAAAAAARRMYXZjNjMuMS4xMDIgbGlieDI2NAAAAAAAAAAAAAAAABj//wAAADRhdmNDAWQACv/hABdnZAAKrNlewEQAAAMABAAAAwAIPEiWWAEABmjr48siwP34+AAAAAAQcGFzcAAAAAEAAAABAAAAEHN0dHMAAAAAAAAAAAAAABBzdHNjAAAAAAAAAAAAAAAUc3RzegAAAAAAAAAAAAAAAAAAABBzdGNvAAAAAAAAAAAAAAAobXZleAAAACB0cmV4AAAAAAAAAAEAAAABAAAAAAAAAAAAAAAAAAAAYXVkdGEAAABZbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAsaWxzdAAAACSpdG9vAAAAHGRhdGEAAAABAAAAAExhdmY2My4xLjEwMgAAAHBtb29mAAAAEG1maGQAAAAAAAAAAQAAAFh0cmFmAAAAJHRmaGQAAAA5AAAAAQAAAAAAAAMQAABAAAAAAssBAQAAAAAAFHRmZHQBAAAAAAAAAAAAAAAAAAAYdHJ1bgAAAAUAAAABAAAAeAIAAAAAAALTbWRhdAAAAq0GBf//qdxF6b3m2Ui3lizYINkj7u94MjY0IC0gY29yZSAxNjUgcjMyMjMgMDQ4MGNiMCAtIEguMjY0L01QRUctNCBBVkMgY29kZWMgLSBDb3B5bGVmdCAyMDAzLTIwMjUgLSBodHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWwgLSBvcHRpb25zOiBjYWJhYz0xIHJlZj0zIGRlYmxvY2s9MTowOjAgYW5hbHlzZT0weDM6MHgxMTMgbWU9aGV4IHN1Ym1lPTcgcHN5PTEgcHN5X3JkPTEuMDA6MC4wMCBtaXhlZF9yZWY9MSBtZV9yYW5nZT0xNiBjaHJvbWFfbWU9MSB0cmVsbGlzPTEgOHg4ZGN0PTEgY3FtPTAgZGVhZHpvbmU9MjEsMTEgZmFzdF9wc2tpcD0xIGNocm9tYV9xcF9vZmZzZXQ9LTIgdGhyZWFkcz0xIGxvb2thaGVhZF90aHJlYWRzPTEgc2xpY2VkX3RocmVhZHM9MCBucj0wIGRlY2ltYXRlPTEgaW50ZXJsYWNlZD0wIGJsdXJheV9jb21wYXQ9MCBjb25zdHJhaW5lZF9pbnRyYT0wIGJmcmFtZXM9MyBiX3B5cmFtaWQ9MiBiX2FkYXB0PTEgYl9iaWFzPTAgZGlyZWN0PTEgd2VpZ2h0Yj0xIG9wZW5fZ29wPTAgd2VpZ2h0cD0yIGtleWludD0yNTAga2V5aW50X21pbj0xIHNjZW5lY3V0PTQwIGludHJhX3JlZnJlc2g9MCByY19sb29rYWhlYWQ9NDAgcmM9Y3JmIG1idHJlZT0xIGNyZj0yMy4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTE6MS4wMACAAAAAFmWIhAAV//7sz34FNyA8i/WUCHS1b4EAAABDbWZyYQAAACt0ZnJhAQAAAAAAAAEAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAxABAQEAAAAQbWZybwAAAAAAAABD")
PDF = b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"
TEXT = "# 阶段交付\n公开测试材料；不包含真实业务资料。\n".encode()


class Client:
    def __init__(self, port):
        self.port, self.cookie = port, ""

    def call(self, method, path, payload=None, *, raw=None, headers=None):
        body = json.dumps(payload, ensure_ascii=False).encode() if payload is not None else raw
        request_headers = {"Cookie": self.cookie, **({"Content-Type": "application/json"} if payload is not None else {}), **(headers or {})}
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=8)
        try:
            connection.request(method, path, body, request_headers)
            response = connection.getresponse()
            data, result_headers = response.read(), dict(response.getheaders())
            if response.getheader("Set-Cookie"):
                self.cookie = response.getheader("Set-Cookie").split(";", 1)[0]
            result = json.loads(data) if data and "application/json" in response.getheader("Content-Type", "") else data
            return response.status, result, result_headers
        finally:
            connection.close()

    def ok(self, method, path, payload=None, **kwargs):
        status, body, _ = self.call(method, path, payload, **kwargs)
        if status != 200:
            raise AssertionError(f"{method} {path.split('?')[0]} returned {status}: {body}")
        return body

    def action(self, kind, **fields):
        return self.ok("POST", "/api/action", {"type": kind, **fields})

    def state(self):
        return self.ok("GET", "/api/state")

    def board(self):
        return self.ok("GET", "/api/coordination")


class Host:
    def __init__(self, root):
        self.engine = Engine(Path(root) / "workspace.sqlite", adapter=DemoAdapter(), seed=False)
        self.auth = AuthStore(Path(root) / "auth.sqlite")
        handler = make_handler(self.engine, self.auth)
        handler.log_message = lambda *args: None
        self.server = HarnessHTTPServer(("127.0.0.1", 0), handler)
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True)
        self.thread.start()
        self.port, self.closed = self.server.server_address[1], False

    def close(self):
        if self.closed:
            return
        self.closed = True
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(2)
        self.engine.close()
        self.auth.close()


def verify_workboard():
    started = time.perf_counter()
    report = {"passed": False, "checks": [], "timings_seconds": {}, "scope": "temporary databases; real HTTP accounts; generated media; no production service"}
    def check(name, condition, **details):
        report["checks"].append({"name": name, "passed": bool(condition), **details})
        if not condition:
            raise AssertionError(name)
    try:
        with ExitStack() as stack:
            directory = stack.enter_context(tempfile.TemporaryDirectory(prefix="workboard-"))
            host = Host(directory)
            stack.callback(lambda: host.close())
            admin = Client(host.port)
            admin_user = admin.ok("POST", "/api/auth/setup", {"username": "board_admin", "display_name": "独立验收管理员", "password": secrets.token_urlsafe(24)})["user"]
            people, clients = {}, {"admin": admin}
            def employee(name):
                password = secrets.token_urlsafe(24)
                user = admin.ok("POST", "/api/auth/users", {"username": name, "display_name": name, "password": password})["user"]
                client = Client(host.port)
                client.ok("POST", "/api/auth/login", {"username": name, "password": password})
                content = "PRIVATE_EVIDENCE_" + name + "：仅用于临时能力核验。"
                state = client.action("import_document", title="能力证据", content=content, scope="personal")
                state = client.action("claim_capability", capability_id="data_analysis", level=3, description="测试能力", evidence_doc_id=state["documents"][-1]["id"], evidence_excerpt=content)
                admin.action("review_assessment", assessment_id=state["assessments"][-1]["id"], decision="verify", level=3, review_note="独立核对临时测试证据")
                admin.action("grant_permission", actor_id=user["actor_id"], capability_id="data_analysis", allowed=True)
                people[name], clients[name] = user, client
                return client
            alice, bob, carol = [employee(name) for name in ("board_alice", "board_bob", "board_carol")]
            guest = Client(host.port)
            steps = [{"key": key, "title": key, "capability_id": "data_analysis", "risk": "high", "depends_on": dependencies} for key, dependencies in (("source", []), ("guard", []), ("target", ["source", "guard"]), ("indirect", ["target"]), ("side", []))]
            state = admin.action("create_goal", title="资料交接端到端", brief="PRIVATE_GOAL_BRIEF", criteria="PRIVATE_CRITERIA", collaborative=True, steps=steps)
            goal_id = state["goals"][-1]["id"]
            ids = {task["key"]: task["id"] for task in state["tasks"] if task["goal_id"] == goal_id}
            def task(key):
                return next(t for t in admin.state()["tasks"] if t["id"] == ids[key])
            def act(client, kind, key, **fields):
                current = task(key)
                return client.action(kind, task_id=current["id"], expected_version=current["version"], **fields)
            for key, name in (("source", "board_alice"), ("side", "board_alice"), ("guard", "board_carol"), ("target", "board_bob"), ("indirect", "board_carol")):
                act(admin, "assign_task", key, actor_id=people[name]["actor_id"])
            for key, client in (("source", alice), ("side", alice), ("guard", carol)):
                act(client, "accept_task", key)
                act(client, "start_task", key)

            def upload(client, key, name, content, **extra):
                current = task(key)
                path = "/api/tasks/" + current["id"] + "/attachments?" + urlencode({"expected_version": current["version"], "filename": name})
                return client.call("POST", path, raw=content, headers={"Content-Type": "application/octet-stream", **extra})
            def publish(client, key, attachments=(), **extra):
                current = task(key)
                return client.action("publish_work_update", task_id=current["id"], expected_version=current["version"], direction="落实交付要求", stage="阶段进展", progress=100 if current["status"] == "completed" else 45, summary="公开进度摘要", next_step="核对材料并交给下一位", needs="请接收人核对版本", attachment_ids=list(attachments), **extra)
            def publish_payload(key, file_ids=(), version=None):
                current = task(key)
                return {"type": "publish_work_update", "task_id": current["id"], "expected_version": current["version"] if version is None else version, "direction": "明确任务方向", "stage": "本轮产物", "progress": 100 if current["status"] == "completed" else 60, "summary": "公开测试成果", "next_step": "接收人核对", "needs": "暂无", "attachment_ids": list(file_ids)}
            def content_path(attachment):
                return "/api/attachments/" + attachment["id"] + "/content"
            fixtures = (("测试图片.png", PNG, "image/png"), ("测试视频.mp4", MP4, "video/mp4"), ("交付说明.pdf", PDF, "application/pdf"), ("阶段说明.md", TEXT, "text/plain; charset=utf-8"))
            materials = []
            for name, data, mime in fixtures:
                status, result, _ = upload(alice, "source", name, data)
                check("upload_" + name.rsplit(".", 1)[-1], status == 200 and result["attachment"]["sha256"] == hashlib.sha256(data).hexdigest() and result["attachment"]["mime"] == mime)
                materials.append(result["attachment"])
            private = materials[0]
            path = content_path(private)
            check("staged_upload_only_uploader_can_read", alice.call("GET", path)[1] == PNG and all(c.call("GET", path)[0] == 404 for c in (admin, bob, carol)))
            check("anonymous_upload_download_and_head_require_login", upload(guest, "source", "a.png", PNG)[0] == 401 and guest.call("GET", path)[0] == 401 and guest.call("HEAD", path)[0] == 401)
            check("staged_metadata_hidden_from_public_board", all(not c.board()["attachments"] for c in (admin, alice, bob, carol)))
            check("wrong_employee_cannot_upload", upload(bob, "source", "wrong.png", PNG)[0] == 403)
            invalid = [("bad.png", b"plain text"), ("bad.svg", b"<svg/>"), ("../escape.txt", b"x"), ("bad\r\nHeader.txt", b"x"), ("binary.txt", b"\xff\x00")]
            check("invalid_signature_filename_and_active_content_rejected", all(upload(alice, "source", name, data)[0] == 400 for name, data in invalid))
            check("oversize_body_rejected_before_read", upload(alice, "source", "huge.mp4", b"x", **{"Content-Length": str(32 * 1024 * 1024 + 1)})[0] == 413)
            other = upload(alice, "side", "other.txt", b"OTHER_TASK_CONTENT")[1]["attachment"]
            before = admin.board()
            wrong = alice.call("POST", "/api/action", publish_payload("source", [other["id"]]))
            check("cross_task_attachment_rejected_without_mutation", wrong[0] == 403 and admin.board() == before and carol.call("GET", content_path(other))[0] == 404)

            fault_file = upload(alice, "source", "atomic.txt", b"PUBLISH_ATOMICITY")[1]["attachment"]
            before = admin.board()
            payload = publish_payload("source", [fault_file["id"]])
            with patch.object(host.engine, "_save", side_effect=sqlite3.OperationalError("injected checkpoint failure")):
                failed = alice.call("POST", "/api/action", payload)
            check("failed_persistence_does_not_publish_blob_or_update", failed[0] == 500 and admin.board() == before and carol.call("GET", content_path(fault_file))[0] == 404)
            alice.ok("POST", "/api/action", payload)
            check("publication_can_retry_after_storage_failure", carol.call("GET", content_path(fault_file))[1] == b"PUBLISH_ATOMICITY")
            hidden = upload(alice, "source", "stale.txt", b"STALE_PRIVATE_BLOB")[1]["attachment"]
            stale_version = task("source")["version"]
            publish(alice, "source", [materials[0]["id"]])
            stale = alice.call("POST", "/api/action", publish_payload("source", [hidden["id"]], stale_version))
            check("stale_publication_never_exposes_staged_blob", stale[0] == 409 and carol.call("GET", content_path(hidden))[0] == 404)
            race_files = [upload(alice, "source", f"race{i}.txt", str(i).encode())[1]["attachment"] for i in range(2)]
            common_version = task("source")["version"]
            payloads = [publish_payload("source", [a["id"]], common_version) for a in race_files]
            with ThreadPoolExecutor(max_workers=2) as pool:
                race_results = list(pool.map(lambda p: alice.call("POST", "/api/action", p), payloads))
            visible = [carol.call("GET", content_path(a))[0] for a in race_files]
            check("same_version_publication_has_one_winner", sorted(r[0] for r in race_results) == [200, 409] and sorted(visible) == [200, 404])
            publish(alice, "source", [a["id"] for a in materials])
            check("published_materials_visible_to_all_accounts", all(c.call("GET", content_path(a))[1] == f[1] for c in (admin, alice, bob, carol) for a, f in zip(materials, fixtures)))
            for attachment, (_, data, mime) in zip(materials, fixtures):
                status, body, headers = bob.call("GET", content_path(attachment))
                check("binary_content_and_headers_" + attachment["kind"] + "_" + str(len(data)), status == 200 and body == data and headers["Content-Type"] == mime and headers["X-Content-Type-Options"] == "nosniff" and headers["Cache-Control"] == "no-store")
            video_path = content_path(materials[1])
            ranged = bob.call("GET", video_path, headers={"Range": "bytes=3-27"})
            suffix = bob.call("GET", video_path, headers={"Range": "bytes=-9"})
            tail = bob.call("GET", video_path, headers={"Range": "bytes=20-"})
            head = bob.call("HEAD", video_path, headers={"Range": "bytes=3-27"})
            invalid_ranges = [bob.call("GET", video_path, headers={"Range": r})[0] for r in ("bytes=999999-", "bytes=8-3", "bytes=0-1,4-5", "bytes=-0")]
            check("video_ranges_and_head_are_byte_exact", ranged[0] == 206 and ranged[1] == MP4[3:28] and ranged[2]["Content-Range"] == f"bytes 3-27/{len(MP4)}" and suffix[1] == MP4[-9:] and tail[1] == MP4[20:] and head[0] == 206 and head[1] == b"" and head[2]["Content-Length"] == "25" and invalid_ranges == [416] * 4)
            check("download_uses_safe_filename_and_disposition", "attachment;" in bob.call("GET", video_path + "?download=1")[2]["Content-Disposition"] and "filename*=UTF-8''" in bob.call("GET", video_path)[2]["Content-Disposition"])

            update = admin.board()["work_updates"][-1]
            def handoff_payload(update_id=update["id"], target="target"):
                current = task("source")
                return {"type": "create_handoff", "task_id": current["id"], "expected_version": current["version"], "update_id": update_id, "to_task_id": ids[target], "note": "请确认收到资料，不代表业务验收。"}
            check("incomplete_source_cannot_handoff", alice.call("POST", "/api/action", handoff_payload())[0] == 403)
            act(alice, "submit_task", "source", output="PRIVATE_SUBMISSION_V1")
            check("submitter_cannot_self_review", alice.call("POST", "/api/action", {"type": "review_task", "task_id": ids["source"], "expected_version": task("source")["version"], "approved": True, "feedback": "不能自审"})[0] == 403)
            act(admin, "review_task", "source", approved=False, feedback="PRIVATE_REJECTION_REASON")
            act(alice, "submit_task", "source", output="PRIVATE_APPROVED_DELIVERY_V2")
            act(admin, "review_task", "source", approved=True, feedback="PRIVATE_ACCEPT_REASON")
            source_before = task("source")
            publish(alice, "source", [a["id"] for a in materials])
            check("completed_publication_does_not_reopen_task", task("source")["status"] == "completed" and task("source")["progress"] == 100 and task("source")["artifacts"] == source_before["artifacts"])
            public_json = json.dumps(carol.board(), ensure_ascii=False)
            check("private_submissions_and_feedback_never_auto_publish", not any(marker in public_json for marker in ("PRIVATE_SUBMISSION_V1", "PRIVATE_APPROVED_DELIVERY_V2", "PRIVATE_REJECTION_REASON", "PRIVATE_ACCEPT_REASON", "PRIVATE_EVIDENCE_", "PRIVATE_GOAL_BRIEF")))
            admin_file = upload(admin, "source", "admin.txt", b"MANAGER_STAGED_FILE")[1]["attachment"]
            check("same_task_other_uploader_cannot_be_referenced", alice.call("POST", "/api/action", publish_payload("source", [admin_file["id"]]))[0] == 403)
            check("handoff_must_target_direct_human_successor", alice.call("POST", "/api/action", handoff_payload(target="side"))[0] == 403 and alice.call("POST", "/api/action", handoff_payload(target="indirect"))[0] == 403)
            alice.ok("POST", "/api/action", handoff_payload())
            handoff = admin.board()["handoffs"][-1]
            response_payload = {"type": "respond_handoff", "handoff_id": handoff["id"], "expected_version": handoff["version"], "decision": "return", "reply": "请补充版本说明"}
            check("handoff_response_requires_designated_receiver", all(c.call("POST", "/api/action", response_payload)[0] == 403 for c in (admin, alice, carol)))
            target_before = task("target")
            bob.ok("POST", "/api/action", response_payload)
            check("return_only_changes_receipt_not_task", admin.board()["handoffs"][-1]["status"] == "returned" and task("target") == target_before and task("source")["status"] == "completed")
            alice.ok("POST", "/api/action", handoff_payload())
            resent = admin.board()["handoffs"][-1]
            response_payload = {**response_payload, "handoff_id": resent["id"], "expected_version": resent["version"], "decision": "accept", "reply": "已收到资料，后续任务另行接取和验收"}
            bob.ok("POST", "/api/action", response_payload)
            check("receipt_accept_does_not_bypass_dependencies_or_review", task("target") == target_before and admin.board()["handoffs"][-1]["status"] == "accepted" and bob.call("POST", "/api/action", {"type": "accept_task", "task_id": ids["target"], "expected_version": task("target")["version"]})[0] == 403)
            check("duplicate_handoff_response_is_conflict", bob.call("POST", "/api/action", response_payload)[0] == 409)

            publish(alice, "source", [materials[0]["id"]])
            fresh_update = admin.board()["work_updates"][-1]["id"]
            alice.ok("POST", "/api/action", handoff_payload(fresh_update))
            invalidated = admin.board()["handoffs"][-1]
            act(admin, "assign_task", "target", actor_id=people["board_carol"]["actor_id"])
            old_response = {"type": "respond_handoff", "handoff_id": invalidated["id"], "expected_version": invalidated["version"], "decision": "accept", "reply": "旧接收人不可签收"}
            invalidated_projection = next(h for h in admin.board()["handoffs"] if h["id"] == invalidated["id"])
            check("reassignment_invalidates_old_handoff_receiver", bob.call("POST", "/api/action", old_response)[0] == 403 and carol.call("POST", "/api/action", old_response)[0] == 403 and bool(invalidated_projection["invalid_reason"]))
            alice.ok("POST", "/api/action", handoff_payload(fresh_update))
            redirected = admin.board()["handoffs"][-1]
            carol.ok("POST", "/api/action", {**old_response, "handoff_id": redirected["id"], "expected_version": redirected["version"]})
            check("same_update_can_be_resent_after_reassignment", redirected["to_actor_id"] == people["board_carol"]["actor_id"] and admin.board()["handoffs"][-1]["status"] == "accepted")
            publish(alice, "source", [materials[0]["id"]])
            fresh_update = admin.board()["work_updates"][-1]["id"]
            alice.ok("POST", "/api/action", handoff_payload(fresh_update))
            invalidated = admin.board()["handoffs"][-1]
            # Recovery fixture: a pending receipt refers to a prior accepted
            # artifact; the HTTP guard must reject it after artifact revision.
            with host.engine.lock:
                source = next(t for t in host.engine.state["tasks"] if t["id"] == ids["source"])
                source["artifacts"][-1]["id"] = "recovered_newer_artifact"
                host.engine._save()
            stale_artifact_response = {**old_response, "handoff_id": invalidated["id"], "expected_version": invalidated["version"]}
            check("revised_source_artifact_invalidates_old_receipt", carol.call("POST", "/api/action", stale_artifact_response)[0] == 403)
            alice.ok("POST", "/api/action", handoff_payload(fresh_update))
            renewed = admin.board()["handoffs"][-1]
            carol.ok("POST", "/api/action", {**old_response, "handoff_id": renewed["id"], "expected_version": renewed["version"]})
            check("same_update_can_be_resent_after_artifact_revision", renewed["source_artifact_id"] == "recovered_newer_artifact" and admin.board()["handoffs"][-1]["status"] == "accepted")

            # Extend the actual HTTP accounts to twelve workers and publish on
            # different tasks concurrently, avoiding a repeated single-user demo.
            for index in range(9):
                employee(f"board_worker_{index:02}")
            worker_names = list(people)
            parallel = admin.action("create_goal", title="12人并发阶段记录", criteria="每人独立发布", collaborative=True, steps=[{"key": f"job{i}", "title": f"独立工作{i}", "capability_id": "data_analysis", "risk": "high"} for i in range(12)])
            parallel_goal = parallel["goals"][-1]["id"]
            parallel_tasks = [t for t in parallel["tasks"] if t["goal_id"] == parallel_goal]
            def prepare(index):
                who, current = clients[worker_names[index]], parallel_tasks[index]
                state = admin.action("assign_task", task_id=current["id"], expected_version=current["version"], actor_id=people[worker_names[index]]["actor_id"])
                current = next(t for t in state["tasks"] if t["id"] == current["id"])
                for kind in ("accept_task", "start_task"):
                    state = who.action(kind, task_id=current["id"], expected_version=current["version"])
                    current = next(t for t in state["tasks"] if t["id"] == current["id"])
                return who, current
            with ThreadPoolExecutor(max_workers=12) as pool:
                ready = list(pool.map(prepare, range(12)))
            tick = time.perf_counter()
            def publish_parallel(index):
                who, current = ready[index]
                return who.action("publish_work_update", task_id=current["id"], expected_version=current["version"], direction=f"工作方向{index}", stage="处理中", progress=30 + index, summary=f"独立进展{index}", next_step="继续处理", needs="暂无", attachment_ids=[])
            with ThreadPoolExecutor(max_workers=12) as pool:
                list(pool.map(publish_parallel, range(12)))
            report["timings_seconds"]["twelve_parallel_publications"] = round(time.perf_counter() - tick, 6)
            board = admin.board()
            parallel_updates = [u for u in board["work_updates"] if u["goal_id"] == parallel_goal]
            check("twelve_employees_publish_without_lost_updates", len(parallel_updates) == 12 and len({u["user_id"] for u in parallel_updates}) == 12 and {u["progress"] for u in parallel_updates} == set(range(30, 42)))
            shared = [(c.board()["work_updates"], c.board()["attachments"]) for c in (admin, alice, bob, carol)]
            check("four_accounts_observe_same_public_records", all(value == shared[0] for value in shared[1:]))
            before_boards = {name: client.board() for name, client in clients.items()}
            host.close()
            host = Host(directory)
            for client in list(clients.values()) + [guest]:
                client.port = host.port
            check("restart_preserves_blobs_updates_handoffs_and_sessions", all(client.board() == before_boards[name] for name, client in clients.items()) and all(bob.call("GET", content_path(a))[1] == f[1] for a, f in zip(materials, fixtures)))
            check("staged_blob_remains_private_after_restart", alice.call("GET", content_path(hidden))[1] == b"STALE_PRIVATE_BLOB" and bob.call("GET", content_path(hidden))[0] == 404)
            report["accounts"] = len(clients)
            report["passed"] = True
    except Exception as error:
        report["error"] = f"{type(error).__name__}: {error}"
    report["elapsed_seconds"] = round(time.perf_counter() - started, 6)
    return report


class WorkboardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.report = verify_workboard()
        cls.results = {item["name"]: item for item in cls.report["checks"]}

    def checked(self, *names):
        for name in names:
            item = self.results.get(name)
            self.assertIsNotNone(item, self.report.get("error", name))
            self.assertTrue(item["passed"], item)

    def test_real_files_upload_and_private_staging(self):
        self.checked("upload_png", "upload_mp4", "upload_pdf", "upload_md", "staged_upload_only_uploader_can_read", "staged_metadata_hidden_from_public_board")

    def test_authentication_validation_and_attachment_ownership(self):
        self.checked("anonymous_upload_download_and_head_require_login", "wrong_employee_cannot_upload", "invalid_signature_filename_and_active_content_rejected", "oversize_body_rejected_before_read", "cross_task_attachment_rejected_without_mutation", "same_task_other_uploader_cannot_be_referenced")

    def test_failed_transactions_and_stale_versions_do_not_publish(self):
        self.checked("failed_persistence_does_not_publish_blob_or_update", "publication_can_retry_after_storage_failure", "stale_publication_never_exposes_staged_blob", "same_version_publication_has_one_winner")

    def test_public_material_bytes_video_ranges_and_headers(self):
        self.checked("published_materials_visible_to_all_accounts", "video_ranges_and_head_are_byte_exact", "download_uses_safe_filename_and_disposition")

    def test_private_delivery_and_self_review_remain_separate(self):
        self.checked("private_submissions_and_feedback_never_auto_publish", "submitter_cannot_self_review", "completed_publication_does_not_reopen_task")

    def test_handoff_return_resend_and_receipt_only_semantics(self):
        self.checked("incomplete_source_cannot_handoff", "handoff_must_target_direct_human_successor", "handoff_response_requires_designated_receiver", "return_only_changes_receipt_not_task", "receipt_accept_does_not_bypass_dependencies_or_review", "duplicate_handoff_response_is_conflict")

    def test_reassignment_and_revised_artifact_invalidate_old_receipt(self):
        self.checked("reassignment_invalidates_old_handoff_receiver", "revised_source_artifact_invalidates_old_receipt", "same_update_can_be_resent_after_reassignment", "same_update_can_be_resent_after_artifact_revision")

    def test_parallel_publication_and_restart_persistence(self):
        self.checked("twelve_employees_publish_without_lost_updates", "four_accounts_observe_same_public_records", "restart_preserves_blobs_updates_handoffs_and_sessions", "staged_blob_remains_private_after_restart")
        self.assertTrue(self.report["passed"], self.report.get("error"))


if __name__ == "__main__":
    unittest.main()
