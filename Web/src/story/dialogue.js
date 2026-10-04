// Диалоговая система (порт URakisDialogueSubsystem): цепочки реплик по NextID, очередь без наложений,
// условия, лай толпы, надписи-лор. Озвучка — game.audio.voice (язык Ракиса), здесь только данные в 'subtitle'.
// События: 'subtitle' {id, speaker, name, text, native, nativeScript, duration, kind:'line'|'lore'|'bark', pos?}, 'line:end' {id}, 'chain:end' {id}.
import { clamp } from '../core/util.js';
import { loadSettings } from '../ui/settings.js';
import * as vo from '../audio/vo_bank.js';

const SPEAKERS = {
  Kair: ['Кайр', 'Kair'], Ilva: ['Сестра Илва', 'Sister Ilva'], Rayn: ['Мастер Рэйн', 'Master Rayn'],
  Ossana: ['Оссана', 'Ossana'], Rider: ['Наездник', 'Rider'], Rider1: ['Наездник', 'Rider'], Rider2: ['Наездник', 'Rider'],
  Guard: ['Страж', 'Guard'], Harmat: ['Наиб Хармат', 'Naib Harmat'], Priestess: ['Жрица', 'Priestess'],
  Crowd: ['', ''], Lore: ['', ''],
  // жители сиетча (подслушанные сцены, Ред. 2)
  Trader: ['Торговец', 'Trader'], Carrier: ['Водоноска', 'Water-carrier'], Weaver: ['Ткачиха', 'Weaver'], Mother: ['Мать', 'Mother'],
  Child: ['Мальчик', 'Boy'], Girl: ['Девочка', 'Girl'], Elder: ['Старик', 'Elder'], Youth: ['Юноша', 'Youth'], Pilgrim: ['Паломница', 'Pilgrim'],
};
const MAX_CHAIN_STEPS = 64;
const BARK_RADIUS = 10;        // м
const BARK_GLOBAL_INTERVAL = 3; // с

/** Встроенные реплики (как BuildFallbackDialogue в UE) — если таблицы нет или в ней нет такого ID. */
const FALLBACK = {
  A1_Ilva_01: ['Ilva', 'Рэйн. Сбей шаг.', 'Rayn. Break your step.', 'A1_Kair_01'],
  A1_Kair_01: ['Kair', 'Не шагай в такт. Песок слушает.', 'Don\'t walk in step. The sand is listening.'],
  A2_Rayn_01: ['Rayn', 'Сколько ещё?', 'How much farther?', 'A2_Kair_01'],
  A2_Kair_01: ['Kair', 'Столько, сколько песок позволит.', 'As far as the sand allows.'],
  A2_Kair_02: ['Kair', 'Стоять. Не бежать.', 'Stand still. Don\'t run.'],
  B1_Guard_01: ['Guard', 'Маски подтяни. Здесь влагу не дарят.', 'Tighten your masks. Nobody gives water away here.'],
  B3_Ilva_01: ['Ilva', 'Не смотри на воду так долго. Здесь это оскорбление.', 'Don\'t look at the water so long. Here that is an insult.'],
  B5_Harmat_01: ['Harmat', 'Вы пришли от тех, кто променял Бога на воду. Посмотрим, что вы принесли.', 'You come from those who traded God for water. Let us see what you have brought.'],
  Lore_Carving: ['Lore', 'Червь, обвивший каплю. Камень отполирован ладонями до блеска.', 'A worm coiled around a single drop. The stone is polished to a shine by hands.'],
  Lore_Grate: ['Lore', 'За решёткой — тёмная вода. Счёт ей ведут каплями.', 'Behind the grate, dark water. It is counted in drops.'],
};

export function autoDuration(text) { return clamp(0.06 * String(text).length + 1.2, 2.2, 7); }

/** Нормализация имени поверхности: sand/packed/rock/stone. */
function normSurface(s) {
  s = String(s || '').toLowerCase();
  if (s.startsWith('packed')) return 'packed';
  if (s.startsWith('sietch') || s === 'stone') return 'stone';
  return s.replace(/sand$/, '') || 'sand';
}

