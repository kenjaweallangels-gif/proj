// Позвоночник червя: история пути головы («поезд») → 91 точка тела через 4 м.
// Тело строится из истории: каждое кольцо лежит там, где несколько секунд назад прошла голова.
import * as THREE from 'three';

export const SEG_COUNT = 90;
export const SEG_LEN = 4;
export const N_PTS = SEG_COUNT + 1;      // 0 — основание головы, 90 — кончик хвоста
export const TEX_W = 96;
export const LENGTH = SEG_COUNT * SEG_LEN;
export const RADIUS = 20;

const STEP = 1.0;                         // шаг истории, м
const CAP = 560;                          // 560 м истории

const sm = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

export class Spine {
  constructor() {
    this.pts = new Float32Array(CAP * 3);
    this.w = 0;                           // индекс следующей записи
    this.last = new THREE.Vector3();
    this.hp = new THREE.Vector3();
    this.e = 0;
    this.P = new Float32Array(TEX_W * 3);
    this.Nrm = new Float32Array(TEX_W * 3);
    this.Tan = new Float32Array(TEX_W * 3);
    this.RS = new Float32Array(TEX_W).fill(1);
    // Текстура: строка 0 — xyz + масштаб радиуса, строка 1 — нормаль
    this.data = new Float32Array(TEX_W * 2 * 4);
    // Начальная поза — прямая линия (а не нули): шейдеры никогда не видят вырожденный позвоночник (normalize(0) → NaN).
    for (let i = 0; i < TEX_W; i++) {
      const k = Math.min(i, N_PTS - 1);
      this.data[i * 4] = 0; this.data[i * 4 + 1] = -200; this.data[i * 4 + 2] = k * SEG_LEN; this.data[i * 4 + 3] = 1;
      const o = (TEX_W + i) * 4; this.data[o] = 0; this.data[o + 1] = 1; this.data[o + 2] = 0;
    }
    this.tex = new THREE.DataTexture(this.data, TEX_W, 2, THREE.RGBAFormat, THREE.FloatType);
    this.tex.minFilter = this.tex.magFilter = THREE.NearestFilter;
    this.tex.generateMipmaps = false;
    this.tex.needsUpdate = true;
    this.waveAmp = 0;                     // м, вертикальное «дыхание»
    this.headLift = 0;                    // м, на сколько приподнята голова (затухает вдоль тела на liftLen)
    this.liftLen = 70;
    this.breath = 0;                      // 0..1, медленная пульсация радиуса (покой)
    this.bad = 0;                         // счётчик подавленных NaN (диагностика)
    this._t = new THREE.Vector3();
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3();
    this._n = new THREE.Vector3(); this._bb = new THREE.Vector3();
  }

  /** Сброс: голова в headPos, тело тянется прямо назад по -dir (x,z), следуя рельефу на глубине depth. */
  reset(headPos, dirX, dirZ, groundFn, depth) {
    const l = Math.hypot(dirX, dirZ) || 1; dirX /= l; dirZ /= l;
    this.hp.copy(headPos);
    this.last.copy(headPos);
    this.e = 0;
    for (let i = 0; i < CAP; i++) {
      const k = CAP - 1 - i;              // запись i = «k шагов назад»; самая новая — индекс CAP-1
      const x = headPos.x - dirX * k * STEP, z = headPos.z - dirZ * k * STEP;
      const yg = groundFn(x, z) - depth;
      const y = k < 40 ? headPos.y + (yg - headPos.y) * (k / 40) : yg;
      this.pts[i * 3] = x; this.pts[i * 3 + 1] = y; this.pts[i * 3 + 2] = z;
    }
    this.w = 0;                           // следующая запись затрёт самую старую
  }

  /** Передвинуть голову. */
  push(p) {
    this.hp.copy(p);
    let e = this.hp.distanceTo(this.last);
    let guard = 0;
    while (e >= STEP && guard++ < 64) {
      this.last.lerp(this.hp, STEP / e);
      const o = this.w * 3;
      this.pts[o] = this.last.x; this.pts[o + 1] = this.last.y; this.pts[o + 2] = this.last.z;
      this.w = (this.w + 1) % CAP;
      e = this.hp.distanceTo(this.last);
    }
    if (guard >= 64) { this.last.copy(this.hp); e = 0; }
    this.e = e;
  }

