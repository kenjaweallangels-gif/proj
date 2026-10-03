// Голоса персонажей на вымышленном языке Ракиса (Ред. 2).
// ОСНОВНОЙ путь: встроенные записи нейросетевого TTS Piper (assets/vo.js, см. vo_bank.js): позиционный источник в точке говорящего
// (спутник / ближайший житель сиетча подходящего архетипа), реверберация зоны, дакинг музыки и фона. Лай толпы — тихие безсловесные «бормотания».
// ЗАПАСНЫЕ пути (только если у реплики нет записи): режимы (game.settings.voiceMode) 'auto' — арабский TTS браузера, иначе формантный синтезатор;
// 'tts', 'synth' (принудительно синтезатор, для отладки), 'off'.
// Синтезатор: глоттальный источник → форманты ← дорожки из speechplan.js; смягчён (тише) — это запасной вариант, а не основной голос.
// Русский/английский текст не озвучивается никогда, кроме галаха (перевод голосом TTS браузера).
import { planUtterance, FR, voiceOf, VOICES } from './speechplan.js';
import * as bank from './vo_bank.js';

const waveCache = new WeakMap();
function glottal(ctx, tilt) {
  let m = waveCache.get(ctx); if (!m) { m = new Map(); waveCache.set(ctx, m); }
  const key = Math.round(tilt * 10);
  if (m.has(key)) return m.get(key);
  const n = 48, real = new Float32Array(n + 1), imag = new Float32Array(n + 1);
  const ex = 0.85 + tilt * 1.1;                       // наклон спектра: резкий голос → мягкий
  for (let k = 1; k <= n; k++) { imag[k] = 1 / Math.pow(k, ex); real[k] = (k % 2 ? 1 : -0.4) * 0.15 / Math.pow(k, ex + 0.2); }
  const w = ctx.createPeriodicWave(real, imag);
  m.set(key, w);
  return w;
}
const noiseCache = new WeakMap();
function noiseBuffer(ctx) {
  let b = noiseCache.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = b.getChannelData(0); let s = 12345;
    for (let i = 0; i < d.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; d[i] = (s / 4294967296) * 2 - 1; }
    noiseCache.set(ctx, b);
  }
  return b;
}

// Калибровка уровней (замер renderOffline: гласные ≈ −20 дБFS RMS).
const K_VOICE = 1.1, K_ASP = 2.5, K_FRIC = 0.016;

