import * as THREE from 'three';
import { lathe, flange, boltCircle, boltRow, seam, rod, block, handrail, thruster, porthole, lamp, beacon, grappleFixture, whip, axial, patch, connector, cable, vent, V, X_AXIS, Y_AXIS, Z_AXIS, LocalColliders as C } from '../Kit.js';
import { cbmPassive } from '../Mechanisms.js';

/**
 * «Лебедь» — Cygnus-class cargo ship (large port; berthed vehicles simply dock here, there is no arm capture):
 *   passive berthing ring (CBM-class), silver pressurised cargo module with bolted ring frames, grapple
 *   fixture and a rendezvous lidar on a tracking turret; gold-blanketed service module with thruster pods,
 *   main engine and two circular UltraFlex-type fan arrays that unfurl from a folded wedge.
 */

const _m = new THREE.Matrix4(), _r = new THREE.Matrix4(), _t = new THREE.Matrix4(), _s = new THREE.Vector3(1, 1, 1);
const PCM_R = 1.535, SM_R = 1.3;
const FAN_N = 10, FAN_R = 2.15;

/** Fan frames: hub at (sx * 3.85, 0.25, -6.0), local Z = ship +Y (cells), local X = outward. */
function fanFrames() {
  return [-1, 1].map((sx) => new THREE.Matrix4().makeBasis(V(sx, 0, 0), V(0, 0, -sx), V(0, 1, 0)).setPosition(sx * 3.85, 0.25, -6.0));
}

function goreParts(k) {
  const step = (Math.PI * 2) / FAN_N;
  const parts = [];
  const cells = new THREE.CircleGeometry(FAN_R - 0.04, k.seg(6, 2), 0.012, step - 0.024);
  // radial UVs -> cell rows along the radius
  const uv = cells.attributes.uv, pos = cells.attributes.position;
  for (let i = 0; i < uv.count; i++) { const x = pos.getX(i), y = pos.getY(i); uv.setXY(i, Math.atan2(y, x) * 6, Math.hypot(x, y) * 4); }
  parts.push(['solar', cells.translate(0, 0, 0.006)]);
  const back = new THREE.CircleGeometry(FAN_R - 0.03, k.seg(6, 2), 0.0, step);
  back.rotateY(Math.PI); back.rotateZ(step - Math.PI);   // mirrored: bring the sector back to 0..step
  parts.push(['solarBack', back.translate(0, 0, -0.004)]);
  if (!k.far) {
    parts.push(['metalBare', new THREE.CylinderGeometry(0.014, 0.02, FAN_R - 0.1, 6).rotateZ(-Math.PI / 2).translate(0.1 + (FAN_R - 0.1) / 2, 0, 0)]);
    const rim = new THREE.TorusGeometry(FAN_R - 0.02, 0.012, 4, k.seg(6, 2), step);
    parts.push(['metalBare', rim]);
  }
  return parts;
}

