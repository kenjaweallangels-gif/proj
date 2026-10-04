import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { d, dt, fmt, get, money, post, TYPE_ICON, type Item } from "../api";
import { Badge, Card, Field, Modal, Status, Table, useAuth, useData, useToast } from "../ui";
import { ItemPicker } from "./ItemPage";

interface Partner { id: number; name: string; inn: string; kind: string; outsource_kinds: string[]; contact: string; rating: string }
interface POLine { id: number; item: Item; qty: string; received_qty: string; price: string; due_date: string | null }
interface PO { id: number; number: string; kind: string; partner: Partner; status: string; order_date: string; due_date: string | null; comment: string; lines: POLine[] }
interface Insp { id: number; item: Item; qty: string; accepted_qty: string; rejected_qty: string; status: string; lot: string; defects: string; certificate: string; created_at: string; decided_at: string | null }

export default function Purchasing() {
  const { can } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState<"po" | "coop" | "insp" | "partners">("po");
  const [status, setStatus] = useState("");
  const pos = useData(() => get<PO[]>("/api/purchasing/orders", { kind: tab === "coop" ? "outsource" : tab === "po" ? "purchase" : undefined, status }), [tab, status]);
  const insp = useData(() => get<Insp[]>("/api/purchasing/inspections", { status: "pending" }));
  const inspDone = useData(() => get<Insp[]>("/api/purchasing/inspections", { status: "" }));
  const partners = useData(() => get<Partner[]>("/api/purchasing/partners"));
  const [open, setOpen] = useState<PO | null>(null);
  const [create, setCreate] = useState(false);
  const [decide, setDecide] = useState<Insp | null>(null);
  const setPO = async (po: PO, s: string) => { try { const r = await post<PO>(`/api/purchasing/orders/${po.id}/status`, undefined, { status: s }); setOpen(r); pos.reload(); } catch (e) { toast("err", (e as Error).message); } };
  const receive = async (ln: POLine) => {
    const q = prompt(`Поступило ${ln.item.code} (заказано ${fmt(ln.qty)}, получено ${fmt(ln.received_qty)}):`, String(Number(ln.qty) - Number(ln.received_qty)));
    if (q === null || !Number(q)) return;
    const lot = prompt("Партия / № сертификата (необязательно):") ?? "";
    try { await post("/api/purchasing/receive", { po_line_id: ln.id, qty: Number(q), lot, certificate: lot }); toast("ok", "Принято на входной контроль"); setOpen(null); pos.reload(); insp.reload(); } catch (e) { toast("err", (e as Error).message); }
  };
  const total = (po: PO) => po.lines.reduce((s, l) => s + Number(l.qty) * Number(l.price), 0);
  return (
    <>
      <div className="row">
        <div className="tabs" style={{ marginBottom: 0, borderBottom: "none" }}>
          <button className={tab === "po" ? "active" : ""} onClick={() => setTab("po")}>Закупки (ОМТС)</button><button className={tab === "coop" ? "active" : ""} onClick={() => setTab("coop")}>Кооперация (ОПК)</button>
          <button className={tab === "insp" ? "active" : ""} onClick={() => setTab("insp")}>Входной контроль · {insp.data?.length ?? "…"}</button><button className={tab === "partners" ? "active" : ""} onClick={() => setTab("partners")}>Контрагенты</button>
        </div>
        {(tab === "po" || tab === "coop") && <select style={{ width: 160 }} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Все статусы</option>{["draft", "sent", "confirmed", "partial", "received", "closed", "cancelled"].map((s) => <option key={s} value={s}>{s}</option>)}</select>}
        {(tab === "po" || tab === "coop") && can("purchase:write") && <button className="primary right" onClick={() => setCreate(true)}>＋ Заказ</button>}
      </div>
      {(tab === "po" || tab === "coop") && <Card>
        <Table rows={pos.data ?? []} keyFn={(p) => p.id} onRow={setOpen} empty="Заказов нет — сформируйте из MRP" cols={[
          { h: "Номер", c: (p) => <span className="mono">{p.number}</span> }, { h: "Контрагент", c: (p) => p.partner.name }, { h: "Позиций", c: (p) => p.lines.length, align: "r" },
          { h: "Сумма", c: (p) => money(total(p)), align: "r" }, { h: "Срок", c: (p) => d(p.due_date) },
          { h: "Получено", c: (p) => { const q = p.lines.reduce((s, l) => s + Number(l.qty), 0), r = p.lines.reduce((s, l) => s + Number(l.received_qty), 0); return <div style={{ minWidth: 90 }}><div className="progress"><div style={{ width: `${q ? (r / q) * 100 : 0}%` }} /></div></div>; } },
          { h: "Статус", c: (p) => <Status s={p.status} /> },
        ]} />
      </Card>}
      {tab === "insp" && <div className="grid">
        <Card title="Ожидают решения ОТК">
          <Table rows={insp.data ?? []} keyFn={(i) => i.id} empty="Очередь входного контроля пуста" cols={[
            { h: "Поступило", c: (i) => <span className="small">{dt(i.created_at)}</span> }, { h: "Позиция", c: (i) => <Link to={`/items/${i.item.id}`}>{TYPE_ICON[i.item.item_type]} <span className="mono">{i.item.code}</span><br /><span className="muted small">{i.item.name}</span></Link> },
            { h: "Кол-во", c: (i) => fmt(i.qty), align: "r" }, { h: "Партия / сертификат", c: (i) => <span className="small">{i.lot} {i.certificate}</span> },
            { h: "", c: (i) => can("qc:write") ? <button className="sm primary" onClick={() => setDecide(i)}>Решение</button> : <Badge tone="amber">ждёт ОТК</Badge> },
          ]} />
        </Card>
        <Card title="История входного контроля">
          <Table rows={(inspDone.data ?? []).filter((i) => i.status !== "pending")} keyFn={(i) => i.id} empty="Пока нет" cols={[
            { h: "Решение", c: (i) => <span className="small">{dt(i.decided_at)}</span> }, { h: "Позиция", c: (i) => <span className="mono">{i.item.code}</span> },
            { h: "Принято", c: (i) => <b style={{ color: "var(--green)" }}>{fmt(i.accepted_qty)}</b>, align: "r" }, { h: "Брак", c: (i) => <b style={{ color: Number(i.rejected_qty) ? "var(--red)" : undefined }}>{fmt(i.rejected_qty)}</b>, align: "r" },
            { h: "Статус", c: (i) => <Status s={i.status} /> }, { h: "Дефекты", c: (i) => <span className="small">{i.defects}</span> },
          ]} />
        </Card>
      </div>}
      {tab === "partners" && <Card actions={can("purchase:write") && <button className="sm" onClick={async () => { const name = prompt("Наименование контрагента:"); if (!name) return; const kind = prompt("Тип: supplier / cooperator / both", "supplier") ?? "supplier"; await post("/api/purchasing/partners", { name, kind }); partners.reload(); }}>＋ Контрагент</button>}>
        <Table rows={partners.data ?? []} keyFn={(p) => p.id} cols={[
          { h: "Наименование", c: (p) => p.name }, { h: "ИНН", c: (p) => <span className="mono">{p.inn}</span> },
          { h: "Тип", c: (p) => <Badge tone={p.kind === "cooperator" ? "amber" : "blue"}>{{ supplier: "поставщик", cooperator: "кооператор", both: "оба" }[p.kind]}</Badge> },
          { h: "Виды работ", c: (p) => p.outsource_kinds.join(", ") }, { h: "Рейтинг", c: (p) => "★".repeat(Math.round(Number(p.rating))) + ` ${fmt(p.rating, 1)}`, align: "r" },
        ]} />
      </Card>}
      {open && <Modal title={`${open.number} — ${open.partner.name}`} onClose={() => setOpen(null)} wide>
        <div className="row"><Status s={open.status} /><Badge>{open.kind === "outsource" ? "кооперация" : "закупка"}</Badge><span className="muted small">от {d(open.order_date)} · срок {d(open.due_date)} · {money(total(open))}</span>{open.comment && <span className="muted small">· {open.comment}</span>}</div>
        <Table rows={open.lines} keyFn={(l) => l.id} cols={[
          { h: "Позиция", c: (l) => <Link to={`/items/${l.item.id}`}>{TYPE_ICON[l.item.item_type]} <span className="mono">{l.item.code}</span> <span className="muted small">{l.item.name}</span></Link> },
          { h: "Заказано", c: (l) => fmt(l.qty), align: "r" }, { h: "Получено", c: (l) => fmt(l.received_qty), align: "r" }, { h: "Цена", c: (l) => money(l.price), align: "r" }, { h: "Срок", c: (l) => d(l.due_date) },
          { h: "", c: (l) => can("stock:write") && ["sent", "confirmed", "partial"].includes(open.status) && Number(l.received_qty) < Number(l.qty) ? <button className="sm primary" onClick={() => receive(l)}>📥 Приёмка</button> : null },
        ]} />
        {can("purchase:write") && <div className="row">
          {open.status === "draft" && <button className="primary" onClick={() => setPO(open, "sent")}>Отправить контрагенту</button>}
          {open.status === "sent" && <button onClick={() => setPO(open, "confirmed")}>Подтверждён</button>}
          {["received", "partial"].includes(open.status) && <button onClick={() => setPO(open, "closed")}>Закрыть</button>}
          {!["closed", "cancelled", "received"].includes(open.status) && <button className="danger" onClick={() => confirm("Отменить заказ?") && setPO(open, "cancelled")}>Отменить</button>}
        </div>}
      </Modal>}
      {create && <CreatePO partners={partners.data ?? []} kind={tab === "coop" ? "outsource" : "purchase"} onClose={() => setCreate(false)} onDone={() => { setCreate(false); pos.reload(); }} />}
      {decide && <Decide insp={decide} onClose={() => setDecide(null)} onDone={() => { setDecide(null); insp.reload(); inspDone.reload(); }} />}
    </>
  );
}

