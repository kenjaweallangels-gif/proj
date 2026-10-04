import { useState, type FormEvent } from "react";
import { dt, get, post, put, type User } from "../api";
import { Badge, Card, Field, Modal, Table, useData, useToast } from "../ui";

interface Role { id: number; code: string; name: string; description: string; permissions: string[] }
interface Audit { id: number; ts: string; user: string; action: string; entity: string; entity_id: string; details: Record<string, unknown>; source: string }
interface Conn { id: number; name: string; kind: string; enabled: boolean; last_sync_at: string | null; last_status: string; config: Record<string, unknown> }

export default function Admin() {
  const toast = useToast();
  const [tab, setTab] = useState<"users" | "roles" | "audit" | "integr" | "ai">("users");
  const users = useData(() => get<User[]>("/api/admin/users"));
  const roles = useData(() => get<Role[]>("/api/admin/roles"));
  const perms = useData(() => get<Record<string, string>>("/api/admin/permissions"));
  const audit = useData(() => get<Audit[]>("/api/admin/audit"), [tab]);
  const conns = useData(() => get<Conn[]>("/api/integrations").catch(() => []));
  const ai = useData(() => get<{ local: boolean; local_model: string | null; cloud: boolean; cloud_model: string }>("/api/ai/status").catch(() => null));
  const [edit, setEdit] = useState<Partial<User> & { password?: string; role_codes?: string[] } | null>(null);
  const [editRole, setEditRole] = useState<Role | null>(null);
  const saveUser = async (e: FormEvent) => {
    e.preventDefault();
    if (!edit) return;
    const body = { login: edit.login, full_name: edit.full_name, email: edit.email ?? "", department: edit.department ?? "", clearance: edit.clearance ?? 1, is_active: edit.is_active ?? true, password: edit.password || null, role_codes: edit.role_codes ?? [] };
    try { edit.id ? await put(`/api/admin/users/${edit.id}`, body) : await post("/api/admin/users", body); toast("ok", "Сохранено"); setEdit(null); users.reload(); } catch (err) { toast("err", (err as Error).message); }
  };
  const saveRole = async (e: FormEvent) => {
    e.preventDefault();
    if (!editRole) return;
    try { editRole.id ? await put(`/api/admin/roles/${editRole.id}`, editRole) : await post("/api/admin/roles", editRole); toast("ok", "Сохранено"); setEditRole(null); roles.reload(); } catch (err) { toast("err", (err as Error).message); }
  };
  return (
    <>
      <div className="tabs">{([["users", "Пользователи"], ["roles", "Роли и права"], ["audit", "Журнал аудита"], ["integr", "Интеграции (1С, БД)"], ["ai", "ИИ-ассистент"]] as const).map(([k, l]) => <button key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === "users" && <Card actions={<button className="primary sm" onClick={() => setEdit({ clearance: 1, is_active: true, role_codes: [] })}>＋ Пользователь</button>}>
        <Table rows={users.data ?? []} keyFn={(u) => u.id} onRow={(u) => setEdit({ ...u, role_codes: u.roles.map((r) => r.code) })} cols={[
          { h: "Логин", c: (u) => <span className="mono">{u.login}</span> }, { h: "ФИО", c: (u) => u.full_name }, { h: "Подразделение", c: (u) => u.department },
          { h: "Роли", c: (u) => u.roles.map((r) => <Badge key={r.code} tone="blue">{r.name}</Badge>) }, { h: "Допуск", c: (u) => u.clearance, align: "c" }, { h: "Активен", c: (u) => u.is_active ? "✓" : <Badge tone="red">нет</Badge>, align: "c" },
        ]} />
      </Card>}
      {tab === "roles" && <Card actions={<button className="primary sm" onClick={() => setEditRole({ id: 0, code: "", name: "", description: "", permissions: [] })}>＋ Роль</button>}>
        <Table rows={roles.data ?? []} keyFn={(r) => r.id} onRow={setEditRole} cols={[
          { h: "Код", c: (r) => <span className="mono">{r.code}</span> }, { h: "Название", c: (r) => r.name }, { h: "Права", c: (r) => <span className="small">{r.permissions.includes("*") ? <Badge tone="red">все права</Badge> : r.permissions.join(", ")}</span> },
        ]} />
      </Card>}
      {tab === "audit" && <Card title="Кто, что, когда (последние 200)">
        <Table rows={audit.data ?? []} keyFn={(a) => a.id} cols={[
          { h: "Когда", c: (a) => <span className="small">{dt(a.ts)}</span> }, { h: "Кто", c: (a) => a.user }, { h: "Действие", c: (a) => <Badge>{a.action}</Badge> }, { h: "Объект", c: (a) => <>{a.entity} <span className="mono small">{a.entity_id}</span></> },
          { h: "Источник", c: (a) => <Badge tone={a.source === "ai" ? "amber" : "gray"}>{a.source}</Badge> }, { h: "Детали", c: (a) => <span className="small muted mono">{JSON.stringify(a.details).slice(0, 120)}</span> },
        ]} />
      </Card>}
      {tab === "integr" && <Card title="Коннекторы к внешним системам" actions={<button className="sm" onClick={async () => {
        const kind = prompt("Тип: onec_odata (1С через OData) / sql (любая БД) / rest", "onec_odata"); if (!kind) return;
        const name = prompt("Название:", "1С:ERP") ?? kind;
        const cfg = prompt("Конфигурация JSON (пароли — только через *_env):", kind === "onec_odata" ? '{"url":"http://1c-server/erp/odata/standard.odata","user":"plm","password_env":"ONEC_PASSWORD"}' : kind === "sql" ? '{"url_env":"ERP_DB_URL","items_sql":"select sku as code, title as name, price from items"}' : '{"items_url":"https://api/items","token_env":"API_TOKEN","path":"data","fields":{"code":"sku","name":"title"}}');
        if (!cfg) return;
        try { await post("/api/integrations", undefined, { name, kind }).catch(() => post(`/api/integrations?name=${encodeURIComponent(name)}&kind=${kind}`, JSON.parse(cfg))); conns.reload(); } catch (e) { toast("err", (e as Error).message); }
      }}>＋ Коннектор</button>}>
        <p className="muted small">1С:ERP / УПП / КА подключаются через стандартный OData (`/odata/standard.odata`): синхронизация номенклатуры, контрагентов, остатков; проводки выгружаются в 1С через «Экспорт проводок». Секреты хранятся только в переменных окружения сервера.</p>
        <Table rows={conns.data ?? []} keyFn={(c) => c.id} empty="Коннекторов нет" cols={[
          { h: "Название", c: (c) => c.name }, { h: "Тип", c: (c) => <Badge tone="blue">{c.kind}</Badge> }, { h: "Последняя синхронизация", c: (c) => <span className="small">{dt(c.last_sync_at)} {c.last_status}</span> },
          { h: "", c: (c) => <div className="row"><button className="sm" onClick={async () => { const r = await post<{ ok: boolean; error?: string }>(`/api/integrations/${c.id}/test`); toast(r.ok ? "ok" : "err", r.ok ? "Соединение успешно" : `Нет связи: ${r.error}`); }}>Проверить</button>
            <button className="sm primary" onClick={async () => { try { const r = await post<Record<string, number>>(`/api/integrations/${c.id}/sync`); toast("ok", `Синхронизировано: ${JSON.stringify(r)}`); conns.reload(); } catch (e) { toast("err", (e as Error).message); } }}>Синхронизировать</button></div> },
        ]} />
        <div className="row" style={{ marginTop: 10 }}><button className="sm" onClick={async () => { const r = await get<{ count: number }>("/api/integrations/export/journal"); toast("ok", `Выгружено проводок: ${r.count}`); }}>📤 Экспорт проводок для 1С</button></div>
      </Card>}
      {tab === "ai" && <Card title="Конфигурация ИИ-ассистента">
        <p>Маршрутизация запросов: <b>правила</b> (всегда) → <b>локальная LLM</b> (конфиденциальные данные, не покидают сеть) → <b>облачная модель</b> (только по явному разрешению пользователя с правом <span className="kbd">ai:cloud</span>, для изделий с конфиденциальностью ≤ 1).</p>
        <div className="stats">
          <div className="stat"><div className="stat-v">{ai.data?.local ? "✅" : "⬜"}</div><div className="stat-l">Локальная модель</div><div className="stat-h">{ai.data?.local_model ?? "PLM_LOCAL_LLM_ENABLED=true, PLM_LOCAL_LLM_URL (Ollama/vLLM)"}</div></div>
          <div className="stat"><div className="stat-v">{ai.data?.cloud ? "✅" : "⬜"}</div><div className="stat-l">Облачная модель</div><div className="stat-h">{ai.data?.cloud_model ?? ""} · PLM_CLOUD_LLM_ENABLED, PLM_ANTHROPIC_API_KEY</div></div>
        </div>
        <p className="muted small">Все действия ИИ, изменяющие данные, требуют подтверждения пользователя и записываются в журнал аудита с источником «ai».</p>
      </Card>}
      {edit && <Modal title={edit.id ? `Пользователь ${edit.login}` : "Новый пользователь"} onClose={() => setEdit(null)}>
        <form className="form" onSubmit={saveUser}>
          <Field label="Логин"><input required disabled={!!edit.id} value={edit.login ?? ""} onChange={(e) => setEdit({ ...edit, login: e.target.value })} /></Field>
          <Field label="ФИО"><input required value={edit.full_name ?? ""} onChange={(e) => setEdit({ ...edit, full_name: e.target.value })} /></Field>
          <Field label="Подразделение"><input value={edit.department ?? ""} onChange={(e) => setEdit({ ...edit, department: e.target.value })} /></Field>
          <Field label="E-mail"><input value={edit.email ?? ""} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
          <Field label={edit.id ? "Новый пароль (пусто — не менять)" : "Пароль"}><input type="password" value={edit.password ?? ""} onChange={(e) => setEdit({ ...edit, password: e.target.value })} /></Field>
          <Field label="Допуск к данным (0–3)"><input type="number" min={0} max={3} value={edit.clearance ?? 1} onChange={(e) => setEdit({ ...edit, clearance: +e.target.value })} /></Field>
          <Field label="Роли"><div className="row">{(roles.data ?? []).map((r) => <label key={r.code} className="small"><input type="checkbox" style={{ width: "auto" }} checked={edit.role_codes?.includes(r.code)} onChange={(e) => setEdit({ ...edit, role_codes: e.target.checked ? [...(edit.role_codes ?? []), r.code] : edit.role_codes?.filter((c) => c !== r.code) })} /> {r.name}</label>)}</div></Field>
          <Field label="Активен"><input type="checkbox" style={{ width: "auto" }} checked={edit.is_active ?? true} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} /></Field>
          <div className="full row"><button className="primary">Сохранить</button><button type="button" onClick={() => setEdit(null)}>Отмена</button></div>
        </form>
      </Modal>}
      {editRole && <Modal title={editRole.id ? `Роль ${editRole.name}` : "Новая роль"} onClose={() => setEditRole(null)} wide>
        <form className="grid" onSubmit={saveRole}>
          <div className="form"><Field label="Код"><input required disabled={!!editRole.id} value={editRole.code} onChange={(e) => setEditRole({ ...editRole, code: e.target.value })} /></Field><Field label="Название"><input required value={editRole.name} onChange={(e) => setEditRole({ ...editRole, name: e.target.value })} /></Field></div>
          <div className="form">{Object.entries(perms.data ?? {}).map(([k, v]) => <label key={k} className="small"><input type="checkbox" style={{ width: "auto" }} checked={editRole.permissions.includes(k) || editRole.permissions.includes("*")} disabled={editRole.permissions.includes("*")} onChange={(e) => setEditRole({ ...editRole, permissions: e.target.checked ? [...editRole.permissions, k] : editRole.permissions.filter((p) => p !== k) })} /> <span className="mono">{k}</span><br /><span className="muted">{v}</span></label>)}</div>
          <div className="row"><button className="primary">Сохранить</button><button type="button" onClick={() => setEditRole(null)}>Отмена</button></div>
        </form>
      </Modal>}
    </>
  );
}
