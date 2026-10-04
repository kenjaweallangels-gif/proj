// Тест «игрока не выкидывает с борта»: виртуальный игрок (та же физика, что player/index.js: радиус 0.35, шаг ≤0.5, прыжок 5.6/19 м/с, g=19)
// стартует в каждой комнате и ходит по периметру, давит в стены/окна/проёмы (с прыжками и без), при стоящем и работающем харвестере.
// Ошибки: EJECT (contains()==false, т.е. вышвырнуло наружу), FALL (упал ниже своей палубы), HEAD (макушка выше потолка/плиты — только если есть interior.ceilingAt).
// Запуск: node tools/harvester_studio_build.mjs && node tools/harvester_eject_test.mjs [--run=1] [--file=harvester_studio.html] [--rooms=bridge,chart]
import { chromium } from 'playwright';
import { join } from 'node:path';
import { root, arg, findChromium, GL } from './lib/harness.mjs';

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: GL.swiftshader });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
page.setDefaultTimeout(900000);
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/AudioContext|GPU stall/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`file://${join(root, 'dist', arg('file', 'harvester_studio.html'))}?q=low`, { waitUntil: 'commit', timeout: 120000 });
await page.waitForFunction(() => window.__rakis && window.__rakis.harvester && window.__rakis.frames?.() >= 0, null, { timeout: 300000 });

