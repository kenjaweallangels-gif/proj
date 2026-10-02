// Симулятор участка: сборщик приходит на участок, надевает AR-очки, подходит к стапелю и собирает модуль
// кухонный КМ-2 по ТП: окна КД, задания с чатом и системы сборщика закреплены в пространстве, переходы
// показываются голограммами, выдержки — таймерами; F — осмотр точки узла с локальным алгоритмом.
// Параметры адреса: ?intro=0 (без вступления) &vision=norm|presby|myopia|… &step=080.04 &speed=60 &debug=orbit
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { HOLO, LAYER_HOLO, LAYER_REAL, markerFrame } from '../engine/holo.js';
import { AUTO_REPLIES, CHAT_SCRIPT, docByCode } from './catalog.js';
import { docFormat, FORMATS } from './kd_draw.js';
import { buildPanels, placeHud } from './panels.js';
import { Player } from './player.js';
import { DONE_BEFORE_SHIFT, ProcessRun, STEPS, stateFrom, stepById, stepsForFeature } from './process.js';
import * as S from './spec.js';
import { PanelManager } from './ui3d.js';
import { DISPLAY, Eye, PRESETS, VisionRenderer } from './vision.js';
import { StepViz } from './viz.js';
import { GALLEY_ORIGIN, PLACES, buildWorld } from './world.js';
import '../style.css';
import './galley.css';

const q = new URLSearchParams(location.search);
for (const t of location.hash.slice(1).split(/[-_.~]/).filter(Boolean)) {      // короткие метки для встроенного просмотра
  if (t === 'nointro') q.set('intro', '0');
  else if (PRESETS[t]) q.set('vision', t);
  else if (/^s\d{6}$/.test(t)) q.set('step', `${t.slice(1, 4)}.${t.slice(4, 6)}`);
}
const $ = (id) => document.getElementById(id);
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const SHIFT_START_MIN = 7 * 60 + 30;

function glassesModel() {
  const g = new THREE.Group();
  const frame = new THREE.MeshPhysicalMaterial({ color: '#0e0f11', roughness: 0.3, clearcoat: 1 });
  const lens = new THREE.MeshPhysicalMaterial({ color: '#1f2b33', roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.75, clearcoat: 1 });
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.035, 0.022), frame);
  g.add(bar);
  for (const s of [-1, 1]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.004), lens); l.position.set(s * 0.034, -0.002, -0.012); g.add(l);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.012, 0.14), frame); arm.position.set(s * 0.074, 0.004, 0.07); g.add(arm);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

