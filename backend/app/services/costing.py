"""Себестоимость и трудоёмкость: рекурсивная калькуляция по составу и техпроцессу."""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy.orm import Session

from ..models import BUY_TYPES, OUTSOURCE_TYPES, Item


def cost_item(db: Session, item: Item, _cache: dict | None = None) -> dict:
    """Возвращает структуру затрат на 1 единицу: материалы, ПКИ, кооперация, труд, часы."""
    cache = _cache if _cache is not None else {}
    if item.id in cache:
        return cache[item.id]
    res = {"item_id": item.id, "code": item.code, "name": item.name, "material": Decimal(0), "purchased": Decimal(0),
           "outsource": Decimal(0), "labor": Decimal(0), "hours": Decimal(0), "total": Decimal(0), "children": []}
    cache[item.id] = res  # защита от циклов
    if item.item_type in BUY_TYPES:
        key = "material" if item.item_type.value == "material" else "purchased"
        res[key] = Decimal(item.std_cost or 0)
    elif item.item_type in OUTSOURCE_TYPES:
        res["outsource"] = Decimal(item.std_cost or 0)
    rev = item.current_revision
    if rev:
        for ln in rev.lines:
            c = cost_item(db, ln.child, cache)
            q = Decimal(ln.qty)
            for k in ("material", "purchased", "outsource", "labor", "hours"):
                res[k] += c[k] * q
            res["children"].append({"code": c["code"], "name": c["name"], "qty": q, "unit_total": c["total"],
                                    "total": c["total"] * q})
    for op in item.operations:
        hours = Decimal(op.run_hours or 0) + Decimal(op.setup_hours or 0) / Decimal(item.lot_size or 1)
        if op.outsourced:
            res["outsource"] += Decimal(op.outsource_cost or 0)
        else:
            res["hours"] += hours
            rate = Decimal(op.work_center.hourly_rate) if op.work_center else Decimal(0)
            res["labor"] += hours * rate
    res["total"] = res["material"] + res["purchased"] + res["outsource"] + res["labor"]
    for k in ("material", "purchased", "outsource", "labor", "total"):
        res[k] = res[k].quantize(Decimal("0.01"))
    res["hours"] = res["hours"].quantize(Decimal("0.001"))
    return res
