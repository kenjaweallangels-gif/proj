import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { dt, fmt, get, money, post, TYPE_ICON, type Item } from "../api";
import { Badge, Card, Field, Modal, Table, useAuth, useData, useToast } from "../ui";
import { ItemPicker } from "./ItemPage";

interface Bal { item_id: number; warehouse_id: number; qty: string; reserved: string; avg_cost: string; item: Item; warehouse: { code: string; name: string; kind: string } }
interface Move { id: number; ts: string; move_type: string; qty: string; from_wh_id: number | null; to_wh_id: number | null; unit_cost: string; lot: string; doc_ref: string; comment: string; item: Item }
interface WH { id: number; code: string; name: string; kind: string }
const MT: Record<string, [string, string]> = { receipt: ["Приход", "green"], issue: ["Выдача в производство", "blue"], output: ["Выпуск", "green"], transfer: ["Перемещение", "gray"], writeoff: ["Списание", "red"], adjustment: ["Инвентаризация", "amber"], to_outsource: ["Передача кооператору", "amber"] };

export default function Stock() {
  const { can } = useAuth();
  const [tab, setTab] = useState<"bal" | "moves" | "journal">("bal");
  const [q, setQ] = useState("");
  const whs = useData(() => get<WH[]>("/api/stock/warehouses"));
  const bal = useData(() => get<Bal[]>("/api/stock/balances", { q }), [q]);
  const moves = useData(() => get<Move[]>("/api/stock/moves"));
  const journal = useData(() => (can("finance:read") ? get<{ id: number; ts: string; debit: string; credit: string; amount: string; memo: string; exported: boolean }[]>("/api/stock/journal") : Promise.resolve([])));
  const tb = useData(() => (can("finance:read") ? get<{ account: string; name: string; debit: string; credit: string; balance: string }[]>("/api/stock/journal/trial-balance") : Promise.resolve([])));
  const [add, setAdd] = useState(false);
  const wh = (id: number | null) => whs.data?.find((w) => w.id === id)?.code ?? "—";
  const value = (bal.data ?? []).reduce((s, b) => s + Number(b.qty) * Number(b.avg_cost), 0);
  return (
    <>
      <div className="row">
        <div className="tabs" style={{ marginBottom: 0, borderBottom: "none" }}>
          <button className={tab === "bal" ? "active" : ""} onClick={() => setTab("bal")}>Остатки</button><button className={tab === "moves" ? "active" : ""} onClick={() => setTab("moves")}>Движения</button>
          {can("finance:read") && <button className={tab === "journal" ? "active" : ""} onClick={() => setTab("journal")}>Проводки и ОСВ</button>}
        </div>
        {tab === "bal" && <input className="search" placeholder="Поиск…" value={q} onChange={(e) => setQ(e.target.value)} />}
        {can("stock:write") && <button className="primary right" onClick={() => setAdd(true)}>＋ Движение</button>}
      </div>
      {tab === "bal" && <Card title={<span>Остатки по складам <span className="muted small">· стоимость {money(value)}</span></span>}>
        <Table rows={bal.data ?? []} keyFn={(b) => `${b.item_id}-${b.warehouse_id}`} empty="Остатков нет" cols={[
          { h: "Склад", c: (b) => <Badge tone={b.warehouse.kind === "quarantine" ? "amber" : "gray"}>{b.warehouse.code}</Badge> },
          { h: "Позиция", c: (b) => <Link to={`/items/${b.item.id}`}>{TYPE_ICON[b.item.item_type]} <span className="mono">{b.item.code}</span><br /><span className="muted small">{b.item.name}</span></Link> },
          { h: "Остаток", c: (b) => <b>{fmt(b.qty, 4)} {b.item.unit}</b>, align: "r" }, { h: "Резерв", c: (b) => fmt(b.reserved, 4), align: "r" },
          { h: "Ср. цена", c: (b) => money(b.avg_cost), align: "r" }, { h: "Сумма", c: (b) => money(Number(b.qty) * Number(b.avg_cost)), align: "r" },
          { h: "Мин. запас", c: (b) => <span style={{ color: Number(b.qty) < Number(b.item.min_stock) ? "var(--red)" : undefined }}>{fmt(b.item.min_stock)}</span>, align: "r" },
        ]} />
      </Card>}
      {tab === "moves" && <Card title="Журнал движений (последние 200)">
        <Table rows={moves.data ?? []} keyFn={(m) => m.id} empty="Движений нет" cols={[
          { h: "Когда", c: (m) => <span className="small">{dt(m.ts)}</span> }, { h: "Тип", c: (m) => <Badge tone={MT[m.move_type]?.[1]}>{MT[m.move_type]?.[0] ?? m.move_type}</Badge> },
          { h: "Позиция", c: (m) => <Link to={`/items/${m.item.id}`} className="mono">{m.item.code}</Link> }, { h: "Кол-во", c: (m) => fmt(m.qty, 4), align: "r" },
          { h: "Откуда → куда", c: (m) => `${wh(m.from_wh_id)} → ${wh(m.to_wh_id)}` }, { h: "Цена", c: (m) => money(m.unit_cost), align: "r" },
          { h: "Документ", c: (m) => <span className="small">{m.doc_ref}{m.lot && ` · партия ${m.lot}`}</span> }, { h: "Комментарий", c: (m) => <span className="small muted">{m.comment}</span> },
        ]} />
      </Card>}
      {tab === "journal" && <div className="grid g2">
        <Card title="Оборотно-сальдовая ведомость"><Table rows={tb.data ?? []} keyFn={(r) => r.account} cols={[
          { h: "Счёт", c: (r) => <b>{r.account}</b> }, { h: "", c: (r) => r.name }, { h: "Дт", c: (r) => money(r.debit), align: "r" }, { h: "Кт", c: (r) => money(r.credit), align: "r" }, { h: "Сальдо", c: (r) => money(r.balance), align: "r" },
        ]} /></Card>
        <Card title="Проводки (автоматические, по движениям)"><Table rows={journal.data ?? []} keyFn={(r) => r.id} cols={[
          { h: "Дата", c: (r) => <span className="small">{dt(r.ts)}</span> }, { h: "Дт", c: (r) => r.debit }, { h: "Кт", c: (r) => r.credit }, { h: "Сумма", c: (r) => money(r.amount), align: "r" }, { h: "Содержание", c: (r) => <span className="small">{r.memo}</span> }, { h: "1С", c: (r) => r.exported ? "✓" : "", align: "c" },
        ]} /></Card>
      </div>}
      {add && <AddMove whs={whs.data ?? []} onClose={() => setAdd(false)} onDone={() => { setAdd(false); bal.reload(); moves.reload(); journal.reload(); tb.reload(); }} />}
    </>
  );
}

