/** Remembers the window size / position / maximized / fullscreen state in userData/window-state.json. */
import fs from 'node:fs';
import path from 'node:path';

export class WindowState {
  constructor(userData, screen, defaults) {
    this.file = path.join(userData, 'window-state.json');
    this.screen = screen;
    this.state = { width: defaults.width, height: defaults.height, maximized: false, fullscreen: false };
    try { Object.assign(this.state, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch (_) { /* first run */ }
    this._clamp();
    this._timer = null;
  }

  /** Keeps the window on a connected display and no larger than its work area. */
  _clamp() {
    const s = this.state;
    const displays = this.screen.getAllDisplays();
    const onScreen = Number.isFinite(s.x) && Number.isFinite(s.y) && displays.some((d) => {
      const a = d.workArea;
      return s.x + 64 > a.x && s.y + 32 > a.y && s.x < a.x + a.width - 64 && s.y < a.y + a.height - 32;
    });
    if (!onScreen) { delete s.x; delete s.y; }
    const area = (onScreen ? this.screen.getDisplayNearestPoint({ x: s.x, y: s.y }) : this.screen.getPrimaryDisplay()).workArea;
    s.width = Math.max(640, Math.min(s.width || 1920, area.width));
    s.height = Math.max(360, Math.min(s.height || 1080, area.height));
  }

  track(win) {
    const save = () => {
      if (win.isDestroyed()) return;
      const s = this.state;
      s.maximized = win.isMaximized();
      s.fullscreen = win.isFullScreen();
      if (!s.maximized && !s.fullscreen && !win.isMinimized()) Object.assign(s, win.getNormalBounds());
    };
    const later = () => { clearTimeout(this._timer); this._timer = setTimeout(() => { save(); this.write(); }, 800); };
    for (const ev of ['resize', 'move', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) win.on(ev, later);
    win.on('close', () => { clearTimeout(this._timer); save(); this.write(); });
  }

  write() {
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2)); } catch (_) { /* read-only home */ }
  }
}
