import importlib.util
import base64
import io
import json
import stat
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import zipfile
from pathlib import Path


SPEC = importlib.util.spec_from_file_location("switch2_server", Path(__file__).parents[1] / "server" / "app.py")
app = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(app)


class StoreTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.originals = {
            "DATA": app.DATA,
            "PROJECTS": app.PROJECTS,
            "TRASH": app.TRASH,
            "PRESETS": app.PRESETS,
            "APP_SETTINGS": app.APP_SETTINGS,
            "GLOBAL_DEFAULTS": app.GLOBAL_DEFAULTS,
            "STORE": app.STORE,
        }
        app.DATA = root / "data"
        app.PROJECTS = app.DATA / "projects"
        app.TRASH = app.DATA / "trash"
        app.PRESETS = app.DATA / "presets"
        app.APP_SETTINGS = app.DATA / "app-settings.json"
        app.GLOBAL_DEFAULTS = app.DATA / "global-defaults.json"
        self.store = app.Store()
        app.STORE = self.store

    def tearDown(self):
        if hasattr(self.store.services.worker, "shutdown"):
            self.store.services.worker.shutdown()
        for key, value in self.originals.items():
            setattr(app, key, value)
        self.temp.cleanup()

    def test_state_save_strips_runtime_hardware_and_snapshot_restores(self):
        project = self.store.create_project({"name": "Mario Kart World"})
        project_id = project["manifest"]["id"]
        self.store.save_state(project_id, {"bestScore": 42, "cameraConnected": True, "connectionOk": True, "externalPowerOk": True})
        state = self.store.load_project(project_id)["state"]
        self.assertEqual(state["bestScore"], 42)
        self.assertNotIn("cameraConnected", state)
        self.assertNotIn("connectionOk", state)
        self.assertNotIn("externalPowerOk", state)
        snapshot = self.store.create_snapshot(project_id, {"name": "stable"})
        self.store.save_state(project_id, {"bestScore": 7})
        restored = self.store.restore_snapshot(project_id, snapshot["id"])
        self.assertEqual(restored["state"]["bestScore"], 42)

    def test_trash_restore_and_zip_roundtrip(self):
        project = self.store.create_project({"name": "Racing"})
        project_id = project["manifest"]["id"]
        archive = self.store.export_project(project_id)
        self.store.move_to_trash(project_id)
        self.assertEqual(self.store.list_projects(), [])
        restored = self.store.restore_trash(project_id)
        self.assertEqual(restored["manifest"]["name"], "Racing")
        imported = self.store.import_project(archive.read_bytes())
        self.assertNotEqual(imported["manifest"]["id"], project_id)
        self.assertEqual(imported["manifest"]["name"], "Racing")

    def test_hard_limits_clamp_and_unconnected_engine_rejects_resume(self):
        project = self.store.create_project({"name": "Limits"})
        project_id = project["manifest"]["id"]
        settings = self.store.put_project_settings(project_id, {"controller": {"maxPressMs": 999999, "maxTravelMm": 999}})
        self.assertEqual(settings["effective"]["controller"]["maxPressMs"], 2000)
        self.assertEqual(settings["effective"]["controller"]["maxTravelMm"], 20)
        with self.assertRaises(app.ApiError):
            self.store.control(project_id, "resume", {})
        paused = self.store.control(project_id, "pause", {})
        self.assertTrue(paused["paused"])
        actions = list((app.PROJECTS / project_id / "logs").glob("actions-*.jsonl"))
        self.assertEqual(len(actions), 1)

    def test_engine_start_requires_vision_and_nxbt_runtime_verification(self):
        project = self.store.create_project({"name": "Engine gate"})
        project_id = project["manifest"]["id"]
        self.store.put_project_settings(project_id, {"output": {"backend": "nxbt_bluetooth"}})
        calls = []

        class FakeWorker:
            def call(self, command, payload=None):
                calls.append((command, payload or {}))
                return {"ready": True, "mode": "training", "message": "started"}

        self.store.services.worker = FakeWorker()
        with self.assertRaises(app.ApiError):
            self.store.engine(project_id, "start", {})
        runtime = self.store.runtime_status(project_id)
        runtime["visionReady"] = True
        with self.assertRaises(app.ApiError):
            self.store.engine(project_id, "start", {})
        runtime["controllerReady"] = True
        with self.assertRaises(app.ApiError):
            self.store.engine(project_id, "start", {})
        runtime["emergencyStopVerified"] = True
        started = self.store.engine(project_id, "start", {})
        self.assertTrue(started["ready"])
        self.assertEqual(calls[0][0], "engine_start")

    def test_open_project_resets_ephemeral_runtime(self):
        project = self.store.create_project({"name": "Runtime"})
        project_id = project["manifest"]["id"]
        runtime = self.store.runtime_status(project_id)
        runtime["engineReady"] = True
        runtime["controllerReady"] = True
        self.store.nxbt_connectors[project_id] = {"host": "127.0.0.1", "port": 8766, "token": "ephemeral"}
        self.store.nxbt_request = lambda connector, path, payload=None, timeout=5: {"emergencyStopVerified": True}
        opened = self.store.open_project(project_id)
        self.assertFalse(opened["runtime"]["engineReady"])
        self.assertFalse(opened["runtime"]["controllerReady"])
        self.assertNotIn(project_id, self.store.nxbt_connectors)

    def test_open_project_resets_connectors_from_other_projects(self):
        first = self.store.create_project({"name": "First"})
        second = self.store.create_project({"name": "Second"})
        requests = []
        self.store.nxbt_connectors[first["manifest"]["id"]] = {"host": "127.0.0.1", "port": 8766, "token": "first"}
        self.store.nxbt_connectors[second["manifest"]["id"]] = {"host": "127.0.0.1", "port": 8766, "token": "second"}
        self.store.nxbt_request = lambda connector, path, payload=None, timeout=5: requests.append((connector["token"], path)) or {"emergencyStopVerified": True}
        self.store.open_project(second["manifest"]["id"])
        self.assertEqual(self.store.nxbt_connectors, {})
        self.assertEqual(sorted(requests), [("first", "/emergency-stop"), ("second", "/emergency-stop")])

    def test_emergency_stop_control_invalidates_previous_nxbt_verification(self):
        project = self.store.create_project({"name": "Emergency"})
        project_id = project["manifest"]["id"]
        runtime = self.store.runtime_status(project_id)
        runtime["emergencyStopVerified"] = True
        stopped = self.store.control(project_id, "emergency-stop", {})
        self.assertFalse(stopped["emergencyStopVerified"])
        self.assertEqual(stopped["mode"], "emergency-stop")

    def test_nxbt_connector_is_private_ephemeral_and_emergency_stop_removes_it(self):
        project = self.store.create_project({"name": "NXBT"})
        project_id = project["manifest"]["id"]
        requests = []

        def fake_request(connector, path, payload=None, timeout=5):
            requests.append((connector.copy(), path, payload, timeout))
            if path == "/connect":
                return {"controllerReady": True}
            if path == "/health":
                return {"controllerReady": True}
            if path == "/action":
                return {"ok": True}
            if path == "/emergency-stop":
                return {"emergencyStopVerified": True}
            raise AssertionError(path)

        self.store.nxbt_request = fake_request
        secret = "do-not-persist-this"
        connected = self.store.connect_nxbt(project_id, {"host": "127.0.0.1", "port": 8766, "token": secret, "reconnect": False})
        self.assertTrue(connected["ready"])
        self.assertNotIn("token", connected)
        self.assertTrue(self.store.nxbt_status(project_id)["ready"])
        runtime = self.store.runtime_status(project_id)
        runtime["engineReady"] = True
        runtime["mode"] = "training"
        runtime["visionReady"] = True
        runtime["emergencyStopVerified"] = True
        self.assertTrue(self.store.action_nxbt(project_id, {"buttons": {"a": True}, "durationMs": 120})["ok"])
        stopped = self.store.emergency_stop_nxbt(project_id)
        self.assertTrue(stopped["emergencyStopVerified"])
        self.assertNotIn(project_id, self.store.nxbt_connectors)
        self.assertNotIn(secret, (app.PROJECTS / project_id / "logs" / "events.jsonl").read_text(encoding="utf-8"))
        self.assertEqual([item[1] for item in requests], ["/connect", "/health", "/action", "/emergency-stop"])
        with self.assertRaises(app.ApiError):
            self.store.connect_nxbt(project_id, {"host": "8.8.8.8", "port": 8766, "token": secret})

    def test_nxbt_action_is_backend_gated_and_rejects_locked_buttons(self):
        project = self.store.create_project({"name": "NXBT gated"})
        project_id = project["manifest"]["id"]
        sent = []
        self.store.nxbt_connectors[project_id] = {"host": "127.0.0.1", "port": 8766, "token": "private"}
        self.store.nxbt_request = lambda connector, path, payload=None, timeout=5: sent.append((path, payload)) or {"ok": True}
        with self.assertRaises(app.ApiError):
            self.store.action_nxbt(project_id, {"buttons": {"a": True}})
        with self.assertRaises(app.ApiError):
            self.store.action_nxbt(project_id, {"buttons": {"home": True}})
        runtime = self.store.runtime_status(project_id)
        runtime["visionReady"] = True
        runtime["controllerReady"] = True
        runtime["emergencyStopVerified"] = True
        self.store.action_nxbt(project_id, {"buttons": {"a": True}}, manual_demonstration=True)
        self.assertEqual(sent[-1][0], "/action")
        self.store.action_nxbt(project_id, {"durationMs": 999, "buttons": {"dpad_right": True}}, menu_action=True)
        self.assertEqual(sent[-1][1]["durationMs"], 250)
        self.assertTrue(sent[-1][1]["buttons"]["dpad_right"])
        with self.assertRaises(app.ApiError):
            self.store.action_nxbt(project_id, {"buttons": {"home": True}}, menu_action=True)
        runtime["engineReady"] = True
        runtime["mode"] = "training"
        with self.assertRaises(app.ApiError):
            self.store.action_nxbt(project_id, {"buttons": {"a": True}}, manual_demonstration=True)
        with self.assertRaises(app.ApiError):
            self.store.action_nxbt(project_id, {"buttons": {"dpad_right": True}}, menu_action=True)
        self.store.action_nxbt(project_id, {"durationMs": 9999, "sticks": {"left_stick_x": 999}, "buttons": {"a": True}})
        self.assertEqual(sent[-1][1]["durationMs"], 1500)
        self.assertEqual(sent[-1][1]["sticks"]["left_stick_x"], 100)
        runtime["paused"] = True
        with self.assertRaises(app.ApiError):
            self.store.action_nxbt(project_id, {"buttons": {"a": True}})
        self.store.action_nxbt(project_id, {"sticks": {}, "buttons": {}})
        self.assertEqual(sent[-1][0], "/action")

    def test_apply_engine_status_tracks_mode_round_gate_and_shadow(self):
        project = self.store.create_project({"name": "Runtime status"})
        project_id = project["manifest"]["id"]
        runtime = self.store.apply_engine_status(project_id, {"ready": True, "mode": "live", "steps": 12, "shadowReady": True, "awaitingNextRound": True})
        self.assertEqual(runtime["mode"], "live")
        self.assertEqual(runtime["steps"], 12)
        self.assertTrue(runtime["shadowReady"])
        self.assertTrue(runtime["awaitingNextRound"])

    def test_nxbt_failed_emergency_stop_keeps_connector_for_retry(self):
        project = self.store.create_project({"name": "NXBT retry"})
        project_id = project["manifest"]["id"]
        connector = {"host": "127.0.0.1", "port": 8766, "token": "retry"}
        self.store.nxbt_connectors[project_id] = connector

        def fail_request(*args, **kwargs):
            raise app.ApiError(409, "temporary bridge failure")

        self.store.nxbt_request = fail_request
        with self.assertRaises(app.ApiError):
            self.store.emergency_stop_nxbt(project_id)
        self.assertEqual(self.store.nxbt_connectors[project_id], connector)

    def test_clear_logs_removes_events_actions_and_optional_clips(self):
        project = self.store.create_project({"name": "Logs"})
        project_id = project["manifest"]["id"]
        self.store.control(project_id, "pause", {})
        clip = app.PROJECTS / project_id / "clips" / "crash.mp4"
        clip.write_bytes(b"clip")
        result = self.store.clear_logs(project_id, {"scope": "all", "includeClips": True})
        self.assertGreaterEqual(result["deletedFiles"], 2)
        self.assertEqual(result["deletedClips"], 1)
        self.assertFalse(list((app.PROJECTS / project_id / "logs").glob("actions-*.jsonl")))
        self.assertFalse(clip.exists())
        logs = self.store.list_logs(project_id, {})
        self.assertEqual(logs[0]["event"], "logs_cleared")

    def test_invalid_settings_shape_is_rejected(self):
        project = self.store.create_project({"name": "Settings"})
        project_id = project["manifest"]["id"]
        with self.assertRaises(app.ApiError):
            self.store.put_project_settings(project_id, {"controller": 1})
        with self.assertRaises(app.ApiError):
            self.store.put_global_settings({"unknown": {"value": 1}})

    def test_logging_preferences_apply_and_safety_requirements_cannot_be_disabled(self):
        project = self.store.create_project({"name": "Preferences"})
        project_id = project["manifest"]["id"]
        settings = self.store.put_project_settings(project_id, {
            "logging": {"events": True, "actions": False, "minimumSeverity": "warning"},
            "safety": {"requireCameraPreview": False, "requireBoardVerification": False, "requireEmergencyStopTest": False, "abnormalActionDetection": False},
        })
        self.assertTrue(all(settings["effective"]["safety"].values()))
        events = app.PROJECTS / project_id / "logs" / "events.jsonl"
        before = events.read_text(encoding="utf-8")
        self.store.log(project_id, "info", "test", "ignored_info", {})
        self.store.log(project_id, "warning", "test", "kept_warning", {})
        after = events.read_text(encoding="utf-8")
        self.assertNotIn("ignored_info", after[len(before):])
        self.assertIn("kept_warning", after)
        self.store.control(project_id, "pause", {})
        self.assertFalse(list((app.PROJECTS / project_id / "logs").glob("actions-*.jsonl")))

    def test_zip_import_rejects_expansion_beyond_limit(self):
        original_limit = app.MAX_ZIP_UNCOMPRESSED
        app.MAX_ZIP_UNCOMPRESSED = 8
        try:
            archive = io.BytesIO()
            with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as handle:
                handle.writestr("project/manifest.json", "{}" * 20)
            with self.assertRaises(app.ApiError):
                self.store.import_project(archive.getvalue())
        finally:
            app.MAX_ZIP_UNCOMPRESSED = original_limit

    def test_zip_import_rejects_symbolic_links(self):
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w") as handle:
            link = zipfile.ZipInfo("project/link")
            link.create_system = 3
            link.external_attr = (stat.S_IFLNK | 0o777) << 16
            handle.writestr(link, "target")
        with self.assertRaises(app.ApiError):
            self.store.import_project(archive.getvalue())

    def test_readonly_project_load_does_not_change_last_project(self):
        first = self.store.create_project({"name": "First"})
        second = self.store.create_project({"name": "Second"})
        self.store.load_project(first["manifest"]["id"], mark_opened=False)
        self.assertEqual(self.store.app_settings()["lastProjectId"], second["manifest"]["id"])

    def test_log_size_limit_prunes_old_clip_files(self):
        project = self.store.create_project({"name": "Retention"})
        project_id = project["manifest"]["id"]
        original_limit = app.HARD_LIMITS[("storage", "maxLogGb")]
        app.HARD_LIMITS[("storage", "maxLogGb")] = (0.000001, 100)
        try:
            self.store.put_project_settings(project_id, {"storage": {"maxLogGb": 0.000001}})
            clip = app.PROJECTS / project_id / "clips" / "old.mp4"
            clip.write_bytes(b"x" * (2 * 1024 * 1024))
            self.store.log(project_id, "info", "storage", "trigger_prune", {})
            self.assertFalse(clip.exists())
        finally:
            app.HARD_LIMITS[("storage", "maxLogGb")] = original_limit


