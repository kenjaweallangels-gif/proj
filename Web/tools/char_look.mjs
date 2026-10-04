// Быстрые кадры персонажей: node tools/char_look.mjs --out=name --jobs="Kair:full,Ilva:head,Kair:walk" [--size=480]
// Виды: full (в рост, 3/4), front/back/side (в рост), head (3/4 портрет), upper, prof, turn (4 ракурса в ряд),
// walk/run/desert (полоса из 6 кадров цикла сбоку). Имя: пресет | Child|Elder|Trader|Weaver|KairBare|IlvaBare.
import { chromium } from 'playwright';
import { mkdirSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d);
const out = join(root, 'dist', 'shots', 'look', arg('out', 'x'));
mkdirSync(out, { recursive: true });
const SZ = Number(arg('size', 480));
function findChromium() { const base = '/opt/pw-browsers'; if (!existsSync(base)) return undefined; const d = readdirSync(base).find((n) => /^chromium-\d+$/.test(n)); return d ? join(base, d, 'chrome-linux', 'chrome') : undefined; }
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: SZ, height: SZ } });
page.on('console', (m) => { if (m.type() === 'error' || m.text().startsWith('[look]')) console.log(m.text()); });
page.on('pageerror', (e) => console.log('pageerror', String(e)));
await page.goto(`file://${join(root, 'dist', 'char_studio.html')}`);
await page.waitForFunction(() => window.__rakis && window.__rakis.realTime > 0.3);
await page.evaluate(() => {
  const g = window.__rakis, F = g.figures, T = F.THREE;
  g.render = () => {}; // рендерим вручную
  g.scene.background = new T.Color(0x9fb4d0);
  const sun = new T.DirectionalLight(0xfff0d8, 3.0); sun.position.set(-4, 6, 5); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
  const c = sun.shadow.camera; c.left = -3; c.right = 3; c.top = 3; c.bottom = -3; c.near = 1; c.far = 20; sun.shadow.bias = -0.0005; g.scene.add(sun); g.scene.add(sun.target);
  const floor = new T.Mesh(new T.CircleGeometry(60, 48), new T.MeshStandardMaterial({ color: 0xb59a74, roughness: 1 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; g.scene.add(floor);
  const pm = new T.PMREMGenerator(g.renderer); const es = new T.Scene();
  es.add(new T.Mesh(new T.SphereGeometry(50, 32, 16), new T.ShaderMaterial({ side: T.BackSide, vertexShader: 'varying vec3 v; void main(){ v = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }', fragmentShader: 'varying vec3 v; void main(){ vec3 up = mix(vec3(0.62,0.74,0.95), vec3(0.3,0.5,0.9), smoothstep(0.0,1.0,v.y)); vec3 dn = vec3(0.62,0.5,0.34); vec3 c = v.y > 0.0 ? up : dn; gl_FragColor = vec4(c, 1.0); }' })));
  g.scene.environment = pm.fromScene(es, 0.02).texture; g.scene.environmentIntensity = 0.8;
  const L = { g, F, T, figs: [], floor, sun };
  window.__L = L;
  L.clear = () => { for (const f of L.figs) g.scene.remove(f.group); L.figs.length = 0; };
  L.mk = (opts, x = 0, z = 0, ry = 0) => { const f = F.makeFigure({ lod: 0, ...opts }); f.group.position.set(x, 0, z); f.group.rotation.y = ry; g.scene.add(f.group); L.figs.push(f); f.animate(0, 0.016, 0); return f; };
  L.cam = (pos, tgt, fov = 30, aspect = 1) => { const cam = g.camera; cam.fov = fov; cam.aspect = aspect; cam.near = 0.05; cam.updateProjectionMatrix(); cam.position.set(...pos); cam.lookAt(...tgt); };
  L.draw = () => { g.renderer.render(g.scene, g.camera); };
});
const CASTS = {
  Child: { name: 'NPC_Child_1', height: 1.2, cloth: '#9a7b55', accent: '#b5462c', suit: '#5a4a3a', mask: false, hood: false, hair: 'short', hairColor: '#2a1c14', seed: 5 },
  Elder: { name: 'NPC_Elder_1', height: 1.66, cloth: '#4e4438', accent: '#2c3e57', suit: '#3b342d', mask: false, hood: true, hair: 'short', beard: true, seed: 8, build: 'm', hairColor: '#b9b5ac', age: 0.9 },
  Trader: { name: 'NPC_Trader_1', cloth: '#7a5a3a', accent: '#a0522d', suit: '#4b4035', height: 1.74 },
  Weaver: { name: 'NPC_Weaver_3', cloth: '#7d4f3a', accent: '#2c3e57', suit: '#4a3d33', height: 1.62 },
  KairBare: { preset: 'Kair', hood: false, mask: false }, IlvaBare: { preset: 'Ilva', hood: false, mask: false },
};
const jobs = arg('jobs', 'Kair:full').split(',');
for (const j of jobs) {
  const [name, view] = j.split(':');
  const t0 = Date.now();
  const gait = view === 'walk' || view === 'run' || view === 'desert';
  await page.evaluate(([opts, view, SZ]) => {
    const L = window.__L, { g } = L; L.clear();
    const f = L.mk(opts, 0, 0, 0.0); const H = f.height;
    g.renderer.setSize(SZ, SZ, false);
    L.sun.position.set(-4, 6, 5); L.sun.target.position.set(0, 0, 0);
    if (view === 'full') { f.group.rotation.y = 0.6; L.cam([0, 0.62 * H, 1.5 * H + 0.9], [0, 0.5 * H, 0], 32); }
    else if (view === 'front') { f.group.rotation.y = 0; L.cam([0, 0.55 * H, 1.5 * H + 0.9], [0, 0.5 * H, 0], 32); }
    else if (view === 'back') { f.group.rotation.y = Math.PI; L.cam([0, 0.55 * H, 1.5 * H + 0.9], [0, 0.5 * H, 0], 32); }
    else if (view === 'side') { f.group.rotation.y = Math.PI / 2; L.cam([0, 0.55 * H, 1.5 * H + 0.9], [0, 0.5 * H, 0], 32); }
    else if (view === 'head') { f.group.rotation.y = 0.5; const hy = 0.935 * H; L.cam([0, hy + 0.01, 0.8], [0, hy - 0.005, 0], 24); }
    else if (view === 'upper') { f.group.rotation.y = 0.5; L.cam([0, 0.8 * H, 1.9], [0, 0.75 * H, 0], 26); }
    else if (view === 'prof') { f.group.rotation.y = 1.45; const hy = 0.935 * H; L.cam([0, hy + 0.01, 0.8], [0, hy - 0.005, 0], 24); }
  }, [CASTS[name] || { preset: name }, view, SZ]);
  if (gait) {
    const data = await page.evaluate(async ([view]) => {
      const L = window.__L, { g } = L, f = L.figs[0], H = f.height, imgs = [];
      const speed = view === 'walk' ? 1.5 : view === 'run' ? 5.5 : 1.9, irr = view === 'desert' ? 1 : 0, ctx = view === 'desert' ? { desert: true, allowPause: true } : {};
      const step = (n) => { for (let i = 0; i < n; i++) { f.group.rotation.y = Math.PI / 2; f.group.position.x += speed / 60; f.animate(speed, 1 / 60, irr, ctx); } };
      step(240);
      const h = g.renderer.domElement.height, w = Math.round(h * 0.62), per = view === 'run' ? 4 : 7;
      for (let k = 0; k < 6; k++) {
        step(per);
        const x = f.group.position.x;
        L.cam([x, 0.5 * H, 2.4 * H + 0.5], [x, 0.5 * H, 0], 30, 0.62);
        L.sun.position.set(x - 4, 6, 5); L.sun.target.position.set(x, 0, 0); L.sun.target.updateMatrixWorld();
        g.renderer.setSize(w, h, false);
        L.draw(); (L.imgs = L.imgs || []).push(g.renderer.domElement.toDataURL('image/png'));
      }
      const r = L.imgs; L.imgs = null; return r;
    }, [view]);
    const { default: sharp } = await import('sharp');
    const bufs = data.map((d) => Buffer.from(d.split(',')[1], 'base64'));
    const meta = await sharp(bufs[0]).metadata();
    await sharp({ create: { width: meta.width * bufs.length, height: meta.height, channels: 3, background: '#000' } }).composite(bufs.map((b, i) => ({ input: b, left: i * meta.width, top: 0 }))).png().toFile(join(out, `${name}_${view}.png`));
  } else {
    await page.evaluate(() => { window.__L.draw(); });
    await page.screenshot({ path: join(out, `${name}_${view}.png`), timeout: 240000 });
  }
  console.log('shot', name, view, ((Date.now() - t0) / 1000).toFixed(1) + 's');
}
await browser.close();