function cygnusAuthor(k) {
  const b = k.b, tpl = k.tpl;
  cbmPassive(k, { depth: 0.62 });
  // pressurised cargo module: short forward cone, silver cylinder with bolted ring frames
  lathe(k, b, 'hullSilver', [[PCM_R, -1.0], [PCM_R - 0.01, -0.92], [1.49, -0.66], [1.49, -0.6]], { seg: 96 });
  lathe(k, b, 'hullSilver', [[PCM_R, -5.0], [PCM_R, -1.0]], { seg: 96, uv: 1.2 });
  for (const z of [-1.0, -2.35, -3.7, -5.0]) flange(k, b, z, PCM_R, { h: 0.035, w: 0.07, bolts: k.near ? 72 : 0, surf: 'metalBare' });
  // longitudinal MMOD panel seams + white blanket patches
  if (!k.far) for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; rod(k, b, 'metalDark', V(Math.cos(a) * (PCM_R + 0.003), Math.sin(a) * (PCM_R + 0.003), -1.03), V(Math.cos(a) * (PCM_R + 0.003), Math.sin(a) * (PCM_R + 0.003), -4.97), 0.005, { seg: 4 }); }
  lathe(k, b, 'betaCloth', [[PCM_R + 0.01, -3.65], [PCM_R + 0.01, -2.4]], { seg: 96, th0: Math.PI * 1.1, thl: Math.PI * 0.8, bev: 0 });
  // MMOD shield fasteners along every panel seam, between the ring frames
  if (k.near) for (let i = 0; i < 16; i++) {
    const a = i / 16 * Math.PI * 2, n = V(Math.cos(a), Math.sin(a), 0);
    for (const [z0, z1] of [[-1.08, -2.27], [-2.43, -3.62], [-3.78, -4.92]]) boltRow(k, b, n.clone().multiplyScalar(PCM_R + 0.004).setZ(z0), n.clone().multiplyScalar(PCM_R + 0.004).setZ(z1), n, 7, 0.009);
  }
  // utility connectors, vents and a harness run from the berthing ring to the service module
  for (const a of [Math.PI * 0.1, Math.PI * 0.9]) connector(k, b, V(Math.cos(a) * PCM_R, Math.sin(a) * PCM_R, -4.75), V(Math.cos(a), Math.sin(a), 0), { plugs: 3 });
  for (const a of [Math.PI * 1.15, Math.PI * 1.85]) vent(k, b, V(Math.cos(a) * PCM_R, Math.sin(a) * PCM_R, -1.6), V(Math.cos(a), Math.sin(a), 0), 0.03);
  { const a = Math.PI * 1.62, pts = []; for (let z = -1.05; z >= -5.3; z -= 0.35) pts.push(V(Math.cos(a) * (PCM_R + 0.03), Math.sin(a) * (PCM_R + 0.03), z)); cable(k, b, pts, 0.016, { surf: 'betaCloth' }); }
  // aft cone to the service module
  lathe(k, b, 'hullSilver', [[SM_R, -5.38], [SM_R + 0.04, -5.3], [PCM_R, -5.05], [PCM_R, -5.0]], { seg: 96 });
  flange(k, b, -5.38, SM_R, { h: 0.05, w: 0.06, bolts: 48 });
  // grapple fixture, handrails, markings
  grappleFixture(k, b, V(0, -PCM_R - 0.005, -2.0), V(0, -1, 0));
  for (const z of [-1.4, -3.0, -4.4]) {
    const a = -Math.PI / 2 + 0.5;
    handrail(k, b, V(Math.cos(a) * PCM_R, Math.sin(a) * PCM_R, z), V(Math.cos(a) * PCM_R, Math.sin(a) * PCM_R, z - 0.6), V(Math.cos(a), Math.sin(a), 0), { surf: 'gold' });
  }
  k.label('{name}-{num}', 1.8, 0.38, V(0, PCM_R + 0.008, -3.0), Y_AXIS, { right: V(-1, 0, 0), color: '#1d2b44' });
  k.label('{name}-{num}', 1.8, 0.38, V(PCM_R + 0.008, 0, -3.0), X_AXIS, { right: V(0, 0, -1), color: '#1d2b44' });
  // service module: gold blankets, black equipment panels, thruster pods
  lathe(k, b, 'mliGold', [[SM_R, -6.55], [SM_R, -5.4]], { seg: 80, uv: 1.5 });
  for (let i = 0; i < 6; i++) {
    const a = (i + 0.5) / 6 * Math.PI * 2, n = V(Math.cos(a), Math.sin(a), 0), t = V(-Math.sin(a), Math.cos(a), 0);
    if (!k.far) block(k, b, i % 2 ? 'mliBlack' : 'radiator', n.clone().multiplyScalar(SM_R + 0.01).setZ(-5.95), 0.62, 0.8, 0.03, new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(t, Z_AXIS, n)), { bev: 0.01 });
  }
  for (const z of [-5.42, -6.53]) flange(k, b, z, SM_R, { h: 0.035, w: 0.05, bolts: 40 });
  lathe(k, b, 'mliDark', [[0.35, -6.75], [1.0, -6.7], [SM_R, -6.56]], { seg: 64 });
  thruster(k, b, V(0, 0, -6.74), V(0, 0, -1), 0.2, { main: true, bell: 2.4 });
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + i * Math.PI / 2, n = V(Math.cos(a), Math.sin(a), 0), t = V(-Math.sin(a), Math.cos(a), 0);
    const c = n.clone().multiplyScalar(SM_R + 0.08).setZ(-6.2);
    block(k, b, 'mliBlack', c, 0.3, 0.42, 0.18, new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(t, Z_AXIS, n)), { bev: 0.02, shadow: true });
    const f = c.clone().addScaledVector(n, 0.09);
    thruster(k, b, f.clone().addScaledVector(Z_AXIS, 0.08), n, 0.03);
    thruster(k, b, f.clone().addScaledVector(t, 0.15).addScaledVector(n, -0.05), t, 0.028);
    thruster(k, b, f.clone().addScaledVector(t, -0.15).addScaledVector(n, -0.05), t.clone().negate(), 0.028);
    thruster(k, b, f.clone().addScaledVector(Z_AXIS, 0.21).addScaledVector(n, -0.05), Z_AXIS, 0.028);
    thruster(k, b, f.clone().addScaledVector(Z_AXIS, -0.21).addScaledVector(n, -0.05), V(0, 0, -1), 0.028);
  }
  whip(k, b, V(0.4, -SM_R, -6.3), V(0.2, -1, -0.3), 0.6);
  beacon(k, b, V(0, SM_R + 0.01, -5.6), Y_AXIS, 'strobe', 0.045);
  beacon(k, b, V(-PCM_R - 0.01, 0.3, -4.8), V(-1, 0, 0), 'navRed');
  beacon(k, b, V(PCM_R + 0.01, 0.3, -4.8), X_AXIS, 'navGreen');
  lamp(k, b, V(0.7, PCM_R - 0.06, -0.72), V(0, 0.6, 1).normalize(), 0.12, 'dockLight');
  lamp(k, b, V(-0.7, PCM_R - 0.06, -0.72), V(0, 0.6, 1).normalize(), 0.12, 'dockLight');
  for (const p of [V(0.35, -1.45, -0.7), V(-0.35, -1.45, -0.7), V(0, -1.45, -0.55)]) beacon(k, b, p, V(0, -0.3, 1).normalize(), 'ledWhite', 0.03);

  // fan yokes (static) + hub drums; gores are one instanced set (2 x FAN_N)
  for (const F of fanFrames()) {
    const hub = new THREE.Vector3().setFromMatrixPosition(F), sx = Math.sign(hub.x);
    rod(k, b, 'metalBare', V(sx * SM_R, 0.25, -6.0), V(sx * (Math.abs(hub.x) - 0.12), 0.25, -6.0), 0.05, { seg: 10, shadow: true });
    if (!k.far) {
      block(k, b, 'metalDark', V(sx * (SM_R + 0.06), 0.25, -6.0), 0.14, 0.22, 0.22, null, { bev: 0.02 });
      rod(k, b, 'metalDark', V(sx * (SM_R + 0.25), 0.25, -6.0), V(sx * (SM_R + 0.25), 0.25, -6.0).add(V(sx * 0.6, 0, 0)), 0.065, { seg: 10 });
      rod(k, b, 'cable', V(sx * SM_R, 0.31, -5.98), V(sx * (Math.abs(hub.x) - 0.15), 0.31, -5.98), 0.012, { seg: 5 });
    }
    rod(k, b, 'metalDark', hub.clone().add(V(0, -0.12, 0)), hub.clone().add(V(0, 0.08, 0)), 0.16, { seg: 16 });
    if (!k.far) rod(k, b, 'metalBare', hub.clone().add(V(0, 0.08, 0)), hub.clone().add(V(0, 0.12, 0)), 0.1, { seg: 12 });
  }
  k.instanced('fan', goreParts(k), FAN_N * 2, { shadow: true });

  // rendezvous lidar on a tracking turret near the berthing ring
  const lp = V(Math.cos(Math.PI * 0.75) * 1.5, Math.sin(Math.PI * 0.75) * 1.5, -0.95);
  const ln = V(Math.cos(Math.PI * 0.75), Math.sin(Math.PI * 0.75), 0);
  if (!k.far) rod(k, b, 'metalDark', lp, lp.clone().addScaledVector(ln, 0.22), 0.06, { seg: 10 });
  tpl.pivot('lidarYaw', { position: lp.clone().addScaledVector(ln, 0.22), quaternion: new THREE.Quaternion().setFromUnitVectors(Y_AXIS, ln) });
  tpl.pivot('lidarPitch', { parent: 'lidarYaw', position: V(0, 0.1, 0) });
  const yb = k.on('lidarYaw'), pb = k.on('lidarPitch');
  if (!k.far) { rod(k, yb, 'paintWhite', V(0, 0, 0), V(0, 0.08, 0), 0.07, { seg: 12 }); for (const sx of [-1, 1]) block(k, yb, 'paintWhite', V(sx * 0.11, 0.1, 0), 0.03, 0.14, 0.08); }
  block(k, pb, 'paintWhite', V(0, 0, 0), 0.18, 0.13, 0.2, null, { bev: 0.02 });
  if (!k.far) { pb.add('lens', axial(new THREE.CircleGeometry(0.045, k.seg(14)), V(0.03, 0, 0.101), Z_AXIS), false); pb.add('lens', axial(new THREE.CircleGeometry(0.025, k.seg(10)), V(-0.05, 0.02, 0.101), Z_AXIS), false); }

  k.collider(C.capsule(V(0, 0, -1.1), V(0, 0, -4.9), PCM_R + 0.04, 'pcm'));
  k.collider(C.capsule(V(0, 0, -5.4), V(0, 0, -6.7), SM_R + 0.1, 'sm'));
  for (const sx of [-1, 1]) k.collider(C.box(V(sx * 3.85, 0.25, -6.0), V(FAN_R, 0.1, FAN_R), null, 'fan'));
  return { custom: unfurlFans, track: [{ yaw: 'lidarYaw', pitch: 'lidarPitch', limit: 1.2, park: [0, -0.4] }] };
}

