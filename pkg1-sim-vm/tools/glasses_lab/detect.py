"""Найти AR-очки, подключённые к ПК: USB-устройства (по VID производителя), мониторы, камеры.

    python -m glasses_lab.detect            # из pkg1-sim-vm/tools (или: make lab-detect)
    python -m glasses_lab.detect --json out/lab/detect.json

Работает на Linux (sysfs, xrandr), Windows (PowerShell Get-PnpDevice) и macOS (system_profiler).
Очки по USB-C видны дважды: как USB-устройство (IMU, кнопки, камера) и как монитор DisplayPort.
"""
from __future__ import annotations

import argparse
import json
import platform
import re
import subprocess
from pathlib import Path

# VID производителей. VITURE — из документации VITURE XR Glasses SDK (docs/10_sdk_glasses.md: «у всех один USB VID 0x35CA»).
# XREAL — по открытым драйверам (XRLinuxDriver, Monado), на своих очках ПРОВЕРИТЬ и поправить при расхождении.
KNOWN_VIDS = {
    0x35CA: ("VITURE", "документация VITURE SDK"),
    0x3318: ("XREAL", "открытые драйверы — проверить на своих очках"),
}
DISPLAY_NAMES = re.compile(r"VITURE|XREAL|NREAL|Air|One Pro|Luma|Beast", re.I)


def parse_linux_sysfs(root: Path = Path("/sys/bus/usb/devices")) -> list[dict]:
    """USB-устройства из sysfs: idVendor, idProduct, manufacturer, product."""
    out = []
    for d in sorted(Path(root).glob("*")):
        vid_f, pid_f = d / "idVendor", d / "idProduct"
        if not (vid_f.exists() and pid_f.exists()):
            continue
        rd = lambda n: (d / n).read_text(errors="replace").strip() if (d / n).exists() else ""
        out.append({"vid": int(rd("idVendor"), 16), "pid": int(rd("idProduct"), 16), "manufacturer": rd("manufacturer"), "name": rd("product"), "path": str(d)})
    return out


_WIN_ID = re.compile(r"USB\\VID_([0-9A-F]{4})&PID_([0-9A-F]{4})", re.I)


def parse_windows_pnp(csv_text: str) -> list[dict]:
    """Вывод `Get-PnpDevice -PresentOnly | Select InstanceId,FriendlyName | ConvertTo-Csv -NoTypeInformation`."""
    out, seen = [], set()
    for line in csv_text.splitlines()[1:]:
        cells = [c.strip().strip('"') for c in line.split('","')]
        m = _WIN_ID.search(cells[0]) if cells else None
        if not m:
            continue
        key = (m.group(1).upper(), m.group(2).upper(), cells[1] if len(cells) > 1 else "")
        if key in seen:
            continue
        seen.add(key)
        out.append({"vid": int(m.group(1), 16), "pid": int(m.group(2), 16), "manufacturer": "", "name": key[2], "path": cells[0]})
    return out


def parse_macos_profiler(json_text: str) -> list[dict]:
    """Вывод `system_profiler SPUSBDataType -json` (дерево _items)."""
    out = []

    def walk(items):
        for it in items or []:
            vid = re.match(r"0x([0-9a-f]{4})", str(it.get("vendor_id", "")), re.I)
            pid = re.match(r"0x([0-9a-f]{4})", str(it.get("product_id", "")), re.I)
            if vid and pid:
                out.append({"vid": int(vid.group(1), 16), "pid": int(pid.group(1), 16), "manufacturer": it.get("manufacturer", ""),
                            "name": it.get("_name", ""), "path": it.get("location_id", "")})
            walk(it.get("_items"))

    for bus in json.loads(json_text).get("SPUSBDataType", []):
        walk(bus.get("_items"))
    return out


def parse_xrandr(text: str) -> list[dict]:
    """Подключённые мониторы из `xrandr --query`: имя выхода и текущий режим."""
    out = []
    for m in re.finditer(r"^(\S+) connected(?: primary)? (\d+)x(\d+)\+(\d+)\+(\d+)", text, re.M):
        out.append({"output": m.group(1), "w": int(m.group(2)), "h": int(m.group(3)), "x": int(m.group(4)), "y": int(m.group(5))})
    return out


