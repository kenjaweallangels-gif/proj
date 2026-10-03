import { describe, expect, it } from 'vitest';
import { AssemblyPlayer, SPEEDS, ease, stepAt } from '../src/galley/assembly_player.js';

const target = () => {
  const log = [];
  return { log, name: 't', steps: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], begin: () => log.push('begin'), apply: (i, f) => log.push([i, +f.toFixed(2)]), end: () => log.push('end') };
};

describe('плеер виртуальной сборки', () => {
  it('время в шагах: номер шага и доля, конец — всё выполнено', () => {
    expect(stepAt(1.25, 3)).toEqual({ i: 1, f: 0.25 });
    expect(stepAt(3, 3)).toEqual({ i: 3, f: 0 });
    expect(stepAt(-1, 3)).toEqual({ i: 0, f: 0 });
    expect(ease(0)).toBe(0); expect(ease(1)).toBe(1); expect(ease(0.5)).toBeCloseTo(0.5);
  });
  it('пуск, скорость, остановка в конце, назад — разборка до пустого места', () => {
    const tg = target(); const p = new AssemblyPlayer({ secPerStep: 1 });
    p.openFor(tg);
    expect(tg.log[0]).toBe('begin');
    p.setSpeed(2); p.play();
    p.update(0.5); expect(p.t).toBeCloseTo(1);
    p.update(5); expect(p.t).toBe(3); expect(p.playing).toBe(false);
    p.reverse(); p.update(1); expect(p.t).toBeCloseTo(1);
    p.update(9); expect(p.t).toBe(0);
    p.close(); expect(tg.log.at(-1)).toBe('end');
  });
  it('по шагу вперёд/назад — к началу шага; скорость по ступеням', () => {
    const p = new AssemblyPlayer(); p.openFor(target());
    p.seek(1.4); p.stepBy(1); expect(p.t).toBe(2);
    p.stepBy(-1); expect(p.t).toBe(1); p.seek(1.4); p.stepBy(-1); expect(p.t).toBe(1);
    p.setSpeed(1); p.faster(1); expect(p.speed).toBe(2); p.faster(10); expect(p.speed).toBe(SPEEDS.at(-1));
  });
});
