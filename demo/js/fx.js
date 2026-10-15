'use strict';
// Screen effects and on-screen text: grain, vignette, the ink wash, kaleidoscope, rewind, subtitles,
// prompts, HUD, the epigraph and the title drop.
(() => {
  const B = BD, A = B.audio, F = B.fx = { fade: 1, white: 0, rewind: 0, desat: 0 };

  /* ---------- grain & vignette ---------- */
  const grains = [0, 1, 2].map(s => {
    const c = B.off(384, 384), x = c.getContext('2d'), d = x.createImageData(384, 384), r = rng(40 + s);
    for (let i = 0; i < d.data.length; i += 4) { const v = 128 + (r() - .5) * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
    x.putImageData(d, 0, 0); return c;
  });
  const vig = (() => { const c = B.off(480, 270), x = c.getContext('2d'), g = x.createRadialGradient(240, 140, 60, 240, 135, 300); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(.6, 'rgba(0,0,0,.18)'); g.addColorStop(1, 'rgba(0,0,0,.72)'); x.fillStyle = g; x.fillRect(0, 0, 480, 270); return c; })();
  F.post = (ctx, o = {}) => {
    B.screen(ctx);
    ctx.drawImage(vig, 0, 0, B.VW, B.VH);
    if (F.desat > .01) { ctx.save(); ctx.globalCompositeOperation = 'saturation'; ctx.globalAlpha = F.desat; ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, B.VW, B.VH); ctx.restore(); }
    if (F.rewind > .01) drawRewind(ctx);
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = o.grain || .085;
    const g = grains[Math.floor(B.time * 24) % 3], ox = Math.floor(Math.random() * 384), oy = Math.floor(Math.random() * 384), W = B.cv.width, H = B.cv.height;
    for (let y = -oy; y < H; y += 384) for (let x = -ox; x < W; x += 384) ctx.drawImage(g, x, y);
    ctx.restore();
    if (F.white > .005) { B.screen(ctx); ctx.fillStyle = rgba([235, 240, 255], F.white); ctx.fillRect(0, 0, B.VW, B.VH); }
    if (F.fade > .002) { B.screen(ctx); ctx.fillStyle = rgba([0, 0, 0], F.fade); ctx.fillRect(0, 0, B.VW, B.VH); }
  };
  function drawRewind(ctx) {
    const a = F.rewind; ctx.save(); ctx.globalAlpha = a;
    ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = 'rgb(225,205,175)'; ctx.fillRect(0, 0, B.VW, B.VH);
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 7; i++) { const y = B.frac(B.time * (.7 + i * .13) + i * .31) * B.VH; ctx.fillStyle = 'rgba(230,225,215,.08)'; ctx.fillRect(0, y, B.VW, 2 + i % 3 * 3); }
    ctx.restore();
    // horizontal tearing: shift a few bands of the frame sideways
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); const H = B.cv.height, W = B.cv.width;
    if (rewBuf.width !== W || rewBuf.height !== H) { rewBuf.width = W; rewBuf.height = H; }
    rewBx.drawImage(B.cv, 0, 0);
    for (let i = 0; i < 5; i++) { const y = Math.floor(B.hash(i + Math.floor(B.time * 12)) * H), h = Math.floor(H * .02 + B.hash(i * 3) * H * .04), dx = (B.hash(i * 7 + Math.floor(B.time * 20)) - .5) * 60 * B.k * a; ctx.drawImage(rewBuf, 0, y, W, h, dx, y, W, h); }
    ctx.restore();
  }

  /* ---------- the ink wash ---------- */
  const washBuf = B.off(64, 64), washBx = washBuf.getContext('2d');
  const rewBuf = B.off(64, 64), rewBx = rewBuf.getContext('2d');
  const voidStars = []; { const r = rng(808); for (let i = 0; i < 260; i++) voidStars.push([1250 + r() * 3500, -1400 + r() * 1650, .5 + Math.pow(r(), 5) * 2.4, r()]); }
  F.wash = (ctx, wx) => {
    const c = B.cam, k = B.k, z = c.z, front = (B.w2s(wx, 0)[0]) * k, zone = 300 * z * k, Hd = B.cv.height;
    if (front < -10) return;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    const n = 30, sw = zone / n, x0 = front - zone;
    // copy only the melting band once, then pour strips of it downward
    const bx0 = Math.max(0, Math.floor(x0)), bx1 = Math.min(B.cv.width, Math.ceil(front) + 2), bw = bx1 - bx0;
    if (bw > 0) { if (washBuf.width < bw || washBuf.height !== Hd) { washBuf.width = Math.max(bw, washBuf.width); washBuf.height = Hd; } washBx.clearRect(0, 0, bw, Hd); washBx.drawImage(B.cv, bx0, 0, bw, Hd, 0, 0, bw, Hd); }
    for (let i = 0; i < n; i++) {
      const x = x0 + i * sw; if (x + sw < 0 || x > B.cv.width) continue;
      const t = i / n, wcol = Math.floor((x / k - B.VW / 2) / z + c.x) / 9;
      const off = Math.pow(1 - t, 1.8) * 560 * z * k * (.45 + .55 * B.vnoise(wcol * .35 + B.time * .4));
      if (off > 1 && bw > 0) { const sx = Math.max(0, x - bx0); ctx.drawImage(washBuf, sx, 0, Math.min(sw + 1, washBuf.width - sx), Hd - off, x, off, sw + 1, Hd - off); }
      ctx.fillStyle = rgba([3, 4, 10], .96); ctx.fillRect(x, 0, sw + 1, off);
      ctx.fillStyle = rgba([3, 4, 10], Math.pow(1 - t, 1.4) * .85); ctx.fillRect(x, off, sw + 1, Hd - off);
      // a wet highlight at the lip of each drip
      ctx.fillStyle = rgba([150, 170, 210], .12 * (1 - t)); ctx.fillRect(x, off - 2, sw + 1, 2);
    }
    if (x0 > 0) { ctx.fillStyle = '#03040a'; ctx.fillRect(0, 0, x0 + 1, Hd); }
    ctx.restore();
    // sparse stars in the exposed void
    B.view(ctx);
    const lim = wx - 300;
    for (const [x, y, s, p] of voidStars) if (x < lim) B.glow(ctx, x, y, s * 3, [200, 215, 255], .5 + .4 * Math.sin(B.time * 2 + p * 9));
  };

  /* ---------- kaleidoscope dive ---------- */
  let kSrc = null;
  F.kaleidoGrab = () => { kSrc = B.off(B.cv.width, B.cv.height); kSrc.getContext('2d').drawImage(B.cv, 0, 0); };
  F.kaleido = (ctx, prog, mix = 1) => {
    if (!kSrc) return;
    const W = B.cv.width, H = B.cv.height, cx = W / 2, cy = H / 2, R = Math.hypot(W, H) * .6, seg = Math.PI / 6, rot = prog * 1.8;
    const zoom = 1 + prog * 3.5;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = mix;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 12; i++) {
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(i * seg + rot); if (i % 2) ctx.scale(1, -1);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(R, -R * Math.tan(seg / 2)); ctx.lineTo(R, R * Math.tan(seg / 2)); ctx.closePath(); ctx.clip();
      ctx.rotate(-prog * 2.4); ctx.scale(zoom, zoom); ctx.drawImage(kSrc, -cx, -cy);
      ctx.restore();
    }
    ctx.restore();
  };

  /* ---------- subtitles ---------- */
  const subs = [];
  F.say = (text, dur = 3, o = {}) => { const s = { text, dur, t0: B.time, tag: o.tag || '', style: o.style || 'her' }; subs.push(s); return B.wait(dur + (o.gap || .25)); };
  function drawSubs(ctx) {
    B.screen(ctx);
    let row = 0;
    for (let i = subs.length - 1; i >= 0; i--) {
      const s = subs[i], el = B.time - s.t0; if (el > s.dur + .6) { subs.splice(i, 1); continue; }
      const a = Math.min(1, el / .35) * (el > s.dur ? 1 - (el - s.dur) / .6 : 1), y = (F.subY || B.VH - 92) - row * 92; row++;
      const print = B.prefs.printSubs, font = print ? `500 40px ${B.F.serif}` : s.style === 'whisper' ? `44px ${B.F.her}` : `46px ${B.F.her}`;
      ctx.save(); ctx.font = font; const w = ctx.measureText(s.text).width; ctx.restore();
      const reveal = Math.min(1, el / Math.max(.4, s.text.length * .035));
      ctx.save(); ctx.beginPath(); ctx.rect(B.VW / 2 - w / 2 - 20, y - 70, (w + 40) * reveal, 110); ctx.clip();
      B.text(ctx, s.text, B.VW / 2, y, font, s.style === 'wall' ? rgba([200, 192, 178], a) : rgba([236, 228, 212], a), { shadow: 'rgba(0,0,0,.95)', blur: 14 });
      ctx.restore();
      if (s.tag) B.text(ctx, s.tag, B.VW / 2, y - 52, `600 19px ${B.F.sc}`, rgba([170, 160, 140], a * .85), { shadow: 'rgba(0,0,0,.9)', spacing: 3 });
    }
  }

  /* ---------- prompts ---------- */
  // F.prompt = { text, key, wx, wy, a, hold, fixed } — world-anchored; hold (0..1) draws a ring
  F.prompt = null;
  const keyName = { act: 'E', look: 'Q', jump: '␣', up: 'W' };
  F.keyLabel = k => (B.touch ? ({ act: 'Рука', look: 'Глаз', jump: 'Прыжок', up: 'Вверх' })[k] : keyName[k]) || k;
  function drawPrompt(ctx) {
    const p = F.prompt; if (!p || p.a <= .01) return;
    const [sx, sy] = p.fixed ? [p.wx, p.wy] : B.w2s(p.wx, p.wy); B.screen(ctx);
    ctx.save(); ctx.globalAlpha = p.a; ctx.font = `italic 500 30px ${B.F.serif}`; const tw = ctx.measureText(p.text).width;
    const kw = 40, w = kw + 18 + tw + 26, h = 54, x = clamp(sx - w / 2, 20, B.VW - w - 20), y = clamp(sy - h - 10, 20, B.VH - h - 20);
    ctx.fillStyle = 'rgba(8,8,11,.78)'; ctx.beginPath(); ctx.roundRect(x, y, w, h, 27); ctx.fill();
    ctx.strokeStyle = 'rgba(201,180,140,.45)'; ctx.lineWidth = 1.2; ctx.stroke();
    const kx = x + 7 + kw / 2, ky = y + h / 2;
    ctx.strokeStyle = 'rgba(201,180,140,.85)'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(kx, ky, 19, 0, 7); ctx.stroke();
    if (p.hold != null) { ctx.strokeStyle = '#e9c98f'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(kx, ky, 19, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(p.hold)); ctx.stroke(); }
    const kl = F.keyLabel(p.key);
    B.text(ctx, kl, kx, ky + (kl.length > 2 ? 5 : 8), kl.length > 2 ? `600 12px ${B.F.sc}` : `600 24px ${B.F.sc}`, '#efe2c4');
    B.text(ctx, p.text, x + kw + 22, y + h / 2 + 10, `italic 500 30px ${B.F.serif}`, '#e6dccb', { align: 'left' });
    ctx.restore();
  }
  F.idleHint = 0;
  function drawIdle(ctx) {
    if (F.idleHint <= .01) return; B.screen(ctx); ctx.save(); ctx.globalAlpha = F.idleHint * .55;
    const x = 90, y = B.VH - 110; ctx.strokeStyle = '#d8ccb4'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(x, y, 34, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.arc(x + 10 * Math.sin(B.time * 2), y, 16, 0, 7); ctx.fillStyle = 'rgba(216,204,180,.25)'; ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  /* ---------- chapter title and HUD ---------- */
  F.hud = { title: 0, a: 0, count: 0, countA: 0, thread: 1, light: .65 };
  function drawHud(ctx) {
    const h = F.hud; B.screen(ctx);
    if (h.title > 0) {
      const s1 = '1. ОБСЕРВАТОРИЯ «НАБЛЮДАТЕЛЬ»', s2 = 'Где звёзды пишут письма на стекле.', a = clamp(h.titleA == null ? 1 : h.titleA);
      ctx.save(); ctx.font = `600 46px ${B.F.sc}`; const w1 = ctx.measureText(s1).width; ctx.font = `italic 500 32px ${B.F.serif}`; const w2 = ctx.measureText(s2).width; ctx.restore();
      const r1 = clamp(h.title * 1.6), r2 = clamp(h.title * 1.6 - .7);
      ctx.save(); ctx.globalAlpha = a; ctx.beginPath(); ctx.rect(50, 30, (w1 + 20) * r1, 80); ctx.clip(); B.text(ctx, s1, 58, 92, `600 46px ${B.F.sc}`, '#ece3d1', { align: 'left', shadow: 'rgba(0,0,0,.9)', blur: 14 }); ctx.restore();
      ctx.save(); ctx.globalAlpha = a; ctx.beginPath(); ctx.rect(50, 110, (w2 + 20) * r2, 50); ctx.clip(); B.text(ctx, s2, 60, 142, `italic 500 32px ${B.F.serif}`, '#d2c7b1', { align: 'left', shadow: 'rgba(0,0,0,.9)', blur: 12 }); ctx.restore();
      if (r1 < 1) B.glow(ctx, 58 + w1 * r1, 78, 14, [255, 230, 190], .6 * a);
    }
    if (h.a > .01) {
      ctx.save(); ctx.globalAlpha = h.a;
      const bx = 112, by = 236;
      ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.beginPath(); ctx.arc(bx, by, 52, 0, 7); ctx.fill();
      ctx.strokeStyle = '#c9b48c'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(bx, by, 52, 0, 7); ctx.stroke();
      ctx.strokeStyle = 'rgba(201,180,140,.45)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(bx, by, 41, 0, 7); ctx.stroke();
      ctx.strokeStyle = '#d9874a'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(bx, by, 47, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * .7); ctx.stroke();
      ctx.strokeStyle = '#efe2c4'; ctx.lineWidth = 2.2; poly(ctx, [[bx - 14, by - 22], [bx + 14, by - 22], [bx + 2, by], [bx + 14, by + 22], [bx - 14, by + 22], [bx - 2, by]]); ctx.stroke();
      ctx.fillStyle = '#efe2c4'; poly(ctx, [[bx - 8, by + 18], [bx + 8, by + 18], [bx, by + 9]]); ctx.fill();
      const bar = (y, label, v, c) => { B.text(ctx, label, bx + 66, y - 6, `600 17px ${B.F.sc}`, '#cbbd9f', { align: 'left', spacing: 2 }); ctx.fillStyle = 'rgba(30,26,22,.85)'; ctx.fillRect(bx + 66, y, 220, 9); ctx.fillStyle = c; ctx.fillRect(bx + 66, y, 220 * v, 9); ctx.strokeStyle = '#c9b48c'; ctx.lineWidth = 1; ctx.strokeRect(bx + 66, y, 220, 9); };
      bar(by - 14, 'НИТЬ', h.thread, '#c4643a'); bar(by + 28, 'СВЕТ', h.light, '#5d7f9a');
      // two skill cells
      const cell = (x, label, icon) => {
        ctx.fillStyle = 'rgba(8,8,11,.7)'; ctx.fillRect(x, B.VH - 150, 76, 76); ctx.strokeStyle = 'rgba(201,180,140,.6)'; ctx.lineWidth = 1.4; ctx.strokeRect(x, B.VH - 150, 76, 76);
        ctx.save(); ctx.translate(x + 38, B.VH - 112); ctx.strokeStyle = '#efe2c4'; ctx.lineWidth = 2; icon(); ctx.restore();
        B.text(ctx, label, x + 38, B.VH - 50, `600 15px ${B.F.sc}`, '#cbbd9f', { spacing: 1 });
      };
      cell(60, 'ВГЛЯДЕТЬСЯ', () => { ctx.beginPath(); ctx.moveTo(-22, 0); ctx.quadraticCurveTo(0, -18, 22, 0); ctx.quadraticCurveTo(0, 18, -22, 0); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, 7, 0, 7); ctx.fill(); });
      cell(196, 'КОСНУТЬСЯ', () => { ctx.beginPath(); ctx.moveTo(-10, 20); ctx.lineTo(-10, -2); ctx.moveTo(-4, 20); ctx.lineTo(-4, -16); ctx.moveTo(2, 20); ctx.lineTo(2, -18); ctx.moveTo(8, 20); ctx.lineTo(8, -12); ctx.moveTo(-10, 4); ctx.lineTo(-18, -4); ctx.stroke(); });
      // inventory: a photograph with an empty face, a quill
      const ix = B.VW - 260, iy = B.VH - 160;
      ctx.fillStyle = 'rgba(8,8,11,.7)'; ctx.fillRect(ix, iy, 200, 100); ctx.strokeStyle = 'rgba(201,180,140,.6)'; ctx.strokeRect(ix, iy, 200, 100);
      ctx.save(); ctx.translate(ix + 52, iy + 50); ctx.rotate(-.06); ctx.fillStyle = '#b7a684'; ctx.fillRect(-30, -38, 60, 76); ctx.fillStyle = '#6d5f49'; ctx.fillRect(-25, -33, 50, 60); ctx.fillStyle = '#c9bb9c'; ctx.beginPath(); ctx.ellipse(0, -8, 10, 13, 0, 0, 7); ctx.fill(); ctx.fillStyle = '#4a3f30'; ctx.fillRect(-16, 8, 32, 19); ctx.restore();
      ctx.save(); ctx.translate(ix + 150, iy + 50); ctx.rotate(-.7); ctx.fillStyle = '#e4dccb'; fillSpline(ctx, [[0, -38], [8, -20], [6, 6], [0, 30], [-5, 6], [-7, -20]], '#e4dccb', .8); ctx.strokeStyle = '#3a2c18'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(0, -36); ctx.lineTo(0, 40); ctx.stroke(); ctx.restore();
      ctx.restore();
    }
    if (h.countA > .01) B.text(ctx, `Отголоски: ${h.count}/12`, B.VW - 60, B.VH - 52 - (h.a > .01 ? 120 : 0), `600 30px ${B.F.sc}`, rgba([221, 210, 189], h.countA), { align: 'right', shadow: 'rgba(0,0,0,.9)', blur: 10 });
  }

  /* ---------- epigraph (handwritten, then dripping) ---------- */
  let epi = null;
  function bakeEpi() {
    const c = B.off(1920, 420), x = c.getContext('2d');
    x.fillStyle = '#e8e0d0'; x.textAlign = 'center'; x.textBaseline = 'alphabetic';
    x.font = `66px ${B.F.her}`; x.fillText('Помни меня — но, ах, забудь мою судьбу.', 960, 190);
    x.fillStyle = '#a99f8c'; x.font = `italic 500 34px ${B.F.serif}`; x.fillText('— «Плач Дидоны», старинная ария', 960, 270);
    epi = c;
  }
  F.epi = { on: false, write: 0, drip: 0, a: 1 };
  function drawEpi(ctx) {
    const e = F.epi; if (!e.on) return; if (!epi) bakeEpi(); B.screen(ctx);
    const y0 = 330, w1 = 1920;
    if (e.drip <= 0) {
      ctx.save(); ctx.beginPath(); ctx.rect(0, y0, lerp(380, 1560, clamp(e.write / .8)), 230); ctx.rect(0, y0 + 230, lerp(560, 1360, clamp((e.write - .8) / .2)), 190); ctx.clip();
      ctx.globalAlpha = e.a; ctx.drawImage(epi, 0, y0); ctx.restore();
      if (e.write < 1) { const nx = e.write < .8 ? lerp(380, 1560, e.write / .8) : lerp(560, 1360, (e.write - .8) / .2), ny = e.write < .8 ? y0 + 175 : y0 + 262; B.glow(ctx, nx, ny, 16, [255, 240, 210], .6); }
    } else {
      const n = 160, sw = w1 / n;
      for (let i = 0; i < n; i++) {
        const off = Math.pow(e.drip, 1.6) * (120 + 380 * B.hash(i * 1.7)) * (B.hash(i * 3.3) < .2 ? 1.6 : 1), a = clamp(1 - e.drip * (.8 + B.hash(i) * .6));
        if (a <= 0) continue; ctx.globalAlpha = a; ctx.drawImage(epi, i * sw, 0, sw, 420, i * sw, y0 + off, sw, 420 + off * .4);
      }
      ctx.globalAlpha = 1;
    }
  }

  /* ---------- the title drop ---------- */
  F.title = { on: false, t: 0, sub: 0 };
  function drawTitle(ctx) {
    const T = F.title; if (!T.on) return; B.screen(ctx); const t = T.t, cx = B.VW / 2, cy = B.VH / 2 - 20;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, B.VW, B.VH);
    if (t < .55) { // falling drop
      const y = lerp(-40, cy, B.easeIn(t / .55)), s = 1 + t * 1.5;
      ctx.fillStyle = '#0b0c12'; ctx.beginPath(); ctx.ellipse(cx, y, 9, 9 * s, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(200,210,235,.6)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(cx, y, 9, 9 * s, 0, -2.4, -.8); ctx.stroke();
      return;
    }
    const u = t - .55, R = 40 + 420 * (1 - Math.exp(-u * 2.2)), shrink = clamp((u - 1.1) / 1.4);
    ctx.save();
    if (shrink < 1) {
      ctx.globalAlpha = 1 - shrink;
      ctx.beginPath(); for (let i = 0; i <= 72; i++) { const a = i / 72 * Math.PI * 2, r = R * (1 - shrink * .6) * (.78 + .22 * B.vnoise(i * .45 + 3) + .05 * Math.sin(a * 7 + u * 3)); const x = cx + Math.cos(a) * r * 1.5, y = cy + Math.sin(a) * r * .32; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.closePath(); ctx.fillStyle = '#07080d'; ctx.fill(); ctx.strokeStyle = 'rgba(180,195,230,.3)'; ctx.lineWidth = 2; ctx.stroke();
    }
    ctx.restore();
    const ta = clamp((u - .8) / 1.2);
    if (ta > 0) {
      ctx.save(); ctx.beginPath(); ctx.ellipse(cx, cy, 900 * B.easeOut(ta) + 1, 260 * B.easeOut(ta) + 1, 0, 0, 7); ctx.clip();
      B.text(ctx, 'ЧЁРНАЯ КАПЛЯ', cx, cy + 40, `700 132px ${B.F.sc}`, '#e8e0d0', { shadow: 'rgba(160,180,230,.35)', blur: 30, spacing: 10 });
      ctx.restore();
    }
    if (T.sub > 0) B.text(ctx, 'Добавьте в список желаемого', cx, cy + 130, `italic 500 30px ${B.F.serif}`, rgba([170, 160, 145], T.sub));
  }

  F.drawUI = ctx => { drawTitle(ctx); drawEpi(ctx); drawHud(ctx); drawPrompt(ctx); drawIdle(ctx); drawSubs(ctx); };
  F.clearSubs = () => { subs.length = 0; };
})();
