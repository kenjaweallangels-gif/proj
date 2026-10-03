// Отладка BFS-достижимости щели: из конца тропы к воздушному шлюзу и обратно; печатает ближайшие достигнутые точки.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { root, arg, findChromium, GL } from './lib/harness.mjs';
const file = arg('file', 'cur.html');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: GL.swiftshader });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
page.on('pageerror', (e) => console.log('ERR', e));
await page.goto(`file://${root}/dist/${file}?autotest=1&q=low&lang=RU&drs=0&warm=0`);
await page.waitForFunction(() => window.__rakis?.realTime > 1.5, null, { timeout: 900000, polling: 1000 });
const r = await page.evaluate(() => {
  const g = window.__rakis, V = g.THREE.Vector3;
  const OWN = { ignore: new Set(['player', 'companion:Ilva', 'companion:Rayn', 'companion:Ossana']) };
  const spaceAt = (p) => { g.space = g.sietch.contains(p) ? 'sietch' : 'desert'; };
  const bfs = (from, target, box, cell = 0.4, rad = 0.35, maxN = 300000) => {
    const tmp = new V();
    const key = (ix, iz, y) => `${ix},${iz},${Math.round(y / 0.6)}`;
    const start = { x: from[0], y: from[1], z: from[2] };
    const seen = new Map([[key(Math.round(from[0] / cell), Math.round(from[2] / cell), from[1]), start]]);
    const q = [start]; let head = 0, best = start, bd = 1e9;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    while (head < q.length && head < maxN) {
      const a = q[head++];
      const d = Math.hypot(a.x - target[0], a.z - target[1]); if (d < bd) { bd = d; best = a; }
      if (d < 1.2) break;
      for (const [dx, dz] of dirs) {
        const bx = a.x + dx * cell, bz = a.z + dz * cell;
        if (bx < box[0] || bx > box[1] || bz < box[2] || bz > box[3]) continue;
        let ok = true, y = a.y;
        for (let s = 1; s <= 2 && ok; s++) {
          tmp.set(a.x + dx * cell * s / 2, y, a.z + dz * cell * s / 2); spaceAt(tmp);
          const x0 = tmp.x, z0 = tmp.z;
          if (g.collide(tmp, rad, OWN) && Math.hypot(tmp.x - x0, tmp.z - z0) > 0.06) { ok = false; break; }
          const gy = g.heightAt(x0, z0, y);
          if (gy - y > 0.5) { ok = false; break; }
          y = gy;
        }
        if (!ok) continue;
        const kk = key(Math.round(bx / cell), Math.round(bz / cell), y);
        if (seen.has(kk)) continue;
        const b = { x: bx, y, z: bz, prev: a }; seen.set(kk, b); q.push(b);
      }
    }
    return { visited: head, bestDist: +bd.toFixed(2), best: [best.x, best.y, best.z].map((v) => +v.toFixed(1)), reached: bd < 1.2 };
  };
  const tr = g.approach.trail, end = tr[tr.length - 1];
  const out = {};
  const spawn = g.sietch.toWorld(2.4, 0, 0, new V());
  const BOX = [638, 664, 240, 262];
  for (const cell of [0.4, 0.25, 0.2]) {
    out['end→spawn c' + cell] = bfs([end.x, end.y, end.z], [spawn.x, spawn.z], BOX, cell, 0.35);
    out['spawn→end c' + cell] = bfs([spawn.x, 30, spawn.z], [end.x, end.z], BOX, cell, 0.35);
  }
  return out;
});
console.log(JSON.stringify(r));
await browser.close();
