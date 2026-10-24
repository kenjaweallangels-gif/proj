import * as THREE from 'three';
import { lathe, flange, boltCircle, boltRow, seam, rod, block, handrail, thruster, porthole, whip, lamp, beacon, solarPanelParts, axial, patch, connector, cable, vent, V, X_AXIS, Y_AXIS, Z_AXIS, LocalColliders as C } from '../Kit.js';

/**
 * Parts shared by the Soyuz MS- and Progress MS-class vehicles:
 *   serviceModule  – ПАО: transfer section, instrument compartment (ПрО) in quilted blankets, flared
 *                    aggregate compartment (АО) with radiators, DPO thruster blocks, main engine (СКД),
 *                    two four-panel accordion solar wings on yokes, whip antennas, nav lights
 *   kurs           – Kurs-NA rendezvous antennas: deployable boom with a tracking phased-array head,
 *                    two fold-out 2AO dipole antennas
 *   accordion      – wing deployment kinematics (root swing, then the panels unfold)
 */

const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1);
const SM_R = 1.36;   // АО radius (2.72 m)

/** Wing frame: local X along ship ±Z (hinge lines), local Y outward (span), local Z = ship +Y (cells). */
export function wingFrame(hinge, sx) {
  const xs = V(0, 0, sx), ys = V(sx, 0, 0), zs = new THREE.Vector3().crossVectors(xs, ys);
  return new THREE.Matrix4().makeBasis(xs, ys, zs).setPosition(hinge);
}

/**
 * Accordion solar wings: one InstancedMesh set `name` for all panels, a yoke pivot per wing.
 * wings = [{ frame: Matrix4 (wingFrame), n, len, width, yoke }]. Returns the spec for `foldWings`.
 */
export function accordionWings(k, name, wings, { thick = 0.035, cellUV = 3.2, yokeSurf = 'metalBare', cell = 'solar', back = 'solarBack' } = {}) {
  const tpl = k.tpl;
  const total = wings.reduce((a, w) => a + w.n, 0);
  const w0 = wings[0];
  wings.forEach((w, i) => {
    const pos = new THREE.Vector3(), q = new THREE.Quaternion();
    w.frame.decompose(pos, q, new THREE.Vector3());
    tpl.pivot(`${name}Yoke${i}`, { position: pos, quaternion: q });
    const b = k.on(`${name}Yoke${i}`);
    // yoke: hinge block, two converging tubes, root cross-bar with hinge knuckles
    if (!k.far) {
      block(k, b, 'metalDark', V(0, 0.0, 0), 0.22, 0.12, 0.16, null, { bev: 0.015 });
      rod(k, b, 'metalDark', V(-0.09, -0.02, 0), V(0.09, -0.02, 0), 0.035, { seg: 10 });
    }
    for (const sx of [-1, 1]) rod(k, b, yokeSurf, V(sx * 0.05, 0.05, 0), V(sx * w.width * 0.36, w.yoke, 0), 0.02, { seg: 8 });
    rod(k, b, yokeSurf, V(-w.width * 0.45, w.yoke, 0), V(w.width * 0.45, w.yoke, 0), 0.022, { seg: 8 });
    if (k.near) {
      rod(k, b, 'metalBare', V(0, 0.06, 0), V(0, w.yoke, 0), 0.012, { seg: 6 });
      for (const sx of [-1, 1]) block(k, b, 'metalDark', V(sx * w.width * 0.32, w.yoke, 0), 0.08, 0.06, 0.06, null, { bev: 0.01 });
      // harness running along the yoke
      rod(k, b, 'cable', V(0.04, 0.05, 0.03), V(0.04, w.yoke - 0.03, 0.03), 0.008, { seg: 5 });
    }
  });
  k.instanced(name, solarPanelParts(k, w0.width, w0.len, { t: thick * 0.8, cellUV, cell, back }), total, { shadow: true });
  return { name, wings: wings.map((w, i) => ({ ...w, yokePivot: `${name}Yoke${i}` })), thick, total };
}

const _a = new THREE.Matrix4(), _t = new THREE.Matrix4(), _r = new THREE.Matrix4();
/**
 * Pose the wings for deployment d (0 stowed .. 1 deployed): the yoke swings out first (0..0.35), then the
 * accordion unfolds (0.3..1). Writes the yoke pivot rotations and every level's instance matrices.
 */
