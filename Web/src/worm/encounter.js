// Встреча с укрощённым червём — всё в РЕАЛЬНОМ ВРЕМЕНИ, управление игроком не отбирается (нет кинокамеры, леттербокса, game.cinematic, блокировки ввода).
// Внимание игрока привлекает сама мировая постановка: дрожь земли и песчаная волна на горизонте, камни-прыгуны, спутники поворачивают головы
// и кричат, пыль, шаги по рингам.
//
// Червь приходит из глубокой пустыни с 5 наездниками на спине: они цепляются за швы колец крючьями (шесты в швах, канаты туго, тела откинуты,
// качаются в такт волне), передний рулит — вскрывает кольцо рычагом-крюком. Червь замедляется и в конце выбивается из сил: опускает голову,
// тело оседает с долгим вздохом песка, сегменты расслабляются, дыхание замедляется. Он остаётся лежать (уходить некуда: сил нет, наездники
// ждут, пока он оправится). Наездники спускаются по канатам; Оссана идёт туда, где стоит игрок, и говорит (DLG_A2_RIDER_01…10).
// Остальные садятся у тела червя и ухаживают за ним.
//
// Фазы (шина 'worm:encounter' {phase}): omen → arrive → stop (+collapse) → dismount → talk → rest.
// Promise playReveal() выполняется, когда закончилась цепочка диалога (после чего фаза 'rest', червь остаётся на месте).
import * as THREE from 'three';
import { clamp, lerp, smoothstep, rng } from '../core/util.js';
import { GOLDEN_PATH } from '../core/layout.js';
import { colliders } from '../core/colliders.js';
import { choosePath } from './path.js';
import { RADIUS } from './spine.js';

export const DIALOGUE_ID = 'DLG_A2_RIDER_01';

/** Все числа сцены (метры, секунды, радианы). */
export const ENCOUNTER_TUNING = {
  vCruise: 36, aAcc: 3.0, aBrake: 2.2, tiredFrom: 0.55,    // к концу дуги голова еле ползёт (устал)
  ossWalk: 3.0, ossRun: 4.6, ossClimb: 4.2, ossBackWalk: 2.4, talkDist: 4.0,
  collapseTime: 9.5, sagBody: 3.2, sagHead: 2.6, spread: 0.045, restRate: 0.32, mouthRest: 0.1,
  dismountDelay: { Ossana: 0.4, Rider3: 1.6, Rider4: 2.4, Rider5: 3.1, Rider1: 4.0 },
  sitDistance: 5.5, avoidMargin: 12, talkFallback: 6, talkGuard: 180, callEvery: 9,
};

const T = ENCOUNTER_TUNING;
const UP = new THREE.Vector3(0, 1, 0);

export class EncounterDirector {
  constructor(api, worm) {
    this.api = api; this.worm = worm;
    this._active = false; this.resting = false; this.phase = 'none';
    this.promise = null; this.resolve = null;
    this.path = null; this.G = new THREE.Vector3();
    this.t = 0; this.pt = 0; this.u = 0; this.v = 0;
    this.timeV = 0; this.rate = 1;
    this.rand = rng(777);
    this.tasks = [];
    this._v = new THREE.Vector3(); this._w = new THREE.Vector3(); this._n = new THREE.Vector3(); this._p = new THREE.Vector3(); this._q = new THREE.Vector3();
    this._pt = {};
    this.sensingBefore = true;
    this.footAcc = 0; this.surfaced = false; this.blockT = 0;
    this.talkDone = false; this.log = [];
    this.sched = [];
    this.oss = { phase: 'none', t: 0, pos: new THREE.Vector3(), land: new THREE.Vector3() };   // совместимость со старым API (ossanaLanding)
  }

  get active() { return this._active; }

