import * as THREE from 'three';

/**
 * Decal atlas of the astronaut models, drawn once on a canvas (4096 px on high / ultra, 2048 medium / low,
 * 1024 'lite'): national flag, the station's mission patch, suit lettering and serial plates, name tags,
 * the Orlan chest control panel face, cuff checklist pages, the wrist manometer dial, warning labels,
 * velcro, a wristwatch dial, the hand controller labels, an iris. Alpha marks the decal outline (the
 * material uses alphaTest, so no transparency sorting). `uv(name)` returns the item's rectangle in UV space.
 */

const GRID = 16;
const ITEMS = [
  ['chestPanel', 6, 4], ['checklist', 4, 3], ['patch', 3, 3], ['flag', 3, 2], ['manometer', 2, 2], ['watch', 2, 2],
  ['hcm', 3, 2], ['velcro', 2, 2], ['num6', 2, 2], ['num7', 2, 2], ['orlan', 4, 1], ['aurora', 4, 1],
  ['name6', 4, 1], ['name7', 4, 1], ['nameCrew', 4, 1], ['serial', 4, 1], ['hatchLabel', 4, 1], ['warn', 3, 1],
  ['iris', 1, 1], ['crewPatch', 3, 3], ['gloveTag', 2, 1], ['lcd', 2, 1], ['tetherTag', 2, 1],
];

const FONT = '"Arial Narrow", "Roboto Condensed", Arial, sans-serif';

export class DecalAtlas {
  constructor(size = 2048) {
    this.size = size;
    this.cell = size / GRID;
    this.rects = new Map();
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = size;
    this._pack();
    this._draw();
  }

  _pack() {
    // shelf packing in grid cells, items sorted by height
    const items = [...ITEMS].sort((a, b) => b[2] - a[2] || b[1] - a[1]);
    let x = 0, y = 0, shelf = 0;
    for (const [name, w, h] of items) {
      if (x + w > GRID) { x = 0; y += shelf; shelf = 0; }
      if (y + h > GRID) { console.warn('[suit] decal atlas full at', name); break; }
      this.rects.set(name, { x: x * this.cell, y: y * this.cell, w: w * this.cell, h: h * this.cell });
      x += w; shelf = Math.max(shelf, h);
    }
  }

  /** UV rectangle (flipY texture: canvas top is v = 1). Inset by half a texel against bleeding. */
  uv(name) {
    const r = this.rects.get(name);
    if (!r) return { u0: 0, v0: 0, u1: 0.001, v1: 0.001 };
    const S = this.size, e = 1.5;
    return { u0: (r.x + e) / S, u1: (r.x + r.w - e) / S, v0: 1 - (r.y + r.h - e) / S, v1: 1 - (r.y + e) / S };
  }

