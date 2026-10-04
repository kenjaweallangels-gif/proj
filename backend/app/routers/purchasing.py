from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import audit
from ..db import get_db
from ..models import Inspection, Item, MoveType, Partner, POLine, POStatus, PurchaseOrder, User
from ..schemas import InspectionDecisionIn, InspectionOut, PartnerIn, PartnerOut, POIn, POOut, ReceiveIn
from ..security import require
from ..services import planning as plan_svc
from ..services import stock as stock_svc

router = APIRouter(prefix="/api/purchasing", tags=["purchasing"])


@router.get("/partners", response_model=list[PartnerOut])
def partners(db: Session = Depends(get_db), _: User = Depends(require("purchase:read"))):
    return db.query(Partner).order_by(Partner.name).all()


@router.post("/partners", response_model=PartnerOut)
def create_partner(data: PartnerIn, db: Session = Depends(get_db), me: User = Depends(require("purchase:write"))):
    p = Partner(**data.model_dump())
    db.add(p)
    audit.log(db, me.id, "create", "partner", data.name)
    db.commit()
    db.refresh(p)
    return p


@router.get("/orders", response_model=list[POOut])
def orders(kind: str | None = None, status: str | None = None, db: Session = Depends(get_db), _: User = Depends(require("purchase:read"))):
    q = db.query(PurchaseOrder)
    if kind:
        q = q.filter(PurchaseOrder.kind == kind)
    if status:
        q = q.filter(PurchaseOrder.status == status)
    return q.order_by(PurchaseOrder.id.desc()).limit(300).all()


@router.post("/orders", response_model=POOut)
def create_order(data: POIn, db: Session = Depends(get_db), me: User = Depends(require("purchase:write"))):
    if not db.get(Partner, data.partner_id):
        raise HTTPException(404, "Контрагент не найден")
    n = db.query(PurchaseOrder).count() + 1
    prefix = "ЗК" if data.kind == "outsource" else "ЗП"
    po = PurchaseOrder(number=f"{prefix}-{date.today():%y}-{n:05d}", kind=data.kind, partner_id=data.partner_id,
                       due_date=data.due_date, comment=data.comment, responsible_id=me.id)
    db.add(po)
    db.flush()
    for ln in data.lines:
        it = db.get(Item, ln.item_id)
        if not it:
            raise HTTPException(404, f"Номенклатура {ln.item_id} не найдена")
        db.add(POLine(order_id=po.id, price=ln.price or it.std_cost, **ln.model_dump(exclude={"price"})))
    audit.log(db, me.id, "create", "purchase_order", po.number, {"lines": len(data.lines)})
    db.commit()
    db.refresh(po)
    return po


@router.post("/orders/from-mrp", response_model=list[POOut])
def orders_from_mrp(horizon_days: int = 120, db: Session = Depends(get_db), me: User = Depends(require("purchase:write", "plan:read"))):
    """Автоформирование заказов поставщикам/кооператорам по предложениям MRP, сгруппированных по контрагенту."""
    sugg = [s for s in plan_svc.mrp(db, horizon_days) if s.action in ("buy", "outsource")]
    groups: dict[tuple, list] = {}
    for s in sugg:
        groups.setdefault((s.supplier_id, s.action), []).append(s)
    created = []
    for (supplier_id, action), lines in groups.items():
        if not supplier_id:
            continue
        n = db.query(PurchaseOrder).count() + 1
        prefix = "ЗК" if action == "outsource" else "ЗП"
        po = PurchaseOrder(number=f"{prefix}-{date.today():%y}-{n:05d}", kind="outsource" if action == "outsource" else "purchase",
                           partner_id=supplier_id, due_date=min(l.due_date for l in lines), responsible_id=me.id, comment="Сформировано из MRP")
        db.add(po)
        db.flush()
        for s in lines:
            db.add(POLine(order_id=po.id, item_id=s.item_id, qty=s.net_qty, price=db.get(Item, s.item_id).std_cost, due_date=s.due_date))
        created.append(po)
    audit.log(db, me.id, "from_mrp", "purchase_order", "", {"orders": len(created)})
    db.commit()
    for po in created:
        db.refresh(po)
    return created