  // ---------------------------------------------------------------- старт
  /** Построить маршрут относительно группы (с обходом препятствий) и поставить голову в начало (под песком, далеко). */
  prepare() {
    const { game, K, ground } = this.api;
    const pl = game.player?.position;
    const P4 = GOLDEN_PATH.find((p) => p.id === 'P4');
    const G = pl && game.space === 'desert' ? { x: pl.x, z: pl.z } : { x: P4.x, z: P4.z };
    this.G.set(G.x, ground(G.x, G.z), G.z);
    // курс: волна приходит со стороны, куда смотрит игрок (видна на горизонте), и проходит слева направо перед ним
    const fwd = game.camera.getWorldDirection(this._w);
    const camHead = Math.atan2(fwd.z, fwd.x);
    const preferred = Number.isFinite(camHead) && (fwd.x * fwd.x + fwd.z * fwd.z) > 0.04 ? camHead + Math.PI - 0.55 : -1.35;
    const tmp = new THREE.Vector3();
    const clear = (x, z, extra = 0) => {
      tmp.set(x, ground(x, z), z);
      return game.collide(tmp, RADIUS + T.avoidMargin + extra, { ignore: 'worm', height: 3 }) ? [tmp.x, tmp.z] : null;
    };
    this.path = choosePath(G, preferred, { clear });
    const p0 = this.path.at(0);
    this.u = 0; this.v = 0;
    this.api.placeHead(p0.x, p0.z, p0.yaw, 55);
    K.scripted = true;
    return this.path;
  }

  play() {
    if (this._active) return this.resting ? Promise.resolve({ skipped: true, resting: true }) : this.promise;
    const { game, bus, K } = this.api;
    this.promise = new Promise((res) => { this.resolve = res; });
    this.prepare();
    this._active = true; this.resting = false;
    this.t = 0; this.pt = 0; this.surfaced = false; this.talkDone = false; this.log.length = 0; this.blockT = 0;
    this.timeV = game.time; this.rate = 1; this.sched.length = 0;
    this.sensingBefore = this.worm.sensing;
    this.worm.sensing = false;
    this.api.clearForced();
    this.api.setRidden(true);
    this.api.setTame(true);
    K.frozen = false;
    const rd = this.worm.riders, sp = this.worm.spine;
    sp.sag = 0; sp.sagHead = 0; sp.spread = 1; sp.flare = 1;
    rd.items.forEach((it) => {
      it.hidden = false; it.free = false; it.sitting = false; it.sNow = it.s; it.a = 0; it.moving = false; it.root.visible = true; it.hookOn = true;
      it.mode = it.role === 'steer' ? 'steer' : 'cling'; it.clingW = 1; it.face = 0; it.sitW = 0; it.ladderOn = false;
      it.fig.setTalking?.(false);
    });
    rd.sway = 1; rd.aBase = 0;
    this.worm.gear.resetHooks(); this.worm.gear.setLadder(null);
    this.worm.body.setOpen(0);
    this.tasks = rd.items.map((it) => this.mkTask(it));
    this.offSub = bus.on('subtitle', (e) => this.onSubtitle(e));
    this.watching = false;
    game.freecam?.setScene('encounter', true);          // свободная камера доступна на всё время сцены (клавиша F)
    this.setPhase('omen');
    this.setPhase('arrive');
    bus.emit('worm:reveal', { phase: 'start' });
    this.stageOmen();
    return this.promise;
  }

  mkTask(it) {
    return { it, ph: 'cling', t: 0, delay: T.dismountDelay[it.name] ?? 2, side: 1, sDesc: it.s, a: 0, aLand: 0, cp: 0, pos: new THREE.Vector3(), land: new THREE.Vector3(), spot: new THREE.Vector3(), face: new THREE.Vector3(0, 0, 1), sitT: 0, callT: 0, waitT: 0, touch: it.name === 'Rider5' ? 1 : 0 };
  }

  setPhase(ph) {
    this.phase = ph; this.pt = 0;
    this.log.push(`${this.api.game.time.toFixed(1)} ${ph}`);
    this.api.bus.emit('worm:encounter', { phase: ph });
  }

  after(sec, fn) { this.sched.push({ at: this.t + sec, fn }); }

  /** Внешняя отмена/уход червя (devour, тест): тихо убирает сцену. Безусловно восстанавливает всё состояние. */
  cancel() { if (this._active) this.finish(true, true); }
  dismiss() { this.cancel(); }

  finish(skipped = false, silent = false) {
    if (!this._active) return;
    const { bus, K } = this.api;
    this._active = false; this.resting = false;
    this.api.game.freecam?.setScene('encounter', false);
    this.watch(false);
    this.offSub?.(); this.offSub = null;
    const rd = this.worm.riders, sp = this.worm.spine;
    rd.items.forEach((it) => { it.free = false; it.hidden = true; it.sitting = false; it.root.visible = false; it.fig.setTalking?.(false); it.ladderOn = false; });
    sp.sag = 0; sp.sagHead = 0; sp.spread = 1;
    this.worm.gear.setLadder(null);
    this.oss.phase = 'none';
    K.scripted = false;
    this.api.setTame(false);
    this.worm.sensing = this.sensingBefore;
    this.api.hardDormant(true);
    if (!silent) bus.emit('worm:reveal', { phase: 'end', skipped });
    bus.emit('worm:encounter', { phase: 'dismissed' });
    this.phase = 'none';
    const res = this.resolve; this.resolve = null;
    res?.({ skipped });
  }

