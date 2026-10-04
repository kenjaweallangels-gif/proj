import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { d, fmt, get, post, TYPE_ICON, type Item } from "../api";
import { Badge, Card, Modal, Status, Table, useAuth, useData, useToast } from "../ui";

interface KitRow { id: number; number: string; item: { code: string; name: string }; qty: string; rev: string; due_date: string | null; status: string; total: number; done: number; percent: number; shortage_lines: number }
interface KitLine { id: number; parent_line_id: number | null; path: string; level: number; item: Item; qty_per: string; required_qty: string; issued_qty: string; done: boolean; note: string }
interface Kit { id: number; number: string; item: Item; qty: string; revision_id: number; serial_numbers: string; due_date: string | null; status: string; lines: KitLine[] }
interface WO { id: number; number: string; item: Item; qty: string; done_qty: string; kit_id: number | null; start_date: string | null; due_date: string | null; status: string; actual_hours: string }

export default function Kits() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState<"kits" | "wo">("kits");
  const kits = useData(() => get<KitRow[]>("/api/planning/kits"));
  const wos = useData(() => (can("wo:read") ? get<WO[]>("/api/planning/work-orders") : Promise.resolve([])));
  const kit = useData(() => (id ? get<Kit>(`/api/planning/kits/${id}`) : Promise.resolve(null)), [id]);
  const woStatus = async (w: WO, status: string) => {
    let qty: string | null = null;
    if (status === "done") { qty = prompt("Выпущено, шт:", w.qty); if (qty === null) return; }
    try { await post(`/api/planning/work-orders/${w.id}/status`, undefined, { status, done_qty: qty ?? undefined }); toast("ok", "Статус обновлён"); wos.reload(); } catch (e) { toast("err", (e as Error).message); }
  };
  return (
    <>
      <div className="tabs"><button className={tab === "kits" ? "active" : ""} onClick={() => setTab("kits")}>Комплекты · {kits.data?.length ?? "…"}</button>{can("wo:read") && <button className={tab === "wo" ? "active" : ""} onClick={() => setTab("wo")}>Производственные задания · {wos.data?.length ?? "…"}</button>}</div>
      {tab === "kits" && <Card>
        <Table rows={kits.data ?? []} keyFn={(k) => k.id} onRow={(k) => nav(`/kits/${k.id}`)} empty="Комплектов нет — запустите строку товарного плана" cols={[
          { h: "Номер", c: (k) => <span className="mono">{k.number}</span> }, { h: "Изделие", c: (k) => <><span className="mono">{k.item.code}</span> <span className="muted small">{k.item.name}</span> <Badge>рев. {k.rev}</Badge></> },
          { h: "Кол-во", c: (k) => fmt(k.qty), align: "r" }, { h: "Срок", c: (k) => d(k.due_date) },
          { h: "Комплектация", c: (k) => <div style={{ minWidth: 140 }}><div className="progress"><div style={{ width: `${k.percent}%` }} /></div><span className="small muted">{k.done} / {k.total} поз. · {k.percent}%</span></div> },
          { h: "Дефицит", c: (k) => k.shortage_lines ? <Badge tone="red">{k.shortage_lines} поз.</Badge> : <Badge tone="green">нет</Badge> }, { h: "Статус", c: (k) => <Status s={k.status} /> },
        ]} />
      </Card>}
      {tab === "wo" && <Card>
        <Table rows={wos.data ?? []} keyFn={(w) => w.id} empty="Нарядов нет" cols={[
          { h: "Номер", c: (w) => <span className="mono">{w.number}</span> }, { h: "Изделие", c: (w) => <Link to={`/items/${w.item.id}`}>{TYPE_ICON[w.item.item_type]} <span className="mono">{w.item.code}</span> <span className="muted small">{w.item.name}</span></Link> },
          { h: "План / факт", c: (w) => `${fmt(w.qty)} / ${fmt(w.done_qty)}`, align: "r" }, { h: "Комплект", c: (w) => w.kit_id ? <Link to={`/kits/${w.kit_id}`}>#{w.kit_id}</Link> : "—" },
          { h: "Срок", c: (w) => d(w.due_date) }, { h: "Статус", c: (w) => <Status s={w.status} /> },
          { h: "", c: (w) => can("wo:write") && w.status !== "done" ? <div className="row">
            {w.status === "planned" && <button className="sm" onClick={() => woStatus(w, "released")}>Выдать</button>}
            {w.status === "released" && <button className="sm" onClick={() => woStatus(w, "in_progress")}>В работу</button>}
            <button className="sm primary" onClick={() => woStatus(w, "done")}>✓ Выполнено</button></div> : null },
        ]} />
      </Card>}
      {id && kit.data && <KitDetail kit={kit.data} onClose={() => nav("/kits")} onChange={(k) => { kit.setData(k); kits.reload(); }} />}
    </>
  );
}

