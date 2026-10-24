import * as THREE from 'three';
import { bevelBoxAt, tubeAt, torusAt, Y_AXIS, X_AXIS } from './Builder.js';
import { COL, boltCircle, boltRow, standoffFoot } from './Detail.js';

/**
 * Larger external assemblies shared by several parts: pan/tilt camera + light units, grapple fixtures.
 * Bodies go into the Builder (merged, shadow casting, always drawn); their fasteners, cables and small
 * fittings into the DetailSet when one is present (GPU presets).
 */

const _v = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();

/** Basis matrix with local Y = n (unit) and local Z as close as possible to `zHint`, origin p. */
export function frameYZ(p, n, zHint, out = new THREE.Matrix4()) {
  _y.copy(n).normalize();
  _z.copy(zHint).addScaledVector(_y, -zHint.dot(_y));
  if (_z.lengthSq() < 1e-6) _z.set(1, 0, 0).addScaledVector(_y, -_y.x);
  if (_z.lengthSq() < 1e-6) _z.set(0, 0, 1);
  _z.normalize();
  _x.crossVectors(_y, _z);
  return out.makeBasis(_x, _y, _z).setPosition(p);
}

/**
 * Pan/tilt camera with a light on a short stanchion. base: point on the surface, n: mount normal, look: view
 * direction. `light` adds a work light (dockLight material: brightens in eclipse).
 */
export function cameraAssembly(b, D, base, n, look, { stand = 0.42, light = true } = {}) {
  const N = _v.copy(n).normalize().clone();
  const L = look.clone().normalize();
  const M = frameYZ(base, N, L);
  const q = new THREE.Quaternion().setFromRotationMatrix(M);
  // base plate, stanchion, pan unit
  b.add('metalBare', bevelBoxAt(base.clone().addScaledVector(N, 0.015), 0.24, 0.03, 0.24, q, 0.008), false);
  b.add('hullWhiteAged', tubeAt(base.clone().addScaledVector(N, stand / 2), N, 0.045, stand, 10, { uv: false }), false);
  const top = base.clone().addScaledVector(N, stand);
  b.add('antennaWhite', tubeAt(top.clone().addScaledVector(N, 0.05), N, 0.1, 0.1, 14, { uv: false }), false);
  b.add('metalDark', tubeAt(top.clone().addScaledVector(N, 0.105), N, 0.085, 0.012, 14, { uv: false }), false);
  // tilt yoke: two arms either side of the body
  const side = new THREE.Vector3().crossVectors(N, L); if (side.lengthSq() < 1e-6) side.set(1, 0, 0); side.normalize();
  const pivot = top.clone().addScaledVector(N, 0.22);
  for (const s of [-1, 1]) b.add('antennaWhite', bevelBoxAt(pivot.clone().addScaledVector(side, s * 0.135).addScaledVector(N, -0.05), 0.025, 0.2, 0.09, q, 0.006), false);
  // camera body (look = local +Z), lens barrel, sun shade
  const C = frameYZ(pivot, N.clone().addScaledVector(L, -L.dot(N)).lengthSq() > 1e-4 ? N.clone().addScaledVector(L, -L.dot(N)).normalize() : side.clone().cross(L), L);
  const qc = new THREE.Quaternion().setFromRotationMatrix(C);
  b.add('antennaWhite', bevelBoxAt(pivot, 0.22, 0.17, 0.3, qc, 0.02), false);
  b.add('rubberBlack', tubeAt(pivot.clone().addScaledVector(L, 0.19), L, 0.055, 0.1, 14, { uv: false }), false);
  b.add('rubberBlack', tubeAt(pivot.clone().addScaledVector(L, 0.27), L, 0.065, 0.08, 14, { rTop: 0.085, uv: false, open: true }), false);
  b.add('glass', tubeAt(pivot.clone().addScaledVector(L, 0.235), L, 0.045, 0.004, 14, { uv: false }), false);
  // light head on top of the camera
  const up = new THREE.Vector3().setFromMatrixColumn(C, 1);
  if (light) {
    const lc = pivot.clone().addScaledVector(up, 0.13).addScaledVector(L, 0.03);
    b.add('paintGray', bevelBoxAt(lc, 0.2, 0.08, 0.2, qc, 0.012), false);
    b.add('dockLight', bevelBoxAt(lc.clone().addScaledVector(L, 0.1), 0.16, 0.05, 0.012, qc, 0.003), false);
  }
  if (!D) return;
  // fasteners, hinge pins, cooling fins, cable loop to the stanchion, connector
  for (const [x, z] of [[-0.09, -0.09], [0.09, -0.09], [-0.09, 0.09], [0.09, 0.09]]) { _m.makeTranslation(x, 0.03, z); D.bolt(_m2.copy(M).multiply(_m), 0.011, 0.008); }
  for (const s of [-1, 1]) D.rod('fine', 'metal', COL.bare, pivot.clone().addScaledVector(side, s * 0.11), pivot.clone().addScaledVector(side, s * 0.16), 0.02, 'cyl8');
  for (let k = 0; k < 5; k++) D.partQ('fine', 'metal', COL.darkGray, 'box', C, 0, -0.095, -0.1 + k * 0.035, _q.identity(), 0.18, 0.02, 0.006);
  const cA = base.clone().addScaledVector(N, 0.1).addScaledVector(side, 0.06), cB = pivot.clone().addScaledVector(L, -0.16).addScaledVector(side, 0.04);
  const mid = cA.clone().lerp(cB, 0.5).addScaledVector(L, -0.12);
  D.rod('mid', 'paint', COL.black, cA, mid, 0.012, 'cyl6');
  D.rod('mid', 'paint', COL.black, mid, cB, 0.012, 'cyl6');
  D.partQ('fine', 'metal', COL.bare, 'cyl8', C, 0.06, 0.0, -0.16, _q.setFromAxisAngle(X_AXIS, Math.PI / 2), 0.025, 0.03, 0.025);
  for (const s of [-1, 1]) for (const t of [-1, 1]) { _m.makeTranslation(s * 0.09, 0.087, t * 0.13); D.bolt(_m2.copy(C).multiply(_m), 0.007, 0.005); }
}

