import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { fmt, get, money, post, TYPE_ICON, TYPE_LABEL, type Item, type ItemType } from "../api";
import { Card, ErrorBox, Field, Modal, Status, Table, useAuth, useData, useToast } from "../ui";

export default function Items() {
  const nav = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const [create, setCreate] = useState(false);
  const list = useData(() => get<{ total: number; items: Item[] }>("/api/items", { q, item_type: type, page, size: 50 }), [q, type, page]);
  const [form, setForm] = useState({ code: "", name: "", item_type: "part" as ItemType, unit: "шт", std_cost: 0, lead_time_days: 10, confidentiality: 1 });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try { const it = await post<Item>("/api/items", form); toast("ok", `Создано ${it.code}`); setCreate(false); nav(`/items/${it.id}`); } catch (err) { toast("err", (err as Error).message); }
  };
  const pages = Math.ceil((list.data?.total ?? 0) / 50);
  return (
    <>
      <div className="row">
        <input className="search" placeholder="Поиск по обозначению или наименованию…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <select style={{ width: 220 }} value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
          <option value="">Все типы</option>
          {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{TYPE_ICON[k as ItemType]} {v}</option>)}
        </select>
        <span className="muted small">{list.data?.total ?? 0} поз.</span>
        {can("items:write") && <button className="primary right" onClick={() => setCreate(true)}>＋ Номенклатура</button>}
      </div>
      {list.error && <ErrorBox text={list.error} />}
      <Card>
        <Table rows={list.data?.items ?? []} onRow={(r) => nav(`/items/${r.id}`)} keyFn={(r) => r.id} empty="Ничего не найдено"
          cols={[
            { h: "Тип", c: (r) => <span title={TYPE_LABEL[r.item_type]}>{TYPE_ICON[r.item_type]}</span>, w: "40px", align: "c" },
            { h: "Обозначение", c: (r) => <span className="mono">{r.code}</span> },
            { h: "Наименование", c: (r) => r.name },
            { h: "Рев.", c: (r) => r.current_rev ?? "—", align: "c" },
            { h: "Статус", c: (r) => <Status s={r.lifecycle} /> },
            { h: "Остаток", c: (r) => `${fmt(r.stock_qty)} ${r.unit}`, align: "r" },
            { h: "Цикл, дн", c: (r) => r.lead_time_days, align: "r" },
            { h: "Цена", c: (r) => (Number(r.std_cost) ? money(r.std_cost) : "—"), align: "r" },
            { h: "Допуск", c: (r) => r.confidentiality, align: "c" },
          ]} />
        {pages > 1 && <div className="row" style={{ marginTop: 10 }}><button className="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>←</button><span className="small">{page} / {pages}</span><button className="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>→</button></div>}
      </Card>
      {create && (
        <Modal title="Новая номенклатура" onClose={() => setCreate(false)}>
          <form className="form" onSubmit={submit}>
            <Field label="Обозначение"><input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="АБВГ.123456.001" /></Field>
            <Field label="Тип"><select value={form.item_type} onChange={(e) => setForm({ ...form, item_type: e.target.value as ItemType })}>{Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="Наименование"><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="full" /></Field>
            <Field label="Ед. изм."><input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></Field>
            <Field label="Цена / стоимость, ₽"><input type="number" step="0.01" value={form.std_cost} onChange={(e) => setForm({ ...form, std_cost: +e.target.value })} /></Field>
            <Field label="Цикл, дней"><input type="number" value={form.lead_time_days} onChange={(e) => setForm({ ...form, lead_time_days: +e.target.value })} /></Field>
            <Field label="Конфиденциальность (0–3)" hint="Выше — доступ только с соответствующим допуском; 2+ не уходит в облачный ИИ"><input type="number" min={0} max={3} value={form.confidentiality} onChange={(e) => setForm({ ...form, confidentiality: +e.target.value })} /></Field>
            <div className="full row"><button className="primary">Создать</button><button type="button" onClick={() => setCreate(false)}>Отмена</button></div>
          </form>
        </Modal>
      )}
    </>
  );
}
