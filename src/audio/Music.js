/**
 * Adaptive soundtrack director. Plays the offline-rendered pieces of public/audio/music (manifest.json):
 * seamless loops (AudioBufferSource loopStart / loopEnd inside the encoded pre / post-roll) and stingers.
 *
 *   mood -> piece   station «Тихий ход», eva «Над Землёй», night «Ночная сторона», sunrise «Терминатор»,
 *                   docking «Сближение», deep «Глубина», flight «Импульс», lunar «Селена»; menu -> eva
 *   stingers        sting_sunrise «Восход», sting_capture «Захват», sting_wonder «Чудо»
 *
 * The mood is chosen from the game state (see Audio._musicMood): menu, overrides from scenarios, telescope,
 * docking nearby, sunrise, outside / inside, day / night. A mood must hold for a few seconds before the
 * music changes; changes crossfade (old out over ~5 s, new in over ~6 s, entering a piece where it was left
 * last time). After a piece has played for a while the director may rest (fade out, 30-90 s of silence).
 * Radio and alarms duck the music. Buffers are decoded at 32 kHz (memory) and only two pieces are kept.
 */
const MOOD_TRACK = { station: 'station_calm', eva: 'eva_earth', night: 'night_side', sunrise: 'sunrise', docking: 'docking', deep: 'deep_space', flight: 'flight', lunar: 'lunar', menu: 'eva_earth' };
const DECODE_RATE = 32000;

export class Music {
  constructor(engine, ctx) {
    this.e = engine; this.ac = engine.ac; this.ctx = ctx;
    this.out = engine.mixer.in.music;
    this.manifest = null;
    this.buffers = new Map();     // name -> AudioBuffer
    this.loading = new Map();     // name -> Promise
    this.order = [];              // LRU of loop pieces
    this.cur = null;              // { name, src, gain, t0, offset, buf }
    this.mood = null; this.want = null; this.wantSince = 0;
    this.lastSwitch = -1e9;
    this.enabled = true;
    this.positions = {};          // name -> offset (s) where it was left
    this.rest = { until: 0, next: 0 };
    this.duckUntil = 0;
    this.failed = new Set();
    this.pending = null;
    this.base = ctx.assetUrl ? ctx.assetUrl('audio/music/') : 'audio/music/';
    this._load();
  }

  async _load() {
    try {
      const r = await fetch(`${this.base}manifest.json`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      this.manifest = (await r.json()).tracks || {};
    } catch (e) { console.warn('[Audio] music manifest unavailable:', e?.message || e); this.manifest = {}; }
  }

  _decodeCtx() {
    if (this._dc) return this._dc;
    try { this._dc = new OfflineAudioContext(2, 1, DECODE_RATE); } catch (_) { this._dc = this.ac; }
    return this._dc;
  }

  /** Decode a piece (cached; keeps at most two loop pieces). */
  fetch(name) {
    if (this.buffers.has(name)) return Promise.resolve(this.buffers.get(name));
    if (this.loading.has(name)) return this.loading.get(name);
    const info = this.manifest?.[name];
    if (!info) return Promise.resolve(null);
    const p = fetch(`${this.base}${info.file}`).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
      .then((ab) => new Promise((res, rej) => { const pr = this._decodeCtx().decodeAudioData(ab, res, rej); if (pr && pr.then) pr.then(res, rej); }))
      .then((buf) => {
        this.loading.delete(name);
        this.buffers.set(name, buf);
        if (info.loop) {
          this.order = this.order.filter((n) => n !== name); this.order.push(name);
          while (this.order.length > 2) {
            const victim = this.order.find((n) => n !== name && n !== this.cur?.name);
            if (!victim) break;
            this.order.splice(this.order.indexOf(victim), 1); this.buffers.delete(victim);
          }
        }
        return buf;
      })
      .catch((e) => { this.loading.delete(name); this.failed.add(name); console.warn(`[Audio] music ${name}:`, e?.message || e); return null; });
    this.loading.set(name, p);
    return p;
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (!on) { this._stop(2.0); this.buffers.clear(); this.order.length = 0; this.mood = null; }
  }

  /** Start a loop piece with a fade-in, resuming where it was left. */
  async _play(name, fadeIn = 6) {
    if (this.cur?.name === name || this.pending === name || this.failed.has(name)) return;
    this.pending = name;
    const buf = await this.fetch(name);
    if (this.pending === name) this.pending = null;
    if (!buf || !this.enabled || MOOD_TRACK[this.mood] !== name || this.cur?.name === name) return;
    const info = this.manifest[name];
    this._stop(5);
    const ac = this.ac, t = ac.currentTime + 0.05;
    const src = ac.createBufferSource();
    src.buffer = buf; src.loop = true;
    const ls = info.loopStart || 0, le = info.loopEnd || buf.duration;
    src.loopStart = ls; src.loopEnd = le;
    const g = ac.createGain(); g.gain.value = 0;
    src.connect(g); g.connect(this.out);
    const pos = this.positions[name] ?? 0;
    const off = ls + ((pos % (le - ls)) + (le - ls)) % (le - ls);
    src.start(t, off);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.0001, t + 0.05);
    g.gain.setTargetAtTime(1, t + 0.05, fadeIn / 3);
    this.cur = { name, src, gain: g, t0: t, offset: off - ls, len: le - ls };
    this.lastSwitch = ac.currentTime;
    this.rest.next = ac.currentTime + (le - ls) * (1 + Math.random()) + 60;
  }

