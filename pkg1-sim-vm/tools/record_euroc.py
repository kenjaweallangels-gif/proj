#!/usr/bin/env python3
"""Запись сеанса для ReplayRig в формате EuRoC-подобной папки.

    python tools/record_euroc.py --rig sim --package ../data/examples/op040_shelf_bench.json --frames 300 --out out/rec_sim
    python tools/record_euroc.py --rig viture --camera /dev/video2 --frames 900 --out rec/2026-10-01_rm12
Структура: intrinsics.yaml, cam0/data.csv (t_ns, file), cam0/data/*.png, pose_gt.csv (если источник даёт позу).
ВНИМАНИЕ (AGENTS.md, безопасность): записи с реальной камеры цеха — только с разрешения, без лиц; хранить локально.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import cv2
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "core"))
from arcore.hal import make_rig  # noqa: E402


def record(rig, out: Path, frames: int) -> int:
    (out / "cam0" / "data").mkdir(parents=True, exist_ok=True)
    rows, gt, n, K = [], [], 0, None
    while frames == 0 or n < frames:
        f = rig.frames.next_frame()
        if f is None:
            break
        K = f.K
        name = f"{f.t_ns}.png"
        cv2.imwrite(str(out / "cam0" / "data" / name), f.image)
        rows.append(f"{f.t_ns},{name}")
        p = rig.poses.pose_at(f.t_ns) if rig.poses else None
        if p is not None:
            gt.append(",".join(str(v) for v in [f.t_ns, *p.position_m.tolist(), *p.rotation_xyzw.tolist()]))
        n += 1
    (out / "cam0" / "data.csv").write_text("#timestamp [ns],filename\n" + "\n".join(rows) + "\n")
    if gt:
        (out / "pose_gt.csv").write_text("#t_ns,px,py,pz,qx,qy,qz,qw (T_world_cam)\n" + "\n".join(gt) + "\n")
    if K is not None:
        (out / "intrinsics.yaml").write_text(yaml.safe_dump(
            {"width": K.width, "height": K.height, "fx": float(K.fx), "fy": float(K.fy), "cx": float(K.cx),
             "cy": float(K.cy), "dist": [float(d) for d in K.dist]}))
    return n


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rig", default="sim")
    ap.add_argument("--package")
    ap.add_argument("--camera")
    ap.add_argument("--frames", type=int, default=300)
    ap.add_argument("--out", required=True, type=Path)
    a = ap.parse_args(argv)
    cfg = {"package_path": a.package, "n_frames": a.frames}
    if a.camera:
        cfg["camera"] = a.camera
    n = record(make_rig(a.rig, **cfg), a.out, a.frames)
    print(f"Записано кадров: {n} → {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
