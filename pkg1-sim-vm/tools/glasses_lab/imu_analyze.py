"""Анализ записи позы головы (CSV из pose_bridge.py --record): частота, рывки, дрейф курса, шум.

    python -m glasses_lab.imu_analyze rec/still.csv --still                    # очки лежат неподвижно 3–5 мин
    python -m glasses_lab.imu_analyze rec/still.csv --still --save viture-luma-ultra   # → measurements/<модель>.json

Что считается:
  * частота позы (медиана интервала), неравномерность (СКО интервала), пропуски (> 3 медианных интервалов);
  * в покое (--still): дрейф курса, °/мин (наклон прямой по курсу) и шум ориентации, ° СКО вокруг прямой.
Дрейф — то, из-за чего у 3DoF-очков окна «уплывают» (в симуляторе — driftDegMin профиля).
"""
from __future__ import annotations

import argparse
import json
import math
import statistics

from glasses_lab.measurement import merge
from glasses_lab.pose_bridge import load_csv, ypr_from_quat


def _unwrap(a: list[float]) -> list[float]:
    out, off = [], 0.0
    for i, v in enumerate(a):
        if i:
            d = v + off - out[-1]
            if d > math.pi:
                off -= 2 * math.pi
            elif d < -math.pi:
                off += 2 * math.pi
        out.append(v + off)
    return out


def _linfit(x: list[float], y: list[float]) -> tuple[float, float]:
    mx, my = statistics.fmean(x), statistics.fmean(y)
    sxx = sum((a - mx) ** 2 for a in x) or 1e-12
    k = sum((a - mx) * (b - my) for a, b in zip(x, y)) / sxx
    return k, my - k * mx


def analyze(rows: list[tuple], still: bool = False) -> dict:
    if len(rows) < 3:
        raise ValueError("В записи меньше трёх строк")
    t = [r[0] for r in rows]
    dt = [(b - a) / 1e6 for a, b in zip(t, t[1:])]                  # мс
    med = statistics.median(dt)
    res = {
        "samples": len(rows), "duration_s": round((t[-1] - t[0]) / 1e9, 2),
        "rate_hz": round(1000 / med, 1) if med > 0 else 0.0,
        "interval_ms": round(med, 3), "jitter_ms": round(statistics.pstdev(dt), 3),
        "gaps": sum(1 for d in dt if d > 3 * med),
    }
    if still:
        ts = [(v - t[0]) / 1e9 for v in t]
        ypr = [ypr_from_quat(r[1:5]) for r in rows]
        yaw = _unwrap([a[0] for a in ypr])
        k, b = _linfit(ts, yaw)
        resid = [y - (k * x + b) for x, y in zip(ts, yaw)]
        pitch = [a[1] for a in ypr]
        pm = statistics.fmean(pitch)
        noise = math.sqrt(statistics.fmean([r * r for r in resid]) / 2 + statistics.fmean([(p - pm) ** 2 for p in pitch]) / 2)
        res["drift_deg_min"] = round(abs(math.degrees(k)) * 60, 3)
        res["noise_deg"] = round(math.degrees(noise), 4)
    return res


def to_measurement(res: dict) -> dict:
    """Поля файла замеров (measurement.FIELDS) из результата анализа."""
    v = {"imuHz": res["rate_hz"]}
    if "drift_deg_min" in res:
        v["driftDegMin"] = res["drift_deg_min"]
        v["poseNoiseDeg"] = res["noise_deg"]
    return v


def report(res: dict) -> str:
    s = (f"Записей {res['samples']} за {res['duration_s']} с · частота {res['rate_hz']} Гц (интервал {res['interval_ms']} мс, "
         f"СКО {res['jitter_ms']} мс, пропусков {res['gaps']})")
    if "drift_deg_min" in res:
        s += f"\nВ покое: дрейф курса {res['drift_deg_min']} °/мин · шум ориентации {res['noise_deg']}° СКО"
    return s


def main(argv=None):
    ap = argparse.ArgumentParser(description="Анализ записи позы головы")
    ap.add_argument("csv")
    ap.add_argument("--still", action="store_true", help="запись в покое: считать дрейф и шум")
    ap.add_argument("--save", metavar="DEVICE", help="записать в pkg2-demo-web/measurements/<DEVICE>.json")
    ap.add_argument("--by", help="кто мерил")
    a = ap.parse_args(argv)
    res = analyze(load_csv(a.csv), still=a.still)
    print(report(res))
    if a.save:
        data = merge(a.save, values=to_measurement(res), by=a.by,
                     method={k: f"imu_analyze {a.csv}{' (покой)' if a.still else ''}" for k in to_measurement(res)})
        print(f"Сохранено в measurements/{a.save}.json: {json.dumps(data['values'], ensure_ascii=False)}")
    return res


if __name__ == "__main__":
    main()
