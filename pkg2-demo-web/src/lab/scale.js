// Масштаб стенда: сколько пикселей экрана очков приходится на градус поля (по профилю модели).
import { windowDeg } from '../galley/glasses.js';

/**
 * Окно экрана W×H пикселей (полный экран на очках). SBS-режим (ширина ≥ 3800) — по половине кадра на глаз.
 * Возвращает: глаз — ширина и высота одной картинки, пикс/° по горизонтали и вертикали, градусы окна.
 */
export function scaleFor(d, W, H) {
  const sbs = W >= 3800 && W / H > 2.5;
  const ew = sbs ? W / 2 : W;
  const w = windowDeg(d);
  return { sbs, ew, eh: H, ppdX: ew / w.h, ppdY: H / w.v, degW: w.h, degH: w.v };
}

/** Высота строки текста в пикселях для углового размера deg (° по вертикали). */
export function textPx(s, deg) { return Math.max(4, Math.round(deg * s.ppdY)); }

/** Шаг сетки в градусах, чтобы линии были не чаще ~40 пикселей. */
export function gridStep(s) { return [1, 2, 5, 10].find((k) => k * s.ppdX >= 40) || 10; }

/** Частота кадров и пропуски по интервалам requestAnimationFrame (мс). */
export function frameStats(dts) {
  if (dts.length < 5) return { hz: 0, dropped: 0 };
  const sorted = [...dts].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  return { hz: med > 0 ? 1000 / med : 0, dropped: dts.filter((d) => d > 1.5 * med).length };
}
