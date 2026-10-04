from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from .models import ChangeAction, ItemType, Lifecycle, MoveType, OutsourceKind


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---- auth
class LoginIn(BaseModel):
    login: str
    password: str


class TokenOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RoleOut(ORM):
    id: int
    code: str
    name: str
    description: str = ""
    permissions: list[str] = []


class UserOut(ORM):
    id: int
    login: str
    full_name: str
    email: str = ""
    department: str = ""
    is_active: bool = True
    clearance: int = 1
    roles: list[RoleOut] = []
    permissions: set[str] = set()


class UserIn(BaseModel):
    login: str
    full_name: str
    password: str | None = None
    email: str = ""
    department: str = ""
    clearance: int = 1
    is_active: bool = True
    role_codes: list[str] = []


class RoleIn(BaseModel):
    code: str
    name: str
    description: str = ""
    permissions: list[str] = []


# ---- items / bom
class ItemIn(BaseModel):
    code: str
    name: str
    item_type: ItemType
    outsource_kind: OutsourceKind | None = None
    unit: str = "шт"
    material: str = ""
    mass_kg: Decimal | None = None
    description: str = ""
    confidentiality: int = 1
    lead_time_days: int = 10
    min_stock: Decimal = Decimal(0)
    lot_size: Decimal = Decimal(1)
    std_cost: Decimal = Decimal(0)
    default_supplier_id: int | None = None
    attrs: dict = {}
    external_ids: dict = {}


class ItemPatch(BaseModel):
    name: str | None = None
    item_type: ItemType | None = None
    outsource_kind: OutsourceKind | None = None
    unit: str | None = None
    material: str | None = None
    mass_kg: Decimal | None = None
    description: str | None = None
    confidentiality: int | None = None
    lead_time_days: int | None = None
    min_stock: Decimal | None = None
    lot_size: Decimal | None = None
    std_cost: Decimal | None = None
    default_supplier_id: int | None = None
    lifecycle: Lifecycle | None = None
    attrs: dict | None = None
    external_ids: dict | None = None


class ItemOut(ORM):
    id: int
    code: str
    name: str
    item_type: ItemType
    outsource_kind: OutsourceKind | None = None
    unit: str
    material: str = ""
    mass_kg: Decimal | None = None
    description: str = ""
    lifecycle: Lifecycle
    confidentiality: int
    lead_time_days: int
    min_stock: Decimal
    lot_size: Decimal
    std_cost: Decimal
    default_supplier_id: int | None = None
    attrs: dict = {}
    external_ids: dict = {}
    current_rev: str | None = None
    stock_qty: Decimal | None = None


class BomLineIn(BaseModel):
    child_item_id: int
    qty: Decimal = Decimal(1)
    position: int = 0
    note: str = ""


class BomLineOut(ORM):
    id: int
    child_item_id: int
    qty: Decimal
    position: int
    note: str = ""
    child: ItemOut


class RevisionOut(ORM):
    id: int
    item_id: int
    rev: str
    status: Lifecycle
    change_notice_id: int | None = None
    note: str = ""
    released_at: datetime | None = None
    created_at: datetime | None = None
    lines: list[BomLineOut] = []


class BomTreeNode(BaseModel):
    item_id: int
    code: str
    name: str
    item_type: ItemType
    outsource_kind: OutsourceKind | None = None
    rev: str | None = None
    unit: str
    qty_per: Decimal
    total_qty: Decimal
    level: int
    stock_qty: Decimal = Decimal(0)
    on_order: Decimal = Decimal(0)
    shortage: Decimal = Decimal(0)
    status: str = "missing"  # ready | partial | missing
    children: list[BomTreeNode] = []


class OperationIn(BaseModel):
    seq: int = 10
    name: str
    work_center_id: int | None = None
    setup_hours: Decimal = Decimal(0)
    run_hours: Decimal = Decimal(0)
    outsourced: bool = False
    outsource_kind: OutsourceKind | None = None
    outsource_cost: Decimal = Decimal(0)
    tooling_item_id: int | None = None


class OperationOut(OperationIn, ORM):
    id: int
    item_id: int


class WorkCenterOut(ORM):
    id: int
    code: str
    name: str
    hourly_rate: Decimal
    capacity_hours_per_day: Decimal


# ---- ECN
class ChangeLineIn(BaseModel):
    target_item_id: int
    action: ChangeAction
    child_item_id: int | None = None
    new_child_item_id: int | None = None
    qty: Decimal | None = None
    comment: str = ""


class ChangeNoticeIn(BaseModel):
    title: str
    reason: str = ""
    reason_code: str = "1"
    urgency: str = "normal"
    wip_disposition: str = "use_up"
    lines: list[ChangeLineIn] = []
    approver_roles: list[str] = Field(default_factory=lambda: ["chief_designer", "technologist", "pdo"])


class ChangeLineOut(ORM):
    id: int
    target_item_id: int
    action: ChangeAction
    child_item_id: int | None
    new_child_item_id: int | None
    qty: Decimal | None
    comment: str = ""
    target_item: ItemOut
    child_item: ItemOut | None = None
    new_child_item: ItemOut | None = None


class ApprovalOut(ORM):
    id: int
    role_code: str
    user_id: int | None
    decision: str
    comment: str = ""
    decided_at: datetime | None = None


class ChangeNoticeOut(ORM):
    id: int
    number: str
    title: str
    reason: str = ""
    reason_code: str
    status: str
    urgency: str
    wip_disposition: str
    author_id: int | None
    created_at: datetime | None = None
    implemented_at: datetime | None = None
    lines: list[ChangeLineOut] = []
    approvals: list[ApprovalOut] = []


