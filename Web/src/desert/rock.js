// «Коготь Шайтана»: скульптурный процедурный меш скалы, «плавники» расщелины A4, фальшивая дверь с меткой крюка.
import * as THREE from 'three';
import { noise2, smoothstep, clamp, lerp } from '../core/util.js';
import { clawCenter, clawHalfWidth, clawHeight } from '../core/layout.js';
import { heightAt, CLEFT, FINS, FALSE_DOOR } from './field.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRockMaterial, HOLES_GLSL } from './rockMaterial.js';
import { ENV } from './env.js';

// профиль сечения (запад → вершина → восток): [боковое смещение / w, высота / H]
const PROFILE = [
  [1.0, 0.0], [0.99, 0.05], [0.965, 0.15], [0.93, 0.29], [0.9, 0.45], [0.85, 0.61], [0.77, 0.75], [0.65, 0.86],
  [0.5, 0.94], [0.3, 0.985], [0.08, 1.0],
  [-0.12, 0.995], [-0.35, 0.98], [-0.56, 0.94], [-0.73, 0.85], [-0.86, 0.69], [-0.94, 0.5], [-0.98, 0.3], [-0.995, 0.12], [-1.0, 0.0],
];
function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
export function resample(n) {
  const out = [];
  const m = PROFILE.length - 1;
  for (let i = 0; i < n; i++) {
    const u = (i / (n - 1)) * m;
    const k = Math.min(m - 1, Math.floor(u)), f = u - k;
    const a = PROFILE[Math.max(0, k - 1)], b = PROFILE[k], c = PROFILE[k + 1], d = PROFILE[Math.min(m, k + 2)];
    out.push([catmull(a[0], b[0], c[0], d[0], f), clamp(catmull(a[1], b[1], c[1], d[1], f), 0, 1)]);
  }
  return out;
}

