import { roomClass, bedFor, Occlusion, zoneToWorld } from './Zones.js';

/**
 * Station life: the ventilation bed of the compartment you are in (crossfaded on zone changes), positional
 * equipment sources (freezers, galley fridge, pumps, rack fans, greenhouse irrigation, a crewmate on the
 * treadmill / ergometer) heard through open hatches with occlusion, and random events: laptop beeps and
 * typing, CO2-scrubber bed switches, water gurgles, fridge compressor clunks, thermal creaks of the hull at
 * sunrise and sunset.
 */
const SOURCES = [
  // zone, offset (frame coordinates from the zone's bounding-sphere centre), loop, gain, rate, behaviour
  { zone: 'lab', off: [3.5, -0.8, 0.7], name: 'freezer_loop', gain: 0.2, rate: 1.0 },
  { zone: 'lab', off: [-4.5, 1.0, -0.6], name: 'suitfan_loop', gain: 0.1, rate: 0.55 },
  { zone: 'hab2', off: [-3.5, -0.6, 0.9], name: 'fridge_loop', gain: 0.22, rate: 1.0, cycle: [38, 55], clunk: true },
  { zone: 'medical', off: [0.6, -0.6, 1.5], name: 'freezer_loop', gain: 0.1, rate: 1.3 },
  { zone: 'service', off: [2.5, -0.7, 0.8], name: 'pump_loop', gain: 0.07, rate: 0.42 },
  { zone: 'service', off: [-3.5, 1.0, -0.5], name: 'suitfan_loop', gain: 0.14, rate: 0.5 },
  { zone: 'greenhouse', off: [0, -0.8, 0.6], name: 'irrigation_loop', gain: 0.12, rate: 1.0, cycle: [16, 40] },
  { zone: 'hab1', off: [0.6, -0.8, 1.0], name: 'treadmill_loop', gain: 0.32, rate: 1.0, session: 'tread' },
  { zone: 'hab1', off: [-0.6, -0.6, -2.0], name: 'ergo_loop', gain: 0.2, rate: 1.0, session: 'ergo' },
  { zone: 'node1', off: [0, 1.2, 0], name: 'suitfan_loop', gain: 0.06, rate: 0.62 },
  { zone: 'node2', off: [0, 1.2, 0], name: 'suitfan_loop', gain: 0.06, rate: 0.6 },
  { zone: 'node3', off: [0, 1.2, 0], name: 'suitfan_loop', gain: 0.06, rate: 0.64 },
  { zone: 'pod1', off: [1.5, 0, 0], name: 'treadmill_loop', gain: 0.32, rate: 0.95, session: 'tread4' },
  { zone: 'pod4', off: [-1.5, 0, 0], name: 'ergo_loop', gain: 0.22, rate: 1.0, session: 'ergo4' },
];
const MAX_VOICES = 6;
const _w = { x: 0, y: 0, z: 0 };

export class StationLife {
  constructor(engine, ctx) {
    this.e = engine; this.ctx = ctx;
    this.occ = new Occlusion();
    this.bed = null; this.bedName = null; this.oldBeds = [];
    this.zone = null; this.cls = null;
    this.sources = null;
    this.sessions = {};
    this.timer = 0;
    this.evTimer = { laptop: 8 + Math.random() * 10, scrub: 40 + Math.random() * 40, gurgle: 30 + Math.random() * 40, creak: 0 };
    this.creaks = 0;
    this.sunPrev = null;
  }

  _build() {
    const I = this.ctx.station?.interior;
    if (!I?.ready || this.sources) return;
    this.sources = [];
    for (const s of SOURCES) {
      const z = I.byId.get(s.zone);
      if (!z || !z.sphere) continue;
      const c = z.sphere.center;
      this.sources.push({ ...s, z, lx: c.x + s.off[0], ly: c.y + s.off[1], lz: c.z + s.off[2], voice: null, on: !s.cycle && !s.session, t: Math.random() * 30, aud: 0 });
    }
    for (const s of this.sources) if (s.session && !this.sessions[s.session]) this.sessions[s.session] = { on: false, t: 60 + Math.random() * 240 };
  }

  /** Thermal creaks: called on sunrise / sunset transitions. */
  thermal() { this.creaks = 3 + Math.floor(Math.random() * 4); this.evTimer.creak = 2 + Math.random() * 6; }

