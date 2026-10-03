// Качество: автоподбор пресета по GPU/устройству и динамическое разрешение (DRS).
//   detectQuality()       → 'low' | 'med' | 'high' — по строке WebGL-рендерера, мобильному UA, числу ядер, DPR.
//   createDRS(game, base) → { update(rawDt), scale, enabled } — держит ~50–60 fps плавным изменением pixel ratio.
// DRS сглажен: решение раз в 0.5 с по среднему кадру, шаги по ~8 %, гистерезис и «охлаждение», выбросы (компиляция шейдеров,
// переключение вкладки) отбрасываются. Параметр URL ?drs=0 отключает, ?fps=N меняет цель (по умолчанию 55).
import { clamp } from './util.js';

const SOFT = /swiftshader|llvmpipe|software|softpipe|microsoft basic|mesa offscreen/i;
const WEAK = /intel\(r\)? (hd|uhd|iris)|intel .*graphics|mali-|adreno \(tm\) [2-5]\d\d|powervr|videocore|apple gpu$/i;

export function gpuName() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return '';
    const e = gl.getExtension('WEBGL_debug_renderer_info');
    const n = e ? String(gl.getParameter(e.UNMASKED_RENDERER_WEBGL)) : '';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return n;
  } catch { return ''; }
}

export function detectQuality() {
  const ua = navigator.userAgent || '';
  if (/Mobi|Android|iPhone|iPad/i.test(ua)) return 'low';
  const gpu = gpuName();
  if (SOFT.test(gpu)) return 'low';
  const cores = navigator.hardwareConcurrency || 4;
  if (WEAK.test(gpu) && !/Arc|Iris Xe Max/i.test(gpu)) return 'low';
  if (cores <= 2) return 'low';
  return 'med';
}

const LEVELS = [1, 0.92, 0.84, 0.76, 0.68, 0.6, 0.52];

export function createDRS(game, basePR) {
  const q = new URLSearchParams(location.search);
  const target = +(q.get('fps') || 55);
  const hi = 1000 / target;            // выше этого кадра — понижаем (≈ 18 мс)
  const lo = 1000 / (target + 12);     // ниже этого — можно повышать (≈ 15 мс)
  const drs = { enabled: q.get('drs') !== '0', level: 0, scale: 1, avgMs: 16.7 };
  let acc = 0, n = 0, t = 0, upWait = 3, lastUp = -99, lastDown = -99, bad = 0;

  function apply() {
    drs.scale = LEVELS[drs.level];
    game.setRenderScale(drs.scale);
  }
  drs.set = (lvl) => { drs.level = clamp(lvl | 0, 0, LEVELS.length - 1); apply(); };
  drs.update = (rawDt) => {
    if (!drs.enabled || document.hidden) return;
    t += rawDt;
    const ms = rawDt * 1000;
    if (ms > 90) { bad++; return; }           // выброс (компиляция шейдеров / пауза) — не показатель
    acc += ms; n++;
    if (t < 0.5 || n < 8) return;
    const avg = acc / n; acc = 0; n = 0; t = 0; drs.avgMs = avg;
    if (game.paused) return;
    const now = game.realTime;
    if (avg > hi && drs.level < LEVELS.length - 1 && now - lastDown > 1.0) {
      // слишком медленно: чем хуже, тем сильнее шаг (но не больше 2)
      drs.level = Math.min(LEVELS.length - 1, drs.level + (avg > hi * 1.6 ? 2 : 1));
      if (now - lastUp < 8) upWait = Math.min(24, upWait * 2); // только что поднимали и снова просело — не качаемся
      lastDown = now; apply();
    } else if (avg < lo && drs.level > 0 && now - lastDown > upWait && now - lastUp > 2.5) {
      drs.level--; lastUp = now; apply();
      if (upWait > 3) upWait = Math.max(3, upWait * 0.9);
    }
  };
  return drs;
}
