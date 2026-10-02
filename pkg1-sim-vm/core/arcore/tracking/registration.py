"""Проверка масштаба и сглаживание позы."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from arcore.geometry import R_to_quat, quat_to_R


def umeyama_scale(src: np.ndarray, dst: np.ndarray) -> float:
    """Масштаб s в dst ≈ s·R·src + t (Umeyama 1991). src, dst — N×3, N ≥ 3."""
    mu_s, mu_d = src.mean(0), dst.mean(0)
    xs, xd = src - mu_s, dst - mu_d
    cov = xd.T @ xs / len(src)
    U, S, Vt = np.linalg.svd(cov)
    D = np.eye(3)
    if np.linalg.det(U) * np.linalg.det(Vt) < 0:
        D[2, 2] = -1
    var_s = (xs ** 2).sum() / len(src)
    return float(np.trace(np.diag(S) @ D) / var_s)


@dataclass
class ScaleCheck:
    scale: float
    worst_pair_err_mm: float
    ok: bool


def check_scale(nominal_centers: dict[int, np.ndarray], measured_centers: dict[int, np.ndarray],
                tol_mm: float = 2.0) -> ScaleCheck | None:
    ids = sorted(set(nominal_centers) & set(measured_centers))
    if len(ids) < 2:
        return None
    worst = 0.0
    for a in range(len(ids)):
        for b in range(a + 1, len(ids)):
            dn = np.linalg.norm(nominal_centers[ids[a]] - nominal_centers[ids[b]])
            dm = np.linalg.norm(measured_centers[ids[a]] - measured_centers[ids[b]])
            worst = max(worst, abs(dm - dn) * 1000)
    s = umeyama_scale(np.array([nominal_centers[i] for i in ids]), np.array([measured_centers[i] for i in ids])) if len(ids) >= 3 else float("nan")
    return ScaleCheck(s, float(worst), bool(worst <= tol_mm))


class ScaleMonitor:
    """Накопление оценок масштаба по кадрам. Одиночная метка 80 мм на 0,7 м даёт разброс расстояний 10–25 мм
    за кадр, поэтому решение принимается по медиане Umeyama-масштаба за n кадров (≥3 метки в кадре).
    Метки, напечатанные с масштабом 0,97 или 1,03 и хуже, ловятся уверенно (замер на синтетике: 1,006 против 0,912 при 110 %)."""

    def __init__(self, nominal_centers: dict[int, np.ndarray], n: int = 15, rel_tol: float = 0.03):
        self.nominal, self.n, self.rel_tol = nominal_centers, n, rel_tol
        self.scales: list[float] = []

    def add(self, measured_centers: dict[int, np.ndarray]) -> None:
        r = check_scale(self.nominal, measured_centers, tol_mm=1e9)
        if r is not None and np.isfinite(r.scale):
            self.scales.append(r.scale)

    @property
    def verdict(self) -> tuple[bool, float] | None:
        """None — данных мало; (ok, медианный масштаб). Масштаб ≠ 1 → метки напечатаны не в размер."""
        if len(self.scales) < self.n:
            return None
        s = float(np.median(self.scales))
        return bool(abs(s - 1.0) <= self.rel_tol), s


class PoseFilter:
    """Экспоненциальное сглаживание позиции и SLERP поворота; α растёт с качеством."""

    def __init__(self, alpha_min: float = 0.15, alpha_max: float = 0.6):
        self.amin, self.amax = alpha_min, alpha_max
        self.T: np.ndarray | None = None

    def update(self, T: np.ndarray, quality: float) -> np.ndarray:
        if self.T is None:
            self.T = T.copy()
            return self.T
        a = self.amin + (self.amax - self.amin) * float(np.clip(quality, 0, 1))
        p = (1 - a) * self.T[:3, 3] + a * T[:3, 3]
        q0, q1 = R_to_quat(self.T[:3, :3]), R_to_quat(T[:3, :3])
        if np.dot(q0, q1) < 0:
            q1 = -q1
        q = (1 - a) * q0 + a * q1
        q /= np.linalg.norm(q)
        out = np.eye(4)
        out[:3, :3], out[:3, 3] = quat_to_R(q), p
        self.T = out
        return out