  update(dt, L) {
    // L: { zone, inside, x (ring-local x), density, scale }
    this._build();
    const e = this.e;
    const zone = L.inside ? L.zone : null;
    const cls = zone ? roomClass(zone, L.x) : null;
    // ---- ambience bed (crossfade when the bed changes)
    const bed = bedFor(zone, cls);
    const name = bed ? bed[0] : null;
    if (name !== this.bedName) {
      if (this.bed) { const b = this.bed; b.set(0, 0.8); this.oldBeds.push({ b, t: 3 }); }
      this.bed = name ? e.loop(name, 'amb', { gain: 0 }) : null;
      this.bedName = name;
    }
    if (this.bed) this.bed.set(bed[1], 0.8);
    for (let i = 0; i < this.oldBeds.length; i++) { const o = this.oldBeds[i]; o.t -= dt; if (o.t <= 0) { o.b.stop(); this.oldBeds.splice(i, 1); i--; } }
    if (zone !== this.zone) { this.zone = zone; this.timer = 0; }
    this.cls = cls;
    // ---- sessions / cycles
    for (const k in this.sessions) { const s = this.sessions[k]; s.t -= dt; if (s.t <= 0) { s.on = !s.on; s.t = s.on ? 70 + Math.random() * 120 : 180 + Math.random() * 300; } }
    if (!this.sources) return;
    for (const s of this.sources) {
      if (s.cycle) {
        s.t -= dt;
        if (s.t <= 0) {
          s.on = !s.on; s.t = s.on ? s.cycle[0] * (0.8 + 0.4 * Math.random()) : s.cycle[1] * (0.8 + 0.4 * Math.random());
          if (s.clunk && s.aud > 0.02) { zoneToWorld(this.ctx.station.interior, s.z, s.lx, s.ly, s.lz, _w); e.shot('fridge_clunk', { path: 'amb', gain: 0.5 * s.aud / s.gain, pos: _w }); }
        }
      } else if (s.session) s.on = this.sessions[s.session].on;
    }
    // ---- occlusion + voice allocation (4 Hz)
    this.timer -= dt;
    const I = this.ctx.station.interior;
    if (this.timer <= 0) {
      this.timer = 0.25;
      this.occ.update(zone);
      const lx = e.listener.x, ly = e.listener.y, lz = e.listener.z;
      for (const s of this.sources) {
        const o = zone && s.on ? this.occ.get(s.z) : null;
        if (!o) { s.aud = 0; continue; }
        zoneToWorld(I, s.z, s.lx, s.ly, s.lz, _w);
        const d = Math.hypot(_w.x - lx, _w.y - ly, _w.z - lz);
        s.aud = s.gain * o.gain / (1 + d / 4);
        s.lp = o.lp;
      }
      // keep the loudest MAX_VOICES
      const ranked = this._ranked || (this._ranked = []);
      ranked.length = 0;
      for (const s of this.sources) if (s.aud > 0.004) ranked.push(s);
      ranked.sort((a, b) => b.aud - a.aud);
      if (ranked.length > MAX_VOICES) ranked.length = MAX_VOICES;
      for (const s of this.sources) {
        const want = ranked.includes(s);
        if (want && !s.voice) s.voice = e.loop(s.name, 'amb', { gain: 0, rate: s.rate, lp: 20000, pos: true, ref: 1.5 });
        else if (!want && s.voice && s.aud <= 0.004) { s.voice.stop(); s.voice = null; }
        if (s.voice) { s.voice.set(want ? s.gain * (this.occ.get(s.z)?.gain ?? 0) : 0, 0.4); s.voice.setLP(s.lp || 20000, 0.3); }
      }
    }
    // positions every frame (ring sources rotate with the ring)
    for (const s of this.sources) if (s.voice) { zoneToWorld(I, s.z, s.lx, s.ly, s.lz, _w); s.voice.setPos(_w.x, _w.y, _w.z); }
    // ---- random events in the current compartment
    if (!zone || L.density < 0.05) return;
    const T = this.evTimer;
    T.laptop -= dt; T.scrub -= dt; T.gurgle -= dt;
    if (T.laptop <= 0) {
      T.laptop = 14 + Math.random() * 40;
      if (cls !== 'spoke' && cls !== 'tunnel') {
        this._randomPos(zone, 1.8);
        if (Math.random() < 0.6) e.shot('laptop_beep', { path: 'amb', gain: 0.12, pos: _w, ref: 1.0 });
        else e.shot('keys', { path: 'amb', gain: 0.2, pos: _w, ref: 1.0 });
      }
    }
    if (T.scrub <= 0) {
      T.scrub = 90 + Math.random() * 90;
      const sv = I.byId.get('service'), o = sv ? this.occ.get(sv) : null;
      if (o) { const c = sv.sphere.center; _w.x = c.x - 2; _w.y = c.y - 0.6; _w.z = c.z + 0.8; e.shot('scrubber_cycle', { path: 'amb', gain: 0.5 * o.gain, pos: _w, lp: o.lp }); }
    }
    if (T.gurgle <= 0) {
      T.gurgle = 40 + Math.random() * 60;
      const id = Math.random() < 0.5 ? 'service' : 'hab2', z = I.byId.get(id), o = z ? this.occ.get(z) : null;
      if (o) { const c = z.sphere.center; _w.x = c.x + 1; _w.y = c.y - 0.5; _w.z = c.z; e.shot('water_gurgle', { path: 'amb', gain: 0.25 * o.gain, pos: _w, lp: o.lp }); }
    }
    if (this.creaks > 0) {
      T.creak -= dt;
      if (T.creak <= 0) {
        this.creaks--; T.creak = 4 + Math.random() * 14;
        this._randomPos(zone, 3.5);
        e.shot('struct_creak', { path: 'amb', gain: 0.22 + 0.2 * Math.random(), pos: _w, ref: 2 });
      }
    }
  }

  /** A point near the listener (curved ring zones have their bounding-sphere centre outside the tube). */
  _randomPos(z, spread) {
    const L = this.e.listener, r = Math.min(spread, (z.sphere?.radius || 3) * 0.6);
    _w.x = L.x + (Math.random() - 0.5) * 2 * r; _w.y = L.y + (Math.random() - 0.5) * r; _w.z = L.z + (Math.random() - 0.5) * 2 * r;
    return _w;
  }
}
