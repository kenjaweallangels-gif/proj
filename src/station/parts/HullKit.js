import * as THREE from 'three';
import { latheAt, TEX_M } from './Builder.js';
import { COL, boltCircle, latch, wif, connectorPanel, vent } from './Detail.js';

/**
 * Hull-level hardware for cylindrical modules (HullFrame): bolted end flanges and berthing joints, weld lands,
 * MLI blanket edges / tie-downs / closure seams, curved MMOD (Whipple) shield panels with folded edges and
 * rivet lines, worksite sockets, connector panels and vents. Structural rings go into the Builder `b`
 * (always drawn, cast shadows); fasteners and fittings into the DetailSet `D` (distance culled).
 */

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _v = new THREE.Vector3();

/** Mirror an end-flange profile written for the +axis end to end `e` (keeps the winding outward). */
export function endProfile(e, pts) { return e > 0 ? pts : pts.map(([r, y]) => [r, -y]).reverse(); }

/** Bolted flange ring at a module end (e = ±1); `berth` adds a gasket line and latch housings (CBM-style joint). */
export function endFlange(b, D, H, e, { berth = true, rho = H.r + 0.05, latches = 12, seg = 64 } = {}) {
  const r = H.r, tEnd = e * H.len / 2;
  const c = H.axisPoint(tEnd);
  // flange: steps up from the MLI collar, chamfered outer edge, stops short of the joint plane (shadow gap)
  b.add('hullWhiteAged', latheAt(c, H.dir, endProfile(e, [[rho - 0.01, -0.2], [r + 0.075, -0.18], [r + 0.095, -0.15], [r + 0.095, -0.045], [r + 0.07, -0.022], [r + 0.03, -0.02]]), seg));
  if (berth) {
    // rubber seal proud of the hull in the joint plane, with a dark recess either side
    b.add('rubberBlack', latheAt(c, H.dir, [[r + 0.02, -0.022], [r + 0.06, -0.012], [r + 0.06, 0.012], [r + 0.02, 0.022]], seg), false);
  }
  if (!D) return;
  // bolt circle on the flange rim (bolts radial)
  const n = Math.max(24, Math.round((2 * Math.PI * r) / 0.17));
  for (let k = 0; k < n; k++) {
    const th = (k + 0.5) / n * Math.PI * 2;
    D.bolt(H.surface(tEnd - e * 0.1, th, r + 0.095, _m), 0.016, 0.011);
  }
  // rivet line where the flange meets the collar
  const nr = Math.round((2 * Math.PI * r) / 0.09);
  for (let k = 0; k < nr; k++) D.rivet(H.surface(tEnd - e * 0.205, (k / nr) * Math.PI * 2, rho, _m), 0.008, 0.004);
  if (berth && latches) {
    for (let k = 0; k < latches; k++) {
      const th = (k / latches) * Math.PI * 2 + Math.PI / latches;
      latch(D, H.surface(tEnd - e * 0.36, th, rho, _m), e);
    }
  }
}

/** Raised weld land around the hull at axial t, with a fine seam groove and rivet rows along both edges. */
export function weldLand(b, D, H, t, { w = 0.15, seg = 72 } = {}) {
  const r = H.r;
  b.add('hullWhiteAged', latheAt(H.axisPoint(t), H.dir, [[r - 0.005, -w / 2 - 0.012], [r + 0.012, -w / 2], [r + 0.012, w / 2], [r - 0.005, w / 2 + 0.012]], seg), false);
  b.add('metalDark', latheAt(H.axisPoint(t), H.dir, [[r + 0.011, -0.006], [r + 0.0135, -0.004], [r + 0.0135, 0.004], [r + 0.011, 0.006]], seg), false);
  if (!D) return;
  const n = Math.round((2 * Math.PI * r) / 0.11);
  for (const s of [-1, 1]) for (let k = 0; k < n; k++) D.rivet(H.surface(t + s * (w / 2 - 0.025), (k + (s > 0 ? 0.5 : 0)) / n * Math.PI * 2, r + 0.012, _m), 0.0075, 0.0035);
}

