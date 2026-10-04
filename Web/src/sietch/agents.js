// Движение горожан сиетча: рулёжка (steering) вместо «шагов по прямой» и сдвигов позиции.
//  • путь по навигационной сетке (nav.js) с правой полосой; точки пути «захватываются» заранее — на поворотах скорость снижается;
//  • ускорение ограничено (профиль скорости), курс следует за вектором скорости с ограничением угловой скорости → нет дрожания и «скольжения»:
//    скорость анимации = реальная скорость;
//  • избегание: отталкивание от людей/игрока/спутников плавной силой + правосторонний обход встречных + замедление за идущим впереди;
//  • стены/реквизит: мягкое отталкивание градиентом + жёсткое ограничение (collideLocal) — сквозь стены не ходят;
//  • «шаг в сторону» вместо толчка: стоящие уступают дорогу игроку коротким шагом и потом возвращаются (см. social.js).
// Все числа — в MOVE_CFG (аналог DataAsset).
import { clamp, dampAngle, damp } from '../core/util.js';

export const MOVE_CFG = {
  accel: 2.4,              // м/с² разгон/торможение (взрослые)
  accelChild: 4.2,
  accelElder: 1.5,
  capture: 0.55,           // м: радиус «захвата» промежуточной точки пути
  arriveDecel: 1.5,        // м/с²: профиль торможения к конечной точке v = sqrt(2·a·d)
  arriveSnap: 0.09,        // м: считаем, что пришли
  minArriveSpeed: 0.22,    // м/с: минимальная скорость подхода (чтобы дойти)
  turnLambda: 7,           // 1/с: сглаживание курса при ходьбе
  idleTurnLambda: 3.2,     // 1/с: поворот на месте
  minYawSpeed: 0.2,        // курс следует за скоростью, если она больше (м/с)
  radius: 0.26,            // радиус тела горожанина
  childRadius: 0.2,
  comfort: 0.32,           // м: желаемый зазор между людьми сверх радиусов
  avoidRange: 1.9,         // м: дальность избегания
  pushGain: 1.35,          // м/с: сила отталкивания при касании
  rightBias: 0.95,         // м/с: правосторонний обход встречного
  wallRange: 0.52,         // м: ближе к стене — отталкивание
  wallGain: 0.9,
  hardWall: 0.24,          // м: жёсткий минимум до стены (если не у конечной цели)
  maxTurn: 3.6,            // рад/с: предел угловой скорости корпуса
  playerRadius: 0.4,
  hardSep: 0.78, playerHard: 0.45, sepMax: 0.08, // жёсткое расталкивание: доля суммы радиусов, м у камеры, макс. сдвиг за тик (м)
  slowAhead: 0.15,         // нижняя доля скорости за идущим/стоящим впереди
  stuckSpeed: 0.12, stuckT: 1.2, replanT: 3.5, giveUpT: 12,
  farRange: 26,            // м: дальше — упрощённое движение (без избегания), редкий тик
};