  // ---------------------------------------------------------------- мировая постановка (без камеры)
  /** Спутники поворачивают головы к червю (перехват lookAt их фигур) и кричат; вдали — песчаная волна. */
  watch(on) {
    const { game } = this.api;
    const list = game.companions?.list || [];
    if (on && !this.watching) {
      this.watching = true;
      this._lookBackup = [];
      for (const c of list) {
        const fig = c.figure; if (!fig || fig.__orig) continue;
        const orig = fig.lookAt.bind(fig);
        fig.__orig = orig;
        fig.lookAt = (pos, w) => { if (this.watching) orig(this.attention(), Math.max(0.9, w)); else orig(pos, w); };
        this._lookBackup.push(fig);
      }
    } else if (!on && this.watching) {
      this.watching = false;
      for (const fig of this._lookBackup || []) { if (fig.__orig) { fig.lookAt = fig.__orig; delete fig.__orig; } }
      this._lookBackup = [];
    }
  }
  attention() {
    const K = this.api.K, o = this.tasks[1];
    if (o && (this.phase === 'dismount' || this.phase === 'talk') && o.it.free) return this._p.set(o.pos.x, o.pos.y + 1.6, o.pos.z);
    return this._p.set(K.pos.x, K.pos.y + 12, K.pos.z);
  }

  /** Реплика спутника из таблицы диалогов (Dialogue_S1.csv, DLG_WRM_H*): субтитр + озвучка Piper по ID. */
  bark(speaker, id) {
    const { game } = this.api;
    const c = game.companions?.list?.find((q) => q.id === speaker);
    const pos = c ? new THREE.Vector3(c.position.x, c.position.y + 1.7, c.position.z) : undefined;
    game.dialogue?.say?.(id, pos);
  }

  stageOmen() {
    this.watch(true);
    this.api.game.audio?.event?.('Worm.Heartbeat');
    this.after(0.8, () => this.bark('Ilva', 'DLG_WRM_H01'));
    this.after(4.0, () => this.bark('Rayn', 'DLG_WRM_H02'));
    this.after(9.0, () => this.bark('Ilva', 'DLG_WRM_H03'));
  }

  // ---------------------------------------------------------------- голова
  baseLift(u) { return -55 + 52 * smoothstep(30, 200, u); }       // всплытие вдали: волна → бугор → кольца

  placeHeadAt(u) {
    const { K, ground } = this.api;
    const p = this.path.at(u, this._pt);
    K.pos.set(p.x, ground(p.x, p.z) + this.baseLift(u), p.z);
    K.yaw = p.yaw; K.pitch = 0;
    this.worm.spine.push(K.pos);
  }

  /** Тело не должно заходить в харвестер/скалу: смотрим вперёд по курсу (только выступающее над песком). */
  blockedAhead() {
    const { K } = this.api;
    if (!this.surfaced) return false;
    const cy = Math.cos(K.yaw), sy = Math.sin(K.yaw);
    const a = this._v.set(K.pos.x + cy * 18, K.pos.y, K.pos.z + sy * 18);
    const b = this._w.set(K.pos.x + cy * (30 + this.v * 3.5), K.pos.y, K.pos.z + sy * (30 + this.v * 3.5));
    return !!colliders.segmentBlocked(a, b, RADIUS + 1.5, { ignore: 'worm' });
  }

  /** Игрок (или спутник) на пути головы: червь притормаживает и «ждёт», пока тот отойдёт (через 4 с ползёт 2 м/с — коллайдеры мягко отодвинут). */
  personAhead() {
    const { game, K } = this.api;
    if (!this.surfaced) return false;
    const cy = Math.cos(K.yaw), sy = Math.sin(K.yaw), reach = 34 + this.v * 3;
    const list = [game.player?.position, ...(game.companions?.list || []).map((c) => c.position)];
    for (const p of list) {
      if (!p) continue;
      const dx = p.x - K.pos.x, dz = p.z - K.pos.z;
      const along = dx * cy + dz * sy, lat = Math.abs(-dx * sy + dz * cy);
      if (along > 8 && along < reach && lat < RADIUS + 5) return true;
    }
    return false;
  }

