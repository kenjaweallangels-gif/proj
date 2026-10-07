import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COMMANDS, parse, parseNumber } from '../src/engine/voice.js';

describe('голосовые команды', () => {
  it.each([
    ['сборка дальше', 'next'], ['Сборка, готово!', 'next'], ['сборка покажи кд', 'kd'], ['сборка чертёж', 'kd'],
    ['сборка ещё раз', 'repeat'], ['сборка не годно', 'reject'], ['сборка фото', 'photo'],
  ])('%s → %s', (text, cmd) => expect(parse(text)[0]).toBe(cmd));

  it('без слова-активатора — не команда', () => expect(parse('дальше')).toBeNull());

  it.each([['шесть и восемь', 6.8], ['три', 3], ['двадцать пять', 25], ['1,5', 1.5]])('%s → %f', (w, v) =>
    expect(parseNumber(w.split(' '))).toBeCloseTo(v));

  it('словарь совпадает с ядром (Python)', () => {
    const py = readFileSync(new URL('../../pkg1-sim-vm/core/arcore/voice/commands.py', import.meta.url), 'utf8');
    for (const [cmd, syns] of Object.entries(COMMANDS)) {
      const line = py.split('\n').find((l) => l.trim().startsWith(`"${cmd}":`));
      expect(line, `нет команды ${cmd} в commands.py`).toBeTruthy();
      for (const s of syns) expect(line).toContain(`"${s}"`);
    }
  });
});
