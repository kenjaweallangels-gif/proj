// Окно «Система» в очках: закреплено на экране (в плоскости дисплея, за головой не отстаёт), скрывается.
// Два вида: компактный — текущий переход в углу поля зрения; полный — по центру дисплея, с вкладками:
//   Алгоритм — переходы выбранного алгоритма (у текущего места — живой ход работы), кнопки управления;
//   Каталог  — алгоритмы изготовления и сборки (процесс + КД из нескольких листов + дерево сборки);
//   КД       — документы алгоритма и листы, предпросмотр, открыть крупно;
//   Дерево   — дерево сборки изделия (раскрытие узлов, переход к КД узла);
//   Управление — быстрые действия системы.
// Управление окном: указатель со смартфона (сенсорная панель на планшете/телефоне #tablet: ведение пальцем —
// курсор, касание — нажатие), мышь/взгляд, голос («сборка каталог», «сборка дерево», «сборка открой алгоритм
// кронштейн» …), жест «нажатие» пальцами (на очках с камерой рук; в демо недоступно — только подсказка).
import { treeRows } from './algorithms.js';
import { docByCode } from './catalog.js';
import { drawDoc, docFormat, fitView } from './kd_draw.js';
import { STEPS } from './process.js';
import { C, Panel } from './ui3d.js';

const TABS = [['algo', 'Алгоритм'], ['cat', 'Каталог'], ['kd', 'КД'], ['tree', 'Дерево'], ['ctl', 'Управление']];
const KIND_RU = { prep: 'подготовка', install: 'установка', glue: 'склеивание', fasten: 'крепёж', check: 'контроль', inspect: 'осмотр', wait: 'выдержка', paint: 'окраска', film: 'плёнка', wire: 'монтаж' };
const fmtMin = (m) => `${Math.floor(m / 60)}:${String(Math.floor(m % 60)).padStart(2, '0')}`;

/** Быстрые действия вкладки «Управление»: [надпись, команда, аргумент]. */
export const QUICK = [
  ['◂ Назад', 'prev'], ['Выполнено ▸', 'next'], ['🔁 Повторить', 'repeat'],
  ['📷 Фото в журнал', 'photo'], ['▶ Имитация', 'auto_toggle'], ['🧩 Виртуальная сборка', 'player'], ['🎓 Обучение', 'training'],
  ['👁 Режим зрения', 'field'], ['🧍 Вид от 3-го лица', 'tp'], ['🎯 Окна по центру', 'recenter'],
  ['📄 Окно КД', 'toggle', 'kd'], ['📋 Задание и чат', 'toggle', 'task'], ['🗂 Система ТП/КД', 'toggle', 'system'],
  ['☀ Ярче', 'bright_up'], ['☾ Тусклее', 'bright_down'], ['◐ Затемнение авто', 'dim_auto'],
  ['📞 Вызвать мастера', 'call'], ['📍 Участки', 'places'], ['⏸ Пауза имитации', 'auto_pause'],
];

