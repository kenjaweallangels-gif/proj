import { ridgeQuery } from '../core/ridge.js';

/** Зазор до основания хребта (массивы N1..S2, G): тело Ø 40 м + запас, м. */
export const RIDGE_CLEAR = 48;

// Маршрут укрощённого червя по поверхности (в плане XZ) относительно группы игрока G.
// Червь длинный (LENGTH ~1,6 км), тело лежит на пройденном пути («поезд»), поэтому путь — длинная ПРЯМАЯ и один плавный поворот к группе:
// закручивать спираль вокруг группы нельзя (тело перекрыло бы себя и замкнуло игрока в кольцо).
// Локальная рамка: f — направление движения червя на подходе, r — «право» (r = (-f.z, f.x) при осях X — восток, Z — юг); (la, lr) — вдоль f / вдоль r.
//   1) подход по прямой на расстоянии R0 слева от G (линия тела проходит мимо группы ~R0),
//   2) плавная дуга радиуса turnR вправо — к группе, на угол psi; голова останавливается в dEnd от G (60–150 м), смотря поперёк группы,
//   3) хвост пути: прямая за точкой остановки (нужна только как запас для кинематики головы).
// Тело за головой — дуга и прямой участок слева от группы: игрок видит его вдоль взгляда; ближайшая к группе точка тела ≥ ~85 м.
// Путь пересэмплирован с шагом 1 м, чтобы голова ехала по длине дуги u (м) независимо от формы.
export const PATH_DEFAULTS = {
  approach: 1300,           // м прямого подхода до начала поворота
  R0: 140,                  // боковой отступ линии подхода от группы, м
  turnR: 210,               // радиус дуги подхода, м (тело Ø 40 м гнётся мягко)
  psi: 1.22,                // рад: угол поворота к группе (~70°)
  dEnd: 100,                // м: расстояние голова ↔ группа в конце
  relaxBack: 700,           // м до начала поворота, с которых путь подправляется от препятствий (дальше — только выбор курса)
  tail: 200,                // м прямого хвоста пути после остановки
};

/**
 * Сдвинуть точки пути из препятствий и сгладить смещение. clear(x, z, extra) → [x', z'] | null — позиция головы, вытолкнутая из тел с запасом
 * radius+extra. Сначала итерации с большим запасом и размытием смещения (плавный обход), затем жёсткая проверка без запаса.
 * Возвращает максимальное смещение, м.
 */
function relaxPath(X, Z, clear, iters = 16, W = 28, extra = 26, i0 = 0) {
  const m = X.length;
  const dx = new Float32Array(m), dz = new Float32Array(m), tx = new Float32Array(m), tz = new Float32Array(m);
  const blur = (w) => {
    for (let pass = 0; pass < 2; pass++) {
      let sx = 0, sz = 0, lo = 0, hi = -1;
      for (let i = 0; i < m; i++) {
        const nl = Math.max(0, i - w), nh = Math.min(m - 1, i + w);
        while (hi < nh) { hi++; sx += dx[hi]; sz += dz[hi]; }
        while (lo < nl) { sx -= dx[lo]; sz -= dz[lo]; lo++; }
        tx[i] = sx / (nh - nl + 1); tz[i] = sz / (nh - nl + 1);
      }
      dx.set(tx); dz.set(tz);
    }
  };
  for (let it = 0; it < iters; it++) {
    let any = false;
    for (let i = i0; i < m; i++) {
      const x = X[i] + dx[i], z = Z[i] + dz[i];
      const c = clear(x, z, extra);
      if (c) { dx[i] += c[0] - x; dz[i] += c[1] - z; any = true; }
    }
    if (!any) break;
    blur(W);
  }
  for (let it = 0; it < 4; it++) {                     // жёсткая проверка без запаса + лёгкое сглаживание стыков
    let any = false;
    for (let i = i0; i < m; i++) {
      const x = X[i] + dx[i], z = Z[i] + dz[i];
      const c = clear(x, z, 0);
      if (c) { dx[i] += c[0] - x; dz[i] += c[1] - z; any = true; }
    }
    if (!any) break;
    blur(5);
  }
  let maxD = 0;
  for (let i = 0; i < m; i++) { X[i] += dx[i]; Z[i] += dz[i]; maxD = Math.max(maxD, Math.hypot(dx[i], dz[i])); }
  return maxD;
}

