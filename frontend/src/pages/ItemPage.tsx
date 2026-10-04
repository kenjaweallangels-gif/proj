import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { del, fmt, get, money, patch, post, TYPE_ICON, TYPE_LABEL, dt, type Item, type TreeNode } from "../api";
import { Badge, Card, ErrorBox, Field, Modal, Stat, Status, Table, useAuth, useData, useToast } from "../ui";

export function Tree({ node, depth = 0, marks, onMark }: { node: TreeNode; depth?: number; marks?: Record<number, boolean>; onMark?: (id: number) => void }) {
  const [open, setOpen] = useState(depth < 2);
  const has = node.children.length > 0;
  return (
    <div>
      <div className={`node ${node.status}`}>
        <span className={`tg ${has ? "" : "leaf"}`} onClick={() => has && setOpen(!open)}>{has ? (open ? "▾" : "▸") : "·"}</span>
        {onMark && <span className={`chk ${marks?.[node.item_id] ? "on" : ""}`} onClick={() => onMark(node.item_id)}>✓</span>}
        <span title={TYPE_LABEL[node.item_type]}>{TYPE_ICON[node.item_type]}</span>
        <Link to={`/items/${node.item_id}`} className="code">{node.code}</Link>
        <span className="name">{node.name}</span>
        {node.rev && <Badge>рев. {node.rev}</Badge>}
        <span className="meta">{depth > 0 && <>{fmt(node.qty_per, 4)} × → </>}<b>{fmt(node.total_qty, 4)} {node.unit}</b></span>
        <span className="right meta">
          остаток {fmt(node.stock_qty)}{Number(node.on_order) > 0 && <> · в заказе {fmt(node.on_order)}</>}
          {Number(node.shortage) > 0 && <> · <b style={{ color: "var(--red)" }}>дефицит {fmt(node.shortage)}</b></>}
          {!has && node.status === "ready" && <> · ✓</>}
        </span>
        {has && !open && <Badge>{countAll(node)} поз.</Badge>}
      </div>
      {has && open && <div className="kids">{node.children.map((c, i) => <Tree key={c.item_id + ":" + i} node={c} depth={depth + 1} marks={marks} onMark={onMark} />)}</div>}
    </div>
  );
}
function countAll(n: TreeNode): number { return n.children.reduce((s, c) => s + 1 + countAll(c), 0); }

interface Rev { id: number; rev: string; status: string; note: string; change_notice_id: number | null; released_at: string | null; created_at: string; lines: { id: number; child_item_id: number; qty: string; position: number; note: string; child: Item }[] }
interface Op { id: number; seq: number; name: string; work_center_id: number | null; setup_hours: string; run_hours: string; outsourced: boolean; outsource_kind: string | null; outsource_cost: string; tooling_item_id: number | null }
interface Cost { total: string; material: string; purchased: string; outsource: string; labor: string; hours: string; children: { code: string; name: string; qty: string; unit_total: string; total: string }[] }

