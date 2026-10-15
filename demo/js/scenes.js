'use strict';
const SCENES = {};

/* ================= shared set pieces ================= */
const OBS = { cx: 960, cy: 840, rx: 1260, ry: 880 };
function domePt(k, v, o = OBS) { return [o.cx + o.rx * k * Math.sqrt(Math.max(0, 1 - v * v)), o.cy - o.ry * v]; }

function nightSky(ctx, o = {}) {
  vgrad(ctx, 0, 0, W, H, [[0, '#02040a'], [.45, '#081020'], [.72, '#111a2e'], [.85, '#1b2236']]);
  const mw = noiseCanvas(W, H, { scale: 240, seed: 3, lo: .42, hi: .9, stretchX: 1.6 });
  layer(ctx, x => {
    x.save(); x.translate(W * .55, H * .35); x.rotate(-.42); x.translate(-W * .55, -H * .35);
    const g = x.createLinearGradient(0, H * .12, 0, H * .62); g.addColorStop(0, 'rgba(120,140,200,0)'); g.addColorStop(.5, 'rgba(140,160,215,.55)'); g.addColorStop(1, 'rgba(120,140,200,0)');
    x.fillStyle = g; x.fillRect(-400, 0, W + 800, H); x.restore();
    x.globalCompositeOperation = 'destination-in'; x.drawImage(mw, 0, 0, W, H);
  }, { comp: 'screen', alpha: .5 });
  stars(ctx, o.n || 1700, [0, 0, W, H * .78], o.seed || 7, { a: .95 });
  stars(ctx, 500, [0, 0, W, H * .7], (o.seed || 7) + 5, { a: .5, inside: (x, y) => mw.getContext('2d') && true });
}
function cityBeyond(ctx, y0, o = {}) {
  const r = rng(o.seed || 21);
  // smog lit from below
  vgrad(ctx, 0, y0 - 140, W, 220, [[0, [60, 52, 50], 0], [.6, [92, 70, 52], .28], [1, [110, 80, 55], .42]]);
  const sm = noiseCanvas(W, 300, { scale: 140, seed: 9, lo: .35, hi: .8, stretchX: 3 });
  fog(ctx, sm, y0 - 160, y0 + 40, [120, 96, 78], .35, { comp: 'screen' });
  layer(ctx, x => {
    x.fillStyle = '#0a0c12';
    // spire of the cathedral on the hill
    poly(x, [[1430, y0 + 10], [1446, y0 - 150], [1452, y0 - 210], [1458, y0 - 150], [1474, y0 + 10]], '#0a0c12');
    let px = -20; x.beginPath(); x.moveTo(-20, y0 + 120);
    while (px < W + 40) { const w = 40 + r() * 90, h = 18 + r() * 70; x.lineTo(px, y0 - h + 14); x.lineTo(px + w * .5, y0 - h); x.lineTo(px + w, y0 - h + 14);
      if (r() < .6) { const cx = px + w * (.2 + r() * .5); x.lineTo(cx, y0 - h + 6); x.lineTo(cx, y0 - h - 26 - r() * 20); x.lineTo(cx + 9, y0 - h - 26); x.lineTo(cx + 9, y0 - h + 6); }
      px += w; }
    x.lineTo(W + 40, y0 + 120); x.closePath(); x.fill();
    for (let i = 0; i < 70; i++) { const wx = r() * W, wy = y0 - r() * 50 + 10; x.fillStyle = rgba([255, 190 + r() * 30, 110], .35 + r() * .5); x.fillRect(wx, wy, 3 + r() * 3, 4 + r() * 3); }
  }, { fog: [[40, 52, 78], .45], blur: 1.2 });
  // chimney smoke
  const sm2 = noiseCanvas(W, 400, { scale: 90, seed: 13, lo: .45, hi: .85, stretchY: 2.4 });
  fog(ctx, sm2, y0 - 230, y0 - 20, [70, 76, 96], .3, { comp: 'screen', blur: 2 });
}
function domeFrame(ctx, o = {}) {
  const D = Object.assign({}, OBS, o.dome || {});
  const ks = []; for (let k = -1; k <= 1.0001; k += .125) ks.push(+k.toFixed(3));
  const vs = [0, .2, .38, .54, .67, .78, .87, .94, 1];
  const r = rng(31);
  // panes: tint + reflections
  for (let i = 0; i < ks.length - 1; i++) for (let j = 0; j < vs.length - 1; j++) {
    const a = domePt(ks[i], vs[j], D), b = domePt(ks[i + 1], vs[j], D), c = domePt(ks[i + 1], vs[j + 1], D), d = domePt(ks[i], vs[j + 1], D);
    if (o.slit && ks[i] >= o.slit[0] && ks[i + 1] <= o.slit[1] && vs[j] >= o.slit[2]) continue;
    const t = r(); poly(ctx, [a, b, c, d], rgba([90 + t * 40, 120 + t * 30, 170], .03 + t * .05));
    if (r() < .18) { const g = ctx.createLinearGradient(a[0], a[1], c[0], c[1]); g.addColorStop(.3, 'rgba(190,210,255,0)'); g.addColorStop(.5, 'rgba(190,210,255,.07)'); g.addColorStop(.7, 'rgba(190,210,255,0)'); poly(ctx, [a, b, c, d], g); }
  }
  // wall outside the dome
  ctx.save(); ctx.beginPath(); ctx.rect(-50, -50, W + 100, H + 100); ctx.moveTo(D.cx - D.rx, D.cy); ctx.ellipse(D.cx, D.cy, D.rx, D.ry, 0, Math.PI, 2 * Math.PI); ctx.closePath(); ctx.fillStyle = '#05060a'; ctx.fill('evenodd'); ctx.restore();
  // iron
  const iron = '#04050a', hi = 'rgba(150,170,215,.22)';
  ks.forEach(k => { const pts = []; for (let v = 0; v <= 1.0001; v += .02) pts.push(domePt(k, v, D)); ctx.lineWidth = Math.abs(k) > .99 ? 26 : 7; ctx.strokeStyle = iron; ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke(); ctx.lineWidth = 1.4; ctx.strokeStyle = hi; ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0] - 3, p[1]) : ctx.moveTo(p[0] - 3, p[1])); ctx.stroke(); });
  vs.slice(1, -1).forEach(v => { const a = domePt(-1, v, D), b = domePt(1, v, D); ctx.lineWidth = 5; ctx.strokeStyle = iron; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.quadraticCurveTo(D.cx, a[1] + 14, b[0], b[1]); ctx.stroke(); ctx.lineWidth = 1.2; ctx.strokeStyle = hi; ctx.beginPath(); ctx.moveTo(a[0], a[1] - 3); ctx.quadraticCurveTo(D.cx, a[1] + 11, b[0], b[1] - 3); ctx.stroke(); });
  ks.forEach(k => vs.forEach(v => { const p = domePt(k, v, D); ctx.fillStyle = iron; ctx.beginPath(); ctx.arc(p[0], p[1], 5, 0, 7); ctx.fill(); ctx.fillStyle = 'rgba(170,190,230,.28)'; ctx.beginPath(); ctx.arc(p[0] - 1.5, p[1] - 1.5, 1.6, 0, 7); ctx.fill(); }));
}
function gasLamp(ctx, x, y, on = 1, o = {}) {
  ctx.fillStyle = '#05060a'; ctx.fillRect(x - 2.5, y, 5, (o.post || 90));
  ctx.beginPath(); ctx.moveTo(x - 9, y + 2); ctx.lineTo(x + 9, y + 2); ctx.lineTo(x + 5, y + 10); ctx.lineTo(x - 5, y + 10); ctx.fill();
  const gc = on > .02 ? rgba(mixc([60, 45, 30], [255, 226, 170], on), .95) : '#14151b';
  ctx.fillStyle = gc; ctx.beginPath(); ctx.ellipse(x, y - 10, 9, 14, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#05060a'; ctx.fillRect(x - 8, y - 27, 16, 4); ctx.beginPath(); ctx.arc(x, y - 29, 3, 0, 7); ctx.fill();
  if (on > .02) { glow(ctx, x, y - 10, 70 * (o.size || 1), [255, 205, 140], .55 * on); glow(ctx, x, y - 10, 260 * (o.size || 1), [255, 170, 90], .16 * on); }
}
function railing(ctx, y, x0, x1, o = {}) {
  const c = '#04050a'; ctx.fillStyle = c;
  ctx.fillRect(x0, y, x1 - x0, 7); ctx.fillRect(x0, y + (o.h || 80) - 6, x1 - x0, 6);
  for (let x = x0; x < x1; x += (o.step || 26)) { ctx.fillRect(x, y, 3.2, o.h || 80); ctx.beginPath(); ctx.ellipse(x + 1.6, y + (o.h || 80) * .5, 4, 9, 0, 0, 7); ctx.fill(); }
  ctx.fillStyle = 'rgba(160,180,220,.2)'; ctx.fillRect(x0, y - 1, x1 - x0, 1.2);
}
function telescope(ctx, o) {
  const { px, py, ang, L } = o; // pivot, angle (rad), length
  // pier
  poly(ctx, [[px - 30, py - 4], [px + 30, py - 4], [px + 64, o.base], [px - 64, o.base]], '#06070b');
  hgrad(ctx, px - 64, o.base - 18, 128, 18, [[0, '#06070b'], [.5, '#1a1712'], [1, '#06070b']]);
  ctx.fillStyle = '#0b0b0e'; ctx.fillRect(px - 36, py - 34, 72, 34);
  ctx.save(); ctx.translate(px, py - 40); ctx.rotate(ang);
  const r0 = o.r0 || 22, r1 = o.r1 || 31, back = o.back || 170;
  const g = ctx.createLinearGradient(0, -r1, 0, r1);
  g.addColorStop(0, '#3a4660'); g.addColorStop(.07, '#1a1a20'); g.addColorStop(.3, '#211b13'); g.addColorStop(.42, '#3a2c1a'); g.addColorStop(.55, '#1c1610'); g.addColorStop(.84, '#2a1c0e'); g.addColorStop(.93, '#b07a3c'); g.addColorStop(1, '#3a220c');
  ctx.fillStyle = g; poly(ctx, [[-back, -r0], [L, -r1], [L, r1], [-back, r0]]); ctx.fill();
  [[-back + 20, 1.08], [L * .22, 1.12], [L * .55, 1.12], [L * .82, 1.1]].forEach(([x, k]) => { const rr = lerp(r0, r1, (x + back) / (L + back)) * k; const gg = ctx.createLinearGradient(0, -rr, 0, rr); gg.addColorStop(0, '#5a6a88'); gg.addColorStop(.12, '#3a3020'); gg.addColorStop(.5, '#4a3418'); gg.addColorStop(.88, '#d7a35a'); gg.addColorStop(1, '#4a2a0e'); ctx.fillStyle = gg; ctx.fillRect(x, -rr, 12, rr * 2); });
  ctx.fillStyle = '#100c08'; ctx.fillRect(L - 4, -r1 * 1.16, 64, r1 * 2.32); ctx.fillStyle = 'rgba(160,180,220,.45)'; ctx.fillRect(L - 4, -r1 * 1.16, 64, 2.5); ctx.fillStyle = 'rgba(220,160,90,.5)'; ctx.fillRect(L - 4, r1 * 1.16 - 3, 64, 3);
  ctx.fillStyle = '#0d0a07'; ctx.fillRect(L * .45, -r1 - 26, L * .35, 11); ctx.fillStyle = 'rgba(230,200,140,.35)'; ctx.fillRect(L * .45, -r1 - 26, L * .35, 2.5);
  ctx.fillStyle = '#0a0806'; ctx.fillRect(-back - 46, -r0 * .55, 46, r0 * 1.1); ctx.fillStyle = '#8a6a3a'; ctx.fillRect(-back - 52, -r0 * .7, 8, r0 * 1.4);
  ctx.fillStyle = '#0b0b0e'; ctx.fillRect(-10, r0 * .6, 20, 70); ctx.beginPath(); ctx.arc(0, r0 * .6 + 80, 22, 0, 7); ctx.fill();
  ctx.restore();
}
function spiralStair(ctx, x, yTop, yBot, o = {}) {
  ctx.save(); ctx.strokeStyle = '#04050a'; ctx.fillStyle = '#04050a';
  ctx.fillRect(x - 5, yTop, 10, yBot - yTop);
  const n = Math.floor((yBot - yTop) / 30);
  for (let i = 0; i < n; i++) { const y = yBot - i * 30, a = i * .55; const dx = Math.sin(a) * (o.r || 70); poly(ctx, [[x, y], [x + dx, y - 6], [x + dx * 1.02, y - 12], [x, y - 8]], '#05060b'); }
  ctx.lineWidth = 2.4; ctx.beginPath(); for (let i = 0; i <= n * 6; i++) { const t = i / 6, y = yBot - t * 30 - 70, dx = Math.sin(t * .55) * (o.r || 70); i ? ctx.lineTo(x + dx, y) : ctx.moveTo(x + dx, y); } ctx.stroke();
  ctx.strokeStyle = 'rgba(160,180,220,.15)'; ctx.lineWidth = 1; ctx.beginPath(); for (let i = 0; i <= n * 6; i++) { const t = i / 6, y = yBot - t * 30 - 71, dx = Math.sin(t * .55) * (o.r || 70); i ? ctx.lineTo(x + dx, y) : ctx.moveTo(x + dx, y); } ctx.stroke();
  ctx.restore();
}
function hudTitle(ctx, num, title, tag, o = {}) {
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.85)'; ctx.shadowBlur = 14;
  ctx.fillStyle = '#ece3d1'; ctx.font = '600 44px "Cormorant SC", Georgia, serif'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(`${num}. ${title}`, 56, 92);
  ctx.fillStyle = '#d2c7b1'; ctx.font = 'italic 500 31px "Cormorant Garamond", Georgia, serif'; ctx.fillText(tag, 58, 142);
  ctx.restore();
  // brooch + bars
  const bx = 112, by = 232; ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.beginPath(); ctx.arc(bx, by, 52, 0, 7); ctx.fill();
  ctx.strokeStyle = '#c9b48c'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(bx, by, 52, 0, 7); ctx.stroke();
  ctx.strokeStyle = 'rgba(201,180,140,.45)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(bx, by, 41, 0, 7); ctx.stroke();
  ctx.strokeStyle = '#d9874a'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(bx, by, 47, -Math.PI / 2, Math.PI * .55); ctx.stroke();
  ctx.strokeStyle = '#efe2c4'; ctx.lineWidth = 2.2; poly(ctx, [[bx - 14, by - 22], [bx + 14, by - 22], [bx + 2, by], [bx + 14, by + 22], [bx - 14, by + 22], [bx - 2, by]]); ctx.stroke();
  ctx.fillStyle = '#efe2c4'; poly(ctx, [[bx - 8, by + 18], [bx + 8, by + 18], [bx, by + 9]]); ctx.fill();
  const bar = (y, w, fw, c) => { ctx.fillStyle = 'rgba(30,26,22,.85)'; ctx.fillRect(bx + 66, y, w, 9); ctx.fillStyle = c; ctx.fillRect(bx + 66, y, fw, 9); ctx.strokeStyle = '#c9b48c'; ctx.lineWidth = 1; ctx.strokeRect(bx + 66, y, w, 9); };
  bar(by - 18, 230, 150, '#c4643a'); bar(by + 8, 170, 100, '#5d7f9a');
  ctx.restore();
  if (o.count) { ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.85)'; ctx.shadowBlur = 10; ctx.fillStyle = '#ddd2bd'; ctx.font = '600 30px "Cormorant SC", Georgia, serif'; ctx.textAlign = 'right'; ctx.fillText(o.count, W - 60, H - 52); ctx.restore(); }
}
// A barely visible woman's shoulder and veil in the out-of-focus foreground (the observer).
function observer(ctx, x, y, s = 1, a = .9) {
  layer(ctx, c => { c.fillStyle = `rgba(1,1,3,${a})`; fillSpline(c, [[x - 220 * s, y + 400 * s], [x - 220 * s, y + 60 * s], [x - 120 * s, y - 40 * s], [x - 30 * s, y - 120 * s], [x + 40 * s, y - 150 * s], [x + 90 * s, y - 110 * s], [x + 100 * s, y - 40 * s], [x + 170 * s, y + 40 * s], [x + 260 * s, y + 200 * s], [x + 300 * s, y + 400 * s]], c.fillStyle, .9); }, { blur: 16 });
}

