// Поза головы с реальных очков → камера симулятора и стенда. Источник — мост позы
// pkg1-sim-vm/tools/glasses_lab/pose_bridge.py (WebSocket, по умолчанию ws://127.0.0.1:47110).
// Сообщение — «head» из протокола ядра (docs/02_hal_contracts.md): {"type":"head","t_ns","rotation_xyzw","position_m"}.
// СК: Y — вверх, взгляд вдоль −Z; курс и тангаж — как Euler 'YXZ' в three.js (тот же порядок, что у сборщика в симуляторе).

export const DEFAULT_POSE_URL = 'ws://127.0.0.1:47110';

/** Разобрать строку сообщения; null — не поза. */
export function parseHead(text) {
  let m;
  try { m = JSON.parse(text); } catch { return null; }
  const q = m?.rotation_xyzw;
  if (m?.type !== 'head' || !Array.isArray(q) || q.length !== 4 || !q.every(Number.isFinite)) return null;
  const n = Math.hypot(...q) || 1;
  return { t: Number(m.t_ns) || 0, q: q.map((v) => v / n), p: Array.isArray(m.position_m) ? m.position_m : [0, 0, 0], source: m.source || '' };
}

/** Курс, тангаж, крен (рад) из кватерниона [x, y, z, w] — порядок YXZ. */
export function yprFromQuat([x, y, z, w]) {
  const m13 = 2 * (x * z + w * y), m23 = 2 * (y * z - w * x), m33 = 1 - 2 * (x * x + y * y);
  const m21 = 2 * (x * y + w * z), m22 = 1 - 2 * (x * x + z * z);
  const pitch = Math.asin(Math.max(-1, Math.min(1, -m23)));
  if (Math.abs(m23) < 0.9999999) return { yaw: Math.atan2(m13, m33), pitch, roll: Math.atan2(m21, m22) };
  return { yaw: Math.atan2(-(2 * (x * z - w * y)), 1 - 2 * (y * y + z * z)), pitch, roll: 0 };
}

/** Кватернион из курса и тангажа (для тестов и синтетики). */
export function quatFromYpr(yaw, pitch, roll = 0) {
  const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2), cr = Math.cos(roll / 2), sr = Math.sin(roll / 2);
  return [cy * sp * cr + sy * cp * sr, sy * cp * cr - cy * sp * sr, cy * cp * sr - sy * sp * cr, cy * cp * cr + sy * sp * sr];
}

/** Частота поз по последним меткам времени (нс). */
export function rateHz(ts) {
  if (ts.length < 2) return 0;
  const span = (ts[ts.length - 1] - ts[0]) / 1e9;
  return span > 0 ? (ts.length - 1) / span : 0;
}

/**
 * Подключение к мосту позы с переподключением. onPose(pose) — на каждую позу; onState(text) — смена состояния.
 * offsetYaw: курс очков «обнуляется» на первой позе (и по recenter), чтобы вид не прыгал.
 */
export class PoseLink {
  constructor(url = DEFAULT_POSE_URL, { onPose, onState, WS = globalThis.WebSocket } = {}) {
    Object.assign(this, { url, onPose, onState, WS, last: null, times: [], zeroYaw: null, closed: false, state: 'нет связи' });
    this.connect();
  }
  connect() {
    if (this.closed || !this.WS) return;
    const ws = new this.WS(this.url);
    this.ws = ws;
    ws.onopen = () => this.setState('связь есть');
    ws.onclose = () => { this.setState('нет связи'); if (!this.closed) setTimeout(() => this.connect(), 1500); };
    ws.onerror = () => {};
    ws.onmessage = (e) => this.receive(e.data);
  }
  receive(text) {
    const p = parseHead(text);
    if (!p) return;
    const a = yprFromQuat(p.q);
    if (this.zeroYaw === null) this.zeroYaw = a.yaw;
    this.last = { ...p, ...a, rel: { yaw: a.yaw - this.zeroYaw, pitch: a.pitch, roll: a.roll }, at: performance.now() };
    this.times.push(p.t); if (this.times.length > 120) this.times.shift();
    this.onPose?.(this.last);
  }
  /** Нулевой курс — текущий (кнопка «по центру»). */
  recenter() { if (this.last) this.zeroYaw = this.last.yaw; }
  get fresh() { return !!this.last && performance.now() - this.last.at < 500; }
  get hz() { return rateHz(this.times); }
  setState(s) { this.state = s; this.onState?.(s); }
  close() { this.closed = true; this.ws?.close(); }
}
