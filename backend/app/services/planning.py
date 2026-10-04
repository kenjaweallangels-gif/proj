"""Планирование: комплекты, MRP от товарного плана, дефицит, загрузка."""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..models import (
    BUY_TYPES,
    OUTSOURCE_TYPES,
    Item,
    ItemRevision,
    Kit,
    KitLine,
    Lifecycle,
    PlanLine,
    WorkOrder,
)
from ..schemas import MrpSuggestion
from . import bom as bom_svc
from . import stock as stock_svc


def _number(db: Session, model, prefix: str) -> str:
    n = db.query(model).count() + 1
    return f"{prefix}-{date.today():%y}-{n:05d}"


def create_kit(db: Session, item: Item, qty: Decimal, revision: ItemRevision | None = None, **kw) -> Kit:
    revision = revision or item.current_revision
    if not revision:
        raise HTTPException(400, "У изделия нет ревизии состава")
    kit = Kit(number=_number(db, Kit, "К"), item=item, revision=revision, qty=qty, **kw)
    db.add(kit)
    db.flush()
    counter = [0]

    def walk(rev: ItemRevision, parent: KitLine | None, mult: Decimal, path: str, level: int):
        for ln in rev.lines:
            counter[0] += 1
            p = f"{path}.{counter[0]:04d}" if path else f"{counter[0]:04d}"
            kl = KitLine(kit_id=kit.id, parent_line_id=parent.id if parent else None, path=p, level=level,
                         item_id=ln.child_item_id, qty_per=ln.qty, required_qty=(ln.qty * mult).quantize(Decimal("0.0001")), note=ln.note)
            db.add(kl)
            db.flush()
            child_rev = ln.child.current_revision
            if child_rev and child_rev.lines:
                walk(child_rev, kl, ln.qty * mult, p, level + 1)

    walk(revision, None, Decimal(qty), "", 0)
    db.flush()
    return kit


def kit_status(kit: Kit) -> dict:
    total = len(kit.lines)
    done = sum(1 for ln in kit.lines if ln.done or ln.issued_qty >= ln.required_qty)
    shortage = [ln for ln in kit.lines if not ln.done and ln.issued_qty < ln.required_qty
                and not any(c.parent_line_id == ln.id for c in kit.lines)]
    return {"total": total, "done": done, "percent": round(done * 100 / total) if total else 100,
            "shortage_lines": len(shortage)}


