// Процедурные текстуры и материалы участка и кухонного модуля (без внешних файлов, офлайн).
// UV панелей — в миллиметрах (ExtrudeGeometry), поэтому repeat = 1 / период в мм.
import * as THREE from 'three';
import { brushedSet, colorMap, fbm, grayMap, normalMap, normalize, orangePeelSet, twillSet, withRepeat } from '../scene/textures.js';

const cache = new Map();
const once = (k, f) => { if (!cache.has(k)) cache.set(k, f()); return cache.get(k); };
const hex = (c) => { const n = parseInt(c.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

function rep(t, rx, ry = rx) { const c = t.clone(); c.repeat.set(rx, ry); c.wrapS = c.wrapT = THREE.RepeatWrapping; c.needsUpdate = true; return c; }

/** Торец сотовой панели: стенки ячеек арамидных сот поперёк толщины (полосы вдоль v), между ними — тень полуячеек. */
export function coreEdgeSet() {
  return once('coreEdge', () => {
    const S = 256, cells = 16;           // 16 полуячеек на текстуру; период 1,6 мм → текстура ≈ 26 мм
    const h = new Float32Array(S * S);
    const n = normalize(fbm(S, { sx: 4, sy: 32, octaves: 2, seed: 71 }));
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const t = ((x / S) * cells) % 1;
      const wall = Math.exp(-((t - 0.5) ** 2) / 0.004);            // тонкая стенка
      h[y * S + x] = wall * (0.8 + 0.2 * n[y * S + x]);
    }
    const wall = hex('#d1a54c'), hole = hex('#4b3613');
    return {
      map: colorMap(S, (i) => mix(hole, wall, Math.min(1, h[i] * 1.4 + 0.12))),
      normalMap: normalMap(S, h, 3),
      roughnessMap: grayMap(S, (i) => 0.75 - h[i] * 0.2),
      periodMm: 26,
    };
  });
}

/** Обшивка панели «как из печи»: стеклопластик на фенольном связующем — янтарный тон, видна саржа. */
export function skinRawSet() {
  return once('skinRaw', () => {
    const S = 512;
    const b = normalize(fbm(S, { sx: 3, octaves: 5, seed: 81 }));
    const base = hex('#d8c38f'), dark = hex('#b99a5c');
    return { map: colorMap(S, (i) => mix(dark, base, 0.55 + b[i] * 0.45)), ...withRepeat(twillSet(), 1, 1), periodMm: 400 };
  });
}

/** Декоративная плёнка «гранит светлый»: мелкий крап и лёгкое тиснение. */
export function graniteSet() {
  return once('granite', () => {
    const S = 512;
    const f = normalize(fbm(S, { sx: 64, octaves: 3, seed: 91 }));
    const g = normalize(fbm(S, { sx: 6, octaves: 4, seed: 92 }));
    let s = 7;
    const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const speck = new Float32Array(S * S).map(() => (r() > 0.985 ? 0.4 + r() * 0.6 : 0));
    const base = hex('#d5d3cd'), dk = hex('#8e8c86');
    return {
      map: colorMap(S, (i) => mix(mix(base, dk, f[i] * 0.22 + (g[i] - 0.5) * 0.08), dk, speck[i] * 0.7)),
      normalMap: normalMap(S, f, 0.8),
      roughnessMap: grayMap(S, (i) => 0.42 + f[i] * 0.1),
      periodMm: 300,
    };
  });
}

/** Тонкая шлифовка нержавеющего листа (шлифовка №4): штрихи вдоль U. */
export function stainlessSet() {
  return once('stainless', () => {
    const b = brushedSet();
    return { roughnessMap: b.roughnessMap, normalMap: b.normalMap, periodMm: 120 };
  });
}

/** Оплётка жгута (плетёный чулок). */
export function braidSet() {
  return once('braid', () => {
    const S = 128, n = 16;
    const h = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const a = Math.sin(((x + y) / S) * n * Math.PI * 2), b = Math.sin(((x - y) / S) * n * Math.PI * 2);
      h[y * S + x] = (((x + y) / (S / n)) | 0) % 2 ? a * 0.5 + 0.5 : b * 0.5 + 0.5;
    }
    return { normalMap: normalMap(S, h, 1.5), roughnessMap: grayMap(S, () => 0.6) };
  });
}

