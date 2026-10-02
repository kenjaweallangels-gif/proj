// Модуль кухонный КМ-2 (условный, по мотивам кормовых кухонь узкофюзеляжных ВС): чистые данные, без three.js.
// Единицы — мм. СК модуля: X — ширина (0 по центру, + вправо при взгляде спереди), Y — вверх от пола,
// Z — от задней стенки (0) вперёд к проходу. Ось Y вверх, как во всём проекте.
//
// Конструкция (по открытым источникам о монументах ВС): стенки, полки и перегородки — сотовые панели
// (стеклопластик/фенол + арамидные соты, 13–25 мм), соединяются «шип-паз» на клею, внутренние углы усилены
// алюминиевыми уголками на винтах во вклеенные (залитые компаундом) вставки; передние кромки закрыты профилями,
// снаружи — декоративная плёнка, внутри — окраска. Нижний ярус — отсеки под тележки полного размера
// (≈302 × 810 × 1031 мм), над рабочим столом — оборудование (печи, кофеварка, кипятильник), сверху — отсеки
// под стандартные контейнеры. Крепление к ВС: узлы к полу (рельсы) и верхние кронштейны под тяги.
// Все обозначения, моменты и режимы — условные; в работе берутся из КД и ТП на изделие.

export const PRODUCT = {
  designation: 'КМ2.000.000',
  name: 'Модуль кухонный КМ-2',
  serial: '017',
  note: 'Условный образец для демонстрации AR-сборки',
};

export const G = {
  W: 1700, D: 860, DU: 600, H: 2050,
  tSide: 25, tBack: 13, tBase: 25, tDeck: 25, tDiv: 13, tShelf: 19, tTop: 19,
  deckTop: 1105, shelfTop: 1519, IN: 825,               // IN — полуширина внутреннего пространства
};

export const TROLLEY = { w: 302, h: 1031, d: 810 };       // тележка полного размера
export const STD_UNIT = { w: 280, h: 200, d: 400 };       // стандартный контейнер (условно)

// ---------- геометрия плоских панелей ----------
// plane: 'XY' (задняя стенка), 'ZY' (боковины, перегородки), 'XZ' (основание, стол, полка, крышка).
// Локальные (u, v) — координаты контура, w ∈ [0, t] — толщина. Отображение выбрано с det = +1 (без зеркала).

/** Локальная точка панели (u, v, w) → мм в СК модуля. */
export function toModel(plane, offset, u, v, w) {
  if (plane === 'XY') return [u, v, offset + w];
  if (plane === 'ZY') return [offset - w, v, u];
  return [u, offset - w, v];                      // XZ
}

/** Ось толщины панели и её диапазон в СК модуля. axis: 0 = X, 1 = Y, 2 = Z. */
export function slab(p) {
  if (p.plane === 'XY') return { axis: 2, lo: p.offset, hi: p.offset + p.t };
  if (p.plane === 'ZY') return { axis: 0, lo: p.offset - p.t, hi: p.offset };
  return { axis: 1, lo: p.offset - p.t, hi: p.offset };
}

/** Габарит панели (номинальный прямоугольник без шипов) в СК модуля: {min, max}. */
export function panelBox(p) {
  const s = slab(p);
  const min = [0, 0, 0], max = [0, 0, 0];
  min[s.axis] = s.lo; max[s.axis] = s.hi;
  const [ua, va] = p.plane === 'XY' ? [0, 1] : p.plane === 'ZY' ? [2, 1] : [0, 2];
  min[ua] = p.rect.u0; max[ua] = p.rect.u1;
  min[va] = p.rect.v0; max[va] = p.rect.v1;
  return { min, max };
}

const EDGE_AXIS = { v0: 'u', v1: 'u', u0: 'v', u1: 'v' };
const EDGE_OUT = { v0: [0, -1], u1: [1, 0], v1: [0, 1], u0: [-1, 0] };

/** Шипы, равномерно по отрезку [lo, hi]: центры, длина, вылет. */
export function tabsAlong(lo, hi, n, len, depth) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ at: Math.round(lo + ((i + 0.5) * (hi - lo)) / n), len, depth });
  return out;
}

function sampleBulge(P, Q, out, amount, n = 20) {
  const pts = [];
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const k = amount * Math.sin(Math.PI * t);
    pts.push([P[0] + (Q[0] - P[0]) * t + out[0] * k, P[1] + (Q[1] - P[1]) * t + out[1] * k]);
  }
  return pts;
}

/**
 * Контур прямоугольной панели с шипами и криволинейными кромками (замкнутая ломаная [[u, v], …], против часовой).
 * edges[e] = { tabs: [{at, len, depth}], bulge: мм } для e ∈ v0 (низ), u1 (право), v1 (верх), u0 (лево);
 * corners = { A, B, C, D } — радиусы скругления углов (A = u0v0, B = u1v0, C = u1v1, D = u0v1).
 */
