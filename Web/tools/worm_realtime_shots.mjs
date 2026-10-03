// Встреча с червём в РЕАЛЬНОМ ВРЕМЕНИ (без кинокамеры): снимки с точки зрения игрока (+ ракурсы «наездники» и «с воздуха»), проверка управления,
// отсутствия cinematic/letterbox, NaN/чёрного экрана и пересечения червя с харвестером.
// node tools/build_data.mjs && node tools/build.mjs --out=worm.html && node tools/worm_realtime_shots.mjs [--q=med --every=3 --dt=0.0333 --tag=rt --harvester=1 --views=player,riders,aerial]
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openGame, capture, arg, root } from './lib/harness.mjs';

const tag = arg('tag', 'rt');
const outDir = join(root, 'dist', 'shots', tag);
const dt = Number(arg('dt', 1 / 30)), every = Number(arg('every', 3)), minLum = Number(arg('minlum', 22));
const views = arg('views', 'player,riders,aerial').split(',');
const { browser, page, errors } = await openGame({ file: arg('file', 'worm.html'), q: arg('q', 'med'), w: Number(arg('w', 1280)), h: Number(arg('h', 720)), gl: arg('gl', 'swiftshader') });

// монитор: пересечение тела червя с харвестером (по точкам позвоночника), управление игроком, cinematic/letterbox
await page.evaluate(() => {
  const g = window.__rakis;
  window.__mon = { maxPen: 0, steps: 0, cin: 0, lock: 0, penAt: null };
  window.__watch = () => {
    const w = g.worm, hv = g.harvester, m = window.__mon;
    m.steps++;
    if (g.cinematic.active) m.cin++;
    if (g.player.inputLocked) m.lock++;
    if (!w.exposed) return;
    const P = w.spine.P, V = g.THREE.Vector3, v = new V(), q = new V();
    for (const e of hv.colliderEntries) {
      for (let i = 0; i < 91; i++) {
        v.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
        const R = 20 * w.spine.RS[i] * 0.9;
        if (v.y + R < g.heightAt(v.x, v.z)) continue;
        g.colliders.closestPoint(e, v, q);
        const pen = R - v.distanceTo(q);
        if (pen > m.maxPen) { m.maxPen = pen; m.penAt = [i, +v.x.toFixed(0), +v.z.toFixed(0), +(g.time - window.__t0).toFixed(1)]; }
      }
    }
  };
});

if (arg('harvester', '0') === '1') {
  // харвестер на пути червя: ставим после построения маршрута (prepare) — смотрим, что червь обходит
  await page.evaluate(() => {
    const g = window.__rakis, d = g.worm.director;
    const p = d.prepare(); d.api.K.scripted = false;
    const at = p.at(Math.min(p.uStop * 0.6, 520));
    g.harvester.place(at.x + 6, at.z + 4, at.yaw);
    g.harvester.debugSet('running');
  });
}

const results = [];
let idx = 0;
async function shot(label) {
  const info = await page.evaluate(() => {
    const g = window.__rakis, w = g.worm, d = w.director;
    return { phase: w.encounterPhase(), t: +(g.time - window.__t0).toFixed(1), head: w.headPos.toArray().map((v) => +v.toFixed(0)), oss: d.tasks?.[1]?.ph, cin: g.cinematic.active, pl: g.player.position.toArray().map((v) => +v.toFixed(0)) };
  });
  for (const view of views) {
    const name = `${String(idx).padStart(2, '0')}_${label}_${view}`;
    let cameraFn = null;
    if (view === 'player') {
      // «игрок оборачивается на шум»: тот же вид, но с поворотом к голове червя, пока она не слишком близко
      cameraFn = () => {
        const g = window.__rakis, w = g.worm, p = g.player.position;
        const dx = w.headPos.x - p.x, dz = w.headPos.z - p.z, dd = Math.hypot(dx, dz);
        let yaw = Math.atan2(dz, dx);
        if (w.state === 'Ridden' && w.director.active) {
          const o = w.director.tasks?.[1]; // Оссана идёт к игроку — смотрим на неё
          if (o && ['walkTo', 'talk'].includes(o.ph)) yaw = Math.atan2(o.pos.z - p.z, o.pos.x - p.x);
        }
        if (dd > 15) g.player.teleport(p.x, p.y, p.z, yaw, false);
        g.player.setFirstPerson?.(true);
        g.camera.fov = 62; g.camera.updateProjectionMatrix();
      };
    } else if (view === 'riders') {
      cameraFn = () => {
        const g = window.__rakis, T = g.THREE, w = g.worm, cam = g.camera, K = w.K;
        if (!w.exposed) return;
        const it = w.riders.items[1], e = it.root.matrix.elements, o = new T.Vector3(e[12], e[13], e[14]);
        const sp = w.spine, P = new T.Vector3(), N = new T.Vector3();
        sp.surfacePoint(46, 0, P, N, 0);
        const side = new T.Vector3().crossVectors(sp._b, N).normalize();
        cam.position.copy(P).addScaledVector(side, 38).addScaledVector(N, 5); cam.position.y = Math.max(cam.position.y, g.heightAt(cam.position.x, cam.position.z) + 2);
        cam.fov = 38; cam.updateProjectionMatrix(); cam.lookAt(P.x, P.y + 4, P.z);
      };
    } else if (view === 'aerial') {
      cameraFn = () => {
        const g = window.__rakis, d = g.worm.director, cam = g.camera;
        if (!d.path) return;
        const p = g.player.position, K = g.worm.K;
        const cx = (K.x ?? K.pos.x) * 0.5 + p.x * 0.5, cz = K.pos.z * 0.5 + p.z * 0.5;
        cam.position.set(cx - d.path.f.x * 60, p.y + 230, cz - d.path.f.z * 60); cam.fov = 62; cam.updateProjectionMatrix(); cam.lookAt(cx, p.y, cz);
      };
    }
    const r = await capture(page, outDir, name, { minLum, cameraFn });
    results.push({ ...r, ...info, view });
    console.log(name.padEnd(34), `phase=${info.phase} t=${info.t} oss=${info.oss} lum=${r.lum} nan=${r.nan}/${r.inf}${r.bad ? '  <-- BAD' : ''}`);
  }
  idx++;
}

