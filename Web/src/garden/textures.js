// Процедурные текстуры сада (canvas): карточки травы и листвы с альфой, цветы, кладка, почва, нормаль воды.
// Все рисуются детерминированно (rng) — без внешних файлов.
import * as THREE from 'three';
import { rng } from '../core/util.js';

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function tex(c, { srgb = true, repeat = false, aniso = 4 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  return t;
}
const rgb = (r, g, b, a = 1) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;
// вариация яркости (общий множитель) + слабый сдвиг по каналам — без «радужных» пятен
const jitter = (base, v, R) => { const f = 1 + (R() - 0.5) * v / 110; return base.map((c) => Math.max(0, Math.min(255, c * f + (R() - 0.5) * v * 0.16))); };

/** Пучок травы: изогнутые заострённые лезвия от нижнего центра. */
export function grassTexture(kind = 'poverty', seed = 1) {
  const R = rng(seed * 77 + 1);
  const [c, g] = canvas(256, 256);
  const pal = kind === 'dune' ? [[132, 150, 104], [160, 172, 118], [112, 132, 92]] : [[168, 170, 92], [196, 186, 108], [140, 150, 78], [206, 196, 128]];
  const n = kind === 'dune' ? 26 : 34;
  for (let i = 0; i < n; i++) {
    const col = jitter(pal[(R() * pal.length) | 0], 26, R);
    const x0 = 128 + (R() - 0.5) * (kind === 'dune' ? 70 : 110), top = 18 + R() * (kind === 'dune' ? 40 : 90);
    const lean = (R() - 0.5) * (kind === 'dune' ? 120 : 150);
    const w = (kind === 'dune' ? 6 : 5) + R() * 4;
    g.fillStyle = rgb(...col);
    g.beginPath();
    g.moveTo(x0 - w, 256);
    g.quadraticCurveTo(x0 - w * 0.6 + lean * 0.25, 256 - (256 - top) * 0.55, x0 + lean, top);
    g.quadraticCurveTo(x0 + w * 0.6 + lean * 0.25, 256 - (256 - top) * 0.55, x0 + w, 256);
    g.closePath(); g.fill();
    g.strokeStyle = rgb(col[0] * 0.78, col[1] * 0.8, col[2] * 0.7, 0.55); g.lineWidth = 1;
    g.beginPath(); g.moveTo(x0, 256); g.quadraticCurveTo(x0 + lean * 0.22, 256 - (256 - top) * 0.55, x0 + lean, top); g.stroke();
  }
  return tex(c);
}

/** Облако листвы (карточка-кластер). kind: creosote | saltbush | tamarisk | acacia */
export function foliageTexture(kind, seed = 1) {
  const R = rng(seed * 131 + 7);
  const [c, g] = canvas(512, 512);
  g.scale(2, 2);
  const cfg = {
    creosote: { pal: [[104, 128, 56], [88, 114, 48], [124, 144, 66], [138, 150, 64]], n: 1100, len: 5.2, wid: 2.4, kind: 'leaf' },
    saltbush: { pal: [[140, 164, 136], [120, 146, 120], [160, 178, 150], [110, 136, 108]], n: 1100, len: 4.8, wid: 2.3, kind: 'leaf' },
    tamarisk: { pal: [[126, 162, 98], [108, 148, 84], [150, 182, 112]], n: 320, len: 42, wid: 1.5, kind: 'needle' },
    acacia: { pal: [[78, 104, 40], [92, 118, 46], [66, 92, 34], [106, 128, 50]], n: 520, len: 7, wid: 2.4, kind: 'leaflet' },
  }[kind];
  // мягкая форма: листья только внутри эллипса
  for (let i = 0; i < cfg.n; i++) {
    let x, y, tries = 0;
    do { x = 128 + (R() - 0.5) * 240; y = 128 + (R() - 0.5) * 240; tries++; } while (((x - 128) / 120) ** 2 + ((y - 128) / 112) ** 2 > 1 && tries < 20);
    const col = jitter(cfg.pal[(R() * cfg.pal.length) | 0], 30, R);
    const a = R() * Math.PI * 2;
    g.save(); g.translate(x, y); g.rotate(a);
    if (cfg.kind === 'leaf') {
      g.fillStyle = rgb(...col);
      g.beginPath(); g.ellipse(0, 0, cfg.len * (0.7 + R() * 0.6), cfg.wid * (0.7 + R() * 0.6), 0, 0, 7); g.fill();
      g.fillStyle = rgb(col[0] * 0.8, col[1] * 0.8, col[2] * 0.8, 0.5); g.fillRect(-cfg.len * 0.5, -0.5, cfg.len, 1);
    } else if (cfg.kind === 'needle') {
      g.strokeStyle = rgb(...col, 0.9); g.lineWidth = cfg.wid;
      g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(cfg.len * 0.4, cfg.len * 0.1, cfg.len * 0.6 * (0.6 + R() * 0.6), cfg.len * 0.5); g.stroke();
    } else {
      // перистые листочки вдоль тонкого стебля
      g.strokeStyle = rgb(60, 52, 30, 0.8); g.lineWidth = 1; g.beginPath(); g.moveTo(-cfg.len * 1.5, 0); g.lineTo(cfg.len * 1.5, 0); g.stroke();
      g.fillStyle = rgb(...col);
      for (let k = -3; k <= 3; k++) { g.beginPath(); g.ellipse(k * 4, -3.5, 3, 1.4, 0.3, 0, 7); g.fill(); g.beginPath(); g.ellipse(k * 4, 3.5, 3, 1.4, -0.3, 0, 7); g.fill(); }
    }
    g.restore();
  }
  if (kind === 'tamarisk') {
    for (let i = 0; i < 26; i++) { g.fillStyle = rgb(...jitter([222, 160, 170], 40, R), 0.9); g.beginPath(); g.arc(30 + R() * 196, 30 + R() * 196, 2.2 + R() * 2.5, 0, 7); g.fill(); }
  }
  if (kind === 'acacia') {
    for (let i = 0; i < 14; i++) { g.fillStyle = rgb(...jitter([232, 206, 80], 30, R), 0.95); g.beginPath(); g.arc(30 + R() * 196, 30 + R() * 196, 3 + R() * 2.5, 0, 7); g.fill(); }
  }
  return tex(c);
}

/** Лист пальмы: вдоль вертикали карточки идёт ребро, по бокам — узкие листочки. */
export function palmFrondTexture() {
  const R = rng(4242);
  const [c, g] = canvas(256, 512);
  g.strokeStyle = rgb(120, 98, 52); g.lineWidth = 5; g.beginPath(); g.moveTo(128, 512); g.lineTo(128, 6); g.stroke();
  for (let i = 0; i < 74; i++) {
    const y = 500 - i * 6.6;
    const len = 112 * Math.sin(Math.PI * Math.min(1, (i + 6) / 80)) + 14;
    for (const sg of [-1, 1]) {
      const col = jitter([96, 134, 62], 34, R);
      g.strokeStyle = rgb(...col); g.lineWidth = 3.2;
      g.beginPath(); g.moveTo(128, y); g.quadraticCurveTo(128 + sg * len * 0.55, y - 8 + R() * 6, 128 + sg * len, y + 12 + R() * 8); g.stroke();
    }
  }
  return tex(c);
}

/** Цветочки: 4×1 атлас (белый, жёлтый, фиолетовый, розовый). */
export function flowerTexture() {
  const [c, g] = canvas(256, 64);
  const cols = [[245, 244, 232], [240, 204, 72], [150, 104, 190], [226, 130, 150]];
  cols.forEach((col, i) => {
    const cx = 32 + i * 64, cy = 36;
    g.strokeStyle = rgb(90, 120, 60); g.lineWidth = 2; g.beginPath(); g.moveTo(cx, 64); g.lineTo(cx, cy + 4); g.stroke();
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; g.fillStyle = rgb(...col); g.beginPath(); g.ellipse(cx + Math.cos(a) * 8, cy + Math.sin(a) * 8, 7, 4, a, 0, 7); g.fill(); }
    g.fillStyle = rgb(236, 190, 60); g.beginPath(); g.arc(cx, cy, 3.2, 0, 7); g.fill();
    g.fillStyle = rgb(80, 110, 56); g.beginPath(); g.ellipse(cx - 9, 54, 9, 3, -0.5, 0, 7); g.fill(); g.beginPath(); g.ellipse(cx + 9, 54, 9, 3, 0.5, 0, 7); g.fill();
  });
  return tex(c);
}

