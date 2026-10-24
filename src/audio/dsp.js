/**
 * Pure-JS DSP helpers for procedural sound generation (no WebAudio, no DOM): deterministic RNG, biquad
 * filters, noise, FFT, spectral (seamless) loops, modal impacts and room impulse responses.
 * Used by foley.js to fill AudioBuffers at run time, and by tools/audio/foley-render.mjs under Node
 * to render and analyse every sound offline.
 */

export const TAU = Math.PI * 2;

/** mulberry32 PRNG -> () => [0, 1) */
export function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const rr = (rng, a, b) => a + (b - a) * rng();
export const gauss = (rng) => { let u = 0, v = 0; while (u === 0) u = rng(); while (v === 0) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v); };

// ----------------------------------------------------------------------------------------------- filters
/** RBJ biquad, direct form I, processed in place. */
export class Biquad {
  constructor(sr) { this.sr = sr; this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0; }
  set(type, f, q = 0.707, gainDb = 0) {
    const w = TAU * Math.min(Math.max(f, 5), this.sr * 0.49) / this.sr, cw = Math.cos(w), sw = Math.sin(w), al = sw / (2 * q), A = 10 ** (gainDb / 40);
    let b0, b1, b2, a0, a1, a2;
    switch (type) {
      case 'lp': b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; break;
      case 'hp': b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; break;
      case 'bp': b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; break;
      case 'notch': b0 = 1; b1 = -2 * cw; b2 = 1; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; break;
      case 'peak': b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A; break;
      case 'lowshelf': { const s = 2 * Math.sqrt(A) * al; b0 = A * ((A + 1) - (A - 1) * cw + s); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - s); a0 = (A + 1) + (A - 1) * cw + s; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - s; break; }
      case 'highshelf': { const s = 2 * Math.sqrt(A) * al; b0 = A * ((A + 1) + (A - 1) * cw + s); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - s); a0 = (A + 1) - (A - 1) * cw + s; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - s; break; }
      default: b0 = 1; b1 = 0; b2 = 0; a0 = 1; a1 = 0; a2 = 0;
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }
  tick(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
  run(buf, i0 = 0, i1 = buf.length) { for (let i = i0; i < i1; i++) buf[i] = this.tick(buf[i]); return buf; }
  reset() { this.x1 = this.x2 = this.y1 = this.y2 = 0; return this; }
}

/** Filter a buffer in place: filt(buf, sr, 'lp', 2000, 0.7[, gain]) (optionally `stages` times). */
export function filt(buf, sr, type, f, q = 0.707, gainDb = 0, stages = 1) {
  for (let s = 0; s < stages; s++) new Biquad(sr).set(type, f, q, gainDb).run(buf);
  return buf;
}

/** One-pole low-pass in place. */
export function onePole(buf, sr, fc) {
  const a = Math.exp(-TAU * fc / sr); let y = 0;
  for (let i = 0; i < buf.length; i++) { y = (1 - a) * buf[i] + a * y; buf[i] = y; }
  return buf;
}

// ----------------------------------------------------------------------------------------------- noise
export function white(n, rng) { const b = new Float32Array(n); for (let i = 0; i < n; i++) b[i] = rng() * 2 - 1; return b; }
export function pink(n, rng) {
  const b = new Float32Array(n); let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = rng() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.96900 * b2 + w * 0.1538520;
    b3 = 0.86650 * b3 + w * 0.3104856; b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
    b[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
  }
  return b;
}
export function brown(n, rng) { const b = new Float32Array(n); let y = 0; for (let i = 0; i < n; i++) { y = (y + (rng() * 2 - 1) * 0.02) * 0.998; b[i] = y * 3.5; } return b; }

// ----------------------------------------------------------------------------------------------- utilities
export function peak(buf) { let m = 0; for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > m) m = a; } return m; }
export function rms(buf) { let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]; return Math.sqrt(s / Math.max(1, buf.length)); }
export function normalize(buf, target = 0.9) { const p = peak(buf); if (p > 1e-9) { const g = target / p; for (let i = 0; i < buf.length; i++) buf[i] *= g; } return buf; }
export function scale(buf, g) { for (let i = 0; i < buf.length; i++) buf[i] *= g; return buf; }
export function removeDC(buf) { let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i]; const m = s / Math.max(1, buf.length); for (let i = 0; i < buf.length; i++) buf[i] -= m; return buf; }
/** Raised-cosine fade in / out (ms) so one-shots never start or end with a step. */
export function fades(buf, sr, inMs = 1, outMs = 8) {
  const a = Math.min(buf.length >> 1, Math.round(inMs * sr / 1000)), b = Math.min(buf.length >> 1, Math.round(outMs * sr / 1000));
  for (let i = 0; i < a; i++) buf[i] *= 0.5 - 0.5 * Math.cos(Math.PI * i / a);
  for (let i = 0; i < b; i++) buf[buf.length - 1 - i] *= 0.5 - 0.5 * Math.cos(Math.PI * i / b);
  return buf;
}
/** Add src into dst at sample offset with gain. */
export function mixInto(dst, src, at = 0, g = 1) { const n = Math.min(src.length, dst.length - at); for (let i = Math.max(0, -at); i < n; i++) dst[at + i] += src[i] * g; return dst; }
/** Turn a buffer into a seamless loop: crossfade (equal power) the last x samples into the first x, drop the tail. */
export function makeLoop(buf, x) {
  const n = buf.length - x, out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = buf[i];
  for (let i = 0; i < x; i++) { const t = i / x, a = Math.sin(0.5 * Math.PI * t), b = Math.cos(0.5 * Math.PI * t); out[i] = buf[i] * a + buf[n + i] * b; }
  return out;
}

