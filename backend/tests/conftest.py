import os

os.environ["PLM_DATABASE_URL"] = "sqlite://"  # in-memory
os.environ["PLM_SEED_DEMO"] = "true"
os.environ["PLM_STATIC_DIR"] = "/nonexistent"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


def _login(client, login, password):
    r = client.post("/api/auth/login", json={"login": login, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="session")
def admin(client):
    return _login(client, "admin", "admin12345")


@pytest.fixture(scope="session")
def designer(client):
    return _login(client, "petrova", "petrova12345")


@pytest.fixture(scope="session")
def chief(client):
    return _login(client, "ivanov", "ivanov12345")


@pytest.fixture(scope="session")
def otk(client):
    return _login(client, "otk", "otk12345")


@pytest.fixture(scope="session")
def product_id(client, admin):
    r = client.get("/api/items", params={"q": "РЧ-100.00.000"}, headers=admin)
    return r.json()["items"][0]["id"]


def item_by_code(client, headers, code):
    r = client.get("/api/items", params={"q": code}, headers=headers)
    return next(i for i in r.json()["items"] if i["code"] == code)