function CreatePO({ partners, kind, onClose, onDone }: { partners: Partner[]; kind: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [partner, setPartner] = useState(partners[0]?.id ?? 0);
  const [due, setDue] = useState(new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10));
  const [lines, setLines] = useState<{ item: Item | null; qty: number; price: number }[]>([{ item: null, qty: 1, price: 0 }]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ls = lines.filter((l) => l.item);
    if (!ls.length) return toast("err", "Добавьте позиции");
    try { await post("/api/purchasing/orders", { kind, partner_id: partner, due_date: due, lines: ls.map((l) => ({ item_id: l.item!.id, qty: l.qty, price: l.price, due_date: due })) }); toast("ok", "Заказ создан"); onDone(); } catch (err) { toast("err", (err as Error).message); }
  };
  return (
    <Modal title={kind === "outsource" ? "Заказ на кооперацию" : "Заказ поставщику"} onClose={onClose} wide>
      <form className="grid" onSubmit={submit}>
        <div className="form"><Field label="Контрагент"><select value={partner} onChange={(e) => setPartner(+e.target.value)}>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><Field label="Срок поставки"><input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field></div>
        {lines.map((l, i) => <div key={i} className="form"><Field label="Позиция"><ItemPicker value={l.item} onChange={(it) => setLines(lines.map((x, j) => j === i ? { ...x, item: it, price: it ? Number(it.std_cost) : 0 } : x))} /></Field>
          <Field label="Кол-во"><input type="number" step="0.0001" value={l.qty} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, qty: +e.target.value } : x))} /></Field>
          <Field label="Цена"><input type="number" step="0.01" value={l.price} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, price: +e.target.value } : x))} /></Field></div>)}
        <div className="row"><button type="button" onClick={() => setLines([...lines, { item: null, qty: 1, price: 0 }])}>＋ Позиция</button><button className="primary right">Создать</button></div>
      </form>
    </Modal>
  );
}

