// Standalone renderer dev page (web/render-dev.html): profile selector, camera modes, the three reference shots of the
// control route, a fake WorldView with the six NPCs of data/npcs.json at their zone stand points, emergency toggle,
// "run route" with the JSON report, a live frame-time graph with p50/p95/p99.
// Automation: window.__renderer, window.__ready (first frame of the final scene), window.__shot(name).
// URL: ?profile=W60&shot=mars_horizon|surface_to_cave|mira_at_equipment|wide_colony|emergency&cam=orbit|free|route
//      &ui=0 (hide panels) &actors=0 &emergency=1 &sealed=1 &cycle=1
import type { ActorView, FrameSample, MarkerView, QualityProfile, RendererStatus, RouteReport, SceneLayout, Vec3, WorldView } from '../contracts.ts';
import { createRenderer, isRendererUnavailable, type EchoRenderer } from './index.ts';
import { percentiles } from '../bench/route.ts';
import profilesData from '../../../data/profiles.json' with { type: 'json' };
import layoutData from '../../../data/scene/d0_layout.json' with { type: 'json' };
import npcsData from '../../../data/npcs.json' with { type: 'json' };

declare global {
  interface Window {
    __renderer?: EchoRenderer;
    __ready?: boolean;
    __shot?: (name: string) => Promise<boolean>;
    __lastReport?: RouteReport;
    __status?: RendererStatus;
  }
}

const profiles = (profilesData as unknown as { quality_profiles: QualityProfile[] }).quality_profiles;
const scene = layoutData as unknown as SceneLayout;
const npcs = (npcsData as unknown as { npcs: { id: string; name_ru: string; zone: string; color: Vec3 }[] }).npcs;
const params = new URLSearchParams(location.search);
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

if (params.get('ui') === '0') document.body.classList.add('noui');

// ---------------------------------------------------------------- fake world (dev fixture, not game logic)
/** Where each NPC stands in the dev scene; Mira stands at niche A, the spot the control route films face to face. */
const PLACEMENT: Record<string, { zone: string; gesture: ActorView['gesture']; activity: ActorView['activity']; look?: string }> = {
  mira: { zone: 'niche_a', gesture: 'look_at_player', activity: 'talking' },
  yun: { zone: 'garage', gesture: 'none', activity: 'walking' },
  leila: { zone: 'lab_geo', gesture: 'point_at_target', activity: 'idle', look: 'surface_ridge' },
  thomas: { zone: 'medbay', gesture: 'nod', activity: 'talking' },
  nika: { zone: 'workshop', gesture: 'check_device', activity: 'working' },
  samir: { zone: 'power_hub', gesture: 'wary', activity: 'idle' },
};
const CYCLE: ActorView['gesture'][] = ['nod', 'point_at_target', 'look_at_player', 'pause', 'wary', 'shrug', 'check_device'];

const state = {
  actors: params.get('actors') !== '0',
  cycle: params.get('cycle') === '1',
  emergency: params.get('emergency') === '1',
  sealed: params.get('sealed') === '1',
  bio: true,
  t0: performance.now(),
};

function stand(zone: string): Vec3 {
  return scene.zone_stand_points[zone] ?? [0, 0, 0];
}

function buildWorld(): WorldView {
  const simT = (performance.now() - state.t0) / 1000;
  const actors: ActorView[] = [];
  if (state.actors) {
    npcs.forEach((n, i) => {
      const p = PLACEMENT[n.id] ?? { zone: n.zone, gesture: 'none' as const, activity: 'idle' as const };
      const pos = stand(p.zone);
      let gesture = p.gesture;
      if (state.cycle && n.id !== 'yun') gesture = CYCLE[(Math.floor(simT / 5) + i) % CYCLE.length];
      const a: ActorView = {
        id: n.id, name: n.name_ru, position: [pos[0], 0, pos[2]], gesture, activity: p.activity, color: n.color,
        speaking: n.id === 'mira' || (n.id === 'thomas' && Math.floor(simT / 3) % 2 === 0),
      };
      if (p.look) a.lookAt = [...(scene.anchors[p.look] ?? [0, 0, 0])].map((v, k) => (k === 1 ? 2 : v)) as Vec3;
      if (n.id === 'yun') {
        // Yun walks back and forth between the garage and the rover.
        const rover = scene.props.find((x) => x.kind === 'rover')?.position ?? [34, 0, 19];
        const there = Math.floor(simT / 14) % 2 === 1;
        a.target = there ? [rover[0] - 3.5, 0, rover[2] - 2.5] : [pos[0], 0, pos[2]];
        a.activity = 'walking';
      }
      if (n.id === 'nika') a.lookAt = undefined;
      actors.push(a);
    });
  }
  const markers: MarkerView[] = [];
  const alarm = state.emergency ? 1 : 0.35;
  markers.push({ id: 'sensor_a', kind: 'sensor', position: [-5.3, 0, 7.6], intensity: alarm, color: state.emergency ? [1, 0.18, 0.08] : [1, 0.62, 0.2] });
  if (state.emergency) markers.push({ id: 'task_inspect', kind: 'task', position: [-2.6, 0, 9.6], intensity: 0.8, color: [0.4, 0.8, 1] });
  return {
    simTimeS: simT,
    emergencyLights: state.emergency,
    sealedZones: state.sealed ? ['sector_c'] : [],
    actors,
    markers,
    biography: state.bio ? [
      { zone: 'niche_a', anchor: 'niche_a_panel', detail_id: 'repair_tape' },
      { zone: 'niche_b', anchor: 'niche_b_rack', detail_id: 'note' },
      { zone: 'workshop', anchor: 'ws_wall_tools', detail_id: 'shared_tool_layout' },
      { zone: 'airlock_a', anchor: 'airlock_bench', detail_id: 'personal_item' },
    ] : [],
  };
}

