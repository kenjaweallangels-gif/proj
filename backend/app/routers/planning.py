from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import audit
from ..db import get_db
from ..models import Item, ItemRevision, Kit, KitLine, PlanLine, User, WorkOrder
from ..schemas import KitIn, KitOut, MrpSuggestion, PlanLineIn, PlanLineOut, WorkOrderIn, WorkOrderOut
from ..security import require
from ..services import planning as plan_svc

router = APIRouter(prefix="/api/planning", tags=["planning"])


@router.get("/plan", response_model=list[PlanLineOut])
def plan(db: Session = Depends(get_db), _: User = Depends(require("plan:read"))):
    return db.query(PlanLine).order_by(PlanLine.due_date, PlanLine.priority).all()


@router.post("/plan", response_model=PlanLineOut)
def add_plan(data: PlanLineIn, db: Session = Depends(get_db), me: User = Depends(require("plan:write"))):
    if not db.get(Item, data.item_id):
        raise HTTPException(404)
    p = PlanLine(**data.model_dump())
    db.add(p)
    audit.log(db, me.id, "create", "plan", "", {"item": data.item_id, "qty": str(data.qty)})
    db.commit()
    db.refresh(p)
    return p


@router.delete("/plan/{plan_id}")
def del_plan(plan_id: int, db: Session = Depends(get_db), me: User = Depends(require("plan:write"))):
    p = db.get(PlanLine, plan_id)
    if not p:
        raise HTTPException(404)
    db.delete(p)
    audit.log(db, me.id, "delete", "plan", plan_id)
    db.commit()
    return {"ok": True}


@router.get("/mrp", response_model=list[MrpSuggestion])
def mrp(horizon_days: int = 120, db: Session = Depends(get_db), _: User = Depends(require("plan:read"))):
    return plan_svc.mrp(db, horizon_days)


@router.get("/shortage")
def shortage(db: Session = Depends(get_db), _: User = Depends(require("plan:read"))):
    return plan_svc.shortage_report(db)


@router.post("/plan/{plan_id}/launch", response_model=KitOut)
def launch(plan_id: int, db: Session = Depends(get_db), me: User = Depends(require("plan:write"))):
    """Запуск строки плана: создаёт комплект с замороженным составом и наряд на сборку."""
    p = db.get(PlanLine, plan_id)
    if not p or p.status != "planned":
        raise HTTPException(400, "Строка плана уже запущена")
    kit = plan_svc.create_kit(db, p.item, p.qty, plan_line_id=p.id, due_date=p.due_date)
    plan_svc.create_work_order(db, p.item, p.qty, kit_id=kit.id, due_date=p.due_date)
    p.status = "launched"
    audit.log(db, me.id, "launch", "plan", plan_id, {"kit": kit.number})
    db.commit()
    db.refresh(kit)
    return kit


# ------------------------------------------------------------- комплекты ---
@router.get("/kits")
def kits(status: str | None = None, db: Session = Depends(get_db), _: User = Depends(require("kits:read"))):
    q = db.query(Kit)
    if status:
        q = q.filter(Kit.status == status)
    out = []
    for k in q.order_by(Kit.id.desc()).limit(300).all():
        out.append({"id": k.id, "number": k.number, "item": {"code": k.item.code, "name": k.item.name}, "qty": k.qty,
                    "rev": k.revision.rev, "due_date": k.due_date, "status": k.status, **plan_svc.kit_status(k)})
    return out


@router.post("/kits", response_model=KitOut)
def create_kit(data: KitIn, db: Session = Depends(get_db), me: User = Depends(require("kits:write"))):
    it = db.get(Item, data.item_id)
    if not it:
        raise HTTPException(404)
    rev = db.get(ItemRevision, data.revision_id) if data.revision_id else None
    kit = plan_svc.create_kit(db, it, data.qty, rev, serial_numbers=data.serial_numbers, plan_line_id=data.plan_line_id, due_date=data.due_date)
    audit.log(db, me.id, "create", "kit", kit.number)
    db.commit()
    db.refresh(kit)
    return kit


