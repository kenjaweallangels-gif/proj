// Профили AR-очков для симулятора: характеристики по открытым источникам (октябрь 2026), что неизвестно — помечено
// «оценка». Профиль задаёт: окно дисплея (диагональ, формат, смещение), разрешение → угловую плотность пикселей,
// яркость (нит), пропускание линз и ступени затемнения, оптику (призма-«birdbath» с бликами / плоская призма),
// трекинг (3DoF — окна только вокруг головы, нет привязки к изделию; 6DoF — привязка к стапелю и детали),
// задержку «движение → фотон», расстояние до виртуального экрана, вес (усталость), коррекцию зрения.

/** @typedef {{ id:string, short:string, brand:string, name:string, fovDiag:number, aspect:number, res:[number,number], nits:number, refresh:number,
 *  weightG:number, optics:string, ghost:number, edgeSoft:number, transmit:number, dimLevels:number[]|null, dimNote:string,
 *  tracking:'3dof'|'6dof', hands:boolean, driftDegMin:number, cameras:string, latencyMs:number, distM:number, centerDeg:number, dial:number,
 *  housing:number, note:string, estimates:string[], sources:string[] }} Device */

/** @type {Device[]} */
export const DEVICES = [
  {
    id: 'viture-luma-ultra', short: 'lumaultra', brand: 'VITURE', name: 'Luma Ultra', fovDiag: 52, aspect: 16 / 10, res: [1920, 1200], nits: 1500, refresh: 120,
    weightG: 83, optics: 'призма (birdbath), Sony micro-OLED', ghost: 0.05, edgeSoft: 0.45,
    transmit: 0.40, dimLevels: [0.40, 0.20, 0.08, 0.005], dimNote: 'электрохромное, 0,5–40 %, ~0,1 с',
    tracking: '6dof', hands: true, cameras: 'RGB + 2 камеры глубины', driftDegMin: 0, latencyMs: 18, distM: 4, centerDeg: -2, dial: -4, housing: 15,
    note: 'Привязка к стапелю и детали, жесты (6DoF и жесты — с Pro Neckband или ПК; на Android-телефоне только 3DoF). Колесо диоптрий до −4 D. 1500 нит после обновления ПО (1250 при запуске).',
    estimates: ['задержка', 'смещение окна'],
    sources: ['https://roadtovr.com/?p=173085', 'https://heise.de/-10482368', 'https://vrarwiki.com/wiki/Viture_Luma_Ultra', 'https://www.viture.com/developer/unity-sdk/unity'],
  },
  {
    id: 'viture-luma-pro', short: 'lumapro', brand: 'VITURE', name: 'Luma Pro', fovDiag: 52, aspect: 16 / 10, res: [1920, 1200], nits: 1000, refresh: 120,
    weightG: 79, optics: 'призма (birdbath), Sony micro-OLED', ghost: 0.05, edgeSoft: 0.45,
    transmit: 0.40, dimLevels: [0.40, 0.20, 0.08, 0.005], dimNote: 'электрохромное, 0,5–40 %',
    tracking: '3dof', hands: false, cameras: 'RGB-камера', driftDegMin: 1.2, latencyMs: 22, distM: 4, centerDeg: -2, dial: -4, housing: 15,
    note: '3DoF: окна вокруг головы, привязки к изделию нет.', estimates: ['задержка'],
    sources: ['https://murzikc.duckdns.org/en/news/Viture-Luma-New-display-glasses-offer-a-screen-diagonal-of-up-to-173-inches-10482368.html'],
  },
  {
    id: 'viture-beast', short: 'beast', brand: 'VITURE', name: 'The Beast', fovDiag: 58, aspect: 16 / 10, res: [1920, 1200], nits: 1250, refresh: 120,
    weightG: 88, optics: 'призма (birdbath), Sony micro-OLED, корпус из алюминиево-магниевого сплава', ghost: 0.045, edgeSoft: 0.5,
    transmit: 0.40, dimLevels: [0.40, 0.30, 0.22, 0.15, 0.10, 0.06, 0.03, 0.012, 0.005], dimNote: 'электрохромное, 9 ступеней, 0,5–40 %',
    tracking: '3dof', hands: false, cameras: 'камера, микрофон', driftDegMin: 1.2, latencyMs: 20, distM: 4, centerDeg: -2, dial: -4, housing: 13,
    note: 'Широкое поле 58°, 3DoF в очках (VisionPair), металлическая оправа.', estimates: ['задержка'],
    sources: ['https://www.uploadvr.com/viture-luma-viture-the-beast-display-glasses-announce-preorders/', 'https://arinsider.co/2026/04/28/viture-beast-sets-new-standard-for-video-display-glasses/', 'https://www.gamingnexus.com/Article/16375/VITURE-Beast/'],
  },
  {
    id: 'xreal-air2-pro', short: 'air2pro', brand: 'XREAL', name: 'Air 2 Pro', fovDiag: 46, aspect: 16 / 9, res: [1920, 1080], nits: 500, refresh: 120,
    weightG: 75, optics: 'призма (birdbath), Sony micro-OLED', ghost: 0.07, edgeSoft: 0.55,
    transmit: 0.25, dimLevels: [0.25, 0.10, 0.005], dimNote: 'электрохромное, 3 положения',
    tracking: '3dof', hands: false, cameras: 'нет', driftDegMin: 2.5, latencyMs: 25, distM: 4, centerDeg: -1, dial: 0, housing: 16,
    note: 'Узкое поле 46°, 500 нит — в светлом цеху окна бледнее. Трекинг 3DoF средствами хоста. Коррекция — линзами-вставками.',
    estimates: ['пропускание линз', 'задержка'], sources: ['https://www.uploadvr.com/xreal-air-2-pro/'],
  },
  {
    id: 'xreal-air2-ultra', short: 'air2ultra', brand: 'XREAL', name: 'Air 2 Ultra', fovDiag: 52, aspect: 16 / 9, res: [1920, 1080], nits: 500, refresh: 120,
    weightG: 80, optics: 'призма (birdbath), Sony micro-OLED', ghost: 0.07, edgeSoft: 0.5,
    transmit: 0.25, dimLevels: null, dimNote: 'затемнения нет (съёмная шторка)',
    tracking: '6dof', hands: true, cameras: '2 камеры окружения', driftDegMin: 0, latencyMs: 20, distM: 4, centerDeg: -1, dial: 0, housing: 16,
    note: '6DoF и жесты, но 500 нит и без затемнения — при ярком свете голограммы теряются.', estimates: ['пропускание линз', 'задержка'],
    sources: ['https://www.roadtovr.com/xreal-air-2-ultra-ar-glasses-apple-vision-pro/'],
  },
  {
    id: 'xreal-one', short: 'one', brand: 'XREAL', name: 'One', fovDiag: 50, aspect: 16 / 9, res: [1920, 1080], nits: 600, refresh: 120,
    weightG: 84, optics: 'призма (birdbath), Sony 0,68″ micro-OLED, чип X1', ghost: 0.06, edgeSoft: 0.45,
    transmit: 0.28, dimLevels: [0.28, 0.12, 0.01], dimNote: 'электрохромное, 3 режима',
    tracking: '3dof', hands: false, cameras: 'нет (опц. камера Eye)', driftDegMin: 0.6, latencyMs: 3, distM: 4, centerDeg: -1, dial: 0, housing: 16,
    note: 'Собственный 3DoF в очках (X1), задержка 3 мс — окна «стоят» при поворотах. С камерой XREAL Eye и XREAL SDK 3.1 — 6DoF.', estimates: ['пропускание линз'],
    sources: ['https://tutorials.xreal.com/docs/glasses/one-series/spec'],
  },
  {
    id: 'xreal-one-pro', short: 'onepro', brand: 'XREAL', name: 'One Pro', fovDiag: 57, aspect: 16 / 9, res: [1920, 1080], nits: 700, refresh: 120,
    weightG: 87, optics: 'плоская призма X-Prism, Sony 0,55″ micro-OLED', ghost: 0.012, edgeSoft: 0.2,
    transmit: 0.30, dimLevels: [0.30, 0.12, 0.01], dimNote: 'электрохромное, 3 режима',
    tracking: '3dof', hands: false, cameras: 'нет (опц. камера Eye)', driftDegMin: 0.6, latencyMs: 3, distM: 4, centerDeg: -1, dial: 0, housing: 14,
    note: 'Плоская призма X-Prism: без внутренних бликов, резкие края. 3DoF, 3 мс; с камерой XREAL Eye (12 Мп, 1,5 г) и SDK 3.1 — 6DoF.', estimates: ['пропускание линз'],
    sources: ['https://tutorials.xreal.com/docs/glasses/one-series/spec', 'https://docs.xreal.com/Release%20Note/XREAL%20SDK%203.1.0'],
  },
  {
    // комплект для закупки: One Pro + камера XREAL Eye + XREAL Beam Pro (вычислительный блок Android)
    id: 'xreal-one-pro-eye', short: 'oneproeye', brand: 'XREAL', name: 'One Pro + Eye', fovDiag: 57, aspect: 16 / 9, res: [1920, 1080], nits: 700, refresh: 120,
    weightG: 89, optics: 'плоская призма X-Prism, Sony 0,55″ micro-OLED', ghost: 0.012, edgeSoft: 0.2,
    transmit: 0.30, dimLevels: [0.30, 0.12, 0.01], dimNote: 'электрохромное, 3 режима',
    tracking: '6dof', hands: false, cameras: 'XREAL Eye 12 Мп (RGB)', driftDegMin: 0, latencyMs: 12, distM: 4, centerDeg: -1, dial: 0, housing: 14,
    note: '6DoF по камере Eye — только в приложении на XREAL SDK 3.1 (Beam Pro). Штатно — 3DoF-якорь экрана чипом X1.',
    estimates: ['задержка 6DoF', 'пропускание линз'],
    sources: ['https://docs.xreal.com/Release%20Note/XREAL%20SDK%203.1.0', 'https://xreal.com.ru/one-pro'],
  },
  {
    id: 'xreal-aura', short: 'aura', brand: 'XREAL', name: 'Aura (Android XR)', fovDiag: 70, aspect: 16 / 10, res: [1920, 1200], nits: 700, refresh: 120,
    weightG: 95, optics: 'плоская призма X-Prism, Sony micro-OLED, X1S + вычислительный блок Snapdragon Reality Elite', ghost: 0.015, edgeSoft: 0.25,
    transmit: 0.40, dimLevels: [0.40, 0.18, 0.05], dimNote: 'электрохромное',
    tracking: '6dof', hands: true, cameras: '2 камеры, трекинг рук', driftDegMin: 0, latencyMs: 8, distM: 2, centerDeg: 0, dial: 0, housing: 12,
    note: 'Поле 70°: окна КД и перехода видны целиком. 6DoF, руки, Android XR. Блок вычислений (с тачпадом) на кабеле. ≈ $1500, осень 2026.',
    estimates: ['яркость (не опубликована)', 'пропускание', 'задержка', 'расстояние экрана', 'вес'],
    sources: ['https://www.xreal.com/us/blog/aura-25-tas-release-en', 'https://www.arcompare.com/ar-glasses/xreal-project-aura/', 'https://www.techtimes.com/articles/319140/20260626/xreal-aura-brings-70-degree-android-xr-glasses-mwc-shanghai-fall-2026-launch-confirmed.htm', 'https://gsmarena.com/xreal_aura_glasses_unveiled_with_android_xr_and_the_new_snapdragon_reality_elite-news-73315.php'],
  },
];

