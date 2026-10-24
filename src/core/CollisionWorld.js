import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

/**
 * Exact collisions against the render geometry (`ctx.collision`, created by App after the modules have loaded).
 *
 * Sources: the station exterior (incl. the rotating ring, solar arrays, antennas, the airlock hatches), the
 * interiors (station-frame zones and the ring zones in the ring's rotating group) and the ships (their L1
 * geometry in the ship frame). Every mesh is assigned to its parent Object3D (the "anchor"); the triangles of
 * all meshes of one anchor are merged in the anchor frame, split into spatial chunks (12 m cells) and each chunk
 * gets a BVH (three-mesh-bvh). Queries read the anchors' current `matrixWorld`, so anything that moves (the ring,
 * a hatch, a ship) is handled exactly without refitting. Anchors with identical content (the six ring sectors
 * share three sector variants; ships of one type share their template) share one set of BVHs.
 * BVHs are built lazily: on the first query that needs a chunk, and in the background (`update`, a few ms per
 * frame, nearest chunks first), so loading only collects the mesh lists.
 *
 * Not solid: glow / halo / beam / plume / strobe materials, additive or depth-write-free transparent materials
 * (glass is solid), first-person / shadow-proxy meshes, the fine hull hardware (DetailSet), spacesuits on their
 * mounts, objects flagged `userData.noCollide`.
 *
 * Layers (opts.mask): COLLIDE.EXTERIOR (station hull + ring + arrays…), INTERIOR (compartment linings and
 * equipment), SHIPS, DOORS (meshes under an `userData.animated` pivot: the airlock hatches).
 *
 * API — all coordinates in station-frame metres (= world: the station sits at the origin), or in the local frame
 * of `opts.frame` (an Object3D, e.g. `station.ring.group` for the rotating ring frame):
 *   resolveSphere(center, radius, outNormal?, opts?)  -> boolean   push the sphere out of the geometry (center moves)
 *   resolveCapsule(a, b, radius, outNormal?, opts?)   -> boolean   same for the capsule segment a-b (both move)
 *   sphereCast(from, to, radius, outHit?, opts?)      -> boolean   swept sphere: first contact on from -> to
 *   raycast(origin, dir, far, outHit?, opts?)         -> boolean   first hit along the ray
 *   distance(point, maxDistance, opts?)               -> number    distance to the nearest surface (or maxDistance)
 *   contacts / contactCount                                       contacts of the last resolve* call
 *   surfaceVelocity(body, worldPoint, out)                         motion of the touched surface (ring spin, ships)
 * outNormal: unit push direction (query frame). outHit: { t (0..1 along from->to / metres along the ray), point,
 * normal, body, distance }. A resolve* call does up to three push iterations (corners); callers move in substeps
 * of at most ~half the radius (or sweep with sphereCast first) so nothing tunnels through thin walls.
 */

export const COLLIDE = { EXTERIOR: 1, INTERIOR: 2, SHIPS: 4, DOORS: 8, ALL: 15 };

const CELL = 12;                 // chunk size (m, anchor frame)
// triangles smaller than this (m^2, ~1 x 1.5 cm) are fine detail (knobs, bezels, bolt heads, text): they cannot
// stop a 0.2-0.4 m body anyway, and dropping them keeps the queries cheap in dense compartments
const MIN_AREA = 1.5e-4;
const BUILD_BUDGET_MS = 3;       // background BVH builds per frame
const MAX_CONTACTS = 16;
const NON_SOLID = /glow|halo|beam|plume|flare|strobe|blink|exhaust|shadowProxy|tether|particle|detailMetal|detailPaint|wristMirror/i;
const INTERIOR_LAYER = 4;

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _L = new THREE.Matrix4();
const _Li = new THREE.Matrix4();
const _F = new THREE.Matrix4();
const _Fi = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _c = new THREE.Vector3();
const _pa = new THREE.Vector3();
const _pb = new THREE.Vector3();
const _la = new THREE.Vector3();
const _lb = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _n = new THREE.Vector3();
const _push = new THREE.Vector3();
const _bc = new THREE.Vector3();
const _ray = new THREE.Ray();
const _box = new THREE.Box3();
const _sph = new THREE.Sphere();
const _cp = { x: 0, y: 0, z: 0, sx: 0, sy: 0, sz: 0, s: 0 };
const _hitTmp = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };

export class CollisionWorld {
  constructor(ctx) {
    this.ctx = ctx;
    this.bodies = [];
    this.pending = [];          // shared sets without BVHs yet
    this.contacts = [];
    for (let i = 0; i < MAX_CONTACTS; i++) this.contacts.push({ normal: new THREE.Vector3(), depth: 0, body: null, point: new THREE.Vector3() });
    this.contactCount = 0;
    this.lastPush = new THREE.Vector3();
    this.stats = { bodies: 0, shared: 0, chunks: 0, built: 0, triangles: 0, builtTriangles: 0, dropped: 0, collectMs: 0, buildMs: 0 };
    this._q = { mask: COLLIDE.ALL, frame: null };
    this.ready = false;
  }

