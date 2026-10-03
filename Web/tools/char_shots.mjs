// Скриншоты персонажей: node tools/char_shots.mjs [--only=line,close,gait,cloth,crowd] [--file=char.html] [--q=med]
// Студия в стороне от мира: строй пресетов (спереди/сбоку/сзади), крупные планы, последовательности ходьбы/бега/песка, ткань на ветру, толпа.
import { chromium } from 'playwright';
import { mkdirSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const only = arg('only', 'line,close,gait,cloth,crowd').split(',');
const outDir = join(root, 'dist', 'shots', 'char');
mkdirSync(outDir, { recursive: true });
function findChromium() {
  const base = '/opt/pw-browsers';
  if (!existsSync(base)) return undefined;
  const d = readdirSync(base).find((n) => /^chromium-\d+$/.test(n));
  return d ? join(base, d, 'chrome-linux', 'chrome') : undefined;
}
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const W = Number(arg('w', 1600)), Hh = Number(arg('h', 800));
const page = await browser.newPage({ viewport: { width: W, height: Hh } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); if (m.text().startsWith('[char]')) console.log(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`file://${join(root, 'dist', arg('file', 'char.html'))}?autotest=1&q=${arg('q', 'med')}&lang=RU&skip=1`);
await page.waitForFunction(() => window.__rakis && window.__rakis.realTime > 1.0, null, { timeout: 180000 });

await page.evaluate(() => {
  const g = window.__rakis, F = g.figures, T = F.THREE, V3 = T.Vector3;
  g.cinematic = { active: true, owner: 'shots' };
  { const st = document.createElement('style'); st.textContent = '#ui, #loading { display: none !important; }'; document.head.appendChild(st); }
  g.world?.setVisible?.(false);
  const S = { figs: [], at: new V3(0, 400, 0) };
  window.__S = S;
  g.scene.background = new T.Color(0x77818c);
  const floor = new T.Mesh(new T.CircleGeometry(60, 48), new T.MeshStandardMaterial({ color: 0xb59a74, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2; floor.position.copy(S.at); floor.receiveShadow = true; g.scene.add(floor);
  const key = new T.DirectionalLight(0xfff0dd, 2.2); key.position.set(S.at.x - 4, S.at.y + 8, S.at.z + 6); key.target.position.copy(S.at); g.scene.add(key, key.target);
  const fill = new T.DirectionalLight(0x9db4ff, 0.9); fill.position.set(S.at.x + 6, S.at.y + 3, S.at.z + 3); fill.target.position.copy(S.at); g.scene.add(fill, fill.target);
  const back = new T.DirectionalLight(0xffe0b0, 1.4); back.position.set(S.at.x + 2, S.at.y + 4, S.at.z - 7); back.target.position.copy(S.at); g.scene.add(back, back.target);
  g.scene.add(new T.AmbientLight(0xffffff, 0.45));
  S.clear = () => { for (const f of S.figs) g.scene.remove(f.group); S.figs.length = 0; };
  S.add = (opts, x, z, rotY = 0) => { const f = F.makeFigure({ lod: 0, ...opts }); f.group.position.set(S.at.x + x, S.at.y, S.at.z + z); f.group.rotation.y = rotY; g.scene.add(f.group); S.figs.push(f); f.animate(0, 0.016, 0); return f; };
  S.cam = (pos, tgt, fov = 35) => {
    const c = g.camera; c.fov = fov; c.near = 0.05; c.updateProjectionMatrix();
    c.position.set(S.at.x + pos[0], S.at.y + pos[1], S.at.z + pos[2]); c.lookAt(S.at.x + tgt[0], S.at.y + tgt[1], S.at.z + tgt[2]);
    g.__shotCam = { pos: c.position.clone(), quat: c.quaternion.clone() };
    if (!g.__shotHook) { g.__shotHook = true; const r = g.render; g.render = (dt) => { if (g.__shotCam) { g.camera.position.copy(g.__shotCam.pos); g.camera.quaternion.copy(g.__shotCam.quat); } r(dt); }; }
  };
  /** Проиграть фигуру: двигаем группу вперёд по её курсу (+X при rotY=π/2). */
  S.sim = (f, speed, irr, secs, ctx, dirY = Math.PI / 2) => {
    const n = Math.round(secs * 60);
    for (let i = 0; i < n; i++) {
      f.group.rotation.y = dirY;
      f.group.position.x += Math.sin(dirY) * speed / 60; f.group.position.z += Math.cos(dirY) * speed / 60;
      f.animate(speed, 1 / 60, irr, ctx);
    }
  };
});
const shot = async (name, wait = 900) => { await page.waitForTimeout(wait); await page.screenshot({ path: join(outDir, `${name}.png`), timeout: 240000 }); console.log('shot', name); };

const PRESETS = arg('presets', 'Kair,Ilva,Rayn,Ossana,Rider,Rider2,Harmat,Priestess,Guard').split(',');
const has = (k) => only.includes(k);

if (has('line')) {
  for (const [name, rot] of [['front', 0], ['back', Math.PI], ['side', Math.PI / 2]]) {
    await page.evaluate(([PR, rot]) => { const S = window.__S; S.clear(); PR.forEach((p, i) => S.add({ preset: p }, (i - (PR.length - 1) / 2) * 1.05, 0, rot)); S.figs.forEach((f) => f.animate(0, 0.016, 0)); S.cam([0, 1.15, 10.5], [0, 0.95, 0], 22); }, [PRESETS, rot]);
    await shot('line_' + name);
  }
}
if (has('close')) {
  for (const p of PRESETS) {
    await page.evaluate((p) => { const S = window.__S; S.clear(); const f = S.add({ preset: p }, 0, 0, 0.35); const H = f.height; S.cam([0, 0.7 * H, 2.0 * H + 0.6], [0, 0.5 * H, 0], 36); }, p);
    await shot('full_' + p);
    await page.evaluate(() => { const S = window.__S, H = S.figs[0].height; S.cam([0.4, 0.94 * H, 0.95], [0, 0.93 * H, 0], 26); });
    await shot('head_' + p);
  }
}
if (has('gait')) {
  const seqs = [['walk', 3, 0, 8, 0.07], ['run', 6, 0, 8, 0.055], ['desert', 1.8, 1, 8, 0.45], ['idle', 0, 0, 6, 0.9]];
  for (const preset of ['Kair']) for (const [name, sp, irr, n, dtf] of seqs) {
    await page.evaluate(([preset, sp, irr, n, dtf]) => {
      const S = window.__S; S.clear();
      const T0 = 2.0;
      for (let i = 0; i < n; i++) {
        const f = S.add({ preset }, 0, 0, 0);
        f.group.position.x = S.at.x + (i - (n - 1) / 2) * 1.25 - sp * (T0 + i * dtf);
        f.group.position.z = S.at.z;
        S.sim(f, sp, irr, T0 + i * dtf, { allowPause: true, desert: irr > 0 });
      }
      S.cam([0, 1.0, 11], [0, 0.95, 0], 30);
    }, [preset, sp, irr, n, dtf]);
    await shot('gait_' + name + '_' + preset, 1200);
  }
}
if (has('cloth')) {
  // Ткань на ветру: ветер вдоль -Z; бег; остановка.
  for (const [name, wind, sp, extra] of [['calm', 0, 0], ['wind5', 5, 0], ['wind12', 12, 0], ['run', 3, 6], ['stopped', 3, 0, 'stop']]) {
    await page.evaluate(([wind, sp, extra]) => {
      const S = window.__S; S.clear();
      const V3 = window.__rakis.figures.THREE.Vector3;
      window.__rakis.figures.setFigureWind(new V3(0, 0, -1), wind);
      ['Kair', 'Ilva', 'Harmat', 'Rider'].forEach((p, i) => {
        const f = S.add({ preset: p }, (i - 1.5) * 1.3, 0, 0);
        if (sp) { f.group.position.z = S.at.z - sp * 2.0; S.sim(f, sp, 0, 2.0, {}, Math.PI); f.group.position.z = S.at.z; }
        else S.sim(f, 0, 0, 2.5, {}, 0);
        if (extra === 'stop') S.sim(f, 0, 0, 0.12, {}, Math.PI);
      });
      S.cam([6, 1.2, 4], [0, 0.95, 0], 30);
    }, [wind, sp, extra]);
    await shot('cloth_' + name, 1200);
  }
  await page.evaluate(() => window.__rakis.figures.setFigureWind(null, 0));
}
if (has('crowd')) {
  await page.evaluate(() => {
    const S = window.__S; S.clear();
    const PAL = window.__rakis.figures.PALETTES, keys = Object.keys(PAL);
    let n = 0;
    for (let r = 0; r < 6; r++) for (let c = 0; c < 10; c++) {
      const k = keys[(n++) % keys.length], P = PAL[k];
      const f = S.add({ ...P, lod: undefined, name: 'NPC_' + k + '_' + n, hood: Math.random() < 0.7, mask: Math.random() < 0.4 }, (c - 4.5) * 1.5, -r * 2.4 + 3, Math.random() * 6.28);
      f.animate(1.0, 0.016, 0);
    }
    window.__rakis.figures.setFigureView(window.__rakis.camera.position);
    S.cam([0, 2.4, 14], [0, 1.0, -5], 50);
    window.__rakis.figures.setFigureView(window.__rakis.camera.position);
    S.figs.forEach((f) => { f.animate(1.0, 0.5, 0); });
  });
  await shot('crowd_60', 1500);
  const info = await page.evaluate(() => { const g = window.__rakis, ri = g.renderer.info; ri.autoReset = false; ri.reset(); g.render(0.016); const r = ri.render; ri.autoReset = true; return { calls: r.calls, tris: r.triangles, fps: window.__rakis.stats.fps, lod: window.__S.figs.map((f) => f.lod()).reduce((a, l) => { a[l]++; return a; }, [0, 0, 0]) }; });
  console.log('crowd stats', JSON.stringify(info));
}
console.log(errors.length ? 'ERRORS:\n' + errors.slice(0, 20).join('\n') : 'no console errors');
await browser.close();
