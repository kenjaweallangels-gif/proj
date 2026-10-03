// Симулятор участка: сборщик приходит на участок, надевает AR-очки, подходит к стапелю и собирает модуль
// кухонный КМ-2 по ТП: окна КД, задания с чатом и системы сборщика закреплены в пространстве, переходы
// показываются голограммами, выдержки — таймерами; F — осмотр точки узла с локальным алгоритмом.
// I — автоматическая имитация сборки по ТП (переходы, установка деталей со стеллажа, замеры, выдержки ускоренно).
// Профили очков (glasses.js): VITURE Luma Ultra/Pro, The Beast, XREAL Air 2 Pro/Ultra, One, One Pro, Aura — K.
// Параметры адреса: ?intro=0 (без вступления) &vision=norm|presby|myopia|… &step=080.04 &speed=60 &glasses=aura &auto=1 &debug=orbit
// В hash (встроенный просмотр): #nointro-aura-auto, #onepro, #s090010 …
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { HOLO, LAYER_HOLO, LAYER_REAL, markerFrame } from '../engine/holo.js';
import { AUTO_REPLIES, CHAT_SCRIPT, docByCode } from './catalog.js';
import { docFormat, FORMATS } from './kd_draw.js';
import { buildPanels, placeCorner, placeHud } from './panels.js';
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
  else if (t === 'narrow') q.set('field', '0');
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
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#2b3035');
  const world = buildWorld(scene);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(scene, 0.02, 0.1, 60, { position: V(0, 2.2, 3.5) }).texture;
  scene.environmentIntensity = 1.15;
  renderer.shadowMap.autoUpdate = true;

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

  function applyState() {
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
  vision.setFieldMode(q.get('field') !== '0');                     // по умолчанию — полное поле ≈ 200°
  // адаптивное качество полного поля: долгий кадр (> 90 мс) несколько секунд подряд — разрешение ниже
  const perf = { ema: 0.016, slow: 0 };
  const sim = { glasses: 0, display: 0, boot: 0, dimLevel: params.dim, dimMode: q.get('vision') === 'dimmed' ? 'manual' : 'auto', bright: 1, occlusion: false, tts: true,
    device: deviceById.get(q.get('glasses')) || deviceById.get(DEFAULT_DEVICE), wearMin: 0 };
  const STAND = V(0, 1.68, 3.4);            // место сборщика у стапеля: для него задана раскладка окон
  let lumCd = 150;
  vision.beforeHolo = (hc) => {
    placeHud(panels.hud, hc, vision.win, vision.u.disp.value.y);
    // окна «в углу» — привязаны к голове, в плоскости виртуального экрана очков
    for (const p of mgr.panels) if (p.mode === 'corner' && p.group.visible) placeCorner(p, hc, vision.win, vision.u.disp.value.y, sim.device.distM, p.corner || 'tr');
  };
  /** Выбрать очки: окно дисплея, яркость, линзы, оптика, трекинг, задержка, расстояние экрана, коррекция. */
  function setDevice(id, { quiet = false } = {}) {
    const d = deviceById.get(id) || sim.device;
    sim.device = d;
    vision.setDevice(d);
    eye.distM = d.distM;
    params.dial = Math.max(d.dial, params.dial);                  // у XREAL колеса диоптрий нет (dial 0) — только вставки
    if (!d.dimLevels) { sim.dimLevel = 0; }
    mgr.setTracking(d.tracking, d.driftDegMin, STAND, 0);
    if (glasses && glasses.parent && glasses.userData.device !== d.id && (scen.state === 'intro' || scen.state === 'desk')) {
      const ng = buildGlassesModel(d.id);
      ng.position.copy(glasses.position); ng.quaternion.copy(glasses.quaternion); ng.visible = glasses.visible;
      scene.remove(glasses); scene.add(ng); glasses = ng;
    }
    viz.setAnchored(d.tracking === '6dof');
    markerFrames?.forEach((f) => { f.visible = false; });
    q.set('glasses', d.short);
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
    if (scen.state === 'align' && sim.device.tracking === '3dof') {
      say(`${sim.device.brand} ${sim.device.name}: трекинг 3DoF — очки не видят стапель, привязки к меткам нет. Окна выставлены вокруг головы.`);
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
  canvas.addEventListener('wheel', (e) => { if (mgr.wheel(pointerNdc(), e.deltaY)) e.preventDefault(); }, { passive: false });
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
    if (k === 'KeyX') act(e.shiftKey ? 'corner_side' : 'corner');
    if (k === 'KeyU') act('auto_cam');
    if (k === 'Tab') { e.preventDefault(); act('field'); }
    if (k === 'Backslash') act('zones');
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
    if (sim.device.tracking === '3dof') app.notify(`${sim.device.name} (3DoF): список элементов есть, но голограммы на узле не показать — очки не знают, где узел`, 5);
  }

  // ---------- единый диспетчер: клавиатура, голос, планшет ----------
  const PANEL_OF = { kd: panels.kd, task: panels.task, system: panels.sys, step: panels.step, local: panels.local, algo: panels.algo };
  /** Алгоритм в углу поля зрения: вкл/выкл; side — сменить угол (справа/слева). */
  function cornerAlgo(on = !panels.algo.visible, quiet = false) {
    const a = panels.algo;
    if (a.mode !== 'corner') { a.mode = 'corner'; }
    mgr.toggle(a, on);
    if (!quiet) app.notify(on ? `Алгоритм — в ${a.corner === 'tl' ? 'левом' : 'правом'} верхнем углу поля зрения (X — убрать, Shift+X — другой угол)` : 'Алгоритм из угла убран');
    updateBar();
  }
  const say2 = (text, voice) => { app.notify(text, 4); if (voice && sim.tts) speak(text); };
  function fmtLeft(m) { const h = Math.floor(m / 60), mm = Math.round(m % 60); return h ? `${h} ч ${mm} мин` : `${mm} мин`; }
  function act(cmd, arg = null, src = 'клавиатура') {
    const voice = src === 'голос';
    switch (cmd) {
      case 'next': auto.pause(); app.next(); break;
      case 'prev': auto.pause(); app.prev(); break;
      case 'repeat': { const s = run.step; showStep(); say2(`${s.id}. ${s.title}. ${s.text[0] || ''}`, voice); break; }
      case 'photo': app.photo(); break;
      case 'value': app.value(arg); break;
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
      case 'dim_auto': if (sim.device.dimLevels) { sim.dimMode = 'auto'; app.notify('Затемнение: авто по освещённости'); } else app.notify('Затемнения нет у этих очков'); break;
      case 'dim_set': sim.dimMode = 'manual'; sim.dimLevel = sim.device.dimLevels ? THREE.MathUtils.clamp(Number(arg) || 0, 0, 1) : 0; break;
      case 'auto_start': auto.start(); break;
      case 'auto_free': auto.setCam('free'); if (!auto.on) auto.start(); break;
      case 'auto_guide': auto.setCam('guide'); if (!auto.on) auto.start(); break;
      case 'auto_cam': auto.setCam(auto.cam === 'free' ? 'guide' : 'free'); break;
      case 'corner': cornerAlgo(arg === 'on' ? true : arg === 'off' ? false : undefined); break;
      case 'corner_side': panels.algo.corner = panels.algo.corner === 'tl' ? 'tr' : 'tl'; cornerAlgo(true); break;
      case 'auto_pause': auto.pause(true); break;
      case 'auto_stop': auto.stop(); break;
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
      case 'field': vision.setFieldMode(arg == null ? !vision.fieldMode : !!arg); app.notify(vision.fieldMode ? 'Поле зрения: полное, ≈ 200° (два глаза, периферия, оправа целиком). Tab — центр 72°' : 'Поле зрения: центр 72° (как на мониторе). Tab — полное поле', 5); updateBar(); break;
      case 'zones': sim.zones = !sim.zones; app.notify(sim.zones ? 'Схема зон: фовеа 2°, 5°, 10°, 30° (центр), 60° (периферия); зелёным — границы полей глаз; красным/синим — видит только правый/левый глаз; белым — линзы' : 'Схема зон скрыта', 7); break;
      case 'recenter': app.notify(mgr.recenter() ? 'Окна — по центру взгляда' : 'Окна закреплены у стапеля (6DoF) — центрировать не нужно'); break;
      case 'device': {
        const i = DEVICES.indexOf(sim.device);
        const id = typeof arg === 'number' ? DEVICES[(i + arg + DEVICES.length) % DEVICES.length].id : deviceById.has(arg) ? arg : matchDevice(arg);
        if (id) setDevice(id); else app.notify(`Нет профиля очков: ${arg}`);
        break;
      }
      case 'bright_up': sim.bright = Math.min(1, sim.bright + 0.15); app.notify(`Яркость дисплея ${Math.round(sim.bright * sim.device.nits)} нит`); break;
      case 'bright_down': sim.bright = Math.max(0.2, sim.bright - 0.15); app.notify(`Яркость дисплея ${Math.round(sim.bright * sim.device.nits)} нит`); break;
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
  link.on('cmd', (m) => { act(m.cmd, m.arg, m.src === 'голос' ? 'голос' : 'планшет'); if (m.cmd !== 'value') app.notify(`Планшет: ${m.label || m.cmd}`, 2); });
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
      device: sim.device.id, auto: { on: auto.on, paused: auto.paused, cam: auto.cam },
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
    if (kind === 'help') {
      c.innerHTML = `<h3>Управление</h3><table>${[
        ['WASD / стрелки', 'ходьба; Shift — быстрее; C — присесть'], ['мышь', 'обзор (щелчок — захват; ПКМ — без захвата)'], ['щелчок по окну', 'кнопки, поля, листы КД'],
        ['колесо над КД', 'зум к точке; перетаскивание — сдвиг листа'], ['F', 'осмотр точки узла + локальный алгоритм; Esc/Q — назад'], ['E', 'взаимодействие: очки, дверцы'],
        ['N / B', 'переход вперёд / назад'], ['P', 'фото в журнал'], ['G', 'закрепить окно перед глазами'], ['1–4', 'окна КД / переход / система / задание'],
        ['Tab', 'поле зрения: полное ≈ 200° (два глаза) / центр 72°'], ['\\', 'схема зон поля зрения'],
        ['I', 'имитация сборки: запуск / пауза; Shift+I — стоп'], ['U', 'имитация: камера ведёт / хожу сам'], ['X', 'алгоритм в углу поля зрения; Shift+X — другой угол'], ['K', 'другие очки (Shift+K — назад)'], ['R', '3DoF: окна по центру взгляда'],
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
      <div class="presets"><button id="b_insp">🔍 Рассмотреть модель ${dv.brand} ${dv.name} на витрине</button></div>
      <h3>Два глаза и поле зрения</h3>
      <div class="presets">
        <button data-fm="1" aria-pressed="${vision.fieldMode}">Полное поле ≈ 200°</button><button data-fm="0" aria-pressed="${!vision.fieldMode}">Центр 72°</button>
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
    c.querySelectorAll('[data-fm]').forEach((b) => b.onclick = () => { act('field', b.dataset.fm === '1'); toggleCard('x'); toggleCard('vision'); });
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
  function updateBar() {
    const a = auto.on && !auto.paused;
    $('bar').innerHTML = [
      [a ? '⏸ Пауза имитации (I)' : auto.on ? '▶ Продолжить имитацию (I)' : '▶ Имитация сборки (I)', 'auto', a ? 'on' : 'primary'],
      ...(auto.on ? [['⏹', 'stop', '']] : []),
      [auto.cam === 'free' ? '🚶 Хожу сам (U)' : '🎥 Камера ведёт (U)', 'cam', auto.cam === 'free' ? 'on' : ''],
      [panels.algo.visible ? '▣ Алгоритм в углу (X)' : '□ Алгоритм в угол (X)', 'corner', panels.algo.visible ? 'on' : ''],
      [`👓 ${sim.device.brand} ${sim.device.name} (K)`, 'dev', ''],
      [vision.fieldMode ? '👁 Поле 200° (Tab)' : '👁 Центр 72° (Tab)', 'field', vision.fieldMode ? 'on' : ''], ['Клавиши (H)', 'help', ''], ['Зрение (O)', 'vision', ''], ['Окна 1–4', 'win', ''],
      [`Время ×${app.speed} (T)`, 'time', ''], ['Очки (V)', 'glasses', ''], ['Планшет (J)', 'tablet', ''], ['Голос', 'voice', ''],
    ].map(([t, k, c]) => `<button data-b="${k}" class="${c}">${t}</button>`).join('');
    $('bar').querySelectorAll('button').forEach((b) => b.onclick = (e) => {
      e.stopPropagation();
      const k = b.dataset.b;
      if (k === 'auto') act('auto_toggle'); if (k === 'stop') act('auto_stop');
      if (k === 'cam') act('auto_cam'); if (k === 'corner') act('corner'); if (k === 'field') act('field');
      if (k === 'dev') toggleCard('vision');
      if (k === 'help') toggleCard('help'); if (k === 'vision') toggleCard('vision');
      if (k === 'win') for (const p of [panels.kd, panels.step, panels.sys, panels.task]) mgr.toggle(p, true);
      if (k === 'time') { app.speed = { 1: 60, 60: 600, 600: 1 }[app.speed] || 60; updateBar(); }
      if (k === 'glasses') dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV' }));
      if (k === 'tablet') toggleTablet();
      if (k === 'voice') toggleCard('voice');
    });
  }

  // ---------- имитация сборки: сборщик сам выполняет переходы ТП ----------
  // Каждый переход: голограмма перехода (≈ 3 с) → взгляд на место → действие: деталь со стеллажа/тележки
  // переносится на место по дуге, замер вводится (норма ± доля допуска), фото в журнал, выдержка клея —
  // ускоренно (часы участка «проматываются», таймер виден) → «выполнено» и следующий переход.
  const FLY_KINDS = new Set(['panel', 'bracket', 'fitting', 'equipment', 'trim', 'decor', 'door', 'hinge', 'latch', 'plumbing', 'sheet', 'sink', 'faucet', 'siphon', 'valve', 'light', 'handle', 'placard', 'retainer', 'stdunit', 'trolley', 'turnbutton']);
  const auto = {
    on: false, paused: false, phase: 'show', t: 0, fly: null, ff: false, rate: 1,
    // guide — камера ведёт к месту работы; free — сборщик ходит и смотрит сам, сборка идёт своим ходом
    cam: q.get('autocam') === 'free' ? 'free' : 'guide',
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
      if (this.cam === 'free' && this.phase === 'show') return `переход ${run.step.id} — голограмма (свободно)`; return { show: `переход ${run.step.id} — голограмма`, move: 'подход к месту', act: `переход ${run.step.id} — выполнение`, fly: `установка ${this.fly?.ids?.join(', ') || ''}`, wait: 'выдержка (ускорено)' }[this.phase] || ''; },
    start() {
      if (scen.state === 'choose') { startScenario('auto'); return; }
      if (!this.on) { this.phase = 'show'; this.t = 0; }
      this.on = true; this.paused = false;
      if (scen.state === 'free') this.begin();
      else app.notify('Имитация сборки начнётся после вступления (Enter — пропустить)', 4);
      updateBar(); pushState(true);
    },
    begin() {
      if (player.mode === 'inspect' && this.cam === 'guide') { player.exitInspect(); mgr.toggle(panels.local, false); }
      mgr.toggle(panels.step, true);
      if (this.cam === 'free' && !panels.algo.visible) cornerAlgo(true, true);
      app.preview = null; showStep();
      app.notify(`Имитация сборки: с перехода ${run.step.id}. I — пауза, N/B — вручную`, 4);
      this.begun = true;
    },
    pause(byUser = false) {
      if (!this.on || this.paused) return;
      this.paused = true;
      if (this.fly) this.finishFly();
      if (byUser) app.notify('Имитация на паузе — I продолжить');
      updateBar(); pushState(true);
    },
    stop() {
      if (!this.on) return;
      if (this.fly) this.finishFly();
      this.on = false; this.paused = false; this.begun = false;
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
        F.t += dt;
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
        run.tick(Math.max(run.remaining(tm) * Math.min(1, dt * 1.2), (dt * app.speed) / 60) + 1e-3);
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
    if (vision.fieldMode && frame > 30) {
      perf.slow = perf.ema > 0.09 ? perf.slow + rawDt : 0;
      if (perf.slow > 3 && (vision.quality ?? 1) > 0.31) { vision.setQuality((vision.quality ?? 1) * 0.75); perf.slow = 0; app.notify(`Полное поле: качество снижено до ${Math.round(vision.quality * 100)} % (слабая видеокарта)`, 3); }
    }
    const t = now / 1000;
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
    if (sim.dimMode === 'auto' && sim.device.dimLevels) {
      const want = THREE.MathUtils.clamp((lumCd - 60) / 260, 0, 0.7);
      sim.dimLevel += (want - sim.dimLevel) * (1 - Math.exp(-dt / 0.1));
    }
    // вес на переносице и сухость глаз: усталость копится за время в очках (минуты участка), снятые — отдых
    const dMin = (dt * app.speed) / 60;
    sim.wearMin = sim.glasses ? sim.wearMin + dMin : Math.max(0, sim.wearMin - dMin * 3);
    eye.wear = Math.min(0.5, (sim.wearMin / 480) * 0.35 * weightFatigue(sim.device));
    auto.update(dt);
    pushState();
    // взгляд: окно (голограмма) или предмет
    const ndc = pointerNdc();
    if (frame++ % 3 === 0) {
      gazeRay.setFromCamera(center, cam);
      const hit = gazeRay.intersectObjects([world.galley.root, world.jig.root, world.hall.root, world.rack, world.cart, world.showcase.root], true).find((h) => isVisible(h.object));
      const ph = mgr.enabled ? mgr.pick(center) : null;
      gaze = ph && (!hit || ph.distance < hit.distance + 0.3) ? { dist: ph.distance, holo: true } : { dist: hit ? hit.distance : 8, holo: false };
      const h = mgr.pointer(ndc, 'move');
      $('ret').classList.toggle('hot', !!h?.used || !!(h && h.panel));
    }
    if (frame % 40 === 0) { lumCd = vision.readLum(); drawMap(); }
    mgr.update(dt, t);
    viz.update(dt, run);
    eye.update(dt, { gazeDist: gaze.dist, gazeHolo: gaze.holo, lumCd });
    vision.occlusion = sim.occlusion;
    vision.render(dt, t, {
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
      $('status').textContent = `${vision.fieldMode ? 'поле 200°' : 'центр 72°'}${params.eyes === 'both' ? '' : params.eyes === 'L' ? ', левый глаз' : ', правый глаз'} · ${app.plantClock()} ×${app.speed} · ${run.step.id} · фокус ${eye.focusDist > 20 ? '∞' : `${eye.focusDist.toFixed(2)} м`} · зрачок ${eye.pupil.toFixed(1)} мм · ${sim.glasses ? `${sim.device.name} ${sim.device.tracking === '6dof' ? '6DoF' : '3DoF'}, пропускание ${(transmitAt(sim.device, sim.dimLevel) * 100).toFixed(0)} %${sim.dimMode === 'auto' && sim.device.dimLevels ? ' (авто)' : ''}` : 'без очков'}${player.mode === 'inspect' ? ' · осмотр (Esc)' : ''}${auto.on ? (auto.paused ? ' · имитация: пауза (I)' : ` · имитация: ${auto.phaseLabel()}`) : ''}`;
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
  if (q.get('auto') === '1') { $('start').hidden = true; if (scen.state === 'choose') finishIntro(); if (auto.cam === 'free') auto.setCam('free'); auto.start(); }
  // режим из адреса (#autonomous / #manual, ?mode=); в проверках браузера — вступление как раньше
  if (scen.state === 'choose') {
    if (q.get('mode') === 'auto' || q.get('mode') === 'manual') startScenario(q.get('mode'));
    else if (navigator.webdriver || q.has('shot')) startScenario('intro');
  }
  if (q.get('corner') === '1') cornerAlgo(true, true);
  window.__demo = {
    ready: true, scene, world, run, cam, player, eye, vision, app, mgr, panels, viz, finishIntro, inspectAtGaze, sim, params, auto, setDevice, act,
    // для проверок: перескочить к этапу сценария
    jump(state) {
      if (scen.state === 'choose') { scen.state = 'intro'; scen.mode = 'auto'; }
      if (state === 'desk') { player.path = null; player.mode = 'walk'; player.place(-7.2, -3.3, Math.atan2(-(dx + 7.2), -(dz + 3.3)), -0.5); startPutOn(); }
      if (state === 'toJig') { glasses.visible = false; sim.glasses = 1; sim.display = 1; sim.boot = 1; walkToJig(); }
    },
  };
}

main().catch((e) => { console.error(e); window.__demo = { ready: false, error: String(e) }; });
