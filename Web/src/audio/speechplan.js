// План речи на вымышленном языке Ракиса (арабская основа): чистая логика без WebAudio (тестируется в Node).
// parseNative(romanized) → слова/фонемы; gibberish(translation) → псевдо-текст по числу слогов перевода;
// planUtterance({native|text, speaker, duration}) → дорожки параметров формантного синтезатора (Klatt-подобные, 500 кадров/с):
//   f0 (Гц), av (озвончение), ah (придыхание через форманты), af/ff (фрикативный шум и его центр), f1..f3, fg (усиление верхних формант).
// Воспроизведение дорожек — audio/voice.js.
import { clamp } from '../core/util.js';

export const FR = 500;                 // кадров дорожки в секунду
const MODE = [0, 2, 3, 6, 7, 8, 10];   // лад Ракиса (как в music.js)

// ------------------------------------------------------------------ Голоса
// f0 — средний тон, Гц; range — глубина интонации (полутона); rate — темп; fs — масштаб формант (длина тракта);
// vib {r Гц, d полутонов}; jit — дрожание тона; breath — постоянное придыхание; nasal 0..1; tilt — яркость источника (0 — резкий, 1 — мягкий);
// stac — рубленость (провалы между слогами); style: 'speech' | 'chant'; amp — уровень.
export const VOICES = {
  Kair: { f0: 124, range: 5.5, rate: 1.0, fs: 1.06, vib: { r: 0, d: 0 }, jit: 0.007, breath: 0.015, nasal: 0, tilt: 0.55, stac: 0.1, amp: 1 },
  Ilva: { f0: 205, range: 4.2, rate: 0.9, fs: 1.17, vib: { r: 4.8, d: 0.12 }, jit: 0.004, breath: 0.03, nasal: 0, tilt: 0.8, stac: 0, amp: 1 },
  Rayn: { f0: 140, range: 7.5, rate: 1.14, fs: 1.0, vib: { r: 6.4, d: 0.16 }, jit: 0.014, breath: 0.03, nasal: 0.65, tilt: 0.5, stac: 0.15, amp: 1 },
  Ossana: { f0: 100, range: 3, rate: 0.93, fs: 1.1, vib: { r: 0, d: 0 }, jit: 0.011, breath: 0.01, nasal: 0, tilt: 0.1, stac: 0.5, amp: 1.05 },
  Harmat: { f0: 90, range: 3.2, rate: 0.78, fs: 0.93, vib: { r: 5, d: 0.22 }, jit: 0.022, breath: 0.06, nasal: 0.1, tilt: 0.6, stac: 0.1, amp: 1 },
  Guard: { f0: 106, range: 2.4, rate: 1.0, fs: 1.0, vib: { r: 0, d: 0 }, jit: 0.008, breath: 0.01, nasal: 0, tilt: 0.3, stac: 0.4, amp: 1.05 },
  Rider: { f0: 98, range: 3.4, rate: 0.84, fs: 0.97, vib: { r: 0, d: 0 }, jit: 0.007, breath: 0.03, nasal: 0, tilt: 0.45, stac: 0.1, amp: 1 },
  Rider1: { f0: 98, range: 3.4, rate: 0.84, fs: 0.97, vib: { r: 0, d: 0 }, jit: 0.007, breath: 0.03, nasal: 0, tilt: 0.45, stac: 0.1, amp: 1 },
  Rider2: { f0: 118, range: 3.8, rate: 0.9, fs: 1.04, vib: { r: 0, d: 0 }, jit: 0.008, breath: 0.02, nasal: 0.1, tilt: 0.5, stac: 0.15, amp: 1 },
  Priestess: { f0: 233, range: 2, rate: 0.55, fs: 1.2, vib: { r: 5.3, d: 0.3 }, jit: 0.003, breath: 0.02, nasal: 0, tilt: 0.9, stac: 0, amp: 0.9, style: 'chant' },
  Crowd: { f0: 150, range: 5, rate: 1.05, fs: 1.1, vib: { r: 0, d: 0 }, jit: 0.015, breath: 0.05, nasal: 0.2, tilt: 0.5, stac: 0.1, amp: 0.55, murmur: true },
  Child: { f0: 300, range: 7, rate: 1.1, fs: 1.32, vib: { r: 0, d: 0 }, jit: 0.01, breath: 0.03, nasal: 0.1, tilt: 0.6, stac: 0.1, amp: 0.7 },
};
export const voiceOf = (speaker) => VOICES[speaker] || VOICES.Kair;

