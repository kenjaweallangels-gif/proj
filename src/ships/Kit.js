import * as THREE from 'three';
import { ShipBuilder, ShipLights, shipMaterials, instancedParts, LocalColliders, V, X_AXIS, Y_AXIS, Z_AXIS, quatZ, quatY, scaleUV, flipInside, faceMatrix, plane, TEX_M } from './ShipBuilder.js';

/**
 * Level-of-detail ship templates.
 *
 * A ship type is authored once as `author(k)` and run three times with a Kit per level:
 *   L0 (near, < ~40-60 m): full detail — bolts, handrails, latches, thruster bells, cell grids, bevels
 *   L1 (mid, < ~400 m):     the same shapes with ~half the tessellation and without the small parts
 *   L2 (far):               silhouettes only, everything in one flat vertex-coloured material (1 draw call)
 * Geometry goes into the ship root or into named pivots (animated sub-assemblies). Every level of every
 * pivot gets its own holder Group, tagged with its level, so switching a level is a few `visible` flips.
 *
 * The template is built once per type and cloned for every ship of that type (geometry and materials are
 * shared; each ship gets its own ShipLights texture, flat-lit material, labels and instance matrices).
 */

export const LOD_SEG = [1, 0.5, 0.2];
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);

export class ShipTemplate {
  constructor(materials, type) {
    this.materials = materials;
    this.type = type;
    this.shared = shipMaterials(materials);
    this.root = new THREE.Group();
    this.root.name = type;
    this.pivots = new Map();
    this.lights = new ShipLights();                 // template placeholder: each ship clones its own
    this.flatLit = this.shared.flatLit(this.lights);
    this.holders = [[], [], []];                     // per level
    this.inst = new Map();                           // instanced set name -> [mesh per level]
    this.labels = [];                                // { text, w, h, p, n, opts }
    this.nozzles = []; this.mainNozzles = []; this.colliders = [];
    this.lodTris = [0, 0, 0];
  }

  /**
   * Named pivot Group (created once; later calls just return it). A given position / quaternion goes on an
   * outer mount group, so the pivot itself starts at identity and animations can simply set its rotation.
   */
  pivot(name, { parent = null, position = null, quaternion = null } = {}) {
    let p = this.pivots.get(name);
    if (p) return p;
    p = new THREE.Group();
    p.name = name;
    let top = p;
    if (position || quaternion) {
      top = new THREE.Group(); top.name = `${name}:mount`;
      if (position) top.position.copy(position);
      if (quaternion) top.quaternion.copy(quaternion);
      top.add(p);
    }
    (parent ? this.pivots.get(parent) : this.root).add(top);
    this.pivots.set(name, p);
    return p;
  }
}

export class Kit {
  /** @param tpl ShipTemplate  @param level 0|1|2  @param maxLevelGeometry lite: L0 is never shown */
  constructor(tpl, level) {
    this.tpl = tpl;
    this.lvl = level;
    this.near = level === 0;
    this.mid = level <= 1;
    this.far = level === 2;
    this.f = LOD_SEG[level];
    this._b = new Map();
    this.b = this.on('');
  }

  /** Segment count for this level. */
  seg(n, min = 6) { return Math.max(min, Math.round(n * this.f)); }

  /** Builder for the root ('') or a pivot (created with tpl.pivot first). */
  on(name) {
    let b = this._b.get(name);
    if (!b) { b = new ShipBuilder(this.tpl.materials); b.flatOnly = this.far; this._b.set(name, b); }
    return b;
  }

  _holder(name) {
    const parent = name ? this.tpl.pivots.get(name) : this.tpl.root;
    if (!parent) throw new Error(`Kit: unknown pivot "${name}"`);
    const key = `__L${this.lvl}`;
    let h = parent.children.find((c) => c.name === key);
    if (!h) { h = new THREE.Group(); h.name = key; h.userData.lod = this.lvl; parent.add(h); this.tpl.holders[this.lvl].push(h); }
    return h;
  }

  /** Register a thruster (only from the L0 run: the lists are per type). */
  nozzle(position, direction, main = false) { if (this.near) (main ? this.tpl.mainNozzles : this.tpl.nozzles).push({ position: position.clone(), direction: direction.clone().normalize() }); }
  collider(c) { if (this.near) this.tpl.colliders.push(c); }
  /** Text decal (built per ship: `{name}` / `{num}` are substituted). Visible on L0/L1. */
  label(text, w, h, p, n, opts = {}) { if (this.near) this.tpl.labels.push({ text, w, h, p: p.clone(), n: n.clone(), opts }); }

