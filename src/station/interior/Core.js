import * as THREE from 'three';
import { basis, offset, sub, rot, roundRect, circle, radialPair, roundRectRadius, octRadius } from './Mesh.js';
import { ZoneBuilder, ff, sstep } from './Zone.js';
import {
  COL, pt, dir, handrail, seatTrack, sign, lightPanel, vent, cables, duct, curve, bungee, bag, clutter, laptop, display,
  extinguisher, pba, camera, egressSign, footLoops, velcro, rack, boxSolid, CBM, hatchFrameCBM, hatchDoorCBM, vestibuleCBM,
  openDoorCBM, hatchFrameRound, hatchDoorRound, vestibuleRound, inwardTube, sleepingBag, plant, growthChamber, treadmill,
  ergometer, resistive, toilet, restraintTable, defibrillator, ultrasound, microscope,
} from './Kit.js';

/**
 * Core pressurised modules (station frame, zero-g): the US-style rack modules (four-wall ISPR layout with
 * corner standoffs), the three nodes with their radial vestibules, the Russian-style service module, the
 * greenhouse, the cupola, the stowage closet, the docking hub and the transfer tunnels.
 * Positions follow src/station/parts/Modules.js / Layout.js (they are never changed here).
 */

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const X = V(1, 0, 0), Y = V(0, 1, 0), Zp = V(0, 0, 1);
const NX = V(-1, 0, 0), NY = V(0, -1, 0), NZ = V(0, 0, -1);
const CY = -8;

// ------------------------------------------------------------------------------------------------ geometry helpers

/** Face frame of a module wall at axial position u (zone coords: x along, y overhead, z right). */
function wallFrame(wall, u, h, depth = 0) {
  switch (wall) {
    case 'deck': return ff(V(u, -h + depth, 0), Y, X);
    case 'overhead': return ff(V(u, h - depth, 0), NY, X);
    case 'port': return ff(V(u, 0, -h + depth), Zp, X);
    default: return ff(V(u, 0, h - depth), NZ, NX);
  }
}
/** Bevel (corner standoff) frame at u for corner (sv, sw) — face toward the axis, X along the module. */
function bevelFrame(u, h, c, sv, sw) {
  const p1 = V(u, sv * (h - c), sw * h), p2 = V(u, sv * h, sw * (h - c));
  const o = p1.clone().lerp(p2, 0.5);
  return ff(o, V(0, -sv, -sw), X);
}

/** Standard vertex bake for a rack module: AO behind the aisle planes and near the ends + overhead strip light. */
function moduleBake(h, c, ue, lite, warm = 1) {
  const ly = h - c * 0.5, lz = h - c * 0.5;
  return (x, y, z, nx, ny, nz, name) => {
    if (name === 'glow') return 1;
    const d = Math.max(Math.abs(y), Math.abs(z)) - h;
    let ao = 1 - 0.62 * sstep(-0.02, 0.4, d);
    const e = Math.abs(x) - (ue - 0.25);
    ao *= 1 - 0.3 * sstep(0, 0.9, e);
    // corner occlusion near the bevels
    const cr = Math.abs(y) + Math.abs(z) - (2 * h - c);
    ao *= 1 - 0.2 * sstep(-0.15, 0.1, cr);
    // two overhead light lines
    let L = 0;
    for (const sz of [-1, 1]) {
      const dy = ly - y, dz = sz * lz - z, dd = dy * dy + dz * dz;
      const inv = 1 / Math.sqrt(dd + 1e-6);
      const cos = Math.max(0, (nx * 0 + ny * dy + nz * dz) * inv);
      L += cos * 1.25 / (dd + 0.6);
    }
    L = Math.min(1.4, L);
    return lite ? ao * (0.32 + 0.85 * L) * warm : ao * (0.62 + 0.38 * L);
  };
}

// ------------------------------------------------------------------------------------------------ rack module

/**
 * Generic USOS-style module: octagonal aisle, rack walls, corner standoffs with lights and handrails,
 * end bulkheads with hatches. spec:
 *  id, name, center, axis, up, len, r, h, c, walls {deck, overhead, port, stbd: [types]}, windows [{c (world), n, r}],
 *  ends: { a: {kind:'cbm'|'round'|'closed', label, to, vest: len|0, door: 'open'|'closed'|null}, b: {...} },
 *  extras(Z, ctx), style: 'us'|'ru', labels {a, b}
 */
function rackModule(I, spec) {
  const { center, axis, up, len, r } = spec;
  const h = spec.h ?? 1.05, c = spec.c ?? 0.26, ru = spec.style === 'ru';
  const right = new THREE.Vector3().crossVectors(axis, up);
  const M = basis(center, axis, up, right);
  const Z = new ZoneBuilder(I, spec.id, spec.name, M, { lite: I.lite, detail: I.detail, seed: spec.seed ?? 7 });
  const K = Z.K, W = Z.W, T = I.atlas;
  const ue = len / 2 - 0.45;
  const Minv = M.clone().invert();
  const across = 2 * (h - c);

  // ---- slot layout
  const slotW = 1.05;
  const n = Math.floor((2 * ue - 0.4) / slotW);
  const u0 = -n * slotW / 2;
  const slotU = (i) => u0 + (i + 0.5) * slotW;
  const walls = ['deck', 'overhead', 'port', 'stbd'];
  const used = Object.fromEntries(walls.map((w) => [w, new Array(n).fill(false)]));

  // ---- windows -> alcoves
  for (const w of spec.windows || []) {
    const lc = w.c.clone().applyMatrix4(Minv), ln = w.n.clone().transformDirection(Minv);
    const wall = Math.abs(ln.y) > Math.abs(ln.z) ? (ln.y < 0 ? 'deck' : 'overhead') : (ln.z > 0 ? 'stbd' : 'port');
    const lo = lc.x - w.r - 0.06, hi = lc.x + w.r + 0.06;
    let i0 = n, i1 = -1;
    for (let i = 0; i < n; i++) { const s0 = u0 + i * slotW, s1 = s0 + slotW; if (s1 > lo && s0 < hi) { i0 = Math.min(i0, i); i1 = Math.max(i1, i); } }
    if (i1 < 0) continue;
    for (let i = i0; i <= i1; i++) used[wall][i] = true;
    windowAlcove(Z, wall, u0 + i0 * slotW, u0 + (i1 + 1) * slotW, lc, w.r, h, c, r, ru);
    Z.window({ type: 'disc', c: w.c, n: w.n, r: w.r });
  }

  // ---- racks
  for (const wall of walls) {
    const list = spec.walls?.[wall] || [];
    for (let i = 0; i < n; i++) {
      if (used[wall][i]) continue;
      const type = list[i % Math.max(1, list.length)] || (ru ? 'ru' : 'locker');
      if (type === 'skip') continue;
      const F = wallFrame(wall, slotU(i), h);
      rack(K, F, type, slotW, across, { laptop: type.startsWith('exp') && Z.rnd() < 0.3, label: !ru && Z.rnd() < 0.4 ? `${spec.code || 'LAB'}${wall[0].toUpperCase()}${(i % 4) + 1}` : null });
      // backplane behind the rack gap
    }
    // dark backplane behind all racks of this wall (seen through the gaps)
    W.box('paint', wallFrame(wall, 0, h, -0.16), 2 * ue, across + 0.04, 0.01, 0x18191b, null, null, 16);
  }
  // rack-edge seat tracks along every wall edge
  if (!I.lite) for (const wall of walls) for (const sy of [-1, 1]) {
    const F = wallFrame(wall, 0, h);
    seatTrack(K, pt(F, -(n * slotW) / 2, sy * (h - c - 0.02), 0.0), pt(F, (n * slotW) / 2, sy * (h - c - 0.02), 0.0), dir(F, 0, 0, 1));
  }

  // ---- corner standoffs (bevels)
  const bw = c * Math.SQRT2;
  for (const [sv, sw] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const B0 = bevelFrame(0, h, c, sv, sw);
    // continuous closeout panels per slot
    for (let i = 0; i < n; i++) {
      const B = bevelFrame(slotU(i), h, c, sv, sw);
      W.box('equip', offset(B, 0, 0, -0.012), slotW - 0.012, bw + 0.02, 0.024, 0xffffff, T.rect(ru ? 'panelRu' : (i % 3 ? 'panel' : 'panelB')), T.rect('grey'), 16);
    }
    // end filler beyond the racks
    for (const s of [-1, 1]) {
      const uu = s * (n * slotW / 2 + (ue - n * slotW / 2) / 2), ww = ue - n * slotW / 2;
      if (ww > 0.02) W.box('equip', offset(bevelFrame(uu, h, c, sv, sw), 0, 0, -0.012), ww, bw + 0.02, 0.024, 0xffffff, T.rect(ru ? 'panelRu' : 'panel'), T.rect('grey'), 16);
    }
    const top = sv > 0;
    for (let i = 0; i < n; i++) {
      const B = bevelFrame(slotU(i), h, c, sv, sw);
      if (top && i % 2 === 0) lightPanel(K, offset(B, 0, 0, 0), 0.6, Math.min(0.2, bw * 0.55));
      else if (!top && i % 2 === 1) handrail(K, pt(B, -0.3, 0, 0.0), pt(B, 0.3, 0, 0.0), dir(B, 0, 0, 1), ru ? COL.railRu : COL.rail, 0.06);
      else if (top && i % 2 === 1) handrail(K, pt(B, -0.28, 0, 0), pt(B, 0.28, 0, 0), dir(B, 0, 0, 1), ru ? COL.railRu : COL.rail, 0.06);
      if (!I.lite && Z.rnd() < 0.25) vent(K, offset(B, 0.35 * (Z.rnd() - 0.5), 0, 0.0), 0.22, Math.min(0.14, bw * 0.4));
      if (!I.lite && Z.rnd() < 0.3) velcro(K, offset(B, (Z.rnd() - 0.5) * 0.7, 0, 0.0), 0.07, 0.05);
    }
    // cable bundles along the deck-side bevels, ducts along one overhead bevel
    if (!I.lite) {
      if (!top) cables(K, [pt(B0, -ue + 0.1, bw * 0.3, 0.035), pt(B0, ue - 0.1, bw * 0.3, 0.035)], 3, 0.013);
      else if (sw > 0) duct(K, [pt(B0, -ue + 0.1, -bw * 0.32, 0.07), pt(B0, 0, -bw * 0.32, 0.075), pt(B0, ue - 0.1, -bw * 0.32, 0.07)], 0.055, 0xdedbd2);
    }
  }
  for (const wall of walls) if (ue - n * slotW / 2 > 0.02) for (const s of [-1, 1]) {
    const uu = s * (n * slotW / 2 + (ue - n * slotW / 2) / 2), ww = ue - n * slotW / 2;
    W.box('equip', offset(wallFrame(wall, uu, h), 0, 0, -0.012), ww, across, 0.024, 0xffffff, T.rect(ru ? 'panelRu' : 'panel'), T.rect('grey'), 16);
  }
  // handrails on rack faces (vertical, every few slots) and foot restraints on the deck
  for (let i = 1; i < n; i += 3) {
    for (const wall of ['port', 'stbd']) {
      if (used[wall][i] || used[wall][i - 1]) continue;
      const F = wallFrame(wall, u0 + i * slotW, h);
      handrail(K, pt(F, 0, -0.35, 0.02), pt(F, 0, 0.35, 0.02), dir(F, 0, 0, 1), ru ? COL.railRu : COL.rail, 0.07);
    }
    if (!used.deck[i]) footLoops(K, offset(wallFrame('deck', u0 + i * slotW, h), 0, 0, 0.0), 0.6, 3);
  }

  // ---- end bulkheads
  for (const [end, s] of [['a', -1], ['b', 1]]) {
    const e = spec.ends?.[end] || { kind: 'closed' };
    endBulkhead(Z, e, s, ue, h, c, ru, spec);
  }

  // ---- clutter on rack faces
  if (!I.lite) for (let i = 0; i < Math.round(n * 1.2); i++) {
    const wall = walls[Math.floor(Z.rnd() * 4)], k = Math.floor(Z.rnd() * n);
    if (used[wall][k]) continue;
    clutter(K, offset(wallFrame(wall, slotU(k), h), 0, (Z.rnd() - 0.5) * 0.6, 0.02), 0.7, 0.5, 2);
  }

  // ---- containment volume, lights, bake
  Z.box(0, 0, 0, ue - 0.02, h, h);
  Z.light(-len / 4, 0.4, 0); Z.light(len / 4, 0.4, 0);
  Z.carveCone(V(-len / 2, 0, 0), V(len / 2, 0, 0), r - 0.05);
  Z.bake = moduleBake(h, c, ue, I.lite, spec.warm ?? 1);
  Z.local = { h, c, ue, n, slotW, u0, slotU, used, across, wallFrame: (wall, u, d) => wallFrame(wall, u, h, d), bevelFrame: (u, sv, sw) => bevelFrame(u, h, c, sv, sw) };
  spec.extras?.(Z, Z.local);
  return Z;
}

