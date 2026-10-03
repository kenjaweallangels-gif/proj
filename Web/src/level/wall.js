// Таблица положения западной стены «Когтя» у входа: wallX(z, y) → x поверхности меша скалы (м).
// Строится лучами по реальной геометрии buildClawGeometry (desert/rock.js), чтобы выступы тропы сидели точно на стене.
// Если геометрия недоступна — линейная аппроксимация.
import * as THREE from 'three';

const FALLBACK = (z) => 651 - 0.126 * (z - 225);

export function buildWallTable(getGeometry, zone, quality = 'med') {
  const { z0, z1, yMax } = zone;
  const dz = 2, dy = 4;
  const nz = Math.ceil((z1 - z0) / dz) + 1, ny = Math.ceil(yMax / dy) + 1;
  const tab = new Float32Array(nz * ny);
  let ok = false;
  try {
    const g = getGeometry(quality);
    const P = g.getAttribute('position'), I = g.index.array;
    // только треугольники рядом со входом
    const keep = [];
    for (let t = 0; t < I.length; t += 3) {
      let inside = true;
      for (let q = 0; q < 3; q++) {
        const v = I[t + q];
        const x = P.getX(v), y = P.getY(v), z = P.getZ(v);
        if (x < 600 || x > 700 || z < z0 - 14 || z > z1 + 14 || y > yMax + 60) { inside = false; break; }
      }
      if (inside) keep.push(I[t], I[t + 1], I[t + 2]);
    }
    const sub = new THREE.BufferGeometry();
    sub.setAttribute('position', P);
    sub.setIndex(keep);
    const mesh = new THREE.Mesh(sub, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    mesh.updateMatrixWorld(true);
    const rc = new THREE.Raycaster();
    const o = new THREE.Vector3(), dir = new THREE.Vector3(1, 0, 0);
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) {
      o.set(600, j * dy + 0.5, z0 + k * dz);
      rc.set(o, dir); rc.far = 120;
      const hit = rc.intersectObject(mesh, false)[0];
      tab[k * ny + j] = hit ? hit.point.x : NaN;
    }
    // заполнить NaN ближайшими значениями по y (ниже подошвы стены лучи могут уходить в песок)
    for (let k = 0; k < nz; k++) {
      let last = NaN;
      for (let j = ny - 1; j >= 0; j--) { const v = tab[k * ny + j]; if (Number.isFinite(v)) last = v; else if (Number.isFinite(last)) tab[k * ny + j] = last; }
      for (let j = 0; j < ny; j++) if (!Number.isFinite(tab[k * ny + j])) tab[k * ny + j] = FALLBACK(z0 + k * dz);
    }
    ok = keep.length > 0;
    sub.dispose();
  } catch (e) {
    ok = false;
  }
  if (!ok) for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) tab[k * ny + j] = FALLBACK(z0 + k * dz);
  const fn = (z, y) => {
    const fz = Math.min(nz - 1.001, Math.max(0, (z - z0) / dz)), fy = Math.min(ny - 1.001, Math.max(0, y / dy));
    const k = fz | 0, j = fy | 0, u = fz - k, v = fy - j;
    const a = tab[k * ny + j], b = tab[(k + 1) * ny + j], c = tab[k * ny + j + 1], d = tab[(k + 1) * ny + j + 1];
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };
  fn.fromGeometry = ok;
  return fn;
}
