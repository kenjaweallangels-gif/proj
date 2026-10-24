/**
 * Procedural WebAudio for the EVA (no asset files). Everything is synthesised from noise buffers
 * and oscillators:
 *   fan        suit ventilation hum (filtered noise + 120 Hz tone)      – continuous
 *   breath     breathing loop shaped by an envelope, rate follows heartRate
 *   heart      two low thumps per beat, audible above 100 bpm
 *   rcs / rot  thruster hiss bursts while thrusting (translation / rotation)
 *   depress / repress   airlock air hiss fading out / rising
 *   hatchMotor + clunk  hatch drive whine and latch
 *   radio      quindar tones + faint filtered chatter, occasionally
 *   warn       beeps: tether taut, low propellant, low O2
 *   grab / release / impact / click / detach
 *   cabin      inside the station: ventilation hum of the modules (fans, pumps), louder in the service module
 *   step / rung / suit   footsteps in the gravity ring, ladder rungs, donning / doffing the spacesuit
 * The AudioContext is created lazily on the first user gesture; every method is safe to call
 * when no context exists (screenshot mode, autoplay policy).
 *
 *   audio.play(name, opts)   audio.setParam(name, value)   audio.muted (M toggles)   audio.update(dt, ctx)
 */
export class Audio {
  constructor(ctx) {
    this.ctx = ctx;
    this.ac = null;
    this.ready = false;
    this._muted = false;
    this._volume = 1;
    this.params = { crawl: 0, radio: 1 };
    this.time = 0;
    this.breathPhase = 0;
    this.heartPhase = 0;
    this.radioTimer = 12 + Math.random() * 20;
    this.warnTimer = 0;
    this.rcsTimer = 0;
    this.nodes = {};
    this._pending = [];
    this._gesture = () => this._init();
    for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, this._gesture, { passive: true });
    if (ctx.params?.get?.('mute') === '1') this._muted = true;
  }

  get muted() { return this._muted; }
  set muted(v) { this._muted = !!v; this._applyMaster(); }
  /** Master volume 0..1 (also `setParam('volume', v)`). */
  get volume() { return this._volume; }
  set volume(v) { this._volume = Math.min(1, Math.max(0, +v || 0)); this._applyMaster(); }
  _applyMaster() {
    if (this.nodes.master && this.ac) this.nodes.master.gain.setTargetAtTime(this._muted ? 0 : this._volume, this.ac.currentTime, 0.05);
  }

  // ---------------------------------------------------------------- setup
  _init() {
    if (this.ac) { if (this.ac.state === 'suspended') this.ac.resume().catch(() => {}); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ac = this.ac = new AC({ latencyHint: 'interactive' });
      const N = this.nodes;
      N.master = ac.createGain(); N.master.gain.value = this._muted ? 0 : this._volume; N.master.connect(ac.destination);
      // gentle compressor keeps thruster bursts from clipping the quiet suit ambience
      N.comp = ac.createDynamicsCompressor(); N.comp.threshold.value = -18; N.comp.ratio.value = 4; N.comp.connect(N.master);
      this.noiseBuf = this._noiseBuffer(2.0);
      this._buildFan(); this._buildBreath(); this._buildRcs(); this._buildAir(); this._buildRadio(); this._buildCrawl(); this._buildCabin();
      this.ready = true;
      for (const [name, opts] of this._pending) this.play(name, opts);
      this._pending.length = 0;
    } catch (e) { console.warn('[Audio] unavailable:', e?.message || e); this.ac = null; }
  }

  _noiseBuffer(seconds) {
    const ac = this.ac, n = Math.floor(ac.sampleRate * seconds), buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) {
      // pinkish noise (Paul Kellet's economy filter)
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.0990460; b1 = 0.96300 * b1 + w * 0.2965164; b2 = 0.57000 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11;
    }
    return buf;
  }

  _noiseSource(loop = true) { const s = this.ac.createBufferSource(); s.buffer = this.noiseBuf; s.loop = loop; return s; }
  _gain(v, dest) { const g = this.ac.createGain(); g.gain.value = v; g.connect(dest || this.nodes.comp); return g; }
  _filter(type, f, q = 1, dest) { const fl = this.ac.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; if (dest) fl.connect(dest); return fl; }

  _buildFan() {
    const N = this.nodes, ac = this.ac;
    N.fanGain = this._gain(0.0);
    const bp = this._filter('bandpass', 420, 0.9, N.fanGain);
    const src = this._noiseSource(); src.connect(bp); src.start();
    const tone = ac.createOscillator(); tone.type = 'sine'; tone.frequency.value = 120;
    const tone2 = ac.createOscillator(); tone2.type = 'triangle'; tone2.frequency.value = 241.3;
    const tg = this._gain(0.35, N.fanGain); tone.connect(tg); const tg2 = this._gain(0.08, N.fanGain); tone2.connect(tg2);
    tone.start(); tone2.start();
    N.fanGain.gain.setTargetAtTime(0.11, ac.currentTime, 1.5);
  }

  _buildBreath() {
    const N = this.nodes;
    N.breathGain = this._gain(0.0);
    N.breathFilter = this._filter('bandpass', 700, 0.8, N.breathGain);
    const src = this._noiseSource(); src.connect(N.breathFilter); src.start();
    // heartbeat: low sine thumps are scheduled in update()
    N.heartGain = this._gain(0.9);
    N.heartFilter = this._filter('lowpass', 140, 0.7, N.heartGain);
  }

  _buildRcs() {
    const N = this.nodes;
    N.rcsGain = this._gain(0.0);
    const hp = this._filter('highpass', 1400, 0.7, N.rcsGain);
    const src = this._noiseSource(); src.connect(hp); src.start();
    N.rotGain = this._gain(0.0);
    const bp = this._filter('bandpass', 3200, 2.5, N.rotGain);
    const src2 = this._noiseSource(); src2.connect(bp); src2.start();
    // thruster solenoid click layer
    N.rcsClick = this._filter('bandpass', 1800, 6, this.nodes.comp);
  }

  _buildAir() {
    const N = this.nodes;
    N.airGain = this._gain(0.0);
    N.airFilter = this._filter('lowpass', 2500, 0.6, N.airGain);
    const src = this._noiseSource(); src.connect(N.airFilter); src.start();
  }

  _buildRadio() {
    const N = this.nodes;
    N.radioGain = this._gain(0.0);
    N.radioFilter = this._filter('bandpass', 1300, 2.2, N.radioGain);
    const src = this._noiseSource(); src.connect(N.radioFilter); src.start();
  }

  _buildCrawl() {
    const N = this.nodes;
    N.crawlGain = this._gain(0.0);
    const bp = this._filter('bandpass', 260, 1.2, N.crawlGain);
    const src = this._noiseSource(); src.connect(bp); src.start();
  }

  _buildCabin() {
    const N = this.nodes, ac = this.ac;
    N.cabinGain = this._gain(0.0);
    // broadband fan noise (low-passed), a 50/100 Hz pump hum and a faint high whine of avionics fans
    const lp = this._filter('lowpass', 520, 0.7, N.cabinGain);
    const src = this._noiseSource(); src.playbackRate.value = 0.7; src.connect(lp); src.start();
    const hum = ac.createOscillator(); hum.type = 'sine'; hum.frequency.value = 50;
    const hum2 = ac.createOscillator(); hum2.type = 'triangle'; hum2.frequency.value = 100.4;
    const whine = ac.createOscillator(); whine.type = 'sine'; whine.frequency.value = 1830;
    const hg = this._gain(0.22, N.cabinGain); hum.connect(hg); const hg2 = this._gain(0.06, N.cabinGain); hum2.connect(hg2);
    const wg = this._gain(0.004, N.cabinGain); whine.connect(wg);
    hum.start(); hum2.start(); whine.start();
  }

  // ---------------------------------------------------------------- one-shots
  /** play(name, opts). Unknown names are ignored. Safe without an AudioContext. */
  play(name, opts = {}) {
    if (!this.ac) return;   // no context yet (before the first user gesture) or audio unavailable: silently ignore
    if (this.ac.state === 'suspended') this.ac.resume().catch(() => {});
    const ac = this.ac, t = ac.currentTime, N = this.nodes;
    switch (name) {
      case 'depress': {
        const d = opts.duration || 8;
        N.airGain.gain.cancelScheduledValues(t); N.airGain.gain.setValueAtTime(0.0, t); N.airGain.gain.linearRampToValueAtTime(0.55, t + 0.4);
        N.airGain.gain.setValueAtTime(0.55, t + 0.6); N.airGain.gain.exponentialRampToValueAtTime(0.002, t + d);
        N.airFilter.frequency.cancelScheduledValues(t); N.airFilter.frequency.setValueAtTime(3000, t); N.airFilter.frequency.exponentialRampToValueAtTime(220, t + d);
        this._beep(1200, 0.08, 0.15, t); this._beep(1200, 0.08, 0.15, t + 0.18);
        break;
      }
      case 'repress': {
        const d = opts.duration || 6;
        N.airGain.gain.cancelScheduledValues(t); N.airGain.gain.setValueAtTime(0.02, t); N.airGain.gain.linearRampToValueAtTime(0.5, t + d * 0.6); N.airGain.gain.linearRampToValueAtTime(0.0, t + d);
        N.airFilter.frequency.cancelScheduledValues(t); N.airFilter.frequency.setValueAtTime(300, t); N.airFilter.frequency.exponentialRampToValueAtTime(3200, t + d);
        break;
      }
      case 'hatchMotor': {
        const d = opts.duration || 4;
        const osc = ac.createOscillator(); osc.type = 'sawtooth'; osc.frequency.setValueAtTime(140, t); osc.frequency.linearRampToValueAtTime(190, t + 0.6); osc.frequency.setValueAtTime(190, t + d - 0.4); osc.frequency.linearRampToValueAtTime(120, t + d);
        const lp = this._filter('lowpass', 900, 1.5); const g = this._gain(0.0); lp.connect(g); osc.connect(lp);
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.09, t + 0.3); g.gain.setValueAtTime(0.09, t + d - 0.3); g.gain.linearRampToValueAtTime(0, t + d);
        const rumble = this._noiseSource(); const rl = this._filter('lowpass', 180, 0.8); const rg = this._gain(0.0); rl.connect(rg); rumble.connect(rl);
        rg.gain.setValueAtTime(0, t); rg.gain.linearRampToValueAtTime(0.25, t + 0.4); rg.gain.setValueAtTime(0.25, t + d - 0.3); rg.gain.linearRampToValueAtTime(0, t + d);
        osc.start(t); osc.stop(t + d + 0.05); rumble.start(t); rumble.stop(t + d + 0.05);
        this._clunk(t + 0.05, 0.6);
        break;
      }
      case 'clunk': this._clunk(t, 1.0); break;
      case 'grab': this._clunk(t, 0.45, 260); this._beep(900, 0.05, 0.05, t + 0.02); break;
      case 'release': this._clunk(t, 0.25, 320); break;
      case 'detach': this._clunk(t, 0.5, 200); this._beep(660, 0.25, 0.2, t + 0.1); this._beep(520, 0.25, 0.2, t + 0.4); break;
      case 'click': this._beep(1500, 0.03, 0.08, t); break;
      case 'impact': {
        const s = Math.min(1, opts.strength ?? 0.5);
        this._clunk(t, 0.4 + 0.9 * s, 90 + 60 * s);
        // the shell rings through the suit
        const osc = ac.createOscillator(); osc.type = 'sine'; osc.frequency.value = 330 + Math.random() * 60; const g = this._gain(0.0); osc.connect(g);
        g.gain.setValueAtTime(0.06 * s, t); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.5); osc.start(t); osc.stop(t + 0.55);
        break;
      }
      case 'warn': this._beep(opts.freq || 880, opts.dur || 0.12, opts.gain || 0.12, t); break;
      case 'step': this._clunk(t, 0.18 + Math.random() * 0.06, 70 + Math.random() * 20); break;
      case 'rung': this._clunk(t, 0.16, 420 + Math.random() * 60); break;
      case 'suit': {
        // donning / doffing: fabric rustle, a zipper, the helmet latching, a short pressure-check hiss
        const d = opts.duration || 3;
        for (let k = 0; k < 5; k++) this._clunk(t + 0.2 + k * d * 0.15, 0.12, 200 + k * 30);
        const zs = this._noiseSource(false); const zf = this._filter('bandpass', 2600, 3); const zg = this._gain(0.0); zf.connect(zg); zs.connect(zf);
        zg.gain.setValueAtTime(0, t + d * 0.3); zg.gain.linearRampToValueAtTime(0.08, t + d * 0.32); zg.gain.linearRampToValueAtTime(0.0, t + d * 0.5);
        zs.start(t + d * 0.3); zs.stop(t + d * 0.52);
        this._clunk(t + d * 0.85, 0.7, 160);
        const hs = this._noiseSource(false); const hf = this._filter('highpass', 2000, 0.7); const hgn = this._gain(0.0); hf.connect(hgn); hs.connect(hf);
        hgn.gain.setValueAtTime(0.07, t + d * 0.9); hgn.gain.exponentialRampToValueAtTime(0.001, t + d * 1.1); hs.start(t + d * 0.9); hs.stop(t + d * 1.12);
        break;
      }
      case 'radio': this._radioBurst(t); break;
      default: break;
    }
  }

  /** setParam(name, value): 'volume' (0..1 master), 'crawl' (0/1), 'fan' (0..1), 'radio' (0..1 chatter level). */
  setParam(name, value) {
    if (name === 'volume') { this.volume = value; return; }
    if (name === 'muted') { this.muted = !!value; return; }
    this.params[name] = +value || 0;
    if (!this.ac || !this.ready) return;
    const N = this.nodes, t = this.ac.currentTime;
    if (name === 'fan' && N.fanGain) N.fanGain.gain.setTargetAtTime(0.11 * this.params.fan, t, 0.3);
  }

  _beep(freq, dur, gain, t) {
    const ac = this.ac; const osc = ac.createOscillator(); osc.type = 'square'; osc.frequency.value = freq;
    const lp = this._filter('lowpass', freq * 2.5, 0.8); const g = this._gain(0.0); lp.connect(g); osc.connect(lp);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.008); g.gain.setValueAtTime(gain, t + dur - 0.01); g.gain.linearRampToValueAtTime(0, t + dur);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  _clunk(t, strength = 1, freq = 120) {
    const ac = this.ac;
    const src = this._noiseSource(false); const lp = this._filter('lowpass', 180 + freq, 1.2); const g = this._gain(0.0); lp.connect(g); src.connect(lp);
    g.gain.setValueAtTime(0.6 * strength, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18); src.start(t); src.stop(t + 0.25);
    const osc = ac.createOscillator(); osc.type = 'sine'; osc.frequency.setValueAtTime(freq, t); osc.frequency.exponentialRampToValueAtTime(freq * 0.55, t + 0.15);
    const og = this._gain(0.0); osc.connect(og); og.gain.setValueAtTime(0.35 * strength, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.22); osc.start(t); osc.stop(t + 0.25);
  }

  _radioBurst(t) {
    const N = this.nodes, ac = this.ac;
    // quindar tone, chatter (random AM envelope), closing tone
    this._quindar(t);
    const len = 1.8 + Math.random() * 2.5;
    const g = N.radioGain.gain, lvl = Math.min(1, Math.max(0, this.params.radio ?? 1));
    g.cancelScheduledValues(t); g.setValueAtTime(0, t + 0.3);
    let tt = t + 0.35;
    while (tt < t + 0.35 + len) {
      const seg = 0.06 + Math.random() * 0.16;
      g.linearRampToValueAtTime((Math.random() < 0.25 ? 0.01 : 0.05 + Math.random() * 0.08) * lvl, tt + seg * 0.5);
      g.linearRampToValueAtTime(0.02 * lvl, tt + seg);
      tt += seg;
    }
    g.linearRampToValueAtTime(0, tt + 0.1);
    N.radioFilter.frequency.setValueAtTime(1100 + Math.random() * 500, t);
    this._quindar(tt + 0.25);
    void ac;
  }

  _quindar(t) {
    const ac = this.ac; const osc = ac.createOscillator(); osc.type = 'sine'; osc.frequency.value = 2525;
    const g = this._gain(0.0); osc.connect(g);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.045, t + 0.01); g.gain.setValueAtTime(0.045, t + 0.24); g.gain.linearRampToValueAtTime(0, t + 0.26);
    osc.start(t); osc.stop(t + 0.3);
  }

  /** One short thruster pulse: a 60 ms filtered noise burst with a sharp attack and a solenoid click. */
  _rcsBurst(t, strength = 1) {
    const ac = this.ac, N = this.nodes;
    const src = this._noiseSource(false); src.playbackRate.value = 1 + Math.random() * 0.3;
    const hp = this._filter('highpass', 1200 + Math.random() * 600, 0.8); const g = this._gain(0.0); hp.connect(g); src.connect(hp);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.22 * strength, t + 0.006); g.gain.exponentialRampToValueAtTime(0.002, t + 0.07);
    src.start(t); src.stop(t + 0.09);
    const click = this._noiseSource(false); const cf = this._filter('bandpass', 1800, 6); const cg = this._gain(0.0); cf.connect(cg); click.connect(cf);
    cg.gain.setValueAtTime(0.12 * strength, t); cg.gain.exponentialRampToValueAtTime(0.001, t + 0.02); click.start(t); click.stop(t + 0.03);
    void N;
  }

  _thump(t, gain) {
    const ac = this.ac, N = this.nodes;
    const osc = ac.createOscillator(); osc.type = 'sine'; osc.frequency.setValueAtTime(58, t); osc.frequency.exponentialRampToValueAtTime(34, t + 0.14);
    const g = ac.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.012); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    osc.connect(g); g.connect(N.heartFilter); osc.start(t); osc.stop(t + 0.18);
  }

  // ---------------------------------------------------------------- per frame
  update(dt, ctx) {
    const inp = ctx.input;
    if (inp?.wasPressed('KeyM')) this.muted = !this.muted;
    if (!this.ac || !this.ready) return;
    const ac = this.ac, t = ac.currentTime, N = this.nodes;
    const p = ctx.player?.state;
    if (!p) return;
    const dtr = Math.min(Math.max(dt / (ctx.time?.scale || 1), 0), 0.1);
    this.time += dtr;
    const active = ctx.mode !== 'observer';

    // inside the station: cabin ventilation; without the suit no suit fan and a quieter, open-air breath
    const unsuited = p.suited === false;
    const insideCabin = p.mode === 'iva' || p.mode === 'airlock';
    const loud = typeof p.compartment === 'string' && p.compartment.includes('ВЕКТОР') ? 1.6 : p.frame === 'ring' ? 0.7 : 1;
    N.cabinGain.gain.setTargetAtTime(active && insideCabin && p.airlockPressure > 0.3 ? 0.075 * loud * (unsuited ? 1 : 0.45) : 0, t, 0.6);
    // breathing: rate follows heart rate; inhale brighter, exhale darker
    const bpm = 11 + (p.heartRate - 60) * 0.22;
    this.breathPhase = (this.breathPhase + dtr * bpm / 60) % 1;
    const ph = this.breathPhase;
    const inhale = ph < 0.42 ? Math.sin((ph / 0.42) * Math.PI) : 0;
    const exhale = ph >= 0.48 && ph < 0.95 ? Math.sin(((ph - 0.48) / 0.47) * Math.PI) : 0;
    const effort = 0.5 + (p.heartRate - 60) / 80;
    N.breathGain.gain.setTargetAtTime((inhale * 0.045 + exhale * 0.07) * effort * (active ? 1 : 0.3) * (unsuited ? 0.25 : 1), t, 0.03);
    N.breathFilter.frequency.setTargetAtTime(inhale > 0 ? 900 : 520, t, 0.05);

    // heartbeat (lub-dub) when the pulse is high
    if (p.heartRate > 100) {
      const prev = this.heartPhase;
      this.heartPhase += dtr * p.heartRate / 60;
      if (Math.floor(this.heartPhase) > Math.floor(prev)) {
        const g = 0.25 + 0.6 * Math.min(1, (p.heartRate - 100) / 40);
        this._thump(t + 0.01, g); this._thump(t + 0.01 + 0.17, g * 0.75);
      }
    } else this.heartPhase = 0;

    // thrusters: a low sustained hiss plus short solenoid-pulsed noise bursts (SAFER pulses at ~10 Hz)
    const rcs = active && p.thrusting ? (p.boost ? 0.16 : 0.09) : 0;
    N.rcsGain.gain.setTargetAtTime(rcs, t, 0.03);
    this.rcsTimer -= dtr;
    if (active && p.thrusting && this.rcsTimer <= 0) { this._rcsBurst(t, p.boost ? 1.5 : 1); this.rcsTimer = p.boost ? 0.07 : 0.1; }
    if (!p.thrusting) this.rcsTimer = 0;
    const rot = active && (p.rotationThrust || 0) > 0.05 ? 0.07 * Math.min(1, p.rotationThrust) : (active && p.killing ? 0.06 : 0);
    N.rotGain.gain.setTargetAtTime(rot, t, 0.05);
    N.crawlGain.gain.setTargetAtTime(active && this.params.crawl > 0 ? 0.12 : 0, t, 0.08);

    // fan slows down (power saving) with low power; 'fan' param scales it
    N.fanGain.gain.setTargetAtTime(unsuited ? 0 : 0.11 * (this.params.fan ?? 1) * (0.6 + 0.4 * Math.min(1, (p.power ?? 1) * 4)), t, 0.5);

    // warnings
    this.warnTimer -= dtr;
    if (active && this.warnTimer <= 0) {
      if (p.o2 < 0.1) { this._beep(1040, 0.14, 0.14, t); this._beep(1040, 0.14, 0.14, t + 0.2); this.warnTimer = 1.6; }
      else if (p.propellant < 0.15 && p.mode === 'eva') { this._beep(760, 0.1, 0.1, t); this._beep(620, 0.1, 0.1, t + 0.14); this.warnTimer = 2.2; }
      else if (p.tetherTaut) { this._beep(880, 0.1, 0.1, t); this.warnTimer = 0.8; }
      else if (!p.tetherAttached && p.mode === 'eva') { this._beep(500, 0.2, 0.08, t); this.warnTimer = 3.0; }
      else this.warnTimer = 0.3;
    }

    // radio chatter now and then
    this.radioTimer -= dtr;
    if (this.radioTimer <= 0) { this._radioBurst(t); this.radioTimer = 25 + Math.random() * 45; }
  }

  dispose() {
    for (const ev of ['pointerdown', 'keydown']) window.removeEventListener(ev, this._gesture);
    if (this.ac) this.ac.close().catch(() => {});
  }
}
