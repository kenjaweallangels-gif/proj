// Процедурные канвас-текстуры сиетча: три слоя истории (резьба / печати Квизарата / росписи) и ткани.
// Декаль = цветная карта (с альфой) + карта высот для bump. Всё детерминировано (rng).
import * as THREE from 'three';
import { rng } from '../core/util.js';

function cv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function tex(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true;
  return t;
}

/** Декаль: draw(ctx, P, w, h), где P.groove/P.hi/P.paint(c,d) — цвета под режим (color|bump). */
function decal(w, h, draw, { bumpBg = 128 } = {}) {
  const cc = cv(w, h), cb = cv(w, h);
  const x1 = cc.getContext('2d'), x2 = cb.getContext('2d');
  x2.fillStyle = `rgb(${bumpBg},${bumpBg},${bumpBg})`; x2.fillRect(0, 0, w, h);
  const Pc = {
    mode: 'color', groove: 'rgba(36,22,12,0.92)', hi: 'rgba(238,196,138,0.45)', gold: 'rgba(196,152,64,0.85)',
    paint: (col) => col, chalk: 'rgba(235,230,215,0.85)',
  };
  const Pb = {
    mode: 'bump', groove: 'rgb(18,18,18)', hi: 'rgb(210,210,210)', gold: 'rgb(18,18,18)',
    paint: () => 'rgb(150,150,150)', chalk: 'rgb(150,150,150)',
  };
  draw(x1, Pc, w, h); draw(x2, Pb, w, h);
  const t = tex(cc), b = tex(cb, false);
  t.wrapS = t.wrapT = b.wrapS = b.wrapT = THREE.ClampToEdgeWrapping;
  return { map: t, bump: b };
}

function engraved(ctx, P, lw, fn) {
  // «Врезка»: тёмная борозда + светлая кромка со смещением (полировка ладонями).
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = P.hi; ctx.lineWidth = lw * 0.9; ctx.translate(-lw * 0.45, -lw * 0.45); fn(); ctx.restore();
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = P.groove; ctx.lineWidth = lw; fn(); ctx.restore();
}

