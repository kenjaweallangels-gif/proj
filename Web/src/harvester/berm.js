// Песчаные наносы вокруг корпуса. Одна сетка в локальной системе модели, высоты привязаны к рельефу ландшафта и обновляются порциями
// при смене позиции/ветра. Материал — тот же, что у ландшафта (terrain.makeSurfaceMaterial): ни шва по цвету, ни «другого песка».
//
// Форма — не прямоугольный вал, а наветренно-подветренная куча, как у настоящего препятствия в потоке песка:
//  - с подветренной стороны — холм с гребнем в нескольких метрах от борта (у стенки — выдувная ложбинка), задний склон осыпи под углом
//    естественного откоса ≈ 32° (tan = 0.62), за ним длинный язык-«хвост», вытянутый ветром;
//  - с наветренной — пологий (≈ 12°) подъём к корпусу и небольшой нанос;
//  - по бокам (вдоль ветра) — узкие осыпи у гусениц, тоже под углом откоса;
//  - под корпусом песок на уровне грунта (без «плато»), у гусениц плавно подходит к бортам.
// Колеи за гусеницами — не здесь: это следы ландшафта (world.addFootprint), потому что вдавленное нельзя нарисовать накладной сеткой.
import * as THREE from 'three';
import { SINK, GANG } from './layout.js';
import { rampY } from './hull.js';

const X0 = -84, X1 = 86, Z0 = -52, Z1 = 52, STEP = 1.5;
const NX = Math.round((X1 - X0) / STEP) + 1, NZ = Math.round((Z1 - Z0) / STEP) + 1;
/** Силуэт корпуса с гусеницами и ковшом (локально): за его границей начинаются наносы. */
const RECT = { x0: -57.5, x1: 58.5, zh: 23.6 };
const TAN_REPOSE = Math.tan(32 * Math.PI / 180);   // угол естественного откоса сухого песка
const TAN_WINDW = Math.tan(12 * Math.PI / 180);    // наветренный склон
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hash = (x, z) => { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); };
const vnoise = (x, z) => {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  return (hash(ix, iz) * (1 - ux) + hash(ix + 1, iz) * ux) * (1 - uz) + (hash(ix, iz + 1) * (1 - ux) + hash(ix + 1, iz + 1) * ux) * uz;
};

// Профиль скоса: уклон меняется плавно 0 → максимум → 0 (скруглённые гребень и подошва, посередине — прямой откос под углом slope).
// Таблица p(t), t ∈ [0,1]: 1 → 0; N — нормировка (∫f), чтобы максимальный уклон был ровно slope.
const FALL = (() => {
  const n = 256, f = (t) => { const a = Math.min(1, t / 0.22), b = Math.min(1, (1 - t) / 0.22); return (a * a * (3 - 2 * a)) * (b * b * (3 - 2 * b)); };
  const F = new Float32Array(n + 1); let acc = 0;
  for (let i = 1; i <= n; i++) { acc += 0.5 * (f((i - 1) / n) + f(i / n)) / n; F[i] = acc; }
  const N = acc, p = new Float32Array(n + 1);
  for (let i = 0; i <= n; i++) p[i] = 1 - F[i] / N;
  return { p, n, N };
})();
const fallP = (t) => { const x = Math.min(0.9999, Math.max(0, t)) * FALL.n, i = Math.floor(x); return FALL.p[i] + (FALL.p[i + 1] - FALL.p[i]) * (x - i); };

/**
 * Профиль кучи вдоль нормали к борту: у стенки — выдувная ложбинка (0.3·A), плавный подъём к гребню на расстоянии c (пологий: ≤ ~21°),
 * дальше откос осыпи с максимальным уклоном slope (для сухого песка tan 32° = 0.62), скруглённая подошва.
 */
function heap(d, A, c, slope, base = 0.3) {
  if (d <= 0) return A * base * sstep(-3.2, 0, d);
  if (d < c) return A * (base + (1 - base) * sstep(0, c, d));
  const run = A / (slope * FALL.N), t = (d - c) / run;
  if (t >= 1) return 0;
  return A * fallP(t);
}

/**
 * Высота нанося над грунтом в точке (x, z) локальной системы. w — направление ветра в локальных осях (единичный вектор {x, z}, «куда дует»).
 */