  texture(anisotropy = 4) {
    const t = new THREE.CanvasTexture(this.canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = anisotropy;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.name = 'suit:decals';
    return t;
  }

  _draw() {
    const g = this.canvas.getContext('2d');
    g.clearRect(0, 0, this.size, this.size);
    for (const [name, r] of this.rects) {
      g.save();
      g.translate(r.x, r.y);
      g.beginPath(); g.rect(0, 0, r.w, r.h); g.clip();
      const f = this[`_${name}`] || this._text;
      f.call(this, g, r.w, r.h, name);
      g.restore();
    }
  }

  // ---------------------------------------------------------------------------------------- items
  _font(px, weight = 'bold') { return `${weight} ${Math.round(px)}px ${FONT}`; }

  _label(g, w, h, text, { bg = '#f1f0ea', fg = '#1d2024', border = null, size = 0.62, radius = 0.12 } = {}) {
    roundRect(g, 2, 2, w - 4, h - 4, h * radius);
    g.fillStyle = bg; g.fill();
    if (border) { g.lineWidth = Math.max(2, h * 0.05); g.strokeStyle = border; g.stroke(); }
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    let px = h * size;
    g.font = this._font(px);
    while (g.measureText(text).width > w * 0.9 && px > 6) { px *= 0.92; g.font = this._font(px); }
    g.fillText(text, w / 2, h * 0.53);
  }

  _text(g, w, h, name) { this._label(g, w, h, name); }

  _flag(g, w, h) {
    // stitched-on fabric flag (3:2) with a sewn border
    const fh = Math.min(h, w * 2 / 3), fw = fh * 1.5, x0 = (w - fw) / 2, y0 = (h - fh) / 2;
    roundRect(g, x0, y0, fw, fh, fh * 0.04); g.save(); g.clip();
    const c = ['#f4f4f2', '#1c3f94', '#d22630'];
    for (let i = 0; i < 3; i++) { g.fillStyle = c[i]; g.fillRect(x0, y0 + (i * fh) / 3, fw, fh / 3 + 1); }
    stitch(g, x0 + fh * 0.03, y0 + fh * 0.03, fw - fh * 0.06, fh - fh * 0.06, fh * 0.012, 'rgba(70,70,70,0.6)');
    g.restore();
  }

  _patch(g, w, h) { this._roundPatch(g, w, h, 'АВРОРА', 'МКС · ВКД'); }
  _crewPatch(g, w, h) { this._roundPatch(g, w, h, 'АВРОРА', 'ЭКИПАЖ'); }

  _roundPatch(g, w, h, title, sub) {
    const R = Math.min(w, h) / 2 - 3, cx = w / 2, cy = h / 2;
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fillStyle = '#e8e3d0'; g.fill();          // merrowed border
    g.beginPath(); g.arc(cx, cy, R * 0.9, 0, Math.PI * 2); g.save(); g.clip();
    const sky = g.createLinearGradient(0, cy - R, 0, cy + R); sky.addColorStop(0, '#05081a'); sky.addColorStop(1, '#13245a');
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    // aurora curtain
    for (let i = 0; i < 18; i++) {
      const x = cx - R * 0.8 + (i / 17) * R * 1.6, top = cy - R * (0.45 + 0.25 * Math.sin(i * 0.9));
      const gr = g.createLinearGradient(0, top, 0, cy + R * 0.1); gr.addColorStop(0, 'rgba(120,40,160,0)'); gr.addColorStop(0.4, 'rgba(60,230,140,0.75)'); gr.addColorStop(1, 'rgba(60,230,140,0)');
      g.fillStyle = gr; g.fillRect(x, top, R * 0.1, cy + R * 0.1 - top);
    }
    // Earth limb
    g.beginPath(); g.arc(cx, cy + R * 1.55, R * 1.05, 0, Math.PI * 2); g.fillStyle = '#1d5fb0'; g.fill();
    g.lineWidth = R * 0.04; g.strokeStyle = '#8fd0ff'; g.stroke();
    // station silhouette + orbit
    g.strokeStyle = '#f0f0f0'; g.lineWidth = R * 0.035;
    g.beginPath(); g.ellipse(cx, cy + R * 0.05, R * 0.75, R * 0.22, -0.25, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#f0f0f0'; g.fillRect(cx - R * 0.32, cy - R * 0.07, R * 0.64, R * 0.07); g.fillRect(cx - R * 0.03, cy - R * 0.3, R * 0.06, R * 0.5);
    g.fillStyle = '#c99a2e'; g.fillRect(cx - R * 0.5, cy - R * 0.16, R * 0.15, R * 0.25); g.fillRect(cx + R * 0.35, cy - R * 0.16, R * 0.15, R * 0.25);
    g.restore();
    // embroidered text ring
    g.beginPath(); g.arc(cx, cy, R * 0.9, 0, Math.PI * 2); g.lineWidth = R * 0.05; g.strokeStyle = '#c9a43a'; g.stroke();
    g.fillStyle = '#ffffff'; g.font = this._font(R * 0.22); g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(title, cx, cy - R * 0.52);
    g.font = this._font(R * 0.13); g.fillStyle = '#ffd36a'; g.fillText(sub, cx, cy + R * 0.58);
  }

  _orlan(g, w, h) { this._label(g, w, h, 'ОРЛАН-МКС', { bg: 'rgba(0,0,0,0)', fg: '#20366e', size: 0.7 }); }
  _aurora(g, w, h) { this._label(g, w, h, 'СТАНЦИЯ «АВРОРА»', { bg: 'rgba(0,0,0,0)', fg: '#20366e', size: 0.55 }); }
  _name6(g, w, h) { this._label(g, w, h, 'ОРЛОВ А.', { bg: '#f3f1e8', fg: '#16181c', border: '#2a4a8a' }); }
  _name7(g, w, h) { this._label(g, w, h, 'ЗИМИН П.', { bg: '#f3f1e8', fg: '#16181c', border: '#8a2a2a' }); }
  _nameCrew(g, w, h) { this._label(g, w, h, 'ОРЛОВ', { bg: '#1c2a4a', fg: '#e9e6da', border: '#c9a43a', size: 0.55 }); }
  _serial(g, w, h) { this._label(g, w, h, 'СКАФ-9 · ЗАВ. № 06 · 2026', { bg: '#c9ccd0', fg: '#222', size: 0.45, radius: 0.05 }); }
  _hatchLabel(g, w, h) { this._label(g, w, h, 'РАНЕЦ · ЗАКРЫВАТЬ РЫЧАГОМ', { bg: '#f1f0ea', fg: '#a31b1b', border: '#a31b1b', size: 0.42, radius: 0.05 }); }
  _warn(g, w, h) {
    g.fillStyle = '#e9b82a'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#111'; for (let x = -h; x < w; x += h * 0.6) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + h * 0.3, h); g.lineTo(x + h * 0.6, 0); g.lineTo(x + h * 0.3, 0); g.fill(); }
    g.fillStyle = '#e9b82a'; g.fillRect(w * 0.15, h * 0.18, w * 0.7, h * 0.64);
    g.fillStyle = '#111'; g.font = this._font(h * 0.42); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('ВЫСОКОЕ ДАВЛЕНИЕ', w / 2, h * 0.52);
  }
  _num6(g, w, h) { this._bigNum(g, w, h, '6', '#2a4a8a'); }
  _num7(g, w, h) { this._bigNum(g, w, h, '7', '#9a1f1f'); }
  _bigNum(g, w, h, t, c) { g.fillStyle = c; g.font = this._font(h * 0.8); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, w / 2, h * 0.55); }
  _tetherTag(g, w, h) { this._label(g, w, h, 'ФАЛ 1', { bg: '#e9b82a', fg: '#111', size: 0.6, radius: 0.3 }); }
  _gloveTag(g, w, h) { this._label(g, w, h, 'ПЕРЧ. 4К', { bg: '#d8d4c8', fg: '#333', size: 0.5, radius: 0.2 }); }
  _lcd(g, w, h) {
    g.fillStyle = '#0b1810'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#3df08a'; g.font = this._font(h * 0.26, 'normal'); g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillText('P 0.40  O2 98%', w * 0.06, h * 0.1); g.fillText('T 21.5  CO2 0.3', w * 0.06, h * 0.4); g.fillText('РЕЖИМ: ВКД', w * 0.06, h * 0.7);
  }

  _velcro(g, w, h) {
    g.fillStyle = '#2b2d30'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < w * h / 30; i++) { const x = (Math.sin(i * 12.9898) * 43758.5453 % 1 + 1) % 1, y = (Math.sin(i * 78.233) * 12345.678 % 1 + 1) % 1; g.fillStyle = i % 3 ? '#3a3d41' : '#1d1f22'; g.fillRect(x * w, y * h, 2, 2); }
    stitch(g, 4, 4, w - 8, h - 8, w * 0.01, 'rgba(120,120,120,0.8)');
  }

