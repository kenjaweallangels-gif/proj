import './hud.css';
import { el, setText, show } from './dom.js';
import { Loading } from './Loading.js';
import { Helmet } from './Helmet.js';
import { ObserverPanel } from './Observer.js';
import { Notifications } from './Notifications.js';
import { Menu } from './Menu.js';

/**
 * HUD module (docs/ARCHITECTURE.md): loading screen, start/pause menu, helmet HUD (play mode),
 * observer panel (observer mode), help overlay (H), notifications, FPS counter.
 *
 *   hud.showLoading(text) / hideLoading() / setProgress(0..1)
 *   hud.showMenu({pause}) / hideMenu()          (App calls these; Esc / pointer-lock loss open the pause overlay)
 *   hud.notify(text, {kind: 'radio'|'info'|'warn'|'alert'})
 *   hud.toggleHelp()
 *   hud.update(dt, ctx)                          DOM text at <= 10 Hz, canvases / marker at <= 30 Hz
 * Debug: ?menu=1 shows the start menu even in shot mode.
 */
export class Hud {
  constructor(ctx) {
    this.ctx = ctx;
    this.root = el('div', 'hud');
    (ctx.uiRoot || document.body).appendChild(this.root);

    const name = typeof ctx.station?.name === 'string' ? ctx.station.name.trim() : '';
    this.loading = new Loading(this.root, { title: name ? `СТАНЦИЯ «${name.toUpperCase()}»` : 'ОРБИТАЛЬНАЯ СТАНЦИЯ', subtitle: 'ВЫХОД В ОТКРЫТЫЙ КОСМОС · НОО 410 KM' });
    this.helmet = new Helmet(this.root, ctx);
    this.observer = new ObserverPanel(this.root, ctx, this);
    this.notifications = new Notifications(this.root);
    this.lockHint = el('div', 'prompt hidden');
    this.lockHint.style.cssText = 'top:auto;bottom:calc(var(--inset-y) + 6px);font-size:11px;color:var(--dim)';
    this.lockHint.textContent = 'Щёлкните по сцене, чтобы захватить мышь';
    this.root.append(this.lockHint);
    this.fpsEl = el('div', 'fps', '');
    this.root.append(this.fpsEl);
    this.menu = new Menu(this.root, ctx, this);

    this.started = false;
    this._forceMenu = ctx.params?.get?.('menu') === '1';
    this._forceMenuDone = false;
    this._mode = null;
    this._lastNow = performance.now();
    this._textAcc = 0; this._fastAcc = 0;
    this._fpsFrames = 0; this._fpsTime = 0;
    this._prevPaused = false;
    this._needsRefresh = true;
    this._menuShownAt = 0;

    // radio log: seed with the last entries, then follow live ship events
    try { const log = ctx.ships?.getLog?.(); if (Array.isArray(log)) for (const m of log.slice(-3)) this.notifications.push(m, { kind: 'radio', ttl: 25 }); } catch (_) { /* stub */ }
    ctx.events?.on?.('ship', (e) => { if (e && e.message) this.notify(e.message, { kind: 'radio' }); });
    ctx.events?.on?.('mode', (m) => this._applyMode(m));
    this._onPointerLock = this._onPointerLock.bind(this);
    this._onKey = this._onKey.bind(this);
    document.addEventListener('pointerlockchange', this._onPointerLock);
    window.addEventListener('keydown', this._onKey);
    this._applyMode(ctx.mode);
  }

  async load() {}

  // ------------------------------------------------------------------ public API
  showLoading(text) { this.loading.show(text || 'Загрузка…'); }
  hideLoading() { this.loading.hide(!!this.ctx.isShot); this._needsRefresh = true; }
  setProgress(p) { this.loading.setProgress(p); }

  showMenu(opts = {}) {
    if (this.menu.visible) return;
    const pause = !!opts.pause;
    this.menu.show({ pause });
    this.menu.showHelp(false);
    this._menuShownAt = performance.now();
    if (this.ctx.input) this.ctx.input.enabled = false;
    if (pause && this.ctx.app) { this._prevPaused = !!this.ctx.app.paused; this.ctx.app.paused = true; }
    if (!this.ctx.isShot) { try { this.ctx.input?.exitPointerLock?.(); } catch (_) { /* ignore */ } }
    this._layers();
  }

