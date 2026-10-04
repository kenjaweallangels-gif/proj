import { Link } from "react-router-dom";
import { get, money, fmt } from "../api";
import { Card, ErrorBox, Stat, Table, useData } from "../ui";

interface Dash { items: number; kits_open: number; ecn_in_review: number; po_open: number; po_overdue: number; wo_open: number; wo_late: number; inspections_pending: number; reject_rate: number; stock_value: number; shortage_positions: number; shortage_uncovered: number }
interface Short { item_id: number; code: string; name: string; need: string; stock: string; on_order: string; uncovered: string; kits: string[]; lead_time_days: number }
interface Risk { item_id: number; code: string; name: string; risk: number; reasons: string[]; stock: string; lead_time_days: number }

export default function Dashboard() {
  const dash = useData(() => get<Dash>("/api/analytics/dashboard"));
  const short = useData(() => get<Short[]>("/api/planning/shortage"));
  const risks = useData(() => get<Risk[]>("/api/analytics/risks"));
  const d = dash.data;
  return (
    <>
      {dash.error && <ErrorBox text={dash.error} />}
      {d && (
        <div className="stats">
          <Stat label="Номенклатура" value={d.items} />
          <Stat label="Открытых комплектов" value={d.kits_open} />
          <Stat label="Извещения на согласовании" value={d.ecn_in_review} tone={d.ecn_in_review ? "amber" : ""} />
          <Stat label="Дефицит: позиций / непокрыто" value={`${d.shortage_positions} / ${d.shortage_uncovered}`} tone={d.shortage_uncovered ? "red" : "green"} />
          <Stat label="Заказы поставщикам (просрочено)" value={`${d.po_open} (${d.po_overdue})`} tone={d.po_overdue ? "red" : ""} />
          <Stat label="Наряды (просрочено)" value={`${d.wo_open} (${d.wo_late})`} tone={d.wo_late ? "red" : ""} />
          <Stat label="Ожидают входного контроля" value={d.inspections_pending} tone={d.inspections_pending ? "amber" : ""} />
          <Stat label="Брак на входном контроле" value={`${d.reject_rate.toFixed(1)} %`} tone={d.reject_rate > 3 ? "red" : "green"} />
          <Stat label="Стоимость запасов" value={money(d.stock_value)} />
        </div>
      )}
      <div className="grid g2">
        <Card title="🔴 Дефицит по комплектам" actions={<Link to="/planning">Все →</Link>}>
          <Table rows={(short.data ?? []).slice(0, 8)} empty="Дефицита нет" keyFn={(r) => r.item_id}
            cols={[
              { h: "Позиция", c: (r) => <Link to={`/items/${r.item_id}`}><span className="mono">{r.code}</span><br /><span className="muted small">{r.name}</span></Link> },
              { h: "Нужно", c: (r) => fmt(r.need), align: "r" }, { h: "Есть", c: (r) => fmt(r.stock), align: "r" },
              { h: "В заказах", c: (r) => fmt(r.on_order), align: "r" },
              { h: "Непокрыто", c: (r) => <b style={{ color: Number(r.uncovered) > 0 ? "var(--red)" : "var(--green)" }}>{fmt(r.uncovered)}</b>, align: "r" },
              { h: "Комплекты", c: (r) => <span className="small">{r.kits.join(", ")}</span> },
            ]} />
        </Card>
        <Card title="⚠️ Позиции риска снабжения" actions={<Link to="/analytics">Аналитика →</Link>}>
          <Table rows={(risks.data ?? []).slice(0, 8)} empty="Рисков не выявлено" keyFn={(r) => r.item_id}
            cols={[
              { h: "Позиция", c: (r) => <Link to={`/items/${r.item_id}`}><span className="mono">{r.code}</span><br /><span className="muted small">{r.name}</span></Link> },
              { h: "Риск", c: (r) => <div style={{ minWidth: 80 }}><div className="progress"><div style={{ width: `${r.risk}%`, background: r.risk > 60 ? "var(--red)" : "var(--amber)" }} /></div><span className="small muted">{r.risk}</span></div> },
              { h: "Причины", c: (r) => <span className="small">{r.reasons.join("; ")}</span> },
            ]} />
        </Card>
      </div>
    </>
  );
}
