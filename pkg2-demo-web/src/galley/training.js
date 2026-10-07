// Обучающая сборка модуля КМ-2 на стапеле: сценарий уроков из техпроцесса (без three.js — тестируется в node).
// Порядок как в ТП, с отличиями «как правильно учить»:
//  • декоративная плёнка клеится на боковину заранее — на столе подготовки рядом со стапелем (обезжирить → клей
//    кистью → плёнка с прикаткой валиком), и только потом боковина ставится в стапель;
//  • герметик (раковина, профиль кромки, облицовка стола) — отдельным уроком, тюбиком из пистолета, затем установка;
//  • к каждому уроку — пояснение, советы (💡) и предупреждения (⚠) о рискованных и важных моментах.
import { STEPS } from './process.js';
import * as S from './spec.js';

/** Позиции по спецификации: одинаковые детали (обозначение + наименование) — один номер, в порядке спецификации. */
export const POSITIONS = (() => {
  const pos = new Map(), byKey = new Map();
  let n = 0;
  for (const f of S.FEATURES) {
    if (['joint', 'paint'].includes(f.kind)) continue;
    const k = `${f.designation || f.id}|${f.name}`;
    if (!byKey.has(k)) byKey.set(k, ++n);
    pos.set(f.id, byKey.get(k));
  }
  return pos;
})();

/** Подпись детали: «поз. 3 · Панель боковая левая · КМ2.110.000». */
export function partLabel(id) {
  const f = S.featureById.get(id);
  if (!f) return id;
  const p = POSITIONS.get(id);
  return `${p ? `поз. ${p} · ` : ''}${f.name}${f.designation && !f.designation.includes('СБ') ? ` · ${f.designation}` : ''}`;
}

const FILM_OF = new Map(S.FEATURES.filter((f) => f.kind === 'film').map((f) => [f.panel, f.id]));
const HEAVY = new Set(['SIDE-L', 'SIDE-R', 'BACK', 'BASE', 'DECK']);
const has = (s, re) => re.test(`${s.title} ${(s.text || []).join(' ')}`);

