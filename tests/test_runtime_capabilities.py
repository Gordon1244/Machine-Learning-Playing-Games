import importlib.util
import unittest
from pathlib import Path


SPEC = importlib.util.spec_from_file_location(
    "runtime_capabilities",
    Path(__file__).parents[1] / "server" / "runtime_capabilities.py",
)
capabilities = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(capabilities)


class RuntimeCapabilitiesTest(unittest.TestCase):
    def test_intel_gpu_and_npu_are_exposed_without_fake_usability(self):
        hardware = {
            "cpu": {"name": "Intel Core Ultra", "vendor": "intel", "kind": "cpu"},
            "graphics": [{"name": "Intel Arc Graphics", "vendor": "intel", "kind": "gpu"}],
            "npuDevices": [{"name": "Intel AI Boost NPU", "vendor": "intel", "kind": "npu"}],
        }
        pytorch = {"installed": False, "cuda": False, "xpu": False, "mps": False, "rocm": False}
        openvino = {"installed": False, "npu": False}
        targets = capabilities.build_targets(hardware, pytorch, openvino)
        xpu = next(item for item in targets if item["id"] == "xpu")
        npu = next(item for item in targets if item["id"] == "openvino_npu")
        self.assertTrue(xpu["detected"])
        self.assertFalse(xpu["usable"])
        self.assertTrue(npu["detected"])
        self.assertFalse(npu["usable"])

    def test_openvino_npu_is_preferred_for_inference_when_usable(self):
        targets = [
            {"id": "cuda", "role": "training_and_inference", "usable": True},
            {"id": "openvino_npu", "role": "inference_only", "usable": True},
        ]
        self.assertEqual(capabilities.first_usable(targets, "training"), "cuda")
        self.assertEqual(capabilities.first_usable(targets, "inference_only"), "openvino_npu")

    def test_windows_nxbt_uses_vm_execution_path(self):
        execution = capabilities.nxbt_execution("Windows")
        self.assertFalse(execution["nativeLinux"])
        self.assertTrue(execution["vmHostSupported"])
        self.assertIn("VirtualBox", execution["note"])


if __name__ == "__main__":
    unittest.main()