export function rectOutline(rect, edges = {}, corners = {}) {
  const { u0, u1, v0, v1 } = rect;
  const C = { A: [u0, v0], B: [u1, v0], C: [u1, v1], D: [u0, v1] };
  const order = [['A', 'v0', 'B'], ['B', 'u1', 'C'], ['C', 'v1', 'D'], ['D', 'u0', 'A']];
  const pts = [];
  const r = (k) => corners[k] || 0;
  for (const [ka, e, kb] of order) {
    const P = C[ka], Q = C[kb];
    const dir = [Math.sign(Q[0] - P[0]), Math.sign(Q[1] - P[1])];
    const out = EDGE_OUT[e];
    const start = [P[0] + dir[0] * r(ka), P[1] + dir[1] * r(ka)];
    const end = [Q[0] - dir[0] * r(kb), Q[1] - dir[1] * r(kb)];
    // скругление угла ka: дуга от конца предыдущего ребра к началу этого
    if (r(ka) > 0) {
      const prevOut = EDGE_OUT[order[(order.findIndex((o) => o[0] === ka) + 3) % 4][1]];
      const c = [P[0] - prevOut[0] * r(ka) - out[0] * r(ka), P[1] - prevOut[1] * r(ka) - out[1] * r(ka)];
      const a0 = Math.atan2(prevOut[1], prevOut[0]);
      let a1 = Math.atan2(out[1], out[0]);
      if (a1 < a0) a1 += Math.PI * 2;
      for (let i = 0; i <= 8; i++) {
        const a = a0 + ((a1 - a0) * i) / 8;
        pts.push([c[0] + Math.cos(a) * r(ka), c[1] + Math.sin(a) * r(ka)]);
      }
    } else pts.push(start);
    const ed = edges[e] || {};
    if (ed.bulge) {
      pts.push(...sampleBulge(start, end, out, ed.bulge));
    } else if (ed.tabs?.length) {
      const along = EDGE_AXIS[e] === 'u' ? 0 : 1;
      const s = dir[along];
      const tabs = [...ed.tabs].sort((a, b) => (a.at - b.at) * s);
      for (const t of tabs) {
        const a = t.at - (s * t.len) / 2, b = t.at + (s * t.len) / 2;
        const base = (x) => (along === 0 ? [x, P[1]] : [P[0], x]);
        const outp = (x) => { const q = base(x); return [q[0] + out[0] * t.depth, q[1] + out[1] * t.depth]; };
        pts.push(base(a), outp(a), outp(b), base(b));
      }
    }
  }
  return pts;
}

