import { Mixer } from './Mixer.js';
import { Bank } from './Bank.js';

/**
 * Shared playback core: one-shots from the foley bank (optionally positional, HRTF) and persistent loop
 * players with smoothed gain / rate / filter / position. All parameters change through AudioParam ramps.
 */
export class Engine {
  constructor(ac, ctx) {
    this.ac = ac;
    this.ctx = ctx;
    this.mixer = new Mixer(ac);
    this.bank = new Bank(ac);
    this.active = 0;          // one-shots currently playing
    this.maxShots = 56;
    this.loops = [];
    this.listener = { x: 0, y: 0, z: 0 };
    const L = ac.listener;
    this._lp = !!L.positionX;
  }

  now() { return this.ac.currentTime; }
  input(path) { return this.mixer.in[path] || this.mixer.in.air; }

  /**
   * Play a bank sound once. opts: path ('air'|'amb'|'body'|'suit'|'radio'|'pa'|'ui'), gain, rate, jitter (random
   * rate spread), v (variant; random when omitted), at (delay s), pos {x,y,z} world (positional in the air),
   * pan (-1..1), lp / hp (Hz), prio (0..1, dropped first when the voice budget is used up). Returns the end time.
   */
  shot(name, o = {}) {
    if (this.active >= this.maxShots && (o.prio ?? 0.5) < 0.8) return 0;
    const ac = this.ac, bank = this.bank;
    const v = o.v ?? bank.pick(name);
    const buf = bank.get(name, v, true);
    if (!buf) return 0;
    const t = ac.currentTime + Math.max(0, o.at || 0) + 0.005;
    const src = ac.createBufferSource();
    src.buffer = buf;
    const rate = (o.rate ?? 1) * (1 + (Math.random() * 2 - 1) * (o.jitter ?? 0.03));
    src.playbackRate.value = rate;
    let node = src;
    const g = ac.createGain();
    g.gain.value = o.gain ?? 1;
    if (o.lp) { const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; f.Q.value = 0.6; node.connect(f); node = f; }
    if (o.hp) { const f = ac.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = o.hp; f.Q.value = 0.6; node.connect(f); node = f; }
    node.connect(g);
    let out = g;
    if (o.pos) { const p = this.panner(o.pos, o.ref ?? 1.2); g.connect(p); out = p; }
    else if (o.pan) { const p = ac.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, o.pan)); g.connect(p); out = p; }
    out.connect(this.input(o.path || 'air'));
    this.active++;
    src.onended = () => { this.active--; try { out.disconnect(); } catch (_) { /* gone */ } };
    src.start(t);
    return t + buf.duration / rate;
  }

  panner(pos, ref = 1.2, model = 'HRTF') {
    const p = this.ac.createPanner();
    p.panningModel = model; p.distanceModel = 'inverse'; p.refDistance = ref; p.rolloffFactor = 1.1; p.maxDistance = 60;
    setPannerPos(p, pos.x, pos.y, pos.z);
    return p;
  }

  /** A persistent looping voice (starts silent; .set(gain) to fade it). */
  loop(name, path, o = {}) { const l = new LoopPlayer(this, name, path, o); this.loops.push(l); return l; }

  /** Listener from a camera matrixWorld (no allocations). */
  setListener(m) {
    const e = m.elements, L = this.ac.listener, t = this.ac.currentTime;
    const x = e[12], y = e[13], z = e[14];
    this.listener.x = x; this.listener.y = y; this.listener.z = z;
    const fx = -e[8], fy = -e[9], fz = -e[10], ux = e[4], uy = e[5], uz = e[6];
    void t;
    if (this._lp) {
      L.positionX.value = x; L.positionY.value = y; L.positionZ.value = z;
      L.forwardX.value = fx; L.forwardY.value = fy; L.forwardZ.value = fz;
      L.upX.value = ux; L.upY.value = uy; L.upZ.value = uz;
    } else { L.setPosition?.(x, y, z); L.setOrientation?.(fx, fy, fz, ux, uy, uz); }
  }

  update() { for (let i = 0; i < this.loops.length; i++) this.loops[i].update(); }
}

