// Сборка по заказу: реальная (пошагово, факт в заказ) и виртуальная (3D-плеер).
// Общий список шагов, общие горячие клавиши, закреплённое окно поверх других программ (Document PiP).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, dt, fmt, post, TYPE_ICON, type ItemType } from "../api";
import { Badge, useAuth, useData, useToast } from "../ui";
import Viewer3D from "./Viewer3D";

interface Step { index: number; line_id: number; parent_line_id: number | null; level: number; item: { id: number; code: string; name: string; item_type: ItemType; unit: string }; required: string; is_assembly: boolean; into: string; state: "pending" | "done" | "skipped"; done_at: string | null; done_by: string | null; note: string; model_url: string | null }
interface Data { order: { id: number; number: string; item: { id: number; code: string; name: string }; qty: string; status: string }; steps: Step[]; total: number; done: number; current: number; assembly_model_url: string | null; assembly_model_nodes: number }

type Mode = "real" | "virtual";
const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 3, 4];

declare global { interface Window { documentPictureInPicture?: { requestWindow(o?: { width?: number; height?: number }): Promise<Window> } } }

export const HOTKEYS: [string, string][] = [
  ["Пробел / Enter / Num0", "реальная: шаг сделано · виртуальная: пуск/пауза"],
  ["Backspace / Num .", "отменить последний шаг"], ["S", "пропустить шаг"],
  ["← / →", "предыдущий / следующий шаг (без отметки)"], ["Home / End", "в начало / в конец"],
  ["+ / −", "быстрее / медленнее"], ["R", "направление: сборка ⇄ разборка"], ["P", "пуск / пауза"],
  ["V", "переключить реальная / виртуальная"], ["F", "на весь экран"], ["?", "эта подсказка"],
];

