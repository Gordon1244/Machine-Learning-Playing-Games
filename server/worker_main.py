#!/usr/bin/env python3
"""Isolated OCR and PPO worker.

The localhost server talks to this process with JSON lines. Optional imports
stay here so a broken ML dependency cannot take down the project server.
"""

from __future__ import annotations

import base64
import json
import re
import shutil
import sys
import threading
import time
import uuid
from collections import deque
from pathlib import Path
from typing import Any


SAFE_BUTTONS = ("a", "b", "x", "y", "l", "r", "zl", "zr")
VISUAL_MODEL_SCHEMA = "visual_fusion_v1"
VISUAL_FRAME_HEIGHT = 84
VISUAL_FRAME_WIDTH = 144
VISUAL_FRAME_STACK = 4
EXPLORATION_PRESETS = {
    "safe": {"learning_rate": 0.0002, "ent_coef": 0.005},
    "balanced": {"learning_rate": 0.0003, "ent_coef": 0.01},
    "fast": {"learning_rate": 0.0005, "ent_coef": 0.02},
}


def available(name: str) -> bool:
    try:
        __import__(name)
        return True
    except Exception:
        return False


def modules() -> dict[str, bool]:
    return {
        "opencv": available("cv2"),
        "easyocr": available("easyocr"),
        "numpy": available("numpy"),
        "torch": available("torch"),
        "gymnasium": available("gymnasium"),
        "stableBaselines3": available("stable_baselines3"),
    }


def score(state: dict[str, Any]) -> float:
    config = state.get("rewardConfig") if isinstance(state.get("rewardConfig"), dict) else {}
    speed = max(0.0, float(state.get("speed") or 0))
    progress = max(0.0, float(state.get("progress") or 0))
    rank = max(1, int(state.get("rank") or 12))
    positive = (
        min(30, speed / 5) * float(config.get("speedWeight", 1))
        + min(30, progress * 0.3) * float(config.get("progressWeight", 1))
        + max(0, 28 - rank) * float(config.get("rankWeight", 1))
        + (float(config.get("itemEffectBonus", 5)) if state.get("itemState") else 0)
    )
    penalties = (
        (float(config.get("crashPenalty", 18)) if state.get("crashed") else 0)
        + (float(config.get("fallingBehindPenalty", 8)) if state.get("fallingBehind") else 0)
        + (float(config.get("failurePenalty", 35)) if state.get("failed") else 0)
    )
    return max(0.0, positive - penalties)


def parse_ocr(items: list[dict[str, Any]]) -> dict[str, Any]:
    joined = " ".join(str(item.get("text", "")) for item in items)
    rank = None
    speed = None
    progress = None
    rank_match = re.search(r"(?:rank|順位|排名)?\s*(\d{1,2})\s*/\s*(\d{1,2})", joined, re.I)
    speed_match = re.search(r"(\d{1,3})\s*(?:km/?h|kph)", joined, re.I)
    progress_match = re.search(r"(\d{1,3})\s*%", joined)
    if rank_match:
        rank = int(rank_match.group(1))
    if speed_match:
        speed = int(speed_match.group(1))
    if progress_match:
        progress = min(100, int(progress_match.group(1)))
    lowered = joined.lower()
    failed = any(word in lowered for word in ("game over", "failed", "失敗", "リタイア"))
    crashed = any(word in lowered for word in ("crash", "collision", "撞牆", "碰撞"))
    item = next((word for word in ("mushroom", "shell", "banana", "coin", "道具", "蘑菇", "香蕉", "龜殼") if word in lowered), "")
    confidence = sum(float(item.get("confidence") or 0) for item in items) / len(items) if items else 0.0
    return {
        "ocrTexts": items,
        "screenType": "failure" if failed else "gameplay",
        "rank": rank,
        "speed": speed,
        "progress": progress,
        "itemState": item,
        "crashed": crashed,
        "fallingBehind": bool(rank and rank >= 9),
        "failed": failed,
        "confidence": round(confidence, 4),
    }