const res = await page.evaluate(({ run, only }) => {
  const g = window.__rakis, h = g.harvester, T = g.THREE;
  if (run) h.debugSet('running');
  const st = { eng: 0, belt: 0, state: 'off' };
  let n = 0; while (!h.interior.ready && n++ < 100) h.interior.update(0.016, 0, st, { build: true, visible: false });
  g.step(3, 0.05);
  const pl = g.player.position;
  const inv = new T.Matrix4();
  const toL = (p) => { inv.copy(h.root.matrixWorld).invert(); return new T.Vector3().copy(p).applyMatrix4(inv); };
  const W = (x, y, z) => h.toWorld(x, y, z, new T.Vector3());
  const hasCeil = typeof h.interior.ceilingAt === 'function';
  const out = { eject: 0, fall: 0, head: 0, steps: 0, samples: [], rooms: {} };
  const note = (kind, room, p) => { out[kind]++; (out.rooms[room] ||= {})[kind] = ((out.rooms[room] || {})[kind] || 0) + 1; if (out.samples.length < 14) { const l = toL(p); out.samples.push(`${kind}@${room} local=${l.x.toFixed(1)},${l.y.toFixed(1)},${l.z.toFixed(1)}`); } };
  let vy = 0, grounded = true, jumpT = 0;
  const R = 0.35;
  function phys(dt, wx, wz, jumpWanted, room, floorY) {
    const sp = 4.0;
    const ox = pl.x, oz = pl.z;
    pl.x += wx * sp * dt; pl.z += wz * sp * dt;
    g.collide(pl, R, {});
    let gy = g.heightAt(pl.x, pl.z, pl.y);
    if (gy - pl.y > 0.5) {
      const nx = pl.x, nz = pl.z;
      if (g.heightAt(nx, oz, pl.y) - pl.y <= 0.5) { pl.z = oz; gy = g.heightAt(pl.x, pl.z, pl.y); }
      else if (g.heightAt(ox, nz, pl.y) - pl.y <= 0.5) { pl.x = ox; gy = g.heightAt(pl.x, pl.z, pl.y); }
      else { pl.x = ox; pl.z = oz; gy = g.heightAt(ox, oz, pl.y); }
    }
    if (grounded) {
      const d = gy - pl.y;
      if (jumpWanted) { grounded = false; vy = 5.6; }
      else if (d < -0.42) { grounded = false; vy = 0; }
      else pl.y += Math.max(-0.05, Math.min(0.05 + 0.1, d));
    } else {
      vy = Math.max(-45, vy - 19 * dt); pl.y += vy * dt;
      if (vy > 0 && g.ceilingAt) { const ce = g.ceilingAt(pl.x, pl.z, pl.y - vy * dt); if (pl.y + 1.76 > ce) { pl.y = ce - 1.76; vy = 0; } }
      if (pl.y <= gy && vy <= 0) { pl.y = gy; vy = 0; grounded = true; }
    }
    out.steps++;
    const l = toL(pl);
    if (!h.contains(pl)) note('eject', room, pl);
    else if (l.y < floorY - 0.8) note('fall', room, pl);
    if (hasCeil && g.ceilingAt) { const ce = g.ceilingAt(pl.x, pl.z, pl.y); if (pl.y + 1.76 > ce + 0.03) note('head', room, pl); }
  }
  function walk(tx, tz, secs, jump, room, floorY) {
    const dt = 1 / 60; let t = 0, tick = 0; jumpT = 0;
    while (t < secs) {
      const dx = tx - pl.x, dz = tz - pl.z, d = Math.hypot(dx, dz);
      if (d < 0.2) break;
      jumpT -= dt; let jw = false; if (jump && grounded && jumpT <= 0) { jw = true; jumpT = 0.35; }
      phys(dt, dx / d, dz / d, jw, room, floorY);
      t += dt; if (++tick % 6 === 0) g.step(1, 0.1);
    }
  }
  function freeSpot(b, fy) {
    for (let r = 0; r < 12; r += 0.5) for (let a = 0; a < 6.28; a += 0.5) {
      const lx = (b.x0 + b.x1) / 2 + Math.cos(a) * r * 0.5, lz = (b.z0 + b.z1) / 2 + Math.sin(a) * r * 0.5;
      if (lx < b.x0 + 0.8 || lx > b.x1 - 0.8 || lz < b.z0 + 0.8 || lz > b.z1 - 0.8) continue;
      const w = W(lx, fy, lz); const q = w.clone(); const hit = g.collide(q, R, {});
      if (!hit && h.contains(w)) return w;
    }
    return null;
  }
  const rooms = h.interior.rooms.filter((r) => !only.length || only.includes(r.id));
  for (const rm of rooms) {
    const b = rm.b, fy = b.y0;
    const s = freeSpot(b, fy); if (!s) { out.rooms[rm.id] = { skipped: 'no free spot' }; continue; }
    for (const jump of [false, true]) {
      pl.copy(s); vy = 0; grounded = true;
      const pts = [];
      const m = 0.6, xs = [b.x0 + m, (b.x0 + b.x1) / 2, b.x1 - m], zs = [b.z0 + m, (b.z0 + b.z1) / 2, b.z1 - m];
      for (const x of xs) for (const z of zs) pts.push([x, z]);
      // давим в стены/окна: цели за границей помещения на 1.5 м
      const ex = 1.5;
      for (let i = 1; i < 6; i++) {
        const u = i / 6, X = b.x0 + (b.x1 - b.x0) * u, Z = b.z0 + (b.z1 - b.z0) * u;
        pts.push([X, b.z0 - ex], [X, b.z1 + ex], [b.x0 - ex, Z], [b.x1 + ex, Z]);
      }
      for (const [lx, lz] of pts) {
        const w = W(lx, fy, lz);
        walk(w.x, w.z, 6, jump, rm.id, fy);
        if (!h.contains(pl)) { const s2 = freeSpot(b, fy); if (s2) { pl.copy(s2); vy = 0; grounded = true; } }
      }
    }
  }
  // снаружи: точки внутри видимых твёрдых элементов входа (пульт, опоры/поперечина под трапом, ноги площадки, фонарь, стойки рамы двери) — игрока должно вытолкнуть
  const EXT = [['console', 37.4, 4.0, 28.4], ['ramp-col-a', 25.5, 4.0, 24.3], ['ramp-col-b', 25.5, 4.0, 26.9], ['ramp-beam', 25.45, 4.0, 25.6], ['landing-leg', 7.5, 4.0, 26.5], ['lamp-post', 29, 4.0, 27.25], ['door-frame-L', 9.45, 10.6, 20.4], ['door-frame-R', 13.15, 10.6, 20.4], ['ramp-deck', 30.5, 4.0, 25.6]];
  out.ext = { total: EXT.length, passed: [] };
  for (const [name, lx, ly, lz] of EXT) {
    const w = W(lx + 0.07, ly, lz + 0.05); 
    pl.copy(w); const x0 = pl.x, z0 = pl.z;
    g.collide(pl, R, {});
    if (Math.hypot(pl.x - x0, pl.z - z0) < 0.2) out.ext.passed.push(`${name}[y=${toL(w).y.toFixed(1)},on=${h.contains(w)}]`);
  }
  return out;
}, { run: arg('run', '0') === '1', only: arg('rooms', '').split(',').filter(Boolean) });
console.log(`режим: ${arg('run', '0') === '1' ? 'харвестер работает' : 'харвестер стоит'}; шагов физики ${res.steps}`);
console.log(`EJECT (выкинуло с борта): ${res.eject}; FALL (провал ниже палубы): ${res.fall}; HEAD (голова выше потолка): ${res.head}`);
console.log(`EXT (твёрдые элементы входа, сквозь которые проходит игрок): ${res.ext.passed.length}/${res.ext.total} ${res.ext.passed.join(',')}`);
console.log('по комнатам:', JSON.stringify(res.rooms));
if (res.samples.length) console.log('примеры:\n  ' + res.samples.join('\n  '));
await browser.close();
if (errors.length) console.error('КОНСОЛЬ:\n' + [...new Set(errors)].slice(0, 10).join('\n'));
const bad = res.eject + res.fall + res.head + res.ext.passed.length;
console.log(bad ? `EJECT-TEST: ПРОБЛЕМЫ (${bad})` : 'EJECT-TEST: OK');
process.exit(bad ? 1 : 0);