/** MLI blanket band edges (taped lips), quilt tie-down buttons and a Velcro closure seam. */
export function mliBand(b, D, H, from, to, matName, { rho = H.r + 0.06, seamTheta = null, seg = 72 } = {}) {
  for (const [t, s] of [[from, -1], [to, 1]]) {
    const p = s > 0 ? [[rho - 0.004, -0.05], [rho + 0.012, -0.035], [rho + 0.012, 0.0], [rho - 0.02, 0.006]] : [[rho - 0.02, -0.006], [rho + 0.012, 0.0], [rho + 0.012, 0.035], [rho - 0.004, 0.05]];
    b.add(matName, latheAt(H.axisPoint(t), H.dir, p, seg), false);
  }
  if (!D) return;
  const len = to - from;
  const na = Math.max(1, Math.round(len / 0.42)), nc = Math.round((2 * Math.PI * rho) / 0.5);
  const btn = matName === 'mliGold' ? COL.gold : matName === 'mliBlack' ? COL.black : COL.offWhite;
  for (let i = 0; i < na; i++) {
    const t = from + (i + 0.5) * len / na;
    for (let k = 0; k < nc; k++) D.button(H.surface(t, (k + 0.5 * (i % 2)) / nc * Math.PI * 2, rho, _m), 0.016, 0.006, btn);
  }
  if (seamTheta !== null) {
    // closure flap: a raised strip along the band with stitch buttons
    const M = H.surface((from + to) / 2, seamTheta, rho, _m2);
    D.part('mid', 'paint', COL.offWhite, 'bbox', M, 0, 0.004, 0, 0.05, 0.012, len - 0.08);
    const ns = Math.max(2, Math.round(len / 0.12));
    for (let i = 0; i < ns; i++) { _m.makeTranslation(0, 0.01, -len / 2 + 0.06 + i * (len - 0.12) / (ns - 1)); D.rivet(_m2.clone().multiply(_m), 0.006, 0.003, COL.gray); }
  }
}

/**
 * Curved MMOD (Whipple) shield panel template in hull-cylinder coordinates: (rho cos θ, t, rho sin θ) for
 * θ in [-arc/2, arc/2], t in [-len/2, len/2]; outer skin at rOut, edges folded down to rIn.
 */