// ----------------------------------------------------------------------------------------------- envelopes
/** Exponential decay envelope value at time t for a T60 (s). */
export const dec60 = (t, t60) => Math.exp(-6.907755 * t / t60);
/** Attack-decay: raised-sine attack of `a` seconds then exponential decay (T60 `d`). */
export const ad = (t, a, d) => (t < a ? Math.sin(0.5 * Math.PI * t / a) ** 2 : dec60(t - a, d));

// ----------------------------------------------------------------------------------------------- FFT
/** In-place radix-2 complex FFT (n power of two). inverse=true computes the unnormalised inverse. */
export function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inverse ? TAU : -TAU) / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

/**
 * Seamless noise loop synthesised in the frequency domain: random phases, magnitude shape(f), plus tones
 * snapped to FFT bins (so the loop period contains whole cycles). tones: [{f, a, bw (Hz, optional)}].
 * Returns a Float32Array of length n (power of two), RMS-normalised to `level`.
 */
export function spectralLoop(n, sr, rng, shape, tones = [], level = 0.25) {
  const re = new Float64Array(n), im = new Float64Array(n), df = sr / n;
  for (let k = 1; k < n / 2; k++) {
    const f = k * df, m = shape(f);
    if (m <= 0) continue;
    const ph = rng() * TAU, a = m * (0.6 + 0.8 * rng());
    re[k] = a * Math.cos(ph); im[k] = a * Math.sin(ph);
  }
  // noise part normalised first so tones keep their relative level
  let e = 0; for (let k = 1; k < n / 2; k++) e += re[k] * re[k] + im[k] * im[k];
  const gN = e > 0 ? 1 / Math.sqrt(2 * e / (n * n)) : 0;   // -> unit-RMS noise
  for (let k = 1; k < n / 2; k++) { re[k] *= gN; im[k] *= gN; }
  for (const t of tones) {
    const bw = t.bw || 0, k0 = Math.round(t.f / df);
    const kw = Math.max(0, Math.round(bw / df));
    const amp = t.a * n / 2 / Math.sqrt(kw * 2 + 1);
    for (let k = Math.max(1, k0 - kw); k <= Math.min(n / 2 - 1, k0 + kw); k++) {
      const ph = rng() * TAU;
      re[k] += amp * Math.cos(ph); im[k] += amp * Math.sin(ph);
    }
  }
  for (let k = 1; k < n / 2; k++) { re[n - k] = re[k]; im[n - k] = -im[k]; }
  re[0] = 0; im[0] = 0; re[n / 2] = 0; im[n / 2] = 0;
  fft(re, im, true);
  const out = new Float32Array(n);
  let s = 0;
  for (let i = 0; i < n; i++) { out[i] = re[i] / n; s += out[i] * out[i]; }
  const g = level / Math.sqrt(s / n + 1e-20);
  for (let i = 0; i < n; i++) out[i] *= g;
  return out;
}

/** Periodic amplitude modulation with an integer number of cycles over the buffer (loop-safe). */
export function loopAM(buf, cycles, depth, phase = 0) {
  const n = buf.length;
  for (let i = 0; i < n; i++) buf[i] *= 1 - depth * 0.5 + depth * 0.5 * Math.sin(TAU * cycles * i / n + phase);
  return buf;
}

// ----------------------------------------------------------------------------------------------- modal impacts
/**
 * Modal impact synthesis (metal clanks, latches, taps, thuds): a contact excitation (noise burst of
 * `contact` seconds, low-passed at `hard` Hz) driving decaying sinusoidal modes [{f, t60, a}], plus an
 * optional direct noise layer. Returns a new Float32Array of `dur` seconds.
 */
