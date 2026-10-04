// Меню: титульный экран, пауза, концовка. Только текст и тонкие линии. Навигация: мышь, клавиатура, геймпад.
import { el } from './util.js';
import { saveSettings, setLang, setVoiceMode, VOICE_MODES } from './settings.js';

const SUB_STATES = [['S', false], ['M', false], ['L', false], ['S', true], ['M', true], ['L', true]];
const QUALITIES = ['low', 'med', 'high'];

export function createMenus(game, root, ctx) {
  const tr = (ru, en) => game.t(ru, en);
  const S = game.settings;

  const subIndex = () => SUB_STATES.findIndex(([s, b]) => s === S.subSize && b === !!S.subBg);
  function cycleSubs(dir) {
    const i = (subIndex() + dir + SUB_STATES.length) % SUB_STATES.length;
    [S.subSize, S.subBg] = SUB_STATES[i];
    saveSettings(game); ctx.applySubtitleSettings();
  }
  const VOICE_LABEL = { auto: ['Живой голос', 'Natural voice'], tts: ['Арабский TTS', 'Arabic TTS'], synth: ['Синтезатор (запасной)', 'Synth (fallback)'], off: ['выкл', 'off'] };
  const voiceLabel = (m) => tr(...VOICE_LABEL[m]);
  function cycleVoice(dir) { const i = VOICE_MODES.indexOf(S.voiceMode); setVoiceMode(game, VOICE_MODES[(i + dir + VOICE_MODES.length) % VOICE_MODES.length]); }
  function toggleNative() { S.showNative = !S.showNative; saveSettings(game); }
  function setVol(name, v) { v = Math.max(0, Math.min(1, v)); game.audio?.setVolume?.(name, v); S.volume[name] = v; saveSettings(game); }

  // ===================== Титульный экран =====================
  const title = el('div', 'title', root);
  const logo = el('div', 'logo', title);
  el('div', 'name', logo, 'RAKIS');
  el('div', 'rule', logo);
  el('div', 'sub', logo, 'HERETICS');
  const begin = el('div', 'begin', title);
  const beginA = el('div', 'a txt', begin), beginB = el('div', 'b txt', begin);
  const opts = el('div', 'opts', title);
  const keys = el('div', 'keys', title);
  opts.addEventListener('click', (e) => e.stopPropagation());

  function chips(parent, label, items, current, onPick) {
    const g = el('div', 'opt', parent);
    el('span', '', g, label);
    items.forEach((it, i) => {
      if (i) el('span', 'sep', g, '·');
      const c = el('span', `ch${it.id === current ? ' on' : ''}`, g, it.label);
      c.addEventListener('click', (e) => { e.stopPropagation(); onPick(it.id); renderTitle(); });
    });
  }
  function renderTitle() {
    beginA.textContent = tr('Нажмите, чтобы начать', 'Click to begin');
    beginB.textContent = tr('Click to begin', 'Нажмите, чтобы начать');
    opts.innerHTML = '';
    chips(opts, tr('Язык', 'Language'), [{ id: 'RU', label: 'RU' }, { id: 'EN', label: 'EN' }], game.lang, (v) => setLang(game, v));
    chips(opts, tr('Качество', 'Quality'), QUALITIES.map((q) => ({ id: q, label: q })), game.settings.quality, (q) => {
      if (q === game.settings.quality) return;
      const u = new URL(location.href); u.searchParams.set('q', q); u.searchParams.set('lang', game.lang);
      location.href = u.toString();
    });
    chips(opts, tr('Субтитры', 'Subtitles'), ['S', 'M', 'L'].map((s) => ({ id: s, label: s })), S.subSize, (s) => { S.subSize = s; saveSettings(game); ctx.applySubtitleSettings(); });
    chips(opts, tr('Голос', 'Voice'), ['auto', 'synth', 'off'].map((m) => ({ id: m, label: voiceLabel(m) })), S.voiceMode === 'tts' ? 'auto' : S.voiceMode, (m) => setVoiceMode(game, m));
    if (ctx.actions.weather) {
      const g = el('div', 'opt', opts);
      const c = el('span', 'ch wxlink', g, tr('Погода и время', 'Weather & time')); c.title = 'F2';
      c.addEventListener('click', (e) => { e.stopPropagation(); ctx.actions.weather(); });
    }
    const K = (k) => `<span class="kcap">${k}</span>`;
    keys.innerHTML = [
      `<span>${K('W')}${K('A')}${K('S')}${K('D')} ${tr('движение', 'move')}</span>`,
      `<span>${K('C')} ${tr('режим походки: обычный / по песку', 'gait: normal / sand-walk')}</span>`,
      `<span>${K('Alt')} ${tr('походка по песку (удерживать)', 'sand-walk (hold)')}</span>`,
      `<span>${K('Space')} ${tr('прыжок (в шаге пустыни — сбить ритм)', 'jump (sand-walk: break rhythm)')}</span>`,
      `<span>${K('E')} ${tr('действие', 'interact')}</span>`,
      `<span>${K('V')} ${tr('камера', 'camera')}</span>`,
      `<span>${K('F2')} ${tr('погода и время', 'weather & time')}</span>`,
      `<span>${K('Esc')} ${tr('пауза', 'pause')}</span>`,
    ].join('');
  }
  title.addEventListener('click', () => { if (ctx.titleVisible) ctx.actions.start(); });
  function hideTitle() { title.classList.add('gone'); setTimeout(() => { title.style.display = 'none'; }, 1000); }

  // ===================== Пауза =====================
  const pause = el('div', 'pause', root);
  const menu = el('div', 'menu', pause);
  const capEl = el('div', 'cap', menu);
  const list = el('div', 'list', menu);
  const legend = el('div', 'legend', menu);
  let items = [], sel = 0, view = 'main';   // view: 'main' | 'scenarios'

  const volBar = (name) => ({ bar: () => S.volume[name], step: (d) => setVol(name, S.volume[name] + d * 0.1), set: (v) => setVol(name, v) });
  // Сценарии: запуск отдельных сцен и быстрые переходы для тестирования. Меню закрывается, затем действие выполняется.
  const SCENARIOS = [
    { id: 'devour', ru: 'Червь пожирает харвестер', en: 'The worm takes the harvester', run: () => game.debug?.devour?.() },
  ];
  const TRAVEL = [
    ['start', 'Старт · гребень', 'Start · the ridge'], ['erg', 'Эрг', 'The erg'], ['trail', 'Тропа по уступам', 'Ledge trail'],
    ['cleft', 'Скрытая щель', 'Hidden cleft'], ['market', 'Рынок сиетча', 'Sietch market'], ['hall', 'Зал собраний', 'Assembly hall'],
    ['garden', 'Тайный сад', 'Hidden garden'],
  ];
  function runAndClose(fn) { view = 'main'; ctx.actions.resume(); setTimeout(() => { try { fn(); } catch (e) { console.error('[menu] сценарий:', e); } }, 60); }
  function buildScenarioItems() {
    items = [
      { id: 'back', label: tr('← Назад', '← Back'), act: () => { view = 'main'; sel = 0; renderPause(); } },
      ...SCENARIOS.map((sc) => ({ id: `sc_${sc.id}`, label: tr(sc.ru, sc.en), act: () => runAndClose(sc.run) })),
      ...TRAVEL.map(([id, ru, en]) => ({ id: `go_${id}`, label: tr('Перейти: ', 'Go to: ') + tr(ru, en), act: () => runAndClose(() => game.debug?.goto?.(id)) })),
    ];
  }
  function buildItems() {
    if (view === 'scenarios') { buildScenarioItems(); return; }
    items = [
      { id: 'resume', label: tr('Продолжить', 'Resume'), act: () => ctx.actions.resume() },
      { id: 'photo', label: tr('Фоторежим', 'Photo mode'), act: () => ctx.actions.photo() },
      { id: 'scenarios', label: tr('Сценарии / Scenarios', 'Scenarios / Сценарии'), act: () => { view = 'scenarios'; sel = 1; renderPause(); } },
      { id: 'lang', label: tr('Язык', 'Language'), val: () => (game.lang === 'RU' ? 'Русский' : 'English'), step: () => setLang(game, game.lang === 'RU' ? 'EN' : 'RU') },
      { id: 'subs', label: tr('Субтитры', 'Subtitles'), val: () => S.subSize + (S.subBg ? tr(' · подложка', ' · backing') : ''), step: (d) => cycleSubs(d) },
      { id: 'wx', label: tr('Погода и время', 'Weather & time'), act: () => ctx.actions.weather?.() },
      { id: 'voice', label: tr('Голос', 'Voice'), val: () => voiceLabel(S.voiceMode), step: (d) => cycleVoice(d) },
      { id: 'native', label: tr('Родная строка в субтитрах', 'Native line in subtitles'), val: () => (S.showNative ? tr('вкл', 'on') : tr('выкл', 'off')), step: toggleNative },
      { id: 'vo', label: tr('Громкость голосов', 'Voices volume'), ...volBar('vo') },
      { id: 'vol', label: tr('Громкость', 'Volume'), ...volBar('master') },
      { id: 'music', label: tr('Музыка', 'Music'), ...volBar('music') },
      { id: 'sfx', label: tr('Эффекты', 'Effects'), ...volBar('sfx') },
      { id: 'quit', label: tr('Выход в меню', 'Quit to menu'), act: () => ctx.actions.quit() },
    ];
  }
  function renderPause() {
    buildItems();
    capEl.textContent = view === 'scenarios' ? tr('Сценарии', 'Scenarios') : tr('Пауза', 'Paused');
    list.innerHTML = '';
    items.forEach((it, i) => {
      const row = el('div', `item${i === sel ? ' sel' : ''}`, list);
      el('span', 'lab', row, it.label);
      if (it.val) el('span', 'val', row, it.val());
      if (it.bar) {
        const vb = el('span', 'vbar', row); const b = el('b', '', vb); b.style.width = `${Math.round(it.bar() * 100)}%`;
        vb.addEventListener('click', (e) => { e.stopPropagation(); const r = vb.getBoundingClientRect(); it.set(Math.round(((e.clientX - r.left) / r.width) * 10) / 10); renderPause(); });
      }
      row.addEventListener('mouseenter', () => { if (sel !== i) { sel = i; markSel(); } });
      row.addEventListener('click', () => { sel = i; activate(1); });
    });
    const pad = game.input?.device === 'pad';
    legend.textContent = pad ? tr('↑↓ выбор · A выбрать · B назад', '↑↓ select · A confirm · B back') : tr('↑↓ выбор · Enter выбрать · ←/→ изменить · Esc назад', '↑↓ select · Enter confirm · ←/→ change · Esc back');
  }
  function markSel() { [...list.children].forEach((c, i) => c.classList.toggle('sel', i === sel)); }
  function activate(dir) {
    const it = items[sel];
    if (!it) return;
    if (it.act) it.act();
    else if (it.step) { it.step(dir); renderPause(); }
  }
  function openPause() {
    sel = 0; view = 'main'; pause.classList.remove('wxonly'); renderPause();
    pause.classList.remove('closing'); pause.classList.add('on');
    void pause.offsetWidth; pause.classList.add('vis');
  }
  function closePause() {
    pause.classList.add('closing'); pause.classList.remove('vis');
    setTimeout(() => { if (!pause.classList.contains('vis')) pause.classList.remove('on'); }, 220);
  }
  /** Навигация: dir = 'up'|'down'|'left'|'right'|'ok'. */
  function nav(dir) {
    if (ctx.wxOpen) { ctx.wx?.nav(dir); return; }
    if (ctx.pauseOpen) {
      if (dir === 'up') sel = (sel + items.length - 1) % items.length;
      else if (dir === 'down') sel = (sel + 1) % items.length;
      else if (dir === 'left') { const it = items[sel]; if (it.step) { it.step(-1); renderPause(); return; } }
      else if (dir === 'right') { const it = items[sel]; if (it.step) { it.step(1); renderPause(); return; } }
      else if (dir === 'ok') { activate(1); return; }
      markSel();
      game.audio?.event?.('UI.Tick');
    } else if (ctx.endVisible) {
      if (dir === 'left' || dir === 'up') endSel = (endSel + endActs.length - 1) % endActs.length;
      else if (dir === 'right' || dir === 'down') endSel = (endSel + 1) % endActs.length;
      else if (dir === 'ok') { endActs[endSel].fn(); return; }
      markEnd();
    } else if (ctx.titleVisible && dir === 'ok') ctx.actions.start();
  }

  // ===================== Концовка =====================
  const endEl = el('div', 'endcard', root);
  const thanks = el('div', 'thanks txt', endEl);
  const actions = el('div', 'actions', endEl);
  let endActs = [], endSel = 0;
  function markEnd() { [...actions.children].forEach((c, i) => c.classList.toggle('sel', i === endSel)); }
  function showEnd() {
    endEl.classList.add('on');
    thanks.textContent = tr('Спасибо, что прошли путь до Глотки Бога.', 'Thank you for walking the road to the Throat of God.');
    actions.innerHTML = '';
    endActs = [
      { label: tr('Начать заново', 'Play again'), fn: () => ctx.actions.replay() },
      { label: tr('Выход в меню', 'Quit to menu'), fn: () => ctx.actions.quit() },
    ];
    endSel = 0;
    endActs.forEach((a, i) => {
      const n = el('div', 'act', actions, a.label);
      n.addEventListener('mouseenter', () => { endSel = i; markEnd(); });
      n.addEventListener('click', a.fn);
    });
    markEnd();
    setTimeout(() => thanks.classList.add('vis'), 3500);
    setTimeout(() => actions.classList.add('vis'), 5200);
  }

  // ===================== Клавиатура и геймпад =====================
  addEventListener('keydown', (e) => {
    // Погода и время: F2 / Y (на титульном экране, в игре и из паузы); Esc закрывает панель.
    if ((e.code === 'F2' || e.code === 'KeyY') && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); ctx.actions.weatherToggle?.(); return; }
    if (e.code === 'Escape' && ctx.wxOpen && ctx.titleVisible && !e.repeat) { e.preventDefault(); ctx.actions.weatherToggle?.(); return; }
    if (e.repeat && !(ctx.pauseOpen || ctx.wxOpen)) return;
    if (!ctx.titleVisible && !ctx.pauseOpen && !ctx.endVisible) return;
    const map = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', Enter: 'ok', Space: 'ok', NumpadEnter: 'ok' };
    const d = map[e.code];
    if (!d) return;
    if (ctx.titleVisible && !ctx.wxOpen && d !== 'ok') return;
    e.preventDefault();
    nav(d);
  });
  const padPrev = {}; let padRepeat = 0;
  function pollPad(dt) {
    const gp = navigator.getGamepads?.()[0];
    if (!gp || !(ctx.pauseOpen || ctx.titleVisible || ctx.endVisible || ctx.wxOpen)) return;
    const b = (i) => !!gp.buttons[i]?.pressed;
    const ay = gp.axes[1] || 0, ax = gp.axes[0] || 0;
    const now = { up: b(12) || ay < -0.6, down: b(13) || ay > 0.6, left: b(14) || ax < -0.6, right: b(15) || ax > 0.6, ok: b(0), back: b(1) || b(9) };
    padRepeat -= dt;
    for (const k of Object.keys(now)) {
      const edge = now[k] && !padPrev[k];
      const rep = now[k] && padRepeat <= 0 && (k === 'up' || k === 'down');
      if (edge || rep) {
        if (k === 'back') { if (ctx.wxOpen) ctx.actions.weatherToggle?.(); else if (ctx.pauseOpen && !back()) ctx.actions.resume(); }
        else nav(k);
        padRepeat = edge ? 0.35 : 0.12;
      }
      padPrev[k] = now[k];
    }
  }

  renderTitle();
  if (!ctx.titleVisible) title.style.display = 'none';
  game.bus.on('lang', () => { renderTitle(); if (ctx.pauseOpen) renderPause(); });
  function setWxMode(on) { pause.classList.toggle('wxonly', !!on); }
  /** Esc / B в подменю — назад к паузе. true, если подменю было открыто. */
  function back() { if (view === 'main') return false; view = 'main'; sel = 0; renderPause(); return true; }
  return { back, setWxMode, openPause, closePause, hideTitle, showEnd, renderTitle, renderPause, pollPad, nav, el: { title, pause, endEl } };
}
