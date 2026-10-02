// Мелкие помощники интерфейса: DOM, SVG, цвет, плавные величины.
export const SVGNS = 'http://www.w3.org/2000/svg';

/** Палитра из docs/ui/ui_design.md §2 (RGB). */
export const COL = {
  ochre: [200, 161, 101],      // #C8A165
  ochreRed: [181, 70, 44],     // #B5462C
  warm: [239, 230, 216],       // #EFE6D8
  cold: [220, 228, 236],       // #DCE4EC
  ibad: [110, 155, 196],       // #6E9BC4
  ink: [11, 8, 5],             // #0B0805
};

export function el(tag, cls, parent, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}
export function svgEl(tag, attrs, parent) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
export const mixC = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
export const rgb = (c, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
export const sat = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const easeOut = (x) => 1 - (1 - sat(x)) * (1 - sat(x));

/** Линейное приближение значения к цели: полное 0→1 за tIn, 1→0 за tOut секунд. */
export function approach(cur, target, dt, tIn, tOut) {
  const t = target > cur ? tIn : tOut;
  if (t <= 0) return target;
  const step = dt / t;
  return target > cur ? Math.min(target, cur + step) : Math.max(target, cur - step);
}

export const wait = (sec) => new Promise((r) => setTimeout(r, sec * 1000));

/** Гладкий псевдо-шум для дрожи (сумма синусов, без состояния). */
export function wobble(t, seed) {
  return 0.55 * Math.sin(t * 2.3 + seed * 1.7) + 0.3 * Math.sin(t * 5.1 + seed * 3.1) + 0.15 * Math.sin(t * 11.7 + seed * 0.9);
}
