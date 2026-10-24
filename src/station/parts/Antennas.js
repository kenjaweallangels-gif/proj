import * as THREE from 'three';
import { LAYOUT } from './Layout.js';
import { Builder, Instancer, unitCylinder, boxAt, bevelBoxAt, tubeAt, tubeAB, torusAt, latheAt, flipInside, quatY, Colliders, X_AXIS, Y_AXIS, Z_AXIS } from './Builder.js';
import { COL, boltCircle, radialBolts } from './Detail.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const DISH_SLEW = 2.0 * Math.PI / 180;    // rad/s

function angDiff(a, b) { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; }
function slewTo(cur, target, dt) { const d = angDiff(cur, target); return cur + Math.sign(d) * Math.min(Math.abs(d), DISH_SLEW * dt); }

/**
 * Steerable high-gain dish on a 2-axis gimbal (yaw about the mast axis, pitch on a yoke).
 * mastGroup local +Y = mast axis; the dish aperture points along local +Z at zero angles.
 */
class Dish {
  constructor(materials, parent, position, mastAxis, radius = 1.6, D = null) {
    this.mast = new THREE.Group(); this.mast.position.copy(position); this.mast.quaternion.copy(quatY(mastAxis));
    this.yaw = new THREE.Group(); this.pitch = new THREE.Group(); this.pitch.position.set(0, 0.95, 0);
    this.mast.add(this.yaw); this.yaw.add(this.pitch); parent.add(this.mast);
    this.invMast = this.mast.quaternion.clone().invert();
    this.yawAngle = 0; this.pitchAngle = 0;
    this.minPitch = -1.7; this.maxPitch = 0.2;
    const by = new Builder(materials), bp = new Builder(materials);
    // yaw drum + yoke
    by.add('metalDark', tubeAt(V(0, 0.15, 0), Y_AXIS, 0.42, 0.3, 20, { uv: false }), false);
    by.add('hullWhiteAged', tubeAt(V(0, 0.5, 0), Y_AXIS, 0.3, 0.5, 16, { uv: false }), false);
    for (const sx of [-1, 1]) by.add('antennaWhite', bevelBoxAt(V(sx * 0.5, 0.75, 0), 0.14, 0.7, 0.22, null), false);
    if (D) {
      // gimbal: motor housings on the yoke arms, cable wrap, bolt rings
      for (const sx of [-1, 1]) by.add('metalDark', tubeAt(V(sx * 0.62, 0.95, 0), X_AXIS, 0.13, 0.16, 14, { uv: false }), false);
      by.add('cable', torusAt(V(0, 0.42, 0), Y_AXIS, 0.33, 0.035, 5, 20), false);
    }
    by.build(this.yaw, { name: 'dishYoke' });
    // dish: parabola lathe (both sides), ribs, back hub, feed on struts
    const f = radius * 0.6, pts = [];
    for (let i = 0; i <= 12; i++) { const r = (i / 12) * radius; pts.push(new THREE.Vector2(r, (r * r) / (4 * f))); }
    const lathe = new THREE.LatheGeometry(pts, 40).rotateX(Math.PI / 2);
    bp.add('antennaWhite', lathe, false);
    bp.add('antennaWhite', flipInside(new THREE.LatheGeometry(pts, 40).rotateX(Math.PI / 2)), false);
    bp.add('metalDark', torusAt(V(0, 0, radius * radius / (4 * f)), Z_AXIS, radius, 0.03, 5, 40), false);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const rib = new THREE.BoxGeometry(0.05, radius * 0.9, 0.08).translate(0, radius * 0.5, -0.06).rotateX(0.35).rotateZ(a);
      bp.add('metalDark', rib, false);
    }
    bp.add('metalDark', tubeAt(V(0, 0, -0.2), Z_AXIS, 0.3, 0.4, 16, { uv: false }), false);
    bp.add('metalDark', tubeAt(V(0, 0, 0), X_AXIS, 0.09, 1.1, 8, { uv: false }), false);   // trunnion
    bp.add('mliGold', tubeAt(V(0, 0, f), Z_AXIS, 0.07, 0.28, 10, { rTop: 0.14, uv: false }), false);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + Math.PI / 2;
      const p0 = V(Math.cos(a) * radius * 0.8, Math.sin(a) * radius * 0.8, (radius * 0.8) ** 2 / (4 * f)), p1 = V(0, 0, f - 0.05);
      bp.add('metalBare', tubeAt(p0.clone().lerp(p1, 0.5), p1.clone().sub(p0).normalize(), 0.02, p0.distanceTo(p1), 5, { uv: false }), false);
    }
    if (D) {
      // back structure: 24 parabolic ribs, two hoop rings, feed horn with flange, strut end fittings, rim bolts
      const zOf = (rr) => (rr * rr) / (4 * f);
      // (merged into the dish's own builder: few parts, and the dish moves)
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        for (let i = 0; i < 4; i++) {
          const r0 = 0.3 + (i / 4) * (radius - 0.33), r1 = 0.3 + ((i + 1) / 4) * (radius - 0.33);
          bp.add('antennaWhite', tubeAB(V(r0 * ca, r0 * sa, zOf(r0) - 0.05), V(r1 * ca, r1 * sa, zOf(r1) - 0.05), 0.016, 5), false);
        }
      }
      for (const fr of [0.5, 0.82]) bp.add('antennaWhite', torusAt(V(0, 0, zOf(radius * fr) - 0.06), Z_AXIS, radius * fr, 0.018, 4, 36), false);
      bp.add('metalBare', latheAt(V(0, 0, f - 0.1), Z_AXIS, [[0.06, -0.05], [0.13, -0.04], [0.13, 0.0], [0.07, 0.02]], 16), false);
      bp.add('metalDark', tubeAt(V(0, 0, f - 0.2), Z_AXIS, 0.06, 0.2, 12, { uv: false }), false);
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + Math.PI / 2;
        const p0 = V(Math.cos(a) * radius * 0.8, Math.sin(a) * radius * 0.8, (radius * 0.8) ** 2 / (4 * f));
        bp.add('metalDark', bevelBoxAt(V(p0.x, p0.y, p0.z + 0.02), 0.08, 0.08, 0.06, null, 0.01), false);
      }
    }
    bp.build(this.pitch, { name: 'dish' });
    this.radius = radius;
  }

  /** Point toward a world direction (unit), slew-limited. */
  track(worldDir, dt) {
    const d = _v.copy(worldDir).applyQuaternion(this.invMast).normalize();
    const yaw = Math.atan2(d.x, d.z);
    const pitch = THREE.MathUtils.clamp(-Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)), this.minPitch, this.maxPitch);
    this.yawAngle = slewTo(this.yawAngle, yaw, dt);
    this.pitchAngle = slewTo(this.pitchAngle, pitch, dt);
    this.yaw.rotation.y = this.yawAngle;
    this.pitch.rotation.x = this.pitchAngle;
  }
  snap(worldDir) { this.track(worldDir, 1e6); }
}

