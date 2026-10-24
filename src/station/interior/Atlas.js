import * as THREE from 'three';

/**
 * Procedural texture atlas for the interiors: rack faces, panels, screens, bags, hatches, floors, signs
 * and text placards, all drawn on one canvas (plus a parallel emissive canvas for screens and indicator
 * lights) so every textured interior part shares one material and one draw call per zone.
 *
 * Sizes are given in units of a 2048 px atlas and scaled to the actual canvas size. `rect(name)` returns
 * the UV rectangle {u0, v0, u1, v1} (v up, as three's flipped canvas textures expect). Labels are drawn
 * lazily into the free space: `label(text, opts)`.
 */

const FONT = '"DejaVu Sans", "Segoe UI", Roboto, Arial, sans-serif';
const MONO = '"DejaVu Sans Mono", Consolas, monospace';

function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

export class Atlas {
  constructor(size = 2048) {
    this.S = size;                 // width
    this.SH = Math.round(size * 1.5);   // height (labels need the extra room)
    this.k = size / 2048;
    const mk = () => { const c = document.createElement('canvas'); c.width = size; c.height = this.SH; return c; };
    this.canvas = mk(); this.ecanvas = mk();
    this.g = this.canvas.getContext('2d');
    this.ge = this.ecanvas.getContext('2d');
    this.g.fillStyle = '#c8c8c4'; this.g.fillRect(0, 0, size, this.SH);
    this.ge.fillStyle = '#000'; this.ge.fillRect(0, 0, size, this.SH);
    this.rects = new Map();
    this.labels = new Map();
    this.shelfX = 0; this.shelfY = 0; this.shelfH = 0;
    this.pad = Math.max(2, Math.round(4 * this.k));
    this._drawAll();
  }

  /** Allocate w x h (2048 units) and run draw(g, ge, x, y, w, h) in canvas pixels. */
  _alloc(name, w, h, draw) {
    const S = this.S, SH = this.SH, p = this.pad;
    const pw = Math.max(4, Math.round(w * this.k)), ph = Math.max(4, Math.round(h * this.k));
    if (this.shelfX + pw + p > S) { this.shelfX = 0; this.shelfY += this.shelfH + p; this.shelfH = 0; }
    if (this.shelfY + ph > SH) { if (!this._fullWarned) console.warn('[Atlas] full at', name); this._fullWarned = true; return this.rects.get('white') || { u0: 0, v0: 0, u1: 0, v1: 0 }; }
    const x = this.shelfX, y = this.shelfY;
    this.shelfX += pw + p; this.shelfH = Math.max(this.shelfH, ph);
    const g = this.g, ge = this.ge;
    g.save(); ge.save();
    g.beginPath(); g.rect(x, y, pw, ph); g.clip();
    ge.beginPath(); ge.rect(x, y, pw, ph); ge.clip();
    try { draw(g, ge, x, y, pw, ph); } catch (e) { console.warn('[Atlas] draw failed', name, e); }
    g.restore(); ge.restore();
    const r = { u0: (x + 0.5) / S, v0: 1 - (y + ph - 0.5) / SH, u1: (x + pw - 0.5) / S, v1: 1 - (y + 0.5) / SH, px: [x, y, pw, ph] };
    if (name) this.rects.set(name, r);
    return r;
  }

  rect(name) { return this.rects.get(name) || this.rects.get('white'); }

  /** Sub-rectangle of a rect (fractions 0..1, v measured from the bottom). */
  subRect(r, a0, b0, a1, b1) { return { u0: r.u0 + (r.u1 - r.u0) * a0, v0: r.v0 + (r.v1 - r.v0) * b0, u1: r.u0 + (r.u1 - r.u0) * a1, v1: r.v0 + (r.v1 - r.v0) * b1 }; }

  /** Text placard. opts: w, h (2048 units), bg, fg, border, size (font px at 2048), bold, glow (emissive). */
  label(text, opts = {}) {
    const key = `${text}|${JSON.stringify(opts)}`;
    if (this.labels.has(key)) return this.labels.get(key);
    const { w = 192, h = 30, bg = '#f2f1ea', fg = '#1d2126', border = null, size = Math.round(h * 0.56), bold = true, glow = false, align = 'center', stripe = null } = opts;
    const r = this._alloc(null, w, h, (g, ge, x, y, pw, ph) => {
      g.fillStyle = bg; g.fillRect(x, y, pw, ph);
      if (stripe) { g.fillStyle = stripe; g.fillRect(x, y, Math.max(2, ph * 0.18), ph); }
      if (border) { g.strokeStyle = border; g.lineWidth = Math.max(1, ph * 0.06); g.strokeRect(x + g.lineWidth / 2, y + g.lineWidth / 2, pw - g.lineWidth, ph - g.lineWidth); }
      const fs = Math.max(6, size * this.k);
      g.font = `${bold ? 'bold ' : ''}${fs}px ${FONT}`; g.fillStyle = fg; g.textBaseline = 'middle';
      g.textAlign = align;
      const tx = align === 'center' ? x + pw / 2 : align === 'left' ? x + ph * 0.3 + (stripe ? ph * 0.2 : 0) : x + pw - ph * 0.3;
      // shrink to fit
      let m = g.measureText(text).width, f = fs;
      while (m > pw * 0.92 && f > 5) { f *= 0.92; g.font = `${bold ? 'bold ' : ''}${f}px ${FONT}`; m = g.measureText(text).width; }
      g.fillText(text, tx, y + ph / 2 + 1);
      if (glow) { ge.fillStyle = bg; ge.fillRect(x, y, pw, ph); ge.font = g.font; ge.fillStyle = fg; ge.textAlign = align; ge.textBaseline = 'middle'; ge.fillText(text, tx, y + ph / 2 + 1); }
    });
    this.labels.set(key, r);
    return r;
  }

  /** Create the three.js textures (call after all labels are allocated). */
  textures(anisotropy = 4) {
    const mk = (c, color) => {
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = anisotropy;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      return t;
    };
    this.map = mk(this.canvas, true);
    this.emissiveMap = mk(this.ecanvas, true);
    return { map: this.map, emissiveMap: this.emissiveMap };
  }

  // ------------------------------------------------------------------------------------------ drawing
  _drawAll() {
    const A = (name, w, h, fn) => this._alloc(name, w, h, fn);
    const k = this.k;
    const px = (v) => Math.max(1, v * k);

    // ---------- small solids ----------
    A('white', 16, 16, (g, ge, x, y, w, h) => { g.fillStyle = '#ecebe6'; g.fillRect(x, y, w, h); });
    A('grey', 16, 16, (g, ge, x, y, w, h) => { g.fillStyle = '#9a9c9e'; g.fillRect(x, y, w, h); });
    A('dark', 16, 16, (g, ge, x, y, w, h) => { g.fillStyle = '#26282b'; g.fillRect(x, y, w, h); });
    A('glowWhite', 16, 16, (g, ge, x, y, w, h) => { g.fillStyle = '#fffdf6'; g.fillRect(x, y, w, h); ge.fillStyle = '#fffdf6'; ge.fillRect(x, y, w, h); });
    A('glowGreen', 16, 16, (g, ge, x, y, w, h) => { g.fillStyle = '#5dff7a'; g.fillRect(x, y, w, h); ge.fillStyle = '#3dff60'; ge.fillRect(x, y, w, h); });
    A('glowRed', 16, 16, (g, ge, x, y, w, h) => { g.fillStyle = '#ff4a3a'; g.fillRect(x, y, w, h); ge.fillStyle = '#ff2a1a'; ge.fillRect(x, y, w, h); });
    A('glowAmber', 16, 16, (g, ge, x, y, w, h) => { g.fillStyle = '#ffb23a'; g.fillRect(x, y, w, h); ge.fillStyle = '#ff9a10'; ge.fillRect(x, y, w, h); });
    A('glowBlue', 16, 16, (g, ge, x, y, w, h) => { g.fillStyle = '#5ab4ff'; g.fillRect(x, y, w, h); ge.fillStyle = '#3aa0ff'; ge.fillRect(x, y, w, h); });
    A('velcro', 32, 32, (g, ge, x, y, w, h) => { fuzz(g, x, y, w, h, '#4a4b4d', 0.25, 3); });
    A('velcroW', 32, 32, (g, ge, x, y, w, h) => { fuzz(g, x, y, w, h, '#d9d6cc', 0.15, 5); });
    A('stripes', 128, 32, (g, ge, x, y, w, h) => { stripes(g, x, y, w, h, '#f0c020', '#1a1a1a'); });
    A('stripesRed', 128, 32, (g, ge, x, y, w, h) => { stripes(g, x, y, w, h, '#e8e4dc', '#c42a22'); });

    // ---------- wall closeout panels ----------
    A('panel', 256, 256, (g, ge, x, y, w, h) => { panel(g, x, y, w, h, '#e7e5de', 11, px); });
    A('panelB', 256, 256, (g, ge, x, y, w, h) => {
      panel(g, x, y, w, h, '#e4e2da', 12, px);
      g.fillStyle = '#d2cfc5'; g.fillRect(x + w * 0.2, y + h * 0.18, w * 0.6, h * 0.1);
      txt(g, 'ЗАКРЫТО · CLOSEOUT', x + w / 2, y + h * 0.23, w * 0.055, '#5a5d60');
      velcroDots(g, x, y, w, h, 13);
    });
    A('bulkhead', 256, 256, (g, ge, x, y, w, h) => { for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) panel(g, x + i * w / 2, y + j * h / 2, w / 2, h / 2, '#e3e1d9', 14 + i + j * 2, px); velcroDots(g, x, y, w, h, 15); });
    A('panelRu', 256, 256, (g, ge, x, y, w, h) => { panel(g, x, y, w, h, '#d9d6c4', 21, px, '#b5b29f'); });
    A('panelRuG', 256, 256, (g, ge, x, y, w, h) => { panel(g, x, y, w, h, '#b9c2a6', 22, px, '#8e977c'); });
    A('panelBlue', 256, 256, (g, ge, x, y, w, h) => { panel(g, x, y, w, h, '#6f8296', 23, px, '#53637a'); });