export function foldWings(rig, spec, d) {
  const sm = (x) => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
  const theta = (Math.PI / 2) * (1 - sm(d / 0.35));
  const phi = Math.PI * (1 - sm((d - 0.3) / 0.7)) * 0.985;
  const meshes = rig.inst[spec.name];
  let idx = 0;
  for (const w of spec.wings) {
    const yp = rig.pivots[w.yokePivot];
    yp.rotation.x = theta;          // the mount carries the wing frame
    _a.copy(w.frame).multiply(_r.makeRotationX(theta)).multiply(_t.makeTranslation(0, w.yoke, 0));
    for (let j = 0; j < w.n; j++) {
      if (j > 0) {
        const s = j % 2 ? 1 : -1, t = spec.thick;
        _a.multiply(_t.makeTranslation(0, w.len, -s * t / 2)).multiply(_r.makeRotationX(s * phi)).multiply(_t.makeTranslation(0, 0, s * t / 2));
      }
      for (const m of meshes) m.setMatrixAt(idx, _a);
      idx++;
    }
  }
  for (const m of meshes) m.instanceMatrix.needsUpdate = true;
}

/**
 * ПАО service module from z0 (forward end, transfer section) aft. Returns { aft, wings }.
 * The forward end (z0) meets the descent module heat shield (Soyuz) or the refuelling compartment (Progress).
 */