/* ================= props ================= */
function celestialGlobe(ctx, x, fy, r, o = {}) {
  ctx.save();
  ctx.fillStyle = '#060608'; poly(ctx, [[x - r * .9, fy], [x - r * .2, fy - r * 1.1], [x + r * .2, fy - r * 1.1], [x + r * .9, fy]]); ctx.fill();
  ctx.fillRect(x - r * 1.25, fy - r * 1.18, r * 2.5, r * .12);
  const cy = fy - r * 2.1; const g = ctx.createRadialGradient(x + r * .35, cy - r * .3, r * .1, x, cy, r);
  g.addColorStop(0, '#2a2a30'); g.addColorStop(.6, '#101015'); g.addColorStop(1, '#050507'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, cy, r, 0, 7); ctx.fill();
  const rr = rng(77); ctx.fillStyle = 'rgba(214,180,110,.75)'; for (let i = 0; i < 40; i++) { const a = rr() * 6.28, d = Math.sqrt(rr()) * r * .9; ctx.beginPath(); ctx.arc(x + Math.cos(a) * d, cy + Math.sin(a) * d * .9, .9 + rr() * 1.3, 0, 7); ctx.fill(); }
  ctx.strokeStyle = 'rgba(214,180,110,.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(x, cy, r * .98, r * .3, -.4, 0, 7); ctx.stroke();
  ctx.strokeStyle = '#0a0806'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(x, cy, r * 1.12, Math.PI * .62, Math.PI * 2.38); ctx.stroke();
  ctx.strokeStyle = 'rgba(230,170,100,.55)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, cy, r * 1.15, -Math.PI * .5, Math.PI * .3); ctx.stroke();
  ctx.restore();
}
function desk(ctx, x, fy, o = {}) {
  ctx.save(); ctx.fillStyle = '#060608';
  ctx.fillRect(x, fy - 92, 220, 10); ctx.fillRect(x + 8, fy - 82, 8, 82); ctx.fillRect(x + 204, fy - 82, 8, 82); ctx.fillRect(x + 20, fy - 82, 180, 26);
  const r = rng(5); for (let i = 0; i < 7; i++) { ctx.save(); ctx.translate(x + 30 + r() * 140, fy - 94); ctx.rotate((r() - .5) * .3); ctx.fillStyle = rgba([200 + r() * 30, 182, 146], .55 + r() * .25); ctx.fillRect(-26, -2, 52, 3); ctx.restore(); }
  ctx.fillStyle = '#0a0806'; ctx.fillRect(x + 160, fy - 120, 12, 26); ctx.fillStyle = rgba([255, 214, 150], .9); ctx.beginPath(); ctx.ellipse(x + 166, fy - 128, 7, 10, 0, 0, 7); ctx.fill();
  glow(ctx, x + 166, fy - 128, 120, [255, 190, 110], .5); glow(ctx, x + 166, fy - 128, 30, [255, 230, 180], .6);
  ctx.fillStyle = '#0b0a0c'; ctx.beginPath(); ctx.ellipse(x + 60, fy - 97, 11, 5, 0, 0, 7); ctx.fill(); ctx.fillRect(x + 50, fy - 108, 20, 11);
  ctx.restore();
}
function lightPool(ctx, x, y, rx, ry, color, a) { ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.translate(x, y); ctx.scale(1, ry / rx); const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx); g.addColorStop(0, rgba(color, a)); g.addColorStop(1, rgba(color, 0)); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rx, 0, 7); ctx.fill(); ctx.restore(); }

/* ================= K5 · Купол ================= */
SCENES.K5 = (ctx) => {
  nightSky(ctx, { seed: 7 });
  cityBeyond(ctx, 770);
  domeFrame(ctx, { slit: [.125, .375, .44] });
  // warm haze rising from the lamps, cold light through the open slit
  vgrad(ctx, 0, 380, W, 520, [[0, [120, 90, 60], 0], [1, [150, 105, 60], .2]]);
  shaft(ctx, [[1120, 0], [1300, 0], [930, 760], [700, 760]], [150, 175, 230], .2, .03, [1200, 0], [820, 760], 26);
  // upper catwalk and spiral stair
  ctx.fillStyle = '#04050a'; ctx.fillRect(1380, 382, 560, 12); railing(ctx, 330, 1390, 1920, { h: 52, step: 22 });
  spiralStair(ctx, 1720, 380, 905, { r: 80 });
  // gallery railing + lamps (mid plane)
  const lampX = [120, 400, 1000, 1260, 1540, 1850];
  layer(ctx, x => { railing(x, 784, -10, 1930, { h: 92, step: 24 }); }, { fog: [[40, 40, 52], .2] });
  lampX.forEach(x => gasLamp(ctx, x, 790, 1, { post: 90, size: 1.25 }));
  // floor
  vgrad(ctx, 0, 876, W, 204, [[0, '#121218'], [.35, '#0b0b10'], [1, '#030304']]);
  ctx.save(); ctx.globalAlpha = .06; ctx.strokeStyle = '#c9b48c'; for (let i = 0; i < 24; i++) { const y = 878 + Math.pow(i / 24, 1.7) * 200; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); } ctx.restore();
  lampX.forEach(x => { lightPool(ctx, x, 905, 230, 34, [255, 180, 110], .32); shaft(ctx, [[x - 9, 884], [x + 9, 884], [x + 28, 1080], [x - 28, 1080]], [255, 190, 120], .3, 0, [x, 884], [x, 1080], 6); });
  // mid props
  celestialGlobe(ctx, 300, 905, 64);
  desk(ctx, 1330, 905);
  // telescope pointing at the slit
  telescope(ctx, { px: 690, py: 720, ang: -1.0, L: 470, base: 905, r0: 19, r1: 28, back: 150 });
  shaft(ctx, [[640, 700], [760, 700], [740, 905], [630, 905]], [150, 175, 230], .06, 0, [690, 700], [690, 905], 18);
  // hero
  litFigure(ctx, c => inFig(c, 1110, 905, 128, -1, f => man(f, POSE.lookUp)), { body: '#06070b', rim: [[255, 196, 130], .8, [1.6, -.4]], rim2: [[165, 190, 235], .7, [-1.2, -.8]], halo: [[255, 180, 110], .18, 10] });
  fog(ctx, noiseCanvas(W, 260, { scale: 160, seed: 41, lo: .3, hi: .8, stretchX: 3 }), 820, 1010, [120, 110, 120], .2);
  dust(ctx, 260, [560, 120, 560, 640], 5, [200, 215, 245], { a: .35, inside: (x, y) => { const cx = 1210 - (y / 760) * 400; return Math.abs(x - cx) < 110; } });
  dust(ctx, 160, [0, 620, W, 300], 6, [255, 200, 140], { a: .3, max: 1.6 });
  layer(ctx, x => { x.fillStyle = '#010102'; x.fillRect(-20, 0, 64, H); x.fillRect(1876, 0, 64, H); x.fillRect(0, 1030, W, 80); }, { blur: 10 });
  observer(ctx, 140, 990, .9, .9);
  vignette(ctx, .45);
  const [u, ux] = mk(); hudTitle(ux, 1, 'Обсерватория «Наблюдатель»', 'Где звёзды пишут письма на стекле.', { count: 'Отголоски: 1/12' }); return u;
};