/** Window alcove spanning [ua, ub] on a wall with a well out to the hull window at lc (local). */
function windowAlcove(Z, wall, ua, ub, lc, wr, h, c, r, ru) {
  const K = Z.K, W = Z.W, T = Z.I.atlas;
  const um = (ua + ub) / 2, wdt = ub - ua, across = 2 * (h - c);
  const F = wallFrame(wall, um, h);
  // window centre in the face frame
  const inv = F.clone().invert(), wc = lc.clone().applyMatrix4(inv);
  const hole = wr + 0.06;
  // alcove face with a round hole (outer rectangle sampled around the hole centre)
  const cx = wc.x, cy = wc.y;
  const hx = wdt / 2, hy = across / 2;
  const fnO = (a) => {
    // ray from (cx, cy) to the rectangle [-hx, hx] x [-hy, hy]
    const ca = Math.cos(a), sa = Math.sin(a);
    const tx = ca > 0 ? (hx - cx) / ca : ca < 0 ? (-hx - cx) / ca : Infinity;
    const ty = sa > 0 ? (hy - cy) / sa : sa < 0 ? (-hy - cy) / sa : Infinity;
    return Math.min(tx, ty);
  };
  const [o, i] = radialPair(fnO, () => hole, Z.I.lite ? 24 : 48);
  W.frame2D('equip', offset(F, cx, cy, -0.02), o, i, 0.04, 0xffffff, T.rect(ru ? 'panelRu' : 'rackBlank'), { back: false, outerWall: true, innerWall: false });
  // well: tube from the face to the hull
  const depth = Math.max(0.2, r - h - 0.08 - (wall === 'deck' || wall === 'overhead' ? 0 : 0));
  const Wm = offset(F, cx, cy, -depth);
  inwardTube(K, Wm, depth - 0.02, hole, 0x6d7076, 28);
  // trim ring at the face, frame + glass at the bottom, shutter (open) in the alcove
  W.torus('metal', offset(F, cx, cy, 0.0), hole + 0.02, 0.025, 6, 32, COL.alu);
  W.torus('metal', offset(Wm, 0, 0, 0.04), wr + 0.03, 0.03, 6, 32, COL.dark);
  W.disc('glass', offset(Wm, 0, 0, 0.06), wr + 0.02, 32);
  W.disc('glass', offset(Wm, 0, 0, 0.0), wr + 0.02, 32);
  if (!Z.I.lite) {
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; W.box('metal', offset(Wm, Math.cos(a) * (wr + 0.05), Math.sin(a) * (wr + 0.05), 0.05), 0.04, 0.04, 0.03, COL.dark); }
    // hinged scratch-pane cover, swung open
    const Hm = sub(F, cx + hole + 0.05, cy, 0.02, 'y', -1.3);
    W.chamferBox('paint', offset(Hm, -hole, 0, 0.0), hole * 2, hole * 2, 0.03, 0.01, 0xd8d6cf);
    camera(K, sub(F, cx - hole - 0.18, cy + 0.2, 0.0, 'y', 0.3));
    handrail(K, pt(F, cx - hole - 0.08, cy - 0.25, 0), pt(F, cx - hole - 0.08, cy + 0.25, 0), dir(F, 0, 0, 1), ru ? COL.railRu : COL.rail, 0.06);
    sign(K, offset(F, cx, cy + hole + 0.12, 0.0), 'ИЛЛЮМИНАТОР · WINDOW', 0.42, 0.05, { ph: 32 });
  }
  Z.carveCone(pt(Wm, 0, 0, -0.3), pt(Wm, 0, 0, 0.6), wr - 0.01);
  Z.carve[Z.carve.length - 1].kind = 'window';
}

/** End bulkhead at u = s * ue with an opening of the given kind; optionally the vestibule beyond it. */
function endBulkhead(Z, e, s, ue, h, c, ru, spec) {
  const K = Z.K, W = Z.W, T = Z.I.atlas, I = Z.I;
  const F = s > 0 ? ff(V(ue, 0, 0), NX, Zp) : ff(V(-ue, 0, 0), X, NZ);
  const nseg = I.lite ? 24 : 64;
  const oct = (a) => octRadius(h + 0.01, c, a);
  const tex = T.rect(ru ? 'panelRu' : 'bulkhead');
  if (e.kind === 'cbm') {
    const [o, i] = radialPair(oct, (a) => roundRectRadius(CBM.w / 2, CBM.w / 2, CBM.r, a), nseg);
    W.frame2D('equip', offset(F, 0, 0, -0.01), o, i, 0.04, 0xffffff, tex, { back: false, outerWall: false, innerWall: false });
    hatchFrameCBM(K, F, e.label);
    if (e.door === 'open') openDoorCBM(K, F, 1.72, e.hinge ?? 1);
    else if (e.door === 'closed') hatchDoorCBM(K, offset(F, 0, 0, 0.05));
    if (e.vest > 0) {
      vestibuleCBM(K, ff(V(s * ue, 0, 0), V(s, 0, 0), s > 0 ? NZ : Zp), e.vest, { lamp: true });
    }
    if (e.door !== 'closed') {
      const L = e.vest + 0.6;
      Z.box(s * (ue + L / 2 - 0.25), 0, 0, L / 2 + 0.05, CBM.w / 2, CBM.w / 2);
      Z.portal(e.to, V(s * (ue + 0.05), 0, 0), 0.75);
    }
  } else if (e.kind === 'round') {
    const rr = e.r ?? 0.43;
    const [o, i] = radialPair(oct, () => rr + 0.02, nseg);
    W.frame2D('equip', offset(F, 0, 0, -0.01), o, i, 0.04, 0xffffff, tex, { back: false, outerWall: false, innerWall: false });
    hatchFrameRound(K, F, rr, e.label);
    if (e.door === 'closed') hatchDoorRound(K, offset(F, 0, 0, 0.06), rr);
    else if (e.door === 'open') {
      const hinge = offset(F, rr + 0.08, 0, 0.12);
      hatchDoorRound(K, offset(rot(hinge, 'y', 1.9), -rr - 0.08, 0, 0.0), rr);
      Z.solids.push(boxSolid(offset(rot(hinge, 'y', 1.9), -rr - 0.08, 0, 0), rr, rr, 0.08, 'hatchDoor'));
    }
    if (e.vest > 0) {
      vestibuleRound(K, ff(V(s * ue, 0, 0), V(s, 0, 0), s > 0 ? NZ : Zp), e.vest, rr + 0.03);
    }
    if (e.door !== 'closed') {
      const L = (e.vest || 0) + 0.6;
      Z.cyl(V(s * (ue - 0.25), 0, 0), V(s * (ue + L), 0, 0), rr);
      Z.portal(e.to, V(s * (ue + 0.05), 0, 0), rr + 0.1);
    }
  } else {
    // closed bulkhead with a central equipment panel
    const [o] = radialPair(oct, () => 0.01, nseg);
    W.poly('equip', offset(F, 0, 0, -0.01), o, 0xffffff, tex, 0);
    rack(K, offset(F, 0, 0, 0.0), ru ? 'ruB' : e.panel || 'power', 1.2, 1.5);
  }
  // around the opening: extinguisher + PBA on one side, name sign above, egress sign, vent
  if (!I.lite) {
    const sx = (h - c) * 0.9;
    if (e.safety !== false) {
      extinguisher(K, offset(F, sx - 0.05, -0.2, 0.0));
      pba(K, offset(F, -sx + 0.08, -0.2, 0.0));
    }
    if (spec.signName) sign(K, offset(F, 0, h - 0.13, 0.0), spec.signName, 1.1, 0.13, { ph: 48, bg: ru ? '#e9e5d0' : '#f4f2ea', border: '#2a2d32' });
    egressSign(K, offset(F, -sx + 0.1, h - 0.32, 0.0), s > 0 ? 'ВЫХОД · EXIT →' : '← ВЫХОД · EXIT');
    vent(K, offset(F, sx - 0.1, h - 0.3, 0.0), 0.26, 0.14);
    cables(K, [pt(F, -sx, -h + 0.12, 0.03), pt(F, sx, -h + 0.12, 0.03)], 3, 0.012);
    handrail(K, pt(F, -0.75, -0.55, 0.0), pt(F, -0.75, 0.35, 0.0), dir(F, 0, 0, 1), ru ? COL.railRu : COL.rail, 0.07);
    handrail(K, pt(F, 0.75, -0.55, 0.0), pt(F, 0.75, 0.35, 0.0), dir(F, 0, 0, 1), ru ? COL.railRu : COL.rail, 0.07);
  }
}

// ------------------------------------------------------------------------------------------------ nodes

/**
 * Node: axial hatches (a: -X, b: +X) and four radial faces (deck/overhead/port/stbd), each with a hatch panel
 * in the middle and stowage racks either side. radial: { deck: {kind, to, len, label, door}, ... }
 */
