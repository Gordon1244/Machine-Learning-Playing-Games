#!/usr/bin/env python3
"""Run a local PPO engine smoke test without a camera or controller."""

from __future__ import annotations

import json
import base64
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server.worker_main import TrainingSession


def frame(index: int) -> dict[str, object]:
    return {
        "ready": True,
        "confidence": 0.95,
        "confidenceThreshold": 0.75,
        "rank": max(1, 12 - index // 4),
        "speed": min(180, 40 + index * 3),
        "progress": min(100, index * 3),
        "crashed": False,
        "fallingBehind": index < 8,
        "failed": False,
    }


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="switch2-ppo-smoke-") as temporary:
        root = Path(temporary)
        models = root / "models"
        trajectories = root / "datasets" / "trajectories"
        trajectories.mkdir(parents=True)
        import cv2
        import numpy as np

        image = np.zeros((720, 1280, 3), dtype=np.uint8)
        cv2.line(image, (430, 720), (590, 0), (255, 255, 255), 18)
        cv2.line(image, (850, 720), (690, 0), (255, 255, 255), 18)
        ok, encoded = cv2.imencode(".jpg", image)
        if not ok:
            raise RuntimeError("Could not encode visual smoke frame")
        image_path = trajectories / "demo-0001.jpg"
        image_path.write_bytes(encoded.tobytes())
        demonstration_action_id = "d" * 32
        demo = {
            "imagePath": image_path.name,
            "state": frame(10),
            "action": {
                "id": demonstration_action_id,
                "sticks": {"left_stick_x": 20, "left_stick_y": 0, "right_stick_x": 0, "right_stick_y": 0},
                "buttons": {"a": True, "zr": True},
            },
        }
        demonstrations = trajectories / "demonstrations.jsonl"
        demonstrations.write_text(json.dumps(demo) + "\n", encoding="utf-8")
        (trajectories / "executions.jsonl").write_text(
            json.dumps({"actionId": demonstration_action_id, "status": "executed"}) + "\n",
            encoding="utf-8",
        )
        session = TrainingSession()
        pretrained = session.pretrain_demonstrations(str(models), str(demonstrations), epochs=1)
        if not pretrained.get("ok") or pretrained.get("samples") != 1:
            raise RuntimeError(f"Visual demonstration pretraining failed: {pretrained}")
        started = session.start(str(models), "safe", checkpoint_minutes=5, exploration_rate=0.1)
        if not started["ready"] or started["mode"] != "training":
            raise RuntimeError(f"PPO did not start: {started}")
        actions = []
        for index in range(40):
            result = session.frame(frame(index), base64.b64encode(encoded.tobytes()).decode("ascii"))
            if result.get("action"):
                actions.append(result["action"])
            time.sleep(0.01)
        stopped = session.stop()
        stable = models / "stable" / "ppo-latest.zip"
        if not stopped["modelSaved"] or not stable.exists():
            raise RuntimeError(f"PPO model was not saved: {stopped}")
        resumed_session = TrainingSession()
        resumed = resumed_session.start(str(models), "safe", checkpoint_minutes=5, exploration_rate=0.1)
        if not resumed.get("resumedFromStable"):
            raise RuntimeError(f"PPO did not resume the stable model: {resumed}")
        resumed_session.stop()
        print(
            json.dumps(
                {
                    "ok": True,
                    "actionsProduced": len(actions),
                    "demonstrationSamples": pretrained["samples"],
                    "observationMode": resumed["observationMode"],
                    "stableModelBytes": stable.stat().st_size,
                    "resumedFromStable": resumed["resumedFromStable"],
                },
                ensure_ascii=False,
            )
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