    // ---------- ISPR rack faces (portrait: 1.05 m along the module x 1.6 m across) ----------
    const R = (name, fn) => A(name, 208, 316, fn);
    R('rackLocker', (g, ge, x, y, w, h) => rackLockers(g, ge, x, y, w, h, 4, 31, px));
    R('rackLocker2', (g, ge, x, y, w, h) => rackLockers(g, ge, x, y, w, h, 2, 32, px));
    R('rackDrawers', (g, ge, x, y, w, h) => rackDrawers(g, ge, x, y, w, h, 33, px));
    R('rackExpA', (g, ge, x, y, w, h) => rackExp(g, ge, x, y, w, h, 34, px, 'A'));
    R('rackExpB', (g, ge, x, y, w, h) => rackExp(g, ge, x, y, w, h, 35, px, 'B'));
    R('rackExpC', (g, ge, x, y, w, h) => rackExp(g, ge, x, y, w, h, 36, px, 'C'));
    R('rackFreezer', (g, ge, x, y, w, h) => rackFreezer(g, ge, x, y, w, h, px));
    R('rackEclss', (g, ge, x, y, w, h) => rackEclss(g, ge, x, y, w, h, px, 'O2'));
    R('rackEclss2', (g, ge, x, y, w, h) => rackEclss(g, ge, x, y, w, h, px, 'CO2'));
    R('rackWater', (g, ge, x, y, w, h) => rackEclss(g, ge, x, y, w, h, px, 'H2O'));
    R('rackPower', (g, ge, x, y, w, h) => rackPower(g, ge, x, y, w, h, px));
    R('rackMed', (g, ge, x, y, w, h) => rackMed(g, ge, x, y, w, h, px));
    R('rackGalley', (g, ge, x, y, w, h) => rackGalley(g, ge, x, y, w, h, px));
    R('rackRu', (g, ge, x, y, w, h) => rackRu(g, ge, x, y, w, h, px, 41));
    R('rackRuB', (g, ge, x, y, w, h) => rackRu(g, ge, x, y, w, h, px, 42, true));
    R('rackBlank', (g, ge, x, y, w, h) => { panel(g, x, y, w, h, '#e9e7e0', 51, px); velcroDots(g, x, y, w, h, 52); rackFrame(g, x, y, w, h, px); });
    R('rackCQ', (g, ge, x, y, w, h) => rackCQ(g, ge, x, y, w, h, px));
    R('rackProp', (g, ge, x, y, w, h) => rackProp(g, ge, x, y, w, h, px));

    // ---------- screens (landscape) ----------
    const SC = (name, fn) => A(name, 256, 160, fn);
    SC('scrGraph', (g, ge, x, y, w, h) => screen(g, ge, x, y, w, h, 'graph', px));
    SC('scrMap', (g, ge, x, y, w, h) => screen(g, ge, x, y, w, h, 'map', px));
    SC('scrText', (g, ge, x, y, w, h) => screen(g, ge, x, y, w, h, 'text', px));
    SC('scrEarth', (g, ge, x, y, w, h) => screen(g, ge, x, y, w, h, 'earth', px));
    SC('scrDock', (g, ge, x, y, w, h) => screen(g, ge, x, y, w, h, 'dock', px));
    SC('scrMicro', (g, ge, x, y, w, h) => screen(g, ge, x, y, w, h, 'micro', px));
    SC('scrMed', (g, ge, x, y, w, h) => screen(g, ge, x, y, w, h, 'med', px));
    SC('scrRing', (g, ge, x, y, w, h) => screen(g, ge, x, y, w, h, 'ring', px));
    SC('scrBlue', (g, ge, x, y, w, h) => screen(g, ge, x, y, w, h, 'desk', px));
    A('keyboard', 128, 56, (g, ge, x, y, w, h) => keyboard(g, x, y, w, h));
    A('laptopLid', 128, 88, (g, ge, x, y, w, h) => { g.fillStyle = '#2b2d30'; g.fillRect(x, y, w, h); g.fillStyle = '#3a3c40'; g.fillRect(x + w * 0.4, y + h * 0.4, w * 0.2, h * 0.2); txt(g, 'ThinkPad', x + w * 0.8, y + h * 0.88, h * 0.09, '#777'); });

    // ---------- soft goods ----------
    A('ctb', 160, 112, (g, ge, x, y, w, h) => ctb(g, x, y, w, h, '#d8cfb8', px, 61));
    A('ctbW', 160, 112, (g, ge, x, y, w, h) => ctb(g, x, y, w, h, '#e9e6dc', px, 62));
    A('ctbB', 160, 112, (g, ge, x, y, w, h) => ctb(g, x, y, w, h, '#9fb0c4', px, 63));
    A('ctbSide', 128, 64, (g, ge, x, y, w, h) => { fuzz(g, x, y, w, h, '#d3cab2', 0.08, 64); g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x, y + h * 0.45, w, h * 0.1); });
    A('fabric', 64, 64, (g, ge, x, y, w, h) => fuzz(g, x, y, w, h, '#e3dfd2', 0.07, 65));
    A('fabricBlue', 64, 64, (g, ge, x, y, w, h) => fuzz(g, x, y, w, h, '#3d5f8f', 0.1, 66));
    A('fabricOrange', 64, 64, (g, ge, x, y, w, h) => fuzz(g, x, y, w, h, '#d9772b', 0.1, 67));
    A('fabricGreen', 64, 64, (g, ge, x, y, w, h) => fuzz(g, x, y, w, h, '#5d6e4a', 0.1, 68));
    A('medkit', 128, 96, (g, ge, x, y, w, h) => { fuzz(g, x, y, w, h, '#c9302a', 0.1, 69); g.fillStyle = '#fff'; const c = Math.min(w, h) * 0.5; g.fillRect(x + w / 2 - c * 0.15, y + h / 2 - c * 0.45, c * 0.3, c * 0.9); g.fillRect(x + w / 2 - c * 0.45, y + h / 2 - c * 0.15, c * 0.9, c * 0.3); });
    A('vent', 128, 64, (g, ge, x, y, w, h) => vent(g, x, y, w, h));
    A('grille', 128, 128, (g, ge, x, y, w, h) => grille(g, x, y, w, h));
    A('checklist', 112, 150, (g, ge, x, y, w, h) => paper(g, x, y, w, h, 71));
    A('patch', 128, 128, (g, ge, x, y, w, h) => patch(g, x, y, w, h));
    A('flagRu', 96, 64, (g, ge, x, y, w, h) => { g.fillStyle = '#fff'; g.fillRect(x, y, w, h / 3); g.fillStyle = '#1c3f94'; g.fillRect(x, y + h / 3, w, h / 3); g.fillStyle = '#d52b1e'; g.fillRect(x, y + 2 * h / 3, w, h / 3 + 1); });
    A('photoEarth', 192, 128, (g, ge, x, y, w, h) => earthPhoto(g, x, y, w, h, 81));
    A('photoCrew', 128, 160, (g, ge, x, y, w, h) => crewPhoto(g, x, y, w, h, 82));

    // ---------- hatches and doors ----------
    A('hatchCBM', 256, 256, (g, ge, x, y, w, h) => hatchFace(g, ge, x, y, w, h, px, false));
    A('hatchRu', 256, 256, (g, ge, x, y, w, h) => hatchFace(g, ge, x, y, w, h, px, true));
    A('gloveboxFront', 256, 160, (g, ge, x, y, w, h) => glovebox(g, x, y, w, h, px));
    A('pumpPanel', 256, 256, (g, ge, x, y, w, h) => pumpPanel(g, ge, x, y, w, h, px));
    A('uiaPanel', 256, 192, (g, ge, x, y, w, h) => uiaPanel(g, ge, x, y, w, h, px));
    A('gauge', 96, 96, (g, ge, x, y, w, h) => gauge(g, x, y, w, h, 0.62));

    // ---------- gravity ring ----------
    A('floorGrate', 256, 256, (g, ge, x, y, w, h) => floorGrate(g, x, y, w, h, px));
    A('carpet', 128, 128, (g, ge, x, y, w, h) => fuzz(g, x, y, w, h, '#5b6470', 0.12, 91));
    A('wallRing', 256, 256, (g, ge, x, y, w, h) => { panel(g, x, y, w, h, '#dedcd4', 92, px, '#b9b6ad'); g.fillStyle = '#9fb0c2'; g.fillRect(x, y + h * 0.82, w, h * 0.05); });
    A('ceilRing', 256, 128, (g, ge, x, y, w, h) => { panel(g, x, y, w, h, '#ecebe6', 93, px, '#c9c7c0'); });
    A('doorRing', 128, 256, (g, ge, x, y, w, h) => doorRing(g, ge, x, y, w, h, px));
    A('wood', 128, 128, (g, ge, x, y, w, h) => wood(g, x, y, w, h, 94));
    A('mat', 128, 128, (g, ge, x, y, w, h) => fuzz(g, x, y, w, h, '#2e3a47', 0.15, 95));
    A('bedding', 128, 128, (g, ge, x, y, w, h) => { fuzz(g, x, y, w, h, '#7c95b3', 0.08, 96); g.fillStyle = 'rgba(255,255,255,0.25)'; for (let i = 0; i < 4; i++) g.fillRect(x, y + h * (0.1 + i * 0.25), w, h * 0.05); });
    A('leaf', 64, 64, (g, ge, x, y, w, h) => fuzz(g, x, y, w, h, '#5a8f3a', 0.15, 97));
  }
}