export function systemWindow(mgr, app) {
  const p = mgr.add(new Panel(mgr, {
    id: 'algo', title: 'Система', w: 1.2, h: 0.8, ppm: 1400, chrome: false,
    onWheel(dy, pt, panel) { scroll(panel, Math.sign(dy)); },
    draw(ui, panel) {
      ui.k = panel.state.view === 'full' ? 1.6 : 1;                  // полный вид — крупнее (логически 1050 × 700)
      const W = panel.px / ui.k, H = panel.py / ui.k;
      if (panel.state.view !== 'full') compact(ui, panel, W, H);
      else full(ui, panel, W, H);
      cursor(ui, panel);
    },
  }));
  Object.assign(p.state, { view: 'compact', tab: 'algo', sel: null, pick: null, scroll: {}, treeOpen: new Set(['0']), kd: { i: 0, sheet: 1 }, cur: null, phone: false });
  p.animated = true;
  p.mode = 'corner';
  p.visible = false;
  p.mat.depthTest = false;
  p.mesh.renderOrder = 40;

  // ---------- общие данные ----------
  const catalog = () => app.catalog || [];
  const selected = () => catalog().find((a) => a.id === (p.state.sel || app.activeAlgId?.())) || catalog()[0];
  const isLive = (a) => a && a.id === app.activeAlgId?.();
  function scroll(panel, d) { const t = panel.state.tab; panel.state.scroll[t] = Math.max(0, (panel.state.scroll[t] || 0) + d * 2); panel.dirty = true; }
  const go = (cmd, arg) => app.act?.(cmd, arg, 'окно');

  /** Живое состояние: индекс текущего перехода и выполненные. */
  function live(a) {
    if (a.id === 'km2') {
      const run = app.run;
      return { index: run.index, done: (k) => k < run.index || run.done.has(STEPS[k].id), step: run.step, need: run.needs(), timer: run.blockingTimer() || run.activeTimers()[0], run };
    }
    const st = app.stationOf?.(a.place);
    if (!st) return null;
    const s = st.steps[Math.min(st.index, st.steps.length - 1)];
    return { index: st.index, done: (k) => k < st.index, step: s, need: s?.check && !(s.id in st.values) ? 'value' : null, timer: null, st };
  }

  // ---------- компактный вид: текущий переход, крупно ----------
  function compact(ui, panel, W, H) {
    const a = selected(), L = a && isLive(a) ? live(a) : null;
    const si = app.stationInfo?.();
    const s = si ? si.step : app.run.step;
    const idx = si ? si.index + 1 : STEPS.indexOf(s) + 1, total = si ? si.total : STEPS.length;
    ui.rect(4, 4, W - 8, H - 8, { fill: 'rgba(30,110,140,0.035)', stroke: 'rgba(88,230,255,0.55)', r: 30, lw: 4 });
    const ai = app.autoInfo?.();
    ui.text(`${s.id} · ${KIND_RU[s.kind] || s.kind || ''}`, 40, 100, { size: 76, color: s.critical ? C.warn : C.acc, max: W - 420 });
    ui.text(`${idx}/${total}${ai ? (ai.includes('пауза') ? ' ⏸' : ' ▶') : ''}`, W - 40, 100, { size: 66, color: ai ? C.warn : C.dim, align: 'right' });
    let y = 140;
    y += ui.wrap(s.title, 40, y + 86, W - 80, { size: 90, color: '#ffffff', lh: 1.1, maxLines: 2 }) + 14;
    if (s.text?.[0]) ui.wrap(s.text[0], 40, y + 66, W - 80, { size: 66, lh: 1.16, maxLines: Math.max(1, Math.floor((H - 260 - y) / 78)) });
    const tm = si ? null : L?.timer;
    const need = si ? (s.check && !(s.id in si.st.values) ? 'value' : null) : app.run.needs();
    const sim = app.simInfo?.();
    const msg = sim ? `${sim.paused ? '⏸' : '▶'} ${ai || 'Имитация'}` : need === 'timer' ? 'Идёт выдержка' : need === 'value' ? `Замер: ${s.check.name}` : need === 'photo' ? 'Нужно фото' : 'Можно дальше ▸';
    ui.text(msg, 40, H - 150, { size: sim ? 54 : 66, color: sim ? C.warn : need ? C.warn : C.ok, max: tm ? W - 460 : W - 80 });
    if (sim) ui.text('Пробел — пауза · [ ] — скорость · − — назад · , . — шаг · Shift+I — стоп', 40, H - 214, { size: 38, color: C.dim, max: W - 80 });
    if (tm) ui.text(`⏱ ${fmtMin(app.run.remaining(tm))}`, W - 40, H - 150, { size: 72, color: C.warn, align: 'right', mono: true });
    // кнопки: управлять можно указателем смартфона, мышью, голосом
    const bw = (W - 80 - 3 * 24) / 4, by = H - 110;
    if (sim) {                                                       // идёт имитация: пауза/продолжить и стоп
      ui.button(40, by, bw, 84, sim.paused ? '▶ Продолжить' : '⏸ Пауза', () => go(sim.paused ? 'auto_start' : 'auto_pause'), { size: 44, active: sim.paused });
      ui.button(40 + (bw + 24), by, bw, 84, '⏹ Стоп имитации', () => go('auto_stop'), { size: 40, color: C.bad });
    } else {
      ui.button(40, by, bw, 84, '◂ Назад', () => go('prev'), { size: 44 });
      ui.button(40 + (bw + 24), by, bw, 84, 'Выполнено ▸', () => go('next'), { size: 44, active: true });
    }
    ui.button(40 + (bw + 24) * 2, by, bw, 84, '⛶ Окно', () => setView('full'), { size: 44 });
    ui.button(40 + (bw + 24) * 3, by, bw, 84, '✕ Скрыть', () => app.act?.('sys', 'hide'), { size: 44, color: C.bad });
  }

  // ---------- полный вид (логическая разметка 1050 × 700, на холсте ×1,6 — крупный текст) ----------
  function full(ui, panel, W, H) {
    const a = selected();
    ui.rect(3, 3, W - 6, H - 6, { fill: 'rgba(12,60,80,0.10)', stroke: 'rgba(88,230,255,0.6)', r: 16, lw: 3 });
    ui.text('Система', 20, 40, { size: 26, color: C.acc });
    ui.text(a ? a.title : '', 160, 40, { size: 20, color: '#ffffff', max: W - 160 - (app.simInfo?.() ? 550 : 300) });
    const sim = app.simInfo?.();
    if (sim) {
      ui.button(W - 540, 12, 70, 40, sim.paused ? '▶' : '⏸', () => go(sim.paused ? 'auto_start' : 'auto_pause'), { size: 20, active: sim.paused });
      ui.button(W - 462, 12, 164, 40, '⏹ Стоп имитации', () => go('auto_stop'), { size: 17, color: C.bad });
    }
    ui.button(W - 290, 12, 150, 40, '◱ Компактно', () => setView('compact'), { size: 18 });
    ui.button(W - 132, 12, 112, 40, '✕ Скрыть', () => app.act?.('sys', 'hide'), { size: 18, color: C.bad });
    const tw = (W - 40 - 4 * 8) / 5;
    TABS.forEach(([id, name], k) => ui.button(20 + k * (tw + 8), 62, tw, 42, name, () => { panel.state.tab = id; panel.dirty = true; }, { size: 21, active: panel.state.tab === id }));
    const area = { x: 20, y: 114, w: W - 40, h: H - 114 - 52 };
    if (!a) ui.text('Каталог пуст', area.x, area.y + 30, { size: 20 });
    else ({ algo: tabAlgo, cat: tabCat, kd: tabKd, tree: tabTree, ctl: tabCtl })[panel.state.tab](ui, panel, area, a);
    // подвал: способы управления окном
    ui.rect(20, H - 44, W - 40, 34, { fill: 'rgba(88,230,255,0.04)', stroke: 'rgba(88,230,255,0.25)', r: 8, lw: 1.5 });
    const keys = app.hotkeys?.() || 'X — скрыть · Shift+X — компактно · 7 8 9 0 = — вкладки · PgUp/PgDn — прокрутка';
    ui.text(`⌨ ${keys} · 📱 указатель смартфона (#tablet) · 🎙 голос`, 30, H - 21, { size: 14, color: C.dim, max: W - 60 });
  }

  function setView(v) { p.state.view = v; p.dirty = true; app.onSysView?.(v); }

  // ---------- вкладка «Алгоритм» ----------
  function tabAlgo(ui, panel, A, a) {
    const L = isLive(a) ? live(a) : null;
    const steps = a.steps;
    const listW = Math.round(A.w * 0.44), rowH = 30;
    const rows = Math.floor((A.h - 34) / rowH);
    const cur = L ? Math.min(L.index, steps.length - 1) : (panel.state.pick ?? 0);
    let top = panel.state.scroll.algo;
    if (top == null || panel.state._autoScroll !== cur) { top = Math.max(0, cur - Math.floor(rows / 3)); panel.state._autoScroll = cur; }
    top = Math.min(top, Math.max(0, steps.length - rows)); panel.state.scroll.algo = top;
    ui.text(L ? `● здесь: ${a.placeName}` : `просмотр · место: ${a.placeName}`, A.x, A.y + 18, { size: 17, color: L ? C.ok : C.warn, max: listW - 110 });
    ui.text(`${steps.length} перех.`, A.x + listW, A.y + 18, { size: 15, color: C.dim, align: 'right' });
    ui.rect(A.x, A.y + 28, listW, rows * rowH + 6, { stroke: 'rgba(88,230,255,0.3)', r: 8, lw: 1.5 });
    for (let r = 0; r < rows; r++) {
      const k = top + r; if (k >= steps.length) break;
      const s = steps[k], y = A.y + 31 + r * rowH;
      const done = L ? L.done(k) : false, now = k === cur, pk = k === panel.state.pick;
      if (now || pk) ui.rect(A.x + 3, y, listW - 6, rowH - 2, { fill: now ? 'rgba(88,230,255,0.16)' : 'rgba(255,200,69,0.10)', r: 6, lw: 0 });
      ui.hit(A.x, y, listW, rowH, () => { panel.state.pick = k; panel.dirty = true; });
      ui.text(done ? '✓' : now ? '▶' : '·', A.x + 12, y + 21, { size: 17, color: done ? C.ok : now ? C.acc : C.dim });
      ui.text(`${s.id}  ${s.title}`, A.x + 34, y + 21, { size: 17, color: now ? '#ffffff' : done ? C.dim : C.text, max: listW - 44 });
    }
    // справа — переход (текущий или выбранный в списке)
    const k0 = panel.state.pick != null ? panel.state.pick : cur;
    const s = steps[Math.min(k0, steps.length - 1)];
    const X = A.x + listW + 20, RW = A.w - listW - 20;
    let y = A.y + 18;
    ui.text(`${s.id}${s.op ? ` · оп. ${s.op}` : ''}${L && k0 !== cur ? ' · просмотр' : ''}`, X, y, { size: 19, color: C.acc, max: RW }); y += 6;
    y += ui.wrap(s.title, X, y + 28, RW, { size: 27, color: '#ffffff', lh: 1.12, maxLines: 2 }) + 6;
    for (const t of (s.text || []).slice(0, 3)) y += ui.wrap(`• ${t}`, X, y + 20, RW, { size: 18, lh: 1.2, maxLines: 3 }) + 2;
    if (s.tools?.length && y < A.y + A.h - 140) { y += 4; y += ui.wrap(`Инструмент: ${s.tools.map((t) => (typeof t === 'string' ? t : t.name || t.id)).join(', ')}`, X, y + 18, RW, { size: 16, color: C.dim, maxLines: 2 }); }
    if (s.check && y < A.y + A.h - 110) { ui.text(`Контроль: ${s.check.name} ${s.check.nominal} ± ${s.check.tol} ${s.check.unit}`, X, y + 24, { size: 17, color: C.warn, max: RW }); }
    const by = A.y + A.h - 44, bw = (RW - 3 * 8) / 4;
    if (L) {
      const msg = L.need === 'timer' ? `Идёт выдержка${L.timer ? ` ⏱ ${fmtMin(L.run.remaining(L.timer))}` : ''}` : L.need === 'value' ? `Нужен замер: ${L.step.check?.name}` : L.need === 'photo' ? 'Нужно фото' : 'Можно дальше ▸';
      ui.text(msg, X, by - 10, { size: 18, color: L.need ? C.warn : C.ok, max: RW });
      ui.button(X, by, bw, 42, '◂ Назад', () => go('prev'), { size: 17 });
      ui.button(X + (bw + 8), by, bw, 42, 'Готово ▸', () => go('next'), { size: 17, active: true });
      ui.button(X + (bw + 8) * 2, by, bw, 42, '📷 Фото', () => go('photo'), { size: 17 });
      ui.button(X + (bw + 8) * 3, by, bw, 42, '🧩 Вирт.', () => go('player'), { size: 17 });
    } else {
      ui.button(X, by, bw * 2 + 8, 42, `📍 ${a.placeName}`, () => go('goto_place', a.place), { size: 16 });
      ui.button(X + (bw + 8) * 2, by, bw * 2 + 8, 42, '🧩 Виртуально там', () => app.virtualAt?.(a.place), { size: 16 });
    }
  }

  // ---------- вкладка «Каталог» ----------
  function tabCat(ui, panel, A) {
    const list = catalog(), rowH = 98;
    const load = (a, tab) => { Object.assign(panel.state, { sel: a.id, pick: null, tab }); panel.state.scroll.algo = null; panel.dirty = true; };
    ui.text('Алгоритмы изготовления и сборки · процесс + КД (листы) + дерево сборки', A.x, A.y + 16, { size: 16, color: C.dim });
    list.forEach((a, k) => {
      const y = A.y + 28 + k * (rowH + 8);
      if (y + rowH > A.y + A.h) return;
      const sel = a.id === selected()?.id, here = isLive(a);
      const tx = A.x + 118, tmax = A.w - 118 - 486;
      ui.rect(A.x, y, A.w, rowH, { fill: sel ? 'rgba(88,230,255,0.10)' : 'rgba(88,230,255,0.03)', stroke: sel ? C.acc : 'rgba(88,230,255,0.35)', r: 10, lw: sel ? 2.5 : 1.5 });
      ui.hit(A.x, y, A.w - 480, rowH, () => load(a, panel.state.tab));
      ui.text(a.kind.toUpperCase(), A.x + 12, y + 28, { size: 14, color: a.kind === 'сборка' ? C.acc : a.kind === 'монтаж' ? C.warn : C.ok, max: 100 });
      ui.text(a.title, tx, y + 28, { size: 20, color: '#ffffff', max: tmax });
      ui.text(`${a.code} · ${a.placeName}${here ? ' · ● вы здесь' : ''}`, tx, y + 56, { size: 15, color: here ? C.ok : C.dim, max: tmax });
      ui.text(`${a.steps.length} переходов · КД ${a.docs.length} док. / ${a.sheets} л.${a.tree ? ' · дерево' : ''}`, tx, y + 82, { size: 15, color: C.dim, max: tmax });
      const bx = A.x + A.w - 474;
      ui.button(bx, y + 10, 112, 36, 'Загрузить', () => { load(a, 'algo'); app.notify(`Загружен алгоритм: ${a.title}`); }, { size: 16, active: true });
      ui.button(bx + 118, y + 10, 70, 36, 'КД', () => { panel.state.kd = { i: 0, sheet: 1 }; load(a, 'kd'); }, { size: 16 });
      ui.button(bx + 194, y + 10, 96, 36, 'Дерево', () => { panel.state.treeOpen = new Set(['0']); load(a, 'tree'); }, { size: 16, disabled: !a.tree });
      ui.button(bx + 296, y + 10, 166, 36, '📍 Перейти', () => go('goto_place', a.place), { size: 16, disabled: here });
      ui.button(bx, y + 54, 462, 36, '🧩 Виртуальная сборка — голограмма на месте изделия', () => app.virtualAt?.(a.place), { size: 15 });
    });
  }

  // ---------- вкладка «КД» ----------
  function tabKd(ui, panel, A, a) {
    const listW = Math.round(A.w * 0.32);
    const st = panel.state.kd; st.i = Math.min(st.i, a.docs.length - 1);
    let y = A.y + 4;
    a.docs.forEach((code, k) => {
      const d = docByCode.get(code); if (!d || y + 80 > A.y + A.h) return;
      const on = k === st.i;
      ui.rect(A.x, y, listW, 80, { fill: on ? 'rgba(88,230,255,0.12)' : 'rgba(88,230,255,0.03)', stroke: on ? C.acc : 'rgba(88,230,255,0.3)', r: 8, lw: 1.5 });
      ui.hit(A.x, y, listW, 44, () => { st.i = k; st.sheet = 1; panel.dirty = true; });
      ui.text(`${d.code} · ${d.kind}`, A.x + 10, y + 22, { size: 16, color: on ? '#ffffff' : C.text, max: listW - 20 });
      ui.text(d.title, A.x + 10, y + 40, { size: 13, color: C.dim, max: listW - 20 });
      d.sheets.forEach((sh, j) => ui.button(A.x + 10 + j * 64, y + 48, 58, 26, `Л${sh.n}`, () => { st.i = k; st.sheet = sh.n; panel.dirty = true; }, { size: 14, active: on && st.sheet === sh.n }));
      y += 88;
    });
    const code = a.docs[st.i], d = docByCode.get(code);
    const X = A.x + listW + 16, PW = A.w - listW - 16, PH = A.h - 52;
    ui.rect(X, A.y + 4, PW, PH, { stroke: 'rgba(88,230,255,0.4)', r: 4, lw: 1.5 });
    if (!d) return;
    const k = ui.k, fmt = docFormat(code, st.sheet), v = fitView(fmt, PW * k, PH * k, 8);
    if (!ui.dry) {
      const c = panel.ctx; c.save(); c.beginPath(); c.rect(X * k, (A.y + 4) * k, PW * k, PH * k); c.clip();
      drawDoc(c, code, st.sheet, { s: v.s, ox: X * k + v.ox, oy: (A.y + 4) * k + v.oy });
      c.restore();
    }
    ui.sig.push(`kd${code}${st.sheet}`);
    const sh = d.sheets.find((x) => x.n === st.sheet) || d.sheets[0];
    ui.text(`Лист ${sh.n}/${d.sheets.length} · ${sh.title} · ${sh.format}, ${sh.scale}`, X, A.y + A.h - 16, { size: 14, color: C.dim, max: PW - 380 });
    ui.button(X + PW - 370, A.y + A.h - 42, 80, 40, '◂ Л', () => { st.sheet = Math.max(1, st.sheet - 1); panel.dirty = true; }, { size: 16 });
    ui.button(X + PW - 284, A.y + A.h - 42, 80, 40, 'Л ▸', () => { st.sheet = Math.min(d.sheets.length, st.sheet + 1); panel.dirty = true; }, { size: 16 });
    ui.button(X + PW - 198, A.y + A.h - 42, 198, 40, '⤢ Открыть крупно', () => app.openKD(code, st.sheet), { size: 16, active: true });
  }

  // ---------- вкладка «Дерево» ----------
  function tabTree(ui, panel, A, a) {
    if (!a.tree) { ui.text('У алгоритма нет дерева сборки', A.x, A.y + 26, { size: 18, color: C.dim }); return; }
    const rows = treeRows(a.tree, panel.state.treeOpen), rowH = 30, n = Math.floor((A.h - 4) / rowH);
    const top = Math.min(panel.state.scroll.tree || 0, Math.max(0, rows.length - n)); panel.state.scroll.tree = top;
    rows.slice(top, top + n).forEach((r, k) => {
      const y = A.y + 2 + k * rowH, x = A.x + r.depth * 26;
      if (k % 2) ui.rect(A.x, y, A.w, rowH - 1, { fill: 'rgba(88,230,255,0.025)', r: 3, lw: 0 });
      if (r.has) ui.hit(A.x, y, A.w - 160, rowH, () => { const o = panel.state.treeOpen; if (o.has(r.path)) o.delete(r.path); else o.add(r.path); panel.dirty = true; });
      ui.text(r.has ? (r.open ? '▾' : '▸') : '–', x + 8, y + 21, { size: 18, color: r.has ? C.acc : C.dim });
      ui.text(r.node.name, x + 30, y + 21, { size: 17, color: r.depth === 0 ? '#ffffff' : C.text, max: A.w - (x - A.x) - 360 });
      if (r.node.code && r.node.code !== '—') ui.text(r.node.code, A.x + A.w - 300, y + 21, { size: 14, color: C.dim, mono: true, max: 150 });
      if (r.node.qty) ui.text(`× ${r.node.qty}`, A.x + A.w - 90, y + 21, { size: 16, color: C.warn, align: 'right' });
      if (r.node.doc) ui.button(A.x + A.w - 80, y + 3, 76, rowH - 6, 'КД', () => app.openKD(r.node.doc, 1), { size: 14 });
    });
    if (rows.length > n) {
      ui.button(A.x + A.w - 168, A.y + A.h - 40, 80, 38, '▲', () => scroll(panel, -1), { size: 18 });
      ui.button(A.x + A.w - 82, A.y + A.h - 40, 80, 38, '▼', () => scroll(panel, 1), { size: 18 });
    }
  }

  // ---------- вкладка «Управление» ----------
  function tabCtl(ui, panel, A) {
    const cols = 3, bw = (A.w - (cols - 1) * 10) / cols, bh = 54;
    QUICK.forEach(([label, cmd, arg], k) => {
      const x = A.x + (k % cols) * (bw + 10), y = A.y + 6 + Math.floor(k / cols) * (bh + 9);
      ui.button(x, y, bw, bh, label, () => go(cmd, arg), { size: 20 });
    });
  }

  // ---------- курсор указателя смартфона ----------
  function cursor(ui, panel) {
    const c = panel.state.cur;
    if (!c || performance.now() - (panel.state.curT || 0) > 6000) return;
    const x = c.x / ui.k, y = c.y / ui.k, r = 18 / ui.k;
    ui.rect(x - r, y - r, 2 * r, 2 * r, { stroke: '#ffffff', r, lw: 4 / ui.k });
    ui.rect(x - r / 3.5, y - r / 3.5, r / 1.75, r / 1.75, { fill: C.acc, r: r / 3.5, lw: 0 });
  }

  /** Указатель со смартфона: сдвиг (в долях ширины окна), нажатие, прокрутка. */
  p.phonePointer = (type, arg = {}) => {
    const W = p.px, H = p.py, st = p.state;
    st.phone = true; st.curT = performance.now();
    st.cur ??= { x: W / 2, y: H / 2 };
    if (type === 'move') {
      st.cur.x = Math.max(0, Math.min(W, st.cur.x + (arg.dx || 0) * W));
      st.cur.y = Math.max(0, Math.min(H, st.cur.y + (arg.dy || 0) * W));
      p.pointer({ x: st.cur.x / W, y: 1 - st.cur.y / H }, 'move');
    } else if (type === 'tap') p.pointer({ x: st.cur.x / W, y: 1 - st.cur.y / H }, 'click');
    else if (type === 'scroll') scroll(p, Math.sign(arg.dy || 0));
    p.dirty = true;
  };
  p.setView = setView;
  p.selected = selected;
  return p;
}