export class EncounterPath {
  /** @param {{x:number,z:number}} G группа  @param {number} heading курс червя на подходе, рад (atan2(dz,dx)) */
  constructor(G, heading, opts = {}) {
    const o = { ...PATH_DEFAULTS, ...opts };
    this.o = o; this.G = { x: G.x, z: G.z }; this.heading = heading;
    const fx = Math.cos(heading), fz = Math.sin(heading);
    const rx = -fz, rz = fx;
    this.f = { x: fx, z: fz }; this.r = { x: rx, z: rz };
    const raw = [];
    const pushLoc = (la, lr) => raw.push(G.x + fx * la + rx * lr, G.z + fz * la + rz * lr);
    // положение конца дуги: lr_e = -R0 + turnR (1 - cos psi); la_e подбирается так, чтобы |конец| = dEnd
    const lrE = -o.R0 + o.turnR * (1 - Math.cos(o.psi));
    const laE = Math.sqrt(Math.max(0, o.dEnd * o.dEnd - lrE * lrE));
    const a0 = laE - o.turnR * Math.sin(o.psi);
    this.a0 = a0;
    // 1) подход
    for (let l = -o.approach; l < 0; l += 2) pushLoc(a0 + l, -o.R0);
    // 2) дуга вправо
    for (let ps = 0; ps < o.psi; ps += 2 / o.turnR) pushLoc(a0 + o.turnR * Math.sin(ps), -o.R0 + o.turnR * (1 - Math.cos(ps)));
    // 3) хвост по конечному курсу
    const hx = Math.cos(o.psi), hz = Math.sin(o.psi);       // курс в (la, lr)
    for (let l = 0; l <= o.tail; l += 2) pushLoc(laE + hx * l, lrE + hz * l);
    // пересэмплирование по длине дуги, шаг 1 м
    const n = raw.length / 2;
    const cum = new Float64Array(n);
    for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(raw[i * 2] - raw[i * 2 - 2], raw[i * 2 + 1] - raw[i * 2 - 1]);
    this.len = cum[n - 1];
    const m = Math.floor(this.len) + 1;
    this.X = new Float32Array(m); this.Z = new Float32Array(m); this.Y = new Float32Array(m);
    let k = 0;
    for (let i = 0; i < m; i++) {
      while (k < n - 2 && cum[k + 1] < i) k++;
      const t = (i - cum[k]) / Math.max(1e-6, cum[k + 1] - cum[k]);
      this.X[i] = raw[k * 2] + (raw[k * 2 + 2] - raw[k * 2]) * t;
      this.Z[i] = raw[k * 2 + 1] + (raw[k * 2 + 3] - raw[k * 2 + 1]) * t;
    }
    // обход препятствий (харвестер, Коготь, валуны): clear(x, z) → [x', z'] — позиция головы, вытолкнутая из тел; смещение сглаживается
    this.avoided = o.clear ? relaxPath(this.X, this.Z, o.clear, 16, 28, 26, Math.max(0, Math.floor(o.approach - o.relaxBack))) : 0;
    for (let i = 0; i < m; i++) {
      const a = Math.max(0, i - 2), b = Math.min(m - 1, i + 2);
      this.Y[i] = Math.atan2(this.Z[b] - this.Z[a], this.X[b] - this.X[a]);
    }
    this.uSpiral = o.approach;                     // начало поворота (имя сохранено для совместимости)
    this.uStop = o.approach + o.turnR * o.psi;     // остановка головы
    this.uOut = this.uStop;
  }

