import { surfaceAt } from './Zones.js';

/**
 * The astronaut's own movement and contact sounds: hand grabs on handrails (skin / glove), push-offs, braking,
 * bumps into racks and bags, velcro, clothing rustle while floating, footsteps by floor surface in the gravity
 * ring, jumps and landings, ladder rungs, hand-over-hand crawling on the hull during EVA.
 *
 * Sources: the `player.body.events` queue when the player module provides one ({type, strength}: grab,
 * release, push, brake, step, land, bump, jump, rung), otherwise the legacy `audio.play('grab' | 'release' |
 * 'impact' | 'step' | 'rung')` calls plus state polling (ring jumps / landings, crawl flag).
 *
 * Routing: unsuited, contacts travel through the cabin air (positional at the hand / feet, with the room
 * reverb). Suited, they arrive through the suit and the body ('body' path, dull and close) plus a muffled share
 * through the air. In EVA only the structure / suit path exists.
 */
const _h = { x: 0, y: 0, z: 0 }, _f = { x: 0, y: 0, z: 0 };
const BODY_KINDS = { grab: 'grab', release: 'release', push: 'push', pushoff: 'push', brake: 'brake', step: 'step', footstep: 'step', land: 'land', landing: 'land', jump: 'jump', bump: 'bump', impact: 'bump', collide: 'bump', rung: 'rung' };

export class Body {
  constructor(engine, ctx) {
    this.e = engine; this.ctx = ctx;
    this.eventsSeen = false;
    this._recent = new Array(32).fill(null); this._ri = 0;
    this.cloth = engine.loop('cloth_loop', 'air', { gain: 0, rate: 1 });
    this.suitCloth = engine.loop('cloth_loop', 'body', { gain: 0, rate: 0.62, lp: 1600 });
    this.vPrev = { x: 0, y: 0, z: 0 }; this.acc = 0;
    this.grounded = null; this.vUpPrev = 0;
    this.foot = 0; this.crawlTimer = 0; this.crawl = 0; this.hand = 0;
    this.tetherWas = null;
  }

  // ------------------------------------------------------------------ geometry helpers (camera space -> world)
  _hand(m) { const e = m.elements; _h.x = e[12] - e[8] * 0.45 - e[4] * 0.25; _h.y = e[13] - e[9] * 0.45 - e[5] * 0.25; _h.z = e[14] - e[10] * 0.45 - e[6] * 0.25; return _h; }
  _feet(m, up) { const e = m.elements; _f.x = e[12] - up[0] * 1.5; _f.y = e[13] - up[1] * 1.5; _f.z = e[14] - up[2] * 1.5; return _f; }

  /** A contact event: kind (see BODY_KINDS), strength 0..1. */
  contact(kind, s = 0.5, legacy = false) {
    if (legacy && this.eventsSeen && kind !== 'click') return;
    const ctx = this.ctx, st = ctx.player?.state;
    if (!st || ctx.mode === 'observer') return;
    const e = this.e, cam = ctx.camera.matrixWorld;
    const suited = !!st.suited, eva = st.mode === 'eva';
    s = Math.max(0.05, Math.min(1, s));
    switch (kind) {
      case 'grab': {
        // tether hook clipped on in the same frame -> carabiner instead of a hand grab
        if (st.tetherAttached && this.tetherWas === false) { e.shot('carabiner', { path: 'body', gain: 0.55 }); e.shot('carabiner', { path: 'air', gain: 0.3, pos: this._hand(cam) }); this.tetherWas = true; return; }
        if (suited) {
          e.shot('glove_rail', { path: 'body', gain: 0.55 + 0.3 * s });
          e.shot('cloth', { path: 'body', gain: 0.12, rate: 0.7, lp: 1400 });
          if (!eva) e.shot('hand_rail', { path: 'air', gain: 0.25 * s + 0.1, rate: 0.8, pos: this._hand(cam) });
        } else {
          e.shot('hand_rail', { path: 'air', gain: 0.32 + 0.35 * s, pos: this._hand(cam) });
          e.shot('cloth', { path: 'air', gain: 0.1 });
          if (Math.random() < 0.08) e.shot('velcro', { path: 'air', gain: 0.18, at: 0.1, pos: this._hand(cam) });
        }
        break;
      }
      case 'release': {
        if (suited) e.shot('glove_tap', { path: 'body', gain: 0.22 });
        else e.shot('hand_rail', { path: 'air', gain: 0.1, rate: 1.25, pos: this._hand(cam) });
        e.shot('cloth', { path: suited ? 'body' : 'air', gain: 0.08, rate: suited ? 0.7 : 1 });
        break;
      }
      case 'push': {
        if (suited) { e.shot('push_off', { path: 'body', gain: 0.45 + 0.3 * s, lp: 2200 }); if (!eva) e.shot('push_off', { path: 'air', gain: 0.2, pos: this._hand(cam) }); }
        else {
          e.shot('push_off', { path: 'air', gain: 0.35 + 0.35 * s, pos: this._hand(cam) });
          if (Math.random() < 0.15) e.shot('velcro', { path: 'air', gain: 0.15, at: 0.05, pos: this._hand(cam) });
        }
        break;
      }
      case 'brake': e.shot('brake_rub', { path: suited ? 'body' : 'air', gain: 0.2 + 0.3 * s, lp: suited ? 1800 : 0 }); break;
      case 'bump': {
        if (suited) {
          e.shot('suit_impact', { path: 'body', gain: 0.35 + 0.6 * s });
          if (!eva) e.shot(Math.random() < 0.5 ? 'bump_hard' : 'bump_soft', { path: 'air', gain: 0.4 * s + 0.1, pos: this._hand(cam) });
          else if (s > 0.25) e.shot('glove_rail', { path: 'body', gain: 0.3 * s, rate: 0.7 });
        } else e.shot(Math.random() < 0.45 ? 'bump_soft' : 'bump_hard', { path: 'air', gain: 0.3 + 0.6 * s, pos: this._hand(cam) });
        break;
      }
      case 'step': case 'land': case 'jump': {
        const iva = ctx.player.iva;
        const up = this._up(cam);
        const surf = surfaceAt(iva?.zone, iva?.pL?.x ?? 0);
        const feet = this._feet(cam, up);
        if (kind === 'jump') { e.shot('jump', { path: 'air', gain: 0.35, pos: feet }); break; }
        const g = kind === 'land' ? 0.5 + 0.5 * s : 0.22 + 0.32 * s;
        this.foot ^= 1;
        e.shot(`step_${surf}`, { path: 'air', gain: g, rate: this.foot ? 1.0 : 0.96, jitter: 0.04, pos: feet });
        e.shot(`step_${surf}`, { path: 'body', gain: g * 0.12, lp: 900 });     // a little bone-conducted
        if (kind === 'land') e.shot('land_body', { path: 'air', gain: 0.35 * s + 0.1, pos: feet });
        if (surf === 'carpet' && Math.random() < 0.3) e.shot('cloth', { path: 'air', gain: 0.05 });
        break;
      }
      case 'rung': {
        this.foot ^= 1;
        const up = this._up(cam);
        const pos = this.foot ? this._hand(cam) : this._feet(cam, up);
        e.shot(this.foot ? 'rung_hand' : 'rung_foot', { path: 'air', gain: 0.3 + 0.2 * s, pos });
        break;
      }
      default: break;
    }
  }

