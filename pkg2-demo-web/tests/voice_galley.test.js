import { describe, expect, it } from 'vitest';
import { PHRASES, parseCode, parseGalley, parseNumber } from '../src/galley/voice_cmd.js';
import { searchDocs } from '../src/galley/catalog.js';

const P = (t, o) => parseGalley(t, o);

describe('голос КМ-2: числа', () => {
  it('цифры и слова', () => {
    expect(parseNumber(['1105'])).toBe(1105);
    expect(parseNumber(['тысяча', 'сто', 'пять'])).toBe(1105);
    expect(parseNumber(['три', 'и', 'две'])).toBe(3.2);
    expect(parseNumber(['один', 'и', 'шесть', 'десятых'])).toBeCloseTo(1.6);
    expect(parseNumber(['триста', 'двадцать'])).toBe(320);
    expect(parseNumber(['две', 'тысячи', 'пятьдесят'])).toBe(2050);
    expect(parseNumber(['полтора'])).toBe(1.5);
    expect(parseNumber(['лист'])).toBeNull();
  });

  it('чертёжный номер голосом', () => {
    expect(parseCode(['ка', 'эм', 'два', 'сто', 'пятьдесят'])).toBe('КМ2.150');
    expect(parseCode(['км', '2', '150', '000'])).toBe('КМ2.150.000');
    expect(parseCode(['ка', 'эм', 'два', 'ноль', 'ноль', 'ноль'])).toBe('КМ2.000');
    expect(searchDocs(parseCode(['ка', 'эм', 'два', 'сто', 'пятьдесят']))[0].code).toBe('КМ2.150.000');
  });
});

describe('голос КМ-2: команды', () => {
  it('без слова активации — только в режиме «слушаю»', () => {
    expect(P('дальше')).toBeNull();
    expect(P('дальше', { requireWake: false })).toEqual({ cmd: 'next', arg: null });
    expect(P('Сборка, дальше!')).toEqual({ cmd: 'next', arg: null });
    expect(P('окей сборка назад')).toEqual({ cmd: 'prev', arg: null });
    expect(P('сборка')).toEqual({ cmd: 'listen', arg: null });
  });

  it('значения контроля', () => {
    expect(P('сборка значение тысяча сто пять')).toEqual({ cmd: 'value', arg: 1105 });
    expect(P('сборка 1700,4')).toEqual({ cmd: 'value', arg: 1700.4 });
    expect(P('сборка момент один и шесть десятых').arg).toBeCloseTo(1.6);
    expect(P('сборка три и две')).toEqual({ cmd: 'value', arg: 3.2 });
  });

  it('КД: лист, зона, зум, контур', () => {
    expect(P('сборка покажи чертёж')).toEqual({ cmd: 'open_kd', arg: null });
    expect(P('сборка лист два')).toEqual({ cmd: 'kd_sheet', arg: 2 });
    expect(P('сборка следующий лист')).toEqual({ cmd: 'kd_next', arg: null });
    expect(P('сборка зона б три')).toEqual({ cmd: 'kd_zone', arg: 'B3' });
    expect(P('сборка увеличь')).toEqual({ cmd: 'zoom_in', arg: null });
    expect(P('сборка наложи чертёж')).toEqual({ cmd: 'overlay', arg: null });
  });

  it('поиск, окна, сообщение, затемнение', () => {
    expect(P('сборка найди ка эм два сто пятьдесят')).toEqual({ cmd: 'search', arg: 'КМ2.150' });
    expect(P('сборка закрой чат')).toEqual({ cmd: 'close', arg: 'task' });
    expect(P('сборка сообщение нет винтов м4')).toEqual({ cmd: 'message', arg: 'нет винтов м4' });
    expect(P('сборка затемнение авто').cmd).toBe('dim_auto');
    expect(P('сборка вызови мастера').cmd).toBe('call');
    expect(P('сборка сколько осталось').cmd).toBe('timer');
  });

  it('каждая фраза-подсказка распознаётся', () => {
    for (const p of PHRASES) expect(P(p), p).not.toBeNull();
  });

  it('посторонняя речь в цеху не даёт команд', () => {
    expect(P('сборка как дела у тебя')).toBeNull();
    expect(P('принеси ключ на десять')).toBeNull();
  });
});

describe('голос: имитация и очки', () => {
  it('команды имитации, центрирования и выбора очков', async () => {
    const { parseGalley } = await import('../src/galley/voice_cmd.js');
    expect(parseGalley('сборка запусти сборку')).toEqual({ cmd: 'auto_start', arg: null });
    expect(parseGalley('сборка пауза')).toEqual({ cmd: 'auto_pause', arg: null });
    expect(parseGalley('сборка стоп имитация')).toEqual({ cmd: 'auto_stop', arg: null });
    expect(parseGalley('сборка стоп')).toEqual({ cmd: 'stop', arg: null });
    expect(parseGalley('сборка по центру')).toEqual({ cmd: 'recenter', arg: null });
    expect(parseGalley('сборка очки иксреал аура')).toEqual({ cmd: 'device', arg: 'иксреал аура' });
  });
});

describe('голос: свободное движение и алгоритм в углу', () => {
  it('команды', async () => {
    const { parseGalley } = await import('../src/galley/voice_cmd.js');
    expect(parseGalley('сборка хожу сам')).toEqual({ cmd: 'auto_free', arg: null });
    expect(parseGalley('сборка веди меня')).toEqual({ cmd: 'auto_guide', arg: null });
    expect(parseGalley('сборка алгоритм в угол')).toEqual({ cmd: 'corner', arg: null });
    expect(parseGalley('сборка дальше')).toEqual({ cmd: 'next', arg: null });
  });
});
