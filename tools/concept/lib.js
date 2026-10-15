// Painting toolkit for concept frames. Runs in a browser page (Chromium via Playwright).
// All scene code draws in logical 1920x1080 coordinates; canvases are rendered at S times that.
'use strict';
let W = 1920, H = 1080;
let S = 1.5;
let OFF = [0, 0]; // world origin of the canvas (plates are painted in world coordinates)
function setCanvasSize(w, h, s) { W = w; H = h; S = s; }
function setOrigin(x, y) { OFF = [x, y]; }
function blit(ctx, c, dx = 0, dy = 0) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(c, dx * S, dy * S); ctx.restore(); }

/* ---------- math & color ---------- */
function rng(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const clamp = (v, a = 0, b = 1) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
function hex(h) { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function rgba(c, a = 1) { if (typeof c === 'string') c = hex(c); return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`; }
function mixc(a, b, t) { if (typeof a === 'string') a = hex(a); if (typeof b === 'string') b = hex(b); return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
const blurF = px => `blur(${px * S}px)`;

/* ---------- canvases ---------- */
function mk(w = W, h = H) { const c = document.createElement('canvas'); c.width = Math.round(w * S); c.height = Math.round(h * S); const x = c.getContext('2d'); x.scale(S, S); x.translate(-OFF[0], -OFF[1]); return [c, x]; }
// Draw fn into an offscreen layer, optionally tint toward fog, blur, then composite.
function layer(ctx, fn, o = {}) {
  const [c, x] = mk();
  fn(x);
  if (o.fog) { x.globalCompositeOperation = 'source-atop'; x.fillStyle = rgba(o.fog[0], o.fog[1]); x.fillRect(OFF[0], OFF[1], W, H); x.globalCompositeOperation = 'source-over'; }
  ctx.save();
  if (o.blur) ctx.filter = blurF(o.blur);
  if (o.alpha != null) ctx.globalAlpha = o.alpha;
  if (o.comp) ctx.globalCompositeOperation = o.comp;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(c, 0, 0);
  ctx.restore();
  return c;
}
function snapshot(ctx) { const [c, x] = mk(); x.setTransform(1, 0, 0, 1, 0, 0); x.drawImage(ctx.canvas, 0, 0); return c; }

/* ---------- noise ---------- */
function makeNoise(seed) {
  const r = rng(seed); const v = new Float32Array(65536); for (let i = 0; i < 65536; i++) v[i] = r();
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), w = yf * yf * (3 - 2 * yf);
    const i00 = (xi & 255) + ((yi & 255) << 8), i10 = ((xi + 1) & 255) + ((yi & 255) << 8), i01 = (xi & 255) + (((yi + 1) & 255) << 8), i11 = ((xi + 1) & 255) + (((yi + 1) & 255) << 8);
    const a = v[i00], b = v[i10], c = v[i01], d = v[i11];
    return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
  };
}
function fbm(n, x, y, oct = 5) { let s = 0, a = .5, f = 1, nm = 0; for (let i = 0; i < oct; i++) { s += a * n(x * f + i * 17.3, y * f - i * 9.1); nm += a; a *= .5; f *= 2.03; } return s / nm; }
// White canvas with alpha = shaped fbm. scale = feature size in px.
function noiseCanvas(w, h, o = {}) {
  const ds = o.ds || 6, gw = Math.ceil(w / ds), gh = Math.ceil(h / ds);
  const c = document.createElement('canvas'); c.width = gw; c.height = gh; const x = c.getContext('2d');
  const img = x.createImageData(gw, gh); const n = makeNoise(o.seed || 1);
  const sc = o.scale || 300, sx = o.stretchX || 1, sy = o.stretchY || 1;
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    let v = fbm(n, i * ds / (sc * sx), j * ds / (sc * sy), o.oct || 5);
    v = smooth(o.lo ?? .35, o.hi ?? .75, v);
    const k = (j * gw + i) * 4; img.data[k] = img.data[k + 1] = img.data[k + 2] = 255; img.data[k + 3] = v * 255;
  }
  x.putImageData(img, 0, 0);
  return c;
}

/* ---------- paths ---------- */
function spline(ctx, pts, closed = true, s = 1) {
  const n = pts.length; if (!n) return;
  ctx.moveTo(pts[0][0], pts[0][1]);
  const L = closed ? n : n - 1;
  for (let i = 0; i < L; i++) {
    const p0 = closed ? pts[(i - 1 + n) % n] : pts[Math.max(0, i - 1)];
    const p1 = pts[i], p2 = pts[(i + 1) % n];
    const p3 = closed ? pts[(i + 2) % n] : pts[Math.min(n - 1, i + 2)];
    ctx.bezierCurveTo(p1[0] + (p2[0] - p0[0]) * s / 6, p1[1] + (p2[1] - p0[1]) * s / 6, p2[0] - (p3[0] - p1[0]) * s / 6, p2[1] - (p3[1] - p1[1]) * s / 6, p2[0], p2[1]);
  }
  if (closed) ctx.closePath();
}
function fillSpline(ctx, pts, fill, s = 1) { ctx.beginPath(); spline(ctx, pts, true, s); ctx.fillStyle = fill; ctx.fill(); }
function poly(ctx, pts, fill) { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.closePath(); if (fill) { ctx.fillStyle = fill; ctx.fill(); } }

/* ---------- light & atmosphere ---------- */
function glow(ctx, x, y, r, color, a = 1, comp = 'lighter') {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(color, a)); g.addColorStop(.25, rgba(color, a * .45)); g.addColorStop(.6, rgba(color, a * .12)); g.addColorStop(1, rgba(color, 0));
  ctx.save(); ctx.globalCompositeOperation = comp; ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); ctx.restore();
}
// Volumetric shaft: polygon filled with gradient from p0 (a0) to p1 (a1), blurred, added.
function shaft(ctx, pts, color, a0, a1, p0, p1, blur = 14, comp = 'screen') {
  layer(ctx, x => { const g = x.createLinearGradient(p0[0], p0[1], p1[0], p1[1]); g.addColorStop(0, rgba(color, a0)); g.addColorStop(1, rgba(color, a1)); poly(x, pts, g); }, { blur, comp });
}
function fog(ctx, nc, y0, y1, color, a, o = {}) {
  layer(ctx, x => {
    const g = x.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, rgba(color, 0)); g.addColorStop(.5, rgba(color, a)); g.addColorStop(1, rgba(color, 0));
    x.fillStyle = g; x.fillRect(OFF[0], y0, W, y1 - y0);
    x.globalCompositeOperation = 'destination-in'; x.imageSmoothingQuality = 'high'; x.drawImage(nc, OFF[0] + (o.dx || 0), y0 - (o.pad || 0), W, (y1 - y0) + 2 * (o.pad || 0));
  }, { comp: o.comp || 'screen', blur: o.blur || 0 });
}
function dust(ctx, n, area, seed, color, o = {}) {
  const r = rng(seed); ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const x = area[0] + r() * area[2], y = area[1] + r() * area[3];
    if (o.inside && !o.inside(x, y)) continue;
    const s = (o.min || .6) + Math.pow(r(), 3) * (o.max || 2.2); const a = (o.a || .5) * (.3 + .7 * r());
    const g = ctx.createRadialGradient(x, y, 0, x, y, s * 2.2); g.addColorStop(0, rgba(color, a)); g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g; ctx.fillRect(x - s * 2.2, y - s * 2.2, s * 4.4, s * 4.4);
  }
  ctx.restore();
}
function stars(ctx, n, area, seed, o = {}) {
  const r = rng(seed); ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const x = area[0] + r() * area[2], y = area[1] + r() * area[3];
    if (o.inside && !o.inside(x, y)) continue;
    const big = Math.pow(r(), 6); const s = .5 + big * 2.6;
    const t = r(); const col = t < .2 ? [255, 214, 170] : t < .7 ? [225, 233, 255] : [190, 210, 255];
    const a = (.25 + .75 * r()) * (o.a || 1);
    const g = ctx.createRadialGradient(x, y, 0, x, y, s * 3); g.addColorStop(0, rgba(col, a)); g.addColorStop(.35, rgba(col, a * .35)); g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g; ctx.fillRect(x - s * 3, y - s * 3, s * 6, s * 6);
    if (big > .35) { ctx.strokeStyle = rgba(col, a * .35); ctx.lineWidth = .6; ctx.beginPath(); ctx.moveTo(x - s * 7, y); ctx.lineTo(x + s * 7, y); ctx.moveTo(x, y - s * 7); ctx.lineTo(x, y + s * 7); ctx.stroke(); }
  }
  ctx.restore();
}
function rain(ctx, n, area, seed, o = {}) {
  const r = rng(seed); ctx.save(); ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const x = area[0] + r() * area[2], y = area[1] + r() * area[3], l = (o.len || 30) * (.5 + r()), a = (o.a || .25) * (.3 + .7 * r());
    ctx.strokeStyle = rgba(o.color || [170, 185, 210], a); ctx.lineWidth = o.w || 1;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + l * (o.slant || -.12), y + l); ctx.stroke();
  }
  ctx.restore();
}
function glassDrops(ctx, n, area, seed, o = {}) {
  const r = rng(seed); ctx.save();
  for (let i = 0; i < n; i++) {
    const x = area[0] + r() * area[2], y = area[1] + r() * area[3], s = (o.size || 2.4) * (.4 + r() * r() * 1.6);
    if (r() < .55) { const tl = s * (8 + r() * 30); const g = ctx.createLinearGradient(0, y - tl, 0, y); g.addColorStop(0, rgba([200, 215, 235], 0)); g.addColorStop(1, rgba([200, 215, 235], .10)); ctx.fillStyle = g; ctx.fillRect(x - s * .35, y - tl, s * .7, tl); }
    ctx.fillStyle = rgba([10, 14, 22], .35); ctx.beginPath(); ctx.ellipse(x, y + s * .15, s, s * 1.25, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = rgba(o.light || [215, 228, 250], .55); ctx.beginPath(); ctx.ellipse(x + s * .25, y + s * .35, s * .45, s * .55, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = rgba([255, 255, 255], .7); ctx.fillRect(x - s * .35, y - s * .45, Math.max(.6, s * .3), Math.max(.6, s * .3));
  }
  ctx.restore();
}
function vgrad(ctx, x, y, w, h, stops) { const g = ctx.createLinearGradient(0, y, 0, y + h); stops.forEach(s => g.addColorStop(s[0], typeof s[1] === 'string' ? s[1] : rgba(s[1], s[2] ?? 1))); ctx.fillStyle = g; ctx.fillRect(x, y, w, h); }
function hgrad(ctx, x, y, w, h, stops) { const g = ctx.createLinearGradient(x, 0, x + w, 0); stops.forEach(s => g.addColorStop(s[0], typeof s[1] === 'string' ? s[1] : rgba(s[1], s[2] ?? 1))); ctx.fillStyle = g; ctx.fillRect(x, y, w, h); }
function vignette(ctx, a = .55, cx = W / 2, cy = H / 2) { const g = ctx.createRadialGradient(cx, cy, H * .35, cx, cy, W * .72); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${a})`); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
// Cracks radiating from a point
function cracks(ctx, x0, y0, seed, o = {}) {
  const r = rng(seed); ctx.save(); ctx.lineCap = 'round';
  const arms = o.arms || 9;
  for (let k = 0; k < arms; k++) {
    let a = k / arms * Math.PI * 2 + r() * .5, x = x0, y = y0, len = (o.len || 160) * (.4 + r() * .8);
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let s = 0; s < 10; s++) { a += (r() - .5) * .5; const d = len / 10; x += Math.cos(a) * d; y += Math.sin(a) * d; ctx.lineTo(x, y); }
    ctx.strokeStyle = rgba([210, 225, 250], (o.a || .35)); ctx.lineWidth = .8; ctx.stroke();
  }
  for (let ring = 1; ring <= 2; ring++) {
    ctx.beginPath(); const rr = (o.len || 160) * .18 * ring;
    for (let k = 0; k <= arms; k++) { const a = k / arms * Math.PI * 2; const px = x0 + Math.cos(a) * rr * (.8 + r() * .4), py = y0 + Math.sin(a) * rr * (.8 + r() * .4); k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
    ctx.strokeStyle = rgba([210, 225, 250], (o.a || .35) * .6); ctx.lineWidth = .6; ctx.stroke();
  }
  ctx.restore();
}

/* ---------- figures ---------- */
// Local frame: origin at feet, +x = facing, +y = up, 100 units = full height.
function inFig(ctx, x, y, hpx, facing, fn) { ctx.save(); ctx.translate(x, y); ctx.scale(facing * hpx / 100, -hpx / 100); fn(ctx); ctx.restore(); }
function seg(ctx, a, b, w) { ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
function taper(ctx, a, b, wa, wb) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
  ctx.beginPath(); ctx.moveTo(a[0] + nx * wa / 2, a[1] + ny * wa / 2); ctx.lineTo(b[0] + nx * wb / 2, b[1] + ny * wb / 2); ctx.lineTo(b[0] - nx * wb / 2, b[1] - ny * wb / 2); ctx.lineTo(a[0] - nx * wa / 2, a[1] - ny * wa / 2); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.arc(a[0], a[1], wa / 2, 0, Math.PI * 2); ctx.arc(b[0], b[1], wb / 2, 0, Math.PI * 2); ctx.fill();
}
function limb(ctx, pts, ws) { for (let i = 0; i < pts.length - 1; i++) taper(ctx, pts[i], pts[i + 1], ws[i], ws[i + 1]); }
function shoe(ctx, ankle, toe) {
  const cx = (ankle[0] + toe[0]) / 2, cy = (ankle[1] + toe[1]) / 2, ang = Math.atan2(toe[1] - ankle[1], toe[0] - ankle[0]), l = Math.hypot(toe[0] - ankle[0], toe[1] - ankle[1]);
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(ang); ctx.beginPath(); ctx.ellipse(0, .3, l / 2 + 1.6, 1.9, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
}
const HEAD_M = [[-4.8, 4.8], [0, 6.8], [4.2, 5.6], [5.9, 3], [6.3, 1.4], [6.5, .7], [8.2, -1.1], [6.6, -1.9], [6.9, -2.7], [6.6, -3.5], [5.7, -5.4], [2.6, -6.4], [.4, -6], [-2.8, -5.4], [-5.6, -1.6], [-6.2, 1.8]];
const HAIR_M = [[4.6, 4.4], [6.6, 5.8], [5.6, 7.4], [6.4, 8.2], [3.6, 8.8], [1.2, 9.6], [-1.8, 9.2], [-4.4, 8.6], [-6.2, 7], [-7.6, 4.6], [-8, 1.6], [-7.6, -1.2], [-6.8, -3.2], [-7.4, -4.6], [-5.6, -3.8], [-4.6, -1], [-3.6, 2.6], [-.6, 5], [2.8, 5.4]];
function head(ctx, h, prof = HEAD_M, hair = null) {
  const c = Math.cos(h.tilt || 0), s = Math.sin(h.tilt || 0), k = (h.r || 6.4) / 6.4, f = h.flip ? -1 : 1;
  const tr = p => [h.x + (p[0] * f * c - p[1] * s) * k, h.y + (p[0] * f * s + p[1] * c) * k];
  ctx.beginPath(); spline(ctx, prof.map(tr), true, .9); ctx.fill();
  if (hair) { ctx.beginPath(); spline(ctx, hair.map(tr), true, .7); ctx.fill(); }
}
// Inverness-style shoulder cape, built around the chest point and rotated with the torso.
const CAPE = [[-3.6, 7.4], [4.4, 6.6], [9.4, 1.6], [12.2, -7.4], [11.8, -15.6], [6, -17.2], [-2, -16.4], [-9, -17.2], [-13, -15], [-12.8, -6], [-9.4, 2.4]];
function cape(ctx, P) {
  const ax = P.chest[0] - P.hip[0], ay = P.chest[1] - P.hip[1], a = Math.atan2(ax, ay);
  const c = Math.cos(-a), s = Math.sin(-a), fl = P.capeFlare || 0;
  const pts = CAPE.map((p, i) => { let x = p[0], y = p[1]; if (y < -10) { x -= fl * (i > 6 ? 1.4 : .7); y += fl * .25; } return [P.chest[0] + x * c - y * s, P.chest[1] + x * s + y * c]; });
  ctx.beginPath(); spline(ctx, pts, true, .9); ctx.fill();
}
// Male figure in a long greatcoat. P: pose.
function man(ctx, P) {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (P.anB) { limb(ctx, [P.hip, P.knB, P.anB], [8.5, 6.2, 3.6]); shoe(ctx, P.anB, P.toB); }
  if (P.elB) { limb(ctx, [P.shB || P.sh, P.elB, P.haB], [5.4, 4.3, 3.3]); ctx.beginPath(); ctx.ellipse(P.haB[0], P.haB[1], 2.1, 2.6, 0, 0, Math.PI * 2); ctx.fill(); }
  if (P.anN) { limb(ctx, [P.hip, P.knN, P.anN], [8.5, 6.2, 3.6]); shoe(ctx, P.anN, P.toN); }
  if (P.coat) { ctx.beginPath(); spline(ctx, P.coat, true, .85); ctx.fill(); }
  limb(ctx, [P.neck, P.chest], [5, 7]);
  if (P.cape !== false) cape(ctx, P);
  if (P.scarf !== false) { ctx.beginPath(); ctx.ellipse(P.neck[0] + .6, P.neck[1] - 2, 5.8, 3.2, P.scarfA || 0, 0, Math.PI * 2); ctx.fill(); }
  { const n = P.neck; ctx.beginPath(); spline(ctx, [[n[0] - 6.6, n[1] - 3], [n[0] - 7, n[1] + 3], [n[0] - 5.6, n[1] + 6.4], [n[0] - 3, n[1] + 5.6], [n[0] - 1, n[1] + 1], [n[0] + 1, n[1] - 2.6]], true, .8); ctx.fill(); }
  head(ctx, Object.assign({ r: 5.9 }, P.head), HEAD_M, HAIR_M);
  if (P.elN) { limb(ctx, [P.sh, P.elN, P.haN], [6, 4.8, 3.6]); ctx.beginPath(); ctx.ellipse(P.haN[0], P.haN[1], 2.2, 2.8, P.handA || 0, 0, Math.PI * 2); ctx.fill(); }
  if (P.extra) P.extra(ctx);
}
const POSE = {
  stand: {
    head: { x: 3.4, y: 91.8, tilt: -.08 }, neck: [1.6, 84.5], chest: [.6, 77], hip: [-.5, 49], sh: [1.2, 79.5], shB: [-1, 79.5],
    knN: [1.8, 26], anN: [1.2, 3], toN: [9.2, 1], knB: [-2.2, 26], anB: [-3.2, 3], toB: [4.8, 1],
    elN: [2.4, 62], haN: [6.4, 47.5], elB: [-3.4, 62], haB: [-1.2, 47.5],
    coat: [[-4.6, 86.5], [-9.4, 80], [-10.2, 66], [-10.6, 45], [-12.4, 26], [-14, 21.5], [-4, 20.4], [6, 20.4], [12.4, 21.6], [11.4, 31], [10.2, 48], [10, 62], [9.6, 73], [7.2, 80.5], [3.2, 85]]
  },
  lookUp: {
    head: { x: 2.4, y: 92.4, tilt: .42 }, neck: [1.2, 84.8], chest: [.2, 77], hip: [-.6, 49], sh: [.8, 79.5], shB: [-1.2, 79.5],
    knN: [1.8, 26], anN: [1.4, 3], toN: [9.4, 1], knB: [-2.4, 26], anB: [-3.6, 3], toB: [4.4, 1],
    elN: [2, 62], haN: [5.6, 47.5], elB: [-3.6, 62], haB: [-1.6, 47.5],
    coat: [[-5, 86.5], [-9.6, 80], [-10.4, 66], [-10.8, 45], [-12.6, 26], [-14.2, 21.5], [-4, 20.4], [6, 20.4], [12.2, 21.6], [11.2, 31], [10, 48], [9.8, 62], [9.2, 73], [6.6, 80.5], [2.6, 85]]
  },
  reach: {
    head: { x: 5.2, y: 91, tilt: -.05 }, neck: [3.4, 84], chest: [2.2, 76.5], hip: [0, 49], sh: [4, 79], shB: [0, 79],
    knN: [6.6, 26.5], anN: [8.6, 3], toN: [16.6, 1], knB: [-3.2, 26], anB: [-6.6, 4], toB: [.6, .8],
    elN: [15, 74], haN: [26, 73.5], handA: .3, elB: [-2, 62], haB: [1.6, 48],
    coat: [[-3, 86], [-8, 80], [-9.4, 66], [-10.4, 45], [-13.6, 27], [-15.6, 22], [-4, 20.8], [7, 21.4], [14.4, 23], [12.4, 33], [11, 48], [11, 62], [11, 72], [8.6, 80], [5, 84.5]]
  },
  push: {
    capeFlare: 2, head: { x: 15.2, y: 82.4, tilt: .1 }, neck: [12.2, 76.2], chest: [8.4, 69.6], hip: [-3.6, 46], sh: [10.6, 72], shB: [8, 72],
    knN: [5.4, 27.6], anN: [2.2, 3.4], toN: [10.2, 1], knB: [-10.4, 25.6], anB: [-19.4, 5.6], toB: [-12, .8],
    elN: [17.4, 61.6], haN: [22, 57], elB: [15.6, 63.4], haB: [21, 61.4],
    coat: [[6.4, 79.6], [.4, 75.2], [-5.6, 62], [-10.6, 45], [-15.4, 30], [-17.4, 25.4], [-6, 23], [4, 22.4], [9.4, 24.4], [11.2, 36], [12.4, 50], [14.4, 64], [15.4, 71], [13.6, 76.6]]
  },
  run: {
    capeFlare: 7, head: { x: 8.2, y: 91, tilt: .12, flip: true }, neck: [6.8, 84.2], chest: [5, 77], hip: [0, 52], sh: [5.6, 79], shB: [3.4, 79],
    knN: [12.6, 37.6], anN: [14.8, 15.4], toN: [22.6, 15.8], knB: [-6.2, 28.4], anB: [-17.4, 21], toB: [-20.6, 14.6],
    elN: [-5.6, 66], haN: [-9.6, 55.6], elB: [13, 70.6], haB: [17.6, 62.6],
    coat: [[2.4, 84.6], [-3.4, 80], [-9, 66], [-15.6, 52], [-25.6, 40], [-27, 33.6], [-19, 32.4], [-6, 31.6], [6, 31], [8.6, 42], [9.6, 58], [10.4, 70], [9.6, 78], [6.4, 83]]
  },
  sitCough: {
    head: { x: 7.6, y: 42.6, tilt: -.34 }, neck: [4.6, 35.6], chest: [2.6, 28.4], hip: [0, 0], sh: [3.6, 31.4], shB: [1.6, 31.4],
    elN: [11.4, 20], haN: [10.4, 35.6], handA: -.4, elB: [-4.2, 17.4], haB: [-2.4, 6.4],
    coat: [[-2.6, 37.6], [-7.4, 33.4], [-8.6, 22], [-9.4, 8], [-9, -2], [9.6, -2], [9.6, 10], [9.4, 22], [8, 31], [5.4, 35.6]]
  }
};
// Interior detail lines for a man figure (cape hem, coat opening, sleeve), drawn in rim color.
function manDetails(ctx, P, col, a) {
  ctx.save(); ctx.strokeStyle = rgba(col, a); ctx.lineWidth = .5; ctx.lineCap = 'round';
  const ax = P.chest[0] - P.hip[0], ay = P.chest[1] - P.hip[1], an = Math.atan2(ax, ay), c = Math.cos(-an), s = Math.sin(-an);
  const T = p => [P.chest[0] + p[0] * c - p[1] * s, P.chest[1] + p[0] * s + p[1] * c];
  ctx.beginPath(); spline(ctx, [[11.4, -15.2], [5, -16.4], [-2, -15.6], [-9, -16.4], [-12.4, -14.6]].map(T), false, .9); ctx.stroke();
  ctx.beginPath(); spline(ctx, [[7.6, 2], [8.6, -6], [9.6, -16]].map(T), false); ctx.stroke();
  if (P.coat) { const f = P.coat; const fr = f.slice(7, 12); ctx.beginPath(); spline(ctx, fr.map(p => [p[0] - 2.2, p[1]]), false); ctx.stroke(); }
  ctx.restore();
}
// Female figures. kind: 'maid' | 'widow' | 'sit' | 'back'
function woman(ctx, kind, o = {}) {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (kind === 'maid') {
    fillSpline(ctx, [[-5.6, 79], [-7.2, 73], [-6, 62], [-4.4, 56.6], [-7.2, 54], [-11.6, 34], [-14.4, 12], [-15.4, .6], [13.4, .6], [12.6, 12], [10.6, 34], [7.4, 54], [5, 56.6], [6.8, 62], [7.6, 70], [6, 77.6], [2.6, 80.8]], ctx.fillStyle, .9);
    limb(ctx, [[1, 82.6], [1.6, 78]], [4.4, 5]);
    head(ctx, { x: 2.6, y: 87.4, tilt: o.tilt || 0, r: 5.6 });
    ctx.beginPath(); ctx.ellipse(-3.2, 89.6, 3.4, 3, 0, 0, Math.PI * 2); ctx.fill();            // bun
    ctx.beginPath(); ctx.ellipse(1.6, 93.2, 5.6, 1.8, -.2, 0, Math.PI * 2); ctx.fill();         // cap
    limb(ctx, [[3.4, 76], [7.2, 63.4], [15, 60.8]], [4.6, 3.8, 3]);
    limb(ctx, [[1, 76], [4.6, 63], [12.6, 61.4]], [4.2, 3.6, 2.8]);
  } else if (kind === 'widow') {
    fillSpline(ctx, [[-5, 79], [-6.6, 72], [-5.6, 62], [-4.2, 57], [-8.2, 55.6], [-14.2, 50], [-14.6, 42], [-12.2, 34], [-14.6, 14], [-19, 1.2], [-24, .4], [12.6, .4], [11.4, 14], [9.6, 34], [7.2, 53], [4.8, 57], [6.6, 63], [7.4, 71], [5.6, 77.6], [2.2, 80.8]], ctx.fillStyle, .9);
    limb(ctx, [[.8, 82.6], [1.4, 78]], [4, 4.8]);
    head(ctx, { x: 2.4, y: 87.6, tilt: o.tilt || 0, r: 5.4 });
    ctx.beginPath(); ctx.ellipse(-2.6, 90.6, 3.6, 3.2, 0, 0, Math.PI * 2); ctx.fill();
    fillSpline(ctx, [[-1.6, 94.6], [4.6, 94], [6.4, 90], [5.6, 86], [-4, 78], [-9.6, 66], [-11, 58], [-8.6, 60], [-6.4, 70], [-5.4, 80], [-4.2, 90]], ctx.fillStyle, .8); // veil
    limb(ctx, [[2.8, 76.4], [3.8, 62], [6.8, 50]], [4.2, 3.4, 2.6]);
  } else if (kind === 'sit') {
    fillSpline(ctx, [[-4.4, 64], [-6, 58], [-5.2, 48], [-6.6, 43], [-10.2, 40], [-11.8, 20], [-12.6, .6], [20.4, .6], [19.6, 16], [17.4, 38.6], [12, 44.2], [4.8, 45.4], [5.6, 52], [6.4, 60], [4.8, 64.6], [1.2, 66]], ctx.fillStyle, .9);
    limb(ctx, [[1.2, 67.4], [2.6, 64]], [3.8, 4.6]);
    head(ctx, { x: 4.4, y: 70.6, tilt: -.62, r: 5.2 });
    ctx.beginPath(); ctx.ellipse(.4, 74.4, 3.2, 2.8, 0, 0, Math.PI * 2); ctx.fill();
    fillSpline(ctx, [[-.4, 77], [6.6, 75.6], [8, 70.6], [3.2, 64], [-4.6, 58], [-7.4, 52], [-5.4, 62], [-3.4, 70]], ctx.fillStyle, .8);
    limb(ctx, [[2.6, 61], [6.4, 48.4], [13.4, 45]], [4, 3.4, 2.8]);
    ctx.beginPath(); ctx.ellipse(14.4, 45, 2.4, 1.8, 0, 0, Math.PI * 2); ctx.fill();
  } else if (kind === 'back') {
    // seen from behind, slightly turning head to the right
    fillSpline(ctx, [[-6.6, 79.6], [-8.4, 76], [-7.4, 66], [-5, 58], [-7, 55.4], [-11.6, 34], [-15.4, 10], [-17.6, .6], [17.6, .6], [15.4, 10], [11.6, 34], [7, 55.4], [5, 58], [7.4, 66], [8.4, 76], [6.6, 79.6], [2.6, 81.2], [-2.6, 81.2]], ctx.fillStyle, .9);
    limb(ctx, [[0, 82.6], [0, 79]], [4.4, 5]);
    ctx.beginPath(); ctx.ellipse(.6, 88, 4.8, 5.8, .08, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(4.6, 86.6, 1.6, 2.6, .2, 0, Math.PI * 2); ctx.fill();      // cheek turning
    ctx.beginPath(); ctx.ellipse(0, 91, 3.6, 3.2, 0, 0, Math.PI * 2); ctx.fill();
    fillSpline(ctx, [[-4.6, 93], [4.6, 93], [6.6, 84], [8.2, 70], [6, 60], [0, 58], [-6, 60], [-8.2, 70], [-6.6, 84]], ctx.fillStyle, .8);
    limb(ctx, [[-7.2, 77], [-9, 62], [-9.6, 50]], [3.8, 3.2, 2.6]);
    limb(ctx, [[7.2, 77], [9, 62], [9.6, 50]], [3.8, 3.2, 2.6]);
  }
}
// The Extinguisher: very tall lamplighter. 100 units ≈ 250 cm. Returns pole tip in local units.
function extinguisher(ctx, o = {}) {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const sway = o.sway || 0;
  fillSpline(ctx, [[-5.6, 76], [-7.4, 70], [-7.8, 50], [-8.6, 22], [-10 + sway, .6], [9.6 + sway, .6], [8.4, 22], [7.6, 50], [7.2, 70], [5.2, 76]], ctx.fillStyle, .9);
  poly(ctx, [[-4.6, 78.6], [-13.4, 70.4], [-12.6, 60.2], [-7, 63], [0, 61.6], [7, 63], [12.8, 60.4], [13.6, 70.4], [4.6, 78.6]]); ctx.fill();
  ctx.fillRect(-4.2, 74, 8.4, 5.2); ctx.fillRect(-1.6, 78, 3.2, 3);
  ctx.beginPath(); ctx.ellipse(0, 88.2, 9.8, 1.4, 0, 0, Math.PI * 2); ctx.fill();
  poly(ctx, [[-6, 88.4], [-6.8, 101], [6.8, 101], [6, 88.4]]); ctx.fill();
  limb(ctx, [[-5.6, 73.6], [-8.8, 52], [-9.4, 30]], [3.6, 2.8, 2.2]);
  for (let f = 0; f < 4; f++) { limb(ctx, [[-9.4, 30], [-10.2 + f * .7, 24.6 - f * .4]], [1.4, .6]); }
  limb(ctx, [[5.6, 73.6], [15.4, 64], [23, 62.4]], [3.6, 2.8, 2.2]);
  for (let f = 0; f < 4; f++) { limb(ctx, [[23, 62.4], [27 - f * .5, 61.6 - f * 1.1]], [1.2, .5]); }
  const tip = o.tip || [62, 44];
  ctx.save(); ctx.strokeStyle = o.brass || '#6b5330'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(14, 67); ctx.lineTo(tip[0], tip[1]); ctx.stroke();
  const ang = Math.atan2(tip[1] - 67, tip[0] - 14);
  ctx.translate(tip[0], tip[1]); ctx.rotate(ang); ctx.fillStyle = o.brass || '#6b5330'; poly(ctx, [[-1, 0], [3.4, -2.4], [3.4, 2.4]]); ctx.fill(); ctx.restore();
  return tip;
}
// Render a figure with rim light and soft body gradient. draw(x) paints the silhouette with current fillStyle.
function litFigure(ctx, draw, o) {
  const [m, mx] = mk(); mx.fillStyle = '#fff'; mx.strokeStyle = '#fff'; draw(mx);
  const tinted = (fill, src = m) => { const [c, x] = mk(); x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.drawImage(src, 0, 0); x.restore(); x.globalCompositeOperation = 'source-in'; x.fillStyle = typeof fill === 'function' ? fill(x) : fill; x.fillRect(OFF[0], OFF[1], W, H); return c; };
  if (o.halo) { ctx.save(); ctx.filter = blurF(o.halo[2] || 10); ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = o.halo[1]; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(tinted(rgba(o.halo[0], 1)), 0, 0); ctx.restore(); }
  if (o.rim) {
    const rimC = tinted(rgba(o.rim[0], 1));
    ctx.save(); ctx.globalAlpha = o.rim[1]; ctx.filter = blurF(o.rim[3] || .5); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(rimC, o.rim[2][0] * S, o.rim[2][1] * S); ctx.restore();
    if (o.rim2) { ctx.save(); ctx.globalAlpha = o.rim2[1]; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(tinted(rgba(o.rim2[0], 1)), o.rim2[2][0] * S, o.rim2[2][1] * S); ctx.restore(); }
  }
  let fill = rgba(o.body || '#06070a');
  if (o.grad) fill = x => { const gr = x.createLinearGradient(o.grad[0][0], o.grad[0][1], o.grad[1][0], o.grad[1][1]); gr.addColorStop(0, rgba(o.grad[2])); gr.addColorStop(1, rgba(o.body || '#06070a')); return gr; };
  blit(ctx, tinted(fill));
  return m;
}

/* ---------- props ---------- */
function clockFace(ctx, x, y, r, hh = 17, mm = 42, o = {}) {
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = o.face || '#c9bda2'; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = o.rim || '#3a2c18'; ctx.lineWidth = r * .14; ctx.stroke();
  ctx.strokeStyle = '#1b140c'; ctx.lineWidth = r * .05;
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; ctx.beginPath(); ctx.moveTo(Math.sin(a) * r * .72, -Math.cos(a) * r * .72); ctx.lineTo(Math.sin(a) * r * .86, -Math.cos(a) * r * .86); ctx.stroke(); }
  const ma = mm / 60 * Math.PI * 2, ha = ((hh % 12) + mm / 60) / 12 * Math.PI * 2;
  ctx.lineCap = 'round'; ctx.lineWidth = r * .1; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.sin(ha) * r * .45, -Math.cos(ha) * r * .45); ctx.stroke();
  ctx.lineWidth = r * .06; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.sin(ma) * r * .72, -Math.cos(ma) * r * .72); ctx.stroke();
  ctx.restore();
}
function bentwoodChair(ctx, x, fy, h, col, lw, ang = 0) {
  const u = h / 100; ctx.save(); ctx.translate(x, fy); ctx.rotate(ang); ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.ellipse(-9 * u, -70 * u, 7.5 * u, 16 * u, -.1, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-13 * u, -58 * u); ctx.quadraticCurveTo(-15 * u, -50 * u, -14 * u, -42 * u); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(0, -42 * u, 15 * u, 3.2 * u, 0, 0, Math.PI * 2); ctx.stroke();
  [[-12, -14], [12, 15], [-5, -7], [6, 9]].forEach(l => { ctx.beginPath(); ctx.moveTo(l[0] * u, -42 * u); ctx.lineTo(l[1] * u, 0); ctx.stroke(); });
  ctx.lineWidth = lw * .7; ctx.beginPath(); ctx.ellipse(0, -16 * u, 12 * u, 2.2 * u, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}
function label(ctx, x, y, w, h, ang, lines, o = {}) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
  ctx.fillStyle = o.paper || '#b9a983'; ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.strokeStyle = o.ink || '#3b2a17'; ctx.lineWidth = 1; ctx.strokeRect(-w / 2 + 3, -h / 2 + 3, w - 6, h - 6);
  ctx.fillStyle = o.ink || '#3b2a17'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  lines.forEach((l, i) => { ctx.font = l[1]; ctx.fillText(l[0], 0, -h / 2 + l[2]); });
  ctx.restore();
}