  hideMenu() {
    // ?menu=1: the App's autostart hideMenu() call becomes a showMenu() once (debug / screenshots of the menu)
    if (this._forceMenu && !this._forceMenuDone) { this._forceMenuDone = true; this.started = true; this.showMenu(); return; }
    this.started = true;
    if (!this.menu.visible) return;
    const wasPause = this.menu.paused;
    this.menu.hide();
    if (this.ctx.input) this.ctx.input.enabled = true;
    if (wasPause && this.ctx.app) this.ctx.app.paused = this._prevPaused;
    this._needsRefresh = true;
    this._layers();
  }

  /** «НАЧАТЬ» / «ПРОДОЛЖИТЬ» */
  startFromMenu() {
    this.hideMenu();
    if (this.ctx.mode === 'play' && !this.ctx.isShot) { try { this.ctx.input?.requestPointerLock?.(); } catch (_) { /* ignore */ } }
  }

  notify(text, opts = {}) { this.notifications.push(text, opts); }

  toggleHelp() {
    if (this.menu.visible) return;
    this.menu.showHelp(!this.menu.helpVisible);
  }

  // ------------------------------------------------------------------ events
  _onPointerLock() {
    const locked = !!document.pointerLockElement;
    const ctx = this.ctx;
    if (!locked && this.started && ctx.mode === 'play' && !ctx.isShot && !this.menu.visible && !this.loading.visible) this.showMenu({ pause: true });
  }

  _onKey(e) {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.code === 'KeyH') { this.toggleHelp(); return; }
    if (e.code === 'Escape') {
      if (this.menu.helpVisible) { this.menu.showHelp(false); return; }
      // Esc both exits pointer lock (-> pause menu via pointerlockchange) and may arrive here: ignore it right after opening
      if (this.menu.visible) { if (this.menu.paused && performance.now() - (this._menuShownAt || 0) > 400) this.startFromMenu(); return; }
      if (this.started && !this.ctx.isShot && !this.loading.visible) this.showMenu({ pause: true });
    }
  }

  _applyMode(mode) {
    const prev = this._mode;
    this._mode = mode;
    this.root.dataset.mode = mode;
    this._needsRefresh = true;
    this._layers();
    if (prev === 'observer' && mode === 'play' && this.started && !this.menu.visible && !this.ctx.isShot) {
      try { this.ctx.input?.requestPointerLock?.(); } catch (_) { /* needs a gesture; the click hint covers it */ }
    }
  }

  _layers() {
    const menu = this.menu.visible, mode = this._mode;
    this.helmet.setVisible(!menu && mode === 'play');
    this.observer.setVisible(!menu && mode === 'observer');
    show(this.notifications.el, !menu);
    if (menu) show(this.lockHint, false);
  }

  // ------------------------------------------------------------------ per frame
  update(dt, ctx) {
    const now = performance.now();
    let rdt = (now - this._lastNow) / 1000;
    this._lastNow = now;
    if (!(rdt >= 0)) rdt = 0;
    rdt = Math.min(rdt, 0.25);

    // fps (real frame rate, averaged over 0.5 s)
    this._fpsFrames++; this._fpsTime += rdt;
    if (this._fpsTime >= 0.5) { setText(this.fpsEl, `${Math.round(this._fpsFrames / this._fpsTime)} fps`); this._fpsFrames = 0; this._fpsTime = 0; }

    if (ctx.mode !== this._mode) this._applyMode(ctx.mode);
    const force = !!ctx.isShot || this._needsRefresh;
    this._needsRefresh = false;
    const menu = this.menu.visible;
    this._textAcc += rdt; this._fastAcc += rdt;

    if (force || this._textAcc >= 0.1) {
      const step = this._textAcc; this._textAcc = 0;
      this.notifications.update(step);
      if (!menu) {
        if (this._mode === 'play') this.helmet.updateText(ctx, step);
        else this.observer.updateText(ctx);
      }
      const inp = ctx.input;
      show(this.lockHint, !menu && this._mode === 'play' && this.started && !ctx.isShot && !!inp && inp.wantPointerLock && !inp.pointerLocked && !this.loading.visible);
    }
    if (force || this._fastAcc >= 1 / 30) {
      const step = this._fastAcc; this._fastAcc = 0;
      if (!menu && this._mode === 'play') this.helmet.updateFast(step, ctx);
    }
  }

  dispose() {
    document.removeEventListener('pointerlockchange', this._onPointerLock);
    window.removeEventListener('keydown', this._onKey);
    this.root.remove();
  }
}