/**
 * Grapple fixture (FRGF / PDGF style) on a surface frame M (local Y out of the surface, size ~0.8 m):
 * bolted base plate with a hazard border, grapple shaft with knob, three alignment cams, a target post with
 * a black disc and white cross.
 */
export function grappleFixture(b, D, M, { size = 0.8 } = {}) {
  const p = new THREE.Vector3().setFromMatrixPosition(M);
  const q = new THREE.Quaternion().setFromRotationMatrix(M);
  const n = new THREE.Vector3(0, 1, 0).applyQuaternion(q), ax = new THREE.Vector3(1, 0, 0).applyQuaternion(q), az = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  const s = size;
  b.add('hazard', bevelBoxAt(p.clone().addScaledVector(n, 0.012), s * 1.18, 0.024, s * 1.18, q, 0.008), false);
  b.add('metalBare', bevelBoxAt(p.clone().addScaledVector(n, 0.045), s, 0.05, s, q, 0.012), false);
  b.add('metalBare', tubeAt(p.clone().addScaledVector(n, 0.07 + 0.2), n, 0.055, 0.4, 12, { uv: false }), false);
  b.add('metalBare', tubeAt(p.clone().addScaledVector(n, 0.5), n, 0.085, 0.07, 12, { uv: false }), false);
  b.add('metalDark', torusAt(p.clone().addScaledVector(n, 0.46), n, 0.08, 0.02, 5, 14), false);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    const d = ax.clone().multiplyScalar(Math.cos(a)).addScaledVector(az, Math.sin(a));
    const qq = new THREE.Quaternion().setFromAxisAngle(n, -a).multiply(q);
    b.add('metalBare', bevelBoxAt(p.clone().addScaledVector(n, 0.14).addScaledVector(d, 0.2), 0.16, 0.18, 0.08, qq, 0.02), false);
  }
  // target: offset post, black disc, white cross
  const tc = p.clone().addScaledVector(ax, -s * 0.36).addScaledVector(az, s * 0.36);
  b.add('metalDark', tubeAt(tc.clone().addScaledVector(n, 0.18), n, 0.018, 0.32, 6, { uv: false }), false);
  b.add('rubberBlack', tubeAt(tc.clone().addScaledVector(n, 0.34), n, 0.1, 0.012, 16, { uv: false }), false);
  b.add('antennaWhite', bevelBoxAt(tc.clone().addScaledVector(n, 0.348), 0.16, 0.006, 0.022, q, 0.002), false);
  b.add('antennaWhite', bevelBoxAt(tc.clone().addScaledVector(n, 0.348), 0.022, 0.006, 0.16, q, 0.002), false);
  if (!D) return;
  // fasteners around the plate, connector pins, shaft collar bolts
  const h = s / 2 - 0.04;
  boltRow(D, M, -h, -h, h, -h, 6, 0.07, 0.013, 0.01);
  boltRow(D, M, -h, h, h, h, 6, 0.07, 0.013, 0.01);
  boltRow(D, M, -h, -h + 0.13, -h, h - 0.13, 4, 0.07, 0.013, 0.01);
  boltRow(D, M, h, -h + 0.13, h, h - 0.13, 4, 0.07, 0.013, 0.01);
  _m.makeTranslation(0, 0.07, 0); boltCircle(D, _m2.copy(M).multiply(_m), 0.1, 6, 0, 0.01, 0.008);
  for (const [x, z] of [[s * 0.28, -s * 0.3], [s * 0.34, -s * 0.22]]) D.part('mid', 'metal', COL.gold, 'cyl8', M, x, 0.1, z, 0.02, 0.06, 0.02);
}