  /**
   * InstancedMesh for a set of identical moving parts (hinged panels, hooks, fan gores) on pivot `on`.
   * parts = [[surface, geometry], ...] in the part's local frame. The animation code writes the instance
   * matrices of every level's mesh (`tpl.inst.get(name)`).
   */
  instanced(name, parts, count, { on = '', shadow = false } = {}) {
    const p = instancedParts(this.tpl.shared, parts);
    const im = new THREE.InstancedMesh(p.geometry, p.materials, count);
    im.name = `${name}#${this.lvl}`;
    im.castShadow = shadow && !this.far; im.receiveShadow = false; im.frustumCulled = false;
    for (let i = 0; i < count; i++) im.setMatrixAt(i, _m.identity());
    this._holder(on).add(im);
    if (!this.tpl.inst.has(name)) this.tpl.inst.set(name, []);
    this.tpl.inst.get(name)[this.lvl] = im;
    this.tpl.lodTris[this.lvl] += triCount(p.geometry) * count;
    return im;
  }

  finish() {
    for (const [name, b] of this._b) {
      if (!b.buckets.size) continue;
      const meshes = b.build(this._holder(name), `${this.tpl.type}${name ? ':' + name : ''}#${this.lvl}`, { flatMaterial: this.tpl.flatLit, shadows: !this.far, receive: true });
      for (const m of meshes) this.tpl.lodTris[this.lvl] += triCount(m.geometry);
    }
  }
}

function triCount(g) { return (g.index ? g.index.count : g.attributes.position.count) / 3; }

/** Build a type template: `author(k)` is called for L0, L1 and L2. */
export function buildTemplate(materials, type, author) {
  const tpl = new ShipTemplate(materials, type);
  for (let lvl = 0; lvl < 3; lvl++) {
    const k = new Kit(tpl, lvl);
    tpl.info = author(k) || tpl.info;
    k.finish();
  }
  return tpl;
}

/** Walk two isomorphic hierarchies together. */
function parallel(a, b, fn) { fn(a, b); for (let i = 0; i < a.children.length; i++) parallel(a.children[i], b.children[i], fn); }

/**
 * Clone a template into a ship: shared geometry/materials, own lights/flat material/labels/instance matrices.
 * Returns { group, lights, pivots: {name: Group}, holders: [[]x3], inst: {name: [mesh per level]} }.
 */
export function instantiate(tpl, { name = '', num = '' } = {}) {
  const group = tpl.root.clone(true);
  const map = new Map();
  parallel(tpl.root, group, (a, b) => map.set(a, b));
  const lights = new ShipLights();
  const flatLit = tpl.shared.flatLit(lights);
  group.traverse((o) => { if (o.isMesh && o.material === tpl.flatLit) o.material = flatLit; });
  const pivots = {};
  for (const [n, p] of tpl.pivots) pivots[n] = map.get(p);
  const holders = tpl.holders.map((list) => list.map((h) => map.get(h)));
  const inst = {};
  for (const [n, list] of tpl.inst) inst[n] = list.map((m) => (m ? map.get(m) : null)).filter(Boolean);
  // per-ship labels (L0 + L1)
  if (tpl.labels.length) {
    const b = new ShipBuilder(tpl.materials);
    for (const L of tpl.labels) b.label(L.text.replace('{name}', name).replace('{num}', num), L.w, L.h, L.p, L.n, L.opts);
    const h = new THREE.Group(); h.name = '__labels'; h.userData.lod = -1;   // -1: levels 0 and 1
    b.build(h, `${tpl.type}:labels`);
    group.add(h);
    holders[0].push(h);
  }
  // static nodes (level holders, meshes, pivot mounts) never move relative to their parents
  group.traverse((o) => {
    if (o === group || o.isInstancedMesh) return;
    if (o.isMesh || o.userData.lod !== undefined || o.name.endsWith(':mount')) { o.updateMatrix(); o.matrixAutoUpdate = false; }
  });
  for (const list of holders) for (const h of list) h.userData.parent = h.parent;
  return { group, lights, flatLit, pivots, holders, inst, level: -1, detached: false };
}

/**
 * Show exactly one level (labels: L0 and L1). Until `detach(rig)` the levels are toggled with `visible` (so the
 * App's start-up passes — lite material swap, variant split, shader compile — see every level); afterwards the
 * hidden levels are taken out of the scene graph, so they cost no matrix updates or culling work per frame.
 */
