'use strict';
// World: the house in cross-section, the observatory, the theatre. Geometry, live props, light, particles, rendering.
(() => {
  const B = BD, A = B.audio, H = B.hero;
  const WD = B.world = { area: 'black', t: 0 };

  /* ================= particles ================= */
  const parts = WD.parts = [];
  WD.emit = o => parts.push(Object.assign({ x: 0, y: 0, vx: 0, vy: 0, t: 0, life: 1, size: 2, col: [255, 255, 255], a: 1, g: 0, drag: 0, wob: 0, layer: 'mid' }, o));
  function updateParts(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]; p.t += dt; if (p.t >= p.life) { parts.splice(i, 1); continue; }
      p.vy += p.g * dt; p.vx *= 1 - p.drag * dt; p.vy *= 1 - p.drag * dt;
      p.x += (p.vx + Math.sin(p.t * 3 + p.size * 7) * p.wob) * dt; p.y += p.vy * dt;
      if (p.target) { const k = 1 - Math.exp(-p.pull * dt); p.x += (p.target[0] - p.x) * k; p.y += (p.target[1] - p.y) * k; }
    }
  }
  function drawParts(ctx, layer) {
    for (const p of parts) {
      if (p.layer !== layer) continue;
      const u = p.t / p.life, a = p.a * (p.fadeIn ? Math.min(1, p.t / p.fadeIn) : 1) * (1 - Math.pow(u, 2));
      if (p.kind === 'strand') { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = rgba(p.col, a * .7); ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.bezierCurveTo(p.x + 14 * Math.sin(p.t * 2), p.y - 16, p.x - 12, p.y - 30, p.x + 6 * Math.sin(p.t * 3), p.y - 46); ctx.stroke(); ctx.restore(); B.glow(ctx, p.x, p.y, 14, p.col, a * .5); continue; }
      B.glow(ctx, p.x, p.y, p.size * 3, p.col, a);
    }
  }
  WD.updateParts = updateParts; WD.drawParts = drawParts;

  /* ================= light for figures ================= */
  // rim: [rgb, alpha, distance, dir]
  WD.rim = (col, a, dir, d = 1.4) => ({ rim: [col, a, d, dir] });

  /* ================= THE HOUSE ================= */
  const hs = WD.house = {
    chair: { x: 975, ang: 0, rock: 0 }, door: 0, fire: 1, refl: { woman: 1, rock: 0, gone: false, faceT: 0 },
    proc: { x: 1430, on: false }, lamp: { x: 1180, on: false, pole: 0, target: 0 }, street: [1, 1, 1], across: 1,
    maid: { on: false, x: 2440, y: 940, s: .97, a: 0, cups: 2, walk: 0, f: -1, pose: 'walk', sigh: 0 }, sideCup: false,
    crepe: { wave: .3, lift: 0, hx: 0, hy: 0 }, ripples: [], rippleT: 0, flash: 0, dust: [],
    trunk: { x0: 1975, x1: 2061, y0: 892, y1: 940, push: true, limit: 2189, noMantle: false },
    clockLook: 0,
  };
  const SLAMPS = [[1236, 752], [1281, 740], [1338, 746]];
  const PANES = [[1240, 640, 57, 112], [1303, 640, 57, 112], [1240, 757, 57, 123], [1303, 757, 57, 123]];
  WD.houseGeo = () => {
    hs.doorSolid = { x0: 1560, x1: 1580, y0: 720, y1: 940, noMantle: true };
    B.geo = {
      solids: [
        { x0: 260, x1: 2560, y0: 940, y1: 990 }, { x0: 680, x1: 700, y0: 560, y1: 940, noMantle: true }, { x0: 2540, x1: 2580, y0: 160, y1: 940, noMantle: true },
        hs.doorSolid, hs.trunk, { x0: 2190, x1: 2310, y0: 840, y1: 940 }, { x0: 2430, x1: 2480, y0: 820, y1: 940 }, { x0: 2480, x1: 2540, y0: 760, y1: 940 },
      ],
      ramps: [{ x0: 2310, y0: 840, x1: 2430, y1: 760 }],
      ladders: [{ x: 2508, top: 178, bottom: 760, onTop: () => WD.onLadderTop && WD.onLadderTop() }],
      bounds: [720, 2530],
    };
    for (let i = 0; i < 70; i++) hs.dust.push({ x: 1060 + Math.random() * 320, y: 650 + Math.random() * 290, p: Math.random() * 10, s: .6 + Math.random() * 1.6 });
  };

  const rainDrops = []; for (let i = 0; i < 260; i++) rainDrops.push({ x: Math.random(), y: Math.random(), l: 18 + Math.random() * 30, v: .9 + Math.random() * .6, a: .1 + Math.random() * .25 });
  function drawRain(ctx, a = 1, slant = -.1) {
    B.screen(ctx); ctx.save(); ctx.lineCap = 'round'; ctx.lineWidth = 1.2;
    for (const r of rainDrops) {
      const y = B.frac(r.y + WD.t * r.v * .9) * (B.VH + 80) - 40, x = B.frac(r.x + y * slant / B.VW - WD.t * .01) * B.VW;
      ctx.strokeStyle = rgba([170, 185, 215], r.a * a); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + r.l * slant, y + r.l); ctx.stroke();
    }
    ctx.restore();
  }
  const drops = []; for (let i = 0; i < 40; i++) drops.push({ x: 1240 + Math.random() * 120, y: 640 + Math.random() * 240, v: 0, s: .6 + Math.random() * 1.4, hold: Math.random() * 4 });
  function drawDrops(ctx, dt) {
    for (const d of drops) {
      d.hold -= dt; if (d.hold < 0) { d.v = Math.min(60, d.v + 80 * dt); d.y += d.v * dt; if (Math.random() < dt * 2) { d.hold = Math.random() * 1.5; d.v = 0; } }
      if (d.y > 882) { d.y = 640 + Math.random() * 60; d.x = 1240 + Math.random() * 120; d.hold = Math.random() * 3; }
      if (d.v > 5) { const g = ctx.createLinearGradient(0, d.y - 18, 0, d.y); g.addColorStop(0, 'rgba(200,215,235,0)'); g.addColorStop(1, 'rgba(200,215,235,.10)'); ctx.fillStyle = g; ctx.fillRect(d.x - d.s * .35, d.y - 18, d.s * .7, 18); }
      ctx.fillStyle = 'rgba(10,14,22,.35)'; ctx.beginPath(); ctx.ellipse(d.x, d.y, d.s, d.s * 1.25, 0, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(215,228,250,.5)'; ctx.beginPath(); ctx.ellipse(d.x + d.s * .25, d.y + d.s * .3, d.s * .45, d.s * .55, 0, 0, 7); ctx.fill();
    }
  }
  const panesPath = ctx => { ctx.beginPath(); PANES.forEach(([x, y, w, h]) => ctx.rect(x, y, w, h)); };

  // the street seen through the window: hearse procession, umbrellas, the lamplighter putting out lamps
  function drawStreet(ctx) {
    B.plate(ctx, 'street');
    const sy = 862;
    SLAMPS.forEach(([x, y], i) => { const on = hs.street[i]; if (on > .01) { ctx.fillStyle = rgba([255, 214, 150], .95 * on); ctx.fillRect(x - 3.4, y - 8.5, 6.8, 7.5); B.glow(ctx, x, y - 5, 46, [255, 190, 110], .55 * on); B.glow(ctx, x, y - 5, 10, [255, 235, 190], .8 * on); B.pool(ctx, x, sy + 4, 46, 5, [255, 190, 120], .5 * on); } });
    if (hs.proc.on) {
      const x = hs.proc.x, q = 1.35;
      hearseSil(ctx, x, sy + 3, q);
      for (let i = 0; i < 5; i++) {
        const mx = x + 40 + i * 15 + Math.sin(WD.t * 1.3 + i) * 1.2, my = sy + 3, bob = Math.sin(WD.t * 2.2 + i * 1.7) * .6;
        ctx.fillStyle = '#05060a'; ctx.beginPath(); ctx.moveTo(mx - 3, my); ctx.lineTo(mx - 2.4, my - 14 + bob); ctx.lineTo(mx + 2.4, my - 14 + bob); ctx.lineTo(mx + 3.4, my); ctx.fill();
        ctx.beginPath(); ctx.arc(mx, my - 16 + bob, 1.8, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.ellipse(mx, my - 19 + bob, 7, 4.2, 0, Math.PI, 0); ctx.fill(); ctx.fillRect(mx - .3, my - 19 + bob, .6, 4);
        ctx.fillStyle = 'rgba(150,170,210,.25)'; ctx.fillRect(mx - 7, my - 19.2 + bob, 14, .6);
      }
    }
    if (hs.lamp.on) {
      const l = hs.lamp, tip = [lerp(20, 30, l.pole), lerp(52, 86, l.pole)];
      inFig(ctx, l.x, sy + 3, 46, 1, f => { f.fillStyle = '#04050a'; extinguisher(f, { tip, sway: Math.sin(WD.t * 2) * .6 }); });
    }
  }
  // the house across the street, seen through the round window over the stairs
  function drawAcross(ctx) {
    ctx.save(); ctx.beginPath(); ctx.arc(2250, 640, 29, 0, 7); ctx.clip();
    vgrad(ctx, 2220, 610, 60, 60, [[0, '#0b1222'], [1, '#141b2a']]);
    ctx.fillStyle = '#090c14'; ctx.fillRect(2222, 618, 62, 60); poly(ctx, [[2220, 618], [2253, 600], [2286, 618]], '#090c14');
    ctx.fillStyle = 'rgba(30,38,56,.8)'; ctx.fillRect(2228, 628, 9, 14); ctx.fillRect(2268, 628, 9, 14);
    const a = hs.across;
    ctx.fillStyle = rgba(mixc([30, 38, 56], [255, 190, 110], a), .9); ctx.fillRect(2244, 627, 18, 26);
    if (a > .05) {
      ctx.fillStyle = rgba([16, 10, 6], a); ctx.fillRect(2250, 646, 12, 4); ctx.fillRect(2251, 642, 11, 3);         // bed with a figure under the sheet
      ctx.beginPath(); ctx.ellipse(2248, 640, 1.5, 1.8, 0, 0, 7); ctx.fill(); ctx.fillRect(2246.5, 641.6, 3, 5); ctx.fillRect(2248, 645, 3.5, 1.6); // woman at the bedside
      B.glow(ctx, 2253, 638, 22, [255, 180, 100], .35 * a);
    }
    rain(ctx, 40, [2220, 610, 60, 60], 3 + Math.floor(WD.t * 12) % 7, { len: 6, a: .25, slant: -.08 });
    ctx.restore();
  }
  // faint reflection of the room in the window glass; a woman sits on the reflected chair
  function drawReflection(ctx) {
    const im = B.img.house; if (!im) return;
    ctx.save(); panesPath(ctx); ctx.clip();
    const sx = (740 - 200) * 1.5, sy = (560 - 120) * 1.5, sw = 400 * 1.5, sh = 380 * 1.5;
    ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = .26; ctx.drawImage(im, sx, sy, sw, sh, 1240, 764, 120, 114);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    const mx = x => 1240 + (x - 740) * .3, my = y => 878 - (940 - y) * .3;
    B.glow(ctx, mx(1110), my(915), 26, [255, 130, 60], .16 * hs.fire);
    ctx.save(); ctx.translate(mx(975), my(940)); bentwoodChair(ctx, 0, 0, 95 * .3, 'rgba(120,110,105,.42)', .9, hs.refl.rock * Math.sin(WD.t * 5.2) * .05); ctx.restore();
    if (hs.refl.woman > .01) {
      ctx.globalAlpha = .62 * hs.refl.woman; ctx.fillStyle = '#05050a';
      inFig(ctx, mx(975) - 1, my(940) - 42 * .3 * .3, 150 * .3, 1, f => { f.fillStyle = '#05050a'; woman(f, 'sit'); });
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }
  function drawCrepe(ctx) {
    const c = hs.crepe, t = WD.t, x0 = 1419, x1 = 1491, y0 = 760, y1 = 924;
    const wav = (y, k) => Math.sin(t * 1.7 + y * .05 + k) * c.wave * 3 + Math.sin(t * 3.1 + y * .11) * c.wave * 1.2;
    const pts = [];
    for (let i = 0; i <= 8; i++) { const y = lerp(y0, y1, i / 8); pts.push([x1 + wav(y, 0) + (i > 3 ? 1.5 : 0), y]); }
    for (let i = 0; i <= 6; i++) { const x = lerp(x1, x0, i / 6); pts.push([x, y1 + Math.sin(t * 2.3 + x * .2) * c.wave * 2.2 + (Math.abs(x - c.hx) < 18 ? -c.lift * 30 * (1 - Math.abs(x - c.hx) / 18) : 0)]); }
    for (let i = 8; i >= 0; i--) { const y = lerp(y0, y1, i / 8); pts.push([x0 + wav(y, 2) - (i > 3 ? 1.5 : 0), y]); }
    fillSpline(ctx, pts, '#0a090d', .6);
    ctx.save(); ctx.strokeStyle = 'rgba(150,150,170,.07)'; ctx.lineWidth = 1.2;
    for (let k = 1; k < 6; k++) { const x = lerp(x0, x1, k / 6); ctx.beginPath(); ctx.moveTo(x, y0 + 6); ctx.quadraticCurveTo(x + wav(y0 + 80, k) * 2, (y0 + y1) / 2, x + wav(y1, k) * 1.5, y1 - 4); ctx.stroke(); }
    ctx.restore();
    // the mirror's glass is never seen; only a cold edge where the crepe lifts
    if (c.lift > .02) { ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = rgba([150, 170, 210], c.lift * .35); ctx.fillRect(c.hx - 14, y1 - c.lift * 26, 28, c.lift * 26); ctx.restore(); }
  }
  function drawDoor(ctx) {
    const o = hs.door;
    if (o < .02) { ctx.fillStyle = '#0d0b0a'; ctx.fillRect(1558, 720, 24, 220); ctx.fillStyle = 'rgba(200,170,120,.06)'; ctx.fillRect(1558, 720, 2, 220); return; }
    const w = 112 * Math.sin(o * Math.PI / 2), sk = 12 * Math.sin(o * Math.PI / 2);
    ctx.fillStyle = 'rgba(255,190,120,.05)'; ctx.fillRect(1560, 720, 20, 220);
    poly(ctx, [[1580, 720], [1580 + w, 720 + sk], [1580 + w, 940 - sk * .3], [1580, 940]], '#0e0c0b');
    ctx.strokeStyle = 'rgba(200,170,120,.08)'; ctx.lineWidth = 1.5; ctx.strokeRect(1580 + w * .15, 740, w * .7, 80); ctx.strokeRect(1580 + w * .15, 840, w * .7, 80);
    ctx.fillStyle = '#6b5530'; ctx.beginPath(); ctx.arc(1580 + w * .86, 830, 2.5, 0, 7); ctx.fill();
  }
  function drawMaid(ctx) {
    const m = hs.maid; if (!m.on || m.a <= .01) return;
    const h = 168 * m.s, bob = Math.sin(m.walk * Math.PI * 2) * 1.2, sway = Math.sin(m.walk * Math.PI) * .02;
    B.figure(ctx, [m.x - 60, m.y - h - 20, m.x + 70, m.y + 10], x => { x.save(); x.translate(m.x, m.y + bob * .2); x.rotate(sway); inFig(x, 0, 0, h, m.f, f => { f.fillStyle = '#fff'; woman(f, 'maid'); }); x.restore(); },
      { body: [10, 9, 12], rim: [[255, 196, 130], .7, 1.3, [m.f, -.4]], alpha: m.a });
    // tray, cups, candle
    const u = h / 100, tx = m.x + m.f * 10 * u, ty = m.y - 61 * u + bob;
    ctx.save(); ctx.globalAlpha = m.a; ctx.fillStyle = '#4a3a26'; ctx.fillRect(tx - (m.f > 0 ? 22 : 42) * u * .55, ty - 2, 64 * u * .55, 3);
    ctx.fillStyle = '#d8d2c4';
    [-12, 6].forEach((dx, i) => { if (m.cups === 1 && i === 1) return; const cx = tx + m.f * dx * u * .5; ctx.fillRect(cx - 3, ty - 7, 6, 6); ctx.beginPath(); ctx.ellipse(cx, ty - 1, 5, 1.2, 0, 0, 7); ctx.fill(); });
    const cxn = tx + m.f * 26 * u * .5; ctx.fillStyle = '#e8dcc0'; ctx.fillRect(cxn - 1.5, ty - 13, 3, 11);
    ctx.fillStyle = 'rgba(255,214,140,.95)'; ctx.beginPath(); ctx.ellipse(cxn, ty - 16 + Math.sin(WD.t * 9) * .4, 2, 3.6, 0, 0, 7); ctx.fill(); ctx.restore();
    B.glow(ctx, cxn, ty - 16, 120, [255, 180, 100], .3 * m.a); B.glow(ctx, cxn, ty - 16, 18, [255, 230, 170], .6 * m.a);
    WD.maidLight = [cxn, ty - 16, m.a];
  }
  function drawTrunk(ctx) {
    const t = hs.trunk; ctx.save(); ctx.translate(t.x0, t.y1); ctx.scale(86 / 220, 48 / 123); trunk(ctx, 0, 0, 220, 123); ctx.restore();
  }
  function drawSideTable(ctx) {
    ctx.fillStyle = '#0b0907'; ctx.fillRect(1626, 878, 46, 5); ctx.fillRect(1630, 883, 3, 57); ctx.fillRect(1665, 883, 3, 57);
    if (hs.sideCup) { ctx.fillStyle = '#d8d2c4'; ctx.fillRect(1644, 871, 7, 7); ctx.beginPath(); ctx.ellipse(1647.5, 878, 6, 1.4, 0, 0, 7); ctx.fill(); if (WD.t % 3 < 2) B.glow(ctx, 1648, 864, 6, [200, 200, 210], .08); }
  }
  // background props drawn right after the house plate
  function houseProps(ctx, dt) {
    const t = WD.t, fl = .82 + .18 * B.vnoise(t * 7) + .06 * Math.sin(t * 23);
    // fire
    B.glow(ctx, 1110, 915, 240, [255, 110, 45], .22 * fl * hs.fire); B.glow(ctx, 1110, 925, 60, [255, 170, 80], .35 * fl * hs.fire);
    if (Math.random() < dt * 2.2 * hs.fire) WD.emit({ x: 1085 + Math.random() * 50, y: 928, vx: (Math.random() - .5) * 10, vy: -20 - Math.random() * 25, life: 1.6 + Math.random(), size: .9, col: [255, 140, 60], a: .8, wob: 6 });
    clockFace(ctx, 1112, 796, 11, 17, 42);
    // chair at the bed with the shawl
    const ch = hs.chair, ang = ch.rock * Math.sin(t * 5.2) * .05;
    ctx.save(); ctx.translate(ch.x, 940); bentwoodChair(ctx, 0, 0, 95, '#07070b', 3.2, ang); ctx.restore();
    ctx.save(); ctx.translate(ch.x, 940); ctx.rotate(ang); fillSpline(ctx, [[-17, -92], [-6, -98], [-1, -86], [-2, -62], [-6, -46], [-14, -40], [-18, -56]], '#06060a', .8); ctx.restore();
    drawDoor(ctx);
    drawCrepe(ctx);
    // moon shaft and dust
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    const g = ctx.createLinearGradient(1300, 645, 1180, 940); g.addColorStop(0, 'rgba(150,175,230,.13)'); g.addColorStop(1, 'rgba(150,175,230,.025)');
    ctx.fillStyle = g; poly(ctx, [[1240, 645], [1360, 645], [1300, 940], [1050, 940]]); ctx.fill(); ctx.restore();
    for (const d of hs.dust) {
      d.p += dt * .15; const x = d.x + Math.sin(d.p * 1.7) * 14, y = d.y + Math.sin(d.p) * 18;
      const fy = (y - 645) / 295, xl = lerp(1240, 1050, fy), xr = lerp(1360, 1300, fy);
      if (x > xl && x < xr) B.glow(ctx, x, y, d.s * 2.2, [210, 225, 255], .55 * (1 - Math.abs((x - xl) / (xr - xl) - .5) * 1.6));
    }
    drawDrops(ctx, dt);
    drawReflection(ctx);
    // corridor sconces turned down to blue, parlour candles, the ink below
    [1665, 1860, 2060].forEach((x, i) => { const f = .8 + .2 * B.vnoise(t * 5 + i * 9); ctx.fillStyle = rgba([110, 150, 255], .8 * f); ctx.beginPath(); ctx.ellipse(x, 723, 2.2, 3.6 * f, 0, 0, 7); ctx.fill(); B.glow(ctx, x, 722, 70, [70, 110, 255], .22 * f); B.glow(ctx, x, 722, 10, [170, 200, 255], .5 * f); });
    [[985, 1149], [1290, 1149]].forEach(([x, y], i) => { const f = .75 + .25 * B.vnoise(t * 6 + i * 4); ctx.fillStyle = rgba([255, 214, 150], .95); ctx.beginPath(); ctx.ellipse(x, y + 2, 2.2, 5 * f, 0, 0, 7); ctx.fill(); B.glow(ctx, x, y, 140, [255, 170, 90], .22 * f); B.glow(ctx, x, y, 14, [255, 230, 180], .7 * f); });
    hs.rippleT -= dt; if (hs.rippleT < 0) { hs.rippleT = .6 + Math.random() * 1.3; hs.ripples.push({ x: 1620 + Math.random() * 900, t: 0 }); }
    ctx.save(); ctx.lineWidth = 1;
    for (let i = hs.ripples.length - 1; i >= 0; i--) { const r = hs.ripples[i]; r.t += dt; if (r.t > 3) { hs.ripples.splice(i, 1); continue; } const rx = 4 + r.t * 42; ctx.strokeStyle = rgba([150, 170, 215], .3 * (1 - r.t / 3)); ctx.beginPath(); ctx.ellipse(r.x, 1223, rx, rx * .1, 0, 0, 7); ctx.stroke(); }
    ctx.restore();
    drawSideTable(ctx);
    drawTrunk(ctx);
    // ladder shaft light from the roof hatch
    B.glow(ctx, 2505, 190, 160, [150, 175, 230], .16);
  }
  // blurred foreground silhouettes, baked once
  let fg = null;
  function bakeFg() {
    const mkFg = (w, h, draw, blur) => { const c = B.off(w, h), x = c.getContext('2d'); x.filter = `blur(${blur}px)`; x.fillStyle = '#020203'; draw(x); return c; };
    fg = {
      dresser: mkFg(360, 260, x => { x.fillRect(30, 60, 300, 230); x.fillRect(10, 40, 340, 26); x.fillStyle = '#0b0906'; x.beginPath(); x.arc(250, 120, 7, 0, 7); x.fill(); }, 9),
      chair: mkFg(300, 320, x => { fillSpline(x, [[40, 330], [30, 120], [60, 50], [150, 30], [240, 50], [270, 120], [260, 330]], '#020203', .9); }, 12),
      shoulder: mkFg(420, 360, x => { fillSpline(x, [[30, 380], [40, 200], [120, 120], [210, 70], [300, 60], [360, 110], [380, 380]], '#010102', .9); }, 18),
      column: mkFg(160, 900, x => { x.fillRect(40, 0, 80, 900); }, 14),
    };
  }
  function houseForeground(ctx) {
    if (!fg) bakeFg();
    const anc = [1130, 760];
    B.view(ctx, 1.4, anc);
    ctx.drawImage(fg.dresser, 600, 1125, 360, 260); ctx.drawImage(fg.chair, 1290, 1110, 300, 320); ctx.globalAlpha = .9; ctx.drawImage(fg.shoulder, 1720, 1120, 420, 360); ctx.globalAlpha = 1;
    B.view(ctx);
  }
  // the next house along the street, wet brick under the rain
  function drawFacade(ctx) {
    const x0 = 2600, x1 = 3500;
    vgrad(ctx, x0, 120, x1 - x0, 1300, [[0, '#0a0c13'], [1, '#07080c']]);
    poly(ctx, [[x0 - 10, 120], [x0 + 300, -20], [x1 + 20, -20], [x1 + 20, 120]], '#07080d');
    ctx.fillStyle = 'rgba(140,150,180,.035)'; for (let y = 140; y < 1400; y += 14) ctx.fillRect(x0, y, x1 - x0, 1);
    ctx.fillStyle = '#05060a'; ctx.fillRect(x0, 110, x1 - x0, 14); ctx.fillRect(x0 + 34, 120, 9, 1300);
    [[2720, 330], [2980, 330], [2720, 760], [2980, 760], [3240, 330], [3240, 760]].forEach(([x, y], i) => {
      ctx.fillStyle = '#04050a'; ctx.fillRect(x - 6, y - 6, 112, 192);
      const lit = i === 3;
      ctx.fillStyle = lit ? 'rgba(255,186,110,.55)' : 'rgba(24,30,46,.9)'; ctx.fillRect(x, y, 100, 180);
      ctx.fillStyle = '#04050a'; ctx.fillRect(x + 48, y, 4, 180); ctx.fillRect(x, y + 70, 100, 4);
      if (lit) { B.glow(ctx, x + 50, y + 90, 220, [255, 170, 90], .22); ctx.fillStyle = 'rgba(20,12,8,.8)'; ctx.fillRect(x + 8, y + 110, 34, 70); }
      ctx.fillStyle = 'rgba(150,170,210,.12)'; ctx.fillRect(x - 8, y + 186, 116, 3);
    });
  }
  WD.houseLight = () => {
    const x = H.x, y = H.y; if (y > 960) return {};
    const win = smooth(460, 40, Math.abs(x - 1300)), fire = smooth(420, 30, Math.abs(x - 1110)) * hs.fire, cor = x > 1580 ? 1 : 0;
    const maid = WD.maidLight && WD.maidLight[2] > .05 ? smooth(260, 20, Math.abs(x - WD.maidLight[0])) * WD.maidLight[2] : 0;
    if (cor) {
      const up = y < 700 ? smooth(700, 300, y) : 0;
      return { rim: maid > .1 ? [[255, 190, 130], .5 + .4 * maid, 1.3, [Math.sign(WD.maidLight[0] - x) || 1, -.3]] : [[120, 150, 230], .35 + .3 * up, 1.2, [up > .3 ? 0 : 1, -1]], grad: [16, 18, 26] };
    }
    if (win >= fire) return { rim: [[175, 195, 240], .55 + .35 * win, 1.5, [1, -.35]], rim2: fire > .05 ? [[255, 140, 70], .45 * fire, 1.1, [Math.sign(1110 - x) || -1, -.2]] : null, grad: [18, 20, 30] };
    return { rim: [[255, 150, 80], .5 + .4 * fire, 1.4, [Math.sign(1110 - x) || -1, -.25]], rim2: win > .05 ? [[175, 195, 240], .4 * win, 1.2, [1, -.3]] : null, grad: [22, 16, 14] };
  };
  WD.renderHouse = (ctx, dt, o = {}) => {
    const t = WD.t;
    B.screen(ctx); ctx.fillStyle = '#05070c'; ctx.fillRect(0, 0, B.VW, B.VH);
    B.view(ctx, .55, [1400, 760]); B.plate(ctx, 'outside');
    if (Math.random() < dt * .04) hs.flash = 1; hs.flash = Math.max(0, hs.flash - dt * 3);
    B.view(ctx, .9, [2560, 760]); drawFacade(ctx);
    B.view(ctx);
    drawStreet(ctx); drawAcross(ctx);
    drawRain(ctx, 1);
    if (hs.flash > 0) { B.screen(ctx); ctx.fillStyle = rgba([170, 190, 235], .08 * hs.flash * (Math.sin(t * 60) > 0 ? 1 : .5)); ctx.fillRect(0, 0, B.VW, B.VH); }
    B.view(ctx);
    // fill the hatch and the attic shaft holes with night
    B.plate(ctx, 'house');
    houseProps(ctx, dt);
    drawParts(ctx, 'mid');
    drawMaid(ctx);
    if (!o.noHero) H.draw(ctx, WD.houseLight());
    if (WD.houseOverlay) WD.houseOverlay(ctx);
    drawParts(ctx, 'front');
    houseForeground(ctx);
  };
  WD.updateHouse = dt => {
    const t = WD.t;
    // chair settles
    hs.chair.rock = Math.max(0, hs.chair.rock - dt * .05);
    hs.refl.rock = Math.max(0, hs.refl.rock - dt * .08);
    // procession and lamplighter in the street
    if (hs.proc.on) hs.proc.x -= dt * 6.5;
    const l = hs.lamp;
    if (l.on) {
      const next = SLAMPS.findIndex((p, i) => hs.street[i] > .5 && p[0] > l.x - 4);
      if (next >= 0 && SLAMPS[next][0] - l.x < 11) { l.pole = Math.min(1, l.pole + dt * .9); if (l.pole >= 1) { hs.street[next] = 0; A.puff((B.w2s(SLAMPS[next][0], 0)[0] / B.VW - .5), .25); } }
      else { l.pole = Math.max(0, l.pole - dt * .8); if (l.pole < .2) l.x += dt * 4.2; }
    }
    // maid
    const m = hs.maid; if (m.on && m.pose === 'walk') m.walk += dt * .9;
    // rain ambience follows the window position
    if (A.ok) { const wx = B.w2s(1300, 760)[0]; A.rainLevel(.035 + .03 * smooth(900, 0, Math.abs(wx - B.VW / 2)), (wx / B.VW - .5) * 1.6); }
  };
  WD.houseAudio = () => ({ fire: smooth(900, 100, Math.abs(H.x - 1110)) * hs.fire * (H.y < 960 ? 1 : 0), firePan: (B.w2s(1110, 0)[0] / B.VW - .5) * 1.4, rain: .5, rainPan: (B.w2s(1300, 0)[0] / B.VW - .5) * 1.4 });

  /* ================= THE OBSERVATORY ================= */
  const LAMPS_X = [1560, 1860, 2180, 2620, 2960, 3340, 3860, 4220, 4560];
  const DOME = { cx: 3000, cy: 160, rx: 1720, ry: 1440 };
  const dPt = (k, v) => [DOME.cx + DOME.rx * k * Math.sqrt(Math.max(0, 1 - v * v)), DOME.cy - DOME.ry * v];
  const os = WD.obs = {
    slit: 0, crank: 0, crankAng: 0, lever: 0, beam: 0, aligned: false, hatch: 0,
    tube: { px: 3700, py: -150, ang: .661, r: 26, back: 150, L: 440, sMin: -108, sMax: 404, wob: 0 },
    lamps: LAMPS_X.map(x => ({ x, on: 1, flare: 0 })), ghosts: 0, ghostCrumble: 0, cracks: [], panel: 0, letters: [], lettersOn: false,
    ext: { on: false, x: 1460, y: 160, depth: 0, pole: 0, flare: 0, walk: 0, a: 0, target: null }, wash: { on: false, x: 1250 },
    star: [4330, -610], dust: [],
  };
  WD.LAMPS_X = LAMPS_X;
  WD.obsGeo = () => {
    B.geo = {
      solids: [
        { x0: 1250, x1: 4750, y0: 160, y1: 220 }, { x0: 1240, x1: 1300, y0: -600, y1: 160, noMantle: true }, { x0: 4660, x1: 4760, y0: -600, y1: 160, noMantle: true },
        { x0: 3420, x1: 3460, y0: 130, y1: 160 }, { x0: 3460, x1: 3640, y0: 100, y1: 160 }, { x0: 3990, x1: 4080, y0: 120, y1: 160 },
      ],
      ramps: [], ladders: [], bounds: [1330, 4630],
    };
    for (let i = 0; i < 90; i++) os.dust.push({ x: 3600 + Math.random() * 900, y: -900 + Math.random() * 1000, p: Math.random() * 10, s: .7 + Math.random() * 1.5 });
  };
  const tubeEnds = T => { const c = Math.cos(T.ang), s = Math.sin(T.ang); return { E: [T.px - c * T.back, T.py - s * T.back], O: [T.px + c * T.L, T.py + s * T.L] }; };
  WD.tubeEnds = tubeEnds;
  function drawTube(ctx) {
    const T = os.tube, r0 = 18, r1 = 26, back = T.back, L = T.L;
    ctx.save(); ctx.translate(T.px, T.py); ctx.rotate(T.ang + Math.sin(WD.t * 9) * T.wob * .01);
    // counterweight arm under the mount
    ctx.fillStyle = '#0b0b0e'; ctx.fillRect(-9, r0 * .6, 18, 64); ctx.beginPath(); ctx.arc(0, r0 * .6 + 74 + Math.sin(WD.t * 1.3) * os.tube.wob * 3, 20, 0, 7); ctx.fill();
    const g = ctx.createLinearGradient(0, -r1, 0, r1);
    g.addColorStop(0, '#3a4660'); g.addColorStop(.07, '#1a1a20'); g.addColorStop(.3, '#211b13'); g.addColorStop(.42, '#3a2c1a'); g.addColorStop(.55, '#1c1610'); g.addColorStop(.84, '#2a1c0e'); g.addColorStop(.93, '#b07a3c'); g.addColorStop(1, '#3a220c');
    poly(ctx, [[-back, -r0], [L, -r1], [L, r1], [-back, r0]], g);
    [[-back + 20, 1.08], [L * .22, 1.12], [L * .55, 1.12], [L * .82, 1.1]].forEach(([x, k]) => { const rr = lerp(r0, r1, (x + back) / (L + back)) * k; const gg = ctx.createLinearGradient(0, -rr, 0, rr); gg.addColorStop(0, '#5a6a88'); gg.addColorStop(.12, '#3a3020'); gg.addColorStop(.5, '#4a3418'); gg.addColorStop(.88, '#d7a35a'); gg.addColorStop(1, '#4a2a0e'); ctx.fillStyle = gg; ctx.fillRect(x, -rr, 10, rr * 2); });
    ctx.fillStyle = '#100c08'; ctx.fillRect(L - 4, -r1 * 1.16, 56, r1 * 2.32); ctx.fillStyle = 'rgba(160,180,220,.45)'; ctx.fillRect(L - 4, -r1 * 1.16, 56, 2.5); ctx.fillStyle = 'rgba(220,160,90,.5)'; ctx.fillRect(L - 4, r1 * 1.16 - 3, 56, 3);
    ctx.fillStyle = '#0d0a07'; ctx.fillRect(L * .45, -r1 - 22, L * .32, 9); ctx.fillStyle = 'rgba(230,200,140,.35)'; ctx.fillRect(L * .45, -r1 - 22, L * .32, 2);
    // eyepiece
    ctx.fillStyle = '#0a0806'; ctx.fillRect(-back - 36, -r0 * .5, 36, r0); ctx.fillStyle = '#8a6a3a'; ctx.fillRect(-back - 42, -r0 * .62, 7, r0 * 1.24);
    ctx.fillStyle = '#0b0b0e'; ctx.beginPath(); ctx.arc(0, 0, 13, 0, 7); ctx.fill(); ctx.fillStyle = 'rgba(200,160,100,.4)'; ctx.beginPath(); ctx.arc(-2, -2, 4, 0, 7); ctx.fill();
    if (os.beam > .01) { // light pouring through the lenses
      const a = os.beam; B.glow(ctx, -back - 42, 0, 60 + 30 * a, [200, 220, 255], .5 * a); B.glow(ctx, L + 50, 0, 90, [210, 225, 255], .45 * a);
      ctx.globalCompositeOperation = 'screen'; const lg = ctx.createLinearGradient(L, 0, -back, 0); lg.addColorStop(0, rgba([190, 210, 255], .35 * a)); lg.addColorStop(1, rgba([190, 210, 255], .08 * a)); ctx.fillStyle = lg; ctx.fillRect(-back, -3, L + back, 6); ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
  }
  function drawLamp(ctx, l) {
    const x = l.x, y = -24, on = l.on;
    ctx.fillStyle = on > .02 ? rgba(mixc([60, 45, 30], [255, 226, 170], on), .95) : '#14151b'; ctx.beginPath(); ctx.ellipse(x, y, 8, 13, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y - 13); ctx.lineTo(x, y + 13); ctx.stroke();
    if (on > .02) { const f = .9 + .1 * B.vnoise(WD.t * 6 + x); B.glow(ctx, x, y, 80, [255, 205, 140], .5 * on * f); B.glow(ctx, x, y, 300, [255, 170, 90], .14 * on * f); B.pool(ctx, x, 165, 150, 14, [255, 190, 120], .3 * on); }
    if (l.flare > .01) B.glow(ctx, x, y, 40, [255, 255, 255], l.flare);
  }
  function drawCrank(ctx) {
    const cx = 2750, cy = 40, a = os.crankAng;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(a); ctx.strokeStyle = '#0a0a0e'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, 0, 30, 0, 7); ctx.stroke();
    for (let i = 0; i < 6; i++) { ctx.rotate(Math.PI / 3); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(30, 0); ctx.stroke(); }
    ctx.fillStyle = '#0a0a0e'; ctx.fillRect(28, -3, 16, 6); ctx.fillStyle = 'rgba(220,180,120,.35)'; ctx.fillRect(28, -3, 16, 1.5); ctx.restore();
    ctx.fillStyle = 'rgba(220,180,120,.3)'; ctx.beginPath(); ctx.arc(cx, cy, 4, 0, 7); ctx.fill();
  }
  WD.crankHandle = () => { const a = os.crankAng; return [2750 + Math.cos(a) * 38, 40 + Math.sin(a) * 38]; };
  const leverAng = () => lerp(-1.25, -.2, os.lever);
  WD.leverHandle = () => { const a = leverAng(); return [3050 + Math.cos(a) * 112, 118 + Math.sin(a) * 112]; };
  function drawLever(ctx) {
    const a = leverAng(), hx = 3050 + Math.cos(a) * 112, hy = 118 + Math.sin(a) * 112, bx = 3050 - Math.cos(a) * 26, by = 118 - Math.sin(a) * 26;
    ctx.strokeStyle = '#0a0a0e'; ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(hx, hy); ctx.stroke();
    ctx.strokeStyle = 'rgba(220,180,120,.3)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(bx, by - 2); ctx.lineTo(hx, hy - 2); ctx.stroke();
    ctx.fillStyle = '#0d0b08'; ctx.beginPath(); ctx.ellipse(hx, hy, 6, 6, 0, 0, 7); ctx.fill();
    // cable over a pulley to the telescope's counterweight
    const { E } = tubeEnds(os.tube);
    ctx.strokeStyle = 'rgba(10,10,14,.9)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(3330, -420); ctx.lineTo(E[0] + 20, E[1] + 30); ctx.stroke();
    ctx.fillStyle = '#0a0a0e'; ctx.beginPath(); ctx.arc(3330, -420, 10, 0, 7); ctx.fill();
  }
  function drawSlit(ctx) {
    // closed shutter plates over the slit band, opening upward
    const open = os.slit, vLo = .14 + .62 * open, vHi = .76;
    if (vLo < vHi - .005) {
      const pts = []; for (let v = vLo; v <= vHi + 1e-4; v += .02) pts.push(dPt(.8, Math.min(v, vHi)));
      for (let v = vHi; v >= vLo - 1e-4; v -= .02) pts.push(dPt(.9, Math.max(v, vLo)));
      poly(ctx, pts, '#07080d');
      ctx.strokeStyle = 'rgba(150,170,215,.18)'; ctx.lineWidth = 1.5; for (let v = vLo + .03; v < vHi; v += .06) { const a = dPt(.8, v), b = dPt(.9, v); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
      const e = dPt(.85, vLo); ctx.fillStyle = 'rgba(200,170,120,.25)'; ctx.fillRect(e[0] - 60, e[1] - 2, 120, 3);
    }
    if (open > .02) { // clean sky through the open slit
      const vTop = Math.min(vHi, vLo); const pts = []; for (let v = .14; v <= vTop + 1e-4; v += .02) pts.push(dPt(.8, Math.min(v, vTop))); for (let v = vTop; v >= .14 - 1e-4; v -= .02) pts.push(dPt(.9, Math.max(v, .14)));
      ctx.save(); poly(ctx, pts); ctx.clip(); ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = 'rgba(60,80,130,.25)'; ctx.fillRect(3600, -1000, 1000, 1200); ctx.restore();
    }
  }
  function drawGuideStar(ctx) {
    const a = smooth(.3, 1, os.slit); if (a <= 0) return; const [x, y] = os.star, tw = .8 + .2 * Math.sin(WD.t * 3.3);
    B.glow(ctx, x, y, 90, [200, 215, 255], .35 * a * tw); B.glow(ctx, x, y, 16, [255, 255, 255], .9 * a);
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = rgba([220, 230, 255], .4 * a * tw); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x - 60, y); ctx.lineTo(x + 60, y); ctx.moveTo(x, y - 60); ctx.lineTo(x, y + 60); ctx.stroke(); ctx.restore();
  }
  function drawBeam(ctx) {
    if (os.beam < .01) return; const { O } = tubeEnds(os.tube), [sx, sy] = os.star, a = os.beam;
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    const g = ctx.createLinearGradient(sx, sy, O[0], O[1]); g.addColorStop(0, rgba([200, 215, 255], .05 * a)); g.addColorStop(1, rgba([200, 215, 255], .3 * a));
    ctx.fillStyle = g; poly(ctx, [[sx - 26, sy], [sx + 26, sy], [O[0] + 30, O[1]], [O[0] - 30, O[1]]]); ctx.fill(); ctx.restore();
    for (const d of os.dust) { d.p += .004; const t = B.frac(d.p), x = lerp(sx, O[0], t) + Math.sin(d.p * 40) * 18, y = lerp(sy, O[1], t); B.glow(ctx, x, y, d.s * 2.4, [220, 230, 255], .5 * a); }
  }
  function drawGhosts(ctx) {
    if (os.ghosts <= .01) return; const a = os.ghosts, cr = os.ghostCrumble, x = 2960, y = -20, s = .62;
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    const col = [190, 205, 240];
    const paint = (fn) => { const c = B.off(10, 10); return c; };
    ctx.globalAlpha = a * (1 - cr) * .55;
    // a ghost telescope and the two of them: he points up, she bends to the eyepiece
    ctx.save(); ctx.translate(x + 40, y - 120 * s); ctx.rotate(-.55); ctx.fillStyle = rgba(col, .35); ctx.fillRect(-60 * s, -9 * s, 300 * s, 18 * s); ctx.restore();
    ctx.fillStyle = rgba(col, .25); poly(ctx, [[x + 30, y], [x + 50, y], [x + 46, y - 120 * s], [x + 34, y - 120 * s]]); ctx.fill();
    ctx.fillStyle = rgba(col, .8);
    inFig(ctx, x - 70, y, 180 * s, 1, f => { f.fillStyle = rgba(col, .8); man(f, Object.assign({}, POSE.reach, { haN: [24, 92], elN: [14, 84] })); });
    ctx.save(); ctx.translate(x - 10, y); ctx.rotate(.32); inFig(ctx, 0, 0, 165 * s, 1, f => { f.fillStyle = rgba(col, .8); woman(f, 'widow'); }); ctx.restore();
    ctx.restore();
    B.glow(ctx, x - 20, y - 60, 160, [170, 190, 240], .18 * a * (1 - cr));
  }
  function drawCracks(ctx) {
    if (!os.cracks.length) return; ctx.save(); ctx.lineCap = 'round';
    for (const c of os.cracks) {
      const k = Math.min(1, c.t / .25); ctx.strokeStyle = rgba([200, 215, 245], .35 * c.a); ctx.lineWidth = 1.2;
      for (const br of c.br) { ctx.beginPath(); br.forEach((p, i) => { if (i / br.length > k) return; i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); }); ctx.stroke(); }
    }
    ctx.restore();
  }
  WD.crackAt = (x, y, seed) => {
    const r = rng(seed), br = [];
    for (let i = 0; i < 9; i++) { const a = r() * 6.28; let px = x, py = y; const pts = [[px, py]]; for (let j = 0; j < 6; j++) { px += Math.cos(a + (r() - .5) * .8) * (14 + r() * 26); py += Math.sin(a + (r() - .5) * .8) * (14 + r() * 26); pts.push([px, py]); } br.push(pts); }
    os.cracks.push({ x, y, br, t: 0, a: 1 });
  };
  function drawExtinguisher(ctx) {
    const e = os.ext; if (!e.on || e.a <= .01) return;
    const h = 250, bob = Math.sin(e.walk * Math.PI * 2) * 1.6, sway = Math.sin(e.walk * Math.PI * 2) * .9;
    const tip = e.target ? e.target : [62, 44];
    B.figure(ctx, [e.x - 120, e.y - h - 30, e.x + 200, e.y + 10], x => inFig(x, e.x, e.y + bob * .3, h, 1, f => { f.fillStyle = '#fff'; extinguisher(f, { tip, sway, brass: '#fff' }); }),
      { body: [4, 4, 7], grad: [14, 14, 20], rim: [[255, 200, 140], .45 + .45 * WD.lightNear(e.x), 1.8, [1, -.2]], rim2: [[140, 160, 220], .55, 1.4, [-1, -.4]], alpha: e.a });
    // pole in brass, then the frosted-glass face with the wick inside
    ctx.save(); ctx.globalAlpha = e.a; const u = h / 100;
    const P = ([lx, ly]) => [e.x + lx * u, e.y + bob * .3 - ly * u];
    const [ax, ay] = P([14, 67]), [bx, by] = P(tip);
    ctx.strokeStyle = '#6b5330'; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    ctx.strokeStyle = 'rgba(230,190,120,.5)'; ctx.lineWidth = .8; ctx.beginPath(); ctx.moveTo(ax, ay - 1); ctx.lineTo(bx, by - 1); ctx.stroke();
    const [fx, fy] = P([0, 82]);
    ctx.fillStyle = 'rgba(150,150,160,.55)'; ctx.beginPath(); ctx.ellipse(fx, fy, 5.4 * u * .55, 7 * u * .55, 0, 0, 7); ctx.fill();
    ctx.restore();
    B.glow(ctx, fx, fy, 30 + 60 * e.flare, [255, 200, 130], (.35 + .6 * e.flare) * e.a); B.glow(ctx, fx, fy + 2, 6, [255, 240, 200], .9 * e.a);
    WD.extHead = [fx, fy];
  }
  WD.lightNear = x => { let a = 0; for (const l of os.lamps) a = Math.max(a, l.on * smooth(420, 40, Math.abs(l.x - x))); return a; };
  // glass panel in the foreground where the stars write their message
  WD.panelRect = [2700, -640, 3740, -60];
  WD.panelAnchor = [3220, -330];
  function drawPanel(ctx) {
    if (os.panel <= .01) return;
    const a = os.panel, [x0, y0, x1, y1] = WD.panelRect;
    B.view(ctx, 1.5, WD.panelAnchor);
    ctx.save(); ctx.globalAlpha = a;
    // a pane of the dome, very close to us: dirty glass between two ribs
    ctx.fillStyle = 'rgba(70,90,130,.06)'; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    const g = ctx.createLinearGradient(x0, y0, x1, y1); g.addColorStop(.25, 'rgba(200,215,255,0)'); g.addColorStop(.45, 'rgba(200,215,255,.07)'); g.addColorStop(.6, 'rgba(200,215,255,0)'); ctx.fillStyle = g; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    for (let i = 0; i < 40; i++) { const r = B.hash(i * 3.1), q = B.hash(i * 7.7); ctx.fillStyle = 'rgba(180,200,230,.035)'; ctx.beginPath(); ctx.ellipse(x0 + 30 + r * (x1 - x0 - 60), y0 + 30 + q * (y1 - y0 - 60), 4 + r * 10, 3 + q * 7, r, 0, 7); ctx.fill(); }
    ctx.fillStyle = '#020305';
    ctx.fillRect(x0 - 40, y0 - 2000, 44, 4400); ctx.fillRect(x1 - 4, y0 - 2000, 44, 4400);
    ctx.fillRect(x0, y0 - 9, x1 - x0, 18); ctx.fillRect(x0, y1 - 9, x1 - x0, 18);
    ctx.fillStyle = 'rgba(150,170,215,.16)'; ctx.fillRect(x0 + 1, y0 - 2000, 2, 4400); ctx.fillRect(x1 + 37, y0 - 2000, 2, 4400);
    [[x0 - 18, y0], [x1 + 18, y0], [x0 - 18, y1], [x1 + 18, y1]].forEach(([x, y]) => { ctx.fillStyle = '#020305'; ctx.beginPath(); ctx.arc(x, y, 22, 0, 7); ctx.fill(); ctx.fillStyle = 'rgba(170,190,230,.3)'; ctx.beginPath(); ctx.arc(x - 5, y - 5, 4, 0, 7); ctx.fill(); });
    ctx.restore();
    // the star letters live on that pane, with a faint underglow of the word so it stays legible
    if (os.letterGlow && os.glowA > .01) { ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = os.glowA * a * .5; ctx.drawImage(os.letterGlow, x0, y0, x1 - x0, y1 - y0); ctx.restore(); }
    for (const s of os.letters) {
      const tw = .75 + .25 * Math.sin(WD.t * 4 + s.ph * 9);
      B.glow(ctx, s.x, s.y, s.size * (s.big ? 6 : 3.2), s.col, s.a * a * tw);
      if (s.big && s.a > .3) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = rgba([225, 235, 255], .35 * s.a * a); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(s.x - 18, s.y); ctx.lineTo(s.x + 18, s.y); ctx.moveTo(s.x, s.y - 18); ctx.lineTo(s.x, s.y + 18); ctx.stroke(); ctx.restore(); }
    }
    B.view(ctx);
  }
  // sample "НЕ УХОДИ" into target points in panel space
  WD.buildLetters = () => {
    const [x0, y0, x1, y1] = WD.panelRect, w = x1 - x0, h = y1 - y0, c = B.off(w, h), x = c.getContext('2d');
    x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle';
    let fs = Math.round(h * .5); x.font = `700 ${fs}px ${B.F.sc}`; const tw = x.measureText('НЕ УХОДИ').width; if (tw > w * .9) { fs = Math.floor(fs * w * .9 / tw); x.font = `700 ${fs}px ${B.F.sc}`; }
    x.fillText('НЕ УХОДИ', w / 2, h / 2 + fs * .06);
    const d = x.getImageData(0, 0, w, h).data, pts = [], step = 6;
    for (let yy = 0; yy < h; yy += step) for (let xx = 0; xx < w; xx += step) if (d[(yy * w + xx) * 4 + 3] > 120) pts.push([x0 + xx + (Math.random() - .5) * 4, y0 + yy + (Math.random() - .5) * 4]);
    os.letters = pts.map(p => ({ x: x0 + Math.random() * w, y: y0 + Math.random() * h, tx: p[0], ty: p[1], a: .2 + Math.random() * .3, size: .8 + Math.pow(Math.random(), 6) * 3, big: Math.random() < .03, ph: Math.random(), col: Math.random() < .15 ? [255, 226, 190] : [215, 228, 255], speed: .6 + Math.random() * .8 }));
    const gc = B.off(w, h), gx = gc.getContext('2d'); gx.filter = 'blur(16px)'; gx.fillStyle = 'rgba(170,190,240,1)'; gx.textAlign = 'center'; gx.textBaseline = 'middle'; gx.font = x.font; gx.fillText('НЕ УХОДИ', w / 2, h / 2 + fs * .06);
    os.letterGlow = gc; os.glowA = 0;
  };
  WD.updateLetters = (dt, gather, fall) => {
    for (const s of os.letters) {
      if (fall) { os.glowA = Math.max(0, (os.glowA || 0) - dt * .4); s.vy = (s.vy || 0) + 260 * dt; s.y += s.vy * dt; s.x += Math.sin(s.ph * 20) * 20 * dt; s.a = Math.max(0, s.a - dt * .35); continue; }
      if (gather) { const k = 1 - Math.exp(-s.speed * dt * gather); s.x += (s.tx - s.x) * k; s.y += (s.ty - s.y) * k; s.a = Math.min(1, s.a + dt * .3); }
    }
  };
  WD.obsLight = () => {
    const x = H.x, near = WD.lightNear(x), beam = os.beam * smooth(500, 60, Math.abs(x - 3580));
    let best = null, bd = 1e9; for (const l of os.lamps) if (l.on > .3 && Math.abs(l.x - x) < bd) { bd = Math.abs(l.x - x); best = l; }
    const dir = best ? [Math.sign(best.x - x) || 1, -.5] : [1, -.4];
    return { rim: [[255, 196, 130], .25 + .6 * near, 1.4, dir], rim2: beam > .02 ? [[200, 215, 255], .7 * beam, 1.2, [-.2, -1]] : [[140, 160, 220], .25, 1.1, [-dir[0], -.6]], grad: [14, 14, 20] };
  };
  WD.renderObs = (ctx, dt, o = {}) => {
    B.screen(ctx); ctx.fillStyle = '#03050b'; ctx.fillRect(0, 0, B.VW, B.VH);
    B.view(ctx, .45, [3000, -300]); B.plate(ctx, 'obs_sky');
    // twinkle a few bright stars over the plate
    for (let i = 0; i < 40; i++) { const x = 1300 + B.hash(i) * 3400, y = -1300 + B.hash(i + 50) * 1200, a = .3 + .3 * Math.sin(WD.t * (1 + B.hash(i + 9) * 2) + i); B.glow(ctx, x, y, 6, [215, 228, 255], a); }
    B.view(ctx);
    drawSlit(ctx); drawGuideStar(ctx);
    B.plate(ctx, 'obs_dome');
    ctx.fillStyle = '#050507'; ctx.fillRect(-2000, -2600, 3262, 4400); ctx.fillRect(4738, -2600, 3000, 4400);
    ctx.fillStyle = 'rgba(160,150,140,.03)'; for (let y = -1600; y < 1600; y += 46) { ctx.fillRect(-2000, y, 3262, 1.4); ctx.fillRect(4738, y, 3000, 1.4); }
    drawCracks(ctx);
    drawGhosts(ctx);
    // hatch hole is dark below the floor
    ctx.fillStyle = '#050506'; ctx.fillRect(2470, 160, 70, 40);
    B.plate(ctx, 'obs_mid');
    if (os.ext.on) { ctx.save(); ctx.beginPath(); ctx.moveTo(1406, 160); ctx.lineTo(1406, -36); ctx.quadraticCurveTo(1460, -100, 1514, -36); ctx.lineTo(1514, 160); ctx.clip(); const g = ctx.createRadialGradient(1460, 60, 10, 1460, 60, 160); g.addColorStop(0, 'rgba(120,135,170,.38)'); g.addColorStop(1, 'rgba(60,70,100,0)'); ctx.fillStyle = g; ctx.fillRect(1400, -110, 120, 270); ctx.restore(); }
    vgrad(ctx, 1240, 198, 3520, 1400, [[0, '#09090c'], [.15, '#060608'], [1, '#020203']]);
    ctx.fillStyle = 'rgba(160,150,140,.035)'; for (let y = 230; y < 1500; y += 46) ctx.fillRect(1240, y, 3520, 1.4);
    ctx.fillStyle = 'rgba(200,170,120,.08)'; ctx.fillRect(1240, 198, 3520, 1.5);
    if (os.hatch < 1) { ctx.fillStyle = '#1a140c'; ctx.save(); ctx.translate(2540, 158); ctx.rotate(-Math.PI / 2 * (1 - os.hatch)); ctx.fillRect(-70, -6, 70, 7); ctx.restore(); }
    else { ctx.fillStyle = '#1a140c'; ctx.fillRect(2470, 156, 70, 6); }
    os.lamps.forEach(l => drawLamp(ctx, l));
    drawCrank(ctx); drawLever(ctx);
    drawBeam(ctx);
    drawTube(ctx);
    drawParts(ctx, 'mid');
    drawExtinguisher(ctx);
    if (!o.noHero) H.draw(ctx, WD.obsLight());
    if (WD.obsOverlay) WD.obsOverlay(ctx);
    drawParts(ctx, 'front');
    if (os.wash.on) B.fx.wash(ctx, os.wash.x);
    drawPanel(ctx);
  };
  WD.updateObs = dt => {
    for (const c of os.cracks) c.t += dt;
    for (const l of os.lamps) l.flare = Math.max(0, l.flare - dt * 2.5);
    const e = os.ext; e.flare = Math.max(0, e.flare - dt * 1.6);
  };

  /* ================= THE THEATRE ================= */
  const th = WD.theatre = { turn: 0, push: 0, cone: 1, dust: [] };
  for (let i = 0; i < 160; i++) th.dust.push({ t: Math.random(), u: Math.random(), s: .6 + Math.random() * 1.8, p: Math.random() * 10 });
  // woman seen from behind, turning her head toward us (turn 0..1)
  function womanTurning(f, turn) {
    fillSpline(f, [[-6.6, 79.6], [-8.4, 76], [-7.4, 66], [-5, 58], [-7, 55.4], [-11.6, 34], [-15.4, 10], [-17.6, .6], [17.6, .6], [15.4, 10], [11.6, 34], [7, 55.4], [5, 58], [7.4, 66], [8.4, 76], [6.6, 79.6], [2.6, 81.2], [-2.6, 81.2]], f.fillStyle, .9);
    limb(f, [[0, 82.6], [0, 79]], [4.4, 5]);
    const r = turn * .5;
    f.beginPath(); f.ellipse(.6 + turn * 1.2, 88, 4.8, 5.8, .08 + r * .2, 0, 7); f.fill();
    f.beginPath(); f.ellipse(4.6 + turn * 2.4, 86.6 - turn * .4, 1.6 + turn * 1.6, 2.6 + turn * .6, .2 - turn * .3, 0, 7); f.fill();        // cheek turning into view
    if (turn > .55) { f.beginPath(); f.ellipse(7.6 + turn * 1.6, 87.2, .9 + (turn - .55) * 2, 1.2, 0, 0, 7); f.fill(); }                    // the tip of the nose
    f.beginPath(); f.ellipse(0, 91, 3.6, 3.2, 0, 0, 7); f.fill();
    fillSpline(f, [[-4.6, 93], [4.6 - turn, 93], [6.6 - turn * 2.2, 84], [8.2 - turn * 2.6, 70], [6, 60], [0, 58], [-6, 60], [-8.2, 70], [-6.6, 84]], f.fillStyle, .8);
    limb(f, [[-7.2, 77], [-9, 62], [-9.6, 50]], [3.8, 3.2, 2.6]); limb(f, [[7.2, 77], [9, 62], [9.6, 50]], [3.8, 3.2, 2.6]);
  }
  WD.renderTheatre = (ctx, dt) => {
    th.push += dt * .07;
    const z = 1 + Math.min(1, th.push) * .55, ox = 1005, oy = 560;
    B.screen(ctx); ctx.fillStyle = '#050403'; ctx.fillRect(0, 0, B.VW, B.VH);
    const k = B.k; ctx.setTransform(k * z, 0, 0, k * z, k * (ox - ox * z), k * (oy - oy * z));
    ctx.drawImage(B.img.theatre, 0, 0, 1920, 1080);
    for (let x = 530; x < 1420; x += 70) { const f = .8 + .2 * B.vnoise(WD.t * 5 + x); B.glow(ctx, x + 5, 700, 36, [255, 200, 130], .2 * f); }
    for (const d of th.dust) { d.p += dt * .05; const t = B.frac(d.t + d.p * .3), y = lerp(150, 700, t), xl = lerp(560, 880, t), xr = lerp(640, 1130, t), x = lerp(xl, xr, d.u) + Math.sin(d.p * 3) * 6; B.glow(ctx, x, y, d.s * 2.4, [255, 240, 210], .4 * th.cone * (1 - Math.abs(d.u - .5) * 1.4)); }
    const view = { ox: k * (ox - ox * z), oy: k * (oy - oy * z), s: k * z };
    B.figure(ctx, [930, 420, 1080, 710], x => inFig(x, 1005, 694, 250, 1, f => { f.fillStyle = '#fff'; womanTurning(f, th.turn); }),
      { view, body: [7, 6, 7], rim: [[255, 236, 200], .95, 1.6, [-1, -.75]], halo: [[255, 230, 190], .3, 8] });
    B.screen(ctx);
  };
  WD.update = dt => { WD.t += dt; updateParts(dt); if (WD.area === 'house') WD.updateHouse(dt); if (WD.area === 'obs') WD.updateObs(dt); };
})();
