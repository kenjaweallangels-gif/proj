// Пасть Шай-Хулуда: круглая «миноговая» воронка. Голова — тупой цилиндр (продолжение тела), закрытая пасть — выпуклый купол
// со складками-«кошельком»; раскрываясь, губное кольцо расширяется (диафрагма), открывая концентрические кольца
// изогнутых внутрь кристаллических клыков (сотни, крупные снаружи — мельче в глубине), тёмную глотку и бахрому фильтрующих нитей.
//
// Геометрия: поверхность вращения по профилю (ρ, z) ↔ угол θ. Профиль — Catmull-Rom по 21 контрольной точке, два набора (закрытая/открытая),
// между ними морфинг по раскрытию с задержкой по глубине (губы раскрываются первыми, глотка — последней).
// Все размеры — в метрах при масштабе головы 1 (RADIUS = 20); масштаб головы (headScale) накладывает группа head.
import * as THREE from 'three';
import { RADIUS } from './spine.js';
import { patchChitin, patchTeeth } from './shaders.js';

export const HEAD_LEN = 12;                // от основания головы до гребня губ (открыто), м
const NCTRL = 21;
const OPEN_PTS = [
  [20.6, -8], [20.6, -2], [20.4, 1.5], [19.8, 3.8], [18.8, 5.4], [17.2, 6.2], [15.4, 5.9], [14.0, 4.6], [13.2, 2.8], [12.9, 0.5],
  [12.7, -2.5], [12.2, -6], [11.4, -10], [10.2, -14.5], [8.8, -19], [7.2, -24], [5.4, -29], [3.4, -34], [1.6, -39], [0.4, -44], [0.1, -48],
];
const CLOSED_PTS = [
  [20.6, -8], [20.6, -2], [20.4, 1.5], [19.6, 4.0], [18.0, 6.0], [16.0, 7.4], [13.6, 8.6], [11.2, 9.6], [8.8, 10.3], [6.6, 10.8],
  [4.6, 11.1], [3.0, 11.3], [1.8, 11.4], [0.9, 11.45], [0.4, 11.47], [0.2, 11.4], [0.15, 11.35], [0.12, 11.3], [0.1, 11.25], [0.1, 11.2], [0.1, 11.15],
];
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function resample(pts, n) {
  const c = new THREE.CatmullRomCurve3(pts.map(([r, z]) => new THREE.Vector3(r, z, 0)), false, 'catmullrom', 0.5);
  const out = new Float32Array(n * 2), v = new THREE.Vector3();
  for (let i = 0; i < n; i++) { c.getPoint(i / (n - 1), v); out[i * 2] = v.x; out[i * 2 + 1] = v.y; }
  return out;
}

/** Правило раскрытия: степень открытия точки профиля (u 0..1) при общем открытии `open`. */
function irisE(u, open) {
  const k = u * (NCTRL - 1);
  const delay = 0.45 * sm(4, 20, k);
  return sm(delay, delay + 0.5, open);
}

/** Изогнутый клык: конус по оси +y длиной 1, изгиб к +x (крючок), основание r0. */
function fangGeometry(r0, bend, nSeg = 5, nRad = 6, taper = 0.9) {
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= nSeg; j++) {
    const t = j / nSeg, r = r0 * Math.pow(1 - t, taper) + (j === nSeg ? 0 : 0.004);
    const cx = bend * t * t, cy = t;
    for (let i = 0; i <= nRad; i++) {
      const a = (i / nRad) * Math.PI * 2;
      pos.push(cx + Math.cos(a) * r, cy, Math.sin(a) * r);
      uv.push(i / nRad, t);
    }
  }
  for (let j = 0; j < nSeg; j++) for (let i = 0; i < nRad; i++) {
    const a = j * (nRad + 1) + i, b = a + 1, c = a + nRad + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) {
    const x = n.getX(i), y = n.getY(i), z = n.getZ(i);
    if (!(x * x + y * y + z * z > 1e-8) || !Number.isFinite(x + y + z)) n.setXYZ(i, 0, 1, 0);
  }
  return g;
}

