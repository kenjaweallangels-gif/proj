/**
 * Sound settings block for the start / pause menu: master, music (with on / off), effects, ambience, radio and
 * interface volumes, mute. Values live in Audio.settings (persisted in localStorage by the Audio module).
 *   buildAudioSettings(audio) -> { el, refresh() }
 */
const ROWS = [
  ['master', 'Общая'],
  ['music', 'Музыка'],
  ['sfx', 'Эффекты'],
  ['ambience', 'Окружение'],
  ['voice', 'Радио'],
  ['ui', 'Интерфейс'],
];

function mk(tag, cls, text, css) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  if (css) e.style.cssText = css;
  return e;
}

export function buildAudioSettings(audio) {
  const root = mk('div', 'menu-field audio-settings');
  const head = mk('label');
  head.append(mk('span', '', 'ЗВУК'), mk('span', '', 'M — вкл / выкл'));
  root.append(head);
  const grid = mk('div', '', null, 'display:grid;grid-template-columns:74px 1fr 34px;align-items:center;column-gap:8px;row-gap:3px;font-size:11px;color:var(--dim)');
  const inputs = {};
  const vals = {};
  for (const [key, label] of ROWS) {
    const name = mk('span', '', label);
    const r = mk('input'); r.type = 'range'; r.min = '0'; r.max = '1'; r.step = '0.05';
    r.setAttribute('aria-label', `Громкость: ${label}`);
    const v = mk('span', '', '', 'text-align:right;font-variant-numeric:tabular-nums');
    r.addEventListener('input', () => { audio.setVolume?.(key, parseFloat(r.value)); v.textContent = `${Math.round(parseFloat(r.value) * 100)}%`; });
    grid.append(name, r, v);
    inputs[key] = r; vals[key] = v;
  }
  root.append(grid);
  const row = mk('div', 'menu-note', null, 'display:flex;gap:6px;flex-wrap:wrap;margin-top:4px');
  const btnCss = 'padding:4px 10px;background:rgba(12,24,40,.6);border:1px solid var(--line);border-radius:2px;font-size:11px;color:inherit;cursor:pointer';
  const mute = mk('button', 'btn-s', '', btnCss); mute.type = 'button';
  const music = mk('button', 'btn-s', '', btnCss); music.type = 'button';
  const now = mk('span', '', '', 'align-self:center;opacity:.8');
  mute.addEventListener('click', () => { try { audio.muted = !audio.muted; } catch (_) { /* stub */ } refresh(); });
  music.addEventListener('click', () => { try { audio.setMusicEnabled?.(!audio.musicEnabled); } catch (_) { /* stub */ } refresh(); });
  row.append(mute, music, now);
  root.append(row);

  function refresh() {
    const s = audio.settings || {};
    for (const [key] of ROWS) {
      const x = typeof s[key] === 'number' ? s[key] : 1;
      if (document.activeElement !== inputs[key]) inputs[key].value = String(x);
      vals[key].textContent = `${Math.round(x * 100)}%`;
    }
    let m = false; try { m = !!audio.muted; } catch (_) { /* stub */ }
    mute.textContent = m ? 'Звук: выкл' : 'Звук: вкл';
    music.textContent = audio.musicEnabled === false ? 'Музыка: выкл' : 'Музыка: вкл';
    const cur = audio.music?.current;
    now.textContent = cur?.title ? `♪ «${cur.title}»` : '';
  }
  refresh();
  return { el: root, refresh };
}
