import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { d, fmt, get, post, TYPE_ICON, type ItemType } from "../api";
import { Field, Help, Modal, Ring, Status, useAuth, useData, useToast } from "../ui";

export interface OrderRow { id: number; number: string; item: { id: number; code: string; name: string; item_type: ItemType }; qty: string; rev: string; due_date: string | null; status: string; customer: string; leaves: number; ready: number; percent: number; missing: number; overdue: boolean; days_left: number | null }
interface SpecRow { id: number; code: string; name: string; positions: number }

export function DueLabel({ due, days, done }: { due: string | null; days: number | null; done?: boolean }) {
  if (!due) return <span className="muted">срок не задан</span>;
  if (done) return <span className="muted">к {d(due)}</span>;
  const cls = days !== null && days < 0 ? "late" : days !== null && days <= 7 ? "soon" : "";
  const txt = days === null ? "" : days < 0 ? ` · просрочен на ${-days} дн` : days === 0 ? " · сегодня" : ` · через ${days} дн`;
  return <span className={`due ${cls}`}>к {d(due)}{txt}</span>;
}

export default function Orders() {
  const nav = useNavigate();
  const { can } = useAuth();
  const [all, setAll] = useState(false);
  const orders = useData(() => get<OrderRow[]>("/api/simple/orders", { all }), [all]);
  const specs = useData(() => get<SpecRow[]>("/api/simple/specs"));
  const [create, setCreate] = useState(false);
  const list = orders.data ?? [];
  const noSpecs = specs.data && specs.data.length === 0;
  return (
    <div className="stack">
      <div className="ph">
        <div><h1>Заказы</h1><div className="sub">Что сейчас комплектуем. Откройте заказ — и отмечайте галочками, что пришло.</div></div>
        <div className="right row">
          <div className="seg"><button className={!all ? "active" : ""} onClick={() => setAll(false)}>В работе</button><button className={all ? "active" : ""} onClick={() => setAll(true)}>Все</button></div>
          {can("kits:write") && <button className="primary big" onClick={() => setCreate(true)} disabled={!!noSpecs}>＋ Новый заказ</button>}
        </div>
      </div>
      <Help id="orders">Заказ — это «изделие × количество × срок». Система разворачивает полный состав на это количество и показывает, чего не хватает. Галочки здесь — рабочий чек-лист плановика, склад они не трогают.</Help>
      {noSpecs && (
        <div className="card">
          <h2 style={{ marginBottom: 12 }}>С чего начать</h2>
          <div className="steps">
            <div className="step"><span className="n">1</span><b>Загрузите спецификацию</b><span className="muted">Excel с составом изделия — в разделе «Спецификации». Колонки распознаются сами.</span><Link to="/specs"><button className="primary">Перейти к спецификациям →</button></Link></div>
            <div className="step"><span className="n">2</span><b>Создайте заказ</b><span className="muted">Выберите изделие, количество и срок — состав развернётся автоматически.</span></div>
            <div className="step"><span className="n">3</span><b>Отмечайте поступления</b><span className="muted">Галочка — пришло. Красное — не хватает. Список дефицита соберётся сам.</span></div>
          </div>
        </div>
      )}
      {orders.loading && <div className="muted">Загрузка…</div>}
      {orders.data && !list.length && !noSpecs && <div className="card empty-big"><div style={{ fontSize: 42 }}>📭</div><b>{all ? "Заказов ещё не было" : "Нет заказов в работе"}</b><div className="muted">Нажмите «Новый заказ», чтобы развернуть состав изделия на нужное количество.</div></div>}
      <div className="olist">
        {list.map((o) => (
          <Link key={o.id} to={`/orders/${o.id}`} className={`orow ${o.overdue ? "overdue" : ""}`}>
            <Ring percent={o.percent} size={64} label={`${o.ready} из ${o.leaves} позиций есть`} />
            <div style={{ minWidth: 0 }}>
              <div className="orow-t">{TYPE_ICON[o.item.item_type]} {o.item.name} <span className="muted">× {fmt(o.qty)}</span></div>
              <div className="orow-m"><span className="mono">{o.item.code}</span> · заказ {o.number}{o.customer && ` · ${o.customer}`}</div>
              <div className="orow-m"><DueLabel due={o.due_date} days={o.days_left} done={o.status === "assembled" || o.status === "shipped"} /></div>
            </div>
            <div className="orow-r">
              <Status s={o.status} />
              {o.missing > 0 ? <span className="warn">не хватает {o.missing} из {o.leaves}</span> : <span className="ok">всё в наличии</span>}
            </div>
          </Link>
        ))}
      </div>
      {create && <CreateOrder specs={specs.data ?? []} onClose={() => setCreate(false)} onDone={(id) => { setCreate(false); nav(`/orders/${id}`); }} />}
    </div>
  );
}

export function CreateOrder({ specs, presetId, onClose, onDone }: { specs: SpecRow[]; presetId?: number; onClose: () => void; onDone: (id: number) => void }) {
  const toast = useToast();
  const [f, setF] = useState({ item_id: presetId ?? specs[0]?.id ?? 0, qty: 1, due_date: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10), customer: "", serial_numbers: "" });
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try { const r = await post<{ id: number; number: string }>("/api/simple/orders", f); toast("ok", `Заказ ${r.number} создан`); onDone(r.id); } catch (err) { toast("err", (err as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal title="Новый заказ" onClose={onClose}>
      <form className="stack" onSubmit={submit} style={{ gap: 14 }}>
        <Field label="Что делаем"><select value={f.item_id} onChange={(e) => setF({ ...f, item_id: +e.target.value })}>{specs.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name} ({s.positions} поз.)</option>)}</select></Field>
        <div className="form">
          <Field label="Сколько штук"><input type="number" min={1} step="1" value={f.qty} onChange={(e) => setF({ ...f, qty: +e.target.value })} style={{ fontSize: 18 }} /></Field>
          <Field label="К какому сроку"><input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>
        </div>
        <div className="form">
          <Field label="Заказчик (необязательно)"><input value={f.customer} onChange={(e) => setF({ ...f, customer: e.target.value })} /></Field>
          <Field label="Заводские номера (необязательно)"><input value={f.serial_numbers} onChange={(e) => setF({ ...f, serial_numbers: e.target.value })} placeholder="001–005" /></Field>
        </div>
        <p className="muted small" style={{ margin: 0 }}>Состав развернётся на указанное количество по действующей редакции спецификации. Дальнейшие правки спецификации этот заказ не затронут.</p>
        <div className="row"><button className="primary big" disabled={busy || !f.item_id}>Создать заказ</button><button type="button" onClick={onClose}>Отмена</button></div>
      </form>
    </Modal>
  );
}
