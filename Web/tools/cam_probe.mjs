// Проба камеры: в сиетче (зал, галерея, проходы, комнаты, выходной туннель), на борту харвестера и на тропе вращает камеру на 360°
// (по нескольким тангажам), ходит вдоль стен с вращением и прыгает под низким сводом. Считает, как часто камера оказывается
// внутри геометрии / вне пространства игрока / с «прозрачной» ближней плоскостью. Без рендера (game.simulate).
// Независимый оракул — трассировка лучей по реальным мешам: луч «торс игрока → камера» не должен пересекать ни одного меша
// (иначе между телом и камерой стена/потолок/корпус, т. е. камера снаружи или внутри породы). Ближняя плоскость: лучи из камеры
// в углы near-прямоугольника не должны упираться в геометрию ближе длины этого луча.
//   node tools/cam_probe.mjs [--file=rakis_demo.html] [--yawStep=6] [--only=sietch,harvester,trail] [--json=out.json]
// Работает и со старой (третье лицо, setFirstPerson(false), максимальный отъезд) и с новой (первое лицо) камерой — по p.firstPerson.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { root, arg, findChromium, GL } from './lib/harness.mjs';

const file = arg('file', 'rakis_demo.html');
const YAW_STEP = +arg('yawStep', 6);
const ONLY = arg('only', 'sietch,harvester,trail').split(',');
const TP = arg('tp', '0') === '1'; // старая камера: включить третье лицо
const jsonOut = arg('json', '');
const QUICK = arg('quick', '0') === '1'; // сокращённый прогон (3 тангажа, короткие ходьбы, меньше точек) — для загруженной машины
const WALK_SEC = +arg('walkSec', QUICK ? 8 : 25);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: GL.swiftshader });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/AudioContext/.test(m.text())) errors.push(m.text()); });
await page.goto(`file://${root}/dist/${file}?autotest=1&q=low&lang=RU&drs=0&warm=0`, { timeout: 300000 });
await page.waitForFunction(() => window.__rakis?.realTime > 1.5, null, { timeout: 900000, polling: 1000 });

