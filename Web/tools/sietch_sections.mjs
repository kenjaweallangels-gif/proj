// Размеры секций запечённой пещеры (после zlib каждой по отдельности): node tools/sietch_sections.mjs [файл.js]
import { readFileSync } from 'node:fs';
import { zlibSync, unzlibSync } from 'three/examples/jsm/libs/fflate.module.js';
import { fromBase64 } from '../src/sietch/cave/pack.js';

const file = process.argv[2] || new URL('../src/assets/sietch_cave.js', import.meta.url).pathname;
const src = readFileSync(file, 'utf8');
const b64 = src.slice(src.indexOf("export default '") + 16, src.lastIndexOf("'"));
const raw = unzlibSync(fromBase64(b64));
const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
const hl = dv.getUint32(0, true);
const header = JSON.parse(new TextDecoder().decode(raw.subarray(4, 4 + hl)));
const hp = (hl + 3) & ~3;
const B = { u8: 1, i8: 1, u16: 2, i16: 2, i32: 4, f32: 4 };
let tot = 0;
const rows = [];
for (const s of header.sections) {
  const len = s.n * B[s.type];
  const z = zlibSync(raw.subarray(4 + hp + s.off, 4 + hp + s.off + len), { level: 9 }).length;
  tot += z; rows.push([s.name, len, z]);
}
rows.sort((a, b) => b[2] - a[2]);
for (const [n, l, z] of rows.slice(0, 14)) console.log(n.padEnd(10), String(l).padStart(9), '→', String(z).padStart(8));
console.log('сумма секций zlib', (tot / 1048576).toFixed(2), 'МБ; заголовок', hl, 'байт; файл', (src.length / 1048576).toFixed(2), 'МБ');
