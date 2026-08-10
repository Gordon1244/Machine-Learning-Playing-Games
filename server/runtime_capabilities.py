"""Detect local hardware and optional runtimes without claiming readiness."""

from __future__ import annotations

import importlib.util
import json
import os
import platform
import shutil
import subprocess
import sys
from functools import lru_cache
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]


def runtime_python() -> str:
    candidate = ROOT / ".runtime" / "venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    return str(candidate if candidate.exists() else Path(sys.executable))


def runtime_json(code: str, timeout: int = 15) -> dict[str, Any]:
    try:
        output = subprocess.run(
            [runtime_python(), "-c", code],
            capture_output=True,
            check=False,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        ).stdout.strip()
        return json.loads(output.splitlines()[-1]) if output else {}
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError):
        return {}


def module_available(name: str) -> bool:
    if Path(runtime_python()).resolve() == Path(sys.executable).resolve():
        return importlib.util.find_spec(name) is not None
    result = runtime_json(
        "import importlib.util,json; "
        f"print(json.dumps({{'available': importlib.util.find_spec({name!r}) is not None}}))"
    )
    return bool(result.get("available"))


def run_text(command: list[str], timeout: int = 5) -> str:
    try:
        return subprocess.run(
            command,
            capture_output=True,
            check=False,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        ).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return ""


def vendor_for(name: str) -> str:
    lowered = name.lower()
    if "intel" in lowered:
        return "intel"
    if "nvidia" in lowered:
        return "nvidia"
    if any(word in lowered for word in ("amd", "radeon", "advanced micro devices")):
        return "amd"
    if "apple" in lowered:
        return "apple"
    return "unknown"


def normalized_device(name: str, kind: str) -> dict[str, Any]:
    return {"name": name.strip(), "vendor": vendor_for(name), "kind": kind}


def windows_hardware() -> dict[str, Any]:
    try:
        import winreg
    except ImportError:
        return {}
    cpu_name = registry_value(
        winreg,
        r"HARDWARE\DESCRIPTION\System\CentralProcessor\0",
        "ProcessorNameString",
    )
    graphics = registry_child_values(
        winreg,
        r"SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}",
        ("DriverDesc",),
        max_children=128,
    )
    npu_devices = registry_pci_matches(
        winreg,
        ("npu", "neural", "ai boost", "vpu", "movidius"),
        max_devices=1024,
    )
    return {"cpuName": cpu_name, "graphics": graphics, "npuDevices": npu_devices}


def registry_value(winreg: Any, path: str, name: str) -> str:
    try:
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, path) as key:
            return str(winreg.QueryValueEx(key, name)[0]).strip()
    except OSError:
        return ""


def registry_child_values(
    winreg: Any,
    path: str,
    names: tuple[str, ...],
    max_children: int,
) -> list[str]:
    results = []
    try:
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, path) as root:
            for index in range(max_children):
                try:
                    child_name = winreg.EnumKey(root, index)
                except OSError:
                    break
                try:
                    with winreg.OpenKey(root, child_name) as child:
                        for value_name in names:
                            try:
                                value = str(winreg.QueryValueEx(child, value_name)[0]).strip()
                            except OSError:
                                continue
                            if value and value not in results:
                                results.append(value)
                except OSError:
                    continue
    except OSError:
        pass
    return results


def registry_pci_matches(winreg: Any, keywords: tuple[str, ...], max_devices: int) -> list[str]:
    path = r"SYSTEM\CurrentControlSet\Enum\PCI"
    matches = []
    visited = 0
    try:
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, path) as root:
            for vendor_index in range(512):
                try:
                    vendor_name = winreg.EnumKey(root, vendor_index)
                except OSError:
                    break
                try:
                    with winreg.OpenKey(root, vendor_name) as vendor:
                        for device_index in range(128):
                            if visited >= max_devices:
                                return matches
                            try:
                                device_name = winreg.EnumKey(vendor, device_index)
                            except OSError:
                                break
                            visited += 1
                            try:
                                with winreg.OpenKey(vendor, device_name) as device:
                                    values = []
                                    for value_name in ("FriendlyName", "DeviceDesc"):
                                        try:
                                            values.append(str(winreg.QueryValueEx(device, value_name)[0]))
                                        except OSError:
                                            continue
                                    label = " ".join(values).strip()
                                    if any(keyword in label.lower() for keyword in keywords):
                                        cleaned = label.split(";")[-1].strip()
                                        if cleaned and cleaned not in matches:
                                            matches.append(cleaned)
                            except OSError:
                                continue
                except OSError:
                    continue
    except OSError:
        pass
    return matches


