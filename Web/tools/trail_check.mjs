// Проверка тропы к щели: визуальная высота (меши подхода и Когтя) против game.heightAt, дыры, граница сетки, уклон, ширина, глаза в камне.
//   node tools/trail_check.mjs [--file=trail_before.html] [--q=low] [--json=out.json]
// Метрики (по оси тропы и на ±0.7 м от неё, шаг 0.5 м):
//  - mismatch: |видимая поверхность (самая высокая грань ≤ ступни+1.1) − heightAt| > 0.15 м; hole: нет ни одной грани в [H−6, H+1.1] (и не равнина пустыни);
//  - openEdges: рёбра сетки с одним треугольником вне «швов» (земля пустыни, плоскость стены) в 12 м от тропы — щели в меше;
//  - eyeInSolid: глаза (H+1.6) внутри твёрдого по SDF; grade: макс. уклон по heightAt на 1 м; width: ширина проходимой полосы.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { root, arg, findChromium, GL } from './lib/harness.mjs';

const file = arg('file', 'trail_before.html'), q = arg('q', 'low');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: GL.swiftshader });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
page.on('pageerror', (e) => console.log('pageerror', String(e)));
await page.goto(`file://${root}/dist/${file}?autotest=1&q=${q}&lang=RU&drs=0&warm=0`);
await page.waitForFunction(() => window.__rakis?.approach && window.__rakis.realTime > 1.5, null, { timeout: 900000, polling: 1000 });