  _up(m) { const e = m.elements; this._u = this._u || [0, 1, 0]; this._u[0] = e[4]; this._u[1] = e[5]; this._u[2] = e[6]; return this._u; }

  /** Drain player.body.events (any shape: {type|kind|name, strength|s|impulse}). */
  _consume(evs) {
    if (!Array.isArray(evs) || !evs.length) return;
    for (let i = 0; i < evs.length; i++) {
      const ev = evs[i];
      if (!ev || typeof ev !== 'object') continue;
      let seen = false;
      for (let k = 0; k < this._recent.length; k++) if (this._recent[k] === ev) { seen = true; break; }
      if (seen) continue;
      this._recent[this._ri] = ev; this._ri = (this._ri + 1) % this._recent.length;
      const kind = BODY_KINDS[ev.type || ev.kind || ev.name];
      if (!kind) continue;
      this.eventsSeen = true;
      const s = +(ev.strength ?? ev.s ?? ev.impulse ?? 0.5);
      this.contact(kind, Number.isFinite(s) ? s : 0.5);
    }
  }

  update(dt, crawl) {
    const ctx = this.ctx, p = ctx.player, st = p?.state;
    if (!st) return;
    this._consume(p.body?.events);
    const active = ctx.mode !== 'observer' && dt > 0;
    // tether hook state (for carabiner detection in contact('grab'))
    if (this.tetherWas !== null && st.tetherAttached && !this.tetherWas && st.mode === 'eva') this.e.shot('carabiner', { path: 'body', gain: 0.5 });
    this.tetherWas = !!st.tetherAttached;
    // clothing: rustle with the body's acceleration (zero-g arm work) and walking
    const v = p.velocity;
    if (v && dt > 0) {
      const ax = (v.x - this.vPrev.x) / dt, ay = (v.y - this.vPrev.y) / dt, az = (v.z - this.vPrev.z) / dt;
      const a = Math.min(4, Math.sqrt(ax * ax + ay * ay + az * az));
      this.acc += (a - this.acc) * Math.min(1, dt * 6);
      this.vPrev.x = v.x; this.vPrev.y = v.y; this.vPrev.z = v.z;
    }
    const inRing = st.frame === 'ring' && st.mode !== 'eva';
    const moving = inRing ? Math.min(1, (st.speedRelative || 0) / 2.5) : 0;
    const rust = active ? Math.min(0.2, (inRing ? 0 : this.acc * 0.09) + moving * 0.07 + (st.holding ? 0.02 : 0)) : 0;
    this.cloth.set(st.suited ? 0 : rust, 0.12);
    this.suitCloth.set(st.suited ? rust * 0.9 + (crawl ? 0.06 : 0) : 0, 0.12);
    // ring: jump / landing from the grounded flag (only without a body event stream)
    const iva = p.iva;
    if (!this.eventsSeen && iva && inRing && !st.onLadder) {
      const g = !!iva.grounded;
      if (this.grounded !== null && g !== this.grounded) {
        if (!g && this.vUpPrev >= 0) { /* stepped off or jumped: jump sound only on a real jump */ if (iva.vL && this._vUp(iva) > 0.6) this.contact('jump', 0.5); }
        else if (g) { const s = Math.min(1, Math.abs(this.vUpPrev) / 2.2); if (s > 0.18) this.contact('land', s); }
      }
      this.grounded = g;
      this.vUpPrev = this._vUp(iva);
    } else this.grounded = null;
    // EVA crawl along a rail: alternate glove taps
    if (crawl && active) {
      this.crawlTimer -= dt;
      if (this.crawlTimer <= 0) { this.crawlTimer = 0.38 + Math.random() * 0.12; this.hand ^= 1; this.e.shot('glove_tap', { path: 'body', gain: 0.3, pan: this.hand ? 0.35 : -0.35 }); }
    } else this.crawlTimer = 0.05;
  }

  _vUp(iva) {
    // velocity along "up" (toward the ring axis) in ring-local coordinates
    const y = iva.pL.y, z = iva.pL.z, r = Math.hypot(y, z) || 1;
    return -(iva.vL.y * y + iva.vL.z * z) / r;
  }
}
