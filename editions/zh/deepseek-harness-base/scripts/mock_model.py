"""Loopback-only OpenAI/Messages fixture for testing the actual dsh runtime."""
from contextlib import AbstractContextManager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import threading
import time
from uuid import uuid4


RESPONSE = "这是本地模拟模型通过官方 DeepSeek Harness 运行时返回的验收文本。它验证真实协议、会话和任务状态，不代表任何业务任务或真实模型评测已经完成。"


class MockModel(AbstractContextManager):
    def __init__(self):
        self.requests = []
        self.lock = threading.Lock()
        self.entered = threading.Event()
        self.release = threading.Event()
        self.release.set()
        self.failure_status = None
        self.content = RESPONSE
        self.finish_reason = "stop"
        self.malformed = False
        fixture = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                data = json.dumps({"object": "list", "data": [{"id": "local-test-model", "object": "model", "owned_by": "local-test"}]}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_POST(self):
                payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                with fixture.lock:
                    fixture.requests.append({"path": self.path, "body": payload, "has_authorization": "Authorization" in self.headers, "has_api_key": "x-api-key" in self.headers, "local_placeholder_only": self.headers.get("Authorization") in (None, "Bearer local-no-auth-required") and not self.headers.get("x-api-key")})
                    failure = fixture.failure_status
                    content = fixture.content
                    finish_reason = fixture.finish_reason
                    malformed = fixture.malformed
                fixture.entered.set()
                fixture.release.wait(20)
                if failure:
                    data = json.dumps({"error": {"type": "authentication_error", "message": "LOCAL-MOCK-ERROR-DETAIL"}}).encode()
                    self.send_response(failure)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                    return
                message_id = "local-msg-" + uuid4().hex
                is_messages = self.path.split("?")[0].endswith("/messages")
                if not payload.get("stream", False):
                    if is_messages:
                        response = {"id": message_id, "type": "message", "role": "assistant", "model": payload.get("model", "local-test-model"), "content": [{"type": "text", "text": content}], "stop_reason": "end_turn", "stop_sequence": None, "usage": {"input_tokens": 12, "output_tokens": 40}}
                    else:
                        response = {"id": message_id, "object": "chat.completion", "model": payload.get("model", "local-test-model"), "choices": [{"index": 0, "message": {"role": "assistant", "content": content}, "finish_reason": "stop"}], "usage": {"prompt_tokens": 12, "completion_tokens": 40, "total_tokens": 52}}
                    data = json.dumps(response, ensure_ascii=False).encode()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                    return
                if malformed:
                    data = b"data: {not-json}\n\ndata: [DONE]\n\n"
                elif is_messages:
                    events = [
                        {"type": "message_start", "message": {"id": message_id, "type": "message", "role": "assistant", "model": payload.get("model", "local-test-model"), "content": [], "stop_reason": None, "stop_sequence": None, "usage": {"input_tokens": 12, "output_tokens": 0}}},
                        {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}},
                        {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": content}},
                        {"type": "content_block_stop", "index": 0},
                        {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": None}, "usage": {"output_tokens": 40}},
                        {"type": "message_stop"},
                    ]
                    data = "".join("event: " + event["type"] + "\ndata: " + json.dumps(event, ensure_ascii=False) + "\n\n" for event in events).encode()
                else:
                    base = {"id": message_id, "object": "chat.completion.chunk", "created": int(time.time()), "model": payload.get("model", "local-test-model")}
                    events = [
                        {**base, "choices": [{"index": 0, "delta": {"role": "assistant", "content": content}, "finish_reason": None}]},
                        {**base, "choices": [{"index": 0, "delta": {}, "finish_reason": finish_reason}], "usage": {"prompt_tokens": 12, "completion_tokens": 40, "total_tokens": 52}},
                    ]
                    data = ("".join("data: " + json.dumps(event, ensure_ascii=False) + "\n\n" for event in events) + "data: [DONE]\n\n").encode()
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                try:
                    self.wfile.write(data)
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                    pass  # Expected when the real runtime deadline cancels HTTP.

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True)

    @property
    def origin(self):
        return f"http://127.0.0.1:{self.server.server_address[1]}"

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *args):
        self.release.set()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(2)
