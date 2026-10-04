import { useState } from "react";
import { Link } from "react-router-dom";
import { api, post } from "../api";
import { Card, Field, Table, useToast } from "../ui";

interface Preview { sheet: string; header_row: number; columns: string[]; mapping: Record<string, string | null>; rows_total: number; sample: Record<string, string>[]; warnings: string[] }
const FIELDS: Record<string, string> = { code: "Обозначение / код", name: "Наименование", parent: "Родитель (куда входит)", level: "Уровень вложенности", qty: "Количество", unit: "Ед. изм.", item_type: "Тип / раздел", material: "Материал", price: "Цена", lead_time: "Срок / цикл", supplier: "Поставщик", note: "Примечание", stock: "Остаток", due_date: "Дата / срок", customer: "Заказчик" };

export default function ImportPage() {
  const toast = useToast();
  const [mode, setMode] = useState<"bom" | "plan" | "stock">("bom");
  const [prev, setPrev] = useState<Preview | null>(null);
  const [token, setToken] = useState("");
  const [rootCode, setRootCode] = useState("");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const upload = async (file: File) => {
    const fd = new FormData(); fd.append("file", file);
    setBusy(true); setResult(null);
    try { const p = await api<Preview>("/api/import/preview", { method: "POST", form: fd }); setToken(p.warnings.find((w) => w.startsWith("token:"))?.slice(6) ?? ""); setPrev({ ...p, warnings: p.warnings.filter((w) => !w.startsWith("token:")) }); }
    catch (e) { toast("err", (e as Error).message); } finally { setBusy(false); }
  };
  const apply = async () => {
    if (!prev) return;
    setBusy(true);
    try { const r = await post<Record<string, unknown>>(`/api/import/apply/${token}`, { mapping: prev.mapping, mode, root_code: rootCode || null, sheet: prev.sheet, header_row: prev.header_row }); setResult(r); toast("ok", "Импорт выполнен"); }
    catch (e) { toast("err", (e as Error).message); } finally { setBusy(false); }
  };
  const needed = mode === "bom" ? ["code", "name", "parent", "level", "qty", "unit", "item_type", "material", "price", "lead_time", "note"] : mode === "plan" ? ["code", "qty", "due_date", "customer"] : ["code", "stock", "qty", "price", "warehouse"];
  return (
    <div className="grid">
      <Card title="📂 Адаптивный импорт из Excel">
        <p className="muted">Система сама найдёт строку шапки и сопоставит колонки по названиям («Код», «Обозначение», «Родитель», «Кол-во», «Раздел»…). Перед применением можно поправить сопоставление. Тип изделия определяется по разделу/обозначению (ГОСТ → крепёж, «СБ» → сборка, «покупные» → ПКИ…).</p>
        <div className="form">
          <Field label="Что импортируем"><select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}><option value="bom">Состав изделия (спецификация)</option><option value="plan">Товарный план</option><option value="stock">Остатки на складе</option></select></Field>
          <Field label="Файл .xlsx"><input type="file" accept=".xlsx,.xlsm" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} /></Field>
          {mode === "bom" && <Field label="Корневое изделие (если в файле нет строки корня)" hint="например АБВГ.000000.001"><input value={rootCode} onChange={(e) => setRootCode(e.target.value)} /></Field>}
        </div>
      </Card>
      {prev && (
        <Card title={`Лист «${prev.sheet}», шапка в строке ${prev.header_row + 1}, строк данных: ${prev.rows_total}`} actions={<button className="primary" disabled={busy || !prev.mapping.code} onClick={apply}>{busy ? "Импорт…" : "✔ Применить импорт"}</button>}>
          {prev.warnings.map((w, i) => <div key={i} className="errbox" style={{ marginBottom: 8 }}>{w}</div>)}
          <h3 style={{ margin: "8px 0" }}>Сопоставление колонок</h3>
          <div className="form">
            {needed.map((f) => <Field key={f} label={FIELDS[f] ?? f}><select value={prev.mapping[f] ?? ""} onChange={(e) => setPrev({ ...prev, mapping: { ...prev.mapping, [f]: e.target.value || null } })}><option value="">— не используется —</option>{prev.columns.map((c) => <option key={c} value={c}>{c}</option>)}</select></Field>)}
          </div>
          <h3 style={{ margin: "14px 0 8px" }}>Первые строки</h3>
          <Table rows={prev.sample} cols={prev.columns.map((c) => ({ h: <span>{c}{Object.entries(prev.mapping).find(([, v]) => v === c) && <><br /><span style={{ color: "var(--accent)" }}>→ {FIELDS[Object.entries(prev.mapping).find(([, v]) => v === c)![0]]}</span></>}</span>, c: (r: Record<string, string>) => <span className="small">{r[c]}</span> }))} />
        </Card>
      )}
      {result && <Card title="Результат">
        <pre className="small">{JSON.stringify(result, null, 2)}</pre>
        <Link to="/items">Перейти к номенклатуре →</Link>
      </Card>}
    </div>
  );
}