// --- запуск сцены: игрок на месте; нажатие W — проверка, что управление не отобрано ---
await page.evaluate(() => { window.__res = null; window.__rakis.worm.playReveal().then((r) => { window.__res = r; }); });
const p0 = await page.evaluate(() => window.__rakis.player.position.toArray());
await page.keyboard.down('KeyW');
await page.evaluate(([s, d]) => window.__step(s, d), [1.0, dt]);
await page.keyboard.up('KeyW');
const p1 = await page.evaluate(() => window.__rakis.player.position.toArray());
const moved = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
console.log(`control check: игрок прошёл ${moved.toFixed(2)} м за 1 с при W во время сцены (cinematic=${await page.evaluate(() => window.__rakis.cinematic.active)})`);
await shot('start');
let guard = 0, lastPhase = '', ossTalkSeen = false;
const maxSim = Number(arg('max', 260));
while (guard++ < 400) {
  const t = await page.evaluate(() => window.__rakis.time - window.__t0);
  if (t > maxSim) break;
  const done = await page.evaluate(() => window.__res !== null);
  if (done && ossTalkSeen) {
    // после конца разговора ещё немного отдыха
    await page.evaluate(([s, d]) => window.__step(s, d), [every * 2, dt]);
    await shot('afterTalk');
    await page.evaluate(([s, d]) => window.__step(s, d), [every * 3, dt]);
    await shot('afterTalk2');
    break;
  }
  await page.evaluate(([s, d]) => window.__step(s, d), [every, dt]);
  const ph = await page.evaluate(() => window.__rakis.worm.encounterPhase());
  if (ph === 'talk') ossTalkSeen = true;
  if (await page.evaluate(() => window.__res !== null)) ossTalkSeen = true;
  await shot(ph);
  lastPhase = ph;
}
const mon = await page.evaluate(() => window.__mon);
const ev = await page.evaluate(() => window.__events);
console.log('events:', ev.join(' | '));
console.log('result:', JSON.stringify(await page.evaluate(() => window.__res)), 'state:', await page.evaluate(() => window.__rakis.worm.state), 'resting:', await page.evaluate(() => window.__rakis.worm.resting), lastPhase);
console.log('monitor:', JSON.stringify(mon), 'worm↔harvester max penetration, m:', mon.maxPen.toFixed(2));
const badN = results.filter((r) => r.bad).length;
writeFileSync(join(outDir, 'report.json'), JSON.stringify({ minLum, moved, mon, frames: results }, null, 1));
console.log(`frames: ${results.length}, min lum: ${Math.min(...results.map((r) => r.lum)).toFixed(1)}, black/NaN frames: ${badN}`);
await browser.close();
const uniq = [...new Set(errors)];
if (uniq.length) console.error(`КОНСОЛЬ (${uniq.length}):\n` + uniq.slice(0, 30).join('\n'));
process.exit(badN || uniq.length || mon.cin || mon.lock || moved < 1 ? 1 : 0);
