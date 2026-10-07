// Веб-демо AR-сборки: пакет операции (JSON) → сцена, шаги, голограммы, HUD.
// Вид «глазами» — окно дисплея очков 52° (голограммы только в нём), вид «со стороны» — голова, конус окна, изделие.
// Параметры адреса: ?op=040|070 &view=eye|side|split &step=N &auto=1 &full=1 &quality=high|low
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { AUTO_REPLIES, DEMO_CHAT } from './demo_script.js';
import { EyeView, PhotoChain, glassesWindow } from './engine/composite.js';
import { HOLO, LAYER_HOLO, LAYER_LABEL, LAYER_REAL, arcPoint, setHoloColor, stepPhase } from './engine/holo.js';
import { Hud } from './engine/hud.js';
import { loadPackage, stepFocus } from './engine/package.js';
import { State, StepPlayer } from './engine/steps.js';
import { createBrowserListener } from './engine/voice.js';
import { buildParts } from './scene/parts.js';
import { buildWorker } from './scene/worker.js';
import { buildWorkshop } from './scene/workshop.js';
import './style.css';

const OPS = { '040': 'op040_shelf_bench.json', '070': 'op070_bin_fuselage.json' };
const q = new URLSearchParams(location.search);
// те же параметры короткими метками в #: #op070-eye-step4-auto-low (для страниц, где адресная строка недоступна)
for (const t of location.hash.slice(1).split(/[-_.~]/).filter(Boolean)) {
  if (/^op\d{3}$/.test(t)) q.set('op', t.slice(2));
  else if (['eye', 'side', 'split'].includes(t)) q.set('view', t);
  else if (/^step\d+$/.test(t)) q.set('step', t.slice(4));
  else if (t === 'auto' || t === 'full') q.set(t, '1');
  else if (t === 'low' || t === 'high') q.set('quality', t);
}
const opId = OPS[q.get('op')] ? q.get('op') : '040';
const ui = {
  view: ['eye', 'side', 'split'].includes(q.get('view')) ? q.get('view') : 'split',
  full: q.get('full') === '1', auto: q.get('auto') === '1',
  // фотореализм: high — тени, AO, bloom; low — для слабой встроенной графики (без AO и bloom)
  quality: q.get('quality') === 'low' ? 'low' : 'high',
};
const $ = (id) => document.getElementById(id);
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

function note(msg) {
  console.warn(msg);
  const el = $('notes');
  el.hidden = false;
  el.insertAdjacentHTML('beforeend', `<div>${msg.replace(/</g, '&lt;')}</div>`);
}

