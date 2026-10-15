'use strict';
// The hero: platform physics, ledge mantles, ladders, pushing, crawling along the telescope tube,
// footsteps, and choosing which procedural pose to show.
(() => {
  const B = BD, R = B.rig, A = B.audio;
  const G = 1500, JUMP_V = 470, STEP = 32, HALF = 14, TALL = 168;
  const H = B.hero = {
    x: 0, y: 0, vx: 0, vy: 0, f: 1, ground: true, mode: 'free', ctrl: false, canRun: false, canJump: true,
    ch: new R.Character({ x: 0, y: 0, f: 1 }), ph: 0, idleT: 0, hunch: .55, walkV: 100, runV: 250, autoDir: 0,
    minY: 0, land: 0, landDur: 0, mantle: null, push: null, ladder: null, tube: null, anim: null, W: null,
    alpha: 1, threads: 0, visible: true, extra: null, heavyNext: false, blocked: null, touch: null,
  };
  B.geo = { solids: [], ramps: [], ladders: [] };

  const overlapX = (s, x, pad = 10) => x + pad > s.x0 && x - pad < s.x1;
  H.groundY = (x, y) => {
    let best = Infinity;
    for (const s of B.geo.solids) if (!s.off && overlapX(s, x, 9) && s.y0 >= y - STEP - .5) best = Math.min(best, s.y0);
    for (const r of B.geo.ramps) if (!r.off && x >= r.x0 && x <= r.x1) { const ry = lerp(r.y0, r.y1, (x - r.x0) / (r.x1 - r.x0)); if (ry >= y - STEP - .5) best = Math.min(best, ry); }
    return best;
  };
  const wallHit = (nx, y) => {
    for (const s of B.geo.solids) {
      if (s.off || s.y0 >= y - STEP || s.y1 <= y - TALL) continue;
      if (nx + HALF > s.x0 && nx - HALF < s.x1) return s;
    }
    return null;
  };
  H.place = (x, y, f = H.f) => { H.x = x; H.y = y; H.f = f; H.vx = H.vy = 0; H.ground = true; H.mode = 'free'; H.mantle = H.push = H.ladder = H.tube = null; H.ch.root.x = x; H.ch.root.y = y; H.ch.root.f = f; H.ch.root.rot = 0; };

  /* ---------- free movement ---------- */
  function free(dt) {
    let dir = H.ctrl ? (B.btn('right') ? 1 : 0) - (B.btn('left') ? 1 : 0) : H.autoDir;
    const run = H.ctrl && H.canRun && B.btn('run') && H.ground;
    const vmax = run ? H.runV : H.walkV * (H.autoSpeed || 1);
    const target = dir * vmax, acc = H.ground ? (dir ? 700 : 1100) : 420;
    H.vx = H.vx < target ? Math.min(target, H.vx + acc * dt) : Math.max(target, H.vx - acc * dt);
    if (dir) H.f = dir;

    // ladder entry
    if (H.ctrl && (B.btn('up') || B.btn('down'))) {
      for (const L of B.geo.ladders) {
        if (Math.abs(H.x - L.x) < 28 && H.y <= L.bottom + 4 && H.y > L.top + 10 && (B.btn('up') || H.y < L.bottom - 4)) { startLadder(L); return; }
      }
    }
    // jump or mantle
    if (H.ground && H.ctrl && H.canJump && (B.hit('jump') || B.hit('up'))) {
      const s = (H.blocked && H.blocked.y0 < H.y - STEP) ? H.blocked : wallHit(H.x + H.f * 5, H.y);
      if (s && s.y0 < H.y - STEP && s.y0 > H.y - 125 && !s.noMantle) { startMantle(s); return; }
      if (B.hit('jump')) { H.vy = -JUMP_V; H.ground = false; H.minY = H.y; A.exhale(.035); }
    }
    // horizontal
    let nx = H.x + H.vx * dt; H.blocked = null;
    const s = wallHit(nx, H.y);
    if (s) {
      nx = H.vx > 0 ? s.x0 - HALF - .01 : H.vx < 0 ? s.x1 + HALF + .01 : H.x;
      H.blocked = s;
      if (s.push && H.ground && dir === Math.sign(s.x0 + (s.x1 - s.x0) / 2 - H.x) && s.y0 > H.y - 70) { H.x = nx; startPush(s); return; }
      if (!H.ground && H.vy > -160 && s.y0 > H.y - 178 && s.y0 < H.y - 30 && !s.noMantle) { H.x = nx; startMantle(s); return; }
      H.vx = 0;
    }
    H.x = nx;
    // vertical
    const gy = H.groundY(H.x, H.y);
    if (H.ground) {
      if (gy === Infinity || gy > H.y + 30) { H.ground = false; H.vy = 0; H.minY = H.y; }
      else H.y = gy;
    } else {
      H.vy = Math.min(H.vy + G * dt, 950); const ny = H.y + H.vy * dt; H.minY = Math.min(H.minY, ny);
      const g2 = H.groundY(H.x, H.y);
      if (H.vy >= 0 && g2 <= ny && g2 >= H.y - 3) {
        H.y = g2; H.ground = true; const fall = g2 - H.minY;
        if (fall > 150 || H.heavyNext) { H.land = H.landDur = .95; H.heavyNext = false; A.thud(1); setTimeout(A.groan, 160); B.cam.shake = .5; if (H.onHeavy) H.onHeavy(); }
        else { A.step(H.x, 1.3); A.thud(.25); }
        H.vy = 0;
      } else H.y = ny;
    }
    if (B.geo.bounds) { H.x = clamp(H.x, B.geo.bounds[0], B.geo.bounds[1]); }
  }

  /* ---------- special movement ---------- */
  function startMantle(s) {
    H.blocked = null;
    const edge = H.f > 0 ? s.x0 : s.x1;
    H.mode = 'mantle'; H.mantle = { t: 0, x0: H.x, y0: H.y, x1: edge + H.f * 18, y1: s.y0, s };
    H.vx = H.vy = 0; A.exhale(.08);
  }
  function mantle(dt) {
    const m = H.mantle; m.t += dt / .9; const k = Math.min(1, m.t);
    if (k < .5) { const u = B.ease(k / .5); H.x = lerp(m.x0, m.x0 + H.f * 4, u); H.y = lerp(m.y0, m.y1 + 70, u); }
    else { const u = B.ease((k - .5) / .5); H.x = lerp(m.x0 + H.f * 4, m.x1, u); H.y = lerp(m.y1 + 70, m.y1, u); }
    if (k >= 1) { H.mode = 'free'; H.ground = true; H.y = m.y1; H.mantle = null; A.step(H.x, 1.2); }
  }
  function startPush(s) { H.mode = 'push'; H.push = { s, t: 0, jerk: 0, moving: false, ph: 0 }; H.vx = 0; }
  function push(dt) {
    const p = H.push, s = p.s, dir = (B.btn('right') ? 1 : 0) - (B.btn('left') ? 1 : 0);
    const toward = Math.sign(s.x0 + (s.x1 - s.x0) / 2 - H.x);
    if (H.ctrl && (B.hit('jump') || B.hit('up')) && s.y0 < H.y - STEP) { H.mode = 'free'; H.push = null; startMantle(s); return; }
    if (!H.ctrl || dir !== toward) { H.mode = 'free'; H.push = null; return; }
    p.t += dt; p.ph += dt * .9;
    if (p.jerk > 0) {
      const d = Math.min(p.jerk, 95 * dt);
      const lim = s.limit != null ? (toward > 0 ? s.limit - s.x1 : s.x0 - s.limit) : 999;
      const mv = Math.min(d, Math.max(0, lim));
      s.x0 += toward * mv; s.x1 += toward * mv; p.jerk -= d; p.moving = true;
      if (lim <= 0) { p.jerk = 0; if (!s.stuckSaid) { s.stuckSaid = true; A.thud(.4); } }
    } else p.moving = false;
    if (p.t > .62) { p.t = 0; p.jerk = 20; A.scrape(1, (B.w2s(H.x, 0)[0] / B.VW - .5) * 1.4); if (s.onPush) s.onPush(); }
    H.x = toward > 0 ? s.x0 - 26 : s.x1 + 26; H.f = toward;
  }
  function startLadder(L) { H.mode = 'ladder'; H.ladder = { L, ph: 0, acc: 0 }; H.vx = H.vy = 0; H.f = 1; H.ground = false; }
  function ladder(dt) {
    const l = H.ladder, L = l.L, dir = H.ctrl ? (B.btn('down') ? 1 : 0) - (B.btn('up') ? 1 : 0) : (H.autoClimb || 0);
    H.x = B.damp(H.x, L.x - 12, 12, dt);
    const v = dir * 78; H.y += v * dt; l.ph += Math.abs(v) * dt / 52; l.acc += Math.abs(v) * dt;
    if (l.acc > 26) { l.acc = 0; A.step(H.y * 3.1, .55); }
    if (H.y >= L.bottom) { H.y = L.bottom; if (dir > 0) { H.mode = 'free'; H.ground = true; H.ladder = null; return; } }
    if (H.y <= L.top) { H.y = L.top; if (L.onTop) L.onTop(); }
    if (dir === 0) l.ph = B.damp(l.ph, Math.round(l.ph * 2) / 2, 4, dt);
  }

  /* ---------- the telescope tube ---------- */
  // tube: {px, py, ang, r, back, L}; hero position along the tube s (px from pivot toward the objective)
  H.tubePoint = (T, s, lift = 0) => { const c = Math.cos(T.ang), sn = Math.sin(T.ang), nx = sn, ny = -c; return [T.px + c * s + nx * (T.r + lift), T.py + sn * s + ny * (T.r + lift)]; };
  H.startTube = (T, s) => { H.mode = 'tube'; H.tube = { T, s, ph: 0, wob: 0 }; H.vx = H.vy = 0; H.f = -1; A.exhale(.08); };
  function tube(dt) {
    const t = H.tube, T = t.T, dir = H.ctrl ? (B.btn('right') ? 1 : 0) - (B.btn('left') ? 1 : 0) : 0;
    const v = dir < 0 ? -72 : dir > 0 ? 48 : 0;
    t.s = clamp(t.s + v * dt, T.sMin, T.sMax); t.ph += Math.abs(v) * dt / 38; t.moving = v !== 0;
    if (t.moving && B.frac(t.ph) < Math.abs(v) * dt / 38) A.stepMetal(.7);
    const p = H.tubePoint(T, t.s); H.x = p[0]; H.y = p[1]; H.f = -1;
    if (t.s >= T.sMax - .5 && dir > 0) { // climb back down onto the bookcase
      H.mode = 'free'; H.tube = null; H.ground = false; H.vy = 0; H.minY = H.y;
    }
  }

  /* ---------- update & pose selection ---------- */
  H.update = dt => {
    if (H.mode === 'script') { if (H.anim) { const a = H.anim(dt); if (a) H.ch.set(a.key, a.params, a.root, a.blend); } }
    else {
      if (H.mode === 'free') free(dt); else if (H.mode === 'mantle') mantle(dt); else if (H.mode === 'push') push(dt); else if (H.mode === 'ladder') ladder(dt); else if (H.mode === 'tube') tube(dt);
      pickPose(dt);
    }
    H.ch.vx = H.mode === 'free' ? H.vx : 0;
    H.W = H.ch.resolve(dt);
  };
  let lastPh = 0;
  function pickPose(dt) {
    const root = { x: H.x, y: H.y, f: H.f, rot: 0, s: 1 }, ch = H.ch;
    if (H.mode === 'mantle') {
      const k = Math.min(1, H.mantle.t);
      if (k < .5) ch.set('hang', { hip: [-2, 49], lean: .05, tilt: .2, anN: [1, 4], anB: [-3, 6], faB: -.4, haN: [9, 98 - k * 30], haB: [7, 97 - k * 30], flare: 1 }, root, .12);
      else ch.set('mantle2', R.land(Math.min(1, (k - .5) * 1.6)), root, .18);
      return;
    }
    if (H.mode === 'push') { ch.set('push', R.push(H.push.ph, H.push.moving), root, .25); return; }
    if (H.mode === 'ladder') { ch.set('climb', R.climb(H.ladder.ph), root, .2); return; }
    if (H.mode === 'tube') { const T = H.tube.T; root.rot = T.ang; ch.set('crawl', R.crawl(H.tube.ph, H.tube.moving), root, .3); return; }
    if (H.land > 0) { H.land -= dt; ch.set('land', R.land(1 - H.land / H.landDur), root, .08); return; }
    if (!H.ground) { ch.set('air' + (H.vy < 0 ? 'up' : 'down'), R.jump(H.vy), root, .14); return; }
    const sp = Math.abs(H.vx);
    if (sp > 160) {
      const S = 44 * R.U, rate = .36 * sp / S; H.ph += dt * rate;
      ch.set('run', R.run(H.ph), root, .2);
    } else if (sp > 8) {
      const k = clamp((sp - 60) / 100), S = lerp(34, 44, k) * R.U, rate = .6 * sp / S; H.ph += dt * rate;
      ch.set('walk', R.walk(H.ph, k, H.hunch), root, .22);
    } else { H.idleT += dt; ch.set('stand', R.stand(B.time, H.hunch), root, .3); }
    // the near hand trails along furniture (IK onto the surface)
    if (H.touch && (ch.key === 'walk' || ch.key === 'stand')) { const p = Object.assign({}, ch.params); p.haN = R.toLocal(H.touch, root); p.handA = .4; ch.params = p; }
    // footsteps at foot plants
    if (sp > 8) { const a = B.frac(lastPh), b = B.frac(H.ph); if (b < a || (a < .5 && b >= .5)) A.step(H.x + (b < a ? 0 : 23), sp > 160 ? 1.2 : .8, (B.w2s(H.x, 0)[0] / B.VW - .5) * 1.2); }
    lastPh = H.ph;
  }

  /* ---------- drawing ---------- */
  H.draw = (ctx, light) => {
    if (!H.visible || !H.W) return;
    const o = { extra: H.extra, fig: { alpha: H.alpha } };
    if (H.threads > 0) o.fig.alpha = H.alpha * (1 - H.threads * .85);
    // contact shadow
    if (H.ground && H.mode === 'free') { ctx.save(); ctx.globalAlpha = .45 * H.alpha; ctx.drawImage(B.shadowSprite(), H.x - 46, H.y - 8, 92, 16); ctx.restore(); }
    H.lastP = H.ch.draw(ctx, H.W, light, o);
    if (H.threads > 0) drawThreads(ctx);
  };
  function drawThreads(ctx) {
    const bb = R.bbox(H.W), k = H.threads, r = rng(17);
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
    for (let i = 0; i < 70; i++) {
      const x = lerp(bb[0] + 30, bb[2] - 30, r()), y = lerp(bb[1] + 20, bb[3] - 10, r()), l = 20 + r() * 70;
      const dy = -k * (80 + r() * 160), dx = Math.sin(B.time * 2 + i) * 20 * k;
      ctx.strokeStyle = rgba([200, 210, 235], (1 - k) * .5 * r()); ctx.lineWidth = .7;
      ctx.beginPath(); ctx.moveTo(x + dx * .3, y + dy * .4); ctx.quadraticCurveTo(x + dx, y + dy - l * .5, x + dx * 1.6, y + dy - l); ctx.stroke();
    }
    ctx.restore();
  }
  let shadowC = null;
  B.shadowSprite = () => {
    if (shadowC) return shadowC;
    shadowC = B.off(128, 32); const x = shadowC.getContext('2d'); x.translate(64, 16); x.scale(1, .25);
    const g = x.createRadialGradient(0, 0, 0, 0, 0, 64); g.addColorStop(0, 'rgba(0,0,0,.9)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(-64, -64, 128, 128);
    return shadowC;
  };
})();