export function setLevel(rig, level) {
  rig.level = level;
  for (let l = 0; l < 3; l++) for (const h of rig.holders[l]) {
    const on = h.userData.lod === -1 ? level <= 1 : l === level;
    if (!rig.detached) h.visible = on;
    else if (on && !h.parent) h.userData.parent.add(h);
    else if (!on && h.parent) h.parent.remove(h);
  }
}

/** Switch a rig to detaching hidden levels (call once the scene set-up is done). */
export function detach(rig) {
  if (rig.detached) return;
  for (const list of rig.holders) for (const h of list) h.visible = true;
  rig.detached = true;
  setLevel(rig, rig.level);
}

// ================================================================================================ geometry
/** Apply "local +Z -> n at p" to a geometry. */
export function axial(geo, p, n, roll = 0) {
  _q.copy(quatZ(n));
  if (roll) _q.multiply(new THREE.Quaternion().setFromAxisAngle(Z_AXIS, roll));
  return geo.applyMatrix4(_m.compose(p, _q, _s));
}

/** Chamfer the interior corners of a lathe profile ([r, z] pairs) by `d` (keeps the end points). */
export function bevel(profile, d) {
  if (!(d > 0) || profile.length < 3) return profile;
  const out = [profile[0]];
  for (let i = 1; i < profile.length - 1; i++) {
    const [r0, z0] = profile[i - 1], [r1, z1] = profile[i], [r2, z2] = profile[i + 1];
    const ax = r0 - r1, az = z0 - z1, bx = r2 - r1, bz = z2 - z1;
    const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
    const cos = (ax * bx + az * bz) / (la * lb + 1e-9);
    if (cos < -0.95 || la < 2.5 * d || lb < 2.5 * d) { out.push(profile[i]); continue; }   // straight enough / too short
    out.push([r1 + ax / la * d, z1 + az / la * d], [r1 + (ax / la + bx / lb) * d * 0.29, z1 + (az / la + bz / lb) * d * 0.29], [r1 + bx / lb * d, z1 + bz / lb * d]);
  }
  out.push(profile[profile.length - 1]);
  return out;
}

/** Surface of revolution about Z with LOD tessellation (and bevelled corners on L0/L1). */
export function lathe(k, b, surf, profile, { seg = 48, bev = 0.012, shadow = true, tint = null, th0 = 0, thl = Math.PI * 2, uv = 1, relief = null } = {}) {
  let prof = k.far ? profile : bevel(profile, bev);
  let segs = k.seg(seg);
  // L0 surface relief (quilted blanket pillows / tile grooves): resample the profile and tessellate around
  if (relief && k.near) {
    const step = TEX_M / (8 * uv) / (relief.sub || 5);    // texture cells (8 per UV unit) split into `sub` quads
    prof = resample(prof, step);
    const rMax0 = Math.max(...prof.map((p) => p[0]));
    segs = Math.max(segs, Math.round((thl * rMax0) / step));
  }
  const pts = prof.map(([r, z]) => new THREE.Vector2(Math.max(0, r), z));
  // profile points must run aft -> fore along the outside (outward normal = direction rotated clockwise)
  const g = new THREE.LatheGeometry(pts, segs, th0 + Math.PI / 2, thl);   // theta from +X toward +Y
  g.rotateX(Math.PI / 2);
  let len = 0; for (let i = 1; i < prof.length; i++) len += Math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]);
  const rMax = Math.max(...prof.map((p) => p[0]));
  scaleUV(g, uv * (2 * Math.PI * rMax) / TEX_M * (thl / (2 * Math.PI)), uv * len / TEX_M);
  if (relief && k.near) applyRelief(g, prof, relief);
  if (b) b.add(surf, g, shadow, tint);   // b = null: just return the geometry (to transform it first)
  return g;
}

/** Resample a [r, z] polyline so that no segment is longer than `step` (keeps the corners). */
function resample(prof, step) {
  const out = [prof[0]];
  for (let i = 1; i < prof.length; i++) {
    const [r0, z0] = prof[i - 1], [r1, z1] = prof[i];
    const n = Math.max(1, Math.ceil(Math.hypot(r1 - r0, z1 - z0) / step));
    for (let j = 1; j <= n; j++) out.push([r0 + (r1 - r0) * j / n, z0 + (z1 - z0) * j / n]);
  }
  return out;
}