function Decide({ insp, onClose, onDone }: { insp: Insp; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [ok, setOk] = useState(Number(insp.qty));
  const [defects, setDefects] = useState("");
  const rej = Number(insp.qty) - ok;
  const submit = async (e: FormEvent) => { e.preventDefault(); try { await post(`/api/purchasing/inspections/${insp.id}/decide`, { accepted_qty: ok, rejected_qty: rej, defects }); toast("ok", "Решение ОТК записано; годные оприходованы"); onDone(); } catch (err) { toast("err", (err as Error).message); } };
  return (
    <Modal title={`Входной контроль: ${insp.item.code}`} onClose={onClose}>
      <form className="grid" onSubmit={submit}>
        <p>{insp.item.name} · поступило <b>{fmt(insp.qty)} {insp.item.unit}</b>{insp.lot && ` · партия ${insp.lot}`}</p>
        <div className="form"><Field label="Принято (годных)"><input type="number" min={0} max={Number(insp.qty)} step="0.0001" value={ok} onChange={(e) => setOk(+e.target.value)} /></Field><Field label="Забраковано"><input disabled value={rej} /></Field></div>
        <Field label="Дефекты / основание"><textarea rows={2} value={defects} onChange={(e) => setDefects(e.target.value)} /></Field>
        <div className="row"><button className="primary">{rej > 0 ? (ok > 0 ? "Принять частично" : "Забраковать всё") : "Принять"}</button><button type="button" onClick={onClose}>Отмена</button></div>
      </form>
    </Modal>
  );
}