export function bermHeight(x, z, w = { x: 0.7, z: 0.7 }) {
  const ex = Math.max(RECT.x0 - x, 0, x - RECT.x1), ez = Math.max(Math.abs(z) - RECT.zh, 0);
  const outside = Math.hypot(ex, ez);
  // знаковое расстояние до силуэта и внешняя нормаль (на углах — по направлению от угла)
  let d, nx, nz;
  if (outside > 0) {
    d = outside; nx = (x < RECT.x0 ? -ex : x > RECT.x1 ? ex : 0) / outside; nz = (z < 0 ? -ez : ez) / outside;
  } else {
    const dxl = x - RECT.x0, dxr = RECT.x1 - x, dz = RECT.zh - Math.abs(z);
    const m = Math.min(dxl, dxr, dz);
    d = -m;
    if (m === dz) { nx = 0; nz = z < 0 ? -1 : 1; } else { nz = 0; nx = m === dxl ? -1 : 1; }
  }
  if (d < -3.2) return 0;
  const wd = nx * w.x + nz * w.z;               // >0 — подветренная сторона
  const L = sstep(-0.1, 0.8, wd), Wd = sstep(-0.1, 0.8, -wd), Sd = Math.max(0, 1 - L - Wd);
  const nz1 = vnoise(x * 0.055 + 3, z * 0.055 - 2), nz2 = vnoise(x * 0.06, z * 0.06 + 7);
  const A = (3.0 * L + 1.5 * Wd + 2.2 * Sd) * (0.82 + 0.36 * nz1);
  // гребень не ближе, чем нужно для пологого подъёма (tan 21° ≈ 0.38): подъём к гребню ≤ 1.5·0.7·A/c
  const cRise = 2.75 * A;
  const c = Math.max(cRise, 3.0) * (L + Sd) + 0.2 + (nz2 - 0.5) * 1.0 * (L + Sd);
  const slope = TAN_REPOSE * (L + Sd) + TAN_WINDW * Wd;
  let h = heap(d, A, Math.max(0.2, c), slope, 0.3 + 0.7 * Wd);   // с наветренной стороны гребень у самого борта (без ложбинки)
  // язык-«хвост» за корпусом, вытянутый ветром: низкий, пологий, с волнистым краем
  const cx = (RECT.x0 + RECT.x1) / 2, cz = 0, hx = (RECT.x1 - RECT.x0) / 2, hz = RECT.zh;
  const px = x - cx, pz = z - cz;
  const u = px * w.x + pz * w.z, v = -px * w.z + pz * w.x;
  const hu = Math.abs(w.x) * hx + Math.abs(w.z) * hz, hv = Math.abs(w.z) * hx + Math.abs(w.x) * hz;
  const s = u - hu;
  if (s > -3) {
    const side = 1 - sstep(hv - 4, hv + 8 + 3 * nz2, Math.abs(v));
    const tail = 1.35 * Math.exp(-Math.max(s, 0) / 8.5) * sstep(-3, 3.5, s) * side * (0.75 + 0.5 * vnoise(v * 0.12, s * 0.07));
    h = h + tail * (1 - sstep(0, 3, -d)) * 0.8;   // сглаженное сложение, а не max: без складки на стыке
  }
  // рябь-«волны» наноса вдоль ветра (малая, настоящая рябь рисуется шейдером ландшафта)
  h *= 0.96 + 0.08 * vnoise(u * 0.2, v * 0.1);
  // по краям сетки сходит на нуль (стык с ландшафтом)
  const ed = Math.min(x - X0, X1 - x, z - Z0, Z1 - z);
  h *= sstep(0, 6, ed);
  return Math.max(0, h);
}

/**
 * material — общий с ландшафтом (terrain.makeSurfaceMaterial()) либо запасной; opt.maskAt(x, z, out{rock,packed}) — маски ландшафта в мировых
 * координатах (атрибут aMask), чтобы цвет совпадал с грунтом.
 */