export const deviceById = new Map(DEVICES.flatMap((d) => [[d.id, d], [d.short, d]]));
export const DEFAULT_DEVICE = 'viture-luma-ultra';

/** Окно дисплея, градусы: по горизонтали и вертикали из диагонали и формата (плоская проекция). */
export function windowDeg(d) {
  const td = Math.tan((d.fovDiag * Math.PI) / 360);
  const tv = td / Math.sqrt(1 + d.aspect * d.aspect);
  return { h: (2 * Math.atan(tv * d.aspect) * 180) / Math.PI, v: (2 * Math.atan(tv) * 180) / Math.PI };
}

/** Угловая плотность пикселей в центре, пикс/° (по горизонтали). */
export function pixelsPerDegree(d) { return d.res[0] / windowDeg(d).h; }

/** Помещается ли окно размером w×h (м) на расстоянии dist (м) в поле дисплея целиком. */
export function fitsWindow(d, w, h, dist) {
  const W = windowDeg(d);
  const aw = (2 * Math.atan(w / 2 / dist) * 180) / Math.PI, ah = (2 * Math.atan(h / 2 / dist) * 180) / Math.PI;
  return aw <= W.h && ah <= W.v;
}

/** Расстояние, с которого окно w×h видно целиком (м). */
export function fitDistance(d, w, h) {
  const W = windowDeg(d);
  return Math.max(w / 2 / Math.tan((W.h * Math.PI) / 360), h / 2 / Math.tan((W.v * Math.PI) / 360));
}

