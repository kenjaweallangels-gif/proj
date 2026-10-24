import * as THREE from 'three';
import { el, add, svg, setText, setClass, show, num, hms, mmss, promptHtml, fade } from './dom.js';
import { Ecg } from './Ecg.js';

/**
 * Helmet HUD (play mode): visor frame overlay, suit / vitals / orbit / navigation panels, centre reticle,
 * airlock hatch marker (3D -> screen, edge arrow when off-screen), interaction prompts, airlock sequence bar,
 * flashing warnings. Text is refreshed by `updateText` (~10 Hz), canvases and the marker by `updateFast` (~30 Hz).
 */
const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const SUIT_KPA = 29.6;      // nominal suit pressure (4.3 psi)
const CABIN_KPA = 101.3;
const SEQ_NAMES = { depress: 'Сброс давления шлюза', hatchOpen: 'Открытие люка', close: 'Закрытие люка', repress: 'Наддув шлюза', innerClose: 'Закрытие внутреннего люка', innerOpen: 'Открытие внутреннего люка', don: 'Надевание скафандра', doff: 'Снятие скафандра' };

function row(parent, label, { unit = '', bar = false, cls = '' } = {}) {
  const r = el('div', `hp-row ${cls}`);
  const k = el('span', 'k', label);
  const v = el('span', 'v');
  const val = el('span', '', '—');
  v.append(val);
  if (unit) v.append(el('span', 'u', unit));
  add(r, k, v);
  parent.append(r);
  let barEl = null, fill = null;
  if (bar) { barEl = el('div', `bar ${cls}`); fill = el('i'); barEl.append(fill); parent.append(barEl); }
  return { row: r, val, v, bar: barEl, fill, _scale: -1 };
}

function setBar(h, frac) {
  const f = Math.max(0, Math.min(1, frac));
  const q = Math.round(f * 200) / 200;
  if (h._scale !== q) { h._scale = q; h.fill.style.transform = `scaleX(${q})`; }
}

/** Level class for consumables: '' | 'warn' | 'alert'. */
function level(frac, warn, alert) { return frac <= alert ? 'alert' : frac <= warn ? 'warn' : ''; }
function applyLevel(h, lv) {
  setClass(h.v, 'warn', lv === 'warn'); setClass(h.v, 'alert', lv === 'alert');
  if (h.bar) { setClass(h.bar, 'warn', lv === 'warn'); setClass(h.bar, 'alert', lv === 'alert'); }
}

export class Helmet {
  constructor(root, ctx) {
    this.ctx = ctx;
    this.el = el('div', 'helmet');
    root.append(this.el);
    this.visorEl = this._visor();
    this.el.append(this.visorEl);
    this._buildPanels();
    this.reticle = el('div', 'reticle'); this.reticle.append(el('i'));
    this.el.append(this.reticle);
    this._buildCenter();
    this._buildMarker();
    this.W = window.innerWidth; this.H = window.innerHeight;
    window.addEventListener('resize', () => { this.W = window.innerWidth; this.H = window.innerHeight; });
    this._warnKey = '';
    this._promptKey = '';
    this._term = null;
    this._termTimer = 1e9;
  }

  setVisible(on) { show(this.el, true); fade(this.el, on); }