export default function ItemPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState<"tree" | "rev" | "ops" | "cost" | "used" | "edit">("tree");
  const item = useData(() => get<Item>(`/api/items/${id}`), [id]);
  const tree = useData(() => get<TreeNode>(`/api/items/${id}/tree`), [id]);
  const revs = useData(() => get<Rev[]>(`/api/items/${id}/revisions`), [id]);
  const ops = useData(() => get<Op[]>(`/api/items/${id}/operations`), [id]);
  const wcs = useData(() => get<{ id: number; name: string }[]>("/api/work-centers"));
  const cost = useData(() => (can("finance:read") ? get<Cost>(`/api/items/${id}/cost`) : Promise.resolve(null)), [id]);
  const used = useData(() => get<{ item_id: number; code: string; name: string; rev: string; qty: string; status: string }[]>(`/api/items/${id}/where-used`), [id]);
  const [addLine, setAddLine] = useState(false);
  const [addOp, setAddOp] = useState(false);
  const it = item.data;
  if (item.error) return <ErrorBox text={item.error} />;
  if (!it) return <div className="muted">Загрузка…</div>;
  const draft = revs.data?.find((r) => r.status === "draft");
  const refreshAll = () => { tree.reload(); revs.reload(); item.reload(); cost.reload(); };

  const release = async () => {
    if (!confirm(`Выпустить ревизию ${draft?.rev}? Предыдущая выпущенная станет устаревшей.`)) return;
    try { await post(`/api/items/${id}/draft/release`); toast("ok", "Ревизия выпущена"); refreshAll(); } catch (e) { toast("err", (e as Error).message); }
  };
  return (
    <>
      <div className="row">
        <span style={{ fontSize: 28 }}>{TYPE_ICON[it.item_type]}</span>
        <div><h2><span className="mono">{it.code}</span> — {it.name}</h2>
          <div className="row small muted">{TYPE_LABEL[it.item_type]} · <Status s={it.lifecycle} /> · рев. {it.current_rev ?? "—"} · цикл {it.lead_time_days} дн · допуск {it.confidentiality}{it.material && <> · {it.material}</>}</div></div>
        <div className="right row">
          {can("bom:write") && <button onClick={() => setAddLine(true)}>＋ В состав</button>}
          {draft && can("ecn:implement") && <button className="primary" onClick={release}>Выпустить ревизию {draft.rev}</button>}
        </div>
      </div>
      <div className="stats">
        <Stat label="Остаток (доступно)" value={`${fmt(it.stock_qty)} ${it.unit}`} />
        <Stat label="Цена / стоимость ед." value={Number(it.std_cost) ? money(it.std_cost) : "—"} />
        {cost.data && <Stat label="Полная себестоимость" value={money(cost.data.total)} hint={`труд ${fmt(cost.data.hours, 2)} н-ч`} />}
        <Stat label="Входит в" value={used.data?.length ?? "…"} hint="изделий" />
      </div>
      <Card>
        <div className="tabs">
          {([["tree", "Состав (дерево)"], ["rev", `Ревизии (${revs.data?.length ?? 0})`], ["ops", `Техпроцесс (${ops.data?.length ?? 0})`], ["cost", "Себестоимость"], ["used", "Применяемость"], ["edit", "Карточка"]] as const)
            .map(([k, l]) => <button key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>{l}</button>)}
        </div>
        {tab === "tree" && (tree.data ? (
          <div className="tree">
            <div className="legend"><span><i style={{ background: "var(--green)" }} />готово / есть на складе</span><span><i style={{ background: "var(--amber)" }} />частично</span><span><i style={{ background: "var(--red)" }} />отсутствует</span></div>
            <Tree node={tree.data} />
          </div>) : <div className="muted">Загрузка…</div>)}
        {tab === "rev" && (
          <div className="grid">
            {(revs.data ?? []).slice().reverse().map((r) => (
              <Card key={r.id} title={<span>Ревизия {r.rev} <Status s={r.status} /> {r.change_notice_id && <Link to="/ecn" className="small">извещение #{r.change_notice_id}</Link>}</span>}
                actions={<span className="muted small">{r.released_at ? `выпущена ${dt(r.released_at)}` : `создана ${dt(r.created_at)}`}{r.note && ` · ${r.note}`}</span>}>
                <Table rows={r.lines} keyFn={(l) => l.id} empty="Состав пуст"
                  cols={[
                    { h: "№", c: (l) => l.position, w: "40px" },
                    { h: "", c: (l) => TYPE_ICON[l.child.item_type], w: "30px" },
                    { h: "Обозначение", c: (l) => <Link to={`/items/${l.child.id}`} className="mono">{l.child.code}</Link> },
                    { h: "Наименование", c: (l) => l.child.name },
                    { h: "Кол-во", c: (l) => `${fmt(l.qty, 4)} ${l.child.unit}`, align: "r" },
                    { h: "Прим.", c: (l) => <span className="muted small">{l.note}</span> },
                    { h: "", c: (l) => r.status === "draft" && can("bom:write") ? <button className="sm danger" onClick={async (e) => { e.stopPropagation(); await del(`/api/items/${id}/draft/lines/${l.id}`); refreshAll(); }}>Убрать</button> : null, w: "70px" },
                  ]} />
              </Card>
            ))}
          </div>
        )}
        {tab === "ops" && (
          <>
            {can("items:write") && <div className="row" style={{ marginBottom: 8 }}><button className="sm" onClick={() => setAddOp(true)}>＋ Операция</button></div>}
            <Table rows={ops.data ?? []} keyFn={(o) => o.id} empty="Техпроцесс не задан"
              cols={[
                { h: "№", c: (o) => o.seq, w: "50px" }, { h: "Операция", c: (o) => o.name },
                { h: "Где", c: (o) => o.outsourced ? <Badge tone="blue">на стороне · {o.outsource_kind ?? ""}</Badge> : (wcs.data?.find((w) => w.id === o.work_center_id)?.name ?? "—") },
                { h: "Тпз, ч", c: (o) => fmt(o.setup_hours, 2), align: "r" }, { h: "Тшт, ч", c: (o) => fmt(o.run_hours, 3), align: "r" },
                { h: "Стоимость на стороне", c: (o) => o.outsourced ? money(o.outsource_cost) : "—", align: "r" },
                { h: "", c: (o) => can("items:write") ? <button className="sm danger" onClick={async () => { await del(`/api/items/${id}/operations/${o.id}`); ops.reload(); cost.reload(); }}>✕</button> : null, w: "50px" },
              ]} />
          </>
        )}
        {tab === "cost" && (cost.data ? (
          <>
            <div className="stats" style={{ marginBottom: 12 }}>
              <Stat label="Материалы" value={money(cost.data.material)} /><Stat label="ПКИ и крепёж" value={money(cost.data.purchased)} />
              <Stat label="Кооперация" value={money(cost.data.outsource)} /><Stat label="Труд (все уровни)" value={money(cost.data.labor)} hint={`${fmt(cost.data.hours, 2)} н-ч`} />
              <Stat label="Итого" value={money(cost.data.total)} tone="green" />
            </div>
            <div className="bar">{(["material", "purchased", "outsource", "labor"] as const).map((k, i) => <i key={k} style={{ width: `${(Number(cost.data![k]) / Math.max(Number(cost.data!.total), 1)) * 100}%`, background: ["#1f9d55", "#2457d6", "#c77800", "#8b5cf6"][i] }} />)}</div>
            <div className="legend" style={{ margin: "6px 0 14px" }}><span><i style={{ background: "#1f9d55" }} />материалы</span><span><i style={{ background: "#2457d6" }} />ПКИ</span><span><i style={{ background: "#c77800" }} />кооперация</span><span><i style={{ background: "#8b5cf6" }} />труд</span></div>
            <Table rows={cost.data.children} keyFn={(c) => c.code} empty="Нет составляющих" cols={[
              { h: "Составляющая", c: (c) => <><span className="mono">{c.code}</span> <span className="muted">{c.name}</span></> },
              { h: "Кол-во", c: (c) => fmt(c.qty, 4), align: "r" }, { h: "За ед.", c: (c) => money(c.unit_total), align: "r" }, { h: "Всего", c: (c) => money(c.total), align: "r" },
            ]} />
          </>) : <div className="muted">Нет доступа к финансовым данным или загрузка…</div>)}
        {tab === "used" && <Table rows={used.data ?? []} keyFn={(u) => u.item_id + u.rev} empty="Не входит ни в одно изделие" cols={[
          { h: "Изделие", c: (u) => <Link to={`/items/${u.item_id}`} className="mono">{u.code}</Link> }, { h: "Наименование", c: (u) => u.name },
          { h: "Рев.", c: (u) => <>{u.rev} <Status s={u.status} /></> }, { h: "Кол-во", c: (u) => fmt(u.qty, 4), align: "r" },
        ]} />}
        {tab === "edit" && <EditCard item={it} onSaved={() => { item.reload(); cost.reload(); }} />}
      </Card>
      {addLine && <AddLine itemId={it.id} onClose={() => setAddLine(false)} onDone={() => { setAddLine(false); refreshAll(); setTab("rev"); }} />}
      {addOp && <AddOp itemId={it.id} wcs={wcs.data ?? []} onClose={() => setAddOp(false)} onDone={() => { setAddOp(false); ops.reload(); cost.reload(); }} />}
    </>
  );
}

export function ItemPicker({ value, onChange, placeholder = "Начните вводить обозначение…" }: { value: Item | null; onChange: (i: Item | null) => void; placeholder?: string }) {
  const [q, setQ] = useState("");
  const res = useData(() => (q.length >= 2 ? get<{ items: Item[] }>("/api/items", { q, size: 10 }) : Promise.resolve({ items: [] })), [q]);
  if (value) return <div className="row"><Badge tone="blue">{TYPE_ICON[value.item_type]} {value.code}</Badge><span className="small">{value.name}</span><button type="button" className="sm" onClick={() => onChange(null)}>✕</button></div>;
  return (
    <div style={{ position: "relative" }}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} />
      {q.length >= 2 && (res.data?.items.length ?? 0) > 0 && (
        <div className="card" style={{ position: "absolute", zIndex: 10, left: 0, right: 0, padding: 4, maxHeight: 240, overflow: "auto" }}>
          {res.data!.items.map((i) => <div key={i.id} style={{ padding: "6px 8px", cursor: "pointer" }} onMouseDown={() => { onChange(i); setQ(""); }}>{TYPE_ICON[i.item_type]} <span className="mono">{i.code}</span> <span className="muted">{i.name}</span></div>)}
        </div>
      )}
    </div>
  );
}

