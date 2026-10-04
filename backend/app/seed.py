"""Начальные данные: роли, администратор, склады, рабочие центры и демо-изделие."""
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy.orm import Session

from .models import (
    BomLine,
    Item,
    ItemRevision,
    ItemType,
    Lifecycle,
    MoveType,
    Operation,
    OutsourceKind,
    Partner,
    PlanLine,
    Role,
    User,
    Warehouse,
    WorkCenter,
)
from .security import hash_password
from .services import stock as stock_svc

ROLES = [
    ("admin", "Администратор", ["*"]),
    ("designer", "Конструктор", ["items:read", "items:write", "bom:write", "ecn:create", "plan:read", "kits:read", "stock:read", "ai:use"]),
    ("chief_designer", "Главный конструктор", ["items:read", "items:write", "bom:write", "ecn:create", "ecn:approve", "ecn:implement",
                                               "plan:read", "kits:read", "stock:read", "analytics:read", "ai:use", "ai:cloud"]),
    ("technologist", "Технолог", ["items:read", "items:write", "ecn:approve", "plan:read", "wo:read", "stock:read", "finance:read", "ai:use"]),
    ("pdo", "ПДО (планово-диспетчерский отдел)", ["items:read", "items:write", "bom:write", "plan:read", "plan:write", "kits:read", "kits:write",
                                                   "wo:read", "wo:write", "stock:read", "purchase:read", "purchase:write", "ecn:create", "ecn:approve",
                                                   "analytics:read", "import:run", "ai:use"]),
    ("production_engineer", "Инженер производства", ["items:read", "plan:read", "kits:read", "wo:read", "wo:write", "stock:read", "ai:use"]),
    ("master", "Мастер участка", ["items:read", "kits:read", "kits:write", "wo:read", "wo:write", "stock:read", "stock:write"]),
    ("qc", "Инженер ОТК", ["items:read", "purchase:read", "qc:write", "stock:read", "analytics:read"]),
    ("omts", "ОМТС (снабжение)", ["items:read", "plan:read", "purchase:read", "purchase:write", "stock:read", "stock:write", "analytics:read", "import:run", "ai:use"]),
    ("opk", "ОПК (кооперация)", ["items:read", "plan:read", "purchase:read", "purchase:write", "stock:read", "analytics:read", "ai:use"]),
    ("storekeeper", "Кладовщик", ["items:read", "stock:read", "stock:write", "kits:read", "purchase:read"]),
    ("accountant", "Бухгалтер", ["items:read", "stock:read", "finance:read", "finance:write", "purchase:read", "analytics:read"]),
    ("management", "Руководство", ["items:read", "plan:read", "kits:read", "wo:read", "stock:read", "purchase:read", "finance:read",
                                   "analytics:read", "audit:read", "ai:use", "ai:cloud"]),
]

DEMO_USERS = [  # логин, ФИО, роль, отдел, допуск
    ("admin", "Администратор системы", "admin", "ИТ", 3),
    ("ivanov", "Иванов И.И.", "chief_designer", "КБ", 3),
    ("petrova", "Петрова А.С.", "designer", "КБ", 2),
    ("sidorov", "Сидоров П.Н.", "technologist", "ОГТ", 2),
    ("pdo", "Кузнецова Е.В.", "pdo", "ПДО", 2),
    ("master", "Смирнов В.А.", "master", "Цех 1", 1),
    ("otk", "Волкова Н.Д.", "qc", "ОТК", 1),
    ("omts", "Орлов Д.М.", "omts", "ОМТС", 1),
    ("opk", "Зайцев К.Р.", "opk", "ОПК", 1),
    ("director", "Директор по производству", "management", "Дирекция", 3),
]


