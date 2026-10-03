// Снимки сцены «Встреча с укрощённым червём» по всему ходу + автоматическая проверка «чёрного экрана»:
//   * средняя яркость кадра (центральная часть, без леттербокса) не ниже порога — иначе FAIL;
//   * поиск NaN/Inf в HDR-буфере до bloom (readRenderTargetPixels) — иначе FAIL;
//   * ошибки консоли — FAIL.
// Игра ставится на паузу, симуляция шагается вручную фиксированным шагом (по умолчанию 1/30 с), как на реальном GPU.
// node tools/build_data.mjs && node tools/build.mjs --out=worm.html && node tools/worm_encounter_shots.mjs [--gl=swiftshader|egl|default]
//   --q=low|med|high  --w=1280 --h=720  --every=3 (сек. между кадрами)  --dt=0.0333  --minlum=22  --tag=encounter  --stage=all|arrive|dismount|depart
import { chromium } from 'playwright';
import { mkdirSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const outDir = join(root, 'dist', 'shots', arg('tag', 'encounter'));
mkdirSync(outDir, { recursive: true });

function findChromium() {
  const base = '/opt/pw-browsers';
  if (!existsSync(base)) return undefined;
  const d = readdirSync(base).find((n) => /^chromium-\d+$/.test(n));
  return d ? join(base, d, 'chrome-linux', 'chrome') : undefined;
}
const GL = {
  swiftshader: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  egl: ['--use-gl=egl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
  default: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
};

/** Минимальный декодер PNG (8 бит, RGB/RGBA, без интерлейса) → {w,h,ch,data}. */
function decodePng(buf) {
  let p = 8, w = 0, h = 0, ct = 0; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8);
    if (type === 'IHDR') { w = buf.readUInt32BE(p + 8); h = buf.readUInt32BE(p + 12); ct = buf[p + 17]; }
    else if (type === 'IDAT') idat.push(buf.subarray(p + 8, p + 8 + len));
    p += 12 + len;
  }
  const ch = ct === 6 ? 4 : 3, stride = w * ch;
  const raw = inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= ch ? out[y * stride + x - ch] : 0, b = y ? out[(y - 1) * stride + x] : 0, c = x >= ch && y ? out[(y - 1) * stride + x - ch] : 0;
      let r;
      switch (f) {
        case 0: r = v; break; case 1: r = v + a; break; case 2: r = v + b; break; case 3: r = v + ((a + b) >> 1); break;
        default: { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      }
      out[y * stride + x] = r & 255;
    }
  }
  return { w, h, ch, data: out };
}
/** Яркость (0..255) центральной области и доля «чёрных» пикселей. */
function lumStats(png) {
  const { w, h, ch, data } = png;
  const x0 = Math.floor(w * 0.1), x1 = Math.floor(w * 0.9), y0 = Math.floor(h * 0.22), y1 = Math.floor(h * 0.78);
  let sum = 0, n = 0, dark = 0;
  for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
    const o = (y * w + x) * ch;
    const l = 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
    sum += l; n++; if (l < 6) dark++;
  }
  return { mean: sum / n, dark: dark / n };
}

const glMode = arg('gl', 'swiftshader');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: GL[glMode] });
const page = await browser.newPage({ viewport: { width: Number(arg('w', 1280)), height: Number(arg('h', 720)) } });
const errors = [];
page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/AudioContext/.test(m.text())) errors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`file://${join(root, 'dist', arg('file', 'worm.html'))}?autotest=1&q=${arg('q', 'med')}&lang=RU`);
await page.waitForFunction(() => window.__rakis && window.__rakis.realTime > 1.5, null, { timeout: 900000 });
console.log('GL:', glMode, '|', await page.evaluate(() => { const gl = window.__rakis.renderer.getContext(); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'n/a'; }));

await page.evaluate(() => {
  const g = window.__rakis;
  // Тест-стенд: игрок у P4, пауза основного цикла, ручное шагание модулей с фиксированным dt
  g.zone = 'A2_Erg';
  g.player.position.set(279, g.heightAt(279, 95), 95);
  g.paused = true;
  window.__events = []; window.__t0 = g.time;
  g.bus.on('worm:encounter', (e) => window.__events.push(`${(g.time - window.__t0).toFixed(1)} ${e.phase}`));
  g.bus.on('cinematic', (e) => window.__events.push(`${(g.time - window.__t0).toFixed(1)} cinematic ${e.active}`));
  window.__step = (sec, dt) => {
    const n = Math.max(1, Math.round(sec / dt));
    for (let i = 0; i < n; i++) {
      g.dt = dt; g.time += dt; g.realTime += dt;
      for (const { mod } of g.modules) { try { mod.update?.(dt, g.time); } catch (e) { console.error('update', e); } }
      for (const { mod } of g.modules) { try { mod.lateUpdate?.(dt, g.time); } catch (e) { console.error('late', e); } }
      g.input.endFrame?.();
    }
  };
  // NaN-проба HDR-буфера (после RenderPass, до марева и bloom)
  const p0 = g.post.composer.passes[0]; const r0 = p0.render.bind(p0);
  window.__probe = false; window.__nan = null;
  p0.render = (renderer, wb, rb, ...a) => {
    r0(renderer, wb, rb, ...a);
    if (!window.__probe) return;
    const w = rb.width, h = rb.height; const buf = new Uint16Array(w * h * 4); renderer.readRenderTargetPixels(rb, 0, 0, w, h, buf);
    let nan = 0, inf = 0;
    for (let i = 0; i < buf.length; i++) { const e = buf[i] & 0x7c00; if (e === 0x7c00) { if (buf[i] & 0x3ff) nan++; else inf++; } }
    window.__nan = { nan, inf }; window.__probe = false;
  };
});

