// Проверка перекрёстного растворения LOD в студии: камера подъезжает 40 → 2.5 м; фиксируем каждое переключение LOD, прогресс растворения
// и делаем скриншот в середине растворения (dist/shots/char_lod/fade_mid_*.png).
//   node tools/char_studio_build.mjs && node tools/char_lod_fade_test.mjs
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root, findChromium, GL } from './lib/harness.mjs';
const outDir = join(root, 'dist', 'shots', 'char_lod'); mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: ['--disable-dev-shm-usage', ...GL.swiftshader] });
const page = await browser.newPage({ viewport: { width: 700, height: 700 } });
page.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 300)));
await page.goto(`file://${join(root, 'dist', 'char_studio.html')}`);
await page.waitForFunction(() => window.__rakis && window.__rakis.realTime > 0.3);
await page.evaluate(() => {
  const g = window.__rakis, F = g.figures, T = F.THREE; g.render = () => {};
  g.scene.background = new T.Color(0xb9a98c);
  g.scene.add(new T.HemisphereLight(0xcfe0ff, 0x8a6a40, 1.3)); const sun = new T.DirectionalLight(0xfff0dd, 2.4); sun.position.set(-4, 8, 6); g.scene.add(sun);
  const fl = new T.Mesh(new T.PlaneGeometry(200, 200), new T.MeshStandardMaterial({ color: 0xb59a74 })); fl.rotation.x = -Math.PI / 2; g.scene.add(fl);
  const f = F.makeFigure({ preset: 'Rayn', sash: true, wrap: true, carry: 'jug' }); g.scene.add(f.group); f.group.rotation.y = 0.6;
  const cam = g.camera; cam.fov = 40; cam.aspect = 1; cam.updateProjectionMatrix(); g.renderer.setSize(700, 700, false);
  window.__t = { f, place: (d) => { cam.position.set(0, 1.5, d); cam.lookAt(0, 1.0, 0); cam.updateMatrixWorld(); F.setFigureView(cam.position); }, frame: () => { f.animate(0.5, 1 / 60, 0); g.renderer.render(g.scene, cam); } };
});
const run = await page.evaluate(() => {
  const { f, place, frame } = window.__t, F = window.__rakis.figures;
  const events = [], mids = []; let last = f.lod();
  place(40); for (let i = 0; i < 40; i++) frame(); F.pumpFigureBuilds(1e9);
  events.push({ d: 40, lod: f.lod() });
  for (let d = 40; d > 2.5; d -= 0.25) {
    place(d);
    for (let k = 0; k < 6; k++) {
      frame(); const st = f.fadeState();
      if (st.lod !== last) { events.push({ d, from: last, to: st.lod, t: +st.t.toFixed(2) }); last = st.lod; }
    }
    F.pumpFigureBuilds(1e9);
  }
  return { events, final: f.lod() };
});
console.log(JSON.stringify(run));
// кадры середины: уезжаем и снова приезжаем, ловим ghost
for (const [name, from, to] of [['0to1', 3, 12], ['1to2', 12, 40]]) {
  await page.evaluate(([from]) => { window.__t.place(from); for (let i = 0; i < 90; i++) window.__t.frame(); }, [from]);
  const got = await page.evaluate(([to]) => {
    const { place, frame, f } = window.__t; place(to);
    for (let i = 0; i < 300; i++) { frame(); const st = f.fadeState(); if (st.ghost && st.t > 0.4) return { ...st, png: window.__rakis.renderer.domElement.toDataURL('image/png') }; }
    return null;
  }, [to]);
  console.log(name, JSON.stringify(got && { ...got, png: undefined }));
  if (got) writeFileSync(join(outDir, `fade_mid_${name}.png`), Buffer.from(got.png.split(',')[1], 'base64'));
}
await browser.close();
