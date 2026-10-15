'use strict';
// Procedural rig for the hero: pose generators in a local frame (feet at origin, +x = facing, +y = up,
// 100 units = full height), two-bone IK for legs and arms, a greatcoat built from the thighs, and
// pose blending done in world space so that turns and transitions read as motion.
(() => {
  const B = BD, R = B.rig = {};
  const U = 1.8; R.U = U;               // px per local unit: hero is 180 px tall
  const L1 = 23, L2 = 23, A1 = 17.5, A2 = 15;
  const add = (a, b) => [a[0] + b[0], a[1] + b[1]], sub = (a, b) => [a[0] - b[0], a[1] - b[1]], mul = (a, k) => [a[0] * k, a[1] * k];
  const len = a => Math.hypot(a[0], a[1]), norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
  const PTS = ['hip', 'chest', 'neck', 'sh', 'shB', 'knN', 'anN', 'toN', 'knB', 'anB', 'toB', 'elN', 'haN', 'elB', 'haB'];
  R.PTS = PTS;

  function ik(a, t, l1, l2, s) {
    let dx = t[0] - a[0], dy = t[1] - a[1], d = Math.hypot(dx, dy);
    const dmax = l1 + l2 - .02, dmin = Math.abs(l1 - l2) + .5;
    if (d > dmax) { dx *= dmax / d; dy *= dmax / d; d = dmax; }
    if (d < dmin) { const k = dmin / (d || 1); dx *= k; dy *= k; d = dmin; }
    const ang = Math.atan2(dy, dx), b = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
    return [[a[0] + l1 * Math.cos(ang + s * b), a[1] + l1 * Math.sin(ang + s * b)], [a[0] + dx, a[1] + dy]];
  }
  R.ik = ik;

  // Build a full pose from a compact parameter set.
  R.build = o => {
    const lean = o.lean || 0, hip = o.hip || [-.5, 49];
    const rot = (v, l) => [v[0] * Math.cos(l) + v[1] * Math.sin(l), -v[0] * Math.sin(l) + v[1] * Math.cos(l)];
    const chest = add(hip, rot([1.1, 28], lean));
    const nl = lean + (o.neck || 0), hl = nl + (o.headLean || 0);
    const neck = add(chest, rot([1, 7.5], nl));
    const hp = add(neck, rot([1.8, 7.3], hl));
    const P = { lean, hip, chest, neck, head: { x: hp[0], y: hp[1], tilt: -hl + (o.tilt == null ? -.06 : o.tilt) }, flare: o.flare || 0, handA: o.handA || 0 };
    P.sh = add(chest, rot([.6, 2.5], lean)); P.shB = add(P.sh, rot([-2.2, 0], lean));
    const leg = (an, fa, s) => {
      const [kn, a2] = ik(hip, an, L1, L2, 1);
      const c = Math.cos(fa || 0), sn = Math.sin(fa || 0);
      return [kn, a2, add(a2, [8 * c + 2 * sn, 8 * sn - 2 * c])];
    };
    [P.knN, P.anN, P.toN] = leg(o.anN || [1.2, 3], o.faN);
    [P.knB, P.anB, P.toB] = leg(o.anB || [-3.2, 3], o.faB);
    const arm = (sh, ha, ang) => {
      if (ha) { const t = typeof ha === 'function' ? ha(P) : ha; return ik(sh, t, A1, A2, -1); }
      const [a1, a2] = ang || [0, .2]; const el = add(sh, [A1 * Math.sin(a1), -A1 * Math.cos(a1)]);
      return [el, add(el, [A2 * Math.sin(a1 + a2), -A2 * Math.cos(a1 + a2)])];
    };
    [P.elN, P.haN] = arm(P.sh, o.haN, o.aN);
    [P.elB, P.haB] = arm(P.shB, o.haB, o.aB || [-.05, .2]);
    return P;
  };

  /* ---------- pose generators (return parameter sets) ---------- */
  R.stand = (t, hunch = 0, b = 1) => ({
    hip: [-.5, 49 - hunch * 1.3 + Math.sin(t * 1.4) * .25 * b], lean: .02 + hunch * .1 + Math.sin(t * 1.4) * .006 * b, neck: hunch * .16, headLean: hunch * .12,
    tilt: -.06 - hunch * .05, anN: [1.2, 3], anB: [-3.2, 3], aN: [.05 + hunch * .08, .22], aB: [-.08, .18],
  });
  const walkLeg = (p, S, lift, st = .6) => {
    p = B.frac(p);
    if (p < st) { const u = p / st, hl = u > .72 ? (u - .72) * 1.6 : 0; return [lerp(S / 2, -S / 2, u), 3 + hl * 5, -hl]; }
    const u = (p - st) / (1 - st); return [lerp(-S / 2, S / 2, B.ease(u)), 3 + lift * Math.sin(Math.PI * u), lerp(-.45, .12, u)];
  };
  R.walk = (ph, sp = 0, hunch = 0) => {
    const S = lerp(24, 38, sp), lift = lerp(5, 8, sp);
    const [xN, yN, fN] = walkLeg(ph, S, lift), [xB, yB, fB] = walkLeg(ph + .5, S, lift);
    const amp = .26 + .2 * sp, aN = -amp * (xN / (S / 2)), aB = -amp * (xB / (S / 2));
    return {
      hip: [.6 + sp * 1.5, 48.2 - hunch * 1.2 + 1.1 * Math.cos(4 * Math.PI * (ph - .3))], lean: .05 + .07 * sp + hunch * .09,
      neck: hunch * .14, headLean: hunch * .1, tilt: -.05 - hunch * .04,
      anN: [xN + 1, yN], faN: fN, anB: [xB - 1, yB], faB: fB,
      aN: [aN + .04, .22 + Math.max(0, aN) * .7], aB: [aB - .04, .18 + Math.max(0, aB) * .6], flare: sp * 1.5,
    };
  };
  R.run = ph => {
    const S = 64, lift = 16, st = .38;
    const leg = p => { p = B.frac(p); if (p < st) { const u = p / st; return [lerp(S * .36, -S / 2, u), 3, 0]; } const u = (p - st) / (1 - st); return [lerp(-S / 2, S * .36, B.ease(u)), 3 + lift * Math.sin(Math.PI * u) + 12 * Math.sin(Math.PI * u) * (1 - u), lerp(-.6, .2, u)]; };
    const [xN, yN, fN] = leg(ph), [xB, yB, fB] = leg(ph + .5);
    const aN = -.85 * (xN / (S / 2)), aB = -.85 * (xB / (S / 2));
    return {
      hip: [4, 50.5 + 2 * Math.cos(4 * Math.PI * (ph - .19))], lean: .3, neck: -.08, headLean: -.04, tilt: .02,
      anN: [xN + 2, yN], faN: fN, anB: [xB, yB], faB: fB, aN: [aN, 1.25], aB: [aB, 1.15], flare: 7,
    };
  };
  R.push = (ph, moving) => {
    const sl = moving ? Math.sin(ph * Math.PI * 2) : 0;
    return {
      hip: [-17, 27 + sl * .8], lean: 1.22, neck: -.42, headLean: -.12, tilt: .02,
      anN: [-3 + sl * 5, 3 + Math.max(0, sl) * 3], faN: -.1, anB: [-30 - sl * 4, 4 + Math.max(0, -sl) * 3], faB: -.5,
      haN: [17, 20], haB: [16, 24], flare: 2,
    };
  };
  R.climb = ph => {
    const s = Math.sin(ph * Math.PI * 2), c = Math.sin(ph * Math.PI * 2 + Math.PI);
    return {
      hip: [-6, 50 + s * 1.2], lean: -.06, neck: .05, tilt: .18,
      anN: [5, 9 + 12 * c], faN: .1, anB: [4, 9 + 12 * s], faB: .1,
      haN: [10, 78 + 12 * s], haB: [9, 78 + 12 * c], flare: 0,
    };
  };
  R.jump = vy => {
    const up = vy < 0, k = clamp(Math.abs(vy) / 500);
    return up ? { hip: [0, 50], lean: .14, tilt: .08, anN: [8, 16], faN: -.3, anB: [-10, 13], faB: -.6, aN: [-.9, .9], aB: [.9, .7], flare: 4 }
      : { hip: [0, 49], lean: .1, tilt: -.1, anN: [6, 4 + 6 * (1 - k)], faN: -.2, anB: [-8, 7], faB: -.4, aN: [1.3, .4], aB: [.8, .3], flare: 2 + 3 * k };
  };
  R.land = k => { // heavy landing on the hands, then getting up (k: 0 → 1)
    const c = 1 - B.easeOut(k);
    return {
      hip: [lerp(-.5, -9, c), lerp(49, 24, c)], lean: lerp(.05, 1.05, c), neck: c * -.3, tilt: -.2 * c - .06,
      anN: [lerp(1.2, 8, c), 3], anB: [lerp(-3.2, -14, c), 3], faB: -.4 * c,
      haN: c > .2 ? [lerp(8, 21, c), lerp(46, 2, c)] : null, aN: [.06, .22], haB: c > .2 ? [lerp(4, 16, c), lerp(48, 2, c)] : null, aB: [-.08, .2],
    };
  };
  R.crawl = (ph, moving) => {
    const s = moving ? Math.sin(ph * Math.PI * 2) : 0, c = moving ? Math.cos(ph * Math.PI * 2) : 0;
    return {
      hip: [-14, 30 + s * .8], lean: 1.32, neck: -.55, headLean: -.15, tilt: .05,
      anN: [-34 + s * 5, 7 + Math.max(0, c) * 3], faN: -1.4, anB: [-36 - s * 5, 6 + Math.max(0, -c) * 3], faB: -1.4,
      haN: [20 + s * 6, 2 + Math.max(0, s) * 4], haB: [16 - s * 6, 2 + Math.max(0, -s) * 4], flare: 1,
    };
  };
  // lying on the back on the mattress: root is at the hip, legs along +x
  R.lie = (k = 0, breath = 0) => ({
    hip: [0, 0], lean: lerp(-Math.PI / 2 + .02, .12, k) + breath * .01, neck: lerp(.1, 0, k), tilt: lerp(0, -.04, k),
    anN: [44, 1.5], faN: Math.PI / 2 - .2, anB: [43, 3], faB: Math.PI / 2 - .3,
    haN: P => add(P.hip, [lerp(-2, 10, k), lerp(4, 12, k)]), haB: P => add(P.hip, [lerp(-3, 4, k), lerp(5, 2, k)]),
  });
  R.sitBed = o => ({ // sitting up in bed, legs along the mattress; o.cough (0..1 jerk), o.hand: 'mouth' | 'look' | 'hide' | 'wipe' | null, o.u (0..1 within the gesture)
    hip: [0, 0], lean: .3 + (o.cough || 0) * .22, neck: .18 + (o.cough || 0) * .15, headLean: o.hand === 'look' ? .32 : .08, tilt: o.hand === 'look' ? -.12 : -.04,
    anN: [44, 1.5], faN: Math.PI / 2 - .2, anB: [43, 3], faB: Math.PI / 2 - .3,
    haN: o.hand ? (P => {
      const h = [P.head.x, P.head.y], u = o.u || 0;
      if (o.hand === 'mouth') return add(h, [6.5, -3.5]);
      if (o.hand === 'look') return add(h, [13, -15]);
      if (o.hand === 'hide') return lerp(0, 1, u) < .5 ? add(h, [lerp(13, 7, u * 2), lerp(-15, -24, u * 2)]) : add(P.chest, [lerp(7, 1.5, u * 2 - 1), lerp(0, -3, u * 2 - 1)]);
      if (o.hand === 'wipe') return add(h, [lerp(9, 2, u), -4]);
      return add(P.hip, [10, 12]);
    }) : P => add(P.hip, [10, 12]),
    haB: P => add(P.hip, [-4, 2]), handA: o.hand === 'look' ? -.8 : 0,
  });
  R.sitEdge = (t = 0) => ({ // sitting on the bed edge, feet on the floor (feet root)
    hip: [-15, 39], lean: .26 + Math.sin(t * 1.4) * .01, neck: .1, tilt: -.1, anN: [3, 3], anB: [-1, 3], faB: -.1,
    haN: [7, 41], haB: [-26, 39],
  });
  R.reach = (target, base) => Object.assign({}, base, { haN: target, handA: .3 });

  // Linear blend of parameter sets (only for keys both sets share as numbers/arrays).
  R.mixParams = (a, b, t) => {
    const o = Object.assign({}, b);
    for (const key in a) {
      const va = a[key], vb = b[key];
      if (typeof va === 'number' && typeof vb === 'number') o[key] = lerp(va, vb, t);
      else if (Array.isArray(va) && Array.isArray(vb)) o[key] = [lerp(va[0], vb[0], t), lerp(va[1], vb[1], t)];
      else if (t < .5 && va != null) o[key] = va;
    }
    return o;
  };

  /* ---------- greatcoat ---------- */
  R.coat = (P, lag = 0) => {
    const l = P.lean, H = P.hip, c = Math.cos(l), s = Math.sin(l), T = v => [H[0] + v[0] * c + v[1] * s, H[1] - v[0] * s + v[1] * c];
    const dN = norm(sub(P.knN, H)), dB = norm(sub(P.knB, H)); let dir = norm(add(dN, dB)); if (!isFinite(dir[0])) dir = [0, -1];
    const n = [-dir[1], dir[0]], spread = Math.acos(clamp(dN[0] * dB[0] + dN[1] * dB[1], -1, 1)), hz = Math.abs(dir[0]);
    const fl = P.flare || 0;
    const wf = lerp(12.5, 5, hz) + spread * 5, wb = lerp(13.5, 9, hz) + spread * 6 + fl * .8;
    const K = add(mul(add(P.knN, P.knB), .5), mul(dir, 5));
    const hemF = add(K, mul(n, wf)), hemR = add(add(K, mul(n, -wb)), [-lag - fl * 1.1, fl * .5 + Math.abs(lag) * .2]);
    const hemFU = add(hemF, add(mul(dir, -10), mul(n, -1))), hemRU = add(hemR, add(mul(dir, -5), mul(n, 1.6)));
    const hemMR = add(K, add(mul(n, -wb * .3), mul(dir, .8))), hemMF = add(K, add(mul(n, wf * .45), mul(dir, .8)));
    return [T([-4.1, 37.5]), T([-8.9, 31]), T([-9.7, 17]), T([-10.1, -4]), hemRU, hemR, hemMR, hemMF, hemF, hemFU, T([10.7, -1]), T([10.5, 13]), T([10.1, 24]), T([7.7, 31.5]), T([3.7, 36])];
  };

  /* ---------- frames ---------- */
  // root: {x, y, f (facing ±1), rot (local CCW), s (scale)}
  R.toWorld = (p, r) => { const c = Math.cos(r.rot || 0), s = Math.sin(r.rot || 0), u = U * (r.s || 1); return [r.x + r.f * u * (c * p[0] - s * p[1]), r.y - u * (s * p[0] + c * p[1])]; };
  R.toLocal = (w, r) => { const c = Math.cos(r.rot || 0), s = Math.sin(r.rot || 0), u = U * (r.s || 1); const qx = (w[0] - r.x) / (r.f * u), qy = -(w[1] - r.y) / u; return [c * qx + s * qy, -s * qx + c * qy]; };
  R.worldPose = (P, r) => {
    const W = { f: r.f, tilt: P.head.tilt, flare: P.flare, handA: P.handA };
    PTS.forEach(k => { W[k] = R.toWorld(P[k], r); }); W.headP = R.toWorld([P.head.x, P.head.y], r); return W;
  };
  R.blendWorld = (a, b, t) => {
    const W = { f: b.f, tilt: lerp(a.tilt, b.tilt, t), flare: lerp(a.flare, b.flare, t), handA: lerp(a.handA, b.handA, t) };
    PTS.concat(['headP']).forEach(k => { W[k] = [lerp(a[k][0], b[k][0], t), lerp(a[k][1], b[k][1], t)]; }); return W;
  };
  R.localPose = (W, r) => {
    const P = { flare: W.flare, handA: W.handA };
    PTS.forEach(k => { P[k] = R.toLocal(W[k], r); });
    const h = R.toLocal(W.headP, r); P.head = { x: h[0], y: h[1], tilt: W.tilt };
    const d = sub(P.chest, P.hip); P.lean = Math.atan2(d[0], d[1]);
    return P;
  };
  R.bbox = W => {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    PTS.concat(['headP']).forEach(k => { const p = W[k]; x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); });
    return [x0 - 40, y0 - 30, x1 + 40, y1 + 20];
  };

  // Draw a local pose P with root r into a world-space context.
  R.paint = (x, P, r, lag = 0) => {
    x.save(); x.translate(r.x, r.y); x.scale(r.f * U * (r.s || 1), -U * (r.s || 1)); if (r.rot) x.rotate(r.rot);
    const Q = Object.assign({}, P, { coat: R.coat(P, lag), capeFlare: P.flare });
    man(x, Q);
    x.restore();
  };
  // Quasi-frontal silhouette for the moment he looks into the camera.
  R.paintFront = (x, r, t = 0) => {
    x.save(); x.translate(r.x, r.y); x.scale(U * (r.s || 1), -U * (r.s || 1));
    const b = Math.sin(t * 1.4) * .25;
    limb(x, [[-5, 49], [-5.5, 26], [-5, 3]], [8.5, 6.4, 3.8]); limb(x, [[5, 49], [5.5, 26], [5, 3]], [8.5, 6.4, 3.8]);
    x.beginPath(); x.ellipse(-6, 1.6, 4.4, 2, 0, 0, 7); x.ellipse(6, 1.6, 4.4, 2, 0, 0, 7); x.fill();
    fillSpline(x, [[-6, 86 + b], [-12.5, 80 + b], [-13.5, 62], [-14, 40], [-16, 22], [-6, 20.4], [6, 20.4], [16, 22], [14, 40], [13.5, 62], [12.5, 80 + b], [6, 86 + b]], x.fillStyle, .85);
    fillSpline(x, [[-9, 84 + b], [-17.5, 76 + b], [-18.5, 64 + b], [-8, 61 + b], [0, 62 + b], [8, 61 + b], [18.5, 64 + b], [17.5, 76 + b], [9, 84 + b]], x.fillStyle, .9);
    limb(x, [[-14, 76], [-15.5, 61], [-14.5, 48]], [5.4, 4.4, 3.4]); limb(x, [[14, 76], [15.5, 61], [14.5, 48]], [5.4, 4.4, 3.4]);
    x.beginPath(); x.ellipse(0, 83.5 + b, 5.6, 3.4, 0, 0, 7); x.fill();
    x.beginPath(); x.ellipse(0, 92 + b, 5.6, 7, 0, 0, 7); x.fill();
    fillSpline(x, [[-6.4, 93 + b], [-5.6, 98.6 + b], [-1.6, 100.6 + b], [3.4, 100.4 + b], [6.6, 97.6 + b], [6.8, 92 + b], [5, 95.6 + b], [1, 97 + b], [-3.4, 96 + b]], x.fillStyle, .8);
    x.restore();
  };

  /* ---------- the hero as an animated character ---------- */
  // Holds the current parameter set and root, blends from the previous drawn pose on changes.
  R.Character = class {
    constructor(r) { this.root = Object.assign({ x: 0, y: 0, f: 1, rot: 0, s: 1 }, r); this.params = R.stand(0); this.lastW = null; this.from = null; this.bt = 1; this.bdur = .2; this.key = ''; this.lag = 0; this.vx = 0; }
    set(key, params, root, dur = .22) {
      if (key !== this.key && this.lastW) { this.from = this.lastW; this.bt = 0; this.bdur = dur; }
      this.key = key; this.params = params; if (root) Object.assign(this.root, root);
    }
    resolve(dt) {
      const P = R.build(this.params);
      let W = R.worldPose(P, this.root);
      if (this.from && this.bt < 1) { this.bt = Math.min(1, this.bt + dt / this.bdur); W = R.blendWorld(this.from, W, B.ease(this.bt)); }
      this.lastW = W;
      this.lag = B.damp(this.lag, clamp(this.vx * .035, -9, 9), 6, dt);
      return W;
    }
    draw(ctx, W, light, o = {}) {
      const r = this.root, P = R.localPose(W, r), lag = this.lag * r.f;
      B.figure(ctx, R.bbox(W), x => { R.paint(x, P, r, lag); if (o.extra) o.extra(x, P, r); }, Object.assign({ body: [7, 8, 11], grad: [16, 17, 22] }, light, o.fig || {}));
      return P;
    }
  };
})();
