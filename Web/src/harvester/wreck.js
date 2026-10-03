// Обломки харвестера и пятно пряности: после «пожирания» остаются воронка, куски корпуса и оранжевое пятно на песке.
// Обломки — инстансные меши трёх форм (плита, балка, глыба), баллистика на CPU (≤ MAX кусков); упав, замирают наполовину в песке.
import * as THREE from 'three';
import { rng } from '../core/util.js';

const MAX = 150;
const COLORS = ['#c9a227', '#6b6a66', '#34332f', '#7a3c22', '#8a8176', '#b8892a'];

function shapeGeo(kind, R) {
  let g;
  if (kind === 0) g = new THREE.BoxGeometry(1.0, 0.12, 1.7);                         // плита обшивки
  else if (kind === 1) g = new THREE.BoxGeometry(0.22, 0.22, 3.6);                    // балка
  else {                                                                              // глыба
    g = new THREE.IcosahedronGeometry(0.8, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const k = 0.75 + 0.5 * R(); p.setXYZ(i, p.getX(i) * k, p.getY(i) * (0.55 + 0.3 * R()), p.getZ(i) * k); }
  }
  if (g.index) g = g.toNonIndexed();
  g.computeVertexNormals();
  return g;
}

export function createWreck(game) {
  const R = rng(515);
  const group = new THREE.Group();
  group.name = 'HarvesterWreck';
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.72, metalness: 0.55, vertexColors: false });
  const kinds = [0, 1, 2].map((k) => {
    const mesh = new THREE.InstancedMesh(shapeGeo(k, R), mat, MAX);
    mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX; i++) mesh.setColorAt(i, new THREE.Color(COLORS[(i * 7 + k * 3) % COLORS.length]).multiplyScalar(0.8 + 0.3 * R()));
    group.add(mesh);
    return { mesh, n: 0 };
  });
  const parts = [];            // активные/лежащие куски
  const groundFn = (x, z) => game.world?.heightAt?.(x, z) ?? 0;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  let dirty = false;

  /** Выбросить кусок: kind 0 плита / 1 балка / 2 глыба; size — масштаб (м). */
  function spawn(x, y, z, vx, vy, vz, size = 1, kind = Math.floor(R() * 3)) {
    const K = kinds[kind];
    if (K.n >= MAX) return null;
    const part = { kind, idx: K.n++, x, y, z, vx, vy, vz, rx: R() * 6.28, ry: R() * 6.28, rz: R() * 6.28, wx: (R() - 0.5) * 7, wy: (R() - 0.5) * 7, wz: (R() - 0.5) * 7, s: size, rest: false };
    K.mesh.count = K.n;
    parts.push(part);
    dirty = true;
    return part;
  }

  function write(pt) {
    e.set(pt.rx, pt.ry, pt.rz);
    q.setFromEuler(e);
    m4.compose(p.set(pt.x, pt.y, pt.z), q, sc.set(pt.s, pt.s, pt.s));
    kinds[pt.kind].mesh.setMatrixAt(pt.idx, m4);
  }

  function update(dt) {
    if (!parts.length) return;
    let any = dirty;
    for (const pt of parts) {
      if (pt.rest) continue;
      any = true;
      pt.vy -= 9.8 * dt;
      const drag = Math.exp(-0.05 * dt);
      pt.vx *= drag; pt.vz *= drag;
      pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.z += pt.vz * dt;
      pt.rx += pt.wx * dt; pt.ry += pt.wy * dt; pt.rz += pt.wz * dt;
      const gy = groundFn(pt.x, pt.z);
      if (pt.y < gy + 0.25 * pt.s && pt.vy < 0) {
        if (pt.vy < -12 && !pt.bounced) {                      // один отскок с песчаным всплеском
          pt.bounced = true; pt.vy *= -0.18; pt.vx *= 0.5; pt.vz *= 0.5; pt.wx *= 0.4; pt.wy *= 0.4; pt.wz *= 0.4;
          pt.y = gy + 0.25 * pt.s;
          game.worm?.fx?.puff?.(pt.x, gy + 0.5, pt.z, Math.min(0.5, 0.12 * pt.s));
        } else {
          pt.rest = true; pt.y = gy - 0.2 * pt.s; pt.vy = 0;
          pt.rx = (R() - 0.5) * 0.9; pt.rz = (R() - 0.5) * 0.9;     // лежит почти плашмя, наполовину в песке
          game.worm?.fx?.puff?.(pt.x, gy + 0.3, pt.z, Math.min(0.4, 0.1 * pt.s));
        }
      }
      write(pt);
    }
    if (any) { for (const K of kinds) K.mesh.instanceMatrix.needsUpdate = true; dirty = false; }
  }

  function clear() {
    parts.length = 0;
    for (const K of kinds) { K.n = 0; K.mesh.count = 0; K.mesh.instanceMatrix.needsUpdate = true; }
  }

  return { group, spawn, update, clear, get count() { return parts.length; }, get flying() { return parts.filter((x) => !x.rest).length; } };
}

