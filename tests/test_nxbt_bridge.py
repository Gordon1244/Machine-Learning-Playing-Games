import importlib.util
import copy
import sys
import unittest
from pathlib import Path


SPEC = importlib.util.spec_from_file_location(
    "nxbt_bridge",
    Path(__file__).parents[1] / "tools" / "nxbt_bridge.py",
)
bridge = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
sys.modules[SPEC.name] = bridge
SPEC.loader.exec_module(bridge)


class NxbtBridgeTest(unittest.TestCase):
    def test_normalize_action_clamps_duration_and_sticks(self):
        action = bridge.normalize_action(
            {
                "durationMs": 9999,
                "buttons": {"a": True},
                "sticks": {"left_stick_x": 500, "right_stick_y": -500},
            }
        )
        self.assertEqual(action["durationMs"], 1500)
        self.assertEqual(action["buttons"], {"a": True})
        self.assertEqual(action["sticks"]["left_stick_x"], 100)
        self.assertEqual(action["sticks"]["right_stick_y"], -100)

    def test_normalize_action_rejects_locked_or_unknown_buttons(self):
        with self.assertRaises(ValueError):
            bridge.normalize_action({"buttons": {"home": True}})
        with self.assertRaises(ValueError):
            bridge.normalize_action({"buttons": {"future_button": True}})

    def test_normalize_action_rejects_invalid_shapes(self):
        with self.assertRaises(ValueError):
            bridge.normalize_action([])
        with self.assertRaises(ValueError):
            bridge.normalize_action({"buttons": {"a": "yes"}})

    def test_normalize_action_accepts_menu_buttons_but_never_home_or_capture(self):
        result = bridge.normalize_action({"durationMs": 120, "buttons": {"dpad_right": True, "plus": True, "minus": False}, "sticks": {}})
        self.assertTrue(result["buttons"]["dpad_right"])
        self.assertTrue(result["buttons"]["plus"])
        for locked in ("home", "capture"):
            with self.assertRaises(ValueError):
                bridge.normalize_action({"buttons": {locked: True}, "sticks": {}})

    def test_apply_action_sends_buttons_and_sticks_together_then_neutral(self):
        class FakeNx:
            def __init__(self):
                self.packets = []

            def create_input_packet(self):
                packet = {name: False for name in bridge.BUTTON_MAP.values()}
                packet["L_STICK"] = {"X_VALUE": 0, "Y_VALUE": 0}
                packet["R_STICK"] = {"X_VALUE": 0, "Y_VALUE": 0}
                return packet

            def set_controller_input(self, controller_index, packet):
                self.packets.append((controller_index, copy.deepcopy(packet)))

        fake = FakeNx()
        session = bridge.NxbtSession(None, fake, 7)
        session.apply_action(
            {
                "durationMs": 20,
                "buttons": {"a": True, "zr": True},
                "sticks": {"left_stick_x": 55, "left_stick_y": -35, "right_stick_y": 20},
            }
        )

        active = fake.packets[0]
        neutral = fake.packets[-1]
        self.assertEqual(active[0], 7)
        self.assertTrue(active[1]["A"])
        self.assertTrue(active[1]["ZR"])
        self.assertEqual(active[1]["L_STICK"], {"X_VALUE": 55, "Y_VALUE": 35})
        self.assertEqual(active[1]["R_STICK"], {"X_VALUE": 0, "Y_VALUE": -20})
        self.assertFalse(neutral[1]["A"])
        self.assertEqual(neutral[1]["L_STICK"], {"X_VALUE": 0, "Y_VALUE": 0})


if __name__ == "__main__":
    unittest.main()
