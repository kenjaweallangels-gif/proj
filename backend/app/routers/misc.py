"""Аналитика, импорт, интеграции, ИИ-ассистент."""
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from .. import audit
from ..config import get_settings
from ..db import get_db
from ..models import ChangeLine, ChangeNotice, Approval, Connector, Item, ItemRevision, Lifecycle, MoveType, User
from ..schemas import ChatIn, ChatOut, ImportApply, ImportPreview
from ..security import require
from ..services import ai as ai_svc
from ..services import analytics, excel_import
from ..services import stock as stock_svc
from ..integrations import connectors

analytics_r = APIRouter(prefix="/api/analytics", tags=["analytics"])
import_r = APIRouter(prefix="/api/import", tags=["import"])
integr_r = APIRouter(prefix="/api/integrations", tags=["integrations"])
ai_r = APIRouter(prefix="/api/ai", tags=["ai"])


@analytics_r.get("/dashboard")
def dashboard(db: Session = Depends(get_db), _: User = Depends(require("analytics:read"))):
    return analytics.dashboard(db)


@analytics_r.get("/forecast/{item_id}")
def forecast(item_id: int, weeks: int = 12, db: Session = Depends(get_db), _: User = Depends(require("analytics:read"))):
    return analytics.consumption_forecast(db, item_id, weeks)


@analytics_r.get("/suppliers")
def suppliers(db: Session = Depends(get_db), _: User = Depends(require("analytics:read"))):
    return analytics.supplier_performance(db)


@analytics_r.get("/risks")
def risks(db: Session = Depends(get_db), _: User = Depends(require("analytics:read"))):
    return analytics.risk_items(db)


@analytics_r.get("/workload")
def workload(db: Session = Depends(get_db), _: User = Depends(require("analytics:read"))):
    return analytics.workload(db)


# ---------------------------------------------------------------- import ---
_uploads: dict[str, bytes] = {}  # token → содержимое; для прод — Redis/файловое хранилище


@import_r.post("/preview", response_model=ImportPreview)
def preview(file: UploadFile = File(...), sheet: str | None = Form(None), header_row: int | None = Form(None),
            _: User = Depends(require("import:run"))):
    data = file.file.read()
    if len(data) > 30 * 1024 * 1024:
        raise HTTPException(413, "Файл больше 30 МБ")
    try:
        p = excel_import.preview(data, sheet, header_row)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"Не удалось прочитать файл: {e}")
    import hashlib

    token = hashlib.sha1(data).hexdigest()[:16]
    _uploads[token] = data
    return p.model_copy(update={"warnings": p.warnings + [f"token:{token}"]})


@import_r.post("/apply/{token}")
def apply(token: str, body: ImportApply, db: Session = Depends(get_db), me: User = Depends(require("import:run"))):
    data = _uploads.get(token)
    if not data:
        raise HTTPException(404, "Файл не найден — загрузите заново")
    if body.mode == "bom":
        res = excel_import.apply_bom(db, data, body.mapping, body.sheet, body.header_row, body.root_code, body.as_revision)
    elif body.mode == "plan":
        res = excel_import.apply_plan(db, data, body.mapping, body.sheet, body.header_row)
    elif body.mode == "stock":
        res = excel_import.apply_stock(db, data, body.mapping, body.sheet, body.header_row, me.id)
    else:
        raise HTTPException(400, "Неизвестный режим")
    audit.log(db, me.id, "import", body.mode, token, res, source="import")
    db.commit()
    return res


# ----------------------------------------------------------- integrations ---
@integr_r.get("")
def list_connectors(db: Session = Depends(get_db), _: User = Depends(require("admin:integrations"))):
    return [{"id": c.id, "name": c.name, "kind": c.kind, "enabled": c.enabled, "last_sync_at": c.last_sync_at,
             "last_status": c.last_status, "config": {k: v for k, v in (c.config or {}).items() if "password" not in k and "token" not in k}}
            for c in db.query(Connector).all()]


@integr_r.post("")
def create_connector(name: str, kind: str, config: dict, db: Session = Depends(get_db), me: User = Depends(require("admin:integrations"))):
    if kind not in connectors.REGISTRY:
        raise HTTPException(400, f"Тип должен быть одним из {list(connectors.REGISTRY)}")
    c = Connector(name=name, kind=kind, config=config)
    db.add(c)
    audit.log(db, me.id, "create", "connector", name)
    db.commit()
    return {"id": c.id}


