"""Стенд очков: разбор USB-списков, кватернионы, запись/повтор позы, анализ дрейфа, файл замеров."""
import asyncio
import json
import math

import pytest

from glasses_lab import detect, imu_analyze, measurement, pose_bridge as pb
from glasses_lab.camera_check import fps_stats


def test_linux_sysfs(tmp_path):
    for name, vid, pid, prod in [("1-1", "35ca", "101d", "VITURE Luma Ultra"), ("1-2", "046d", "c52b", "Receiver")]:
        d = tmp_path / name
        d.mkdir()
        (d / "idVendor").write_text(vid + "\n")
        (d / "idProduct").write_text(pid + "\n")
        (d / "product").write_text(prod + "\n")
    g = detect.classify(detect.parse_linux_sysfs(tmp_path))
    assert [(x["brand"], x["id"], x["name"]) for x in g] == [("VITURE", "35ca:101d", "VITURE Luma Ultra")]


def test_windows_pnp():
    txt = ('"InstanceId","FriendlyName"\n'
           '"USB\\VID_3318&PID_0435\\5&1A2B","XREAL One Pro"\n'
           '"USB\\VID_3318&PID_0435\\5&1A2B&MI_00","XREAL One Pro"\n'
           '"USB\\VID_046D&PID_C52B\\6&1","USB Receiver"\n')
    g = detect.classify(detect.parse_windows_pnp(txt))
    assert len(g) == 1 and g[0]["brand"] == "XREAL" and g[0]["id"] == "3318:0435"


def test_macos_profiler():
    txt = json.dumps({"SPUSBDataType": [{"_items": [{"_name": "Hub", "vendor_id": "0x05e3", "product_id": "0x0610",
        "_items": [{"_name": "VITURE", "vendor_id": "0x35ca  (VITURE)", "product_id": "0x1101"}]}]}]})
    g = detect.classify(detect.parse_macos_profiler(txt))
    assert g and g[0]["brand"] == "VITURE" and g[0]["pid"] == 0x1101


def test_xrandr_and_modes():
    txt = "eDP-1 connected primary 1920x1200+0+0 (normal)\nDP-2 connected 3840x1200+1920+0 (normal)\nHDMI-1 disconnected\n"
    d = detect.parse_xrandr(txt)
    assert [x["output"] for x in d] == ["eDP-1", "DP-2"]
    assert "стерео" in detect.glasses_mode_hint(3840, 1200) and "2D" in detect.glasses_mode_hint(1920, 1080)


@pytest.mark.parametrize("ypr", [(0.3, -0.2, 0.1), (-2.5, 0.4, -0.3), (3.0, 0.0, 0.0), (0.0, 1.2, 0.0)])
def test_quat_roundtrip(ypr):
    q = pb.quat_from_ypr(*ypr)
    assert abs(sum(v * v for v in q) - 1) < 1e-9
    assert pb.ypr_from_quat(q) == pytest.approx(ypr, abs=1e-9)


def test_head_message_matches_protocol():
    m = json.loads(pb.head_message(123, pb.quat_from_ypr(0.1, 0, 0), (0, 1.68, 0), "demo"))
    assert m["type"] == "head" and m["t_ns"] == 123 and len(m["rotation_xyzw"]) == 4 and m["position_m"][1] == 1.68


def test_record_replay_and_analyze(tmp_path):
    # «очки лежат» 60 с при 100 Гц, дрейф курса 0,8 °/мин, шум 0,02°
    path = tmp_path / "still.csv"
    rec = pb.Recorder(path)
    for i in range(6000):
        t = i / 100
        yaw = math.radians(0.8 / 60 * t) + math.radians(0.02) * math.sin(i * 1.7)
        rec.add(int(t * 1e9), pb.quat_from_ypr(yaw, math.radians(0.02) * math.cos(i * 2.3)), (0, 0, 0))
    rec.close()
    rows = pb.load_csv(path)
    assert len(rows) == 6000
    res = imu_analyze.analyze(rows, still=True)
    assert res["rate_hz"] == pytest.approx(100, rel=1e-3) and res["gaps"] == 0
    assert res["drift_deg_min"] == pytest.approx(0.8, abs=0.02)
    assert 0.005 < res["noise_deg"] < 0.05
    src = pb.ReplaySource(path)
    q, p = src.read(10.0)
    assert len(q) == 4 and len(p) == 3


def test_gaps_detected():
    rows = [(int(i * 1e7), 0, 0, 0, 1) for i in range(100)] + [(int(2e9), 0, 0, 0, 1)]
    assert imu_analyze.analyze(rows)["gaps"] == 1


def test_measurement_merge(tmp_path):
    d = measurement.merge("viture-luma-ultra", values={"nits": 1310, "driftDegMin": 0.4}, sdk={"latencyMs": 21},
                          method={"nits": "люксметр"}, folder=tmp_path, by="Иванов", date="2026-11-20")
    d = measurement.merge("viture-luma-ultra", values={"imuHz": 1000}, folder=tmp_path, date="2026-11-21")
    saved = json.loads((tmp_path / "viture-luma-ultra.json").read_text(encoding="utf-8"))
    assert saved == d and saved["values"] == {"nits": 1310, "driftDegMin": 0.4, "imuHz": 1000}
    assert saved["sdk"] == {"latencyMs": 21} and saved["date"] == "2026-11-21" and saved["by"] == "Иванов"
    with pytest.raises(ValueError):
        measurement.merge("viture-luma-ultra", values={"brightness": 5}, folder=tmp_path)


def test_sdk_sources_are_explicit_stubs():
    for spec in ("viture", "xrlinux"):
        with pytest.raises(NotImplementedError):
            pb.make_source(spec)


def test_fps_stats():
    ts = [i / 30 for i in range(90)] + [3.2]
    r = fps_stats(ts)
    assert r["fps"] == pytest.approx(30, rel=1e-3) and r["stalls"] == 1


def test_bridge_serves_demo():
    websockets = pytest.importorskip("websockets")

    async def go():
        server = asyncio.create_task(pb.serve(pb.DemoSource(), port=47199, hz=200, seconds=1.5))
        await asyncio.sleep(0.3)
        async with websockets.connect("ws://127.0.0.1:47199") as ws:
            msgs = [json.loads(await ws.recv()) for _ in range(5)]
        await server
        return msgs

    msgs = asyncio.run(go())
    assert all(m["type"] == "head" and m["source"] == "demo" for m in msgs)
    assert msgs[-1]["t_ns"] > msgs[0]["t_ns"]
