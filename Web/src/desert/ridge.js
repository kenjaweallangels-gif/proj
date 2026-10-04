// Хребет «Когтя»: цепочка скальных массивов (оси и станции — core/ridge.js), слоистый трещиноватый песчаник/базальт, осыпь.
// Меш режется на куски по ~200 м вдоль оси, у каждого два уровня детализации (THREE.LOD). Боковое смещение стен только ВНУТРЬ
// от контура основания (SDF в field.js), поэтому коллизия по SDF не «ест» видимую скалу и нет невидимых стен у подножия.
import * as THREE from 'three';
import { noise2, smoothstep, clamp, lerp, rng } from '../core/util.js';
import { MASSIFS, massifAt } from '../core/ridge.js';
import { heightAt, solidSdf } from './field.js';
import { resample } from './rock.js';
import { rockChunkGeo } from './dressing.js';
import { createRockMaterial } from './rockMaterial.js';

const CHUNK = 200;                                   // длина куска вдоль оси, м
const LODS = {
  low: [{ ds: 6, np: 33 }, { ds: 18, np: 17 }],
  med: [{ ds: 3.5, np: 73 }, { ds: 10, np: 37 }],
  high: [{ ds: 2.5, np: 97 }, { ds: 8, np: 49 }],
};
const LOD_SWITCH = { low: 450, med: 750, high: 900 };

