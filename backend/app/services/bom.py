"""Состав изделия: ревизии, дерево, применение извещений, where-used."""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import (
    BomLine,
    ChangeAction,
    ChangeNotice,
    ChangeStatus,
    Item,
    ItemRevision,
    Lifecycle,
    POLine,
    POStatus,
    PurchaseOrder,
    StockBalance,
    Warehouse,
)
from ..schemas import BomTreeNode


def next_rev_label(item: Item) -> str:
    nums = []
    for r in item.revisions:
        try:
            nums.append(int(r.rev))
        except ValueError:
            pass
    return f"{(max(nums) + 1) if nums else 1:02d}"


def ensure_draft_revision(db: Session, item: Item, note: str = "") -> ItemRevision:
    """Вернуть текущую черновую ревизию или создать новую (копия выпущенной)."""
    for r in reversed(item.revisions):
        if r.status == Lifecycle.draft:
            return r
    base = item.current_revision
    rev = ItemRevision(item=item, rev=next_rev_label(item), status=Lifecycle.draft, note=note)
    db.add(rev)
    db.flush()
    if base:
        for ln in base.lines:
            db.add(BomLine(parent_revision_id=rev.id, child_item_id=ln.child_item_id, qty=ln.qty,
                           position=ln.position, note=ln.note))
    db.flush()
    return rev


def release_revision(db: Session, rev: ItemRevision) -> None:
    for other in rev.item.revisions:
        if other.id != rev.id and other.status == Lifecycle.released:
            other.status = Lifecycle.obsolete
    rev.status = Lifecycle.released
    rev.released_at = datetime.utcnow()
    rev.item.lifecycle = Lifecycle.released
    db.flush()


def check_cycle(db: Session, parent_id: int, child_id: int) -> None:
    """Запрет циклов: child не должен содержать parent на любом уровне."""
    if parent_id == child_id:
        raise HTTPException(400, "Изделие не может входить само в себя")
    stack = [child_id]
    seen = set()
    while stack:
        cur = stack.pop()
        if cur in seen:
            continue
        seen.add(cur)
        item = db.get(Item, cur)
        rev = item.current_revision if item else None
        for ln in rev.lines if rev else []:
            if ln.child_item_id == parent_id:
                raise HTTPException(400, f"Циклическая ссылка через {item.code}")
            stack.append(ln.child_item_id)


def stock_map(db: Session) -> dict[int, Decimal]:
    # карантин (входной контроль / брак) не считается доступным остатком
    rows = db.execute(select(StockBalance.item_id, func.sum(StockBalance.qty - StockBalance.reserved))
                      .join(Warehouse, Warehouse.id == StockBalance.warehouse_id)
                      .where(Warehouse.kind.notin_(["quarantine", "scrap"]))
                      .group_by(StockBalance.item_id)).all()
    return {i: Decimal(q or 0) for i, q in rows}


def on_order_map(db: Session) -> dict[int, Decimal]:
    rows = db.execute(
        select(POLine.item_id, func.sum(POLine.qty - POLine.received_qty))
        .join(PurchaseOrder)
        .where(PurchaseOrder.status.in_([POStatus.sent, POStatus.confirmed, POStatus.partial]))
        .group_by(POLine.item_id)
    ).all()
    return {i: Decimal(q or 0) for i, q in rows}


