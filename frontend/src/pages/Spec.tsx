import { useState, type FormEvent, type KeyboardEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, del, dt, fmt, get, patch, post, TYPE_ICON, type ItemType } from "../api";
import { useRef } from "react";
import { Badge, Field, Help, Modal, Status, TYPE_RU, useAuth, useData, useToast } from "../ui";
import { CreateOrder } from "./Orders";

interface Node { line_id: number | null; item_id: number; code: string; name: string; item_type: ItemType; unit: string; qty: string; level: number; children: Node[] }
interface SpecData { item: { id: number; code: string; name: string; item_type: ItemType }; rev: string | null; rev_status: string | null; has_draft: boolean; released_rev: string | null; tree: Node; revisions: { rev: string; status: string; note: string; released_at: string | null; created_at: string }[] }

export default function Spec() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const s = useData(() => api<SpecData>(`/api/simple/specs/${id}`), [id]);
  const specs = useData(() => get<{ id: number; code: string; name: string; positions: number }[]>("/api/simple/specs"));
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [adding, setAdding] = useState<number | null>(null); // item_id родителя, куда добавляем
  const [order, setOrder] = useState(false);
  const [hist, setHist] = useState(false);
  const editable = can("bom:write");
  const data = s.data;
  const act = async (fn: () => Promise<unknown>, okText?: string) => { try { await fn(); s.reload(); if (okText) toast("ok", okText); } catch (e) { toast("err", (e as Error).message); } };
  if (s.error) return <div className="errbox">{s.error} <Link to="/specs">← к спецификациям</Link></div>;
  if (!data) return <div className="muted">Загрузка…</div>;
  const count = (n: Node): number => n.children.reduce((a, c) => a + 1 + count(c), 0);

  const Row = ({ n, parent }: { n: Node; parent: Node | null }) => {
    const has = n.children.length > 0;
    const open = !collapsed.has(n.item_id * 100000 + (n.line_id ?? 0));
    const key = n.item_id * 100000 + (n.line_id ?? 0);
    const isRoot = parent === null;
    return (
      <div>
        <div className="tnode edit">
          <span className={`tg ${has ? "" : "leaf"}`} onClick={() => has && setCollapsed((c) => { const x = new Set(c); x.has(key) ? x.delete(key) : x.add(key); return x; })}>{has ? (open ? "▾" : "▸") : "·"}</span>
          <TypePick value={n.item_type} editable={editable && !isRoot} onChange={(t) => parent && n.line_id && act(() => patch(`/api/simple/specs/${parent.item_id}/lines/${n.line_id}`, { item_type: t }))} />
          <div className="grow" style={{ minWidth: 0 }}>
            <div><Inline value={n.name} className="tname" editable={editable} onSave={(v) => isRoot ? act(() => patch(`/api/items/${n.item_id}`, { name: v })) : parent && n.line_id && act(() => patch(`/api/simple/specs/${parent.item_id}/lines/${n.line_id}`, { name: v }))} /></div>
            <div><Inline value={n.code} className="tcode" editable={editable && !isRoot} onSave={(v) => parent && n.line_id && act(() => patch(`/api/simple/specs/${parent.item_id}/lines/${n.line_id}`, { code: v }))} /></div>
          </div>
          {!isRoot && <Inline value={fmt(n.qty, 4)} className="tqty" editable={editable} suffix={` ${n.unit}`} width={70} onSave={(v) => parent && n.line_id && act(() => patch(`/api/simple/specs/${parent.item_id}/lines/${n.line_id}`, { qty: Number(v.replace(",", ".")) }))} />}
          {has && !open && <Badge>{count(n)} поз.</Badge>}
          {editable && <span className="row hov" style={{ gap: 4 }}>
            <button className="sm" title="Добавить строку внутрь (уровень ниже)" onClick={() => setAdding(n.item_id)}>＋ внутрь</button>
            {!isRoot && parent && <button className="sm" title="Добавить строку рядом (тот же уровень)" onClick={() => setAdding(parent.item_id)}>＋ рядом</button>}
            {!isRoot && parent && n.line_id && <button className="sm danger" title="Убрать из состава" onClick={() => confirm(`Убрать «${n.name}» из состава${has ? " вместе с вложенными" : ""}?`) && act(() => del(`/api/simple/specs/${parent.item_id}/lines/${n.line_id}`), "Строка убрана")}>✕</button>}
          </span>}
        </div>
        {has && open && <div className="tkids">{n.children.map((c, i) => <Row key={c.line_id ?? i} n={c} parent={n} />)}</div>}
      </div>
    );
  };

  return (
    <div className="stack">
      <div className="row small"><Link to="/specs">← Спецификации</Link></div>
      <div className="ph">
        <div className="grow">
          <h1>{TYPE_ICON[data.item.item_type]} {data.item.name}</h1>
          <div className="sub row"><span className="mono">{data.item.code}</span><span>· редакция {data.released_rev ?? "—"}</span>{data.rev_status && <Status s={data.has_draft ? "draft" : data.rev_status} />}<button className="sm ghost" onClick={() => setHist(true)}>история редакций ({data.revisions.length})</button></div>
        </div>
        <div className="row">
          {can("kits:write") && data.tree.children.length > 0 && <button className="primary big" onClick={() => setOrder(true)}>📦 Создать заказ</button>}
          <Link to={`/items/${data.item.id}`}><button>Подробная карточка</button></Link>
        </div>
      </div>
      <ModelBlock itemId={data.item.id} editable={can("items:write")} />
      {data.has_draft && (
        <div className="sticky-actions">
          <b>Есть несохранённые изменения состава.</b><span className="muted">Заказы пока используют редакцию {data.released_rev ?? "—"}.</span>
          <button className="primary right" onClick={() => act(() => post(`/api/simple/specs/${data.item.id}/apply`), "Изменения применены — новая редакция действует")}>✔ Применить изменения</button>
          <button onClick={() => confirm("Отменить все несохранённые правки?") && act(() => post(`/api/simple/specs/${data.item.id}/discard`), "Правки отменены")}>Отменить</button>
        </div>
      )}
      <Help id="spec">Правьте прямо в дереве: нажмите на название, обозначение или количество — и введите новое. Наведите на строку — появятся кнопки «＋ внутрь» (добавить вложенную), «＋ рядом» и «✕». Когда закончите — «Применить изменения».</Help>
      {!data.tree.children.length && <div className="card empty-big"><div style={{ fontSize: 40 }}>🧩</div><b>Состав пока пустой</b><div className="muted">Нажмите «＋ Добавить первую строку» — или загрузите Excel в разделе «Спецификации».</div>{editable && <button className="primary" onClick={() => setAdding(data.item.id)}>＋ Добавить первую строку</button>}</div>}
      <div className="tree"><Row n={data.tree} parent={null} /></div>
      {adding !== null && <AddLine parentId={adding} onClose={() => setAdding(null)} onDone={() => { setAdding(null); s.reload(); }} />}
      {order && <CreateOrder specs={specs.data ?? []} presetId={data.item.id} onClose={() => setOrder(false)} onDone={(oid) => nav(`/orders/${oid}`)} />}
      {hist && <Modal title="История редакций" onClose={() => setHist(false)}>
        {data.revisions.slice().reverse().map((r) => <div key={r.rev} className="row" style={{ padding: "6px 0", borderBottom: "1px solid var(--line)" }}><b>Редакция {r.rev}</b><Status s={r.status} /><span className="muted small">{r.released_at ? `действует с ${dt(r.released_at)}` : `создана ${dt(r.created_at)}`}</span>{r.note && <span className="small">· {r.note}</span>}</div>)}
        <p className="muted small">Полная история с извещениями об изменении — в «Ещё → Изменения спецификаций».</p>
      </Modal>}
    </div>
  );
}

