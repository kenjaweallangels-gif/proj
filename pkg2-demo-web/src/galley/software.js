// Режим ПО очков: что очки умеют «из коробки» и что даёт своё ПО на SDK производителя.
// «Штатное ПО» — очки работают как внешний экран (USB-C DisplayPort) плюс то, что делает сама прошивка очков
// (кнопки яркости и затемнения; у XREAL One/One Pro — 3DoF-«якорь» экрана чипом X1). Нашей программе
// доступна только картинка: ни позы головы, ни камеры. Голограммы на изделии невозможны, окна — плоский экран.
// «Своё ПО на SDK» — наш клиент читает позу (IMU/VIO), камеру и метки, рисует стерео (SBS) в своей СК,
// управляет затемнением и яркостью настолько, насколько это открывает SDK. Чего нет в железе
// (3DoF не станет 6DoF, у очков без камеры нет меток), программа не добавит.
// Значения, не подтверждённые документацией SDK, перечислены в unsure: их проверяем по SDK-пакетам.

/**
 * @typedef {{ host:string, windows:'head'|'3dof'|'6dof', latencyMs:number, hz:number, stereo:boolean,
 *   markers:boolean, hands:boolean, camera:string|null, trackMM:number, trackDeg:number,
 *   dim:'buttons'|'sdk'|'none', dimSteps:number[]|null, bright:'buttons'|'sdk', brightSteps:number, note:string }} SwCaps
 */

const STOCK_HEAD = (o) => ({ windows: 'head', latencyMs: 0, stereo: false, markers: false, hands: false, camera: null, trackMM: 0, trackDeg: 0, dim: 'buttons', bright: 'buttons', ...o });

