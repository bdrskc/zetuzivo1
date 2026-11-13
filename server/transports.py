"""Minimal asyncio HTTP + RFC6455 WebSocket transport for VozLinia.

A single connection class serves plain HTTP requests (any method) and
WebSocket endpoints on the same port, so no external HTTP or WebSocket
framework is required. This is new code for VozLinia (BSD-3-Clause).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import asyncio
import base64
import hashlib
import logging
import struct
import time

logger = logging.getLogger(__name__)

_WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
_MAX_WS_PAYLOAD = 4_000_000
_MAX_HTTP_HEADER = 65_536
_MAX_HTTP_BODY = 1_000_000
_REASONS = {200: "OK", 204: "No Content", 304: "Not Modified",
            400: "Bad Request", 404: "Not Found", 429: "Too Many Requests",
            500: "Internal Server Error", 501: "Not Implemented"}


@dataclass
class HttpMessage:
    status: int
    body: bytes = b""
    content_type: str = "text/plain; charset=utf-8"
    cache_control: str | None = None
    extra_headers: list[tuple[str, str]] = field(default_factory=list)


def render_http(message: HttpMessage) -> bytes:
    reason = _REASONS.get(message.status, "")
    headers = f"HTTP/1.1 {message.status} {reason}\r\n".encode("ascii")
    pairs = [("Content-Type", message.content_type),
             ("Content-Length", str(len(message.body))),
             ("Connection", "close")]
    if message.cache_control:
        pairs.append(("Cache-Control", message.cache_control))
    pairs.extend(message.extra_headers)
    headers += b"".join(
        f"{name}: {value}\r\n".encode("ascii", "replace") for name, value in pairs)
    return headers + b"\r\n" + message.body


def _ws_frame(opcode: int, payload: bytes) -> bytes:
    size = len(payload)
    header = bytearray([0x80 | opcode])
    if size < 126:
        header.append(size)
    elif size < 65536:
        header.append(126)
        header += struct.pack(">H", size)
    else:
        header.append(127)
        header += struct.pack(">Q", size)
    return bytes(header) + payload


def _parse_frame(data: bytes):
    """Return (opcode, payload, end) or None if the frame is incomplete."""
    if len(data) < 2:
        return None
    opcode = data[0] & 0x0F
    masked = bool(data[1] & 0x80)
    length = data[1] & 0x7F
    position = 2
    if length == 126:
        if len(data) < 4:
            return None
        length = struct.unpack(">H", data[2:4])[0]
        position = 4
    elif length == 127:
        if len(data) < 10:
            return None
        length = struct.unpack(">Q", data[2:10])[0]
        position = 10
    if length > _MAX_WS_PAYLOAD:
        return -1, b"", position
    mask_offset = position
    if masked:
        position += 4
    if len(data) < position + length:
        return None
    payload = data[position:position + length]
    if masked:
        mask = data[mask_offset:mask_offset + 4]
        payload = bytes(c ^ mask[i % 4] for i, c in enumerate(payload))
    return opcode, payload, position + length

class VozLiniaConnection(asyncio.Protocol):
    """Serves HTTP requests and WebSocket sessions on one connection.

    `app` exposes:
      * handle_request(method, path, headers) -> HttpMessage | None (None for
        WebSocket upgrade paths, which the transport handles itself)
      * client_connected(conn, version, app_updates) -> coroutine
    """

    def __init__(self, app) -> None:
        self.app = app
        self.transport: asyncio.Transport | None = None
        self.buffer = b""
        self.closed: asyncio.Future = asyncio.get_event_loop().create_future()
        self.ws_active = False
        self.last_activity = time.monotonic()
        self.version = None
        self.app_updates = False
        self.pending_body: bytes | None = None
        self._expected_body_length = 0
        self._method: str | None = None
        self._path: str | None = None
        self._target: str | None = None
        self._headers: dict[str, str] | None = None

    # ------------------------------------------------------------ asyncio wire
    def connection_made(self, transport) -> None:
        self.transport = transport

    def connection_lost(self, exc) -> None:
        if not self.closed.done():
            self.closed.set_result(None)

    def send_text(self, text: str) -> None:
        if self.transport and not self.transport.is_closing():
            self.transport.write(_ws_frame(0x1, text.encode("utf-8")))

    def send_ping(self) -> None:
        if self.transport and not self.transport.is_closing() and self.ws_active:
            self.transport.write(_ws_frame(0x9, b"vl"))

    def close(self) -> None:
        if self.transport:
            self.transport.close()

    def data_received(self, data: bytes) -> None:
        self.buffer += data
        if not self.ws_active:
            self._process_http()
        else:
            self._process_ws()

    # ------------------------------------------------------------------- HTTP
    def _process_http(self) -> None:
        while True:
            if self.pending_body is not None:
                # still collecting the request body
                body = self.buffer
                self.buffer = b""
                if len(body) < self._expected_body_length:
                    self.pending_body = body
                    return
                self.pending_body = None
                self._dispatch(body)
                return
            boundary = self.buffer.find(b"\r\n\r\n")
            if boundary < 0:
                if len(self.buffer) > _MAX_HTTP_HEADER:
                    self.close()
                return  # wait for the rest of the header
            header_block = self.buffer[:boundary]
            self.buffer = self.buffer[boundary + 4:]
            try:
                request_line, *header_lines = header_block.split(b"\r\n")
                method, target, _version = request_line.split(b" ", 2)
                headers: dict[str, str] = {}
                for line in header_lines:
                    if b":" in line:
                        name, _, value = line.partition(b":")
                        headers[name.decode("ascii", "ignore").strip().lower()] = \
                            value.strip().decode("latin-1")
            except ValueError:
                self._send_http(HttpMessage(400, b"Bad request"))
                return

            self._method = method.decode("ascii", "ignore")
            self._target = target.decode("latin-1")
            self._path = self._target.split("?", 1)[0]
            self._headers = headers

            upgrade = headers.get("upgrade", "").lower() == "websocket"
            if upgrade:
                self._start_websocket(self._target, headers)
                return
            content_length = int(headers.get("content-length", 0) or 0)
            if content_length > _MAX_HTTP_BODY:
                self._send_http(HttpMessage(400, b"Too large"))
                return
            if len(self.buffer) < content_length:
                self._expected_body_length = content_length
                self.pending_body = self.buffer
                self.buffer = b""
                return
            body = self.buffer[:content_length]
            self.buffer = self.buffer[content_length:]
            self._dispatch(body)
            return

    def _dispatch(self, body: bytes) -> None:
        method = self._method or "GET"
        path = self._path or "/"
        headers = self._headers or {}
        handler = getattr(self.app, "handle_request_async", None)
        if handler is not None:
            asyncio.create_task(self._dispatch_async(handler, method, path, headers))
            return
        message = self.app.handle_request(method, path, headers)
        if message is None:
            message = HttpMessage(404, b"Not found")
        self._send_http(message)

    async def _dispatch_async(self, handler, method: str, path: str,
                              headers: dict[str, str]) -> None:
        try:
            message = await handler(method, path, headers)
        except Exception:
            logger.exception("HTTP handler failed")
            message = HttpMessage(500, b"Internal error")
        if message is None:
            message = HttpMessage(404, b"Not found")
        self._send_http(message)

    def _send_http(self, message: HttpMessage) -> None:
        if self.transport and not self.transport.is_closing():
            self.transport.write(render_http(message))
            self.transport.close()

    # ---------------------------------------------------------------- WebSocket
    def _start_websocket(self, target: str, headers: dict[str, str]) -> None:
        key = headers.get("sec-websocket-key", "")
        accept = base64.b64encode(
            hashlib.sha1((key + _WS_GUID).encode("ascii")).digest()).decode("ascii")
        response = (
            b"HTTP/1.1 101 Switching Protocols\r\n"
            b"Upgrade: websocket\r\n"
            b"Connection: Upgrade\r\n"
            + f"Sec-WebSocket-Accept: {accept}\r\n\r\n".encode("ascii"))
        if self.transport and not self.transport.is_closing():
            self.transport.write(response)
        self.ws_active = True
        path = target.split("?", 1)[0]
        query = target.split("?", 1)[1] if "?" in target else ""
        self.app_updates = any(
            pair.startswith("appUpdates=1") for pair in query.split("&"))
        self.version = self._ws_version_for_path(path)
        if self.version is None:
            self.close()
            return
        asyncio.create_task(
            self.app.client_connected(self, self.version,
                                      app_updates=self.app_updates))

    @staticmethod
    def _ws_version_for_path(path: str):
        if path == "/ws":
            return 0
        if path.startswith("/ws-v"):
            suffix = path[len("/ws-v"):]
            if suffix.isdigit():
                return int(suffix)
        return None

    def _process_ws(self) -> None:
        while self.ws_active:
            parsed = _parse_frame(self.buffer)
            if parsed is None:
                return
            opcode, payload, end = parsed
            if opcode == -1:
                self.close()
                return
            self.buffer = self.buffer[end:]
            self.last_activity = time.monotonic()
            if opcode == 0x8:  # close
                if self.transport and not self.transport.is_closing():
                    self.transport.write(_ws_frame(0x8, payload[:125]))
                    self.transport.close()
                return
            if opcode == 0x9:  # ping -> pong
                if self.transport and not self.transport.is_closing():
                    self.transport.write(_ws_frame(0xA, payload))
            # 0x1/0x2 (text/binary) are ignored: we are push-only.

