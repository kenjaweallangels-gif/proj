import { el, add, setText, setClass, show } from './dom.js';
import { TIME_PRESETS, rateLabel, rateMeaning, formatUtc } from '../core/Time.js';

/**
 * Time controls widget (observer panel, free-camera panel, pause menu): pause / play, slower / faster, ×1,
 * preset rates, UTC clock with the current rate, jumps (−1 h, +1 h, +1 day, +30 days) and a date/time field.
 * Works on ctx.time (src/core/Time.js); `update()` refreshes the readouts (call at ~10 Hz).
 */
const PRESET_TIPS = {
  1: 'Реальное время', 10: '1 с = 10 с', 60: '1 с = 1 мин', 600: '1 с = 10 мин: виток за 9 с',
  3600: '1 с = 1 ч: смена дня и ночи на станции каждые ~1,5 с', 86400: '1 с = 1 сутки: фазы Луны за месяц ≈ 30 с', 1e6: '1 с ≈ 11,6 суток: для кометы и дальних перелётов',
};
const JUMPS = [[-3600, '−1 ч', 'Назад на 1 час'], [3600, '+1 ч', 'Вперёд на 1 час'], [86400, '+1 сут', 'Вперёд на сутки'], [30 * 86400, '+30 сут', 'Вперёд на 30 суток']];

export class TimeControls {
  constructor(ctx, { title = 'ХОД ВРЕМЕНИ', compact = false } = {}) {
    this.ctx = ctx;
    this.el = el('div', `tc${compact ? ' tc-compact' : ''}`);
    const head = el('div', 'tc-head');
    head.append(el('span', 'tc-title', title));
    this.rateEl = el('span', 'tc-rate', '×1');
    head.append(this.rateEl);
    this.el.append(head);
    this.utcEl = el('div', 'tc-utc', '—');
    this.utcEl.title = 'Время симуляции (UTC)';
    this.el.append(this.utcEl);

    const row = el('div', 'tc-row');
    this.pauseBtn = this._btn('❚❚', 'Пауза (P)', () => this.time.togglePause(), 'tc-pause');
    const slower = this._btn('«', 'Медленнее ([)', () => this.time.slower());
    const one = this._btn('×1', 'Реальное время (\\)', () => { this.time.resetRate(); this.time.setPaused(false); });
    const faster = this._btn('»', 'Быстрее (])', () => this.time.faster());
    add(row, this.pauseBtn, slower, one, faster);
    this.el.append(row);

    const presets = el('div', 'tc-presets');
    this.presetBtns = new Map();
    for (const r of TIME_PRESETS) {
      const b = this._btn(rateLabel(r).replace(' тыс.', 'k'), `${rateLabel(r)} — ${PRESET_TIPS[r] || rateMeaning(r)}`, () => { this.time.setRate(r); this.time.setPaused(false); });
      this.presetBtns.set(r, b);
      presets.append(b);
    }
    this.el.append(presets);

    const jumps = el('div', 'tc-jumps');
    for (const [s, label, tip] of JUMPS) jumps.append(this._btn(label, tip, () => this.time.jump(s)));
    this.el.append(jumps);

    const goto = el('div', 'tc-goto');
    this.dateInput = el('input', 'tc-date');
    this.dateInput.type = 'datetime-local';
    this.dateInput.step = '60';
    this.dateInput.title = 'Дата и время UTC для перехода';
    const go = this._btn('Перейти', 'Перейти к выбранной дате и времени (UTC)', () => this._gotoDate());
    this.dateInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this._gotoDate(); } e.stopPropagation(); });
    add(goto, this.dateInput, go);
    this.el.append(goto);

    this.noteEl = el('div', 'tc-note hidden', '');
    this.el.append(this.noteEl);
    this._dateFilled = false;
    this.update();
  }

  get time() { return this.ctx.time; }

  _btn(label, tip, fn, cls = '') {
    const b = el('button', cls, label);
    b.type = 'button'; b.title = tip;
    b.addEventListener('click', (e) => {
      try { fn(); } catch (err) { console.warn('[TimeControls]', err); }
      e.currentTarget.blur();                     // keep Space / Enter for the game, not the focused button
      this.update();
    });
    return b;
  }

  _gotoDate() {
    const v = this.dateInput.value;
    if (!v) return;
    const ms = Date.parse(`${v.length === 16 ? v + ':00' : v}Z`);
    if (Number.isFinite(ms)) this.time.setUtc(ms);
    this.dateInput.blur();
    this.update();
  }

  /** Text refresh (~10 Hz). */
  update() {
    const t = this.time;
    if (!t) return;
    const paused = !!t.paused, rate = t.rate ?? t.scale ?? 1;
    setText(this.rateEl, paused ? 'ПАУЗА' : `${rateLabel(rate)} · ${rateMeaning(rate)}`);
    setClass(this.rateEl, 'warn', paused || rate !== 1);
    setText(this.pauseBtn, paused ? '▶' : '❚❚');
    this.pauseBtn.title = paused ? 'Продолжить (P)' : 'Пауза (P)';
    setClass(this.pauseBtn, 'on', paused);
    for (const [r, b] of this.presetBtns) setClass(b, 'on', !paused && Math.abs(rate - r) < 1e-9);
    const d = typeof t.utc === 'function' ? t.utc() : null;
    if (d) {
      setText(this.utcEl, `${formatUtc(d)} UTC`);
      if (!this._dateFilled && document.activeElement !== this.dateInput) {
        this._dateFilled = true;
        this.dateInput.value = d.toISOString().slice(0, 16);
      }
    }
    // astronaut on rails at high rates (Player.js), traffic fast-forward
    const st = this.ctx.player?.state;
    const rails = !!st?.onRails && this.ctx.mode === 'play';
    const note = rails ? 'Ход быстрее ×10: космонавт зафиксирован относительно станции, физика и ресурсы скафандра на паузе'
      : rate > 600 && !paused ? 'Корабли проходят этапы полёта скачком' : '';
    setText(this.noteEl, note);
    show(this.noteEl, !!note);
  }
}
