// Отладка шва: в точках вокруг (645.1, 30, 252.4) — contains, коллизия сиетча и пустыни, высоты (каждой земли).
import { chromium } from 'playwright';
import { root, arg, findChromium, GL } from './lib/harness.mjs';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: GL.swiftshader });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
await page.goto(`file://${root}/dist/${arg('file', 'cur.html')}?autotest=1&q=low&lang=RU&drs=0&warm=0`);
await page.waitForFunction(() => window.__rakis?.realTime > 1.5, null, { timeout: 900000, polling: 1000 });
const rows = await page.evaluate(() => {
  const g = window.__rakis, V = g.THREE.Vector3, out = [];
  const OWN = { ignore: new Set(['player', 'companion:Ilva', 'companion:Rayn', 'companion:Ossana']) };
  out.push('x      z      y   | contains sietch.collide(dx,dz) world.collide(dx,dz) | hS    hW');
  for (const z of [251.4, 251.9, 252.2, 252.5, 252.8, 253.1, 253.5, 254]) for (const x of [645.0, 645.6, 646.2]) {
    const p = new V(x, 30, z);
    const c = g.sietch.contains(p);
    const a = p.clone(); const ha = g.sietch.collide(a, 0.35);
    const b = p.clone(); const hb = g.world.collide(b, 0.35);
    const hs = g.sietch.heightAt(x, z, 30), hw = g.world.heightAt(x, z, 30);
    out.push(`${x.toFixed(1)} ${z.toFixed(1)} 30 | ${c ? 'IN ' : 'out'} ${ha ? `blk(${(a.x - x).toFixed(2)},${(a.z - z).toFixed(2)})` : 'free'} ${hb ? `blk(${(b.x - x).toFixed(2)},${(b.z - z).toFixed(2)})` : 'free'} | ${hs.toFixed(2)} ${hw.toFixed(2)}`);
  }
  return out;
});
for (const r of rows) console.log(r);
await browser.close();
