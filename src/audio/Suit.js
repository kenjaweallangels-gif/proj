/**
 * Inside the spacesuit: breathing (rate and effort follow the heart rate), heartbeat above 100 bpm, the
 * backpack ventilation fan and the cooling-garment pump (helmet path), SAFER valve pulses and gas flow heard
 * through the backpack frame, the tether reel motor, tether snatch, switch clicks, caution tones in the
 * headset, and the donning / doffing timeline (rustle, rings, zip, helmet latch, pressurisation, fan spin-up)
 * that also opens / closes the helmet acoustically (the world becomes muffled when the helmet latches).
 */
export class Suit {
  constructor(engine, ctx) {
    this.e = engine; this.ctx = ctx;
    this.fan = engine.loop('suitfan_loop', 'suit', { gain: 0 });
    this.pump = engine.loop('suitpump_loop', 'suit', { gain: 0 });
    this.safer = engine.loop('safer_loop', 'body', { gain: 0, lp: 1500 });
    this.reel = engine.loop('reel_loop', 'body', { gain: 0, lp: 2500 });
    this.helmet = 0;               // acoustic helmet closure 0..1 (smoothed)
    this.helmetTarget = 0;
    this.timeline = [];            // scheduled {t, fn} (real seconds)
    this.override = null;          // helmet override while donning / doffing
    this.fanSpin = 1;
    this.breath = { phase: 'pause', t: 1.0, inDur: 1.4, outDur: 1.9 };
    this.heartPhase = 0;
    this.rcsTimer = 0; this.rotTimer = 0;
    this.warnTimer = 0;
    this.tautWas = false;
    this.time = 0;
    this.fanParam = 1;
  }

  /** Suit donning ('don') or doffing ('doff') over `d` seconds. */
  sequence(kind, d) {
    const e = this.e, T = this.time;
    const at = (frac, fn) => this.timeline.push({ t: T + d * frac, fn });
    if (kind === 'don') {
      this.override = 0;
      at(0.0, () => e.shot('cloth', { path: 'air', gain: 0.25 }));
      at(0.08, () => e.shot('cloth', { path: 'air', gain: 0.3 }));
      at(0.18, () => e.shot('zipper', { path: 'air', gain: 0.25 }));
      at(0.3, () => e.shot('cloth', { path: 'air', gain: 0.25 }));
      at(0.38, () => e.shot('bearing_clicks', { path: 'air', gain: 0.35, pan: -0.4 }));
      at(0.52, () => e.shot('bearing_clicks', { path: 'air', gain: 0.35, pan: 0.4 }));
      at(0.62, () => e.shot('latch', { path: 'air', gain: 0.3, rate: 1.4 }));       // backpack / rear hatch lever
      at(0.78, () => { e.shot('helmet_latch', { path: 'air', gain: 0.5 }); e.shot('helmet_latch', { path: 'body', gain: 0.35 }); this.override = 1; });
      at(0.84, () => { e.shot('suit_hiss', { path: 'suit', gain: 0.35 }); this.fanSpin = 0.25; });
      at(0.86, () => e.shot('suit_beep', { path: 'radio', gain: 0.25, v: 0 }));
      at(1.02, () => { this.override = null; });
    } else {
      this.override = 1;
      at(0.0, () => { this.fanSpin = 0.2; e.shot('suit_beep', { path: 'radio', gain: 0.22, v: 2 }); });
      at(0.12, () => e.shot('suit_hiss', { path: 'suit', gain: 0.3, rate: 0.85 }));
      at(0.24, () => { e.shot('helmet_latch', { path: 'body', gain: 0.35, rate: 0.9 }); this.override = 0; });
      at(0.3, () => e.shot('helmet_latch', { path: 'air', gain: 0.4, rate: 0.9 }));
      at(0.42, () => e.shot('bearing_clicks', { path: 'air', gain: 0.3, pan: 0.4 }));
      at(0.55, () => e.shot('bearing_clicks', { path: 'air', gain: 0.3, pan: -0.4 }));
      at(0.66, () => e.shot('zipper', { path: 'air', gain: 0.22, rate: 0.9 }));
      at(0.74, () => e.shot('cloth', { path: 'air', gain: 0.3 }));
      at(0.9, () => e.shot('cloth', { path: 'air', gain: 0.25 }));
      at(1.02, () => { this.override = null; });
    }
  }

  click(suited) {
    if (suited) { this.e.shot('latch_small', { path: 'body', gain: 0.14, rate: 1.3 }); this.e.shot('suit_beep', { path: 'radio', gain: 0.06, v: 1, rate: 1.5 }); }
    else this.e.shot('ui_click', { path: 'ui', gain: 0.25 });
  }