/**
 * Displace a lathe along its normals so the geometry follows the texture's cell grid (8 cells per UV unit:
 * quilt pillows of the blanket texture, panel / tile seams of the hull texture):
 * relief = { depth (m), mode: 'pillow' | 'groove', width (fraction of a cell) }.
 */
function applyRelief(g, prof, { depth, mode = 'pillow', width = 0.08 }) {
  const pos = g.attributes.position, nor = g.attributes.normal, uvs = g.attributes.uv, np = prof.length;
  for (let v = 0; v < pos.count; v++) {
    if (prof[v % np][0] < 0.05) continue;
    const fu = ((uvs.getX(v) * 8) % 1 + 1) % 1, fv = ((uvs.getY(v) * 8) % 1 + 1) % 1;
    let d;
    if (mode === 'pillow') d = depth * Math.pow(Math.max(0, Math.sin(Math.PI * fu) * Math.sin(Math.PI * fv)), 0.45);
    else { const e = Math.min(fu, 1 - fu, fv, 1 - fv); d = e < width ? -depth * (1 - e / width) : 0; }
    pos.setXYZ(v, pos.getX(v) + nor.getX(v) * d, pos.getY(v) + nor.getY(v) * d, pos.getZ(v) + nor.getZ(v) * d);
  }
  g.computeVertexNormals();
}

/** Ring with a bevelled rectangular section at z (axis Z): inner radius r, radial height h, axial width w. */
export function flange(k, b, z, r, { h = 0.05, w = 0.06, surf = 'metalDark', seg = 56, bolts = 0, boltSurf = 'metalBare', face = 1, tint = null } = {}) {
  if (k.far && h < 0.06) return;
  const z0 = z - w / 2, z1 = z + w / 2, c = Math.min(h, w) * 0.25;
  lathe(k, b, surf, [[r, z0], [r + h - c, z0], [r + h, z0 + c], [r + h, z1 - c], [r + h - c, z1], [r, z1]], { seg, bev: 0, shadow: false, tint });
  if (bolts && k.near) boltCircle(k, b, V(0, 0, face > 0 ? z1 : z0), Z_AXIS.clone().multiplyScalar(face), r + h * 0.55, bolts, Math.min(0.018, h * 0.22), boltSurf);
}

/** Hex bolt heads on a circle (L0 only): centre c, face normal n, circle radius R. */
export function boltCircle(k, b, c, n, R, count, size = 0.012, surf = 'metalBare', a0 = 0) {
  if (!k.near) return;
  const q = quatZ(n), geos = [];
  for (let i = 0; i < count; i++) {
    const a = a0 + (i / count) * Math.PI * 2;
    const g = new THREE.CylinderGeometry(size, size, size * 0.7, 6);
    g.rotateX(Math.PI / 2).translate(Math.cos(a) * R, Math.sin(a) * R, size * 0.35);
    g.applyMatrix4(_m.compose(c, q, _s));
    geos.push(g);
  }
  for (const g of geos) b.add(surf, g, false);
}

/** Bolt / fastener rows along a straight line p0->p1 on a face with normal n (L0 only). */
export function boltRow(k, b, p0, p1, n, count, size = 0.01, surf = 'metalBare') {
  if (!k.near) return;
  const q = quatZ(n);
  for (let i = 0; i < count; i++) {
    const p = p0.clone().lerp(p1, count > 1 ? i / (count - 1) : 0.5);
    const g = new THREE.CylinderGeometry(size, size, size * 0.7, 6).rotateX(Math.PI / 2).translate(0, 0, size * 0.35);
    b.add(surf, g.applyMatrix4(_m.compose(p, q, _s)), false);
  }
}

/** Thin binding tape where a blanket ends / a dark seam groove between two sections (radius r at z). */
export function seam(k, b, z, r, { surf = 'metalDark', t = 0.012, tint = null } = {}) {
  if (k.far) return;
  const g = new THREE.TorusGeometry(r, t, k.near ? 4 : 3, k.seg(64, 12));
  b.add(surf, g.translate(0, 0, z), false, tint);
}

/** Cylinder between two points (any direction). */
export function rod(k, b, surf, p0, p1, r, { seg = 8, shadow = false, rEnd = null, open = false, tint = null } = {}) {
  const d = _v.subVectors(p1, p0); const len = d.length();
  const g = new THREE.CylinderGeometry(rEnd ?? r, r, len, k.seg(seg, 4), 1, open);
  g.applyMatrix4(_m.compose(p0.clone().lerp(p1, 0.5), quatY(d), _s));
  b.add(surf, g, shadow, tint);
  return g;
}

