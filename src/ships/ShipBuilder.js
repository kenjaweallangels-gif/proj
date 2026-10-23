import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LAYERS } from '../core/constants.js';

/**
 * Geometry helpers for the procedural ships (independent of the station builder so the ships
 * module never breaks when the station is being edited).
 *
 * Ship local frame: +Z = docking/nose axis (toward the port), nose at the origin, body along -Z.
 * ShipBuilder collects geometries per material and merges them into one mesh per bucket.
 */

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
export const X_AXIS = new THREE.Vector3(1, 0, 0);
export const Y_AXIS = new THREE.Vector3(0, 1, 0);
export const Z_AXIS = new THREE.Vector3(0, 0, 1);
export const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** Hull texture repeat in meters (denser than the station: ships are smaller). */
export const TEX_M = 4.0;

export function scaleUV(geo, su, sv) {
  const uv = geo.attributes.uv;
  if (!uv) return geo;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return geo;
}

/** Quaternion rotating local +Y to `dir`. */
export function quatY(dir) { return new THREE.Quaternion().setFromUnitVectors(Y_AXIS, _v.copy(dir).normalize()); }
/** Quaternion rotating local +Z to `dir`. */
export function quatZ(dir) { return new THREE.Quaternion().setFromUnitVectors(Z_AXIS, _v.copy(dir).normalize()); }

/** Matrix from translation (+ optional quaternion / scale). */
export function mat(x, y, z, quat = null, scale = null) {
  _v.set(x, y, z);
  return new THREE.Matrix4().compose(_v, quat || _q.identity(), scale || _s.set(1, 1, 1));
}

/** Cylinder centred at c with its axis along `dir`. opts: rTop, open, seg, hseg, thetaStart, thetaLength, uv. */
export function cyl(c, dir, r, len, seg = 24, opts = {}) {
  const g = new THREE.CylinderGeometry(opts.rTop ?? r, r, len, seg, opts.hseg ?? 1, !!opts.open, opts.thetaStart ?? 0, opts.thetaLength ?? Math.PI * 2);
  if (opts.uv !== false) scaleUV(g, (2 * Math.PI * r) / TEX_M * ((opts.thetaLength ?? Math.PI * 2) / (2 * Math.PI)), len / TEX_M);
  g.applyMatrix4(_m.compose(c, quatY(dir), _s.set(1, 1, 1)));
  return g;
}

/** Cylinder along the ship axis (Z) from z0 to z1 (z1 < z0 allowed), radius r at z0 side, rTop at z1. */
export function tubeZ(z0, z1, r, rEnd = r, seg = 32, opts = {}) {
  const len = Math.abs(z1 - z0), zc = (z0 + z1) / 2;
  // CylinderGeometry: radiusTop at +Y; rotateX(+90°) maps +Y -> +Z, so radiusTop sits at the greater z.
  const g = new THREE.CylinderGeometry(z1 < z0 ? r : rEnd, z1 < z0 ? rEnd : r, len, seg, opts.hseg ?? 1, !!opts.open, opts.thetaStart ?? 0, opts.thetaLength ?? Math.PI * 2);
  if (opts.uv !== false) scaleUV(g, (2 * Math.PI * Math.max(r, rEnd)) / TEX_M, len / TEX_M);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, zc);
  return g;
}

/** Box w×h×d centred at c with optional quaternion; UVs scaled to TEX_M (or unit when uvScale=false). */
export function box(c, w, h, d, quat = null, uvScale = true) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (uvScale) {
    const uv = g.attributes.uv; const f = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let i = 0; i < uv.count; i++) { const face = Math.floor(i / 4); uv.setXY(i, uv.getX(i) * f[face][0] / TEX_M, uv.getY(i) * f[face][1] / TEX_M); }
  }
  g.applyMatrix4(_m.compose(c, quat || _q.identity(), _s.set(1, 1, 1)));
  return g;
}

export function sphere(c, r, ws = 24, hs = 16, scale = null) {
  const g = new THREE.SphereGeometry(r, ws, hs);
  scaleUV(g, (2 * Math.PI * r) / TEX_M, (Math.PI * r) / TEX_M);
  if (scale) g.scale(scale.x, scale.y, scale.z);
  g.translate(c.x, c.y, c.z);
  return g;
}

