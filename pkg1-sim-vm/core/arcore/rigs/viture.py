"""VitureRig: реальные очки VITURE Luma Ultra.

Статус: ЗАГЛУШКА до получения VITURE XR Glasses SDK (C, закрытый, через https://www.viture.com/developer).
Что известно (docs/02_hal_contracts.md):
  * RGB-камера 1080p выдаётся как UVC-устройство (MJPEG) — её можно читать через cv2.VideoCapture уже сейчас;
  * 6DoF-поза — через C API SDK («Carina»), пример стороннего использования:
    https://github.com/brianhasquestions/Viture_AR_Playground
Задача для ИИ (prompts/11_viture_rig.md): положить заголовки SDK в vendor/viture/, написать обёртку ctypes/cffi,
НЕ выдумывая имена функций — только из заголовков.
"""
from __future__ import annotations

import os
import time

import cv2

from arcore.hal import CameraIntrinsics, Frame, Pose6D, Rig


class UvcCamera:
    def __init__(self, device: str | int = 0, width: int = 1920, height: int = 1080, hfov_deg: float = 80.0):
        self.cap = cv2.VideoCapture(device, cv2.CAP_V4L2)
        self.cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
        if not self.cap.isOpened():
            raise RuntimeError(f"Камера {device} не открылась. Проверьте: v4l2-ctl --list-devices")
        # До калибровки — оценка по полю зрения. После: загрузить из calib/viture_cam.yaml
        self.K = CameraIntrinsics.from_hfov(width, height, hfov_deg)

    def next_frame(self) -> Frame | None:
        ok, img = self.cap.read()
        return Frame(time.monotonic_ns(), img, self.K) if ok else None


class VitureSdkPose:
    def __init__(self):
        raise NotImplementedError(
            "6DoF из VITURE SDK не подключён: получите SDK, положите заголовки в vendor/viture/ "
            "и выполните prompts/11_viture_rig.md")

    def pose_at(self, t_ns: int) -> Pose6D | None:  # pragma: no cover
        return None


def make_viture_rig(camera: str | int | None = None, **_) -> Rig:
    dev = camera if camera is not None else os.environ.get("AR_CAMERA", 0)
    cam = UvcCamera(int(dev) if str(dev).isdigit() else dev)
    try:
        pose = VitureSdkPose()
    except NotImplementedError as e:
        print("[viture]", e)
        pose = None
    return Rig("viture", frames=cam, poses=pose)
