// Сценарий «Червь пожирает харвестер» (реальное время, без кинокамеры): кадры с безопасного расстояния (точка зрения игрока), «сбоку у пасти» и с воздуха;
// проверка NaN/яркости, отсутствия cinematic/блокировки ввода, пересечения червя с харвестером (допустимо только при проглатывании).
// node tools/build.mjs --out=worm.html && node tools/worm_devour_shots.mjs [--file=worm.html --q=low --w=800 --h=450 --views=player,side,aerial --only=erupt,swallow]
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openGame, capture, arg, root } from './lib/harness.mjs';

const tag = arg('tag', 'devour');
const outDir = join(root, 'dist', 'shots', tag);
const dt = Number(arg('dt', 1 / 30)), minLum = Number(arg('minlum', 20));
const views = arg('views', 'player,side,aerial').split(',');
const only = arg('only', '') ? arg('only', '').split(',') : null;
const { browser, page, errors } = await openGame({ file: arg('file', 'worm.html'), q: arg('q', 'med'), w: Number(arg('w', 1280)), h: Number(arg('h', 720)), gl: arg('gl', 'swiftshader'), at: [270, 180], yaw: -1.9, hideSubs: arg('subs', '0') === '0' });

await page.evaluate(() => {
  const g = window.__rakis;
  window.__mon = { maxPen: 0, penT: null, steps: 0, cin: 0, lock: 0, minPlayerDist: 1e9, nanPos: 0 };
  window.__watch = () => {
    const w = g.worm, hv = g.harvester, m = window.__mon, d = w.devourDirector;
    m.steps++;
    if (g.cinematic.active) m.cin++;
    if (g.player.inputLocked) m.lock++;
    const pp = g.player.position;
    if (d.active) m.minPlayerDist = Math.min(m.minPlayerDist, Math.hypot(pp.x - d.A.x, pp.z - d.A.z));
    const hp = hv.position; if (!Number.isFinite(hp.x + hp.y + hp.z + w.headPos.x + w.headPos.y)) m.nanPos++;
    if (!w.exposed || hv.isDevoured) return;
    // допустимо только пока харвестер «твёрдый» (до начала наклона/проглатывания): тогда пересечения быть не должно
    const solid = hv.colliderEntries.some((e) => e.solid);
    if (!solid) return;
    const P = w.spine.P, V = g.THREE.Vector3, v = new V(), q = new V();
    for (const e of hv.colliderEntries) for (let i = 0; i < 91; i++) {
      v.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
      const R = 20 * w.spine.RS[i] * 0.9;
      if (v.y + R < g.heightAt(v.x, v.z)) continue;
      g.colliders.closestPoint(e, v, q);
      const pen = R - v.distanceTo(q);
      if (pen > m.maxPen) { m.maxPen = pen; m.penT = [i, +(g.time - window.__t0).toFixed(1)]; }
    }
  };
});

const results = [];
let idx = 0;
async function shot(label) {
  const info = await page.evaluate(() => {
    const g = window.__rakis, w = g.worm, d = w.devourDirector;
    return { phase: w.devourPhase(), t: +d.t.toFixed(1), head: w.headPos.toArray().map((v) => +v.toFixed(0)), hv: g.harvester.state, hvDev: g.harvester.isDevoured, quality: w.body.quality };
  });
  for (const view of views) {
    const name = `${String(idx).padStart(2, '0')}_${label}_${view}`;
    let cameraFn = null;
    if (view === 'player') {
      cameraFn = () => {
        const g = window.__rakis, p = g.player.position, d = g.worm.devourDirector;
        const yaw = Math.atan2(d.A.z - p.z, d.A.x - p.x);
        g.player.setFirstPerson?.(true);
        g.player.teleport(p.x, p.y, p.z, yaw, false);
        g.camera.fov = 62; g.camera.updateProjectionMatrix();
        window.__step(0.5, 1 / 30);          // камера игрока обновляется модулем игрока (переход к виду от первого лица)
      };
    } else if (view === 'side') {
      cameraFn = () => {
        const g = window.__rakis, d = g.worm.devourDirector, cam = g.camera;
        const side = { x: -d.f.z, z: d.f.x };
        const gx = d.A.x + side.x * 230 - d.f.x * 20, gz = d.A.z + side.z * 230 - d.f.z * 20;
        cam.position.set(gx, g.heightAt(gx, gz) + 6, gz); cam.fov = 48; cam.updateProjectionMatrix();
        cam.lookAt(d.A.x, d.gE + 45, d.A.z);
      };
    } else if (view === 'aerial') {
      cameraFn = () => {
        const g = window.__rakis, d = g.worm.devourDirector, cam = g.camera;
        cam.position.set(d.A.x - d.f.x * 90 + 40, d.gE + 260, d.A.z - d.f.z * 90 + 40); cam.fov = 60; cam.updateProjectionMatrix();
        cam.lookAt(d.A.x, d.gE + 5, d.A.z);
      };
    }
    const r = await capture(page, outDir, name, { minLum, cameraFn });
    results.push({ ...r, ...info, view });
    console.log(name.padEnd(36), `phase=${info.phase} t=${info.t} lum=${r.lum} nan=${r.nan}/${r.inf} hv=${info.hv}${info.hvDev ? '(devoured)' : ''}${r.bad ? '  <-- BAD' : ''}`);
  }
  idx++;
}