class OcrEngine:
    def __init__(self) -> None:
        self.reader: Any = None
        self.languages: tuple[str, ...] = ()

    def read(self, image_b64: str, languages: list[str], reward_config: dict[str, Any] | None = None) -> dict[str, Any]:
        status = modules()
        if not status["opencv"] or not status["easyocr"] or not status["numpy"]:
            return {
                "ready": False,
                "message": "OCR 套件尚未安裝。請到進階功能的一鍵安裝準備 opencv、easyocr 與 numpy。",
                **parse_ocr([]),
            }
        import cv2
        import easyocr
        import numpy as np

        selected = tuple(languages or ["ch_tra", "en"])
        if self.reader is None or selected != self.languages:
            self.reader = easyocr.Reader(list(selected), gpu=False)
            self.languages = selected
        raw = base64.b64decode(image_b64, validate=True)
        image = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError("無法解碼鏡頭畫格。")
        items = [
            {"text": str(text), "confidence": round(float(confidence), 4)}
            for _box, text, confidence in self.reader.readtext(image)
        ]
        parsed = parse_ocr(items)
        parsed["rewardConfig"] = dict(reward_config or {})
        parsed["learningScore"] = round(score(parsed), 2)
        ready = parsed["confidence"] >= 0.45
        message = "OCR 已讀取畫面。" if ready else "OCR 信心不足，請重新確認鏡頭角度、反光與畫面範圍。"
        return {"ready": ready, "message": message, **parsed}


class OnlineEnv:
    """Gymnasium environment whose steps wait for the next browser frame."""

    def __init__(self, preset: str) -> None:
        import gymnasium as gym
        import numpy as np

        self.gym = gym
        self.np = np
        self.action_space = gym.spaces.Box(low=-1.0, high=1.0, shape=(12,), dtype=np.float32)
        self.observation_space = gym.spaces.Dict({
            "image": gym.spaces.Box(
                low=0,
                high=255,
                shape=(VISUAL_FRAME_STACK, VISUAL_FRAME_HEIGHT, VISUAL_FRAME_WIDTH),
                dtype=np.uint8,
            ),
            "state": gym.spaces.Box(low=-1.0, high=1.0, shape=(8,), dtype=np.float32),
        })
        self.preset = preset
        self.condition = threading.Condition()
        self.latest_state: dict[str, Any] = {}
        self.frames: deque[Any] = deque(maxlen=VISUAL_FRAME_STACK)
        for _index in range(VISUAL_FRAME_STACK):
            self.frames.append(np.zeros((VISUAL_FRAME_HEIGHT, VISUAL_FRAME_WIDTH), dtype=np.uint8))
        self.latest_action: list[float] | None = None
        self.frame_version = 0
        self.closed = False

    def state_vector(self) -> Any:
        state = self.latest_state
        values = [
            float(state.get("speed") or 0) / 250,
            float(state.get("progress") or 0) / 100,
            float(state.get("rank") or 12) / 12,
            float(state.get("confidence") or 0),
            1.0 if state.get("crashed") else 0.0,
            1.0 if state.get("fallingBehind") else 0.0,
            1.0 if state.get("failed") else 0.0,
            min(1.0, score(state) / 100),
        ]
        return self.np.asarray(values, dtype=self.np.float32)

    def push_frame(self, image_b64: str) -> bool:
        if not image_b64:
            return False
        import cv2

        try:
            raw = base64.b64decode(image_b64, validate=True)
            image = cv2.imdecode(self.np.frombuffer(raw, dtype=self.np.uint8), cv2.IMREAD_GRAYSCALE)
        except (ValueError, TypeError):
            return False
        if image is None:
            return False
        resized = cv2.resize(image, (VISUAL_FRAME_WIDTH, VISUAL_FRAME_HEIGHT), interpolation=cv2.INTER_AREA)
        self.frames.append(resized.astype(self.np.uint8, copy=False))
        return True

    def observation(self) -> dict[str, Any]:
        return {
            "image": self.np.stack(tuple(self.frames), axis=0),
            "state": self.state_vector(),
        }

    def reset(self, seed: int | None = None, options: dict[str, Any] | None = None) -> tuple[Any, dict[str, Any]]:
        return self.observation(), {}

    def step(self, action: Any) -> tuple[Any, float, bool, bool, dict[str, Any]]:
        with self.condition:
            seen = self.frame_version
            self.latest_action = [float(value) for value in action]
            self.condition.notify_all()
            self.condition.wait_for(lambda: self.closed or self.frame_version > seen, timeout=2.0)
            state = dict(self.latest_state)
        return self.observation(), score(state), bool(state.get("failed") or self.closed), False, {"gameState": state}

    def set_state(self, state: dict[str, Any], image_b64: str = "") -> None:
        with self.condition:
            self.latest_state = dict(state)
            self.push_frame(image_b64)
            self.frame_version += 1
            self.condition.notify_all()

    def accept_frame(self, state: dict[str, Any], image_b64: str = "") -> list[float] | None:
        with self.condition:
            self.latest_state = dict(state)
            self.push_frame(image_b64)
            self.frame_version += 1
            self.condition.notify_all()
            self.condition.wait_for(lambda: self.closed or self.latest_action is not None, timeout=0.25)
            action = self.latest_action
            self.latest_action = None
            return action

    def close(self) -> None:
        with self.condition:
            self.closed = True
            self.condition.notify_all()