export function createBerm(material, opt = {}) {
  const pos = new Float32Array(NX * NZ * 3), hArr = new Float32Array(NX * NZ), off = new Float32Array(NX * NZ), mask = new Float32Array(NX * NZ * 2);
  const idx = [];
  const wl0 = { x: 0.7, z: 0.7 };
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const k = j * NX + i, x = X0 + i * STEP, z = Z0 + j * STEP;
    pos[k * 3] = x; pos[k * 3 + 2] = z; hArr[k] = bermHeight(x, z, wl0); pos[k * 3 + 1] = SINK + hArr[k];
    mask[k * 2] = 0; mask[k * 2 + 1] = 0.5;
    if (i < NX - 1 && j < NZ - 1) {
      // диагональ чередуется: без «ёлочки» при освещении
      if ((i + j) & 1) idx.push(k, k + NX, k + 1, k + 1, k + NX, k + NX + 1); else idx.push(k, k + NX, k + NX + 1, k, k + NX + 1, k + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aMask', new THREE.BufferAttribute(mask, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, SINK, 0), 120);
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
  const _m = { rock: 0, packed: 0.5 };
  let task = null, wind = { x: 0.7, z: 0.7 }, windAt = { x: 0.7, z: 0.7 };
  let crest = [];            // вершины с крутой осыпью у корпуса (для частиц «песок сыплется»)
  /**
   * Привязка к рельефу: groundFn(x, z) — мировая высота; root — Object3D харвестера; windWorld — {x, z} «куда дует» (мир).
   * Порциями (budget вершин за вызов). true — сетка актуальна.
   */
  function conform(groundFn, root, budget = 900, windWorld = null) {
    if (!running) {
      running = true; cursor = 0; root.updateMatrixWorld(true); _inv.copy(root.matrixWorld).invert(); task = root.matrixWorld.clone();
      if (windWorld) {
        // ветер в локальных осях модели: ex = (cos h, sin h) мира — это +x модели; через матрицу (направление без сдвига)
        const e = _inv.elements, lx = e[0] * windWorld.x + e[8] * windWorld.z, lz = e[2] * windWorld.x + e[10] * windWorld.z;
        const l = Math.hypot(lx, lz) || 1; windAt = { x: lx / l, z: lz / l };
      }
      wind = windAt; crest = [];
    }
    const p = geo.attributes.position, am = geo.attributes.aMask;
    const N = NX * NZ;
    const end = Math.min(N, cursor + budget);
    for (; cursor < end; cursor++) {
      const k = cursor, x = pos[k * 3], z = pos[k * 3 + 2];
      _v.set(x, SINK, z).applyMatrix4(task);
      const wx = _v.x, wz = _v.z;
      const gy = groundFn(wx, wz);
      _v.set(wx, gy, wz).applyMatrix4(_inv);
      off[k] = _v.y - SINK;                 // отклонение рельефа от номинального уровня песка (локально)
      let h = bermHeight(x, z, wind);
      const lw = lane(x, z);
      let y = SINK + off[k] + h;
      if (lw > 0.001) y = y * (1 - lw) + Math.min(y, rampY(Math.min(Math.max(x, GANG.xTop), GANG.xFoot)) - 0.6) * lw;
      p.setY(k, y);
      hArr[k] = h;
      if (opt.maskAt) { opt.maskAt(wx, wz, _m); am.setXY(k, _m.rock, _m.packed); }
      if (h > 1.2 && crest.length < 400 && (k & 3) === 0) crest.push(k);
    }
    if (cursor >= N) { running = false; ready = true; p.needsUpdate = true; am.needsUpdate = true; geo.computeVertexNormals(); }
    return ready;
  }
  /** Случайная точка гребня наноса (локально x, y, z и направление вниз по склону) — для сыплющегося песка. */
  function crestSample(rnd, out) {
    if (!crest.length) return false;
    const k = crest[Math.floor(rnd() * crest.length)];
    out.x = pos[k * 3]; out.z = pos[k * 3 + 2]; out.y = geo.attributes.position.getY(k);
    // направление вниз по склону: от корпуса наружу (по градиенту высоты)
    const e = STEP;
    const hx = bermHeight(out.x + e, out.z, wind) - bermHeight(out.x - e, out.z, wind), hz = bermHeight(out.x, out.z + e, wind) - bermHeight(out.x, out.z - e, wind);
    const l = Math.hypot(hx, hz) || 1;
    out.dx = -hx / l; out.dz = -hz / l; out.slope = l / (2 * e);
    return true;
  }
  return { mesh, conform, crestSample, get busy() { return running; }, get ready() { return ready; }, get wind() { return wind; } };
}
