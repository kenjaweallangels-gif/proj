// Меш червя: тело-труба (деформация по позвоночнику на GPU), голова — тупой цилиндр с круглой миноговой пастью (maw.js).
// Снаряжение наездников (крючья творца, канаты, сёдла) и фигуры — в gear.js.
import * as THREE from 'three';
import { LENGTH, RADIUS, N_PTS, SEG_LEN } from './spine.js';
import { patchChitin, patchSpineBack } from './shaders.js';
import { Maw, HEAD_LEN } from './maw.js';

export { HEAD_LEN };

/**
 * Шкала качества: maxRows — предел рядов сетки тела (ряды распределяются вдоль тела по LOD: плотно у камеры, редко у дальнего конца и под песком),
 * na — вершин по окружности, hq — тяжёлые детали шейдера (трещины, шрамы, наросты), teeth — кольца зубов.
 */
export const QUALITY = {
  low: { ns: 420, na: 56, hq: false, teethScale: 0.55 },
  med: { ns: 800, na: 100, hq: true, teethScale: 1 },
  high: { ns: 1200, na: 136, hq: true, teethScale: 1.3 },
};
export const QUALITY_ORDER = ['low', 'med', 'high'];

/** LOD вдоль тела: блоки по BLOCK м, шаг рядов по расстоянию до камеры (до границы, м → шаг, м). Закопанный блок — один ряд. */
export const LOD = {
  block: 8,
  steps: [[70, 0.5], [170, 1], [450, 2], [1e9, 4]],
  buriedStep: 8,
  recheck: 0.2,                         // с: как часто пересматривать уровни
};

function tubeGeometry(maxRows, na) {
  const nv = (maxRows + 1) * (na + 1);
  const pos = new Float32Array(nv * 3);
  const uv = new Float32Array(nv * 2);
  const idx = new Uint32Array(maxRows * na * 6);
  let k = 0;
  for (let i = 0; i < maxRows; i++) {
    for (let j = 0; j < na; j++) {
      const a = i * (na + 1) + j, b = a + 1, c = a + (na + 1), d = c + 1;
      idx[k++] = a; idx[k++] = c; idx[k++] = b;
      idx[k++] = b; idx[k++] = c; idx[k++] = d;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2).setUsage(THREE.DynamicDrawUsage));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  g.boundingBox = new THREE.Box3(new THREE.Vector3(-1e5, -1e5, -1e5), new THREE.Vector3(1e5, 1e5, 1e5));
  g.userData.maxRows = maxRows; g.userData.na = na;
  return g;
}