function AddLine({ itemId, onClose, onDone }: { itemId: number; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [child, setChild] = useState<Item | null>(null);
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!child) return;
    try { await post(`/api/items/${itemId}/draft/lines`, { child_item_id: child.id, qty, note }); toast("ok", "Добавлено в черновую ревизию"); onDone(); } catch (err) { toast("err", (err as Error).message); }
  };
  return (
    <Modal title="Добавить в состав (черновая ревизия)" onClose={onClose}>
      <form className="grid" onSubmit={submit}>
        <Field label="Составляющая"><ItemPicker value={child} onChange={setChild} /></Field>
        <div className="form"><Field label="Количество"><input type="number" step="0.0001" min={0.0001} value={qty} onChange={(e) => setQty(+e.target.value)} /></Field><Field label="Примечание"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field></div>
        <p className="muted small">Правка попадает в черновую ревизию. Для выпущенных изделий штатный путь — извещение об изменении.</p>
        <div className="row"><button className="primary" disabled={!child}>Добавить</button><button type="button" onClick={onClose}>Отмена</button></div>
      </form>
    </Modal>
  );
}

function AddOp({ itemId, wcs, onClose, onDone }: { itemId: number; wcs: { id: number; name: string }[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ seq: 10, name: "", work_center_id: wcs[0]?.id ?? null, setup_hours: 0, run_hours: 0, outsourced: false, outsource_kind: "coating", outsource_cost: 0 });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try { await post(`/api/items/${itemId}/operations`, { ...f, work_center_id: f.outsourced ? null : f.work_center_id, outsource_kind: f.outsourced ? f.outsource_kind : null }); onDone(); } catch (err) { toast("err", (err as Error).message); }
  };
  return (
    <Modal title="Операция техпроцесса" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <Field label="№"><input type="number" value={f.seq} onChange={(e) => setF({ ...f, seq: +e.target.value })} /></Field>
        <Field label="Название"><input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Выполняется"><select value={f.outsourced ? "out" : "in"} onChange={(e) => setF({ ...f, outsourced: e.target.value === "out" })}><option value="in">На своём участке</option><option value="out">На стороне (кооперация)</option></select></Field>
        {f.outsourced ? (<>
          <Field label="Вид кооперации"><select value={f.outsource_kind} onChange={(e) => setF({ ...f, outsource_kind: e.target.value })}>{["coating", "heat_treatment", "machining", "welding", "casting", "sheet_metal", "pcb", "other"].map((k) => <option key={k} value={k}>{k}</option>)}</select></Field>
          <Field label="Стоимость за ед., ₽"><input type="number" step="0.01" value={f.outsource_cost} onChange={(e) => setF({ ...f, outsource_cost: +e.target.value })} /></Field>
        </>) : (<>
          <Field label="Рабочий центр"><select value={f.work_center_id ?? ""} onChange={(e) => setF({ ...f, work_center_id: +e.target.value })}>{wcs.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
          <Field label="Тпз, ч"><input type="number" step="0.01" value={f.setup_hours} onChange={(e) => setF({ ...f, setup_hours: +e.target.value })} /></Field>
          <Field label="Тшт, ч"><input type="number" step="0.001" value={f.run_hours} onChange={(e) => setF({ ...f, run_hours: +e.target.value })} /></Field>
        </>)}
        <div className="full row"><button className="primary">Сохранить</button><button type="button" onClick={onClose}>Отмена</button></div>
      </form>
    </Modal>
  );
}