def seed(db: Session, demo: bool = True) -> None:
    if db.query(Role).count():
        return
    roles = {}
    for code, name, perms in ROLES:
        r = Role(code=code, name=name, permissions=perms, is_system=True)
        db.add(r)
        roles[code] = r
    db.flush()
    for login, full, role, dept, cl in DEMO_USERS:
        u = User(login=login, full_name=full, department=dept, clearance=cl, password_hash=hash_password(f"{login}12345"))
        u.roles = [roles[role]]
        db.add(u)
    for code, name, kind in [("ОСН", "Основной склад", "main"), ("КАР", "Карантин / входной контроль", "quarantine"),
                             ("НЗП", "Незавершённое производство", "wip"), ("ГП", "Готовая продукция", "finished")]:
        db.add(Warehouse(code=code, name=name, kind=kind))
    wcs = {}
    for code, name, rate, cap in [("ТОК", "Токарный участок", 1800, 16), ("ФРЕЗ", "Фрезерный участок (ЧПУ)", 2400, 16),
                                  ("СВАР", "Сварочный участок", 1500, 8), ("СБ", "Участок сборки", 1200, 16), ("СЛ", "Слесарный участок", 1100, 8)]:
        w = WorkCenter(code=code, name=name, hourly_rate=rate, capacity_hours_per_day=cap)
        db.add(w)
        wcs[code] = w
    db.flush()
    if not demo:
        db.commit()
        return

    # --- контрагенты
    p_metal = Partner(name="ООО «МеталлСервис»", kind="supplier", inn="7701234567", rating=4.5)
    p_pki = Partner(name="АО «ЭлектроКомплект»", kind="supplier", inn="7807654321", rating=4.1)
    p_galv = Partner(name="ООО «Гальваника-Про»", kind="cooperator", outsource_kinds=["coating"], rating=3.8)
    p_cnc = Partner(name="ИП Фрезеров (мехобработка)", kind="cooperator", outsource_kinds=["machining"], rating=4.0)
    db.add_all([p_metal, p_pki, p_galv, p_cnc])
    db.flush()

    def item(code, name, t, **kw):
        it = Item(code=code, name=name, item_type=t, **kw)
        db.add(it)
        return it

    # --- номенклатура демо-изделия «Редуктор РЧ-100»
    product = item("РЧ-100.00.000", "Редуктор червячный РЧ-100", ItemType.product, lead_time_days=5, confidentiality=2)
    body_sb = item("РЧ-100.01.000", "Корпус в сборе", ItemType.assembly, lead_time_days=7)
    body = item("РЧ-100.01.001", "Корпус", ItemType.part, material="СЧ20", mass_kg=12.4, lead_time_days=20)
    cover = item("РЧ-100.01.002", "Крышка", ItemType.part, material="Ст3", mass_kg=1.1, lead_time_days=5)
    shaft_sb = item("РЧ-100.02.000", "Вал червячный в сборе", ItemType.assembly, lead_time_days=5)
    shaft = item("РЧ-100.02.001", "Вал-червяк", ItemType.part, material="Сталь 40Х", mass_kg=3.2, lead_time_days=12)
    wheel = item("РЧ-100.02.002", "Колесо червячное", ItemType.outsourced, outsource_kind=OutsourceKind.machining, std_cost=4800,
                 lead_time_days=25, default_supplier_id=p_cnc.id)
    coating = item("ОП-ЦИНК-9", "Цинкование Ц9.хр (операция)", ItemType.outsourced_op, outsource_kind=OutsourceKind.coating, std_cost=350,
                   lead_time_days=7, default_supplier_id=p_galv.id)
    bearing = item("ПОДШ 6206", "Подшипник 6206 ГОСТ 8338", ItemType.purchased, std_cost=420, lead_time_days=14, min_stock=20,
                   default_supplier_id=p_pki.id)
    seal = item("МАНЖ 1.1-30x52", "Манжета 1.1-30x52 ГОСТ 8752", ItemType.purchased, std_cost=95, lead_time_days=10, min_stock=30, default_supplier_id=p_pki.id)
    bolt = item("БОЛТ М8-6gx25.58", "Болт М8×25 ГОСТ 7798", ItemType.fastener, std_cost=6.5, lead_time_days=5, min_stock=500, lot_size=100,
                default_supplier_id=p_metal.id)
    nut = item("ГАЙКА М8-6H.5", "Гайка М8 ГОСТ 5915", ItemType.fastener, std_cost=2.1, lead_time_days=5, min_stock=500, lot_size=100,
               default_supplier_id=p_metal.id)
    oil = item("МАСЛО И-40А", "Масло индустриальное И-40А", ItemType.material, unit="л", std_cost=180, lead_time_days=7, default_supplier_id=p_metal.id)
    steel = item("КРУГ 60-40Х", "Круг 60 Сталь 40Х", ItemType.material, unit="кг", std_cost=95, lead_time_days=10, min_stock=100, default_supplier_id=p_metal.id)
    cast = item("ОТЛИВКА РЧ-100.01.001", "Отливка корпуса СЧ20", ItemType.purchased, std_cost=3200, lead_time_days=30, default_supplier_id=p_metal.id)
    jig = item("ПР-РЧ-100-01", "Приспособление для расточки корпуса", ItemType.tooling, lead_time_days=30)
    db.flush()

    def rev(it, lines, status=Lifecycle.released):
        r = ItemRevision(item_id=it.id, rev="01", status=status, released_at=None)
        db.add(r)
        db.flush()
        for pos, (ch, q) in enumerate(lines, 1):
            db.add(BomLine(parent_revision_id=r.id, child_item_id=ch.id, qty=Decimal(str(q)), position=pos))
        it.lifecycle = status
        return r

    rev(product, [(body_sb, 1), (shaft_sb, 1), (bearing, 4), (seal, 2), (bolt, 12), (nut, 12), (oil, 1.5)])
    rev(body_sb, [(body, 1), (cover, 1), (bolt, 6), (coating, 1)])
    rev(body, [(cast, 1)])
    rev(cover, [(steel, 0.8)])
    rev(shaft_sb, [(shaft, 1), (wheel, 1)])
    rev(shaft, [(steel, 4.5)])
    for leaf in (wheel, coating, bearing, seal, bolt, nut, oil, steel, cast, jig):
        db.add(ItemRevision(item_id=leaf.id, rev="01", status=Lifecycle.released))
        leaf.lifecycle = Lifecycle.released
    db.flush()

    # --- техпроцессы
    db.add_all([
        Operation(item_id=body.id, seq=10, name="Расточка посадочных отверстий", work_center_id=wcs["ФРЕЗ"].id, setup_hours=1.5, run_hours=2.2, tooling_item_id=jig.id),
        Operation(item_id=body.id, seq=20, name="Сверление и нарезание резьбы", work_center_id=wcs["ФРЕЗ"].id, setup_hours=0.5, run_hours=0.8),
        Operation(item_id=cover.id, seq=10, name="Лазерная резка", work_center_id=wcs["СЛ"].id, run_hours=0.2),
        Operation(item_id=cover.id, seq=20, name="Цинкование", outsourced=True, outsource_kind=OutsourceKind.coating, outsource_cost=120),
        Operation(item_id=shaft.id, seq=10, name="Токарная обработка", work_center_id=wcs["ТОК"].id, setup_hours=1, run_hours=1.6),
        Operation(item_id=shaft.id, seq=20, name="Фрезерование червяка", work_center_id=wcs["ФРЕЗ"].id, setup_hours=2, run_hours=3.5),
        Operation(item_id=shaft.id, seq=30, name="Термообработка ТВЧ", outsourced=True, outsource_kind=OutsourceKind.heat_treatment, outsource_cost=600),
        Operation(item_id=body_sb.id, seq=10, name="Сборка корпуса", work_center_id=wcs["СБ"].id, run_hours=0.6),
        Operation(item_id=shaft_sb.id, seq=10, name="Напрессовка колеса", work_center_id=wcs["СБ"].id, run_hours=0.4),
        Operation(item_id=product.id, seq=10, name="Общая сборка и обкатка", work_center_id=wcs["СБ"].id, setup_hours=0.5, run_hours=2.5),
    ])
    # --- остатки
    for it, q in [(bearing, 10), (seal, 40), (bolt, 800), (nut, 300), (oil, 20), (steel, 60), (cast, 3), (cover, 2)]:
        stock_svc.post_move(db, move_type=MoveType.adjustment, item_id=it.id, qty=Decimal(q), unit_cost=Decimal(it.std_cost or 0), doc_ref="Начальные остатки")
    # --- товарный план
    db.add_all([PlanLine(item_id=product.id, qty=5, due_date=date.today() + timedelta(days=45), customer="ПАО «Заказчик»", priority=1),
                PlanLine(item_id=product.id, qty=3, due_date=date.today() + timedelta(days=90), customer="ООО «Дилер-Юг»", priority=3)])
    db.commit()