  update(dt, st, active) {
    const e = this.e;
    this.time += dt;
    // timeline
    if (this.timeline.length) {
      for (let i = 0; i < this.timeline.length; i++) { const it = this.timeline[i]; if (it.t <= this.time) { it.fn(); this.timeline.splice(i, 1); i--; } }
    }
    const suited = !!st.suited;
    this.helmetTarget = this.override ?? (suited ? 1 : 0);
    this.helmet += (this.helmetTarget - this.helmet) * Math.min(1, dt * 12);
    const inSuit = this.helmet > 0.5;
    const on = active && inSuit;
    // ventilation fan and pump (spin up after donning)
    this.fanSpin += ((inSuit ? 1 : 0.2) - this.fanSpin) * Math.min(1, dt * 0.9);
    const power = st.power ?? 1;
    const fanGain = inSuit ? 0.17 * this.fanParam * (0.6 + 0.4 * Math.min(1, power * 4)) * Math.min(1, this.fanSpin * 1.3) : 0;
    this.fan.set(fanGain * (active ? 1 : 0.5), 0.3);
    this.fan.setRate(0.35 + 0.65 * this.fanSpin * (power < 0.25 ? 0.85 : 1), 0.4);
    this.pump.set(inSuit ? 0.05 : 0, 0.5);

    // breathing: cycle follows the heart rate; harder breaths above ~110 bpm
    const hr = st.heartRate || 64;
    const effort = Math.max(0, Math.min(1, (hr - 62) / 70));
    const b = this.breath;
    b.t -= dt;
    if (b.t <= 0) {
      const cycle = 60 / (12 + (hr - 60) * 0.26);
      const hard = effort > 0.55;
      if (b.phase === 'pause' || b.phase === 'out') {
        b.phase = 'in';
        b.inDur = cycle * (hard ? 0.36 : 0.32);
        this._breath(hard ? 'breath_in_hard' : 'breath_in', b.inDur, effort, suited, active);
        b.t = b.inDur + 0.05;
      } else if (b.phase === 'in') {
        b.phase = 'out';
        b.outDur = cycle * (hard ? 0.44 : 0.42);
        this._breath(hard ? 'breath_out_hard' : 'breath_out', b.outDur, effort, suited, active);
        b.t = b.outDur + cycle * (hard ? 0.15 : 0.25);
      }
    }
    // heartbeat (felt / heard in the suit when the pulse is high)
    if (hr > 100 && active) {
      const prev = this.heartPhase;
      this.heartPhase += dt * hr / 60;
      if (Math.floor(this.heartPhase) > Math.floor(prev)) {
        const g = (0.25 + 0.55 * Math.min(1, (hr - 100) / 40)) * (inSuit ? 1 : 0.5);
        e.shot('heart', { path: 'body', gain: g, v: 0, jitter: 0.01 });
        e.shot('heart', { path: 'body', gain: g * 0.7, v: 1, at: 0.17, jitter: 0.01 });
      }
    } else this.heartPhase = 0;

    // SAFER: valve pulses + gas flow through the backpack (EVA only)
    const eva = st.mode === 'eva';
    const thr = on && eva && st.thrusting;
    this.safer.set(thr ? (st.boost ? 0.2 : 0.12) : (on && eva && st.killing ? 0.07 : 0), 0.04);
    this.rcsTimer -= dt;
    if (thr && this.rcsTimer <= 0) { e.shot('safer_valve', { path: 'body', gain: st.boost ? 0.42 : 0.3, lp: 2600, jitter: 0.06, prio: 0.3 }); this.rcsTimer = (st.boost ? 0.065 : 0.095) * (0.85 + Math.random() * 0.3); }
    if (!thr) this.rcsTimer = 0;
    const rot = on && eva ? Math.max(st.rotationThrust || 0, st.killing ? 0.5 : 0) : 0;
    this.rotTimer -= dt;
    if (rot > 0.05 && this.rotTimer <= 0) { e.shot('safer_valve', { path: 'body', gain: 0.16 * Math.min(1, rot + 0.3), rate: 1.25, lp: 2200, prio: 0.2 }); this.rotTimer = 0.11 + Math.random() * 0.08; }
    // tether reel and snatch
    this.reel.set(on && eva && st.reeling ? 0.2 : 0, 0.08);
    this.reel.setRate(st.tetherTaut ? 0.85 : 1.0, 0.2);
    if (on && eva && st.tetherTaut && !this.tautWas) e.shot('tether_twang', { path: 'body', gain: 0.25 + 0.3 * Math.min(1, (st.speedRelative || 0) / 1.5) });
    this.tautWas = !!st.tetherTaut;

    // caution tones in the headset
    this.warnTimer -= dt;
    if (on && this.warnTimer <= 0) {
      if (st.o2 < 0.1) { e.shot('suit_beep', { path: 'radio', gain: 0.35, v: 1 }); e.shot('suit_beep', { path: 'radio', gain: 0.35, v: 1, at: 0.2 }); this.warnTimer = 1.6; }
      else if (st.propellant < 0.15 && eva) { e.shot('suit_beep', { path: 'radio', gain: 0.28, v: 0 }); e.shot('suit_beep', { path: 'radio', gain: 0.28, v: 2, at: 0.15 }); this.warnTimer = 2.2; }
      else if (st.tetherTaut && eva) { e.shot('suit_beep', { path: 'radio', gain: 0.18, v: 0 }); this.warnTimer = 1.4; }
      else if (eva && !st.tetherAttached && !st.tetherStowed) { e.shot('suit_beep', { path: 'radio', gain: 0.22, v: 2, rate: 0.8 }); this.warnTimer = 3.0; }
      else this.warnTimer = 0.3;
    }
  }

  _breath(name, dur, effort, suited, active) {
    const e = this.e;
    const v = e.bank.pick(name), buf = e.bank.get(name, v, true);
    if (!buf) return;
    const rate = Math.max(0.8, Math.min(1.25, buf.duration / Math.max(0.3, dur)));
    if (this.helmet > 0.5) e.shot(name, { path: 'suit', v, gain: (0.22 + 0.28 * effort) * (active ? 1 : 0.4), rate, jitter: 0.02, prio: 0.9 });
    else if (active && effort > 0.25) e.shot(name, { path: 'body', v, gain: 0.03 + 0.06 * effort, rate, lp: 2500 });   // unsuited: only when out of breath
    void suited;
  }
}
