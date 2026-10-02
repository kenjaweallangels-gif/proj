// Реестр документов (КД и ТП), поиск по чертёжному номеру, сменное задание и сценарий чата с мастером.
// Чистые данные, без three.js.
import { OPERATIONS, TP } from './process.js';
import { BRACKET, EQUIPMENT, FITTINGS, PANELS, PRODUCT, TRIMS } from './spec.js';

/** Документ: { code, title, kind: 'СБ'|'СП'|'Э4'|'деталь'|'ТП', sheets: [{n, title, scale}], refs } */
const doc = (code, title, kind, sheets, extra = {}) => ({ code, title, kind, sheets, ...extra });

const panelDocs = [];
for (const p of PANELS) {
  const base = p.designation.replace(/-\d\d$/, '');
  let d = panelDocs.find((x) => x.code === base);
  if (!d) {
    d = doc(base, p.name, 'деталь', [{ n: 1, title: p.name, scale: '1:5', format: 'A2' }], { panels: [] });
    panelDocs.push(d);
  }
  d.panels.push(p.id);
  if (p.designation !== base) d.variants = [...(d.variants || []), p.designation];
}

export const DOCUMENTS = [
  doc(`${PRODUCT.designation} СБ`, `${PRODUCT.name}. Сборочный чертёж`, 'СБ', [
    { n: 1, title: 'Виды спереди, слева, сверху. Технические требования', scale: '1:10', format: 'A1' },
    { n: 2, title: 'Узлы А–Г: шип-паз, уголок, вставка, крепление к полу', scale: '2:1', format: 'A1' },
    { n: 3, title: 'Схема покрытий и декоративной отделки', scale: '1:10', format: 'A1' },
  ]),
  doc(PRODUCT.designation, `${PRODUCT.name}. Спецификация`, 'СП', [{ n: 1, title: 'Спецификация', scale: '—', format: 'A4' }]),
  doc('КМ2.500.000 Э4', 'Жгут модуля. Схема электрическая соединений', 'Э4', [{ n: 1, title: 'Схема соединений', scale: '—', format: 'A2' }]),
  ...panelDocs,
  doc(BRACKET.designation, 'Уголок', 'деталь', [{ n: 1, title: BRACKET.name, scale: '2:1', format: 'A4' }]),
  ...[...new Set(TRIMS.map((t) => t.designation.replace(/-\d\d$/, '')))].map((code) =>
    doc(code, TRIMS.find((t) => t.designation.startsWith(code)).name, 'деталь', [{ n: 1, title: 'Профиль', scale: '2:1', format: 'A4' }])),
  ...[...new Set(FITTINGS.map((f) => f.designation))].map((code) =>
    doc(code, FITTINGS.find((f) => f.designation === code).name, 'деталь', [{ n: 1, title: 'Узел', scale: '1:1', format: 'A3' }])),
  doc('КМ2.500.100', EQUIPMENT.find((e) => e.id === 'CB-1').name, 'деталь', [{ n: 1, title: 'Щиток', scale: '1:2', format: 'A3' }]),
  doc(TP.designation, `${TP.name}. Технологический процесс`, 'ТП', [{ n: 1, title: 'Маршрут операций', scale: '—', format: 'A4' }],
    { operations: OPERATIONS.map((o) => o.id) }),
];
export const docByCode = new Map(DOCUMENTS.map((d) => [d.code, d]));

// латиница, набранная вместо кириллицы в обозначениях (KM2 → КМ2), регистр, пробелы и точки не важны
const LAT2CYR = { A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', K: 'К', M: 'М', O: 'О', P: 'Р', T: 'Т', X: 'Х', Y: 'У' };
export function normalizeCode(s) {
  return String(s || '').toUpperCase().replace(/Ё/g, 'Е')
    .replace(/\b(SB|SP|E4|TP)\b/g, (m) => ({ SB: 'СБ', SP: 'СП', E4: 'Э4', TP: 'ТП' }[m]))   // транслит кодов документов
    .replace(/[ABCEHKMOPTXY]/g, (c) => LAT2CYR[c]).replace(/[\s.\-_]/g, '');
}

/** Поиск документов по номеру (часть номера) или словам наименования. Сначала точные совпадения номера. */
export function searchDocs(query) {
  const q = normalizeCode(query);
  if (!q) return [];
  const words = String(query).toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const scored = [];
  for (const d of DOCUMENTS) {
    const c = normalizeCode(d.code);
    let score = 0;
    if (c === q) score = 100;
    else if (c.startsWith(q)) score = 80;
    else if (c.includes(q)) score = 60;
    else if ((d.variants || []).some((v) => normalizeCode(v).includes(q))) score = 55;
    else if (words.length && words.every((w) => d.title.toLowerCase().includes(w))) score = 40;
    if (score) scored.push({ d, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.d.code.localeCompare(b.d.code)).map((x) => x.d);
}

// ---------- сменное задание и чат ----------
export const TASK = {
  date: '02.10.2026', shift: '1 смена, 07:30–16:00',
  worker: 'Сборщик-клепальщик 4 р., таб. № 1047', master: 'Мастер участка',
  items: [
    { id: 'Z1', text: `${PRODUCT.name} ${PRODUCT.designation}, зав. № ${PRODUCT.serial}`, ops: '010–080', doc: `${PRODUCT.designation} СБ`, tp: TP.designation, normH: 7.5 },
    { id: 'Z2', text: 'Подготовить верхние панели к оп. 080 во время выдержки клея оп. 070', ops: '080', doc: 'КМ2.180.000', normH: 0.5 },
    { id: 'Z3', text: 'Сдать журнал операций и фото критичных переходов в систему', ops: '—', normH: 0.2 },
  ],
  notes: ['Партия клея № 2614, годен до 15.11.2026.', 'Стапель СТ-3 откалиброван 30.09.2026.', 'Температура на участке 21 °C, влажность 45 %.'],
};

export const CHAT_SCRIPT = [
  { at: 2, from: 'Мастер участка', text: 'Доброе утро. Сегодня КМ-2 № 017, операции 010–080. Клей новой партии, проверь этикетку.' },
  { at: 25, from: 'Мастер участка', text: 'Перед установкой стола выстави упоры на 1105 по шкале стойки, не по рулетке.' },
  { at: 60, from: 'Технолог', text: 'Обрати внимание на узел А листа 2: заполнение паза клеем 60–70 %, не больше.' },
];

export const AUTO_REPLIES = [
  'Принял. Если отклонение больше допуска — остановись и позови меня.',
  'Хорошо, подойду к стапелю через 10 минут.',
  'Фото получил, по журналу всё сходится.',
  'Таймер выдержки не сокращать. Пока ждёшь — подготовь полку и перегородки.',
];
