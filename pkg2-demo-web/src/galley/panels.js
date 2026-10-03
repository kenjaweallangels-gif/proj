// Окна системы сборщика в AR: «Задание и чат», «Система сборщика» (поиск ТП и КД по чертёжному номеру),
// «КД» (лист в масштабе, зум, перемещение, зоны, контур 1:1 на изделии), «Переход» (текст, таймеры, контроль),
// «В этой точке» (локальный алгоритм у выбранного места узла), строка состояния очков.
import * as THREE from 'three';
import { docByCode, searchDocs, TASK } from './catalog.js';
import { drawDoc, docFormat, FORMATS, fitView } from './kd_draw.js';
import { MATERIALS, OPERATIONS, STEPS, TOOLS, TP, normByOperation, stepById } from './process.js';
import * as S from './spec.js';
import { C, Panel } from './ui3d.js';

const fmtMin = (m) => `${Math.floor(m / 60)}:${String(Math.floor(m % 60)).padStart(2, '0')}`;
const toolName = (id) => Object.values(TOOLS).find((t) => t.id === id)?.name || id;
const matName = (id) => Object.values(MATERIALS).find((t) => t.id === id)?.name || id;
const KIND_RU = { prep: 'подготовка', install: 'установка', glue: 'склеивание', fasten: 'крепёж', check: 'контроль', inspect: 'осмотр', wait: 'выдержка', paint: 'окраска', film: 'плёнка', wire: 'монтаж' };

