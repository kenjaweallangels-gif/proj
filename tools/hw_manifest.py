#!/usr/bin/env python3
"""E0 hardware manifest (Документ §19, §20 «E0 — стенд», §22).

Records the conditions a measurement was taken under: CPU, RAM, GPU (nvidia-smi), Vulkan, OS/kernel,
desktop session and monitor refresh, power profile, storage type, installed browsers, git revision.
Every value comes from the machine itself. Anything that cannot be determined is null together with a
reason — never guessed. Python standard library only.

    python3 tools/hw_manifest.py                  # writes reports/hardware_manifest.json
    python3 tools/hw_manifest.py --out FILE       # another path; --print also prints the JSON
    python3 tools/hw_manifest.py --self-test      # unit tests of the parsers on simulated machines
"""

from __future__ import annotations

import argparse
import datetime as _dt
import glob
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import unittest
from typing import Any, Callable, Optional

MANIFEST_KIND = "zero-echo.hardware-manifest.v1"
TOOL_VERSION = "1.0"
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DEFAULT_OUT = os.path.join(REPO_ROOT, "reports", "hardware_manifest.json")

# Target bench of the document (Документ §2, §19) — for the comparison line only, never as a measured value.
TARGET = {"gpu": "NVIDIA GeForce RTX 3060", "vram_gib": 12, "ram_gib": 32}

Runner = Callable[[list], "CmdResult"]


class CmdResult:
    def __init__(self, ok: bool, stdout: str = "", reason: Optional[str] = None):
        self.ok = ok
        self.stdout = stdout
        self.reason = reason


def run_command(argv: list, timeout: float = 8.0) -> CmdResult:
    """Runs a command without a shell; never raises. `reason` explains a failure in Russian."""
    exe = shutil.which(argv[0]) if not os.path.isabs(argv[0]) else argv[0]
    if not exe or not os.path.exists(exe):
        return CmdResult(False, reason=f"команда {argv[0]} не найдена")
    try:
        p = subprocess.run([exe, *argv[1:]], capture_output=True, text=True, timeout=timeout, env={**os.environ, "LC_ALL": "C"})
    except subprocess.TimeoutExpired:
        return CmdResult(False, reason=f"{argv[0]}: нет ответа за {timeout:.0f} с")
    except OSError as e:
        return CmdResult(False, reason=f"{argv[0]}: {e.strerror or e}")
    if p.returncode != 0:
        err = (p.stderr or p.stdout).strip().splitlines()
        return CmdResult(False, p.stdout, reason=f"{argv[0]} завершился с кодом {p.returncode}" + (f": {err[-1][:200]}" if err else ""))
    return CmdResult(True, p.stdout)


def read_text(path: str) -> Optional[str]:
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return None


def unknown(reason: str) -> dict:
    return {"value": None, "reason": reason}


# ------------------------------------------------------------------ pure parsers (unit-tested)


def parse_os_release(text: str) -> dict:
    out = {}
    for line in text.splitlines():
        m = re.match(r'^([A-Z_]+)=(.*)$', line.strip())
        if m:
            out[m.group(1)] = m.group(2).strip().strip('"')
    return out


def parse_meminfo(text: str) -> dict:
    """Returns sizes in KiB for the keys present in /proc/meminfo."""
    out = {}
    for line in text.splitlines():
        m = re.match(r"^(\w+):\s+(\d+)\s*kB", line)
        if m:
            out[m.group(1)] = int(m.group(2))
    return out


def parse_lscpu_json(text: str) -> dict:
    data = json.loads(text)
    fields = {}
    for entry in data.get("lscpu", []):
        key = entry.get("field", "").rstrip(":").strip()
        fields[key] = entry.get("data")
        for child in entry.get("children", []) or []:
            fields[child.get("field", "").rstrip(":").strip()] = child.get("data")
    return fields


def parse_proc_cpuinfo(text: str) -> dict:
    """Model, logical CPUs and physical cores from /proc/cpuinfo (x86 layout; ARM lacks some keys)."""
    model = None
    logical = 0
    cores = set()
    flags = []
    hypervisor = False
    phys = core = None
    for line in text.splitlines() + [""]:
        if not line.strip():
            if phys is not None or core is not None:
                cores.add((phys, core))
            phys = core = None
            continue
        key, _, val = line.partition(":")
        key, val = key.strip(), val.strip()
        if key == "processor":
            logical += 1
        elif key in ("model name", "Model") and model is None:
            model = val
        elif key == "physical id":
            phys = val
        elif key == "core id":
            core = val
        elif key == "flags" and not flags:
            flags = val.split()
            hypervisor = "hypervisor" in flags
    return {"model": model, "logical": logical or None, "physical_cores": len(cores) or None, "flags": flags, "hypervisor": hypervisor}


def parse_nvidia_smi_csv(text: str) -> list:
    """`nvidia-smi --query-gpu=name,memory.total,driver_version,pci.bus_id --format=csv,noheader,nounits`."""
    gpus = []
    for line in text.strip().splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 3:
            continue
        vram = None
        try:
            vram = int(float(parts[1]))
        except ValueError:
            pass
        gpus.append({
            "name": parts[0],
            "vram_total_mib": vram,
            "vram_total_gib": round(vram / 1024, 2) if vram is not None else None,
            "driver_version": parts[2] or None,
            "pci_bus_id": parts[3] if len(parts) > 3 and parts[3] else None,
        })
    return gpus


