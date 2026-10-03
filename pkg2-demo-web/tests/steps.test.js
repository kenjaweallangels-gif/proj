import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizePackage } from '../src/engine/package.js';
import { State, StepPlayer } from '../src/engine/steps.js';

const pkg = (f) => normalizePackage(JSON.parse(readFileSync(new URL(`../../data/examples/${f}`, import.meta.url), 'utf8')), 'http://x/');

function make(f = 'op040_shelf_bench.json') {
  let t = 0;
  const P = pkg(f);
  const pl = new StepPlayer(P.steps, () => t);
  pl.start();
  return { pl, tick: (s) => { t += s; } };
}

describe('проигрыватель шагов', () => {
  it('привязка → шаги → фото → конец', () => {
    const { pl } = make();
    expect(pl.state).toBe(State.ALIGNING);
    expect(pl.command('next')).toBe(false);
    pl.aligned(0.93);
    for (let i = 0; i < 5; i++) expect(pl.command('next')).toBe(true);
    expect(pl.step.id).toBe('S6');
    expect(pl.command('next')).toBe(false);
    expect(pl.state).toBe(State.WAITING_PHOTO);
    expect(pl.command('photo')).toBe(true);
    expect(pl.state).toBe(State.DONE);
    expect(pl.log.at(-1).event).toBe('operation_done');
  });

  it('критичный шаг 070/S4 требует значение в допуске', () => {
    const { pl } = make('op070_bin_fuselage.json');
    pl.aligned();
    pl.command('next'); pl.command('next'); pl.command('next');     // S1 → S2 → S3 → S4
    expect(pl.step.id).toBe('S4');
    expect(pl.command('next')).toBe(false);
    expect(pl.state).toBe(State.WAITING_VALUE);
    expect(pl.command('value', 5)).toBe(false);     // зазор 3 ± 1
    expect(pl.command('value', 3.4)).toBe(true);
    expect(pl.step.id).toBe('S5');
  });

  it('сообщение как у ядра', () => {
    const { pl } = make();
    expect(pl.message('040')).toMatchObject({ type: 'step', op: '040', index: 0, total: 6, state: 'aligning', need: null });
  });

  it('скорость в пределах 0,5–2', () => {
    const { pl } = make();
    for (let i = 0; i < 6; i++) pl.command('faster');
    expect(pl.speed).toBe(2);
    for (let i = 0; i < 6; i++) pl.command('slower');
    expect(pl.speed).toBe(0.5);
  });
});