export function shieldPanelGeo(rIn, rOut, arc, len, n = 6) {
  const pos = [], nor = [], uv = [], idx = [];
  const push = (x, y, z, nx, ny, nz, u, v) => { pos.push(x, y, z); nor.push(nx, ny, nz); uv.push(u, v); return pos.length / 3 - 1; };
  // outer skin (smooth radial normals)
  const base = pos.length / 3;
  for (let i = 0; i <= n; i++) {
    const th = -arc / 2 + (i / n) * arc, c = Math.cos(th), s = Math.sin(th);
    for (const t of [-len / 2, len / 2]) push(rOut * c, t, rOut * s, c, 0, s, (rOut * th) / TEX_M, t / TEX_M);
  }
  for (let i = 0; i < n; i++) { const a = base + i * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  // folded ends (normals ±axis)
  for (const sgn of [-1, 1]) {
    const b0 = pos.length / 3;
    for (let i = 0; i <= n; i++) {
      const th = -arc / 2 + (i / n) * arc, c = Math.cos(th), s = Math.sin(th);
      push(rOut * c, sgn * len / 2, rOut * s, 0, sgn, 0, (rOut * th) / TEX_M, 0);
      push(rIn * c, sgn * len / 2 + sgn * 0.004, rIn * s, 0, sgn, 0, (rOut * th) / TEX_M, (rOut - rIn) / TEX_M);
    }
    for (let i = 0; i < n; i++) { const a = b0 + i * 2; if (sgn > 0) idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); else idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  // folded sides (normals tangential)
  for (const sgn of [-1, 1]) {
    const th = sgn * arc / 2, c = Math.cos(th), s = Math.sin(th);
    const nx = -s * sgn, nz = c * sgn;
    const a = push(rOut * c, -len / 2, rOut * s, nx, 0, nz, 0, 0), b2 = push(rOut * c, len / 2, rOut * s, nx, 0, nz, len / TEX_M, 0);
    const c2 = push(rIn * c, len / 2, rIn * s, nx, 0, nz, len / TEX_M, 0.01), d = push(rIn * c, -len / 2, rIn * s, nx, 0, nz, 0, 0.01);
    if (sgn > 0) idx.push(a, b2, c2, a, c2, d); else idx.push(a, d, c2, a, c2, b2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Rows of curved shield panels (staggered) with edge rivets and two attach bolts each. */
export function shieldPanels(b, D, H, rows, from, { ph = 1.7, gapT = 0.12, rOut = H.r + 0.115, rIn = H.r + 0.03 } = {}) {
  const around = Math.round((2 * Math.PI * H.r) / 1.05);
  const arcFull = (2 * Math.PI) / around, gapArc = 0.04 / H.r, arc = arcFull - gapArc;
  const tplGeo = shieldPanelGeo(rIn, rOut, arc, ph, 6);
  const rot = new THREE.Matrix4();
  for (let row = 0; row < rows; row++) {
    const t = from + row * (ph + gapT) + ph / 2;
    for (let k = 0; k < around; k++) {
      const th = (k + 0.5 * (row % 2)) * arcFull;
      _m.copy(H.frame).multiply(rot.makeRotationY(-th)).multiply(_m2.makeTranslation(0, t, 0));
      b.add('hullWhiteAged', tplGeo.clone().applyMatrix4(_m));
      if (!D) continue;
      // rivets along the four folded edges, attach bolts near the ends
      const pw = arc * rOut;
      for (let i = 0; i < 9; i++) for (const s of [-1, 1]) D.rivet(H.surface(t - ph / 2 + 0.06 + i * (ph - 0.12) / 8, th + s * (arc / 2 - 0.028 / rOut), rOut, _m), 0.0075, 0.004);
      for (let i = 1; i < 5; i++) for (const s of [-1, 1]) D.rivet(H.surface(t + s * (ph / 2 - 0.028), th - arc / 2 + i * arc / 5, rOut, _m), 0.0075, 0.004);
      for (const s of [-1, 1]) {
        const M = H.surface(t + s * (ph / 2 - 0.16), th, rOut, _m);
        D.part('fine', 'metal', COL.steel, 'disc8', M, 0, 0, 0, 0.026, 0.004, 0.026);
        D.bolt(M, 0.016, 0.012, COL.bare);
      }
      if (pw > 0.7 && (k + row) % 5 === 2) {
        // handling / ID tag on some panels
        D.part('fine', 'paint', COL.gray, 'box', H.surface(t, th, rOut, _m), 0, 0.002, 0.45, 0.09, 0.003, 0.05);
      }
    }
  }
  tplGeo.dispose();
}

/**
 * Lathe profile wrapped onto a module's cylinder: profile [[d, h], ...] where d is the distance from the feature
 * centre along the hull surface and h the height above the hull (h < 0 sinks into it), around the point (t0, th0)
 * of HullFrame H. Hatch rims, hazard rings and window frames hug the curved hull this way instead of floating
 * off it like flat discs. Closed counter-clockwise profiles give closed solids (see latheAt).
 */
export function conformLatheAt(H, t0, th0, profile, seg = 48) {
  const g = latheAt(new THREE.Vector3(), new THREE.Vector3(0, 1, 0), profile, seg);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    H.point(t0 + z, th0 + x / H.r, H.r + y, _v);
    p.setXYZ(i, _v.x, _v.y, _v.z);
  }
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** Bolted window frame ring (fasteners on the frame torus). */
export function windowBolts(D, H, t, theta, wr) {
  if (!D) return;
  boltCircle(D, H.surface(t, theta, H.r + 0.06, _m), wr + 0.06, 12, 0.0, 0.012, 0.009, COL.bare, 'fine', 0.13);
}

/** WIF socket / connector panel / vent at hull coordinates. */
export function hullWif(D, H, t, th, rho = H.r) { if (D) wif(D, H.surface(t, th, rho, new THREE.Matrix4())); }
export function hullConnectors(D, H, t, th, rho = H.r, seed = 0, w = 0.42, h = 0.3) { if (D) connectorPanel(D, H.surface(t, th, rho, new THREE.Matrix4()), w, h, 3, 2, seed); }
export function hullVent(D, H, t, th, rho = H.r, w = 0.4, d = 0.3) { if (D) vent(D, H.surface(t, th, rho, new THREE.Matrix4()), w, d); }
