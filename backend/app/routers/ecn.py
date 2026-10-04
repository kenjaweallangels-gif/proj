from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import audit
from ..db import get_db
from ..models import Approval, ChangeLine, ChangeNotice, ChangeStatus, User
from ..schemas import ChangeNoticeIn, ChangeNoticeOut, DecisionIn
from ..security import require
from ..services import bom as bom_svc

router = APIRouter(prefix="/api/ecn", tags=["ecn"])


@router.get("", response_model=list[ChangeNoticeOut])
def list_ecn(status: str | None = None, db: Session = Depends(get_db), _: User = Depends(require("items:read"))):
    q = db.query(ChangeNotice)
    if status:
        q = q.filter(ChangeNotice.status == status)
    return q.order_by(ChangeNotice.id.desc()).limit(300).all()


@router.post("", response_model=ChangeNoticeOut)
def create_ecn(data: ChangeNoticeIn, db: Session = Depends(get_db), me: User = Depends(require("ecn:create"))):
    n = db.query(ChangeNotice).count() + 1
    cn = ChangeNotice(number=f"ИИ-{date.today():%y}-{n:04d}", title=data.title, reason=data.reason, reason_code=data.reason_code,
                      urgency=data.urgency, wip_disposition=data.wip_disposition, author_id=me.id)
    db.add(cn)
    db.flush()
    for ln in data.lines:
        db.add(ChangeLine(notice_id=cn.id, **ln.model_dump()))
    for role in data.approver_roles:
        db.add(Approval(notice_id=cn.id, role_code=role))
    audit.log(db, me.id, "create", "ecn", cn.number, {"lines": len(data.lines)})
    db.commit()
    db.refresh(cn)
    return cn


@router.get("/{ecn_id}", response_model=ChangeNoticeOut)
def get_ecn(ecn_id: int, db: Session = Depends(get_db), _: User = Depends(require("items:read"))):
    cn = db.get(ChangeNotice, ecn_id)
    if not cn:
        raise HTTPException(404)
    return cn


@router.post("/{ecn_id}/submit", response_model=ChangeNoticeOut)
def submit(ecn_id: int, db: Session = Depends(get_db), me: User = Depends(require("ecn:create"))):
    cn = db.get(ChangeNotice, ecn_id)
    if not cn or cn.status != ChangeStatus.draft:
        raise HTTPException(400, "Извещение не в статусе «черновик»")
    if not cn.lines:
        raise HTTPException(400, "В извещении нет изменений")
    cn.status = ChangeStatus.review
    audit.log(db, me.id, "submit", "ecn", cn.number)
    db.commit()
    return cn


@router.post("/{ecn_id}/decide", response_model=ChangeNoticeOut)
def decide(ecn_id: int, data: DecisionIn, db: Session = Depends(get_db), me: User = Depends(require("ecn:approve"))):
    cn = db.get(ChangeNotice, ecn_id)
    if not cn or cn.status != ChangeStatus.review:
        raise HTTPException(400, "Извещение не на согласовании")
    my_roles = {r.code for r in me.roles}
    slot = next((a for a in cn.approvals if a.decision == "pending" and (a.role_code in my_roles or "*" in me.permissions)), None)
    if not slot:
        raise HTTPException(403, "Нет ожидающей вашей подписи")
    slot.user_id, slot.decision, slot.comment, slot.decided_at = me.id, data.decision, data.comment, datetime.utcnow()
    if data.decision == "rejected":
        cn.status = ChangeStatus.rejected
    elif all(a.decision == "approved" for a in cn.approvals):
        cn.status = ChangeStatus.approved
    audit.log(db, me.id, data.decision, "ecn", cn.number, {"role": slot.role_code, "comment": data.comment})
    db.commit()
    return cn


@router.post("/{ecn_id}/implement", response_model=ChangeNoticeOut)
def implement(ecn_id: int, db: Session = Depends(get_db), me: User = Depends(require("ecn:implement"))):
    cn = db.get(ChangeNotice, ecn_id)
    if not cn:
        raise HTTPException(404)
    revs = bom_svc.implement_change(db, cn)
    audit.log(db, me.id, "implement", "ecn", cn.number, {"revisions": [f"{r.item.code}/{r.rev}" for r in revs]})
    db.commit()
    db.refresh(cn)
    return cn


@router.post("/{ecn_id}/reopen", response_model=ChangeNoticeOut)
def reopen(ecn_id: int, db: Session = Depends(get_db), me: User = Depends(require("ecn:create"))):
    cn = db.get(ChangeNotice, ecn_id)
    if not cn or cn.status not in (ChangeStatus.rejected, ChangeStatus.review):
        raise HTTPException(400)
    cn.status = ChangeStatus.draft
    for a in cn.approvals:
        a.decision, a.user_id, a.decided_at = "pending", None, None
    audit.log(db, me.id, "reopen", "ecn", cn.number)
    db.commit()
    return cn
