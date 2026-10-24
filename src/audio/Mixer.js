import { makeRng, roomIR } from './dsp.js';

/**
 * Mixing graph and acoustic contexts.
 *
 *  air  (sfx)  ─┐                                ┌─ dry ───────────────┐
 *  amb  (amb)  ─┼─ airSum ──────────────────────┼─ send A ─ convA ────┼─ airMix ─ thin-air / helmet LP ─ helmet peak ─ airOut ─┐
 *  pa   (voice, loudspeaker band) ─┘             └─ send B ─ convB ────┘                                                       │
 *  body (sfx)  ─ structure EQ ────────────────────────────────────────────────────────────────────────────────────────────────┤
 *  suit (sfx)  ─ dry + helmet IR ─────────────────────────────────────────────────────────────────────────────────────────────┼─ world ─ pause ─┐
 *  radio(voice)─ band-pass ─ soft clip ──────────────────────────────────────────────────────────────────────────────────────────────────────┤
 *  ui   (ui)   ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 *  music(music)─ duck ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┴─ master ─ limiter ─ out
 *
 * `air` carries sound through the cabin atmosphere: it is scaled by the air density (cabin pressure; zero in
 * vacuum, so nothing reaches the ear through it outside), gets duller as the pressure falls, and is muffled by
 * the closed helmet when suited. `body` is what reaches the ear through the structure and one's own body
 * (contacts, the suit's own machinery heard through its frame), `suit` is inside the helmet (breath, fans),
 * `radio` the headset. Two convolvers crossfade between procedurally generated room responses.
 */

/** Room acoustics per class: IR parameters (see dsp.roomIR) and wet level. */
export const ROOMS = {
  airlock: { ir: { rt: [0.5, 0.42, 0.24], er: 6, erSpan: 0.009, flutter: 0.0078, flutterGain: 0.35, metal: 0.6, metalModes: [210, 470, 820, 1310, 1900] }, wet: 0.34 },
  module: { ir: { rt: [0.55, 0.45, 0.24], er: 10, erSpan: 0.016, metal: 0.15 }, wet: 0.22 },
  service: { ir: { rt: [0.6, 0.5, 0.27], er: 10, erSpan: 0.018, metal: 0.3 }, wet: 0.24 },
  node: { ir: { rt: [0.62, 0.5, 0.3], er: 8, erSpan: 0.014, metal: 0.25 }, wet: 0.26 },
  cupola: { ir: { rt: [0.42, 0.38, 0.32], er: 6, erSpan: 0.007, bright: 0.6 }, wet: 0.24 },
  green: { ir: { rt: [0.45, 0.34, 0.17], er: 8, erSpan: 0.014 }, wet: 0.17 },
  hub: { ir: { rt: [0.85, 0.68, 0.36], er: 10, erSpan: 0.022, metal: 0.35 }, wet: 0.3 },
  tunnel: { ir: { rt: [1.0, 0.85, 0.4], er: 6, erSpan: 0.01, flutter: 0.0092, flutterGain: 0.5, metal: 0.3 }, wet: 0.33 },
  spoke: { ir: { rt: [1.35, 1.1, 0.5], er: 6, erSpan: 0.012, flutter: 0.0125, flutterGain: 0.45, metal: 0.45, metalModes: [150, 340, 610, 980] }, wet: 0.36 },
  hall: { ir: { rt: [0.9, 0.75, 0.4], er: 12, erSpan: 0.03, metal: 0.12 }, wet: 0.27 },
  corridor: { ir: { rt: [0.7, 0.55, 0.3], er: 10, erSpan: 0.02 }, wet: 0.21 },
  cabin: { ir: { rt: [0.3, 0.22, 0.12], er: 8, erSpan: 0.006 }, wet: 0.12 },
  helmet: { ir: { rt: [0.06, 0.05, 0.04], len: 0.08, er: 5, erSpan: 0.0018, pre: 0.0004, bright: 0.4 }, wet: 1 },
};

const VOL_KEYS = ['master', 'music', 'sfx', 'ambience', 'voice', 'ui'];