/** UltraFlex fans: d 0 = every gore stacked in one folded wedge (aft), 1 = full 360° disc. */
function unfurlFans(rig, a) {
  const d = a.deploy, ease = d * d * (3 - 2 * d);
  const meshes = rig.inst.fan;
  const frames = FRAMES || (FRAMES = fanFrames());
  const step = (Math.PI * 2) / FAN_N;
  let idx = 0;
  for (let f = 0; f < frames.length; f++) {
    const F = frames[f], base = (f ? Math.PI / 2 : -Math.PI / 2) - step / 2;   // folded wedge points aft on both sides
    for (let i = 0; i < FAN_N; i++) {
      _r.makeRotationZ(base + i * step * ease);
      _t.makeTranslation(0, 0, (i - FAN_N / 2) * 0.006 * (1 - ease));
      _m.multiplyMatrices(F, _t).multiply(_r);
      for (const m of meshes) m.setMatrixAt(idx, _m);
      idx++;
    }
  }
  for (const m of meshes) m.instanceMatrix.needsUpdate = true;
}
let FRAMES = null;

export const CYGNUS = {
  type: 'cygnus', name: 'Лебедь', label: 'Грузовой корабль', size: 'large', length: 7.0, boundRadius: 6.2,
  mainAxis: Z_AXIS, upAxis: Y_AXIS, author: cygnusAuthor,
};