export function setPannerPos(p, x, y, z) {
  if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; }
  else p.setPosition(x, y, z);
}

/**
 * Looping bank sound with smoothed controls. The source node is created once the buffer is ready (the bank
 * renders loops in the background) and started at a random offset so identical loops never phase.
 * Graph: source -> gain -> [lowpass] -> [panner | stereo pan] -> path input.
 */
export class LoopPlayer {
  constructor(engine, name, path, { gain = 0, rate = 1, lp = 0, pos = false, pan = 0, v = 0, ref = 1.5, model = 'HRTF' } = {}) {
    const ac = engine.ac;
    this.e = engine; this.name = name; this.v = v;
    this.g = ac.createGain(); this.g.gain.value = 0;
    this.target = gain; this.rate = rate;
    let out = this.g;
    if (lp) { this.f = ac.createBiquadFilter(); this.f.type = 'lowpass'; this.f.frequency.value = lp; this.f.Q.value = 0.6; this.g.connect(this.f); out = this.f; }
    if (pos) { this.p = engine.panner({ x: 0, y: -1000, z: 0 }, ref, model); out.connect(this.p); out = this.p; }
    else if (pan) { this.sp = ac.createStereoPanner(); this.sp.pan.value = pan; out.connect(this.sp); out = this.sp; }
    out.connect(engine.input(path));
    this.out = out;
    this.src = null;
    this.alive = true;
    if (gain > 0) this.set(gain, 0.05);
    engine.bank.request(name, v, true);
  }

  update() {
    if (this.src || !this.alive) return;
    if (this.target <= 0.0001) return;          // start lazily, only when audible
    const buf = this.e.bank.get(this.name, this.v, false);
    if (!buf) return;
    const s = this.e.ac.createBufferSource();
    s.buffer = buf; s.loop = true;
    s.playbackRate.value = this.rate;
    s.connect(this.g);
    s.start(this.e.ac.currentTime + 0.01, Math.random() * buf.duration);
    this.src = s;
    this.g.gain.setTargetAtTime(this.target, this.e.ac.currentTime, this._tau || 0.2);
  }

  set(gain, tau = 0.2) {
    gain = Math.max(0, gain);
    if (Math.abs(gain - this.target) < 0.004 * Math.max(gain, this.target) + 1e-5 && this._tau === tau) return;
    this.target = gain; this._tau = tau;
    if (this.src) this.g.gain.setTargetAtTime(gain, this.e.ac.currentTime, tau);
  }
  setRate(r, tau = 0.2) { if (Math.abs(r - this.rate) < 0.002 * r) return; this.rate = r; if (this.src) this.src.playbackRate.setTargetAtTime(r, this.e.ac.currentTime, tau); }
  setDetune(c) { if (this.src && this.src.detune) this.src.detune.setTargetAtTime(c, this.e.ac.currentTime, 0.1); }
  setLP(f, tau = 0.1) { if (this.f && Math.abs(f - (this._lpv || 0)) > 0.01 * f) { this._lpv = f; this.f.frequency.setTargetAtTime(f, this.e.ac.currentTime, tau); } }
  setPos(x, y, z) { if (this.p) setPannerPos(this.p, x, y, z); }
  stop() {
    this.alive = false; this.target = 0;
    const t = this.e.ac.currentTime;
    this.g.gain.setTargetAtTime(0, t, 0.1);
    if (this.src) { try { this.src.stop(t + 0.6); } catch (_) { /* stopped */ } }
    setTimeout(() => { try { this.out.disconnect(); } catch (_) { /* gone */ } }, 900);
    const i = this.e.loops.indexOf(this);
    if (i >= 0) this.e.loops.splice(i, 1);
  }
}