function Inline({ value, onSave, editable, className, suffix = "", width }: { value: string; onSave: (v: string) => void; editable: boolean; className?: string; suffix?: string; width?: number }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(value);
  if (!editable) return <span className={className}>{value}{suffix}</span>;
  if (!edit) return <span className={`inl ${className ?? ""}`} title="Нажмите, чтобы изменить" onClick={() => { setV(value); setEdit(true); }}>{value}{suffix}</span>;
  const commit = () => { setEdit(false); if (v.trim() && v !== value) onSave(v.trim()); };
  const key = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEdit(false); };
  return <span className="inl"><input autoFocus value={v} style={{ width: width ?? Math.max(120, value.length * 9) }} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={key} />{suffix}</span>;
}

function TypePick({ value, editable, onChange }: { value: ItemType; editable: boolean; onChange: (t: string) => void }) {
  if (!editable) return <span title={TYPE_RU[value]}>{TYPE_ICON[value]}</span>;
  return (
    <select value={value} title={TYPE_RU[value]} onChange={(e) => onChange(e.target.value)} style={{ width: 52, padding: "4px 2px", border: "1px solid transparent", background: "transparent", fontSize: 18, cursor: "pointer" }}>
      {Object.entries(TYPE_RU).filter(([k]) => k !== "product").map(([k, v]) => <option key={k} value={k}>{TYPE_ICON[k as ItemType]} {v}</option>)}
    </select>
  );
}