def parse_vulkaninfo_summary(text: str) -> dict:
    """`vulkaninfo --summary`: instance version and one entry per physical device."""
    inst = re.search(r"Vulkan Instance Version:\s*([\d.]+)", text)
    devices = []
    current = None
    for line in text.splitlines():
        line = line.strip()
        if re.match(r"^GPU\d+:", line):
            current = {}
            devices.append(current)
            continue
        if current is None:
            continue
        m = re.match(r"^(apiVersion|driverVersion|deviceType|deviceName|driverName|driverInfo)\s*=\s*(.+)$", line)
        if m:
            current[m.group(1)] = m.group(2).strip()
    return {"instance_version": inst.group(1) if inst else None, "devices": devices}


def parse_xrandr(text: str) -> list:
    """Connected outputs with the current mode and refresh rate (`*` marks the active one)."""
    monitors = []
    current = None
    for line in text.splitlines():
        m = re.match(r"^(\S+) connected( primary)?", line)
        if m:
            current = {"output": m.group(1), "primary": bool(m.group(2)), "mode": None, "refresh_hz": None}
            monitors.append(current)
            continue
        if re.match(r"^\S+ disconnected", line):
            current = None
            continue
        if current is not None and line.startswith(" ") and "*" in line:
            parts = line.split()
            current["mode"] = parts[0]
            for p in parts[1:]:
                if "*" in p:
                    try:
                        current["refresh_hz"] = float(p.replace("*", "").replace("+", ""))
                    except ValueError:
                        pass
    return monitors


def parse_wlr_randr(text: str) -> list:
    monitors = []
    current = None
    for line in text.splitlines():
        if line and not line.startswith(" "):
            current = {"output": line.split()[0], "primary": None, "mode": None, "refresh_hz": None}
            monitors.append(current)
            continue
        m = re.match(r"^\s+(\d+x\d+) px, ([\d.]+) Hz.*current", line)
        if current is not None and m:
            current["mode"], current["refresh_hz"] = m.group(1), float(m.group(2))
    return monitors


def classify_disk(dev: dict) -> tuple:
    """(kind, reason). The rotational flag of virtual disks (virtio, xen) is not reliable."""
    name = dev.get("name") or ""
    tran = (dev.get("tran") or "").lower()
    rota = dev.get("rota")
    if name.startswith(("zram", "ram", "loop")):
        return "memory_or_loop", "zram/ramdisk/loop — не накопитель"
    if name.startswith("nvme") or tran == "nvme":
        return "nvme_ssd", None
    if name.startswith(("vd", "xvd")) or tran == "virtio":
        return "virtual", "виртуальный диск: тип физического носителя хоста неизвестен (флаг rotational у virtio ненадёжен)"
    if rota is False or rota == "0" or rota == 0:
        return "ssd", None
    if rota is True or rota == "1" or rota == 1:
        return "hdd", None
    return "unknown", "нет флага rotational"


BROWSER_COMMANDS = [
    ("Google Chrome", "google-chrome"),
    ("Google Chrome", "google-chrome-stable"),
    ("Chromium", "chromium"),
    ("Chromium", "chromium-browser"),
    ("Microsoft Edge", "microsoft-edge"),
    ("Microsoft Edge", "microsoft-edge-stable"),
    ("Brave", "brave-browser"),
    ("Firefox", "firefox"),
]


def parse_browser_version(text: str) -> Optional[str]:
    m = re.search(r"(\d+\.\d+(?:\.\d+){0,2}(?:[ab]\d+)?)", text)
    return m.group(1) if m else None


# ------------------------------------------------------------------ probes


