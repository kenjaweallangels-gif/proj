/**
 * Procedural foley bank: every sound effect of the station is synthesised here from noise, modal
 * resonators and formant filters (no sample files). Pure JS (see dsp.js) so the same code runs in the
 * browser (filling AudioBuffers on demand) and in Node (tools/audio/foley-render.mjs renders and analyses
 * each entry offline).
 *
 *   FOLEY[name] = { n: variants, loop?: true, stereo?: true, gen(sr, rng, v) -> Float32Array | [L, R] }
 *   generate(name, sr, variant) -> { channels: Float32Array[], loop }
 *
 * Levels: one-shots are peak-normalised to ~0.9 (the engine sets the playback gain per event), loops are
 * RMS-normalised (LOOP_RMS = 0.18) so their gains in the engine mean the same thing.
 */
import {
  TAU, makeRng, rr, gauss, Biquad, filt, onePole, white, pink, brown, normalize, scale, removeDC, fades, mixInto,
  makeLoop, dec60, ad, spectralLoop, loopAM, impact,
} from './dsp.js';

const S = (sr, s) => Math.max(8, Math.round(s * sr));
const LOOP_RMS = 0.18;   // loops: RMS -15 dBFS (peaks stay below 0 dBFS)

// ----------------------------------------------------------------------------------------------- building blocks
/** Low body/structure thud: sine with a pitch drop + low-passed noise. */
function thud(sr, rng, { f = 80, drop = 0.65, decay = 0.09, dur = 0.35, noise = 0.35, noiseLP = 500, attack = 0.002 } = {}) {
  const n = S(sr, dur), out = new Float32Array(n);
  let ph = rng() * 0.2;
  for (let i = 0; i < n; i++) {
    const t = i / sr, fr = f * (drop + (1 - drop) * Math.exp(-t / (decay * 0.5)));
    ph += TAU * fr / sr;
    out[i] = Math.sin(ph) * ad(t, attack, decay * 3);
  }
  if (noise > 0) {
    const nb = white(n, rng);
    for (let i = 0; i < n; i++) nb[i] *= ad(i / sr, attack, decay * 1.6);
    filt(nb, sr, 'lp', noiseLP, 0.7, 0, 2);
    mixInto(out, nb, 0, noise * 2.5);
  }
  return fades(out, sr, 0.2, 10);
}

/** Shaped noise burst: type 'lp'|'bp'|'hp' at f (optionally sweeping to f1), attack / T60 decay. */
function burst(sr, rng, { dur = 0.2, f = 1500, f1 = null, q = 0.8, type = 'bp', attack = 0.004, decay = 0.1, color = 'white', stages = 1 } = {}) {
  const n = S(sr, dur);
  const src = color === 'pink' ? pink(n, rng) : color === 'brown' ? brown(n, rng) : white(n, rng);
  const out = new Float32Array(n);
  const fl = []; for (let s = 0; s < stages; s++) fl.push(new Biquad(sr).set(type, f, q));
  for (let i = 0; i < n; i++) {
    if (f1 && (i & 63) === 0) { const fc = f * Math.pow(f1 / f, i / n); for (const b of fl) b.set(type, fc, q); }
    let x = src[i];
    for (const b of fl) x = b.tick(x);
    out[i] = x * ad(i / sr, attack, decay);
  }
  return fades(out, sr, 0.3, 6);
}

/** Inharmonic metal modes around base (plates / tubes / brackets). */
function metal(rng, base, { count = 6, t60 = 0.2, spread = 0.07, ratios = [1, 1.59, 2.14, 2.83, 3.42, 4.17, 5.08, 6.11], amp = 1, tilt = 0.75 } = {}) {
  const m = [];
  for (let k = 0; k < Math.min(count, ratios.length); k++) m.push({ f: base * ratios[k] * (1 + (rng() - 0.5) * spread), t60: t60 * (0.6 + 0.8 * rng()) / (1 + k * 0.25), a: amp * tilt ** k * (0.6 + 0.8 * rng()) });
  return m;
}
const BAR = [1, 2.756, 5.404, 8.933, 13.34];         // free bar / tube modes
const PLATE = [1, 1.59, 2.14, 2.3, 2.65, 2.92, 3.5, 4.15];

/** Train of small clicks (ratchets, zippers, velcro): rate (Hz) maybe sweeping, each click a tiny modal tap. */
function clicks(sr, rng, { dur = 0.4, rate = 300, rate1 = null, f = 3000, t60 = 0.008, jitter = 0.3, env = null, hp = 800, noise = 0.6 } = {}) {
  const n = S(sr, dur), out = new Float32Array(n);
  let t = 0;
  while (t < dur) {
    const r = rate1 ? rate + (rate1 - rate) * (t / dur) : rate;
    const a = (env ? env(t / dur) : 1) * (0.5 + rng());
    const ff = f * (0.8 + 0.4 * rng());
    const len = Math.round(t60 * 1.5 * sr), i0 = Math.round(t * sr);
    const w = TAU * ff / sr, ph = rng() * TAU;
    for (let i = 0; i < len && i0 + i < n; i++) out[i0 + i] += a * (Math.sin(w * i + ph) * 0.6 + (rng() * 2 - 1) * noise) * dec60(i / sr, t60);
    t += (1 / r) * (1 + (rng() - 0.5) * 2 * jitter);
  }
  if (hp) filt(out, sr, 'hp', hp, 0.7);
  return fades(out, sr, 0.5, 5);
}

/** Fabric rustle: band-passed noise with fast random crinkle modulation. */
function rustle(sr, rng, { dur = 0.35, f = 2200, q = 0.7, crinkle = 0.7, attack = 0.05, decay = 0.25, hp = 300 } = {}) {
  const n = S(sr, dur), src = white(n, rng), out = new Float32Array(n);
  const b = new Biquad(sr).set('bp', f, q), h = new Biquad(sr).set('hp', hp, 0.7);
  let m = 0, target = 1;
  for (let i = 0; i < n; i++) {
    if ((i % 96) === 0) target = rng() < crinkle * 0.5 ? rng() * 1.8 : 0.4 + rng() * 0.5;
    m += (target - m) * 0.02;
    const t = i / sr;
    out[i] = h.tick(b.tick(src[i])) * m * (t < attack ? t / attack : dec60(t - attack, decay * 2.5));
  }
  return fades(out, sr, 1, 10);
}

/** Motor / gear whine source (for loops): harmonics of f with gear mesh, brush noise. */
function motorLoop(sr, rng, f, { gear = 14, gearAmp = 0.25, harmAmp = [1, 0.5, 0.3, 0.18, 0.1], noise = 0.4, n = 1 << 17, wobble = 0.004 }) {
  const tones = [];
  harmAmp.forEach((a, k) => tones.push({ f: f * (k + 1), a: a * 0.4, bw: f * (k + 1) * wobble }));
  tones.push({ f: f * gear, a: gearAmp * 0.4, bw: f * gear * wobble * 2 }, { f: f * gear * 2, a: gearAmp * 0.15, bw: f * gear * wobble * 3 });
  return spectralLoop(n, sr, rng, (fr) => noise * (fr < 80 ? fr / 80 : 1) * Math.exp(-fr / 6000) * (1 + 2 * Math.exp(-((fr - f * gear) ** 2) / (2 * (f * 2) ** 2))), tones, LOOP_RMS);
}