/** Rows of standoff feet (handrail / equipment attach points) — re-exported for parts that only need feet. */
export { standoffFoot };

/**
 * EVA flood light on a flat surface (mount normal +Z through p; `sx` tilts it a little toward the centre line):
 * bolted base plate, yoke, finned housing, recessed lens behind a four-sided hood. Reusable kit part (station,
 * airlocks, vehicles): every piece is a closed, chamfered solid.
 */
export function evaLamp(b, D, p, sx = 1, { n = new THREE.Vector3(0, 0, 1), up = new THREE.Vector3(0, 1, 0) } = {}) {
  const N = n.clone().normalize();
  const side = new THREE.Vector3().crossVectors(up, N).normalize();
  const look = N.clone().addScaledVector(side, -0.25 * sx).addScaledVector(up, -0.15).normalize();
  const Mb = frameYZ(p, N, up);
  const qb = new THREE.Quaternion().setFromRotationMatrix(Mb);
  b.add('metalDark', bevelBoxAt(p.clone().addScaledVector(N, 0.015), 0.22, 0.03, 0.2, qb, 0.008), false);
  for (const s of [-1, 1]) b.add('metalDark', bevelBoxAt(p.clone().addScaledVector(N, 0.1).addScaledVector(side, s * 0.13), 0.03, 0.15, 0.08, qb, 0.008), false);
  const c = p.clone().addScaledVector(N, 0.17);
  const Mh = frameYZ(c, up.clone().addScaledVector(look, -look.dot(up)).normalize(), look);
  const qh = new THREE.Quaternion().setFromRotationMatrix(Mh);
  const U = new THREE.Vector3().setFromMatrixColumn(Mh, 1), Lk = new THREE.Vector3().setFromMatrixColumn(Mh, 2), S = new THREE.Vector3().setFromMatrixColumn(Mh, 0);
  b.add('paintGray', bevelBoxAt(c, 0.22, 0.16, 0.18, qh, 0.02), false);
  for (let k = 0; k < 5; k++) b.add('metalDark', bevelBoxAt(c.clone().addScaledVector(U, 0.092).addScaledVector(Lk, -0.07 + k * 0.035), 0.2, 0.03, 0.012, qh, 0.003), false);
  b.add('dockLight', bevelBoxAt(c.clone().addScaledVector(Lk, 0.085), 0.17, 0.11, 0.012, qh, 0.004), false);
  for (const s of [-1, 1]) {
    b.add('metalDark', bevelBoxAt(c.clone().addScaledVector(Lk, 0.13).addScaledVector(U, s * 0.074), 0.22, 0.012, 0.1, qh, 0.003), false);
    b.add('metalDark', bevelBoxAt(c.clone().addScaledVector(Lk, 0.13).addScaledVector(S, s * 0.104), 0.012, 0.16, 0.1, qh, 0.003), false);
  }
  for (const s of [-1, 1]) b.add('metalBare', tubeAt(c.clone().addScaledVector(side, s * 0.125), side, 0.025, 0.03, 12, { uv: false }), false);
  if (!D) return;
  for (const [x, z] of [[-0.085, -0.075], [0.085, -0.075], [-0.085, 0.075], [0.085, 0.075]]) { _m.makeTranslation(x, 0.03, z); D.bolt(_m2.copy(Mb).multiply(_m), 0.009, 0.007); }
  const cA = p.clone().addScaledVector(N, 0.03).addScaledVector(up, -0.09), cB = c.clone().addScaledVector(Lk, -0.09).addScaledVector(U, -0.04);
  D.rod('mid', 'paint', COL.black, cA, cB, 0.01, 'cyl6');
}

