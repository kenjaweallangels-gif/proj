"""Адаптивный импорт из Excel.

Шаги: найти строку-шапку → распознать колонки по синонимам (и опционально ИИ) →
показать пользователю предпросмотр с маппингом → применить.
Поддерживает плоские спецификации (код/родитель/кол-во), вложенность по уровню
(колонка «Уровень» или отступы в обозначении), остатки и товарный план.
"""
from __future__ import annotations

import io
import re
from decimal import Decimal, InvalidOperation

import openpyxl
from sqlalchemy.orm import Session

from ..models import BomLine, Item, ItemType, Lifecycle, OutsourceKind, PlanLine
from ..schemas import ImportPreview

# Целевое поле → синонимы в шапке (в нижнем регистре, без лишних пробелов)
SYNONYMS: dict[str, list[str]] = {
    "code": ["код", "обозначение", "артикул", "децимальный номер", "номер", "шифр", "code", "part number", "p/n", "обозн."],
    "name": ["наименование", "название", "имя", "name", "description", "описание"],
    "parent": ["родитель", "входит в", "сборка", "parent", "куда входит", "обозначение сборки", "узел"],
    "qty": ["кол-во", "количество", "кол.", "qty", "quantity", "к-во", "кол"],
    "unit": ["ед.", "ед.изм", "ед. изм.", "единица", "unit", "ед"],
    "level": ["уровень", "level", "ур."],
    "item_type": ["тип", "раздел", "вид", "type", "категория"],
    "material": ["материал", "material", "марка"],
    "mass": ["масса", "вес", "mass", "weight"],
    "price": ["цена", "стоимость", "price", "cost"],
    "lead_time": ["срок", "цикл", "lead time", "срок поставки"],
    "supplier": ["поставщик", "изготовитель", "supplier", "vendor"],
    "note": ["примечание", "прим.", "note", "комментарий", "зона", "формат"],
    "stock": ["остаток", "на складе", "stock", "наличие"],
    "warehouse": ["склад", "warehouse"],
    "due_date": ["срок", "дата", "due", "дата отгрузки"],
    "customer": ["заказчик", "клиент", "customer"],
}

TYPE_WORDS = {
    ItemType.assembly: ["сборочн", "сб", "assembly", "узел", "сборка"],
    ItemType.part: ["детал", "part", "дет"],
    ItemType.purchased: ["покуп", "пки", "purchased", "прочие изделия", "комплектующ"],
    ItemType.fastener: ["крепёж", "крепеж", "стандартн", "fastener", "болт", "гайка", "винт", "шайба"],
    ItemType.material: ["материал", "material", "прокат", "лист", "круг"],
    ItemType.outsourced: ["кооперац", "аутсорс", "outsourc", "на стороне"],
    ItemType.outsourced_op: ["покрыти", "гальван", "термообр", "операц"],
    ItemType.tooling: ["оснастк", "приспособ", "tooling", "штамп", "пресс-форм"],
    ItemType.product: ["изделие", "товар", "product"],
}


def _indent(v) -> int:
    """Отступ в ячейке (пробелы/табы в начале) — так часто оформляют вложенность в Excel."""
    if v is None or not isinstance(v, str):
        return 0
    n = 0
    for ch in v:
        if ch == " ":
            n += 1
        elif ch == "\t":
            n += 4
        elif ch == "\u00a0":
            n += 1
        else:
            break
    return n


def _norm(s) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip().lower()


def guess_mapping(columns: list[str]) -> dict[str, str | None]:
    mapping: dict[str, str | None] = {k: None for k in SYNONYMS}
    used = set()
    for field, syns in SYNONYMS.items():
        for col in columns:
            if col in used:
                continue
            n = _norm(col)
            if any(n == s or n.startswith(s) for s in syns):
                mapping[field] = col
                used.add(col)
                break
    return mapping


def guess_type(text: str, has_children: bool, code: str = "") -> ItemType:
    t = _norm(text)
    for typ, words in TYPE_WORDS.items():
        if any(w in t for w in words):
            return typ
    c = _norm(code)
    if re.search(r"гост|din|iso|ост", c):
        return ItemType.fastener
    if re.search(r"\.?\s?сб$|сб\b", c):
        return ItemType.assembly
    return ItemType.assembly if has_children else ItemType.part