/** Room / equipment noise bed: shaped broadband loop (stereo, decorrelated). spec(f) -> magnitude. */
function bed(sr, rng, spec, tones = [], am = null, n = 1 << 18) {
  const ch = [0, 1].map(() => {
    const b = spectralLoop(n, sr, rng, spec, tones, LOOP_RMS);
    if (am) loopAM(b, am[0], am[1], rng() * TAU);
    return b;
  });
  return ch;
}
const tilt = (f, f0, slope) => Math.pow(Math.max(f, 20) / f0, -slope);

/** Breath: aspiration noise through three moving formants. */
function breath(sr, rng, { dur = 1.6, inhale = true, effort = 0 }) {
  const n = S(sr, dur), src = pink(n, rng), w = white(n, rng), out = new Float32Array(n);
  const F = inhale ? [[520, 3.0, 1.0], [1550, 4.0, 0.55], [2650, 5.0, 0.3]] : [[420, 2.2, 1.0], [1150, 3.0, 0.6], [2450, 4.0, 0.22]];
  const fl = F.map(([f, q]) => new Biquad(sr).set('bp', f, q));
  const hp = new Biquad(sr).set('hp', inhale ? 280 : 160, 0.7);
  const att = inhale ? 0.38 : 0.22, shape = inhale ? 1.4 : 1.0;
  const drift = rr(rng, -0.08, 0.08);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    if ((i & 63) === 0) {
      const k = 1 + drift * t + (inhale ? 0.06 * t : -0.05 * t);
      fl.forEach((b, j) => b.set('bp', F[j][0] * k, F[j][1]));
    }
    const env = t < att ? Math.sin(0.5 * Math.PI * t / att) ** shape : Math.cos(0.5 * Math.PI * (t - att) / (1 - att)) ** 1.6;
    const x = src[i] * (1 - 0.35 * effort) + w[i] * (0.15 + 0.35 * effort);
    let y = 0;
    for (let j = 0; j < 3; j++) y += fl[j].tick(x) * F[j][2];
    out[i] = hp.tick(y) * env * (1 + 0.25 * Math.sin(TAU * rr(rng, 3, 7) * i / sr) * (effort > 0.5 ? 1 : 0));
  }
  return fades(normalize(out, 0.9), sr, 2, 20);
}

/** Pseudo speech for radio chatter: PolyBLEP glottal source + vowel formants + consonant bursts. */
const VOWELS = [[730, 1090, 2440], [570, 840, 2410], [300, 870, 2240], [530, 1840, 2480], [300, 2200, 2950], [440, 1020, 2240], [660, 1700, 2400]];
function babble(sr, rng, { dur = 2.4, f0 = 120 }) {
  const n = S(sr, dur), out = new Float32Array(n);
  // syllable plan
  const syl = [];
  let t = 0.05;
  while (t < dur - 0.25) {
    const len = rr(rng, 0.11, 0.24), v = VOWELS[Math.floor(rng() * VOWELS.length)];
    syl.push({ t0: t, t1: t + len, v, acc: rng() < 0.3 ? 1.15 : 1, cons: rng() < 0.65 ? (rng() < 0.4 ? 's' : 'k') : null });
    t += len + (rng() < 0.18 ? rr(rng, 0.12, 0.3) : rr(rng, 0.01, 0.04));
  }
  const fl = [0, 1, 2].map(() => new Biquad(sr)), q = [5, 7, 9], g = [1.0, 0.55, 0.25];
  let ph = 0, si = 0, cur = VOWELS[0];
  const fric = new Biquad(sr).set('bp', 5200, 1.5);
  for (let i = 0; i < n; i++) {
    const tt = i / sr;
    while (si < syl.length - 1 && tt > syl[si].t1) si++;
    const s = syl[si];
    let amp = 0;
    if (s && tt >= s.t0 && tt <= s.t1) { const u = (tt - s.t0) / (s.t1 - s.t0); amp = Math.sin(Math.PI * u) ** 0.6 * s.acc; }
    if ((i & 31) === 0 && s) {
      const u = Math.min(1, Math.max(0, (tt - s.t0) / 0.06));
      for (let j = 0; j < 3; j++) { const fj = cur[j] + (s.v[j] - cur[j]) * u; fl[j].set('bp', fj, q[j]); }
      if (u >= 1) cur = s.v;
    }
    const decl = 1 - 0.25 * (tt / dur);
    const f = f0 * decl * (s ? s.acc : 1) * (1 + 0.012 * gauss(rng));
    const dt = f / sr;
    ph += dt; if (ph >= 1) ph -= 1;
    // PolyBLEP saw
    let x = 2 * ph - 1;
    if (ph < dt) { const u = ph / dt; x -= u + u - u * u - 1; } else if (ph > 1 - dt) { const u = (ph - 1) / dt; x -= u * u + u + u + 1; }
    x = x * 0.8 + (rng() * 2 - 1) * 0.08;
    let y = 0;
    for (let j = 0; j < 3; j++) y += fl[j].tick(x) * g[j];
    let c = 0;
    if (s && s.cons && tt >= s.t0 - 0.05 && tt < s.t0) {
      const u = (tt - (s.t0 - 0.05)) / 0.05;
      c = fric.tick(rng() * 2 - 1) * (s.cons === 's' ? Math.sin(Math.PI * u) * 1.6 : (u > 0.7 ? 3 * (1 - u) / 0.3 : 0));
    }
    out[i] = y * amp * 1.4 + c * 0.35;
  }
  return fades(normalize(removeDC(out), 0.9), sr, 5, 30);
}