/** Box with optional bevel (RoundedBox-like via chamfered extrusion) centred at c with quaternion q. */
export function block(k, b, surf, c, w, h, d, q = null, { shadow = false, bev = null, tint = null, uv = true } = {}) {
  let g;
  // finished edges by default (L0 / L1): a small chamfer unless the caller asks for a square box (bev: 0)
  if (bev === null) bev = k.far ? 0 : Math.min(0.02, Math.min(w, h, d) * 0.12);
  if (bev > 0 && Math.min(w, h, d) < 2.6 * bev) bev = Math.min(w, h, d) / 2.6;
  if (bev > 0 && !k.far) {
    const sh = new THREE.Shape();
    const x = w / 2 - bev, y = h / 2 - bev;
    sh.moveTo(-x, -h / 2); sh.lineTo(x, -h / 2); sh.lineTo(w / 2, -y); sh.lineTo(w / 2, y); sh.lineTo(x, h / 2); sh.lineTo(-x, h / 2); sh.lineTo(-w / 2, y); sh.lineTo(-w / 2, -y); sh.closePath();
    g = new THREE.ExtrudeGeometry(sh, { depth: d - 2 * bev, bevelEnabled: true, bevelThickness: bev, bevelSize: 0, bevelSegments: 1 });
    g.translate(0, 0, -(d - 2 * bev) / 2);
    if (uv) scaleUV(g, 1 / TEX_M, 1 / TEX_M);
  } else {
    g = new THREE.BoxGeometry(w, h, d);
    if (uv) { const a = g.attributes.uv; const f = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; for (let i = 0; i < a.count; i++) { const fc = Math.floor(i / 4); a.setXY(i, a.getX(i) * f[fc][0] / TEX_M, a.getY(i) * f[fc][1] / TEX_M); } }
  }
  g.applyMatrix4(_m.compose(c, q || _q.identity(), _s));
  b.add(surf, g, shadow, tint);
  return g;
}

/**
 * EVA handrail: round bar on two standoffs with foot plates, offset `standoff` along n from the surface line p0->p1
 * (L0 only: sub-pixel beyond a few tens of metres).
 */
export function handrail(k, b, p0, p1, n, { surf = 'gold', standoff = 0.065, r = 0.0125 } = {}) {
  if (!k.near) return;
  const a = p0.clone().addScaledVector(n, standoff), c = p1.clone().addScaledVector(n, standoff);
  const dir = c.clone().sub(a).normalize();
  rod(k, b, surf, a.clone().addScaledVector(dir, -0.02), c.clone().addScaledVector(dir, 0.02), r, { seg: 8 });
  for (const [p, q] of [[p0, a], [p1, c]]) {
    rod(k, b, surf, p.clone().addScaledVector(dir, p === p0 ? 0.03 : -0.03), q, r * 0.85, { seg: 6 });
    const foot = new THREE.CylinderGeometry(r * 2.4, r * 2.6, 0.012, 8);
    b.add(surf, foot.applyMatrix4(_m.compose(p.clone().addScaledVector(dir, p === p0 ? 0.03 : -0.03).addScaledVector(n, 0.006), quatY(n), _s)), false);
  }
}

/**
 * Rocket / RCS thruster bell at p, exhaust along dir: throat collar, bell (outer) and sooty liner, mounting
 * flange. Registers the nozzle (exit plane) for the RCS particle logic.
 */
export function thruster(k, b, p, dir, size = 0.05, { main = false, bell = 2.2, surf = 'nozzle', register = true, collar = true } = {}) {
  const d = dir.clone().normalize();
  const L = size * bell;
  if (k.far && size < 0.12) { if (register) k.nozzle(p.clone().addScaledVector(d, L), d, main); return; }
  const prof = [[size * 0.42, 0], [size * 0.38, L * 0.12], [size * 0.55, L * 0.35], [size * 0.8, L * 0.7], [size, L]];
  const outer = new THREE.LatheGeometry(prof.map(([r, z]) => new THREE.Vector2(r, z)), k.seg(main ? 40 : 14, 6));
  outer.rotateX(Math.PI / 2);
  b.add(surf, axial(outer, p, d), false);
  if (k.near || (k.mid && size >= 0.08)) {
    const inner = new THREE.LatheGeometry(prof.map(([r, z]) => new THREE.Vector2(r * 0.94, z + 0.002)), k.seg(main ? 40 : 14, 6));
    inner.rotateX(Math.PI / 2);
    b.add(main ? 'hot' : 'nozzleIn', axial(flipInside(inner), p, d), false);
    if (collar) {
      const c = new THREE.CylinderGeometry(size * 0.62, size * 0.66, size * 0.5, k.seg(main ? 32 : 10, 6)).rotateX(Math.PI / 2).translate(0, 0, -size * 0.2);
      b.add('metalDark', axial(c, p, d), false);
    }
    if (k.near && main) { // regenerative cooling bands
      for (const t of [0.45, 0.75]) { const r = size * (0.55 + 0.45 * t); const g = new THREE.TorusGeometry(r, size * 0.02, 4, k.seg(40)).translate(0, 0, L * t); b.add('metalDark', axial(g, p, d), false); }
    }
  }
  if (register) k.nozzle(p.clone().addScaledVector(d, L), d, main);
}

