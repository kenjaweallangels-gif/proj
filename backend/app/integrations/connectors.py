"""Коннекторы к внешним системам.

* OneCODataConnector — 1С:ERP / УПП / КА через стандартный OData-интерфейс
  (/odata/standard.odata). Читает Catalog_Номенклатура, остатки, контрагентов;
  умеет отправлять проводки/документы (через POST в Document_*).
* SQLConnector — любая БД через SQLAlchemy URL с настраиваемым SQL-запросом и
  маппингом колонок (для MES, старых самописных систем, Access/MSSQL/Oracle).
* RESTConnector — универсальный JSON API с JSONPath-подобным маппингом.

Все коннекторы возвращают унифицированные записи {"code","name","item_type",...}
и проходят через общий upsert в sync_items(). Секреты (пароли) не хранятся в
таблице connectors — только ссылка на переменную окружения.
"""
from __future__ import annotations

import os
from datetime import datetime
from decimal import Decimal
from typing import Any, Iterable

import httpx
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from ..models import Connector, Item, ItemType, MoveType, Partner
from ..services import stock as stock_svc


class BaseConnector:
    def __init__(self, cfg: dict):
        self.cfg = cfg

    def _secret(self, key: str) -> str:
        env = self.cfg.get(f"{key}_env")
        return os.environ.get(env, "") if env else self.cfg.get(key, "")

    def test(self) -> dict:
        raise NotImplementedError

    def fetch_items(self) -> Iterable[dict]:
        raise NotImplementedError

    def fetch_stock(self) -> Iterable[dict]:
        return []

    def fetch_partners(self) -> Iterable[dict]:
        return []


class OneCODataConnector(BaseConnector):
    """cfg: {url: 'http://srv/erp/odata/standard.odata', user, password_env, type_map: {...}}"""

    def _client(self) -> httpx.Client:
        return httpx.Client(base_url=self.cfg["url"].rstrip("/"), auth=(self.cfg.get("user", ""), self._secret("password")),
                            timeout=60, headers={"Accept": "application/json"})

    def _get(self, entity: str, **params) -> list[dict]:
        out, skip = [], 0
        with self._client() as c:
            while True:
                r = c.get(f"/{entity}", params={"$format": "json", "$top": 1000, "$skip": skip, **params})
                r.raise_for_status()
                vals = r.json().get("value", [])
                out.extend(vals)
                if len(vals) < 1000:
                    return out
                skip += 1000

    def test(self) -> dict:
        with self._client() as c:
            r = c.get("/Catalog_Номенклатура", params={"$format": "json", "$top": 1})
            return {"ok": r.status_code == 200, "status": r.status_code}

    def fetch_items(self):
        tmap = self.cfg.get("type_map", {})
        for v in self._get("Catalog_Номенклатура", **{"$filter": "DeletionMark eq false"}):
            if v.get("IsFolder"):
                continue
            kind = (v.get("ВидНоменклатуры_Key") or v.get("ТипНоменклатуры") or "")
            yield {"code": v.get("Артикул") or v.get("Code"), "name": v.get("Description", ""),
                   "item_type": tmap.get(kind, "purchased"), "unit": "шт",
                   "external_id": v.get("Ref_Key"), "attrs": {"1c_code": v.get("Code")}}

    def fetch_stock(self):
        # Регистр остатков; имя зависит от конфигурации — настраивается в cfg
        reg = self.cfg.get("stock_entity", "AccumulationRegister_ТоварыНаСкладах/Balance")
        for v in self._get(reg):
            yield {"external_id": v.get("Номенклатура_Key"), "qty": Decimal(str(v.get("ВНаличииBalance", 0) or 0)),
                   "warehouse": v.get("Склад_Key")}

    def fetch_partners(self):
        for v in self._get("Catalog_Контрагенты", **{"$filter": "DeletionMark eq false"}):
            if not v.get("IsFolder"):
                yield {"name": v.get("Description"), "inn": v.get("ИНН", ""), "external_id": v.get("Ref_Key")}

    def push_document(self, entity: str, payload: dict) -> dict:
        with self._client() as c:
            r = c.post(f"/{entity}", params={"$format": "json"}, json=payload)
            r.raise_for_status()
            return r.json()