/* ================= K6 · «НЕ УХОДИ» ================= */
function starLetters(ctx, text, cx, cy, fs, seed, o = {}) {
  const [t, tx] = mk(); tx.fillStyle = '#fff'; tx.textAlign = 'center'; tx.textBaseline = 'middle'; tx.font = `700 ${fs}px "Cormorant SC", Georgia, serif`; tx.fillText(text, cx, cy);
  // soft underglow so the word stays legible
  ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.filter = blurF(22); ctx.globalAlpha = .26; ctx.drawImage(t, 0, 0, W, H); ctx.filter = blurF(6); ctx.globalAlpha = .10; ctx.drawImage(t, 0, 0, W, H); ctx.restore();
  const d = tx.getImageData(0, 0, t.width, t.height).data, step = o.step || 5, r = rng(seed);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) {
    const px = Math.round(x * S), py = Math.round(y * S); if (d[(py * t.width + px) * 4 + 3] < 120) continue;
    if (r() < (o.skip ?? .18)) continue;
    const jx = x + (r() - .5) * step * 1.6, jy = y + (r() - .5) * step * 1.6, big = Math.pow(r(), 7), s = .7 + big * 4.2, a = .35 + r() * .55;
    if (big > .4) { ctx.strokeStyle = rgba([225, 235, 255], .5); ctx.lineWidth = .7; ctx.beginPath(); ctx.moveTo(jx - s * 6, jy); ctx.lineTo(jx + s * 6, jy); ctx.moveTo(jx, jy - s * 6); ctx.lineTo(jx, jy + s * 6); ctx.stroke(); }
    const col = r() < .15 ? [255, 226, 190] : [215, 228, 255];
    const g = ctx.createRadialGradient(jx, jy, 0, jx, jy, s * 4); g.addColorStop(0, rgba(col, a)); g.addColorStop(.3, rgba(col, a * .35)); g.addColorStop(1, rgba(col, 0)); ctx.fillStyle = g; ctx.fillRect(jx - s * 4, jy - s * 4, s * 8, s * 8);
  }
  // stragglers still flying in, with short trails
  for (let i = 0; i < (o.strays || 90); i++) {
    const x = cx + (r() - .5) * fs * 7, y = cy + (r() - .5) * fs * 2.6, ang = Math.atan2(cy - y, cx - x), l = 10 + r() * 40;
    const g = ctx.createLinearGradient(x - Math.cos(ang) * l, y - Math.sin(ang) * l, x, y); g.addColorStop(0, 'rgba(210,225,255,0)'); g.addColorStop(1, 'rgba(225,235,255,.55)');
    ctx.strokeStyle = g; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x - Math.cos(ang) * l, y - Math.sin(ang) * l); ctx.lineTo(x, y); ctx.stroke();
  }
  ctx.restore();
}
SCENES.K6 = (ctx) => {
  // background: dome interior, out of focus
  layer(ctx, x => {
    nightSky(x, { seed: 17, n: 1300 });
    domeFrame(x, { dome: { cx: 760, cy: 1180, rx: 1700, ry: 1250 } });
    vgrad(x, 0, 500, W, 580, [[0, [120, 90, 60], 0], [1, [150, 105, 60], .25]]);
    railing(x, 900, -10, 1930, { h: 120, step: 34 });
    [260, 1500, 1900].forEach(lx => gasLamp(x, lx, 905, 1, { post: 120, size: 1.6 }));
    telescope(x, { px: 260, py: 760, ang: -1.05, L: 560, base: 1150, r0: 30, r1: 42, back: 230 });
  }, { blur: 3.2 });
  // hero behind the glass, looking up at the letters
  fog(ctx, noiseCanvas(W, 400, { scale: 200, seed: 51, lo: .35, hi: .85, stretchX: 2 }), 760, 1080, [110, 120, 150], .18);
  litFigure(ctx, c => inFig(c, 1230, 1190, 620, -1, f => man(f, POSE.lookUp)), { body: '#06070b', grad: [[1180, 560], [1260, 820], [20, 23, 32]], rim: [[190, 210, 250], .9, [-2.6, -1.8], .8], halo: [[150, 170, 220], .16, 18] });
  inFig(ctx, 1230, 1190, 620, -1, f => manDetails(f, POSE.lookUp, [150, 170, 215], .35));
  glow(ctx, 1258, 640, 160, [190, 210, 255], .22);
  // foreground pane: condensation, sheen, frame
  const cond = noiseCanvas(W, H, { scale: 120, seed: 61, lo: .45, hi: .9 });
  layer(ctx, x => { x.fillStyle = 'rgba(170,190,225,.10)'; x.fillRect(0, 0, W, H); x.globalCompositeOperation = 'destination-in'; x.drawImage(cond, 0, 0, W, H); }, { comp: 'screen' });
  layer(ctx, x => { const g = x.createLinearGradient(300, 0, 1100, 1080); g.addColorStop(.42, 'rgba(200,215,255,0)'); g.addColorStop(.5, 'rgba(200,215,255,.07)'); g.addColorStop(.58, 'rgba(200,215,255,0)'); x.fillStyle = g; x.fillRect(0, 0, W, H); }, { comp: 'screen' });
  starLetters(ctx, 'НЕ УХОДИ', 900, 330, 196, 3);
  glassDrops(ctx, 70, [180, 40, 1560, 980], 9, { size: 3 });
  layer(ctx, x => { x.fillStyle = '#010102'; x.fillRect(120, -20, 70, H + 40); x.fillRect(1690, -20, 80, H + 40); x.fillRect(120, 640, 1650, 34); x.fillRect(0, 1010, W, 90); }, { blur: 12 });
  vignette(ctx, .55);
};

/* ================= K7 · Гаситель ================= */
function inkWash(ctx, bx, seed) {
  const snap = snapshot(ctx), r = rng(seed);
  // wet paint running down along the boundary
  for (let x = bx - 40; x < bx + 220; x += 2) {
    const k = clamp((x - (bx - 40)) / 260), drop = Math.pow(1 - k, 1.4) * (80 + r() * 420);
    ctx.save(); ctx.globalAlpha = .9 * (1 - k) + .05; ctx.drawImage(snap, x * S, 0, 2 * S, H * S, x, drop, 2, H * (1 + (1 - k) * .25)); ctx.restore();
  }
  const edge = y => bx + Math.sin(y * .013) * 34 + Math.sin(y * .047 + 1.3) * 14 + Math.sin(y * .11) * 5;
  ctx.save();
  ctx.beginPath(); ctx.moveTo(-20, -20); for (let y = -20; y <= H + 20; y += 8) ctx.lineTo(edge(y), y); ctx.lineTo(-20, H + 20); ctx.closePath();
  const g = ctx.createLinearGradient(0, 0, bx, 0); g.addColorStop(0, '#000003'); g.addColorStop(.85, '#020208'); g.addColorStop(1, '#05050c'); ctx.fillStyle = g; ctx.fill();
  // tongues of ink hanging down past the edge
  for (let i = 0; i < 26; i++) {
    const y0 = r() * H * .85, x0 = edge(y0) - 4 + r() * 46, w = 3 + r() * 9, l = 40 + r() * 260;
    const gg = ctx.createLinearGradient(0, y0, 0, y0 + l); gg.addColorStop(0, 'rgba(2,2,7,1)'); gg.addColorStop(.85, 'rgba(2,2,7,.95)'); gg.addColorStop(1, 'rgba(2,2,7,0)');
    ctx.fillStyle = gg; ctx.fillRect(x0 - w / 2, y0, w, l); ctx.fillStyle = 'rgba(2,2,7,.95)'; ctx.beginPath(); ctx.ellipse(x0, y0 + l * .9, w * .75, w, 0, 0, 7); ctx.fill();
  }
  ctx.restore();
  stars(ctx, 260, [0, 0, bx - 20, H], seed + 3, { a: .35, inside: (x, y) => x < edge(y) - 20 });
  // torn shards of the memory drifting into the void
  for (let i = 0; i < 11; i++) {
    const sw = 40 + r() * 120, sh = 30 + r() * 110, sx = bx + 10 + r() * 260, sy = 80 + r() * 760;
    const dx = bx - 60 - r() * (bx - 120), dy = sy - 40 + r() * 80;
    ctx.save(); ctx.translate(dx, dy); ctx.rotate((r() - .5) * .7); ctx.globalAlpha = .35 + r() * .5;
    ctx.beginPath(); spline(ctx, [[0, 0], [sw * .6, -sh * .1], [sw, sh * .3], [sw * .8, sh], [sw * .2, sh * .9], [-sw * .1, sh * .4]], true, .7); ctx.clip();
    ctx.drawImage(snap, sx * S, sy * S, sw * S, sh * S, 0, 0, sw, sh); ctx.restore();
  }
}
function smoke(ctx, x, y, seed, o = {}) {
  const r = rng(seed);
  layer(ctx, c => { c.lineCap = 'round'; for (let k = 0; k < 3; k++) { c.strokeStyle = rgba([170, 175, 190], .28 - k * .07); c.lineWidth = 3 + k * 4; c.beginPath(); c.moveTo(x, y); let px = x, py = y; for (let i = 0; i < 14; i++) { py -= 12; px += Math.sin(i * .7 + k + r()) * 7 + 1.2; c.lineTo(px, py); } c.stroke(); } }, { blur: 3, comp: 'screen' });
}
SCENES.K7 = (ctx) => {
  nightSky(ctx, { seed: 23, n: 1400 });
  cityBeyond(ctx, 740, { seed: 33 });
  domeFrame(ctx, { dome: { cx: 1180, cy: 900, rx: 1500, ry: 1000 } });
  vgrad(ctx, 0, 400, W, 500, [[0, [120, 90, 60], 0], [1, [150, 105, 60], .18]]);
  cracks(ctx, 980, 190, 4, { len: 260, arms: 11, a: .4 }); cracks(ctx, 1330, 360, 8, { len: 180, arms: 8, a: .32 });
  const lamps = [[160, 0], [460, 0], [760, .12], [1050, 1], [1340, 1], [1630, 1]];
  layer(ctx, x => railing(x, 778, -10, 1930, { h: 96, step: 24 }), { fog: [[40, 40, 52], .2] });
  lamps.forEach(([x, on]) => gasLamp(ctx, x, 784, on, { post: 94, size: 1.2 }));
  smoke(ctx, 760, 748, 3);
  vgrad(ctx, 0, 874, W, 206, [[0, '#121218'], [.35, '#0b0b10'], [1, '#030304']]);
  lamps.forEach(([x, on]) => { if (on > .5) { lightPool(ctx, x, 905, 220, 32, [255, 180, 110], .3); shaft(ctx, [[x - 9, 884], [x + 9, 884], [x + 28, 1080], [x - 28, 1080]], [255, 190, 120], .3, 0, [x, 884], [x, 1080], 6); } });
  telescope(ctx, { px: 1720, py: 720, ang: -1.2, L: 420, base: 905, r0: 19, r1: 28, back: 150 });
  // falling stars: the letters breaking apart
  const fr = rng(12); ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 70; i++) { const a0 = fr() * Math.PI, d = Math.pow(fr(), .7) * 420, x = 980 + Math.cos(a0) * d * 1.3, y = 190 + Math.abs(Math.sin(a0)) * d * .9 + fr() * 60, l = 10 + fr() * 34;
    glow(ctx, x, y, 7 + fr() * 6, [225, 235, 255], .7); const g = ctx.createLinearGradient(x - l * .3, y - l, x, y); g.addColorStop(0, 'rgba(210,225,255,0)'); g.addColorStop(1, 'rgba(225,235,255,.7)'); ctx.strokeStyle = g; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(x - l * .3, y - l); ctx.lineTo(x, y); ctx.stroke(); }
  ctx.restore();
  // the Extinguisher snuffing the lamp
  const EX = 520, EY = 905, EH = 540, u = EH / 100;
  litFigure(ctx, c => inFig(c, EX, EY, EH, 1, f => extinguisher(f, { tip: [(760 - EX) / u, (EY - 760) / u], sway: 1.5 })), { body: '#030305', rim: [[160, 180, 225], .7, [-1.6, -1.2]], rim2: [[255, 190, 120], .35, [1.8, 0]] });
  const hx = EX, hy = EY - 81 * u; const hg = ctx.createRadialGradient(hx + 4, hy - 8, 2, hx, hy, 6.5 * u);
  hg.addColorStop(0, 'rgba(205,210,220,.75)'); hg.addColorStop(.7, 'rgba(110,116,130,.55)'); hg.addColorStop(1, 'rgba(60,64,74,.5)');
  ctx.fillStyle = hg; ctx.beginPath(); ctx.ellipse(hx, hy, 5.2 * u, 6.8 * u, 0, 0, 7); ctx.fill();
  ctx.fillStyle = 'rgba(255,170,90,.95)'; ctx.beginPath(); ctx.ellipse(hx, hy + 6, 4, 9, 0, 0, 7); ctx.fill();
  glow(ctx, hx, hy + 4, 60, [255, 170, 90], .55); glow(ctx, hx, hy, 160, [255, 150, 70], .12);
  // hero running toward the telescope, looking back
  litFigure(ctx, c => inFig(c, 1360, 880, 400, 1, f => man(f, POSE.run)), { body: '#06070b', rim: [[255, 196, 130], .85, [-1.8, -.6]], rim2: [[165, 190, 235], .55, [1.4, -1.2]], halo: [[255, 180, 110], .15, 12] });
  inFig(ctx, 1360, 880, 400, 1, f => manDetails(f, POSE.run, [255, 196, 130], .25));
  fog(ctx, noiseCanvas(W, 260, { scale: 160, seed: 45, lo: .3, hi: .8, stretchX: 3 }), 820, 1010, [120, 110, 120], .2);
  dust(ctx, 160, [600, 620, 1300, 300], 16, [255, 200, 140], { a: .3, max: 1.6 });
  inkWash(ctx, 360, 77);
  layer(ctx, x => { x.fillStyle = '#010102'; x.fillRect(0, 1035, W, 80); x.fillRect(1880, 0, 60, H); }, { blur: 10 });
  vignette(ctx, .5);
};