// ---------------------------------------------------------------- UI
const canvas = $<HTMLCanvasElement>('view');
const statusBox = $('status');
const statusText = $('statusText');
const statusBar = $('statusBar');
const samples: FrameSample[] = [];
let framesSinceReady = -1;
let shotWaiters: { frames: number; resolve: (ok: boolean) => void }[] = [];

/** Dev-only overrides for A/B checks: ?ao=off|half&bloom=0|1&scale=0.75 (the profile file itself is not changed). */
function withOverrides(p: QualityProfile): QualityProfile {
  const r = { ...p.render };
  const ao = params.get('ao');
  if (ao === 'off' || ao === 'half' || ao === 'full') r.ao = ao;
  if (params.has('bloom')) r.bloom = params.get('bloom') === '1';
  const scale = Number(params.get('scale'));
  return { ...p, render: r, render_scale: scale > 0 && scale <= 2 ? scale : p.render_scale };
}

function profileById(id: string | null): QualityProfile {
  return withOverrides(profiles.find((p) => p.id === id) ?? profiles.find((p) => p.id === 'W60') ?? profiles[0]);
}

let profile = profileById(params.get('profile'));
const sel = $<HTMLSelectElement>('profile');
for (const p of profiles) {
  const o = document.createElement('option');
  o.value = p.id;
  o.textContent = `${p.label_ru} — ${p.output[0]}×${p.output[1]}, масштаб ${p.render_scale}${p.platform === 'native' ? ' (нативный профиль)' : ''}`;
  sel.appendChild(o);
}
sel.value = profile.id;

function onStatus(s: RendererStatus): void {
  window.__status = s;
  const busy = s.phase !== 'ready' && s.phase !== 'paused';
  statusBox.style.display = busy ? 'block' : 'none';
  const names: Record<RendererStatus['phase'], string> = {
    probing: 'Проверка WebGPU', compiling: 'Компиляция шейдеров', baking: 'Запекание сцены', ready: 'Готово',
    lost: 'Устройство потеряно', recovering: 'Восстановление', error: 'Ошибка', paused: 'Пауза',
  };
  statusText.textContent = `${names[s.phase]}${s.message ? ': ' + s.message : ''}${s.progress !== undefined ? ` — ${Math.round(s.progress * 100)}%` : ''}`;
  statusBar.style.width = `${Math.round((s.progress ?? (s.phase === 'ready' ? 1 : 0)) * 100)}%`;
  $('phase').textContent = `Состояние: ${names[s.phase]}${s.message && s.phase !== 'ready' ? ' — ' + s.message : ''}`;
  if (s.phase === 'ready' && framesSinceReady < 0) framesSinceReady = 0;
  if (s.phase === 'lost' || s.phase === 'recovering') { window.__ready = false; framesSinceReady = -1; }
}

function onFrame(s: FrameSample): void {
  samples.push(s);
  if (samples.length > 240) samples.shift();
  if (framesSinceReady >= 0) {
    framesSinceReady++;
    if (framesSinceReady >= 3 && !window.__ready) window.__ready = true;
  }
  for (const w of shotWaiters) w.frames--;
  const done = shotWaiters.filter((w) => w.frames <= 0);
  shotWaiters = shotWaiters.filter((w) => w.frames > 0);
  for (const w of done) w.resolve(true);
}

