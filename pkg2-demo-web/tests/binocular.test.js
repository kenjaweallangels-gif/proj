import { describe, expect, it } from 'vitest';
import { CUBE_FACES, FIELD, dirOf, disparityDeg, equidistantToAngles, eyeAperture, faceOf, horizontalExtent, inEyeField, marArcmin, panumDeg } from '../src/galley/binocular.js';
import { DESIGN } from '../src/galley/glasses_model.js';
import { DEVICES } from '../src/galley/glasses.js';

describe('бинокулярное поле', () => {
  it('перекрытие ≈ 120°, всё поле ≈ 200° на уровне глаз; выше и ниже — уже', () => {
    const h = horizontalExtent(0);
    expect(h.binocular).toBeCloseTo(120, 0);
    expect(h.total).toBeCloseTo(200, 0);
    expect(horizontalExtent(-40).total).toBeLessThan(h.total);
    expect(horizontalExtent(FIELD.up).total).toBe(0);
  });
  it('поле глаза: к виску видно на 95°, к носу на 65° — нет', () => {
    expect(inEyeField(95, 0)).toBe(true);
    expect(inEyeField(-65, 0)).toBe(false);
    expect(inEyeField(0, -70)).toBe(true);
    expect(inEyeField(0, 62)).toBe(false);
  });
  it('Panum: 6–10′ в центре, 15–70′ на 6°; двоение рабочей зоны при взгляде вдаль', () => {
    expect(panumDeg(0) * 60).toBeGreaterThan(6); expect(panumDeg(0) * 60).toBeLessThan(10);
    expect(panumDeg(6) * 60).toBeGreaterThan(15); expect(panumDeg(6) * 60).toBeLessThan(70);
    // деталь в 0,5 м при фиксации окна дисплея на 4 м: ≈ 6,4° — далеко за зоной слияния
    expect(disparityDeg(0.5, 4)).toBeCloseTo(6.4, 1);
    expect(Math.abs(disparityDeg(4, 4))).toBeLessThan(1e-9);
  });
  it('острота падает линейно: на 10° угол разрешения ×5', () => { expect(marArcmin(10)).toBeCloseTo(5); });
});

describe('апертура очков', () => {
  it('для всех очков: линза уже поля глаза, рамка заканчивается раньше границы поля у виска', () => {
    for (const d of DEVICES) {
      const a = eyeAperture(DESIGN[d.id], d);
      expect(a.nasal, d.id).toBeGreaterThan(35); expect(a.nasal).toBeLessThan(FIELD.nasal);
      expect(a.temporal).toBeGreaterThan(45); expect(a.temporal).toBeLessThan(a.frameT + 1);
      expect(a.frameT).toBeLessThan(FIELD.temporal);
      expect(a.up).toBeGreaterThan(10); expect(a.up).toBeLessThan(30);
      expect(a.down).toBeGreaterThan(35); expect(a.down).toBeLessThan(FIELD.down);
    }
  });
});

describe('развёртка куба', () => {
  it('направление попадает в свою грань, центр грани — (0,5; 0,5)', () => {
    CUBE_FACES.forEach((f, i) => { const r = faceOf(f.F); expect(r.face).toBe(i); expect(r.u).toBeCloseTo(0.5); expect(r.v).toBeCloseTo(0.5); });
    const r = faceOf(dirOf(60, 10));
    expect(r.face).toBe(1);
    expect(faceOf([0, 0, -1])).toBeNull();
  });
  it('равнопромежуточная проекция: угол от центра сохраняется', () => {
    const a = equidistantToAngles(90, 0); expect(a.az).toBeCloseTo(90); expect(a.el).toBeCloseTo(0);
    const b = equidistantToAngles(0, -40); expect(b.el).toBeCloseTo(-40);
    const c = equidistantToAngles(100, 0); expect(c.az).toBeCloseTo(100);
  });
});
