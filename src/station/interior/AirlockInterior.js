import * as THREE from 'three';
import { basis, offset, sub, rot, roundRect, circle, radialPair, roundRectRadius, MeshWriter } from './Mesh.js';
import { ZoneBuilder, ff, sstep } from './Zone.js';
import {
  COL, pt, dir, handrail, sign, lightPanel, vent, cables, duct, curve, bungee, bag, clutter, display, extinguisher, pba,
  camera, egressSign, footLoops, velcro, rack, boxSolid, CBM, hatchFrameCBM, openDoorCBM, hatchFrameRound, hatchDoorRound,
  spacesuit, laptop,
} from './Kit.js';

/**
 * Two-section airlock on node 1 (+Z):
 *   equipment lock 'airlockE' (z 2.65..6.35, r 1.85): two spacesuits on their mounts, battery / consumables
 *     chargers, tool lockers, umbilical interface panel, depress pump panel, inner hatch to the crew lock;
 *   crew lock 'airlockC' (z 6.5..9.45, r 1.15): tight chamber with handrails, lights, pressure gauge and the
 *     outer EVA hatch (exterior part, animated by AirlockModule).
 * Zone-local frame: x along +Z (world), y up, z = -X (world). The inner hatch door is built into
 * airlockPart.innerPivot (animated by AirlockModule).
 */

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const X = V(1, 0, 0), Y = V(0, 1, 0), Zp = V(0, 0, 1), NX = V(-1, 0, 0), NY = V(0, -1, 0), NZ = V(0, 0, -1);

/** Faceted cylinder lining (n flat panels around, rows along x) from x0 to x1, inward facing. */
function lining(Z, x0, x1, r, n, rows, tex, color = 0xffffff, skip = null) {
  const W = Z.W, T = Z.I.atlas;
  const side = 2 * r * Math.sin(Math.PI / n), ap = r * Math.cos(Math.PI / n);
  const L = (x1 - x0) / rows;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const nrm = V(0, -Math.cos(a), -Math.sin(a));
    for (let j = 0; j < rows; j++) {
      if (skip && skip(k, j)) continue;
      const c = V(x0 + (j + 0.5) * L, Math.cos(a) * ap, Math.sin(a) * ap);
      W.box('equip', offset(ff(c, nrm, X), 0, 0, -0.01), L - 0.012, side + 0.004, 0.02, color, T.rect(tex), T.rect('grey'), 16);
    }
  }
}

