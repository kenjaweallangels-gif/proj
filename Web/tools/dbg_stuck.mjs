// Отладка: почему бот застревает на тропе (i≈36).
import { chromium } from 'playwright';
import { root, arg, findChromium, GL } from './lib/harness.mjs';
const file = arg('file', 'cur.html');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: GL.swiftshader });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
page.on('pageerror', (e) => console.log('ERR', e));
await page.goto(`file://${root}/dist/${file}?autotest=1&q=low&lang=RU&drs=0&warm=0`);
await page.waitForFunction(() => window.__rakis?.realTime > 1.5, null, { timeout: 900000, polling: 1000 });
const r = await page.evaluate(() => {
  const g = window.__rakis, pl = g.player, V = g.THREE.Vector3;
  g.debug.goto('trail'); g.simulate(1, 1 / 30);
  const tr = g.approach.trail;
  const out = { start: pl.position.toArray(), tr30: tr[30].toArray(), tr36: tr[36].toArray(), tr42: tr[42].toArray() };
  let fwd = 1; g.input.axis = () => ({ x: 0, y: fwd });
  let i = 0; const log = [];
  const target = () => tr[Math.min(tr.length - 1, i)];
  g.simulate(60, 1 / 30, () => {
    const t = target(); const dx = t.x - pl.position.x, dz = t.z - pl.position.z, d = Math.hypot(dx, dz);
    pl.cam.yaw = Math.atan2(dz, dx);
    if (d < 1.2) i += 6;
    if (i >= 36 && log.length < 40) { log.push([+pl.position.x.toFixed(2), +pl.position.y.toFixed(2), +pl.position.z.toFixed(2), +pl.speed.toFixed(2), pl.grounded ? 1 : 0, +(g.heightAt(pl.position.x + dx / d * 0.6, pl.position.z + dz / d * 0.6, pl.position.y)).toFixed(2)]); }
    return i < 60;
  });
  out.log = log;
  const p = pl.position;
  const dx = tr[Math.min(tr.length - 1, i)].x - p.x, dz = tr[Math.min(tr.length - 1, i)].z - p.z, d = Math.hypot(dx, dz);
  out.probe = [];
  for (let s = 0.2; s <= 2; s += 0.2) { const q = new V(p.x + dx / d * s, p.y, p.z + dz / d * s); const c = q.clone(); const OWN = { ignore: new Set(['player', 'companion:Ilva', 'companion:Rayn', 'companion:Ossana']) }; const hit = g.collide(c, 0.35, OWN); const w2 = q.clone(); const wh = g.world.collide(w2, 0.35); const k2 = q.clone(); const ch = g.colliders.push(k2, 0.35, OWN); out.probe2 = (out.probe2 || []); out.probe2.push([+s.toFixed(1), wh, +(w2.x - q.x).toFixed(2), ch, +(k2.x - q.x).toFixed(2)]); out.probe.push([+s.toFixed(1), +g.heightAt(q.x, q.z, p.y).toFixed(2), hit, +(c.x - q.x).toFixed(2), +(c.z - q.z).toFixed(2)]); }
  out.i = i; out.pos = p.toArray();
  out.near = g.colliders.near(p, 4).map((e) => ({ type: e.type, owner: e.owner, c: e.c?.toArray().map((v) => +v.toFixed(2)), r: e.r, tags: [...(e.tags || [])] }));
  const q2 = new V(p.x + 0.5, p.y, p.z); out.worldPush = g.world.collide(q2, 0.35); out.worldPushDx = +(q2.x - p.x - 0.5).toFixed(2);
  const q3 = new V(p.x + 0.5, p.y, p.z); out.colPush = g.colliders.push(q3, 0.35, { height: 1.8 }); out.colPushDx = +(q3.x - p.x - 0.5).toFixed(2);
  return out;
});
console.log(JSON.stringify(r.start), JSON.stringify(r.tr30), JSON.stringify(r.tr36), JSON.stringify(r.tr42));
console.log('i', r.i, 'pos', JSON.stringify(r.pos));
for (const x of r.log) console.log(x.join('\t'));
console.log(JSON.stringify(r.near), r.worldPush, r.worldPushDx, r.colPush, r.colPushDx);
console.log('world/colliders probe [s, worldHit, dx, collHit, dx]'); for (const x of r.probe2) console.log(x.join('\t'));
console.log('probe [s, ground, hit, pushx, pushz]'); for (const x of r.probe) console.log(x.join('\t'));
await browser.close();