export function serviceModule(k, z0) {
  const b = k.b;
  const zT = z0 - 0.28, zI = zT - 0.6, zS = zI - 0.3, zA = zS - 0.95;   // transfer / instrument / skirt / aft
  // transfer compartment (ПхО): open lattice ring with dark interior, umbrella-shaped radiator
  lathe(k, b, 'mliDark', [[1.02, zT], [1.02, z0]], { seg: 48 });
  if (!k.far) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2, a2 = a + Math.PI / 12;
      rod(k, b, 'metalBare', V(Math.cos(a) * 1.07, Math.sin(a) * 1.07, zT + 0.02), V(Math.cos(a2) * 1.07, Math.sin(a2) * 1.07, z0 - 0.02), 0.014, { seg: 5 });
    }
    flange(k, b, z0 - 0.015, 1.02, { h: 0.07, w: 0.03, bolts: 32, surf: 'metalBare' });
  }
  flange(k, b, zT, 1.04, { h: 0.06, w: 0.05, bolts: 32 });
  // instrument compartment (ПрО): quilted blanket cylinder with a tie-down band and seams
  lathe(k, b, 'blanketGreen', [[1.1, zI], [1.115, zI + 0.04], [1.115, zT - 0.04], [1.1, zT]], { seg: 64, uv: 1.8, relief: { depth: 0.013, sub: 3 } });
  seam(k, b, (zI + zT) / 2, 1.118, { surf: 'metalBare', t: 0.008 });
  // flared skirt to the aggregate compartment and its radiator cylinder
  lathe(k, b, 'blanketGreen', [[SM_R, zS], [SM_R - 0.02, zS + 0.03], [1.12, zI - 0.02], [1.1, zI]], { seg: 64, uv: 1.8, relief: { depth: 0.013, sub: 3 } });
  flange(k, b, zI, 1.1, { h: 0.04, w: 0.04, bolts: 36 });
  lathe(k, b, 'radiator', [[SM_R, zA + 0.06], [SM_R + 0.012, zA + 0.1], [SM_R + 0.012, zS - 0.04], [SM_R, zS]], { seg: 72, uv: 1.6 });
  for (const z of [zS - 0.02, zA + 0.38, zA + 0.04]) flange(k, b, z, SM_R, { h: 0.035, w: 0.05, bolts: z === zS - 0.02 ? 48 : 0 });
  // aft bulkhead: blanketed dome with the engine mount
  lathe(k, b, 'mliDark', [[0.32, zA - 0.22], [0.9, zA - 0.16], [1.25, zA - 0.06], [SM_R + 0.01, zA + 0.04]], { seg: 56 });
  flange(k, b, zA - 0.2, 0.32, { h: 0.06, w: 0.06, bolts: 16, face: -1 });
  // main engine (СКД) + two backup-loop nozzles
  thruster(k, b, V(0, 0, zA - 0.22), V(0, 0, -1), 0.21, { main: true, bell: 2.6 });
  for (const sx of [-1, 1]) thruster(k, b, V(sx * 0.62, 0.25, zA - 0.16), V(0, 0, -1), 0.06, { bell: 2.2 });
  // DPO thruster blocks on the skirt (4 x: radial, two tangential, forward), aft DPO pairs (axial)
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + i * Math.PI / 2, r = SM_R + 0.02;
    const n = V(Math.cos(a), Math.sin(a), 0), t = V(-Math.sin(a), Math.cos(a), 0);
    const c = V(Math.cos(a) * r, Math.sin(a) * r, zA + 0.24);
    block(k, b, 'blanketGreen', c.clone().addScaledVector(n, 0.05), 0.26, 0.34, 0.12, new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(t, Z_AXIS, n)), { bev: 0.02, shadow: true });
    const f = c.clone().addScaledVector(n, 0.11);
    thruster(k, b, f.clone().addScaledVector(t, 0.0).addScaledVector(Z_AXIS, 0.04), n, 0.035);
    thruster(k, b, f.clone().addScaledVector(Z_AXIS, -0.09), n, 0.035);
    thruster(k, b, f.clone().addScaledVector(t, 0.13).addScaledVector(n, -0.04), t, 0.03);
    thruster(k, b, f.clone().addScaledVector(t, -0.13).addScaledVector(n, -0.04), t.clone().negate(), 0.03);
    thruster(k, b, f.clone().addScaledVector(Z_AXIS, 0.17).addScaledVector(n, -0.04), Z_AXIS, 0.03);
    // aft-facing pair on the bulkhead rim
    const pa = V(Math.cos(a + 0.2) * 1.12, Math.sin(a + 0.2) * 1.12, zA - 0.05);
    thruster(k, b, pa, V(0, 0, -1), 0.032);
    thruster(k, b, V(Math.cos(a - 0.2) * 1.12, Math.sin(a - 0.2) * 1.12, zA - 0.05), V(0, 0, -1), 0.032);
  }
  // small DPO-M on the instrument compartment (attitude), radial
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2, n = V(Math.cos(a), Math.sin(a), 0);
    thruster(k, b, V(Math.cos(a) * 1.13, Math.sin(a) * 1.13, zI + 0.12), n, 0.022);
  }
  // radiator ribs (coolant headers) over the aggregate compartment, sun sensors, connectors, harness
  if (!k.far) for (let i = 0; i < 16; i++) {
    const a = (i + 0.5) / 16 * Math.PI * 2;
    if (Math.abs(Math.cos(a)) > 0.97) continue;    // wing roots
    rod(k, b, 'paintWhite', V(Math.cos(a) * (SM_R + 0.02), Math.sin(a) * (SM_R + 0.02), zA + 0.1), V(Math.cos(a) * (SM_R + 0.02), Math.sin(a) * (SM_R + 0.02), zS - 0.06), 0.014, { seg: 5 });
  }
  for (const a of [Math.PI * 0.62, Math.PI * 1.38]) {
    const n = V(Math.cos(a), Math.sin(a), 0);
    block(k, b, 'blackAnod', n.clone().multiplyScalar(1.13).setZ(zI + 0.42), 0.09, 0.09, 0.06, null, { bev: 0.01 });
    connector(k, b, n.clone().multiplyScalar(1.115).setZ(zI + 0.25), n, { plugs: 2, w: 0.12 });
  }
  { const pts = []; for (let z = zT - 0.05; z >= zI + 0.05; z -= 0.15) pts.push(V(Math.cos(2.2) * 1.13, Math.sin(2.2) * 1.13, z)); cable(k, b, pts, 0.012); }
  vent(k, b, V(0, -SM_R - 0.01, zA + 0.85), V(0, -1, 0), 0.03);
  // whips, patch antennas, nav lights and strobes on the skirt
  whip(k, b, V(0, SM_R, zA + 0.7), V(0, 1, -0.4), 0.9);
  whip(k, b, V(0, -SM_R, zA + 0.7), V(0, -1, -0.4), 0.9);
  whip(k, b, V(0.85, 0.85, zI + 0.3), V(1, 1, 0.5), 0.55);
  if (!k.far) for (const a of [Math.PI * 0.25, Math.PI * 1.25]) block(k, b, 'paintWhite', V(Math.cos(a) * (SM_R + 0.02), Math.sin(a) * (SM_R + 0.02), zA + 0.62), 0.22, 0.22, 0.03, new THREE.Quaternion().setFromUnitVectors(Z_AXIS, V(Math.cos(a), Math.sin(a), 0)), { bev: 0.008 });
  beacon(k, b, V(-SM_R - 0.02, 0.32, zA + 0.55), V(-1, 0, 0), 'navRed');
  beacon(k, b, V(SM_R + 0.02, 0.32, zA + 0.55), V(1, 0, 0), 'navGreen');
  beacon(k, b, V(0, SM_R + 0.015, zA + 0.15), Y_AXIS, 'strobe', 0.045);
  beacon(k, b, V(0, -SM_R - 0.015, zA + 0.15), V(0, -1, 0), 'strobe', 0.045);
  // handrails on the instrument compartment
  for (const a of [Math.PI * 0.75, Math.PI * 1.75]) {
    const n = V(Math.cos(a), Math.sin(a), 0);
    handrail(k, b, V(Math.cos(a) * 1.115, Math.sin(a) * 1.115, zI + 0.1), V(Math.cos(a) * 1.115, Math.sin(a) * 1.115, zT - 0.1), n, { surf: 'metalBare' });
  }
  // two four-panel accordion wings on the aggregate compartment
  const zW = zA + 0.48;
  const wings = [-1, 1].map((sx) => ({ frame: wingFrame(V(sx * (SM_R + 0.09), 0, zW), sx), n: 4, len: 0.96, width: 1.12, yoke: 0.5 }));
  if (!k.far) for (const sx of [-1, 1]) block(k, b, 'metalDark', V(sx * (SM_R + 0.04), 0, zW), 0.1, 0.3, 0.36, null, { bev: 0.015 });
  const ws = accordionWings(k, 'wing', wings);
  k.collider(C.capsule(V(0, 0, zT), V(0, 0, zA - 0.2), SM_R + 0.02, 'pao'));
  for (const sx of [-1, 1]) k.collider(C.box(V(sx * (SM_R + 0.6 + 2.0), 0, zW), V(2.05, 0.1, 0.6), null, 'wing'));
  return { aft: zA - 0.22, wings: ws };
}