def make_online_env(preset: str) -> Any:
    import gymnasium as gym

    class GymOnlineEnv(OnlineEnv, gym.Env):
        pass

    return GymOnlineEnv(preset)


class TrainingSession:
    def __init__(self) -> None:
        self.env: OnlineEnv | None = None
        self.model: Any = None
        self.thread: threading.Thread | None = None
        self.shadow_env: OnlineEnv | None = None
        self.shadow_model: Any = None
        self.shadow_thread: threading.Thread | None = None
        self.stop_requested = False
        self.shadow_stop_requested = False
        self.project_path: Path | None = None
        self.preset = "safe"
        self.message = "訓練引擎尚未啟動。"
        self.error = ""
        self.steps = 0
        self.mode = "idle"
        self.awaiting_next_round = False
        self.checkpoint_minutes = 5
        self.last_checkpoint_at = 0.0
        self.shadow_enabled = True
        self.full_online_requested = False
        self.resumed_from_stable = False

    def health(self) -> dict[str, Any]:
        status = modules()
        shadow = bool(self.project_path and (self.project_path / "shadow" / "ppo-shadow.zip").exists())
        stable = bool(
            self.project_path
            and (self.project_path / "stable" / "ppo-latest.zip").exists()
            and self.stable_is_visual()
        )
        return {
            "ready": bool(status["numpy"] and status["torch"] and status["gymnasium"] and status["stableBaselines3"]),
            "modules": status,
            "mode": self.mode,
            "steps": self.steps,
            "awaitingNextRound": self.awaiting_next_round,
            "fullOnlineUpdateActive": False,
            "shadowReady": shadow,
            "stableReady": stable,
            "resumedFromStable": self.resumed_from_stable,
            "observationMode": VISUAL_MODEL_SCHEMA,
            "neuralNetwork": {
                "visualEncoder": "NatureCNN",
                "frameStack": VISUAL_FRAME_STACK,
                "frameSize": [VISUAL_FRAME_WIDTH, VISUAL_FRAME_HEIGHT],
                "fusion": "CNN features + 8 game-state values",
                "policy": "PPO MultiInputPolicy",
            },
            "message": self.error or self.message,
        }

    def metadata_path(self) -> Path:
        assert self.project_path is not None
        return self.project_path / "stable" / "model-metadata.json"

    def write_metadata(self, source: str) -> None:
        path = self.metadata_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(
                {
                    "schema": VISUAL_MODEL_SCHEMA,
                    "visualEncoder": "NatureCNN",
                    "frameStack": VISUAL_FRAME_STACK,
                    "frameSize": [VISUAL_FRAME_WIDTH, VISUAL_FRAME_HEIGHT],
                    "stateValues": 8,
                    "actionValues": 12,
                    "source": source,
                    "updatedAt": time.time(),
                },
                ensure_ascii=False,
                indent=2,
            ) + "\n",
            encoding="utf-8",
        )

    def stable_is_visual(self) -> bool:
        if self.project_path is None:
            return False
        path = self.metadata_path()
        if not path.exists():
            return False
        try:
            return json.loads(path.read_text(encoding="utf-8")).get("schema") == VISUAL_MODEL_SCHEMA
        except (OSError, json.JSONDecodeError):
            return False

    def create_model(self, env: Any, tuning: dict[str, float]) -> Any:
        from stable_baselines3 import PPO

        return PPO(
            "MultiInputPolicy",
            env,
            verbose=0,
            device="auto",
            n_steps=32,
            batch_size=32,
            policy_kwargs={"net_arch": {"pi": [128, 64], "vf": [128, 64]}},
            **tuning,
        )

    def preserve_legacy_model(self, stable: Path) -> None:
        if not stable.exists() or self.project_path is None:
            return
        legacy = self.project_path / "legacy"
        legacy.mkdir(parents=True, exist_ok=True)
        backup = legacy / f"ppo-structured-{int(time.time())}.zip"
        shutil.copy2(stable, backup)

    def _learn(self, model: Any, shadow: bool = False) -> threading.Thread:
        def learn() -> None:
            try:
                def callback(_locals: dict[str, Any], _globals: dict[str, Any]) -> bool:
                    stopped = self.shadow_stop_requested if shadow else self.stop_requested
                    current = time.time()
                    if not stopped and self.project_path is not None and current - self.last_checkpoint_at >= self.checkpoint_minutes * 60:
                        target = self.project_path / "checkpoints" / f"{'shadow' if shadow else 'training'}-{int(current)}"
                        target.parent.mkdir(parents=True, exist_ok=True)
                        model.save(str(target))
                        self.last_checkpoint_at = current
                    return not stopped
                model.learn(total_timesteps=1_000_000, reset_num_timesteps=False, callback=callback)
            except Exception as error:
                if not (self.shadow_stop_requested if shadow else self.stop_requested):
                    self.error = f"{'影子模型' if shadow else '訓練'} worker 發生錯誤：{error}"
                    self.mode = "error"

        thread = threading.Thread(target=learn, daemon=True)
        thread.start()
        return thread

    def _stop_main_learning(self) -> None:
        self.stop_requested = True
        if self.env:
            self.env.close()
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=3)
        if self.thread and self.thread.is_alive():
            raise RuntimeError("訓練 worker 尚未停止，已阻止覆寫模型檔。")
        self.thread = None

    def _stop_shadow_learning(self, save: bool = True) -> None:
        self.shadow_stop_requested = True
        if self.shadow_env:
            self.shadow_env.close()
        if self.shadow_thread and self.shadow_thread.is_alive():
            self.shadow_thread.join(timeout=3)
        if self.shadow_thread and self.shadow_thread.is_alive():
            raise RuntimeError("影子模型 worker 尚未停止，已阻止覆寫模型檔。")
        if save and self.shadow_model is not None and self.project_path is not None:
            target = self.project_path / "shadow" / "ppo-shadow"
            target.parent.mkdir(parents=True, exist_ok=True)
            self.shadow_model.save(str(target))
        self.shadow_thread = None
        self.shadow_env = None
        self.shadow_model = None

    def _start_shadow_learning(self) -> None:
        from stable_baselines3 import PPO

        assert self.project_path is not None
        stable = self.project_path / "stable" / "ppo-latest.zip"
        shadow = self.project_path / "shadow" / "ppo-shadow.zip"
        source = shadow if shadow.exists() else stable
        self.shadow_env = make_online_env(self.preset)
        self.shadow_model = PPO.load(str(source), env=self.shadow_env, device="auto")
        self.shadow_stop_requested = False
        self.shadow_thread = self._learn(self.shadow_model, shadow=True)

    def start(self, project_path: str, preset: str, checkpoint_minutes: int = 5, exploration_rate: float = 0.1) -> dict[str, Any]:
        health = self.health()
        if not health["ready"]:
            return {**health, "message": "訓練套件尚未安裝。請先安裝 torch、gymnasium 與 stable-baselines3。"}
        requested_path = Path(project_path).resolve()
        if self.mode != "idle":
            if self.project_path != requested_path:
                return {**self.health(), "ready": False, "message": "另一個遊戲專案仍在訓練。請先停止並保存後再切換。"}
            return self.health()
        self.project_path = requested_path
        self.project_path.mkdir(parents=True, exist_ok=True)
        self.preset = preset if preset in EXPLORATION_PRESETS else "safe"
        self.env = make_online_env(self.preset)
        tuning = {**EXPLORATION_PRESETS[self.preset], "ent_coef": min(max(float(exploration_rate), 0.0), 1.0) * 0.1}
        stable = self.project_path / "stable" / "ppo-latest.zip"
        self.resumed_from_stable = stable.exists() and self.stable_is_visual()
        if self.resumed_from_stable:
            from stable_baselines3 import PPO

            self.model = PPO.load(str(stable), env=self.env, device="auto")
        else:
            self.preserve_legacy_model(stable)
            self.model = self.create_model(self.env, tuning)
        self.stop_requested = False
        self.awaiting_next_round = False
        self.checkpoint_minutes = min(max(int(checkpoint_minutes), 1), 1440)
        self.last_checkpoint_at = time.time()
        self.thread = self._learn(self.model)
        self.mode = "training"
        self.message = (
            "PPO 已讀取上次穩定模型，正在等待真實鏡頭畫格並繼續收集探索經驗。"
            if self.resumed_from_stable
            else "CNN 視覺融合 PPO 正在等待真實鏡頭畫格並收集探索經驗。"
        )
        self.error = ""
        return self.health()

    def start_live(self, project_path: str, preset: str, checkpoint_minutes: int = 5, live_policy: dict[str, Any] | None = None) -> dict[str, Any]:
        health = self.health()
        if not health["ready"]:
            return {**health, "message": "正式遊玩需要先安裝本地訓練套件。"}
        requested_path = Path(project_path).resolve()
        stable = requested_path / "stable" / "ppo-latest.zip"
        if not stable.exists():
            return {**health, "stableReady": False, "message": "尚未保存穩定模型。請先停止一次實機訓練並保存模型。"}
        self.project_path = requested_path
        if not self.stable_is_visual():
            return {**health, "stableReady": False, "message": "現有模型是舊版 8 數值模型。請重新進行一次視覺融合訓練並保存。"}
        if self.mode != "idle":
            self.stop()
        from stable_baselines3 import PPO

        self.preset = preset if preset in EXPLORATION_PRESETS else "safe"
        policy = live_policy if isinstance(live_policy, dict) else {}
        self.shadow_enabled = policy.get("shadowModel", True) is not False
        self.full_online_requested = policy.get("fullOnlineUpdate", False) is True
        self.checkpoint_minutes = min(max(int(checkpoint_minutes), 1), 1440)
        self.last_checkpoint_at = time.time()
        self.env = make_online_env(self.preset)
        self.model = PPO.load(str(stable), env=self.env, device="auto")
        self.resumed_from_stable = True
        if self.shadow_enabled:
            self._start_shadow_learning()
        self.awaiting_next_round = False
        self.mode = "live"
        self.message = "正式遊玩已啟動：穩定模型負責控制。"
        if self.shadow_enabled:
            self.message += "影子模型在背景持續學習。"
        if self.full_online_requested:
            self.message += "全程直接更新主 AI 尚未啟用；目前仍使用可回滾的旁路更新。"
        return self.health()

    def frame(self, state: dict[str, Any], image_b64: str = "") -> dict[str, Any]:
        if not self.env or self.mode not in {"training", "live", "canary"}:
            return {"action": None, **self.health()}
        if self.awaiting_next_round:
            return {"action": None, **self.health(), "message": "回合已結束。請由使用者按「開始下一回合」後再繼續。"}
        if not state.get("ready") or float(state.get("confidence") or 0) < float(state.get("confidenceThreshold") or 0.45):
            return {"action": None, **self.health(), "message": "畫面辨識信心不足，已停止送出新動作。請重新確認畫面。"}
        if state.get("failed"):
            if self.mode == "training":
                self.env.accept_frame(state, image_b64)
            else:
                self.env.set_state(state, image_b64)
            self.awaiting_next_round = True
            self.message = "回合已結束，已回中立。請由使用者按「開始下一回合」。"
            return {"action": None, **self.health()}
        if self.mode == "training":
            action = self.env.accept_frame(state, image_b64)
        else:
            self.env.set_state(state, image_b64)
            action, _state = self.model.predict(self.env.observation(), deterministic=True)
            if self.mode == "live" and self.shadow_env is not None:
                self.shadow_env.accept_frame(state, image_b64)
        self.steps += 1
        return {
            "action": translate_action(action, str(state.get("frameId", "")), dict(state.get("guidanceActionRules") or {})) if action is not None else None,
            **self.health(),
        }

    def pretrain_demonstrations(self, project_path: str, dataset_path: str, epochs: int = 2) -> dict[str, Any]:
        health = self.health()
        if not health["ready"]:
            return {**health, "ok": False, "message": "示範暖身需要 PyTorch、OpenCV、Gymnasium 與 Stable-Baselines3。"}
        if self.mode != "idle":
            return {**health, "ok": False, "message": "請先停止實機訓練或正式遊玩，再執行示範暖身。"}
        requested_path = Path(project_path).resolve()
        demonstrations = Path(dataset_path).resolve()
        if not demonstrations.is_file():
            return {**health, "ok": False, "message": "目前沒有同步的畫面與控制器示範資料。"}
        executions = demonstrations.parent / "executions.jsonl"
        executed_action_ids: set[str] = set()
        if executions.is_file():
            for line in executions.read_text(encoding="utf-8").splitlines()[-10000:]:
                try:
                    feedback = json.loads(line)
                    if feedback.get("status") == "executed":
                        executed_action_ids.add(str(feedback.get("actionId", "")))
                except json.JSONDecodeError:
                    continue
        records = []
        for line in demonstrations.read_text(encoding="utf-8").splitlines()[-5000:]:
            try:
                item = json.loads(line)
                action_id = str((item.get("action") or {}).get("id", ""))
                if action_id not in executed_action_ids:
                    continue
                image_path = (demonstrations.parent / str(item.get("imagePath", ""))).resolve()
                project_root = requested_path.parent
                if image_path.is_file() and project_root in image_path.parents:
                    records.append((item, image_path))
            except (OSError, json.JSONDecodeError):
                continue
        if not records:
            return {**health, "ok": False, "message": "沒有已確認執行成功的同步示範。請確認控制後端已連線，再重新錄製。"}

        import torch
        from stable_baselines3 import PPO

        self.project_path = requested_path
        self.env = make_online_env("safe")
        stable = self.project_path / "stable" / "ppo-latest.zip"
        if stable.exists() and self.stable_is_visual():
            self.model = PPO.load(str(stable), env=self.env, device="auto")
        else:
            self.preserve_legacy_model(stable)
            self.model = self.create_model(self.env, EXPLORATION_PRESETS["safe"])
        losses: list[float] = []
        completed = 0
        self.model.policy.set_training_mode(True)
        for _epoch in range(min(max(int(epochs), 1), 20)):
            for item, image_path in records:
                image_b64 = base64.b64encode(image_path.read_bytes()).decode("ascii")
                self.env.set_state(dict(item.get("state") or {}), image_b64)
                observation, _vectorized = self.model.policy.obs_to_tensor(self.env.observation())
                action = action_vector(dict(item.get("action") or {}))
                action_tensor = torch.as_tensor(action, dtype=torch.float32, device=self.model.device).reshape(1, -1)
                distribution = self.model.policy.get_distribution(observation)
                loss = -distribution.log_prob(action_tensor).mean()
                self.model.policy.optimizer.zero_grad()
                loss.backward()
                torch.nn.utils.clip_grad_norm_(self.model.policy.parameters(), 0.5)
                self.model.policy.optimizer.step()
                losses.append(float(loss.detach().cpu().item()))
                completed += 1
        target = self.project_path / "stable" / "ppo-latest"
        target.parent.mkdir(parents=True, exist_ok=True)
        self.model.save(str(target))
        self.write_metadata("gamepad_demonstration")
        self.env.close()
        self.env = None
        self.model = None
        self.message = f"已用 {len(records)} 筆同步示範完成視覺暖身。"
        return {
            "ok": True,
            "samples": len(records),
            "updates": completed,
            "meanLoss": round(sum(losses) / len(losses), 5) if losses else None,
            "modelSaved": True,
            **self.health(),
        }

    def next_round(self) -> dict[str, Any]:
        if self.mode not in {"training", "live", "canary"}:
            return {"ok": False, "message": "訓練或正式遊玩尚未啟動。", **self.health()}
        self.awaiting_next_round = False
        self.message = "已開始下一回合，等待新的真實鏡頭畫格。"
        return {"ok": True, **self.health()}

    def stop(self) -> dict[str, Any]:
        was_training = self.mode == "training"
        if self.thread:
            self._stop_main_learning()
        elif self.env:
            self.env.close()
        self._stop_shadow_learning(save=True)
        saved = was_training and self.model is not None and self.project_path is not None
        if saved:
            target = self.project_path / "stable" / "ppo-latest"
            target.parent.mkdir(parents=True, exist_ok=True)
            self.model.save(str(target))
            self.write_metadata("ppo_online_training")
            shadow = self.project_path / "shadow" / "ppo-shadow"
            shadow.parent.mkdir(parents=True, exist_ok=True)
            self.model.save(str(shadow))
        self.env = None
        self.model = None
        self.mode = "idle"
        self.awaiting_next_round = False
        self.message = "已停止控制。實機訓練 checkpoint 與影子模型已按目前狀態保存。"
        return {"modelSaved": saved, **self.health()}

    def canary(self, project_path: str, confirm: bool) -> dict[str, Any]:
        if self.project_path is None:
            return {"ok": False, "message": "尚未啟動訓練引擎。"}
        if self.project_path != Path(project_path).resolve():
            return {"ok": False, "message": "目前影子模型屬於另一個遊戲專案，已阻止切換。"}
        if self.mode != "live":
            return {"ok": False, "message": "請先啟動正式遊玩，再確認影子模型短時間試跑。"}
        shadow = self.project_path / "shadow" / "ppo-shadow.zip"
        if not shadow.exists():
            return {"ok": False, "message": "尚未累積足夠實機探索資料，沒有可試跑的影子模型。"}
        if not confirm:
            return {"ok": True, "requiresConfirmation": True, "message": "影子模型已通過檔案檢查。確認後才會在下一回合進行短時間實機試跑。"}
        from stable_baselines3 import PPO

        assert self.env is not None
        self._stop_shadow_learning(save=True)
        stable = self.project_path / "stable" / "ppo-latest.zip"
        backup = self.project_path / "stable" / "ppo-before-canary.zip"
        if stable.exists():
            shutil.copy2(stable, backup)
        self.model = PPO.load(str(shadow), env=self.env, device="auto")
        self.mode = "canary"
        self.message = "影子模型正在短時間實機試跑。表現下降時請立即按回滾。"
        return {"ok": True, "requiresConfirmation": False, "message": self.message, **self.health()}

    def rollback(self, project_path: str) -> dict[str, Any]:
        if self.project_path is None or self.env is None:
            return {"ok": False, "message": "尚未啟動訓練引擎，沒有可回滾的模型。"}
        if self.project_path != Path(project_path).resolve():
            return {"ok": False, "message": "目前穩定模型屬於另一個遊戲專案，已阻止回滾。"}
        if self.mode not in {"live", "canary"}:
            return {"ok": False, "message": "目前不是正式遊玩或試跑模式，不需要回滾。"}
        from stable_baselines3 import PPO

        backup = self.project_path / "stable" / "ppo-before-canary.zip"
        stable = self.project_path / "stable" / "ppo-latest.zip"
        source = backup if backup.exists() else stable
        if not source.exists():
            return {"ok": False, "message": "尚未保存穩定模型，無法回滾。"}
        self._stop_shadow_learning(save=True)
        self.model = PPO.load(str(source), env=self.env, device="auto")
        self.mode = "live"
        self._start_shadow_learning()
        self.message = "已回滾到上一次穩定模型。"
        return {"ok": True, "message": self.message, **self.health()}