function nodeModule(I, spec) {
  const center = V(spec.x, CY, 0);
  const M = basis(center, X, Y, Zp);
  const Z = new ZoneBuilder(I, spec.id, spec.name, M, { lite: I.lite, detail: I.detail, seed: spec.seed ?? 11 });
  const K = Z.K, W = Z.W, T = I.atlas;
  const h = 1.25, c = 0.32, ue = 2.15, across = 2 * (h - c), panel = CBM.w + 0.3;
  const walls = ['deck', 'overhead', 'port', 'stbd'];
  for (const wall of walls) {
    const rs = spec.radial[wall];
    const F = wallFrame(wall, 0, h);
    // hatch panel
    if (rs.kind === 'cbm') {
      const [o, i] = radialPair((a) => roundRectRadius(panel / 2, across / 2, 0.001, a), (a) => roundRectRadius(CBM.w / 2, CBM.w / 2, CBM.r, a), I.lite ? 24 : 64);
      W.frame2D('equip', offset(F, 0, 0, -0.01), o, i, 0.04, 0xffffff, T.rect('panel'), { back: false, outerWall: false, innerWall: false });
      hatchFrameCBM(K, F, rs.label);
      if (rs.door === 'closed') hatchDoorCBM(K, offset(F, 0, 0, 0.05));
      else if (rs.door === 'open') openDoorCBM(K, F, 2.95, rs.hinge ?? 1);
      if (rs.len > 0) vestibuleCBM(K, ff(V(0, 0, 0).applyMatrix4(F), dir(F, 0, 0, -1), dir(F, 1, 0, 0)), rs.len, { lamp: true });
      if (rs.end === 'closedCBM') hatchDoorCBM(K, ff(pt(F, 0, 0, -rs.len + 0.02), dir(F, 0, 0, 1), dir(F, 1, 0, 0)));
      if (rs.end === 'ids') idsEnd(Z, ff(pt(F, 0, 0, -rs.len), dir(F, 0, 0, 1), dir(F, 1, 0, 0)), rs.port);
      if (rs.door !== 'closed' && rs.pass !== false) {
        const L = rs.len + 0.5;
        Z.boxM(offset(F, 0, 0, -L / 2 + 0.25), CBM.w / 2, CBM.w / 2, L / 2);
        if (rs.to) Z.portal(rs.to, pt(F, 0, 0, -0.05), 0.75);
      }
    } else if (rs.kind === 'round') {
      const rr = rs.r ?? 0.43;
      const [o, i] = radialPair((a) => roundRectRadius(panel / 2, across / 2, 0.001, a), () => rr + 0.02, I.lite ? 24 : 64);
      W.frame2D('equip', offset(F, 0, 0, -0.01), o, i, 0.04, 0xffffff, T.rect('panel'), { back: false, outerWall: false, innerWall: false });
      hatchFrameRound(K, F, rr, rs.label);
      if (rs.len > 0) vestibuleRound(K, ff(pt(F, 0, 0, 0), dir(F, 0, 0, -1), dir(F, 1, 0, 0)), rs.len, rr + 0.03);
      if (rs.door === 'open') { const hinge = offset(F, rr + 0.08, 0, 0.12); hatchDoorRound(K, offset(rot(hinge, 'y', 1.9), -rr - 0.08, 0, 0), rr); }
      else if (rs.door === 'closed') hatchDoorRound(K, offset(F, 0, 0, 0.06), rr);
      if (rs.door !== 'closed') {
        const L = rs.len + 0.5;
        Z.cyl(pt(F, 0, 0, 0.25), pt(F, 0, 0, -L), rr);
        Z.portal(rs.to, pt(F, 0, 0, -0.05), rr + 0.1);
      }
    }
    // stowage / equipment either side of the hatch panel
    const sideW = ue - panel / 2;
    for (const sgn of [-1, 1]) {
      const uu = sgn * (panel / 2 + sideW / 2);
      const types = spec.side?.[wall] || { deck: ['locker', 'stow'], overhead: ['stow', 'drawers'], port: ['locker2', 'stow'], stbd: ['stow', 'locker'] }[wall];
      rack(K, wallFrame(wall, uu, h), types[sgn > 0 ? 1 : 0], sideW - 0.02, across, {});
    }
    W.box('paint', wallFrame(wall, 0, h, -0.16), 2 * ue, across + 0.04, 0.01, 0x18191b, null, null, 16);
  }
  // corner standoffs
  const bw = c * Math.SQRT2;
  for (const [sv, sw] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const B0 = bevelFrame(0, h, c, sv, sw);
    W.box('equip', offset(B0, 0, 0, -0.012), 2 * ue, bw + 0.02, 0.024, 0xffffff, T.rect('panel'), T.rect('grey'), 16);
    for (const uu of [-1.4, 0, 1.4]) {
      const B = bevelFrame(uu, h, c, sv, sw);
      if (sv > 0 && uu !== 0) lightPanel(K, B, 0.6, 0.22);
      else handrail(K, pt(B, -0.3, 0, 0), pt(B, 0.3, 0, 0), dir(B, 0, 0, 1), COL.rail, 0.06);
    }
    if (!I.lite) {
      if (sv < 0) cables(K, [pt(B0, -ue - 0.1, bw * 0.25, 0.04), pt(B0, ue + 0.1, bw * 0.25, 0.04)], 4, 0.014);
      else duct(K, [pt(B0, -ue, -bw * 0.3, 0.075), pt(B0, ue, -bw * 0.3, 0.075)], 0.06, 0xdad7ce);
      vent(K, offset(B0, 0.7, 0, 0), 0.3, 0.16);
    }
  }
  // axial ends
  for (const [end, s] of [['a', -1], ['b', 1]]) endBulkhead(Z, spec.ends[end], s, ue, h, c, false, { signName: spec.signName });
  // bags strapped in the aisle corners, crew items
  if (!I.lite) {
    for (let k = 0; k < 4; k++) {
      const B = bevelFrame((Z.rnd() - 0.5) * 3, h, c, k < 2 ? 1 : -1, k % 2 ? 1 : -1);
      bag(K, offset(B, 0, 0, 0.16), 0.42, 0.3, 0.26, Z.rnd() < 0.3 ? 'w' : 'ctb');
      bungee(K, pt(B, -0.25, -0.05, 0.3), pt(B, 0.25, -0.05, 0.3));
    }
    clutter(K, offset(wallFrame('port', 1.4, h), 0, 0.2, 0.02), 0.8, 0.6, 3);
    clutter(K, offset(wallFrame('stbd', -1.4, h), 0, -0.2, 0.02), 0.8, 0.6, 3);
    if (spec.laptop) laptop(K, offset(wallFrame(spec.laptop, -1.45, h), 0.0, 0.25, 0.02), 'scrMap', 0.3);
  }
  Z.box(0, 0, 0, ue - 0.02, h, h);
  Z.light(0, 0.5, 0);
  Z.carveCone(V(-2.5, 0, 0), V(2.5, 0, 0), 2.4);
  Z.bake = moduleBake(h, c, ue, I.lite);
  spec.extras?.(Z);
  return Z;
}

/** Closed docking-port hatch (IDSS) at the end of a radial vestibule: round hatch in a flat bulkhead + status. */
function idsEnd(Z, F, portId) {
  const K = Z.K, W = Z.W;
  const [o, i] = radialPair((a) => roundRectRadius((CBM.w + 0.1) / 2, (CBM.w + 0.1) / 2, CBM.r, a), () => 0.42, Z.I.lite ? 24 : 48);
  W.frame2D('paint', offset(F, 0, 0, -0.01), o, i, 0.02, 0xbfc2c4, null, { back: false, outerWall: false, innerWall: false });
  hatchFrameRound(K, F, 0.4, null);
  hatchDoorRound(K, offset(F, 0, 0, 0.06), 0.4);
  if (!Z.I.lite) sign(K, offset(F, 0, 0.53, 0.02), `ПОРТ ${portId} · DOCKING PORT`, 0.6, 0.06, { ph: 36, bg: '#f4f2ea', border: '#2a2d32' });
  Z.statusLamps = Z.statusLamps || [];
  Z.statusLamps.push({ port: portId, M: offset(F, 0.52, 0.42, 0.03) });
}

// ------------------------------------------------------------------------------------------------ cupola

function cupola(I, x) {
  // zone frame: origin at the cupola base centre (y = CY - 2.45), x along +X, y = nadir (down) so "up" faces Earth
  const top = CY - 2.45;
  const M = basis(V(x, top, 0), X, NY, NZ);   // local +y points down (toward Earth)
  const Z = new ZoneBuilder(I, 'cupola', 'Купол · обзорный модуль', M, { lite: I.lite, detail: I.detail, seed: 23 });
  const K = Z.K, W = Z.W, T = I.atlas;
  // local: y from 0 (base top, at the node vestibule) to 2.0 (nadir window)
  const rBase = 1.42;
  // base ring (cylinder 0..0.95) with equipment, then the frustum 1.0 .. 1.96 narrowing to the top window
  inwardTube(K, rot(V0M(), 'x', -Math.PI / 2), 0.98, rBase, 0xcfd0cc, 36);
  // the base ring carries the robotics workstation, lights, handrails
  if (!I.lite) {
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
      const F = ff(V(Math.cos(a) * (rBase - 0.02), 0.5, Math.sin(a) * (rBase - 0.02)), V(-Math.cos(a), 0, -Math.sin(a)), V(-Math.sin(a), 0, Math.cos(a)));
      if (k === 0) { laptop(K, offset(F, -0.25, 0.1, 0), 'scrEarth', 0.32); laptop(K, offset(F, 0.25, 0.1, 0), 'scrDock', 0.32); }
      else if (k === 1) { display(K, offset(F, 0, 0.1, 0.02), 0.4, 0.28, 'scrMap'); }
      else if (k === 3) { W.box('paint', offset(F, 0, -0.1, 0.08), 0.14, 0.1, 0.12, COL.dark); W.cyl('paint', sub(F, 0, -0.1, 0.18, 'x', Math.PI / 2), 0.02, 0.025, 0.12, 8, COL.black); W.box('paint', offset(F, 0.25, -0.1, 0.06), 0.12, 0.1, 0.1, COL.dark); W.sphere('paint', offset(F, 0.25, -0.03, 0.06), 0.03, 8, 6, COL.black); sign(K, offset(F, 0.1, 0.2, 0.0), 'RWS · ПУЛЬТ МАНИПУЛЯТОРА', 0.5, 0.05, { ph: 32 }); }
      else if (k === 4) { camera(K, offset(F, 0, 0.15, 0)); }
      else { clutter(K, offset(F, 0, 0, 0), 0.5, 0.4, 2); }
      handrail(K, pt(F, -0.3, -0.38, 0), pt(F, 0.3, -0.38, 0), dir(F, 0, 0, 1), COL.rail, 0.05);
      lightPanel(K, offset(F, 0, 0.36, 0), 0.4, 0.12);
    }
  }
  // frame: six trapezoid windows and the round nadir window
  const y0 = 1.0, y1 = 1.96, r0 = 1.42, r1 = 0.86;
  const ring = (y, rr) => W.torus('metal', sub(V0M(), 0, y, 0, 'x', Math.PI / 2), rr, 0.04, 8, 6, 0xbfc2c4, Math.PI * 2, Math.PI / 6);
  ring(y0, r0 + 0.02); ring(y1, r1 + 0.02);
  const vtx = (k, y, rr) => { const a = (k / 6) * Math.PI * 2 + Math.PI / 6; return V(Math.cos(a) * rr, y, Math.sin(a) * rr); };
  for (let k = 0; k < 6; k++) {
    // mullion beam between windows
    const p0 = vtx(k, y0, r0), p1 = vtx(k, y1, r1);
    W.tube('metal', [p0, p1], 0.05, 6, 0xbfc2c4);
    // window pane (inner) and shutter handle
    const q0 = vtx(k + 0.5, y0 + 0.08, r0 * Math.cos(Math.PI / 6) - 0.04), q1 = vtx(k + 0.5, y1 - 0.08, r1 * Math.cos(Math.PI / 6) - 0.04);
    const ctr = q0.clone().lerp(q1, 0.5);
    const along = q1.clone().sub(q0).normalize(), a = ((k + 0.5) / 6) * Math.PI * 2 + Math.PI / 6;
    const tang = V(-Math.sin(a), 0, Math.cos(a)), nrm = new THREE.Vector3().crossVectors(tang, along).normalize();
    const F = new THREE.Matrix4().makeBasis(tang, along, nrm).setPosition(ctr);
    const wTop = 2 * r1 * Math.sin(Math.PI / 6) - 0.1, wBot = 2 * r0 * Math.sin(Math.PI / 6) - 0.1, hh = q0.distanceTo(q1);
    const trap = [[-wBot / 2, -hh / 2], [wBot / 2, -hh / 2], [wTop / 2, hh / 2], [-wTop / 2, hh / 2]];
    W.poly('glass', F, trap, 0xffffff);
    W.poly('glass', offset(F, 0, 0, 0.04), trap, 0xffffff);
    // window frame: trapezoid ring with a seal, and the inner scratch pane retainer bolts
    const inset = (pts, d) => pts.map(([x, y]) => [x - Math.sign(x) * d * (Math.abs(y) > 0 ? 1 : 1), y - Math.sign(y) * d]);
    W.frame2D('metal', offset(F, 0, 0, 0.03), inset(trap, -0.07), inset(trap, 0.0), 0.06, 0xb5b9bd);
    W.frame2D('paint', offset(F, 0, 0, 0.065), inset(trap, 0.0), inset(trap, 0.025), 0.01, COL.seal, null, { back: false, outerWall: false, innerWall: true });
    // window shutter crank & data label
    if (!I.lite) { W.cyl('metal', sub(F, 0, -hh / 2 - 0.02, 0.0, 'x', 0), 0.012, 0.012, 0.08, 6, COL.dark); }
    Z.window({ type: 'disc', c: Z.toFrame(ctr.clone().addScaledVector(nrm, -0.08)), n: nrm.clone().transformDirection(M).negate(), r: Math.min(wBot, hh) * 0.5 });
  }
  // nadir window
  W.disc('glass', sub(V0M(), 0, y1 + 0.03, 0, 'x', -Math.PI / 2), r1 - 0.06, 32);
  W.torus('metal', sub(V0M(), 0, y1 + 0.02, 0, 'x', Math.PI / 2), r1 - 0.05, 0.035, 6, 32, COL.dark);
  Z.window({ type: 'disc', c: Z.toFrame(V(0, y1 + 0.05, 0)), n: V(0, -1, 0), r: r1 - 0.06 });
  // physics, light, carve
  Z.cyl(V(0, -0.3, 0), V(0, 1.15, 0), rBase - 0.05);
  Z.cyl(V(0, 1.1, 0), V(0, 1.7, 0), 1.0);
  Z.light(0, 0.3, 0);
  Z.up.set(0, -1, 0);   // zone-local -y = station +Y (toward the node)
  Z.carveCone(V(0, -0.05, 0), V(0, 1.0, 0), 1.5);
  Z.carveCone(V(0, 1.0, 0), V(0, 1.985, 0), 1.25, 0.72);
  Z.portal('node1', V(0, -0.2, 0), 0.7);
  Z.bake = (x, y, z, nx, ny, nz, name) => (name === 'glow' ? 1 : I.lite ? 0.95 - 0.25 * sstep(0, 1.0, -y) : 1.0 - 0.2 * sstep(0, 0.8, -y));
  Z.exposure = 0.7;
  return Z;
}
function V0M() { return new THREE.Matrix4(); }

