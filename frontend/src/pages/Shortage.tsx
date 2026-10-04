import { useState } from "react";
import { Link } from "react-router-dom";
import { api, d, fmt, post, TYPE_ICON, type ItemType } from "../api";
import { Badge, Help, useAuth, useData, useToast } from "../ui";

interface Row { item: { id: number; code: string; name: string; item_type: ItemType; unit: string }; need: string; stock: string; on_order: string; uncovered: string; earliest: string | null; order_by: string | null; late: boolean; lead_time_days: number; orders: { id: number; number: string; qty: string; due_date: string | null }[] }

export default function Shortage() {
  const { can } = useAuth();
  const toast = useToast();
  const rows = useData(() => api<Row[]>("/api/simple/shortage"));
  const [onlyUncovered, setOnly] = useState(true);
  const [q, setQ] = useState("");
  const list = (rows.data ?? []).filter((r) => (!onlyUncovered || Number(r.uncovered) > 0) && (!q || (r.item.code + " " + r.item.name).toLowerCase().includes(q.toLowerCase())));
  const late = list.filter((r) => r.late).length;
  const download = async () => {
    const blob = await fetch("/api/simple/shortage/export.xlsx", { headers: { Authorization: `Bearer ${localStorage.getItem("plm.access")}` } }).then((r) => r.blob());
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "Ведомость дефицита.xlsx"; a.click();
  };
  const request = async () => {
    if (!confirm("Создать черновики заказов поставщикам по всем непокрытым позициям? Их увидит снабжение в разделе «Ещё → Закупки».")) return;
    try { const r = await post<{ orders: { number: string; lines: number }[] }>("/api/simple/shortage/request"); toast("ok", r.orders.length ? `Создано заказов: ${r.orders.map((o) => `${o.number} (${o.lines} поз.)`).join(", ")}` : "Непокрытых позиций нет"); rows.reload(); } catch (e) { toast("err", (e as Error).message); }
  };
  return (
    <div className="stack">
      <div className="ph">
        <div><h1>Дефицит</h1><div className="sub">Чего не хватает по всем заказам в работе — с учётом склада и того, что уже заказано.</div></div>
        <div className="right row">
          <button onClick={download}>⬇ Ведомость в Excel</button>
          {can("purchase:write") && <button className="primary big" onClick={request} disabled={!list.some((r) => Number(r.uncovered) > 0)}>📨 Передать снабжению</button>}
        </div>
      </div>
      <Help id="shortage">«Нужно» — сколько ещё не пришло по заказам. «Не покрыто» — за вычетом склада и уже заказанного у поставщиков. «Заказать до» — последний день, чтобы успеть к сроку с учётом цикла поставки. Красные строки уже опаздывают.</Help>
      <div className="row">
        <div className="seg"><button className={onlyUncovered ? "active" : ""} onClick={() => setOnly(true)}>Не покрыто</button><button className={!onlyUncovered ? "active" : ""} onClick={() => setOnly(false)}>Всё, чего ждём</button></div>
        <input className="search" placeholder="Найти…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="right muted">{list.length} позиций{late > 0 && <> · <span className="warn">{late} опаздывают</span></>}</span>
      </div>
      {rows.data && !list.length && <div className="card empty-big"><div style={{ fontSize: 40 }}>🎉</div><b>{onlyUncovered ? "Всё покрыто складом и заказами" : "Дефицита нет"}</b><div className="muted">Когда создадите заказ и в нём чего-то не будет хватать — позиции появятся здесь.</div></div>}
      <div className="olist">
        {list.map((r) => (
          <div key={r.item.id} className={`orow ${r.late ? "overdue" : ""}`} style={{ gridTemplateColumns: "44px 1fr auto" }}>
            <span style={{ fontSize: 30, textAlign: "center" }}>{TYPE_ICON[r.item.item_type]}</span>
            <div style={{ minWidth: 0 }}>
              <div className="orow-t">{r.item.name} <span className="muted mono small">{r.item.code}</span></div>
              <div className="orow-m">нужно <b>{fmt(r.need)} {r.item.unit}</b>{Number(r.stock) > 0 && <> · на складе {fmt(r.stock)}</>}{Number(r.on_order) > 0 && <> · заказано {fmt(r.on_order)}</>} · для: {r.orders.map((o) => <Link key={o.id} to={`/orders/${o.id}`} style={{ marginRight: 6 }}>{o.number} ({fmt(o.qty)})</Link>)}</div>
            </div>
            <div className="orow-r">
              {Number(r.uncovered) > 0 ? <span className="warn" style={{ fontSize: 18 }}>не покрыто {fmt(r.uncovered)}</span> : <Badge tone="green">покрыто</Badge>}
              {r.order_by && <span className={`small ${r.late ? "warn" : "muted"}`}>{r.late ? "надо было заказать до" : "заказать до"} {d(r.order_by)} · цикл {r.lead_time_days} дн</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
