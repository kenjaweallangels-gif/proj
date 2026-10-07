// Проигрыватель шагов — упрощённое зеркало движка ядра (pkg1-sim-vm/core/arcore/steps/engine.py).
// Без three.js. Состояния и сообщения совпадают с ядром, чтобы демо и очки вели себя одинаково.

export const State = Object.freeze({
  ALIGNING: 'aligning', SHOWING: 'showing', WAITING_VALUE: 'waiting_value', WAITING_PHOTO: 'waiting_photo', DONE: 'done',
});

export class StepPlayer {
  constructor(steps, clock = () => performance.now() / 1000) {
    this.steps = steps;
    this.clock = clock;
    this.index = 0;
    this.state = State.SHOWING;
    this.speed = 1;
    this.values = {};
    this.photos = new Set();
    this.log = [];
    this.listeners = new Set();
    this.stepStarted = clock();
  }

  get step() { return this.steps[this.index]; }
  get total() { return this.steps.length; }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(event, data = {}) {
    const e = { t: this.clock(), step: this.step?.id ?? null, event, ...data };
    this.log.push(e);
    for (const fn of this.listeners) fn(e, this);
  }

  start(index = 0) {
    this.index = Math.max(0, Math.min(index, this.total - 1));
    this.state = this.step.kind === 'align' && this.index === 0 ? State.ALIGNING : State.SHOWING;
    this.stepStarted = this.clock();
    this.emit('start');
  }

  aligned(quality = 0.9, errMm = null) {
    if (this.state !== State.ALIGNING) return false;
    this.state = State.SHOWING;
    this.emit('aligned', { quality, errMm });
    return true;
  }

  needs() {
    const s = this.step;
    if (s.confirm === 'value' && !(s.id in this.values)) return 'value';
    if (s.confirm === 'photo' && !this.photos.has(s.id)) return 'photo';
    return null;
  }

  valueOk(v) {
    const chk = this.step.check || {};
    if (chk.nominal_mm != null && chk.tol_mm != null) return Math.abs(v - chk.nominal_mm) <= chk.tol_mm;
    const tq = this.step.params?.torque_nm;
    if (tq) return Math.abs(v - tq) <= 0.1 * tq;
    return true;
  }

  /** Команды как в ядре: next | prev | value | photo | repeat | slower | faster | kd | chat | panel. */
  command(cmd, value = null) {
    if (this.state === State.DONE && cmd !== 'prev') return false;
    switch (cmd) {
      case 'next': {
        if (this.state === State.ALIGNING) { this.emit('rejected', { reason: 'нет привязки' }); return false; }
        const need = this.needs();
        if (need === 'value') { this.state = State.WAITING_VALUE; this.emit('need_value'); return false; }
        if (need === 'photo') { this.state = State.WAITING_PHOTO; this.emit('need_photo'); return false; }
        return this.advance();
      }
      case 'value': {
        if (value == null || Number.isNaN(+value)) return false;
        this.values[this.step.id] = +value;
        const ok = this.valueOk(+value);
        this.emit('value', { value: +value, ok });
        if (!ok) return false;
        return this.advance();
      }
      case 'photo':
        this.photos.add(this.step.id);
        this.emit('photo');
        return this.advance();
      case 'prev':
        if (this.index === 0) return false;
        this.index -= 1;
        this.state = State.SHOWING;
        this.stepStarted = this.clock();
        this.emit('prev');
        return true;
      case 'slower': case 'faster':
        this.speed = cmd === 'slower' ? Math.max(0.5, this.speed - 0.5) : Math.min(2, this.speed + 0.5);
        this.emit(cmd, { speed: this.speed });
        return true;
      case 'repeat': case 'kd': case 'chat': case 'panel':
        this.emit(cmd);
        return true;
      default:
        return false;
    }
  }

  advance() {
    this.emit('done', { duration: +(this.clock() - this.stepStarted).toFixed(1) });
    if (this.index >= this.total - 1) { this.state = State.DONE; this.emit('operation_done'); return true; }
    this.index += 1;
    this.state = State.SHOWING;
    this.stepStarted = this.clock();
    this.emit('step');
    return true;
  }

  /** Сообщение в формате ядра (docs/02_hal_contracts.md, type: step). */
  message(opId) {
    const s = this.step;
    return { type: 'step', op: opId, index: this.index, total: this.total, id: s.id, title: s.title,
      state: this.state, speed: this.speed, need: this.needs() };
  }
}
