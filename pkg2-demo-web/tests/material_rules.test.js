import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MATERIAL_KEYS, lightness, materialKeyFor } from '../src/engine/material_rules.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../../data/examples/${f}`, import.meta.url), 'utf8'));
const keyOf = (p) => materialKeyFor({ name: p.name, designation: p.designation, fallbackType: p.fallback?.type, color: p.fallback?.color });

describe('материалы деталей', () => {
  it('детали примеров 040 и 070 получают ожидаемые материалы', () => {
    const got = {};
    for (const f of ['op040_shelf_bench.json', 'op070_bin_fuselage.json']) for (const p of load(f).parts) got[p.id] = keyOf(p);
    expect(got).toEqual({
      K204: 'aluminium', K205: 'aluminium', P110: 'steel', Z31: 'plastic_black',
      'K3140-L': 'aluminium', 'K3140-R': 'aluminium', PB12: 'composite_panel',
      'T45-L': 'steel', 'T45-R': 'steel', PP7: 'decor_panel',
    });
  });

  it('имя материала CAD важнее наименования', () => {
    expect(materialKeyFor({ name: 'Кронштейн', cadMaterial: 'Сталь 30ХГСА' })).toBe('steel');
    expect(materialKeyFor({ name: 'Кронштейн', cadMaterial: 'Д16Т анодированный' })).toBe('anodized');
  });

  it('без подсказок — по типу заглушки и цвету', () => {
    expect(materialKeyFor({ fallbackType: 'cylinder' })).toBe('steel');
    expect(materialKeyFor({ fallbackType: 'box', color: '#202020' })).toBe('plastic_black');
    expect(materialKeyFor({ fallbackType: 'box', color: '#f0f0ea' })).toBe('composite_panel');
    expect(materialKeyFor({ fallbackType: 'box', color: '#3060a0' })).toBe('painted');
    expect(materialKeyFor()).toBe('painted');
  });

  it('все ключи — из библиотеки, светлота в 0..1', () => {
    for (const n of ['Винт', 'Замок', 'Полка', 'Уплотнитель', 'Панель потолочная', 'x']) expect(MATERIAL_KEYS).toContain(materialKeyFor({ name: n }));
    expect(lightness('#000000')).toBe(0);
    expect(lightness('#ffffff')).toBe(1);
    expect(lightness('мусор')).toBeCloseTo(0.6);
  });
});
