// Панель «Погода и время» (пункт паузы, клавиши F2 / Y, доступна и с титульного экрана).
// Работает через game.weather (все функции — по feature-detect; чего нет, того в панели нет):
//   setHours(h) / getHours() / hours, timeScale (игровых секунд за реальную секунду; 0 — день и ночь стоят),
//   presets() → [{id, RU, EN}] (запасной вариант: ключи game.data.WeatherPresets), request(id, blendSec),
//   setOverride({wind, storm, dust, haze, clouds}) / clearOverride() / getOverride().
// Ручной выбор ставит флаг game.weatherManual = true: сюжетный директор пропускает SetWeather,
// пока игрок не нажмёт «Вернуть сюжетную погоду» (game.story.restoreWeather()).
import { el } from './util.js';

const FALLBACK_NAMES = {
  Dawn_Ridge: ['Рассвет на гребне', 'Dawn on the ridge'], Morning_Erg: ['Утро в эрге', 'Morning in the erg'],
  Worm_Tension: ['Тяжёлый воздух', 'Heavy air'], Worm_Reveal: ['Явление', 'The arrival'],
  Noon_Approach: ['Полдень', 'Noon'], Storm_Horizon: ['Буря на горизонте', 'Storm on the horizon'],
  Crevice_Shade: ['Тень расщелины', 'Crevice shade'], Sietch_Interior: ['Свет сиетча', 'Sietch light'], Hall_Ritual: ['Зал ритуала', 'Ritual hall'],
};
const SPEEDS = [[60, '1 мин/с', '1 min/s'], [240, '4 мин/с', '4 min/s'], [900, '15 мин/с', '15 min/s'], [3600, '1 ч/с', '1 h/s']];
const QUICK = [[5.5, 'Рассвет', 'Dawn'], [12, 'Полдень', 'Noon'], [17.5, 'Закат', 'Dusk'], [23, 'Ночь', 'Night']];
const SLIDERS = [
  ['wind', 'Ветер', 'Wind', 0, 24, 0.5, (v) => `${v.toFixed(1)} ${'м/с'}`, 'windBase'],
  ['storm', 'Песчаная буря', 'Sandstorm', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`, 'storm'],
  ['dust', 'Пыль', 'Dust', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`, 'dust'],
  ['haze', 'Марево', 'Heat haze', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`, 'haze'],
  ['clouds', 'Облака', 'Clouds', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`, 'clouds'],
];
const fmtTime = (h) => { h = ((h % 24) + 24) % 24; const hh = Math.floor(h), mm = Math.floor((h - hh) * 60); return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`; };

export function createWeatherPanel(game, root, ctx) {
  const tr = (ru, en) => game.t(ru, en);
  const W = () => game.weather;
  const fn = (name) => typeof W()?.[name] === 'function';
  const wrap = el('div', 'wx', root);
  const card = el('div', 'wxc', wrap);
  let rows = [], sel = 0, open = false, dragging = null, lastSpeed = 240;
  const saved = [];
  let onClose = null;

  const hoursNow = () => { const w = W(); return fn('getHours') ? w.getHours() : (typeof w?.hours === 'number' ? w.hours : 12); };
  const presetList = () => {
    if (fn('presets')) { try { const l = W().presets(); if (Array.isArray(l) && l.length) return l; } catch { /* запасной список */ } }
    return Object.keys(game.data?.WeatherPresets || {}).map((id) => ({ id, RU: FALLBACK_NAMES[id]?.[0] || id, EN: FALLBACK_NAMES[id]?.[1] || id }));
  };
  const overrideNow = () => { try { return W()?.getOverride?.() || {}; } catch { return {}; } };

  function markManual() {
    if (game.weatherManual) return;
    game.weatherManual = true;
    game.bus.emit('weather:manual', { on: true });
    syncStatus();
  }

  // ---------- Виджеты ----------
  function slider(parent, { min, max, step, get, set, fmt, rail }) {
    const box = el('div', 'wsl', parent);
    const r = el('div', 'rail', box); if (rail) { r.style.background = rail; r.classList.add('grad'); }
    const fill = el('b', '', r), knob = el('i', '', r);
    const norm = () => (get() - min) / (max - min);
    const apply = (clientX) => {
      const b = r.getBoundingClientRect();
      let v = min + ((clientX - b.left) / b.width) * (max - min);
      v = Math.max(min, Math.min(max, Math.round(v / step) * step));
      set(v);
    };
    box.addEventListener('pointerdown', (e) => { dragging = { apply }; box.setPointerCapture?.(e.pointerId); apply(e.clientX); e.preventDefault(); });
    box.addEventListener('pointermove', (e) => { if (dragging?.apply === apply) apply(e.clientX); });
    const end = () => { if (dragging?.apply === apply) dragging = null; };
    box.addEventListener('pointerup', end); box.addEventListener('pointercancel', end);
    return { update() { const n = Math.max(0, Math.min(1, norm())); fill.style.width = `${n * 100}%`; knob.style.left = `${n * 100}%`; } };
  }
  function chips(parent, items, isOn, pick) {
    const g = el('div', 'wch', parent);
    const nodes = items.map((it, i) => {
      if (i && g.children.length) el('span', 'sep', g, '·');
      const c = el('span', 'ch', g, it.label);
      c.addEventListener('click', (e) => { e.stopPropagation(); pick(it); sync(); });
      return c;
    });
    return { update() { nodes.forEach((c, i) => c.classList.toggle('on', !!isOn(items[i]))); } };
  }

  function build() {
    card.innerHTML = '';
    rows = [];
    el('div', 'cap', card, tr('Погода и время', 'Weather & time'));
    const row = (label, val) => { const r = el('div', 'wrow', card); const h = el('div', 'wh', r); el('span', 'wl', h, label); const v = el('span', 'wv', h, val || ''); return { r, v }; };
    const reg = (o) => { o.node.addEventListener('mouseenter', () => { sel = rows.indexOf(o); markSel(); }); rows.push(o); };

    if (fn('setHours')) {
      const { r, v } = row(tr('Время суток', 'Time of day'));
      const sl = slider(r, {
        min: 0, max: 24, step: 0.05, get: hoursNow, fmt: fmtTime,
        rail: 'linear-gradient(to right,#1c2a48 0%,#1c2a48 18%,#c9783e 26%,#e6cfa0 40%,#e8dcc0 52%,#e6cfa0 64%,#c9633a 76%,#1c2a48 86%,#1c2a48 100%)',
        set: (h) => { W().setHours(h); markManual(); sync(); },
      });
      reg({ node: r, kind: 'slider', step: (d) => { W().setHours(hoursNow() + d * 0.5); markManual(); }, update() { sl.update(); v.textContent = fmtTime(hoursNow()); } });
      const q = el('div', 'wrow sub', card);
      const qc = chips(q, QUICK.map(([h, ru, en]) => ({ id: h, label: tr(ru, en) })), (it) => Math.abs(((hoursNow() - it.id + 36) % 24) - 12) < 0.35, (it) => { W().setHours(it.id); markManual(); });
      reg({ node: q, kind: 'chips', step: (d) => { const hs = QUICK.map((x) => x[0]); const cur = hoursNow(); let i = hs.findIndex((h) => h > cur + 0.01); if (d < 0) { i = hs.length - 1; for (let k = hs.length - 1; k >= 0; k--) if (hs[k] < cur - 0.01) { i = k; break; } if (hs[i] >= cur) i = hs.length - 1; } else if (i < 0) i = 0; W().setHours(hs[i]); markManual(); }, update: qc.update });
    }
    if (typeof W()?.timeScale === 'number') {
      const r = el('div', 'wrow', card);
      const h = el('div', 'wh', r); el('span', 'wl', h, tr('Смена дня и ночи', 'Day & night cycle'));
      const c1 = chips(r, [{ id: 1, label: tr('вкл', 'on') }, { id: 0, label: tr('выкл', 'off') }], (it) => (W().timeScale > 0) === !!it.id, (it) => { if (it.id) W().timeScale = lastSpeed; else { if (W().timeScale > 0) lastSpeed = W().timeScale; W().timeScale = 0; } markManual(); });
      const c2 = chips(r, SPEEDS.map(([v, ru, en]) => ({ id: v, label: tr(ru, en) })), (it) => W().timeScale > 0 && Math.abs(Math.log(W().timeScale / it.id)) < 0.35, (it) => { lastSpeed = it.id; W().timeScale = it.id; markManual(); });
      c2.update(); // стартовое состояние
      reg({
        node: r, kind: 'chips',
        step: (d) => { const on = W().timeScale > 0; if (!on) { W().timeScale = lastSpeed; } else { let i = SPEEDS.findIndex((s) => Math.abs(Math.log(W().timeScale / s[0])) < 0.35); i = Math.max(-1, Math.min(SPEEDS.length, (i < 0 ? 0 : i) + d)); if (i < 0) { lastSpeed = W().timeScale; W().timeScale = 0; } else W().timeScale = SPEEDS[Math.min(i, SPEEDS.length - 1)][0]; } markManual(); },
        update() { c1.update(); c2.update(); },
      });
    }
    const presets = presetList();
    if (presets.length && fn('request')) {
      const r = el('div', 'wrow', card);
      const h = el('div', 'wh', r); el('span', 'wl', h, tr('Погода', 'Weather'));
      const pc = chips(r, presets.map((p) => ({ id: p.id, label: p[game.lang] || p.EN || p.RU || p.id })), (it) => W().current === it.id, (it) => { W().request(it.id, 2); markManual(); });
      reg({ node: r, kind: 'chips', step: (d) => { let i = presets.findIndex((p) => p.id === W().current); i = (i + d + presets.length) % presets.length; W().request(presets[i].id, 2); markManual(); }, update: pc.update });
    }
    if (fn('setOverride')) {
      for (const [key, ru, en, min, max, step, fmt, cur] of SLIDERS) {
        const { r, v } = row(tr(ru, en));
        const get = () => { const o = overrideNow(); const x = o[key] ?? W()?.[cur] ?? 0; return Number.isFinite(x) ? x : 0; };
        const sl = slider(r, { min, max, step, get, fmt, set: (x) => { W().setOverride({ [key]: x }); markManual(); sync(); } });
        reg({ node: r, kind: 'slider', step: (d) => { W().setOverride({ [key]: Math.max(min, Math.min(max, get() + d * (max - min) / 20)) }); markManual(); }, update() { sl.update(); v.textContent = fmt(get()); } });
      }
    }
    const b = el('div', 'wbtns', card);
    const bReset = el('span', 'wbtn', b, tr('Сбросить', 'Reset'));
    const bStory = el('span', 'wbtn', b, tr('Вернуть сюжетную погоду', 'Return to story weather'));
    const doReset = () => { W()?.clearOverride?.(); sync(); };
    const doStory = () => { game.weatherManual = false; W()?.clearOverride?.(); game.story?.restoreWeather?.(); game.bus.emit('weather:manual', { on: false }); syncStatus(); sync(); };
    bReset.addEventListener('click', doReset); bStory.addEventListener('click', doStory);
    if (fn('clearOverride')) reg({ node: bReset, kind: 'button', act: doReset, update() {} }); else bReset.style.display = 'none';
    reg({ node: bStory, kind: 'button', act: doStory, update() {} });
    el('div', 'wst', card);
    el('div', 'wlg', card, game.input?.device === 'pad' ? tr('↑↓ выбор · ←/→ изменить · A применить · B назад', '↑↓ select · ←/→ change · A apply · B back') : tr('↑↓ выбор · ←/→ изменить · Enter применить · Esc / F2 назад', '↑↓ select · ←/→ change · Enter apply · Esc / F2 back'));
    if (!rows.length) el('div', 'wst', card, tr('Модуль погоды пока не предоставляет настроек.', 'The weather module exposes no controls yet.'));
    sel = Math.min(sel, Math.max(0, rows.length - 1));
    markSel(); syncStatus(); sync();
  }
  function markSel() { rows.forEach((o, i) => o.node.classList.toggle('sel', i === sel)); }
  function syncStatus() {
    const s = card.querySelector('.wst');
    if (s && rows.length) s.textContent = game.weatherManual ? tr('Ручной режим: сюжет не меняет погоду.', 'Manual mode: the story will not change the weather.') : tr('Погоду ведёт сюжет.', 'The story drives the weather.');
  }
  function sync() { if (open) for (const o of rows) o.update(); }

  function setBoost(on) {
    if (on) {
      for (const n of ['weather', 'world', 'post']) { const m = game[n]; if (m && typeof m === 'object' && 'update' in m) { saved.push([m, m.alwaysUpdate]); m.alwaysUpdate = true; } }
    } else { for (const [m, v] of saved) m.alwaysUpdate = v; saved.length = 0; }
  }

  const api = {
    get isOpen() { return open; },
    el: wrap,
    /** cb вызывается после закрытия. */
    open(cb) {
      if (open) return; open = true; onClose = cb || null;
      ctx.wxOpen = true; build(); setBoost(true);
      wrap.classList.add('on'); void wrap.offsetWidth; wrap.classList.add('vis');
      game.audio?.event?.('UI.Tick');
    },
    close() {
      if (!open) return; open = false; dragging = null;
      ctx.wxOpen = false; setBoost(false);
      wrap.classList.remove('vis'); setTimeout(() => { if (!open) wrap.classList.remove('on'); }, 220);
      const cb = onClose; onClose = null; cb?.();
    },
    nav(dir) {
      if (!open) return;
      const o = rows[sel];
      if (dir === 'up') sel = (sel + rows.length - 1) % rows.length;
      else if (dir === 'down') sel = (sel + 1) % rows.length;
      else if (dir === 'left' && o?.step) o.step(-1);
      else if (dir === 'right' && o?.step) o.step(1);
      else if (dir === 'ok' && o) { if (o.act) o.act(); else if (o.step) o.step(1); }
      markSel(); sync();
    },
    rebuild() { if (open) build(); },
    update() { if (open && !dragging) sync(); else if (open) sync(); },
  };
  game.bus.on('lang', () => api.rebuild());
  return api;
}
