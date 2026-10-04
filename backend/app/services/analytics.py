"""Аналитика и прогнозирование: KPI, оборачиваемость, прогноз потребления, риски поставок."""
from __future__ import annotations

import statistics
from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models import (
    ChangeNotice,
    ChangeStatus,
    Inspection,
    Item,
    Kit,
    MoveType,
    POLine,
    POStatus,
    PurchaseOrder,
    StockBalance,
    StockMove,
    WorkOrder,
)
from . import planning


def dashboard(db: Session) -> dict:
    today = date.today()
    open_po = db.query(PurchaseOrder).filter(PurchaseOrder.status.in_([POStatus.sent, POStatus.confirmed, POStatus.partial]))
    overdue_po = open_po.filter(PurchaseOrder.due_date < today).count()
    stock_value = db.query(func.sum(StockBalance.qty * StockBalance.avg_cost)).scalar() or 0
    insp = db.query(Inspection)
    total_insp = insp.count()
    rejected = db.query(func.sum(Inspection.rejected_qty)).scalar() or 0
    inspected = db.query(func.sum(Inspection.qty)).filter(Inspection.status != "pending").scalar() or 0
    wo_late = db.query(WorkOrder).filter(WorkOrder.status != "done", WorkOrder.due_date < today).count()
    shortage = planning.shortage_report(db)
    return {
        "items": db.query(Item).count(),
        "kits_open": db.query(Kit).filter(Kit.status.in_(["open", "in_work"])).count(),
        "ecn_in_review": db.query(ChangeNotice).filter(ChangeNotice.status == ChangeStatus.review).count(),
        "po_open": open_po.count(), "po_overdue": overdue_po,
        "wo_open": db.query(WorkOrder).filter(WorkOrder.status != "done").count(), "wo_late": wo_late,
        "inspections_pending": insp.filter(Inspection.status == "pending").count(), "inspections_total": total_insp,
        "reject_rate": float(Decimal(rejected) / Decimal(inspected) * 100) if inspected else 0.0,
        "stock_value": float(stock_value),
        "shortage_positions": len(shortage), "shortage_uncovered": sum(1 for s in shortage if s["uncovered"] > 0),
    }