/** Строит граф речи и расписывает дорожки. out — узел назначения. Возвращает {stop(), end, nodes}. */
export function playPlan(ctx, out, plan, { when, offset = 0, gain = 1 } = {}) {
  const V = plan.voice;
  const t0 = (when ?? ctx.currentTime) + 0.03;
  const skip = Math.max(0, Math.floor(offset * FR));
  const part = (a) => (skip ? a.subarray(Math.min(skip, a.length - 2)) : a);
  const tr = {}; for (const k of Object.keys(plan.tracks)) tr[k] = part(plan.tracks[k]);
  const len = tr.f0.length, dur = (len - 1) / FR;
  const curve = (param, arr, mul = 1) => {
    const c = mul === 1 ? arr : arr.map((v) => v * mul);
    param.setValueCurveAtTime(c, t0, dur);
  };

  const mix = ctx.createGain(); mix.gain.value = 0; mix.gain.setValueAtTime(0, t0); mix.gain.linearRampToValueAtTime((V.amp ?? 1) * gain, t0 + 0.02);
  // источник
  const osc = ctx.createOscillator(); osc.setPeriodicWave(glottal(ctx, V.tilt ?? 0.5));
  curve(osc.frequency, tr.f0);
  const voicedG = ctx.createGain(); voicedG.gain.value = 0; curve(voicedG.gain, tr.av, K_VOICE);
  const noise = ctx.createBufferSource(); noise.buffer = noiseBuffer(ctx); noise.loop = true;
  const ahG = ctx.createGain(); ahG.gain.value = 0; curve(ahG.gain, tr.ah, K_ASP);
  const excite = ctx.createGain();
  osc.connect(voicedG); voicedG.connect(excite); noise.connect(ahG); ahG.connect(excite);
  // форманты
  const sum = ctx.createGain(), upper = ctx.createGain(); upper.gain.value = 1; curve(upper.gain, tr.fg);
  const mk = (q, arr, dest, g = 1) => {
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = q;
    if (arr) curve(f.frequency, arr); else f.frequency.value = g;
    excite.connect(f); f.connect(dest); return f;
  };
  const f1 = mk(7, tr.f1, sum);
  const f2 = mk(9, tr.f2, upper), f3 = mk(11, tr.f3, upper);
  const f4 = ctx.createBiquadFilter(); f4.type = 'bandpass'; f4.Q.value = 14; f4.frequency.value = 3600 * (V.fs || 1); excite.connect(f4);
  const g4 = ctx.createGain(); g4.gain.value = 0.5; f4.connect(g4); g4.connect(upper);
  upper.connect(sum);
  if (V.nasal > 0.05) { // носовая резонанс-полоса ~1 кГц
    const nz = ctx.createBiquadFilter(); nz.type = 'bandpass'; nz.frequency.value = 1050; nz.Q.value = 4;
    const ng = ctx.createGain(); ng.gain.value = V.nasal * 0.9; excite.connect(nz); nz.connect(ng); ng.connect(sum);
  }
  // фрикативы / взрывы
  const fric = ctx.createBiquadFilter(); fric.type = 'bandpass'; fric.Q.value = 1.2; curve(fric.frequency, tr.ff);
  const afG = ctx.createGain(); afG.gain.value = 0; curve(afG.gain, tr.af, K_FRIC);
  noise.connect(fric); fric.connect(afG);
  // тембр и выход
  const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = V.murmur ? 2600 : 6500; tone.Q.value = 0.5;
  sum.connect(tone); afG.connect(tone); tone.connect(mix); mix.connect(out);
  osc.start(t0); noise.start(t0, Math.random());
  const endT = t0 + dur + 0.05;
  osc.stop(endT); noise.stop(endT);
  let stopped = false;
  return {
    end: endT,
    stop(fade = 0.06) {
      if (stopped) return; stopped = true;
      const t = ctx.currentTime;
      try { mix.gain.cancelScheduledValues(t); mix.gain.setValueAtTime(mix.gain.value, t); mix.gain.linearRampToValueAtTime(0, t + fade); osc.stop(t + fade + 0.02); noise.stop(t + fade + 0.02); } catch { /* уже остановлен */ }
    },
  };
}

/** Офлайн-рендер реплики (проверка графа): → {rms, peak, speechRms, seconds, buffer}. */
export async function renderOffline(o = {}) {
  const OAC = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!OAC) return null;
  const sr = o.sampleRate || 22050;
  const plan = planUtterance(o);
  const secs = plan.dur + 0.3;
  const ctx = new OAC(1, Math.ceil(sr * secs), sr);
  playPlan(ctx, ctx.destination, plan, { when: 0 });
  const buf = await ctx.startRendering();
  const d = buf.getChannelData(0);
  let sum = 0, peak = 0, n = 0, sp = 0, sn = 0;
  const lim = Math.floor(plan.speakEnd * sr);
  for (let i = 0; i < d.length; i++) {
    const v = d[i]; sum += v * v; n++; if (Math.abs(v) > peak) peak = Math.abs(v);
    if (i < lim) { sp += v * v; sn++; }
  }
  const db = (x) => (x > 1e-9 ? 20 * Math.log10(x) : -180);
  return { rms: db(Math.sqrt(sum / n)), peak: db(peak), speechRms: db(Math.sqrt(sp / Math.max(1, sn))), seconds: secs, buffer: buf, plan };
}