function bezier(p0, p1, p2, p3, n) {
  const out = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n, a = 1 - t;
    out.push([
      a * a * a * p0[0] + 3 * a * a * t * p1[0] + 3 * a * t * t * p2[0] + t * t * t * p3[0],
      a * a * a * p0[1] + 3 * a * a * t * p1[1] + 3 * a * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return out;
}

/** Профиль боковины (u = Z, v = Y): внизу глубина D, над столом S-образный переход к верхней глубине DU. */
export function sideProfile() {
  const { D, DU, H, deckTop } = G;
  const pts = [[0, 0], [D, 0], [D, deckTop]];
  pts.push(...bezier([D, deckTop], [D, deckTop + 130], [DU, deckTop + 90], [DU, deckTop + 230], 18));
  pts.push([DU, H - 60]);
  pts.push(...bezier([DU, H - 60], [DU, H - 25], [DU - 25, H], [DU - 60, H], 8));
  pts.push([0, H]);
  return pts;
}

/** Передняя кромка боковины (для окантовочного профиля): от низа до верха. */
export function sideFrontEdge() {
  return sideProfile().slice(1, -1);
}

// ---------- панели ----------
const { IN } = G;
const P = (id, designation, name, plane, offset, t, rect, extra = {}) => ({
  id, kind: 'panel', designation, name, plane, offset, t, rect, edges: {}, corners: {}, ...extra,
});

export const PANELS = [
  P('SIDE-L', 'КМ2.110.000', 'Панель боковая левая', 'ZY', -IN, G.tSide, { u0: 0, u1: G.D, v0: 0, v1: G.H },
    { profile: 'side', core: 'Соты арамидные 3,2-48, обшивки стеклопластик', outerFace: 'lo' }),
  P('SIDE-R', 'КМ2.120.000', 'Панель боковая правая', 'ZY', IN + G.tSide, G.tSide, { u0: 0, u1: G.D, v0: 0, v1: G.H },
    { profile: 'side', core: 'Соты арамидные 3,2-48, обшивки стеклопластик', outerFace: 'hi' }),
  P('BACK', 'КМ2.130.000', 'Панель задняя', 'XY', 0, G.tBack, { u0: -IN, u1: IN, v0: 0, v1: G.H },
    { core: 'Соты арамидные 3,2-29, обшивки стеклопластик' }),
  P('BASE', 'КМ2.140.000', 'Основание', 'XZ', G.tBase, G.tBase, { u0: -IN, u1: IN, v0: G.tBack, v1: G.D },
    { core: 'Соты арамидные 3,2-64 (усиленные)' }),
  P('DECK', 'КМ2.150.000', 'Стол рабочий', 'XZ', G.deckTop, G.tDeck, { u0: -IN, u1: IN, v0: G.tBack, v1: G.D - 6 },
    { core: 'Соты арамидные 3,2-64, обшивка верхняя — ламинат', front: 'v1', bulgeFront: 22, cornersFront: 40 }),
  P('DIV-W', 'КМ2.161.000', 'Перегородка отсека отходов', 'ZY', -494, G.tDiv, { u0: G.tBack, u1: 845, v0: G.tBase, v1: G.deckTop - G.tDeck }),
  P('DIV-T1', 'КМ2.160.000', 'Перегородка тележечного отсека', 'ZY', -161, G.tDiv, { u0: G.tBack, u1: 845, v0: G.tBase, v1: G.deckTop - G.tDeck }),
  P('DIV-T2', 'КМ2.160.000-01', 'Перегородка тележечного отсека', 'ZY', 172, G.tDiv, { u0: G.tBack, u1: 845, v0: G.tBase, v1: G.deckTop - G.tDeck }),
  P('DIV-T3', 'КМ2.160.000-02', 'Перегородка тележечного отсека', 'ZY', 505, G.tDiv, { u0: G.tBack, u1: 845, v0: G.tBase, v1: G.deckTop - G.tDeck }),
  P('DIV-E1', 'КМ2.170.000', 'Перегородка отсека оборудования', 'ZY', -167, G.tDiv, { u0: G.tBack, u1: 585, v0: G.deckTop, v1: G.shelfTop - G.tShelf },
    { cornersFront: 30 }),
  P('DIV-E2', 'КМ2.170.000-01', 'Перегородка отсека оборудования', 'ZY', 313, G.tDiv, { u0: G.tBack, u1: 585, v0: G.deckTop, v1: G.shelfTop - G.tShelf },
    { cornersFront: 30 }),
  P('SHELF', 'КМ2.180.000', 'Полка средняя', 'XZ', G.shelfTop, G.tShelf, { u0: -IN, u1: IN, v0: G.tBack, v1: 590 },
    { front: 'v1', bulgeFront: 15, cornersFront: 30 }),
  P('DIV-U1', 'КМ2.190.000', 'Перегородка верхнего отсека', 'ZY', -405.5, G.tDiv, { u0: G.tBack, u1: 585, v0: G.shelfTop, v1: G.H - G.tTop },
    { cornersFront: 25 }),
  P('DIV-U2', 'КМ2.190.000-01', 'Перегородка верхнего отсека', 'ZY', 6.5, G.tDiv, { u0: G.tBack, u1: 585, v0: G.shelfTop, v1: G.H - G.tTop },
    { cornersFront: 25 }),
  P('DIV-U3', 'КМ2.190.000-02', 'Перегородка верхнего отсека', 'ZY', 418.5, G.tDiv, { u0: G.tBack, u1: 585, v0: G.shelfTop, v1: G.H - G.tTop },
    { cornersFront: 25 }),
  P('TOP', 'КМ2.200.000', 'Крышка верхняя', 'XZ', G.H, G.tTop, { u0: -IN, u1: IN, v0: G.tBack, v1: 590 },
    { front: 'v1', bulgeFront: 12, cornersFront: 60 }),
];
export const panelById = new Map(PANELS.map((p) => [p.id, p]));

// ---------- соединения шип-паз ----------
// a — панель с шипами, edge — её кромка, b — панель с пазами. glue — клей в паз, brackets — уголки во внутреннем углу.
const J = (id, a, edge, b, tabs, brackets = null) => ({ id, a, edge, b, tabs, brackets });
export const JOINTS = [
  J('J-BACK-L', 'BACK', 'u0', 'SIDE-L', 5), J('J-BACK-R', 'BACK', 'u1', 'SIDE-R', 5),
  J('J-BASE-L', 'BASE', 'u0', 'SIDE-L', 3, { n: 2, side: 'hi' }), J('J-BASE-R', 'BASE', 'u1', 'SIDE-R', 3, { n: 2, side: 'hi' }),
  J('J-BASE-B', 'BASE', 'v0', 'BACK', 4, { n: 3, side: 'hi' }),
  J('J-DECK-L', 'DECK', 'u0', 'SIDE-L', 3, { n: 2, side: 'lo' }), J('J-DECK-R', 'DECK', 'u1', 'SIDE-R', 3, { n: 2, side: 'lo' }),
  J('J-DECK-B', 'DECK', 'v0', 'BACK', 5, { n: 3, side: 'lo' }),
  ...['DIV-W', 'DIV-T1', 'DIV-T2', 'DIV-T3'].flatMap((d) => [
    J(`J-${d}-BS`, d, 'v0', 'BASE', 2, { n: 1, side: 'hi' }),
    J(`J-${d}-DK`, d, 'v1', 'DECK', 2, { n: 1, side: 'hi' }),
    J(`J-${d}-BK`, d, 'u0', 'BACK', 3),
  ]),
  ...['DIV-E1', 'DIV-E2'].flatMap((d) => [
    J(`J-${d}-DK`, d, 'v0', 'DECK', 2, { n: 1, side: 'hi' }),
    J(`J-${d}-SH`, d, 'v1', 'SHELF', 2, { n: 1, side: 'hi' }),
    J(`J-${d}-BK`, d, 'u0', 'BACK', 2),
  ]),
  J('J-SHELF-L', 'SHELF', 'u0', 'SIDE-L', 2, { n: 2, side: 'lo' }), J('J-SHELF-R', 'SHELF', 'u1', 'SIDE-R', 2, { n: 2, side: 'lo' }),
  J('J-SHELF-B', 'SHELF', 'v0', 'BACK', 4, { n: 2, side: 'lo' }),
  ...['DIV-U1', 'DIV-U2', 'DIV-U3'].flatMap((d) => [
    J(`J-${d}-SH`, d, 'v0', 'SHELF', 2, { n: 1, side: 'hi' }),
    J(`J-${d}-TP`, d, 'v1', 'TOP', 2, { n: 1, side: 'hi' }),
    J(`J-${d}-BK`, d, 'u0', 'BACK', 2),
  ]),
  J('J-TOP-L', 'TOP', 'u0', 'SIDE-L', 2, { n: 2, side: 'lo' }), J('J-TOP-R', 'TOP', 'u1', 'SIDE-R', 2, { n: 2, side: 'lo' }),
  J('J-TOP-B', 'TOP', 'v0', 'BACK', 4, { n: 2, side: 'lo' }),
];
export const jointById = new Map(JOINTS.map((j) => [j.id, j]));

const TAB_LEN = 60;
const edgeRange = (p, e) => (EDGE_AXIS[e] === 'u' ? [p.rect.u0, p.rect.u1] : [p.rect.v0, p.rect.v1]);

// шипы — в кромки панелей a; контуры строятся один раз
for (const j of JOINTS) {
  const a = panelById.get(j.a), b = panelById.get(j.b);
  const [lo, hi] = edgeRange(a, j.edge);
  j.depth = Math.round(b.t * 0.45);
  j.tabList = tabsAlong(lo + 40, hi - 40, j.tabs, TAB_LEN, j.depth);
  (a.edges[j.edge] ||= { tabs: [] }).tabs.push(...j.tabList);
}
for (const p of PANELS) {
  if (p.front && p.bulgeFront) (p.edges[p.front] ||= {}).bulge = p.bulgeFront;
  if (p.cornersFront) {
    if (p.plane === 'XZ') p.corners = { C: p.cornersFront, D: p.cornersFront };
    else p.corners = { C: p.cornersFront };       // перегородки: верхний передний угол
  }
  p.outline = p.profile === 'side' ? sideProfile() : rectOutline(p.rect, p.edges, p.corners);
  p.holes = [];
}

/** Прямоугольник шипа в локальных (u, v) координатах панели a. */
function tabRect(a, edge, tab) {
  const half = tab.len / 2;
  const { u0, u1, v0, v1 } = a.rect;
  if (edge === 'v0') return { u: [tab.at - half, tab.at + half], v: [v0 - tab.depth, v0] };
  if (edge === 'v1') return { u: [tab.at - half, tab.at + half], v: [v1, v1 + tab.depth] };
  if (edge === 'u0') return { u: [u0 - tab.depth, u0], v: [tab.at - half, tab.at + half] };
  return { u: [u1, u1 + tab.depth], v: [tab.at - half, tab.at + half] };
}

function boxOf(p, ur, vr, wr) {
  const pts = [];
  for (const u of ur) for (const v of vr) for (const w of wr) pts.push(toModel(p.plane, p.offset, u, v, w));
  const min = [0, 1, 2].map((i) => Math.min(...pts.map((q) => q[i])));
  const max = [0, 1, 2].map((i) => Math.max(...pts.map((q) => q[i])));
  return { min, max };
}

/** Пазы в панелях b (в СК модуля) — по шипам панелей a. */
export const GROOVES = JOINTS.flatMap((j) => {
  const a = panelById.get(j.a);
  return j.tabList.map((t, i) => ({ id: `${j.id}-G${i + 1}`, joint: j.id, panel: j.b, ...boxOf(a, ...Object.values(tabRect(a, j.edge, t)), [0, a.t]) }));
});

const center = (b) => b.min.map((v, i) => (v + b.max[i]) / 2);

// ---------- уголки, вставки, винты (вычисляются по соединениям) ----------
export const BRACKET = { designation: 'КМ2.300.010', name: 'Уголок 30×30×2, L = 40, Д16Т', leg: 30, t: 2, len: 40 };
export const SCREW = { designation: 'Винт М4×10 (усл. ОСТ 1 31516)', name: 'Винт М4×10 потай', torqueNm: 1.6 };
export const INSERT = { designation: 'Вставка ВЗ-М4 (усл.)', name: 'Вставка закладная М4, заливная' };

export const BRACKETS = [];
export const FASTENERS = [];

for (const j of JOINTS) {
  if (!j.brackets) continue;
  const a = panelById.get(j.a), b = panelById.get(j.b);
  const sa = slab(a), sb = slab(b);
  const ba = panelBox(a), bb = panelBox(b);
  const jointAxis = [0, 1, 2].find((i) => i !== sa.axis && i !== sb.axis);
  const ac = center(ba);
  const sB = ac[sb.axis] > sb.hi ? 1 : -1;
  const bFace = sB > 0 ? sb.hi : sb.lo;
  const sA = j.brackets.side === 'hi' ? 1 : -1;
  const aFace = sA > 0 ? sa.hi : sa.lo;
  const lo = Math.max(ba.min[jointAxis], bb.min[jointAxis]), hi = Math.min(ba.max[jointAxis], bb.max[jointAxis]);
  for (let i = 0; i < j.brackets.n; i++) {
    const pos = lo + ((i + 0.5) * (hi - lo)) / j.brackets.n + 35;
    const corner = [0, 0, 0];
    corner[sa.axis] = aFace; corner[sb.axis] = bFace; corner[jointAxis] = pos;
    const id = `BR-${j.id.slice(2)}-${i + 1}`;
    const br = {
      id, kind: 'bracket', designation: BRACKET.designation, name: BRACKET.name, joint: j.id, corner, jointAxis,
      legA: { axis: sb.axis, sign: sB, face: sa.axis, faceSign: sA },   // полка на панели a: вдоль оси b, от b
      legB: { axis: sa.axis, sign: sA, face: sb.axis, faceSign: sB },   // полка на панели b: вдоль оси a, от a
      panels: [j.a, j.b], screws: [],
    };
    for (const [leg, panel, into] of [[br.legA, j.a, [sa.axis, -sA]], [br.legB, j.b, [sb.axis, -sB]]]) {
      const p = [...corner];
      p[leg.axis] += leg.sign * 18;
      const head = [...p];
      head[leg.face] += leg.faceSign * BRACKET.t;
      const n = FASTENERS.length;
      const ins = { id: `IN-${n + 1}`, kind: 'insert', designation: INSERT.designation, name: INSERT.name, panel, pos: p, into, bracket: id };
      const scr = { id: `SC-${n + 2}`, kind: 'screw', designation: SCREW.designation, name: SCREW.name, panel, pos: head, into, bracket: id, torqueNm: SCREW.torqueNm, insert: ins.id };
      FASTENERS.push(ins, scr);
      br.screws.push(scr.id);
    }
    BRACKETS.push(br);
  }
}

// ---------- узлы крепления к ВС ----------
export const FITTINGS = [
  ...[[-1, 90], [-1, 770], [1, 90], [1, 770]].map(([s, z], i) => ({
    id: `FT-FL-${i + 1}`, kind: 'fitting', designation: 'КМ2.400.010', name: 'Узел крепления к полу (к рельсу)',
    pos: [s * (G.W / 2 - 12), 0, z], size: [44, 38, 90], panel: s < 0 ? 'SIDE-L' : 'SIDE-R', bolts: 3, torqueNm: 9,
  })),
  ...[-1, 1].map((s, i) => ({
    id: `FT-UP-${i + 1}`, kind: 'fitting', designation: 'КМ2.400.020', name: 'Кронштейн верхнего крепления под тягу',
    pos: [s * 600, G.H, 260], size: [70, 45, 110], panel: 'TOP', bolts: 4, torqueNm: 5,
  })),
];

// ---------- кромочные профили и декор ----------
export const TRIMS = [
  { id: 'TR-DECK', kind: 'trim', designation: 'КМ2.310.010', name: 'Профиль кромки стола с бортиком', panel: 'DECK', profile: 'drip' },
  { id: 'TR-SHELF', kind: 'trim', designation: 'КМ2.310.020', name: 'Профиль кромки полки', panel: 'SHELF', profile: 'u' },
  { id: 'TR-TOP', kind: 'trim', designation: 'КМ2.310.020-01', name: 'Профиль кромки крышки', panel: 'TOP', profile: 'u' },
  { id: 'TR-SIDE-L', kind: 'trim', designation: 'КМ2.310.030', name: 'Профиль передней кромки боковины', panel: 'SIDE-L', profile: 'u' },
  { id: 'TR-SIDE-R', kind: 'trim', designation: 'КМ2.310.030-01', name: 'Профиль передней кромки боковины', panel: 'SIDE-R', profile: 'u' },
  ...['DIV-W', 'DIV-T1', 'DIV-T2', 'DIV-T3'].map((d) => ({
    id: `TR-${d}`, kind: 'trim', designation: 'КМ2.310.040', name: 'Накладка защитная (нерж.) кромки перегородки', panel: d, profile: 'kick',
  })),
];

export const DECOR = [
  { id: 'FILM-L', kind: 'film', designation: 'КМ2.000.000 СБ, ТТ п. 6', name: 'Плёнка декоративная наружной стороны боковины Л', panel: 'SIDE-L', code: 'ДП-217 «Гранит светлый» (усл.)' },
  { id: 'FILM-R', kind: 'film', designation: 'КМ2.000.000 СБ, ТТ п. 6', name: 'Плёнка декоративная наружной стороны боковины П', panel: 'SIDE-R', code: 'ДП-217 «Гранит светлый» (усл.)' },
  { id: 'PAINT-INT', kind: 'paint', designation: 'КМ2.000.000 СБ, ТТ п. 5', name: 'Окраска внутренних поверхностей отсеков', code: 'Эмаль ПУ, RAL 9002 (усл.)' },
  ...[1, 2, 3, 4].map((n) => ({ id: `PL-T${n}`, kind: 'placard', designation: 'КМ2.600.010', name: `Табличка «ТЕЛЕЖКА ${n} · MAX 90 кг»`, bay: n })),
  { id: 'PL-W', kind: 'placard', designation: 'КМ2.600.020', name: 'Табличка «ОТХОДЫ»', bay: 0 },
  { id: 'HANDLE-R', kind: 'handle', designation: 'КМ2.610.010', name: 'Поручень', pos: [G.W / 2 + 4, 1250, 700] },
  ...[1, 2, 3, 4].flatMap((n) => [['B', 40, 862], ['T', 1062, 848]].map(([k, y, z]) => ({
    id: `TB-${n}${k}`, kind: 'turnbutton', designation: 'КМ2.620.010', name: `Фиксатор тележки поворотный (${k === 'B' ? 'нижний' : 'верхний'})`, bay: n, y, z,
  }))),
];

// ---------- оборудование ----------
export const EQUIPMENT = [
  { id: 'OVEN-1', kind: 'equipment', designation: 'ИО-01 (вставка, усл.)', name: 'Печь конвекционная', pos: [-663, G.deckTop + 12, 30], size: [300, 360, 540], power: '115 В 400 Гц, 3 кВт' },
  { id: 'OVEN-2', kind: 'equipment', designation: 'ИО-01 (вставка, усл.)', name: 'Печь конвекционная', pos: [-351, G.deckTop + 12, 30], size: [300, 360, 540], power: '115 В 400 Гц, 3 кВт' },
  { id: 'BEV-1', kind: 'equipment', designation: 'ИК-02 (вставка, усл.)', name: 'Кофеварка', pos: [-25, G.deckTop + 12, 30], size: [260, 340, 450], power: '115 В 400 Гц, 1,8 кВт' },
  { id: 'BOIL-1', kind: 'equipment', designation: 'ИВ-03 (вставка, усл.)', name: 'Кипятильник', pos: [213, G.deckTop + 12, 30], size: [150, 300, 380], power: '115 В 400 Гц, 1,2 кВт' },
  { id: 'CB-1', kind: 'equipment', designation: 'КМ2.500.100', name: 'Щиток автоматов защиты', pos: [569, 1395, G.tBack], size: [220, 90, 55], power: '' },
  { id: 'LIGHT-1', kind: 'light', designation: 'КМ2.500.200', name: 'Светильник рабочей зоны (LED, под полкой)', pos: [0, G.shelfTop - G.tShelf - 12, 545], size: [1500, 12, 30], power: '28 В' },
  { id: 'LIGHT-2', kind: 'light', designation: 'КМ2.500.210', name: 'Светильник подсветки прохода (LED, на крышке)', pos: [0, G.H - 8, 608], size: [1200, 12, 10], power: '28 В' },
  { id: 'RET-1', kind: 'retainer', designation: 'КМ2.650.010', name: 'Планка-ограничитель отсека оборудования', pos: [566, 1250, 578], size: [500, 14, 14] },
];

export const INSERTS_LOAD = [
  ...[1, 2, 3, 4].map((n) => ({ id: `TRL-${n}`, kind: 'trolley', name: `Тележка полного размера ${n}`, bay: n })),
  ...[0, 1, 2, 3].flatMap((c) => [0, 1].map((r) => ({ id: `SU-${c + 1}${r + 1}`, kind: 'stdunit', name: 'Контейнер стандартный', comp: c, row: r }))),
];

// ---------- столешница, облицовка, раковина, кран, сифон ----------
export const SINK = { x: -700, z: 735, w: 280, d: 200, depth: 150 };
export const PLUMBING = [
  { id: 'SHEET-DECK', kind: 'sheet', designation: 'КМ2.150.100', name: 'Лист облицовочный столешницы, 12Х18Н10Т δ0,6, с отбортовкой', panel: 'DECK',
    pos: [0, G.deckTop, 440], size: [1650, 0.6, 850] },
  { id: 'SHEET-BS', kind: 'sheet', designation: 'КМ2.130.100', name: 'Лист облицовочный задней стенки (фартук), 12Х18Н10Т δ0,5', panel: 'BACK',
    pos: [0, (G.deckTop + G.shelfTop - G.tShelf) / 2, G.tBack + 0.3], size: [1650, G.shelfTop - G.tShelf - G.deckTop, 0.5] },
  { id: 'SINK-1', kind: 'sink', designation: 'КМ2.710.010', name: 'Раковина штампованная 12Х18Н10Т с бортом и решёткой слива', pos: [SINK.x, G.deckTop, SINK.z],
    size: [SINK.w, SINK.depth, SINK.d] },
  { id: 'FAUCET-1', kind: 'faucet', designation: 'КМ2.710.020', name: 'Кран питьевой воды настольный (гусак, рычаг)', pos: [SINK.x, G.deckTop, 622], size: [50, 210, 160] },
  { id: 'SIPHON-1', kind: 'water', designation: 'КМ2.710.030', name: 'Сифон с гидрозатвором и ревизией', d: 32, color: '#c9ccd0',
    path: [[SINK.x, G.deckTop - SINK.depth, SINK.z], [SINK.x, 880, SINK.z], [SINK.x, 820, 700], [SINK.x, 850, 655], [SINK.x, 800, 620], [SINK.x, 760, 620]] },
  { id: 'VALVE-1', kind: 'valve', designation: 'КМ2.710.040', name: 'Кран запорный подвода воды (шаровой, ручка-бабочка)', pos: [-760, 700, G.tBack + 18], size: [40, 60, 40] },
  { id: 'WL-2', kind: 'water', designation: 'КМ2.700.030', name: 'Отвод воды к крану', d: 10, color: '#d9dde0',
    path: [[-760, 1060, G.tBack + 18], [-760, 1060, 560], [SINK.x, 1060, 622], [SINK.x, G.deckTop, 622]] },
];

/** Скруглённый прямоугольник (u, v) — для вырезов. */
export function roundedRect(cu, cv, w, h, r, n = 6) {
  return rectOutline({ u0: cu - w / 2, u1: cu + w / 2, v0: cv - h / 2, v1: cv + h / 2 }, {}, { A: r, B: r, C: r, D: r }).slice(0, 4 * (n + 3));
}
export function circle(cu, cv, r, n = 24) {
  return Array.from({ length: n }, (_, i) => [cu + Math.cos((i / n) * Math.PI * 2) * r, cv + Math.sin((i / n) * Math.PI * 2) * r]);
}
// вырезы в столе: под раковину (по борту −10 мм) и под кран
panelById.get('DECK').holes = [roundedRect(SINK.x, SINK.z, SINK.w - 20, SINK.d - 20, 30), circle(SINK.x, 622, 18)];

// ---------- дверцы, петли, защёлки ----------
// верхние отсеки — дверцы на двух петлях с поворотной защёлкой; отсек отходов — дверца с откидным клапаном
const UPPER = [[-838, -412], [-412, 0], [0, 412], [412, 838]];
export const DOORS = [
  ...UPPER.map(([a, b], i) => ({
    id: `DOOR-U${i + 1}`, kind: 'door', designation: i === 0 ? 'КМ2.230.000' : `КМ2.230.000-0${i}`, name: `Дверца верхнего отсека ${i + 1}`,
    x0: a + 2, x1: b - 2, y0: G.shelfTop + 3, y1: G.H - G.tTop - 3, z: 603, t: 10, hinge: i < 2 ? 'L' : 'R',
  })),
  { id: 'DOOR-W', kind: 'door', designation: 'КМ2.240.000', name: 'Дверца отсека отходов с откидным клапаном', x0: -823, x1: -509, y0: 30, y1: 1074, z: 848, t: 10, hinge: 'L', flap: true },
];
export const HINGES = DOORS.flatMap((d) => {
  const x = d.hinge === 'L' ? d.x0 + 6 : d.x1 - 6;
  const ys = d.y1 - d.y0 > 700 ? [d.y0 + 120, (d.y0 + d.y1) / 2, d.y1 - 120] : [d.y0 + 70, d.y1 - 70];
  return ys.map((y, i) => ({ id: `HG-${d.id.slice(5)}-${i + 1}`, kind: 'hinge', designation: 'КМ2.630.010', name: 'Петля накладная 40×30, нерж.',
    door: d.id, pos: [x, y, d.z + d.t], screws: 4, torqueNm: 1.2 }));
});
export const LATCHES = DOORS.map((d) => ({
  id: `LT-${d.id.slice(5)}`, kind: 'latch', designation: 'КМ2.640.010', name: 'Защёлка поворотная (на ¼ оборота) с кнопкой',
  door: d.id, pos: [d.hinge === 'L' ? d.x1 - 30 : d.x0 + 30, d.flap ? 960 : (d.y0 + d.y1) / 2, d.z + d.t],
}));

// бухты тележечных отсеков (центры по X) и отсек отходов
export const BAYS = [
  { n: 0, x0: -IN, x1: -507 }, { n: 1, x0: -494, x1: -174 }, { n: 2, x0: -161, x1: 159 },
  { n: 3, x0: 172, x1: 492 }, { n: 4, x0: 505, x1: IN },
];

for (const d of DECOR) {
  if (d.kind === 'placard') { const b = BAYS[d.bay]; d.pos = [(b.x0 + b.x1) / 2, 1066, 857]; }
  if (d.kind === 'turnbutton') { const b = BAYS[d.bay]; d.pos = [(b.x0 + b.x1) / 2 + (d.y > 500 ? -110 : 0), d.y, d.z]; }
}

// ---------- жгуты, вода, дренаж ----------
const zH = G.tBack + 14;
export const HARNESS = [
  { id: 'HN-MAIN', kind: 'harness', designation: 'КМ2.500.000', name: 'Жгут основной (ввод сверху)', d: 14, color: '#2b2f33',
    path: [[700, G.H + 120, 120], [700, G.H, 120], [700, G.H - 40, zH], [700, G.shelfTop + 10, zH], [700, G.shelfTop - 30, zH], [660, 1440, zH]] },
  { id: 'HN-CB', kind: 'harness', designation: 'КМ2.500.000', name: 'Отвод к щитку автоматов', d: 9, color: '#2b2f33',
    path: [[660, 1440, zH], [600, 1440, zH], [569, 1440, zH + 20]] },
  { id: 'HN-OV', kind: 'harness', designation: 'КМ2.500.000', name: 'Отвод к печам', d: 10, color: '#2b2f33',
    path: [[660, 1440, zH], [300, 1460, zH], [-180, 1460, zH], [-351, 1460, zH], [-500, 1460, zH], [-663, 1460, zH], [-663, 1420, zH + 10]] },
  { id: 'HN-BEV', kind: 'harness', designation: 'КМ2.500.000', name: 'Отвод к кофеварке и кипятильнику', d: 8, color: '#2b2f33',
    path: [[213, 1460, zH], [213, 1430, zH + 8], [100, 1430, zH + 8], [-25, 1430, zH + 8], [-25, 1410, zH + 14]] },
  { id: 'HN-LT', kind: 'harness', designation: 'КМ2.500.000', name: 'Отвод к светильнику', d: 6, color: '#2b2f33',
    path: [[660, 1440, zH], [760, 1470, zH], [790, 1490, 200], [790, 1490, 545]] },
  { id: 'WL-1', kind: 'water', designation: 'КМ2.700.010', name: 'Трубопровод подвода воды', d: 12, color: '#d9dde0',
    path: [[-760, -60, 60], [-760, 0, 60], [-760, 900, zH + 4], [-760, 1080, zH + 4], [-600, 1080, zH + 4], [-180, 1125, zH + 4], [213, 1125, zH + 4], [213, 1140, 60]] },
  { id: 'DR-1', kind: 'water', designation: 'КМ2.700.020', name: 'Трубопровод дренажа', d: 32, color: '#8a9096',
    path: [[-700, 760, 620], [-700, 600, 500], [-700, 300, 280], [-700, 0, 200], [-700, -80, 200]] },
];

/** Хомуты P-образные на жгутах и трубах — по точкам излома путей (на задней стенке). */
export const CLAMPS = HARNESS.flatMap((h) => h.path.slice(1, -1).filter((p) => p[2] <= zH + 8 && p[1] > 0 && p[1] < G.H)
  .map((p, i) => ({ id: `CL-${h.id.slice(3)}-${i + 1}`, kind: 'clamp', designation: 'Хомут ХП-10 (усл.)', name: 'Хомут P-образный с винтом во вставку', on: h.id, pos: p })));

// ---------- индекс элементов для поиска «что в этой точке» ----------
export function featureCenter(f) {
  if (f.kind === 'panel') return center(panelBox(f));
  if (f.kind === 'bracket') return f.corner;
  if (f.kind === 'door') return [(f.x0 + f.x1) / 2, (f.y0 + f.y1) / 2, f.z + f.t / 2];
  if (f.pos) return f.kind === 'equipment' ? [f.pos[0], f.pos[1] + f.size[1] / 2, f.pos[2] + f.size[2] / 2] : f.pos;
  if (f.path) return f.path[Math.floor(f.path.length / 2)];
  if (f.kind === 'joint') return center(GROOVES.find((g) => g.joint === f.id));
  if (f.panel) return center(panelBox(panelById.get(f.panel)));
  return [0, G.H / 2, G.D / 2];
}

export const FEATURES = [
  ...PANELS, ...JOINTS.map((j) => ({ ...j, kind: 'joint', name: `Соединение шип-паз ${j.a} → ${j.b}`, designation: 'КМ2.000.000 СБ, узел А' })),
  ...BRACKETS, ...FASTENERS, ...FITTINGS, ...TRIMS, ...DECOR, ...EQUIPMENT, ...HARNESS, ...CLAMPS, ...INSERTS_LOAD,
  ...PLUMBING, ...DOORS, ...HINGES, ...LATCHES,
];
export const featureById = new Map(FEATURES.map((f) => [f.id, f]));

/** Ближайшие к точке (мм, СК модуля) элементы: [{f, dist}], по возрастанию расстояния. */
export function featuresNear(p, radius = 120, kinds = null) {
  return FEATURES
    .filter((f) => !kinds || kinds.includes(f.kind))
    .map((f) => ({ f, dist: Math.hypot(...featureCenter(f).map((v, i) => v - p[i])) }))
    .filter((x) => x.dist <= radius)
    .sort((a, b) => a.dist - b.dist);
}

/** Площадь контура (для массы и расхода клея/плёнки), мм². */
export function outlineArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}
