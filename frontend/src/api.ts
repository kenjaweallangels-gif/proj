// Тонкий клиент API: JWT в localStorage, авто-refresh, единая обработка ошибок.
const BASE = import.meta.env.VITE_API_URL ?? "";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const store = {
  get access() { return localStorage.getItem("plm.access"); },
  get refresh() { return localStorage.getItem("plm.refresh"); },
  set(a: string | null, r: string | null) {
    a ? localStorage.setItem("plm.access", a) : localStorage.removeItem("plm.access");
    r ? localStorage.setItem("plm.refresh", r) : localStorage.removeItem("plm.refresh");
  },
};

let refreshing: Promise<boolean> | null = null;
async function tryRefresh(): Promise<boolean> {
  if (!store.refresh) return false;
  refreshing ??= fetch(`${BASE}/api/auth/refresh?refresh_token=${encodeURIComponent(store.refresh)}`, { method: "POST" })
    .then(async (r) => {
      if (!r.ok) return false;
      const d = await r.json();
      store.set(d.access_token, d.refresh_token);
      return true;
    })
    .catch(() => false)
    .finally(() => { refreshing = null; });
  return refreshing;
}

export async function api<T = unknown>(path: string, opts: RequestInit & { params?: Record<string, unknown>; form?: FormData } = {}): Promise<T> {
  const { params, form, ...init } = opts;
  const qs = params ? "?" + Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&") : "";
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (store.access) headers.Authorization = `Bearer ${store.access}`;
  if (init.body && !form) headers["Content-Type"] = "application/json";
  const doFetch = () => fetch(`${BASE}${path}${qs}`, { ...init, headers, body: form ?? init.body });
  let r = await doFetch();
  if (r.status === 401 && path !== "/api/auth/login" && (await tryRefresh())) {
    headers.Authorization = `Bearer ${store.access}`;
    r = await doFetch();
  }
  if (r.status === 401 && path !== "/api/auth/login") {
    store.set(null, null);
    window.dispatchEvent(new Event("plm:logout"));
  }
  if (!r.ok) {
    let msg = r.statusText;
    try { const d = await r.json(); msg = typeof d.detail === "string" ? d.detail : JSON.stringify(d.detail ?? d); } catch { /* empty */ }
    throw new ApiError(r.status, msg);
  }
  return r.status === 204 ? (undefined as T) : r.json();
}

export const get = <T,>(path: string, params?: Record<string, unknown>) => api<T>(path, { params });
export const post = <T,>(path: string, body?: unknown, params?: Record<string, unknown>) => api<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body), params });
export const patch = <T,>(path: string, body: unknown) => api<T>(path, { method: "PATCH", body: JSON.stringify(body) });
export const put = <T,>(path: string, body: unknown) => api<T>(path, { method: "PUT", body: JSON.stringify(body) });
export const del = <T,>(path: string) => api<T>(path, { method: "DELETE" });

export async function login(loginName: string, password: string) {
  const d = await post<{ access_token: string; refresh_token: string }>("/api/auth/login", { login: loginName, password });
  store.set(d.access_token, d.refresh_token);
}
export async function logout() {
  try { await post("/api/auth/logout"); } catch { /* empty */ }
  store.set(null, null);
}
export const hasToken = () => !!store.access;

// ---- типы (подмножество)
export type ItemType = "assembly" | "part" | "purchased" | "outsourced" | "outsourced_op" | "fastener" | "material" | "tooling" | "product";
export interface Item {
  id: number; code: string; name: string; item_type: ItemType; outsource_kind: string | null; unit: string; material: string;
  lifecycle: string; confidentiality: number; lead_time_days: number; min_stock: string; lot_size: string; std_cost: string;
  default_supplier_id: number | null; current_rev: string | null; stock_qty: string | null; description: string; attrs: Record<string, unknown>;
}
export interface TreeNode {
  item_id: number; code: string; name: string; item_type: ItemType; outsource_kind: string | null; rev: string | null; unit: string;
  qty_per: string; total_qty: string; level: number; stock_qty: string; on_order: string; shortage: string;
  status: "ready" | "partial" | "missing"; children: TreeNode[];
}
export interface User { id: number; login: string; full_name: string; department: string; clearance: number; roles: { code: string; name: string }[]; permissions: string[]; is_active: boolean; email: string }

export const TYPE_LABEL: Record<ItemType, string> = {
  product: "Изделие", assembly: "Сборочная единица", part: "Деталь", purchased: "ПКИ", outsourced: "Кооперация (изготовление)",
  outsourced_op: "Операция на стороне", fastener: "Крепёж / стандартные", material: "Материал", tooling: "Оснастка",
};
export const TYPE_ICON: Record<ItemType, string> = {
  product: "🏭", assembly: "🧩", part: "⚙️", purchased: "📦", outsourced: "🤝", outsourced_op: "🧪", fastener: "🔩", material: "🧱", tooling: "🛠️",
};
export const fmt = (v: string | number | null | undefined, d = 2) => v === null || v === undefined ? "—" : Number(v).toLocaleString("ru-RU", { maximumFractionDigits: d });
export const money = (v: string | number | null | undefined) => v === null || v === undefined ? "—" : Number(v).toLocaleString("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 });
export const dt = (v: string | null | undefined) => v ? new Date(v).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }) : "—";
export const d = (v: string | null | undefined) => v ? new Date(v).toLocaleDateString("ru-RU") : "—";