class Probe:
    """Collects the manifest. `run` and `read` are injectable for tests."""

    def __init__(self, run: Runner = run_command, read: Callable[[str], Optional[str]] = read_text,
                 env: Optional[dict] = None, which: Callable[[str], Optional[str]] = shutil.which,
                 globber: Callable[[str], list] = glob.glob, repo: str = REPO_ROOT):
        self.run = run
        self.read = read
        self.env = os.environ if env is None else env
        self.which = which
        self.glob = globber
        self.repo = repo
        self.unknowns = []

    def note_unknown(self, field: str, reason: str) -> None:
        self.unknowns.append({"field": field, "reason": reason})

    # --- system
    def os_info(self) -> dict:
        rel = self.read("/etc/os-release")
        info = parse_os_release(rel) if rel else {}
        if not rel:
            self.note_unknown("os.name", "нет /etc/os-release")
        def detect(flag: str) -> tuple:
            # systemd-detect-virt prints "none" with exit code 1 when nothing is detected.
            r = self.run(["systemd-detect-virt", flag])
            text = r.stdout.strip()
            if r.ok and text:
                return text, None
            if text == "none":
                return "none", None
            return None, r.reason
        vm, vm_reason = detect("--vm")
        container, container_reason = detect("--container")
        if container is None:
            markers = [m for m in ("/.dockerenv", "/run/.containerenv") if self.read(m) is not None]
            cgroup = self.read("/proc/1/cgroup") or ""
            if markers or re.search(r"docker|containerd|kubepods|lxc", cgroup):
                container, container_reason = "container", f"признаки контейнера: {', '.join(markers) or '/proc/1/cgroup'}"
        return {
            "name": info.get("PRETTY_NAME"),
            "id": info.get("ID"),
            "version_id": info.get("VERSION_ID"),
            "kernel": platform.release(),
            "arch": platform.machine(),
            "vm": vm,
            "vm_reason": vm_reason,
            "container": container,
            "container_reason": container_reason,
        }

    def cpu(self) -> dict:
        out = {"model": None, "vendor": None, "sockets": None, "physical_cores": None, "logical_threads": None,
               "max_mhz": None, "virtual_cpu": None, "isa_flags": [], "source": None, "note_ru": None}
        r = self.run(["lscpu", "-J"])
        if r.ok:
            try:
                f = parse_lscpu_json(r.stdout)
                out["source"] = "lscpu"
                out["model"] = f.get("Model name")
                out["vendor"] = f.get("Vendor ID")
                threads = int(f["CPU(s)"]) if f.get("CPU(s)") else None
                sockets = int(f["Socket(s)"]) if (f.get("Socket(s)") or "").isdigit() else None
                per_socket = int(f["Core(s) per socket"]) if (f.get("Core(s) per socket") or "").isdigit() else None
                out["logical_threads"] = threads
                out["sockets"] = sockets
                out["physical_cores"] = sockets * per_socket if sockets and per_socket else None
                mhz = f.get("CPU max MHz")
                out["max_mhz"] = float(mhz) if mhz else None
                out["virtual_cpu"] = bool(f.get("Hypervisor vendor")) or None
                if f.get("Hypervisor vendor"):
                    out["hypervisor"] = f.get("Hypervisor vendor")
            except (ValueError, KeyError, json.JSONDecodeError) as e:
                out["note_ru"] = f"lscpu -J не разобран: {e}"
        info = self.read("/proc/cpuinfo")
        if info:
            p = parse_proc_cpuinfo(info)
            out["model"] = out["model"] or p["model"]
            out["logical_threads"] = out["logical_threads"] or p["logical"]
            out["physical_cores"] = out["physical_cores"] or p["physical_cores"]
            if p["hypervisor"]:
                out["virtual_cpu"] = True
            wanted = ("avx", "avx2", "fma", "f16c", "avx512f", "avx512_bf16", "avx_vnni", "amx_tile", "neon", "asimd")
            out["isa_flags"] = [f for f in wanted if f in p["flags"]]
            out["source"] = out["source"] or "/proc/cpuinfo"
        if out["model"] is None:
            self.note_unknown("cpu.model", r.reason or "нет lscpu и /proc/cpuinfo")
        if out["virtual_cpu"]:
            out["note_ru"] = "Виртуальные CPU (флаг hypervisor): ядра/потоки — выделенные гостю, модель и частота физического CPU хоста не определяются."
        if out["max_mhz"] is None:
            self.note_unknown("cpu.max_mhz", "частота не сообщается (часто в виртуальных машинах)")
        return out

    def memory(self) -> dict:
        text = self.read("/proc/meminfo")
        if not text:
            self.note_unknown("memory", "нет /proc/meminfo")
            return {"total_gib": None, "available_gib": None, "swap_total_gib": None}
        m = parse_meminfo(text)
        gib = lambda k: round(m[k] / 1024 / 1024, 2) if k in m else None  # noqa: E731
        return {"total_gib": gib("MemTotal"), "available_gib": gib("MemAvailable"), "swap_total_gib": gib("SwapTotal")}

    def gpu(self) -> dict:
        out = {"present": None, "nvidia": None, "nvidia_reason": None, "drm_devices": [], "drm_reason": None, "pci_display": None, "note_ru": None}
        r = self.run(["nvidia-smi", "--query-gpu=name,memory.total,driver_version,pci.bus_id", "--format=csv,noheader,nounits"])
        if r.ok:
            out["nvidia"] = parse_nvidia_smi_csv(r.stdout)
            ver = self.read("/proc/driver/nvidia/version")
            if ver:
                out["nvidia_kernel_module"] = ver.strip().splitlines()[0][:200]
        else:
            out["nvidia_reason"] = r.reason
        cards = sorted(self.glob("/sys/class/drm/card[0-9]*"))
        for card in cards:
            if "-" in os.path.basename(card):
                continue  # connectors like card0-HDMI-A-1
            vendor = (self.read(os.path.join(card, "device", "vendor")) or "").strip() or None
            device = (self.read(os.path.join(card, "device", "device")) or "").strip() or None
            driver = None
            link = os.path.join(card, "device", "driver")
            try:
                driver = os.path.basename(os.readlink(link))
            except OSError:
                pass
            out["drm_devices"].append({"card": os.path.basename(card), "pci_vendor": vendor, "pci_device": device, "driver": driver})
        if not cards:
            out["drm_reason"] = "нет /sys/class/drm/card* — ядро не видит видеоустройств (DRM)"
        r = self.run(["lspci", "-nn"])
        if r.ok:
            out["pci_display"] = [l.strip() for l in r.stdout.splitlines() if re.search(r"VGA|3D controller|Display controller", l)]
        else:
            out["pci_display_reason"] = r.reason
        nvidia_gpus = out["nvidia"] or []
        if nvidia_gpus or out["drm_devices"] or out["pci_display"]:
            out["present"] = True
        elif out["drm_reason"] and not out["pci_display"]:
            out["present"] = False
            out["note_ru"] = "GPU не обнаружен: nvidia-smi нет, DRM-устройств нет. Рендер и локальная модель на GPU здесь не измеримы; браузерный WebGPU идёт через SwiftShader (CPU), это не доказательство производительности."
        if not nvidia_gpus:
            self.note_unknown("gpu.nvidia", out["nvidia_reason"] or "nvidia-smi не вернул GPU")
        return out

    def vulkan(self) -> dict:
        r = self.run(["vulkaninfo", "--summary"])
        if not r.ok:
            self.note_unknown("vulkan", r.reason or "vulkaninfo не сработал")
            icd = sorted(self.glob("/usr/share/vulkan/icd.d/*.json") + self.glob("/etc/vulkan/icd.d/*.json"))
            return {"available": None, "reason": r.reason, "instance_version": None, "devices": [], "icd_files": [os.path.basename(p) for p in icd]}
        parsed = parse_vulkaninfo_summary(r.stdout)
        return {"available": bool(parsed["devices"]), "reason": None, **parsed}

    def display(self) -> dict:
        env = self.env
        session = env.get("XDG_SESSION_TYPE") or None
        reason = None
        if not session and env.get("XDG_SESSION_ID"):
            r = self.run(["loginctl", "show-session", env["XDG_SESSION_ID"], "-p", "Type", "--value"])
            session = r.stdout.strip() or None if r.ok else None
        if not session:
            if env.get("WAYLAND_DISPLAY"):
                session = "wayland"
            elif env.get("DISPLAY"):
                session = "x11"
            else:
                reason = "нет графической сессии (XDG_SESSION_TYPE, WAYLAND_DISPLAY и DISPLAY не заданы)"
        out = {"session_type": session, "session_reason": reason, "wayland_display": env.get("WAYLAND_DISPLAY") or None,
               "x11_display": env.get("DISPLAY") or None, "desktop": env.get("XDG_CURRENT_DESKTOP") or None,
               "monitors": None, "monitors_source": None, "monitors_reason": None}
        if session is None:
            self.note_unknown("display", reason)
            out["monitors_reason"] = reason
            return out
        attempts = []
        if session == "wayland" and self.which("wlr-randr"):
            r = self.run(["wlr-randr"])
            if r.ok:
                out["monitors"], out["monitors_source"] = parse_wlr_randr(r.stdout), "wlr-randr"
                return out
            attempts.append(r.reason)
        if env.get("DISPLAY"):
            r = self.run(["xrandr", "--query"])
            if r.ok:
                out["monitors"], out["monitors_source"] = parse_xrandr(r.stdout), "xrandr"
                if session == "wayland":
                    out["monitors_note_ru"] = "xrandr под Wayland видит XWayland: частота может не совпадать с реальной."
                return out
            attempts.append(r.reason)
        out["monitors_reason"] = "; ".join(a for a in attempts if a) or "нет инструмента для запроса мониторов (xrandr/wlr-randr)"
        self.note_unknown("display.monitors", out["monitors_reason"])
        return out

    def power(self) -> dict:
        out = {"profile": None, "profile_source": None, "profile_reason": None, "cpufreq_governors": None, "governor_reason": None, "on_ac_power": None}
        r = self.run(["powerprofilesctl", "get"])
        if r.ok and r.stdout.strip():
            out["profile"], out["profile_source"] = r.stdout.strip(), "powerprofilesctl"
        else:
            platform_profile = self.read("/sys/firmware/acpi/platform_profile")
            if platform_profile:
                out["profile"], out["profile_source"] = platform_profile.strip(), "/sys/firmware/acpi/platform_profile"
            else:
                out["profile_reason"] = f"{r.reason}; нет /sys/firmware/acpi/platform_profile"
                self.note_unknown("power.profile", out["profile_reason"])
        govs = {}
        for path in sorted(self.glob("/sys/devices/system/cpu/cpu[0-9]*/cpufreq/scaling_governor")):
            g = (self.read(path) or "").strip()
            if g:
                govs[g] = govs.get(g, 0) + 1
        if govs:
            out["cpufreq_governors"] = govs
        else:
            out["governor_reason"] = "нет /sys/devices/system/cpu/*/cpufreq (частотой управляет гипервизор или драйвер не загружен)"
            self.note_unknown("power.cpufreq_governor", out["governor_reason"])
        for supply in self.glob("/sys/class/power_supply/*/online"):
            if (self.read(supply) or "").strip() == "1":
                out["on_ac_power"] = True
        return out

    def storage(self) -> dict:
        out = {"devices": [], "repo_device": None, "repo_mount_source": None, "reason": None}
        r = self.run(["lsblk", "-J", "-b", "-o", "NAME,TYPE,SIZE,ROTA,TRAN,MODEL,MOUNTPOINTS"])
        if not r.ok:
            out["reason"] = r.reason
            self.note_unknown("storage", r.reason or "lsblk не сработал")
            return out
        try:
            data = json.loads(r.stdout)
        except json.JSONDecodeError as e:
            out["reason"] = f"lsblk -J не разобран: {e}"
            self.note_unknown("storage", out["reason"])
            return out
        for dev in data.get("blockdevices", []):
            if dev.get("type") != "disk":
                continue
            kind, why = classify_disk(dev)
            size = dev.get("size")
            out["devices"].append({
                "name": dev.get("name"),
                "size_gib": round(int(size) / 1024 ** 3, 2) if size is not None and str(size).isdigit() else None,
                "rotational_flag": dev.get("rota"),
                "transport": dev.get("tran"),
                "model": (dev.get("model") or "").strip() or None,
                "kind": kind,
                "kind_reason": why,
            })
        r = self.run(["findmnt", "-n", "-o", "SOURCE", "-T", self.repo])
        if r.ok:
            src = r.stdout.strip()
            out["repo_mount_source"] = src or None
            m = re.match(r"^/dev/([a-z]+(?:\d+n\d+)?)", src)
            if m:
                base = m.group(1)
                out["repo_device"] = next((d["name"] for d in out["devices"] if base.startswith(d["name"])), base)
        else:
            out["repo_mount_reason"] = r.reason
        return out

    def browsers(self) -> list:
        found = []
        seen = set()
        for name, cmd in BROWSER_COMMANDS:
            path = self.which(cmd)
            if not path:
                continue
            real = os.path.realpath(path)
            if real in seen:
                continue
            seen.add(real)
            r = self.run([path, "--version"])
            found.append({"name": name, "path": path, "version": parse_browser_version(r.stdout) if r.ok else None,
                          "version_text": r.stdout.strip()[:120] if r.ok else None, "reason": None if r.ok else r.reason, "source": "PATH"})
        roots = [self.env.get("PLAYWRIGHT_BROWSERS_PATH"), "/opt/pw-browsers", os.path.expanduser("~/.cache/ms-playwright")]
        for root in [r for r in roots if r]:
            for exe in sorted(self.glob(os.path.join(root, "chromium*", "chrome-linux", "chrome")) + self.glob(os.path.join(root, "chromium*", "chrome-linux", "headless_shell"))
                              + self.glob(os.path.join(root, "firefox*", "firefox", "firefox"))):
                real = os.path.realpath(exe)
                if real in seen:
                    continue
                seen.add(real)
                r = self.run([exe, "--version"])
                label = "Chromium headless shell (Playwright)" if exe.endswith("headless_shell") else ("Firefox (Playwright)" if "firefox" in exe else "Chromium (Playwright)")
                found.append({"name": label, "path": exe, "version": parse_browser_version(r.stdout) if r.ok else None,
                              "version_text": r.stdout.strip()[:120] if r.ok else None, "reason": None if r.ok else r.reason, "source": "playwright"})
        if not found:
            self.note_unknown("browsers", "браузеры не найдены ни в PATH, ни в каталогах Playwright")
        return found

    def git(self) -> dict:
        r = self.run(["git", "-C", self.repo, "rev-parse", "HEAD"])
        if not r.ok:
            self.note_unknown("git.revision", r.reason or "git недоступен")
            return {"revision": None, "dirty": None, "reason": r.reason}
        s = self.run(["git", "-C", self.repo, "status", "--porcelain"])
        return {"revision": r.stdout.strip(), "dirty": (s.stdout.strip() != "") if s.ok else None, "reason": None}

    def toolchain(self) -> dict:
        """Versions of the tools the build and tests use; a missing tool is null with its reason."""
        out: dict = {"python": platform.python_version()}
        reasons = {}
        for key, argv in (("node", ["node", "--version"]), ("gcc", ["g++", "--version"]), ("clang", ["clang++", "--version"]),
                          ("cmake", ["cmake", "--version"]), ("emcc", ["emcc", "--version"]), ("nvcc", ["nvcc", "--version"])):
            r = self.run(argv)
            lines = r.stdout.strip().splitlines() if r.ok else []
            out[key] = lines[-1][:160] if key == "nvcc" and lines else (lines[0][:160] if lines else None)
            if out[key] is None:
                reasons[key] = r.reason or "пустой вывод"
        out["reasons"] = reasons
        return out

    def collect(self) -> dict:
        os_info = self.os_info()
        cpu = self.cpu()
        memory = self.memory()
        gpu = self.gpu()
        manifest = {
            "kind": MANIFEST_KIND,
            "generated_at": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
            "tool": {"name": "tools/hw_manifest.py", "version": TOOL_VERSION, "python": platform.python_version()},
            "note_ru": "Факты об этой машине, собранные её же инструментами. Неизвестное — null с причиной; ничего не угадывается. Это манифест условий теста, а не замер производительности.",
            "git": self.git(),
            "os": os_info,
            "cpu": cpu,
            "memory": memory,
            "gpu": gpu,
            "vulkan": self.vulkan(),
            "display": self.display(),
            "power": self.power(),
            "storage": self.storage(),
            "browsers": self.browsers(),
            "toolchain": self.toolchain(),
        }
        manifest["target_comparison"] = compare_with_target(manifest)
        manifest["unknowns"] = self.unknowns
        return manifest