def consumption_forecast(db: Session, item_id: int, weeks: int = 12, horizon_weeks: int = 8) -> dict:
    """Прогноз расхода по истории выдач: сглаживание Хольта (уровень + тренд) + сезонная оценка."""
    since = datetime.utcnow() - timedelta(weeks=weeks)
    moves = (db.query(StockMove).filter(StockMove.item_id == item_id, StockMove.move_type == MoveType.issue, StockMove.ts >= since)
             .order_by(StockMove.ts).all())
    buckets: dict[int, Decimal] = defaultdict(Decimal)
    for m in moves:
        buckets[(m.ts.date() - since.date()).days // 7] += m.qty
    series = [float(buckets.get(i, 0)) for i in range(weeks)]
    level, trend, alpha, beta = series[0] if series else 0.0, 0.0, 0.4, 0.2
    for x in series[1:]:
        prev = level
        level = alpha * x + (1 - alpha) * (level + trend)
        trend = beta * (level - prev) + (1 - beta) * trend
    forecast = [max(level + (i + 1) * trend, 0.0) for i in range(horizon_weeks)]
    sigma = statistics.pstdev(series) if len(series) > 1 else 0.0
    item = db.get(Item, item_id)
    lead_w = max(item.lead_time_days / 7, 0.5) if item else 1
    avg = statistics.fmean(series) if series else 0
    safety = 1.65 * sigma * (lead_w ** 0.5)  # уровень сервиса 95 %
    rop = avg * lead_w + safety
    stock = sum((b.qty for b in db.query(StockBalance).filter(StockBalance.item_id == item_id)), Decimal(0))
    weeks_cover = float(stock) / avg if avg else None
    return {"item_id": item_id, "history": series, "forecast": [round(f, 2) for f in forecast],
            "avg_weekly": round(avg, 2), "sigma": round(sigma, 2), "safety_stock": round(safety, 2),
            "reorder_point": round(rop, 2), "stock": float(stock), "weeks_of_cover": round(weeks_cover, 1) if weeks_cover else None,
            "recommendation": "Пора заказывать" if avg and float(stock) <= rop else "Запас достаточен"}


def supplier_performance(db: Session) -> list[dict]:
    """Надёжность поставщиков: доля вовремя, задержка, брак на входном контроле."""
    from ..models import Partner

    out = []
    for partner in db.query(Partner).all():
        lines = (db.query(POLine).join(PurchaseOrder).filter(PurchaseOrder.partner_id == partner.id,
                                                              POLine.received_qty > 0).all())
        if not lines:
            continue
        on_time = late_days = 0
        for ln in lines:
            insp = db.query(Inspection).filter(Inspection.po_line_id == ln.id).order_by(Inspection.id).first()
            due = ln.due_date or ln.order.due_date
            if insp and due:
                d = (insp.created_at.date() - due).days
                if d <= 0:
                    on_time += 1
                else:
                    late_days += d
        ids = [ln.id for ln in lines]
        rej = db.query(func.sum(Inspection.rejected_qty)).filter(Inspection.po_line_id.in_(ids)).scalar() or 0
        tot = db.query(func.sum(Inspection.qty)).filter(Inspection.po_line_id.in_(ids)).scalar() or 0
        n = len(lines)
        score = round((on_time / n) * 70 + (1 - float(rej) / float(tot) if tot else 1) * 30, 1)
        out.append({"partner_id": partner.id, "name": partner.name, "kind": partner.kind, "lines": n,
                    "on_time_pct": round(on_time * 100 / n, 1), "avg_delay_days": round(late_days / max(n - on_time, 1), 1),
                    "reject_pct": round(float(rej) * 100 / float(tot), 1) if tot else 0.0, "score": score})
    out.sort(key=lambda r: -r["score"])
    return out


def risk_items(db: Session, limit: int = 30) -> list[dict]:
    """Позиции риска: длинный цикл × отсутствие заказа × ниже минимального запаса / точки заказа."""
    out = []
    stock = {i: Decimal(q or 0) for i, q in db.query(StockBalance.item_id, func.sum(StockBalance.qty)).group_by(StockBalance.item_id)}
    on_order = {i: Decimal(q or 0) for i, q in db.query(POLine.item_id, func.sum(POLine.qty - POLine.received_qty)).join(PurchaseOrder)
                .filter(PurchaseOrder.status.in_([POStatus.sent, POStatus.confirmed, POStatus.partial])).group_by(POLine.item_id)}
    for it in db.query(Item).filter(Item.item_type.in_(["purchased", "fastener", "material", "outsourced"])).all():
        s, o = stock.get(it.id, Decimal(0)), on_order.get(it.id, Decimal(0))
        risk = 0.0
        reasons = []
        if s < it.min_stock:
            risk += 40
            reasons.append("ниже минимального запаса")
        if it.lead_time_days >= 30:
            risk += 25
            reasons.append(f"долгий цикл {it.lead_time_days} дн")
        if o == 0 and s <= it.min_stock:
            risk += 25
            reasons.append("нет открытых заказов")
        if not it.default_supplier_id:
            risk += 10
            reasons.append("нет основного поставщика")
        if risk >= 35:
            out.append({"item_id": it.id, "code": it.code, "name": it.name, "stock": s, "on_order": o,
                        "min_stock": it.min_stock, "lead_time_days": it.lead_time_days, "risk": risk, "reasons": reasons})
    out.sort(key=lambda r: -r["risk"])
    return out[:limit]


def workload(db: Session, weeks: int = 8) -> list[dict]:
    """Загрузка рабочих центров по открытым нарядам (н-ч) против мощности."""
    from ..models import WorkCenter

    wcs = {w.id: w for w in db.query(WorkCenter).all()}
    load: dict[int, Decimal] = defaultdict(Decimal)
    for wo in db.query(WorkOrder).filter(WorkOrder.status.in_(["planned", "released", "in_progress"])).all():
        rest = wo.qty - wo.done_qty
        for op in wo.item.operations:
            if not op.outsourced and op.work_center_id:
                load[op.work_center_id] += rest * Decimal(op.run_hours or 0) + Decimal(op.setup_hours or 0)
    out = []
    for wid, w in wcs.items():
        cap = Decimal(w.capacity_hours_per_day) * 5 * weeks
        out.append({"work_center": w.name, "code": w.code, "load_hours": float(load.get(wid, 0)), "capacity_hours": float(cap),
                    "utilization_pct": round(float(load.get(wid, 0)) * 100 / float(cap), 1) if cap else 0})
    return out