  moveHead(dt, vTarget, acc) {
    const { K } = this.api;
    if (this.blockedAhead()) { vTarget = 0; acc = Math.max(acc, 6); this.blockT += dt; } else this.blockT = 0;
    if (this.personAhead()) { this.stallT = (this.stallT || 0) + dt; vTarget = this.stallT > 4 ? Math.min(vTarget, 2) : 0; acc = Math.max(acc, 5); } else this.stallT = 0;
    this.v += clamp(vTarget - this.v, -acc * dt, acc * dt);
    if (this.v < 0) this.v = 0;
    this.u = Math.min(this.u + this.v * dt, this.path.len - 1);
    this.placeHeadAt(this.u);
    K.speed = this.v;
    this.footAcc += this.v * dt;
    if (this.footAcc > 16 && this.surfaced) { this.footAcc = 0; this.api.game.world?.addFootprint?.(K.pos.x, K.pos.z, K.yaw, { type: 'worm', size: 46 }); }
  }

  /** Мгновенно довести голову до u (отладка): шаг 2 м, тело сворачивается по истории. */
  advanceTo(uT) {
    while (this.u < uT) { this.u = Math.min(uT, this.u + 2); this.placeHeadAt(this.u); }
    this.v = 0;
  }

  headLiftFor(v) { return lerp(1.2, 8.5, smoothstep(2, 22, v)); }

  // ---------------------------------------------------------------- цикл
  update(dt) {
    if (!this._active) return;
    const { game, K, bus } = this.api;
    const sp = this.worm.spine, path = this.path, rd = this.worm.riders;
    this.t += dt; this.pt += dt;
    this.timeV += dt * this.rate;
    for (let i = this.sched.length - 1; i >= 0; i--) if (this.t >= this.sched[i].at) { const f = this.sched[i].fn; this.sched.splice(i, 1); try { f(); } catch (e) { console.warn('[worm] sched', e); } }
    this.tickHold();
    rd.sway = clamp(this.v / 28, 0.12, 1);

    switch (this.phase) {
      case 'arrive': {
        const left = path.uStop - this.u;
        const tired = 1 - T.tiredFrom * smoothstep(path.uSpiral - 80, path.uStop - 100, this.u);
        const vUp = Math.sqrt(2 * T.aAcc * (this.u + 6));
        const vDown = Math.sqrt(2 * T.aBrake * Math.max(0, left)) + 0.5;
        this.moveHead(dt, Math.min(T.vCruise * tired, vUp, vDown), 3);
        if (!this.surfaced && this.u > 150) {
          this.surfaced = true;
          this.api.onBreach(0.55);
          bus.emit('worm:reveal', { phase: 'erupt' });
        }
        this.pryT = (this.pryT || 0) - dt;                       // передний наездник рычагом вскрывает шов кольца: из шва сыплется песок
        if (this.pryT <= 0 && this.surfaced) {
          this.pryT = 1.6 + this.rand() * 1.8;
          const e = rd.items[0].hookPole.matrix.elements;
          if (rd.items[0].hookPole.visible) this.api.fx.puff(e[12], e[13], e[14], 0.22);
        }
        if (!this._passFx && this.u > path.o.approach - 60) { this._passFx = true; game.audio?.event?.('Worm.Pass', K.pos.clone()); }
        sp.headLift = lerp(sp.headLift, this.headLiftFor(this.v) * (0.55 + 0.45 * tired), 1 - Math.exp(-1.5 * dt));
        game.shake = Math.max(game.shake || 0, 0.28 * smoothstep(260, 70, this.distToPlayer()) * smoothstep(5, 25, this.v));   // только вблизи: вдали земля не дрожит
        if (left < 0.4 && this.v < 0.9) { this.advanceTo(path.uStop); this.startCollapse(); }
        break;
      }
      case 'stop': this.updateCollapse(dt); break;
      case 'dismount': case 'talk': case 'rest': {
        if (this.stirT > 0) { this.stirT -= dt; sp.headLift = lerp(sp.headLift, 2.6 + 1.4 * Math.sin(this.t * 3), 1 - Math.exp(-3 * dt)); }
        else sp.headLift = lerp(sp.headLift, 0, 1 - Math.exp(-0.8 * dt));
        this.restBreath(dt);
        this.updateTasks(dt);
        break;
      }
      default: break;
    }
  }