  /** Точка пути на длине u (м): {x, z, yaw}. */
  at(u, out = {}) {
    const m = this.X.length - 1;
    const uu = Math.min(Math.max(u, 0), m - 0.001);
    const i = Math.floor(uu), t = uu - i;
    out.x = this.X[i] + (this.X[i + 1] - this.X[i]) * t;
    out.z = this.Z[i] + (this.Z[i + 1] - this.Z[i]) * t;
    let dy = this.Y[i + 1] - this.Y[i]; if (dy > Math.PI) dy -= 2 * Math.PI; if (dy < -Math.PI) dy += 2 * Math.PI;
    out.yaw = this.Y[i] + dy * t;
    return out;
  }

  /** Локальные координаты → мир: lf вдоль f, lr вдоль r. */
  local(lf, lr, out = {}) {
    out.x = this.G.x + this.f.x * lf + this.r.x * lr;
    out.z = this.G.z + this.f.z * lf + this.r.z * lr;
    return out;
  }

  /** Проверка маршрута: границы карты и зона скалы/сиетча (x>500, z∈[-150,700]). */
  valid() {
    for (let i = 0; i < this.X.length; i += 10) {
      const x = this.X[i], z = this.Z[i];
      if (x < -900 || x > 1500 || z < -1000 || z > 1400) { this.why = `bounds ${x | 0},${z | 0}`; return false; }
      if (x > 470 && z > -170 && z < 720) { this.why = `rock ${x | 0},${z | 0}`; return false; }
      if (ridgeQuery(x, z) < RIDGE_CLEAR) { this.why = `ridge ${x | 0},${z | 0}`; return false; }     // новый хребет ~3 км: путь и место остановки не должны входить в массивы
    }
    return true;
  }
}

/**
 * Подобрать курс: из направлений по всему кругу (шаг ~11°) берём допустимый (valid) путь с наименьшим числом столкновений с препятствиями
 * (clear — харвестер, островки, валуны), при равенстве — ближайший к желаемому. Длинное тело нельзя «выталкивать» из препятствий сдвигом
 * точек (сдвиг на сотни метров), поэтому препятствия обходятся выбором курса; relaxPath только подчищает остаток.
 */
export function choosePath(G, preferred = -1.35, opts = {}) {
  choosePath.log = [];
  const tries = [0]; for (let k = 1; k <= 16; k++) tries.push(k * 0.196, -k * 0.196);
  const { clear, ...base } = opts;
  const cand = [];
  for (const d of tries) {
    const raw = new EncounterPath(G, preferred + d, base);
    if (!raw.valid()) continue;
    let hits = 0;
    if (clear) for (let i = 0; i < raw.X.length; i += 8) if (Math.hypot(raw.X[i] - G.x, raw.Z[i] - G.z) > 140 && clear(raw.X[i], raw.Z[i], 0)) hits++;   // у самой группы мелкие препятствия обойдёт релаксация
    cand.push({ d, hits });
  }
  if (typeof window !== 'undefined') window.__pathLog = choosePath.log;
  cand.sort((a, b) => a.hits - b.hits || Math.abs(a.d) - Math.abs(b.d));
  let best = null;
  for (const c of cand.slice(0, 5)) {                       // с релаксацией строим только лучших: она дорогая
    const p = new EncounterPath(G, preferred + c.d, opts);
    (choosePath.log ||= []).push({ d: +c.d.toFixed(2), hits: c.hits, avoided: Math.round(p.avoided), valid: p.valid(), why: p.why });
    if (p.valid()) {
      if (p.avoided < (opts.maxAvoid ?? 90)) return p;
      if (!best || p.avoided < best.avoided) best = p;
    }
  }
  if (typeof window !== 'undefined') window.__pathLog = choosePath.log;
  if (best) return best;
  if (cand.length) return new EncounterPath(G, preferred + cand[0].d, base);   // релаксация портит путь — берём чистый курс с минимумом препятствий
  return new EncounterPath(G, preferred, opts);
}
