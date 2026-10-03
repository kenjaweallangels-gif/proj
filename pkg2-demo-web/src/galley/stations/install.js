// Участок МЭ-1 «Монтаж жгутов и электрооборудования»: модуль КМ-2 после сборки конструкции стоит не на
// стапеле, а на транспортном ложементе с колёсами — со свободным доступом со всех сторон. Рядом: подмости,
// тележка с инструментом (мегаомметр, мультиметр, кримпер, динамометрическая отвёртка, принтер бирок),
// стойка с готовыми жгутами с участка ЭМ-1, барабан кабеля, наземный источник питания 115 В 400 Гц.
// Переходы: хомуты → основной жгут → отводы → печи, кофеварка, кипятильник → щиток и светильники →
// стыковка и контровка → металлизация → изоляция 500 В → проверка под напряжением (светильники, дисплеи).
import * as THREE from 'three';
import { buildGalley } from '../galley_build.js';
import { STEPS, stateFrom } from '../process.js';
import * as S from '../spec.js';
import { M, Station, box, cyl, ease, floorZone, growTube, hangingSign, infoStand, at, rod, safetySign, sign, tube } from './kit.js';

const HARN = S.HARNESS.filter((h) => h.kind === 'harness').map((h) => h.id);
const CLAMPS = S.CLAMPS.map((c) => c.id);
const EQUIP = ['OVEN-1', 'OVEN-2', 'BEV-1', 'BOIL-1', 'RET-1'];
const PANEL_EL = ['CB-1', 'LIGHT-1', 'LIGHT-2'];
const NOT_YET = new Set([...HARN, ...CLAMPS, ...EQUIP, ...PANEL_EL, ...S.DOORS.map((d) => d.id), ...S.HINGES.map((h) => h.id), ...S.LATCHES.map((l) => l.id)]);

