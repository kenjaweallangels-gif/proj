import './telescope.css';
import { el, add, setText, setClass, show } from './dom.js';
import { AU_KM } from '../core/Ephemeris.js';

/**
 * Telescope UI (Russian): HUD button «ТЕЛЕСКОП (Z)», reticle with a scale bar, catalogue / search panel (Солнечная
 * система, звёзды, глубокий космос), target and field readouts (RA / Dec J2000, distance, magnitude, angular size,
 * phase, elongation, field, magnification, limiting magnitude, exposure), solar-filter and occlusion warnings.
 * Lives in the HUD root; refreshed at ~5 Hz.
 */

const D2R = Math.PI / 180;
const GROUPS = [['all', 'Все'], ['sol', 'Солн. система'], ['star', 'Звёзды'], ['dso', 'Галактики, туманности']];
const PRESETS = [60, 10, 2, 0.5, 0.1];

function hms(rad) {
  let h = ((rad / D2R / 15) % 24 + 24) % 24;
  const H = Math.floor(h); h = (h - H) * 60; const M = Math.floor(h); const S = (h - M) * 60;
  return `${String(H).padStart(2, '0')}ч ${String(M).padStart(2, '0')}м ${S.toFixed(1).padStart(4, '0')}с`;
}
function dms(rad) {
  const s = rad < 0 ? '−' : '+'; let d = Math.abs(rad / D2R);
  const D = Math.floor(d); d = (d - D) * 60; const M = Math.floor(d); const S = Math.round((d - M) * 60);
  return `${s}${String(D).padStart(2, '0')}° ${String(M).padStart(2, '0')}′ ${String(Math.min(59, S)).padStart(2, '0')}″`;
}
function angle(rad) {
  const d = rad / D2R;
  if (d >= 1) return `${d.toFixed(d >= 10 ? 0 : 1)}°`;
  if (d * 60 >= 1) return `${(d * 60).toFixed(d * 60 >= 10 ? 0 : 1)}′`;
  return `${(d * 3600).toFixed(d * 3600 >= 10 ? 0 : 1)}″`;
}
function distance(km) {
  if (!Number.isFinite(km)) return '—';
  if (km < 2e6) return `${Math.round(km).toLocaleString('ru-RU')} км`;
  const au = km / AU_KM;
  const lt = km / 299792.458;
  return `${au.toFixed(au < 10 ? 3 : 2)} а.е. (свет ${lt < 3600 ? (lt / 60).toFixed(1) + ' мин' : (lt / 3600).toFixed(2) + ' ч'})`;
}