  distToPlayer() { const p = this.api.game.player?.position, K = this.api.K; return p ? Math.hypot(K.pos.x - p.x, K.pos.z - p.z) : 999; }
  distToG() { const K = this.api.K; return Math.hypot(K.pos.x - this.G.x, K.pos.z - this.G.z); }

  // ---------------------------------------------------------------- падение без сил
  startCollapse() {
    const { game, K, bus } = this.api;
    this.v = 0; K.speed = 0;
    this.setPhase('stop');
    bus.emit('worm:encounter', { phase: 'collapse' });
    this.api.settleFx();
    game.audio?.event?.('Worm.RingSandfall', K.pos.clone());
    this.collapsePuff = 0;
    this.riderHint = 0;
    this.after(1.5, () => this.bark('Rayn', 'DLG_WRM_H04'));
  }

  updateCollapse(dt) {
    const { game, K } = this.api;
    const sp = this.worm.spine, pt = this.pt;
    const k1 = smoothstep(0, T.collapseTime - 1.5, pt);
    sp.sag = T.sagBody * k1;
    sp.sagHead = T.sagHead * smoothstep(0.4, 6.5, pt);
    sp.headLift = lerp(sp.headLift, 0, 1 - Math.exp(-1.6 * dt));
    sp.spread = 1 + T.spread * k1;
    this.rate = lerp(1, T.restRate, smoothstep(1.5, T.collapseTime, pt));
    this.worm.body.setOpen(T.mouthRest * smoothstep(1, 6, pt));
    this.worm.riders.lean = lerp(0.34, 0.12, smoothstep(2, 8, pt));
    // длинный вздох песка: пыль и песок стекают по бокам, вдоль всего тела
    this.collapsePuff -= dt;
    if (this.collapsePuff <= 0 && pt < T.collapseTime - 1) {
      this.collapsePuff = 0.45 + this.rand() * 0.5;
      const s = 10 + this.rand() * 230;
      this.worm.spine.surfacePoint(s, (this.rand() < 0.5 ? -1 : 1) * (0.7 + this.rand() * 0.7), this._v, this._n, 0.1);
      this.api.fx.puff(this._v.x, this._v.y, this._v.z, 0.7 + 0.5 * this.rand(), 'wide');
      if (this.rand() < 0.35) game.audio?.event?.('Worm.RingSandfall', this._v.clone());
    }
    game.shake = Math.max(game.shake || 0, 0.1 * (1 - k1) * smoothstep(200, 50, this.distToPlayer()));
    if (pt > T.collapseTime) this.startDismount();
    void K;
  }

  /** Дыхание в покое: медленная пульсация + редкий выдох из пасти. */
  restBreath(dt) {
    const { K } = this.api;
    this.breathT = (this.breathT || 0) - dt;
    if (this.breathT <= 0) {
      this.breathT = 5.5 + this.rand() * 2;
      this.worm.spine.surfacePoint(2, 0, this._v, this._n, 0);
      this.api.fx.puff(K.pos.x + Math.cos(K.yaw) * 14, K.pos.y + 1, K.pos.z + Math.sin(K.yaw) * 14, 0.5, 'wide');
    }
    const br = 0.5 + 0.5 * Math.sin(this.timeV * 0.85);
    this._mouthTick = (this._mouthTick || 0) - dt;
    if (this._mouthTick <= 0) { this._mouthTick = 0.15; this.worm.body.setOpen(T.mouthRest * (0.55 + 0.45 * br)); }
  }

  // ---------------------------------------------------------------- наездники: спуск, ходьба, посадка
  playerPos() { return this.api.game.player?.position || this.G; }