// ------------------------------------------------------------------------------------------------ greenhouse

function greenhouse(I) {
  const center = V(0.5, CY, -8.45);
  const axis = NZ, up = Y, right = new THREE.Vector3().crossVectors(axis, up);
  const M = basis(center, axis, up, right);
  const Z = new ZoneBuilder(I, 'greenhouse', 'Оранжерея «ФЛОРА»', M, { lite: I.lite, detail: I.detail, seed: 31 });
  const K = Z.K, W = Z.W, T = I.atlas;
  const len = 12, r = 2.3, ue = len / 2 - 0.45, h = 1.05, c = 0.26, across = 2 * (h - c);
  // the window strips: zenith (overhead), +X (right) and -X (left), along u = 0.4 +- 4.5, 0.7 wide
  const stripU0 = 0.4 - 4.5, stripU1 = 0.4 + 4.5;
  // deck: growth chambers along the module (two rows); sides: plant shelves under the window strips; overhead: window
  const n = 10, slotW = 1.05, u0 = -n * slotW / 2;
  for (let i = 0; i < n; i++) {
    const u = u0 + (i + 0.5) * slotW;
    // deck chambers
    const Fd = wallFrame('deck', u, h);
    rack(K, Fd, 'blank', slotW, across);
    growthChamber(K, offset(Fd, 0, 0, 0.3), slotW - 0.1, 0.55, 0.5, ['lettuce', 'wheat', 'tomato', 'pepper', 'flower'][i % 5], i % 3 !== 1);
    // side walls: open frames around the window strip + narrow shelves with plants below
    for (const wall of ['port', 'stbd']) {
      const F = wallFrame(wall, u, h);
      const inStrip = u > stripU0 && u < stripU1;
      if (!inStrip) { rack(K, F, i % 2 ? 'expC' : 'locker2', slotW, across); continue; }
      // lower shelf with plants (below the window band), upper LED bar
      W.box('equip', offset(F, 0, -across / 2 + 0.18, -0.02), slotW - 0.02, 0.36, 0.04, 0xffffff, T.rect('rackBlank'), T.rect('grey'));
      W.box('paint', offset(F, 0, -across / 2 + 0.38, 0.12), slotW - 0.04, 0.03, 0.26, 0xe0e0dc);
      for (let k = 0; k < 4; k++) {
        const x = -slotW / 2 + (k + 0.5) * slotW / 4;
        W.cyl('paint', sub(F, x, -across / 2 + 0.43, 0.12, 'x', 0), 0.05, 0.04, 0.08, 10, 0x3d4a3a);
        plant(K, sub(F, x, -across / 2 + 0.47, 0.12, 'x', 0), ['lettuce', 'flower', 'pepper', 'wheat'][(i + k) % 4], 0.7);
      }
      W.box('equip', offset(F, 0, across / 2 - 0.12, -0.02), slotW - 0.02, 0.24, 0.04, 0xffffff, T.rect('rackBlank'), T.rect('grey'));
      W.box('glow', offset(F, 0, across / 2 - 0.27, 0.06), slotW - 0.15, 0.03, 0.06, i % 2 ? [3.5, 0.8, 2.4] : [2.8, 2.8, 2.6], null, null, 8 | 16);
      W.box('paint', offset(F, 0, across / 2 - 0.27, 0.06), slotW - 0.1, 0.045, 0.07, 0xd0d0cc, null, null, 4 | 1 | 2);
    }
    // overhead: window strip frame, LED rails along it
    const Fo = wallFrame('overhead', u, h);
    const inStrip = u > stripU0 && u < stripU1;
    if (!inStrip) rack(K, Fo, 'locker', slotW, across);
    else {
      for (const sy of [-1, 1]) W.box('equip', offset(Fo, 0, sy * (across / 2 - 0.2), -0.02), slotW - 0.02, 0.4, 0.04, 0xffffff, T.rect('rackBlank'), T.rect('grey'));
      for (const sy of [-1, 1]) W.box('glow', offset(Fo, 0, sy * 0.48, 0.05), slotW - 0.1, 0.05, 0.02, [3.4, 1.0, 2.4], null, null, 16);
    }
  }
  // window wells for the three strips (open trough to the hull)
  for (const [wall, wn] of [['overhead', Y], ['stbd', NX], ['port', X]]) {
    const F = wallFrame(wall, (stripU0 + stripU1) / 2, h);
    const depth = r - h - 0.1;
    const lenS = stripU1 - stripU0;
    // trough walls
    for (const sy of [-1, 1]) W.box('paint', offset(F, 0, sy * 0.4, -depth / 2), lenS, 0.02, depth, 0x7a7d80, null, null, sy > 0 ? 8 : 4);
    for (const sx of [-1, 1]) W.box('paint', offset(F, sx * lenS / 2, 0, -depth / 2), 0.02, 0.8, depth, 0x7a7d80, null, null, sx > 0 ? 2 : 1);
    W.box('glass', offset(F, 0, 0, -depth + 0.06), lenS, 0.8, 0.01, 0xffffff);
    for (let t = -4; t <= 4; t++) W.box('metal', offset(F, t * lenS / 9, 0, -depth + 0.1), 0.04, 0.8, 0.04, COL.dark);
    const cWorld = Z.toFrame(pt(F, 0, 0, -depth));
    const a = Z.toFrame(pt(F, -lenS / 2 + 0.35, 0, -depth)), b = Z.toFrame(pt(F, lenS / 2 - 0.35, 0, -depth));
    const nW = dir(F, 0, 0, -1).transformDirection(M);
    Z.window({ type: 'strip', a, b, n: nW, r: 0.35 });
    Z.carveBox(offset(F, 0, 0, -depth / 2), lenS / 2, 0.38, depth / 2 + 0.25);
    void cWorld; void wn;
  }
  // bevels with LED bars (pink) and handrails
  const bw = c * Math.SQRT2;
  for (const [sv, sw] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const B0 = bevelFrame(0, h, c, sv, sw);
    W.box('equip', offset(B0, 0, 0, -0.012), 2 * ue, bw + 0.02, 0.024, 0xffffff, T.rect('panel'), T.rect('grey'), 16);
    for (let i = 0; i < n; i += 2) {
      const B = bevelFrame(u0 + (i + 0.5) * slotW, h, c, sv, sw);
      if (sv > 0) lightPanel(K, B, 0.6, 0.18, i % 4 ? [3.6, 1.2, 2.8] : [3.0, 3.0, 2.8]);
      else handrail(K, pt(B, -0.3, 0, 0), pt(B, 0.3, 0, 0), dir(B, 0, 0, 1), COL.rail, 0.06);
    }
    if (!I.lite && sv < 0) cables(K, [pt(B0, -ue, bw * 0.25, 0.04), pt(B0, ue, bw * 0.25, 0.04)], 3, 0.012);
    if (!I.lite && sv > 0 && sw > 0) duct(K, [pt(B0, -ue, -0.1, 0.07), pt(B0, ue, -0.1, 0.07)], 0.05, 0xdedbd2);
  }
  // water/nutrient lines between chambers
  if (!I.lite) {
    const Fd = wallFrame('deck', 0, h);
    W.tube('metal', [pt(Fd, -n * slotW / 2, -0.62, 0.06), pt(Fd, n * slotW / 2, -0.62, 0.06)], 0.012, 6, 0x9fc0e0);
    W.tube('metal', [pt(Fd, -n * slotW / 2, 0.62, 0.06), pt(Fd, n * slotW / 2, 0.62, 0.06)], 0.012, 6, 0xe0c09f);
  }
  endBulkhead(Z, { kind: 'cbm', door: 'open', vest: 0, to: 'node2', label: 'УЗЕЛ-2 · NODE 2' }, -1, ue, h, c, false, { signName: 'ОРАНЖЕРЕЯ «ФЛОРА» · GREENHOUSE' });
  endBulkhead(Z, { kind: 'cbm', door: 'closed', vest: 0, label: 'ПОРТ P2 · DOCKING' }, 1, ue, h, c, false, { signName: 'ПОРТ P2' });
  Z.box(0, 0, 0, ue - 0.02, h, h);
  Z.light(-3, 0.4, 0); Z.light(3, 0.4, 0);
  Z.carveCone(V(-len / 2, 0, 0), V(len / 2, 0, 0), r - 0.05);
  const base = moduleBake(h, c, ue, I.lite);
  Z.bake = (x, y, z, nx, ny, nz, name) => {
    const f = base(x, y, z, nx, ny, nz, name);
    return name === 'plant' ? f * 1.15 : f;
  };
  Z.tint = new THREE.Color(1.0, 0.82, 0.95);
  return Z;
}

// ------------------------------------------------------------------------------------------------ stowage closet

function stowage(I) {
  // vertical closet below node 3: axis -Y, local x = down
  const center = V(17.5, CY - 4.0, 0);
  const M = basis(center, NY, X, new THREE.Vector3().crossVectors(NY, X));
  const Z = new ZoneBuilder(I, 'stowage', 'Кладовая · складской отсек', M, { lite: I.lite, detail: I.detail, seed: 41 });
  const K = Z.K, W = Z.W, T = I.atlas;
  const rr = 1.32, len = 3.2, ue = 1.4;
  inwardTube(K, rot(new THREE.Matrix4(), 'y', Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(-ue - 0.05, 0, 0)), 2 * ue + 0.1, rr, 0xd8d5cc, 32);
  // shelves of bags around the wall
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    for (let j = 0; j < 3; j++) {
      const x = -ue + 0.45 + j * 0.8;
      const F = ff(V(x, Math.cos(a) * (rr - 0.3), Math.sin(a) * (rr - 0.3)), V(0, -Math.cos(a), -Math.sin(a)), X);
      bag(K, F, 0.7, 0.42, 0.5, (k + j) % 4 === 0 ? 'w' : (k + j) % 5 === 0 ? 'b' : 'ctb');
      if (!I.lite) bungee(K, pt(F, -0.38, 0.25, 0.26), pt(F, 0.38, 0.25, 0.26));
    }
  }
  // end wall (bottom) with a light, closed
  const Fe = ff(V(ue, 0, 0), NX, Zp);
  W.disc('equip', offset(Fe, 0, 0, 0), rr, 32, 0xffffff, T.rect('panel'));
  lightPanel(K, offset(Fe, 0, 0.6, 0), 0.5, 0.18);
  sign(K, offset(Fe, 0, 0.2, 0.01), 'КЛАДОВАЯ · STOWAGE', 0.7, 0.08, { ph: 40 });
  handrail(K, pt(Fe, -0.5, -0.3, 0), pt(Fe, 0.5, -0.3, 0), dir(Fe, 0, 0, 1));
  // top: CBM opening to node 3 (vestibule built by the node)
  const Ft = ff(V(-ue, 0, 0), X, NZ);
  const [o, i] = radialPair(() => rr, (a) => roundRectRadius(CBM.w / 2, CBM.w / 2, CBM.r, a), I.lite ? 24 : 48);
  W.frame2D('equip', offset(Ft, 0, 0, 0), o, i, 0.03, 0xffffff, T.rect('panel'), { back: false, outerWall: false, innerWall: false });
  hatchFrameCBM(K, Ft, null);
  for (const a of [0.5, 2.6, 4.7]) lightPanel(K, ff(V(-0.2, Math.cos(a) * (rr - 0.05), Math.sin(a) * (rr - 0.05)), V(0, -Math.cos(a), -Math.sin(a)), X), 0.5, 0.15);
  Z.cyl(V(-ue, 0, 0), V(ue - 0.05, 0, 0), 0.72);
  Z.box(-ue - 0.3, 0, 0, 0.45, CBM.w / 2, CBM.w / 2);
  Z.portal('node3', V(-ue - 0.1, 0, 0), 0.75);
  Z.light(0, 0, 0);
  Z.up.set(0, 1, 0);
  Z.carveCone(V(-len / 2 - 0.6, 0, 0), V(len / 2, 0, 0), 1.45);
  Z.bake = (x, y, z, nx, ny, nz, name) => (name === 'glow' ? 1 : (I.lite ? 0.85 : 1) * (1 - 0.45 * sstep(0.7, 1.3, Math.hypot(y, z))));
  return Z;
}