function waitFrames(n: number): Promise<boolean> {
  return new Promise((resolve) => shotWaiters.push({ frames: n, resolve }));
}

function drawGraph(): void {
  const g = $<HTMLCanvasElement>('graph');
  const ctx = g.getContext('2d');
  if (!ctx) return;
  const W = g.width, H = g.height;
  ctx.clearRect(0, 0, W, H);
  const maxMs = 50;
  const y = (ms: number) => H - Math.min(ms, maxMs) / maxMs * H;
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.setLineDash([4, 4]);
  for (const ms of [16.67, 33.3]) { ctx.beginPath(); ctx.moveTo(0, y(ms)); ctx.lineTo(W, y(ms)); ctx.stroke(); }
  ctx.setLineDash([]);
  const series: [string, (s: FrameSample) => number | null][] = [['#ff9a52', (s) => s.intervalMs || null], ['#7ec8ff', (s) => s.gpuMs], ['#9be08f', (s) => s.cpuMs]];
  for (const [color, f] of series) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    let started = false;
    samples.forEach((s, i) => {
      const v = f(s);
      if (v === null) return;
      const x = (i / 239) * W;
      if (!started) { ctx.moveTo(x, y(v)); started = true; } else ctx.lineTo(x, y(v));
    });
    ctx.stroke();
  }
}

function updateMetrics(): void {
  const r = window.__renderer;
  const iv = percentiles(samples.map((s) => s.intervalMs).filter((x) => x > 0));
  const cpu = percentiles(samples.map((s) => s.cpuMs));
  const gpuVals = samples.map((s) => s.gpuMs).filter((x): x is number => x !== null);
  const gpu = gpuVals.length ? percentiles(gpuVals) : null;
  const info = r?.debugInfo();
  const rows: [string, string][] = [
    ['Интервал кадра', `p50 ${iv.p50.toFixed(1)} · p95 ${iv.p95.toFixed(1)} · p99 ${iv.p99.toFixed(1)} мс`],
    ['CPU (сборка+submit)', `p50 ${cpu.p50.toFixed(2)} · p99 ${cpu.p99.toFixed(2)} мс`],
    ['GPU (timestamp)', gpu ? `p50 ${gpu.p50.toFixed(2)} · p95 ${gpu.p95.toFixed(2)} · p99 ${gpu.p99.toFixed(2)} мс` : 'недоступно'],
    ['Разрешение', info ? `${info.internalSize.join('×')} → ${info.canvasSize.join('×')} (масштаб ${info.renderScale})` : '—'],
    ['Камера', info ? `${info.cameraMode}${info.routeSegment ? ` · ${info.routeSegment} · t=${info.routeTime.toFixed(1)} с` : ''}` : '—'],
    ['Сцена', info ? `патчей ${info.stats.terrainPatches ?? 0}, мешей ${info.stats.meshDraws ?? 0}, источников света ${info.stats.lights ?? 0}` : '—'],
    ['Ошибки WebGPU', info ? String(info.validationErrors.length) : '—'],
  ];
  const last = samples[samples.length - 1];
  if (last?.passes) rows.push(['Проходы GPU', Object.entries(last.passes).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', ')]);
  const kv = $('kv');
  kv.replaceChildren(...rows.flatMap(([k, v]) => { const b = document.createElement('b'); b.textContent = k; const s = document.createElement('span'); s.textContent = v; return [b, s]; }));
  drawGraph();
}

// ---------------------------------------------------------------- shots
const SHOT_IDS = scene.control_route.reference_shots.map((s) => s.id);
const SHOT_LABELS: Record<string, string> = { mars_horizon: 'Горизонт Марса', surface_to_cave: 'Поверхность → пещера', mira_at_equipment: 'Мира у оборудования' };

function applyShot(name: string): boolean {
  const r = window.__renderer;
  if (!r) return false;
  r.focusActor(null);
  const ref = scene.control_route.reference_shots.find((s) => s.id === name);
  if (ref) { r.setRouteTime(ref.t); return true; }
  if (name === 'emergency') {
    state.emergency = true;
    ($('emergencyChk') as HTMLInputElement).checked = true;
    r.setWorldView(buildWorld());
    const key = scene.control_route.keys.find((k) => k.segment === 'emergency');
    r.setRouteTime((key?.t ?? 196) + 1.5);
    return true;
  }
  if (name === 'wide_colony') {
    r.setCameraMode('orbit');
    const cam = r.camera;
    cam.orbitTarget = [9, 1.5, -3];
    cam.orbitDist = 74;
    cam.orbitPitch = 0.36;
    cam.orbitYaw = -0.62;
    return true;
  }
  return false;
}

