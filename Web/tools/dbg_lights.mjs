// Какие источники света есть в сцене и кому принадлежат (число видимых источников входит в ключ шейдерной программы three.js:
// смена числа ⇒ перекомпиляция всех материалов — это подвисания при повороте камеры/смене зоны).
import { chromium } from 'playwright';
import { root, arg, findChromium, GL } from './lib/harness.mjs';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: GL.swiftshader });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
await page.goto(`file://${root}/dist/${arg('file', 'cur2.html')}?autotest=1&q=${arg('q', 'low')}&lang=RU&drs=0&warm=0`);
await page.waitForFunction(() => window.__rakis?.realTime > 1.5, null, { timeout: 900000, polling: 1000 });
const r = await page.evaluate(() => {
  const g = window.__rakis, out = [];
  g.scene.traverse((o) => {
    if (!o.isLight) return;
    let vis = true, p = o, path = [];
    for (; p && p !== g.scene; p = p.parent) { if (!p.visible) vis = false; path.unshift(p.name || p.type); }
    out.push({ type: o.type, shadow: !!o.castShadow, own: o.visible, chainVisible: vis, int: +o.intensity.toFixed(2), owner: path.slice(0, 3).join('/') });
  });
  const byOwner = {};
  for (const l of out) { const k = l.owner.split('/')[0] || '?'; const b = byOwner[k] || (byOwner[k] = { n: 0, visible: 0, types: {} }); b.n++; if (l.chainVisible) b.visible++; b.types[l.type] = (b.types[l.type] || 0) + 1; }
  return { total: out.length, visibleNow: out.filter((l) => l.chainVisible).length, byOwner, lights: out.slice(0, 40) };
});
console.log('total lights', r.total, 'visible now', r.visibleNow);
console.log(JSON.stringify(r.byOwner, null, 1));
for (const l of r.lights) console.log(JSON.stringify(l));
await browser.close();
