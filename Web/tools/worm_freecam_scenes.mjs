// Сцены червя со СВОБОДНОЙ КАМЕРОЙ: пожирание харвестера и приезд укрощённого червя, ракурсы вблизи пасти/наездников и общие планы,
// проверка управления персонажем (клавиши W, F — переключатель камеры), NaN/чёрных кадров, времени кадра CPU.
// node tools/build.mjs --out=worm.html && node tools/worm_freecam_scenes.mjs --scene=devour|arrival [--q=low --w=800 --h=450 --views=wide,maw,top,low --only=ring1,maw_open]
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openGame, capture, arg, root } from './lib/harness.mjs';

const scene = arg('scene', 'devour');
const outDir = join(root, 'dist', 'shots', arg('tag', `fc_${scene}`));
const dt = Number(arg('dt', 1 / 20));
const views = arg('views', 'wide,maw,top,low').split(',');
const only = arg('only', '') ? arg('only', '').split(',') : null;
const { browser, page, errors } = await openGame({ file: arg('file', 'worm.html'), q: arg('q', 'low'), w: Number(arg('w', 800)), h: Number(arg('h', 450)), at: [270, 180], yaw: -1.9, hideSubs: true });

await page.evaluate(() => { const g = window.__rakis, r0 = g.render, info = g.renderer.info; info.autoReset = false; g.render = (dt) => { info.reset(); r0(dt); window.__ri = { calls: info.render.calls, tris: info.render.triangles }; }; });

// ---- проба управления: W двигает персонажа, F отвязывает/привязывает камеру ----
async function key(code, down) {
  await page.evaluate(([code, down]) => {
    const g = window.__rakis; const wasP = g.paused, ts = g.timeScale;
    g.paused = false; g.timeScale = 0;                     // обработчики видят «игру без паузы», а кадры симуляции не идут
    window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true, cancelable: true }));
    g.paused = wasP; g.timeScale = ts;
  }, [code, down]);
}
const probe = () => page.evaluate(() => { const g = window.__rakis, p = g.player.position, c = g.camera.position, f = g.freecam; return { p: [p.x, p.z].map((v) => +v.toFixed(2)), c: c.toArray().map((v) => +v.toFixed(1)), active: f.active, avail: f.available, lock: g.player.inputLocked }; });

const ctl = {};
async function controlTest(label) {
  await key('KeyW', true); await page.evaluate(() => window.__step(1.0, 1 / 20)); await key('KeyW', false);
  const a = await probe();
  await page.evaluate(() => window.__step(0.3, 1 / 20));
  ctl[label] = a;
}

if (scene === 'devour') await page.evaluate(() => { window.__rakis.worm.playDevour({ teleport: false }); });
else await page.evaluate(() => { window.__rakis.worm.playReveal(); });
await page.evaluate(() => window.__step(0.5, 1 / 20));
const info0 = await probe();
console.log('after start:', JSON.stringify(info0));

// 1) камера прикреплена: W двигает персонажа
const p0 = (await probe()).p;
await key('KeyW', true); await page.evaluate(() => window.__step(1.5, 1 / 20)); await key('KeyW', false);
const p1 = await probe();
const movedAttached = Math.hypot(p1.p[0] - p0[0], p1.p[1] - p0[1]);
console.log(`attached: player moved ${movedAttached.toFixed(2)} m with W (expect > 0.5)`);
// 2) F: камера отвязывается, персонаж стоит, W двигает камеру
await key('KeyF', true); await key('KeyF', false);
await page.evaluate(() => window.__step(0.2, 1 / 20));
const d0 = await probe();
await key('KeyW', true); await page.evaluate(() => window.__step(1.5, 1 / 20)); await key('KeyW', false);
const d1 = await probe();
const movedPl = Math.hypot(d1.p[0] - d0.p[0], d1.p[1] - d0.p[1]);
const movedCam = Math.hypot(d1.c[0] - d0.c[0], d1.c[1] - d0.c[1], d1.c[2] - d0.c[2]);
console.log(`detached: active=${d1.active} lock=${d1.lock} | player moved ${movedPl.toFixed(2)} m, camera moved ${movedCam.toFixed(1)} m (expect player ~0, camera > 5)`);
// 3) F ещё раз: возвращаемся, W снова управляет персонажем
await key('KeyF', true); await key('KeyF', false);
await page.evaluate(() => window.__step(1.2, 1 / 20));
const e0 = await probe();
await key('KeyW', true); await page.evaluate(() => window.__step(1.5, 1 / 20)); await key('KeyW', false);
const e1 = await probe();
const movedBack = Math.hypot(e1.p[0] - e0.p[0], e1.p[1] - e0.p[1]);
console.log(`re-attached: active=${e1.active} lock=${e1.lock} | player moved ${movedBack.toFixed(2)} m (expect > 0.5)`);
void controlTest;
const ctlOk = movedAttached > 0.5 && d1.lock && d1.active && movedPl < 0.3 && movedCam > 5 && !e1.active && movedBack > 0.5 && !e1.lock;

