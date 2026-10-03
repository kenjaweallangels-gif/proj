import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("AR_DATA_DIR", str(tmp_path / "data"))
    from server.app import create_app
    app = create_app(f"sqlite:///{tmp_path / 't.db'}")
    return TestClient(app)


def test_operation_run_chat(client, op040):
    assert client.post("/api/operations", json=op040).status_code == 201
    assert client.get("/api/operations").json()[0]["id"] == "040"
    assert client.get("/api/operations/040").json()["steps"][0]["id"] == "S1"

    run = client.post("/api/runs", json={"operation_id": "040", "operator": "Иванов", "serial": "SN-1"}).json()
    ev = [{"step_id": "S1", "event": "aligned", "data": {"quality": 0.9}, "t": 1.0},
          {"step_id": "S6", "event": "operation_done", "t": 99.0}]
    assert client.post(f"/api/runs/{run['id']}/events", json=ev).json()["accepted"] == 2

    with client.websocket_connect(f"/ws/chat/{run['id']}") as ws:
        ws.send_json({"author": "Иванов", "text": "Нет болтов M4×12", "step_id": "S2"})
        assert ws.receive_json()["text"] == "Нет болтов M4×12"
        client.post(f"/api/runs/{run['id']}/messages", json={"author": "Петров", "role": "master", "text": "Несу"})
        assert ws.receive_json()["role"] == "master"

    r = client.get(f"/api/runs/{run['id']}").json()
    assert r["finished_at"] is not None and len(r["events"]) == 2 and len(r["messages"]) == 2


def test_invalid_package_rejected(client, op040):
    bad = dict(op040, steps=[])
    assert client.post("/api/operations", json=bad).status_code == 422


def test_photo_upload(client, op040):
    client.post("/api/operations", json=op040)
    run = client.post("/api/runs", json={"operation_id": "040", "operator": "И"}).json()
    r = client.post(f"/api/runs/{run['id']}/photos", params={"step_id": "S6"},
                    files={"file": ("p.jpg", b"\xff\xd8\xff", "image/jpeg")})
    assert r.status_code == 201
    assert client.post(f"/api/runs/{run['id']}/photos", params={"step_id": "S6"},
                       files={"file": ("p.txt", b"x", "text/plain")}).status_code == 415


def test_token(tmp_path, monkeypatch):
    monkeypatch.setenv("AR_DEVICE_TOKEN", "secret")
    monkeypatch.setenv("AR_DATA_DIR", str(tmp_path / "d"))
    from server.app import create_app
    c = TestClient(create_app(f"sqlite:///{tmp_path / 'x.db'}"))
    assert c.get("/api/operations").status_code == 401
    assert c.get("/api/operations", headers={"X-Device-Token": "secret"}).status_code == 200


def test_remote_relay_tablet_to_glasses(client):
    """Пульт: команда с планшета доходит до очков той же комнаты, но не до другой комнаты и не обратно отправителю."""
    with client.websocket_connect("/ws/remote/ST3") as glasses, client.websocket_connect("/ws/remote/ST3") as tablet, \
            client.websocket_connect("/ws/remote/ST4") as other:
        tablet.send_json({"type": "cmd", "cmd": "next", "id": "m1"})
        assert glasses.receive_json() == {"type": "cmd", "cmd": "next", "id": "m1"}
        glasses.send_json({"type": "state", "step": {"id": "060.02"}, "id": "m2"})
        assert tablet.receive_json()["step"]["id"] == "060.02"
        other.send_json({"type": "ping", "id": "m3"})
        tablet.send_json({"type": "cmd", "cmd": "photo", "id": "m4"})
        assert glasses.receive_json()["cmd"] == "photo"      # «ping» из ST4 сюда не пришёл