def compare_with_target(m: dict) -> dict:
    """Plain statements against the document's target bench (RTX 3060 12 GB, 32 GB RAM)."""
    lines = []
    gpus = (m.get("gpu") or {}).get("nvidia") or []
    if gpus:
        names = ", ".join(f"{g['name']} ({g['vram_total_gib']} GiB)" for g in gpus)
        match = any("3060" in g["name"] for g in gpus)
        lines.append(f"GPU: {names} — {'совпадает с целевой RTX 3060' if match else 'НЕ целевая RTX 3060'}.")
    elif (m.get("gpu") or {}).get("present") is False:
        lines.append("GPU: нет. Это не целевой стенд; 60 FPS, GPU-LLM и время кадра здесь не проверяются.")
    else:
        lines.append("GPU: NVIDIA не обнаружена; модель видеокарты неизвестна.")
    ram = (m.get("memory") or {}).get("total_gib")
    if ram is not None:
        lines.append(f"RAM: {ram} GiB {'≥' if ram >= TARGET['ram_gib'] * 0.95 else '<'} целевых {TARGET['ram_gib']} GB.")
    cpu = m.get("cpu") or {}
    if cpu.get("model"):
        lines.append(f"CPU: {cpu['model']}, ядер {cpu.get('physical_cores')}, потоков {cpu.get('logical_threads')}" + (" (виртуальные)." if cpu.get("virtual_cpu") else "."))
    return {"target": TARGET, "is_target_bench": bool(gpus) and any("3060" in g["name"] for g in gpus), "summary_ru": lines}


