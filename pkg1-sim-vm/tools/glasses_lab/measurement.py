"""Файл замеров очков — общий для стенда (pkg1) и симулятора (pkg2-demo-web/measurements/<модель>.json).

Формат:
{
  "device": "viture-luma-ultra",           # id профиля из pkg2-demo-web/src/galley/glasses.js
  "date": "2026-11-20",                    # дата замеров
  "by": "Фамилия",                         # кто мерил
  "values": {"nits": 1320, "driftDegMin": 0.4, ...},   # поля профиля (см. FIELDS)
  "sdk": {"latencyMs": 21, "hz": 90, "trackMM": 1.2},  # поля режима «своё ПО на SDK» (см. SDK_FIELDS)
  "method": {"nits": "люксметр через линзу, белое поле 100 %"},  # как мерили
  "notes": "..."
}
Симулятор подставляет values и sdk поверх профиля и помечает эти поля как измеренные.
"""
from __future__ import annotations

import datetime as _dt
import json
from pathlib import Path

# поля профиля очков (glasses.js), которые можно измерить на стенде
FIELDS = {
    "nits": "яркость белого поля к глазу, нит",
    "fovDiag": "поле дисплея по диагонали, °",
    "transmit": "пропускание линз без затемнения, доля",
    "refresh": "частота дисплея, Гц",
    "latencyMs": "задержка «поворот головы → картинка», мс",
    "driftDegMin": "дрейф курса в покое (3DoF), °/мин",
    "weightG": "вес очков, г",
    "distM": "расстояние до виртуального экрана, м",
    "imuHz": "частота позы/IMU, Гц",
    "poseNoiseDeg": "шум позы в покое, ° СКО",
}
# поля режима «своё ПО на SDK» (software.js)
SDK_FIELDS = {
    "latencyMs": "задержка с нашим рендером, мс",
    "hz": "частота кадров нашего клиента, Гц",
    "trackMM": "дрожание позиции 6DoF, мм",
    "trackDeg": "дрожание ориентации, °",
}

REPO = Path(__file__).resolve().parents[3]
DEFAULT_DIR = REPO / "pkg2-demo-web" / "measurements"


def path_for(device: str, folder: Path = DEFAULT_DIR) -> Path:
    return Path(folder) / f"{device}.json"


def merge(device: str, values: dict | None = None, sdk: dict | None = None, method: dict | None = None,
          folder: Path = DEFAULT_DIR, by: str | None = None, date: str | None = None) -> dict:
    """Добавить замеры в файл модели (создать, если нет). Неизвестные поля — ошибка: чтобы не терять данные молча."""
    values, sdk, method = values or {}, sdk or {}, method or {}
    bad = [k for k in values if k not in FIELDS] + [f"sdk.{k}" for k in sdk if k not in SDK_FIELDS]
    if bad:
        raise ValueError(f"Неизвестные поля замеров: {', '.join(bad)}. Допустимы: {', '.join(FIELDS)}; sdk: {', '.join(SDK_FIELDS)}")
    p = path_for(device, folder)
    data = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {"device": device, "values": {}, "sdk": {}, "method": {}}
    if data.get("device") != device:
        raise ValueError(f"{p}: в файле другая модель ({data.get('device')})")
    data.setdefault("values", {}).update({k: _num(v) for k, v in values.items()})
    data.setdefault("sdk", {}).update({k: _num(v) for k, v in sdk.items()})
    data.setdefault("method", {}).update(method)
    data["date"] = date or _dt.date.today().isoformat()
    if by:
        data["by"] = by
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return data


def _num(v):
    return round(float(v), 4) if isinstance(v, (int, float)) else v
