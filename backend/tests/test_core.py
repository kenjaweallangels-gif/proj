import io
from decimal import Decimal

import openpyxl

from .conftest import item_by_code


def test_auth_and_rbac(client, admin, designer, otk):
    assert client.get("/api/items").status_code == 401
    assert client.post("/api/auth/login", json={"login": "admin", "password": "wrong"}).status_code == 401
    # конструктор не может проводить складские операции
    r = client.post("/api/stock/moves", headers=designer, json={"move_type": "receipt", "item_id": 1, "qty": 1})
    assert r.status_code == 403
    # ОТК не видит админку
    assert client.get("/api/admin/users", headers=otk).status_code == 403
    assert client.get("/api/admin/users", headers=admin).status_code == 200


def test_clearance_hides_confidential_items(client, otk, admin):
    # у ОТК допуск 1, изделие РЧ-100.00.000 имеет уровень 2
    r = client.get("/api/items", params={"q": "РЧ-100.00.000"}, headers=otk)
    assert r.json()["total"] == 0
    assert client.get("/api/items", params={"q": "РЧ-100.00.000"}, headers=admin).json()["total"] == 1


def test_lockout_after_failed_logins(client, admin):
    client.post("/api/admin/users", headers=admin, json={"login": "lock", "full_name": "L", "password": "lock12345", "role_codes": ["designer"]})
    for _ in range(5):
        client.post("/api/auth/login", json={"login": "lock", "password": "bad"})
    r = client.post("/api/auth/login", json={"login": "lock", "password": "lock12345"})
    assert r.status_code == 423


def test_bom_tree_and_cost(client, admin, product_id):
    tree = client.get(f"/api/items/{product_id}/tree", headers=admin).json()
    assert tree["code"] == "РЧ-100.00.000"
    codes = {c["code"] for c in tree["children"]}
    assert {"РЧ-100.01.000", "РЧ-100.02.000", "ПОДШ 6206"} <= codes
    bearing = next(c for c in tree["children"] if c["code"] == "ПОДШ 6206")
    assert bearing["total_qty"] == "4.0000" and bearing["status"] == "ready"  # 10 на складе
    cost = client.get(f"/api/items/{product_id}/cost", headers=admin).json()
    assert Decimal(str(cost["total"])) > 0 and Decimal(str(cost["hours"])) > 10
    assert Decimal(str(cost["outsource"])) >= 4800 + 350 + 600 + 120


def test_cycle_protection(client, admin, product_id):
    body = item_by_code(client, admin, "РЧ-100.01.001")
    r = client.post(f"/api/items/{body['id']}/draft/lines", headers=admin, json={"child_item_id": product_id, "qty": 1})
    assert r.status_code == 400 and "Цикл" in r.text


def test_ecn_workflow_creates_new_revision(client, admin, designer, chief, product_id):
    seal = item_by_code(client, admin, "МАНЖ 1.1-30x52")
    r = client.get(f"/api/items/{product_id}/revisions", headers=admin)
    before = [x["rev"] for x in r.json() if x["status"] == "released"]
    # конструктор создаёт извещение: манжет стало 3
    r = client.post("/api/ecn", headers=designer, json={
        "title": "Увеличить число манжет", "reason": "Течь по валу", "reason_code": "2",
        "lines": [{"target_item_id": product_id, "action": "set_qty", "child_item_id": seal["id"], "qty": 3}],
        "approver_roles": ["chief_designer"]})
    assert r.status_code == 200, r.text
    ecn = r.json()
    assert client.post(f"/api/ecn/{ecn['id']}/submit", headers=designer).status_code == 200
    # конструктор без права approve
    assert client.post(f"/api/ecn/{ecn['id']}/decide", headers=designer, json={"decision": "approved"}).status_code == 403
    r = client.post(f"/api/ecn/{ecn['id']}/decide", headers=chief, json={"decision": "approved"})
    assert r.json()["status"] == "approved"
    r = client.post(f"/api/ecn/{ecn['id']}/implement", headers=chief)
    assert r.json()["status"] == "implemented"
    revs = client.get(f"/api/items/{product_id}/revisions", headers=admin).json()
    released = [x for x in revs if x["status"] == "released"]
    assert len(released) == 1 and released[0]["rev"] not in before
    assert any(x["status"] == "obsolete" for x in revs)
    line = next(l for l in released[0]["lines"] if l["child_item_id"] == seal["id"])
    assert Decimal(line["qty"]) == 3
    assert released[0]["change_notice_id"] == ecn["id"]


