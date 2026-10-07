#!/usr/bin/env python3
"""STEP AP242 (экспорт сборки из NX/КОМПАС/T-FLEX) → GLB для очков и демо.

    python tools/step_to_glb.py models/AI7045200.stp out/op040_shelf.glb --deflection 0.2 --dump-poses out/poses.csv

Что делает:
  1. cascadio (OpenCASCADE) тесселирует сборку; имена узлов = имена компонентов в CAD → их пишем в parts[].node.
  2. Единицы: cascadio сам переводит мм STEP в метры glTF (проверено тестом tests/test_step_to_glb.py).
  3. Ось «вверх»: cascadio оси НЕ меняет. CAD обычно Z-up, glTF — Y-up: --up z поворачивает на −90° вокруг X,
     точка CAD (x, y, z) мм → GLB (x, z, −y) м.
  4. --dump-poses: CSV с позицией центра каждого узла в мм (СК изделия) → помогает заполнить tx;ty;tz в parts.csv.
Сжатие и оптимизация — отдельно, без слияния узлов (иначе потеряются детали):
    gltf-transform optimize out.glb out_opt.glb --compress meshopt --texture-compress false \
        --flatten false --join false --simplify false
НЕ включать flatten/join/simplify без проверки validate_bom.py.
"""
from __future__ import annotations

import argparse
import csv
import sys
import tempfile
from pathlib import Path

import numpy as np


def convert(step: Path, out: Path, deflection_mm: float = 0.2, angular: float = 0.3, up: str = "z") -> None:
    import cascadio
    import trimesh

    with tempfile.TemporaryDirectory() as td:
        raw = Path(td) / "raw.glb"
        rc = cascadio.step_to_glb(str(step), str(raw), tol_linear=deflection_mm, tol_angular=angular,
                                  merge_primitives=True, include_materials=True)
        if rc != 0 or not raw.exists():
            raise RuntimeError(f"cascadio вернул {rc}: проверьте, что файл — STEP AP203/214/242")
        scene = trimesh.load(raw, force="scene")
    # cascadio уже пишет метры; оси оставляет как в CAD
    if up == "z":
        scene.apply_transform(trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0]))
    out.parent.mkdir(parents=True, exist_ok=True)
    scene.export(out)


def dump_poses(glb: Path, csv_path: Path) -> int:
    import trimesh
    scene = trimesh.load(glb, force="scene")
    rows = []
    for node in scene.graph.nodes_geometry:
        T, geom = scene.graph[node]
        c = trimesh.transform_points([scene.geometry[geom].bounds.mean(0)], T)[0] * 1000
        rows.append((node, *np.round(c, 1)))
    with open(csv_path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(["node", "x_mm", "y_mm", "z_mm"])
        w.writerows(sorted(rows))
    return len(rows)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="STEP → GLB")
    ap.add_argument("step", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("--deflection", type=float, default=0.2, help="линейный допуск тесселяции, мм (0.1–0.5)")
    ap.add_argument("--angular", type=float, default=0.3, help="угловой допуск, рад")
    ap.add_argument("--up", choices=["z", "y"], default="z", help="ось «вверх» в CAD")
    ap.add_argument("--dump-poses", type=Path)
    a = ap.parse_args(argv)
    convert(a.step, a.out, a.deflection, a.angular, a.up)
    print(f"OK: {a.out} ({a.out.stat().st_size / 1e6:.1f} МБ)")
    if a.dump_poses:
        print(f"узлов: {dump_poses(a.out, a.dump_poses)} → {a.dump_poses}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