def translate_action(action: list[float] | None, frame_id: str = "", action_rules: dict[str, Any] | None = None) -> dict[str, Any] | None:
    if action is None:
        return None
    values = list(action) + [0.0] * (12 - len(action))
    rules = action_rules if isinstance(action_rules, dict) else {}
    item_mode = str(rules.get("itemUseMode", ""))
    item_inputs = set(rules.get("itemInputs") or [])
    thresholds = {button: 0.65 for button in SAFE_BUTTONS}
    if item_mode in {"conservative", "aggressive"}:
        for button in item_inputs.intersection(SAFE_BUTTONS):
            thresholds[button] = 0.85 if item_mode == "conservative" else 0.45
    return {
        "id": uuid.uuid4().hex,
        "sourceFrameId": frame_id,
        "durationMs": 120,
        "sticks": {
            "left_stick_x": round(values[0] * 100),
            "left_stick_y": round(values[1] * 100),
            "right_stick_x": round(values[2] * 100),
            "right_stick_y": round(values[3] * 100),
        },
        "buttons": {button: values[index + 4] > thresholds[button] for index, button in enumerate(SAFE_BUTTONS)},
    }


def action_vector(action: dict[str, Any]) -> list[float]:
    sticks = action.get("sticks") if isinstance(action.get("sticks"), dict) else {}
    buttons = action.get("buttons") if isinstance(action.get("buttons"), dict) else {}
    values = [
        min(max(float(sticks.get("left_stick_x", 0)) / 100, -1.0), 1.0),
        min(max(float(sticks.get("left_stick_y", 0)) / 100, -1.0), 1.0),
        min(max(float(sticks.get("right_stick_x", 0)) / 100, -1.0), 1.0),
        min(max(float(sticks.get("right_stick_y", 0)) / 100, -1.0), 1.0),
    ]
    values.extend(1.0 if buttons.get(button) else -1.0 for button in SAFE_BUTTONS)
    return values


