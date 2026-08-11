"""Optional NXBT bridge for the Switch 2 AI controller prototype.

This script is intentionally small and line-oriented. A future desktop backend
can spawn it and send ActionCommand-shaped JSON lines over stdin. It requires
Linux, a compatible Bluetooth adapter, BlueZ, and the third-party `nxbt`
    package installed in that environment. Windows and macOS hosts should run
    this bridge inside the Linux VM described by NXBT's official guide.
"""

from __future__ import annotations

import argparse
import json
import sys
import threading
import time
from dataclasses import dataclass
from typing import Any


BUTTON_MAP = {
    "a": "A",
    "b": "B",
    "x": "X",
    "y": "Y",
    "l": "L",
    "r": "R",
    "zl": "ZL",
    "zr": "ZR",
    "dpad_up": "DPAD_UP",
    "dpad_down": "DPAD_DOWN",
    "dpad_left": "DPAD_LEFT",
    "dpad_right": "DPAD_RIGHT",
    "plus": "PLUS",
    "minus": "MINUS",
    "left_stick_press": "L_STICK_PRESS",
    "right_stick_press": "R_STICK_PRESS",
}


def normalize_action(action: Any) -> dict[str, Any]:
    if not isinstance(action, dict):
        raise ValueError("ActionCommand must be a JSON object.")
    buttons = action.get("buttons", {})
    sticks = action.get("sticks", {})
    if not isinstance(buttons, dict) or not isinstance(sticks, dict):
        raise ValueError("buttons and sticks must be JSON objects.")
    try:
        duration_ms = max(20, min(int(action.get("durationMs", 120)), 1500))
        normalized_sticks = {
            key: max(-100, min(int(sticks.get(key, 0) or 0), 100))
            for key in ("left_stick_x", "left_stick_y", "right_stick_x", "right_stick_y")
        }
    except (TypeError, ValueError) as error:
        raise ValueError("durationMs and stick values must be numbers.") from error
    normalized_buttons = {}
    for key, pressed in buttons.items():
        if not isinstance(pressed, bool):
            raise ValueError(f"Button state must be boolean: {key}.")
        if key not in BUTTON_MAP:
            raise ValueError(f"Button is locked or unknown: {key}.")
        normalized_buttons[key] = pressed
    return {"durationMs": duration_ms, "buttons": normalized_buttons, "sticks": normalized_sticks}


@dataclass
class NxbtSession:
    nxbt_module: Any
    nx: Any
    controller_index: int

    @classmethod
    def start(cls, reconnect: bool) -> "NxbtSession":
        import nxbt  # type: ignore

        nx = nxbt.Nxbt()
        kwargs: dict[str, Any] = {}
        if reconnect:
            kwargs["reconnect_address"] = nx.get_switch_addresses()
        controller_index = nx.create_controller(nxbt.PRO_CONTROLLER, **kwargs)
        return cls(nxbt, nx, controller_index)

    @classmethod
    def connect(cls, reconnect: bool) -> "NxbtSession":
        session = cls.start(reconnect)
        session.wait_for_connection()
        return session

    def wait_for_connection(self) -> None:
        self.nx.wait_for_connection(self.controller_index)

    def apply_action(self, action: dict[str, Any], cancel_event: threading.Event | None = None) -> bool:
        action = normalize_action(action)
        packet = self._build_input_packet(action)
        duration = action["durationMs"] / 1000
        deadline = time.perf_counter() + duration
        completed = True

        # NXBT's high-level press/tilt helpers block one after another. Direct
        # packets keep acceleration, steering, items and the second stick active
        # at the same time, which is required for real gameplay.
        while True:
            if cancel_event is not None and cancel_event.is_set():
                completed = False
                break
            self.nx.set_controller_input(self.controller_index, packet)
            if time.perf_counter() >= deadline:
                break
            wait_seconds = min(1 / 120, max(0.0, deadline - time.perf_counter()))
            if cancel_event is not None:
                if cancel_event.wait(wait_seconds):
                    completed = False
                    break
            else:
                time.sleep(wait_seconds)

        neutral = self.nx.create_input_packet()
        self.nx.set_controller_input(self.controller_index, neutral)
        time.sleep(1 / 120)
        self.nx.set_controller_input(self.controller_index, neutral)
        return completed

    def _build_input_packet(self, action: dict[str, Any]) -> dict[str, Any]:
        packet = self.nx.create_input_packet()
        for key, pressed in action.get("buttons", {}).items():
            packet_key = BUTTON_MAP[key]
            if packet_key == "L_STICK_PRESS":
                packet["L_STICK"]["PRESSED"] = bool(pressed)
            elif packet_key == "R_STICK_PRESS":
                packet["R_STICK"]["PRESSED"] = bool(pressed)
            else:
                packet[packet_key] = bool(pressed)

        sticks = action.get("sticks", {})
        for packet_key, prefix in (("L_STICK", "left_stick"), ("R_STICK", "right_stick")):
            packet[packet_key]["X_VALUE"] = int(sticks.get(f"{prefix}_x", 0) or 0)
            # Browser Gamepad axes use positive Y for down; NXBT uses positive Y
            # for up. The bridge is the single coordinate conversion boundary.
            packet[packet_key]["Y_VALUE"] = -int(sticks.get(f"{prefix}_y", 0) or 0)
        return packet

    def close(self) -> None:
        self.nx.remove_controller(self.controller_index)


def main() -> int:
    parser = argparse.ArgumentParser(description="Read JSON ActionCommand lines and send them through NXBT.")
    parser.add_argument("--reconnect", action="store_true", help="Reconnect to a previously paired Switch.")
    parser.add_argument("--dry-run", action="store_true", help="Validate JSON and print translated actions without using NXBT.")
    args = parser.parse_args()

    session: NxbtSession | None = None
    if not args.dry_run:
        session = NxbtSession.connect(reconnect=args.reconnect)

    try:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                action = normalize_action(json.loads(line))
                if args.dry_run:
                    print(json.dumps({"ok": True, "action": action}, ensure_ascii=False), flush=True)
                else:
                    assert session is not None
                    session.apply_action(action)
                    print(json.dumps({"ok": True}, ensure_ascii=False), flush=True)
            except (json.JSONDecodeError, TypeError, ValueError) as error:
                print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False), flush=True)
    finally:
        if session is not None:
            session.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
