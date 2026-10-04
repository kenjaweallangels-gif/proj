// Аудит проходимости харвестера БЕЗ браузера: строит схему интерьера (Plan) и визуальные объёмы (Parts.audit), затем «бот» обходит
// все достижимые клетки борта (сетка 0.2 м, от подножия трапа) и считает:
//   pass   — клетки, где центр тела стоит ВНУТРИ видимого твёрдого объёма (стена/мебель/машина/поручень/перемычка двери);
//   jump   — клетки, достижимые только прыжком (перемахнули подоконник/пульт) и/или после приземления внутри объёма либо вне борта;
//   head   — клетки, где макушка (в стойке или при прыжке +0.82 м) входит в плиту потолка/перекрытия;
//   gaps   — клетки пола без видимой плиты снизу/нет потолка над головой (просвет «сквозь» перекрытие);
//   exits  — клетки достижимого графа, где contains()==false, т.е. игрока выкинуло бы наружу (кроме двери).
// node tools/harvester_collide_audit.mjs [--legacy=1] [--room=bridge] [--list=40] [--json=path]
//   --legacy=1 — старая логика (порог перешагивания от ступней, без потолков): числа «до».
import { Parts } from '../src/harvester/parts.js';
import { Plan } from '../src/harvester/ibuild.js';
import { exteriorPlan } from '../src/harvester/plan_ext.js';
import { createPlanQueries, HEAD } from '../src/harvester/plan_query.js';
import { engineRoom, corridor, dorm, stills, mess, lab, gallery, feedHall } from '../src/harvester/rooms_a.js';
import { hall, passage, chart, bridge } from '../src/harvester/rooms_b.js';
import { GANG, FA, FB, FC } from '../src/harvester/layout.js';
import { writeFileSync } from 'node:fs';

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const LEGACY = arg('legacy', '0') === '1', ONLY = arg('room', ''), LIST = Number(arg('list', 25));
const BUILDERS = [gallery, corridor, feedHall, hall, chart, bridge, passage, mess, dorm, stills, lab, engineRoom];

// ---------------------------------------------------------------------------------------------- сборка
const plan = new Plan();
exteriorPlan(plan);
const vis = [];
Parts.audit = vis;
const glow = new Parts(4);
for (const B of BUILDERS) {
  Parts.auditTag = B.name;
  const R = B(plan, glow);
  R.P.list.length = 0;
}
Parts.audit = null;
// потолки: если схема их не знает (старая версия) — выводим из видимых плит (тонкие широкие боксы, не являющиеся полом)
if (!plan.ceils) {
  plan.ceils = [];
  for (const v of vis) {
    if (v.k !== 'box' || v.sy > 0.35 || v.sx < 0.8 || v.sz < 0.8 || Math.abs(v.ry) > 0.01) continue;
    const top = v.cy + v.sy / 2;
    if (plan.floors.some((f) => Math.abs(f.y - top) < 0.1 || Math.abs(f.y1 - top) < 0.1)) continue;
    plan.ceils.push({ x0: v.cx - v.sx / 2, x1: v.cx + v.sx / 2, z0: v.cz - v.sz / 2, z1: v.cz + v.sz / 2, y: v.cy - v.sy / 2 });
  }
}
if (plan.doorBlock) { plan.doorBlock.y0 = plan.doorBlock.y1 = -1e9; }   // шторка поднята (игрок у двери)
const Q = createPlanQueries(plan, { legacy: LEGACY });
const sl = Math.sin, co = Math.cos;

// визуальные твёрдые объёмы → осевые/повёрнутые по Y боксы {x0..z1,y0,y1, ry, cx,cz, hx,hz}
function solids() {
  const out = [];
  for (const v of vis) {
    let hx, hy, hz;
    if (v.k === 'box') { hx = v.sx / 2; hy = v.sy / 2; hz = v.sz / 2; }
    else if (v.axis === 'y') { hx = hz = v.r; hy = v.h / 2; }
    else if (v.axis === 'x') { hx = v.h / 2; hy = hz = v.r; }
    else { hz = v.h / 2; hx = hy = v.r; }
    const tilt = Math.abs(v.rx) + Math.abs(v.rz) > 0.04;
    let y0 = v.cy - hy, y1 = v.cy + hy;
    if (tilt) { const m = Math.max(hx, hy, hz) * 0.6; y0 = v.cy - Math.max(hy, m); y1 = v.cy + Math.max(hy, m); }
    // тонкое (<0.14 по обеим горизонтальным осям), перекрытия/полы и декор — не «тело»
    const wide = Math.min(hx, hz) * 2;
    if (wide < 0.14 && Math.max(hx, hz) * 2 < 0.6) continue;
    if (hy * 2 < 0.16) continue;                         // плоские накладки/полки
    if (tilt && Math.min(hx, hy, hz) * 2 < 0.25) continue;
    out.push({ k: v.k, room: v.room, tag: v.tag, cx: v.cx, cz: v.cz, hx, hz, ry: v.ry, y0, y1, round: v.k === 'cyl' && v.axis === 'y', r: v.r, big: hx * 2 > 1.2 && hz * 2 > 1.2 && hy * 2 < 0.7 });
  }
  return out;
}
const S = solids();
const inside = (b, x, z, m) => {
  const dx = x - b.cx, dz = z - b.cz, c = co(b.ry), s = sl(b.ry);
  const lx = dx * c - dz * s, lz = dx * s + dz * c;       // поворот на -ry (three: ry вращает x к -z)
  if (b.round) return Math.hypot(dx, dz) < b.r - m;
  return Math.abs(lx) < b.hx - m && Math.abs(lz) < b.hz - m;
};

