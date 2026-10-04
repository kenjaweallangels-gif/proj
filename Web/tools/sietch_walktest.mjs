// Сценарный проход игрока по всем зонам сиетча в РЕАЛЬНОЙ игре (headless): проверяет, что heightAt/collide
// (из SDF-сеток + реквизит + game.colliders) не застревают и не проваливают игрока, а contains() даёт true внутри и false снаружи.
// node tools/sietch_walktest.mjs [--file=sietch.html] [--q=low]
import { chromium } from 'playwright';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
function findChromium() {
  const base = '/opt/pw-browsers';
  if (!existsSync(base)) return undefined;
  const d = readdirSync(base).find((n) => /^chromium-\d+$/.test(n));
  return d ? join(base, d, 'chrome-linux', 'chrome') : undefined;
}
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: ['--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/AudioContext/.test(m.text())) errors.push(m.text()); });
await page.goto(`file://${join(root, 'dist', arg('file', 'sietch.html'))}?autotest=1&q=${arg('q', 'low')}&lang=RU`);
await page.waitForFunction(() => window.__rakis && window.__rakis.realTime > 1.0, null, { timeout: 480000 });

const res = await page.evaluate(() => {
  const g = window.__rakis, S = g.sietch;
  const out = { legs: [], outside: null };
  S.doors.doors.forEach((d) => { d.open = 1; d.target = 1; });
  // маршрут в проектных координатах [x, z] (локальные), с этапами
  const ROUTE = [
    ['B1 вход', [[-0.9, 2.6], [0.5, 1.2], [2.4, 0], [12, 0], [24, 0], [36, -0.3], [41.5, 0]]],
    ['B2 низ', [[46, 0], [60, 0], [75.5, 0], [92, 0], [96, 0]]],
    ['B2 лестница N → карниз → мост', [[44, -3], [43.5, -6], [49, -6.1], [53, -6], [58, -6.2], [74, -6.1], [75.5, -3], [75.5, 3], [75.5, 6], [56, 6.3], [50, 6.1], [46, 6.1], [41.5, 5.5], [41.5, 2]]],
    ['B3 центр', [[96, 0], [104, 0.4], [112, -0.6], [120, 0.7], [136, 0.6], [150, 0]]],
    ['B3 комнаты (север, открытая Nn1)', [[126, 0.2], [126, -1.4], [126, -3.2], [127.8, -4.2], [128.0, -7.5], [127.8, -4.2], [126, -3.2], [126, 0.2]]],
    ['B3 комната Nn0 (занавесь)', [[111, 0.2], [111, -1.6], [112.6, -2.6], [112.6, -4.3], [109.6, -4.6], [109.6, -2.6], [111, -1.6], [111, 0.2]]],
    ['B3 комната Ns2 (юг, занавесь)', [[142, 0.2], [142, 1.6], [143.3, 4.0], [143.6, 8.2], [140.4, 8.6], [140.6, 3.8], [142, 1.6], [142, 0.2]]],
    ['B3 юг → решётка', [[92, 0], [96, 2.5], [97, 3.4], [99, 4.4], [100.5, 5.4], [102, 7], [107, 7.9], [116, 7.8], [121, 7.8]]],
    ['B5 зал', [[153, 0], [160, 0], [167, 0], [175, 0], [182, 6], [188, 9.4], [193.8, 9.4], [193.8, 5.6], [193.5, 2.5], [192, 0]]],
    ['погреб: вниз', [[102, 7.2], [101.4, 10], [101.3, 18], [101.3, 27], [101.6, 29.8], [103, 31.4], [112, 31.4], [117, 31.6], [122, 32.2], [138, 32.2], [140.3, 35.8], [142.4, 37], [144.4, 37.1]]],
    ['погреб: неф и бассейн (обход)', [[144.4, 37.1], [142.4, 37], [140.3, 35.8], [138, 32.2], [116, 32.2], [112.8, 36], [115.2, 38.4], [117.6, 41.4], [136, 41.85], [117.6, 41.4], [115.2, 38.4], [112.8, 36], [114, 32.2]]],
    ['погреб: вверх', [[114, 32.2], [112, 31.4], [103, 31.4], [101.6, 29.8], [101.3, 27], [101.3, 18], [101.4, 10], [102, 7.2], [96, 2.5]]],
    ['выход: зал → устье (мир)', 'EXIT'],
    ['выход: устье → зал (мир)', 'EXIT_BACK'],
  ];
  const V3 = g.camera.position.constructor;
  const pos = new V3();
  const place = (lx, lz) => { const w = S.toWorld(lx, 0, lz); const y = S.heightAt(w.x, w.z, 0); pos.set(w.x, y, w.z); };
  let first = true;
  const exitW = S.exitPath.map((p) => [p.x, p.z]);
  for (const [name, pts0] of ROUTE) {
    const world = typeof pts0 === 'string';
    const pts = pts0 === 'EXIT' ? exitW : pts0 === 'EXIT_BACK' ? exitW.slice().reverse() : pts0;
    const leg = { name, stuck: null, maxStepUp: 0, minY: 1e9, maxY: -1e9, inside: 0, total: 0, maxGapDown: 0 };
    if (world) { const y = S.heightAt(pts[0][0], pts[0][1], pos.y || 0); pos.set(pts[0][0], y, pts[0][1]); } else place(pts[0][0], pts[0][1]);
    if (first) { first = false; }
    for (let i = 1; i < pts.length; i++) {
      const tw = world ? { x: pts[i][0], z: pts[i][1] } : S.toWorld(pts[i][0], 0, pts[i][1]);
      let guard = 0;
      while (guard++ < 4000) {
        const dx = tw.x - pos.x, dz = tw.z - pos.z, d = Math.hypot(dx, dz);
        if (d < 0.5) break;
        const step = Math.min(d, 3 * 0.05);
        // как игрок у стены: если прямой шаг упирается, пробуем скользить под углами ±45°/±90°
        let best = null, bd = 1e9; const px = pos.x, pz = pos.z;
        for (const a of [0, 0.7, -0.7, 1.4, -1.4]) {
          const ca = Math.cos(a), sa = Math.sin(a), ux = dx / d, uz = dz / d;
          pos.x = px + (ux * ca - uz * sa) * step; pos.z = pz + (ux * sa + uz * ca) * step;
          S.collide(pos, 0.35); g.colliders?.push(pos, 0.35);
          const rem = Math.hypot(tw.x - pos.x, tw.z - pos.z);
          if (rem < bd - 1e-4) { bd = rem; best = [pos.x, pos.z]; }
          if (a === 0 && rem < d - step * 0.6) break;
        }
        pos.x = best[0]; pos.z = best[1];
        const y = S.heightAt(pos.x, pos.z, pos.y);
        const du = y - pos.y; if (du > leg.maxStepUp) leg.maxStepUp = du; if (-du > leg.maxGapDown) leg.maxGapDown = -du;
        pos.y = y;
        leg.minY = Math.min(leg.minY, y); leg.maxY = Math.max(leg.maxY, y);
        leg.total++; if (S.contains(pos)) leg.inside++;
      }
      if (guard >= 4000) { leg.stuck = { at: i, pos: [pos.x, pos.y, pos.z].map((v) => +v.toFixed(1)), target: pts[i] }; break; }
    }
    out.legs.push(leg);
  }
  // снаружи: точка в пустыне перед расщелиной
  const o = new V3(640, 30, 262);
  out.outside = { contains: S.contains(o) };
  return out;
});
let bad = 0;
for (const l of res.legs) {
  const ok = !l.stuck && l.inside / Math.max(1, l.total) > 0.9 && l.maxStepUp < 0.7 && l.maxGapDown < 0.7;
  if (!ok) bad++;
  console.log(`${ok ? 'OK ' : 'XX '} ${l.name.padEnd(34)} шагов ${l.total}, внутри ${(100 * l.inside / Math.max(1, l.total)).toFixed(0)}%, y ${l.minY.toFixed(1)}..${l.maxY.toFixed(1)}, макс. подъём за шаг ${l.maxStepUp.toFixed(2)}, спуск ${l.maxGapDown.toFixed(2)}${l.stuck ? ' ЗАСТРЯЛ ' + JSON.stringify(l.stuck) : ''}`);
}
console.log('снаружи contains =', res.outside.contains, res.outside.contains ? '(ОШИБКА)' : '(ok)');
await browser.close();
if (errors.length) console.error(`Ошибки страницы (${errors.length}):\n` + [...new Set(errors)].slice(0, 10).join('\n'));
process.exit(bad || res.outside.contains ? 1 : 0);
