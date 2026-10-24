/**
 * Airlock sequences, driven by the player's sequence state (st.sequence {name, progress}) and the crew-lock
 * pressure (st.airlockPressure), so they follow pauses and time scaling exactly:
 *
 *  depress    valve actuation, depress pump spinning up (heard through the structure), air rushing out of
 *             the vent; the cabin-air path itself fades with the pressure (Mixer.setAcoustics), so the hiss
 *             dies to silence and only the suit remains; vent valve to vacuum at 70 %
 *  hatchOpen / close   outer EVA hatch in vacuum: latch releases, drive motor and the closing clunk reach the
 *             astronaut only through the hull and the hand on the chamber handhold
 *  repress    equalisation valve opens: the rush grows out of silence as pressure (and with it the medium)
 *             returns, then thins out as the pressures equalise; valve closes
 *  innerOpen / innerClose   pressurised hatch: handle ratchet strokes, latches, hinge creak, seal
 */
const _p = { x: 0, y: 0, z: 0 };

export class Airlock {
  constructor(engine, ctx) {
    this.e = engine; this.ctx = ctx;
    this.pump = engine.loop('pump_loop', 'body', { gain: 0, lp: 1100 });
    this.pumpAir = engine.loop('pump_loop', 'air', { gain: 0, lp: 1800 });
    this.hiss = engine.loop('hiss_loop', 'air', { gain: 0 });
    this.rush = engine.loop('rush_loop', 'air', { gain: 0 });
    this.motor = engine.loop('motor_loop', 'body', { gain: 0, lp: 1300 });
    this.motorAir = engine.loop('motor_loop', 'air', { gain: 0, pos: true, ref: 1.2 });
    this.seq = null; this.prog = 0; this.flags = {};
    this.lastEnd = -1;
  }

  _hatchPos(inner) {
    const al = this.ctx.station?.airlock;
    const c = inner ? al?.innerHatchCenter : (al?.hatchCenter || al?.standPosition);
    if (c) { _p.x = c.x; _p.y = c.y; _p.z = c.z; } else { const e = this.ctx.camera.matrixWorld.elements; _p.x = e[12]; _p.y = e[13]; _p.z = e[14]; }
    return _p;
  }

  /** True while (or just after) a sequence owns the hatch / clunk sounds. */
  busy(now) { return !!this.seq || now - this.lastEnd < 0.25; }

  _start(name) {
    const e = this.e, f = this.flags;
    for (const k in f) delete f[k];
    switch (name) {
      case 'depress':
        e.shot('valve_open', { path: 'body', gain: 0.5 }); e.shot('valve_open', { path: 'air', gain: 0.45 });
        e.shot('suit_beep', { path: 'radio', gain: 0.22, v: 0 }); e.shot('suit_beep', { path: 'radio', gain: 0.22, v: 0, at: 0.18 });
        break;
      case 'repress':
        e.shot('valve_open', { path: 'body', gain: 0.6, rate: 0.9 });
        e.shot('suit_beep', { path: 'radio', gain: 0.2, v: 1 });
        break;
      case 'hatchOpen':
        for (let k = 0; k < 3; k++) e.shot('latch_small', { path: 'body', gain: 0.35, rate: 0.7, lp: 1500, at: 0.05 + k * 0.22 });
        break;
      case 'close':
        break;
      case 'innerOpen': case 'innerClose': {
        const pos = this._hatchPos(true);
        for (let k = 0; k < 3; k++) e.shot('ratchet', { path: 'air', gain: 0.45, pos, at: k * 0.5 });
        if (name === 'innerOpen') e.shot('seal', { path: 'air', gain: 0.45, pos, at: 1.45 });
        break;
      }
      default: break;
    }
  }

  _end(name) {
    const e = this.e;
    this.lastEnd = e.now();
    switch (name) {
      case 'depress': e.shot('valve_open', { path: 'body', gain: 0.4, rate: 1.2 }); break;
      case 'repress': e.shot('valve_open', { path: 'air', gain: 0.4, rate: 1.15 }); e.shot('suit_beep', { path: 'radio', gain: 0.2, v: 0 }); break;
      case 'hatchOpen': e.shot('latch', { path: 'body', gain: 0.45, lp: 1200, rate: 0.8 }); break;
      case 'close': e.shot('latch', { path: 'body', gain: 0.7, lp: 1400 }); e.shot('seal', { path: 'body', gain: 0.4 }); break;
      case 'innerOpen': case 'innerClose': {
        const pos = this._hatchPos(true);
        e.shot('latch', { path: 'air', gain: 0.6, pos });
        if (name === 'innerClose') e.shot('seal', { path: 'air', gain: 0.4, pos, at: 0.05 });
        break;
      }
      default: break;
    }
  }

  update(dt, st) {
    const name = st.sequence?.name || null;
    if (name !== this.seq) {
      if (this.seq) this._end(this.seq);
      this.seq = name;
      if (name) this._start(name);
    }
    const p = st.sequence?.progress ?? 0;
    const al = this.ctx.station?.airlock;
    let pump = 0, hiss = 0, rush = 0, motor = 0, motorAir = 0;
    if (name === 'depress') {
      const up = Math.min(1, p / 0.08), down = p > 0.85 ? Math.max(0, 1 - (p - 0.85) / 0.15) : 1;
      pump = 0.38 * up * down;
      this.pump.setRate(0.85 + 0.35 * p, 0.3);
      hiss = 0.55 * Math.min(1, p / 0.05) * (1 - 0.5 * p);
      rush = 0.25 * Math.min(1, p / 0.05) * (1 - p);
      if (p > 0.7 && !this.flags.vent) { this.flags.vent = true; this.e.shot('valve_open', { path: 'body', gain: 0.35, rate: 0.8 }); hiss *= 1.4; }
    } else if (name === 'repress') {
      rush = 0.8 * Math.min(1, p / 0.04) * Math.pow(Math.max(0, 1 - p), 0.6);
      hiss = 0.35 * Math.pow(Math.max(0, 1 - p), 1.2);
    } else if (name === 'hatchOpen' || name === 'close') {
      const moving = al?.hatch?.isMoving ?? (p > 0.02 && p < 0.98);
      motor = moving ? 0.32 : 0;
    } else if (name === 'innerOpen' || name === 'innerClose') {
      const moving = (al?.innerHatch?.progress ?? 0) > 0.001 && (al?.innerHatch?.progress ?? 1) < 0.999;
      motorAir = moving ? 0.22 : 0;
      motor = moving ? 0.06 : 0;
      if (moving && !this.flags.creak) { this.flags.creak = true; this.e.shot('hinge_creak', { path: 'air', gain: 0.3, pos: this._hatchPos(true) }); }
    }
    this.pump.set(pump, 0.25);
    this.pumpAir.set(pump * 0.45, 0.25);
    this.hiss.set(hiss, 0.15);
    this.rush.set(rush, 0.2);
    this.motor.set(motor, 0.12);
    this.motorAir.set(motorAir, 0.12);
    if (motorAir > 0) { const hp = this._hatchPos(true); this.motorAir.setPos(hp.x, hp.y, hp.z); }
  }
}