@router.get("/kits/{kit_id}", response_model=KitOut)
def get_kit(kit_id: int, db: Session = Depends(get_db), _: User = Depends(require("kits:read"))):
    k = db.get(Kit, kit_id)
    if not k:
        raise HTTPException(404)
    return k


@router.post("/kits/{kit_id}/lines/{line_id}/issue", response_model=KitOut)
def issue(kit_id: int, line_id: int, qty: Decimal, db: Session = Depends(get_db), me: User = Depends(require("kits:write", "stock:write"))):
    k, ln = db.get(Kit, kit_id), db.get(KitLine, line_id)
    if not k or not ln or ln.kit_id != k.id:
        raise HTTPException(404)
    plan_svc.issue_to_kit(db, k, ln, qty, me.id)
    audit.log(db, me.id, "issue", "kit", k.number, {"item": ln.item.code, "qty": str(qty)})
    db.commit()
    db.refresh(k)
    return k


@router.post("/kits/{kit_id}/lines/{line_id}/toggle", response_model=KitOut)
def toggle(kit_id: int, line_id: int, db: Session = Depends(get_db), me: User = Depends(require("kits:write"))):
    """Ручная отметка «собрано/получено» (например, для сборочных узлов)."""
    k, ln = db.get(Kit, kit_id), db.get(KitLine, line_id)
    if not k or not ln or ln.kit_id != k.id:
        raise HTTPException(404)
    ln.done = not ln.done
    if k.status == "open":
        k.status = "in_work"
    if all(l.done or l.issued_qty >= l.required_qty for l in k.lines):
        k.status = "assembled"
    audit.log(db, me.id, "toggle", "kit", k.number, {"item": ln.item.code, "done": ln.done})
    db.commit()
    db.refresh(k)
    return k


# ----------------------------------------------------------------- наряды ---
@router.get("/work-orders", response_model=list[WorkOrderOut])
def work_orders(status: str | None = None, db: Session = Depends(get_db), _: User = Depends(require("wo:read"))):
    q = db.query(WorkOrder)
    if status:
        q = q.filter(WorkOrder.status == status)
    return q.order_by(WorkOrder.due_date.nullslast(), WorkOrder.id.desc()).limit(300).all()


@router.post("/work-orders", response_model=WorkOrderOut)
def create_wo(data: WorkOrderIn, db: Session = Depends(get_db), me: User = Depends(require("wo:write"))):
    it = db.get(Item, data.item_id)
    if not it:
        raise HTTPException(404)
    wo = plan_svc.create_work_order(db, it, data.qty, kit_id=data.kit_id, start_date=data.start_date, due_date=data.due_date, master_id=data.master_id)
    audit.log(db, me.id, "create", "work_order", wo.number)
    db.commit()
    db.refresh(wo)
    return wo


@router.post("/work-orders/{wo_id}/status", response_model=WorkOrderOut)
def wo_status(wo_id: int, status: str, done_qty: Decimal | None = None, actual_hours: Decimal | None = None,
              db: Session = Depends(get_db), me: User = Depends(require("wo:write"))):
    wo = db.get(WorkOrder, wo_id)
    if not wo:
        raise HTTPException(404)
    if status not in ("planned", "released", "in_progress", "done"):
        raise HTTPException(400, "Недопустимый статус")
    wo.status = status
    if done_qty is not None:
        wo.done_qty = done_qty
    if actual_hours is not None:
        wo.actual_hours = actual_hours
    if status == "done":
        from ..models import MoveType
        from ..services import costing, stock as stock_svc

        wo.done_qty = wo.done_qty or wo.qty
        cost = costing.cost_item(db, wo.item)["total"]
        stock_svc.post_move(db, move_type=MoveType.output, item_id=wo.item_id, qty=wo.done_qty, unit_cost=cost,
                            doc_ref=wo.number, work_order_id=wo.id, user_id=me.id)
    audit.log(db, me.id, "status", "work_order", wo.number, {"status": status})
    db.commit()
    db.refresh(wo)
    return wo
