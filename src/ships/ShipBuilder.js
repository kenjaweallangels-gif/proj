import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LAYERS } from '../core/constants.js';

/**
 * Geometry + material helpers for the procedural ships (independent of the station builder so the ships
 * module never breaks when the station is being edited).
 *
 * Ship local frame: +Z = docking/nose axis (toward the port), nose (docking plane) at the origin, body along -Z.
 *
 * Draw-call budget: a ship is at most a handful of meshes. ShipBuilder sorts every geometry into one of four
 * buckets, each rendered with ONE material:
 *   flat  – every untextured surface (metal, paint, nozzles, lights…). Colour comes from a vertex colour,
 *           roughness/metalness from a 32×1 lookup texture addressed by a constant per-part UV, and the
 *           emissive parts (nav lights, strobe, windows, docking lights, hot nozzle liner) read a per-ship
 *           32×1 float texture (ShipLights) through the same UV, so strobes / glow are animated by writing
 *           a few texels instead of swapping materials.
 *   hull  – painted-panel texture, tinted per part by vertex colour (white, aged, dark tiles, radiator…)
 *   mli   – crinkled MLI foil (gold / silver / dark by vertex colour)
 *   solar – solar cell texture
 *   plus one transparent decal mesh with a per-ship text atlas (all labels in a single canvas).
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

// ------------------------------------------------------------------------------------------ surfaces
const LUT_N = 64;
/** Untextured surface classes: name -> { cell, color, rough, metal, emissive, intensity }. */
export const SURF = {};
let _cell = 0;
function surf(name, hex, rough, metal, emissive = null, intensity = 0) {
  SURF[name] = { cell: _cell++, color: new THREE.Color(hex), rough, metal, emissive: emissive === null ? null : new THREE.Color(emissive), intensity };
}
surf('metalDark', 0x3a3d42, 0.5, 0.85);
surf('metalBare', 0xb8bcc2, 0.42, 0.95);
surf('metalTitanium', 0x8e9196, 0.45, 0.9);
surf('nozzle', 0x4a4440, 0.62, 0.9);
surf('dockRing', 0x9a9ea3, 0.4, 0.9);
surf('rubberBlack', 0x141414, 0.9, 0.0);
surf('mliBlack', 0x1c1d20, 0.55, 0.6);
surf('truss', 0xe8e8e6, 0.55, 0.35);
surf('antennaWhite', 0xf4f4f0, 0.5, 0.2);
surf('paintOrange', 0xe8661b, 0.6, 0.1);
surf('paintGray', 0x7c8187, 0.65, 0.2);
surf('paintBlue', 0x1f3f7a, 0.55, 0.15);
surf('hazard', 0xf0b429, 0.6, 0.1);
surf('copper', 0xb87333, 0.35, 1.0);
surf('camera', 0x0a1020, 0.05, 0.3);
surf('cable', 0x2a2a2e, 0.8, 0.1);
surf('tank', 0xd8dadc, 0.3, 0.9);
surf('paintWhite', 0xeeeeea, 0.55, 0.08);
surf('paintRed', 0xb3201c, 0.55, 0.1);
surf('gold', 0xc9a046, 0.35, 0.9);          // anodised handrails / fittings
surf('blackAnod', 0x18191b, 0.45, 0.5);
surf('nozzleIn', 0x2a2522, 0.7, 0.6);
surf('glassDark', 0x0c1218, 0.05, 0.6);
surf('kapton', 0xc08a2a, 0.32, 0.9);        // gold foil seen from far (flat LOD)
surf('ceramic', 0xc8c8c4, 0.85, 0.0);
surf('feltFlat', 0x8f977f, 0.9, 0.0);       // quilted blanket seen from far (tinted)
surf('solarFlat', 0x1a2550, 0.3, 0.5);
surf('lens', 0x05070a, 0.03, 0.2);
surf('beta', 0xe8e6de, 0.85, 0.0);
// emissive classes: radiance = emissive colour × intensity, intensity may be animated through ShipLights
surf('navRed', 0x300000, 0.4, 0.0, 0xff2010, 6);
surf('navGreen', 0x003000, 0.4, 0.0, 0x20ff40, 6);
surf('window', 0x202428, 0.12, 0.4, 0xffd9a0, 1.8);
surf('strobe', 0x303030, 0.4, 0.0, 0xffffff, 0);
surf('dockLight', 0x404040, 0.3, 0.0, 0xfff2dc, 0);
surf('hot', 0x1a1a1a, 0.6, 0.8, 0xff5a1a, 0);
surf('beacon', 0x302000, 0.4, 0.0, 0xffb020, 0);
surf('portLight', 0x200808, 0.4, 0.0, 0xff3020, 0);      // flashing red beacon (Soyuz-style)
surf('ledWhite', 0x303030, 0.3, 0.0, 0xd8e8ff, 0);      // rendezvous / target LEDs

