import { FOLEY, generate } from './foley.js';

/**
 * AudioBuffer cache of the procedural foley bank. Entries are rendered in a Web Worker (no main-thread
 * hitches); a one-shot that is needed before the worker has delivered it is rendered synchronously (they cost
 * a few milliseconds), loops are only ever rendered in the background (callers retry until ready).
 */
export class Bank {
  constructor(ac) {
    this.ac = ac;
    this.sr = ac.sampleRate;
    this.cache = new Map();
    this.pending = new Set();
    this.last = new Map();
    this.queue = [];
    this.inFlight = 0;
    this.worker = null;
    this.syncMs = 0;
    try {
      this.worker = new Worker(new URL('./foleyWorker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e) => this._receive(e.data);
      this.worker.onerror = (e) => { console.warn('[Audio] foley worker failed, rendering on the main thread', e?.message || e); this.worker = null; this._drain(); };
    } catch (_) { this.worker = null; }
  }

  key(name, v) { return `${name}#${v}`; }
  variants(name) { return FOLEY[name]?.n || 0; }

  /** Random variant, never the same one twice in a row. */
  pick(name) {
    const n = this.variants(name);
    if (n <= 1) return 0;
    const prev = this.last.get(name) ?? -1;
    let v = Math.floor(Math.random() * n);
    if (v === prev) v = (v + 1 + Math.floor(Math.random() * (n - 1))) % n;
    this.last.set(name, v);
    return v;
  }

  /** AudioBuffer or null (queues the render). sync=true renders one-shots right now when missing. */
  get(name, v = 0, sync = true) {
    const k = this.key(name, v), b = this.cache.get(k);
    if (b) return b;
    const e = FOLEY[name];
    if (!e) return null;
    if (sync && !e.loop) {
      const t0 = performance.now();
      const g = generate(name, this.sr, v);
      this.syncMs += performance.now() - t0;
      this.pending.delete(k);
      return this._store(k, g.channels);
    }
    this.request(name, v, true);
    return null;
  }

  ready(name, v = 0) { return this.cache.has(this.key(name, v)); }

  /** Queue a background render (front=true jumps the queue). */
  request(name, v = 0, front = false) {
    const k = this.key(name, v);
    if (this.cache.has(k) || this.pending.has(k) || !FOLEY[name]) return;
    this.pending.add(k);
    if (front) this.queue.unshift([name, v]); else this.queue.push([name, v]);
    this._drain();
  }

  /** Render every variant of the listed entries in the background. */
  prewarm(names) { for (const n of names) for (let v = 0; v < this.variants(n); v++) this.request(n, v); }

  _drain() {
    while (this.queue.length && this.inFlight < 2) {
      const [name, v] = this.queue.shift();
      const k = this.key(name, v);
      if (this.cache.has(k)) { this.pending.delete(k); continue; }
      if (this.worker) { this.inFlight++; this.worker.postMessage({ id: k, name, v, sr: this.sr }); }
      else {
        // no worker: render on the main thread, one entry per idle slot
        this.inFlight++;
        setTimeout(() => { this.inFlight--; try { const g = generate(name, this.sr, v); this._store(k, g.channels); } catch (e) { console.warn(e); } this.pending.delete(k); this._drain(); }, 30);
        return;
      }
    }
  }

  _receive(d) {
    this.inFlight = Math.max(0, this.inFlight - 1);
    this.pending.delete(d.id);
    if (!d.error && d.channels) this._store(d.id, d.channels);
    this._drain();
  }

  _store(k, channels) {
    const n = channels[0].length;
    const b = this.ac.createBuffer(channels.length, n, this.sr);
    channels.forEach((c, i) => b.copyToChannel(c, i));
    this.cache.set(k, b);
    return b;
  }

  dispose() { try { this.worker?.terminate(); } catch (_) { /* ignore */ } this.cache.clear(); }
}
