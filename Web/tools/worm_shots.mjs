// Скриншоты червя: кат-сцена выхода по времени + отладочные позы (клык-кадр, вид сверху).
// node tools/build.mjs --out=worm.html && node tools/worm_shots.mjs [--q=low|med] [--only=reveal|pose] [--times=3,6,...]
import { chromium } from 'playwright';
import { mkdirSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const q = arg('q', 'med');
const only = arg('only', 'all');
const times = arg('times', '2.5,4.6,6.2,8,10.5,12.5,15,17.5,20,23,26').split(',').map(Number);
const outDir = join(root, 'dist', 'shots', arg('tag', 'worm'));
mkdirSync(outDir, { recursive: true });

function findChromium() {
  const base = '/opt/pw-browsers';
  if (!existsSync(base)) return undefined;
  const d = readdirSync(base).find((n) => /^chromium-\d+$/.test(n));
  return d ? join(base, d, 'chrome-linux', 'chrome') : undefined;
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || findChromium(),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: Number(arg('w', 1280)), height: Number(arg('h', 720)) } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`file://${join(root, 'dist', arg('file', 'worm.html'))}?autotest=1&q=${q}&lang=RU`);
await page.waitForFunction(() => window.__rakis && window.__rakis.realTime > 1.5, null, { timeout: 120000 });

// Тестовый «светлый» фон и игрок у P4
await page.evaluate(() => {
  const g = window.__rakis;
  g.player.position.set(279, 1.7, 95);
  g.scene.background = new g.THREE.Color(arg_bg());
  const T = g.THREE;
  g.scene.traverse((o) => { if (o.isDirectionalLight) { o.position.set(Math.cos(20 * Math.PI / 180) * Math.cos(28 * Math.PI / 180), Math.sin(28 * Math.PI / 180), Math.sin(20 * Math.PI / 180) * Math.cos(28 * Math.PI / 180)).multiplyScalar(200); o.intensity = 3.2; } });
  function arg_bg() { return '#9db8d6'; }
});

// Солнце для оценки затмения (в заглушке пустыни его нет): диск + ореол по SUN_AZIMUTH 20°, возвышение 28°
if (arg('sun', '1') === '1') {
  await page.evaluate(() => {
    const g = window.__rakis, T = g.THREE;
    const d = new T.Vector3(Math.cos(20 * Math.PI / 180) * Math.cos(28 * Math.PI / 180), Math.sin(28 * Math.PI / 180), Math.sin(20 * Math.PI / 180) * Math.cos(28 * Math.PI / 180));
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d'); const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,250,225,1)'); gr.addColorStop(0.12, 'rgba(255,244,210,1)'); gr.addColorStop(0.2, 'rgba(255,236,180,0.5)'); gr.addColorStop(1, 'rgba(255,220,150,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
    const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace;
    const sp = new T.Sprite(new T.SpriteMaterial({ map: tex, depthWrite: false, fog: false, toneMapped: false }));
    sp.scale.setScalar(2600); sp.position.copy(d).multiplyScalar(4500).add(new T.Vector3(279, 0, 95)); sp.renderOrder = -1;
    g.scene.add(sp);
  });
}

if (only === 'behaviour') {
  const log = [];
  await page.evaluate(() => {
    const g = window.__rakis; window.__log = []; window.__fp = [];
    g.bus.on('worm:state', (e) => window.__log.push(`${g.time.toFixed(1)} state ${e.from}->${e.to}`));
    g.bus.on('worm:breach', (e) => window.__log.push(`${g.time.toFixed(1)} breach ${e.x.toFixed(0)},${e.z.toFixed(0)}`));
    const w = g.world; const orig = w.addFootprint; w.addFootprint = (x, z, yaw, o) => { window.__fp.push(o.type); };
    g.zone = 'A2_Erg';
    g.player.position.set(279, 1.7, 95);
  });
  // шумим каждые 0.45 с как бегущий игрок
  const t0 = Date.now();
  let shotSurface = false, shotApproach = false;
  for (let i = 0; i < 400; i++) {
    await page.evaluate(() => { const g = window.__rakis; if (g.worm.state !== 'Pass') g.bus.emit('noise', { x: 279, z: 95, loudness: 0.8, source: 'Player' }); g.camera.position.set(279, 2, 95); g.camera.lookAt(g.worm.headPos.x, Math.max(20, g.worm.headPos.y + 10), g.worm.headPos.z); });
    await page.waitForTimeout(450);
    const st = await page.evaluate(() => { const w = window.__rakis.worm; return { s: w.state, th: +w.threat.toFixed(2), sh: +(window.__rakis.shake || 0).toFixed(2), d: Math.round(w.distanceToPlayer()), P: +w.noise.toFixed(2) }; });
    if (i % 4 === 0) console.log(i, JSON.stringify(st));
    if (st.s === 'Approach' && !shotApproach && st.d < 200) { shotApproach = true; await page.screenshot({ path: join(outDir, 'behaviour_approach.png') }); }
    if (st.s === 'Surface' && !shotSurface) {
      shotSurface = true;
      for (let k = 0; k < 7; k++) {
        await page.evaluate(() => { const g = window.__rakis; g.camera.position.set(279, 2, 95); g.camera.lookAt(g.worm.headPos.x, Math.max(25, g.worm.headPos.y * 0.7), g.worm.headPos.z); });
        await page.waitForTimeout(900);
        await page.screenshot({ path: join(outDir, `behaviour_surface_${k}.png`) });
      }
      break;
    }
    if (st.s === 'Dormant' && shotSurface) break;
    await page.evaluate(() => { window.__rakis.shake = 0; });
  }
  console.log((await page.evaluate(() => window.__log)).join('\n'));
  console.log('footprints', JSON.stringify(await page.evaluate(() => window.__fp.reduce((a, t) => (a[t] = (a[t] || 0) + 1, a), {}))));
}

