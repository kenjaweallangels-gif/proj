import * as THREE from 'three';
import { LAYOUT } from './Layout.js';
import { Builder, Instancer, unitCylinder, boxAt, tubeAt, torusAt, domeAt, scaleUV, Colliders, X_AXIS, Y_AXIS, Z_AXIS } from './Builder.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const MAX_SLEW = 0.5 * Math.PI / 180;   // rad/s

/** Shortest signed angular difference a -> b (period p). */
function angDiff(a, b, p = Math.PI * 2) { let d = (b - a) % p; if (d > p / 2) d -= p; if (d < -p / 2) d += p; return d; }
function slew(current, target, dt, period = Math.PI * 2) { const d = angDiff(current, target, period); const step = Math.min(Math.abs(d), MAX_SLEW * dt); return current + Math.sign(d) * step; }

/**
 * Four solar wings (36 x 12 m) on two rotary joints at the spine ends. Each joint carries a +Z and a -Z wing
 * and rotates about X so the cell side faces the Sun (slew-limited 0.5 deg/s).
 */
export class SolarArrays {
  constructor(ctx, station, bStatic) {
    const m = ctx.materials;
    const h = LAYOUT.spineSize / 2;
    this.ends = [];
    this.colliders = [];
    for (const sx of [-1, 1]) {
      const X0 = sx * LAYOUT.arrayJointX;
      const g = new THREE.Group(); g.name = `solarJoint${sx > 0 ? 'Fwd' : 'Aft'}`; g.position.set(X0, 0, 0);
      station.add(g);
      const b = new Builder(m);
      // static joint drum (SARJ) on the spine
      bStatic.add('truss', tubeAt(V(X0, 0, 0), X_AXIS, 3.0, 3.6, 48));
      bStatic.add('mliGold', domeAt(V(X0 - 1.8, 0, 0), V(-1, 0, 0), 3.0, 0.9));
      bStatic.add('mliGold', domeAt(V(X0 + 1.8, 0, 0), X_AXIS, 3.0, 0.9));
      bStatic.add('hazard', torusAt(V(X0 - 1.85, 0, 0), X_AXIS, 3.02, 0.1, 6, 48), false);
      bStatic.add('hazard', torusAt(V(X0 + 1.85, 0, 0), X_AXIS, 3.02, 0.1, 6, 48), false);
      this.colliders.push(Colliders.capsule(V(X0 - 2.3, 0, 0), V(X0 + 2.3, 0, 0), 3.2, 'sarj'));
      // rotating race + yoke hub
      b.add('metalBare', torusAt(V(0, 0, 0), X_AXIS, 3.25, 0.18, 8, 64), false);
      b.add('mliSilver', tubeAt(V(0, 0, 0), Z_AXIS, 1.2, 2 * (LAYOUT.arrayInner - 1.0), 24));
      const members = new Instancer(unitCylinder(6), m.get('truss'), { name: 'arrayMast', shadow: false });
      const wings = [];
      for (const sz of [-1, 1]) {
        const z0 = sz * LAYOUT.arrayInner, z1 = sz * (LAYOUT.arrayInner + LAYOUT.arrayLen), zc = (z0 + z1) / 2;
        const W = LAYOUT.arrayWidth, L = LAYOUT.arrayLen, half = (W - 1.0) / 2;
        // two blanket halves per wing, cells on +Y, backing on -Y
        for (const hx of [-1, 1]) {
          const cx = hx * (half / 2 + 0.5);
          const front = new THREE.PlaneGeometry(half, L).rotateX(-Math.PI / 2).translate(cx, 0.0, zc);
          scaleUV(front, half / 3.2, L / 6.4);
          b.add('solarCell', front);
          const back = new THREE.PlaneGeometry(half, L).rotateX(Math.PI / 2).translate(cx, -0.06, zc);
          scaleUV(back, half / 6.5, L / 6.5);
          b.add('solarBack', back);
          // fold hinge lines + edge frame
          for (let k = 0; k <= 12; k++) b.add('metalDark', boxAt(V(cx, -0.03, z0 + sz * (k / 12) * L), half, 0.08, 0.05, null, false), false);
          for (const ex of [-1, 1]) b.add('metalDark', tubeAt(V(cx + ex * half / 2, -0.03, zc), Z_AXIS, 0.045, L, 6, { uv: false }), false);
          b.add('metalDark', boxAt(V(cx, -0.03, z1), half, 0.1, 0.12, null, false), false);
        }
        // deployment mast (lattice) down the middle, behind the blanket
        const my = -0.45, mw = 0.42;
        for (const [dx, dy] of [[-mw, 0], [mw, 0], [0, -mw]]) members.addSegment(V(dx, my + dy, z0), V(dx, my + dy, z1), 0.05);
        for (let z = z0; sz * (z - z1) <= 0; z += sz * 1.5) {
          members.addSegment(V(-mw, my, z), V(mw, my, z), 0.03);
          members.addSegment(V(-mw, my, z), V(0, my - mw, z), 0.03);
          members.addSegment(V(mw, my, z), V(0, my - mw, z), 0.03);
          members.addSegment(V(-mw, my, z), V(mw, my, z + sz * 1.5), 0.025);
        }
        // mast canister + beta-gimbal box at the root, tip box
        b.add('hullWhiteAged', tubeAt(V(0, my, z0 - sz * 1.6), Z_AXIS, 0.75, 2.4, 20));
        b.add('metalDark', boxAt(V(0, -0.1, z0 - sz * 3.2), 2.2, 1.6, 1.4));
        b.add('hazard', boxAt(V(0, -0.1, z0 - sz * 3.2), 2.25, 0.3, 1.45, null, false), false);
        b.add('metalDark', boxAt(V(0, my, z1 + sz * 0.3), 1.2, 1.0, 0.6), false);
        wings.push({ center: V(0, 0, zc), col: Colliders.box(V(X0, 0, zc), V(W / 2, 0.45, L / 2), null, `solarWing${sx > 0 ? 'F' : 'A'}${sz > 0 ? 'P' : 'N'}`, true) });
        this.colliders.push(wings[wings.length - 1].col);
      }
      members.build(g);
      b.build(g, { name: 'solar' });
      this.ends.push({ group: g, X0, wings, angle: 0 });
    }
    // snap to the Sun at start
    const sun = ctx.orbit.sunDir;
    const target = Math.atan2(sun.z, sun.y);
    for (const e of this.ends) { e.angle = target; e.group.rotation.x = target; }
    this._syncColliders();
  }