// ----------------------------------------------------------------------------------------------- the bank
export const FOLEY = {
  // ------------------------------------------------------------- hands / body (IVA)
  hand_rail: { n: 5, gen: (sr, r) => { // skin on a metal handrail: slap + rail ring + a little squeak
    const out = impact(sr, r, { modes: metal(r, rr(r, 900, 1300), { count: 6, t60: 0.12, ratios: BAR.concat([3.7, 6.6]).sort((a, b) => a - b) }), contact: 0.0012, hard: 7000, noise: 0.9, noiseLP: 4500, noiseDecay: 0.008, dur: 0.35 });
    mixInto(out, thud(sr, r, { f: rr(r, 140, 190), decay: 0.03, dur: 0.12, noise: 0.5, noiseLP: 1500 }), 0, 0.5);
    if (r() < 0.5) mixInto(out, burst(sr, r, { dur: 0.08, f: 3200, q: 2, attack: 0.01, decay: 0.03 }), Math.round(0.015 * sr), 0.15);
    return normalize(out); } },
  glove_rail: { n: 4, gen: (sr, r) => { // pressurised glove on a rail, heard through the suit: dull, low
    const out = impact(sr, r, { modes: metal(r, rr(r, 260, 340), { count: 5, t60: 0.25, ratios: BAR }), contact: 0.006, hard: 1400, noise: 0.6, noiseLP: 900, noiseDecay: 0.02, dur: 0.5 });
    mixInto(out, thud(sr, r, { f: rr(r, 90, 120), decay: 0.06, dur: 0.3, noise: 0.4, noiseLP: 600 }), 0, 0.8);
    mixInto(out, rustle(sr, r, { dur: 0.3, f: 900, q: 0.8, decay: 0.12 }), Math.round(0.01 * sr), 0.25);
    return normalize(filt(out, sr, 'lp', 2200, 0.7)); } },
  glove_tap: { n: 4, gen: (sr, r) => normalize(filt(impact(sr, r, { modes: metal(r, rr(r, 280, 360), { count: 4, t60: 0.12, ratios: BAR }), contact: 0.005, hard: 1200, noise: 0.5, noiseLP: 800, noiseDecay: 0.015, dur: 0.3 }), sr, 'lp', 1800, 0.7)) },
  push_off: { n: 4, gen: (sr, r) => {
    const out = thud(sr, r, { f: rr(r, 70, 95), decay: 0.07, dur: 0.5, noise: 0.5, noiseLP: 700 });
    mixInto(out, burst(sr, r, { dur: 0.45, f: 450, f1: rr(r, 1300, 1900), q: 0.6, attack: 0.05, decay: 0.15, color: 'pink' }), Math.round(0.02 * sr), 0.5);
    mixInto(out, rustle(sr, r, { dur: 0.35, f: 2400, decay: 0.12 }), Math.round(0.04 * sr), 0.25);
    return normalize(out); } },
  bump_soft: { n: 4, gen: (sr, r) => { // into bags / padded panels
    const out = thud(sr, r, { f: rr(r, 65, 85), decay: 0.08, dur: 0.5, noise: 0.9, noiseLP: 450 });
    mixInto(out, rustle(sr, r, { dur: 0.45, f: 1300, q: 0.6, decay: 0.18, crinkle: 0.9 }), Math.round(0.005 * sr), 0.45);
    return normalize(out); } },
  bump_hard: { n: 4, gen: (sr, r) => { // into a rack front: panel modes + rattling items
    const out = impact(sr, r, { modes: metal(r, rr(r, 230, 320), { count: 7, t60: 0.22, ratios: PLATE }), contact: 0.004, hard: 2500, noise: 0.7, noiseLP: 1800, noiseDecay: 0.02, dur: 0.7 });
    mixInto(out, thud(sr, r, { f: rr(r, 70, 95), decay: 0.07, dur: 0.4, noise: 0.5 }), 0, 0.9);
    for (let k = 0; k < 4 + Math.floor(r() * 4); k++) mixInto(out, impact(sr, r, { modes: metal(r, rr(r, 1500, 3500), { count: 3, t60: 0.03 }), contact: 0.0008, hard: 8000, noise: 0.3, dur: 0.06 }), Math.round(rr(r, 0.015, 0.22) * sr), rr(r, 0.05, 0.18));
    return normalize(out); } },
  velcro: { n: 3, gen: (sr, r) => normalize(clicks(sr, r, { dur: rr(r, 0.22, 0.42), rate: rr(r, 500, 800), rate1: rr(r, 900, 1400), f: 2600, t60: 0.004, jitter: 0.6, hp: 1500, noise: 0.9, env: (u) => Math.sin(Math.PI * Math.min(1, u * 1.1)) ** 0.5 })) },
  cloth: { n: 6, gen: (sr, r) => normalize(rustle(sr, r, { dur: rr(r, 0.25, 0.6), f: rr(r, 1500, 3200), q: 0.6, crinkle: rr(r, 0.4, 0.9), attack: rr(r, 0.03, 0.1), decay: rr(r, 0.12, 0.3) })) },
  cloth_loop: { n: 1, loop: true, gen: (sr, r) => {
    const a = rustle(sr, r, { dur: 4.2, f: 1900, q: 0.5, crinkle: 0.8, attack: 0.001, decay: 1e6 });
    return scale(makeLoop(a, S(sr, 0.4)), 1.6); } },
  brake_rub: { n: 3, gen: (sr, r) => normalize(burst(sr, r, { dur: rr(r, 0.3, 0.5), f: rr(r, 1800, 2600), f1: rr(r, 1000, 1400), q: 1.2, attack: 0.04, decay: 0.15, color: 'pink' })) },
  jump: { n: 3, gen: (sr, r) => {
    const out = thud(sr, r, { f: rr(r, 60, 80), decay: 0.05, dur: 0.3, noise: 0.6, noiseLP: 900 });
    mixInto(out, rustle(sr, r, { dur: 0.4, f: 2000, decay: 0.15 }), Math.round(0.03 * sr), 0.4);
    return normalize(out); } },
  land_body: { n: 3, gen: (sr, r) => {
    const out = thud(sr, r, { f: rr(r, 55, 70), decay: 0.11, dur: 0.6, noise: 0.8, noiseLP: 600 });
    mixInto(out, rustle(sr, r, { dur: 0.45, f: 1600, decay: 0.2 }), Math.round(0.02 * sr), 0.35);
    return normalize(out); } },

  // ------------------------------------------------------------- footsteps (ring deck) and ladders
  step_grate: { n: 6, gen: (sr, r) => { // metal grating: bright clank, rattle, heel-toe
    const out = new Float32Array(S(sr, 0.45));
    const heel = impact(sr, r, { modes: metal(r, rr(r, 700, 950), { count: 7, t60: 0.09, ratios: PLATE }), contact: 0.002, hard: 5000, noise: 0.6, noiseLP: 3500, noiseDecay: 0.012, dur: 0.3 });
    mixInto(heel, thud(sr, r, { f: rr(r, 95, 125), decay: 0.035, dur: 0.15, noise: 0.4 }), 0, 0.8);
    mixInto(out, heel, 0, 1);
    mixInto(out, impact(sr, r, { modes: metal(r, rr(r, 1100, 1500), { count: 5, t60: 0.05 }), contact: 0.0015, hard: 6000, noise: 0.5, dur: 0.15 }), Math.round(rr(r, 0.045, 0.07) * sr), 0.45);
    for (let k = 0; k < 2; k++) mixInto(out, impact(sr, r, { modes: metal(r, rr(r, 1800, 3000), { count: 3, t60: 0.02 }), contact: 0.0006, hard: 9000, noise: 0.2, dur: 0.05 }), Math.round(rr(r, 0.01, 0.05) * sr), 0.15);
    return normalize(out); } },
  step_panel: { n: 6, gen: (sr, r) => { // deck panel over a cavity: hollow thud
    const out = new Float32Array(S(sr, 0.4));
    const heel = thud(sr, r, { f: rr(r, 85, 110), decay: 0.05, dur: 0.3, noise: 0.6, noiseLP: 900 });
    mixInto(heel, impact(sr, r, { modes: metal(r, rr(r, 210, 290), { count: 5, t60: 0.07, ratios: PLATE }), contact: 0.003, hard: 2200, noise: 0.3, dur: 0.25 }), 0, 0.6);
    mixInto(out, heel, 0, 1);
    mixInto(out, thud(sr, r, { f: rr(r, 110, 140), decay: 0.025, dur: 0.12, noise: 0.5, noiseLP: 1500 }), Math.round(rr(r, 0.05, 0.075) * sr), 0.4);
    mixInto(out, burst(sr, r, { dur: 0.08, f: 2500, q: 1, attack: 0.003, decay: 0.02 }), Math.round(0.06 * sr), 0.07);
    return normalize(out); } },
  step_carpet: { n: 6, gen: (sr, r) => { // carpet: soft low thud and fabric
    const out = thud(sr, r, { f: rr(r, 70, 90), decay: 0.04, dur: 0.3, noise: 0.9, noiseLP: rr(r, 600, 900) });
    mixInto(out, burst(sr, r, { dur: 0.14, f: 2800, q: 0.7, attack: 0.01, decay: 0.04, color: 'pink' }), Math.round(0.03 * sr), 0.08);
    mixInto(out, thud(sr, r, { f: rr(r, 90, 110), decay: 0.02, dur: 0.1, noise: 0.8, noiseLP: 700 }), Math.round(rr(r, 0.05, 0.08) * sr), 0.35);
    return normalize(out); } },
  step_mat: { n: 5, gen: (sr, r) => { // rubber gym mat
    const out = thud(sr, r, { f: rr(r, 60, 78), decay: 0.05, dur: 0.3, noise: 0.7, noiseLP: 500 });
    if (r() < 0.35) mixInto(out, burst(sr, r, { dur: 0.06, f: rr(r, 1800, 2400), q: 8, attack: 0.005, decay: 0.02 }), Math.round(0.05 * sr), 0.06);
    return normalize(out); } },
  rung_hand: { n: 4, gen: (sr, r) => normalize(impact(sr, r, { modes: metal(r, rr(r, 650, 820), { count: 5, t60: 0.22, ratios: BAR }), contact: 0.0015, hard: 6000, noise: 0.7, noiseLP: 3500, noiseDecay: 0.01, dur: 0.45 })) },
  rung_foot: { n: 4, gen: (sr, r) => {
    const out = impact(sr, r, { modes: metal(r, rr(r, 520, 640), { count: 5, t60: 0.18, ratios: BAR }), contact: 0.003, hard: 3500, noise: 0.5, dur: 0.4 });
    mixInto(out, thud(sr, r, { f: rr(r, 90, 120), decay: 0.03, dur: 0.15 }), 0, 0.7);
    return normalize(out); } },

  // ------------------------------------------------------------- hatches, latches, mechanisms
  ratchet: { n: 3, gen: (sr, r) => { // one stroke of a hatch actuator handle
    const out = clicks(sr, r, { dur: rr(r, 0.35, 0.5), rate: rr(r, 16, 22), f: rr(r, 1700, 2300), t60: 0.03, jitter: 0.08, hp: 400, noise: 0.4, env: (u) => 0.6 + 0.4 * u });
    mixInto(out, burst(sr, r, { dur: 0.45, f: 600, q: 0.7, attack: 0.05, decay: 0.2, color: 'pink' }), 0, 0.15);
    return normalize(out); } },
  latch: { n: 4, gen: (sr, r) => { // heavy latch / hatch closing clunk
    const out = impact(sr, r, { modes: metal(r, rr(r, 130, 180), { count: 7, t60: 0.35, ratios: PLATE }), contact: 0.004, hard: 2500, noise: 0.6, noiseLP: 2000, noiseDecay: 0.02, dur: 0.9 });
    mixInto(out, thud(sr, r, { f: rr(r, 60, 75), decay: 0.09, dur: 0.5, noise: 0.4 }), 0, 0.9);
    mixInto(out, impact(sr, r, { modes: metal(r, rr(r, 1200, 1700), { count: 4, t60: 0.08 }), contact: 0.001, hard: 7000, noise: 0.4, dur: 0.2 }), Math.round(rr(r, 0.012, 0.03) * sr), 0.35);
    return normalize(out); } },
  latch_small: { n: 3, gen: (sr, r) => normalize(impact(sr, r, { modes: metal(r, rr(r, 1900, 2600), { count: 5, t60: 0.05 }), contact: 0.0007, hard: 9000, noise: 0.6, noiseLP: 7000, noiseDecay: 0.004, dur: 0.15 })) },
  seal: { n: 2, gen: (sr, r) => { // rubber seal seating / unsticking: soft pop
    const out = thud(sr, r, { f: rr(r, 120, 160), drop: 0.5, decay: 0.03, dur: 0.25, noise: 0.8, noiseLP: 1200 });
    mixInto(out, burst(sr, r, { dur: 0.12, f: 900, q: 3, attack: 0.002, decay: 0.03 }), Math.round(0.004 * sr), 0.2);
    return normalize(out); } },
  hinge_creak: { n: 2, gen: (sr, r) => { // stick-slip creak
    const n = S(sr, rr(r, 0.6, 0.9)), out = new Float32Array(n);
    const f0 = rr(r, 280, 380);
    let t = 0;
    while (t < n / sr - 0.02) {
      const i0 = Math.round(t * sr), len = Math.round(0.01 * sr), f = f0 * (1 + 0.2 * Math.sin(TAU * 1.3 * t)), a = 0.4 + 0.6 * r();
      for (let i = 0; i < len && i0 + i < n; i++) out[i0 + i] += a * Math.sin(TAU * f * 3 * i / sr) * dec60(i / sr, 0.008);
      t += 1 / (f * (0.08 + 0.04 * r()));
    }
    filt(out, sr, 'bp', 1200, 0.6);
    return fades(normalize(out), sr, 30, 60); } },
  motor_loop: { n: 1, loop: true, gen: (sr, r) => motorLoop(sr, r, 118, { gear: 15, gearAmp: 0.3, noise: 0.45 }) },
  servo_loop: { n: 1, loop: true, gen: (sr, r) => { // stepper / servo (telescope drives): step ticks + whine
    const n = 1 << 16, out = motorLoop(sr, r, 410, { gear: 4, gearAmp: 0.35, harmAmp: [0.6, 0.3, 0.2], noise: 0.25, n });
    const steps = 160;    // integer number of steps per loop
    for (let k = 0; k < steps; k++) { const i0 = Math.round(k * n / steps); for (let i = 0; i < 40; i++) out[(i0 + i) % n] += 0.15 * Math.sin(TAU * 2600 * i / sr) * dec60(i / sr, 0.0015); }
    return out; } },

  // ------------------------------------------------------------- airlock
  pump_loop: { n: 1, loop: true, gen: (sr, r) => { // depress pump: motor + vane pulsation
    const out = motorLoop(sr, r, 98, { gear: 6, gearAmp: 0.4, harmAmp: [1, 0.7, 0.45, 0.3, 0.2, 0.12], noise: 0.6, n: 1 << 17 });
    return loopAM(out, Math.round((1 << 17) / sr * 24.5), 0.25); } },
  hiss_loop: { n: 1, loop: true, stereo: true, gen: (sr, r) => bed(sr, r, (f) => (f < 400 ? (f / 400) ** 2 : 1) * Math.exp(-((Math.log2(f / 4200)) ** 2) / 3.0), [], null, 1 << 17) },
  rush_loop: { n: 1, loop: true, stereo: true, gen: (sr, r) => bed(sr, r, (f) => tilt(f, 300, 0.5) * (f < 60 ? f / 60 : 1) * Math.exp(-f / 9000) * (1 + 1.5 * Math.exp(-((f - 900) ** 2) / (2 * 500 ** 2))), [], [3, 0.2], 1 << 17) },
  valve_open: { n: 2, gen: (sr, r) => { // pneumatic valve actuation: thunk + click
    const out = thud(sr, r, { f: rr(r, 140, 180), decay: 0.04, dur: 0.3, noise: 0.5, noiseLP: 1500 });
    mixInto(out, impact(sr, r, { modes: metal(r, rr(r, 1400, 1900), { count: 4, t60: 0.06 }), contact: 0.001, hard: 7000, noise: 0.5, dur: 0.15 }), 0, 0.5);
    mixInto(out, burst(sr, r, { dur: 0.3, f: 3500, q: 0.8, type: 'bp', attack: 0.004, decay: 0.12 }), Math.round(0.01 * sr), 0.3);
    return normalize(out); } },
  zipper: { n: 2, gen: (sr, r) => normalize(clicks(sr, r, { dur: rr(r, 0.45, 0.7), rate: 140, rate1: 260, f: 3800, t60: 0.003, jitter: 0.25, hp: 1800, noise: 0.8, env: (u) => Math.sin(Math.PI * u) ** 0.4 })) },
  bearing_clicks: { n: 3, gen: (sr, r) => { // wrist / neck ring bearings: detent ticks then a lock
    const out = clicks(sr, r, { dur: 0.28, rate: rr(r, 30, 45), f: rr(r, 4200, 5200), t60: 0.006, jitter: 0.15, hp: 2000, noise: 0.3 });
    mixInto(out, FOLEY.latch_small.gen(sr, r), Math.round(0.26 * sr), 0.8);
    return normalize(out); } },
  helmet_latch: { n: 2, gen: (sr, r) => {
    const out = impact(sr, r, { modes: metal(r, rr(r, 330, 420), { count: 6, t60: 0.2, ratios: PLATE }), contact: 0.002, hard: 4000, noise: 0.6, dur: 0.6 });
    mixInto(out, FOLEY.latch_small.gen(sr, r), Math.round(0.03 * sr), 0.7);
    mixInto(out, FOLEY.seal.gen(sr, r), Math.round(0.06 * sr), 0.5);
    return normalize(out); } },
  suit_hiss: { n: 2, gen: (sr, r) => normalize(burst(sr, r, { dur: rr(r, 0.6, 0.9), f: 2800, f1: 2000, q: 0.5, type: 'bp', attack: 0.01, decay: 0.3 })) },

  // ------------------------------------------------------------- suit / EVA
  breath_in: { n: 4, gen: (sr, r) => breath(sr, r, { dur: rr(r, 1.3, 1.6), inhale: true }) },
  breath_out: { n: 4, gen: (sr, r) => breath(sr, r, { dur: rr(r, 1.7, 2.1), inhale: false }) },
  breath_in_hard: { n: 3, gen: (sr, r) => breath(sr, r, { dur: rr(r, 0.65, 0.8), inhale: true, effort: 1 }) },
  breath_out_hard: { n: 3, gen: (sr, r) => breath(sr, r, { dur: rr(r, 0.8, 1.0), inhale: false, effort: 1 }) },
  suitfan_loop: { n: 1, loop: true, gen: (sr, r) => { // ventilation fan in the backpack: blade-pass + turbulence
    const out = spectralLoop(1 << 17, sr, r, (f) => (f < 150 ? f / 150 : 1) * tilt(f, 400, 0.9) * (1 + 3 * Math.exp(-((f - 1700) ** 2) / (2 * 400 ** 2))),
      [{ f: 412, a: 0.35, bw: 3 }, { f: 824, a: 0.12, bw: 5 }, { f: 1236, a: 0.06, bw: 6 }, { f: 120, a: 0.25, bw: 0.5 }], LOOP_RMS);
    return out; } },
  suitpump_loop: { n: 1, loop: true, gen: (sr, r) => { // water pump of the cooling garment: soft periodic whir
    const out = motorLoop(sr, r, 61, { gear: 9, gearAmp: 0.2, harmAmp: [0.7, 0.4, 0.2], noise: 0.25, n: 1 << 17 });
    return loopAM(out, Math.round((1 << 17) / sr * 1.7), 0.5); } },
  safer_valve: { n: 4, gen: (sr, r) => { // solenoid pulse + gas puff, as conducted through the backpack frame
    const out = impact(sr, r, { modes: metal(r, rr(r, 900, 1300), { count: 5, t60: 0.04 }), contact: 0.0008, hard: 6000, noise: 0.4, dur: 0.12 });
    mixInto(out, thud(sr, r, { f: rr(r, 110, 150), decay: 0.02, dur: 0.12, noise: 0.6, noiseLP: 1200 }), 0, 0.6);
    mixInto(out, burst(sr, r, { dur: 0.12, f: 700, q: 0.7, attack: 0.002, decay: 0.035, color: 'pink' }), Math.round(0.002 * sr), 0.5);
    return normalize(filt(out, sr, 'lp', 3500, 0.7)); } },
  safer_loop: { n: 1, loop: true, gen: (sr, r) => spectralLoop(1 << 16, sr, r, (f) => (f < 200 ? f / 200 : 1) * Math.exp(-((Math.log2(f / 900)) ** 2) / 2.5), [], LOOP_RMS) },
  reel_loop: { n: 1, loop: true, gen: (sr, r) => motorLoop(sr, r, 210, { gear: 11, gearAmp: 0.35, harmAmp: [0.8, 0.4, 0.25, 0.1], noise: 0.35, n: 1 << 16 }) },
  carabiner: { n: 3, gen: (sr, r) => { // gate snap: two bright clicks and a short ring
    const out = impact(sr, r, { modes: metal(r, rr(r, 2800, 3600), { count: 5, t60: 0.06, ratios: BAR }), contact: 0.0005, hard: 10000, noise: 0.5, noiseDecay: 0.003, dur: 0.25 });
    mixInto(out, impact(sr, r, { modes: metal(r, rr(r, 2200, 2700), { count: 4, t60: 0.08, ratios: BAR }), contact: 0.0006, hard: 9000, noise: 0.4, dur: 0.25 }), Math.round(rr(r, 0.012, 0.022) * sr), 0.8);
    return normalize(out); } },
  tether_twang: { n: 2, gen: (sr, r) => {
    const n = S(sr, 0.9), out = new Float32Array(n), f = rr(r, 85, 120);
    for (let k = 1; k <= 6; k++) { const ph = r() * TAU; for (let i = 0; i < n; i++) out[i] += Math.sin(TAU * f * k * (1 + 0.002 * k * k) * i / sr + ph) * dec60(i / sr, 0.5 / k) / k; }
    mixInto(out, burst(sr, r, { dur: 0.3, f: 600, q: 1, attack: 0.02, decay: 0.12 }), 0, 0.3);
    return normalize(fades(out, sr, 3, 40)); } },
  suit_impact: { n: 4, gen: (sr, r) => { // hard upper torso / helmet shell knock
    const out = thud(sr, r, { f: rr(r, 70, 95), decay: 0.08, dur: 0.6, noise: 0.5, noiseLP: 700 });
    mixInto(out, impact(sr, r, { modes: metal(r, rr(r, 420, 560), { count: 6, t60: 0.25, ratios: PLATE }), contact: 0.004, hard: 2500, noise: 0.3, dur: 0.6 }), 0, 0.55);
    mixInto(out, impact(sr, r, { modes: [{ f: rr(r, 1300, 1700), t60: 0.4, a: 1 }, { f: rr(r, 2300, 2900), t60: 0.25, a: 0.5 }], contact: 0.002, hard: 5000, noise: 0, dur: 0.5 }), 0, 0.12);
    return normalize(out); } },
  heart: { n: 2, gen: (sr, r, v) => thud(sr, r, { f: v ? 46 : 54, drop: 0.7, decay: 0.07, dur: 0.25, noise: 0.15, noiseLP: 200, attack: 0.012 }) },

  // ------------------------------------------------------------- station rooms (beds) and equipment
  bed_module: { n: 1, loop: true, stereo: true, gen: (sr, r) => bed(sr, r, (f) => (f < 40 ? f / 40 : 1) * tilt(f, 150, 0.85) * Math.exp(-f / 7000), [{ f: 120, a: 0.05, bw: 0.4 }, { f: 240, a: 0.02, bw: 0.6 }, { f: 1830, a: 0.004, bw: 2 }]) },
  bed_service: { n: 1, loop: true, stereo: true, gen: (sr, r) => bed(sr, r, (f) => (f < 35 ? f / 35 : 1) * tilt(f, 120, 0.8) * Math.exp(-f / 8000) * (1 + 0.8 * Math.exp(-((f - 650) ** 2) / (2 * 250 ** 2))), [{ f: 50, a: 0.09, bw: 0.2 }, { f: 100, a: 0.06, bw: 0.3 }, { f: 150, a: 0.025, bw: 0.4 }, { f: 400, a: 0.012, bw: 2 }], [7, 0.12]) },
  bed_node: { n: 1, loop: true, stereo: true, gen: (sr, r) => bed(sr, r, (f) => (f < 40 ? f / 40 : 1) * tilt(f, 160, 0.9) * Math.exp(-f / 6000), [{ f: 120, a: 0.035, bw: 0.4 }, { f: 960, a: 0.004, bw: 3 }]) },
  bed_cupola: { n: 1, loop: true, stereo: true, gen: (sr, r) => bed(sr, r, (f) => (f < 50 ? f / 50 : 1) * tilt(f, 200, 1.0) * Math.exp(-f / 5000), [{ f: 120, a: 0.02, bw: 0.4 }]) },
  bed_green: { n: 1, loop: true, stereo: true, gen: (sr, r) => bed(sr, r, (f) => (f < 40 ? f / 40 : 1) * tilt(f, 180, 0.9) * Math.exp(-f / 6000), [{ f: 120, a: 0.03, bw: 0.4 }, { f: 3900, a: 0.003, bw: 1 }, { f: 7800, a: 0.0015, bw: 1 }]) },
  bed_airlock: { n: 1, loop: true, stereo: true, gen: (sr, r) => bed(sr, r, (f) => (f < 40 ? f / 40 : 1) * tilt(f, 140, 0.95) * Math.exp(-f / 5000), [{ f: 60, a: 0.04, bw: 0.3 }, { f: 120, a: 0.03, bw: 0.4 }]) },
  bed_tunnel: { n: 1, loop: true, stereo: true, gen: (sr, r) => bed(sr, r, (f) => (f < 30 ? f / 30 : 1) * tilt(f, 100, 0.7) * Math.exp(-f / 4000) * (1 + 1.2 * Math.exp(-((f - 260) ** 2) / (2 * 80 ** 2))), [{ f: 120, a: 0.03, bw: 0.5 }], [3, 0.2]) },
  bed_ring: { n: 1, loop: true, stereo: true, gen: (sr, r) => bed(sr, r, (f) => (f < 30 ? f / 30 : 1) * tilt(f, 110, 0.9) * Math.exp(-f / 5000), [{ f: 47.5, a: 0.04, bw: 0.2 }, { f: 95, a: 0.03, bw: 0.3 }, { f: 120, a: 0.02, bw: 0.4 }], [2, 0.1]) },
  bed_spoke: { n: 1, loop: true, stereo: true, gen: (sr, r) => bed(sr, r, (f) => (f < 25 ? f / 25 : 1) * tilt(f, 90, 0.7) * Math.exp(-f / 3500) * (1 + 1.5 * Math.exp(-((f - 180) ** 2) / (2 * 60 ** 2))), [{ f: 47.5, a: 0.05, bw: 0.2 }], [3, 0.3]) },
  bed_hub: { n: 1, loop: true, stereo: true, gen: (sr, r) => bed(sr, r, (f) => (f < 25 ? f / 25 : 1) * tilt(f, 90, 0.8) * Math.exp(-f / 4500), [{ f: 47.5, a: 0.07, bw: 0.2 }, { f: 95, a: 0.04, bw: 0.3 }, { f: 142.5, a: 0.02, bw: 0.4 }, { f: 712, a: 0.006, bw: 2 }], [5, 0.15]) },
  fridge_loop: { n: 1, loop: true, gen: (sr, r) => { const out = motorLoop(sr, r, 50, { gear: 3, gearAmp: 0.25, harmAmp: [1, 0.8, 0.5, 0.35, 0.2, 0.1], noise: 0.3, n: 1 << 17 }); return loopAM(out, 13, 0.15); } },
  freezer_loop: { n: 1, loop: true, gen: (sr, r) => motorLoop(sr, r, 60, { gear: 24, gearAmp: 0.18, harmAmp: [0.6, 0.9, 0.4, 0.3, 0.15], noise: 0.5, n: 1 << 17 }) },
  fridge_clunk: { n: 2, gen: (sr, r) => { const out = thud(sr, r, { f: rr(r, 70, 90), decay: 0.06, dur: 0.4, noise: 0.4 }); mixInto(out, impact(sr, r, { modes: metal(r, rr(r, 600, 800), { count: 4, t60: 0.1 }), contact: 0.002, hard: 3000, noise: 0.3, dur: 0.25 }), Math.round(0.01 * sr), 0.4); return normalize(out); } },
  treadmill_loop: { n: 1, loop: true, gen: (sr, r) => { // belt rumble + motor + 8 foot strikes per loop
    const n = 1 << 17, out = spectralLoop(n, sr, r, (f) => (f < 40 ? f / 40 : 1) * tilt(f, 150, 1.0) * Math.exp(-f / 3500), [{ f: 180, a: 0.06, bw: 1 }, { f: 2700, a: 0.01, bw: 4 }], 0.07);
    const steps = 8, per = n / steps;
    for (let k = 0; k < steps; k++) {
      const st = thud(sr, r, { f: rr(r, 65, 80), decay: 0.04, dur: 0.25, noise: 0.7, noiseLP: 800 });
      const i0 = Math.round((k + 0.5) * per + (r() - 0.5) * 0.01 * sr);   // strikes away from the seam
      for (let i = 0; i < st.length; i++) out[(i0 + i) % n] += st[i] * (k % 2 ? 0.32 : 0.38);
    }
    return removeDC(out); } },
  ergo_loop: { n: 1, loop: true, gen: (sr, r) => { const n = 1 << 17, out = motorLoop(sr, r, 22, { gear: 36, gearAmp: 0.3, harmAmp: [0.2, 0.2, 0.15], noise: 0.4, n }); return loopAM(out, Math.round(n / sr * 1.25), 0.45); } },
  scrubber_cycle: { n: 2, gen: (sr, r) => { // CO2 scrubber bed switch: pneumatic clacks + air whoosh
    const out = new Float32Array(S(sr, 3.2));
    mixInto(out, FOLEY.valve_open.gen(sr, r), 0, 0.8);
    mixInto(out, burst(sr, r, { dur: 2.6, f: 500, f1: 1400, q: 0.6, attack: 0.5, decay: 0.9, color: 'pink' }), Math.round(0.1 * sr), 0.5);
    mixInto(out, FOLEY.valve_open.gen(sr, r), Math.round(2.5 * sr), 0.6);
    return normalize(out); } },
  water_gurgle: { n: 3, gen: (sr, r) => { // bubbles: short rising sine chirps
    const n = S(sr, rr(r, 0.8, 1.4)), out = new Float32Array(n);
    for (let k = 0; k < 10 + Math.floor(r() * 12); k++) {
      const i0 = Math.floor(r() * (n - 0.1 * sr)), f0 = rr(r, 350, 1400), len = Math.round(rr(r, 0.02, 0.06) * sr), a = rr(r, 0.3, 1);
      let ph = 0;
      for (let i = 0; i < len; i++) { const t = i / sr; ph += TAU * f0 * (1 + 3 * t) / sr; out[i0 + i] += a * Math.sin(ph) * dec60(t, len / sr) * (1 - Math.exp(-t / 0.002)); }
    }
    return normalize(fades(out, sr, 5, 30)); } },
  irrigation_loop: { n: 1, loop: true, stereo: true, gen: (sr, r) => bed(sr, r, (f) => (f < 300 ? (f / 300) ** 2 : 1) * Math.exp(-((Math.log2(f / 2500)) ** 2) / 2), [{ f: 75, a: 0.05, bw: 0.3 }], [9, 0.5], 1 << 17) },
  laptop_beep: { n: 4, gen: (sr, r, v) => { // short UI beeps of a station laptop
    const pats = [[[2000, 0.06]], [[1600, 0.05], [2400, 0.07]], [[2900, 0.04], [2900, 0.04]], [[1200, 0.08], [1800, 0.08]]][v % 4];
    const out = new Float32Array(S(sr, 0.5)); let t = 0;
    for (const [f, d] of pats) { const i0 = Math.round(t * sr), len = Math.round(d * sr); for (let i = 0; i < len; i++) out[i0 + i] += Math.sin(TAU * f * i / sr) * Math.min(1, i / (0.004 * sr), (len - i) / (0.006 * sr)); t += d + 0.06; }
    return normalize(out, 0.7); } },
  keys: { n: 3, gen: (sr, r) => { // a short burst of laptop typing
    const out = new Float32Array(S(sr, 1.4)); let t = 0.02;
    while (t < 1.3) { mixInto(out, impact(sr, r, { modes: metal(r, rr(r, 1800, 2600), { count: 3, t60: 0.02 }), contact: 0.001, hard: 6000, noise: 0.8, noiseLP: 5000, dur: 0.05 }), Math.round(t * sr), rr(r, 0.3, 1)); t += rr(r, 0.07, 0.22) * (r() < 0.1 ? 3 : 1); }
    return normalize(out); } },
  pa_chime: { n: 1, gen: (sr, r) => { // two-tone announcement chime
    const out = new Float32Array(S(sr, 1.8));
    for (const [t0, f] of [[0, 1046.5], [0.42, 784]]) { const i0 = Math.round(t0 * sr); for (let i = 0; i + i0 < out.length; i++) { const t = i / sr; out[i0 + i] += (Math.sin(TAU * f * t) + 0.3 * Math.sin(TAU * f * 2.01 * t) * dec60(t, 0.4)) * dec60(t, 1.2) * Math.min(1, t / 0.004); } }
    return normalize(out, 0.7); } },
  caution_tone: { n: 1, gen: (sr) => { // caution & warning: alternating two-tone
    const out = new Float32Array(S(sr, 1.0));
    for (let i = 0; i < out.length; i++) { const t = i / sr, f = (Math.floor(t / 0.25) % 2) ? 660 : 880; out[i] = (Math.sin(TAU * f * t) * 0.8 + 0.2 * Math.sin(TAU * f * 3 * t)) * Math.min(1, t / 0.01, (1 - t) / 0.02); }
    return normalize(out, 0.6); } },
  warning_tone: { n: 1, gen: (sr) => { // master alarm: siren sweep
    const out = new Float32Array(S(sr, 1.2)); let ph = 0;
    for (let i = 0; i < out.length; i++) { const t = i / sr, f = 600 + 500 * (0.5 - 0.5 * Math.cos(TAU * t / 1.2)); ph += TAU * f / sr; out[i] = (Math.sin(ph) + 0.25 * Math.sin(3 * ph)) * Math.min(1, t / 0.02, (1.2 - t) / 0.03); }
    return normalize(out, 0.6); } },
  suit_beep: { n: 3, gen: (sr, r, v) => { const f = [880, 1040, 620][v]; const n = S(sr, 0.16), out = new Float32Array(n); for (let i = 0; i < n; i++) out[i] = Math.sin(TAU * f * i / sr) * Math.min(1, i / (0.005 * sr), (n - i) / (0.01 * sr)); return normalize(out, 0.6); } },
  ui_click: { n: 2, gen: (sr, r) => normalize(impact(sr, r, { modes: [{ f: rr(r, 2400, 2800), t60: 0.02, a: 1 }, { f: rr(r, 5200, 6000), t60: 0.01, a: 0.4 }], contact: 0.0005, hard: 9000, noise: 0.3, noiseDecay: 0.002, dur: 0.06 }), 0.6) },
  ui_tick: { n: 1, gen: (sr, r) => normalize(impact(sr, r, { modes: [{ f: 3600, t60: 0.008, a: 1 }], contact: 0.0004, hard: 9000, noise: 0.2, dur: 0.03 }), 0.4) },
  quindar_in: { n: 1, gen: (sr) => { const n = S(sr, 0.25), out = new Float32Array(n); for (let i = 0; i < n; i++) out[i] = Math.sin(TAU * 2525 * i / sr) * Math.min(1, i / (0.004 * sr), (n - i) / (0.004 * sr)); return scale(out, 0.5); } },
  quindar_out: { n: 1, gen: (sr) => { const n = S(sr, 0.25), out = new Float32Array(n); for (let i = 0; i < n; i++) out[i] = Math.sin(TAU * 2475 * i / sr) * Math.min(1, i / (0.004 * sr), (n - i) / (0.004 * sr)); return scale(out, 0.5); } },
  radio_babble: { n: 8, gen: (sr, r, v) => babble(sr, r, { dur: rr(r, 1.6, 3.4), f0: v % 3 === 0 ? rr(r, 175, 210) : rr(r, 100, 135) }) },
  radio_hiss: { n: 1, loop: true, gen: (sr, r) => spectralLoop(1 << 16, sr, r, (f) => (f > 300 && f < 3400 ? 1 : 0.05), [], LOOP_RMS) },

  // ------------------------------------------------------------- structure: docking, thrusters, thermal creaks
  dock_contact: { n: 2, gen: (sr, r) => { // soft-capture contact transmitted through the hull: boom + long ring
    const out = thud(sr, r, { f: rr(r, 38, 48), drop: 0.8, decay: 0.25, dur: 2.2, noise: 0.6, noiseLP: 300 });
    mixInto(out, impact(sr, r, { modes: metal(r, rr(r, 95, 130), { count: 8, t60: 1.4, ratios: PLATE, tilt: 0.8 }), contact: 0.01, hard: 900, noise: 0.2, dur: 2.2 }), 0, 0.5);
    return normalize(out); } },
  dock_latch: { n: 3, gen: (sr, r) => { const out = FOLEY.latch.gen(sr, r); mixInto(out, impact(sr, r, { modes: metal(r, rr(r, 80, 110), { count: 6, t60: 0.8, ratios: PLATE }), contact: 0.008, hard: 800, noise: 0.2, dur: 1.2 }).subarray(0, out.length), 0, 0.5); return normalize(filt(out, sr, 'lp', 2500, 0.7)); } },
  spring_thunk: { n: 2, gen: (sr, r) => { const out = thud(sr, r, { f: rr(r, 55, 70), decay: 0.12, dur: 1.2, noise: 0.5 }); mixInto(out, FOLEY.tether_twang.gen(sr, r), Math.round(0.01 * sr), 0.25); return normalize(out); } },
  thruster_thump: { n: 3, gen: (sr, r) => { // station attitude jets as heard inside: muffled boom-thump
    const out = thud(sr, r, { f: rr(r, 45, 60), drop: 0.75, decay: 0.12, dur: 1.0, noise: 0.8, noiseLP: 250 });
    mixInto(out, burst(sr, r, { dur: 0.7, f: 180, q: 0.7, type: 'lp', attack: 0.01, decay: 0.25, color: 'brown' }), 0, 0.5);
    return normalize(out); } },
  struct_creak: { n: 4, gen: (sr, r, v) => { // thermal "pings" and creaks of the hull at sunrise / sunset
    if (v % 2 === 0) return normalize(impact(sr, r, { modes: metal(r, rr(r, 300, 700), { count: 6, t60: 0.9, ratios: PLATE }), contact: 0.003, hard: 2500, noise: 0.15, dur: 1.4 }));
    const out = FOLEY.hinge_creak.gen(sr, r); return normalize(filt(out, sr, 'lp', 1500, 0.7)); } },
  explosion_near: { n: 2, gen: (sr, r) => { // structure-borne blast: sub boom, rumble tail, debris
    const out = thud(sr, r, { f: rr(r, 32, 42), drop: 0.6, decay: 0.6, dur: 4.0, noise: 1.0, noiseLP: 350 });
    mixInto(out, burst(sr, r, { dur: 3.5, f: 900, f1: 200, q: 0.5, type: 'lp', attack: 0.005, decay: 1.2, color: 'brown' }), 0, 0.7);
    for (let k = 0; k < 18; k++) mixInto(out, impact(sr, r, { modes: metal(r, rr(r, 400, 2500), { count: 4, t60: 0.1 }), contact: 0.001, hard: 6000, noise: 0.3, dur: 0.2 }), Math.round(rr(r, 0.2, 2.5) * sr), rr(r, 0.02, 0.1));
    return normalize(out); } },
  debris_rattle: { n: 2, gen: (sr, r) => { const out = new Float32Array(S(sr, 1.5)); for (let k = 0; k < 14; k++) mixInto(out, impact(sr, r, { modes: metal(r, rr(r, 500, 2200), { count: 4, t60: 0.08 }), contact: 0.001, hard: 6000, noise: 0.4, dur: 0.15 }), Math.round(rr(r, 0, 1.3) * sr), rr(r, 0.2, 1)); return normalize(out); } },
};

function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

/** Render one variant of a bank entry: { channels: Float32Array[], loop }. */
export function generate(name, sr, variant = 0) {
  const e = FOLEY[name];
  if (!e) return null;
  const v = ((variant % e.n) + e.n) % e.n;
  const rng = makeRng(hash(name) ^ Math.imul(v + 1, 0x9e3779b1));
  let out = e.gen(sr, rng, v);
  const channels = Array.isArray(out) ? out : [out];
  for (const c of channels) {
    for (let i = 0; i < c.length; i++) if (!Number.isFinite(c[i])) c[i] = 0;
    removeDC(c);    // (a constant shift keeps loops seamless)
  }
  if (e.loop) {   // loops keep their RMS calibration, but never exceed -0.2 dBFS
    let pk = 0; for (const c of channels) for (let i = 0; i < c.length; i++) pk = Math.max(pk, Math.abs(c[i]));
    if (pk > 0.98) for (const c of channels) scale(c, 0.98 / pk);
  }
  return { channels, loop: !!e.loop };
}

export const FOLEY_NAMES = Object.keys(FOLEY);
