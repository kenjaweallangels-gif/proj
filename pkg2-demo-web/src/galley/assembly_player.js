// Плеер виртуальной сборки: изделие собирается 3D-моделью на месте настоящих деталей — без реальных заготовок.
// Время — в шагах ТП (t = 3,4 — идёт шаг 4, выполнен на 40 %). Пуск/пауза, скорость, направление (назад во
// времени — разборка), перемотка, по шагу, в начало и в конец. Цель (стапель или участок) отвечает за вид:
//   target = { name, steps: [{ id, title }], begin(), apply(i, f), end() }
// apply(i, f): шаги < i выполнены, шаг i — на доле f (0..1). Без three.js — тестируется в node.

export const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];

/** Плавный разгон и торможение детали при подлёте. */
export const ease = (x) => { const k = Math.min(1, Math.max(0, x)); return k * k * (3 - 2 * k); };

/** Время t (в шагах) → номер шага и доля его выполнения; на конце — последний шаг выполнен целиком. */
export function stepAt(t, n) {
  const c = Math.min(Math.max(t, 0), n);
  if (c >= n) return { i: n, f: 0 };
  const i = Math.floor(c);
  return { i, f: c - i };
}

export class AssemblyPlayer {
  constructor({ secPerStep = 2.4 } = {}) {
    this.target = null; this.t = 0; this.speed = 1; this.dir = 1; this.playing = false;
    this.secPerStep = secPerStep;
    this.listeners = [];
    this._last = null;
  }

  get n() { return this.target ? this.target.steps.length : 0; }
  get open() { return !!this.target; }
  get current() { const { i, f } = stepAt(this.t, this.n); return { i, f, step: this.target?.steps[Math.min(i, this.n - 1)] }; }
  on(fn) { this.listeners.push(fn); }
  emit() { for (const fn of this.listeners) fn(this); }

  /** Открыть плеер для цели (стапель, участок); start — с какого шага (по умолчанию с пустого места). */
  openFor(target, start = 0) {
    if (this.target) this.close();
    this.target = target; this.t = start; this.playing = false; this.dir = 1; this._last = null;
    target.begin?.();
    this.apply(true);
    this.emit();
  }

  close() {
    if (!this.target) return;
    const t = this.target;
    this.target = null; this.playing = false;
    t.end?.();
    this.emit();
  }

  apply(force = false) {
    if (!this.target) return;
    const { i, f } = stepAt(this.t, this.n);
    const key = `${i}:${f.toFixed(3)}`;
    if (!force && key === this._last) return;
    this._last = key;
    this.target.apply(i, f);
  }

  update(dt) {
    if (!this.target || !this.playing) return;
    this.t += (this.dir * this.speed * dt) / (this.target.secPerStep ?? this.secPerStep);
    if (this.t >= this.n) { this.t = this.n; this.playing = false; this.emit(); }
    if (this.t <= 0) { this.t = 0; this.playing = false; this.emit(); }
    this.apply();
  }

  play(dir = this.dir) {
    if (!this.target) return;
    this.dir = dir;
    if (dir > 0 && this.t >= this.n) this.t = 0;          // с конца — заново
    if (dir < 0 && this.t <= 0) this.t = this.n;
    this.playing = true; this.emit();
  }
  pause() { this.playing = false; this.emit(); }
  toggle() { if (this.playing) this.pause(); else this.play(); }
  reverse() { this.dir = -this.dir; if (!this.playing) this.play(this.dir); else this.emit(); }
  seek(t) { this.t = Math.min(Math.max(t, 0), this.n); this.apply(); this.emit(); }
  /** На шаг вперёд/назад — к началу соседнего шага (на паузе). */
  stepBy(d) {
    this.pause();
    const cur = this.t;
    const to = d > 0 ? Math.floor(cur + 1e-6) + 1 : Math.ceil(cur - 1e-6) - 1;
    this.seek(to);
  }
  toStart() { this.pause(); this.seek(0); }
  toEnd() { this.pause(); this.seek(this.n); }
  setSpeed(v) { this.speed = v; this.emit(); }
  faster(k = 1) { const i = SPEEDS.indexOf(this.speed); this.setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, (i < 0 ? 2 : i) + k))]); }
}
