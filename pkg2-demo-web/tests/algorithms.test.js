import { describe, expect, it } from 'vitest';
import { buildCatalog, findAlgorithm, treeKM2, treeRows } from '../src/galley/algorithms.js';
import { docByCode } from '../src/galley/catalog.js';
import { STEPS } from '../src/galley/process.js';

const fake = (id, n) => ({ id, short: `Участок ${id}`, steps: Array.from({ length: n }, (_, k) => ({ id: `0${k}0.01`, op: `0${k}0`, title: `Шаг ${k}`, text: ['…'] })) });

describe('каталог алгоритмов', () => {
  it('стапель и участки: процесс, КД (листы), дерево', () => {
    const list = buildCatalog([fake('em1', 12), fake('sl1', 8), fake('me1', 10)]);
    expect(list.map((a) => a.id)).toEqual(['km2', 'em1', 'sl1', 'me1']);
    const km2 = list[0];
    expect(km2.steps.length).toBe(STEPS.length);
    expect(km2.sheets).toBeGreaterThanOrEqual(5);
    for (const a of list) for (const c of a.docs) expect(docByCode.has(c)).toBe(true);
    expect(list.find((a) => a.id === 'sl1').steps.length).toBe(8);
    expect(docByCode.get('КМ2.310.050').sheets.length).toBe(2);
  });
  it('дерево КМ-2: все панели и крепёж с количеством, раскрытие узлов', () => {
    const t = treeKM2();
    const panels = t.children.find((c) => c.name.startsWith('Панели'));
    expect(panels.children.reduce((n, c) => n + c.qty, 0)).toBe(16);
    const fasten = t.children.find((c) => c.name.startsWith('Соединения'));
    expect(fasten.children.find((c) => c.name.startsWith('Винт')).qty).toBe(88);
    expect(treeRows(t).length).toBe(1 + t.children.length);
    expect(treeRows(t, new Set(['0', '0.0'])).length).toBe(1 + t.children.length + panels.children.length);
  });
  it('поиск по словам', () => {
    const list = buildCatalog([fake('em1', 2), fake('sl1', 2), fake('me1', 2)]);
    expect(findAlgorithm(list, 'кронштейн').id).toBe('sl1');
    expect(findAlgorithm(list, 'жгута').id).toBe('em1');
    expect(findAlgorithm(list, 'модуль кухонный').id).toBe('km2');
    expect(findAlgorithm(list, '')).toBe(null);
  });
});