// ------------------------------------------------------------------ Фонемы
const VOW = { a: [720, 1240, 2600], i: [300, 2250, 3000], u: [320, 820, 2350], e: [480, 1900, 2600], o: [450, 850, 2500], '@': [500, 1500, 2500] };
// cls: plos | fric | nas | liq | glide | asp | phar | stop; v — звонкость; dur — мс (звук / смычка); b — частота взрыва; n — центр шума; na — амп. шума;
// F — цели формант (сонорные и «локус»); bk — подтягивание соседних гласных назад (оглушённость эмфатики/гуттуральных), emph — эмфатика.
const C = {
  p: { cls: 'plos', v: 0, clo: 60, b: 900, loc: 800, dur: 90 },
  b: { cls: 'plos', v: 1, clo: 55, b: 700, loc: 750, dur: 80 },
  t: { cls: 'plos', v: 0, clo: 55, b: 4300, loc: 1700, dur: 85 },
  d: { cls: 'plos', v: 1, clo: 50, b: 3400, loc: 1700, dur: 75 },
  k: { cls: 'plos', v: 0, clo: 60, b: 1900, loc: 1500, dur: 95, vel: 1 },
  g: { cls: 'plos', v: 1, clo: 55, b: 1700, loc: 1400, dur: 80, vel: 1 },
  q: { cls: 'plos', v: 0, clo: 70, b: 1000, loc: 1000, dur: 105, bk: 1, vel: 1 },
  tE: { cls: 'plos', v: 0, clo: 65, b: 3400, loc: 1300, dur: 95, bk: 0.7, emph: 1 },
  dE: { cls: 'plos', v: 1, clo: 60, b: 3000, loc: 1300, dur: 85, bk: 0.7, emph: 1 },
  ' ': { cls: 'stop', v: 0, clo: 55, b: 1500, loc: 1300, dur: 70 },     // ʾ — гортанная смычка
  f: { cls: 'fric', v: 0, n: 5500, q: 0.8, na: 0.55, dur: 105, loc: 1100 },
  v: { cls: 'fric', v: 1, n: 4500, q: 0.8, na: 0.3, dur: 85, loc: 1100 },
  s: { cls: 'fric', v: 0, n: 7000, q: 1.4, na: 1.0, dur: 120, loc: 1700 },
  z: { cls: 'fric', v: 1, n: 6500, q: 1.4, na: 0.5, dur: 100, loc: 1700 },
  sh: { cls: 'fric', v: 0, n: 3300, q: 1.1, na: 1.1, dur: 125, loc: 2000 },
  zh: { cls: 'fric', v: 1, n: 3000, q: 1.1, na: 0.55, dur: 105, loc: 2000 },
  th: { cls: 'fric', v: 0, n: 6200, q: 0.6, na: 0.3, dur: 100, loc: 1600 },
  dh: { cls: 'fric', v: 1, n: 5200, q: 0.6, na: 0.18, dur: 80, loc: 1600 },
  sE: { cls: 'fric', v: 0, n: 5200, q: 1.3, na: 1.0, dur: 125, loc: 1300, bk: 0.7, emph: 1 },
  zE: { cls: 'fric', v: 1, n: 4800, q: 1.3, na: 0.5, dur: 105, loc: 1300, bk: 0.7, emph: 1 },
  kh: { cls: 'fric', v: 0, n: 1900, q: 0.8, na: 0.9, dur: 125, loc: 1500, bk: 0.5, vel: 1 },
  gh: { cls: 'fric', v: 1, n: 1500, q: 0.8, na: 0.5, dur: 105, loc: 1400, bk: 0.5, vel: 1 },
  h: { cls: 'asp', v: 0, dur: 75 },
  hh: { cls: 'phar', v: 0, n: 1150, q: 0.9, na: 0.6, dur: 115, loc: 1100, bk: 1 },         // ḥ
  ay: { cls: 'phar', v: 1, n: 1300, q: 1.2, na: 0.15, dur: 95, loc: 1300, bk: 1, creak: 1, F: [850, 1250, 2500] }, // ʿ
  m: { cls: 'nas', v: 1, dur: 85, F: [260, 1050, 2300], loc: 900 },
  n: { cls: 'nas', v: 1, dur: 80, F: [270, 1500, 2400], loc: 1600 },
  l: { cls: 'liq', v: 1, dur: 80, F: [360, 1150, 2600], loc: 1200 },
  r: { cls: 'liq', v: 1, dur: 55, F: [450, 1300, 1900], loc: 1400, tap: 1 },
  w: { cls: 'glide', v: 1, dur: 70, F: [310, 700, 2300], loc: 800 },
  y: { cls: 'glide', v: 1, dur: 70, F: [290, 2200, 3000], loc: 2100 },
  ch: { cls: 'aff', v: 0, clo: 55, b: 3300, n: 3300, q: 1.1, na: 1.0, dur: 120, loc: 2000 },
  j: { cls: 'aff', v: 1, clo: 50, b: 3000, n: 3000, q: 1.1, na: 0.6, dur: 105, loc: 2000 },
};

