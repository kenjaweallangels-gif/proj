import * as THREE from 'three';
import { LAYOUT } from './Layout.js';
import { HullFrame, Instancer, boxAt, bevelBoxAt, tubeAt, torusAt, latheAt, plate, sphereAt, mat, scaleUV, Colliders, X_AXIS, Y_AXIS, Z_AXIS, TEX_M } from './Builder.js';
import { COL, boltCircle, radialBolts, boltRow, wif, latch, connectorPanel, vent, pClamp } from './Detail.js';
import { endProfile, endFlange, weldLand, mliBand, shieldPanels, windowBolts, hullWif, hullConnectors, hullVent, conformSlab } from './HullKit.js';
import { cameraAssembly, frameYZ } from './Hardware.js';

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
  const D = b.detail;     // close-range hardware (null on 'lite')
  const colliders = [];
  const hulls = {};
  const shields = new Instancer(new THREE.BoxGeometry(1, 1, 1), m.get('hullWhiteAged'), { name: 'shieldPanels', shadow: false });
  const bolts = new Instancer(new THREE.CylinderGeometry(1, 1, 1, 6), m.get('metalDark'), { name: 'studs', shadow: false });
  const growGlow = m.get('windowGlow').clone(); growGlow.emissive.set(0xff6fb0); growGlow.emissiveIntensity = 3.0; growGlow.name = 'growGlow';
  const cupolaGlow = m.get('windowGlow').clone(); cupolaGlow.emissiveIntensity = 0.7; cupolaGlow.name = 'cupolaGlow';

  // ---------- generic module ----------
  function module({ name, label, center, dir, r, len, hull = 'hullWhite', mli = [], shieldRows = 0, shieldFrom = 0, windows = [], railAngles = [0.8, 2.4, 4.0, 5.5], seams = 2.2, capA = 'cone', capB = 'cone', labelSides = true, labelT = 0, labelW = null, labelDirs = null, berth = [true, true], extras = [], vestibule = false, noStep = true }) {
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
      // MLI collar + seam ring at the cylinder/cap junction (GPU presets: bolted flange / berthing joint)
      b.add('mliSilver', tubeAt(H.axisPoint(end * (len / 2 - 0.35)), H.dir, r + 0.05, 0.7, 48));
      if (D) {
        endFlange(b, D, H, end, { berth: berth[end < 0 ? 0 : 1] });
        if (kind === 'flat' && berth[end < 0 ? 0 : 1]) {
          // berthing skirt from the cylinder end out to the bulkhead (closes the gap), MLI-wrapped vestibule beyond
          const c = H.axisPoint(end * len / 2);
          b.add('hullWhiteAged', latheAt(c, H.dir, endProfile(end, [[r - 0.06, 0.0], [r + 0.03, 0.025], [r + 0.03, 0.56], [r - 0.12, 0.62]]), 64));
          b.add('metalDark', latheAt(H.axisPoint(end * (len / 2 + 0.3)), H.dir, [[r + 0.025, -0.03], [r + 0.045, -0.02], [r + 0.045, 0.02], [r + 0.025, 0.03]], 64), false);
          if (vestibule) b.add('mliSilver', tubeAt(H.axisPoint(end * (len / 2 + 1.35)), H.dir, r * 0.86, 1.5, 40));
          const n = Math.round((2 * Math.PI * r) / 0.2);
          for (let k = 0; k < n; k++) for (const dt of [0.2, 0.42]) D.bolt(H.surface(end * (len / 2 + dt), (k + (dt > 0.3 ? 0.5 : 0)) / n * Math.PI * 2, r + 0.03, _m), 0.014, 0.01);
        }
        mliBand(b, D, H, end < 0 ? -len / 2 + 0.2 : len / 2 - 0.7, end < 0 ? -len / 2 + 0.7 : len / 2 - 0.2, 'mliSilver', { rho: r + 0.05 });
        if (kind === 'cone' && !berth[end < 0 ? 0 : 1]) {
          // free end: bolted hatch ring on the cone face
          const M = new THREE.Matrix4().compose(H.axisPoint(end * (len / 2 + 0.98)), new THREE.Quaternion().setFromUnitVectors(Y_AXIS, _v2.copy(H.dir).multiplyScalar(end)), V(1, 1, 1));
          boltCircle(D, M, 0.66, 16, 0, 0.014, 0.01);
          boltCircle(D, M, 0.84, 20, -0.02, 0.012, 0.009, COL.bare, 'fine', 0.1);
        }
      } else b.add('metalDark', torusAt(H.axisPoint(end * len / 2), H.dir, r + 0.03, 0.06, 6, 48), false);
    }
    // circumferential seams: weld lands with rivet rows (GPU presets) or dark seam rings
    for (let t = -len / 2 + seams; t < len / 2 - 0.5; t += seams) {
      if (D) weldLand(b, D, H, t); else b.add('metalDark', torusAt(H.axisPoint(t), H.dir, r + 0.015, 0.035, 5, 48), false);
    }
    // MLI sections (gold / silver bands slightly proud of the hull) with taped edges, tie-downs, closure seam
    for (const s of mli) {
      b.add(s.mat, tubeAt(H.axisPoint((s.from + s.to) / 2), H.dir, r + 0.06, s.to - s.from, 48));
      if (D) mliBand(b, D, H, s.from, s.to, s.mat, { seamTheta: H.thetaFor(V(0, -1, 0)) + 0.9 });
    }
    // micrometeoroid shield panels on the central section: curved Whipple panels with folded edges (GPU
    // presets), standoff boxes on 'lite'
    if (shieldRows > 0 && D) shieldPanels(b, D, H, shieldRows, shieldFrom);
    else if (shieldRows > 0) {
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
    for (const w of windows) { addWindow(H, w.t, w.theta, w.r ?? 0.32); windowBolts(D, H, w.t, w.theta, w.r ?? 0.32); }
    // worksite sockets near the rail ends, connector panels / vents (extras: [{ kind, t, dir, dth }])
    if (D) {
      const thTop = H.thetaFor(Y_AXIS), thBot = H.thetaFor(V(0, -1, 0));
      if (noStep) for (const s of [-1, 1]) for (const th of (Math.abs(H.dir.y) > 0.9 ? [H.thetaFor(Z_AXIS)] : [thTop, thBot])) {
        const tt = s * (len / 2 - 0.95), rho = (shieldRows > 0 && tt > shieldFrom && tt < shieldFrom + shieldRows * 1.82) ? r + 0.118 : (mli.some((q) => tt > q.from && tt < q.to) ? r + 0.064 : r + 0.004);
        b.labelAt('НЕ НАСТУПАТЬ · NO STEP', 0.9, 0.09, H.point(tt, th, rho), H.normal(th), { right: H.dir.clone().multiplyScalar(-s), width: 1024, height: 104, color: '#b01818', font: 'bold 64px "Segoe UI", Arial, sans-serif' });
      }
      const rho = shieldRows > 0 ? r + 0.115 : r;
      for (const a of railAngles) for (const s of [-1, 1]) hullWif(D, H, s * (len / 2 - 1.25), a + 0.22, s * (len / 2 - 1.25) > shieldFrom && s * (len / 2 - 1.25) < shieldFrom + shieldRows * 1.82 ? rho : r);
      extras.forEach((x, i) => {
        const th = H.thetaFor(x.dir) + (x.dth || 0), rr = x.rho ?? r;
        if (x.kind === 'conn') hullConnectors(D, H, x.t, th, rr, i);
        if (x.kind === 'vent') {
          hullVent(D, H, x.t, th, rr, x.w, x.d);
          b.labelAt('ВЕНТ · VENT', 0.42, 0.06, H.point(x.t + (x.d ?? 0.3) / 2 + 0.07, th, rr + 0.004), H.normal(th), { right: H.dir.clone().negate(), width: 512, height: 72, font: 'bold 52px "Segoe UI", Arial, sans-serif' });
        } else if (x.kind === 'conn') b.labelAt('ВНИМАНИЕ · 120 В', 0.46, 0.06, H.point(x.t - 0.22, th, rr + 0.004), H.normal(th), { right: H.dir.clone().negate(), width: 512, height: 72, color: '#b01818', font: 'bold 50px "Segoe UI", Arial, sans-serif' });
        else if (x.kind === 'wif') hullWif(D, H, x.t, th, rr);
      });
    }
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
    // solid frame ring (lip, sealing land, bore into the hull), two panes recessed 3 cm / 8 cm below the lip with
    // their edges buried in the frame, interior stand-in glow behind (hidden while the cabin is drawn)
    b.add('metalDark', at(latheAt(V(0, 0, 0), Y_AXIS, [[wr - 0.02, -0.12], [wr + 0.1, -0.12], [wr + 0.1, 0.03], [wr + 0.08, 0.055], [wr + 0.01, 0.055], [wr - 0.02, 0.035], [wr - 0.02, -0.12]], 32), s), false);
    b.add('windowGlow', at(new THREE.CylinderGeometry(wr, wr, 0.04, 24).translate(0, -0.12, 0), s), false);
    b.add('glass', at(new THREE.CylinderGeometry(wr + 0.005, wr + 0.005, 0.016, 32).translate(0, 0.025, 0), s), false);
    b.add('glass', at(new THREE.CylinderGeometry(wr + 0.005, wr + 0.005, 0.012, 32).translate(0, -0.03, 0), s), false);
  }

  /** Node: short fat cylinder with four radial port stubs. */
  function node({ name, label, x, r = 2.45, len = 5, stubs = ['+y', '-y', '+z', '-z'], free = [] }) {
    const H = module({ name, label, center: V(x, CY, 0), dir: X_AXIS, r, len, hull: 'hullWhiteAged', mli: [], capA: 'cone', capB: 'cone', railAngles: [0.6, 2.2, 4.1, 5.7], seams: 10, labelSides: false, noStep: false });
    const dirs = { '+y': Y_AXIS, '-y': V(0, -1, 0), '+z': Z_AXIS, '-z': V(0, 0, -1) };
    for (const s of stubs) {
      const d = dirs[s];
      b.add('hullWhite', tubeAt(V(x, CY, 0).addScaledVector(d, r - 0.4), d, 1.35, 1.9, 32));
      b.add('metalDark', torusAt(V(x, CY, 0).addScaledVector(d, r + 0.5), d, 1.37, 0.07, 6, 32), false);
      b.add('mliBlack', tubeAt(V(x, CY, 0).addScaledVector(d, r + 0.1), d, 1.42, 0.6, 32));
      if (D) {
        const Mn = new THREE.Matrix4().compose(V(x, CY, 0).addScaledVector(d, r + 0.5), new THREE.Quaternion().setFromUnitVectors(Y_AXIS, d), V(1, 1, 1));
        // stub collar: bolted ring where the MLI boot meets the berthing ring
        b.add('hullWhiteAged', latheAt(V(x, CY, 0).addScaledVector(d, r + 0.5), d, [[1.36, -0.32], [1.47, -0.3], [1.49, -0.27], [1.49, -0.12], [1.42, -0.1]], 48), false);
        radialBolts(D, Mn, 1.49, 36, -0.2, 0.013, 0.01);
        if (free.includes(s)) {
          // passive CBM: ring with bolt circle, four alignment guides, hatch cover with handles
          b.add('metalBare', latheAt(V(x, CY, 0).addScaledVector(d, r + 0.5), d, [[1.35, -0.06], [1.54, -0.04], [1.54, 0.05], [1.46, 0.08], [1.18, 0.08]], 48));
          b.add('hullWhiteAged', tubeAt(V(x, CY, 0).addScaledVector(d, r + 0.6), d, 1.12, 0.05, 40));
          boltCircle(D, Mn, 1.32, 32, 0.08, 0.013, 0.01);
          boltCircle(D, Mn, 1.05, 24, 0.125, 0.01, 0.007, COL.bare, 'fine', 0.07);
          for (let k = 0; k < 4; k++) {
            const a = (k / 4) * Math.PI * 2 + Math.PI / 4, ca = Math.cos(a), sa = Math.sin(a);
            const qg = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, -a).multiply(new THREE.Quaternion().setFromAxisAngle(Z_AXIS, 0.35));
            D.partQ('mid', 'metal', COL.steel, 'bbox', Mn, 1.4 * ca, 0.2, 1.4 * sa, qg, 0.08, 0.3, 0.26, true);
            latchAround(Mn, a + Math.PI / 4, 1.5);
          }
          for (const sx of [-1, 1]) {
            D.rod('mid', 'paint', COL.yellow, V(0, 0, 0).set(sx * 0.35, 0.13, -0.25).applyMatrix4(Mn), V(0, 0, 0).set(sx * 0.35, 0.13, 0.25).applyMatrix4(Mn), 0.018, 'cyl8');
            for (const sz of [-1, 1]) D.rod('mid', 'paint', COL.yellow, V(0, 0, 0).set(sx * 0.35, 0.1, sz * 0.25).applyMatrix4(Mn), V(0, 0, 0).set(sx * 0.35, 0.14, sz * 0.25).applyMatrix4(Mn), 0.016, 'cyl6');
          }
          D.part('mid', 'paint', COL.gray, 'disc12', Mn, 0, 0.125, 0, 0.18, 0.02, 0.18);
        }
      }
    }
    // label as a small plate on the +Z / -Z sides
    if (label) for (const side of [1, -1]) { const n = V(0, 0.72, 0.69 * side).normalize(); b.labelAt(label, 2.2, 0.46, V(x, CY, 0).addScaledVector(n, r + 0.05), n, { width: 512 }); }
    // GPS patch antennas + small cameras on top of the node
    b.add('antennaWhite', tubeAt(V(x + 1.6, CY + r + 0.15, 1.2), Y_AXIS, 0.16, 0.3, 12, { uv: false }), false);
    b.add('antennaWhite', tubeAt(V(x + 1.6, CY + r + 0.15, -1.2), Y_AXIS, 0.16, 0.3, 12, { uv: false }), false);
    if (D) { const yr = Math.sqrt(r * r - 2.25); addCamera(V(x - 1.7, CY + yr, 1.5), V(0.4, 1, 0.6), V(0, yr, 1.5).normalize()); }
    else addCamera(V(x - 1.7, CY + r + 0.05, 1.5), V(0.4, 1, 0.6));
    return H;
  }

  function addCamera(base, lookDir, mount = null) {
    if (D) { cameraAssembly(b, D, base, mount || lookDir.clone().normalize().add(V(0, 0.0001, 0)), lookDir.clone().normalize(), { stand: 0.35 }); return; }
    const d = _v.copy(lookDir).normalize();
    b.add('metalDark', tubeAt(base.clone().addScaledVector(d, 0.25), d, 0.05, 0.5, 6, { uv: false }), false);
    const c = base.clone().addScaledVector(d, 0.55);
    b.add('rubberBlack', bevelBoxAt(c, 0.32, 0.26, 0.26, _q.setFromUnitVectors(X_AXIS, d)), false);
    b.add('metalBare', tubeAt(c.clone().addScaledVector(d, 0.22), d, 0.08, 0.14, 12, { uv: false }), false);
  }

  /** RCS thruster quad: base block + 4 nozzles pointing along the given directions. */
  function addRcsPod(center, mount, dirs) {
    const q = _q.setFromUnitVectors(Y_AXIS, mount);
    b.add('mliBlack', bevelBoxAt(center, 0.9, 0.6, 0.9, q), false);
    b.add('hazard', boxAt(center.clone().addScaledVector(mount, 0.31), 0.95, 0.04, 0.95, q, false), false);
    for (const d of dirs) {
      const dd = _v2.copy(d).normalize();
      const c = center.clone().addScaledVector(mount, 0.15).addScaledVector(dd, 0.55);
      b.add('metalDark', tubeAt(c, dd, 0.07, 0.45, 12, { rTop: 0.18, uv: false }), false);
      b.add('metalDark', tubeAt(center.clone().addScaledVector(mount, 0.15).addScaledVector(dd, 0.3), dd, 0.07, 0.3, 8, { uv: false }), false);
      if (D) {
        // nozzle exit lip, mounting flange with bolts, heater / pressure-transducer box
        b.add('metalBare', latheAt(c.clone().addScaledVector(dd, 0.225), dd, [[0.165, -0.02], [0.2, -0.01], [0.2, 0.0], [0.175, 0.005]], 16), false);
        const pf = center.clone().addScaledVector(mount, 0.15).addScaledVector(dd, 0.45);
        b.add('metalBare', tubeAt(pf, dd, 0.12, 0.03, 12, { uv: false }), false);
        boltCircle(D, new THREE.Matrix4().compose(pf.clone().addScaledVector(dd, 0.015), new THREE.Quaternion().setFromUnitVectors(Y_AXIS, dd), V(1, 1, 1)), 0.1, 6, 0, 0.012, 0.008);
      }
    }
    if (D) {
      const M = new THREE.Matrix4().compose(center.clone().addScaledVector(mount, 0.33), q, V(1, 1, 1));
      boltRow(D, M, -0.42, -0.42, 0.42, -0.42, 6, 0, 0.014, 0.01);
      boltRow(D, M, -0.42, 0.42, 0.42, 0.42, 6, 0, 0.014, 0.01);
      D.part('mid', 'metal', COL.gold, 'bbox', M, 0.2, 0.05, 0.15, 0.18, 0.1, 0.14);
    }
  }

  /** CBM-style latch housing on a ring of radius R in frame M (local Y = ring axis). */
  function latchAround(M, a, R) {
    const ca = Math.cos(a), sa = Math.sin(a);
    const Ml = new THREE.Matrix4().makeBasis(V(-sa, 0, ca), V(ca, 0, sa), V(0, 1, 0)).setPosition(R * ca, -0.1, R * sa);
    latch(D, M.clone().multiply(Ml), 1);
  }

  // ---------- the cluster ----------
  const logi = module({ name: 'logistics', label: 'ЛАРЕЦ', center: V(-25.5, CY, 0), dir: X_AXIS, r: 2.3, len: 9, hull: 'hullWhiteAged', mli: [{ from: -3.9, to: -1.2, mat: 'mliGold' }, { from: 1.5, to: 3.2, mat: 'mliSilver' }], windows: [{ t: 0, theta: 0, r: 0.25 }], capA: 'cone', labelT: 0.15, labelW: 2.4, berth: [false, true],
    extras: [{ kind: 'conn', t: 0.75, dir: Z_AXIS, dth: -0.6 }, { kind: 'vent', t: -0.45, dir: V(0, 0, -1), dth: 0.55 }, { kind: 'wif', t: 0.9, dir: Y_AXIS, dth: 0.35 }] });
  const n1 = node({ name: 'node1', label: 'УЗЕЛ-1', x: -18.5, free: ['+y'] });
  const lab = module({ name: 'lab', label: 'ИСТОК', center: V(-9, CY, 0), dir: X_AXIS, r: 2.3, len: 14, mli: [{ from: -6.4, to: -4.0, mat: 'mliGold' }, { from: 4.2, to: 6.3, mat: 'mliGold' }], shieldRows: 4, shieldFrom: -3.7, windows: [{ t: -1.5, theta: 0 }, { t: 1.5, theta: 0 }, { t: 0, theta: Math.PI / 2 }] });
  const n2 = node({ name: 'node2', label: 'УЗЕЛ-2', x: 0.5, free: ['-y'] });
  const hab2 = module({ name: 'hab2', label: 'МЕРИДИАН', center: V(9, CY, 0), dir: X_AXIS, r: 2.6, len: 12, mli: [{ from: -5.3, to: -3.4, mat: 'mliSilver' }], shieldRows: 3, shieldFrom: -2.8, windows: [{ t: -1.2, theta: 0 }, { t: 1.2, theta: 0 }, { t: 0, theta: Math.PI / 2 }, { t: 0, theta: -Math.PI / 2 }], labelT: 4.4, labelW: 3.0,
    extras: [{ kind: 'conn', t: 3.6, dir: V(0, -1, 0), dth: 0.5 }, { kind: 'vent', t: 5.0, dir: V(0, -1, 0), dth: -0.5 }, { kind: 'conn', t: 3.4, dir: Y_AXIS, dth: 0.45 }] });
  const n3 = node({ name: 'node3', label: 'УЗЕЛ-3', x: 17.5, free: ['+y'] });
  const power = module({ name: 'service', label: 'ВЕКТОР', center: V(27, CY, 0), dir: X_AXIS, r: 2.6, len: 14, hull: 'hullWhiteAged', mli: [{ from: -6.3, to: -2.0, mat: 'mliGold' }, { from: 2.0, to: 6.3, mat: 'mliGold' }], windows: [{ t: 0, theta: 0, r: 0.25 }], capB: 'flat', labelW: 3.8,
    extras: [{ kind: 'conn', t: 0.95, dir: Z_AXIS, dth: -0.55 }, { kind: 'vent', t: -0.95, dir: Z_AXIS, dth: -0.55 }, { kind: 'conn', t: 1.0, dir: V(0, 0, -1), dth: 0.5 }, { kind: 'vent', t: 0.0, dir: Y_AXIS, dth: -0.6, w: 0.6, d: 0.4 }] });
  const hab1 = module({ name: 'hab1', label: 'ГОРИЗОНТ', center: V(0.5, CY, 7.45), dir: Z_AXIS, r: 2.3, len: 10, mli: [{ from: -4.3, to: -2.6, mat: 'mliSilver' }], shieldRows: 2, shieldFrom: -1.8, windows: [{ t: -1.0, theta: Math.PI / 2 }, { t: 1.0, theta: Math.PI / 2 }, { t: 0, theta: Math.PI }], capA: 'flat', capB: 'cone', labelT: 3.4, labelW: 3.0, berth: [true, false], vestibule: true,
    extras: [{ kind: 'vent', t: 3.0, dir: V(0, -1, 0), dth: 0.45 }, { kind: 'conn', t: 4.0, dir: V(0, -1, 0), dth: -0.45 }] });
  const green = module({ name: 'greenhouse', label: 'ФЛОРА', center: V(0.5, CY, -8.45), dir: V(0, 0, -1), r: 2.3, len: 12, mli: [{ from: -5.3, to: -4.0, mat: 'mliSilver' }, { from: 4.0, to: 5.3, mat: 'mliSilver' }], railAngles: [1.1, 2.0, 4.3, 5.2], capA: 'flat', capB: 'cone', labelW: 3.2, labelDirs: [V(0.35, -1, 0).normalize(), V(-0.35, -1, 0).normalize()], berth: [true, false], vestibule: true,
    extras: [{ kind: 'conn', t: -3.3, dir: V(0, -1, 0), dth: 0 }, { kind: 'vent', t: 3.3, dir: V(0, -1, 0), dth: 0 }] });
  const med = module({ name: 'medical', label: 'ПУЛЬС', center: V(17.5, CY, 6.45), dir: Z_AXIS, r: 2.1, len: 8, mli: [{ from: -3.3, to: -2.0, mat: 'mliGold' }], windows: [{ t: 0.5, theta: Math.PI / 2 }], capA: 'flat', capB: 'cone', labelT: 1.0, labelW: 3.0, berth: [true, false], vestibule: true,
    extras: [{ kind: 'conn', t: -1.0, dir: V(0, -1, 0), dth: 0 }, { kind: 'vent', t: 2.4, dir: Y_AXIS, dth: 0 }] });
  const stow = module({ name: 'stowage', label: null, center: V(17.5, CY - 4.0, 0), dir: V(0, -1, 0), r: 1.5, len: 3.2, hull: 'hullWhiteAged', mli: [{ from: -1.0, to: 0.8, mat: 'mliBlack' }], railAngles: [1.0, 4.0], capA: 'flat', capB: 'cone', berth: [true, false], vestibule: true });

  // greenhouse long windows: three strips (zenith, +X, -X) with pink grow-light glow
  for (const dir of [Y_AXIS, X_AXIS, V(-1, 0, 0)]) {
    const th = green.thetaFor(dir);
    // curved frame (rails, end bars, mullions) hugging the hull, recessed glow, pane 3 cm below the frame top
    const G = green;
    for (const sg of [-1, 1]) b.add('metalDark', conformSlab(G, 0.4, th + sg * 0.405 / G.r, 0.1, 9.2, -0.03, 0.08), false);
    for (const sg of [-1, 1]) b.add('metalDark', conformSlab(G, 0.4 + sg * 4.55, th, 0.71, 0.1, -0.03, 0.08), false);
    for (let t = -3.5; t <= 3.6; t += 1.0) b.add('metalDark', conformSlab(G, 0.4 + t, th, 0.71, 0.07, -0.02, 0.07), false);
    b.add('windowGlow', conformSlab(G, 0.4, th, 0.72, 9.02, -0.09, -0.04), false, growGlow);
    b.add('glass', conformSlab(G, 0.4, th, 0.72, 9.02, 0.036, 0.048), false);
  }

  // cupola on node-1 nadir: base drum (reaching up into the node hull), hexagonal frustum of six trapezoid
  // windows and a round nadir window — every window a frame with two panes whose edges sit in the frame, bevelled
  // mullions, hex frame rings, open shutters on hinge arms; inner glow (hidden from inside)
  {
    const cx = n1.center.x, top = CY - 2.45;
    const C = V(cx, top, 0), DOWN = V(0, -1, 0);
    // drum wall whose upper edge follows the node's cylinder (embedded 3 cm), so it meets the hull everywhere
    {
      const n = 64, rD = 1.55, pos = [], nor = [], uv = [], idx = [];
      for (let i = 0; i <= n; i++) {
        const ph = (i / n) * Math.PI * 2, x = rD * Math.cos(ph), z = rD * Math.sin(ph);
        const yTop = CY - Math.sqrt(n1.r * n1.r - z * z) + 0.03, yBot = top - 0.84;
        pos.push(cx + x, yTop, z, cx + x, yBot, z);
        nor.push(Math.cos(ph), 0, Math.sin(ph), Math.cos(ph), 0, Math.sin(ph));
        uv.push(ph * rD / TEX_M, yTop / TEX_M, ph * rD / TEX_M, yBot / TEX_M);
        if (i < n) { const a0 = i * 2; idx.push(a0, a0 + 2, a0 + 1, a0 + 1, a0 + 2, a0 + 3); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
      b.add('hullWhite', g);
    }
    b.add('hullWhite', latheAt(C, DOWN, [[1.2, 0.84], [1.55, 0.84], [1.66, 0.87], [1.66, 0.97], [1.58, 1.0], [1.2, 1.0]], 48));
    const frust = (rt, rb, h, y, open) => new THREE.CylinderGeometry(rt, rb, h, 6, 1, open).translate(cx, y, 0);
    b.add('windowGlow', frust(0.68, 1.2, 0.9, top - 1.5, false), false, cupolaGlow);
    // hex frame rings (lathe with six segments: flats line up with the window faces)
    b.add('metalDark', latheAt(C, DOWN, [[1.36, 0.98], [1.58, 0.98], [1.58, 1.1], [1.36, 1.1], [1.36, 0.98]], 6));
    b.add('metalDark', latheAt(C, DOWN, [[0.62, 1.92], [0.95, 1.92], [0.95, 2.02], [0.62, 2.02], [0.62, 1.92]], 6));
    const vtx = (k, d, r) => { const a = (k / 6) * Math.PI * 2 + Math.PI / 6; return V(cx + r * Math.cos(a), top - d, r * Math.sin(a)); };
    for (let k = 0; k < 6; k++) {
      const p0 = vtx(k, 1.06, 1.5), p1 = vtx(k, 1.96, 0.88);
      const d = p1.clone().sub(p0);
      b.add('metalDark', bevelBoxAt(p0.clone().lerp(p1, 0.5), 0.13, d.length() + 0.06, 0.13, _q.setFromUnitVectors(Y_AXIS, d.normalize()), 0.025), false);
      // panes: trapezoid between this mullion and the next, inset 6 cm, outer pane in the face plane, inner 5 cm in
      const A0 = vtx(k, 1.06, 1.5), B0 = vtx(k + 1, 1.06, 1.5), A1 = vtx(k, 1.96, 0.88), B1 = vtx(k + 1, 1.96, 0.88);
      const cen = A0.clone().add(B0).add(A1).add(B1).multiplyScalar(0.25);
      const ex = B0.clone().sub(A0).normalize(), ey = A1.clone().add(B1).multiplyScalar(0.5).sub(A0.clone().add(B0).multiplyScalar(0.5));
      const hh = ey.length(); ey.normalize();
      const ez = new THREE.Vector3().crossVectors(ex, ey).normalize();
      if (ez.dot(cen.clone().sub(V(cx, cen.y, 0))) < 0) ez.negate();
      const wTop = A0.distanceTo(B0) - 0.16, wBot = A1.distanceTo(B1) - 0.16, hp = hh - 0.14;
      const trap = [[-wTop / 2, -hp / 2], [wTop / 2, -hp / 2], [wBot / 2, hp / 2], [-wBot / 2, hp / 2]];
      const M = new THREE.Matrix4().makeBasis(ex, ey, ez).setPosition(cen);
      b.add('glass', plate(trap, 0.018, 0.004).applyMatrix4(M.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.0))), false);
      b.add('glass', plate(trap, 0.014, 0.004).applyMatrix4(M.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, -0.05))), false);
      // pane retainer (frame lip around the pane on the outside)
      const lip = (x0, y0, x1, y1) => { const p = V(0, 0, 0).set((x0 + x1) / 2, (y0 + y1) / 2, 0.02), L = Math.hypot(x1 - x0, y1 - y0), ang = Math.atan2(y1 - y0, x1 - x0); b.add('metalDark', bevelBoxAt(p, L + 0.05, 0.05, 0.03, new THREE.Quaternion().setFromAxisAngle(Z_AXIS, ang), 0.008).applyMatrix4(M), false); };
      lip(-wTop / 2 - 0.01, -hp / 2 - 0.01, wTop / 2 + 0.01, -hp / 2 - 0.01);
      lip(-wBot / 2 - 0.01, hp / 2 + 0.01, wBot / 2 + 0.01, hp / 2 + 0.01);
      // open shutter on two hinge arms from the drum flange, hanging outside the window
      const a2 = (k / 6) * Math.PI * 2, nrm = V(Math.cos(a2), 0, Math.sin(a2)), tan = V(-Math.sin(a2), 0, Math.cos(a2));
      const sc = V(cx, top - 1.45, 0).addScaledVector(nrm, 1.8);
      const Ms = new THREE.Matrix4().makeBasis(tan, Y_AXIS, nrm).setPosition(sc);
      b.add('hullWhiteAged', plate([[-0.44, -0.48], [0.44, -0.48], [0.44, 0.48], [-0.44, 0.48]], 0.04, 0.012).applyMatrix4(Ms));
      for (const sx of [-1, 1]) {
        const h0 = V(cx, top - 0.93, 0).addScaledVector(nrm, 1.64).addScaledVector(tan, sx * 0.3), h1 = sc.clone().addScaledVector(tan, sx * 0.3).addScaledVector(Y_AXIS, 0.4).addScaledVector(nrm, -0.03);
        const dd = h1.clone().sub(h0);
        b.add('metalDark', bevelBoxAt(h0.clone().lerp(h1, 0.5), 0.05, dd.length() + 0.04, 0.035, _q.setFromUnitVectors(Y_AXIS, dd.normalize()), 0.01), false);
        b.add('metalBare', tubeAt(h0, tan, 0.03, 0.08, 10, { uv: false }), false);
      }
    }
    // nadir window: round frame, two panes
    b.add('metalDark', latheAt(C, DOWN, [[0.6, 1.97], [0.74, 1.97], [0.74, 2.07], [0.72, 2.09], [0.62, 2.09], [0.6, 2.07], [0.6, 1.97]], 48), false);
    b.add('glass', new THREE.CylinderGeometry(0.615, 0.615, 0.016, 48).translate(cx, top - 2.045, 0), false);
    b.add('glass', new THREE.CylinderGeometry(0.615, 0.615, 0.012, 48).translate(cx, top - 1.995, 0), false);
    if (D) {
      radialBolts(D, new THREE.Matrix4().setPosition(cx, top - 0.92, 0), 1.66, 40, 0, 0.013, 0.01);
      boltCircle(D, new THREE.Matrix4().makeRotationX(Math.PI).setPosition(cx, top - 2.09, 0), 0.67, 18, 0, 0.011, 0.008);
    }
    colliders.push(Colliders.sphere(V(cx, top - 1.3, 0), 1.9, 'cupola'));
  }

  // berthing joint between node-1 and the airlock (the airlock module itself is built by Airlock.js):
  // bolted flange ring with a seal, MLI vestibule into the node, latch housings on the airlock's MLI collar
  if (D) {
    const A = LAYOUT.airlock, c = V(A.x, CY, A.zStart);
    b.add('hullWhiteAged', latheAt(c, Z_AXIS, [[A.r - 0.04, -0.01], [A.r + 0.09, 0.01], [A.r + 0.09, 0.15], [A.r + 0.06, 0.18], [A.r - 0.01, 0.19]], 64));
    b.add('rubberBlack', latheAt(c, Z_AXIS, [[A.r - 0.03, -0.05], [A.r + 0.05, -0.04], [A.r + 0.05, -0.01], [A.r - 0.03, 0.0]], 64), false);
    b.add('mliSilver', tubeAt(V(A.x, CY, A.zStart - 0.78), Z_AXIS, 1.72, 1.5, 40));
    const Ha = new HullFrame(V(A.x, CY, A.zStart + A.len / 2), Z_AXIS, A.r, A.len, 'airlockJoint');
    radialBolts(D, new THREE.Matrix4().compose(c, new THREE.Quaternion().setFromUnitVectors(Y_AXIS, Z_AXIS), V(1, 1, 1)), A.r + 0.09, 72, 0.08, 0.016, 0.011);
    for (let k = 0; k < 12; k++) latch(D, Ha.surface(-A.len / 2 + 0.6, (k + 0.5) / 12 * Math.PI * 2, A.r + 0.05, new THREE.Matrix4()), 1);
  }

  // main pylons from node-2 and the hub to the truss; strut quads at node-1 / node-3
  const truBot = -LAYOUT.spineSize / 2;
  for (const x of [n2.center.x, LAYOUT.hubX]) {
    b.add('truss', tubeAt(V(x, (truBot + CY + 2.4) / 2, 0), Y_AXIS, 1.1, truBot - (CY + 2.4), 24));
    b.add('hazard', tubeAt(V(x, CY + 2.9, 0), Y_AXIS, 1.13, 0.5, 24, { uv: false }), false);
    b.add('metalDark', torusAt(V(x, truBot - 0.05, 0), Y_AXIS, 1.2, 0.1, 6, 24), false);
    colliders.push(Colliders.capsule(V(x, CY + 2.0, 0), V(x, truBot, 0), 1.15, 'pylon'));
    if (D) {
      // bolted interface flanges at both ends, ring frames with fastener lines along the pylon
      b.add('metalBare', latheAt(V(x, CY + 2.45, 0), Y_AXIS, [[1.1, -0.1], [1.3, -0.08], [1.3, 0.06], [1.12, 0.1]], 40));
      b.add('metalBare', latheAt(V(x, truBot - 0.2, 0), Y_AXIS, [[1.1, -0.12], [1.28, -0.1], [1.28, 0.04], [1.12, 0.08]], 40));
      radialBolts(D, new THREE.Matrix4().setPosition(x, CY + 2.44, 0), 1.3, 28, 0, 0.014, 0.01);
      radialBolts(D, new THREE.Matrix4().setPosition(x, truBot - 0.23, 0), 1.28, 28, 0, 0.014, 0.01);
      for (let y = CY + 3.6; y < truBot - 0.6; y += 1.1) {
        b.add('hullWhiteAged', latheAt(V(x, y, 0), Y_AXIS, [[1.1, -0.05], [1.125, -0.04], [1.125, 0.04], [1.1, 0.05]], 40), false);
        radialBolts(D, new THREE.Matrix4().setPosition(x, y, 0), 1.125, 22, 0, 0.008, 0.005, COL.bare, 'fine', 0.1);
      }
      // umbilical tray up the pylon (between the rail lines) with P-clamps
      for (const a of [0, Math.PI]) {
        const ca = Math.cos(a), sa = Math.sin(a);
        D.rod('mid', 'paint', COL.black, V(x + 1.18 * ca, CY + 2.6, 1.18 * sa), V(x + 1.18 * ca, truBot - 0.3, 1.18 * sa), 0.035, 'cyl8');
        D.rod('mid', 'metal', COL.copper, V(x + 1.2 * ca - 0.1 * sa, CY + 2.6, 1.2 * sa + 0.1 * ca), V(x + 1.2 * ca - 0.1 * sa, truBot - 0.3, 1.2 * sa + 0.1 * ca), 0.022, 'cyl8');
        for (let y = CY + 3.0; y < truBot - 0.4; y += 0.7) pClamp(D, new THREE.Matrix4().makeBasis(V(-sa, 0, ca), V(ca, 0, sa), V(0, 1, 0)).setPosition(x + 1.15 * ca, y, 1.15 * sa), 0.04);
      }
    }
  }
  for (const x of [n1.center.x, n3.center.x]) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const a = V(x + sx * 2.0, truBot, sz * 2.25), c = V(x, CY + 2.2, 0);
      b.add('metalDark', tubeAt(a.clone().lerp(c, 0.5), c.clone().sub(a).normalize(), 0.12, a.distanceTo(c), 8, { uv: false }));
      colliders.push(Colliders.capsule(a, c, 0.15, 'strut'));
      if (D) {
        // clevis end fittings with pins, turnbuckle sleeve mid-span
        const dd = c.clone().sub(a).normalize();
        for (const [p, sg] of [[a, 1], [c, -1]]) {
          const e = p.clone().addScaledVector(dd, sg * 0.25);
          b.add('metalBare', bevelBoxAt(e, 0.2, 0.36, 0.2, new THREE.Quaternion().setFromUnitVectors(Y_AXIS, dd), 0.03), false);
          const side = V(0, 0, 1).cross(dd).normalize();
          D.rod('mid', 'metal', COL.bare, e.clone().addScaledVector(side, -0.14).addScaledVector(dd, sg * 0.1), e.clone().addScaledVector(side, 0.14).addScaledVector(dd, sg * 0.1), 0.03, 'cyl8');
        }
        D.rod('mid', 'metal', COL.bare, a.clone().lerp(c, 0.46), a.clone().lerp(c, 0.54), 0.16, 'cyl12');
        for (const f of [0.455, 0.545]) D.rod('mid', 'metal', COL.dark, a.clone().lerp(c, f - 0.005), a.clone().lerp(c, f + 0.005), 0.19, 'cyl12');
      }
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
    for (let t = -len / 2 + 0.6; t < len / 2; t += 1.6) {
      b.add('metalDark', at(new THREE.BoxGeometry(1.2, 0.3, 0.14).translate(0, 0.05, t), H.surface(0, th, H.r + 0.05, new THREE.Matrix4())), false);
      if (D) {
        const Ms = H.surface(t, th, H.r + 0.2, new THREE.Matrix4());
        for (const k of [-0.45, -0.15, 0.15, 0.45]) pClamp(D, H.surface(t + 0.12, th + k / H.r, H.r + 0.16, new THREE.Matrix4()), 0.05, COL.bare, 'mid');
        boltRow(D, Ms, -0.55, 0.0, 0.55, 0.0, 6, 0.0, 0.011, 0.008);
      }
    }
    if (D) {
      // quick-disconnect couplings with hex nuts every couple of metres
      for (const [k, col] of [[-0.45, COL.bare], [-0.15, COL.copper], [0.15, COL.bare], [0.45, COL.copper]]) {
        for (let t = -len / 2 + 1.4; t < len / 2 - 0.5; t += 3.2) {
          const Mq = H.surface(t, th + k / H.r, H.r + 0.16, new THREE.Matrix4()).multiply(ROT_X90);
          D.part('mid', 'metal', col, 'cyl12', Mq, 0, 0, 0, 0.075, 0.16, 0.075);
          D.part('fine', 'metal', COL.bare, 'bolt', Mq, 0, 0.08, 0, 0.085, 0.05, 0.085);
          D.part('fine', 'metal', COL.bare, 'bolt', Mq, 0, -0.13, 0, 0.085, 0.05, 0.085);
        }
      }
    }
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
  const camAt = (H, t, radial, look, rho = H.r) => { const n = radial.clone().normalize(); addCamera(H.axisPoint(t).addScaledVector(n, rho), look, n); };
  if (D) {
    camAt(hab1, 4.55, V(2.2, 1.2, 0), V(0.3, -0.3, 1));
    camAt(power, 6.0, V(0, 2.5, 1.2), V(1, 0.6, 0.3), power.r + 0.06);
    camAt(green, 4.55, V(-2.2, 1.0, 0), V(-0.3, 0.2, -1));
    camAt(lab, -5.2, V(0, 1, -0.6), V(-1, 0.25, -0.2), lab.r + 0.06);
    camAt(logi, 2.4, V(0, 0.5, 1), V(-0.6, 0.2, 1), logi.r + 0.06);
  } else {
    addCamera(V(hab1.center.x + 2.2, CY + 1.2, 12.0), V(0.3, -0.3, 1));
    addCamera(V(power.center.x + 6.0, CY + 2.5, 1.2), V(1, 0.6, 0.3));
    addCamera(V(green.center.x - 2.2, CY + 1.0, -13.0), V(-0.3, 0.2, -1));
  }

  shields.build(station);
  bolts.build(station);
  return { colliders, hulls, nodes: { n1, n2, n3 }, power, logi, hab1, green, med, growGlow };
}
