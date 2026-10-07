#!/usr/bin/env python3
"""Таблицы технолога (CSV из Excel, разделитель «;», UTF-8) → пакет операции JSON.

    python tools/tp_csv_to_json.py ../data/examples/op040_csv out/op040.json

Ожидаемые файлы в папке (образец — data/examples/op040_csv):
  operation.csv  key;value  — id, title, product, revision, workplace, units, reference_frame,
                              model_id, model_uri, model_note, check_from, check_to ("x,y,z"), check_nominal_mm, check_tol_mm
  markers.csv    id;dictionary;size_mm;x;y;z;qx;qy;qz;qw;note
  parts.csv      id;designation;name;model;node;fallback_type;fx;fy;fz;color;tx;ty;tz;qx;qy;qz;qw;
                 source_kind;source_cell;sx;sy;sz;kd_sheet;kd_pos;mass_kg
  fasteners.csv  id;type;designation;part;x;y;z;ax;ay;az;torque_nm;lock;new_only
  steps.csv      n;id;title;kind;parts;fasteners;tool;torque_nm;gap_mm;check_type;check_nominal_mm;check_tol_mm;
                 check_text;critical;confirm;norm_s;kd;notes
  kd_sheets.csv  id;uri;title;positions (JSON {"поз": [x, y, w, h]})
Пустая ячейка = поле не задано. Списки — через запятую. Десятичный разделитель — точка или запятая.
Результат проверяется схемой и ссылками (arcore.io.package.validate).
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "core"))
from arcore.io.package import validate  # noqa: E402

YES = {"да", "yes", "true", "1", "+"}


def num(v: str):
    v = v.strip().replace(",", ".")
    if v == "":
        return None
    f = float(v)
    return int(f) if f.is_integer() and "." not in v else f


def vec(row: dict, *keys: str) -> list:
    return [num(row[k]) for k in keys]


def lst(v: str) -> list[str]:
    return [x.strip() for x in v.split(",") if x.strip()]


def read(folder: Path, name: str, required: bool = True) -> list[dict]:
    p = folder / name
    if not p.exists():
        if required:
            raise FileNotFoundError(p)
        return []
    with open(p, encoding="utf-8-sig", newline="") as f:
        return [{k.strip(): (v or "").strip() for k, v in r.items()} for r in csv.DictReader(f, delimiter=";")
                if any((v or "").strip() for v in r.values())]


def put(d: dict, key: str, value) -> None:
    if value not in (None, "", [], {}):
        d[key] = value


def build(folder: str | Path) -> dict:
    folder = Path(folder)
    op = {r["key"]: r["value"] for r in read(folder, "operation.csv")}

    operation = {k: op[k] for k in ("id", "title", "product", "revision", "workplace", "units") if op.get(k)}
    operation.setdefault("units", "mm")

    models = []
    if op.get("model_id"):
        m = {"id": op["model_id"], "uri": op["model_uri"]}
        put(m, "note", op.get("model_note"))
        models.append(m)

    markers = []
    for r in read(folder, "markers.csv"):
        m = {"id": int(r["id"]), "dictionary": r["dictionary"], "size_mm": num(r["size_mm"]),
             "pose": {"position": vec(r, "x", "y", "z"), "rotation": vec(r, "qx", "qy", "qz", "qw")}}
        put(m, "note", r.get("note"))
        markers.append(m)
    anchors = {"reference_frame": op.get("reference_frame", "fixture"), "markers": markers}
    if op.get("check_from"):
        anchors["check_distance"] = {"from": [num(x) for x in op["check_from"].split(",")],
                                     "to": [num(x) for x in op["check_to"].split(",")],
                                     "nominal_mm": num(op["check_nominal_mm"]), "tol_mm": num(op["check_tol_mm"])}

    parts = []
    for r in read(folder, "parts.csv"):
        p = {"id": r["id"], "designation": r["designation"], "name": r["name"]}
        put(p, "model", r.get("model"))
        put(p, "node", r.get("node"))
        if r.get("fallback_type"):
            fb = {"type": r["fallback_type"], "size_mm": vec(r, "fx", "fy", "fz")}
            put(fb, "color", r.get("color"))
            p["fallback"] = fb
        p["target"] = {"position": vec(r, "tx", "ty", "tz"), "rotation": vec(r, "qx", "qy", "qz", "qw")}
        if r.get("source_kind"):
            src = {"kind": r["source_kind"]}
            put(src, "cell", r.get("source_cell"))
            if r.get("sx"):
                src["position"] = vec(r, "sx", "sy", "sz")
            p["source"] = src
        if r.get("kd_sheet"):
            p["kd"] = {"sheet": r["kd_sheet"], "position": r["kd_pos"]}
        put(p, "mass_kg", num(r.get("mass_kg", "")))
        parts.append(p)

    fasteners = []
    for r in read(folder, "fasteners.csv", required=False):
        f = {"id": r["id"], "type": r["type"], "designation": r["designation"]}
        put(f, "part", r.get("part"))
        f["position"] = vec(r, "x", "y", "z")
        f["axis"] = vec(r, "ax", "ay", "az")
        put(f, "torque_nm", num(r.get("torque_nm", "")))
        put(f, "lock", r.get("lock"))
        if r.get("new_only", "").lower() in YES:
            f["new_only"] = True
        fasteners.append(f)

    kd_sheets = []
    for r in read(folder, "kd_sheets.csv", required=False):
        k = {"id": r["id"], "uri": r["uri"], "title": r["title"]}
        if r.get("positions"):
            k["positions"] = json.loads(r["positions"])
        kd_sheets.append(k)

    steps = []
    for r in read(folder, "steps.csv"):
        s = {"id": r["id"], "n": int(r["n"]), "title": r["title"], "kind": r["kind"]}
        put(s, "parts", lst(r.get("parts", "")))
        put(s, "fasteners", lst(r.get("fasteners", "")))
        put(s, "tool", r.get("tool"))
        params = {}
        put(params, "torque_nm", num(r.get("torque_nm", "")))
        put(params, "gap_mm", num(r.get("gap_mm", "")))
        put(s, "params", params)
        if r.get("check_type"):
            chk = {"type": r["check_type"]}
            put(chk, "nominal_mm", num(r.get("check_nominal_mm", "")))
            put(chk, "tol_mm", num(r.get("check_tol_mm", "")))
            put(chk, "text", r.get("check_text"))
            s["check"] = chk
        if r.get("critical", "").lower() in YES:
            s["critical"] = True
        s["confirm"] = r.get("confirm") or "voice"
        put(s, "norm_s", num(r.get("norm_s", "")))
        put(s, "kd", lst(r.get("kd", "")))
        put(s, "notes", r.get("notes"))
        steps.append(s)

    pkg = {"schema_version": "1.0", "operation": operation}
    put(pkg, "models", models)
    pkg.update({"anchors": anchors, "parts": parts})
    put(pkg, "fasteners", fasteners)
    put(pkg, "kd_sheets", kd_sheets)
    pkg["steps"] = steps
    return pkg


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("folder")
    ap.add_argument("out")
    a = ap.parse_args(argv)
    pkg = build(a.folder)
    try:
        validate(pkg)
    except Exception as e:
        print(f"ОШИБКА пакета: {getattr(e, 'message', e)}", file=sys.stderr)
        return 1
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(pkg, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"OK: {a.out} — шагов {len(pkg['steps'])}, деталей {len(pkg['parts'])}, крепежа {len(pkg.get('fasteners', []))}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