/** Textured surfaces: name -> [bucket, tint]. */
const TEXTURED = {
  hull: ['hull', 0xffffff], hullAged: ['hull', 0xe0e2e2], hullGray: ['hull', 0xb9bec4], felt: ['hull', 0xdcdedd],
  tiles: ['hull', 0x2c2927], tilesFine: ['hull', 0x1e1d1c], radiator: ['hull', 0xf2f3f4], solarBack: ['hull', 0xc7c2b5], hullDark: ['hull', 0x4a4e54],
  tilesHS: ['hull', 0x3b3633], tilesWhite: ['hull', 0xe6e6e2], hullSilver: ['hull', 0xc9ccd0], hullCream: ['hull', 0xe9e5da],
  mliGold: ['mli', 0xd9a63a], mliSilver: ['mli', 0xcfd3d8], mliDark: ['mli', 0x3a3a3c],
  solar: ['solar', 0xffffff], solarDark: ['solar', 0x9aa0b8],
  // quilted thermal blankets (Soyuz EVTI, beta cloth)
  blanketGreen: ['blanket', 0x8e957d], blanketWhite: ['blanket', 0xefeee9], blanketGrey: ['blanket', 0xb3b5b0], betaCloth: ['blanket', 0xe6e3d8],
};
/** Flat stand-in (far LOD: one material) for every textured bucket. */
const FLAT_PROXY = { hull: 'paintWhite', mli: 'kapton', solar: 'solarFlat', blanket: 'feltFlat' };

/** Per-ship animated emissive texture (one texel per surface class, linear radiance). */
export class ShipLights {
  constructor() {
    this.data = new Float32Array(LUT_N * 4);
    this.values = {};
    this.dirty = false;
    const t = new THREE.DataTexture(this.data, LUT_N, 1, THREE.RGBAFormat, THREE.FloatType);
    t.colorSpace = THREE.NoColorSpace;
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    this.tex = t;
    for (const name in SURF) if (SURF[name].emissive) this.set(name, SURF[name].intensity);
    this.commit(true);
  }
  /** Set a channel's intensity (0 = off). */
  set(name, intensity) {
    const s = SURF[name];
    if (!s || !s.emissive || this.values[name] === intensity) return;
    this.values[name] = intensity;
    const i = s.cell * 4, e = s.emissive;
    this.data[i] = e.r * intensity; this.data[i + 1] = e.g * intensity; this.data[i + 2] = e.b * intensity; this.data[i + 3] = 1;
    this.dirty = true;
  }
  commit(force = false) { if (this.dirty || force) { this.tex.needsUpdate = true; this.dirty = false; } }
  dispose() { this.tex.dispose(); }
}

