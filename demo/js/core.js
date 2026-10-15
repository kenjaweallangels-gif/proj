'use strict';
// «Чёрная капля» — playable demo. Core: canvas, loop, time, input, camera, assets, drawing helpers.
// Drawing helpers from tools/concept/lib.js (man, woman, spline, …) are loaded before this file.
window.BD = {};
(() => {
  const B = BD;
  B.VW = 1920; B.VH = 1080;
  B.time = 0; B.paused = false;
  B.F = {
    her: '"Marck Script", "Segoe Script", "Apple Chancery", cursive',
    serif: '"Cormorant Garamond", Georgia, "Times New Roman", serif',
    sc: '"Cormorant SC", "Cormorant Garamond", Georgia, serif',
  };
  B.prefs = { printSubs: false, volume: 0.9 };
  B.reducedMotion = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  try { const p = JSON.parse(localStorage.getItem('bd-prefs') || '{}'); Object.assign(B.prefs, p); } catch (e) { /* storage unavailable */ }
  B.savePrefs = () => { try { localStorage.setItem('bd-prefs', JSON.stringify(B.prefs)); } catch (e) { /* ignore */ } };

  /* ---------- canvas ---------- */
  const cv = document.getElementById('game');
  const cx = cv.getContext('2d', { alpha: false });
  B.cv = cv; B.cx = cx; B.k = 1; B.quality = 1920;
  B.resize = () => {
    const ww = window.innerWidth, wh = window.innerHeight;
    let cw = ww, ch = ww * 9 / 16; if (ch > wh) { ch = wh; cw = wh * 16 / 9; }
    cv.style.width = cw + 'px'; cv.style.height = ch + 'px';
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const target = Math.max(640, Math.min(B.quality, Math.round(cw * dpr)));
    if (cv.width !== target) { cv.width = target; cv.height = Math.round(target * 9 / 16); }
    B.k = cv.width / B.VW;
  };
  window.addEventListener('resize', B.resize);
  B.resize();

  /* ---------- math ---------- */
  B.ease = t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  B.easeOut = t => 1 - Math.pow(1 - t, 3);
  B.easeIn = t => t * t * t;
  B.damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
  B.frac = v => v - Math.floor(v);
  B.hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  B.vnoise = (x) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return lerp(B.hash(i), B.hash(i + 1), u); };
  B.wrapAng = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

  /* ---------- timing: game-time waits for the script ---------- */
  const waiters = [];
  B.wait = s => new Promise(res => { const t = B.time + s; waiters.push({ test: () => B.time >= t, res }); });
  B.until = fn => new Promise(res => { if (fn()) res(); else waiters.push({ test: fn, res }); });
  B.tickWaiters = () => { for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].test()) { const w = waiters.splice(i, 1)[0]; w.res(); } };
  B.tweens = [];
  B.tween = (obj, key, to, dur, ease = B.ease) => new Promise(res => {
    const from = obj[key], t0 = B.time;
    B.tweens = B.tweens.filter(t => !(t.obj === obj && t.key === key));
    B.tweens.push({ obj, key, from, to, t0, dur, ease, res });
  });
  B.tickTweens = () => {
    for (let i = B.tweens.length - 1; i >= 0; i--) {
      const t = B.tweens[i], u = t.dur <= 0 ? 1 : clamp((B.time - t.t0) / t.dur);
      t.obj[t.key] = lerp(t.from, t.to, t.ease(u));
      if (u >= 1) { B.tweens.splice(i, 1); t.res(); }
    }
  };

  /* ---------- input ---------- */
  const keyMap = {
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
    Space: 'jump', ShiftLeft: 'run', ShiftRight: 'run', KeyE: 'act', Enter: 'act', KeyQ: 'look', KeyF: 'look', Escape: 'pause', KeyP: 'pause',
  };
  const held = {}, edge = {}, virt = {};
  B.lastInput = 0; B.inputLocked = true; B.anyKey = false;
  window.addEventListener('keydown', e => {
    const a = keyMap[e.code]; B.anyKey = true;
    if (a) { if (!held[a]) edge[a] = true; held[a] = true; B.lastInput = B.time; e.preventDefault(); }
  });
  window.addEventListener('keyup', e => { const a = keyMap[e.code]; if (a) { held[a] = false; e.preventDefault(); } });
  window.addEventListener('blur', () => { for (const k in held) held[k] = false; });
  B.setVirtual = (a, on) => { if (on && !virt[a]) edge[a] = true; virt[a] = on; if (on) B.lastInput = B.time; };
  let pad = {};
  function pollPad() {
    const gp = navigator.getGamepads ? [...navigator.getGamepads()].find(g => g) : null; const n = {};
    if (gp) {
      const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0, b = i => gp.buttons[i] && gp.buttons[i].pressed;
      n.left = ax < -.35 || b(14); n.right = ax > .35 || b(15); n.up = ay < -.5 || b(12); n.down = ay > .5 || b(13);
      n.jump = b(0); n.act = b(2) || b(1); n.look = b(3); n.run = b(6) || b(7) || b(4) || b(5); n.pause = b(9);
      for (const k in n) { if (n[k] && !pad[k]) { edge[k] = true; B.lastInput = B.time; } }
    }
    pad = n;
  }
  B.btn = a => !B.inputLocked && !!(held[a] || virt[a] || pad[a]);
  B.hit = a => !B.inputLocked && !!edge[a];
  B.rawHit = a => !!edge[a];
  B.clearEdges = () => { for (const k in edge) edge[k] = false; };
  B.pollInput = pollPad;

  /* ---------- camera ---------- */
  B.cam = { x: 960, y: 540, z: 1, tx: 960, ty: 540, tz: 1, rate: 3, zrate: 1.6, shake: 0, sx: 0, sy: 0, lock: false };
  B.camUpdate = dt => {
    const c = B.cam;
    c.x = B.damp(c.x, c.tx, c.rate, dt); c.y = B.damp(c.y, c.ty, c.rate, dt); c.z = B.damp(c.z, c.tz, c.zrate, dt);
    c.shake = Math.max(0, c.shake - dt * 1.5); if (B.reducedMotion) c.shake = 0;
    const s = c.shake * c.shake * 18; c.sx = (B.vnoise(B.time * 17) - .5) * s; c.sy = (B.vnoise(B.time * 19 + 40) - .5) * s;
  };
  B.camSnap = () => { const c = B.cam; c.x = c.tx; c.y = c.ty; c.z = c.tz; };
  // World→device transform with optional parallax p around an anchor point.
  B.view = (ctx, p = 1, anchor = null) => {
    const c = B.cam, k = B.k;
    let ex = c.x, ey = c.y, z = c.z;
    if (p !== 1 && anchor) { ex = anchor[0] + (c.x - anchor[0]) * p; ey = anchor[1] + (c.y - anchor[1]) * p; z = Math.pow(c.z, p); }
    ctx.setTransform(k * z, 0, 0, k * z, k * (B.VW / 2 - ex * z + c.sx), k * (B.VH / 2 - ey * z + c.sy));
  };
  B.screen = ctx => ctx.setTransform(B.k, 0, 0, B.k, 0, 0);
  B.w2s = (x, y) => [(x - B.cam.x) * B.cam.z + B.VW / 2 + B.cam.sx, (y - B.cam.y) * B.cam.z + B.VH / 2 + B.cam.sy];
  B.viewRect = (pad = 0) => { const c = B.cam, hw = B.VW / 2 / c.z + pad, hh = B.VH / 2 / c.z + pad; return [c.x - hw, c.y - hh, c.x + hw, c.y + hh]; };

  /* ---------- assets ---------- */
  B.PLATES = {
    house: { origin: [200, 120], size: [2420, 1300] }, street: { origin: [1200, 600], size: [200, 320] },
    outside: { origin: [-600, -300], size: [3800, 1900] }, obs_sky: { origin: [1100, -1500], size: [3800, 1800] },
    obs_dome: { origin: [1250, -1340], size: [3500, 1560] }, obs_mid: { origin: [1250, -560], size: [3500, 800] },
    theatre: { origin: [0, 0], size: [1920, 1080] },
  };
  B.img = {};
  B.loadAll = onProgress => {
    const names = Object.keys(B.PLATES); let done = 0;
    return Promise.all(names.map(n => new Promise((res, rej) => {
      const im = new Image(); im.onload = () => { done++; onProgress && onProgress(done / names.length); res(); };
      im.onerror = () => rej(new Error('Не удалось загрузить фон ' + n)); im.src = 'assets/' + n + '.webp'; B.img[n] = im;
    })));
  };
  B.plate = (ctx, name, alpha = 1) => {
    const p = B.PLATES[name], im = B.img[name]; if (!im) return;
    ctx.save(); if (alpha < 1) ctx.globalAlpha = alpha;
    ctx.drawImage(im, p.origin[0], p.origin[1], p.size[0], p.size[1]); ctx.restore();
  };

  /* ---------- offscreen & sprites ---------- */
  B.off = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; };
  const glowCache = {};
  B.glowSprite = rgb => {
    const key = rgb.join(','); if (glowCache[key]) return glowCache[key];
    const c = B.off(128, 128), x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, rgba(rgb, 1)); g.addColorStop(.22, rgba(rgb, .5)); g.addColorStop(.55, rgba(rgb, .14)); g.addColorStop(1, rgba(rgb, 0));
    x.fillStyle = g; x.fillRect(0, 0, 128, 128); glowCache[key] = c; return c;
  };
  B.glow = (ctx, x, y, r, rgb, a, comp = 'lighter') => {
    if (a <= 0.002 || r <= 0) return;
    ctx.save(); ctx.globalCompositeOperation = comp; ctx.globalAlpha = Math.min(1, a);
    ctx.drawImage(B.glowSprite(rgb), x - r, y - r, r * 2, r * 2); ctx.restore();
  };
  B.pool = (ctx, x, y, rx, ry, rgb, a) => {
    if (a <= 0.002) return;
    ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = Math.min(1, a);
    ctx.drawImage(B.glowSprite(rgb), x - rx, y - ry, rx * 2, ry * 2); ctx.restore();
  };
  // Soft noise texture (white with fbm alpha), used for fog and smoke.
  B.noiseTex = (w, h, o) => noiseCanvas(w, h, o);

  /* ---------- figures with rim light ---------- */
  // Draws a silhouette (drawFn paints in world coordinates with the current fillStyle) through two
  // small offscreen canvases: a coloured rim offset toward the light, then the dark body on top.
  const f1 = B.off(8, 8), f2 = B.off(8, 8), f1x = f1.getContext('2d'), f2x = f2.getContext('2d');
  B.figure = (ctx, bbox, drawFn, o = {}) => {
    const c = B.cam, k = B.k, z = c.z * (o.zMul || 1);
    const ox = o.view ? o.view.ox : k * (B.VW / 2 - c.x * c.z + c.sx), oy = o.view ? o.view.oy : k * (B.VH / 2 - c.y * c.z + c.sy), sc = o.view ? o.view.s : k * c.z;
    let x0 = Math.floor(bbox[0] * sc + ox), y0 = Math.floor(bbox[1] * sc + oy), x1 = Math.ceil(bbox[2] * sc + ox), y1 = Math.ceil(bbox[3] * sc + oy);
    x0 = Math.max(x0, -40); y0 = Math.max(y0, -40); x1 = Math.min(x1, B.cv.width + 40); y1 = Math.min(y1, B.cv.height + 40);
    const w = x1 - x0, h = y1 - y0; if (w <= 2 || h <= 2) return;
    if (f1.width < w || f1.height < h) { f1.width = f2.width = Math.max(f1.width, w); f1.height = f2.height = Math.max(f1.height, h); }
    f1x.setTransform(1, 0, 0, 1, 0, 0); f1x.clearRect(0, 0, w + 2, h + 2);
    f1x.setTransform(sc, 0, 0, sc, ox - x0, oy - y0); f1x.fillStyle = '#fff'; f1x.strokeStyle = '#fff';
    drawFn(f1x);
    const tint = fill => {
      f2x.setTransform(1, 0, 0, 1, 0, 0); f2x.globalCompositeOperation = 'source-over'; f2x.clearRect(0, 0, w + 2, h + 2);
      f2x.drawImage(f1, 0, 0, w, h, 0, 0, w, h); f2x.globalCompositeOperation = 'source-in';
      f2x.fillStyle = typeof fill === 'function' ? fill(f2x, w, h) : fill; f2x.fillRect(0, 0, w, h); f2x.globalCompositeOperation = 'source-over';
    };
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    const alpha = o.alpha == null ? 1 : o.alpha;
    if (o.halo && o.halo[1] > 0) { tint(rgba(o.halo[0], 1)); ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = o.halo[1] * alpha; ctx.filter = `blur(${(o.halo[2] || 8) * sc / 1.4}px)`; ctx.drawImage(f2, 0, 0, w, h, x0, y0, w, h); ctx.filter = 'none'; ctx.globalCompositeOperation = 'source-over'; }
    if (o.rim && o.rim[1] > 0.01) {
      tint(o.rimFade === false ? rgba(o.rim[0], 1) : (x, ww, hh) => { const g = x.createLinearGradient(0, 0, 0, hh); g.addColorStop(0, rgba(o.rim[0], 1)); g.addColorStop(.55, rgba(o.rim[0], .75)); g.addColorStop(1, rgba(o.rim[0], .12)); return g; });
      ctx.globalAlpha = o.rim[1] * alpha * .85;
      const d = (o.rim[2] || 1.6) * sc; ctx.drawImage(f2, 0, 0, w, h, x0 + o.rim[3][0] * d, y0 + o.rim[3][1] * d, w, h);
    }
    if (o.rim2 && o.rim2[1] > 0.01) {
      tint(rgba(o.rim2[0], 1)); ctx.globalAlpha = o.rim2[1] * alpha;
      const d = (o.rim2[2] || 1.2) * sc; ctx.drawImage(f2, 0, 0, w, h, x0 + o.rim2[3][0] * d, y0 + o.rim2[3][1] * d, w, h);
    }
    if (o.body !== false) {
      const body = o.body || [6, 7, 10];
      tint(o.grad ? (x, ww, hh) => { const g = x.createLinearGradient(0, 0, 0, hh); g.addColorStop(0, rgba(o.grad, 1)); g.addColorStop(.55, rgba(body, 1)); g.addColorStop(1, rgba(body, 1)); return g; } : rgba(body, 1));
      ctx.globalAlpha = alpha; if (o.comp) ctx.globalCompositeOperation = o.comp;
      ctx.drawImage(f2, 0, 0, w, h, x0, y0, w, h);
    }
    ctx.restore();
  };

  /* ---------- text ---------- */
  B.text = (ctx, s, x, y, font, color, o = {}) => {
    ctx.save(); ctx.font = font; ctx.fillStyle = color; ctx.textAlign = o.align || 'center'; ctx.textBaseline = o.base || 'alphabetic';
    if (o.alpha != null) ctx.globalAlpha = o.alpha;
    if (o.shadow) { ctx.shadowColor = o.shadow; ctx.shadowBlur = o.blur || 12; }
    if (o.spacing) ctx.letterSpacing = o.spacing + 'px';
    ctx.fillText(s, x, y); ctx.restore();
  };
})();
