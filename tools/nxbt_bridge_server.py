#!/usr/bin/env python3
"""Authenticated HTTP bridge for running NXBT inside a Linux VM.

The localhost application connects to this service over the host-only/private
VM network. Keep the token private and expose the bridge only to trusted
networks.
"""

from __future__ import annotations

import argparse
import json
import secrets
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from nxbt_bridge import NxbtSession, normalize_action


class BridgeError(Exception):
    def __init__(self, status: HTTPStatus, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


class BridgeState:
    def __init__(self, dry_run: bool = False) -> None:
        self.dry_run = dry_run
        self.connected = False
        self.connecting = False
        self.connection_error = ""
        self.connection_generation = 0
        self.session: NxbtSession | None = None
        self.pending_session: NxbtSession | None = None
        self.lock = threading.RLock()
        self.action_lock = threading.Lock()
        self.action_cancel = threading.Event()

    def status(self) -> dict[str, Any]:
        with self.lock:
            return {
                "ok": True,
                "controllerReady": self.connected,
                "connecting": self.connecting,
                "connectionError": self.connection_error,
                "dryRun": self.dry_run,
            }

    def connect(self, reconnect: bool) -> dict[str, Any]:
        with self.lock:
            if self.connected:
                return {
                    **self.status(),
                    "message": "NXBT controller is already connected.",
                }
            if self.connecting:
                return {
                    **self.status(),
                    "message": "NXBT is still waiting for the Switch pairing screen.",
                }
            if self.dry_run:
                self.action_cancel = threading.Event()
                self.connected = True
                return {
                    **self.status(),
                    "message": "NXBT controller connected.",
                }
            self.connection_generation += 1
            generation = self.connection_generation
            self.action_cancel = threading.Event()
            self.connecting = True
            self.connection_error = ""
            threading.Thread(
                target=self._connect_worker,
                args=(generation, reconnect),
                daemon=True,
                name="nxbt-pairing",
            ).start()
            return {
                **self.status(),
                "message": "NXBT pairing started. Open the Switch controller pairing screen.",
            }

    def _connect_worker(self, generation: int, reconnect: bool) -> None:
        session: NxbtSession | None = None
        try:
            session = NxbtSession.start(reconnect=reconnect)
            with self.lock:
                if generation != self.connection_generation:
                    stale = True
                else:
                    stale = False
                    self.pending_session = session
            if stale:
                session.close()
                return
            session.wait_for_connection()
            with self.lock:
                if generation != self.connection_generation:
                    stale = True
                else:
                    stale = False
                    self.pending_session = None
                    self.session = session
                    self.connected = True
                    self.connecting = False
                    self.connection_error = ""
            if stale:
                session.close()
        except Exception as error:  # NXBT/BlueZ errors must be visible through /health.
            if session is not None:
                try:
                    session.close()
                except Exception:
                    pass
            with self.lock:
                if generation == self.connection_generation:
                    self.pending_session = None
                    self.connected = False
                    self.connecting = False
                    self.connection_error = str(error)

    def disconnect(self, emergency: bool = False) -> dict[str, Any]:
        with self.lock:
            self.connection_generation += 1
            self.action_cancel.set()
            sessions = [item for item in (self.session, self.pending_session) if item is not None]
            self.session = None
            self.pending_session = None
            self.connected = False
            self.connecting = False
            self.connection_error = ""
        close_error = ""
        closed_ids: set[int] = set()
        with self.action_lock:
            for item in sessions:
                if id(item) in closed_ids:
                    continue
                closed_ids.add(id(item))
                try:
                    item.close()
                except Exception as error:  # NXBT/BlueZ errors must be visible.
                    close_error = str(error)
        if close_error:
            raise BridgeError(
                HTTPStatus.CONFLICT,
                f"NXBT controller removal reported an error: {close_error}",
            )
        return {
            **self.status(),
            "emergencyStopVerified": emergency,
            "message": (
                "NXBT software emergency stop removed the emulated controller."
                if emergency
                else "NXBT controller disconnected."
            ),
        }

    def apply_action(self, payload: dict[str, Any], preempt: bool = False) -> dict[str, Any]:
        action = normalize_action(payload)
        with self.lock:
            if not self.connected:
                raise BridgeError(HTTPStatus.CONFLICT, "NXBT controller is not connected.")
            if preempt:
                self.action_cancel.set()
                self.action_cancel = threading.Event()
            session = self.session
            cancel_event = self.action_cancel
        preempted = False
        if session is not None:
            with self.action_lock:
                with self.lock:
                    if not self.connected or self.session is not session or cancel_event.is_set():
                        raise BridgeError(HTTPStatus.CONFLICT, "NXBT action was cancelled before execution.")
                if not session.apply_action(action, cancel_event=cancel_event):
                    with self.lock:
                        still_connected = self.connected and self.session is session
                    if not still_connected:
                        raise BridgeError(HTTPStatus.CONFLICT, "NXBT action was cancelled by emergency stop.")
                    preempted = True
        return {"ok": True, "preempted": preempted, "action": action if self.dry_run else None}

    def apply_test_input(self, payload: dict[str, Any]) -> dict[str, Any]:
        operation = str(payload.get("operation", "")).strip().lower()
        action = normalize_action(payload.get("action"))
        with self.lock:
            if not self.connected:
                raise BridgeError(HTTPStatus.CONFLICT, "NXBT controller is not connected.")
            session = self.session
            cancel_event = self.action_cancel
        if session is not None:
            with self.action_lock:
                with self.lock:
                    if not self.connected or self.session is not session or cancel_event.is_set():
                        raise BridgeError(HTTPStatus.CONFLICT, "NXBT test input was cancelled before execution.")
                session.apply_test_input(operation, action)
        return {"ok": True, "operation": operation, "action": action if self.dry_run else None}


class Handler(BaseHTTPRequestHandler):
    server_version = "Switch2NxbtBridge/0.1"

    @property
    def bridge_server(self) -> "BridgeServer":
        return self.server  # type: ignore[return-value]

    def log_message(self, format: str, *args: Any) -> None:
        print("%s - %s" % (self.address_string(), format % args), flush=True)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def read_json(self) -> dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise BridgeError(HTTPStatus.BAD_REQUEST, "Invalid Content-Length.") from error
        if length < 0 or length > 1024 * 1024:
            raise BridgeError(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "Request body is too large.")
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise BridgeError(HTTPStatus.BAD_REQUEST, "Invalid JSON body.") from error
        if not isinstance(payload, dict):
            raise BridgeError(HTTPStatus.BAD_REQUEST, "JSON body must be an object.")
        return payload

    def require_token(self) -> None:
        expected = f"Bearer {self.bridge_server.token}"
        if not secrets.compare_digest(self.headers.get("Authorization", ""), expected):
            raise BridgeError(HTTPStatus.FORBIDDEN, "Missing or invalid bridge token.")

    def send_json(self, payload: dict[str, Any], status: HTTPStatus = HTTPStatus.OK) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        try:
            self.require_token()
            if self.path == "/health":
                return self.send_json(self.bridge_server.state.status())
            raise BridgeError(HTTPStatus.NOT_FOUND, "Bridge route not found.")
        except BridgeError as error:
            self.send_json({"error": error.message}, error.status)

    def do_POST(self) -> None:
        try:
            self.require_token()
            payload = self.read_json()
            if self.path == "/connect":
                return self.send_json(self.bridge_server.state.connect(bool(payload.get("reconnect", False))))
            if self.path == "/disconnect":
                return self.send_json(self.bridge_server.state.disconnect())
            if self.path == "/emergency-stop":
                return self.send_json(self.bridge_server.state.disconnect(emergency=True))
            if self.path == "/action":
                return self.send_json(self.bridge_server.state.apply_action(payload))
            if self.path == "/manual-action":
                return self.send_json(self.bridge_server.state.apply_action(payload, preempt=True))
            if self.path == "/test-input":
                return self.send_json(self.bridge_server.state.apply_test_input(payload))
            raise BridgeError(HTTPStatus.NOT_FOUND, "Bridge route not found.")
        except BridgeError as error:
            self.send_json({"error": error.message}, error.status)
        except (TypeError, ValueError) as error:
            self.send_json({"error": str(error)}, HTTPStatus.BAD_REQUEST)
        except Exception as error:  # NXBT and BlueZ failures must remain honest.
            self.send_json({"error": str(error)}, HTTPStatus.CONFLICT)


class BridgeServer(ThreadingHTTPServer):
    allow_reuse_address = False

    def __init__(self, address: tuple[str, int], token: str, state: BridgeState) -> None:
        super().__init__(address, Handler)
        self.token = token
        self.state = state


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve NXBT to the localhost desktop app.")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", default=8766, type=int)
    parser.add_argument("--token", required=True, help="Private token required by the desktop app.")
    parser.add_argument("--dry-run", action="store_true", help="Test the bridge without importing NXBT.")
    args = parser.parse_args()
    if not args.token.strip():
        parser.error("--token must not be empty")
    server = BridgeServer((args.host, args.port), args.token, BridgeState(dry_run=args.dry_run))
    print(f"NXBT VM bridge ready on {args.host}:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
