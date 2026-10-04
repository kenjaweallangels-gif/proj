// Точка входа для tools/music_render.mjs: офлайн-рендер музыки (OfflineAudioContext) без игры. Собирается esbuild в IIFE.
import { createEngine } from '../src/audio/engine.js';
import { createMusic } from '../src/audio/music.js';
import data from '../src/data/data.js';

function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
class V3 { set() { return this; } applyQuaternion() { return this; } getWorldPosition() { return this; } }

/**
 * renderMusic({state, seconds, seed, raw, sr, threat:[t,v,...], speech:[a,b], switches:[[t,state],...]}) → {b64, sr, ch, n}
 * threat — кусочно-линейная worm.threat(t); speech — окно «речи» на шине vo (для проверки дакинга); switches — смена состояний по времени.
 */
window.renderMusic = async (o) => {
  const sr = o.sr || 48000, seconds = o.seconds || 30;
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sr), sr);
  let now = 0;
  const pts = o.threat || [0, 0.4, 1000, 0.4];
  const th = () => { for (let i = 0; i + 3 < pts.length; i += 2) if (now <= pts[i + 2]) { const k = (now - pts[i]) / (pts[i + 2] - pts[i] || 1); return pts[i + 1] + (pts[i + 3] - pts[i + 1]) * Math.min(1, Math.max(0, k)); } return pts[pts.length - 1]; };
  const game = {
    settings: { volume: { master: 0.9, music: 0.8, sfx: 1, amb: 1, vo: 1 } }, THREE: { Vector3: V3 }, data, bus: { emit() {} },
    worm: { get threat() { return th(); } },
  };
  const eng = createEngine(game, { ctx, raw: !!o.raw });
  if (o.speech) eng.voLevel = () => (now >= o.speech[0] && now < o.speech[1] ? 0.05 : 0);
  const music = createMusic(game, eng, { manual: true, clock: () => now, rand: mulberry32(o.seed || 1) });
  await music.load();
  const sw = (o.switches || []).slice();
  music.set(o.state);
  for (now = 0; now < seconds; now += 0.07) {
    while (sw.length && sw[0][0] <= now) music.set(sw.shift()[1]);
    music.step(now);
  }
  const buf = await ctx.startRendering();
  const l = buf.getChannelData(0), r = buf.getChannelData(1), n = l.length;
  const inter = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { inter[2 * i] = l[i]; inter[2 * i + 1] = r[i]; }
  const u8 = new Uint8Array(inter.buffer);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return { b64: btoa(s), sr, ch: 2, n };
};
window.__ready = true;
