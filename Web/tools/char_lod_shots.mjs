// Сравнение LOD фигур в студии: ряд пресетов с принудительным LOD 0/1/2 на дистанциях 8/25/60 м → dist/shots/char_lod/*.png
// node tools/char_lod_shots.mjs [--file=char_studio.html] [--tag=before]
import { chromium } from 'playwright';
import { mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const tag = arg('tag', 'x');
const outDir = join(root, 'dist', 'shots', 'char_lod'); mkdirSync(outDir, { recursive: true });
const base = '/opt/pw-browsers';
const exe = process.env.CHROMIUM || join(base, readdirSync(base).find((n) => /^chromium-\d+$/.test(n)), 'chrome-linux', 'chrome');
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 700 } });
page.on('pageerror', (e) => console.log('ERR', e)); page.on('console', (m) => { if (m.type() === 'error') console.log('ERR', m.text()); });
await page.goto(`file://${join(root, 'dist', arg('file', 'char_studio.html'))}`);
await page.waitForFunction(() => window.__rakis && window.__rakis.realTime > 0.5);
await page.evaluate(() => {
  const g = window.__rakis, F = g.figures, T = F.THREE;
  g.render = () => {}; window.__draw = () => g.renderer.render(g.scene, g.camera);
  g.scene.background = new T.Color(0xb9a98c);
  const floor = new T.Mesh(new T.PlaneGeometry(400, 400), new T.MeshStandardMaterial({ color: 0xb59a74, roughness: 1 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; g.scene.add(floor);
  const sun = new T.DirectionalLight(0xfff0dd, 2.6); sun.position.set(-8, 14, 10); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 60 }); g.scene.add(sun, sun.target);
  g.scene.add(new T.HemisphereLight(0xcfe0ff, 0x8a6a40, 0.8));
  window.__setup = (names, lod, dist, fov = 30) => {
    for (const f of window.__figs || []) g.scene.remove(f.group); window.__figs = [];
    if (window.__batch) { window.__batch.dispose(); window.__batch = null; }
    if (lod === 'batch1' || lod === 'batch2') {
      const crowd = F.createFigureCrowd({ parent: g.scene, maxInstances: 16 }); window.__batch = crowd;
      const sp0 = Math.max(0.9, dist * 0.09), m4 = new T.Matrix4();
      names.forEach((n, i) => {
        const f = F.makeFigure({ preset: n, lod: 1, ...(window.__opts || {}) }); const h = crowd.register(f); window.__figs.push(f);
        const x = (i - (names.length - 1) / 2) * sp0, s = f.height / 1.75;
        m4.compose(new T.Vector3(x, 0, 0), new T.Quaternion().setFromEuler(new T.Euler(0, window.__rot ?? 0.5, 0)), new T.Vector3(s * (f.options.bulk ?? 1), s, s)); crowd.setMatrix(h, m4);
        crowd.setLod(h, lod === 'batch1' ? 1 : 2); crowd.setGlow(h, 0, 0, 0);
      });
      crowd.prewarm(); crowd.items.forEach((h) => crowd.setFade(h, 1)); crowd.update(0.016, 0);
      const c0 = g.camera; c0.fov = fov; c0.aspect = 2; c0.near = 0.05; c0.far = 400; c0.updateProjectionMatrix(); c0.position.set(0, 1.5, dist); c0.lookAt(0, 1.1, 0);
      g.renderer.setSize(1400, 700, false);
      return;
    }
    const sp = Math.max(0.9, dist * 0.09);
    names.forEach((n, i) => { const f = F.makeFigure({ preset: n, lod, ...(window.__opts || {}) }); const x = (i - (names.length - 1) / 2) * sp; f.group.position.set(x, 0, 0); f.group.rotation.y = window.__rot ?? 0.5; g.scene.add(f.group); f.animate(0, 0.016, 0); window.__figs.push(f); });
    const c = g.camera; c.fov = fov; c.aspect = 2; c.near = 0.05; c.far = 400; c.updateProjectionMatrix(); c.position.set(0, dist < 4 ? 1.55 : 1.5, dist); c.lookAt(0, dist < 4 ? 1.45 : 1.1, 0);
    g.renderer.setSize(1400, 700, false);
  };
});
await page.evaluate(([o, r]) => { window.__opts = o; window.__rot = r; }, [JSON.parse(arg('opts', '{}')), Number(arg('rot', 0.5))]);
const names = arg('names', 'Ilva,Rayn,Ossana,Rider,Harmat,Priestess').split(',');
const dists = arg('d', '8,25,60').split(',').map(Number);
for (const lod of (arg('lods', '0,1,2').split(',').map((v) => (/^\d$/.test(v) ? Number(v) : v)))) for (const d of dists) {
  await page.evaluate(([n, l, dd]) => window.__setup(n, l, dd, dd > 40 ? 8 : dd > 15 ? 14 : dd < 4 ? 16 : 28), [names, lod, d]);
  await page.evaluate(() => window.__draw()); await page.waitForTimeout(300);
  await page.screenshot({ path: join(outDir, `${tag}_lod${lod}_d${d}.png`), timeout: 300000 });
}
await browser.close();
