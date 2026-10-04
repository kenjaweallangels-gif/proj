// Сюжетный директор (порт ARakisStoryDirector): исполняет game.data.StoryBeats.
// Триггеры: Start, ZoneEnter:<Zone>, Beat:<ID>, WormState:<State>, NoiseAbove:<x>, Interact:<Tag>.
// Действия: PlayDialogue, PlayCinematic, SetWeather, SetMusic, TitleCard, ForceWorm, CrowdRitual, Hint.
// Демо НЕ заканчивается: ни затемнения, ни титра «Конец». После зала жизнь идёт дальше, управление свободно всегда (Ред. 2; FadeOut/EndDemo удалены).
// Всё происходит в реальном времени под управлением игрока: никаких склеек времени («N часов спустя») и кат-сцен с отнятым управлением.
// PlayCinematic лишь запускает реалтайм-последовательности модулей (worm.playReveal, sietch.playFinale) и ждёт их Promise; game.cinematic не трогает.
// Действие Ellipsis из старых таблиц распознаётся и игнорируется (бит считается выполненным).
// Виртуальные зоны сюжета (ZoneEnter:A5_Trail, ZoneEnter:A6_Cleft, ZoneEnter:C1_Garden): берутся из game.approach.zoneAt / game.garden.zoneAt, а при их отсутствии — по геометрии ENTRY/GARDEN.
// Каждый бит срабатывает один раз; Delay считается в игровом времени (пауза и фоторежим его замораживают).
import { WORM_REVEAL, ENTRY, GARDEN } from '../core/layout.js';
import { create as createDebug } from './debug.js';
import { createReactions } from './reactions.js';

const MUSIC_STATES = ['Silence', 'DesertCalm', 'DesertDrone', 'WormThreat', 'WormReveal', 'Encounter', 'SietchLife', 'SietchNarrow', 'HallChorale'];
const TITLE_HOLD = 4;
// Встреча с червём — длинная реалтайм-сцена (Promise резолвится после разговора с Оссаной): страховка 240 с.
const CINEMATIC_SAFETY = 240;
/** Встроенный сценарий на случай, если StoryBeats не загрузились (как BuiltInBeats в UE). */
const B = (id, order, trigger, action, param, delay = 0) => ({ id, order, trigger, action, param, delay });
const BUILTIN = [
  B('S_Start_Weather', 0, 'Start', 'SetWeather', 'Dawn_Ridge,0'),
  B('S_Start_Music', 1, 'Start', 'SetMusic', 'DesertCalm'),
  B('S_A1_Title', 2, 'Start', 'TitleCard', 'Ракис. Гребень Шайтана. Рассвет|Rakis. Shaitan\'s Ridge. Dawn', 3),
  B('S_A1_Line', 3, 'Start', 'PlayDialogue', 'A1_Ilva_01', 11),
  B('S_A1_Hint', 4, 'Beat:S_A1_Line', 'Hint', 'Alt (LB) — походка по песку, C — сменить режим. Сбивайте ритм.|Alt (LB) to sand-walk, C switches gait mode. Break your rhythm.', 1),
  B('S_A2_Weather', 10, 'ZoneEnter:A2_Erg', 'SetWeather', 'Morning_Erg,10'),
  B('S_A2_Music', 11, 'ZoneEnter:A2_Erg', 'SetMusic', 'DesertDrone'),
  B('S_A2_Title', 12, 'ZoneEnter:A2_Erg', 'TitleCard', 'Открытый эрг|The Open Erg', 1),
  B('S_A2_Line', 13, 'ZoneEnter:A2_Erg', 'PlayDialogue', 'A2_Rayn_01', 12),
  B('S_A2_Tension', 14, 'ZoneEnter:A2_Erg', 'SetWeather', 'Worm_Tension,6', 40),
  B('S_A2_ThreatMusic', 15, 'ZoneEnter:A2_Erg', 'SetMusic', 'WormThreat', 42),
  B('S_A2_Stand', 16, 'ZoneEnter:A2_Erg', 'PlayDialogue', 'A2_Kair_02', 45),
  B('S_A2_WormHint', 17, 'WormState:Listening', 'Hint', 'Не бегите. Держитесь камня.|Don\'t run. Keep to the rock.'),
  B('S_A2_RevealTitle', 20, 'Beat:S_A2_Stand', 'TitleCard', 'Шай-Хулуд|Shai-Hulud', 0.5),
  B('S_A2_RevealWx', 21, 'Beat:S_A2_Stand', 'SetWeather', 'Worm_Reveal,4'),
  B('S_A2_RevealMusic', 22, 'Beat:S_A2_Stand', 'SetMusic', 'WormReveal'),
  B('S_A2_Reveal', 23, 'Beat:S_A2_Stand', 'PlayCinematic', '/Game/Rakis/Cinematics/LS_WormReveal', 1),
  B('S_A2_AfterWx', 24, 'Beat:S_A2_Reveal', 'SetWeather', 'Morning_Erg,8'),
  B('S_A2_AfterMusic', 25, 'Beat:S_A2_Reveal', 'SetMusic', 'DesertDrone'),
  B('S_A3_Title', 30, 'ZoneEnter:A3_Approach', 'TitleCard', 'Коготь|The Claw', 1),
  B('S_A3_Weather', 31, 'ZoneEnter:A3_Approach', 'SetWeather', 'Noon_Approach,12'),
  B('S_A3_Storm', 33, 'ZoneEnter:A3_Approach', 'SetWeather', 'Storm_Horizon,20', 30),
  B('S_A4_Weather', 40, 'ZoneEnter:A4_Crevice', 'SetWeather', 'Crevice_Shade,4'),
  B('S_B1_Title', 50, 'ZoneEnter:B1_Airlock', 'TitleCard', 'Табр-ан-Нур|Tabr-an-Nur', 1),
  B('S_B1_Weather', 51, 'ZoneEnter:B1_Airlock', 'SetWeather', 'Sietch_Interior,3'),
  B('S_B1_Guard', 52, 'ZoneEnter:B1_Airlock', 'PlayDialogue', 'B1_Guard_01', 2.5),
  B('S_B2_Music', 60, 'ZoneEnter:B2_Gallery', 'SetMusic', 'SietchLife'),
  B('S_B2_RitualTimer', 61, 'ZoneEnter:B2_Gallery', 'CrowdRitual', '', 240),
  B('S_B3_Music', 70, 'ZoneEnter:B3_Passages', 'SetMusic', 'SietchNarrow'),
  B('S_B3_Ritual', 71, 'ZoneEnter:B3_Passages', 'CrowdRitual', ''),
  B('S_B3_Ilva', 72, 'ZoneEnter:B3_Passages', 'PlayDialogue', 'B3_Ilva_01', 8),
  B('S_B5_Title', 80, 'ZoneEnter:B5_Hall', 'TitleCard', 'Глотка Бога|The Throat of God', 1),
  B('S_B5_Weather', 81, 'ZoneEnter:B5_Hall', 'SetWeather', 'Hall_Ritual,4'),
  B('S_B5_Music', 82, 'ZoneEnter:B5_Hall', 'SetMusic', 'HallChorale'),
  B('S_B5_Ritual', 83, 'ZoneEnter:B5_Hall', 'CrowdRitual', ''),
  B('S_B5_Finale', 84, 'ZoneEnter:B5_Hall', 'PlayCinematic', '/Game/Rakis/Cinematics/LS_HallFinale', 8),
  B('S_B5_Harmat', 85, 'Beat:S_B5_Finale', 'PlayDialogue', 'B5_Harmat_01', 0.5),
];

