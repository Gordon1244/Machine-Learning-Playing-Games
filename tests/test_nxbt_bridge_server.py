import json
import sys
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch


TOOLS = Path(__file__).parents[1] / "tools"
sys.path.insert(0, str(TOOLS))
from nxbt_bridge_server import BridgeServer, BridgeState  # noqa: E402


class NxbtBridgeServerTest(unittest.TestCase):
    def setUp(self):
        self.server = BridgeServer(("127.0.0.1", 0), "test-token", BridgeState(dry_run=True))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def request(self, path, payload=None, token="test-token"):
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            f"{self.base}{path}",
            data=data,
            method="GET" if payload is None else "POST",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=2) as response:
            return json.loads(response.read().decode("utf-8"))

    def test_token_is_required(self):
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.request("/health", token="wrong")
        self.assertEqual(caught.exception.code, 403)

    def test_connect_action_and_emergency_stop(self):
        connected = self.request("/connect", {"reconnect": False})
        self.assertTrue(connected["controllerReady"])
        result = self.request("/action", {"buttons": {"a": True}, "sticks": {"left_stick_x": 999}, "durationMs": 5000})
        self.assertEqual(result["action"]["sticks"]["left_stick_x"], 100)
        self.assertEqual(result["action"]["durationMs"], 1500)
        stopped = self.request("/emergency-stop", {})
        self.assertTrue(stopped["emergencyStopVerified"])
        self.assertFalse(stopped["controllerReady"])
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.request("/action", {"buttons": {"a": True}})
        self.assertEqual(caught.exception.code, 409)

    def test_real_connect_reports_pairing_without_blocking_health(self):
        ready = threading.Event()

        class WaitingSession:
            def wait_for_connection(self):
                ready.wait(timeout=2)

            def close(self):
                ready.set()

        self.server.state = BridgeState(dry_run=False)
        with patch("nxbt_bridge_server.NxbtSession.start", return_value=WaitingSession()):
            started = self.request("/connect", {"reconnect": False})
            self.assertTrue(started["connecting"])
            self.assertFalse(started["controllerReady"])
            waiting = self.request("/health")
            self.assertTrue(waiting["connecting"])
            ready.set()
            for _ in range(20):
                completed = self.request("/health")
                if completed["controllerReady"]:
                    break
                time.sleep(0.01)
            self.assertTrue(completed["controllerReady"])
            self.assertFalse(completed["connecting"])


if __name__ == "__main__":
    unittest.main()