await page.evaluate(([TP, YAW_STEP, QUICK]) => {
  const g = window.__rakis, pl = g.player, T = g.THREE;
  const st = { fwd: 0, jump: 0 };
  g.input.axis = () => ({ x: 0, y: st.fwd });
  const pressed = g.input.pressed; g.input.pressed = (a) => (a === 'Jump' && st.jump ? (st.jump = 0, true) : pressed(a));
  if (TP) pl.setFirstPerson?.(false);
  const rc = new T.Raycaster(); rc.firstHitOnly = false;
  const meshesOf = (obj) => { const a = []; obj?.traverse?.((o) => { if ((o.isMesh || o.isInstancedMesh) && o.visible !== false && o !== pl.figure?.group) a.push(o); }); return a; };
  const V = new T.Vector3(), D = new T.Vector3(), Q = new T.Quaternion();
  const area = (name) => {
    if (name === 'sietch') return meshesOf(g.sietch?.root);
    if (name === 'harvester') return meshesOf(g.harvester?.interior?.group ? g.harvester.root : g.harvester?.root);
    return meshesOf(g.approach?.root);
  };
  const stats = {};
  const S = (k) => (stats[k] ||= { samples: 0, hit: 0, near: 0, space: 0, airBad: 0, blockedFrames: 0, minFrac: 1, examples: [] });
  let curAll = [], curMeshes = [];
  const bsw = new T.Sphere();
  /** Оставить меши в 16 м от игрока (бросать лучи по всем чанкам пещеры слишком дорого). */
  const refresh = () => {
    curMeshes = curAll.filter((m) => {
      if (m.isInstancedMesh) return false;
      const bs = m.geometry.boundingSphere || (m.geometry.computeBoundingSphere(), m.geometry.boundingSphere);
      bsw.copy(bs).applyMatrix4(m.matrixWorld);
      return bsw.center.distanceTo(pl.position) < bsw.radius + 16;
    });
  };
  const corners = [[1, 1], [-1, 1], [1, -1], [-1, -1], [0, 0]];
  const sample = (key, label) => {
    const s = S(key); s.samples++;
    const cam = g.camera; cam.updateMatrixWorld(true);
    const a = new T.Vector3(pl.position.x, pl.position.y + 0.9, pl.position.z), c = cam.position.clone();
    const dist = a.distanceTo(c);
    let bad = false;
    if (dist > 0.05 && curMeshes.length) {
      D.subVectors(c, a).normalize(); rc.set(a, D); rc.far = dist - 0.02;
      if (rc.intersectObjects(curMeshes, false).length) { s.hit++; bad = true; }
    }
    // ближняя плоскость
    const th = Math.tan(cam.fov * Math.PI / 360) * cam.near, tw = th * cam.aspect;
    let near = false;
    for (const [cx, cy] of corners) {
      V.set(cx * tw, cy * th, -cam.near).applyQuaternion(cam.quaternion); const len = V.length(); V.normalize();
      rc.set(c, V); rc.far = len;
      if (curMeshes.length && rc.intersectObjects(curMeshes, false).length) { near = true; break; }
    }
    if (near) s.near++;
    // пространство
    const sp = g.sietch?.contains?.(pl.position), sc = g.sietch?.contains?.(c);
    if (key.startsWith('sietch') && g.sietch?.airDist) { const d = g.sietch.airDist(c); if (d > -0.05 && sc) { s.airBad++; bad = true; } }
    if (key.startsWith('sietch') && sp && !sc) { s.space++; }
    if (g.harvester?.contains && key.startsWith('harvester')) { if (g.harvester.contains(pl.position) !== g.harvester.contains(new T.Vector3(c.x, c.y - 1.62, c.z))) { s.space++; bad = true; } }
    if (pl.cam?.stats) { /* кадры, где голова поджата */ }
    if ((bad || near) && s.examples.length < 3) s.examples.push(`${label} cam=${c.toArray().map((v) => +v.toFixed(1))} pl=${pl.position.toArray().map((v) => +v.toFixed(1))} d=${dist.toFixed(2)}${bad ? ' HIT' : ''}${near ? ' NEAR' : ''}`);
  };
  /** Вращение камеры на 360° на месте по нескольким тангажам (+ сброс сглаживания). */
  window.__spin = (key, setup, meshes) => {
    curAll = area(meshes || key.split(':')[0]);
    g.scene.updateMatrixWorld(true);
    setup();
    g.simulate(1.0, 1 / 60); refresh();
    for (const pitch of QUICK ? [-0.9, 0, 0.9] : [-1.2, -0.5, 0, 0.6, 1.2]) {
      pl.cam.pitch = pitch;
      for (let yd = 0; yd < 360; yd += YAW_STEP) {
        pl.cam.yaw = yd * Math.PI / 180;
        for (let k = 0; k < 6; k++) pl.lateUpdate(1 / 60, g.time); // игрок стоит: достаточно камеры (rig.apply), без полной симуляции — быстрее на загруженной машине
        sample(key + ':spin', `spin y${yd} p${pitch}`);
      }
    }
  };
  /** Ходьба вдоль стен: идём вперёд, камера вращается 80°/с; каждые 3 тика — выборка. Опционально прыжки (под сводом). */
  window.__walkSpin = (key, setup, sec, jump, meshes) => {
    curAll = area(meshes || key.split(':')[0]);
    g.scene.updateMatrixWorld(true);
    setup(); g.simulate(0.5, 1 / 60); refresh();
    st.fwd = 1; let yaw = pl.cam.yaw, n = 0, jt = 0;
    for (let t = 0; t < sec; t += 1 / 60, n++) {
      yaw += (80 * Math.PI / 180) / 60 * (Math.sin(t * 0.7) > -0.3 ? 1 : -1.6);
      pl.cam.yaw = yaw; pl.cam.pitch = jump ? 0.9 : 0.3 * Math.sin(t * 0.9);
      if (jump && (jt -= 1 / 60) <= 0) { st.jump = 1; jt = 0.9; }
      g.simulate(1 / 60, 1 / 60);
      if (n % 30 === 0) refresh();
      if (n % 3 === 0) sample(key + (jump ? ':jump' : ':walk'), 'walk');
    }
    st.fwd = 0;
  };
  window.__stats = () => stats;
  window.__rigStats = () => pl.cam?.stats;
}, [TP, YAW_STEP, QUICK]);