export function buildAirlock(I, airlockPart) {
  const info = airlockPart.info;
  const AX = info.x, CYw = -8;
  const zC = 6.0;
  const M = basis(V(AX, CYw, zC), Zp, Y, NX);
  const zones = [];
  // ======================================================================== equipment lock
  {
    const Z = new ZoneBuilder(I, 'airlockE', 'Шлюз · отсек оборудования', M, { lite: I.lite, detail: I.detail, seed: 201 });
    const K = Z.K, W = Z.W, T = I.atlas;
    const x0 = -3.35, x1 = 0.35, r = 1.85;
    lining(Z, x0, x1, r, 14, 3, 'panel', 0xffffff, (k, j) => false);
    // end wall toward node 1 with the CBM opening
    {
      const F = ff(V(x0, 0, 0), X, NZ);
      const [o, i] = radialPair(() => r + 0.02, (a) => roundRectRadius(CBM.w / 2, CBM.w / 2, CBM.r, a), I.lite ? 24 : 64);
      W.frame2D('equip', offset(F, 0, 0, 0), o, i, 0.03, 0xffffff, T.rect('bulkhead'), { back: false, outerWall: false, innerWall: false });
      hatchFrameCBM(K, F, 'УЗЕЛ-1 · NODE 1');
      openDoorCBM(K, F, 1.72, 1);
      if (!I.lite) { extinguisher(K, offset(F, -1.05, -0.3, 0)); pba(K, offset(F, 1.05, -0.3, 0)); egressSign(K, offset(F, -1.0, 0.75, 0), '← УЗЕЛ-1 · EXIT'); }
    }
    // bulkhead toward the crew lock (inner hatch opening r = 0.55)
    {
      const F = ff(V(x1, 0, 0), NX, Zp);
      const [o, i] = radialPair(() => r + 0.02, () => 0.57, I.lite ? 24 : 64);
      W.frame2D('equip', offset(F, 0, 0, 0), o, i, 0.06, 0xffffff, T.rect('bulkhead'), { back: false, outerWall: false, innerWall: false });
      hatchFrameRound(K, F, 0.55, 'ШЛЮЗОВАЯ КАМЕРА · CREW LOCK');
      // depress pump panel (left), umbilical interface panel (right), gauges, warning placards
      W.box('equip', offset(F, -1.05, 0.15, 0.03), 0.6, 0.6, 0.06, 0xffffff, T.rect('pumpPanel'), T.rect('grey'));
      W.box('equip', offset(F, 1.05, 0.2, 0.03), 0.62, 0.46, 0.06, 0xffffff, T.rect('uiaPanel'), T.rect('grey'));
      W.cyl('metal', sub(F, -0.75, -0.45, 0.05, 'x', Math.PI / 2), 0.09, 0.09, 0.05, 16, COL.dark);
      W.disc('equip', offset(F, -0.75, -0.45, 0.076), 0.08, 24, 0xffffff, T.rect('gauge'));
      sign(K, offset(F, 0, -0.72, 0.02), 'ВНИМАНИЕ! ПРОВЕРЬ ΔP · CHECK ΔP', 0.8, 0.07, { ph: 36, bg: '#e9b82a', fg: '#111' });
      // umbilicals: two coiled hoses hanging from the UIA
      if (!I.lite) for (const s of [-1, 1]) {
        const a = pt(F, 1.05 + s * 0.15, -0.05, 0.08);
        const pts = [a];
        for (let k = 1; k <= 14; k++) { const t = k / 14; pts.push(pt(F, 1.05 + s * 0.15 + Math.sin(t * 9) * 0.06, -0.05 - t * 0.7, 0.12 + Math.cos(t * 9) * 0.06 + t * 0.15)); }
        W.tube('paint', pts, 0.018, 6, s > 0 ? 0xd9d6cc : 0x4a6fa5);
      }
      lightPanel(K, offset(F, 0, 0.95, 0.0), 0.5, 0.14);
      handrail(K, pt(F, -0.62, -0.4, 0), pt(F, -0.62, 0.4, 0), dir(F, 0, 0, 1), COL.rail, 0.07);
      handrail(K, pt(F, 0.62, -0.4, 0), pt(F, 0.62, 0.4, 0), dir(F, 0, 0, 1), COL.rail, 0.07);
    }
    // two spacesuits on the side walls (port / starboard), each in its own object (one disappears when worn)
    const suits = [];
    for (const [s, name] of [[1, 'ОРЛАН-МКС №6'], [-1, 'ОРЛАН-МКС №7']]) {
      const SW = new MeshWriter(I.lite ? Math.min(I.detail, 0.5) : I.detail);
      const SK = { ...K, W: SW, solids: null, rails: [] };
      const Fs = ff(V(-1.55, -0.05, s * 1.2), V(0, 0, -s), V(-s, 0, 0));
      spacesuit(SK, Fs, 'ru');
      if (Z.bake) SW.shade(Z.bake);
      suits.push({ geos: SW.build(), side: s, name, position: Z.toFrame(V(-1.55, 0.2, s * 0.6)) });
      // mount frame (static)
      W.box('metal', offset(Fs, 0, 0.3, -0.62), 0.5, 0.08, 0.08, COL.dark);
      W.box('metal', offset(Fs, 0, -0.6, -0.55), 0.5, 0.06, 0.2, COL.dark);
      sign(K, offset(ff(V(-1.55, 0.95, s * 1.45), V(0, -0.3, -s).normalize(), V(-s, 0, 0)), 0, 0, 0), name, 0.5, 0.06, { ph: 32 });
      Z.solids.push(boxSolid(offset(Fs, 0, -0.1, -0.2), 0.3, 0.95, 0.3, 'suit'));
      handrail(K, pt(Fs, -0.45, 0.1, -0.3), pt(Fs, -0.45, 0.7, -0.3), dir(Fs, 1, 0, 0).negate(), COL.rail, 0.04);
    }
    Z.suits = suits;
    // overhead: battery stowage & charger (BSA), tool lockers, lights; deck: gas tanks, lockers, foot restraints
    const Fo = ff(V(-1.6, 1.62, 0), NY, X);
    W.box('paint', offset(Fo, 0, 0, 0.12), 1.4, 0.7, 0.24, 0xd7d8d4);
    for (let k = 0; k < 4; k++) {
      W.chamferBox('paint', offset(Fo, -0.48 + k * 0.32, 0.05, 0.28), 0.22, 0.32, 0.1, 0.02, 0x3a3c40);
      W.box('glow', offset(Fo, -0.48 + k * 0.32, -0.15, 0.33), 0.04, 0.02, 0.002, k === 2 ? [3, 1.6, 0.2] : [0.2, 3.0, 0.4], null, null, 16);
    }
    sign(K, offset(Fo, 0, -0.27, 0.245), 'ЗАРЯДКА БАТАРЕЙ · BSA', 0.6, 0.06, { ph: 32 });
    for (const s of [-1, 1]) lightPanel(K, ff(V(-1.6 + s * 1.15, 1.45, s * 0.5), V(0, -1, -s * 0.4).normalize(), X), 0.55, 0.18);
    lightPanel(K, ff(V(-2.7, 1.5, 0), NY, X), 0.5, 0.18);
    const Fd = ff(V(-1.6, -1.62, 0), Y, X);
    rack(K, offset(Fd, -0.35, 0, 0.02), 'drawers', 0.7, 0.9);
    rack(K, offset(Fd, 0.5, 0, 0.02), 'locker2', 0.8, 0.9);
    if (!I.lite) {
      for (const s of [-1, 1]) { W.cyl('paint', sub(Fd, 1.3, s * 0.6, 0.18, 'y', 0), 0.12, 0.12, 0.6, 14, s > 0 ? 0x2f8a4a : 0x3a3c40); }
      sign(K, offset(Fd, 1.3, 0, 0.3), 'O₂ · N₂ ВЫСОКОЕ ДАВЛЕНИЕ', 0.5, 0.05, { ph: 32, bg: '#e9b82a', fg: '#111' });
      footLoops(K, offset(Fd, -1.3, 0, 0.0), 0.7, 3);
      // tool stowage: open bag with tools, a mini workstation, checklist
      bag(K, offset(ff(V(-2.9, 0.2, 1.4), V(0, 0, -1), X), 0, 0, 0.12), 0.5, 0.35, 0.25, 'b');
      sign(K, offset(ff(V(-2.9, 0.48, 1.6), V(0, 0, -1), X), 0, 0, 0.01), 'ИНСТРУМЕНТ ВКД · EVA TOOLS', 0.5, 0.05, { ph: 32 });
      laptop(K, offset(ff(V(-2.9, 0.1, -1.55), V(0, 0, 1), NX), 0, 0, 0), 'scrText', 0.28);
      camera(K, ff(V(-3.2, 1.2, 0.7), V(1, -0.4, -0.3).normalize(), Zp));
      cables(K, [V(-3.3, 1.35, -0.9), V(0.3, 1.35, -0.9)], 4, 0.013);
      duct(K, [V(-3.3, 1.2, 1.0), V(0.3, 1.2, 1.0)], 0.06);
      clutter(K, ff(V(-0.6, 0.6, -1.6), V(0, -0.3, 1).normalize(), NX), 0.6, 0.6, 3);
    }
    for (const [y, z] of [[1.2, 1.0], [1.2, -1.0], [-1.2, 1.0], [-1.2, -1.0]]) {
      const n = V(0, -y, -z).normalize();
      handrail(K, V(-2.8, y * 1.05, z * 1.05), V(-2.0, y * 1.05, z * 1.05), n, COL.rail, 0.05);
      handrail(K, V(-0.9, y * 1.05, z * 1.05), V(-0.2, y * 1.05, z * 1.05), n, COL.rail, 0.05);
    }
    Z.cyl(V(x0 + 0.02, 0, 0), V(x1 - 0.02, 0, 0), r - 0.1);
    Z.box(x0, 0, 0, 1.0, CBM.w / 2, CBM.w / 2).passage = true;
    Z.portal('node1', V(x0 - 0.05, 0, 0), 0.75);
    Z.portal('airlockC', V(x1 + 0.05, 0, 0), 0.6, airlockPart.innerHatch);
    Z.cyl(V(x1 - 1.0, 0, 0), V(x1 + 1.15, 0, 0), 0.55, airlockPart.innerHatch).passage = true;
    Z.light(-1.6, 0.6, 0);
    Z.carveCone(V(x0 - 0.3, 0, 0), V(x1 + 0.1, 0, 0), 1.96);
    Z.bake = (x, y, z, nx, ny, nz, name) => (name === 'glow' ? 1 : (I.lite ? 0.9 : 1) * (1 - 0.35 * sstep(1.4, 1.9, Math.hypot(y, z))));
    zones.push(Z);
  }
  // ======================================================================== crew lock
  {
    const Z = new ZoneBuilder(I, 'airlockC', 'Шлюз · шлюзовая камера', M, { lite: I.lite, detail: I.detail, seed: 211 });
    const K = Z.K, W = Z.W, T = I.atlas;
    const x0 = 0.5, x1 = 3.45, r = 1.15, xh = info.hatchZ - zC;
    lining(Z, x0, x1, r, 10, 3, 'panel');
    // inner bulkhead (crew-lock side)
    {
      const F = ff(V(x0, 0, 0), X, NZ);
      const [o, i] = radialPair(() => r + 0.02, () => 0.57, I.lite ? 24 : 48);
      W.frame2D('equip', F, o, i, 0.03, 0xffffff, T.rect('bulkhead'), { back: false, outerWall: false, innerWall: false });
      hatchFrameRound(K, F, 0.55, null);
      W.cyl('metal', sub(F, 0.75, 0.55, 0.04, 'x', Math.PI / 2), 0.08, 0.08, 0.04, 16, COL.dark);
      W.disc('equip', offset(F, 0.75, 0.55, 0.062), 0.07, 24, 0xffffff, T.rect('gauge'));
    }
    // tunnel between the two bulkheads (inner hatch passage)
    {
      const F = ff(V(0.35, 0, 0), X, NZ);
      Z.W.cyl('paint', sub(F, 0, 0, 0.075, 'x', Math.PI / 2), 0.57, 0.57, 0.15, 32, 0xb9bcbf, 0);
    }
    // end wall around the outer hatch opening (r 0.76) — hatch tunnel liner is part of the exterior
    {
      const F = ff(V(x1, 0, 0), NX, Zp);
      const [o, i] = radialPair(() => r + 0.02, () => 0.78, I.lite ? 24 : 64);
      W.frame2D('equip', F, o, i, 0.03, 0xffffff, T.rect('stripes'), { back: false, outerWall: false, innerWall: false });
      W.torus('metal', offset(F, 0, 0, 0.02), 0.8, 0.03, 6, 40, COL.dark);
      sign(K, offset(F, 0, 0.95, 0.0), 'НАРУЖНЫЙ ЛЮК · EV HATCH', 0.6, 0.07, { ph: 36, bg: '#c0352b', fg: '#fff' });
    }
    // lights, handrails, gauge, tether reel, camera
    for (const s of [-1, 1]) {
      const a = Math.PI / 2 + s * 0.5;
      lightPanel(K, ff(V((x0 + x1) / 2, Math.sin(a) * (r - 0.05), Math.cos(a) * (r - 0.05)), V(0, -Math.sin(a), -Math.cos(a)), X), 1.6, 0.14);
    }
    for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      const n = V(0, -Math.sin(a), -Math.cos(a));
      handrail(K, V(x0 + 0.4, Math.sin(a) * (r - 0.02), Math.cos(a) * (r - 0.02)), V(x1 - 0.4, Math.sin(a) * (r - 0.02), Math.cos(a) * (r - 0.02)), n, COL.rail, 0.06);
    }
    if (!I.lite) {
      const Fp = ff(V(1.9, 0.3, -(r - 0.06)), Zp, X);
      W.box('equip', offset(Fp, 0, 0, 0.03), 0.5, 0.5, 0.05, 0xffffff, T.rect('pumpPanel'), T.rect('grey'));
      const Ft = ff(V(2.9, -0.6, r - 0.15), V(0, 0.4, -1).normalize(), NX);
      W.box('paint', offset(Ft, 0, 0, 0.08), 0.3, 0.3, 0.16, COL.yellow);
      W.cyl('paint', sub(Ft, 0, 0, 0.17, 'x', Math.PI / 2), 0.1, 0.1, 0.03, 16, COL.dark);
      sign(K, offset(Ft, 0, 0.2, 0.0), 'ФАЛ · SAFETY TETHER', 0.34, 0.05, { ph: 32 });
      camera(K, ff(V(x0 + 0.2, 0.75, 0.6), V(1, -0.3, -0.3).normalize(), Zp));
      sign(K, ff(V(1.6, -0.75, -0.75), V(0, 0.7, 0.7).normalize(), X), 'ВНИМАНИЕ! ВАКУУМ · VACUUM', 0.6, 0.07, { ph: 36, bg: '#e9b82a', fg: '#111' });
      cables(K, [V(x0, -0.9, 0.5), V(x1, -0.9, 0.5)], 3, 0.012);
    }
    Z.cyl(V(x0 + 0.02, 0, 0), V(x1 - 0.02, 0, 0), r - 0.05);
    Z.cyl(V(x0 - 1.15, 0, 0), V(x0 + 1.0, 0, 0), 0.55, airlockPart.innerHatch).passage = true;
    Z.portal('airlockE', V(x0 - 0.05, 0, 0), 0.6, airlockPart.innerHatch);
    Z.light((x0 + x1) / 2, 0.5, 0);
    Z.carveCone(V(x0 - 0.1, 0, 0), V(xh - 0.2, 0, 0), 1.96);
    Z.bake = (x, y, z, nx, ny, nz, name) => (name === 'glow' ? 1 : (I.lite ? 0.95 : 1) * (1 - 0.3 * sstep(0.8, 1.2, Math.hypot(y, z))));
    Z.outside = { center: info.hatchCenter.clone(), radius: 30 };   // visible from outside near the open hatch
    zones.push(Z);
  }
  // ======================================================================== inner hatch door (animated by AirlockModule)
  {
    const DW = new MeshWriter(I.lite ? Math.min(I.detail, 0.5) : I.detail);
    const DK = { W: DW, T: I.atlas, rnd: Math.random, lite: I.lite, detail: I.detail, rails: [], solids: null, set: '' };
    // door frame: local origin at the hinge; closed door centre at (+0.66, 0, 0) facing -Z (toward the E-lock)
    const D = ff(V(0.66, 0, 0), NZ, NX);
    hatchDoorRound(DK, D, 0.54);
    DW.shade(() => (I.lite ? 0.95 : 1));
    airlockPart.innerDoorGeos = DW.build();
  }
  return zones;
}