class DecisionIn(BaseModel):
    decision: str  # approved | rejected
    comment: str = ""


# ---- partners / purchasing
class PartnerIn(BaseModel):
    name: str
    inn: str = ""
    kind: str = "supplier"
    outsource_kinds: list[str] = []
    contact: str = ""
    rating: Decimal = Decimal(0)


class PartnerOut(PartnerIn, ORM):
    id: int


class POLineIn(BaseModel):
    item_id: int
    qty: Decimal
    price: Decimal = Decimal(0)
    due_date: date | None = None
    kit_id: int | None = None


class POIn(BaseModel):
    kind: str = "purchase"
    partner_id: int
    due_date: date | None = None
    comment: str = ""
    lines: list[POLineIn] = []


class POLineOut(ORM):
    id: int
    item_id: int
    qty: Decimal
    received_qty: Decimal
    price: Decimal
    due_date: date | None
    kit_id: int | None
    item: ItemOut


class POOut(ORM):
    id: int
    number: str
    kind: str
    partner_id: int
    status: str
    order_date: date
    due_date: date | None
    comment: str = ""
    partner: PartnerOut
    lines: list[POLineOut] = []


class ReceiveIn(BaseModel):
    po_line_id: int
    qty: Decimal
    lot: str = ""
    certificate: str = ""


class InspectionDecisionIn(BaseModel):
    accepted_qty: Decimal
    rejected_qty: Decimal = Decimal(0)
    defects: str = ""
    warehouse_id: int | None = None


class InspectionOut(ORM):
    id: int
    po_line_id: int | None
    item_id: int
    qty: Decimal
    accepted_qty: Decimal
    rejected_qty: Decimal
    status: str
    lot: str = ""
    defects: str = ""
    certificate: str = ""
    created_at: datetime | None = None
    decided_at: datetime | None = None
    item: ItemOut


# ---- stock
class WarehouseOut(ORM):
    id: int
    code: str
    name: str
    kind: str


class StockMoveIn(BaseModel):
    move_type: MoveType
    item_id: int
    qty: Decimal
    from_wh_id: int | None = None
    to_wh_id: int | None = None
    unit_cost: Decimal = Decimal(0)
    lot: str = ""
    doc_ref: str = ""
    kit_id: int | None = None
    work_order_id: int | None = None
    comment: str = ""


class StockMoveOut(ORM):
    id: int
    ts: datetime
    move_type: MoveType
    item_id: int
    qty: Decimal
    from_wh_id: int | None
    to_wh_id: int | None
    unit_cost: Decimal
    lot: str = ""
    doc_ref: str = ""
    kit_id: int | None
    comment: str = ""
    item: ItemOut


class BalanceOut(ORM):
    item_id: int
    warehouse_id: int
    qty: Decimal
    reserved: Decimal
    avg_cost: Decimal
    item: ItemOut
    warehouse: WarehouseOut


# ---- planning
class PlanLineIn(BaseModel):
    item_id: int
    qty: Decimal
    due_date: date
    customer: str = ""
    priority: int = 5


class PlanLineOut(PlanLineIn, ORM):
    id: int
    status: str
    item: ItemOut


class KitIn(BaseModel):
    item_id: int
    qty: Decimal = Decimal(1)
    revision_id: int | None = None
    serial_numbers: str = ""
    plan_line_id: int | None = None
    due_date: date | None = None


class KitLineOut(ORM):
    id: int
    parent_line_id: int | None
    path: str
    level: int
    item_id: int
    qty_per: Decimal
    required_qty: Decimal
    issued_qty: Decimal
    done: bool
    note: str = ""
    item: ItemOut


class KitOut(ORM):
    id: int
    number: str
    item_id: int
    revision_id: int
    qty: Decimal
    serial_numbers: str = ""
    due_date: date | None
    status: str
    created_at: datetime | None = None
    item: ItemOut
    lines: list[KitLineOut] = []


class WorkOrderIn(BaseModel):
    item_id: int
    qty: Decimal
    kit_id: int | None = None
    start_date: date | None = None
    due_date: date | None = None
    master_id: int | None = None


class WorkOrderOut(ORM):
    id: int
    number: str
    item_id: int
    qty: Decimal
    done_qty: Decimal
    kit_id: int | None
    start_date: date | None
    due_date: date | None
    status: str
    master_id: int | None
    actual_hours: Decimal
    item: ItemOut


class MrpSuggestion(BaseModel):
    item_id: int
    code: str
    name: str
    item_type: ItemType
    action: str  # make | buy | outsource
    gross_qty: Decimal
    stock_qty: Decimal
    on_order: Decimal = Decimal(0)
    net_qty: Decimal
    start_date: date
    due_date: date
    supplier_id: int | None = None
    est_cost: Decimal = Decimal(0)
    sources: list[str] = []
    has_outsource_op: bool = False  # собственное изготовление с операцией на стороне


# ---- AI
class ChatIn(BaseModel):
    message: str
    conversation: str | None = None
    allow_cloud: bool = False


class ChatOut(BaseModel):
    conversation: str
    reply: str
    route: str
    actions: list[dict] = []
    pending: list[dict] = []


class ImportPreview(BaseModel):
    sheet: str
    header_row: int
    columns: list[str]
    mapping: dict[str, str | None]
    rows_total: int
    sample: list[dict]
    warnings: list[str] = []
    indent_detected: bool = False  # вложенность задана отступами в ячейках


class ImportApply(BaseModel):
    mapping: dict[str, str | None]
    sheet: str | None = None
    header_row: int | None = None
    mode: str = "bom"  # bom | items | stock | plan
    root_code: str | None = None
    as_revision: bool = True