export function impact(sr, rng, { modes = [], contact = 0.002, hard = 6000, noise = 0.3, noiseLP = 3000, noiseDecay = 0.02, dur = 0.5, gain = 1 }) {
  const n = Math.max(8, Math.round(dur * sr)), out = new Float32Array(n);
  const ns = Math.max(4, Math.round(contact * sr * 6));
  // excitation burst: half-sine force pulse x noise
  const exc = new Float32Array(ns);
  const cN = Math.max(2, Math.round(contact * sr));
  for (let i = 0; i < ns; i++) {
    const f = i < cN ? Math.sin(Math.PI * i / cN) : 0;
    exc[i] = f * (0.6 + 0.4 * (rng() * 2 - 1));
  }
  filt(exc, sr, 'lp', hard, 0.6);
  // modes driven by the force pulse (their phase noise comes from the excitation shape)
  for (const m of modes) {
    if (m.f >= sr * 0.45) continue;
    const w = TAU * m.f / sr, k = Math.exp(-6.907755 / (m.t60 * sr));
    // two-pole resonator y = 2 r cos w y1 - r^2 y2 + x
    const c1 = 2 * k * Math.cos(w), c2 = -k * k;
    let y1 = 0, y2 = 0;
    const g = m.a * (1 - k * k) * 30;
    const len = Math.min(n, Math.round(m.t60 * 1.2 * sr) + ns);
    for (let i = 0; i < len; i++) {
      const x = i < ns ? exc[i] : 0;
      const y = c1 * y1 + c2 * y2 + x;
      y2 = y1; y1 = y;
      out[i] += y * g;
    }
  }
  if (noise > 0) {
    const nl = Math.min(n, Math.round(noiseDecay * 8 * sr));
    const nb = new Float32Array(nl);
    for (let i = 0; i < nl; i++) nb[i] = (rng() * 2 - 1) * dec60(i / sr, noiseDecay * 6.9 / 2.3);
    filt(nb, sr, 'lp', noiseLP, 0.7);
    mixInto(out, nb, 0, noise);
  }
  return scale(fades(out, sr, 0.3, Math.min(30, dur * 300)), gain);
}

// ----------------------------------------------------------------------------------------------- rooms
/**
 * Stereo room impulse response for a ConvolverNode: early reflections (count, spread) + a diffuse tail
 * with frequency-dependent decay (rt: [low, mid, high] seconds), optional flutter echo (period s) and
 * metallic ringing modes. Returns [L, R] Float32Arrays.
 */
export function roomIR(sr, rng, { rt = [0.6, 0.5, 0.3], len = null, pre = 0.004, er = 8, erSpan = 0.02, flutter = 0, flutterGain = 0.3, metal = 0, metalModes = null, bright = 0 }) {
  const L = len || Math.max(rt[0], rt[1]) * 1.25 + 0.05;
  const n = Math.round(L * sr), out = [new Float32Array(n), new Float32Array(n)];
  const p0 = Math.round(pre * sr);
  for (let c = 0; c < 2; c++) {
    const o = out[c];
    const lo = white(n, rng), mid = white(n, rng), hi = white(n, rng);
    filt(lo, sr, 'lp', 300, 0.6, 0, 2); filt(mid, sr, 'bp', 1200, 0.5); filt(hi, sr, 'hp', 3500, 0.6, 0, 2);
    for (let i = p0; i < n; i++) {
      const t = (i - p0) / sr, build = 1 - Math.exp(-t / 0.006);
      o[i] = build * (lo[i] * dec60(t, rt[0]) * 1.4 + mid[i] * dec60(t, rt[1]) * 1.6 + hi[i] * dec60(t, rt[2]) * (1.0 + bright));
    }
    for (let k = 0; k < er; k++) {
      const d = p0 + Math.round((0.0015 + rng() * erSpan) * sr);
      if (d < n) o[d] += (rng() < 0.5 ? -1 : 1) * (0.6 - 0.4 * k / er) * 2.2;
    }
    if (flutter > 0) {
      const per = Math.round(flutter * sr);
      for (let d = p0 + per, k = 1; d < n; d += per, k++) {
        const g = flutterGain * dec60(k * flutter, rt[1]) * 2;
        o[d] += (k % 2 ? 1 : -1) * g; if (d + 1 < n) o[d + 1] += 0.5 * g;
      }
    }
    if (metal > 0) {
      const ms = metalModes || [180, 410, 730, 1180, 1690, 2310];
      for (const f0 of ms) {
        const f = f0 * (1 + (rng() - 0.5) * 0.06), ph = rng() * TAU, t60 = rt[1] * (0.8 + rng() * 0.8);
        for (let i = p0; i < n; i++) { const t = (i - p0) / sr; o[i] += metal * 0.15 * Math.sin(TAU * f * t + ph) * dec60(t, t60) * (1 - Math.exp(-t / 0.003)); }
      }
    }
  }
  // energy normalisation (unit energy per channel) and a short fade at the end
  for (const o of out) {
    let e = 0; for (let i = 0; i < n; i++) e += o[i] * o[i];
    const g = 1 / Math.sqrt(e + 1e-12);
    for (let i = 0; i < n; i++) o[i] *= g;
    fades(o, sr, 0, 20);
  }
  return out;
}
