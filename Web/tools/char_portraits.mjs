// Портреты и сцены персонажей: node tools/char_portraits.mjs [--set=portraits,full,wind,light,talk,tris] [--only=Kair,Ilva] [--file=char.html] [--size=720]
// Студия: небо/песок как карта окружения (PMREM), «пустынный» или «тёплый интерьерный» свет. Выводит PNG в dist/shots/char/p_*.png.
import { chromium } from 'playwright';
import { mkdirSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const sets = arg('set', 'portraits,full,wind,light,talk,tris').split(',');
const only = arg('only', '').split(',').filter(Boolean);
const SZ = Number(arg('size', 720));
const outDir = join(root, 'dist', 'shots', 'char');
mkdirSync(outDir, { recursive: true });
function findChromium() {
  const base = '/opt/pw-browsers';
  if (!existsSync(base)) return undefined;
  const d = readdirSync(base).find((n) => /^chromium-\d+$/.test(n));
  return d ? join(base, d, 'chrome-linux', 'chrome') : undefined;
}
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: SZ, height: SZ } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); if (m.text().startsWith('[char]')) console.log(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`file://${join(root, 'dist', arg('file', 'char_studio.html'))}?autotest=1&q=high&lang=RU&skip=1`);
await page.waitForFunction(() => window.__rakis && window.__rakis.realTime > 1.0, null, { timeout: 180000 });

