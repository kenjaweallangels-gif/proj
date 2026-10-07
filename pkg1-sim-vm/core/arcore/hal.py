"""Контракты HAL (docs/02_hal_contracts.md). Не менять без согласования."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Iterator, Protocol

import numpy as np


@dataclass(frozen=True)
class CameraIntrinsics:
    width: int
    height: int
    fx: float
    fy: float
    cx: float
    cy: float
    dist: tuple[float, ...] = (0.0, 0.0, 0.0, 0.0, 0.0)

    @property
    def K(self) -> np.ndarray:
        return np.array([[self.fx, 0, self.cx], [0, self.fy, self.cy], [0, 0, 1]], float)

    @staticmethod
    def from_hfov(width: int, height: int, hfov_deg: float) -> "CameraIntrinsics":
        fx = width / 2 / np.tan(np.radians(hfov_deg) / 2)
        return CameraIntrinsics(width, height, fx, fx, width / 2, height / 2)


@dataclass(frozen=True)
class Frame:
    t_ns: int
    image: np.ndarray
    K: CameraIntrinsics


@dataclass(frozen=True)
class Pose6D:
    t_ns: int
    position_m: np.ndarray
    rotation_xyzw: np.ndarray


@dataclass(frozen=True)
class ImuSample:
    t_ns: int
    gyro: np.ndarray
    accel: np.ndarray


class FrameSource(Protocol):
    def next_frame(self) -> Frame | None: ...


class PoseSource(Protocol):
    def pose_at(self, t_ns: int) -> Pose6D | None: ...


class ImuSource(Protocol):
    def samples(self, t0_ns: int, t1_ns: int) -> list[ImuSample]: ...


class AudioSource(Protocol):
    def chunks(self) -> Iterator[bytes]: ...


class DisplaySink(Protocol):
    fov_diag_deg: float

    def publish(self, msg: dict) -> None: ...


@dataclass
class Rig:
    name: str
    frames: FrameSource
    poses: PoseSource | None = None
    imu: ImuSource | None = None
    audio: AudioSource | None = None
    display: DisplaySink | None = None
    meta: dict = field(default_factory=dict)


def make_rig(name: str | None = None, **cfg) -> Rig:
    """Фабрика источников. name: sim | replay | viture (по умолчанию из AR_RIG)."""
    name = name or os.environ.get("AR_RIG", "sim")
    if name == "sim":
        from arcore.rigs.sim_synthetic import make_sim_rig
        return make_sim_rig(**cfg)
    if name == "replay":
        from arcore.rigs.replay import make_replay_rig
        return make_replay_rig(**cfg)
    if name == "viture":
        from arcore.rigs.viture import make_viture_rig
        return make_viture_rig(**cfg)
    raise ValueError(f"Неизвестный источник: {name}")