  startDismount() {
    const { game, ground } = this.api;
    const sp = this.worm.spine, rd = this.worm.riders;
    sp.compute(this.timeV, 1);
    this.setPhase('dismount');
    const P = this._v, N = this._n;
    for (const tk of this.tasks) {
      const it = tk.it;
      // станция спуска: Оссана — ближайшая к игроку в ±12 м от своего места; остальные спускаются там, где стоят
      let sBest = it.s, best = 1e9;
      if (it.name === 'Ossana') {
        const pl = this.playerPos();
        for (let s = Math.max(30, it.s - 12); s <= it.s + 12; s += 2) {
          sp.surfacePoint(s, 0, P, N, 0);
          const d = Math.hypot(P.x - pl.x, P.z - pl.z);
          if (d < best) { best = d; sBest = s; }
        }
      }
      tk.sDesc = sBest;
      sp.surfacePoint(sBest, 0, P, N, 0);
      const Tn = sp._b, B = new THREE.Vector3().crossVectors(Tn, N);
      const pl = this.playerPos();
      const toG = new THREE.Vector3(pl.x - P.x, 0, pl.z - P.z).normalize();
      tk.side = Math.sign(toG.dot(B)) || 1;
      let aLand = tk.side * 1.6;
      for (let a = 0; Math.abs(a) < 2.6; a += tk.side * 0.02) {
        sp.surfacePoint(sBest, a, P, N, 0.2);
        if (P.y - ground(P.x, P.z) < 0.5) { aLand = a; break; }
      }
      tk.aLand = aLand;
      tk.ph = 'cling'; tk.t = 0;
    }
    void game; void rd;
  }

  /** Куда садится наездник: от места посадки наружу от тела, веером вдоль тела. */
  planSpot(tk, idx) {
    const { ground } = this.api;
    const sp = this.worm.spine;
    sp.surfacePoint(tk.sDesc, tk.aLand, this._v, this._n, 0.2);
    const nx = this._n.x, nz = this._n.z, nl = Math.hypot(nx, nz) || 1;
    const ox = nx / nl, oz = nz / nl;
    const lat = (idx % 3 - 1) * 4.5;
    tk.spot.set(this._v.x + ox * (T.sitDistance + (idx % 2) * 1.5) + -oz * lat, 0, this._v.z + oz * (T.sitDistance + (idx % 2) * 1.5) + ox * lat);
    tk.spot.y = ground(tk.spot.x, tk.spot.z);
    tk.face.set(-ox, 0, -oz);
  }

  placeSurface(it, s, a, extra, sideSign, descend) {
    const sp = this.worm.spine, rd = this.worm.riders;
    const P = this._v, N = this._n, P2 = this._w;
    sp.surfacePoint(s, a, P, N, extra);
    sp.surfacePoint(s, a + 0.03 * sideSign, P2, this._q, extra);
    const down = P2.sub(P).normalize();
    const w = smoothstep(0.62, 0.15, N.y);                    // у вертикальной стены — лицом к стене
    const nh = this._q.set(-N.x, 0, -N.z); if (nh.lengthSq() > 1e-6) nh.normalize(); else nh.set(0, 0, 1);
    const face = new THREE.Vector3().copy(descend ? down : down.clone().negate()).lerp(nh, w);
    const up = new THREE.Vector3(0, 1, 0).addScaledVector(N, 0.38 * (1 - N.y));
    rd.placeFree(it, P, up, face);
    return w;
  }

  walkTo(tk, goal, speed, dt, face) {
    const { ground } = this.api;
    const rd = this.worm.riders, it = tk.it;
    const dx = goal.x - tk.pos.x, dz = goal.z - tk.pos.z, d = Math.hypot(dx, dz);
    let sp = 0;
    if (d > 0.05) { sp = Math.min(speed, d / Math.max(dt, 1e-3)); tk.pos.x += (dx / d) * sp * dt; tk.pos.z += (dz / d) * sp * dt; tk.dir = tk.dir || new THREE.Vector3(); tk.dir.set(dx / d, 0, dz / d); }
    colliders.push(tk.pos, 0.5, { height: 1.8 });
    tk.pos.y = ground(tk.pos.x, tk.pos.z);
    it.fig.animate(sp, dt, 0.6);
    const f = face || tk.dir || this._q.set(0, 0, 1);
    rd.placeFree(it, tk.pos, UP, f);
    return d;
  }

