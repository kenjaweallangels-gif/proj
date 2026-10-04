import { Link } from "react-router-dom";
import { useAuth } from "../ui";

const ITEMS = [
  { to: "/more/dashboard", ic: "📊", t: "Сводка для руководства", d: "Показатели, просрочки, риски снабжения", perm: "analytics:read" },
  { to: "/more/items", ic: "🗃️", t: "Вся номенклатура", d: "Таблица всех позиций: детали, покупные, материалы, оснастка", perm: "items:read" },
  { to: "/more/changes", ic: "📝", t: "Изменения спецификаций", d: "Извещения об изменении с согласованием по ролям", perm: "items:read" },
  { to: "/more/planning", ic: "🗓️", t: "Товарный план и расчёт потребности", d: "План выпуска, что изготовить/закупить и когда запускать", perm: "plan:read" },
  { to: "/more/kits", ic: "🔧", t: "Производственные задания", d: "Наряды на изготовление и сборку, комплекты со складской выдачей", perm: "wo:read" },
  { to: "/more/purchasing", ic: "🚚", t: "Закупки, кооперация, входной контроль", d: "Заказы поставщикам, приёмка, решения ОТК, контрагенты", perm: "purchase:read" },
  { to: "/more/stock", ic: "🏬", t: "Склад и бухгалтерия", d: "Остатки, движения, проводки, оборотно-сальдовая ведомость", perm: "stock:read" },
  { to: "/more/analytics", ic: "📈", t: "Аналитика и прогнозы", d: "Прогноз расхода, точка заказа, надёжность поставщиков, загрузка участков", perm: "analytics:read" },
  { to: "/more/import", ic: "📂", t: "Импорт Excel с настройкой колонок", d: "Если файл не распознался автоматически; также план и остатки", perm: "import:run" },
  { to: "/more/admin", ic: "🔐", t: "Пользователи, роли, интеграции", d: "Доступы, журнал действий, подключение 1С, настройки ИИ", perm: "admin:users" },
];

export default function More() {
  const { can, user } = useAuth();
  return (
    <div className="stack">
      <div className="ph"><div><h1>Ещё</h1><div className="sub">Разделы для специалистов: снабжение, склад, бухгалтерия, аналитика, администрирование.</div></div></div>
      <div className="more-grid">
        {ITEMS.filter((i) => can(i.perm)).map((i) => <Link key={i.to} to={i.to} className="more-i"><span className="ic">{i.ic}</span><div><b>{i.t}</b><span>{i.d}</span></div></Link>)}
      </div>
      <div className="muted small">Вы вошли как <b>{user?.full_name}</b> ({user?.roles.map((r) => r.name).join(", ")}). Если какого-то раздела нет — у вашей роли нет на него прав; обратитесь к администратору.</div>
    </div>
  );
}