/** Round window: bevelled frame ring with bolts, recessed pane (warm-lit or dark glass). */
export function porthole(k, b, p, n, r, { lit = true, frame = 0.05, surf = 'metalDark' } = {}) {
  if (k.far) { const g = new THREE.CircleGeometry(r, 8); b.add(lit ? 'window' : 'glassDark', axial(g, p.clone().addScaledVector(n, 0.01), n), false); return; }
  const ring = new THREE.LatheGeometry([[r + frame * 1.2, -0.01], [r + frame, 0.03], [r + frame * 0.3, 0.035], [r, 0.02], [r, -0.01]].map(([x, y]) => new THREE.Vector2(x, y)), k.seg(28, 8));
  ring.rotateX(Math.PI / 2);
  b.add(surf, axial(ring, p, n), false);
  const pane = new THREE.CircleGeometry(r, k.seg(28, 8));
  b.add(lit ? 'window' : 'glassDark', axial(pane, p.clone().addScaledVector(n, -0.004), n), false);
  if (k.near) boltCircle(k, b, p.clone().addScaledVector(n, 0.03), n, r + frame * 0.65, 12, 0.007);
}

/** Round hatch on a surface: groove ring, raised cover with hinge and handle. */
export function hatchRound(k, b, p, n, r, { surf = 'hullAged', hingeDir = null } = {}) {
  if (k.far) return;
  const g = new THREE.TorusGeometry(r, 0.018, 4, k.seg(40, 10));
  b.add('metalDark', axial(g, p, n), false);
  const cover = new THREE.CylinderGeometry(r - 0.02, r - 0.01, 0.04, k.seg(40, 10)).rotateX(Math.PI / 2).translate(0, 0, 0.012);
  b.add(surf, axial(cover, p, n), false);
  if (!k.near) return;
  const hd = (hingeDir || new THREE.Vector3().crossVectors(n, Math.abs(n.y) < 0.9 ? Y_AXIS : X_AXIS)).clone().normalize();
  const q = quatZ(n);
  block(k, b, 'metalBare', p.clone().addScaledVector(hd, r * 0.95).addScaledVector(n, 0.04), 0.06, 0.06, 0.05, q);
  const side = new THREE.Vector3().crossVectors(n, hd).normalize();
  handrail(k, b, p.clone().addScaledVector(hd, -r * 0.55).addScaledVector(side, -0.12), p.clone().addScaledVector(hd, -r * 0.55).addScaledVector(side, 0.12), n, { surf: 'metalBare', standoff: 0.06, r: 0.01 });
}

/** Whip antenna with base insulator. */
export function whip(k, b, p, dir, len, { r = 0.008, surf = 'metalBare' } = {}) {
  if (k.far) return;
  const d = dir.clone().normalize();
  rod(k, b, 'paintWhite', p, p.clone().addScaledVector(d, 0.06), r * 3.5, { seg: 8 });
  rod(k, b, surf, p.clone().addScaledVector(d, 0.05), p.clone().addScaledVector(d, len), r, { seg: 4, rEnd: r * 0.6 });
}

/** Docking / flood light housing with lens (emissive class `light`), facing n. */
export function lamp(k, b, p, n, size = 0.12, light = 'dockLight') {
  const q = quatZ(n);
  if (!k.far) block(k, b, 'metalDark', p.clone().addScaledVector(n, -size * 0.35), size * 1.25, size * 1.25, size * 0.7, q, { bev: size * 0.08 });
  const lens = new THREE.CircleGeometry(size * 0.48, k.seg(16, 6));
  b.add(light, axial(lens, p.clone().addScaledVector(n, 0.004), n), false);
}