export class Maw {
  constructor(U, cfg, rand) {
    this.U = U; this.cfg = cfg;
    this.group = new THREE.Group(); this.group.name = 'WormMaw';
    this.open = -1;
    this.ns = cfg.hq ? 84 : 48; this.na = cfg.hq ? 112 : 64;
    this.O = resample(OPEN_PTS, this.ns); this.C = resample(CLOSED_PTS, this.ns);
    this.rimZ = 6.2; this.rimR = 17.2;

    // длина дуги по открытому профилю: продолжение шкалы плит тела (s = 0 на уровне z = 0 внешней стенки)
    const arc = new Float32Array(this.ns); let s0 = 0;
    for (let i = 1; i < this.ns; i++) {
      arc[i] = arc[i - 1] + Math.hypot(this.O[i * 2] - this.O[(i - 1) * 2], this.O[i * 2 + 1] - this.O[(i - 1) * 2 + 1]);
      if (s0 === 0 && this.O[i * 2 + 1] >= 0) s0 = arc[i];
    }
    const nv = this.ns * (this.na + 1);
    this.pos = new Float32Array(nv * 3); this.uv = new Float32Array(nv * 2); this.pet = new Float32Array(nv * 2);
    for (let i = 0; i < this.ns; i++) for (let j = 0; j <= this.na; j++) {
      const k = i * (this.na + 1) + j, th = (j / this.na) * Math.PI * 2;
      this.uv[k * 2] = -(arc[i] - s0); this.uv[k * 2 + 1] = th - Math.PI / 2;
      this.pet[k * 2] = i / (this.ns - 1); this.pet[k * 2 + 1] = 1;
    }
    const idx = [];
    for (let i = 0; i < this.ns - 1; i++) for (let j = 0; j < this.na; j++) {
      const a = i * (this.na + 1) + j, b = a + 1, c = a + this.na + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2));
    this.geo.setAttribute('aPet', new THREE.BufferAttribute(this.pet, 2));
    this.geo.setIndex(idx);
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -10), 70);

    this.mat = patchChitin(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8, metalness: 0, side: THREE.DoubleSide }), 3, U, cfg.hq);
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
    this.rebuild(0);
    // ориентация: нормаль на гребне губ должна смотреть вперёд (+z)
    const kc = Math.round(0.26 * (this.ns - 1)) * (this.na + 1);
    if (this.geo.attributes.normal.getZ(kc) < 0) {
      const ix = this.geo.index.array;
      for (let k = 0; k < ix.length; k += 3) { const t = ix[k + 1]; ix[k + 1] = ix[k + 2]; ix[k + 2] = t; }
      this.geo.index.needsUpdate = true;
      this.rebuild(0, true);
    }

    // клыки: кольца (u — позиция на профиле, n — клыков, len — длина, м, in — наклон внутрь 0..1)
    const sc = cfg.teethScale ?? 1;
    const rings = [
      { u: 9.0 / 20, n: 84, len: 2.6, in: 0.85, w: 0.9 },
      { u: 10.0 / 20, n: 58, len: 7.6, in: 0.62, w: 1.0 },
      { u: 11.2 / 20, n: 52, len: 6.8, in: 0.6, w: 1.0 },
      { u: 12.4 / 20, n: 46, len: 5.9, in: 0.58, w: 1.0 },
      { u: 13.6 / 20, n: 40, len: 5.1, in: 0.56, w: 1.0 },
      { u: 14.9 / 20, n: 34, len: 4.2, in: 0.54, w: 1.0 },
      { u: 16.2 / 20, n: 28, len: 3.4, in: 0.52, w: 0.95 },
      { u: 17.5 / 20, n: 22, len: 2.7, in: 0.5, w: 0.9 },
      { u: 18.6 / 20, n: 16, len: 2.0, in: 0.5, w: 0.9 },
    ].map((r) => ({ ...r, n: Math.max(6, Math.round(r.n * sc)) }));
    this.teethMat = patchTeeth(new THREE.MeshStandardMaterial({ color: '#e9dfc8', roughness: 0.28, metalness: 0.05 }), U);
    this.teeth = new Fangs(this, rings, fangGeometry(0.16, 0.42, 5, 6), this.teethMat, rand, true);
    this.group.add(this.teeth.mesh);
    // бахрома фильтрующих нитей в глубине глотки (барабанная «китовая ус»)
    const nF = cfg.hq ? 150 : 70;
    const fil = [{ u: 15.5 / 20, n: Math.round(nF * 0.4), len: 7.5, in: 0.25, w: 0.5 }, { u: 17 / 20, n: Math.round(nF * 0.35), len: 8.5, in: 0.2, w: 0.5 }, { u: 18.3 / 20, n: Math.round(nF * 0.25), len: 9.5, in: 0.15, w: 0.5 }];
    this.filMat = new THREE.MeshStandardMaterial({ color: '#8a6a52', roughness: 0.55, metalness: 0, emissive: '#2a1208', emissiveIntensity: 0.6 });
    this.fil = new Fangs(this, fil, fangGeometry(0.075, 0.9, 5, 5, 0.6), this.filMat, rand, false);
    this.group.add(this.fil.mesh);
  }

  /** Профиль (ρ, z) при раскрытии `open` в дробной позиции f (индекс сэмпла). */
  at(f, open, out) {
    const n = this.ns, i = Math.min(n - 2, Math.max(0, Math.floor(f))), t = Math.min(1, f - i);
    const e0 = irisE(i / (n - 1), open), e1 = irisE((i + 1) / (n - 1), open);
    const O = this.O, C = this.C;
    const r0 = C[i * 2] + (O[i * 2] - C[i * 2]) * e0, z0 = C[i * 2 + 1] + (O[i * 2 + 1] - C[i * 2 + 1]) * e0;
    const r1 = C[i * 2 + 2] + (O[i * 2 + 2] - C[i * 2 + 2]) * e1, z1 = C[i * 2 + 3] + (O[i * 2 + 3] - C[i * 2 + 3]) * e1;
    out.r = r0 + (r1 - r0) * t; out.z = z0 + (z1 - z0) * t;
    out.dr = r1 - r0; out.dz = z1 - z0;
    return out;
  }

  /** Радиус внутренней стенки воронки (м, при масштабе головы 1) на высоте z относительно основания головы; 0 — выше гребня губ/глубже дна. */
  holeRadius(zLocal) {
    const open = Math.max(this.open, 0), P = this._hp || (this._hp = { r: 0, z: 0, dr: 0, dz: 0 });
    const i0 = Math.round(9 / 20 * (this.ns - 1));
    let pr = -1, pz = 0;
    for (let i = i0; i < this.ns; i += 1) {
      this.at(i, open, P);
      if (P.z <= zLocal) {
        if (pr < 0) return P.r;
        const t = (pz - zLocal) / Math.max(1e-6, pz - P.z);
        return pr + (P.r - pr) * t;
      }
      pr = P.r; pz = P.z;
    }
    return 0;
  }

  rebuild(open, keepNormals = false) {
    const { ns, na, O, C, pos, pet } = this;
    for (let i = 0; i < ns; i++) {
      const u = i / (ns - 1), e = irisE(u, open);
      const r = C[i * 2] + (O[i * 2] - C[i * 2]) * e, z = C[i * 2 + 1] + (O[i * 2 + 1] - C[i * 2 + 1]) * e;
      const puck = (1 - e) * sm(0.3, 3, r) * (1 - sm(13, 18, r));
      const crest = sm(2, 5, i) * (1 - sm(8, 11, i));              // неровность кромки губ
      const shade = z > -1.5 ? 1 : Math.max(0.03, Math.exp((z + 1.5) * 0.15));      // глотка быстро темнеет вглубь
      for (let j = 0; j <= na; j++) {
        const th = (j / na) * Math.PI * 2, k = i * (na + 1) + j;
        const pk = Math.pow(0.5 + 0.5 * Math.cos(7 * th + 0.8 * Math.sin(2 * th)), 4);
        const rr = r * (1 + crest * (0.028 * Math.sin(5 * th + 1.3) + 0.014 * Math.sin(11 * th)));
        const zz = z - puck * 1.5 * pk + crest * 0.45 * Math.sin(3 * th + 1.0);
        pos[k * 3] = rr * Math.cos(th); pos[k * 3 + 1] = rr * Math.sin(th); pos[k * 3 + 2] = zz;
        pet[k * 2 + 1] = shade;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aPet.needsUpdate = true;
    this.geo.attributes.uv.needsUpdate = true;
    this.geo.computeVertexNormals();
    const n = this.geo.attributes.normal;
    for (let i = 0; i < ns; i++) {                                // шов θ=0/2π и вырожденные нормали у оси
      const a = i * (na + 1), b = a + na;
      const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b);
      const l = Math.hypot(x, y, z);
      if (l > 1e-6) { n.setXYZ(a, x / l, y / l, z / l); n.setXYZ(b, x / l, y / l, z / l); }
    }
    for (let i = 0; i < n.count; i++) {
      const x = n.getX(i), y = n.getY(i), z = n.getZ(i);
      if (!(x * x + y * y + z * z > 1e-8) || !Number.isFinite(x + y + z)) n.setXYZ(i, 0, 0, 1);
    }
    n.needsUpdate = true;
    void keepNormals;
  }

  setOpen(v) {
    v = Math.min(1, Math.max(0, v));
    if (Math.abs(v - this.open) < 0.002) return false;
    this.open = v; this.U.uOpen.value = v;
    this.rebuild(v);
    const vis = v > 0.03;
    this.teeth.mesh.visible = vis; this.fil.mesh.visible = vis;
    if (vis) { this.teeth.update(v); this.fil.update(v); }
    return true;
  }

  /** Подстроить внутренние материалы под шкалу качества. */
  setQualityMats(cfg) {
    if (cfg.hq) this.mat.defines.WORM_HQ = 1; else delete this.mat.defines.WORM_HQ;
    this.mat.customProgramCacheKey = () => `worm3${cfg.hq ? 'h' : 'l'}2`;
    this.mat.needsUpdate = true;
  }
}