/** Shared materials (one set for every ship). */
const _shared = new WeakMap();
export function shipMaterials(materials) {
  let s = _shared.get(materials);
  if (s) return s;
  // roughness (G) / metalness (B) lookup, one texel per surface class
  const lut = new Uint8Array(LUT_N * 4);
  for (const name in SURF) { const c = SURF[name]; lut[c.cell * 4] = 255; lut[c.cell * 4 + 1] = Math.round(c.rough * 255); lut[c.cell * 4 + 2] = Math.round(c.metal * 255); lut[c.cell * 4 + 3] = 255; }
  const lutTex = new THREE.DataTexture(lut, LUT_N, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  lutTex.colorSpace = THREE.NoColorSpace; lutTex.magFilter = lutTex.minFilter = THREE.NearestFilter; lutTex.generateMipmaps = false; lutTex.needsUpdate = true;
  const flatStatic = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1, roughnessMap: lutTex, metalnessMap: lutTex });
  flatStatic.name = 'shipFlat';
  // painted panels: the station's baked PBR set (4 m ship tiles vs 6.5 m station tiles), procedural on 'lite'
  const pb = !materials.lite && materials.textures.pbr ? materials.textures.pbr('hull_white', { repeat: 1.625, ormHalf: true }) : null;
  const ht = pb ? null : materials.textures.hullPanels({ size: 512, base: '#eceeef', seam: '#8f969d', grime: 0.2, cells: 8, seed: 71 });
  const hull = pb
    ? new THREE.MeshStandardMaterial({ map: pb.map, normalMap: pb.normalMap, roughnessMap: pb.ormMap, metalnessMap: pb.ormMap, aoMap: pb.ormMap, aoMapIntensity: 0.8, roughness: 1, metalness: 1, vertexColors: true })
    : new THREE.MeshStandardMaterial({ map: ht.map, roughnessMap: ht.roughnessMap, normalMap: ht.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.62, metalness: 0.1, vertexColors: true });
  hull.name = 'shipHull';
  const mli = materials.get('mliGold').clone();
  mli.color.set(0xffffff); mli.vertexColors = true; mli.name = 'shipMli';
  const solar = materials.get('solarCell').clone();
  solar.name = 'shipSolar';
  const q = quiltTextures(materials.textures);
  const blanket = new THREE.MeshStandardMaterial({ map: q.map, normalMap: q.normalMap, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.88, metalness: 0.0, vertexColors: true });
  blanket.name = 'shipBlanket';
  const inst = new Map();
  s = { lutTex, flatStatic, hull, mli, solar, blanket,
    /** Separate material instances for InstancedMesh users (see App.splitMaterialVariants). */
    inst(m) { if (!inst.has(m)) { const c = m.clone(); c.name = `${m.name}Inst`; inst.set(m, c); } return inst.get(m); },
    flatLit(lights) {
    const m = flatStatic.clone();
    m.emissive.set(0xffffff); m.emissiveIntensity = 1; m.emissiveMap = lights.tex; m.name = 'shipFlatLit';
    return m;
  } };
  _shared.set(materials, s);
  return s;
}

// ------------------------------------------------------------------------------------------ geometry helpers
export function scaleUV(geo, su, sv) {
  const uv = geo.attributes.uv;
  if (!uv) return geo;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return geo;
}

/** Point every UV of a geometry at one LUT cell. */
function setCellUV(geo, cell) {
  const n = geo.attributes.position.count;
  let uv = geo.attributes.uv;
  if (!uv || uv.count !== n) { uv = new THREE.BufferAttribute(new Float32Array(n * 2), 2); geo.setAttribute('uv', uv); }
  const u = (cell + 0.5) / LUT_N;
  for (let i = 0; i < n; i++) uv.setXY(i, u, 0.5);
  return geo;
}

/** Constant vertex colour attribute (linear). */
function setColor(geo, color) {
  const n = geo.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = color.r; a[i * 3 + 1] = color.g; a[i * 3 + 2] = color.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}

/** Turn a closed geometry inside-out (for liners seen from within). */
export function flipInside(geo) {
  const idx = geo.index;
  if (idx) for (let i = 0; i < idx.count; i += 3) { const a = idx.getX(i); idx.setX(i, idx.getX(i + 2)); idx.setX(i + 2, a); }
  else { const p = geo.attributes.position; for (let i = 0; i < p.count; i += 3) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); p.setXYZ(i, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2)); p.setXYZ(i + 2, x, y, z); } }
  const n = geo.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
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

