// Запекание пещерного сиетча: node tools/sietch_bake.mjs [--if-stale] [--cell=0.34] [--out=src/assets/sietch_cave.js]
// SDF (src/sietch/cave/*) → меш + AO/свет + сетки пола → zlib → base64-модуль, встраиваемый в сборку.
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bakeCave } from '../src/sietch/cave/bake.js';
import { pack, toBase64 } from '../src/sietch/cave/pack.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const out = resolve(root, arg('out', 'src/assets/sietch_cave.js'));
const cell = Number(arg('cell', 0.34));
const caveDir = join(root, 'src', 'sietch', 'cave');

function sourceHash() {
  const h = createHash('sha1');
  for (const f of readdirSync(caveDir).sort()) h.update(f).update(readFileSync(join(caveDir, f)));
  h.update(readFileSync(join(root, 'tools', 'sietch_bake.mjs'))).update(String(cell));
  return h.digest('hex').slice(0, 16);
}
const hash = sourceHash();
if (process.argv.includes('--if-stale') && existsSync(out)) {
  const head = readFileSync(out, 'utf8').slice(0, 200);
  if (head.includes(`HASH=${hash}`)) { console.log(`sietch_bake: актуально (${hash})`); process.exit(0); }
}
const t0 = Date.now();
const baked = bakeCave({ cell, log: (s) => console.log('  ' + s) });
const { raw, z, header } = pack(baked);
const b64 = toBase64(z);
writeFileSync(out, `// АВТОГЕНЕРАЦИЯ: node tools/sietch_bake.mjs — не править вручную. HASH=${hash}\nexport const HASH = '${hash}';\nexport default '${b64}';\n`);
console.log(`sietch_bake: ${((Date.now() - t0) / 1000).toFixed(1)} с; вершин ${header.NV}, треугольников ${header.NI / 3}; raw ${(raw.length / 1048576).toFixed(2)} МБ → zlib ${(z.length / 1048576).toFixed(2)} МБ → ${out}`);