def read_sheet(data: bytes, sheet: str | None = None, header_row: int | None = None) -> tuple[str, int, list[str], list[dict]]:
    wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    ws = wb[sheet] if sheet else wb[wb.sheetnames[0]]
    rows = [list(r) for r in ws.iter_rows(values_only=True)]
    if header_row is None:
        # шапка — первая строка, где ≥2 ячеек совпадают с синонимами
        best, best_score = 0, 0
        for i, r in enumerate(rows[:50]):
            score = sum(1 for c in r if any(_norm(c) == s or (_norm(c) and _norm(c).startswith(s)) for syns in SYNONYMS.values() for s in syns))
            if score > best_score:
                best, best_score = i, score
        header_row = best
    header = [str(c).strip() if c is not None else f"col{j+1}" for j, c in enumerate(rows[header_row])]
    out = []
    for r in rows[header_row + 1:]:
        if r is None or all(c is None or str(c).strip() == "" for c in r):
            continue
        out.append({header[j]: r[j] for j in range(min(len(header), len(r)))})
    return ws.title, header_row, header, out


def preview(data: bytes, sheet: str | None = None, header_row: int | None = None) -> ImportPreview:
    title, hr, header, rows = read_sheet(data, sheet, header_row)
    mapping = guess_mapping(header)
    warnings = []
    if not mapping.get("code"):
        warnings.append("Не найдена колонка с обозначением/кодом — укажите вручную")
    if not mapping.get("parent") and not mapping.get("level"):
        warnings.append("Нет колонки «Родитель» или «Уровень» — все строки будут подчинены корню")
    sample = [{k: (str(v) if v is not None else "") for k, v in r.items()} for r in rows[:8]]
    indent = False
    if not mapping.get("parent") and not mapping.get("level"):
        cols = [c for c in (mapping.get("code"), mapping.get("name")) if c]
        indent = any(_indent(r.get(c)) > 0 for r in rows for c in cols)
        if indent:
            warnings = [w for w in warnings if not w.startswith("Нет колонки")]
            warnings.append("Вложенность определена по отступам в ячейках")
    return ImportPreview(sheet=title, header_row=hr, columns=header, mapping=mapping, rows_total=len(rows),
                         sample=sample, warnings=warnings, indent_detected=indent)


def _dec(v, default=Decimal(1)) -> Decimal:
    if v is None or str(v).strip() == "":
        return default
    try:
        return Decimal(str(v).replace(",", ".").replace(" ", ""))
    except InvalidOperation:
        return default


def _code(v) -> str:
    s = str(v or "").strip()
    if re.fullmatch(r"\d+\.0+", s):  # число, прочитанное как float: 12345.0 → 12345
        s = s.split(".")[0]
    return s.upper()