/** Cylinder along the ship axis (Z) from z0 to z1 (z1 < z0 allowed), radius r at z0 side, rEnd at z1. */
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
 * Lathe around the ship axis (Z): profile = [[radius, z], ...] ordered along z. Returns a surface of
 * revolution with outward normals (open ends if the first/last radius > 0).
 */
export function latheZ(profile, seg = 48, thetaStart = 0, thetaLength = Math.PI * 2) {
  const pts = profile.map(([r, z]) => new THREE.Vector2(r, z));
  const g = new THREE.LatheGeometry(pts, seg, thetaStart, thetaLength);
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

// ------------------------------------------------------------------------------------------ builder
const BUCKET_ORDER = ['hull', 'blanket', 'mli', 'solar', 'flat'];

/** Collects geometries into the four material buckets and merges each into one mesh. */
export class ShipBuilder {
  constructor(materials) {
    this.materials = materials;
    this.shared = shipMaterials(materials);
    this.buckets = new Map();
    this.labels = [];
  }

  /**
   * Add a positioned geometry with surface `name` (a SURF class or a TEXTURED name). `shadow` marks it as a
   * shadow caster (only honoured for the hull / mli / solar buckets). `tint` overrides the vertex colour.
   */
  add(name, geo, shadow = true, tint = null) {
    const s = SURF[name];
    if (s) { setCellUV(geo, s.cell); setColor(geo, tint ? toColor(tint) : s.color); this._push('flat', geo, shadow); return geo; }
    const t = TEXTURED[name];
    if (!t) throw new Error(`ShipBuilder: unknown surface "${name}"`);
    if (this.flatOnly) {
      const p = SURF[FLAT_PROXY[t[0]]];
      setCellUV(geo, p.cell); setColor(geo, tint ? toColor(tint) : (t[0] === 'solar' ? p.color : toColor(t[1])));
      this._push('flat', geo, shadow); return geo;
    }
    setColor(geo, tint ? toColor(tint) : toColor(t[1]));
    this._push(t[0], geo, shadow);
    return geo;
  }

  _push(bucket, geo, shadow) {
    let b = this.buckets.get(bucket);
    if (!b) { b = { geos: [], shadow: false }; this.buckets.set(bucket, b); }
    b.geos.push(geo);
    if (shadow) b.shadow = true;
  }

  /** Text decal (w×h) centred at p with outward normal n; `right` fixes the reading direction. */
  label(text, w, h, p, n, opts = {}) {
    const g = plane(w, h, faceMatrix(p, n, opts.up || Y_AXIS, opts.right || null));
    this.labels.push({ text, w, h, geo: g, color: opts.color || '#1b1f24', font: opts.font || null });
    return g;
  }

  /**
   * Merge every bucket into meshes under `parent`. `lights` (ShipLights) makes the flat bucket emissive-animated
   * (static sub-assemblies such as dishes pass none and share one material). Returns the meshes.
   */
  build(parent, name = 'ship', { lights = null, shadows = true, receive = true, flatMaterial = null } = {}) {
    const meshes = [];
    for (const key of BUCKET_ORDER) {
      const b = this.buckets.get(key);
      if (!b || !b.geos.length) continue;
      const merged = mergeAll(b.geos);
      if (!merged) { console.warn('[Ships] merge failed for', name, key); continue; }
      const material = key === 'flat' ? (flatMaterial || (lights ? this.shared.flatLit(lights) : this.shared.flatStatic)) : this.shared[key];
      const mesh = new THREE.Mesh(merged, material);
      mesh.name = `${name}:${key}`;
      mesh.castShadow = !!shadows && key !== 'flat' && b.shadow;
      mesh.receiveShadow = !!receive;
      parent.add(mesh);
      meshes.push(mesh);
    }
    const lab = this._buildLabels(parent, name);
    if (lab) meshes.push(lab);
    this.buckets.clear();
    this.labels.length = 0;
    return meshes;
  }

  /** All labels of the ship share one canvas atlas -> one transparent decal mesh. */
  _buildLabels(parent, name) {
    const L = this.labels;
    if (!L.length) return null;
    const W = 512, RH = 96, rows = L.length;
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = RH * rows;
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, W, canvas.height);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const geos = [];
    for (let i = 0; i < rows; i++) {
      const lab = L[i];
      const subW = Math.max(16, Math.min(W, Math.round(RH * lab.w / lab.h)));
      let px = RH * 0.72;
      const fontOf = (p) => lab.font ? lab.font.replace(/\d+px/, `${Math.round(p)}px`) : `bold ${Math.round(p)}px "Segoe UI", Arial, sans-serif`;
      g.font = fontOf(px);
      const tw = g.measureText(lab.text).width;
      if (tw > subW * 0.92) { px *= (subW * 0.92) / tw; g.font = fontOf(px); }
      g.fillStyle = lab.color;
      g.fillText(lab.text, subW / 2, i * RH + RH / 2);
      // remap the plane's 0..1 UVs into its atlas cell
      const uv = lab.geo.attributes.uv, su = subW / W, v0 = 1 - (i + 1) / rows, sv = 1 / rows;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * su, v0 + uv.getY(k) * sv);
      setColor(lab.geo, WHITE);
      geos.push(lab.geo);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.anisotropy = this.materials.textures.anisotropy || 4; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
    const material = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.7, metalness: 0.0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false });
    material.name = 'shipLabels';
    const mesh = new THREE.Mesh(mergeAll(geos), material);
    mesh.name = `${name}:labels`;
    mesh.castShadow = false; mesh.receiveShadow = false; mesh.renderOrder = 10;
    parent.add(mesh);
    return mesh;
  }
}