/** Torus with axis along `dir`, centre c. */
export function torus(c, dir, R, r, rs = 8, ts = 32, arc = Math.PI * 2) {
  const g = new THREE.TorusGeometry(R, r, rs, ts, arc);
  g.applyMatrix4(_m.compose(c, quatZ(dir), _s.set(1, 1, 1)));
  return g;
}

/**
 * Lathe around the ship axis (Z): profile = [[radius, z], ...] ordered along z. Returns a closed surface of
 * revolution (open ends if the first/last radius > 0).
 */
export function latheZ(profile, seg = 48, thetaStart = 0, thetaLength = Math.PI * 2) {
  const pts = profile.map(([r, z]) => new THREE.Vector2(r, z));
  const g = new THREE.LatheGeometry(pts, seg, thetaStart, thetaLength);
  // LatheGeometry revolves around Y (profile x = radius, y = axial) with outward normals for increasing y.
  g.rotateX(Math.PI / 2);      // +Y -> +Z, so z = profile y
  let len = 0; for (let i = 1; i < profile.length; i++) len += Math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]);
  const rMax = Math.max(...profile.map((p) => p[0]));
  scaleUV(g, (2 * Math.PI * rMax) / TEX_M * (thetaLength / (2 * Math.PI)), len / TEX_M);
  return g;
}

/** Thin plane (w×h, normal +Z) placed by matrix. */
export function plane(w, h, matrix) { const g = new THREE.PlaneGeometry(w, h); g.applyMatrix4(matrix); return g; }

/** Orthonormal matrix with +Z = n (unit), +X = right (or derived from `up`), positioned at p. */
export function faceMatrix(p, n, up = Y_AXIS, right = null) {
  const nn = n.clone().normalize();
  let r = right ? right.clone().normalize() : new THREE.Vector3().crossVectors(up, nn);
  if (r.lengthSq() < 1e-6) r = new THREE.Vector3().crossVectors(X_AXIS, nn);
  r.normalize();
  const u = new THREE.Vector3().crossVectors(nn, r);
  return new THREE.Matrix4().makeBasis(r, u, nn).setPosition(p);
}

/** Local collider factories (ship frame). */
export const LocalColliders = {
  capsule(a, b, radius, name = '') { return { type: 'capsule', a: a.clone(), b: b.clone(), radius, name }; },
  sphere(center, radius, name = '') { return { type: 'sphere', center: center.clone(), radius, name }; },
  box(center, halfSize, quaternion = null, name = '') { return { type: 'box', center: center.clone(), halfSize: halfSize.clone(), quaternion: quaternion ? quaternion.clone() : new THREE.Quaternion(), name }; },
};

/** Collects geometries per material and merges them into one mesh per (material, shadow) pair. */
export class ShipBuilder {
  constructor(materials) {
    this.materials = materials;
    this.buckets = new Map();
  }

  /** Add a positioned geometry to the bucket of material `name`. One mesh per material; it casts shadows if any part asked for it. */
  add(name, geo, shadow = true, materialOverride = null) {
    const key = materialOverride ? `${name}#${materialOverride.uuid}` : name;
    let b = this.buckets.get(key);
    if (!b) { b = { material: materialOverride || this.materials.get(name), geos: [], shadow: false, name }; this.buckets.set(key, b); }
    b.geos.push(geo);
    if (shadow) b.shadow = true;
    return geo;
  }

  /** Text decal (w×h) centred at p with outward normal n; `right` fixes the reading direction. */
  label(text, w, h, p, n, opts = {}) {
    const texOpts = { width: opts.width ?? 512, height: opts.height ?? 128, color: opts.color ?? '#1b1f24', font: opts.font ?? 'bold 84px "Segoe UI", Arial, sans-serif', bg: opts.bg ?? null };
    const g = plane(w, h, faceMatrix(p, n, opts.up || Y_AXIS, opts.right || null));
    return this.add('label', g, false, this.materials.label(text, texOpts));
  }

