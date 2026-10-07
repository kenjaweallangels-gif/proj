import { describe, expect, it } from 'vitest';
import { DEVICES, deviceById, fitDistance, fitsWindow, pixelsPerDegree, windowDeg } from '../src/galley/glasses.js';

describe('профили очков', () => {
  it('окно 52° 16:10 ≈ 44,9 × 29,0°, Aura 70° — шире', () => {
    const v = windowDeg(deviceById.get('viture-luma-ultra'));
    expect(v.h).toBeCloseTo(44.9, 0);
    expect(v.v).toBeCloseTo(29.0, 0);
    expect(windowDeg(deviceById.get('xreal-aura')).h).toBeGreaterThan(58);
  });

  it('угловая плотность: при одинаковых 1920 пикс широкое поле даёт меньше пикселей на градус', () => {
    expect(pixelsPerDegree(deviceById.get('xreal-air2-pro'))).toBeGreaterThan(pixelsPerDegree(deviceById.get('xreal-one-pro')));
    expect(pixelsPerDegree(deviceById.get('xreal-one-pro'))).toBeGreaterThan(pixelsPerDegree(deviceById.get('xreal-aura')));
    for (const d of DEVICES) expect(pixelsPerDegree(d)).toBeGreaterThan(25);
  });

  it('окно КД 1,2 × 0,86 м с 1,4 м: в 52° не помещается, в 70° — да', () => {
    expect(fitsWindow(deviceById.get('viture-luma-ultra'), 1.2, 0.864, 1.4)).toBe(false);
    expect(fitsWindow(deviceById.get('xreal-aura'), 1.2, 0.864, 1.4)).toBe(true);
    expect(fitDistance(deviceById.get('xreal-aura'), 1.2, 0.864)).toBeLessThan(fitDistance(deviceById.get('xreal-air2-pro'), 1.2, 0.864));
  });

  it('характеристики заполнены, есть источники, ступени затемнения убывают', () => {
    for (const d of DEVICES) {
      expect(d.sources.length, d.id).toBeGreaterThan(0);
      expect(d.nits).toBeGreaterThan(0);
      expect(['3dof', '6dof']).toContain(d.tracking);
      if (d.dimLevels) { expect(d.dimLevels[0]).toBeCloseTo(d.transmit); expect([...d.dimLevels].sort((a, b) => b - a)).toEqual(d.dimLevels); }
    }
  });
});

describe('выбор очков и затемнение', () => {
  it('фраза → профиль', async () => {
    const { matchDevice } = await import('../src/galley/glasses.js');
    expect(matchDevice('иксреал аура')).toBe('xreal-aura');
    expect(matchDevice('xreal one pro')).toBe('xreal-one-pro');
    expect(matchDevice('эксреал эйр два про')).toBe('xreal-air2-pro');
    expect(matchDevice('витур люма ультра')).toBe('viture-luma-ultra');
    expect(matchDevice('бист')).toBe('viture-beast');
    expect(matchDevice('что-то')).toBeNull();
  });
  it('ступени затемнения: пропускание от прозрачной до тёмной, у Air 2 Ultra — постоянное', async () => {
    const { transmitAt, dimLevelOfStep, dimStepOf } = await import('../src/galley/glasses.js');
    const v = deviceById.get('viture-luma-ultra');
    expect(transmitAt(v, 0)).toBeCloseTo(0.4);
    expect(transmitAt(v, 1)).toBeCloseTo(0.005);
    v.dimLevels.forEach((x, i) => { expect(transmitAt(v, dimLevelOfStep(v, i))).toBeCloseTo(x); expect(dimStepOf(v, dimLevelOfStep(v, i))).toBe(i); });
    expect(transmitAt(deviceById.get('xreal-air2-ultra'), 0.8)).toBeCloseTo(0.25);
    expect(deviceById.get('aura').id).toBe('xreal-aura');
  });
});