await page.evaluate(() => { window.__res = null; window.__rakis.worm.playDevour({ teleport: !!window.__tp }).then((r) => { window.__res = r; }); });
const times = await page.evaluate(() => { const d = window.__rakis.worm.devourDirector; return { hook: d.tHook, lift1: d.tLift1, tilt0: d.tTilt0, tilt1: d.tTilt1, erupt: d.tErupt, rise1: d.tRise1, snap: d.tSnap, close0: d.tClose0, retract0: d.tRetract0, after: d.tAfter, end: d.tEnd }; });
console.log('timeline:', JSON.stringify(Object.fromEntries(Object.entries(times).map(([k, v]) => [k, +v.toFixed(1)]))));
// ключевые кадры (в секундах от начала)
const marks = [
  ['wormsign', 4], ['alarm', 9], ['approach', 14], ['carryall', times.hook - 3], ['hooked', times.hook + 2.5], ['lift', times.lift1], ['tilt', (times.tilt0 + times.tilt1) / 2],
  ['vortex', times.tilt1 - 2], ['erupt1', times.erupt + 0.8], ['erupt2', times.erupt + 2.2], ['maw', times.rise1 + 2], ['snap', times.snap + 0.8],
  ['swallow1', times.snap + 2.8], ['swallow2', times.snap + 5], ['close', times.close0 + 2.5], ['retreat', times.retract0 + 3], ['aftermath', times.after + 5], ['crater', times.end + 1],
].filter(([n]) => !only || only.includes(n));
let cur = 0;
for (const [name, tm] of marks) {
  const step = tm - cur;
  if (step > 0) await page.evaluate(([s, d]) => window.__step(s, d), [step, dt]);
  cur = Math.max(cur, tm);
  await shot(name);
}
// дошагать до конца
const left = Math.max(0, times.end + 3 - cur);
if (left > 0 && !only) await page.evaluate(([s, d]) => window.__step(s, d), [left, dt]);
const mon = await page.evaluate(() => window.__mon);
const ev = await page.evaluate(() => window.__events);
console.log('events:', ev.join(' | '));
console.log('result:', JSON.stringify(await page.evaluate(() => window.__res)), 'harvester devoured:', await page.evaluate(() => window.__rakis.harvester.isDevoured));
console.log('monitor:', JSON.stringify(mon), `| worm↔harvester penetration while solid: ${mon.maxPen.toFixed(2)} m | closest player distance to axis: ${mon.minPlayerDist.toFixed(0)} m`);
const badN = results.filter((r) => r.bad).length;
writeFileSync(join(outDir, 'report.json'), JSON.stringify({ times, mon, frames: results }, null, 1));
console.log(`frames: ${results.length}, min lum: ${results.length ? Math.min(...results.map((r) => r.lum)).toFixed(1) : 'n/a'}, black/NaN frames: ${badN}`);
await browser.close();
const uniq = [...new Set(errors)];
if (uniq.length) console.error(`КОНСОЛЬ (${uniq.length}):\n` + uniq.slice(0, 30).join('\n'));
process.exit(badN || uniq.length || mon.cin || mon.lock || mon.nanPos || mon.maxPen > 1 ? 1 : 0);
