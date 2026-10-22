/** STUB — minimal overlay (crosshair + telemetry). Replaced by the real helmet HUD. */
export class Hud {
  constructor(ctx) {
    this.ctx = ctx;
    const root = ctx.uiRoot;
    this.el = document.createElement('div');
    this.el.style.cssText = 'position:absolute;left:16px;top:16px;font:13px/1.5 monospace;color:#9fd3ff;text-shadow:0 0 4px #000;white-space:pre';
    root.appendChild(this.el);
    this.cross = document.createElement('div');
    this.cross.style.cssText = 'position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px;border:1px solid #9fd3ff;border-radius:50%;opacity:.7';
    root.appendChild(this.cross);
    this.loading = document.createElement('div');
    this.loading.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#000;color:#cfe;font-size:20px;letter-spacing:.2em';
    this.loading.textContent = 'ЗАГРУЗКА';
    root.appendChild(this.loading);
    this._acc = 0; this._frames = 0; this.fps = 0;
  }
  showLoading(t) { this.loading.style.display = 'flex'; this.loading.textContent = t || 'ЗАГРУЗКА'; }
  hideLoading() { this.loading.style.display = 'none'; }
  showMenu() {}
  hideMenu() {}
  update(dt, ctx) {
    this._acc += ctx.time.real; this._frames++;
    const o = ctx.orbit, p = ctx.player.state;
    if (this._frames % 10 === 0) {
      this.el.textContent = [
        `T+${(ctx.time.sim).toFixed(0)} s  x${ctx.time.scale}  ${ctx.mode}`,
        `alt ${o.altitudeKm.toFixed(0)} km  v ${o.speedKms.toFixed(2)} km/s  lat ${o.subLatDeg.toFixed(1)}  lon ${o.subLonDeg.toFixed(1)}`,
        `sun ${(o.sunVisible * 100).toFixed(0)}%  earthLit ${(o.earthLit * 100).toFixed(0)}%`,
        `v_rel ${p.speedRelative.toFixed(2)} m/s  dist ${p.distanceToStation.toFixed(1)} m`,
        `F — камера обзора, T — ускорение времени, P — пауза`,
      ].join('\n');
    }
  }
}