def mrp(db: Session, horizon_days: int = 120, plan_ids: list[int] | None = None) -> list[MrpSuggestion]:
    """Простой MRP: валовая потребность из товарного плана → минус остатки и заказы → предложения
    с датами запуска, рассчитанными назад от срока с учётом циклов (lead time)."""
    q = db.query(PlanLine).filter(PlanLine.status == "planned", PlanLine.due_date <= date.today() + timedelta(days=horizon_days))
    if plan_ids:
        q = q.filter(PlanLine.id.in_(plan_ids))
    plans = q.order_by(PlanLine.due_date, PlanLine.priority).all()
    stock = bom_svc.stock_map(db)
    on_order = bom_svc.on_order_map(db)
    # учёт уже выпущенных нарядов как «в работе»
    for wo in db.query(WorkOrder).filter(WorkOrder.status.in_(["planned", "released", "in_progress"])):
        on_order[wo.item_id] = on_order.get(wo.item_id, Decimal(0)) + (wo.qty - wo.done_qty)

    gross: dict[int, Decimal] = defaultdict(Decimal)
    need_by: dict[int, date] = {}
    sources: dict[int, set[str]] = defaultdict(set)

    def explode(item: Item, qty: Decimal, due: date, src: str, depth=0):
        gross[item.id] += qty
        need_by[item.id] = min(need_by.get(item.id, due), due)
        sources[item.id].add(src)
        rev = item.current_revision
        if not rev or depth > 30:
            return
        start = due - timedelta(days=item.lead_time_days)
        for ln in rev.lines:
            explode(ln.child, qty * Decimal(ln.qty), start, src, depth + 1)

    for p in plans:
        explode(p.item, Decimal(p.qty), p.due_date, f"План {p.customer or ''} {p.due_date:%d.%m}".strip())

    out: list[MrpSuggestion] = []
    for item_id, g in gross.items():
        item = db.get(Item, item_id)
        avail = stock.get(item_id, Decimal(0)) + on_order.get(item_id, Decimal(0))
        net = g - avail + Decimal(item.min_stock or 0)
        if net <= 0:
            continue
        lot = Decimal(item.lot_size or 1)
        if lot > 1:
            net = ((net + lot - 1) // lot) * lot
        net = net.quantize(Decimal("0.0001"))
        if item.item_type in BUY_TYPES:
            action = "buy"
        elif item.item_type in OUTSOURCE_TYPES:
            action = "outsource"
        else:
            action = "make"
        has_outsource_op = any(op.outsourced for op in item.operations)
        due = need_by[item_id]
        out.append(MrpSuggestion(
            item_id=item.id, code=item.code, name=item.name, item_type=item.item_type, action=action,
            gross_qty=g.quantize(Decimal("0.0001")), stock_qty=stock.get(item_id, Decimal(0)), on_order=on_order.get(item_id, Decimal(0)),
            net_qty=net, start_date=due - timedelta(days=item.lead_time_days), due_date=due,
            supplier_id=item.default_supplier_id, est_cost=(net * Decimal(item.std_cost or 0)).quantize(Decimal("0.01")),
            sources=sorted(sources[item_id]), has_outsource_op=has_outsource_op,
        ))
    out.sort(key=lambda s: (s.start_date, s.code))
    return out


def shortage_report(db: Session) -> list[dict]:
    """Дефицит по всем открытым комплектам: что не укомплектовано и нечем закрыть."""
    stock = bom_svc.stock_map(db)
    on_order = bom_svc.on_order_map(db)
    need: dict[int, Decimal] = defaultdict(Decimal)
    kits: dict[int, set[str]] = defaultdict(set)
    for kit in db.query(Kit).filter(Kit.status.in_(["open", "in_work"])):
        for ln in kit.lines:
            if ln.done:
                continue
            rest = ln.required_qty - ln.issued_qty
            if rest > 0:
                need[ln.item_id] += rest
                kits[ln.item_id].add(kit.number)
    out = []
    for item_id, n in need.items():
        item = db.get(Item, item_id)
        if item.item_type.value in ("assembly", "product"):
            continue  # сборки комплектуются из деталей — дефицит по листьям
        free = stock.get(item_id, Decimal(0))
        short = n - free
        if short > 0:
            out.append({"item_id": item_id, "code": item.code, "name": item.name, "item_type": item.item_type.value,
                        "need": n, "stock": free, "on_order": on_order.get(item_id, Decimal(0)),
                        "shortage": short, "uncovered": max(short - on_order.get(item_id, Decimal(0)), Decimal(0)),
                        "kits": sorted(kits[item_id]), "lead_time_days": item.lead_time_days})
    out.sort(key=lambda r: -r["uncovered"])
    return out


def create_work_order(db: Session, item: Item, qty: Decimal, **kw) -> WorkOrder:
    wo = WorkOrder(number=_number(db, WorkOrder, "ПЗ"), item=item, qty=qty, **kw)
    db.add(wo)
    db.flush()
    return wo


def issue_to_kit(db: Session, kit: Kit, line: KitLine, qty: Decimal, user_id: int | None) -> KitLine:
    """Выдать деталь в комплект со склада (списание в производство)."""
    from ..models import MoveType

    stock_svc.post_move(db, move_type=MoveType.issue, item_id=line.item_id, qty=qty, kit_id=kit.id,
                        doc_ref=kit.number, user_id=user_id)
    line.issued_qty = line.issued_qty + Decimal(qty)
    if line.issued_qty >= line.required_qty:
        line.done = True
    if kit.status == "open":
        kit.status = "in_work"
    db.flush()
    return line
