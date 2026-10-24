import * as THREE from 'three';
import { lathe, flange, boltCircle, boltRow, seam, rod, block, handrail, thruster, porthole, hatchRound, lamp, beacon, axial, patch, connector, cable, vent, V, X_AXIS, Y_AXIS, Z_AXIS, LocalColliders as C } from '../Kit.js';
import { idssActive, dockingLights } from '../Mechanisms.js';
import { flag } from './Russian.js';

/**
 * «Пегас» — Starliner-class crew vehicle (small port, NDS/IDSS-class docking system):
 *   Apollo-like crew module (33° backshell of small white tiles, blue band, hatch with window, RCS doors),
 *   hinged docking-hatch cover over the docking system; service module with radiators, four thruster
 *   "doghouses" (RCS + OMAC), body-mounted solar cells on the aft dome and four canted abort engines.
 */

const _m = new THREE.Matrix4(), _s = new THREE.Vector3(1, 1, 1);
const CM = [[2.28, -2.45], [1.22, -0.64]];
const rCM = (z) => CM[0][0] + (CM[1][0] - CM[0][0]) * (z - CM[0][1]) / (CM[1][1] - CM[0][1]);
const nCM = (a) => V(Math.cos(a), Math.sin(a), (CM[0][0] - CM[1][0]) / (CM[1][1] - CM[0][1])).normalize();
const onCM = (a, z, lift = 0) => { const r = rCM(z) + lift; return V(Math.cos(a) * r, Math.sin(a) * r, z); };
const qCM = (a) => { const n = nCM(a), t = V(-Math.sin(a), Math.cos(a), 0); return new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(t, new THREE.Vector3().crossVectors(n, t), n)); };
const SM_R = 2.28;

