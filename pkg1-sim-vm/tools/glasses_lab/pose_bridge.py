"""Мост позы головы → WebSocket: реальные очки двигают камеру симулятора (galley.html?pose=…) и стенда (lab.html).

    python -m glasses_lab.pose_bridge --source demo                      # синтетика (проверка связи без очков)
    python -m glasses_lab.pose_bridge --source replay:rec/pose.csv       # повтор записи
    python -m glasses_lab.pose_bridge --source viture --record rec/pose.csv   # VITURE (после подключения SDK)

Сообщение — как «head» в протоколе ядра (docs/02_hal_contracts.md), одна строка JSON:
    {"type":"head","t_ns":…,"rotation_xyzw":[x,y,z,w],"position_m":[x,y,z],"source":"demo"}
СК: Y — вверх, взгляд — вдоль −Z (как в three.js и Godot), кватернион [x, y, z, w], метры.
Запись (--record): CSV t_ns,qx,qy,qz,qw,px,py,pz — её читает imu_analyze.py и --source replay.
"""
from __future__ import annotations

import argparse
import asyncio
import csv
import json
import math
import time
from pathlib import Path

PORT = 47110


# ---------- кватернионы (Y вверх) ----------
def quat_from_ypr(yaw: float, pitch: float, roll: float = 0.0) -> tuple[float, float, float, float]:
    """Курс (вокруг Y), тангаж (вокруг X), крен (вокруг Z), радианы; порядок YXZ (как Euler 'YXZ' в three.js)."""
    cy, sy = math.cos(yaw / 2), math.sin(yaw / 2)
    cp, sp = math.cos(pitch / 2), math.sin(pitch / 2)
    cr, sr = math.cos(roll / 2), math.sin(roll / 2)
    # q = qY * qX * qZ
    x = cy * sp * cr + sy * cp * sr
    y = sy * cp * cr - cy * sp * sr
    z = cy * cp * sr - sy * sp * cr
    w = cy * cp * cr + sy * sp * sr
    return (x, y, z, w)


def ypr_from_quat(q) -> tuple[float, float, float]:
    """Обратное к quat_from_ypr (порядок YXZ)."""
    x, y, z, w = q
    m13 = 2 * (x * z + w * y)
    m23 = 2 * (y * z - w * x)
    m33 = 1 - 2 * (x * x + y * y)
    m21 = 2 * (x * y + w * z)
    m22 = 1 - 2 * (x * x + z * z)
    pitch = math.asin(max(-1.0, min(1.0, -m23)))
    if abs(m23) < 0.9999999:
        return (math.atan2(m13, m33), pitch, math.atan2(m21, m22))
    m11 = 1 - 2 * (y * y + z * z)
    m31 = 2 * (x * z - w * y)
    return (math.atan2(-m31, m11), pitch, 0.0)


def head_message(t_ns: int, q, p=(0.0, 0.0, 0.0), source: str = "") -> str:
    return json.dumps({"type": "head", "t_ns": int(t_ns), "rotation_xyzw": [round(v, 6) for v in q],
                       "position_m": [round(v, 5) for v in p], "source": source}, separators=(",", ":"))


# ---------- источники позы ----------
class DemoSource:
    """Синтетика: плавный осмотр по сторонам (±25° курс, ±10° тангаж), лёгкое дрожание и дрейф 0,5 °/мин."""
    name = "demo"

    def __init__(self, drift_deg_min: float = 0.5):
        self.t0 = None
        self.drift = math.radians(drift_deg_min) / 60

    def read(self, t: float):
        if self.t0 is None:
            self.t0 = t
        s = t - self.t0
        yaw = math.radians(25) * math.sin(s * 0.5) + self.drift * s + math.radians(0.03) * math.sin(s * 37)
        pitch = math.radians(10) * math.sin(s * 0.33) + math.radians(0.03) * math.sin(s * 41 + 1)
        return quat_from_ypr(yaw, pitch), (0.0, 1.68, 0.0)


class ReplaySource:
    """Повтор записи CSV (t_ns,qx,qy,qz,qw[,px,py,pz]) в реальном темпе, по кругу."""
    name = "replay"

    def __init__(self, path: str | Path):
        self.rows = load_csv(path)
        if len(self.rows) < 2:
            raise ValueError(f"{path}: в записи меньше двух строк")
        self.t0 = None
        self.span = (self.rows[-1][0] - self.rows[0][0]) / 1e9

    def read(self, t: float):
        if self.t0 is None:
            self.t0 = t
        target = self.rows[0][0] + int(((t - self.t0) % max(self.span, 1e-3)) * 1e9)
        lo, hi = 0, len(self.rows) - 1
        while lo < hi:
            mid = (lo + hi) // 2
            if self.rows[mid][0] < target:
                lo = mid + 1
            else:
                hi = mid
        r = self.rows[lo]
        return r[1:5], r[5:8] if len(r) >= 8 else (0.0, 0.0, 0.0)


