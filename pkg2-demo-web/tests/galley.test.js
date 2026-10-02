import { describe, expect, it } from 'vitest';
import { DOCUMENTS, docByCode, normalizeCode, searchDocs, TASK } from '../src/galley/catalog.js';
import { OPERATIONS, ProcessRun, STEPS, checkValue, normByOperation, stateBefore, stepsForFeature } from '../src/galley/process.js';
import {
  BRACKETS, FASTENERS, G, GROOVES, JOINTS, PANELS, TROLLEY, BAYS, featureById, featuresNear, outlineArea, panelBox, panelById, rectOutline, slab,
} from '../src/galley/spec.js';

const overlap = (a, b) => [0, 1, 2].every((i) => a.min[i] < b.max[i] && b.min[i] < a.max[i]);
const inside = (a, b, eps = 0.01) => [0, 1, 2].every((i) => a.min[i] >= b.min[i] - eps && a.max[i] <= b.max[i] + eps);

describe('модуль кухонный: геометрия', () => {
  it('панели не пересекаются друг с другом (кроме шипов)', () => {
    for (let i = 0; i < PANELS.length; i++) for (let j = i + 1; j < PANELS.length; j++) {
      expect(overlap(panelBox(PANELS[i]), panelBox(PANELS[j])), `${PANELS[i].id} × ${PANELS[j].id}`).toBe(false);
    }
  });

  it('каждый шип входит в тело сопрягаемой панели (паз внутри панели b)', () => {
    for (const g of GROOVES) {
      const b = panelById.get(g.panel);
      const sb = slab(b), bb = panelBox(b);
      const box = { min: [...bb.min], max: [...bb.max] };
      box.min[sb.axis] = sb.lo; box.max[sb.axis] = sb.hi;
      expect(inside(g, box), g.id).toBe(true);
    }
  });

  it('тележка полного размера входит в отсек с зазором ≥ 3 мм с каждой стороны и по высоте', () => {
    for (const b of BAYS.slice(1)) expect((b.x1 - b.x0 - TROLLEY.w) / 2).toBeGreaterThanOrEqual(3);
    const clearH = G.deckTop - G.tDeck - G.tBase;
    expect(clearH - TROLLEY.h).toBeGreaterThan(10);
    expect(G.D - G.tBack).toBeGreaterThan(TROLLEY.d);
  });

  it('контур с шипами и скруглениями: площадь ≈ прямоугольник + шипы − углы', () => {
    const rect = { u0: 0, u1: 1000, v0: 0, v1: 500 };
    const plain = outlineArea(rectOutline(rect));
    expect(plain).toBeCloseTo(500000, 0);
    const tabs = outlineArea(rectOutline(rect, { u0: { tabs: [{ at: 250, len: 60, depth: 10 }] } }));
    expect(tabs - plain).toBeCloseTo(600, 0);
    const round = outlineArea(rectOutline(rect, {}, { C: 50, D: 50 }));
    expect(plain - round).toBeCloseTo(2 * (2500 - Math.PI * 625), -2);
    const bulge = outlineArea(rectOutline(rect, { v1: { bulge: 20 } }));
    expect(bulge - plain).toBeGreaterThan(1000 * 20 * 0.6);
  });

  it('уголки: две полки, винты во вставки, на гранях обеих панелей', () => {
    expect(BRACKETS.length).toBeGreaterThan(30);
    for (const b of BRACKETS) {
      expect(b.screws).toHaveLength(2);
      for (const s of b.screws) {
        const f = featureById.get(s);
        expect(f.kind).toBe('screw');
        expect(featureById.get(f.insert).kind).toBe('insert');
      }
    }
    expect(FASTENERS.filter((f) => f.kind === 'screw')).toHaveLength(BRACKETS.length * 2);
  });

  it('поиск элементов у точки: угол стол — левая боковина', () => {
    const near = featuresNear([-825, 1080, 300], 80);
    expect(near[0].f.kind).toBe('bracket');
    expect(near[0].f.joint).toBe('J-DECK-L');
  });

  it('у каждого соединения есть пазы', () => {
    for (const j of JOINTS) expect(GROOVES.filter((g) => g.joint === j.id)).toHaveLength(j.tabs);
  });
});

