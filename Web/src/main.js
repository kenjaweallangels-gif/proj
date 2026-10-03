// Точка входа браузерной версии «Rakis: Heretics».
// URL-параметры: ?q=low|med|high  &lang=RU|EN  &skip=1 (без титульного экрана)
//                &at=<P2|P4|...|sietch|hall> (старт с точки, отладка)  &autotest=1
import { createGame } from './core/game.js';
import * as zones from './core/zones.js';
import * as desert from './desert/index.js';
import * as sietch from './sietch/index.js';
import * as worm from './worm/index.js';
import * as harvester from './harvester/index.js';
import * as player from './player/index.js';
import * as companions from './player/companions.js';
import * as dialogue from './story/dialogue.js';
import * as story from './story/director.js';
import * as audio from './audio/index.js';
import * as ui from './ui/index.js';
import DATA from './data/data.js';

const params = new URLSearchParams(location.search);
const settings = {
  quality: params.get('q') || (/Mobi|Android/i.test(navigator.userAgent) ? 'low' : 'med'),
  lang: params.get('lang') || undefined,
  skipTitle: params.get('skip') === '1' || params.get('autotest') === '1',
  at: params.get('at') || null,
  autotest: params.get('autotest') === '1',
};

const canvas = document.getElementById('view');
const game = createGame(canvas, settings);
game.data = DATA;
window.__rakis = game; // консоль/автотесты

const steps = [
  ['weather+world', () => desert.create(game)],
  ['sietch', () => sietch.create(game)],
  ['worm', () => worm.create(game)],
  ['harvester', () => harvester.create(game)],
  ['player', () => player.create(game)],
  ['companions', () => companions.create(game)],
  ['zones', () => game.add('zones', zones.create(game))],
  ['dialogue', () => dialogue.create(game)],
  ['story', () => story.create(game)],
  ['audio', () => audio.create(game)],
  ['ui', () => ui.create(game)],
];

const loading = document.getElementById('loading');
async function boot() {
  for (const [name, fn] of steps) {
    if (loading) loading.textContent = `${game.t('Загрузка', 'Loading')}… ${name}`;
    await new Promise((r) => setTimeout(r, 0)); // дать браузеру отрисовать прогресс
    try { fn(); } catch (e) { console.error(`[boot:${name}]`, e); }
  }
  loading?.remove();
  game.bus.emit('boot', settings);
  game.start();
}
boot();
