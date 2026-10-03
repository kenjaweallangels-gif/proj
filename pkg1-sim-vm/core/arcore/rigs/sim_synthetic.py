"""SimRig: синтетическая камера очков.

Рендерит метки пакета операции (плоские квадраты) с известной позой головы, добавляет помехи цеха
(размытие, шум, гамма, блик, перекрытие) и отдаёт кадры через FrameSource, а истинную позу — через PoseSource.
Этого достаточно, чтобы разрабатывать и тестировать трекинг без 3D-движка. Полноценная 3D-сцена
рабочего места — в Godot (pkg1-sim-vm/godot), она отдаёт кадры через v4l2loopback или UDP.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import cv2
import numpy as np

from arcore.geometry import R_to_quat, look_at, marker_corners
from arcore.hal import CameraIntrinsics, Frame, Pose6D, Rig
from arcore.io.package import Marker, Package, load_package


@dataclass
class Disturbance:
    blur_px: tuple[float, float] = (0.0, 2.5)
    noise_sigma: tuple[float, float] = (0.0, 5.0)
    gamma: tuple[float, float] = (0.8, 1.3)
    glare_prob: float = 0.3
    occlusion_prob: float = 0.15


@dataclass
class HeadTrajectory:
    """Голова сборщика: медленный обход вокруг центра изделия с покачиванием."""
    center: np.ndarray = field(default_factory=lambda: np.array([0.0, 0.0, 0.0]))
    radius: tuple[float, float] = (0.55, 0.85)
    height: tuple[float, float] = (0.45, 0.7)
    yaw_range_deg: tuple[float, float] = (-35.0, 35.0)
    base_yaw_deg: float = 0.0
    period_s: float = 20.0

    def T_world_cam(self, t: float) -> np.ndarray:
        u = 0.5 + 0.5 * math.sin(2 * math.pi * t / self.period_s)
        yaw = math.radians(self.base_yaw_deg + self.yaw_range_deg[0] + (self.yaw_range_deg[1] - self.yaw_range_deg[0]) * u)
        r = self.radius[0] + (self.radius[1] - self.radius[0]) * (0.5 + 0.5 * math.sin(2 * math.pi * t / (self.period_s * 0.7)))
        h = self.height[0] + (self.height[1] - self.height[0]) * (0.5 + 0.5 * math.cos(2 * math.pi * t / (self.period_s * 1.3)))
        eye = self.center + np.array([r * math.sin(yaw), h, r * math.cos(yaw)])
        target = self.center + np.array([0.03 * math.sin(t * 1.7), 0.0, 0.03 * math.cos(t * 1.3)])
        return look_at(eye, target)


MARKER_PX, MARKER_PAD = 240, 40     # белое поле вокруг метки (quiet zone) = 1/6 стороны


def _marker_image(m: Marker) -> np.ndarray:
    d = cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, m.dictionary))
    img = cv2.aruco.generateImageMarker(d, m.id, MARKER_PX)
    return cv2.copyMakeBorder(img, MARKER_PAD, MARKER_PAD, MARKER_PAD, MARKER_PAD, cv2.BORDER_CONSTANT, value=255)


def _background(w: int, h: int, rng: np.random.Generator) -> np.ndarray:
    base = rng.normal(110, 18, (h // 8, w // 8)).astype(np.float32)
    base = cv2.resize(base, (w, h), interpolation=cv2.INTER_CUBIC)
    img = np.clip(base, 0, 255).astype(np.uint8)
    img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    for _ in range(12):
        p1 = tuple(int(v) for v in rng.integers(0, [w, h]))
        p2 = tuple(int(v) for v in rng.integers(0, [w, h]))
        cv2.line(img, p1, p2, tuple(int(v) for v in rng.integers(60, 160, 3)), int(rng.integers(1, 4)))
    return img


class SyntheticCamera:
    def __init__(self, package: Package, K: CameraIntrinsics, trajectory: HeadTrajectory | None = None,
                 n_frames: int = 200, fps: float = 30.0, seed: int = 0, disturb: Disturbance | None = None,
                 size_scale: float = 1.0):
        self.pkg, self.K = package, K
        self.markers = package.markers()
        self.traj = trajectory or HeadTrajectory()
        self.n, self.fps, self.i = n_frames, fps, 0
        self.rng = np.random.default_rng(seed)
        self.disturb = disturb
        self.size_scale = size_scale        # ≠1 — имитация меток, напечатанных не в масштабе
        self.tex = {m.id: _marker_image(m) for m in self.markers}
        self.bg = _background(K.width, K.height, self.rng)
        self.gt: dict[int, np.ndarray] = {}

    # --- FrameSource ---
    def next_frame(self) -> Frame | None:
        if self.n and self.i >= self.n:
            return None
        t = self.i / self.fps
        t_ns = int(t * 1e9)
        T_wc = self.traj.T_world_cam(t)
        self.gt[t_ns] = T_wc
        img = self.render(T_wc)
        self.i += 1
        return Frame(t_ns, img, self.K)

    # --- PoseSource (истина) ---
    def pose_at(self, t_ns: int) -> Pose6D | None:
        T = self.gt.get(t_ns)
        if T is None:
            return None
        return Pose6D(t_ns, T[:3, 3].copy(), R_to_quat(T[:3, :3]))

    def render(self, T_world_cam: np.ndarray) -> np.ndarray:
        K = self.K.K
        img = self.bg.copy()
        T_cw = np.linalg.inv(T_world_cam)
        for m in self.markers:
            tex = self.tex[m.id]
            full = m.size_m * self.size_scale * (MARKER_PX + 2 * MARKER_PAD) / MARKER_PX
            corners_w = marker_corners(m.T_op_marker, full)
            pc = (T_cw @ np.c_[corners_w, np.ones(4)].T).T[:, :3]
            if np.any(pc[:, 2] < 0.05):
                continue
            uv = (K @ pc.T).T
            uv = (uv[:, :2] / uv[:, 2:3]).astype(np.float32)
            s = tex.shape[0] - 1
            H = cv2.getPerspectiveTransform(np.float32([[0, 0], [s, 0], [s, s], [0, s]]), uv)
            warped = cv2.warpPerspective(tex, H, (self.K.width, self.K.height), flags=cv2.INTER_LINEAR, borderValue=0)
            mask = cv2.warpPerspective(np.full_like(tex, 255), H, (self.K.width, self.K.height), flags=cv2.INTER_LINEAR)
            m3 = (mask.astype(np.float32) / 255.0)[..., None]
            img = (img * (1 - m3) + cv2.cvtColor(warped, cv2.COLOR_GRAY2BGR) * m3).astype(np.uint8)
        if self.disturb:
            img = self._disturb(img)
        return img

    def _disturb(self, img: np.ndarray) -> np.ndarray:
        d, r = self.disturb, self.rng
        g = r.uniform(*d.gamma)
        img = np.clip(255.0 * (img / 255.0) ** g, 0, 255).astype(np.uint8)
        if r.random() < d.glare_prob:
            ov = np.zeros_like(img)
            c = (int(r.integers(0, img.shape[1])), int(r.integers(0, img.shape[0])))
            cv2.ellipse(ov, c, (int(r.integers(60, 200)), int(r.integers(30, 120))), float(r.uniform(0, 180)), 0, 360, (255, 255, 255), -1)
            ov = cv2.GaussianBlur(ov, (0, 0), 25)
            img = cv2.addWeighted(img, 1.0, ov, 0.45, 0)
        if r.random() < d.occlusion_prob:
            x, y = int(r.integers(0, img.shape[1] - 120)), int(r.integers(0, img.shape[0] - 120))
            cv2.rectangle(img, (x, y), (x + int(r.integers(40, 120)), y + int(r.integers(40, 120))), (205, 200, 195), -1)
        b = r.uniform(*d.blur_px)
        if b > 0.3:
            img = cv2.GaussianBlur(img, (0, 0), b)
        n = r.uniform(*d.noise_sigma)
        if n > 0.1:
            img = np.clip(img + r.normal(0, n, img.shape), 0, 255).astype(np.uint8)
        return img


def make_sim_rig(package_path: str | None = None, width: int = 1280, height: int = 720, hfov_deg: float = 80.0,
                 n_frames: int = 200, seed: int = 0, disturb: bool = True, **_) -> Rig:
    import os
    path = package_path or os.environ.get("AR_PACKAGE")
    if not path:
        raise ValueError("Укажите пакет операции: package_path или AR_PACKAGE")
    pkg = load_package(path)
    K = CameraIntrinsics.from_hfov(width, height, hfov_deg)
    cam = SyntheticCamera(pkg, K, n_frames=n_frames, seed=seed, disturb=Disturbance() if disturb else None)
    return Rig("sim", frames=cam, poses=cam, meta={"package": pkg, "camera": cam})
