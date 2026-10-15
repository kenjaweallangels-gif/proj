'use strict';
// Procedural sound: everything is synthesised with WebAudio, nothing is sampled.
// Voices are not real speech: "through the wall" lines are muffled formant murmurs, the rest is carried by subtitles.
(() => {
  const B = BD, A = B.audio = { ok: false };
  let ac, master, comp, rev, revIn, wall, music, amb, sfx, noiseBuf, brownBuf;
  const now = () => ac.currentTime;

  A.init = () => {
    if (A.ok) { if (ac.state === 'suspended') ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    ac = new AC(); A.ac = ac;
    master = ac.createGain(); master.gain.value = B.prefs.volume;
    comp = ac.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 3; comp.attack.value = .01; comp.release.value = .3;
    master.connect(comp); comp.connect(ac.destination);
    // reverb: generated impulse, a large stone room
    rev = ac.createConvolver(); const len = ac.sampleRate * 3.2, ir = ac.createBuffer(2, len, ac.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2) * (i < 1200 ? i / 1200 : 1); }
    rev.buffer = ir; revIn = ac.createGain(); revIn.gain.value = .55; revIn.connect(rev); rev.connect(master);
    const bus = (g, r) => { const n = ac.createGain(); n.gain.value = g; n.connect(master); if (r) { const s = ac.createGain(); s.gain.value = r; n.connect(s); s.connect(revIn); } return n; };
    sfx = bus(1, .18); music = bus(.8, .5); amb = bus(1, .1);
    // "through the wall": low-passed, room-reverbed
    const wl = ac.createBiquadFilter(); wl.type = 'lowpass'; wl.frequency.value = 520; wl.Q.value = .5;
    const wg = ac.createGain(); wg.gain.value = 1.4; wl.connect(wg); wg.connect(master); const ws = ac.createGain(); ws.gain.value = .6; wg.connect(ws); ws.connect(revIn);
    wall = wl;
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate); { const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    brownBuf = ac.createBuffer(1, ac.sampleRate * 4, ac.sampleRate); { const d = brownBuf.getChannelData(0); let l = 0; for (let i = 0; i < d.length; i++) { l = (l + .02 * (Math.random() * 2 - 1)) / 1.02; d[i] = l * 3.5; } }
    const box = ac.createGain(); box.gain.value = 1; box.connect(music); A.boxGain = box;
    A.buses = { sfx, music, amb, wall, rev: revIn, master, box };
    A.ok = true;
  };
  A.setVolume = v => { if (A.ok) master.gain.setTargetAtTime(v, now(), .05); };
  const D = name => (A.buses && A.buses[name]) || sfx;

  // ---- primitives ----
  function out(node, o) {
    let n = node;
    if (o.pan) { const p = ac.createStereoPanner(); p.pan.value = clamp(o.pan, -1, 1); n.connect(p); n = p; }
    n.connect(typeof o.dest === 'string' ? D(o.dest) : (o.dest || sfx));
    if (o.wet) { const s = ac.createGain(); s.gain.value = o.wet; n.connect(s); s.connect(revIn); }
  }
  function env(g, t, a, peak, d, hold = 0) { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.setValueAtTime(peak, t + a + hold); g.gain.exponentialRampToValueAtTime(.0001, t + a + hold + d); }
  A.noise = (o = {}) => {
    if (!A.ok) return; const t = now() + (o.when || 0);
    const s = ac.createBufferSource(); s.buffer = o.brown ? brownBuf : noiseBuf; s.loop = true; s.playbackRate.value = o.rate || 1;
    let n = s;
    (o.filters || [[o.type || 'bandpass', o.f || 1000, o.q || 1]]).forEach(([type, f, q, f2]) => {
      const fl = ac.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q || 1;
      if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + (o.dur || .1)); n.connect(fl); n = fl;
    });
    const g = ac.createGain(); env(g, t, o.a || .005, o.g || .3, o.dur || .1, o.hold || 0); n.connect(g); out(g, o);
    s.start(t, Math.random() * 1.5); s.stop(t + (o.a || .005) + (o.hold || 0) + (o.dur || .1) + .05);
    return g;
  };
  A.tone = (o = {}) => {
    if (!A.ok) return; const t = now() + (o.when || 0);
    const s = ac.createOscillator(); s.type = o.type || 'sine'; s.frequency.setValueAtTime(o.f || 440, t);
    if (o.f2) s.frequency.exponentialRampToValueAtTime(o.f2, t + (o.glide || o.dur || .2));
    if (o.detune) s.detune.value = o.detune;
    let n = s;
    if (o.lp) { const fl = ac.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = o.lp; fl.Q.value = o.lpq || .7; n.connect(fl); n = fl; }
    const g = ac.createGain(); env(g, t, o.a || .005, o.g || .2, o.dur || .3, o.hold || 0); n.connect(g); out(g, o);
    s.start(t); s.stop(t + (o.a || .005) + (o.hold || 0) + (o.dur || .3) + .05);
    return { osc: s, gain: g };
  };
  // A sustained voice that can be faded out later.
  function sustain(build, o) {
    const g = ac.createGain(); g.gain.value = 0; out(g, o);
    const parts = build(g);
    g.gain.setTargetAtTime(o.g || .1, now() + (o.when || 0), (o.a || 1) / 3);
    return {
      gain: g, parts,
      set: (v, tc = .5) => g.gain.setTargetAtTime(v, now(), tc),
      stop: (tc = 1) => { g.gain.setTargetAtTime(0, now(), tc / 3); setTimeout(() => parts.forEach(p => { try { p.stop(); } catch (e) { /* stopped */ } }), tc * 1000 + 600); },
    };
  }

  // ---- ambience ----
  A.amb = {};
  A.startRain = () => {
    if (!A.ok || A.amb.rain) return;
    A.amb.rain = sustain(g => {
      const s = ac.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
      const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
      const bp = ac.createBiquadFilter(); bp.type = 'peaking'; bp.frequency.value = 3200; bp.gain.value = 4;
      const pan = ac.createStereoPanner(); A.amb.rainPan = pan.pan;
      s.connect(hp); hp.connect(bp); bp.connect(pan); pan.connect(g); s.start();
      const s2 = ac.createBufferSource(); s2.buffer = brownBuf; s2.loop = true; const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300; const g2 = ac.createGain(); g2.gain.value = .5;
      s2.connect(lp); lp.connect(g2); g2.connect(g); s2.start();
      return [s, s2];
    }, { dest: amb, g: .05, a: 3 });
    A.amb.dripT = 0;
  };
  A.rainLevel = (v, pan) => { if (A.amb.rain) { A.amb.rain.set(v, .4); A.amb.rainPan.setTargetAtTime(clamp(pan, -1, 1), now(), .3); } };
  A.startRoom = () => {
    if (!A.ok || A.amb.room) return;
    A.amb.room = sustain(g => { const s = ac.createBufferSource(); s.buffer = brownBuf; s.loop = true; const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160; s.connect(lp); lp.connect(g); s.start(); return [s]; }, { dest: amb, g: .05, a: 2 });
  };
  A.stopAmb = (name, tc = 1.5) => { if (A.amb[name]) { A.amb[name].stop(tc); A.amb[name] = null; } };
  // per-frame: fire crackle and window drips
  A.update = (dt, st) => {
    if (!A.ok) return;
    if (st.fire > 0.02 && Math.random() < dt * 9) A.noise({ type: 'bandpass', f: 1500 + Math.random() * 3000, q: 1.5, g: .05 * st.fire * (.3 + Math.random()), dur: .02 + Math.random() * .03, pan: st.firePan, dest: 'amb' });
    if (st.fire > 0.02 && Math.random() < dt * 1.2) A.noise({ type: 'lowpass', f: 400, g: .06 * st.fire, dur: .15, pan: st.firePan, dest: 'amb' });
    if (st.rain > 0.02 && Math.random() < dt * 5) A.tone({ f: 2400 + Math.random() * 2400, f2: 1400, dur: .03, g: .012 * st.rain, pan: st.rainPan, dest: 'amb' });
  };

  // ---- foley ----
  A.tick = (v = 1, pan = 0) => { A.noise({ type: 'bandpass', f: 3800, q: 6, g: .25 * v, dur: .02, pan }); A.tone({ f: 2100, f2: 1900, dur: .05, g: .05 * v, pan }); A.tone({ f: 6200, dur: .015, g: .03 * v, pan }); };
  A.tickHard = () => { A.noise({ type: 'bandpass', f: 2600, q: 4, g: .9, dur: .05 }); A.tone({ f: 1500, f2: 900, dur: .12, g: .25 }); A.noise({ type: 'lowpass', f: 300, g: .5, dur: .08 }); };
  A.clap = (v, pan, muffled) => A.noise({ filters: [['bandpass', 900 + Math.random() * 1500, .8 + Math.random()]], g: v, dur: .03 + Math.random() * .04, a: .002, pan, dest: muffled ? 'wall' : 'sfx', wet: muffled ? 0 : .25 });
  // Applause: many clappers, optional abrupt cut at the end ("на полухлопке").
  A.applauseRun = (dur, o = {}) => { // spread over time so the cut is audible
    if (!A.ok) return { stop() {} };
    let alive = true; const t0 = performance.now();
    const step = () => {
      if (!alive) return; const el = (performance.now() - t0) / 1000; if (el > dur) return;
      const sw = o.swell ? Math.min(1, el / (o.swell)) : 1, k = Math.round((o.rate || 60) * .05);
      for (let i = 0; i < k; i++) A.noise({ filters: [['bandpass', 900 + Math.random() * 1600, .8 + Math.random()]], g: (o.g || .12) * sw * (.35 + Math.random() * .65), dur: .025 + Math.random() * .04, a: .002, when: Math.random() * .05, pan: (Math.random() * 2 - 1) * .85, dest: o.muffled ? 'wall' : 'sfx', wet: o.muffled ? 0 : .3 });
      setTimeout(step, 50);
    };
    step();
    return { stop: () => { alive = false; } };
  };
  A.step = (x, v = 1, pan = 0) => {
    const board = Math.floor(x / 46), h = B.hash(board);
    A.tone({ f: 95 + h * 30, f2: 50, dur: .09, g: .16 * v, pan, lp: 400 });
    A.noise({ type: 'bandpass', f: 600 + h * 500, q: 1.2, g: .05 * v, dur: .04, pan });
    if (h > .62) A.tone({ type: 'sawtooth', f: 260 + h * 520, f2: 240 + h * 380, dur: .18 + h * .1, g: .012 * v, pan, lp: 1400, a: .03, wet: .2 });
  };
  A.stepMetal = (v = 1, pan = 0) => { A.tone({ f: 120, f2: 70, dur: .08, g: .12 * v, pan }); A.tone({ f: 1800 + Math.random() * 300, dur: .2, g: .02 * v, pan, wet: .4 }); A.noise({ type: 'highpass', f: 2500, g: .04 * v, dur: .03, pan }); };
  A.inhale = () => A.noise({ filters: [['bandpass', 700, 2, 2100]], g: .22, a: .25, dur: .4, hold: .1 });
  A.exhale = (v = .1) => A.noise({ filters: [['bandpass', 1100, 1.5, 500]], g: v, a: .05, dur: .5 });
  A.cough = (strength = 1, when = 0) => {
    // a wet, rattling cough: chest thump + throat burst + rasp
    A.tone({ f: 120, f2: 70, dur: .12, g: .22 * strength, when, lp: 300 });
    A.noise({ filters: [['bandpass', 600 + Math.random() * 300, 1.2], ['lowpass', 2400, .7]], g: .5 * strength, a: .01, dur: .22, when });
    A.noise({ filters: [['bandpass', 1600, 3], ['lowpass', 3000, .7]], g: .12 * strength, a: .02, dur: .3, when: when + .05 });
    A.tone({ type: 'sawtooth', f: 85, f2: 60, dur: .25, g: .05 * strength, when: when + .06, lp: 700 });
  };
  A.coughFit = () => { const ts = [0, .42, .78, 1.25, 1.62, 1.95, 2.5]; ts.forEach((t, i) => A.cough(i === 0 ? 1.1 : .7 + Math.random() * .4, t)); A.noise({ filters: [['bandpass', 900, 1.5, 1600]], g: .18, a: .3, dur: .5, when: 3.05 }); };
  A.springs = (v = 1) => { for (let i = 0; i < 3; i++) A.tone({ type: 'triangle', f: 700 + i * 140 + Math.random() * 80, f2: 600, dur: .25, g: .02 * v, when: i * .07, wet: .3 }); };
  A.creak = (o = {}) => {
    if (!A.ok) return; const t = now() + (o.when || 0), d = o.dur || 1.2;
    const s = ac.createOscillator(); s.type = 'sawtooth'; s.frequency.setValueAtTime(o.f || 180, t);
    s.frequency.linearRampToValueAtTime(o.f2 || 420, t + d * .45); s.frequency.linearRampToValueAtTime(o.f3 || 260, t + d);
    const am = ac.createOscillator(); am.frequency.value = o.stick || 32; const amg = ac.createGain(); amg.gain.value = .5; am.connect(amg);
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = o.bp || 900; bp.Q.value = 6;
    const g = ac.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(o.g || .06, t + .1); g.gain.setValueAtTime(o.g || .06, t + d - .2); g.gain.linearRampToValueAtTime(0, t + d);
    const g2 = ac.createGain(); g2.gain.value = .5; amg.connect(g2.gain);
    s.connect(bp); bp.connect(g2); g2.connect(g); out(g, { pan: o.pan, wet: .4 });
    s.start(t); am.start(t); s.stop(t + d + .1); am.stop(t + d + .1);
  };
  A.scrape = (v = 1, pan = 0) => { A.noise({ filters: [['bandpass', 380, 2], ['peaking', 900, 3]], g: .25 * v, a: .03, dur: .28, pan, rate: .6 }); A.tone({ f: 70, f2: 55, dur: .2, g: .1 * v, pan }); };
  A.thud = (v = 1) => { A.tone({ f: 80, f2: 38, dur: .25, g: .4 * v, lp: 300 }); A.noise({ type: 'lowpass', f: 500, g: .25 * v, dur: .15 }); };
  A.groan = () => { A.tone({ type: 'sawtooth', f: 98, f2: 84, dur: .45, a: .06, g: .05, lp: 520 }); A.noise({ filters: [['bandpass', 500, 2]], g: .04, a: .05, dur: .4 }); };
  A.puff = (pan = 0, v = 1) => A.noise({ type: 'lowpass', f: 900, g: .3 * v, a: .02, dur: .25, pan, wet: .4 });
  A.pole = (pan = 0, v = 1, when = 0) => { A.tone({ f: 820, f2: 520, dur: .06, g: .1 * v, pan, wet: .5, when }); A.noise({ type: 'bandpass', f: 2000, q: 3, g: .08 * v, dur: .02, pan, when }); };
  A.ratchet = (pan = 0) => { A.noise({ type: 'highpass', f: 3000, g: .12, dur: .015, pan }); A.tone({ f: 2400 + Math.random() * 400, dur: .08, g: .03, pan, wet: .3 }); };
  A.rumble = (dur = 2, v = 1) => { A.noise({ filters: [['lowpass', 180, 1]], g: .3 * v, a: .3, dur: dur, hold: 0, brown: true }); A.noise({ filters: [['bandpass', 420, 18]], g: .08 * v, a: .4, dur: dur * .9 }); A.noise({ filters: [['bandpass', 1130, 25]], g: .04 * v, a: .5, dur: dur * .8 }); };
  A.clang = (v = 1) => { [221, 563, 891, 1333, 1785].forEach((f, i) => A.tone({ f, dur: 1.6 - i * .2, g: .1 * v / (i + 1), wet: .6 })); A.noise({ type: 'lowpass', f: 1200, g: .4 * v, dur: .12 }); A.thud(.8 * v); };
  A.doorCreak = () => { A.creak({ f: 160, f2: 380, f3: 230, dur: 2.2, g: .05, stick: 28, bp: 800, pan: .4 }); A.creak({ f: 330, f2: 540, f3: 410, dur: 1.4, g: .02, stick: 41, bp: 1500, when: .3, pan: .4 }); };
  A.whoosh = (dur = 1.6, up = true) => A.noise({ filters: [['bandpass', up ? 200 : 3000, 1.2, up ? 3200 : 180]], g: .3, a: dur * .6, dur: dur * .4 });
  A.rewind = () => { A.noise({ filters: [['bandpass', 400, 3, 4000]], g: .2, a: .2, dur: 1.1 }); for (let i = 0; i < 14; i++) A.tone({ f: 600 + i * 120, f2: 300, dur: .06, g: .03, when: i * .08 }); };
  A.inkDrop = () => { A.tone({ f: 1400, f2: 260, dur: .09, g: .25, wet: .7 }); A.noise({ type: 'lowpass', f: 700, g: .1, dur: .1, when: .02 }); };
  A.shimmer = (n = 12) => { for (let i = 0; i < n; i++) A.tone({ f: 1200 + Math.random() * 2400, dur: .8, g: .02, a: .05, when: i * .07, wet: .8, pan: Math.random() * 2 - 1 }); };
  A.strand = () => { for (let i = 0; i < 5; i++) A.tone({ f: 2093 * Math.pow(2, i * 3 / 12), dur: 1.2, g: .025, a: .02, when: i * .09, wet: .8 }); };
  A.uiTick = () => A.tone({ f: 1800, dur: .04, g: .03 });

  // ---- voices ----
  const VOWELS = 'аеёиоуыэюяАЕЁИОУЫЭЮЯ';
  const FORMANTS = { а: [750, 1200], о: [500, 850], у: [350, 700], э: [520, 1800], и: [300, 2200], ы: [380, 1500] };
  const vowelOf = ch => ({ а: 'а', я: 'а', о: 'о', ё: 'о', у: 'у', ю: 'у', э: 'э', е: 'э', и: 'и', ы: 'ы' })[ch.toLowerCase()] || 'э';
  // Muffled speech: a glottal source through moving formants, one syllable per vowel of the line.
  A.murmur = (text, o = {}) => {
    if (!A.ok) return 0;
    const syl = [...text].filter(c => VOWELS.includes(c)).map(vowelOf); const t0 = now() + (o.when || 0);
    const sd = o.syl || .17, f0 = o.f0 || 110, dur = syl.length * sd + .2;
    const src = ac.createOscillator(); src.type = 'sawtooth';
    src.frequency.setValueAtTime(f0 * 1.08, t0); src.frequency.linearRampToValueAtTime(f0 * (o.rise ? 1.25 : .86), t0 + dur);
    const vib = ac.createOscillator(); vib.frequency.value = 5.2; const vg = ac.createGain(); vg.gain.value = f0 * .015; vib.connect(vg); vg.connect(src.frequency);
    const breath = ac.createBufferSource(); breath.buffer = noiseBuf; breath.loop = true; const bg = ac.createGain(); bg.gain.value = o.breathy || .15;
    const f1 = ac.createBiquadFilter(), f2 = ac.createBiquadFilter(); f1.type = f2.type = 'bandpass'; f1.Q.value = 6; f2.Q.value = 8;
    const mix = ac.createGain(); mix.gain.value = 1; src.connect(mix); breath.connect(bg); bg.connect(mix);
    const sum = ac.createGain(); mix.connect(f1); mix.connect(f2); f1.connect(sum); const f2g = ac.createGain(); f2g.gain.value = .5; f2.connect(f2g); f2g.connect(sum);
    const g = ac.createGain(); g.gain.setValueAtTime(0, t0);
    syl.forEach((v, i) => {
      const t = t0 + .1 + i * sd * (1 + (Math.random() - .5) * .3), [a, b] = FORMANTS[v];
      f1.frequency.setTargetAtTime(a * (o.fShift || 1), t, .03); f2.frequency.setTargetAtTime(b * (o.fShift || 1), t, .03);
      const pk = (o.g || .5) * (i === 0 ? 1 : .75 + Math.random() * .3);
      g.gain.setTargetAtTime(pk, t, .025); g.gain.setTargetAtTime(pk * .25, t + sd * .62, .03);
    });
    g.gain.setTargetAtTime(0, t0 + dur, .05);
    sum.connect(g); out(g, { dest: o.dest || 'wall', pan: o.pan });
    [src, vib, breath].forEach(n => { n.start(t0); n.stop(t0 + dur + .4); });
    return dur;
  };
  // Whisper: unvoiced formant noise, dry and centred, close to the listener.
  A.whisper = (text, o = {}) => {
    if (!A.ok) return; const syl = [...text].filter(c => VOWELS.includes(c)).map(vowelOf); const sd = o.syl || .26; let t = now() + .02;
    syl.forEach((v, i) => {
      const [a, b] = FORMANTS[v];
      A.noise({ filters: [['bandpass', a, 5]], g: .5, a: .04, hold: sd * .4, dur: sd * .5, when: t - now(), dest: master });
      A.noise({ filters: [['bandpass', b, 7]], g: .35, a: .04, hold: sd * .4, dur: sd * .5, when: t - now(), dest: master });
      A.noise({ filters: [['highpass', 4500, .7]], g: .1, a: .01, dur: .07, when: t - now() - .04, dest: master });
      t += sd * (i === syl.length - 1 ? 1.4 : 1);
    });
  };

  // ---- music ----
  const NOTE = n => 440 * Math.pow(2, (n - 69) / 12);
  A.NOTE = NOTE;
  // music box tine: fundamental + inharmonic partials, slow decay; last note may be out of tune
  A.boxNote = (midi, o = {}) => {
    const f = NOTE(midi) * Math.pow(2, (o.cents || 0) / 1200);
    A.tone({ f, dur: 2.4, g: .09 * (o.v || 1), a: .002, dest: 'box', when: o.when, pan: o.pan });
    A.tone({ f: f * 2.76, dur: .9, g: .03 * (o.v || 1), a: .002, dest: 'box', when: o.when, pan: o.pan });
    A.tone({ f: f * 5.4, dur: .35, g: .012 * (o.v || 1), a: .001, dest: 'box', when: o.when, pan: o.pan });
    A.noise({ type: 'highpass', f: 5000, g: .03 * (o.v || 1), dur: .01, when: o.when, dest: 'box', pan: o.pan });
  };
  A.boxCut = () => { if (A.ok) { A.boxGain.gain.cancelScheduledValues(now()); A.boxGain.gain.setValueAtTime(A.boxGain.gain.value, now()); A.boxGain.gain.linearRampToValueAtTime(0, now() + .04); } };
  A.boxOpen = () => { if (A.ok) { A.boxGain.gain.cancelScheduledValues(now()); A.boxGain.gain.setValueAtTime(1, now()); } };
  A.celesta = (midi, o = {}) => {
    const f = NOTE(midi);
    A.tone({ f, dur: 1.8, g: .08 * (o.v || 1), a: .003, dest: 'music', when: o.when });
    A.tone({ f: f * 4, dur: .5, g: .025 * (o.v || 1), a: .002, dest: 'music', when: o.when });
    A.tone({ f: f * 2, dur: 1.1, g: .02 * (o.v || 1), a: .002, dest: 'music', when: o.when });
  };
  A.pad = (midis, o = {}) => {
    if (!A.ok) return { stop() {}, set() {} };
    return sustain(g => {
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = o.lp || 900; lp.Q.value = .6; lp.connect(g);
      const parts = [];
      midis.forEach((m, i) => [-1, 1].forEach(d => {
        const s = ac.createOscillator(); s.type = o.type || 'sawtooth'; s.frequency.value = NOTE(m); s.detune.value = d * (o.det || 7) + (Math.random() - .5) * 4;
        const v = ac.createOscillator(); v.frequency.value = 4.6 + Math.random(); const vg = ac.createGain(); vg.gain.value = o.vib || 3; v.connect(vg); vg.connect(s.detune);
        const sg = ac.createGain(); sg.gain.value = 1 / (midis.length * 2) * (o.weights ? o.weights[i] : 1); s.connect(sg); sg.connect(lp); s.start(); v.start(); parts.push(s, v);
      }));
      return parts;
    }, { dest: 'music', g: o.g || .08, a: o.a || 3 });
  };
  A.choir = (midis, o = {}) => {
    if (!A.ok) return { stop() {}, set() {} };
    return sustain(g => {
      const parts = [];
      const f1 = ac.createBiquadFilter(), f2 = ac.createBiquadFilter(), f3 = ac.createBiquadFilter(); f1.type = f2.type = f3.type = 'bandpass';
      f1.frequency.value = o.vowel === 'u' ? 350 : 700; f2.frequency.value = o.vowel === 'u' ? 800 : 1150; f3.frequency.value = 2700; f1.Q.value = 4; f2.Q.value = 5; f3.Q.value = 8;
      const s1 = ac.createGain(); s1.gain.value = 1; const s2 = ac.createGain(); s2.gain.value = .6; const s3 = ac.createGain(); s3.gain.value = .15;
      f1.connect(s1); f2.connect(s2); f3.connect(s3); s1.connect(g); s2.connect(g); s3.connect(g);
      midis.forEach(m => [-1, 0, 1].forEach(d => {
        const s = ac.createOscillator(); s.type = 'sawtooth'; s.frequency.value = NOTE(m); s.detune.value = d * 9 + (Math.random() - .5) * 6;
        const v = ac.createOscillator(); v.frequency.value = 5 + Math.random() * .8; const vg = ac.createGain(); vg.gain.value = 6; v.connect(vg); vg.connect(s.detune);
        const sg = ac.createGain(); sg.gain.value = 1 / (midis.length * 3); s.connect(sg); sg.connect(f1); sg.connect(f2); sg.connect(f3); s.start(); v.start(); parts.push(s, v);
      }));
      return parts;
    }, { dest: 'music', g: o.g || .12, a: o.a || 4 });
  };
  A.harmonica = (midi, o = {}) => {
    if (!A.ok) return { stop() {}, set() {} };
    return sustain(g => {
      const f = NOTE(midi); const parts = [];
      [0, o.beat || 2.6].forEach(d => { const s = ac.createOscillator(); s.frequency.value = f + d; const sg = ac.createGain(); sg.gain.value = .5; s.connect(sg); sg.connect(g); s.start(); parts.push(s); });
      const s3 = ac.createOscillator(); s3.frequency.value = f * 2.01; const g3 = ac.createGain(); g3.gain.value = .08; s3.connect(g3); g3.connect(g); s3.start(); parts.push(s3);
      return parts;
    }, { dest: 'music', g: o.g || .05, a: o.a || 2.5 });
  };
  // Dido's lament ground bass (D–C♯–C–B–B♭–A), each round faster.
  A.dido = (o = {}) => {
    if (!A.ok) return { stop() {}, speed: 1 };
    const notes = [50, 49, 48, 47, 46, 45]; const h = { alive: true, speed: o.speed || 1, round: 0 };
    let t = now() + .1;
    const sched = () => {
      if (!h.alive) return;
      while (t < now() + 1.2) {
        const dur = 1.05 / h.speed;
        notes.forEach((m, i) => {
          const f = NOTE(m - 12), tt = t + i * dur;
          const s = ac.createOscillator(); s.type = 'sawtooth'; s.frequency.value = f; const s2 = ac.createOscillator(); s2.type = 'sawtooth'; s2.frequency.value = f * 2.003;
          const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2; lp.frequency.setValueAtTime(180, tt); lp.frequency.linearRampToValueAtTime(900, tt + .12); lp.frequency.exponentialRampToValueAtTime(260, tt + dur);
          const g = ac.createGain(); g.gain.setValueAtTime(0, tt); g.gain.linearRampToValueAtTime(o.g || .12, tt + .06); g.gain.setValueAtTime(o.g || .12, tt + dur * .8); g.gain.linearRampToValueAtTime(0, tt + dur);
          const g2 = ac.createGain(); g2.gain.value = .35; s.connect(lp); s2.connect(g2); g2.connect(lp); lp.connect(g); out(g, { dest: 'music' });
          s.start(tt); s2.start(tt); s.stop(tt + dur + .05); s2.stop(tt + dur + .05);
          // the pole on the floor, written into the rhythm
          if (o.pole && i % 2 === 0) A.pole(-.3, .7, Math.max(0, tt - now()));
        });
        t += notes.length * dur; h.round++; h.speed *= o.accel || 1.08;
      }
      setTimeout(sched, 300);
    };
    sched();
    h.stop = () => { h.alive = false; };
    return h;
  };
})();
