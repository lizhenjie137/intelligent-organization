"""Local, dependency-free HTTP host for the organization Harness."""
from __future__ import annotations

import argparse
import json
import mimetypes
import re
import sys
import threading
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse

from harness.engine import Engine, VersionConflict
from harness.workboard import MAX_FILE_BYTES
from harness.runtime import build_runtime_adapter, runtime_status
from harness.model_settings import RuntimeManager, ModelConfigConflict, ModelSettingsError
from auth import AuthStore, AuthError, COOKIE, SESSION_SECONDS

ROOT = Path(__file__).resolve().parent
MAX_BODY = 1024 * 1024


class HarnessHTTPServer(ThreadingHTTPServer):
    """One shared process with enough pending connections for a small team."""

    request_queue_size = 128
    daemon_threads = True


def make_handler(engine: Engine, auth: AuthStore, model_settings=None):
    upload_slots = threading.BoundedSemaphore(2)

    class Handler(BaseHTTPRequestHandler):
        server_version = "OrganizationHarness/0.4"

        def log_message(self, fmt, *args):
            # Request bodies and model credentials are deliberately never logged.
            super().log_message(fmt, *args)

        def valid_host(self):
            port = self.server.server_address[1]
            return self.headers.get("Host") in (f"127.0.0.1:{port}", f"localhost:{port}")

        def send_bytes(self, status, content, content_type, cookie=None, download_name=None):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(content)))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Referrer-Policy", "no-referrer")
            if cookie:
                self.send_header("Set-Cookie", cookie)
            if download_name:
                self.send_header("Content-Disposition", f'attachment; filename="{download_name}"')
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
            self.end_headers()
            if not getattr(self, "_head_only", False):
                self.wfile.write(content)

        def do_HEAD(self):
            self._head_only = True
            self.do_GET()

        def serve_attachment(self, identifier, principal):
            if not identifier or "/" in identifier:
                return self.json(404, {"error": "附件不存在或不可访问"})
            try:
                metadata = engine.workboard.metadata(identifier, principal)
                size = metadata["size"]
                start, end, status = 0, size - 1, 200
                range_value = self.headers.get("Range")
                if range_value:
                    match = re.fullmatch(r"bytes=(\d*)-(\d*)", range_value.strip())
                    if match is None or not any(match.groups()):
                        raise ValueError("invalid range")
                    left, right = match.groups()
                    if not left:
                        suffix = int(right)
                        if suffix <= 0:
                            raise ValueError("invalid range")
                        start = max(0, size - suffix)
                    else:
                        start = int(left)
                        end = min(size - 1, int(right)) if right else size - 1
                    if start >= size or end < start:
                        raise ValueError("invalid range")
                    status = 206
                length = end - start + 1
                content = b"" if getattr(self, "_head_only", False) else engine.workboard.content(identifier, principal, start, length)
            except (KeyError, PermissionError):
                return self.json(404, {"error": "附件不存在或不可访问"})
            except ValueError:
                self.send_response(416)
                self.send_header("Content-Range", "bytes */" + str(size))
                self.send_header("Content-Length", "0")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                return
            download = parse_qs(urlparse(self.path).query).get("download") == ["1"]
            inline = metadata["kind"] in ("image", "video") and not download
            suffix = Path(metadata["name"]).suffix.lower()
            disposition = ("inline" if inline else "attachment") + f'; filename="{identifier}{suffix}"; filename*=UTF-8\'\'' + quote(metadata["name"], safe="")
            self.send_response(status)
            self.send_header("Content-Type", metadata["mime"])
            self.send_header("Content-Length", str(length))
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Disposition", disposition)
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy", "default-src 'none'; sandbox")
            if status == 206:
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.end_headers()
            if not getattr(self, "_head_only", False):
                self.wfile.write(content)

        def json(self, status, payload, cookie=None):
            self.send_bytes(status, json.dumps(payload, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8", cookie)

        def token(self):
            try:
                jar = SimpleCookie(self.headers.get("Cookie", ""))
                return jar[COOKIE].value if COOKIE in jar else ""
            except Exception:
                return ""

        @staticmethod
        def session_cookie(token, clear=False):
            return f"{COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={0 if clear else SESSION_SECONDS}"

        def do_GET(self):
            if not self.valid_host():
                return self.json(403, {"error": "仅允许本机访问"})
            path = unquote(urlparse(self.path).path)
            if path == "/api/health":
                return self.json(200, {"status": "ok", "service": "organization-harness"})
            principal = auth.resolve(self.token())
            if path == "/api/auth/state":
                return self.json(200, {"authenticated": principal is not None, "setup_required": not auth.has_users(), "user": principal})
            if (path.startswith("/api/") or path.startswith("/docs/")) and not principal:
                return self.json(401, {"error": "请先登录员工账号"})
            if path.startswith("/api/attachments/") and path.endswith("/content"):
                return self.serve_attachment(path[len("/api/attachments/"):-len("/content")], principal)
            if path == "/api/auth/users":
                try:
                    return self.json(200, {"users": auth.list_users(principal)})
                except AuthError as exc:
                    return self.json(exc.status, {"error": str(exc)})
            if path == "/api/runtime":
                if principal.get("role") != "admin":
                    return self.json(403, {"error": "仅管理员可查看底座配置状态"})
                return self.json(200, runtime_status(engine.adapter))
            if path == "/api/model-config":
                if principal.get("role") != "admin":
                    return self.json(403, {"error": "仅管理员可查看或修改模型配置"})
                if model_settings is None:
                    return self.json(503, {"error": "当前服务未启用模型配置管理，请通过默认运行模式启动"})
                return self.json(200, model_settings.get_settings())
            if path == "/api/state":
                return self.json(200, engine.snapshot(principal))
            if path == "/api/coordination":
                return self.json(200, engine.coordination(principal))
            if path == "/api/export":
                return self.json(200, engine.snapshot(principal))
            if path == "/api/skills/template":
                format_name = parse_qs(urlparse(self.path).query).get("format", ["markdown"])[0]
                if format_name not in ("markdown", "json"):
                    return self.json(400, {"error": "模板格式必须是 markdown 或 json"})
                name = "template-SKILL.md" if format_name == "markdown" else "template.capability.json"
                template_path = ROOT / "examples" / "skills" / name
                if not template_path.is_file():
                    return self.json(404, {"error": "模板文件不存在"})
                return self.send_bytes(200, template_path.read_bytes(), "text/plain; charset=utf-8", download_name="SKILL.md" if format_name == "markdown" else "capability.json")
            if path.startswith("/api/skills/") and path.endswith("/source"):
                package_id = path[len("/api/skills/"):-len("/source")]
                if not package_id or "/" in package_id:
                    return self.json(404, {"error": "能力包不存在或不可访问"})
                try:
                    source = engine.skill_source(package_id, principal)
                    name = "capability.json" if source["format"] == "json" else "SKILL.md"
                    return self.send_bytes(200, source["content"].encode("utf-8"), "text/plain; charset=utf-8", download_name=name)
                except (KeyError, PermissionError):
                    return self.json(404, {"error": "能力包不存在或不可访问"})
            if path.startswith("/api/"):
                return self.json(404, {"error": "接口不存在"})
            base = ROOT / "web"
            relative = path.lstrip("/") or "index.html"
            target = (base / relative).resolve()
            if not target.is_relative_to(base.resolve()) or not target.is_file():
                return self.json(404, {"error": "文件不存在"})
            mime = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
            if target.suffix in (".md", ".txt"):
                mime = "text/plain"
            if mime.startswith("text/") or target.suffix == ".js":
                mime += "; charset=utf-8"
            self.send_bytes(200, target.read_bytes(), mime)

        def do_POST(self):
            if not self.valid_host():
                return self.json(403, {"error": "仅允许本机访问"})
            port = self.server.server_address[1]
            origin = self.headers.get("Origin")
            if origin and origin not in (f"http://127.0.0.1:{port}", f"http://localhost:{port}"):
                return self.json(403, {"error": "不允许跨站修改"})
            path = urlparse(self.path).path
            if path.startswith("/api/tasks/") and path.endswith("/attachments"):
                principal = auth.resolve(self.token())
                if not principal:
                    return self.json(401, {"error": "请先登录员工账号"})
                acquired = False
                try:
                    task_id = path[len("/api/tasks/"):-len("/attachments")]
                    query = parse_qs(urlparse(self.path).query)
                    expected = int(query.get("expected_version", [""])[0])
                    filename = query.get("filename", [""])[0]
                    length = int(self.headers.get("Content-Length", "0"))
                    if not 0 < length <= MAX_FILE_BYTES:
                        return self.json(413, {"error": "附件必须非空且不超过 32 MiB"})
                    engine.workboard.check_upload(task_id, expected, principal)
                    acquired = upload_slots.acquire(blocking=False)
                    if not acquired:
                        return self.json(503, {"error": "当前上传较多，请稍后重试"})
                    previous_timeout = self.connection.gettimeout()
                    try:
                        self.connection.settimeout(30)
                        data = self.rfile.read(length)
                    finally:
                        self.connection.settimeout(previous_timeout)
                    if len(data) != length:
                        raise ValueError("附件未完整上传，请重试")
                    attachment = engine.workboard.upload(task_id, expected, filename, data, principal)
                    return self.json(200, {"attachment": attachment})
                except VersionConflict as exc:
                    return self.json(409, {"error": str(exc), "code": "version_conflict", "refresh_required": True})
                except PermissionError as exc:
                    return self.json(403, {"error": str(exc)})
                except (ValueError, KeyError, TypeError):
                    return self.json(400, {"error": "附件、文件名、任务或版本参数无效；请检查文件类型和最新任务版本"})
                except Exception:
                    return self.json(500, {"error": "附件未能保存，请检查本地存储后重试"})
                finally:
                    if acquired:
                        upload_slots.release()
            if path not in ("/api/action", "/api/auth/setup", "/api/auth/register", "/api/auth/login", "/api/auth/logout", "/api/auth/users", "/api/skills/preview", "/api/model-config", "/api/model-config/test"):
                return self.json(404, {"error": "接口不存在"})
            if self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
                return self.json(415, {"error": "请求必须使用 application/json"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= MAX_BODY:
                    return self.json(413, {"error": "请求为空或超过 1 MB"})
                payload = json.loads(self.rfile.read(length).decode("utf-8"))
                if not isinstance(payload, dict):
                    raise ValueError("请求必须为 JSON 对象")
                if path in ("/api/auth/setup", "/api/auth/register", "/api/auth/login"):
                    authenticate = {"/api/auth/setup": auth.setup, "/api/auth/register": auth.register, "/api/auth/login": auth.login}
                    user, token = authenticate[path](payload)
                    try:
                        engine.provision_employee(user)
                    except Exception:
                        # The account transaction has committed. Keep it recoverable
                        # through login and do not deliver an unusable session.
                        try:
                            auth.logout(token)
                        except Exception:
                            pass
                        if path != "/api/auth/login":
                            return self.json(503, {"error": "账号已保存，但工作空间初始化未完成。请使用相同账号登录重试。", "code": "account_saved"})
                        raise
                    return self.json(200, {"authenticated": True, "setup_required": False, "user": user}, self.session_cookie(token))
                if path == "/api/auth/logout":
                    auth.logout(self.token())
                    return self.json(200, {"authenticated": False}, self.session_cookie("", True))
                principal = auth.resolve(self.token())
                if not principal:
                    return self.json(401, {"error": "请先登录员工账号"})
                if path in ("/api/model-config", "/api/model-config/test"):
                    if principal.get("role") != "admin":
                        return self.json(403, {"error": "仅管理员可查看或修改模型配置"})
                    if model_settings is None:
                        return self.json(503, {"error": "当前服务未启用模型配置管理，请通过默认运行模式启动"})
                    if path.endswith("/test"):
                        # Probe only fixed test text, outside the business lock.
                        return self.json(200, model_settings.test(payload))
                    with engine.lock:
                        # A pending run has captured its adapter before generate
                        # starts; cover that interval as well as active SDK calls.
                        if any(task["status"] == "running" for task in engine.state["tasks"]):
                            raise ModelConfigConflict("有 Agent 任务正在执行，请等待完成后再切换模型配置。")
                        result = model_settings.save(payload)
                    return self.json(200, result)
                if path == "/api/auth/users":
                    user = auth.create_employee(payload, principal)
                    engine.provision_employee(user)
                    return self.json(200, {"user": user})
                if path == "/api/skills/preview":
                    return self.json(200, engine.preview_skill(payload, principal))
                state = engine.action(payload, principal)
                self.json(200, state)
            except AuthError as exc:
                self.json(exc.status, {"error": str(exc)})
            except ModelConfigConflict as exc:
                self.json(409, {"error": str(exc), "code": "model_config_conflict"})
            except ModelSettingsError as exc:
                self.json(400, {"error": str(exc), "code": "model_config_invalid"})
            except VersionConflict as exc:
                self.json(409, {"error": str(exc), "code": "version_conflict", "refresh_required": True})
            except PermissionError as exc:
                self.json(403, {"error": str(exc)})
            except (ValueError, KeyError, TypeError) as exc:
                self.json(400, {"error": str(exc).strip("'")})
            except Exception:
                self.json(500, {"error": "服务器执行失败，请检查本地日志后重试"})

    return Handler


def main():
    parser = argparse.ArgumentParser(description="小辣椒 · 智能组织本地工作台")
    parser.add_argument("--port", type=int, default=8769)
    parser.add_argument("--db", type=Path, default=ROOT / "data" / "workspace" / "harness.db")
    parser.add_argument("--auth-db", type=Path, default=None)
    parser.add_argument("--runtime", choices=("deepseek", "demo"), default="deepseek",
                        help="Agent 执行底座；默认使用本地安装的官方 DeepSeek Harness")
    parser.add_argument("--seed-example", action="store_true",
                        help="仅开发规则模式：在全新数据库中创建示例目标；不会修改已有数据")
    parser.add_argument("--config", type=Path, default=None, help="本地模型 / 云端 API 连接配置")
    parser.add_argument("--runtime-root", type=Path, default=None, help="Harness 会话与运行记录目录")
    parser.add_argument("--model-settings", type=Path, default=None, help="此工作空间的模型配置存储文件")
    parser.add_argument("--desktop-stdio", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.seed_example and args.runtime != "demo":
        parser.error("--seed-example 仅允许与 --runtime demo 一同用于开发；规则模式不调用模型")
    args.db.parent.mkdir(parents=True, exist_ok=True)
    model_settings = (RuntimeManager(config_path=args.config, runtime_root=args.runtime_root,
                                    settings_path=args.model_settings or args.db.with_suffix(".model-settings.json"))
                      if args.runtime == "deepseek" else None)
    adapter = model_settings or build_runtime_adapter(config_path=args.config, runtime=args.runtime, runtime_root=args.runtime_root)
    engine = Engine(str(args.db), adapter=adapter, seed=args.seed_example,
                    placeholder_owner=args.seed_example)
    auth = AuthStore(str(args.auth_db or args.db.with_suffix(".auth.db")))
    server = None
    try:
        server = HarnessHTTPServer(("127.0.0.1", args.port), make_handler(engine, auth, model_settings=model_settings))
        if args.desktop_stdio:
            def watch_desktop_input():
                try:
                    for line in sys.stdin:
                        if line.strip() == "shutdown":
                            break
                finally:
                    server.shutdown()
            threading.Thread(target=watch_desktop_input, name="desktop-lifecycle", daemon=True).start()
            print("XIAOLAJIAO_READY " + json.dumps({"port": server.server_address[1]}), flush=True)
        print(f"小辣椒 · 智能组织: http://127.0.0.1:{server.server_address[1]}", flush=True)
        print(f"Database: {args.db}", flush=True)
        print(f"Agent runtime: {adapter.model}", flush=True)
        print("DeepSeek Harness is embedded in this organization service." if args.runtime == "deepseek"
              else "Explicit rule demonstration mode; no model requests.", flush=True)
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        if server:
            server.server_close()
        close_adapter = getattr(adapter, "close", None)
        if close_adapter:
            close_adapter()
        engine.close()
        auth.close()


if __name__ == "__main__":
    main()