/** Dishes (Earth / Moon tracking), radar mast with a rotating bar, whip and patch antennas, star trackers. */
export class Antennas {
  constructor(ctx, station, b) {
    const m = ctx.materials;
    const h = LAYOUT.spineSize / 2;
    this.colliders = [];
    this.t = 0;
    // Earth-pointing dish on a side boom (-Z) at x=54, mast pointing nadir
    const ex = 54;
    b.add('metalDark', tubeAt(V(ex, 0, -(h + 2.6)), Z_AXIS, 0.2, 5.2, 10, { uv: false }));
    { const p0 = V(ex, -h, -h), p1 = V(ex, 0, -(h + 2.6)); b.add('metalDark', tubeAt(p0.clone().lerp(p1, 0.5), p1.clone().sub(p0).normalize(), 0.08, p0.distanceTo(p1), 6, { uv: false }), false); }
    b.add('hullWhiteAged', bevelBoxAt(V(ex, 0, -(h + 5.0)), 1.2, 1.2, 1.0));
    this.colliders.push(Colliders.capsule(V(ex, 0, -h), V(ex, 0, -(h + 5.4)), 0.7, 'dishBoom'));
    const D = b.detail;
    this.earthDish = new Dish(m, station, V(ex, -0.6, -(h + 5.0)), V(0, -1, 0), 1.7, D);
    this.colliders.push(Colliders.sphere(V(ex, -2.6, -(h + 5.0)), 2.2, 'earthDish'));
    // Moon / deep-space dish on a zenith mast at x=62
    const mx = 62;
    b.add('truss', tubeAt(V(mx, h + 2.6, 0), Y_AXIS, 0.28, 3.8, 12));
    b.add('hazard', tubeAt(V(mx, h + 1.1, 0), Y_AXIS, 0.3, 0.5, 12, { uv: false }), false);
    this.moonDish = new Dish(m, station, V(mx, h + 4.5, 0), Y_AXIS, 1.45, D);
    if (D) {
      // mast flanges, boom fittings
      for (const y of [h + 0.75, h + 4.45]) { b.add('metalBare', latheAt(V(mx, y, 0), Y_AXIS, [[0.28, -0.05], [0.42, -0.04], [0.42, 0.04], [0.3, 0.06]], 20), false); boltCircle(D, new THREE.Matrix4().makeTranslation(mx, y + 0.04, 0), 0.36, 10, 0, 0.012, 0.009); }
      b.add('metalBare', latheAt(V(ex, 0, -h - 0.1), V(0, 0, -1), [[0.2, -0.05], [0.36, -0.04], [0.36, 0.05], [0.22, 0.07]], 20), false);
    }
    this.moonDish.maxPitch = 0.17;      // never below the station horizon
    this.colliders.push(Colliders.capsule(V(mx, h, 0), V(mx, h + 4.5, 0), 0.45, 'dishMast'));
    this.colliders.push(Colliders.sphere(V(mx, h + 6.2, 0), 2.0, 'moonDish'));
    // radar / lidar lattice mast at x=50 (zenith) with a rotating bar
    const rx = 50, mh = 7.0, mw = 0.45, y0 = h + 0.75;
    const members = new Instancer(unitCylinder(6), m.get('truss'), { name: 'radarMast', shadow: false });
    const corners = [[mw, mw], [mw, -mw], [-mw, -mw], [-mw, mw]];
    for (const [dx, dz] of corners) members.addSegment(V(rx + dx, y0, dz), V(rx + dx, y0 + mh, dz), 0.045);
    for (let k = 0; k <= 7; k++) {
      const y = y0 + k;
      for (let c = 0; c < 4; c++) {
        const [x0, z0] = corners[c], [x1, z1] = corners[(c + 1) % 4];
        members.addSegment(V(rx + x0, y, z0), V(rx + x1, y, z1), 0.03);
        if (k < 7) members.addSegment(V(rx + x0, y, z0), V(rx + x1, y + 1, z1), 0.025);
      }
    }
    members.build(station);
    b.add('metalDark', bevelBoxAt(V(rx, y0 + 0.1, 0), 1.3, 0.2, 1.3), false);
    this.radar = new THREE.Group(); this.radar.position.set(rx, y0 + mh + 0.3, 0); station.add(this.radar);
    const br = new Builder(m);
    br.add('metalDark', tubeAt(V(0, 0, 0), Y_AXIS, 0.25, 0.5, 16, { uv: false }), false);
    br.add('metalDark', bevelBoxAt(V(0, 0.45, 0), 2.8, 0.22, 0.16, null), false);
    br.add('antennaWhite', bevelBoxAt(V(0, 0.62, 0), 2.6, 0.12, 0.5, null), false);
    br.add('mliBlack', bevelBoxAt(V(0.9, 0.9, 0), 0.5, 0.4, 0.5, null), false);
    br.build(this.radar, { name: 'radarBar' });
    b.add('mliBlack', new THREE.SphereGeometry(0.32, 16, 12).translate(rx + 0.9, y0 + mh - 0.6, 0.0), false);  // lidar dome
    b.add('metalDark', bevelBoxAt(V(rx + 0.7, y0 + mh - 0.6, 0), 0.5, 0.12, 0.5, null), false);
    this.colliders.push(Colliders.capsule(V(rx, y0, 0), V(rx, y0 + mh + 1.2, 0), 1.6, 'radarMast'));
    // whip antennas and patch antennas along the truss top near the cluster
    for (const [x, z] of [[-34, 1.9], [-34, -1.9], [44, 1.9], [44, -1.9]]) {
      b.add('antennaWhite', tubeAt(V(x, h + 2.0, z), Y_AXIS, 0.022, 2.6, 6, { uv: false }), false);
      b.add('metalDark', tubeAt(V(x, h + 0.85, z), Y_AXIS, 0.07, 0.25, 8, { uv: false }), false);
    }
    // UHF crossed dipole and a star tracker pair on the hub top
    const ux = LAYOUT.hubX + 2.3, uy = LAYOUT.clusterY + 3.5;
    b.add('metalDark', tubeAt(V(ux, uy + 0.6, 1.8), Y_AXIS, 0.03, 1.2, 6, { uv: false }), false);
    b.add('antennaWhite', bevelBoxAt(V(ux, uy + 1.2, 1.8), 1.2, 0.03, 0.03, null), false);
    b.add('antennaWhite', bevelBoxAt(V(ux, uy + 1.2, 1.8), 0.03, 0.03, 1.2, null), false);
    for (const dz of [-1.0, -1.5]) b.add('mliBlack', tubeAt(V(ux - 1.0, uy + 0.4, dz), V(0.3, 1, dz * 0.3).normalize(), 0.12, 0.5, 10, { rTop: 0.16, uv: false }), false);

    // initial pointing
    this.earthDish.snap(this._earthTarget(0));
    this.moonDish.snap(ctx.orbit.local.moonDir);
  }

  /** Ground-station tracking: nadir with a slow fore/aft sweep and slight lateral motion. */
  _earthTarget(t) {
    const a = 0.85 * Math.sin((2 * Math.PI * t) / 540), lat = 0.25 * Math.sin((2 * Math.PI * t) / 777);
    return _v.set(Math.sin(a), -Math.cos(a), lat).normalize();
  }

  update(dt, ctx) {
    this.t += dt;
    this.earthDish.track(this._earthTarget(ctx.time.sim), dt);
    this.moonDish.track(ctx.orbit.local.moonDir, dt);
    this.radar.rotation.y += 0.8 * dt;
  }
}
