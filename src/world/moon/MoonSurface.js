import * as THREE from 'three';

/**
 * Moon surface geometry: cube-sphere quadtree with chunked LOD (CPU-built patches displaced by the LOLA height map).
 *
 * Body-fixed frame (km): +x = (lat 0, lon 0), +y = (lat 0, lon 90 E), +z = north pole (mean-Earth / polar axis, as
 * the LOLA / LROC maps). Each cube face is a quadtree; a node is a patch of SEG x SEG cells (+ skirts against LOD
 * cracks). Vertices store their position relative to the patch centre (so the patch mesh carries the large offset in
 * its matrix and the GPU never sees big coordinates near the camera) and the unit body-fixed direction (`aDir`, for
 * texturing). Normals come from the height function (central differences at the cell scale), consistent across
 * neighbouring patches of any level.
 *
 * Selection (`select(camBody, pxPerRad, frustumBody)`): a node splits while its cells project larger than
 * `targetPx` pixels and the level is below `maxLevel`; nodes behind the horizon or outside the frustum are dropped.
 * Missing patches are built within a per-frame budget; until then the parent stays drawn.
 *
 * Extending to low orbit (50-100 km): raise `maxLevel` (each level halves the cell, level 10 = 0.17 km cells), feed a
 * finer height source to `heightFn` (e.g. the 4K LOLA .u16 or 16K tiles streamed per face) plus procedural crater /
 * regolith detail below the data resolution, and keep the camera-relative patch matrices (already in place).
 */

export const MOON_RADIUS_KM = 1737.4;
const FACE_ARC_KM = MOON_RADIUS_KM * Math.PI / 2;