/** Small emissive point light (nav / strobe) on a short base. */
export function beacon(k, b, p, n, light, r = 0.05) {
  if (!k.far) rod(k, b, 'metalDark', p.clone().addScaledVector(n, -0.03), p.clone().addScaledVector(n, 0.02), r * 1.2, { seg: 8 });
  const g = new THREE.SphereGeometry(r, k.seg(10, 6), k.seg(6, 4), 0, Math.PI * 2, 0, Math.PI / 2);
  g.rotateX(Math.PI / 2);
  b.add(light, axial(g, p.clone().addScaledVector(n, 0.02), n), false);
}

/** ISS-style grapple fixture (FRGF): base plate, shaft, cam plate, target pin. */
export function grappleFixture(k, b, p, n, roll = 0) {
  if (k.far) return;
  const q = quatZ(n); if (roll) q.multiply(new THREE.Quaternion().setFromAxisAngle(Z_AXIS, roll));
  block(k, b, 'metalBare', p.clone().addScaledVector(n, 0.02), 0.36, 0.36, 0.04, q, { bev: 0.01 });
  rod(k, b, 'metalBare', p.clone().addScaledVector(n, 0.03), p.clone().addScaledVector(n, 0.3), 0.035, { seg: 12 });
  if (!k.near) return;
  const cam = new THREE.CylinderGeometry(0.075, 0.075, 0.03, 3).rotateX(Math.PI / 2);
  b.add('metalBare', cam.applyMatrix4(_m.compose(p.clone().addScaledVector(n, 0.3), q, _s)), false);
  // visual target: black plate with white cross on a post next to the shaft
  const side = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  rod(k, b, 'metalDark', p.clone().addScaledVector(side, 0.13), p.clone().addScaledVector(side, 0.13).addScaledVector(n, 0.12), 0.01, { seg: 6 });
  block(k, b, 'rubberBlack', p.clone().addScaledVector(side, 0.13).addScaledVector(n, 0.12), 0.1, 0.1, 0.008, q);
  block(k, b, 'paintWhite', p.clone().addScaledVector(side, 0.13).addScaledVector(n, 0.125), 0.08, 0.012, 0.004, q);
  block(k, b, 'paintWhite', p.clone().addScaledVector(side, 0.13).addScaledVector(n, 0.125), 0.012, 0.08, 0.004, q);
  boltRow(k, b, p.clone().addScaledVector(n, 0.045).addScaledVector(side, -0.15), p.clone().addScaledVector(n, 0.045).addScaledVector(side, 0.15), n, 4, 0.01);
}

/**
 * Rectangular solar panel parts in panel-local coordinates: hinge line along local X at y = 0, panel spanning
 * y = 0..len, x = -w/2..w/2, cells facing +Z. Returns [[surface, geometry], ...] (for instancedParts).
 */
export function solarPanelParts(k, w, len, { cell = 'solar', back = 'solarBack', frame = 'metalBare', t = 0.03, cellUV = 3.2, hinge = true } = {}) {
  const parts = [];
  const g = new THREE.BoxGeometry(w - 0.04, len - 0.04, 0.006);
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w * cellUV / TEX_M * 4, uv.getY(i) * len * cellUV / TEX_M * 2);
  parts.push([cell, g.translate(0, len / 2, t / 2)]);
  parts.push([back, new THREE.BoxGeometry(w - 0.02, len - 0.02, t * 0.6).translate(0, len / 2, 0)]);
  if (!k.far) {
    for (const sx of [-1, 1]) parts.push([frame, new THREE.BoxGeometry(0.025, len, t * 1.1).translate(sx * (w / 2 - 0.0125), len / 2, 0)]);
    for (const y of [0.0125, len - 0.0125]) parts.push([frame, new THREE.BoxGeometry(w, 0.025, t * 1.1).translate(0, y, 0)]);
  }
  if (k.near && hinge) {
    for (const sx of [-0.32, 0.32]) {
      parts.push(['metalDark', new THREE.CylinderGeometry(0.018, 0.018, 0.12, 8).rotateZ(Math.PI / 2).translate(sx * w, 0, 0)]);
      parts.push(['metalDark', new THREE.BoxGeometry(0.1, 0.05, 0.012).translate(sx * w, 0.03, -t * 0.6)]);
    }
    // cross stiffener on the back
    parts.push(['metalBare', new THREE.BoxGeometry(w * 0.9, 0.02, 0.012).translate(0, len / 2, -t * 0.55)]);
  }
  return parts;
}