export class Mixer {
  constructor(ac) {
    this.ac = ac;
    const g = (v = 1) => { const n = ac.createGain(); n.gain.value = v; return n; };
    const f = (type, freq, q = 0.7, gain = 0) => { const n = ac.createBiquadFilter(); n.type = type; n.frequency.value = freq; n.Q.value = q; n.gain.value = gain; return n; };
    this._g = g; this._f = f;
    const out = ac.destination;
    // master + limiter (brick-wall-ish safety; the mix itself is gain-staged well below it)
    this.limiter = ac.createDynamicsCompressor();
    this.limiter.threshold.value = -4; this.limiter.knee.value = 2; this.limiter.ratio.value = 16; this.limiter.attack.value = 0.002; this.limiter.release.value = 0.12;
    this.limiter.connect(out);
    this.master = g(1); this.master.connect(this.limiter);
    // category gains
    this.vol = {};
    for (const k of VOL_KEYS) this.vol[k] = 1;
    this.world = g(1);           // everything diegetic (sfx / ambience / radio)
    this.pause = g(1);           // menu / pause ducking of the world
    this.world.connect(this.pause); this.pause.connect(this.master);
    // ---------------- air path
    this.in = {};
    this.in.air = g(1); this.in.amb = g(1); this.in.pa = g(1);
    this.airSum = g(1);
    this.in.air.connect(this.airSum); this.in.amb.connect(this.airSum);
    // PA loudspeakers: small speakers, band-limited, into the room
    this.paBand = f('bandpass', 1400, 0.55); this.paShelf = f('peaking', 2600, 1.2, 4);
    this.in.pa.connect(this.paBand); this.paBand.connect(this.paShelf); this.paShelf.connect(this.airSum);
    this.airMix = g(1);
    this.dry = g(1); this.airSum.connect(this.dry); this.dry.connect(this.airMix);
    this.conv = [ac.createConvolver(), ac.createConvolver()];
    this.send = [g(0), g(0)];
    this.ret = [g(1), g(1)];
    for (let i = 0; i < 2; i++) { this.conv[i].normalize = false; this.send[i].connect(this.conv[i]); this.conv[i].connect(this.ret[i]); this.ret[i].connect(this.airMix); }
    this.convConnected = [false, false];
    this.airLP = f('lowpass', 20000, 0.6);
    this.helmetPeak = f('peaking', 480, 1.0, 0);
    this.airOut = g(1);
    this.airMix.connect(this.airLP); this.airLP.connect(this.helmetPeak); this.helmetPeak.connect(this.airOut); this.airOut.connect(this.world);
    // ---------------- body / structure path
    this.in.body = g(1);
    this.bodyLP = f('lowpass', 6000, 0.6); this.bodyLow = f('lowshelf', 180, 0.7, 0);
    this.in.body.connect(this.bodyLP); this.bodyLP.connect(this.bodyLow); this.bodyLow.connect(this.world);
    // ---------------- suit (inside the helmet)
    this.in.suit = g(1);
    this.suitDry = g(0.75); this.suitWet = g(0.45);
    this.helmetConv = ac.createConvolver(); this.helmetConv.normalize = false;
    this.in.suit.connect(this.suitDry); this.suitDry.connect(this.world);
    this.in.suit.connect(this.helmetConv); this.helmetConv.connect(this.suitWet); this.suitWet.connect(this.world);
    // ---------------- radio headset
    this.in.radio = g(1);
    this.radioHP = f('highpass', 320, 0.7); this.radioLP = f('lowpass', 3200, 0.9); this.radioMid = f('peaking', 1800, 1.0, 5);
    this.radioShaper = ac.createWaveShaper(); this.radioShaper.curve = softClipCurve(2.2); this.radioShaper.oversample = '2x';
    this.radioOut = g(0.55);
    this.in.radio.connect(this.radioHP); this.radioHP.connect(this.radioMid); this.radioMid.connect(this.radioShaper); this.radioShaper.connect(this.radioLP); this.radioLP.connect(this.radioOut); this.radioOut.connect(this.world);
    // ---------------- ui and music (non-diegetic, bypass the pause duck)
    this.in.ui = g(1); this.in.ui.connect(this.master);
    this.in.music = g(1); this.musicDuck = g(1); this.in.music.connect(this.musicDuck); this.musicDuck.connect(this.master);
    // category -> input gains
    this.catNodes = { sfx: [this.in.air, this.in.body, this.in.suit], ambience: [this.in.amb], voice: [this.in.radio, this.in.pa], ui: [this.in.ui], music: [this.in.music] };
    // rooms
    this.rng = makeRng(0x51ab);
    this.irCache = new Map();
    this.room = null; this.active = 0; this.wet = 0;
    this.helmetConv.buffer = this._ir('helmet');
    this.state = { density: 1, helmet: 0 };
  }

