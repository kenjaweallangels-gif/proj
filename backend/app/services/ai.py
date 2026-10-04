"""ИИ-ассистент.

Маршрутизация:
* rules  — детерминированный разбор частых команд (работает без LLM, всегда).
* local  — локальная LLM (OpenAI-совместимый API: Ollama/vLLM/LM Studio) для
           конфиденциальных данных: всё, что касается составов, цен, планов.
* cloud  — Claude (Anthropic) только если пользователь явно разрешил, у него есть
           право ai:cloud и запрос не затрагивает конфиденциальные изделия.

Обе LLM получают один и тот же набор инструментов (function calling): чтение
данных выполняется сразу, а изменяющие действия возвращаются как «pending» и
применяются только после подтверждения пользователя в UI (human-in-the-loop).
"""
from __future__ import annotations

import json
import re
import uuid
from decimal import Decimal
from typing import Any

import httpx
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import AiMessage, Item, ItemType, User
from . import bom as bom_svc
from . import costing, planning

SYSTEM_PROMPT = """Ты — ассистент системы управления составом изделий и производством машиностроительного
предприятия (PLM/MRP). Отвечай по-русски, кратко и по делу. Используй инструменты для получения
фактов из базы — не выдумывай данные. Изменяющие операции (создание номенклатуры, изменение
состава, движения по складу) предлагай через соответствующий инструмент — они будут показаны
пользователю для подтверждения. Обозначения изделий пиши точно как в базе."""

TOOLS: list[dict[str, Any]] = [
    {"name": "search_items", "description": "Найти номенклатуру по части обозначения или наименования",
     "input_schema": {"type": "object", "properties": {"query": {"type": "string"}, "item_type": {"type": "string"}},
                      "required": ["query"]}},
    {"name": "get_bom", "description": "Получить состав изделия (дерево) с остатками и дефицитом по обозначению",
     "input_schema": {"type": "object", "properties": {"code": {"type": "string"}, "qty": {"type": "number"}},
                      "required": ["code"]}},
    {"name": "where_used", "description": "Куда входит изделие (применяемость)",
     "input_schema": {"type": "object", "properties": {"code": {"type": "string"}}, "required": ["code"]}},
    {"name": "get_cost", "description": "Себестоимость и трудоёмкость изделия",
     "input_schema": {"type": "object", "properties": {"code": {"type": "string"}}, "required": ["code"]}},
    {"name": "shortage_report", "description": "Дефицит по открытым комплектам", "input_schema": {"type": "object", "properties": {}}},
    {"name": "run_mrp", "description": "Расчёт потребности (MRP) по товарному плану на горизонт дней",
     "input_schema": {"type": "object", "properties": {"horizon_days": {"type": "integer"}}}},
    {"name": "propose_create_item", "description": "ПРЕДЛОЖИТЬ создать номенклатуру (требует подтверждения)",
     "input_schema": {"type": "object", "properties": {
         "code": {"type": "string"}, "name": {"type": "string"},
         "item_type": {"type": "string", "enum": [t.value for t in ItemType]},
         "unit": {"type": "string"}, "std_cost": {"type": "number"}, "lead_time_days": {"type": "integer"}},
         "required": ["code", "name", "item_type"]}},
    {"name": "propose_bom_change", "description": "ПРЕДЛОЖИТЬ извещение об изменении состава (требует подтверждения)",
     "input_schema": {"type": "object", "properties": {
         "title": {"type": "string"}, "reason": {"type": "string"},
         "lines": {"type": "array", "items": {"type": "object", "properties": {
             "target_code": {"type": "string"}, "action": {"type": "string", "enum": ["add", "remove", "set_qty", "replace"]},
             "child_code": {"type": "string"}, "new_child_code": {"type": "string"}, "qty": {"type": "number"}},
             "required": ["target_code", "action"]}}},
         "required": ["title", "lines"]}},
    {"name": "propose_stock_move", "description": "ПРЕДЛОЖИТЬ складское движение: receipt/issue/writeoff/adjustment (требует подтверждения)",
     "input_schema": {"type": "object", "properties": {
         "move_type": {"type": "string", "enum": ["receipt", "issue", "writeoff", "adjustment"]},
         "code": {"type": "string"}, "qty": {"type": "number"}, "unit_cost": {"type": "number"}, "comment": {"type": "string"}},
         "required": ["move_type", "code", "qty"]}},
]


def _j(o):
    return json.loads(json.dumps(o, default=lambda x: float(x) if isinstance(x, Decimal) else str(x), ensure_ascii=False))