/** Surface frame at p with outward normal n: X tangent (around Z), Y along +Z-ish, Z = n. */
export function surfaceQuat(n, a = null) {
  const t = a === null ? (Math.abs(n.z) > 0.95 ? X_AXIS.clone() : new THREE.Vector3(-n.y, n.x, 0).normalize()) : V(-Math.sin(a), Math.cos(a), 0);
  const u = new THREE.Vector3().crossVectors(n, t).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(t, u, n));
}

/** Raised blanket / cover patch (w x h) on a surface with a bound edge and corner fasteners (L0/L1). */
export function patch(k, b, p, n, w, h, { surf = 'blanketGrey', tape = 'feltFlat', tint = null, q = null, t = 0.018 } = {}) {
  if (k.far) return;
  const qq = q || surfaceQuat(n);
  block(k, b, surf, p.clone().addScaledVector(n, t / 2), w, h, t, qq, { bev: Math.min(0.008, t * 0.4), tint });
  if (!k.near) return;
  const ex = V(1, 0, 0).applyQuaternion(qq), ey = V(0, 1, 0).applyQuaternion(qq);
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const c = p.clone().addScaledVector(ex, sx * (w / 2 - 0.03)).addScaledVector(ey, sy * (h / 2 - 0.03)).addScaledVector(n, t + 0.002);
    b.add('metalBare', axial(new THREE.CylinderGeometry(0.009, 0.009, 0.006, 6).rotateX(Math.PI / 2), c, n), false);
  }
  for (const sy of [-1, 1]) block(k, b, tape, p.clone().addScaledVector(ey, sy * h / 2).addScaledVector(n, t * 0.7), w, 0.016, t * 0.6, qq, { tint: 0x6a6e66 });
}

/** Electrical / fluid connector panel: base plate with round plugs (L0 only). */
export function connector(k, b, p, n, { w = 0.16, h = 0.1, plugs = 3, q = null } = {}) {
  if (!k.near) return;
  const qq = q || surfaceQuat(n);
  block(k, b, 'metalDark', p.clone().addScaledVector(n, 0.012), w, h, 0.024, qq, { bev: 0.004 });
  const ex = V(1, 0, 0).applyQuaternion(qq);
  for (let i = 0; i < plugs; i++) {
    const c = p.clone().addScaledVector(ex, (i - (plugs - 1) / 2) * (w / plugs)).addScaledVector(n, 0.024);
    rod(k, b, i % 2 ? 'gold' : 'metalBare', c, c.clone().addScaledVector(n, 0.035), Math.min(0.022, w / plugs * 0.35), { seg: 10 });
  }
}

/** Cable / pipe run through `pts` (surface points, lifted along their normals), with clamps every ~0.4 m (L0). */
export function cable(k, b, pts, r = 0.01, { surf = 'cable', clamps = true } = {}) {
  if (!k.near) return;
  for (let i = 1; i < pts.length; i++) {
    rod(k, b, surf, pts[i - 1], pts[i], r, { seg: 5 });
    if (clamps && i < pts.length - 1) {
      const d = pts[i + 1].clone().sub(pts[i - 1]).normalize();
      b.add('metalBare', axial(new THREE.CylinderGeometry(r * 1.9, r * 1.9, r * 1.6, 6).rotateX(Math.PI / 2), pts[i], d), false);
    }
  }
}

/** Small vent / valve: flange, body and cap pointing along n (L0). */
export function vent(k, b, p, n, r = 0.03) {
  if (!k.near) return;
  rod(k, b, 'metalDark', p, p.clone().addScaledVector(n, 0.015), r * 1.6, { seg: 10 });
  rod(k, b, 'metalBare', p.clone().addScaledVector(n, 0.015), p.clone().addScaledVector(n, 0.05), r, { seg: 10 });
  rod(k, b, 'blackAnod', p.clone().addScaledVector(n, 0.05), p.clone().addScaledVector(n, 0.058), r * 1.2, { seg: 10 });
}

/** Instance matrices helper: compose(position, quaternion) into an InstancedMesh slot. */
export function setInst(mesh, i, matrix) { mesh.setMatrixAt(i, matrix); }

export { V, X_AXIS, Y_AXIS, Z_AXIS, quatZ, quatY, LocalColliders, faceMatrix, plane, flipInside, scaleUV };
