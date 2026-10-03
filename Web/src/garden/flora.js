// Растительность сада: бедная трава, дюнная трава, креозот, соляной куст, тамариск, низкие акации, финиковые пальмы, цветы после полива.
// Инстансы с чанковым LOD (InstGroup), ветер в вершинном шейдере (GWIND), посев по seed, коллайдеры стволов (owner 'garden').
import * as THREE from 'three';
import { rng, clamp, smoothstep } from '../core/util.js';
import { createLevelRockMaterial } from '../level/rockmat.js';
import { buildGrass, buildShrub, buildTree, buildPalm, buildFlower, InstGroup, makePlantMaterial } from './plants.js';
import { grassTexture, foliageTexture, palmFrondTexture, flowerTexture, barkTexture } from './textures.js';
import { C, FLOOR_Y, MOUTH, CHANNELS, BEDS, PLAZA, POND, BASIN, ringIn, nearChannel, inBed, ang, radius } from './layout.js';

const V3 = THREE.Vector3;

export function createFlora(game, { ground, faceAt, root, quality, towerSites = [] }) {
  const R = rng(3131);
  const qf = quality === 'low' ? 0.45 : quality === 'high' ? 1.45 : 1;
  const out = { groups: [], palms: [], trees: [], shrubs: [], rocks: [], lizardRocks: [], colliders: [], counts: {} };
  const col = (shape) => { const id = game.colliders?.add({ owner: 'garden', ...shape }); if (id) out.colliders.push(id); };

  // ---------------- материалы ----------------
  const grassMat = makePlantMaterial({ map: grassTexture('poverty', 1), key: 'gd-grass', roughness: 0.95 });
  const duneMat = makePlantMaterial({ map: grassTexture('dune', 2), key: 'gd-dune', roughness: 0.95 });
  const creoMat = makePlantMaterial({ map: foliageTexture('creosote', 3), key: 'gd-creo', alphaTest: 0.45 });
  const saltMat = makePlantMaterial({ map: foliageTexture('saltbush', 4), key: 'gd-salt', alphaTest: 0.45 });
  const tamaMat = makePlantMaterial({ map: foliageTexture('tamarisk', 5), key: 'gd-tama', alphaTest: 0.35 });
  const acaMat = makePlantMaterial({ map: foliageTexture('acacia', 6), key: 'gd-aca', alphaTest: 0.45 });
  const palmMat = makePlantMaterial({ map: palmFrondTexture(), key: 'gd-palm', alphaTest: 0.4 });
  const flowMat = makePlantMaterial({ map: flowerTexture(), key: 'gd-flow', alphaTest: 0.4 });
  const woodMat = makePlantMaterial({ map: null, key: 'gd-wood', roughness: 0.95, side: THREE.FrontSide });
  const barkTex = barkTexture(); barkTex.repeat.set(3, 6);
  const barkMat = makePlantMaterial({ map: barkTex, alphaTest: 0, key: 'gd-bark', roughness: 0.95, side: THREE.FrontSide });
  const rockMat = createLevelRockMaterial({ band: 3.0, sand: 0.5 });

  const mkGroup = (parts, range, shadow, cell, name) => { const g = new InstGroup(root, parts, { range: range * (quality === 'low' ? 0.7 : 1), shadow, cell, name }); out.groups.push(g); return g; };

  // ---------------- геометрии ----------------
  const grassG = [0, 1, 2].map((v) => buildGrass('poverty', v));
  const duneG = [0, 1].map((v) => buildGrass('dune', v));
  const creoG = [0, 1, 2].map((v) => buildShrub('creosote', v));
  const saltG = [0, 1, 2].map((v) => buildShrub('saltbush', v));
  const tamaG = [0, 1].map((v) => buildTree('tamarisk', v));
  const acaG = [0, 1].map((v) => buildTree('acacia', v));
  const palmG = [0, 1].map((v) => buildPalm(v));
  const flowG = [0, 1, 2, 3].map((v) => buildFlower(v));

  const grass = grassG.map((g) => mkGroup([{ geo: g, mat: grassMat }], 62, false, 14, 'grass'));
  const dune = duneG.map((g) => mkGroup([{ geo: g, mat: duneMat }], 80, false, 16, 'dunegrass'));
  const creo = creoG.map((g) => mkGroup([{ geo: g.leaf, mat: creoMat }, { geo: g.wood, mat: woodMat }], 95, true, 20, 'creosote'));
  const salt = saltG.map((g) => mkGroup([{ geo: g.leaf, mat: saltMat }, { geo: g.wood, mat: woodMat }], 95, true, 20, 'saltbush'));
  const tama = tamaG.map((g) => mkGroup([{ geo: g.leaf, mat: tamaMat }, { geo: g.wood, mat: woodMat }], 170, true, 28, 'tamarisk'));
  const aca = acaG.map((g) => mkGroup([{ geo: g.leaf, mat: acaMat }, { geo: g.wood, mat: woodMat }], 170, true, 28, 'acacia'));
  const palms = palmG.map((g) => mkGroup([{ geo: g.trunk, mat: barkMat }, { geo: g.fronds, mat: palmMat }], 260, true, 40, 'palm'));
  const flow = flowG.map((g) => mkGroup([{ geo: g, mat: flowMat }], 46, false, 12, 'flowers'));

  // ---------------- допуски ----------------
  const ringAt = (x, z) => ringIn(ang(x, z));
  const inBasin = (x, z, m = 2) => radius(x, z) < ringAt(x, z) - m && x > faceAt(z) + 2.5;
  const plazaK = (x, z) => x > MOUTH.x + 0.5 && x < MOUTH.x + 18 && Math.abs(z - MOUTH.z) < 9;
  const free = (x, z, { m = 0.9, bed = false, water = true } = {}) => {
    if (!inBasin(x, z)) return false;
    if (water && nearChannel(x, z, m)) return false;
    if (!bed && inBed(x, z, m)) return false;
    if (plazaK(x, z) && Math.hypot(x - PLAZA.x, (z - PLAZA.z) / 0.85) < PLAZA.r + 0.6) return false;
    if (Math.hypot(x - POND.x, (z - POND.z) * 1.3) < POND.rx + 1.2) return false;
    if (Math.abs(x - BASIN.x) < BASIN.w / 2 + 1.5 && Math.abs(z - BASIN.z) < BASIN.d / 2 + 1.5) return false;
    if (x < 810.5 && Math.abs(z - 399.5) < 3.0) return false;                    // чаша перелива у стены
    return true;
  };
  const colorVar = (k = 0.2, tint = [1, 1, 1]) => [clamp(tint[0] * (1 - k / 2 + R() * k), 0, 1.4), clamp(tint[1] * (1 - k / 2 + R() * k), 0, 1.4), clamp(tint[2] * (1 - k / 2 + R() * k), 0, 1.4)];
  const yAt = (x, z) => ground(x, z) - 0.02;
  const pick = (arr) => arr[(R() * arr.length) | 0];

  // ---------------- пальмы у перелива ----------------
  const palmSpots = [[811, 405.8], [815.5, 411.5], [819, 404.4], [810.5, 388.6], [817.5, 391.5], [821.5, 412.5], [823, 405.5]];
  palmSpots.forEach(([x, z], i) => {
    const y = yAt(x, z), s = 0.85 + R() * 0.3, g = palmG[i % 2];
    palms[i % 2].add(x, y, z, R() * 6.28, s, s, colorVar(0.14));
    out.palms.push({ x, y, z, s, top: new V3(x + g.top[0] * s, y + g.top[1] * s, z + g.top[2] * s) });
    col({ type: 'capsule', a: new V3(x, y, z), b: new V3(x, y + 4.5 * s, z), r: 0.34 * s, tags: new Set(['palm']) });
  });

  // ---------------- тамариск вдоль желобов ----------------
  const treeAdd = (arr, x, z, s, kind) => {
    const y = yAt(x, z); pick(arr).add(x, y, z, R() * 6.28, s, s, colorVar(0.16));
    out.trees.push({ x, y, z, s, kind });
    col({ type: 'capsule', a: new V3(x, y, z), b: new V3(x, y + 2.2 * s, z), r: 0.2 * s + 0.08, tags: new Set([kind]) });
  };
  for (const ch of CHANNELS) {
    if (ch.id === 'main') continue;
    let acc = 3 + R() * 3;
    for (let i = 0; i < ch.pts.length - 1; i++) {
      const [ax, az] = ch.pts[i], [bx, bz] = ch.pts[i + 1], len = Math.hypot(bx - ax, bz - az);
      const nx = -(bz - az) / len, nz = (bx - ax) / len;
      for (let t = acc; t < len; t += 6.5 + R() * 3) {
        const sg = R() < 0.5 ? -1 : 1, off = 1.7 + R() * 1.3;
        const x = ax + (bx - ax) * (t / len) + nx * off * sg, z = az + (bz - az) * (t / len) + nz * off * sg;
        if (free(x, z, { m: 1.2 }) && out.trees.length < 40 * qf + 12) treeAdd(tama, x, z, 0.8 + R() * 0.45, 'tamarisk');
        acc = t + 6.5 - len;
      }
    }
  }
  // ---------------- низкие акации у подножия гребней ----------------
  for (let i = 0, tries = 0; i < Math.round(10 * Math.min(qf, 1.2)) && tries < 300; tries++) {
    const th = (R() * 330 - 150) * Math.PI / 180 + 0.6;
    const r = ringAt(C.x + Math.cos(th) * 40, C.z + Math.sin(th) * 40) - 3.5 - R() * 5;
    const x = C.x + Math.cos(th) * r, z = C.z + Math.sin(th) * r;
    if (!free(x, z, { m: 3 })) continue;
    if (out.trees.some((q) => Math.hypot(q.x - x, q.z - z) < 7)) continue;
    treeAdd(aca, x, z, 0.85 + R() * 0.4, 'acacia'); i++;
  }

  // ---------------- кусты: креозот, соляной ----------------
  const shrubGrid = [];
  const nShr = Math.round(120 * qf);
  for (let i = 0, tries = 0; i < nShr && tries < nShr * 25; tries++) {
    const th = R() * Math.PI * 2, rr = Math.sqrt(R()) * 54;
    const x = C.x + Math.cos(th) * rr, z = C.z + Math.sin(th) * rr;
    if (!free(x, z, { m: 1.4 })) continue;
    // плотнее у гребней (там больше тени и «ветровой дрейф»)
    const edge = smoothstep(26, 50, rr);
    if (R() > 0.28 + 0.6 * edge) continue;
    if (shrubGrid.some((s) => (s.x - x) ** 2 + (s.z - z) ** 2 < 2.6 * 2.6)) continue;
    const isC = R() < 0.55, s = 0.75 + R() * 0.65, yaw = R() * 6.28;
    (isC ? pick(creo) : pick(salt)).add(x, yAt(x, z), z, yaw, s, s * (0.85 + R() * 0.3), colorVar(0.2));
    shrubGrid.push({ x, z, s, kind: isC ? 'creosote' : 'saltbush' }); i++;
  }
  out.shrubs = shrubGrid;

  // ---------------- грядки: ряды молодых растений ----------------
  BEDS.forEach((b, bi) => {
    const kind = bi % 3;
    for (let x = b.x - b.hx + 1; x < b.x + b.hx - 0.4; x += 1.4) for (let z = b.z - b.hz + 0.8; z < b.z + b.hz - 0.4; z += 1.15) {
      const jx = x + (R() - 0.5) * 0.25, jz = z + (R() - 0.5) * 0.25, y = ground(jx, jz) + 0.16;
      const row = Math.floor((x - b.x + b.hx) / 1.4);
      if (kind === 0) { const s = 0.45 + R() * 0.2; pick(salt).add(jx, y, jz, R() * 6.28, s, s, colorVar(0.2)); }
      else if (kind === 1) { if (row % 2) { const s = 0.28 + R() * 0.12; pick(tama).add(jx, y, jz, R() * 6.28, s, s, colorVar(0.2)); } else { const s = 0.45; pick(creo).add(jx, y, jz, R() * 6.28, s, s, colorVar(0.2)); } }
      else { const s = 0.7 + R() * 0.5; pick(grass).add(jx, y, jz, R() * 6.28, s, s, colorVar(0.25)); const s2 = 0.35 + R() * 0.15; pick(salt).add(jx + 0.4, y, jz + 0.3, R() * 6.28, s2, s2, colorVar(0.2)); }
      if (R() < 0.45) pick(flow).add(jx + (R() - 0.5) * 0.7, y, jz + 0.45, R() * 6.28, 0.9 + R() * 0.6, 0.9 + R() * 0.6, colorVar(0.1));
    }
  });

  // ---------------- трава и цветы ----------------
  const nGrass = Math.round(1700 * qf);
  for (let i = 0, tries = 0; i < nGrass && tries < nGrass * 6; tries++) {
    // кучки: центр + разброс
    const th = R() * Math.PI * 2, rr = Math.sqrt(R()) * 52;
    const cx = C.x + Math.cos(th) * rr, cz = C.z + Math.sin(th) * rr;
    if (!inBasin(cx, cz, 2)) continue;
    const dens = 0.35 + 0.65 * smoothstep(20, 48, rr);
    if (R() > dens) continue;
    const nIn = 3 + (R() * 4 | 0);
    for (let k = 0; k < nIn; k++) {
      const x = cx + (R() - 0.5) * 2.2, z = cz + (R() - 0.5) * 2.2;
      if (!free(x, z, { m: 0.45 })) continue;
      const s = 0.8 + R() * 0.7; pick(grass).add(x, yAt(x, z), z, R() * 6.28, s, s * (0.8 + R() * 0.5), colorVar(0.28, [1, 1, 0.9])); i++;
    }
  }
  // дюнная трава у гребней (на «наносах»)
  const nDune = Math.round(260 * qf);
  for (let i = 0, tries = 0; i < nDune && tries < nDune * 12; tries++) {
    const th = R() * Math.PI * 2, rr = ringAt(C.x + Math.cos(th) * 45, C.z + Math.sin(th) * 45) - 1 - R() * 7;
    const x = C.x + Math.cos(th) * rr, z = C.z + Math.sin(th) * rr;
    if (!free(x, z, { m: 0.6 })) continue;
    const s = 0.8 + R() * 0.7; pick(dune).add(x, yAt(x, z), z, R() * 6.28, s, s * (0.9 + R() * 0.4), colorVar(0.25)); i++;
  }
  // цветы после полива: вдоль каналов, у чаши и пруда
  const nFl = Math.round(900 * qf);
  for (let i = 0, tries = 0; i < nFl && tries < nFl * 12; tries++) {
    const ch = CHANNELS[(R() * CHANNELS.length) | 0], si = (R() * (ch.pts.length - 1)) | 0;
    const [ax, az] = ch.pts[si], [bx, bz] = ch.pts[si + 1], t = R();
    const x = ax + (bx - ax) * t + (R() - 0.5) * 5, z = az + (bz - az) * t + (R() - 0.5) * 5;
    if (!free(x, z, { m: 0.5, bed: true })) continue;
    const near = Math.hypot(x - (ax + (bx - ax) * t), z - (az + (bz - az) * t));
    if (near > 1.2 + R() * 3.4) continue;
    const s = 0.8 + R() * 0.8; pick(flow).add(x, yAt(x, z), z, R() * 6.28, s, s, colorVar(0.12)); i++;
  }

  // ---------------- декоративные камни (с коллайдерами) и лежаки для ящериц ----------------
  const stoneGeo = (() => {
    const g = new THREE.IcosahedronGeometry(1, 2); const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const k = 1 + 0.2 * Math.sin(x * 4.1 + z * 2.3) * Math.cos(y * 3.7 + x * 1.7) + 0.09 * Math.sin(z * 8 + y * 5); p.setXYZ(i, x * k, y * k * 0.7, z * k); }
    g.computeVertexNormals(); return g;
  })();
  const stones = new InstGroup(root, [{ geo: stoneGeo, mat: rockMat }], { range: 200, shadow: true, cell: 30, name: 'stones' }); out.groups.push(stones);
  const nSt = Math.round(46 * Math.min(qf, 1.3));
  for (let i = 0, tries = 0; i < nSt && tries < nSt * 20; tries++) {
    const th = R() * Math.PI * 2, rr = Math.sqrt(R()) * 52;
    const x = C.x + Math.cos(th) * rr, z = C.z + Math.sin(th) * rr;
    if (!free(x, z, { m: 1.6 })) continue;
    const big = R() < 0.18, r = big ? 0.8 + R() * 0.7 : 0.25 + R() * 0.45;
    const y = ground(x, z) + r * 0.12;
    stones.add(x, y, z, R() * 6.28, r * (1 + R() * 0.5), r * (0.6 + R() * 0.3), colorVar(0.2, [0.95, 0.9, 0.85]));
    out.rocks.push({ x, y: y + r * 0.7, z, r });
    if (r > 0.5) col({ type: 'sphere', c: new V3(x, y + r * 0.2, z), r: r * 0.85, tags: new Set(['rock']) });
    if (big && out.lizardRocks.length < 6) out.lizardRocks.push({ x, y: y + r * 0.66, z, r });
    i++;
  }
  // гарантируем несколько «нагретых» плоских камней для ящериц на открытом месте
  for (const [x, z, r] of [[858, 372, 1.0], [868, 424, 1.1], [846, 436, 0.9], [872, 380, 0.85]]) {
    if (!free(x, z, { m: 1 })) continue;
    const y = ground(x, z) + r * 0.1;
    stones.add(x, y, z, R() * 6.28, r * 1.5, r * 0.55, [1, 0.96, 0.92]);
    col({ type: 'sphere', c: new V3(x, y + r * 0.1, z), r: r * 0.9, tags: new Set(['rock']) });
    out.lizardRocks.push({ x, y: y + r * 0.42, z, r });
  }

  for (const g of out.groups) g.finalize();
  out.counts = Object.fromEntries(out.groups.map((g) => [g.name + (g.parts[0].geo.id % 7), g.N]));
  out.total = out.groups.reduce((a, g) => a + g.N, 0);
  out.refresh = (cam, force) => { for (const g of out.groups) g.refresh(cam, force); };
  out.setVisible = (b) => { for (const g of out.groups) g.setVisible(b); };
  return out;
}