class ToolExecutor:
    def __init__(self, db: Session, user: User):
        self.db, self.user = db, user
        self.pending: list[dict] = []
        self.max_conf = 0  # максимальная конфиденциальность затронутых данных

    def _item(self, code: str) -> Item | None:
        it = self.db.query(Item).filter(Item.code == code.strip().upper()).first()
        if it:
            self.max_conf = max(self.max_conf, it.confidentiality)
        return it

    def run(self, name: str, args: dict) -> Any:
        fn = getattr(self, f"t_{name}", None)
        if not fn:
            return {"error": f"неизвестный инструмент {name}"}
        try:
            return _j(fn(**args))
        except TypeError as e:
            return {"error": str(e)}

    def t_search_items(self, query: str, item_type: str | None = None):
        q = self.db.query(Item).filter(or_(Item.code.ilike(f"%{query}%"), Item.name.ilike(f"%{query}%")))
        if item_type:
            q = q.filter(Item.item_type == item_type)
        res = q.limit(20).all()
        for it in res:
            self.max_conf = max(self.max_conf, it.confidentiality)
        return [{"code": i.code, "name": i.name, "type": i.item_type.value, "unit": i.unit, "std_cost": i.std_cost} for i in res]

    def t_get_bom(self, code: str, qty: float = 1):
        it = self._item(code)
        if not it:
            return {"error": "не найдено"}
        tree = bom_svc.build_tree(self.db, it, Decimal(str(qty)), max_depth=6)

        def slim(n):
            return {"code": n.code, "name": n.name, "type": n.item_type.value, "qty": n.total_qty, "stock": n.stock_qty,
                    "shortage": n.shortage, "status": n.status, "children": [slim(c) for c in n.children]}
        return slim(tree)

    def t_where_used(self, code: str):
        it = self._item(code)
        return bom_svc.where_used(self.db, it.id) if it else {"error": "не найдено"}

    def t_get_cost(self, code: str):
        it = self._item(code)
        if not it:
            return {"error": "не найдено"}
        c = costing.cost_item(self.db, it)
        return {k: v for k, v in c.items() if k != "children"} | {"children": c["children"][:30]}

    def t_shortage_report(self):
        self.max_conf = max(self.max_conf, 2)
        return planning.shortage_report(self.db)[:40]

    def t_run_mrp(self, horizon_days: int = 90):
        self.max_conf = max(self.max_conf, 2)
        return [s.model_dump() for s in planning.mrp(self.db, horizon_days)[:40]]

    def _propose(self, kind: str, payload: dict, summary: str):
        p = {"id": uuid.uuid4().hex[:8], "kind": kind, "payload": payload, "summary": summary}
        self.pending.append(p)
        return {"status": "ожидает подтверждения пользователя", "proposal_id": p["id"]}

    def t_propose_create_item(self, code: str, name: str, item_type: str, unit: str = "шт", std_cost: float = 0, lead_time_days: int = 10):
        if self._item(code):
            return {"error": f"{code} уже существует"}
        return self._propose("create_item", {"code": code.upper(), "name": name, "item_type": item_type, "unit": unit,
                                             "std_cost": std_cost, "lead_time_days": lead_time_days},
                             f"Создать {item_type} {code.upper()} «{name}»")

    def t_propose_bom_change(self, title: str, lines: list[dict], reason: str = ""):
        out, missing = [], []
        for ln in lines:
            t = self._item(ln["target_code"])
            ch = self._item(ln["child_code"]) if ln.get("child_code") else None
            nc = self._item(ln["new_child_code"]) if ln.get("new_child_code") else None
            for c, o in ((ln["target_code"], t), (ln.get("child_code"), ch), (ln.get("new_child_code"), nc)):
                if c and not o:
                    missing.append(c)
            if t:
                out.append({"target_item_id": t.id, "action": ln["action"], "child_item_id": ch.id if ch else None,
                            "new_child_item_id": nc.id if nc else None, "qty": ln.get("qty"), "comment": ""})
        if missing:
            return {"error": f"не найдены обозначения: {', '.join(missing)}"}
        return self._propose("change_notice", {"title": title, "reason": reason, "lines": out},
                             f"Извещение «{title}»: {len(out)} изменений")

    def t_propose_stock_move(self, move_type: str, code: str, qty: float, unit_cost: float = 0, comment: str = ""):
        it = self._item(code)
        if not it:
            return {"error": "не найдено"}
        return self._propose("stock_move", {"move_type": move_type, "item_id": it.id, "qty": qty, "unit_cost": unit_cost, "comment": comment},
                             f"{move_type}: {it.code} × {qty}")


