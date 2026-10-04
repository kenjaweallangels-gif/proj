// Стенд «толпа ~40»: draw calls и треугольники по дистанциям — старая схема (полные фигуры ≤9.5 м, до 5 штук + болванки-импостеры)
// против новой (полные фигуры ≤15 м, до 5 штук со своими LOD0/1 + групповой BatchedMesh LOD1/2 в один вызов). Без теней (как у NPC сиетча).
//   node tools/char_studio_build.mjs && node tools/crowd_lod_bench.mjs [--n=40] [--shots=1]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { root, arg, findChromium, GL } from './lib/harness.mjs';
const outDir = join(root, 'dist', 'shots', 'char_lod'); mkdirSync(outDir, { recursive: true });
const N = Number(arg('n', 40));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: ['--disable-dev-shm-usage', ...GL.swiftshader] });
const page = await browser.newPage({ viewport: { width: 1280, height: 640 } });
page.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('console', m.text().slice(0, 200)); });
await page.goto(`file://${join(root, 'dist', 'char_studio.html')}`);
await page.waitForFunction(() => window.__rakis && window.__rakis.realTime > 0.3);
const res = await page.evaluate(async ([N]) => {
  const g = window.__rakis, F = g.figures, T = F.THREE;
  g.render = () => {};
  const { scene, camera, renderer } = g;
  renderer.shadowMap.enabled = false; renderer.setSize(1280, 640, false);
  scene.background = new T.Color(0xb9a98c);
  { const sun = new T.DirectionalLight(0xfff0dd, 2.2); sun.position.set(-8, 14, 10); scene.add(new T.HemisphereLight(0xcfe0ff, 0x8a6a40, 1.4), sun); }
  const floor = new T.Mesh(new T.PlaneGeometry(400, 400), new T.MeshStandardMaterial({ color: 0xb59a74, roughness: 1 })); floor.rotation.x = -Math.PI / 2; scene.add(floor);
  camera.fov = 70; camera.aspect = 2; camera.near = 0.05; camera.far = 400; camera.updateProjectionMatrix(); camera.position.set(0, 1.7, 0); camera.lookAt(0, 1.5, 40);
  F.setFigureView(camera.position);
  // раскладка: 40 NPC в «галерее» шириной 16 м и глубиной 3..70 м (плотнее вблизи)
  let seed = 12345; const R = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const keys = Object.keys(F.PALETTES), figs = [];
  for (let i = 0; i < N; i++) {
    const arch = keys[i % keys.length], P = F.PALETTES[arch], extra = F.crowdLook(arch, R);
    const f = F.makeFigure({ ...P, ...extra, name: `NPC_${arch}_${i}`, seed: 300 + i, lod: undefined });
    const d = 3 + 67 * Math.pow((i + 0.5) / N, 1.5), x = (R() - 0.5) * Math.min(16, 3 + d * 0.5);
    f.group.position.set(x, 0, d); f.group.rotation.y = R() * 6.28;
    figs.push({ f, d, x, speed: i % 3 === 0 ? 1.2 : 0 });
  }
  const out = {};
  const measure = async (label, frames = 3) => {
    const ri = renderer.info; ri.autoReset = false; ri.reset();
    for (let i = 0; i < frames; i++) renderer.render(scene, camera);
    const r = { calls: ri.render.calls / frames, tris: Math.round(ri.render.triangles / frames) }; ri.autoReset = true; return r;
  };
  const step = (dt, n) => { for (let k = 0; k < n; k++) for (const e of figs) { e.f.animate(e.speed, dt, 0); } };
  // --- старая схема ---
  const oldImp = (() => {
    const body = new T.LatheGeometry([[0, 0], [0.3, 0], [0.33, 0.06], [0.26, 0.7], [0.21, 1.02], [0.2, 1.22], [0.1, 1.32], [0, 1.33]].map((p) => new T.Vector2(p[0], p[1])), 10);
    const head = new T.SphereGeometry(0.125, 8, 6); head.translate(0, 1.43, 0);
    const sash = new T.TorusGeometry(0.2, 0.025, 4, 10); sash.rotateX(Math.PI / 2); sash.translate(0, 0.92, 0);
    const ms = [body, head, sash].map((g) => { const m = new T.InstancedMesh(g, new T.MeshStandardMaterial({ roughness: 0.9 }), N); m.frustumCulled = false; scene.add(m); return m; });
    return ms;
  })();
  const mOld = new T.Matrix4(), one = new T.Vector3(1, 1, 1), q0 = new T.Quaternion();
  const layout = (scheme) => {
    // состав: ближайшие maxFull в радиусе R — полные фигуры; остальные — импостеры (old) / группа (new)
    const R_FULL = scheme === 'old' ? 9.5 : 15, MAXF = 5;
    const order = figs.slice().sort((a, b) => a.d - b.d);
    const full = new Set(order.filter((e) => e.d < R_FULL).slice(0, MAXF));
    return full;
  };
  const stats = (scheme) => {
    const full = layout(scheme);
    const lodC = [0, 0, 0];
    for (const e of figs) { if (full.has(e)) { if (!e.f.group.parent) scene.add(e.f.group); lodC[e.f.lod()]++; } else if (e.f.group.parent) scene.remove(e.f.group); }
    return { full, lodC };
  };
  // старая схема
  let fl = stats('old');
  oldImp.forEach((m, k) => { let i = 0; for (const e of figs) { if (fl.full.has(e) || e.d > 75) mOld.makeScale(0, 0, 0); else mOld.compose(new T.Vector3(e.x, 0, e.d), new T.Quaternion().setFromEuler(new T.Euler(0, 0, 0)), one); m.setMatrixAt(i++, mOld); } m.count = N; m.instanceMatrix.needsUpdate = true; m.visible = true; });
  step(1 / 60, 90); F.pumpFigureBuilds(1e9); step(1 / 60, 30);
  fl = stats('old'); step(1 / 60, 30);
  out.old = { ...(await measure('old')), full: [...fl.full].length, lodFull: fl.lodC };
  oldImp.forEach((m) => { m.visible = false; });
  // новая схема
  const crowd = F.createFigureCrowd({ parent: scene, maxInstances: N + 2 });
  const hs = figs.map((e) => crowd.register(e.f));
  const t0 = performance.now(); crowd.prewarm(); out.prewarmMs = Math.round(performance.now() - t0); out.variants = crowd.variants.size;
  const m4 = new T.Matrix4();
  fl = stats('new');
  figs.forEach((e, i) => { const h = hs[i]; const s = e.f.height / 1.75; m4.compose(new T.Vector3(e.x, 0, e.d), new T.Quaternion().setFromEuler(new T.Euler(0, e.f.group.rotation.y, 0)), new T.Vector3(s * (e.f.options.bulk ?? 1), s, s)); crowd.setMatrix(h, m4); crowd.setLod(h, e.d > 12 ? 2 : 1); crowd.setWalk(h, e.speed ? 1 : 0); crowd.setFade(h, fl.full.has(e) ? 0 : 1); });
  crowd.update(1 / 60, 1); F.pumpFigureBuilds(1e9); crowd.update(1 / 60, 1.1); crowd.update(1 / 60, 1.2); step(1 / 60, 30);
  out.new = { ...(await measure('new')), full: [...fl.full].length, lodFull: fl.lodC, batchInstances: hs.filter((h) => h.vis).length };
  // по дистанциям: треугольники на одного человека
  const per = {};
  for (const d of [2, 8, 25, 60]) {
    const e = figs.slice().sort((a, b) => Math.abs(a.d - d) - Math.abs(b.d - d))[0];
    per[d] = { distUsed: +e.d.toFixed(1) };
  }
  out.perDist = per;
  window.__figs = figs; window.__crowd = crowd; window.__hs = hs; window.__oldImp = oldImp;
  return out;
}, [N]);
console.log(JSON.stringify(res, null, 1));
if (arg('shots', '1') === '1') {
  for (const scheme of ['old', 'new']) {
    await page.evaluate((s) => {
      const g = window.__rakis, F = g.figures; const crowd = window.__crowd, figs = window.__figs, hs = window.__hs;
      window.__oldImp.forEach((m) => { m.visible = s === 'old'; });
      const R_FULL = s === 'old' ? 9.5 : 15, order = figs.slice().sort((a, b) => a.d - b.d), full = new Set(order.filter((e) => e.d < R_FULL).slice(0, 5));
      figs.forEach((e, i) => { const inFull = full.has(e); if (inFull && !e.f.group.parent) g.scene.add(e.f.group); if (!inFull && e.f.group.parent) g.scene.remove(e.f.group); if (s === 'new') crowd.setFade(hs[i], inFull ? 0 : 1); else crowd.setFade(hs[i], 0); });
      for (let k = 0; k < 20; k++) { for (const e of figs) e.f.animate(e.speed, 1 / 60, 0); crowd.update(1 / 60, 2 + k / 60); }
      g.renderer.render(g.scene, g.camera);
    }, scheme);
    await page.screenshot({ path: join(outDir, `crowd40_${scheme}.png`), timeout: 600000 });
  }
}
await browser.close();