function AddLine({ parentId, onClose, onDone }: { parentId: number; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ code: "", name: "", qty: 1, unit: "шт", item_type: "part" });
  const [found, setFound] = useState<{ code: string; name: string; item_type: ItemType; unit: string }[]>([]);
  const search = async (code: string) => {
    setF({ ...f, code });
    if (code.length >= 2) { try { setFound((await get<{ items: typeof found }>("/api/items", { q: code, size: 6 })).items); } catch { /* empty */ } } else setFound([]);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try { await post(`/api/simple/specs/${parentId}/lines`, f); toast("ok", "Строка добавлена"); onDone(); } catch (err) { toast("err", (err as Error).message); }
  };
  const exists = found.find((x) => x.code === f.code.trim().toUpperCase());
  return (
    <Modal title="Добавить в состав" onClose={onClose}>
      <form className="stack" onSubmit={submit} style={{ gap: 14 }}>
        <Field label="Обозначение" hint={exists ? `Такая позиция уже есть в базе: «${exists.name}» — будет использована она` : "Если такого обозначения ещё нет — позиция будет создана"}>
          <input autoFocus value={f.code} onChange={(e) => search(e.target.value)} placeholder="АБВГ.123456.001 или ГОСТ 7798 Болт М8" />
          {found.length > 0 && !exists && <div className="plist card" style={{ padding: 4, marginTop: 4 }}>{found.map((x) => <div key={x.code} className="pitem" onClick={() => { setF({ ...f, code: x.code, name: x.name, item_type: x.item_type, unit: x.unit }); setFound([]); }}>{TYPE_ICON[x.item_type]} <b className="mono">{x.code}</b> {x.name}</div>)}</div>}
        </Field>
        {!exists && <Field label="Наименование"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>}
        <div className="form">
          <Field label="Количество"><input type="number" step="0.0001" min={0.0001} value={f.qty} onChange={(e) => setF({ ...f, qty: +e.target.value })} /></Field>
          <Field label="Ед. изм."><input value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} /></Field>
          {!exists && <Field label="Что это"><select value={f.item_type} onChange={(e) => setF({ ...f, item_type: e.target.value })}>{Object.entries(TYPE_RU).filter(([k]) => k !== "product").map(([k, v]) => <option key={k} value={k}>{TYPE_ICON[k as ItemType]} {v}</option>)}</select></Field>}
        </div>
        <div className="row"><button className="primary" disabled={!f.code.trim()}>Добавить</button><button type="button" onClick={onClose}>Отмена</button></div>
      </form>
    </Modal>
  );
}


interface ModelInfo { exists: boolean; filename?: string; format?: string; size?: number; nodes?: number; uploaded_at?: string; url?: string }

function ModelBlock({ itemId, editable }: { itemId: number; editable: boolean }) {
  const toast = useToast();
  const info = useData(() => get<ModelInfo>(`/api/assembly/models/${itemId}`), [itemId]);
  const [busy, setBusy] = useState(false);
  const [nodes, setNodes] = useState<string[] | null>(null);
  const inp = useRef<HTMLInputElement>(null);
  const upload = async (f: File) => {
    const fd = new FormData(); fd.append("file", f);
    setBusy(true);
    try { const r = await api<{ nodes: number; format: string }>(`/api/assembly/models/${itemId}`, { method: "POST", form: fd }); toast("ok", `Модель загружена (${r.format.toUpperCase()}, узлов: ${r.nodes})`); info.reload(); setNodes(null); }
    catch (e) { toast("err", (e as Error).message); } finally { setBusy(false); }
  };
  const m = info.data;
  return (
    <div className="card" style={{ display: "grid", gap: 8 }}>
      <div className="row">
        <b>🎬 3D-модель для виртуальной сборки</b>
        {m?.exists ? <Badge tone="green">загружена · {m.format?.toUpperCase()} · {Math.round((m.size ?? 0) / 1024 / 1024 * 10) / 10} МБ · узлов {m.nodes}</Badge> : <Badge>нет</Badge>}
        <span className="right row">
          {editable && <><input ref={inp} type="file" hidden accept=".step,.stp,.glb,.gltf,.stl,.obj" onChange={(e) => { if (e.target.files?.[0]) upload(e.target.files[0]); e.target.value = ""; }} />
            <button className={m?.exists ? "" : "primary"} disabled={busy} onClick={() => inp.current?.click()}>{busy ? "⏳ Обработка…" : m?.exists ? "Заменить модель" : "＋ Загрузить STEP / GLB"}</button></>}
          {m?.exists && <button className="sm" onClick={async () => setNodes((await get<{ nodes: string[] }>(`/api/assembly/models/${itemId}/nodes`)).nodes)}>Имена деталей в модели</button>}
          {m?.exists && editable && <button className="sm danger" onClick={async () => { if (confirm("Удалить 3D-модель?")) { await del(`/api/assembly/models/${itemId}`); info.reload(); } }}>Удалить</button>}
        </span>
      </div>
      <div className="muted small">Экспортируйте сборку из CAD в <b>STEP</b> (сервер сам переведёт в веб-формат) или GLB/glTF. Чтобы детали анимировались по шагам, их имена в модели должны содержать обозначения из спецификации (например «РЧ-100.01.001 Корпус»). Несопоставленные детали просто остаются на месте.</div>
      {nodes && <div className="small" style={{ maxHeight: 160, overflow: "auto" }}>{nodes.length ? nodes.map((n) => <Badge key={n}>{n}</Badge>) : <span className="muted">Имён не найдено — модель без структуры (например, один сплошной меш).</span>}</div>}
    </div>
  );
}
