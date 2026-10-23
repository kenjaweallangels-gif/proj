import { el, add, setText, setClass, show, num, hms, fade } from './dom.js';

/** Observer-mode panel: hint, time scale, simulation clock, named camera views. */
const VIEWS = [
  ['overview', 'Обзор'], ['front', 'Спереди'], ['top', 'Сверху'], ['earth', 'Земля'],
  ['docking', 'Стыковка'], ['ring', 'Кольцо'], ['hub', 'Хаб'], ['solar', 'Батареи'],
  ['airlockExt', 'Шлюз'], ['closeup', 'Крупно'], ['arm', 'Манипулятор'], ['cupola', 'Купол'], ['ships', 'Корабли'], ['sunrise', 'На Солнце'], ['limb', 'Горизонт'],
];

export class ObserverPanel {
  constructor(root, ctx, hud) {
    this.ctx = ctx;
    this.hud = hud;
    this.el = el('div', 'obs hidden');
    add(this.el, el('div', 'obs-title', 'КАМЕРА ОБЗОРА'), el('div', 'obs-hint', 'F — вернуться в скафандр · мышь / колесо — облёт камеры'));
    const r1 = el('div', 'hp-row'); r1.append(el('span', 'k', 'Ход времени (T)')); this.scaleEl = el('span', 'v', '×1'); r1.append(this.scaleEl);
    const r2 = el('div', 'hp-row'); r2.append(el('span', 'k', 'Полётное время')); this.clockEl = el('span', 'v', 'T+00:00:00'); r2.append(this.clockEl);
    const r3 = el('div', 'hp-row'); r3.append(el('span', 'k', 'UTC')); this.utcEl = el('span', 'v', '—'); r3.append(this.utcEl);
    const r4 = el('div', 'hp-row'); r4.append(el('span', 'k', 'Под станцией')); this.posEl = el('span', 'v', '—'); r4.append(this.posEl);
    add(this.el, r1, r2, r3, r4);
    this.grid = el('div', 'obs-grid');
    this.buttons = {};
    for (const [name, label] of VIEWS) {
      const b = el('button', '', label);
      b.type = 'button'; b.title = name;
      b.addEventListener('click', () => { try { ctx.app?.setView?.(name); } catch (e) { console.warn('[Hud] setView failed', e); } this._markActive(); });
      this.buttons[name] = b;
      this.grid.append(b);
    }
    this.el.append(this.grid);
    const foot = el('div', 'obs-foot');
    const back = el('button', 'btn-s', 'Скафандр (F)'); back.type = 'button';
    back.addEventListener('click', () => { ctx.app?.setMode?.('play'); if (!ctx.isShot) ctx.input?.requestPointerLock?.(); });
    const pause = el('button', 'btn-s', 'Пауза (P)'); pause.type = 'button';
    pause.addEventListener('click', () => { if (ctx.app) ctx.app.paused = !ctx.app.paused; });
    this.pauseBtn = pause;
    const help = el('button', 'btn-s', 'Помощь (H)'); help.type = 'button';
    help.addEventListener('click', () => hud.toggleHelp());
    add(foot, back, pause, help);
    this.el.append(foot);
    root.append(this.el);
  }

  setVisible(on) { show(this.el, true); fade(this.el, on); if (on) this._markActive(); }

  _markActive() {
    const cur = this.ctx.app?.viewName;
    for (const name in this.buttons) setClass(this.buttons[name], 'on', name === cur);
  }

  /** ~10 Hz */
  updateText(ctx) {
    const t = ctx.time || {}, o = ctx.orbit || {};
    setText(this.scaleEl, ctx.app?.paused ? 'ПАУЗА' : `×${num(t.scale, 1)}`);
    setClass(this.scaleEl, 'warn', !!ctx.app?.paused || num(t.scale, 1) !== 1);
    setText(this.clockEl, `T+${hms(t.sim)}`);
    let utc = '—';
    try { const d = typeof o.dateAt === 'function' ? o.dateAt() : null; if (d) utc = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')} ${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`; } catch (_) { /* stub orbit */ }
    setText(this.utcEl, utc);
    const lat = num(o.subLatDeg, 0), lon = num(o.subLonDeg, 0);
    setText(this.posEl, `${Math.abs(lat).toFixed(1)}° ${lat >= 0 ? 'с.ш.' : 'ю.ш.'} ${Math.abs(lon).toFixed(1)}° ${lon >= 0 ? 'в.д.' : 'з.д.'}`);
    setText(this.pauseBtn, ctx.app?.paused ? 'Продолжить (P)' : 'Пауза (P)');
    if (this._lastView !== ctx.app?.viewName) { this._lastView = ctx.app?.viewName; this._markActive(); }
  }
}