class SQLConnector(BaseConnector):
    """cfg: {url_env: 'ERP_DB_URL', items_sql: 'select ... as code, ... as name', stock_sql: ...}"""

    def _engine(self):
        return create_engine(self._secret("url"))

    def test(self):
        with self._engine().connect() as c:
            return {"ok": c.execute(text("select 1")).scalar() == 1}

    def fetch_items(self):
        with self._engine().connect() as c:
            for row in c.execute(text(self.cfg["items_sql"])).mappings():
                yield dict(row)

    def fetch_stock(self):
        if not self.cfg.get("stock_sql"):
            return
        with self._engine().connect() as c:
            for row in c.execute(text(self.cfg["stock_sql"])).mappings():
                yield dict(row)


class RESTConnector(BaseConnector):
    """cfg: {items_url, token_env, path: 'data.items', fields: {code: 'sku', name: 'title'}}"""

    def _get(self, url: str) -> Any:
        headers = {"Authorization": f"Bearer {self._secret('token')}"} if self._secret("token") else {}
        r = httpx.get(url, headers=headers, timeout=60)
        r.raise_for_status()
        data = r.json()
        for part in (self.cfg.get("path") or "").split("."):
            if part:
                data = data[part]
        return data

    def test(self):
        return {"ok": isinstance(self._get(self.cfg["items_url"]), list)}

    def fetch_items(self):
        f = self.cfg.get("fields", {})
        for row in self._get(self.cfg["items_url"]):
            yield {k: row.get(src) for k, src in f.items()} | {"external_id": row.get(f.get("id", "id"))}


REGISTRY = {"onec_odata": OneCODataConnector, "sql": SQLConnector, "rest": RESTConnector}


def make(conn: Connector) -> BaseConnector:
    cls = REGISTRY.get(conn.kind)
    if not cls:
        raise ValueError(f"Неизвестный тип коннектора: {conn.kind}")
    return cls(conn.config or {})


def sync(db: Session, conn: Connector, user_id: int | None = None, with_stock: bool = False) -> dict:
    c = make(conn)
    key = f"conn{conn.id}"
    created = updated = 0
    by_ext: dict[str, Item] = {}
    for rec in c.fetch_items():
        code = str(rec.get("code") or "").strip().upper()
        if not code:
            continue
        it = db.query(Item).filter(Item.code == code).first()
        if not it:
            try:
                it_type = ItemType(rec.get("item_type") or "purchased")
            except ValueError:
                it_type = ItemType.purchased
            it = Item(code=code, name=rec.get("name") or code, item_type=it_type, unit=rec.get("unit") or "шт",
                      std_cost=Decimal(str(rec.get("price") or 0)))
            db.add(it)
            created += 1
        else:
            if rec.get("name"):
                it.name = rec["name"]
            if rec.get("price"):
                it.std_cost = Decimal(str(rec["price"]))
            updated += 1
        if rec.get("external_id"):
            it.external_ids = {**(it.external_ids or {}), key: str(rec["external_id"])}
            by_ext[str(rec["external_id"])] = it
        if rec.get("attrs"):
            it.attrs = {**(it.attrs or {}), **rec["attrs"]}
    db.flush()
    partners = 0
    for rec in c.fetch_partners():
        if not db.query(Partner).filter(Partner.name == rec["name"]).first():
            db.add(Partner(name=rec["name"], inn=rec.get("inn", ""), external_ids={key: str(rec.get("external_id", ""))}))
            partners += 1
    moves = 0
    if with_stock:
        for rec in c.fetch_stock():
            it = by_ext.get(str(rec.get("external_id"))) or (db.query(Item).filter(Item.code == str(rec.get("code", "")).upper()).first())
            if it and Decimal(str(rec.get("qty") or 0)) > 0:
                cur = stock_svc.total_qty(db, it.id)
                diff = Decimal(str(rec["qty"])) - cur
                if diff > 0:
                    stock_svc.post_move(db, move_type=MoveType.adjustment, item_id=it.id, qty=diff, doc_ref=f"sync {conn.name}", user_id=user_id)
                    moves += 1
    conn.last_sync_at = datetime.utcnow()
    conn.last_status = f"ok: +{created} ~{updated} partners+{partners} moves+{moves}"
    db.commit()
    return {"created": created, "updated": updated, "partners": partners, "stock_moves": moves}