const res = await page.evaluate(() => {
  const g = window.__rakis, A = g.approach, W = g.world, T = A.trail, Z = A.zone;
  // ---- треугольники в xz-сетке ----
  const CELL = 2, gx = Math.ceil((Z.x1 - Z.x0) / CELL) + 1, gz = Math.ceil((Z.z1 - Z.z0) / CELL) + 1;
  const cells = Array.from({ length: gx * gz }, () => []);
  const tris = [];
  const addMesh = (geo, tag) => {
    const P = geo.attributes.position.array, I = geo.index ? geo.index.array : null;
    const n = I ? I.length / 3 : P.length / 9;
    for (let t = 0; t < n; t++) {
      const a = I ? I[t * 3] : t * 3, b = I ? I[t * 3 + 1] : t * 3 + 1, c = I ? I[t * 3 + 2] : t * 3 + 2;
      const x0 = P[a * 3], y0 = P[a * 3 + 1], z0 = P[a * 3 + 2], x1 = P[b * 3], y1 = P[b * 3 + 1], z1 = P[b * 3 + 2], x2 = P[c * 3], y2 = P[c * 3 + 1], z2 = P[c * 3 + 2];
      const mnx = Math.min(x0, x1, x2), mxx = Math.max(x0, x1, x2), mnz = Math.min(z0, z1, z2), mxz = Math.max(z0, z1, z2);
      if (mxx < Z.x0 || mnx > Z.x1 || mxz < Z.z0 || mnz > Z.z1) continue;
      const id = tris.length; tris.push([x0, y0, z0, x1, y1, z1, x2, y2, z2, tag]);
      for (let k = Math.max(0, Math.floor((mnz - Z.z0) / CELL)); k <= Math.min(gz - 1, Math.floor((mxz - Z.z0) / CELL)); k++)
        for (let i = Math.max(0, Math.floor((mnx - Z.x0) / CELL)); i <= Math.min(gx - 1, Math.floor((mxx - Z.x0) / CELL)); i++) cells[i + gx * k].push(id);
    }
  };
  addMesh(A.rock.geometry, 'a');
  let claw = null;
  g.scene.traverse((o) => { if (!claw && o.isMesh && String(o.material?.customProgramCacheKey?.()).startsWith('rk-rock') && !o.material.userData.levelRock && o.geometry?.boundingSphere?.radius > 150) claw = o; });
  if (claw) addMesh(claw.geometry, 'c');
  const hits = (x, z, out) => {
    out.length = 0;
    const ci = Math.floor((x - Z.x0) / CELL), ck = Math.floor((z - Z.z0) / CELL);
    if (ci < 0 || ck < 0 || ci >= gx || ck >= gz) return out;
    for (const id of cells[ci + gx * ck]) {
      const t = tris[id];
      const ax = t[0], az = t[2], bx = t[3], bz = t[5], cx = t[6], cz = t[8];
      const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(den) < 1e-9) continue;
      const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / den, v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / den, w = 1 - u - v;
      if (u < -1e-6 || v < -1e-6 || w < -1e-6) continue;
      out.push(u * t[1] + v * t[4] + w * t[7]);
    }
    return out;
  };
  const base = A.baseAt;
  const buf = [];
  const R = { samples: 0, mismatch: 0, hole: 0, eye: 0, maxGrade: 0, minWidth: 99, widths: [], bad: [], dMax: 0, dAbs: [] };
  const sampleAt = (x, z, yF, tag, s) => {
    const H = W.heightAt(x, z, yF);
    hits(x, z, buf);
    let vis = -1e9;
    for (const y of buf) if (y <= H + 1.1 && y > vis) vis = y;
    R.samples++;
    if (vis < H - 6) {
      // нет грани: допустимо только если это голая равнина пустыни (террейн рисует он сам)
      if (!(base && Math.abs(H - base(x, z)) < 0.35)) { R.hole++; if (R.bad.length < 40) R.bad.push({ k: 'hole', x: +x.toFixed(1), z: +z.toFixed(1), H: +H.toFixed(2), s: +s.toFixed(0) }); }
      return;
    }
    if (base && Math.abs(H - base(x, z)) < 0.2 && vis < H - 0.15) return; // нижняя кромка: рисует террейн
    const d = H - vis;
    R.dAbs.push(Math.abs(d));
    if (Math.abs(d) > 0.15) { R.mismatch++; if (R.bad.length < 40) R.bad.push({ k: 'mis', x: +x.toFixed(1), z: +z.toFixed(1), H: +H.toFixed(2), vis: +vis.toFixed(2), s: +s.toFixed(0) }); }
  };
  for (let i = 0; i < T.length; i++) {
    const p = T[i], q = T[Math.min(T.length - 1, i + 1)], o = T[Math.max(0, i - 1)];
    let tx = q.x - o.x, tz = q.z - o.z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    const nx = -tz, nz = tx;
    if (i % 1 === 0) for (const lat of [-0.7, 0, 0.7]) sampleAt(p.x + nx * lat, p.z + nz * lat, p.y, 'p', p.s);
    // глаза
    const H0 = W.heightAt(p.x, p.z, p.y);
    if (A.volume.sample(p.x, H0 + 1.6, p.z) < 0) R.eye++;
    // уклон по heightAt на 1 м вдоль оси
    const H1 = W.heightAt(p.x + tx, p.z + tz, H0);
    R.maxGrade = Math.max(R.maxGrade, Math.abs(Math.atan2(H1 - H0, 1)) * 180 / Math.PI);
    // ширина проходимой полосы
    if (i % 2 === 0) {
      const step = 0.2; let wL = 0, wR = 0;
      for (const sg of [-1, 1]) {
        let prev = H0, w = 0;
        for (let k = 1; k <= 20; k++) {
          const h = W.heightAt(p.x + nx * sg * k * step, p.z + nz * sg * k * step, prev);
          if (Math.abs(h - prev) > step * 1.2 || !Number.isFinite(h)) break; // > ~50°: стена или обрыв
          prev = h; w = k * step;
        }
        if (sg < 0) wL = w; else wR = w;
      }
      const wd = wL + wR; R.widths.push(wd); R.minWidth = Math.min(R.minWidth, wd);
    }
  }
  // ---- рёбра с одним треугольником (только сетка подхода) ----
  const P = A.rock.geometry.attributes.position.array, I = A.rock.geometry.index.array;
  const ec = new Map();
  for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = I[t + e], b = I[t + (e + 1) % 3], k = a < b ? a * 4294967 + b : b * 4294967 + a;
    ec.set(k, (ec.get(k) || 0) + 1);
  }
  let open = 0, openNear = 0; const openPts = [];
  for (const [k, c] of ec) {
    if (c !== 1) continue;
    const b = k % 4294967, a = (k - b) / 4294967;
    const mx = (P[a * 3] + P[b * 3]) / 2, my = (P[a * 3 + 1] + P[b * 3 + 1]) / 2, mz = (P[a * 3 + 2] + P[b * 3 + 2]) / 2;
    const onGround = base ? my < base(mx, mz) + 0.25 : false;
    const wallX = A.wallAt ? A.wallAt(mz, my) : null;
    const onWall = wallX != null && Math.abs(mx - (wallX - 0.55)) < 0.6;
    const inside = mx > 652.1; // за входом (сиетч)
    if (onGround || onWall || inside) continue;
    open++;
    let near = false;
    for (let i = 0; i < T.length; i += 4) if (Math.abs(T[i].x - mx) < 12 && Math.abs(T[i].z - mz) < 12 && Math.abs(T[i].y - my) < 12) { near = true; break; }
    if (near) { openNear++; if (openPts.length < 25) openPts.push([+mx.toFixed(1), +my.toFixed(1), +mz.toFixed(1)]); }
  }
  R.open = open; R.openNear = openNear; R.openPts = openPts;
  const dA = R.dAbs.sort((a, b) => a - b);
  R.dMed = dA[dA.length >> 1] || 0; R.dP95 = dA[Math.floor(dA.length * 0.95)] || 0; R.dMax = dA[dA.length - 1] || 0; delete R.dAbs;
  const ws = R.widths.sort((a, b) => a - b); R.wMed = ws[ws.length >> 1]; R.wP10 = ws[Math.floor(ws.length * 0.1)]; delete R.widths;
  R.trailLen = A.trailLength; R.pts = T.length; R.tris = A.stats.tris; R.clawTris = claw ? claw.geometry.index.count / 3 : 0;
  return R;
});
console.log(JSON.stringify(res).replace(/\],\[/g, '] ['));
if (arg('json', '')) writeFileSync(arg('json', ''), JSON.stringify(res, null, 1));
await browser.close();
