// Отладка: что видно в сцене в зале сиетча (после debug.goto('hall')): пустыня/подход/сад не должны рисоваться.
import { chromium } from 'playwright';
import { root, arg, findChromium, GL } from './lib/harness.mjs';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: GL.swiftshader });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
await page.goto(`file://${root}/dist/${arg('file', 'cur.html')}?autotest=1&q=low&lang=RU&drs=0&warm=0`);
await page.waitForFunction(() => window.__rakis?.realTime > 1.5, null, { timeout: 900000, polling: 1000 });
for (const name of ['market', 'hall']) {
  const r = await page.evaluate(async (name) => {
    const g = window.__rakis;
    await g.debug.goto(name);
    g.simulate(2, 1 / 30);
    const s = g.perf.countScene();
    const vis = {};
    for (const k of ['world', 'approach', 'garden', 'sietch', 'worm', 'harvester']) { const m = g[k]; vis[k] = m?.root ? m.root.visible : m?.group ? m.group.visible : m?.visible; }
    let terr = 0; g.scene.traverse((o) => { if (o.isMesh && o.frustumCulled === false && o.visible && o.geometry?.index?.count === 160 * 160 * 6) terr++; });
    return { space: g.space, zone: g.zone, vis, terrainMeshesVisible: terr, heavy: s.heavy.slice(0, 5), visibleMeshes: s.visible, desertRootVisible: g.world.visible };
  }, name);
  console.log(name, JSON.stringify(r));
}
await browser.close();
