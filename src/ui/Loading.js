import { el, add, svg, setText } from './dom.js';

/** Loading screen: orbit line with a small station silhouette circling a planet limb, progress bar, Russian text. */
export class Loading {
  constructor(root, { title = 'ОРБИТАЛЬНАЯ СТАНЦИЯ', subtitle = 'НОО · 410 KM' } = {}) {
    this.el = el('div', 'ld');
    this.el.append(this._art());
    this.titleEl = el('div', 'ld-title', title);
    this.subEl = el('div', 'ld-sub', subtitle);
    this.bar = el('div', 'ld-bar'); this.fill = el('i'); this.bar.append(this.fill);
    this.textEl = el('div', 'ld-text', 'Загрузка…');
    add(this.el, this.titleEl, this.subEl, this.bar, this.textEl);
    root.append(this.el);
    this.visible = true;
    this.progress = 0;
    this.baseText = 'Загрузка…';
    this._hideTimer = 0;
  }

  _art() {
    const s = svg('svg', { viewBox: '0 0 360 200', width: 360, height: 200 });
    const defs = svg('defs');
    const g = svg('radialGradient', { id: 'ldEarth', cx: '50%', cy: '0%', r: '100%' });
    g.append(svg('stop', { offset: '0', 'stop-color': '#1b4d7a', 'stop-opacity': '0.9' }), svg('stop', { offset: '0.55', 'stop-color': '#0b2238', 'stop-opacity': '0.9' }), svg('stop', { offset: '1', 'stop-color': '#04070c', 'stop-opacity': '1' }));
    defs.append(g);
    s.append(defs);
    // planet limb (large circle, mostly below the frame) with a thin atmosphere line
    s.append(svg('circle', { cx: 180, cy: 520, r: 390, fill: 'url(#ldEarth)' }));
    s.append(svg('circle', { cx: 180, cy: 520, r: 391, fill: 'none', stroke: 'rgba(120,190,240,0.35)', 'stroke-width': 1.5 }));
    // orbit ellipse (dashed) — also the motion path
    const path = svg('path', { id: 'ldOrbit', d: 'M 180 100 m -150 0 a 150 48 0 1 0 300 0 a 150 48 0 1 0 -300 0', fill: 'none', stroke: 'rgba(147,219,255,0.35)', 'stroke-width': 1, 'stroke-dasharray': '3 5' });
    s.append(path);
    // station silhouette: truss, two modules, four solar wings
    const st = svg('g', { fill: '#cfe6f5' });
    st.append(svg('rect', { x: -14, y: -0.8, width: 28, height: 1.6 }));
    st.append(svg('rect', { x: -4, y: -2.2, width: 9, height: 4.4, rx: 1 }));
    st.append(svg('rect', { x: -13, y: -5.5, width: 4, height: 3.2, fill: '#4fb8ea' }));
    st.append(svg('rect', { x: -13, y: 2.3, width: 4, height: 3.2, fill: '#4fb8ea' }));
    st.append(svg('rect', { x: 9, y: -5.5, width: 4, height: 3.2, fill: '#4fb8ea' }));
    st.append(svg('rect', { x: 9, y: 2.3, width: 4, height: 3.2, fill: '#4fb8ea' }));
    const beacon = svg('circle', { cx: 0, cy: -3, r: 1.1, fill: '#ff6a6a', class: 'beacon' });
    st.append(beacon);
    const anim = svg('animateMotion', { dur: '7s', repeatCount: 'indefinite', rotate: 'auto' });
    anim.append(svg('mpath', { href: '#ldOrbit' }));
    st.append(anim);
    s.append(st);
    // a few stars
    const stars = [[22, 18], [60, 40], [300, 22], [330, 60], [250, 12], [120, 8], [200, 30], [40, 90], [340, 110]];
    for (const [x, y] of stars) s.append(svg('circle', { cx: x, cy: y, r: 0.9, fill: 'rgba(220,235,250,0.7)' }));
    return s;
  }

  show(text) {
    clearTimeout(this._hideTimer);
    this.el.classList.remove('hidden', 'off');
    this.visible = true;
    if (text) { this.baseText = text; this._renderText(); }
  }

  hide(immediate = false) {
    if (!this.visible) return;
    this.visible = false;
    if (immediate) { this.el.classList.add('hidden'); return; }
    this.el.classList.add('off');
    this._hideTimer = setTimeout(() => { if (!this.visible) this.el.classList.add('hidden'); }, 500);
  }

  setProgress(p) {
    const v = Math.max(0, Math.min(1, Number(p) || 0));
    if (v === this.progress) return;
    this.progress = v;
    this.fill.style.transform = `scaleX(${v.toFixed(3)})`;
    this._renderText();
  }

  setTitle(title, subtitle) {
    if (title) setText(this.titleEl, title);
    if (subtitle) setText(this.subEl, subtitle);
  }

  _renderText() {
    const pct = Math.round(this.progress * 100);
    setText(this.textEl, pct > 0 ? `${this.baseText}  ${pct}%` : this.baseText);
  }
}