/* ================= interiors: shared props ================= */
function wallpaper(ctx, x, y, w, h, base, motif, a) {
  ctx.save(); ctx.fillStyle = base; ctx.fillRect(x, y, w, h);
  const t = document.createElement('canvas'); t.width = 72; t.height = 96; const g = t.getContext('2d');
  g.fillStyle = rgba(motif, a); g.beginPath(); g.moveTo(36, 10); g.bezierCurveTo(52, 24, 52, 44, 36, 58); g.bezierCurveTo(20, 44, 20, 24, 36, 10); g.fill();
  g.beginPath(); g.ellipse(36, 70, 4, 10, 0, 0, 7); g.fill(); g.beginPath(); g.ellipse(0, 46, 6, 6, 0, 0, 7); g.ellipse(72, 46, 6, 6, 0, 0, 7); g.fill();
  g.fillRect(35, 0, 2, 96);
  ctx.fillStyle = ctx.createPattern(t, 'repeat'); ctx.translate(x, y); ctx.fillRect(0, 0, w, h); ctx.restore();
}
function wainscot(ctx, x0, x1, y0, y1, col) {
  ctx.save(); ctx.fillStyle = col; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(x0, y0, x1 - x0, 6);
  ctx.strokeStyle = 'rgba(255,255,255,.035)'; ctx.lineWidth = 2;
  for (let x = x0 + 20; x < x1 - 60; x += 150) ctx.strokeRect(x, y0 + 24, 120, y1 - y0 - 48);
  ctx.restore();
}
function curtain(ctx, x, y, w, h, col, folds = 7, seed = 1) {
  const r = rng(seed); ctx.save(); ctx.fillStyle = rgba(col);
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); for (let i = 0; i <= 10; i++) ctx.lineTo(x + w + Math.sin(i * 1.3) * 6, y + h * i / 10); ctx.lineTo(x, y + h); ctx.closePath(); ctx.fill();
  for (let i = 0; i < folds; i++) { const fx = x + (i + .5) * w / folds + (r() - .5) * 8, fw = w / folds * .45; const g = ctx.createLinearGradient(fx - fw, 0, fx + fw, 0); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(.5, 'rgba(255,255,255,.05)'); g.addColorStop(1, 'rgba(0,0,0,.35)'); ctx.fillStyle = g; ctx.fillRect(fx - fw, y, fw * 2, h); }
  ctx.restore();
}
function crepe(ctx, x, y, w, h, seed = 3, o = {}) {
  const r = rng(seed); ctx.save();
  const pts = [[x + w * .1, y], [x + w * .5, y - 10], [x + w * .9, y], [x + w * 1.04, y + h * .3], [x + w * 1.02, y + h * .7], [x + w * 1.06, y + h], [x + w * .5, y + h + 14], [x - w * .06, y + h], [x - w * .02, y + h * .6], [x - w * .05, y + h * .25]];
  fillSpline(ctx, pts, o.col || '#050507', .8);
  ctx.clip();
  for (let i = 0; i < 9; i++) { const fx = x + w * (.05 + i * .11) + (r() - .5) * 10, fw = 8 + r() * 14; const g = ctx.createLinearGradient(fx - fw, 0, fx + fw, 0); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(.55, rgba(o.sheen || [120, 135, 170], .08 + r() * .06)); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(fx - fw, y); ctx.bezierCurveTo(fx - fw + 20, y + h * .3, fx - fw - 15, y + h * .7, fx - fw + 6, y + h + 20); ctx.lineTo(fx + fw + 6, y + h + 20); ctx.bezierCurveTo(fx + fw - 15, y + h * .7, fx + fw + 20, y + h * .3, fx + fw, y); ctx.fill(); }
  // gathered swag at the top
  ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.beginPath(); ctx.ellipse(x + w / 2, y + 20, w * .5, 26, 0, 0, 7); ctx.fill();
  ctx.restore();
}
function sectionCut(ctx, room, o = {}) {
  // dollhouse cut: thick walls/floor slab around the room
  const [x0, y0, x1, y1] = room; const c = o.col || '#060609';
  ctx.save(); ctx.fillStyle = c; ctx.beginPath(); ctx.rect(-10, -10, W + 20, H + 20); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.fill('evenodd');
  ctx.fillStyle = 'rgba(120,110,100,.05)'; for (let i = 0; i < 260; i++) { const r = rng(i * 7 + 1); const x = r() * W, y = r() * H; if (x > x0 && x < x1 && y > y0 && y < y1) continue; ctx.fillRect(x, y, 2 + r() * 10, 1); }
  ctx.strokeStyle = 'rgba(160,150,140,.10)'; ctx.lineWidth = 2; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  ctx.restore();
}
function floorBoards(ctx, y0, y1, col) {
  vgrad(ctx, 0, y0, W, y1 - y0, [[0, col], [1, '#030304']]);
  ctx.save(); ctx.strokeStyle = 'rgba(200,180,150,.05)'; ctx.lineWidth = 1; for (let i = 0; i < 14; i++) { const y = y0 + Math.pow(i / 14, 1.6) * (y1 - y0); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); } ctx.restore();
}
function hearseSil(ctx, x, base, q, col = '#040509') {
  ctx.save(); ctx.fillStyle = col; ctx.strokeStyle = col;
  for (let m = 0; m < 3; m++) { const mx = x + (27 + m * 6.5) * q; ctx.beginPath(); ctx.ellipse(mx, base - 13.5 * q, 3.2 * q, 1.5 * q, 0, Math.PI, 0); ctx.fill(); ctx.fillRect(mx - 1.1 * q, base - 13 * q, 2.2 * q, 13 * q); }
  ctx.fillRect(x, base - 16 * q, 18 * q, 10 * q); ctx.fillStyle = 'rgba(90,100,120,.6)'; ctx.fillRect(x + 2 * q, base - 14.5 * q, 14 * q, 6.5 * q); ctx.fillStyle = col;
  ctx.fillRect(x - .6 * q, base - 17.2 * q, 19.2 * q, 1.4 * q);
  [1, 6, 12, 17].forEach(p => { ctx.beginPath(); ctx.ellipse(x + p * q, base - 19.6 * q, 1.1 * q, 2.8 * q, 0, 0, 7); ctx.fill(); });
  [3, 14].forEach(p => { ctx.lineWidth = .5 * q; ctx.beginPath(); ctx.arc(x + p * q, base - 3.2 * q, 3.1 * q, 0, 7); ctx.stroke(); for (let s = 0; s < 6; s++) { const a = s / 6 * 6.28; ctx.beginPath(); ctx.moveTo(x + p * q, base - 3.2 * q); ctx.lineTo(x + p * q + Math.cos(a) * 3 * q, base - 3.2 * q + Math.sin(a) * 3 * q); ctx.stroke(); } });
  ctx.fillRect(x - 4 * q, base - 13 * q, 4.5 * q, 1.2 * q); ctx.beginPath(); ctx.ellipse(x - 1.8 * q, base - 15.6 * q, 1.5 * q, 1.9 * q, 0, 0, 7); ctx.fill(); ctx.fillRect(x - 2.9 * q, base - 20.3 * q, 2.2 * q, 2.8 * q);
  ctx.lineWidth = .5 * q; ctx.beginPath(); ctx.moveTo(x, base - 8 * q); ctx.lineTo(x - 9 * q, base - 8.5 * q); ctx.stroke();
  for (let h = 0; h < 2; h++) { const hx = x - 11 * q - h * 10 * q; ctx.beginPath(); ctx.ellipse(hx, base - 8.2 * q, 4.2 * q, 2.2 * q, 0, 0, 7); ctx.fill();
    poly(ctx, [[hx - 3 * q, base - 9.4 * q], [hx - 5.6 * q, base - 13 * q], [hx - 4.2 * q, base - 13.8 * q], [hx - 1.6 * q, base - 9.8 * q]]); ctx.fill();
    ctx.beginPath(); ctx.ellipse(hx - 6 * q, base - 12.6 * q, 1.8 * q, .9 * q, -.5, 0, 7); ctx.fill(); ctx.beginPath(); ctx.ellipse(hx - 5 * q, base - 15.4 * q, .6 * q, 1.6 * q, 0, 0, 7); ctx.fill();
    ctx.lineWidth = .7 * q; [[-2.8, .4], [-2, -.6], [2.6, .8], [3.4, -.4]].forEach(([lx, sw]) => { ctx.beginPath(); ctx.moveTo(hx + lx * q, base - 6.6 * q); ctx.lineTo(hx + lx * q + sw * q, base); ctx.stroke(); }); }
  ctx.restore();
}
// Night street seen through a window. rect = [x, y, w, h]; streetY = absolute y of the street line.
function streetView(ctx, rect, o = {}) {
  const [x, y, w, h] = rect; ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  vgrad(ctx, x, y, w, h, [[0, '#0b1222'], [.6, '#141c2c'], [1, '#1b2232']]);
  const r = rng(o.seed || 5); const sy = o.streetY || (y + h * .82);
  // opposite houses
  ctx.fillStyle = '#080b13'; let hx = x - 20; while (hx < x + w) { const bw = 120 + r() * 160, bh = 200 + r() * 260; ctx.fillRect(hx, sy - bh, bw, bh); poly(ctx, [[hx - 6, sy - bh], [hx + bw * .5, sy - bh - 40 - r() * 30], [hx + bw + 6, sy - bh]], '#080b13'); for (let wy = sy - bh + 40; wy < sy - 40; wy += 70) for (let wx = hx + 18; wx < hx + bw - 30; wx += 46) { const lit = r() < .12; ctx.fillStyle = lit ? 'rgba(255,196,120,.85)' : 'rgba(30,38,56,.8)'; ctx.fillRect(wx, wy, 18, 30); } ctx.fillStyle = '#080b13'; hx += bw + 10; }
  if (o.windowAcross) { const [wx, wy] = o.windowAcross; ctx.fillStyle = 'rgba(255,190,110,.9)'; ctx.fillRect(wx, wy, 26, 38); ctx.fillStyle = '#100a06'; ctx.beginPath(); ctx.ellipse(wx + 9, wy + 20, 3.4, 4.2, 0, 0, 7); ctx.fill(); ctx.fillRect(wx + 5, wy + 24, 8, 14); ctx.fillRect(wx + 15, wy + 30, 11, 5); glow(ctx, wx + 13, wy + 19, 40, [255, 180, 100], .4); }
  // street + lamp
  vgrad(ctx, x, sy, w, y + h - sy, [[0, '#121722'], [1, '#0b0e15']]);
  if (o.lamp) { const [lx, ly] = o.lamp; ctx.fillStyle = '#05070b'; ctx.fillRect(lx - 2, ly, 4, sy - ly); ctx.fillStyle = 'rgba(255,214,150,.95)'; ctx.fillRect(lx - 6, ly - 14, 12, 14); glow(ctx, lx, ly - 7, 220, [255, 190, 110], .55); glow(ctx, lx, ly - 7, 40, [255, 230, 180], .8); lightPool(ctx, lx, sy + 14, 180, 18, [255, 190, 120], .45); }
  if (o.hearse) hearseSil(ctx, o.hearse[0], sy + 4, o.hearse[1]);
  if (o.lamplighter) { const [lx, s, tip] = o.lamplighter; inFig(ctx, lx, sy, 150 * s, 1, f => { f.fillStyle = '#04050a'; extinguisher(f, { tip: tip || [40, 70] }); }); }
  rain(ctx, 380, [x, y, w, h], 7, { len: 26, a: .3, slant: -.08 });
  ctx.restore();
}
function trunk(ctx, x, fy, w, h) {
  ctx.save();
  const g = ctx.createLinearGradient(0, fy - h, 0, fy); g.addColorStop(0, '#2a1f14'); g.addColorStop(1, '#120c07'); ctx.fillStyle = g; ctx.fillRect(x, fy - h, w, h);
  ctx.fillStyle = '#1d150d'; ctx.beginPath(); ctx.moveTo(x, fy - h); ctx.quadraticCurveTo(x + w / 2, fy - h - 26, x + w, fy - h); ctx.fill();
  ctx.fillStyle = '#0a0705'; [.18, .82].forEach(k => ctx.fillRect(x + w * k - 6, fy - h - 18, 12, h + 18)); ctx.fillRect(x, fy - h * .55, w, 7);
  ctx.fillStyle = '#7a5e34'; [[x + 8, fy - h + 8], [x + w - 16, fy - h + 8], [x + 8, fy - 16], [x + w - 16, fy - 16]].forEach(([cx, cy]) => ctx.fillRect(cx, cy, 8, 8));
  ctx.fillStyle = '#c9a868'; ctx.font = '600 18px "Cormorant SC", Georgia, serif'; ctx.fillText('Э. М.', x + w * .42, fy - h * .3);
  label(ctx, x + w * .6, fy - h * .74, 160, 84, -.06, [['«ПЕНЕЛОПА»', '600 19px "Cormorant SC", Georgia, serif', 20], ['Нижние доки Вельмора —', 'italic 500 14px "Cormorant Garamond", Georgia, serif', 42], ['о. Солмар · сент. 882', 'italic 500 14px "Cormorant Garamond", Georgia, serif', 62]], { paper: '#a8977a' });
  ctx.restore();
}

