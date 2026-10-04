import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { dt, fmt, get, post, type Item } from "../api";
import { Badge, Card, Field, Modal, Status, Table, useAuth, useData, useToast } from "../ui";
import { ItemPicker } from "./ItemPage";

interface Line { id: number; action: string; qty: string | null; comment: string; target_item: Item; child_item: Item | null; new_child_item: Item | null }
interface Ecn { id: number; number: string; title: string; reason: string; reason_code: string; status: string; urgency: string; wip_disposition: string; created_at: string; implemented_at: string | null; lines: Line[]; approvals: { id: number; role_code: string; decision: string; comment: string; decided_at: string | null; user_id: number | null }[] }
const ACTION: Record<string, string> = { add: "Добавить", remove: "Исключить", set_qty: "Изменить кол-во", replace: "Заменить" };
const REASON: Record<string, string> = { "1": "Улучшение конструкции", "2": "Устранение ошибки КД", "3": "Замена ПКИ / материала", "4": "Технологичность", "5": "Требование заказчика", "6": "Унификация" };
const ROLE: Record<string, string> = { chief_designer: "Гл. конструктор", technologist: "Технолог", pdo: "ПДО", qc: "ОТК", omts: "ОМТС", management: "Руководство" };

export default function Ecn() {
  const { can, user } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState("");
  const list = useData(() => get<Ecn[]>("/api/ecn", { status }), [status]);
  const [open, setOpen] = useState<Ecn | null>(null);
  const [create, setCreate] = useState(false);
  const act = async (id: number, path: string, body?: unknown) => {
    try { const r = await post<Ecn>(`/api/ecn/${id}/${path}`, body); setOpen(r); list.reload(); toast("ok", "Готово"); } catch (e) { toast("err", (e as Error).message); }
  };
  const myRoles = new Set(user?.roles.map((r) => r.code));
  return (
    <>
      <div className="row">
        <div className="tabs" style={{ marginBottom: 0, borderBottom: "none" }}>
          {[["", "Все"], ["draft", "Черновики"], ["review", "На согласовании"], ["approved", "Согласованы"], ["implemented", "Проведены"], ["rejected", "Отклонены"]].map(([k, l]) => <button key={k} className={status === k ? "active" : ""} onClick={() => setStatus(k)}>{l}</button>)}
        </div>
        {can("ecn:create") && <button className="primary right" onClick={() => setCreate(true)}>＋ Извещение</button>}
      </div>
      <Card>
        <Table rows={list.data ?? []} keyFn={(r) => r.id} onRow={setOpen} empty="Извещений нет" cols={[
          { h: "Номер", c: (r) => <span className="mono">{r.number}</span> }, { h: "Тема", c: (r) => r.title },
          { h: "Причина", c: (r) => <span className="small">{REASON[r.reason_code] ?? r.reason_code}</span> },
          { h: "Изменений", c: (r) => r.lines.length, align: "r" },
          { h: "Подписи", c: (r) => <span className="small">{r.approvals.map((a) => <span key={a.id} title={ROLE[a.role_code] ?? a.role_code}>{a.decision === "approved" ? "✅" : a.decision === "rejected" ? "❌" : "⬜"}</span>)}</span> },
          { h: "Статус", c: (r) => <Status s={r.status} /> }, { h: "Создано", c: (r) => <span className="small muted">{dt(r.created_at)}</span> },
        ]} />
      </Card>
      {open && (
        <Modal title={`${open.number} — ${open.title}`} onClose={() => setOpen(null)} wide>
          <div className="row"><Status s={open.status} /><Badge>{REASON[open.reason_code] ?? open.reason_code}</Badge><Badge tone={open.urgency === "urgent" ? "red" : "gray"}>{open.urgency === "urgent" ? "срочно" : "обычное"}</Badge>
            <Badge>задел: {{ use_up: "использовать", rework: "доработать", scrap: "списать" }[open.wip_disposition]}</Badge></div>
          {open.reason && <p className="muted">{open.reason}</p>}
          <h3>Изменения состава</h3>
          <Table rows={open.lines} keyFn={(l) => l.id} cols={[
            { h: "Изделие", c: (l) => <Link to={`/items/${l.target_item.id}`} className="mono">{l.target_item.code}</Link> },
            { h: "Действие", c: (l) => <Badge tone="blue">{ACTION[l.action]}</Badge> },
            { h: "Составляющая", c: (l) => l.child_item ? <><span className="mono">{l.child_item.code}</span> <span className="muted small">{l.child_item.name}</span></> : "—" },
            { h: "→", c: (l) => l.new_child_item ? <span className="mono">{l.new_child_item.code}</span> : "" },
            { h: "Кол-во", c: (l) => l.qty ? fmt(l.qty, 4) : "—", align: "r" }, { h: "Комментарий", c: (l) => <span className="small">{l.comment}</span> },
          ]} />
          <h3>Согласование</h3>
          <Table rows={open.approvals} keyFn={(a) => a.id} cols={[
            { h: "Роль", c: (a) => ROLE[a.role_code] ?? a.role_code }, { h: "Решение", c: (a) => <Status s={a.decision} /> },
            { h: "Комментарий", c: (a) => a.comment }, { h: "Когда", c: (a) => <span className="small muted">{dt(a.decided_at)}</span> },
          ]} />
          <div className="row">
            {open.status === "draft" && can("ecn:create") && <button className="primary" onClick={() => act(open.id, "submit")}>Отправить на согласование</button>}
            {open.status === "review" && can("ecn:approve") && open.approvals.some((a) => a.decision === "pending" && (myRoles.has(a.role_code) || can("*"))) && (<>
              <button className="primary" onClick={() => act(open.id, "decide", { decision: "approved", comment: prompt("Комментарий (необязательно)") ?? "" })}>✅ Согласовать</button>
              <button className="danger" onClick={() => { const c = prompt("Причина отклонения"); if (c !== null) act(open.id, "decide", { decision: "rejected", comment: c }); }}>❌ Отклонить</button>
            </>)}
            {open.status === "approved" && can("ecn:implement") && <button className="primary" onClick={() => confirm("Провести извещение: будут выпущены новые ревизии затронутых изделий?") && act(open.id, "implement")}>🚀 Провести (выпустить ревизии)</button>}
            {(open.status === "rejected" || open.status === "review") && can("ecn:create") && <button onClick={() => act(open.id, "reopen")}>Вернуть в черновик</button>}
            {open.implemented_at && <span className="muted small">Проведено {dt(open.implemented_at)}</span>}
          </div>
        </Modal>
      )}
      {create && <CreateEcn onClose={() => setCreate(false)} onDone={(e) => { setCreate(false); list.reload(); setOpen(e); }} />}
    </>
  );
}