/** Пятно пряности и масла на песке: полярная сетка по рельефу + текстура с неровными лепестками. */
export function createStain(game) {
  const NR = 18, NA = 56;
  const pos = new Float32Array((NR + 1) * NA * 3), uv = new Float32Array((NR + 1) * NA * 2);
  const idx = [];
  for (let r = 0; r < NR; r++) for (let a = 0; a < NA; a++) {
    const a0 = r * NA + a, a1 = r * NA + (a + 1) % NA, b0 = (r + 1) * NA + a, b1 = (r + 1) * NA + (a + 1) % NA;
    idx.push(a0, b0, a1, a1, b0, b1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const ctx = cv.getContext('2d');
  const R = rng(99);
  ctx.clearRect(0, 0, 256, 256);
  const blob = (x, y, r, col, a) => { const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, col.replace('A', a)); g.addColorStop(1, col.replace('A', 0)); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill(); };
  blob(128, 128, 126, 'rgba(70,34,16,A)', 0.55);
  for (let i = 0; i < 90; i++) { const a = R() * 6.28, d = Math.sqrt(R()) * 95; blob(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 12 + R() * 32, 'rgba(190,84,24,A)', 0.2 + R() * 0.35); }
  for (let i = 0; i < 60; i++) { const a = R() * 6.28, d = Math.sqrt(R()) * 110; blob(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 6 + R() * 18, 'rgba(20,14,10,A)', 0.2 + R() * 0.3); }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, opacity: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.visible = false; mesh.renderOrder = 2; mesh.receiveShadow = true;
  const groundFn = (x, z) => game.world?.heightAt?.(x, z) ?? 0;
  let cx = 0, cz = 0, rad = 40;
  function build() {
    for (let r = 0; r <= NR; r++) for (let a = 0; a < NA; a++) {
      const th = (a / NA) * Math.PI * 2, rr = (r / NR) * rad * (1 + 0.12 * Math.sin(th * 3 + 1.2) + 0.08 * Math.sin(th * 7));
      const x = cx + Math.cos(th) * rr, z = cz + Math.sin(th) * rr;
      const k = r * NA + a;
      pos[k * 3] = x; pos[k * 3 + 1] = groundFn(x, z) + 0.1; pos[k * 3 + 2] = z;
      uv[k * 2] = 0.5 + 0.5 * (r / NR) * Math.cos(th); uv[k * 2 + 1] = 0.5 - 0.5 * (r / NR) * Math.sin(th);
    }
    geo.attributes.position.needsUpdate = true; geo.attributes.uv.needsUpdate = true;
    geo.computeVertexNormals();
  }
  return {
    mesh,
    /** Показать пятно в (x, z) радиусом r, непрозрачность a (0..1). */
    show(x, z, r = 40, a = 1) {
      if (x !== cx || z !== cz || r !== rad || !mesh.visible) { cx = x; cz = z; rad = r; build(); }
      mat.opacity = a; mesh.visible = a > 0.01;
    },
    hide() { mesh.visible = false; mat.opacity = 0; },
  };
}