/* ================= K1 · Пробуждение ================= */
function bed(ctx, x0, x1, top, fy) {
  ctx.save();
  // canopy posts and rail
  ctx.fillStyle = '#07070b'; [x0, x1].forEach(px => { ctx.fillRect(px - 9, top, 18, fy - top); ctx.beginPath(); ctx.ellipse(px, top - 6, 13, 13, 0, 0, 7); ctx.fill(); });
  ctx.fillRect(x0 - 12, top, x1 - x0 + 24, 22);
  curtain(ctx, x0 - 6, top + 18, 120, fy - top - 150, [16, 17, 26], 5, 4);
  // carved headboard and footboard
  fillSpline(ctx, [[x0 - 14, fy - 40], [x0 - 14, fy - 360], [x0 + 20, fy - 392], [x0 + 52, fy - 360], [x0 + 52, fy - 40]], '#0a0a0f', .8);
  ctx.fillRect(x1 - 30, fy - 300, 40, 300);
  ctx.fillStyle = 'rgba(150,170,215,.12)'; ctx.fillRect(x1 - 30, fy - 300, 3, 300); ctx.fillRect(x0 + 50, fy - 360, 2, 320);
  // mattress and frame
  ctx.fillStyle = '#0c0c12'; ctx.fillRect(x0, fy - 200, x1 - x0, 110);
  ctx.restore();
}
function hanky(ctx, x, y, ang) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
  fillSpline(ctx, [[-22, -16], [-4, -24], [16, -18], [24, -4], [20, 14], [26, 34], [12, 40], [2, 26], [-10, 30], [-20, 16], [-26, 0]], '#cfcbc2', .8);
  ctx.strokeStyle = 'rgba(90,90,100,.45)'; ctx.lineWidth = 1.2; [[[-14, -12], [-6, 18]], [[4, -16], [8, 24]], [[14, -8], [16, 32]]].forEach(([a, b]) => { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.quadraticCurveTo((a[0] + b[0]) / 2 + 4, (a[1] + b[1]) / 2, b[0], b[1]); ctx.stroke(); });
  fillSpline(ctx, [[-12, -10], [2, -16], [14, -8], [12, 6], [16, 18], [6, 22], [-4, 12], [-14, 6]], '#9c0f17', .9);
  fillSpline(ctx, [[-4, -6], [6, -9], [9, 2], [2, 8], [-6, 3]], '#c3121c', .9);
  ctx.fillStyle = '#c3121c'; [[18, 26, 2.2], [-18, 12, 1.6], [10, 34, 1.8]].forEach(([dx, dy, r]) => { ctx.beginPath(); ctx.arc(dx, dy, r, 0, 7); ctx.fill(); });
  ctx.restore();
}
SCENES.K1 = (ctx) => {
  const room = [80, 110, 1840, 990];
  wallpaper(ctx, 0, 0, W, H, '#121722', [140, 160, 200], .055);
  wainscot(ctx, 0, W, 690, 950, '#0c0e15');
  vgrad(ctx, 0, 110, W, 60, [[0, '#07080c'], [1, 'rgba(7,8,12,0)']]);
  // moonlight patch on the wall behind the hero (keeps his silhouette readable)
  lightPool(ctx, 420, 470, 260, 240, [120, 140, 190], .22);
  // window with night street
  const win = [1390, 230, 300, 520];
  streetView(ctx, win, { streetY: 700, lamp: [1500, 520], seed: 11, windowAcross: [1620, 410] });
  ctx.fillStyle = '#06070b'; ctx.fillRect(win[0] - 14, win[1] - 14, win[2] + 28, 14); ctx.fillRect(win[0] - 14, win[1] + win[3], win[2] + 28, 22); ctx.fillRect(win[0] - 14, win[1], 14, win[3]); ctx.fillRect(win[0] + win[2], win[1], 14, win[3]); ctx.fillRect(win[0] + win[2] / 2 - 5, win[1], 10, win[3]); ctx.fillRect(win[0], win[1] + win[3] * .45, win[2], 9);
  glassDrops(ctx, 60, win, 4, { size: 2.2 });
  curtain(ctx, 1300, 170, 110, 640, [16, 18, 28], 5, 2); curtain(ctx, 1680, 170, 120, 640, [16, 18, 28], 5, 3);
  // fireplace with the stopped clock
  ctx.fillStyle = '#0d0d13'; ctx.fillRect(1050, 560, 250, 390); ctx.fillStyle = '#040406'; ctx.fillRect(1095, 660, 160, 290); ctx.fillStyle = '#12121a'; ctx.fillRect(1030, 548, 290, 18);
  vgrad(ctx, 1095, 870, 160, 80, [[0, [120, 40, 10], 0], [1, [190, 70, 20], .8]]);
  glow(ctx, 1175, 935, 260, [255, 110, 40], .38); glow(ctx, 1175, 940, 60, [255, 150, 60], .6);
  ctx.fillStyle = '#0e0b08'; poly(ctx, [[1150, 548], [1158, 470], [1192, 452], [1226, 470], [1234, 548]]); ctx.fill(); clockFace(ctx, 1192, 500, 24, 17, 42);
  [1080, 1290].forEach(x => { ctx.fillStyle = '#0b0b10'; ctx.fillRect(x - 4, 500, 8, 48); });
  // cheval mirror under crepe: carved crest above, feet below
  ctx.fillStyle = '#0d0c10'; ctx.fillRect(900, 300, 170, 650); fillSpline(ctx, [[892, 300], [930, 262], [985, 244], [1040, 262], [1078, 300]], '#0d0c10', .8);
  ctx.fillRect(880, 930, 210, 14); ctx.fillStyle = 'rgba(150,170,215,.14)'; ctx.fillRect(1074, 300, 3, 640);
  crepe(ctx, 892, 292, 186, 610, 5);
  // moonlight shafts
  shaft(ctx, [[1390, 300], [1690, 300], [1180, 950], [560, 950]], [150, 175, 230], .24, .03, [1540, 300], [870, 950], 22);
  // nightstand: glass, spoon, laudanum
  ctx.fillStyle = '#0a0a0f'; ctx.fillRect(90, 760, 90, 190); ctx.fillRect(84, 750, 102, 12);
  ctx.fillStyle = 'rgba(200,210,230,.35)'; ctx.fillRect(100, 712, 20, 38); ctx.fillStyle = '#2a1408'; ctx.fillRect(140, 718, 16, 32); ctx.fillRect(144, 708, 8, 10); ctx.fillStyle = 'rgba(220,200,170,.5)'; ctx.fillRect(142, 728, 12, 10);
  // bed
  bed(ctx, 190, 820, 200, 950);
  vgrad(ctx, 210, 700, 600, 52, [[0, '#a7adbd'], [1, '#5c6375']]);
  fillSpline(ctx, [[214, 640], [296, 620], [346, 660], [286, 702], [216, 702]], '#8f96a8', .9);
  ctx.fillStyle = 'rgba(80,6,10,.75)'; ctx.beginPath(); ctx.ellipse(300, 664, 15, 7, .3, 0, 7); ctx.fill();
  // Elias sitting up, coughing into the handkerchief
  const ex = 400, ey = 716, eh = 640, u = eh / 100;
  litFigure(ctx, c => inFig(c, ex, ey, eh, 1, f => man(f, POSE.sitCough)), { body: '#07080c', grad: [[ex, ey - 300], [ex + 60, ey], [24, 28, 40]], rim: [[175, 198, 240], .9, [2, -1.4]], rim2: [[255, 140, 70], .25, [-1.6, 0]], halo: [[120, 140, 190], .12, 10] });
  inFig(ctx, ex, ey, eh, 1, f => manDetails(f, POSE.sitCough, [175, 198, 240], .3));
  // blanket over the legs (dark wine wool)
  const bl = [[ex - 80, 704], [ex + 30, 694], [ex + 160, 674], [ex + 250, 690], [ex + 400, 698], [ex + 420, 740], [ex - 80, 742]];
  fillSpline(ctx, bl, '#2b1a20', .8); ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = .35; fillSpline(ctx, bl.map(p => [p[0], p[1] - 2]).slice(0, 5).concat([[ex + 400, 712], [ex - 80, 712]]), '#5a6a90', .8); ctx.restore();
  hanky(ctx, ex + 12 * u, ey - 34.6 * u, -.35);
  ctx.fillStyle = '#9c0f17'; ctx.beginPath(); ctx.ellipse(ex + 120, 700, 5, 2.6, 0, 0, 7); ctx.fill();
  // the empty bentwood chair, still rocking: double exposure
  const chx = 700, chy = 972;
  ctx.save(); ctx.globalAlpha = .4; bentwoodChair(ctx, chx, chy, 330, '#4a5068', 6, .09); ctx.restore();
  bentwoodChair(ctx, chx, chy, 330, '#090a10', 7, -.02);
  bentwoodChair(ctx, chx + 2.5, chy - 1, 330, 'rgba(170,190,235,.5)', 1.6, -.02);
  ctx.save(); ctx.translate(chx, chy); ctx.rotate(-.02); fillSpline(ctx, [[-70, -288], [-44, -304], [-14, -284], [-4, -206], [-20, -160], [-40, -172], [-56, -214]], '#040406', .8);
  ctx.strokeStyle = 'rgba(170,190,235,.35)'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(-44, -304); ctx.quadraticCurveTo(-10, -286, -4, -206); ctx.stroke(); ctx.restore();
  floorBoards(ctx, 950, 990, '#14141b');
  lightPool(ctx, 940, 965, 420, 30, [150, 175, 230], .35); lightPool(ctx, 1175, 960, 260, 26, [255, 120, 50], .3);
  dust(ctx, 340, [560, 300, 1140, 650], 21, [200, 215, 245], { a: .4, inside: (x, y) => { const t = (y - 300) / 650; return x > lerp(1390, 560, t) && x < lerp(1690, 1180, t); } });
  fog(ctx, noiseCanvas(W, 300, { scale: 180, seed: 77, lo: .35, hi: .85, stretchX: 2.5 }), 780, 1000, [110, 125, 160], .12);
  sectionCut(ctx, room);
  observer(ctx, 1790, 1030, .9, .85);
  vignette(ctx, .42);
};