export class WormBody {
  constructor(game, U, spine, quality = 'med') {
    this.game = game; this.U = U; this.spine = spine;
    const cfg = QUALITY[quality] || QUALITY.med;
    this.cfg = cfg; this.quality = QUALITY[quality] ? quality : 'med';
    this._rand = (() => { let a = 1517; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; })();

    this.group = new THREE.Group();
    this.group.name = 'Worm';

    // Тело
    this.bodyMat = patchChitin(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8, metalness: 0 }), 0, U, cfg.hq);
    this.LOD = LOD;                       // доступ для тестов (пороги можно менять в рантайме)
    this.lodKey = new Uint8Array(Math.ceil(LENGTH / LOD.block)); this.lodT = 0; this.rows = 0; this.rowsAvg = 0;
    this.camPos = new THREE.Vector3(); this._lodCam = new THREE.Vector3(1e9, 0, 0); this._lodDirty = true;
    this.tube = new THREE.Mesh(tubeGeometry(cfg.ns, cfg.na), this.bodyMat);
    this.tube.frustumCulled = false;
    this.tube.name = 'WormBody';
    this.group.add(this.tube);
    const backMat = patchSpineBack(new THREE.MeshBasicMaterial({ color: '#2a2219', side: THREE.BackSide }), U);
    this.tubeBack = new THREE.Mesh(this.tube.geometry, backMat);
    this.tubeBack.frustumCulled = false;
    this.group.add(this.tubeBack);

    // Голова
    this.head = new THREE.Group();
    this.head.name = 'WormHead';
    this.head.matrixAutoUpdate = false;
    this.group.add(this.head);
    this.maw = new Maw(U, cfg, this._rand);
    this.head.add(this.maw.group);
    this.open = -1;
    this.headScale = 1;            // раструб пасти (пожиратель): голова крупнее, шея расширяется (spine.flare)
    this.setOpen(0);
    this._P = new THREE.Vector3(); this._T = new THREE.Vector3(); this._N = new THREE.Vector3(); this._B = new THREE.Vector3();
    this._m = new THREE.Matrix4();
    this._bx = new THREE.Vector3(); this._by = new THREE.Vector3(); this._bz = new THREE.Vector3();
  }

  /** Шкала качества: 'low' | 'med' | 'high'. Пересоздаёт сетку тела и переключает тяжёлые детали шейдера. */
  setQuality(name) {
    if (!QUALITY[name] || name === this.quality) return false;
    const cfg = QUALITY[name];
    const old = this.tube.geometry;
    const geo = tubeGeometry(cfg.ns, cfg.na);
    this.tube.geometry = geo; this.tubeBack.geometry = geo;
    old.dispose();
    this._lodDirty = true; this.cfg = cfg; this.lodKey.fill(255);
    for (const m of [this.bodyMat]) {
      if (cfg.hq) m.defines.WORM_HQ = 1; else delete m.defines.WORM_HQ;
      m.customProgramCacheKey = ((mode) => () => `worm${mode}${cfg.hq ? 'h' : 'l'}2`)(m.defines.WORM_MODE);
      m.needsUpdate = true;
    }
    this.maw.setQualityMats(cfg);
    this.cfg = cfg; this.quality = name;
    return true;
  }

  setOpen(v) {
    v = Math.min(1, Math.max(0, v));
    if (Math.abs(v - this.open) < 0.002) return;
    this.open = v;
    this.maw.setOpen(v);
  }

  /** Поставить голову по каркасу на s=0. */
  update() {
    const P = this._P, T = this._T, N = this._N, B = this._B;
    this.spine.frameAt(0, P, T, N);
    B.crossVectors(T, N);
    // локальные оси головы: x = -B, y = N, z = T
    const hs = this.headScale;
    this._bx.copy(B).multiplyScalar(-hs); this._by.copy(N).multiplyScalar(hs); this._bz.copy(T).multiplyScalar(hs);
    this._m.makeBasis(this._bx, this._by, this._bz).setPosition(P);
    this.head.matrix.copy(this._m);
    this.head.matrixWorldNeedsUpdate = true;
    this.head.updateMatrixWorld(true);
    this._fitBounds();
    this.updateLod();
  }

  /**
   * LOD сетки тела: ряды (поперечные кольца вершин) раскладываются по длине неравномерно. Блок 8 м → шаг рядов по расстоянию до камеры;
   * блок целиком под песком — один ряд. Перестраивается не чаще LOD.recheck и только при смене уровней блоков; границы блоков — общие ряды (щелей нет).
   */
  updateLod(force = false) {
    const g = this.game;
    this.lodT -= g.dt || 0.016;
    if (this.lodT > 0 && !force && !this._lodDirty) return;
    this.lodT = LOD.recheck;
    const sp = this.spine, P = sp.P, EX = sp.EX, cam = this.game.camera.matrixWorld.elements;
    const cx = cam[12], cy = cam[13], cz = cam[14];
    const nb = this.lodKey.length, per = LOD.block / SEG_LEN;           // точек позвоночника на блок
    const maxRows = this.cfg.ns;
    let scale = 1, rows = 0;
    const key = this._key || (this._key = new Uint8Array(nb));
    for (let tries = 0; tries < 6; tries++) {
      rows = 0;
      for (let b = 0; b < nb; b++) {
        const i0 = Math.floor(b * per), i1 = Math.min(N_PTS - 1, Math.ceil((b + 1) * per));
        let ex = 0, dmin = 1e18;
        for (let i = Math.max(0, i0 - 1); i <= Math.min(N_PTS - 1, i1 + 1); i++) {
          if (EX[i]) ex = 1;
          const dx = P[i * 3] - cx, dy = P[i * 3 + 1] - cy, dz = P[i * 3 + 2] - cz;
          const d = dx * dx + dy * dy + dz * dz;
          if (d < dmin) dmin = d;
        }
        let k;
        if (!ex) k = 255;
        else {
          const d = (Math.sqrt(dmin) - RADIUS) / scale;
          k = 0; while (k < LOD.steps.length - 1 && d >= LOD.steps[k][0]) k++;
        }
        key[b] = k;
        rows += k === 255 ? 1 : Math.round(LOD.block / LOD.steps[k][1]);
      }
      if (rows + 1 <= maxRows) break;
      scale *= 0.7;                                                      // не влезаем в предел: пороги ближе к камере
    }
    let same = !force && !this._lodDirty;
    if (same) for (let b = 0; b < nb; b++) if (key[b] !== this.lodKey[b]) { same = false; break; }
    this._lodDirty = false;
    if (same) return;
    this.lodKey.set(key);
    const geo = this.tube.geometry, na = geo.userData.na, uv = geo.attributes.uv.array;
    let r = 0;
    const row = (s) => { if (r > maxRows) return; const u = Math.min(1, s / LENGTH); const o = r * (na + 1) * 2; for (let j = 0; j <= na; j++) { uv[o + j * 2] = u; uv[o + j * 2 + 1] = j / na; } r++; };
    for (let b = 0; b < nb; b++) {
      const s0 = b * LOD.block, k = key[b];
      if (k === 255) { row(s0); continue; }
      const h = LOD.steps[k][1];
      for (let t = 0; t * h < LOD.block - 1e-6; t++) row(s0 + t * h);
    }
    row(LENGTH);
    this.rows = r - 1;
    geo.attributes.uv.needsUpdate = true;
    geo.setDrawRange(0, this.rows * na * 6);
  }

  /** Сфера охвата по каркасу: тело отсекается по пирамиде видимости (вершинный шейдер дорогой — вне кадра его не гоняем). */
  _fitBounds() {
    const p = this.spine.P, n = N_PTS;
    let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
    for (let i = 0; i < n; i++) {
      const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    if (!(Number.isFinite(x0 + x1 + y0 + y1 + z0 + z1))) return;
    const bs = this.tube.geometry.boundingSphere;
    bs.center.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    bs.radius = Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2 + RADIUS * this.headScale * 1.5 + 12;
    this.tube.frustumCulled = this.tubeBack.frustumCulled = true;
  }

  /** Мировая точка/направление пасти. */
  mouthWorld(outPos, outDir) {
    this.spine.frameAt(0, this._P, this._T, this._N);
    outPos.copy(this._P).addScaledVector(this._T, HEAD_LEN * 0.55);
    outDir.copy(this._T);
  }
}
