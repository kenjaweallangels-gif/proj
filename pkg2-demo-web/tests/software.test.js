import { describe, expect, it } from 'vitest';
import { DEVICES, deviceById, matchDevice } from '../src/galley/glasses.js';
import { SW, capsFor, compareRows, snapTransmit } from '../src/galley/software.js';

const dev = (id) => deviceById.get(id);

describe('режим ПО очков: штатное и своё на SDK', () => {
  it('у каждой модели есть оба режима', () => {
    for (const d of DEVICES) { expect(SW[d.id]?.stock, d.id).toBeTruthy(); expect(SW[d.id]?.sdk, d.id).toBeTruthy(); }
  });

  it('штатно голограмм на изделии нет ни у одних очков', () => {
    for (const d of DEVICES) expect(capsFor(d, 'stock').holoOnPart, d.id).toBe(false);
    expect(capsFor(dev('viture-luma-ultra'), 'stock').windows).toBe('head');            // просто внешний монитор
    expect(capsFor(dev('xreal-one-pro'), 'stock')).toMatchObject({ windows: '3dof', latencyMs: 3 });   // якорь X1 в очках
  });

  it('своё ПО: голограммы на изделии — только при 6DoF и метках (закупаемые комплекты — да)', () => {
    expect(capsFor(dev('viture-luma-ultra'), 'sdk').holoOnPart).toBe(true);
    expect(capsFor(dev('xreal-one-pro-eye'), 'sdk').holoOnPart).toBe(true);
    expect(capsFor(dev('xreal-one-pro'), 'sdk').holoOnPart).toBe(false);                 // без камеры Eye
    expect(capsFor(dev('viture-luma-pro'), 'sdk').holoOnPart).toBe(false);                // 3DoF
  });

  it('железо ограничивает: 3DoF-очки не получают 6DoF, нет затемнения — нет и управления им', () => {
    for (const d of DEVICES) {
      const c = capsFor(d, 'sdk');
      if (d.tracking === '3dof') expect(c.windows, d.id).not.toBe('6dof');
      if (!d.dimLevels) { expect(c.dim, d.id).toBe('none'); expect(c.dimAuto).toBe(false); }
    }
  });

  it('авто-затемнение и авто-яркость — только в своём ПО', () => {
    const u = dev('viture-luma-ultra');
    expect(capsFor(u, 'stock')).toMatchObject({ dimAuto: false, brightAuto: false });
    expect(capsFor(u, 'sdk')).toMatchObject({ dimAuto: true, brightAuto: true });
    expect(capsFor(u, 'sdk').unsure.length).toBeGreaterThan(0);                           // что проверить по SDK
  });

  it('ступени SDK: затемнение «вкл/выкл» — только крайние значения', () => {
    expect(snapTransmit([0.4, 0.005], 0.3)).toBe(0.4);
    expect(snapTransmit([0.4, 0.005], 0.1)).toBe(0.005);
    expect(snapTransmit(null, 0.2)).toBe(0.2);
  });

  it('таблица сравнения и выбор комплекта голосом', () => {
    const rows = compareRows(dev('xreal-one-pro-eye'));
    expect(rows.length).toBe(12);
    expect(rows.find((r) => r[0] === 'Голограммы на изделии')).toEqual(['Голограммы на изделии', 'нет', 'да']);
    expect(matchDevice('xreal one pro eye')).toBe('xreal-one-pro-eye');
    expect(matchDevice('xreal one pro')).toBe('xreal-one-pro');
  });
});
