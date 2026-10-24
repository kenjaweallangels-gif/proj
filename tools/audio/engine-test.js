/**
 * Offline render of the real audio engine (src/audio) with a scripted 64 s scenario and a fake game context,
 * driven through OfflineAudioContext.suspend() at 30 Hz. Used by tools/audio/render-engine.mjs.
 *
 *   window.renderEngine({ seconds, taps: 'all' | 'air' }) -> { sr, seconds, wallMs, pcm (base64 int16 stereo), marks }
 *
 * Scenario (seconds): 0-8 IVA in the lab (grabs, push-off, bump, velcro, laptop events) · 8-12 equipment lock:
 * donning · 12-20 crew lock depress (pressure 1 -> 0) · 20-24 outer hatch opens (vacuum) · 24-40 EVA: SAFER
 * pulses, boost, rotation, grab, crawl, tether snatch, radio, high heart rate · 40-48 hatch close + repress ·
 * 48-64 gravity ring corridor: footsteps grate / carpet, jump + landing, ladder rungs; a ship captures at 54 s.
 */
import * as THREE from 'three';
import { Audio } from '../../src/audio/Audio.js';

class Emitter { constructor() { this.m = new Map(); } on(n, f) { if (!this.m.has(n)) this.m.set(n, new Set()); this.m.get(n).add(f); return () => this.m.get(n).delete(f); } emit(n, d) { for (const f of this.m.get(n) || []) f(d); } }

function makeCtx() {
  const camera = new THREE.PerspectiveCamera();
  const zone = (id, frame, c, r) => ({ id, frame, sphere: { center: new THREE.Vector3(...c), radius: r }, portals: [] });
  const lab = zone('lab', 'station', [-9, 0, 0], 7.5), node1 = zone('node1', 'station', [-18.5, 0, 0], 3), hab2 = zone('hab2', 'station', [9, 0, 0], 6.5);
  const E = zone('airlockE', 'station', [-18.5, 0, 6], 2.5), C = zone('airlockC', 'station', [-18.5, 0, 9.5], 1.8);
  const cor = zone('cor0', 'ring', [0, 30, 20], 22);
  const inner = { isOpen: true, progress: 1 }, outer = { isOpen: false, progress: 0, isMoving: false };
  const link = (a, b, gate = null) => { a.portals.push({ zone: b, gate }); b.portals.push({ zone: a, gate }); };
  link(lab, node1); link(node1, hab2); link(node1, E); link(E, C, inner);
  const zones = [lab, node1, hab2, E, C, cor];
  const interior = { enabled: true, ready: true, cameraZone: lab, byId: new Map(zones.map((z) => [z.id, z])), ringInv: new THREE.Matrix4(), ringMat: new THREE.Matrix4() };
  const state = {
    mode: 'iva', suited: false, inside: true, frame: 'station', compartment: 'lab', heartRate: 66, o2: 1, power: 1, propellant: 1, airlockPressure: 1,
    thrusting: false, boost: false, killing: false, rotationThrust: 0, holding: null, contact: false, tetherAttached: false, tetherStowed: true, tetherTaut: false,
    reeling: false, speedRelative: 0, sequence: null, onLadder: false, gravity: 0,
  };
  const player = { state, velocity: new THREE.Vector3(), position: camera.position, body: { events: [] }, iva: { zone: lab, pL: new THREE.Vector3(), vL: new THREE.Vector3(), grounded: true } };
  const ctx = {
    params: new URLSearchParams(), camera, events: new Emitter(), player, mode: 'play', time: { scale: 1 },
    station: { interior, airlock: { innerHatch: inner, hatch: outer, innerHatchCenter: new THREE.Vector3(-18.5, 0, 8), hatchCenter: new THREE.Vector3(-18.5, 0, 11), standPosition: new THREE.Vector3(-18.5, 0, 9.5) } },
    orbit: { sunVisible: 1 }, hud: { menu: { visible: false }, notify: () => {} }, ships: { ships: [] }, app: { paused: false },
    assetUrl: (p) => `/public/${p}`,
  };
  return { ctx, zones: { lab, node1, hab2, E, C, cor }, inner, outer };
}