/** Набор клыков (или нитей) по кольцам на внутренней поверхности воронки. Матрицы пересчитываются на CPU при изменении раскрытия. */
class Fangs {
  constructor(maw, rings, geo, mat, rand, withDepth) {
    this.maw = maw; this.rings = rings;
    let total = 0; for (const r of rings) total += r.n;
    this.total = total;
    this.th = new Float32Array(total); this.sz = new Float32Array(total); this.jt = new Float32Array(total); this.ringOf = new Uint8Array(total);
    const depth = new Float32Array(total);
    let q = 0;
    rings.forEach((r, k) => {
      for (let i = 0; i < r.n; i++, q++) {
        this.th[q] = ((i + 0.5 * (k % 2)) / r.n) * Math.PI * 2 + (rand() - 0.5) * 0.5 / r.n * 2;
        this.sz[q] = 0.8 + rand() * 0.4; this.jt[q] = rand() - 0.5; this.ringOf[q] = k;
        depth[q] = withDepth ? (k / Math.max(1, rings.length - 1)) * 0.9 : 0.5;
      }
    });
    geo.setAttribute('aDepth', new THREE.InstancedBufferAttribute(depth, 1));
    this.mesh = new THREE.InstancedMesh(geo, mat, total);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    if (withDepth) {                                          // клыки: слоновая кость с разбросом оттенка (жёлтый налёт, серость)
      const c = new THREE.Color();
      for (let q = 0; q < total; q++) { c.setRGB(0.62 + 0.38 * rand(), 0.58 + 0.34 * rand(), 0.48 + 0.3 * rand()); this.mesh.setColorAt(q, c); }
      this.mesh.instanceColor.needsUpdate = true;
    }
    this._p = { r: 0, z: 0, dr: 0, dz: 0 };
    this._m = new THREE.Matrix4(); this._pos = new THREE.Vector3(); this._d = new THREE.Vector3(); this._x = new THREE.Vector3(); this._z = new THREE.Vector3();
  }