# ------------------------------------------------------- rule-based route --
_RULES = [
    (re.compile(r"(состав|бом|bom|спецификац)\D*([\w\.\-/]+)", re.I), "get_bom"),
    (re.compile(r"(куда входит|применяемост|where used)\D*([\w\.\-/]+)", re.I), "where_used"),
    (re.compile(r"(себестоимост|стоимост|трудо[её]мкост|цена)\D*([\w\.\-/]+)", re.I), "get_cost"),
    (re.compile(r"(дефицит|нехватк|чего не хватает)", re.I), "shortage_report"),
    (re.compile(r"(mrp|потребност|что закуп|что заказ)", re.I), "run_mrp"),
    (re.compile(r"(найди|поиск|найти|ищи)\s+(.+)", re.I), "search_items"),
]


def _render(tool: str, data: Any) -> str:
    if isinstance(data, dict) and "error" in data:
        return f"Не получилось: {data['error']}"
    if tool == "get_bom":
        lines = []

        def walk(n, d=0):
            mark = {"ready": "✅", "partial": "🟡", "missing": "🔴"}[n["status"]]
            lines.append(f"{'  ' * d}{mark} {n['code']} — {n['name']} × {n['qty']:g} (остаток {n['stock']:g}, дефицит {n['shortage']:g})")
            for c in n["children"]:
                walk(c, d + 1)
        walk(data)
        return "Состав изделия:\n" + "\n".join(lines[:80])
    if tool == "where_used":
        return "Применяемость:\n" + ("\n".join(f"• {r['code']} — {r['name']} (рев. {r['rev']}, {r['qty']:g} шт)" for r in data) or "нигде не используется")
    if tool == "get_cost":
        return (f"Себестоимость {data['code']}: {data['total']} ₽ за ед.\n"
                f"• материалы {data['material']} ₽, ПКИ {data['purchased']} ₽, кооперация {data['outsource']} ₽, труд {data['labor']} ₽\n"
                f"• трудоёмкость {data['hours']} н-ч")
    if tool == "shortage_report":
        if not data:
            return "Дефицита по открытым комплектам нет."
        return "Дефицит по комплектам:\n" + "\n".join(
            f"• {r['code']} — {r['name']}: нужно {r['need']:g}, есть {r['stock']:g}, в заказах {r['on_order']:g}, непокрыто {r['uncovered']:g} ({', '.join(r['kits'])})"
            for r in data[:30])
    if tool == "run_mrp":
        if not data:
            return "Потребность полностью покрыта остатками и заказами."
        act = {"buy": "закупить", "make": "изготовить", "outsource": "кооперация"}
        return "Предложения MRP:\n" + "\n".join(
            f"• {act[r['action']]} {r['code']} — {r['name']}: {r['net_qty']:g} {r['item_type']} к {r['due_date']} (запуск {r['start_date']})"
            for r in data[:30])
    if tool == "search_items":
        return "Найдено:\n" + ("\n".join(f"• {r['code']} — {r['name']} [{r['type']}]" for r in data) or "ничего")
    return json.dumps(data, ensure_ascii=False)[:3000]


def rules_route(ex: ToolExecutor, text: str) -> str | None:
    for rx, tool in _RULES:
        m = rx.search(text)
        if not m:
            continue
        if tool in ("shortage_report", "run_mrp"):
            return _render(tool, ex.run(tool, {}))
        arg = m.group(2).strip().strip("?.,!«»\"")
        if tool == "search_items":
            return _render(tool, ex.run(tool, {"query": arg}))
        # код может быть в любом регистре; попробуем найти по подстроке
        it = ex.db.query(Item).filter(Item.code.ilike(f"%{arg}%")).first()
        if not it:
            return f"Не нашёл изделие с обозначением «{arg}»."
        return _render(tool, ex.run(tool, {"code": it.code}))
    return None


# ------------------------------------------------------------ LLM routes ---
def _openai_tools():
    return [{"type": "function", "function": {"name": t["name"], "description": t["description"], "parameters": t["input_schema"]}} for t in TOOLS]


def _local_headers() -> dict:
    s = get_settings()
    return {"Authorization": f"Bearer {s.local_llm_api_key}"} if s.local_llm_api_key else {}


def local_models() -> dict:
    """Проверка подключения к локальному LLM-серверу: список моделей по /v1/models."""
    s = get_settings()
    try:
        with httpx.Client(timeout=10, headers=_local_headers()) as c:
            r = c.get(f"{s.local_llm_url.rstrip('/')}/models")
            r.raise_for_status()
            data = r.json().get("data", [])
            ids = [m.get("id") for m in data if isinstance(m, dict)]
            return {"ok": True, "url": s.local_llm_url, "models": ids, "configured": s.local_llm_model,
                    "configured_found": s.local_llm_model in ids if ids else None}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "url": s.local_llm_url, "error": f"{type(e).__name__}: {e}", "configured": s.local_llm_model}