// ------------------------------------------------------------------------------------------------ docking hub

function dockingHub(I, ports) {
  const HX = 39, HR = 3.1, HL = 6;
  const M = basis(V(HX, CY, 0), X, Y, Zp);
  const Z = new ZoneBuilder(I, 'hub', 'Стыковочный узел «ГАВАНЬ»', M, { lite: I.lite, detail: I.detail, seed: 51 });
  const K = Z.K, W = Z.W, T = I.atlas;
  const ap = 2.75, ue = HL / 2 - 0.25;   // interior apothem, half length
  // six faces at angles 30 + 60k (from +Z toward +Y): each with a round hatch, panels and lights between
  const faceDir = (k) => { const a = (k / 6) * Math.PI * 2 + Math.PI / 6; return V(0, Math.sin(a), Math.cos(a)); };
  const portAt = { 0: 'H5', 1: null, 2: 'H6', 3: 'H4', 4: 'H3', 5: 'H2' };
  const side = 2 * ap * Math.tan(Math.PI / 6);
  for (let k = 0; k < 6; k++) {
    const d = faceDir(k);
    const F = ff(d.clone().multiplyScalar(ap), d.clone().negate(), X);
    const id = portAt[k];
    const rr = id === 'H5' || id === 'H6' ? 0.4 : 0.48;
    const [o, i] = radialPair((a) => roundRectRadius(ue, side / 2, 0.001, a), () => rr + 0.02, I.lite ? 24 : 64);
    W.frame2D('equip', offset(F, 0, 0, -0.01), o, i, 0.04, 0xffffff, T.rect(k % 2 ? 'panel' : 'panelB'), { back: false, outerWall: false, innerWall: false });
    hatchFrameRound(K, F, rr, id ? `ПОРТ ${id}` : 'К ФЕРМЕ · TRUSS');
    vestibuleRound(K, ff(pt(F, 0, 0, 0), d, X), 0.35, rr + 0.03, { jumpers: false });
    hatchDoorRound(K, ff(pt(F, 0, 0, -0.33), d.clone().negate(), X), rr);
    if (id) { Z.statusLamps = Z.statusLamps || []; Z.statusLamps.push({ port: id, M: offset(F, rr + 0.25, rr + 0.1, 0.03) }); }
    // equipment either side of the hatch along X
    if (!I.lite) {
      for (const sx of [-1, 1]) {
        const ux = sx * 1.9;
        if ((k + (sx > 0 ? 1 : 0)) % 3 === 0) display(K, offset(F, ux, 0.15, 0.0), 0.5, 0.32, k % 2 ? 'scrDock' : 'scrEarth');
        else if ((k + (sx > 0 ? 1 : 0)) % 3 === 1) { bag(K, offset(F, ux, 0.0, 0.16), 0.55, 0.4, 0.3, 'ctb'); bungee(K, pt(F, ux - 0.32, 0.25, 0.32), pt(F, ux + 0.32, 0.25, 0.32)); }
        else { rack(K, offset(F, ux, 0, 0), 'drawers', 0.9, Math.min(1.4, side - 0.2)); }
        handrail(K, pt(F, ux - 0.35, -side / 2 + 0.2, 0), pt(F, ux + 0.35, -side / 2 + 0.2, 0), dir(F, 0, 0, 1));
      }
      cables(K, [pt(F, -ue + 0.05, side / 2 - 0.08, 0.03), pt(F, ue - 0.05, side / 2 - 0.08, 0.03)], 3, 0.012);
    }
    Z.cyl(pt(F, 0, 0, 0.3), pt(F, 0, 0, -0.3), rr);
    // light strip at the hex edge
    const e = faceDir(k + 0.5).multiplyScalar(ap / Math.cos(Math.PI / 6) - 0.05);
    lightPanel(K, ff(e, e.clone().negate(), X), 1.2, 0.1);
  }
  // end walls: aft (to the service tunnel, round hatch) and forward (H1 axial port)
  for (const [s, label] of [[-1, 'ВЕКТОР · SERVICE'], [1, 'ПОРТ H1']]) {
    const F = s > 0 ? ff(V(ue, 0, 0), NX, Zp) : ff(V(-ue, 0, 0), X, NZ);
    const rr = 0.48;
    const [o, i] = radialPair((a) => ap / Math.cos(((a % (Math.PI / 3)) + Math.PI / 3) % (Math.PI / 3) - Math.PI / 6) * 1.0, () => rr + 0.02, I.lite ? 30 : 72, 0);
    W.frame2D('equip', offset(F, 0, 0, -0.01), o, i, 0.04, 0xffffff, T.rect('panel'), { back: false, outerWall: false, innerWall: false });
    hatchFrameRound(K, F, rr, label);
    if (s > 0) {
      vestibuleRound(K, ff(V(ue, 0, 0), X, NZ), 0.4, rr + 0.03, { jumpers: false });
      hatchDoorRound(K, ff(V(ue + 0.38, 0, 0), NX, Zp), rr);
      Z.statusLamps = Z.statusLamps || []; Z.statusLamps.push({ port: 'H1', M: offset(F, rr + 0.3, 0.3, 0.03) });
      Z.cyl(V(ue - 0.3, 0, 0), V(ue + 0.3, 0, 0), rr);
    } else {
      const hinge = offset(F, rr + 0.08, 0, 0.12);
      hatchDoorRound(K, offset(rot(hinge, 'y', 1.9), -rr - 0.08, 0, 0), rr);
      Z.cyl(V(-ue + 0.3, 0, 0), V(-ue - 0.6, 0, 0), rr);
      Z.portal('svcTunnel', V(-ue - 0.05, 0, 0), rr + 0.1);
    }
    if (!I.lite) {
      sign(K, offset(F, 0, 1.5, 0), 'СТЫКОВОЧНЫЙ УЗЕЛ «ГАВАНЬ» · DOCKING HUB', 1.6, 0.12, { ph: 48, border: '#2a2d32' });
      extinguisher(K, offset(F, 1.3, -0.6, 0)); pba(K, offset(F, -1.3, -0.6, 0));
      laptop(K, offset(F, -1.2, 0.7, 0), 'scrDock', 0.3);
    }
  }
  // the central volume: hex prism approximated by a cylinder of the apothem
  Z.cyl(V(-ue + 0.02, 0, 0), V(ue - 0.02, 0, 0), ap - 0.02);
  Z.light(-1.5, 0.8, 0); Z.light(1.5, -0.8, 0);
  Z.carveCone(V(-HL / 2 - 0.3, 0, 0), V(HL / 2 + 0.3, 0, 0), HR - 0.15);
  Z.bake = (x, y, z, nx, ny, nz, name) => {
    if (name === 'glow') return 1;
    const rr2 = Math.hypot(y, z);
    const ao = 1 - 0.5 * sstep(ap - 0.05, ap + 0.4, rr2) - 0.2 * sstep(ue - 0.2, ue + 0.4, Math.abs(x));
    return I.lite ? ao * 0.95 : ao;
  };
  return Z;
}

// ------------------------------------------------------------------------------------------------ tunnels

/** Service module -> hub tunnel (round, 0.5 m radius) */
function serviceTunnel(I) {
  const x0 = 33.55, x1 = 36.25;
  const M = basis(V((x0 + x1) / 2, CY, 0), X, Y, Zp);
  const Z = new ZoneBuilder(I, 'svcTunnel', 'Переходной тоннель «ВЕКТОР — ГАВАНЬ»', M, { lite: I.lite, detail: I.detail, seed: 61 });
  const K = Z.K, W = Z.W;
  const L = x1 - x0, rr = 0.55;
  inwardTube(K, sub(new THREE.Matrix4(), -L / 2, 0, 0, 'y', Math.PI / 2), L, rr, 0xc8cbc0, 28);
  if (!I.lite) {
    for (let t = -L / 2 + 0.3; t < L / 2; t += 0.6) W.torus('metal', sub(new THREE.Matrix4(), t, 0, 0, 'y', Math.PI / 2), rr - 0.02, 0.018, 4, 24, COL.dark);
    cables(K, [V(-L / 2, -0.38, 0.3), V(L / 2, -0.38, 0.3)], 4, 0.012);
    duct(K, [V(-L / 2, 0.35, -0.3), V(L / 2, 0.35, -0.3)], 0.05);
  }
  lightPanel(K, ff(V(0, rr - 0.02, 0), NY, X), 0.6, 0.12);
  handrail(K, V(-0.5, -0.45, -0.28), V(0.5, -0.45, -0.28), V(0, 1, 0.6).normalize());
  Z.cyl(V(-L / 2 - 0.4, 0, 0), V(L / 2 + 0.4, 0, 0), 0.45);
  Z.portal('service', V(-L / 2, 0, 0), 0.6);
  Z.portal('hub', V(L / 2, 0, 0), 0.6);
  Z.light(0, 0.2, 0);
  Z.carveCone(V(-L / 2 - 0.2, 0, 0), V(L / 2 + 0.1, 0, 0), 0.6);
  Z.bake = (x, y, z, nx, ny, nz, name) => (name === 'glow' ? 1 : I.lite ? 0.8 : 0.9);
  return Z;
}