const LONG_V = 165, SHORT_V = 85;

// ------------------------------------------------------------------ Разбор романизации
const MARKS = /[̀-ͯ]/;
const AYN = new Set(['ʿ', 'ʻ', '‘', '`', 'ʿ', 'ʻ']);
const HAMZA = new Set(['ʾ', '’', "'", 'ʼ', 'ʾ']);
const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

function clusters(str) {
  const s = String(str || '').normalize('NFD').toLowerCase();
  const out = [];
  for (const ch of s) {
    if (MARKS.test(ch) && out.length) out[out.length - 1].m.add(ch.codePointAt(0));
    else out.push({ c: ch, m: new Set() });
  }
  return out;
}

/** → [{t:'w', ph:[{k:'V'|'C', s, long, stress, emph, geminate}], join}, {t:'p', kind:'comma'|'end'|'q'|'ex'|'trail'}] */
export function parseNative(str) {
  const cl = clusters(str);
  const items = [];
  let ph = [];
  const flush = (join = false) => { if (ph.length) { items.push({ t: 'w', ph, join }); ph = []; } };
  const pushC = (sym, extra = {}) => {
    const d = C[sym]; if (!d) return;
    const prev = ph[ph.length - 1];
    if (prev && prev.k === 'C' && prev.s === sym && !extra.noGem) { prev.geminate = true; return; }
    ph.push({ k: 'C', s: sym, emph: !!d.emph || !!extra.emph, ...extra });
  };
  for (let i = 0; i < cl.length; i++) {
    const { c, m } = cl[i];
    const n1 = cl[i + 1]?.c;
    const long = m.has(0x304) || m.has(0x302);
    const acute = m.has(0x301);
    const dotBelow = m.has(0x323);
    if (c === ' ' || c === '\n' || c === '\t') { flush(); continue; }
    if (c === '-' || c === '·' || c === '_') { flush(true); continue; }
    if (c === ',' || c === ';' || c === ':') { flush(); items.push({ t: 'p', kind: 'comma' }); continue; }
    if (c === '.' || c === '…' || c === '!' || c === '?' || c === '—' || c === '–') {
      flush();
      const kind = c === '?' ? 'q' : c === '!' ? 'ex' : c === '…' ? 'trail' : c === '.' ? 'end' : 'comma';
      const last = items[items.length - 1];
      if (last && last.t === 'p' && kind !== 'comma') { if (last.kind === 'end' || last.kind === 'comma' || last.kind === 'trail') last.kind = kind; } else items.push({ t: 'p', kind });
      continue;
    }
    if (AYN.has(c)) { pushC('ay', { noGem: true }); continue; }
    if (HAMZA.has(c)) { pushC(' ', { noGem: true }); continue; }
    if (VOWELS.has(c)) {
      const prev = ph[ph.length - 1];
      if (prev && prev.k === 'V' && prev.s === c && !prev.long && !prev.dbl) { prev.long = true; prev.dbl = true; continue; }
      ph.push({ k: 'V', s: c, long, stress: acute });
      continue;
    }
    // согласные
    const pair = c + (n1 || '');
    if (!m.size && ['kh', 'gh', 'sh', 'th', 'dh', 'zh', 'ch'].includes(pair)) { pushC(pair); i++; continue; }
    switch (c) {
      case 'p': case 'b': case 'f': case 'v': case 'm': case 'n': case 'l': case 'r': case 'w': case 'y': case 'h': case 'j': pushC(c === 'h' ? (dotBelow ? 'hh' : m.has(0x32e) ? 'kh' : 'h') : c); break;
      case 't': pushC(dotBelow ? 'tE' : m.has(0x331) ? 'th' : 't'); break;
      case 'd': pushC(dotBelow ? 'dE' : m.has(0x331) ? 'dh' : 'd'); break;
      case 'k': pushC('k'); break;
      case 'g': pushC(m.has(0x307) ? 'gh' : m.has(0x30c) ? 'j' : 'g'); break;
      case 'q': pushC('q'); break;
      case 'c': pushC('ch'); break;
      case 'x': pushC('kh'); break;
      case 's': pushC(dotBelow ? 'sE' : m.has(0x30c) ? 'sh' : 's'); break;
      case 'z': pushC(dotBelow ? 'zE' : m.has(0x30c) ? 'zh' : 'z'); break;
      default: break; // прочие символы пропускаем
    }
  }
  flush();
  // ударение: первый долгий гласный, иначе первый (для слов длиннее одного слога)
  for (const it of items) {
    if (it.t !== 'w') continue;
    const vs = it.ph.filter((p) => p.k === 'V');
    if (!vs.length) continue;
    if (vs.some((v) => v.stress)) continue;
    (vs.find((v) => v.long) || (vs.length > 1 ? vs[vs.length > 2 ? vs.length - 2 : 0] : vs[0])).stress = true;
  }
  return items;
}

