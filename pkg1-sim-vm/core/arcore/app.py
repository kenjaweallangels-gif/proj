"""Главный цикл ядра: источник (Rig) → привязка → фильтр → шаги → клиент отображения.

Запуск (из pkg1-sim-vm):
    PYTHONPATH=core:. AR_RIG=sim python -m arcore.app --package ../data/examples/op040_shelf_bench.json --frames 300
--frames 0 — бесконечно (синтетика зацикливается), для работы вместе с Godot-клиентом (make sim).
"""
from __future__ import annotations

import argparse
import sys
import time

import numpy as np

from arcore.geometry import R_to_quat, pose_matrix
from arcore.hal import make_rig
from arcore.io.package import load_package
from arcore.net.udp import UdpDisplaySink, UdpInput
from arcore.steps.engine import StepEngine
from arcore.tracking.aruco import MarkerTracker
from arcore.tracking.registration import PoseFilter, ScaleMonitor
from arcore.voice.commands import parse


def anchor_message(T_cam_op: np.ndarray, quality: float, reproj_px: float, ids: list[int],
                   t_ns: int = 0, frame: str = "") -> dict:
    """Поза СК операции в СК камеры OpenCV: позиция в метрах, кватернион [x,y,z,w] (docs/02_hal_contracts.md)."""
    return {"type": "anchor", "t_ns": t_ns, "frame": frame, "position_m": T_cam_op[:3, 3].round(5).tolist(),
            "rotation_xyzw": R_to_quat(T_cam_op[:3, :3]).round(6).tolist(),
            "quality": round(quality, 3), "reproj_px": round(reproj_px, 3), "markers": ids}


def run(package: str, frames: int = 300, rig_name: str | None = None, host: str = "127.0.0.1",
        realtime: bool = False, auto_next_s: float = 0.0, verbose: bool = True,
        listen_input: bool = True, rig_cfg: dict | None = None) -> dict:
    pkg = load_package(package)
    rig = make_rig(rig_name, package_path=package, n_frames=frames, **(rig_cfg or {}))
    first = rig.frames.next_frame()
    if first is None:
        raise RuntimeError("Источник кадров пуст")
    tracker = MarkerTracker(pkg.markers(), first.K)
    filt = PoseFilter()
    engine = StepEngine(pkg.data)
    sink = UdpDisplaySink(host=host)
    inp = UdpInput() if listen_input else None
    scale = ScaleMonitor({m.id: m.T_op_marker[:3, 3] for m in pkg.markers()})

    engine.start()
    sink.publish(engine.message())
    stats = {"frames": 0, "anchored": 0, "pos_err_mm": [], "scale_ok": None}
    frame, last_auto = first, time.monotonic()
    t0 = time.monotonic()
    while frame is not None:
        stats["frames"] += 1
        est = tracker.estimate(frame)
        if est is not None:
            stats["anchored"] += 1
            T = filt.update(est.T_cam_op, est.quality)
            engine.on_anchor(est.quality)
            sink.publish(anchor_message(T, est.quality, est.reproj_px, est.ids, frame.t_ns,
                                        pkg.data["anchors"]["reference_frame"]))
            gt = rig.poses.pose_at(frame.t_ns) if rig.poses else None
            if gt is not None and rig.name in ("sim", "replay"):
                # истина есть только в синтетике и записях с pose_gt.csv: T_world_cam, СК операции = мировая СК
                T_true = np.linalg.inv(pose_matrix(gt.position_m, gt.rotation_xyzw))
                stats["pos_err_mm"].append(float(np.linalg.norm(est.T_cam_op[:3, 3] - T_true[:3, 3]) * 1000))
        if stats["scale_ok"] is None:
            # отдельно от общей позы: при метках не в масштабе SQPNP даёт большую репроекцию и поза отбрасывается
            scale.add(tracker.per_marker_centers(frame))
            v = scale.verdict
            if v is not None:
                stats["scale_ok"], stats["scale"] = v
                sink.publish({"type": "scale_check", "ok": v[0], "scale": round(v[1], 4)})
                if not v[0]:
                    print(f"[!] Масштаб меток {v[1]:.3f} ≠ 1: проверьте печать (100 %) и size_mm в пакете")
        engine.tick()

        for msg in (inp.poll() if inp else []):
            if msg.get("type") == "voice":
                p = parse(msg.get("text", ""), require_wake=msg.get("wake", True))
                if p:
                    engine.command(*p)
            elif msg.get("type") == "input":
                engine.command(msg.get("command", ""), msg.get("value"))
            elif msg.get("type") == "head":
                pass        # поза головы из Godot-симулятора: пригодится для GodotFrameRig (prompts/08)
            sink.publish(engine.message())

        if auto_next_s and time.monotonic() - last_auto > auto_next_s:
            last_auto = time.monotonic()
            need = engine.needs()
            engine.command("photo" if need == "photo" else "next")
            sink.publish(engine.message())

        if verbose and stats["frames"] % 30 == 0:
            m = engine.message()
            err = np.median(stats["pos_err_mm"][-30:]) if stats["pos_err_mm"] else float("nan")
            print(f"[{stats['frames']:5d}] привязка {stats['anchored']}/{stats['frames']}  "
                  f"ошибка {err:6.2f} мм  шаг {m['index'] + 1}/{m['total']} «{m['title']}» [{m['state']}]")
            sink.publish(m)
        if realtime:
            time.sleep(max(0.0, 1 / 30 - (time.monotonic() - t0) % (1 / 30)))
        frame = rig.frames.next_frame()
        if frame is None and frames == 0 and rig.name == "sim":
            rig.meta["camera"].i = 0
            frame = rig.frames.next_frame()

    errs = stats["pos_err_mm"]
    stats["median_err_mm"] = float(np.median(errs)) if errs else None
    stats["p95_err_mm"] = float(np.percentile(errs, 95)) if errs else None
    stats["log"] = [e.__dict__ for e in engine.log]
    return stats


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Ядро AR-сборки")
    ap.add_argument("--package", required=True)
    ap.add_argument("--frames", type=int, default=300)
    ap.add_argument("--rig", default=None, help="sim | replay | viture (по умолчанию AR_RIG)")
    ap.add_argument("--replay", default=None, help="папка записи EuRoC для --rig replay")
    ap.add_argument("--camera", default=None, help="устройство камеры для --rig viture, напр. /dev/video2")
    ap.add_argument("--host", default="127.0.0.1", help="адрес клиента отображения (Godot)")
    ap.add_argument("--realtime", action="store_true")
    ap.add_argument("--auto-next", type=float, default=0.0, help="автоматически «дальше» каждые N с (демо)")
    a = ap.parse_args(argv)
    cfg = {k: v for k, v in (("path", a.replay), ("camera", a.camera)) if v}
    st = run(a.package, a.frames, a.rig, a.host, a.realtime or a.frames == 0, a.auto_next, rig_cfg=cfg)
    print(f"Итог: кадров {st['frames']}, с привязкой {st['anchored']}, "
          f"медиана ошибки {st['median_err_mm']} мм, p95 {st['p95_err_mm']} мм, масштаб ок: {st['scale_ok']} ({st.get('scale')})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
