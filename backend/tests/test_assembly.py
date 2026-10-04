"""Сборка: последовательность шагов, факт, пропуск/отмена, загрузка 3D-модели."""
import io

import trimesh


def _order(client, admin, product_id):
    return client.post("/api/simple/orders", headers=admin, json={"item_id": product_id, "qty": 1, "due_date": "2030-05-01"}).json()["id"]


def test_steps_are_bottom_up(client, admin, product_id):
    kid = _order(client, admin, product_id)
    r = client.get(f"/api/assembly/orders/{kid}/steps", headers=admin)
    assert r.status_code == 200, r.text
    d = r.json()
    codes = [s["item"]["code"] for s in d["steps"]]
    # составляющие корпуса идут раньше самого корпуса, корпус в сборе — после своих частей
    assert codes.index("ОТЛИВКА РЧ-100.01.001") < codes.index("РЧ-100.01.001") < codes.index("РЧ-100.01.000")
    assert d["total"] == len(d["steps"]) and d["done"] == 0 and d["current"] == 0
    first = d["steps"][0]
    assert first["state"] == "pending" and first["into"]


def test_step_done_skip_undo_and_status(client, admin, product_id):
    kid = _order(client, admin, product_id)
    d = client.get(f"/api/assembly/orders/{kid}/steps", headers=admin).json()
    s0, s1 = d["steps"][0], d["steps"][1]
    r = client.post(f"/api/assembly/orders/{kid}/steps/{s0['line_id']}", headers=admin, json={"action": "done"})
    assert r.json()["state"] == "done" and r.json()["done"] == 1 and r.json()["current"] == 1 and r.json()["kit_status"] == "in_work"
    r = client.post(f"/api/assembly/orders/{kid}/steps/{s1['line_id']}", headers=admin, json={"action": "skip"})
    assert r.json()["state"] == "skipped" and r.json()["done"] == 2
    d = client.get(f"/api/assembly/orders/{kid}/steps", headers=admin).json()
    assert d["steps"][0]["done_by"] and d["steps"][0]["done_at"]
    r = client.post(f"/api/assembly/orders/{kid}/steps/{s0['line_id']}", headers=admin, json={"action": "undo"})
    assert r.json()["state"] == "pending" and r.json()["current"] == 0
    # закрыть все шаги → заказ собран
    for s in d["steps"]:
        client.post(f"/api/assembly/orders/{kid}/steps/{s['line_id']}", headers=admin, json={"action": "done"})
    assert client.get(f"/api/simple/orders/{kid}", headers=admin).json()["status"] == "assembled"
    # факт виден и в обычном дереве заказа
    o = client.get(f"/api/simple/orders/{kid}", headers=admin).json()
    assert o["percent"] == 100


def test_model_upload_glb_and_nodes(client, admin, product_id):
    # сборка из двух «деталей» с именами, содержащими обозначения из спецификации
    sc = trimesh.Scene()
    sc.add_geometry(trimesh.creation.box(extents=(2, 2, 1)), node_name="РЧ-100.01.001_корпус")
    sc.add_geometry(trimesh.creation.cylinder(radius=0.5, height=3), node_name="PODSH_6206")
    glb = sc.export(file_type="glb")
    r = client.post(f"/api/assembly/models/{product_id}", headers=admin, files={"file": ("reduktor.glb", glb)})
    assert r.status_code == 200, r.text
    assert r.json()["nodes"] >= 2
    info = client.get(f"/api/assembly/models/{product_id}", headers=admin).json()
    assert info["exists"] and info["format"] == "glb"
    nodes = client.get(f"/api/assembly/models/{product_id}/nodes", headers=admin).json()["nodes"]
    assert any("РЧ-100.01.001" in n for n in nodes)
    r = client.get(f"/api/assembly/models/{product_id}.glb", headers=admin)
    assert r.status_code == 200 and r.content[:4] == b"glTF"
    kid = _order(client, admin, product_id)
    assert client.get(f"/api/assembly/orders/{kid}/steps", headers=admin).json()["assembly_model_url"]
    # STL тоже конвертируется
    stl = trimesh.creation.box().export(file_type="stl")
    r = client.post(f"/api/assembly/models/{product_id}", headers=admin, files={"file": ("part.stl", stl)})
    assert r.status_code == 200 and r.json()["format"] == "stl"
    assert client.post(f"/api/assembly/models/{product_id}", headers=admin, files={"file": ("x.txt", b"nope")}).status_code == 400
    assert client.delete(f"/api/assembly/models/{product_id}", headers=admin).status_code == 200
    assert client.get(f"/api/assembly/models/{product_id}", headers=admin).json()["exists"] is False


def test_step_conversion_available():
    import cascadio  # noqa: F401 — конвертер STEP установлен в окружении сервера

    assert hasattr(cascadio, "step_to_glb")