export default function Assembly() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const { can } = useAuth();
  const toast = useToast();
  const d = useData(() => api<Data>(`/api/assembly/orders/${id}/steps`), [id]);
  const [mode, setMode] = useState<Mode>((sp.get("mode") as Mode) || "real");
  const [cursor, setCursor] = useState<number | null>(null); // выбранный шаг (null — текущий по факту)
  const [playing, setPlaying] = useState(false);
  const [speedIx, setSpeedIx] = useState(2);
  const [dir, setDir] = useState<1 | -1>(1);
  const [progress, setProgress] = useState(0); // виртуальный прогресс, 0..total
  const [matched, setMatched] = useState<[number, number] | null>(null);
  const [showKeys, setShowKeys] = useState(false);
  const [pip, setPip] = useState<Window | null>(null);
  const editable = can("kits:write");
  const data = d.data;
  const total = data?.total ?? 0;
  const curIndex = cursor ?? data?.current ?? 0;
  const step = data?.steps[Math.min(curIndex, Math.max(total - 1, 0))];
  const next = data?.steps[curIndex + 1];

  // ---- виртуальный плеер: тикер
  const ref = useRef({ playing, speedIx, dir, progress, total });
  ref.current = { playing, speedIx, dir, progress, total };
  useEffect(() => {
    let raf = 0, last = performance.now();
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      const r = ref.current; const dts = (t - last) / 1000; last = t;
      if (!r.playing) return;
      let p = r.progress + r.dir * dts * SPEEDS[r.speedIx] * 0.8; // ~1.25 с на шаг при 1×
      if (p >= r.total) { p = r.total; setPlaying(false); }
      if (p <= 0) { p = 0; setPlaying(false); }
      setProgress(p);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  useEffect(() => { if (data && mode === "real") setProgress(data.done); }, [data, mode]);
  const virtualIndex = Math.min(Math.floor(progress + 1e-6), Math.max(total - 1, 0));

  // ---- действия
  const act = useCallback(async (action: "done" | "undo" | "skip", lineId?: number) => {
    if (!data || !editable) return;
    let target = lineId;
    if (!target) {
      if (action === "undo") { const last = [...data.steps].reverse().find((s) => s.state !== "pending"); target = last?.line_id; }
      else target = data.steps[curIndex]?.line_id;
    }
    if (!target) return;
    try { await post(`/api/assembly/orders/${id}/steps/${target}`, { action }); setCursor(null); d.reload(); } catch (e) { toast("err", (e as Error).message); }
  }, [data, editable, curIndex, id, d, toast]);

  const move = (delta: number) => { if (mode === "virtual") { setPlaying(false); setProgress((p) => Math.max(0, Math.min(total, Math.round(p) + delta))); } else setCursor(Math.max(0, Math.min(total - 1, curIndex + delta))); };
  const toggleFs = () => { const el = document.documentElement; if (document.fullscreenElement) document.exitFullscreen(); else el.requestFullscreen?.(); };

  const onKey = useCallback((e: KeyboardEvent) => {
    const t = e.target as HTMLElement; if (t && ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
    const k = e.key, c = e.code;
    const prevent = () => e.preventDefault();
    if (k === " " || k === "Enter" || c === "Numpad0" || c === "NumpadEnter") { prevent(); if (mode === "real") act("done"); else setPlaying((p) => !p); }
    else if (k === "Backspace" || c === "NumpadDecimal") { prevent(); act("undo"); }
    else if (k.toLowerCase() === "s" || k.toLowerCase() === "ы") { prevent(); act("skip"); }
    else if (k === "ArrowRight") { prevent(); move(1); }
    else if (k === "ArrowLeft") { prevent(); move(-1); }
    else if (k === "Home") { prevent(); if (mode === "virtual") setProgress(0); else setCursor(0); }
    else if (k === "End") { prevent(); if (mode === "virtual") setProgress(total); else setCursor(total - 1); }
    else if (k === "+" || k === "=" || c === "NumpadAdd") { prevent(); setSpeedIx((i) => Math.min(SPEEDS.length - 1, i + 1)); }
    else if (k === "-" || c === "NumpadSubtract") { prevent(); setSpeedIx((i) => Math.max(0, i - 1)); }
    else if (k.toLowerCase() === "r" || k.toLowerCase() === "к") { prevent(); setDir((x) => (x === 1 ? -1 : 1)); }
    else if (k.toLowerCase() === "p" || k.toLowerCase() === "з") { prevent(); setPlaying((p) => !p); }
    else if (k.toLowerCase() === "v" || k.toLowerCase() === "м") { prevent(); setMode((m) => (m === "real" ? "virtual" : "real")); }
    else if (k.toLowerCase() === "f" || k.toLowerCase() === "а") { prevent(); toggleFs(); }
    else if (k === "?" || k === ",") { prevent(); setShowKeys((v) => !v); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, act, total, curIndex]);
  useEffect(() => { window.addEventListener("keydown", onKey); const w = pip; w?.addEventListener("keydown", onKey); return () => { window.removeEventListener("keydown", onKey); w?.removeEventListener("keydown", onKey); }; }, [onKey, pip]);

  // ---- закреплённое окно (Document Picture-in-Picture)
  const openPip = async () => {
    if (pip && !pip.closed) { pip.focus(); return; }
    if (!window.documentPictureInPicture) {
      // запасной вариант: отдельное маленькое окно браузера (не «поверх всех», но отдельное)
      window.open(`/orders/${id}/assemble?mode=${mode}&mini=1`, "plm-assembly", "width=440,height=620,popup=yes");
      toast("info", "Ваш браузер не умеет окно «поверх всех программ» (нужен Chrome/Edge 116+). Открыто отдельное окно.");
      return;
    }
    const w = await window.documentPictureInPicture.requestWindow({ width: 440, height: 600 });
    // копируем стили приложения в новое окно
    [...document.styleSheets].forEach((ss) => { try { const style = w.document.createElement("style"); style.textContent = [...ss.cssRules].map((r) => r.cssText).join("\n"); w.document.head.appendChild(style); } catch { if (ss.href) { const l = w.document.createElement("link"); l.rel = "stylesheet"; l.href = ss.href; w.document.head.appendChild(l); } } });
    w.document.body.className = "pipbody";
    w.document.title = `Сборка ${data?.order.number ?? ""}`;
    w.addEventListener("pagehide", () => setPip(null));
    setPip(w);
  };
  const mini = sp.get("mini") === "1";

  if (d.error) return <div className="errbox">{d.error} <Link to="/">← к заказам</Link></div>;
  if (!data) return <div className="muted">Загрузка…</div>;

  const Runner = ({ compact }: { compact?: boolean }) => (
    <div className={`runner ${compact ? "compact" : ""}`}>
      <div className="runner-top">
        <div className="seg"><button className={mode === "real" ? "active" : ""} onClick={() => setMode("real")}>🔧 Реальная</button><button className={mode === "virtual" ? "active" : ""} onClick={() => setMode("virtual")}>🎬 Виртуальная</button></div>
        <span className="muted small right">{mode === "real" ? `${data.done} / ${total} шагов` : `${Math.round(progress)} / ${total} · ${SPEEDS[speedIx]}× ${dir === 1 ? "сборка →" : "← разборка"}`}</span>
      </div>
      <div className="progress big"><div style={{ width: `${((mode === "real" ? data.done : progress) / Math.max(total, 1)) * 100}%` }} /></div>
      {mode === "real" ? (
        step ? (
          <div className={`stepcard ${step.state}`}>
            <div className="step-k">Шаг {curIndex + 1} из {total}{cursor !== null && cursor !== data.current && <Badge tone="amber">просмотр</Badge>}{step.state === "done" && <Badge tone="green">сделано</Badge>}{step.state === "skipped" && <Badge tone="gray">пропущен</Badge>}</div>
            <div className="step-t">{TYPE_ICON[step.item.item_type]} {step.item.name}</div>
            <div className="step-c"><span className="mono">{step.item.code}</span> · <b>{fmt(step.required)} {step.item.unit}</b></div>
            <div className="step-into">{step.is_assembly ? "Собрать узел из отмеченных выше составляющих" : <>Установить в: <b>{step.into}</b></>}</div>
            {step.done_at && <div className="small muted">{step.done_by} · {dt(step.done_at)}</div>}
            {step.model_url && !data.assembly_model_url && <Viewer3D url={step.model_url} codes={[step.item.code]} progress={1} highlight={0} className="small" />}
          </div>
        ) : <div className="stepcard done"><div className="step-t">🎉 Все шаги выполнены</div><div className="muted">Заказ укомплектован и собран.</div></div>
      ) : (
        <div className="stepcard virtual">
          {data.steps[virtualIndex] && <>
            <div className="step-k">Шаг {Math.min(virtualIndex + 1, total)} из {total}</div>
            <div className="step-t">{TYPE_ICON[data.steps[virtualIndex].item.item_type]} {data.steps[virtualIndex].item.name}</div>
            <div className="step-c"><span className="mono">{data.steps[virtualIndex].item.code}</span> → {data.steps[virtualIndex].into}</div>
          </>}
          {!data.assembly_model_url && <div className="muted small">Нет 3D-модели изделия — загрузите её в спецификации (STEP/GLB), и детали будут анимироваться. Пока проигрывается последовательность шагов.</div>}
        </div>
      )}
      {next && mode === "real" && <div className="nextcard"><span className="muted">Следующий:</span> {TYPE_ICON[next.item.item_type]} {next.item.name} <span className="mono muted">{next.item.code}</span></div>}
      <div className="ctrl">
        {mode === "real" ? (<>
          <button onClick={() => act("undo")} disabled={!editable || !data.done} title="Backspace">↶ Назад</button>
          <button onClick={() => act("skip")} disabled={!editable || !step || step.state !== "pending"} title="S">Пропустить</button>
          <button className="primary big grow" onClick={() => act("done")} disabled={!editable || !step || step.state !== "pending"} title="Пробел / Enter">✓ Сделано</button>
        </>) : (<>
          <button onClick={() => { setPlaying(false); setProgress(0); }} title="Home">⏮</button>
          <button onClick={() => move(-1)} title="←">⏴</button>
          <button className="primary big" onClick={() => setPlaying((p) => !p)} title="Пробел / P">{playing ? "⏸ Пауза" : "▶ Пуск"}</button>
          <button onClick={() => move(1)} title="→">⏵</button>
          <button onClick={() => { setPlaying(false); setProgress(total); }} title="End">⏭</button>
          <button onClick={() => setDir((x) => (x === 1 ? -1 : 1))} title="R">{dir === 1 ? "⟲ Разборка" : "⟳ Сборка"}</button>
          <span className="seg"><button onClick={() => setSpeedIx((i) => Math.max(0, i - 1))} title="−">−</button><button className="active" style={{ minWidth: 56 }}>{SPEEDS[speedIx]}×</button><button onClick={() => setSpeedIx((i) => Math.min(SPEEDS.length - 1, i + 1))} title="+">+</button></span>
        </>)}
      </div>
      {!compact && <div className="row small muted"><button className="sm ghost" onClick={() => setShowKeys(true)}>⌨ Горячие клавиши (?)</button><button className="sm ghost" onClick={toggleFs}>⛶ На весь экран (F)</button></div>}
    </div>
  );

  const viewer = data.assembly_model_url && (
    <Viewer3D url={data.assembly_model_url} codes={data.steps.map((s) => s.item.code)} progress={mode === "real" ? data.done : progress}
      highlight={mode === "real" ? curIndex : virtualIndex} onMatched={(n, t) => setMatched([n, t])} />
  );

  if (mini) return <div className="pipbody"><Runner compact />{viewer && <div className="v3d-wrap mini">{viewer}</div>}</div>;

  return (
    <div className="stack">
      <div className="row small"><Link to={`/orders/${id}`}>← Заказ {data.order.number}</Link></div>
      <div className="ph">
        <div className="grow"><h1>Сборка: {data.order.item.name} <span className="muted">× {fmt(data.order.qty)}</span></h1>
          <div className="sub"><span className="mono">{data.order.item.code}</span> · {total} шагов · выполнено {data.done}{matched && <> · 3D: сопоставлено {matched[0]} из {matched[1]} позиций</>}</div></div>
        <div className="row">
          <button className="primary" onClick={openPip} title="Окно поверх CAD, Excel и других программ">📌 Закрепить окно поверх</button>
        </div>
      </div>
      <div className="asm">
        <aside className="asm-list">
          {data.steps.map((s) => (
            <div key={s.line_id} className={`asm-step ${s.state} ${s.index === (mode === "real" ? curIndex : virtualIndex) ? "cur" : ""}`} style={{ paddingLeft: 10 + s.level * 14 }}
              onClick={() => { if (mode === "real") setCursor(s.index); else { setPlaying(false); setProgress(s.index); } }}>
              <span className="asm-n">{s.index + 1}</span>
              <span className="asm-i">{s.state === "done" ? "✓" : s.state === "skipped" ? "–" : TYPE_ICON[s.item.item_type]}</span>
              <span className="grow" style={{ minWidth: 0 }}><div className="asm-t">{s.item.name}</div><div className="asm-c">{s.item.code} · {fmt(s.required)} {s.item.unit}</div></span>
              {editable && mode === "real" && s.state !== "pending" && <button className="sm ghost hov" title="Отменить отметку" onClick={(e) => { e.stopPropagation(); act("undo", s.line_id); }}>↶</button>}
              {editable && mode === "real" && s.state === "pending" && <button className="sm ghost hov" title="Отметить сделанным" onClick={(e) => { e.stopPropagation(); act("done", s.line_id); }}>✓</button>}
            </div>
          ))}
        </aside>
        <div className="asm-main">
          {viewer && <div className="v3d-wrap">{viewer}</div>}
          {!pip && <Runner />}
          {pip && <div className="card empty-big"><div style={{ fontSize: 36 }}>📌</div><b>Панель сборки открыта в закреплённом окне</b><div className="muted">Она останется поверх CAD и Excel. Горячие клавиши работают, пока это окно активно.</div><button onClick={() => pip.close()}>Вернуть сюда</button></div>}
        </div>
      </div>
      {pip && createPortal(<PipShell><Runner compact />{viewer && <div className="v3d-wrap mini">{viewer}</div>}</PipShell>, pip.document.body)}
      {showKeys && <div className="modal-bg" onMouseDown={() => setShowKeys(false)}><div className="modal" onMouseDown={(e) => e.stopPropagation()}><header><h3>Горячие клавиши</h3><button className="icon" onClick={() => setShowKeys(false)}>✕</button></header>
        <div className="modal-b"><table className="tbl"><tbody>{HOTKEYS.map(([k, v]) => <tr key={k}><td><span className="kbd">{k}</span></td><td>{v}</td></tr>)}</tbody></table>
          <p className="muted small">Клавиши действуют, когда активно окно системы или закреплённое окно. Чтобы управлять, не покидая CAD: отдельная USB-клавиатура/нумпад или педаль, назначенные на эти клавиши, + закреплённое окно в фокусе; либо AutoHotkey-скрипт из `docs/assembly-hotkeys.ahk`, который пересылает F13–F16 в окно сборки.</p></div></div></div>}
    </div>
  );
}

function PipShell({ children }: { children: ReactNode }) {
  const m = useMemo(() => children, [children]);
  return <div className="pipwrap">{m}</div>;
}
