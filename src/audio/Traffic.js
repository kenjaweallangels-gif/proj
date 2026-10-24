/**
 * Docking traffic as heard on board. Space is silent: thrusters and engines of approaching ships make no sound.
 * What does reach the crew travels through the structure: the soft-capture contact (a deep boom and the hull
 * ringing), the hook drive motors, the capture latches, the separation springs at undocking, and the station's
 * own attitude jets firing while a ship is on final approach. Inside the station these are positional at the
 * port (through the cabin air); during EVA they are felt only while touching the station (holding a rail).
 * Radio traffic accompanies every event.
 */
const _p = { x: 0, y: 0, z: 0 };

export class Traffic {
  constructor(engine, ctx, radio) {
    this.e = engine; this.ctx = ctx; this.radio = radio;
    this.motor = engine.loop('motor_loop', 'air', { gain: 0, rate: 0.62, pos: true, ref: 6 });
    this.motorBody = engine.loop('motor_loop', 'body', { gain: 0, rate: 0.62, lp: 600 });
    this.motorUntil = 0;
    this.thumpTimer = 15;
    this.queue = [];
    this.off = ctx.events?.on?.('ship', (ev) => this._event(ev));
  }

  /** Station-borne playback: positional through the air when inside, through the suit when touching outside. */
  _struct(name, pos, gain, at = 0, ref = 8) {
    const st = this.ctx.player?.state, L = this.listen;
    if (!L) return;
    if (L.inside) this.e.shot(name, { path: 'air', gain, pos, ref, at, prio: 0.9 });
    else if (st && st.mode === 'eva' && (st.holding || st.contact)) this.e.shot(name, { path: 'body', gain: gain * 0.35, lp: 500, at, prio: 0.9 });
  }

  _portPos(port) {
    const p = port?.position;
    if (p) { _p.x = p.x; _p.y = p.y; _p.z = p.z; } else { _p.x = 0; _p.y = 0; _p.z = 0; }
    return _p;
  }

  _event(ev) {
    if (!ev || !this.e) return;
    const type = ev.type, pos = this._portPos(ev.port);
    const helmet = this.listen?.helmet || 0;
    switch (type) {
      case 'capture':
        this._struct('dock_contact', pos, 0.9);
        this._motor(pos, 2.8, 0.25);
        for (let k = 0; k < 4; k++) this._struct('dock_latch', pos, 0.5, 1.6 + k * 0.33 + Math.random() * 0.1);
        this.radio.say(null, { helmet, short: true, chime: false });
        this.listen && (this.listen.capture = true);
        break;
      case 'dock':
        for (let k = 0; k < 3; k++) this._struct('dock_latch', pos, 0.45, k * 0.45 + Math.random() * 0.1);
        this._motor(pos, 1.5, 0.0);
        break;
      case 'undock':
        this._motor(pos, 1.5, 0.0);
        for (let k = 0; k < 3; k++) this._struct('latch', pos, 0.35, 0.3 + k * 0.3);
        this._struct('spring_thunk', pos, 0.6, 3.0);
        this.radio.say(null, { helmet, short: true, chime: false });
        break;
      case 'final': case 'arrive': case 'depart':
        this.radio.say(null, { helmet, short: true, chime: false });
        break;
      default: break;
    }
  }

  _motor(pos, dur, delay) {
    const t = this.e.now();
    this.motorPos = { x: pos.x, y: pos.y, z: pos.z };
    this.motorFrom = t + delay; this.motorUntil = t + delay + dur;
  }

  /** L: { inside, helmet, density } from Audio.update. */
  update(dt, L) {
    this.listen = L;
    const now = this.e.now(), st = this.ctx.player?.state;
    const run = now >= (this.motorFrom || 0) && now < this.motorUntil;
    const touching = st && st.mode === 'eva' && (st.holding || st.contact);
    this.motor.set(run && L.inside ? 0.35 : 0, 0.1);
    this.motorBody.set(run && touching ? 0.12 : 0, 0.1);
    if (run && this.motorPos) this.motor.setPos(this.motorPos.x, this.motorPos.y, this.motorPos.z);
    // station attitude jets while a ship is on final approach nearby
    const ships = this.ctx.ships?.ships;
    let approaching = false;
    if (ships) for (let i = 0; i < ships.length; i++) { const s = ships[i]; if ((s.state === 'approach' || s.state === 'dock') && s.group && s.group.position.lengthSq() < 250 * 250) { approaching = true; break; } }
    this.thumpTimer -= dt;
    if (approaching && this.thumpTimer <= 0) {
      this.thumpTimer = 9 + Math.random() * 22;
      // aft end of the service module (attitude thrusters), with a few pulses
      _p.x = 34; _p.y = 0; _p.z = 0;
      const n = 1 + Math.floor(Math.random() * 3);
      for (let k = 0; k < n; k++) this._struct('thruster_thump', _p, 0.45 + Math.random() * 0.2, k * (0.35 + Math.random() * 0.3), 14);
    } else if (!approaching) this.thumpTimer = Math.max(this.thumpTimer, 6);
  }

  dispose() { this.off?.(); }
}
