// Процедурные PBR-текстуры (цвет, шероховатость, нормали) без внешних файлов: демо работает офлайн.
// Шум — бесшовный (периодический) value noise, поэтому текстуры можно повторять плиткой.
import * as THREE from 'three';

const cache = new Map();

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}

/** Бесшовный фрактальный шум size×size в [0,1]. sx/sy — число ячеек решётки (анизотропия: sx ≠ sy). */
export function fbm(size, { sx = 8, sy = sx, octaves = 5, gain = 0.5, seed = 1 } = {}) {
  const out = new Float32Array(size * size);
  const r = rng(seed);
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const px = sx << o, py = sy << o;
    const lat = new Float32Array(px * py).map(() => r());
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * py, y0 = Math.floor(fy), ty = fy - y0, uy = ty * ty * (3 - 2 * ty);
      const r0 = (y0 % py) * px, r1 = ((y0 + 1) % py) * px;
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * px, x0 = Math.floor(fx), tx = fx - x0, ux = tx * tx * (3 - 2 * tx);
        const c0 = x0 % px, c1 = (x0 + 1) % px;
        const a = lat[r0 + c0] + (lat[r0 + c1] - lat[r0 + c0]) * ux;
        const b = lat[r1 + c0] + (lat[r1 + c1] - lat[r1 + c0]) * ux;
        out[y * size + x] += (a + (b - a) * uy) * amp;
      }
    }
    total += amp;
    amp *= gain;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

/** Растянуть значения поля на [0,1] (после fbm разброс узкий). */
export function normalize(f) {
  let lo = Infinity, hi = -Infinity;
  for (const v of f) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const k = hi > lo ? 1 / (hi - lo) : 0;
  for (let i = 0; i < f.length; i++) f[i] = (f[i] - lo) * k;
  return f;
}

function toTexture(size, fill, { srgb = false, repeat = [1, 1] } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  fill(img.data);
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return t;
}

/** Карта нормалей из карты высот (бесшовно). */
export function normalMap(size, h, strength = 2, opts = {}) {
  return toTexture(size, (d) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const dx = (h[y * size + ((x + 1) % size)] - h[y * size + ((x - 1 + size) % size)]) * strength;
      const dy = (h[((y + 1) % size) * size + x] - h[((y - 1 + size) % size) * size + x]) * strength;
      const l = Math.hypot(dx, dy, 1);
      d[i * 4] = (-dx / l * 0.5 + 0.5) * 255;
      d[i * 4 + 1] = (dy / l * 0.5 + 0.5) * 255;
      d[i * 4 + 2] = (1 / l * 0.5 + 0.5) * 255;
      d[i * 4 + 3] = 255;
    }
  }, opts);
}

/** Карта в оттенках серого: f(i) → 0..1 (шероховатость, металличность). */
export function grayMap(size, f, opts = {}) {
  return toTexture(size, (d) => {
    for (let i = 0; i < size * size; i++) {
      const v = Math.max(0, Math.min(255, f(i) * 255));
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
    }
  }, opts);
}

/** Цветная карта: f(i) → [r,g,b] 0..1 (sRGB). */
export function colorMap(size, f, opts = {}) {
  return toTexture(size, (d) => {
    for (let i = 0; i < size * size; i++) {
      const [r, g, b] = f(i);
      d[i * 4] = r * 255; d[i * 4 + 1] = g * 255; d[i * 4 + 2] = b * 255; d[i * 4 + 3] = 255;
    }
  }, { ...opts, srgb: true });
}