def warmup_video(path_value: str) -> dict[str, Any]:
    if not modules()["opencv"]:
        return {"ok": False, "extractedFrames": 0, "message": "影片已保存。安裝 OpenCV 後重新匯入，即可抽取畫面暖身資料。"}
    import cv2

    path = Path(path_value)
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        return {"ok": False, "extractedFrames": 0, "message": "影片已保存，但 OpenCV 無法讀取此格式。"}
    fps = max(1, round(capture.get(cv2.CAP_PROP_FPS) or 30))
    output = path.parent / f"{path.stem}-warmup"
    output.mkdir(parents=True, exist_ok=True)
    extracted = 0
    index = 0
    while extracted < 600:
        ok, frame = capture.read()
        if not ok:
            break
        if index % fps == 0:
            frame_path = output / f"frame-{extracted:05d}.jpg"
            cv2.imwrite(str(frame_path), frame)
            metadata: dict[str, Any] = {"frame": frame_path.name, "sourceSecond": extracted}
            try:
                ok_encoded, encoded = cv2.imencode(".jpg", frame)
                if ok_encoded:
                    metadata["ocr"] = OCR.read(base64.b64encode(encoded.tobytes()).decode("ascii"), ["ch_tra", "en"])
            except Exception as error:
                metadata["ocrError"] = str(error)
            with (output / "warmup-index.jsonl").open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(metadata, ensure_ascii=False, separators=(",", ":")) + "\n")
            extracted += 1
        index += 1
    capture.release()
    return {"ok": True, "extractedFrames": extracted, "message": f"影片暖身已抽取 {extracted} 張畫格。影片沒有搖桿標籤，不會假裝能還原操作。"}


