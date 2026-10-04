// Проверка «приседа»: высота таза над землёй (м) у игрока, спутников и NPC сиетча в покое и при ходьбе.
//   node tools/gait_probe.mjs [--file=rakis_demo.html]
import { chromium } from 'playwright';
import { root, arg, findChromium, GL } from './lib/harness.mjs';
const file = arg('file', 'rakis_demo.html');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: GL.swiftshader });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
await page.goto(`file://${root}/dist/${file}?autotest=1&q=low&lang=RU&drs=0&warm=0`, { timeout: 300000 });
await page.waitForFunction(() => window.__rakis?.realTime > 1.5, null, { timeout: 900000, polling: 1000 });
const r = await page.evaluate(() => {
  const g = window.__rakis, st = { fwd: 0, run: 0 };
  g.input.axis = () => ({ x: 0, y: st.fwd });
  const held = g.input.held; g.input.held = (a) => (a === 'Sprint' ? !!st.run : held(a));
  const V = new g.THREE.Vector3();
  const hip = (fig, base) => { fig.parts.pelvis.getWorldPosition(V); const s = fig.root?.scale?.y ?? fig.parts.root.scale.y; return +((V.y - base) / (s || 1)).toFixed(3); };
  const sample = (label) => {
    const pl = g.player, out = { label, player: hip(pl.figure, pl.position.y), playerScale: +(pl.figure.parts.root.getWorldScale(V).y).toFixed(3) };
    out.comp = (g.companions?.list || []).map((c) => hip(c.figure, c.position.y));
    return out;
  };
  const res = [];
  g.debug.goto('erg'); g.simulate(2, 1 / 30); res.push(sample('idle'));
  st.fwd = 1; const acc = []; g.simulate(4, 1 / 30, () => { acc.push(sample('walk').player); }); res.push({ label: 'walk', player: { min: Math.min(...acc), max: Math.max(...acc) }, comp: sample('walk').comp });
  st.run = 1; acc.length = 0; g.simulate(3, 1 / 30, () => { acc.push(sample('run').player); }); res.push({ label: 'run', player: { min: Math.min(...acc), max: Math.max(...acc) } });
  st.fwd = 0; st.run = 0;
  return res;
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