async function main() {
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
  scene.environmentIntensity = 0.9;
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
  const params = { light: 1, ...(PRESETS[q.get('vision')] || PRESETS.norm) };
  const eye = new Eye(params);
  const vision = new VisionRenderer(renderer, scene, cam);
  const sim = { glasses: 0, display: 0, boot: 0, dimLevel: params.dim, bright: 1, occlusion: false };
  vision.beforeHolo = (hc) => placeHud(panels.hud, hc, vision.win);
  const glasses = glassesModel();
  const [dx, dy, dz] = PLACES.workplace.dock;
  glasses.position.set(dx, dy + 0.06, dz);
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
    <div class="bar pe" id="bar"></div>
    <div class="status" id="status"></div>
    <canvas class="map" id="map" width="440" height="300"></canvas>
    <div class="card pe" id="card" hidden></div>
    <div class="start pe" id="start"><div><b>Участок сборки монументов · КМ-2</b>
      Сборщик приходит на участок, надевает AR-очки и подходит к стапелю.<br>
      Щёлкните, чтобы управлять: <b style="display:inline;font-size:14px">WASD</b> — ходьба, мышь — обзор, <b style="display:inline;font-size:14px">Enter</b> — пропустить вступление,
      <b style="display:inline;font-size:14px">H</b> — все клавиши.</div></div>`;
  const say = (t) => { $('subs').textContent = t; };
  const prompt = (t) => { $('prompt').textContent = t; };
  const scen = { state: 'intro', t: 0 };

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
  if (q.get('intro') === '0' || q.has('step')) finishIntro();
  else {
    const [ex, ez] = PLACES.entrance.pos;
    player.place(ex, ez, -Math.PI / 2, -0.05);
    say('07:28. Сборщик приходит на участок сборки монументов (цех 12)');
    player.walkPath([[-15, 6.5], [-10, 6.2], [-7.6, 0.5], [-7.2, -3.3]], { speed: 1.3, lookAt: [dx, dy, dz], onDone: () => {
      scen.state = 'desk'; scen.t = 0; say('Рабочее место: терминал системы, инструмент, зарядная станция AR-очков'); prompt('E — взять и надеть AR-очки');
    } });
  }

  function updateScenario(dt) {
    scen.t += dt;
    if (scen.state === 'desk' && (scen.t > 3.5 && q.get('autoplay') !== '0')) startPutOn();
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
      if (scen.t > 2.5) walkToJig();
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
  const pointerNdc = () => (player.locked ? center : player.mouse);
  const rayReal = new THREE.Raycaster(); rayReal.layers.set(LAYER_REAL);
  function pickReal(ndc) {
    rayReal.setFromCamera(ndc, cam);
    return rayReal.intersectObjects([world.galley.root, world.jig.root, world.hall.root, world.rack, world.cart], true).find((h) => isVisible(h.object));
  }
  function isVisible(o) { while (o) { if (!o.visible) return false; o = o.parent; } return true; }

  if (navigator.webdriver || q.has('shot')) $('start').hidden = true;
  $('start').addEventListener('click', () => { $('start').hidden = true; canvas.requestPointerLock?.(); });
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    $('start').hidden = true;
    const ndc = pointerNdc();
    if (mgr.startDrag(ndc)) { /* перетаскивание листа КД */ }
    const h = mgr.pointer(ndc, 'click');
    if (h?.used) return;
    if (!h && !player.locked && q.get('debug') !== 'orbit') canvas.requestPointerLock?.();
  });
  addEventListener('mouseup', () => mgr.endDrag());
  canvas.addEventListener('wheel', (e) => { if (mgr.wheel(pointerNdc(), e.deltaY)) e.preventDefault(); }, { passive: false });
  addEventListener('keydown', (e) => {
    if (mgr.key(e)) { e.preventDefault(); player.keys.clear(); player.enabled = !mgr.focus; return; }
    player.enabled = true;
    const k = e.code;
    if (scen.state !== 'free' && (k === 'Enter' || k === 'Space')) { finishIntro(); return; }
    if (k === 'KeyE') {
      if (scen.state === 'desk') { startPutOn(); return; }
      const hit = pickReal(pointerNdc());
      const id = hit && featureOf(hit.object);
      if (id?.startsWith('DOOR-')) { const d = world.galley.doors.get(id); d.userData.target = d.userData.target ? 0 : 1; }
    }
    if (k === 'KeyF') inspectAtGaze();
    if (k === 'Escape' || k === 'KeyQ') { if (player.mode === 'inspect') { player.exitInspect(); mgr.toggle(panels.local, false); showStep(); } }
    if (k === 'KeyN') app.next();
    if (k === 'KeyB') app.prev();
    if (k === 'KeyP') app.photo();
    if (k === 'KeyG') { const h = mgr.pick(pointerNdc()); if (h) mgr.pinHere(h.panel); }
    if (k === 'Digit1') mgr.toggle(panels.kd);
    if (k === 'Digit2') mgr.toggle(panels.step);
    if (k === 'Digit3') mgr.toggle(panels.sys);
    if (k === 'Digit4') mgr.toggle(panels.task);
    if (k === 'KeyT') { app.speed = { 1: 60, 60: 600, 600: 1 }[app.speed] || 60; app.notify(`Время участка ×${app.speed}`); }
    if (k === 'KeyO') toggleCard('vision');
    if (k === 'KeyH') toggleCard('help');
    if (k === 'KeyV') { sim.glasses = sim.glasses ? 0 : 1; sim.display = sim.glasses; mgr.setEnabled(!!sim.glasses && app.aligned); app.notify(sim.glasses ? 'Очки надеты' : 'Очки сняты'); }
    if (k === 'KeyL') { sim.dimLevel = sim.dimLevel >= 0.75 ? 0 : sim.dimLevel + 0.25; app.notify(`Затемнение линз ${Math.round(sim.dimLevel * 100)} %`); }
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
    // окно «В этой точке» — справа от точки, лицом к сборщику
    const right = V().crossVectors(cam.getWorldDirection(V()), V(0, 1, 0)).normalize();
    const pos = hit.point.clone().addScaledVector(right, 0.38).add(V(0, 0.08, 0)).addScaledVector(n || V(0, 0, 1), 0.2);
    panels.local.placeAt(pos, cam.position);
    mgr.toggle(panels.local, true);
    panels.local.state.scroll = 0; panels.local.dirty = true;
    viz.show(null, { features: near.slice(0, 6).map((x) => x.f.id), focus: pm.toArray() });
  }

  // ---------- карточки: модель зрения, клавиши ----------
  function toggleCard(kind) {
    const c = $('card');
    if (!c.hidden && c.dataset.kind === kind) { c.hidden = true; return; }
    c.dataset.kind = kind; c.hidden = false;
    if (kind === 'help') {
      c.innerHTML = `<h3>Управление</h3><table>${[
        ['WASD / стрелки', 'ходьба; Shift — быстрее; C — присесть'], ['мышь', 'обзор (щелчок — захват; ПКМ — без захвата)'], ['щелчок по окну', 'кнопки, поля, листы КД'],
        ['колесо над КД', 'зум к точке; перетаскивание — сдвиг листа'], ['F', 'осмотр точки узла + локальный алгоритм; Esc/Q — назад'], ['E', 'взаимодействие: очки, дверцы'],
        ['N / B', 'переход вперёд / назад'], ['P', 'фото в журнал'], ['G', 'закрепить окно перед глазами'], ['1–4', 'окна КД / переход / система / задание'],
        ['T', 'ускорение времени участка ×1 / ×60 / ×600'], ['L', 'затемнение линз'], ['V', 'снять / надеть очки'], ['O', 'модель зрения'], ['Enter', 'пропустить вступление'],
      ].map(([a, b]) => `<tr><td><kbd>${a}</kbd></td><td>${b}</td></tr>`).join('')}</table>`;
      return;
    }
    const sl = (key, label, min, max, step, fmt = (v) => v) => `<label>${label}<b id="v_${key}">${fmt(params[key] ?? sim[key])}</b><input type="range" id="r_${key}" min="${min}" max="${max}" step="${step}" value="${params[key] ?? sim[key]}"></label>`;
    c.innerHTML = `<h3>Модель зрения в очках</h3>
      <div class="presets">${Object.entries(PRESETS).map(([k, p]) => `<button data-p="${k}" aria-pressed="${q.get('vision') === k}">${p.label}</button>`).join('')}</div>
      ${sl('age', 'Возраст, лет', 18, 65, 1)}${sl('refraction', 'Рефракция глаза, дптр', -4, 2, 0.25)}
      <label>Оптические вставки (коррекция мира)<input type="checkbox" id="r_inserts" ${params.inserts ? 'checked' : ''}></label>
      ${sl('dial', 'Колесо диоптрий дисплея, дптр', -4, 0, 0.25)}${sl('dim', 'Затемнение линз', 0, 0.95, 0.05)}
      ${sl('bright', 'Яркость дисплея', 0.2, 1.5, 0.05)}${sl('dirt', 'Загрязнение линз', 0, 1, 0.05)}${sl('fatigue', 'Усталость', 0, 1, 0.05)}
      ${sl('ipdErr', 'Ошибка межзрачкового, мм', 0, 8, 0.5)}${sl('light', 'Освещённость участка', 0.3, 2.5, 0.05)}
      <label>Окклюзия голограмм по датчику глубины<input type="checkbox" id="r_occ" ${sim.occlusion ? 'checked' : ''}></label>
      <div class="note">Фокус глаза: <b id="v_focus"></b> · зрачок <b id="v_pupil"></b> · диапазон аккомодации <b id="v_amp"></b>.
      Дисплей виден на ≈ ${DISPLAY.distM} м: при работе вблизи голограммы теряют резкость (конфликт вергенции и аккомодации).</div>`;
    c.querySelectorAll('[data-p]').forEach((b) => b.onclick = () => { Object.assign(params, { light: 1 }, PRESETS[b.dataset.p]); sim.dimLevel = params.dim; q.set('vision', b.dataset.p); toggleCard('x'); toggleCard('vision'); });
    c.querySelectorAll('input[type=range]').forEach((r) => r.oninput = () => {
      const key = r.id.slice(2); const v = Number(r.value);
      if (key in sim) sim[key] = v; else params[key] = v;
      if (key === 'dim') sim.dimLevel = v;
      $(`v_${key}`).textContent = v;
    });
    $('r_inserts').onchange = (e) => { params.inserts = e.target.checked; };
    $('r_occ').onchange = (e) => { sim.occlusion = e.target.checked; };
  }
  $('bar').innerHTML = ['Клавиши (H)', 'Зрение (O)', 'Окна 1–4', 'Время ×60 (T)', 'Очки (V)'].map((t, i) => `<button data-b="${i}">${t}</button>`).join('');
  $('bar').querySelectorAll('button').forEach((b) => b.onclick = (e) => {
    e.stopPropagation();
    const i = Number(b.dataset.b);
    if (i === 0) toggleCard('help'); if (i === 1) toggleCard('vision');
    if (i === 2) for (const p of [panels.kd, panels.step, panels.sys, panels.task]) mgr.toggle(p, true);
    if (i === 3) { app.speed = { 1: 60, 60: 600, 600: 1 }[app.speed] || 60; b.textContent = `Время ×${app.speed} (T)`; }
    if (i === 4) dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV' }));
  });

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
  const gazeRay = new THREE.Raycaster();
  gazeRay.layers.set(LAYER_REAL);
  let gaze = { dist: 2, holo: false }, frame = 0, last = performance.now(), lumCd = 150, chatIdx = 0;
  const lights = [world.hall.key, world.hall.task];
  const baseI = lights.map((l) => l.intensity);
  renderer.setAnimationLoop((now) => {
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000)); last = now;
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
    // взгляд: окно (голограмма) или предмет
    const ndc = pointerNdc();
    if (frame++ % 3 === 0) {
      gazeRay.setFromCamera(center, cam);
      const hit = gazeRay.intersectObjects([world.galley.root, world.jig.root, world.hall.root, world.rack, world.cart], true).find((h) => isVisible(h.object));
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
      transmit: 0.88 * (1 - sim.dimLevel * 0.95), dispBright: sim.bright,
      blink: eye.lid, angVel: player.angVel, age: params.age, dirt: params.dirt,
      fatigueBlur: params.fatigue * Math.min(1, Math.max(0, (eye.sinceBlink - 2) / 6)) * 1.5, ipdPx: params.ipdErr * 1.2,
      exposureBias: 1.2,
    });
    vision.u.flash.value = Math.max(0, vision.u.flash.value - dt * 2.5);
    if (frame % 10 === 0) {
      $('status').textContent = `${app.plantClock()} ×${app.speed} · ${run.step.id} · фокус ${eye.focusDist > 20 ? '∞' : `${eye.focusDist.toFixed(2)} м`} · зрачок ${eye.pupil.toFixed(1)} мм · ${sim.glasses ? `очки, затемнение ${Math.round(sim.dimLevel * 100)} %` : 'без очков'}${player.mode === 'inspect' ? ' · осмотр (Esc)' : ''}`;
      const c = $('card');
      if (!c.hidden && c.dataset.kind === 'vision' && $('v_focus')) {
        $('v_focus').textContent = eye.focusDist > 20 ? '∞' : `${eye.focusDist.toFixed(2)} м`;
        $('v_pupil').textContent = `${eye.pupil.toFixed(1)} мм`;
        $('v_amp').textContent = `${eye.amp.toFixed(1)} дптр`;
      }
    }
  });
  window.__demo = { ready: true, scene, world, run, cam, player, eye, vision, app, mgr, panels, viz, finishIntro, inspectAtGaze };
}

main().catch((e) => { console.error(e); window.__demo = { ready: false, error: String(e) }; });
