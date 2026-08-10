#!/usr/bin/env python3
"""Local backend for the Switch 2 AI controller rig.

The backend intentionally uses only the Python standard library. It persists
projects, settings, snapshots and logs while keeping hardware runtime state
ephemeral. Optional ML dependencies run in an isolated worker process.
"""

from __future__ import annotations

import argparse
from functools import wraps
import ipaddress
import json
import os
import re
import secrets
import shutil
import stat
import tempfile
import threading
import time
import uuid
import zipfile
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse
import urllib.error
import urllib.request

try:
    from runtime_capabilities import capability_report, refresh_capability_report
except ModuleNotFoundError:
    from server.runtime_capabilities import capability_report, refresh_capability_report
try:
    from runtime_services import RuntimeServices, ServiceError
except ModuleNotFoundError:
    from server.runtime_services import RuntimeServices, ServiceError


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
PROJECTS = DATA / "projects"
TRASH = DATA / "trash"
PRESETS = DATA / "presets"
APP_SETTINGS = DATA / "app-settings.json"
GLOBAL_DEFAULTS = DATA / "global-defaults.json"
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
MAX_BODY = 128 * 1024 * 1024
MAX_ZIP_FILES = 10000
MAX_ZIP_UNCOMPRESSED = 1024 * 1024 * 1024
STATIC_FILES = {
    "/",
    "/index.html",
    "/monitor.html",
    "/styles.css",
    "/src/app.js",
    "/src/browser-core.js",
    "/src/monitor.js",
    "/src/product-ui.js",
}
RUNTIME_KEYS = {
    "cameraConnected",
    "cameraReady",
    "cameraCalibrated",
    "cameraStream",
    "serialPort",
    "connectionOk",
    "externalPowerOk",
    "emergencyStopOk",
    "nxbtReady",
    "calibratedSlotIds",
    "trainingEngineReady",
    "liveEngineReady",
}
NXBT_TEST_BUTTONS = {
    "a", "b", "x", "y", "l", "r", "zl", "zr",
    "dpad_up", "dpad_down", "dpad_left", "dpad_right",
    "plus", "minus", "left_stick_press", "right_stick_press",
}
NXBT_TEST_STICK_DIRECTIONS = {
    "left": (-100, 0),
    "right": (100, 0),
    "up": (0, -100),
    "down": (0, 100),
}


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_name = ""
    try:
        with tempfile.NamedTemporaryFile(
            "w", encoding="utf-8", dir=path.parent, delete=False, suffix=".tmp"
        ) as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            temp_name = handle.name
        os.replace(temp_name, path)
    finally:
        if temp_name and os.path.exists(temp_name):
            os.unlink(temp_name)


