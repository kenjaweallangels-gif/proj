"""Загрузка и проверка пакета операции (schemas/operation.schema.json)."""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from arcore.geometry import pose_matrix

_DEFAULT_SCHEMA = Path(__file__).resolve().parents[4] / "schemas" / "operation.schema.json"


def schema_path() -> Path:
    return Path(os.environ.get("AR_SCHEMA", _DEFAULT_SCHEMA))


def validate(data: dict) -> None:
    import jsonschema
    schema = json.loads(schema_path().read_text(encoding="utf-8"))
    jsonschema.validate(data, schema)
    _check_refs(data)


def _check_refs(data: dict) -> None:
    parts = {p["id"] for p in data["parts"]}
    fasts = {f["id"] for f in data.get("fasteners", [])}
    sheets = {k["id"] for k in data.get("kd_sheets", [])}
    errors: list[str] = []
    for f in data.get("fasteners", []):
        if f.get("part") and f["part"] not in parts:
            errors.append(f"крепёж {f['id']}: нет детали {f['part']}")
    for s in data["steps"]:
        errors += [f"шаг {s['id']}: нет детали {p}" for p in s.get("parts", []) if p not in parts]
        errors += [f"шаг {s['id']}: нет крепежа {f}" for f in s.get("fasteners", []) if f not in fasts]
        errors += [f"шаг {s['id']}: нет листа КД {k}" for k in s.get("kd", []) if k not in sheets]
    ns = [s["n"] for s in data["steps"]]
    if ns != sorted(ns) or len(set(ns)) != len(ns):
        errors.append("номера шагов должны идти по возрастанию без повторов")
    if errors:
        raise ValueError("; ".join(errors))


@dataclass(frozen=True)
class Marker:
    id: int
    dictionary: str
    size_m: float
    T_op_marker: np.ndarray


@dataclass
class Package:
    data: dict

    @property
    def op_id(self) -> str:
        return self.data["operation"]["id"]

    @property
    def steps(self) -> list[dict]:
        return self.data["steps"]

    def markers(self) -> list[Marker]:
        out = []
        for m in self.data["anchors"]["markers"]:
            T = pose_matrix(np.array(m["pose"]["position"]) / 1000.0, m["pose"].get("rotation"))
            out.append(Marker(m["id"], m["dictionary"], m["size_mm"] / 1000.0, T))
        return out

    def part(self, pid: str) -> dict:
        return next(p for p in self.data["parts"] if p["id"] == pid)

    def check_distance_m(self) -> tuple[np.ndarray, np.ndarray, float, float] | None:
        c = self.data["anchors"].get("check_distance")
        if not c:
            return None
        return np.array(c["from"]) / 1000, np.array(c["to"]) / 1000, c["nominal_mm"] / 1000, c["tol_mm"] / 1000


def load_package(path: str | Path, check: bool = True) -> Package:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if check:
        validate(data)
    return Package(data)
