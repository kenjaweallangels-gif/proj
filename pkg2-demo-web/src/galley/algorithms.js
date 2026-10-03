// Каталог алгоритмов изготовления и сборки для окна «Система» в очках. Алгоритм = процесс (переходы ТП),
// КД (документы, у каждого может быть несколько листов) и дерево сборки (если это сборка). Чистые данные,
// без three.js: переходы участков передаются снаружи (их описывают модули участков).
import { DOCUMENTS, docByCode } from './catalog.js';
import { OPERATIONS, STEPS, TP } from './process.js';
import * as S from './spec.js';

/** Узел дерева сборки: { code, name, qty, doc?, children? } */
const node = (code, name, qty = 1, children = null, doc = null) => ({ code, name, qty, ...(children ? { children } : {}), ...(doc ? { doc } : {}) });

/** Группа одинаковых деталей (по обозначению и наименованию) → узлы с количеством. */
function grouped(features) {
  const m = new Map();
  for (const f of features) {
    const k = `${f.designation || ''}|${f.name}`;
    if (!m.has(k)) m.set(k, node(f.designation || '—', f.name, 0, null, docOf(f.designation)));
    m.get(k).qty++;
  }
  return [...m.values()];
}
const docOf = (code) => {
  if (!code) return null;
  if (docByCode.has(code)) return code;
  const base = code.replace(/-\d\d$/, '');
  return docByCode.has(base) ? base : null;
};
const kinds = (...k) => S.FEATURES.filter((f) => k.includes(f.kind));

/** Дерево сборки модуля КМ-2 — из спецификации изделия. */
export function treeKM2() {
  const doors = S.FEATURES.filter((f) => f.kind === 'door').map((d) => node(d.designation, d.name, 1, grouped(S.FEATURES.filter((f) => f.door === d.id)), docOf(d.designation)));
  return node(S.PRODUCT.designation, S.PRODUCT.name, 1, [
    node('—', 'Панели сотовые', 0, grouped(kinds('panel'))),
    node('—', 'Соединения и крепёж', 0, grouped(kinds('bracket', 'insert', 'screw'))),
    node('—', 'Узлы крепления к полу, профили', 0, grouped(kinds('fitting', 'trim'))),
    node('—', 'Двери с петлями и защёлками', 0, doors),
    node('—', 'Электрооборудование', 0, grouped(kinds('harness', 'clamp', 'light', 'equipment'))),
    node('—', 'Водоснабжение и мойка', 0, grouped(kinds('water', 'sheet', 'sink', 'faucet', 'valve'))),
    node('—', 'Отделка и маркировка', 0, grouped(kinds('film', 'paint', 'placard', 'handle', 'turnbutton', 'retainer'))),
  ], `${S.PRODUCT.designation} СБ`);
}

/** Дерево жгута КМ2.500.000 (участок ЭМ-1, макет 1:1). */
export function treeHarness() {
  return node('КМ2.500.000', 'Жгут основной модуля', 1, [
    node('—', 'Провод МГТФ 0,35 (по таблице проводов)', 24),
    node('—', 'Провод МГТФ 0,75 (питание 115 В)', 6),
    node('—', 'Отвод B1 — светильники', 1, [node('XP1', 'Розетка 2РМТ18 (усл.)', 1)]),
    node('—', 'Отвод B2 — печи и кипятильник', 1, [node('XP2', 'Розетка 2РМТ22 (усл.)', 1), node('XP3', 'Розетка 2РМТ22 (усл.)', 1)]),
    node('—', 'Отвод B3 — кофеварка, щиток', 1, [node('XP4', 'Розетка 2РМТ18 (усл.)', 1), node('XP5', 'Вилка 2РМТ22 (ввод)', 1)]),
    node('—', 'Трубка термоусадочная ТУТ 6/3, 12/6', 14),
    node('—', 'Бирки маркировочные', 30),
    node('—', 'Стяжки кабельные 2,5 × 100', 40),
  ], 'КМ2.500.000 Э4');
}

/** Дерево кронштейна КМ2.310.050 (участок СЛ-1). */
export function treeBracket() {
  return node('КМ2.310.050', 'Кронштейн', 1, [
    node('—', 'Заготовка: лист Д16АТ δ2, 120 × 60', 1),
    node('КМ2.310.051', 'Втулка запрессовываемая', 2),
    node('—', 'Покрытие: Ан.Окс.хром (Алодин 1132)', 1),
  ], 'КМ2.310.050');
}

