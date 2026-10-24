import * as THREE from 'three';
import { lathe, flange, boltCircle, seam, rod, block, handrail, thruster, porthole, hatchRound, whip, lamp, beacon, patch, connector, cable, vent, surfaceQuat, V, X_AXIS, Y_AXIS, Z_AXIS, LocalColliders as C } from '../Kit.js';
import { ssvpProbe, dockingLights } from '../Mechanisms.js';
import { serviceModule, kurs, flag } from './Russian.js';

/**
 * «Сокол» — Soyuz MS-class crew transport (small port, probe docking unit).
 *   orbital module (БО): domed, quilted grey-green EVTI blankets, crew hatch, window, Kurs-NA antennas,
 *     docking lights + TV camera, SSVP-class probe unit at the front;
 *   descent module (СА): "headlight" shape, two windows, periscope fairing, parachute container cover;
 *   service module (ПАО): see Russian.js (accordion wings, DPO blocks, main engine).
 * «Обоз» — Progress MS-class cargo ship: cargo compartment (ГО), refuelling compartment (КДТ) with the
 *   external propellant-line fairings, the same service module, probe and Kurs.
 */

const _m = new THREE.Matrix4();

function profileRadius(prof) {
  return (z) => {
    for (let i = 1; i < prof.length; i++) {
      const [r0, z0] = prof[i - 1], [r1, z1] = prof[i];
      if ((z - z0) * (z - z1) <= 0) return r0 + (r1 - r0) * ((z - z0) / ((z1 - z0) || 1));
    }
    return prof[prof.length - 1][0];
  };
}
/** Outward unit normal of a lathe profile at z (for windows / hatches on curved shells). */
function profileNormal(rAt, a, z) {
  const dr = (rAt(z + 0.05) - rAt(z - 0.05)) / 0.1;
  return V(Math.cos(a), Math.sin(a), -dr).normalize();
}
function onShell(rAt, a, z, lift = 0) { const r = rAt(z) + lift; return V(Math.cos(a) * r, Math.sin(a) * r, z); }

/** Forward compartment shared look: blanket shell, binding seams, docking lights, camera, Kurs. */
function forwardCompartment(k, prof) {
  const b = k.b;
  lathe(k, b, 'blanketGreen', prof, { seg: 64, uv: 1.8, relief: { depth: 0.013, sub: 4 } });
  const rAt = profileRadius(prof);
  for (const z of [-0.45, prof[0][1] + 0.3]) seam(k, b, z, rAt(z) + 0.004, { surf: 'feltFlat', t: 0.012, tint: 0x6f7563 });
  // stitched gore seams along the shell
  if (k.near) for (let i = 0; i < 8; i++) {
    const a = (i + 0.5) / 8 * Math.PI * 2; let prev = null;
    for (let z = -0.5; z >= prof[0][1] + 0.3; z -= 0.25) { const p = onShell(rAt, a, z, 0.006); if (prev) rod(k, b, 'feltFlat', prev, p, 0.006, { seg: 4, tint: 0x6f7563 }); prev = p; }
  }
  dockingLights(k, 0.82, { z: -0.3, angle: Math.PI * 0.25 });
  const ant = kurs(k, rAt, { zBoom: -0.8, aBoom: Math.PI * 0.62, zDip: -0.5 });
  // blanket cover patches, connectors, vents, harness from the docking unit to the Kurs electronics
  for (const [a, z, w, h] of [[Math.PI * 0.05, -1.2, 0.36, 0.28], [Math.PI * 1.3, -1.7, 0.42, 0.3], [Math.PI * 1.75, -0.95, 0.3, 0.24], [Math.PI * 0.4, -2.0, 0.34, 0.26]]) {
    patch(k, b, onShell(rAt, a, z, 0.004), profileNormal(rAt, a, z), w, h, { surf: 'blanketGreen', tint: 0x878e78 });
  }
  for (const [a, z] of [[Math.PI * 0.45, -0.42], [Math.PI * 1.05, -0.42]]) connector(k, b, onShell(rAt, a, z, 0.0), profileNormal(rAt, a, z), { plugs: 3 });
  for (const [a, z] of [[Math.PI * 1.15, -2.3], [Math.PI * 1.85, -2.25]]) vent(k, b, onShell(rAt, a, z), profileNormal(rAt, a, z), 0.028);
  { const pts = []; for (let z = -0.42; z >= -0.78; z -= 0.12) pts.push(onShell(rAt, Math.PI * 0.56, z, 0.015)); cable(k, b, pts, 0.011); }
  { const pts = []; for (let z = -0.45; z >= -2.4; z -= 0.3) pts.push(onShell(rAt, Math.PI * 1.62, z, 0.014)); cable(k, b, pts, 0.013, { surf: 'blanketGrey' }); }
  return { rAt, ant };
}