  /** Merge every bucket into meshes under `parent`. */
  build(parent, name = 'ship') {
    const meshes = [];
    for (const b of this.buckets.values()) {
      if (!b.geos.length) continue;
      // mergeGeometries needs all-indexed or all-non-indexed input (ExtrudeGeometry is non-indexed)
      if (b.geos.length > 1 && b.geos.some((g) => !g.index)) for (let i = 0; i < b.geos.length; i++) if (b.geos[i].index) { const ni = b.geos[i].toNonIndexed(); b.geos[i].dispose(); b.geos[i] = ni; }
      const merged = b.geos.length === 1 ? b.geos[0] : mergeGeometries(b.geos, false);
      if (!merged) { console.warn('[Ships] merge failed for', b.name); continue; }
      if (b.geos.length > 1) for (const g of b.geos) g.dispose();
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, b.material);
      mesh.name = `${name}:${b.name}`;
      mesh.castShadow = b.shadow; mesh.receiveShadow = true;
      if (b.material.emissive && b.material.emissiveIntensity > 1) mesh.layers.set(LAYERS.NO_SHADOW);
      if (b.material.transparent) { mesh.renderOrder = 10; mesh.receiveShadow = false; }
      parent.add(mesh);
      meshes.push(mesh);
    }
    this.buckets.clear();
    return meshes;
  }
}

/**
 * Merge a list of [materialName, geometry] into one geometry with groups + a material array (one object, one
 * draw call per material). Used for repeated animated parts (petals, solar panels) via InstancedMesh.
 */
export function mergeMulti(materials, parts) {
  const geos = parts.map(([, g]) => g);
  if (geos.some((g) => !g.index)) for (let i = 0; i < geos.length; i++) if (geos[i].index) geos[i] = geos[i].toNonIndexed();
  const merged = mergeGeometries(geos, true);
  merged.computeBoundingSphere();
  return { geometry: merged, materials: parts.map(([n]) => (typeof n === 'string' ? materials.get(n) : n)) };
}

/**
 * Shared geometry/material pieces used by several ship types.
 */

/** Register ship-specific materials (idempotent). */
export function registerShipMaterials(materials) {
  const reg = (name, f) => { if (!materials.factories[name]) materials.register(name, f); };
  reg('shipTiles', () => {
    const t = materials.textures.hullPanels({ size: 512, base: '#2c2927', seam: '#0d0c0b', grime: 0.45, cells: 14, rivets: false, seed: 77 });
    return new THREE.MeshStandardMaterial({ map: t.map, roughnessMap: t.roughnessMap, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.9, metalness: 0.05 });
  });
  reg('shipTilesFine', () => {
    const t = materials.textures.hullPanels({ size: 512, base: '#232221', seam: '#0a0a0a', grime: 0.4, cells: 24, rivets: false, seed: 78 });
    return new THREE.MeshStandardMaterial({ map: t.map, roughnessMap: t.roughnessMap, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.88, metalness: 0.05 });
  });
  reg('shipHull', () => {
    const t = materials.textures.hullPanels({ size: 512, base: '#eceeef', seam: '#8f969d', grime: 0.2, cells: 8, seed: 71 });
    return new THREE.MeshStandardMaterial({ map: t.map, roughnessMap: t.roughnessMap, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.6, metalness: 0.1 });
  });
  reg('shipFelt', () => {
    // beta-cloth / felt reusable surface insulation (white-grey matte)
    const t = materials.textures.hullPanels({ size: 512, base: '#dcdedd', seam: '#a9adb0', grime: 0.25, cells: 16, rivets: false, seed: 73 });
    return new THREE.MeshStandardMaterial({ map: t.map, roughness: 0.95, metalness: 0.0 });
  });
  reg('shipDish', () => { const m = materials.get('antennaWhite').clone(); m.side = THREE.DoubleSide; return m; });
  reg('shipCamera', () => new THREE.MeshPhysicalMaterial({ color: 0x0a1020, metalness: 0.2, roughness: 0.05, clearcoat: 1.0, envMapIntensity: 2.0 }));
  reg('shipDockLight', () => { const m = materials.get('floodLight').clone(); m.emissiveIntensity = 0; return m; });
}