// ---- кадры сцены свободной камерой ----
await page.evaluate(() => { window.__rakis.freecam.detach(); });
const results = [];
let idx = 0;
const camSet = (name) => page.evaluate(([name, scene]) => {
  const g = window.__rakis, V = g.THREE.Vector3, fc = g.freecam, w = g.worm;
  let A, f, up = 0, rimY;
  if (scene === 'devour') { const d = w.devourDirector; A = d.A; f = d.f; rimY = Math.max(d.gE + 10, w.headPos.y + 6.2 * w.body.headScale); up = rimY - d.gE; }
  else { A = w.headPos; f = { x: Math.cos(w.K.yaw), z: Math.sin(w.K.yaw) }; rimY = A.y + 6; }
  const side = { x: -f.z, z: f.x };
  const gy = g.heightAt(A.x, A.z);
  const P = (dx, dy, dz) => new V(A.x + f.x * dz + side.x * dx, gy + dy, A.z + f.z * dz + side.z * dx);
  const set = {
    wide: [P(260, 45, -60), new V(A.x, gy + 30, A.z)],
    maw: [P(80, Math.max(rimY - gy, 25) + 60, -40), new V(A.x, Math.max(rimY, gy + 12) - 8, A.z)],
    top: [P(10, Math.max(rimY - gy, 30) + 120, -60), new V(A.x, gy + 6, A.z)],
    low: [P(-150, 6, 40), new V(A.x, Math.max(rimY, gy + 18), A.z)],
    harv: [P(70, 38, -30), new V(g.harvester.position.x, gy + 20, g.harvester.position.z)],
    riders: scene === 'arrival' ? (() => { const e = w.riders.items[2].root.matrix.elements; const o = new V(e[12], e[13], e[14]); return [new V(o.x + 5, o.y + 3, o.z + 6), new V(o.x, o.y + 1.5, o.z)]; })() : null,
  }[name];
  if (!set) return;
  fc.place(set[0], set[1]);
  g.camera.fov = 55; g.camera.updateProjectionMatrix();
}, [name, scene]);

async function shot(label) {
  const t = await page.evaluate((scene) => { const g = window.__rakis, w = g.worm; return { phase: scene === 'devour' ? w.devourPhase() : w.encounterPhase(), t: +(scene === 'devour' ? w.devourDirector.t : w.director.t).toFixed(1), open: +w.body.open.toFixed(2), hv: g.harvester.isDevoured ? 'devoured' : g.harvester.state, hole: scene === 'devour' ? +w.devourDirector.holeR.toFixed(1) : 0 }; }, scene);
  for (const view of views) {
    await camSet(view);
    await page.evaluate(() => window.__step(0.05, 1 / 20));
    const r = await capture(page, outDir, `${String(idx).padStart(2, '0')}_${label}_${view}`, { minLum: 12 });
    const ri = await page.evaluate(() => window.__ri || { calls: 0, tris: 0 });
    results.push({ ...r, ...t, ...ri, view });
    console.log(`${String(idx).padStart(2, '0')}_${label}_${view}`.padEnd(30), `phase=${t.phase} t=${t.t} open=${t.open} hole=${t.hole} hv=${t.hv} calls=${ri.calls} tris=${(ri.tris / 1000).toFixed(0)}k lum=${r.lum} nan=${r.nan}/${r.inf}${r.bad ? '  <-- BAD' : ''}`);
  }
  idx++;
}

let marks;
if (scene === 'devour') {
  const tm = await page.evaluate(() => { const d = window.__rakis.worm.devourDirector; return { hook: d.tHook, rel: d.tRel, tilt1: d.tTilt1, erupt: d.tErupt, rise1: d.tRise1, snap: d.tSnap, close0: d.tClose0, retract0: d.tRetract0, after: d.tAfter, end: d.tEnd }; });
  console.log('timeline:', JSON.stringify(Object.fromEntries(Object.entries(tm).map(([k, v]) => [k, +v.toFixed(1)]))));
  marks = [['wormsign', 7], ['carryall', tm.hook + 3], ['vortex', tm.rel + 3], ['tilt', tm.tilt1 - 2], ['ring1', tm.erupt + 1.0], ['ring2', tm.erupt + 2.4], ['maw_open', tm.snap + 0.8],
    ['swallow1', tm.snap + 3], ['swallow2', tm.snap + 5.5], ['close', tm.close0 + 1.5], ['retreat', tm.retract0 + 3], ['aftermath', tm.after + 6]];
} else marks = [['arrive1', 18], ['arrive2', 30], ['stop', 55], ['dismount', 75], ['talk', 95]];
const cur0 = await page.evaluate((scene) => (scene === 'devour' ? window.__rakis.worm.devourDirector.t : window.__rakis.worm.director.t), scene);
let cur = cur0;
const perf = [];
for (const [name, tm] of marks) {
  if (only && !only.includes(name)) continue;
  const step = tm - cur;
  if (step > 0) {
    const ms = await page.evaluate(([s, d]) => { const t0 = performance.now(); window.__step(s, d); return (performance.now() - t0) / Math.max(1, Math.round(s / d)); }, [step, dt]);
    perf.push([name, +ms.toFixed(1)]);
  }
  cur = Math.max(cur, tm);
  await shot(name);
}
console.log('sim ms/step (CPU, swiftshader-independent):', JSON.stringify(perf));
const mon = await page.evaluate(() => ({ cin: window.__rakis.cinematic.active, lock: window.__rakis.player.inputLocked, fcActive: window.__rakis.freecam.active }));
console.log('end state:', JSON.stringify(mon), '| events:', (await page.evaluate(() => window.__events)).join(' | '));
// возврат камеры к персонажу
await page.evaluate(() => window.__rakis.freecam.attach());
const badN = results.filter((r) => r.bad).length;
console.log(`control test: ${ctlOk ? 'OK' : 'FAIL'} | frames: ${results.length}, bad: ${badN}`);
writeFileSync(join(outDir, 'report.json'), JSON.stringify({ ctl: { movedAttached, movedPl, movedCam, movedBack }, perf, frames: results }, null, 1));
await browser.close();
const uniq = [...new Set(errors)];
if (uniq.length) console.error(`КОНСОЛЬ (${uniq.length}):\n` + uniq.slice(0, 30).join('\n'));
process.exit(badN || uniq.length || !ctlOk ? 1 : 0);