/** Советы и предупреждения к уроку — по виду работы, ключевым словам и признакам перехода. */
export function adviceFor(L) {
  const tips = [], warns = [];
  const t = (x) => tips.push(x), w = (x) => warns.push(x);
  const k = L.action;
  if (k === 'glue') {
    w('Жизнеспособность смеси ≈ 20 мин — наносите сразу после смешивания, остаток не используйте.');
    t('Первые 5 см валика из смесителя — в отход: там несмешанный клей.');
    t('Заполнение паза 60–70 %: при посадке шипа клей выйдет валиком, излишки снять шпателем до отверждения.');
  }
  if (k === 'degrease') {
    w('Не касайтесь обезжиренной поверхности руками — жир с пальцев ослабит клеевое соединение.');
    t('Две салфетки: смоченная нефрасом, затем сухая. Выдержка до испарения ≈ 10 мин.');
  }
  if (k === 'brush') {
    t('Кистью — тонкий равномерный слой, без пропусков у кромок и вокруг вырезов.');
    w('Открытое время клея ≈ 15 мин: плёнку клеить сразу после нанесения.');
  }
  if (k === 'film') {
    t('Снимайте подложку постепенно, по 100 мм, прикатывая плёнку валиком от середины к краям.');
    w('Пузыри > 2 мм и складки — брак. Пузырь проколоть иглой и прикатать сразу.');
  }
  if (k === 'seal') {
    w('Перед нанесением обезжирьте зону — на грязной поверхности герметик отслоится.');
    t('Сплошной валик Ø 3–4 мм без разрывов, пистолет ведите равномерно под углом 45°.');
    t('Разгладьте шов смоченным шпателем в течение 10 мин, излишки снимите сразу.');
  }
  if (k === 'install') {
    if (L.parts.some((id) => HEAVY.has(id))) w('Габаритная панель — устанавливайте вдвоём, не опирайте на угол: сомнёте соты.');
    if (L.parts.some((id) => S.featureById.get(id)?.kind === 'panel')) t('Шипы — строго по пазам с клеем, без перекоса; базовые метки на кромках совместить.');
    if (L.parts.some((id) => S.featureById.get(id)?.kind === 'equipment')) w('Вставка до 15 кг — держите за корпус, не за ручку дверцы; разъёмы не пережать.');
    if (L.parts.includes('SINK-1')) w('Кромки выреза и отбортовки острые — только в перчатках.');
    const kinds = new Set(L.parts.map((id) => S.featureById.get(id)?.kind));
    if (kinds.has('trim')) t('Профиль надевать от середины кромки к краям, на радиусах — без складок; излишки герметика снять сразу.');
    if (kinds.has('door')) t('Зазоры по контуру 2 ± 0,5 мм — по пластиковым подкладкам, затем затянуть петли.');
    if (kinds.has('placard')) t('Табличку — по шаблону, ровность ±1 мм; поверхность перед наклейкой обезжирить.');
    if (kinds.has('sheet')) t('Лист прикатать от центра к краям, чтобы под ним не осталось воздуха.');
    if (kinds.has('valve') || kinds.has('faucet') || kinds.has('water')) t('Уплотнения — без перекоса, гайки тянуть ключом с ограничением момента.');
    if (kinds.has('light')) t('Разъём — до щелчка фиксатора, провод не натянут.');
    if (kinds.has('handle') || kinds.has('retainer')) t('Винты во вставки — с фиксатором резьбы, момент по КД.');
    if (kinds.has('equipment')) t('Задвигать по направляющим до щелчка защёлки, проверить фиксацию рывком на себя.');
  }
  if (k === 'fasten') {
    const tq = L.torque;
    t(`Момент ${tq ? `${tq} Н·м` : 'по КД'} — динамометрической отвёрткой, затяжка крест-накрест.`);
    w('Не перетягивайте: сорвёте резьбу закладной вставки, ремонт — замена вставки.');
  }
  if (k === 'wire') {
    t('Радиус изгиба жгута ≥ 5 его диаметров, хомуты — через 150–200 мм.');
    w('Жгут не должен касаться острых кромок и горячих поверхностей печей.');
  }
  if (k === 'paint') {
    w('Только в респираторе A2P2 и с вытяжкой. Плёнка уже наклеена — она должна быть закрыта маскировкой.');
    t('Расстояние 200–250 мм, перекрытие 50 %, без потёков на вертикалях.');
  }
  if (k === 'wait') w('Не нагружать сборку и не снимать прижимы до конца выдержки.');
  if (k === 'check' && L.check) {
    const c = L.check;
    t(`Норма: ${c.nominal ?? `${c.min ?? ''}…${c.max ?? ''}`}${c.tol ? ` ± ${c.tol}` : ''} ${c.unit || ''}`.trim());
    w('Вне допуска — остановитесь и вызовите мастера, дальше не собирать.');
  }
  if (L.mask) w('Плёнка уже на боковинах — закройте её маскирующей лентой целиком: растворитель эмали её испортит.');
  if (L.timer?.blocking || L.timer?.min >= 30) w(`Выдержка ${L.timer.min} мин — следующий переход только после неё.`);
  if (L.critical) w('Критичный переход: результат — в журнал, фото обязательно.');
  for (const x of L.warnSrc || []) w(x);
  return { tips: [...new Set(tips)], warns: [...new Set(warns)] };
}

const ACTION = { install: 'install', glue: 'glue', fasten: 'fasten', wire: 'wire', paint: 'paint', wait: 'wait', check: 'check', inspect: 'inspect' };

function fromStep(s) {
  let action = ACTION[s.kind] || 'intro';
  if (s.kind === 'prep' && has(s, /обезжир/i)) action = 'degrease';
  const torque = (s.text || []).join(' ').match(/(\d+(?:,\d+)?)\s*Н·м/)?.[1]?.replace(',', '.');
  return {
    id: s.id, op: s.op, title: s.title, action, kind: s.kind,
    parts: [...(s.parts || [])], joints: [...(s.joints || [])], fasteners: [...(s.fasteners || [])],
    explain: [...(s.text || [])], warnSrc: [...(s.warn || [])], check: s.check || null, timer: s.timer || null,
    critical: !!s.critical, torque: torque ? Number(torque) : null, place: 'jig', step: s.id,
  };
}

/** Предварительная наклейка плёнки на боковину на столе подготовки (3 урока). */
function filmPrep(panel, side) {
  const film = FILM_OF.get(panel);
  const name = side === 'L' ? 'левая' : 'правая';
  const base = { op: '030', parts: [], joints: [], fasteners: [], place: 'table', panel, film, check: null, timer: null, critical: false };
  return [
    { ...base, id: `030.Т${side}1`, title: `Боковина ${name} на столе подготовки: обезжирить наружную сторону`, action: 'degrease',
      explain: [`Уложить боковину ${side === 'L' ? 'КМ2.110.000' : 'КМ2.120.000'} на стол подготовки наружной стороной вверх, на мягкие прокладки.`, 'Обезжирить всю наружную поверхность нефрасом, затем сухой салфеткой.'] },
    { ...base, id: `030.Т${side}2`, title: 'Нанести клей кистью под плёнку', action: 'brush',
      explain: ['Кистью нанести контактный клей тонким слоем по всей наружной стороне боковины.', 'Особенно тщательно — по кромкам и S-образному контуру.'] },
    { ...base, id: `030.Т${side}3`, title: 'Наклеить плёнку ДП-217 и прикатать валиком', action: 'film', parts: [film],
      explain: ['Совместить плёнку по задней кромке, снимать подложку по 100 мм.', 'Прикатать валиком от середины к краям, припуск 10 мм по контуру оставить — обрезка после сборки (оп. 140).'] },
  ];
}

