"""Сквозной тест: синтетика → запись EuRoC → ReplayRig → ядро."""
from conftest import EXAMPLES
from record_euroc import record

from arcore.app import run
from arcore.hal import make_rig


def test_sim_end_to_end():
    st = run(str(EXAMPLES / "op040_shelf_bench.json"), frames=40, rig_name="sim", verbose=False, listen_input=False)
    assert st["anchored"] >= 35 and st["median_err_mm"] < 2.0
    assert any(e["event"] == "aligned" for e in st["log"])


def test_record_and_replay(tmp_path):
    rig = make_rig("sim", package_path=str(EXAMPLES / "op040_shelf_bench.json"), n_frames=12, disturb=False)
    assert record(rig, tmp_path, 12) == 12
    rep = make_rig("replay", path=str(tmp_path))
    n = 0
    while (f := rep.frames.next_frame()) is not None:
        assert rep.poses.pose_at(f.t_ns) is not None
        n += 1
    assert n == 12


def test_udp_roundtrip():
    """Клиент → ядро (input) и ядро → клиент (step) на свободных портах."""
    import json
    import socket

    from arcore.net.udp import UdpDisplaySink, UdpInput

    inp = UdpInput(port=0)
    port_in = inp.sock.getsockname()[1]
    tx = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    tx.sendto(json.dumps({"type": "input", "command": "next"}).encode(), ("127.0.0.1", port_in))
    tx.sendto(b"not json", ("127.0.0.1", port_in))
    import time
    time.sleep(0.05)
    assert inp.poll() == [{"type": "input", "command": "next"}]

    rx = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    rx.bind(("127.0.0.1", 0))
    rx.settimeout(1)
    UdpDisplaySink(port=rx.getsockname()[1]).publish({"type": "step", "index": 1, "ok": True})
    assert json.loads(rx.recv(65536))["index"] == 1