/** Табличка/надпись на canvas. */
export function textTexture(lines, { w = 512, h = 128, bg = '#f2f2ee', fg = '#1a1a1a', font = 600, size = 44, border = '#1a1a1a' } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  if (border) { g.strokeStyle = border; g.lineWidth = 6; g.strokeRect(8, 8, w - 16, h - 16); }
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  const L = [].concat(lines);
  const pad = border ? 28 : 16;
  L.forEach((t, i) => {
    // шрифт подгоняется по ширине и высоте строки — надпись не обрезается
    let fs = Math.min(i === 0 ? size : size * 0.6, (h / (L.length + 0.6)) * (i === 0 ? 0.82 : 0.62));
    g.font = `${font} ${fs}px "IBM Plex Sans", system-ui, sans-serif`;
    const wd = g.measureText(t).width;
    if (wd > w - 2 * pad) { fs *= (w - 2 * pad) / wd; g.font = `${font} ${fs}px "IBM Plex Sans", system-ui, sans-serif`; }
    g.fillText(t, w / 2, h * ((i + 1) / (L.length + 1)));
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Мерная лента (шкала в мм) для стоек стапеля: жёлтая, деления 1/5/10 мм, цифры через 100 мм. Текстура на 1000 мм. */
export function rulerTexture() {
  return once('ruler', () => {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 4096;
    const g = c.getContext('2d');
    g.fillStyle = '#e8c21c'; g.fillRect(0, 0, 128, 4096);
    g.fillStyle = '#111';
    const k = 4096 / 1000;
    for (let mm = 0; mm <= 1000; mm += 1) {
      const y = 4096 - mm * k;
      const L = mm % 100 === 0 ? 70 : mm % 10 === 0 ? 46 : mm % 5 === 0 ? 30 : 16;
      g.fillRect(0, y - 1, L, mm % 10 === 0 ? 3 : 2);
    }
    g.font = '600 30px "IBM Plex Mono", monospace';
    g.save(); g.translate(108, 0); g.rotate(Math.PI / 2);
    for (let mm = 100; mm < 1000; mm += 100) g.fillText(String(mm / 100), 4096 - mm * k - 10, 0);
    g.restore();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.wrapT = THREE.RepeatWrapping;
    return t;
  });
}

// ---------- материалы модуля ----------
const M = new Map();
const mat = (k, f) => { if (!M.has(k)) M.set(k, f()); return M.get(k); };

export const galleyMat = {
  skinRaw: () => mat('skinRaw', () => { const s = skinRawSet(); return new THREE.MeshPhysicalMaterial({
    map: rep(s.map, 1 / s.periodMm), normalMap: rep(s.normalMap, 1 / 6), normalScale: new THREE.Vector2(0.25, 0.25), roughness: 0.48, clearcoat: 0.25, clearcoatRoughness: 0.5 }); }),
  skinPrimer: () => mat('skinPrimer', () => new THREE.MeshPhysicalMaterial({ color: '#b9bdb6', roughness: 0.78, ...repSet(orangePeelSet(128, 0.8, 'primer'), 1 / 80) })),
  skinPaint: () => mat('skinPaint', () => new THREE.MeshPhysicalMaterial({ color: '#e4e1d7', roughness: 0.36, clearcoat: 0.35, clearcoatRoughness: 0.3, ...repSet(orangePeelSet(96, 0.9, 'enamel'), 1 / 60) })),
  core: () => mat('core', () => { const s = coreEdgeSet(); return new THREE.MeshStandardMaterial({
    map: rep(s.map, 1 / s.periodMm, 1 / 30), normalMap: rep(s.normalMap, 1 / s.periodMm, 1 / 30), roughness: 0.8 }); }),
  film: () => mat('film', () => { const s = graniteSet(); return new THREE.MeshPhysicalMaterial({
    map: rep(s.map, 1 / s.periodMm), normalMap: rep(s.normalMap, 1 / s.periodMm), normalScale: new THREE.Vector2(0.5, 0.5),
    roughnessMap: rep(s.roughnessMap, 1 / s.periodMm), roughness: 1, clearcoat: 0.5, clearcoatRoughness: 0.35, side: THREE.DoubleSide }); }),
  stainless: () => mat('stainless', () => { const s = stainlessSet(); return new THREE.MeshPhysicalMaterial({
    color: '#c6c9cc', metalness: 1, roughness: 0.3, roughnessMap: rep(s.roughnessMap, 1 / s.periodMm, 1 / 800), normalMap: rep(s.normalMap, 1 / s.periodMm, 1 / 800),
    normalScale: new THREE.Vector2(0.3, 0.3) }); }),
  chrome: () => mat('chrome', () => new THREE.MeshPhysicalMaterial({ color: '#eceef0', metalness: 1, roughness: 0.06 })),
  alodine: () => mat('alodine', () => new THREE.MeshPhysicalMaterial({ color: '#cdb46a', metalness: 0.85, roughness: 0.42, ...repSet(brushedSet(), 1 / 40) })),
  alu: () => mat('alu', () => new THREE.MeshPhysicalMaterial({ color: '#c3c6ca', metalness: 1, roughness: 0.38, ...repSet(brushedSet(), 1 / 60) })),
  aluDark: () => mat('aluDark', () => new THREE.MeshPhysicalMaterial({ color: '#5d636a', metalness: 0.8, roughness: 0.45 })),
  steel: () => mat('steel', () => new THREE.MeshPhysicalMaterial({ color: '#9da2a6', metalness: 1, roughness: 0.3 })),
  blackPlastic: () => mat('blackPl', () => new THREE.MeshPhysicalMaterial({ color: '#1b1c1e', roughness: 0.5, clearcoat: 0.2 })),
  greyPlastic: () => mat('greyPl', () => new THREE.MeshPhysicalMaterial({ color: '#6c7176', roughness: 0.55 })),
  rubber: () => mat('rubber', () => new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.92 })),
  grooveEmpty: () => mat('grooveE', () => new THREE.MeshStandardMaterial({ color: '#3a2a12', roughness: 0.9 })),
  grooveGlue: () => mat('grooveG', () => new THREE.MeshPhysicalMaterial({ color: '#d2c08a', roughness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.15 })),
  braid: () => mat('braid', () => { const s = braidSet(); return new THREE.MeshStandardMaterial({ color: '#2b2f33', roughness: 0.65, normalMap: s.normalMap }); }),
  pipeWhite: () => mat('pipeW', () => new THREE.MeshPhysicalMaterial({ color: '#e1e4e6', roughness: 0.35, clearcoat: 0.4 })),
  pipeGrey: () => mat('pipeG', () => new THREE.MeshPhysicalMaterial({ color: '#8f959b', roughness: 0.45 })),
  glassDark: () => mat('glassD', () => new THREE.MeshPhysicalMaterial({ color: '#0d1114', roughness: 0.05, metalness: 0.2, clearcoat: 1 })),
  glass: () => mat('glass', () => new THREE.MeshPhysicalMaterial({ color: '#a8b6bd', roughness: 0.04, transmission: 0, transparent: true, opacity: 0.35, clearcoat: 1 })),
  diffuserOff: () => mat('diffOff', () => new THREE.MeshPhysicalMaterial({ color: '#e9ebeb', roughness: 0.3, emissive: '#ffffff', emissiveIntensity: 0 })),
  red: () => mat('red', () => new THREE.MeshPhysicalMaterial({ color: '#b3261e', roughness: 0.4, clearcoat: 0.5 })),
  brass: () => mat('brass', () => new THREE.MeshPhysicalMaterial({ color: '#c9a45c', metalness: 1, roughness: 0.3 })),
};

function repSet(set, r) { const o = {}; for (const [k, t] of Object.entries(set)) o[k] = rep(t, r); return o; }