function CreateEcn({ onClose, onDone }: { onClose: () => void; onDone: (e: Ecn) => void }) {
  const toast = useToast();
  const [f, setF] = useState({ title: "", reason: "", reason_code: "1", urgency: "normal", wip_disposition: "use_up" });
  const [roles, setRoles] = useState<string[]>(["chief_designer", "technologist", "pdo"]);
  const [lines, setLines] = useState<{ target: Item | null; action: string; child: Item | null; newChild: Item | null; qty: string; comment: string }[]>([{ target: null, action: "add", child: null, newChild: null, qty: "1", comment: "" }]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const bad = lines.find((l) => !l.target || (l.action !== "add" && !l.child) || (l.action === "add" && !l.child) || (l.action === "replace" && !l.newChild));
    if (bad) return toast("err", "Заполните все строки изменений");
    try {
      const r = await post<Ecn>("/api/ecn", { ...f, approver_roles: roles, lines: lines.map((l) => ({ target_item_id: l.target!.id, action: l.action, child_item_id: l.child?.id ?? null, new_child_item_id: l.newChild?.id ?? null, qty: l.action === "remove" ? null : Number(l.qty), comment: l.comment })) });
      toast("ok", `Создано ${r.number}`); onDone(r);
    } catch (err) { toast("err", (err as Error).message); }
  };
  const upd = (i: number, p: Partial<(typeof lines)[0]>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));
  return (
    <Modal title="Новое извещение об изменении" onClose={onClose} wide>
      <form className="grid" onSubmit={submit}>
        <div className="form">
          <Field label="Тема"><input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label="Код причины (ГОСТ 2.503)"><select value={f.reason_code} onChange={(e) => setF({ ...f, reason_code: e.target.value })}>{Object.entries(REASON).map(([k, v]) => <option key={k} value={k}>{k} — {v}</option>)}</select></Field>
          <Field label="Срочность"><select value={f.urgency} onChange={(e) => setF({ ...f, urgency: e.target.value })}><option value="normal">Обычное</option><option value="urgent">Срочное</option></select></Field>
          <Field label="Задел / НЗП"><select value={f.wip_disposition} onChange={(e) => setF({ ...f, wip_disposition: e.target.value })}><option value="use_up">Использовать</option><option value="rework">Доработать</option><option value="scrap">Списать</option></select></Field>
          <Field label="Обоснование"><textarea rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
          <Field label="Согласующие"><div className="row">{Object.entries(ROLE).map(([k, v]) => <label key={k} className="small"><input type="checkbox" style={{ width: "auto" }} checked={roles.includes(k)} onChange={(e) => setRoles(e.target.checked ? [...roles, k] : roles.filter((r) => r !== k))} /> {v}</label>)}</div></Field>
        </div>
        <h3>Изменения</h3>
        {lines.map((l, i) => (
          <div key={i} className="card" style={{ padding: 10 }}>
            <div className="form">
              <Field label="В составе изделия"><ItemPicker value={l.target} onChange={(v) => upd(i, { target: v })} /></Field>
              <Field label="Действие"><select value={l.action} onChange={(e) => upd(i, { action: e.target.value })}>{Object.entries(ACTION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
              <Field label={l.action === "add" ? "Добавить" : "Составляющая"}><ItemPicker value={l.child} onChange={(v) => upd(i, { child: v })} /></Field>
              {l.action === "replace" && <Field label="Заменить на"><ItemPicker value={l.newChild} onChange={(v) => upd(i, { newChild: v })} /></Field>}
              {l.action !== "remove" && <Field label="Количество"><input type="number" step="0.0001" value={l.qty} onChange={(e) => upd(i, { qty: e.target.value })} /></Field>}
              <Field label="Комментарий"><input value={l.comment} onChange={(e) => upd(i, { comment: e.target.value })} /></Field>
            </div>
            {lines.length > 1 && <button type="button" className="sm danger" style={{ marginTop: 6 }} onClick={() => setLines(lines.filter((_, j) => j !== i))}>Убрать строку</button>}
          </div>
        ))}
        <div className="row"><button type="button" onClick={() => setLines([...lines, { target: null, action: "add", child: null, newChild: null, qty: "1", comment: "" }])}>＋ Строка</button>
          <button className="primary right">Создать извещение</button></div>
      </form>
    </Modal>
  );
}
