import * as THREE from 'three';
import { MeshWriter } from './Mesh.js';

/**
 * One interior compartment ("zone") under construction: its geometry writer, placement, physics volumes,
 * obstacles, handrails, windows, portals to neighbouring zones and light positions.
 *
 * Coordinates: everything is authored in zone-local coordinates (for modules: x along the module axis,
 * y "overhead", z to the right), and `M` places the zone in its frame: the station frame for the core
 * modules ('station'), the habitat ring's rotating group for the ring ('ring').
 *
 * Containment volumes (the player must stay inside their union):
 *   { type:'box', center, half, quat }                      oriented box
 *   { type:'cyl', a, b, r }                                 cylinder with flat ends
 *   { type:'polar', x0, x1, r0, r1, p0, p1 }                ring-local polar box (x along the ring axis,
 *                                                           radius r from the axis, angle p from +Y to +Z)
 * `gate` (optional) — object with `isOpen` (a hatch): the volume only counts while it is open.
 */

const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

export class ZoneBuilder {
  constructor(I, id, name, M, { frame = 'station', lite = false, detail = 1, seed = 1 } = {}) {
    this.I = I;
    this.id = id;
    this.name = name;
    this.M = M;                     // zone local -> frame
    this.frame = frame;
    this.W = new MeshWriter(lite ? Math.min(detail, 0.5) : detail);
    let s = seed >>> 0 || 1;
    this.rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    this.rails = [];
    this.solids = [];
    this.K = { W: this.W, T: I.atlas, rnd: this.rnd, lite, detail, rails: this.rails, solids: this.solids, set: '' };
    this.volumes = [];
    this.windows = [];              // world-frame window specs (for the sun mask and outside visibility)
    this.portals = [];              // { to, center (local), radius, gate }
    this.lights = [];               // local positions for the interior point lights
    this.carve = [];                // carve volumes in the zone's frame: { type:'cone', a, b, ra, rb } | { type:'box', c, ax, ay, hx, hy, hz }
    this.up = new THREE.Vector3(0, 1, 0);
    this.hatches = [];              // animated hatch objects owned by this zone
    this.ladders = [];              // ring ladders: { a, b, up } local
    this.extraMeshes = [];          // (geometry map, matrix) for separately transformed parts
    this.bake = null;               // (x,y,z,nx,ny,nz) -> factor, zone-local coordinates
    this.sets = { '': [] };         // material sets: prefix -> windows (world)
    this.hasWindows = false;
    this.exposure = 1.0;            // relative interior brightness (exposure multiplier)
    this.ambient = 1.0;
  }

  /** Oriented box volume (local). */
  box(cx, cy, cz, hx, hy, hz, quat = null, gate = null) {
    const v = { type: 'box', center: new THREE.Vector3(cx, cy, cz), half: new THREE.Vector3(hx, hy, hz), quat: quat ? quat.clone() : new THREE.Quaternion(), gate };
    this.volumes.push(v);
    return v;
  }
  /** Box volume from a placement matrix (centre + rotation) and half sizes. */
  boxM(M, hx, hy, hz, gate = null) {
    const c = new THREE.Vector3(); const q = new THREE.Quaternion();
    M.decompose(c, q, _s);
    return this.box(c.x, c.y, c.z, hx, hy, hz, q, gate);
  }
  cyl(a, b, r, gate = null) { const v = { type: 'cyl', a: a.clone(), b: b.clone(), r, gate }; this.volumes.push(v); return v; }
  polar(x0, x1, r0, r1, p0, p1, gate = null) { const v = { type: 'polar', x0, x1, r0, r1, p0, p1, gate }; this.volumes.push(v); return v; }

  portal(to, center, radius = 0.8, gate = null) { this.portals.push({ to, center: center.clone(), radius, gate }); }
  light(x, y, z) { this.lights.push(new THREE.Vector3(x, y, z)); }

