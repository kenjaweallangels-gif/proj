// Растительность высокой котловины: только МЕЛКИЕ пустынные растения — креозот и соляной куст (30–70 см), редкие злаки, суккуленты (розетки, бочонки),
// низкие цветущие кустики (не выше колена), лишайники на скале и камнях. Ни пальм, ни деревьев, ни грядок, ни воды.
// Посадки сбиты в «кучки» в укрытиях: с подветренной стороны валунов и у подножия стен (тень, мало ветра, больше наносного грунта).
// Инстансы с чанковым LOD (InstGroup), ветер в вершинном шейдере (GWIND), посев по seed, коллайдеры валунов (owner 'garden').
import * as THREE from 'three';
import { rng, clamp, smoothstep } from '../core/util.js';
import { createLevelRockMaterial } from '../level/rockmat.js';
import { buildGrass, buildShrub, buildFlower, buildSucculent, buildLichen, InstGroup, makePlantMaterial } from './plants.js';
import { grassTexture, foliageTexture, flowerTexture, succulentTexture } from './textures.js';
import { C, MOUTH, ringIn, ringH, ang, radius, shade, WIND_DIR2 } from './layout.js';

const V3 = THREE.Vector3;
const PI2 = Math.PI * 2;
const lin = (c) => [Math.pow(c[0], 2.2), Math.pow(c[1], 2.2), Math.pow(c[2], 2.2)];

