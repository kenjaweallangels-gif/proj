// Песчаные наносы вокруг корпуса: харвестер «сидит» в песке (подошва гусениц утоплена на SINK м), к бортам нагребены валы,
// впереди — вал от ковша, сзади — отвалы. Одна сетка в локальной системе модели; высоты привязаны к рельефу и обновляются
// порциями при смене позиции (харвестер ползёт медленно). Над трапом вал прорезан.
import * as THREE from 'three';
import { SINK, GANG } from './layout.js';
import { rampY } from './hull.js';

const X0 = -80, X1 = 82, Z0 = -50, Z1 = 50, STEP = 2.0;
const NX = Math.round((X1 - X0) / STEP) + 1, NZ = Math.round((Z1 - Z0) / STEP) + 1;
const RECT = { x0: -57.5, x1: 45, z: 23.6 };
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hash = (x, z) => { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); };
const vnoise = (x, z) => {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  return (hash(ix, iz) * (1 - ux) + hash(ix + 1, iz) * ux) * (1 - uz) + (hash(ix, iz + 1) * (1 - ux) + hash(ix + 1, iz + 1) * ux) * uz;
};

/** Высота вала над грунтом в точке (x, z) локальной системы. */
export function bermHeight(x, z) {
  const dx = Math.max(RECT.x0 - x, 0, x - RECT.x1), dz = Math.max(-RECT.z - z, 0, z - RECT.z);
  const outside = Math.hypot(dx, dz);
  const inside = -Math.min(x - RECT.x0, RECT.x1 - x, z + RECT.z, RECT.z - z);
  const d = outside > 0 ? outside : inside;
  const amp = 2.3 + 1.9 * sstep(36, 50, x) + 0.5 * sstep(-50, -60, x) + 0.9 * (vnoise(x * 0.07, z * 0.07) - 0.5);
  const W = 13 + 5 * sstep(36, 50, x);
  const f = 1 - sstep(-1.5, W, d);
  let h = amp * Math.pow(f, 1.35);
  const rip = Math.sin((x * 0.8 + z * 0.45) * 1.1 + vnoise(x * 0.2, z * 0.2) * 5) * 0.5 + 0.5;
  h += (0.16 * rip + 0.22 * (vnoise(x * 0.5, z * 0.5) - 0.5)) * Math.min(1, f * 2);
  return Math.max(0, h);
}

export function createBerm(material) {
  const pos = new Float32Array(NX * NZ * 3), hArr = new Float32Array(NX * NZ), off = new Float32Array(NX * NZ);
  const idx = [];
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const k = j * NX + i, x = X0 + i * STEP, z = Z0 + j * STEP;
    pos[k * 3] = x; pos[k * 3 + 2] = z; hArr[k] = bermHeight(x, z); pos[k * 3 + 1] = SINK + hArr[k];
    if (i < NX - 1 && j < NZ - 1) idx.push(k, k + NX, k + 1, k + 1, k + NX, k + NX + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, SINK, 0), 110);
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = true; mesh.castShadow = false; mesh.receiveShadow = true; mesh.renderOrder = -1;
  mesh.name = 'HarvesterBerm';

  const lane = (x, z) => {   // вес выреза под трапом (1 — в полосе трапа)
    const ex = Math.max(GANG.xTop - 4 - x, 0, x - (GANG.xFoot + 3));
    const ez = Math.max(Math.abs(z - GANG.zc) - GANG.w / 2 - 0.4, 0);
    return 1 - sstep(0, 2.2, Math.hypot(ex, ez));
  };
  let cursor = 0, running = false, ready = false;
  const _v = new THREE.Vector3(), _inv = new THREE.Matrix4();
  let task = null;
  /** Привязка к рельефу: groundFn(x, z) — мировая высота; root — Object3D харвестера. Порциями (budget вершин за вызов). */
  function conform(groundFn, root, budget = 700) {
    if (!running) { running = true; cursor = 0; root.updateMatrixWorld(true); _inv.copy(root.matrixWorld).invert(); task = root.matrixWorld.clone(); }
    const p = geo.attributes.position;
    const N = NX * NZ;
    const end = Math.min(N, cursor + budget);
    for (; cursor < end; cursor++) {
      const k = cursor, x = pos[k * 3], z = pos[k * 3 + 2];
      _v.set(x, SINK, z).applyMatrix4(task);
      const gy = groundFn(_v.x, _v.z);
      _v.set(_v.x, gy, _v.z).applyMatrix4(_inv);
      off[k] = _v.y - SINK;                 // отклонение рельефа от номинального уровня песка (локально)
      let y = SINK + off[k] + hArr[k] - 0.07 * (1 - Math.min(1, hArr[k] * 3));
      const lw = lane(x, z);
      if (lw > 0.001) y = y * (1 - lw) + Math.min(y, rampY(Math.min(Math.max(x, GANG.xTop), GANG.xFoot)) - 0.6) * lw;
      p.setY(k, y);
    }
    if (cursor >= N) { running = false; ready = true; p.needsUpdate = true; geo.computeVertexNormals(); }
    return ready;
  }
  return { mesh, conform, get busy() { return running; }, get ready() { return ready; } };
}