  /** Category volumes 0..1 ('master','music','sfx','ambience','voice','ui') and the mute flag. */
  setVolumes(v, muted) {
    const t = this.ac.currentTime;
    for (const k of VOL_KEYS) if (typeof v[k] === 'number') this.vol[k] = v[k];
    this.master.gain.setTargetAtTime(muted ? 0 : curve(this.vol.master), t, 0.05);
    for (const [k, nodes] of Object.entries(this.catNodes)) for (const n of nodes) n.gain.setTargetAtTime(curve(this.vol[k] ?? 1), t, 0.05);
  }

  _ir(name) {
    if (!this.irCache.has(name)) {
      const ch = roomIR(this.ac.sampleRate, this.rng, ROOMS[name].ir);
      const b = this.ac.createBuffer(2, ch[0].length, this.ac.sampleRate);
      b.copyToChannel(ch[0], 0); b.copyToChannel(ch[1], 1);
      this.irCache.set(name, b);
    }
    return this.irCache.get(name);
  }

  /** Switch the room response (crossfade between the two convolvers). */
  setRoom(name) {
    if (!ROOMS[name] || name === this.room) return;
    const t = this.ac.currentTime, nxt = 1 - this.active;
    // a convolver's buffer can be set only once: replace the idle one
    const old = this.conv[nxt];
    const c = this.ac.createConvolver(); c.normalize = false; c.buffer = this._ir(name);
    try { this.send[nxt].disconnect(); old.disconnect(); } catch (_) { /* fresh */ }
    this.send[nxt].connect(c); c.connect(this.ret[nxt]);
    this.conv[nxt] = c;
    this.send[this.active].gain.setTargetAtTime(0, t, 0.25);
    this.active = nxt;
    this.room = name;
    this.wet = ROOMS[name].wet;
    this.send[nxt].gain.setTargetAtTime(this.wet, t, 0.25);
  }

  /**
   * Acoustic context per frame: density 0..1 (cabin air, 0 = vacuum), helmet 0..1 (closed helmet), wetScale.
   * Level through the air follows the pressure (amplitude ~ p), the high end goes first in thin air.
   */
  setAcoustics(density, helmet, wetScale = 1) {
    const t = this.ac.currentTime, s = this.state;
    s.density = density; s.helmet = helmet;
    const d = Math.max(0, Math.min(1, density));
    const level = d <= 0.001 ? 0 : Math.pow(d, 0.9) * (1 - 0.62 * helmet);
    this.airOut.gain.setTargetAtTime(level, t, 0.08);
    const thin = 250 + 19000 * Math.pow(d, 1.6);
    const cut = Math.min(thin, helmet > 0 ? 18000 - 16800 * helmet : 20000);
    this.airLP.frequency.setTargetAtTime(cut, t, 0.08);
    this.helmetPeak.gain.setTargetAtTime(4.5 * helmet, t, 0.1);
    if (this.room) this.send[this.active].gain.setTargetAtTime(this.wet * wetScale, t, 0.2);
    // structure-borne sound reaches the ear through the suit: duller, more low end
    this.bodyLP.frequency.setTargetAtTime(helmet > 0.5 ? 2600 : 7000, t, 0.1);
    this.bodyLow.gain.setTargetAtTime(helmet > 0.5 ? 4 : 0, t, 0.1);
    this.suitDry.gain.setTargetAtTime(0.75 * helmet, t, 0.1);
    this.suitWet.gain.setTargetAtTime(0.45 * helmet, t, 0.1);
  }

  /** Duck the world (menu / pause): 1 = full. */
  setPause(v) { this.pause.gain.setTargetAtTime(v, this.ac.currentTime, 0.25); }
  /** Music ducking under radio / alerts: 1 = none. */
  duckMusic(v, tau = 0.15) { this.musicDuck.gain.setTargetAtTime(v, this.ac.currentTime, tau); }
}

/** Perceptual slider -> gain (x^2, so 50 % is about -12 dB). */
export function curve(v) { const x = Math.max(0, Math.min(1, +v || 0)); return x * x; }

function softClipCurve(k) {
  const n = 1024, c = new Float32Array(n), norm = Math.tanh(k);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / norm; }
  return c;
}
