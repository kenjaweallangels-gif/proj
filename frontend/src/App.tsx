import { useState, type FormEvent } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { login, logout } from "./api";
import { useAuth, useToast } from "./ui";
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

const NAV: { to: string; label: string; icon: string; perm?: string; sec?: string }[] = [
  { to: "/", label: "Обзор", icon: "📊", perm: "analytics:read" },
  { to: "/items", label: "Номенклатура и составы", icon: "🧩", perm: "items:read", sec: "Конструкторские данные" },
  { to: "/ecn", label: "Извещения об изменении", icon: "📝", perm: "items:read" },
  { to: "/planning", label: "План и MRP", icon: "🗓️", perm: "plan:read", sec: "Производство" },
  { to: "/kits", label: "Комплекты и наряды", icon: "✅", perm: "kits:read" },
  { to: "/stock", label: "Склад и учёт", icon: "🏬", perm: "stock:read", sec: "Снабжение" },
  { to: "/purchasing", label: "Закупки, кооперация, ОТК", icon: "🚚", perm: "purchase:read" },
  { to: "/analytics", label: "Аналитика и прогнозы", icon: "📈", perm: "analytics:read", sec: "Анализ" },
  { to: "/import", label: "Импорт Excel", icon: "📂", perm: "import:run", sec: "Администрирование" },
  { to: "/admin", label: "Пользователи и роли", icon: "🔐", perm: "admin:users" },
];

function Login() {
  const { reload } = useAuth();
  const toast = useToast();
  const [l, setL] = useState("");
  const [p, setP] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try { await login(l, p); await reload(); } catch (err) { toast("err", (err as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <h2>🏭 ПрофПЛМ</h2>
        <p className="muted small">Управление составом изделий, изменениями КД, планированием и снабжением</p>
        <label className="field"><span>Логин</span><input value={l} onChange={(e) => setL(e.target.value)} autoFocus autoComplete="username" /></label>
        <label className="field"><span>Пароль</span><input type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" /></label>
        <button className="primary" disabled={busy}>{busy ? "Вход…" : "Войти"}</button>
        <p className="muted small">Демо-доступ: <span className="kbd">admin / admin12345</span>, <span className="kbd">pdo / pdo12345</span>, <span className="kbd">otk / otk12345</span></p>
      </form>
    </div>
  );
}

export default function App() {
  const { user, can, reload } = useAuth();
  const loc = useLocation();
  const [menu, setMenu] = useState(false);
  if (!user) return <Login />;
  const first = NAV.find((n) => !n.perm || can(n.perm))?.to ?? "/items";
  return (
    <div className="app">
      <aside className={`side ${menu ? "open" : ""}`} onClick={() => setMenu(false)}>
        <div className="brand">🏭 ПрофПЛМ</div>
        {NAV.filter((n) => !n.perm || can(n.perm)).map((n) => (
          <div key={n.to}>
            {n.sec && <div className="sec">{n.sec}</div>}
            <NavLink to={n.to} end={n.to === "/"} className={({ isActive }) => (isActive ? "active" : "")}><span>{n.icon}</span>{n.label}</NavLink>
          </div>
        ))}
        <div className="user">
          <b>{user.full_name}</b><br />
          <span className="muted">{user.roles.map((r) => r.name).join(", ")} · допуск {user.clearance}</span><br />
          <button className="sm" style={{ marginTop: 6 }} onClick={async () => { await logout(); await reload(); }}>Выйти</button>
        </div>
      </aside>
      <div className="main">
        <div className="topbar">
          <button className="icon burger" onClick={() => setMenu(true)} aria-label="Меню">☰</button>
          <h1 style={{ fontSize: 17 }}>{NAV.find((n) => (n.to === "/" ? loc.pathname === "/" : loc.pathname.startsWith(n.to)))?.label ?? "ПрофПЛМ"}</h1>
          <span className="right muted small">{user.department}</span>
        </div>
        <div className="content">
          <Routes>
            <Route path="/" element={can("analytics:read") ? <Dashboard /> : <Navigate to={first} />} />
            <Route path="/items" element={<Items />} />
            <Route path="/items/:id" element={<ItemPage />} />
            <Route path="/ecn" element={<Ecn />} />
            <Route path="/planning" element={<Planning />} />
            <Route path="/kits" element={<Kits />} />
            <Route path="/kits/:id" element={<Kits />} />
            <Route path="/stock" element={<Stock />} />
            <Route path="/purchasing" element={<Purchasing />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/import" element={<ImportPage />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="*" element={<Navigate to={first} />} />
          </Routes>
        </div>
      </div>
      {can("ai:use") && <Chat />}
    </div>
  );
}