const _st = {};
const hash = (x) => { const v = Math.sin(x * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
/** Геометрия куска массива m на отрезке дуги [s0, s1]; позиции — относительно центра (cx, cz), y — абсолютный. */
export function buildMassifChunk(m, s0, s1, ds, NP) {
  const prof = resample(NP);
  const mid = (NP - 1) / 2;
  const n = Math.max(2, Math.ceil((s1 - s0) / ds));
  const mid0 = massifAt(m, (s0 + s1) / 2, {});
  const cx = mid0.x, cz = mid0.z;
  const pos = new Float32Array((n + 1) * NP * 3);
  const axis = new Float32Array((n + 1) * 2);
  let vi = 0;
  for (let i = 0; i <= n; i++) {
    const s = s0 + ((s1 - s0) * i) / n;
    const st = massifAt(m, s, _st);
    const x0 = st.x, z0 = st.z, w = st.w, Ht = st.H;
    const nwx = -st.tz, nwz = st.tx;                 // нормаль влево от направления оси
    const sd = m.seed;
    const baseY = heightAt(x0, z0);
    const gyW = heightAt(x0 + nwx * w, z0 + nwz * w), gyE = heightAt(x0 - nwx * w, z0 - nwz * w);
    const bay = noise2(s / 150 + sd, 8.3);           // крупные бухты/контрфорсы
    const layerH = 38 + 14 * noise2(s / 200 + sd, 3.3);
    const ws = Math.min(1, w / 30);
    axis[i * 2] = x0 - cx; axis[i * 2 + 1] = z0 - cz;
    for (let j = 0; j < NP; j++) {
      const [ln, hn] = prof[j];
      const side = j <= mid ? 0 : 1;
      const sgn = ln >= 0 ? 1 : -1;
      const wall = smoothstep(0.02, 0.2, hn) * (1 - smoothstep(0.9, 1.0, hn));
      let inward = wall * w * 0.05 * (1 + bay);
      // слоистость с дифференциальной эрозией: мягкие пласты отступают глубоко (ниши, полки), твёрдые торчат карнизами; граница пласта резкая
      const lay = (hn * Ht) / layerH + 0.35 * noise2(s / 70 + sd, hn * 2.5 + side * 4);
      const li = Math.floor(lay), lf = lay - li;
      const soft = hash(li * 1.7 + sd * 3.1 + side * 0.37);                          // 0..1: твёрдость пласта (<0.45 — мягкий)
      const rec = soft < 0.45 ? 0.55 + 0.45 * (0.45 - soft) / 0.45 : 0.0;
      inward += wall * ws * (3.2 + 7.5 * rec) * (0.35 + 0.65 * smoothstep(0.0, 0.12, lf) * (1 - 0.5 * smoothstep(0.7, 1.0, lf)));
      inward += wall * ws * 2.2 * Math.pow(lf, 2.5);                                  // подошва пласта обрывается карнизом
      // вертикальные трещины и столбчатая отдельность: ступени, квантованные по оси (резкие рёбра), + узкие щели
      const jq = Math.floor((s + side * 7.3) / (9 + 7 * hash(li + sd)) + sd);
      inward += wall * ws * 5.5 * hash(jq * 0.91 + li * 0.37 + side) * (0.4 + 0.6 * soft);
      const crack = 1 - smoothstep(0.0, 0.035, Math.abs(noise2(s / 11 + sd + side * 9, hn * 1.3 + li * 0.2)));
      inward += wall * ws * 9 * crack * (0.5 + 0.5 * hash(jq + 3.3));
      // ветровые желоба: пологие горизонтальные борозды на наветренной (западной) стороне
      inward += wall * ws * 3.5 * (1 - side) * smoothstep(0.55, 0.8, noise2(s / 60 + sd, hn * 9 + 3));
      // вертикальные желоба стока
      inward += wall * ws * 6 * Math.max(0, noise2(s / 24 + side * 3 + sd, hn * 2.5 + 9)) * (0.4 + 0.6 * hn);
      // сужение верхней трети: острый, зубчатый гребень вместо «буханки»
      inward += smoothstep(0.5, 0.95, hn) * Math.abs(ln) * w * 0.4 * (0.55 + 0.45 * noise2(s / 50 + sd, 7.3 + side));
      inward = Math.min(inward, 0.5 * w);
      const latM = sgn * Math.max(Math.abs(ln) * w - inward, 0.02 * w);
      const x = x0 + nwx * latM, z = z0 + nwz * latM;
      let y;
      if (hn <= 0.001) y = heightAt(x, z) - 2.5;
      else {
        const gy = side === 0 ? gyW : gyE;
        y = lerp(gy, baseY + Ht, Math.pow(hn, 0.98)) + 0.025 * Ht * noise2(s / 37 + sd, hn * 5) * wall;
        y += 0.10 * Ht * smoothstep(0.7, 1.0, hn) * (noise2(s / 13 + sd, 2.2 + hn * 3) + 0.5 * noise2(s / 5, hn * 9 + sd));   // зубчатый гребень
      }
      pos[vi++] = x - cx; pos[vi++] = y; pos[vi++] = z - cz;
    }
  }
  const idx = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < NP - 1; j++) {
    const a = i * NP + j, b = a + 1, c = a + NP, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // ориентация: нормаль западной стены (в середине куска) должна смотреть от оси
  const pi = Math.floor(n / 2) * NP + Math.floor(NP * 0.2);
  const N = g.getAttribute('normal');
  const ox = pos[pi * 3] - axis[Math.floor(n / 2) * 2], oz = pos[pi * 3 + 2] - axis[Math.floor(n / 2) * 2 + 1];
  if (N.getX(pi) * ox + N.getZ(pi) * oz < 0) {
    const ia = g.index.array;
    for (let k = 0; k < ia.length; k += 3) { const t = ia[k + 1]; ia[k + 1] = ia[k + 2]; ia[k + 2] = t; }
    g.computeVertexNormals();
  }
  g.computeBoundingSphere();
  return { geo: g, cx, cz };
}

/** Описания кусков: [{m, s0, s1}] для всех массивов. */
export function ridgeChunks() {
  const out = [];
  for (const m of MASSIFS) {
    const k = Math.max(1, Math.round(m.len / CHUNK));
    for (let i = 0; i < k; i++) out.push({ m, s0: (m.len * i) / k, s1: (m.len * (i + 1)) / k });
  }
  return out;
}

export function createRidge(game, world, rockMat) {
  const q = game.settings.quality;
  const group = new THREE.Group();
  const lods = LODS[q] || LODS.med;
  const mat = rockMat || createRockMaterial({ band: 5.5, tex: 'rock_cliff', texScale: 4.5, quality: q });
  const shadows = q !== 'low';
  const chunks = [];
  for (const c of ridgeChunks()) {
    const lod = new THREE.LOD();
    let cx = 0, cz = 0;
    lods.forEach((l, li) => {
      const { geo, cx: x, cz: z } = buildMassifChunk(c.m, c.s0, c.s1, l.ds, l.np);
      cx = x; cz = z;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = shadows && li === 0; mesh.receiveShadow = shadows;
      lod.addLevel(mesh, li === 0 ? 0 : LOD_SWITCH[q] || 750);
    });
    lod.position.set(cx, 0, cz);
    lod.updateMatrixWorld(true);
    chunks.push(lod);
    group.add(lod);
  }

  // осыпь: угловатые обломки и плиты у подножия (инстансинг, 3 варианта по ~150 треугольников)
  const R = rng(4242);
  const variants = [rockChunkGeo(2.1, 'block'), rockChunkGeo(6.7, 'slab'), rockChunkGeo(10.3, 'wedge')];
  const lists = [[], [], []];
  const nB = q === 'low' ? 120 : q === 'med' ? 360 : 700;
  const tmp = {};
  let nObs = 0;
  for (let i = 0, tries = 0; i < nB && tries < nB * 6; tries++) {
    const m = MASSIFS[Math.floor(R() * MASSIFS.length)];
    const st = massifAt(m, R() * m.len, tmp);
    if (st.H < 60) continue;
    const side = R() < 0.65 ? 1 : -1;                   // чаще на наветренной (западной) стороне
    const d = Math.pow(R(), 2.1) * 70 + 1.5;
    const nwx = -st.tz * side, nwz = st.tx * side;
    const x = st.x + nwx * (st.w + d), z = st.z + nwz * (st.w + d);
    if (solidSdf(x, z) < 1.5) continue;
    const size = lerp(9, 0.7, Math.min(1, d / 75)) * (0.35 + R() * 0.9) * (0.6 + st.H / 500);
    const v = Math.floor(R() * 3);
    const y = heightAt(x, z);
    lists[v].push({ x, y: y + size * 0.12, z, sx: size * (0.8 + R() * 0.5), sy: size * (0.6 + R() * 0.5), sz: size * (0.8 + R() * 0.5), ry: R() * 6.28, rx: (R() - 0.5) * 0.3, rz: (R() - 0.5) * 0.3 });
    if (size > 1.8 && nObs < 160) { world.addObstacle(x, z, size * 0.85); nObs++; }
    i++;
  }
  const mm = new THREE.Matrix4(), qq = new THREE.Quaternion(), ee = new THREE.Euler(), ss = new THREE.Vector3(), pp = new THREE.Vector3();
  const boulderMat = createRockMaterial({ band: 0.9, sand: 0.8, tex: 'rock_desert', texScale: 2.2, quality: q });
  const bMeshes = variants.map((g, v) => {
    const im = new THREE.InstancedMesh(g, boulderMat, Math.max(1, lists[v].length));
    lists[v].forEach((it, k) => { ee.set(it.rx, it.ry, it.rz); qq.setFromEuler(ee); ss.set(it.sx, it.sy, it.sz); pp.set(it.x, it.y, it.z); mm.compose(pp, qq, ss); im.setMatrixAt(k, mm); });
    im.count = lists[v].length; im.instanceMatrix.needsUpdate = true;
    im.castShadow = shadows; im.receiveShadow = shadows; im.frustumCulled = false;
    group.add(im);
    return im;
  });
  game.scene.add(group);
  return { group, chunks, bMeshes, setVisible(b) { group.visible = b; } };
}
