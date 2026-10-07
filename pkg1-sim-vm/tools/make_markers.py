#!/usr/bin/env python3
"""Листы меток ArUco для печати в масштабе 1:1 (PNG 300 dpi, A4).

    python tools/make_markers.py --package ../data/examples/op040_shelf_bench.json --out out/markers
Печатать БЕЗ масштабирования («Фактический размер»). После печати линейкой проверить сторону чёрного квадрата
(size_mm в пакете). Ядро при запуске сверяет масштаб по 3+ меткам (ScaleMonitor) и предупредит об ошибке печати.
Для цеха: ламинировать матовой плёнкой (глянец даёт блики), клеить на ложемент в точках из пакета.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

DPI = 300
A4_MM = (210, 297)


def mm2px(mm: float) -> int:
    return int(round(mm / 25.4 * DPI))


def sheet(marker: dict, op_id: str) -> np.ndarray:
    W, H = mm2px(A4_MM[0]), mm2px(A4_MM[1])
    page = np.full((H, W), 255, np.uint8)
    side = mm2px(marker["size_mm"])
    d = cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, marker["dictionary"]))
    img = cv2.aruco.generateImageMarker(d, int(marker["id"]), side)
    x0, y0 = (W - side) // 2, mm2px(40)
    page[y0:y0 + side, x0:x0 + side] = img
    # стрелка «верх» (−Z СК метки в пакете) и контрольная линейка 50 мм
    cv2.arrowedLine(page, (W // 2, y0 - mm2px(6)), (W // 2, y0 - mm2px(18)), 0, 4, tipLength=0.4)
    ry = y0 + side + mm2px(20)
    cv2.line(page, (x0, ry), (x0 + mm2px(50), ry), 0, 3)
    for k in range(6):
        cv2.line(page, (x0 + mm2px(10 * k), ry - 15), (x0 + mm2px(10 * k), ry + 15), 0, 2)
    txt = [f"Op {op_id}  marker id {marker['id']}  {marker['dictionary']}",
           f"side {marker['size_mm']} mm  check: ruler = 50 mm",
           f"pos mm {marker['pose']['position']}"]
    for i, t in enumerate(txt):
        cv2.putText(page, t, (x0 - mm2px(30), ry + mm2px(15 + 9 * i)), cv2.FONT_HERSHEY_SIMPLEX, 1.6, 0, 3)
    return page


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--package", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--raw", action="store_true",
                    help="текстуры для Godot-сцены: marker_<id>.png 320×320 (метка 240 + белое поле 40)")
    a = ap.parse_args(argv)
    pkg = json.loads(a.package.read_text(encoding="utf-8"))
    a.out.mkdir(parents=True, exist_ok=True)
    if a.raw:
        for m in pkg["anchors"]["markers"]:
            d = cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, m["dictionary"]))
            img = cv2.copyMakeBorder(cv2.aruco.generateImageMarker(d, int(m["id"]), 240), 40, 40, 40, 40,
                                     cv2.BORDER_CONSTANT, value=255)
            cv2.imwrite(str(a.out / f"marker_{m['id']}.png"), img)
        print(f"Текстуры меток: {a.out}")
        return 0
    for m in pkg["anchors"]["markers"]:
        p = a.out / f"op{pkg['operation']['id']}_marker{m['id']}.png"
        ok, buf = cv2.imencode(".png", sheet(m, pkg["operation"]["id"]), [cv2.IMWRITE_PNG_COMPRESSION, 6])
        p.write_bytes(buf.tobytes())
        print(p)
    print("Печать: 100 % / «Фактический размер», 300 dpi")
    return 0


if __name__ == "__main__":
    sys.exit(main())
