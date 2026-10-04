import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, dt, post, TYPE_ICON, type ItemType } from "../api";
import { Badge, Help, useAuth, useData, useToast } from "../ui";

interface SpecRow { id: number; code: string; name: string; item_type: ItemType; rev: string | null; positions: number; has_draft: boolean; open_orders: number; updated_at: string }

export function Dropzone({ onDone, compact }: { onDone: (r: { applied: boolean; item_id?: number; token?: string; root_count?: number; preview?: unknown }) => void; compact?: boolean }) {
  const toast = useToast();
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const inp = useRef<HTMLInputElement>(null);
  const upload = async (f: File) => {
    const fd = new FormData(); fd.append("file", f);
    setBusy(true);
    try { onDone(await api("/api/simple/import", { method: "POST", form: fd })); } catch (e) { toast("err", (e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className={`drop ${drag ? "on" : ""} ${compact ? "compact" : ""}`} onClick={() => inp.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) upload(f); }}>
      <input ref={inp} type="file" accept=".xlsx,.xlsm" hidden onChange={(e) => { if (e.target.files?.[0]) upload(e.target.files[0]); e.target.value = ""; }} />
      <div className="drop-i">{busy ? "⏳" : "📂"}</div>
      <div><b>{busy ? "Читаю файл…" : "Загрузить спецификацию из Excel"}</b>
        {!compact && <div className="muted">Перетащите файл сюда или нажмите. Нужны колонки «Обозначение», «Наименование», «Кол-во»; вложенность — колонкой «Входит в», «Уровень» или просто отступами. Колонки распознаются сами.</div>}</div>
    </div>
  );
}

export default function Specs() {
  const nav = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const specs = useData(() => api<SpecRow[]>("/api/simple/specs"));
  const [q, setQ] = useState("");
  const list = (specs.data ?? []).filter((s) => !q || (s.code + " " + s.name).toLowerCase().includes(q.toLowerCase()));
  const onImport = (r: { applied: boolean; item_id?: number; root_count?: number; token?: string; preview?: unknown }) => {
    if (r.applied && r.item_id) { toast("ok", r.root_count && r.root_count > 1 ? `Загружено изделий: ${r.root_count}` : "Спецификация загружена"); nav(`/specs/${r.item_id}`); }
    else if (r.applied) { toast("ok", "Загружено"); specs.reload(); }
    else { toast("info", "Не удалось понять структуру файла — укажите колонки вручную"); nav("/more/import", { state: r }); }
  };
  const createNew = async () => {
    const code = prompt("Обозначение изделия (например АБВГ.123456.001):"); if (!code) return;
    const name = prompt("Название изделия:", "Новое изделие") ?? code;
    try { const it = await post<{ id: number }>("/api/items", { code, name, item_type: "product" }); nav(`/specs/${it.id}`); } catch (e) { toast("err", (e as Error).message); }
  };
  return (
    <div className="stack">
      <div className="ph">
        <div><h1>Спецификации</h1><div className="sub">Составы изделий. Загрузите из Excel или соберите вручную — потом из них создаются заказы.</div></div>
        {can("items:write") && <button className="right" onClick={createNew}>＋ Создать вручную</button>}
      </div>
      {can("import:run") && <Dropzone onDone={onImport} />}
      <Help id="specs">Спецификация — «из чего состоит изделие». Её можно править прямо в дереве: добавить строку, изменить количество, переименовать. Изменения сохраняются как новая редакция, а уже созданные заказы остаются на своей.</Help>
      <div className="row"><h2>Изделия</h2><span className="muted">{specs.data?.length ?? "…"}</span>{(specs.data?.length ?? 0) > 6 && <input className="search right" placeholder="Фильтр…" value={q} onChange={(e) => setQ(e.target.value)} />}</div>
      {specs.data && !specs.data.length && <div className="card empty-big"><div style={{ fontSize: 42 }}>🗂️</div><b>Спецификаций пока нет</b><div className="muted">Загрузите Excel выше — первое изделие появится здесь.</div></div>}
      <div className="pgrid">
        {list.map((s) => (
          <Link key={s.id} to={`/specs/${s.id}`} className="pcard">
            <span style={{ fontSize: 34 }}>{TYPE_ICON[s.item_type]}</span>
            <div className="pcard-b">
              <b className="pcard-n">{s.name}</b>
              <div className="muted small"><span className="mono">{s.code}</span>{s.rev && ` · ред. ${s.rev}`}</div>
              <div className="small row" style={{ gap: 6 }}>{s.positions} поз.{s.open_orders > 0 && <Badge tone="blue">{s.open_orders} в работе</Badge>}{s.has_draft && <Badge tone="amber">есть правки</Badge>}<span className="muted">· {dt(s.updated_at)}</span></div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