/* ================= K2 · Отражение ================= */
SCENES.K2 = (ctx) => {
  wallpaper(ctx, 0, 0, W, H, '#11161f', [140, 160, 200], .05);
  wainscot(ctx, 0, W, 760, 1010, '#0b0d14');
  const win = [830, 100, 680, 760];
  streetView(ctx, win, { streetY: 760, lamp: [1410, 560], seed: 19, hearse: [1250, 5.4], lamplighter: [1140, 1.05, [38, 70]], windowAcross: [1410, 330] });
  // reflection of the room on the glass: the chair and the woman who is not in the room
  layer(ctx, x => {
    x.save(); x.beginPath(); x.rect(...win); x.clip();
    bentwoodChair(x, 990, 850, 300, 'rgba(175,195,230,1)', 5, 0);
    inFig(x, 990, 846, 360, 1, f => { f.fillStyle = 'rgba(175,195,230,1)'; woman(f, 'sit'); });
    x.fillStyle = 'rgba(175,195,230,.5)'; x.fillRect(860, 300, 16, 560);
    x.restore();
  }, { comp: 'screen', alpha: .17, blur: 1.2 });
  // faint reflection of the hero's own face
  layer(ctx, x => inFig(x, 860, 1010, 620, -1, f => { f.fillStyle = 'rgba(150,170,210,1)'; man(f, POSE.stand); }), { comp: 'screen', alpha: .06, blur: 3 });
  glassDrops(ctx, 140, win, 13, { size: 3 });
  // window frame
  const [wx, wy, ww, wh] = win; ctx.fillStyle = '#06070b';
  ctx.fillRect(wx - 22, wy - 22, ww + 44, 22); ctx.fillRect(wx - 22, wy + wh, ww + 44, 34); ctx.fillRect(wx - 22, wy, 22, wh); ctx.fillRect(wx + ww, wy, 22, wh); ctx.fillRect(wx + ww / 2 - 8, wy, 16, wh); ctx.fillRect(wx, wy + wh * .48, ww, 14);
  ctx.fillStyle = 'rgba(160,180,225,.18)'; ctx.fillRect(wx - 22, wy + wh, ww + 44, 2);
  curtain(ctx, 700, 50, 150, 900, [16, 18, 28], 6, 6); curtain(ctx, 1500, 50, 170, 900, [16, 18, 28], 6, 7);
  // the real room: shrouded mirror, empty chair, bedpost
  ctx.fillStyle = '#0b0b10'; ctx.fillRect(380, 250, 150, 760); crepe(ctx, 372, 236, 166, 700, 9);
  ctx.fillStyle = '#08080c'; ctx.fillRect(40, 120, 26, 890); ctx.beginPath(); ctx.ellipse(53, 116, 18, 18, 0, 0, 7); ctx.fill();
  bentwoodChair(ctx, 225, 1010, 330, '#0a0b11', 7, 0); bentwoodChair(ctx, 222, 1009, 330, 'rgba(170,190,235,.45)', 1.6, 0);
  ctx.save(); ctx.translate(225, 1010); fillSpline(ctx, [[-70, -288], [-44, -304], [-14, -284], [-4, -206], [-20, -160], [-40, -172], [-56, -214]], '#040406', .8); ctx.restore();
  // moonlight through the window over the hero onto the floor
  shaft(ctx, [[830, 160], [1510, 160], [900, 1010], [240, 1010]], [150, 175, 230], .18, .03, [1170, 160], [570, 1010], 26);
  floorBoards(ctx, 1010, 1080, '#14141b');
  lightPool(ctx, 600, 1030, 420, 34, [150, 175, 230], .35);
  // the hero at the window
  litFigure(ctx, c => inFig(c, 690, 1010, 620, 1, f => man(f, POSE.stand)), { body: '#07080c', grad: [[740, 420], [660, 760], [26, 30, 44]], rim: [[175, 198, 240], .95, [2.4, -1.2], .8], halo: [[120, 140, 190], .14, 14] });
  inFig(ctx, 690, 1010, 620, 1, f => manDetails(f, POSE.stand, [175, 198, 240], .3));
  dust(ctx, 300, [240, 160, 1270, 850], 31, [200, 215, 245], { a: .4, inside: (x, y) => { const t = (y - 160) / 850; return x > lerp(830, 240, t) && x < lerp(1510, 900, t); } });
  layer(ctx, x => { x.fillStyle = '#010102'; fillSpline(x, [[1700, 1100], [1720, 900], [1820, 820], [1960, 800], [1960, 1100]], '#010102', .8); }, { blur: 14 });
  vignette(ctx, .45);
  return subtitle('— Кого-то хоронят.');
};

/* ================= UI: subtitles in her handwriting ================= */
function subtitle(text, o = {}) {
  const [u, x] = mk(); x.save(); x.textAlign = 'center'; x.font = `${o.size || 46}px "Marck Script", cursive`;
  x.shadowColor = 'rgba(0,0,0,.9)'; x.shadowBlur = 12; x.fillStyle = o.col || '#efe6d4'; x.fillText(text, W / 2, o.y || 1000); x.restore(); return u;
}
POSE.shove = {
  head: { x: 16.4, y: 70.4, tilt: .22 }, neck: [12.6, 64.4], chest: [8.4, 58.4], hip: [-6, 40], sh: [10.6, 60.4], shB: [8.4, 60.4],
  knN: [4.4, 23.6], anN: [.6, 3], toN: [8.6, 1], knB: [-14.4, 21.6], anB: [-24.4, 5.4], toB: [-17, .8],
  elN: [17.6, 49.6], haN: [24, 44.6], elB: [16.4, 51.4], haB: [22.6, 47.4], capeFlare: 3,
  coat: [[6.4, 66.6], [.4, 62.4], [-6, 52], [-12, 38], [-18.6, 25.6], [-20.6, 21], [-6, 18.6], [5, 18.6], [9.4, 22], [12, 34], [14, 50], [14.6, 60], [13.6, 64]]
};

/* ================= K3 · Зеркало ================= */
SCENES.K3 = (ctx) => {
  wallpaper(ctx, 0, 0, W, H, '#0e121b', [140, 160, 200], .045);
  wainscot(ctx, 0, W, 760, 1050, '#0a0c12');
  // the cheval mirror, very tall from this low camera
  const mx = 870, mw = 400;
  ctx.fillStyle = '#0e0d12'; ctx.fillRect(mx, -40, mw, 1090); fillSpline(ctx, [[mx - 20, 30], [mx + 80, -40], [mx + mw / 2, -70], [mx + mw - 80, -40], [mx + mw + 20, 30]], '#0e0d12', .8);
  ctx.fillStyle = 'rgba(150,170,215,.16)'; ctx.fillRect(mx + mw - 6, -20, 4, 1060);
  crepe(ctx, mx - 6, -60, mw + 12, 1090, 21, { sheen: [140, 155, 195] });
  // a sliver of glass where the crepe is lifted: something pale looks back
  layer(ctx, x => { x.save(); x.beginPath(); x.moveTo(mx + 2, 330); x.quadraticCurveTo(mx + 62, 470, mx + 40, 660); x.lineTo(mx + 2, 660); x.closePath(); x.clip();
    vgrad(x, mx, 330, 70, 330, [[0, '#18202f'], [1, '#0c111b']]);
    x.fillStyle = 'rgba(200,208,225,.42)'; x.beginPath(); x.ellipse(mx + 30, 452, 10, 14, 0, 0, 7); x.fill();
    x.fillStyle = 'rgba(10,10,14,.95)'; x.beginPath(); x.ellipse(mx + 34, 448, 2.6, 1.6, 0, 0, 7); x.fill();
    x.fillStyle = 'rgba(20,20,26,.85)'; x.fillRect(mx + 14, 470, 40, 190);
    x.restore(); }, { blur: .6 });
  ctx.strokeStyle = 'rgba(150,165,205,.35)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(mx + 4, 326); ctx.quadraticCurveTo(mx + 66, 470, mx + 42, 664); ctx.stroke();
  // diagonal band of moonlight across the crepe
  shaft(ctx, [[1500, -40], [1720, -40], [880, 1050], [600, 1050]], [150, 175, 230], .24, .05, [1600, 0], [740, 1050], 30);
  glow(ctx, 1620, 1080, 520, [255, 110, 40], .22);
  // the hero reaching, his hand closing on the crepe and stopping
  const hx = 640, hy = 1070, hh = 900;
  litFigure(ctx, c => inFig(c, hx, hy, hh, 1, f => man(f, POSE.reach)), { body: '#05060a', grad: [[720, 250], [600, 620], [16, 19, 28]], rim: [[175, 198, 240], .85, [2, -1.2], .9], halo: [[120, 140, 190], .1, 16] });
  inFig(ctx, hx, hy, hh, 1, f => manDetails(f, POSE.reach, [175, 198, 240], .14));
  // fingers on the cloth
  const fx = hx + 26 * hh / 100, fy = hy - 73.5 * hh / 100;
  ctx.save(); ctx.fillStyle = '#07080c'; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.ellipse(fx + 18 + i * 2, fy - 12 + i * 9, 13, 4.2, .25, 0, 7); ctx.fill(); } ctx.strokeStyle = 'rgba(175,198,240,.55)'; ctx.lineWidth = 1.2; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.ellipse(fx + 18 + i * 2, fy - 12 + i * 9, 13, 4.2, .25, -1.2, .4); ctx.stroke(); } ctx.restore();
  dust(ctx, 260, [560, 0, 1200, 1050], 41, [200, 215, 245], { a: .45, inside: (x, y) => { const t = y / 1050; return x > lerp(1500, 600, t) && x < lerp(1720, 880, t); } });
  floorBoards(ctx, 1050, 1080, '#101016');
  layer(ctx, x => { x.fillStyle = '#010102'; x.fillRect(-20, -20, 160, H + 40); x.beginPath(); x.ellipse(70, 140, 60, 60, 0, 0, 7); x.fill(); }, { blur: 16 });
  vignette(ctx, .55);
  return subtitle('— Не надо.');
};