/**
 * Kurs-NA antennas around the front of the forward compartment: deployable boom (pivots kursBoom ->
 * kursYaw -> kursPitch) with the phased-array head, and two fold-out 2AO dipoles (ant2a / ant2b).
 * `at(a, z)` returns the hull surface point at angle a and z (for mounting).
 */
export function kurs(k, rAt, { zBoom = -0.75, aBoom = Math.PI * 0.62, zDip = -0.42 } = {}) {
  const tpl = k.tpl;
  const r0 = rAt(zBoom);
  const n = V(Math.cos(aBoom), Math.sin(aBoom), 0), t = V(-Math.sin(aBoom), Math.cos(aBoom), 0);
  // boom frame: X = tangential (hinge), Y = radial (boom when deployed), Z = -ship Z
  const base = V(Math.cos(aBoom) * (r0 + 0.05), Math.sin(aBoom) * (r0 + 0.05), zBoom);
  const fq = new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(t, n, V(0, 0, -1)));
  if (!k.far) {
    block(k, k.b, 'metalDark', base.clone().addScaledVector(n, -0.03), 0.2, 0.2, 0.08, new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(t, V(0, 0, 1), n)), { bev: 0.012 });
  }
  tpl.pivot('kursBoom', { position: base, quaternion: fq });
  const bb = k.on('kursBoom');
  rod(k, bb, 'paintWhite', V(0, 0, 0), V(0, 0.95, 0), 0.03, { seg: 10 });
  if (!k.far) { rod(k, bb, 'metalDark', V(-0.07, 0, 0), V(0.07, 0, 0), 0.04, { seg: 10 }); rod(k, bb, 'cable', V(0.035, 0.05, 0.02), V(0.035, 0.9, 0.02), 0.007, { seg: 5 }); }
  tpl.pivot('kursYaw', { parent: 'kursBoom', position: V(0, 0.98, 0) });
  tpl.pivot('kursPitch', { parent: 'kursYaw', position: V(0, 0.08, 0) });
  const hy = k.on('kursYaw');
  if (!k.far) lathe(k, hy, 'metalDark', [[0.05, -0.03], [0.05, 0.03]], { seg: 12, bev: 0 });
  if (!k.far) { const g = new THREE.CylinderGeometry(0.04, 0.05, 0.08, k.seg(12)); hy.add('metalDark', g.translate(0, 0.03, 0), false); }
  const hp = k.on('kursPitch');
  block(k, hp, 'paintWhite', V(0, 0.0, 0.0), 0.34, 0.08, 0.3, null, { bev: 0.015 });          // radome box, face toward +Z of the pitch frame
  if (!k.far) {
    block(k, hp, 'beta', V(0, 0.0, 0.152), 0.3, 0.06, 0.008, null, {});
    rod(k, hp, 'metalDark', V(-0.19, 0, 0), V(0.19, 0, 0), 0.02, { seg: 8 });
  }
  // 2AO dipoles: fold-out masts on both sides of the docking unit
  const dips = [];
  for (const [i, a] of [[0, Math.PI * 0.08], [1, Math.PI * 1.08]]) {
    const r = rAt(zDip), nn = V(Math.cos(a), Math.sin(a), 0), tt = V(-Math.sin(a), Math.cos(a), 0);
    const p = V(Math.cos(a) * r, Math.sin(a) * r, zDip);
    const name = `ant2${i ? 'b' : 'a'}`;
    tpl.pivot(name, { position: p, quaternion: new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(tt, nn, new THREE.Vector3().crossVectors(tt, nn))) });
    const db = k.on(name);
    rod(k, db, 'paintWhite', V(0, 0, 0), V(0, 0.42, 0), 0.016, { seg: 8 });
    if (!k.far) {
      rod(k, db, 'metalDark', V(-0.05, 0, 0), V(0.05, 0, 0), 0.025, { seg: 8 });
      for (const d of [V(1, 0, 0), V(0, 0, 1)]) rod(k, db, 'metalBare', V(0, 0.42, 0).addScaledVector(d, -0.17), V(0, 0.42, 0).addScaledVector(d, 0.17), 0.008, { seg: 5 });
      if (k.near) { const g = new THREE.SphereGeometry(0.025, 8, 6); db.add('paintWhite', g.translate(0, 0.42, 0), false); }
    }
    dips.push(name);
  }
  k.collider(C.sphere(base.clone().addScaledVector(n, 0.6), 0.45, 'kurs'));
  return {
    hinges: [{ pivot: 'kursBoom', axis: 'x', from: Math.PI / 2, to: 0, channel: 'antenna', range: [0, 0.7] },
      ...dips.map((d) => ({ pivot: d, axis: 'x', from: 1.4, to: 0, channel: 'antenna', range: [0.4, 1] }))],
    track: [{ yaw: 'kursYaw', pitch: 'kursPitch', limit: 1.3, park: [Math.PI, 0] }],
  };
}

/** Russian tricolour band + markings plate on a cylinder at angle a (flat blocks following the surface). */
export function flag(k, b, r, a, z, w = 0.42, h = 0.27) {
  if (k.far) return;
  const n = V(Math.cos(a), Math.sin(a), 0), t = V(-Math.sin(a), Math.cos(a), 0);
  const q = new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(t, Z_AXIS, n));
  const c = V(Math.cos(a) * (r + 0.004), Math.sin(a) * (r + 0.004), z);
  block(k, b, 'paintWhite', c.clone().addScaledVector(Z_AXIS, h / 3), w, h / 3, 0.004, q, { uv: false });
  block(k, b, 'paintBlue', c.clone(), w, h / 3, 0.004, q, { uv: false });
  block(k, b, 'paintRed', c.clone().addScaledVector(Z_AXIS, -h / 3), w, h / 3, 0.004, q, { uv: false });
}

export { SM_R };