describe('техпроцесс', () => {
  it('ссылки шагов на детали, соединения и крепёж существуют', () => {
    for (const s of STEPS) {
      for (const id of [...s.parts, ...s.joints, ...s.fasteners]) expect(featureById.has(id), `${s.id}: ${id}`).toBe(true);
    }
  });

  it('номера переходов уникальны и возрастают, у операций есть переходы', () => {
    const ids = STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
    for (const o of OPERATIONS) expect(o.steps.length).toBeGreaterThan(0);
  });

  it('каждая панель устанавливается, каждое соединение клеится раньше установки панели с шипами', () => {
    const installAt = new Map(), glueAt = new Map();
    STEPS.forEach((s, i) => {
      if (s.kind === 'install') s.parts.forEach((p) => installAt.set(p, i));
      if (s.kind === 'glue') s.joints.forEach((j) => glueAt.set(j, i));
    });
    for (const p of PANELS) expect(installAt.has(p.id), p.id).toBe(true);
    for (const j of JOINTS) {
      expect(glueAt.has(j.id), j.id).toBe(true);
      const later = Math.max(installAt.get(j.a), installAt.get(j.b));
      expect(glueAt.get(j.id), j.id).toBeLessThanOrEqual(later);
    }
  });

  it('каждый уголок устанавливается после обеих своих панелей', () => {
    const at = new Map();
    STEPS.forEach((s, i) => s.parts.forEach((p) => at.set(p, i)));
    for (const b of BRACKETS) {
      expect(at.has(b.id), b.id).toBe(true);
      for (const p of b.panels) expect(at.get(b.id)).toBeGreaterThan(at.get(p));
    }
  });

  it('каждый элемент конструкции устанавливается каким-либо переходом', () => {
    const covered = new Set(STEPS.flatMap((st) => [...st.parts, ...st.fasteners]));
    const kinds = ['panel', 'bracket', 'fitting', 'trim', 'equipment', 'light', 'door', 'hinge', 'latch', 'sink', 'faucet', 'valve', 'sheet', 'harness', 'water', 'film', 'retainer', 'turnbutton', 'placard', 'handle'];
    for (const f of featureById.values()) if (kinds.includes(f.kind)) expect(covered.has(f.id), f.id).toBe(true);
  });

  it('контроль значений: допуск, минимум, максимум', () => {
    expect(checkValue({ nominal: 1700, tol: 0.5 }, 1700.4)).toBe(true);
    expect(checkValue({ nominal: 1700, tol: 0.5 }, 1700.6)).toBe(false);
    expect(checkValue({ nominal: 20, tol: 0, min: 20 }, 500)).toBe(true);
    expect(checkValue({ nominal: 20, tol: 0, min: 20 }, 12)).toBe(false);
    expect(checkValue({ nominal: 0, tol: 0, max: 0 }, 0)).toBe(true);
  });

  it('состояние изделия: до 040.02 задняя панель не стоит, после — стоит', () => {
    const i = STEPS.findIndex((s) => s.id === '040.02');
    expect(stateBefore(i).installed.has('BACK')).toBe(false);
    expect(stateBefore(i + 1).installed.has('BACK')).toBe(true);
    expect(stateBefore(i).glued.has('J-BACK-L')).toBe(true);
  });

  it('движок: блокирующий таймер выдержки не пускает дальше, пока не истёк', () => {
    const run = new ProcessRun(STEPS, STEPS.findIndex((s) => s.id === '060.03'));
    expect(run.next()).toBe('value');
    run.value(1105.3);
    expect(run.next()).toBe(null);
    expect(run.step.id).toBe('070.01');
    expect(run.needs()).toBe('timer');
    run.tick(239);
    expect(run.next()).toBe('timer');
    run.tick(2);
    expect(run.next()).toBe(null);
    expect(run.step.id).toBe('080.01');
  });

  it('жизнеспособность клея запускается после нанесения и не блокирует', () => {
    const run = new ProcessRun(STEPS, STEPS.findIndex((s) => s.id === '030.02'));
    run.next();
    expect(run.activeTimers().map((t) => t.kind)).toContain('pot_life');
    expect(run.needs()).not.toBe('timer');
  });

  it('локальный алгоритм: для уголка находятся шаги установки', () => {
    const b = BRACKETS.find((x) => x.joint === 'J-DECK-L');
    expect(stepsForFeature(b.id).map((s) => s.id)).toContain('090.02');
    expect(stepsForFeature('J-DECK-L').map((s) => s.id)).toContain('060.01');
  });

  it('нормы времени по операциям положительны', () => {
    for (const v of Object.values(normByOperation())) expect(v).toBeGreaterThan(0);
  });
});

describe('КД и поиск', () => {
  it('поиск по номеру: латиница вместо кириллицы, пробелы, части номера', () => {
    expect(normalizeCode('km2.000.000 sb')).toBe(normalizeCode('КМ2.000.000 СБ'));
    expect(normalizeCode('KM2.000.000 СБ')).toBe(normalizeCode('КМ2.000.000 СБ'));
    expect(searchDocs('KM2.000.000 СБ')[0].code).toBe('КМ2.000.000 СБ');
    expect(searchDocs('КМ2.160.000-01')[0].code).toBe('КМ2.160.000');
    expect(searchDocs('КМ2.1').length).toBeGreaterThan(5);
    expect(searchDocs('боковая левая')[0].code).toBe('КМ2.110.000');
    expect(searchDocs('ТП 7.КМ2')[0].kind).toBe('ТП');
  });

  it('ссылки шагов на КД ведут на существующие документы и листы', () => {
    for (const s of STEPS) for (const k of s.kd) {
      const d = docByCode.get(k.doc);
      expect(d, `${s.id}: ${k.doc}`).toBeTruthy();
      expect(d.sheets.some((sh) => sh.n === k.sheet), `${s.id}: лист ${k.sheet}`).toBe(true);
    }
  });

  it('задание ссылается на документы реестра', () => {
    for (const it2 of TASK.items) if (it2.doc) expect(docByCode.has(it2.doc), it2.doc).toBe(true);
    expect(DOCUMENTS.length).toBeGreaterThan(15);
  });
});