  // ============================================================================================ build
  /** Collect the collidable meshes of the scene (cheap; BVHs are built lazily). */
  build() {
    const t0 = performance.now();
    const ctx = this.ctx, st = ctx.station;
    const interior = st?.interior;
    const skip = new Set();
    // spacesuits on their mounts are soft and toggle with don / doff: not solid
    for (const z of interior?.zones || []) for (const s of z.suitObjects || []) skip.add(s.group);
    this._skip = skip;
    this._sigs = new Map();
    if (st) {
      const ringGroup = st.ring?.group || null;
      const ringMotion = ringGroup ? { type: 'ring', group: ringGroup, speed: st.ring.angularSpeed, omega: new THREE.Vector3(), pivot: new THREE.Vector3() } : null;
      this.ringMotion = ringMotion;
      st.updateMatrixWorld(true);
      const groups = new Map();
      this._collect(st, st, groups, (o) => o === ctx.camera);
      for (const [anchor, list] of groups) {
        const isInterior = list.interior;
        const door = list.door;
        const layer = door ? COLLIDE.DOORS : isInterior ? COLLIDE.INTERIOR : COLLIDE.EXTERIOR;
        const inRing = ringGroup && isDescendant(anchor, ringGroup);
        this._addBody(anchor, list, layer, inRing ? ringMotion : null, null);
      }
    }
    // ships: their mid-detail level (L1 + shared holders), in the frame of each pivot
    for (const ship of ctx.ships?.ships || []) this._addShip(ship);
    for (const ship of ctx.ships?.showcase || []) this._addShip(ship);
    this.stats.bodies = this.bodies.length;
    this.stats.shared = this._sigs.size;
    this.stats.collectMs = performance.now() - t0;
    this._sigs = null;
    this.ready = true;
    console.info(`[collision] ${this.stats.bodies} bodies, ${this.stats.shared} geometry sets, ${(this.stats.triangles / 1e6).toFixed(2)} M triangles collected in ${this.stats.collectMs.toFixed(0)} ms (BVHs built on demand)`);
  }

  _addShip(ship) {
    const rig = ship.rig;
    if (!rig?.holders) return;
    const groups = new Map();
    const seen = new Set();
    for (let l = 0; l < 3; l++) for (const h of rig.holders[l]) {
      if (seen.has(h)) continue;
      const lod = h.userData.lod;
      if (!(lod === -1 || l === 1)) continue;
      seen.add(h);
      const anchor = h.userData.parent || h.parent;
      if (!anchor) continue;
      // holder-relative chain (hidden levels may be detached from the scene graph)
      h.updateMatrix();
      h.traverse((o) => {
        if (!this._solid(o)) return;
        const rel = new THREE.Matrix4();
        for (let p = o; p && p !== anchor; p = p.parent || p.userData.parent) { p.updateMatrix(); rel.premultiply(p.matrix); if (p === h) break; }
        if (!groups.has(anchor)) groups.set(anchor, []);
        groups.get(anchor).push({ mesh: o, rel });
      });
    }
    const motion = { type: 'ship', ship, velocity: ship.velocity };
    for (const [anchor, list] of groups) this._addBody(anchor, list, COLLIDE.SHIPS, motion, ship.group);
  }

  /** Traverse root; group solid meshes by their parent (anchor). */
  _collect(root, top, groups, stop) {
    const skip = this._skip;
    const walk = (o, flags) => {
      if (stop(o) || skip.has(o) || o.userData?.noCollide) return;
      const f = { interior: flags.interior || o.layers.isEnabled(INTERIOR_LAYER) || /^zone:/.test(o.name), door: flags.door || !!o.userData?.animated };
      if (this._solid(o)) {
        const anchor = o.parent;
        if (!groups.has(anchor)) { const l = []; l.interior = false; l.door = false; groups.set(anchor, l); }
        const l = groups.get(anchor);
        o.updateMatrix();
        l.push({ mesh: o, rel: o.matrix.clone() });
        if (f.interior) l.interior = true;
        if (f.door) l.door = true;
      }
      for (const c of o.children) walk(c, f);
    };
    walk(root, { interior: false, door: false });
    void top;
  }

  _solid(o) {
    if (!o.isMesh || o.isSkinnedMesh || !o.geometry?.attributes?.position) return false;
    if (o.userData?.noCollide || o.userData?.detail) return false;
    if (o.layers.mask === (1 << 2)) return false;                 // first-person only
    if (NON_SOLID.test(o.name || '')) return false;
    const mats = [].concat(o.material || []);
    if (!mats.length) return false;
    return mats.some((m) => this._solidMaterial(m));
  }

  _solidMaterial(m) {
    if (!m || m.visible === false) return false;
    const name = m.name || '';
    if (NON_SOLID.test(name)) return false;
    if (m.blending === THREE.AdditiveBlending) return false;
    if (/glass/i.test(name)) return true;
    if (m.transparent && m.depthWrite === false) return false;
    if (m.colorWrite === false) return false;
    return true;
  }

  /** One collision body per anchor; content shared with other anchors of the same signature. */
  _addBody(anchor, list, layer, motion, visibleRoot) {
    if (!list.length) return;
    // base frame = the first mesh's frame (so rotated copies of the same content share their BVHs)
    const base = list[0].rel.clone();
    const baseInv = base.clone().invert();
    let sig = `${layer}`;
    for (const e of list) {
      e.local = new THREE.Matrix4().multiplyMatrices(baseInv, e.rel);
      const g = e.mesh.geometry;
      sig += `|${g.uuid}:${e.mesh.isInstancedMesh ? e.mesh.count + ':' + e.mesh.instanceMatrix.version : ''}:${e.local.elements.map((x) => Math.round(x * 1000)).join(',')}`;
      if (Array.isArray(e.mesh.material)) sig += ':' + e.mesh.material.map((m) => (this._solidMaterial(m) ? 1 : 0)).join('');
    }
    let shared = this._sigs.get(sig);
    if (!shared) {
      // bounding sphere (base frame) from the geometry bounds, for the broad phase before the BVHs exist
      const box = new THREE.Box3();
      let tris = 0;
      for (const e of list) {
        const g = e.mesh.geometry;
        if (!g.boundingBox) g.computeBoundingBox();
        const n = (g.index ? g.index.count : g.attributes.position.count) / 3;
        if (e.mesh.isInstancedMesh) {
          for (let i = 0; i < e.mesh.count; i++) { e.mesh.getMatrixAt(i, _m); _m.premultiply(e.local); box.union(_box.copy(g.boundingBox).applyMatrix4(_m)); }
          tris += n * e.mesh.count;
        } else { box.union(_box.copy(g.boundingBox).applyMatrix4(e.local)); tris += n; }
      }
      if (box.isEmpty()) return;
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      shared = { list, sphere, chunks: null, tris, users: 0 };
      this._sigs.set(sig, shared);
      this.pending.push(shared);
      this.stats.triangles += tris;
    }
    shared.users++;
    const sc = new THREE.Vector3().setFromMatrixScale(base);
    this.bodies.push({
      anchor, base, shared, layer, motion, visibleRoot,
      center: shared.sphere.center.clone().applyMatrix4(base),          // anchor frame
      radius: shared.sphere.radius * Math.max(sc.x, sc.y, sc.z),
      name: anchor.name || anchor.type,
    });
  }