/**
 * Tool / equipment box on a surface (mount normal +Z through p, `up` = +Y): bolted feet, chamfered body with a
 * lid seam, hinge barrel, two latches, a grab handle on stand-offs, hazard tape. Reusable kit part.
 */
export function toolBox(b, D, p, w, h, d, { n = new THREE.Vector3(0, 0, 1), up = new THREE.Vector3(0, 1, 0), mat = 'hullWhiteAged' } = {}) {
  const N = n.clone().normalize();
  const M = frameYZ(p, N, up);
  const q = new THREE.Quaternion().setFromRotationMatrix(M);
  const X = new THREE.Vector3().setFromMatrixColumn(M, 0), Z = new THREE.Vector3().setFromMatrixColumn(M, 2);
  for (const s of [-1, 1]) b.add('metalDark', bevelBoxAt(p.clone().addScaledVector(N, 0.012).addScaledVector(X, s * (w / 2 - 0.05)), 0.06, 0.024, h + 0.04, q, 0.006), false);
  const c = p.clone().addScaledVector(N, 0.024 + (d - 0.05) / 2);
  b.add(mat, bevelBoxAt(c, w, d - 0.05, h, q, 0.025));
  b.add(mat, bevelBoxAt(p.clone().addScaledVector(N, 0.024 + d - 0.035), w + 0.012, 0.045, h + 0.012, q, 0.015));
  b.add('metalDark', bevelBoxAt(p.clone().addScaledVector(N, 0.024 + d - 0.058), w - 0.01, 0.008, h - 0.01, q, 0.002), false);
  b.add('metalBare', tubeAt(p.clone().addScaledVector(N, 0.024 + d - 0.04).addScaledVector(Z, h / 2 + 0.01), X, 0.012, w * 0.8, 10, { uv: false }), false);
  for (const s of [-1, 1]) b.add('metalBare', bevelBoxAt(p.clone().addScaledVector(N, 0.024 + d - 0.07).addScaledVector(X, s * w * 0.28).addScaledVector(Z, -h / 2 - 0.01), 0.06, 0.07, 0.024, q, 0.006), false);
  const top = p.clone().addScaledVector(N, 0.024 + d - 0.012);
  b.add('paintYellow', tubeAt(top.clone().addScaledVector(N, 0.06), X, 0.016, w * 0.5, 10, { uv: false }), false);
  for (const s of [-1, 1]) b.add('paintYellow', tubeAt(top.clone().addScaledVector(N, 0.03).addScaledVector(X, s * w * 0.25), N, 0.014, 0.06, 8, { uv: false }), false);
  b.add('hazard', bevelBoxAt(p.clone().addScaledVector(N, 0.024 + (d - 0.05) / 2).addScaledVector(Z, -h / 2 - 0.003), w * 0.7, 0.06, 0.006, q, 0.002), false);
  if (!D) return;
  for (const s of [-1, 1]) for (const t of [-1, 1]) { _m.makeTranslation(s * (w / 2 - 0.05), 0.024, t * (h / 2 - 0.02)); D.bolt(_m2.copy(M).multiply(_m), 0.009, 0.007); }
}