function soyuzAuthor(k) {
  const b = k.b;
  const probe = ssvpProbe(k, { base: -0.5 });
  // orbital module
  const om = [[0.45, -2.8], [0.7, -2.7], [0.9, -2.52], [1.05, -2.24], [1.12, -1.92], [1.13, -1.52], [1.1, -1.12], [1.02, -0.8], [0.92, -0.56], [0.82, -0.38], [0.79, -0.2], [0.79, -0.12]];
  const { rAt, ant } = forwardCompartment(k, om);
  // crew hatch, window, handrails, small whip
  hatchRound(k, b, onShell(rAt, -Math.PI / 2, -1.55, 0.005), profileNormal(rAt, -Math.PI / 2, -1.55), 0.33, { surf: 'blanketGreen', hingeDir: Z_AXIS });
  porthole(k, b, onShell(rAt, Math.PI * 0.86, -1.25, 0.0), profileNormal(rAt, Math.PI * 0.86, -1.25), 0.1);
  for (const dz of [-1.0, -2.1]) {
    const a = -Math.PI / 2 + 0.55;
    handrail(k, b, onShell(rAt, a, dz), onShell(rAt, a + 0.35, dz), profileNormal(rAt, a + 0.17, dz), { surf: 'metalBare' });
  }
  whip(k, b, onShell(rAt, Math.PI * 1.25, -2.2), profileNormal(rAt, Math.PI * 1.25, -2.2), 0.5);
  // hatch neck between the modules
  lathe(k, b, 'metalDark', [[0.4, -3.15], [0.42, -2.76]], { seg: 40 });
  flange(k, b, -2.98, 0.4, { h: 0.06, w: 0.05, bolts: 20 });
  // descent module ("headlight": spherical top, conical sides, heat shield at the base)
  const dm = [[1.09, -5.2], [1.088, -5.02], [1.06, -4.62], [1.0, -4.2], [0.9, -3.8], [0.77, -3.5], [0.6, -3.27], [0.44, -3.12]];
  lathe(k, b, 'blanketGreen', dm, { seg: 64, uv: 1.8, relief: { depth: 0.013, sub: 4 } });
  const dAt = profileRadius(dm);
  seam(k, b, -3.3, dAt(-3.3) + 0.003, { surf: 'feltFlat', t: 0.012, tint: 0x6f7563 });
  seam(k, b, -5.0, dAt(-5.0) + 0.003, { surf: 'feltFlat', t: 0.012, tint: 0x6f7563 });
  for (const a of [Math.PI * 0.12, Math.PI * 0.88]) porthole(k, b, onShell(dAt, a, -3.85), profileNormal(dAt, a, -3.85), 0.11);
  // periscope (ВСК) fairing with its window
  {
    const a = Math.PI * 0.5, z = -3.55, n = profileNormal(dAt, a, z), p = onShell(dAt, a, z);
    if (!k.far) {
      const g = new THREE.SphereGeometry(0.16, k.seg(16), k.seg(10), 0, Math.PI * 2, 0, Math.PI / 2);
      g.scale(1, 1.5, 0.75).rotateX(Math.PI / 2);
      g.applyMatrix4(_m.compose(p, new THREE.Quaternion().setFromUnitVectors(Z_AXIS, n), new THREE.Vector3(1, 1, 1)));
      b.add('blanketGreen', g, false);
      porthole(k, b, p.clone().addScaledVector(n, 0.1).addScaledVector(Z_AXIS, 0.1), V(0, 0.4, 1).normalize(), 0.05, { frame: 0.02 });
    }
  }
  // parachute container cover (main chute) on the descent module side
  if (!k.far) {
    const a = -Math.PI * 0.18, z = -4.2, n = profileNormal(dAt, a, z), p = onShell(dAt, a, z, 0.006);
    const q = new THREE.Quaternion().setFromUnitVectors(Z_AXIS, n);
    block(k, b, 'blanketGrey', p, 0.62, 0.5, 0.02, q, { bev: 0.008 });
    if (k.near) for (const [dx, dy] of [[-0.27, -0.21], [0.27, -0.21], [-0.27, 0.21], [0.27, 0.21]]) block(k, b, 'metalBare', p.clone().add(V(dx, dy, 0.015).applyQuaternion(q)), 0.04, 0.04, 0.012, q);
  }
  // descent-module attitude thruster (СИО) ports, VHF whips, pressure-equalisation vents
  for (let i = 0; i < 8; i++) {
    const a = (i + 0.5) / 8 * Math.PI * 2 + 0.1, z = i % 2 ? -4.55 : -3.7, n = profileNormal(dAt, a, z), p = onShell(dAt, a, z, 0.002);
    if (!k.far) b.add('blackAnod', new THREE.CircleGeometry(0.07, k.seg(12)).applyMatrix4(_m.compose(p.clone().addScaledVector(n, 0.004), surfaceQuat(n), new THREE.Vector3(1, 1, 1))), false);
    thruster(k, b, p.clone().addScaledVector(n, -0.03), n, 0.022, { bell: 1.4, register: false, collar: false });
  }
  for (const a of [Math.PI * 0.32, Math.PI * 1.68]) whip(k, b, onShell(dAt, a, -4.9), V(Math.cos(a), Math.sin(a), -0.6).normalize(), 0.55);
  vent(k, b, onShell(dAt, Math.PI * 1.1, -4.0), profileNormal(dAt, Math.PI * 1.1, -4.0), 0.03);
  patch(k, b, onShell(dAt, Math.PI * 0.68, -4.35, 0.003), profileNormal(dAt, Math.PI * 0.68, -4.35), 0.3, 0.26, { surf: 'blanketGreen', tint: 0x878e78 });
  porthole(k, b, onShell(rAt, Math.PI * 0.14, -1.6, 0.0), profileNormal(rAt, Math.PI * 0.14, -1.6), 0.08);
  // descent-module heat shield rim between the DM and the transfer section
  lathe(k, b, 'tilesHS', [[1.06, -5.28], [1.09, -5.2]], { seg: 56 });
  flange(k, b, -5.22, 1.08, { h: 0.025, w: 0.04, bolts: 0 });
  const sm = serviceModule(k, -5.28);
  // markings on the instrument compartment
  const zI = -5.28 - 0.28 - 0.3;
  k.label('{name}-{num}', 1.25, 0.26, V(0, 1.122, zI), Y_AXIS, { right: V(-1, 0, 0), color: '#1d2a3a' });
  k.label('РОССИЯ', 0.9, 0.22, V(0, -1.122, zI), V(0, -1, 0), { right: V(1, 0, 0), color: '#1d2a3a' });
  flag(k, b, 1.115, 0, zI, 0.36, 0.24);
  flag(k, b, 1.115, Math.PI, zI, 0.36, 0.24);
  k.collider(C.sphere(V(0, 0, -0.35), 1.05, 'dockUnit'));
  k.collider(C.capsule(V(0, 0, -0.6), V(0, 0, -2.45), 1.15, 'orbitalModule'));
  k.collider(C.capsule(V(0, 0, -3.35), V(0, 0, -4.95), 1.1, 'descentModule'));
  return { probe, wings: sm.wings, hinges: ant.hinges, track: ant.track };
}

