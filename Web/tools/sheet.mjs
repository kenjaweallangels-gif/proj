// Контактный лист: node tools/sheet.mjs <dir> <out.png> <cols> a.png b.png ...
import sharp from 'sharp';
import { join } from 'node:path';
const [dir, out, colsS, ...files] = process.argv.slice(2);
const cols = Number(colsS);
const bufs = await Promise.all(files.map((f) => sharp(join(dir, f)).toBuffer()));
const m = await sharp(bufs[0]).metadata();
const rows = Math.ceil(bufs.length / cols);
await sharp({ create: { width: m.width * cols, height: m.height * rows, channels: 3, background: '#000' } })
  .composite(bufs.map((b, i) => ({ input: b, left: (i % cols) * m.width, top: Math.floor(i / cols) * m.height }))).png().toFile(join(dir, out));
console.log(out);