def build_tree(db: Session, item: Item, qty: Decimal = Decimal(1), max_depth: int = 30,
               stock: dict[int, Decimal] | None = None, on_order: dict[int, Decimal] | None = None,
               _level: int = 0, _consumed: dict[int, Decimal] | None = None) -> BomTreeNode:
    """Развёрнутое дерево с расчётом дефицита и статуса готовности снизу вверх.

    Остаток «потребляется» по мере обхода, чтобы одна и та же деталь, входящая
    в несколько узлов, не считалась доступной дважды.
    """
    stock = stock if stock is not None else stock_map(db)
    on_order = on_order if on_order is not None else on_order_map(db)
    consumed = _consumed if _consumed is not None else defaultdict(Decimal)
    qty = Decimal(qty).quantize(Decimal("0.0001"))
    rev = item.current_revision
    avail = stock.get(item.id, Decimal(0)) - consumed[item.id]
    covered = max(min(avail, qty), Decimal(0))
    consumed[item.id] += covered
    shortage = qty - covered
    node = BomTreeNode(
        item_id=item.id, code=item.code, name=item.name, item_type=item.item_type,
        outsource_kind=item.outsource_kind, rev=rev.rev if rev else None, unit=item.unit,
        qty_per=qty if _level == 0 else Decimal(0), total_qty=qty, level=_level,
        stock_qty=max(avail, Decimal(0)), on_order=on_order.get(item.id, Decimal(0)), shortage=shortage,
    )
    if rev and _level < max_depth:
        for ln in rev.lines:
            child = build_tree(db, ln.child, qty * ln.qty, max_depth, stock, on_order, _level + 1, consumed)
            child.qty_per = ln.qty
            node.children.append(child)
    if shortage <= 0:
        node.status = "ready"
    elif node.children:
        st = [c.status for c in node.children]
        node.status = "ready" if all(s == "ready" for s in st) else ("partial" if any(s != "missing" for s in st) else "missing")
        # детей хватает — узел можно собрать; сам он ещё не изготовлен
        if node.status == "ready":
            node.status = "partial"
    else:
        node.status = "partial" if covered > 0 else "missing"
    return node


def flatten(node: BomTreeNode) -> list[BomTreeNode]:
    out = [node]
    for c in node.children:
        out.extend(flatten(c))
    return out


def summarized_requirements(node: BomTreeNode) -> dict[int, Decimal]:
    """Суммарная потребность по номенклатуре на всех уровнях (без корня)."""
    req: dict[int, Decimal] = defaultdict(Decimal)
    for n in flatten(node)[1:]:
        req[n.item_id] += n.total_qty
    return dict(req)


def where_used(db: Session, item_id: int) -> list[dict]:
    rows = db.execute(
        select(ItemRevision, BomLine.qty).join(BomLine, BomLine.parent_revision_id == ItemRevision.id)
        .where(BomLine.child_item_id == item_id, ItemRevision.status != Lifecycle.obsolete)
    ).all()
    return [{"item_id": r.item_id, "code": r.item.code, "name": r.item.name, "rev": r.rev,
             "status": r.status.value, "qty": q} for r, q in rows]


def implement_change(db: Session, notice: ChangeNotice) -> list[ItemRevision]:
    """Проведение извещения: для каждого затронутого изделия — новая выпущенная ревизия."""
    if notice.status != ChangeStatus.approved:
        raise HTTPException(400, "Извещение не согласовано")
    by_item: dict[int, list] = defaultdict(list)
    for ln in notice.lines:
        by_item[ln.target_item_id].append(ln)
    created = []
    for item_id, lines in by_item.items():
        item = db.get(Item, item_id)
        rev = ensure_draft_revision(db, item, note=f"ИИ {notice.number}: {notice.title}")
        rev.change_notice_id = notice.id
        for ln in lines:
            existing = next((b for b in rev.lines if b.child_item_id == ln.child_item_id), None)
            if ln.action == ChangeAction.add:
                check_cycle(db, item.id, ln.child_item_id)
                if existing:
                    existing.qty = existing.qty + (ln.qty or 1)
                else:
                    db.add(BomLine(parent_revision_id=rev.id, child_item_id=ln.child_item_id,
                                   qty=ln.qty or 1, position=len(rev.lines) + 1, note=ln.comment))
            elif ln.action == ChangeAction.remove and existing:
                db.delete(existing)
            elif ln.action == ChangeAction.set_qty and existing:
                existing.qty = ln.qty or existing.qty
            elif ln.action == ChangeAction.replace and existing and ln.new_child_item_id:
                check_cycle(db, item.id, ln.new_child_item_id)
                existing.child_item_id = ln.new_child_item_id
                if ln.qty is not None:
                    existing.qty = ln.qty
        db.flush()
        db.refresh(rev)
        release_revision(db, rev)
        created.append(rev)
    notice.status = ChangeStatus.implemented
    notice.implemented_at = datetime.utcnow()
    db.flush()
    return created