const dump = async (tag) => {
  const st = await page.evaluate(() => window.__stats());
  let t = 0, h = 0, n = 0, sp = 0, ab = 0;
  for (const s of Object.values(st)) { t += s.samples; h += s.hit; n += s.near; sp += s.space; ab += s.airBad; }
  console.log(`  [${tag}] samples=${t} hit=${h} near=${n} space=${sp} airBad=${ab}`);
};
await page.evaluate((v) => { window.__WS = v; }, WALK_SEC);
const run = (fn, args) => page.evaluate(fn, args);
const goto = (n) => page.evaluate(async (n) => { await window.__rakis.debug.goto(n); window.__rakis.simulate(1, 1 / 30); }, n);

if (ONLY.includes('sietch')) {
  const pts = QUICK ? ['B1', 'B2', 'B5', 'exit', 'room', 'cellar', 'bay'] : ['B1', 'B2', 'B5', 'exit', 'exitStart', 'cleft', 'cellar', 'pool', 'station', 'room', 'room2', 'bay'];
  for (const pt of pts) {
    await page.evaluate(async (pt) => { await window.__rakis.sietch.enter(pt); window.__rakis.simulate(0.5, 1 / 30); }, pt);
    await page.evaluate(([pt]) => window.__spin('sietch:' + pt, () => {}, 'sietch'), [pt]);
    await dump('spin sietch ' + pt);
  }
  for (const pt of QUICK ? ['B2', 'exit', 'room'] : ['B1', 'B2', 'B3', 'exit', 'room', 'cellar']) {
    for (const jump of [false, true]) {
      await page.evaluate(async ([pt, jump]) => { const g = window.__rakis; await g.sietch.enter(pt === 'B3' ? 'B2' : pt); }, [pt, jump]);
      await page.evaluate(([pt, jump, WS]) => window.__walkSpin('sietch:' + pt, () => {}, WS, jump, 'sietch'), [pt, jump, WALK_SEC]);
    }
    await dump('walk sietch ' + pt);
  }
}
if (ONLY.includes('harvester')) {
  await page.evaluate(() => { const g = window.__rakis, h = g.harvester; if (g.ui?.startGame && !g.ui.started) g.ui.startGame({ silent: true }); g.player.teleport(h.position.x - 12, g.heightAt(h.position.x - 12, h.position.z), h.position.z, 0); g.simulate(6, 1 / 30); });
  const rooms = await page.evaluate(() => { const g = window.__rakis, I = g.harvester.interior; return { ready: I.ready, rooms: (I.rooms || []).map((R) => ({ id: R.id, b: R.b })) }; });
  console.log('harvester interior ready=' + rooms.ready, 'rooms=' + rooms.rooms.map((r) => r.id).join(','));
  for (const R of rooms.rooms) {
    const ok = await page.evaluate(([R]) => {
      const g = window.__rakis, h = g.harvester, I = h.interior, b = R.b, T = g.THREE;
      const lx = (b.x0 + b.x1) / 2, lz = (b.z0 + b.z1) / 2, f = I.floorAt(lx, lz, b.y0 + 0.5);
      if (!f) return false;
      h.root.updateMatrixWorld(true); const w = h.root.localToWorld(new T.Vector3(lx, f.y, lz));
      window.__hv = w; return true;
    }, [R]);
    if (!ok) { console.log('no floor in room', R.id); continue; }
    await page.evaluate(([id]) => window.__spin('harvester:' + id, () => { const g = window.__rakis, w = window.__hv; g.player.teleport(w.x, w.y, w.z, 0, false); }, 'harvester'), [R.id]);
    await page.evaluate(([id]) => window.__walkSpin('harvester:' + id, () => { const g = window.__rakis, w = window.__hv; g.player.teleport(w.x, w.y, w.z, 0, false); }, window.__WS * 0.6, false, 'harvester'), [R.id]);
    await page.evaluate(([id]) => window.__walkSpin('harvester:' + id, () => { const g = window.__rakis, w = window.__hv; g.player.teleport(w.x, w.y, w.z, 0, false); }, window.__WS * 0.4, true, 'harvester'), [R.id]);
    await dump('harvester room ' + R.id);
  }
  // снаружи, вплотную к корпусу
  await page.evaluate(() => window.__walkSpin('harvester:outside', () => { const g = window.__rakis, h = g.harvester; g.player.teleport(h.position.x - 14, g.heightAt(h.position.x - 14, h.position.z), h.position.z, 0); }, window.__WS, false, 'harvester'));
}
if (ONLY.includes('trail')) {
  await goto('trail');
  const trail = await page.evaluate(() => (window.__rakis.approach.trail || []).map((q) => [q.x, q.y, q.z]));
  for (let i = 20; i < trail.length; i += QUICK ? 110 : 55) {
    await page.evaluate(([t, i]) => window.__spin('trail:' + i, () => { const g = window.__rakis; g.player.teleport(t[0], t[1], t[2], 0); }, 'trail'), [trail[i], i]);
  }
  for (const i of [60, 200, 380]) await page.evaluate(([t, i]) => window.__walkSpin('trail:' + i, () => { const g = window.__rakis; g.player.teleport(t[0], t[1], t[2], 0); }, window.__WS, i === 200, 'trail'), [trail[i], i]);
  await dump('trail');
}

