from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from .. import audit
from ..db import get_db
from ..models import Item, JournalEntry, StockBalance, StockMove, User, Warehouse
from ..schemas import BalanceOut, StockMoveIn, StockMoveOut, WarehouseOut
from ..security import require
from ..services import stock as stock_svc

router = APIRouter(prefix="/api/stock", tags=["stock"])


@router.get("/warehouses", response_model=list[WarehouseOut])
def warehouses(db: Session = Depends(get_db), _: User = Depends(require("stock:read"))):
    return db.query(Warehouse).all()


@router.get("/balances", response_model=list[BalanceOut])
def balances(q: str = "", warehouse_id: int | None = None, only_nonzero: bool = True, limit: int = 500,
             db: Session = Depends(get_db), _: User = Depends(require("stock:read"))):
    query = db.query(StockBalance).join(Item)
    if q:
        query = query.filter(or_(Item.code.ilike(f"%{q}%"), Item.name.ilike(f"%{q}%")))
    if warehouse_id:
        query = query.filter(StockBalance.warehouse_id == warehouse_id)
    if only_nonzero:
        query = query.filter(StockBalance.qty != 0)
    return query.order_by(Item.code).limit(limit).all()


@router.get("/moves", response_model=list[StockMoveOut])
def moves(item_id: int | None = None, limit: int = 200, db: Session = Depends(get_db), _: User = Depends(require("stock:read"))):
    q = db.query(StockMove)
    if item_id:
        q = q.filter(StockMove.item_id == item_id)
    return q.order_by(StockMove.id.desc()).limit(limit).all()


@router.post("/moves", response_model=StockMoveOut)
def post_move(data: StockMoveIn, db: Session = Depends(get_db), me: User = Depends(require("stock:write"))):
    mv = stock_svc.post_move(db, user_id=me.id, **data.model_dump())
    audit.log(db, me.id, data.move_type.value, "stock", mv.id, {"item": mv.item.code, "qty": str(data.qty)})
    db.commit()
    db.refresh(mv)
    return mv


@router.get("/journal")
def journal(limit: int = 300, db: Session = Depends(get_db), _: User = Depends(require("finance:read"))):
    rows = db.query(JournalEntry).order_by(JournalEntry.id.desc()).limit(limit).all()
    return [{"id": r.id, "ts": r.ts, "debit": r.debit, "credit": r.credit, "amount": r.amount, "memo": r.memo, "exported": r.exported} for r in rows]


@router.get("/journal/trial-balance")
def trial_balance(db: Session = Depends(get_db), _: User = Depends(require("finance:read"))):
    from collections import defaultdict
    from decimal import Decimal

    bal: dict[str, dict] = defaultdict(lambda: {"debit": Decimal(0), "credit": Decimal(0)})
    for r in db.query(JournalEntry).all():
        bal[r.debit]["debit"] += r.amount
        bal[r.credit]["credit"] += r.amount
    names = {"10": "Материалы", "10.2": "ПКИ и полуфабрикаты", "10.7": "Материалы в переработке", "20": "Основное производство",
             "43": "Готовая продукция", "60": "Расчёты с поставщиками", "91": "Прочие доходы/расходы", "94": "Недостачи и потери"}
    return sorted([{"account": a, "name": names.get(a, ""), **v, "balance": v["debit"] - v["credit"]} for a, v in bal.items()], key=lambda r: r["account"])
