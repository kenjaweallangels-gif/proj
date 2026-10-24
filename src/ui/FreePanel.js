import { el, add, setText, fade, show } from './dom.js';
import { TimeControls } from './TimeControls.js';

/** Free-camera panel (App mode 'free', src/core/FreeCamera.js): distances, speed, frame, jumps, time controls. */
const ANCHORS = { station: 'станция (ЛВЛГ, вместе со станцией)', earth: 'Земля (инерциальная)', moon: 'Луна (вместе с Луной)' };

/** Distance with units: m below 1 km, km with spaces as thousands separators above. */
export function fmtDistance(km) {
  if (!Number.isFinite(km)) return '—';
  const a = Math.abs(km);
  if (a < 1) return `${Math.round(km * 1000)} м`;
  if (a < 100) return `${km.toFixed(2)} км`;
  if (a < 10000) return `${km.toFixed(1)} км`;
  return `${Math.round(km).toLocaleString('ru-RU')} км`;
}
/** Speed with units: m/s, km/s, Mm/s (thousand km/s). */
export function fmtSpeed(ms) {
  if (!Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${ms < 10 ? ms.toFixed(2) : ms.toFixed(1)} м/с`;
  if (ms < 1e6) return `${(ms / 1000).toFixed(ms < 1e4 ? 2 : 1)} км/с`;
  return `${(ms / 1e6).toFixed(2)} Мм/с`;
}

export class FreePanel {
  constructor(root, ctx, hud) {
    this.ctx = ctx;
    this.hud = hud;
    this.el = el('div', 'obs free off');
    add(this.el, el('div', 'obs-title', 'СВОБОДНАЯ КАМЕРА'),
      el('div', 'obs-hint', 'W/A/S/D, Space/Ctrl — полёт · мышь — обзор · Q/E — крен · колесо или +/− — скорость, Shift ×10'));
    const row = (label) => { const r = el('div', 'hp-row'); r.append(el('span', 'k', label)); const v = el('span', 'v', '—'); r.append(v); this.el.append(r); return v; };
    this.speedEl = row('Скорость');
    this.cruiseEl = row('Круиз (колесо, +/−)');
    this.altEl = row('Высота над Землёй');
    this.stEl = row('До станции');
    this.moonEl = row('До Луны');
    this.frameEl = row('Система отсчёта');
    this.axesEl = row('Ориентация (O)');

    const grid = el('div', 'obs-grid');
    const btn = (label, tip, fn) => {
      const b = el('button', '', label); b.type = 'button'; b.title = tip;
      b.addEventListener('click', (e) => { try { fn(); } catch (err) { console.warn('[FreePanel]', err); } e.currentTarget.blur(); });
      grid.append(b);
      return b;
    };
    const fc = () => ctx.app?.freeCam;
    btn('К станции (B)', 'Вернуться к станции', () => fc()?.jumpTo('station'));
    btn('К Земле', 'Перелёт: 30 000 км над дневной стороной', () => fc()?.jumpTo('earth'));
    btn('К Луне', 'Перелёт: 12 000 км от Луны, освещённая сторона', () => fc()?.jumpTo('moon'));
    btn('На станцию', 'Повернуться к станции', () => fc()?.lookAtBody('station'));
    btn('На Землю', 'Повернуться к Земле', () => fc()?.lookAtBody('earth'));
    btn('На Луну', 'Повернуться к Луне', () => fc()?.lookAtBody('moon'));
    this.el.append(grid);
    const foot = el('div', 'obs-foot');
    const f1 = el('button', 'btn-s', 'Ориентация (O)'); f1.type = 'button'; f1.title = 'Инерциальная (звёзды неподвижны) / местная вертикаль (горизонт следует за камерой)';
    f1.addEventListener('click', (e) => { const f = fc(); if (f) f.setAxesMode(f.axesMode === 'local' ? 'inertial' : 'local'); e.currentTarget.blur(); });
    const f2 = el('button', 'btn-s', 'Обзор (F)'); f2.type = 'button'; f2.title = 'Камера обзора вокруг станции';
    f2.addEventListener('click', (e) => { ctx.app?.leaveFreeCamera?.('observer'); e.currentTarget.blur(); });
    const f3 = el('button', 'btn-s', 'Выход (C)'); f3.type = 'button'; f3.title = 'Выйти из свободной камеры';
    f3.addEventListener('click', (e) => { ctx.app?.leaveFreeCamera?.(); e.currentTarget.blur(); });
    add(foot, f1, f2, f3);
    this.el.append(foot);
    this.time = new TimeControls(ctx, { compact: true });
    this.el.append(this.time.el);
    this.lockEl = el('div', 'obs-hint', 'Щёлкните по сцене, чтобы управлять мышью (Esc — меню)');
    this.el.append(this.lockEl);
    root.append(this.el);
    this._info = {};
  }

  setVisible(on) { show(this.el, true); fade(this.el, on); }

  /** ~10 Hz */
  updateText(ctx) {
    const f = ctx.app?.freeCam;
    if (!f) return;
    const i = f.info(this._info);
    setText(this.speedEl, fmtSpeed(i.speed));
    setText(this.cruiseEl, fmtSpeed(i.cruise));
    setText(this.altEl, fmtDistance(i.altitudeKm));
    setText(this.stEl, fmtDistance(i.distanceToStationKm));
    setText(this.moonEl, i.distanceToMoonKm < 100000 ? `${fmtDistance(i.distanceToMoonKm)} · высота ${fmtDistance(i.moonAltitudeKm)}` : fmtDistance(i.distanceToMoonKm));
    setText(this.frameEl, ANCHORS[i.anchor] || i.anchor);
    setText(this.axesEl, i.anchor === 'station' ? 'по станции' : i.axesMode === 'local' ? 'местная вертикаль' : 'инерциальная');
    this.time.update();
    const inp = ctx.input;
    show(this.lockEl, !!inp && inp.wantPointerLock && !inp.pointerLocked && !ctx.isShot);
  }
}