/** По моделям: штатное ПО и своё ПО на SDK. */
export const SW = {
  'viture-luma-ultra': {
    stock: STOCK_HEAD({ host: 'ПК / телефон по USB-C (как монитор)', hz: 60, brightSteps: 9,
      note: 'Очки — внешний монитор (DP): своего 3DoF в очках нет, картинка «приклеена» к голове. 3DoF/6DoF и жесты — только в приложении SpaceWalker.' }),
    sdk: { host: 'мини-ПК Linux (C SDK) или Pro Neckband (Unity XR SDK)', windows: '6dof', latencyMs: 16, hz: 90, stereo: true,
      markers: true, hands: true, camera: 'RGB UVC 1920×1080 30 к/с + 2 серые стереокамеры 25 Гц', trackMM: 1.5, trackDeg: 0.08,
      dim: 'sdk', dimSteps: [0.40, 0.005], bright: 'sdk', brightSteps: 9,
      note: 'C SDK: поза 6DoF VIO с упреждением (пример — 16 мс), стерео SBS 3840×1200 до 90 Гц (120 Гц — только 2D), яркость 9 ступеней, затемнение вкл/выкл, камеры RGB и стерео. Метки ArUco — наш алгоритм по RGB-кадрам. Руки — только Unity SDK на Neckband.' },
    unsure: ['реальная задержка позы и дисплея с нашим рендером (в документации — пример 16 мс)', 'затемнение Luma Ultra: только вкл/выкл или ступени', 'одновременный поток RGB и стереокамер', 'соответствие ступеней яркости 0–8 нитам', 'лицензия C SDK (отчёт статистики xr_stat_reporter)'],
  },
  'viture-luma-pro': {
    stock: STOCK_HEAD({ host: 'ПК / телефон по USB-C (как монитор)', hz: 60, brightSteps: 9, note: 'Внешний монитор, картинка движется с головой.' }),
    sdk: { host: 'ПК (C SDK) или Pro Neckband', windows: '3dof', latencyMs: 16, hz: 90, stereo: true, markers: false, hands: false,
      camera: 'RGB UVC — фото в журнал, не трекинг', trackMM: 0, trackDeg: 0.15, dim: 'sdk', dimSteps: [0.40, 0.005], bright: 'sdk', brightSteps: 9,
      note: '3DoF по IMU: окна вокруг головы с дрейфом, привязки к изделию нет.' },
    unsure: ['затемнение: только вкл/выкл или ступени', 'задержка 3DoF с нашим рендером'],
  },
  'viture-beast': {
    stock: { ...STOCK_HEAD({ host: 'ПК / телефон по USB-C', hz: 60, brightSteps: 9 }), windows: '3dof', latencyMs: 6,
      note: '3DoF-«якорь» экрана в самих очках (VisionPair), без привязки к изделию.' },
    sdk: { host: 'ПК (C SDK) или Pro Neckband', windows: '3dof', latencyMs: 18, hz: 90, stereo: true, markers: false, hands: false,
      camera: 'RGB — фото в журнал', trackMM: 0, trackDeg: 0.12, dim: 'sdk', dimSteps: 'device', bright: 'sdk', brightSteps: 9,
      note: '3DoF (в очках), поле 58°: больше окон без поворота головы. Затемнение 9 ступеней из SDK.' },
    unsure: ['задержка встроенного 3DoF'],
  },
  'xreal-air2-pro': {
    stock: STOCK_HEAD({ host: 'ПК / телефон по USB-C', hz: 60, brightSteps: 5, note: 'Внешний монитор, картинка движется с головой.' }),
    sdk: { host: 'Android / Beam Pro (XREAL SDK 3)', windows: '3dof', latencyMs: 25, hz: 60, stereo: true, markers: false, hands: false, camera: null,
      trackMM: 0, trackDeg: 0.2, dim: 'buttons', dimSteps: null, bright: 'buttons', brightSteps: 5,
      note: '3DoF средствами хоста; камеры нет — меток и фото нет.' },
    unsure: ['XREAL SDK: программное управление затемнением и яркостью'],
  },
  'xreal-air2-ultra': {
    stock: STOCK_HEAD({ host: 'ПК / телефон по USB-C', hz: 60, brightSteps: 5, note: 'Внешний монитор; 6DoF только в приложениях на SDK.' }),
    sdk: { host: 'Android / Beam Pro (XREAL SDK 3)', windows: '6dof', latencyMs: 20, hz: 60, stereo: true, markers: true, hands: true,
      camera: '2 серые камеры окружения (RGB нет)', trackMM: 2, trackDeg: 0.1, dim: 'none', dimSteps: null, bright: 'buttons', brightSteps: 5,
      note: '6DoF, распознавание изображений, руки. RGB-камеры нет: метки — по серым камерам, через SDK.' },
    unsure: ['доступ к кадрам серых камер для своих алгоритмов', 'управление яркостью из SDK'],
  },
  'xreal-one': {
    stock: { ...STOCK_HEAD({ host: 'ПК / телефон по USB-C', hz: 60, brightSteps: 5 }), windows: '3dof', latencyMs: 3,
      note: 'Чип X1: 3DoF-«якорь» экрана в самих очках, 3 мс. Окна стоят, но не на изделии.' },
    sdk: { host: 'Android / Beam Pro (XREAL SDK 3.1)', windows: '3dof', latencyMs: 3, hz: 90, stereo: true, markers: false, hands: false, camera: null,
      trackMM: 0, trackDeg: 0.1, dim: 'buttons', dimSteps: null, bright: 'buttons', brightSteps: 5,
      note: 'Без камеры XREAL Eye — 3DoF.' },
    unsure: ['XREAL SDK 3: сеттеров яркости и затемнения в документации нет (только чтение)'],
  },
  'xreal-one-pro': {
    stock: { ...STOCK_HEAD({ host: 'ПК / телефон по USB-C', hz: 60, brightSteps: 5 }), windows: '3dof', latencyMs: 3,
      note: 'Чип X1: 3DoF-«якорь» экрана в очках, 3 мс. Камера Eye в штатном режиме — только фото/видео.' },
    sdk: { host: 'Android / Beam Pro (XREAL SDK 3.1)', windows: '3dof', latencyMs: 3, hz: 90, stereo: true, markers: false, hands: false, camera: null,
      trackMM: 0, trackDeg: 0.1, dim: 'buttons', dimSteps: null, bright: 'buttons', brightSteps: 5,
      note: 'Без камеры Eye — 3DoF. С Eye — профиль «One Pro + Eye». Яркость и затемнение — кнопками (в SDK 3 только чтение).' },
    unsure: [],
  },
  'xreal-one-pro-eye': {
    stock: { ...STOCK_HEAD({ host: 'ПК / телефон по USB-C', hz: 60, brightSteps: 5 }), windows: '6dof', latencyMs: 3,
      note: 'Чип X1 с Eye: экран-«якорь» в пространстве (6DoF), режимы Follow/Anchor кнопкой X, экспериментальные жесты как мышь. Наших голограмм на изделии нет — только плоский экран.' },
    sdk: { host: 'XREAL Beam Pro (Android, XREAL SDK 3.1)', windows: '6dof', latencyMs: 12, hz: 90, stereo: true, markers: true, hands: false,
      camera: 'XREAL Eye: кадры YUV в реальном времени (видео 1600×1200 30 к/с)', trackMM: 2.5, trackDeg: 0.12, dim: 'buttons', dimSteps: null, bright: 'buttons', brightSteps: 5,
      note: 'SDK 3.1: 6DoF с Eye и кадры RGB-камеры — метки ArUco считает наш алгоритм на Beam Pro (≈ 4 ч работы). Рук, плоскостей и image tracking у серии One в SDK нет. Яркость и затемнение — только кнопками (в SDK лишь чтение).' },
    unsure: ['одновременно 6DoF и поток RGB-кадров Eye, разрешения пресетов', 'скрытые сеттеры яркости/затемнения в XREALPlugin', 'задержка 6DoF с Eye (3 мс — только для 3DoF X1)', 'руки на One Pro + Eye в новых версиях SDK'],
  },
  'xreal-aura': {
    stock: { ...STOCK_HEAD({ host: 'свой блок (Android XR)', hz: 90, brightSteps: 5 }), windows: '6dof', latencyMs: 8,
      note: 'Android XR сам даёт 6DoF и руки, но «штатно» — только готовые приложения, без нашей ТП и меток.' },
    sdk: { host: 'блок Snapdragon (Android XR: Jetpack XR / Unity / Godot)', windows: '6dof', latencyMs: 8, hz: 90, stereo: true, markers: true, hands: true,
      camera: '2 камеры (через разрешения Android XR)', trackMM: 1.5, trackDeg: 0.06, dim: 'sdk', dimSteps: [0.40, 0.18, 0.05], bright: 'sdk', brightSteps: 10,
      note: '6DoF, руки, якоря, камера по разрешению ОС.' },
    unsure: ['всё: очки в продажу осенью 2026, значения — оценки'],
  },
};

