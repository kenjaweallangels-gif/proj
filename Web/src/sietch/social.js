// Социальная жизнь сиетча: распорядок дня по ролям, разговоры (пары/группы лицом друг к другу), покупатели у прилавков, трапеза, молитва,
// «мать с детьми», патрули стражи, реакции на игрока (взгляд с ограничениями, шаг в сторону вместо толчка, редкие реплики), тревога.
// Поведение — на таймерах и событиях (никакой логики «в каждом кадре» сверх лёгкой реакции на игрока для ближних).
// Все числа — в SOCIAL_CFG (аналог DataAsset).
import * as THREE from 'three';
import { clamp, damp } from '../core/util.js';
import { faceYaw } from './shapes.js';

export const SOCIAL_CFG = {
  // сутки сиетча (сжатые): работа → молитва → трапеза → работа ...; t0 — сколько секунд цикла уже прошло к старту
  clock: { work: 125, prayer: 26, rest: 55, t0: 40 },
  // доля участников [молитва, трапеза] по виду
  part: { stall: [0.7, 0.6], loom: [0.6, 0.5], water: [0.5, 0.4], repair: [0.6, 0.5], elder: [1, 0.7], wander: [0.9, 0.8], wanderB3: [0.8, 0.5], play: [0, 0.6], hooks: [0.4, 0.6], shrine: [0, 0] },
  qibla: Math.PI / 2,      // курс молящихся (в сторону зала, +X)
  prayDelay: 9,            // с: разброс начала молитвы
  mealDelay: 20, mealDur: [24, 42], mealGroupTalk: 0.4,
  excursion: { stall: [55, 110], water: [70, 130], loom: [60, 120], repair: [60, 120], hooks: [45, 90], shrine: [38, 60], elder: [90, 160] },
  errandWeights: {         // browse, water, loom, bench, music, stroll, chat, shrine
    Trader: [0.34, 0.08, 0, 0.08, 0.04, 0.18, 0.28, 0], Pilgrim: [0.08, 0.04, 0.02, 0.18, 0.1, 0.22, 0.2, 0.16], WaterCarrier: [0.12, 0.38, 0, 0.04, 0.04, 0.22, 0.2, 0],
    Artisan: [0.3, 0.12, 0.08, 0.04, 0.04, 0.2, 0.22, 0], Weaver: [0.28, 0.06, 0.18, 0.04, 0.08, 0.3, 0.06, 0], Elder: [0.04, 0.04, 0, 0.42, 0.14, 0.26, 0.1, 0], Guard: [0.1, 0, 0, 0.1, 0, 0.7, 0.1, 0],
  },
  errandDur: { browse: [9, 20], water: [7, 14], loom: [8, 16], bench: [22, 48], music: [24, 50], shrine: [18, 32], stroll: [3, 12] },
  chat: { max: 4, every: [6, 11], dur: [18, 40], turn: [2.2, 5.5], radius: [0.62, 0.84, 0.98], maxDist: 20, gather: 28, joinRange: 6, joinP: 0.3 },
  glance: { range: 4.8, dur: [1.2, 2.8], durVendor: [3.5, 7], cooldown: [9, 24], weight: 0.85, maxAng: 1.95, turnBodyAng: 1.0, turnDelay: 0.5 },
  yield: { range: 1.05, step: 0.9, back: 2.6, backDelay: 1.6, cooldown: 3.5 },
  bark: { global: [15, 26], own: [75, 140], range: 3.8, p: 0.22 },
  alert: { hush: 5, panic: 7 },
  patrol: { points: 3, pause: [3, 7] },
  kids: { followDist: 1.2, retarget: 0.8, playRadius: 2.3 },
};

const TAU = Math.PI * 2;
const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const yawTo = (ax, az, bx, bz) => Math.atan2(bx - ax, bz - az);
const rr = (R, [a, b]) => a + (b - a) * R();