export class TelescopePanel {
  constructor(ctx, tel) {
    this.ctx = ctx;
    this.tel = tel;
    this.group = 'all';
    this._acc = 1;
    const root = this.root = el('div', 'tel hidden');
    // reticle
    this.reticle = el('div', 'tel-reticle');
    this.reticle.innerHTML = '<svg viewBox="-100 -100 200 200" width="200" height="200"><g stroke="rgba(150,220,255,0.55)" stroke-width="1" fill="none">'
      + '<circle r="38"/><line x1="-100" y1="0" x2="-12" y2="0"/><line x1="12" y1="0" x2="100" y2="0"/><line x1="0" y1="-100" x2="0" y2="-12"/><line x1="0" y1="12" x2="0" y2="100"/>'
      + '</g><text x="4" y="-86" fill="rgba(150,220,255,0.7)" font-size="10">С</text><text x="-96" y="-4" fill="rgba(150,220,255,0.7)" font-size="10">В</text></svg>';
    this.scale = el('div', 'tel-scale'); this.scaleBar = el('i'); this.scaleText = el('span', '', ''); add(this.scale, this.scaleBar, this.scaleText);
    this.warn = el('div', 'tel-warn hidden');
    this.fieldInfo = el('div', 'tel-field');
    // panel
    const p = this.panel = el('div', 'tel-panel');
    const head = el('div', 'tel-head'); add(head, el('span', '', 'ТЕЛЕСКОП'), el('small', '', `D = ${Math.round(tel.aperture * 1000)} мм`));
    this.search = el('input', 'tel-search'); this.search.type = 'search'; this.search.placeholder = 'Поиск: Юпитер, M42, Сириус, NGC 224…';
    this.search.addEventListener('input', () => this._fillList());
    this.search.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { const first = this._items?.[0]; if (first) tel.select(first); this.search.blur(); }
      if (e.key === 'Escape') { this.search.blur(); tel.exit(); }
    });
    const tabs = el('div', 'tel-tabs');
    this.tabs = {};
    for (const [id, label] of GROUPS) {
      const b = el('button', '', label); b.type = 'button';
      b.addEventListener('click', () => { this.group = id; this._fillList(); this._markTabs(); });
      this.tabs[id] = b; tabs.append(b);
    }
    this.list = el('div', 'tel-list');
    this.info = el('div', 'tel-info');
    const zoom = el('div', 'tel-zoom');
    for (const f of PRESETS) {
      const b = el('button', '', f >= 1 ? `${f}°` : `${f * 60}′`); b.type = 'button';
      b.addEventListener('click', () => tel.setFov(f));
      zoom.append(b);
    }
    const foot = el('div', 'tel-foot');
    const centre = el('button', '', 'Центр'); centre.type = 'button';
    centre.addEventListener('click', () => { tel.offset.set(0, 0); });
    const exit = el('button', '', 'Выход (Z)'); exit.type = 'button';
    exit.addEventListener('click', () => tel.exit());
    add(foot, centre, exit);
    const hint = el('div', 'tel-hint', 'Колесо, + / − — увеличение · ЛКМ, стрелки — наведение · N — созвездия · Z / Esc — выход');
    add(p, head, this.search, tabs, this.list, this.info, zoom, foot, hint);
    add(root, this.reticle, this.scale, this.warn, this.fieldInfo, p);
    // HUD button (outside the telescope view)
    this.button = el('button', 'tel-btn hidden', 'ТЕЛЕСКОП (Z)');
    this.button.type = 'button';
    this.button.addEventListener('click', () => tel.enter());
    this._markTabs();
    this._attach();
  }

  /** The panel lives in the HUD root (its CSS variables); the HUD is created after the telescope. */
  _attach() {
    if (this._host) return;
    const host = this.ctx.hud?.root;
    if (!host) return;
    host.append(this.root, this.button);
    this._host = host;
  }

  _markTabs() { for (const id in this.tabs) setClass(this.tabs[id], 'on', id === this.group); }

  show(on) {
    this._attach();
    show(this.root, on);
    if (on) show(this.button, false);
    if (on) { this._fillList(); this.refreshTarget(); }
    else this.search.blur();
  }

  _fillList() {
    const tel = this.tel, list = tel.buildCatalog();
    const q = this.search.value.toLowerCase().replace(/ё/g, 'е').trim();
    let items = list.filter((e) => (this.group === 'all' || e.group === this.group) && (!q || e.search.includes(q)));
    if (!q && this.group === 'all') items = items.filter((e) => e.group === 'sol' || (e.group === 'star' && e.mag < 1.6) || (e.group === 'dso' && e.dso?.ru));
    if (q) items.sort((a, b) => (a.name.toLowerCase().startsWith(q) ? 0 : 1) - (b.name.toLowerCase().startsWith(q) ? 0 : 1));
    items = items.slice(0, 120);
    this._items = items;
    this.list.textContent = '';
    for (const e of items) {
      const row = el('button', 'tel-item'); row.type = 'button';
      add(row, el('span', 'n', e.name), el('span', 't', e.kind === 'body' ? e.type : `${e.type}${e.mag !== undefined && e.mag !== null ? ` · ${e.mag.toFixed(1)}ᵐ` : ''}`));
      row.addEventListener('click', () => tel.select(e));
      if (tel.target === e) row.classList.add('on');
      e._row = row;
      this.list.append(row);
    }
  }

  refreshTarget() {
    for (const e of this._items || []) if (e._row) setClass(e._row, 'on', e === this.tel.target);
    this._acc = 1;
  }

  update(dt, ctx) {
    const tel = this.tel;
    // reticle scale bar: a round angle close to 1/5 of the view height
    const h = ctx.renderer.domElement.clientHeight || 600;
    this._acc += dt;
    if (this._acc < (ctx.quality?.lite ? 0.3 : 0.2) && !ctx.isShot) return;
    this._acc = 0;
    const fovRad = tel.fov * D2R;
    const want = fovRad / 5;
    const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 18000, 36000].map((s) => s / 3600 * D2R);
    const pick = steps.reduce((a, b) => (Math.abs(Math.log(b / want)) < Math.abs(Math.log(a / want)) ? b : a), steps[0]);
    this.scaleBar.style.width = `${Math.round(pick / fovRad * h)}px`;
    setText(this.scaleText, angle(pick));
    // target readout
    const e = tel.target, eph = ctx.ephemeris;
    const lines = [];
    let occl = false;
    if (e) {
      const dir = tel.dirOf(e, this._dir || (this._dir = tel.aim.clone()));
      const ra = Math.atan2(dir.y, dir.x), dec = Math.asin(Math.max(-1, Math.min(1, dir.z)));
      lines.push(['', `<b>${e.name}</b>${e.alt ? ` <span class="d">${e.alt}</span>` : ''}`]);
      lines.push(['Тип', `${e.type}${e.con ? ` · ${e.con}` : ''}`]);
      lines.push(['α / δ (J2000)', `${hms(ra < 0 ? ra + 2 * Math.PI : ra)} ${dms(dec)}`]);
      if (e.kind === 'body') {
        const b = eph.bodies[e.body];
        lines.push(['Расстояние', distance(b.dist)]);
        lines.push(['Блеск', `${b.mag.toFixed(1)}ᵐ`]);
        lines.push(['Видимый диаметр', angle(2 * b.angRadius)]);
        if (e.body !== 'sun') {
          const s = eph.bodies.sun;
          const el2 = Math.acos(Math.max(-1, Math.min(1, (b.topo.x * s.topo.x + b.topo.y * s.topo.y + b.topo.z * s.topo.z) / (b.dist * s.dist))));
          lines.push(['Фаза', `${Math.round(b.illum * 100)} % · угол фазы ${(b.phase / D2R).toFixed(1)}°`]);
          lines.push(['Элонгация', `${(el2 / D2R).toFixed(1)}° от Солнца`]);
        }
        occl = this._behindEarth(ctx, b.topo, b.dist);
      } else if (e.kind === 'star') {
        const s = e.star;
        if (s.dist_pc) lines.push(['Расстояние', `${(s.dist_pc * 3.2616).toFixed(s.dist_pc < 30 ? 1 : 0)} св. лет`]);
        lines.push(['Блеск', `${s.v.toFixed(2)}ᵐ${s.bv !== undefined ? ` · B−V ${s.bv.toFixed(2)}` : ''}`]);
        occl = this._behindEarth(ctx, e.dir, 1e12);
      } else {
        const o = e.dso;
        if (o.v !== undefined || o.b !== undefined) lines.push(['Блеск', `${(o.v ?? o.b).toFixed(1)}ᵐ`]);
        if (o.maj) lines.push(['Размер', `${o.maj.toFixed(o.maj < 10 ? 1 : 0)}′${o.min ? ` × ${o.min.toFixed(o.min < 10 ? 1 : 0)}′` : ''}`]);
        const tile = ctx.sky?.deepSky?.tiles?.find((t) => t.info.id === o.id);
        if (tile) lines.push(['Снимок', `<span class="d">${tile.info.credit} · ${tile.info.licence}</span>`]);
        occl = this._behindEarth(ctx, e.dir, 1e12);
      }
    } else lines.push(['', '<span class="d">Выберите объект в каталоге или наведите телескоп мышью</span>']);
    this.info.innerHTML = lines.map(([k, v]) => (k ? `<div class="r"><span class="k">${k}</span><span class="v">${v}</span></div>` : `<div class="r1">${v}</div>`)).join('');
    // field
    const { M, T } = tel.optics();
    const f = tel.fov >= 1 ? `${tel.fov.toFixed(tel.fov >= 10 ? 0 : 1)}°` : `${(tel.fov * 60).toFixed(tel.fov * 60 >= 10 ? 0 : 1)}′`;
    const ra = Math.atan2(tel.aim.y, tel.aim.x), dec = Math.asin(Math.max(-1, Math.min(1, tel.aim.z)));
    this.fieldInfo.innerHTML = `<div>Поле ${f} · ×${M < 10 ? M.toFixed(1) : Math.round(M)} · пред. звёзды ${Number.isFinite(tel.limitMag) ? tel.limitMag.toFixed(1) : '—'}ᵐ</div>`
      + `<div>${hms(ra < 0 ? ra + 2 * Math.PI : ra)} ${dms(dec)}${tel.target ? ' · слежение' : ' · звёздное ведение'}${T < 0.999 ? ` · зрачок ${(tel.aperture * 1000 / M).toFixed(1)} мм` : ''}</div>`;
    // warnings
    let w = '';
    if (tel.filter) w = 'СОЛНЕЧНЫЙ ФИЛЬТР УСТАНОВЛЕН · смотреть на Солнце без фильтра нельзя — это ослепляет';
    else if (occl) w = 'Объект скрыт Землёй';
    else if (e && e.body !== 'moon' && this._behindMoon(ctx, e)) w = 'Объект скрыт Луной';
    setText(this.warn, w);
    show(this.warn, !!w);
    setClass(this.warn, 'sun', tel.filter);
  }

  _behindMoon(ctx, e) {
    const m = ctx.ephemeris?.bodies?.moon;
    if (!m) return false;
    const d = this.tel.dirOf(e, this._dir2 || (this._dir2 = this.tel.aim.clone()));
    const b = (m.topo.x * d.x + m.topo.y * d.y + m.topo.z * d.z);
    if (b <= 0) return false;
    const dist = e.kind === 'body' ? ctx.ephemeris.bodies[e.body].dist : Infinity;
    return m.dist * m.dist - b * b < m.data.radius * m.data.radius && b < dist;
  }

  _behindEarth(ctx, topo, dist) {
    const o = ctx.orbit;
    // Earth centre relative to the station in ECI = -positionEci
    const p = ctx.universe?.frame?.originEci ?? o.positionEci;
    const n = Math.hypot(topo.x, topo.y, topo.z) || 1;
    const dx = topo.x / n, dy = topo.y / n, dz = topo.z / n;
    const b = -(p.x * dx + p.y * dy + p.z * dz);
    if (b <= 0) return false;
    const c2 = p.x * p.x + p.y * p.y + p.z * p.z - b * b;
    return c2 < (6371 + 30) ** 2 && b < dist;
  }

  /** HUD button: shown where the telescope can be used (observer camera, cupola, EVA). */
  updateButton(ctx, dt) {
    this._btnAcc = (this._btnAcc || 0) + dt;
    if (this._btnAcc < 0.25) return;
    this._btnAcc = 0;
    this._attach();
    const on = !this.tel.active && !ctx.hud?.menu?.visible && !this.tel.unavailable() && !!ctx.hud?.started;
    show(this.button, on);
  }

  dispose() { this.root.remove(); this.button.remove(); }
}