export function create(game) {
  const { bus } = game;
  const dlg = () => game.dialogue;
  const pick = (pipe) => (dlg()?.pick ? dlg().pick(pipe) : String(pipe).split('|').pop().trim());

  // ---- Таймеры в игровом времени ----
  const timers = [];
  function schedule(delay, fn) {
    const h = { at: game.time + Math.max(0, delay), fn, dead: false };
    timers.push(h);
    return h;
  }
  const cancel = (h) => { if (h) h.dead = true; };

  // ---- Биты ----
  let beats = [];
  let started = false, ritualStarted = false;
  let cinematicBeat = null;
  let hasNoiseBeats = false;
  let lastStoryWeather = null;     // последний SetWeather сюжета (применённый или пропущенный из-за ручного режима)

  function load() {
    const src = game.data?.StoryBeats;
    const rows = Array.isArray(src) && src.length ? src : BUILTIN;
    if (rows === BUILTIN) console.warn('[story] StoryBeats отсутствуют — встроенный сценарий');
    beats = rows.map((r) => {
      const b = { ...r, fired: false, completed: false, timer: null, noise: -1 };
      const m = /^NoiseAbove:\s*([\d.]+)/i.exec(b.trigger || '');
      if (m) { b.noise = Math.min(10, Math.max(0, parseFloat(m[1]))); hasNoiseBeats = true; }
      return b;
    }).sort((a, b) => a.order - b.order);
  }

  function fireTrigger(key) {
    if (!key) return;
    for (const b of beats) if (!b.fired && b.trigger === key) scheduleBeat(b);
  }
  function scheduleBeat(b, overrideDelay = -1) {
    if (b.fired) return;
    b.fired = true;
    bus.emit('story:beat', { id: b.id, state: 'fired' });
    const d = overrideDelay >= 0 ? overrideDelay : b.delay;
    if (d > 0) b.timer = schedule(d, () => executeBeat(b));
    else executeBeat(b);
  }
  function completeBeat(b) {
    if (!b || b.completed) return;
    b.completed = true;
    dlg()?.setFlag?.(`Beat:${b.id}`, true);
    bus.emit('story:beat', { id: b.id, state: 'completed' });
    fireTrigger(`Beat:${b.id}`);
  }

  // ---- Исполнение ----
  function executeBeat(b) {
    const p = String(b.param ?? '').trim();
    try {
      switch (b.action) {
        case 'PlayDialogue': {
          if (!p || !dlg()) { completeBeat(b); return; }
          dlg().play(p).then(() => completeBeat(b));
          return;
        }
        case 'PlayCinematic': actionCinematic(b, p); return;
        case 'Ellipsis': console.info(`[story] Ellipsis ${b.id} устарел (всё в реальном времени) — пропущен`); break;
        case 'SetWeather': {
          const [id, blend] = p.split(',').map((s) => s.trim());
          const sec = blend !== undefined && blend !== '' ? Math.max(0, parseFloat(blend)) : 8;
          lastStoryWeather = { id, sec };
          // Ручной выбор игрока (меню «Погода и время») важнее сюжета, пока он не нажмёт «Вернуть сюжетную погоду».
          if (game.weatherManual) { console.info(`[story] SetWeather ${id} пропущен: ручная погода`); break; }
          game.weather?.request?.(id, sec);
          break;
        }
        case 'SetMusic':
          if (MUSIC_STATES.includes(p)) game.audio?.setMusic?.(p);
          else console.warn(`[story] неизвестное состояние музыки '${p}'`);
          break;
        case 'TitleCard': game.ui?.titleCard?.(pick(p), TITLE_HOLD); break;
        case 'Hint': game.ui?.hint?.(pick(p)); break;
        case 'ForceWorm': game.worm?.forceSurface?.(WORM_REVEAL.x, WORM_REVEAL.z); break;
        case 'CrowdRitual': startRitual(); break;
        case 'FadeOut': case 'EndDemo': console.info(`[story] ${b.action} (${b.id}) устарел: демо не заканчивается — пропущен`); break;
        default: console.warn(`[story] неизвестное действие '${b.action}' в бите ${b.id}`);
      }
    } catch (e) { console.error(`[story] бит ${b.id}:`, e); }
    completeBeat(b);
  }

  function startRitual() {
    if (ritualStarted) return;
    ritualStarted = true;
    game.sietch?.startRitual?.();
    bus.emit('ritual');
  }

  // ---- Реалтайм-последовательности (бывшие кат-сцены) ----
  function actionCinematic(b, p) {
    if (cinematicBeat) { console.warn(`[story] кат-сцена уже идёт, бит ${b.id} пропущен`); completeBeat(b); return; }
    cinematicBeat = b;
    let promise = null;
    try {
      if (/WormReveal|WormEncounter/i.test(p)) promise = game.worm?.playReveal?.() ?? game.worm?.playEncounter?.();
      else if (/HallFinale/i.test(p)) { game.audio?.finalChord?.(); promise = game.sietch?.playFinale?.(); }
    } catch (e) { console.error('[story] кат-сцена:', e); }
    // Режим кат-сцены (game.cinematic, леттербокс, блокировка ввода) здесь НЕ включается: это реалтайм-последовательности,
    // игрок сохраняет управление; модуль сам решает, что делать с камерой/ограничениями.
    const hasPromise = !!promise && typeof promise.then === 'function';
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      cancel(safety);
      cinematicBeat = null;
      completeBeat(b);
    };
    const safety = schedule(CINEMATIC_SAFETY, finish);
    if (hasPromise) promise.then(finish, finish);
    else schedule(/Hall/i.test(p) ? 9 : 6, finish); // фоллбек по времени
  }

  // ---- Подписки ----
  bus.on('start', () => {
    if (started) return;
    started = true;
    // Небольшая задержка, чтобы HUD, зоны и спутники успели подписаться.
    schedule(0.5, () => { fireTrigger('Start'); if (game.zone) fireTrigger(`ZoneEnter:${game.zone}`); });
  });
  bus.on('zone', ({ to } = {}) => {
    if (!to) return;
    const key = `ZoneEnter:${to}`;
    fireTrigger(key);
  });
  bus.on('worm:state', ({ to } = {}) => { if (to) fireTrigger(`WormState:${to}`); });
  // Встреча с приручённым червём: прибытие → величественная тема, разговор → низкий хор + рамочный барабан, отход → нарастание.
  bus.on('worm:encounter', ({ phase } = {}) => {
    const ph = String(phase || '').toLowerCase();
    if (/arriv|reveal|appear|emerge|breach|approach|start/.test(ph)) game.audio?.setMusic?.('WormReveal');
    else if (/talk|dialog|speak|rider|meet|encounter|converse/.test(ph)) game.audio?.setMusic?.('Encounter');
    else if (/depart|leave|left|gone|exit|end|away|dive/.test(ph)) game.audio?.swell?.();
  });
  bus.on('interact', ({ tag } = {}) => { if (tag) { dlg()?.setFlag?.(`Interact:${tag}`, true); fireTrigger(`Interact:${tag}`); } });

  let noiseAcc = 0, zonePoll = 0;
  const lastVZ = { approach: null, garden: false, cleft: false };
  // Виртуальные зоны: тропа по скале, щель-вход, сад. Дубли с bus 'zone' безвредны (бит срабатывает один раз).
  function pollVirtualZones() {
    const pos = game.player?.position;
    if (!pos) return;
    const ap = game.approach?.zoneAt?.(pos);
    if (ap !== undefined) {
      if (ap && ap !== lastVZ.approach) fireTrigger(`ZoneEnter:${ap}`);
      lastVZ.approach = ap || null;
    } else {
      // геометрия: тропа от подножия к щели
      const a = ENTRY.trailStart, c = ENTRY.cleft, dx = c.x - a.x, dz = c.z - a.z, L2 = dx * dx + dz * dz;
      const t = ((pos.x - a.x) * dx + (pos.z - a.z) * dz) / L2;
      const lat = Math.hypot(pos.x - (a.x + dx * t), pos.z - (a.z + dz * t));
      if (t > 0.22 && t < 1.05 && lat < 20 && pos.y > (game.heightAt(a.x, a.z) + 3)) fireTrigger('ZoneEnter:A5_Trail');
    }
    if (!lastVZ.cleft && Math.hypot(pos.x - ENTRY.cleft.x, pos.z - ENTRY.cleft.z) < 9 && Math.abs(pos.y - ENTRY.cleft.y) < 14) {
      lastVZ.cleft = true; fireTrigger('ZoneEnter:A6_Cleft');
    }
    if (!game.garden?.zoneAt && !lastVZ.garden && Math.hypot(pos.x - GARDEN.center.x, pos.z - GARDEN.center.z) < GARDEN.radius * 0.8) {
      lastVZ.garden = true; fireTrigger('ZoneEnter:C1_Garden');
    }
  }
  let reactions = null;
  const api = {
    /** Отладка: story.fire('ZoneEnter:B5_Hall'). */
    fire: (trigger) => fireTrigger(trigger),
    startRitual,
    /** Отладка: запустить кат-сцену по Param (WormReveal / HallFinale) без бита. */
    playCinematic: (param) => actionCinematic({ id: `DBG_${param}`, fired: true, completed: false }, String(param)),
    /** «Вернуть сюжетную погоду»: снимает ручной режим и применяет последний пресет сюжета. */
    restoreWeather() {
      game.weatherManual = false;
      if (lastStoryWeather) game.weather?.request?.(lastStoryWeather.id, 3);
    },
    get lastStoryWeather() { return lastStoryWeather; },
    isFired: (id) => !!beats.find((b) => b.id === id)?.fired,
    isCompleted: (id) => !!beats.find((b) => b.id === id)?.completed,
    get beats() { return beats; },
    get started() { return started; },
    /** Совместимость: демо не заканчивается никогда. */
    get ended() { return false; },
    /** Совместимость: склеек больше нет. */
    get ellipsisPhase() { return 'none'; },
    list() { console.table(beats.map((b) => ({ id: b.id, order: b.order, trigger: b.trigger, action: b.action, fired: b.fired, done: b.completed }))); },
    update(dt) {
      // таймеры игрового времени
      for (let i = 0; i < timers.length; i++) {
        const h = timers[i];
        if (h.dead) { timers.splice(i--, 1); continue; }
        if (game.time >= h.at) {
          timers.splice(i--, 1);
          try { h.fn(); } catch (e) { console.error('[story] таймер:', e); }
        }
      }
      if (!started) return;
      reactions?.update(dt);
      if (hasNoiseBeats) {
        noiseAcc += dt;
        if (noiseAcc >= 0.1) {
          noiseAcc = 0;
          const n = game.player?.noise;
          if (typeof n === 'number') for (const b of beats) if (!b.fired && b.noise >= 0 && n > b.noise) scheduleBeat(b);
        }
      }
      zonePoll -= dt;
      if (zonePoll <= 0) { zonePoll = 0.4; pollVirtualZones(); }
    },
  };
  load();
  game.add('story', api);
  reactions = createReactions(game, api);
  createDebug(game);
  return api;
}