export function createMover(env) {
  const { nav, plan, npcs, R } = env;
  const C = MOVE_CFG;
  const wn = { x: 0, z: 0 }, pp = { x: 0, z: 0 };
  const radiusOf = (n) => (n.arch === 'Child' ? C.childRadius : C.radius);

  /** Начать движение к точке. after — коллбэк прихода; o: {speed (множитель), direct (без A*), lane:false, irregular}. */
  function goTo(n, x, z, after, o = {}) {
    cancel(n);
    n.mode = 'walk'; n.after = after || null; n.goal = { x, z }; n.pi = 0; n.path = null; n.pathT = 0; n.blockedT = 0; n.slowIgnore = 0;
    n.speedBoost = o.speed ?? 1; n.irregular = o.irregular ?? 0; n.pathOpts = o;
    const d = Math.hypot(x - n.x, z - n.z);
    if (o.direct || (d < 3 && nav.lineClear(n.x, n.z, x, z))) { n.path = [[x, z]]; return; }
    n.pathReq = nav.request({ x: n.x, z: n.z }, { x, z }, (p) => {
      n.pathReq = null;
      if (!p || !p.length) { env.onGiveUp?.(n); return; }
      n.path = p; n.pi = 0;
    }, { lane: o.lane });
  }
  function cancel(n) { if (n.pathReq) { nav.cancel(n.pathReq); n.pathReq = null; } n.path = null; n.after = null; }
  /** Остановиться на месте (без after). */
  function halt(n) { cancel(n); n.mode = 'act'; n.after = null; n.speedBoost = 1; n.irregular = 0; }

  /** Один шаг движения идущего. nbrs — функция обхода соседей (мировые локальные координаты), env.plL — игрок. */
  function step(n, dt, far, speedMul = 1) {
    if (!n.path) {
      // ждём путь из очереди A*: стоим (скорость → 0)
      n.vx = damp(n.vx || 0, 0, 8, dt); n.vz = damp(n.vz || 0, 0, 8, dt);
      n.speedNow = Math.hypot(n.vx, n.vz); n.pathT += dt;
      if (n.pathT > 20) { halt(n); n.after = null; }
      return;
    }
    const P = n.path;
    // --- текущая цель
    let wp, dx, dz, d, last;
    for (;;) {
      if (n.pi >= P.length) { arrive(n); return; }
      wp = P[n.pi]; last = n.pi === P.length - 1;
      dx = wp[0] - n.x; dz = wp[1] - n.z; d = Math.hypot(dx, dz);
      if (!last && d < C.capture) { n.pi++; continue; }
      break;
    }
    // сторож прогресса: у цели (≤2 м) за 2.5 с не приблизился на 0.15 м → пришёл (зажат людьми/реквизитом)
    if (last && d < 2) { if (n.progD === undefined || d < n.progD - 0.15) { n.progD = d; n.progT = 0; } else if ((n.progT += dt) > 2.5) { n.progD = undefined; arrive(n); return; } } else n.progD = undefined;
    const vmax = n.speed * (n.speedBoost ?? 1) * speedMul * (n.irregular ? 0.6 + 0.8 * Math.abs(Math.sin(n.phase + env.time() * 3.7)) : 1);
    const inv = d > 1e-5 ? 1 / d : 0;
    let dirx = dx * inv, dirz = dz * inv;
    let vd = vmax;
    if (last) vd = Math.min(vmax, Math.max(C.minArriveSpeed, Math.sqrt(2 * C.arriveDecel * d)));
    else {
      // поворот на следующей точке: срезаем скорость
      const nx2 = P[n.pi + 1][0] - wp[0], nz2 = P[n.pi + 1][1] - wp[1], l2 = Math.hypot(nx2, nz2) || 1;
      const cosT = dirx * nx2 / l2 + dirz * nz2 / l2;
      if (cosT < 0.95) { const kc = 0.55 + 0.45 * Math.max(0, cosT), w = clamp((2.4 - d) / 1.6, 0, 1); vd *= 1 + (kc - 1) * w; }
    }
    let ax = dirx * vd, az = dirz * vd, sepx = 0, sepz = 0;

    if (!far) {
      const rN = radiusOf(n), L = n.layer || 0;
      // --- люди: избегание
      const rx = -dirz, rz = dirx; // «вправо» от направления движения
      let slow = 1;
      const hard = (ox, oz, hm, k) => { const px = n.x - ox, pz = n.z - oz, dd = Math.hypot(px, pz); if (dd < hm && dd > 1e-4) { const ov = (hm - dd) * k; sepx += px / dd * ov; sepz += pz / dd * ov; } };
      const nbr = (ox, oz, rO, ovx, ovz, ownMoving) => {
        const px = n.x - ox, pz = n.z - oz, dist = Math.hypot(px, pz);
        if (dist > C.avoidRange || dist < 1e-4) return;
        const minD = rN + rO + C.comfort;
        const w = clamp((minD + 0.5 - dist) / 0.5, 0, 1);
        if (w > 0) { const k = w * w * C.pushGain / dist; ax += px * k; az += pz * k; }
        const ahead = -(px * dirx + pz * dirz);               // проекция «на соседа» на мой курс
        if (ahead > 0.05 && dist < minD + 1.1) {
          const lat = -(px * rx + pz * rz);                   // сосед справа (+) / слева (−) от меня
          const w2 = clamp((minD + 1.1 - dist) / 1.1, 0, 1);
          // встречный (идёт на меня) → обе стороны берут вправо; стоящий → обходим со стороны, где он дальше от оси
          const head = ownMoving && (ovx * dirx + ovz * dirz) < -0.15;
          const side = head ? 1 : (lat > 0.08 ? -1 : lat < -0.08 ? 1 : 1);
          ax += rx * side * C.rightBias * w2; az += rz * side * C.rightBias * w2;
          if (Math.abs(lat) < minD * 0.9 && n.slowIgnore <= 0) slow = Math.min(slow, C.slowAhead + (1 - C.slowAhead) * clamp((dist - (rN + rO) * 0.9) / 1.1, 0, 1));
        }
      };
      for (let i = 0; i < npcs.length; i++) {
        const o = npcs[i];
        if (o === n || o.lod === 'off' || (o.layer || 0) !== L || o.kind === 'sleep') continue;
        if (Math.abs(o.x - n.x) > C.avoidRange || Math.abs(o.z - n.z) > C.avoidRange) continue;
        if (o === n.partner || o === n.leader || o.leader === n || (n.chat && o.chat === n.chat)) { // свои по разговору: избегаем только касания
          const px = n.x - o.x, pz = n.z - o.z, dist = Math.hypot(px, pz), minD = rN + radiusOf(o) + 0.1;
          if (dist < minD && dist > 1e-4) { const k = (minD - dist) / minD * C.pushGain / dist; ax += px * k; az += pz * k; }
          continue;
        }
        hard(o.x, o.z, (rN + radiusOf(o)) * C.hardSep * (n.arch === 'Child' && o.arch === 'Child' ? 0.7 : 1), o.mode === 'walk' ? 0.5 : 1);
        const sitting = o.mode === 'seat' || o.pose === 'sitFloor' || o.pose === 'sitBench' || o.pose === 'weave' || o.pose === 'pray';
        nbr(o.x, o.z, sitting ? radiusOf(o) * 0.9 : radiusOf(o), o.mode === 'walk' ? o.vx : 0, o.mode === 'walk' ? o.vz : 0, o.mode === 'walk');
      }
      // игрок (камера) и спутники
      nbr(env.plL.x, env.plL.z, C.playerRadius, env.plV.x, env.plV.z, env.plV.x * env.plV.x + env.plV.z * env.plV.z > 0.25);
      for (const c of env.comps()) { nbr(c.x, c.z, 0.3, c.vx, c.vz, true); hard(c.x, c.z, 0.5, 1); }
      hard(env.plL.x, env.plL.z, C.playerHard, 1);
      // --- стены / реквизит
      if (!(last && d < 1.2) && !n.noWall) {
        const wd = plan.wallDistLocal(n.x, n.z, L, wn);
        if (wd < C.wallRange) { const w = clamp((C.wallRange - wd) / 0.28, 0, 1); ax += wn.x * w * w * C.wallGain; az += wn.z * w * w * C.wallGain; }
      }
      // не даём сумме сил разогнать выше 1.25 vmax
      const am = Math.hypot(ax, az), cap = vmax * 1.25;
      if (am > cap) { ax *= cap / am; az *= cap / am; }
      ax *= slow; az *= slow;
      // зажатые (скорость ~0 дольше stuckT): временно игнорируем замедление, затем перепланируем
      const sp = Math.hypot(n.vx || 0, n.vz || 0);
      if (sp < C.stuckSpeed && d > 0.5 && vd > 0.3) n.blockedT += dt; else n.blockedT = Math.max(0, n.blockedT - dt * 2);
      if (n.slowIgnore > 0) n.slowIgnore -= dt;
      if (n.blockedT > C.stuckT && last && d < 1.6) { arrive(n); return; }   // почти дошёл, но зажат людьми — считаем, что пришёл
      if (n.blockedT > C.stuckT && n.slowIgnore <= 0) { n.slowIgnore = 2.2; }
      if (n.blockedT > C.replanT) { n.blockedT = 0; n.stuckCount = (n.stuckCount || 0) + 1; if (n.stuckCount > 2 || !n.goal) { env.onGiveUp?.(n); return; } replan(n); return; }
    }

    // --- предел поворота вектора скорости (плавные дуги, без мгновенных разворотов): гистерезис цели
    if (!far) {
      const cs = Math.hypot(n.vx || 0, n.vz || 0), as = Math.hypot(ax, az);
      if (cs > 0.45 && as > 0.1) {
        let da = Math.atan2(az, ax) - Math.atan2(n.vz, n.vx); da = Math.atan2(Math.sin(da), Math.cos(da));
        const lim = C.maxTurn * dt;
        if (Math.abs(da) > lim) { const a2 = Math.atan2(n.vz, n.vx) + Math.sign(da) * lim; ax = Math.cos(a2) * as; az = Math.sin(a2) * as; }
      }
    }
    // --- динамика скорости
    const acc = (n.arch === 'Child' ? C.accelChild : n.arch === 'Elder' ? C.accelElder : C.accel) * (n.speedBoost > 1.5 ? 2 : 1);
    let dvx = ax - (n.vx || 0), dvz = az - (n.vz || 0);
    if (far) { n.vx = ax; n.vz = az; } else {
      const dm = Math.hypot(dvx, dvz), mx = acc * dt;
      if (dm > mx) { dvx *= mx / dm; dvz *= mx / dm; }
      n.vx = (n.vx || 0) + dvx; n.vz = (n.vz || 0) + dvz;
    }
    const sp = Math.hypot(n.vx, n.vz);
    // --- перемещение
    let nxp = n.x + n.vx * dt, nzp = n.z + n.vz * dt;
    if (last && Math.hypot(wp[0] - nxp, wp[1] - nzp) < C.arriveSnap || (last && d < C.arriveSnap)) { n.x = wp[0]; n.z = wp[1]; arrive(n); return; }
    // не перелетаем конечную точку
    if (last && sp * dt > d) { nxp = wp[0]; nzp = wp[1]; }
    n.x = nxp; n.z = nzp;
    if (!far && (sepx || sepz)) { const sl = Math.hypot(sepx, sepz), m = Math.min(sl, C.sepMax); n.x += sepx / sl * m; n.z += sepz / sl * m; }
    if (!far && !n.noWall && !(last && d < 1.25)) { pp.x = n.x; pp.z = n.z; if (plan.collideLocal(pp, C.hardWall, n.layer || 0)) { n.x = pp.x; n.z = pp.z; } }
    n.speedNow = sp;
    if (sp > C.minYawSpeed) n.walkYaw = Math.atan2(n.vx, n.vz);
  }

  function arrive(n) {
    n.vx = n.vz = 0; n.speedNow = 0; n.mode = 'act'; n.speedBoost = 1; n.irregular = 0; n.path = null; n.stuckCount = 0;
    const a = n.after; n.after = null; a?.(n);
  }
  function replan(n) {
    const g = n.goal, a = n.after, o = n.pathOpts || {};
    if (!g) return;
    const keepV = [n.vx, n.vz];
    goTo(n, g.x, g.z, a, { ...o, direct: false });
    n.vx = keepV[0]; n.vz = keepV[1];
  }
  return { goTo, cancel, halt, step, replan, radiusOf };
}
