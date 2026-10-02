#!/usr/bin/env python3
"""GLB-заглушка из пакета операции: каждая деталь — параллелепипед/цилиндр/пластина из parts[].fallback,
узел назван parts[].node. Нужна, пока нет реального STEP: проверяет конвейер, Godot-клиент и демо.

    python tools/make_fallback_glb.py ../data/examples/op040_shelf_bench.json out/op040_shelf.glb
Координаты: пакет в мм, Y вверх → GLB в метрах, Y вверх (как у step_to_glb.py после --up z).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import trimesh

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "core"))
from arcore.geometry import pose_matrix  # noqa: E402


def _hex(c: str) -> list[int]:
    c = (c or "#9aa3ad").lstrip("#")
    return [int(c[i:i + 2], 16) for i in (0, 2, 4)] + [255]


def build(pkg: dict) -> trimesh.Scene:
    scene = trimesh.Scene()
    for p in pkg["parts"]:
        fb = p.get("fallback") or {"type": "box", "size_mm": [50, 50, 50]}
        sx, sy, sz = (np.array(fb["size_mm"], float) / 1000).tolist()
        if fb["type"] == "cylinder":
            mesh = trimesh.creation.cylinder(radius=sx / 2, height=sy, sections=32)
            mesh.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0]))   # ось по Y
        else:
            mesh = trimesh.creation.box(extents=[sx, sy, sz])
        mat = trimesh.visual.material.PBRMaterial(name=f"mat_{p['id']}", baseColorFactor=_hex(fb.get("color")),
                                                  metallicFactor=0.3, roughnessFactor=0.6)
        mesh.visual = trimesh.visual.TextureVisuals(material=mat)
        T = pose_matrix(np.array(p["target"]["position"]) / 1000, p["target"].get("rotation"))
        name = p.get("node") or p["id"]
        scene.add_geometry(mesh, node_name=name, geom_name=name, transform=T)
    return scene


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("package", type=Path)
    ap.add_argument("out", type=Path)
    a = ap.parse_args(argv)
    pkg = json.loads(a.package.read_text(encoding="utf-8"))
    a.out.parent.mkdir(parents=True, exist_ok=True)
    build(pkg).export(a.out)
    print(f"OK: {a.out} — узлов {len(pkg['parts'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