const res = await page.evaluate(() => ({ stats: window.__stats(), rig: window.__rigStats() }));
const agg = {};
for (const [k, s] of Object.entries(res.stats)) {
  const area = k.split(':')[0], mode = k.split(':').pop();
  const a = (agg[area + ':' + mode] ||= { samples: 0, hit: 0, near: 0, space: 0, airBad: 0 });
  for (const f of ['samples', 'hit', 'near', 'space', 'airBad']) a[f] += s[f];
}
console.log('\nкамера: ' + (TP ? 'третье лицо (старая)' : 'первое лицо') + ', rig.stats=' + JSON.stringify(res.rig));
console.log('area:mode        samples   hit(луч торс→камера)  near(ближняя плоскость)  space(вне пространства)  airBad(SDF)');
let totHit = 0, totNear = 0, totSpace = 0, totAir = 0, tot = 0;
for (const [k, a] of Object.entries(agg)) {
  console.log(`${k.padEnd(18)} ${String(a.samples).padStart(6)}  ${String(a.hit).padStart(8)} (${(100 * a.hit / a.samples).toFixed(1)}%)  ${String(a.near).padStart(8)} (${(100 * a.near / a.samples).toFixed(1)}%)  ${String(a.space).padStart(8)}  ${String(a.airBad).padStart(8)}`);
  totHit += a.hit; totNear += a.near; totSpace += a.space; totAir += a.airBad; tot += a.samples;
}
console.log(`ИТОГО samples=${tot} hit=${totHit} (${(100 * totHit / tot).toFixed(2)}%) near=${totNear} (${(100 * totNear / tot).toFixed(2)}%) space=${totSpace} airBad=${totAir}`);
for (const [k, s] of Object.entries(res.stats)) for (const e of s.examples.slice(0, 1)) console.log('  пример', k, e);
console.log(errors.length ? 'ERRORS ' + JSON.stringify([...new Set(errors)].slice(0, 6)) : 'no console errors');
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ agg, total: { tot, totHit, totNear, totSpace, totAir } }));
await browser.close();
process.exit(totHit + totSpace + totAir > 0 ? 1 : 0);
