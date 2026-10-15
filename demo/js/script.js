'use strict';
// The director: the main loop, the beats of the 5-minute demo (docs/04_demo_5min.md), menus and the end screen.
(() => {
  const B = BD, A = B.audio, H = B.hero, R = B.rig, WD = B.world, F = B.fx;
  const hs = WD.house, os = WD.obs, th = WD.theatre;
  const D = B.dir = { logic: null, cam: null, beat: '', started: false, seen: {} };
  const $ = id => document.getElementById(id);

  /* ================= main loop ================= */
  let last = performance.now(), frameAvg = 16, slowT = 0, dissolve = null, dissolveCv = null;
  function frame(now) {
    const rdt = Math.min(.05, (now - last) / 1000); last = now;
    B.pollInput();
    if (D.started && B.rawHit('pause')) togglePause();
    const dt = B.paused ? 0 : rdt;
    if (!B.paused) {
      B.time += dt; B.tickTweens(); B.tickWaiters();
      if (D.logic) D.logic(dt);
      if (WD.area === 'house' || WD.area === 'obs' || WD.area === 'end') H.update(dt);
      WD.update(dt);
      if (D.cam) D.cam(dt);
      B.camUpdate(dt);
      if (WD.area === 'house') A.update(dt, WD.houseAudio());
      F.idleHint = B.damp(F.idleHint, H.ctrl && B.time - Math.max(B.lastInput, D.ctrlSince || 0) > 3 && !D.seen.moved ? 1 : 0, 2, dt);
    }
    render(dt);
    B.clearEdges();
    // adaptive resolution
    frameAvg = lerp(frameAvg, rdt * 1000, .05); slowT = frameAvg > 25 ? slowT + rdt : 0;
    if (slowT > 2 && B.quality > 1280) { B.quality = B.quality > 1600 ? 1600 : 1280; B.resize(); slowT = 0; }
    requestAnimationFrame(frame);
  }
  function render(dt) {
    const ctx = B.cx; ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    const a = WD.area;
    if (a === 'house') WD.renderHouse(ctx, dt);
    else if (a === 'obs') {
      if (dissolve && dissolve.a > 0) {
        WD.renderObs(ctx, dt, { noHero: true });
        if (!dissolveCv || dissolveCv.width !== B.cv.width || dissolveCv.height !== B.cv.height) dissolveCv = B.off(B.cv.width, B.cv.height);
        const dx = dissolveCv.getContext('2d'); WD.renderHouse(dx, dt, { noHero: true });
        B.screen(ctx); ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = dissolve.a; ctx.drawImage(dissolveCv, 0, 0); ctx.restore();
        B.view(ctx); H.draw(ctx, WD.houseLight());
      } else WD.renderObs(ctx, dt);
    }
    else if (a === 'theatre') WD.renderTheatre(ctx, dt);
    else if (a === 'end') renderEnd(ctx, dt);
    else { B.screen(ctx); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, B.VW, B.VH); }
    if (D.kaleido) F.kaleido(ctx, D.kaleido.p, D.kaleido.mix);
    F.post(ctx, { grain: a === 'theatre' ? .1 : .085 });
    F.drawUI(ctx);
    if (D.endUI) D.endUI(ctx);
  }

  /* ================= helpers ================= */
  const lock = () => { H.ctrl = false; B.inputLocked = true; F.prompt = null; };
  const unlock = () => { H.ctrl = true; B.inputLocked = false; D.ctrlSince = B.time; };
  const say = (t, d, o) => F.say(t, d, o);
  const showHint = (text, key, wx, wy, o = {}) => { const p = F.prompt && F.prompt.text === text ? F.prompt : { text, key, wx, wy, a: 0 }; p.wx = wx; p.wy = wy; p.hold = o.hold; p.seen = true; F.prompt = p; };
  const fadePrompt = dt => { const p = F.prompt; if (!p) return; p.a = B.damp(p.a, p.seen ? 1 : 0, 8, dt); if (p.a < .01 && !p.seen) F.prompt = null; p.seen = false; };
  // camera helpers
  const camTo = (x, y, z, rate = 2.2, zrate = 1.4) => { const c = B.cam; c.tx = x; c.ty = y; c.tz = z; c.rate = rate; c.zrate = zrate; };
  // holding "look": frame a nearby point of interest, or simply lean the camera forward
  function lookCam(pois) {
    if (!B.btn('look') || !H.ctrl) { D.lookT = 0; D.lookPoi = null; D.lookZ = null; return false; }
    D.lookT = (D.lookT || 0) + 1 / 60; if (D.lookZ == null) D.lookZ = B.cam.tz;
    let best = null, bd = 1e9;
    for (const p of pois) { if (p.when && !p.when()) continue; const d = Math.abs(H.x - p.x) + Math.abs(H.y - p.fy) * 2; if (d < p.r && d < bd) { bd = d; best = p; } }
    if (best) { camTo(best.cx, best.cy, best.z, 3, 1.8); D.lookPoi = best; if (best.onLook) best.onLook(D.lookT); }
    else camTo(H.x + H.f * 220, H.y - 120, Math.min(1.7, D.lookZ * 1.3), 1.6, 1.2);
    return true;
  }

  /* ================= the beats ================= */
  async function beatBlack() {
    D.beat = 'black'; WD.area = 'black'; F.fade = 1; lock();
    A.startRoom(); if (A.amb.room) A.amb.room.set(.02, 1);
    // tired, uneven ticking
    let ticking = true, tt = 0;
    (async () => { while (ticking) { A.tick(.7 + Math.random() * .3); await B.wait(.88 + Math.random() * .45 + (Math.random() < .2 ? .5 : 0)); } })();
    await B.wait(4);
    const ap = A.applauseRun(3, { muffled: true, g: .3, rate: 80, swell: .6 });
    await B.wait(3); ap.stop();
    await B.wait(2); ticking = false;
    await B.wait(2);
    F.epi.on = true; F.epi.write = 0; F.epi.drip = 0;
    await B.tween(F.epi, 'write', 1, 3.4, t => t);
    await B.wait(3.2);
    await B.tween(F.epi, 'drip', 1, 2.6, t => t);
    F.epi.on = false;
  }

  async function beatBedroom() {
    D.beat = 'bedroom'; WD.area = 'house'; WD.houseGeo(); lock();
    A.startRain(); A.startRoom(); if (A.amb.room) A.amb.room.set(.04, 2);
    H.mode = 'script'; H.visible = true; H.hunch = .6;
    const bedRoot = { x: 838, y: 869, f: 1, rot: 0, s: 1 };
    const bs = { k: 0, cough: 0, hand: null, hu: 0 };
    H.anim = () => ({ key: bs.hand ? 'sit-' + bs.hand : bs.k < 1 ? 'lie' : 'sit', params: bs.k < 1 ? R.lie(bs.k, Math.sin(B.time * .8)) : R.sitBed(bs), root: bedRoot, blend: .35 });
    H.ch.root = Object.assign({}, bedRoot); H.ch.lastW = null; H.update(0);
    camTo(1080, 760, 1.12); B.camSnap(); camTo(1050, 770, 1.26, .3, .08);
    D.cam = null;
    B.tween(F, 'fade', 0, 4.5, t => t);
    await B.wait(5);
    hs.chair.rock = 1; A.creak({ f: 300, f2: 340, f3: 300, dur: .8, g: .015, pan: -.3 });
    await B.wait(5);
    // 0:30 the first breath; he sits up, heavily
    A.inhale(); A.springs(1);
    await B.tween(bs, 'k', 1, 1.8, B.ease);
    await B.wait(.2);
    A.coughFit(); camTo(940, 790, 1.5, .8, .6);
    const t0 = B.time;
    while (B.time - t0 < 3.2) { const e = B.time - t0; bs.cough = [0, .42, .78, 1.25, 1.62, 1.95, 2.5].reduce((m, c) => (e > c && e - c < .25 ? 1 - (e - c) / .25 : m), 0); bs.hand = e > 1.1 ? 'mouth' : null; await B.wait(0); }
    bs.cough = 0; bs.hand = 'mouth'; await B.wait(.7);
    // the handkerchief: he looks at it; the camera sees the blood
    bs.hand = 'look'; H.extra = drawHankyInHand;
    camTo(896, 770, 2.6, 1.2, .9);
    await B.wait(2.6);
    // folded, blood inside, into the inner pocket with a practised hand
    bs.hand = 'hide'; bs.hu = 0; await B.tween(bs, 'hu', 1, 1.0, B.ease);
    H.extra = null; bs.hand = 'wipe'; bs.hu = 0; await B.tween(bs, 'hu', 1, .6, B.ease);
    bs.hand = null; camTo(1000, 770, 1.3, .9, .6);
    await B.wait(.6);
    // legs over the edge, up by the bedpost
    const floorRoot = { x: 896, y: 940, f: 1, rot: 0, s: 1 };
    H.anim = () => ({ key: 'edge', params: R.sitEdge(B.time), root: floorRoot, blend: .9 });
    A.springs(.8); await B.wait(1.6);
    const post = [927, 852];
    H.anim = () => ({ key: 'rise', params: { hip: [-7, 44], lean: .5, neck: .1, tilt: -.15, anN: [3, 3], anB: [-4, 3], haN: R.toLocal(post, floorRoot), haB: [-14, 40] }, root: floorRoot, blend: .8 });
    A.exhale(.12); await B.wait(1.0);
    H.anim = () => ({ key: 'up', params: Object.assign(R.stand(B.time, .7), { haN: R.toLocal(post, floorRoot) }), root: floorRoot, blend: .9 });
    await B.wait(1.3);
    H.place(floorRoot.x, 940, 1); H.ch.root = Object.assign({}, floorRoot); H.walkV = 86;
    unlock(); D.beat = 'room';
  }
  function drawHankyInHand(x, P, r) {
    if (!P || !P.haN) return;
    x.save(); x.translate(P.haN[0], P.haN[1]); x.scale(1, -1); x.rotate(-.3); x.scale(.11, .11); hanky(x, 0, -10, .2); x.restore();
  }

  // free roam in the bedroom, the window and the mirror
  const housePois = [
    { x: 1110, fy: 940, r: 150, cx: 1112, cy: 796, z: 4.6 },
    { x: 1290, fy: 940, r: 170, cx: 1300, cy: 820, z: 3.3, onLook: t => { if (t > .6) D.seen.street = true; } },
    { x: 2010, fy: 940, r: 160, cx: 0, cy: 872, z: 3.8, when: () => true, dyn: true },
    { x: 2260, fy: 840, r: 170, cx: 2250, cy: 640, z: 4.4, onLook: t => { if (t > 1.2 && hs.across > 0 && !hs.acrossOff) { hs.acrossOff = true; B.tween(hs, 'across', 0, .6); } } },
  ];
  function houseCam(dt) {
    const pTrunk = housePois[2]; pTrunk.x = (hs.trunk.x0 + hs.trunk.x1) / 2; pTrunk.cx = pTrunk.x;
    if (lookCam(housePois)) return;
    if (D.camOverride) return D.camOverride(dt);
    const x = H.x, y = H.y;
    if (x < 1580) {
      const atWin = D.beat === 'window' ? 1 : 0;
      camTo(clamp(x + H.f * (atWin ? 260 : 90), 980, 1330), 768, atWin ? 1.34 : 1.28, 1.6, .9);
    } else if (H.mode === 'ladder' || y < 700) camTo(2440, clamp(y - 90, 260, 760), 1.12, 2.2, 1);
    else camTo(clamp(x + H.f * 130, 1720, 2330), clamp(y - 170, 600, 770), 1.14, 1.8, 1);
  }
  function houseLogic(dt) {
    fadePrompt(dt);
    if (H.ctrl && (B.btn('left') || B.btn('right'))) D.seen.moved = true;
    // the hand finds furniture as he passes
    H.touch = null;
    if (H.mode === 'free' && H.ground && H.y > 930 && H.y < 945 && Math.abs(H.vx) < 120) {
      if (H.x > 1030 && H.x < 1190 && H.f > 0) H.touch = [H.x + 26, 813];
      else if (H.x > 900 && H.x < 960 && H.f < 0) H.touch = [H.x - 22, 852];
    }
    // POI prompts (once each)
    if (H.ctrl && !D.seen.lookPrompt && H.x > 1200 && H.x < 1380 && H.y > 900) showHint('Вглядеться', 'look', H.x, H.y - 200);
    if (B.btn('look') && H.x > 1200 && H.x < 1380) D.seen.lookPrompt = true;
  }

  async function beatWindow() {
    await B.until(() => H.x > 1160);
    D.beat = 'window';
    hs.proc.on = true; hs.proc.x = 1392; hs.lamp.on = true; hs.lamp.x = 1188;
    // the reflection: she is there while he faces the glass; after he turns away, the chair is empty and rocking
    let away = 0;
    D.reflLogic = dt => {
      const facing = H.f > 0 && H.x > 1080;
      if (!hs.refl.gone) { if (!facing && D.reflSeen > 2) { away += dt; if (away > .5) { hs.refl.gone = true; hs.refl.woman = 0; } } else away = 0; if (facing) D.reflSeen = (D.reflSeen || 0) + dt; }
      else if (facing && !hs.refl.rockSet) { hs.refl.rockSet = true; hs.refl.rock = 1; hs.chair.rock = Math.max(hs.chair.rock, .6); A.creak({ f: 300, f2: 330, f3: 290, dur: .7, g: .012, pan: -.2 }); }
    };
    await B.wait(6);
    // the music box: D–F–E–A, the last tooth bent
    D.box = true;
    (async () => {
      const seq = [74, 77, 76, 81];
      for (let r = 0; r < 6 && D.box; r++) {
        for (let i = 0; i < 4 && D.box; i++) { A.boxNote(seq[i], { cents: i === 3 ? -38 : 0, v: .9, pan: .35 }); await B.wait(i === 3 ? 2.8 : 1.05); }
      }
    })();
    await B.wait(5);
    if (H.x < 1395 && D.beat === 'window' && H.f > 0) await say('— Кого-то хоронят.', 3);
  }

  async function beatMirror() {
    await B.until(() => H.x > 1385 && H.mode === 'free');
    D.beat = 'mirror';
    hs.crepe.wave = 1;
    D.camOverride = () => camTo(1430, 800, 1.6, 1.4, .9);
    let prog = 0, phase = 'reach', hold = 0;
    const trem = () => [Math.sin(B.time * 31) * .6, Math.sin(B.time * 27) * .5];
    await new Promise(res => {
      D.mirrorLogic = dt => {
        const near = H.x > 1370 && H.x < 1520 && (H.mode === 'free' || H.mode === 'script') && H.y > 930;
        if (phase === 'reach') {
          if (near) showHint('Удерживать — снять покрывало', 'act', 1455, 745, { hold: prog });
          if (near && B.btn('act')) {
            prog = Math.min(.7, prog + dt / 3.0);
            if (H.mode !== 'script') { H.mode = 'script'; H.anim = () => ({ key: 'mirror', params: Object.assign(R.stand(B.time, .5), { haN: R.toLocal([lerp(H.x + 20, 1424, prog / .7) + (prog >= .7 ? trem()[0] : 0), lerp(860, 842, prog / .7) + (prog >= .7 ? trem()[1] : 0)], { x: H.x, y: H.y, f: 1 }), handA: .2 }), root: { x: H.x, y: H.y, f: 1, rot: 0 }, blend: .4 }); H.f = 1; }
            hs.crepe.hx = 1424; hs.crepe.lift = prog * .4;
            if (prog >= .7) { hold += dt; if (hold > .5) { phase = 'refuse'; } }
          } else if (H.mode === 'script' && prog < .7) { prog = Math.max(0, prog - dt / 1.5); hs.crepe.lift = prog * .4; if (prog <= 0) { H.mode = 'free'; } }
          else if (H.mode === 'script' && prog >= .7) { hold += dt; if (hold > .5) phase = 'refuse'; }
        } else if (phase === 'refuse') {
          // the hand stops on its own and trembles; the bar empties though the key is held
          showHint('Удерживать — снять покрывало', 'act', 1455, 760, { hold: prog });
          if (!D.whispered) { D.whispered = true; A.boxCut(); D.box = false; A.whisper('Не надо'); say('Не надо.', 2.2, { style: 'whisper', tag: 'ШЁПОТ' }); B.cam.shake = .15; }
          prog = Math.max(0, prog - dt / 2.4); hs.crepe.lift = prog * .4;
          if (prog <= 0) { phase = 'done'; F.prompt = null; res(); }
        }
      };
    });
    D.mirrorLogic = null; H.mode = 'script';
    H.anim = () => ({ key: 'still', params: R.stand(B.time, .7), root: { x: H.x, y: H.y, f: H.f, rot: 0 }, blend: .6 });
    lock(); hs.crepe.wave = .3;
    await B.wait(1.4);
    // voices through the wall, as if through water and wallpaper
    if (A.amb.rain) A.amb.rain.set(.025, 1);
    let d = A.murmur('Пульс слабый, но ровный. Продолжаем.', { f0: 104, syl: .15 });
    await say('Пульс слабый, но ровный. Продолжаем.', Math.max(2.6, d), { style: 'wall', tag: 'МУЖСКОЙ ГОЛОС · ИЗ-ЗА СТЕНЫ' });
    d = A.murmur('Он меня слышит?', { f0: 196, syl: .34, rise: true, breathy: .3, fShift: 1.15 });
    await say('Он меня слышит?', Math.max(2.4, d + .4), { style: 'wall', tag: 'ЖЕНСКИЙ ГОЛОС · ИЗ-ЗА СТЕНЫ' });
    d = A.murmur('Нет, мадам. Уже нет.', { f0: 100, syl: .17 });
    await say('Нет, мадам. Уже нет.', Math.max(2.4, d), { style: 'wall', tag: 'МУЖСКОЙ ГОЛОС · ИЗ-ЗА СТЕНЫ' });
    // he looks up toward the voices
    H.anim = () => ({ key: 'up-look', params: Object.assign(R.stand(B.time, .2), { tilt: .5, headLean: -.15, neck: -.1 }), root: { x: H.x, y: H.y, f: H.f, rot: 0 }, blend: .9 });
    D.camOverride = () => camTo(1420, 760, 1.45, 1, .6);
    await B.wait(1.2);
    A.exhale(.06); await say('— Я здесь.', 2.4);
    await B.wait(.8);
    // nobody hears; the door opens by itself
    A.doorCreak(); hs.doorSolid.off = true; B.tween(hs, 'door', 1, 2.4, B.easeOut);
    D.camOverride = () => camTo(1520, 790, 1.3, .9, .6);
    await B.wait(1.8);
    if (A.amb.rain) A.amb.rain.set(.04, 2);
    H.mode = 'free'; H.anim = null; D.camOverride = null; unlock(); D.beat = 'room2';
  }

  async function beatCorridor() {
    await B.until(() => H.x > 1600);
    D.beat = 'corridor';
    D.strings = A.pad([38, 45, 50, 53], { g: .045, lp: 520, a: 6 });
    await B.until(() => H.x > 1720);
    // the maid with two cups walks through his plane, leaves one cup by the door, takes the other away
    const m = hs.maid; Object.assign(m, { on: true, x: 2430, y: 940, f: -1, a: 0, cups: 2, pose: 'walk', s: .96 });
    B.tween(m, 'a', .92, 1.2);
    await new Promise(res => { D.maidLogic = dt => { m.x -= dt * 52; if (Math.abs(m.x - H.x) < 40) m.a = B.damp(m.a, .45, 6, dt); else m.a = B.damp(m.a, .92, 3, dt); if (m.x <= 1712) res(); }; });
    m.pose = 'stop'; await B.wait(.7);
    m.cups = 1; hs.sideCup = true; A.tone({ f: 2400, dur: .15, g: .02 }); A.tone({ f: 1700, dur: .2, g: .015, when: .02 });
    await B.wait(.8); A.exhale(.07); await B.wait(1.2);
    m.f = 1; m.pose = 'walk';
    await new Promise(res => { D.maidLogic = dt => { m.x += dt * 48; if (m.x > 1930) m.a = Math.max(0, m.a - dt * .7); if (m.a <= 0) res(); }; });
    m.on = false; D.maidLogic = null;
  }

  async function beatClimb() {
    await B.until(() => H.x > 2380 && H.y < 800);
    // the broken stair: a short human jump, a heavy landing
    D.gapWatch = true;
    await B.until(() => H.mode === 'ladder');
    await new Promise(res => { WD.onLadderTop = () => { WD.onLadderTop = null; res(); }; });
  }

  async function beatObservatory() {
    D.beat = 'obs-enter'; lock();
    // dissolve the house into the observatory while he climbs out through the hatch
    WD.obsGeo(); WD.area = 'obs'; dissolve = { a: 1 };
    H.mode = 'script';
    const r0 = { x: H.x, y: H.y, f: 1, rot: 0, s: 1 }; let k = 0;
    H.anim = () => ({ key: k < .5 ? 'climbout' : 'climbout2', params: k < .5 ? R.climb(k * 3) : R.land(Math.min(1, (k - .5) * 2)), root: { x: lerp(2496, 2505, k), y: k < .5 ? lerp(r0.y, 160 + 40, k * 2) : 160, f: 1, rot: 0, s: 1 }, blend: .3 });
    B.tween(dissolve, 'a', 0, 3.2, t => t);
    camTo(2500, 20, 1.05, 1.5, 1);
    await B.wait(1.6);
    const kt = { v: 0 }; H.anim = () => ({ key: kt.v < .5 ? 'climbout' : 'climbout2', params: kt.v < .5 ? R.climb(kt.v * 3) : R.land(Math.min(1, (kt.v - .5) * 2)), root: { x: lerp(2496, 2505, kt.v), y: kt.v < .5 ? lerp(r0.y, 200, kt.v * 2) : 160, f: 1, rot: 0, s: 1 }, blend: .3 });
    await B.tween(kt, 'v', 1, 1.6, t => t);
    dissolve = null;
    H.place(2505, 160, 1); H.ch.root = { x: 2505, y: 160, f: 1, rot: 0, s: 1 };
    B.tween(os, 'hatch', 1, .6, B.easeIn).then(() => { A.thud(.6); });
    if (D.strings) D.strings.stop(4);
    A.stopAmb('rain', 3);
    // the room opens up: he is small in something enormous
    camTo(3000, -330, .62, .35, .3);
    D.celesta = true;
    (async () => { await B.wait(1.5); const seq = [74, 77, 76, 81]; for (let r = 0; r < 40 && D.celesta; r++) { for (let i = 0; i < 4 && D.celesta; i++) { A.celesta(seq[i] - (r % 2 ? 12 : 0), { v: .8 }); await B.wait(i === 3 ? 2.6 : .9); } } })();
    D.quartet = A.pad([50, 57, 62, 65], { g: .05, lp: 1400, type: 'triangle', det: 4, a: 5 });
    await B.wait(2.2);
    F.hud.title = 0; F.hud.titleA = 1; B.tween(F.hud, 'title', 1, 3.2, t => t);
    await B.wait(1.2); B.tween(F.hud, 'a', 1, .8);
    await B.wait(5); B.tween(F.hud, 'a', 0, 1.5);
    await B.wait(1.5); B.tween(F.hud, 'titleA', 0, 2);
    H.walkV = 100; unlock(); D.beat = 'obs';
  }

  function obsCam(dt) {
    if (D.camOverride) return D.camOverride(dt);
    if (lookCam([{ x: 3560, fy: 100, r: 160, cx: 3570, cy: -80, z: 2.6 }, { x: 2750, fy: 160, r: 120, cx: 2750, cy: 40, z: 2.2 }])) return;
    camTo(clamp(H.x + H.f * 160, 2100, 3950), -230, .8, 1.4, .7);
  }
  async function beatPuzzle() {
    // crank opens the dome slit
    let crankDone = false, leverDone = false, ratchet = 0, stall = 0;
    D.puzzleLogic = dt => {
      fadePrompt(dt);
      const atCrank = Math.abs(H.x - 2712) < 45 && H.y > 150 && !crankDone, atLever = Math.abs(H.x - 3112) < 50 && H.y > 150 && crankDone && !leverDone;
      if (atCrank) {
        showHint('Удерживать — вращать ворот', 'act', 2750, -10, { hold: os.crank });
        if (B.btn('act')) {
          if (H.mode !== 'script') { H.mode = 'script'; H.f = 1; }
          stall -= dt; const resist = stall > 0 ? .15 : 1;
          if (B.frac(os.crank * 4) > .92 && stall <= -0.6) stall = .5;
          os.crank = Math.min(1, os.crank + dt * .22 * resist); os.crankAng += dt * 3.2 * resist;
          os.slit = os.crank;
          ratchet += dt * resist; if (ratchet > .14) { ratchet = 0; A.ratchet(.1); }
          if (Math.random() < dt * 2) A.rumble(.6, .5);
          const hp = WD.crankHandle();
          H.anim = () => ({ key: 'crank', params: { hip: [-1, 47 + Math.sin(os.crankAng) * 1.2], lean: .18 + Math.sin(os.crankAng) * .06, tilt: .02, anN: [5, 3], anB: [-8, 3], haN: R.toLocal(hp, { x: H.x, y: H.y, f: 1 }), haB: R.toLocal([hp[0] - 3, hp[1] + 3], { x: H.x, y: H.y, f: 1 }) }, root: { x: H.x, y: H.y, f: 1, rot: 0 }, blend: .3 });
          if (os.crank >= 1) { crankDone = true; H.mode = 'free'; A.clang(.4); A.shimmer(10); B.cam.shake = .2; }
        } else if (H.mode === 'script') H.mode = 'free';
      } else if (atLever) {
        showHint('Удерживать — потянуть рычаг', 'act', 3100, -40, { hold: os.lever });
        if (B.btn('act')) {
          if (H.mode !== 'script') { H.mode = 'script'; H.f = 1; }
          // tight: the tube moves in jerks under his weight, the counterweight swings
          const jerk = .5 + .5 * Math.max(0, Math.sin(B.time * 5));
          os.lever = Math.min(1, os.lever + dt * .2 * jerk); os.tube.ang = lerp(.661, -.62, B.ease(os.lever)); os.tube.wob = 1;
          if (Math.random() < dt * 3) A.creak({ f: 90 + Math.random() * 40, f2: 120, f3: 80, dur: .5, g: .03, bp: 400 });
          const hp = WD.leverHandle(), hr = { x: H.x, y: H.y, f: 1 };
          H.anim = () => ({ key: 'lever', params: { hip: [-6, lerp(46, 34, os.lever)], lean: lerp(.05, .35, os.lever), tilt: .25 - os.lever * .3, anN: [4, 3], anB: [-10, 4], haN: R.toLocal(hp, hr), haB: R.toLocal([hp[0] - 4, hp[1] + 2], hr) }, root: { x: H.x, y: H.y, f: 1, rot: 0 }, blend: .3 });
          if (os.lever >= 1) { leverDone = true; H.mode = 'free'; os.tube.wob = .3; }
        } else if (H.mode === 'script') { H.mode = 'free'; }
      }
      if (!leverDone) os.tube.wob = B.damp(os.tube.wob, 0, 1, dt);
    };
    D.cam = obsCam;
    await B.until(() => leverDone);
    D.puzzleLogic = null; F.prompt = null;
    // the line slit — telescope — star: the beam falls in and spills over the glass
    lock(); A.shimmer(18); A.whoosh(2.2, true);
    D.camOverride = () => camTo(3700, -380, .72, 1, .6);
    await B.tween(os, 'beam', 1, 1.8);
    await B.wait(1.2);
  }

  async function beatLetters() {
    D.beat = 'letters';
    WD.buildLetters(); os.lettersOn = true;
    // the camera rounds the dome so that one pane comes between us and him
    D.camOverride = () => camTo(3200, -250, .9, .7, .5);
    H.mode = 'script'; let tx = 3215;
    H.anim = dt => { const d = tx - H.x; H.f = Math.sign(d) || H.f; if (Math.abs(d) > 4) { H.x += Math.sign(d) * 95 * (dt || .016); const ph = (H._ph = (H._ph || 0) + (dt || .016) * 1.3); return { key: 'walk', params: R.walk(ph, .2, .3), root: { x: H.x, y: H.y, f: H.f, rot: 0 }, blend: .25 }; } return { key: 'tilt', params: Object.assign(R.stand(B.time, .1), { tilt: -.42, headLean: .25, neck: .1 }), root: { x: H.x, y: H.y, f: 1, rot: 0 }, blend: .8 }; };
    // walk off the platform first if needed
    if (H.y < 159) { H.y = 160; }
    B.tween(os, 'panel', 1, 2.2);
    D.letterGather = 0; D.letterLogic = dt => WD.updateLetters(dt, D.letterGather, D.letterFall);
    await B.wait(1.2);
    B.tween(D, 'letterGather', 1, 2.5); B.wait(2.2).then(() => B.tween(os, 'glowA', 1, 2.5));
    await B.wait(5);
    await say('— Кто-то пишет с той стороны стекла.', 3.4);
    await B.wait(.6);
    B.tween(os, 'panel', .22, 3);
    D.camOverride = null; H.mode = 'free'; H.anim = null; unlock(); D.beat = 'echo';
  }

  async function beatEcho() {
    let touched = false;
    D.echoLogic = dt => {
      fadePrompt(dt);
      const { E } = WD.tubeEnds(os.tube);
      if (!touched && H.x > 3470 && H.x < 3640 && H.y < 105 && H.ground) {
        showHint('Коснуться', 'act', E[0], E[1] - 30);
        if (B.hit('act')) touched = true;
      }
    };
    await B.until(() => touched);
    D.echoLogic = null; F.prompt = null; lock();
    const { E } = WD.tubeEnds(os.tube);
    H.mode = 'script'; const hr = { x: H.x, y: H.y, f: 1, rot: 0 };
    H.anim = () => ({ key: 'touch', params: Object.assign(R.stand(B.time, .1), { haN: R.toLocal([E[0] - 8, E[1] + 4], hr), handA: .3, tilt: .1 }), root: hr, blend: .5 });
    await B.wait(.8);
    // a pale strand comes off the brass like down
    WD.emit({ kind: 'strand', x: E[0] - 10, y: E[1], vx: -14, vy: -22, life: 5, col: [235, 230, 220], a: .9, wob: 10, layer: 'front' });
    A.strand();
    D.camOverride = () => camTo(3250, -150, .74, .8, .5);
    await B.wait(1.2);
    B.tween(os, 'ghosts', 1, 1.6);
    await B.wait(1.4);
    // her laugh; the name is eaten by the glass harmonica
    A.tone({ f: 2637, f2: 2700, dur: .7, g: .05, a: .02, wet: .6 }); A.tone({ f: 2643, dur: .7, g: .04, a: .02 });
    let d = A.murmur('ха-ха, это же Сатурн? С кольцами как на картинке', { f0: 230, syl: .14, dest: 'sfx', breathy: .3, fShift: 1.15, rise: true, g: .25 });
    await say('— [визг стекла], это же Сатурн? С кольцами — как на картинке!', Math.max(3.6, d), { tag: 'ОТГОЛОСОК · ЖЕНЩИНА' });
    d = A.murmur('Как на картинке. Только настоящий.', { f0: 108, syl: .17, dest: 'sfx', g: .25 });
    await say('— Как на картинке. Только настоящий.', Math.max(3, d), { tag: 'ОТГОЛОСОК · МУЖЧИНА' });
    // they crumble
    B.tween(os, 'ghostCrumble', 1, 1.6);
    for (let i = 0; i < 60; i++) WD.emit({ x: 2890 + Math.random() * 120, y: -110 + Math.random() * 110, vx: (Math.random() - .5) * 30, vy: -10 - Math.random() * 30, life: 2 + Math.random() * 2, size: 1.2, col: [200, 215, 250], a: .7, layer: 'mid', fadeIn: .3 });
    A.shimmer(8);
    F.hud.count = 1; B.tween(F.hud, 'countA', 1, .6);
    await B.wait(1.8);
    H.anim = () => ({ key: 'quiet', params: R.stand(B.time, .5), root: hr, blend: .8 });
    await say('— Я показывал ей Сатурн.', 2.6);
    await B.wait(1.4);
    await say('— Кому — ей?', 2.2);
    B.tween(F.hud, 'countA', 0, 2);
    H.mode = 'free'; H.anim = null; D.camOverride = null;
    await B.wait(1.4);
  }

  /* ---------- the chase ---------- */
  const chase = D.chase = { T: 0, diff: 1, snaps: [], fails: 0, state: 'off', lampIdx: 0, extState: 'walk', extT: 0 };
  function snap() { const e = os.ext; return { T: chase.T, x: H.x, y: H.y, f: H.f, vx: H.vx, vy: H.vy, ground: H.ground, mode: H.mode, s: H.tube ? H.tube.s : null, ang: os.tube.ang, ex: e.x, epole: e.pole, eState: chase.extState, eT: chase.extT, lamps: os.lamps.map(l => l.on) }; }
  function restore(s) {
    chase.T = s.T; os.tube.ang = s.ang; os.ext.x = s.ex; os.ext.pole = s.epole; chase.extState = s.eState; chase.extT = s.eT; s.lamps.forEach((v, i) => { os.lamps[i].on = v; });
    if (s.mode === 'tube' && s.s != null) { H.startTube(os.tube, s.s); } else { H.mode = 'free'; H.tube = null; H.x = s.x; H.y = s.y; H.f = s.f; H.vx = s.vx; H.vy = s.vy; H.ground = s.ground; }
    if (H.tube) { const p = H.tubePoint(os.tube, H.tube.s); H.x = p[0]; H.y = p[1]; }
    os.wash.x = washX(chase.T);
  }
  const washX = T => 1450 + (55 * T + 2.4 * T * T) * chase.diff;
  async function beatChase() {
    D.beat = 'chase'; lock();
    // one wet-finger tone on a glass rim, two pitches rubbing
    D.harm = A.harmonica(88, { g: .045, beat: 2.4, a: 3 });
    await B.wait(2);
    D.camOverride = () => camTo(1980, -170, .9, 1.1, .8);
    D.celesta = false; if (D.quartet) D.quartet.stop(2);
    await B.wait(1.6);
    // out of the dark of the doorway: very tall, the frosted-glass face with a wick in it
    const e = os.ext; Object.assign(e, { on: true, x: 1462, a: 0, pole: 0, walk: 0, target: null }); B.tween(e, 'a', 1, 2.2);
    await B.wait(1.6);
    chase.T = 0; chase.extState = 'walk'; chase.state = 'intro'; os.wash.on = true; chase.snaps = [];
    D.choir = A.choir([38, 45, 50], { g: .1, a: 3 }); D.bass = A.dido({ g: .1, pole: true, accel: 1.1 }); D.strings2 = A.pad([26, 38, 45], { g: .05, lp: 300, a: 2 });
    await B.wait(2.4);
    // back to him: the lever gives, the telescope drops back onto the bookcase
    D.camOverride = null;
    await B.wait(.6);
    os.lever = 0; os.beam = 0; B.tween(os.tube, 'ang', .661, .7, B.easeIn).then(() => { A.clang(1); B.cam.shake = .8; os.tube.wob = 2; });
    D.letterFall = true; WD.crackAt(3220, -270, 5); A.noise({ type: 'highpass', f: 2500, g: .2, dur: .6 }); B.tween(os, 'panel', 0, 3);
    await B.wait(.5);
    chase.state = 'run'; H.canRun = true; unlock();
    F.hud.thread = 1;
    if (!D.seen.runHint) { D.seen.runHint = true; D.runHintT = 4; }
    await new Promise(res => { chase.done = res; });
  }
  function putOut(i, byHim) {
    const l = os.lamps[i]; if (!l || l.on < .5) return; l.on = 0; l.flare = .9; A.puff((B.w2s(l.x, 0)[0] / B.VW - .5) * 1.4, .8);
    if (byHim) os.ext.flare = 1;
    WD.crackAt(l.x + (Math.random() - .5) * 300, -300 - Math.random() * 600, 100 + i);
  }
  function chaseCam(dt) {
    if (D.camOverride) return D.camOverride(dt);
    if (H.mode === 'tube') { camTo(H.x - 60, H.y - 120, .95, 1.6, .9); return; }
    // keep the spreading dark in the frame once it gets close
    const k = smooth(1500, 500, H.x - os.wash.x), cx = lerp(H.x + 170, (os.wash.x + H.x) / 2 + 120, k);
    camTo(cx, clamp(H.y - 190, -300, -60), lerp(.78, .68, k), 2, 1);
  }
  function chaseLogic(dt) {
    fadePrompt(dt);
    if (chase.state === 'intro') { chase.T += dt; os.wash.x = washX(chase.T); extStep(dt); os.lamps.forEach((l, i) => { if (l.on > .5 && os.wash.x > l.x - 20) putOut(i, false); }); return; }
    if (chase.state === 'run') {
      chase.T += dt;
      const target = washX(chase.T);
      os.wash.x = target;
      extStep(dt);
      // the dark spreads faster than he walks
      os.lamps.forEach((l, i) => { if (l.on > .5 && os.wash.x > l.x - 20) putOut(i, false); });
      if (Math.random() < dt * .8) WD.crackAt(os.wash.x + 200 + Math.random() * 500, -200 - Math.random() * 800, Math.floor(Math.random() * 999));
      // tube: mount from the bookcase, the seesaw tips as he crawls past the pivot
      const T = os.tube;
      if (H.mode === 'free' && H.x > 3950 && H.x < 4150 && H.ground && T.ang > .4) { showHint('Забраться', 'up', 4040, 0); if (B.hit('up') || B.hit('jump') || (H.y <= 121 && B.hit('left'))) H.startTube(T, 395); }
      if (H.mode === 'tube') {
        const tgt = lerp(.661, -.62, smooth(30, -95, H.tube.s));
        const prev = T.ang; T.ang = B.damp(T.ang, tgt, 1.6, dt); T.wob = B.damp(T.wob, H.tube.moving ? 1 : .2, 3, dt);
        if (Math.abs(T.ang - prev) > .0015 && Math.random() < dt * 6) A.creak({ f: 80, f2: 110, f3: 70, dur: .4, g: .03, bp: 350 });
        if (H.tube.s <= T.sMin + 16 && T.ang < -.45) {
          showHint('Удерживать — вглядеться', 'look', H.x - 40, H.y - 90, { hold: D.lensHold || 0 });
          if (B.btn('look')) { D.lensHold = (D.lensHold || 0) + dt / .9; if (D.lensHold >= 1) { chase.state = 'won'; chase.done(); } } else D.lensHold = Math.max(0, (D.lensHold || 0) - dt);
          chase.diff = Math.max(.2, chase.diff - dt * .2);
        }
      }
      if (D.runHintT > 0) { D.runHintT -= dt; showHint('Бежать', 'Shift', H.x, H.y - 220); }
      // snapshots for the rewind
      chase.snapT = (chase.snapT || 0) + dt; if (chase.snapT > .1) { chase.snapT = 0; chase.snaps.push(snap()); if (chase.snaps.length > 120) chase.snaps.shift(); }
      // caught by the dark
      if (os.wash.x > H.x - 34) fail();
      F.hud.thread = B.damp(F.hud.thread, 1, 1, dt);
    }
  }
  // the Extinguisher: step, step, lift the pole, "pf"
  function extStep(dt) {
    const e = os.ext;
    if (chase.extState === 'walk') {
      e.x += dt * 60; e.walk += dt * .8; e.target = null;
      const nl = os.lamps.findIndex(l => l.on > .5 && l.x > e.x + 30);
      if (nl >= 0 && os.lamps[nl].x - e.x < 120) { chase.extState = 'lift'; chase.extT = 0; chase.extLamp = nl; }
    } else {
      chase.extT += dt; const l = os.lamps[chase.extLamp], u = clamp(chase.extT / .9);
      const loc = [(l.x - e.x) / 2.5, (160 - (-24)) / 2.5];
      e.target = [lerp(62, loc[0], u), lerp(44, loc[1], u)];
      if (u >= 1 && l.on > .5) putOut(chase.extLamp, true);
      if (chase.extT > 1.4 || l.on < .5 && u >= 1) { chase.extState = 'walk'; e.target = null; }
    }
  }
  async function fail() {
    chase.state = 'fail'; lock(); chase.fails++;
    A.whoosh(1.2, false);
    F.hud.a = 1; B.tween(F.hud, 'thread', 0, 1.1);
    await B.tween(H, 'threads', 1, 1.2, t => t);
    // the memory rewinds the frame
    A.rewind(); F.rewind = 1; F.desat = .8;
    const n = chase.snaps.length, back = Math.min(n - 1, 50);
    for (let i = 0; i <= back; i += 2) { restore(chase.snaps[n - 1 - i]); H.threads = 1 - i / back; H.W = null; H.update(0); await B.wait(.02); }
    chase.snaps.length = Math.max(1, n - back);
    H.threads = 0; F.rewind = 0; F.desat = 0; B.tween(F.hud, 'a', 0, 1.2);
    chase.diff *= .86;
    // make sure there is still room to run
    if (washX(chase.T) > H.x - 400) { const want = H.x - 520; let T = chase.T; while (T > 0 && washX(T) > want) T -= .05; chase.T = Math.max(0, T); }
    chase.state = 'run'; unlock();
  }

  async function beatLens() {
    D.beat = 'lens'; lock(); chase.state = 'off';
    if (D.harm) D.harm.stop(2); if (D.choir) D.choir.stop(3); if (D.bass) D.bass.stop(); if (D.strings2) D.strings2.stop(2);
    const { E } = WD.tubeEnds(os.tube);
    // the camera leaves the side plane for the first time: a slow dolly into the lens
    D.camOverride = () => camTo(E[0] - 6, E[1], 1.6, 1.2, .8);
    os.wash.on = false;
    await B.wait(1.2);
    A.whoosh(2.4, true); A.shimmer(16);
    D.camOverride = () => camTo(E[0] - 18, E[1], 7, 1.6, 1.1);
    B.tween(F, 'white', B.reducedMotion ? .08 : .3, 1.6, B.easeIn);
    await B.wait(1.6);
    F.kaleidoGrab(); D.kaleido = { p: 0, mix: 1 };
    B.tween(F, 'white', 0, .8);
    await B.tween(D.kaleido, 'p', 1, 1.6, t => t);
    // reassemble as the theatre: row seven, seat twelve
    WD.area = 'theatre'; th.turn = 0; th.push = 0; B.cam.shake = 0;
    D.kaleido = null; render(0); F.kaleidoGrab(); D.kaleido = { p: 1, mix: 1 };
    const ap = A.applauseRun(16, { g: .3, rate: 120, swell: 1.2 });
    await B.tween(D.kaleido, 'p', 0, 1.8, t => 1 - Math.pow(1 - t, 2));
    D.kaleido = null;
    await B.wait(2.2);
    await B.tween(th, 'turn', .78, 7, t => t * t);
    // one sharp tick: everything stops
    ap.stop(); A.tickHard(); WD.area = 'black'; F.fade = 1;
    await B.wait(1.1);
  }

  async function beatTitle() {
    D.beat = 'title'; F.fade = 0; F.title.on = true; F.title.t = 0; F.title.sub = 0;
    B.tween(F.title, 't', 4, 4, t => t);
    await B.wait(.55); A.inkDrop();
    await B.wait(3.4); B.tween(F.title, 'sub', 1, 1.2);
    await B.wait(4.5);
    await B.tween(F, 'fade', 1, 1.5);
    F.title.on = false;
  }

  /* ================= the end screen ================= */
  const end = D.end = { idle: 0, walked: false, hover: 0, letters: [], front: 0, dialog: false, gone: false };
  function buildEndLetters() {
    const w = 900, h = 220, c = B.off(w, h), x = c.getContext('2d'); x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = `700 150px ${B.F.sc}`; x.fillText('НЕ УХОДИ', w / 2, h / 2 + 8);
    const d = x.getImageData(0, 0, w, h).data, pts = [];
    for (let y = 0; y < h; y += 7) for (let xx = 0; xx < w; xx += 7) if (d[(y * w + xx) * 4 + 3] > 120) pts.push([510 + xx, 140 + y]);
    end.letters = pts.map(p => ({ hx: Math.random() * B.VW, hy: Math.random() * 520, tx: p[0], ty: p[1], x: 0, y: 0, s: .6 + Math.pow(Math.random(), 6) * 2.6, ph: Math.random() * 9 }));
    end.letters.forEach(s => { s.x = s.hx; s.y = s.hy; });
  }
  function renderEnd(ctx, dt) {
    B.screen(ctx); ctx.fillStyle = '#020306'; ctx.fillRect(0, 0, B.VW, B.VH);
    B.view(ctx, .45, [3000, -300]); B.plate(ctx, 'obs_sky');
    B.view(ctx); B.plate(ctx, 'obs_dome'); B.plate(ctx, 'obs_mid');
    B.screen(ctx); ctx.fillStyle = 'rgba(2,2,4,.5)'; ctx.fillRect(0, 0, B.VW, B.VH);
    // soot drifting
    for (let i = 0; i < 50; i++) { const x = B.frac(B.hash(i) + B.time * .004 * (1 + B.hash(i + 3))) * B.VW, y = B.frac(B.hash(i + 7) + B.time * .01) * B.VH; ctx.fillStyle = 'rgba(160,160,170,.06)'; ctx.fillRect(x, y, 2, 2); }
    // the stars: wandering, or writing when the cursor rests on "Leave"
    for (const s of end.letters) {
      const k = 1 - Math.exp(-dt * (end.hover ? 1.1 : .5));
      const tx = end.hover ? s.tx : s.hx + Math.sin(B.time * .2 + s.ph) * 10, ty = end.hover ? s.ty : s.hy + Math.cos(B.time * .17 + s.ph) * 8;
      s.x += (tx - s.x) * k; s.y += (ty - s.y) * k;
      B.glow(ctx, s.x, s.y, s.s * (end.hover ? 5 : 4), [215, 228, 255], (end.hover ? .7 : .45) + .3 * Math.sin(B.time * 3 + s.ph));
    }
    // he comes back if nobody does anything
    if (H.visible) {
      B.view(ctx);
      if (end.front > 0) {
        const r = { x: H.x, y: H.y, f: 1, s: 1 };
        B.figure(ctx, [H.x - 80, H.y - 220, H.x + 80, H.y + 20], x => R.paintFront(x, r, B.time), { body: [6, 6, 9], grad: [20, 20, 26], rim: [[180, 195, 235], .45, 1.3, [0, -1]], alpha: end.front });
        if (end.front < 1) H.draw(ctx, { rim: [[180, 195, 235], .45, 1.3, [1, -.5]], fig: {} });
      } else H.draw(ctx, { rim: [[180, 195, 235], .45, 1.3, [1, -.5]] });
      B.screen(ctx);
    }
  }
  async function beatEnd() {
    D.beat = 'end'; WD.area = 'end'; WD.obsGeo(); buildEndLetters();
    camTo(3000, -200, .9); B.camSnap(); H.visible = false; H.alpha = 1; F.subY = B.VH * .62;
    $('end').hidden = false; $('touch').hidden = true; F.fade = 1; B.tween(F, 'fade', 0, 2.4);
    B.inputLocked = false; H.ctrl = false;
    if (A.amb.room) A.amb.room.set(.02, 2);
    end.idle = 0;
    D.logic = dt => {
      end.idle += dt; if (B.anyKey) { end.idle = 0; B.anyKey = false; }
      if (end.idle > 15 && !end.walking && !end.dialog && !end.gone) { end.walking = true; heroVisit(); }
    };
  }
  async function heroVisit() {
    H.place(2340, 160, 1); H.visible = true; H.mode = 'free'; H.ctrl = false; H.autoDir = 1; H.walkV = 80; H.alpha = 1;
    await B.until(() => H.x >= 2990); H.autoDir = 0;
    await B.wait(1.2);
    await B.tween(end, 'front', 1, .8);
    await B.wait(5.5);
    await B.tween(end, 'front', 0, .6);
    H.autoDir = 1; await B.until(() => H.x > 3150); await B.tween(H, 'alpha', 0, 1.6);
    H.visible = false; H.alpha = 1; H.autoDir = 0; end.walking = false; end.idle = 0;
  }
  function wireEnd() {
    const exit = $('btn-exit'), wish = $('btn-wish'), dlg = $('dlg-leave');
    exit.addEventListener('mouseenter', () => { end.hover = 1; }); exit.addEventListener('mouseleave', () => { end.hover = 0; });
    exit.addEventListener('focus', () => { end.hover = 1; }); exit.addEventListener('blur', () => { end.hover = 0; });
    exit.addEventListener('click', () => { end.dialog = true; dlg.hidden = false; $('btn-no').focus(); });
    wish.addEventListener('click', () => { $('wish-note').hidden = false; A.uiTick(); });
    $('btn-no').addEventListener('click', () => { dlg.hidden = true; end.dialog = false; end.hover = 0; F.say('Хорошо.', 2.4); A.whisper('Хорошо'); });
    $('btn-yes').addEventListener('click', async () => { dlg.hidden = true; end.gone = true; $('end').hidden = true; await B.tween(F, 'fade', 1, 2); $('bye').hidden = false; });
    $('btn-again').addEventListener('click', () => { location.hash = ''; location.reload(); });
  }

  /* ================= running it ================= */
  async function run(from) {
    const order = ['black', 'bedroom', 'house', 'corridor', 'obs', 'puzzle', 'letters', 'echo', 'chase', 'lens', 'title', 'end'];
    const at = order.indexOf(from) >= 0 ? order.indexOf(from) : 0;
    D.started = true;
    if (at <= 0) await beatBlack();
    if (at <= 1) await beatBedroom(); else if (at === 2 || at === 3) await jumpHouse();
    if (at === 3) { hs.door = 1; hs.doorSolid.off = true; H.place(1610, 940, 1); camTo(1800, 770, 1.14); B.camSnap(); D.beat = 'room2'; }
    if (at <= 3) {
      D.logic = dt => { houseLogic(dt); if (D.reflLogic) D.reflLogic(dt); if (D.mirrorLogic) D.mirrorLogic(dt); if (D.maidLogic) D.maidLogic(dt); if (D.gapWatch && H.mode === 'free' && !H.ground && H.vy < 0 && H.x > 2395 && H.x < 2440) H.heavyNext = true; };
      D.cam = houseCam;
      if (at <= 2) { const w = beatWindow(); await beatMirror(); await w; }
      beatCorridor(); await beatClimb();
      D.logic = null; D.reflLogic = null; D.maidLogic = null;
    }
    if (at <= 4) await beatObservatory(); else await jumpObs(order[at]);
    D.cam = obsCam;
    if (at <= 5) { D.logic = dt => { if (D.puzzleLogic) D.puzzleLogic(dt); }; await beatPuzzle(); }
    D.logic = dt => { if (D.letterLogic) D.letterLogic(dt); if (D.echoLogic) D.echoLogic(dt); };
    if (at <= 6) await beatLetters();
    if (at <= 7) await beatEcho();
    if (at <= 8) { D.cam = chaseCam; D.logic = dt => { chaseLogic(dt); if (D.letterLogic) D.letterLogic(dt); }; await beatChase(); }
    D.logic = dt => { if (D.letterLogic) D.letterLogic(dt); };
    if (at <= 9) await beatLens();
    D.logic = null; D.cam = null;
    if (at <= 10) await beatTitle();
    await beatEnd();
  }
  // direct entry points (for testing: #house, #obs, #puzzle, #letters, #echo, #chase, #lens, #title, #end)
  async function jumpHouse() {
    WD.area = 'house'; WD.houseGeo(); A.startRain(); A.startRoom(); H.place(1000, 940, 1); H.walkV = 86; F.fade = 0; camTo(1100, 768, 1.28); B.camSnap(); unlock();
  }
  async function jumpObs(which) {
    WD.obsGeo(); WD.area = 'obs'; os.hatch = 1; F.fade = 0; H.place(2600, 160, 1); H.walkV = 100; camTo(2900, -160, .8); B.camSnap(); unlock();
    D.quartet = A.pad([50, 57, 62, 65], { g: .05, lp: 1400, type: 'triangle', det: 4, a: 5 });
    if (['letters', 'echo', 'chase', 'lens', 'title', 'end'].includes(which)) { os.slit = os.crank = 1; os.lever = 1; os.tube.ang = -.62; os.beam = 1; H.place(3150, 160, 1); }
    if (['echo', 'chase', 'lens'].includes(which)) { WD.buildLetters(); os.letters.forEach(s => { s.x = s.tx; s.y = s.ty; s.a = 1; }); os.glowA = 1; os.panel = .22; D.letterLogic = dt => WD.updateLetters(dt, 1, D.letterFall); H.place(3540, 100, 1); }
    if (which === 'chase') { H.place(3540, 100, 1); }
    if (which === 'lens') { os.tube.ang = -.62; H.startTube(os.tube, os.tube.sMin); const p = H.tubePoint(os.tube, os.tube.sMin); H.x = p[0]; H.y = p[1]; }
    camTo(H.x, -160, .8); B.camSnap();
  }

  /* ================= menus ================= */
  function togglePause() {
    B.paused = !B.paused; $('pause').hidden = !B.paused;
    if (A.ok) { if (B.paused) A.ac.suspend(); else A.ac.resume(); }
    if (B.paused) $('btn-resume').focus();
  }
  function wireMenus() {
    $('btn-resume').addEventListener('click', togglePause);
    $('btn-restart').addEventListener('click', () => { location.hash = ''; location.reload(); });
    const subs = $('opt-subs'); subs.checked = !!B.prefs.printSubs; subs.addEventListener('change', () => { B.prefs.printSubs = subs.checked; B.savePrefs(); });
    const vol = $('opt-vol'); vol.value = Math.round(B.prefs.volume * 100); vol.addEventListener('input', () => { B.prefs.volume = vol.value / 100; A.setVolume(B.prefs.volume); B.savePrefs(); });
    $('btn-pause').addEventListener('click', () => { if (D.started) togglePause(); });
    // touch controls
    const isTouch = matchMedia('(pointer: coarse)').matches; B.touch = isTouch;

    document.querySelectorAll('[data-k]').forEach(el => {
      const k = el.dataset.k;
      const on = e => { e.preventDefault(); B.setVirtual(k, true); el.classList.add('on'); }, off = e => { e.preventDefault(); B.setVirtual(k, false); el.classList.remove('on'); };
      el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('pointerleave', off);
    });
  }
  async function boot() {
    wireMenus(); wireEnd();
    ['pointermove', 'pointerdown', 'wheel'].forEach(ev => window.addEventListener(ev, () => { B.anyKey = true; }, { passive: true }));
    requestAnimationFrame(t => { last = t; requestAnimationFrame(frame); });
    const btn = $('btn-start'), bar = $('load-bar');
    const fonts = Promise.all([`600 40px ${B.F.sc}`, `700 40px ${B.F.sc}`, `500 40px ${B.F.serif}`, `italic 500 40px ${B.F.serif}`, `40px ${B.F.her}`].map(f => document.fonts.load(f, 'НЕ УХОДИ Обсерватория Пенелопа ё').catch(() => null)));
    try { await Promise.all([B.loadAll(p => { bar.style.width = (p * 100).toFixed(0) + '%'; }), fonts]); }
    catch (e) { $('load-err').hidden = false; $('load-err').textContent = e.message + '. Обновите страницу.'; return; }
    btn.disabled = false; btn.textContent = 'Начать';
    const start = () => {
      A.init(); A.setVolume(B.prefs.volume); $('intro').hidden = true; $('btn-pause').hidden = false; if (B.touch) $('touch').hidden = false;
      const from = (location.hash || '').replace('#', '');
      run(from).catch(err => { console.error(err); });
    };
    btn.addEventListener('click', start, { once: true });
    window.__demo = { B, D, H, WD, os, hs, chase, start };
  }
  boot();
})();