def classify(devices: list[dict]) -> list[dict]:
    """Только устройства известных производителей очков, с маркой и источником VID."""
    res = []
    for d in devices:
        k = KNOWN_VIDS.get(d["vid"])
        if k:
            res.append({**d, "brand": k[0], "vid_source": k[1], "id": f"{d['vid']:04x}:{d['pid']:04x}"})
    return res


def glasses_mode_hint(w: int, h: int) -> str:
    """Что означает разрешение монитора очков (режимы из документации SDK: 2D 1920×1080/1200, SBS 3840×1080/1200)."""
    if w >= 3800:
        return "стерео side-by-side (по половине кадра на глаз)"
    if w in (1920,) and h in (1080, 1200):
        return "2D — одна картинка на оба глаза"
    return "нестандартный режим — проверьте настройки очков"


def _run(cmd: list[str]) -> str:
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=20).stdout
    except (OSError, subprocess.TimeoutExpired):
        return ""


def scan() -> dict:
    sysname = platform.system()
    usb, displays = [], []
    if sysname == "Linux":
        usb = parse_linux_sysfs()
        displays = parse_xrandr(_run(["xrandr", "--query"]))
    elif sysname == "Windows":
        usb = parse_windows_pnp(_run(["powershell", "-NoProfile", "-Command",
                                      "Get-PnpDevice -PresentOnly | Where-Object InstanceId -like 'USB\\VID_*' | Select-Object InstanceId,FriendlyName | ConvertTo-Csv -NoTypeInformation"]))
    elif sysname == "Darwin":
        txt = _run(["system_profiler", "SPUSBDataType", "-json"])
        usb = parse_macos_profiler(txt) if txt else []
    return {"system": sysname, "usb_all": len(usb), "glasses": classify(usb), "displays": displays}


def cameras(max_index: int = 6) -> list[dict]:
    """Перечислить камеры OpenCV (индекс, разрешение по умолчанию). Кадры не сохраняются (AGENTS.md, п. 8)."""
    import os
    os.environ.setdefault("OPENCV_LOG_LEVEL", "ERROR")
    import cv2
    out = []
    for i in range(max_index):
        cap = cv2.VideoCapture(i)
        if cap.isOpened():
            out.append({"index": i, "w": int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), "h": int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))})
        cap.release()
    return out


def report(r: dict) -> str:
    lines = [f"Система: {r['system']}, USB-устройств: {r['usb_all']}"]
    if r["glasses"]:
        for g in r["glasses"]:
            lines.append(f"  ✓ {g['brand']}: {g['name'] or 'устройство'} [{g['id']}] (VID: {g['vid_source']})")
    else:
        lines.append("  ✗ Очки VITURE/XREAL на USB не найдены. Проверьте кабель USB-C (нужен DisplayPort Alt Mode) и питание.")
    for d in r["displays"]:
        lines.append(f"  монитор {d['output']}: {d['w']}×{d['h']} — {glasses_mode_hint(d['w'], d['h'])}")
    if r["system"] != "Linux":
        lines.append("  Мониторы: проверьте в настройках дисплея — очки видны как второй экран 1920×1080/1200.")
    for c in r.get("cameras", []):
        lines.append(f"  камера #{c['index']}: {c['w']}×{c['h']}")
    return "\n".join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Найти AR-очки на ПК")
    ap.add_argument("--json", help="сохранить отчёт в JSON")
    ap.add_argument("--cameras", action="store_true", help="перечислить камеры (OpenCV)")
    a = ap.parse_args(argv)
    r = scan()
    if a.cameras:
        r["cameras"] = cameras()
    print(report(r))
    if a.json:
        Path(a.json).parent.mkdir(parents=True, exist_ok=True)
        Path(a.json).write_text(json.dumps(r, ensure_ascii=False, indent=2), encoding="utf-8")
    return r


if __name__ == "__main__":
    main()
