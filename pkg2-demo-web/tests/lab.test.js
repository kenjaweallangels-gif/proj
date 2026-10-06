import { describe, expect, it } from 'vitest';
import { deviceById } from '../src/galley/glasses.js';
import { SW, capsFor } from '../src/galley/software.js';
import { applyMeasurement, applySdkMeasurement, installMeasurements, loadMeasurements } from '../src/galley/measured.js';
import { PoseLink, parseHead, quatFromYpr, rateHz, yprFromQuat } from '../src/galley/pose_link.js';

describe('замеры очков → профиль симулятора', () => {
  const d = deviceById.get('viture-luma-ultra');
  const m = { device: 'viture-luma-ultra', date: '2026-11-20', values: { nits: 1310, latencyMs: 24, transmit: 0.37, imuHz: 1000, unknown: 5 }, sdk: { latencyMs: 19, hz: 90 } };

  it('подставляет измеренные поля и снимает отметку «оценка»', () => {
    const x = applyMeasurement(d, m);
    expect(x).toMatchObject({ nits: 1310, latencyMs: 24, transmit: 0.37 });
    expect(x.dimLevels[0]).toBe(0.37);
    expect(x.estimates.some((e) => /задержк/i.test(e))).toBe(false);
    expect(x.measured).toMatchObject({ date: '2026-11-20', keys: ['nits', 'transmit', 'latencyMs'], info: { imuHz: 1000 }, sdk: { latencyMs: 19, hz: 90 } });
    expect(x.unknown).toBeUndefined();
    expect(d.nits).not.toBe(1310);                                   // исходный профиль не меняется
    expect(applyMeasurement(d, { ...m, device: 'xreal-one' })).toBe(d);
  });

  it('замеры своего ПО идут в режим SDK', () => {
    const row = applySdkMeasurement(SW['viture-luma-ultra'], m);
    expect(row.sdk).toMatchObject({ latencyMs: 19, hz: 90 });
    expect(row.stock).toBe(SW['viture-luma-ultra'].stock);
  });

  it('примеры (_*.json) не загружаются, неизвестная модель пропускается', () => {
    expect(loadMeasurements().every((x) => x.by?.startsWith('Пример') !== true)).toBe(true);
    expect(installMeasurements([{ device: 'нет-такой', values: { nits: 1 } }])).toEqual([]);
  });

  it('установка меняет и профиль, и возможности режима', () => {
    const before = capsFor(deviceById.get('xreal-one-pro-eye'), 'sdk').latencyMs;
    installMeasurements([{ device: 'xreal-one-pro-eye', values: { nits: 650 }, sdk: { latencyMs: before + 5 } }]);
    expect(deviceById.get('xreal-one-pro-eye').nits).toBe(650);
    expect(capsFor(deviceById.get('xreal-one-pro-eye'), 'sdk').latencyMs).toBe(before + 5);
  });
});

describe('поза головы с очков', () => {
  it('кватернион ↔ курс/тангаж/крен (как pose_bridge.py)', () => {
    for (const [y, p, r] of [[0.3, -0.2, 0.1], [-2.5, 0.4, -0.3], [3, 0, 0]]) {
      const a = yprFromQuat(quatFromYpr(y, p, r));
      expect(a.yaw).toBeCloseTo(y, 9); expect(a.pitch).toBeCloseTo(p, 9); expect(a.roll).toBeCloseTo(r, 9);
    }
  });

  it('разбор сообщений «head»', () => {
    const q = quatFromYpr(0.2, 0.1);
    expect(parseHead(JSON.stringify({ type: 'head', t_ns: 5, rotation_xyzw: q.map((v) => v * 2), position_m: [0, 1.7, 0] }))).toMatchObject({ t: 5, p: [0, 1.7, 0] });
    expect(parseHead('{"type":"step"}')).toBeNull();
    expect(parseHead('не json')).toBeNull();
    expect(Math.hypot(...parseHead(JSON.stringify({ type: 'head', rotation_xyzw: [0, 0, 0, 2] })).q)).toBeCloseTo(1);
  });

  it('связь: курс обнуляется на первой позе, частота считается', () => {
    class FakeWS { constructor() { FakeWS.last = this; } close() {} }
    const got = [];
    const link = new PoseLink('ws://x', { WS: FakeWS, onPose: (p) => got.push(p) });
    for (let i = 0; i < 11; i++) FakeWS.last.onmessage({ data: JSON.stringify({ type: 'head', t_ns: i * 1e7, rotation_xyzw: quatFromYpr(1 + i * 0.01, 0) }) });
    expect(got[0].rel.yaw).toBeCloseTo(0);
    expect(got.at(-1).rel.yaw).toBeCloseTo(0.1);
    expect(link.hz).toBeCloseTo(100);
    link.recenter();
    expect(link.zeroYaw).toBeCloseTo(1.1);
    expect(rateHz([0])).toBe(0);
    link.close();
  });
});

import { frameStats, gridStep, scaleFor, textPx } from '../src/lab/scale.js';
describe('стенд: масштаб экрана очков', () => {
  const d = deviceById.get('viture-luma-ultra');
  it('2D и стерео SBS', () => {
    const a = scaleFor(d, 1920, 1200), b = scaleFor(d, 3840, 1200);
    expect(a.sbs).toBe(false); expect(b.sbs).toBe(true);
    expect(b.ew).toBe(1920); expect(b.ppdX).toBeCloseTo(a.ppdX);
    expect(a.ppdX).toBeGreaterThan(40); expect(a.ppdX).toBeLessThan(50);       // 1920 пикс на ≈ 44° окна
    expect(textPx(a, 0.5)).toBe(Math.round(0.5 * a.ppdY));
    expect(gridStep(a) * a.ppdX).toBeGreaterThanOrEqual(40);
  });
  it('частота кадров и пропуски', () => {
    const r = frameStats([...Array(60).fill(1000 / 60), 50]);
    expect(r.hz).toBeCloseTo(60); expect(r.dropped).toBe(1);
  });
});