/** Скорость накопления усталости от веса (относительно 80 г). */
export function weightFatigue(d) { return Math.max(0.5, d.weightG / 80); }

/** Пропускание линз при уровне затемнения level (0 — прозрачнее всего, 1 — самая тёмная ступень). */
export function transmitAt(d, level = 0) {
  if (!d.dimLevels) return d.transmit;
  const a = d.dimLevels[0], b = d.dimLevels[d.dimLevels.length - 1];
  return a + (b - a) * Math.min(1, Math.max(0, level));
}

/** Уровень (0..1), соответствующий ступени затемнения i устройства. */
export function dimLevelOfStep(d, i) {
  if (!d.dimLevels) return 0;
  const a = d.dimLevels[0], b = d.dimLevels[d.dimLevels.length - 1];
  return (a - d.dimLevels[i]) / (a - b);
}

/** Ближайшая ступень затемнения к уровню level. */
export function dimStepOf(d, level) {
  if (!d.dimLevels) return 0;
  const t = transmitAt(d, level);
  let best = 0;
  d.dimLevels.forEach((x, i) => { if (Math.abs(x - t) < Math.abs(d.dimLevels[best] - t)) best = i; });
  return best;
}

/** Устройство по фразе («виче ультра», «иксреал ван про», «аура», «xreal one»). */
export function matchDevice(text) {
  const t = String(text || '').toLowerCase().replaceAll('ё', 'е');
  const brand = /xreal|эксреал|иксреал|экс реал|икс реал|нреал/.test(t) ? 'XREAL' : /viture|витур|вичур|виче|вайчур|витьюр/.test(t) ? 'VITURE' : null;
  const has = (re) => re.test(t);
  if (has(/aura|аур/)) return 'xreal-aura';
  if (has(/beast|бист/)) return 'viture-beast';
  if (has(/air|эйр|аир|эир/)) return has(/ultra|ультра/) ? 'xreal-air2-ultra' : 'xreal-air2-pro';
  if (has(/one|ван/)) return has(/pro|про/) ? (has(/eye|ай|камер/) ? 'xreal-one-pro-eye' : 'xreal-one-pro') : 'xreal-one';
  if (has(/luma|люма|лума/) || brand === 'VITURE') return has(/ultra|ультра/) ? 'viture-luma-ultra' : has(/pro|про/) ? 'viture-luma-pro' : 'viture-luma-ultra';
  if (brand === 'XREAL') return has(/pro|про/) ? 'xreal-one-pro' : 'xreal-one';
  if (has(/ultra|ультра/)) return 'viture-luma-ultra';
  return null;
}

/** Краткая строка характеристик для карточки и планшета. */
export function deviceSummary(d) {
  const w = windowDeg(d);
  return `${d.fovDiag}° (${w.h.toFixed(0)}×${w.v.toFixed(0)}°) · ${d.res[0]}×${d.res[1]} · ${pixelsPerDegree(d).toFixed(0)} пикс/° · ${d.nits} нит · ` +
    `${d.tracking === '6dof' ? '6DoF' : '3DoF'}${d.hands ? ' + руки' : ''} · ${d.latencyMs} мс · ${d.weightG} г · пропускание ${Math.round(d.transmit * 100)} %` +
    `${d.dimLevels ? `…${(d.dimLevels[d.dimLevels.length - 1] * 100).toFixed(1).replace('.0', '')} %` : ''}`;
}
