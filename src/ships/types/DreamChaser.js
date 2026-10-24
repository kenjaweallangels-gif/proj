import * as THREE from 'three';
import { lathe, flange, boltCircle, boltRow, seam, rod, block, handrail, thruster, lamp, beacon, grappleFixture, whip, axial, scaleUV, patch, connector, cable, vent, V, X_AXIS, Y_AXIS, Z_AXIS, LocalColliders as C } from '../Kit.js';
import { cbmPassive } from '../Mechanisms.js';
import { accordionWings, wingFrame } from './Russian.js';

/**
 * «Стриж» — Dream Chaser-class cargo spaceplane with its expendable cargo module (large port):
 *   the cargo module berths with its passive ring (axial), carries two two-panel solar wings and a grapple
 *   fixture; behind it the lifting body (nose pointing away from the station): white upper tiles, black
 *   belly tiles and nose cap, dark "windshield" tile patch, body flap, RCS ports, and two wings with canted
 *   tip fins that fold up for launch and unfold after separation.
 */

const _m = new THREE.Matrix4();
const Z_AFT = -4.5;      // lifting-body aft bulkhead (meets the cargo module adapter)
// cross-sections from the aft bulkhead (d = distance toward the nose): width, top height, belly depth, centre y
const SECTIONS = [
  [0.0, 3.3, 1.12, 0.66, 0], [0.6, 3.4, 1.18, 0.68, 0], [1.5, 3.42, 1.2, 0.68, 0], [3.0, 3.3, 1.16, 0.66, -0.02], [4.2, 3.05, 1.1, 0.63, -0.04],
  [5.2, 2.75, 1.0, 0.6, -0.06], [6.2, 2.35, 0.88, 0.55, -0.09], [7.0, 1.95, 0.75, 0.5, -0.12], [7.7, 1.46, 0.6, 0.43, -0.15],
  [8.25, 0.98, 0.42, 0.33, -0.18], [8.65, 0.55, 0.25, 0.22, -0.21], [8.9, 0.24, 0.12, 0.11, -0.23], [9.02, 0.0, 0.0, 0.0, -0.24],
];
function section(d) {
  let i = 1; while (i < SECTIONS.length - 1 && SECTIONS[i][0] < d) i++;
  const a = SECTIONS[i - 1], b = SECTIONS[i], t = THREE.MathUtils.clamp((d - a[0]) / (b[0] - a[0]), 0, 1);
  const s = t * t * (3 - 2 * t) * 0.35 + t * 0.65;
  return [a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s, a[3] + (b[3] - a[3]) * s, a[4] + (b[4] - a[4]) * s];
}
/** Body surface point at (d, phi), lifted along the section by `lift`. */
function bodyPoint(d, phi, lift = 0, out = new THREE.Vector3()) {
  const [w, ht, hb, yc] = section(d);
  const c = Math.cos(phi), s = Math.sin(phi);
  const x = (w / 2 + lift) * Math.sign(c) * Math.pow(Math.abs(c), 2 / 2.6);
  const y = s >= 0 ? (ht + lift) * Math.pow(Math.abs(s), 2 / 2.4) : -(hb + lift) * Math.pow(Math.abs(s), 2 / 6);
  return out.set(x, yc + y, Z_AFT - d);
}
/** Lofted body patch d0..d1 x phi0..phi1 (outward normals). */
function loft(k, d0, d1, p0, p1, nd, np, lift = 0, uv = 1) {
  nd = k.seg(nd, 3); np = k.seg(np, 4);
  const pos = [], uvs = [], idx = [];
  const v = new THREE.Vector3();
  for (let i = 0; i <= nd; i++) for (let j = 0; j <= np; j++) {
    const d = d0 + (d1 - d0) * i / nd, ph = p0 + (p1 - p0) * j / np;
    bodyPoint(d, ph, lift, v); pos.push(v.x, v.y, v.z);
    uvs.push(ph * 1.6 * uv / 4 * 4, -d * uv / 4 * 4);
  }
  for (let i = 0; i < nd; i++) for (let j = 0; j < np; j++) {
    const a = i * (np + 1) + j, b2 = a + np + 1, c = a + 1, e = b2 + 1;
    // i runs toward the nose (-z), j counter-clockwise: (a, b, c) faces outward
    idx.push(a, b2, c, c, b2, e);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Wing planform for side sx: span x (outward), chord y (= ship z, negative toward the nose); `flipY` mirrors the chord. */
function wingShape(sx, flipY = 1) {
  const pts = [[0, -0.15], [2.05, -0.15], [2.05, -1.45], [0.9, -2.7], [0, -3.55]];
  return new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(sx * x, flipY * y)));
}