/** Three-petal soft-capture ring + hard ring at the nose (z=0 plane). Petals go into `petals` groups for animation. */
export function buildDockingNose(b, materials, R, parent, petalsOut, dockLightMat) {
  // hard-capture ring: annulus tunnel from z=-0.7 to z=0 (bore clear of the station's extended soft ring)
  b.add('dockRing', tubeZ(0, -0.7, R + 0.3, R + 0.3, 40, { open: true }));
  b.add('metalDark', tubeZ(0.0, -0.7, R + 0.03, R + 0.03, 32, { open: true, uv: false }), false);
  b.add('metalBare', new THREE.RingGeometry(R + 0.03, R + 0.3, 40).translate(0, 0, 0.0), false);
  b.add('metalDark', new THREE.RingGeometry(R + 0.03, R + 0.3, 40).rotateY(Math.PI).translate(0, 0, -0.7), false);
  b.add('metalDark', torus(V(0, 0, -0.68), Z_AXIS, R + 0.3, 0.05, 6, 40), false);
  // 12 latch hooks on the outer face
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2 + Math.PI / 12;
    b.add('metalDark', box(V(Math.cos(a) * (R + 0.2), Math.sin(a) * (R + 0.2), -0.12), 0.14, 0.1, 0.18, new THREE.Quaternion().setFromAxisAngle(Z_AXIS, a), false), false);
  }
  // alignment guides and the active docking target (black disc + white cross) on the ring face
  for (const sx of [-1, 1]) {
    b.add('metalDark', box(V(sx * (R + 0.52), 0, -0.35), 0.22, 0.2, 0.5, null, false), false);
    b.add('shipDockLight', box(V(sx * (R + 0.52), 0, -0.09), 0.14, 0.12, 0.03, null, false), false, dockLightMat);
  }
  // three petals (soft-capture guides): one InstancedMesh, instance matrices animated by `petalOpen`
  const petalGeo = mergeMulti(materials, [['metalBare', box(V(0.02, 0, 0.19), 0.12, 0.44, 0.38, null, false)], ['metalDark', box(V(0.09, 0, 0.1), 0.05, 0.3, 0.2, null, false)]]);
  const im = new THREE.InstancedMesh(petalGeo.geometry, petalGeo.materials, 3);
  im.name = 'petals'; im.castShadow = false; im.receiveShadow = true; im.frustumCulled = false;
  const hinges = [];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + Math.PI / 6;
    const hinge = new THREE.Matrix4().compose(V(Math.cos(a) * (R + 0.12), Math.sin(a) * (R + 0.12), 0.02), new THREE.Quaternion().setFromAxisAngle(Z_AXIS, a), V(1, 1, 1));
    hinges.push(hinge);
    im.setMatrixAt(k, hinge);
  }
  im.instanceMatrix.needsUpdate = true;
  parent.add(im);
  petalsOut.push({ mesh: im, hinges, open: -1 });
}

/** Update the petal instance matrices for an open fraction (0 upright .. 1 splayed outward). */
const _pm = new THREE.Matrix4(), _pm2 = new THREE.Matrix4(), _pq = new THREE.Quaternion();
export function setPetals(p, open) {
  if (Math.abs(p.open - open) < 1e-3) return;
  p.open = open;
  _pq.setFromAxisAngle(Y_AXIS, 0.62 * open);
  _pm2.makeRotationFromQuaternion(_pq);
  for (let k = 0; k < p.hinges.length; k++) p.mesh.setMatrixAt(k, _pm.copy(p.hinges[k]).multiply(_pm2));
  p.mesh.instanceMatrix.needsUpdate = true;
}

/** Generic instanced hinge set: `hinges` matrices, animated by a rotation about `axis` by angleFn(value). */
export function setHinged(p, value, axis, angle) {
  if (Math.abs(p.open - value) < 1e-3) return;
  p.open = value;
  _pq.setFromAxisAngle(axis, angle);
  _pm2.makeRotationFromQuaternion(_pq);
  for (let k = 0; k < p.hinges.length; k++) p.mesh.setMatrixAt(k, _pm.copy(p.hinges[k]).multiply(_pm2));
  p.mesh.instanceMatrix.needsUpdate = true;
}

/** A cluster of small RCS nozzles on a block at `p`, outward normal `n` (unit). Returns nozzle descriptors. */
export function rcsQuad(b, p, n, dirs, nozzles, size = 0.11) {
  const q = quatZ(n);
  b.add('mliBlack', box(p.clone().addScaledVector(n, -0.08), size * 3.6, size * 3.6, 0.22, q, false), false);
  for (const d of dirs) {
    const dd = d.clone().normalize();
    const pos = p.clone().addScaledVector(dd, size * 1.2).addScaledVector(n, 0.04);
    const g = new THREE.CylinderGeometry(size, size * 0.45, size * 2.2, 10, 1, true);
    g.applyMatrix4(new THREE.Matrix4().compose(pos, quatY(dd), new THREE.Vector3(1, 1, 1)));
    b.add('nozzle', g, false);
    nozzles.push({ position: pos.clone().addScaledVector(dd, size * 1.1), direction: dd });
  }
}

/** Nav light: small emissive box + returns its world-ish local position. */
export function navLight(b, p, matName, override = null) {
  b.add(matName, sphere(p, 0.07, 8, 6), false, override);
}