class VitureSource:
    """VITURE через C SDK. Имена функций — только из заголовков vendor/viture/ (AGENTS.md, п. 2; prompts/11)."""
    name = "viture"

    def __init__(self):
        raise NotImplementedError(
            "Поза VITURE не подключена: положите VITURE XR Glasses SDK (заголовки + библиотеку) в pkg1-sim-vm/vendor/viture/ "
            "и выполните prompts/11_viture_rig.md (обёртка arcore/rigs/viture_sdk.py). До этого используйте --source demo.")


class XrLinuxSource:
    """XREAL/VITURE на Linux через XRLinuxDriver (GPL — только как отдельная программа, без линковки, AGENTS.md, п. 9).
    Формат его вывода брать из документации драйвера; до проверки на очках — заглушка."""
    name = "xrlinux"

    def __init__(self):
        raise NotImplementedError(
            "Источник XRLinuxDriver не подключён: установите драйвер (github.com/wheaney/XRLinuxDriver), "
            "найдите в его документации формат вывода IMU и реализуйте XrLinuxSource.read() по нему (prompts/12_glasses_lab.md, шаг 4).")


def make_source(spec: str):
    if spec == "demo":
        return DemoSource()
    if spec.startswith("replay:"):
        return ReplaySource(spec.split(":", 1)[1])
    if spec == "viture":
        return VitureSource()
    if spec == "xrlinux":
        return XrLinuxSource()
    raise ValueError(f"Неизвестный источник {spec!r}: demo | replay:<csv> | viture | xrlinux")


# ---------- запись ----------
CSV_HEADER = ["t_ns", "qx", "qy", "qz", "qw", "px", "py", "pz"]


def load_csv(path: str | Path) -> list[tuple]:
    rows = []
    with open(path, newline="", encoding="utf-8") as f:
        for r in csv.reader(f):
            if not r or not r[0].strip().lstrip("-").isdigit():
                continue                                      # заголовок или пустая строка
            rows.append((int(r[0]), *[float(v) for v in r[1:]]))
    return rows


class Recorder:
    def __init__(self, path: str | Path | None):
        self.f = None
        if path:
            Path(path).parent.mkdir(parents=True, exist_ok=True)
            self.f = open(path, "w", newline="", encoding="utf-8")
            self.w = csv.writer(self.f)
            self.w.writerow(CSV_HEADER)

    def add(self, t_ns: int, q, p):
        if self.f:
            self.w.writerow([t_ns, *[f"{v:.6f}" for v in q], *[f"{v:.5f}" for v in p]])

    def close(self):
        if self.f:
            self.f.close()


# ---------- сервер ----------
async def serve(source, host: str = "127.0.0.1", port: int = PORT, hz: float = 120, record: str | None = None, seconds: float = 0):
    import websockets  # BSD; входит в uvicorn[standard]

    clients: set = set()
    rec = Recorder(record)

    async def handler(ws):
        clients.add(ws)
        try:
            await ws.wait_closed()
        finally:
            clients.discard(ws)

    async with websockets.serve(handler, host, port):
        print(f"[pose] ws://{host}:{port} · источник {source.name} · {hz:g} Гц{' · запись ' + record if record else ''}")
        print(f"[pose] симулятор: http://localhost:5173/galley.html?pose=ws://{host}:{port} · стенд: http://localhost:5173/lab.html")
        t_start = time.monotonic()
        try:
            while not seconds or time.monotonic() - t_start < seconds:
                t = time.monotonic()
                q, p = source.read(t)
                t_ns = time.monotonic_ns()
                rec.add(t_ns, q, p)
                msg = head_message(t_ns, q, p, source.name)
                for ws in list(clients):
                    try:
                        await ws.send(msg)
                    except Exception:
                        clients.discard(ws)
                await asyncio.sleep(max(0.0, 1 / hz - (time.monotonic() - t)))
        finally:
            rec.close()


def main(argv=None):
    ap = argparse.ArgumentParser(description="Поза головы с очков → WebSocket для симулятора")
    ap.add_argument("--source", default="demo", help="demo | replay:<csv> | viture | xrlinux")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=PORT)
    ap.add_argument("--hz", type=float, default=120)
    ap.add_argument("--record", help="записать позу в CSV (для imu_analyze.py)")
    ap.add_argument("--seconds", type=float, default=0, help="остановиться через N секунд (0 — пока не прервут)")
    a = ap.parse_args(argv)
    try:
        src = make_source(a.source)
    except NotImplementedError as e:
        raise SystemExit(f"[pose] {e}")
    try:
        asyncio.run(serve(src, a.host, a.port, a.hz, a.record, a.seconds))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
