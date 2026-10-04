// Точка подключения уровневых модулей: подход к входу (level) и сад за Когтем (garden). В main.js — одна строка импорта и один шаг.
import * as approach from './index.js';
import * as garden from '../garden/index.js';

export function create(game) {
  try { approach.create(game); } catch (e) { console.error('[boot:approach]', e); }
  try { garden.create(game); } catch (e) { console.error('[boot:garden]', e); }
}