OCR = OcrEngine()
TRAINING = TrainingSession()


def handle(payload: dict[str, Any]) -> dict[str, Any]:
    command = payload.get("command")
    if command == "health":
        return {"workerReady": True, "ocr": modules()["easyocr"], "training": TRAINING.health()}
    if command == "ocr":
        return OCR.read(str(payload.get("imageBase64", "")), list(payload.get("languages") or []), dict(payload.get("rewardConfig") or {}))
    if command == "engine_start":
        return TRAINING.start(
            str(payload.get("projectPath", "")),
            str(payload.get("preset", "safe")),
            int(payload.get("checkpointMinutes", 5)),
            float(payload.get("explorationRate", 0.1)),
        )
    if command == "engine_live":
        return TRAINING.start_live(
            str(payload.get("projectPath", "")),
            str(payload.get("preset", "safe")),
            int(payload.get("checkpointMinutes", 5)),
            dict(payload.get("livePolicy") or {}),
        )
    if command == "engine_frame":
        return TRAINING.frame(dict(payload.get("state") or {}), str(payload.get("imageBase64", "")))
    if command == "demonstration_train":
        return TRAINING.pretrain_demonstrations(
            str(payload.get("projectPath", "")),
            str(payload.get("datasetPath", "")),
            int(payload.get("epochs", 2)),
        )
    if command == "engine_stop":
        return TRAINING.stop()
    if command == "next_round":
        return TRAINING.next_round()
    if command == "video_warmup":
        return warmup_video(str(payload.get("path", "")))
    if command == "canary":
        return TRAINING.canary(str(payload.get("projectPath", "")), bool(payload.get("confirm", False)))
    if command == "rollback":
        return TRAINING.rollback(str(payload.get("projectPath", "")))
    raise ValueError(f"Unknown worker command: {command}")


def main() -> int:
    for line in sys.stdin:
        try:
            payload = json.loads(line)
            response = {"id": payload.get("id") or uuid.uuid4().hex, "ok": True, "result": handle(payload)}
        except Exception as error:
            response = {"id": locals().get("payload", {}).get("id", ""), "ok": False, "error": str(error)}
        print(json.dumps(response, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
