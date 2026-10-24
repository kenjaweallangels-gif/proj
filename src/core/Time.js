/**
 * Simulation clock (`ctx.time`): sim seconds since the epoch (constants.EPOCH_UTC_MS), time rate, pause,
 * jumps. One instance lives in the App; modules read it through ctx.time.
 *
 *   time.sim        sim seconds since the epoch (double precision; may be negative)
 *   time.dt         scaled step of this frame (sim seconds; 0 while paused)
 *   time.realDt     wall-clock step of this frame (s, clamped to 1/20 like the render loop; also while paused)
 *   time.rawDt      unclamped wall-clock step (s)
 *   time.rate       requested rate (×); time.scale is the same number (legacy name, used by many modules)
 *   time.paused     user pause (the pause menu also sets it through app.paused)
 *   time.elapsed    unpaused real seconds since start; time.real = wall-clock seconds since start
 *   time.hitch      true for the frame after a rate change / jump / fast-forward (the quality governor ignores it)
 *   time.utc(out?)  Date of the sim clock; time.epochMs
 *
 * Control: setRate(r), faster(), slower(), togglePause(), setPaused(b), jump(seconds), setUtc(ms | Date), resetRate().
 * Events on ctx.events: 'time:rate' {rate, prev}, 'time:pause' {paused}, 'time:jump' {from, to, delta};
 * the legacy 'timescale' event (rate) still fires on rate changes.
 */
import { EPOCH_UTC_MS } from './constants.js';

/** Rate ladder for slower / faster ([ and ]); the presets are a subset. */
export const TIME_RATES = [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600, 1800, 3600, 10800, 21600, 86400, 259200, 1e6];
/** Preset buttons (UI). */
export const TIME_PRESETS = [1, 10, 60, 600, 3600, 86400, 1e6];
export const MIN_RATE = 0.1, MAX_RATE = 1e6;

/** Short Russian label of a rate: ×1, ×600, ×1 ч/с … */
export function rateLabel(r) {
  if (!(r > 0)) return '×0';
  if (r >= 1e6) return `×${(r / 1e6).toFixed(r % 1e6 ? 1 : 0)}·10⁶`;
  if (r >= 1000) return `×${(r / 1000).toFixed(r % 1000 ? 1 : 0)} тыс.`;
  return `×${r < 1 ? String(r) : Math.round(r)}`;
}

/** "1 с = 1 ч" style explanation of a rate (tooltips). */
export function rateMeaning(r) {
  if (r <= 1) return r === 1 ? 'реальное время' : `замедление: 1 с = ${r} с`;
  const s = r;
  if (s < 60) return `1 с = ${s} с`;
  if (s < 3600) return `1 с = ${+(s / 60).toFixed(1)} мин`;
  if (s < 86400) return `1 с = ${+(s / 3600).toFixed(1)} ч`;
  return `1 с = ${+(s / 86400).toFixed(1)} сут`;
}

export class SimClock {
  constructor({ sim = 0, rate = 1, epochMs = EPOCH_UTC_MS, events = null } = {}) {
    this.epochMs = epochMs;
    this.sim = sim;
    this.dt = 0; this.realDt = 0; this.rawDt = 0;
    this.rate = clampRate(rate);
    this.paused = false;
    this.elapsed = 0; this.real = 0;
    this.hitch = false;
    this.events = events;
    this._hitchFrames = 0;
    this._date = new Date(this.epochMs);
  }

  /** Legacy alias (ctx.time.scale = rate). */
  get scale() { return this.rate; }
  set scale(r) { this.setRate(r); }

  /** Advance one frame. `realDt` is the clamped wall-clock step, `rawDt` the unclamped one. */
  advance(realDt, rawDt = realDt) {
    this.rawDt = rawDt;
    this.realDt = realDt;
    this.real += rawDt;
    this.dt = this.paused ? 0 : realDt * this.rate;
    this.sim += this.dt;
    if (!this.paused) this.elapsed += realDt;
    this.hitch = this._hitchFrames > 0;
    if (this._hitchFrames > 0) this._hitchFrames--;
    return this.dt;
  }

  /** Mark the next couple of frames as warp-induced hitches (ignored by the quality governor). */
  markHitch(frames = 2) { this._hitchFrames = Math.max(this._hitchFrames, frames); }

  setRate(r) {
    const prev = this.rate;
    const next = clampRate(r);
    if (next === prev) return prev;
    this.rate = next;
    this.markHitch(3);
    this.events?.emit?.('time:rate', { rate: next, prev });
    this.events?.emit?.('timescale', next);
    return next;
  }
  resetRate() { return this.setRate(1); }
  /** Next rate on the ladder (]). */
  faster() { const i = TIME_RATES.findIndex((x) => x > this.rate * 1.0001); return this.setRate(i < 0 ? MAX_RATE : TIME_RATES[i]); }
  /** Previous rate on the ladder ([). */
  slower() { let r = MIN_RATE; for (const x of TIME_RATES) if (x < this.rate * 0.9999) r = x; return this.setRate(r); }

  setPaused(p) {
    p = !!p;
    if (p === this.paused) return;
    this.paused = p;
    this.markHitch(2);
    this.events?.emit?.('time:pause', { paused: p });
  }
  togglePause() { this.setPaused(!this.paused); }

  /** Jump the clock by `seconds` (positive or negative). Modules with integrated state listen to 'time:jump'. */
  jump(seconds) {
    if (!Number.isFinite(seconds) || seconds === 0) return;
    const from = this.sim;
    this.sim += seconds;
    this.markHitch(3);
    this.events?.emit?.('time:jump', { from, to: this.sim, delta: seconds });
  }
  /** Jump to a UTC time (ms since 1970 or a Date). */
  setUtc(ms) { const v = ms instanceof Date ? ms.getTime() : ms; if (Number.isFinite(v)) this.jump((v - this.epochMs) / 1000 - this.sim); }

  /** UTC date of the clock (reuses one Date unless `out` is given). */
  utc(out = this._date) { out.setTime(this.epochMs + this.sim * 1000); return out; }
  utcMs() { return this.epochMs + this.sim * 1000; }
}

function clampRate(r) {
  r = Number(r);
  if (!Number.isFinite(r) || r <= 0) return 1;
  return Math.min(MAX_RATE, Math.max(MIN_RATE, r));
}

/** "22.10.2026 09:30:00" (UTC). */
export function formatUtc(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}