def test_excel_import_builds_bom(client, admin):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["Спецификация изделия ТЕСТ"])  # мусорная строка до шапки
    ws.append([])
    ws.append(["Код", "Наименование", "Родитель", "Кол-во", "Ед.", "Раздел"])
    ws.append(["Т-1.00.000", "Тестовое изделие", None, 1, "шт", "Изделие"])
    ws.append(["Т-1.01.000", "Узел А", "Т-1.00.000", 2, "шт", "Сборочные единицы"])
    ws.append(["Т-1.01.001", "Пластина", "Т-1.01.000", 4, "шт", "Детали"])
    ws.append(["Винт М4х10 ГОСТ 1491", "Винт", "Т-1.01.000", 8, "шт", "Стандартные изделия"])
    ws.append(["ДАТЧИК-X1", "Датчик", "Т-1.00.000", 1, "шт", "Покупные"])
    buf = io.BytesIO()
    wb.save(buf)
    r = client.post("/api/import/preview", headers=admin, files={"file": ("bom.xlsx", buf.getvalue())})
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["header_row"] == 2 and p["mapping"]["code"] == "Код" and p["mapping"]["parent"] == "Родитель"
    token = next(w for w in p["warnings"] if w.startswith("token:")).split(":")[1]
    r = client.post(f"/api/import/apply/{token}", headers=admin, json={"mapping": p["mapping"], "mode": "bom"})
    assert r.status_code == 200, r.text
    assert r.json()["items_created"] == 5 and r.json()["revisions_released"] == 2
    root = item_by_code(client, admin, "Т-1.00.000")
    tree = client.get(f"/api/items/{root['id']}/tree", headers=admin).json()
    assert len(tree["children"]) == 2
    node_a = next(c for c in tree["children"] if c["code"] == "Т-1.01.000")
    assert node_a["item_type"] == "assembly" and len(node_a["children"]) == 2
    plate = next(c for c in node_a["children"] if c["code"] == "Т-1.01.001")
    assert plate["total_qty"] == "8.0000"  # 2 узла × 4
    screw = next(c for c in node_a["children"] if c["code"].startswith("ВИНТ"))
    assert screw["item_type"] == "fastener"
    assert item_by_code(client, admin, "ДАТЧИК-X1")["item_type"] == "purchased"


def test_purchase_receive_inspect_stock(client, admin, otk):
    bearing = item_by_code(client, admin, "ПОДШ 6206")
    stock_before = Decimal(bearing["stock_qty"])
    partners = client.get("/api/purchasing/partners", headers=admin).json()
    r = client.post("/api/purchasing/orders", headers=admin, json={"partner_id": partners[0]["id"], "lines": [{"item_id": bearing["id"], "qty": 50}]})
    po = r.json()
    client.post(f"/api/purchasing/orders/{po['id']}/status", headers=admin, params={"status": "sent"})
    r = client.post("/api/purchasing/receive", headers=admin, json={"po_line_id": po["lines"][0]["id"], "qty": 50, "lot": "L-1", "certificate": "С-77"})
    insp = r.json()
    assert insp["status"] == "pending"
    # до решения ОТК на складе ничего не изменилось
    assert Decimal(item_by_code(client, admin, "ПОДШ 6206")["stock_qty"]) == stock_before
    assert client.post(f"/api/purchasing/inspections/{insp['id']}/decide", headers=admin, json={"accepted_qty": 1, "rejected_qty": 1}).status_code == 400
    r = client.post(f"/api/purchasing/inspections/{insp['id']}/decide", headers=otk, json={"accepted_qty": 48, "rejected_qty": 2, "defects": "сколы"})
    assert r.json()["status"] == "partial"
    assert Decimal(item_by_code(client, admin, "ПОДШ 6206")["stock_qty"]) == stock_before + 48
    # проводка Дт10.2 Кт60 на 48 × 420
    j = client.get("/api/stock/journal", headers=admin).json()
    assert any(e["debit"] == "10.2" and e["credit"] == "60" and Decimal(str(e["amount"])) == 48 * 420 for e in j)
    assert client.get("/api/purchasing/orders", headers=admin, params={"status": "received"}).json()[0]["id"] == po["id"]