  updateTasks(dt) {
    const { game, ground } = this.api;
    const sp = this.worm.spine, rd = this.worm.riders;
    this.tasks.forEach((tk, idx) => {
      const it = tk.it;
      tk.t += dt;
      const oss = it.name === 'Ossana';
      switch (tk.ph) {
        case 'cling': {                                          // ждёт своей очереди, потом отцепляет шест
          if (this.phase === 'dismount' && tk.t > tk.delay) { tk.ph = 'unhook'; tk.t = 0; it.mode = 'stand'; }
          break;
        }
        case 'unhook': {
          if (tk.t > 0.9) {
            it.hookOn = false; tk.ph = 'walkBack'; tk.t = 0; it.moving = true;
            const h = it.hookPole.matrix.elements; this.api.fx.puff(h[12], h[13], h[14], 0.3);
          }
          break;
        }
        case 'walkBack': {                                       // по спине к месту спуска
          it.moving = true;
          const ds = tk.sDesc - it.sNow;
          it.sNow += clamp(ds, -T.ossBackWalk * dt, T.ossBackWalk * dt);
          if (Math.abs(ds) < 0.15) { it.moving = false; tk.ph = 'rope'; tk.t = 0; rd.setLadder(it, { s: tk.sDesc, a0: tk.side * 0.22, a1: tk.aLand }); }
          break;
        }
        case 'rope': {
          it.moving = false;
          if (tk.t > 1.0) { tk.ph = 'down'; tk.t = 0; tk.a = 0; it.free = true; it.pole.visible = true; }
          break;
        }
        case 'down': {
          const w = smoothstep(0.62, 0.15, Math.cos(tk.a));
          const v = lerp(2.6, T.ossClimb, w);
          tk.a += tk.side * (v / RADIUS) * dt;
          tk.cp += dt * 4.2 * (0.3 + w);
          const ww = this.placeSurface(it, tk.sDesc, tk.a, 0.12, tk.side, true);
          it.fig.animate(ww < 0.5 ? 1.8 : 0, dt);
          rd.poseClimb(it, tk.cp, smoothstep(0.2, 0.7, ww));
          if (Math.abs(tk.a) >= Math.abs(tk.aLand) - 0.01) {
            sp.surfacePoint(tk.sDesc, tk.aLand, this._v, this._n, 0.2);
            tk.pos.set(this._v.x + this._n.x * 1.2, 0, this._v.z + this._n.z * 1.2); tk.pos.y = ground(tk.pos.x, tk.pos.z);
            tk.land.copy(tk.pos);
            this.api.fx.puff(tk.pos.x, tk.pos.y, tk.pos.z, 0.2);
            rd.setLadder(it, null);
            this.planSpot(tk, idx);
            tk.ph = oss ? 'walkTo' : 'toSpot'; tk.t = 0;
            if (oss) { this.oss.land.copy(tk.land); this.oss.pos = tk.pos; this.oss.phase = 'walkTo'; }
          }
          break;
        }
        case 'walkTo': {                                         // Оссана идёт туда, где стоит игрок (куда бы он ни пошёл)
          const pl = this.playerPos();
          const d0 = Math.hypot(pl.x - tk.pos.x, pl.z - tk.pos.z);
          const inDesert = game.space === 'desert';
          const spd = (d0 > 30 ? T.ossRun : T.ossWalk) * smoothstep(0, 0.6, tk.t);
          let d = d0;
          if (inDesert && d0 > T.talkDist) d = this.walkTo(tk, { x: pl.x, z: pl.z }, spd, dt, this._q.set(pl.x - tk.pos.x, 0, pl.z - tk.pos.z));
          else { it.fig.animate(0, dt); rd.placeFree(it, tk.pos, UP, this._q.set(pl.x - tk.pos.x, 0, pl.z - tk.pos.z)); }
          if (d0 > 60) { tk.callT += dt; if (tk.callT > T.callEvery) { tk.callT = 0; this.call(tk); } }
          tk.waitT += dt;
          if (inDesert && d0 <= T.talkDist + 0.05) { tk.ph = 'talk'; tk.t = 0; this.oss.phase = 'talk'; this.startTalk(); }
          else if (tk.waitT > 200) { tk.ph = 'talk'; tk.t = 0; this.startTalk(true); }
          break;
        }
        case 'talk': {
          const pl = this.playerPos();
          const dx = pl.x - tk.pos.x, dz = pl.z - tk.pos.z;
          it.fig.animate(0, dt);
          rd.placeFree(it, tk.pos, UP, this._q.set(dx, 0, dz));
          it.fig.lookAt?.(this._w.set(pl.x, pl.y + 1.5, pl.z));
          if (this.talkDone || this.leaveNow) { it.fig.setTalking?.(false); tk.ph = 'home'; tk.t = 0; this.finishTalk(); }
          break;
        }
        case 'home': {                                           // обратно к червю: стоит у его бока, присматривает
          const d = this.walkTo(tk, tk.spot, T.ossWalk, dt, null);
          if (d < 0.2) { tk.ph = 'stand'; tk.t = 0; }
          break;
        }
        case 'stand': {
          it.fig.animate(0, dt);
          rd.placeFree(it, tk.pos, UP, tk.face);
          break;
        }
        case 'toSpot': {
          const d = this.walkTo(tk, tk.spot, T.ossWalk * 0.85, dt, null);
          if (d < 0.2) { tk.ph = 'sit'; tk.t = 0; it.sitting = true; it.pole.visible = false; }
          break;
        }
        case 'sit': {
          it.sitting = true;
          it.sitW += (1 - it.sitW) * (1 - Math.exp(-2.5 * dt));
          it.fig.animate(0, dt);
          rd.poseSit(it, it.sitW, game.time, tk.touch);
          const lift = -0.0;
          this._w.copy(tk.pos); this._w.y += lift;
          rd.placeFree(it, this._w, UP, tk.face);
          break;
        }
        default: break;
      }
    });
    // Оссана и остальные: старый API
    this.oss.phase = this.tasks[1]?.ph || 'none';
  }

