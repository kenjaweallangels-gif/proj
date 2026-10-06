// Симулятор участка: сборщик приходит на участок, надевает AR-очки, подходит к стапелю и собирает модуль
// кухонный КМ-2 по ТП: окна КД, задания с чатом и системы сборщика закреплены в пространстве, переходы
// показываются голограммами, выдержки — таймерами; F — осмотр точки узла с локальным алгоритмом.
// I — автоматическая имитация сборки по ТП (переходы, установка деталей со стеллажа, замеры, выдержки ускоренно).
// Профили очков (glasses.js): VITURE Luma Ultra/Pro, The Beast, XREAL Air 2 Pro/Ultra, One, One Pro, Aura — K.
// Параметры адреса: ?intro=0 (без вступления) &vision=norm|presby|myopia|… &step=080.04 &speed=60 &glasses=aura &auto=1 &debug=orbit
// В hash (встроенный просмотр): #nointro-aura-auto, #onepro, #s090010 …
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { HOLO, LAYER_HOLO, LAYER_LABEL, LAYER_REAL, markerFrame } from '../engine/holo.js';
import { AUTO_REPLIES, CHAT_SCRIPT, docByCode } from './catalog.js';
import { docFormat, FORMATS } from './kd_draw.js';
import { buildPanels, placeCorner, placeHud, stationPanel } from './panels.js';
import { Player } from './player.js';
import { DONE_BEFORE_SHIFT, ProcessRun, STEPS, stateFrom, stepById, stepsForFeature } from './process.js';
import * as S from './spec.js';
import { PanelManager } from './ui3d.js';
import { DISPLAY, Eye, PRESETS, VisionRenderer } from './vision.js';
import { StepViz } from './viz.js';
import { GALLEY_ORIGIN, PLACES, buildWorld } from './world.js';
import { createLink, trimText } from './link.js';
import { PHRASES, createRecognizer, parseGalley, speak } from './voice_cmd.js';
import { OPERATIONS } from './process.js';
import { searchDocs } from './catalog.js';
import { buildGlassesModel } from './glasses_model.js';
import { AssemblyPlayer, SPEEDS } from './assembly_player.js';
import { galleyTarget } from './galley_player.js';
import { trainingTarget } from './training_view.js';
import { capsFor, compareRows, snapTransmit } from './software.js';
import { buildCatalog, findAlgorithm } from './algorithms.js';
import { tickHolo } from './virtual.js';
import { buildWorker } from './humanoid.js';
import { textTexture } from './tex.js';
import { DEFAULT_DEVICE, DEVICES, deviceById, deviceSummary, dimLevelOfStep, dimStepOf, fitDistance, matchDevice, transmitAt, weightFatigue, windowDeg } from './glasses.js';
import '../style.css';
import './galley.css';

const q = new URLSearchParams(location.search);
for (const t of location.hash.slice(1).split(/[-_.~]/).filter(Boolean)) {      // короткие метки для встроенного просмотра
  if (t === 'nointro') q.set('intro', '0');
  else if (PRESETS[t]) q.set('vision', t);
  else if (/^s\d{6}$/.test(t)) q.set('step', `${t.slice(1, 4)}.${t.slice(4, 6)}`);
  else if (deviceById.has(t)) q.set('glasses', t);
  else if (t === 'auto') q.set('auto', '1');
  else if (t === 'free') { q.set('auto', '1'); q.set('autocam', 'free'); }
  else if (t === 'corner') q.set('corner', '1');
  else if (t === 'virtual') { q.set('asm', '1'); q.set('intro', '0'); }
  else if (t === 'train' || t === 'training') { q.set('train', '1'); q.set('intro', '0'); }
  else if (t === 'tp') q.set('tp', '1');
  else if (t === 'stock' || t === 'sdk') q.set('sw', t);
  else if (['em1', 'sl1', 'me1'].includes(t)) { q.set('place', t); q.set('intro', '0'); }
  else if (t === 'narrow') q.set('field', '0');
  else if (t === 'clean') q.set('view', 'clean');
  else if (t === 'direct') q.set('view', 'direct');
  else if (t === 'autonomous') q.set('mode', 'auto');
  else if (t === 'manual') q.set('mode', 'manual');
}
const $ = (id) => document.getElementById(id);
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const SHIFT_START_MIN = 7 * 60 + 30;