const WHITE = new THREE.Color(0xffffff);
function toColor(c) { return c instanceof THREE.Color ? c : new THREE.Color(c); }

/** mergeGeometries that tolerates mixed indexed / non-indexed input; disposes the inputs. */
export function mergeAll(geos, useGroups = false) {
  if (geos.length === 1 && !useGroups) { geos[0].computeBoundingSphere(); return geos[0]; }
  if (geos.some((g) => !g.index)) for (let i = 0; i < geos.length; i++) if (geos[i].index) { const ni = geos[i].toNonIndexed(); geos[i].dispose(); geos[i] = ni; }
  const merged = mergeGeometries(geos, useGroups);
  if (!merged) return null;
  for (const g of geos) g.dispose();
  merged.computeBoundingSphere();
  return merged;
}

/**
 * Build a small multi-material geometry for InstancedMesh parts: parts = [[surfaceName, geometry], ...].
 * Returns { geometry (with groups), materials } where flat surfaces share the static flat material.
 */
export function instancedParts(shared, parts) {
  const geos = [], mats = [];
  // consecutive parts with the same bucket are merged into one group
  const byBucket = new Map();
  for (const [name, geo] of parts) {
    const s = SURF[name];
    let bucket;
    if (s) { setCellUV(geo, s.cell); setColor(geo, s.color); bucket = 'flat'; }
    else { const t = TEXTURED[name]; if (!t) throw new Error(`instancedParts: unknown surface "${name}"`); setColor(geo, toColor(t[1])); bucket = t[0]; }
    if (!byBucket.has(bucket)) byBucket.set(bucket, []);
    byBucket.get(bucket).push(geo);
  }
  for (const [bucket, list] of byBucket) {
    geos.push(mergeAll(list));
    mats.push(shared.inst(bucket === 'flat' ? shared.flatStatic : shared[bucket]));
  }
  const geometry = mergeAll(geos, true);
  return { geometry, materials: mats.length === 1 ? mats[0] : mats };
}

/**
 * Quilted blanket texture (Soyuz-style EVTI / beta cloth): stitched pillows with fine wrinkles. The colour map is a
 * light greyscale (tinted per part by vertex colour) with the stitch lines darkened, so 'lite' (no normal maps) keeps it.
 */