def linux_hardware() -> dict[str, Any]:
    cpu_name = ""
    lscpu = shutil.which("lscpu")
    if lscpu:
        for line in run_text([lscpu]).splitlines():
            if line.lower().startswith("model name:"):
                cpu_name = line.split(":", 1)[1].strip()
                break
    graphics = []
    npu_devices = []
    lspci = shutil.which("lspci")
    if lspci:
        for line in run_text([lspci]).splitlines():
            lowered = line.lower()
            if any(word in lowered for word in ("vga compatible controller", "3d controller", "display controller")):
                graphics.append(line.split(":", 2)[-1].strip())
            if any(word in lowered for word in ("neural", "npu", "vpu", "ai boost", "movidius")):
                npu_devices.append(line.strip())
    return {"cpuName": cpu_name, "graphics": graphics, "npuDevices": npu_devices}


def macos_hardware() -> dict[str, Any]:
    cpu_name = run_text(["sysctl", "-n", "machdep.cpu.brand_string"])
    raw = run_text(["system_profiler", "SPDisplaysDataType", "-json"], timeout=8)
    graphics = []
    try:
        for card in json.loads(raw).get("SPDisplaysDataType", []):
            graphics.append(str(card.get("sppci_model", "")).strip())
    except json.JSONDecodeError:
        pass
    return {"cpuName": cpu_name, "graphics": graphics, "npuDevices": []}


def detect_hardware() -> dict[str, Any]:
    system = platform.system()
    if system == "Windows":
        raw = windows_hardware()
    elif system == "Linux":
        raw = linux_hardware()
    elif system == "Darwin":
        raw = macos_hardware()
    else:
        raw = {}
    cpu_name = str(raw.get("cpuName") or platform.processor() or "Unknown CPU").strip()
    graphics = raw.get("graphics") or []
    if isinstance(graphics, str):
        graphics = [graphics]
    npu_devices = raw.get("npuDevices") or []
    if isinstance(npu_devices, str):
        npu_devices = [npu_devices]
    return {
        "cpu": normalized_device(cpu_name, "cpu"),
        "graphics": [normalized_device(str(name), "gpu") for name in graphics if str(name).strip()],
        "npuDevices": [normalized_device(str(name), "npu") for name in npu_devices if str(name).strip()],
    }


def detect_pytorch_runtime() -> dict[str, Any]:
    report = {
        "installed": False,
        "version": "",
        "cuda": False,
        "xpu": False,
        "mps": False,
        "rocm": False,
        "devices": [],
        "error": "",
    }
    if not module_available("torch"):
        return report
    detected = runtime_json(
        "import json,torch; "
        "cuda=bool(torch.cuda.is_available()); "
        "xpu=bool(hasattr(torch,'xpu') and torch.xpu.is_available()); "
        "mps=bool(hasattr(torch.backends,'mps') and torch.backends.mps.is_available()); "
        "devices=[]; "
        "devices.extend([f'cuda:{i}' for i in range(torch.cuda.device_count())] if cuda else []); "
        "devices.extend([f'xpu:{i}' for i in range(torch.xpu.device_count())] if xpu else []); "
        "devices.extend(['mps'] if mps else []); "
        "devices.append('cpu'); "
        "print(json.dumps({'installed':True,'version':str(torch.__version__),'cuda':cuda,'xpu':xpu,'mps':mps,"
        "'rocm':bool(getattr(torch.version,'hip',None)),'devices':devices,'error':''}))",
        timeout=30,
    )
    return {**report, **detected}


def detect_openvino_runtime() -> dict[str, Any]:
    report = {"installed": False, "devices": [], "cpu": False, "gpu": False, "npu": False, "error": ""}
    if not module_available("openvino"):
        return report
    detected = runtime_json(
        "import json; from openvino import Core; "
        "devices=list(Core().available_devices); "
        "print(json.dumps({'installed':True,'devices':devices,"
        "'cpu':any(str(device).upper().startswith('CPU') for device in devices),"
        "'gpu':any(str(device).upper().startswith('GPU') for device in devices),"
        "'npu':any(str(device).upper().startswith('NPU') for device in devices),'error':''}))",
        timeout=30,
    )
    return {**report, **detected}


def target(
    target_id: str,
    label: str,
    role: str,
    detected: bool,
    usable: bool,
    reason: str,
) -> dict[str, Any]:
    return {
        "id": target_id,
        "label": label,
        "role": role,
        "detected": detected,
        "usable": usable,
        "reason": reason,
    }