/** Zenith shaft from node 2 up through the pylon into the truss, then the long spine tunnel aft to the ring hub. */
function spineTunnel(I) {
  // frame: station frame directly (identity)
  const M = new THREE.Matrix4();
  const Z = new ZoneBuilder(I, 'spine', 'Тоннель фермы · к кольцу', M, { lite: I.lite, detail: I.detail, seed: 71 });
  const K = Z.K, W = Z.W, T = I.atlas;
  const sx = 0.5, yBot = -6.6, yT = -1.0, rr = 0.85, xEnd = -36.9;
  // junction chamber (2 x 2 x 2 m box) at the top of the shaft: the shaft enters its floor, the tunnel leaves its -X wall
  const jx0 = sx - 1.0, jx1 = sx + 1.0, jy0 = yT - 1.0, jy1 = yT + 1.0;
  inwardTube(K, ff(V(sx, yBot, 0), Y, X), jy0 - yBot, rr, 0xd2d0c6, 28);
  inwardTube(K, ff(V(jx0, yT, 0), NX, Zp), jx0 - xEnd, rr, 0xd2d0c6, 28);
  {
    const sq = (a) => roundRectRadius(1.0, 1.0, 0.05, a), hole = () => rr;
    const [o, i] = radialPair(sq, hole, I.lite ? 24 : 48);
    W.frame2D('equip', ff(V(sx, jy0, 0), Y, X), o, i, 0.02, 0xffffff, T.rect('panel'), { back: false, outerWall: false, innerWall: false });
    W.frame2D('equip', ff(V(jx0, yT, 0), X, NZ), o, i, 0.02, 0xffffff, T.rect('panel'), { back: false, outerWall: false, innerWall: false });
    W.box('equip', ff(V(jx1, yT, 0), NX, Zp), 2.0, 2.0, 0.02, 0xffffff, T.rect('panelB'), null, 16);
    W.box('equip', ff(V(sx, jy1, 0), NY, X), 2.0, 2.0, 0.02, 0xffffff, T.rect('panel'), null, 16);
    W.box('equip', ff(V(sx, yT, 1.0), NZ, NX), 2.0, 2.0, 0.02, 0xffffff, T.rect('panel'), null, 16);
    W.box('equip', ff(V(sx, yT, -1.0), Zp, X), 2.0, 2.0, 0.02, 0xffffff, T.rect('panelB'), null, 16);
    hatchFrameRound(K, ff(V(jx0, yT, 0), X, NZ), rr - 0.05, '→ КОЛЬЦО · RING');
    lightPanel(K, ff(V(sx, jy1, 0), NY, X), 0.7, 0.25);
    if (!I.lite) {
      rack(K, ff(V(sx, yT, -1.0), Zp, X), 'drawers', 1.05, 1.5);
      display(K, ff(V(sx, yT + 0.1, 1.0), NZ, NX), 0.5, 0.32, 'scrRing');
      extinguisher(K, ff(V(jx1, yT - 0.2, 0.5), NX, Zp));
      pba(K, ff(V(jx1, yT - 0.2, -0.5), NX, Zp));
      sign(K, ff(V(jx1, yT + 0.65, 0), NX, Zp), 'ПЕРЕХОДНАЯ КАМЕРА · JUNCTION', 0.9, 0.09, { ph: 40, border: '#2a2d32' });
      for (const sz of [-1, 1]) handrail(K, V(sx - 0.6, yT - 0.97, sz * 0.6), V(sx + 0.6, yT - 0.97, sz * 0.6), Y, COL.rail, 0.06);
    }
  }
  // shaft bottom ring (annulus between the node vestibule and the shaft wall)
  W.frame2D('paint', ff(V(sx, yBot, 0), Y, X), circle(rr + 0.01, 32), circle(0.48, 32), 0.02, 0xbcbfb6, null, { back: false, outerWall: false, innerWall: false });
  // ribs, ladder rungs in the shaft, light strips, handrail line, cable trays
  for (let y = yBot + 0.4; y < jy0 - 0.2; y += 0.5) {
    W.torus('metal', sub(new THREE.Matrix4(), sx, y, 0, 'x', Math.PI / 2), rr - 0.02, 0.02, 4, 24, COL.dark);
    handrail(K, V(sx - 0.22, y + 0.2, -rr + 0.02), V(sx + 0.22, y + 0.2, -rr + 0.02), Zp, COL.rail, 0.06);
  }
  for (let x = jx0 - 0.4; x > xEnd + 0.3; x -= 1.5) {
    W.torus('metal', sub(new THREE.Matrix4(), x, yT, 0, 'y', Math.PI / 2), rr - 0.02, 0.025, 4, 24, COL.dark);
    if (Math.round(x * 10) % 3 === 0) lightPanel(K, ff(V(x - 0.75, yT + rr - 0.03, 0), NY, X), 0.6, 0.14);
    else lightPanel(K, ff(V(x - 0.75, yT + rr * 0.7, rr * 0.7), V(0, -1, -1), X), 0.5, 0.12);
    handrail(K, V(x - 0.25, yT - rr + 0.03, 0.18), V(x - 1.2, yT - rr + 0.03, 0.18), Y, COL.rail, 0.06);
    if (!I.lite && Z.rnd() < 0.2) sign(K, ff(V(x - 0.5, yT, rr - 0.03), NZ, NX), `ФЕРМА · СЕКЦИЯ ${Math.round(-x / 5.5) + 1}`, 0.5, 0.06, { ph: 32 });
  }
  if (!I.lite) {
    cables(K, [V(sx - 0.2, yT - 0.62, -0.5), V(xEnd + 0.2, yT - 0.62, -0.5)], 4, 0.013);
    cables(K, [V(sx - 0.2, yT + 0.55, -0.6), V(xEnd + 0.2, yT + 0.55, -0.6)], 3, 0.012);
    duct(K, [V(sx - 0.3, yT + 0.6, 0.5), V(xEnd + 0.2, yT + 0.6, 0.5)], 0.06);
    cables(K, [V(sx + 0.6, yBot, -0.6), V(sx + 0.6, yT - 0.4, -0.6)], 3, 0.012);
    for (const x of [-12, -24]) {
      // pressure bulkhead with an open round hatch midway
      const F = ff(V(x, yT, 0), X, NZ);
      W.frame2D('paint', F, circle(rr + 0.01, 32), circle(0.5, 32), 0.08, 0xbcbfb6);
      hatchFrameRound(K, F, 0.48, x === -12 ? '→ КОЛЬЦО · RING' : '→ УЗЕЛ-2 · NODE 2');
      const hinge = offset(F, 0.56, 0, 0.12);
      hatchDoorRound(K, offset(rot(hinge, 'y', 1.9), -0.56, 0, 0), 0.48);
      egressSign(K, offset(F, 0, 0.62, 0.02), x === -12 ? 'КОЛЬЦО · RING →' : '← УЗЕЛ-2', 0.42);
    }
    // end at the ring hub: round hatch in the hub's end dome (opening built by the hub zone)
  }
  sign(K, ff(V(sx, yBot + 0.8, -rr + 0.03), Zp, X), 'ТОННЕЛЬ К КОЛЬЦУ · RING ACCESS', 0.8, 0.08, { ph: 40, bg: '#e9e5d0' });
  // volumes
  Z.cyl(V(sx, yBot - 0.3, 0), V(sx, jy0 + 0.3, 0), rr - 0.08);
  Z.box(sx, yT, 0, 0.98, 0.98, 0.98);
  Z.cyl(V(jx0 + 0.3, yT, 0), V(xEnd - 0.4, yT, 0), rr - 0.08);
  Z.portal('node2', V(sx, yBot, 0), 0.6);
  Z.portal('ringHub', V(xEnd, yT, 0), 0.6);
  Z.light(sx, -4, 0); Z.light(-10, yT, 0);
  Z.carveCone(V(sx, yBot - 0.1, 0), V(sx, jy0, 0), rr + 0.12);
  Z.carveBox(new THREE.Matrix4().makeTranslation(sx, yT, 0), 1.05, 1.05, 1.05);
  Z.carveCone(V(jx0, yT, 0), V(xEnd - 0.1, yT, 0), rr + 0.12);
  Z.bake = (x, y, z, nx, ny, nz, name) => (name === 'glow' ? 1 : I.lite ? 0.85 : 0.95);
  Z.up.set(0, 1, 0);
  Z.exposure = 1.1;
  return Z;
}

// ------------------------------------------------------------------------------------------------ module set