const hex = (c) => { const n = parseInt(c.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

function cached(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

/** Шлифованный металл: штрихи вдоль U. */
export function brushedSet() {
  return cached('brushed', () => {
    const S = 512;
    const streak = normalize(fbm(S, { sx: 2, sy: 128, octaves: 3, seed: 11 }));
    const blot = normalize(fbm(S, { sx: 4, octaves: 4, seed: 12 }));
    return {
      roughnessMap: grayMap(S, (i) => 0.55 + streak[i] * 0.35 + (blot[i] - 0.5) * 0.25),
      normalMap: normalMap(S, streak, 1.2),
    };
  });
}

/** Шагрень «апельсиновая корка» (порошковая краска, литой пластик) и мелкая «кожа» интерьерных панелей. */
export function orangePeelSet(scale = 48, strength = 1.6, key = 'peel') {
  return cached(`${key}_${scale}`, () => {
    const S = 512;
    const h = normalize(fbm(S, { sx: scale, octaves: 2, gain: 0.45, seed: 21 + scale }));
    const v = normalize(fbm(S, { sx: 6, octaves: 3, seed: 22 }));
    return {
      normalMap: normalMap(S, h, strength),
      roughnessMap: grayMap(S, (i) => 0.82 + (v[i] - 0.5) * 0.25 + (h[i] - 0.5) * 0.12),
    };
  });
}

/** Наливной эпоксидный пол цеха: светло-серый, полированный, с потёртостями и пятнами, швы 4 м. */
export function epoxyFloorSet(tint = '#8d9196') {
  return cached(`floor_${tint}`, () => {
    const S = 1024;
    const big = normalize(fbm(S, { sx: 3, octaves: 5, seed: 31 }));
    const mid = normalize(fbm(S, { sx: 24, octaves: 3, seed: 32 }));
    const fine = normalize(fbm(S, { sx: 256, octaves: 1, seed: 33 }));
    const wear = normalize(fbm(S, { sx: 6, sy: 40, octaves: 4, seed: 34 }));
    const r = rng(35);
    const speck = new Float32Array(S * S).map(() => (r() > 0.992 ? r() : 0));
    const base = hex(tint), dark = mix(base, [0.32, 0.31, 0.29], 0.55), light = mix(base, [1, 1, 1], 0.12);
    const seam = (i) => { const x = i % S, y = (i / S) | 0; return (x < 2 || y < 2) ? 1 : 0; };
    const h = new Float32Array(S * S);
    for (let i = 0; i < h.length; i++) h[i] = fine[i] * 0.25 + mid[i] * 0.4 - seam(i) * 1.5;
    return {
      map: colorMap(S, (i) => {
        let c = mix(dark, light, Math.min(1, big[i] * 0.9 + mid[i] * 0.25));
        c = mix(c, [0.2, 0.19, 0.18], Math.max(0, wear[i] - 0.72) * 1.2);       // следы колёс тележек
        c = mix(c, [0.95, 0.95, 0.93], speck[i] * 0.5);
        return seam(i) ? mix(c, [0.12, 0.12, 0.12], 0.7) : c;
      }),
      roughnessMap: grayMap(S, (i) => 0.18 + big[i] * 0.22 + Math.max(0, wear[i] - 0.6) * 0.8 + fine[i] * 0.08 + seam(i) * 0.6),
      normalMap: normalMap(S, h, 0.9),
    };
  });
}

/** Антистатический коврик верстака: матовая резина с мелким пупырышком. */
export function esdMatSet() {
  return cached('esd', () => {
    const S = 512;
    const dots = new Float32Array(S * S);
    const n = 64;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = ((x / S) * n) % 1 - 0.5, v = ((y / S) * n) % 1 - 0.5;
      dots[y * S + x] = Math.max(0, 1 - Math.hypot(u, v) * 3.2);
    }
    const blot = normalize(fbm(S, { sx: 5, octaves: 4, seed: 41 }));
    return {
      map: colorMap(S, (i) => mix([0.17, 0.21, 0.23], [0.22, 0.27, 0.29], blot[i])),
      normalMap: normalMap(S, dots, 0.7),
      roughnessMap: grayMap(S, (i) => 0.7 + blot[i] * 0.2 - dots[i] * 0.1),
    };
  });
}

/** Грунт обшивки и шпангоутов (жёлто-зелёный хромат цинка) с неравномерностью распыления. */
export function primerSet(tint = '#8e9a63') {
  return cached(`primer_${tint}`, () => {
    const S = 512;
    const blot = normalize(fbm(S, { sx: 4, octaves: 6, seed: 51 }));
    const spray = normalize(fbm(S, { sx: 96, octaves: 2, seed: 52 }));
    const base = hex(tint);
    return {
      map: colorMap(S, (i) => mix(mix(base, [0.36, 0.4, 0.26], 0.25), mix(base, [1, 1, 0.9], 0.1), blot[i] * 0.8 + spray[i] * 0.2)),
      roughnessMap: grayMap(S, (i) => 0.55 + blot[i] * 0.2 + spray[i] * 0.1),
      normalMap: normalMap(S, spray, 0.6),
    };
  });
}

/** Ткань спецодежды: саржевое плетение. */
export function twillSet() {
  return cached('twill', () => {
    const S = 256;
    const n = 64;
    const h = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = (x + y) / S * n;                    // диагональ саржи
      h[y * S + x] = 0.5 + 0.5 * Math.sin(u * Math.PI * 2) * (((x / S * n * 2) | 0) % 2 ? 1 : 0.6);
    }
    return { normalMap: normalMap(S, h, 0.8), roughnessMap: grayMap(S, () => 0.88) };
  });
}

/** Лёгкая пятнистость цвета: множитель (map), чтобы большие однотонные поверхности не выглядели «пластмассой из CG». */
export function grimeMap(seed = 61) {
  return cached(`grime_${seed}`, () => {
    const S = 512;
    const b = normalize(fbm(S, { sx: 5, octaves: 6, seed }));
    return colorMap(S, (i) => { const v = 0.86 + b[i] * 0.14; return [v, v, v * 0.995]; });
  });
}

/** Копия набора текстур с другим повтором (общая картинка, свой repeat). */
export function withRepeat(set, rx, ry = rx) {
  const out = {};
  for (const [k, t] of Object.entries(set)) {
    const c = t.clone();
    c.repeat.set(rx, ry);
    c.needsUpdate = true;
    out[k] = c;
  }
  return out;
}
