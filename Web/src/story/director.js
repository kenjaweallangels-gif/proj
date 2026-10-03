// Сюжетный директор (порт ARakisStoryDirector): исполняет game.data.StoryBeats.
// Триггеры: Start, ZoneEnter:<Zone>, Beat:<ID>, WormState:<State>, NoiseAbove:<x>, Interact:<Tag>.
// Действия: PlayDialogue, PlayCinematic, SetWeather, SetMusic, TitleCard, ForceWorm, CrowdRitual, Hint, FadeOut, EndDemo, Ellipsis.
// Каждый бит срабатывает один раз; Delay считается в игровом времени (пауза и фоторежим его замораживают).
import { ELLIPSIS, WORM_REVEAL, ZONES, desertZoneAt } from '../core/layout.js';
import { create as createDebug } from './debug.js';
import { createReactions } from './reactions.js';

const ZONE_ORDER = Object.keys(ZONES);
const MUSIC_STATES = ['Silence', 'DesertCalm', 'DesertDrone', 'WormThreat', 'WormReveal', 'Encounter', 'SietchLife', 'SietchNarrow', 'HallChorale'];
const TITLE_HOLD = 4;
// Встреча с червём — длинная, частично интерактивная сцена (резолвится, когда червь уходит): страховка 240 с.
const CINEMATIC_SAFETY = 240;
// Параметры склейки (как в ARakisStoryDirector, метры вместо сантиметров).
const ELLIPSIS_DEFAULT_WINDOW = 20;
const ELLIPSIS_DEFAULT_FADE = 1.2;
const ELLIPSIS_BLACK_HOLD = 0.6;
const ELLIPSIS_CARD_HOLD = 1.4;
const ELLIPSIS_CARD_FADE_IN = 0.5, ELLIPSIS_CARD_FADE_OUT = 0.6;
const ELLIPSIS_MIN_BEHIND = 15;
const ELLIPSIS_MAX_HEADING = 55 * Math.PI / 180;
const ELLIPSIS_MIN_SPEED = 0.6;
const ELLIPSIS_POLL = 0.25;

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
  B('S_A2_RevealWx', 21, 'Beat:S_A2_Stand', 'SetWeather', 'Worm_Reveal,3'),
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
  B('S_B5_End', 86, 'Beat:S_B5_Harmat', 'EndDemo', '', 2),
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
  let started = false, ended = false, ritualStarted = false;
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
        case 'FadeOut': actionFadeOut(b, p); return;
        case 'Ellipsis': actionEllipsis(b); return;
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
        case 'EndDemo': endDemo(); break;
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

  function endDemo() {
    if (ended) return;
    ended = true;
    game.ui?.endCard?.();
    bus.emit('end');
  }

  // ---- Кат-сцены ----
  function actionCinematic(b, p) {
    if (cinematicBeat) { console.warn(`[story] кат-сцена уже идёт, бит ${b.id} пропущен`); completeBeat(b); return; }
    cinematicBeat = b;
    let promise = null;
    try {
      if (/WormReveal|WormEncounter/i.test(p)) promise = game.worm?.playReveal?.() ?? game.worm?.playEncounter?.();
      else if (/HallFinale/i.test(p)) { game.audio?.finalChord?.(); promise = game.sietch?.playFinale?.(); }
    } catch (e) { console.error('[story] кат-сцена:', e); }
    // Если у сцены нет собственного модуля (нет Promise) и режим не включён — включаем сами (леттербокс, блокировка ввода).
    // Если модуль вернул Promise (встреча с червём: длинная, частично интерактивная), режим кат-сцены ведёт он сам:
    // HUD и леттербокс только в те части, где game.cinematic.active = true.
    let mine = false;
    const hasPromise = !!promise && typeof promise.then === 'function';
    if (!game.cinematic.active && !hasPromise) {
      game.cinematic.active = true; game.cinematic.owner = 'story'; mine = true;
      bus.emit('cinematic', { active: true, id: p });
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      cancel(safety);
      if (mine && game.cinematic.owner === 'story') {
        game.cinematic.active = false; game.cinematic.owner = null;
        bus.emit('cinematic', { active: false, id: p });
      }
      cinematicBeat = null;
      completeBeat(b);
    };
    const safety = schedule(CINEMATIC_SAFETY, finish);
    if (promise && typeof promise.then === 'function') promise.then(finish, finish);
    else schedule(/Hall/i.test(p) ? 9 : 6, finish); // фоллбек по времени
  }

  function actionFadeOut(b, p) {
    // Param = "сек[,удержание]": в чёрное за сек, через удержание (по умолч. 0.5) — обратно; <0 — остаться в чёрном.
    const [s, h] = p.split(',');
    const sec = s?.trim() ? Math.max(0, parseFloat(s)) : 1;
    let hold = h !== undefined ? parseFloat(h) : 0.5;
    // Если следом идёт EndDemo — остаёмся в чёрном.
    if (beats.some((x) => x.trigger === `Beat:${b.id}` && x.action === 'EndDemo')) hold = -1;
    const ui = game.ui;
    if (!ui?.fade) { schedule(sec, () => completeBeat(b)); return; }
    ui.fade(true, sec).then(() => {
      completeBeat(b);
      if (hold >= 0) schedule(hold, () => { if (!ended) ui.fade(false, sec); });
    });
  }

  // ---- Эллипсис ----
  // Param = <ТегЦели>[,<Fade>[,<Hours>]][,window=<с>][,pull=<BeatID>@<с>]...[|<RU>|<EN>]
  const ell = { phase: 'none', beat: null, key: null, fade: ELLIPSIS_DEFAULT_FADE, hours: 0, card: '', pulls: [], deadline: 0, deferred: [], source: null, poll: 0, last: null, lastReason: '' };
  const ellipsisEnabled = () => new URLSearchParams(location.search).get('ellipsis') !== '0' && game.settings.ellipsis !== false;

  function parseEllipsis(param) {
    let spec = param, card = '';
    const bar = param.indexOf('|');
    if (bar >= 0) { spec = param.slice(0, bar); card = param.slice(bar + 1).trim(); }
    const tokens = spec.split(',').map((s) => s.trim()).filter(Boolean);
    if (!tokens.length) return null;
    const out = { tag: tokens[0], fade: ELLIPSIS_DEFAULT_FADE, hours: 0, card, pulls: [], window: ELLIPSIS_DEFAULT_WINDOW };
    let positional = 0;
    for (const t of tokens.slice(1)) {
      const eq = t.indexOf('=');
      if (eq > 0) {
        const k = t.slice(0, eq).trim().toLowerCase(), v = t.slice(eq + 1).trim();
        if (k === 'window') out.window = Math.max(1, parseFloat(v));
        else if (k === 'pull') {
          const [id, sec] = v.split('@');
          if (sec !== undefined) out.pulls.push([id.trim(), Math.max(0, parseFloat(sec))]);
        }
        continue;
      }
      if (positional === 0) out.fade = Math.min(10, Math.max(0.1, parseFloat(t)));
      else if (positional === 1) out.hours = Math.min(24, Math.max(-24, parseFloat(t)));
      positional++;
    }
    return out;
  }
  /** Rakis.Ellipsis.A2 → ELLIPSIS.A2 из layout. */
  const ellipsisTarget = (tag) => ELLIPSIS[String(tag).split('.').pop()];

  function actionEllipsis(b) {
    if (ell.phase !== 'none') { console.warn(`[story] Ellipsis ${b.id} отклонён: другая склейка активна`); return; }
    if (!ellipsisEnabled()) return; // свободная игра
    const parsed = parseEllipsis(b.param);
    if (!parsed) { console.warn(`[story] Ellipsis ${b.id}: плохой Param`); return; }
    if (!ellipsisTarget(parsed.tag)) { declineEllipsis(`нет цели '${parsed.tag}'`); return; }
    Object.assign(ell, { phase: 'offer', beat: b, key: parsed.tag, fade: parsed.fade, hours: parsed.hours, card: parsed.card, pulls: parsed.pulls, deadline: game.time + parsed.window, deferred: [], poll: 0, last: null });
    pollEllipsis(0);
  }

  function checkEllipsisOffer(dt) {
    const T = ellipsisTarget(ell.key), p = game.player;
    if (!T || !p?.position) return 'нет цели или игрока';
    if (game.cinematic.active || cinematicBeat) return 'кат-сцена';
    if (game.paused || game.ui?.photoActive || game.ui?.blocking) return 'пауза / фоторежим';
    const ws = game.worm?.state;
    if (ws === 'Listening' || ws === 'Approach' || ws === 'Surface') return 'угроза червя';
    if (dlg()?.isStoryLinePlaying) return 'звучит сюжетная реплика';
    // Золотой путь: игрок позади цели (по её курсу) и идёт к ней.
    const fx = Math.cos(T.yaw), fz = Math.sin(T.yaw);
    const tx = T.x - p.position.x, tz = T.z - p.position.z;
    if (fx * tx + fz * tz < ELLIPSIS_MIN_BEHIND) return 'игрок не позади цели';
    let vx = 0, vz = 0;
    if (ell.last && dt > 0) { vx = (p.position.x - ell.last.x) / dt; vz = (p.position.z - ell.last.z) / dt; }
    else if (p.velocity) { vx = p.velocity.x; vz = p.velocity.z; }
    ell.last = { x: p.position.x, z: p.position.z };
    const sp = Math.hypot(vx, vz);
    if (sp < ELLIPSIS_MIN_SPEED) return 'игрок не идёт';
    const dist = Math.hypot(tx, tz) || 1;
    if (Math.acos(Math.min(1, (vx * tx + vz * tz) / (sp * dist))) > ELLIPSIS_MAX_HEADING) return 'игрок идёт мимо золотого пути';
    return '';
  }
  function pollEllipsis(dt) {
    if (ell.phase !== 'offer') return;
    const reason = checkEllipsisOffer(dt);
    if (!reason) { beginEllipsisCut(); return; }
    ell.lastReason = reason;
    if (!ellipsisEnabled()) declineEllipsis('Ellipsis выключен');
    else if (game.time >= ell.deadline) declineEllipsis(`окно предложения истекло (${reason})`);
  }
  function resetEllipsis() { Object.assign(ell, { phase: 'none', beat: null, deferred: [], pulls: [], last: null }); }
  function declineEllipsis(reason) {
    console.info(`[story] Ellipsis ${ell.beat?.id ?? ''} отклонён — ${reason} (свободная игра)`);
    const deferred = ell.deferred;
    resetEllipsis();
    for (const k of deferred) fireTrigger(k); // зоны, в которые успели войти, не теряются
  }

  function beginEllipsisCut() {
    ell.phase = 'fadingOut';
    game.player?.setInputLocked?.(true);
    const go = () => performEllipsisCut();
    if (game.ui?.fade) game.ui.fade(true, ell.fade).then(go); else schedule(ell.fade + 0.1, go);
  }
  function abortEllipsis(reason) {
    game.ui?.fade?.(false, ell.fade);
    game.player?.setInputLocked?.(false);
    declineEllipsis(reason);
  }
  function performEllipsisCut() {
    const T = ellipsisTarget(ell.key), p = game.player;
    if (ell.phase !== 'fadingOut') return;
    if (!T || !p?.teleport) { abortEllipsis('цель или игрок потеряны'); return; }
    if (game.cinematic.active || cinematicBeat) { abortEllipsis('началась кат-сцена'); return; }
    ell.phase = 'black';
    ell.source = game.zone;
    p.teleport(T.x, game.heightAt(T.x, T.z), T.z, T.yaw);
    game.companions?.teleportBehind?.();
    if (ell.hours && game.weather && !game.weatherManual) {
      if (game.weather.setHours) game.weather.setHours((game.weather.hours ?? 0) + ell.hours);
    }
    let hold = ELLIPSIS_BLACK_HOLD;
    if (ell.card && game.ui?.cutCard) {
      game.ui.cutCard(pick(ell.card), ELLIPSIS_CARD_HOLD);
      hold = ELLIPSIS_CARD_FADE_IN + ELLIPSIS_CARD_HOLD + ELLIPSIS_CARD_FADE_OUT + 0.15;
    }
    schedule(Math.max(hold, 0.1), beginEllipsisFadeIn);
  }
  function beginEllipsisFadeIn() {
    ell.phase = 'fadingIn';
    game.ui?.fade?.(false, ell.fade);
    const b = ell.beat;
    const deferred = ell.deferred; ell.deferred = [];
    const T = ellipsisTarget(ell.key);
    // 1) зоны, через которые «перепрыгнули», не играют свои биты
    consumeSkippedZones(ell.source, T ? desertZoneAt(T.x, T.z) : game.zone);
    // 2) склейка состоялась — Beat:<ID>
    completeBeat(b);
    // 3) биты зоны прибытия — после битов склейки
    for (const k of deferred) fireTrigger(k);
    // 4) сжатие времени: pull-биты
    for (const [id, sec] of ell.pulls) {
      const pb = beats.find((x) => x.id === id);
      if (!pb) { console.warn(`[story] Ellipsis pull — нет бита '${id}'`); continue; }
      if (!pb.fired) scheduleBeat(pb, sec);
      else if (!pb.completed && pb.timer && !pb.timer.dead && pb.timer.at - game.time > sec) { cancel(pb.timer); pb.timer = schedule(sec, () => executeBeat(pb)); }
    }
    schedule(Math.max(ell.fade, 0.1), () => {
      game.player?.setInputLocked?.(false);
      console.info(`[story] Ellipsis → ${ell.key} выполнен`);
      resetEllipsis();
    });
  }
  function consumeSkippedZones(from, to) {
    const a = ZONE_ORDER.indexOf(from), z = ZONE_ORDER.indexOf(to);
    if (a < 0 || z < 0 || z <= a + 1) return;
    for (let i = a + 1; i < z; i++) {
      const key = `ZoneEnter:${ZONE_ORDER[i]}`;
      for (const b of beats) if (!b.fired && b.trigger === key) { b.fired = true; console.info(`[story] бит ${b.id} «проглочен» склейкой`); }
    }
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
    if (ell.phase === 'fadingOut' || ell.phase === 'black') { if (!ell.deferred.includes(key)) ell.deferred.push(key); return; }
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

  let noiseAcc = 0;
  let reactions = null;
  const api = {
    /** Отладка: story.fire('ZoneEnter:B5_Hall'). */
    fire: (trigger) => fireTrigger(trigger),
    endDemo, startRitual,
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
    get ended() { return ended; },
    get ellipsisPhase() { return ell.phase; },
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
      if (ell.phase === 'offer') {
        ell.poll += dt;
        if (ell.poll >= ELLIPSIS_POLL) { const d = ell.poll; ell.poll = 0; pollEllipsis(d); }
      }
    },
  };
  load();
  game.add('story', api);
  reactions = createReactions(game, api);
  createDebug(game);
  return api;
}