@integr_r.post("/{conn_id}/test")
def test_connector(conn_id: int, db: Session = Depends(get_db), _: User = Depends(require("admin:integrations"))):
    c = db.get(Connector, conn_id)
    if not c:
        raise HTTPException(404)
    try:
        return connectors.make(c).test()
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}


@integr_r.post("/{conn_id}/sync")
def sync_connector(conn_id: int, with_stock: bool = False, db: Session = Depends(get_db), me: User = Depends(require("admin:integrations"))):
    c = db.get(Connector, conn_id)
    if not c:
        raise HTTPException(404)
    try:
        res = connectors.sync(db, c, me.id, with_stock)
    except Exception as e:  # noqa: BLE001
        c.last_status = f"error: {e}"
        db.commit()
        raise HTTPException(502, f"Ошибка синхронизации: {e}")
    audit.log(db, me.id, "sync", "connector", c.name, res, source="integration")
    db.commit()
    return res


@integr_r.get("/export/journal")
def export_journal(db: Session = Depends(get_db), me: User = Depends(require("finance:read"))):
    """Выгрузка проводок для 1С (JSON; формат совместим с обработкой загрузки документов)."""
    from ..models import JournalEntry

    rows = db.query(JournalEntry).filter(JournalEntry.exported == False).all()  # noqa: E712
    out = [{"id": r.id, "date": r.ts.isoformat(), "Дт": r.debit, "Кт": r.credit, "Сумма": float(r.amount), "Содержание": r.memo} for r in rows]
    for r in rows:
        r.exported = True
    db.commit()
    return {"count": len(out), "entries": out}


# -------------------------------------------------------------------- AI ---
@ai_r.get("/status")
def ai_status(me: User = Depends(require("ai:use"))):
    s = get_settings()
    return {"local": s.local_llm_enabled, "local_model": s.local_llm_model if s.local_llm_enabled else None,
            "cloud": bool(s.cloud_llm_enabled and s.anthropic_api_key), "cloud_model": s.cloud_llm_model,
            "cloud_allowed_for_user": "ai:cloud" in me.permissions or "*" in me.permissions}


@ai_r.post("/chat", response_model=ChatOut)
def chat(data: ChatIn, db: Session = Depends(get_db), me: User = Depends(require("ai:use"))):
    return ai_svc.chat(db, me, data.message, data.conversation, data.allow_cloud)


@ai_r.post("/apply")
def apply_proposal(proposal: dict, db: Session = Depends(get_db), me: User = Depends(require("ai:use"))):
    """Подтверждение предложенного ИИ действия. Проверяем права как для обычного UI-действия."""
    kind, p = proposal.get("kind"), proposal.get("payload", {})
    perms = me.permissions
    need = {"create_item": "items:write", "change_notice": "ecn:create", "stock_move": "stock:write"}.get(kind)
    if not need or (need not in perms and "*" not in perms):
        raise HTTPException(403, f"Нужно право {need}")
    if kind == "create_item":
        if db.query(Item).filter(Item.code == p["code"]).first():
            raise HTTPException(400, "Уже существует")
        it = Item(code=p["code"], name=p["name"], item_type=p["item_type"], unit=p.get("unit", "шт"),
                  std_cost=p.get("std_cost", 0), lead_time_days=p.get("lead_time_days", 10))
        db.add(it)
        db.flush()
        db.add(ItemRevision(item_id=it.id, rev="01", status=Lifecycle.draft))
        result = {"item_id": it.id}
    elif kind == "change_notice":
        from datetime import date

        n = db.query(ChangeNotice).count() + 1
        cn = ChangeNotice(number=f"ИИ-{date.today():%y}-{n:04d}", title=p["title"], reason=p.get("reason", ""), author_id=me.id)
        db.add(cn)
        db.flush()
        for ln in p["lines"]:
            db.add(ChangeLine(notice_id=cn.id, **ln))
        for role in ("chief_designer", "technologist", "pdo"):
            db.add(Approval(notice_id=cn.id, role_code=role))
        result = {"ecn_id": cn.id, "number": cn.number}
    else:
        mv = stock_svc.post_move(db, move_type=MoveType(p["move_type"]), item_id=p["item_id"], qty=p["qty"],
                                 unit_cost=p.get("unit_cost", 0), comment=p.get("comment", "ИИ-ассистент"), user_id=me.id)
        result = {"move_id": mv.id}
    audit.log(db, me.id, "ai_apply", kind, result, p, source="ai")
    db.commit()
    return result