// ------------------------------------------------------------------ Интеграция с игрой
const SYNTH_ONLY = new Set(['Priestess', 'Crowd', 'Child']);
// Запасной синтезатор для жителей без собственной настройки.
const SYNTH_ALIAS = { Trader: 'Kair', Carrier: 'Ilva', Weaver: 'Ilva', Mother: 'Ilva', Child: 'Child', Girl: 'Child', Elder: 'Harmat', Youth: 'Rayn', Pilgrim: 'Ilva' };
const SYNTH_GAIN = 0.6;            // запасной синтезатор тише записей
// Какие архетипы толпы подходят говорящему (для привязки голоса к реальному жителю сиетча).
const NPC_ARCH = { Trader: ['Trader'], Carrier: ['WaterCarrier'], Weaver: ['Weaver', 'Artisan'], Mother: ['Weaver', 'WaterCarrier', 'Pilgrim'], Child: ['Child'], Girl: ['Child'],
  Elder: ['Elder'], Youth: ['Artisan', 'Trader', 'Guard'], Pilgrim: ['Pilgrim'], Guard: ['Guard'], Crowd: [] };
const BARK_GAIN = 0.34;

export function createVoice(game, eng) {
  const { ctx } = eng;
  const S = game.settings;
  let cur = null;                // {id, speaker, handles[], startedAt, duration, pos, mode, tok, clip:{src,gain,panner}}
  let tok = 0;
  let ttsVoices = [];
  const barkVoices = new Set();  // активные лай-источники (чтобы не копились)
  const lastBark = {};
  const assigned = new Map();    // `${chain}:${speaker}` → житель
  let assignedChain = null;
  const tts = typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';
  if (tts) {
    const load = () => { try { ttsVoices = speechSynthesis.getVoices() || []; } catch { ttsVoices = []; } };
    load();
    try { speechSynthesis.addEventListener?.('voiceschanged', load); } catch { /* нет */ }
  }
  const arVoice = () => ttsVoices.find((v) => /^ar([-_]|$)/i.test(v.lang || '')) || null;

  function mode() {
    if (S.autotest && !S.voiceForce) return 'off';
    if (S.voiceMode) return S.voiceMode;
    return S.voice === false ? 'off' : 'auto';
  }

  // ---- Позиции говорящих ----
  function playerPos() { return game.player?.position || game.camera?.position || null; }
  /** Ближайший к игроку житель сиетча подходящего архетипа; закрепляется за говорящим на время цепочки. */
  function npcFor(speaker, chain) {
    const crowd = game.sietch?.crowd, sctx = game.sietch?.ctx;
    const arch = NPC_ARCH[speaker];
    if (!crowd?.npcs || !sctx?.toWorld || game.space !== 'sietch') return null;
    if (chain !== assignedChain) { assigned.clear(); assignedChain = chain; }
    const key = `${chain}:${speaker}`;
    const had = assigned.get(key);
    if (had && crowd.npcs.includes(had)) return had;
    const pp = playerPos();
    if (!pp) return null;
    const taken = new Set(assigned.values());
    let best = null, bd = 22;
    for (const q of crowd.npcs) {
      if (q.special || taken.has(q)) continue;
      if (arch && arch.length && !arch.includes(q.arch)) continue;
      const w = sctx.toWorld(q.x, q.y, q.z);
      const d = Math.hypot(w.x - pp.x, w.z - pp.z);
      if (d < bd) { bd = d; best = q; }
    }
    if (best) assigned.set(key, best);
    return best;
  }
  function npcWorld(n) {
    const w = game.sietch.ctx.toWorld(n.x, n.y + (n.lk?.height ?? 1.7) * 0.93, n.z);
    return { x: w.x, y: w.y, z: w.z };
  }
  /** Позиция голоса: явная → персонаж (спутник/особая фигура) → житель → точка рядом с игроком (слева/справа по хешу). */
  function posOf(speaker, hint, chain) {
    if (hint) return hint;
    const g = game;
    const sp = (m) => { try { return m?.speakerPos?.(speaker) || null; } catch { return null; } };
    const sp2 = (m, id) => { try { return m?.speakerPos?.(id) || null; } catch { return null; } };
    if (speaker === 'Rider' || speaker === 'Rider1' || speaker === 'Rider2') return sp(g.worm) || g.worm?.riderPos || null;
    let named = g.space === 'sietch' ? (sp(g.sietch) || sp(g.companions)) : (sp(g.companions) || sp(g.sietch));
    // страж у шлюза далеко от галереи: для сцен стражи в других залах берём ближайшего стража-жителя
    if (named && NPC_ARCH[speaker]?.length && playerPos() && Math.hypot(named.x - playerPos().x, named.z - playerPos().z) > 28) named = null;
    if (named) return named;
    if (speaker === 'Ossana' && g.space === 'sietch') {   // в зале Оссана стоит рядом с наибом
      const h = sp2(g.sietch, 'Harmat');
      if (h) return { x: h.x + 1.4, y: h.y, z: h.z + 0.6 };
    }
    if (NPC_ARCH[speaker]) {
      const n = npcFor(speaker, chain);
      if (n) return npcWorld(n);
      const pp = playerPos();
      if (pp) { // нет подходящего жителя рядом: голос «из-за угла», 4–7 м от игрока
        const h = (speaker.charCodeAt(0) * 7 + speaker.length * 13) % 360, ang = (g.player?.yaw ?? 0) + (h / 360) * Math.PI * 1.4 - 0.7 * Math.PI;
        const r = 4 + (h % 4);
        return { x: pp.x + Math.cos(ang) * r, y: (pp.y ?? 0) + 1.5, z: pp.z + Math.sin(ang) * r };
      }
    }
    return null;
  }

  function stop(fade = 0.08) {
    tok++;
    if (!cur) return;
    for (const h of cur.handles || []) h.stop(fade);
    if (cur.clip) {
      const c = cur.clip, t = ctx.currentTime;
      try { c.gain.gain.cancelScheduledValues(t); c.gain.gain.setValueAtTime(c.gain.gain.value, t); c.gain.gain.linearRampToValueAtTime(0, t + fade); c.src.stop(t + fade + 0.02); } catch { /* уже остановлен */ }
      setTimeout(() => { try { c.gain.disconnect(); c.panner?.disconnect(); } catch { /* нет */ } }, (fade + 0.3) * 1000);
    }
    if (cur.tts && tts) { try { speechSynthesis.cancel(); } catch { /* нет */ } }
    cur = null;
  }

  function mkPanner(pos, out) {
    const p = ctx.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse';
    p.refDistance = 2.2; p.rolloffFactor = 1.35; p.maxDistance = 120;
    setPan(p, pos);
    p.connect(out);
    return p;
  }
  function setPan(p, pos, smooth = false) {
    const x = pos.x, y = pos.y ?? 0, z = pos.z, t = ctx.currentTime;
    if (p.positionX) {
      if (smooth) { p.positionX.setTargetAtTime(x, t, 0.08); p.positionY.setTargetAtTime(y, t, 0.08); p.positionZ.setTargetAtTime(z, t, 0.08); }
      else { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; }
    } else p.setPosition(x, y, z);
  }

  // ---- Запись из банка ----
  function startClip(buf, offset, pos, gainMul = 1, sendAmt = 0.22) {
    const src = ctx.createBufferSource(); src.buffer = buf;
    const g = ctx.createGain(); const t0 = ctx.currentTime + 0.01;
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(gainMul, t0 + 0.012);
    src.connect(g);
    let panner = null;
    if (pos) { panner = mkPanner({ x: pos.x, y: pos.y ?? 0, z: pos.z }, eng.bus.vo); g.connect(panner); } else g.connect(eng.bus.vo);
    eng.send(g, sendAmt);
    src.start(t0, Math.min(Math.max(0, offset), Math.max(0, buf.duration - 0.05)));
    return { src, gain: g, panner };
  }

  function startSynth(o, offset = 0, pos = null) {
    const speaker = o.speaker || 'Kair';
    const base = VOICES[speaker] ? speaker : (SYNTH_ALIAS[speaker] || 'Kair');
    const layers = base === 'Crowd' ? [{ seed: 1, voice: { f0: 120 } }, { seed: 7, voice: { f0: 170, rate: 1.15 } }] : [{ seed: 0, voice: o.voice }];
    const dest = ctx.createGain(); dest.gain.value = 1;
    let node = dest;
    if (pos) {
      const p = ctx.createPanner(); p.panningModel = 'equalpower'; p.distanceModel = 'inverse';
      p.refDistance = 2.5; p.rolloffFactor = 1.4; p.maxDistance = 120;
      if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = (pos.y ?? 0) + 1.6; p.positionZ.value = pos.z; } else p.setPosition(pos.x, (pos.y ?? 0) + 1.6, pos.z);
      dest.connect(p); p.connect(eng.bus.vo); node = p;
    } else dest.connect(eng.bus.vo);
    eng.send(dest, base === 'Priestess' ? 0.9 : 0.22);
    const handles = [], plans = [];
    for (const L of layers) {
      const plan = planUtterance({ native: o.native, text: o.text, speaker: base, duration: o.duration, seed: L.seed, voice: L.voice });
      plans.push(plan);
      handles.push(playPlan(ctx, dest, plan, { offset, gain: (o.gain ?? 1) * SYNTH_GAIN }));
    }
    handles.push({ stop(f = 0.08) { setTimeout(() => { try { dest.disconnect(); node.disconnect(); } catch { /* нет */ } }, (f + 0.2) * 1000); } });
    return { handles, plan: plans[0], plans };
  }

  function startTTS(o) {
    const v = arVoice();
    if (!tts || !v || !o.nativeScript) return null;
    try {
      const u = new SpeechSynthesisUtterance(o.nativeScript);
      u.voice = v; u.lang = v.lang;
      const vo = voiceOf(SYNTH_ALIAS[o.speaker] || o.speaker);
      u.pitch = Math.max(0.2, Math.min(2, Math.pow(vo.f0 / 140, 0.75)));
      u.rate = 0.9;
      u.volume = Math.max(0, Math.min(1, (S.volume?.vo ?? 1) * (S.volume?.master ?? 1)));
      u.onerror = () => {};
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
      return { handles: [], tts: true };
    } catch { return null; }
  }

  /** Галах: перевод голосом языка игры (TTS браузера); нет TTS-голоса — синтезатор-«бормотание» по слогам перевода. */
  function startGalach(o) {
    if (!tts) return null;
    try {
      const want = game.lang === 'RU' ? 'ru' : 'en';
      const v = ttsVoices.find((x) => (x.lang || '').toLowerCase().startsWith(want));
      if (!v) return null;
      const u = new SpeechSynthesisUtterance(o.text);
      u.voice = v; u.lang = v.lang; u.rate = 0.95;
      u.pitch = Math.max(0.2, Math.min(2, Math.pow(voiceOf(SYNTH_ALIAS[o.speaker] || o.speaker).f0 / 140, 0.75)));
      u.volume = Math.max(0, Math.min(1, (S.volume?.vo ?? 1) * (S.volume?.master ?? 1)));
      u.onerror = () => {};
      speechSynthesis.cancel(); speechSynthesis.speak(u);
      return { handles: [], tts: true };
    } catch { return null; }
  }

  function fallback(o, offset, pos) {
    const m = mode();
    const wantTTS = (m === 'tts' || (m === 'auto' && !SYNTH_ONLY.has(o.speaker))) && !!o.nativeScript;
    let r = o.galach ? startGalach(o) : (wantTTS ? startTTS(o) : null);
    if (!r) r = startSynth(o, offset, pos);
    return r;
  }

  function speak(o) {
    if (!o || !eng.running) return null;
    const m = mode();
    if (m === 'off') return null;
    if (o.exclusive !== false) stop(0.05);
    const pos = posOf(o.speaker, o.pos, o.chain);
    const myTok = ++tok;
    const useBank = m !== 'synth' && !o.galach && !!o.id && bank.has(o.id);
    const dur = bank.duration(o.id) || o.duration || 3;
    cur = { id: o.id, speaker: o.speaker, o, pos, startedAt: game.time, duration: dur, handles: [], tok: myTok, mode: useBank ? 'clip' : 'fallback' };
    if (useBank) {
      cur.pending = true;
      bank.decode(ctx, o.id).then((buf) => {
        if (!cur || cur.tok !== myTok) return;               // реплику уже сменили
        cur.pending = false;
        if (!buf) { Object.assign(cur, { mode: 'fallback' }, fallback(o, game.time - cur.startedAt, cur.pos)); return; }
        const late = Math.max(0, game.time - cur.startedAt);
        if (late > buf.duration - 0.15) return;
        cur.clip = startClip(buf, late, cur.pos, 0.95, o.speaker === 'Priestess' ? 0.25 : 0.2);
        cur.duration = buf.duration;
        // прогрев: декодируем следующие реплики цепочки
        let nid = game.dialogue?.row?.(o.id)?.next;
        for (let k = 0; k < 2 && nid; k++) { bank.decode(ctx, nid); nid = game.dialogue?.row?.(nid)?.next; }
      });
    } else {
      Object.assign(cur, fallback(o, 0, pos));
    }
    return cur;
  }

  // ---- Лай толпы: тихое безсловесное бормотание ----
  function bark(e) {
    if (mode() === 'off' || !eng.running) return;
    if (game.dialogue?.isStoryLinePlaying) return;
    if (barkVoices.size >= 2) return;
    const arch = e.archetype || 'Elder';
    const pick = bank.barkPick(arch, lastBark[arch] ?? -1);
    if (!pick) return;
    lastBark[arch] = pick.idx;
    const pos = e.pos ? { x: e.pos.x, y: e.pos.y, z: e.pos.z } : null;
    bank.decodeBark(ctx, pick).then((buf) => {
      if (!buf) return;
      const clip = startClip(buf, 0, pos, BARK_GAIN, 0.3);
      const h = { clip };
      barkVoices.add(h);
      clip.src.onended = () => { barkVoices.delete(h); try { clip.gain.disconnect(); clip.panner?.disconnect(); } catch { /* нет */ } };
    });
  }

  // ---- События ----
  game.bus.on('subtitle', (e) => {
    if (!e || e.kind === 'lore') return;   // надписи не озвучиваем
    if (e.kind === 'bark') { bark(e); return; }
    speak({ id: e.id, speaker: e.speaker, native: e.native, nativeScript: e.nativeScript, galach: e.galach, text: e.text, duration: e.duration, chain: e.chain });
  });
  game.bus.on('dialogue:stop', () => stop());
  game.bus.on('chain:end', () => { /* реплика доигрывает до конца сама */ });
  let resume = null;
  const hold = (on) => {
    if (on) {
      if (cur && !cur.tts) { resume = { o: cur.o, at: game.time - cur.startedAt, pos: cur.pos }; stop(0.05); }
      else if (cur?.tts && tts) { try { speechSynthesis.pause(); } catch { /* нет */ } }
    } else {
      if (resume && resume.at < (bank.duration(resume.o.id) || resume.o.duration || 3) - 0.2) {
        const r = resume; resume = null;
        const myTok = ++tok;
        const dur = bank.duration(r.o.id) || r.o.duration || 3;
        cur = { id: r.o.id, speaker: r.o.speaker, o: r.o, pos: r.pos, startedAt: game.time - r.at, duration: dur, handles: [], tok: myTok, mode: 'clip' };
        if (mode() !== 'synth' && bank.has(r.o.id)) bank.decode(ctx, r.o.id).then((buf) => { if (cur && cur.tok === myTok && buf) cur.clip = startClip(buf, game.time - cur.startedAt, cur.pos, 0.95); });
        else Object.assign(cur, startSynth(r.o, r.at, r.pos));
      }
      resume = null;
      if (tts) { try { speechSynthesis.resume(); } catch { /* нет */ } }
    }
  };
  game.bus.on('pause', ({ paused } = {}) => hold(!!paused));
  game.bus.on('photo', ({ active } = {}) => hold(!!active));

  return {
    speak, stop, mode, renderOffline, bank,
    update() {
      if (!cur) return;
      // голос следует за говорящим (спутники идут, жители ходят)
      if (cur.clip?.panner && cur.o) {
        const np = posOf(cur.speaker, null, cur.o.chain);
        if (np) { setPan(cur.clip.panner, np, true); cur.pos = np; }
      }
      if (game.time - cur.startedAt > cur.duration + 1.2) { if (cur.tts && tts && !speechSynthesis.speaking) cur = null; else if (!cur.tts) cur = null; }
    },
    get hasArabic() { return !!arVoice(); },
    get active() { return !!cur; },
    get speaker() { return cur?.speaker ?? null; },
    get current() { return cur; },
    get usingRecording() { return cur?.mode === 'clip'; },
  };
}