/** Сценарий уроков. */
export function buildLessons() {
  const out = [];
  for (const s of STEPS) {
    // плёнка — до установки боковины, на столе
    if (s.id === '030.03') out.push(...filmPrep('SIDE-L', 'L'));
    if (s.id === '030.04') out.push(...filmPrep('SIDE-R', 'R'));
    if (['140.01', '140.02', '140.03', '140.04'].includes(s.id)) continue;   // заменены уроками на столе
    const L = fromStep(s);
    if (s.id === '120.03') L.mask = true;
    if (s.id === '140.05') { L.title = 'Завернуть кромки плёнки и обрезать припуск'; L.action = 'inspect'; }
    // герметик отдельным уроком перед установкой
    const sealBefore = { '110.01': ['trim', 'Герметик в паз профиля кромки стола'], '145.01': ['snake', 'Клей-герметик змейкой на столешницу'], '160.03': ['sink', 'Герметик по контуру выреза под раковину'] }[s.id];
    if (sealBefore) {
      out.push({ ...L, id: `${s.id}.Г`, title: sealBefore[1], action: 'seal', seal: sealBefore[0], parts: [], explain: [L.explain[0]] });
      L.explain = L.explain.slice(1).length ? L.explain.slice(1) : L.explain;
    }
    out.push(L);
  }
  // плёнка видна с наклейки на столе: в установке боковины она едет вместе с панелью
  for (const L of out) {
    if (L.action === 'install' && L.parts.some((p) => FILM_OF.has(p))) L.carries = L.parts.map((p) => FILM_OF.get(p)).filter(Boolean);
    Object.assign(L, adviceFor(L));
    L.labels = labelsFor(L);
  }
  return out;
}

/** Что подписать у деталей урока: до 6 подписей; однотипный крепёж — одной подписью «×N». */
export function labelsFor(L) {
  const ids = [...L.parts, ...(L.action === 'fasten' ? L.fasteners : [])];
  if (L.place === 'table') return [{ id: L.panel, text: partLabel(L.panel) }, ...(L.film && L.action === 'film' ? [{ id: L.film, text: partLabel(L.film) }] : [])];
  const groups = new Map();
  for (const id of ids) {
    const f = S.featureById.get(id); if (!f) continue;
    const k = `${f.designation}|${f.name}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(id);
  }
  return [...groups.values()].slice(0, 6).map((g) => ({ id: g[0], ids: g, text: `${partLabel(g[0])}${g.length > 1 ? ` × ${g.length}` : ''}` }));
}

/** Состояние после уроков 0..k−1: установленные детали, клей в пазах, плёнка, окраска. */
export function stateAt(lessons, k) {
  const st = { installed: new Set(), glued: new Set(), sealed: new Set(), film: new Set(), painted: false, filmOnTable: new Set() };
  for (let i = 0; i < Math.min(k, lessons.length); i++) {
    const L = lessons[i];
    if (['install', 'fasten', 'wire'].includes(L.action) || (L.action === 'check' && L.parts.length)) for (const id of [...L.parts, ...L.fasteners]) st.installed.add(id);
    if (L.action === 'glue') for (const j of L.joints) st.glued.add(j);
    if (L.action === 'seal') st.sealed.add(L.seal);
    if (L.action === 'film') { st.film.add(L.film); st.filmOnTable.add(L.panel); }
    if (L.action === 'install') for (const p of L.parts) st.filmOnTable.delete(p);
    if (L.action === 'paint') st.painted = true;
  }
  return st;
}

/** Откуда деталь заходит на место (единичный вектор в СК модуля): так, чтобы не пройти сквозь установленные. */
export function approachDir(id) {
  const f = S.featureById.get(id);
  const PANEL = { BASE: [0, 1, 0], 'SIDE-L': [-1, 0, 0], 'SIDE-R': [1, 0, 0], BACK: [0, 1, 0], DECK: [0, 1, 0], TOP: [0, 1, 0] };
  if (PANEL[id]) return PANEL[id];
  if (!f) return [0, 0, 1];
  if (['sink', 'faucet'].includes(f.kind) || id === 'SHEET-DECK') return [0, 1, 0];
  if (id.startsWith('FT-UP')) return [0, 1, 0];
  return [0, 0, 1];                        // перегородки, полка, уголки, фурнитура, оборудование — спереди по пазам/направляющим
}