export const SW_LABEL = { stock: 'штатное ПО', sdk: 'своё ПО на SDK' };

/** Возможности очков d в режиме ПО mode ('stock' | 'sdk') — с учётом железа профиля. */
export function capsFor(d, mode = 'sdk') {
  const row = SW[d.id] || { stock: STOCK_HEAD({ host: 'USB-C', hz: 60, brightSteps: 5, note: '' }), sdk: null, unsure: [] };
  const m = mode === 'stock' || !row.sdk ? 'stock' : 'sdk';
  const c = { ...row[m] };
  // железо ограничивает: 6DoF только у очков с 6DoF в профиле, затемнение — только если оно есть
  if (c.windows === '6dof' && d.tracking !== '6dof') c.windows = '3dof';
  if (!d.dimLevels) { c.dim = 'none'; c.dimSteps = null; }
  const dimSteps = c.dim === 'buttons' || c.dimSteps === 'device' ? d.dimLevels : c.dimSteps;
  return {
    mode: m, label: SW_LABEL[m], ...c, dimSteps: dimSteps || null,
    holoOnPart: m === 'sdk' && c.windows === '6dof' && c.markers,
    driftDegMin: c.windows === '3dof' ? d.driftDegMin : 0,
    dimAuto: m === 'sdk' && c.dim === 'sdk', brightAuto: m === 'sdk' && c.bright === 'sdk',
    unsure: m === 'sdk' ? row.unsure : [],
  };
}

/** Ближайшая допустимая ступень пропускания (затемнение «вкл/выкл» у SDK — только крайние значения). */
export function snapTransmit(steps, t) {
  if (!steps?.length) return t;
  return steps.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a));
}

/** Строки сравнения режимов для карточки: [что, штатное, своё ПО]. */
export function compareRows(d) {
  const a = capsFor(d, 'stock'), b = capsFor(d, 'sdk');
  const win = (c) => ({ head: 'с головой (как монитор)', '3dof': '3DoF вокруг головы', '6dof': '6DoF в цеху' })[c.windows];
  const dim = (c) => (c.dim === 'none' ? 'нет' : c.dim === 'buttons' ? 'кнопкой' : `программно${c.dimSteps?.length === 2 ? ' (вкл/выкл)' : ''}, авто`);
  const yn = (v) => (v ? 'да' : 'нет');
  return [
    ['Хост', a.host, b.host],
    ['Окна', win(a), win(b)],
    ['Голограммы на изделии', yn(a.holoOnPart), yn(b.holoOnPart)],
    ['Метки стапеля', yn(a.markers), yn(b.markers)],
    ['Камера для своих алгоритмов', a.camera || 'нет', b.camera || 'нет'],
    ['Руки / жесты', yn(a.hands), yn(b.hands)],
    ['Картинка', a.stereo ? 'стерео' : 'моно (одна на оба глаза)', b.stereo ? 'стерео SBS' : 'моно'],
    ['Задержка поворота', a.windows === 'head' ? '— (движется с головой)' : `${a.latencyMs} мс`, `${b.latencyMs} мс`],
    ['Частота кадров', `${a.hz} Гц`, `${b.hz} Гц`],
    ['Дрожание позы', '—', b.trackMM ? `≈ ${b.trackMM} мм / ${b.trackDeg}°` : b.trackDeg ? `≈ ${b.trackDeg}°, дрейф ${d.driftDegMin}°/мин` : '—'],
    ['Затемнение', dim(a), dim(b)],
    ['Яркость', a.bright === 'buttons' ? 'кнопками' : 'программно', b.bright === 'buttons' ? 'кнопками' : 'программно, авто по свету'],
  ];
}
