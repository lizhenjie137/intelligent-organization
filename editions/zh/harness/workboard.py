"""Public work updates, immutable uploaded materials, and receipt-only handoffs.

Binary files live in a separate SQLite table. A file becomes organization-visible
only when the transactional checkpoint references it in a published work update.
"""

from copy import deepcopy
from datetime import datetime, timezone
import hashlib
from pathlib import PurePosixPath
from uuid import uuid4


MAX_FILE_BYTES = 32 * 1024 * 1024
_FILE_COLUMNS = ("id", "task_id", "uploader_id", "name", "mime", "kind", "size", "sha256", "created_at")


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def _id(prefix):
    return prefix + "_" + uuid4().hex


def _file_type(name, data):
    suffix = PurePosixPath(name).suffix.lower()
    if suffix == ".png" and data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png", "image"
    if suffix in (".jpg", ".jpeg") and data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg", "image"
    if suffix == ".gif" and data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif", "image"
    if suffix == ".webp" and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp", "image"
    if suffix == ".mp4" and len(data) >= 16 and data[4:8] == b"ftyp":
        return "video/mp4", "video"
    if suffix == ".webm" and data.startswith(b"\x1a\x45\xdf\xa3") and b"webm" in data[:4096]:
        return "video/webm", "video"
    if suffix == ".pdf" and data.startswith(b"%PDF-"):
        return "application/pdf", "file"
    office = {".zip": "application/zip",
              ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation"}
    if suffix in office and data[:4] in (b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08"):
        return office[suffix], "file"
    if suffix in (".txt", ".md", ".csv", ".json"):
        try:
            text = data.decode("utf-8-sig")
            if "\x00" not in text:
                return "text/plain; charset=utf-8", "file"
        except UnicodeDecodeError:
            pass
    raise ValueError("文件类型或文件签名不支持；可上传 PNG/JPG/GIF/WebP、MP4/WebM、PDF、UTF-8 文本、ZIP 或现代 Office 文件")


class Workboard:
    def __init__(self, engine):
        self.engine = engine
        engine.state.setdefault("work_updates", [])
        engine.state.setdefault("handoffs", [])
        engine.db.execute("""CREATE TABLE IF NOT EXISTS work_files (
            id TEXT PRIMARY KEY, task_id TEXT NOT NULL, uploader_id TEXT NOT NULL,
            name TEXT NOT NULL, mime TEXT NOT NULL, kind TEXT NOT NULL,
            size INTEGER NOT NULL, sha256 TEXT NOT NULL, created_at TEXT NOT NULL,
            data BLOB NOT NULL)""")

    def _identity(self, principal):
        self.engine._validate_principal(principal)
        if principal is None:
            raise PermissionError("请先登录员工账号")

    def can_publish(self, task, principal):
        if principal is None:
            return False
        e = self.engine
        goal = e._find("goals", task["goal_id"])
        if goal["status"] == "paused":
            return False
        actor = next((a for a in e.state["actors"] if a["id"] == task["actor_id"]), None)
        assignee = bool(actor and actor["type"] == "human" and task["actor_id"] == principal["actor_id"]
                        and e._actor_eligible(actor, task))
        if task["status"] == "completed":
            return bool(assignee or e._can_manage(goal, principal))
        return bool(assignee and task["work_status"] == "in_progress"
                    and e._task_flags(task, goal, principal)["can_update"])

    def _targets(self, source):
        e = self.engine
        result = []
        for target in e.state["tasks"]:
            if source["id"] not in target["depends_on"] or target["goal_id"] != source["goal_id"] or target["status"] == "completed":
                continue
            goal = e._find("goals", target["goal_id"])
            actor = next((a for a in e.state["actors"] if a["id"] == target["actor_id"]), None)
            if (goal["status"] != "paused" and actor and actor["type"] == "human"
                    and actor.get("user_id") and e._actor_eligible(actor, target)):
                result.append(target)
        return result

    def can_handoff(self, task, principal):
        return bool(task["status"] == "completed" and self.can_publish(task, principal) and self._targets(task)
                    and any(u["task_id"] == task["id"] for u in self.engine.state["work_updates"]))

    def _published_ids(self):
        return {identifier for update in self.engine.state["work_updates"] for identifier in update["attachment_ids"]}

    def _file(self, identifier):
        row = self.engine.db.execute("SELECT " + ",".join(_FILE_COLUMNS) + " FROM work_files WHERE id=?", (identifier,)).fetchone()
        if row is None:
            raise KeyError("附件不存在或不可访问")
        return dict(zip(_FILE_COLUMNS, row))

    @staticmethod
    def _metadata(row, published):
        value = {k: row[k] for k in ("id", "task_id", "name", "mime", "kind", "size", "sha256", "created_at")}
        url = "/api/attachments/" + row["id"] + "/content"
        value.update(preview_url=url if row["kind"] in ("image", "video") else None,
                     download_url=url + "?download=1", published=published,
                     public_scope="organization" if published else "uploader")
        return value

    def upload(self, task_id, expected_version, name, data, principal):
        if not isinstance(data, bytes) or not 0 < len(data) <= MAX_FILE_BYTES:
            raise ValueError("附件必须非空且不超过 32 MiB")
        if (not isinstance(name, str) or not name.strip() or len(name) > 180
                or any(ord(c) < 32 for c in name) or "/" in name or "\\" in name or name in (".", "..")):
            raise ValueError("文件名无效；请使用不含路径或控制字符的文件名")
        mime, kind = _file_type(name, data)
        e = self.engine
        with e.lock:
            self._identity(principal)
            task = e._find("tasks", task_id)
            e._expect_version(task, {"expected_version": expected_version})
            if not self.can_publish(task, principal):
                raise PermissionError("当前账号或任务阶段不允许上传阶段成果")
            row = {"id": _id("file"), "task_id": task_id, "uploader_id": principal["id"],
                   "name": name.strip(), "mime": mime, "kind": kind, "size": len(data),
                   "sha256": hashlib.sha256(data).hexdigest(), "created_at": _now()}
            with e.db:
                e.db.execute("INSERT INTO work_files (" + ",".join(_FILE_COLUMNS) + ",data) VALUES (?,?,?,?,?,?,?,?,?,?)",
                             (*[row[k] for k in _FILE_COLUMNS], data))
            return self._metadata(row, False)

    def check_upload(self, task_id, expected_version, principal):
        """Authorize before the server reads the binary request body."""
        e = self.engine
        with e.lock:
            self._identity(principal)
            task = e._find("tasks", task_id)
            e._expect_version(task, {"expected_version": expected_version})
            if not self.can_publish(task, principal):
                raise PermissionError("当前账号或任务阶段不允许上传阶段成果")

    def metadata(self, identifier, principal):
        e = self.engine
        with e.lock:
            self._identity(principal)
            row = self._file(identifier)
            published = identifier in self._published_ids()
            if not published and row["uploader_id"] != principal["id"]:
                raise KeyError("附件不存在或不可访问")
            return self._metadata(row, published)

    def content(self, identifier, principal, start=0, length=None):
        e = self.engine
        with e.lock:
            metadata = self.metadata(identifier, principal)
            length = metadata["size"] - start if length is None else length
            if type(start) is not int or type(length) is not int or start < 0 or length < 0 or start + length > metadata["size"]:
                raise ValueError("附件字节范围无效")
            return e.db.execute("SELECT substr(data, ?, ?) FROM work_files WHERE id=?", (start + 1, length, identifier)).fetchone()[0]

    def publish(self, payload):
        e = self.engine
        principal = e._require_identity()
        task = e._find("tasks", payload.get("task_id"))
        e._expect_version(task, payload)
        if not self.can_publish(task, principal):
            raise PermissionError("只有当前执行者可发布工作中的进度；已完成成果可由合资格执行者或负责人发布")
        progress = payload.get("progress")
        if type(progress) is not int or (task["status"] == "completed" and progress != 100) or (task["status"] != "completed" and not 0 <= progress <= 99):
            raise ValueError("进行中自报进度必须为 0–99；已完成任务的成果进度为 100")
        update = {"id": _id("update"), "task_id": task["id"], "goal_id": task["goal_id"],
                  "direction": e._text(payload, "direction", limit=500), "stage": e._text(payload, "stage", limit=80),
                  "summary": e._text(payload, "summary", limit=4000), "next_step": e._text(payload, "next_step", limit=2000),
                  "needs": e._text(payload, "needs", required=False, limit=2000), "progress": progress,
                  "user_id": principal["id"], "actor_id": principal["actor_id"],
                  "actor_name": principal.get("display_name") or principal.get("username"), "created_at": _now()}
        ids = payload.get("attachment_ids", [])
        if not isinstance(ids, list) or len(ids) > 10 or any(not isinstance(i, str) for i in ids) or len(set(ids)) != len(ids):
            raise ValueError("每次发布最多引用 10 个不重复的附件 ID")
        for identifier in ids:
            row = self._file(identifier)
            if row["task_id"] != task["id"] or row["uploader_id"] != principal["id"]:
                raise PermissionError("只能发布本账号为当前任务上传的附件")
        update["attachment_ids"] = list(ids)
        e._touch_task(task, "work_update_published", "发布组织可见工作动态：" + update["stage"], progress=progress,
                      note=update["summary"][:2000])
        update["version"] = task["version"]
        e.state["work_updates"].append(update)
        if task["status"] != "completed":
            e._refresh(e._find("goals", task["goal_id"]))

    @staticmethod
    def _artifact_id(task):
        artifacts = task.get("artifacts", [])
        return artifacts[-1]["id"] if artifacts else None

    def create_handoff(self, payload):
        e = self.engine
        principal = e._require_identity()
        source = e._find("tasks", payload.get("task_id"))
        e._expect_version(source, payload)
        if not self.can_handoff(source, principal):
            raise PermissionError("交接需要已完成且已发布的源任务，并指定已分派真实员工的直接后续任务")
        target = e._find("tasks", payload.get("to_task_id"))
        if target not in self._targets(source):
            raise PermissionError("接收任务必须是源任务的直接后续任务，且已分派合资格的真实员工")
        update = e._find("work_updates", payload.get("update_id"))
        if update["task_id"] != source["id"]:
            raise PermissionError("交接资料必须来自当前源任务已发布的工作动态")
        source_artifact_id = self._artifact_id(source)
        if any(h["task_id"] == source["id"] and h["to_task_id"] == target["id"] and h["update_snapshot"]["id"] == update["id"]
               and h["source_artifact_id"] == source_artifact_id and h["to_actor_id"] == target["actor_id"]
               and h["status"] in ("pending", "accepted") and not self._invalid_reason(h)
               for h in e.state["handoffs"]):
            raise ValueError("这份资料已交接给该后续任务；可发布新的成果后再创建交接")
        handoff = {"id": _id("handoff"), "task_id": source["id"], "goal_id": source["goal_id"],
                   "to_task_id": target["id"], "from_actor_id": principal["actor_id"], "from_user_id": principal["id"],
                   "to_actor_id": target["actor_id"], "status": "pending", "update_snapshot": deepcopy(update),
                   "source_artifact_id": source_artifact_id, "note": e._text(payload, "note", limit=2000),
                   "reply": "", "version": 1, "created_at": _now(), "responded_at": None}
        e.state["handoffs"].append(handoff)
        receiver = e._find("actors", target["actor_id"])
        e._touch_task(source, "handoff_sent", "成果资料已交接给 " + receiver["name"] + "，等待确认接收")

    def can_respond(self, handoff, principal):
        if principal is None or handoff["status"] != "pending" or handoff["to_actor_id"] != principal["actor_id"]:
            return False
        return not self._invalid_reason(handoff)

    def _invalid_reason(self, handoff):
        e = self.engine
        source = e._find("tasks", handoff["task_id"])
        target = e._find("tasks", handoff["to_task_id"])
        if source["status"] != "completed":
            return "源任务已返工或尚未完成，此交接暂不可接收；请完成后重新交接。"
        if self._artifact_id(source) != handoff["source_artifact_id"]:
            return "源成果版本已更新，此交接属于旧版本；请重新交接。"
        if target["actor_id"] != handoff["to_actor_id"]:
            return "后续任务已改派，此交接的接收人已失效；请向当前执行者重新交接。"
        if target["status"] == "completed":
            return "接收任务已完成，无需继续接收此交接。"
        if e._find("goals", target["goal_id"])["status"] == "paused":
            return "目标已暂停；恢复后可继续处理交接。"
        if target not in self._targets(source):
            return "接收人当前不可用或不再具备所需授权，请负责人检查分派。"
        return ""

    def respond_handoff(self, payload):
        e = self.engine
        principal = e._require_identity()
        handoff = e._find("handoffs", payload.get("handoff_id"))
        e._expect_version(handoff, payload)
        if not self.can_respond(handoff, principal):
            raise PermissionError("只有仍被指派的接收员工可回应有效的待接收交接；源成果返工或任务改派后请重新交接")
        decision = payload.get("decision")
        if decision not in ("accept", "return"):
            raise ValueError("decision 必须是 accept 或 return")
        handoff["reply"] = e._text(payload, "reply", limit=2000)
        handoff["status"] = "accepted" if decision == "accept" else "returned"
        handoff["responded_at"] = _now()
        handoff["version"] += 1
        source = e._find("tasks", handoff["task_id"])
        e._touch_task(source, "handoff_accepted" if decision == "accept" else "handoff_returned",
                      "接收人确认收到交接资料（不代表任务验收）" if decision == "accept" else "接收人退回交接资料（任务审核状态不变）")

    def projection(self, principal):
        e = self.engine
        public_ids = self._published_ids()
        files = {identifier: self._metadata(self._file(identifier), True) for identifier in public_ids}
        updates = []
        for original in e.state["work_updates"]:
            update = deepcopy(original)
            update["attachments"] = [files[i] for i in update["attachment_ids"]]
            update["author_actor_id"], update["author_name"] = update["actor_id"], update["actor_name"]
            updates.append(update)
        handoffs = []
        for original in e.state["handoffs"]:
            handoff = deepcopy(original)
            allowed = self.can_respond(original, principal)
            handoff.update(can_accept=allowed, can_return=allowed,
                           invalid_reason=self._invalid_reason(original) if original["status"] == "pending" else "",
                           from_actor_name=e._find("actors", original["from_actor_id"])["name"],
                           to_actor_name=e._find("actors", original["to_actor_id"])["name"])
            snapshot = handoff["update_snapshot"]
            snapshot["attachments"] = [files[i] for i in snapshot["attachment_ids"]]
            handoffs.append(handoff)
        return {"work_updates": updates, "attachments": list(files.values()), "handoffs": handoffs}
