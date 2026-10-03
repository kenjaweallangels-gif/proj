// Общий стенд для headless-скриншотов (playwright + swiftshader): запуск игры, ручное шагание симуляции, NaN-проба HDR-буфера.
import { chromium } from 'playwright';
import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
export function findChromium() {
  const base = '/opt/pw-browsers';
  if (!existsSync(base)) return undefined;
  const d = readdirSync(base).find((n) => /^chromium-\d+$/.test(n));
  return d ? join(base, d, 'chrome-linux', 'chrome') : undefined;
}
export const GL = {
  swiftshader: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  egl: ['--use-gl=egl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
  default: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
};

/** Минимальный декодер PNG (8 бит, RGB/RGBA, без интерлейса) → {w,h,ch,data}. */
export function decodePng(buf) {
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
export function lumStats(png) {
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


/** Открыть игру (autotest), поставить игрока у P4, пауза основного цикла, ручной __step(sec, dt), NaN-проба HDR. */
export async function openGame({ file = 'worm.html', q = 'med', w = 1280, h = 720, gl = 'swiftshader', at = [279, 95], yaw } = {}) {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: GL[gl] });
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errors = [];
  page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/AudioContext/.test(m.text())) errors.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`file://${join(root, 'dist', file)}?autotest=1&q=${q}&lang=RU`);
  await page.waitForFunction(() => window.__rakis && window.__rakis.realTime > 1.5, null, { timeout: 900000 });
  console.log('GL:', gl, '|', await page.evaluate(() => { const gl = window.__rakis.renderer.getContext(); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'n/a'; }));
  await page.evaluate(([at, yaw]) => {
    const g = window.__rakis;
    g.zone = 'A2_Erg';
    g.player.teleport?.(at[0], g.heightAt(at[0], at[1]), at[1], yaw ?? 0.3);
    g.paused = true;
    window.__events = []; window.__t0 = g.time;
    for (const ev of ['worm:encounter', 'worm:devour', 'harvester', 'cinematic']) g.bus.on(ev, (e) => window.__events.push(`${(g.time - window.__t0).toFixed(1)} ${ev}:${e.phase ?? e.state ?? e.active}`));
    window.__step = (sec, dt) => {
      const n = Math.max(1, Math.round(sec / dt));
      for (let i = 0; i < n; i++) {
        g.dt = dt; g.time += dt; g.realTime += dt;
        for (const { mod } of g.modules) { try { mod.update?.(dt, g.time); } catch (e) { console.error('update', e); } }
        for (const { mod } of g.modules) { try { mod.lateUpdate?.(dt, g.time); } catch (e) { console.error('late', e); } }
        g.input.endFrame?.();
        if (window.__watch) window.__watch(dt);
      }
    };
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
  }, [at, yaw]);
  return { browser, page, errors };
}

/** Снимок с проверкой NaN/яркости. Возвращает {file, lum, dark, nan, inf, bad}. cameraFn (опц.) выполняется в странице до снимка. */
export async function capture(page, outDir, name, { minLum = 22, cameraFn = null, camArg = null, settle = 150 } = {}) {
  mkdirSync(outDir, { recursive: true });
  if (cameraFn) await page.evaluate(cameraFn, camArg);
  await page.evaluate(() => { window.__nan = null; window.__probe = true; });
  await page.waitForFunction(() => window.__nan !== null, null, { timeout: 300000 });
  const nan = await page.evaluate(() => window.__nan);
  await page.waitForTimeout(settle);
  const buf = await page.screenshot({ path: join(outDir, `${name}.png`), timeout: 300000 });
  const st = lumStats(decodePng(buf));
  const bad = st.mean < minLum || st.dark > 0.97 || nan.nan + nan.inf > 0;
  return { file: name, lum: +st.mean.toFixed(1), dark: +st.dark.toFixed(2), nan: nan.nan, inf: nan.inf, bad };
}