await page.evaluate(() => {
  const g = window.__rakis, F = g.figures, T = F.THREE, V3 = T.Vector3;
  g.cinematic = { active: true, owner: 'shots' };
  { const st = document.createElement('style'); st.textContent = '#ui, #loading { display: none !important; }'; document.head.appendChild(st); }
  g.world?.setVisible?.(false);
  const S = { figs: [], at: new V3(0, 400, 0), lights: [] };
  window.__S = S;
  // карта окружения: градиент неба + песок + пятно солнца
  const envScene = new T.Scene();
  const sky = new T.Mesh(new T.SphereGeometry(50, 32, 16), new T.ShaderMaterial({
    side: T.BackSide, uniforms: {}, vertexShader: 'varying vec3 v; void main(){ v = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'varying vec3 v; void main(){ vec3 up = mix(vec3(0.62,0.74,0.95), vec3(0.3,0.5,0.9), smoothstep(0.0,1.0,v.y)); vec3 dn = vec3(0.62,0.5,0.34); vec3 c = v.y > 0.0 ? up : dn * (0.6+0.4*smoothstep(-1.0,0.0,v.y)); float sun = pow(max(dot(v, normalize(vec3(-0.5,0.6,0.6))),0.0), 90.0)*3.5; gl_FragColor = vec4(c*1.1 + vec3(1.0,0.9,0.7)*sun, 1.0); }',
  }));
  envScene.add(sky);
  const pm = new T.PMREMGenerator(g.renderer); S.envDesert = pm.fromScene(envScene, 0.02).texture;
  const envScene2 = new T.Scene();
  envScene2.add(new T.Mesh(new T.SphereGeometry(50, 32, 16), new T.ShaderMaterial({ side: T.BackSide, vertexShader: 'varying vec3 v; void main(){ v = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'varying vec3 v; void main(){ vec3 c = vec3(0.16,0.1,0.06) * (0.6 + 0.6*v.y); float l = pow(max(dot(v, normalize(vec3(0.6,0.3,0.7))),0.0), 20.0)*4.0; gl_FragColor = vec4(c + vec3(1.0,0.55,0.22)*l, 1.0); }' })));
  S.envWarm = pm.fromScene(envScene2, 0.02).texture;
  const floor = new T.Mesh(new T.CircleGeometry(60, 48), new T.MeshStandardMaterial({ color: 0xb59a74, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2; floor.position.copy(S.at); floor.receiveShadow = true; g.scene.add(floor); S.floor = floor;
  S.light = (mode) => {
    for (const l of S.lights) g.scene.remove(l); S.lights.length = 0;
    const add = (l, p) => { l.position.set(S.at.x + p[0], S.at.y + p[1], S.at.z + p[2]); l.target?.position.copy(S.at); g.scene.add(l); if (l.target) g.scene.add(l.target); S.lights.push(l); if (l.target) S.lights.push(l.target); return l; };
    if (mode === 'warm') {
      g.scene.background = new T.Color(0x1a120c); g.scene.environment = S.envWarm; g.scene.environmentIntensity = 0.9; floor.material.color.set(0x6a5238);
      add(new T.PointLight(0xffa24a, 14, 14, 1.6), [1.6, 2.0, 1.8]);
      add(new T.PointLight(0xff8a30, 5, 10, 1.6), [-2.0, 1.4, 1.2]);
      add(new T.DirectionalLight(0x7a8cff, 0.35), [-3, 3, -4]);
    } else {
      g.scene.background = new T.Color(0x9fb4d0); g.scene.environment = S.envDesert; g.scene.environmentIntensity = 0.85; floor.material.color.set(0xb59a74);
      const sun = add(new T.DirectionalLight(0xfff0d8, 3.0), [-4, 6, 5]); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
      const c = sun.shadow.camera; c.left = -3; c.right = 3; c.top = 3; c.bottom = -3; c.near = 1; c.far = 20; sun.shadow.bias = -0.0005;
    }
  };
  g.renderer.shadowMap.enabled = true;
  S.light('desert');
  S.clear = () => { for (const f of S.figs) g.scene.remove(f.group); S.figs.length = 0; };
  S.add = (opts, x, z, rotY = 0) => { const f = F.makeFigure({ lod: 0, ...opts }); f.group.position.set(S.at.x + x, S.at.y, S.at.z + z); f.group.rotation.y = rotY; g.scene.add(f.group); S.figs.push(f); f.animate(0, 0.016, 0); return f; };
  S.cam = (pos, tgt, fov = 35) => {
    const c = g.camera; c.fov = fov; c.near = 0.03; c.aspect = 1; c.updateProjectionMatrix();
    c.position.set(S.at.x + pos[0], S.at.y + pos[1], S.at.z + pos[2]); c.lookAt(S.at.x + tgt[0], S.at.y + tgt[1], S.at.z + tgt[2]);
    g.__shotCam = { pos: c.position.clone(), quat: c.quaternion.clone() };
    if (!g.__shotHook) { g.__shotHook = true; const r = g.render; g.render = (dt) => { if (g.__shotCam) { g.camera.position.copy(g.__shotCam.pos); g.camera.quaternion.copy(g.__shotCam.quat); g.camera.aspect = 1; g.camera.updateProjectionMatrix(); } r(dt); }; }
  };
  S.sim = (f, speed, irr, secs, ctx, dirY = Math.PI / 2) => {
    const n = Math.round(secs * 60);
    for (let i = 0; i < n; i++) { f.group.rotation.y = dirY; f.group.position.x += Math.sin(dirY) * speed / 60; f.group.position.z += Math.cos(dirY) * speed / 60; f.animate(speed, 1 / 60, irr, ctx); }
  };
});
const shot = async (name, wait = 500) => { await page.waitForTimeout(wait); await page.screenshot({ path: join(outDir, `p_${name}.png`), timeout: 240000 }); console.log('shot', name); };
const CAST = [
  ['Kair', { preset: 'Kair' }], ['Ilva', { preset: 'Ilva' }], ['Rayn', { preset: 'Rayn' }], ['Ossana', { preset: 'Ossana' }], ['Harmat', { preset: 'Harmat' }], ['Priestess', { preset: 'Priestess' }],
  ['Child', { name: 'NPC_Child_1', height: 1.2, cloth: '#9a7b55', accent: '#b5462c', suit: '#5a4a3a', mask: false, hood: false, hair: 'short', seed: 5 }],
  ['Elder', { name: 'NPC_Elder_1', height: 1.66, cloth: '#4e4438', accent: '#2c3e57', suit: '#3b342d', mask: false, hood: true, hair: 'short', beard: true, seed: 8, build: 'm', hairColor: '#b9b5ac', age: 0.9 }],
  ['Rider', { preset: 'Rider' }], ['Stillsuit', { preset: 'Stillsuit' }], ['Guard', { preset: 'Guard' }],
  ['KairBare', { preset: 'Kair', hood: false, mask: false }], ['IlvaBare', { preset: 'Ilva', hood: false, mask: false }], ['RaynBare', { preset: 'Rayn', hood: false, mask: false }], ['OssanaBare', { preset: 'Ossana', hood: false, mask: false }],
];
const list = CAST.filter(([n]) => !only.length || only.includes(n));

if (sets.includes('portraits')) {
  for (const [name, opts] of list) {
    for (const [vname, yaw, off] of [['front', 0.04, 0], ['34', 0.62, 0], ['prof', 1.45, 0]]) {
      await page.evaluate(([opts, yaw]) => {
        const S = window.__S; S.clear(); S.light('desert');
        const f = S.add(opts, 0, 0, yaw); const H = f.height;
        f.animate(0, 0.016, 0);
        const hy = 0.935 * H; S.cam([0.0, hy + 0.01, 0.82], [0, hy - 0.005, 0], 24);
        window.__fig = f;
      }, [opts, yaw]);
      await shot(`${name}_${vname}`);
    }
  }
}
if (sets.includes('full')) {
  for (const [name, opts] of list) {
    await page.evaluate((opts) => {
      const S = window.__S; S.clear(); S.light('desert');
      const f = S.add(opts, 0, 0, 0.5); const H = f.height; S.cam([0, 0.62 * H, 2.1 * H + 0.7], [0, 0.5 * H, 0], 34);
      f.animate(0, 0.016, 0);
    }, opts);
    await shot(`${name}_full`);
  }
}
if (sets.includes('wind')) {
  for (const [name, opts] of list.filter(([n]) => ['Kair', 'Ilva', 'Harmat', 'Priestess'].includes(n))) {
    await page.evaluate((opts) => {
      const S = window.__S; S.clear(); S.light('desert');
      const V3 = window.__rakis.figures.THREE.Vector3;
      window.__rakis.figures.setFigureWind(new V3(0, 0, -1), 9);
      const f = S.add(opts, 0, 0, 0); f.group.position.x = S.at.x - 4.5; S.sim(f, 2.6, 0, 2.5, {}, Math.PI / 2);
      const H = f.height; S.cam([-0.6, 0.55 * H, 4.2], [f.group.position.x - S.at.x, 0.5 * H, 0], 34);
      window.__follow = f;
    }, opts);
    await shot(`${name}_walkwind`, 300);
  }
  await page.evaluate(() => window.__rakis.figures.setFigureWind(null, 0));
}
if (sets.includes('light')) {
  for (const mode of ['desert', 'warm']) for (const [name, opts] of list.filter(([n]) => ['Kair', 'Ilva', 'Priestess'].includes(n))) {
    await page.evaluate(([opts, mode]) => {
      const S = window.__S; S.clear(); S.light(mode);
      const f = S.add(opts, 0, 0, 0.5); const H = f.height; S.cam([0.5, 0.88 * H, 2.4], [0, 0.78 * H, 0], 28);
    }, [opts, mode]);
    await shot(`${name}_${mode}`);
  }
}
if (sets.includes('talk')) {
  await page.evaluate(() => { const S = window.__S; S.clear(); S.light('desert'); const f = S.add({ preset: 'Kair' }, 0, 0, 0.45); const hy = 0.935 * f.height; S.cam([0, hy + 0.01, 0.75], [0, hy - 0.005, 0], 22); f.setMouth(0.9); for (let i = 0; i < 20; i++) f.animate(0, 0.016, 0); });
  await shot('Kair_mouth_open');
  await page.evaluate(() => { const f = window.__S.figs[0]; f.setMouth(0); f.blink(1); for (let i = 0; i < 30; i++) f.animate(0, 0.016, 0); });
  await shot('Kair_blink');
}
if (sets.includes('tris')) {
  const r = await page.evaluate(() => {
    const F = window.__rakis.figures, out = {};
    for (const p of ['Kair', 'Ilva', 'Rayn', 'Ossana', 'Rider', 'Rider2', 'Harmat', 'Priestess', 'Stillsuit', 'Guard']) {
      const f = F.makeFigure({ preset: p, lod: 0 }); out[p] = f.stats.tris; f.dispose();
    }
    for (const k of Object.keys(F.PALETTES)) { const f = F.makeFigure({ ...F.PALETTES[k], name: 'NPC_' + k + '_1', lod: 0 }); out['crowd_' + k] = f.stats.tris; f.dispose(); }
    return out;
  });
  console.log('tris[lod0,lod1,lod2]', JSON.stringify(r));
}
console.log(errors.length ? 'ERRORS:\n' + errors.slice(0, 20).join('\n') : 'no console errors');
await browser.close();
