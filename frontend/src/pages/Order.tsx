import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, d, fmt, post, TYPE_ICON, type ItemType } from "../api";
import { Badge, Help, Ring, Status, TYPE_RU, useAuth, useData, useToast } from "../ui";
import { DueLabel } from "./Orders";

interface Line { id: number; item: { id: number; code: string; name: string; item_type: ItemType; unit: string }; qty_per: string; required: string; received: string; done: boolean; status: "ready" | "partial" | "missing"; note: string; level: number; on_order: string; stock: string; lead_time_days: number; children: Line[] }
interface OrderData { id: number; number: string; item: { id: number; code: string; name: string; item_type: ItemType }; qty: string; rev: string; due_date: string | null; status: string; customer: string; serial_numbers: string; leaves: number; ready: number; percent: number; missing: number; overdue: boolean; days_left: number | null; created_at: string; tree: Line[] }

function countLeaves(l: Line): [number, number] {
  if (!l.children.length) return [1, l.status === "ready" ? 1 : 0];
  return l.children.reduce(([a, b], c) => { const [x, y] = countLeaves(c); return [a + x, b + y]; }, [0, 0] as [number, number]);
}

export default function Order() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const o = useData(() => api<OrderData>(`/api/simple/orders/${id}`), [id]);
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [q, setQ] = useState("");
  const data = o.data;
  const editable = can("kits:write");

  const patchLine = (lines: Line[], lid: number, upd: Partial<Line>): Line[] => lines.map((l) => (l.id === lid ? { ...l, ...upd } : { ...l, children: patchLine(l.children, lid, upd) }));

  const send = async (l: Line, body: { done?: boolean; received?: number }, undoBody?: { done?: boolean; received?: number }) => {
    try {
      const r = await post<{ received: string; done: boolean; kit_status: string }>(`/api/simple/orders/${id}/lines/${l.id}`, body);
      o.reload();
      if (undoBody) toast("ok", body.done ? `${l.item.code}: отмечено «пришло»` : body.done === false ? `${l.item.code}: отметка снята` : `${l.item.code}: пришло ${fmt(r.received)} из ${fmt(l.required)}`,
        async () => { await post(`/api/simple/orders/${id}/lines/${l.id}`, undoBody); o.reload(); });
    } catch (e) { toast("err", (e as Error).message); o.reload(); }
  };
  const toggle = (l: Line) => {
    const next = !(l.done || l.status === "ready");
    o.setData((cur) => (cur ? { ...cur, tree: patchLine(cur.tree, l.id, { done: next, status: next ? "ready" : "missing", received: next ? l.required : "0" }) } : cur));
    send(l, { done: next }, { received: Number(l.received), done: l.done });
  };
  const visible = (l: Line): boolean => {
    if (onlyMissing && l.status === "ready") return false;
    if (q && !(l.item.code + " " + l.item.name).toLowerCase().includes(q.toLowerCase()) && !l.children.some(visible)) return false;
    return true;
  };
  const setStatus = async (s: string) => { try { await post(`/api/simple/orders/${id}/status`, undefined, { status: s }); o.reload(); } catch (e) { toast("err", (e as Error).message); } };
  const missingLeaves = useMemo(() => { const out: Line[] = []; const walk = (l: Line) => { if (!l.children.length) { if (l.status !== "ready") out.push(l); } else l.children.forEach(walk); }; data?.tree.forEach(walk); return out; }, [data]);

  if (o.error) return <div className="errbox">{o.error} <Link to="/">← к заказам</Link></div>;
  if (!data) return <div className="muted">Загрузка…</div>;

  const Row = ({ l }: { l: Line }) => {
    if (!visible(l)) return null;
    const has = l.children.length > 0;
    const open = !collapsed.has(l.id);
    const [tot, ok] = has ? countLeaves(l) : [0, 0];
    const req = Number(l.required), rec = Number(l.received);
    return (
      <div>
        <div className={`tnode ${l.status}`}>
          <span className={`tg ${has ? "" : "leaf"}`} onClick={() => has && setCollapsed((s) => { const n = new Set(s); n.has(l.id) ? n.delete(l.id) : n.add(l.id); return n; })}>{has ? (open ? "▾" : "▸") : "·"}</span>
          <span className={`chk ${l.status === "ready" ? "on" : l.status === "partial" && !has ? "half" : ""}`} title={has ? (l.status === "ready" ? "Снять отметку «узел собран»" : "Отметить: узел собран / получен целиком") : (l.status === "ready" ? "Снять отметку" : "Отметить: пришло полностью")}
            onClick={() => editable && toggle(l)} style={{ cursor: editable ? "pointer" : "default" }}>{l.status === "ready" ? "✓" : l.status === "partial" && !has ? "◐" : ""}</span>
          <span title={TYPE_RU[l.item.item_type]}>{TYPE_ICON[l.item.item_type]}</span>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="tname">{l.item.name} {has && <Badge tone={l.status === "ready" ? "green" : "gray"}>{ok} / {tot}</Badge>}</div>
            <div className="tcode">{l.item.code}{l.note && ` · ${l.note}`}</div>
          </div>
          <span className="tqty" title={`${fmt(l.qty_per, 4)} на одно изделие`}>{fmt(l.required)} {l.item.unit}</span>
          {!has && (
            editable ? <RecvEditor value={rec} max={req} unit={l.item.unit} onChange={(v) => { o.setData((cur) => (cur ? { ...cur, tree: patchLine(cur.tree, l.id, { received: String(v), done: v >= req, status: v >= req ? "ready" : v > 0 ? "partial" : "missing" }) } : cur)); send(l, { received: v }, { received: rec, done: l.done }); }} />
              : <span className="tmeta">пришло {fmt(l.received)}</span>
          )}
          <span className="tmeta">
            {!has && l.status !== "ready" && Number(l.on_order) > 0 && <span title="Заказано у поставщиков">📨 {fmt(l.on_order)} в пути</span>}
            {!has && l.status !== "ready" && Number(l.stock) > 0 && <span title="Есть на складе"> · 🏬 {fmt(l.stock)} на складе</span>}
          </span>
        </div>
        {has && open && <div className="tkids">{l.children.map((c) => <Row key={c.id} l={c} />)}</div>}
      </div>
    );
  };

  return (
    <div className="stack">
      <div className="row small"><Link to="/">← Заказы</Link></div>
      <div className="ph">
        <Ring percent={data.percent} size={84} />
        <div className="grow">
          <h1>{TYPE_ICON[data.item.item_type]} {data.item.name} <span className="muted">× {fmt(data.qty)}</span></h1>
          <div className="sub"><span className="mono">{data.item.code}</span> · заказ {data.number} · редакция {data.rev}{data.customer && ` · ${data.customer}`}{data.serial_numbers && ` · зав. № ${data.serial_numbers}`}</div>
          <div className="row" style={{ marginTop: 6 }}><Status s={data.status} /><DueLabel due={data.due_date} days={data.days_left} done={data.status === "assembled" || data.status === "shipped"} />
            <span className={data.missing ? "warn" : "ok"}>{data.missing ? `не хватает ${data.missing} из ${data.leaves} позиций` : "все позиции в наличии"}</span></div>
        </div>
        <div className="row">
          <a className="btn" href={`/api/simple/orders/${id}/export.xlsx`} onClick={async (e) => { e.preventDefault(); const blob = await fetch(`/api/simple/orders/${id}/export.xlsx`, { headers: { Authorization: `Bearer ${localStorage.getItem("plm.access")}` } }).then((r) => r.blob()); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `Комплектация ${data.number}.xlsx`; a.click(); }}>⬇ Ведомость в Excel</a>
          <button onClick={() => window.print()}>🖨 Печать</button>
          {editable && data.status === "assembled" && <button className="primary" onClick={() => setStatus("shipped")}>Отгружен ✓</button>}
          {editable && data.status === "shipped" && <button onClick={() => setStatus("in_work")}>Вернуть в работу</button>}
        </div>
      </div>
      <Help id="order">Галочка слева — «пришло полностью». Если пришла часть — нажмите на число «пришло» и введите, сколько. Галочка на сборочном узле закрывает его целиком (например, узел получили в сборе). Красное — не хватает, жёлтое — частично или детали есть, но узел ещё не собран.</Help>
      <div className="row">
        <div className="seg"><button className={!onlyMissing ? "active" : ""} onClick={() => setOnlyMissing(false)}>Весь состав</button><button className={onlyMissing ? "active" : ""} onClick={() => setOnlyMissing(true)}>Только чего не хватает ({missingLeaves.length})</button></div>
        <input className="search" placeholder="Найти в составе…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="right row small"><button className="sm ghost" onClick={() => setCollapsed(new Set())}>Развернуть всё</button><button className="sm ghost" onClick={() => { const s = new Set<number>(); const walk = (l: Line) => { if (l.children.length) { s.add(l.id); l.children.forEach(walk); } }; data.tree.forEach(walk); setCollapsed(s); }}>Свернуть всё</button></div>
      </div>
      <div className="legend"><span><i style={{ background: "var(--green)" }} />пришло / собрано</span><span><i style={{ background: "var(--amber)" }} />частично</span><span><i style={{ background: "var(--red)" }} />нет</span><span className="right">◐ — пришла часть · 📨 — заказано у поставщика · 🏬 — есть на складе</span></div>
      <div className="tree">{data.tree.map((l) => <Row key={l.id} l={l} />)}</div>
      {onlyMissing && !missingLeaves.length && <div className="card empty-big"><div style={{ fontSize: 40 }}>🎉</div><b>Всё есть — можно собирать</b></div>}
      {missingLeaves.length > 0 && can("purchase:read") && <div className="row muted small">Не хватает {missingLeaves.length} позиций. Сводный список по всем заказам — в разделе <Link to="/shortage">Дефицит</Link>{can("purchase:write") && ", оттуда же можно передать снабжению"}.</div>}
      <div className="row small muted"><span>Создан {d(data.created_at)}</span><button className="sm ghost right" onClick={() => nav(`/specs/${data.item.id}`)}>Открыть спецификацию изделия →</button></div>
    </div>
  );
}

function RecvEditor({ value, max, unit, onChange }: { value: number; max: number; unit: string; onChange: (v: number) => void }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(String(value));
  if (!edit) return <button className="recv" title="Нажмите, чтобы ввести, сколько пришло" onClick={() => { setV(String(value)); setEdit(true); }}>пришло <b>{fmt(value)}</b> из {fmt(max)}</button>;
  const commit = () => { setEdit(false); const n = Math.max(0, Math.min(Number(v.replace(",", ".")) || 0, max)); if (n !== value) onChange(n); };
  return <span className="recv"><input autoFocus value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEdit(false); }} /> из {fmt(max)} {unit}</span>;
}
