import { describe, expect, it } from 'vitest';
import { approachDir, buildLessons, partLabel, POSITIONS, stateAt } from '../src/galley/training.js';
import { STEPS } from '../src/galley/process.js';

const L = buildLessons();
const at = (id) => L.findIndex((x) => x.id === id);

describe('обучающая сборка: сценарий', () => {
  it('плёнка клеится на столе до установки боковины, уроки 140.01–140.04 заменены', () => {
    expect(at('030.ТL3')).toBeLessThan(at('030.03'));
    expect(at('030.ТR3')).toBeLessThan(at('030.04'));
    expect(L.find((x) => x.id === '030.ТL2').action).toBe('brush');
    expect(at('140.03')).toBe(-1);
    expect(L.find((x) => x.id === '030.03').carries).toEqual(['FILM-L']);
  });
  it('герметик — отдельным уроком перед установкой раковины, профиля, облицовки', () => {
    for (const id of ['160.03', '110.01', '145.01']) { expect(at(`${id}.Г`)).toBe(at(id) - 1); expect(L[at(`${id}.Г`)].action).toBe('seal'); }
  });
  it('у каждого урока клея, герметика и крепежа есть предупреждения; id уникальны; все шаги ТП учтены', () => {
    for (const x of L.filter((y) => ['glue', 'seal', 'fasten', 'degrease', 'film', 'brush'].includes(y.action))) expect(x.warns.length).toBeGreaterThan(0);
    expect(new Set(L.map((x) => x.id)).size).toBe(L.length);
    const ids = new Set(L.map((x) => x.step).filter(Boolean));
    for (const s of STEPS) if (!/^140\.0[1-4]$/.test(s.id)) expect(ids.has(s.id)).toBe(true);
  });
  it('состояние: детали появляются только после своего урока, плёнка — на столе до установки', () => {
    const k = at('030.03');
    expect(stateAt(L, k).installed.has('SIDE-L')).toBe(false);
    expect(stateAt(L, k).film.has('FILM-L')).toBe(true);
    expect(stateAt(L, k).filmOnTable.has('SIDE-L')).toBe(true);
    expect(stateAt(L, k + 1).installed.has('SIDE-L')).toBe(true);
    expect(stateAt(L, k + 1).filmOnTable.has('SIDE-L')).toBe(false);
    expect(stateAt(L, L.length).painted).toBe(true);
  });
  it('направления установки: боковины сбоку, основание и крышка сверху, перегородки спереди', () => {
    expect(approachDir('SIDE-L')).toEqual([-1, 0, 0]);
    expect(approachDir('TOP')).toEqual([0, 1, 0]);
    expect(approachDir('DIV-T1')).toEqual([0, 0, 1]);
    expect(approachDir('SINK-1')).toEqual([0, 1, 0]);
  });
  it('подписи: номер позиции, наименование, обозначение; одинаковые детали — один номер', () => {
    expect(partLabel('SIDE-L')).toMatch(/^поз\. \d+ · Панель боковая левая · КМ2\.110\.000$/);
    expect(POSITIONS.get('SC-2')).toBe(POSITIONS.get('SC-4'));
    const fl = L.find((x) => x.id === '090.01').labels;
    expect(fl[0].text).toMatch(/× 15$/);
  });
});