def apply_bom(db: Session, data: bytes, mapping: dict[str, str | None], sheet: str | None, header_row: int | None,
              root_code: str | None = None, as_revision: bool = True) -> dict:
    from . import bom as bom_svc

    _, _, _, rows = read_sheet(data, sheet, header_row)
    m = {k: v for k, v in mapping.items() if v}
    recs = []
    for r in rows:
        code = _code(r.get(m.get("code", ""), ""))
        if not code:
            continue
        recs.append({
            "indent": max(_indent(r.get(m.get("code", ""))), _indent(r.get(m.get("name", "")))),
            "code": code, "name": str(r.get(m.get("name", ""), "") or code).strip(),
            "parent": _code(r.get(m.get("parent", ""), "")) if "parent" in m else "",
            "level": int(_dec(r.get(m.get("level", "")), Decimal(0))) if "level" in m else None,
            "qty": _dec(r.get(m.get("qty", ""))), "unit": str(r.get(m.get("unit", ""), "") or "шт").strip(),
            "type_text": str(r.get(m.get("item_type", ""), "") or ""), "material": str(r.get(m.get("material", ""), "") or ""),
            "price": _dec(r.get(m.get("price", "")), Decimal(0)), "note": str(r.get(m.get("note", ""), "") or ""),
            "lead": int(_dec(r.get(m.get("lead_time", "")), Decimal(10))) if "lead_time" in m else None,
        })
    # вложенность отступами → уровни (ранг отступа среди встретившихся)
    if recs and all(not r["parent"] for r in recs) and all(r["level"] is None for r in recs) and any(r["indent"] > 0 for r in recs):
        ranks = {ind: i for i, ind in enumerate(sorted({r["indent"] for r in recs}))}
        for r in recs:
            r["level"] = ranks[r["indent"]]
    # восстановление родителя по уровню (если нет явной колонки)
    if recs and all(not r["parent"] for r in recs) and any(r["level"] is not None for r in recs):
        stack: list[tuple[int, str]] = []
        for r in recs:
            lvl = r["level"] or 0
            while stack and stack[-1][0] >= lvl:
                stack.pop()
            r["parent"] = stack[-1][1] if stack else ""
            stack.append((lvl, r["code"]))
    parents = {r["parent"] for r in recs if r["parent"]}
    roots = [r for r in recs if not r["parent"]]
    if root_code:
        root_code = _code(root_code)
        for r in roots:
            r["parent"] = root_code
        if root_code not in {r["code"] for r in recs}:
            recs.insert(0, {"code": root_code, "name": root_code, "parent": "", "level": 0, "qty": Decimal(1), "unit": "шт",
                            "type_text": "изделие", "material": "", "price": Decimal(0), "note": "", "lead": None, "indent": 0})
        parents.add(root_code)

    created = updated = 0
    items: dict[str, Item] = {}
    for r in recs:
        it = db.query(Item).filter(Item.code == r["code"]).first()
        has_children = r["code"] in parents
        if not it:
            it = Item(code=r["code"], name=r["name"], item_type=guess_type(r["type_text"], has_children, r["code"]),
                      unit=r["unit"], material=r["material"], std_cost=r["price"], lead_time_days=r["lead"] or 10)
            if it.item_type in (ItemType.outsourced_op,):
                it.outsource_kind = OutsourceKind.coating
            db.add(it)
            created += 1
        else:
            if r["name"] and it.name != r["name"]:
                it.name = r["name"]
            if r["price"]:
                it.std_cost = r["price"]
            if has_children and it.item_type in (ItemType.part, ItemType.purchased):
                it.item_type = ItemType.assembly
            updated += 1
        items[r["code"]] = it
    db.flush()

    # состав: группируем по родителю
    by_parent: dict[str, list[dict]] = {}
    for r in recs:
        if r["parent"]:
            by_parent.setdefault(r["parent"], []).append(r)
    missing_parents = [p for p in by_parent if p not in items]
    for p in missing_parents:
        it = Item(code=p, name=p, item_type=ItemType.assembly)
        db.add(it)
        items[p] = it
        created += 1
    db.flush()
    revisions = 0
    for pcode, children in by_parent.items():
        parent = items[pcode]
        rev = bom_svc.ensure_draft_revision(db, parent, note="Импорт из Excel") if as_revision else parent.current_revision
        if rev is None:
            rev = bom_svc.ensure_draft_revision(db, parent, note="Импорт из Excel")
        for ln in list(rev.lines):
            db.delete(ln)
        db.flush()
        for pos, ch in enumerate(children, 1):
            db.add(BomLine(parent_revision_id=rev.id, child_item_id=items[ch["code"]].id, qty=ch["qty"], position=pos, note=ch["note"]))
        db.flush()
        db.refresh(rev)
        bom_svc.release_revision(db, rev)
        revisions += 1
    db.flush()
    return {"items_created": created, "items_updated": updated, "revisions_released": revisions,
            "roots": [r["code"] for r in recs if not r["parent"]], "missing_parents_created": missing_parents}


def apply_plan(db: Session, data: bytes, mapping: dict[str, str | None], sheet, header_row) -> dict:
    from datetime import date, datetime

    _, _, _, rows = read_sheet(data, sheet, header_row)
    m = {k: v for k, v in mapping.items() if v}
    n = 0
    for r in rows:
        code = _code(r.get(m.get("code", ""), ""))
        it = db.query(Item).filter(Item.code == code).first()
        if not it:
            continue
        d = r.get(m.get("due_date", ""))
        if isinstance(d, datetime):
            d = d.date()
        elif isinstance(d, str):
            try:
                d = datetime.strptime(d.strip(), "%d.%m.%Y").date()
            except ValueError:
                d = date.today()
        elif not isinstance(d, date):
            d = date.today()
        db.add(PlanLine(item_id=it.id, qty=_dec(r.get(m.get("qty", ""))), due_date=d,
                        customer=str(r.get(m.get("customer", ""), "") or "")))
        n += 1
    db.flush()
    return {"plan_lines_created": n}


def apply_stock(db: Session, data: bytes, mapping: dict[str, str | None], sheet, header_row, user_id=None) -> dict:
    from ..models import MoveType
    from . import stock as stock_svc

    _, _, _, rows = read_sheet(data, sheet, header_row)
    m = {k: v for k, v in mapping.items() if v}
    n = 0
    for r in rows:
        code = _code(r.get(m.get("code", ""), ""))
        it = db.query(Item).filter(Item.code == code).first()
        if not it:
            continue
        qty = _dec(r.get(m.get("stock", m.get("qty", ""))), Decimal(0))
        if qty <= 0:
            continue
        stock_svc.post_move(db, move_type=MoveType.adjustment, item_id=it.id, qty=qty,
                            unit_cost=_dec(r.get(m.get("price", "")), Decimal(it.std_cost or 0)),
                            doc_ref="Импорт остатков", user_id=user_id)
        n += 1
    db.flush()
    return {"moves_created": n}