function AddMove({ whs, onClose, onDone }: { whs: WH[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [item, setItem] = useState<Item | null>(null);
  const [f, setF] = useState({ move_type: "receipt", qty: 1, from_wh_id: "", to_wh_id: "", unit_cost: 0, lot: "", doc_ref: "", comment: "" });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!item) return;
    try { await post("/api/stock/moves", { ...f, item_id: item.id, from_wh_id: f.from_wh_id || null, to_wh_id: f.to_wh_id || null }); toast("ok", "Проведено"); onDone(); } catch (err) { toast("err", (err as Error).message); }
  };
  const needFrom = ["issue", "writeoff", "transfer", "to_outsource"].includes(f.move_type), needTo = ["receipt", "output", "transfer", "adjustment"].includes(f.move_type);
  return (
    <Modal title="Складское движение" onClose={onClose}>
      <form className="grid" onSubmit={submit}>
        <Field label="Тип"><select value={f.move_type} onChange={(e) => setF({ ...f, move_type: e.target.value })}>{Object.entries(MT).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}</select></Field>
        <Field label="Позиция"><ItemPicker value={item} onChange={(i) => { setItem(i); if (i) setF({ ...f, unit_cost: Number(i.std_cost) }); }} /></Field>
        <div className="form">
          <Field label="Количество"><input type="number" step="0.0001" value={f.qty} onChange={(e) => setF({ ...f, qty: +e.target.value })} /></Field>
          <Field label="Цена за ед." hint="Для выдачи берётся средняя"><input type="number" step="0.01" value={f.unit_cost} onChange={(e) => setF({ ...f, unit_cost: +e.target.value })} /></Field>
          {needFrom && <Field label="Со склада"><select value={f.from_wh_id} onChange={(e) => setF({ ...f, from_wh_id: e.target.value })}><option value="">(основной)</option>{whs.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>}
          {needTo && <Field label="На склад"><select value={f.to_wh_id} onChange={(e) => setF({ ...f, to_wh_id: e.target.value })}><option value="">(по умолчанию)</option>{whs.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>}
          <Field label="Партия"><input value={f.lot} onChange={(e) => setF({ ...f, lot: e.target.value })} /></Field>
          <Field label="Документ"><input value={f.doc_ref} onChange={(e) => setF({ ...f, doc_ref: e.target.value })} /></Field>
        </div>
        <Field label="Комментарий"><input value={f.comment} onChange={(e) => setF({ ...f, comment: e.target.value })} /></Field>
        <p className="muted small">Приход от поставщика по заказу оформляется через «Закупки → Приёмка» и проходит входной контроль.</p>
        <div className="row"><button className="primary" disabled={!item}>Провести</button><button type="button" onClick={onClose}>Отмена</button></div>
      </form>
    </Modal>
  );
}
