import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { d, del, fmt, get, money, post, TYPE_ICON, type Item, type ItemType } from "../api";
import { Badge, Card, Field, Modal, Status, Table, useAuth, useData, useToast } from "../ui";
import { ItemPicker } from "./ItemPage";

interface Plan { id: number; item: Item; qty: string; due_date: string; customer: string; priority: number; status: string }
interface Mrp { item_id: number; code: string; name: string; item_type: ItemType; action: string; gross_qty: string; stock_qty: string; on_order: string; net_qty: string; start_date: string; due_date: string; supplier_id: number | null; est_cost: string; sources: string[]; has_outsource_op: boolean }
interface Short { item_id: number; code: string; name: string; item_type: ItemType; need: string; stock: string; on_order: string; shortage: string; uncovered: string; kits: string[]; lead_time_days: number }
const ACT: Record<string, [string, string]> = { buy: ["Закупить", "blue"], make: ["Изготовить", "green"], outsource: ["Кооперация", "amber"] };

export default function Planning() {
  const { can } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [tab, setTab] = useState<"plan" | "mrp" | "short">("plan");
  const [horizon, setHorizon] = useState(120);
  const plan = useData(() => get<Plan[]>("/api/planning/plan"));
  const mrp = useData(() => get<Mrp[]>("/api/planning/mrp", { horizon_days: horizon }), [horizon]);
  const short = useData(() => get<Short[]>("/api/planning/shortage"));
  const [add, setAdd] = useState(false);
  const launch = async (p: Plan) => {
    if (!confirm(`Запустить ${fmt(p.qty)} × ${p.item.code}? Будет создан комплект с замороженным составом и наряд на сборку.`)) return;
    try { const k = await post<{ id: number; number: string }>(`/api/planning/plan/${p.id}/launch`); toast("ok", `Комплект ${k.number} создан`); plan.reload(); mrp.reload(); short.reload(); nav(`/kits/${k.id}`); } catch (e) { toast("err", (e as Error).message); }
  };
  const makePOs = async () => {
    try { const r = await post<{ number: string }[]>("/api/purchasing/orders/from-mrp", undefined, { horizon_days: horizon }); toast("ok", r.length ? `Создано заказов: ${r.map((p) => p.number).join(", ")}` : "Нечего заказывать (или у позиций нет основного поставщика)"); mrp.reload(); } catch (e) { toast("err", (e as Error).message); }
  };
  const today = new Date().toISOString().slice(0, 10);
  const total = (mrp.data ?? []).reduce((s, r) => s + Number(r.est_cost), 0);
  return (
    <>
      <div className="row">
        <div className="tabs" style={{ marginBottom: 0, borderBottom: "none" }}>
          <button className={tab === "plan" ? "active" : ""} onClick={() => setTab("plan")}>Товарный план</button>
          <button className={tab === "mrp" ? "active" : ""} onClick={() => setTab("mrp")}>Расчёт потребности (MRP) · {mrp.data?.length ?? "…"}</button>
          <button className={tab === "short" ? "active" : ""} onClick={() => setTab("short")}>Дефицит по комплектам · {short.data?.length ?? "…"}</button>
        </div>
        {tab === "plan" && can("plan:write") && <button className="primary right" onClick={() => setAdd(true)}>＋ Строка плана</button>}
        {tab === "mrp" && <div className="right row"><span className="small muted">Горизонт</span><select style={{ width: 110 }} value={horizon} onChange={(e) => setHorizon(+e.target.value)}>{[30, 60, 90, 120, 180, 365].map((h) => <option key={h} value={h}>{h} дн</option>)}</select>
          {can("purchase:write") && <button className="primary" onClick={makePOs}>Сформировать заказы поставщикам</button>}</div>}
      </div>
      {tab === "plan" && <Card>
        <Table rows={plan.data ?? []} keyFn={(p) => p.id} empty="План пуст — добавьте строки или импортируйте из Excel" cols={[
          { h: "Изделие", c: (p) => <Link to={`/items/${p.item.id}`}>{TYPE_ICON[p.item.item_type]} <span className="mono">{p.item.code}</span><br /><span className="muted small">{p.item.name}</span></Link> },
          { h: "Кол-во", c: (p) => fmt(p.qty), align: "r" }, { h: "Срок", c: (p) => <span style={{ color: p.due_date < today && p.status !== "done" ? "var(--red)" : undefined }}>{d(p.due_date)}</span> },
          { h: "Заказчик", c: (p) => p.customer }, { h: "Приоритет", c: (p) => p.priority, align: "c" }, { h: "Статус", c: (p) => <Status s={p.status} /> },
          { h: "", c: (p) => <div className="row">{p.status === "planned" && can("plan:write") && <button className="sm primary" onClick={() => launch(p)}>🚀 Запустить</button>}{can("plan:write") && <button className="sm danger" onClick={async () => { if (confirm("Удалить строку?")) { await del(`/api/planning/plan/${p.id}`); plan.reload(); } }}>✕</button>}</div> },
        ]} />
      </Card>}
      {tab === "mrp" && <Card title={<span>Предложения MRP <span className="muted small">по невыполненным строкам плана, за вычетом остатков, заказов и нарядов · ориентировочно {money(total)}</span></span>}>
        <Table rows={mrp.data ?? []} keyFn={(r) => r.item_id} empty="Потребность полностью покрыта" cols={[
          { h: "Действие", c: (r) => <>{<Badge tone={ACT[r.action][1]}>{ACT[r.action][0]}</Badge>}{r.has_outsource_op && <> <Badge tone="amber" >+ операция на стороне</Badge></>}</> },
          { h: "Позиция", c: (r) => <Link to={`/items/${r.item_id}`}>{TYPE_ICON[r.item_type]} <span className="mono">{r.code}</span><br /><span className="muted small">{r.name}</span></Link> },
          { h: "Потребность", c: (r) => fmt(r.gross_qty), align: "r" }, { h: "Остаток", c: (r) => fmt(r.stock_qty), align: "r" }, { h: "В заказах / нарядах", c: (r) => fmt(r.on_order), align: "r" },
          { h: "К заказу", c: (r) => <b>{fmt(r.net_qty)}</b>, align: "r" },
          { h: "Запуск", c: (r) => <span style={{ color: r.start_date < today ? "var(--red)" : undefined }}>{d(r.start_date)}</span> }, { h: "Срок", c: (r) => d(r.due_date) },
          { h: "≈ Стоимость", c: (r) => Number(r.est_cost) ? money(r.est_cost) : "—", align: "r" }, { h: "Источник", c: (r) => <span className="small muted">{r.sources.join("; ")}</span> },
        ]} />
      </Card>}
      {tab === "short" && <Card title="Дефицит по открытым комплектам (листовые позиции)">
        <Table rows={short.data ?? []} keyFn={(r) => r.item_id} empty="Все открытые комплекты обеспечены" cols={[
          { h: "Позиция", c: (r) => <Link to={`/items/${r.item_id}`}>{TYPE_ICON[r.item_type]} <span className="mono">{r.code}</span><br /><span className="muted small">{r.name}</span></Link> },
          { h: "Нужно", c: (r) => fmt(r.need), align: "r" }, { h: "Есть", c: (r) => fmt(r.stock), align: "r" }, { h: "Дефицит", c: (r) => <b style={{ color: "var(--red)" }}>{fmt(r.shortage)}</b>, align: "r" },
          { h: "В заказах", c: (r) => fmt(r.on_order), align: "r" }, { h: "Непокрыто", c: (r) => <b style={{ color: Number(r.uncovered) > 0 ? "var(--red)" : "var(--green)" }}>{fmt(r.uncovered)}</b>, align: "r" },
          { h: "Цикл", c: (r) => `${r.lead_time_days} дн`, align: "r" }, { h: "Комплекты", c: (r) => r.kits.join(", ") },
        ]} />
      </Card>}
      {add && <AddPlan onClose={() => setAdd(false)} onDone={() => { setAdd(false); plan.reload(); mrp.reload(); }} />}
    </>
  );
}

