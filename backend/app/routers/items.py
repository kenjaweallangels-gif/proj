from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from .. import audit
from ..db import get_db
from ..models import BomLine, Item, ItemRevision, Lifecycle, Operation, User, WorkCenter
from ..schemas import (
    BomLineIn,
    BomTreeNode,
    ItemIn,
    ItemOut,
    ItemPatch,
    OperationIn,
    OperationOut,
    RevisionOut,
    WorkCenterOut,
)
from ..security import check_clearance, require
from ..services import bom as bom_svc
from ..services import costing

router = APIRouter(prefix="/api/items", tags=["items"])


def _out(it: Item, stock: dict | None = None) -> ItemOut:
    o = ItemOut.model_validate(it)
    o.current_rev = it.current_revision.rev if it.current_revision else None
    if stock is not None:
        o.stock_qty = stock.get(it.id, Decimal(0))
    return o


@router.get("", response_model=dict)
def list_items(q: str = "", item_type: str | None = None, lifecycle: str | None = None, page: int = 1,
               size: int = Query(50, le=500), db: Session = Depends(get_db), me: User = Depends(require("items:read"))):
    query = db.query(Item).filter(Item.confidentiality <= (99 if "*" in me.permissions else me.clearance))
    if q:
        query = query.filter(or_(Item.code.ilike(f"%{q}%"), Item.name.ilike(f"%{q}%")))
    if item_type:
        query = query.filter(Item.item_type == item_type)
    if lifecycle:
        query = query.filter(Item.lifecycle == lifecycle)
    total = query.count()
    rows = query.order_by(Item.code).offset((page - 1) * size).limit(size).all()
    stock = bom_svc.stock_map(db)
    return {"total": total, "page": page, "size": size, "items": [_out(i, stock) for i in rows]}


@router.post("", response_model=ItemOut)
def create_item(data: ItemIn, db: Session = Depends(get_db), me: User = Depends(require("items:write"))):
    code = data.code.strip().upper()
    if db.query(Item).filter(Item.code == code).first():
        raise HTTPException(400, f"Обозначение {code} уже существует")
    it = Item(**(data.model_dump() | {"code": code}))
    db.add(it)
    db.flush()
    db.add(ItemRevision(item_id=it.id, rev="01", status=Lifecycle.draft))
    audit.log(db, me.id, "create", "item", code)
    db.commit()
    db.refresh(it)
    return _out(it)


@router.get("/{item_id}", response_model=ItemOut)
def get_item(item_id: int, db: Session = Depends(get_db), me: User = Depends(require("items:read"))):
    it = db.get(Item, item_id)
    if not it:
        raise HTTPException(404)
    check_clearance(me, it.confidentiality)
    return _out(it, bom_svc.stock_map(db))


@router.patch("/{item_id}", response_model=ItemOut)
def patch_item(item_id: int, data: ItemPatch, db: Session = Depends(get_db), me: User = Depends(require("items:write"))):
    it = db.get(Item, item_id)
    if not it:
        raise HTTPException(404)
    check_clearance(me, it.confidentiality)
    changes = data.model_dump(exclude_unset=True)
    for k, v in changes.items():
        setattr(it, k, v)
    audit.log(db, me.id, "update", "item", it.code, {k: str(v) for k, v in changes.items()})
    db.commit()
    return _out(it)


@router.get("/{item_id}/revisions", response_model=list[RevisionOut])
def revisions(item_id: int, db: Session = Depends(get_db), me: User = Depends(require("items:read"))):
    it = db.get(Item, item_id)
    if not it:
        raise HTTPException(404)
    check_clearance(me, it.confidentiality)
    return it.revisions


@router.get("/{item_id}/tree", response_model=BomTreeNode)
def tree(item_id: int, qty: Decimal = Decimal(1), depth: int = 20, db: Session = Depends(get_db), me: User = Depends(require("items:read"))):
    it = db.get(Item, item_id)
    if not it:
        raise HTTPException(404)
    check_clearance(me, it.confidentiality)
    return bom_svc.build_tree(db, it, qty, max_depth=depth)


@router.get("/{item_id}/where-used")
def where_used(item_id: int, db: Session = Depends(get_db), _: User = Depends(require("items:read"))):
    return bom_svc.where_used(db, item_id)


@router.get("/{item_id}/cost")
def cost(item_id: int, db: Session = Depends(get_db), me: User = Depends(require("finance:read"))):
    it = db.get(Item, item_id)
    if not it:
        raise HTTPException(404)
    check_clearance(me, it.confidentiality)
    return costing.cost_item(db, it)