  carveCone(a, b, ra, rb = ra) { this.carve.push({ type: 'cone', a: a.clone(), b: b.clone(), ra, rb }); }
  carveBox(M, hx, hy, hz) {
    const c = new THREE.Vector3(), q = new THREE.Quaternion();
    M.decompose(c, q, _s);
    this.carve.push({ type: 'box', c, ax: new THREE.Vector3(1, 0, 0).applyQuaternion(q), ay: new THREE.Vector3(0, 1, 0).applyQuaternion(q), hx, hy, hz });
  }

  /** Register a window (world frame spec, see Materials.setWindows) for a material set prefix. */
  window(spec, set = '') { (this.sets[set] || (this.sets[set] = [])).push(spec); this.windows.push(spec); this.hasWindows = true; }

  /** Point local -> frame. */
  toFrame(p, out = new THREE.Vector3()) { return out.copy(p).applyMatrix4(this.M); }

  /** Finish: bake vertex lighting and convert to geometry. Returns the zone record consumed by StationInterior. */
  finish() {
    if (this.bake) this.W.shade(this.bake);
    const tris = this.W.tris;
    const geos = this.W.build();
    const M = this.M;
    const mq = new THREE.Quaternion(); M.decompose(_p, mq, _s);
    const toF = (p) => p.clone().applyMatrix4(M);
    const vols = this.volumes.map((v) => {
      if (v.type === 'box') return { type: 'box', center: toF(v.center), half: v.half.clone(), quat: mq.clone().multiply(v.quat), gate: v.gate, passage: !!v.passage };
      if (v.type === 'cyl') return { type: 'cyl', a: toF(v.a), b: toF(v.b), r: v.r, gate: v.gate, passage: !!v.passage };
      return v;   // polar volumes are authored in ring-local coordinates already
    });
    for (const v of vols) if (v.type === 'box') v.qi = v.quat.clone().invert();
    const solids = this.solids.map((c) => {
      if (c.type === 'box') return { type: 'box', center: toF(c.center), halfSize: c.halfSize.clone(), quaternion: mq.clone().multiply(c.quaternion), name: c.name };
      if (c.type === 'capsule') return { type: 'capsule', a: toF(c.a), b: toF(c.b), radius: c.radius, name: c.name };
      return { type: 'sphere', center: toF(c.center), radius: c.radius, name: c.name };
    });
    const rails = this.rails.map((r) => ({ a: toF(r.a), b: toF(r.b), radius: r.radius }));
    const carve = this.carve.map((c) => c.type === 'cone'
      ? { type: 'cone', a: toF(c.a), b: toF(c.b), ra: c.ra, rb: c.rb }
      : { type: 'box', c: toF(c.c), ax: c.ax.clone().applyQuaternion(mq), ay: c.ay.clone().applyQuaternion(mq), hx: c.hx, hy: c.hy, hz: c.hz });
    const bs = new THREE.Box3();
    for (const g of geos.values()) { g.computeBoundingBox(); bs.union(g.boundingBox); }
    const sphere = bs.isEmpty() ? new THREE.Sphere(new THREE.Vector3(), 1) : bs.getBoundingSphere(new THREE.Sphere());
    sphere.applyMatrix4(M);
    return {
      id: this.id, name: this.name, frame: this.frame, M: M.clone(), geos, tris,
      volumes: vols, solids, rails,
      portals: this.portals.map((p) => ({ to: p.to, center: toF(p.center), radius: p.radius, gate: p.gate })),
      lights: this.lights.map(toF), up: this.up.clone().applyQuaternion(mq).normalize(), carve,
      windows: this.windows, sets: this.sets, hasWindows: this.hasWindows, hatches: this.hatches,
      ladders: this.ladders.map((l) => ({ a: toF(l.a), b: toF(l.b), up: l.up.clone().applyQuaternion(mq), side: l.side ? l.side.clone().applyQuaternion(mq) : null })),
      sphere, exposure: this.exposure, extraMeshes: this.extraMeshes,
    };
  }
}

/** Face frame: origin o, outward face normal Z, "right" hint X (projected); Y = Z x X. */
export function ff(o, Z, X) {
  const z = Z.clone().normalize();
  const x = X.clone().addScaledVector(z, -X.dot(z)).normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(o);
}

/** Smoothstep helper for bakes. */
export function sstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
