import * as THREE from 'three';
import { lathe, flange, boltCircle, boltRow, seam, rod, block, handrail, thruster, lamp, beacon, grappleFixture, whip, axial, patch, connector, cable, vent, V, X_AXIS, Y_AXIS, Z_AXIS, LocalColliders as C } from '../Kit.js';
import { cbmPassive } from '../Mechanisms.js';
import { accordionWings, wingFrame } from './Russian.js';

/**
 * «Аист» — HTV-X-class cargo ship (large port):
 *   passive berthing ring on a conical forward bulkhead, 4.4 m pressurised module in white quilted
 *   blankets with bolted ring frames, grapple fixture and handrails; service module (octagonal) with gold
 *   blankets, radiator panels, proximity-link antenna on a tracking mount, laser reflectors, four main
 *   thrusters and RCS clusters, and two three-panel solar paddles that deploy after separation.
 */

const _m = new THREE.Matrix4();
const R = 2.2;

function htvAuthor(k) {
  const b = k.b, tpl = k.tpl;
  cbmPassive(k, { depth: 0.62 });
  // forward bulkhead cone and the pressurised module
  lathe(k, b, 'betaCloth', [[R, -1.35], [R - 0.02, -1.28], [1.6, -0.72], [1.49, -0.62]], { seg: 96, uv: 1.3 });
  lathe(k, b, 'betaCloth', [[R + 0.01, -4.95], [R + 0.025, -4.9], [R + 0.025, -1.4], [R + 0.01, -1.35]], { seg: 96, uv: 1.3 });
  for (const z of [-1.37, -2.55, -3.75, -4.93]) flange(k, b, z, R + 0.02, { h: 0.035, w: 0.07, surf: 'metalBare', bolts: k.near ? 80 : 0 });
  for (const z of [-1.96, -3.15, -4.34]) seam(k, b, z, R + 0.028, { surf: 'beta', t: 0.01, tint: 0xc9c6bb });
  grappleFixture(k, b, V(0, R + 0.03, -2.0), Y_AXIS);
  for (const a of [Math.PI * 0.2, Math.PI * 0.8, -Math.PI * 0.35]) for (const z of [-1.6, -3.4]) {
    const n = V(Math.cos(a), Math.sin(a), 0);
    handrail(k, b, n.clone().multiplyScalar(R + 0.025).setZ(z), n.clone().multiplyScalar(R + 0.025).setZ(z - 0.7), n, { surf: 'gold' });
  }
  // blanket cover patches over the hatches / feedthroughs, connectors, vents, harness run
  for (const [a, z, w, h] of [[Math.PI * 0.35, -2.0, 0.6, 0.45], [Math.PI * 0.65, -4.2, 0.5, 0.5], [Math.PI * 1.25, -2.7, 0.7, 0.4], [Math.PI * 1.7, -4.3, 0.45, 0.35]]) {
    const n = V(Math.cos(a), Math.sin(a), 0);
    patch(k, b, n.clone().multiplyScalar(R + 0.026).setZ(z), n, w, h, { surf: 'betaCloth', tint: 0xdedbd0 });
  }
  for (const a of [Math.PI * 0.08, Math.PI * 0.92]) connector(k, b, V(Math.cos(a) * (R + 0.025), Math.sin(a) * (R + 0.025), -4.7), V(Math.cos(a), Math.sin(a), 0), { plugs: 4, w: 0.2 });
  for (const a of [Math.PI * 1.4, Math.PI * 1.6]) vent(k, b, V(Math.cos(a) * (R + 0.025), Math.sin(a) * (R + 0.025), -1.7), V(Math.cos(a), Math.sin(a), 0), 0.035);
  { const a = Math.PI * 0.42, pts = []; for (let z = -1.45; z >= -4.85; z -= 0.4) pts.push(V(Math.cos(a) * (R + 0.05), Math.sin(a) * (R + 0.05), z)); cable(k, b, pts, 0.018, { surf: 'betaCloth' }); }
  k.label('{name}-{num}', 2.0, 0.42, V(0, -R - 0.03, -3.2), V(0, -1, 0), { right: V(1, 0, 0), color: '#283a5a' });
  k.label('{name}', 1.6, 0.4, V(R + 0.03, 0, -3.2), X_AXIS, { right: V(0, 0, -1), color: '#283a5a' });
  // service module: octagonal prism, alternating radiator / gold panels, aft deck
  const z0 = -5.0, z1 = -7.7;
  flange(k, b, z0 - 0.02, R - 0.1, { h: 0.12, w: 0.08, bolts: 64 });
  for (let i = 0; i < 8; i++) {
    const a = (i + 0.5) / 8 * Math.PI * 2, n = V(Math.cos(a), Math.sin(a), 0), t = V(-Math.sin(a), Math.cos(a), 0);
    const ap = R * Math.cos(Math.PI / 8);
    const q = new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(t, Z_AXIS, n));
    block(k, b, i % 2 ? 'radiator' : 'mliGold', n.clone().multiplyScalar(ap - 0.02).setZ((z0 + z1) / 2), 2 * R * Math.sin(Math.PI / 8) - 0.03, z0 - z1 - 0.1, 0.04, q, { bev: 0.01, shadow: true });
    if (!k.far) rod(k, b, 'metalBare', V(Math.cos(a + Math.PI / 8) * R * 0.99, Math.sin(a + Math.PI / 8) * R * 0.99, z0 - 0.04), V(Math.cos(a + Math.PI / 8) * R * 0.99, Math.sin(a + Math.PI / 8) * R * 0.99, z1 + 0.04), 0.03, { seg: 6 });
    if (k.near && i % 2 === 0) boltRow(k, b, n.clone().multiplyScalar(ap + 0.002).setZ(z0 - 0.15).addScaledVector(t, -0.5), n.clone().multiplyScalar(ap + 0.002).setZ(z0 - 0.15).addScaledVector(t, 0.5), n, 8, 0.008);
  }
  lathe(k, b, 'mliDark', [[R * 0.92, z1 + 0.02], [R * 0.92, z0 - 0.02]], { seg: 8, bev: 0, th0: Math.PI / 8 }) ;
  lathe(k, b, 'mliDark', [[0.0001, z1 - 0.02], [R * 0.95, z1]], { seg: 48, bev: 0 });
  flange(k, b, z1 + 0.03, R * 0.93, { h: 0.06, w: 0.06, bolts: 48, face: -1 });
  // four main thrusters + RCS clusters on the aft deck
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + i * Math.PI / 2, n = V(Math.cos(a), Math.sin(a), 0), t = V(-Math.sin(a), Math.cos(a), 0);
    thruster(k, b, n.clone().multiplyScalar(0.55).setZ(z1 - 0.02), V(0, 0, -1), 0.1, { main: true, bell: 2.4 });
    const c = n.clone().multiplyScalar(R * 0.9).setZ(z1 + 0.25);
    block(k, b, 'mliBlack', c.clone().addScaledVector(n, 0.08), 0.32, 0.36, 0.18, new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(t, Z_AXIS, n)), { bev: 0.02 });
    const f = c.clone().addScaledVector(n, 0.17);
    thruster(k, b, f, n, 0.03);
    thruster(k, b, f.clone().addScaledVector(t, 0.16).addScaledVector(n, -0.06), t, 0.028);
    thruster(k, b, f.clone().addScaledVector(t, -0.16).addScaledVector(n, -0.06), t.clone().negate(), 0.028);
    thruster(k, b, f.clone().addScaledVector(Z_AXIS, 0.17).addScaledVector(n, -0.06), Z_AXIS, 0.028);
    thruster(k, b, f.clone().addScaledVector(Z_AXIS, -0.17).addScaledVector(n, -0.06), V(0, 0, -1), 0.028);
  }
  // laser reflectors (corner cubes) facing forward, lights
  for (const p of [V(0.9, R * 0.75, -0.95), V(-0.9, R * 0.75, -0.95), V(0, -R * 0.8, -0.9)]) {
    if (!k.far) block(k, b, 'metalDark', p, 0.16, 0.16, 0.05, null, { bev: 0.01 });
    if (k.near) for (const [dx, dy] of [[-0.04, -0.04], [0.04, -0.04], [-0.04, 0.04], [0.04, 0.04]]) b.add('lens', axial(new THREE.CircleGeometry(0.03, 8), p.clone().add(V(dx, dy, 0.026)), Z_AXIS), false);
  }
  lamp(k, b, V(1.25, 1.25, -0.9), V(0, 0, 1), 0.12, 'dockLight');
  lamp(k, b, V(-1.25, 1.25, -0.9), V(0, 0, 1), 0.12, 'dockLight');
  beacon(k, b, V(-R - 0.03, 0.4, -4.6), V(-1, 0, 0), 'navRed');
  beacon(k, b, V(R + 0.03, 0.4, -4.6), X_AXIS, 'navGreen');
  beacon(k, b, V(0, R + 0.02, -5.3), Y_AXIS, 'strobe', 0.045);
  whip(k, b, V(0.6, -R, -7.2), V(0.2, -1, -0.3), 0.7);
  // proximity-link antenna on a short boom with a two-axis mount (tracks the station)
  const ap = V(Math.cos(Math.PI * 0.62) * R, Math.sin(Math.PI * 0.62) * R, -5.6), an = V(Math.cos(Math.PI * 0.62), Math.sin(Math.PI * 0.62), 0);
  rod(k, b, 'metalBare', ap, ap.clone().addScaledVector(an, 0.6), 0.035, { seg: 8 });
  tpl.pivot('plsYaw', { position: ap.clone().addScaledVector(an, 0.62), quaternion: new THREE.Quaternion().setFromUnitVectors(Y_AXIS, an) });
  tpl.pivot('plsPitch', { parent: 'plsYaw', position: V(0, 0.08, 0) });
  if (!k.far) rod(k, k.on('plsYaw'), 'metalDark', V(0, 0, 0), V(0, 0.08, 0), 0.05, { seg: 10 });
  const pb = k.on('plsPitch');
  lathe(k, pb, 'paintWhite', [[0.0001, -0.05], [0.12, -0.04], [0.2, 0.02], [0.21, 0.04]], { seg: 24, bev: 0, shadow: false });
  if (!k.far) { lathe(k, pb, 'antennaWhite', [[0.2, 0.035], [0.0001, -0.03]], { seg: 24, bev: 0, shadow: false }); rod(k, pb, 'metalDark', V(0, 0, -0.02), V(0, 0, 0.12), 0.012, { seg: 6 }); }
  // two three-panel solar paddles on the service module (accordion)
  const zW = -6.35;
  const wings = [-1, 1].map((sx) => ({ frame: wingFrame(V(sx * (R + 0.08), 0, zW), sx), n: 3, len: 1.85, width: 1.6, yoke: 0.55 }));
  for (const sx of [-1, 1]) if (!k.far) block(k, b, 'metalDark', V(sx * (R + 0.02), 0, zW), 0.12, 0.34, 0.4, null, { bev: 0.015 });
  const ws = accordionWings(k, 'wing', wings, { thick: 0.04, cellUV: 2.6 });

  k.collider(C.capsule(V(0, 0, -1.2), V(0, 0, -4.9), R + 0.05, 'pm'));
  k.collider(C.capsule(V(0, 0, -5.1), V(0, 0, -7.7), R + 0.05, 'sm'));
  for (const sx of [-1, 1]) k.collider(C.box(V(sx * (R + 0.6 + 2.8), 0, zW), V(2.85, 0.1, 0.82), null, 'wing'));
  return { wings: ws, track: [{ yaw: 'plsYaw', pitch: 'plsPitch', limit: 1.3, park: [0, 0] }] };
}

export const HTVX = {
  type: 'htvx', name: 'Аист', label: 'Грузовой корабль', size: 'large', length: 8.0, boundRadius: 8.4,
  mainAxis: Z_AXIS, upAxis: Y_AXIS, author: htvAuthor,
};
