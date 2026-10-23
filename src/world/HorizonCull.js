import * as THREE from 'three';

/**
 * Horizon culling for planet-sized spheres seen from low orbit.
 *
 * From 410 km only a cap of ~20 deg around the sub-satellite point is above the horizon (about 3 % of
 * the sphere), yet a plain SphereGeometry runs the vertex shader for the whole globe. This reorders the
 * sphere's index buffer into chunks of grid cells and, every frame, draws only the chunks that can be
 * above the horizon (as geometry groups of a one-element material array). UVs, normals and vertices
 * are untouched, so shaders see exactly the same geometry.
 *
 *   const cull = new HorizonCull(mesh, widthSegments, heightSegments);
 *   cull.update(cameraWorldPosition);   // after mesh.position / quaternion are set
 */
const _local = new THREE.Vector3();
const _qInv = new THREE.Quaternion();

export class HorizonCull {
  constructor(mesh, ws, hs, chunkW = 8, chunkH = 8) {
    this.mesh = mesh;
    const geo = mesh.geometry;
    const pos = geo.attributes.position;
    const idx = geo.index.array;
    const row = ws + 1;
    const ncx = Math.ceil(ws / chunkW), ncy = Math.ceil(hs / chunkH);
    const lists = Array.from({ length: ncx * ncy }, () => []);
    for (let t = 0; t < idx.length; t += 3) {
      // the triangle's cell: smallest column/row among its vertices (seam column ws stays with ws-1)
      let ix = Infinity, iy = Infinity;
      for (let k = 0; k < 3; k++) { const v = idx[t + k]; ix = Math.min(ix, Math.min(ws - 1, v % row)); iy = Math.min(iy, Math.floor(v / row)); }
      lists[Math.min(ncy - 1, Math.floor(iy / chunkH)) * ncx + Math.min(ncx - 1, Math.floor(ix / chunkW))].push(idx[t], idx[t + 1], idx[t + 2]);
    }
    const out = new (idx.constructor)(idx.length);
    const v = new THREE.Vector3(), c = new THREE.Vector3();
    this.chunks = [];
    let o = 0;
    for (const list of lists) {
      if (!list.length) continue;
      out.set(list, o);
      c.set(0, 0, 0);
      for (const i of list) c.add(v.fromBufferAttribute(pos, i));
      c.normalize();
      let minDot = 1;
      for (const i of list) minDot = Math.min(minDot, v.fromBufferAttribute(pos, i).normalize().dot(c));
      this.chunks.push({ start: o, count: list.length, dir: c.clone(), radius: Math.acos(Math.min(1, minDot)) });
      o += list.length;
    }
    geo.setIndex(new THREE.BufferAttribute(out, 1));
    this.radius = geo.boundingSphere ? geo.boundingSphere.radius : (geo.computeBoundingSphere(), geo.boundingSphere.radius);
    this.material = mesh.material;
    mesh.material = [this.material];
    geo.clearGroups();
    this.visibleChunks = 0;
  }

  /** Recompute the drawn chunk ranges for a camera at `camWorld` (same units as the mesh). */
  update(camWorld, margin = 0.02) {
    const mesh = this.mesh, geo = mesh.geometry;
    _qInv.copy(mesh.quaternion).invert();
    _local.copy(camWorld).sub(mesh.position).applyQuaternion(_qInv);
    const d = _local.length();
    const s = mesh.scale.x || 1;
    const R = this.radius * s;
    // inside the sphere (or very close to it): draw everything
    const horizon = d <= R * 1.0001 ? Math.PI : Math.acos(Math.min(1, R / d));
    _local.multiplyScalar(1 / Math.max(d, 1e-9));
    geo.clearGroups();
    let runStart = -1, runEnd = -1, n = 0;
    for (const ch of this.chunks) {
      const ang = Math.acos(Math.max(-1, Math.min(1, ch.dir.dot(_local))));
      if (ang - ch.radius > horizon + margin) continue;
      n++;
      if (ch.start === runEnd) runEnd += ch.count;
      else { if (runStart >= 0) geo.addGroup(runStart, runEnd - runStart, 0); runStart = ch.start; runEnd = ch.start + ch.count; }
    }
    if (runStart >= 0) geo.addGroup(runStart, runEnd - runStart, 0);
    this.visibleChunks = n;
    // nothing visible: a zero-length group keeps the mesh drawing nothing
    if (!n) geo.addGroup(0, 0, 0);
  }
}