@router.post("/orders/{po_id}/status", response_model=POOut)
def po_status(po_id: int, status: POStatus, db: Session = Depends(get_db), me: User = Depends(require("purchase:write"))):
    po = db.get(PurchaseOrder, po_id)
    if not po:
        raise HTTPException(404)
    po.status = status
    audit.log(db, me.id, "status", "purchase_order", po.number, {"status": status.value})
    db.commit()
    return po


# ----------------------------------------------------- приёмка и ОТК ----
@router.post("/receive", response_model=InspectionOut)
def receive(data: ReceiveIn, db: Session = Depends(get_db), me: User = Depends(require("stock:write"))):
    """Приход от поставщика: товар попадает в карантин (на входной контроль), не на основной склад."""
    ln = db.get(POLine, data.po_line_id)
    if not ln:
        raise HTTPException(404)
    if data.qty <= 0 or ln.received_qty + data.qty > ln.qty * Decimal("1.1"):
        raise HTTPException(400, "Количество превышает заказанное более чем на 10 %")
    ln.received_qty = ln.received_qty + data.qty
    po = ln.order
    po.status = POStatus.received if all(l.received_qty >= l.qty for l in po.lines) else POStatus.partial
    insp = Inspection(po_line_id=ln.id, item_id=ln.item_id, qty=data.qty, lot=data.lot, certificate=data.certificate, unit_cost=ln.price)
    db.add(insp)
    audit.log(db, me.id, "receive", "purchase_order", po.number, {"item": ln.item.code, "qty": str(data.qty)})
    db.commit()
    db.refresh(insp)
    return insp


@router.get("/inspections", response_model=list[InspectionOut])
def inspections(status: str | None = "pending", db: Session = Depends(get_db), _: User = Depends(require("purchase:read"))):
    q = db.query(Inspection)
    if status:
        q = q.filter(Inspection.status == status)
    return q.order_by(Inspection.id.desc()).limit(300).all()


@router.post("/inspections/{insp_id}/decide", response_model=InspectionOut)
def decide(insp_id: int, data: InspectionDecisionIn, db: Session = Depends(get_db), me: User = Depends(require("qc:write"))):
    insp = db.get(Inspection, insp_id)
    if not insp or insp.status != "pending":
        raise HTTPException(400, "Нет ожидающей проверки")
    if data.accepted_qty + data.rejected_qty != insp.qty:
        raise HTTPException(400, "Принято + забраковано должно равняться поступившему количеству")
    insp.accepted_qty, insp.rejected_qty, insp.defects = data.accepted_qty, data.rejected_qty, data.defects
    insp.inspector_id, insp.decided_at = me.id, datetime.utcnow()
    insp.status = "accepted" if not data.rejected_qty else ("rejected" if not data.accepted_qty else "partial")
    if data.accepted_qty > 0:
        stock_svc.post_move(db, move_type=MoveType.receipt, item_id=insp.item_id, qty=data.accepted_qty, to_wh_id=data.warehouse_id,
                            unit_cost=insp.unit_cost, lot=insp.lot, doc_ref=insp.po_line.order.number if insp.po_line else "", user_id=me.id)
    if data.rejected_qty > 0:
        # брак — на склад брака/карантина (учитываем для рекламации), без проводки на 10
        scrap = stock_svc.default_warehouse(db, "quarantine")
        from ..models import StockBalance

        b = db.get(StockBalance, (insp.item_id, scrap.id)) or StockBalance(item_id=insp.item_id, warehouse_id=scrap.id, qty=0, reserved=0, avg_cost=0)
        b.qty = b.qty + data.rejected_qty
        db.add(b)
    audit.log(db, me.id, "inspect", "inspection", insp.id, {"item": insp.item.code, "ok": str(data.accepted_qty), "ng": str(data.rejected_qty)})
    db.commit()
    db.refresh(insp)
    return insp
