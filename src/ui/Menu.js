import { el, add, setText, show } from './dom.js';
import { loadControls, controlsTable, FALLBACK_CONTROLS } from './Controls.js';

const QUALITIES = [['ultra', 'Ультра'], ['high', 'Высокое'], ['medium', 'Среднее'], ['low', 'Низкое']];
const VOLUME_KEY = 'hud.volume';

/** Start menu / pause overlay and the help overlay (H). */
export class Menu {
  constructor(root, ctx, hud) {
    this.ctx = ctx;
    this.hud = hud;
    this.visible = false;
    this.paused = false;        // true when shown as the pause overlay
    this.el = el('div', 'menu hidden');
    const card = el('div', 'menu-card');
    this.el.append(card);
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());

    // title
    const name = typeof ctx.station?.name === 'string' ? ctx.station.name.trim() : '';
    const title = name ? (name.includes('«') ? `Станция ${name}` : `Станция «${name.toUpperCase()}»`) : 'Орбитальная станция';
    this.h1 = el('h1');
    this.kicker = el('small', '', 'НИЗКАЯ ОКОЛОЗЕМНАЯ ОРБИТА · 410 KM · 51.6°');
    this.h1Text = document.createTextNode(title);
    this.h1.append(this.kicker, this.h1Text);
    this.title = title;
    card.append(this.h1);

    // left column
    const left = el('div', 'menu-left');
    this.desc = el('p', 'menu-desc', 'Вы — бортинженер в скафандре. Сбросьте давление в шлюзе, откройте люк и выйдите в открытый космос: страховочный трос, поручни и ранец SAFER — ваши единственные средства передвижения. Внизу — Земля, за 92 минуты станция делает полный виток.');
    left.append(this.desc);
    const actions = el('div', 'menu-actions');
    this.startBtn = el('button', 'btn primary', 'НАЧАТЬ'); this.startBtn.type = 'button';
    this.startBtn.addEventListener('click', () => this.hud.startFromMenu());
    this.observerBtn = el('button', 'btn', 'КАМЕРА ОБЗОРА'); this.observerBtn.type = 'button';
    this.observerBtn.addEventListener('click', () => { this.hud.hideMenu(); try { ctx.app?.setMode?.('observer'); } catch (e) { console.warn(e); } });
    add(actions, this.startBtn, this.observerBtn);
    left.append(actions);

    // quality
    const qf = el('div', 'menu-field');
    const ql = el('label'); ql.append(el('span', '', 'КАЧЕСТВО ГРАФИКИ'), el('span', '', 'перезапуск сцены'));
    const seg = el('div', 'seg');
    const cur = ctx.quality?.preset;
    for (const [id, label] of QUALITIES) {
      const b = el('button', id === cur ? 'on' : '', label); b.type = 'button';
      b.addEventListener('click', () => { if (id === cur) return; const p = new URLSearchParams(location.search); p.set('quality', id); location.search = p.toString(); });
      seg.append(b);
    }
    add(qf, ql, seg);
    left.append(qf);

    // volume
    const vf = el('div', 'menu-field');
    const vl = el('label'); const vlab = el('span', '', 'ГРОМКОСТЬ'); this.volVal = el('span', '', '100%'); vl.append(vlab, this.volVal);
    this.vol = el('input'); this.vol.type = 'range'; this.vol.min = '0'; this.vol.max = '1'; this.vol.step = '0.05';
    let v0 = 1; try { const s = localStorage.getItem(VOLUME_KEY); if (s !== null && Number.isFinite(parseFloat(s))) v0 = Math.max(0, Math.min(1, parseFloat(s))); } catch (_) { /* storage blocked */ }
    this.vol.value = String(v0);
    this.vol.addEventListener('input', () => this._applyVolume(parseFloat(this.vol.value), true));
    const muteRow = el('div', 'menu-note');
    this.muteBtn = el('button', 'btn-s', ''); this.muteBtn.type = 'button'; this.muteBtn.style.cssText = 'padding:4px 10px;background:rgba(12,24,40,.6);border:1px solid var(--line);border-radius:2px;font-size:11px';
    this.muteBtn.addEventListener('click', () => { const a = ctx.audio; if (!a) return; try { a.muted = !a.muted; } catch (_) { /* stub */ } this._renderMute(); });
    muteRow.append(this.muteBtn);
    add(vf, vl, this.vol, muteRow);
    left.append(vf);
    this._applyVolume(v0, false);
    this._renderMute();

    this.note = el('div', 'menu-note', 'Esc — меню · H — помощь · F — камера обзора · T — ускорение времени · P — пауза');
    left.append(this.note);

    // right column: controls
    const right = el('div', 'menu-right');
    right.append(el('h3', '', 'УПРАВЛЕНИЕ'));
    this.ctlWrap = el('div', 'menu-scroll');
    this.ctlWrap.append(controlsTable(FALLBACK_CONTROLS));
    right.append(this.ctlWrap);
    add(card, left, right);

    // help overlay
    this.help = el('div', 'help hidden');
    const hh = el('h2'); hh.append(el('span', '', 'УПРАВЛЕНИЕ'), el('small', '', 'H / Esc — закрыть')); this.help.append(hh);
    this.helpTable = el('div'); this.helpTable.append(controlsTable(FALLBACK_CONTROLS)); this.help.append(this.helpTable);
    this.help.append(el('p', '', 'Трос ограничивает удаление от шлюза 25 м. Для возвращения подтяните трос (R) или держитесь за поручни. Расход топлива ранца растёт при форсаже — следите за индикатором.'));
    root.append(this.el, this.help);

    loadControls().then((list) => {
      this.ctlWrap.replaceChildren(controlsTable(list));
      this.helpTable.replaceChildren(controlsTable(list));
    });
  }

  _applyVolume(v, persist) {
    const vol = Math.max(0, Math.min(1, Number.isFinite(v) ? v : 1));
    setText(this.volVal, `${Math.round(vol * 100)}%`);
    try { this.ctx.audio?.setParam?.('volume', vol); } catch (_) { /* stub audio */ }
    if (persist) { try { localStorage.setItem(VOLUME_KEY, String(vol)); } catch (_) { /* storage blocked */ } }
  }

  _renderMute() {
    let m = false; try { m = !!this.ctx.audio?.muted; } catch (_) { /* ignore */ }
    setText(this.muteBtn, m ? 'Звук: выкл (M)' : 'Звук: вкл (M)');
  }

  /** show({pause}) — pause overlay shows «ПРОДОЛЖИТЬ». */
  show({ pause = false } = {}) {
    this.paused = pause;
    setText(this.startBtn, pause ? 'ПРОДОЛЖИТЬ' : 'НАЧАТЬ');
    this.h1Text.nodeValue = pause ? 'ПАУЗА' : this.title;
    setText(this.kicker, pause ? this.title.toUpperCase() : 'НИЗКАЯ ОКОЛОЗЕМНАЯ ОРБИТА · 410 KM · 51.6°');
    show(this.desc, !pause);
    this._renderMute();
    show(this.el, true);
    this.visible = true;
  }

  hide() { show(this.el, false); this.visible = false; }

  get helpVisible() { return !this.help.classList.contains('hidden'); }
  showHelp(on) { show(this.help, on); }
}
