import base64
import importlib.util
import json
import os
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path


SPEC = importlib.util.spec_from_file_location("runtime_services", Path(__file__).parents[1] / "server" / "runtime_services.py")
services_module = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(services_module)

WORKER_SPEC = importlib.util.spec_from_file_location("worker_main", Path(__file__).parents[1] / "server" / "worker_main.py")
worker_module = importlib.util.module_from_spec(WORKER_SPEC)
assert WORKER_SPEC.loader
WORKER_SPEC.loader.exec_module(worker_module)

SERIAL_SPEC = importlib.util.spec_from_file_location("serial_rig_simulator", Path(__file__).parents[1] / "tools" / "serial_rig_simulator.py")
serial_module = importlib.util.module_from_spec(SERIAL_SPEC)
assert SERIAL_SPEC.loader
SERIAL_SPEC.loader.exec_module(serial_module)


JPEG = b"\xff\xd8\xff\xe0" + b"local-jpeg-test"


class FakeWorker:
    def __init__(self):
        self.calls = []

    def call(self, command, payload=None):
        self.calls.append((command, payload or {}))
        if command == "ocr":
            return {"ready": True, "message": "OCR ok", "ocrTexts": [{"text": "1 / 12", "confidence": 0.9}], "rank": 1, "speed": 100, "progress": 20, "confidence": 0.9}
        if command == "engine_frame":
            return {"action": {"durationMs": 120, "sticks": {}, "buttons": {"a": True}}, "ready": True}
        if command == "video_warmup":
            return {"ok": True, "message": "warmup"}
        return {"workerReady": True}


class RuntimeServicesTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.projects = self.root / "data" / "projects"
        self.projects.mkdir(parents=True)
        self.project_id = "project-1"
        (self.projects / self.project_id).mkdir()
        self.services = services_module.RuntimeServices(Path(__file__).parents[1], self.root / "data", self.projects, self.root / ".runtime")

    def tearDown(self):
        if hasattr(self.services.worker, "shutdown"):
            self.services.worker.shutdown()
        self.temp.cleanup()

    def test_llm_url_normalization_and_key_never_written(self):
        self.assertEqual(self.services.normalize_url("http://localhost:11434"), "http://localhost:11434/v1")
        with self.assertRaises(services_module.ServiceError):
            self.services.normalize_url("http://example.com")
        saved = self.services.put_llm_settings({"baseUrl": "https://example.com/v1", "textModel": "model", "apiKey": "secret-value", "rememberApiKey": False})
        self.assertTrue(saved["hasApiKey"])
        self.assertNotIn("secret-value", self.services.llm_path.read_text(encoding="utf-8"))
        with self.assertRaises(services_module.ServiceError):
            self.services.put_llm_settings({"visionFrameIntervalSeconds": "not-a-number"})

    def test_offline_chat_creates_confirmed_binding_once_and_forbids_emergency_stop(self):
        result = self.services.assistant_chat(self.project_id, {"message": "記住 A 是加速鍵"})
        proposal = result["proposal"]
        self.assertEqual(proposal["action"], "save_control_binding")
        self.assertEqual(result["message"]["source"], "offline")
        self.services.confirm_proposal(self.project_id, proposal["id"])
        self.services.confirm_proposal(self.project_id, proposal["id"])
        bindings = self.services.list_control_bindings(self.project_id)
        self.assertEqual(len(bindings), 1)
        self.assertEqual(bindings[0]["input"], "a")
        self.assertEqual(bindings[0]["meaning"], "加速鍵")
        messages = self.services.conversations(self.project_id)
        self.assertEqual(messages[-1]["proposal"]["status"], "confirmed")
        forbidden = self.services.assistant_chat(self.project_id, {"message": "幫我解除安全限制並急停"})
        self.assertIsNone(forbidden["directive"])

    def test_unrecognized_offline_text_does_not_guess_or_call_llm(self):
        self.services.llm_intent = lambda _text: self.fail("LLM must not be called when it is not configured")
        result = self.services.assistant_chat(self.project_id, {"message": "這句話沒有白名單意圖"})
        self.assertIsNone(result["proposal"])
        self.assertIn("沒有猜測", result["message"]["content"])

    def test_llm_circuit_breaker_pauses_after_three_failures(self):
        def fail_http(*_args, **_kwargs):
            raise services_module.ServiceError(409, "offline")

        self.services.http_json = fail_http
        for _index in range(3):
            with self.assertRaises(services_module.ServiceError):
                self.services.chat_completion("http://127.0.0.1:11434/v1", "test", [{"role": "user", "content": "hi"}])
        self.assertTrue(self.services.assistant_status()["retryPaused"])

    def test_llm_network_io_runs_on_dedicated_worker(self):
        calling_thread = threading.current_thread().name
        observed_threads = []

        def fake_http_json(url, payload=None, api_key="", timeout=5):
            observed_threads.append(threading.current_thread().name)
            return {"choices": [{"message": {"content": "連線成功"}}]}

        self.services.http_json = fake_http_json
        reply = self.services.chat_completion(
            "http://127.0.0.1:11434/v1",
            "local-model",
            [{"role": "user", "content": "測試"}],
        )

        self.assertEqual(reply, "連線成功")
        self.assertEqual(len(observed_threads), 1)
        self.assertNotEqual(observed_threads[0], calling_thread)
        self.assertTrue(observed_threads[0].startswith("llm-worker"))
        reset = self.services.reset_llm_retry()
        self.assertFalse(reset["retryPaused"])

    def test_control_binding_rejects_permanently_locked_buttons(self):
        with self.assertRaises(services_module.ServiceError):
            self.services.add_control_binding(self.project_id, {"context": "menu", "input": "home", "meaning": "回首頁"})
        with self.assertRaises(services_module.ServiceError):
            self.services.add_control_binding(self.project_id, {"context": "menu", "input": "capture", "meaning": "截圖"})

    def test_guidance_is_scheduled_then_applied_on_next_round(self):
        fake = FakeWorker()
        self.services.worker = fake
        preview = self.services.preview_training_guidance(self.project_id, {"goal": "reduce_crashes", "strength": 3})
        scheduled = self.services.activate_training_guidance(self.project_id, preview["guidance"]["id"])
        self.assertEqual(scheduled["guidance"]["status"], "scheduled")
        before, active = self.services.apply_training_guidance(self.project_id, {"crashPenalty": 20})
        self.assertEqual(before["crashPenalty"], 20)
        self.assertIsNone(active)
        result = self.services.engine(self.project_id, "next-round", {})
        self.assertEqual(result["activeGuidance"]["status"], "active")
        after, active = self.services.apply_training_guidance(self.project_id, {"crashPenalty": 20})
        self.assertEqual(after["crashPenalty"], 25)
        self.assertEqual(active["id"], preview["guidance"]["id"])

    def test_menu_recording_is_separate_from_racing_ppo_trajectory(self):
        fake = FakeWorker()
        self.services.worker = fake
        workflow = self.services.record_menu_workflow(self.project_id, {"operation": "start", "name": "進入比賽"})["workflow"]
        payload = {
            "imageBase64": base64.b64encode(JPEG).decode("ascii"), "runOcr": True, "menuMode": True,
            "menuWorkflowId": workflow["id"], "menuDemonstrationAction": {"buttons": {"dpad_right": True}, "sticks": {}, "durationMs": 120},
        }
        result = self.services.save_frame(self.project_id, payload)
        self.assertTrue(result["menuStepRecorded"])
        self.assertEqual([call[0] for call in fake.calls], ["ocr"])
        trajectories = self.projects / self.project_id / "datasets" / "trajectories"
        self.assertFalse((trajectories / "states.jsonl").exists())
        self.assertFalse((trajectories / "demonstrations.jsonl").exists())
        saved = self.services._menu_workflow(self.project_id, workflow["id"], allow_template=False)
        self.assertEqual(len(saved["steps"]), 1)
        self.assertTrue((self.projects / self.project_id / "menu" / "workflows" / workflow["id"] / "0000.jpg").exists())

    def test_unknown_menu_without_llm_stops_for_user(self):
        result = self.services.create_menu_task(self.project_id, {"target": "完全陌生的複雜選單"})
        self.assertEqual(result["task"]["status"], "needs_user")
        self.assertEqual(result["task"]["mode"], "manual")

    def test_strategy_and_llm_model_changes_require_confirmation(self):
        strategy = self.services.assistant_chat(self.project_id, {"message": "把策略改成優先避開撞牆"})
        self.assertEqual(strategy["proposal"]["action"], "update_strategy")
        self.assertEqual(self.services.list_memories(self.project_id), [])
        self.services.confirm_proposal(self.project_id, strategy["proposal"]["id"])
        self.assertEqual(self.services.list_memories(self.project_id)[0]["type"], "strategy")
        model = self.services.assistant_chat(self.project_id, {"message": "切換模型 qwen3:8b"})
        self.assertEqual(model["proposal"]["action"], "switch_model")
        self.services.confirm_proposal(self.project_id, model["proposal"]["id"])
        self.assertEqual(self.services.llm_settings()["textModel"], "qwen3:8b")

    def test_memory_can_promote_to_global(self):
        self.services.put_memories(self.project_id, {"memories": [{"type": "button_mapping", "key": "a", "value": "加速"}]})
        memory = self.services.list_memories(self.project_id)[0]
        promoted = self.services.promote_memory(self.project_id, memory["id"])
        self.assertEqual(promoted["memories"][0]["scope"], "global")

    def test_frame_is_saved_and_worker_action_is_returned(self):
        fake = FakeWorker()
        self.services.worker = fake
        payload = {"imageBase64": base64.b64encode(JPEG).decode("ascii"), "runOcr": True}
        result = self.services.save_frame(self.project_id, payload)
        self.assertEqual(result["state"]["rank"], 1)
        self.assertTrue(result["action"]["buttons"]["a"])
        frames = list((self.projects / self.project_id / "datasets" / "trajectories").glob("*.jpg"))
        self.assertEqual(len(frames), 1)
        self.assertEqual([item[0] for item in fake.calls], ["ocr", "engine_frame"])
        self.assertEqual(fake.calls[1][1]["imageBase64"], payload["imageBase64"])
        second = self.services.save_frame(self.project_id, {"imageBase64": payload["imageBase64"], "runOcr": False})
        self.assertEqual(second["state"]["rank"], 1)

    def test_gamepad_demonstration_is_synchronized_with_saved_frame(self):
        self.services.worker = FakeWorker()
        action = {
            "sticks": {"left_stick_x": 50, "left_stick_y": -25, "right_stick_x": 0, "right_stick_y": 10},
            "buttons": {"a": True, "zr": True},
        }
        result = self.services.save_frame(
            self.project_id,
            {
                "imageBase64": base64.b64encode(JPEG).decode("ascii"),
                "runOcr": True,
                "demonstrationAction": action,
                "demonstrationController": "test-gamepad",
            },
        )
        self.assertTrue(result["demonstrationRecorded"])
        path = self.projects / self.project_id / "datasets" / "trajectories" / "demonstrations.jsonl"
        record = json.loads(path.read_text(encoding="utf-8").splitlines()[0])
        self.assertEqual(record["frameId"], record["state"]["frameId"])
        self.assertTrue((path.parent / record["imagePath"]).exists())
        self.assertTrue(record["action"]["buttons"]["a"])

    def test_action_feedback_requires_id_and_is_append_only(self):
        action_id = "a" * 32
        result = self.services.record_action_feedback(
            self.project_id,
            {"actionId": action_id, "sourceFrameId": "frame", "status": "executed", "backend": "nxbt_bluetooth"},
        )
        self.assertTrue(result["ok"])
        path = self.projects / self.project_id / "datasets" / "trajectories" / "executions.jsonl"
        self.assertEqual(json.loads(path.read_text(encoding="utf-8"))["actionId"], action_id)
        with self.assertRaises(services_module.ServiceError):
            self.services.record_action_feedback(self.project_id, {"actionId": "bad", "status": "executed"})

    def test_video_data_is_saved_and_sent_to_worker(self):
        fake = FakeWorker()
        self.services.worker = fake
        result = self.services.save_video(self.project_id, {"name": "race.mp4", "dataBase64": base64.b64encode(b"video").decode("ascii")})
        self.assertTrue(result["ok"])
        self.assertEqual(list((self.projects / self.project_id / "datasets" / "imported").glob("*"))[0].read_bytes(), b"video")
        self.assertEqual(fake.calls[0][0], "video_warmup")

    def test_dataset_pruning_removes_old_general_files_but_preserves_events(self):
        datasets = self.services.ensure_project_layout(self.project_id) / "datasets"
        old_video = datasets / "imported" / "old.mp4"
        old_video.write_bytes(b"x" * 50)
        states = datasets / "trajectories" / "states.jsonl"
        states.write_bytes(b"y" * 50)
        event = datasets / "events" / "failure.jpg"
        event.write_bytes(b"z" * 20)
        result = self.services.prune_dataset(self.project_id, 20)
        self.assertGreaterEqual(result["removedFiles"], 2)
        self.assertTrue(event.exists())
        self.assertTrue(result["withinLimit"])

    def test_dataset_pruning_removes_old_events_only_as_last_resort(self):
        datasets = self.services.ensure_project_layout(self.project_id) / "datasets"
        event = datasets / "events" / "too-large.jpg"
        event.write_bytes(b"z" * 21)
        result = self.services.prune_dataset(self.project_id, 20)
        self.assertFalse(event.exists())
        self.assertTrue(result["withinLimit"])

    def test_dataset_pruning_does_not_break_demonstration_pairs(self):
        trajectories = self.services.ensure_project_layout(self.project_id) / "datasets" / "trajectories"
        image = trajectories / "demo.jpg"
        image.write_bytes(b"image-data")
        index = trajectories / "demonstrations.jsonl"
        index.write_text(json.dumps({"imagePath": image.name}) + "\n", encoding="utf-8")
        executions = trajectories / "executions.jsonl"
        executions.write_text(json.dumps({"actionId": "a" * 32, "status": "executed"}) + "\n", encoding="utf-8")
        result = self.services.prune_dataset(self.project_id, 1)
        self.assertTrue(image.exists())
        self.assertTrue(index.exists())
        self.assertTrue(executions.exists())
        self.assertFalse(result["withinLimit"])

    def test_ocr_failure_clears_previous_ready_state_before_engine_frame(self):
        class FailingWorker(FakeWorker):
            def call(self, command, payload=None):
                self.calls.append((command, payload or {}))
                if command == "ocr":
                    raise services_module.ServiceError(409, "ocr failed")
                if command == "engine_frame":
                    return {"action": None, "ready": False}
                return {"workerReady": True}

        self.services.latest_states[self.project_id] = {"ready": True, "rank": 1, "confidence": 0.9}
        self.services.worker = FailingWorker()
        result = self.services.save_frame(self.project_id, {"imageBase64": base64.b64encode(JPEG).decode("ascii"), "runOcr": True})
        self.assertFalse(result["state"]["ready"])
        self.assertEqual(result["state"]["confidence"], 0.0)
        self.assertEqual(result["state"]["ocrTexts"], [])

    def test_project_confidence_threshold_blocks_otherwise_ready_frame(self):
        self.services.worker = FakeWorker()
        result = self.services.save_frame(
            self.project_id,
            {"imageBase64": base64.b64encode(JPEG).decode("ascii"), "runOcr": True},
            confidence_threshold=0.95,
        )
        self.assertFalse(result["state"]["ready"])
        self.assertEqual(result["state"]["confidenceThreshold"], 0.95)

    def test_project_worker_health_recovers_saved_model_after_restart(self):
        fake = FakeWorker()
        self.services.worker = fake
        stable = self.projects / self.project_id / "models" / "stable" / "ppo-latest.zip"
        stable.parent.mkdir(parents=True)
        stable.write_bytes(b"stable")
        result = self.services.worker_health(self.project_id)
        self.assertTrue(result["training"]["stableReady"])

    def test_worker_process_health_isolated(self):
        result = self.services.worker.call("health")
        self.assertTrue(result["workerReady"])
        self.assertIn("training", result)
        self.assertIn("訓練", result["training"]["message"])
        self.assertNotIn("\ufffd", result["training"]["message"])

    def test_worker_timeout_terminates_hung_process_and_allows_restart(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            worker_path = root / "source" / "server" / "worker_main.py"
            worker_path.parent.mkdir(parents=True)
            worker_path.write_text(
                "import json,sys,time\n"
                "for line in sys.stdin:\n"
                " payload=json.loads(line)\n"
                " if payload.get('command') == 'hang': time.sleep(10)\n"
                " print(json.dumps({'id':payload['id'],'ok':True,'result':{'workerReady':True}}),flush=True)\n",
                encoding="utf-8",
            )
            client = services_module.WorkerClient(root / "runtime", root / "source")
            client.python = lambda: sys.executable
            started = time.monotonic()
            with self.assertRaises(services_module.ServiceError) as caught:
                client.call("hang", timeout_seconds=0.1)
            self.assertLess(time.monotonic() - started, 2)
            self.assertIn("沒有回應", caught.exception.message)
            self.assertIsNone(client.process)
            self.assertTrue(client.call("health", timeout_seconds=2)["workerReady"])
            client.shutdown()

    @unittest.skipUnless(os.name == "nt", "Windows DPAPI only")
    def test_windows_remembered_key_uses_dpapi_ciphertext(self):
        self.services.put_llm_settings({"baseUrl": "https://example.com/v1", "textModel": "model", "apiKey": "dpapi-secret", "rememberApiKey": True})
        self.assertTrue(self.services.secret_path.exists())
        self.assertNotIn(b"dpapi-secret", self.services.secret_path.read_bytes())
        self.assertEqual(self.services._keyring_read(), "dpapi-secret")


class WorkerHelpersTest(unittest.TestCase):
    def test_parse_ocr_extracts_basic_racing_values(self):
        state = worker_module.parse_ocr([{"text": "排名 2 / 12 150 km/h 45%", "confidence": 0.8}])
        self.assertEqual(state["rank"], 2)
        self.assertEqual(state["speed"], 150)
        self.assertEqual(state["progress"], 45)

    def test_action_translation_only_exposes_safe_buttons(self):
        result = worker_module.translate_action([0.5, -0.5, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1])
        self.assertEqual(result["sticks"]["left_stick_x"], 50)
        self.assertTrue(result["buttons"]["a"])
        self.assertTrue(result["buttons"]["zr"])
        self.assertNotIn("home", result["buttons"])

    def test_item_guidance_changes_only_confirmed_item_button_threshold(self):
        values = [0, 0, 0, 0, 0.7, 0, 0, 0, 0, 0, 0, 0]
        conservative = worker_module.translate_action(values, action_rules={"itemUseMode": "conservative", "itemInputs": ["a"]})
        aggressive = worker_module.translate_action(values, action_rules={"itemUseMode": "aggressive", "itemInputs": ["a"]})
        self.assertFalse(conservative["buttons"]["a"])
        self.assertTrue(aggressive["buttons"]["a"])
        self.assertFalse(aggressive["buttons"]["b"])

    def test_serial_simulator_acknowledges_safe_contract(self):
        self.assertTrue(serial_module.handle({"type": "action", "id": "a", "durationMs": 120, "sticks": {}, "buttons": {"a": True}})["ok"])
        self.assertTrue(serial_module.handle({"type": "neutral", "id": "n"})["ok"])
        self.assertFalse(serial_module.handle({"type": "action", "id": "bad", "durationMs": 5000})["ok"])
        self.assertFalse(serial_module.handle({"type": "action", "id": "locked", "durationMs": 120, "buttons": {"home": True}})["ok"])
        self.assertFalse(serial_module.handle({"type": "action", "id": "stick", "durationMs": 120, "sticks": {"left_stick_x": 101}})["ok"])

    def test_training_session_blocks_actions_when_vision_confidence_is_low(self):
        session = worker_module.TrainingSession()
        session.env = object()
        session.mode = "training"
        result = session.frame({"ready": False, "confidence": 0.1})
        self.assertIsNone(result["action"])
        self.assertIn("信心不足", result["message"])

    def test_training_session_waits_for_user_after_failed_round(self):
        class FakeEnv:
            def accept_frame(self, state, image_b64=""):
                return [0] * 12

        session = worker_module.TrainingSession()
        session.env = FakeEnv()
        session.mode = "training"
        failed = session.frame({"ready": True, "confidence": 0.9, "failed": True})
        self.assertIsNone(failed["action"])
        self.assertTrue(failed["awaitingNextRound"])
        blocked = session.frame({"ready": True, "confidence": 0.9})
        self.assertIsNone(blocked["action"])
        self.assertTrue(session.next_round()["ok"])
        self.assertFalse(session.awaiting_next_round)

    def test_training_session_rejects_shadow_model_from_another_project(self):
        with tempfile.TemporaryDirectory() as temp:
            first = Path(temp) / "first"
            second = Path(temp) / "second"
            (first / "shadow").mkdir(parents=True)
            (first / "shadow" / "ppo-shadow.zip").write_bytes(b"shadow")
            session = worker_module.TrainingSession()
            session.project_path = first.resolve()
            result = session.canary(str(second), False)
            self.assertFalse(result["ok"])
            self.assertIn("另一個遊戲專案", result["message"])

    def test_visual_environment_fuses_frame_stack_and_state(self):
        env = worker_module.make_online_env("safe")
        observation = env.observation()
        self.assertEqual(observation["image"].shape, (4, 84, 144))
        self.assertEqual(observation["state"].shape, (8,))
        self.assertTrue(env.observation_space.contains(observation))
        env.close()

    def test_demonstration_action_maps_complete_safe_controls(self):
        vector = worker_module.action_vector({
            "sticks": {"left_stick_x": 50, "left_stick_y": -50},
            "buttons": {"a": True, "zr": True},
        })
        self.assertEqual(len(vector), 12)
        self.assertEqual(vector[0], 0.5)
        self.assertEqual(vector[1], -0.5)
        self.assertEqual(vector[4], 1.0)
        self.assertEqual(vector[11], 1.0)

    def test_failed_demonstration_action_is_not_used_for_pretraining(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            models = root / "models"
            trajectories = root / "datasets" / "trajectories"
            trajectories.mkdir(parents=True)
            action_id = "f" * 32
            (trajectories / "demo.jpg").write_bytes(JPEG)
            (trajectories / "demonstrations.jsonl").write_text(
                json.dumps({"imagePath": "demo.jpg", "action": {"id": action_id}}) + "\n",
                encoding="utf-8",
            )
            (trajectories / "executions.jsonl").write_text(
                json.dumps({"actionId": action_id, "status": "failed"}) + "\n",
                encoding="utf-8",
            )
            result = worker_module.TrainingSession().pretrain_demonstrations(
                str(models), str(trajectories / "demonstrations.jsonl"), epochs=1
            )
            self.assertFalse(result["ok"])
            self.assertIn("已確認執行成功", result["message"])


if __name__ == "__main__":
    unittest.main()