def test_plan_launch_kit_issue_and_mrp(client, admin):
    plan = client.get("/api/planning/plan", headers=admin).json()
    line = next(p for p in plan if p["status"] == "planned")
    kit = client.post(f"/api/planning/plan/{line['id']}/launch", headers=admin).json()
    assert kit["lines"] and all("path" in l for l in kit["lines"])
    bolt_line = next(l for l in kit["lines"] if l["item"]["code"].startswith("БОЛТ") and l["level"] == 0)
    r = client.post(f"/api/planning/kits/{kit['id']}/lines/{bolt_line['id']}/issue", headers=admin, params={"qty": str(bolt_line["required_qty"])})
    assert r.status_code == 200, r.text
    upd = next(l for l in r.json()["lines"] if l["id"] == bolt_line["id"])
    assert upd["done"] is True
    sh = client.get("/api/planning/shortage", headers=admin).json()
    assert all(s["code"] != "БОЛТ М8-6gx25.58" or s["shortage"] <= 0 for s in sh)
    mrp = client.get("/api/planning/mrp", headers=admin).json()
    assert any(s["action"] == "buy" for s in mrp) and any(s["action"] == "make" for s in mrp)
    assert all(s["start_date"] <= s["due_date"] for s in mrp)


def test_ai_rules_and_proposal_apply(client, admin, designer):
    r = client.post("/api/ai/chat", headers=designer, json={"message": "куда входит ПОДШ 6206"})
    assert r.status_code == 200 and "РЧ-100.00.000" in r.json()["reply"]
    r = client.post("/api/ai/chat", headers=designer, json={"message": "себестоимость РЧ-100.02.001"})
    assert "Себестоимость" in r.json()["reply"] and r.json()["route"] == "rules"
    # предложение ИИ применяется только с правами; конструктор не может делать складские движения
    prop = {"kind": "stock_move", "payload": {"move_type": "receipt", "item_id": 1, "qty": 1}}
    assert client.post("/api/ai/apply", headers=designer, json=prop).status_code == 403
    prop = {"kind": "create_item", "payload": {"code": "AI-NEW-1", "name": "Из чата", "item_type": "part"}}
    assert client.post("/api/ai/apply", headers=designer, json=prop).status_code == 200
    assert item_by_code(client, admin, "AI-NEW-1")["name"] == "Из чата"


def test_analytics_endpoints(client, admin):
    bearing = item_by_code(client, admin, "ПОДШ 6206")
    for path in ("/api/analytics/dashboard", f"/api/analytics/forecast/{bearing['id']}", "/api/analytics/risks",
                 "/api/analytics/suppliers", "/api/analytics/workload"):
        r = client.get(path, headers=admin)
        assert r.status_code == 200, path
    f = client.get(f"/api/analytics/forecast/{bearing['id']}", headers=admin).json()
    assert len(f["forecast"]) == 8 and "reorder_point" in f


def test_audit_log_records_actions(client, admin):
    rows = client.get("/api/admin/audit", headers=admin).json()
    actions = {r["action"] for r in rows}
    assert {"login", "implement", "inspect", "import"} <= actions