async function main() {
  const P = await loadPackage(`./data/${OPS[opId]}`);
  document.title = `AR-сборка · Оп. ${P.id}`;
  $('opTitle').textContent = `Оп. ${P.id} · ${P.title}`;
  $('opMeta').textContent = [P.product, P.revision && `ред. ${P.revision}`, P.workplace].filter(Boolean).join(' · ');
  $('opSel').value = opId;

  // ---------- рендер и сцена ----------
  const renderer = new THREE.WebGLRenderer({ canvas: $('view'), antialias: true, preserveDrawingBuffer: q.has('shot') });
  renderer.setPixelRatio(Math.min(devicePixelRatio, ui.quality === 'low' ? 1.25 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;            // мягкий «плёночный» переход в светах, как у фотокамеры
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;            // мягкость — shadow.radius у источника
  const scene = new THREE.Scene();
  const ws = buildWorkshop(scene, renderer, P, { quality: ui.quality });
  const parts = await buildParts(scene, P, { onWarn: note });
  const win = glassesWindow();

  const eyeCam = new THREE.PerspectiveCamera(75, 1, 0.03, 40);      // глаз: ~75° по вертикали
  eyeCam.layers.set(LAYER_REAL);
  eyeCam.layers.enable(LAYER_LABEL);
  const eye = new EyeView(renderer, scene, eyeCam, win, { quality: ui.quality });
  eye.u.uFull.value = ui.full ? 1 : 0;
  const tpCam = new THREE.PerspectiveCamera(45, 1, 0.05, 60);
  tpCam.layers.enable(LAYER_HOLO);
  tpCam.layers.enable(LAYER_LABEL);
  const tpChain = new PhotoChain(renderer, scene, tpCam, { quality: ui.quality });
  const worker = buildWorker(scene, win);

  // ---------- голова сборщика ----------
  const c = V(...P.bounds.center);
  const tb = new THREE.Box3();
  for (const p of P.parts.values()) tb.expandByPoint(V(...p.pos));
  const base = P.isFixture
    ? V(c.x, c.y + 0.55, c.z + 0.75 + P.bounds.size[2] * 0.3)
    : V(tb.getCenter(V()).x, P.floorY + 1.65, tb.max.z + 0.9);
  const head = { pos: base.clone(), focus: c.clone(), dragYaw: 0, dragPitch: 0, yaw: 0, pitch: 0 };
  const tpTarget = P.isFixture ? c.clone() : tb.getCenter(V());
  if (P.isFixture) tpCam.position.copy(base.clone().add(V(1.7, 0.7, 1.5)));
  else {      // внутри фюзеляжа (ось вдоль X): сзади-сбоку от сборщика, у противоположного борта, между шпангоутами
    tpCam.fov = 62;                     // в тесной секции — шире, чтобы в кадр вошли и сборщик, и полка
    tpCam.position.set(base.x + 0.75, P.floorY + 1.95, Math.min(base.z + 1.05, 1.3));
    tpTarget.y -= 0.2;
  }
  const orbit = new OrbitControls(tpCam, $('tpCtl'));
  orbit.target.copy(tpTarget);
  orbit.enableDamping = true;
  orbit.update();

  // перетаскивание в виде «глазами» — поворот головы
  let drag = null;
  $('fpCtl').addEventListener('pointerdown', (e) => { if (e.target.closest('.hud-panel')) return; drag = { x: e.clientX, y: e.clientY, yaw: head.dragYaw, pitch: head.dragPitch }; });
  addEventListener('pointerup', () => { drag = null; });
  addEventListener('pointermove', (e) => {
    if (!drag) return;
    head.dragYaw = drag.yaw - (e.clientX - drag.x) * 0.004;
    head.dragPitch = THREE.MathUtils.clamp(drag.pitch - (e.clientY - drag.y) * 0.004, -0.9, 0.9);
  });
  $('fpCtl').addEventListener('dblclick', () => { head.dragYaw = head.dragPitch = 0; });

  // ---------- шаги ----------
  const hud = new Hud($('hud'));
  const player = new StepPlayer(P.steps, () => performance.now() / 1000);
  const st = { time: 0, stepTime: 0, align: 0, chatQueue: [], doneT: 0, lastIndex: -1 };
  const startIdx = Math.max(0, Math.min(P.steps.length - 1, (parseInt(q.get('step'), 10) || 1) - 1));
  player.start(startIdx);
  if (startIdx > 0) player.state = State.SHOWING;

  player.on((e, pl) => {
    if (e.event === 'aligned') {
      hud.chat('Система', `Совмещено: меток ${P.markers.length}, масштаб 1:1, отклонение ${String(e.errMm ?? 0.8).replace('.', ',')} мм`);
    }
    if (e.event === 'value') hud.chat('Вы', `Значение ${String(e.value).replace('.', ',')} мм — ${e.ok ? 'в допуске' : 'ВНЕ допуска, повторите'}`, true);
    if (e.event === 'photo') { eye.photoFlash(); hud.chat('Система', `Фото шага ${pl.step.id} сохранено в журнал`); }
    if (e.event === 'operation_done') { hud.chat('Система', 'Операция завершена. Журнал отправлен на сервер участка'); st.doneT = 0; }
    if (e.event === 'rejected') hud.toast('Сначала привязка: смотрите на метки');
  });

  function onStepChanged() {
    st.stepTime = 0;
    st.lastIndex = player.index;
    const s = player.step;
    hud.setStep(P, player);
    $('stepTitle').textContent = `Шаг ${player.index + 1}/${player.total}: ${s.title}`;
    $('valBox').hidden = s.confirm !== 'value';
    if (s.check?.nominal_mm != null) $('val').placeholder = `норма ${s.check.nominal_mm}±${s.check.tol_mm}`;
    else if (s.params?.torque_nm) $('val').placeholder = `момент ${s.params.torque_nm}`;
    st.chatQueue = (DEMO_CHAT[P.id]?.[s.id] || []).map(([t, a, m]) => ({ t, a, m }));
    // реальные детали: прошлые шаги установлены, текущие и будущие лежат в таре
    const installed = new Set(P.steps.slice(0, player.index).flatMap((x) => x.parts));
    if (player.state === State.DONE) s.parts.forEach((id) => installed.add(id));
    for (const [id, r] of parts.real) {
      const T = parts.target.get(id);
      if (installed.has(id)) { r.position.copy(T.position); r.quaternion.copy(T.quaternion); }
      else { r.position.copy(parts.src.get(id)); r.quaternion.copy(T.quaternion); }
    }
    for (const o of ws.sources) o.visible = !installed.has(o.userData.partId);
  }

  function command(cmd, value = null) {
    if (cmd === 'kd' || cmd === 'chat') { hud.togglePanel(true); hud.showTab(cmd); player.command(cmd); return; }
    if (cmd === 'panel') { hud.togglePanel(); return; }
    if (cmd === 'call') { hud.chat('Вы', `Вызов технолога: шаг ${player.index + 1} «${player.step.title}»`, true); reply(); return; }
    if (cmd === 'ok' || cmd === 'reject') { hud.chat('Вы', cmd === 'ok' ? 'Норма' : 'Брак — шаг остановлен', true); return; }
    const changed = player.command(cmd, value);
    if (player.state === State.WAITING_VALUE) { hud.status('Назовите значение: «сборка три и две» или введите внизу', true); $('valBox').hidden = false; $('val').focus(); }
    if (player.state === State.WAITING_PHOTO) hud.status('Нужно фото: «сборка фото» или кнопка «Фото»', true);
    if (changed || player.index !== st.lastIndex) onStepChanged();
  }
  function reply() {
    setTimeout(() => hud.chat('Мастер участка', AUTO_REPLIES[Math.floor(Math.random() * AUTO_REPLIES.length)]), 1800);
  }

  // ---------- интерфейс ----------
  $('btnNext').onclick = () => command('next');
  $('btnPrev').onclick = () => command('prev');
  $('btnPhoto').onclick = () => command('photo');
  $('btnPanel').onclick = () => hud.togglePanel();
  $('btnAuto').onclick = () => { ui.auto = !ui.auto; syncUi(); };
  $('btnSpeed').onclick = () => { if (player.speed >= 2) player.speed = 0.5; else player.command('faster'); syncUi(); };   // 0,5 → 1 → 1,5 → 2 → 0,5
  $('btnFull').onclick = () => { ui.full = !ui.full; eye.u.uFull.value = ui.full ? 1 : 0; syncUi(); };
  $('valOk').onclick = () => { const v = parseFloat($('val').value.replace(',', '.')); if (!Number.isNaN(v)) command('value', v); $('val').value = ''; };
  $('val').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('valOk').click(); e.stopPropagation(); });
  $('chatForm').onsubmit = (e) => { e.preventDefault(); const t = $('chatIn').value.trim(); if (t) { hud.chat('Вы', t, true); reply(); } $('chatIn').value = ''; };
  $('chatIn').addEventListener('keydown', (e) => e.stopPropagation());
  $('opSel').onchange = (e) => { location.hash = `op${e.target.value}-${ui.view}${ui.quality === 'low' ? '-low' : ''}`; };
  addEventListener('hashchange', () => location.reload());
  document.querySelectorAll('[data-view]').forEach((b) => { b.onclick = () => { ui.view = b.dataset.view; syncUi(); }; });
  const voice = createBrowserListener(([cmd, v], text) => { $('heard').textContent = `«${text}»`; command(cmd, v); }, (t) => { $('heard').textContent = `«${t}»`; });
  $('btnVoice').onclick = () => {
    if (!voice) { note('Голос в браузере: нужен Chrome/Edge (Web Speech API). На очках — офлайн Vosk, см. pkg1-sim-vm'); return; }
    voice.active ? voice.stop() : voice.start(); syncUi();
  };
  addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'n' || k === ' ' || k === 'arrowright') { e.preventDefault(); command('next'); }
    else if (k === 'b' || k === 'arrowleft') command('prev');
    else if (k === 'p') command('photo');
    else if (k === 'k') command('kd');
    else if (k === 'c') command('chat');
    else if (k === 'tab') { e.preventDefault(); hud.togglePanel(); }
    else if (k === 'f') $('btnFull').click();
    else if (k === 'v') { ui.view = { eye: 'side', side: 'split', split: 'eye' }[ui.view]; syncUi(); }
  });
  function syncUi() {
    document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === ui.view)));
    $('btnAuto').setAttribute('aria-pressed', String(ui.auto));
    $('btnAuto').textContent = ui.auto ? 'Пауза' : 'Авто';
    $('btnSpeed').textContent = `${String(player.speed).replace('.', ',')}×`;
    $('btnFull').textContent = ui.full ? 'Полное поле' : 'Окно 52°';
    $('btnFull').setAttribute('aria-pressed', String(ui.full));
    $('btnVoice').setAttribute('aria-pressed', String(!!voice?.active));
    layout();
  }

  // ---------- раскладка видов ----------
  const stage = $('stage');
  let rects = {};
  function layout() {
    const W = stage.clientWidth, H = stage.clientHeight;
    renderer.setSize(W, H, false);
    const narrow = W < 900;
    const fp = { x: 0, y: 0, w: W, h: H }, tp = { x: 0, y: 0, w: W, h: H };
    if (ui.view === 'split') {
      if (narrow) { fp.h = Math.round(H * 0.58); Object.assign(tp, { y: fp.h, h: H - fp.h }); }
      else { fp.w = Math.round(W * 0.62); Object.assign(tp, { x: fp.w, w: W - fp.w }); }
    }
    rects = { W, H, fp: ui.view !== 'side' ? fp : null, tp: ui.view !== 'eye' ? tp : null };
    for (const [key, r] of [['fpCtl', rects.fp], ['tpCtl', rects.tp]]) {
      const el = $(key);
      el.hidden = !r;
      if (r) Object.assign(el.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    }
    if (rects.fp) {
      eyeCam.aspect = fp.w / fp.h; eyeCam.updateProjectionMatrix();
      eye.setSize(fp.w, fp.h, renderer.getPixelRatio());
      hud.layout(eye.windowRect(fp.w, fp.h));
    }
    if (rects.tp) { tpCam.aspect = tp.w / tp.h; tpCam.updateProjectionMatrix(); tpChain.setSize(tp.w, tp.h, renderer.getPixelRatio()); }
  }
  addEventListener('resize', layout);
  new ResizeObserver(layout).observe(stage);

  // ---------- кадр ----------
  const look = V();
  function update(dt) {
    st.time += dt;
    st.stepTime += dt * player.speed;
    const s = player.step;
    if (player.index !== st.lastIndex) onStepChanged();

    // привязка (имитация): метки подсвечиваются, через 2,4 с — совмещено
    const aligning = player.state === State.ALIGNING;
    ws.markerFrames.forEach((f, i) => {
      f.visible = aligning || (s.kind === 'align' && st.stepTime < 3);
      f.material.opacity = aligning ? (st.stepTime > 0.4 + i * 0.4 ? 1 : 0.15) : 0.6;
    });
    if (aligning && st.stepTime > 0.6 + P.markers.length * 0.45) player.aligned(0.93, 0.8);

    // голограммы шага
    const ph = stepPhase(st.stepTime, s.fasteners.length);
    for (const [id, h] of parts.holo) {
      const cur = s.parts.includes(id) && player.state !== State.DONE && !aligning;
      const checkAll = s.kind === 'check' && player.state !== State.DONE;
      const installedBefore = P.steps.slice(0, player.index).some((x) => x.parts.includes(id));
      h.visible = cur || (checkAll && installedBefore);
      if (!h.visible) continue;
      const T = parts.target.get(id);
      if (cur) {
        arcPoint(parts.src.get(id), T.position, ph.fly, P.isFixture ? 0.18 : 0.12, h.position);
        h.quaternion.copy(T.quaternion);
        setHoloColor(h, ph.fly >= 1 ? HOLO.ok : HOLO.part, ph.fly >= 1 ? 0.7 + 0.3 * Math.sin(st.time * 5) : 1);
      } else {
        h.position.copy(T.position); h.quaternion.copy(T.quaternion);
        setHoloColor(h, HOLO.ok, 0.45 + 0.25 * Math.sin(st.time * 3));
      }
    }
    for (const [id, f] of parts.fast) {
      const i = s.fasteners.indexOf(id);
      f.visible = i >= 0 && i <= ph.fastIndex && !aligning && player.state !== State.DONE;
      if (f.visible) f.scale.setScalar(1 + 0.25 * Math.sin(st.time * 7 + i));
    }
    hud.progress(player.state === State.DONE ? 1 : (st.stepTime % ph.cycle) / ph.cycle);
    if (player.state === State.SHOWING) hud.status(aligning ? '' : `Привязка: меток ${P.markers.length} · 0,8 мм · «сборка дальше» — следующий шаг`);
    if (aligning) hud.status(`Поиск меток… ${Math.min(P.markers.length, Math.floor(st.stepTime / 0.45))}/${P.markers.length}`);
    if (player.state === State.DONE) hud.status('Операция завершена · журнал на сервере участка');

    // сообщения чата по сценарию
    while (st.chatQueue.length && st.chatQueue[0].t <= st.stepTime / player.speed) {
      const m = st.chatQueue.shift(); hud.chat(m.a, m.m);
    }

    // автопоказ
    if (ui.auto) {
      if (player.state === State.DONE) { st.doneT += dt; if (st.doneT > 4) { player.start(0); onStepChanged(); } }
      else if (!aligning && ph.loops >= 1) {
        const need = player.needs();
        if (need === 'value') command('value', s.check?.nominal_mm ?? s.params?.torque_nm ?? 0);
        else if (need === 'photo') command('photo');
        else command('next');
      }
    }

    // голова: взгляд на детали шага, плавно; дыхание; перетаскивание мышью
    const f = V(...stepFocus(P, s));
    if (s.kind !== 'install' && s.kind !== 'adjust') f.lerp(V(...P.bounds.center), 0.5);
    head.focus.lerp(f, 1 - Math.exp(-dt * 1.5));
    const bob = V(0.003 * Math.sin(st.time * 0.9), 0.005 * Math.sin(st.time * 1.6), 0);
    head.pos.copy(base).add(bob);
    look.copy(head.focus).sub(head.pos);
    head.yaw = Math.atan2(-look.x, -look.z) + head.dragYaw + 0.01 * Math.sin(st.time * 0.7);
    head.pitch = Math.atan2(look.y, Math.hypot(look.x, look.z)) + head.dragPitch;
    eyeCam.position.copy(head.pos);
    eyeCam.rotation.set(head.pitch, head.yaw, 0, 'YXZ');
    eye.u.gaze.value.set(0, 0);
    worker.update(head.pos, eyeCam.quaternion, head.yaw);
    orbit.update();
  }

  function render(dt) {
    const { H } = rects;
    renderer.setScissorTest(true);
    if (rects.fp) {
      const r = rects.fp;
      renderer.setViewport(r.x, H - r.y - r.h, r.w, r.h);
      renderer.setScissor(r.x, H - r.y - r.h, r.w, r.h);
      worker.visible = false;
      eye.render(st.time, dt);
    }
    if (rects.tp) {
      const r = rects.tp;
      renderer.setViewport(r.x, H - r.y - r.h, r.w, r.h);
      renderer.setScissor(r.x, H - r.y - r.h, r.w, r.h);
      worker.visible = true;
      tpChain.render(dt);
    }
    renderer.setScissorTest(false);
  }

  syncUi();
  onStepChanged();
  hud.togglePanel(q.get('panel') !== '0' && innerWidth > 700);
  let last = performance.now();
  renderer.setAnimationLoop((now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    update(dt);
    render(dt);
  });
  window.__demo = { ready: true, P, player, ui, command, scene, tpCam, eyeCam, parts };
}

main().catch((e) => {
  console.error(e);
  note(`Ошибка запуска: ${e.message}`);
  window.__demo = { ready: false, error: String(e) };
});
