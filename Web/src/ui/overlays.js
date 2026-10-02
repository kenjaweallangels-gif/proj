// Слои поверх игры: субтитры, лай (над головой), надпись-лор, титры глав, титр-склейка, подсказка, леттербокс, затемнение, концовка.
// Тайминги — docs/ui/ui_design.md §7. Всё, что привязано к диалогу, живёт в игровом времени (замирает на паузе).
import { el, wait } from './util.js';

const NO_NAME = ['Crowd', 'Lore'];

export function createOverlays(game, root, ctx) {
  const { bus } = game;
  const THREE = game.THREE;

  // ---------- Субтитры ----------
  const subs = el('div', 'subs', root);
  const inner = el('div', 'inner', subs);
  const nameEl = el('div', 'name txt', inner);
  const lineEl = el('div', 'line txt', inner);
  let subUntil = 0;
  function showSubtitle(e) {
    nameEl.textContent = NO_NAME.includes(e.speaker) ? '' : (e.name || '');
    nameEl.style.display = nameEl.textContent ? '' : 'none';
    lineEl.textContent = e.text;
    subs.classList.add('on');
    subUntil = game.time + (e.duration || 3) + 1.5;
  }
  function hideSubtitle() { subs.classList.remove('on'); subUntil = 0; }

  // ---------- Лай (над головой говорящего) ----------
  const barks = [];
  const v = new THREE.Vector3();
  function bark(e) {
    if (barks.length >= 3) { const old = barks.shift(); old.el.remove(); }
    const n = el('div', 'bark txt', root, e.text);
    const b = { el: n, pos: e.pos ? new THREE.Vector3(e.pos.x, e.pos.y ?? 0, e.pos.z) : null, until: game.time + (e.duration || 3), shown: false, closing: false };
    barks.push(b);
    requestAnimationFrame(() => requestAnimationFrame(() => { b.shown = true; }));
  }
  function updateBarks() {
    const W = innerWidth, H = innerHeight, p = game.player?.position;
    for (let i = barks.length - 1; i >= 0; i--) {
      const b = barks[i];
      if (!b.closing && game.time > b.until) { b.closing = true; b.el.classList.add('out'); b.el.style.opacity = '0'; setTimeout(() => b.el.remove(), 600); }
      if (b.closing && !b.el.isConnected) { barks.splice(i, 1); continue; }
      let x = W / 2, y = H * 0.78, a = 0.6;
      if (b.pos) {
        v.copy(b.pos); v.y += 1.8;
        const d = p ? p.distanceTo(b.pos) : 0;
        a = 0.6 * Math.max(0, Math.min(1, 1 - (d - 3) / 8));
        v.project(game.camera);
        let nx = v.x, ny = v.y;
        if (v.z > 1) { nx = -nx; ny = -ny; if (Math.abs(nx) < 0.3) nx = nx < 0 ? -0.9 : 0.9; }   // за спиной — к краю
        x = (nx * 0.5 + 0.5) * W; y = (-ny * 0.5 + 0.5) * H;
        x = Math.max(W * 0.1, Math.min(W * 0.9, x)); y = Math.max(H * 0.1, Math.min(H * 0.9, y));
      }
      b.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
      if (!b.closing) b.el.style.opacity = b.shown ? String(a.toFixed(3)) : '0';
    }
  }

  // ---------- Лор-надпись ----------
  const lore = el('div', 'lore txt', root);
  let loreUntil = 0, loreShown = false;
  function showLore(e) {
    lore.textContent = e.text;
    lore.style.transition = 'opacity .8s ease-out';
    lore.style.opacity = '1'; loreShown = true;
    loreUntil = game.time + (e.duration || 5);
  }

  // ---------- Титры глав (очередь) ----------
  const tcard = el('div', 'tcard', root);
  const tText = el('div', 't txt', tcard);
  el('div', 'rule', tcard);
  const tq = []; let tBusy = false;
  async function runTitles() {
    if (tBusy) return;
    tBusy = true;
    while (tq.length) {
      const { text, hold, end } = tq.shift();
      tText.textContent = text;
      tcard.classList.toggle('end', !!end);
      tcard.querySelector('.rule').style.display = end ? 'none' : '';
      tcard.style.transition = 'opacity 1.2s ease-out'; tcard.style.opacity = '1';
      game.audio?.event?.('UI.TitleCard');
      await wait(1.2 + hold);
      if (end) break;                                   // концовка остаётся
      tcard.style.transition = 'opacity 1.6s linear'; tcard.style.opacity = '0';
      await wait(1.6);
    }
    tBusy = false;
  }
  function titleCard(text, hold = 4) {
    if (!text) return;
    tq.push({ text: typeof text === 'object' ? game.t(text) : text, hold });
    runTitles();
  }

  // ---------- Титр-склейка поверх чёрного ----------
  const cut = el('div', 'cut txt', root);
  async function cutCard(text, hold = 1.4) {
    cut.textContent = typeof text === 'object' ? game.t(text) : text;
    cut.style.transition = 'opacity .5s ease-out'; cut.style.opacity = '1';
    await wait(0.5 + hold);
    cut.style.transition = 'opacity .6s linear'; cut.style.opacity = '0';
    await wait(0.6);
  }

  // ---------- Подсказка ----------
  const hintEl = el('div', 'hint txt', root);
  let hintToken = 0;
  async function hint(text) {
    if (!text) return;
    const s = typeof text === 'object' ? game.t(text) : String(text);
    const my = ++hintToken;
    hintEl.textContent = s;
    hintEl.style.transition = 'opacity .5s ease-out'; hintEl.style.opacity = '1';
    game.audio?.event?.('UI.Hint');
    await wait(0.5 + Math.max(4, Math.min(8, 0.06 * s.length + 2.5)));
    if (my !== hintToken) return;                       // заменена новой
    hintEl.style.transition = 'opacity .9s linear'; hintEl.style.opacity = '0';
  }

  // ---------- Леттербокс ----------
  const barTop = el('div', 'bar top', root), barBot = el('div', 'bar bot', root);
  let letter = false;
  function layoutBars() {
    const h = Math.max(0, (innerHeight - innerWidth / 2.35) / 2);
    barTop.style.height = barBot.style.height = `${h}px`;
    root.style.setProperty('--sub-bottom', letter && h > 0 ? `${Math.max(12, h * 0.5 - 38)}px` : '');
    root.style.setProperty('--hint-top', letter && h > 0 ? `${h + 24}px` : '');
  }
  function letterbox(on) { letter = !!on; layoutBars(); barTop.classList.toggle('on', letter); barBot.classList.toggle('on', letter); }
  addEventListener('resize', layoutBars);
  layoutBars();

  // ---------- Затемнение ----------
  const fadeEl = el('div', 'fade', root);
  let faded = false, fadeToken = 0;
  function fade(toBlack, sec = 1) {
    faded = !!toBlack;
    const my = ++fadeToken;
    fadeEl.style.transition = sec > 0 ? `opacity ${sec}s linear` : 'none';
    // принудительный reflow, чтобы переход стартовал
    void fadeEl.offsetWidth;
    fadeEl.style.opacity = toBlack ? '1' : '0';
    return new Promise((res) => setTimeout(() => res(my === fadeToken), Math.max(0, sec) * 1000));
  }

  // ---------- Подписки ----------
  bus.on('subtitle', (e) => {
    if (!e) return;
    if (e.kind === 'bark') bark(e);
    else if (e.kind === 'lore') showLore(e);
    else showSubtitle(e);
  });
  bus.on('chain:end', () => hideSubtitle());
  bus.on('dialogue:stop', () => hideSubtitle());
  bus.on('lang', () => { /* текущие строки остаются; следующие придут на новом языке */ });

  return {
    titleCard, cutCard, hint, letterbox, fade, showLore,
    get faded() { return faded; },
    get letterboxed() { return letter; },
    el: { subs, lore, tcard, hintEl, fadeEl },
    /** Показать концовку (затемнение → титр «Конец демо»); меню — в ui/index.js. */
    endTitle(text) { tq.length = 0; tq.push({ text, hold: 5, end: true }); runTitles(); },
    update() {
      updateBarks();
      if (subUntil && game.time > subUntil) hideSubtitle();
      if (loreShown && game.time > loreUntil) { loreShown = false; lore.style.transition = 'opacity 1.2s linear'; lore.style.opacity = '0'; }
    },
  };
}