  _stop(fade = 5) {
    const c = this.cur;
    if (!c) return;
    const ac = this.ac, t = ac.currentTime;
    this.positions[c.name] = c.offset + (t - c.t0);
    c.gain.gain.cancelScheduledValues(t);
    c.gain.gain.setValueAtTime(c.gain.gain.value, t);
    c.gain.gain.setTargetAtTime(0, t, fade / 4);
    try { c.src.stop(t + fade * 1.6); } catch (_) { /* stopped */ }
    setTimeout(() => { try { c.gain.disconnect(); } catch (_) { /* gone */ } }, (fade * 1.6 + 0.5) * 1000);
    this.cur = null;
  }

  /** Play a stinger over the music (ducking the bed underneath). */
  async sting(name, gain = 0.9) {
    if (!this.enabled) return;
    const buf = await this.fetch(name);
    if (!buf) return;
    const ac = this.ac, t = ac.currentTime + 0.05;
    const src = ac.createBufferSource(); src.buffer = buf;
    const g = ac.createGain(); g.gain.value = gain;
    src.connect(g); g.connect(this.out);
    src.start(t);
    src.onended = () => { try { g.disconnect(); } catch (_) { /* gone */ } this.buffers.delete(name); };
    if (this.cur) { const cg = this.cur.gain.gain; cg.cancelScheduledValues(t); cg.setValueAtTime(cg.value, t); cg.setTargetAtTime(0.35, t, 1.0); cg.setTargetAtTime(1, t + buf.duration * 0.7, 3.0); }
  }

  /** Duck under radio / alerts for `s` seconds. */
  duck(s, depth = 0.45) {
    const t = this.ac.currentTime;
    this.duckUntil = Math.max(this.duckUntil, t + s);
    this.e.mixer.duckMusic(depth, 0.12);
  }

  /** mood: string | null (null = silence). Called a few times per second. */
  update(dt, mood) {
    const ac = this.ac, t = ac.currentTime;
    if (this.duckUntil && t > this.duckUntil) { this.duckUntil = 0; this.e.mixer.duckMusic(1, 0.6); }
    if (!this.enabled || !this.manifest) return;
    if (this.cur) this.positions[this.cur.name] = this.cur.offset + (t - this.cur.t0);
    if (mood !== this.want) { this.want = mood; this.wantSince = t; }
    // mood must hold before switching (2 s from the menu, 5 s otherwise), and at least 15 s between switches
    const hold = this.mood === 'menu' || mood === 'menu' ? 1.5 : 5;
    if (this.want !== this.mood && t - this.wantSince > hold && (t - this.lastSwitch > 15 || this.mood === 'menu' || this.want === 'menu' || !this.cur)) {
      this.mood = this.want;
      this.rest.until = 0;
      if (!this.mood) this._stop(6);
      else this._play(MOOD_TRACK[this.mood] || 'station_calm');
      return;
    }
    // rests: after a long play, fade out and stay silent for a while (not in the menu)
    if (this.mood && this.mood !== 'menu' && this.cur && t > this.rest.next) {
      this._stop(10);
      this.rest.until = t + 30 + Math.random() * 60;
      this.rest.next = Infinity;
    } else if (this.mood && !this.cur && this.rest.until && t > this.rest.until) {
      this.rest.until = 0;
      this._play(MOOD_TRACK[this.mood] || 'station_calm', 10);
    } else if (this.mood && !this.cur && !this.rest.until && !this.pending) {
      this._play(MOOD_TRACK[this.mood] || 'station_calm');
    }
  }

  /** Preload the piece of a mood (e.g. the menu music while the scene loads). */
  preload(mood) { const n = MOOD_TRACK[mood]; if (n) this.fetch(n); }

  get current() { return this.cur ? { name: this.cur.name, title: this.manifest?.[this.cur.name]?.title, mood: this.mood } : null; }
}
