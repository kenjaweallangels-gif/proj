"""Камера очков (UVC): разрешение, частота кадров, метки ArUco в кадре. Кадры не сохраняются (AGENTS.md, п. 8).

    python -m glasses_lab.camera_check --list                 # какие камеры видит OpenCV
    python -m glasses_lab.camera_check --cam 1 --seconds 10   # частота кадров и метки

RGB-камера VITURE Luma Ultra отдаётся как UVC 1920×1080, 30 к/с, MJPEG (документация VITURE SDK) — работает без SDK.
XREAL Eye подключается к очкам XREAL и на ПК как UVC, скорее всего, не видна (кадры — через XREAL SDK на Beam Pro): проверить.
"""
from __future__ import annotations

import argparse
import statistics
import time


def fps_stats(ts: list[float]) -> dict:
    """Частота кадров по меткам времени (секунды): медиана, минимум за окно, рывки (> 2 медианных интервалов)."""
    if len(ts) < 3:
        return {"fps": 0.0, "frames": len(ts), "stalls": 0, "worst_ms": 0.0}
    dt = [b - a for a, b in zip(ts, ts[1:])]
    med = statistics.median(dt)
    return {"fps": round(1 / med, 2) if med > 0 else 0.0, "frames": len(ts), "stalls": sum(1 for d in dt if d > 2 * med),
            "worst_ms": round(max(dt) * 1000, 1)}


def run(cam: int | str, seconds: float, width: int, height: int, mjpg: bool, aruco_dict: str) -> dict:
    import cv2

    cap = cv2.VideoCapture(cam)
    if mjpg:
        cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
    if not cap.isOpened():
        raise SystemExit(f"Камера {cam} не открылась. Список: --list")
    det = cv2.aruco.ArucoDetector(cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, aruco_dict)), cv2.aruco.DetectorParameters())
    ts, ids_seen, frames_with = [], set(), 0
    w = h = 0
    t_end = time.monotonic() + seconds
    while time.monotonic() < t_end:
        ok, img = cap.read()
        if not ok:
            break
        ts.append(time.monotonic())
        h, w = img.shape[:2]
        if len(ts) % 5 == 0:                                   # метки — каждый 5-й кадр, чтобы не тормозить замер частоты
            _, ids, _ = det.detectMarkers(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
            if ids is not None:
                frames_with += 1
                ids_seen.update(int(i) for i in ids.flatten())
    cap.release()
    res = fps_stats(ts) | {"w": w, "h": h, "markers": sorted(ids_seen), "frames_with_markers": frames_with}
    return res


def main(argv=None):
    ap = argparse.ArgumentParser(description="Проверка камеры очков")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--cam", default="0", help="индекс или путь (/dev/video2)")
    ap.add_argument("--seconds", type=float, default=10)
    ap.add_argument("--width", type=int, default=1920)
    ap.add_argument("--height", type=int, default=1080)
    ap.add_argument("--no-mjpg", action="store_true")
    ap.add_argument("--dict", default="DICT_6X6_250", help="словарь ArUco (как у меток стапеля)")
    a = ap.parse_args(argv)
    if a.list:
        from glasses_lab.detect import cameras
        for c in cameras():
            print(f"камера #{c['index']}: {c['w']}×{c['h']}")
        return
    cam = int(a.cam) if a.cam.isdigit() else a.cam
    r = run(cam, a.seconds, a.width, a.height, not a.no_mjpg, a.dict)
    print(f"{r['w']}×{r['h']} · {r['fps']} к/с · кадров {r['frames']} · рывков {r['stalls']} (худший {r['worst_ms']} мс)")
    print(f"Метки ArUco: {r['markers'] or 'не найдены'} (в {r['frames_with_markers']} проверенных кадрах)")
    return r


if __name__ == "__main__":
    main()