  update(open) {
    const { maw, rings, th, sz, jt, ringOf, mesh } = this;
    const P = this._p, pos = this._pos, d = this._d, x = this._x, zax = this._z, m = this._m, e = m.elements;
    const grow = sm(0.1, 0.55, open);
    for (let q = 0; q < this.total; q++) {
      const R = rings[ringOf[q]];
      maw.at(R.u * (maw.ns - 1), open, P);
      const c = Math.cos(th[q]), s = Math.sin(th[q]);
      // направление: внутрь (к оси) и назад (в глотку), с лёгкой закруткой; наклон вдоль профиля
      const tl = Math.hypot(P.dr, P.dz) || 1;
      const inw = R.in, back = 1 - R.in * 0.35;
      d.set(-c * inw + (-s) * 0.16 * (ringOf[q] % 2 ? 1 : -1) + jt[q] * 0.2 * c, -s * inw + c * 0.16 * (ringOf[q] % 2 ? 1 : -1) + jt[q] * 0.2 * s, -back * 0.75 + (P.dz / tl) * 0.1);
      d.normalize();
      // ось крючка: назад (−z), ортогонально направлению клыка
      x.set(0, 0, -1).addScaledVector(d, d.z);
      if (x.lengthSq() < 1e-6) x.set(c, s, 0); else x.normalize();
      zax.crossVectors(x, d);
      const len = R.len * sz[q] * grow, w = len;       // равномерный масштаб: пропорции задаёт геометрия
      pos.set(c * P.r, s * P.r, P.z);
      e[0] = x.x * w; e[1] = x.y * w; e[2] = x.z * w; e[3] = 0;
      e[4] = d.x * w; e[5] = d.y * w; e[6] = d.z * w; e[7] = 0;
      e[8] = zax.x * w * R.w; e[9] = zax.y * w * R.w; e[10] = zax.z * w * R.w; e[11] = 0;
      e[12] = pos.x; e[13] = pos.y; e[14] = pos.z; e[15] = 1;
      mesh.setMatrixAt(q, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }
}

export { RADIUS };