# ------------------------------------------------------------------ CLI


def main(argv: Optional[list] = None) -> int:
    ap = argparse.ArgumentParser(description="E0 hardware manifest (Документ §19, §22)")
    ap.add_argument("--out", default=DEFAULT_OUT, help="куда записать JSON (по умолчанию reports/hardware_manifest.json)")
    ap.add_argument("--print", action="store_true", help="также вывести JSON")
    ap.add_argument("--self-test", action="store_true", help="тесты разбора на смоделированных машинах")
    args = ap.parse_args(argv)
    if args.self_test:
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(ManifestTests)
        result = unittest.TextTestRunner(verbosity=2).run(suite)
        return 0 if result.wasSuccessful() else 1
    manifest = Probe().collect()
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
        f.write("\n")
    if args.print:
        print(json.dumps(manifest, ensure_ascii=False, indent=2))
    for line in manifest["target_comparison"]["summary_ru"]:
        print(line)
    print(f"неизвестно: {len(manifest['unknowns'])} полей · {os.path.relpath(args.out, REPO_ROOT)}")
    return 0


# ------------------------------------------------------------------ self-test


class FakeMachine:
    """A simulated machine: command outputs and files by path."""

    def __init__(self, commands: dict, files: dict, env: dict, binaries: set):
        self.commands = commands
        self.files = files
        self.env = env
        self.binaries = binaries

    def run(self, argv: list) -> CmdResult:
        key = " ".join(argv)
        for pattern, out in self.commands.items():
            if key == pattern or key.startswith(pattern + " "):
                return CmdResult(True, out) if isinstance(out, str) else out
        return CmdResult(False, reason=f"команда {argv[0]} не найдена")

    def read(self, path: str) -> Optional[str]:
        return self.files.get(path)

    def which(self, cmd: str) -> Optional[str]:
        return f"/usr/bin/{cmd}" if cmd in self.binaries else None

    def glob(self, pattern: str) -> list:
        """Like glob.glob over the simulated tree: files and their parent directories, `*` never crosses `/`."""
        import fnmatch
        paths = set()
        for f in self.files:
            parts = f.split("/")
            for i in range(2, len(parts) + 1):
                paths.add("/".join(parts[:i]))
        want = pattern.split("/")
        return sorted(p for p in paths if len(p.split("/")) == len(want) and all(fnmatch.fnmatchcase(a, b) for a, b in zip(p.split("/"), want)))

    def probe(self) -> Probe:
        return Probe(run=self.run, read=self.read, env=self.env, which=self.which, globber=self.glob, repo="/repo")