/* ================= K4 · Сундук ================= */
function maid(ctx, x, fy, h, o = {}) {
  litFigure(ctx, c => inFig(c, x, fy, h, 1, f => woman(f, 'maid')), { body: '#0b0a0c', rim: [[255, 196, 130], .8, [1.6, -.6]], halo: [[255, 180, 110], .2, 10] });
  const u = h / 100, tx = x + 10 * u, ty = fy - 61 * u;
  ctx.save(); ctx.fillStyle = '#4a3a26'; ctx.fillRect(tx - 22, ty - 2, 64, 4); ctx.fillStyle = '#d8d2c4';
  [[tx - 12, ty], [tx + 6, ty]].forEach(([cx, cy], i) => { if (o.cups === 1 && i === 1) return; ctx.fillRect(cx, cy - 12, 11, 12); ctx.beginPath(); ctx.ellipse(cx + 5.5, cy, 9, 2.2, 0, 0, 7); ctx.fill(); });
  ctx.fillStyle = '#e8dcc0'; ctx.fillRect(tx + 28, ty - 22, 5, 20); ctx.fillStyle = 'rgba(255,214,140,.95)'; ctx.beginPath(); ctx.ellipse(tx + 30.5, ty - 28, 3.4, 6.4, 0, 0, 7); ctx.fill();
  ctx.restore(); glow(ctx, tx + 30, ty - 28, 220, [255, 180, 100], .4); glow(ctx, tx + 30, ty - 28, 36, [255, 230, 170], .7);
}
SCENES.K4 = (ctx) => {
  const room = [110, 70, 1810, 1040];
  wallpaper(ctx, 0, 0, W, H, '#16150f', [190, 170, 120], .045);
  wainscot(ctx, 0, W, 720, 900, '#0e0d0b');
  // archway to the corridor where the maid walks
  const ax0 = 330, ax1 = 760, at = 360;
  layer(ctx, x => {
    x.save(); x.beginPath(); x.moveTo(ax0, 900); x.lineTo(ax0, at + 110); x.quadraticCurveTo((ax0 + ax1) / 2, at - 40, ax1, at + 110); x.lineTo(ax1, 900); x.closePath(); x.clip();
    wallpaper(x, ax0, at - 60, ax1 - ax0, 960, '#1b1912', [200, 180, 130], .05);
    [[420, 520], [640, 500]].forEach(([px, py]) => { x.fillStyle = '#0d0c0a'; x.fillRect(px - 50, py - 70, 100, 130); crepe(x, px - 56, py - 76, 112, 120, px); });
    x.fillStyle = 'rgba(90,140,255,.9)'; x.beginPath(); x.ellipse(530, 470, 4, 7, 0, 0, 7); x.fill(); glow(x, 530, 470, 60, [80, 130, 255], .35);
    floorBoards(x, 860, 900, '#17150f');
    maid(x, 560, 872, 300);
    x.restore();
  }, { fog: [[40, 34, 28], .25] });
  ctx.strokeStyle = '#090807'; ctx.lineWidth = 26; ctx.beginPath(); ctx.moveTo(ax0, 900); ctx.lineTo(ax0, at + 110); ctx.quadraticCurveTo((ax0 + ax1) / 2, at - 40, ax1, at + 110); ctx.lineTo(ax1, 900); ctx.stroke();
  // sconce with the gas turned down to a blue flame
  ctx.fillStyle = '#0b0a08'; ctx.fillRect(1000, 430, 8, 50); ctx.fillStyle = 'rgba(90,140,255,.9)'; ctx.beginPath(); ctx.ellipse(1004, 422, 5, 9, 0, 0, 7); ctx.fill(); glow(ctx, 1004, 422, 110, [80, 130, 255], .35);
  // stairs up to the roof hatch; cold starlight pouring down
  const steps = 13; for (let i = 0; i < steps; i++) { const x = 1240 + i * 36, y = 900 - i * 40; ctx.fillStyle = '#0a0907'; ctx.fillRect(x, y - 40, 40, 900 - y + 40); ctx.fillStyle = 'rgba(160,180,225,.18)'; ctx.fillRect(x, y - 40, 40, 2); }
  ctx.fillStyle = '#050504'; ctx.fillRect(1560, 300, 260, 70); ctx.fillStyle = 'rgba(160,185,235,.9)'; ctx.fillRect(1600, 300, 180, 10);
  shaft(ctx, [[1600, 305], [1780, 305], [1500, 900], [1080, 900]], [150, 175, 230], .22, .02, [1690, 305], [1290, 900], 24);
  ctx.strokeStyle = '#0b0a08'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(1230, 780); ctx.lineTo(1720, 230); ctx.stroke();
  for (let i = 0; i < 12; i++) { const x = 1250 + i * 40, y = 860 - i * 45; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 80); ctx.stroke(); }
  // landing floor and the stair going down into ink
  floorBoards(ctx, 900, 940, '#17150f');
  ctx.fillStyle = '#0c0b09'; ctx.fillRect(110, 900, 222, 160);
  for (let i = 0; i < 6; i++) { const x = 330 - i * 40, y = 900 + i * 26; ctx.fillStyle = '#16140f'; ctx.fillRect(x - 40, y, 40, 1060 - y); ctx.fillStyle = 'rgba(220,190,140,.14)'; ctx.fillRect(x - 40, y, 40, 2.5); }
  vgrad(ctx, 110, 985, 222, 75, [[0, '#020206'], [1, '#000002']]);
  ctx.fillStyle = 'rgba(255,190,110,.25)'; ctx.fillRect(170, 992, 60, 3);
  ctx.save(); ctx.strokeStyle = 'rgba(150,170,215,.4)'; ctx.lineWidth = 1.2; [[220, 1004, 30], [220, 1004, 60], [220, 1004, 92]].forEach(([x, y, r]) => { ctx.beginPath(); ctx.ellipse(x, y, r, r * .12, 0, 0, 7); ctx.stroke(); }); ctx.restore();
  // the trunk of the expedition that never left
  trunk(ctx, 868, 900, 240, 172);
  lightPool(ctx, 980, 905, 260, 20, [150, 175, 230], .3);
  // the hero shoving the trunk with his shoulder
  litFigure(ctx, c => inFig(c, 770, 900, 390, 1, f => man(f, POSE.shove)), { body: '#08080b', rim: [[175, 198, 240], .85, [1.6, -1.8]], rim2: [[255, 190, 120], .45, [-1.8, 0]], halo: [[255, 180, 110], .12, 10] });
  inFig(ctx, 770, 900, 390, 1, f => manDetails(f, POSE.shove, [175, 198, 240], .3));
  dust(ctx, 220, [1080, 300, 700, 600], 51, [200, 215, 245], { a: .4, inside: (x, y) => { const t = (y - 305) / 595; return x > lerp(1600, 1080, t) && x < lerp(1780, 1500, t); } });
  fog(ctx, noiseCanvas(W, 300, { scale: 170, seed: 7, lo: .35, hi: .85, stretchX: 2.5 }), 820, 1000, [120, 110, 100], .14);
  sectionCut(ctx, room, { col: '#070605' });
  vignette(ctx, .45);
};

/* ================= K8 · Театр из седьмого ряда ================= */
SCENES.K8 = (ctx, o = {}) => {
  vgrad(ctx, 0, 0, W, H, [[0, '#0b0806'], [1, '#050403']]);
  // painted ceiling sliver: stars and a mirrored Orion
  vgrad(ctx, 0, 0, W, 120, [[0, '#0d1424'], [1, '#090c14']]);
  stars(ctx, 120, [0, 0, W, 110], 81, { a: .5 });
  const ori = [[1020, 22, 4], [900, 30, 3], [975, 58, 3], [955, 62, 3], [935, 66, 3], [1010, 98, 4], [905, 92, 3]];
  ctx.save(); ctx.fillStyle = '#d8b56a'; ori.forEach(([x, y, r]) => { ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); glow(ctx, x, y, r * 6, [230, 190, 110], .5); }); ctx.strokeStyle = 'rgba(216,181,106,.18)'; ctx.lineWidth = 1; ctx.beginPath(); [[1020, 22], [975, 58], [935, 66], [905, 92]].forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.moveTo(900, 30); ctx.lineTo(935, 66); ctx.moveTo(975, 58); ctx.lineTo(1010, 98); ctx.stroke(); ctx.restore();
  ctx.fillStyle = '#0a0806'; ctx.fillRect(0, 112, W, 16);
  // stage opening: painted clouds lit by the spot
  const ox0 = 500, ox1 = 1420, oy0 = 190, oy1 = 700;
  ctx.save(); ctx.beginPath(); ctx.moveTo(ox0, oy1); ctx.lineTo(ox0, oy0 + 80); ctx.quadraticCurveTo((ox0 + ox1) / 2, oy0 - 70, ox1, oy0 + 80); ctx.lineTo(ox1, oy1); ctx.closePath(); ctx.clip();
  vgrad(ctx, ox0, oy0 - 80, ox1 - ox0, oy1 - oy0 + 80, [[0, '#2a241d'], [.7, '#4b3f31'], [1, '#2a221a']]);
  const cl = noiseCanvas(W, H, { scale: 150, seed: 91, lo: .4, hi: .8 });
  layer(ctx, x => { x.fillStyle = 'rgba(220,200,165,.55)'; x.fillRect(ox0, oy0 - 80, ox1 - ox0, 560); x.globalCompositeOperation = 'destination-in'; x.drawImage(cl, 0, 0, W, H); }, { comp: 'screen' });
  layer(ctx, x => { x.fillStyle = 'rgba(40,30,22,.6)'; x.fillRect(ox0, oy0 + 200, ox1 - ox0, 300); x.globalCompositeOperation = 'destination-in'; x.drawImage(noiseCanvas(W, H, { scale: 110, seed: 93, lo: .5, hi: .85 }), 0, 0, W, H); }, {});
  lightPool(ctx, 1000, 520, 380, 260, [255, 235, 200], .35);
  // stage floor
  vgrad(ctx, ox0, 640, ox1 - ox0, 60, [[0, '#2e241a'], [1, '#1a140e']]);
  ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1; for (let i = 0; i < 20; i++) { const x = ox0 + i * 48; ctx.beginPath(); ctx.moveTo(960 + (x - 960) * .7, 640); ctx.lineTo(x, 700); ctx.stroke(); }
  // spotlight cone from high stage-left
  shaft(ctx, [[560, 150], [640, 150], [1130, 700], [880, 700]], [255, 236, 200], .32, .14, [600, 150], [1000, 700], 12);
  lightPool(ctx, 1005, 690, 150, 18, [255, 236, 200], .7);
  dust(ctx, 260, [560, 150, 580, 560], 95, [255, 240, 210], { a: .5, inside: (x, y) => { const t = (y - 150) / 550; return x > lerp(560, 880, t) && x < lerp(640, 1130, t); } });
  // the woman in mourning, back to us, beginning to turn
  if (!o.noWoman) litFigure(ctx, c => inFig(c, 1005, 694, 250, 1, f => woman(f, 'back')), { body: '#070607', rim: [[255, 236, 200], .9, [-1.6, -1.2]], halo: [[255, 230, 190], .3, 8] });
  ctx.restore();
  // proscenium: dulled gilding, curtains, the stopped clock
  const gold = '#3f3220';
  ctx.save(); ctx.strokeStyle = gold; ctx.lineWidth = 34; ctx.beginPath(); ctx.moveTo(ox0 - 17, oy1 + 10); ctx.lineTo(ox0 - 17, oy0 + 80); ctx.quadraticCurveTo((ox0 + ox1) / 2, oy0 - 104, ox1 + 17, oy0 + 80); ctx.lineTo(ox1 + 17, oy1 + 10); ctx.stroke();
  ctx.strokeStyle = 'rgba(230,190,120,.35)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(ox0 - 2, oy1); ctx.lineTo(ox0 - 2, oy0 + 82); ctx.quadraticCurveTo((ox0 + ox1) / 2, oy0 - 76, ox1 + 2, oy0 + 82); ctx.lineTo(ox1 + 2, oy1); ctx.stroke();
  ctx.fillStyle = 'rgba(30,22,12,.6)'; for (let y = oy0 + 100; y < oy1; y += 40) { ctx.beginPath(); ctx.arc(ox0 - 17, y, 6, 0, 7); ctx.arc(ox1 + 17, y, 6, 0, 7); ctx.fill(); }
  ctx.restore();
  ctx.fillStyle = '#0a0806'; ctx.fillRect(0, 128, ox0 - 34, 700); ctx.fillRect(ox1 + 34, 128, W - ox1 - 34, 700);
  ctx.fillStyle = gold; poly(ctx, [[900, 128], [1020, 128], [1000, 96], [960, 84], [920, 96]]); ctx.fill(); clockFace(ctx, 960, 124, 26, 17, 42, { face: '#9a8a6a', rim: '#3a2c18' });
  curtain(ctx, ox0 - 10, oy0 - 60, 150, 600, [62, 38, 33], 6, 31); curtain(ctx, ox1 - 140, oy0 - 60, 150, 600, [62, 38, 33], 6, 32);
  ctx.save(); ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(ox0 - 10, oy0 - 60, 150, 600); ctx.fillRect(ox1 - 140, oy0 - 60, 150, 600); ctx.restore();
  for (let i = 0; i < 5; i++) { const x0 = ox0 - 10 + i * (ox1 - ox0 + 20) / 5, w = (ox1 - ox0 + 20) / 5; fillSpline(ctx, [[x0, oy0 - 50], [x0 + w, oy0 - 50], [x0 + w * .85, oy0 - 10], [x0 + w * .5, oy0 + 20], [x0 + w * .15, oy0 - 10]], '#33201b', .8); }
  // boxes on the side walls, empty
  [[60, 200], [60, 420], [1700, 200], [1700, 420]].forEach(([x, y]) => { ctx.fillStyle = '#0d0907'; ctx.fillRect(x, y, 160, 150); ctx.fillStyle = '#1c0f0c'; ctx.fillRect(x - 10, y + 110, 180, 40); ctx.fillStyle = 'rgba(200,160,100,.12)'; ctx.fillRect(x - 10, y + 110, 180, 2); });
  // footlights and pit
  for (let x = ox0 + 30; x < ox1; x += 70) { ctx.fillStyle = 'rgba(255,220,160,.8)'; ctx.fillRect(x, 700, 10, 5); glow(ctx, x + 5, 700, 40, [255, 200, 130], .3); }
  vgrad(ctx, 0, 706, W, 50, [[0, '#060403'], [1, '#0a0705']]);
  ctx.fillStyle = '#040302'; [640, 760, 1130, 1260].forEach(x => { ctx.fillRect(x, 712, 3, 30); ctx.fillRect(x - 14, 708, 30, 4); });
  // rows 1–6 in perspective; camera sits in row 7, seat 12
  for (let j = 1; j <= 6; j++) {
    const t = j / 6, yt = lerp(748, 905, Math.pow(t, 1.25)), sh = lerp(30, 150, Math.pow(t, 1.7)), sw = lerp(44, 170, Math.pow(t, 1.5));
    const xl = lerp(260, -160, t), xr = lerp(1660, 2080, t), aisle = lerp(700, 470, t);
    for (let x = xl; x < xr; x += sw * 1.04) {
      if (Math.abs(x + sw / 2 - aisle) < sw * .9) continue;
      const g = ctx.createLinearGradient(0, yt, 0, yt + sh); const dk = 1 - t * .55; g.addColorStop(0, rgba([58 * dk, 38 * dk, 32 * dk])); g.addColorStop(.25, rgba([40 * dk, 25 * dk, 21 * dk])); g.addColorStop(1, '#0b0605'); ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(x, yt + sh); ctx.lineTo(x, yt + sh * .22); ctx.quadraticCurveTo(x + sw / 2, yt - sh * .1, x + sw, yt + sh * .22); ctx.lineTo(x + sw, yt + sh); ctx.closePath(); ctx.fill();
      const d = Math.abs(x + sw / 2 - 1000) / 900; ctx.strokeStyle = rgba([230, 180, 120], .28 * (1 - d) * (1 - t * .5)); ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(x + 2, yt + sh * .22); ctx.quadraticCurveTo(x + sw / 2, yt - sh * .08, x + sw - 2, yt + sh * .22); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(5,3,2,.42)'; ctx.fillRect(0, yt + sh * .7, W, 400);
  }
  // our own row: armrests, out of focus
  layer(ctx, x => { x.fillStyle = '#0a0504'; fillSpline(x, [[-40, 1100], [-40, 960], [140, 930], [260, 960], [300, 1100]], '#0a0504', .8); fillSpline(x, [[1640, 1100], [1690, 960], [1820, 930], [1980, 950], [1980, 1100]], '#0a0504', .8); x.fillStyle = 'rgba(200,150,90,.25)'; x.fillRect(120, 932, 120, 4); x.fillRect(1700, 934, 120, 4); }, { blur: 14 });
  fog(ctx, noiseCanvas(W, 400, { scale: 200, seed: 97, lo: .35, hi: .85, stretchX: 2 }), 600, 900, [150, 110, 80], .12);
  vignette(ctx, .55, 980, 480);
};