// ---------------------------------------------------------------------------------------------- обход
const CELL = 0.2, R = 0.35, JUMP = 0.82;
const key = (x, z, y, cell = CELL) => `${Math.round(x / cell)},${Math.round(z / cell)},${Math.round(y * 3)}`;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
function bfs(jumpMode, Rr = R, cell = CELL) {
  const key = (x, z, y) => `${Math.round(x / cell)},${Math.round(z / cell)},${Math.round(y * 3)}`;
  const seen = new Map(), q = [];
  const sx = GANG.xFoot - 0.6, sz = GANG.zc;
  const f0 = Q.floorAt(sx, sz, 4.0);
  const st = { x: sx, z: sz, y: f0.y }; seen.set(key(st.x, st.z, st.y), st); q.push(st);
  const o = { x: 0, z: 0 };
  while (q.length) {
    const c = q.pop();
    for (const [dx, dz] of DIRS) {
      for (const air of jumpMode ? [0, 1] : [0]) {
        o.x = c.x + dx * cell; o.z = c.z + dz * cell;
        const fy = c.y + (air ? JUMP : 0);
        const px = o.x, pz = o.z;
        Q.collide(o, fy, Rr);
        if (Math.hypot(o.x - px, o.z - pz) > 0.012) continue;
        const g = Q.floorAt(o.x, o.z, fy);
        if (!g) continue;
        if (g.y - c.y > 0.5) continue;                        // стена/уступ выше шага
        if (c.y - g.y > 0.42 && !air) continue;               // обрыв
        if (air && c.y - g.y > 0.42 + JUMP) continue;
        const k = key(o.x, o.z, g.y);
        if (seen.has(k)) continue;
        const n = { x: o.x, z: o.z, y: g.y, air: !!air || c.air, jumped: !!air };
        seen.set(k, n); q.push(n);
      }
    }
  }
  return seen;
}
const ground = bfs(false);
// маршрутные точки (как tools/harvester_walk.mjs): трап → шлюз → коридор → зал → штурманская → мостик → каюты/лаборатория/машинное/приёмный зал
const WAY = [['ramp-top', 15, 25.6, 10.6], ['landing', 10.5, 24.0, 10.6], ['door', 11.3, 20.0, 10.6], ['gallery', 11, 14, 10.6], ['gallery-mid', 11, 3.0, 10.6], ['corr-mouth', 6.0, 1.8, 10.6],
  ['stair-top', -6.4, 1.8, 17.9], ['hall', -9, 1.8, 17.9], ['hall-n', -9, 8, 17.9], ['hall-e', 8, 12.3, 17.9], ['passage', 18, 12.3, 17.9], ['chart', 23.5, 12.3, 17.9], ['chart-stair-base', 25.6, 17.2, 17.9],
  ['stair-top-e', 36.2, 16.9, 22.9], ['bridge', 36, 14.5, 22.9], ['bridge-back', 26.5, 12, 22.9], ['catwalk-s', -20, 14.5, 21.2], ['catwalk-n', -20, -14.5, 21.2], ['catwalk-back', -30.2, 0, 21.2], ['hall-tail', -38, 0, 17.9],
  ['corr-west', -20, -1.0, 10.6], ['dorm-in', -25, 10.5, 10.6], ['mess-in', -22, -10.5, 10.6], ['engine', -36, 0, 10.6], ['engine-n', -36, -12, 10.6], ['engine-s', -36, 12, 10.6], ['lab', 0, -10.0, 10.6], ['stills', 3, 6, 10.6], ['feed', 20, 8.0, 10.6], ['feed-n', 25, -10, 10.6]];