const spectator = arg('spectator', '1') === '1';
const dt = Number(arg('dt', 1 / 30)), every = Number(arg('every', 3)), minLum = Number(arg('minlum', 22));
const results = [];
let idx = 0;
async function capture(label) {
  await page.evaluate(() => { window.__nan = null; window.__probe = true; });
  await page.waitForFunction(() => window.__nan !== null, null, { timeout: 240000 });
  const nan = await page.evaluate(() => window.__nan);
  await page.waitForTimeout(150);
  const file = `${String(idx++).padStart(2, '0')}_${label}.png`;
  const buf = await page.screenshot({ path: join(outDir, file), timeout: 240000 });
  const st = lumStats(decodePng(buf));
  const info = await page.evaluate(() => { const g = window.__rakis, w = g.worm; return { phase: w.encounterPhase(), t: +(g.time - window.__t0).toFixed(1), head: w.headPos.toArray().map((v) => +v.toFixed(0)), calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles, exp: +g.renderer.toneMappingExposure.toFixed(2), oss: w.director.oss.phase, q: w.body.quality, cin: g.cinematic.active }; });
  // дополнительные «зрительские» ракурсы вне кинокамеры: вблизи на Оссану и с воздуха на всю дугу
  if (spectator && !info.cin) {
    for (const mode of ['close', 'aerial']) {
      await page.evaluate((mode) => {
        const g = window.__rakis, T = g.THREE, w = g.worm, d = w.director, cam = g.camera;
        const e = w.riders.items[1].root.matrix.elements; const o = new T.Vector3(e[12], e[13], e[14]);
        if (mode === 'close') {
          const dir = new T.Vector3(d.G.x - o.x, 0, d.G.z - o.z).normalize();
          cam.position.set(o.x + dir.x * 26 + dir.z * 8, o.y + 3, o.z + dir.z * 26 - dir.x * 8); cam.fov = 40; cam.updateProjectionMatrix(); cam.lookAt(o.x, o.y + 1, o.z);
        } else {
          const P = w.spine.P; const k = 45;
          cam.position.set(d.G.x - d.path.f.x * 40, d.G.y + 150, d.G.z - d.path.f.z * 40); cam.fov = 62; cam.updateProjectionMatrix(); cam.lookAt(d.G.x, d.G.y, d.G.z);
        }
      }, mode);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: join(outDir, `${String(idx - 1).padStart(2, '0')}_${label}_${mode}.png`), timeout: 240000 });
    }
  }
  const bad = st.mean < minLum || st.dark > 0.97 || nan.nan + nan.inf > 0;
  results.push({ file, ...info, lum: +st.mean.toFixed(1), dark: +st.dark.toFixed(2), nan: nan.nan, inf: nan.inf, bad });
  console.log(file.padEnd(28), `phase=${info.phase} t=${info.t} lum=${st.mean.toFixed(1)} dark=${st.dark.toFixed(2)} nan=${nan.nan}/${nan.inf} calls=${info.calls} tris=${info.tris} exp=${info.exp}${bad ? '  <-- BAD' : ''}`);
}

// --- запуск сцены ---
await page.evaluate(() => { window.__res = null; window.__rakis.worm.playReveal().then((r) => { window.__res = r; }); });
await page.evaluate(([s, d]) => window.__step(s, d), [0.2, dt]);
await capture('start');
let guard = 0, lastPhase = '';
while (!(await page.evaluate(() => window.__res !== null)) && guard++ < 400) {
  await page.evaluate(([s, d]) => window.__step(s, d), [every, dt]);
  const ph = await page.evaluate(() => window.__rakis.worm.encounterPhase());
  const o = await page.evaluate(() => window.__rakis.worm.director.oss.phase);
  await capture(`${ph}${o !== 'none' && o !== 'done' ? '_' + o : ''}`);
  // игрок «стоит на месте»; чтобы Оссана дошла, ничего не нужно
  lastPhase = ph;
}
console.log('events:', (await page.evaluate(() => window.__events)).join(' | '));
console.log('result:', JSON.stringify(await page.evaluate(() => window.__res)), 'final state:', await page.evaluate(() => window.__rakis.worm.state), 'guard', guard, lastPhase);
const badN = results.filter((r) => r.bad).length;
writeFileSync(join(outDir, 'report.json'), JSON.stringify({ gl: glMode, minLum, frames: results }, null, 1));
console.log(`frames: ${results.length}, min luminance: ${Math.min(...results.map((r) => r.lum)).toFixed(1)}, black/NaN frames: ${badN}`);
await browser.close();
const uniq = [...new Set(errors)];
if (uniq.length) console.error(`КОНСОЛЬ (${uniq.length}):\n` + uniq.slice(0, 30).join('\n'));
process.exit(badN || uniq.length ? 1 : 0);