/* ================= K0 · Персонажи демо ================= */
SCENES.K0 = (ctx) => {
  vgrad(ctx, 0, 0, W, H, [[0, '#26231f'], [1, '#191714']]);
  const paper = noiseCanvas(W, H, { scale: 60, seed: 3, lo: .3, hi: .9 });
  layer(ctx, x => { x.fillStyle = 'rgba(255,240,210,.05)'; x.fillRect(0, 0, W, H); x.globalCompositeOperation = 'destination-in'; x.drawImage(paper, 0, 0, W, H); }, { comp: 'screen' });
  const G = 860, PX = 2.8; // ground line, px per cm
  const rim = { body: '#0b0a0c', rim: [[210, 200, 180], .8, [-1.6, -1]] };
  litFigure(ctx, c => inFig(c, 300, G, 188 * PX, 1, f => man(f, POSE.stand)), rim);
  inFig(ctx, 300, G, 188 * PX, 1, f => manDetails(f, POSE.stand, [210, 200, 180], .25));
  hanky(ctx, 300 + 6.4 * 1.88 * PX / 100 * 100 / 188 * 1.88 + 30, G - 47.5 * 188 * PX / 100 + 18, -.2);
  litFigure(ctx, c => inFig(c, 600, G, 165 * PX, 1, f => woman(f, 'widow')), rim);
  litFigure(ctx, c => inFig(c, 860, G, 155 * PX, 1, f => woman(f, 'maid')), rim);
  { const u = 155 * PX / 100, tx = 860 + 10 * u, ty = G - 61 * u; ctx.fillStyle = '#3a2e20'; ctx.fillRect(tx - 22, ty - 2, 64, 4); ctx.fillStyle = '#d8d2c4'; [[tx - 12, ty], [tx + 6, ty]].forEach(([cx, cy]) => { ctx.fillRect(cx, cy - 12, 11, 12); }); ctx.fillStyle = '#e8dcc0'; ctx.fillRect(tx + 28, ty - 22, 5, 20); ctx.fillStyle = 'rgba(255,214,140,.95)'; ctx.beginPath(); ctx.ellipse(tx + 30.5, ty - 28, 3.4, 6.4, 0, 0, 7); ctx.fill(); glow(ctx, tx + 30, ty - 28, 60, [255, 180, 100], .4); }
  const EH = 250 * PX, eu = EH / 100;
  litFigure(ctx, c => inFig(c, 1140, G, EH, 1, f => extinguisher(f, { tip: [40, 46] })), rim);
  { const hx = 1140, hy = G - 81 * eu; const hg = ctx.createRadialGradient(hx + 4, hy - 8, 2, hx, hy, 6.5 * eu); hg.addColorStop(0, 'rgba(215,218,226,.85)'); hg.addColorStop(.7, 'rgba(120,124,136,.7)'); hg.addColorStop(1, 'rgba(70,72,80,.7)'); ctx.fillStyle = hg; ctx.beginPath(); ctx.ellipse(hx, hy, 5.2 * eu, 6.8 * eu, 0, 0, 7); ctx.fill(); ctx.fillStyle = 'rgba(255,170,90,.95)'; ctx.beginPath(); ctx.ellipse(hx, hy + 6, 4, 9, 0, 0, 7); ctx.fill(); glow(ctx, hx, hy + 4, 50, [255, 170, 90], .5); }
  // the little light (Stella) at child height
  glow(ctx, 1380, G - 120, 70, [255, 214, 150], .6); glow(ctx, 1380, G - 120, 14, [255, 240, 210], .9);
  // pose thumbnails
  const poses = [['stand', 'покой'], ['lookUp', 'взгляд вверх'], ['reach', 'тянется'], ['shove', 'толкает'], ['run', 'бег, оглядка'], ['sitCough', 'кашель']];
  poses.forEach(([p, t], i) => { const cx = 1540 + (i % 3) * 120, cy = 360 + Math.floor(i / 3) * 250; litFigure(ctx, c => inFig(c, cx, cy, p === 'sitCough' ? 200 : 170, 1, f => man(f, POSE[p])), rim); });
  // UI layer: grid, labels, palette
  const [u, x] = mk(); x.save();
  x.strokeStyle = 'rgba(230,215,190,.14)'; x.lineWidth = 1; x.fillStyle = 'rgba(230,215,190,.45)'; x.font = '500 15px "Cormorant Garamond", Georgia, serif';
  for (let cm = 0; cm <= 250; cm += 50) { const y = G - cm * PX; x.beginPath(); x.moveTo(90, y); x.lineTo(1430, y); x.stroke(); x.fillText(cm + ' см', 34, y + 5); }
  x.fillStyle = '#ece3d1'; x.font = '600 40px "Cormorant SC", Georgia, serif'; x.fillText('Чёрная капля · персонажи демо', 60, 70);
  x.fillStyle = 'rgba(236,227,209,.7)'; x.font = 'italic 500 22px "Cormorant Garamond", Georgia, serif'; x.fillText('Силуэт должен читаться в 64 пикселях. Свет — контровой, со стороны источника.', 60, 104);
  const lab = (cx, name, h, note) => { x.textAlign = 'center'; x.fillStyle = '#ece3d1'; x.font = '600 24px "Cormorant SC", Georgia, serif'; x.fillText(name, cx, G + 46); x.fillStyle = 'rgba(236,227,209,.6)'; x.font = 'italic 500 18px "Cormorant Garamond", Georgia, serif'; x.fillText(h, cx, G + 72); note.forEach((l, i) => x.fillText(l, cx, G + 96 + i * 22)); };
  lab(300, 'Элиас', '188 см', ['пальто-инвернесс с пелериной,', 'без шляпы, сутулится; платок']);
  lab(600, 'Вивиан', '165 см', ['глубокий траур, вуаль, турнюр;', 'почти всю игру — за кадром']);
  lab(860, 'Мэри', '155 см', ['чепец, фартук, поднос:', 'две чашки и свеча']);
  lab(1140, 'Гаситель', '250 см', ['цилиндр, плафон вместо лица,', 'руки ниже колен, шест фонарщика']);
  lab(1380, 'Огонёк', '—', ['Стелла; тёплый свет', 'на уровне детского роста']);
  x.textAlign = 'left'; x.fillStyle = '#ece3d1'; x.font = '600 24px "Cormorant SC", Georgia, serif'; x.fillText('Элиас: ключевые позы', 1480, 200);
  x.fillStyle = 'rgba(236,227,209,.6)'; x.font = 'italic 500 16px "Cormorant Garamond", Georgia, serif';
  poses.forEach(([p, t], i) => { const cx = 1540 + (i % 3) * 120, cy = 360 + Math.floor(i / 3) * 250; x.textAlign = 'center'; x.fillText(t, cx, cy + 30); });
  x.textAlign = 'left'; x.fillStyle = '#ece3d1'; x.font = '600 24px "Cormorant SC", Georgia, serif'; x.fillText('Палитра демо', 1480, 900);
  [['#0B0F1A', 'ночь'], ['#C9D3E0', 'звёзды'], ['#E0A050', 'газ'], ['#7A6A52', 'сепия'], ['#C3121C', 'кровь']].forEach(([c, n], i) => { x.fillStyle = c; x.fillRect(1480 + i * 80, 920, 64, 40); x.strokeStyle = 'rgba(236,227,209,.3)'; x.strokeRect(1480 + i * 80, 920, 64, 40); x.fillStyle = 'rgba(236,227,209,.65)'; x.font = 'italic 500 15px "Cormorant Garamond", Georgia, serif'; x.fillText(n, 1482 + i * 80, 982); x.font = '500 12px "Cormorant Garamond", Georgia, serif'; x.fillText(c, 1482 + i * 80, 1000); });
  x.restore(); return u;
};

/* ================= service frames for the demo colour script ================= */
SCENES.KE = (ctx) => {
  ctx.fillStyle = '#030304'; ctx.fillRect(0, 0, W, H);
  const [u, x] = mk(); x.textAlign = 'center'; x.fillStyle = '#d9cfbd'; x.font = '58px "Marck Script", cursive'; x.fillText('Помни меня — но, ах, забудь мою судьбу.', W / 2, 520);
  x.fillStyle = 'rgba(217,207,189,.55)'; x.font = 'italic 500 28px "Cormorant Garamond", Georgia, serif'; x.fillText('«Плач Дидоны», старинная ария', W / 2, 590);
  x.fillStyle = 'rgba(217,207,189,.45)'; for (let i = 0; i < 5; i++) { x.beginPath(); x.ellipse(1440 + i * 9, 540 + i * 26, 2.4, 4 + i, 0, 0, 7); x.fill(); }
  return u;
};
SCENES.KZ = (ctx) => {
  ctx.fillStyle = '#020203'; ctx.fillRect(0, 0, W, H);
  const r = rng(5); ctx.fillStyle = '#0d0c10'; ctx.beginPath(); ctx.ellipse(W / 2, 470, 260, 44, 0, 0, 7); ctx.fill();
  for (let i = 0; i < 40; i++) { const a = r() * 6.28, d = 240 + r() * 120; ctx.beginPath(); ctx.ellipse(W / 2 + Math.cos(a) * d, 470 + Math.sin(a) * d * .18, 3 + r() * 9, 2 + r() * 4, 0, 0, 7); ctx.fill(); }
  const [u, x] = mk(); x.textAlign = 'center'; x.fillStyle = '#ece3d1'; x.font = '600 120px "Cormorant SC", Georgia, serif'; x.fillText('Чёрная капля', W / 2, 520);
  x.fillStyle = 'rgba(236,227,209,.4)'; x.font = 'italic 500 30px "Cormorant Garamond", Georgia, serif'; x.fillText('добавьте в список желаемого', W / 2, 600);
  x.fillStyle = '#ece3d1'; x.beginPath(); x.ellipse(W / 2, 330, 14, 20, 0, 0, 7); x.fill(); x.beginPath(); x.moveTo(W / 2 - 10, 322); x.quadraticCurveTo(W / 2, 280, W / 2, 270); x.quadraticCurveTo(W / 2, 280, W / 2 + 10, 322); x.fill();
  return u;
};