  /** Синхронизация с репликами: RIDER_09 — червь шевелится, RIDER_10 — Оссана уходит на ходу. */
  onSubtitle(e) {
    if (!e || !this._active) return;
    if (e.id === 'DLG_A2_RIDER_09') { this.stirT = 5; this.api.bus.emit('worm:encounter', { phase: 'stir' }); this.api.game.audio?.event?.('Worm.RingSandfall', this.api.K.pos.clone()); this.api.fx.puff(this.api.K.pos.x, this.api.K.pos.y + 6, this.api.K.pos.z, 0.8, 'wide'); }
    if (e.id === 'DLG_A2_RIDER_10') this.leaveNow = true;
  }

  call(tk) {
    const { game } = this.api;
    const ids = ['DLG_A2_CALL_01', 'DLG_A2_CALL_02'];
    game.dialogue?.say?.(ids[(this.callN = ((this.callN || 0) + 1)) % ids.length], tk.pos.clone());
  }

  startTalk(timeout = false) {
    const { game } = this.api;
    this.setPhase('talk');
    this.talkDone = false; this.leaveNow = false; this._holdCb = null; this._talkGuard = game.time + T.talkGuard;
    const it = this.worm.riders.ossana;
    it.fig.setTalking?.(true);
    const t0 = game.time;
    const fin = () => {
      if (!this._active || this.talkDone) return;
      if (game.time - t0 < 1 && !timeout) { this._holdUntil = game.time + T.talkFallback; this._holdCb = () => { this.talkDone = true; }; }   // диалога нет — пауза
      else this.talkDone = true;
    };
    let p = null;
    try { p = game.dialogue?.play?.(DIALOGUE_ID); } catch (e) { console.warn('[worm] диалог', e); }
    if (p && typeof p.then === 'function') p.then(fin, fin); else fin();
  }

  /** Цепочка закончилась: фаза 'rest', Promise выполняется, червь остаётся лежать. Оссана возвращается к телу. */
  finishTalk() {
    const { bus } = this.api;
    if (this.resting) return;
    this.resting = true;
    this.setPhase('rest');
    this.watch(false);
    bus.emit('worm:reveal', { phase: 'end', skipped: false });
    const res = this.resolve; this.resolve = null;
    res?.({ skipped: false });
  }

  /** Каждый кадр: завершает «удержание» паузы, если диалога не было (по игровому времени), и страхует зависший диалог. */
  tickHold() {
    const t = this.api.game.time;
    if (this._holdCb && t >= this._holdUntil) { const r = this._holdCb; this._holdCb = null; r(); }
    if (this.phase === 'talk' && !this.talkDone && t > this._talkGuard) this.talkDone = true;
  }

  lateUpdate() { /* камера не трогается: игрок управляет ею всё время */ }

  /** Для тестов/отладки: поставить сцену в стадию без ожидания. stage: 'arrive' (u) | 'stop' | 'dismount' | 'rest'. */
  debugStage(stage = 'stop', u) {
    this.cancel();
    this.play();
    const p = this.path;
    this.api.fx.jobs.length = 0;
    this.surfaced = true;
    if (stage === 'arrive') { this.advanceTo(u ?? (p.o.approach - 150)); this.v = 30; this.api.K.speed = 30; return; }
    this.advanceTo(p.uStop);
    this.startCollapse();
    if (stage === 'stop') return;
    this.pt = T.collapseTime + 1; this.updateCollapse(0.01);
    this.api.game.time += 0;
    if (stage === 'dismount' || stage === 'rest') {
      this.worm.spine.compute(this.timeV, 1);
      this.startDismount();
    }
  }
}