GAMING_PC = FakeMachine(
    commands={
        "nvidia-smi --query-gpu=name,memory.total,driver_version,pci.bus_id --format=csv,noheader,nounits": "NVIDIA GeForce RTX 3060, 12288, 580.95.05, 00000000:01:00.0\n",
        "vulkaninfo --summary": "Vulkan Instance Version: 1.3.275\n\nDevices:\n========\nGPU0:\n\tapiVersion         = 1.4.312\n\tdriverVersion      = 580.95.5.0\n\tdeviceType         = PHYSICAL_DEVICE_TYPE_DISCRETE_GPU\n\tdeviceName         = NVIDIA GeForce RTX 3060\n",
        "xrandr --query": "Screen 0: minimum 8 x 8, current 2560 x 1440\nDP-0 connected primary 2560x1440+0+0 (normal) 597mm x 336mm\n   2560x1440     59.95 +  143.91*\n   1920x1080     60.00\nHDMI-0 disconnected (normal)\n",
        "powerprofilesctl get": "performance\n",
        "lsblk -J -b -o NAME,TYPE,SIZE,ROTA,TRAN,MODEL,MOUNTPOINTS": json.dumps({"blockdevices": [
            {"name": "nvme0n1", "type": "disk", "size": 1000204886016, "rota": False, "tran": "nvme", "model": "Samsung SSD 980 PRO 1TB", "mountpoints": [None]},
            {"name": "sda", "type": "disk", "size": 2000398934016, "rota": True, "tran": "sata", "model": "WDC WD20EZRZ", "mountpoints": ["/data"]}]}),
        "findmnt -n -o SOURCE -T /repo": "/dev/nvme0n1p2\n",
        "lscpu -J": json.dumps({"lscpu": [
            {"field": "Architecture:", "data": "x86_64"}, {"field": "CPU(s):", "data": "12"},
            {"field": "Vendor ID:", "data": "AuthenticAMD", "children": [{"field": "Model name:", "data": "AMD Ryzen 5 5600X 6-Core Processor"},
             {"field": "Core(s) per socket:", "data": "6"}, {"field": "Socket(s):", "data": "1"}, {"field": "CPU max MHz:", "data": "4650.2920"}]}]}),
        "/usr/bin/google-chrome --version": "Google Chrome 141.0.7390.122 \n",
        "/usr/bin/firefox --version": "Mozilla Firefox 144.0\n",
        "git -C /repo rev-parse HEAD": "0123456789abcdef0123456789abcdef01234567\n",
        "git -C /repo status --porcelain": "",
    },
    files={
        "/etc/os-release": 'PRETTY_NAME="Ubuntu 24.04.3 LTS"\nID=ubuntu\nVERSION_ID="24.04"\n',
        "/proc/meminfo": "MemTotal:       32768000 kB\nMemAvailable:   28000000 kB\nSwapTotal:       2097148 kB\n",
        "/proc/cpuinfo": "processor\t: 0\nmodel name\t: AMD Ryzen 5 5600X 6-Core Processor\nflags\t\t: fpu avx avx2 fma f16c\n\n",
        "/sys/class/drm/card1/device/vendor": "0x10de\n",
        "/sys/class/drm/card1/device/device": "0x2504\n",
        "/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor": "performance\n",
        "/sys/devices/system/cpu/cpu1/cpufreq/scaling_governor": "performance\n",
        "/proc/driver/nvidia/version": "NVRM version: NVIDIA UNIX x86_64 Kernel Module  580.95.05\n",
    },
    env={"XDG_SESSION_TYPE": "x11", "DISPLAY": ":0", "XDG_CURRENT_DESKTOP": "ubuntu:GNOME"},
    binaries={"google-chrome", "firefox", "xrandr"},
)