# --- прямое редактирование черновой ревизии (без извещения; для новых изделий)
@router.post("/{item_id}/draft", response_model=RevisionOut)
def new_draft(item_id: int, db: Session = Depends(get_db), me: User = Depends(require("bom:write"))):
    it = db.get(Item, item_id)
    if not it:
        raise HTTPException(404)
    rev = bom_svc.ensure_draft_revision(db, it)
    audit.log(db, me.id, "draft", "revision", f"{it.code}/{rev.rev}")
    db.commit()
    db.refresh(rev)
    return rev


@router.post("/{item_id}/draft/lines", response_model=RevisionOut)
def add_line(item_id: int, data: BomLineIn, db: Session = Depends(get_db), me: User = Depends(require("bom:write"))):
    it = db.get(Item, item_id)
    child = db.get(Item, data.child_item_id)
    if not it or not child:
        raise HTTPException(404)
    bom_svc.check_cycle(db, it.id, child.id)
    rev = bom_svc.ensure_draft_revision(db, it)
    existing = next((l for l in rev.lines if l.child_item_id == child.id), None)
    if existing:
        existing.qty = data.qty
        existing.note = data.note or existing.note
    else:
        db.add(BomLine(parent_revision_id=rev.id, child_item_id=child.id, qty=data.qty,
                       position=data.position or len(rev.lines) + 1, note=data.note))
    audit.log(db, me.id, "bom_add", "revision", f"{it.code}/{rev.rev}", {"child": child.code, "qty": str(data.qty)})
    db.commit()
    db.refresh(rev)
    return rev


@router.delete("/{item_id}/draft/lines/{line_id}", response_model=RevisionOut)
def del_line(item_id: int, line_id: int, db: Session = Depends(get_db), me: User = Depends(require("bom:write"))):
    ln = db.get(BomLine, line_id)
    if not ln or ln.parent_revision.item_id != item_id or ln.parent_revision.status != Lifecycle.draft:
        raise HTTPException(400, "Строку можно удалять только из черновой ревизии")
    rev = ln.parent_revision
    audit.log(db, me.id, "bom_remove", "revision", f"{rev.item.code}/{rev.rev}", {"child": ln.child.code})
    db.delete(ln)
    db.commit()
    db.refresh(rev)
    return rev


@router.post("/{item_id}/draft/release", response_model=RevisionOut)
def release(item_id: int, db: Session = Depends(get_db), me: User = Depends(require("ecn:implement"))):
    it = db.get(Item, item_id)
    if not it:
        raise HTTPException(404)
    rev = next((r for r in reversed(it.revisions) if r.status == Lifecycle.draft), None)
    if not rev:
        raise HTTPException(400, "Нет черновой ревизии")
    bom_svc.release_revision(db, rev)
    audit.log(db, me.id, "release", "revision", f"{it.code}/{rev.rev}")
    db.commit()
    db.refresh(rev)
    return rev


# --- техпроцесс
@router.get("/{item_id}/operations", response_model=list[OperationOut])
def operations(item_id: int, db: Session = Depends(get_db), _: User = Depends(require("items:read"))):
    return db.query(Operation).filter(Operation.item_id == item_id).order_by(Operation.seq).all()


@router.post("/{item_id}/operations", response_model=OperationOut)
def add_operation(item_id: int, data: OperationIn, db: Session = Depends(get_db), me: User = Depends(require("items:write"))):
    if not db.get(Item, item_id):
        raise HTTPException(404)
    op = Operation(item_id=item_id, **data.model_dump())
    db.add(op)
    audit.log(db, me.id, "op_add", "item", item_id, {"name": data.name})
    db.commit()
    db.refresh(op)
    return op


@router.delete("/{item_id}/operations/{op_id}")
def del_operation(item_id: int, op_id: int, db: Session = Depends(get_db), me: User = Depends(require("items:write"))):
    op = db.get(Operation, op_id)
    if not op or op.item_id != item_id:
        raise HTTPException(404)
    db.delete(op)
    audit.log(db, me.id, "op_del", "item", item_id, {"op": op_id})
    db.commit()
    return {"ok": True}


wc = APIRouter(prefix="/api/work-centers", tags=["items"])


@wc.get("", response_model=list[WorkCenterOut])
def work_centers(db: Session = Depends(get_db), _: User = Depends(require("items:read"))):
    return db.query(WorkCenter).order_by(WorkCenter.code).all()