async function main() {
  // тот же адрес с #tablet — пульт сборщика вместо 3D (второе устройство открывает общую ссылку)
  if (/(^|[#\-_.~])tablet(\b|$)/.test(location.hash)) { const { mountTablet } = await import('./tablet.js'); mountTablet(); window.__demo = { ready: true, tablet: true }; return; }
  const canvas = $('view');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: q.has('shot'), powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, Number(q.get('pr')) || 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.localClippingEnabled = true;                                 // обучение: клей и плёнка наносятся полосой
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#2b3035');
  const world = buildWorld(scene);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(scene, 0.02, 0.1, 60, { position: V(0, 2.2, 3.5) }).texture;
  scene.environmentIntensity = 1.15;
  // тени — не на каждый проход отрисовки (их 2–3 за кадр), а раз в shadowEvery кадров: статичный цех и так неподвижен
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;

  // ---------- процесс ----------
  const run = new ProcessRun(STEPS, 0, new Set(DONE_BEFORE_SHIFT));
  if (q.get('step') && stepById.has(q.get('step'))) run.goto(q.get('step'));
  const cam = new THREE.PerspectiveCamera(72, 1, 0.03, 80);
  const viz = new StepViz(world, scene);

  // ---------- состояние приложения (для окон) ----------
  const app = {
    run, world, viz, preview: null, chat: [], aligned: false, alignErr: '0,6', toast: null, local: null, kdOverlayOn: false,
    speed: Number(q.get('speed')) || 60,         // секунд участка за секунду показа
    kd: { code: 'КМ2.000.000 СБ', sheet: 1, zone: null, zoom: 1, cx: null, cy: null },
    plantClock() { const m = SHIFT_START_MIN + run.clockMin; return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`; },
    isDone: (id) => run.done.has(id) || STEPS.findIndex((s) => s.id === id) < run.index,
    sendChat(text, to = 'Мастер участка') {
      if (!text?.trim()) return;
      app.chat.push({ from: 'Вы', text: text.trim(), mine: true, time: app.plantClock() });
      setTimeout(() => app.chat.push({ from: to, text: AUTO_REPLIES[Math.floor(Math.random() * AUTO_REPLIES.length)], time: app.plantClock() }), 2200);
      panels.task.dirty = true;
    },
    notify(text, sec = 3) { app.toast = { text, until: performance.now() + sec * 1000 }; },
    openSystem(code) { panels.sys.state.q = code.replace(' СБ', ''); panels.sys.onEnter('q', panels.sys.state.q); mgr.toggle(panels.sys, true); panels.sys.dirty = true; },
    openKD(code, sheet = 1, zone = null) {
      Object.assign(app.kd, { code, sheet, zone, zoom: zone ? 2.2 : 1, cx: null, cy: null });
      if (zone) {
        const fmt = docFormat(code, sheet);
        const [W, H] = FORMATS[fmt];
        const cols = fmt === 'A1' ? 8 : fmt === 'A2' ? 6 : 4;
        const r = 'ABCD'.indexOf(zone[0]), k = Number(zone.slice(1)) - 1;
        app.kd.cx = 20 + ((k + 0.5) * (W - 25)) / cols; app.kd.cy = 5 + ((r + 0.5) * (H - 10)) / 4;
      }
      mgr.toggle(panels.kd, true); panels.kd.dirty = true;
    },
    kdSheet(d) { const doc = docByCode.get(app.kd.code); app.kd.sheet = Math.max(1, Math.min(doc.sheets.length, app.kd.sheet + d)); app.kd.zone = null; app.kdFit(); },
    kdFit() { Object.assign(app.kd, { zoom: 1, cx: null, cy: null }); panels.kd.dirty = true; },
    kdZoom(f, pt) {
      const k = app.kd;
      const nz = THREE.MathUtils.clamp(k.zoom * f, 0.6, 24);
      if (pt && k.view) {                                   // точка под курсором остаётся на месте
        const mx = (pt.x - k.view.ox) / k.view.s, my = (pt.y - k.view.oy) / k.view.s;
        const s2 = (k.view.s * nz) / k.zoom;
        const ox = pt.x - mx * s2, oy = pt.y - my * s2;
        k.cx = (k.area.x + k.area.w / 2 - ox) / s2; k.cy = (k.area.y + k.area.h / 2 - oy) / s2;
      }
      k.zoom = nz; panels.kd.dirty = true;
    },
    kdPan(d) { const k = app.kd; if (!k.view) return; k.cx -= d.x / k.view.s; k.cy -= d.y / k.view.s; panels.kd.dirty = true; },
    kdOverlay() { app.kdOverlayOn = !app.kdOverlayOn; viz.setOverlay(app.kdOverlayOn); },
    setPreview(id) { app.preview = id && id !== run.step.id ? id : null; showStep(); },
    next() { const r = run.next(); if (r) app.notify(r === 'timer' ? 'Идёт выдержка — переход заблокирован таймером' : r === 'value' ? 'Введите измеренное значение' : 'Нужно фото'); },
    prev() { run.prev(); },
    value(v) {
      const x = parseFloat(String(v ?? '').replace(',', '.'));
      if (!Number.isFinite(x)) return;
      const ok = run.value(x);
      app.notify(ok ? `Значение ${String(x).replace('.', ',')} — в допуске` : `Значение ${String(x).replace('.', ',')} — ВНЕ допуска, сообщите мастеру`, 4);
      panels.step.state.value = '';
    },
    photo() { run.photo(); vision.u.flash.value = 1; app.notify(`Фото ${run.step.id} сохранено в журнал`); },
    localFocus(id) { app.local.focus = id; viz.show(null, { features: [id], focus: app.local.point }); panels.local.dirty = true; },
    localPlay() { if (app.local) viz.show(null, { features: app.local.features.slice(0, 6).map((x) => x.f.id), focus: app.local.point }); },
    localKD() {
      const f = app.local?.features[0]?.f;
      const zone = !f ? 'A1' : f.kind === 'bracket' || f.kind === 'screw' || f.kind === 'insert' ? 'B2' : f.kind === 'joint' ? 'A2' : f.kind === 'fitting' ? 'D2' : f.kind === 'hinge' || f.kind === 'door' ? 'C3' : null;
      if (zone) app.openKD('КМ2.000.000 СБ', 2, zone);
      else if (f?.kind === 'panel') app.openKD(f.designation.replace(/-\d\d$/, ''), 1);
      else app.openKD('КМ2.000.000 СБ', 1, 'B3');
    },
  };

  // ---------- окна ----------
  const toJig = (v) => { const p = v.clone().sub(GALLEY_ORIGIN).multiplyScalar(1000); return { x: p.x, y: p.y, z: p.z }; };
  const fromJig = (p) => V(p.x, p.y, p.z).multiplyScalar(0.001).add(GALLEY_ORIGIN);
  const mgr = new PanelManager(scene, cam, { toJig, fromJig });
  const panels = buildPanels(mgr, app);
  // ---------- дополнительные участки: окна в очках, активный участок, переходы ----------
  // окна участков — перед участком, сбоку от рабочей зоны, на уровне глаз (СК участка: +z — к сборщику)
  const STATION_PANEL = { em1: [1.45, 1.72, 1.15], sl1: [-0.95, 1.72, 1.15], me1: [-1.45, 1.75, 1.45] };
  const stations = world.stations || [];
  for (const st of stations) {
    st.root.updateMatrixWorld(true);
    const [x, y, z] = STATION_PANEL[st.id];
    st.panel = stationPanel(mgr, app, st, { pos: st.root.localToWorld(V(x, y, z)).toArray(), look: st.root.localToWorld(V(x * 0.6, y, z + 3)).toArray() });
  }
  let activeSt = null;
  /** Участок рядом со сборщиком (≤ 4,5 м от центра участка), иначе — стапель. */
  function nearStation() {
    let best = null, bd = 4.5;
    for (const st of stations) { const d = Math.hypot(player.pos.x - st.center.x, player.pos.z - st.center.z); if (d < bd) { bd = d; best = st; } }
    return best;
  }
  app.stationAct = (st, cmd) => {
    if (cmd === 'next') { const r = st.next(); app.notify(r === 'value' ? `Введите замер: ${st.step.check.name} (голос «сборка значение …»)` : st.done ? `${st.short}: изделие готово` : `${st.short}: ${st.step.id} ${st.step.title}`, 4); }
    if (cmd === 'prev') st.prev();
    if (cmd === 'player') { asm.openFor(st.asm, 0); asm.play(1); }
    st.panel.dirty = true; st.showHolo(holoOn(st)); pushState(true);
  };
  // каталог алгоритмов (стапель и участки) для окна «Система»
  app.catalog = buildCatalog(stations);
  app.activeAlgId = () => (activeSt ? activeSt.id : app.simInfo?.()?.st?.id || 'km2');
  app.stationOf = (id) => stations.find((s) => s.id === id) || null;
  app.stationInfo = () => {
    const st = activeSt || app.simInfo?.()?.st;                       // у участка рядом или где идёт имитация
    return st && !st.done ? { st, step: st.step, index: st.index, total: st.steps.length } : null;
  };
  const holoOn = (st) => st === activeSt && !!sim.glasses && !!sim.display && !asm?.open && app.aligned && !!sim.caps?.holoOnPart;

  let asm = null;                                                     // плеер виртуальной сборки (создаётся ниже)
  function applyState() {
    if (asm?.open) return;                                             // идёт виртуальная сборка — вид задаёт плеер
    const st = stateFrom(run.index, run.done);
    const powered = STEPS.findIndex((s) => s.id === '170.03') < run.index;
    world.galley.setState(st, { powered });
    for (const [id, k] of world.kit) k.visible = !st.installed.has(id);
  }
  function showStep() {
    const s = app.preview ? stepById.get(app.preview) : run.step;
    viz.show(s);
    panels.step.dirty = true; panels.sys.dirty = true;
  }
  run.on((e) => {
    if (e.event === 'step') { app.preview = null; applyState(); showStep(); app.notify(`Переход ${run.step.id}: ${run.step.title}`); }
    if (e.event === 'timer_done') app.notify(`Готово: ${e.timer.label}`, 4);
    if (e.event === 'timer_start' && e.timer.blocking) app.notify(`Таймер: ${e.timer.label}`);
    if (e.event === 'rejected') panels.step.dirty = true;
    if (e.event === 'done') app.notify('Операции задания выполнены — предъявить ОТК', 6);
  });
  applyState(); showStep();

  // ---------- сборщик, глаз, очки ----------
  const player = new Player(cam, canvas, world.colliders);
  // зрение: два глаза (оба / только левый / только правый), ведущий глаз, межзрачковое расстояние, двоение
  const BINO = { eyes: 'both', domEye: 'R', ipd: 64, diplo: 0 };      // двоение — только как демонстрация
  const params = { light: 1, ...BINO, ...(PRESETS[q.get('vision')] || PRESETS.norm) };
  const eye = new Eye(params);
  const vision = new VisionRenderer(renderer, scene, cam);
  vision.ipdMM = params.ipd;
  vision.quality = Number(q.get('q')) || (navigator.webdriver ? 0.35 : 1);   // в проверках без GPU — сразу пониже
  // по умолчанию — полное поле ≈ 200°; ?field=0 — центр 72°; ?view=clean — без периферийного зрения
  vision.setView(q.get('view') || (q.get('field') === '0' ? 'center' : 'field'));
  // адаптивное качество полного поля: долгий кадр (> 90 мс) несколько секунд подряд — разрешение ниже
  const perf = { ema: 0.016, slow: 0, shadowEvery: 2, gazeMs: 0 };
  const sim = { glasses: 0, display: 0, boot: 0, dimLevel: params.dim, dimMode: q.get('vision') === 'dimmed' ? 'manual' : 'auto', bright: 1, occlusion: false, tts: true,
    device: deviceById.get(q.get('glasses')) || deviceById.get(DEFAULT_DEVICE), wearMin: 0,
    // ПО очков: 'sdk' — наш клиент на SDK производителя (поза, камера, метки, стерео); 'stock' — очки как экран
    sw: q.get('sw') === 'stock' ? 'stock' : 'sdk', caps: null, brightAuto: true };
  const STAND = V(0, 1.68, 3.4);            // место сборщика у стапеля: для него задана раскладка окон
  let lumCd = 150;
  vision.beforeHolo = (hc) => {
    placeHud(panels.hud, hc, vision.win, vision.u.disp.value.y);
    // окна «в углу» — привязаны к голове, в плоскости виртуального экрана очков
    for (const p of mgr.panels) {
      if (p.mode !== 'corner' || !p.group.visible) continue;
      const full = p.state?.view === 'full';                         // окно «Система» полностью — по центру дисплея
      placeCorner(p, hc, vision.win, vision.u.disp.value.y, sim.device.distM, full ? 'c' : p.corner || 'tr', full ? 0.94 : 0.5);
    }
  };
  /**
   * Возможности очков в текущем режиме ПО (software.js): как держатся окна (с головой / 3DoF / 6DoF),
   * голограммы на изделии, задержка и частота дисплея, дрожание позы, кто управляет затемнением и яркостью.
   */
  function applyCaps() {
    const d = sim.device, c = sim.caps = capsFor(d, sim.sw);
    mgr.setTracking(c.windows, c.driftDegMin, STAND, 0);
    viz.setAnchored(c.holoOnPart);
    vision.latencyMs = c.windows === 'head' ? 0 : c.latencyMs;      // экран «с головой» — без задержки относительно головы
    vision.hz = c.hz;
    vision.trackNoise = c.windows === '6dof' ? { mm: c.trackMM, deg: c.trackDeg } : c.windows === '3dof' ? { mm: 0, deg: c.trackDeg * 0.4 } : null;
    // штатно очки — просто экран компьютера: одна плоская картинка по центру дисплея (окно «Система» целиком),
    // окна в цеху (КД, переход, задание) показать негде — они вернутся со своим ПО
    if (c.windows === 'head') {
      if (!sim.headSaved) { sim.headSaved = mgr.panels.filter((p) => p.mode === 'world' && p.visible); sim.headSaved.forEach((p) => mgr.toggle(p, false)); }
      panels.algo.setView('full'); cornerAlgo(true, true);
    } else if (sim.headSaved) {
      sim.headSaved.forEach((p) => mgr.toggle(p, true)); sim.headSaved = null;
      panels.algo.setView('compact');
    }
    if (sim.dimMode === 'auto' && !c.dimAuto) sim.dimMode = 'manual';
    if (c.dimAuto && sim.dimMode === 'manual' && !q.get('vision')) sim.dimMode = 'auto';
  }
  /** Выбрать очки: окно дисплея, яркость, линзы, оптика, трекинг, задержка, расстояние экрана, коррекция. */
  function setDevice(id, { quiet = false } = {}) {
    const d = deviceById.get(id) || sim.device;
    sim.device = d;
    vision.setDevice(d);
    eye.distM = d.distM;
    params.dial = Math.max(d.dial, params.dial);                  // у XREAL колеса диоптрий нет (dial 0) — только вставки
    if (!d.dimLevels) { sim.dimLevel = 0; }
    if (glasses && glasses.parent && glasses.userData.device !== d.id && (scen.state === 'intro' || scen.state === 'desk')) {
      const ng = buildGlassesModel(d.id);
      ng.position.copy(glasses.position); ng.quaternion.copy(glasses.quaternion); ng.visible = glasses.visible;
      scene.remove(glasses); scene.add(ng); glasses = ng;
    }
    applyCaps();
    markerFrames?.forEach((f) => { f.visible = false; });
    q.set('glasses', d.short);
    const dl = world.hall.dockLabel;                                     // табличка станции — по выбранным очкам
    if (dl) { dl.material.map?.dispose(); dl.material.map = textTexture(['Зарядная станция AR-очков', `${d.brand} ${d.name} · инв. 0071`], { w: 512, h: 150, size: 40 }); dl.material.needsUpdate = true; }
    if (!quiet) {
      const w = windowDeg(d);
      app.notify(`${d.brand} ${d.name}: ${d.fovDiag}° (${w.h.toFixed(0)}×${w.v.toFixed(0)}°), ${d.nits} нит, ${d.tracking === '6dof' ? '6DoF — окна и голограммы на стапеле' : '3DoF — окна вокруг головы, голограмм на изделии нет (R — по центру)'}`, 6);
    }
    $('bar') && updateBar();
    if (!$('card').hidden && $('card').dataset.kind === 'vision') { toggleCard('x'); toggleCard('vision'); }
    pushState(true);
  }
  // модель выбранных очков на зарядной станции (кабель USB-C лежит на столе; у Aura — блок вычислений)
  let glasses = buildGlassesModel(sim.device.id);
  glasses.rotation.y = Math.PI + 0.5;
  const [dx, dy, dz] = PLACES.workplace.dock;
  glasses.position.set(dx, dy + 0.067, dz);
  scene.add(glasses);
  // рамки подсветки меток стапеля (голограмма при привязке)
  const markerFrames = world.jig.markers.map((m) => {
    const f = markerFrame(0.12);
    f.rotation.x = Math.PI / 2;
    m.obj.getWorldPosition(f.position);
    f.position.z += 0.004;
    f.visible = false;
    scene.add(f);
    return f;
  });

  // ---------- сценарий ----------
  const subs = $('ui');
  subs.innerHTML = `
    <div class="reticle" id="ret"></div>
    <div class="prompt" id="prompt"></div>
    <div class="subs" id="subs"></div>
    <div class="voice pe" id="voice">
      <button id="vbtn" title="Голос: распознавание речи браузера (M)">🎤 Голос</button>
      <input id="vline" placeholder="Голосовая строка: «сборка дальше», «сборка лист два», «сборка значение 1105»… (Y)" aria-label="Голосовая команда">
      <span id="vheard"></span>
    </div>
    <div class="tablet-drawer pe" id="tdrawer" hidden>
      <div class="tablet-frame"><iframe id="tframe" title="Планшет сборщика"></iframe></div>
      <p id="tlink"></p>
    </div>
    <div class="bar pe" id="bar"></div>
    <div class="player pe" id="player" hidden>
      <div class="pl-head"><b id="pl_name"></b><span id="pl_step"></span></div>
      <div class="pl-ctl">
        <button data-pl="start" title="В начало — пустое место">⏮</button><button data-pl="back" title="Шаг назад (,)">⏪</button>
        <button data-pl="rev" id="pl_rev" title="Назад во времени — разборка (−)">◀</button><button data-pl="play" id="pl_play" class="main">▶</button>
        <button data-pl="fwd" title="Шаг вперёд (.)">⏩</button><button data-pl="end" title="В конец — изделие готово">⏭</button>
        <select id="pl_speed" title="Скорость ([ ])">${SPEEDS.map((v) => `<option value="${v}">×${String(v).replace('.', ',')}</option>`).join('')}</select>
        <input type="range" id="pl_t" min="0" max="1" step="0.01" value="0" aria-label="Время сборки">
        <button data-pl="style" id="pl_style"></button><button data-pl="close" title="Закрыть (6)">✕</button>
      </div>
    </div>
    <div class="train pe" id="train" hidden>
      <div class="tr-head"><span id="tr_n"></span><b id="tr_title"></b><span class="tr-btns"><button id="tr_guide" title="Камера ведёт по урокам (выкл. — ходите сами)">🎥</button><button id="tr_tts" title="Озвучивать уроки">🔊</button></span></div>
      <div id="tr_body"></div>
    </div>
    <div class="status" id="status"></div>
    <canvas class="map" id="map" width="440" height="300"></canvas>
    <div class="card pe" id="card" hidden></div>
    <div class="start pe" id="start"><div><b>Участок сборки монументов · КМ-2</b>
      Сборщик приходит на участок, надевает AR-очки и подходит к стапелю.
      <span class="start-dev">Очки: <select id="sdev" aria-label="Модель очков">${DEVICES.map((d) => `<option value="${d.id}">${d.brand} ${d.name} — ${d.fovDiag}°, ${d.tracking === '6dof' ? '6DoF' : '3DoF'}</option>`).join('')}</select></span>
      <span class="start-btns"><button id="sauto" class="primary">▶ Автономно: от входа до конца сборки</button><button id="sman" class="primary">🎮 Ручной режим сразу</button></span>
      <span class="start-btns small"><button id="sfree">Сразу к стапелю: сборка идёт сама, хожу сам</button><button id="sself">Сразу к стапелю, вручную</button></span>
      <small><b style="display:inline;font-size:13px">WASD</b> — ходьба, мышь — обзор, <b style="display:inline;font-size:13px">I</b> — имитация / пауза, <b style="display:inline;font-size:13px">K</b> — другие очки,
      <b style="display:inline;font-size:13px">Enter</b> — пропустить вступление, <b style="display:inline;font-size:13px">H</b> — все клавиши.</small></div></div>`;
  const say = (t) => { $('subs').textContent = t; };
  // захват мыши — только по жесту пользователя; отказ браузера не считается ошибкой
  const lockPointer = () => { if (navigator.userActivation && !navigator.userActivation.isActive) return; try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch { /* нет жеста */ } };
  const prompt = (t) => { $('prompt').textContent = t; };
  // режим сборщика: auto — сам идёт от входа к рабочему месту, надевает очки, идёт к стапелю и собирает до конца;
  // manual — управление с первого шага (WASD, E — очки, подойти к стапелю); выбор — до начала движения
  const scen = { state: 'choose', t: 0, mode: null };

  function finishIntro() {
    scen.state = 'free';
    player.mode = 'walk'; player.path = null;
    player.place(0, 3.4, 0, -0.08);
    glasses.visible = false;
    sim.glasses = 1; sim.display = 1; sim.boot = 1;
    app.aligned = true;
    mgr.setEnabled(true);
    say(''); prompt('');
  }
  function startPutOn() {
    scen.state = 'putOn'; scen.t = 0; prompt('');
    say('Сборщик берёт AR-очки с зарядной станции и надевает их');
    scen.g0 = glasses.position.clone(); scen.q0 = glasses.quaternion.clone();
  }
  function walkToJig() {
    scen.state = 'toJig';
    say('Очки включены. Сборщик идёт к стапелю СТ-3 — система ищет метки для привязки');
    player.walkPath([[-7.2, -2.4], [-5.6, 0.6], [-2.2, 3.5], [0, 3.4]], { lookAt: [0, 1.35, 0.6], onDone: () => { scen.state = 'align'; scen.t = 0; } });
  }
  function deskReached() {
    scen.state = 'desk'; scen.t = 0;
    say('Рабочее место: терминал системы, инструмент, зарядная станция AR-очков');
    prompt('E — взять и надеть AR-очки');
  }
  /** Начать смену: auto — автономно до конца сборки, manual — вручную с входа, intro — только вступление (проверки). */
  function startScenario(mode) {
    if (scen.state !== 'choose') return;
    scen.mode = mode === 'manual' ? 'manual' : 'auto';
    $('start').hidden = true;
    say('07:28. Сборщик приходит на участок сборки монументов (цех 12)');
    if (scen.mode === 'manual') {
      scen.state = 'walkIn'; scen.t = 0;
      player.mode = 'walk'; player.path = null;
      prompt('Ручной режим: WASD — идти, мышь — смотреть. Рабочее место — впереди слева, у зарядной станции очков');
      lockPointer();
    } else {
      scen.state = 'intro';
      player.walkPath([[-15, 6.5], [-10, 6.2], [-7.6, 0.5], [-7.2, -3.3]], { speed: 1.3, lookAt: [dx, dy, dz], onDone: deskReached });
      if (mode === 'auto') { auto.cam = 'guide'; auto.start(); }       // сборка начнётся сама после привязки к стапелю
    }
    pushState(true);
  }
  if (q.get('intro') === '0' || q.has('step')) finishIntro();
  else {
    const [ex, ez] = PLACES.entrance.pos;
    player.place(ex, ez, -Math.PI / 2, -0.05);
    player.mode = 'auto';                                               // стоит у входа, пока не выбран режим
    say('Выберите режим: автономно (от входа до конца сборки) или ручной');
  }

  function updateScenario(dt) {
    scen.t += dt;
    if (scen.state === 'walkIn') {                                       // вручную: дошёл до стола — можно брать очки
      if (Math.hypot(player.pos.x - dx, player.pos.z - dz) < 1.7) deskReached();
    }
    if (scen.state === 'desk' && scen.mode !== 'manual' && (scen.t > 3.5 && q.get('autoplay') !== '0')) startPutOn();
    if (scen.state === 'putOn') {
      const k = Math.min(1, scen.t / 2.6), e = k * k * (3 - 2 * k);
      // очки поднимаются со станции к лицу и разворачиваются дужками к сборщику
      const target = cam.localToWorld(V(0, -0.012, -0.05));
      glasses.position.lerpVectors(scen.g0, target, e);
      glasses.quaternion.slerpQuaternions(scen.q0, cam.quaternion, e);
      player.turnTo([dx, 1.2, dz], dt, 0.5);
      if (k >= 1) {
        glasses.visible = false;
        sim.glasses = 1;
        scen.state = 'boot'; scen.t = 0;
        say('Очки на лице: тонированные линзы, оправа на краю поля зрения, дисплей запускается');
      }
    }
    if (scen.state === 'boot') {
      sim.display = 1;
      sim.boot = Math.min(1, scen.t / 2);
      if (scen.t > 2.5) {
        if (scen.mode === 'manual') {
          scen.state = 'goJig'; scen.t = 0;
          say('Очки включены. Подойдите к стапелю СТ-3 — система найдёт метки для привязки');
          prompt('Стапель — прямо по проходу, ≈ 9 м');
        } else walkToJig();
      }
    }
    if (scen.state === 'goJig' && Math.hypot(player.pos.x, player.pos.z) < 4.2) { scen.state = 'align'; scen.t = 0; prompt(''); }
    if (scen.state === 'align' && !sim.caps.holoOnPart) {
      say(sim.caps.windows === 'head' ? `${sim.device.brand} ${sim.device.name}, штатное ПО: очки — внешний экран, окна движутся вместе с головой, привязки к стапелю нет.`
        : `${sim.device.brand} ${sim.device.name}: ${sim.caps.windows === '6dof' ? 'без своего ПО метки не читаются' : 'трекинг 3DoF — очки не видят стапель'}, привязки к меткам нет. Окна выставлены вокруг головы.`);
      if (scen.t > 2.2) { app.aligned = true; mgr.setEnabled(true); scen.state = 'free'; setTimeout(() => say(''), 7000); }
      return;
    }
    if (scen.state === 'align') {
      const n = Math.min(markerFrames.length, Math.floor(scen.t / 0.5));
      markerFrames.forEach((f, i) => { f.visible = true; f.material.color.copy(i < n ? HOLO.ok : HOLO.marker); });
      say(`Привязка к стапелю по меткам: ${n}/${markerFrames.length}`);
      if (scen.t > markerFrames.length * 0.5 + 0.8) {
        markerFrames.forEach((f) => { f.visible = false; });
        app.aligned = true;
        mgr.setEnabled(true);
        scen.state = 'free';
        say('Совмещено: 4 метки, отклонение 0,6 мм. Окна КД, задания и системы закреплены у стапеля. Щёлкните для управления.');
        setTimeout(() => say(''), 9000);
      }
    }
  }

  // ---------- ввод ----------
  const center = new THREE.Vector2(0, 0);
  const OFF = new THREE.Vector2(9, 9);                               // вне кадра камеры — луч ни во что не попадёт
  const pointerNdc = () => (player.locked ? center : (vision.screenToCamNdc(player.mouse) || OFF));
  const rayReal = new THREE.Raycaster(); rayReal.layers.set(LAYER_REAL);
  function pickReal(ndc) {
    rayReal.setFromCamera(ndc, cam);
    return rayReal.intersectObjects([world.galley.root, world.jig.root, world.hall.root, world.rack, world.cart, world.showcase.root], true).find((h) => isVisible(h.object));
  }
  function isVisible(o) { while (o) { if (!o.visible) return false; o = o.parent; } return true; }

  if (navigator.webdriver || q.has('shot')) $('start').hidden = true;
  $('sdev').value = sim.device.id;
  $('sdev').onclick = (e) => e.stopPropagation();
  $('sdev').onchange = (e) => setDevice(e.target.value);
  $('sauto').onclick = (e) => { e.stopPropagation(); startScenario('auto'); };
  $('sman').onclick = (e) => { e.stopPropagation(); startScenario('manual'); };
  // сразу к стапелю: свободное движение, сборка идёт сама, алгоритм — в углу
  $('sfree').onclick = (e) => { e.stopPropagation(); $('start').hidden = true; if (scen.state !== 'free') finishIntro(); auto.setCam('free'); auto.start(); lockPointer(); };
  $('sself').onclick = (e) => { e.stopPropagation(); $('start').hidden = true; if (scen.state !== 'free') finishIntro(); lockPointer(); };
  // щелчок мимо кнопок — ручной режим
  $('start').addEventListener('click', () => { if (scen.state === 'choose') startScenario('manual'); else { $('start').hidden = true; lockPointer(); } });
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (scen.state === 'choose') { startScenario('manual'); return; }
    $('start').hidden = true;
    const ndc = pointerNdc();
    if (mgr.startDrag(ndc)) { /* перетаскивание листа КД */ }
    const h = mgr.pointer(ndc, 'click');
    if (h?.used) return;
    if (!h && !player.locked && q.get('debug') !== 'orbit') lockPointer();
  });
  addEventListener('mouseup', () => mgr.endDrag());
  canvas.addEventListener('wheel', (e) => {
    if (tp.on) {                                                       // колесо — ближе/дальше, Shift+колесо — облёт
      if (e.shiftKey) tp.yawOff += Math.sign(e.deltaY || e.deltaX) * 0.18;
      else tp.dist = THREE.MathUtils.clamp(tp.dist * (e.deltaY > 0 ? 1.12 : 0.89), 0.9, 9);
      e.preventDefault(); return;
    }
    if (mgr.wheel(pointerNdc(), e.deltaY)) e.preventDefault();
  }, { passive: false });
  addEventListener('keydown', (e) => {
    if (mgr.key(e)) { e.preventDefault(); player.keys.clear(); player.enabled = !mgr.focus; return; }
    player.enabled = true;
    const k = e.code;
    if (scen.state !== 'free' && (k === 'Enter' || k === 'Space')) { $('start').hidden = true; finishIntro(); return; }
    if (k === 'KeyE') {
      if (scen.state === 'desk') { startPutOn(); return; }
      const hit = pickReal(pointerNdc());
      const id = hit && featureOf(hit.object);
      if (id?.startsWith('DOOR-')) { const d = world.galley.doors.get(id); d.userData.target = d.userData.target ? 0 : 1; }
    }
    if (k === 'KeyF') inspectAtGaze();
    if (k === 'Escape' || k === 'KeyQ') { if (player.mode === 'inspect') { player.exitInspect(); mgr.toggle(panels.local, false); showStep(); } }
    if (k === 'KeyN') { auto.pause(); app.next(); }
    if (k === 'KeyB') app.prev();
    if (k === 'KeyP') app.photo();
    if (k === 'KeyG') { const h = mgr.pick(pointerNdc()); if (h) mgr.pinHere(h.panel); }
    if (k === 'Digit1') mgr.toggle(panels.kd);
    if (k === 'Digit2') mgr.toggle(panels.step);
    if (k === 'Digit3') mgr.toggle(panels.sys);
    if (k === 'Digit4') mgr.toggle(panels.task);
    if (k === 'KeyT') { app.speed = { 1: 60, 60: 600, 600: 1 }[app.speed] || 60; app.notify(`Время участка ×${app.speed}`); updateBar(); }
    if (k === 'KeyO') toggleCard('vision');
    if (k === 'KeyH') toggleCard('help');
    if (k === 'KeyV') { sim.glasses = sim.glasses ? 0 : 1; sim.display = sim.glasses; mgr.setEnabled(!!sim.glasses && app.aligned); app.notify(sim.glasses ? 'Очки надеты' : 'Очки сняты'); }
    if (k === 'KeyL') act('dim_cycle');
    if (k === 'KeyZ') act('pull');
    if (k === 'KeyY' || k === 'Backquote') { e.preventDefault(); $('vline').focus(); }
    if (k === 'KeyM') voiceUi.toggle();
    if (k === 'KeyJ') toggleTablet();
    if (k === 'KeyI') act(e.shiftKey ? 'auto_stop' : 'auto_toggle');
    if (k === 'KeyK') act('device', e.shiftKey ? -1 : 1);
    if (k === 'KeyR') act('recenter');
    if (k === 'KeyX') act(e.shiftKey ? 'sys' : 'corner', e.shiftKey ? 'view' : undefined);
    if (k === 'KeyU') act('auto_cam');
    if (k === 'Digit6') act(e.shiftKey ? 'training' : 'player');
    if (k === 'Digit5') act('tp');
    // окно «Система»: 7–0 и = — вкладки, PageUp/PageDown — прокрутка
    const TAB_KEYS = { Digit7: 'algo', Digit8: 'cat', Digit9: 'kd', Digit0: 'tree', Equal: 'ctl' };
    if (TAB_KEYS[k]) act('sys', TAB_KEYS[k]);
    if (k === 'PageUp' || k === 'PageDown') { e.preventDefault(); act('sys_scroll', k === 'PageUp' ? -1 : 1); }
    // одни клавиши — для того, что запущено: виртуальная сборка (если открыта) или имитация реальными деталями
    if (!asm.open && auto.on) {
      if (k === 'Space') { e.preventDefault(); act('auto_toggle'); }
      if (k === 'Comma') act('sim_step', -1);
      if (k === 'Period') act('sim_step', 1);
      if (k === 'BracketLeft') act('sim_speed', 'down');
      if (k === 'BracketRight') act('sim_speed', 'up');
      if (k === 'Minus') act('sim_rev');
    }
    if (asm.open) {
      if (k === 'Space') { e.preventDefault(); act('player_play'); }
      if (k === 'Comma') act('player_back');
      if (k === 'Period') act('player_fwd');
      if (k === 'BracketLeft') act('player_speed', 'down');
      if (k === 'BracketRight') act('player_speed', 'up');
      if (k === 'Minus') act('player_rev');
      if (k === 'Home') act('player_start');
      if (k === 'End') act('player_end');
    }
    if (k === 'Tab') { e.preventDefault(); act('field'); }
    if (k === 'Backslash') act('zones');
    if (k === 'Semicolon') act('sw');
  });
  function featureOf(o) { while (o) { if (o.userData?.featureId) return o.userData.featureId; o = o.parent; } return null; }

  function inspectAtGaze() {
    const hit = pickReal(pointerNdc());
    if (!hit || hit.distance > 4) { app.notify('Наведите прицел на узел модуля (не дальше 4 м)'); return; }
    const pm = world.galley.root.worldToLocal(hit.point.clone());
    const near = S.featuresNear(pm.toArray(), 160).filter(({ f }) => f.kind !== 'insert' || true);
    // крепёж уголка показываем вместе с уголком; панели — в конце списка
    near.sort((a, b) => (a.f.kind === 'panel') - (b.f.kind === 'panel') || a.dist - b.dist);
    const steps = [...new Map(near.slice(0, 8).flatMap(({ f }) => stepsForFeature(f.id)).map((s) => [s.id, s])).values()];
    app.local = { point: pm.toArray(), features: near.slice(0, 12), steps, focus: null };
    const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : null;
    player.startInspect(hit.point, n);
    // окно «В этой точке» — справа от линии взгляда в позе осмотра, лицом к глазу
    const I = player.inspect;
    const fwd = hit.point.clone().sub(I.target).normalize();
    const right = V().crossVectors(fwd, V(0, 1, 0)).normalize();
    const pos = I.target.clone().addScaledVector(fwd, 0.62).addScaledVector(right, 0.27).add(V(0, 0.02, 0));
    panels.local.placeAt(pos, I.target);
    mgr.toggle(panels.local, true);
    panels.local.state.scroll = 0; panels.local.dirty = true;
    viz.show(null, { features: near.slice(0, 6).map((x) => x.f.id), focus: pm.toArray() });
    if (!sim.caps.holoOnPart) app.notify(`${sim.device.name} (${sim.caps.label}): список элементов есть, но голограммы на узле не показать — очки не знают, где узел`, 5);
  }

  // ---------- единый диспетчер: клавиатура, голос, планшет ----------
  const PANEL_OF = { kd: panels.kd, task: panels.task, system: panels.sys, step: panels.step, local: panels.local, algo: panels.algo };
  /** Алгоритм в углу поля зрения: вкл/выкл; side — сменить угол (справа/слева). */
  function cornerAlgo(on = !panels.algo.visible, quiet = false) {
    const a = panels.algo;
    if (a.mode !== 'corner') { a.mode = 'corner'; }
    mgr.toggle(a, on);
    if (!quiet) app.notify(on ? `Окно «Система» закреплено на экране${a.state.view === 'full' ? ' — полностью' : ` в ${a.corner === 'tl' ? 'левом' : 'правом'} верхнем углу`} (X — скрыть, Shift+X — компактно/полностью)` : 'Окно «Система» скрыто (X — показать)');
    updateBar();
  }
  const VIEW_NOTE = {
    field: 'Поле зрения: полное, ≈ 200° (два глаза, естественная проекция: вертикали прямые, центр в натуральную величину). Tab — центр 72°',
    center: 'Поле зрения: центр 72° (как на мониторе, с периферией глаза). Tab — без периферии',
    clean: 'Без периферии: видна только зона прямого зрения, периферия плавно затемнена (самый быстрый). Tab — прямой обзор',
    direct: 'Прямой обзор — как съёмка через линзу очков: прямое зрение ±30° и краешек периферии (≈ 90°), окно дисплея и окна — крупнее. Tab — полное поле',
  };
  const VIEW_LABEL = { field: 'Поле 200°', center: 'Центр 72°', clean: 'Без периферии', direct: 'Прямой обзор' };
  const say2 = (text, voice) => { app.notify(text, 4); if (voice && sim.tts) speak(text); };
  function fmtLeft(m) { const h = Math.floor(m / 60), mm = Math.round(m % 60); return h ? `${h} ч ${mm} мин` : `${mm} мин`; }
  function act(cmd, arg = null, src = 'клавиатура') {
    const voice = src === 'голос';
    switch (cmd) {
      case 'next': if (activeSt && !asm.open) { if (auto.st === activeSt) auto.pause(); app.stationAct(activeSt, 'next'); break; } auto.pause(); app.next(); break;
      case 'prev': if (activeSt && !asm.open) { if (auto.st === activeSt) auto.pause(); app.stationAct(activeSt, 'prev'); break; } auto.pause(); app.prev(); break;
      case 'repeat': { const s = run.step; showStep(); say2(`${s.id}. ${s.title}. ${s.text[0] || ''}`, voice); break; }
      case 'photo': if (activeSt) { vision.u.flash.value = 1; app.notify(`Фото ${activeSt.step?.id || ''} (${activeSt.short}) — в журнал`); break; } app.photo(); break;
      case 'goto_place': {
        const P = { jig: [0, 3.4, 0], desk: [-7.2, -3.2, Math.PI], showcase: [-9.5, -3.4, 0] };
        for (const st of stations) { const f = V(0, 0, 2.6).applyAxisAngle(V(0, 1, 0), st.root.rotation.y).add(st.center); P[st.id] = [f.x, f.z, st.root.rotation.y]; }
        const t = P[arg]; if (!t) break;
        if (scen.state !== 'free') { $('start').hidden = true; finishIntro(); }
        if (player.mode === 'inspect') player.exitInspect();
        player.path = null; player.mode = 'walk'; player.place(t[0], t[1], t[2], -0.15);
        app.notify(`Переход: ${({ jig: 'стапель СТ-3', desk: 'рабочее место', showcase: 'витрина очков' })[arg] || stations.find((s) => s.id === arg)?.short}`, 3);
        break;
      }
      case 'value': {
        if (activeSt && activeSt.step?.check) {
          const x = parseFloat(String(arg ?? '').replace(',', '.')), c = activeSt.step.check;
          if (!Number.isFinite(x)) break;
          const ok = Math.abs(x - c.nominal) <= c.tol + 1e-9;
          if (ok) activeSt.values[activeSt.step.id] = x;
          app.notify(`${c.name}: ${String(x).replace('.', ',')} ${c.unit} — ${ok ? 'в допуске' : 'ВНЕ допуска, сообщите мастеру'}`, 4);
          activeSt.panel.dirty = true; break;
        }
        app.value(arg); break;
      }
      case 'ok': app.notify('Отмечено: норма'); break;
      case 'reject': app.sendChat(`Брак на переходе ${run.step.id}: остановил работу`); app.notify('Брак: мастер уведомлён', 4); break;
      case 'timer': { const t = run.activeTimers()[0]; say2(t ? `${t.label}: осталось ${fmtLeft(run.remaining(t))}` : 'Активных таймеров нет', voice); break; }
      case 'open_kd': app.openKD(app.kd.code, app.kd.sheet, app.kd.zone); break;
      case 'kd_sheet': { const d = docByCode.get(app.kd.code); app.kd.sheet = Math.max(1, Math.min(d?.sheets.length || 1, Number(arg) || 1)); app.kdFit(); mgr.toggle(panels.kd, true); break; }
      case 'kd_next': app.kdSheet(1); break;
      case 'kd_prev': app.kdSheet(-1); break;
      case 'kd_zone': app.openKD(app.kd.code, app.kd.sheet, arg); break;
      case 'zoom_in': app.kdZoom(1.4); break;
      case 'zoom_out': app.kdZoom(0.7); break;
      case 'kd_fit': app.kdFit(); break;
      case 'overlay': app.kdOverlay(); break;
      case 'open_task': mgr.toggle(panels.task, true); break;
      case 'open_chat': mgr.toggle(panels.task, true); break;
      case 'open_system': mgr.toggle(panels.sys, true); break;
      case 'open_step': mgr.toggle(panels.step, true); break;
      case 'show': if (PANEL_OF[arg]) mgr.toggle(PANEL_OF[arg], true); break;
      case 'close': if (PANEL_OF[arg]) mgr.toggle(PANEL_OF[arg], false); else { const h = mgr.pick(center); if (h) mgr.toggle(h.panel, false); } break;
      case 'toggle': if (PANEL_OF[arg]) { mgr.toggle(PANEL_OF[arg]); updateBar(); } break;
      case 'search': {
        const res = searchDocs(String(arg || ''));
        app.openSystem(String(arg || ''));
        if (res[0] && res[0].kind !== 'ТП') app.openKD(res[0].code, 1);
        say2(res.length ? `Найдено ${res.length}: ${res[0].code}` : `Не найдено: ${arg}`, voice);
        break;
      }
      case 'open_doc': app.openKD(arg.code, arg.sheet || 1, arg.zone || null); break;
      case 'preview': app.setPreview(arg); break;
      case 'goto': if (stepById.has(arg)) { auto.pause(); run.goto(arg); } break;
      case 'inspect': inspectAtGaze(); break;
      case 'exit': if (player.mode === 'inspect') { player.exitInspect(); mgr.toggle(panels.local, false); showStep(); } break;
      // затемнение — ступенями устройства (VITURE: 40 → 20 → 8 → 0,5 %, XREAL One: 3 режима; Air 2 Ultra — нет)
      case 'dim_more': case 'dim_less': case 'dim_cycle': {
        const d = sim.device;
        if (!d.dimLevels) { app.notify(`${d.name}: электрохромного затемнения нет (${d.dimNote})`); break; }
        const cur = sim.dimMode === 'auto' ? -1 : dimStepOf(d, sim.dimLevel);
        const n = d.dimLevels.length;
        let i = cmd === 'dim_more' ? Math.min(n - 1, cur + 1) : cmd === 'dim_less' ? Math.max(0, cur - 1) : cur + 1;
        if (cmd === 'dim_cycle' && i >= n) { act('dim_auto'); break; }
        sim.dimMode = 'manual'; sim.dimLevel = dimLevelOfStep(d, Math.max(0, i));
        app.notify(`Затемнение: ступень ${Math.max(0, i) + 1}/${n}, пропускание ${(transmitAt(d, sim.dimLevel) * 100).toFixed(1).replace('.0', '')} %`);
        break;
      }
      case 'dim_auto': if (sim.device.dimLevels && !sim.caps.dimAuto) app.notify(sim.sw === 'stock' ? 'Штатное ПО: затемнение только кнопкой на очках — автомата нет' : `${sim.device.name}: SDK не управляет затемнением — только кнопкой на очках`, 5);
        else if (sim.device.dimLevels) { sim.dimMode = 'auto'; app.notify('Затемнение: авто по освещённости'); } else app.notify('Затемнения нет у этих очков'); break;
      case 'dim_set': sim.dimMode = 'manual'; sim.dimLevel = sim.device.dimLevels ? THREE.MathUtils.clamp(Number(arg) || 0, 0, 1) : 0; break;
      case 'auto_start': auto.start(); break;
      case 'auto_free': auto.setCam('free'); if (!auto.on) auto.start(); break;
      case 'tp_on': setTP(true); break;
      case 'tp_off': setTP(false); break;
      case 'auto_guide': auto.setCam('guide'); if (!auto.on) auto.start(); break;
      case 'auto_cam': auto.setCam(auto.cam === 'free' ? 'guide' : 'free'); break;
      case 'corner': cornerAlgo(arg === 'on' ? true : arg === 'off' ? false : undefined); break;
      case 'sys': {
        // окно «Система»: показать/скрыть, полностью/компактно, вкладка
        const a = panels.algo;
        if (arg === 'hide') { cornerAlgo(false); break; }
        if (arg === 'show') { cornerAlgo(true, true); break; }
        if (arg === 'view') { a.setView(a.state.view === 'full' ? 'compact' : 'full'); cornerAlgo(true, true); app.notify(a.state.view === 'full' ? 'Окно «Система» — полностью: Алгоритм · Каталог · КД · Дерево · Управление' : 'Окно «Система» — компактно в углу'); break; }
        if (arg === 'full' || arg === 'compact') { a.setView(arg); cornerAlgo(true, true); break; }
        if (['algo', 'cat', 'kd', 'tree', 'ctl'].includes(arg)) { a.state.tab = arg; a.setView('full'); cornerAlgo(true, true); a.dirty = true; break; }
        break;
      }
      case 'sys_catalog': act('sys', 'cat'); break;
      case 'sys_tree': act('sys', 'tree'); break;
      case 'sys_control': act('sys', 'ctl'); break;
      case 'sys_full': act('sys', 'full'); break;
      case 'sys_compact': act('sys', 'compact'); break;
      case 'sys_hide': act('sys', 'hide'); break;
      case 'sys_load': {
        const a = findAlgorithm(app.catalog, arg);
        if (!a) { act('sys', 'cat'); say2('Какой алгоритм? Открыл каталог', voice); break; }
        Object.assign(panels.algo.state, { sel: a.id, pick: null, tab: 'algo' }); panels.algo.state.scroll.algo = null;
        act('sys', 'algo'); say2(`Загружен алгоритм: ${a.title}`, voice); break;
      }
      case 'places': toggleCard('places'); break;
      case 'ptr': case 'ptr_tap': case 'ptr_scroll': {
        // указатель со смартфона: окно «Система» показывается, курсор ведётся пальцем, касание — нажатие
        const a = panels.algo;
        if (!a.visible) cornerAlgo(true, true);
        a.phonePointer(cmd === 'ptr' ? 'move' : cmd === 'ptr_tap' ? 'tap' : 'scroll', arg || {});
        return true;                                                   // без рассылки состояния на каждое движение
      }
      case 'corner_side': panels.algo.corner = panels.algo.corner === 'tl' ? 'tr' : 'tl'; cornerAlgo(true); break;
      case 'auto_pause': if (asm.open) asm.pause(); else auto.pause(true); break;
      case 'tp': setTP(arg == null ? undefined : !!arg); break;
      case 'training': startTraining(arg == null ? undefined : !!arg); break;
      case 'player': case 'player_close': togglePlayer(cmd === 'player_close' ? false : arg == null ? undefined : !!arg); break;
      case 'player_play': if (!asm.open) togglePlayer(true); else asm.toggle(); break;
      case 'player_rev': if (asm.open) asm.reverse(); break;
      case 'player_back': if (asm.open) asm.stepBy(-1); break;
      case 'player_fwd': if (asm.open) asm.stepBy(1); break;
      case 'player_start': if (asm.open) asm.toStart(); break;
      case 'player_end': if (asm.open) asm.toEnd(); break;
      case 'player_speed': if (asm.open) { if (typeof arg === 'number') asm.setSpeed(arg); else asm.faster(arg === 'down' ? -1 : 1); } break;
      case 'player_style': if (asm.open && asm.target.setStyle) { asm.target.setStyle(asm.target.style === 'glasses' ? 'holo' : 'glasses'); asm.apply(true); playerUi(); app.notify(asm.target.style === 'glasses' ? 'Голограмма — только в окне дисплея очков, как в настоящих AR-очках' : 'Голограмма видна целиком (вид симулятора)', 4); } break;
      case 'auto_stop': auto.stop(); break;
      case 'sim_speed': if (auto.on) auto.setRate(arg === 'down' ? -1 : arg === 'up' ? 1 : Number(arg) || 1); break;
      case 'sim_rev': if (auto.on) auto.reverse(); break;
      case 'sim_step': if (auto.on) auto.stepBy(Number(arg) || 1); break;
      case 'sys_scroll': { const a = panels.algo; if (!a.visible) cornerAlgo(true, true); a.onWheel?.(Number(arg) || 1, null, a); a.dirty = true; break; }
      case 'auto_toggle': if (auto.on && !auto.paused) auto.pause(true); else auto.start(); break;
      case 'inspect_glasses': {
        // подойти к витрине и рассмотреть модель выбранных очков вблизи
        const m = world.showcase.models.get(arg && deviceById.has(arg) ? deviceById.get(arg).id : sim.device.id);
        const p = m.getWorldPosition(V());
        auto.pause();
        if (player.mode === 'inspect') { player.inspect = null; }
        player.path = null; player.mode = 'walk';
        player.place(p.x, p.z + 0.95, 0, -0.35);
        player.update(0);
        player.startInspect(p.clone().add(V(0, 0.015, 0)), V(0.3, 0.3, 1).normalize(), 0.2);
        const d = deviceById.get(m.userData.device);
        app.notify(`${d.brand} ${d.name}: ${d.optics}; ${d.weightG} г. Мышь — осмотр, Esc — выход`, 6);
        break;
      }
      case 'view_clean': case 'view_field': case 'view_center': case 'view_direct': act('field', cmd.slice(5), src); break;
      case 'field': {
        // Tab: полное поле → центр 72° → без периферии → …
        const order = ['field', 'center', 'clean', 'direct'];
        const want = arg == null ? order[(order.indexOf(vision.view) + 1) % order.length] : arg === true || arg === '1' ? 'field' : arg === false || arg === '0' ? 'center' : arg;
        vision.setView(want);
        app.notify(VIEW_NOTE[vision.view], 5); updateBar(); break;
      }
      case 'zones': sim.zones = !sim.zones; app.notify(sim.zones ? 'Схема зон: фовеа 2°, 5°, 10°, 30° (центр), 60° (периферия); зелёным — границы полей глаз; красным/синим — видит только правый/левый глаз; белым — линзы' : 'Схема зон скрыта', 7); break;
      case 'recenter': app.notify(mgr.recenter() ? 'Окна — по центру взгляда' : 'Окна закреплены у стапеля (6DoF) — центрировать не нужно'); break;
      case 'device': {
        const i = DEVICES.indexOf(sim.device);
        const id = typeof arg === 'number' ? DEVICES[(i + arg + DEVICES.length) % DEVICES.length].id : deviceById.has(arg) ? arg : matchDevice(arg);
        if (id) setDevice(id); else app.notify(`Нет профиля очков: ${arg}`);
        break;
      }
      case 'sw_stock': act('sw', 'stock', src); break;
      case 'sw_sdk': act('sw', 'sdk', src); break;
      case 'sw': {
        sim.sw = arg === 'stock' || arg === 'sdk' ? arg : sim.sw === 'sdk' ? 'stock' : 'sdk';
        applyCaps(); q.set('sw', sim.sw);
        const c = sim.caps;
        app.notify(c.mode === 'stock'
          ? `Штатное ПО: ${sim.device.name} — ${c.windows === 'head' ? 'внешний экран, окна движутся с головой' : '3DoF-якорь экрана в очках'}; голограмм на изделии нет, затемнение и яркость — кнопками`
          : `Своё ПО на SDK: ${sim.device.name} — ${c.windows === '6dof' ? `6DoF${c.markers ? ', метки стапеля, голограммы на изделии' : ''}` : '3DoF вокруг головы'}, ${c.latencyMs} мс, ${c.hz} Гц${c.hands ? ', жесты' : ''}`, 7);
        if (scen.state === 'free' && app.aligned) mgr.setEnabled(true);
        updateBar(); if (!$('card').hidden && $('card').dataset.kind === 'vision') { toggleCard('x'); toggleCard('vision'); }
        break;
      }
      case 'bright_up': sim.brightAuto = false; sim.bright = Math.min(1, sim.bright + 0.15); app.notify(`Яркость дисплея ${Math.round(sim.bright * sim.device.nits)} нит`); break;
      case 'bright_down': sim.brightAuto = false; sim.bright = Math.max(0.2, sim.bright - 0.15); app.notify(`Яркость дисплея ${Math.round(sim.bright * sim.device.nits)} нит`); break;
      case 'bright_set': sim.bright = THREE.MathUtils.clamp(Number(arg) || 1, 0.2, 1); break;
      case 'pin': { const h = mgr.pick(center); if (h) mgr.pinHere(h.panel); break; }
      case 'pull': { const h = (arg && PANEL_OF[arg] && { panel: PANEL_OF[arg] }) || mgr.pick(center); if (h?.panel) app.notify(mgr.pull(h.panel) ? 'Окно ближе — для чтения' : 'Окно на месте'); break; }
      case 'follow': { const h = mgr.pick(center); if (h) { h.panel.mode = h.panel.mode === 'follow' ? 'world' : 'follow'; h.panel.dirty = true; } break; }
      case 'call': app.sendChat(`Прошу подойти к стапелю СТ-3: переход ${run.step.id}`); app.notify('Мастер вызван'); break;
      case 'message': if (arg) { app.sendChat(String(arg)); app.notify('Сообщение отправлено'); } break;
      case 'preset': if (PRESETS[arg]) { Object.assign(params, { light: 1, eyes: 'both', domEye: 'R' }, PRESETS[arg]); params.dial = Math.max(sim.device.dial, params.dial); sim.dimLevel = sim.device.dimLevels ? params.dim : 0; } break;
      case 'light': params.light = THREE.MathUtils.clamp(Number(arg) || 1, 0.3, 3); break;
      case 'glasses': sim.glasses = sim.glasses ? 0 : 1; sim.display = sim.glasses; mgr.setEnabled(!!sim.glasses && app.aligned); break;
      case 'speed': app.speed = Number(arg) || 60; break;
      case 'help': say2(`Скажите: ${PHRASES.slice(0, 6).join(', ')}`, voice); toggleCard('voice'); break;
      case 'listen': voiceUi.armed = performance.now() + 6000; app.notify('Слушаю…'); break;
      case 'stop': voiceUi.stop(); break;
      default: return false;
    }
    panels.step.dirty = true;
    pushState(true);
    return true;
  }
  app.act = act;

  // ---------- голос: распознавание браузера или голосовая строка ----------
  const voiceUi = {
    rec: null, armed: 0, last: '',
    handle(alts, src = 'голос') {
      const arr = [].concat(alts);
      const armed = performance.now() < voiceUi.armed;
      for (const text of arr) {
        const p = parseGalley(text) || (armed ? parseGalley(text, { requireWake: false }) : null);
        if (p) {
          voiceUi.last = `«${text}» → ${p.cmd}${p.arg != null ? ` ${typeof p.arg === 'object' ? '' : p.arg}` : ''}`;
          $('vheard').textContent = voiceUi.last;
          if (p.cmd !== 'listen') voiceUi.armed = 0;
          act(p.cmd, p.arg, src);
          link.send('state', { heard: voiceUi.last });
          return true;
        }
      }
      $('vheard').textContent = `«${arr[0]}» — не команда`;
      return false;
    },
    toggle() {
      if (!voiceUi.rec) voiceUi.rec = createRecognizer({
        onPhrase: (alts) => voiceUi.handle(alts),
        onInterim: (t) => { $('vheard').textContent = `… ${t}`; },
        onState: (st) => { $('vbtn').setAttribute('aria-pressed', String(st.on)); if (st.error) $('vheard').textContent = `микрофон: ${st.error} — используйте голосовую строку`; },
      });
      if (!voiceUi.rec) { $('vheard').textContent = 'Распознавание речи недоступно в этом браузере — голосовая строка ниже или планшет'; $('vline').focus(); return; }
      voiceUi.rec.active ? voiceUi.rec.stop() : voiceUi.rec.start();
    },
    stop() { voiceUi.rec?.stop(); },
  };

  // ---------- планшет: связь и состояние ----------
  const link = createLink({ role: 'glasses', room: q.get('room') || 'ST3', ws: q.get('ws') });
  link.on('cmd', (m) => { act(m.cmd, m.arg, m.src === 'голос' ? 'голос' : 'планшет'); if (m.cmd !== 'value' && !m.cmd.startsWith('ptr')) app.notify(`Планшет: ${m.label || m.cmd}`, 2); });
  link.on('voice', (m) => voiceUi.handle(m.alts || [m.text], 'голос'));
  link.on('hello', () => pushState(true));
  let lastState = '', lastPush = 0, lastBeat = 0;
  function pushState(force = false) {
    const now = performance.now();
    if (!force && now - lastPush < 500) return;
    lastPush = now;
    const s = run.step, pv = app.preview ? stepById.get(app.preview) : null;
    const st = {
      clock: app.plantClock(), speed: app.speed, aligned: app.aligned, glasses: !!sim.glasses,
      step: { id: s.id, op: s.op, title: s.title, kind: s.kind, text: s.text.map((t) => trimText(t, 160)).slice(0, 4),
        check: s.check, photo: s.photo, critical: s.critical, need: run.needs(), value: run.values[s.id] ?? null, kd: s.kd.slice(0, 2) },
      preview: pv ? { id: pv.id, title: pv.title } : null,
      index: run.index, total: STEPS.length,
      timers: run.activeTimers().slice(0, 3).map((t) => ({ label: trimText(t.label, 40), left: Math.round(run.remaining(t)), total: Math.round(t.endMin - t.startMin), blocking: t.blocking })),
      chat: app.chat.slice(-4).map((m) => ({ from: m.from, text: trimText(m.text, 140), time: m.time, mine: !!m.mine })),
      kd: { code: app.kd.code, sheet: app.kd.sheet, zone: app.kd.zone, zoom: Math.round(app.kd.zoom * 10) / 10 },
      panels: Object.fromEntries(Object.entries(PANEL_OF).map(([k, p]) => [k, !!p.visible])),
      dim: { mode: sim.dimMode, level: Math.round(sim.dimLevel * 100) / 100, t: Math.round(transmitAt(sim.device, sim.dimLevel) * 1000) / 1000 }, bright: sim.bright, light: params.light, lux: Math.round(lumCd * 5),
      device: sim.device.id, auto: { on: auto.on, paused: auto.paused, cam: auto.cam, rate: auto.rate, dir: auto.dir, place: auto.st ? auto.st.short : 'Стапель СТ-3' },
      station: activeSt ? { name: activeSt.short, step: activeSt.done ? 'готово' : `${activeSt.step.id} ${activeSt.step.title}`, k: activeSt.index, n: activeSt.steps.length } : null,
      asm: asm?.open ? { name: asm.target.name, t: Math.round(asm.t * 100) / 100, n: asm.n, playing: asm.playing, speed: asm.speed, dir: asm.dir, step: asm.current.step ? `${asm.current.step.id} ${asm.current.step.title}` : '' } : null,
      inspect: app.local && player.mode === 'inspect' ? app.local.features.slice(0, 4).map(({ f }) => trimText(`${f.designation || f.id} — ${f.name || ''}`, 70)) : null,
      heard: voiceUi.last,
    };
    const js = JSON.stringify(st);
    if (!force && js === lastState && now - lastBeat < 1500) return;      // сердцебиение для планшета — раз в 1,5 с
    lastBeat = now;
    lastState = js;
    link.send('state', st);
  }

  // ---------- карточки: модель зрения, клавиши ----------
  // голосовая строка и кнопка микрофона
  $('vbtn').onclick = (e) => { e.stopPropagation(); voiceUi.toggle(); };
  $('vline').addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { const t = e.target.value.trim(); if (t) voiceUi.handle([t.toLowerCase().startsWith('сборка') ? t : `сборка ${t}`], 'голос'); e.target.value = ''; }
    if (e.key === 'Escape') e.target.blur();
  });
  // планшет в выдвижной панели (та же страница в режиме #tablet; связь — BroadcastChannel)
  function toggleTablet() {
    const d = $('tdrawer');
    d.hidden = !d.hidden;
    if (!d.hidden && !$('tframe').src) {
      const base = location.href.split('#')[0];
      $('tframe').src = /\/galley\.html/.test(base) ? base.replace(/galley\.html/, 'tablet.html') : `${base}#tablet`;
      const ext = /\/galley\.html/.test(base) ? base.replace(/galley\.html.*/, `tablet.html?room=${q.get('room') || 'ST3'}${q.get('ws') ? `&ws=${encodeURIComponent(q.get('ws'))}` : ''}`) : `${base}#tablet`;
      $('tlink').textContent = `На отдельном планшете: ${ext}${q.get('ws') ? '' : ' (между устройствами — через сервер участка: &ws=ws://сервер:8080, или общей ссылкой артефакта)'}`;
    }
  }

  function toggleCard(kind) {
    const c = $('card');
    if (!c.hidden && c.dataset.kind === kind) { c.hidden = true; return; }
    c.dataset.kind = kind; c.hidden = false;
    if (kind === 'voice') {
      c.innerHTML = `<h3>Голосовое управление</h3><p class="note">Слово активации — «сборка». Распознавание: кнопка 🎤 (речь браузера, нужен микрофон),
        голосовая строка внизу (Y) или микрофон планшета. На очках в цеху — офлайн Vosk, тот же словарь.</p>
        <div class="presets">${PHRASES.map((p) => `<button data-ph="${p}">${p}</button>`).join('')}</div>`;
      c.querySelectorAll('[data-ph]').forEach((b) => b.onclick = () => voiceUi.handle([b.dataset.ph], 'голос'));
      return;
    }
    if (kind === 'places') {
      const rows = [['jig', 'Стапель СТ-3 · модуль КМ-2', `${run.index}/${STEPS.length}`], ['desk', 'Рабочее место сборщика', ''], ['showcase', 'Витрина AR-очков', ''],
        ...stations.map((st) => [st.id, st.short, `${Math.min(st.index, st.steps.length)}/${st.steps.length}`])];
      c.innerHTML = `<h3>Участки цеха</h3><div class="presets devs">${rows.map(([id, t, k]) => `<button data-go="${id}">${t}<small>${k ? `переходов: ${k}` : ''}</small></button>`).join('')}</div>
        <p class="note">Рядом с участком (≤ 4,5 м) его окно появляется в очках; N/B, голос и кнопки окна ведут переходы участка, 6 — виртуальная сборка его изделия.</p>`;
      c.querySelectorAll('[data-go]').forEach((b) => b.onclick = () => { act('goto_place', b.dataset.go); c.hidden = true; });
      return;
    }
    if (kind === 'help') {
      c.innerHTML = `<h3>Управление</h3><table>${[
        ['WASD / стрелки', 'ходьба; Shift — быстрее; C — присесть'], ['мышь', 'обзор (щелчок — захват; ПКМ — без захвата)'], ['щелчок по окну', 'кнопки, поля, листы КД'],
        ['колесо над КД', 'зум к точке; перетаскивание — сдвиг листа'], ['F', 'осмотр точки узла + локальный алгоритм; Esc/Q — назад'], ['E', 'взаимодействие: очки, дверцы'],
        ['N / B', 'переход вперёд / назад'], ['P', 'фото в журнал'], ['G', 'закрепить окно перед глазами'], ['1–4', 'окна КД / переход / система / задание'],
        ['Tab', 'вид: полное поле ≈ 200° / центр 72° / без периферии / прямой обзор'], ['\\', 'схема зон поля зрения'],
        ['I', 'имитация сборки реальными деталями — на месте, где стоите: запуск / пауза; Shift+I — стоп'],
        ['6', 'виртуальная сборка из голограмм: открыть / закрыть'],
        ['Shift+6', 'обучающая сборка: цветная учебная модель, уроки с подписями деталей, советами и предупреждениями'],
        ['Пробел', 'пауза / пуск — виртуальной сборки (если открыта) или имитации'], ['[ ]', 'скорость ×0,25 … ×8'],
        ['−', 'направление: вперёд / назад во времени (разборка)'], [', .', 'шаг назад / вперёд'], ['Home / End', 'виртуальная сборка: в начало / в конец'], ['5', 'вид от третьего лица (колесо — ближе/дальше)'], ['U', 'имитация: камера ведёт / хожу сам'], ['X', 'окно «Система» на экране: показать / скрыть; Shift+X — компактно / полностью'], ['7 8 9 0 =', 'вкладки окна: Алгоритм, Каталог, КД, Дерево, Управление'], ['PgUp / PgDn', 'прокрутка окна'], ['K', 'другие очки (Shift+K — назад)'], ['R', '3DoF: окна по центру взгляда'],
        ['T', 'ускорение времени участка ×1 / ×60 / ×600'], ['L', 'затемнение линз по ступеням очков → авто'], ['V', 'снять / надеть очки'], ['O', 'модель зрения'], ['Enter', 'пропустить вступление'],
      ].map(([a, b]) => `<tr><td><kbd>${a}</kbd></td><td>${b}</td></tr>`).join('')}</table>`;
      return;
    }
    const sl = (key, label, min, max, step, fmt = (v) => v) => `<label>${label}<b id="v_${key}">${fmt(params[key] ?? sim[key])}</b><input type="range" id="r_${key}" min="${min}" max="${max}" step="${step}" value="${params[key] ?? sim[key]}"></label>`;
    const dv = sim.device, wd = windowDeg(dv);
    c.innerHTML = `<h3>Очки</h3>
      <div class="presets devs">${DEVICES.map((d) => `<button data-dev="${d.id}" aria-pressed="${d === dv}">${d.brand} ${d.name}<small>${d.fovDiag}° · ${d.nits} нит · ${d.tracking === '6dof' ? '6DoF' : '3DoF'}</small></button>`).join('')}</div>
      <div class="note dev"><b>${dv.brand} ${dv.name}</b> — ${deviceSummary(dv)}.<br>Оптика: ${dv.optics}. Затемнение: ${dv.dimNote}. Камеры: ${dv.cameras}.
      ${dv.dial ? `Колесо диоптрий до ${dv.dial} дптр.` : 'Колеса диоптрий нет — близоруким нужны линзы-вставки.'} Экран ≈ ${dv.distM} м.<br>
      Окно КД 1,2 × 0,86 м видно целиком с ${fitDistance(dv, 1.2, 0.864).toFixed(2).replace('.', ',')} м (окно ${wd.h.toFixed(0)}×${wd.v.toFixed(0)}°). ${dv.note}
      ${dv.estimates.length ? `<br><i>Оценка (не опубликовано): ${dv.estimates.join(', ')}.</i>` : ''}
      <br>Источники: ${dv.sources.map((u, i) => `<a href="${u}" target="_blank" rel="noopener">[${i + 1}]</a>`).join(' ')}</div>
      <h3>ПО очков <small>(клавиша ;)</small></h3>
      <div class="presets"><button data-sw="stock" aria-pressed="${sim.sw === 'stock'}">Штатное ПО<small>очки как экран + кнопки</small></button><button data-sw="sdk" aria-pressed="${sim.sw === 'sdk'}">Своё ПО на SDK<small>наш клиент: поза, камера, метки</small></button></div>
      <table class="swcmp"><tr><th></th><th>штатное</th><th>своё ПО</th></tr>${compareRows(dv).map(([k, a, b]) => `<tr><td>${k}</td><td>${a}</td><td>${b}</td></tr>`).join('')}</table>
      <div class="note dev">${sim.caps.note}${sim.caps.unsure.length ? `<br><i>Уточнить по SDK: ${sim.caps.unsure.join('; ')}.</i>` : ''}</div>
      <div class="presets"><button id="b_insp">🔍 Рассмотреть модель ${dv.brand} ${dv.name} на витрине</button></div>
      <h3>Два глаза и поле зрения</h3>
      <div class="presets">
        <button data-fm="field" aria-pressed="${vision.view === 'field'}">Полное поле ≈ 200°</button><button data-fm="center" aria-pressed="${vision.view === 'center'}">Центр 72°</button><button data-fm="clean" aria-pressed="${vision.view === 'clean'}">Без периферии</button><button data-fm="direct" aria-pressed="${vision.view === 'direct'}">Прямой обзор</button>
        <button id="b_zones" aria-pressed="${!!sim.zones}">Схема зон</button></div>
      <div class="presets">${[['both', 'Оба глаза'], ['L', 'Только левый'], ['R', 'Только правый']].map(([k, t]) => `<button data-eyes="${k}" aria-pressed="${params.eyes === k}">${t}</button>`).join('')}
        ${[['R', 'Ведущий правый'], ['L', 'Ведущий левый']].map(([k, t]) => `<button data-dom="${k}" aria-pressed="${params.domEye === k}">${t}</button>`).join('')}</div>
      ${sl('ipd', 'Межзрачковое расстояние, мм', 54, 74, 1)}
      <label>Показать физиологическое двоение (мозг его подавляет — по умолчанию выкл.)<input type="checkbox" id="r_diplo" ${params.diplo ? 'checked' : ''}></label>
      <div class="note">Апертура ${dv.name} для каждого глаза: к носу ${vision.aperture.nasal.toFixed(0)}°, к виску ${vision.aperture.temporal.toFixed(0)}°,
        вверх ${vision.aperture.up.toFixed(0)}°, вниз ${vision.aperture.down.toFixed(0)}° (поле глаза: к носу 60°, к виску 100°, вверх 58°, вниз 72°).
        Вне линз — открытая периферия без затемнения, рамка и дужки — размытые, у самого глаза.</div>
      <h3>Модель зрения в очках</h3>
      <div class="presets">${Object.entries(PRESETS).map(([k, p]) => `<button data-p="${k}" aria-pressed="${q.get('vision') === k}">${p.label}</button>`).join('')}</div>
      ${sl('age', 'Возраст, лет', 18, 65, 1)}${sl('refraction', 'Рефракция глаза, дптр', -4, 2, 0.25)}
      <label>Оптические вставки (коррекция мира)<input type="checkbox" id="r_inserts" ${params.inserts ? 'checked' : ''}></label>
      ${dv.dial ? sl('dial', 'Колесо диоптрий дисплея, дптр', dv.dial, 0, 0.25) : ''}${dv.dimLevels ? sl('dim', `Затемнение линз (${dv.dimNote})`, 0, 1, 0.05) : ''}
      ${sl('bright', 'Яркость дисплея', 0.2, 1.5, 0.05)}${sl('dirt', 'Загрязнение линз', 0, 1, 0.05)}${sl('fatigue', 'Усталость', 0, 1, 0.05)}
      ${sl('ipdErr', 'Ошибка межзрачкового, мм', 0, 8, 0.5)}${sl('light', 'Освещённость участка', 0.3, 2.5, 0.05)}
      <label>Окклюзия голограмм по датчику глубины<input type="checkbox" id="r_occ" ${sim.occlusion ? 'checked' : ''}></label>
      <div class="note">Фокус глаза: <b id="v_focus"></b> · зрачок <b id="v_pupil"></b> · диапазон аккомодации <b id="v_amp"></b>.
      Дисплей виден на ≈ ${dv.distM} м: при работе вблизи голограммы теряют резкость (конфликт вергенции и аккомодации).
      Вес ${dv.weightG} г: усталость за смену <b id="v_wear"></b>.</div>`;
    c.querySelectorAll('[data-dev]').forEach((b) => b.onclick = () => setDevice(b.dataset.dev));
    $('b_insp').onclick = () => act('inspect_glasses');
    c.querySelectorAll('[data-sw]').forEach((b) => b.onclick = () => act('sw', b.dataset.sw));
    c.querySelectorAll('[data-fm]').forEach((b) => b.onclick = () => { act('field', b.dataset.fm); toggleCard('x'); toggleCard('vision'); });
    $('b_zones').onclick = () => { act('zones'); toggleCard('x'); toggleCard('vision'); };
    c.querySelectorAll('[data-eyes]').forEach((b) => b.onclick = () => { params.eyes = b.dataset.eyes; toggleCard('x'); toggleCard('vision'); });
    c.querySelectorAll('[data-dom]').forEach((b) => b.onclick = () => { params.domEye = b.dataset.dom; toggleCard('x'); toggleCard('vision'); });
    $('r_diplo').onchange = (e) => { params.diplo = e.target.checked ? 1 : 0; };
    c.querySelectorAll('[data-p]').forEach((b) => b.onclick = () => { act('preset', b.dataset.p); q.set('vision', b.dataset.p); toggleCard('x'); toggleCard('vision'); });
    c.querySelectorAll('input[type=range]').forEach((r) => r.oninput = () => {
      const key = r.id.slice(2); const v = Number(r.value);
      if (key in sim) sim[key] = v; else params[key] = v;
      if (key === 'dim') { sim.dimLevel = v; sim.dimMode = 'manual'; }
      if (key === 'ipd') { vision.ipdMM = v; vision.setDevice(sim.device); }
      $(`v_${key}`).textContent = v;
    });
    $('r_inserts').onchange = (e) => { params.inserts = e.target.checked; };
    $('r_occ').onchange = (e) => { sim.occlusion = e.target.checked; };
  }
  $('player').querySelectorAll('[data-pl]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); act(`player_${b.dataset.pl}`); });
  $('pl_t').oninput = (e) => { asm.pause(); asm.seek(Number(e.target.value)); };
  $('pl_t').onmousedown = (e) => e.stopPropagation();
  $('pl_speed').onchange = (e) => asm.setSpeed(Number(e.target.value));
  $('pl_speed').onmousedown = (e) => e.stopPropagation();
  function updateBar() {
    const a = auto.on && !auto.paused;
    $('bar').innerHTML = [
      [a ? '⏸ Пауза имитации (I)' : auto.on ? '▶ Продолжить имитацию (I)' : '▶ Имитация сборки (I)', 'auto', a ? 'on' : 'primary'],
      ...(auto.on ? [['⏹', 'stop', '']] : []),
      [auto.cam === 'free' ? '🚶 Хожу сам (U)' : '🎥 Камера ведёт (U)', 'cam', auto.cam === 'free' ? 'on' : ''],
      [panels.algo.visible ? '▣ Система (X)' : '□ Система (X)', 'corner', panels.algo.visible ? 'on' : ''],
      [asm.open && !asm.target.training ? '⏹ Закрыть виртуальную сборку (6)' : '🧩 Виртуальная сборка (6)', 'asm', asm.open && !asm.target.training ? 'on' : ''],
      [asm.target?.training ? '⏹ Закрыть обучение (⇧6)' : '🎓 Обучение (⇧6)', 'train', asm.target?.training ? 'on' : ''],
      [tp.on ? '👁 От первого лица (5)' : '🧍 Вид от третьего лица (5)', 'tp', tp.on ? 'on' : ''],
      [activeSt ? `📍 ${activeSt.short.split(' · ')[0]}` : '📍 Участки', 'places', activeSt ? 'on' : ''],
      [`👓 ${sim.device.brand} ${sim.device.name} (K)`, 'dev', ''],
      [`⚙ ${sim.caps?.mode === 'stock' ? 'Штатное ПО' : 'Своё ПО (SDK)'} (;)`, 'sw', sim.caps?.mode === 'stock' ? 'on' : ''],
      [`👁 ${VIEW_LABEL[vision.view]} (Tab)`, 'field', vision.view !== 'center' ? 'on' : ''], ['Клавиши (H)', 'help', ''], ['Зрение (O)', 'vision', ''], ['Окна 1–4', 'win', ''],
      [`Время ×${app.speed} (T)`, 'time', ''], ['Очки (V)', 'glasses', ''], ['Планшет (J)', 'tablet', ''], ['Голос', 'voice', ''],
    ].map(([t, k, c]) => `<button data-b="${k}" class="${c}">${t}</button>`).join('');
    $('bar').querySelectorAll('button').forEach((b) => b.onclick = (e) => {
      e.stopPropagation();
      const k = b.dataset.b;
      if (k === 'auto') act('auto_toggle'); if (k === 'stop') act('auto_stop');
      if (k === 'cam') act('auto_cam'); if (k === 'corner') act('corner'); if (k === 'field') act('field'); if (k === 'asm') act('player'); if (k === 'train') act('training'); if (k === 'tp') act('tp'); if (k === 'places') toggleCard('places');
      if (k === 'dev') toggleCard('vision'); if (k === 'sw') act('sw');
      if (k === 'help') toggleCard('help'); if (k === 'vision') toggleCard('vision');
      if (k === 'win') for (const p of [panels.kd, panels.step, panels.sys, panels.task]) mgr.toggle(p, true);
      if (k === 'time') { app.speed = { 1: 60, 60: 600, 600: 1 }[app.speed] || 60; updateBar(); }
      if (k === 'glasses') dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV' }));
      if (k === 'tablet') toggleTablet();
      if (k === 'voice') toggleCard('voice');
    });
  }

  // ---------- вид от третьего лица: модель сборщика с очками, кабелем и блоком ----------
  const worker = buildWorker(sim.device.id);
  worker.root.visible = false;
  scene.add(worker.root);
  const tpCam = new THREE.PerspectiveCamera(55, 1, 0.05, 120);
  const tp = { on: q.get('tp') === '1', dist: 2.6, yawOff: 0.35, cam: new THREE.Vector3(), look: new THREE.Vector3(), holo: false };
  function setTP(on = !tp.on) {
    tp.on = on;
    worker.root.visible = on; if (!on && worker.cable) worker.cable.visible = false;
    app.notify(on ? 'Вид от третьего лица: сборщик в очках, кабель к блоку. Колесо — ближе/дальше, Shift+колесо — облёт, 5 — от первого лица' : 'Вид от первого лица (глаза сборщика)', 5);
    updateBar();
  }
  function renderTP(dt) {
    worker.setDevice(sim.device.id);
    worker.setPose({ pos: player.pos, yaw: player.mode === 'inspect' ? player.yaw : player.yaw, pitch: player.pitch, phase: player.phase, speed: player.speed || 0,
      crouch: Math.max(0, Math.min(1, (player.eyeStand - player.eye) / 0.56)), lean: player.mode === 'inspect' ? 0.8 : 0, worn: !!sim.glasses, t: performance.now() / 1000 });
    if (worker.cable) worker.cable.visible = true;
    // камера: за правым плечом, плавно; при осмотре — сбоку от узла
    const yaw = player.yaw + tp.yawOff;
    const want = V(player.pos.x + Math.sin(yaw) * tp.dist, 1.75 + tp.dist * 0.18, player.pos.z + Math.cos(yaw) * tp.dist);
    // смотреть на голову и грудь сборщика; если камера сзади — чуть вперёд, туда, куда смотрит он
    const look = V(player.pos.x, 1.42 + player.pitch * 0.25, player.pos.z).addScaledVector(V(-Math.sin(player.yaw), 0, -Math.cos(player.yaw)), 0.7 * Math.max(0, Math.cos(tp.yawOff)));
    const k = 1 - Math.exp(-dt * 5);
    if (tp.cam.lengthSq() === 0) { tp.cam.copy(want); tp.look.copy(look); }
    tp.cam.lerp(want, k); tp.look.lerp(look, k);
    tpCam.position.copy(tp.cam); tpCam.lookAt(tp.look);
    tpCam.aspect = innerWidth / innerHeight; tpCam.updateProjectionMatrix();
    tpCam.layers.set(LAYER_REAL); tpCam.layers.enable(LAYER_LABEL); if (tp.holo) tpCam.layers.enable(LAYER_HOLO);
    renderer.setRenderTarget(null);
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.62;
    renderer.render(scene, tpCam);
    renderer.toneMapping = THREE.NoToneMapping;
  }

  // ---------- плеер виртуальной сборки (без реальных деталей): стапель и участки ----------
  asm = new AssemblyPlayer();
  const galleyAsm = galleyTarget(world, viz, {
    onBegin: () => { auto.pause(); app.notify('Виртуальная сборка: реальных деталей нет — изделие собирается из голограмм на месте настоящих. Пробел — пуск/пауза, , . — по шагу, [ ] — скорость, − — назад во времени, 6 — закрыть', 7); },
    onEnd: () => { applyState(); showStep(); viz.setAnchored(sim.caps.holoOnPart); },
  });
  // обучающая сборка: учебная цветная модель, уроки с пояснениями, советами и предупреждениями, 10 с на урок
  const tr = { tts: q.get('tts') !== '0', lastSaid: -1, guide: q.get('trguide') !== '0', lastFocus: -1 };
  const trainingAsm = trainingTarget(world, viz, {
    onBegin: () => { auto.pause(); app.notify('Обучающая сборка КМ-2: детали — цветные полупрозрачные, у деталей — номера позиций. Пробел — пауза, , . — урок назад/вперёд, ⇧6 — закрыть', 7); },
    onEnd: () => { $('train').hidden = true; applyState(); showStep(); viz.setAnchored(sim.caps.holoOnPart); },
    onLesson: (L, i) => { trainCard(L, i); trainPlace(L, i); },
  });
  const esc = (x) => String(x).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const ACT_RU = { install: 'установка', fasten: 'крепёж', glue: 'клей', seal: 'герметик', degrease: 'обезжиривание', brush: 'клей кистью', film: 'плёнка',
    wire: 'монтаж', paint: 'окраска', wait: 'выдержка', check: 'контроль', inspect: 'осмотр', intro: 'подготовка' };
  function trainCard(L, i) {
    const el = $('train');
    el.hidden = false;
    const n = trainingAsm.lessons.length;
    $('tr_n').textContent = L ? `Урок ${i + 1}/${n} · ${L.id} · ${ACT_RU[L.action] || L.action}${L.place === 'table' ? ' · стол подготовки' : ''}` : `Готово: ${n}/${n}`;
    $('tr_title').textContent = L ? L.title : 'Модуль КМ-2 собран. Обучение завершено';
    $('tr_tts').textContent = tr.tts ? '🔊' : '🔇';
    if (!L) { $('tr_body').innerHTML = '<p class="tr-ok">Все уроки пройдены. Повторить — ⏮, закрыть — ⇧6.</p>'; return; }
    const li = (a, cls) => a.map((x) => `<li class="${cls}">${esc(x)}</li>`).join('');
    $('tr_body').innerHTML = `${L.critical ? '<p class="tr-crit">● Ответственный переход: контроль мастера ОТК</p>' : ''}
      <ul class="tr-ex">${li(L.explain, '')}</ul>
      ${L.labels?.length ? `<p class="tr-parts">${L.labels.map((x) => `<span>${esc(x.text)}</span>`).join('')}</p>` : ''}
      ${L.check ? `<p class="tr-chk">📏 Замер: ${esc(L.check.name)} — ${L.check.nominal ?? ''}${L.check.tol != null ? ` ± ${L.check.tol}` : ''}${L.check.unit ? ` ${esc(L.check.unit)}` : ''}</p>` : ''}
      ${L.timer ? `<p class="tr-chk">⏱ ${esc(L.timer.label)}</p>` : ''}
      <ul class="tr-w">${li(L.warns, 'w')}</ul><ul class="tr-t">${li(L.tips, 't')}</ul>`;
    if (tr.tts && asm.playing && asm.dir > 0 && tr.lastSaid !== i) { tr.lastSaid = i; speak([L.title, L.explain[0], ...L.warns.slice(0, 1)].filter(Boolean).join('. ')); }
  }
  $('tr_guide').onclick = (e) => { e.stopPropagation(); tr.guide = !tr.guide; $('tr_guide').classList.toggle('off', !tr.guide); if (tr.guide) { tr.lastFocus = -1; trainPlace(null, asm.current.i); } else { player.path = null; player.mode = 'walk'; } app.notify(tr.guide ? 'Камера ведёт по урокам' : 'Свободный обзор: ходите сами (WASD, мышь)', 3); };
  $('tr_tts').onclick = (e) => { e.stopPropagation(); tr.tts = !tr.tts; $('tr_tts').textContent = tr.tts ? '🔊' : '🔇'; if (!tr.tts) speechSynthesis?.cancel?.(); };
  /**
   * Камера ведёт по урокам: сборщик подходит к месту работы урока (стол подготовки, вырез раковины, уголки…)
   * и смотрит на него; при перемотке — переносится сразу. Выключить — 🎥 в карточке, дальше ходите сами.
   */
  function trainPlace(L, i) {
    if (!tr.guide) return;
    const { p, dist, table } = trainingAsm.focusOf(i);
    const x = table ? p.x : THREE.MathUtils.clamp(p.x, -0.75, 0.75), z = table ? p.z + dist : Math.max(p.z + dist, 1.45);
    if (Math.hypot(x - player.pos.x, z - player.pos.z) < 0.25 && tr.lastFocus === i) return;
    tr.lastFocus = i;
    if (player.mode === 'inspect') player.exitInspect();
    const look = [p.x, p.y, p.z];
    if (asm.playing && asm.dir > 0 && Math.hypot(x - player.pos.x, z - player.pos.z) < 6) player.walkPath([[x, z]], { speed: 0.9, lookAt: look });
    else {
      player.path = null; player.mode = 'walk';
      const d = V(p.x - x, p.y - player.eye, p.z - z);
      player.place(x, z, Math.atan2(-d.x, -d.z), Math.atan2(d.y, Math.hypot(d.x, d.z)));
    }
  }
  function startTraining(on = !asm.target?.training) {
    if (!on) { if (asm.target?.training) asm.close(); updateBar(); return; }
    if (asm.open) asm.close();
    auto.pause();
    tr.lastSaid = -1; tr.lastFocus = -1;
    asm.openFor(trainingAsm, 0); asm.play(1);
    updateBar();
  }
  const asmTargets = () => [{ t: galleyAsm, at: V(0, 0, 0) }, ...(world.stations || []).map((st) => ({ t: st.asm, at: st.center }))];
  function nearestAsmTarget() {
    const p = player.pos; let best = null, bd = Infinity;
    for (const x of asmTargets()) { const d = Math.hypot(p.x - x.at.x, p.z - x.at.z); if (d < bd) { bd = d; best = x.t; } }
    return best;
  }
  let barTraining = false;
  function playerUi() {
    const el = $('player');
    el.hidden = !asm.open;
    if (!asm.target?.training) $('train').hidden = true;
    if (barTraining !== !!asm.target?.training) { barTraining = !!asm.target?.training; updateBar(); }
    if (!asm.open) return;
    const { i, f, step } = asm.current;
    $('pl_name').textContent = asm.target.name;
    $('pl_play').textContent = asm.playing ? '⏸' : '▶';
    $('pl_play').title = asm.playing ? 'Пауза (пробел)' : 'Пуск (пробел)';
    $('pl_rev').setAttribute('aria-pressed', String(asm.dir < 0));
    $('pl_t').max = asm.n; $('pl_t').value = asm.t;
    $('pl_speed').value = String(asm.speed);
    $('pl_style').textContent = asm.target.style === 'glasses' ? 'Вид: только в очках' : 'Вид: видна целиком';
    $('pl_step').textContent = i >= asm.n ? `Готово: ${asm.n}/${asm.n} — изделие собрано` : `${step.id} · ${step.title} — ${Math.round(f * 100)} % · ${i + 1}/${asm.n}`;
  }
  asm.on(() => { playerUi(); pushState(true); });
  /** Виртуальная сборка на месте алгоритма (стапель или участок): переход туда и плеер. */
  app.virtualAt = (place) => {
    const want = place === 'jig' ? galleyAsm : stations.find((s) => s.id === place)?.asm;
    if (!want) return;
    if (asm.open) asm.close();
    auto.pause();
    if (nearestAsmTarget() !== want) act('goto_place', place);
    asm.openFor(want, 0); asm.play(1);
  };
  function togglePlayer(on = !asm.open) {
    if (!on) { asm.close(); return; }
    const t = nearestAsmTarget() || galleyAsm;
    auto.pause();
    asm.openFor(t, 0);
    asm.play(1);
  }

  // ---------- имитация сборки: сборщик сам выполняет переходы ТП ----------
  // Каждый переход: голограмма перехода (≈ 3 с) → взгляд на место → действие: деталь со стеллажа/тележки
  // переносится на место по дуге, замер вводится (норма ± доля допуска), фото в журнал, выдержка клея —
  // ускоренно (часы участка «проматываются», таймер виден) → «выполнено» и следующий переход.
  const FLY_KINDS = new Set(['panel', 'bracket', 'fitting', 'equipment', 'trim', 'decor', 'door', 'hinge', 'latch', 'plumbing', 'sheet', 'sink', 'faucet', 'siphon', 'valve', 'light', 'handle', 'placard', 'retainer', 'stdunit', 'trolley', 'turnbutton']);
  const auto = {
    on: false, paused: false, phase: 'show', t: 0, fly: null, ff: false, rate: 1, dir: 1,
    // guide — камера ведёт к месту работы; free — сборщик ходит и смотрит сам, сборка идёт своим ходом
    // по умолчанию имитация персонажем не управляет: сборка идёт сама, сборщик ходит где хочет
    cam: q.get('autocam') === 'guide' ? 'guide' : 'free',
    st: null,                                   // участок, на котором идёт имитация (null — стапель СТ-3)
    /** Где запускать: ближайшее место к сборщику — стапель или участок. */
    pickStation() {
      if (scen.state !== 'free') return null;
      const p = player.pos; let best = null, bd = Math.hypot(p.x, p.z);
      for (const st of stations) { const d = Math.hypot(p.x - st.center.x, p.z - st.center.z); if (d < bd) { bd = d; best = st; } }
      return best;
    },
    setCam(c) {
      this.cam = c;
      if (c === 'free') {
        if (player.mode === 'auto' && this.phase === 'move') { player.path = null; player.mode = 'walk'; this.phase = 'show'; }
        if (!panels.algo.visible) cornerAlgo(true, true);
        app.notify('Имитация: свободное движение — ходите и смотрите сами (WASD, мышь); алгоритм — в углу поля зрения. U — камера ведёт', 6);
      } else app.notify('Имитация: камера ведёт к месту работы. U — свободное движение', 4);
      updateBar(); pushState(true);
    },
    phaseLabel() {
      const tail = `${this.rate !== 1 ? ` · ×${String(this.rate).replace('.', ',')}` : ''}${this.dir < 0 ? ' · ◀ назад' : ''}`;
      return this.phaseText() + tail;
    },
    phaseText() {
      if (this.dir < 0) return `${this.st ? this.st.short.split(' · ')[0] : 'стапель'}: разборка по шагам`;
      if (this.st) { const s = this.st.step; return s ? `${this.st.short.split(' · ')[0]}: ${s.id} — ${{ show: 'голограмма', act: 'выполнение', done: 'контроль' }[this.phase] || ''}` : 'готово'; }
      if (this.cam === 'free' && this.phase === 'show') return `переход ${run.step.id} — голограмма (свободно)`; return { show: `переход ${run.step.id} — голограмма`, move: 'подход к месту', act: `переход ${run.step.id} — выполнение`, fly: `установка ${this.fly?.ids?.join(', ') || ''}`, wait: 'выдержка (ускорено)' }[this.phase] || ''; },
    start() {
      if (scen.state === 'choose') { startScenario('auto'); return; }
      if (!this.on) { this.phase = 'show'; this.t = 0; this.st = this.pickStation(); this.begun = false; this.dir = 1; }
      this.on = true; this.paused = false;
      if (scen.state === 'free') this.begin();
      else app.notify('Имитация сборки начнётся после вступления (Enter — пропустить)', 4);
      updateBar(); pushState(true);
    },
    begin() {
      this.begun = true;
      if (!panels.algo.visible) cornerAlgo(true, true);            // закреплённое окно: ход имитации и кнопка «Стоп»
      if (this.st) {
        const st = this.st;
        if (st.done) { st.index = 0; st.values = {}; }
        st.apply(st.index, 0); st.panel.dirty = true;
        app.notify(`Имитация сборки: ${st.short} — ${st.product}, с перехода ${st.step.id}. Можно ходить где угодно; стоп — кнопкой в окне «Система» (или Shift+I)`, 6);
        return;
      }
      if (player.mode === 'inspect' && this.cam === 'guide') { player.exitInspect(); mgr.toggle(panels.local, false); }
      mgr.toggle(panels.step, true);
      if (this.cam === 'free' && !panels.algo.visible) cornerAlgo(true, true);
      app.preview = null; showStep();
      app.notify(`Имитация сборки на стапеле СТ-3: с перехода ${run.step.id}. Ходите где угодно; I — пауза, стоп — кнопкой в окне «Система»`, 5);
    },
    pause(byUser = false) {
      if (!this.on || this.paused) return;
      this.paused = true;
      if (this.fly) this.finishFly();
      if (this.st) { this.st.apply(this.st.index, 0); this.phase = 'show'; this.t = 0; }
      if (byUser) app.notify('Имитация на паузе — I продолжить');
      updateBar(); pushState(true);
    },
    stop() {
      if (!this.on) return;
      if (this.fly) this.finishFly();
      if (this.st) { this.st.apply(this.st.index, 0); this.st.panel.dirty = true; }
      this.on = false; this.paused = false; this.begun = false; this.st = null;
      app.notify('Имитация остановлена'); updateBar(); pushState(true);
    },
    /** Точка внимания перехода (мир): центр деталей / соединений / крепежа. */
    focusOf(s) {
      const ids = [...s.parts, ...s.joints, ...s.fasteners].filter((id) => S.featureById.has(id));
      const c = V();
      if (!ids.length) c.set(0, s.kind === 'paint' || s.kind === 'film' ? 1200 : 1000, 400);
      else { for (const id of ids) c.add(V(...S.featureCenter(S.featureById.get(id)))); c.divideScalar(ids.length); }
      return world.galley.root.localToWorld(c);
    },
    startFly(s) {
      const st = stateFrom(run.index, run.done);
      const ids = s.parts.filter((id) => { const f = S.featureById.get(id); return f && FLY_KINDS.has(f.kind) && world.galley.items.has(id) && !st.installed.has(id); }).slice(0, 4);
      if (!ids.length) return false;
      const groot = world.galley.root;
      this.fly = { ids, t: 0, its: ids.map((id) => {
        const o = world.galley.items.get(id);
        const src = viz.sourceOf(id);
        const kit = world.kit.get(id);
        if (kit) kit.visible = false;
        const f = S.featureById.get(id);
        const c = S.featureCenter(f);
        const off = groot.worldToLocal(src.clone()).sub(V(...c));
        o.visible = true;
        return { o, p0: o.position.clone(), off };
      }) };
      return true;
    },
    /** restore — вернуть изделие к состоянию по ТП (пауза посреди переноса); иначе деталь остаётся на месте. */
    finishFly(restore = true) {
      for (const it of this.fly.its) it.o.position.copy(it.p0);
      this.fly = null;
      if (restore) applyState();
    },
    next() {
      const i = run.index;
      const r = run.next();
      if (r) return;
      this.phase = 'show'; this.t = 0;
      if (run.index === i) { this.on = false; this.begun = false; app.notify('Имитация: все переходы задания выполнены — предъявить ОТК', 8); updateBar(); }
    },
    update(dt) {
      if (!this.on || this.paused || scen.state !== 'free') return;
      if (!this.begun) this.begin();
      if (this.dir < 0) { this.updateBack(dt); return; }
      if (this.st) { this.updateStation(dt); return; }
      const s = run.step;
      if (!s) return;
      this.t += dt * this.rate;
      const focus = this.fly ? new THREE.Box3().setFromObject(this.fly.its[0].o).getCenter(V()) : this.focusOf(s);
      // сначала взгляд на окно перехода (прочитать), затем — на место работы
      const look = this.phase === 'show' && this.t < 1.6 && panels.step.group.visible ? panels.step.group.getWorldPosition(V()) : focus;
      const guide = this.cam === 'guide';
      if (guide && player.mode === 'walk' && !player.keys.size) player.turnTo([look.x, look.y, look.z], dt, 2.4);
      if (this.phase === 'show') {
        // подойти к месту работы, если сборщик далеко или место сбоку модуля
        if (guide && this.t < dt * 1.5 && player.mode === 'walk') {
          const want = V(THREE.MathUtils.clamp(focus.x, -1.3, 1.3), 0, 3.0);
          if (Math.hypot(player.pos.x - want.x, player.pos.z - want.z) > 0.6) {
            this.phase = 'move';
            player.walkPath([[want.x, want.z]], { speed: 1.1, lookAt: [focus.x, focus.y, focus.z], onDone: () => { if (this.phase === 'move') { this.phase = 'show'; this.t = dt * 2; } } });
            return;
          }
        }
        if (this.t > 4.2) { this.phase = 'act'; this.t = 0; }
        return;
      }
      if (this.phase === 'move') return;
      if (this.phase === 'fly') {
        const F = this.fly;
        F.t += dt * this.rate;
        const k = Math.min(1, F.t / 1.5), e = k * k * (3 - 2 * k);
        for (const it of F.its) {
          it.o.position.copy(it.p0).addScaledVector(it.off, 1 - e);
          it.o.position.y += Math.sin(Math.PI * e) * 260;
        }
        if (k >= 1) { this.finishFly(false); this.phase = 'act'; this.t = 0; this.flown = true; }
        return;
      }
      if (this.phase === 'wait') {
        const tm = run.blockingTimer();
        if (!tm) { this.phase = 'act'; this.t = 0; return; }
        run.tick(Math.max(run.remaining(tm) * Math.min(1, dt * 1.2 * this.rate), (dt * this.rate * app.speed) / 60) + 1e-3);
        return;
      }
      // act: одно действие в ≈ 0,9 с
      if (this.t < 0.9) return;
      this.t = 0;
      const need = run.needs();
      if (need === 'timer') { const tm = run.blockingTimer(); app.notify(`Выдержка «${tm.label}»: ${fmtLeft(run.remaining(tm))} — ускорено в имитации`, 3); this.phase = 'wait'; return; }
      if (!this.flown && ['install', 'fasten', 'wire'].includes(s.kind) && this.startFly(s)) { this.phase = 'fly'; return; }
      if (need === 'value') {
        const c = s.check;
        const v = c.min != null || c.max != null ? ((c.min ?? c.max) + (c.max ?? c.min)) / 2 : c.nominal + (Math.random() * 0.8 - 0.4) * (c.tol || 0);
        app.value(Math.round(v * 100) / 100);
        return;
      }
      if (need === 'photo') { app.photo(); return; }
      this.next();
    },
  };
  /** Имитация на участке: голограмма перехода → выполнение реальными деталями (детали подлетают, станки
   *  работают, провода растут) → контроль (замер в допуске, фото) → следующий переход. */
  auto.updateStation = function (dt) {
    const st = this.st;
    if (st.done) { app.notify(`Имитация: ${st.short} — все переходы выполнены, ${st.product} готово`, 6); this.on = false; this.begun = false; this.st = null; updateBar(); pushState(true); return; }
    this.t += dt * this.rate;
    const s = st.step;
    if (this.phase === 'show') { if (this.t > 2.6) { this.phase = 'act'; this.t = 0; } return; }
    if (this.phase === 'act') {
      const f = Math.min(1, this.t / 3.6);
      st.apply(st.index, f);
      if (f >= 1) { this.phase = 'done'; this.t = 0; }
      return;
    }
    if (this.t < 0.8) return;
    if (s.check && !(s.id in st.values)) {
      const c = s.check, v = Math.round((c.nominal + (Math.random() - 0.5) * 0.8 * c.tol) * 100) / 100;
      st.values[s.id] = v;
      app.notify(`${st.short.split(' · ')[0]}: ${c.name} ${String(v).replace('.', ',')} ${c.unit} — в допуске`, 3);
    }
    if (s.photo) { vision.u.flash.value = 1; app.notify(`Фото ${s.id} (${st.short.split(' · ')[0]}) — в журнал`, 2); }
    st.next(); st.panel.dirty = true;
    this.phase = 'show'; this.t = 0;
    pushState(true);
  };
  /** Назад во времени: переходы откатываются по одному (на участке детали «уходят» обратно). */
  auto.updateBack = function (dt) {
    this.t += dt * this.rate;
    const atStart = () => { this.paused = true; this.dir = 1; this.phase = 'show'; this.t = 0; app.notify('Имитация: дошли до начала — пауза (направление снова вперёд)', 4); updateBar(); pushState(true); };
    if (this.st) {
      const st = this.st;
      if (this.phase !== 'back') { if (st.index <= 0) { atStart(); return; } this.phase = 'back'; this.t = 0; }
      const f = Math.max(0, 1 - this.t / 2.4);
      st.apply(st.index - 1, f);
      if (f <= 0) { st.prev(); st.panel.dirty = true; this.phase = 'show'; this.t = 0; pushState(true); }
      return;
    }
    if (this.fly) this.finishFly();
    if (this.t < 2.2) return;
    this.t = 0;
    const i = run.index;
    app.prev();
    if (run.index === i) atStart();
  };
  /** Скорость имитации: ×0,25 … ×8 (k = +1 / −1 — на ступень, число — точно). */
  auto.setRate = function (k) {
    const i = SPEEDS.indexOf(this.rate);
    this.rate = k === 1 || k === -1 ? SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, (i < 0 ? 2 : i) + k))] : k;
    app.notify(`Имитация: скорость ×${String(this.rate).replace('.', ',')}`, 2); updateBar(); pushState(true);
  };
  auto.reverse = function () {
    this.dir = -this.dir; this.phase = 'show'; this.t = 0;
    if (this.st) this.st.apply(this.st.index, 0);
    app.notify(this.dir < 0 ? 'Имитация: назад во времени — переходы откатываются (разборка)' : 'Имитация: вперёд', 3); updateBar(); pushState(true);
  };
  /** Шаг вручную в имитации (на паузе): d = +1 — следующий переход, −1 — предыдущий. */
  auto.stepBy = function (d) {
    this.pause();
    if (this.st) {
      const st = this.st;
      if (d > 0) { const s = st.step; if (s?.check && !(s.id in st.values)) st.values[s.id] = s.check.nominal; st.next(); } else st.prev();
      st.panel.dirty = true;
    } else if (d > 0) { run.next(); } else app.prev();
    pushState(true);
  };
  app.simInfo = () => (auto.on ? { paused: auto.paused, place: auto.st ? auto.st.short : 'Стапель СТ-3', st: auto.st, rate: auto.rate, dir: auto.dir } : null);
  /** Подсказка клавиш для окна «Система» — по тому, что запущено. */
  app.hotkeys = () => (asm?.open ? 'Виртуальная: Пробел — пуск/пауза · [ ] — скорость · − — назад · , . — шаг · Home/End · 6 — закрыть'
    : auto.on ? 'Имитация: Пробел — пауза · [ ] — скорость · − — назад · , . — шаг · Shift+I — стоп'
      : 'I — имитация здесь · 6 — виртуальная сборка · X / Shift+X — окно · 7 8 9 0 = — вкладки');
  run.on((e) => { if (e.event === 'step') auto.flown = false; });
  app.autoInfo = () => (auto.on ? (auto.paused ? 'ИМИТАЦИЯ: пауза' : `▶ ИМИТАЦИЯ · ${auto.phaseLabel()}`) : null);

  // ---------- мини-карта ----------
  const map = $('map').getContext('2d');
  function drawMap() {
    const W = 440, H = 300, sx = W / 40, sz = H / 26;
    const X = (x) => (x + 20) * sx, Z = (z) => (z + 13) * sz;
    map.clearRect(0, 0, W, H);
    map.fillStyle = 'rgba(88,230,255,0.06)'; map.fillRect(0, 0, W, H);
    map.fillStyle = 'rgba(160,190,200,0.35)';
    for (const c of world.colliders) map.fillRect(X(c.x0), Z(c.z0), (c.x1 - c.x0) * sx, (c.z1 - c.z0) * sz);
    map.strokeStyle = '#ffc845'; map.strokeRect(X(-1.25), Z(-0.8), 2.5 * sx, 1.6 * sz);
    map.fillStyle = '#ffc845'; map.font = '600 18px "IBM Plex Sans", sans-serif'; map.fillText('СТ-3', X(-1.1), Z(-1.0));
    map.fillStyle = '#9fd6e8'; map.fillText('рабочее место', X(-10.5), Z(-5.4)); map.fillText('вход', X(-19.5), Z(5.5));
    map.fillStyle = '#ffc845'; for (const st of stations) map.fillText(st.short.split(' · ')[0].replace('Участок ', ''), X(st.center.x - 1), Z(st.center.z));
    const p = player.pos, yaw = player.yaw;
    map.save(); map.translate(X(p.x), Z(p.z)); map.rotate(-yaw);
    map.fillStyle = '#5dffa8'; map.beginPath(); map.moveTo(0, -12); map.lineTo(7, 8); map.lineTo(-7, 8); map.closePath(); map.fill();
    map.restore();
  }

  // ---------- отладочная камера ----------
  const debug = q.get('debug') === 'orbit';
  let orbit = null;
  if (debug) { orbit = new OrbitControls(cam, canvas); cam.position.set(3, 2, 3.5); orbit.target.set(0, 1, 0); }

  function resize() {
    renderer.setSize(innerWidth, innerHeight, false);
    cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix();
    vision.setSize(innerWidth, innerHeight, renderer.getPixelRatio());
  }
  addEventListener('resize', resize); resize();

  // ---------- кадр ----------
  const eyeOnV = new THREE.Vector2(1, 1);
  const gazeRay = new THREE.Raycaster();
  gazeRay.layers.set(LAYER_REAL);
  let gaze = { dist: 2, holo: false }, frame = 0, last = performance.now(), chatIdx = 0;
  const lights = [world.hall.key, world.hall.task];
  const baseI = lights.map((l) => l.intensity);
  renderer.setAnimationLoop((now) => {
    const rawDt = Math.max(0, (now - last) / 1000);
    const dt = Math.min(0.1, rawDt); last = now;
    perf.ema += (Math.min(rawDt, 1) - perf.ema) * 0.1;
    if (frame > 30) {
      // адаптивное качество: долгий кадр (> 90 мс) 3 с подряд — по ступеням: тени реже, периферия через кадр,
      // затем разрешение полного поля ниже
      perf.slow = perf.ema > 0.09 ? perf.slow + rawDt : 0;
      if (perf.slow > 3) {
        perf.slow = 0;
        if (perf.shadowEvery < 3) perf.shadowEvery = 3;
        else if (vision.fieldMode && !vision.faceSkip) { vision.faceSkip = true; app.notify('Полное поле: дальняя периферия обновляется через кадр (слабая видеокарта)', 3); }
        else if (vision.fieldMode && (vision.quality ?? 1) > 0.31) { vision.setQuality((vision.quality ?? 1) * 0.75); app.notify(`Полное поле: качество снижено до ${Math.round(vision.quality * 100)} % (слабая видеокарта)`, 3); }
        else if (!perf.hinted && vision.view !== 'clean') { perf.hinted = true; app.notify('Тормозит? Tab — режим «без периферии»: он самый быстрый', 5); }
      }
    }
    const t = now / 1000;
    tickHolo(t);
    if (frame % perf.shadowEvery === 0) renderer.shadowMap.needsUpdate = true;
    if (debug) orbit.update(); else player.update(dt);
    updateScenario(dt);
    // время участка и таймеры
    run.tick((dt * app.speed) / 60);
    while (chatIdx < CHAT_SCRIPT.length && run.clockMin >= CHAT_SCRIPT[chatIdx].at) { const m = CHAT_SCRIPT[chatIdx++]; app.chat.push({ from: m.from, text: m.text, time: app.plantClock() }); }
    // дверцы — плавно
    for (const d of world.galley.doors.values()) {
      const tgt = (d.userData.target || 0) * (S.DOORS.find((x) => x.id === featureOf(d)).hinge === 'L' ? -1.75 : 1.75);
      d.rotation.y += (tgt - d.rotation.y) * (1 - Math.exp(-dt * 4));
    }
    lights.forEach((l, i) => { l.intensity = baseI[i] * params.light; });
    // электрохромное затемнение «авто»: по освещённости, отклик ≈ 0,1 с (как у плёнки очков)
    if (sim.dimMode === 'auto' && sim.device.dimLevels && sim.caps?.dimAuto) {
      // при открытом полностью окне «Система» линзы темнеют сильнее — окно читается на светлом фоне
      const focus = panels.algo.visible && panels.algo.state.view === 'full' ? 0.55 : 0;
      let want = Math.max(focus, THREE.MathUtils.clamp((lumCd - 60) / 260, 0, 0.7));
      // SDK даёт только ступени (у VITURE Unity SDK — вкл/выкл): программа выбирает ближайшую
      const dl = sim.device.dimLevels, a = dl[0], b = dl[dl.length - 1];
      if (sim.caps.dimSteps) want = (a - snapTransmit(sim.caps.dimSteps, transmitAt(sim.device, want))) / (a - b);
      sim.dimLevel += (want - sim.dimLevel) * (1 - Math.exp(-dt / 0.1));
    }
    // яркость дисплея: своё ПО подстраивает её по освещённости, штатно — только кнопками на очках
    if (sim.caps?.brightAuto && sim.brightAuto) {
      const want = THREE.MathUtils.clamp(0.4 + lumCd / 450, 0.4, 1);
      sim.bright += (want - sim.bright) * (1 - Math.exp(-dt / 0.6));
    }
    // вес на переносице и сухость глаз: усталость копится за время в очках (минуты участка), снятые — отдых
    const dMin = (dt * app.speed) / 60;
    sim.wearMin = sim.glasses ? sim.wearMin + dMin : Math.max(0, sim.wearMin - dMin * 3);
    eye.wear = Math.min(0.5, (sim.wearMin / 480) * 0.35 * weightFatigue(sim.device));
    auto.update(dt);
    if (frame % 15 === 0) {
      const ns = nearStation();
      if (ns !== activeSt) {
        if (activeSt) { mgr.toggle(activeSt.panel, false); activeSt.showHolo(false); }
        activeSt = ns;
        if (activeSt) { mgr.toggle(activeSt.panel, true); activeSt.panel.dirty = true; app.notify(`${activeSt.short}: ${activeSt.done ? 'изделие готово' : `${activeSt.step.id} ${activeSt.step.title}`}. N — выполнено, 6 — виртуальная сборка`, 5); }
        updateBar(); pushState(true);
      }
      if (activeSt) activeSt.showHolo(holoOn(activeSt));
    }
    if (asm.open) { asm.update(dt); if (asm.playing && frame % 4 === 0) playerUi(); }
    pushState();
    // взгляд: окно (голограмма) или предмет
    const ndc = pointerNdc();
    if (frame++ % 3 === 0) {
      const tg = performance.now();
      gazeRay.setFromCamera(center, cam);
      const hit = gazeRay.intersectObjects([world.galley.root, world.jig.root, world.hall.root, world.rack, world.cart, world.showcase.root], true).find((h) => isVisible(h.object));
      const ph = mgr.enabled ? mgr.pick(center) : null;
      gaze = ph && (!hit || ph.distance < hit.distance + 0.3) ? { dist: ph.distance, holo: true } : { dist: hit ? hit.distance : 8, holo: false };
      perf.gazeMs += (performance.now() - tg - perf.gazeMs) * 0.2;
      const h = mgr.pointer(ndc, 'move');
      $('ret').classList.toggle('hot', !!h?.used || !!(h && h.panel));
    }
    if (frame % 40 === 0) { lumCd = vision.readLum(); drawMap(); }
    mgr.update(dt, t);
    viz.update(dt, run);
    eye.update(dt, { gazeDist: gaze.dist, gazeHolo: gaze.holo, lumCd });
    vision.occlusion = sim.occlusion;
    if (tp.on) renderTP(dt);
    else vision.render(dt, t, {
      focusD: eye.focusD, pupilMM: eye.pupil, dispD: eye.displayD,
      glassesOn: sim.glasses, dispOn: sim.display, bootFade: sim.boot,
      transmit: transmitAt(sim.device, sim.dimLevel), dispBright: sim.bright,
      blink: eye.lid, angVel: player.angVel, age: params.age, dirt: params.dirt,
      fatigueBlur: eye.fat * Math.min(1, Math.max(0, (eye.sinceBlink - 2) / 6)) * 1.5, ipdErr: params.ipdErr,
      // два глаза: вергенция — на точку взгляда, ведущий глаз, какие глаза открыты, двоение, схема зон
      vergD: 1 / Math.max(0.2, gaze.dist), ipdM: params.ipd / 1000, domR: params.eyes === 'R' ? 1 : params.eyes === 'L' ? 0 : params.domEye === 'L' ? 0.42 : 0.58,
      eyeOn: eyeOnV.set(params.eyes === 'R' ? 0 : 1, params.eyes === 'L' ? 0 : 1), diplo: params.diplo, overlay: sim.zones ? 1 : 0,
      exposureBias: 1.15,
    });
    vision.u.flash.value = Math.max(0, vision.u.flash.value - dt * 2.5);
    if (frame % 10 === 0) {
      $('status').textContent = `${VIEW_LABEL[vision.view].toLowerCase()}${params.eyes === 'both' ? '' : params.eyes === 'L' ? ', левый глаз' : ', правый глаз'} · ${app.plantClock()} ×${app.speed} · ${run.step.id} · фокус ${eye.focusDist > 20 ? '∞' : `${eye.focusDist.toFixed(2)} м`} · зрачок ${eye.pupil.toFixed(1)} мм · ${sim.glasses ? `${sim.device.name} ${sim.caps.mode === 'stock' ? 'штатное ПО' : sim.caps.windows === '6dof' ? '6DoF' : '3DoF'}, пропускание ${(transmitAt(sim.device, sim.dimLevel) * 100).toFixed(0)} %${sim.dimMode === 'auto' && sim.device.dimLevels ? ' (авто)' : ''}` : 'без очков'}${player.mode === 'inspect' ? ' · осмотр (Esc)' : ''}${auto.on ? (auto.paused ? ' · имитация: пауза (I)' : ` · имитация: ${auto.phaseLabel()}`) : ''}`;
      const c = $('card');
      if (!c.hidden && c.dataset.kind === 'vision' && $('v_focus')) {
        $('v_focus').textContent = eye.focusDist > 20 ? '∞' : `${eye.focusDist.toFixed(2)} м`;
        $('v_pupil').textContent = `${eye.pupil.toFixed(1)} мм`;
        $('v_amp').textContent = `${eye.amp.toFixed(1)} дптр`;
        $('v_wear').textContent = `+${Math.round(eye.wear * 100)} % (${Math.floor(sim.wearMin / 60)} ч ${Math.round(sim.wearMin % 60)} мин в очках)`;
      }
    }
  });
  setDevice(sim.device.id, { quiet: true });
  updateBar();
  if (q.get('place')) act('goto_place', q.get('place'));
  if (q.get('auto') === '1') { $('start').hidden = true; if (scen.state === 'choose') finishIntro(); if (auto.cam === 'free') auto.setCam('free'); auto.start(); }
  // режим из адреса (#autonomous / #manual, ?mode=); в проверках браузера — вступление как раньше
  if (scen.state === 'choose') {
    if (q.get('mode') === 'auto' || q.get('mode') === 'manual') startScenario(q.get('mode'));
    else if (navigator.webdriver || q.has('shot')) startScenario('intro');
  }
  if (q.get('corner') === '1') cornerAlgo(true, true);
  if (q.get('sys')) act('sys', q.get('sys'));                       // ?sys=full|cat|kd|tree|ctl — окно «Система»
  if (q.get('asm') === '1') togglePlayer(true);
  if (q.get('train') === '1') startTraining(true);
  if (tp.on) setTP(true);
  window.__demo = {
    ready: true, scene, world, run, cam, player, eye, vision, app, mgr, panels, viz, finishIntro, inspectAtGaze, sim, params, auto, setDevice, act, asm, tp, worker, stations, perf,
    get activeStation() { return activeSt; },
    // для проверок: перескочить к этапу сценария
    jump(state) {
      if (scen.state === 'choose') { scen.state = 'intro'; scen.mode = 'auto'; }
      if (state === 'desk') { player.path = null; player.mode = 'walk'; player.place(-7.2, -3.3, Math.atan2(-(dx + 7.2), -(dz + 3.3)), -0.5); startPutOn(); }
      if (state === 'toJig') { glasses.visible = false; sim.glasses = 1; sim.display = 1; sim.boot = 1; walkToJig(); }
    },
  };
}

main().catch((e) => { console.error(e); window.__demo = { ready: false, error: String(e) }; });