// face basis: normal N, axes U, V (right-handed: U x V = N)
const FACES = [
  [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  [[-1, 0, 0], [0, -1, 0], [0, 0, 1]],
  [[0, 1, 0], [-1, 0, 0], [0, 0, 1]],
  [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  [[0, 0, 1], [0, 1, 0], [-1, 0, 0]],
  [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
];

const _d = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _sph = new THREE.Sphere();

/** Unit direction for face f at cube coordinates (s, t) in [-1, 1] (tan warp for near-uniform cells). */
function faceDir(f, s, t, out) {
  const F = FACES[f];
  const a = Math.tan(s * Math.PI / 4), b = Math.tan(t * Math.PI / 4);
  out.set(F[0][0] + a * F[1][0] + b * F[2][0], F[0][1] + a * F[1][1] + b * F[2][1], F[0][2] + a * F[1][2] + b * F[2][2]);
  return out.normalize();
}

class Node {
  constructor(face, level, x, y, parent) {
    this.face = face; this.level = level; this.x = x; this.y = y; this.parent = parent;
    this.children = null;
    this.mesh = null;
    this.lastUsed = 0;
    const n = 1 << level;
    this.s0 = -1 + 2 * x / n; this.s1 = -1 + 2 * (x + 1) / n;
    this.t0 = -1 + 2 * y / n; this.t1 = -1 + 2 * (y + 1) / n;
    this.center = faceDir(face, (this.s0 + this.s1) / 2, (this.t0 + this.t1) / 2, new THREE.Vector3());
    // angular radius: farthest corner
    let minDot = 1;
    for (const [s, t] of [[this.s0, this.t0], [this.s1, this.t0], [this.s0, this.t1], [this.s1, this.t1]]) minDot = Math.min(minDot, faceDir(face, s, t, _d).dot(this.center));
    this.angRadius = Math.acos(Math.min(1, minDot));
    this.cellKm = FACE_ARC_KM / n;          // patch edge (km); divided by SEG at selection
  }
  split() {
    if (this.children) return this.children;
    const l = this.level + 1, x = this.x * 2, y = this.y * 2;
    this.children = [new Node(this.face, l, x, y, this), new Node(this.face, l, x + 1, y, this), new Node(this.face, l, x, y + 1, this), new Node(this.face, l, x + 1, y + 1, this)];
    return this.children;
  }
}

export class MoonSurface {
  /**
   * @param {THREE.Material} material  shared patch material
   * @param {(dir: THREE.Vector3) => number} heightFn  height above the reference sphere (km) for a unit body direction
   */
  constructor(material, heightFn, { seg = 16, maxLevel = 10, targetPx = 5, budget = 6, maxLeaves = 500 } = {}) {
    this.material = material;
    this.heightFn = heightFn;
    this.seg = seg;
    this.maxLevel = maxLevel;
    this.targetPx = targetPx;
    this.budget = budget;
    this.maxLeaves = maxLeaves;
    this.group = new THREE.Group();     // body-fixed frame (km); positioned / oriented by the Moon module
    this.group.name = 'MoonSurface';
    this.roots = FACES.map((_, f) => new Node(f, 0, 0, 0, null));
    this.drawn = [];
    this.frame = 0;
    this.patchCount = 0;
    this._built = 0;
    this._index = this._buildIndex();
    this.stats = { leaves: 0, built: 0, maxLevel: 0 };
  }

  /** Triangle indices shared by all patches (grid + skirts). */
  _buildIndex() {
    const S = this.seg, row = S + 1, idx = [];
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
      idx.push(a, b, d, a, d, c);
    }
    // skirts: border ring (4 * S vertices after the grid), each border edge gets a quad down to its skirt copy
    const base = row * row;
    const border = [];
    for (let i = 0; i < S; i++) border.push(i);                         // bottom (j = 0)
    for (let j = 0; j < S; j++) border.push(j * row + S);               // right
    for (let i = S; i > 0; i--) border.push(S * row + i);               // top
    for (let j = S; j > 0; j--) border.push(j * row);                   // left
    this._border = border;
    for (let k = 0; k < border.length; k++) {
      const a = border[k], b = border[(k + 1) % border.length];
      const sa = base + k, sb = base + (k + 1) % border.length;
      idx.push(a, sa, b, b, sa, sb);
    }
    return idx;
  }

  _buildPatch(node) {
    const S = this.seg, row = S + 1, R = MOON_RADIUS_KM;
    const nGrid = row * row, nSkirt = this._border.length, n = nGrid + nSkirt;
    const pos = new Float32Array(n * 3), dir = new Float32Array(n * 3), nor = new Float32Array(n * 3);
    const cpos = node.center.clone().multiplyScalar(R + this.heightFn(node.center));
    const dS = (node.s1 - node.s0) / S, dT = (node.t1 - node.t0) / S;
    const cell = node.cellKm / S;
    const eps = Math.max(cell * 0.5, 0.05) / R;     // finite-difference step (radians)
    for (let j = 0; j <= S; j++) for (let i = 0; i <= S; i++) {
      const k = j * row + i;
      faceDir(node.face, node.s0 + i * dS, node.t0 + j * dT, _d);
      const h = this.heightFn(_d);
      const r = R + h;
      pos[k * 3] = _d.x * r - cpos.x; pos[k * 3 + 1] = _d.y * r - cpos.y; pos[k * 3 + 2] = _d.z * r - cpos.z;
      dir[k * 3] = _d.x; dir[k * 3 + 1] = _d.y; dir[k * 3 + 2] = _d.z;
      // normal from the height function: tangents east / north at this point
      _a.set(-_d.y, _d.x, 0); if (_a.lengthSq() < 1e-12) _a.set(1, 0, 0); _a.normalize();
      _b.crossVectors(_d, _a);
      const he = this.heightFn(_c.copy(_d).addScaledVector(_a, eps).normalize()) - this.heightFn(_c.copy(_d).addScaledVector(_a, -eps).normalize());
      const hn = this.heightFn(_c.copy(_d).addScaledVector(_b, eps).normalize()) - this.heightFn(_c.copy(_d).addScaledVector(_b, -eps).normalize());
      const gx = he / (2 * eps * r), gy = hn / (2 * eps * r);
      _c.copy(_d).addScaledVector(_a, -gx).addScaledVector(_b, -gy).normalize();
      nor[k * 3] = _c.x; nor[k * 3 + 1] = _c.y; nor[k * 3 + 2] = _c.z;
    }
    const drop = Math.max(0.3, cell * 0.6);
    for (let k = 0; k < nSkirt; k++) {
      const src = this._border[k], dst = nGrid + k;
      const dx = dir[src * 3], dy = dir[src * 3 + 1], dz = dir[src * 3 + 2];
      pos[dst * 3] = pos[src * 3] - dx * drop; pos[dst * 3 + 1] = pos[src * 3 + 1] - dy * drop; pos[dst * 3 + 2] = pos[src * 3 + 2] - dz * drop;
      dir[dst * 3] = dx; dir[dst * 3 + 1] = dy; dir[dst * 3 + 2] = dz;
      nor[dst * 3] = nor[src * 3]; nor[dst * 3 + 1] = nor[src * 3 + 1]; nor[dst * 3 + 2] = nor[src * 3 + 2];
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aDir', new THREE.BufferAttribute(dir, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setIndex(this._index);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.name = `MoonPatch_${node.face}_${node.level}_${node.x}_${node.y}`;
    mesh.position.copy(cpos);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.visible = false;
    mesh.frustumCulled = true;
    this.group.add(mesh);
    node.mesh = mesh;
    node.radiusKm = geo.boundingSphere.radius;
    this.patchCount++;
    this._built++;
    return mesh;
  }

  /** Builds the six root patches (synchronously; call once after the height map is ready). */
  buildRoots() { for (const r of this.roots) if (!r.mesh) this._buildPatch(r); }

  /** Rebuild every patch (e.g. after a better height map arrived). */
  rebuild() {
    const visit = (n) => { if (n.mesh) { this.group.remove(n.mesh); n.mesh.geometry.dispose(); n.mesh = null; this.patchCount--; } if (n.children) n.children.forEach(visit); };
    this.roots.forEach(visit);
    this.buildRoots();
  }

  /**
   * Chooses and shows the patches for a camera at `camBody` (body-fixed km). `pxPerRad` = viewport pixels per radian;
   * `frustumBody` (optional THREE.Frustum in the body frame, may be enlarged) culls nodes outside the view.
   */
  select(camBody, pxPerRad, frustumBody = null) {
    this.frame++;
    const R = MOON_RADIUS_KM;
    const dCam = camBody.length();
    const camDir = _a.copy(camBody).divideScalar(Math.max(dCam, 1e-6));
    // horizon (with 11 km of relief on both ends)
    const horizon = dCam > R - 12 ? Math.acos(Math.min(1, (R - 12) / dCam)) + Math.acos((R - 12) / (R + 11)) : Math.PI;
    for (const m of this.drawn) m.visible = false;
    this.drawn.length = 0;
    this._built = 0;
    let leaves = 0, maxL = 0;
    const want = [];
    const stack = this.roots.slice();
    while (stack.length) {
      const n = stack.pop();
      // horizon cull
      const ang = Math.acos(Math.max(-1, Math.min(1, n.center.dot(camDir))));
      if (ang - n.angRadius > horizon) continue;
      if (frustumBody) {
        _sph.center.copy(n.center).multiplyScalar(R);
        _sph.radius = R * Math.sin(Math.min(Math.PI / 2, n.angRadius)) + 12;
        if (n.level > 0 && !frustumBody.intersectsSphere(_sph)) continue;
      }
      const distKm = Math.max(0.05, _b.copy(n.center).multiplyScalar(R).distanceTo(camBody) - R * Math.sin(Math.min(Math.PI / 2, n.angRadius)) - 11);
      const px = (n.cellKm / this.seg) / distKm * pxPerRad;
      if (px > this.targetPx && n.level < this.maxLevel && leaves + want.length < this.maxLeaves) {
        const ch = n.split();
        stack.push(ch[0], ch[1], ch[2], ch[3]);
      } else want.push(n);
    }
    // show the wanted patches; build missing ones within the budget, else fall back to the nearest built ancestor
    const shown = new Set();
    // nearer first for the build budget
    want.sort((p, q) => q.level - p.level);
    for (const n of want) {
      let m = n.mesh;
      if (!m && this._built < this.budget) m = this._buildPatch(n);
      let node = n;
      while (!m && node.parent) { node = node.parent; m = node.mesh; }
      if (!m || shown.has(m)) continue;
      shown.add(m);
      node.lastUsed = this.frame;
      m.visible = true;
      this.drawn.push(m);
      leaves++; maxL = Math.max(maxL, node.level);
    }
    this.stats.leaves = leaves; this.stats.maxLevel = maxL; this.stats.patches = this.patchCount;
    if ((this.frame & 63) === 0) this._evict();
    return leaves;
  }

  /** Drops patch meshes unused for ~10 s once more than 800 are cached (level 0 stays). */
  _evict() {
    if (this.patchCount < 800) return;
    const old = this.frame - 600;
    const visit = (n) => {
      if (n.children) n.children.forEach(visit);
      if (n.mesh && n.level > 0 && n.lastUsed < old && !n.mesh.visible) {
        this.group.remove(n.mesh); n.mesh.geometry.dispose(); n.mesh = null; this.patchCount--;
      }
      if (n.children && n.children.every((c) => !c.mesh && !c.children)) n.children = null;
    };
    this.roots.forEach(visit);
  }

  dispose() {
    const visit = (n) => { if (n.mesh) n.mesh.geometry.dispose(); if (n.children) n.children.forEach(visit); };
    this.roots.forEach(visit);
  }
}
