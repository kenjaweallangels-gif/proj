"""Модель данных.

Ключевые идеи:
* Item (номенклатура) — единый справочник для всех типов изделий; тип задаёт поведение
  (делать / покупать / отдавать на кооперацию).
* Состав (BOM) хранится на уровне РЕВИЗИИ изделия, поэтому история состава не теряется:
  каждое извещение об изменении (ИИ) порождает новую ревизию со своим составом.
* Kit — конкретный комплект/экземпляр (заказ, заводской номер) с замороженным
  «развёрнутым» составом на момент запуска и отметками комплектации.
* Склад — журнал движений (StockMove, append-only) + материализованные остатки
  (StockBalance) для быстрых запросов на больших объёмах.
"""
from __future__ import annotations

import enum
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Table,
    Column,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base

Qty = Numeric(18, 4)
Money = Numeric(18, 2)


def _enum(e):
    return Enum(e, native_enum=False, length=32, validate_strings=True)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


# ---------------------------------------------------------------- доступ ---
user_roles = Table(
    "user_roles",
    Base.metadata,
    Column("user_id", ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("role_id", ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
)


class Role(Base):
    __tablename__ = "roles"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(64), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    permissions: Mapped[list] = mapped_column(JSON, default=list)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False)


class User(TimestampMixin, Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    login: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(200))
    email: Mapped[str] = mapped_column(String(200), default="")
    department: Mapped[str] = mapped_column(String(200), default="")
    password_hash: Mapped[str] = mapped_column(String(200))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    failed_logins: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Допуск к конфиденциальным данным (гостайна/КТ/коммерческая тайна — уровни 0..3)
    clearance: Mapped[int] = mapped_column(Integer, default=1)
    token_version: Mapped[int] = mapped_column(Integer, default=0)
    roles: Mapped[list[Role]] = relationship(secondary=user_roles, lazy="selectin")

    @property
    def permissions(self) -> set[str]:
        perms: set[str] = set()
        for r in self.roles:
            perms.update(r.permissions or [])
        return perms


class AuditLog(Base):
    """Неизменяемый журнал всех изменений (кто, что, когда, было/стало)."""

    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    action: Mapped[str] = mapped_column(String(64))
    entity: Mapped[str] = mapped_column(String(64), index=True)
    entity_id: Mapped[str] = mapped_column(String(64), default="")
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    source: Mapped[str] = mapped_column(String(32), default="ui")  # ui | ai | import | integration


# ----------------------------------------------------------- номенклатура ---
class ItemType(str, enum.Enum):
    assembly = "assembly"  # сборочная единица
    part = "part"  # деталь собственного изготовления
    purchased = "purchased"  # ПКИ
    outsourced = "outsourced"  # изготовление целиком на стороне (кооперация)
    outsourced_op = "outsourced_op"  # операция на стороне (покрытие, термообработка...)
    fastener = "fastener"  # крепёж / стандартные изделия
    material = "material"  # материалы (прокат, лакокраска)
    tooling = "tooling"  # оснастка для изготовления и сборки
    product = "product"  # товарное изделие (верхний уровень)


MAKE_TYPES = {ItemType.assembly, ItemType.part, ItemType.product}
BUY_TYPES = {ItemType.purchased, ItemType.fastener, ItemType.material}
OUTSOURCE_TYPES = {ItemType.outsourced, ItemType.outsourced_op}


class OutsourceKind(str, enum.Enum):
    machining = "machining"  # мехобработка
    coating = "coating"  # покрытие (гальваника, окраска, анодирование)
    heat_treatment = "heat_treatment"
    welding = "welding"
    casting = "casting"
    sheet_metal = "sheet_metal"
    pcb = "pcb"  # печатные платы / монтаж
    other = "other"


class Lifecycle(str, enum.Enum):
    draft = "draft"
    in_review = "in_review"
    released = "released"
    obsolete = "obsolete"


class Item(TimestampMixin, Base):
    __tablename__ = "items"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(100), unique=True, index=True)  # обозначение
    name: Mapped[str] = mapped_column(String(300), index=True)
    item_type: Mapped[ItemType] = mapped_column(_enum(ItemType), index=True)
    outsource_kind: Mapped[OutsourceKind | None] = mapped_column(_enum(OutsourceKind), nullable=True)
    unit: Mapped[str] = mapped_column(String(16), default="шт")
    material: Mapped[str] = mapped_column(String(200), default="")
    mass_kg: Mapped[Decimal | None] = mapped_column(Qty, nullable=True)
    description: Mapped[str] = mapped_column(Text, default="")
    lifecycle: Mapped[Lifecycle] = mapped_column(_enum(Lifecycle), default=Lifecycle.draft)
    # Уровень конфиденциальности (0 — открытые данные, 3 — максимум). Влияет на ИИ-маршрутизацию.
    confidentiality: Mapped[int] = mapped_column(Integer, default=1)
    lead_time_days: Mapped[int] = mapped_column(Integer, default=10)
    min_stock: Mapped[Decimal] = mapped_column(Qty, default=0)
    lot_size: Mapped[Decimal] = mapped_column(Qty, default=1)
    std_cost: Mapped[Decimal] = mapped_column(Money, default=0)  # цена покупки / кооперации за ед.
    default_supplier_id: Mapped[int | None] = mapped_column(ForeignKey("partners.id"), nullable=True)
    external_ids: Mapped[dict] = mapped_column(JSON, default=dict)  # {"1c": "...", "erp2": "..."}
    attrs: Mapped[dict] = mapped_column(JSON, default=dict)  # гибкие атрибуты (ГОСТ, класс прочности…)
    revisions: Mapped[list[ItemRevision]] = relationship(
        back_populates="item", order_by="ItemRevision.id", cascade="all, delete-orphan"
    )
    operations: Mapped[list[Operation]] = relationship(
        back_populates="item", order_by="Operation.seq", cascade="all, delete-orphan",
        foreign_keys="Operation.item_id",
    )

    @property
    def current_revision(self) -> ItemRevision | None:
        released = [r for r in self.revisions if r.status == Lifecycle.released]
        if released:
            return released[-1]
        return self.revisions[-1] if self.revisions else None