// ------------------------------------------------------------------------------------------------ helpers
function txt(g, s, x, y, size, color = '#222', align = 'center', bold = true, font = FONT) {
  g.font = `${bold ? 'bold ' : ''}${Math.max(5, size)}px ${font}`; g.fillStyle = color; g.textAlign = align; g.textBaseline = 'middle'; g.fillText(s, x, y);
}
function fuzz(g, x, y, w, h, base, amount, seed) {
  g.fillStyle = base; g.fillRect(x, y, w, h);
  const r = rng(seed), n = Math.floor(w * h / 6);
  for (let i = 0; i < n; i++) { const v = r(); g.fillStyle = v < 0.5 ? `rgba(0,0,0,${amount * r()})` : `rgba(255,255,255,${amount * r() * 0.7})`; g.fillRect(x + r() * w, y + r() * h, 1.5, 1.5); }
}
function stripes(g, x, y, w, h, a, b) {
  g.fillStyle = a; g.fillRect(x, y, w, h); g.fillStyle = b;
  const s = h * 0.9;
  for (let t = -h; t < w + h; t += s * 2) { g.beginPath(); g.moveTo(x + t, y + h); g.lineTo(x + t + s, y + h); g.lineTo(x + t + s + h, y); g.lineTo(x + t + h, y); g.closePath(); g.fill(); }
}
function screw(g, cx, cy, r) {
  g.fillStyle = '#8d9094'; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#55585c'; g.lineWidth = Math.max(0.6, r * 0.35); g.beginPath(); g.moveTo(cx - r * 0.6, cy); g.lineTo(cx + r * 0.6, cy); g.stroke();
}
function grime(g, x, y, w, h, seed, a = 0.05) {
  const r = rng(seed);
  for (let i = 0; i < 26; i++) {
    const cx = x + r() * w, cy = y + r() * h, rr = (0.05 + r() * 0.2) * Math.min(w, h);
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, rr); gr.addColorStop(0, `rgba(90,85,70,${a * r()})`); gr.addColorStop(1, 'rgba(90,85,70,0)');
    g.fillStyle = gr; g.fillRect(cx - rr, cy - rr, rr * 2, rr * 2);
  }
}
function panel(g, x, y, w, h, base, seed, px, seam = '#bdbab1') {
  g.fillStyle = base; g.fillRect(x, y, w, h);
  grime(g, x, y, w, h, seed, 0.06);
  // bevelled edge
  g.strokeStyle = seam; g.lineWidth = px(3); g.strokeRect(x + px(1.5), y + px(1.5), w - px(3), h - px(3));
  g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = px(1); g.strokeRect(x + px(4), y + px(4), w - px(8), h - px(8));
  const r = Math.max(1.2, w * 0.016);
  for (const [a, b] of [[0.06, 0.06], [0.94, 0.06], [0.06, 0.94], [0.94, 0.94], [0.5, 0.06], [0.5, 0.94]]) screw(g, x + a * w, y + b * h, r);
}
function velcroDots(g, x, y, w, h, seed) {
  const r = rng(seed);
  for (let i = 0; i < 7; i++) {
    const vw = w * (0.05 + r() * 0.07), vh = vw * (0.5 + r() * 0.8);
    const vx = x + w * (0.1 + r() * 0.75), vy = y + h * (0.12 + r() * 0.75);
    g.fillStyle = r() < 0.7 ? '#4b4c4e' : '#d6d2c6'; g.fillRect(vx, vy, vw, vh);
  }
}
function rackFrame(g, x, y, w, h, px) {
  g.strokeStyle = '#a7a59d'; g.lineWidth = px(6); g.strokeRect(x + px(3), y + px(3), w - px(6), h - px(6));
  // seat-track holes along the long edges
  g.fillStyle = '#6d6f72';
  for (let t = 0.04; t < 0.98; t += 0.035) { g.fillRect(x + px(2), y + t * h, px(3), px(2)); g.fillRect(x + w - px(5), y + t * h, px(3), px(2)); }
}
function handleBar(g, x, y, w, h) {
  g.fillStyle = '#3f4144'; g.fillRect(x, y, w, h);
  g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(x, y, w, h * 0.3);
}
function latch(g, cx, cy, s) {
  g.fillStyle = '#5e6165'; g.fillRect(cx - s, cy - s * 0.5, s * 2, s);
  g.fillStyle = '#2a2c2f'; g.beginPath(); g.arc(cx, cy, s * 0.35, 0, Math.PI * 2); g.fill();
}
function barcode(g, x, y, w, h, seed) {
  g.fillStyle = '#fff'; g.fillRect(x, y, w, h);
  const r = rng(seed); let t = x + w * 0.05;
  g.fillStyle = '#111';
  while (t < x + w * 0.95) { const bw = Math.max(0.6, w * 0.012 * (1 + Math.floor(r() * 3))); if (r() > 0.4) g.fillRect(t, y + h * 0.1, bw, h * 0.6); t += bw * 1.3; }
}
function led(g, ge, cx, cy, r, color) {
  g.fillStyle = color; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  if (ge) { ge.fillStyle = color; ge.beginPath(); ge.arc(cx, cy, r, 0, Math.PI * 2); ge.fill(); }
}
function toggle(g, cx, cy, s) {
  g.fillStyle = '#777a7e'; g.beginPath(); g.arc(cx, cy, s, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#d8d8d8'; g.fillRect(cx - s * 0.25, cy - s * 1.6, s * 0.5, s * 1.6);
}
function knob(g, cx, cy, s) {
  g.fillStyle = '#1e1f21'; g.beginPath(); g.arc(cx, cy, s, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#ddd'; g.lineWidth = Math.max(0.6, s * 0.2); g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx, cy - s); g.stroke();
}
function connector(g, cx, cy, s) {
  g.fillStyle = '#9ea2a6'; g.beginPath(); g.arc(cx, cy, s, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#2b2d30'; g.beginPath(); g.arc(cx, cy, s * 0.62, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#c9a23a'; for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; g.fillRect(cx + Math.cos(a) * s * 0.35 - 0.5, cy + Math.sin(a) * s * 0.35 - 0.5, 1, 1); }
}

function rackLockers(g, ge, x, y, w, h, n, seed, px) {
  g.fillStyle = '#e3e1da'; g.fillRect(x, y, w, h);
  grime(g, x, y, w, h, seed, 0.05);
  rackFrame(g, x, y, w, h, px);
  const r = rng(seed);
  const top = h * 0.06, bot = h * 0.04, cols = n === 4 ? 2 : 1, rows = n === 4 ? 2 : 2;
  const cw = (w - px(16)) / cols, ch = (h - top - bot) / rows;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const lx = x + px(8) + i * cw, ly = y + top + j * ch;
    g.fillStyle = '#efeee8'; g.fillRect(lx + px(3), ly + px(3), cw - px(6), ch - px(6));
    g.strokeStyle = '#9d9b93'; g.lineWidth = px(2); g.strokeRect(lx + px(3), ly + px(3), cw - px(6), ch - px(6));
    latch(g, lx + cw / 2, ly + px(14), Math.max(2, cw * 0.06));
    latch(g, lx + cw / 2, ly + ch - px(14), Math.max(2, cw * 0.06));
    // label + barcode
    g.fillStyle = '#f8f8f4'; g.fillRect(lx + cw * 0.18, ly + ch * 0.38, cw * 0.64, ch * 0.16);
    txt(g, ['LAB1O', 'NOD2S', 'LAB1P', 'JPM1F'][Math.floor(r() * 4)] + (1 + Math.floor(r() * 6)) + '_' + String.fromCharCode(65 + Math.floor(r() * 5)) + (1 + Math.floor(r() * 4)), lx + cw / 2, ly + ch * 0.43, cw * 0.075, '#222');
    barcode(g, lx + cw * 0.25, ly + ch * 0.48, cw * 0.5, ch * 0.05, seed + i * 7 + j);
    velcroDots(g, lx, ly + ch * 0.55, cw, ch * 0.4, seed + i + j * 3);
  }
  handleBar(g, x + w * 0.1, y + h * 0.015, w * 0.8, h * 0.025);
}

function rackDrawers(g, ge, x, y, w, h, seed, px) {
  g.fillStyle = '#d9d7d0'; g.fillRect(x, y, w, h);
  rackFrame(g, x, y, w, h, px);
  const r = rng(seed);
  const rows = 9, top = h * 0.05, rh = (h - top * 2) / rows;
  for (let j = 0; j < rows; j++) {
    const cols = j % 3 === 0 ? 1 : 2;
    const cw = (w - px(16)) / cols;
    for (let i = 0; i < cols; i++) {
      const dx = x + px(8) + i * cw, dy = y + top + j * rh;
      g.fillStyle = r() < 0.15 ? '#c7cfd8' : '#f1f0ea'; g.fillRect(dx + px(2), dy + px(2), cw - px(4), rh - px(4));
      g.strokeStyle = '#8e8c85'; g.lineWidth = px(1.5); g.strokeRect(dx + px(2), dy + px(2), cw - px(4), rh - px(4));
      g.fillStyle = '#5b5e62'; g.fillRect(dx + cw * 0.35, dy + rh * 0.62, cw * 0.3, rh * 0.12);
      txt(g, `${String.fromCharCode(65 + j)}${i + 1}`, dx + cw * 0.12, dy + rh * 0.3, rh * 0.22, '#333');
      g.fillStyle = '#fbfbf8'; g.fillRect(dx + cw * 0.3, dy + rh * 0.18, cw * 0.5, rh * 0.2);
      txt(g, ['CABLES', 'TOOLS', 'SPARES', 'ФИЛЬТРЫ', 'WIPES', 'КАБЕЛИ', 'BATT', 'SAMPLES'][Math.floor(r() * 8)], dx + cw * 0.55, dy + rh * 0.28, rh * 0.16, '#333');
    }
  }
}

function rackExp(g, ge, x, y, w, h, seed, px, kind) {
  const r = rng(seed);
  g.fillStyle = kind === 'B' ? '#cfd3d6' : '#dddbd4'; g.fillRect(x, y, w, h);
  grime(g, x, y, w, h, seed, 0.06);
  rackFrame(g, x, y, w, h, px);
  // stack of sub-panels with switches, displays and connectors
  let cy = y + h * 0.04;
  const blocks = kind === 'A' ? [0.12, 0.2, 0.1, 0.24, 0.14, 0.12] : kind === 'B' ? [0.16, 0.3, 0.12, 0.2, 0.15] : [0.1, 0.14, 0.34, 0.16, 0.18];
  blocks.forEach((bh, bi) => {
    const ph = bh * h * 0.94, px0 = x + px(8), pw = w - px(16);
    const shade = ['#e9e8e2', '#cfd2d4', '#bfc3c7', '#e2e0d8', '#a9aeb3'][Math.floor(r() * 5)];
    g.fillStyle = shade; g.fillRect(px0, cy + px(2), pw, ph - px(4));
    g.strokeStyle = '#7d8084'; g.lineWidth = px(1.5); g.strokeRect(px0, cy + px(2), pw, ph - px(4));
    screw(g, px0 + px(5), cy + px(7), Math.max(1, px(2))); screw(g, px0 + pw - px(5), cy + px(7), Math.max(1, px(2)));
    const t = r();
    if (t < 0.28) {
      // display
      const dw = pw * 0.42, dh = ph * 0.6, dx = px0 + pw * 0.08, dy = cy + ph * 0.2;
      g.fillStyle = '#0d1a14'; g.fillRect(dx, dy, dw, dh);
      ge.fillStyle = '#0a160f'; ge.fillRect(dx, dy, dw, dh);
      for (let i = 0; i < 4; i++) { g.fillStyle = ge.fillStyle = '#56e08a'; g.fillRect(dx + dw * 0.08, dy + dh * (0.15 + i * 0.2), dw * (0.3 + r() * 0.55), Math.max(1, dh * 0.07)); ge.fillRect(dx + dw * 0.08, dy + dh * (0.15 + i * 0.2), dw * (0.3 + r() * 0.55), Math.max(1, dh * 0.07)); }
      for (let i = 0; i < 4; i++) toggle(g, px0 + pw * (0.6 + i * 0.1), cy + ph * 0.6, Math.max(1.2, ph * 0.07));
      led(g, ge, px0 + pw * 0.62, cy + ph * 0.25, Math.max(1, ph * 0.05), r() < 0.5 ? '#45ff70' : '#ffb030');
    } else if (t < 0.5) {
      for (let i = 0; i < 6; i++) toggle(g, px0 + pw * (0.1 + i * 0.15), cy + ph * 0.6, Math.max(1.2, ph * 0.08));
      for (let i = 0; i < 6; i++) led(g, ge, px0 + pw * (0.1 + i * 0.15), cy + ph * 0.25, Math.max(1, ph * 0.045), r() < 0.7 ? '#45ff70' : r() < 0.5 ? '#ff4030' : '#ffffff');
    } else if (t < 0.7) {
      for (let i = 0; i < 5; i++) connector(g, px0 + pw * (0.12 + i * 0.19), cy + ph * 0.5, Math.max(2, ph * 0.18));
    } else if (t < 0.85) {
      // vent / fan grille
      g.fillStyle = '#6f7378'; for (let i = 0; i < 9; i++) g.fillRect(px0 + pw * 0.1, cy + ph * (0.2 + i * 0.07), pw * 0.45, Math.max(1, ph * 0.03));
      knob(g, px0 + pw * 0.75, cy + ph * 0.5, Math.max(2, ph * 0.16));
    } else {
      g.fillStyle = '#f7f7f3'; g.fillRect(px0 + pw * 0.15, cy + ph * 0.25, pw * 0.7, ph * 0.3);
      txt(g, ['WARNING · ОСТОРОЖНО', 'HOT SURFACE', 'ЭКСПЕРИМЕНТ', 'CAUTION · LASER'][Math.floor(r() * 4)], px0 + pw / 2, cy + ph * 0.4, ph * 0.13, '#a22');
      for (let i = 0; i < 3; i++) knob(g, px0 + pw * (0.25 + i * 0.25), cy + ph * 0.75, Math.max(1.5, ph * 0.08));
    }
    cy += ph;
  });
  g.fillStyle = '#f8f8f4'; g.fillRect(x + w * 0.3, y + h * 0.955, w * 0.4, h * 0.03);
  txt(g, kind === 'A' ? 'EXPRESS RACK 4' : kind === 'B' ? 'КОМПЛЕКС «ПЛАЗМА»' : 'FIR · CIR', x + w / 2, y + h * 0.97, h * 0.017, '#222');
}

function rackFreezer(g, ge, x, y, w, h, px) {
  g.fillStyle = '#e6e5df'; g.fillRect(x, y, w, h);
  rackFrame(g, x, y, w, h, px);
  for (let j = 0; j < 4; j++) {
    const dy = y + h * (0.05 + j * 0.225), dh = h * 0.21;
    g.fillStyle = '#f3f2ee'; g.fillRect(x + px(10), dy, w - px(20), dh);
    g.strokeStyle = '#8c8a84'; g.lineWidth = px(2); g.strokeRect(x + px(10), dy, w - px(20), dh);
    g.fillStyle = '#3c6ea8'; g.fillRect(x + px(10), dy, w - px(20), dh * 0.12);
    txt(g, `MELFI · DEWAR ${j + 1}  −80°C`, x + w / 2, dy + dh * 0.06, dh * 0.08, '#fff');
    g.fillStyle = '#4c4f53'; g.beginPath(); g.arc(x + w * 0.5, dy + dh * 0.58, dh * 0.2, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#9ea1a5'; g.beginPath(); g.arc(x + w * 0.5, dy + dh * 0.58, dh * 0.13, 0, Math.PI * 2); g.fill();
    led(g, ge, x + w * 0.85, dy + dh * 0.3, Math.max(1, dh * 0.04), '#45ff70');
  }
}

function rackEclss(g, ge, x, y, w, h, px, kind) {
  const r = rng(kind.length * 17);
  g.fillStyle = '#dcdad2'; g.fillRect(x, y, w, h);
  grime(g, x, y, w, h, kind.length * 5, 0.07);
  rackFrame(g, x, y, w, h, px);
  const title = { O2: 'OGS · ЭЛЕКТРОН-ВМ', CO2: 'CDRA · ВОЗДУХ', H2O: 'WPA · СРВ-К2М' }[kind];
  g.fillStyle = '#29486e'; g.fillRect(x + px(8), y + h * 0.04, w - px(16), h * 0.05);
  txt(g, title, x + w / 2, y + h * 0.065, h * 0.025, '#fff');
  // piping schematic
  g.strokeStyle = kind === 'H2O' ? '#3a7fc0' : kind === 'O2' ? '#3aa860' : '#8a6d3a'; g.lineWidth = px(3);
  g.beginPath();
  for (let i = 0; i < 6; i++) { const yy = y + h * (0.16 + i * 0.05); g.moveTo(x + w * 0.1, yy); g.lineTo(x + w * (0.4 + r() * 0.5), yy); g.lineTo(x + w * (0.4 + r() * 0.5), yy + h * 0.05); }
  g.stroke();
  for (let i = 0; i < 4; i++) { g.fillStyle = '#efefe9'; g.fillRect(x + w * (0.12 + i * 0.2), y + h * 0.48, w * 0.15, w * 0.15); gauge(g, x + w * (0.12 + i * 0.2), y + h * 0.48, w * 0.15, w * 0.15, r()); }
  // valves panel
  for (let i = 0; i < 5; i++) knob(g, x + w * (0.15 + i * 0.17), y + h * 0.66, Math.max(2, w * 0.035));
  for (let i = 0; i < 5; i++) led(g, ge, x + w * (0.15 + i * 0.17), y + h * 0.72, Math.max(1, w * 0.012), i === 2 ? '#ffb030' : '#45ff70');
  // service ports
  g.fillStyle = '#f4f3ee'; g.fillRect(x + px(10), y + h * 0.78, w - px(20), h * 0.17);
  for (let i = 0; i < 4; i++) connector(g, x + w * (0.18 + i * 0.21), y + h * 0.86, Math.max(2, w * 0.04));
  g.strokeStyle = '#8c8a84'; g.lineWidth = px(1.5); g.strokeRect(x + px(10), y + h * 0.78, w - px(20), h * 0.17);
}

function rackPower(g, ge, x, y, w, h, px) {
  g.fillStyle = '#cfd1cf'; g.fillRect(x, y, w, h);
  rackFrame(g, x, y, w, h, px);
  g.fillStyle = '#7b2222'; g.fillRect(x + px(8), y + h * 0.04, w - px(16), h * 0.045);
  txt(g, 'ПИТАНИЕ · RPCM 120V', x + w / 2, y + h * 0.062, h * 0.022, '#fff');
  const r = rng(77);
  for (let j = 0; j < 7; j++) for (let i = 0; i < 6; i++) {
    const bx = x + w * (0.08 + i * 0.145), by = y + h * (0.12 + j * 0.075);
    g.fillStyle = '#2b2d30'; g.fillRect(bx, by, w * 0.11, h * 0.055);
    g.fillStyle = '#e8e8e2'; g.fillRect(bx + w * 0.035, by + h * (r() < 0.85 ? 0.008 : 0.028), w * 0.04, h * 0.02);
    led(g, ge, bx + w * 0.055, by + h * 0.048, Math.max(0.8, w * 0.008), r() < 0.9 ? '#45ff70' : '#ff4030');
  }
  g.fillStyle = '#f3f2ec'; g.fillRect(x + px(10), y + h * 0.68, w - px(20), h * 0.26);
  g.fillStyle = '#0d1a14'; g.fillRect(x + w * 0.15, y + h * 0.71, w * 0.7, h * 0.12); ge.fillStyle = '#0a160f'; ge.fillRect(x + w * 0.15, y + h * 0.71, w * 0.7, h * 0.12);
  txt(g, '121.4 V   38.2 A', x + w / 2, y + h * 0.77, h * 0.03, '#56e08a', 'center', true, MONO); ge.font = g.font; ge.fillStyle = '#56e08a'; ge.textAlign = 'center'; ge.textBaseline = 'middle'; ge.fillText('121.4 V   38.2 A', x + w / 2, y + h * 0.77);
  stripes(g, x + px(10), y + h * 0.88, w - px(20), h * 0.03, '#f0c020', '#1a1a1a');
}

function rackMed(g, ge, x, y, w, h, px) {
  g.fillStyle = '#ecebe5'; g.fillRect(x, y, w, h);
  rackFrame(g, x, y, w, h, px);
  for (let j = 0; j < 6; j++) {
    const dy = y + h * (0.05 + j * 0.15), dh = h * 0.14;
    g.fillStyle = '#f7f6f2'; g.fillRect(x + px(10), dy, w - px(20), dh);
    g.strokeStyle = '#9a9890'; g.lineWidth = px(1.5); g.strokeRect(x + px(10), dy, w - px(20), dh);
    const c = dh * 0.5, cx = x + w * 0.2, cy = dy + dh / 2;
    g.fillStyle = '#d02a22'; g.fillRect(cx - c * 0.15, cy - c * 0.45, c * 0.3, c * 0.9); g.fillRect(cx - c * 0.45, cy - c * 0.15, c * 0.9, c * 0.3);
    txt(g, ['АПТЕЧКА · MEDS', 'ДЕФИБРИЛЛЯТОР', 'АМП · AMP', 'ДИАГНОСТИКА', 'ШИНЫ · SPLINTS', 'КИСЛОРОД · O₂'][j], x + w * 0.58, cy, dh * 0.17, '#222');
    g.fillStyle = '#5b5e62'; g.fillRect(x + w * 0.4, dy + dh * 0.78, w * 0.35, dh * 0.08);
  }
}

function rackGalley(g, ge, x, y, w, h, px) {
  g.fillStyle = '#e1dfd6'; g.fillRect(x, y, w, h);
  rackFrame(g, x, y, w, h, px);
  const names = ['ЗАВТРАК · BREAKFAST', 'ОБЕД · MEALS', 'НАПИТКИ · DRINKS', 'ХЛЕБ · TORTILLAS', 'ДЕСЕРТ', 'ПРИПРАВЫ · CONDIMENTS', 'ФРУКТЫ'];
  for (let j = 0; j < 7; j++) {
    const dy = y + h * (0.04 + j * 0.135), dh = h * 0.125;
    g.fillStyle = '#f2f1eb'; g.fillRect(x + px(10), dy, w - px(20), dh);
    g.strokeStyle = '#8f8d86'; g.lineWidth = px(1.5); g.strokeRect(x + px(10), dy, w - px(20), dh);
    g.fillStyle = ['#e07a2b', '#3d7d3a', '#2f6aa8', '#b8862e', '#8a3a8a', '#c43a2a', '#2a8a7a'][j]; g.fillRect(x + px(10), dy, px(10), dh);
    txt(g, names[j], x + w * 0.55, dy + dh * 0.35, dh * 0.18, '#222');
    g.fillStyle = '#5b5e62'; g.fillRect(x + w * 0.4, dy + dh * 0.68, w * 0.3, dh * 0.1);
  }
}

function rackRu(g, ge, x, y, w, h, px, seed, alt = false) {
  const r = rng(seed);
  g.fillStyle = alt ? '#c6cdb4' : '#d8d4c0'; g.fillRect(x, y, w, h);
  grime(g, x, y, w, h, seed, 0.08);
  g.strokeStyle = '#8f8c78'; g.lineWidth = px(5); g.strokeRect(x + px(3), y + px(3), w - px(6), h - px(6));
  let cy = y + h * 0.04;
  for (let j = 0; j < 5; j++) {
    const ph = h * (0.12 + r() * 0.1);
    if (cy + ph > y + h * 0.96) break;
    g.fillStyle = alt ? '#b3bb9f' : '#cbc6b0'; g.fillRect(x + px(10), cy, w - px(20), ph - px(4));
    g.strokeStyle = '#7e7b68'; g.lineWidth = px(1.5); g.strokeRect(x + px(10), cy, w - px(20), ph - px(4));
    for (const [a, b] of [[0.06, 0.15], [0.94, 0.15], [0.06, 0.85], [0.94, 0.85]]) screw(g, x + w * a, cy + ph * b, Math.max(1, px(2.5)));
    g.fillStyle = '#f2efe0'; g.fillRect(x + w * 0.15, cy + ph * 0.12, w * 0.5, ph * 0.18);
    txt(g, ['БЛОК УПРАВЛЕНИЯ', 'ПАНЕЛЬ 405', 'СОТР · ЛИНИЯ 2', 'БВП-4М', 'КОММУТАЦИЯ', 'ПУЛЬТ «НЕПТУН»'][Math.floor(r() * 6)], x + w * 0.4, cy + ph * 0.21, ph * 0.1, '#222');
    if (r() < 0.5) for (let i = 0; i < 5; i++) { toggle(g, x + w * (0.15 + i * 0.16), cy + ph * 0.62, Math.max(1.2, ph * 0.07)); led(g, ge, x + w * (0.15 + i * 0.16), cy + ph * 0.85, Math.max(1, ph * 0.035), r() < 0.8 ? '#45ff70' : '#ffb030'); }
    else { for (let i = 0; i < 3; i++) { gauge(g, x + w * (0.1 + i * 0.28), cy + ph * 0.35, w * 0.2, w * 0.2, r()); } }
    cy += ph;
  }
}

function rackCQ(g, ge, x, y, w, h, px) {
  // crew-quarters door: soft fabric door with zipper and name tag
  fuzz(g, x, y, w, h, '#e5e1d4', 0.06, 101);
  g.strokeStyle = '#a19c8b'; g.lineWidth = px(6); g.strokeRect(x + px(4), y + px(4), w - px(8), h - px(8));
  g.strokeStyle = '#555'; g.lineWidth = px(2); g.setLineDash([px(3), px(2)]); g.beginPath(); g.moveTo(x + w * 0.85, y + h * 0.08); g.lineTo(x + w * 0.85, y + h * 0.92); g.stroke(); g.setLineDash([]);
  g.fillStyle = '#f8f7f2'; g.fillRect(x + w * 0.2, y + h * 0.12, w * 0.5, h * 0.07);
  txt(g, 'ЭКИПАЖ · CQ', x + w * 0.45, y + h * 0.155, h * 0.025, '#223');
  g.fillStyle = '#1c3f94'; g.fillRect(x + w * 0.2, y + h * 0.22, w * 0.18, h * 0.03);
  for (let i = 0; i < 3; i++) { g.fillStyle = '#c9c3b0'; g.fillRect(x + w * 0.2, y + h * (0.32 + i * 0.12), w * 0.5, h * 0.08); }
  velcroDots(g, x, y + h * 0.5, w, h * 0.4, 102);
  g.fillStyle = '#3c3e41'; g.fillRect(x + w * 0.78, y + h * 0.45, w * 0.05, h * 0.1);
}

function rackProp(g, ge, x, y, w, h, px) {
  g.fillStyle = '#cdd0c8'; g.fillRect(x, y, w, h);
  rackFrame(g, x, y, w, h, px);
  g.fillStyle = '#204a2a'; g.fillRect(x + px(8), y + h * 0.04, w - px(16), h * 0.05);
  txt(g, 'ДВИГАТЕЛЬНАЯ УСТАНОВКА · PROP', x + w / 2, y + h * 0.065, h * 0.02, '#fff');
  // tank diagram
  for (let i = 0; i < 4; i++) {
    const cx = x + w * (0.2 + i * 0.2), cy = y + h * 0.25;
    g.strokeStyle = '#333'; g.lineWidth = px(2); g.beginPath(); g.ellipse(cx, cy, w * 0.07, h * 0.08, 0, 0, Math.PI * 2); g.stroke();
    g.fillStyle = i % 2 ? '#c84' : '#48c'; g.fillRect(cx - w * 0.05, cy, w * 0.1, h * 0.06);
    txt(g, i % 2 ? 'Г' : 'О', cx, cy - h * 0.03, h * 0.025, '#222');
  }
  g.strokeStyle = '#2a6a3a'; g.lineWidth = px(3); g.beginPath(); g.moveTo(x + w * 0.2, y + h * 0.33); g.lineTo(x + w * 0.2, y + h * 0.42); g.lineTo(x + w * 0.8, y + h * 0.42); g.lineTo(x + w * 0.8, y + h * 0.33); g.moveTo(x + w * 0.5, y + h * 0.42); g.lineTo(x + w * 0.5, y + h * 0.5); g.stroke();
  for (let i = 0; i < 6; i++) { knob(g, x + w * (0.12 + i * 0.15), y + h * 0.58, Math.max(2, w * 0.035)); led(g, ge, x + w * (0.12 + i * 0.15), y + h * 0.64, Math.max(1, w * 0.012), '#45ff70'); }
  for (let i = 0; i < 2; i++) gauge(g, x + w * (0.15 + i * 0.45), y + h * 0.7, w * 0.25, w * 0.25, 0.4 + i * 0.2);
}

function screen(g, ge, x, y, w, h, kind, px) {
  const fill = (c) => { g.fillStyle = c; ge.fillStyle = c; };
  const rect = (a, b, c, d) => { g.fillRect(a, b, c, d); ge.fillRect(a, b, c, d); };
  const text = (s, tx, ty, size, color, align = 'left') => { for (const c of [g, ge]) { c.font = `${Math.max(5, size)}px ${MONO}`; c.fillStyle = color; c.textAlign = align; c.textBaseline = 'middle'; c.fillText(s, tx, ty); } };
  // bezel
  g.fillStyle = '#1a1b1d'; g.fillRect(x, y, w, h); ge.fillStyle = '#000'; ge.fillRect(x, y, w, h);
  const b = px(6), sx = x + b, sy = y + b, sw = w - 2 * b, sh = h - 2 * b;
  const bg = { graph: '#0b1424', map: '#0a1830', text: '#06120a', earth: '#000', dock: '#050607', micro: '#10101a', med: '#050c10', ring: '#0b1424', desk: '#16365e' }[kind];
  fill(bg); rect(sx, sy, sw, sh);
  const r = rng(kind.length * 31 + 7);
  if (kind === 'graph' || kind === 'ring') {
    fill('#1f3550'); for (let i = 1; i < 5; i++) rect(sx, sy + sh * i / 5, sw, 1);
    for (const [col, off] of [['#4fc3ff', 0.3], ['#ffd34f', 0.6], ['#7dff8a', 0.8]]) {
      for (const c of [g, ge]) { c.strokeStyle = col; c.lineWidth = Math.max(1, px(1.5)); c.beginPath(); for (let i = 0; i <= 40; i++) { const tx = sx + sw * i / 40, ty = sy + sh * (off + 0.12 * Math.sin(i * 0.5 + off * 9) * (0.5 + r() * 0.5)); i ? c.lineTo(tx, ty) : c.moveTo(tx, ty); } c.stroke(); }
    }
    fill('#cfe6ff'); text(kind === 'ring' ? 'КОЛЬЦО · ω 0.300 рад/с · g 0.37' : 'ppO2 21.3 kPa · ppCO2 0.31 kPa', sx + 4, sy + sh * 0.08, sh * 0.08, '#cfe6ff');
  } else if (kind === 'map') {
    // world map with orbit track
    fill('#123a6a'); rect(sx, sy, sw, sh);
    fill('#3f7a3e');
    for (let i = 0; i < 9; i++) { const cx = sx + r() * sw, cy = sy + sh * (0.25 + r() * 0.5), rw = sw * (0.05 + r() * 0.12), rh = sh * (0.06 + r() * 0.16); for (const c of [g, ge]) { c.beginPath(); c.ellipse(cx, cy, rw, rh, r() * 3, 0, Math.PI * 2); c.fill(); } }
    for (const c of [g, ge]) { c.strokeStyle = '#ffe14d'; c.lineWidth = Math.max(1, px(2)); c.beginPath(); for (let i = 0; i <= 60; i++) { const tx = sx + sw * i / 60, ty = sy + sh * (0.5 - 0.32 * Math.sin(i / 60 * Math.PI * 2 + 0.6)); i ? c.lineTo(tx, ty) : c.moveTo(tx, ty); } c.stroke(); }
    fill('rgba(0,0,0,0.35)'); rect(sx + sw * 0.62, sy, sw * 0.38, sh);
    fill('#ff4a3a'); rect(sx + sw * 0.31, sy + sh * 0.18, px(5), px(5));
    text('АВРОРА  T+00:10', sx + 4, sy + sh * 0.92, sh * 0.08, '#e8f3ff');
  } else if (kind === 'text' || kind === 'med') {
    const col = kind === 'med' ? '#7dffe0' : '#7dff8a';
    for (let i = 0; i < 10; i++) text(['> SYS NOMINAL', 'CABIN  101.3 kPa', 'T  22.4 C  RH 41%', 'O2  21.2 %', 'CO2  2.3 mmHg', 'H2O  412 L', 'PWR  98.2 kW', 'ПУЛЬС 64  SpO2 98', 'LINK  Ku  OK', 'TDRS-W  AOS'][(i + (kind === 'med' ? 6 : 0)) % 10], sx + 4, sy + sh * (0.08 + i * 0.092), sh * 0.075, col);
    if (kind === 'med') { for (const c of [g, ge]) { c.strokeStyle = '#3dff60'; c.lineWidth = Math.max(1, px(1.5)); c.beginPath(); for (let i = 0; i <= 60; i++) { const tx = sx + sw * (0.45 + 0.5 * i / 60), ph = (i % 15) / 15, ty = sy + sh * (0.55 - (ph > 0.4 && ph < 0.47 ? 0.3 : ph > 0.47 && ph < 0.52 ? -0.1 : 0)); i ? c.lineTo(tx, ty) : c.moveTo(tx, ty); } c.stroke(); } }
  } else if (kind === 'earth') {
    const gr = g.createRadialGradient(sx + sw * 0.5, sy + sh * 1.6, sh * 0.5, sx + sw * 0.5, sy + sh * 1.6, sh * 1.25);
    gr.addColorStop(0, '#1d4e86'); gr.addColorStop(0.85, '#3c8bd0'); gr.addColorStop(0.92, '#a8dcff'); gr.addColorStop(1, '#000');
    for (const c of [g, ge]) { c.fillStyle = gr; c.fillRect(sx, sy, sw, sh); }
    fill('rgba(255,255,255,0.55)'); for (let i = 0; i < 18; i++) { const cx = sx + r() * sw, cy = sy + sh * (0.55 + r() * 0.45); for (const c of [g, ge]) { c.beginPath(); c.ellipse(cx, cy, sw * 0.06 * r() + 2, sh * 0.02 + 1, 0, 0, Math.PI * 2); c.fill(); } }
    text('CAM 3 · НАДИР', sx + 4, sy + sh * 0.08, sh * 0.07, '#e8f3ff');
  } else if (kind === 'dock') {
    fill('#0c0d10'); rect(sx, sy, sw, sh);
    for (const c of [g, ge]) { c.strokeStyle = '#d8d8d8'; c.lineWidth = Math.max(1, px(1.5)); c.beginPath(); c.arc(sx + sw / 2, sy + sh / 2, sh * 0.3, 0, Math.PI * 2); c.stroke(); c.beginPath(); c.moveTo(sx + sw / 2 - sh * 0.1, sy + sh / 2); c.lineTo(sx + sw / 2 + sh * 0.1, sy + sh / 2); c.moveTo(sx + sw / 2, sy + sh / 2 - sh * 0.1); c.lineTo(sx + sw / 2, sy + sh / 2 + sh * 0.1); c.stroke(); }
    for (const c of [g, ge]) { c.strokeStyle = '#4dff6a'; c.beginPath(); c.moveTo(sx, sy + sh / 2); c.lineTo(sx + sw * 0.2, sy + sh / 2); c.moveTo(sx + sw * 0.8, sy + sh / 2); c.lineTo(sx + sw, sy + sh / 2); c.stroke(); }
    text('СТЫКОВКА · D 42.6 m  V 0.12', sx + 4, sy + sh * 0.92, sh * 0.075, '#4dff6a');
  } else if (kind === 'micro') {
    fill('#182030'); rect(sx, sy, sw, sh);
    for (let i = 0; i < 26; i++) { const cx = sx + r() * sw, cy = sy + r() * sh, rr = sh * (0.03 + r() * 0.07); for (const c of [g, ge]) { c.fillStyle = `rgba(${120 + r() * 100},${200 + r() * 55},${140 + r() * 80},0.8)`; c.beginPath(); c.arc(cx, cy, rr, 0, Math.PI * 2); c.fill(); } }
    text('LMM ×400  CELL-07', sx + 4, sy + sh * 0.9, sh * 0.075, '#fff');
  } else if (kind === 'desk') {
    for (let i = 0; i < 6; i++) { fill(['#f4f4f4', '#ffd34f', '#7dc8ff'][i % 3]); rect(sx + sw * (0.06 + (i % 3) * 0.3), sy + sh * (0.2 + Math.floor(i / 3) * 0.38), sw * 0.24, sh * 0.28); }
    fill('#0b1e34'); rect(sx, sy + sh * 0.88, sw, sh * 0.12);
  }
  // glare
  const gr = g.createLinearGradient(sx, sy, sx + sw, sy + sh); gr.addColorStop(0, 'rgba(255,255,255,0.08)'); gr.addColorStop(0.5, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(sx, sy, sw, sh);
}

function keyboard(g, x, y, w, h) {
  g.fillStyle = '#2a2b2e'; g.fillRect(x, y, w, h);
  g.fillStyle = '#45474b';
  const kx = w / 15, ky = h / 5.5;
  for (let j = 0; j < 5; j++) for (let i = 0; i < 14; i++) g.fillRect(x + kx * (0.5 + i), y + ky * (0.4 + j), kx * 0.8, ky * 0.75);
  g.fillStyle = '#3a3c40'; g.fillRect(x + w * 0.4, y + h * 0.86, w * 0.2, h * 0.1);
}

function ctb(g, x, y, w, h, base, px, seed) {
  fuzz(g, x, y, w, h, base, 0.08, seed);
  g.strokeStyle = 'rgba(0,0,0,0.2)'; g.lineWidth = px(3); g.strokeRect(x + px(2), y + px(2), w - px(4), h - px(4));
  // clear label pocket with a card
  g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillRect(x + w * 0.2, y + h * 0.25, w * 0.6, h * 0.4);
  g.strokeStyle = 'rgba(80,80,80,0.6)'; g.lineWidth = px(1); g.strokeRect(x + w * 0.2, y + h * 0.25, w * 0.6, h * 0.4);
  const r = rng(seed);
  txt(g, ['CTB 1.0', 'CTB 2.0', 'M-01', 'ЕДА · FOOD', 'ОДЕЖДА', 'ФИЛЬТРЫ', 'HYGIENE'][Math.floor(r() * 7)], x + w / 2, y + h * 0.36, h * 0.1, '#222');
  barcode(g, x + w * 0.28, y + h * 0.47, w * 0.44, h * 0.12, seed);
  // handle strap
  g.fillStyle = 'rgba(40,40,40,0.35)'; g.fillRect(x + w * 0.35, y + h * 0.78, w * 0.3, h * 0.08);
}

function vent(g, x, y, w, h) {
  g.fillStyle = '#c9c8c2'; g.fillRect(x, y, w, h);
  g.fillStyle = '#2d2f32';
  for (let i = 0; i < 9; i++) g.fillRect(x + w * 0.06, y + h * (0.12 + i * 0.085), w * 0.88, h * 0.05);
  g.strokeStyle = '#8e8d87'; g.lineWidth = Math.max(1, h * 0.04); g.strokeRect(x + 1, y + 1, w - 2, h - 2);
}

function grille(g, x, y, w, h) {
  g.fillStyle = '#d3d2cc'; g.fillRect(x, y, w, h);
  g.fillStyle = '#26282a';
  const n = 12;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) g.fillRect(x + w * (0.08 + i * 0.07), y + h * (0.08 + j * 0.07), w * 0.045, h * 0.045);
}

function paper(g, x, y, w, h, seed) {
  g.fillStyle = '#f6f5ef'; g.fillRect(x, y, w, h);
  g.fillStyle = '#20406a'; g.fillRect(x, y, w, h * 0.08);
  txt(g, 'ПРОЦЕДУРА 2.105', x + w / 2, y + h * 0.04, h * 0.045, '#fff');
  const r = rng(seed);
  g.fillStyle = '#555';
  for (let i = 0; i < 16; i++) g.fillRect(x + w * 0.08, y + h * (0.13 + i * 0.053), w * (0.4 + r() * 0.5), Math.max(1, h * 0.012));
}

function patch(g, x, y, w, h) {
  const cx = x + w / 2, cy = y + h / 2, rr = Math.min(w, h) * 0.46;
  g.fillStyle = '#c9a23a'; g.beginPath(); g.arc(cx, cy, rr, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#0d2350'; g.beginPath(); g.arc(cx, cy, rr * 0.9, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#2f6fc0'; g.beginPath(); g.arc(cx, cy + rr * 0.55, rr * 0.55, Math.PI, 0); g.fill();
  g.strokeStyle = '#fff'; g.lineWidth = Math.max(1, rr * 0.03); g.beginPath(); g.ellipse(cx, cy, rr * 0.75, rr * 0.25, -0.3, 0, Math.PI * 2); g.stroke();
  txt(g, 'АВРОРА', cx, cy - rr * 0.45, rr * 0.2, '#fff');
  g.fillStyle = '#fff'; for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(cx + (i - 2) * rr * 0.18, cy - rr * 0.05, rr * 0.035, 0, Math.PI * 2); g.fill(); }
}

function earthPhoto(g, x, y, w, h, seed) {
  g.fillStyle = '#f2f2ee'; g.fillRect(x, y, w, h);
  const ix = x + w * 0.05, iy = y + h * 0.06, iw = w * 0.9, ih = h * 0.8;
  const gr = g.createLinearGradient(ix, iy, ix, iy + ih); gr.addColorStop(0, '#02040a'); gr.addColorStop(0.45, '#0b1c3a'); gr.addColorStop(0.5, '#7fc0f0'); gr.addColorStop(0.56, '#2d6fb0'); gr.addColorStop(1, '#1d4a7a');
  g.fillStyle = gr; g.fillRect(ix, iy, iw, ih);
  const r = rng(seed);
  g.fillStyle = 'rgba(255,255,255,0.6)'; for (let i = 0; i < 20; i++) { g.beginPath(); g.ellipse(ix + r() * iw, iy + ih * (0.6 + r() * 0.4), iw * 0.05 * r() + 2, 2, 0, 0, Math.PI * 2); g.fill(); }
}

function crewPhoto(g, x, y, w, h, seed) {
  g.fillStyle = '#f2f2ee'; g.fillRect(x, y, w, h);
  const ix = x + w * 0.06, iy = y + h * 0.05, iw = w * 0.88, ih = h * 0.75;
  g.fillStyle = '#7b8da3'; g.fillRect(ix, iy, iw, ih);
  const r = rng(seed);
  for (let i = 0; i < 4; i++) {
    const cx = ix + iw * (0.2 + i * 0.2), cy = iy + ih * 0.45;
    g.fillStyle = ['#2b3f6a', '#1d4a2a', '#6a2b2b', '#2b3f6a'][i]; g.fillRect(cx - iw * 0.08, cy, iw * 0.16, ih * 0.55);
    g.fillStyle = ['#e0b896', '#c99a7a', '#f0c8a8', '#b88a6a'][Math.floor(r() * 4)]; g.beginPath(); g.arc(cx, cy - ih * 0.05, iw * 0.06, 0, Math.PI * 2); g.fill();
  }
  txt(g, 'ЭКСПЕДИЦИЯ 7', x + w / 2, y + h * 0.88, h * 0.06, '#333');
}

function hatchFace(g, ge, x, y, w, h, px, ru) {
  const base = ru ? '#b9bcab' : '#c7c9c8';
  g.fillStyle = base; g.fillRect(x, y, w, h);
  grime(g, x, y, w, h, ru ? 111 : 112, 0.08);
  g.strokeStyle = ru ? '#8a8d7a' : '#9a9c9c'; g.lineWidth = px(6);
  if (ru) { g.beginPath(); g.arc(x + w / 2, y + h / 2, w * 0.45, 0, Math.PI * 2); g.stroke(); }
  else g.strokeRect(x + w * 0.08, y + h * 0.08, w * 0.84, h * 0.84);
  // instruction placards
  g.fillStyle = '#f5f4ee'; g.fillRect(x + w * 0.2, y + h * 0.12, w * 0.6, h * 0.1);
  txt(g, ru ? 'ЛЮК · ОТКРЫВАТЬ ПРИ ΔP = 0' : 'HATCH · ЛЮК  ΔP < 0.2 PSI', x + w / 2, y + h * 0.17, h * 0.035, '#222');
  g.fillStyle = '#f5f4ee'; g.fillRect(x + w * 0.25, y + h * 0.78, w * 0.5, h * 0.08);
  txt(g, ru ? 'ОТКРЫТЬ ⟲  ЗАКРЫТЬ ⟳' : 'OPEN ⟲ ОТКР · CLOSE ⟳ ЗАКР', x + w / 2, y + h * 0.82, h * 0.03, '#222');
  stripes(g, x + w * 0.1, y + h * 0.9, w * 0.8, h * 0.03, '#f0c020', '#1a1a1a');
  // pressure indicator
  led(g, ge, x + w * 0.82, y + h * 0.3, Math.max(1, w * 0.018), '#45ff70');
}

function glovebox(g, x, y, w, h, px) {
  g.fillStyle = '#d6d8d6'; g.fillRect(x, y, w, h);
  g.fillStyle = '#9fb3c0'; g.fillRect(x + w * 0.06, y + h * 0.1, w * 0.88, h * 0.62);
  g.fillStyle = 'rgba(255,255,255,0.3)'; g.fillRect(x + w * 0.06, y + h * 0.1, w * 0.88, h * 0.15);
  g.fillStyle = '#e8e8e4'; g.fillRect(x + w * 0.06, y + h * 0.76, w * 0.88, h * 0.18);
  txt(g, 'MSG · ПЕРЧАТОЧНЫЙ БОКС', x + w / 2, y + h * 0.85, h * 0.08, '#223');
}

function gauge(g, x, y, w, h, v) {
  const cx = x + w / 2, cy = y + h / 2, rr = Math.min(w, h) * 0.42;
  g.fillStyle = '#2c2e31'; g.beginPath(); g.arc(cx, cy, rr * 1.08, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#f4f3ec'; g.beginPath(); g.arc(cx, cy, rr, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#333'; g.lineWidth = Math.max(0.6, rr * 0.04);
  for (let i = 0; i <= 10; i++) { const a = Math.PI * 0.75 + (i / 10) * Math.PI * 1.5; g.beginPath(); g.moveTo(cx + Math.cos(a) * rr * 0.75, cy + Math.sin(a) * rr * 0.75); g.lineTo(cx + Math.cos(a) * rr * 0.92, cy + Math.sin(a) * rr * 0.92); g.stroke(); }
  g.strokeStyle = '#c22'; g.lineWidth = Math.max(0.8, rr * 0.07); g.beginPath(); g.arc(cx, cy, rr * 0.84, Math.PI * 0.75 + Math.PI * 1.25, Math.PI * 0.75 + Math.PI * 1.5); g.stroke();
  const a = Math.PI * 0.75 + v * Math.PI * 1.5;
  g.strokeStyle = '#111'; g.lineWidth = Math.max(0.8, rr * 0.06); g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * rr * 0.8, cy + Math.sin(a) * rr * 0.8); g.stroke();
}

function pumpPanel(g, ge, x, y, w, h, px) {
  g.fillStyle = '#d6d6d0'; g.fillRect(x, y, w, h);
  g.strokeStyle = '#8b8a84'; g.lineWidth = px(4); g.strokeRect(x + px(2), y + px(2), w - px(4), h - px(4));
  g.fillStyle = '#29486e'; g.fillRect(x + px(6), y + px(6), w - px(12), h * 0.1);
  txt(g, 'DEPRESS PUMP · НАСОС ОТКАЧКИ', x + w / 2, y + h * 0.075, h * 0.04, '#fff');
  gauge(g, x + w * 0.08, y + h * 0.2, w * 0.38, w * 0.38, 0.85);
  txt(g, 'P ШЛЮЗА · kPa', x + w * 0.27, y + h * 0.62, h * 0.035, '#222');
  for (let i = 0; i < 3; i++) { toggle(g, x + w * (0.6 + i * 0.13), y + h * 0.35, Math.max(1.5, w * 0.025)); led(g, ge, x + w * (0.6 + i * 0.13), y + h * 0.22, Math.max(1, w * 0.012), i ? '#45ff70' : '#ffb030'); }
  g.fillStyle = '#c22a22'; g.fillRect(x + w * 0.55, y + h * 0.5, w * 0.35, h * 0.12); txt(g, 'АВАР. НАДДУВ', x + w * 0.725, y + h * 0.56, h * 0.035, '#fff');
  g.fillStyle = '#0d1a14'; g.fillRect(x + w * 0.1, y + h * 0.72, w * 0.8, h * 0.18); ge.fillStyle = '#081208'; ge.fillRect(x + w * 0.1, y + h * 0.72, w * 0.8, h * 0.18);
  txt(g, '101.3 kPa  ΔP 0.0', x + w / 2, y + h * 0.81, h * 0.06, '#56e08a', 'center', true, MONO); ge.font = g.font; ge.fillStyle = '#56e08a'; ge.textAlign = 'center'; ge.textBaseline = 'middle'; ge.fillText('101.3 kPa  ΔP 0.0', x + w / 2, y + h * 0.81);
}

function uiaPanel(g, ge, x, y, w, h, px) {
  g.fillStyle = '#cfd0cb'; g.fillRect(x, y, w, h);
  g.strokeStyle = '#8b8a84'; g.lineWidth = px(4); g.strokeRect(x + px(2), y + px(2), w - px(4), h - px(4));
  txt(g, 'UIA · ПАНЕЛЬ ФАЛОВ', x + w / 2, y + h * 0.08, h * 0.06, '#223');
  for (let i = 0; i < 2; i++) {
    const cx = x + w * (0.27 + i * 0.46);
    connector(g, cx, y + h * 0.35, w * 0.08); connector(g, cx, y + h * 0.62, w * 0.06);
    txt(g, `EV${i + 1}`, cx, y + h * 0.85, h * 0.07, '#222');
    for (let j = 0; j < 3; j++) toggle(g, cx - w * 0.12 + j * w * 0.12, y + h * 0.48, Math.max(1.2, w * 0.018));
    led(g, ge, cx + w * 0.14, y + h * 0.2, Math.max(1, w * 0.014), '#45ff70');
  }
}

function floorGrate(g, x, y, w, h, px) {
  g.fillStyle = '#6a6e73'; g.fillRect(x, y, w, h);
  const n = 16;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    g.fillStyle = (i + j) % 2 ? '#5b5f64' : '#62666b'; g.fillRect(x + i * w / n + 1, y + j * h / n + 1, w / n - 2, h / n - 2);
    g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(x + i * w / n + 1, y + j * h / n + 1, w / n - 2, 1);
  }
  g.strokeStyle = '#43474b'; g.lineWidth = px(4); g.strokeRect(x, y, w, h);
}

function doorRing(g, ge, x, y, w, h, px) {
  g.fillStyle = '#d6d9dc'; g.fillRect(x, y, w, h);
  grime(g, x, y, w, h, 121, 0.05);
  g.strokeStyle = '#9aa0a6'; g.lineWidth = px(4); g.strokeRect(x + px(4), y + px(4), w - px(8), h - px(8));
  g.fillStyle = '#4e6f92'; g.fillRect(x + w * 0.12, y + h * 0.04, w * 0.76, h * 0.05);
  g.fillStyle = '#b8bfc6'; g.fillRect(x + w * 0.8, y + h * 0.45, w * 0.06, h * 0.12);
  led(g, ge, x + w * 0.83, y + h * 0.42, Math.max(1, w * 0.02), '#45ff70');
  g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x + w * 0.49, y + px(4), px(2), h - px(8));
}

function wood(g, x, y, w, h, seed) {
  g.fillStyle = '#b48a5a'; g.fillRect(x, y, w, h);
  const r = rng(seed);
  for (let i = 0; i < 40; i++) { g.strokeStyle = `rgba(80,50,20,${0.1 + r() * 0.15})`; g.lineWidth = 1; g.beginPath(); const yy = y + r() * h; g.moveTo(x, yy); g.bezierCurveTo(x + w * 0.3, yy + r() * 6 - 3, x + w * 0.6, yy + r() * 6 - 3, x + w, yy); g.stroke(); }
}
