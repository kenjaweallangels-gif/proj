import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizePackage, stepFocus, validatePackage } from '../src/engine/package.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../../data/examples/${f}`, import.meta.url), 'utf8'));
const BASE = 'http://demo.local/data/op.json';

describe('пакет операции', () => {
  it('примеры без ошибок ссылок', () => {
    expect(validatePackage(load('op040_shelf_bench.json'))).toEqual([]);
    expect(validatePackage(load('op070_bin_fuselage.json'))).toEqual([]);
  });

  it('мм → м, uri от адреса пакета', () => {
    const P = normalizePackage(load('op040_shelf_bench.json'), BASE);
    expect(P.parts.get('K204').pos).toEqual([-0.4, 0.03, -0.12]);
    expect(P.markers[0].size).toBeCloseTo(0.08);
    expect(P.models[0].url).toBe('http://demo.local/data/models/op040_shelf.glb');
    expect(P.kdSheets.get('kd3').url).toBe('http://demo.local/data/kd/AI.7045.200_SB_list3.png');
    expect(P.isFixture).toBe(true);
    expect(P.floorY).toBeCloseTo(P.bounds.min[1] - 0.9);
  });

  it('фюзеляж: пол под самой низкой точкой', () => {
    const P = normalizePackage(load('op070_bin_fuselage.json'), BASE);
    expect(P.isFuselage).toBe(true);
    expect(P.floorY).toBeLessThan(0.02);
    expect(P.fasteners.size).toBe(14);
  });

  it('битая ссылка — понятная ошибка', () => {
    const pkg = load('op040_shelf_bench.json');
    pkg.steps[1].parts = ['NOPE'];
    expect(() => normalizePackage(pkg, BASE)).toThrow(/нет детали NOPE/);
  });

  it('фокус шага — центр его деталей', () => {
    const P = normalizePackage(load('op040_shelf_bench.json'), BASE);
    const f = stepFocus(P, P.steps[3]);           // П-110
    expect(f[0]).toBeCloseTo(0);
    expect(f[2]).toBeCloseTo(-0.2);
  });
});
