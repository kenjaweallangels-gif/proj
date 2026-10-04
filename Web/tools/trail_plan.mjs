// План тропы сверху (node, без браузера): карта высот самой верхней/ходимой поверхности SDF-сетки с горизонталями и осью тропы.
//   node tools/trail_plan.mjs [--out=dist/shots/trail_plan.png] [--px=8]
import { heightAt as fieldH } from '../src/desert/field.js';
import { buildClawGeometry } from '../src/desert/rock.js';
import { buildWallTable } from '../src/level/wall.js';
import { createApproachScene, ZONE } from '../src/level/scene.js';
import sharp from 'sharp';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const PX = Number(arg('px', 8));
const bx0 = ZONE.x0 - 4, bz0 = ZONE.z0 - 4, bn = Math.ceil(ZONE.x1 - ZONE.x0) + 9, bm = Math.ceil(ZONE.z1 - ZONE.z0) + 9;
const bg = new Float32Array(bn * bm);
for (let k = 0; k < bm; k++) for (let i = 0; i < bn; i++) bg[i + bn * k] = fieldH(bx0 + i, bz0 + k);
const base = (x, z) => { const fx = Math.min(bn - 1.001, Math.max(0, x - bx0)), fz = Math.min(bm - 1.001, Math.max(0, z - bz0)); const i = fx | 0, k = fz | 0, u = fx - i, v = fz - k, o = i + bn * k; return (bg[o] * (1 - u) + bg[o + 1] * u) * (1 - v) + (bg[o + bn] * (1 - u) + bg[o + bn + 1] * u) * v; };
const wallX = buildWallTable(() => buildClawGeometry('med'), { z0: ZONE.z0, z1: ZONE.z1, yMax: ZONE.y1 }, 'med', 'west', { dz: 0.5, dy: 0.5 });
const S = createApproachScene({ base, wallX });
const vol = S.build();
const W = Math.round((ZONE.x1 - ZONE.x0) * PX), H = Math.round((ZONE.z1 - ZONE.z0) * PX);
const buf = Buffer.alloc(W * H * 3);
const hAt = (x, z) => { const y = vol.surfaceY(x, z); return Number.isFinite(y) ? y : base(x, z); };
for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
  const x = ZONE.x0 + px / PX, z = ZONE.z1 - py / PX;   // z растёт вверх (север сверху)
  const y = hAt(x, z), e = 0.5;
  const gx = (hAt(x + e, z) - hAt(x - e, z)) / (2 * e), gz = (hAt(x, z + e) - hAt(x, z - e)) / (2 * e);
  const shade = Math.max(0.25, Math.min(1.2, 0.8 - 0.35 * (gx * 0.7 + gz * 0.7)));
  let r = 0.35 + y / 70, g = 0.3 + y / 90, b = 0.25;
  const iso = Math.abs(((y / 2) % 1 + 1) % 1 - 0.5) > 0.47;
  const k = iso ? 0.55 : 1;
  const o = (py * W + px) * 3;
  buf[o] = Math.min(255, 255 * r * shade * k); buf[o + 1] = Math.min(255, 255 * g * shade * k); buf[o + 2] = Math.min(255, 255 * b * shade * k);
}
const dot = (x, z, c, s = 1) => { const px = Math.round((x - ZONE.x0) * PX), py = Math.round((ZONE.z1 - z) * PX); for (let dy = -s; dy <= s; dy++) for (let dx = -s; dx <= s; dx++) { const X = px + dx, Y = py + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const o = (Y * W + X) * 3; buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2]; } };
S.LEGS.forEach((L, li) => { const c = [[255, 60, 60], [60, 255, 60], [80, 120, 255], [255, 255, 60], [255, 60, 255], [60, 255, 255]][li % 6]; for (const p of L.line) dot(p[0], p[1], c, 1); });
for (let x = ZONE.x0; x <= ZONE.x1; x += 10) for (let z = ZONE.z0; z <= ZONE.z1; z += 10) dot(x, z, [255, 255, 255], 0);
const out = join(root, arg('out', 'dist/shots/trail_plan.png'));
await sharp(buf, { raw: { width: W, height: H, channels: 3 } }).png().toFile(out);
console.log('plan →', out, `${W}x${H}`, 'tris', vol.mesh({}).index.length / 3 | 0);
