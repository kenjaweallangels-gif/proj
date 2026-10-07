"""Геометрия: кватернионы [x, y, z, w], матрицы поз 4×4, углы меток."""
from __future__ import annotations

import numpy as np


def quat_to_R(q: np.ndarray | list[float]) -> np.ndarray:
    x, y, z, w = (float(v) for v in q)
    n = np.sqrt(x * x + y * y + z * z + w * w) or 1.0
    x, y, z, w = x / n, y / n, z / n, w / n
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


def R_to_quat(R: np.ndarray) -> np.ndarray:
    t = np.trace(R)
    if t > 0:
        s = np.sqrt(t + 1.0) * 2
        w, x, y, z = 0.25 * s, (R[2, 1] - R[1, 2]) / s, (R[0, 2] - R[2, 0]) / s, (R[1, 0] - R[0, 1]) / s
    elif R[0, 0] > R[1, 1] and R[0, 0] > R[2, 2]:
        s = np.sqrt(1.0 + R[0, 0] - R[1, 1] - R[2, 2]) * 2
        w, x, y, z = (R[2, 1] - R[1, 2]) / s, 0.25 * s, (R[0, 1] + R[1, 0]) / s, (R[0, 2] + R[2, 0]) / s
    elif R[1, 1] > R[2, 2]:
        s = np.sqrt(1.0 + R[1, 1] - R[0, 0] - R[2, 2]) * 2
        w, x, y, z = (R[0, 2] - R[2, 0]) / s, (R[0, 1] + R[1, 0]) / s, 0.25 * s, (R[1, 2] + R[2, 1]) / s
    else:
        s = np.sqrt(1.0 + R[2, 2] - R[0, 0] - R[1, 1]) * 2
        w, x, y, z = (R[1, 0] - R[0, 1]) / s, (R[0, 2] + R[2, 0]) / s, (R[1, 2] + R[2, 1]) / s, 0.25 * s
    q = np.array([x, y, z, w])
    return q / np.linalg.norm(q)


def pose_matrix(position: np.ndarray | list[float], rotation_xyzw: np.ndarray | list[float] | None = None) -> np.ndarray:
    T = np.eye(4)
    T[:3, :3] = quat_to_R(rotation_xyzw if rotation_xyzw is not None else [0, 0, 0, 1])
    T[:3, 3] = np.asarray(position, float)
    return T


def look_at(eye: np.ndarray, target: np.ndarray, up: np.ndarray = np.array([0.0, 1.0, 0.0])) -> np.ndarray:
    """Поза камеры OpenCV (X вправо, Y вниз, Z вперёд) в мировой СК: T_world_cam."""
    z = target - eye
    z = z / np.linalg.norm(z)
    x = np.cross(z, -up)
    if np.linalg.norm(x) < 1e-6:
        x = np.array([1.0, 0.0, 0.0])
    x = x / np.linalg.norm(x)
    y = np.cross(z, x)
    T = np.eye(4)
    T[:3, 0], T[:3, 1], T[:3, 2], T[:3, 3] = x, y, z, eye
    return T


def marker_corners(T_op_marker: np.ndarray, size: float) -> np.ndarray:
    """4 угла метки в СК операции (порядок OpenCV ArUco: ЛВ, ПВ, ПН, ЛН).

    Метка лежит в плоскости XZ своей СК, нормаль +Y. «Верх» метки направлен в −Z.
    """
    h = size / 2.0
    local = np.array([[-h, 0, -h, 1], [h, 0, -h, 1], [h, 0, h, 1], [-h, 0, h, 1]], float)
    return (T_op_marker @ local.T).T[:, :3]


def rotation_angle_deg(Ra: np.ndarray, Rb: np.ndarray) -> float:
    R = Ra.T @ Rb
    c = np.clip((np.trace(R) - 1) / 2, -1.0, 1.0)
    return float(np.degrees(np.arccos(c)))