/** Scripted state at time t (s); fires one-shot calls at the right steps. */
function scenario(t, dt, S, audio, marks) {
  const { ctx, zones, inner, outer } = S, st = ctx.player.state, cam = ctx.camera, I = ctx.station.interior;
  const once = (key, fn) => { if (!S.done.has(key)) { S.done.add(key); marks.push([+t.toFixed(2), key]); fn(); } };
  const at = (x) => t >= x;
  if (t < 8) {
    I.cameraZone = zones.lab; cam.position.set(-9 + t * 0.3, 0, 0);
    ctx.player.velocity.set(Math.sin(t * 2) * 0.6, 0, 0);
    if (at(1)) once('grab', () => audio.play('grab'));
    if (at(2)) once('push-off', () => audio.play('release'));
    if (at(3.5)) once('bump', () => audio.play('impact', { strength: 0.35 }));
    if (at(5)) once('body event grab', () => ctx.player.body.events.push({ type: 'grab', strength: 0.6 }));
    if (at(6)) once('body event push', () => ctx.player.body.events.push({ type: 'push', strength: 0.5 }));
  } else if (t < 12) {
    I.cameraZone = zones.E; cam.position.set(-18.5, 0, 6);
    ctx.player.velocity.set(0, 0, 0);
    if (at(8.2)) once('don', () => { st.sequence = { name: 'don', progress: 0 }; audio.play('suit', { duration: 3.5 }); });
    if (at(11.7)) once('suited', () => { st.sequence = null; st.suited = true; st.mode = 'airlock'; audio.play('clunk'); });
  } else if (t < 20) {
    I.cameraZone = zones.C; cam.position.set(-18.5, 0, 9.5);
    if (at(12)) once('inner close + depress', () => { inner.isOpen = false; inner.progress = 0; st.sequence = { name: 'depress', progress: 0 }; audio.play('depress', { duration: 8 }); });
    st.sequence.progress = Math.min(1, (t - 12) / 8);
    st.airlockPressure = 1 - st.sequence.progress;
  } else if (t < 24) {
    if (at(20)) once('hatch open', () => { st.sequence = { name: 'hatchOpen', progress: 0 }; outer.isMoving = true; });
    st.airlockPressure = 0; outer.progress = Math.min(1, (t - 20) / 3.6); st.sequence.progress = outer.progress;
    if (at(23.8)) once('eva', () => { outer.isMoving = false; outer.isOpen = true; st.sequence = null; st.mode = 'eva'; st.inside = false; st.tetherAttached = true; st.tetherStowed = false; audio.play('grab'); });
  } else if (t < 40) {
    I.cameraZone = null; cam.position.set(-18.5 + (t - 24) * 0.4, 0, 14 + (t - 24) * 0.6);
    st.thrusting = (t > 25 && t < 28); st.boost = t > 27 && t < 28; st.rotationThrust = t > 29 && t < 30 ? 0.8 : 0;
    st.heartRate = t > 36 ? 128 : 80;
    if (at(30.5)) once('eva grab', () => { st.holding = {}; audio.play('grab'); });
    audio.setParam('crawl', t > 31 && t < 34 ? 1 : 0);
    if (at(34)) once('eva release', () => { st.holding = null; audio.play('release'); });
    st.tetherTaut = t > 35 && t < 36;
    if (at(36.5)) once('radio', () => audio.play('radio'));
    if (at(38)) once('explosion outside (silent)', () => audio.event('explosion', { strength: 1 }));
  } else if (t < 48) {
    I.cameraZone = zones.C; cam.position.set(-18.5, 0, 9.5); st.heartRate = 90;
    if (at(40)) once('hatch close', () => { st.mode = 'airlock'; st.inside = true; st.tetherAttached = false; st.tetherStowed = true; st.sequence = { name: 'close', progress: 0 }; outer.isMoving = true; });
    if (t < 43.5) { outer.progress = Math.max(0, 1 - (t - 40) / 3.5); st.sequence.progress = 1 - outer.progress; }
    else {
      if (at(43.5)) once('repress', () => { outer.isMoving = false; outer.isOpen = false; st.sequence = { name: 'repress', progress: 0 }; });
      if (st.sequence) { st.sequence.progress = Math.min(1, (t - 43.5) / 4); st.airlockPressure = st.sequence.progress; }
      if (at(47.6)) once('repressed', () => { st.sequence = null; st.airlockPressure = 1; });
    }
  } else {
    if (at(48)) once('ring', () => { st.suited = false; st.mode = 'iva'; st.frame = 'ring'; I.cameraZone = zones.cor; ctx.player.iva.zone = zones.cor; S.stepT = 0; });
    const x = t < 54 ? 0.3 : 2.2;                      // aisle grating, then carpet
    ctx.player.iva.pL.set(x, 40, 0);
    cam.position.set(x, 40, (t - 48) * 1.4);
    st.speedRelative = 1.5;
    S.stepT -= dt;
    if (t < 60 && S.stepT <= 0) { S.stepT = 0.55; audio.play('step'); }
    if (at(56)) once('jump', () => ctx.player.body.events.push({ type: 'jump', strength: 0.5 }));
    if (at(56.7)) once('land', () => ctx.player.body.events.push({ type: 'land', strength: 0.7 }));
    if (at(54)) once('ship capture', () => ctx.events.emit('ship', { type: 'capture', port: { position: new THREE.Vector3(30, 40, 30) } }));
    if (t > 60) { const k = Math.floor((t - 60) / 0.45); if (k !== S.rung) { S.rung = k; audio.play('rung'); } }
  }
  cam.updateMatrixWorld();
}