export function buildClawGeometry(quality) {
  const NT = quality === 'low' ? 260 : 440;
  const NP = quality === 'low' ? 40 : 60;
  const prof = resample(NP);
  const pos = new Float32Array((NT + 1) * NP * 3);
  const mid = (NP - 1) / 2;
  const tt = (i) => -1.075 + (2.15 * i) / NT;
  let vi = 0;
  const cx = (t) => clawCenter(t)[0], cz = (t) => clawCenter(t)[1];
  for (let i = 0; i <= NT; i++) {
    const t = tt(i);
    const tc = clamp(t, -1, 1);
    const cap = Math.abs(t) > 1 ? Math.sqrt(Math.max(0, 1 - Math.pow((Math.abs(t) - 1) / 0.075, 2))) : 1;
    const [x0, z0] = clawCenter(t);
    const e = 0.05;
    let tx = cx(t + e) - cx(t - e), tz = cz(t + e) - cz(t - e);
    const tl = Math.hypot(tx, tz); tx /= tl; tz /= tl;
    const nwx = -tz, nwz = tx; // нормаль на запад
    const w = clawHalfWidth(tc) * Math.max(cap, 0.06);
    const baseY = heightAt(x0, z0);
    const Ht = clawHeight(tc) * (1 + 0.075 * noise2(t * 5.5, 1.3) + 0.04 * noise2(t * 13, 4.1)) * cap;
    const lean = 44 * smoothstep(-0.55, -1.02, t);
    const bay = noise2(t * 5.0, 8.3);            // крупные бухты/контрфорсы
    for (let j = 0; j < NP; j++) {
      let [ln, hn] = prof[j];
      const side = j <= mid ? 0 : 1;
      const sgn = Math.sign(ln);
      const wall = smoothstep(0.02, 0.2, hn) * (1 - smoothstep(0.9, 1.0, hn));
      // крупная пластика: контрфорсы, бухты, ступени
      let latM = ln * w;
      latM += sgn * wall * (w * 0.07 * bay + 4.0 * noise2(t * 14 + side * 7, hn * 1.7)) ;
      // вертикальные эрозионные желоба (регулярность разбита шумом по высоте)
      const gv = noise2(t * 38 + side * 11 + noise2(hn * 2, t * 6) * 3, hn * 0.8 + 2.0);
      latM -= sgn * wall * Math.max(0, gv) * 3.4 * Math.min(1, w / 30);
      latM -= sgn * wall * Math.max(0, noise2(t * 17 + side * 3, hn * 2.5 + 9)) * 5.5 * Math.min(1, w / 30) * (0.4 + 0.6 * hn);
      // наклон/свес кончика когтя
      latM += lean * Math.pow(hn, 2.3);
      let x = x0 + nwx * latM, z = z0 + nwz * latM;
      const gy = heightAt(x0 + nwx * (sgn * w), z0 + nwz * (sgn * w));
      let y;
      if (hn <= 0.001) y = heightAt(x, z) - 2.5;
      else {
        const topY = baseY + Ht;
        y = lerp(gy, topY, Math.pow(hn, 0.98)) + 3.0 * noise2(t * 9, hn * 5) * wall;
        // зубчатая гряда на гребне (низкочастотная)
        if (hn > 0.95) y += 5 * noise2(t * 24, 2.2) * cap;
      }
      // расщелина A4: вертикальный разрез в западной стене у z=326
      if (side === 0 && x0 > 600 && x0 < 780 && Math.abs(z0 - CLEFT.z) < 12) {
        const dz = Math.abs(z - CLEFT.z);
        const k = smoothstep(CLEFT.hw + 1.6, CLEFT.hw, dz) * (1 - smoothstep(0.55, 0.97, hn));
        if (k > 0) x = lerp(x, Math.max(x, CLEFT.x1), k);
      }
      pos[vi++] = x; pos[vi++] = y; pos[vi++] = z;
    }
  }
  const idx = [];
  const panels = [];
  for (let i = 0; i < NT; i++) for (let j = 0; j < NP - 1; j++) {
    const a = i * NP + j, b = a + 1, c = a + NP, d = c + 1;
    // боковые «стенки» расщелины (резкий перепад x между станциями) строятся отдельно — с плоскими нормалями внутрь
    const dxz = Math.hypot(pos[a * 3] - pos[c * 3], pos[a * 3 + 2] - pos[c * 3 + 2]);
    if (dxz > 4.5 && Math.abs(pos[a * 3 + 2] - CLEFT.z) < 9 && pos[a * 3] > 590 && pos[a * 3] < 700) { panels.push([a, b, c, d]); continue; }
    // направление обхода: нормаль наружу (запад на западной стене)
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // проверка ориентации: нормаль в центре западной стены должна смотреть на запад (-x)
  const probe = Math.floor(NT * 0.5) * NP + Math.floor(NP * 0.2);
  const nx = g.getAttribute('normal').getX(probe);
  let flipped = false;
  if (nx > 0) { // перевернуть
    flipped = true;
    const ia = g.index.array;
    for (let k = 0; k < ia.length; k += 3) { const tmp = ia[k + 1]; ia[k + 1] = ia[k + 2]; ia[k + 2] = tmp; }
    g.computeVertexNormals();
  }
  if (panels.length) {
    const P = g.getAttribute('position'), N = g.getAttribute('normal');
    const np = [], nn = [], ni = [];
    let base = P.count;
    for (const [a, b, c, d] of panels) {
      const va = [a, b, c, d].map((k) => new THREE.Vector3(P.getX(k), P.getY(k), P.getZ(k)));
      const e1 = va[1].clone().sub(va[0]), e2 = va[2].clone().sub(va[0]);
      const n = e1.clone().cross(e2).normalize();
      const cen = va[0].clone().add(va[3]).multiplyScalar(0.5);
      const toward = new THREE.Vector3(0, 0, CLEFT.z - cen.z);
      if (n.dot(toward) < 0) n.negate();
      for (const v of va) { np.push(v.x, v.y, v.z); nn.push(n.x, n.y, n.z); }
      // обход так, чтобы геометрическая нормаль совпадала с n
      const t1 = new THREE.Vector3().subVectors(va[1], va[0]).cross(new THREE.Vector3().subVectors(va[2], va[0]));
      if (t1.dot(n) >= 0) ni.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      else ni.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
      base += 4;
    }
    const pos2 = new Float32Array(P.array.length + np.length); pos2.set(P.array); pos2.set(np, P.array.length);
    const nor2 = new Float32Array(N.array.length + nn.length); nor2.set(N.array); nor2.set(nn, N.array.length);
    g.setAttribute('position', new THREE.BufferAttribute(pos2, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor2, 3));
    g.setIndex(Array.from(g.index.array).concat(ni));
  }
  g.computeBoundingSphere();
  return g;
}

/** Деформированный бокс (плавник/плита): сваренный подразбитый куб, смещение вдоль нормали шумом. */
export function chunkyBox(w, h, d, seg, seed, taper = 0) {
  let g = new THREE.BoxGeometry(w, h, d, seg, Math.ceil(seg * h / Math.max(w, d)), seg);
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  g = mergeVertices(g, 1e-3);
  g.computeVertexNormals();
  const p = g.getAttribute('position'), n = g.getAttribute('normal');
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const yn = (y + h / 2) / h;
    const s = 1 - taper * yn;
    const k = 1.6 * noise2(x * 0.09 + seed, y * 0.035 + z * 0.09) + 0.7 * noise2(x * 0.3 + z * 0.3 + seed * 2, y * 0.08) + 0.25 * noise2(x * 1.1 + seed, z * 1.1 + y * 0.3);
    const vert = Math.abs(n.getY(i)) < 0.5 ? 1 : 0.35;
    x = x * s + n.getX(i) * k * vert;
    z = z * s + n.getZ(i) * k * vert;
    y += n.getY(i) * k * 0.6 + (yn > 0.92 ? 0.8 * noise2(x * 0.3, z * 0.3 + seed) : 0);
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

function hookTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#808080'; g.fillRect(0, 0, 512, 512);
  // «крюк творца»: дуга-крюк с засечками
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.strokeStyle = '#202020'; g.lineWidth = 22;
  g.beginPath(); g.moveTo(230, 430); g.bezierCurveTo(230, 300, 190, 190, 270, 130); g.bezierCurveTo(340, 80, 400, 130, 380, 200);
  g.stroke();
  g.lineWidth = 12;
  g.beginPath(); g.moveTo(380, 200); g.lineTo(350, 230); g.stroke();
  g.lineWidth = 9;
  for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(205 + i * 4, 400 - i * 55); g.lineTo(250 + i * 4, 392 - i * 55); g.stroke(); }
  // мягкое размытие для канавки
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4; t.colorSpace = THREE.NoColorSpace;
  return t;
}

