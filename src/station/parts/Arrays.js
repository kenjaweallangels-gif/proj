import * as THREE from 'three';
import { LAYOUT } from './Layout.js';
import { Builder, Instancer, unitCylinder, boxAt, bevelBoxAt, tubeAt, tubeAB, torusAt, domeAt, latheAt, scaleUV, Colliders, X_AXIS, Y_AXIS, Z_AXIS } from './Builder.js';
import { COL, boltCircle, radialBolts, boltRow, connectorPanel } from './Detail.js';

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
    const D = bStatic.detail;      // close-range hardware (null on 'lite')
    const qX = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, X_AXIS);
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
      if (D) {
        // SARJ: trundle bearing assemblies straddling the race, drive-lock units, bolt rings on the drum
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2 + Math.PI / 12, n = V(0, Math.cos(a), Math.sin(a)), qa = new THREE.Quaternion().setFromAxisAngle(X_AXIS, a);
          for (const dx of [-0.48, 0.48]) bStatic.add('metalBare', bevelBoxAt(V(X0 + dx, 0, 0).addScaledVector(n, 3.32), 0.32, 0.5, 0.46, qa, 0.04), false);
          bStatic.add('hullWhiteAged', bevelBoxAt(V(X0, 0, 0).addScaledVector(n, 3.62), 1.3, 0.12, 0.5, qa, 0.03), false);
          const Mt = new THREE.Matrix4().compose(V(X0, 0, 0).addScaledVector(n, 3.68), qa, V(1, 1, 1));
          boltRow(D, Mt, -0.55, -0.18, 0.55, -0.18, 5, 0, 0.014, 0.01);
          boltRow(D, Mt, -0.55, 0.18, 0.55, 0.18, 5, 0, 0.014, 0.01);
        }
        for (const dx of [-1.25, -0.75, 0.75, 1.25]) radialBolts(D, new THREE.Matrix4().compose(V(X0 + dx, 0, 0), qX, V(1, 1, 1)), 3.0, 72, 0, 0.016, 0.012);
        D.anchor = null;
      }
      // rotating race + yoke hub
      b.add('metalBare', torusAt(V(0, 0, 0), X_AXIS, 3.25, 0.18, 8, 64), false);
      b.add('mliSilver', tubeAt(V(0, 0, 0), Z_AXIS, 1.2, 2 * (LAYOUT.arrayInner - 1.0), 24));
      const members = new Instancer(unitCylinder(6), m.get('truss'), { name: 'arrayMast', shadow: false });
      if (D) D.anchor = g;
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
          for (let k = 0; k <= 12; k++) b.add('metalDark', bevelBoxAt(V(cx, -0.03, z0 + sz * (k / 12) * L), half, 0.08, 0.05, null), false);
          for (const ex of [-1, 1]) b.add('metalDark', tubeAt(V(cx + ex * half / 2, -0.03, zc), Z_AXIS, 0.045, L, 6, { uv: false }), false);
          if (D) {
            // hinge knuckles along every panel fold line, tension springs at the blanket tip, edge grommets
            for (let k = 1; k < 12; k++) {
              const z = z0 + sz * (k / 12) * L;
              for (let i = 0; i < 9; i++) D.rod('mid', 'metal', COL.bare, V(cx - half / 2 + 0.25 + i * (half - 0.5) / 8 - 0.06, -0.03, z), V(cx - half / 2 + 0.25 + i * (half - 0.5) / 8 + 0.06, -0.03, z), 0.032, 'cyl6');
            }
            for (let i = 0; i < 6; i++) D.rod('mid', 'metal', COL.steel, V(cx - half / 2 + 0.4 + i * (half - 0.8) / 5, -0.05, z1 - sz * 0.05), V(cx - half / 2 + 0.4 + i * (half - 0.8) / 5, -0.05, z1 - sz * 0.6), 0.012, 'cyl6');
          }
          b.add('metalDark', bevelBoxAt(V(cx, -0.03, z1), half, 0.1, 0.12, null), false);
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
        b.add('metalDark', bevelBoxAt(V(0, -0.1, z0 - sz * 3.2), 2.2, 1.6, 1.4));
        b.add('hazard', boxAt(V(0, -0.1, z0 - sz * 3.2), 2.25, 0.3, 1.45, null, false), false);
        b.add('metalDark', bevelBoxAt(V(0, my, z1 + sz * 0.3), 1.2, 1.0, 0.6), false);
        if (D) {
          // batten corner fittings on the mast, gimbal box fins / connectors / bolts, canister rings
          for (let z = z0; sz * (z - z1) <= 0; z += sz * 1.5) for (const [dx, dy] of [[-mw, 0], [mw, 0], [0, -mw]]) D.part('mid', 'metal', COL.bare, 'bbox', new THREE.Matrix4(), dx, my + dy, z, 0.11, 0.11, 0.11);
          const gb = V(0, -0.1, z0 - sz * 3.2);
          for (let i = 0; i < 7; i++) D.part('mid', 'metal', COL.dark, 'box', new THREE.Matrix4(), -0.9 + i * 0.3, gb.y - 0.82, gb.z, 0.04, 0.06, 1.2);
          connectorPanel(D, new THREE.Matrix4().makeBasis(X_AXIS, Z_AXIS.clone().multiplyScalar(-sz), Y_AXIS.clone().multiplyScalar(sz)).setPosition(gb.x + 0.4, gb.y + 0.35, gb.z - sz * 0.71), 0.6, 0.35, 4, 2, sx + sz);
          for (const yy of [-0.65, 0.65]) boltRow(D, new THREE.Matrix4().makeBasis(X_AXIS, Z_AXIS.clone().multiplyScalar(-sz), Y_AXIS.clone().multiplyScalar(sz)).setPosition(gb.x, gb.y + yy, gb.z - sz * 0.71), -1.0, 0, 1.0, 0, 9, 0, 0.016, 0.012);
          for (const f of [0.15, 0.5, 0.85]) b.add('metalDark', latheAt(V(0, my, z0 - sz * (0.4 + f * 2.4)), Z_AXIS, [[0.75, -0.04], [0.79, -0.03], [0.79, 0.03], [0.75, 0.04]], 20), false);
        }
        wings.push({ center: V(0, 0, zc), col: Colliders.box(V(X0, 0, zc), V(W / 2, 0.45, L / 2), null, `solarWing${sx > 0 ? 'F' : 'A'}${sz > 0 ? 'P' : 'N'}`, true) });
        this.colliders.push(wings[wings.length - 1].col);
      }
      members.build(g);
      if (D) D.anchor = null;
      b.build(g, { name: 'solar' });
      this.ends.push({ group: g, X0, wings, angle: 0 });
    }
    // snap to the Sun at start
    const sun = ctx.orbit.local.sunDir;
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
    const sun = ctx.orbit.local.sunDir;
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
    const D = bStatic.detail;
    for (const x of LAYOUT.radiatorX) for (const sy of [-1, 1]) {
      const y0 = sy * (h + 0.9);                     // joint position (above the trays on top)
      const g = new THREE.Group(); g.position.set(x, y0, 0); g.name = 'radiator';
      station.add(g);
      const b = new Builder(m);
      // static mount + yaw drum
      bStatic.add('metalDark', bevelBoxAt(V(x, sy * (h + 0.35), 0), 1.6, 0.7, 1.0));
      bStatic.add('metalBare', tubeAt(V(x, sy * (h + 0.75), 0), Y_AXIS, 0.6, 0.4, 24, { uv: false }), false);
      // mast and scissor truss, then the panel (DoubleSide radiator material) framed in tubes
      const mastEnd = sy * 3.0;
      b.add('truss', tubeAt(V(0, mastEnd / 2, 0), Y_AXIS, 0.35, 3.0, 12));
      b.add('hazard', tubeAt(V(0, sy * 0.4, 0), Y_AXIS, 0.37, 0.5, 12, { uv: false }), false);
      const yc = mastEnd + sy * L / 2;
      // panel with real thickness (4 cm honeycomb sandwich) between the edge tubes
      const panel = new THREE.BoxGeometry(W, L, 0.04).translate(0, yc, 0);
      { const uv = panel.attributes.uv; for (let i = 0; i < uv.count; i++) { const f = Math.floor(i / 4); if (f >= 4) uv.setXY(i, uv.getX(i) * W / 7, uv.getY(i) * L / 7.5); else uv.setXY(i, uv.getX(i) * 0.01, uv.getY(i) * 0.01); } }
      b.add('radiator', panel);
      for (const ex of [-1, 1]) b.add('metalDark', tubeAt(V(ex * W / 2, yc, 0), Y_AXIS, 0.07, L, 6, { uv: false }), false);
      b.add('metalDark', tubeAt(V(0, mastEnd + sy * L, 0), X_AXIS, 0.07, W, 6, { uv: false }), false);
      b.add('metalDark', tubeAt(V(0, mastEnd, 0), X_AXIS, 0.1, W + 0.2, 8, { uv: false }), false);
      for (let k = 1; k < 8; k++) b.add('metalDark', bevelBoxAt(V(0, mastEnd + sy * (k / 8) * L, 0), W, 0.05, 0.06, null), false);
      b.add('copper', tubeAt(V(0, yc, 0.06), Y_AXIS, 0.04, L, 6, { uv: false }), false);
      b.add('copper', tubeAt(V(0, yc, -0.06), Y_AXIS, 0.04, L, 6, { uv: false }), false);
      if (D) {
        // (small and few: merged into the panel's own builder instead of the distance-culled set)
        // hinge knuckles on each fold line, flex hose loops from the mast manifold into the panel, panel clamps
        for (let k = 1; k < 8; k++) {
          const y = mastEnd + sy * (k / 8) * L;
          for (let i = 0; i < 6; i++) { const x0 = -W / 2 + 0.5 + i * (W - 1) / 5; b.add('metalBare', tubeAB(V(x0 - 0.08, y, 0.0), V(x0 + 0.08, y, 0.0), 0.045, 8), false); }
        }
        for (const ez of [-0.06, 0.06]) for (let k = 0; k < 8; k++) b.add('metalBare', bevelBoxAt(V(0, mastEnd + sy * (k + 0.5) * L / 8, ez), 0.14, 0.04, 0.1, null), false);
        for (const [ex, zz] of [[-0.6, 0.18], [0.6, -0.18]]) {
          const curve = new THREE.CatmullRomCurve3([V(ex * 0.4, sy * 2.2, zz), V(ex * 0.9, sy * 2.7, zz * 1.6), V(ex * 1.3, mastEnd + sy * 0.05, zz * 1.2), V(ex * 1.7, mastEnd + sy * 0.25, 0.0)]);
          b.add('metalBare', new THREE.TubeGeometry(curve, 16, 0.05, 6, false), false);
          for (let i = 1; i < 6; i++) { const pt = curve.getPoint(i / 6), tg = curve.getTangent(i / 6); b.add('metalDark', tubeAB(pt.clone().addScaledVector(tg, -0.02), pt.clone().addScaledVector(tg, 0.02), 0.062, 8), false); }
        }
        b.add('metalBare', latheAt(V(0, sy * 0.6, 0), Y_AXIS, [[0.35, -0.06], [0.52, -0.04], [0.52, 0.05], [0.37, 0.08]], 20), false);
        radialBolts(D, new THREE.Matrix4().setPosition(x, sy * (h + 0.75), 0), 0.6, 20, 0, 0.014, 0.01);
      }
      b.build(g, { name: 'radiator' });
      const col = Colliders.box(V(x, y0 + yc, 0), V(W / 2 + 0.1, L / 2, 0.2), null, 'radiator', true);
      this.colliders.push(col);
      this.panels.push({ group: g, angle: 0, col });
    }
    const sun = ctx.orbit.local.sunDir;
    const t = Math.atan2(-sun.z, sun.x);
    for (const p of this.panels) { p.angle = t; p.group.rotation.y = t; _q.setFromAxisAngle(Y_AXIS, t); p.col.quaternion.copy(_q); }
  }

  update(dt, ctx) {
    const sun = ctx.orbit.local.sunDir;
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