class ApiTest(StoreTest):
    def setUp(self):
        super().setUp()
        self.server = app.ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        super().tearDown()

    def request(self, method, path, payload=None, token=True, origin=None):
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        if token:
            headers["X-Session-Token"] = app.SESSION_TOKEN
        if origin:
            headers["Origin"] = origin
        request = urllib.request.Request(self.base + path, data=body, headers=headers, method=method)
        with urllib.request.urlopen(request) as response:
            return response.status, json.loads(response.read().decode("utf-8"))

    def test_api_crud_auth_and_static_data_block(self):
        status, health = self.request("GET", "/api/health")
        self.assertEqual(status, 200)
        self.assertEqual(health["service"], "switch2-ai-local")
        status, capabilities = self.request("GET", "/api/capabilities")
        self.assertEqual(status, 200)
        status, worker = self.request("GET", "/api/worker/health")
        self.assertEqual(status, 200)
        expected_connected = worker["workerReady"] and (worker["ocr"] or worker["training"]["ready"])
        self.assertEqual(capabilities["engineConnected"], expected_connected)
        self.assertIn("hardware", capabilities)
        self.assertIn("computeTargets", capabilities)
        status, refreshed = self.request("POST", "/api/capabilities/refresh", {})
        self.assertEqual(status, 200)
        self.assertEqual(refreshed["engineConnected"], expected_connected)
        status, project = self.request("POST", "/api/projects", {"name": "API"})
        self.assertEqual(status, 201)
        project_id = project["manifest"]["id"]
        status, cleared = self.request("DELETE", f"/api/projects/{project_id}/logs", {"scope": "events"})
        self.assertEqual(status, 200)
        self.assertTrue(cleared["ok"])
        status, opened = self.request("POST", f"/api/projects/{project_id}/open", {})
        self.assertEqual(status, 200)
        self.assertFalse(opened["runtime"]["engineReady"])
        status, listing = self.request("GET", "/api/projects")
        self.assertEqual(status, 200)
        self.assertEqual(listing["projects"][0]["id"], project_id)
        with self.assertRaises(urllib.error.HTTPError) as denied:
            self.request("PUT", f"/api/projects/{project_id}/state", {"bestScore": 1}, token=False)
        self.assertEqual(denied.exception.code, 403)
        with self.assertRaises(urllib.error.HTTPError) as hidden:
            self.request("GET", "/data/app-settings.json")
        self.assertEqual(hidden.exception.code, 404)
        with self.assertRaises(urllib.error.HTTPError) as hidden_source:
            self.request("GET", "/src/not-allowed.js")
        self.assertEqual(hidden_source.exception.code, 404)
        with self.assertRaises(urllib.error.HTTPError) as bad_limit:
            self.request("GET", f"/api/projects/{project_id}/logs?limit=nope")
        self.assertEqual(bad_limit.exception.code, 400)
        status, saved = self.request(
            "PUT",
            f"/api/projects/{project_id}/state",
            {"bestScore": 2},
            origin=f"http://127.0.0.1:{self.server.server_port}",
        )
        self.assertEqual(status, 200)
        self.assertEqual(saved["bestScore"], 2)
        with self.assertRaises(urllib.error.HTTPError) as invalid_origin:
            self.request(
                "PUT",
                f"/api/projects/{project_id}/state",
                {"bestScore": 3},
                origin="http://example.com",
            )
        self.assertEqual(invalid_origin.exception.code, 403)

    def test_runtime_service_api_chat_memory_frame_and_llm_key_safety(self):
        _, project = self.request("POST", "/api/projects", {"name": "Assistant API"})
        project_id = project["manifest"]["id"]
        _, dependencies = self.request("GET", "/api/dependencies")
        self.assertIn("packages", dependencies)
        _, llm = self.request("PUT", "/api/settings/llm", {"baseUrl": "https://example.com/v1", "textModel": "test", "apiKey": "never-write-this"})
        self.assertTrue(llm["hasApiKey"])
        self.assertNotIn("never-write-this", (app.DATA / "llm-settings.json").read_text(encoding="utf-8"))
        self.request("PUT", "/api/settings/llm", {"baseUrl": "", "textModel": "", "rememberApiKey": False})
        _, chat = self.request("POST", f"/api/projects/{project_id}/assistant/chat", {"message": "記住 A 是加速鍵"})
        proposal_id = chat["proposal"]["id"]
        _, confirmed = self.request("POST", f"/api/projects/{project_id}/proposals/{proposal_id}/confirm", {})
        self.assertTrue(confirmed["ok"])
        _, bindings = self.request("GET", f"/api/projects/{project_id}/control-bindings")
        self.assertEqual(len(bindings["bindings"]), 1)
        self.assertEqual(bindings["bindings"][0]["input"], "a")

        class FakeWorker:
            def call(self, command, payload=None):
                if command == "ocr":
                    return {"ready": True, "rank": 1, "confidence": 0.9, "message": "OCR ok"}
                if command == "engine_frame":
                    return {"ready": False, "action": None}
                return {"workerReady": True}

        self.store.services.worker = FakeWorker()
        jpeg = base64.b64encode(b"\xff\xd8\xff\xe0api-test").decode("ascii")
        _, frame = self.request("POST", f"/api/projects/{project_id}/vision/frame", {"imageBase64": jpeg})
        self.assertEqual(frame["state"]["rank"], 1)
        _, cleared = self.request("DELETE", f"/api/projects/{project_id}/assistant/chat", {})
        self.assertTrue(cleared["ok"])

    def test_offline_guidance_binding_and_menu_api_routes(self):
        _, project = self.request("POST", "/api/projects", {"name": "Offline routes"})
        project_id = project["manifest"]["id"]
        _, status = self.request("GET", "/api/assistant/status")
        self.assertEqual(status["mode"], "offline")
        self.assertIn("核心功能可正常使用", status["message"])

        _, interpreted = self.request("POST", f"/api/projects/{project_id}/assistant/interpret", {"message": "ZR 是使用道具"})
        self.assertEqual(interpreted["proposal"]["action"], "save_control_binding")
        _, saved = self.request("PUT", f"/api/projects/{project_id}/control-bindings", {"bindings": [{"context": "race", "input": "zr", "meaning": "使用道具", "holdMs": 120}]})
        self.assertEqual(saved["bindings"][0]["input"], "zr")

        _, preview = self.request("POST", f"/api/projects/{project_id}/training-guidance/preview", {"goal": "reduce_crashes", "strength": 3})
        _, activated = self.request("POST", f"/api/projects/{project_id}/training-guidance/{preview['guidance']['id']}/activate", {})
        self.assertEqual(activated["guidance"]["status"], "scheduled")
        _, guidance = self.request("GET", f"/api/projects/{project_id}/training-guidance")
        self.assertEqual(len(guidance["guidance"]), 1)

        _, recording = self.request("POST", f"/api/projects/{project_id}/menu/workflows/record", {"operation": "start", "name": "測試流程"})
        self.assertEqual(recording["workflow"]["status"], "recording")
        _, workflows = self.request("GET", f"/api/projects/{project_id}/menu/workflows")
        self.assertTrue(any(item["name"] == "測試流程" for item in workflows["workflows"]))
        _, task = self.request("POST", f"/api/projects/{project_id}/menu/tasks", {"target": "完全陌生的複雜選單"})
        self.assertEqual(task["task"]["status"], "needs_user")

    def test_dependency_recommended_install_and_model_rollback_routes(self):
        _, project = self.request("POST", "/api/projects", {"name": "Routes"})
        project_id = project["manifest"]["id"]
        calls = []

        class FakeWorker:
            def call(self, command, payload=None):
                calls.append((command, payload or {}))
                return {"ok": True, "message": command}

        self.store.services.install = lambda package_id: {"ok": True, "package": package_id, "message": "queued"}
        self.store.services.worker = FakeWorker()
        _, installed = self.request("POST", "/api/dependencies/install", {})
        self.assertEqual(installed["package"], "recommended")
        stable = app.PROJECTS / project_id / "models" / "stable" / "ppo-latest.zip"
        stable.parent.mkdir(parents=True, exist_ok=True)
        stable.write_bytes(b"stable")
        _, health = self.request("GET", f"/api/projects/{project_id}/engine/health")
        self.assertTrue(health["training"]["stableReady"])
        _, rolled_back = self.request("POST", f"/api/projects/{project_id}/models/stable/rollback", {})
        self.assertTrue(rolled_back["ok"])
        self.assertEqual(calls[-1][0], "rollback")


if __name__ == "__main__":
    unittest.main()