function quiltTextures(textures) {
  return textures._cached('shipQuilt', () => {
    const size = 512, cells = 8, cs = size / cells;
    const h = new Float32Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = (x % cs) / cs, v = (y % cs) / cs;
      const pillow = Math.pow(Math.sin(Math.PI * u) * Math.sin(Math.PI * v), 0.35);
      const ci = Math.floor(x / cs), cj = Math.floor(y / cs);
      const wr = textures.constructor.fbm(x / size * 22, y / size * 22, 3, 5 + ci * 3 + cj * 7);
      h[y * size + x] = pillow * 0.9 + wr * 0.25 - ((u < 0.025 || u > 0.975 || v < 0.025 || v > 0.975) ? 0.4 : 0);
    }
    const normalMap = textures._heightToNormal(h, size, 2.6);
    const [c, g] = textures._canvas(size, size);
    const img = g.createImageData(size, size), d = img.data;
    for (let i = 0; i < size * size; i++) {
      const x = i % size, y = (i / size) | 0;
      const ci = Math.floor(x / cs), cj = Math.floor(y / cs);
      const shade = 0.93 + 0.05 * textures.constructor.noise2(ci, cj, 9);
      const v = 255 * Math.max(0, Math.min(1, shade * (0.84 + 0.16 * Math.min(1, h[i] + 0.2))));
      d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return { map: textures._tex(c), normalMap };
  });
}

// ------------------------------------------------------------------------------------------ hinged instanced parts
const _pm = new THREE.Matrix4(), _pm2 = new THREE.Matrix4(), _pq = new THREE.Quaternion(), _pt = new THREE.Vector3();

/**
 * Three-petal soft-capture ring at the nose (z = 0 plane). Returns the petal record for animation:
 * { mesh, hinges, open, extend }  open: 0 upright .. 1 splayed; extend: 0 retracted into the tunnel .. 1 extended.
 */
export function buildPetals(shared, R, parent) {
  const part = instancedParts(shared, [['metalBare', box(V(0.02, 0, 0.19), 0.12, 0.44, 0.38, null, false)], ['metalDark', box(V(0.09, 0, 0.1), 0.05, 0.3, 0.2, null, false)]]);
  const im = new THREE.InstancedMesh(part.geometry, part.materials, 3);
  im.name = 'petals'; im.castShadow = false; im.receiveShadow = false; im.frustumCulled = false;
  const hinges = [];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + Math.PI / 6;
    const hinge = new THREE.Matrix4().compose(V(Math.cos(a) * (R + 0.12), Math.sin(a) * (R + 0.12), 0.0), new THREE.Quaternion().setFromAxisAngle(Z_AXIS, a), V(1, 1, 1));
    hinges.push(hinge);
    im.setMatrixAt(k, hinge);
  }
  im.instanceMatrix.needsUpdate = true;
  parent.add(im);
  return { mesh: im, hinges, open: -1, extend: -1 };
}

/** Update the petal instance matrices (open 0..1 splay, extend 0..1 ring extension). */
export function setPetals(p, open, extend) {
  if (Math.abs(p.open - open) < 1e-3 && Math.abs(p.extend - extend) < 1e-3) return;
  p.open = open; p.extend = extend;
  _pq.setFromAxisAngle(Y_AXIS, 0.62 * open);
  _pt.set(0, 0, -0.36 * (1 - extend));
  _pm2.compose(_pt, _pq, _s.set(1, 1, 1));
  for (let k = 0; k < p.hinges.length; k++) p.mesh.setMatrixAt(k, _pm.copy(p.hinges[k]).multiply(_pm2));
  p.mesh.instanceMatrix.needsUpdate = true;
}

/** Generic instanced hinge set: `hinges` matrices, animated by a rotation about `axis` by `angle`. */
export function setHinged(p, value, axis, angle) {
  if (Math.abs(p.open - value) < 1e-3) return;
  p.open = value;
  _pq.setFromAxisAngle(axis, angle);
  _pm2.makeRotationFromQuaternion(_pq);
  for (let k = 0; k < p.hinges.length; k++) p.mesh.setMatrixAt(k, _pm.copy(p.hinges[k]).multiply(_pm2));
  p.mesh.instanceMatrix.needsUpdate = true;
}

/** A cluster of small RCS nozzles on a block at `p`, outward normal `n` (unit). Appends nozzle descriptors. */
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

export { LAYERS };