class ItemRevision(TimestampMixin, Base):
    __tablename__ = "item_revisions"
    __table_args__ = (UniqueConstraint("item_id", "rev"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"), index=True)
    rev: Mapped[str] = mapped_column(String(16))  # "01", "02" … (или литера)
    status: Mapped[Lifecycle] = mapped_column(_enum(Lifecycle), default=Lifecycle.draft)
    change_notice_id: Mapped[int | None] = mapped_column(ForeignKey("change_notices.id"), nullable=True)
    note: Mapped[str] = mapped_column(Text, default="")
    released_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    item: Mapped[Item] = relationship(back_populates="revisions")
    lines: Mapped[list[BomLine]] = relationship(
        back_populates="parent_revision",
        cascade="all, delete-orphan",
        order_by="BomLine.position",
        foreign_keys="BomLine.parent_revision_id",
    )


class BomLine(Base):
    __tablename__ = "bom_lines"
    __table_args__ = (Index("ix_bom_child", "child_item_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    parent_revision_id: Mapped[int] = mapped_column(ForeignKey("item_revisions.id", ondelete="CASCADE"), index=True)
    child_item_id: Mapped[int] = mapped_column(ForeignKey("items.id"))
    qty: Mapped[Decimal] = mapped_column(Qty, default=1)
    position: Mapped[int] = mapped_column(Integer, default=0)
    note: Mapped[str] = mapped_column(String(300), default="")
    parent_revision: Mapped[ItemRevision] = relationship(back_populates="lines", foreign_keys=[parent_revision_id])
    child: Mapped[Item] = relationship(lazy="joined")


class WorkCenter(Base):
    __tablename__ = "work_centers"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    hourly_rate: Mapped[Decimal] = mapped_column(Money, default=0)  # ставка, руб/н-ч (с накладными)
    capacity_hours_per_day: Mapped[Decimal] = mapped_column(Qty, default=16)


class Operation(Base):
    """Техпроцесс: операция маршрута (своя или на стороне)."""

    __tablename__ = "operations"
    id: Mapped[int] = mapped_column(primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"), index=True)
    seq: Mapped[int] = mapped_column(Integer, default=10)
    name: Mapped[str] = mapped_column(String(200))
    work_center_id: Mapped[int | None] = mapped_column(ForeignKey("work_centers.id"), nullable=True)
    setup_hours: Mapped[Decimal] = mapped_column(Qty, default=0)
    run_hours: Mapped[Decimal] = mapped_column(Qty, default=0)  # норма времени на 1 шт
    outsourced: Mapped[bool] = mapped_column(Boolean, default=False)
    outsource_kind: Mapped[OutsourceKind | None] = mapped_column(_enum(OutsourceKind), nullable=True)
    outsource_cost: Mapped[Decimal] = mapped_column(Money, default=0)  # за 1 шт
    tooling_item_id: Mapped[int | None] = mapped_column(ForeignKey("items.id"), nullable=True)
    item: Mapped[Item] = relationship(back_populates="operations", foreign_keys=[item_id])
    work_center: Mapped[WorkCenter | None] = relationship()


# --------------------------------------------- извещения об изменении (ИИ) ---
class ChangeStatus(str, enum.Enum):
    draft = "draft"
    review = "review"
    approved = "approved"
    rejected = "rejected"
    implemented = "implemented"


class ChangeNotice(TimestampMixin, Base):
    __tablename__ = "change_notices"
    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[str] = mapped_column(String(50), unique=True)
    title: Mapped[str] = mapped_column(String(300))
    reason: Mapped[str] = mapped_column(Text, default="")
    # код причины по ГОСТ 2.503: 1 — улучшение, 2 — ошибка КД, 3 — замена ПКИ/материала …
    reason_code: Mapped[str] = mapped_column(String(8), default="1")
    status: Mapped[ChangeStatus] = mapped_column(_enum(ChangeStatus), default=ChangeStatus.draft, index=True)
    urgency: Mapped[str] = mapped_column(String(16), default="normal")
    # что делать с заделом: use_up — использовать, rework — доработать, scrap — списать
    wip_disposition: Mapped[str] = mapped_column(String(16), default="use_up")
    author_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    implemented_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    lines: Mapped[list[ChangeLine]] = relationship(back_populates="notice", cascade="all, delete-orphan")
    approvals: Mapped[list[Approval]] = relationship(back_populates="notice", cascade="all, delete-orphan")
    author: Mapped[User | None] = relationship()


class ChangeAction(str, enum.Enum):
    add = "add"
    remove = "remove"
    set_qty = "set_qty"
    replace = "replace"


class ChangeLine(Base):
    __tablename__ = "change_lines"
    id: Mapped[int] = mapped_column(primary_key=True)
    notice_id: Mapped[int] = mapped_column(ForeignKey("change_notices.id", ondelete="CASCADE"), index=True)
    target_item_id: Mapped[int] = mapped_column(ForeignKey("items.id"))  # чей состав меняем
    action: Mapped[ChangeAction] = mapped_column(_enum(ChangeAction))
    child_item_id: Mapped[int | None] = mapped_column(ForeignKey("items.id"), nullable=True)
    new_child_item_id: Mapped[int | None] = mapped_column(ForeignKey("items.id"), nullable=True)
    qty: Mapped[Decimal | None] = mapped_column(Qty, nullable=True)
    comment: Mapped[str] = mapped_column(String(500), default="")
    notice: Mapped[ChangeNotice] = relationship(back_populates="lines")
    target_item: Mapped[Item] = relationship(foreign_keys=[target_item_id])
    child_item: Mapped[Item | None] = relationship(foreign_keys=[child_item_id])
    new_child_item: Mapped[Item | None] = relationship(foreign_keys=[new_child_item_id])


class Approval(Base):
    __tablename__ = "approvals"
    id: Mapped[int] = mapped_column(primary_key=True)
    notice_id: Mapped[int] = mapped_column(ForeignKey("change_notices.id", ondelete="CASCADE"), index=True)
    role_code: Mapped[str] = mapped_column(String(64))  # чья подпись нужна
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    decision: Mapped[str] = mapped_column(String(16), default="pending")  # pending|approved|rejected
    comment: Mapped[str] = mapped_column(Text, default="")
    decided_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    notice: Mapped[ChangeNotice] = relationship(back_populates="approvals")
    user: Mapped[User | None] = relationship()


# ----------------------------------------------------------- контрагенты ---
class Partner(TimestampMixin, Base):
    __tablename__ = "partners"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(300))
    inn: Mapped[str] = mapped_column(String(20), default="")
    kind: Mapped[str] = mapped_column(String(16), default="supplier")  # supplier | cooperator | both
    outsource_kinds: Mapped[list] = mapped_column(JSON, default=list)
    contact: Mapped[str] = mapped_column(String(300), default="")
    rating: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=0)
    external_ids: Mapped[dict] = mapped_column(JSON, default=dict)


# ----------------------------------------------------------------- склад ---
class Warehouse(Base):
    __tablename__ = "warehouses"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(16), default="main")  # main | quarantine | wip | finished | scrap


class MoveType(str, enum.Enum):
    receipt = "receipt"  # приход от поставщика/кооператора
    issue = "issue"  # выдача в производство (списание на заказ)
    output = "output"  # выпуск из производства
    transfer = "transfer"
    writeoff = "writeoff"  # списание (брак, утрата)
    adjustment = "adjustment"  # инвентаризация
    to_outsource = "to_outsource"  # передача давальческого сырья кооператору


class StockMove(Base):
    __tablename__ = "stock_moves"
    __table_args__ = (Index("ix_move_item_ts", "item_id", "ts"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
    move_type: Mapped[MoveType] = mapped_column(_enum(MoveType), index=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id"))
    qty: Mapped[Decimal] = mapped_column(Qty)
    from_wh_id: Mapped[int | None] = mapped_column(ForeignKey("warehouses.id"), nullable=True)
    to_wh_id: Mapped[int | None] = mapped_column(ForeignKey("warehouses.id"), nullable=True)
    unit_cost: Mapped[Decimal] = mapped_column(Money, default=0)
    lot: Mapped[str] = mapped_column(String(64), default="")
    doc_ref: Mapped[str] = mapped_column(String(100), default="")  # ссылка на заказ/накладную
    kit_id: Mapped[int | None] = mapped_column(ForeignKey("kits.id"), nullable=True)
    work_order_id: Mapped[int | None] = mapped_column(ForeignKey("work_orders.id"), nullable=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    comment: Mapped[str] = mapped_column(String(300), default="")
    item: Mapped[Item] = relationship()


class StockBalance(Base):
    """Материализованный остаток: (номенклатура, склад) → количество и средняя цена."""

    __tablename__ = "stock_balances"
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id"), primary_key=True)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id"), primary_key=True)
    qty: Mapped[Decimal] = mapped_column(Qty, default=0)
    reserved: Mapped[Decimal] = mapped_column(Qty, default=0)
    avg_cost: Mapped[Decimal] = mapped_column(Money, default=0)
    item: Mapped[Item] = relationship()
    warehouse: Mapped[Warehouse] = relationship()


# -------------------------------------------------- закупки и кооперация ---
class POStatus(str, enum.Enum):
    draft = "draft"
    sent = "sent"
    confirmed = "confirmed"
    partial = "partial"
    received = "received"
    closed = "closed"
    cancelled = "cancelled"


class PurchaseOrder(TimestampMixin, Base):
    __tablename__ = "purchase_orders"
    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[str] = mapped_column(String(50), unique=True)
    kind: Mapped[str] = mapped_column(String(16), default="purchase")  # purchase (ОМТС) | outsource (ОПК)
    partner_id: Mapped[int] = mapped_column(ForeignKey("partners.id"))
    status: Mapped[POStatus] = mapped_column(_enum(POStatus), default=POStatus.draft, index=True)
    order_date: Mapped[date] = mapped_column(Date, default=date.today)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    responsible_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    comment: Mapped[str] = mapped_column(Text, default="")
    partner: Mapped[Partner] = relationship()
    lines: Mapped[list[POLine]] = relationship(back_populates="order", cascade="all, delete-orphan")


class POLine(Base):
    __tablename__ = "po_lines"
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("purchase_orders.id", ondelete="CASCADE"), index=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id"), index=True)
    qty: Mapped[Decimal] = mapped_column(Qty)
    received_qty: Mapped[Decimal] = mapped_column(Qty, default=0)
    price: Mapped[Decimal] = mapped_column(Money, default=0)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    kit_id: Mapped[int | None] = mapped_column(ForeignKey("kits.id"), nullable=True)
    order: Mapped[PurchaseOrder] = relationship(back_populates="lines")
    item: Mapped[Item] = relationship()


# ------------------------------------------------------ входной контроль ---
class Inspection(TimestampMixin, Base):
    __tablename__ = "inspections"
    id: Mapped[int] = mapped_column(primary_key=True)
    po_line_id: Mapped[int | None] = mapped_column(ForeignKey("po_lines.id"), nullable=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id"), index=True)
    qty: Mapped[Decimal] = mapped_column(Qty)
    accepted_qty: Mapped[Decimal] = mapped_column(Qty, default=0)
    rejected_qty: Mapped[Decimal] = mapped_column(Qty, default=0)
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)  # pending|accepted|rejected|partial
    lot: Mapped[str] = mapped_column(String(64), default="")
    inspector_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    defects: Mapped[str] = mapped_column(Text, default="")
    certificate: Mapped[str] = mapped_column(String(200), default="")  # № сертификата/паспорта
    unit_cost: Mapped[Decimal] = mapped_column(Money, default=0)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    item: Mapped[Item] = relationship()
    po_line: Mapped[POLine | None] = relationship()


# ---------------------------------------------- планирование и комплекты ---
class PlanLine(TimestampMixin, Base):
    """Товарный план: сколько товарных изделий нужно к какой дате."""

    __tablename__ = "plan_lines"
    id: Mapped[int] = mapped_column(primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id"))
    qty: Mapped[Decimal] = mapped_column(Qty)
    due_date: Mapped[date] = mapped_column(Date, index=True)
    customer: Mapped[str] = mapped_column(String(200), default="")
    priority: Mapped[int] = mapped_column(Integer, default=5)
    status: Mapped[str] = mapped_column(String(16), default="planned")  # planned|launched|done
    item: Mapped[Item] = relationship()


class Kit(TimestampMixin, Base):
    """Конкретный комплект изделия (заказ/заводской номер) с фиксированной ревизией состава."""

    __tablename__ = "kits"
    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[str] = mapped_column(String(50), unique=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id"))
    revision_id: Mapped[int] = mapped_column(ForeignKey("item_revisions.id"))
    qty: Mapped[Decimal] = mapped_column(Qty, default=1)
    serial_numbers: Mapped[str] = mapped_column(String(500), default="")
    plan_line_id: Mapped[int | None] = mapped_column(ForeignKey("plan_lines.id"), nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="open")  # open|in_work|assembled|shipped
    item: Mapped[Item] = relationship()
    revision: Mapped[ItemRevision] = relationship()
    lines: Mapped[list[KitLine]] = relationship(
        back_populates="kit", cascade="all, delete-orphan", order_by="KitLine.path"
    )


class KitLine(Base):
    __tablename__ = "kit_lines"
    id: Mapped[int] = mapped_column(primary_key=True)
    kit_id: Mapped[int] = mapped_column(ForeignKey("kits.id", ondelete="CASCADE"), index=True)
    parent_line_id: Mapped[int | None] = mapped_column(ForeignKey("kit_lines.id"), nullable=True)
    path: Mapped[str] = mapped_column(String(500))  # материализованный путь "0001.0003.0002" — быстрые выборки поддеревьев
    level: Mapped[int] = mapped_column(Integer, default=0)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id"))
    qty_per: Mapped[Decimal] = mapped_column(Qty, default=1)
    required_qty: Mapped[Decimal] = mapped_column(Qty, default=1)
    issued_qty: Mapped[Decimal] = mapped_column(Qty, default=0)  # укомплектовано
    done: Mapped[bool] = mapped_column(Boolean, default=False)  # собрано / получено полностью
    skipped: Mapped[bool] = mapped_column(Boolean, default=False)  # шаг пропущен сборщиком
    done_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    done_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    note: Mapped[str] = mapped_column(String(300), default="")
    kit: Mapped[Kit] = relationship(back_populates="lines")
    item: Mapped[Item] = relationship(lazy="joined")
    done_by: Mapped[User | None] = relationship()


class ItemModel(Base):
    """3D-модель изделия/детали для виртуальной сборки (хранится как GLB на диске)."""

    __tablename__ = "item_models"
    id: Mapped[int] = mapped_column(primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"), unique=True, index=True)
    filename: Mapped[str] = mapped_column(String(300))  # исходное имя файла
    source_format: Mapped[str] = mapped_column(String(16))  # step | glb | gltf | stl | obj
    size: Mapped[int] = mapped_column(Integer, default=0)
    path: Mapped[str] = mapped_column(String(500))  # путь к GLB на диске
    node_count: Mapped[int] = mapped_column(Integer, default=0)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    uploaded_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    item: Mapped[Item] = relationship()


class WorkOrder(TimestampMixin, Base):
    """Производственное задание (наряд) для изготовления/сборки."""

    __tablename__ = "work_orders"
    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[str] = mapped_column(String(50), unique=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id"))
    qty: Mapped[Decimal] = mapped_column(Qty)
    done_qty: Mapped[Decimal] = mapped_column(Qty, default=0)
    kit_id: Mapped[int | None] = mapped_column(ForeignKey("kits.id"), nullable=True)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="planned", index=True)  # planned|released|in_progress|done
    master_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    actual_hours: Mapped[Decimal] = mapped_column(Qty, default=0)
    item: Mapped[Item] = relationship()


# --------------------------------------------------------- бухгалтерия ---
class JournalEntry(Base):
    """Упрощённые проводки по плану счетов РФ (10, 20, 43, 60, 90 …)."""

    __tablename__ = "journal_entries"
    id: Mapped[int] = mapped_column(primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
    debit: Mapped[str] = mapped_column(String(16))
    credit: Mapped[str] = mapped_column(String(16))
    amount: Mapped[Decimal] = mapped_column(Money)
    item_id: Mapped[int | None] = mapped_column(ForeignKey("items.id"), nullable=True)
    stock_move_id: Mapped[int | None] = mapped_column(ForeignKey("stock_moves.id"), nullable=True)
    memo: Mapped[str] = mapped_column(String(300), default="")
    exported: Mapped[bool] = mapped_column(Boolean, default=False)  # выгружено в 1С


# --------------------------------------------------------- интеграции ---
class Connector(TimestampMixin, Base):
    __tablename__ = "connectors"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(32))  # onec_odata | sql | rest
    config: Mapped[dict] = mapped_column(JSON, default=dict)  # URL, маппинг полей; секреты — в env/vault
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_status: Mapped[str] = mapped_column(Text, default="")


class AiMessage(Base):
    __tablename__ = "ai_messages"
    id: Mapped[int] = mapped_column(primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    conversation: Mapped[str] = mapped_column(String(64), index=True)
    role: Mapped[str] = mapped_column(String(16))
    content: Mapped[str] = mapped_column(Text)
    route: Mapped[str] = mapped_column(String(16), default="")  # local | cloud | rules
    meta: Mapped[dict] = mapped_column(JSON, default=dict)