  _at(k, out) { // k шагов назад от последней сохранённой точки
    const kk = Math.min(Math.max(k, 0), CAP - 2.001);
    const i = Math.floor(kk), t = kk - i;
    const a = ((this.w - 1 - i) % CAP + CAP) % CAP, b = ((this.w - 2 - i) % CAP + CAP) % CAP;
    const p = this.pts;
    return out.set(p[a * 3] + (p[b * 3] - p[a * 3]) * t, p[a * 3 + 1] + (p[b * 3 + 1] - p[a * 3 + 1]) * t, p[a * 3 + 2] + (p[b * 3 + 2] - p[a * 3 + 2]) * t);
  }

  /** Точка пути на расстоянии d назад от головы. */
  pointAt(d, out) {
    if (d <= this.e) {
      const t = this.e > 1e-6 ? d / this.e : 0;
      return out.copy(this.hp).lerp(this.last, t);
    }
    return this._at(d - this.e, out);
  }

  /** Пересчитать 91 точку, нормали (параллельный перенос от хвоста) и текстуру. */
  compute(time, liveliness = 1) {
    const P = this.P, N = this.Nrm, T = this.Tan, RS = this.RS;
    const v = this._t;
    for (let i = 0; i < N_PTS; i++) {
      this.pointAt(i * SEG_LEN, v);
      if (!(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z))) { v.copy(this.hp); this.bad++; }
      const s = i * SEG_LEN;
      const lf = this.headLift !== 0 ? this.headLift * (1 - sm(0, this.liftLen, s)) : 0;
      P[i * 3] = v.x; P[i * 3 + 1] = v.y + lf; P[i * 3 + 2] = v.z;
    }
    for (let i = 0; i < N_PTS; i++) {
      const a = Math.max(i - 1, 0), b = Math.min(i + 1, N_PTS - 1);
      const tx = P[a * 3] - P[b * 3], ty = P[a * 3 + 1] - P[b * 3 + 1], tz = P[a * 3 + 2] - P[b * 3 + 2];
      const l = Math.hypot(tx, ty, tz) || 1; T[i * 3] = tx / l; T[i * 3 + 1] = ty / l; T[i * 3 + 2] = tz / l;
    }
    // перенос нормали от хвоста к голове (без «скручивания» вокруг оси)
    let nx = 0, ny = 1, nz = 0;
    for (let i = N_PTS - 1; i >= 0; i--) {
      const tx = T[i * 3], ty = T[i * 3 + 1], tz = T[i * 3 + 2];
      const d = nx * tx + ny * ty + nz * tz;
      nx -= tx * d; ny -= ty * d; nz -= tz * d;
      let l = Math.hypot(nx, ny, nz);
      if (l < 1e-4) { nx = 1; ny = 0; nz = 0; l = 1; }
      nx /= l; ny /= l; nz /= l;
      N[i * 3] = nx; N[i * 3 + 1] = ny; N[i * 3 + 2] = nz;
    }
    // «дыхание»: бегущая волна по телу вдоль нормали
    const A = this.waveAmp * liveliness;
    for (let i = 0; i < N_PTS; i++) {
      const s = i * SEG_LEN;
      const w = A * Math.sin(s * 0.07 - time * 1.1) * Math.min(1, s / 40);
      P[i * 3] += N[i * 3] * w; P[i * 3 + 1] += N[i * 3 + 1] * w; P[i * 3 + 2] += N[i * 3 + 2] * w;
      { const u = Math.min(1, Math.max(0, (LENGTH - s) / 70)); RS[i] = Math.max(0.03, Math.sqrt(1 - (1 - u) * (1 - u))); }
      if (this.breath > 0) RS[i] *= 1 + this.breath * 0.022 * Math.sin(s * 0.055 - time * 0.85) * Math.min(1, s / 25);
    }
    const d = this.data;
    for (let i = 0; i < TEX_W; i++) {
      const k = Math.min(i, N_PTS - 1);
      d[i * 4] = P[k * 3]; d[i * 4 + 1] = P[k * 3 + 1]; d[i * 4 + 2] = P[k * 3 + 2]; d[i * 4 + 3] = RS[k];
      const o = (TEX_W + i) * 4;
      d[o] = N[k * 3]; d[o + 1] = N[k * 3 + 1]; d[o + 2] = N[k * 3 + 2]; d[o + 3] = 0;
    }
    this.tex.needsUpdate = true;
  }

  /** Каркас в точке s (м от головы) — как в шейдере: Catmull-Rom. T смотрит к голове. */
  frameAt(s, P, T, N) {
    const f = Math.min(Math.max(s, 0), LENGTH - 0.001) / SEG_LEN;
    const i = Math.floor(f), t = f - i;
    const p = this.P;
    const g = (k, c) => p[Math.min(Math.max(k, 0), N_PTS - 1) * 3 + c];
    let dx = 0, dy = 0, dz = 0;
    for (let c = 0; c < 3; c++) {
      const p0 = g(i - 1, c), p1 = g(i, c), p2 = g(i + 1, c), p3 = g(i + 2, c);
      const t2 = t * t, t3 = t2 * t;
      P.setComponent(c, 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3));
      const d = 0.5 * ((-p0 + p2) + 2 * (2 * p0 - 5 * p1 + 4 * p2 - p3) * t + 3 * (-p0 + 3 * p1 - 3 * p2 + p3) * t2);
      if (c === 0) dx = d; else if (c === 1) dy = d; else dz = d;
    }
    T.set(-dx, -dy, -dz).normalize();
    const n = this.Nrm;
    const i0 = Math.min(i, N_PTS - 1), i1 = Math.min(i + 1, N_PTS - 1);
    N.set(n[i0 * 3] + (n[i1 * 3] - n[i0 * 3]) * t, n[i0 * 3 + 1] + (n[i1 * 3 + 1] - n[i0 * 3 + 1]) * t, n[i0 * 3 + 2] + (n[i1 * 3 + 2] - n[i0 * 3 + 2]) * t);
    N.addScaledVector(T, -N.dot(T)).normalize();
    return P;
  }

  /** Радиус тела в s (то же, что в шейдере, без макрошума). */
  radiusAt(s, a) {
    const ring = s / SEG_LEN, f = ring - Math.floor(ring);
    const ds = Math.min(f, 1 - f);
    const stp = -1 + 1.9 * sm(0, 0.7, f) + 0.75 * sm(0.58, 0.84, f) - 2.65 * sm(0.88, 1, f) - 0.9 * Math.exp(-(ds * ds) / (0.03 * 0.03));
    const cell = a * 36 / (Math.PI * 2) + 0.5 * Math.floor(ring);
    const g = cell - Math.floor(cell);
    const dome = 1 - Math.pow(Math.abs(2 * g - 1), 3);
    const i = Math.max(0, Math.min(N_PTS - 2, Math.floor(s / SEG_LEN)));
    const rs = this.RS[i] + (this.RS[i + 1] - this.RS[i]) * (s / SEG_LEN - i);
    return (RADIUS + stp + 0.75 * dome + 0.32 * Math.pow(dome, 7)) * rs;
  }

  /** Точка на поверхности: s вдоль тела, a — угол вокруг (0 — «верх», вектор N). Возвращает позицию и наружную нормаль. */
  surfacePoint(s, a, outP, outN, extra = 0) {
    const P = this._a, T = this._b, N = this._n, B = this._bb;
    this.frameAt(s, P, T, N);
    B.crossVectors(T, N);
    outN.copy(N).multiplyScalar(Math.cos(a)).addScaledVector(B, Math.sin(a));
    outP.copy(P).addScaledVector(outN, this.radiusAt(s, a) + extra);
    return outP;
  }
}
