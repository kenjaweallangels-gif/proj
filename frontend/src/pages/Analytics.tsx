import { useState } from "react";
import { Link } from "react-router-dom";
import { fmt, get, type Item } from "../api";
import { Badge, Card, Field, Stat, Table, useData } from "../ui";
import { ItemPicker } from "./ItemPage";

interface Forecast { history: number[]; forecast: number[]; avg_weekly: number; sigma: number; safety_stock: number; reorder_point: number; stock: number; weeks_of_cover: number | null; recommendation: string }
interface Sup { partner_id: number; name: string; kind: string; lines: number; on_time_pct: number; avg_delay_days: number; reject_pct: number; score: number }
interface WL { work_center: string; code: string; load_hours: number; capacity_hours: number; utilization_pct: number }
interface Risk { item_id: number; code: string; name: string; stock: string; on_order: string; min_stock: string; lead_time_days: number; risk: number; reasons: string[] }

export default function Analytics() {
  const [item, setItem] = useState<Item | null>(null);
  const fc = useData(() => (item ? get<Forecast>(`/api/analytics/forecast/${item.id}`) : Promise.resolve(null)), [item?.id]);
  const sup = useData(() => get<Sup[]>("/api/analytics/suppliers"));
  const wl = useData(() => get<WL[]>("/api/analytics/workload"));
  const risks = useData(() => get<Risk[]>("/api/analytics/risks"));
  const f = fc.data;
  const max = f ? Math.max(...f.history, ...f.forecast, 1) : 1;
  return (
    <div className="grid">
      <Card title="📈 Прогноз потребления и точка заказа" actions={<span className="muted small">экспоненциальное сглаживание Хольта по выдачам за 12 недель, уровень сервиса 95 %</span>}>
        <Field label="Позиция"><ItemPicker value={item} onChange={setItem} placeholder="Выберите ПКИ, крепёж или материал…" /></Field>
        {f && (<>
          <div className="stats" style={{ margin: "12px 0" }}>
            <Stat label="Средний расход / нед." value={fmt(f.avg_weekly)} /><Stat label="σ (колебания)" value={fmt(f.sigma)} /><Stat label="Страховой запас" value={fmt(f.safety_stock)} />
            <Stat label="Точка заказа" value={fmt(f.reorder_point)} tone="amber" /><Stat label="Остаток" value={fmt(f.stock)} hint={f.weeks_of_cover ? `≈ ${f.weeks_of_cover} нед. покрытия` : ""} />
            <Stat label="Рекомендация" value={f.recommendation} tone={f.recommendation.startsWith("Пора") ? "red" : "green"} />
          </div>
          <div className="spark">{f.history.map((v, i) => <i key={"h" + i} style={{ height: `${(v / max) * 100}%` }} title={`неделя −${f.history.length - i}: ${v}`} />)}{f.forecast.map((v, i) => <i key={"f" + i} className="f" style={{ height: `${(v / max) * 100}%` }} title={`прогноз +${i + 1}: ${v}`} />)}</div>
          <div className="legend"><span><i style={{ background: "var(--accent)" }} />история (нед.)</span><span><i style={{ background: "var(--amber)" }} />прогноз 8 нед.</span></div>
        </>)}
      </Card>
      <div className="grid g2">
        <Card title="🏭 Загрузка рабочих центров (открытые наряды, 8 недель)">
          <Table rows={wl.data ?? []} keyFn={(w) => w.code} cols={[
            { h: "Участок", c: (w) => w.work_center }, { h: "Загрузка, н-ч", c: (w) => fmt(w.load_hours, 1), align: "r" }, { h: "Мощность", c: (w) => fmt(w.capacity_hours, 0), align: "r" },
            { h: "Утилизация", c: (w) => <div style={{ minWidth: 120 }}><div className="progress"><div style={{ width: `${Math.min(w.utilization_pct, 100)}%`, background: w.utilization_pct > 90 ? "var(--red)" : w.utilization_pct > 70 ? "var(--amber)" : "var(--green)" }} /></div><span className="small muted">{w.utilization_pct} %</span></div> },
          ]} />
        </Card>
        <Card title="🤝 Надёжность поставщиков и кооператоров">
          <Table rows={sup.data ?? []} keyFn={(s) => s.partner_id} empty="Пока нет завершённых поставок" cols={[
            { h: "Контрагент", c: (s) => <>{s.name} <Badge>{s.kind}</Badge></> }, { h: "Поставок", c: (s) => s.lines, align: "r" }, { h: "В срок", c: (s) => `${s.on_time_pct} %`, align: "r" },
            { h: "Ср. задержка", c: (s) => `${s.avg_delay_days} дн`, align: "r" }, { h: "Брак", c: (s) => <span style={{ color: s.reject_pct > 2 ? "var(--red)" : undefined }}>{s.reject_pct} %</span>, align: "r" },
            { h: "Индекс", c: (s) => <b style={{ color: s.score > 80 ? "var(--green)" : s.score > 60 ? "var(--amber)" : "var(--red)" }}>{s.score}</b>, align: "r" },
          ]} />
        </Card>
      </div>
      <Card title="⚠️ Позиции риска снабжения (эвристический скоринг)">
        <Table rows={risks.data ?? []} keyFn={(r) => r.item_id} empty="Рисков нет" cols={[
          { h: "Позиция", c: (r) => <Link to={`/items/${r.item_id}`}><span className="mono">{r.code}</span> <span className="muted small">{r.name}</span></Link> },
          { h: "Остаток / мин.", c: (r) => `${fmt(r.stock)} / ${fmt(r.min_stock)}`, align: "r" }, { h: "В заказах", c: (r) => fmt(r.on_order), align: "r" }, { h: "Цикл", c: (r) => `${r.lead_time_days} дн`, align: "r" },
          { h: "Риск", c: (r) => <div style={{ minWidth: 100 }}><div className="progress"><div style={{ width: `${r.risk}%`, background: r.risk > 60 ? "var(--red)" : "var(--amber)" }} /></div></div> }, { h: "Причины", c: (r) => <span className="small">{r.reasons.join("; ")}</span> },
        ]} />
      </Card>
    </div>
  );
}