export function createSocial(env) {
  const { game, nav, mover, npcs, S, R, plan } = env;
  const SC = SOCIAL_CFG;
  const stats = { chats: 0, chatMembers: 0, browse: 0, meal: 0, pray: 0, patrol: 0, bench: 0, music: 0, shrine: 0, stroll: 0, yield: 0, glance: 0, barks: 0, visits: 0, alerts: 0, groupTalk: 0 };
  const _v = new THREE.Vector3();
  const chats = [];
  let chatT = 4, phase = 'work', phaseT = SC.clock.t0, now = 0, alertUntil = 0, alertKind = '', alertAt = null, barkGlobal = 6;
  const isWander = (n) => n.kind === 'wander' || n.kind === 'wanderB3';
  const bodyOf = (n) => n.lk.height * 0.93;

  // ------------------------------------------------------------------ точки (smart objects) ----
  const vendors = npcs.filter((n) => n.kind === 'stall');
  const waterKeeper = npcs.find((n) => n.kind === 'water');
  const looms = npcs.filter((n) => n.kind === 'loom');
  const priest = npcs.find((n) => n.kind === 'elder');
  if (priest) priest.job = 'priest';
  for (const n of npcs) {
    if (n.kind === 'stall') n.job = n.arch === 'Artisan' ? 'craftsman' : 'trader';
    else if (n.kind === 'water' || n.kind === 'poolWatch') n.job = 'waterkeeper';
    else if (n.kind === 'repair' && n.arch === 'Artisan') n.job = 'craftsman';
    else if (n.kind === 'hooks' || n.kind.startsWith('guard') || n.kind === 'cellarGuard') n.job = 'guard';
    { const k = nav.nearestCell(n.home.x, n.home.z, 1.5); n.canLeave = k >= 0 && nav.comp[k] === nav.mainComp;
      if (!n.canLeave) { const m = nav.nearestCell(n.home.x, n.home.z, 5, nav.mainComp); if (m >= 0) n.exitPortal = { x: nav.ox + ((m % nav.nx) + 0.5) * nav.cell, z: nav.oz + (((m / nav.nx) | 0) + 0.5) * nav.cell }; } }
    n.cust = []; n.gz = { w: 0, mode: 0, until: 0, cd: R() * 8, t0: 0 }; n.yieldCd = 0; n.yieldBackT = 0; n.excT = R() * 40 + 10; n.baseYaw = n.home.yaw; n.bark2 = R() * 30;
  }
  // места трапезы у кухни (Пуассон-выборка по сетке навигации)
  const mealSpots = [];
  {
    const kit = S.cook[0] || { x: 92, z: -5.4 }, pick = [];
    for (let t = 0; t < 400 && pick.length < 22; t++) {
      const p = nav.randomPoint(kit.x - 8, kit.x + 3.5, -3.6, 3.4, 0.65, R); if (!p) continue;
      if (pick.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 1.15)) continue;
      if (S.elder.some((e) => Math.hypot(e.x - p.x, e.z - p.z) < 1.2) || S.coffee.some((e) => Math.hypot(e.x - p.x, e.z - p.z) < 1.2)) continue;
      pick.push({ x: p.x, z: p.z, n: null, yaw: yawTo(p.x, p.z, kit.x - 1.0, kit.z + 1.2) });
    }
    mealSpots.push(...pick);
  }
  // точка «благословения» жреца: центр галереи
  const lead = nav.randomPoint(56, 66, -1.2, 1.2, 1.2, R) || { x: 60, z: 0 };

  // ------------------------------------------------------------------ вспомогательное ----
  const setTask = (n, type, o = {}) => { n.task = { type, t0: now, ...o }; };
  const idle = (n) => n.mode === 'act' && !n.task && !n.special && !n.chat;
  const free = (x, z, c = 0.45) => nav.walkable(x, z) && nav.clearanceAt(x, z) >= c;
  function slotNear(x, z, rad = 1.2, c = 0.5) {
    if (free(x, z, c)) return { x, z };
    const p = nav.snap(x, z, rad); return p && nav.clearanceAt(p.x, p.z) >= c * 0.8 ? { x: p.x, z: p.z } : null;
  }
  function goHome(n) {
    n.mode = 'act'; n.task = null;
    const h = n.home;
    if (Math.hypot(h.x - n.x, h.z - n.z) < 0.25) { n.baseYaw = h.yaw; n.goalYaw = h.yaw; n.excT = rr(R, SC.excursion[n.kind] || [60, 120]); return; }
    mover.goTo(n, h.x, h.z, () => { n.baseYaw = h.yaw; n.goalYaw = h.yaw; n.excT = rr(R, SC.excursion[n.kind] || [60, 120]); n.yielded = null; n.giveUps = 0; }, { direct: !n.canLeave });
  }
  /** Задание закончено: бродяги идут дальше по делам, «домашние» возвращаются на пост. */
  function release(n) {
    const t = n.task; n.task = null; n.talk = false; n.lookNpc = null; n.partner = null;
    if (n.chat) leaveChat(n);
    if (t?.vendor) { const i = t.vendor.cust.indexOf(n); if (i >= 0) t.vendor.cust.splice(i, 1); if (!t.vendor.cust.length) t.vendor.lookNpc = null; }
    if (t?.meal) { t.meal.n = null; }
    n.pose = 'stand';
    if (isWander(n) || n.kind === 'play') { n.mode = 'act'; n.timer = 0.2 + R() * 1.5; n.errandCd = 0; return; }
    goHome(n);
  }
  function cancelAll(n) {
    if (n.pathReq || n.mode === 'walk') { mover.cancel(n); if (n.mode === 'walk') { n.mode = 'act'; n.vx = n.vz = 0; n.speedNow = 0; n.speedBoost = 1; n.irregular = 0; } }
    const t = n.task; if (t?.vendor) { const i = t.vendor.cust.indexOf(n); if (i >= 0) t.vendor.cust.splice(i, 1); }
    if (t?.meal) t.meal.n = null;
    if (n.chat) leaveChat(n);
    n.task = null; n.talk = false; n.lookNpc = null; n.partner = null;
  }

  // ------------------------------------------------------------------ разговоры ----
  function chatLayout(c) {
    const k = c.members.length, r = SC.chat.radius[Math.min(2, k - 2)];
    for (let tries = 0; tries < 4; tries++) {
      const base = c.base + tries * (Math.PI / 2), slots = [];
      let okAll = true;
      for (let i = 0; i < k; i++) {
        const a = base + (i * TAU) / k, s = slotNear(c.x + Math.cos(a) * r, c.z + Math.sin(a) * r, 0.5, 0.42);
        if (!s) { okAll = false; break; } slots.push(s);
      }
      if (okAll) { c.slots = slots; return true; }
    }
    return false;
  }
  function chatSendSlots(c, first) {
    c.members.forEach((m, i) => {
      const s = c.slots[i]; m.chatSlot = s; m.chatReady = false;
      const face = yawTo(s.x, s.z, c.x, c.z);
      if (Math.hypot(m.x - s.x, m.z - s.z) < 0.3) { m.chatReady = true; m.baseYaw = face; return; }
      mover.goTo(m, s.x, s.z, () => { m.chatReady = true; m.baseYaw = face; m.goalYaw = face; }, { speed: 1 });
    });
  }
  function leaveChat(n) {
    const c = n.chat; if (!c) return;
    const i = c.members.indexOf(n); if (i >= 0) c.members.splice(i, 1);
    n.chat = null; n.chatReady = false; n.lookNpc = null; n.talk = false;
    if (c.members.length < 2) endChat(c);
  }
  function endChat(c) {
    const i = chats.indexOf(c); if (i >= 0) chats.splice(i, 1);
    for (const m of c.members.slice()) { m.chat = null; m.chatReady = false; release(m); }
    c.members.length = 0;
  }
  function startChat(a, b) {
    const x = (a.x + b.x) / 2, z = (a.z + b.z) / 2;
    const c = { id: ++env.seq, members: [], x, z, base: Math.atan2(a.z - b.z, a.x - b.x), state: 'gather', t: 0, dur: rr(R, SC.chat.dur), speaker: 0, turnT: 0, listener: 1 };
    // центр на проходимой клетке
    const s = slotNear(x, z, 2, 0.8); if (!s) return null; c.x = s.x; c.z = s.z;
    for (const m of [a, b]) { cancelAll(m); m.chat = c; m.mode = 'act'; setTask(m, 'chat'); c.members.push(m); m.talk = false; }
    if (!chatLayout(c)) { for (const m of c.members) { m.chat = null; m.task = null; } return null; }
    chats.push(c); chatSendSlots(c); stats.chats++; stats.chatMembers += 2;
    return c;
  }
  function joinChat(n, c) {
    cancelAll(n); n.chat = c; setTask(n, 'chat'); c.members.push(n); n.mode = 'act';
    if (!chatLayout(c)) { c.members.pop(); n.chat = null; n.task = null; return false; }
    chatSendSlots(c); c.state = 'gather'; c.t = 0; stats.chatMembers++;
    return true;
  }
  function updateChats(dt) {
    for (const c of chats.slice()) {
      c.t += dt;
      if (c.state === 'gather') {
        if (c.members.every((m) => m.chatReady)) { c.state = 'talk'; c.t = 0; c.turnT = 0; c.speaker = Math.floor(R() * c.members.length); }
        else if (c.t > SC.chat.gather) { endChat(c); continue; }
      }
      if (c.state === 'talk') {
        c.turnT -= dt;
        if (c.turnT <= 0) {
          c.turnT = rr(R, SC.chat.turn);
          c.speaker = (c.speaker + 1 + Math.floor(R() * (c.members.length - 1))) % c.members.length;
          c.listener = (c.speaker + 1 + Math.floor(R() * (c.members.length - 1))) % c.members.length;
        }
        c.members.forEach((m, i) => {
          if (!m.chatReady) return;
          const spk = i === c.speaker;
          m.talk = spk && !m.silent; m.pose = spk && !m.silent ? 'gesture' : 'listen'; m.mode = 'act';
          m.lookNpc = spk ? c.members[c.listener] : c.members[c.speaker];
          m.baseYaw = yawTo(m.x, m.z, c.x, c.z);
        });
        if (c.t > c.dur) endChat(c);
      }
    }
  }
  function tryStartChats() {
    if (chats.length >= SC.chat.max) return;
    // кандидат A: стоящий бродяга без задач; B — ближайший такой же
    const cand = npcs.filter((n) => isWander(n) && idle(n) && n.lod !== 'off' && !n.leader);
    if (cand.length < 2) return;
    const a = cand[Math.floor(R() * cand.length)];
    let b = null, bd = SC.chat.maxDist ** 2;
    for (const o of cand) { if (o === a) continue; const d = (o.x - a.x) ** 2 + (o.z - a.z) ** 2; if (d < bd) { bd = d; b = o; } }
    if (b) startChat(a, b);
  }

  // ------------------------------------------------------------------ задания ----
  function startBrowse(n, vendor, after) {
    const s = vendor.spot, side = s.side ?? (vendor.kind === 'water' ? -1 : 0);
    let fx, fz, face;
    if (vendor.kind === 'stall') { fz = side * 3.3; face = side > 0 ? 0 : Math.PI; }
    else if (vendor.kind === 'water') { fz = 3.7; face = 0; }
    else { fz = vendor.z - 1.0; face = yawTo(vendor.x, vendor.z - 1.0, vendor.x, vendor.z); }
    const offs = [0, -0.9, 0.9]; let pos = null;
    for (const o of offs) {
      const x = vendor.x + o; if (vendor.cust.some((c) => Math.abs(c.task?.fx - x) < 0.6)) continue;
      pos = slotNear(x, fz, 0.8, 0.4); if (pos) { fx = pos.x; break; }
    }
    if (!pos) return false;
    cancelAll(n); setTask(n, 'browse', { vendor, fx, fz: pos.z, until: 0, stage: 'go', after });
    vendor.cust.push(n); stats.browse++;
    mover.goTo(n, pos.x, pos.z, () => { n.task.stage = 'at'; n.task.until = now + rr(R, SC.errandDur[vendor.kind === 'stall' ? 'browse' : vendor.kind === 'water' ? 'water' : 'loom']); n.baseYaw = face; n.goalYaw = face; vendor.lookNpc = n; });
    return true;
  }
  function startMeal(n) {
    if (!n.canLeave) { // за прилавком/станком: ест на месте
      cancelAll(n); setTask(n, 'meal', { stage: 'eat', until: now + rr(R, SC.mealDur), post: true }); stats.meal++; return true;
    }
    const spot = mealSpots.filter((s) => !s.n).sort((a, b) => Math.hypot(a.x - n.x, a.z - n.z) - Math.hypot(b.x - n.x, b.z - n.z))[0];
    if (!spot) return false;
    cancelAll(n); spot.n = n; setTask(n, 'meal', { meal: spot, stage: 'go' }); stats.meal++;
    mover.goTo(n, spot.x, spot.z, () => { n.task.stage = 'eat'; n.task.until = now + rr(R, SC.mealDur); n.baseYaw = spot.yaw; n.goalYaw = spot.yaw; });
    return true;
  }
  function startPray(n) {
    cancelAll(n);
    setTask(n, 'pray', { stage: 'kneel', until: now + Math.max(8, phaseLeft() + R() * 3) }); stats.pray++;
    n.baseYaw = SC.qibla; n.goalYaw = SC.qibla;
  }
  function softStop(n, then) {
    // плавная остановка: короткий отрезок по инерции
    if (n.mode !== 'walk') { then(); return; }
    mover.cancel(n); n.mode = 'walk'; n.path = [[n.x + (n.vx || 0) * 0.7, n.z + (n.vz || 0) * 0.7]]; n.pi = 0; n.after = then; n.goal = null;
  }
  function startSit(n, kind, cx, cz, rad, face, dur) {
    const p = nav.randomPoint(cx - rad, cx + rad, cz - rad, cz + rad, 0.55, R); if (!p) return false;
    cancelAll(n); setTask(n, kind, { stage: 'go' }); stats[kind]++;
    mover.goTo(n, p.x, p.z, () => { n.task.stage = 'sit'; n.task.until = now + rr(R, dur); const f = face ?? yawTo(p.x, p.z, cx, cz); n.baseYaw = f; n.goalYaw = f; });
    return true;
  }
  function startStroll(n) {
    const kind = n.kind;
    let p = null;
    if (kind === 'wanderB3') p = nav.randomPoint(100, 148, -20, 20, 0.7, R);
    else p = nav.randomPoint(44, 96, -4.4, 4.4, 0.8, R);
    if (!p) return false;
    stats.stroll++; setTask(n, 'stroll');
    mover.goTo(n, p.x, p.z, () => { n.task = null; n.mode = 'act'; n.timer = rr(R, SC.errandDur.stroll); n.baseYaw = n.yaw + (R() - 0.5) * 1.8; });
    return true;
  }
  function startShrine(n) {
    const sp = S.shrine[2] || S.shrine[0]; if (!sp) return false;
    const p = slotNear(sp.x + (R() - 0.5), sp.z + (R() - 0.5) * 0.5, 1.5, 0.45); if (!p) return false;
    cancelAll(n); setTask(n, 'shrine', { stage: 'go' }); stats.shrine++;
    mover.goTo(n, p.x, p.z, () => { n.task.stage = 'pray'; n.task.until = now + rr(R, SC.errandDur.shrine); n.baseYaw = faceYaw(0, 1); n.goalYaw = n.baseYaw; });
    return true;
  }
  function startPatrol(n) {
    cancelAll(n); setTask(n, 'patrol', { left: SC.patrol.points, stage: 'go' }); stats.patrol++;
    const next = () => {
      if (n.task?.type !== 'patrol') return;
      if (n.task.left-- <= 0) { goHome(n); return; }
      const p = nav.randomPoint(44, 96, -4.2, 4.2, 0.9, R); if (!p) { goHome(n); return; }
      mover.goTo(n, p.x, p.z, () => { n.task.stage = 'look'; n.task.until = now + rr(R, SC.patrol.pause); n.baseYaw = R() * TAU; n.goalYaw = n.baseYaw; }, { speed: 0.9 });
    };
    n.task.next = next; next();
  }

  function pickErrand(n) {
    const w = SC.errandWeights[n.arch] || SC.errandWeights.Trader;
    if (n.kind === 'wanderB3') { startStroll(n); return; }
    let r = R() * w.reduce((s, v) => s + v, 0), k = 0;
    for (; k < w.length - 1; k++) { r -= w[k]; if (r <= 0) break; }
    n.errandCd = 0;
    const ok = (() => {
      switch (k) {
        case 0: { const v = vendors.filter((q) => !q.task && q.mode === 'act' && q.cust.length < 2); return v.length && startBrowse(n, v[Math.floor(R() * v.length)]); }
        case 1: return waterKeeper && !waterKeeper.task && waterKeeper.cust.length < 2 && startBrowse(n, waterKeeper);
        case 2: { const v = looms.filter((q) => !q.task && q.cust.length < 1); return v.length && startBrowse(n, v[Math.floor(R() * v.length)]); }
        case 3: { const b = S.bench[0]; return b && startSit(n, 'bench', b.x + 1.8, b.z + 1.4, 1.3, null, SC.errandDur.bench); }
        case 4: { const m = S.musician[0]; return m && startSit(n, 'music', m.x, m.z, 3.0, null, SC.errandDur.music); }
        case 5: return startStroll(n);
        case 6: { // разговор с ближайшим свободным бродягой
          let b = null, bd = SC.chat.maxDist ** 2;
          for (const o of npcs) { if (o === n || !isWander(o) || !idle(o) || o.leader || o.lod === 'off') continue; const d = (o.x - n.x) ** 2 + (o.z - n.z) ** 2; if (d < bd) { bd = d; b = o; } }
          return !!(b && startChat(n, b));
        }
        case 7: return startShrine(n);
        default: return false;
      }
    })();
    if (!ok && !n.task) { if (!startStroll(n)) { n.timer = 3 + R() * 4; } }
  }

  // ------------------------------------------------------------------ часы суток ----
  const dur = (p) => SC.clock[p];
  const phaseLeft = () => Math.max(0, dur(phase) - phaseT);
  function onPhase(p) {
    for (const n of npcs) {
      if (n.special || n.kind === 'sleep') continue;
      const part = SC.part[n.kind];
      if (!part) continue;
      if (p === 'prayer' && R() < part[0]) n.prayAt = now + R() * SC.prayDelay;
      if (p === 'rest' && R() < part[1]) n.mealAt = now + R() * SC.mealDelay;
    }
    if (p === 'prayer' && priest) priest.leadAt = now + 2;
  }
  function advanceClock(dt) {
    phaseT += dt;
    if (phaseT >= dur(phase)) {
      phaseT = 0; phase = phase === 'work' ? 'prayer' : phase === 'prayer' ? 'rest' : 'work';
      onPhase(phase);
    }
  }

  // ------------------------------------------------------------------ тревога ----
  function alert(kind, at) {
    if (game.space !== 'sietch') return;
    alertKind = kind; alertUntil = now + (kind === 'panic' ? SC.alert.panic : SC.alert.hush); alertAt = at || null; stats.alerts++;
  }

  // ------------------------------------------------------------------ тик одного горожанина ----
  /** Вызывается из crowd.update для NPC в режиме act/seat (не ходит). Возвращает true, если поведение вида (think) переопределено заданием. */
  function tick(n, dt) {
    if (n.special || n.kind === 'sleep' || n.kind === 'musician' || n.kind === 'cook' || n.kind === 'audience') return false;
    const T = n.task;
    // тревога: все замирают и молчат
    if (now < alertUntil) { n.talk = false; if (alertAt) n.baseYaw = yawTo(n.x, n.z, alertAt.x, alertAt.z); }
    if (T) {
      switch (T.type) {
        case 'browse': if (T.stage === 'at') { const ph = ((now + n.phase) % 6) < 3; n.pose = ph ? 'gesture' : 'listen'; n.talk = ph && !n.silent; if (T.vendor.cust[0] === n) T.vendor.vtalk = !ph; if (now > T.until) { release(n); if (T.after) T.after(n); } } return true;
        case 'meal': if (T.stage === 'eat') { n.pose = T.post ? 'eat' : 'sitEat'; n.talk = ((now * 0.31 + n.phase) % 9) < SC.mealGroupTalk * 4 && !n.silent; if (now > T.until || (phase === 'work' && now > T.until - 8)) { release(n); } } return true;
        case 'pray': n.pose = n.kind === 'elder' || n.kind === 'loom' ? 'sitPray' : 'pray'; n.talk = false; if (now > T.until) release(n); return true;
        case 'shrine': if (T.stage === 'pray') { n.pose = 'pray'; n.talk = false; if (now > T.until) release(n); } return true;
        case 'bench': case 'music': if (T.stage === 'sit') { n.pose = 'sitFloor'; n.talk = T.type === 'bench' && ((now * 0.27 + n.phase) % 11) < 3 && !n.silent; if (now > T.until) release(n); } return true;
        case 'patrol': if (T.stage === 'look') { n.pose = 'stand'; if (now > T.until) { T.stage = 'go'; T.next(); } } return true;
        case 'stroll': return true;
        case 'chat': if (!n.chatReady) n.pose = 'stand'; return true;
        case 'pause': return false;
        case 'lead': n.pose = 'invoke'; n.talk = false; if (phase !== 'prayer' && now > T.until) release(n); return true;
        default: return true;
      }
    }
    // планировщик по сутками
    if (n.prayAt && now >= n.prayAt && phase === 'prayer') {
      n.prayAt = 0;
      if (n === priest) { /* жрец ведёт молитву отдельно */ }
      else if (n.kind !== 'play' && !(n.arch === 'Child')) { startPray(n); return true; }
    }
    if (n === priest && n.leadAt && now >= n.leadAt && phase === 'prayer') {
      n.leadAt = 0; const p = slotNear(lead.x, lead.z, 2, 0.9); if (p) { cancelAll(n); setTask(n, 'lead', { until: now + phaseLeft() }); mover.goTo(n, p.x, p.z, () => { n.baseYaw = SC.qibla; n.goalYaw = SC.qibla; }); return true; }
    }
    if (n.mealAt && now >= n.mealAt && phase !== 'prayer') { n.mealAt = 0; if (startMeal(n)) return true; }
    return false;
  }

  /** Бродячие/домашние: решить, чем заняться дальше (вызывается, когда NPC свободен и стоит). */
  function think(n, dt) {
    if (isWander(n)) { if (n.timer <= 0) pickErrand(n); return; }
    // домашние: выходы по делам
    n.excT -= dt;
    if (n.excT > 0 || n.task || n.mode !== 'act' || n.chat) return;
    if (!n.canLeave && n.kind !== 'loom' && n.kind !== 'stall' && n.kind !== 'water') { n.excT = 60 + R() * 60; return; }
    if (n.kind === 'stall') { // за прилавком: перекладывает товар, зазывает, пьёт воду; уйти не может (ниша за прилавком)
      const r = R();
      if (r < 0.45) { n.task = { type: 'pause', until: now + 5 + R() * 6, pose: 'tidy' }; } else if (r < 0.7) { n.task = { type: 'pause', until: now + 4 + R() * 4, pose: 'drink' }; } else n.excT = 15 + R() * 25;
      return;
    }
    else if (n.kind === 'repair' && n.job === 'craftsman' && n.canLeave) { const v = vendors.filter((q) => !q.task && q.cust.length < 2); if (v.length) { startBrowse(n, v[Math.floor(R() * v.length)]); stats.visits++; } else n.excT = 30; }
    else if (n.kind === 'water') { const r = R(); n.task = { type: 'pause', until: now + 5 + R() * 5, pose: r < 0.5 ? 'drink' : 'tidy' }; }
    else if (n.kind === 'hooks' && n.role === 'inspect') startPatrol(n);
    else if (n.kind === 'loom') { n.task = { type: 'pause', until: now + 6 + R() * 6, pose: R() < 0.5 ? 'stretch' : 'drink' }; }
    else if (n.kind === 'shrine' && n.role !== 'stand') { n.pose = 'stand'; n.task = { type: 'pause', until: now + 7 + R() * 6, resume: true }; }
    else if (n.kind === 'elder' && n !== priest) { n.task = { type: 'pause', until: now + 5 + R() * 5, pose: 'drink' }; }
    else if (n === priest) { startPatrol(n); }
    else n.excT = 40 + R() * 40;
  }

  // «пауза» дома (потянуться/встать с молитвы): не меняет место, только позу
  function pauseTick(n) {
    const T = n.task; if (!T || T.type !== 'pause') return false;
    n.pose = T.pose || 'stand'; n.talk = false;
    if (now > T.until) { n.task = null; n.excT = rr(R, SC.excursion[n.kind] || [50, 100]); }
    return true;
  }

  // ------------------------------------------------------------------ реакция на игрока: взгляд, шаг в сторону, реплики ----
  const canYield = (n) => (n.pose === 'stand' || (n.kind === 'stall' && !n.task) || n.pose === 'trade' || n.pose === 'measure') && !n.special && n.mode === 'act' && n.kind !== 'sleep' && !n.job?.startsWith('guard') && n.kind !== 'cook' && n.kind !== 'musician' && n.kind !== 'quarrel' && n.kind !== 'whisper';
  function react(n, dt, dp, dxp, dzp) {
    const g = n.gz, plV = env.plV;
    if (n.special || n.kind === 'sleep') { g.w = 0; return; }
    n.yieldCd -= dt;
    const toPl = Math.atan2(dxp, dzp), ang = Math.abs(wrapA(toPl - n.yaw));
    const vendorLike = n.kind === 'stall' || n.kind === 'water' || n.kind === 'guardPost' || n.kind === 'hooks';
    // --- взгляд на игрока: заметил → смотрит 1–3 с → отводит; продавцы смотрят дольше; поворот корпуса — с задержкой
    if (dp < SC.glance.range && n.mode !== 'wait') {
      if (g.mode === 1) {
        const hold = (vendorLike && dp < 3.2) || dp < 1.6;
        if (now > g.until && !hold) { g.mode = 0; g.cd = now + rr(R, SC.glance.cooldown); }
        else if (hold && now > g.until) g.until = now + 1.5;
      } else if (now > g.cd && (ang < SC.glance.maxAng || dp < 2.0)) {
        g.mode = 1; g.t0 = now; g.until = now + rr(R, vendorLike ? SC.glance.durVendor : SC.glance.dur); stats.glance++;
        considerBark(n, dp);
      }
    } else if (g.mode === 1) { g.mode = 0; g.cd = now + rr(R, SC.glance.cooldown) * 0.5; }
    let mode = g.mode === 1 ? 1 : n.lookNpc ? 2 : 0;
    if (mode === 1 && n.chat && dp > 2.6) mode = 2;
    if (now < alertUntil && alertAt) mode = 0;
    g.w = damp(g.w, mode ? SC.glance.weight : 0, mode ? 5 : 3, dt);
    g.cur = mode;
    // корпус: после задержки разворачиваемся к игроку, если это «свободная» поза и он за пределами обзора
    if (mode === 1 && n.mode === 'act' && !n.task && now - g.t0 > SC.glance.turnDelay && ang > SC.glance.turnBodyAng && (n.pose === 'stand' || n.pose === 'trade' || n.pose === 'measure') && n.kind !== 'sleep') n.goalYaw = n.baseYaw + clamp(wrapA(toPl - n.baseYaw), -1.5, 1.5);
    // --- шаг в сторону
    if (n.mode === 'act' && canYield(n) && n.yieldCd <= 0 && dp < SC.yield.range && !n.yielded) {
      const pvx = plV.x, pvz = plV.z, pv = Math.hypot(pvx, pvz);
      const away = { x: -dxp / (dp || 1), z: -dzp / (dp || 1) };
      const closing = pv > 0.3 ? (pvx * -away.x + pvz * -away.z) / pv : 0;       // игрок идёт на меня
      if (dp < 0.8 || closing > 0.3) {
        let sx = away.x, sz = away.z;
        if (pv > 0.3) { // уходим перпендикулярно ходу игрока, в сторону «от него»
          const px = -pvz / pv, pz = pvx / pv, s = px * away.x + pz * away.z >= 0 ? 1 : -1; sx = px * s; sz = pz * s;
        }
        let tgt = null;
        for (const [ux, uz] of [[sx, sz], [away.x, away.z], [-sz, sx], [sz, -sx]]) { const x = n.x + ux * SC.yield.step, z = n.z + uz * SC.yield.step; if (free(x, z, 0.42) && Math.hypot(x - env.plL.x, z - env.plL.z) > dp * 0.9) { tgt = { x, z }; break; } }
        n.yieldCd = SC.yield.cooldown;
        if (tgt) {
          n.yielded = { x: n.x, z: n.z, yaw: n.baseYaw }; n.yieldBackT = 0; stats.yield++;
          const prevPose = n.pose; mover.goTo(n, tgt.x, tgt.z, () => { n.task = n.task; }, { direct: true, speed: 0.85 }); n.pose = prevPose;
        }
      }
    }
    if (n.yielded && n.mode === 'act') {
      if (dp > SC.yield.back) { n.yieldBackT += dt; if (n.yieldBackT > SC.yield.backDelay) { const y = n.yielded; n.yielded = null; mover.goTo(n, y.x, y.z, () => { n.baseYaw = y.yaw; n.goalYaw = y.yaw; }, { direct: true, speed: 0.8 }); } } else n.yieldBackT = 0;
    }
  }
  function considerBark(n, dp) {
    if (dp > SC.bark.range || barkGlobal > 0 || n.bark2 > 0 || n.silent > 0 || n.chat) return;
    if (game.dialogue?.isBusy || game.cinematic?.active || game.space !== 'sietch' || n.kind === 'sleep' || n.kind === 'musician' || n.kind === 'guardCheck') return;
    if (R() > SC.bark.p) return;
    const c = env.out.ritualState !== 'idle' ? 'Ritual' : !n.stranger ? 'Stranger' : n.kind === 'stall' ? 'Market' : (n.kind === 'water' || n.arch === 'WaterCarrier') ? 'Water' : n.kind === 'whisper' || n.kind === 'shrine' ? 'Shiana' : n.kind === 'quarrel' ? 'Kin' : n.kind === 'loom' ? 'Market' : 'Idle';
    if (env.say(n, c)) { n.stranger = true; n.bark2 = rr(R, SC.bark.own); barkGlobal = rr(R, SC.bark.global); stats.barks++; }
  }

  /** Куда смотрит голова (мировая точка) — для fig.lookAt. */
  function lookTarget(n, out) {
    const g = n.gz;
    if (g.cur === 1) return out.copy(game.camera.position);
    if (g.cur === 2 && n.lookNpc) return env.ctx.toWorld(n.lookNpc.x, n.lookNpc.y + n.lookNpc.lk.height * 0.93 * (n.lookNpc.pose === 'sitFloor' ? 0.6 : 1), n.lookNpc.z, out);
    return null;
  }

  /** Применить взгляд к фигуре (только полный LOD): плавный вес, после затухания голова возвращается в нейтраль. */
  function applyLook(n) {
    const g = n.gz;
    if (!g.pos) g.pos = new THREE.Vector3();
    if (g.cur) { if (lookTarget(n, g.pos)) g.has = true; }
    if (g.w > 0.01 && g.has) { n.fig.lookAt(g.pos, g.w * (n.kind === 'musician' ? 0.4 : 1)); g.off = false; }
    else if (!g.off && g.has) { n.fig.lookAt(g.pos, 0); g.off = true; }
  }

  // ------------------------------------------------------------------ дети: хвост за матерью и игры ----
  function assignFamilies() {
    // «мать» — первая бродячая ткачиха/любая бродяга женского вида, «дети» — двое детей площадки
    const mothers = npcs.filter((n) => n.kind === 'wander' && n.arch === 'Weaver');
    const kids = npcs.filter((n) => n.kind === 'play' && !n.arena);
    mothers.slice(0, 2).forEach((m, i) => { m.job = 'mother'; m.kids = []; for (let k = 0; k < 2; k++) { const c = kids[i * 2 + k]; if (c) { c.leader = m; m.kids.push(c); } } });
  }
  assignFamilies();

  // ------------------------------------------------------------------ общий цикл ----
  function update(dt, t) {
    now = t; barkGlobal -= dt;
    advanceClock(dt);
    chatT -= dt;
    updateChats(dt);
    if (chatT <= 0) { chatT = rr(R, SC.chat.every); tryStartChats(); }
    // сторонний прохожий присоединяется к разговору поблизости
    if (chats.length && R() < dt * 0.4) {
      const c = chats[Math.floor(R() * chats.length)];
      if (c.state === 'talk' && c.members.length < SC.chat.max) {
        const n = npcs.find((q) => isWander(q) && idle(q) && !q.leader && Math.hypot(q.x - c.x, q.z - c.z) < SC.chat.joinRange);
        if (n && R() < SC.chat.joinP) joinChat(n, c);
      }
    }
  }
  function onRitual() {
    for (const c of chats.slice()) { for (const m of c.members) { m.chat = null; } c.members.length = 0; }
    chats.length = 0;
    for (const n of npcs) { if (n.special) continue; cancelAll(n); n.yielded = null; n.prayAt = n.mealAt = 0; }
    for (const s of mealSpots) s.n = null;
  }

  return { tick, think, react, pauseTick, lookTarget, applyLook, update, onRitual, alert, stats, chats, mealSpots, release, goHome, cancelAll, get phase() { return phase; }, get phaseT() { return phaseT; }, startChat, startBrowse, startMeal, startPray, setTask, isWander };
}