export function installStation() {
  const g = buildGalley();
  const full = stateFrom(STEPS.length, new Set());
  const base = new Set([...full.installed].filter((id) => !NOT_YET.has(id)));
  const p0 = new Map();
  const st = new Station({
    id: 'me1', short: 'Участок МЭ-1 · монтаж электрооборудования', name: 'Участок МЭ-1 — монтаж жгутов и электрооборудования модуля без стапеля', product: 'модуль КМ-2 № 018',
    center: [15.6, -4.6], yaw: -Math.PI / 2,
    build(st) {
      const R = st.root;
      st.galley = g;
      st.machines = g.items;                         // голограммы перехода — на детали модуля
      R.add(floorZone(5.6, 5.0));
      R.add(hangingSign(['МОНТАЖ ЭЛЕКТРООБОРУДОВАНИЯ МЭ-1'], 2.4));
      // транспортный ложемент на колёсах
      const cr = new THREE.Group(); R.add(cr);
      const fr = M.machineBlue();
      cr.add(box(1.9, 0.08, 1.0, fr, 0, 0.22, 0, 0.006));
      for (const x of [-0.85, 0.85]) for (const z of [-0.42, 0.42]) {
        cr.add(box(0.08, 0.16, 0.08, fr, x, 0.12, z, 0.004));
        const w = cyl(0.06, 0.04, M.rubber(), x, 0.06, z, 20); w.rotation.x = Math.PI / 2; cr.add(w);
        cr.add(box(0.07, 0.03, 0.07, M.steel(), x, 0.125, z, 0.003));
      }
      cr.add(box(1.7, 0.02, 0.86, M.rubber(), 0, 0.27, 0, 0.004));
      const tow = rod([-0.95, 0.22, 0], [-1.35, 0.4, 0], 0.02, M.steel()); cr.add(tow);
      // модуль на ложементе: лицевой стороной к сборщику
      g.root.position.set(0, 0.28, -S.G.D / 2000);
      R.add(g.root);
      for (const o of g.items.values()) p0.set(o, o.position.clone());
      // подмости
      const pl = new THREE.Group(); pl.position.set(1.45, 0, 1.1); R.add(pl);
      for (let k = 0; k < 3; k++) pl.add(box(0.6, 0.03, 0.25, M.steelTop(), 0, 0.22 + k * 0.22, -k * 0.22, 0.004));
      for (const x of [-0.29, 0.29]) pl.add(rod([x, 0, 0.12], [x, 0.7, -0.5], 0.018, M.yellow()), rod([x, 0.7, -0.5], [x, 1.5, -0.5], 0.015, M.yellow()));
      // тележка с инструментом и приборами
      const tc = new THREE.Group(); tc.position.set(-1.9, 0, 1.2); tc.rotation.y = 0.4; R.add(tc);
      tc.add(box(0.7, 0.03, 0.45, M.red(), 0, 0.85, 0, 0.006), box(0.7, 0.03, 0.45, M.red(), 0, 0.45, 0, 0.006));
      for (const x of [-0.33, 0.33]) for (const z of [-0.2, 0.2]) { tc.add(box(0.025, 0.85, 0.025, M.red(), x, 0.43, z, 0.003)); const w = cyl(0.04, 0.03, M.rubber(), x, 0.04, z, 16); w.rotation.x = Math.PI / 2; tc.add(w); }
      tc.add(box(0.22, 0.12, 0.17, M.plastic('#e3b41c', 0.5), -0.18, 0.93, 0, 0.012));
      const meg = sign(['МЕГАОММЕТР 500 В'], 0.18, 0.04, { bg: '#e3b41c', size: 58, border: null }); meg.position.set(-0.18, 0.95, 0.087); tc.add(meg);
      tc.add(box(0.08, 0.03, 0.15, M.plastic('#e3b41c', 0.5), 0.05, 0.88, 0.05, 0.008), box(0.05, 0.004, 0.04, M.emit('#9ad6a8', 0.8), 0.05, 0.897, 0.02, 0.001));
      tc.add(rod([0.15, 0.88, -0.1], [0.3, 0.88, -0.02], 0.012, M.plastic('#2f6fb0')), rod([0.3, 0.88, -0.02], [0.34, 0.88, 0.0], 0.003, M.steel()));
      tc.add(box(0.12, 0.06, 0.1, M.plastic('#f0f0f0', 0.4), 0.22, 0.9, 0.12, 0.01));
      for (let k = 0; k < 6; k++) tc.add(box(0.06, 0.04, 0.05, M.plastic(['#2f6fb0', '#e3b41c', '#c43a2a'][k % 3]), -0.25 + k * 0.1, 0.49, 0.0, 0.003));
      // стойка с готовыми жгутами (с участка ЭМ-1)
      const hk = new THREE.Group(); hk.position.set(-2.1, 0, -1.4); R.add(hk);
      hk.add(rod([0, 0, 0], [0, 1.8, 0], 0.025, M.frameGrey()), box(0.5, 0.04, 0.5, M.frameGrey(), 0, 0.02, 0, 0.006));
      for (const a of [0, 2.1, 4.2]) hk.add(rod([0, 1.6, 0], [Math.cos(a) * 0.35, 1.7, Math.sin(a) * 0.35], 0.01, M.steel()));
      const supply = new THREE.Group();
      for (const [a, c] of [[0, '#3d3f42'], [2.1, '#3d3f42'], [4.2, '#4a4d50']]) for (let k = 0; k < 4; k++) {
        const t = new THREE.Mesh(new THREE.TorusGeometry(0.15 - k * 0.01, 0.011, 8, 36), M.plastic(c, 0.6)); t.position.set(Math.cos(a) * 0.3, 1.45, Math.sin(a) * 0.3); t.rotation.y = -a; supply.add(t);
      }
      hk.add(st.add('ME-SUPPLY', supply));
      // барабан кабеля
      const drum = new THREE.Group(); drum.position.set(2.2, 0, -1.6); R.add(drum);
      for (const s of [-1, 1]) { const d = cyl(0.32, 0.03, M.wood(), s * 0.2, 0.34, 0, 32); d.rotation.z = Math.PI / 2; drum.add(d); }
      const body = cyl(0.22, 0.38, M.plastic('#1d1d1d', 0.6), 0, 0.34, 0, 32); body.rotation.z = Math.PI / 2; drum.add(body);
      for (const s of [-1, 1]) drum.add(rod([s * 0.25, 0, -0.2], [s * 0.25, 0.36, 0], 0.015, M.frameGrey()), rod([s * 0.25, 0, 0.2], [s * 0.25, 0.36, 0], 0.015, M.frameGrey()));
      // наземный источник питания 115 В 400 Гц
      const gpu = new THREE.Group(); gpu.position.set(2.3, 0, 1.4); gpu.rotation.y = -0.5; R.add(gpu);
      gpu.add(box(0.7, 0.75, 0.5, M.machineGreen(), 0, 0.48, 0, 0.012));
      for (const x of [-0.28, 0.28]) for (const z of [-0.18, 0.18]) { const w = cyl(0.06, 0.04, M.rubber(), x, 0.06, z, 16); w.rotation.x = Math.PI / 2; gpu.add(w); }
      gpu.add(box(0.3, 0.16, 0.01, M.plastic('#2b2f35'), 0, 0.68, 0.255, 0.004), box(0.12, 0.05, 0.004, M.emit('#ff6a3a', 1.2), -0.06, 0.7, 0.262, 0.001));
      const gs = sign(['Источник питания 115 В 400 Гц', 'наземный, 3 фазы, 30 кВ·А'], 0.46, 0.09, { bg: '#ffffff', size: 50 }); gs.position.set(0, 0.47, 0.256); gpu.add(gs);
      const gd = safetySign('danger', 'Опасно:\nэлектрическое напряжение', 0.2); gd.position.set(0.24, 0.72, 0.256); gpu.add(gd);
      R.add(at(infoStand({ code: 'МЭ-1', title: 'Монтаж жгутов и электрооборудования модулей (без стапеля)', color: '#8a4a12',
        lines: ['Хомуты, жгуты, печи, кофеварки, щитки, светильники; металлизация, изоляция, проверка 115 В 400 Гц.', 'Модуль — на ложементе, доступ со всех сторон.', 'Ответственный: мастер Сидоров И. П.', 'Допуск по электробезопасности — III группа.'],
        ppeList: [['glasses', 'Очки'], ['gloves', 'Перчатки'], ['shoes', 'Обувь']] }), -2.6, 0, -0.2, 0.9));
      // перемычки металлизации (в СК модуля, мм) и измерительные провода, кабель питания, знак
      const bonds = new THREE.Group();
      for (const id of ['OVEN-1', 'OVEN-2', 'BEV-1', 'BOIL-1', 'CB-1']) {
        const f = S.featureById.get(id); if (!f?.pos) continue;
        const a = [f.pos[0] + f.size[0] / 2 - 20, f.pos[1] + 30, f.pos[2] + 40], b = [a[0] + 60, a[1] - 40, a[2] - 10];
        bonds.add(tube([a, [(a[0] + b[0]) / 2, a[1] - 30, a[2]], b], 4, M.wire('#b9a46a'), 16, 6));
      }
      g.root.add(st.add('ME-BOND', bonds, { from: [0, 200, 200] }));
      const cb = S.featureById.get('CB-1');
      const leads = new THREE.Group();
      const tgt = new THREE.Vector3(cb.pos[0], cb.pos[1] + cb.size[1] / 2, cb.pos[2] + cb.size[2]).multiplyScalar(0.001).add(g.root.position);
      leads.add(tube([[-1.75, 0.95, 1.2], [-1.2, 0.5, 1.0], [tgt.x - 0.1, tgt.y - 0.3, tgt.z + 0.3], [tgt.x, tgt.y, tgt.z + 0.02]], 0.003, M.wire('#d12e2e'), 60));
      leads.add(tube([[-1.72, 0.95, 1.25], [-1.1, 0.45, 1.05], [tgt.x - 0.05, tgt.y - 0.32, tgt.z + 0.32], [tgt.x + 0.04, tgt.y, tgt.z + 0.02]], 0.003, M.wire('#1d1d1d'), 60));
      R.add(st.add('ME-TEST', leads, { anim: (f) => leads.children.forEach((w) => growTube(w, f)) }));
      const pwr = tube([[2.1, 0.55, 1.35], [1.6, 0.05, 1.1], [0.6, 0.02, 0.7], [-0.1, 0.4, 0.2], [-0.2, 2.2, -0.2]], 0.012, M.plastic('#1d1d1d', 0.5), 80, 8);
      R.add(st.add('ME-PWR', pwr, { anim: (f) => growTube(pwr, f) }));
      const warn = new THREE.Group(); warn.position.set(0.9, 0, 1.6); R.add(warn);
      warn.add(rod([0, 0, 0], [0, 1.3, 0], 0.015, M.steel()), box(0.3, 0.03, 0.3, M.frameGrey(), 0, 0.015, 0, 0.004));
      const ws = sign(['⚡ ПОД НАПРЯЖЕНИЕМ', '115 В 400 Гц · проверка'], 0.42, 0.2, { bg: '#ffd400', size: 58 }); ws.position.y = 1.35; warn.add(ws);
      st.add('ME-WARN', warn, { from: [0, 0.8, 0] });
    },
    steps: [
      { id: '010.01', op: '010', title: 'Подготовка модуля на ложементе', kind: 'prep', tools: ['ложемент', 'подмости'],
        text: ['Модуль КМ-2 № 018 на ложементе, колёса на тормозах, подмости установлены.', 'Модуль обесточен, комплект жгутов ЖГ-1…ЖГ-5 с бирками ОТК.'] },
      { id: '020.01', op: '020', title: 'Хомуты крепления жгутов', kind: 'fasten', parts: CLAMPS, tools: ['отвёртка динамометрическая 1,2 Н·м'],
        text: ['Установить 18 хомутов P-образных винтами во вставки, момент 1,2 Н·м.', 'Положение — по КД КМ2.800.000 МЧ, лист 1.'] },
      { id: '030.01', op: '030', title: 'Прокладка основного жгута (ввод сверху)', kind: 'wire', parts: ['HN-MAIN'], tools: ['жгут ЖГ-1'],
        text: ['Завести жгут через верхний ввод, уложить в хомуты основной трассы.', 'Радиус изгиба ≥ 6 диаметров, без натяга, вдали от острых кромок.'] },
      { id: '040.01', op: '040', title: 'Отводы к щитку, печам, кофеварке, светильнику', kind: 'wire', parts: ['HN-CB', 'HN-OV', 'HN-BEV', 'HN-LT'], remove: ['ME-SUPPLY'], tools: ['жгуты ЖГ-2…ЖГ-5'],
        text: ['Проложить отводы по хомутам, зафиксировать.', 'Свободные концы соединителей — в заглушках до установки оборудования.'] },
      { id: '050.01', op: '050', title: 'Установка печей, кофеварки и кипятильника', kind: 'install', parts: ['OVEN-1', 'OVEN-2', 'BEV-1', 'BOIL-1', 'RET-1'], tools: ['подъёмник оборудования', 'ключи'],
        text: ['Вставить печи в отсеки до фиксаторов, кофеварку и кипятильник — на направляющие.', 'Установить планку-ограничитель отсека оборудования.'] },
      { id: '060.01', op: '060', title: 'Щиток автоматов и светильники', kind: 'install', parts: ['CB-1', 'LIGHT-1', 'LIGHT-2'], tools: ['отвёртка', 'стяжки'],
        text: ['Щиток автоматов — на кронштейны, светильник рабочей зоны — под полку, подсветка прохода — на кромку.'] },
      { id: '070.01', op: '070', title: 'Стыковка соединителей и контровка', kind: 'fasten', tools: ['контровочная проволока 0,5', 'плоскогубцы'], focus: ['ME-BOND'],
        text: ['Состыковать соединители до щелчка, проверить индикатор фиксации.', 'Законтрить накидные гайки проволокой 0,5 мм.'] },
      { id: '080.01', op: '080', title: 'Металлизация: перемычки к оборудованию', kind: 'fasten', parts: ['ME-BOND'], tools: ['перемычки ПМЛ', 'микроомметр'],
        text: ['Установить перемычки металлизации на печи, кофеварку, кипятильник и щиток.', 'Переходное сопротивление ≤ 2,5 мОм.'], check: { name: 'Сопротивление металлизации', nominal: 1.2, tol: 1.3, unit: 'мОм' } },
      { id: '090.01', op: '090', title: 'Сопротивление изоляции 500 В', kind: 'check', parts: ['ME-TEST'], tools: ['мегаомметр 500 В'], photo: true,
        text: ['Все автоматы выключены, оборудование отключено от сети.', 'Измерить изоляцию цепей на корпус: ≥ 20 МОм.'], check: { name: 'Сопротивление изоляции', nominal: 200, tol: 180, unit: 'МОм' } },
      { id: '100.01', op: '100', title: 'Проверка под напряжением 115 В 400 Гц', kind: 'check', parts: ['ME-PWR', 'ME-WARN'], remove: ['ME-TEST'], tools: ['источник 115 В 400 Гц', 'знак «Под напряжением»'],
        text: ['Выставить знак, подключить источник, включать автоматы по одному.', 'Проверить: светильники, дисплеи печей, кофеварка — нагрев, кипятильник — индикатор.', 'Отключить, снять кабель, оформить протокол.'] },
    ],
  });
  st.custom = (st, i, f) => {
    const inst = new Set(base);
    let fly = [];
    st.steps.forEach((s, k) => { for (const id of s.parts || []) if (g.items.has(id) && (k < i || (k === i && f > 0))) { inst.add(id); if (k === i) fly.push(id); } });
    const N = st.steps.length;
    const powered = i >= N || (i === N - 1 && f > 0.4);
    const state = { ...full, installed: inst };
    for (const o of g.items.values()) o.position.copy(p0.get(o));
    g.setState(state, { powered });
    for (const c of CLAMPS) { const o = g.items.get(c); if (o) o.visible = inst.has(c); }
    const e = ease(f / 0.8);
    for (const id of fly) {
      const o = g.items.get(id); if (!o) continue;
      o.visible = true;
      const kind = S.featureById.get(id)?.kind;
      if (kind === 'harness') o.traverse((m) => { if (m.isMesh && m.geometry.index) m.geometry.setDrawRange(0, Math.floor((m.geometry.index.count * Math.min(1, f / 0.85)) / 3) * 3); });
      else o.position.copy(p0.get(o)).add(new THREE.Vector3(0, 380, 420).multiplyScalar(1 - e));
    }
    // жгуты, проложенные ранее, — целиком
    for (const id of HARN) if (!fly.includes(id)) g.items.get(id)?.traverse((m) => { if (m.isMesh && m.geometry.index) m.geometry.setDrawRange(0, Infinity); });
  };
  st.apply(0, 0);
  return st;
}
