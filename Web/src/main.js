// Точка входа браузерной версии «Rakis: Heretics».
// URL-параметры: ?q=low|med|high  &lang=RU|EN  &skip=1 (без титульного экрана)
//                &at=<P2|P4|...|sietch|hall> (старт с точки, отладка)  &autotest=1
import { createGame } from './core/game.js';
import * as zones from './core/zones.js';
import * as desert from './desert/index.js';
import * as sietch from './sietch/index.js';
import * as worm from './worm/index.js';
import * as harvester from './harvester/index.js';
import * as level from './level/all.js';
import * as player from './player/index.js';
import * as companions from './player/companions.js';
import * as freecam from './core/freecam.js';
import * as dialogue from './story/dialogue.js';
import * as story from './story/director.js';
import * as audio from './audio/index.js';
import * as ui from './ui/index.js';
import DATA from './data/data.js';
import { detectQuality } from './core/quality.js';
import { reconcile } from './core/reconcile.js';

const params = new URLSearchParams(location.search);
const settings = {
  // ?q=low|med|high; без параметра — автоподбор по GPU/устройству (см. core/quality.js), дальше работает динамическое разрешение
  quality: ['low', 'med', 'high'].includes(params.get('q')) ? params.get('q') : detectQuality(),
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
  ['level', () => level.create(game)],
  ['player', () => player.create(game)],
  ['companions', () => companions.create(game)],
  ['freecam', () => game.add('freecam', freecam.create(game))],
  ['zones', () => game.add('zones', zones.create(game))],
  ['dialogue', () => dialogue.create(game)],
  ['story', () => story.create(game)],
  ['audio', () => audio.create(game)],
  ['ui', () => ui.create(game)],
];

const loading = document.getElementById('loading');

/**
 * Прогрев шейдеров на экране загрузки (иначе программы для сиетча/сада/червя/пост-проходов компилируются посреди игры
 * и дают подвисания по 100–500 мс). Состояния:
 *  1) как есть (+ пост-проходы, теневые материалы); 2) «всё видимо» (+ реальная отрисовка для теневых программ);
 *  3) сочетания источников света: число видимых огней входит в ключ программы, а огни харвестера (в кадре / нет) и сиетча (близко / нет)
 *     переключаются по ходу игры — без прогрева каждое переключение перекомпилирует все материалы (проверено профайлером);
 *  4) «глубоко в сиетче»: пустыня скрыта, туман снят (тоже ключ программы).
 * Состояния 3–4 идут через compileAsync (параллельная компиляция драйвера, если есть KHR_parallel_shader_compile).
 */
async function warmup() {
  const { scene, renderer, camera } = game;
  // compileAsync с таймаутом: ошибка линковки одной программы не должна вешать загрузку
  const compile = () => Promise.race([renderer.compileAsync(scene, camera), new Promise((r) => setTimeout(r, 30000))]);
  const before = renderer.info.programs?.length ?? 0;
  const t0 = performance.now();
  game.render(0.016);
  const hidden = [];
  scene.traverse((o) => { if (!o.visible && o !== scene) hidden.push(o); });
  for (const o of hidden) o.visible = true;
  try { game.render(0.016); await compile(); } finally { for (const o of hidden) o.visible = false; }
  const lightsOf = (name) => { const out = []; scene.traverse((o) => { if (o.isLight) for (let p = o; p; p = p.parent) if (p.name === name) { out.push(o); break; } }); return out; };
  const hl = lightsOf('Harvester'), sr = game.sietch?.root;
  const hv = hl.map((l) => l.visible), sv = sr?.visible;
  try {
    for (const hOn of [true, false]) for (const sOn of [false, true]) {
      hl.forEach((l) => { l.visible = hOn; }); if (sr) sr.visible = sOn;
      await compile();
    }
  } finally { hl.forEach((l, i) => { l.visible = hv[i]; }); if (sr) sr.visible = sv; }
  const sWas = sr?.visible, spWas = game.space;
  if (sr && game.world?.setVisible) {
    try { game.world.setVisible(false); sr.visible = true; game.space = 'sietch'; game.render(0.016); await compile(); }
    finally { game.world.setVisible(true); sr.visible = sWas; game.space = spWas; }
  }
  game.render(0.016);
  renderer.info.reset();
  game.warmup = { ms: Math.round(performance.now() - t0), programsBefore: before, programs: renderer.info.programs?.length ?? 0 };
  console.info(`[warmup] ${game.warmup.ms} ms, programs ${before} → ${game.warmup.programs}`);
}
async function boot() {
  for (const [name, fn] of steps) {
    if (loading) loading.textContent = `${game.t('Загрузка', 'Loading')}… ${name}`;
    await new Promise((r) => setTimeout(r, 0)); // дать браузеру отрисовать прогресс
    try { fn(); } catch (e) { console.error(`[boot:${name}]`, e); }
  }
  try { reconcile(game); } catch (e) { console.warn('[reconcile]', e); }
  if (params.get('warm') === '1' || (params.get('warm') !== '0' && !settings.autotest)) {
    if (loading) loading.textContent = `${game.t('Загрузка', 'Loading')}… ${game.t('шейдеры', 'shaders')}`;
    await new Promise((r) => setTimeout(r, 0));
    try { await warmup(); } catch (e) { console.warn('[warmup]', e); }
  }
  loading?.remove();
  game.bus.emit('boot', settings);
  game.start();
}
boot();