  _manometer(g, w, h) {
    const R = Math.min(w, h) / 2 - 2, cx = w / 2, cy = h / 2;
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fillStyle = '#2c2f33'; g.fill();
    g.beginPath(); g.arc(cx, cy, R * 0.86, 0, Math.PI * 2); g.fillStyle = '#f2f1ea'; g.fill();
    // green / red sectors, scale 0..0.6 kgf/cm2
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25, val = (v) => a0 + (a1 - a0) * (v / 0.6);
    const arc = (v0, v1, col) => { g.beginPath(); g.arc(cx, cy, R * 0.72, val(v0), val(v1)); g.lineWidth = R * 0.1; g.strokeStyle = col; g.stroke(); };
    arc(0.0, 0.25, '#c0392b'); arc(0.36, 0.44, '#27ae60'); arc(0.5, 0.6, '#c0392b');
    g.strokeStyle = '#111'; g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = this._font(R * 0.16);
    for (let i = 0; i <= 12; i++) {
      const v = i * 0.05, a = val(v), r0 = i % 2 ? 0.66 : 0.6;
      g.lineWidth = i % 2 ? R * 0.015 : R * 0.03;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * R * r0, cy + Math.sin(a) * R * r0); g.lineTo(cx + Math.cos(a) * R * 0.78, cy + Math.sin(a) * R * 0.78); g.stroke();
      if (!(i % 4)) g.fillText(v.toFixed(1), cx + Math.cos(a) * R * 0.45, cy + Math.sin(a) * R * 0.45);
    }
    g.font = this._font(R * 0.12, 'normal'); g.fillText('кгс/см²', cx, cy + R * 0.32);
    const a = val(0.4); g.lineWidth = R * 0.04; g.strokeStyle = '#111';
    g.beginPath(); g.moveTo(cx - Math.cos(a) * R * 0.12, cy - Math.sin(a) * R * 0.12); g.lineTo(cx + Math.cos(a) * R * 0.7, cy + Math.sin(a) * R * 0.7); g.stroke();
    g.beginPath(); g.arc(cx, cy, R * 0.07, 0, Math.PI * 2); g.fill();
    // glass glare
    const gl = g.createLinearGradient(cx - R, cy - R, cx + R, cy + R); gl.addColorStop(0, 'rgba(255,255,255,0.25)'); gl.addColorStop(0.5, 'rgba(255,255,255,0)');
    g.beginPath(); g.arc(cx, cy, R * 0.86, 0, Math.PI * 2); g.fillStyle = gl; g.fill();
  }

  _watch(g, w, h) {
    const R = Math.min(w, h) / 2 - 2, cx = w / 2, cy = h / 2;
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fillStyle = '#16181b'; g.fill();
    g.strokeStyle = '#e8e8e2'; g.fillStyle = '#e8e8e2'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2, r0 = i % 5 ? 0.88 : 0.78;
      g.lineWidth = i % 5 ? R * 0.012 : R * 0.04;
      g.beginPath(); g.moveTo(cx + Math.sin(a) * R * r0, cy - Math.cos(a) * R * r0); g.lineTo(cx + Math.sin(a) * R * 0.95, cy - Math.cos(a) * R * 0.95); g.stroke();
    }
    g.font = this._font(R * 0.2); g.fillText('12', cx, cy - R * 0.6); g.fillText('6', cx, cy + R * 0.6); g.fillText('3', cx + R * 0.6, cy); g.fillText('9', cx - R * 0.6, cy);
    g.font = this._font(R * 0.09, 'normal'); g.fillText('UTC  24 Ч', cx, cy + R * 0.3);
    const hand = (a, l, wd, c) => { g.strokeStyle = c; g.lineWidth = R * wd; g.lineCap = 'round'; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.sin(a) * R * l, cy - Math.cos(a) * R * l); g.stroke(); };
    hand(0.9, 0.5, 0.07, '#e8e8e2'); hand(3.9, 0.75, 0.045, '#e8e8e2'); hand(2.2, 0.85, 0.015, '#e06030');
  }

  _iris(g, w, h) {
    const R = Math.min(w, h) / 2, cx = w / 2, cy = h / 2;
    g.fillStyle = '#efeae4'; g.fillRect(0, 0, w, h);
    const gr = g.createRadialGradient(cx, cy, R * 0.1, cx, cy, R * 0.45);
    gr.addColorStop(0, '#2c4a5c'); gr.addColorStop(0.7, '#4b6e7c'); gr.addColorStop(1, '#22323a');
    g.beginPath(); g.arc(cx, cy, R * 0.45, 0, Math.PI * 2); g.fillStyle = gr; g.fill();
    g.beginPath(); g.arc(cx, cy, R * 0.17, 0, Math.PI * 2); g.fillStyle = '#060606'; g.fill();
    g.beginPath(); g.arc(cx - R * 0.12, cy - R * 0.12, R * 0.06, 0, Math.PI * 2); g.fillStyle = 'rgba(255,255,255,0.9)'; g.fill();
  }

  _hcm(g, w, h) {
    g.fillStyle = '#2a2c30'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e8e6de'; g.font = this._font(h * 0.13); g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('УПМ · РУЧКА УПРАВЛЕНИЯ', w / 2, h * 0.14);
    const sw = (x, y, l1, l2, on) => {
      g.fillStyle = '#9aa0a6'; g.fillRect(x - w * 0.04, y - h * 0.1, w * 0.08, h * 0.2);
      g.fillStyle = on ? '#3df08a' : '#555'; g.beginPath(); g.arc(x, y - h * 0.2, h * 0.04, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#e8e6de'; g.font = this._font(h * 0.1, 'normal'); g.fillText(l1, x, y + h * 0.2); g.fillText(l2, x, y + h * 0.32);
    };
    sw(w * 0.2, h * 0.5, 'ПИТ', 'ВКЛ', true); sw(w * 0.45, h * 0.5, 'ОРИЕНТ', 'АВТ', true); sw(w * 0.7, h * 0.5, 'ТЯГА', 'ПОВ/ЛИН', false);
    g.strokeStyle = '#c0392b'; g.lineWidth = h * 0.03; g.strokeRect(w * 0.84, h * 0.32, w * 0.12, h * 0.36);
    g.fillStyle = '#e8e6de'; g.fillText('ТОРМ', w * 0.9, h * 0.5);
  }

  _checklist(g, w, h) {
    g.fillStyle = '#f6f5ef'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#9a1f1f'; g.fillRect(0, 0, w, h * 0.13);
    g.fillStyle = '#fff'; g.font = this._font(h * 0.085); g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText('ВКД-1 · ВЫХОД ИЗ ШЛЮЗА', w * 0.04, h * 0.066);
    const lines = ['1 ГЕРМЕТИЧНОСТЬ  P = 0.40', '2 ФАЛЫ: КАРАБИН → ПОРУЧЕНЬ', '3 УПМ: ПИТАНИЕ ВКЛ, ТЕСТ', '4 ФАРЫ ШЛЕМА: АВТ', '5 СВЕТОФИЛЬТР: ОПУЩЕН', '6 ЛЮК ВЫХОДНОЙ: ОТКРЫТ', '7 ДОКЛАД: «ВЫХОЖУ»', '— ВОЗВРАТ ПРИ O₂ < 30 % —'];
    g.fillStyle = '#16181c'; g.font = this._font(h * 0.068, 'normal');
    lines.forEach((l, i) => { g.fillStyle = i === lines.length - 1 ? '#9a1f1f' : '#16181c'; g.fillText(l, w * 0.04, h * (0.22 + i * 0.1)); });
    g.strokeStyle = '#999'; g.lineWidth = 2; g.strokeRect(1, 1, w - 2, h - 2);
  }

  /** Orlan chest control panel face (unit controls, labels, LCD, connectors). */
  _chestPanel(g, w, h) {
    g.fillStyle = '#d9dad6'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#8b8e92'; g.lineWidth = h * 0.012; g.strokeRect(h * 0.02, h * 0.02, w - h * 0.04, h - h * 0.04);
    g.fillStyle = '#1d2024'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = this._font(h * 0.07); g.fillText('ПУЛЬТ УПРАВЛЕНИЯ СКАФАНДРОМ', w / 2, h * 0.08);
    // toggle switch guards with labels (two rows)
    const lab = [['ВЕНТ', 'ОСН/РЕЗ'], ['НАСОС', 'ВКЛ'], ['СВЯЗЬ', 'ДУПЛ'], ['ФАРЫ', 'ВКЛ'], ['ТЕЛЕМ', 'ВКЛ'], ['ПИТ', 'БАТ'], ['O₂', 'РЕЗ'], ['ТЕПЛО', 'РЕГ']];
    for (let i = 0; i < 8; i++) {
      const col = i % 4, row = Math.floor(i / 4);
      const x = w * (0.1 + col * 0.13), y = h * (0.3 + row * 0.36);
      g.fillStyle = '#41454a'; roundRect(g, x - w * 0.035, y - h * 0.09, w * 0.07, h * 0.18, h * 0.02); g.fill();
      g.fillStyle = '#c9cbcd'; g.beginPath(); g.arc(x, y, h * 0.035, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#1d2024'; g.font = this._font(h * 0.05); g.fillText(lab[i][0], x, y + h * 0.13); g.font = this._font(h * 0.04, 'normal'); g.fillText(lab[i][1], x, y + h * 0.18);
    }
    // LCD block and warning lamps on the right
    g.fillStyle = '#0b1810'; roundRect(g, w * 0.6, h * 0.18, w * 0.35, h * 0.3, h * 0.02); g.fill();
    g.fillStyle = '#3df08a'; g.font = this._font(h * 0.05, 'normal'); g.textAlign = 'left';
    ['P СКАФ 0.40 кгс/см²', 'O₂ 98 %   CO₂ 0.3', 'T 21.5 °C  ВЕНТ ОСН', 'РЕЖИМ ВКД  00:42'].forEach((t, i) => g.fillText(t, w * 0.62, h * (0.23 + i * 0.065)));
    const lamps = [['#d33', 'АВАР'], ['#eb2', 'ВНИМ'], ['#3c4', 'НОРМА'], ['#38f', 'СВЯЗЬ']];
    g.textAlign = 'center';
    lamps.forEach(([c, t], i) => {
      const x = w * (0.64 + i * 0.09), y = h * 0.6;
      g.fillStyle = '#222'; g.beginPath(); g.arc(x, y, h * 0.045, 0, Math.PI * 2); g.fill();
      g.fillStyle = c; g.beginPath(); g.arc(x, y, h * 0.032, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#1d2024'; g.font = this._font(h * 0.04); g.fillText(t, x, y + h * 0.08);
    });
    g.fillStyle = '#1d2024'; g.font = this._font(h * 0.045, 'normal');
    g.fillText('ЗАРЯД БАТ ▮▮▮▮▯', w * 0.78, h * 0.8);
    g.fillText('ЗАВ. № 06', w * 0.78, h * 0.9);
  }
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r); g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h); g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r); g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
}
function stitch(g, x, y, w, h, s, col) { g.save(); g.setLineDash([s * 3, s * 2]); g.lineWidth = s; g.strokeStyle = col; g.strokeRect(x, y, w, h); g.restore(); }
