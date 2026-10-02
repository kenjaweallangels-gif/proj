"""ReplayRig: воспроизведение записей сеансов в формате EuRoC (cam0/data.csv + PNG, imu0/data.csv, pose_gt.csv)."""
from __future__ import annotations

import csv
from pathlib import Path

import cv2
import numpy as np
import yaml

from arcore.hal import CameraIntrinsics, Frame, ImuSample, Pose6D, Rig


class EurocReader:
    def __init__(self, root: str | Path):
        self.root = Path(root)
        intr = yaml.safe_load((self.root / "intrinsics.yaml").read_text())
        self.K = CameraIntrinsics(intr["width"], intr["height"], intr["fx"], intr["fy"], intr["cx"], intr["cy"], tuple(intr.get("dist", [0] * 5)))
        with open(self.root / "cam0" / "data.csv") as f:
            self.frames = [(int(r[0]), r[1]) for r in csv.reader(f) if r and not r[0].startswith("#")]
        self.i = 0
        self.gt: dict[int, Pose6D] = {}
        gt = self.root / "pose_gt.csv"
        if gt.exists():
            with open(gt) as f:
                for r in csv.reader(f):
                    if r and not r[0].startswith("#"):
                        t = int(r[0])
                        self.gt[t] = Pose6D(t, np.array(r[1:4], float), np.array(r[4:8], float))
        self.imu: list[ImuSample] = []
        imu = self.root / "imu0" / "data.csv"
        if imu.exists():
            with open(imu) as f:
                for r in csv.reader(f):
                    if r and not r[0].startswith("#"):
                        self.imu.append(ImuSample(int(r[0]), np.array(r[1:4], float), np.array(r[4:7], float)))

    def next_frame(self) -> Frame | None:
        if self.i >= len(self.frames):
            return None
        t, name = self.frames[self.i]
        self.i += 1
        img = cv2.imread(str(self.root / "cam0" / "data" / name), cv2.IMREAD_COLOR)
        return Frame(t, img, self.K)

    def pose_at(self, t_ns: int) -> Pose6D | None:
        return self.gt.get(t_ns)

    def samples(self, t0_ns: int, t1_ns: int) -> list[ImuSample]:
        return [s for s in self.imu if t0_ns <= s.t_ns < t1_ns]


def make_replay_rig(path: str, **_) -> Rig:
    r = EurocReader(path)
    return Rig("replay", frames=r, poses=r, imu=r)
