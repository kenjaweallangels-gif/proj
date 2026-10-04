import { useEffect, useState, type FormEvent } from "react";
import { NavLink, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { get, login, logout, TYPE_ICON, type Item } from "./api";
import { useAuth, useToast } from "./ui";
import Orders from "./pages/Orders";
import Order from "./pages/Order";
import Specs from "./pages/Specs";
import Spec from "./pages/Spec";
import Shortage from "./pages/Shortage";
import More from "./pages/More";
import Dashboard from "./pages/Dashboard";
import Items from "./pages/Items";
import ItemPage from "./pages/ItemPage";
import Ecn from "./pages/Ecn";
import Planning from "./pages/Planning";
import Kits from "./pages/Kits";
import Stock from "./pages/Stock";
import Purchasing from "./pages/Purchasing";
import Analytics from "./pages/Analytics";
import ImportPage from "./pages/Import";
import Admin from "./pages/Admin";
import Chat from "./pages/Chat";

const NAV = [
  { to: "/", label: "Заказы", icon: "📦", perm: "kits:read" },
  { to: "/specs", label: "Спецификации", icon: "🧩", perm: "items:read" },
  { to: "/shortage", label: "Дефицит", icon: "🛒", perm: "kits:read" },
  { to: "/more", label: "Ещё", icon: "⋯", perm: "items:read" },
];

function Login() {
  const { reload } = useAuth();
  const toast = useToast();
  const [l, setL] = useState("");
  const [p, setP] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async (ll: string, pp: string) => {
    setBusy(true);
    try { await login(ll, pp); await reload(); } catch (err) { toast("err", (err as Error).message); } finally { setBusy(false); }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); go(l, p); };
  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <div style={{ fontSize: 44, textAlign: "center" }}>📦</div>
        <h2 style={{ textAlign: "center" }}>Комплектация</h2>
        <p className="muted" style={{ textAlign: "center", margin: 0 }}>Состав изделий, заказы, дефицит</p>
        <label className="field"><span>Логин</span><input value={l} onChange={(e) => setL(e.target.value)} autoFocus autoComplete="username" /></label>
        <label className="field"><span>Пароль</span><input type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" /></label>
        <button className="primary big" disabled={busy} style={{ justifyContent: "center" }}>{busy ? "Вход…" : "Войти"}</button>
        <div className="demo-box">
          <div className="muted small">Посмотреть на демо-данных:</div>
          <div className="row">
            <button type="button" className="sm" onClick={() => go("pdo", "pdo12345")}>Плановик</button>
            <button type="button" className="sm" onClick={() => go("ivanov", "ivanov12345")}>Конструктор</button>
            <button type="button" className="sm" onClick={() => go("omts", "omts12345")}>Снабженец</button>
            <button type="button" className="sm" onClick={() => go("admin", "admin12345")}>Администратор</button>
          </div>
        </div>
      </form>
    </div>
  );
}

function Search() {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Item[]>([]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen(true); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  useEffect(() => {
    if (!open || q.length < 2) { setRes([]); return; }
    const t = setTimeout(() => get<{ items: Item[] }>("/api/items", { q, size: 8 }).then((d) => setRes(d.items)).catch(() => {}), 200);
    return () => clearTimeout(t);
  }, [q, open]);
  const pick = (i: Item) => { nav(`/specs/${i.id}`); setOpen(false); setQ(""); };
  return (
    <>
      <button className="searchbtn" onClick={() => setOpen(true)}>🔍 Найти деталь или изделие <span className="kbd">Ctrl K</span></button>
      {open && (
        <div className="modal-bg" onMouseDown={() => setOpen(false)}>
          <div className="modal palette" onMouseDown={(e) => e.stopPropagation()}>
            <input autoFocus placeholder="Обозначение или название…" value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && res[0]) pick(res[0]); if (e.key === "Escape") setOpen(false); }} />
            <div className="plist">
              {res.map((i) => <div key={i.id} className="pitem" onClick={() => pick(i)}>{TYPE_ICON[i.item_type]} <b className="mono">{i.code}</b> <span>{i.name}</span></div>)}
              {q.length >= 2 && !res.length && <div className="muted" style={{ padding: 12 }}>Ничего не найдено</div>}
              {q.length < 2 && <div className="muted" style={{ padding: 12 }}>Введите хотя бы 2 символа</div>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function App() {
  const { user, can, reload } = useAuth();
  if (!user) return <Login />;
  const first = NAV.find((n) => can(n.perm))?.to ?? "/more";
  return (
    <div className="shell">
      <header className="top">
        <NavLink to="/" className="brand">📦 <span>Комплектация</span></NavLink>
        <nav className="topnav">
          {NAV.filter((n) => can(n.perm)).map((n) => <NavLink key={n.to} to={n.to} end={n.to === "/"} className={({ isActive }) => (isActive ? "active" : "")}>{n.icon} <span>{n.label}</span></NavLink>)}
        </nav>
        <Search />
        <div className="who" title={user.roles.map((r) => r.name).join(", ")}>
          <span className="avatar">{user.full_name.slice(0, 1)}</span>
          <span className="who-n">{user.full_name}</span>
          <button className="sm" onClick={async () => { await logout(); await reload(); }}>Выйти</button>
        </div>
      </header>
      <main className="page">
        <Routes>
          <Route path="/" element={can("kits:read") ? <Orders /> : <Navigate to={first} />} />
          <Route path="/orders/:id" element={<Order />} />
          <Route path="/specs" element={<Specs />} />
          <Route path="/specs/:id" element={<Spec />} />
          <Route path="/shortage" element={<Shortage />} />
          <Route path="/more" element={<More />} />
          <Route path="/more/dashboard" element={<Dashboard />} />
          <Route path="/more/items" element={<Items />} />
          <Route path="/items/:id" element={<ItemPage />} />
          <Route path="/more/changes" element={<Ecn />} />
          <Route path="/more/planning" element={<Planning />} />
          <Route path="/more/kits" element={<Kits />} />
          <Route path="/kits/:id" element={<Kits />} />
          <Route path="/more/stock" element={<Stock />} />
          <Route path="/more/purchasing" element={<Purchasing />} />
          <Route path="/more/analytics" element={<Analytics />} />
          <Route path="/more/import" element={<ImportPage />} />
          <Route path="/more/admin" element={<Admin />} />
          <Route path="*" element={<Navigate to={first} />} />
        </Routes>
      </main>
      {can("ai:use") && <Chat />}
    </div>
  );
}