const reach = (set, [, x, z, y], CELL = 0.2) => { const key = (x, z, y) => `${Math.round(x / CELL)},${Math.round(z / CELL)},${Math.round(y * 3)}`; for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = -4; dy <= 4; dy++) if (set.has(key(x + dx * CELL, z + dz * CELL, y + dy / 3))) return true; return false; };
const ground45 = bfs(false, 0.45, 0.1);
const WAY45 = WAY.filter((w) => w[3] < 11);   // r=0.45 только нижняя палуба: ступени трапов считаются под радиус тела 0.35
const wayBad = WAY.filter((w) => !reach(ground, w)).map((w) => w[0]), wayBad45 = WAY45.filter((w) => !reach(ground45, w, 0.1)).map((w) => w[0]);
if (arg('dbg', '0') === '1') {
  const m = {}; for (const [, c] of ground45) { const k = Math.round(c.y); m[k] = (m[k] || 0) + 1; }
  console.log('r=0.45 по палубам', JSON.stringify(m));
  const m2 = {}; for (const [, c] of ground) { const k = Math.round(c.y); m2[k] = (m2[k] || 0) + 1; } console.log('r=0.35 по палубам', JSON.stringify(m2));
  let mx = -1e9, mn = 1e9; for (const [, c] of ground45) if (c.y > 11 && c.y < 17.5) { mx = Math.max(mx, c.y); mn = Math.min(mn, c.x); } console.log('stair r45 max y', mx, 'min x', mn);
}
if (wayBad.length) for (const n of wayBad) {
  const w = WAY.find((q) => q[0] === n); let best = null, bd = 1e9;
  for (const [, c] of ground) { if (Math.abs(c.y - w[3]) > 1.5) continue; const d = Math.hypot(c.x - w[1], c.z - w[2]); if (d < bd) { bd = d; best = c; } }
  const bl = plan.blockers.filter((b) => w[1] > b.x0 - 0.5 && w[1] < b.x1 + 0.5 && w[2] > b.z0 - 0.5 && w[2] < b.z1 + 0.5 && b.y1 > w[3] + 0.4 && b.y0 < w[3] + 1.7).map((b) => [b.x0, b.x1, b.z0, b.z1, b.y0, b.y1].map((v) => v.toFixed(2)).join(' '));
  console.log(`  недоступно ${n}: ближайшая достижимая ${best ? [best.x, best.y, best.z].map((v) => v.toFixed(1)) : '-'} (${bd.toFixed(1)} м); блокеры у точки: ${bl.slice(0, 4).join(' | ')}`);
}
const withJump = LEGACY || arg('jump', '1') === '1' ? bfs(true) : ground;