HEADLESS_VM = FakeMachine(
    commands={
        "lscpu -J": json.dumps({"lscpu": [{"field": "CPU(s):", "data": "4"}, {"field": "Vendor ID:", "data": "GenuineIntel", "children": [
            {"field": "Model name:", "data": "Intel(R) Xeon(R) Processor @ 2.80GHz"}, {"field": "Core(s) per socket:", "data": "4"}, {"field": "Socket(s):", "data": "1"}]},
            {"field": "Hypervisor vendor:", "data": "KVM"}]}),
        "lsblk -J -b -o NAME,TYPE,SIZE,ROTA,TRAN,MODEL,MOUNTPOINTS": json.dumps({"blockdevices": [
            {"name": "zram0", "type": "disk", "size": 0, "rota": False, "tran": None, "model": None},
            {"name": "vda", "type": "disk", "size": 274877906944, "rota": True, "tran": "virtio", "model": None}]}),
        "/opt/pw-browsers/chromium-1194/chrome-linux/chrome --version": "Chromium 141.0.7390.37 \n",
        "systemd-detect-virt --vm": "kvm\n",
        "systemd-detect-virt --container": "docker\n",
    },
    files={
        "/proc/meminfo": "MemTotal:       16477352 kB\nMemAvailable:   15629844 kB\nSwapTotal:             0 kB\n",
        "/proc/cpuinfo": "processor\t: 0\nmodel name\t: Intel(R) Xeon(R) Processor @ 2.80GHz\nphysical id\t: 0\ncore id\t\t: 0\nflags\t\t: fpu avx avx2 hypervisor\n\n",
        "/opt/pw-browsers/chromium-1194/chrome-linux/chrome": "",
    },
    env={},
    binaries=set(),
)