if (only === 'misc') {
  await page.evaluate(() => {
    const g = window.__rakis; window.__log = [];
    g.bus.on('worm:state', (e) => window.__log.push(`${g.time.toFixed(1)} state ${e.from}->${e.to}`));
    g.bus.on('worm:breach', (e) => window.__log.push(`${g.time.toFixed(1)} breach ${e.x.toFixed(0)},${e.z.toFixed(0)}`));
    g.bus.on('cinematic', (e) => window.__log.push(`${g.time.toFixed(1)} cinematic ${JSON.stringify(e)}`));
    g.bus.on('worm:reveal', (e) => window.__log.push(`${g.time.toFixed(1)} reveal ${e.phase}`));
    g.zone = 'A2_Erg';
  });
  // 1) skip
  const camBefore = await page.evaluate(() => { const c = window.__rakis.camera; return [c.position.x, c.position.y, c.position.z, c.fov]; });
  await page.evaluate(() => { window.__res = null; window.__rakis.worm.playReveal().then((r) => { window.__res = r; }); });
  await page.waitForFunction(() => window.__rakis.worm.director.c > 3, null, { timeout: 120000, polling: 50 });
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => window.__res !== null, null, { timeout: 20000 });
  console.log('skip result', JSON.stringify(await page.evaluate(() => ({ res: window.__res, cin: window.__rakis.cinematic, state: window.__rakis.worm.state, cam: (c => [c.position.x, c.position.y, c.position.z, c.fov])(window.__rakis.camera) }))), 'camBefore', JSON.stringify(camBefore));
  // 2) forceSurface: должен ждать под песком, потом всплыть сам
  await page.evaluate(() => { const g = window.__rakis; g.worm.forceSurface(); });
  await page.waitForFunction(() => window.__rakis.worm.state === 'Surface', null, { timeout: 100000, polling: 100 });
  console.log('forceSurface -> Surface at', await page.evaluate(() => window.__rakis.time.toFixed(1)));
  // 3) foreshadow ripple
  await page.evaluate(() => { const g = window.__rakis; g.worm.debugUnfreeze(); });
  await page.waitForFunction(() => window.__rakis.worm.state === 'Dormant', null, { timeout: 100000, polling: 200 });
  await page.evaluate(() => { const g = window.__rakis; g.camera.position.set(279, 2, 95); g.camera.fov = 62; g.camera.updateProjectionMatrix(); window.__ok = g.worm.foreshadow(); });
  await page.waitForTimeout(5000);
  await page.evaluate(() => { const g = window.__rakis; const r = g.worm.fx.ripple.mesh; const p = r.geometry.attributes.position; const k = (p.count / 2) | 0; g.camera.lookAt(p.getX(k), 3, p.getZ(k)); });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(outDir, 'misc_ripple.png') });
  console.log('ripple visible', await page.evaluate(() => window.__rakis.worm.fx.ripple.mesh.visible));
  console.log((await page.evaluate(() => window.__log)).join('\n'));
}