window.renderEngine = async ({ seconds = 64, taps = 'all', sr = 48000 } = {}) => {
  const S = makeCtx();
  S.done = new Set(); S.stepT = 0; S.rung = -1;
  const marks = [];
  const off = new OfflineAudioContext(2, Math.round(seconds * sr), sr);
  const audio = new Audio(S.ctx);
  audio.settings = { master: 1, music: 0, sfx: 0.85, ambience: 0.75, voice: 0.8, ui: 0.6, musicOn: false };
  audio.start(off, { music: false });
  const mx = audio.engine.mixer;
  if (taps === 'air') { for (const k of ['body', 'suit', 'radio', 'ui']) mx.in[k].disconnect(); mx.radioOut.disconnect(); }
  // let the worker render the bank first (loops only start once their buffers exist)
  const bank = audio.engine.bank;
  const t0 = performance.now();
  while ((bank.pending.size || bank.queue.length) && performance.now() - t0 < 120000) await new Promise((r) => setTimeout(r, 50));
  const prepMs = performance.now() - t0;
  const step = 1 / 30;
  for (let k = 1; k * step < seconds; k++) {
    const t = k * step;
    off.suspend(t).then(() => { scenario(t, step, S, audio, marks); audio.update(step, S.ctx); off.resume(); });
  }
  const w0 = performance.now();
  const buf = await off.startRendering();
  const wallMs = performance.now() - w0;
  const L = buf.getChannelData(0), R = buf.getChannelData(1), n = L.length;
  const i16 = new Int16Array(n * 2);
  for (let i = 0; i < n; i++) { i16[2 * i] = Math.max(-32767, Math.min(32767, Math.round(L[i] * 32767))); i16[2 * i + 1] = Math.max(-32767, Math.min(32767, Math.round(R[i] * 32767))); }
  let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  const bytes = new Uint8Array(i16.buffer);
  let bin = ''; const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return { sr, seconds, wallMs, prepMs, peak: pk, pcm: btoa(bin), marks, syncMs: bank.syncMs, cached: bank.cache.size };
};
window.__engineTestReady = true;