  _syncColliders() {
    for (const e of this.ends) {
      const c = Math.cos(e.angle), s = Math.sin(e.angle);
      _q.setFromAxisAngle(X_AXIS, e.angle);
      for (const w of e.wings) {
        w.col.center.set(e.X0, -w.center.z * s, w.center.z * c);
        w.col.quaternion.copy(_q);
      }
    }
  }

  update(dt, ctx) {
    const sun = ctx.orbit.sunDir;
    const target = Math.atan2(sun.z, sun.y);   // cell normal (0, cos a, sin a) -> toward the Sun
    for (const e of this.ends) { e.angle = slew(e.angle, target, dt); e.group.rotation.x = e.angle; }
    this._syncColliders();
  }
}

/**
 * Four deployable radiator panels (15 x 7 m) on yaw joints below/above the spine aft of the ring hub,
 * kept edge-on to the Sun.
 */
export class Radiators {
  constructor(ctx, station, bStatic) {
    const m = ctx.materials;
    const h = LAYOUT.spineSize / 2;
    const L = LAYOUT.radiatorLen, W = LAYOUT.radiatorWidth;
    this.panels = [];
    this.colliders = [];
    for (const x of LAYOUT.radiatorX) for (const sy of [-1, 1]) {
      const y0 = sy * (h + 0.9);                     // joint position (above the trays on top)
      const g = new THREE.Group(); g.position.set(x, y0, 0); g.name = 'radiator';
      station.add(g);
      const b = new Builder(m);
      // static mount + yaw drum
      bStatic.add('metalDark', boxAt(V(x, sy * (h + 0.35), 0), 1.6, 0.7, 1.0));
      bStatic.add('metalBare', tubeAt(V(x, sy * (h + 0.75), 0), Y_AXIS, 0.6, 0.4, 24, { uv: false }), false);
      // mast and scissor truss, then the panel (DoubleSide radiator material) framed in tubes
      const mastEnd = sy * 3.0;
      b.add('truss', tubeAt(V(0, mastEnd / 2, 0), Y_AXIS, 0.35, 3.0, 12));
      b.add('hazard', tubeAt(V(0, sy * 0.4, 0), Y_AXIS, 0.37, 0.5, 12, { uv: false }), false);
      const yc = mastEnd + sy * L / 2;
      const panel = new THREE.PlaneGeometry(W, L).translate(0, yc, 0);
      scaleUV(panel, W / 7, L / 7.5);
      b.add('radiator', panel);
      for (const ex of [-1, 1]) b.add('metalDark', tubeAt(V(ex * W / 2, yc, 0), Y_AXIS, 0.07, L, 6, { uv: false }), false);
      b.add('metalDark', tubeAt(V(0, mastEnd + sy * L, 0), X_AXIS, 0.07, W, 6, { uv: false }), false);
      b.add('metalDark', tubeAt(V(0, mastEnd, 0), X_AXIS, 0.1, W + 0.2, 8, { uv: false }), false);
      for (let k = 1; k < 8; k++) b.add('metalDark', boxAt(V(0, mastEnd + sy * (k / 8) * L, 0), W, 0.05, 0.06, null, false), false);
      b.add('copper', tubeAt(V(0, yc, 0.06), Y_AXIS, 0.04, L, 6, { uv: false }), false);
      b.add('copper', tubeAt(V(0, yc, -0.06), Y_AXIS, 0.04, L, 6, { uv: false }), false);
      b.build(g, { name: 'radiator' });
      const col = Colliders.box(V(x, y0 + yc, 0), V(W / 2 + 0.1, L / 2, 0.2), null, 'radiator', true);
      this.colliders.push(col);
      this.panels.push({ group: g, angle: 0, col });
    }
    const sun = ctx.orbit.sunDir;
    const t = Math.atan2(-sun.z, sun.x);
    for (const p of this.panels) { p.angle = t; p.group.rotation.y = t; _q.setFromAxisAngle(Y_AXIS, t); p.col.quaternion.copy(_q); }
  }

  update(dt, ctx) {
    const sun = ctx.orbit.sunDir;
    // panel normal (sin a, 0, cos a) must be perpendicular to the Sun: sin a*sx + cos a*sz = 0
    const target = Math.atan2(-sun.z, sun.x);
    for (const p of this.panels) {
      p.angle = slew(p.angle, target, dt, Math.PI);   // 180-degree symmetric
      p.group.rotation.y = p.angle;
      _q.setFromAxisAngle(Y_AXIS, p.angle);
      p.col.quaternion.copy(_q);
    }
  }
}