export function create(game) {
  loadSettings(game);
  const { bus } = game;
  const table = game.data?.Dialogue || {};
  const barks = game.data?.Barks || [];
  const flags = new Set();
  const queue = [];
  const pending = new Map(); // chainStart → Promise
  const resolvers = new Map();
  let playing = false, curId = null, chainStart = null, remaining = 0;
  let barkUntil = -1000, lastBarkAt = -1000, lastLoreId = null, lastLoreAt = -1000;
  const barkPlayed = new Map();
  const now = () => performance.now() / 1000;

  // ---- Данные ----
  function row(id) {
    if (!id) return null;
    const r = table[id];
    if (r) return r;
    const f = FALLBACK[id];
    return f ? { id, speaker: f[0], RU: f[1], EN: f[2], next: f[3] || '', condition: '', duration: 0 } : null;
  }
  function textOf(r) { return game.lang === 'RU' ? (r.RU || r.EN) : (r.EN || r.RU); }
  /** Перевод для субтитра + реплика на языке мира. native '[Galach]' (без письменности) — галах: озвучивается переводом, над субтитром — метка. */
  function lineParts(r) {
    const text = textOf(r);
    let native = String(r.native || '').trim(), nativeScript = r.nativeScript || '';
    const galach = /^\[galach\]$/i.test(native);
    if (galach) { native = ''; nativeScript = ''; }
    return { text, native, nativeScript, galach };
  }
  function speakerName(id) {
    const n = SPEAKERS[id];
    if (!n) return id || '';
    return game.lang === 'RU' ? n[0] : n[1];
  }
  /** "RU|EN" → строка текущего языка (PickPipeText). */
  function pick(pipe) {
    const s = String(pipe ?? '');
    const i = s.indexOf('|');
    if (i < 0) return s.trim();
    return (game.lang === 'RU' ? s.slice(0, i) : s.slice(i + 1)).trim();
  }

  // ---- Условия (IsConditionMet) ----
  function isConditionMet(cond) {
    cond = String(cond || '').trim();
    if (!cond || flags.has(cond)) return true;
    const i = cond.indexOf(':');
    if (i < 0) return false;
    const key = cond.slice(0, i), val = cond.slice(i + 1).trim();
    const p = game.player;
    switch (key) {
      case 'ZoneEnter': return String(game.zone).toLowerCase() === val.toLowerCase();
      case 'WormState': return String(game.worm?.state ?? '').toLowerCase() === val.toLowerCase();
      case 'NoiseAbove': return !!p && (p.noise ?? 0) > parseFloat(val);
      case 'SandWalk':
        if (!p?.sandWalking) return false;
        return /^regular$/i.test(val) ? (p.regularity ?? 0) > 0.75 : /^irregular$/i.test(val) && (p.regularity ?? 1) < 0.3;
      case 'Surface': {
        if (!p?.position) return false;
        return normSurface(game.surfaceAt(p.position.x, p.position.z)) === normSurface(val);
      }
      case 'MoistureBelow': return !!p && (p.moisture ?? 1) < parseFloat(val);
      default: return false; // Beat:/Interact: — только флаги
    }
  }

  // ---- Озвучка ----
  // Реплики озвучивает game.audio.voice на вымышленном языке (nativeScript → арабский TTS либо формантный синтезатор по native).
  // Здесь только данные: в событие 'subtitle' уходят перевод (text), native и nativeScript. Русский/английский текст не озвучивается.
  const cancelSpeech = () => game.audio?.voice?.stop?.();

  // ---- Цепочки ----
  function startLine(id, ignoreCond) {
    let r = row(id);
    let steps = 0;
    while (!ignoreCond && r && !isConditionMet(r.condition) && steps++ < MAX_CHAIN_STEPS) {
      id = r.next; r = row(id);
    }
    if (!r) {
      if (id) bus.emit('line:end', { id });
      finishChain();
      return;
    }
    playing = true; curId = id;
    const { text, native, nativeScript, galach } = lineParts(r);
    const isLore = r.speaker === 'Lore';
    // Длительность субтитра = длина записи озвучки (+ небольшая пауза между репликами); без записи — Duration из таблицы / оценка по тексту.
    const audioDur = isLore ? 0 : vo.duration(id);
    const duration = audioDur > 0 ? audioDur + 0.4 : (r.duration > 0 ? r.duration : (isLore ? clamp(0.07 * text.length + 2, 4, 10) : autoDuration(text)));
    remaining = duration;
    bus.emit('subtitle', { id, speaker: r.speaker, name: speakerName(r.speaker), text, native, nativeScript, galach, duration, kind: isLore ? 'lore' : 'line', emotion: r.emotion, chain: chainStart, audio: audioDur > 0 });
  }
  function lineDone() {
    const id = curId;
    const r = row(id);
    const next = r?.next;
    bus.emit('line:end', { id });
    if (next && next !== id) startLine(next, false);
    else finishChain();
  }
  function finishChain() {
    const start = chainStart;
    playing = false; curId = null; chainStart = null; remaining = 0;
    if (start) {
      bus.emit('chain:end', { id: start });
      const res = resolvers.get(start);
      resolvers.delete(start); pending.delete(start);
      res?.();
    }
    startNext();
  }
  function startNext() {
    if (playing || !queue.length) return;
    startChain(queue.shift());
  }
  function startChain(first) {
    chainStart = first;
    startLine(first, true); // первая реплика запрошена явно — её условие не проверяем
  }

  const api = {
    /** Играет цепочку; Promise выполняется в конце цепочки. Повторный запрос той же цепочки не дублируется. */
    play(id) {
      id = String(id ?? '').trim();
      if (!id) return Promise.resolve();
      if (pending.has(id)) return pending.get(id);
      const p = new Promise((res) => resolvers.set(id, res));
      pending.set(id, p);
      if (playing || queue.length) { queue.push(id); startNext(); } else startChain(id);
      return p;
    },
    /** Играет цепочку только если условие первой реплики выполнено (для реакций спутников). */
    tryPlay(id) {
      const r = row(id);
      if (!r || !isConditionMet(r.condition)) return Promise.resolve();
      return api.play(id);
    },
    lore(id) {
      const r = row(id);
      if (!r) return;
      if (id === lastLoreId && now() - lastLoreAt < 1) return; // дубль от интерактива и от директора
      lastLoreId = id; lastLoreAt = now();
      const text = textOf(r);
      const duration = r.duration > 0 ? r.duration : clamp(0.07 * text.length + 2, 4, 10);
      const nat = lineParts(r).native;
      bus.emit('subtitle', { id, speaker: 'Lore', name: '', text, native: nat, duration, kind: 'lore' });
    },
    /** Лай толпы: pos — Vector3 говорящего; работает только в радиусе 10 м от игрока. */
    bark(archetype, context, pos) {
      if (!barks.length) return null;
      const t = now();
      if (t - lastBarkAt < BARK_GLOBAL_INTERVAL) return null;
      const p = game.player?.position;
      if (pos && p && Math.hypot(pos.x - p.x, (pos.y ?? p.y) - p.y, pos.z - p.z) > BARK_RADIUS) return null;
      const cand = [];
      let total = 0;
      for (const b of barks) {
        if (archetype && b.archetype !== archetype) continue;
        if (context && b.context !== context) continue;
        const last = barkPlayed.get(b.id);
        if (last !== undefined && t - last < b.cooldown) continue;
        cand.push(b); total += b.weight;
      }
      if (!cand.length) return null;
      let pickW = Math.random() * total, chosen = cand[cand.length - 1];
      for (const b of cand) { pickW -= b.weight; if (pickW <= 0) { chosen = b; break; } }
      lastBarkAt = t; barkPlayed.set(chosen.id, t);
      // Во время сюжетной реплики — не более одного лай-субтитра одновременно.
      if (playing && t < barkUntil) return chosen;
      const text = textOf(chosen);
      const duration = clamp(autoDuration(text), 1.8, 5);
      barkUntil = t + duration;
      bus.emit('subtitle', { id: chosen.id, speaker: '', name: '', text, duration, kind: 'bark', pos: pos || null, archetype: chosen.archetype });
      return chosen;
    },
    stopAll() {
      queue.length = 0; playing = false; curId = null; chainStart = null; remaining = 0; barkUntil = -1000;
      cancelSpeech();
      for (const res of resolvers.values()) res();
      resolvers.clear(); pending.clear();
      bus.emit('dialogue:stop');
    },
    setFlag(f, v = true) { if (!f) return; if (v) flags.add(f); else flags.delete(f); },
    hasFlag: (f) => flags.has(f),
    isConditionMet, speakerName, pick, row, textOf, autoDuration,
    get isBusy() { return playing || queue.length > 0; },
    get isStoryLinePlaying() { return playing; },
    get currentLine() { return curId; },
    update(dt) {
      if (!playing) return;
      remaining -= dt;
      if (remaining <= 0) lineDone();
    },
  };

  bus.on('interact', ({ tag } = {}) => {
    if (!tag) return;
    flags.add(`Interact:${tag}`);
    // Теги вида Rakis.POI.LORE_X → строка LORE_X (надпись по центру).
    const m = /Rakis\.POI\.(LORE_\w+)/.exec(tag);
    if (m && row(m[1])) api.lore(m[1]);
  });
  bus.on('worm:state', ({ from, to } = {}) => {
    if (from) flags.delete(`WormState:${from}`);
    if (to) flags.add(`WormState:${to}`);
  });
  return game.add('dialogue', api);
}
