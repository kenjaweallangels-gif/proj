// Тест прохода по харвестеру в студии: виртуальный игрок идёт по маршруту (трап → шлюз → коридор → трап → зал → переход → штурманская → мостик)
// по тем же правилам, что настоящий игрок (шаг до 0.5 м, падение > 1.2 м = телепорт на грунт, game.collide). Печатает проблемы.
// node tools/harvester_walk.mjs [--run=1] [--shots=1]
import { chromium } from 'playwright';
import { mkdirSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const outDir = join(root, 'dist', 'shots', arg('tag', 'walk'));
mkdirSync(outDir, { recursive: true });
const base = '/opt/pw-browsers';
const d = existsSync(base) ? readdirSync(base).find((n) => /^chromium-\d+$/.test(n)) : null;
const browser = await chromium.launch({ executablePath: d ? join(base, d, 'chrome-linux', 'chrome') : undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/AudioContext|GPU stall/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`file://${join(root, 'dist', 'harvester_studio.html')}?q=${arg('q', 'med')}`, { waitUntil: 'commit', timeout: 120000 });
await page.waitForFunction(() => window.__rakis && window.__rakis.harvester && window.__rakis.frames() > 3, null, { timeout: 300000 });
if (arg('run', '0') === '1') await page.evaluate(() => window.__rakis.harvester.debugSet('running'));

const res = await page.evaluate(async (wantShots) => {
  const g = window.__rakis, h = g.harvester, T = g.THREE;
  // сборка интерьера
  const st = { eng: 0, belt: 0, state: 'off' };
  let n = 0; while (!h.interior.ready && n++ < 80) h.interior.update(0.016, 0, st, { build: true, visible: false });
  const L = (x, z) => h.toWorld(x, 0, z);
  const route = [
    ['foot', 40, 25.6], ['ramp-mid', 26, 25.6], ['ramp-top', 15, 25.6], ['landing', 10.5, 24.0], ['door', 11.3, 20.0], ['gallery', 11, 14], ['gallery-mid', 11, 3.0], ['corr-mouth', 6.0, 1.8],
    ['stair-mid', 0, 1.8], ['stair-top', -6.4, 1.8], ['hall', -9, 1.8], ['hall-n', -9, 8], ['hall-e', 8, 12.3], ['hall-door', 13.6, 12.3], ['passage', 18, 12.3], ['chart', 23.5, 12.3],
    ['chart-stair-base', 25.6, 17.2], ['chart-stair-mid', 30, 17.2], ['stair-top-e', 36.2, 16.9], ['bridge', 36, 14.5], ['bridge-front', 34, 11], ['bridge-back', 26.5, 12], ['stair-top-e2', 36.2, 16.9],
    ['back-stair', 33, 17.2], ['chart2', 24, 12.3], ['passage2', 18, 12.3], ['hall2', 8, 12.3], ['hall3', -9, 8], ['hall4', -9, 1.8], ['stair-top2', -6.4, 1.8], ['stair-down', 8.7, 1.8], ['gallery-w', 8.7, -1.5], ['corr-mouth2', 6.5, -1.5], ['corr', 0, -1.5], ['corr-west', -20, -1.0],
    ['dorm-door', -25.0, 3.0], ['dorm-in', -25, 10.5], ['dorm-out', -25, 4.5], ['corr1', -25, 0.5], ['mess-door', -25.0, -3.0], ['mess-in', -22, -10.5], ['mess-out', -25, -4.5], ['corr2', -25, -1.0], ['engine-door', -29.0, 0], ['engine', -36, 0], ['engine-back', -29.0, 0], ['corr-east', -1, -1.0], ['lab-door', -1, -3.0], ['lab', 0, -10.0], ['lab-out', -1, -4.5], ['corr3', -1, -1.0], ['corr-e', 6, -1.0], ['gallery2', 11, 0], ['feed-door', 14.4, 0.0], ['feed', 20, 8.0],
    ['gallery3', 11, 1], ['door2', 11.3, 19.5], ['landing2', 10.5, 24.0], ['ramp-top2', 15, 25.6], ['foot2', 38, 25.6],
  ];
  const p = g.player.position;
  const w0 = L(route[0][1], route[0][2]); p.set(w0.x, g.heightAt(w0.x, w0.z), w0.z);
  const log = [], probs = [];
  let blocked = 0, tele = 0, steps = 0;
  const shots = [];
  for (const [name, lx, lz] of route) {
    const tgt = L(lx, lz); let stuck = 0, last = Infinity;
    for (let i = 0; i < 2500; i++) {
      const dx = tgt.x - p.x, dz = tgt.z - p.z, dist = Math.hypot(dx, dz);
      if (dist < 0.25) break;
      const sp = Math.min(dist, 0.15);
      const ox = p.x, oz = p.z, cur = p.y;
      p.x += dx / dist * sp; p.z += dz / dist * sp;
      g.collide(p, 0.35, {});
      const gy = g.heightAt(p.x, p.z, cur + 0.3);
      const rise = gy - cur;
      if (rise > 0.5) { p.x = ox; p.z = oz; blocked++; stuck++; if (stuck > 6) break; continue; }
      if (Math.abs(gy - cur) > 1.2) { tele++; probs.push(`teleport at ${name}: y ${cur.toFixed(2)} -> ${gy.toFixed(2)}`); }
      p.y = gy; steps++;
      // как у игрока: считаем «застревание» по прогрессу
      if (i % 20 === 0) { if (Math.abs(last - dist) < 0.05) { stuck++; if (stuck > 8) break; } else stuck = 0; last = dist; }
      h.interior.update(0.05, i * 0.05, st, { build: false, visible: true });
    }
    const dd = Math.hypot(tgt.x - p.x, tgt.z - p.z);
    const loc = (() => { const v = new T.Vector3(p.x, p.y, p.z).applyMatrix4(new T.Matrix4().copy(h.root.matrixWorld).invert()); return [v.x.toFixed(1), v.y.toFixed(1), v.z.toFixed(1)]; })();
    log.push(`${name}: ${dd < 0.5 ? 'ok' : 'FAIL dist=' + dd.toFixed(2)} local=${loc.join(',')} contains=${h.contains(p)} room=${h.roomAt(p)?.name || '-'}`);
    if (dd >= 0.5) probs.push(`unreachable ${name} (stuck at ${loc.join(',')})`);
    if (wantShots && ['gallery', 'stair-top', 'hall-e', 'chart', 'bridge'].includes(name)) {
      const eye = new T.Vector3(p.x, p.y + 1.62, p.z); g.camera.position.copy(eye);
      g.camera.fov = 70; g.camera.updateProjectionMatrix();
      const nxt = route[route.findIndex((r) => r[0] === name) + 1]; const look = L(nxt[1], nxt[2]); g.camera.lookAt(look.x, p.y + 1.5, look.z);
      shots.push([name, g.shot()]);
    }
  }
  return { log, probs, blocked, tele, steps, shots };
}, arg('shots', '0') === '1');
console.log(res.log.join('\n'));
console.log('blocked', res.blocked, 'teleports', res.tele, 'steps', res.steps);
if (res.probs.length) console.log('PROBLEMS:\n' + res.probs.join('\n'));
for (const [name, url] of res.shots) writeFileSync(join(outDir, `walk_${name}.png`), Buffer.from(url.split(',')[1], 'base64'));
await browser.close();
if (errors.length) { console.error('КОНСОЛЬ:\n' + [...new Set(errors)].slice(0, 20).join('\n')); process.exit(1); }
console.log(res.probs.length ? 'WALK: ПРОБЛЕМЫ' : 'WALK: OK');