// ------------------------------------------------------------------ Псевдо-текст по переводу
export function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry(a) { return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const wpick = (r, arr) => { let tot = 0; for (const [, w] of arr) tot += w; let x = r() * tot; for (const [v, w] of arr) { x -= w; if (x <= 0) return v; } return arr[0][0]; };
const ONSETS = [['t', 3], ['k', 3], ['b', 2], ['d', 3], ['m', 3], ['n', 3], ['l', 2], ['r', 3], ['s', 3], ['sh', 1.5], ['kh', 2], ['q', 1.5], ['ʿ', 1.5], ['h', 2], ['w', 1], ['y', 1], ['z', 1], ['f', 1], ['', 1.2], ['gh', 1], ['ḥ', 0.8], ['ṣ', 0.6], ['j', 0.6]];
const NUCLEI = [['a', 5], ['i', 2.5], ['u', 2.5], ['e', 1], ['aa', 1.3], ['ii', 0.6], ['uu', 0.6]];
const CODAS = [['', 6], ['n', 1.5], ['r', 1.2], ['l', 1], ['s', 1], ['m', 0.8], ['kh', 0.6], ['t', 0.8], ['q', 0.5], ['ʾ', 0.4]];
const PREFIX = ['al', 'ash', 'il', 'ka', 'na', 'ya'];

export function syllablesIn(word) { const m = String(word).toLowerCase().match(/[аеёиоуыэюяaeiouy]+/g); return m ? m.length : 0; }

/** Псевдо-романизация: слова и слоги — по переводу; пунктуация сохраняется. Детерминирована для данного текста. */
export function gibberish(text) {
  text = String(text || '').replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
  const r = mulberry(hash(text) || 1);
  const parts = text.split(' ').filter(Boolean);
  const out = [];
  for (const w of parts) {
    const core = w.replace(/[^\p{L}\p{N}]/gu, '');
    const tail = (w.match(/[,;:.!?…—–]+$/u) || [''])[0].replace(/[—–]/g, ',');
    let n = syllablesIn(core);
    if (!core || (n === 0 && !/\d/.test(core))) { if (tail && out.length) out[out.length - 1] += tail; continue; }
    n = Math.max(1, Math.min(6, n || 1));
    // служебные слова (1 слог) — короткие частицы
    let word = '';
    if (n >= 3 && r() < 0.25) word += PREFIX[(r() * PREFIX.length) | 0] + '-';
    for (let i = 0; i < n; i++) {
      let o = wpick(r, ONSETS); if (i === 0 && o === '' && r() < 0.5) o = 't';
      const v = wpick(r, NUCLEI);
      const cd = i === n - 1 || r() < 0.3 ? wpick(r, CODAS) : '';
      word += o + v + cd;
    }
    out.push(word + tail);
  }
  return out.join(' ');
}

// ------------------------------------------------------------------ План
const TAU = { st: 0.03, av: 0.007, ah: 0.008, af: 0.003, ff: 0.008, f1: 0.016, f2: 0.02, f3: 0.02, fg: 0.015 };

function scaleDegSemis(deg) { const oct = Math.floor(deg / 7), idx = ((deg % 7) + 7) % 7; return oct * 12 + MODE[idx]; }

function contourFn(kind, range) {
  const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  return (u) => {
    if (kind === 'q') return range * (0.25 - 0.35 * u + 1.05 * ss(0.68, 1, u));
    if (kind === 'ex') return range * (0.55 - 0.9 * u + 0.5 * ss(0, 0.2, u));
    if (kind === 'trail') return range * (0.3 - 0.75 * u);
    return range * (0.5 - 0.95 * u);           // повествование: нисходящая
  };
}

/**
 * @param {{native?:string, text?:string, speaker?:string, duration?:number, seed?:number}} o
 * @returns {{dur:number, tracks:Object, n:number, speakEnd:number, native:string, fallback:boolean}}
 */
export function planUtterance(o) {
  const V = { ...voiceOf(o.speaker), ...(o.voice || {}) };
  let native = String(o.native || '').trim();
  let fallback = false;
  if (!native) { native = gibberish(o.text || ''); fallback = true; }
  const items = parseNative(native);
  const chant = V.style === 'chant';
  const rnd = mulberry(hash(native) ^ (o.seed || 0));

  // --- 1. Список фонем с базовыми длительностями (с)
  const seq = []; // {kind:'phone'|'pause', ...}
  let sentenceKind = 'end';
  for (const it of items) if (it.t === 'p' && it.kind !== 'comma') sentenceKind = it.kind;
  const lastWordIdx = (() => { let k = -1; items.forEach((it, i) => { if (it.t === 'w') k = i; }); return k; })();
  items.forEach((it, idx) => {
    if (it.t === 'p') { seq.push({ kind: 'pause', dur: it.kind === 'comma' ? 0.17 : it.kind === 'trail' ? 0.4 : 0.32, pk: it.kind }); return; }
    const nextP = items[idx + 1];
    const phraseFinal = !nextP || nextP.t === 'p';
    it.ph.forEach((p, j) => {
      const d = p.k === 'V' ? (p.long ? LONG_V : SHORT_V) * (p.stress ? 1.12 : 1) : (C[p.s].dur) * (p.geminate ? 1.5 : 1);
      const lastV = p.k === 'V' && phraseFinal && it.ph.slice(j + 1).every((x) => x.k !== 'V');
      seq.push({ kind: 'phone', p, d: d / 1000 * (lastV ? 1.45 : 1), wi: idx, first: j === 0, lastInWord: j === it.ph.length - 1, phraseFinal: phraseFinal && it.ph.slice(j + 1).every((x) => x.k !== 'V') });
    });
    if (!it.join && nextP && nextP.t === 'w') seq.push({ kind: 'pause', dur: 0.045, pk: 'word' });
  });

  // --- 2. Подгонка по длительности
  const rate = (V.rate || 1) * (chant ? 1 : 1);
  let phoneT = 0, vowT = 0, pauseT = 0;
  for (const s of seq) { if (s.kind === 'phone') { phoneT += s.d / rate; if (s.p.k === 'V') vowT += s.d / rate; } else pauseT += s.dur; }
  const natural = phoneT + pauseT;
  const target = Math.max(0.5, (o.duration || natural) * 0.9);
  let vScale = 1 / rate, cScale = 1 / rate, pScale = 1;
  if (natural > target) { const k = clamp(target / natural, 0.55, 1); vScale *= k; cScale *= k; pScale = k; }
  else {
    const extra = target - natural;
    if (chant) { vScale *= 1 + clamp(extra / Math.max(vowT, 0.05), 0, 7); cScale *= 0.9; }
    else {
      const k = clamp(1 + extra / Math.max(phoneT, 0.1) * 0.5, 1, 1.45);
      vScale *= k; cScale *= Math.min(k, 1.2); pScale = 1 + clamp(extra / Math.max(pauseT, 0.1) * 0.3, 0, 1.2);
    }
  }
  for (const s of seq) { s.dd = s.kind === 'pause' ? s.dur * pScale : s.d * (s.p.k === 'V' ? vScale : cScale); }
  const total = seq.reduce((a, s) => a + s.dd, 0);
  const speakEnd = total;

  // --- 3. Ключевые кадры
  const kfs = []; // {t, set:{...}}
  const fsc = V.fs || 1;
  const contour = contourFn(sentenceKind, V.range);
  const accent = chant ? 0 : Math.min(2.2, 0.35 * V.range);
  let t = 0;
  const lastPhone = [...seq].reverse().find((s) => s.kind === 'phone');
  // мелодия для напева
  let deg = 4 + ((rnd() * 3) | 0);
  const nextNote = () => { const step = [-2, -1, -1, -1, 0, 1][(rnd() * 6) | 0]; deg = clamp(deg + step, -2, 7); return scaleDegSemis(deg) - 4; };
  const upDown = (i) => { const a = seq[i - 1], b = seq[i + 1]; return [a?.kind === 'phone' ? a.p : null, b?.kind === 'phone' ? b.p : null]; };
  // индекс «фонемы следующей/предыдущей» для когартикуляции
  seq.forEach((s, i) => {
    if (s.kind === 'pause') {
      kfs.push({ t, set: { av: 0, ah: 0, af: 0 } });
      t += s.dd; return;
    }
    const p = s.p, d = C[p.s] || null, u = total > 0 ? t / total : 0;
    let baseSt = contour(u);
    const dd = s.dd;
    if (p.k === 'V') {
      const [pr, nx] = upDown(i);
      let [f1, f2, f3] = VOW[p.s];
      let bk = 0;
      for (const nb of [pr, nx]) if (nb && nb.k === 'C') { const nd = C[nb.s]; bk += (nd.bk || 0) * 0.5 + (nb.emph ? 0.25 : 0); }
      bk = Math.min(1, bk);
      f1 *= 1 + 0.07 * bk; f2 *= 1 - 0.17 * bk; f3 *= 1 - 0.03 * bk;
      if (chant) f1 = Math.max(f1, 1.1 * V.f0 * Math.pow(2, (baseSt + 8) / 12) * 0.9);
      const stress = !!p.stress;
      const sets = { f1: f1 * fsc, f2: f2 * fsc, f3: f3 * fsc, av: 1, ah: V.breath, af: 0, fg: 1 };
      if (chant) {
        // мелизма: длинная гласная = несколько нот
        const k = clamp(Math.floor(dd / 0.32), 1, 5);
        for (let q = 0; q < k; q++) kfs.push({ t: t + (dd * q) / k, set: q === 0 ? { ...sets, st: nextNote() } : { st: nextNote() } });
      } else {
        const acc = stress ? accent : 0;
        let st = baseSt + acc;
        if (s.phraseFinal && sentenceKind === 'q') st += V.range * 0.6;
        if (s.phraseFinal && sentenceKind !== 'q' && sentenceKind !== 'ex') st -= 0.8;
        kfs.push({ t, set: { ...sets, st } });
        if (stress && dd > 0.1) kfs.push({ t: t + dd * 0.55, set: { st: baseSt + acc * 0.35 } });   // колокол ударения
      }
      if (s.phraseFinal && sentenceKind !== 'q' && sentenceKind !== 'ex') kfs.push({ t: t + dd * 0.75, set: { ah: V.breath + 0.05 + (V.breath > 0.06 ? 0.15 : 0), av: 0.78 } });
      if (V.stac > 0) kfs.push({ t: t + dd * 0.8, set: { av: 1 - V.stac * 0.6 } });
      kfs.push({ t: t + dd * 0.95, set: { av: 1 } });
    } else {
      const [pr, nx] = upDown(i);
      const loc = d.loc || 1300;
      const sets = {};
      const cn = chant ? 0.8 : 1;
      switch (d.cls) {
        case 'plos': case 'stop': case 'aff': {
          const clo = Math.min(dd * 0.65, (d.clo / 1000) * (p.geminate ? 1.5 : 1));
          const velF = d.vel ? (nx && nx.k === 'V' && (nx.s === 'i' || nx.s === 'e') ? 1.5 : 0.9) : 1;
          // смычка
          kfs.push({ t, set: { av: d.v ? 0.28 : 0, ah: 0, af: 0, f1: 280 * fsc, f2: loc * fsc, f3: 2400 * fsc, fg: 0.6 } });
          if (p.s === ' ') kfs.push({ t: t + clo, set: { av: 0.5, af: 0, jit: 4 } });
          // взрыв
          const bt = t + clo;
          const nz = d.cls === 'aff' ? d.n : d.b * velF;
          const bamp = (d.cls === 'aff' ? 1.0 : 0.85) * (d.v ? 0.55 : 1) * (p.s === ' ' ? 0 : 1) * cn * (p.emph ? 1 : 1);
          kfs.push({ t: bt, set: { af: bamp, ff: nz * (0.6 + 0.4 * fsc), av: d.v ? 0.5 : 0, ah: d.v ? 0 : 0.5, fg: 1 } });
          const burst = d.cls === 'aff' ? Math.min(0.08, dd - clo) : 0.012;
          kfs.push({ t: bt + burst, set: { af: d.cls === 'aff' && d.v ? 0.25 : 0, ah: d.v ? 0 : 0.35 } });
          kfs.push({ t: bt + burst + (d.v ? 0.01 : 0.03), set: { ah: V.breath, af: 0 } });
          break;
        }
        case 'fric': {
          kfs.push({ t, set: { av: d.v ? 0.45 : 0, ah: 0, af: d.na * cn, ff: d.n * (0.6 + 0.4 * fsc), f1: 300 * fsc, f2: loc * fsc, f3: 2400 * fsc, fg: 0.7 } });
          kfs.push({ t: t + dd * 0.85, set: { af: d.na * 0.5 * cn } });
          kfs.push({ t: t + dd, set: { af: 0 } });
          break;
        }
        case 'asp': {
          // придыхание: шум через форманты следующего гласного
          const f = VOW[nx && nx.k === 'V' ? nx.s : 'a'];
          kfs.push({ t, set: { av: 0.1, ah: 0.9, af: 0.12, ff: 1800, f1: f[0] * fsc, f2: f[1] * fsc, f3: f[2] * fsc, fg: 1 } });
          kfs.push({ t: t + dd * 0.9, set: { ah: V.breath, af: 0 } });
          break;
        }
        case 'phar': {
          const F = d.F || [800, 1200, 2500];
          const voiced = !!d.v;
          kfs.push({ t, set: { av: voiced ? 0.7 : 0.15, ah: voiced ? 0.1 : 0.75, af: d.na * cn, ff: d.n * fsc, f1: F[0] * fsc, f2: F[1] * fsc, f3: F[2] * fsc, fg: 0.8, jit: d.creak ? 5 : 1.5, st: baseSt - (d.creak ? 3 : 0.5) } });
          kfs.push({ t: t + dd * 0.9, set: { jit: 1, af: 0, ah: V.breath } });
          break;
        }
        case 'nas': case 'liq': case 'glide': {
          const F = d.F;
          kfs.push({ t, set: { av: d.cls === 'nas' ? 0.6 : 0.8, ah: V.breath, af: 0, f1: F[0] * fsc, f2: F[1] * fsc, f3: F[2] * fsc, fg: d.cls === 'nas' ? 0.35 : 0.9, st: baseSt } });
          if (d.tap) { kfs.push({ t: t + dd * 0.35, set: { av: 0.12 } }); kfs.push({ t: t + dd * 0.65, set: { av: 0.85 } }); }
          kfs.push({ t: t + dd * 0.9, set: { fg: 1 } });
          break;
        }
        default: break;
      }
      if (!chant || d.cls === 'plos') kfs.push({ t, set: { st: baseSt } });
    }
    t += dd;
  });
  // затухание в конце
  kfs.push({ t: total, set: { av: 0, ah: 0, af: 0 } });
  const tailT = total + (chant ? 0.9 : 0.25);
  kfs.push({ t: tailT, set: { av: 0, ah: 0, af: 0 } });
  kfs.sort((a, b) => a.t - b.t);

  // --- 4. Дорожки
  const N = Math.max(2, Math.ceil(tailT * FR) + 2);
  const tr = { f0: new Float32Array(N), av: new Float32Array(N), ah: new Float32Array(N), af: new Float32Array(N), ff: new Float32Array(N), f1: new Float32Array(N), f2: new Float32Array(N), f3: new Float32Array(N), fg: new Float32Array(N) };
  const cur = { st: 0, av: 0, ah: 0, af: 0, ff: 3000, f1: 500 * fsc, f2: 1500 * fsc, f3: 2500 * fsc, fg: 1 };
  const tgt = { ...cur };
  let jitMul = 1, jm = 0, ptr = 0, shim = 0;
  const alpha = {}; for (const k of Object.keys(TAU)) alpha[k] = 1 - Math.exp(-1 / (FR * (chant && k === 'st' ? 0.05 : TAU[k])));
  for (let k = 0; k < N; k++) {
    const tt = k / FR;
    while (ptr < kfs.length && kfs[ptr].t <= tt) {
      const st = kfs[ptr].set;
      for (const key in st) { if (key === 'jit') jitMul = st[key]; else tgt[key] = st[key]; }
      ptr++;
    }
    for (const key of Object.keys(TAU)) cur[key] += (tgt[key] - cur[key]) * alpha[key];
    jm = jm * 0.9 + (rnd() * 2 - 1) * 0.1;
    shim = shim * 0.9 + (rnd() * 2 - 1) * 0.1;
    const vibOn = clamp((tt - 0.25) / 0.5, 0, 1);
    const vib = V.vib.d ? V.vib.d * vibOn * Math.sin(2 * Math.PI * V.vib.r * tt) : 0;
    const jitter = V.jit * jitMul * jm * 12 * 3;
    tr.f0[k] = V.f0 * Math.pow(2, (cur.st + vib + jitter) / 12);
    tr.av[k] = clamp(cur.av * (1 + 0.1 * shim * (V.jit * 60)), 0, 1.2);
    tr.ah[k] = clamp(cur.ah, 0, 1.2); tr.af[k] = clamp(cur.af, 0, 2); tr.ff[k] = clamp(cur.ff, 200, 9000);
    tr.f1[k] = clamp(cur.f1, 180, 1400); tr.f2[k] = clamp(cur.f2, 500, 3200); tr.f3[k] = clamp(cur.f3, 1400, 3800); tr.fg[k] = clamp(cur.fg, 0, 1.2);
  }
  return { dur: tailT, speakEnd, tracks: tr, n: N, native, fallback, voice: V, natural };
}
