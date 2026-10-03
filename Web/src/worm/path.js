// Маршрут укрощённого червя по поверхности (в плане XZ) относительно группы игрока G.
// Локальная рамка: f — направление движения червя на подходе, r — «право» (r = (-f.z, f.x) при осях X — восток, Z — юг).
//   1) подход по прямой на расстоянии R0 слева от G (проход мимо группы ~60–80 м),
//   2) «великая дуга» — спираль по часовой стрелке вокруг G с радиусом R0 → R1: червь тормозит и ложится дугой вокруг группы,
//   3) отход: спираль раскручивается наружу (R1 → R2) и уходит прямо в пустыню.
// Путь пересэмплирован с шагом 1 м, чтобы голова ехала по длине дуги u (м) независимо от формы.
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export const PATH_DEFAULTS = {
  approach: 520,            // м прямого подхода до начала дуги
  R0: 76, R1: 52, R2: 175,  // радиусы: проход, финал дуги, отход
  phi1: 4.1,                // рад: поворот до остановки (≈235°)
  phi2: 5.35,               // рад: конец разворота при отходе
  tail: 1200,               // м прямого отхода
};

export class EncounterPath {
  /** @param {{x:number,z:number}} G группа  @param {number} heading курс червя на подходе, рад (atan2(dz,dx)) */
  constructor(G, heading, opts = {}) {
    const o = { ...PATH_DEFAULTS, ...opts };
    this.o = o; this.G = { x: G.x, z: G.z }; this.heading = heading;
    const fx = Math.cos(heading), fz = Math.sin(heading);
    const rx = -fz, rz = fx;
    this.f = { x: fx, z: fz }; this.r = { x: rx, z: rz };
    const raw = [];
    const pushRaw = (x, z) => raw.push(x, z);
    // 1) подход
    for (let l = -o.approach; l < 0; l += 2) pushRaw(G.x + fx * l - rx * o.R0, G.z + fz * l - rz * o.R0);
    // 2) спираль внутрь, 3) наружу
    const Rof = (phi) => (phi <= o.phi1 ? o.R0 + (o.R1 - o.R0) * sstep(0, o.phi1, phi) : o.R1 + (o.R2 - o.R1) * sstep(o.phi1, o.phi2, phi));
    let phi = 0;
    while (phi < o.phi2) {
      const R = Rof(phi);
      const c = Math.cos(phi), s = Math.sin(phi);
      pushRaw(G.x + R * (-rx * c + fx * s), G.z + R * (-rz * c + fz * s));
      phi += 0.4 / R;
    }
    const Re = Rof(o.phi2), c2 = Math.cos(o.phi2), s2 = Math.sin(o.phi2);
    const ex = G.x + Re * (-rx * c2 + fx * s2), ez = G.z + Re * (-rz * c2 + fz * s2);
    let tx = rx * s2 + fx * c2, tz = rz * s2 + fz * c2;
    const tl = Math.hypot(tx, tz); tx /= tl; tz /= tl;
    for (let l = 0; l <= o.tail; l += 2) pushRaw(ex + tx * l, ez + tz * l);
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
    for (let i = 0; i < m; i++) {
      const a = Math.max(0, i - 2), b = Math.min(m - 1, i + 2);
      this.Y[i] = Math.atan2(this.Z[b] - this.Z[a], this.X[b] - this.X[a]);
    }
    this.uSpiral = o.approach;                     // начало дуги
    this.uStop = this._uAtPhi(o.phi1, Rof);        // остановка головы
    this.uOut = this._uAtPhi(o.phi2, Rof);
  }

  _uAtPhi(target, Rof) {
    // длина дуги: approach + ∫ sqrt(R² + R'²) dφ (численно)
    let u = this.o.approach, phi = 0;
    const h = 0.002;
    while (phi < target) {
      const R = Rof(phi), dR = (Rof(phi + h) - R) / h;
      u += Math.hypot(R, dR) * h; phi += h;
    }
    return u;
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
    for (let i = 0; i < this.X.length; i += 25) {
      const x = this.X[i], z = this.Z[i];
      if (x < -900 || x > 1500 || z < -1000 || z > 1400) return false;
      if (x > 470 && z > -170 && z < 720) return false;
    }
    return true;
  }
}

/** Подобрать курс: ближайший к желаемому, для которого маршрут допустим. */
export function choosePath(G, preferred = -1.35, opts = {}) {
  const tries = [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4, 1.75, -1.75, 2.1, -2.1, 2.45, -2.45, 3.14];
  for (const d of tries) {
    const p = new EncounterPath(G, preferred + d, opts);
    if (p.valid()) return p;
  }
  return new EncounterPath(G, preferred, opts);
}