function dreamChaserAuthor(k) {
  const b = k.b, tpl = k.tpl;
  // ---- cargo module (berthing ring forward) ----
  cbmPassive(k, { depth: 0.62 });
  const RS = 1.5;
  lathe(k, b, 'hullCream', [[RS, -0.7], [RS - 0.02, -0.64], [1.49, -0.6]], { seg: 96 });
  lathe(k, b, 'hullCream', [[RS, -3.95], [RS, -0.7]], { seg: 96, uv: 1.2 });
  for (const z of [-0.72, -2.3, -3.93]) flange(k, b, z, RS, { h: 0.035, w: 0.07, bolts: k.near ? 64 : 0, surf: 'metalBare' });
  if (!k.far) for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2 + 0.1; rod(k, b, 'metalDark', V(Math.cos(a) * (RS + 0.003), Math.sin(a) * (RS + 0.003), -0.75), V(Math.cos(a) * (RS + 0.003), Math.sin(a) * (RS + 0.003), -3.9), 0.005, { seg: 4 }); }
  grappleFixture(k, b, V(0, RS + 0.005, -1.6), Y_AXIS);
  for (const z of [-1.1, -2.8]) handrail(k, b, V(-0.5, RS - 0.08, z), V(-0.5, RS - 0.08, z - 0.6), V(-0.32, 0.95, 0).normalize(), { surf: 'gold' });
  k.label('{name}', 1.5, 0.36, V(0, -RS - 0.008, -2.0), V(0, -1, 0), { right: V(1, 0, 0), color: '#283a5a' });
  for (const [a, z] of [[Math.PI * 0.3, -1.5], [Math.PI * 1.2, -3.1], [Math.PI * 1.75, -1.2]]) patch(k, b, V(Math.cos(a) * RS, Math.sin(a) * RS, z), V(Math.cos(a), Math.sin(a), 0), 0.5, 0.36, { surf: 'betaCloth', tint: 0xe2dfd4 });
  for (const a of [Math.PI * 0.85, Math.PI * 1.5]) connector(k, b, V(Math.cos(a) * RS, Math.sin(a) * RS, -3.75), V(Math.cos(a), Math.sin(a), 0), { plugs: 3 });
  vent(k, b, V(Math.cos(2.6) * RS, Math.sin(2.6) * RS, -0.95), V(Math.cos(2.6), Math.sin(2.6), 0), 0.03);
  { const a = Math.PI * 1.1, pts = []; for (let z = -0.8; z >= -3.9; z -= 0.35) pts.push(V(Math.cos(a) * (RS + 0.02), Math.sin(a) * (RS + 0.02), z)); cable(k, b, pts, 0.015); }
  // adapter cone to the spaceplane and its aft bulkhead
  lathe(k, b, 'mliDark', [[1.05, Z_AFT + 0.02], [1.15, Z_AFT + 0.12], [RS - 0.05, -4.05], [RS, -3.95]], { seg: 72 });
  flange(k, b, Z_AFT + 0.05, 1.05, { h: 0.06, w: 0.06, bolts: 32 });
  const zW = -2.3;
  const wings = [-1, 1].map((sx) => ({ frame: wingFrame(V(sx * (RS + 0.08), 0, zW), sx), n: 2, len: 1.6, width: 1.3, yoke: 0.45 }));
  for (const sx of [-1, 1]) if (!k.far) block(k, b, 'metalDark', V(sx * (RS + 0.02), 0, zW), 0.12, 0.3, 0.36, null, { bev: 0.015 });
  const ws = accordionWings(k, 'wing', wings, { thick: 0.04, cellUV: 2.6 });
  beacon(k, b, V(0, RS + 0.01, -3.3), Y_AXIS, 'strobe', 0.045);
  lamp(k, b, V(1.05, 1.05, -0.72), Z_AXIS, 0.12, 'dockLight');
  lamp(k, b, V(-1.05, 1.05, -0.72), Z_AXIS, 0.12, 'dockLight');

  // ---- lifting body ----
  const P = Math.PI;
  const top = loft(k, 0, 9.02, 0, P, 44, 40, 0);
  scaleUV(top, 2.5, 2.5); b.add('tilesWhite', top, true);
  const belly = loft(k, 0, 9.02, P, 2 * P, 44, 40, 0);
  scaleUV(belly, 2.5, 2.5); b.add('tilesHS', belly, true);
  if (!k.far) {
    const shield = loft(k, 7.0, 8.0, P * 0.3, P * 0.7, 6, 10, 0.008); scaleUV(shield, 2.5, 2.5); b.add('tilesHS', shield, false);
    const cap = loft(k, 8.55, 9.02, 0, P, 4, 24, 0.006); scaleUV(cap, 2.5, 2.5); b.add('tilesHS', cap, false);
    // chine seams and the aft bulkhead
    for (const ph of [0.02, P - 0.02]) { let prev = null; for (let d = 0.1; d < 8.8; d += k.near ? 0.4 : 1.2) { const p = bodyPoint(d, ph, 0.006); if (prev) rod(k, b, 'metalDark', prev, p, 0.012, { seg: 4 }); prev = p; } }
  }
  {
    const pts = []; for (let j = 0; j <= 48; j++) { const p = bodyPoint(0, (j / 48) * 2 * P); pts.push(new THREE.Vector2(p.x, p.y)); }
    const g = new THREE.ShapeGeometry(new THREE.Shape(pts), 1); g.rotateY(P); g.translate(0, 0, Z_AFT + 0.001);
    b.add('mliDark', g, false);
  }
  // body flap under the aft end, RCS ports
  block(k, b, 'tilesHS', V(0, -0.7, Z_AFT - 0.15), 2.0, 0.12, 0.8, null, { bev: 0.02, shadow: true });
  if (!k.far) block(k, b, 'metalDark', V(0, -0.66, Z_AFT - 0.56), 1.96, 0.1, 0.03, null, {});
  // nose-forward thrusters (braking along the docking axis), side and vertical RCS at nose and tail
  for (const [d, ph] of [[8.3, 0.25 * P], [8.3, 0.75 * P], [8.3, 1.3 * P], [8.3, 1.7 * P]]) {
    const p = bodyPoint(d, ph, -0.02);
    thruster(k, b, p, V(0, 0, -1), 0.035, { bell: 1.6, main: true });
  }
  for (const [d, ph, dir] of [[7.6, 0, X_AXIS], [7.6, P, V(-1, 0, 0)], [7.4, P / 2, Y_AXIS], [7.4, 1.5 * P, V(0, -1, 0)],
    [1.0, 0.02, X_AXIS], [1.0, P - 0.02, V(-1, 0, 0)], [0.8, P / 2, Y_AXIS], [0.8, 1.5 * P, V(0, -1, 0)], [1.6, P / 2, Y_AXIS], [1.6, 1.5 * P, V(0, -1, 0)]]) {
    const p = bodyPoint(d, ph, -0.01);
    if (!k.far) block(k, b, 'blackAnod', p, 0.12, 0.12, 0.12, new THREE.Quaternion().setFromUnitVectors(Z_AXIS, dir), { bev: 0.01 });
    thruster(k, b, p.clone().addScaledVector(dir, 0.02), dir, 0.028, { bell: 1.5 });
  }
  for (const sx of [-1, 1]) k.label('{name}-{num}', 1.6, 0.3, bodyPoint(3.6, sx > 0 ? 0.42 : P - 0.42, 0.01), V(sx, 0.9, 0).normalize(), { right: V(0, 0, sx), color: '#22335a' });
  beacon(k, b, bodyPoint(4.0, 0.05, 0.01), X_AXIS, 'navGreen');
  beacon(k, b, bodyPoint(4.0, P - 0.05, 0.01), V(-1, 0, 0), 'navRed');
  beacon(k, b, bodyPoint(2.0, P / 2, 0.005), Y_AXIS, 'strobe', 0.045);

  // ---- folding wings with canted tip fins ----
  const hinges = [];
  for (const sx of [-1, 1]) {
    const name = sx > 0 ? 'wingR' : 'wingL';
    const hp = V(sx * 1.5, -0.4, Z_AFT - 0.6);
    tpl.pivot(name, { position: hp, quaternion: new THREE.Quaternion().setFromAxisAngle(Z_AXIS, sx * 0.17) });
    const wb = k.on(name);
    // wing box (black tiles all round), planform mirrored in the shape itself (the shape helpers fix the winding)
    const g = new THREE.ExtrudeGeometry(wingShape(sx), { depth: 0.16, bevelEnabled: !k.far, bevelThickness: 0.03, bevelSize: 0.04, bevelSegments: k.near ? 2 : 1 });
    g.rotateX(Math.PI / 2); g.translate(0, 0.08, 0);     // shape y -> ship z, thickness along y
    scaleUV(g, 0.6, 0.6);
    wb.add('tilesHS', g, true);
    // white upper skin: ShapeGeometry faces +Z -> rotateX(-90) faces +Y; the chord is pre-mirrored (z = -y)
    const skin = new THREE.ShapeGeometry(wingShape(sx, -1), 2); skin.rotateX(-Math.PI / 2);
    skin.scale(0.97, 1, 0.97); skin.translate(0, 0.122, -0.04);
    scaleUV(skin, 0.6, 0.6);
    if (!k.far) wb.add('tilesWhite', skin, false);
    // elevon gap
    if (!k.far) block(k, wb, 'metalDark', V(sx * 1.05, 0.0, -0.32), 1.9, 0.17, 0.03, null, {});
    // tip fin (canted outward)
    const fin = new THREE.Shape(); fin.moveTo(-0.12, 0); fin.lineTo(-1.5, 0); fin.lineTo(-0.75, 1.55); fin.lineTo(-0.2, 1.55); fin.closePath();
    const fg = new THREE.ExtrudeGeometry(fin, { depth: 0.09, bevelEnabled: !k.far, bevelThickness: 0.02, bevelSize: 0.025, bevelSegments: 1 });
    fg.translate(0, 0, -0.045);
    const c = 0.5, eu = V(0, 0, 1), ev = V(sx * Math.sin(c), Math.cos(c), 0), ew = new THREE.Vector3().crossVectors(eu, ev);
    fg.applyMatrix4(new THREE.Matrix4().makeBasis(eu, ev, ew).setPosition(sx * 2.0, 0.06, 0));
    scaleUV(fg, 0.6, 0.6);
    wb.add('tilesWhite', fg, true);
    hinges.push({ pivot: name, axis: 'z', from: sx * 1.6, to: 0, channel: 'deploy', range: [0, 0.55] });
    k.collider(C.box(hp.clone().add(V(sx * 1.1, 0.15, -1.3)), V(1.1, 0.35, 1.3), null, 'wing'));
  }
  if (!k.far) for (const sx of [-1, 1]) block(k, b, 'metalDark', V(sx * 1.48, -0.4, Z_AFT - 2.2), 0.1, 0.12, 3.2, null, {});

  k.collider(C.capsule(V(0, 0, -0.7), V(0, 0, -3.95), RS + 0.05, 'cargoModule'));
  k.collider(C.capsule(V(0, 0.15, Z_AFT - 0.5), V(0, 0.0, Z_AFT - 6.0), 1.35, 'body'));
  k.collider(C.capsule(V(0, -0.05, Z_AFT - 6.0), V(0, -0.2, Z_AFT - 8.6), 0.8, 'nose'));
  for (const sx of [-1, 1]) k.collider(C.box(V(sx * (RS + 0.6 + 1.6), 0, zW), V(1.65, 0.1, 0.68), null, 'ssWing'));
  return { wings: ws, hinges };
}

export const DREAMCHASER = {
  type: 'dreamchaser', name: 'Стриж', label: 'Космоплан', size: 'large', length: 13.6, boundRadius: 7.6,
  mainAxis: Z_AXIS, upAxis: Y_AXIS, author: dreamChaserAuthor,
};
