import { el, add, setText, show, setClass } from './dom.js';
import { loadControls, controlsTable, FALLBACK_CONTROLS } from './Controls.js';
import { buildAudioSettings } from '../audio/AudioMenu.js';

const QUALITIES = [['ultra', 'Ультра'], ['high', 'Высокое'], ['medium', 'Среднее'], ['low', 'Низкое']];

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
    this.desc = el('p', 'menu-desc', 'Вы — бортинженер станции. Проплывите по модулям — лаборатории, узлам, жилым отсекам, оранжерее, куполу — или поднимитесь по спице во вращающееся кольцо с искусственной тяжестью. Чтобы выйти наружу, наденьте скафандр в шлюзе, закройте внутренний люк, сбросьте давление и откройте наружный люк: страховочный трос, поручни и ранец SAFER — ваши единственные средства передвижения. Внизу — Земля, за 92 минуты станция делает полный виток.');
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

    // start location (applies to НАЧАТЬ; ?start=airlock|inside in the URL)
    const sf = el('div', 'menu-field');
    const sl = el('label'); sl.append(el('span', '', 'НАЧАЛО'), el('span', '', '?start=inside | airlock'));
    const sseg = el('div', 'seg');
    this.startChoice = ctx.player?.startView === 'airlock' ? 'airlock' : 'inside';
    this.startButtons = [];
    for (const [id, label] of [['inside', 'Внутри станции'], ['airlock', 'В шлюзе, в скафандре']]) {
      const b = el('button', id === this.startChoice ? 'on' : '', label); b.type = 'button';
      b.addEventListener('click', () => { this.startChoice = id; for (const [bid, bb] of this.startButtons) setClass(bb, 'on', bid === id); });
      this.startButtons.push([id, b]);
      sseg.append(b);
    }
    add(sf, sl, sseg);
    this.startField = sf;
    left.append(sf);

    // sound settings: built on first show (the audio module is created after the HUD), see src/audio/AudioMenu.js
    this.audioSlot = el('div');
    left.append(this.audioSlot);
    this.audioUi = null;

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

  _renderMute() {
    const a = this.ctx.audio;
    if (!this.audioUi && a && a.settings) { try { this.audioUi = buildAudioSettings(a); this.audioSlot.append(this.audioUi.el); } catch (e) { console.warn(e); } }
    this.audioUi?.refresh();
  }

  /** show({pause}) — pause overlay shows «ПРОДОЛЖИТЬ». */
  show({ pause = false } = {}) {
    this.paused = pause;
    setText(this.startBtn, pause ? 'ПРОДОЛЖИТЬ' : 'НАЧАТЬ');
    this.h1Text.nodeValue = pause ? 'ПАУЗА' : this.title;
    setText(this.kicker, pause ? this.title.toUpperCase() : 'НИЗКАЯ ОКОЛОЗЕМНАЯ ОРБИТА · 410 KM · 51.6°');
    show(this.desc, !pause);
    show(this.startField, !pause);
    this._renderMute();
    show(this.el, true);
    this.visible = true;
  }

  hide() { show(this.el, false); this.visible = false; }

  get helpVisible() { return !this.help.classList.contains('hidden'); }
  showHelp(on) { show(this.help, on); }
}