export function createFlora(game, { ground, faceAt, root, quality, rim }) {
  const R = rng(3131);
  const qf = quality === 'low' ? 0.5 : quality === 'high' ? 1.35 : 1;
  const out = { groups: [], palms: [], trees: [], shrubs: [], rocks: [], lizardRocks: [], colliders: [], clusters: [], counts: {} };
  const col = (shape) => { const id = game.colliders?.add({ owner: 'garden', ...shape }); if (id) out.colliders.push(id); };

  // ---------------- материалы ----------------
  const grassMat = makePlantMaterial({ map: grassTexture('poverty', 1), key: 'gd-grass', roughness: 0.95 });
  const creoMat = makePlantMaterial({ map: foliageTexture('creosote', 3), key: 'gd-creo', alphaTest: 0.45 });
  const saltMat = makePlantMaterial({ map: foliageTexture('saltbush', 4), key: 'gd-salt', alphaTest: 0.45 });
  const succMat = makePlantMaterial({ map: succulentTexture(2), key: 'gd-succ', alphaTest: 0.4, roughness: 0.7 });
  const barrelMat = makePlantMaterial({ map: null, key: 'gd-barrel', roughness: 0.8, side: THREE.FrontSide });
  const flowMat = makePlantMaterial({ map: flowerTexture(), key: 'gd-flow', alphaTest: 0.4 });
  const woodMat = makePlantMaterial({ map: null, key: 'gd-wood', roughness: 0.95, side: THREE.FrontSide });
  const lichenMat = makePlantMaterial({ map: null, key: 'gd-lichen', roughness: 1.0, side: THREE.DoubleSide });
  const rockMat = createLevelRockMaterial({ band: 3.0, sand: 0.5 });

  const mkGroup = (parts, range, shadow, cell, name) => { const g = new InstGroup(root, parts, { range: range * (quality === 'low' ? 0.7 : 1), shadow, cell, name }); out.groups.push(g); return g; };

  // ---------------- геометрии и группы ----------------
  const grass = [0, 1, 2].map((v) => mkGroup([{ geo: buildGrass('poverty', v), mat: grassMat }], 55, false, 14, 'grass'));
  const creo = [0, 1, 2].map((v) => { const g = buildShrub('creosote', v); return mkGroup([{ geo: g.leaf, mat: creoMat }, { geo: g.wood, mat: woodMat }], 70, false, 18, 'creosote'); });
  const salt = [0, 1, 2].map((v) => { const g = buildShrub('saltbush', v); return mkGroup([{ geo: g.leaf, mat: saltMat }, { geo: g.wood, mat: woodMat }], 70, false, 18, 'saltbush'); });
  const succ = [0, 1].map((v) => mkGroup([{ geo: buildSucculent('rosette', v), mat: succMat }], 48, false, 14, 'succulent'));
  const barrel = [0, 1].map((v) => mkGroup([{ geo: buildSucculent('barrel', v), mat: barrelMat }], 42, false, 14, 'barrelcactus'));
  const flow = [0, 1, 2, 3].map((v) => mkGroup([{ geo: buildFlower(v), mat: flowMat }], 38, false, 12, 'flowers'));
  const lichen = [0, 1, 2].map((v) => mkGroup([{ geo: buildLichen(v), mat: lichenMat }], 46, false, 14, 'lichen'));

  // ---------------- допуски ----------------
  const ringAt = (x, z) => ringIn(ang(x, z));
  const inBasin = (x, z, m = 2) => radius(x, z) < ringAt(x, z) - m && x > faceAt(z) + 2.5;
  /** Свободное место: внутри чаши, не в проходе от лаза. */
  const free = (x, z, m = 1.5) => {
    if (!inBasin(x, z, m)) return false;
    if (x < MOUTH.x + 9 && Math.abs(z - MOUTH.z) < 3.2) return false;
    return true;
  };
  const colorVar = (k = 0.2, tint = [1, 1, 1]) => [clamp(tint[0] * (1 - k / 2 + R() * k), 0, 1.4), clamp(tint[1] * (1 - k / 2 + R() * k), 0, 1.4), clamp(tint[2] * (1 - k / 2 + R() * k), 0, 1.4)];
  const yAt = (x, z) => ground(x, z) - 0.02;
  const pick = (arr) => arr[(R() * arr.length) | 0];
  const near = (list, x, z, d) => list.some((q) => (q.x - x) ** 2 + (q.z - z) ** 2 < d * d);
  const patch = (arrGroup, x, y, z, nx, ny, nz, s, color) => {
    const phi = Math.acos(clamp(ny, -1, 1)), yaw = Math.atan2(nx, nz);
    pick(arrGroup).add(x + nx * 0.02, y + ny * 0.02, z + nz * 0.02, yaw, s, s, color, phi, 0);
  };
  const lichenColor = () => {
    const t = R();
    // оранжевая ксантория, жёлто-зелёная ризокарпон, бледно-серая, тёмная корка
    const c = t < 0.34 ? [0.86, 0.48, 0.1] : t < 0.6 ? [0.66, 0.72, 0.16] : t < 0.85 ? [0.66, 0.7, 0.6] : [0.22, 0.2, 0.17];
    const v = 0.85 + R() * 0.3; return lin([c[0] * v, c[1] * v, c[2] * v]);
  };

  // ---------------- валуны (укрытия) ----------------
  const stoneGeo = (() => {
    const g = new THREE.IcosahedronGeometry(1, 2); const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const k = 1 + 0.2 * Math.sin(x * 4.1 + z * 2.3) * Math.cos(y * 3.7 + x * 1.7) + 0.09 * Math.sin(z * 8 + y * 5); p.setXYZ(i, x * k, y * k * 0.7, z * k); }
    g.computeVertexNormals(); return g;
  })();
  const stones = new InstGroup(root, [{ geo: stoneGeo, mat: rockMat }], { range: 170, shadow: true, cell: 30, name: 'stones' }); out.groups.push(stones);
  const nSt = Math.round(40 * Math.min(qf, 1.25));
  const boulders = [];
  for (let i = 0, tries = 0; i < nSt && tries < nSt * 25; tries++) {
    const th = R() * PI2, rr = Math.sqrt(R()) * 40;
    const x = C.x + Math.cos(th) * rr, z = C.z + Math.sin(th) * rr;
    if (!free(x, z, 2.0)) continue;
    if (near(boulders, x, z, 4.5)) continue;
    const big = R() < 0.3, r = big ? 0.8 + R() * 0.9 : 0.3 + R() * 0.5;
    const y = ground(x, z) + r * 0.12, sx = r * (1 + R() * 0.5), sy = r * (0.6 + R() * 0.3), yaw = R() * PI2;
    stones.add(x, y, z, yaw, sx, sy, colorVar(0.2, [0.95, 0.9, 0.85]));
    const b = { x, y: y + sy * 0.75, z, r: Math.max(sx, sy), sx, sy, big };
    boulders.push(b); out.rocks.push({ x, y: b.y, z, r });
    if (r > 0.5) col({ type: 'sphere', c: new V3(x, y + r * 0.2, z), r: r * 0.85, tags: new Set(['rock']) });
    if (big && out.lizardRocks.length < 6) out.lizardRocks.push({ x, y: y + sy * 0.7, z, r });
    // лишайник на камне: 2–5 пятен по верху и бокам
    const nL = 2 + ((R() * 4) | 0) + (big ? 3 : 0);
    for (let k = 0; k < nL; k++) {
      const a = R() * PI2, ph = R() * 1.15;                         // полярный угол от вертикали (0 — макушка)
      const nx = Math.sin(ph) * Math.cos(a), ny = Math.cos(ph), nz = Math.sin(ph) * Math.sin(a);
      patch(lichen, x + sx * 0.93 * nx, y + sy * 0.95 * ny, z + sx * 0.93 * nz, nx, ny, nz, 0.08 + R() * (big ? 0.26 : 0.14), lichenColor());
    }
    i++;
  }
  // галька и щебень: мелкая россыпь, гуще у подножия стен
  {
    const pebGeo = (() => { const g = new THREE.IcosahedronGeometry(1, 1); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const k = 1 + 0.2 * Math.sin(x * 5 + z * 3) * Math.cos(y * 4); p.setXYZ(i, x * k, y * k * 0.7, z * k); } g.computeVertexNormals(); return g; })();
    const pebs = new InstGroup(root, [{ geo: pebGeo, mat: rockMat }], { range: 44, shadow: false, cell: 16, name: 'pebbles' }); out.groups.push(pebs);
    const nPb = Math.round(700 * qf);
    for (let i = 0, tries = 0; i < nPb && tries < nPb * 4; tries++) {
      const th = R() * PI2, rr = Math.sqrt(R()) * 42;
      const x = C.x + Math.cos(th) * rr, z = C.z + Math.sin(th) * rr;
      if (!inBasin(x, z, 1.5)) continue;
      if (R() > 0.2 + 0.7 * shade(x, z)) continue;
      const s = 0.04 + Math.pow(R(), 2) * 0.17;
      pebs.add(x, ground(x, z) + s * 0.1, z, R() * PI2, s * (1 + R() * 0.6), s * (0.5 + R() * 0.4), colorVar(0.25, [0.95, 0.9, 0.82])); i++;
    }
  }

  // ---------------- кучки растений в укрытиях ----------------
  const shrubGrid = [];
  const addShrub = (kind, x, z, s) => {
    const y = yAt(x, z), yaw = R() * PI2;
    (kind === 'creosote' ? pick(creo) : pick(salt)).add(x, y, z, yaw, s, s * (0.85 + R() * 0.3), colorVar(0.2));
    shrubGrid.push({ x, z, s, kind });
    return y;
  };
  const addFlowers = (x, z, y, s, n) => {
    for (let k = 0; k < n; k++) {
      const a = R() * PI2, d = (0.08 + R() * 0.3) * s * 1.6;
      pick(flow).add(x + Math.cos(a) * d, y + 0.1 * s * 1.6 + R() * 0.12, z + Math.sin(a) * d, R() * PI2, 0.8 + R() * 0.7, 0.8 + R() * 0.7, colorVar(0.1));
    }
  };
  function cluster(cx, cz, spread, dens = 1) {
    if (!free(cx, cz, 1.4)) return;
    out.clusters.push({ x: cx, z: cz });
    const put = (n, fn, minD) => {
      for (let q = 0, t = 0; q < n && t < n * 8; t++) {
        const a = R() * PI2, d = Math.sqrt(R()) * spread, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
        if (!free(x, z, 1.3)) continue;
        if (near(boulders, x, z, 0.5 + (boulders.find((b) => (b.x - x) ** 2 + (b.z - z) ** 2 < 4) ? 0.6 : 0))) continue;
        if (minD && near(shrubGrid, x, z, minD)) continue;
        fn(x, z); q++;
      }
    };
    // креозот — остов кучки, потом соляной куст, цветущие кустики, злаки и суккуленты вперемешку
    put(Math.round((1 + R() * 1.4) * dens), (x, z) => { const s = 0.3 + R() * 0.22; const y = addShrub('creosote', x, z, s); if (R() < 0.6) addFlowers(x, z, y + 0.3 * s * 1.3, s, 3 + ((R() * 4) | 0)); }, 1.2);
    put(Math.round((1.5 + R() * 2) * dens), (x, z) => { const s = 0.33 + R() * 0.2; const y = addShrub('saltbush', x, z, s); if (R() < 0.35) addFlowers(x, z, y + 0.2, s * 0.9, 2 + ((R() * 3) | 0)); }, 0.9);
    put(Math.round((3 + R() * 4) * dens), (x, z) => { const s = 0.5 + R() * 0.45; pick(grass).add(x, yAt(x, z), z, R() * PI2, s, s * (0.8 + R() * 0.5), colorVar(0.28, [1, 1, 0.9])); }, 0);
    put(Math.round(R() * 2.5 * dens), (x, z) => { const s = 0.8 + R() * 0.7; pick(succ).add(x, yAt(x, z), z, R() * PI2, s, s, colorVar(0.2)); }, 0.4);
    put(Math.round(R() * 1.3 * dens), (x, z) => { const s = 0.8 + R() * 0.7; pick(barrel).add(x, yAt(x, z) - 0.015, z, R() * PI2, s, s, colorVar(0.2)); }, 0.5);
  }
  // 1) подветренная сторона валунов: ветер дует по WIND_DIR2, значит укрытие — за камнем по ходу ветра
  for (const b of boulders) {
    if (R() > (b.big ? 0.95 : 0.6)) continue;
    const off = b.r * 1.15 + 0.5 + R() * 0.9, side = (R() - 0.5) * 1.6;
    const cx = b.x + WIND_DIR2[0] * off - WIND_DIR2[1] * side, cz = b.z + WIND_DIR2[1] * off + WIND_DIR2[0] * side;
    cluster(cx, cz, 0.9 + b.r * 0.9, b.big ? 1.3 : 0.9);
  }
  // 2) у подножия стен, в тени
  const nWall = Math.round(14 * qf);
  for (let i = 0, tries = 0; i < nWall && tries < nWall * 30; tries++) {
    const th = R() * PI2 - Math.PI, rr = ringAt(C.x + Math.cos(th) * 40, C.z + Math.sin(th) * 40) - 2.4 - R() * 5;
    const cx = C.x + Math.cos(th) * rr, cz = C.z + Math.sin(th) * rr;
    if (!free(cx, cz, 1.8) || near(out.clusters, cx, cz, 6.5)) continue;
    cluster(cx, cz, 1.3 + R() * 1.4, 1.1); i++;
  }
  // 3) несколько отдельных кустиков по открытому дну (редко; ветер их прижимает)
  const nOpen = Math.round(10 * qf);
  for (let i = 0, tries = 0; i < nOpen && tries < nOpen * 30; tries++) {
    const th = R() * PI2, rr = Math.sqrt(R()) * 34;
    const x = C.x + Math.cos(th) * rr, z = C.z + Math.sin(th) * rr;
    if (!free(x, z, 2.4) || near(out.clusters, x, z, 5)) continue;
    cluster(x, z, 0.8, 0.55); i++;
  }
  // редкие злаки поодиночке
  const nGrass = Math.round(90 * qf);
  for (let i = 0, tries = 0; i < nGrass && tries < nGrass * 8; tries++) {
    const th = R() * PI2, rr = Math.sqrt(R()) * 42;
    const x = C.x + Math.cos(th) * rr, z = C.z + Math.sin(th) * rr;
    if (!free(x, z, 1.5) || R() > 0.2 + 0.8 * shade(x, z)) continue;
    const s = 0.5 + R() * 0.4; pick(grass).add(x, yAt(x, z), z, R() * PI2, s, s * (0.8 + R() * 0.4), colorVar(0.28, [1, 1, 0.9])); i++;
  }
  out.shrubs = shrubGrid;

  // нагретые плоские камни для ящериц на открытом месте (гарантированно несколько)
  for (const [dx, dz, r] of [[12, -14, 1.0], [-6, 18, 1.1], [18, 9, 0.9], [-14, -8, 0.85]]) {
    const x = C.x + dx, z = C.z + dz;
    if (!free(x, z, 1.5)) continue;
    const y = ground(x, z) + r * 0.1;
    stones.add(x, y, z, R() * PI2, r * 1.5, r * 0.55, [1, 0.96, 0.92]);
    col({ type: 'sphere', c: new V3(x, y + r * 0.1, z), r: r * 0.9, tags: new Set(['rock']) });
    out.lizardRocks.push({ x, y: y + r * 0.42, z, r });
    for (let k = 0; k < 3; k++) { const a = R() * PI2, ph = 0.2 + R() * 0.8; const nx = Math.sin(ph) * Math.cos(a), ny = Math.cos(ph), nz = Math.sin(ph) * Math.sin(a); patch(lichen, x + r * 1.4 * nx, y + r * 0.5 * ny, z + r * 1.4 * nz, nx, ny, nz, 0.1 + R() * 0.2, lichenColor()); }
  }

  // ---------------- лишайники на стенах (у подножия, где доходит рука и взгляд) ----------------
  if (rim) {
    const nW = Math.round(260 * qf);
    for (let i = 0; i < nW; i++) {
      const th = R() * PI2 - Math.PI;
      const hMax = ringH(th) * 0.18, hRel = Math.pow(R(), 1.7) * Math.min(14, hMax) + 0.15;
      const p = rim.wallPoint(th, hRel);
      if (p.x < faceAt(p.z) + 2) continue;                         // у грани Когтя оболочка скрыта в скале
      const clump = 1 + ((R() * 3) | 0);
      for (let k = 0; k < clump; k++) {
        const jx = (R() - 0.5) * 1.2, jy = (R() - 0.5) * 0.9;
        const tx = -p.nz, tz = p.nx;                                 // вдоль стены
        patch(lichen, p.x + tx * jx, p.y + jy, p.z + tz * jx, p.nx * 0.995, 0.0, p.nz * 0.995, 0.1 + R() * 0.4, lichenColor());
      }
    }
  }

  for (const g of out.groups) g.finalize();
  out.counts = Object.fromEntries(out.groups.map((g) => [g.name + (g.parts[0].geo.id % 7), g.N]));
  out.total = out.groups.reduce((a, g) => a + g.N, 0);
  out.refresh = (cam, force) => { for (const g of out.groups) g.refresh(cam, force); };
  out.setVisible = (b) => { for (const g of out.groups) g.setVisible(b); };
  return out;
}