export function createClaw(game, world) {
  const q = game.settings.quality;
  const group = new THREE.Group();
  const rockMat = createRockMaterial({ band: 5.5, tex: 'rock_cliff', texScale: 4.5, quality: q });
  const claw = new THREE.Mesh(buildClawGeometry(q), rockMat);
  claw.castShadow = q !== 'low'; claw.receiveShadow = q !== 'low';
  claw.frustumCulled = false;
  // теневой проход с теми же отверстиями (иначе вход в скале отбрасывал бы сплошную тень)
  const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depthMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uHoles: ENV.uniforms.uHoles, uHoleN: ENV.uniforms.uHoleN });
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPd;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPd = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPd;\n' + HOLES_GLSL)
      .replace('void main() {', 'void main() {\n  if (rkHoleRim(vWPd) < 0.0) discard;');
  };
  depthMat.customProgramCacheKey = () => 'rk-claw-depth';
  claw.customDepthMaterial = depthMat;
  group.add(claw);

  // плавники у входа в расщелину
  for (let i = 0; i < FINS.length; i++) {
    const f = FINS[i];
    const geo = chunkyBox(f.hx * 2, f.h, f.hz * 2, 14, 3.1 + i, 0.25);
    const m = new THREE.Mesh(geo, rockMat);
    const gy = heightAt(f.cx, f.cz);
    m.position.set(f.cx, gy + f.h / 2 - 2.0, f.cz);
    m.rotation.y = 0;
    m.castShadow = q !== 'low'; m.receiveShadow = q !== 'low';
    m.customDepthMaterial = depthMat;
    group.add(m);
  }

  // фальшивая дверь: плита с еле заметной меткой крюка
  const hookTex = hookTexture();
  const slabMat = new THREE.MeshStandardMaterial({ color: 0x8f7358, roughness: 0.82, bumpMap: hookTex, bumpScale: 3.5, map: null });
  slabMat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>',
      `#include <color_fragment>
       float hk = texture2D(bumpMap, vBumpMapUv).r;
       diffuseColor.rgb *= 0.45 + 0.75 * smoothstep(0.1, 0.5, hk);`);
  };
  const dg = FALSE_DOOR;
  const gyD = heightAt(dg.x, dg.z);
  const slab = new THREE.Mesh(new THREE.PlaneGeometry(dg.w, dg.h, 1, 1), slabMat);
  slab.position.set(dg.x - 0.06, gyD + dg.h / 2, dg.z);
  slab.rotation.y = -Math.PI / 2;      // нормаль -> -X (к выходу из расщелины)
  slab.receiveShadow = q !== 'low';
  group.add(slab);
  // тёплый отражённый свет в расщелине — чтобы метка крюка читалась
  const bounce = new THREE.PointLight(0xffb67a, 14, 34, 2);
  bounce.position.set(CLEFT.x1 - 5, gyD + 3.2, CLEFT.z);
  group.add(bounce);
  game.scene.add(group);
  return { group, claw, rockMat, slab };
}