class ManifestTests(unittest.TestCase):
    def test_gaming_pc(self):
        m = GAMING_PC.probe().collect()
        self.assertEqual(m["gpu"]["nvidia"], [{"name": "NVIDIA GeForce RTX 3060", "vram_total_mib": 12288, "vram_total_gib": 12.0, "driver_version": "580.95.05", "pci_bus_id": "00000000:01:00.0"}])
        self.assertTrue(m["gpu"]["present"])
        self.assertEqual(m["gpu"]["drm_devices"], [{"card": "card1", "pci_vendor": "0x10de", "pci_device": "0x2504", "driver": None}])
        self.assertEqual(m["gpu"]["nvidia_kernel_module"], "NVRM version: NVIDIA UNIX x86_64 Kernel Module  580.95.05")
        self.assertTrue(m["target_comparison"]["is_target_bench"])
        self.assertEqual(m["vulkan"]["devices"][0]["deviceType"], "PHYSICAL_DEVICE_TYPE_DISCRETE_GPU")
        self.assertEqual(m["display"]["session_type"], "x11")
        self.assertEqual(m["display"]["monitors"], [{"output": "DP-0", "primary": True, "mode": "2560x1440", "refresh_hz": 143.91}])
        self.assertEqual(m["power"]["profile"], "performance")
        self.assertEqual(m["power"]["cpufreq_governors"], {"performance": 2})
        kinds = {d["name"]: d["kind"] for d in m["storage"]["devices"]}
        self.assertEqual(kinds, {"nvme0n1": "nvme_ssd", "sda": "hdd"})
        self.assertEqual(m["storage"]["repo_device"], "nvme0n1")
        self.assertEqual(m["cpu"]["physical_cores"], 6)
        self.assertEqual(m["cpu"]["logical_threads"], 12)
        self.assertEqual(m["cpu"]["max_mhz"], 4650.292)
        self.assertEqual(m["memory"]["total_gib"], 31.25)
        self.assertEqual([b["version"] for b in m["browsers"]], ["141.0.7390.122", "144.0"])
        self.assertFalse(m["git"]["dirty"])

    def test_headless_vm_reports_unknowns_plainly(self):
        m = HEADLESS_VM.probe().collect()
        self.assertFalse(m["gpu"]["present"])
        self.assertIsNone(m["gpu"]["nvidia"])
        self.assertIn("не найдена", m["gpu"]["nvidia_reason"])
        self.assertFalse(m["target_comparison"]["is_target_bench"])
        self.assertIn("GPU: нет", m["target_comparison"]["summary_ru"][0])
        self.assertIsNone(m["vulkan"]["available"])
        self.assertIsNone(m["display"]["session_type"])
        self.assertIsNotNone(m["display"]["session_reason"])
        self.assertIsNone(m["power"]["profile"])
        self.assertIsNone(m["power"]["cpufreq_governors"])
        self.assertTrue(m["cpu"]["virtual_cpu"])
        self.assertEqual((m["os"]["vm"], m["os"]["container"]), ("kvm", "docker"))
        self.assertIn("emcc", m["toolchain"]["reasons"])
        self.assertEqual(next(d for d in m["storage"]["devices"] if d["name"] == "zram0")["size_gib"], 0.0)
        self.assertIsNone(m["cpu"]["max_mhz"])
        vda = next(d for d in m["storage"]["devices"] if d["name"] == "vda")
        self.assertEqual(vda["kind"], "virtual")  # rotational=1 of virtio is not trusted
        self.assertEqual(m["browsers"][0]["source"], "playwright")
        self.assertEqual(m["browsers"][0]["version"], "141.0.7390.37")
        fields = {u["field"] for u in m["unknowns"]}
        for f in ("gpu.nvidia", "vulkan", "display", "power.profile", "power.cpufreq_governor", "git.revision"):
            self.assertIn(f, fields)
        for u in m["unknowns"]:
            self.assertTrue(u["reason"], u)

    def test_parsers_edge_cases(self):
        self.assertEqual(parse_nvidia_smi_csv("NVIDIA A100-SXM4-80GB, 81920, 550.54.15, 00000000:07:00.0\nNVIDIA A100-SXM4-80GB, [N/A], 550.54.15, 00000000:0F:00.0\n")[1]["vram_total_mib"], None)
        self.assertEqual(parse_xrandr("eDP-1 connected 1920x1080+0+0\n   1920x1080     60.02*+  48.00\n"), [{"output": "eDP-1", "primary": False, "mode": "1920x1080", "refresh_hz": 60.02}])
        self.assertEqual(parse_wlr_randr('DP-1 "Dell"\n  Modes:\n    2560x1440 px, 59.951000 Hz\n    2560x1440 px, 164.802002 Hz (preferred, current)\n'), [{"output": "DP-1", "primary": None, "mode": "2560x1440", "refresh_hz": 164.802002}])
        self.assertEqual(parse_proc_cpuinfo("processor : 0\nphysical id : 0\ncore id : 0\n\nprocessor : 1\nphysical id : 0\ncore id : 0\n\n")["physical_cores"], 1)
        self.assertEqual(classify_disk({"name": "sdb", "rota": False, "tran": "usb"}), ("ssd", None))
        self.assertEqual(parse_browser_version("Mozilla Firefox 115.3.1esr"), "115.3.1")
        self.assertEqual(parse_os_release('PRETTY_NAME="Fedora Linux 41"\nID=fedora\n')["ID"], "fedora")


if __name__ == "__main__":
    sys.exit(main())