/** Влажная вспаханная почва грядки (борозды вдоль x). */
export function soilTexture() {
  const R = rng(99);
  const [c, g] = canvas(256, 256);
  g.fillStyle = rgb(88, 62, 42); g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 16; i++) { const y = i * 16; const gr = g.createLinearGradient(0, y, 0, y + 16); gr.addColorStop(0, rgb(112, 80, 54)); gr.addColorStop(0.5, rgb(76, 54, 36)); gr.addColorStop(1, rgb(58, 40, 28)); g.fillStyle = gr; g.fillRect(0, y, 256, 16); }
  for (let i = 0; i < 1400; i++) { g.fillStyle = rgb(...jitter([96, 70, 48], 60, R), 0.5); g.fillRect(R() * 256, R() * 256, 1 + R() * 2, 1 + R() * 2); }
  return tex(c, { repeat: true });
}

/** Каменная кладка / плитка двора. */
export function flagstoneTexture() {
  const R = rng(515);
  const [c, g] = canvas(256, 256);
  g.fillStyle = rgb(70, 58, 46); g.fillRect(0, 0, 256, 256);
  for (let j = 0; j < 4; j++) {
    let x = -R() * 40;
    while (x < 256) {
      const w = 44 + R() * 40, y = j * 64;
      const col = jitter([154, 126, 98], 34, R);
      g.fillStyle = rgb(...col); g.fillRect(x + 2, y + 2, w - 4, 60);
      g.fillStyle = rgb(col[0] + 14, col[1] + 12, col[2] + 8, 0.35); g.fillRect(x + 2, y + 2, w - 4, 10);
      for (let k = 0; k < 40; k++) { g.fillStyle = rgb(...jitter(col, 40, R), 0.25); g.fillRect(x + 4 + R() * (w - 8), y + 4 + R() * 56, 1 + R() * 3, 1 + R() * 2); }
      x += w;
    }
  }
  return tex(c, { repeat: true });
}