function KitDetail({ kit, onClose, onChange }: { kit: Kit; onClose: () => void; onChange: (k: Kit) => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const children = (pid: number | null) => kit.lines.filter((l) => l.parent_line_id === pid);
  const hasKids = new Set(kit.lines.filter((l) => l.parent_line_id !== null).map((l) => l.parent_line_id));
  const status = (l: KitLine): "ready" | "partial" | "missing" => {
    const kids = children(l.id);
    if (l.done || Number(l.issued_qty) >= Number(l.required_qty)) return "ready";
    if (kids.length) { const st = kids.map(status); return st.every((s) => s === "ready") ? "partial" : st.some((s) => s !== "missing") ? "partial" : "missing"; }
    return Number(l.issued_qty) > 0 ? "partial" : "missing";
  };
  const issue = async (l: KitLine) => {
    const rest = Number(l.required_qty) - Number(l.issued_qty);
    const q = prompt(`Выдать со склада в комплект ${l.item.code} (осталось ${fmt(rest)} ${l.item.unit}):`, String(rest));
    if (q === null || !Number(q)) return;
    try { onChange(await post<Kit>(`/api/planning/kits/${kit.id}/lines/${l.id}/issue`, undefined, { qty: q })); toast("ok", "Выдано"); } catch (e) { toast("err", (e as Error).message); }
  };
  const toggle = async (l: KitLine) => { try { onChange(await post<Kit>(`/api/planning/kits/${kit.id}/lines/${l.id}/toggle`)); } catch (e) { toast("err", (e as Error).message); } };
  const done = kit.lines.filter((l) => status(l) === "ready").length;
  const Row = ({ l }: { l: KitLine }) => {
    const kids = children(l.id);
    const st = status(l);
    const open = !collapsed.has(l.id);
    return (
      <div>
        <div className={`node ${st}`}>
          <span className={`tg ${kids.length ? "" : "leaf"}`} onClick={() => kids.length && setCollapsed((s) => { const n = new Set(s); n.has(l.id) ? n.delete(l.id) : n.add(l.id); return n; })}>{kids.length ? (open ? "▾" : "▸") : "·"}</span>
          {can("kits:write") && <span className={`chk ${l.done ? "on" : ""}`} title="Отметить получено/собрано" onClick={() => toggle(l)}>✓</span>}
          <span>{TYPE_ICON[l.item.item_type]}</span>
          <Link to={`/items/${l.item.id}`} className="code">{l.item.code}</Link><span className="name">{l.item.name}</span>
          <span className="meta">{fmt(l.qty_per, 4)} × → <b>{fmt(l.required_qty)} {l.item.unit}</b></span>
          <span className="right meta">выдано {fmt(l.issued_qty)} / {fmt(l.required_qty)}{st === "ready" && " ✓"}</span>
          {!kids.length && can("kits:write", "stock:write") && Number(l.issued_qty) < Number(l.required_qty) && <button className="sm" onClick={() => issue(l)}>Выдать</button>}
          {kids.length > 0 && !open && <Badge>{kids.length} поз.</Badge>}
        </div>
        {kids.length > 0 && open && <div className="kids">{kids.map((k) => <Row key={k.id} l={k} />)}</div>}
      </div>
    );
  };
  return (
    <Modal title={`Комплект ${kit.number} — ${kit.item.code} ${kit.item.name} × ${fmt(kit.qty)}`} onClose={onClose} wide>
      <div className="row"><Status s={kit.status} /><span className="muted small">срок {d(kit.due_date)}{kit.serial_numbers && ` · зав. № ${kit.serial_numbers}`}</span>
        <div className="grow" style={{ maxWidth: 260, marginLeft: "auto" }}><div className="progress"><div style={{ width: `${(done / Math.max(kit.lines.length, 1)) * 100}%` }} /></div><span className="small muted">{done} / {kit.lines.length} позиций готово</span></div></div>
      <div className="legend"><span><i style={{ background: "var(--green)" }} />получено / собрано</span><span><i style={{ background: "var(--amber)" }} />частично · детей хватает</span><span><i style={{ background: "var(--red)" }} />отсутствует</span></div>
      <div className="tree">{children(null).map((l) => <Row key={l.id} l={l} />)}</div>
      {hasKids.size === 0 && <p className="muted small">Состав плоский.</p>}
    </Modal>
  );
}