function wormRings(ctx, P, cx, cy, len, amp, lw) {
  // Червь: волнистое тело, кольцевые сегменты, раскрытая пасть.
  const pts = [];
  for (let i = 0; i <= 60; i++) { const t = i / 60; pts.push([cx - len / 2 + t * len, cy + Math.sin(t * Math.PI * 2.3) * amp * (0.4 + t * 0.6)]); }
  engraved(ctx, P, lw, () => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke(); });
  for (let i = 2; i < 58; i += 3) {
    const [x, y] = pts[i]; const [x2, y2] = pts[i + 1]; const a = Math.atan2(y2 - y, x2 - x) + Math.PI / 2; const r = lw * (2.2 + i / 60 * 1.8);
    engraved(ctx, P, lw * 0.55, () => { ctx.beginPath(); ctx.moveTo(x - Math.cos(a) * r, y - Math.sin(a) * r); ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); ctx.stroke(); });
  }
  const [hx, hy] = pts[60];
  engraved(ctx, P, lw * 0.8, () => { ctx.beginPath(); ctx.arc(hx + lw * 2.2, hy, lw * 3.4, 0, Math.PI * 2); ctx.stroke(); });
  for (let k = 0; k < 9; k++) { const a = k / 9 * Math.PI * 2; engraved(ctx, P, lw * 0.5, () => { ctx.beginPath(); ctx.moveTo(hx + lw * 2.2 + Math.cos(a) * lw * 3.4, hy + Math.sin(a) * lw * 3.4); ctx.lineTo(hx + lw * 2.2 + Math.cos(a) * lw * 2.0, hy + Math.sin(a) * lw * 2.0); ctx.stroke(); }); }
}
function hook(ctx, P, x, y, s, lw, flip = 1) {
  engraved(ctx, P, lw, () => { ctx.beginPath(); ctx.moveTo(x, y + s); ctx.lineTo(x, y - s * 0.4); ctx.bezierCurveTo(x, y - s, x + flip * s * 0.9, y - s, x + flip * s * 0.9, y - s * 0.55); ctx.stroke(); });
}
function drop(ctx, P, x, y, s, lw) {
  engraved(ctx, P, lw, () => { ctx.beginPath(); ctx.moveTo(x, y - s); ctx.bezierCurveTo(x + s * 0.8, y, x + s * 0.7, y + s * 0.8, x, y + s * 0.8); ctx.bezierCurveTo(x - s * 0.7, y + s * 0.8, x - s * 0.8, y, x, y - s); ctx.stroke(); });
}
function spiral(ctx, P, x, y, r0, lw, turns = 2.6) {
  engraved(ctx, P, lw, () => { ctx.beginPath(); for (let i = 0; i <= 80; i++) { const t = i / 80, a = t * turns * Math.PI * 2, r = r0 * t; const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.stroke(); });
}

export function makeTextures() {
  const T = {};
  // --- Слой 1: фрименская резьба (панель 2×2 м) ---
  T.carving = decal(512, 512, (c, P, w, h) => {
    const R = rng(11);
    engraved(c, P, 6, () => { c.beginPath(); c.rect(18, 18, w - 36, h - 36); c.stroke(); });
    for (let i = 0; i < 12; i++) drop(c, P, 40 + i * 36, 40, 9, 4);
    for (let i = 0; i < 12; i++) drop(c, P, 40 + i * 36, h - 40, 9, 4);
    wormRings(c, P, w * 0.5, h * 0.5, w * 0.72, 38, 8);
    hook(c, P, w * 0.22, h * 0.26, 46, 7, 1); hook(c, P, w * 0.78, h * 0.26, 46, 7, -1);
    spiral(c, P, w * 0.2, h * 0.74, 34, 5); spiral(c, P, w * 0.8, h * 0.74, 34, 5, 2.2);
    for (let i = 0; i < 6; i++) drop(c, P, w * 0.35 + i * 24 + R() * 4, h * 0.82, 7, 3.4);
  });
  T.carvingB = decal(512, 512, (c, P, w, h) => {
    for (let r = 0; r < 4; r++) for (let i = 0; i < 6; i++) { const x = 50 + i * 82, y = 60 + r * 120; if ((i + r) % 2) spiral(c, P, x, y, 30, 5, 2.4); else drop(c, P, x, y, 22, 5); }
    engraved(c, P, 6, () => { c.beginPath(); c.rect(16, 16, w - 32, h - 32); c.stroke(); });
  });
  // --- Слой 2: печать Квизарата (кулак с кольцом червя) ---
  T.sigil = decal(512, 512, (c, P) => {
    const cx = 256, cy = 250;
    const stroke = (lw, fn, col) => {
      c.save(); c.lineCap = 'butt'; c.lineJoin = 'miter'; c.strokeStyle = P.groove; c.lineWidth = lw; fn(); c.restore();
      c.save(); c.strokeStyle = col || P.gold; c.lineWidth = lw * 0.25; c.translate(0, lw * 0.18); fn(); c.restore();
    };
    stroke(16, () => { c.beginPath(); c.arc(cx, cy, 200, 0, Math.PI * 2); c.stroke(); });
    stroke(10, () => { c.beginPath(); c.arc(cx, cy, 160, 0.2, Math.PI * 2 - 0.5); c.stroke(); });
    // кольцо червя
    stroke(14, () => { c.beginPath(); c.arc(cx, cy + 20, 78, 0, Math.PI * 2); c.stroke(); });
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; stroke(8, () => { c.beginPath(); c.moveTo(cx + Math.cos(a) * 62, cy + 20 + Math.sin(a) * 62); c.lineTo(cx + Math.cos(a) * 94, cy + 20 + Math.sin(a) * 94); c.stroke(); }); }
    // кулак
    stroke(18, () => { c.beginPath(); c.moveTo(cx - 70, cy + 150); c.lineTo(cx - 80, cy - 30); c.lineTo(cx - 50, cy - 110); c.lineTo(cx + 50, cy - 110); c.lineTo(cx + 80, cy - 30); c.lineTo(cx + 70, cy + 150); c.stroke(); });
    for (let i = 0; i < 4; i++) stroke(10, () => { c.beginPath(); c.moveTo(cx - 52 + i * 35, cy - 108); c.lineTo(cx - 52 + i * 35, cy - 30); c.stroke(); });
    // сбитая надпись
    for (let i = 0; i < 9; i++) { const x = 70 + i * 42; if (i % 3 !== 2) stroke(8, () => { c.beginPath(); c.moveTo(x, 440); c.lineTo(x + 18, 440); c.lineTo(x + 18, 462); c.stroke(); }); }
    // скол от зубила (стёртая половина)
    c.save(); c.globalCompositeOperation = 'destination-out'; c.fillStyle = 'rgba(0,0,0,0.0)'; c.restore();
    // капля, нацарапанная рядом
    engraved(c, P, 3, () => { c.beginPath(); c.moveTo(452, 392); c.bezierCurveTo(466, 410, 462, 428, 452, 428); c.bezierCurveTo(442, 428, 438, 410, 452, 392); c.stroke(); });
  });
  // --- Слой 3: роспись возрожденцев (6×3 м) ---
  T.mural = decal(1024, 512, (c, P, w, h) => {
    const col = P.paint;
    // охристая плашка-фон с подтёками
    c.fillStyle = col('rgba(194,150,76,0.82)'); c.beginPath(); c.roundRect(12, 12, w - 24, h - 24, 18); c.fill();
    c.fillStyle = col('rgba(88,56,28,0.55)'); for (let i = 0; i < 26; i++) { const x = 30 + i * 38; c.fillRect(x, h - 14 - ((i * 53) % 90), 5, 40 + ((i * 53) % 90)); }
    // червь (улыбается)
    c.strokeStyle = col('rgba(44,30,52,0.95)'); c.lineWidth = 46; c.lineCap = 'round';
    c.beginPath(); c.moveTo(620, 470); c.bezierCurveTo(700, 300, 800, 380, 860, 190); c.stroke();
    c.strokeStyle = col('rgba(86,60,88,0.95)'); c.lineWidth = 36; c.stroke();
    c.fillStyle = col('rgba(40,22,26,0.95)'); c.beginPath(); c.arc(860, 160, 70, 0, Math.PI * 2); c.fill();
    c.fillStyle = col('rgba(232,214,170,0.98)'); for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; c.beginPath(); c.moveTo(860 + Math.cos(a) * 62, 160 + Math.sin(a) * 62); c.lineTo(860 + Math.cos(a + 0.12) * 40, 160 + Math.sin(a + 0.12) * 40); c.lineTo(860 + Math.cos(a - 0.12) * 40, 160 + Math.sin(a - 0.12) * 40); c.fill(); }
    c.strokeStyle = col('rgba(232,214,170,0.98)'); c.lineWidth = 7; c.beginPath(); c.arc(860, 168, 36, 0.15, Math.PI - 0.15); c.stroke(); // улыбка
    c.fillStyle = col('rgba(240,240,240,0.98)'); c.beginPath(); c.arc(836, 128, 10, 0, 7); c.arc(884, 128, 10, 0, 7); c.fill();
    c.fillStyle = col('rgba(10,10,10,0.98)'); c.beginPath(); c.arc(838, 130, 5, 0, 7); c.arc(886, 130, 5, 0, 7); c.fill();
    // девочка в синем: пятно-платок вместо лица
    c.fillStyle = col('rgba(30,56,138,0.97)'); c.beginPath(); c.moveTo(300, 120); c.bezierCurveTo(250, 130, 230, 220, 258, 300); c.lineTo(350, 300); c.bezierCurveTo(380, 220, 352, 130, 300, 120); c.fill();
    c.beginPath(); c.moveTo(262, 290); c.lineTo(224, 460); c.lineTo(378, 460); c.lineTo(342, 290); c.fill();
    c.fillStyle = col('rgba(150,100,70,0.95)'); c.beginPath(); c.arc(300, 205, 26, 0, 7); c.fill();
    c.fillStyle = col('rgba(30,56,138,0.97)'); c.beginPath(); c.arc(300, 195, 34, Math.PI * 1.05, Math.PI * 1.95); c.fill();
    c.strokeStyle = col('rgba(30,56,138,0.97)'); c.lineWidth = 20; c.beginPath(); c.moveTo(262, 320); c.lineTo(190, 400); c.moveTo(342, 320); c.lineTo(420, 380); c.stroke();
    // надпись охрой (неровные «буквы»)
    c.strokeStyle = col('rgba(120,60,24,0.95)'); c.lineWidth = 8; c.lineCap = 'round';
    const R = rng(5);
    for (let i = 0; i < 24; i++) { const x = 90 + i * 36 + R() * 6, y = 62 + R() * 10; c.beginPath(); c.moveTo(x, y); c.lineTo(x + 12 + R() * 8, y + 4); c.lineTo(x + 6, y + 26 + R() * 6); c.stroke(); }
    // солнце и капли
    c.fillStyle = col('rgba(200,70,40,0.95)'); c.beginPath(); c.arc(520, 130, 34, 0, 7); c.fill();
    c.fillStyle = col('rgba(40,90,160,0.95)'); for (let i = 0; i < 5; i++) { c.beginPath(); c.moveTo(520 + (i - 2) * 44, 330); c.quadraticCurveTo(520 + (i - 2) * 44 + 14, 360, 520 + (i - 2) * 44, 374); c.quadraticCurveTo(520 + (i - 2) * 44 - 14, 360, 520 + (i - 2) * 44, 330); c.fill(); }
  });
  // --- Детские рисунки мелом (лестница) ---
  T.chalk = decal(512, 256, (c, P, w, h) => {
    const R = rng(7);
    c.lineCap = 'round'; c.lineJoin = 'round';
    for (let k = 0; k < 7; k++) {
      const x0 = 30 + (k % 4) * 120 + R() * 20, y0 = 40 + Math.floor(k / 4) * 120 + R() * 20;
      c.strokeStyle = P.chalk; c.lineWidth = 3 + R() * 2;
      c.beginPath(); c.moveTo(x0, y0 + 20);
      for (let i = 1; i <= 6; i++) c.lineTo(x0 + i * 13, y0 + Math.sin(i + k) * 16 + 14);
      c.stroke(); c.beginPath(); c.arc(x0 + 86, y0 + 14, 9, 0, 7); c.stroke();
      c.beginPath(); c.moveTo(x0 + 40, y0 + 14); c.lineTo(x0 + 40, y0 - 10); c.lineTo(x0 + 50, y0 - 10); c.stroke(); // наездник-палочка
    }
  });
  // --- Вышитая капля вниз (занавесь похоронной ниши) ---
  T.embroidery = decal(256, 256, (c, P) => {
    c.strokeStyle = P.mode === 'color' ? 'rgba(190,206,236,0.95)' : 'rgb(170,170,170)'; c.lineWidth = 6; c.lineCap = 'round';
    c.beginPath(); c.moveTo(128, 220); c.bezierCurveTo(60, 140, 70, 70, 128, 70); c.bezierCurveTo(186, 70, 196, 140, 128, 220); c.stroke();
    c.beginPath(); c.moveTo(128, 70); c.lineTo(128, 28); c.stroke();
  });
  // --- Водяные кольца на шнуре ---
  T.rings = decal(256, 256, () => {});

  // --- Отпечатки ладоней (трафареты охрой/киноварью и тёмные прикосновения) — следы людей всех эпох ---
  T.hands = decal(512, 256, (c, P, w, h) => {
    const R = rng(21);
    const handPath = (x, y, s, rot, flip) => {
      c.save(); c.translate(x, y); c.rotate(rot); c.scale(flip, 1); c.scale(s, s);
      c.beginPath(); c.ellipse(0, 0, 0.52, 0.62, 0, 0, Math.PI * 2);
      const fingers = [[-0.38, -0.55, -0.2, 0.62], [-0.14, -0.7, -0.07, 0.82], [0.12, -0.7, 0.06, 0.78], [0.36, -0.55, 0.2, 0.62]];
      for (const [fx, fy, ang, len] of fingers) { c.moveTo(fx + 0.1, fy); c.ellipse(fx, fy - len / 2 + 0.05, 0.1, len / 2, ang, 0, Math.PI * 2); }
      c.moveTo(-0.5, 0.15); c.ellipse(-0.68, -0.12, 0.1, 0.38, -0.9, 0, Math.PI * 2);
      c.restore();
    };
    const cols = ['rgba(176,70,40,0.92)', 'rgba(205,160,80,0.92)', 'rgba(228,220,196,0.9)'];
    for (let k = 0; k < 4; k++) {
      const x = 70 + k * 120 + R() * 20, y = 90 + R() * 40, s = 46 + R() * 8, rot = (R() - 0.5) * 0.5, col = cols[k % 3];
      if (P.mode === 'color') {
        c.save(); c.fillStyle = col; c.beginPath(); c.ellipse(x, y - 8, s * 1.15, s * 1.25, rot, 0, Math.PI * 2); c.fill();
        c.globalCompositeOperation = 'destination-out'; c.fillStyle = '#000'; handPath(x, y, s, rot, k % 2 ? 1 : -1); c.fill(); c.restore();
      }
    }
    for (let k = 0; k < 3; k++) { c.fillStyle = P.paint('rgba(44,30,24,0.8)'); handPath(100 + k * 150 + R() * 30, 205 + R() * 10, 28, (R() - 0.5) * 0.6, k % 2 ? 1 : -1); c.fill(); }
  });
  // --- Ткани ---
  T.cloth = {};
  const weave = (c, w, h, a = 0.12) => { const R = rng(3); for (let y = 0; y < h; y += 2) { c.fillStyle = `rgba(0,0,0,${R() * a})`; c.fillRect(0, y, w, 1); } for (let x = 0; x < w; x += 2) { c.fillStyle = `rgba(255,255,255,${R() * a * 0.5})`; c.fillRect(x, 0, 1, h); } };
  const mk = (name, fn) => { const c = cv(256, 256); const x = c.getContext('2d'); fn(x, 256, 256); weave(x, 256, 256); T.cloth[name] = tex(c); };
  mk('stripeOchre', (c, w, h) => { c.fillStyle = '#b98a4a'; c.fillRect(0, 0, w, h); const cols = ['#d6b070', '#8a5a2c', '#e0c890', '#6a3c20']; for (let i = 0; i < 16; i++) { c.fillStyle = cols[i % 4]; c.fillRect(i * 16, 0, 5 + (i % 3) * 3, h); } });
  mk('stripeBlue', (c, w, h) => { c.fillStyle = '#26406e'; c.fillRect(0, 0, w, h); const cols = ['#4a68a0', '#16264a', '#c8c0a0', '#38548a']; for (let i = 0; i < 16; i++) { c.fillStyle = cols[i % 4]; c.fillRect(i * 16, 0, 4 + (i % 3) * 3, h); } });
  mk('stripeRed', (c, w, h) => { c.fillStyle = '#8a3a28'; c.fillRect(0, 0, w, h); const cols = ['#b05a34', '#4a1e16', '#d8b078', '#6a2a1e']; for (let i = 0; i < 16; i++) { c.fillStyle = cols[i % 4]; c.fillRect(i * 16, 0, 4 + (i % 2) * 4, h); } });
  const carpet = (base, a, b, d) => (c, w, h) => {
    c.fillStyle = base; c.fillRect(0, 0, w, h);
    c.strokeStyle = a; c.lineWidth = 10; c.strokeRect(10, 10, w - 20, h - 20);
    c.strokeStyle = b; c.lineWidth = 4; c.strokeRect(28, 28, w - 56, h - 56);
    c.fillStyle = a; c.beginPath(); c.moveTo(w / 2, 56); c.lineTo(w - 56, h / 2); c.lineTo(w / 2, h - 56); c.lineTo(56, h / 2); c.closePath(); c.fill();
    c.fillStyle = d; c.beginPath(); c.moveTo(w / 2, 86); c.lineTo(w - 90, h / 2); c.lineTo(w / 2, h - 86); c.lineTo(90, h / 2); c.closePath(); c.fill();
    c.fillStyle = b; c.beginPath(); c.arc(w / 2, h / 2, 18, 0, 7); c.fill();
    for (let i = 0; i < 8; i++) { c.fillStyle = b; c.fillRect(40 + i * 24, 14, 8, 8); c.fillRect(40 + i * 24, h - 22, 8, 8); }
  };
  mk('carpetRed', carpet('#6a2a20', '#b8863e', '#d8c090', '#3a1812'));
  mk('carpetBlue', carpet('#1e3260', '#c09a50', '#d8d0b0', '#101c3a'));
  mk('carpetOchre', carpet('#8a6a34', '#3a4a7a', '#e0d0a0', '#5a3c1c'));
  mk('plain', (c, w, h) => { c.fillStyle = '#9a7a56'; c.fillRect(0, 0, w, h); const R = rng(9); for (let i = 0; i < 80; i++) { c.fillStyle = `rgba(0,0,0,${R() * 0.1})`; c.fillRect(R() * w, 0, 2 + R() * 6, h); } });
  mk('blueCloth', (c, w, h) => { c.fillStyle = '#2c4a86'; c.fillRect(0, 0, w, h); const R = rng(13); for (let i = 0; i < 60; i++) { c.fillStyle = `rgba(255,255,255,${R() * 0.07})`; c.fillRect(R() * w, 0, 1 + R() * 3, h); } });
  mk('hemp', (c, w, h) => { c.fillStyle = '#b4a07c'; c.fillRect(0, 0, w, h); const R = rng(17); for (let i = 0; i < 80; i++) { c.fillStyle = `rgba(60,40,20,${R() * 0.12})`; c.fillRect(R() * w, 0, 1 + R() * 3, h); } });
  mk('banner', (c, w, h) => { c.fillStyle = '#7a3224'; c.fillRect(0, 0, w, h); c.strokeStyle = '#d8b068'; c.lineWidth = 8; c.strokeRect(14, 14, w - 28, h - 28); c.fillStyle = '#16264a'; c.beginPath(); c.moveTo(128, 40); c.bezierCurveTo(70, 120, 70, 170, 128, 200); c.bezierCurveTo(186, 170, 186, 120, 128, 40); c.fill(); });
  return T;
}
