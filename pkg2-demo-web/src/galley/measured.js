// Замеры реальных очков → профили симулятора. Файлы measurements/<id-модели>.json пишет стенд очков
// (pkg1-sim-vm/tools/glasses_lab, lab.html → «Замеры»); файлы с «_» в начале — примеры, не читаются.
// Значения из values заменяют поля профиля (glasses.js), из sdk — поля режима «своё ПО» (software.js);
// заменённые поля больше не считаются оценкой, а карточка «Очки» показывает дату и что измерено.
import { DEVICES } from './glasses.js';
import { SW } from './software.js';

/** Поля профиля, которые можно измерить (как measurement.FIELDS в pkg1). imuHz и poseNoiseDeg — только для справки. */
export const PROFILE_FIELDS = ['nits', 'fovDiag', 'transmit', 'refresh', 'latencyMs', 'driftDegMin', 'weightG', 'distM'];
export const INFO_FIELDS = ['imuHz', 'poseNoiseDeg'];
export const SDK_FIELDS = ['latencyMs', 'hz', 'trackMM', 'trackDeg'];

const ESTIMATE_OF = { latencyMs: /задержк/i, transmit: /пропуск/i, nits: /ярк/i, distM: /расстоян/i, weightG: /вес/i, fovDiag: /пол/i };

/** Профиль d с подставленными замерами m (новый объект; d не меняется). */
export function applyMeasurement(d, m) {
  if (!m || m.device !== d.id) return d;
  const v = m.values || {};
  const keys = PROFILE_FIELDS.filter((k) => typeof v[k] === 'number');
  const out = { ...d };
  for (const k of keys) out[k] = v[k];
  // пропускание без затемнения меняет и первую ступень затемнения
  if (keys.includes('transmit') && d.dimLevels) out.dimLevels = [v.transmit, ...d.dimLevels.slice(1)];
  out.estimates = (d.estimates || []).filter((e) => !keys.some((k) => ESTIMATE_OF[k]?.test(e)));
  out.measured = {
    date: m.date || '', by: m.by || '', keys,
    info: Object.fromEntries(INFO_FIELDS.filter((k) => typeof v[k] === 'number').map((k) => [k, v[k]])),
    sdk: Object.fromEntries(SDK_FIELDS.filter((k) => typeof m.sdk?.[k] === 'number').map((k) => [k, m.sdk[k]])),
    method: m.method || {},
  };
  return out;
}

/** Строка «режима ПО» с подставленными замерами для своего ПО. */
export function applySdkMeasurement(row, m) {
  const s = SDK_FIELDS.filter((k) => typeof m?.sdk?.[k] === 'number');
  if (!row?.sdk || !s.length) return row;
  return { ...row, sdk: { ...row.sdk, ...Object.fromEntries(s.map((k) => [k, m.sdk[k]])) }, unsure: row.unsure.filter((u) => !/задержк/i.test(u) || !s.includes('latencyMs')) };
}

/** Все файлы замеров из measurements/ (кроме _*.json). */
export function loadMeasurements() {
  const files = import.meta.glob('../../measurements/*.json', { eager: true, import: 'default' });
  return Object.entries(files).filter(([p]) => !/\/_[^/]*$/.test(p)).map(([, m]) => m).filter((m) => m?.device);
}

/** Подставить замеры в DEVICES и SW (на месте). Возвращает id моделей, для которых есть замеры. */
export function installMeasurements(list = loadMeasurements()) {
  const done = [];
  for (const m of list) {
    const i = DEVICES.findIndex((d) => d.id === m.device);
    if (i < 0) { console.warn(`[замеры] нет профиля «${m.device}» в glasses.js`); continue; }
    Object.assign(DEVICES[i], applyMeasurement(DEVICES[i], m));
    if (SW[m.device]) SW[m.device] = applySdkMeasurement(SW[m.device], m);
    done.push(m.device);
  }
  return done;
}