/** Дерево монтажа электрооборудования модуля (участок МЭ-1). */
export function treeInstall() {
  return node(`${S.PRODUCT.designation}`, `${S.PRODUCT.name} — электрооборудование`, 1, grouped(kinds('harness', 'clamp', 'light', 'equipment')), 'КМ2.500.000 Э4');
}

/** Плоский список строк для показа дерева; open — множество раскрытых путей ('0', '0.2', …). */
export function treeRows(tree, open = new Set(['0'])) {
  const rows = [];
  const walk = (n, path, depth) => {
    const has = !!n.children?.length;
    rows.push({ path, depth, node: n, has, open: open.has(path) });
    if (has && open.has(path)) n.children.forEach((c, i) => walk(c, `${path}.${i}`, depth + 1));
  };
  walk(tree, '0', 0);
  return rows;
}

const fromStation = (st) => st.steps.map((s) => ({ id: s.id, op: s.op, title: s.title, text: s.text || [], tools: s.tools || [], check: s.check || null }));

/**
 * Каталог. stations — участки (id, short, product, steps); у каждого алгоритма place — где выполняется
 * (jig — стапель СТ-3, em1/sl1/me1 — участки), kind — сборка/изготовление/монтаж.
 */
export function buildCatalog(stations = []) {
  const st = (id) => stations.find((s) => s.id === id);
  const list = [
    {
      id: 'km2', code: TP.designation, title: `Сборка: ${S.PRODUCT.name} ${S.PRODUCT.designation}`, kind: 'сборка', place: 'jig', placeName: 'Стапель СТ-3',
      product: { code: S.PRODUCT.designation, name: S.PRODUCT.name },
      steps: STEPS.map((s) => ({ id: s.id, op: s.op, title: s.title, text: s.text || [], tools: s.tools || [], check: s.check || null })),
      ops: OPERATIONS.map((o) => ({ id: o.id, title: o.title, n: o.steps.length })),
      docs: [`${S.PRODUCT.designation} СБ`, S.PRODUCT.designation, TP.designation, ...DOCUMENTS.filter((d) => d.panels).slice(0, 4).map((d) => d.code)],
      tree: treeKM2(),
    },
  ];
  if (st('em1')) list.push({ id: 'em1', code: 'ТП ЭМ1.500.000', title: 'Изготовление жгута КМ2.500.000 на макете 1:1', kind: 'изготовление', place: 'em1', placeName: st('em1').short,
    product: { code: 'КМ2.500.000', name: 'Жгут основной' }, steps: fromStation(st('em1')), docs: ['КМ2.500.000 Э4'], tree: treeHarness() });
  if (st('sl1')) list.push({ id: 'sl1', code: 'ТП СЛ1.310.050', title: 'Изготовление кронштейна КМ2.310.050', kind: 'изготовление', place: 'sl1', placeName: st('sl1').short,
    product: { code: 'КМ2.310.050', name: 'Кронштейн' }, steps: fromStation(st('sl1')), docs: ['КМ2.310.050'], tree: treeBracket() });
  if (st('me1')) list.push({ id: 'me1', code: 'ТП МЭ1.500.000', title: 'Монтаж жгутов и электрооборудования модуля КМ-2', kind: 'монтаж', place: 'me1', placeName: st('me1').short,
    product: { code: S.PRODUCT.designation, name: `${S.PRODUCT.name} (электрика)` }, steps: fromStation(st('me1')), docs: ['КМ2.500.000 Э4', `${S.PRODUCT.designation} СБ`], tree: treeInstall() });
  for (const a of list) a.sheets = a.docs.reduce((n, c) => n + (docByCode.get(c)?.sheets.length || 0), 0);
  return list;
}

/** Поиск алгоритма по словам (голос: «открой алгоритм кронштейн»). */
export function findAlgorithm(list, words) {
  const w = String(words || '').toLowerCase().replace(/ё/g, 'е');
  if (!w.trim()) return null;
  const keys = { km2: ['модул', 'кухон', 'км 2', 'км2', 'стапел'], em1: ['жгут', 'макет', 'эм 1', 'эм1', 'провод'], sl1: ['кронштейн', 'слесар', 'сл 1', 'сл1'], me1: ['монтаж', 'электрооборуд', 'мэ 1', 'мэ1'] };
  return list.find((a) => (keys[a.id] || []).some((k) => w.includes(k))) || list.find((a) => a.title.toLowerCase().includes(w)) || null;
}