def build_targets(hardware: dict[str, Any], pytorch: dict[str, Any], openvino: dict[str, Any]) -> list[dict[str, Any]]:
    graphics = hardware["graphics"]
    npus = hardware["npuDevices"]
    cpu = hardware["cpu"]
    has_intel_gpu = any(item["vendor"] == "intel" for item in graphics)
    has_nvidia_gpu = any(item["vendor"] == "nvidia" for item in graphics)
    has_amd_gpu = any(item["vendor"] == "amd" for item in graphics)
    has_apple_gpu = any(item["vendor"] == "apple" for item in graphics) or platform.system() == "Darwin"
    has_intel_npu = any(item["vendor"] == "intel" or "npu" in item["name"].lower() for item in npus)
    return [
        target("cuda", "NVIDIA CUDA GPU", "training_and_inference", has_nvidia_gpu, pytorch["cuda"], "需要 NVIDIA GPU、驅動與支援 CUDA 的 PyTorch。"),
        target("xpu", "Intel XPU GPU", "training_and_inference", has_intel_gpu, pytorch["xpu"], "需要支援 Intel XPU 的 PyTorch 與相容 Intel GPU。"),
        target("mps", "Apple Silicon MPS", "training_and_inference", has_apple_gpu, pytorch["mps"], "需要 Apple Silicon 與支援 MPS 的 PyTorch。"),
        target("rocm", "AMD ROCm GPU", "training_and_inference", has_amd_gpu, pytorch["rocm"], "需要 AMD GPU、ROCm 與相容 PyTorch。"),
        target("openvino_npu", "Intel NPU / OpenVINO", "inference_only", has_intel_npu, openvino.get("npu", False), "主要用於低功耗即時推論，需要 OpenVINO 與可用 NPU 驅動。"),
        target("openvino_gpu", "Intel GPU / OpenVINO", "inference_only", has_intel_gpu, openvino.get("gpu", False), "主要用於 Intel 顯示晶片即時推論，需要 OpenVINO 與可用 GPU 驅動。"),
        target("cpu", f"CPU：{cpu['name']}", "training_and_inference", True, pytorch["installed"], "CPU 一定可偵測；安裝 PyTorch 後可作為保底訓練與推論裝置。"),
    ]


def first_usable(targets: list[dict[str, Any]], role: str) -> str:
    if role == "inference_only":
        for item in targets:
            if item["usable"] and item["role"] == "inference_only":
                return item["id"]
    for item in targets:
        if item["usable"] and item["role"] in {role, "training_and_inference"}:
            return item["id"]
    return ""


def nxbt_execution(system: str) -> dict[str, Any]:
    return {
        "nativeLinux": system == "Linux",
        "vmHostSupported": system in {"Windows", "Darwin"},
        "note": "NXBT 需要 Linux 藍牙 API。Windows 與 macOS 依官方方式使用 VirtualBox + Vagrant Linux VM，並將 USB 藍牙轉接器 passthrough 給 VM。",
    }


@lru_cache(maxsize=1)
def capability_report() -> dict[str, Any]:
    system = platform.system()
    modules = {
        "numpy": module_available("numpy"),
        "opencv": module_available("cv2"),
        "pytorch": module_available("torch"),
        "openvino": module_available("openvino"),
        "pyserial": module_available("serial"),
        "mss": module_available("mss"),
        "nxbt": module_available("nxbt"),
    }
    hardware = detect_hardware()
    pytorch = detect_pytorch_runtime()
    openvino = detect_openvino_runtime()
    targets = build_targets(hardware, pytorch, openvino)
    return {
        "platform": system,
        "modules": modules,
        "hardware": hardware,
        "runtimes": {"pytorch": pytorch, "openvino": openvino},
        "computeTargets": targets,
        "recommendedTrainingTarget": first_usable(targets, "training"),
        "recommendedInferenceTarget": first_usable(targets, "inference_only"),
        "visionProviderDependenciesAvailable": modules["numpy"] and modules["opencv"],
        "trainingEngineDependenciesAvailable": modules["numpy"] and modules["pytorch"],
        "visionProviderAvailable": False,
        "trainingEngineAvailable": False,
        "desktopSerialAvailable": modules["pyserial"],
        "screenCaptureAvailable": modules["mss"],
        "nxbtPackageAvailable": modules["nxbt"],
        "nxbtExecution": nxbt_execution(system),
        "engineConnected": False,
        "note": "偵測到晶片或套件不等於硬體、驅動或模型已驗證；必須由真實 adapter 回報後才能啟用。",
    }


def refresh_capability_report() -> dict[str, Any]:
    capability_report.cache_clear()
    return capability_report()
