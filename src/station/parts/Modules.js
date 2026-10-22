import * as THREE from 'three';
import { LAYOUT } from './Layout.js';
import { HullFrame, Instancer, boxAt, tubeAt, torusAt, sphereAt, mat, scaleUV, Colliders, X_AXIS, Y_AXIS, Z_AXIS, TEX_M } from './Builder.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const CY = LAYOUT.clusterY;
const ROT_X90 = new THREE.Matrix4().makeRotationX(Math.PI / 2);

/** Apply a feature-local matrix then the hull surface matrix. */
function at(geo, surface, local = null) { if (local) geo.applyMatrix4(local); return geo.applyMatrix4(surface); }

/**
 * Pressurised module cluster: cylindrical modules, nodes, cupola, greenhouse, hull details
 * (MLI, shields, seams, windows, hatches, antennas, thrusters, plumbing, cameras, labels).
 * Returns { colliders, hulls, nodes, hubFrame } for the docking / airlock builders.
 */
export function buildModules(ctx, station, b, rails) {
  const m = ctx.materials;
  const colliders = [];
  const hulls = {};
  const shields = new Instancer(new THREE.BoxGeometry(1, 1, 1), m.get('hullWhiteAged'), { name: 'shieldPanels', shadow: false });
  const bolts = new Instancer(new THREE.CylinderGeometry(1, 1, 1, 6), m.get('metalDark'), { name: 'studs', shadow: false });
  const growGlow = m.get('windowGlow').clone(); growGlow.emissive.set(0xff6fb0); growGlow.emissiveIntensity = 3.0; growGlow.name = 'growGlow';
  const cupolaGlow = m.get('windowGlow').clone(); cupolaGlow.emissiveIntensity = 0.7; cupolaGlow.name = 'cupolaGlow';

  // ---------- generic module ----------
  function module({ name, label, center, dir, r, len, hull = 'hullWhite', mli = [], shieldRows = 0, shieldFrom = 0, windows = [], railAngles = [0.8, 2.4, 4.0, 5.5], seams = 2.2, capA = 'cone', capB = 'cone', labelSides = true, labelT = 0, labelW = null, labelDirs = null }) {
    const H = new HullFrame(center, dir, r, len, name);
    hulls[name] = H;
    // main hull cylinder (open ended, caps added separately)
    b.add(hull, tubeAt(H.center, H.dir, r, len, 48, { open: true }));
    // end caps: truncated cones with a hatch ring and MLI collar
    for (const [end, kind] of [[-1, capA], [1, capB]]) {
      const c = H.axisPoint(end * (len / 2 + 0.45)), d = _v.copy(H.dir).multiplyScalar(end);
      if (kind === 'cone') {
        b.add('mliBlack', tubeAt(c, d, r * 0.62, 0.9, 48, { rTop: r }));
        b.add('hullWhite', tubeAt(H.axisPoint(end * (len / 2 + 0.92)), d, r * 0.62, 0.06, 48));
        b.add('metalDark', torusAt(H.axisPoint(end * (len / 2 + 0.95)), d, 0.75, 0.07, 8, 32), false);
        b.add('hullWhiteAged', tubeAt(H.axisPoint(end * (len / 2 + 0.96)), d, 0.7, 0.05, 24), false);
      } else if (kind === 'flat') {
        b.add('hullWhite', tubeAt(c, d, r, 0.3, 48));
      }
      // MLI collar + seam ring at the cylinder/cap junction
      b.add('mliSilver', tubeAt(H.axisPoint(end * (len / 2 - 0.35)), H.dir, r + 0.05, 0.7, 48));
      b.add('metalDark', torusAt(H.axisPoint(end * len / 2), H.dir, r + 0.03, 0.06, 6, 48), false);
    }
    // circumferential seam rings
    for (let t = -len / 2 + seams; t < len / 2 - 0.5; t += seams) b.add('metalDark', torusAt(H.axisPoint(t), H.dir, r + 0.015, 0.035, 5, 48), false);
    // MLI sections (gold / silver bands slightly proud of the hull)
    for (const s of mli) b.add(s.mat, tubeAt(H.axisPoint((s.from + s.to) / 2), H.dir, r + 0.06, s.to - s.from, 48));
    // micrometeoroid shield panels (standoff boxes) on the central section
    if (shieldRows > 0) {
      const around = Math.round((2 * Math.PI * r) / 1.05);
      const pw = (2 * Math.PI * r) / around - 0.08, ph = 1.7;
      for (let row = 0; row < shieldRows; row++) {
        const t = shieldFrom + row * (ph + 0.12) + ph / 2;
        for (let k = 0; k < around; k++) {
          const th = (k + 0.5 * (row % 2)) / around * Math.PI * 2;
          shields.add(H.surface(t, th, r + 0.09, _m).multiply(_m2.makeScale(pw, 0.05, ph)));
          bolts.add(H.surface(t - ph / 2 + 0.12, th, r + 0.11, _m).multiply(_m2.makeScale(0.03, 0.03, 0.03)));
          bolts.add(H.surface(t + ph / 2 - 0.12, th, r + 0.11, _m).multiply(_m2.makeScale(0.03, 0.03, 0.03)));
        }
      }
    }
    // portholes
    for (const w of windows) addWindow(H, w.t, w.theta, w.r ?? 0.32);
    // handrails: 4 lines along + rings at both ends
    for (const a of railAngles) rails.addAlongHull(H, a, -len / 2 + 1.0, len / 2 - 1.0, 1.2, 0.35, shieldRows > 0 ? r + 0.14 : r);
    rails.addAroundHull(H, -len / 2 + 0.5, 8, 0.9, 0.35);
    rails.addAroundHull(H, len / 2 - 0.5, 8, 0.9, 0.35);
    // name labels on both sides (slightly above the equator, tilted up)
    if (label && labelSides) {
      const w = labelW ?? Math.min(len - 2.5, 7.5), hgt = w / 8;
      const sideDir = new THREE.Vector3().crossVectors(H.dir, Y_AXIS);
      const dirs = labelDirs ?? [1, -1].map((side) => sideDir.clone().multiplyScalar(side).addScaledVector(Y_AXIS, 0.15).normalize());
      for (const n of dirs) b.labelAt(label, w, hgt, H.axisPoint(labelT).addScaledVector(n, r + (shieldRows > 0 ? 0.17 : 0.05)), n);
    }
    // collider (capsule covers hull + shields + caps)
    colliders.push(Colliders.capsule(H.axisPoint(-len / 2 - 0.5), H.axisPoint(len / 2 + 0.5), r + 0.12, name));
    return H;
  }

  function addWindow(H, t, theta, wr = 0.32) {
    const s = H.surface(t, theta, H.r, new THREE.Matrix4());
    b.add('metalDark', at(torusAt(V(0, 0.02, 0), Y_AXIS, wr + 0.06, 0.05, 6, 24), s), false);
    b.add('windowGlow', at(new THREE.CylinderGeometry(wr, wr, 0.04, 24).translate(0, -0.1, 0), s), false);
    b.add('glass', at(new THREE.CylinderGeometry(wr, wr, 0.02, 24).translate(0, 0.01, 0), s), false);
  }

  /** Node: short fat cylinder with four radial port stubs. */
  function node({ name, label, x, r = 2.45, len = 5, stubs = ['+y', '-y', '+z', '-z'] }) {
    const H = module({ name, label, center: V(x, CY, 0), dir: X_AXIS, r, len, hull: 'hullWhiteAged', mli: [], capA: 'cone', capB: 'cone', railAngles: [0.6, 2.2, 4.1, 5.7], seams: 10, labelSides: false });
    const dirs = { '+y': Y_AXIS, '-y': V(0, -1, 0), '+z': Z_AXIS, '-z': V(0, 0, -1) };
    for (const s of stubs) {
      const d = dirs[s];
      b.add('hullWhite', tubeAt(V(x, CY, 0).addScaledVector(d, r - 0.4), d, 1.35, 1.9, 32));
      b.add('metalDark', torusAt(V(x, CY, 0).addScaledVector(d, r + 0.5), d, 1.37, 0.07, 6, 32), false);
      b.add('mliBlack', tubeAt(V(x, CY, 0).addScaledVector(d, r + 0.1), d, 1.42, 0.6, 32));
    }
    // label as a small plate on the +Z / -Z sides
    if (label) for (const side of [1, -1]) { const n = V(0, 0.72, 0.69 * side).normalize(); b.labelAt(label, 2.2, 0.46, V(x, CY, 0).addScaledVector(n, r + 0.05), n, { width: 512 }); }
    // GPS patch antennas + small cameras on top of the node
    b.add('antennaWhite', tubeAt(V(x + 1.6, CY + r + 0.15, 1.2), Y_AXIS, 0.16, 0.3, 12, { uv: false }), false);
    b.add('antennaWhite', tubeAt(V(x + 1.6, CY + r + 0.15, -1.2), Y_AXIS, 0.16, 0.3, 12, { uv: false }), false);
    addCamera(V(x - 1.7, CY + r + 0.05, 1.5), V(0.4, 1, 0.6));
    return H;
  }

  function addCamera(base, lookDir) {
    const d = _v.copy(lookDir).normalize();
    b.add('metalDark', tubeAt(base.clone().addScaledVector(d, 0.25), d, 0.05, 0.5, 6, { uv: false }), false);
    const c = base.clone().addScaledVector(d, 0.55);
    b.add('rubberBlack', boxAt(c, 0.32, 0.26, 0.26, _q.setFromUnitVectors(X_AXIS, d), false), false);
    b.add('metalBare', tubeAt(c.clone().addScaledVector(d, 0.22), d, 0.08, 0.14, 12, { uv: false }), false);
  }

  /** RCS thruster quad: base block + 4 nozzles pointing along the given directions. */
  function addRcsPod(center, mount, dirs) {
    const q = _q.setFromUnitVectors(Y_AXIS, mount);
    b.add('mliBlack', boxAt(center, 0.9, 0.6, 0.9, q), false);
    b.add('hazard', boxAt(center.clone().addScaledVector(mount, 0.31), 0.95, 0.04, 0.95, q, false), false);
    for (const d of dirs) {
      const dd = _v2.copy(d).normalize();
      const c = center.clone().addScaledVector(mount, 0.15).addScaledVector(dd, 0.55);
      b.add('metalDark', tubeAt(c, dd, 0.07, 0.45, 12, { rTop: 0.18, uv: false }), false);
      b.add('metalDark', tubeAt(center.clone().addScaledVector(mount, 0.15).addScaledVector(dd, 0.3), dd, 0.07, 0.3, 8, { uv: false }), false);
    }
  }

  // ---------- the cluster ----------
  const logi = module({ name: 'logistics', label: 'ЛАРЕЦ', center: V(-25.5, CY, 0), dir: X_AXIS, r: 2.3, len: 9, hull: 'hullWhiteAged', mli: [{ from: -3.9, to: -1.2, mat: 'mliGold' }, { from: 1.5, to: 3.2, mat: 'mliSilver' }], windows: [{ t: 0, theta: 0, r: 0.25 }], capA: 'cone', labelT: 0.15, labelW: 2.4 });
  const n1 = node({ name: 'node1', label: 'УЗЕЛ-1', x: -18.5 });
  const lab = module({ name: 'lab', label: 'ИСТОК', center: V(-9, CY, 0), dir: X_AXIS, r: 2.3, len: 14, mli: [{ from: -6.4, to: -4.0, mat: 'mliGold' }, { from: 4.2, to: 6.3, mat: 'mliGold' }], shieldRows: 4, shieldFrom: -3.7, windows: [{ t: -1.5, theta: 0 }, { t: 1.5, theta: 0 }, { t: 0, theta: Math.PI / 2 }] });
  const n2 = node({ name: 'node2', label: 'УЗЕЛ-2', x: 0.5 });
  const hab2 = module({ name: 'hab2', label: 'МЕРИДИАН', center: V(9, CY, 0), dir: X_AXIS, r: 2.6, len: 12, mli: [{ from: -5.3, to: -3.4, mat: 'mliSilver' }], shieldRows: 3, shieldFrom: -2.8, windows: [{ t: -1.2, theta: 0 }, { t: 1.2, theta: 0 }, { t: 0, theta: Math.PI / 2 }, { t: 0, theta: -Math.PI / 2 }], labelT: 4.4, labelW: 3.0 });
  const n3 = node({ name: 'node3', label: 'УЗЕЛ-3', x: 17.5 });
  const power = module({ name: 'service', label: 'ВЕКТОР', center: V(27, CY, 0), dir: X_AXIS, r: 2.6, len: 14, hull: 'hullWhiteAged', mli: [{ from: -6.3, to: -2.0, mat: 'mliGold' }, { from: 2.0, to: 6.3, mat: 'mliGold' }], windows: [{ t: 0, theta: 0, r: 0.25 }], capB: 'flat', labelW: 3.8 });
  const hab1 = module({ name: 'hab1', label: 'ГОРИЗОНТ', center: V(0.5, CY, 7.45), dir: Z_AXIS, r: 2.3, len: 10, mli: [{ from: -4.3, to: -2.6, mat: 'mliSilver' }], shieldRows: 2, shieldFrom: -1.8, windows: [{ t: -1.0, theta: Math.PI / 2 }, { t: 1.0, theta: Math.PI / 2 }, { t: 0, theta: Math.PI }], capA: 'flat', capB: 'cone', labelT: 3.4, labelW: 3.0 });
  const green = module({ name: 'greenhouse', label: 'ФЛОРА', center: V(0.5, CY, -8.45), dir: V(0, 0, -1), r: 2.3, len: 12, mli: [{ from: -5.3, to: -4.0, mat: 'mliSilver' }, { from: 4.0, to: 5.3, mat: 'mliSilver' }], railAngles: [1.1, 2.0, 4.3, 5.2], capA: 'flat', capB: 'cone', labelW: 3.2, labelDirs: [V(0.35, -1, 0).normalize(), V(-0.35, -1, 0).normalize()] });
  const med = module({ name: 'medical', label: 'ПУЛЬС', center: V(17.5, CY, 6.45), dir: Z_AXIS, r: 2.1, len: 8, mli: [{ from: -3.3, to: -2.0, mat: 'mliGold' }], windows: [{ t: 0.5, theta: Math.PI / 2 }], capA: 'flat', capB: 'cone', labelT: 1.0, labelW: 3.0 });
  const stow = module({ name: 'stowage', label: null, center: V(17.5, CY - 4.0, 0), dir: V(0, -1, 0), r: 1.5, len: 3.2, hull: 'hullWhiteAged', mli: [{ from: -1.0, to: 0.8, mat: 'mliBlack' }], railAngles: [1.0, 4.0], capA: 'flat', capB: 'cone' });

  // greenhouse long windows: three strips (zenith, +X, -X) with pink grow-light glow
  for (const dir of [Y_AXIS, X_AXIS, V(-1, 0, 0)]) {
    const th = green.thetaFor(dir);
    const s = green.surface(0.4, th, green.r, new THREE.Matrix4());
    b.add('metalDark', at(new THREE.BoxGeometry(0.9, 0.08, 9.2).translate(0, 0.02, 0), s), false);
    b.add('windowGlow', at(new THREE.BoxGeometry(0.7, 0.06, 9.0).translate(0, -0.03, 0), s), false, growGlow);
    b.add('glass', at(new THREE.BoxGeometry(0.72, 0.02, 9.0).translate(0, 0.07, 0), s), false);
    for (let t = -4.0; t <= 4.0; t += 1.0) b.add('metalDark', at(new THREE.BoxGeometry(0.9, 0.1, 0.08).translate(0, 0.03, t), s), false);
  }

  // cupola on node-1 nadir: base, hexagonal frustum of 7 windows, frame beams, inner glow
  {
    const cx = n1.center.x, top = CY - 2.45;
    b.add('hullWhite', tubeAt(V(cx, top - 0.5, 0), Y_AXIS, 1.55, 1.0, 32));
    b.add('metalDark', torusAt(V(cx, top - 1.0, 0), Y_AXIS, 1.55, 0.08, 8, 32), false);
    const frust = (rt, rb, h, y, open) => new THREE.CylinderGeometry(rt, rb, h, 6, 1, open).translate(cx, y, 0);
    b.add('windowGlow', frust(0.78, 1.42, 0.95, top - 1.5, false), false, cupolaGlow);
    b.add('glass', frust(0.86, 1.5, 0.95, top - 1.5, true), false);
    b.add('glass', new THREE.CylinderGeometry(0.8, 0.8, 0.03, 6).translate(cx, top - 1.99, 0), false);
    b.add('metalDark', torusAt(V(cx, top - 1.98, 0), Y_AXIS, 0.84, 0.07, 6, 6), false);
    b.add('metalDark', torusAt(V(cx, top - 1.02, 0), Y_AXIS, 1.52, 0.08, 6, 6), false);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
      const p0 = V(cx + 1.5 * Math.cos(a), top - 1.02, 1.5 * Math.sin(a)), p1 = V(cx + 0.86 * Math.cos(a), top - 1.98, 0.86 * Math.sin(a));
      const mid = p0.clone().lerp(p1, 0.5), d = p1.clone().sub(p0);
      b.add('metalDark', boxAt(mid, 0.12, d.length(), 0.12, _q.setFromUnitVectors(Y_AXIS, d.normalize()), false), false);
    }
    // window shutters (open) around the cupola
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      b.add('hullWhiteAged', boxAt(V(cx + 1.75 * Math.cos(a), top - 1.45, 1.75 * Math.sin(a)), 0.9, 1.0, 0.06, _q.setFromAxisAngle(Y_AXIS, -a + Math.PI / 2), false), false);
    }
    colliders.push(Colliders.sphere(V(cx, top - 1.3, 0), 1.9, 'cupola'));
  }

  // main pylons from node-2 and the hub to the truss; strut quads at node-1 / node-3
  const truBot = -LAYOUT.spineSize / 2;
  for (const x of [n2.center.x, LAYOUT.hubX]) {
    b.add('truss', tubeAt(V(x, (truBot + CY + 2.4) / 2, 0), Y_AXIS, 1.1, truBot - (CY + 2.4), 24));
    b.add('hazard', tubeAt(V(x, CY + 2.9, 0), Y_AXIS, 1.13, 0.5, 24, { uv: false }), false);
    b.add('metalDark', torusAt(V(x, truBot - 0.05, 0), Y_AXIS, 1.2, 0.1, 6, 24), false);
    colliders.push(Colliders.capsule(V(x, CY + 2.0, 0), V(x, truBot, 0), 1.15, 'pylon'));
  }
  for (const x of [n1.center.x, n3.center.x]) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const a = V(x + sx * 2.0, truBot, sz * 2.25), c = V(x, CY + 2.2, 0);
      b.add('metalDark', tubeAt(a.clone().lerp(c, 0.5), c.clone().sub(a).normalize(), 0.12, a.distanceTo(c), 8, { uv: false }));
      colliders.push(Colliders.capsule(a, c, 0.15, 'strut'));
    }
  }

  // exposed plumbing (coolant lines) along the lab and service module tops
  for (const [H, len] of [[lab, 8], [power, 9]]) {
    const th = H.thetaFor(Y_AXIS);
    for (const [k, matName] of [[-0.45, 'metalBare'], [-0.15, 'copper'], [0.15, 'metalBare'], [0.45, 'copper']]) {
      const s = H.surface(0, th + k / H.r, H.r + 0.16, new THREE.Matrix4());
      b.add(matName, at(new THREE.CylinderGeometry(0.05, 0.05, len, 8).rotateX(Math.PI / 2), s), false);
      for (const e of [-1, 1]) b.add(matName, at(new THREE.SphereGeometry(0.07, 8, 6).translate(0, 0, e * len / 2), s), false);
    }
    for (let t = -len / 2 + 0.6; t < len / 2; t += 1.6) b.add('metalDark', at(new THREE.BoxGeometry(1.2, 0.3, 0.14).translate(0, 0.05, t), H.surface(0, th, H.r + 0.05, new THREE.Matrix4())), false);
  }

  // RCS pods: aft of logistics (4) and on the service module (4), plus two reboost engines aft
  for (const [th, dirs] of [[0, [Y_AXIS, X_AXIS]], [Math.PI, [V(0, -1, 0), X_AXIS]], [Math.PI / 2, [Z_AXIS, X_AXIS]], [-Math.PI / 2, [V(0, 0, -1), X_AXIS]]]) {
    const thl = logi.thetaFor(dirs[0]);
    addRcsPod(logi.point(-3.0, thl, logi.r + 0.3), logi.normal(thl), [dirs[0], V(-1, 0, 0), V(1, 0, 0)]);
    const thp = power.thetaFor(dirs[0]);
    addRcsPod(power.point(5.5, thp, power.r + 0.3), power.normal(thp), [dirs[0], V(1, 0, 0)]);
  }
  for (const z of [-1.1, 1.1]) {
    const c = V(logi.center.x - logi.len / 2 - 1.2, CY, z);
    b.add('metalDark', tubeAt(c, V(-1, 0, 0), 0.22, 1.1, 20, { rTop: 0.55, uv: false }));
    b.add('metalDark', tubeAt(V(c.x + 0.7, CY, z), X_AXIS, 0.2, 0.4, 12, { uv: false }), false);
    b.add('mliSilver', torusAt(V(c.x + 0.4, CY, z), X_AXIS, 0.32, 0.1, 6, 16), false);
  }
  b.label('ОПАСНО · DANGER', 2.4, 0.3, mat(logi.center.x - 3.0, CY + logi.r + 0.42, -0.9, _q.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0))), { width: 1024, color: '#b01818' });
  b.labelAt(`${LAYOUT.stationName} · ${LAYOUT.stationNameLatin}`, 7.4, 0.92, V(hab2.center.x - 0.4, CY + 0.35, hab2.r + 0.17), Z_AXIS, { width: 1024 });
  b.labelAt(`${LAYOUT.stationName} · ${LAYOUT.stationNameLatin}`, 7.4, 0.92, V(hab2.center.x - 0.4, CY + 0.35, -(hab2.r + 0.17)), V(0, 0, -1), { width: 1024 });

  // whip antennas and a UHF cross on the service module, patch antennas on habs
  for (const [t, th] of [[-5, 0.9], [-5, -0.9]]) {
    const p = power.point(t, power.thetaFor(Y_AXIS) + th, power.r), n = power.normal(power.thetaFor(Y_AXIS) + th);
    b.add('antennaWhite', tubeAt(p.clone().addScaledVector(n, 1.3), n, 0.025, 2.6, 6, { uv: false }), false);
    b.add('metalDark', tubeAt(p.clone().addScaledVector(n, 0.15), n, 0.08, 0.3, 8, { uv: false }), false);
  }
  for (const H of [hab2, hab1]) {
    const th = H.thetaFor(Y_AXIS);
    b.add('paintGray', at(new THREE.BoxGeometry(0.5, 0.08, 0.5).translate(0, 0.04, 0), H.surface(-2.5, th, H.r, new THREE.Matrix4())), false);
    b.add('metalBare', at(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 6).translate(0, 0.45, 0), H.surface(3.0, th, H.r, new THREE.Matrix4())), false);
    b.add('antennaWhite', at(new THREE.SphereGeometry(0.12, 8, 6).translate(0, 0.95, 0), H.surface(3.0, th, H.r, new THREE.Matrix4())), false);
  }
  // cameras around the cluster
  addCamera(V(hab1.center.x + 2.2, CY + 1.2, 12.0), V(0.3, -0.3, 1));
  addCamera(V(power.center.x + 6.0, CY + 2.5, 1.2), V(1, 0.6, 0.3));
  addCamera(V(green.center.x - 2.2, CY + 1.0, -13.0), V(-0.3, 0.2, -1));

  shields.build(station);
  bolts.build(station);
  return { colliders, hulls, nodes: { n1, n2, n3 }, power, logi, hab1, green, med, growGlow };
}