  // ------------------------------------------------------------------ visor overlay
  _visor() {
    const s = svg('svg', { class: 'visor', viewBox: '0 0 1600 900', preserveAspectRatio: 'none' });
    const defs = svg('defs');
    const refl = svg('linearGradient', { id: 'visorRefl', x1: '0', y1: '0', x2: '1', y2: '1' });
    refl.append(svg('stop', { offset: '0', 'stop-color': '#dff2ff', 'stop-opacity': '0.085' }), svg('stop', { offset: '0.32', 'stop-color': '#dff2ff', 'stop-opacity': '0.02' }), svg('stop', { offset: '0.6', 'stop-color': '#dff2ff', 'stop-opacity': '0' }));
    const edge = svg('radialGradient', { id: 'visorEdge', cx: '0.5', cy: '0.5', r: '0.72' });
    edge.append(svg('stop', { offset: '0.72', 'stop-color': '#7fb8e6', 'stop-opacity': '0' }), svg('stop', { offset: '1', 'stop-color': '#7fb8e6', 'stop-opacity': '0.16' }));
    defs.append(refl, edge);
    s.append(defs);
    s.append(svg('rect', { x: 0, y: 0, width: 1600, height: 900, fill: 'url(#visorRefl)' }));
    s.append(svg('rect', { x: 0, y: 0, width: 1600, height: 900, fill: 'url(#visorEdge)' }));
    // curved inner edge of the visor frame, left and right
    const edgeStyle = { fill: 'none', stroke: 'rgba(190,225,255,0.13)', 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke' };
    s.append(svg('path', { d: 'M 150 -10 C 40 230 40 670 150 910', ...edgeStyle }));
    s.append(svg('path', { d: 'M 1450 -10 C 1560 230 1560 670 1450 910', ...edgeStyle }));
    s.append(svg('path', { d: 'M -10 120 C 300 30 1300 30 1610 120', ...edgeStyle, stroke: 'rgba(190,225,255,0.07)' }));
    // scratches
    const sc = { fill: 'none', stroke: 'rgba(235,245,255,0.11)', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke', 'stroke-linecap': 'round' };
    s.append(svg('path', { d: 'M 1180 140 L 1265 212 L 1288 228', ...sc }));
    s.append(svg('path', { d: 'M 1210 160 L 1250 196', ...sc, stroke: 'rgba(235,245,255,0.06)' }));
    s.append(svg('path', { d: 'M 300 690 L 372 644', ...sc, stroke: 'rgba(235,245,255,0.08)' }));
    s.append(svg('path', { d: 'M 1320 700 L 1380 760 L 1392 790', ...sc, stroke: 'rgba(235,245,255,0.07)' }));
    s.append(svg('path', { d: 'M 240 150 L 268 130', ...sc, stroke: 'rgba(235,245,255,0.06)' }));
    // dust specks
    const specks = [[412, 182, 1.3, 0.2], [1104, 98, 1.0, 0.17], [1390, 520, 1.6, 0.14], [204, 480, 1.1, 0.18], [860, 812, 1.0, 0.15], [1240, 330, 0.9, 0.2], [540, 760, 1.4, 0.12], [986, 150, 0.8, 0.16], [1470, 250, 1.2, 0.13], [120, 300, 1.0, 0.11], [700, 60, 0.9, 0.14]];
    for (const [x, y, r, o] of specks) s.append(svg('circle', { cx: x, cy: y, r, fill: `rgba(230,240,250,${o})` }));
    return s;
  }

  // ------------------------------------------------------------------ panels
  _buildPanels() {
    // suit
    const suit = el('div', 'hp hp-suit');
    const st = el('div', 'hp-title'); this.suitTitle = el('span', '', 'СКАФАНДР'); this.suitMode = el('small', '', 'ШЛЮЗ'); st.append(this.suitTitle, this.suitMode); suit.append(st);
    this.rO2 = row(suit, 'Кислород O₂', { unit: '%', bar: true });
    this.rPress = row(suit, 'Давление скафандра', { unit: 'kPa' });
    this.rProp = row(suit, 'Топливо SAFER', { unit: '%', bar: true });
    this.rPower = row(suit, 'Питание', { unit: '%', bar: true });
    this.rTemp = row(suit, 'Температура', { unit: '°C', cls: 'sec' });
    this.rAirlock = row(suit, 'Давление шлюза', { unit: 'kPa' });
    this.ind = el('div', 'ind');
    this.tagRcs = el('span', 'tag', 'РСУ'); this.tagBoost = el('span', 'tag', 'ФОРСАЖ'); this.tagKill = el('span', 'tag', 'ГАШЕНИЕ'); this.tagLamp = el('span', 'tag', 'ФОНАРИ');
    add(this.ind, this.tagRcs, this.tagBoost, this.tagKill, this.tagLamp);
    suit.append(this.ind);
    // vitals
    const vit = el('div', 'hp hp-vitals');
    const vt = el('div', 'hp-title'); vt.append(el('span', '', 'ПУЛЬС'), el('small', '', 'ЭКГ II')); vit.append(vt);
    const wrap = el('div', 'ecg-wrap');
    this.ecgCanvas = el('canvas', 'ecg');
    this.ecg = new Ecg(this.ecgCanvas, { width: 150, height: 44 });
    this.bpmEl = el('div', 'ecg-bpm', '64'); this.bpmEl.append(el('small', '', 'уд/мин'));
    add(wrap, this.ecgCanvas, this.bpmEl);
    vit.append(wrap);
    // orbit
    const orb = el('div', 'hp hp-orbit');
    const ot = el('div', 'hp-title'); ot.append(el('span', '', 'ОРБИТА')); this.clockEl = el('small', '', 'T+00:00:00'); ot.append(this.clockEl); orb.append(ot);
    this.rAlt = row(orb, 'Высота', { unit: 'km' });
    this.rSpd = row(orb, 'Орбитальная скорость', { unit: 'km/s' });
    this.rLat = row(orb, 'Широта', {});
    this.rLon = row(orb, 'Долгота', {});
    orb.append(el('div', 'hp-sep'));
    this.rTerm = row(orb, 'Восход через', {});
    this.rLit = row(orb, 'Освещённость Земли', { unit: '%' });
    this.rSun = row(orb, 'Солнце', { cls: 'sec' });
    this.rUtc = row(orb, 'UTC', { cls: 'sec' });
    this.rScale = row(orb, 'Ход времени', { cls: 'sec' });
    // navigation
    const nav = el('div', 'hp hp-nav');
    const nt = el('div', 'hp-title'); nt.append(el('span', '', 'НАВИГАЦИЯ')); this.navMode = el('small', '', ''); nt.append(this.navMode); nav.append(nt);
    this.rVel = row(nav, 'Относительная скорость', { unit: 'm/s' });
    this.rRot = row(nav, 'Угловая скорость', { unit: '°/s', cls: 'sec' });
    this.rDist = row(nav, 'До станции', { unit: 'm' });
    this.rHatch = row(nav, 'До шлюза', { unit: 'm' });
    this.rTether = row(nav, 'Трос', { unit: 'm' });
    this.tetherTag = el('span', 'tag', ''); this.rTether.v.append(this.tetherTag);
    this.rStab = row(nav, 'Стабилизация', {});
    add(this.el, suit, vit, orb, nav);
    this.pSuit = suit; this.pVit = vit; this.pOrb = orb; this.pNav = nav;
    // inside the station (no suit): cabin status panel + compartment name banner
    const cab = el('div', 'hp hp-suit hidden');
    const ct = el('div', 'hp-title'); ct.append(el('span', '', 'БОРТ · CABIN')); this.cabFrame = el('small', '', '0 g'); ct.append(this.cabFrame); cab.append(ct);
    this.rCabP = row(cab, 'Давление', { unit: 'kPa' });
    this.rCabO2 = row(cab, 'Кислород O₂', { unit: '%' });
    this.rCabCO2 = row(cab, 'CO₂', { unit: 'mmHg' });
    this.rCabT = row(cab, 'Температура', { unit: '°C' });
    this.rCabRH = row(cab, 'Влажность', { unit: '%', cls: 'sec' });
    cab.append(el('div', 'hp-sep'));
    this.rCabG = row(cab, 'Гравитация', { unit: 'g' });
    this.rCabV = row(cab, 'Скорость', { unit: 'm/s' });
    this.rCabCor = row(cab, 'Кориолис', { unit: 'm/s²', cls: 'sec' });
    const ind = el('div', 'ind');
    this.tagLevel = el('span', 'tag', 'ВЫРАВНИВАНИЕ'); this.tagLadder = el('span', 'tag', 'ЛЕСТНИЦА'); this.tagHold = el('span', 'tag', 'ПОРУЧЕНЬ');
    add(ind, this.tagLevel, this.tagHold, this.tagLadder);
    cab.append(ind);
    this.pCab = cab;
    this.zoneEl = el('div', 'zone-name hidden');
    this.zoneTitle = el('div', 'zone-title', '');
    this.zoneSub = el('div', 'zone-sub', '');
    add(this.zoneEl, this.zoneTitle, this.zoneSub);
    add(this.el, cab, this.zoneEl);
    this._inside = null;
    this._zoneKey = '';
  }

  _buildCenter() {
    this.warnEl = el('div', 'warnings');
    this.promptEl = el('div', 'prompt hidden');
    this.seqEl = el('div', 'seq hidden');
    const bar = el('div', 'bar'); this.seqFill = el('i'); bar.append(this.seqFill);
    this.seqPct = el('div', 'seq-pct', '0%');
    add(this.seqEl, bar, this.seqPct);
    add(this.el, this.warnEl, this.promptEl, this.seqEl);
    this._seqScale = -1;
  }

  _buildMarker() {
    this.mk = el('div', 'mk hidden');
    this.mkLabel = el('div', 'mk-label', 'ШЛЮЗ');
    add(this.mk, el('div', 'mk-box'), this.mkLabel);
    this.mkArrow = el('div', 'mk-arrow hidden');
    add(this.el, this.mk, this.mkArrow);
  }

  // ------------------------------------------------------------------ slow (10 Hz) text refresh
  /** Layout for the astronaut's situation: 'iva' (no suit: cabin panel), suited inside or outside (helmet). */
  _applyInside(st) {
    const iva = st.mode === 'iva';
    if (iva === this._inside) return;
    this._inside = iva;
    show(this.visorEl, !iva);
    show(this.pSuit, !iva); show(this.pVit, !iva); show(this.pNav, !iva);
    show(this.pCab, iva);
  }

  updateText(ctx, rdt) {
    const st = ctx.player?.state || {};
    this._applyInside(st);
    // compartment banner (inside, suited or not)
    const zname = st.mode !== 'eva' && st.compartment ? st.compartment : '';
    const g = num(st.gravity, 0);
    const zkey = zname + (zname ? (g > 0.01 ? ` ${g.toFixed(2)}` : ' 0') : '');
    if (zkey !== this._zoneKey) {
      this._zoneKey = zkey;
      show(this.zoneEl, !!zname);
      setText(this.zoneTitle, zname);
      setText(this.zoneSub, g > 0.01 ? `искусственная тяжесть ${g.toFixed(2)} g` : 'невесомость');
    }
    if (st.mode === 'iva') {
      const t = num(ctx.time?.sim, 0);
      setText(this.rCabP.val, (101.3 + 0.2 * Math.sin(t * 0.01)).toFixed(1));
      setText(this.rCabO2.val, (21.2 + 0.1 * Math.sin(t * 0.013)).toFixed(1));
      setText(this.rCabCO2.val, (2.3 + 0.2 * Math.sin(t * 0.007)).toFixed(1));
      setText(this.rCabT.val, (22.4 + 0.3 * Math.sin(t * 0.004)).toFixed(1));
      setText(this.rCabRH.val, (41 + 2 * Math.sin(t * 0.003)).toFixed(0));
      setText(this.rCabG.val, g.toFixed(2));
      setText(this.rCabV.val, num(st.speedRelative, 0).toFixed(2));
      setText(this.rCabCor.val, num(ctx.player?.iva?.coriolis, 0).toFixed(2));
      setText(this.cabFrame, st.frame === 'ring' ? 'КОЛЬЦО' : '0 g');
      setClass(this.tagLevel, 'on', !!st.autoLevel && st.frame !== 'ring'); setClass(this.tagLadder, 'on', !!st.onLadder); setClass(this.tagHold, 'on', !!st.holding);
    }
    const o = ctx.orbit || {};
    const t = ctx.time || {};
    const eva = st.mode === 'eva';

    // suit
    setText(this.suitMode, eva ? 'ВКД' : st.mode === 'airlock' ? 'ШЛЮЗ' : '—');
    const o2 = num(st.o2, 1), prop = num(st.propellant, 1), pow = num(st.power, 1);
    setText(this.rO2.val, (o2 * 100).toFixed(1)); setBar(this.rO2, o2); applyLevel(this.rO2, level(o2, 0.2, 0.08));
    const sp = num(st.suitPressure, 1);
    setText(this.rPress.val, (sp > 2 ? sp : sp * SUIT_KPA).toFixed(1)); applyLevel(this.rPress, (sp > 2 ? sp / SUIT_KPA : sp) < 0.85 ? 'alert' : '');
    setText(this.rProp.val, (prop * 100).toFixed(0)); setBar(this.rProp, prop); applyLevel(this.rProp, level(prop, 0.25, 0.1));
    setText(this.rPower.val, (pow * 100).toFixed(0)); setBar(this.rPower, pow); applyLevel(this.rPower, level(pow, 0.2, 0.08));
    setText(this.rTemp.val, num(st.suitTemp, 21.5).toFixed(1));
    const showAl = st.mode === 'airlock' || (st.sequence && (st.sequence.name === 'depress' || st.sequence.name === 'repress' || st.sequence.name === 'close'));
    show(this.rAirlock.row, !!showAl);
    if (showAl) setText(this.rAirlock.val, (num(st.airlockPressure, 1) * CABIN_KPA).toFixed(1));
    setClass(this.tagRcs, 'on', !!st.thrusting); setClass(this.tagBoost, 'on', !!st.boost); setClass(this.tagKill, 'on', !!st.killing); setClass(this.tagLamp, 'on', !!st.lampOn);

    // vitals
    const hr = num(st.heartRate, 64);
    setText(this.bpmEl.firstChild, String(Math.round(hr)));
    setClass(this.bpmEl, 'warn', hr >= 110);

    // orbit
    setText(this.clockEl, `T+${hms(t.sim)}`);
    setText(this.rAlt.val, num(o.altitudeKm, 410).toFixed(1));
    setText(this.rSpd.val, num(o.speedKms, 7.67).toFixed(2));
    const lat = num(o.subLatDeg, 0), lon = num(o.subLonDeg, 0);
    setText(this.rLat.val, `${Math.abs(lat).toFixed(1)}° ${lat >= 0 ? 'с.ш.' : 'ю.ш.'}`);
    setText(this.rLon.val, `${Math.abs(lon).toFixed(1)}° ${lon >= 0 ? 'в.д.' : 'з.д.'}`);
    this._termTimer += rdt;
    if ((this._termTimer > 1 || !this._term) && typeof o.secondsToTerminator === 'function') {
      this._termTimer = 0;
      try { const r = o.secondsToTerminator(); this._term = { seconds: r.seconds, event: r.event, at: num(t.sim, 0) }; } catch (_) { this._term = null; }
    }
    if (this._term && Number.isFinite(this._term.seconds)) {
      const left = this._term.seconds - (num(t.sim, 0) - this._term.at);
      setText(this.rTerm.row.firstChild, this._term.event === 'sunset' ? 'Закат через' : 'Восход через');
      setText(this.rTerm.val, mmss(left));
    } else { setText(this.rTerm.row.firstChild, 'Терминатор'); setText(this.rTerm.val, '—'); }
    setText(this.rLit.val, (num(o.earthLit, 1) * 100).toFixed(0));
    const sv = num(o.sunVisible, 1);
    setText(this.rSun.val, sv > 0.95 ? 'освещено' : sv < 0.05 ? 'тень Земли' : 'терминатор');
    let utc = '—';
    try { const d = typeof o.dateAt === 'function' ? o.dateAt() : null; if (d) utc = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')} · ${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`; } catch (_) { /* stub orbit */ }
    setText(this.rUtc.val, utc);
    const scale = num(t.scale, 1);
    setText(this.rScale.val, ctx.app?.paused ? 'ПАУЗА' : `×${scale >= 1000 ? Math.round(scale).toLocaleString('ru-RU') : scale}${st.onRails ? ' · фиксация' : ''}`);
    setClass(this.rScale.v, 'warn', scale !== 1 || !!ctx.app?.paused);

    // navigation
    const vrel = num(st.speedRelative, 0);
    setText(this.rVel.val, vrel.toFixed(2)); applyLevel(this.rVel, vrel > 2 ? 'alert' : vrel > 1 ? 'warn' : '');
    setText(this.rRot.val, (num(st.angularSpeed, 0) * 180 / Math.PI).toFixed(1));
    const dist = num(st.distanceToStation, 0);
    setText(this.rDist.val, dist < 10 ? dist.toFixed(2) : dist.toFixed(1));
    const dh = num(st.distanceToAirlock, 0);
    setText(this.rHatch.val, dh < 10 ? dh.toFixed(1) : dh.toFixed(0));
    const tl = num(st.tetherLength, 25), tm = num(st.tetherMax, 25);
    const stowed = !!st.tetherStowed || (st.mode === 'airlock' && !st.tetherAttached);
    const detached = eva && !st.tetherAttached && !stowed;
    setText(this.rTether.val, st.tetherAttached ? `${tl.toFixed(1)} / ${tm.toFixed(0)}` : stowed ? 'уложен' : '—');
    let tTag = 'закреплён', tCls = 'on';
    if (detached) { tTag = 'ОТЦЕПЛЕН'; tCls = 'alert'; }
    else if (!st.tetherAttached) { tTag = ''; tCls = ''; }
    else if (st.tetherTaut) { tTag = 'НАТЯНУТ'; tCls = 'warn'; }
    else if (st.reeling) { tTag = 'подтяжка'; tCls = 'warn'; }
    setText(this.tetherTag, tTag); show(this.tetherTag, !!tTag);
    setClass(this.tetherTag, 'on', tCls === 'on'); setClass(this.tetherTag, 'warn', tCls === 'warn'); setClass(this.tetherTag, 'alert', tCls === 'alert');
    applyLevel(this.rTether, detached ? 'alert' : st.tetherTaut ? 'warn' : '');
    const stab = typeof st.stabilization === 'boolean' ? st.stabilization : st.rotationMode !== 'free';
    setText(this.rStab.val, st.holding ? 'ПОРУЧЕНЬ' : stab ? 'УДЕРЖАНИЕ' : 'СВОБОДНАЯ');
    setClass(this.rStab.v, 'ok', stab && !st.holding); setClass(this.rStab.v, 'warn', !stab && !st.holding);
    setText(this.navMode, st.holding ? 'ФИКСАЦИЯ' : st.thrusting ? 'МАНЁВР' : eva ? 'ДРЕЙФ' : '');

    this._updateWarnings(st, o2, prop, pow, detached);
    this._updatePrompt(st);
    this._updateSequence(st);
  }

  _updateWarnings(st, o2, prop, pow, detached) {
    const list = [];
    if (prop <= 0.1) list.push(['ТОПЛИВО КРИТИЧНО', 'alert']); else if (prop <= 0.25) list.push(['МАЛО ТОПЛИВА', 'warn']);
    if (o2 <= 0.08) list.push(['O₂ КРИТИЧНО', 'alert']); else if (o2 <= 0.2) list.push(['НИЗКИЙ УРОВЕНЬ O₂', 'warn']);
    if (pow <= 0.08) list.push(['ПИТАНИЕ КРИТИЧНО', 'alert']); else if (pow <= 0.2) list.push(['НИЗКИЙ ЗАРЯД', 'warn']);
    if (detached) list.push(['ТРОС ОТЦЕПЛЕН', 'alert']); else if (st.tetherTaut) list.push(['ТРОС НАТЯНУТ', 'warn']);
    if (num(st.speedRelative, 0) > 2.5 && st.mode === 'eva') list.push(['ВЫСОКАЯ СКОРОСТЬ', 'warn']);
    if (st.onRails) list.push(['ФИКСАЦИЯ: ХОД ВРЕМЕНИ ВЫШЕ ×10', 'info']);
    const key = list.map((w) => w[0] + w[1]).join('|');
    if (key === this._warnKey) return;
    this._warnKey = key;
    this.warnEl.replaceChildren(...list.map(([text, cls]) => el('div', `warn-item ${cls}`, text)));
  }

  _updatePrompt(st) {
    let text = '';
    const seq = st.sequence;
    if (seq && seq.name) text = `${SEQ_NAMES[seq.name] || 'Шлюз'}…`;
    else if (st.mode === 'iva' || st.mode === 'airlock') text = typeof st.prompt === 'string' ? st.prompt : '';
    else if (st.holding) text = 'Вдоль поручня (A/D) · Оттолкнуться (Space) · Отпустить (G)';
    else if (st.canEnterAirlock) text = 'Войти в шлюз и закрыть люк (E)';
    else if (st.nearHandrail) text = 'Схватить (G)';
    else if (typeof st.prompt === 'string' && st.prompt) text = st.prompt;
    if (text === this._promptKey) return;
    this._promptKey = text;
    show(this.promptEl, !!text);
    if (text) this.promptEl.innerHTML = promptHtml(text);
  }

  _updateSequence(st) {
    const seq = st.sequence;
    const on = !!(seq && seq.name);
    show(this.seqEl, on);
    if (!on) return;
    const p = Math.max(0, Math.min(1, num(seq.progress, 0)));
    const q = Math.round(p * 100) / 100;
    if (q !== this._seqScale) { this._seqScale = q; this.seqFill.style.transform = `scaleX(${q})`; setText(this.seqPct, `${Math.round(p * 100)}%`); }
  }

  // ------------------------------------------------------------------ fast (≤30 Hz): ECG + hatch marker
  updateFast(rdt, ctx) {
    const st = ctx.player?.state || {};
    const hr = num(st.heartRate, 64);
    this.ecg.step(rdt, hr);
    this.ecg.draw('#7fe6d6', hr >= 110);
    this._updateMarker(ctx, st);
  }

  _updateMarker(ctx, st) {
    const al = ctx.station?.airlock;
    const target = al?.hatchCenter || al?.standPosition;
    const cam = ctx.camera;
    if (!target || !cam || st.mode !== 'eva') { show(this.mk, false); show(this.mkArrow, false); return; }
    _m.copy(cam.matrixWorld).invert();
    _v.copy(target).applyMatrix4(_m);
    const behind = _v.z > -0.05;
    _v.applyMatrix4(cam.projectionMatrix);
    let nx = _v.x, ny = _v.y;
    if (behind) { nx = -nx; ny = -ny; }
    const W = this.W, H = this.H;
    const onScreen = !behind && Math.abs(nx) <= 0.88 && Math.abs(ny) <= 0.82;
    let x, y;
    if (onScreen) {
      x = (nx * 0.5 + 0.5) * W; y = (0.5 - ny * 0.5) * H;
      show(this.mkArrow, false);
      setClass(this.mk, 'edge', false);
    } else {
      let px = nx * W * 0.5, py = -ny * H * 0.5;
      if (Math.abs(px) < 1e-3 && Math.abs(py) < 1e-3) { px = 0; py = 1; }
      const limX = W * 0.5 - 70, limY = H * 0.5 - 64;
      const k = Math.min(limX / Math.max(Math.abs(px), 1e-6), limY / Math.max(Math.abs(py), 1e-6));
      px *= k; py *= k;
      const ang = Math.atan2(py, px);
      x = W * 0.5 + px; y = H * 0.5 + py;
      this.mkArrow.style.transform = `translate(${(x + Math.cos(ang) * 22).toFixed(1)}px, ${(y + Math.sin(ang) * 22).toFixed(1)}px) rotate(${(ang * 180 / Math.PI).toFixed(1)}deg)`;
      show(this.mkArrow, true);
      setClass(this.mk, 'edge', true);
    }
    this.mk.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    const d = num(st.distanceToAirlock, 0);
    setText(this.mkLabel, `ШЛЮЗ · ${d < 10 ? d.toFixed(1) : d.toFixed(0)} m`);
    show(this.mk, true);
  }
}