// ---------------------------------------------------------------------------------------------- проверки
const nfList = [];
const stat = { cells: ground.size, jumpOnly: 0, pass: 0, passJump: 0, head: 0, headJump: 0, noCeil: 0, noFloor: 0, exits: 0 };
const headJumpList = [], byBox = new Map(), byRoomPass = {}, headList = [], gapList = [], exitList = [], jumpList = [];
function hits(c, feetY) {
  const res = [];
  for (const b of S) {
    if (b.y1 <= feetY + 0.45 || b.y0 >= feetY + 1.6) continue;
    if (Math.abs(b.cx - c.x) > b.hx + b.hz + 1 || Math.abs(b.cz - c.z) > b.hx + b.hz + 1) continue;
    if (inside(b, c.x, c.z, 0.04)) res.push(b);
  }
  return res;
}
const bkey = (b) => `${b.room}:${b.k}:${b.cx.toFixed(2)},${b.cz.toFixed(2)}:${(b.hx * 2).toFixed(2)}x${((b.y1 - b.y0)).toFixed(2)}x${(b.hz * 2).toFixed(2)}@y${b.y0.toFixed(2)}`;
function roomOf(c) { return S.find((b) => b.big && inside(b, c.x, c.z, 0))?.room || '?'; }
for (const [, c] of withJump) {
  const isGround = ground.has(key(c.x, c.z, c.y));
  if (!isGround) stat.jumpOnly++;
  const hs = hits(c, c.y);
  if (hs.length) {
    if (isGround) stat.pass++; else stat.passJump++;
    for (const b of hs) { const k = bkey(b); const e = byBox.get(k) || { b, n: 0, ground: 0, at: [c.x, c.y, c.z] }; e.n++; if (isGround) e.ground++; byBox.set(k, e); }
  }
  if (!isGround && !hs.length) { if (jumpList.length < 2000) jumpList.push([c.x, c.y, c.z]); }
  // потолок: макушка в стойке / в прыжке
  const ce = Q.ceilingAt(c.x, c.z, c.y, 0);
  if (isGround && c.y + HEAD > ce) { stat.head++; if (headList.length < 400) headList.push([c.x, c.y, c.z, ce]); }
  else if (isGround && c.y + HEAD + JUMP > ce) { stat.headJump++; if (headJumpList.length < 400) headJumpList.push([c.x, c.y, c.z, ce]); }
  // просвет: плита над головой есть? (пол видим: есть пол по plan; потолок — Plan.ceils или пол выше в пределах 8 м)
  if (isGround && !(ce < c.y + 16)) {
    // на трапе/посадочной площадке потолка нет по замыслу (улица)
    const outdoor = c.z > 19.3 || c.y < FA - 0.1;
    if (!outdoor) { stat.noCeil++; gapList.push([c.x, c.y, c.z]); }
  }
  // выброс наружу: после контакта contains() ложно
  if (isGround && !Q.contains(c.x, c.z, c.y)) { stat.exits++; if (exitList.length < 100) exitList.push([c.x, c.y, c.z]); }
}
// визуальные плиты под ногами: у каждого пола должен быть видимый бокс-плита (верх в пределах 0.12 от высоты пола)
const floorSlabs = S.concat(vis.filter((v) => v.k === 'box' && v.sy < 0.5 && v.sx > 0.8 && v.sz > 0.8).map((v) => ({ cx: v.cx, cz: v.cz, hx: v.sx / 2, hz: v.sz / 2, ry: v.ry, y0: v.cy - v.sy / 2, y1: v.cy + v.sy / 2, room: v.room }))).filter((b) => b.y1 - b.y0 < 0.6 && b.hx > 0.4);
for (const [, c] of ground) {
  if (c.y < FA - 0.1 || c.z > 19.9) continue;
  const fy = (x, z) => Q.floorAt(x, z, c.y)?.y ?? c.y;
  const sl1 = fy(c.x + 0.4, c.z) - fy(c.x - 0.4, c.z), sl2 = fy(c.x, c.z + 0.4) - fy(c.x, c.z - 0.4);
  if (Math.abs(sl1) > 0.05 || Math.abs(sl2) > 0.05) continue;     // лестницы/трапы: ступени-боксы отдельно
  if (!floorSlabs.some((b) => Math.abs(b.y1 - c.y) < 0.16 && inside({ ...b, round: false }, c.x, c.z, -0.05))) {
    // ступени лестниц — это ступени-боксы (S их не включает как плиты): считаем только плоские полы
    stat.noFloor++; if (nfList.length < 2000) nfList.push([c.x, c.y, c.z]);
  }
}
// видимый пол без проходимости: можно провалиться сквозь плиту на нижнюю палубу
stat.floorHole = 0; const holeList = [];
for (const v of vis) {
  if (v.k !== 'box' || v.sy > 0.5 || v.sx < 0.8 || v.sz < 0.8 || Math.abs(v.ry) > 0.01) continue;
  const top = v.cy + v.sy / 2, bot = v.cy - v.sy / 2;
  if (plan.ceils.some((c) => Math.abs(c.y - bot) < 0.02)) continue;                  // это потолок
  if (Math.abs(top - Math.round(top * 10) / 10) > 0.06 && !plan.floors.some((f) => Math.abs(f.y - top) < 0.1)) continue;   // не пол
  for (let x = v.cx - v.sx / 2 + 0.15; x < v.cx + v.sx / 2 - 0.1; x += 0.3) for (let z = v.cz - v.sz / 2 + 0.15; z < v.cz + v.sz / 2 - 0.1; z += 0.3) {
    const ok = plan.floors.some((f) => f.y === f.y1 && Math.abs(f.y - top) < 0.12 && x >= f.x0 - 0.02 && x <= f.x1 + 0.02 && z >= f.z0 - 0.02 && z <= f.z1 + 0.02);
    if (!ok) { if (!plan.floors.some((f) => Math.abs(f.y - top) < 0.1)) continue; stat.floorHole++; if (holeList.length < 8) holeList.push(`${v.room} ${x.toFixed(1)},${top.toFixed(2)},${z.toFixed(1)}`); }
  }
}
// обрывы: клетка достижима, сосед за краем свободен (не блокируется), но пола нет/ниже более чем на 0.42
stat.cliff = 0; const cliffList = [];
{
  const o2 = { x: 0, z: 0 };
  for (const [, c] of ground) {
    for (const [dx, dz] of DIRS) {
      o2.x = c.x + dx * 0.3; o2.z = c.z + dz * 0.3; const px = o2.x, pz = o2.z;
      Q.collide(o2, c.y, R);
      if (Math.hypot(o2.x - px, o2.z - pz) > 0.012) continue;
      const g = Q.floorAt(o2.x, o2.z, c.y);
      if (!g || c.y - g.y > 0.42) {
        // у двери (улица) — законный выход
        if (c.z > 19.3 && c.x > 9 && c.x < 14) continue;
        if (c.x > 36.0 && c.z > 24 && c.z < 27.2) continue;   // подножие трапа: сход на грунт
        stat.cliff++; if (cliffList.length < 400) cliffList.push([c.x, c.y, c.z, dx, dz]);
      }
    }
  }
}
const list = [...byBox.values()].sort((a, b) => b.n - a.n);
const roomsAgg = {};
for (const e of list) { const r = e.b.room; (roomsAgg[r] ||= { boxes: 0, cells: 0 }); roomsAgg[r].boxes++; roomsAgg[r].cells += e.n; }
console.log(`режим: ${LEGACY ? 'LEGACY (до)' : 'текущий'}; блокеров ${plan.blockers.length}, полов ${plan.floors.length}, потолков ${plan.ceils.length}, визуальных объёмов ${S.length}`);
console.log(`достижимых клеток 0.2 м: пешком ${ground.size}, с прыжком ${withJump.size} (+${stat.jumpOnly} только прыжком)`);
console.log(`ROUTE: недоступно точек маршрута ${wayBad.length}/${WAY.length} ${wayBad.join(',')}; при радиусе 0.45 м, нижняя палуба (проходы ≥0.9 м): ${wayBad45.length}/${WAY45.length} ${wayBad45.join(',')}; клеток r=0.45: ${ground45.size}`);
console.log(`PASS (тело внутри видимого объёма, пешком): ${stat.pass} клеток в ${list.filter((e) => e.ground).length} объёмах`);
console.log(`PASS-JUMP (то же после прыжка): ${stat.passJump}; клеток, куда попали только прыжком: ${stat.jumpOnly}`);
console.log(`HEAD (макушка в плите стоя): ${stat.head}; при прыжке: ${stat.headJump}`);
console.log(`NO-CEIL (над клеткой нет потолка/перекрытия): ${stat.noCeil}; NO-FLOOR (нет видимой плиты пола): ${stat.noFloor}; EXITS (contains=false): ${stat.exits}`);
console.log(`FLOOR-HOLE (видимая плита без пола, провал): ${stat.floorHole} ${holeList.join(' | ')}`);
console.log(`CLIFF (шаг в пустоту/на нижнюю палубу без ограды): ${stat.cliff}`);
console.log('по комнатам (объёмы/клетки):', JSON.stringify(roomsAgg));
for (const e of list.slice(0, ONLY ? 999 : LIST)) if (!ONLY || e.b.room === ONLY) console.log(`  ${e.b.room.padEnd(10)} ${e.b.k} ${bkey(e.b).split(':').slice(2).join(' ')} cells=${e.n} (ground ${e.ground}) tag=${e.b.tag} at=${e.at.map((v) => v.toFixed(1))}`);
if (headList.length) console.log('HEAD примеры:', headList.slice(0, 6).map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' | '));
if (gapList.length) console.log('NO-CEIL примеры:', gapList.filter((_, i) => i % Math.ceil(gapList.length / 10) === 0).map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' | '));
if (jumpList.length && jumpList.length < 40) console.log('JUMP-ONLY клетки:', jumpList.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' | '));
if (nfList.length) console.log('NO-FLOOR примеры:', nfList.filter((_, i) => i % Math.ceil(nfList.length / 8) === 0).map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' | '));
if (cliffList.length) console.log('CLIFF примеры:', cliffList.filter((_, i) => i % Math.ceil(cliffList.length / 8) === 0).map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' | '));
if (headJumpList.length) console.log('HEAD-JUMP примеры:', headJumpList.filter((_, i) => i % Math.ceil(headJumpList.length / 6) === 0).map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' | '));
if (exitList.length) console.log('EXIT примеры:', exitList.slice(0, 6).map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' | '));
const j = arg('json', '');
if (j) writeFileSync(j, JSON.stringify({ stat, list: list.map((e) => ({ ...e.b, n: e.n, ground: e.ground, at: e.at })) }, null, 1));
const bad = wayBad.length + wayBad45.length + stat.pass + stat.passJump + stat.head + stat.exits + stat.floorHole + stat.cliff + stat.noCeil;
console.log(bad ? `AUDIT: ПРОБЛЕМЫ (${bad})` : 'AUDIT: OK');
process.exit(bad ? 1 : 0);