function starlinerAuthor(k) {
  const b = k.b, tpl = k.tpl;
  const scs = idssActive(k, { R: 0.8, base: -0.5 });
  dockingLights(k, 1.12, { z: -0.45, angle: Math.PI / 2 + 0.6, camera: true });
  // forward ring under the cover
  lathe(k, b, 'paintWhite', [[1.24, -0.66], [1.24, -0.6], [1.12, -0.55]], { seg: 64 });
  flange(k, b, -0.6, 1.12, { h: 0.035, w: 0.04, bolts: 36 });
  // crew module backshell (white tiles), blue band, shoulder
  lathe(k, b, 'tilesWhite', [[2.26, -2.66], [2.3, -2.56], CM[0], CM[1], [1.24, -0.66]], { seg: 96, bev: 0.025, uv: 5 });
  lathe(k, b, 'paintBlue', [[rCM(-2.3) + 0.004, -2.3], [rCM(-2.12) + 0.004, -2.12]], { seg: 96, bev: 0, shadow: false });
  seam(k, b, -2.3, rCM(-2.3) + 0.006, { surf: 'paintWhite', t: 0.008 });
  seam(k, b, -2.12, rCM(-2.12) + 0.006, { surf: 'paintWhite', t: 0.008 });
  // hatch with window, two crew windows, RCS doors with thrusters
  {
    const a = -Math.PI / 2, z = -1.55, n = nCM(a), p = onCM(a, z, 0.005);
    hatchRound(k, b, p, n, 0.55, { surf: 'tilesWhite', hingeDir: Z_AXIS });
    porthole(k, b, p.clone().addScaledVector(n, 0.035).addScaledVector(Z_AXIS, 0.12), n, 0.12, { frame: 0.025 });
    if (k.near) for (const s of [-1, 1]) handrail(k, b, onCM(a + s * 0.32, -1.1), onCM(a + s * 0.32, -1.95), nCM(a + s * 0.32), { surf: 'gold' });
  }
  for (const a of [Math.PI * 0.12, Math.PI * 0.88]) {
    const z = -1.35, n = nCM(a), p = onCM(a, z, 0.008);
    if (!k.far) block(k, b, 'blackAnod', p.clone().addScaledVector(n, -0.004), 0.34, 0.3, 0.03, qCM(a), { bev: 0.03 });
    porthole(k, b, p.clone().addScaledVector(n, 0.012), n, 0.11, { frame: 0.025 });
  }
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + i * Math.PI / 2, z = -0.95, n = nCM(a), t = V(-Math.sin(a), Math.cos(a), 0), p = onCM(a, z, 0.0);
    if (!k.far) block(k, b, 'blackAnod', p.clone().addScaledVector(n, -0.01), 0.34, 0.3, 0.04, qCM(a), { bev: 0.02 });
    thruster(k, b, p.clone().addScaledVector(n, -0.03), V(Math.cos(a), Math.sin(a), 0), 0.028, { bell: 1.6 });
    thruster(k, b, p.clone().addScaledVector(t, 0.1).addScaledVector(n, -0.03), t, 0.024, { bell: 1.6 });
    thruster(k, b, p.clone().addScaledVector(t, -0.1).addScaledVector(n, -0.03), t.clone().negate(), 0.024, { bell: 1.6 });
  }
  // CM/SM interface (heat shield edge) and the service module
  lathe(k, b, 'tilesHS', [[2.24, -2.76], [2.26, -2.66]], { seg: 80 });
  flange(k, b, -2.78, SM_R - 0.02, { h: 0.05, w: 0.06, bolts: 64 });
  lathe(k, b, 'radiator', [[SM_R, -3.92], [SM_R, -2.8]], { seg: 96, uv: 1.4 });
  for (const z of [-3.2, -3.6]) seam(k, b, z, SM_R + 0.003, { surf: 'metalDark', t: 0.006 });
  flange(k, b, -3.94, SM_R - 0.02, { h: 0.05, w: 0.05, bolts: 64 });
  // aft dome with body-mounted solar cells, centre plate
  lathe(k, b, 'solar', [[0.95, -4.28], [1.6, -4.2], [2.1, -4.06], [SM_R, -3.96]], { seg: 96, uv: 4 });
  lathe(k, b, 'mliDark', [[0.0001, -4.3], [0.95, -4.28]], { seg: 48 });
  // thruster doghouses (4): bevelled boxes with RCS + OMAC nozzles
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2, n = V(Math.cos(a), Math.sin(a), 0), t = V(-Math.sin(a), Math.cos(a), 0);
    const q = new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(t, Z_AXIS, n));
    const c = n.clone().multiplyScalar(SM_R + 0.12).setZ(-3.32);
    block(k, b, 'paintWhite', c, 0.7, 1.1, 0.3, q, { bev: 0.05, shadow: true });
    if (!k.far) block(k, b, 'blackAnod', c.clone().addScaledVector(n, 0.15), 0.56, 0.8, 0.02, q, { bev: 0.01 });
    const f = c.clone().addScaledVector(n, 0.16);
    thruster(k, b, f.clone().addScaledVector(Z_AXIS, 0.25), n, 0.035, { bell: 1.8 });
    thruster(k, b, f.clone().addScaledVector(Z_AXIS, -0.05), n, 0.035, { bell: 1.8 });
    thruster(k, b, f.clone().addScaledVector(t, 0.36).addScaledVector(n, -0.12), t, 0.032, { bell: 1.8 });
    thruster(k, b, f.clone().addScaledVector(t, -0.36).addScaledVector(n, -0.12), t.clone().negate(), 0.032, { bell: 1.8 });
    thruster(k, b, f.clone().addScaledVector(Z_AXIS, 0.56).addScaledVector(n, -0.12), Z_AXIS, 0.032, { bell: 1.8 });
    // OMAC pair firing aft
    for (const s of [-1, 1]) thruster(k, b, c.clone().addScaledVector(t, s * 0.17).addScaledVector(Z_AXIS, -0.56), V(0, 0, -1).addScaledVector(n, 0.12).normalize(), 0.07, { bell: 2.0, main: true });
    if (k.near) boltRow(k, b, c.clone().addScaledVector(n, 0.152).addScaledVector(Z_AXIS, 0.47).addScaledVector(t, -0.3), c.clone().addScaledVector(n, 0.152).addScaledVector(Z_AXIS, 0.47).addScaledVector(t, 0.3), n, 6, 0.008);
  }
  // four launch-abort engines on the aft dome, canted outward
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + i * Math.PI / 2, n = V(Math.cos(a), Math.sin(a), 0);
    const p = n.clone().multiplyScalar(1.4).setZ(-4.12);
    if (!k.far) b.add('metalDark', lathe(k, null, 'metalDark', [[0.0001, 0.0], [0.33, 0.0], [0.33, 0.14]], { seg: 24, bev: 0.01 }).translate(p.x, p.y, p.z), false);
    thruster(k, b, p, V(0, 0, -1).addScaledVector(n, 0.28).normalize(), 0.27, { bell: 2.6, register: false });
  }
  // radiator coolant headers, service connectors, vents
  if (!k.far) for (let i = 0; i < 24; i++) { const a = (i + 0.5) / 24 * Math.PI * 2; if (Math.abs(Math.sin(2 * a)) < 0.2) continue; rod(k, b, 'metalBare', V(Math.cos(a) * (SM_R + 0.01), Math.sin(a) * (SM_R + 0.01), -2.85), V(Math.cos(a) * (SM_R + 0.01), Math.sin(a) * (SM_R + 0.01), -3.88), 0.012, { seg: 5 }); }
  for (const a of [Math.PI * 0.25, Math.PI * 1.25]) connector(k, b, V(Math.cos(a) * SM_R, Math.sin(a) * SM_R, -2.9), V(Math.cos(a), Math.sin(a), 0), { plugs: 3 });
  for (const a of [Math.PI * 0.1, Math.PI * 0.9]) vent(k, b, onCM(a, -2.0, 0.0), nCM(a), 0.035);
  // umbilical, nav lights, strobes
  if (!k.far) block(k, b, 'paintWhite', V(0, SM_R + 0.05, -2.95), 0.4, 0.12, 0.34, null, { bev: 0.03 });
  beacon(k, b, V(-SM_R - 0.01, 0.6, -3.7), V(-1, 0, 0), 'navRed');
  beacon(k, b, V(SM_R + 0.01, 0.6, -3.7), X_AXIS, 'navGreen');
  beacon(k, b, onCM(Math.PI / 2, -0.8, 0.01), nCM(Math.PI / 2), 'strobe', 0.04);
  beacon(k, b, V(0.5, -SM_R - 0.01, -3.5), V(0, -1, 0), 'strobe', 0.04);
  k.label('{name}-{num}', 1.3, 0.28, onCM(Math.PI / 2, -1.75, 0.008), nCM(Math.PI / 2), { right: V(-1, 0, 0), color: '#1d2d5a' });
  flag(k, b, rCM(-1.75), Math.PI / 2 + 0.45, -1.75, 0.32, 0.2);

  // hinged docking-hatch cover (pivot on the +Y rim, about X)
  const hinge = V(0, 1.23, -0.62);
  tpl.pivot('cover', { position: hinge });
  const cb = k.on('cover');
  const lid = [[1.24, -0.64], [1.2, -0.45], [1.04, -0.22], [0.7, -0.04], [0.0001, 0.04]];
  cb.add('tilesWhite', lathe(k, null, 'tilesWhite', lid, { seg: 72, bev: 0.01, uv: 5 }).translate(0, -hinge.y, -hinge.z), true);
  if (!k.far) {
    cb.add('hullGray', lathe(k, null, 'hullGray', lid.map(([r, z]) => [r - 0.04, z - 0.03]).reverse(), { seg: 56, bev: 0 }).translate(0, -hinge.y, -hinge.z), false);
    for (const sx of [-0.25, 0.25]) { block(k, cb, 'metalBare', V(sx, -0.12, 0.06), 0.06, 0.28, 0.07, null, { bev: 0.01 }); rod(k, cb, 'metalDark', V(sx - 0.05, 0, 0), V(sx + 0.05, 0, 0), 0.03, { seg: 10 }); }
    for (const sx of [-0.25, 0.25]) block(k, b, 'metalDark', V(sx, 1.23, -0.64), 0.12, 0.1, 0.08, null, { bev: 0.01 });
  }

  k.collider(C.sphere(V(0, 0, -0.3), 1.15, 'dockRing'));
  k.collider(C.sphere(V(0, 0, -1.0), 1.45, 'cmTop'));
  k.collider(C.capsule(V(0, 0, -1.75), V(0, 0, -2.35), 2.2, 'cm'));
  k.collider(C.capsule(V(0, 0, -2.95), V(0, 0, -3.95), 2.4, 'sm'));
  k.collider(C.sphere(V(0, 2.0, -0.35), 0.75, 'cover'));
  return { scs, hinges: [{ pivot: 'cover', axis: 'x', from: 0, to: -2.05, channel: 'nose' }] };
}

export const STARLINER = {
  type: 'starliner', name: 'Пегас', label: 'Пилотируемый корабль', size: 'small', length: 5.2, boundRadius: 3.6,
  mainAxis: Z_AXIS, upAxis: Y_AXIS, author: starlinerAuthor,
};