function AddPlan({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [item, setItem] = useState<Item | null>(null);
  const [f, setF] = useState({ qty: 1, due_date: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10), customer: "", priority: 5 });
  const submit = async (e: FormEvent) => { e.preventDefault(); if (!item) return; try { await post("/api/planning/plan", { item_id: item.id, ...f }); onDone(); } catch (err) { toast("err", (err as Error).message); } };
  return (
    <Modal title="Строка товарного плана" onClose={onClose}>
      <form className="grid" onSubmit={submit}>
        <Field label="Изделие"><ItemPicker value={item} onChange={setItem} /></Field>
        <div className="form">
          <Field label="Количество"><input type="number" min={1} value={f.qty} onChange={(e) => setF({ ...f, qty: +e.target.value })} /></Field>
          <Field label="Срок отгрузки"><input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>
          <Field label="Заказчик"><input value={f.customer} onChange={(e) => setF({ ...f, customer: e.target.value })} /></Field>
          <Field label="Приоритет (1 — высший)"><input type="number" min={1} max={9} value={f.priority} onChange={(e) => setF({ ...f, priority: +e.target.value })} /></Field>
        </div>
        <div className="row"><button className="primary" disabled={!item}>Добавить</button><button type="button" onClick={onClose}>Отмена</button></div>
      </form>
    </Modal>
  );
}
