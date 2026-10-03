// Игровой HUD пустыни (docs/ui/ui_design.md §5.1–5.4): рябь шума, засечки ритма, капля влаги, подсказка взаимодействия.
// Ничего постоянного: каждый элемент появляется по поводу и гаснет через 3 с без изменений. В сиетче игровой HUD скрыт.
import { COL, el, svgEl, mixC, rgb, sat, easeOut, approach, wobble } from './util.js';

const THREAT_STATES = ['Listening', 'Approach', 'Surface'];
const BASE_HALF = 60 * Math.PI / 180, NARROW_HALF = 40 * Math.PI / 180;
const RADII = [28, 46, 64];

function surfaceIsSand(s) { s = String(s || '').toLowerCase(); return s === 'sand' || s.startsWith('packed'); }

export function createHud(game, root, ctx) {
  // ---------- Рябь ----------
  const ripple = el('div', 'ripple', root);
  const rsvg = svgEl('svg', { viewBox: '0 0 200 72', preserveAspectRatio: 'xMidYMax meet' }, ripple);
  const arcs = RADII.map(() => svgEl('path', { fill: 'none', 'stroke-linecap': 'round' }, rsvg));
  // ---------- Индикатор режима походки (рядом с рябью): ровные следы — обычный, рваные — «по песку» ----------
  const modeEl = el('div', 'mode', root);
  const msvg = svgEl('svg', { viewBox: '0 0 44 26' }, modeEl);
  const printAt = (parent, x, y, rot, o = 1, dash = false) => {
    const g = svgEl('g', { transform: `translate(${x} ${y}) rotate(${rot})`, opacity: o }, parent);
    const a = { fill: dash ? 'none' : 'currentColor', stroke: 'currentColor', 'stroke-width': dash ? 0.9 : 0, 'stroke-dasharray': dash ? '1.4 1.2' : '' };
    svgEl('ellipse', { cx: 0, cy: -2.2, rx: 2.5, ry: 3.6, ...a }, g);
    svgEl('ellipse', { cx: 0, cy: 4.3, rx: 1.7, ry: 2, ...a }, g);
  };
  const gNormal = svgEl('g', {}, msvg), gDesert = svgEl('g', {}, msvg);
  [[8, 17, 8], [22, 9, -8], [36, 17, 8]].forEach(([x, y, r]) => printAt(gNormal, x, y, r + 90));
  printAt(gDesert, 6, 18, 100); printAt(gDesert, 15, 8, 70, 0.9); printAt(gDesert, 25, 17, 118, 0.45, true); printAt(gDesert, 37, 9, 80, 0.9);
  svgEl('path', { d: 'M20.5 3.5 L22.5 8 M23 3 L21 6', stroke: 'currentColor', 'stroke-width': 0.9, fill: 'none', 'stroke-linecap': 'round', opacity: 0.8 }, gDesert);
  // ---------- Засечки ----------
  const ticks = el('div', 'ticks', root);
  const tsvg = svgEl('svg', { viewBox: '0 0 96 12' }, ticks);
  const tickLines = Array.from({ length: 6 }, () => svgEl('line', { 'stroke-width': 1.2, 'stroke-linecap': 'butt', y1: 6, y2: 6 }, tsvg));
  // ---------- Капля ----------
  const drop = el('div', 'drop', root);
  const dsvg = svgEl('svg', { viewBox: '-6.5 -6 26 30' }, drop);
  const DROP = 'M6.5 1 C6.5 1 1 8 1 11.6 A5.5 5.5 0 0 0 12 11.6 C12 8 6.5 1 6.5 1 Z';
  const defs = svgEl('defs', {}, dsvg);
  const clip = svgEl('clipPath', { id: 'rk-dropclip' }, defs);
  const clipRect = svgEl('rect', { x: -2, width: 17, y: 18, height: 18 }, clip);
  const ring = svgEl('path', { d: DROP, fill: 'none', stroke: 'rgb(110,155,196)', 'stroke-width': 0.9, transform: 'translate(6.5 11) scale(1.32) translate(-6.5 -11)', opacity: 0 }, dsvg);
  const fill = svgEl('path', { d: DROP, fill: 'rgba(239,230,216,.85)', 'clip-path': 'url(#rk-dropclip)' }, dsvg);
  svgEl('path', { d: DROP, fill: 'none', stroke: 'rgba(239,230,216,.55)', 'stroke-width': 1 }, dsvg);
  // ---------- Подсказка взаимодействия ----------
  const prompt = el('div', 'prompt', root);
  el('div', 'dot', prompt);
  const prow = el('div', 'row', prompt);
  const glyph = el('div', 'glyph', prow, 'E');
  const verb = el('div', 'verb txt', prow);

  // Состояние
  const S = {
    layer: 0,                      // видимость слоя игрового HUD (0.8 с вход/выход)
    ripple: 0, ticks: 0, drop: 0, ring: 0, prompt: 0,
    lastNoise: -1, lastChange: -10, tailUntil: -10,
    dropShowUntil: -10, lastM: null, lastBucket: null, lastShade: null, pollT: 0,
    promptKey: '', t: 0, mode: 0, modeShowUntil: -10, lastMode: null, modeKey: '',
  };

  function setOpacity(node, v) { const s = v <= 0.003 ? '0' : String(v); if (node._o !== s) { node.style.opacity = s; node._o = s; } }

  function update(dt) {
    S.t += dt;
    const p = game.player;
    const now = S.t;
    const inDesert = game.space === 'desert' && !(game.zone || '').startsWith('B');
    const cin = game.cinematic?.active || ctx.cinematic;
    const hudOK = ctx.started && !ctx.blocking && !ctx.photo && !cin && inDesert;
    S.layer = approach(S.layer, hudOK ? 1 : 0, dt, 0.8, 0.8);

    // --- шум и угроза ---
    const noise = Math.max(0, Math.min(1, p?.noise ?? 0));
    const worm = game.worm;
    const threat = Math.max(0, Math.min(1, worm?.threat ?? 0));
    const stateThreat = THREAT_STATES.includes(worm?.state);
    const tf = sat(Math.max(threat, stateThreat ? 0.6 : 0, threat > 0.15 ? threat : 0)); // «форма-код» угрозы
    const onSand = !!p?.position && surfaceIsSand(game.surfaceAt?.(p.position.x, p.position.z));
    if (Math.abs(noise - S.lastNoise) > 0.02) { S.lastChange = now; S.lastNoise = noise; }
    if (noise >= 0.05) S.tailUntil = now + 2;
    const rippleOn = onSand && (now < S.tailUntil || threat >= 0.25) && (now - S.lastChange < 3 || threat >= 0.25);
    S.ripple = approach(S.ripple, rippleOn ? 1 : 0, dt, 0.25, 0.8);

    if (S.ripple > 0.003 && S.layer > 0.003) {
      const half = BASE_HALF + (NARROW_HALF - BASE_HALF) * tf;
      const pulseHz = 0.6 + 1.4 * tf;
      const base = mixC(COL.warm, COL.ochre, sat(noise * 1.3));
      const col = mixC(base, COL.ochreRed, sat(threat * 1.4 + (stateThreat ? 0.35 : 0)));
      for (let i = 0; i < 3; i++) {
        const jit = tf > 0.05 ? wobble(now * 9 / 2.3, i + 1) * 3 * tf : 0;
        const pulse = 1 + 0.07 * tf * Math.sin(2 * Math.PI * pulseHz * now - i * 0.9);
        const r = RADII[i] * pulse + jit;
        const x0 = 100 - r * Math.sin(half), x1 = 100 + r * Math.sin(half), y = 72 - r * Math.cos(half);
        arcs[i].setAttribute('d', `M${x0.toFixed(2)} ${y.toFixed(2)} A${r.toFixed(2)} ${r.toFixed(2)} 0 0 1 ${x1.toFixed(2)} ${y.toFixed(2)}`);
        arcs[i].setAttribute('stroke-width', (1 + 1.6 * noise).toFixed(2));
        arcs[i].setAttribute('stroke', rgb(col, (0.25 + 0.75 * sat((noise - 0.25 * i) / 0.35)).toFixed(3)));
      }
    }
    setOpacity(ripple, easeOut(S.ripple) * S.layer);

    // --- индикатор режима походки: появляется вместе с рябью и на 3.5 с после переключения ---
    const mm = p?.moveMode;
    if (mm === 'normal' || mm === 'desert') {
      if (S.lastMode !== null && mm !== S.lastMode) { S.modeShowUntil = now + 3.5; ctx.modeToggled = true; }
      S.lastMode = mm;
      if (S.modeKey !== mm) {
        S.modeKey = mm;
        gNormal.style.display = mm === 'normal' ? '' : 'none'; gDesert.style.display = mm === 'desert' ? '' : 'none';
        modeEl.style.color = mm === 'desert' ? 'rgb(200,161,101)' : 'rgb(239,230,216)';
        modeEl.title = mm === 'desert' ? 'sand-walk' : 'normal';
      }
    }
    const modeOn = (mm === 'normal' || mm === 'desert') && (S.ripple > 0.05 || now < S.modeShowUntil);
    S.mode = approach(S.mode, modeOn ? 1 : 0, dt, 0.25, 0.8);
    setOpacity(modeEl, easeOut(S.mode) * S.layer * 0.9);

    // --- засечки ритма ---
    const sw = !!p?.sandWalking && onSand;
    S.ticks = approach(S.ticks, sw ? 1 : 0, dt, 0.2, 0.6);
    if (S.ticks > 0.003 && S.layer > 0.003) {
      const iv = (p?.intervals || []).slice(-5).filter((v) => v > 0.05);
      const total = iv.reduce((a, b) => a + b, 0), mean = total / (iv.length || 1);
      const reg = sat(p?.regularity ?? 0);
      const col = rgb(mixC(COL.ochre, COL.cold, reg), 0.95);
      let acc = 0;
      tickLines.forEach((ln, i) => {
        if (!iv.length || i > iv.length) { ln.setAttribute('visibility', 'hidden'); return; }
        const x = 2 + (total > 0 ? (acc / total) * 92 : 0);
        const dev = i === 0 ? 0 : Math.abs(iv[i - 1] - mean) / (mean || 1);
        const h = 5 + 4 * sat(dev * 2.2);
        ln.setAttribute('visibility', 'visible');
        ln.setAttribute('x1', x.toFixed(2)); ln.setAttribute('x2', x.toFixed(2));
        ln.setAttribute('y1', (6 - h / 2).toFixed(2)); ln.setAttribute('y2', (6 + h / 2).toFixed(2));
        ln.setAttribute('stroke', col);
        acc += iv[i] || 0;
      });
    }
    setOpacity(ticks, easeOut(S.ticks) * S.layer);

    // --- капля влаги ---
    S.pollT += dt;
    const m = Math.max(0, Math.min(1, p?.moisture ?? 1));
    if (S.pollT >= 0.25) {
      S.pollT = 0;
      const bucket = Math.floor(m * 20 + 1e-6);
      if (S.lastM !== null) {
        if (Math.abs(m - S.lastM) >= 0.03) S.dropShowUntil = now + 3;
        if (m < 0.7 && bucket < S.lastBucket) S.dropShowUntil = now + 3;
        if (!!p?.inShade !== S.lastShade) S.dropShowUntil = now + 3;
      }
      S.lastM = m; S.lastBucket = bucket; S.lastShade = !!p?.inShade;
    }
    const low = m < 0.25;
    const dropOn = now < S.dropShowUntil || low;
    S.drop = approach(S.drop, dropOn ? 1 : 0, dt, 0.3, 0.8);
    S.ring = approach(S.ring, p?.inShade ? 1 : 0, dt, 0.4, 0.4);
    if (S.drop > 0.003 && S.layer > 0.003) {
      clipRect.setAttribute('y', (17.3 - 16.6 * m).toFixed(2)); // 1 → до верха капли, 0 → пусто
      ring.setAttribute('opacity', (0.65 * S.ring).toFixed(3));
    }
    const breathe = low ? 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.5 * now)) : 1;
    setOpacity(drop, easeOut(S.drop) * S.layer * breathe);

    // --- подсказка взаимодействия (остаётся и в сиетче) ---
    const f = p?.focus;
    const promptOK = ctx.started && !ctx.blocking && !ctx.photo && !cin && !!f;
    if (f) {
      const label = typeof f.label === 'object' && f.label ? game.t(f.label) : (f.label ?? '');
      const g = game.input?.device === 'pad' ? 'X' : 'E';
      const key = `${label}|${g}`;
      if (key !== S.promptKey) { S.promptKey = key; verb.textContent = label; glyph.textContent = g; }
    }
    S.prompt = approach(S.prompt, promptOK ? 1 : 0, dt, 0.15, 0.25);
    setOpacity(prompt, easeOut(S.prompt));
  }
  return { update };
}
