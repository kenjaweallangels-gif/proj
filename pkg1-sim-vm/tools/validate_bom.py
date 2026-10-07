#!/usr/bin/env python3
"""Сверка пакета операции с GLB: каждая деталь parts[].node должна быть узлом модели, и наоборот (предупреждение).

    python tools/validate_bom.py ../data/examples/op040_shelf_bench.json out/op040_shelf.glb [--tol-mm 2]
Дополнительно сравнивает центр узла в GLB с parts[].target.position (если задан --tol-mm) — ловит сдвиг СК
между CAD и пакетом (самая частая ошибка: забыли перенести начало координат в базу оснастки).
Код возврата 0 — всё сходится, 1 — есть ошибки.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np


def glb_nodes(path: Path) -> dict[str, np.ndarray]:
    """Имя узла → центр габарита в мм (СК модели, Y вверх)."""
    import trimesh
    scene = trimesh.load(path, force="scene")
    out = {}
    for node in scene.graph.nodes_geometry:
        T, geom = scene.graph[node]
        out[node] = trimesh.transform_points([scene.geometry[geom].bounds.mean(0)], T)[0] * 1000
    return out


def check(pkg: dict, nodes: dict[str, np.ndarray], tol_mm: float | None = None) -> tuple[list[str], list[str]]:
    errors, warnings = [], []
    used = set()
    for p in pkg["parts"]:
        n = p.get("node")
        if not n:
            warnings.append(f"{p['id']}: нет node — будет показана заглушка fallback")
            continue
        used.add(n)
        if n not in nodes:
            errors.append(f"{p['id']}: узла «{n}» нет в GLB")
            continue
        if tol_mm is not None:
            d = float(np.linalg.norm(nodes[n] - np.array(p["target"]["position"], float)))
            if d > tol_mm:
                errors.append(f"{p['id']}: центр узла отличается от target на {d:.1f} мм (> {tol_mm})")
    extra = sorted(set(nodes) - used)
    if extra:
        warnings.append(f"узлы GLB без детали в пакете: {', '.join(extra[:20])}{' …' if len(extra) > 20 else ''}")
    return errors, warnings


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("package", type=Path)
    ap.add_argument("glb", type=Path)
    ap.add_argument("--tol-mm", type=float, default=None)
    a = ap.parse_args(argv)
    pkg = json.loads(a.package.read_text(encoding="utf-8"))
    errors, warnings = check(pkg, glb_nodes(a.glb), a.tol_mm)
    for w in warnings:
        print("ПРЕДУПРЕЖДЕНИЕ:", w)
    for e in errors:
        print("ОШИБКА:", e)
    print("OK" if not errors else f"Ошибок: {len(errors)}")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
