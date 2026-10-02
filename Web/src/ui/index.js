// game.ui — минималистичный интерфейс (DOM/CSS/SVG поверх канваса) по docs/ui/ui_design.md.
// Титульный экран → событие 'start'; HUD (рябь, засечки, капля, подсказка); субтитры/лай/лор; титры; леттербокс; затемнение;
// пауза (блюр + текстовое меню), фоторежим, концовка.
// API: fade(toBlack, sec)→Promise, titleCard(text, hold), cutCard(text, hold), hint(text), letterbox(b), endCard(),
//      blocking, isFaded, started, photoActive, startGame().
import { CSS } from './css.js';
import { el } from './util.js';
import { loadSettings, menuURL } from './settings.js';
import { createHud } from './hud.js';
import { createOverlays } from './overlays.js';
import { createMenus } from './menus.js';
import { createPhoto } from './photo.js';

export function create(game) {
  loadSettings(game);
  const { bus } = game;
  let host = document.getElementById('ui');
  if (!host) { host = el('div', '', document.body); host.id = 'ui'; host.style.cssText = 'position:fixed;inset:0;pointer-events:none'; }
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const root = el('div', 'rk', host);

  const ctx = {
    started: false, blocking: false,
    titleVisible: !game.settings.skipTitle, pauseOpen: false, endVisible: false, photo: false, cinematic: false,
    actions: {}, applySubtitleSettings,
  };
  function applySubtitleSettings() { host.dataset.sub = game.settings.subSize; host.dataset.bg = game.settings.subBg ? '1' : '0'; }
  function recalc() {
    ctx.blocking = ctx.titleVisible || ctx.pauseOpen || ctx.endVisible || ctx.photo;
    game.input.enabled = !ctx.blocking;
  }
  function scale() { host.style.setProperty('--u', `${Math.max(0.8, innerHeight / 1080)}px`); }
  scale(); addEventListener('resize', scale);
  applySubtitleSettings();

  const overlays = createOverlays(game, root, ctx);
  const hud = createHud(game, root, ctx);
  const menus = createMenus(game, root, ctx);
  const photo = createPhoto(game, root, ctx);
  recalc();

  // ---------- Курсор ----------
  function lock() {
    try { const r = game.renderer.domElement.requestPointerLock?.(); r?.catch?.(() => {}); } catch { /* жест не засчитан */ }
  }
  addEventListener('click', () => {
    if (ctx.started && !ctx.blocking && !game.input.locked && game.settings.lockOnClick !== false) lock();
  });

  // ---------- Старт ----------
  function startGame({ intro = true, lockCursor = true } = {}) {
    if (ctx.started) return;
    ctx.started = true; ctx.titleVisible = false;
    menus.hideTitle(); recalc();
    if (lockCursor) lock();
    if (intro) {
      // Старт уровня: из чёрного за 2.5 с (после 0.3 с паузы).
      overlays.fade(true, 0.45).then(() => new Promise((r) => setTimeout(r, 300))).then(() => overlays.fade(false, 2.5));
    }
    bus.emit('start');
    const at = game.settings.at;
    if (at) setTimeout(() => game.debug?.goto?.(at), 400);
  }

  // ---------- Пауза ----------
  let pauseGuard = 0, lockWas = false;
  function openPause(byLockLoss = false) {
    if (ctx.pauseOpen || ctx.endVisible) return;
    ctx.pauseOpen = true; game.paused = true; recalc();
    pauseGuard = performance.now() + (byLockLoss ? 400 : 120);
    game.input.exitLock();
    menus.openPause();
    game.audio?.event?.('UI.Pause');
    bus.emit('pause', { paused: true });
  }
  function resume() {
    if (!ctx.pauseOpen) return;
    ctx.pauseOpen = false; game.paused = false; recalc();
    menus.closePause();
    lock();
    bus.emit('pause', { paused: false });
  }
  function enterPhoto() {
    if (ctx.photo || !ctx.started || ctx.endVisible) return;
    const fromPause = ctx.pauseOpen;
    if (fromPause) { ctx.pauseOpen = false; game.paused = false; menus.closePause(); bus.emit('pause', { paused: false }); }
    ctx.photoFromPause = fromPause;
    ctx.photo = true; recalc();
    game.input.exitLock();
    root.classList.add('photo');
    photo.enter();
  }
  function exitPhoto() {
    if (!ctx.photo) return;
    photo.exit();
    ctx.photo = false; root.classList.remove('photo'); recalc();
    if (ctx.photoFromPause) { ctx.photoFromPause = false; openPause(); } else lock();
  }
  ctx.actions = {
    start: () => startGame(), resume, photo: enterPhoto, exitPhoto,
    quit: () => { location.href = menuURL(); },
    replay: () => { const u = new URL(menuURL()); u.searchParams.set('skip', '1'); location.href = u.toString(); },
  };

  // ---------- Концовка ----------
  function endCard() {
    if (ctx.endVisible) return;
    ctx.endVisible = true;
    if (ctx.pauseOpen) { ctx.pauseOpen = false; game.paused = false; menus.closePause(); }
    if (ctx.photo) exitPhoto();
    recalc();
    game.input.exitLock();
    const go = () => { overlays.endTitle(game.t('Конец демо', 'End of demo')); menus.showEnd(); };
    if (overlays.faded) setTimeout(go, 400);
    else overlays.fade(true, game.settings.autotest ? 0.4 : 2.5).then(go);
  }

  // ---------- Кинорежим ----------
  let letterExplicit = false, letterShown = false;
  bus.on('cinematic', ({ active } = {}) => { ctx.cinematic = !!active; });

  // ---------- Автоскрытие: 3 с без изменений — внутри виджетов HUD (hud.js) ----------

  bus.on('boot', () => {
    if (game.settings.skipTitle) startGame({ intro: !game.settings.autotest, lockCursor: false });
    else menus.renderTitle();
  });

  const api = {
    alwaysUpdate: true,
    fade: (toBlack, sec = 1) => overlays.fade(toBlack, sec),
    titleCard: (text, hold = 4) => overlays.titleCard(text, hold),
    cutCard: (text, hold = 1.4) => overlays.cutCard(text, hold),
    hint: (text) => overlays.hint(text),
    letterbox(b) { letterExplicit = !!b; },
    endCard, startGame, enterPhoto, exitPhoto, openPause, resume,
    get blocking() { return ctx.blocking; },
    get isFaded() { return overlays.faded; },
    get started() { return ctx.started; },
    get photoActive() { return ctx.photo; },
    get paused() { return ctx.pauseOpen; },
    get ended() { return ctx.endVisible; },
    root,
    update(dt) {
      const inp = game.input;
      if (ctx.started && !ctx.endVisible) {
        const cin = !!game.cinematic?.active;
        const ell = game.story?.ellipsisPhase;
        const busyCut = ell === 'fadingOut' || ell === 'black' || ell === 'fadingIn';
        // Потеря pointer lock = пауза (Esc браузер не отдаёт при захваченном курсоре).
        if (lockWas && !inp.locked && !cin && !ctx.photo && !ctx.pauseOpen && !ctx.titleVisible) openPause(true);
        if (inp.pressed('Pause')) {
          if (ctx.photo) exitPhoto();
          else if (ctx.pauseOpen) { if (performance.now() > pauseGuard) resume(); }
          else if (!cin && !busyCut) openPause();
        } else if (inp.pressed('PhotoMode')) {
          if (ctx.photo) exitPhoto();
          else if (!ctx.blocking && !cin && !busyCut) enterPhoto();
        }
      }
      lockWas = inp.locked;
      // Леттербокс: событие 'cinematic' / game.cinematic.active / явный вызов.
      const want = !!game.cinematic?.active || ctx.cinematic || letterExplicit;
      if (want !== letterShown) { letterShown = want; overlays.letterbox(want); }
      menus.pollPad(dt);
      hud.update(dt);
      overlays.update(dt);
      photo.update(dt);
    },
  };
  return game.add('ui', api);
}