def atomic_bytes(path: Path, value: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_name = ""
    try:
        with tempfile.NamedTemporaryFile("wb", dir=path.parent, delete=False, suffix=".tmp") as handle:
            handle.write(value)
            temp_name = handle.name
        os.replace(temp_name, path)
    finally:
        if temp_name and os.path.exists(temp_name):
            os.unlink(temp_name)


def read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def append_jsonl(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")


def clean_runtime_state(value: Any) -> Any:
    if not isinstance(value, dict):
        return {}
    return {key: item for key, item in value.items() if key not in RUNTIME_KEYS}


DEFAULT_SETTINGS: dict[str, Any] = {
    "general": {
        "autoOpenLastProject": True,
        "language": "zh-Hant",
        "pauseButton": "",
        "gameType": "racing",
    },
    "camera": {
        "deviceId": "",
        "width": 1280,
        "height": 720,
        "fps": 30,
        "confidenceThreshold": 0.75,
        "clipSecondsBefore": 5,
        "clipSecondsAfter": 5,
    },
    "vision": {
        "ocrEnabled": True,
        "ocrLanguages": "ch_tra,en",
        "ocrEverySeconds": 1,
        "inferenceFps": 5,
        "datasetSampleFps": 2,
        "localVisionLlmEverySeconds": 15,
    },
    "controller": {
        "profile": "switch2_pro",
        "baudRate": 115200,
        "maxCommandMs": 1500,
        "maxPressMs": 1500,
        "maxTravelMm": 12,
        "lostConnectionReturnHomeMs": 500,
    },
    "output": {
        "backend": "mechanical_rig",
        "commandRateHz": 10,
        "nxbtReconnect": True,
        "nxbtHost": "127.0.0.1",
        "nxbtPort": 8766,
    },
    "training": {
        "videoPretraining": True,
        "liveTraining": True,
        "captureGamepadDemonstrations": True,
        "demonstrationEpochs": 2,
        "gamepadLeftXAxis": 0,
        "gamepadLeftYAxis": 1,
        "gamepadRightXAxis": 2,
        "gamepadRightYAxis": 3,
        "gamepadButtonA": 0,
        "gamepadButtonB": 1,
        "gamepadButtonX": 2,
        "gamepadButtonY": 3,
        "gamepadButtonL": 4,
        "gamepadButtonR": 5,
        "gamepadButtonZL": 6,
        "gamepadButtonZR": 7,
        "explorationPreset": "safe",
        "explorationRate": 0.1,
        "checkpointEveryMinutes": 5,
    },
    "liveLearning": {
        "safeAdaptation": True,
        "shadowModel": True,
        "fullOnlineUpdate": False,
        "updateEverySeconds": 20,
        "switchThresholdPercent": 8,
        "rollbackDropPercent": 12,
    },
    "reward": {
        "rankWeight": 1.0,
        "speedWeight": 1.0,
        "progressWeight": 1.0,
        "crashPenalty": 18,
        "fallingBehindPenalty": 10,
        "failurePenalty": 35,
        "itemEffectBonus": 8,
    },
    "monitor": {
        "autoOpen": True,
        "windowMode": "inline",
        "showAnnotations": True,
        "showDetails": False,
    },
    "assistant": {
        "defaultGuidanceStrength": 2,
    },
    "menuNavigation": {
        "actionDurationMs": 120,
        "maxSteps": 20,
        "timeoutSeconds": 60,
        "minimumConfidence": 0.6,
        "gamepadDpadUpButton": 12,
        "gamepadDpadDownButton": 13,
        "gamepadDpadLeftButton": 14,
        "gamepadDpadRightButton": 15,
        "gamepadPlusButton": 9,
        "gamepadMinusButton": 8,
    },
    "storage": {
        "autosaveMode": "five_minutes_and_round_end",
        "retentionMode": "size_limit",
        "maxLogGb": 5,
        "trashDays": 30,
        "datasetMaxGb": 20,
    },
    "logging": {
        "events": True,
        "actions": True,
        "importantClips": True,
        "minimumSeverity": "info",
    },
    "safety": {
        "requireCameraPreview": True,
        "requireBoardVerification": True,
        "requireEmergencyStopTest": True,
        "abnormalActionDetection": True,
    },
}


BUILTIN_PRESETS = {
    "beginner": {"name": "新手推薦", "settings": DEFAULT_SETTINGS},
    "racing": {
        "name": "賽車遊戲",
        "settings": {
            "general": {"gameType": "racing"},
            "camera": {"fps": 30, "confidenceThreshold": 0.75},
            "output": {"commandRateHz": 12},
            "liveLearning": {"safeAdaptation": True, "shadowModel": True},
        },
    },
    "diagnostic": {
        "name": "診斷除錯",
        "settings": {
            "monitor": {"showAnnotations": True, "showDetails": True},
            "logging": {"events": True, "actions": True, "importantClips": True},
        },
    },
}

HARD_LIMITS = {
    ("camera", "width"): (320, 3840),
    ("camera", "height"): (240, 2160),
    ("camera", "fps"): (1, 120),
    ("camera", "confidenceThreshold"): (0, 1),
    ("camera", "clipSecondsBefore"): (0, 60),
    ("camera", "clipSecondsAfter"): (0, 60),
    ("vision", "ocrEverySeconds"): (0.2, 60),
    ("vision", "inferenceFps"): (1, 15),
    ("vision", "datasetSampleFps"): (0.2, 10),
    ("vision", "localVisionLlmEverySeconds"): (5, 3600),
    ("controller", "baudRate"): (1200, 3000000),
    ("controller", "maxCommandMs"): (20, 2000),
    ("controller", "maxPressMs"): (20, 2000),
    ("controller", "maxTravelMm"): (1, 20),
    ("controller", "lostConnectionReturnHomeMs"): (50, 10000),
    ("output", "commandRateHz"): (1, 60),
    ("output", "nxbtPort"): (1, 65535),
    ("training", "explorationRate"): (0, 1),
    ("training", "demonstrationEpochs"): (1, 20),
    ("training", "gamepadLeftXAxis"): (0, 15),
    ("training", "gamepadLeftYAxis"): (0, 15),
    ("training", "gamepadRightXAxis"): (0, 15),
    ("training", "gamepadRightYAxis"): (0, 15),
    ("training", "gamepadButtonA"): (0, 31),
    ("training", "gamepadButtonB"): (0, 31),
    ("training", "gamepadButtonX"): (0, 31),
    ("training", "gamepadButtonY"): (0, 31),
    ("training", "gamepadButtonL"): (0, 31),
    ("training", "gamepadButtonR"): (0, 31),
    ("training", "gamepadButtonZL"): (0, 31),
    ("training", "gamepadButtonZR"): (0, 31),
    ("training", "checkpointEveryMinutes"): (1, 1440),
    ("liveLearning", "updateEverySeconds"): (1, 3600),
    ("liveLearning", "switchThresholdPercent"): (0, 100),
    ("liveLearning", "rollbackDropPercent"): (0, 100),
    ("reward", "rankWeight"): (0, 100),
    ("reward", "speedWeight"): (0, 100),
    ("reward", "progressWeight"): (0, 100),
    ("reward", "crashPenalty"): (0, 1000),
    ("reward", "fallingBehindPenalty"): (0, 1000),
    ("reward", "failurePenalty"): (0, 1000),
    ("reward", "itemEffectBonus"): (0, 1000),
    ("assistant", "defaultGuidanceStrength"): (1, 3),
    ("menuNavigation", "actionDurationMs"): (20, 250),
    ("menuNavigation", "maxSteps"): (1, 20),
    ("menuNavigation", "timeoutSeconds"): (10, 60),
    ("menuNavigation", "minimumConfidence"): (0.4, 0.9),
    ("menuNavigation", "gamepadDpadUpButton"): (0, 31),
    ("menuNavigation", "gamepadDpadDownButton"): (0, 31),
    ("menuNavigation", "gamepadDpadLeftButton"): (0, 31),
    ("menuNavigation", "gamepadDpadRightButton"): (0, 31),
    ("menuNavigation", "gamepadPlusButton"): (0, 31),
    ("menuNavigation", "gamepadMinusButton"): (0, 31),
    ("storage", "maxLogGb"): (0.1, 100),
    ("storage", "trashDays"): (1, 365),
    ("storage", "datasetMaxGb"): (1, 500),
}


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def synchronized(method: Any) -> Any:
    @wraps(method)
    def wrapper(self: "Store", *args: Any, **kwargs: Any) -> Any:
        with self.lock:
            return method(self, *args, **kwargs)

    return wrapper


class Store:
    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.monitor: dict[str, dict[str, Any]] = {}
        self.nxbt_connectors: dict[str, dict[str, Any]] = {}
        self.nxbt_test_prepared: dict[str, set[str]] = {}
        self.shutdown_started = False
        self.ensure_layout()
        self.services = RuntimeServices(ROOT, DATA, PROJECTS, DATA.parent / ".runtime")

    def ensure_layout(self) -> None:
        for path in (DATA, PROJECTS, TRASH, PRESETS):
            path.mkdir(parents=True, exist_ok=True)
        if not APP_SETTINGS.exists():
            atomic_json(APP_SETTINGS, {"lastProjectId": "", "createdAt": utc_now()})
        if not GLOBAL_DEFAULTS.exists():
            atomic_json(GLOBAL_DEFAULTS, DEFAULT_SETTINGS)
        for preset_id, payload in BUILTIN_PRESETS.items():
            path = PRESETS / f"{preset_id}.json"
            if not path.exists():
                atomic_json(path, {"id": preset_id, "builtin": True, **payload})
        self.purge_expired_trash()

    def project_path(self, project_id: str) -> Path:
        if not ID_RE.fullmatch(project_id):
            raise ApiError(HTTPStatus.BAD_REQUEST, "Invalid project id.")
        return PROJECTS / project_id

    def trash_path(self, project_id: str) -> Path:
        if not ID_RE.fullmatch(project_id):
            raise ApiError(HTTPStatus.BAD_REQUEST, "Invalid project id.")
        return TRASH / project_id

    def require_project(self, project_id: str) -> Path:
        path = self.project_path(project_id)
        if not path.is_dir():
            raise ApiError(HTTPStatus.NOT_FOUND, "Project not found.")
        return path

    def list_projects(self) -> list[dict[str, Any]]:
        projects = []
        for path in sorted(PROJECTS.iterdir()):
            if path.is_dir() and ID_RE.fullmatch(path.name):
                projects.append(read_json(path / "manifest.json", {"id": path.name}))
        return sorted(projects, key=lambda item: item.get("updatedAt", ""), reverse=True)

    def list_trash(self) -> list[dict[str, Any]]:
        items = []
        for path in sorted(TRASH.iterdir()):
            if path.is_dir() and ID_RE.fullmatch(path.name):
                items.append(read_json(path / "manifest.json", {"id": path.name}))
        return sorted(items, key=lambda item: item.get("deletedAt", ""), reverse=True)

    @synchronized
    def create_project(self, payload: dict[str, Any]) -> dict[str, Any]:
        name = str(payload.get("name", "")).strip()
        if not name:
            raise ApiError(HTTPStatus.BAD_REQUEST, "Project name is required.")
        project_id = uuid.uuid4().hex[:16]
        path = self.project_path(project_id)
        path.mkdir(parents=True)
        for child in ("checkpoints", "snapshots", "models", "datasets", "logs", "clips"):
            (path / child).mkdir()
        now = utc_now()
        manifest = {
            "id": project_id,
            "name": name[:120],
            "gameType": str(payload.get("gameType", "racing"))[:50],
            "createdAt": now,
            "updatedAt": now,
            "lastOpenedAt": now,
            "modelVersion": "",
        }
        atomic_json(path / "manifest.json", manifest)
        atomic_json(path / "settings.json", {})
        atomic_json(path / "current-state.json", self.default_state())
        self.services.ensure_project_layout(project_id)
        self.set_last_project(project_id)
        self.log(project_id, "info", "project", "project_created", {"name": name})
        return self.load_project(project_id)

    def default_state(self) -> dict[str, Any]:
        return {
            "activeStepId": "device_check",
            "completedSteps": [],
            "trainingSeconds": 0,
            "bestScore": 0,
            "currentScore": 0,
            "previousStableScore": 0,
            "needsRecalibration": False,
            "modelReady": False,
            "importedVideoName": "",
            "updatedAt": utc_now(),
        }

    @synchronized
    def load_project(self, project_id: str, mark_opened: bool = True) -> dict[str, Any]:
        path = self.require_project(project_id)
        manifest = read_json(path / "manifest.json", {"id": project_id})
        state = clean_runtime_state(read_json(path / "current-state.json", self.default_state()))
        if mark_opened:
            manifest["lastOpenedAt"] = utc_now()
            manifest["updatedAt"] = manifest.get("updatedAt", utc_now())
            atomic_json(path / "manifest.json", manifest)
            self.set_last_project(project_id)
        return {
            "manifest": manifest,
            "state": state,
            "settings": self.get_project_settings(project_id),
            "snapshots": self.list_snapshots(project_id),
            "runtime": self.runtime_status(project_id),
        }

    @synchronized
    def open_project(self, project_id: str) -> dict[str, Any]:
        self.require_project(project_id)
        self.services.stop_active_engine()
        self.monitor.pop(project_id, None)
        self.reset_all_nxbt_connectors()
        self.log(project_id, "info", "project", "project_opened_runtime_reset", {})
        return self.load_project(project_id)

    @synchronized
    def rename_project(self, project_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        path = self.require_project(project_id)
        manifest = read_json(path / "manifest.json", {})
        name = str(payload.get("name", "")).strip()
        if not name:
            raise ApiError(HTTPStatus.BAD_REQUEST, "Project name is required.")
        manifest["name"] = name[:120]
        manifest["updatedAt"] = utc_now()
        atomic_json(path / "manifest.json", manifest)
        self.log(project_id, "info", "project", "project_renamed", {"name": name})
        return manifest

    @synchronized
    def set_last_project(self, project_id: str) -> None:
        settings = read_json(APP_SETTINGS, {})
        settings["lastProjectId"] = project_id
        settings["updatedAt"] = utc_now()
        atomic_json(APP_SETTINGS, settings)

    @synchronized
    def app_settings(self) -> dict[str, Any]:
        settings = read_json(APP_SETTINGS, {})
        last_id = settings.get("lastProjectId", "")
        if last_id and (not isinstance(last_id, str) or not ID_RE.fullmatch(last_id) or not (PROJECTS / last_id).is_dir()):
            settings["lastProjectId"] = ""
            atomic_json(APP_SETTINGS, settings)
        return settings

    @synchronized
    def save_state(self, project_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        path = self.require_project(project_id)
        state = clean_runtime_state(payload)
        state["updatedAt"] = utc_now()
        atomic_json(path / "current-state.json", state)
        manifest = read_json(path / "manifest.json", {"id": project_id})
        manifest["updatedAt"] = utc_now()
        atomic_json(path / "manifest.json", manifest)
        self.log(project_id, "info", "storage", "state_saved", {"reason": payload.get("saveReason", "manual")})
        return state

    def deep_merge(self, base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
        merged = json.loads(json.dumps(base))
        for key, value in override.items():
            if isinstance(value, dict) and isinstance(merged.get(key), dict):
                merged[key] = self.deep_merge(merged[key], value)
            else:
                merged[key] = value
        return merged

    def enforce_controller_backend_compatibility(self, settings: dict[str, Any]) -> dict[str, Any]:
        safe = json.loads(json.dumps(settings))
        backend = safe.get("output", {}).get("backend")
        if backend in {"nxbt_bluetooth", "hybrid"}:
            safe.setdefault("controller", {})["profile"] = "switch2_pro"
        return safe

    def get_global_settings(self) -> dict[str, Any]:
        stored = read_json(GLOBAL_DEFAULTS, DEFAULT_SETTINGS)
        try:
            return self.enforce_controller_backend_compatibility(self.normalize_settings(stored, merge_defaults=True))
        except ApiError:
            return json.loads(json.dumps(DEFAULT_SETTINGS))

    @synchronized
    def put_global_settings(self, payload: dict[str, Any]) -> dict[str, Any]:
        safe = self.enforce_controller_backend_compatibility(self.normalize_settings(payload, merge_defaults=True))
        atomic_json(GLOBAL_DEFAULTS, safe)
        return safe

    def get_project_settings(self, project_id: str) -> dict[str, Any]:
        path = self.require_project(project_id)
        override = read_json(path / "settings.json", {})
        try:
            override = self.normalize_settings(override)
        except ApiError:
            override = {}
        defaults = self.get_global_settings()
        effective = self.enforce_controller_backend_compatibility(self.deep_merge(defaults, override))
        return {
            "defaults": defaults,
            "overrides": override,
            "effective": effective,
        }

    @synchronized
    def put_project_settings(self, project_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        path = self.require_project(project_id)
        safe = self.normalize_settings(payload)
        effective = self.enforce_controller_backend_compatibility(self.deep_merge(self.get_global_settings(), safe))
        if effective["output"]["backend"] in {"nxbt_bluetooth", "hybrid"}:
            safe.setdefault("controller", {})["profile"] = "switch2_pro"
        atomic_json(path / "settings.json", safe)
        self.log(project_id, "info", "settings", "project_settings_updated", {})
        return self.get_project_settings(project_id)

    def enforce_hard_limits(self, payload: dict[str, Any]) -> dict[str, Any]:
        safe = json.loads(json.dumps(payload))
        for keys, (minimum, maximum) in HARD_LIMITS.items():
            category, field = keys
            category_value = safe.get(category, {})
            if not isinstance(category_value, dict):
                raise ApiError(HTTPStatus.BAD_REQUEST, f"{category} must be an object.")
            value = category_value.get(field)
            if value is None:
                continue
            if not isinstance(value, (int, float)) or isinstance(value, bool):
                raise ApiError(HTTPStatus.BAD_REQUEST, f"{category}.{field} must be a number.")
            safe[category][field] = min(max(value, minimum), maximum)
        return safe

    def normalize_settings(self, payload: Any, merge_defaults: bool = False) -> dict[str, Any]:
        if not isinstance(payload, dict):
            raise ApiError(HTTPStatus.BAD_REQUEST, "Settings must be an object.")
        for category, fields in payload.items():
            if category not in DEFAULT_SETTINGS:
                raise ApiError(HTTPStatus.BAD_REQUEST, f"Unknown settings category: {category}.")
            if not isinstance(fields, dict):
                raise ApiError(HTTPStatus.BAD_REQUEST, f"{category} must be an object.")
            unknown = set(fields) - set(DEFAULT_SETTINGS[category])
            if unknown:
                raise ApiError(HTTPStatus.BAD_REQUEST, f"Unknown setting: {category}.{sorted(unknown)[0]}.")
        safe = self.enforce_hard_limits(payload)
        if "safety" in safe:
            for key in ("requireCameraPreview", "requireBoardVerification", "requireEmergencyStopTest", "abnormalActionDetection"):
                safe["safety"][key] = True
        return self.deep_merge(DEFAULT_SETTINGS, safe) if merge_defaults else safe

    def list_presets(self) -> list[dict[str, Any]]:
        return [read_json(path, {}) for path in sorted(PRESETS.glob("*.json"))]

    @synchronized
    def create_preset(self, payload: dict[str, Any]) -> dict[str, Any]:
        name = str(payload.get("name", "")).strip()
        if not name:
            raise ApiError(HTTPStatus.BAD_REQUEST, "Preset name is required.")
        preset_id = "custom-" + uuid.uuid4().hex[:12]
        preset = {"id": preset_id, "name": name[:120], "builtin": False, "settings": self.normalize_settings(payload.get("settings", {}))}
        atomic_json(PRESETS / f"{preset_id}.json", preset)
        return preset

    @synchronized
    def create_snapshot(self, project_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        path = self.require_project(project_id)
        snapshot_id = datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]
        snapshot_path = path / "snapshots" / snapshot_id
        snapshot_path.mkdir(parents=True)
        metadata = {
            "id": snapshot_id,
            "name": str(payload.get("name", "手動快照")).strip()[:120] or "手動快照",
            "note": str(payload.get("note", "")).strip()[:500],
            "createdAt": utc_now(),
        }
        atomic_json(snapshot_path / "snapshot.json", metadata)
        shutil.copy2(path / "current-state.json", snapshot_path / "current-state.json")
        shutil.copy2(path / "settings.json", snapshot_path / "settings.json")
        self.log(project_id, "info", "storage", "snapshot_created", metadata)
        return metadata

    def list_snapshots(self, project_id: str) -> list[dict[str, Any]]:
        path = self.require_project(project_id) / "snapshots"
        items = []
        for child in sorted(path.iterdir(), reverse=True):
            if child.is_dir():
                items.append(read_json(child / "snapshot.json", {"id": child.name}))
        return items

    @synchronized
    def restore_snapshot(self, project_id: str, snapshot_id: str) -> dict[str, Any]:
        path = self.require_project(project_id)
        if not ID_RE.fullmatch(snapshot_id):
            raise ApiError(HTTPStatus.BAD_REQUEST, "Invalid snapshot id.")
        snapshot = path / "snapshots" / snapshot_id
        if not snapshot.is_dir():
            raise ApiError(HTTPStatus.NOT_FOUND, "Snapshot not found.")
        self.services.stop_active_engine()
        self.reset_nxbt_connector(project_id)
        self.monitor.pop(project_id, None)
        shutil.copy2(snapshot / "current-state.json", path / "current-state.json")
        shutil.copy2(snapshot / "settings.json", path / "settings.json")
        self.log(project_id, "warning", "storage", "snapshot_restored", {"snapshotId": snapshot_id})
        return self.load_project(project_id)

    @synchronized
    def move_to_trash(self, project_id: str) -> dict[str, Any]:
        path = self.require_project(project_id)
        self.services.stop_active_engine()
        self.reset_nxbt_connector(project_id)
        manifest = read_json(path / "manifest.json", {"id": project_id})
        manifest["deletedAt"] = utc_now()
        atomic_json(path / "manifest.json", manifest)
        target = self.trash_path(project_id)
        if target.exists():
            shutil.rmtree(target)
        shutil.move(str(path), str(target))
        settings = self.app_settings()
        if settings.get("lastProjectId") == project_id:
            settings["lastProjectId"] = ""
            atomic_json(APP_SETTINGS, settings)
        self.monitor.pop(project_id, None)
        return manifest

    @synchronized
    def restore_trash(self, project_id: str) -> dict[str, Any]:
        source = self.trash_path(project_id)
        if not source.is_dir():
            raise ApiError(HTTPStatus.NOT_FOUND, "Trash item not found.")
        target = self.project_path(project_id)
        if target.exists():
            raise ApiError(HTTPStatus.CONFLICT, "Project id already exists.")
        manifest = read_json(source / "manifest.json", {"id": project_id})
        manifest.pop("deletedAt", None)
        manifest["updatedAt"] = utc_now()
        atomic_json(source / "manifest.json", manifest)
        shutil.move(str(source), str(target))
        self.log(project_id, "info", "project", "project_restored", {})
        return self.load_project(project_id)

    @synchronized
    def delete_trash(self, project_id: str) -> None:
        path = self.trash_path(project_id)
        if not path.is_dir():
            raise ApiError(HTTPStatus.NOT_FOUND, "Trash item not found.")
        shutil.rmtree(path)

    @synchronized
    def purge_expired_trash(self) -> None:
        global_settings = read_json(GLOBAL_DEFAULTS, DEFAULT_SETTINGS)
        storage_settings = global_settings.get("storage", {}) if isinstance(global_settings, dict) else {}
        trash_days = storage_settings.get("trashDays", 30) if isinstance(storage_settings, dict) else 30
        trash_days = min(max(trash_days, 1), 365) if isinstance(trash_days, (int, float)) and not isinstance(trash_days, bool) else 30
        cutoff = datetime.now(timezone.utc) - timedelta(days=trash_days)
        for path in TRASH.iterdir():
            if not path.is_dir():
                continue
            manifest = read_json(path / "manifest.json", {})
            try:
                deleted = datetime.fromisoformat(manifest.get("deletedAt", ""))
            except ValueError:
                continue
            if deleted.tzinfo is None:
                deleted = deleted.replace(tzinfo=timezone.utc)
            if deleted < cutoff:
                shutil.rmtree(path)

    def export_project(self, project_id: str) -> Path:
        project = self.require_project(project_id)
        export_dir = DATA / "exports"
        export_dir.mkdir(exist_ok=True)
        archive = export_dir / f"{project_id}-{datetime.now().strftime('%Y%m%d-%H%M%S')}.zip"
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as handle:
            for file_path in project.rglob("*"):
                if file_path.is_file():
                    handle.write(file_path, Path(project_id) / file_path.relative_to(project))
        return archive

    @synchronized
    def import_project(self, raw: bytes) -> dict[str, Any]:
        with tempfile.TemporaryDirectory(dir=DATA) as temp_dir:
            archive = Path(temp_dir) / "import.zip"
            archive.write_bytes(raw)
            extract = Path(temp_dir) / "extract"
            extract.mkdir()
            with zipfile.ZipFile(archive) as handle:
                members = handle.infolist()
                if len(members) > MAX_ZIP_FILES or sum(member.file_size for member in members) > MAX_ZIP_UNCOMPRESSED:
                    raise ApiError(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "Project archive expands beyond the allowed size.")
                for member in members:
                    if stat.S_ISLNK(member.external_attr >> 16):
                        raise ApiError(HTTPStatus.BAD_REQUEST, "Project archive cannot contain symbolic links.")
                    target = (extract / member.filename).resolve()
                    if extract.resolve() not in target.parents and target != extract.resolve():
                        raise ApiError(HTTPStatus.BAD_REQUEST, "Unsafe zip path.")
                handle.extractall(extract)
            roots = [path for path in extract.iterdir() if path.is_dir()]
            if len(roots) != 1 or not (roots[0] / "manifest.json").exists():
                raise ApiError(HTTPStatus.BAD_REQUEST, "Invalid project archive.")
            new_id = uuid.uuid4().hex[:16]
            target = self.project_path(new_id)
            shutil.copytree(roots[0], target)
            try:
                for child in ("checkpoints", "snapshots", "models", "datasets", "logs", "clips"):
                    (target / child).mkdir(exist_ok=True)
                manifest = read_json(target / "manifest.json", {})
                manifest["id"] = new_id
                manifest["name"] = str(manifest.get("name", "匯入專案"))[:120]
                manifest["importedAt"] = utc_now()
                manifest["updatedAt"] = utc_now()
                atomic_json(target / "manifest.json", manifest)
                imported_settings = read_json(target / "settings.json", {})
                atomic_json(target / "settings.json", self.normalize_settings(imported_settings))
                atomic_json(target / "current-state.json", clean_runtime_state(read_json(target / "current-state.json", self.default_state())))
            except Exception:
                shutil.rmtree(target, ignore_errors=True)
                raise
            self.log(new_id, "info", "project", "project_imported", {})
            return self.load_project(new_id)

    @synchronized
    def log(self, project_id: str, severity: str, source: str, event: str, details: dict[str, Any]) -> dict[str, Any]:
        path = self.require_project(project_id)
        entry = {
            "timestamp": utc_now(),
            "severity": severity,
            "source": source,
            "event": event,
            "details": details,
        }
        logging = self.get_project_settings(project_id)["effective"]["logging"]
        ranks = {"info": 0, "warning": 1, "error": 2}
        minimum = str(logging.get("minimumSeverity", "info"))
        if event == "logs_cleared" or (logging.get("events", True) and ranks.get(severity, 0) >= ranks.get(minimum, 0)):
            append_jsonl(path / "logs" / "events.jsonl", entry)
        self.prune_log_storage(project_id)
        return entry

    def prune_log_storage(self, project_id: str) -> None:
        project = self.require_project(project_id)
        max_gb = self.get_project_settings(project_id)["effective"]["storage"]["maxLogGb"]
        max_bytes = max(1024 * 1024, int(float(max_gb) * 1024 * 1024 * 1024))
        events = project / "logs" / "events.jsonl"
        removable = [
            path
            for root in (project / "logs", project / "clips")
            for path in root.rglob("*")
            if path.is_file() and path != events
        ]
        files = ([events] if events.exists() else []) + removable
        total = sum(path.stat().st_size for path in files if path.exists())
        for path in sorted(removable, key=lambda item: item.stat().st_mtime):
            if total <= max_bytes:
                break
            size = path.stat().st_size
            path.unlink()
            total -= size
        if total > max_bytes and events.exists():
            tail = events.read_bytes()[-max_bytes:]
            newline = tail.find(b"\n")
            atomic_bytes(events, tail[newline + 1:] if newline >= 0 else tail)

    def list_logs(self, project_id: str, query: dict[str, list[str]]) -> list[dict[str, Any]]:
        path = self.require_project(project_id) / "logs" / "events.jsonl"
        if not path.exists():
            return []
        severity = query.get("severity", [""])[0]
        source = query.get("source", [""])[0]
        text = query.get("q", [""])[0].lower()
        time_from = query.get("from", [""])[0]
        time_to = query.get("to", [""])[0]
        round_id = query.get("round", [""])[0]
        error_type = query.get("errorType", [""])[0].lower()
        try:
            limit = min(max(int(query.get("limit", ["200"])[0]), 1), 1000)
        except ValueError:
            raise ApiError(HTTPStatus.BAD_REQUEST, "Log limit must be an integer.")
        entries = []
        for line in path.read_text(encoding="utf-8").splitlines():
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            if severity and entry.get("severity") != severity:
                continue
            if source and entry.get("source") != source:
                continue
            if time_from and entry.get("timestamp", "") < time_from:
                continue
            if time_to and entry.get("timestamp", "") > time_to:
                continue
            if round_id and str(entry.get("details", {}).get("roundId", "")) != round_id:
                continue
            if error_type and error_type not in str(entry.get("details", {}).get("errorType", "")).lower():
                continue
            if text and text not in json.dumps(entry, ensure_ascii=False).lower():
                continue
            entries.append(entry)
        return entries[-limit:][::-1]

    @synchronized
    def clear_logs(self, project_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        project = self.require_project(project_id)
        logs = project / "logs"
        scope = str(payload.get("scope", "all"))
        if scope not in {"events", "actions", "all"}:
            raise ApiError(HTTPStatus.BAD_REQUEST, "Invalid log deletion scope.")
        deleted_files = 0
        deleted_clips = 0
        if scope in {"events", "all"}:
            events = logs / "events.jsonl"
            if events.exists():
                events.unlink()
                deleted_files += 1
        if scope in {"actions", "all"}:
            for path in logs.glob("actions-*.jsonl"):
                path.unlink()
                deleted_files += 1
        if bool(payload.get("includeClips", False)):
            clips = project / "clips"
            for path in clips.iterdir():
                if path.is_dir():
                    shutil.rmtree(path)
                else:
                    path.unlink()
                deleted_clips += 1
        self.log(
            project_id,
            "warning",
            "storage",
            "logs_cleared",
            {"scope": scope, "includeClips": bool(payload.get("includeClips", False)), "deletedFiles": deleted_files, "deletedClips": deleted_clips},
        )
        return {"ok": True, "deletedFiles": deleted_files, "deletedClips": deleted_clips}

    def nxbt_host(self, value: Any) -> str:
        host = str(value or "").strip().lower()
        if host == "localhost":
            return host
        try:
            address = ipaddress.ip_address(host)
        except ValueError as error:
            raise ApiError(HTTPStatus.BAD_REQUEST, "NXBT VM host must be localhost or a private IP address.") from error
        if address.version != 4 or not (address.is_private or address.is_loopback or address.is_link_local):
            raise ApiError(HTTPStatus.BAD_REQUEST, "NXBT VM host must be a private IPv4 address.")
        return host

    def nxbt_request(
        self,
        connector: dict[str, Any],
        path: str,
        payload: dict[str, Any] | None = None,
        timeout: float = 5,
    ) -> dict[str, Any]:
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            f"http://{connector['host']}:{connector['port']}{path}",
            data=body,
            method="GET" if payload is None else "POST",
            headers={
                "Authorization": f"Bearer {connector['token']}",
                "Content-Type": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                result = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            try:
                result = json.loads(error.read().decode("utf-8"))
                message = str(result.get("error", "NXBT VM bridge rejected the request."))
            except (UnicodeDecodeError, json.JSONDecodeError, AttributeError):
                message = "NXBT VM bridge rejected the request."
            raise ApiError(HTTPStatus.CONFLICT, message) from error
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise ApiError(
                HTTPStatus.CONFLICT,
                f"無法連到 NXBT VM bridge ({connector['host']}:{connector['port']})。"
                "請先在 Linux VM 內啟動 tools/nxbt_bridge_server.py，確認終端顯示 NXBT VM bridge ready，"
                "再檢查連接埠與防火牆。Windows 與 macOS 請先依 README 建立本機轉送，"
                "然後填 127.0.0.1；不要直接填 VirtualBox NAT 位址 10.0.2.15。",
            ) from error
        except (UnicodeDecodeError, json.JSONDecodeError, AttributeError) as error:
            raise ApiError(HTTPStatus.CONFLICT, "NXBT VM bridge returned an invalid response.") from error
        if not isinstance(result, dict):
            raise ApiError(HTTPStatus.CONFLICT, "NXBT VM bridge returned an invalid response.")
        return result

    def connect_nxbt(self, project_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        self.require_project(project_id)
        effective = self.get_project_settings(project_id)["effective"]["output"]
        host = self.nxbt_host(payload.get("host", effective.get("nxbtHost", "127.0.0.1")))
        try:
            port = int(payload.get("port", effective.get("nxbtPort", 8766)))
        except (TypeError, ValueError) as error:
            raise ApiError(HTTPStatus.BAD_REQUEST, "NXBT VM port must be a number.") from error
        if not 1 <= port <= 65535:
            raise ApiError(HTTPStatus.BAD_REQUEST, "NXBT VM port must be between 1 and 65535.")
        token = str(payload.get("token", "")).strip()
        if not token or len(token) > 256:
            raise ApiError(HTTPStatus.BAD_REQUEST, "NXBT VM token is required and must be at most 256 characters.")
        reconnect = bool(payload.get("reconnect", effective.get("nxbtReconnect", True)))
        connector = {"host": host, "port": port, "token": token}
        try:
            result = self.nxbt_request(connector, "/connect", {"reconnect": reconnect}, timeout=10)
        except ApiError as error:
            self.log(
                project_id,
                "error",
                "nxbt",
                "nxbt_connect_failed",
                {"host": host, "port": port, "reconnect": reconnect, "message": error.message},
            )
            raise
        ready = bool(result.get("controllerReady"))
        connecting = bool(result.get("connecting"))
        if not ready and not connecting:
            raise ApiError(
                HTTPStatus.CONFLICT,
                str(result.get("connectionError") or "NXBT VM bridge did not start controller pairing."),
            )
        with self.lock:
            self.nxbt_connectors[project_id] = connector
            self.nxbt_test_prepared[project_id] = set()
        runtime = self.runtime_status(project_id)
        runtime["controllerReady"] = ready
        runtime["updatedAt"] = utc_now()
        self.log(
            project_id,
            "info",
            "nxbt",
            "nxbt_connected" if ready else "nxbt_pairing_started",
            {"host": host, "port": port, "reconnect": reconnect},
        )
        return {
            "ready": ready,
            "connecting": connecting,
            "host": host,
            "port": port,
            "message": (
                "NXBT 已由 VM bridge 回報連線成功。"
                if ready
                else "NXBT 已開始配對。請在 Switch 開啟控制器配對畫面，網頁會自動更新狀態。"
            ),
        }

    def nxbt_status(self, project_id: str) -> dict[str, Any]:
        self.require_project(project_id)
        with self.lock:
            connector = self.nxbt_connectors.get(project_id)
        if not connector:
            return {"ready": False, "message": "NXBT 尚未連線。"}
        try:
            result = self.nxbt_request(connector, "/health", timeout=3)
        except ApiError:
            with self.lock:
                self.nxbt_connectors.pop(project_id, None)
                self.nxbt_test_prepared.pop(project_id, None)
            self.runtime_status(project_id)["controllerReady"] = False
            return {"ready": False, "message": "NXBT VM bridge 已失聯，請重新連線。"}
        self.runtime_status(project_id)["controllerReady"] = bool(result.get("controllerReady"))
        ready = bool(result.get("controllerReady"))
        connecting = bool(result.get("connecting"))
        error = str(result.get("connectionError") or "")
        return {
            "ready": ready,
            "connecting": connecting,
            "host": connector["host"],
            "port": connector["port"],
            "message": (
                "NXBT 已連線。"
                if ready
                else "NXBT 正在等待 Switch 控制器配對畫面。"
                if connecting
                else f"NXBT 配對失敗：{error}"
                if error
                else "NXBT 控制器尚未準備完成。"
            ),
        }

    def disconnect_nxbt(self, project_id: str) -> dict[str, Any]:
        self.require_project(project_id)
        with self.lock:
            connector = self.nxbt_connectors.get(project_id)
        if connector:
            self.nxbt_request(connector, "/disconnect", {}, timeout=10)
            with self.lock:
                self.nxbt_connectors.pop(project_id, None)
                self.nxbt_test_prepared.pop(project_id, None)
        self.runtime_status(project_id)["controllerReady"] = False
        self.log(project_id, "info", "nxbt", "nxbt_disconnected", {})
        return {"ready": False, "message": "NXBT 已斷開。"}

    def normalize_nxbt_action(
        self,
        project_id: str,
        payload: Any,
        menu_action: bool = False,
        test_action: bool = False,
    ) -> tuple[dict[str, Any], bool]:
        if not isinstance(payload, dict):
            raise ApiError(HTTPStatus.BAD_REQUEST, "NXBT action must be an object.")
        allowed_sticks = {"left_stick_x", "left_stick_y", "right_stick_x", "right_stick_y"}
        allowed_buttons = {"a", "b", "x", "y", "l", "r", "zl", "zr"}
        if menu_action:
            allowed_buttons.update({"dpad_up", "dpad_down", "dpad_left", "dpad_right", "plus", "minus"})
        if test_action:
            allowed_buttons.update(NXBT_TEST_BUTTONS)
        raw_sticks = payload.get("sticks", {})
        raw_buttons = payload.get("buttons", {})
        if not isinstance(raw_sticks, dict) or not isinstance(raw_buttons, dict):
            raise ApiError(HTTPStatus.BAD_REQUEST, "NXBT sticks and buttons must be objects.")
        if set(raw_sticks) - allowed_sticks:
            raise ApiError(HTTPStatus.BAD_REQUEST, "NXBT action contains an unknown stick.")
        if set(raw_buttons) - allowed_buttons:
            raise ApiError(HTTPStatus.BAD_REQUEST, "NXBT action contains a locked or unknown button.")
        sticks: dict[str, int] = {}
        for key in allowed_sticks:
            value = raw_sticks.get(key, 0)
            if not isinstance(value, (int, float)) or isinstance(value, bool):
                raise ApiError(HTTPStatus.BAD_REQUEST, f"NXBT stick {key} must be numeric.")
            sticks[key] = round(min(max(float(value), -100), 100))
        buttons: dict[str, bool] = {}
        for key, value in raw_buttons.items():
            if not isinstance(value, bool):
                raise ApiError(HTTPStatus.BAD_REQUEST, f"NXBT button {key} must be boolean.")
            buttons[key] = value
        duration = payload.get("durationMs", 120)
        if not isinstance(duration, (int, float)) or isinstance(duration, bool):
            raise ApiError(HTTPStatus.BAD_REQUEST, "NXBT durationMs must be numeric.")
        maximum = self.get_project_settings(project_id)["effective"]["controller"]["maxCommandMs"]
        action_limit = 250 if menu_action else 1500
        normalized = {
            "durationMs": round(min(max(float(duration), 20), min(float(maximum), action_limit))),
            "sticks": sticks,
            "buttons": buttons,
        }
        neutral = not any(sticks.values()) and not any(buttons.values())
        return normalized, neutral

    def test_nxbt_input(self, project_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        self.require_project(project_id)
        if not isinstance(payload, dict):
            raise ApiError(HTTPStatus.BAD_REQUEST, "NXBT 測試要求格式不正確。")
        operation = str(payload.get("operation", "")).strip().lower()
        interface = str(payload.get("interface", "")).strip().lower()
        if operation == "neutral":
            action = {"durationMs": 20, "sticks": {}, "buttons": {}}
            label = "回到中立"
        else:
            if payload.get("screenConfirmed") is not True:
                raise ApiError(HTTPStatus.BAD_REQUEST, "請先確認 Switch 2 已開啟對應的官方測試畫面。")
            if interface not in {"buttons", "sticks"}:
                raise ApiError(HTTPStatus.BAD_REQUEST, "NXBT 測試介面必須是 buttons 或 sticks。")
            if interface == "buttons":
                if operation == "finish_button_test":
                    action = {"durationMs": 1000, "sticks": {}, "buttons": {"b": True}}
                    label = "按住 B 結束官方按鍵測試"
                elif operation not in NXBT_TEST_BUTTONS:
                    raise ApiError(HTTPStatus.BAD_REQUEST, "這個按鍵不在 NXBT 安全測試白名單內。")
                else:
                    action = {"durationMs": 120, "sticks": {}, "buttons": {operation: True}}
                    label = operation
            else:
                match = re.fullmatch(r"(left|right):(prepare|left|right|up|down)", operation)
                if not match:
                    raise ApiError(HTTPStatus.BAD_REQUEST, "搖桿測試動作格式不正確。")
                side, direction = match.groups()
                with self.lock:
                    side_prepared = side in self.nxbt_test_prepared.get(project_id, set())
                if direction != "prepare" and not side_prepared:
                    side_label = "左" if side == "left" else "右"
                    raise ApiError(HTTPStatus.CONFLICT, f"請先把{side_label}搖桿向右推到底，讓 Switch 2 選中要測試的搖桿。")
                x_value, y_value = (100, 0) if direction == "prepare" else NXBT_TEST_STICK_DIRECTIONS[direction]
                prefix = f"{side}_stick"
                action = {
                    "durationMs": 1200 if direction == "prepare" else 350,
                    "sticks": {f"{prefix}_x": x_value, f"{prefix}_y": y_value},
                    "buttons": {},
                }
                label = f"{side}:{direction}"

        normalized, neutral = self.normalize_nxbt_action(project_id, action, test_action=True)
        runtime = self.runtime_status(project_id)
        effective = self.get_project_settings(project_id)["effective"]
        backend = effective["output"].get("backend")
        if not neutral:
            if backend not in {"nxbt_bluetooth", "hybrid"}:
                raise ApiError(HTTPStatus.CONFLICT, "目前控制輸出不是 NXBT 或混合模式。")
            if runtime.get("mode") != "idle" or runtime.get("paused"):
                raise ApiError(HTTPStatus.CONFLICT, "NXBT 測試只能在訓練與正式遊玩都停止時執行。")
            if not runtime.get("controllerReady"):
                raise ApiError(HTTPStatus.CONFLICT, "NXBT 控制器尚未連線，不能測試輸入。")
        with self.lock:
            connector = self.nxbt_connectors.get(project_id)
        if not connector:
            raise ApiError(HTTPStatus.CONFLICT, "NXBT 尚未連線，不能測試輸入。")
        result = self.nxbt_request(connector, "/action", normalized, timeout=5)
        if not result.get("ok"):
            raise ApiError(HTTPStatus.CONFLICT, "NXBT VM bridge 沒有確認測試動作，請檢查 bridge 與控制器連線。")
        with self.lock:
            if operation == "neutral":
                self.nxbt_test_prepared[project_id] = set()
            elif interface == "sticks" and operation.endswith(":prepare"):
                self.nxbt_test_prepared.setdefault(project_id, set()).add(operation.split(":", 1)[0])
        if effective["logging"].get("actions", True):
            append_jsonl(
                self.require_project(project_id) / "logs" / f"actions-{datetime.now().strftime('%Y-%m-%d')}.jsonl",
                {
                    "timestamp": utc_now(),
                    "action": "nxbt_test_input",
                    "backend": "nxbt_bluetooth",
                    "result": "sent",
                    "details": {"interface": interface, "operation": operation, "command": normalized},
                },
            )
        self.prune_log_storage(project_id)
        return {"ok": bool(result.get("ok")), "operation": operation, "message": f"NXBT 測試已送出：{label}。動作結束後已回到中立。"}

    def action_nxbt(self, project_id: str, payload: dict[str, Any], manual_demonstration: bool = False, menu_action: bool = False) -> dict[str, Any]:
        self.require_project(project_id)
        normalized, neutral = self.normalize_nxbt_action(project_id, payload, menu_action=menu_action)
        runtime = self.runtime_status(project_id)
        runtime_blocked = (
            runtime["paused"]
            or not runtime["visionReady"]
            or not runtime["controllerReady"]
            or not runtime["emergencyStopVerified"]
        )
        engine_blocked = not manual_demonstration and (
            not runtime["engineReady"] or runtime["mode"] not in {"training", "live", "canary"}
        )
        demonstration_blocked = (manual_demonstration or menu_action) and runtime["mode"] != "idle"
        if menu_action:
            engine_blocked = False
        if not neutral and (runtime_blocked or engine_blocked or demonstration_blocked):
            raise ApiError(HTTPStatus.CONFLICT, "NXBT 動作已阻止：引擎、鏡頭辨識、控制器或軟體急停驗證尚未完成。")
        with self.lock:
            connector = self.nxbt_connectors.get(project_id)
        if not connector:
            raise ApiError(HTTPStatus.CONFLICT, "NXBT 尚未連線，不能送出控制命令。")
        result = self.nxbt_request(connector, "/action", normalized, timeout=5)
        if self.get_project_settings(project_id)["effective"]["logging"].get("actions", True):
            append_jsonl(
                self.require_project(project_id) / "logs" / f"actions-{datetime.now().strftime('%Y-%m-%d')}.jsonl",
                {
                    "timestamp": utc_now(),
                    "action": "nxbt_menu_action" if menu_action else "nxbt_demonstration_action" if manual_demonstration else "nxbt_action",
                    "backend": "nxbt_bluetooth",
                    "result": "sent",
                    "details": normalized,
                },
            )
        self.prune_log_storage(project_id)
        return {"ok": bool(result.get("ok")), "message": "NXBT 控制命令已送出。"}

    def emergency_stop_nxbt(self, project_id: str) -> dict[str, Any]:
        self.require_project(project_id)
        with self.lock:
            connector = self.nxbt_connectors.get(project_id)
        if not connector:
            raise ApiError(HTTPStatus.CONFLICT, "NXBT 尚未連線，不能驗證軟體急停。")
        result = self.nxbt_request(connector, "/emergency-stop", {}, timeout=10)
        if not result.get("emergencyStopVerified"):
            raise ApiError(HTTPStatus.CONFLICT, "NXBT VM bridge did not confirm emergency stop.")
        with self.lock:
            self.nxbt_connectors.pop(project_id, None)
            self.nxbt_test_prepared.pop(project_id, None)
        runtime = self.runtime_status(project_id)
        runtime["controllerReady"] = False
        runtime["emergencyStopVerified"] = True
        runtime["updatedAt"] = utc_now()
        self.log(project_id, "warning", "nxbt", "nxbt_emergency_stop_verified", {})
        return {
            "ready": False,
            "emergencyStopVerified": True,
            "message": "NXBT 軟體急停已通過；模擬手把已移除，請重新連接 NXBT。",
        }

    def reset_nxbt_connector(self, project_id: str) -> None:
        with self.lock:
            connector = self.nxbt_connectors.get(project_id)
        if not connector:
            return
        try:
            self.nxbt_request(connector, "/emergency-stop", {}, timeout=3)
        except ApiError as error:
            self.log(project_id, "warning", "nxbt", "nxbt_reset_failed", {"message": error.message})
        finally:
            with self.lock:
                self.nxbt_connectors.pop(project_id, None)
                self.nxbt_test_prepared.pop(project_id, None)
            if project_id in self.monitor:
                self.monitor[project_id]["controllerReady"] = False

    def reset_all_nxbt_connectors(self) -> None:
        with self.lock:
            project_ids = list(self.nxbt_connectors)
        for project_id in project_ids:
            self.reset_nxbt_connector(project_id)

    def shutdown_application(self) -> None:
        with self.lock:
            if self.shutdown_started:
                return
            self.shutdown_started = True
        last_project_id = str(self.app_settings().get("lastProjectId", ""))
        if ID_RE.fullmatch(last_project_id) and self.project_path(last_project_id).is_dir():
            self.log(last_project_id, "info", "system", "application_shutdown", {})
        self.services.stop_active_engine()
        self.reset_all_nxbt_connectors()
        self.services.shutdown()
        with self.lock:
            for runtime in self.monitor.values():
                runtime.update({
                    "mode": "idle",
                    "paused": False,
                    "engineReady": False,
                    "controllerReady": False,
                    "visionReady": False,
                    "message": "本機程式已結束。",
                    "updatedAt": utc_now(),
                })

    def runtime_status(self, project_id: str) -> dict[str, Any]:
        return self.monitor.setdefault(
            project_id,
            {
                "mode": "idle",
                "paused": False,
                "engineReady": False,
                "visionReady": False,
                "controllerReady": False,
                "emergencyStopVerified": False,
                "modelReady": False,
                "message": "尚未接入真實訓練與控制引擎。",
                "updatedAt": utc_now(),
            },
        )

    def capabilities(self, refresh: bool = False) -> dict[str, Any]:
        report = dict(refresh_capability_report() if refresh else capability_report())
        worker = self.services.worker_health()
        training = worker.get("training") if isinstance(worker.get("training"), dict) else {}
        worker_ready = bool(worker.get("workerReady"))
        report["visionProviderAvailable"] = worker_ready and bool(worker.get("ocr"))
        report["trainingEngineAvailable"] = worker_ready and bool(training.get("ready"))
        report["engineConnected"] = report["visionProviderAvailable"] or report["trainingEngineAvailable"]
        if report["engineConnected"]:
            report["note"] = "本地 worker 已接入。晶片與套件已偵測，但鏡頭、控制器與模型仍必須分別完成真實驗證。"
        return report

    def apply_engine_status(self, project_id: str, status: dict[str, Any]) -> dict[str, Any]:
        runtime = self.runtime_status(project_id)
        ready = bool(status.get("ready"))
        runtime["engineReady"] = ready
        runtime["visionReady"] = bool(status.get("ocr", runtime.get("visionReady")))
        runtime["modelReady"] = bool(status.get("stableReady") or status.get("modelSaved") or runtime.get("modelReady"))
        if status.get("mode") in {"idle", "training", "live", "canary", "error"}:
            runtime["mode"] = status["mode"]
        runtime["shadowReady"] = bool(status.get("shadowReady", runtime.get("shadowReady", False)))
        runtime["steps"] = int(status.get("steps", runtime.get("steps", 0)))
        runtime["awaitingNextRound"] = bool(status.get("awaitingNextRound", runtime.get("awaitingNextRound", False)))
        runtime["message"] = str(status.get("message", runtime["message"]))
        runtime["updatedAt"] = utc_now()
        return runtime

    def engine(self, project_id: str, action: str, payload: dict[str, Any]) -> dict[str, Any]:
        self.require_project(project_id)
        if action in {"start", "live"}:
            runtime = self.runtime_status(project_id)
            backend = self.get_project_settings(project_id)["effective"]["output"]["backend"]
            issues = []
            if not runtime["visionReady"]:
                issues.append("尚未收到可信任的真實鏡頭辨識畫格。請先開啟鏡頭並確認畫面。")
            if backend in {"nxbt_bluetooth", "hybrid"} and not runtime["controllerReady"]:
                issues.append("NXBT 控制器尚未由 bridge 回報連線完成。")
            if backend in {"nxbt_bluetooth", "hybrid"} and not runtime["emergencyStopVerified"]:
                issues.append("NXBT 軟體急停尚未驗證。請先測試急停，再重新連接 NXBT。")
            if issues:
                raise ApiError(HTTPStatus.CONFLICT, f"本地訓練引擎尚未啟動：{issues[0]}")
        result = self.services.engine(project_id, action, payload)
        self.apply_engine_status(project_id, result)
        return result

    @synchronized
    def control(self, project_id: str, action: str, payload: dict[str, Any]) -> dict[str, Any]:
        self.require_project(project_id)
        runtime = self.runtime_status(project_id)
        if action == "resume" and not runtime["engineReady"]:
            raise ApiError(HTTPStatus.CONFLICT, "Real training/control engine is not connected.")
        if action == "pause":
            try:
                self.action_nxbt(project_id, {"durationMs": 120, "sticks": {}, "buttons": {}})
            except ApiError:
                pass
            runtime["paused"] = True
            runtime["message"] = "已暫停新命令並要求控制輸出回中立。"
        elif action == "resume":
            runtime["paused"] = False
            runtime["message"] = "已要求恢復控制。"
        elif action == "stop":
            try:
                self.action_nxbt(project_id, {"durationMs": 120, "sticks": {}, "buttons": {}})
            except ApiError:
                pass
            self.services.stop_active_engine()
            runtime["mode"] = "idle"
            runtime["paused"] = False
            runtime["engineReady"] = False
            runtime["message"] = "已停止控制並要求回中立；主頁會另外保存目前狀態。"
        elif action == "emergency-stop":
            self.reset_nxbt_connector(project_id)
            runtime["mode"] = "emergency-stop"
            runtime["paused"] = True
            runtime["emergencyStopVerified"] = False
            runtime["message"] = "已記錄最高優先級急停要求；未接入真實控制引擎時仍需使用實體急停。"
        else:
            raise ApiError(HTTPStatus.BAD_REQUEST, "Unknown control action.")
        runtime["updatedAt"] = utc_now()
        self.log(project_id, "warning" if action == "emergency-stop" else "info", "control", action, payload)
        if self.get_project_settings(project_id)["effective"]["logging"].get("actions", True):
            append_jsonl(
                self.require_project(project_id) / "logs" / f"actions-{datetime.now().strftime('%Y-%m-%d')}.jsonl",
                {
                    "timestamp": utc_now(),
                    "action": action,
                    "backend": "unconnected",
                    "result": runtime["message"],
                    "details": payload,
                },
            )
        self.prune_log_storage(project_id)
        return runtime


STORE = Store()
SESSION_TOKEN = secrets.token_urlsafe(24)


def shutdown_http_server(server: ThreadingHTTPServer) -> None:
    try:
        STORE.shutdown_application()
    finally:
        server.shutdown()


class LocalThreadingHTTPServer(ThreadingHTTPServer):
    # Windows address reuse can leave a second localhost process on the same
    # port, so ending one server would not necessarily stop the application.
    allow_reuse_address = False


class Handler(SimpleHTTPRequestHandler):
    server_version = "Switch2Rig/0.2"

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, format: str, *args: Any) -> None:
        print("%s - %s" % (self.address_string(), format % args), flush=True)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def read_body(self) -> bytes:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise ApiError(HTTPStatus.BAD_REQUEST, "Invalid Content-Length.")
        if length < 0:
            raise ApiError(HTTPStatus.BAD_REQUEST, "Invalid Content-Length.")
        if length > MAX_BODY:
            raise ApiError(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "Request body is too large.")
        return self.rfile.read(length)

    def read_json_body(self) -> dict[str, Any]:
        raw = self.read_body()
        if not raw:
            return {}
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ApiError(HTTPStatus.BAD_REQUEST, "Invalid JSON body.")
        if not isinstance(payload, dict):
            raise ApiError(HTTPStatus.BAD_REQUEST, "JSON object required.")
        return payload

    def send_json(self, payload: Any, status: int = HTTPStatus.OK) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def send_file(self, path: Path, content_type: str, filename: str) -> None:
        raw = path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def require_mutation_auth(self) -> None:
        if self.headers.get("X-Session-Token") != SESSION_TOKEN:
            raise ApiError(HTTPStatus.FORBIDDEN, "Missing or invalid session token.")
        origin = self.headers.get("Origin")
        if origin:
            parsed = urlparse(origin)
            try:
                valid_origin = parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1"} and parsed.port == self.server.server_port
            except ValueError:
                valid_origin = False
            if not valid_origin:
                raise ApiError(HTTPStatus.FORBIDDEN, "Invalid request origin.")

    def route(self) -> tuple[list[str], dict[str, list[str]]]:
        parsed = urlparse(self.path)
        parts = [part for part in parsed.path.split("/") if part]
        return parts, parse_qs(parsed.query)

    def do_GET(self) -> None:
        try:
            parts, query = self.route()
            if not parts or parts[0] != "api":
                path = urlparse(self.path).path
                if path not in STATIC_FILES:
                    raise ApiError(HTTPStatus.NOT_FOUND, "Static file not found.")
                return super().do_GET()
            if parts == ["api", "health"]:
                return self.send_json({"ok": True, "service": "switch2-ai-local"})
            if parts == ["api", "bootstrap"]:
                return self.send_json({"token": SESSION_TOKEN, "settings": STORE.app_settings(), "projects": STORE.list_projects(), "capabilities": STORE.capabilities()})
            if parts == ["api", "capabilities"]:
                return self.send_json(STORE.capabilities())
            if parts == ["api", "dependencies"]:
                return self.send_json(STORE.services.package_status())
            if parts == ["api", "settings", "llm"]:
                return self.send_json(STORE.services.llm_settings())
            if parts == ["api", "assistant", "status"]:
                return self.send_json(STORE.services.assistant_status())
            if parts == ["api", "worker", "health"]:
                return self.send_json(STORE.services.worker_health())
            if parts == ["api", "projects"]:
                return self.send_json({"projects": STORE.list_projects(), "trash": STORE.list_trash(), "appSettings": STORE.app_settings()})
            if parts == ["api", "trash"]:
                return self.send_json({"trash": STORE.list_trash()})
            if parts == ["api", "settings", "global"]:
                return self.send_json(STORE.get_global_settings())
            if parts == ["api", "settings", "presets"]:
                return self.send_json({"presets": STORE.list_presets()})
            if len(parts) == 3 and parts[:2] == ["api", "projects"]:
                return self.send_json(STORE.load_project(parts[2], mark_opened=False))
            if len(parts) == 4 and parts[:2] == ["api", "projects"] and parts[3] == "settings":
                return self.send_json(STORE.get_project_settings(parts[2]))
            if len(parts) == 4 and parts[:2] == ["api", "projects"] and parts[3] == "logs":
                return self.send_json({"logs": STORE.list_logs(parts[2], query)})
            if len(parts) == 4 and parts[:2] == ["api", "projects"] and parts[3] == "snapshots":
                return self.send_json({"snapshots": STORE.list_snapshots(parts[2])})
            if len(parts) == 5 and parts[:2] == ["api", "projects"] and parts[3:] == ["engine", "health"]:
                return self.send_json(STORE.services.worker_health(parts[2]))
            if len(parts) == 5 and parts[:2] == ["api", "projects"] and parts[3:] == ["assistant", "chat"]:
                return self.send_json({"messages": STORE.services.conversations(parts[2])})
            if len(parts) == 4 and parts[:2] == ["api", "projects"] and parts[3] == "control-bindings":
                return self.send_json({"bindings": STORE.services.list_control_bindings(parts[2])})
            if len(parts) == 4 and parts[:2] == ["api", "projects"] and parts[3] == "training-guidance":
                return self.send_json({"guidance": STORE.services.list_training_guidance(parts[2]), "active": STORE.services.active_training_guidance(parts[2])})
            if len(parts) == 5 and parts[:2] == ["api", "projects"] and parts[3:] == ["menu", "workflows"]:
                return self.send_json({"workflows": STORE.services.list_menu_workflows(parts[2])})
            if len(parts) == 6 and parts[:2] == ["api", "projects"] and parts[3] == "menu" and parts[4] == "tasks":
                return self.send_json({"task": STORE.services.menu_task(parts[2], parts[5])})
            if len(parts) == 4 and parts[:2] == ["api", "projects"] and parts[3] == "memories":
                return self.send_json({"memories": STORE.services.list_memories(parts[2])})
            if len(parts) == 5 and parts[:2] == ["api", "projects"] and parts[3:] == ["nxbt", "status"]:
                return self.send_json(STORE.nxbt_status(parts[2]))
            if len(parts) == 5 and parts[:2] == ["api", "projects"] and parts[3:] == ["monitor", "stream"]:
                return self.send_sse(parts[2])
            raise ApiError(HTTPStatus.NOT_FOUND, "API route not found.")
        except (ApiError, ServiceError) as error:
            self.send_json({"error": error.message}, error.status)

    def do_POST(self) -> None:
        try:
            self.require_mutation_auth()
            parts, _ = self.route()
            if parts == ["api", "shutdown"]:
                self.read_json_body()
                self.send_json({"ok": True, "message": "本機程式正在結束。"})
                threading.Thread(target=shutdown_http_server, args=(self.server,), daemon=True).start()
                return
            if parts == ["api", "projects"]:
                return self.send_json(STORE.create_project(self.read_json_body()), HTTPStatus.CREATED)
            if parts == ["api", "capabilities", "refresh"]:
                self.read_json_body()
                return self.send_json(STORE.capabilities(refresh=True))
            if parts == ["api", "llm", "detect"]:
                self.read_json_body()
                return self.send_json(STORE.services.detect_llm())
            if parts == ["api", "llm", "test"]:
                return self.send_json(STORE.services.test_llm(self.read_json_body()))
            if parts == ["api", "assistant", "reconnect"]:
                self.read_json_body()
                return self.send_json(STORE.services.reset_llm_retry())
            if parts == ["api", "dependencies", "install"]:
                return self.send_json(STORE.services.install("recommended"))
            if len(parts) == 4 and parts[:2] == ["api", "dependencies"] and parts[3] == "install":
                return self.send_json(STORE.services.install(parts[2]))
            if parts == ["api", "projects", "import"]:
                return self.send_json(STORE.import_project(self.read_body()), HTTPStatus.CREATED)
            if parts == ["api", "settings", "presets"]:
                return self.send_json(STORE.create_preset(self.read_json_body()), HTTPStatus.CREATED)
            if len(parts) == 4 and parts[:2] == ["api", "projects"] and parts[3] == "open":
                self.read_json_body()
                return self.send_json(STORE.open_project(parts[2]))
            if len(parts) == 4 and parts[:2] == ["api", "projects"] and parts[3] == "export":
                archive = STORE.export_project(parts[2])
                return self.send_file(archive, "application/zip", archive.name)
            if len(parts) == 4 and parts[:2] == ["api", "projects"] and parts[3] == "snapshots":
                return self.send_json(STORE.create_snapshot(parts[2], self.read_json_body()), HTTPStatus.CREATED)
            if len(parts) == 6 and parts[:2] == ["api", "projects"] and parts[3] == "snapshots" and parts[5] == "restore":
                return self.send_json(STORE.restore_snapshot(parts[2], parts[4]))
            if len(parts) == 4 and parts[:2] == ["api", "trash"] and parts[3] == "restore":
                return self.send_json(STORE.restore_trash(parts[2]))
            if len(parts) == 4 and parts[:2] == ["api", "projects"] and parts[3] == "logs":
                payload = self.read_json_body()
                return self.send_json(STORE.log(parts[2], payload.get("severity", "info"), payload.get("source", "ui"), payload.get("event", "message"), payload.get("details", {})), HTTPStatus.CREATED)
            if len(parts) == 5 and parts[:2] == ["api", "projects"] and parts[3:] == ["assistant", "chat"]:
                return self.send_json(STORE.services.assistant_chat(parts[2], self.read_json_body()), HTTPStatus.CREATED)
            if len(parts) == 5 and parts[:2] == ["api", "projects"] and parts[3:] == ["assistant", "interpret"]:
                return self.send_json(STORE.services.interpret_assistant(parts[2], self.read_json_body()), HTTPStatus.CREATED)
            if len(parts) == 5 and parts[:2] == ["api", "projects"] and parts[3:] == ["assistant", "look"]:
                self.read_json_body()
                return self.send_json(STORE.services.describe_frame(parts[2], manual=True))
            if len(parts) == 6 and parts[:2] == ["api", "projects"] and parts[3] == "memories" and parts[5] == "promote":
                return self.send_json(STORE.services.promote_memory(parts[2], parts[4]))
            if len(parts) == 6 and parts[:2] == ["api", "projects"] and parts[3] == "proposals" and parts[5] == "confirm":
                return self.send_json(STORE.services.confirm_proposal(parts[2], parts[4]))
            if len(parts) == 5 and parts[:2] == ["api", "projects"] and parts[3:] == ["training-guidance", "preview"]:
                return self.send_json(STORE.services.preview_training_guidance(parts[2], self.read_json_body()), HTTPStatus.CREATED)
            if len(parts) == 6 and parts[:2] == ["api", "projects"] and parts[3] == "training-guidance" and parts[5] == "activate":
                payload = self.read_json_body()
                return self.send_json(STORE.services.activate_training_guidance(parts[2], parts[4], payload.get("effectiveFromRound")))
            if len(parts) == 6 and parts[:2] == ["api", "projects"] and parts[3:] == ["menu", "workflows", "record"]:
                return self.send_json(STORE.services.record_menu_workflow(parts[2], self.read_json_body()))
            if len(parts) == 7 and parts[:2] == ["api", "projects"] and parts[3] == "menu" and parts[4] == "workflows" and parts[6] == "replay":
                return self.send_json(STORE.services.replay_menu_workflow(parts[2], parts[5], self.read_json_body()))
            if len(parts) == 5 and parts[:2] == ["api", "projects"] and parts[3:] == ["menu", "tasks"]:
                return self.send_json(STORE.services.create_menu_task(parts[2], self.read_json_body()), HTTPStatus.CREATED)
            if len(parts) == 7 and parts[:2] == ["api", "projects"] and parts[3] == "menu" and parts[4] == "tasks" and parts[6] in {"pause", "resume", "stop"}:
                self.read_json_body()
                return self.send_json(STORE.services.control_menu_task(parts[2], parts[5], parts[6]))
            if len(parts) == 5 and parts[:2] == ["api", "projects"] and parts[3:] == ["vision", "frame"]:
                effective = STORE.get_project_settings(parts[2])["effective"]
                max_gb = effective["storage"]["datasetMaxGb"]
                sample_fps = effective["vision"]["datasetSampleFps"]
                important_events = effective["logging"]["importantClips"]
                confidence_threshold = effective["camera"]["confidenceThreshold"]
                vision_llm_interval = effective["vision"]["localVisionLlmEverySeconds"]
                result = STORE.services.save_frame(
                    parts[2],
                    self.read_json_body(),
                    max_gb,
                    sample_fps,
                    important_events,
                    confidence_threshold,
                    vision_llm_interval,
                )
                runtime = STORE.runtime_status(parts[2])
                STORE.apply_engine_status(parts[2], result["engine"])
                runtime["visionReady"] = bool(result["state"].get("ready"))
                runtime["lastGameState"] = result["state"]
                runtime["message"] = str(result["state"].get("message", runtime["message"]))
                runtime["updatedAt"] = utc_now()
                return self.send_json(result)
            if len(parts) == 5 and parts[:2] == ["api", "projects"] and parts[3:] == ["datasets", "video"]:
                max_gb = STORE.get_project_settings(parts[2])["effective"]["storage"]["datasetMaxGb"]
                return self.send_json(STORE.services.save_video(parts[2], self.read_json_body(), max_gb), HTTPStatus.CREATED)
            if len(parts) == 5 and parts[:2] == ["api", "projects"] and parts[3:] == ["trajectory", "feedback"]:
                return self.send_json(STORE.services.record_action_feedback(parts[2], self.read_json_body()))
            if len(parts) == 5 and parts[:2] == ["api", "projects"] and parts[3] == "engine":
                return self.send_json(STORE.engine(parts[2], parts[4], self.read_json_body()))
            if len(parts) == 6 and parts[:2] == ["api", "projects"] and parts[3] == "models" and parts[5] == "canary":
                STORE.require_project(parts[2])
                payload = self.read_json_body()
                return self.send_json(STORE.services.model_action(parts[2], "canary", payload))
            if len(parts) == 6 and parts[:2] == ["api", "projects"] and parts[3] == "models" and parts[5] == "rollback":
                STORE.require_project(parts[2])
                return self.send_json(STORE.services.model_action(parts[2], "rollback", self.read_json_body()))
            if len(parts) == 5 and parts[:2] == ["api", "projects"] and parts[3] == "nxbt":
                action = parts[4]
                if action == "connect":
                    return self.send_json(STORE.connect_nxbt(parts[2], self.read_json_body()))
                if action == "disconnect":
                    self.read_json_body()
                    return self.send_json(STORE.disconnect_nxbt(parts[2]))
                if action == "action":
                    return self.send_json(STORE.action_nxbt(parts[2], self.read_json_body()))
                if action == "demonstration-action":
                    return self.send_json(STORE.action_nxbt(parts[2], self.read_json_body(), manual_demonstration=True))
                if action == "menu-action":
                    return self.send_json(STORE.action_nxbt(parts[2], self.read_json_body(), menu_action=True))
                if action == "test-input":
                    return self.send_json(STORE.test_nxbt_input(parts[2], self.read_json_body()))
                if action == "emergency-stop":
                    self.read_json_body()
                    return self.send_json(STORE.emergency_stop_nxbt(parts[2]))
            if len(parts) == 5 and parts[:2] == ["api", "projects"] and parts[3] == "control":
                return self.send_json(STORE.control(parts[2], parts[4], self.read_json_body()))
            raise ApiError(HTTPStatus.NOT_FOUND, "API route not found.")
        except (ApiError, ServiceError, zipfile.BadZipFile) as error:
            if isinstance(error, (ApiError, ServiceError)):
                self.send_json({"error": error.message}, error.status)
            else:
                self.send_json({"error": "Invalid zip archive."}, HTTPStatus.BAD_REQUEST)

    def do_PUT(self) -> None:
        try:
            self.require_mutation_auth()
            parts, _ = self.route()
            if parts == ["api", "settings", "global"]:
                return self.send_json(STORE.put_global_settings(self.read_json_body()))
            if parts == ["api", "settings", "llm"]:
                return self.send_json(STORE.services.put_llm_settings(self.read_json_body()))
            if len(parts) == 3 and parts[:2] == ["api", "projects"]:
                return self.send_json(STORE.rename_project(parts[2], self.read_json_body()))
            if len(parts) == 4 and parts[:2] == ["api", "projects"] and parts[3] == "state":
                return self.send_json(STORE.save_state(parts[2], self.read_json_body()))
            if len(parts) == 4 and parts[:2] == ["api", "projects"] and parts[3] == "settings":
                return self.send_json(STORE.put_project_settings(parts[2], self.read_json_body()))
            if len(parts) == 4 and parts[:2] == ["api", "projects"] and parts[3] == "memories":
                return self.send_json(STORE.services.put_memories(parts[2], self.read_json_body()))
            if len(parts) == 4 and parts[:2] == ["api", "projects"] and parts[3] == "control-bindings":
                return self.send_json(STORE.services.put_control_bindings(parts[2], self.read_json_body()))
            raise ApiError(HTTPStatus.NOT_FOUND, "API route not found.")
        except (ApiError, ServiceError) as error:
            self.send_json({"error": error.message}, error.status)

    def do_DELETE(self) -> None:
        try:
            self.require_mutation_auth()
            parts, _ = self.route()
            if len(parts) == 3 and parts[:2] == ["api", "projects"]:
                return self.send_json(STORE.move_to_trash(parts[2]))
            if len(parts) == 4 and parts[:2] == ["api", "projects"] and parts[3] == "logs":
                return self.send_json(STORE.clear_logs(parts[2], self.read_json_body()))
            if len(parts) == 5 and parts[:2] == ["api", "projects"] and parts[3:] == ["assistant", "chat"]:
                return self.send_json(STORE.services.clear_conversations(parts[2]))
            if len(parts) == 3 and parts[:2] == ["api", "trash"]:
                STORE.delete_trash(parts[2])
                return self.send_json({"ok": True})
            raise ApiError(HTTPStatus.NOT_FOUND, "API route not found.")
        except (ApiError, ServiceError) as error:
            self.send_json({"error": error.message}, error.status)

    def send_sse(self, project_id: str) -> None:
        STORE.require_project(project_id)
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        try:
            for _ in range(60):
                payload = json.dumps(STORE.runtime_status(project_id), ensure_ascii=False)
                self.wfile.write(f"data: {payload}\n\n".encode("utf-8"))
                self.wfile.flush()
                time.sleep(1)
        except (BrokenPipeError, ConnectionResetError):
            return


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8765, type=int)
    args = parser.parse_args()
    server = LocalThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Switch 2 AI local server ready: http://localhost:{args.port}", flush=True)
    try:
        server.serve_forever()
    finally:
        STORE.shutdown_application()
        server.server_close()


if __name__ == "__main__":
    main()