/** Глинобитный кирпич/саман. */
export function adobeTexture() {
  const R = rng(808);
  const [c, g] = canvas(256, 256);
  g.fillStyle = rgb(176, 140, 104); g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2200; i++) { g.fillStyle = rgb(...jitter([170, 134, 98], 56, R), 0.35); g.fillRect(R() * 256, R() * 256, 1 + R() * 5, 1 + R() * 3); }
  g.strokeStyle = rgb(120, 92, 66, 0.55); g.lineWidth = 2;
  for (let j = 0; j < 8; j++) { const y = j * 32; g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); for (let k = 0; k < 4; k++) { const x = ((j % 2) * 32 + k * 64) % 256; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 32); g.stroke(); } }
  return tex(c, { repeat: true });
}

/** Нормаль воды: сумма синусов (бесшовно), хранится в RGB. */
export function waterNormalTexture() {
  const S = 128;
  const [c, g] = canvas(S, S);
  const img = g.createImageData(S, S);
  const h = (x, y) => Math.sin((x / S) * 12.566 + Math.sin((y / S) * 6.283) * 1.3) * 0.5 + Math.sin(((x + y) / S) * 18.85) * 0.3 + Math.sin((y / S) * 25.13 - (x / S) * 6.283) * 0.2;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (h((x + 1) % S, y) - h((x - 1 + S) % S, y)) * 2.2, dy = (h(x, (y + 1) % S) - h(x, (y - 1 + S) % S)) * 2.2;
    const l = Math.hypot(dx, dy, 1);
    const o = (y * S + x) * 4;
    img.data[o] = (-dx / l * 0.5 + 0.5) * 255; img.data[o + 1] = (-dy / l * 0.5 + 0.5) * 255; img.data[o + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return tex(c, { srgb: false, repeat: true });
}

/** Полоски и орнамент на башнях ветроловушек (вертикальные щели). */
export function louverTexture() {
  const [c, g] = canvas(128, 256);
  g.fillStyle = rgb(176, 142, 108); g.fillRect(0, 0, 128, 256);
  const R = rng(31);
  for (let i = 0; i < 900; i++) { g.fillStyle = rgb(...jitter([168, 132, 98], 50, R), 0.35); g.fillRect(R() * 128, R() * 256, 1 + R() * 4, 1 + R() * 3); }
  // щели в верхних 2/3
  for (let k = 0; k < 6; k++) { const x = 12 + k * 20; g.fillStyle = rgb(36, 26, 20); g.fillRect(x, 24, 7, 150); g.fillStyle = rgb(120, 92, 66); g.fillRect(x - 1, 24, 1, 150); }
  g.fillStyle = rgb(120, 92, 66); g.fillRect(0, 176, 128, 3);
  return tex(c);
}

/** Кора пальмы: кольца-рубцы от опавших листьев. */
export function barkTexture() {
  const R = rng(1717);
  const [c, g] = canvas(128, 256);
  g.fillStyle = rgb(112, 88, 62); g.fillRect(0, 0, 128, 256);
  for (let j = 0; j < 16; j++) {
    const y = j * 16;
    const gr = g.createLinearGradient(0, y, 0, y + 16); gr.addColorStop(0, rgb(84, 64, 44)); gr.addColorStop(0.35, rgb(132, 104, 74)); gr.addColorStop(1, rgb(98, 76, 54));
    g.fillStyle = gr; g.fillRect(0, y, 128, 16);
    for (let k = 0; k < 9; k++) { g.fillStyle = rgb(...jitter([70, 54, 38], 30, R), 0.5); g.fillRect(R() * 128, y + R() * 14, 6 + R() * 12, 1 + R() * 2); }
  }
  for (let i = 0; i < 500; i++) { g.fillStyle = rgb(...jitter([120, 96, 68], 50, R), 0.3); g.fillRect(R() * 128, R() * 256, 1 + R() * 3, 1 + R() * 3); }
  return tex(c, { repeat: true });
}