function EditCard({ item, onSaved }: { item: Item; onSaved: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const [f, setF] = useState({ name: item.name, item_type: item.item_type, unit: item.unit, material: item.material, description: item.description, lead_time_days: item.lead_time_days, min_stock: item.min_stock, lot_size: item.lot_size, std_cost: item.std_cost, confidentiality: item.confidentiality });
  const save = async (e: FormEvent) => { e.preventDefault(); try { await patch(`/api/items/${item.id}`, f); toast("ok", "Сохранено"); onSaved(); } catch (err) { toast("err", (err as Error).message); } };
  const ro = !can("items:write");
  return (
    <form className="form" onSubmit={save}>
      <Field label="Наименование"><input disabled={ro} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="Тип"><select disabled={ro} value={f.item_type} onChange={(e) => setF({ ...f, item_type: e.target.value as Item["item_type"] })}>{Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="Ед. изм."><input disabled={ro} value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} /></Field>
      <Field label="Материал"><input disabled={ro} value={f.material} onChange={(e) => setF({ ...f, material: e.target.value })} /></Field>
      <Field label="Цикл изготовления/поставки, дн"><input disabled={ro} type="number" value={f.lead_time_days} onChange={(e) => setF({ ...f, lead_time_days: +e.target.value })} /></Field>
      <Field label="Минимальный запас"><input disabled={ro} type="number" step="0.0001" value={f.min_stock} onChange={(e) => setF({ ...f, min_stock: e.target.value })} /></Field>
      <Field label="Партия заказа / запуска"><input disabled={ro} type="number" step="0.0001" value={f.lot_size} onChange={(e) => setF({ ...f, lot_size: e.target.value })} /></Field>
      <Field label="Цена / стоимость, ₽"><input disabled={ro} type="number" step="0.01" value={f.std_cost} onChange={(e) => setF({ ...f, std_cost: e.target.value })} /></Field>
      <Field label="Конфиденциальность (0–3)"><input disabled={ro} type="number" min={0} max={3} value={f.confidentiality} onChange={(e) => setF({ ...f, confidentiality: +e.target.value })} /></Field>
      <Field label="Описание"><textarea disabled={ro} rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} className="full" /></Field>
      {!ro && <div className="full"><button className="primary">Сохранить</button></div>}
    </form>
  );
}
