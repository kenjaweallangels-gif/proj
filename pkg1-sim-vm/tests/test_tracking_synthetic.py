"""Пороговые тесты привязки на синтетике (docs/06_testing.md). Пороги менять только вместе с документом."""
import numpy as np
import pytest

from arcore.geometry import rotation_angle_deg
from arcore.hal import CameraIntrinsics
from arcore.io.package import load_package
from arcore.rigs.sim_synthetic import Disturbance, SyntheticCamera
from arcore.tracking.aruco import MarkerTracker
from arcore.tracking.registration import ScaleMonitor

K = CameraIntrinsics.from_hfov(1280, 720, 80)


def run(pkg, n=60, disturb=None, size_scale=1.0, seed=0):
    cam = SyntheticCamera(pkg, K, n_frames=n, seed=seed, disturb=disturb, size_scale=size_scale)
    tr = MarkerTracker(pkg.markers(), K)
    pos, ang, found = [], [], 0
    sm = ScaleMonitor({m.id: m.T_op_marker[:3, 3] for m in pkg.markers()})
    while (f := cam.next_frame()) is not None:
        sm.add(tr.per_marker_centers(f))       # масштаб — независимо от общей позы (при неверной печати она отбрасывается)
        est = tr.estimate(f)
        if est is None:
            continue
        found += 1
        T_true = np.linalg.inv(cam.gt[f.t_ns])
        pos.append(np.linalg.norm(est.T_cam_op[:3, 3] - T_true[:3, 3]) * 1000)
        ang.append(rotation_angle_deg(est.T_cam_op[:3, :3], T_true[:3, :3]))
    return found / n, np.array(pos), np.array(ang), sm.verdict


@pytest.fixture(scope="module")
def pkg040():
    from conftest import EXAMPLES
    return load_package(EXAMPLES / "op040_shelf_bench.json")


def test_clean_accuracy(pkg040):
    rate, pos, ang, verdict = run(pkg040)
    assert rate >= 0.95
    assert np.median(pos) <= 2.0          # мм
    assert np.median(ang) <= 0.5          # градусы
    assert verdict is not None and verdict[0]


def test_disturbed_accuracy(pkg040):
    rate, pos, ang, _ = run(pkg040, disturb=Disturbance(), seed=3)
    assert rate >= 0.8
    assert np.median(pos) <= 3.0
    assert np.percentile(pos, 95) <= 10.0


def test_wrong_print_scale_detected(pkg040):
    _, _, _, verdict = run(pkg040, size_scale=1.1)
    assert verdict is not None
    ok, s = verdict
    assert not ok and s < 0.95


def test_single_marker_consistent(pkg040):
    """Поза по одной метке (IPPE) согласуется с позой по всем меткам."""
    cam = SyntheticCamera(pkg040, K, n_frames=5)
    tr = MarkerTracker(pkg040.markers(), K)
    f = cam.next_frame()
    found = tr.detect(f.image)
    ok, rv, tv = tr._single(next(iter(found.items())))
    T_true = np.linalg.inv(cam.gt[f.t_ns])
    assert ok and np.linalg.norm(tv.ravel() - T_true[:3, 3]) < 0.03