function progressAuthor(k) {
  const b = k.b;
  const probe = ssvpProbe(k, { base: -0.5 });
  const go = [[0.45, -3.05], [0.75, -2.95], [0.98, -2.75], [1.1, -2.45], [1.14, -2.1], [1.14, -1.2], [1.1, -0.9], [1.0, -0.62], [0.88, -0.42], [0.79, -0.24], [0.79, -0.12]];
  const { rAt, ant } = forwardCompartment(k, go);
  // refuelling compartment (КДТ): cone + cylinder carrying the propellant tanks
  const kdt = [[1.04, -5.34], [1.04, -5.2], [1.01, -5.02], [1.0, -4.8], [1.0, -3.55], [0.8, -3.3], [0.45, -3.08]];
  lathe(k, b, 'blanketGreen', kdt, { seg: 64, uv: 1.8, relief: { depth: 0.013, sub: 4 } });
  const kAt = profileRadius(kdt);
  for (const z of [-3.5, -4.15, -4.8]) seam(k, b, z, 1.004, { surf: 'feltFlat', t: 0.012, tint: 0x6f7563 });
  flange(k, b, -3.07, 0.43, { h: 0.05, w: 0.05, bolts: 20 });
  // external propellant / pressurisation line fairings running from the docking unit to the КДТ
  for (const a of [Math.PI * 0.5 + 0.42, Math.PI * 0.5 + 0.62]) {
    let prev = null;
    for (let z = -0.3; z >= -5.25; z -= (k.near ? 0.12 : 0.35)) {
      const r = (z > -3.1 ? rAt(z) : kAt(z)) + 0.065;
      const p = V(Math.cos(a) * r, Math.sin(a) * r, z);
      if (prev) rod(k, b, 'blanketGrey', prev, p, 0.055, { seg: 10 });
      prev = p;
    }
    if (k.near) for (let z = -0.6; z > -5.2; z -= 0.6) { const r = (z > -3.1 ? rAt(z) : kAt(z)) + 0.065; const g = new THREE.TorusGeometry(0.062, 0.01, 4, 10); b.add('metalBare', g.applyMatrix4(_m.compose(V(Math.cos(a) * r, Math.sin(a) * r, z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1))), false); }
  }
  // cargo hatch outline and handrails for EVA retrieval
  hatchRound(k, b, onShell(rAt, -Math.PI / 2, -1.7, 0.005), V(0, -1, 0), 0.3, { surf: 'blanketGreen', hingeDir: Z_AXIS });
  for (const dz of [-1.1, -2.3]) {
    const a = -Math.PI / 2 - 0.5;
    handrail(k, b, onShell(rAt, a, dz), onShell(rAt, a - 0.35, dz), profileNormal(rAt, a - 0.17, dz), { surf: 'metalBare' });
  }
  const sm = serviceModule(k, -5.34);
  const zI = -5.34 - 0.28 - 0.3;
  k.label('{name}-{num}', 1.25, 0.26, V(0, 1.122, zI), Y_AXIS, { right: V(-1, 0, 0), color: '#1d2a3a' });
  k.label('ГРУЗОВОЙ', 0.95, 0.22, V(0, -1.122, zI), V(0, -1, 0), { right: V(1, 0, 0), color: '#1d2a3a' });
  flag(k, b, 1.115, 0, zI, 0.36, 0.24);
  k.collider(C.sphere(V(0, 0, -0.35), 1.05, 'dockUnit'));
  k.collider(C.capsule(V(0, 0, -0.6), V(0, 0, -2.7), 1.15, 'cargoModule'));
  k.collider(C.capsule(V(0, 0, -3.4), V(0, 0, -5.1), 1.06, 'refuel'));
  return { probe, wings: sm.wings, hinges: ant.hinges, track: ant.track };
}

export const SOYUZ = {
  type: 'soyuz', name: 'Сокол', label: 'Пилотируемый корабль', size: 'small', length: 8.1, boundRadius: 5.7,
  mainAxis: Z_AXIS, upAxis: Y_AXIS, author: soyuzAuthor, dock: 'probe',
};
export const PROGRESS = {
  type: 'progress', name: 'Обоз', label: 'Грузовой корабль', size: 'small', length: 8.2, boundRadius: 5.7,
  mainAxis: Z_AXIS, upAxis: Y_AXIS, author: progressAuthor, dock: 'probe',
};