  /** Extract the triangles of a shared set into spatial chunks (base frame). */
  _prepare(shared) {
    const cells = new Map();
    const cellOf = (x, y, z) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)},${Math.floor(z / CELL)}`;
    const add = (pos, idx, i0, i1, M) => {
      const e = M.elements;
      const tx = (i) => pos.getX(i), ty = (i) => pos.getY(i), tz = (i) => pos.getZ(i);
      for (let t = i0; t < i1; t += 3) {
        const a = idx ? idx.getX(t) : t, b = idx ? idx.getX(t + 1) : t + 1, c = idx ? idx.getX(t + 2) : t + 2;
        const ax = tx(a), ay = ty(a), az = tz(a), bx = tx(b), by = ty(b), bz = tz(b), cx = tx(c), cy = ty(c), cz = tz(c);
        const A0 = e[0] * ax + e[4] * ay + e[8] * az + e[12], A1 = e[1] * ax + e[5] * ay + e[9] * az + e[13], A2 = e[2] * ax + e[6] * ay + e[10] * az + e[14];
        const B0 = e[0] * bx + e[4] * by + e[8] * bz + e[12], B1 = e[1] * bx + e[5] * by + e[9] * bz + e[13], B2 = e[2] * bx + e[6] * by + e[10] * bz + e[14];
        const C0 = e[0] * cx + e[4] * cy + e[8] * cz + e[12], C1 = e[1] * cx + e[5] * cy + e[9] * cz + e[13], C2 = e[2] * cx + e[6] * cy + e[10] * cz + e[14];
        // degenerate triangles carry no surface
        const ux = B0 - A0, uy = B1 - A1, uz = B2 - A2, vx = C0 - A0, vy = C1 - A1, vz = C2 - A2;
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        if (nx * nx + ny * ny + nz * nz < 4 * MIN_AREA * MIN_AREA) { this.stats.dropped++; continue; }
        const k = cellOf((A0 + B0 + C0) / 3, (A1 + B1 + C1) / 3, (A2 + B2 + C2) / 3);
        let arr = cells.get(k);
        if (!arr) { arr = []; cells.set(k, arr); }
        arr.push(A0, A1, A2, B0, B1, B2, C0, C1, C2);
      }
    };
    for (const e of shared.list) {
      const o = e.mesh, g = o.geometry, pos = g.attributes.position, idx = g.index;
      const count = idx ? idx.count : pos.count;
      const ranges = [];
      if (Array.isArray(o.material) && g.groups.length) {
        for (const gr of g.groups) if (this._solidMaterial(o.material[gr.materialIndex])) ranges.push([gr.start, Math.min(count, gr.start + gr.count)]);
      } else ranges.push([g.drawRange.start, Math.min(count, g.drawRange.start + g.drawRange.count)]);
      if (o.isInstancedMesh) {
        for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, _m2); _m2.premultiply(e.local); for (const [s0, s1] of ranges) add(pos, idx, s0 - (s0 % 3), s1, _m2); }
      } else for (const [s0, s1] of ranges) add(pos, idx, s0 - (s0 % 3), s1, e.local);
    }
    shared.chunks = [];
    for (const arr of cells.values()) {
      const positions = new Float32Array(arr);
      const sphere = new THREE.Sphere();
      const bb = new THREE.Box3();
      for (let i = 0; i < positions.length; i += 3) bb.expandByPoint(_v.set(positions[i], positions[i + 1], positions[i + 2]));
      bb.getBoundingSphere(sphere);
      shared.chunks.push({ positions, sphere, box: bb, bvh: null, tris: positions.length / 9 });
      this.stats.chunks++;
    }
    shared.list = null;    // drop the mesh references
  }

  _buildChunk(ch) {
    const t0 = performance.now();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(ch.positions, 3));
    ch.bvh = new MeshBVH(g, { targetLeafSize: 8, setBoundingBox: false, verbose: false });
    ch.positions = null;
    this.stats.built++;
    this.stats.builtTriangles += ch.tris;
    this.stats.buildMs += performance.now() - t0;
    return ch.bvh;
  }

  /** Make sure every chunk of the shared set has its BVH. */
  _ensure(shared) {
    if (!shared.chunks) this._prepare(shared);
    if (shared.done) return;
    for (const ch of shared.chunks) if (!ch.bvh) this._buildChunk(ch);
    shared.done = true;
    const i = this.pending.indexOf(shared);
    if (i >= 0) this.pending.splice(i, 1);
  }

  /** Background BVH builds (a few ms per frame), the sets nearest to the camera first. */
  update() {
    if (!this.ready || !this.pending.length) return;
    const t0 = performance.now();
    const cam = this.ctx.camera?.position;
    if (cam && (this._sortTimer = (this._sortTimer || 0) - 1) <= 0) {
      this._sortTimer = 30;
      const dist = new Map();
      for (const b of this.bodies) {
        if (b.shared.done) continue;
        const d = _v.copy(b.center).applyMatrix4(b.anchor.matrixWorld).distanceTo(cam) - b.radius;
        if (!dist.has(b.shared) || d < dist.get(b.shared)) dist.set(b.shared, d);
      }
      this.pending.sort((a, b) => (dist.get(a) ?? 1e9) - (dist.get(b) ?? 1e9));
    }
    while (this.pending.length && performance.now() - t0 < BUILD_BUDGET_MS) {
      const s = this.pending[0];
      if (!s.chunks) { this._prepare(s); continue; }
      const ch = s.chunks.find((c) => !c.bvh);
      if (ch) this._buildChunk(ch);
      else { s.done = true; this.pending.shift(); }
    }
  }

  /** Build everything now (tests / measurements). */
  buildAll() { while (this.pending.length) this._ensure(this.pending[0]); }

  // ============================================================================================ helpers
  _opts(opts) {
    const q = this._q;
    q.mask = opts?.mask ?? COLLIDE.ALL;
    // default: the station frame (ctx.stationRoot: identity unless the render origin floats away)
    q.frame = opts?.frame || this.ctx.stationRoot || null;
    q.ignore = opts?.ignore || null;
    if (q.frame) { _F.copy(q.frame.matrixWorld); _Fi.copy(_F).invert(); }
    return q;
  }

  /**
   * Candidate bodies whose bounding sphere comes within `reach` of the world sphere (c, r). Calls fn(body)
   * with _L / _Li set to the body's world-from-local transform and its inverse.
   */
  _forBodies(q, c, r, fn) {
    const list = this.bodies;
    for (let i = 0, n = list.length; i < n; i++) {
      const b = list[i];
      if (!(b.layer & q.mask)) continue;
      if (q.ignore && q.ignore === b.visibleRoot) continue;
      if (b.visibleRoot && !b.visibleRoot.visible) continue;
      const door = b.layer === COLLIDE.DOORS;
      let M = b.anchor.matrixWorld.elements;
      const x = b.center.x, y = b.center.y, z = b.center.z;
      let wx = M[0] * x + M[4] * y + M[8] * z + M[12] - c.x, wy = M[1] * x + M[5] * y + M[9] * z + M[13] - c.y, wz = M[2] * x + M[6] * y + M[10] * z + M[14] - c.z;
      let s = Math.sqrt(M[0] * M[0] + M[1] * M[1] + M[2] * M[2]);
      let rr = b.radius * s + r + (door ? 2 : 0);
      if (wx * wx + wy * wy + wz * wz > rr * rr) continue;
      if (door) {
        // hatches move on events, also between rendered frames (sequences stepped without rendering): fresh matrix
        b.anchor.updateWorldMatrix(true, false);
        M = b.anchor.matrixWorld.elements;
        wx = M[0] * x + M[4] * y + M[8] * z + M[12] - c.x; wy = M[1] * x + M[5] * y + M[9] * z + M[13] - c.y; wz = M[2] * x + M[6] * y + M[10] * z + M[14] - c.z;
        s = Math.sqrt(M[0] * M[0] + M[1] * M[1] + M[2] * M[2]);
        rr = b.radius * s + r;
        if (wx * wx + wy * wy + wz * wz > rr * rr) continue;
      }
      if (!b.shared.chunks) this._prepare(b.shared);
      _L.multiplyMatrices(b.anchor.matrixWorld, b.base);
      _Li.copy(_L).invert();
      b._scale = s * Math.cbrt(Math.abs(b.base.determinant()));
      fn(b);
    }
  }

  _toWorld(p, out) { out.copy(p); if (this._q.frame) out.applyMatrix4(_F); return out; }
  _fromWorld(p, out) { out.copy(p); if (this._q.frame) out.applyMatrix4(_Fi); return out; }
  _dirFromWorld(d, out) { out.copy(d); if (this._q.frame) out.transformDirection(_Fi); return out; }

  _addContact(nWorld, depth, body, pWorld) {
    if (this.contactCount >= MAX_CONTACTS) return;
    const k = this.contacts[this.contactCount++];
    this._dirFromWorld(nWorld, k.normal);
    k.depth = depth; k.body = body;
    this._fromWorld(pWorld, k.point);
  }

  // ============================================================================================ queries
  /**
   * Push the sphere out of all geometry it penetrates. center is modified (query frame). Returns true on contact.
   * outNormal (optional): unit direction of the total push. Contacts are in this.contacts[0..contactCount).
   */
  resolveSphere(center, radius, outNormal = null, opts = null) {
    return this.resolveCapsule(center, null, radius, outNormal, opts);
  }

  /** Capsule a-b (b may be null: sphere at a). Both points are moved by the same push. */
  resolveCapsule(a, b, radius, outNormal = null, opts = null) {
    const iterations = opts?.iterations ?? 3;
    const q = this._opts(opts);
    this.contactCount = 0;
    this.lastPush.set(0, 0, 0);
    if (!this.ready) return false;
    const wa = this._toWorld(a, _pa), wb = b ? this._toWorld(b, _pb) : null;
    const total = _push.set(0, 0, 0);
    let any = false;
    for (let iter = 0; iter < iterations; iter++) {
      let moved = false;
      _bc.copy(wa); if (wb) _bc.add(wb).multiplyScalar(0.5);
      const reach = radius + (wb ? wa.distanceTo(wb) * 0.5 : 0);
      this._forBodies(q, _bc, reach, (body) => {
        const rl = radius / body._scale;
        _la.copy(wa).applyMatrix4(_Li);
        if (wb) _lb.copy(wb).applyMatrix4(_Li);
        const la = _la, lb = wb ? _lb : null;
        for (const ch of body.shared.chunks) {
          // chunk sphere vs the local query
          // chunk bounds vs the local query box
          const B = ch.box;
          const minx = (lb ? Math.min(la.x, lb.x) : la.x) - rl, maxx = (lb ? Math.max(la.x, lb.x) : la.x) + rl;
          if (maxx < B.min.x || minx > B.max.x) continue;
          const miny = (lb ? Math.min(la.y, lb.y) : la.y) - rl, maxy = (lb ? Math.max(la.y, lb.y) : la.y) + rl;
          if (maxy < B.min.y || miny > B.max.y) continue;
          const minz = (lb ? Math.min(la.z, lb.z) : la.z) - rl, maxz = (lb ? Math.max(la.z, lb.z) : la.z) + rl;
          if (maxz < B.min.z || minz > B.max.z) continue;
          if (!ch.bvh) this._buildChunk(ch);
          const hit = this._pushLocal(ch.bvh, la, lb, rl, body, true);
          if (hit) moved = true;
        }
        if (moved) {
          // back to world (rigid + uniform scale)
          _v.copy(la).applyMatrix4(_L);
          _v2.subVectors(_v, wa);
          if (_v2.lengthSq() > 0) { total.add(_v2); wa.copy(_v); if (wb) wb.copy(lb).applyMatrix4(_L); }
        }
      });
      if (!moved) break;
      any = true;
    }
    if (!any) return false;
    this._fromWorld(wa, a);
    if (b) this._fromWorld(wb, b);
    this._dirFromWorld(total, this.lastPush);
    if (q.frame) this.lastPush.multiplyScalar(total.length() / Math.max(1e-9, this.lastPush.length()));
    if (outNormal) { outNormal.copy(this.lastPush); const l = outNormal.length(); if (l > 1e-9) outNormal.multiplyScalar(1 / l); else outNormal.set(0, 1, 0); }
    return true;
  }

  /** Push the local sphere / capsule (la, lb) out of the triangles of one BVH. Returns true if moved. */
  _pushLocal(bvh, la, lb, r, body, record) {
    // (callbacks are created once: no closures per call)
    const P = this._pl || (this._pl = this._makePushCallbacks());
    P.la = la; P.lb = lb; P.r = r; P.body = body; P.record = record; P.moved = false;
    P.setBox();
    bvh.shapecast(P.cb);
    return P.moved;
  }

  _makePushCallbacks() {
    const self = this, box = new THREE.Box3();
    const P = { la: null, lb: null, r: 0, body: null, record: false, moved: false };
    P.setBox = () => {
      const la = P.la, lb = P.lb, r = P.r;
      box.min.copy(la); box.max.copy(la);
      if (lb) { box.min.min(lb); box.max.max(lb); }
      box.min.addScalar(-r); box.max.addScalar(r);
    };
    P.cb = {
      intersectsBounds: (bb) => bb.intersectsBox(box),
      intersectsTriangle: (tri) => {
        const la = P.la, lb = P.lb, r = P.r;
        // cheap reject: the whole shape farther than r from the triangle's plane on one side
        const A = tri.a, B = tri.b, C = tri.c;
        const ux = B.x - A.x, uy = B.y - A.y, uz = B.z - A.z, vx = C.x - A.x, vy = C.y - A.y, vz = C.z - A.z;
        let px = uy * vz - uz * vy, py = uz * vx - ux * vz, pz = ux * vy - uy * vx;
        const pl = Math.sqrt(px * px + py * py + pz * pz);
        if (pl < 1e-12) return false;
        px /= pl; py /= pl; pz /= pl;
        const da = (la.x - A.x) * px + (la.y - A.y) * py + (la.z - A.z) * pz;
        const db = lb ? (lb.x - A.x) * px + (lb.y - A.y) * py + (lb.z - A.z) * pz : da;
        if ((da >= r && db >= r) || (da <= -r && db <= -r)) return false;
        let d;
        if (lb) d = segTriClosest(la, lb, A, B, C, _cp);
        else { closestPtTri(la.x, la.y, la.z, A, B, C, _cp); _cp.sx = la.x; _cp.sy = la.y; _cp.sz = la.z; d = Math.hypot(_cp.sx - _cp.x, _cp.sy - _cp.y, _cp.sz - _cp.z); }
        if (d >= r) return false;
        let nx, ny, nz, depth;
        if (d > 1e-7) { nx = (_cp.sx - _cp.x) / d; ny = (_cp.sy - _cp.y) / d; nz = (_cp.sz - _cp.z) / d; depth = r - d; }
        else {
          // the shape's axis touches / pierces the triangle: push along the face normal toward the shape's centre side
          const side = (da + db) >= 0 ? 1 : -1;
          nx = px * side; ny = py * side; nz = pz * side;
          depth = r - Math.min(da * side, db * side, 0);
        }
        la.x += nx * depth; la.y += ny * depth; la.z += nz * depth;
        if (lb) { lb.x += nx * depth; lb.y += ny * depth; lb.z += nz * depth; }
        P.moved = true;
        P.setBox();
        if (P.record) {
          _n.set(nx, ny, nz).transformDirection(_L);
          _v.set(_cp.x, _cp.y, _cp.z).applyMatrix4(_L);
          self._addContact(_n, depth * P.body._scale, P.body, _v);
        }
        return false;
      },
    };
    return P;
  }


  /**
   * Swept sphere from -> to (query frame). On a hit fills outHit { t (0..1), point (contact), normal, body,
   * distance (metres travelled) } and returns true. A sphere that already overlaps something it moves into hits
   * at t = 0.
   */
  sphereCast(from, to, radius, outHit = null, opts = null) {
    const q = this._opts(opts);
    if (!this.ready) return false;
    const wf = this._toWorld(from, _pa), wt = this._toWorld(to, _pb);
    const len = wf.distanceTo(wt);
    let best = 1, found = null;
    const bestN = new THREE.Vector3(), bestP = new THREE.Vector3();   // (rare call: allocation is fine)
    _c.copy(wf).add(wt).multiplyScalar(0.5);
    this._forBodies(q, _c, radius + len * 0.5, (body) => {
      const rl = radius / body._scale;
      const lf = _la.copy(wf).applyMatrix4(_Li), lt = _lb.copy(wt).applyMatrix4(_Li);
      const d = _dir.subVectors(lt, lf);
      for (const ch of body.shared.chunks) {
        if (!segSphere(lf, d, ch.sphere.center, ch.sphere.radius + rl)) continue;
        if (!ch.bvh) this._buildChunk(ch);
        let localBest = best;
        ch.bvh.shapecast({
          intersectsBounds: (bb) => segBox(lf, d, bb, rl, localBest),
          intersectsTriangle: (tri) => {
            const t = sweptSphereTri(lf, d, rl, tri.a, tri.b, tri.c, localBest, _cp);
            if (t >= 0 && t < localBest) {
              localBest = t;
              _n.set(_cp.sx, _cp.sy, _cp.sz);                    // contact normal (local)
              _v2.set(_cp.x, _cp.y, _cp.z);                      // contact point (local)
              bestN.copy(_n).transformDirection(_L);
              bestP.copy(_v2).applyMatrix4(_L);
            }
            return false;
          },
        });
        if (localBest < best) { best = localBest; found = body; }
      }
    });
    if (!found) return false;
    if (outHit) {
      outHit.t = best;
      outHit.distance = best * len;
      outHit.body = found;
      outHit.point = outHit.point || new THREE.Vector3();
      outHit.normal = outHit.normal || new THREE.Vector3();
      this._fromWorld(bestP, outHit.point);
      this._dirFromWorld(bestN, outHit.normal);
    }
    return true;
  }

  /** First hit along origin + dir * s, s in [0, far] (query frame). outHit { t (metres), point, normal, body }. */
  raycast(origin, dir, far, outHit = null, opts = null) {
    const q = this._opts(opts);
    if (!this.ready) return false;
    const wo = this._toWorld(origin, _pa);
    const wd = _dir.copy(dir); if (q.frame) wd.transformDirection(_F); else wd.normalize();
    let best = far, found = null;
    const bestN = new THREE.Vector3(), bestP = new THREE.Vector3();
    _c.copy(wo).addScaledVector(wd, far * 0.5);
    this._forBodies(q, _c, far * 0.5, (body) => {
      _ray.origin.copy(wo).applyMatrix4(_Li);
      _ray.direction.copy(wd).transformDirection(_Li);
      const s = body._scale;
      for (const ch of body.shared.chunks) {
        if (!segSphere(_ray.origin, _v.copy(_ray.direction).multiplyScalar(best / s), ch.sphere.center, ch.sphere.radius)) continue;
        if (!ch.bvh) this._buildChunk(ch);
        const h = ch.bvh.raycastFirst(_ray, THREE.DoubleSide, 0, best / s);
        if (h && h.distance * s < best) {
          best = h.distance * s; found = body;
          bestP.copy(h.point).applyMatrix4(_L);
          if (h.face) bestN.copy(h.face.normal).transformDirection(_L); else bestN.copy(wd).negate();
          if (bestN.dot(wd) > 0) bestN.negate();
        }
      }
    });
    if (!found) return false;
    if (outHit) {
      outHit.t = best; outHit.distance = best; outHit.body = found;
      outHit.point = outHit.point || new THREE.Vector3();
      outHit.normal = outHit.normal || new THREE.Vector3();
      this._fromWorld(bestP, outHit.point);
      this._dirFromWorld(bestN, outHit.normal);
    }
    return true;
  }

  /** Distance from a point (query frame) to the nearest surface, at most maxDistance. */
  distance(point, maxDistance = 10, opts = null) {
    const q = this._opts(opts);
    if (!this.ready) return maxDistance;
    const wp = this._toWorld(point, _pa);
    let best = maxDistance;
    this._forBodies(q, wp, maxDistance, (body) => {
      const lp = _la.copy(wp).applyMatrix4(_Li);
      const s = body._scale;
      for (const ch of body.shared.chunks) {
        if (lp.distanceTo(ch.sphere.center) - ch.sphere.radius > best / s) continue;
        if (!ch.bvh) this._buildChunk(ch);
        const h = ch.bvh.closestPointToPoint(lp, _hitTmp, 0, best / s);
        if (h && h.distance * s < best) best = h.distance * s;
      }
    });
    return best;
  }

  /**
   * Nearest surface point within maxDistance of `point` (query frame). Fills out { point, normal (from the
   * surface toward the query point), distance, body } and returns true when something is that close.
   */
  closest(point, maxDistance, out, opts = null) {
    const q = this._opts(opts);
    if (!this.ready) return false;
    const wp = this._toWorld(point, _pa);
    let best = maxDistance, found = null;
    const bp = _pb;
    this._forBodies(q, wp, maxDistance, (body) => {
      const lp = _la.copy(wp).applyMatrix4(_Li);
      const s = body._scale;
      for (const ch of body.shared.chunks) {
        if (lp.distanceTo(ch.sphere.center) - ch.sphere.radius > best / s) continue;
        if (!ch.bvh) this._buildChunk(ch);
        const h = ch.bvh.closestPointToPoint(lp, _hitTmp, 0, best / s);
        if (h && h.distance * s < best) { best = h.distance * s; found = body; bp.copy(h.point).applyMatrix4(_L); }
      }
    });
    if (!found) return false;
    out.point = out.point || new THREE.Vector3();
    out.normal = out.normal || new THREE.Vector3();
    out.distance = best; out.body = found;
    _v.subVectors(wp, bp);
    if (_v.lengthSq() < 1e-12) _v.set(0, 1, 0);
    this._fromWorld(bp, out.point);
    this._dirFromWorld(_v.normalize(), out.normal);
    return true;
  }

  /** Velocity of the surface of `body` at world point p (ring spin, ship motion), into out. */
  surfaceVelocity(body, p, out) {
    out.set(0, 0, 0);
    const m = body?.motion;
    if (!m) return out;
    if (m.type === 'ship') { if (m.velocity) out.copy(m.velocity); return out; }
    if (m.type === 'ring') {
      const g = m.group;
      m.pivot.setFromMatrixPosition(g.matrixWorld);
      m.omega.set(1, 0, 0);
      if (g.parent) m.omega.transformDirection(g.parent.matrixWorld);
      m.omega.multiplyScalar(m.speed);
      _v.subVectors(p, m.pivot);
      out.crossVectors(m.omega, _v);
    }
    return out;
  }

  dispose() {
    for (const b of this.bodies) for (const ch of b.shared.chunks || []) ch.bvh?.geometry?.dispose();
    this.bodies.length = 0;
  }
}

function isDescendant(o, root) { for (let p = o; p; p = p.parent) if (p === root) return true; return false; }

// ============================================================================================ geometry kernels
// (scalar math, no allocations)

function triNormal(a, b, c, out) {
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z, vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
  out.set(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  const l = out.length();
  if (l > 0) out.multiplyScalar(1 / l); else out.set(0, 1, 0);
  return out;
}

/** Closest point on triangle abc to p (Ericson 5.1.5) into out.{x,y,z}. */
function closestPtTri(px, py, pz, a, b, c, out) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const acx = c.x - a.x, acy = c.y - a.y, acz = c.z - a.z;
  const apx = px - a.x, apy = py - a.y, apz = pz - a.z;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) { out.x = a.x; out.y = a.y; out.z = a.z; return; }
  const bpx = px - b.x, bpy = py - b.y, bpz = pz - b.z;
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) { out.x = b.x; out.y = b.y; out.z = b.z; return; }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); out.x = a.x + v * abx; out.y = a.y + v * aby; out.z = a.z + v * abz; return; }
  const cpx = px - c.x, cpy = py - c.y, cpz = pz - c.z;
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) { out.x = c.x; out.y = c.y; out.z = c.z; return; }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); out.x = a.x + w * acx; out.y = a.y + w * acy; out.z = a.z + w * acz; return; }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    out.x = b.x + w * (c.x - b.x); out.y = b.y + w * (c.y - b.y); out.z = b.z + w * (c.z - b.z); return;
  }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  out.x = a.x + abx * v + acx * w; out.y = a.y + aby * v + acy * w; out.z = a.z + abz * v + acz * w;
}

const _ss = { s: 0, t: 0 };
/** Closest points of segments p1q1 and p2q2 (Ericson 5.1.9); writes s, t into _ss, returns the squared distance. */
function segSeg(p1x, p1y, p1z, q1x, q1y, q1z, p2x, p2y, p2z, q2x, q2y, q2z) {
  const d1x = q1x - p1x, d1y = q1y - p1y, d1z = q1z - p1z, d2x = q2x - p2x, d2y = q2y - p2y, d2z = q2z - p2z;
  const rx = p1x - p2x, ry = p1y - p2y, rz = p1z - p2z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z, e = d2x * d2x + d2y * d2y + d2z * d2z, f = d2x * rx + d2y * ry + d2z * rz;
  let s, t;
  if (a <= 1e-12 && e <= 1e-12) { s = 0; t = 0; }
  else if (a <= 1e-12) { s = 0; t = Math.min(1, Math.max(0, f / e)); }
  else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= 1e-12) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
    else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z, den = a * e - b * b;
      s = den > 1e-12 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
      else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
    }
  }
  _ss.s = s; _ss.t = t;
  const dx = p1x + d1x * s - (p2x + d2x * t), dy = p1y + d1y * s - (p2y + d2y * t), dz = p1z + d1z * s - (p2z + d2z * t);
  return dx * dx + dy * dy + dz * dz;
}

const _tp = { x: 0, y: 0, z: 0 };
/**
 * Closest points between segment pq and triangle abc. out.{x,y,z} = point on the triangle, out.{sx,sy,sz} = point
 * on the segment, out.s = segment parameter. Returns the distance (0 when the segment pierces the triangle).
 */
function segTriClosest(p, q, a, b, c, out) {
  // piercing (Moller-Trumbore on the segment)
  const ex = q.x - p.x, ey = q.y - p.y, ez = q.z - p.z;
  const e1x = b.x - a.x, e1y = b.y - a.y, e1z = b.z - a.z, e2x = c.x - a.x, e2y = c.y - a.y, e2z = c.z - a.z;
  const hx = ey * e2z - ez * e2y, hy = ez * e2x - ex * e2z, hz = ex * e2y - ey * e2x;
  const det = e1x * hx + e1y * hy + e1z * hz;
  if (Math.abs(det) > 1e-12) {
    const inv = 1 / det, sx = p.x - a.x, sy = p.y - a.y, sz = p.z - a.z;
    const u = (sx * hx + sy * hy + sz * hz) * inv;
    if (u >= 0 && u <= 1) {
      const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
      const v = (ex * qx + ey * qy + ez * qz) * inv;
      if (v >= 0 && u + v <= 1) {
        const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (t >= 0 && t <= 1) {
          out.x = out.sx = p.x + ex * t; out.y = out.sy = p.y + ey * t; out.z = out.sz = p.z + ez * t; out.s = t;
          return 0;
        }
      }
    }
  }
  let best = Infinity;
  // segment end points vs the triangle
  for (let k = 0; k < 2; k++) {
    const P = k ? q : p;
    closestPtTri(P.x, P.y, P.z, a, b, c, _tp);
    const d = (P.x - _tp.x) ** 2 + (P.y - _tp.y) ** 2 + (P.z - _tp.z) ** 2;
    if (d < best) { best = d; out.x = _tp.x; out.y = _tp.y; out.z = _tp.z; out.sx = P.x; out.sy = P.y; out.sz = P.z; out.s = k; }
  }
  // segment vs the three edges
  for (let k = 0; k < 3; k++) {
    const A = k === 0 ? a : k === 1 ? b : c, B = k === 0 ? b : k === 1 ? c : a;
    const d = segSeg(p.x, p.y, p.z, q.x, q.y, q.z, A.x, A.y, A.z, B.x, B.y, B.z);
    if (d < best) {
      best = d;
      const s = _ss.s, t = _ss.t;
      out.sx = p.x + ex * s; out.sy = p.y + ey * s; out.sz = p.z + ez * s; out.s = s;
      out.x = A.x + (B.x - A.x) * t; out.y = A.y + (B.y - A.y) * t; out.z = A.z + (B.z - A.z) * t;
    }
  }
  return Math.sqrt(best);
}

/** Does the segment p + d*[0,1] come within r of the point c? */
function segSphere(p, d, c, r) {
  const dd = d.x * d.x + d.y * d.y + d.z * d.z;
  let t = dd > 1e-12 ? ((c.x - p.x) * d.x + (c.y - p.y) * d.y + (c.z - p.z) * d.z) / dd : 0;
  t = Math.min(1, Math.max(0, t));
  const x = p.x + d.x * t - c.x, y = p.y + d.y * t - c.y, z = p.z + d.z * t - c.z;
  return x * x + y * y + z * z <= r * r;
}

/** Slab test: does p + d*t, t in [0, tmax], hit the box expanded by r? */
function segBox(p, d, bb, r, tmax) {
  let t0 = 0, t1 = tmax;
  for (let k = 0; k < 3; k++) {
    const o = k === 0 ? p.x : k === 1 ? p.y : p.z, v = k === 0 ? d.x : k === 1 ? d.y : d.z;
    const lo = (k === 0 ? bb.min.x : k === 1 ? bb.min.y : bb.min.z) - r, hi = (k === 0 ? bb.max.x : k === 1 ? bb.max.y : bb.max.z) + r;
    if (Math.abs(v) < 1e-12) { if (o < lo || o > hi) return false; continue; }
    let ta = (lo - o) / v, tb = (hi - o) / v;
    if (ta > tb) { const s = ta; ta = tb; tb = s; }
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t0 > t1) return false;
  }
  return true;
}

/** Smallest root of a t^2 + b t + c = 0 in [0, tmax], or -1. */
function lowestRoot(a, b, c, tmax) {
  if (Math.abs(a) < 1e-12) { if (Math.abs(b) < 1e-12) return -1; const t = -c / b; return t >= 0 && t <= tmax ? t : -1; }
  const det = b * b - 4 * a * c;
  if (det < 0) return -1;
  const sq = Math.sqrt(det);
  let r1 = (-b - sq) / (2 * a), r2 = (-b + sq) / (2 * a);
  if (r1 > r2) { const s = r1; r1 = r2; r2 = s; }
  if (r1 >= 0 && r1 <= tmax) return r1;
  if (r2 >= 0 && r2 <= tmax) return r2;
  return -1;
}

const _pt = { x: 0, y: 0, z: 0 };
/**
 * Swept sphere (centre p, displacement d over t in [0,1], radius r) vs triangle abc. Returns the first contact
 * t <= tmax or -1; out.{x,y,z} = contact point, out.{sx,sy,sz} = contact normal (toward the sphere).
 */
function sweptSphereTri(p, d, r, a, b, c, tmax, out) {
  // plane (normal toward the start position)
  let nx, ny, nz;
  {
    const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z, vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
    nx = uy * vz - uz * vy; ny = uz * vx - ux * vz; nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-12) return -1;
    nx /= l; ny /= l; nz /= l;
  }
  let dist = (p.x - a.x) * nx + (p.y - a.y) * ny + (p.z - a.z) * nz;
  if (dist < 0) { nx = -nx; ny = -ny; nz = -nz; dist = -dist; }
  const vn = d.x * nx + d.y * ny + d.z * nz;
  if (dist >= r) {
    if (vn >= 0) return -1;                                   // moving away from / parallel to the plane
    const t0 = (dist - r) / -vn;
    if (t0 > tmax) return -1;
    // contact point on the plane inside the triangle -> face hit
    const cx = p.x + d.x * t0 - nx * r, cy = p.y + d.y * t0 - ny * r, cz = p.z + d.z * t0 - nz * r;
    closestPtTri(cx, cy, cz, a, b, c, _pt);
    if ((cx - _pt.x) ** 2 + (cy - _pt.y) ** 2 + (cz - _pt.z) ** 2 < 1e-10) {
      out.x = cx; out.y = cy; out.z = cz; out.sx = nx; out.sy = ny; out.sz = nz;
      return t0;
    }
  } else {
    // already within r of the plane: overlapping now?
    closestPtTri(p.x, p.y, p.z, a, b, c, _pt);
    const ox = p.x - _pt.x, oy = p.y - _pt.y, oz = p.z - _pt.z, od = Math.hypot(ox, oy, oz);
    if (od < r) {
      // embedded: a hit at t = 0 only when moving further in
      const mx = od > 1e-9 ? ox / od : nx, my = od > 1e-9 ? oy / od : ny, mz = od > 1e-9 ? oz / od : nz;
      if (d.x * mx + d.y * my + d.z * mz >= 0) return -1;
      out.x = _pt.x; out.y = _pt.y; out.z = _pt.z; out.sx = mx; out.sy = my; out.sz = mz;
      return 0;
    }
    if (vn >= 0 && dist > 0) {
      // moving away from the plane: no later contact with its interior, but edges / vertices may still come closer
    }
  }
  // vertices and edges
  let best = tmax, hit = false;
  const vv = d.x * d.x + d.y * d.y + d.z * d.z;
  if (vv < 1e-14) return -1;
  for (let k = 0; k < 3; k++) {
    const P = k === 0 ? a : k === 1 ? b : c;
    const bx = p.x - P.x, by = p.y - P.y, bz = p.z - P.z;
    const t = lowestRoot(vv, 2 * (d.x * bx + d.y * by + d.z * bz), bx * bx + by * by + bz * bz - r * r, best);
    if (t >= 0 && t < best) { best = t; hit = true; out.x = P.x; out.y = P.y; out.z = P.z; }
  }
  for (let k = 0; k < 3; k++) {
    const A = k === 0 ? a : k === 1 ? b : c, B = k === 0 ? b : k === 1 ? c : a;
    const ex = B.x - A.x, ey = B.y - A.y, ez = B.z - A.z;
    const tx = A.x - p.x, ty = A.y - p.y, tz = A.z - p.z;            // base to vertex
    const ee = ex * ex + ey * ey + ez * ez, ev = ex * d.x + ey * d.y + ez * d.z, et = ex * tx + ey * ty + ez * tz;
    const qa = ee * -vv + ev * ev, qb = ee * (2 * (d.x * tx + d.y * ty + d.z * tz)) - 2 * ev * et, qc = ee * (r * r - (tx * tx + ty * ty + tz * tz)) + et * et;
    const t = lowestRoot(qa, qb, qc, best);
    if (t >= 0 && t < best) {
      const f = (ev * t - et) / ee;
      if (f >= 0 && f <= 1) { best = t; hit = true; out.x = A.x + ex * f; out.y = A.y + ey * f; out.z = A.z + ez * f; }
    }
  }
  if (!hit) return -1;
  // normal: from the contact point to the sphere centre at the contact time
  const cx = p.x + d.x * best - out.x, cy = p.y + d.y * best - out.y, cz = p.z + d.z * best - out.z, cl = Math.hypot(cx, cy, cz) || 1;
  out.sx = cx / cl; out.sy = cy / cl; out.sz = cz / cl;
  return best;
}
