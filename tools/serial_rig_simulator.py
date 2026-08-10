#!/usr/bin/env python3
"""JSON Lines simulator for the generic mechanical-rig Serial contract."""

from __future__ import annotations

import json
import sys
from typing import Any


ALLOWED_TYPES = {"action", "neutral", "emergency_stop"}
ALLOWED_STICKS = {"left_stick_x", "left_stick_y", "right_stick_x", "right_stick_y"}
ALLOWED_BUTTONS = {"a", "b", "x", "y", "l", "r", "zl", "zr"}


def handle(payload: dict[str, Any]) -> dict[str, Any]:
    command_id = str(payload.get("id", ""))
    command_type = str(payload.get("type", ""))
    if command_type not in ALLOWED_TYPES:
        return {"type": "ack", "id": command_id, "ok": False, "error": "unsupported_type"}
    if command_type == "action":
        duration = payload.get("durationMs", 0)
        if not isinstance(duration, (int, float)) or isinstance(duration, bool) or duration < 20 or duration > 2000:
            return {"type": "ack", "id": command_id, "ok": False, "error": "duration_out_of_range"}
        sticks = payload.get("sticks", {})
        buttons = payload.get("buttons", {})
        if not isinstance(sticks, dict) or not isinstance(buttons, dict):
            return {"type": "ack", "id": command_id, "ok": False, "error": "invalid_action_shape"}
        if set(sticks) - ALLOWED_STICKS or any(not isinstance(value, (int, float)) or isinstance(value, bool) or not -100 <= value <= 100 for value in sticks.values()):
            return {"type": "ack", "id": command_id, "ok": False, "error": "invalid_stick"}
        if set(buttons) - ALLOWED_BUTTONS or any(not isinstance(value, bool) for value in buttons.values()):
            return {"type": "ack", "id": command_id, "ok": False, "error": "invalid_button"}
    return {"type": "ack", "id": command_id, "ok": True}


def main() -> int:
    for line in sys.stdin:
        try:
            payload = json.loads(line)
            response = handle(payload)
        except (ValueError, TypeError, json.JSONDecodeError) as error:
            response = {"type": "ack", "id": "", "ok": False, "error": str(error)}
        print(json.dumps(response, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