export function buildPanels(mgr, app) {
  // ---------- Задание и чат ----------
  const task = mgr.add(new Panel(mgr, {
    id: 'task', title: 'Сменное задание и чат с мастером', w: 0.94, h: 0.864, ppm: 958, home: { pos: [2.2, 1.6, 2.75], look: [0, 1.6, 3.8] },
    draw(ui, p, top) {
      const W = p.px;
      let y = top + 34;
      ui.text(`${TASK.date} · ${TASK.shift}`, 22, y, { size: 21, color: C.dim });
      ui.text(`участок ${app.plantClock()}`, W - 22, y, { size: 24, color: C.warn, align: 'right', mono: true, weight: 600 });
      y += 30;
      ui.text(TASK.worker, 22, y, { size: 19, color: C.dim });
      y += 18;
      for (const it of TASK.items) {
        const done = it.normH === 0;
        ui.rect(16, y, W - 32, 74, { fill: done ? 'rgba(93,255,168,0.06)' : C.fill, stroke: done ? 'rgba(93,255,168,0.5)' : C.line, r: 8 });
        ui.text(done ? '✓' : '•', 34, y + 32, { size: 24, color: done ? C.ok : C.acc, weight: 600 });
        ui.wrap(it.text, 60, y + 28, W - 250, { size: 19, maxLines: 2 });
        ui.text(`оп. ${it.ops}`, W - 30, y + 28, { size: 18, color: C.dim, align: 'right' });
        if (it.doc) ui.button(W - 150, y + 38, 124, 30, 'открыть', () => { app.openSystem(it.doc); }, { size: 16 });
        y += 82;
      }
      for (const n of TASK.notes) { ui.text(`· ${n}`, 22, y + 18, { size: 17, color: C.dim, max: W - 44 }); y += 24; }
      y += 14;
      ui.text('Чат с мастером участка', 22, y + 18, { size: 22, weight: 600, color: C.acc });
      y += 30;
      const chatTop = y, chatH = p.py - y - 110;
      ui.rect(16, chatTop, W - 32, chatH, { stroke: C.line, r: 8 });
      const ctx = p.ctx; ctx.save(); ctx.beginPath(); ctx.rect(16, chatTop, W - 32, chatH); ctx.clip();
      let cy = chatTop + chatH - 12;
      for (const m of [...app.chat].reverse()) {
        const h = 22 * Math.ceil((m.text.length * 10) / (W - 120)) + 26;
        cy -= h;
        if (cy < chatTop - 60) break;
        ui.text(`${m.from} · ${m.time}`, m.mine ? W - 30 : 30, cy + 18, { size: 15, color: m.mine ? C.ok : C.warn, align: m.mine ? 'right' : 'left' });
        ui.wrap(m.text, m.mine ? 90 : 30, cy + 40, W - 130, { size: 18 });
      }
      ctx.restore();
      ui.input(16, p.py - 98, W - 170, 42, 'msg', p.state.msg || '', 'Сообщение мастеру… (Enter)');
      ui.button(W - 146, p.py - 98, 130, 42, 'Отправить', () => { app.sendChat(p.state.msg); p.state.msg = ''; });
      ui.button(16, p.py - 48, 190, 36, 'Вызвать мастера', () => app.sendChat(`Прошу подойти к стапелю СТ-3: переход ${app.run.step.id}`), { size: 17 });
      ui.button(214, p.py - 48, 210, 36, 'Вопрос технологу', () => app.sendChat(`Вопрос по ${app.run.step.id} «${app.run.step.title}»`, 'Технолог'), { size: 17 });
      ui.button(432, p.py - 48, 196, 36, 'Фото в журнал', () => app.photo(), { size: 17 });
    },
  }));
  task.onEnter = (id, text) => { if (id === 'msg') { app.sendChat(text); task.state.msg = ''; } };
  task.animated = true;

  // ---------- Система сборщика: поиск ТП и КД ----------
  const sys = mgr.add(new Panel(mgr, {
    id: 'system', title: 'Система сборщика · ТП и КД', w: 0.96, h: 0.864, ppm: 958, home: { pos: [-2.2, 1.6, 2.75], look: [0, 1.6, 3.8] },
    onWheel(dy, pt, p) { p.state.scroll = Math.max(0, (p.state.scroll || 0) + Math.sign(dy) * 3); },
    draw(ui, p, top) {
      const W = p.px;
      let y = top + 12;
      ui.input(16, y, W - 300, 46, 'q', p.state.q || '', 'Чертёжный номер или наименование');
      ui.button(W - 276, y, 130, 46, 'Найти', () => { p.state.results = searchDocs(p.state.q || ''); p.state.view = 'results'; p.state.scroll = 0; });
      ui.button(W - 138, y, 122, 46, 'Из задания', () => { p.state.q = TASK.items[0].doc.replace(' СБ', ''); p.state.results = searchDocs(p.state.q); p.state.view = 'results'; p.state.scroll = 0; }, { size: 17 });
      y += 62;
      const view = p.state.view || 'results';
      if (view === 'results') {
        const res = p.state.results || searchDocs('КМ2');
        ui.text(p.state.results ? `Найдено: ${res.length}` : 'Документы изделия КМ-2 (введите номер, например КМ2.150.000)', 22, y + 16, { size: 18, color: C.dim, max: W - 44 });
        y += 30;
        const sc = p.state.scroll || 0;
        for (const d of res.slice(sc, sc + 11)) {
          const isTP = d.kind === 'ТП';
          const hov = ui.hit(16, y, W - 32, 50, () => { if (isTP) { p.state.view = 'tp'; p.state.scroll = 0; } else app.openKD(d.code, 1); });
          ui.rect(16, y, W - 32, 50, { fill: hov ? C.hover : C.fill, stroke: isTP ? C.warn : C.line, r: 6 });
          ui.text(d.code, 30, y + 32, { size: 21, mono: true, color: isTP ? C.warn : C.acc, weight: 600 });
          ui.text(d.title, 300, y + 32, { size: 19, max: W - 420 });
          ui.text(isTP ? 'ТП ▸' : `${d.kind} · ${d.sheets.length} л.`, W - 30, y + 32, { size: 16, color: C.dim, align: 'right' });
          y += 56;
        }
        ui.button(16, p.py - 54, 300, 40, `Открыть ${TP.designation}`, () => { p.state.view = 'tp'; p.state.scroll = 0; }, { size: 17, color: C.warn });
      } else {
        ui.button(16, y, 120, 38, '◂ Назад', () => { p.state.view = 'results'; }, { size: 17 });
        ui.text(`${TP.designation} — ${TP.name}, ред. ${TP.revision}`, 150, y + 26, { size: 19, color: C.warn, max: W - 170 });
        y += 50;
        const norms = normByOperation();
        const rows = [];
        for (const o of OPERATIONS) { rows.push({ op: o, h: 40 }); for (const s of o.steps) rows.push({ s, h: 38 }); }
        const sc = p.state.scroll || 0;
        const cur = app.run.step.id;
        for (const r of rows.slice(sc)) {
          if (y > p.py - 70) break;
          if (r.op) {
            const doneOp = r.op.steps.every((s) => app.run.done.has(s.id));
            ui.text(`${r.op.id}  ${r.op.title}`, 22, y + 28, { size: 20, weight: 600, color: doneOp ? C.ok : C.acc, max: W - 200 });
            ui.text(`${fmtMin(norms[r.op.id])} ч`, W - 26, y + 28, { size: 16, color: C.dim, align: 'right' });
          } else {
            const s = r.s, isCur = s.id === cur, isPrev = app.preview === s.id, done = app.isDone(s.id);
            const hov = ui.hit(30, y, W - 46, r.h - 4, () => app.setPreview(s.id));
            ui.rect(30, y, W - 46, r.h - 4, { fill: isCur ? 'rgba(255,212,90,0.16)' : isPrev ? C.active : hov ? C.hover : null, stroke: isCur ? C.warn : null, r: 5 });
            ui.text(done ? '✓' : isCur ? '▸' : ' ', 40, y + 25, { size: 18, color: done ? C.ok : C.warn });
            ui.text(s.id, 62, y + 25, { size: 17, mono: true, color: C.dim });
            ui.text(s.title, 150, y + 25, { size: 18, max: W - 330, color: done ? C.dim : C.text });
            const b = `${s.timer ? `⏱${s.timer.min}′ ` : ''}${s.check ? '✓контр ' : ''}${s.critical ? '!' : ''}`;
            ui.text(b, W - 26, y + 25, { size: 15, color: C.warn, align: 'right' });
          }
          y += r.h;
        }
        ui.text('Колесо — прокрутка · щелчок по переходу — показать в 3D', 22, p.py - 26, { size: 16, color: C.dim });
      }
    },
  }));
  sys.onEnter = (id, text) => { if (id === 'q') { sys.state.results = searchDocs(text); sys.state.view = 'results'; sys.state.scroll = 0; } };

  // ---------- КД: лист в масштабе, зум, зоны ----------
  const kd = mgr.add(new Panel(mgr, {
    id: 'kd', title: 'КД', w: 1.2, h: 0.864, ppm: 1042, home: { pos: [-1.15, 1.6, 1.7], look: [0, 1.6, 3.8] },
    onWheel(dy, pt, p) { app.kdZoom(dy < 0 ? 1.25 : 0.8, pt); },
    onDrag(d) { app.kdPan(d); },
    draw(ui, p, top) {
      const k = app.kd, W = p.px, H = p.py;
      const doc = docByCode.get(k.code);
      const fmt = docFormat(k.code, k.sheet);
      const area = { x: 12, y: top + 54, w: W - 24, h: H - top - 66 };
      p.title = `КД · ${k.code} · лист ${k.sheet}/${doc?.sheets.length || 1}`;
      let x = 16;
      const B = (w, label, fn, opts) => { ui.button(x, top + 4, w, 40, label, fn, opts); x += w + 8; };
      B(48, '◂', () => app.kdSheet(-1), { disabled: k.sheet <= 1 });
      B(48, '▸', () => app.kdSheet(1), { disabled: !doc || k.sheet >= doc.sheets.length });
      B(48, '−', () => app.kdZoom(0.8));
      B(48, '+', () => app.kdZoom(1.25));
      B(110, 'Вписать', () => app.kdFit(), { size: 17 });
      B(190, 'Контур 1:1', () => app.kdOverlay(), { active: app.kdOverlayOn, size: 17 });
      const sheet = doc?.sheets.find((s) => s.n === k.sheet);
      const scale = sheet?.scale || '—';
      ui.text(`${fmt} · ${scale} · ×${k.zoom.toFixed(1).replace('.', ',')}`, W - 18, top + 32, { size: 18, color: C.dim, align: 'right' });
      // лист: вписать в область и применить зум вокруг (cx, cy) мм листа
      const fit = fitView(fmt, area.w, area.h, 4);
      const s = fit.s * k.zoom;
      const [FW, FH] = FORMATS[fmt];
      if (k.cx == null) { k.cx = FW / 2; k.cy = FH / 2; }
      const view = { s, ox: area.x + area.w / 2 - k.cx * s, oy: area.y + area.h / 2 - k.cy * s };
      k.view = view; k.area = area;
      const c = p.ctx; c.save(); c.beginPath(); c.rect(area.x, area.y, area.w, area.h); c.clip();
      drawDoc(c, k.code, k.sheet, view, { zone: k.zone });
      c.restore();
      ui.rect(area.x, area.y, area.w, area.h, { stroke: C.line, r: 4, lw: 1.5 });
      // физический размер: на панели шириной w м лист занимает …
      const mmOnPanel = (FW * s) / p.px * p.w * 1000;
      ui.text(`лист ${FW}×${FH} мм на окне ${Math.round(mmOnPanel)} мм шириной (масштаб окна ${(mmOnPanel / FW).toFixed(2).replace('.', ',')})`, 22, H - 18, { size: 15, color: C.dim });
    },
  }));

  // ---------- Переход: текст, таймеры, контроль ----------
  const step = mgr.add(new Panel(mgr, {
    id: 'step', title: 'Переход', w: 0.94, h: 0.864, ppm: 958, home: { pos: [1.15, 1.6, 1.7], look: [0, 1.6, 3.8] },
    draw(ui, p, top) {
      const W = p.px;
      const run = app.run;
      const s = stepById.get(app.preview || run.step.id);
      const isCur = s.id === run.step.id;
      p.title = isCur ? `Переход ${s.id} · текущий` : `Переход ${s.id} · просмотр`;
      let y = top + 10;
      const op = OPERATIONS.find((o) => o.id === s.op);
      ui.text(`Оп. ${op.id} ${op.title}`, 22, y + 22, { size: 18, color: C.dim, max: W - 44 });
      y += 32;
      y += ui.wrap(s.title, 22, y + 26, W - 44, { size: 26, weight: 600, color: isCur ? '#ffffff' : C.acc, maxLines: 2 }) + 2;
      ui.text(`${KIND_RU[s.kind] || s.kind} · норма ${s.normMin} мин${s.critical ? ' · КРИТИЧНЫЙ' : ''}`, 22, y + 18, { size: 17, color: s.critical ? C.warn : C.dim });
      y += 30;
      for (const t of s.text) y += ui.wrap(`— ${t}`, 22, y + 20, W - 44, { size: 18, maxLines: 3 }) + 2;
      for (const t of s.warn) y += ui.wrap(`⚠ ${t}`, 22, y + 20, W - 44, { size: 18, color: C.warn, maxLines: 3 }) + 4;
      if (s.tools.length) { y += ui.wrap(`Инструмент: ${s.tools.map(toolName).join('; ')}`, 22, y + 20, W - 44, { size: 16, color: C.dim, maxLines: 2 }) + 2; }
      if (s.materials.length) { y += ui.wrap(`Материалы: ${s.materials.map(matName).join('; ')}`, 22, y + 20, W - 44, { size: 16, color: C.dim, maxLines: 2 }) + 2; }
      const parts = [...s.parts, ...s.joints].slice(0, 6).map((id) => S.featureById.get(id)).filter(Boolean);
      if (parts.length) {
        y += 6;
        const more = s.parts.length + s.joints.length - parts.length;
        const list = parts.map((f) => f.designation).filter((v, i, a) => a.indexOf(v) === i).join(', ');
        y += ui.wrap(`Детали: ${list}${more > 0 ? ` и ещё ${more}` : ''}`, 22, y + 20, W - 44, { size: 17, color: C.acc, maxLines: 2 });
      }
      y += 8;
      for (const r of s.kd.slice(0, 2)) {
        ui.button(22, y, W - 44, 36, `КД: ${r.doc}, лист ${r.sheet}, зона ${r.zone}`, () => app.openKD(r.doc, r.sheet, r.zone), { size: 17 });
        y += 42;
      }
      // таймеры
      for (const t of run.activeTimers()) {
        const left = run.remaining(t), tot = t.endMin - t.startMin;
        ui.text(`${t.blocking ? '⏳' : '⏱'} ${t.label} (${t.step})`, 22, y + 22, { size: 18, color: t.blocking ? C.warn : C.text, max: W - 170 });
        ui.text(fmtMin(left), W - 22, y + 22, { size: 22, color: C.warn, align: 'right', mono: true, weight: 600 });
        ui.progress(22, y + 30, W - 44, 12, 1 - left / tot, t.blocking ? C.warn : C.acc);
        y += 50;
      }
      // контроль и кнопки
      const by = p.py - 120;
      if (isCur && s.check) {
        const ok = s.id in run.values;
        ui.text(`${s.check.name}: ${String(s.check.nominal).replace('.', ',')}${s.check.tol ? ` ± ${String(s.check.tol).replace('.', ',')}` : ''} ${s.check.unit}`, 22, by - 16, { size: 18, color: ok ? C.ok : C.warn, max: W - 44 });
        ui.input(22, by, 240, 46, 'value', p.state.value || '', 'значение');
        ui.button(270, by, 90, 46, 'OK', () => app.value(p.state.value));
        if (ok) ui.text(`✓ ${String(run.values[s.id]).replace('.', ',')}`, 380, by + 32, { size: 22, color: C.ok });
      }
      if (isCur && s.photo) ui.button(W - 170, by, 148, 46, run.values[`${s.id}:photo`] ? 'Фото ✓' : 'Фото', () => app.photo(), { active: !!run.values[`${s.id}:photo`] });
      const need = isCur ? run.needs() : null;
      ui.button(22, p.py - 62, 150, 48, '◂ Назад', () => app.prev());
      if (isCur) ui.button(180, p.py - 62, W - 202, 48, need === 'timer' ? 'Идёт выдержка…' : need === 'value' ? 'Введите значение' : need === 'photo' ? 'Нужно фото' : 'Выполнено ▸', () => app.next(), { disabled: !!need, color: C.ok });
      else ui.button(180, p.py - 62, W - 202, 48, 'Вернуться к текущему', () => app.setPreview(null), { color: C.warn });
    },
  }));
  step.onEnter = (id, text) => { if (id === 'value') app.value(text); };
  step.animated = true;

  // ---------- В этой точке (локальный алгоритм) ----------
  const local = mgr.add(new Panel(mgr, {
    id: 'local', title: 'В этой точке', w: 0.5, h: 0.6, ppm: 1300,
    onWheel(dy, pt, p) { p.state.scroll = Math.max(0, (p.state.scroll || 0) + Math.sign(dy)); },
    draw(ui, p, top) {
      const L = app.local, W = p.px;
      if (!L) { ui.text('Наведите прицел на узел и нажмите F', 22, top + 40, { size: 20 }); return; }
      let y = top + 6;
      ui.text(`Точка (мм, СК модуля): ${L.point.map((v) => Math.round(v)).join(' · ')}`, 22, y + 22, { size: 17, color: C.dim, mono: true });
      y += 34;
      const sc = p.state.scroll || 0;
      for (const { f, dist } of L.features.slice(sc, sc + 6)) {
        const hov = ui.hit(16, y, W - 32, 62, () => app.localFocus(f.id));
        ui.rect(16, y, W - 32, 62, { fill: L.focus === f.id ? C.active : hov ? C.hover : C.fill, stroke: C.line, r: 6 });
        ui.text(f.designation || f.id, 28, y + 26, { size: 18, mono: true, color: C.acc, max: W - 160 });
        ui.text(`${Math.round(dist)} мм`, W - 28, y + 26, { size: 15, color: C.dim, align: 'right' });
        ui.text(f.name || '', 28, y + 52, { size: 17, max: W - 56 });
        y += 68;
      }
      y += 6;
      ui.text('Переходы для этого места:', 22, y + 18, { size: 18, color: C.warn });
      y += 26;
      for (const s of L.steps.slice(0, 4)) {
        ui.button(16, y, W - 32, 38, `${s.id} ${s.title}`, () => app.setPreview(s.id), { size: 16, active: app.preview === s.id });
        y += 44;
      }
      ui.button(16, p.py - 54, (W - 40) / 2, 42, 'Показать сборку', () => app.localPlay(), { color: C.ok, size: 17 });
      ui.button(24 + (W - 40) / 2, p.py - 54, (W - 40) / 2, 42, 'Узел на КД', () => app.localKD(), { size: 17 });
    },
  }));
  mgr.toggle(local, false);

  // ---------- строка состояния очков (привязана к голове) ----------
  const hud = mgr.add(new Panel(mgr, {
    id: 'hud', title: '', w: 0.62, h: 0.11, ppm: 1700, chrome: false,
    draw(ui, p) {
      const W = p.px, H = p.py;
      const s = app.run.step;
      const tm = app.run.activeTimers().find((t) => t.blocking) || app.run.activeTimers()[0];
      const y = H - 18;
      ui.text(`${app.plantClock()}  ·  ${app.aligned ? `совмещено ${app.alignErr} мм` : 'поиск меток…'}  ·  ${s.id} ${s.title}`, 14, y, { size: 30, color: C.text, max: W * 0.72 });
      ui.text(tm ? `⏱ ${fmtMin(app.run.remaining(tm))}` : `🔋 87 %  Wi-Fi цеха`, W - 14, y, { size: 30, color: tm ? C.warn : C.dim, align: 'right', mono: !!tm });
      const ai = app.autoInfo?.();
      if (ai) ui.text(ai, 14, y - 48, { size: 28, color: C.warn, max: W * 0.6 });
      if (app.toast && performance.now() < app.toast.until) ui.text(app.toast.text, W - 14, y - (ai ? 96 : 48), { size: 30, color: C.ok, align: 'right', max: W - 28 });
    },
  }));
  hud.mode = 'head';
  hud.animated = true;
  return { task, sys, kd, step, local, hud };
}

/** Строка состояния: держать у нижнего края окна дисплея (привязка к голове, с задержкой дисплея). */
export function placeHud(hud, camera, win, centerDeg = -2) {
  const d = 1.6;
  // нижний край строки — в 1,2° над нижним краем окна дисплея (у каждых очков своё окно и смещение)
  const bottom = Math.tan(THREE.MathUtils.degToRad(centerDeg - win.v / 2 + 1.2)) * d;
  const g = hud.group;
  g.position.copy(camera.position);
  g.quaternion.copy(camera.quaternion);
  g.translateZ(-d);
  g.translateY(bottom + hud.h / 2);      // у нижнего края окна дисплея — не перекрывает окна КД и перехода
  if (g.parent) {                        // система окон может быть повёрнута (3DoF) — перевести позу в её СК
    g.parent.updateMatrixWorld();
    const m = new THREE.Matrix4().compose(g.position, g.quaternion, g.scale).premultiply(g.parent.matrixWorld.clone().invert());
    m.decompose(g.position, g.quaternion, g.scale);
  }
}

export { STEPS };
