"""Склад: движения, остатки, резервы и автоматические проводки."""
from __future__ import annotations

from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..models import Item, ItemType, JournalEntry, MoveType, StockBalance, StockMove, Warehouse

# Упрощённая корреспонденция счетов РФ по типам движений
ACCOUNTS = {
    MoveType.receipt: ("10", "60"),  # материалы ← поставщики
    MoveType.issue: ("20", "10"),  # основное производство ← материалы
    MoveType.output: ("43", "20"),  # готовая продукция ← производство
    MoveType.writeoff: ("94", "10"),
    MoveType.adjustment: ("10", "91"),
    MoveType.to_outsource: ("10.7", "10"),  # давальческое сырьё у переработчика
}


def _balance(db: Session, item_id: int, wh_id: int) -> StockBalance:
    b = db.get(StockBalance, (item_id, wh_id))
    if not b:
        b = StockBalance(item_id=item_id, warehouse_id=wh_id, qty=0, reserved=0, avg_cost=0)
        db.add(b)
        db.flush()
    return b


def default_warehouse(db: Session, kind: str = "main") -> Warehouse:
    wh = db.query(Warehouse).filter(Warehouse.kind == kind).first()
    if not wh:
        wh = db.query(Warehouse).first()
    if not wh:
        raise HTTPException(400, "Не настроен ни один склад")
    return wh


def post_move(db: Session, *, move_type: MoveType, item_id: int, qty: Decimal, from_wh_id: int | None = None,
              to_wh_id: int | None = None, unit_cost: Decimal = Decimal(0), lot: str = "", doc_ref: str = "",
              kit_id: int | None = None, work_order_id: int | None = None, user_id: int | None = None,
              comment: str = "") -> StockMove:
    qty = Decimal(qty)
    if qty <= 0:
        raise HTTPException(400, "Количество должно быть больше нуля")
    item = db.get(Item, item_id)
    if not item:
        raise HTTPException(404, "Номенклатура не найдена")
    if move_type in (MoveType.receipt, MoveType.output, MoveType.adjustment) and not to_wh_id:
        to_wh_id = default_warehouse(db, "finished" if move_type == MoveType.output else "main").id
    if move_type in (MoveType.issue, MoveType.writeoff, MoveType.to_outsource) and not from_wh_id:
        from_wh_id = default_warehouse(db).id
    if move_type == MoveType.transfer and not (from_wh_id and to_wh_id):
        raise HTTPException(400, "Для перемещения нужны оба склада")

    if from_wh_id:
        src = _balance(db, item_id, from_wh_id)
        if src.qty < qty:
            raise HTTPException(400, f"Недостаточно остатка {item.code}: есть {src.qty}, нужно {qty}")
        if not unit_cost:
            unit_cost = src.avg_cost
        src.qty = src.qty - qty
        if src.reserved > src.qty:
            src.reserved = src.qty
    if to_wh_id:
        dst = _balance(db, item_id, to_wh_id)
        total = dst.qty * dst.avg_cost + qty * Decimal(unit_cost)
        dst.qty = dst.qty + qty
        dst.avg_cost = (total / dst.qty) if dst.qty else Decimal(0)

    mv = StockMove(move_type=move_type, item_id=item_id, qty=qty, from_wh_id=from_wh_id, to_wh_id=to_wh_id,
                   unit_cost=unit_cost, lot=lot, doc_ref=doc_ref, kit_id=kit_id, work_order_id=work_order_id,
                   user_id=user_id, comment=comment)
    db.add(mv)
    db.flush()
    acc = ACCOUNTS.get(move_type)
    amount = (qty * Decimal(unit_cost)).quantize(Decimal("0.01"))
    if acc and amount:
        deb, cred = acc
        if move_type == MoveType.receipt and item.item_type in (ItemType.purchased, ItemType.fastener):
            deb = "10.2"  # ПКИ и полуфабрикаты
        db.add(JournalEntry(debit=deb, credit=cred, amount=amount, item_id=item_id, stock_move_id=mv.id,
                            memo=f"{move_type.value} {item.code} x{qty}"))
    return mv


def reserve(db: Session, item_id: int, qty: Decimal, wh_id: int | None = None) -> Decimal:
    """Зарезервировать под комплект сколько есть; вернуть фактически зарезервированное."""
    wh_id = wh_id or default_warehouse(db).id
    b = _balance(db, item_id, wh_id)
    free = b.qty - b.reserved
    take = max(min(free, Decimal(qty)), Decimal(0))
    b.reserved = b.reserved + take
    return take


def total_qty(db: Session, item_id: int) -> Decimal:
    return sum((b.qty for b in db.query(StockBalance).filter(StockBalance.item_id == item_id)), Decimal(0))