/** Build all core zones. Returns an array of ZoneBuilder (not finished). */
export function buildCore(I, station) {
  const zones = [];
  const mod = (s) => { const z = rackModule(I, s); zones.push(z); return z; };
  const W = (c, n, r) => ({ c, n, r });

  // ---- logistics «ЛАРЕЦ»: stowage
  mod({
    id: 'logistics', name: 'Грузовой модуль «ЛАРЕЦ»', code: 'LOG', center: V(-25.5, CY, 0), axis: X, up: Y, len: 9, r: 2.3, seed: 101,
    windows: [W(V(-25.5, -10.3, 0), NY, 0.25)],
    walls: { deck: ['stow', 'stow', 'locker', 'stow', 'stow', 'locker2', 'stow'], overhead: ['stow', 'locker', 'stow', 'stow', 'drawers', 'stow', 'stow'], port: ['stow', 'stow', 'stow', 'drawers', 'stow', 'stow', 'stow'], stbd: ['locker', 'stow', 'stow', 'stow', 'stow', 'power', 'stow'] },
    ends: { a: { kind: 'closed', panel: 'prop' }, b: { kind: 'cbm', door: 'open', vest: 0, to: 'node1', label: 'УЗЕЛ-1 · NODE 1' } },
    signName: 'ГРУЗОВОЙ МОДУЛЬ «ЛАРЕЦ» · LOGISTICS',
    extras: (Z, L) => {
      const K = Z.K;
      if (I.lite) return;
      // bags strapped along the overhead in the aisle, an inventory laptop
      for (let i = 0; i < 4; i++) {
        const F = L.wallFrame('overhead', -3 + i * 1.6, 0.25);
        bag(K, offset(F, 0, 0, 0), 0.6, 0.45, 0.35, i % 2 ? 'w' : 'ctb');
        bungee(K, pt(F, -0.35, -0.3, 0.2), pt(F, 0.35, -0.3, 0.2));
        bungee(K, pt(F, -0.35, 0.3, 0.2), pt(F, 0.35, 0.3, 0.2));
      }
      laptop(K, offset(L.wallFrame('port', 2.1), 0.0, 0.3, 0.02), 'scrText', 0.28);
      sign(K, offset(L.wallFrame('stbd', 0), 0, 0.72, 0.01), 'ИНВЕНТАРИЗАЦИЯ · IMS', 0.5, 0.06, { ph: 32 });
    },
  });

  // ---- lab «ИСТОК»
  mod({
    id: 'lab', name: 'Лабораторный модуль «ИСТОК»', code: 'LAB', center: V(-9, CY, 0), axis: X, up: Y, len: 14, r: 2.3, seed: 103,
    windows: [W(V(-10.5, -10.3, 0), NY, 0.32), W(V(-7.5, -10.3, 0), NY, 0.32), W(V(-9, -8, 2.3), Zp, 0.32)],
    walls: {
      deck: ['freezer', 'freezer', 'expA', 'locker', 'expB', 'drawers', 'expC', 'locker', 'expA', 'stow', 'locker2', 'power'],
      overhead: ['locker', 'drawers', 'expB', 'locker', 'stow', 'locker2', 'drawers', 'expA', 'locker', 'expC', 'stow', 'locker'],
      port: ['expA', 'glovebox', 'expB', 'freezer', 'expC', 'locker', 'expA', 'skip', 'expB', 'drawers', 'locker', 'power'],
      stbd: ['locker', 'expC', 'glovebox', 'expA', 'expB', 'locker', 'expA', 'drawers', 'expC', 'locker2', 'expB', 'stow'],
    },
    ends: { a: { kind: 'cbm', door: 'open', vest: 0, to: 'node1', label: 'УЗЕЛ-1 · NODE 1' }, b: { kind: 'cbm', door: 'open', vest: 0, to: 'node2', label: 'УЗЕЛ-2 · NODE 2' } },
    signName: 'ЛАБОРАТОРИЯ «ИСТОК» · LABORATORY',
    extras: (Z, L) => {
      const K = Z.K;
      // microscope bench on the port 'skip' rack slot
      const Fm = L.wallFrame('port', L.slotU(7));
      rack(K, Fm, 'blank', 1.05, L.across);
      microscope(K, offset(Fm, 0, -0.1, 0.02));
      Z.solids.push(boxSolid(offset(Fm, 0, -0.1, 0.25), 0.3, 0.3, 0.25));
      if (I.lite) return;
      laptop(K, offset(L.wallFrame('stbd', L.slotU(3)), 0, 0.35, 0.02), 'scrGraph', 0.32);
      laptop(K, offset(L.wallFrame('deck', L.slotU(9)), 0, 0.2, 0.02), 'scrMicro', 0.3);
      // experiment cables crossing the aisle corners, a camera on the overhead
      camera(K, offset(L.wallFrame('overhead', 2.0), 0.4, 0.5, 0.02));
      sign(K, offset(L.wallFrame('stbd', L.slotU(9)), 0, 0.73, 0.01), 'ФИЗИКА ЖИДКОСТЕЙ · FLUIDS', 0.5, 0.05, { ph: 32 });
      // mission patches + crew photo on a closeout
      Z.W.box('equip', offset(L.wallFrame('port', L.slotU(5)), 0.25, 0.55, 0.004), 0.16, 0.16, 0.004, 0xffffff, I.atlas.rect('patch'), null, 16);
      Z.W.box('equip', offset(L.wallFrame('port', L.slotU(5)), -0.2, 0.55, 0.004), 0.14, 0.18, 0.004, 0xffffff, I.atlas.rect('photoCrew'), null, 16);
    },
  });

  // ---- hab2 «МЕРИДИАН»: crew quarters, galley, wardroom
  mod({
    id: 'hab2', name: 'Жилой модуль «МЕРИДИАН»', code: 'HAB', center: V(9, CY, 0), axis: X, up: Y, len: 12, r: 2.6, h: 1.12, c: 0.28, seed: 107,
    windows: [W(V(7.8, -10.6, 0), NY, 0.32), W(V(10.2, -10.6, 0), NY, 0.32), W(V(9, -8, 2.6), Zp, 0.32), W(V(9, -8, -2.6), NZ, 0.32)],
    walls: {
      deck: ['galley', 'galley', 'drawers', 'locker', 'skip', 'skip', 'locker', 'locker2', 'cq', 'cq'],
      overhead: ['galley', 'locker', 'drawers', 'locker', 'skip', 'skip', 'stow', 'locker', 'cq', 'cq'],
      port: ['galley', 'skip', 'locker', 'drawers', 'skip', 'skip', 'locker2', 'stow', 'cq', 'cq'],
      stbd: ['galley', 'skip', 'drawers', 'locker', 'skip', 'skip', 'stow', 'locker', 'cq', 'cq'],
    },
    ends: { a: { kind: 'cbm', door: 'open', vest: 0, to: 'node2', label: 'УЗЕЛ-2 · NODE 2' }, b: { kind: 'cbm', door: 'open', vest: 0, to: 'node3', label: 'УЗЕЛ-3 · NODE 3' } },
    signName: 'ЖИЛОЙ МОДУЛЬ «МЕРИДИАН» · HABITATION',
    extras: (Z, L) => {
      const K = Z.K, W2 = Z.W, T = I.atlas;
      const h = 1.12;
      // galley: food warmer, potable water dispenser on the port 'skip' slot 1 and stbd slot 1
      const Fg = L.wallFrame('port', L.slotU(1));
      rack(K, Fg, 'blank', 1.05, L.across);
      W2.chamferBox('paint', offset(Fg, 0, 0.25, 0.12), 0.55, 0.32, 0.22, 0.03, 0x5a5e63);
      sign(K, offset(Fg, 0, 0.25, 0.232), 'ПОДОГРЕВАТЕЛЬ · FOOD WARMER', 0.5, 0.06, { ph: 32 });
      W2.box('glow', offset(Fg, 0.2, 0.15, 0.232), 0.03, 0.03, 0.002, [0.2, 2.5, 0.4], null, null, 16);
      const Fw = L.wallFrame('stbd', L.slotU(1));
      rack(K, Fw, 'blank', 1.05, L.across);
      W2.chamferBox('paint', offset(Fw, 0, 0.1, 0.1), 0.42, 0.5, 0.2, 0.03, 0xdfe1e2);
      W2.box('equip', offset(Fw, 0, 0.22, 0.202), 0.3, 0.12, 0.004, 0xffffff, T.rect('scrText'), null, 16);
      sign(K, offset(Fw, 0, -0.22, 0.202), 'ВОДА · POTABLE WATER', 0.36, 0.05, { ph: 32 });
      W2.tube('paint', curve([pt(Fw, 0.15, -0.1, 0.2), pt(Fw, 0.25, -0.35, 0.35), pt(Fw, 0.1, -0.45, 0.45)], 8), 0.01, 5, 0xdedede);
      // wardroom: the table in the aisle (middle section), with straps and velcro, food packets, drink bags
      const Ft = L.wallFrame('deck', -0.0);
      W2.box('metal', offset(Ft, 0, 0, 0.32), 0.08, 0.08, 0.64, COL.dark);
      W2.chamferBox('equip', offset(Ft, 0, 0, 0.66), 1.1, 0.75, 0.04, 0.012, 0xffffff, T.rect('rackBlank'));
      for (let k = 0; k < 6; k++) {
        const a = Z.rnd() * 6.28, rr = 0.2 + Z.rnd() * 0.25;
        if (k % 2) W2.chamferBox('paint', offset(Ft, Math.cos(a) * rr, Math.sin(a) * rr * 0.7, 0.7), 0.1, 0.13, 0.03, 0.01, [0.8, 0.77, 0.68]);
        else W2.box('equip', offset(Ft, Math.cos(a) * rr, Math.sin(a) * rr * 0.7, 0.69), 0.1, 0.14, 0.02, 0xffffff, T.label(['БОРЩ', 'ТВОРОГ', 'MAC&CHEESE', 'КОФЕ', 'ЧАЙ', 'ОВСЯНКА'][k], { w: 128, h: 48, bg: '#efe9d6' }));
      }
      for (const sx of [-1, 1]) bungee(K, pt(Ft, sx * 0.55, -0.35, 0.69), pt(Ft, sx * 0.55, 0.35, 0.69));
      Z.solids.push(boxSolid(offset(Ft, 0, 0, 0.66), 0.55, 0.38, 0.05, 'table'));
      Z.solids.push(boxSolid(offset(Ft, 0, 0, 0.32), 0.06, 0.06, 0.32, 'tableLeg'));
      // middle 'skip' slots on overhead/port/stbd: lights, photos, patches, a flag, a screen
      for (const wall of ['overhead', 'port', 'stbd']) {
        for (const k of [4, 5]) {
          const F = L.wallFrame(wall, L.slotU(k));
          if (L.used[wall][k]) continue;
          rack(K, F, 'blank', 1.05, L.across);
          if (wall === 'overhead') lightPanel(K, offset(F, 0, 0, 0.0), 0.7, 0.3);
        }
      }
      if (!I.lite) {
        W2.box('equip', offset(L.wallFrame('port', L.slotU(6)), 0, 0.6, 0.004), 0.3, 0.2, 0.004, 0xffffff, T.rect('flagRu'), null, 16);
        display(K, offset(L.wallFrame('port', L.slotU(3)), 0, 0.45, 0.02), 0.5, 0.32, 'scrMap');
        W2.box('equip', offset(L.wallFrame('stbd', L.slotU(6)), 0, 0.55, 0.004), 0.3, 0.2, 0.004, 0xffffff, T.rect('photoEarth'), null, 16);
        for (let k = 0; k < 3; k++) W2.box('equip', offset(L.wallFrame('stbd', L.slotU(7)), -0.3 + k * 0.3, 0.6, 0.004), 0.14, 0.14, 0.004, 0xffffff, T.rect('patch'), null, 16);
        clutter(K, offset(L.wallFrame('port', L.slotU(2)), 0, 0, 0.02), 0.8, 0.6, 4);
      }
    },
  });

  // ---- hab1 «ГОРИЗОНТ»: exercise + hygiene
  mod({
    id: 'hab1', name: 'Модуль «ГОРИЗОНТ» · спорт и гигиена', code: 'HAB1', center: V(0.5, CY, 7.45), axis: Zp, up: Y, len: 10, r: 2.3, seed: 109,
    windows: [W(V(0.5, -10.3, 6.45), NY, 0.32), W(V(0.5, -10.3, 8.45), NY, 0.32), W(V(-1.8, -8, 7.45), NX, 0.32)],
    walls: {
      deck: ['skip', 'skip', 'skip', 'skip', 'skip', 'skip', 'skip', 'skip'],
      overhead: ['locker', 'drawers', 'stow', 'locker', 'locker2', 'drawers', 'locker', 'stow'],
      port: ['skip', 'skip', 'locker', 'drawers', 'locker2', 'stow', 'locker', 'locker'],
      stbd: ['skip', 'skip', 'locker', 'skip', 'skip', 'skip', 'drawers', 'locker2'],
    },
    ends: { a: { kind: 'cbm', door: 'open', vest: 0, to: 'node2', label: 'УЗЕЛ-2 · NODE 2' }, b: { kind: 'cbm', door: 'closed', vest: 0, label: 'ПОРТ P1 · DOCKING' } },
    signName: 'МОДУЛЬ «ГОРИЗОНТ» · EXERCISE / HYGIENE',
    extras: (Z, L) => {
      const K = Z.K, T = I.atlas, h = 1.05;
      // deck: treadmill (aft half) and cycle ergometer (fwd half) on blank racks
      for (let i = 0; i < L.n; i++) if (!L.used.deck[i]) rack(K, L.wallFrame('deck', L.slotU(i)), 'blank', 1.05, L.across);
      const Fd = L.wallFrame('deck', -2.6);
      treadmill(K, offset(Fd, 0, 0, 0.02), 1.9);
      Z.solids.push(boxSolid(offset(Fd, 0, 0, 0.12), 0.95, 0.31, 0.13, 'treadmill'));
      const Fe = L.wallFrame('deck', 2.9);
      ergometer(K, offset(Fe, 0, 0, 0.02));
      Z.solids.push(boxSolid(offset(Fe, 0, 0, 0.14), 0.3, 0.2, 0.14, 'cevis'));
      // stbd: ARED resistive device on blank racks 3..5
      for (const i of [3, 4, 5]) if (!L.used.stbd[i]) rack(K, L.wallFrame('stbd', L.slotU(i)), 'blank', 1.05, L.across);
      const Fa = L.wallFrame('stbd', L.slotU(4));
      resistive(K, offset(Fa, 0, 0, 0.02));
      Z.solids.push(boxSolid(offset(Fa, 0, 0, 0.1), 0.65, 0.38, 0.1, 'ared'));
      // port 0..1: toilet compartment (WHC) + hygiene station
      for (const i of [0, 1]) if (!L.used.port[i]) rack(K, L.wallFrame('port', L.slotU(i)), 'open', 1.05, L.across);
      const Fw = L.wallFrame('port', L.slotU(0));
      toilet(K, offset(Fw, 0, -0.1, -0.33));
      // privacy curtain (fabric) half drawn
      Z.W.chamferBox('equip', offset(Fw, 0.4, 0, 0.1), 0.25, L.across, 0.03, 0.01, 0xffffff, T.rect('fabric'));
      const Fh = L.wallFrame('port', L.slotU(1));
      Z.W.chamferBox('equip', offset(Fh, 0, 0.2, -0.15), 0.8, 0.5, 0.3, 0.03, 0xffffff, T.rect('fabricBlue'));
      if (!I.lite) {
        Z.W.box('metal', offset(Fh, 0, -0.35, -0.2), 0.3, 0.4, 0.004, 0xdfe6ea);   // mirror
        for (let k = 0; k < 3; k++) Z.W.chamferBox('equip', offset(Fh, -0.3 + k * 0.3, 0.55, -0.1), 0.2, 0.12, 0.06, 0.02, 0xffffff, T.rect(['fabricOrange', 'fabricGreen', 'fabric'][k]));
        sign(K, offset(Fh, 0, 0.75, 0.0), 'ГИГИЕНА · HYGIENE', 0.4, 0.06, { ph: 32 });
      }
      // stbd 0..1: second treadmill harness / exercise mats
      for (const i of [0, 1]) if (!L.used.stbd[i]) rack(K, L.wallFrame('stbd', L.slotU(i)), 'blank', 1.05, L.across);
      if (!I.lite) display(K, offset(L.wallFrame('stbd', L.slotU(1)), 0, 0.3, 0.02), 0.5, 0.32, 'scrMed');
    },
  });

  // ---- medical «ПУЛЬС»
  mod({
    id: 'medical', name: 'Медицинский модуль «ПУЛЬС»', code: 'MED', center: V(17.5, CY, 6.45), axis: Zp, up: Y, len: 8, r: 2.1, h: 0.98, c: 0.24, seed: 113,
    windows: [W(V(17.5, -10.1, 6.95), NY, 0.32)],
    walls: {
      deck: ['skip', 'skip', 'skip', 'skip', 'med', 'locker'],
      overhead: ['med', 'locker', 'drawers', 'med', 'locker2', 'drawers'],
      port: ['med', 'med', 'skip', 'drawers', 'locker', 'stow'],
      stbd: ['locker', 'med', 'skip', 'med', 'drawers', 'locker2'],
    },
    ends: { a: { kind: 'cbm', door: 'open', vest: 0, to: 'node3', label: 'УЗЕЛ-3 · NODE 3' }, b: { kind: 'closed', panel: 'med' } },
    signName: 'МЕДИЦИНСКИЙ МОДУЛЬ «ПУЛЬС» · MEDICAL',
    extras: (Z, L) => {
      const K = Z.K, h = 0.98;
      for (let i = 0; i < 4; i++) if (!L.used.deck[i]) rack(K, L.wallFrame('deck', L.slotU(i)), 'blank', 1.05, L.across);
      const Fd = L.wallFrame('deck', -1.3);
      restraintTable(K, offset(Fd, 0, 0, 0.0));
      Z.solids.push(boxSolid(offset(Fd, 0, 0, 0.14), 0.3, 0.95, 0.14, 'cmrs'));
      for (const wall of ['port', 'stbd']) {
        const F = L.wallFrame(wall, L.slotU(2));
        if (L.used[wall][2]) continue;
        rack(K, F, 'blank', 1.05, L.across);
        if (wall === 'port') { defibrillator(K, offset(F, -0.2, 0.2, 0.02)); display(K, offset(F, 0.25, 0.3, 0.02), 0.4, 0.26, 'scrMed'); }
        else { ultrasound(K, offset(F, 0, 0.15, 0.02)); }
      }
      if (!I.lite) {
        for (let k = 0; k < 3; k++) { const F = L.wallFrame('overhead', L.slotU(1 + k)); bag(K, offset(F, 0.2, 0, 0.12), 0.38, 0.26, 0.2, 'b'); Z.W.box('equip', offset(F, 0.2, 0, 0.222), 0.3, 0.2, 0.004, 0xffffff, I.atlas.rect('medkit'), null, 16); }
        // oxygen bottles on the port wall
        const Fo = L.wallFrame('port', L.slotU(5));
        for (const sx of [-0.15, 0.15]) Z.W.cyl('paint', sub(Fo, sx, 0, 0.12, 'x', 0), 0.06, 0.06, 0.5, 12, 0x2f8a4a);
        sign(K, offset(Fo, 0, 0.35, 0.02), 'КИСЛОРОД · O₂', 0.3, 0.05, { ph: 32, bg: '#2f8a4a', fg: '#fff' });
      }
    },
  });

  // ---- service «ВЕКТОР» (Russian style)
  mod({
    id: 'service', name: 'Служебный модуль «ВЕКТОР»', code: 'SM', center: V(27, CY, 0), axis: X, up: Y, len: 14, r: 2.6, h: 1.12, c: 0.3, style: 'ru', seed: 117, warm: 1.05,
    windows: [W(V(27, -10.6, 0), NY, 0.25)],
    walls: {
      deck: ['ruB', 'eclss', 'co2', 'ru', 'water', 'ruB', 'skip', 'ru', 'prop', 'ruB', 'power', 'ru'],
      overhead: ['ru', 'ruB', 'ru', 'ru', 'ruB', 'ru', 'ru', 'ruB', 'ru', 'ru', 'ruB', 'ru'],
      port: ['eclss', 'ru', 'water', 'ruB', 'co2', 'ru', 'skip', 'ruB', 'power', 'prop', 'ru', 'ruB'],
      stbd: ['ru', 'co2', 'ruB', 'eclss', 'ru', 'water', 'skip', 'ru', 'ruB', 'power', 'ru', 'prop'],
    },
    ends: { a: { kind: 'round', door: 'open', vest: 0, to: 'node3', label: 'УЗЕЛ-3', r: 0.45 }, b: { kind: 'round', door: 'open', vest: 0, to: 'svcTunnel', label: 'ГАВАНЬ · HUB', r: 0.45 } },
    signName: 'СЛУЖЕБНЫЙ МОДУЛЬ «ВЕКТОР»',
    extras: (Z, L) => {
      const K = Z.K, W2 = Z.W, T = I.atlas, h = 1.12;
      // central post: control console with two screens on the 'skip' slots (slot 6) of port/stbd/deck
      const Fp = L.wallFrame('port', L.slotU(6));
      rack(K, Fp, 'ru', 1.05, L.across);
      display(K, offset(Fp, 0, 0.35, 0.03), 0.6, 0.38, 'scrMap');
      W2.box('paint', offset(Fp, 0, -0.2, 0.12), 0.8, 0.3, 0.2, 0xb9c0a8);
      for (let k = 0; k < 8; k++) W2.box('paint', offset(Fp, -0.3 + k * 0.085, -0.2, 0.225), 0.05, 0.05, 0.02, k % 3 ? COL.dark : COL.red);
      sign(K, offset(Fp, 0, 0.68, 0.01), 'ЦЕНТРАЛЬНЫЙ ПОСТ', 0.6, 0.07, { ph: 40, bg: '#e9e5d0' });
      const Fs = L.wallFrame('stbd', L.slotU(6));
      rack(K, Fs, 'ruB', 1.05, L.across);
      display(K, offset(Fs, 0, 0.35, 0.03), 0.6, 0.38, 'scrGraph');
      laptop(K, offset(Fs, 0, -0.1, 0.03), 'scrText', 0.3);
      const Fd = L.wallFrame('deck', L.slotU(6));
      rack(K, Fd, 'ru', 1.05, L.across);
      // Elektron oxygen generator: a cylindrical unit with piping on the deck slot 1
      if (!I.lite) {
        const Fe = L.wallFrame('deck', L.slotU(1));
        W2.cyl('paint', sub(Fe, 0, 0, 0.18, 'y', 0), 0.16, 0.16, 0.7, 16, 0xc9cbb8);
        W2.cyl('metal', sub(Fe, 0, 0.36, 0.18, 'y', 0), 0.17, 0.17, 0.03, 16, COL.dark);
        W2.cyl('metal', sub(Fe, 0, -0.36, 0.18, 'y', 0), 0.17, 0.17, 0.03, 16, COL.dark);
        sign(K, offset(Fe, 0, 0, 0.345), 'ЭЛЕКТРОН-ВМ · O₂', 0.4, 0.05, { ph: 32, bg: '#e9e5d0' });
        Z.solids.push(boxSolid(offset(Fe, 0, 0, 0.18), 0.18, 0.4, 0.18, 'elektron'));
        // Vozdukh CO2 removal unit
        const Fv = L.wallFrame('port', L.slotU(4));
        W2.box('paint', offset(Fv, 0, 0, 0.1), 0.8, 0.9, 0.2, 0xb7bea4);
        for (let k = 0; k < 4; k++) W2.cyl('metal', sub(Fv, -0.3 + k * 0.2, 0, 0.22, 'x', Math.PI / 2), 0.06, 0.06, 0.06, 12, COL.dark);
        sign(K, offset(Fv, 0, 0.35, 0.205), 'ВОЗДУХ · CO₂', 0.4, 0.05, { ph: 32, bg: '#e9e5d0' });
        Z.solids.push(boxSolid(offset(Fv, 0, 0, 0.1), 0.4, 0.45, 0.1, 'vozdukh'));
        // water processing: tank + pump
        const Fh = L.wallFrame('stbd', L.slotU(5));
        W2.cyl('paint', sub(Fh, 0, 0, 0.2, 'x', 0), 0.18, 0.18, 0.6, 16, 0x9fb8c8);
        sign(K, offset(Fh, 0, 0.42, 0.02), 'СРВ-К2М · ВОДА', 0.4, 0.05, { ph: 32, bg: '#e9e5d0' });
        Z.solids.push(boxSolid(offset(Fh, 0, 0, 0.2), 0.2, 0.32, 0.2, 'srv'));
        W2.box('equip', offset(L.wallFrame('stbd', L.slotU(7)), 0, 0.55, 0.004), 0.3, 0.2, 0.004, 0xffffff, T.rect('flagRu'), null, 16);
        W2.box('equip', offset(L.wallFrame('port', L.slotU(8)), 0, 0.55, 0.004), 0.16, 0.2, 0.004, 0xffffff, T.rect('photoCrew'), null, 16);
      }
    },
  });

  // ---- nodes
  const nodeSpec = (x, id, name, signName, radial, ends, extra = {}) => {
    const z = nodeModule(I, { x, id, name, signName, radial, ends, ...extra });
    zones.push(z);
    return z;
  };
  nodeSpec(-18.5, 'node1', 'Узел «УЗЕЛ-1»', 'УЗЕЛ-1 · NODE 1', {
    stbd: { kind: 'cbm', door: 'open', to: 'airlockE', len: 1.4, label: 'ШЛЮЗ · AIRLOCK', hinge: -1 },
    deck: { kind: 'cbm', door: 'open', to: 'cupola', len: 1.15, label: 'КУПОЛ · CUPOLA' },
    port: { kind: 'cbm', door: 'open', to: null, len: 1.6, label: 'ПОРТ N1', end: 'ids', port: 'N1', pass: true },
    overhead: { kind: 'cbm', door: 'closed', len: 0, label: 'ЗАГЛУШКА · NOT IN USE' },
  }, { a: { kind: 'cbm', door: 'open', vest: 0.8, to: 'logistics', label: '«ЛАРЕЦ» · LOGISTICS' }, b: { kind: 'cbm', door: 'open', vest: 0.8, to: 'lab', label: '«ИСТОК» · LAB' } }, { laptop: 'port', seed: 131 });
  nodeSpec(0.5, 'node2', 'Узел «УЗЕЛ-2»', 'УЗЕЛ-2 · NODE 2', {
    stbd: { kind: 'cbm', door: 'open', to: 'hab1', len: 1.6, label: '«ГОРИЗОНТ» · EXERCISE' },
    port: { kind: 'cbm', door: 'open', to: 'greenhouse', len: 1.6, label: '«ФЛОРА» · GREENHOUSE' },
    overhead: { kind: 'round', door: 'open', to: 'spine', len: 0.3, r: 0.45, label: '→ КОЛЬЦО · RING' },
    deck: { kind: 'cbm', door: 'closed', len: 0, label: 'ЗАГЛУШКА · NOT IN USE' },
  }, { a: { kind: 'cbm', door: 'open', vest: 0.8, to: 'lab', label: '«ИСТОК» · LAB' }, b: { kind: 'cbm', door: 'open', vest: 0.8, to: 'hab2', label: '«МЕРИДИАН» · HAB' } }, { laptop: 'stbd', seed: 137 });
  nodeSpec(17.5, 'node3', 'Узел «УЗЕЛ-3»', 'УЗЕЛ-3 · NODE 3', {
    stbd: { kind: 'cbm', door: 'open', to: 'medical', len: 1.6, label: '«ПУЛЬС» · MEDICAL' },
    deck: { kind: 'cbm', door: 'open', to: 'stowage', len: 1.35, label: 'КЛАДОВАЯ · STOWAGE' },
    port: { kind: 'cbm', door: 'open', to: null, len: 1.6, label: 'ПОРТ N3', end: 'ids', port: 'N3', pass: true },
    overhead: { kind: 'cbm', door: 'closed', len: 0, label: 'ЗАГЛУШКА · NOT IN USE' },
  }, { a: { kind: 'cbm', door: 'open', vest: 0.8, to: 'hab2', label: '«МЕРИДИАН» · HAB' }, b: { kind: 'cbm', door: 'open', vest: 0.8, to: 'service', label: '«ВЕКТОР» · SERVICE' } }, { laptop: 'deck', seed: 139 });

  zones.push(greenhouse(I));
  zones.push(cupola(I, -18.5));
  zones.push(stowage(I));
  zones.push(dockingHub(I, station?.dockingPorts));
  zones.push(serviceTunnel(I));
  zones.push(spineTunnel(I));
  return zones;
}