window.__shot = async (name: string) => {
  if (!applyShot(name)) return false;
  return waitFrames(3);
};

// ---------------------------------------------------------------- boot
async function boot(): Promise<void> {
  try {
    const r = await createRenderer({ canvas, profile, scene, onFrame, onStatus }) as EchoRenderer;
    window.__renderer = r;
    $('adapter').textContent = `Адаптер: ${[r.adapter.vendor, r.adapter.architecture, r.adapter.description].filter(Boolean).join(' · ') || 'нет данных'}${r.adapter.isSoftware ? ' — программный (SwiftShader/CPU): не доказательство производительности' : ''}`;
    r.setWorldView(buildWorld());
    const tm = params.get('tm');
    if (tm === 'aces' || tm === 'agx') r.setTonemapper(tm);
    if (params.has('ev')) r.setExposureCompensation(Number(params.get('ev')) || 0);
    const cam = params.get('cam');
    if (cam === 'orbit' || cam === 'free' || cam === 'route') r.setCameraMode(cam);
    else applyShot('wide_colony');
    const shot = params.get('shot');
    if (shot) applyShot(shot);
    setInterval(() => window.__renderer?.setWorldView(buildWorld()), 250);
  } catch (e) {
    statusBox.style.display = 'block';
    statusBar.style.width = '0';
    if (isRendererUnavailable(e)) {
      statusText.textContent = `WebGPU недоступен (${e.reason}): ${e.message} Откройте tools/webgpu_probe.html для диагностики или используйте нативную сборку.`;
    } else {
      statusText.textContent = `Ошибка запуска рендера: ${String((e as Error)?.message ?? e)}`;
      console.error(e);
    }
  }
}

function wireUi(): void {
  sel.addEventListener('change', async () => {
    profile = profileById(sel.value);
    const u = new URL(location.href);
    u.searchParams.set('profile', profile.id);
    history.replaceState(null, '', u);
    window.__ready = false;
    framesSinceReady = -1;
    await window.__renderer?.setProfile(profile);
  });
  for (const b of document.querySelectorAll<HTMLButtonElement>('#camModes button')) {
    b.addEventListener('click', () => window.__renderer?.setCameraMode(b.dataset.mode as 'orbit' | 'free' | 'route'));
  }
  const shots = $('shots');
  for (const id of SHOT_IDS) {
    const b = document.createElement('button');
    b.textContent = SHOT_LABELS[id] ?? id;
    b.addEventListener('click', () => applyShot(id));
    shots.appendChild(b);
  }
  $('wideBtn').addEventListener('click', () => applyShot('wide_colony'));
  let focused = false;
  $('focusBtn').addEventListener('click', () => { focused = !focused; window.__renderer?.focusActor(focused ? 'mira' : null); $('focusBtn').classList.toggle('on', focused); });
  const chk = (id: string, key: 'actors' | 'cycle' | 'emergency' | 'sealed' | 'bio') => {
    const el = $<HTMLInputElement>(id);
    el.checked = state[key];
    el.addEventListener('change', () => { state[key] = el.checked; window.__renderer?.setWorldView(buildWorld()); });
  };
  chk('actorsChk', 'actors'); chk('cycleChk', 'cycle'); chk('emergencyChk', 'emergency'); chk('sealChk', 'sealed'); chk('bioChk', 'bio');
  $('lossBtn').addEventListener('click', () => window.__renderer?.simulateDeviceLoss());
  $('routeBtn').addEventListener('click', async () => {
    const r = window.__renderer;
    if (!r) return;
    const full = $<HTMLSelectElement>('routePasses').value === 'full';
    const btn = $<HTMLButtonElement>('routeBtn');
    btn.disabled = true;
    try {
      const report = await r.runRoute({
        warmupPasses: 1, passes: full ? 3 : 1, passDurationS: full ? scene.control_route.duration_s : 60,
        onProgress: (p) => { btn.textContent = `Проход ${p.pass + 1}: ${p.segment} ${p.t.toFixed(0)} с`; },
      });
      window.__lastReport = report;
      $('reportText').textContent = JSON.stringify(report, null, 2);
      $('report').style.display = 'flex';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Прогнать маршрут';
    }
  });
  $('reportClose').addEventListener('click', () => { $('report').style.display = 'none'; });
  $('reportSave').addEventListener('click', () => {
    const blob = new Blob([$('reportText').textContent ?? ''], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `route-report-${profile.id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  setInterval(updateMetrics, 500);
}

wireUi();
void boot();