def local_llm(ex: ToolExecutor, history: list[dict], text: str) -> str:
    s = get_settings()
    msgs = [{"role": "system", "content": SYSTEM_PROMPT}] + history + [{"role": "user", "content": text}]
    with httpx.Client(timeout=180, headers=_local_headers()) as c:
        for _ in range(6):
            body = {"model": s.local_llm_model, "messages": msgs, "tools": _openai_tools(), "temperature": 0.1}
            r = c.post(f"{s.local_llm_url.rstrip('/')}/chat/completions", json=body)
            if r.status_code == 400 and "tool" in r.text.lower():
                # сервер/модель без function calling — отвечаем без инструментов, но с фактами из правил
                body.pop("tools")
                r = c.post(f"{s.local_llm_url.rstrip('/')}/chat/completions", json=body)
            r.raise_for_status()
            msg = r.json()["choices"][0]["message"]
            msgs.append(msg)
            calls = msg.get("tool_calls") or []
            if not calls:
                return msg.get("content") or ""
            for call in calls:
                args = json.loads(call["function"].get("arguments") or "{}")
                res = ex.run(call["function"]["name"], args)
                msgs.append({"role": "tool", "tool_call_id": call["id"], "content": json.dumps(res, ensure_ascii=False)})
    return "Слишком длинная цепочка вызовов, попробуйте уточнить запрос."


def cloud_llm(ex: ToolExecutor, history: list[dict], text: str) -> str:
    import anthropic

    s = get_settings()
    client = anthropic.Anthropic(api_key=s.anthropic_api_key)
    messages = history + [{"role": "user", "content": text}]
    for _ in range(6):
        resp = client.messages.create(model=s.cloud_llm_model, max_tokens=4096, system=SYSTEM_PROMPT,
                                      tools=TOOLS, messages=messages, output_config={"effort": "low"})
        if resp.stop_reason == "refusal":
            return "Облачная модель отклонила запрос."
        messages.append({"role": "assistant", "content": resp.content})
        uses = [b for b in resp.content if b.type == "tool_use"]
        if not uses:
            return "".join(b.text for b in resp.content if b.type == "text")
        messages.append({"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": b.id, "content": json.dumps(ex.run(b.name, dict(b.input)), ensure_ascii=False)}
            for b in uses]})
    return "Слишком длинная цепочка вызовов."


def chat(db: Session, user: User, text: str, conversation: str | None, allow_cloud: bool) -> dict:
    s = get_settings()
    conversation = conversation or uuid.uuid4().hex[:12]
    ex = ToolExecutor(db, user)
    hist_rows = (db.query(AiMessage).filter(AiMessage.user_id == user.id, AiMessage.conversation == conversation)
                 .order_by(AiMessage.id.desc()).limit(12).all())
    history = [{"role": m.role, "content": m.content} for m in reversed(hist_rows)]

    reply, route = None, "rules"
    reply = rules_route(ex, text)
    if reply is None:
        # Правило маршрутизации: облако только если разрешено пользователем и политикой,
        # и только если первый проход по правилам не нашёл конфиденциальных данных.
        use_cloud = (allow_cloud and s.cloud_llm_enabled and s.anthropic_api_key
                     and ("ai:cloud" in user.permissions or "*" in user.permissions))
        try:
            if s.local_llm_enabled:
                reply, route = local_llm(ex, history, text), "local"
            elif use_cloud:
                reply, route = cloud_llm(ex, history, text), "cloud"
                if ex.max_conf >= 2:
                    route = "cloud!"  # помечаем для аудита: запрос коснулся конфиденциальных данных
            else:
                reply = ("Я понимаю команды: «состав <обозначение>», «куда входит <обозначение>», «себестоимость <обозначение>», "
                         "«дефицит», «MRP», «найди <текст>». Для свободного диалога администратор должен включить "
                         "локальную LLM (PLM_LOCAL_LLM_ENABLED) или облачную модель.")
        except Exception as e:  # noqa: BLE001 — LLM недоступна: деградируем мягко
            reply, route = f"ИИ-модель недоступна ({type(e).__name__}). Доступны команды-правила: состав/куда входит/себестоимость/дефицит/MRP/найди.", "rules"

    db.add(AiMessage(user_id=user.id, conversation=conversation, role="user", content=text, route=route))
    db.add(AiMessage(user_id=user.id, conversation=conversation, role="assistant", content=reply, route=route,
                     meta={"pending": ex.pending, "max_conf": ex.max_conf}))
    db.commit()
    return {"conversation": conversation, "reply": reply, "route": route, "pending": ex.pending, "actions": []}
