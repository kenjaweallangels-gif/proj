#!/usr/bin/env python3
"""Условный лист КД (PNG) для примеров и демо, пока нет настоящих листов из PDF.

    python tools/make_kd_placeholder.py ../data/examples/op040_shelf_bench.json ../data/examples
Рисует рамку листа, основную надпись, контуры деталей и выноски позиций по kd_sheets[].positions
(если позиций нет — раскладывает рамки сеткой и печатает их, чтобы вписать в пакет). Надпись «УСЛОВНЫЙ ЛИСТ».
Нужен Pillow и шрифт DejaVu (есть в Ubuntu: fonts-dejavu-core).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

W, H = 800, 520
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def font(size: int):
    try:
        return ImageFont.truetype(FONT, size)
    except OSError:
        return ImageFont.load_default()


def draw_sheet(pkg: dict, sheet: dict) -> tuple[Image.Image, dict]:
    img = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(img)
    d.rectangle([10, 10, W - 10, H - 10], outline="black", width=2)
    d.rectangle([30, 10, W - 10, H - 10], outline="black", width=1)
    # основная надпись
    x0, y0 = W - 330, H - 70
    d.rectangle([x0, y0, W - 10, H - 10], outline="black", width=2)
    d.line([x0, y0 + 30, W - 10, y0 + 30], fill="black")
    d.text((x0 + 8, y0 + 6), sheet["title"], fill="black", font=font(15))
    d.text((x0 + 8, y0 + 36), f"Оп. {pkg['operation']['id']} · ред. {pkg['operation'].get('revision', '')}", fill="black", font=font(13))
    d.text((40, H - 92), "УСЛОВНЫЙ ЛИСТ — заменить PNG из PDF КД (tools/kd_pdf_to_png.sh)", fill=(170, 0, 0), font=font(13))

    parts = [p for p in pkg["parts"] if p.get("kd", {}).get("sheet") == sheet["id"]]
    pos = dict(sheet.get("positions") or {})
    labels = sorted({p["kd"]["position"] for p in parts}, key=lambda s: (len(s), s))
    for i, lab in enumerate(labels):
        if lab not in pos:
            pos[lab] = [80 + (i % 3) * 220, 70 + (i // 3) * 150, 160, 80]
    for lab in labels:
        x, y, w, h = pos[lab]
        names = ", ".join(p["designation"] for p in parts if p["kd"]["position"] == lab)
        d.rectangle([x, y, x + w, y + h], outline=(40, 40, 40), width=2)
        for k in range(1, 4):          # штриховка «разреза»
            d.line([x + k * w / 4, y, x + k * w / 4 - min(h, 20), y + min(h, 20)], fill=(150, 150, 150))
        cx, cy = x + w / 2, y + h / 2
        lx, ly = cx + 40, max(30, y - 30)
        d.line([cx, cy, lx, ly], fill="black")
        d.line([lx, ly, lx + 26, ly], fill="black")
        d.text((lx + 4, ly - 18), lab, fill="black", font=font(16))
        d.text((x, y + h + 4), names, fill=(60, 60, 60), font=font(11))
    return img, pos


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("package", type=Path)
    ap.add_argument("root", type=Path, help="папка, от которой считаются uri листов (обычно папка пакета)")
    a = ap.parse_args(argv)
    pkg = json.loads(a.package.read_text(encoding="utf-8"))
    for sh in pkg.get("kd_sheets", []):
        img, pos = draw_sheet(pkg, sh)
        out = a.root / sh["uri"]
        out.parent.mkdir(parents=True, exist_ok=True)
        img.save(out)
        print(out, "positions:", json.dumps(pos, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
