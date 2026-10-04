// Небольшая библиотека UI-примитивов: без тяжёлых зависимостей, единый стиль.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, get, type User } from "./api";

// ---- toasts
type Toast = { id: number; kind: "ok" | "err" | "info"; text: string };
const ToastCtx = createContext<(kind: Toast["kind"], text: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setList((l) => [...l, { id, kind, text }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), kind === "err" ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">{list.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}</div>
    </ToastCtx.Provider>
  );
}

// ---- auth
const AuthCtx = createContext<{ user: User | null; reload: () => Promise<void>; can: (...p: string[]) => boolean }>({ user: null, reload: async () => {}, can: () => false });
export const useAuth = () => useContext(AuthCtx);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const reload = useCallback(async () => {
    try { setUser(await get<User>("/api/auth/me")); } catch { setUser(null); } finally { setReady(true); }
  }, []);
  useEffect(() => {
    reload();
    const h = () => setUser(null);
    window.addEventListener("plm:logout", h);
    return () => window.removeEventListener("plm:logout", h);
  }, [reload]);
  const can = useCallback((...p: string[]) => !!user && (user.permissions.includes("*") || p.every((x) => user.permissions.includes(x))), [user]);
  const v = useMemo(() => ({ user, reload, can }), [user, reload, can]);
  if (!ready) return <div className="center muted">Загрузка…</div>;
  return <AuthCtx.Provider value={v}>{children}</AuthCtx.Provider>;
}

// ---- data hook
export function useData<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    loader().then((d) => alive && (setData(d), setError(null))).catch((e: ApiError) => alive && setError(e.message)).finally(() => alive && setLoading(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, loading, reload: () => setTick((t) => t + 1), setData };
}

// ---- primitives
export const Badge = ({ children, tone = "gray" }: { children: ReactNode; tone?: string }) => <span className={`badge ${tone}`}>{children}</span>;
export const Card = ({ title, children, actions, className = "" }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) => (
  <section className={`card ${className}`}>
    {(title || actions) && <header className="card-h"><h3>{title}</h3><div className="row">{actions}</div></header>}
    {children}
  </section>
);
export const Stat = ({ label, value, tone, hint }: { label: string; value: ReactNode; tone?: string; hint?: string }) => (
  <div className={`stat ${tone ?? ""}`}><div className="stat-v">{value}</div><div className="stat-l">{label}</div>{hint && <div className="stat-h">{hint}</div>}</div>
);
export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <div className={`modal ${wide ? "wide" : ""}`} onMouseDown={(e) => e.stopPropagation()}>
        <header><h3>{title}</h3><button className="icon" onClick={onClose} aria-label="Закрыть">✕</button></header>
        <div className="modal-b">{children}</div>
      </div>
    </div>
  );
}
export const Empty = ({ text = "Пока пусто" }: { text?: string }) => <div className="empty">{text}</div>;
export const ErrorBox = ({ text }: { text: string }) => <div className="errbox">⚠️ {text}</div>;

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export function Table<T>({ rows, cols, onRow, empty, keyFn }: { rows: T[]; cols: { h: ReactNode; c: (r: T) => ReactNode; w?: string; align?: "r" | "c" }[]; onRow?: (r: T) => void; empty?: string; keyFn?: (r: T) => string | number }) {
  if (!rows.length) return <Empty text={empty} />;
  return (
    <div className="tbl-wrap"><table className="tbl">
      <thead><tr>{cols.map((c, i) => <th key={i} style={{ width: c.w }} className={c.align}>{c.h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={keyFn ? keyFn(r) : i} className={onRow ? "click" : ""} onClick={() => onRow?.(r)}>{cols.map((c, j) => <td key={j} className={c.align}>{c.c(r)}</td>)}</tr>)}</tbody>
    </table></div>
  );
}

export const STATUS_TONE: Record<string, string> = {
  draft: "gray", review: "amber", approved: "blue", rejected: "red", implemented: "green", released: "green", obsolete: "gray", in_review: "amber",
  planned: "gray", launched: "blue", done: "green", open: "gray", in_work: "amber", assembled: "green", shipped: "blue",
  sent: "blue", confirmed: "blue", partial: "amber", received: "green", closed: "gray", cancelled: "red", pending: "amber", accepted: "green",
  in_progress: "amber", ready: "green", missing: "red",
};
export const STATUS_LABEL: Record<string, string> = {
  draft: "Черновик", review: "На согласовании", approved: "Согласовано", rejected: "Отклонено", implemented: "Проведено", released: "Выпущена",
  obsolete: "Устарела", in_review: "На проверке", planned: "Запланировано", launched: "Запущено", done: "Выполнено", open: "Открыт", in_work: "В работе",
  assembled: "Собран", shipped: "Отгружен", sent: "Отправлен", confirmed: "Подтверждён", partial: "Частично", received: "Получен", closed: "Закрыт",
  cancelled: "Отменён", pending: "Ожидает", accepted: "Принято", in_progress: "В работе", ready: "Готово", missing: "Отсутствует",
};
export const Status = ({ s }: { s: string }) => <Badge tone={STATUS_TONE[s] ?? "gray"}>{STATUS_LABEL[s] ?? s}</Badge>;
