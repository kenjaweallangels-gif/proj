// Профили дуг головы: тангаж (pitch) и поворот (yaw) как функции пройденного пути σ.
// Дуга интегрируется в вертикальной плоскости; тело потом сворачивается по истории головы.

function lerpKeys(keys, x) {
  if (x <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (x <= b[0]) return a[1] + (b[1] - a[1]) * ((x - a[0]) / (b[0] - a[0] || 1));
  }
  return keys[keys.length - 1][1];
}

export class ArcProfile {
  /**
   * @param {number[][]} pitchKeys  [σ, pitch рад]
   * @param {number[][]} yawKeys    [σ, накопленный поворот рад] (опционально)
   * @param {number} startY         высота старта относительно песка, м
   */
  constructor(pitchKeys, yawKeys = [[0, 0], [1e5, 0]], startY = -60) {
    this.pk = pitchKeys; this.yk = yawKeys;
    this.sigmaEnd = pitchKeys[pitchKeys.length - 1][0];
    this.startY = startY;
    // табличный интеграл (шаг 1 м)
    const n = Math.ceil(this.sigmaEnd) + 1;
    this.y = new Float32Array(n); this.d = new Float32Array(n);
    let y = startY, d = 0;
    for (let i = 0; i < n; i++) {
      this.y[i] = y; this.d[i] = d;
      const p = this.pitch(i + 0.5);
      y += Math.sin(p); d += Math.cos(p);
    }
    this.apex = Math.max(...this.y);
    this.apexSigma = this.y.indexOf(this.apex);
    this.dApex = this.d[this.apexSigma];
    this.dZero = this._cross(0);           // центр на уровне песка
    this.dBreach = this._cross(-18);       // верх трубы показался из песка
    this.sigmaZero = this._crossSigma(0);
  }
  pitch(sigma) { return lerpKeys(this.pk, sigma); }
  yaw(sigma) { return lerpKeys(this.yk, sigma); }
  _crossSigma(level) { for (let i = 1; i < this.y.length; i++) if (this.y[i] >= level) return i; return this.y.length - 1; }
  _cross(level) { return this.d[this._crossSigma(level)]; }
  yAt(sigma) { return this.y[Math.min(this.y.length - 1, Math.max(0, Math.round(sigma)))]; }
}

/** Обычная дуга всплытия: подъём под углом, apexH над песком в вершине, зарывание. Подбирает длину спуска бисекцией. */
export function surfaceArc(apexH = 48, startY = -60, rise = 1.0, riseLen = 90) {
  let lo = 80, hi = 900, best = null;
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    const a = new ArcProfile([[0, 0], [riseLen, rise], [riseLen + mid, -rise]], undefined, startY);
    if (a.apex < apexH) lo = mid; else hi = mid;
    best = a;
  }
  return best;
}

/** Профиль reveal: колонна ~125 м, голова склоняется (пасть смотрит вперёд-вниз), затем дуга и зарывание «в сторону». */
export function revealArc(opts = {}) {
  const A = opts.rise ?? 80, L1 = opts.vert ?? 80, B = opts.bend ?? 95, pitchStand = opts.pitchStand ?? -0.2;
  const dive = opts.dive ?? 240, diveEnd = opts.diveEnd ?? -1.15;
  const s1 = A + L1, sS = s1 + B;
  const turn = opts.yawTurn ?? 0.7;
  const prof = new ArcProfile(
    [[0, 0], [A, 1.571], [s1, 1.571], [sS, pitchStand], [sS + dive, diveEnd]],
    [[0, 0], [s1 - 20, 0], [sS, turn], [sS + 50, turn], [sS + dive, turn - (opts.yawBack ?? 0.5)]],
    -60,
  );
  prof.standSigma = sS;
  return prof;
}