if (only === 'all' || only === 'reveal') {
  await page.evaluate(() => {
    const w = window.__rakis.worm; const u0 = w.update.bind(w); window.__cpu = { sum: 0, n: 0, max: 0 };
    w.update = (dt, t) => { const a = performance.now(); u0(dt, t); const d = performance.now() - a; window.__cpu.sum += d; window.__cpu.n++; window.__cpu.max = Math.max(window.__cpu.max, d); };
  });
  await page.evaluate(() => { window.__done = false; window.__why = null; const d = window.__rakis.worm.director; const f0 = d.finish.bind(d); d.finish = (...a) => { window.__why = JSON.stringify(a) + ' c=' + d.c.toFixed(2) + ' ' + new Error().stack.split('\\n').slice(2, 4).join('|'); return f0(...a); }; window.__rakis.worm.playReveal().then(() => { window.__done = true; }); });
  for (const t of times) {
    await page.waitForFunction((t) => window.__done || window.__rakis.worm.director.c >= t, t, { timeout: 600000, polling: 50 });
    const info = await page.evaluate(() => { const g = window.__rakis, w = g.worm; const cpu = window.__cpu; const r = g.renderer.info.render; const o = { cpuAvg: +(cpu.sum / Math.max(1, cpu.n)).toFixed(2), cpuMax: +cpu.max.toFixed(2), calls: r.calls, tris: r.triangles }; cpu.sum = 0; cpu.n = 0; cpu.max = 0; return { ...o, c: +w.director.c.toFixed(2), state: w.state, fps: g.stats.fps, head: w.headPos.toArray().map((v) => +v.toFixed(0)), open: +w.body.open.toFixed(2) }; });
    await page.evaluate(() => { window.__rakis.paused = true; });
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(outDir, `reveal_${String(t).replace('.', '_')}.png`) });
    await page.evaluate(() => { window.__rakis.paused = false; });
    console.log('reveal', t, JSON.stringify(info));
    if (await page.evaluate(() => window.__done)) break;
  }
  await page.waitForFunction(() => window.__done, null, { timeout: 600000 });
  console.log('cinematic done; state', await page.evaluate(() => window.__rakis.worm.state), await page.evaluate(() => window.__why));
}

if (only === 'all' || only === 'pose') {
  // клык-кадр: голова стоит с раскрытой пастью, камера напротив
  await page.evaluate(() => {
    const g = window.__rakis, w = g.worm;
    w.debugPose({ x: 330, z: 120, yaw: 2.0, sigma: 175, open: 1 });
  });
  await page.waitForTimeout(800);
  const shots = {
    teeth: `(() => { const T=g.THREE; const p=new T.Vector3(), d=new T.Vector3(); w.body.mouthWorld(p,d); const c=p.clone().addScaledVector(d,70).add(new T.Vector3(0,6,0)); g.camera.position.copy(c); g.camera.fov=38; g.camera.updateProjectionMatrix(); g.camera.lookAt(p.clone().addScaledVector(d,6)); })()`,
    mouth_wide: `(() => { const T=g.THREE; const p=new T.Vector3(), d=new T.Vector3(); w.body.mouthWorld(p,d); const side=new T.Vector3(-d.z,0,d.x); const c=p.clone().addScaledVector(d,120).addScaledVector(side,70); c.y=3; g.camera.position.copy(c); g.camera.fov=45; g.camera.updateProjectionMatrix(); g.camera.lookAt(p); })()`,
    body_close: `(() => { const T=g.THREE; const P=w.spine.P; const t=new T.Vector3(P[45],P[46],P[47]); g.camera.position.set(t.x-60, t.y-5, t.z-35); g.camera.fov=40; g.camera.updateProjectionMatrix(); g.camera.lookAt(t); })()`,
    body_mid: `(() => { const T=g.THREE; const P=w.spine.P; const t=new T.Vector3(P[90],P[91],P[92]); g.camera.position.set(t.x-200, 4, t.z-120); g.camera.fov=45; g.camera.updateProjectionMatrix(); g.camera.lookAt(t); })()`,
    column: `(() => { const T=g.THREE; g.camera.position.set(250, 3, 90); g.camera.fov=62; g.camera.updateProjectionMatrix(); g.camera.lookAt(330, 80, 120); })()`,
  };
  for (const [name, code] of Object.entries(shots)) {
    await page.evaluate(`(() => { const g = window.__rakis, w = g.worm; ${code}; })()`);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(outDir, `pose_${name}.png`) });
    console.log('pose', name);
  }
  // вид сверху на обычную дугу
  await page.evaluate(() => { const g = window.__rakis; g.worm.debugPose({ x: 330, z: 120, yaw: 0.6, sigma: 330, open: 0.3, profile: 'normal', ridden: false }); });
  await page.waitForTimeout(800);
  await page.evaluate(() => { const g = window.__rakis; g.camera.position.set(450, 650, 160); g.camera.fov = 55; g.camera.updateProjectionMatrix(); g.camera.up.set(0, 0, -1); g.camera.lookAt(450, 0, 160); });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(outDir, 'pose_topdown.png') });
  await page.evaluate(() => { const g = window.__rakis; g.camera.up.set(0, 1, 0); g.camera.position.set(200, 25, 40); g.camera.fov = 60; g.camera.updateProjectionMatrix(); g.camera.lookAt(380, 20, 130); });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(outDir, 'pose_arc_side.png') });
  console.log('pose topdown/arc done');
}

const fps = await page.evaluate(() => window.__rakis.stats.fps);
console.log('fps (swiftshader)', fps);
await browser.close();
const uniq = [...new Set(errors)];
if (uniq.length) { console.error(`КОНСОЛЬ (${uniq.length}):\n` + uniq.slice(0, 30).join('\n')); process.exit(1); }
console.log('OK: без ошибок консоли');
