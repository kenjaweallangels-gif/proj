"""Привязка изделия по меткам ArUco/AprilTag (docs/05_algorithms.md, п. 1–2)."""
from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from arcore.geometry import marker_corners
from arcore.hal import CameraIntrinsics, Frame
from arcore.io.package import Marker


@dataclass
class AnchorEstimate:
    T_cam_op: np.ndarray          # 4×4: точки СК операции → СК камеры (OpenCV)
    reproj_px: float              # средняя ошибка репроекции
    ids: list[int]
    quality: float                # 0..1

    @property
    def n_markers(self) -> int:
        return len(self.ids)


def _rt_to_T(rvec: np.ndarray, tvec: np.ndarray) -> np.ndarray:
    T = np.eye(4)
    T[:3, :3], _ = cv2.Rodrigues(rvec)
    T[:3, 3] = tvec.ravel()
    return T


class MarkerTracker:
    def __init__(self, markers: list[Marker], K: CameraIntrinsics, max_reproj_px: float = 2.5):
        if not markers:
            raise ValueError("Нет меток в пакете")
        dicts = {m.dictionary for m in markers}
        if len(dicts) != 1:
            raise ValueError(f"Все метки операции должны быть из одного словаря: {dicts}")
        d = cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, dicts.pop()))
        p = cv2.aruco.DetectorParameters()
        p.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX
        self.detector = cv2.aruco.ArucoDetector(d, p)
        self.markers = {m.id: m for m in markers}
        self.K, self.max_reproj = K, max_reproj_px
        self.Km, self.dist = K.K, np.array(K.dist, float)

    def detect(self, image: np.ndarray) -> dict[int, np.ndarray]:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
        corners, ids, _ = self.detector.detectMarkers(gray)
        out: dict[int, np.ndarray] = {}
        if ids is None:
            return out
        for c, i in zip(corners, ids.ravel()):
            if int(i) in self.markers:
                out[int(i)] = c.reshape(4, 2)
        return out

    def estimate(self, frame: Frame) -> AnchorEstimate | None:
        found = self.detect(frame.image)
        if not found:
            return None
        obj, img = [], []
        for i, c in found.items():
            m = self.markers[i]
            obj.append(marker_corners(m.T_op_marker, m.size_m))
            img.append(c)
        obj_pts = np.concatenate(obj).astype(np.float64)
        img_pts = np.concatenate(img).astype(np.float64)
        if len(found) == 1:
            ok, rvec, tvec = self._single(next(iter(found.items())))
        else:
            ok, rvec, tvec = cv2.solvePnP(obj_pts, img_pts, self.Km, self.dist, flags=cv2.SOLVEPNP_SQPNP)
            if ok:
                rvec, tvec = cv2.solvePnPRefineLM(obj_pts, img_pts, self.Km, self.dist, rvec, tvec)
        if not ok:
            return None
        proj, _ = cv2.projectPoints(obj_pts, rvec, tvec, self.Km, self.dist)
        err = float(np.mean(np.linalg.norm(proj.reshape(-1, 2) - img_pts, axis=1)))
        if err > self.max_reproj:
            return None
        q = float(np.clip(1.0 - err / self.max_reproj, 0, 1) * min(1.0, len(found) / 3))
        return AnchorEstimate(_rt_to_T(rvec, tvec), err, sorted(found), q)

    def _single(self, item: tuple[int, np.ndarray]):
        i, c = item
        m = self.markers[i]
        h = m.size_m / 2
        local = np.array([[-h, h, 0], [h, h, 0], [h, -h, 0], [-h, -h, 0]], np.float64)   # СК метки OpenCV (Z — нормаль)
        ok, rvec, tvec = cv2.solvePnP(local, c.astype(np.float64), self.Km, self.dist, flags=cv2.SOLVEPNP_IPPE_SQUARE)
        if not ok:
            return False, None, None
        T_cam_mk_cv = _rt_to_T(rvec, tvec)
        # СК метки в пакете: нормаль +Y, «верх» −Z. Переход из СК OpenCV-метки (X вправо, Y вверх, Z на нас):
        C = np.eye(4)
        C[:3, :3] = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], float)   # пакет → OpenCV-метка
        T_cam_op = T_cam_mk_cv @ C @ np.linalg.inv(m.T_op_marker)
        rv, _ = cv2.Rodrigues(T_cam_op[:3, :3])
        return True, rv, T_cam_op[:3, 3].reshape(3, 1)

    def per_marker_centers(self, frame: Frame) -> dict[int, np.ndarray]:
        """Центры меток в СК камеры по отдельности (для проверки масштаба)."""
        out = {}
        for i, c in self.detect(frame.image).items():
            ok, rv, tv = self._single((i, c))
            if ok:
                T = _rt_to_T(rv, tv) @ self.markers[i].T_op_marker
                out[i] = T[:3, 3]
        return out
