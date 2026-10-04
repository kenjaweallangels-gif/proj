// Загрузка CC0 PBR-текстур Poly Haven → ресайз/JPEG (sharp) → src/assets/textures.js (data URI) + assets_src/LICENSES.md.
// Запуск: node tools/fetch_textures.mjs [--force] [--only=sand,leather]
// Оригиналы 1k кэшируются в assets_src/raw/ (в .gitignore). Нужен интернет только при первом запуске.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'assets_src', 'raw');
const OUT = path.join(ROOT, 'src', 'assets', 'textures.js');
const LIC = path.join(ROOT, 'assets_src', 'LICENSES.md');
const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const ONLY = (args.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);

// name: контракт core/textures.js. size — сторона диффузной карты, rsize — шероховатость, ao — включать ли AO.
// gray: перевод альбедо в нейтральный серый (резина) с множителем яркости.
const SET = {
  sand:           { id: 'dense_sand',            size: 1024, rsize: 512, ao: false, meters: 1.6 },
  sand_ripples:   { id: 'aerial_beach_01',       size: 1024, rsize: 512, ao: false, meters: 3.0 },
  rock_desert:    { id: 'rock_face_03',          size: 1024, rsize: 512, ao: true,  meters: 3.0 },
  rock_cliff:     { id: 'cliff_side',            size: 1024, rsize: 512, ao: true,  meters: 4.0 },
  rock_cave:      { id: 'worn_rock_natural_01',  size: 512,  rsize: 512, ao: true,  meters: 2.5 },
  cave_floor:     { id: 'baseball_playground',   size: 512,  rsize: 256, ao: false, meters: 2.0 },
  plaster_rough:  { id: 'clay_plaster',          size: 512,  rsize: 256, ao: false, meters: 1.5 },
  fabric_woven:   { id: 'hessian_230',           size: 512,  rsize: 256, ao: false, meters: 0.6 },
  fabric_rough:   { id: 'poly_wool_herringbone', size: 512,  rsize: 256, ao: false, meters: 0.6 },
  leather:        { id: 'brown_leather',         size: 512,  rsize: 256, ao: false, meters: 0.5 },
  metal_rusty:    { id: 'rusty_metal_04',        size: 1024, rsize: 512, ao: false, meters: 1.5 },
  metal_painted:  { id: 'green_metal_rust',      size: 512,  rsize: 512, ao: false, meters: 1.5 },
  rubber:         { id: 'rubberized_track',      size: 512,  rsize: 256, ao: false, meters: 0.6, gray: 0.55 },
  stone_polished: { id: 'concrete_floor_worn_001', size: 512, rsize: 256, ao: false, meters: 2.0 },
};
const KEYS = { map: 'Diffuse', normal: 'nor_gl', rough: 'Rough', ao: 'AO' };

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ' → ' + r.status);
  return r.json();
}
async function download(url, file) {
  if (fs.existsSync(file) && !FORCE) return;
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ' → ' + r.status);
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
}

fs.mkdirSync(RAW, { recursive: true });
let lib = {};
const libCache = path.join(RAW, '_manifest.json');
if (ONLY.length && fs.existsSync(libCache)) lib = JSON.parse(fs.readFileSync(libCache, 'utf8'));
const lic = [];
let total = 0;
for (const [name, c] of Object.entries(SET)) {
  if (ONLY.length && !ONLY.includes(name)) { if (lib[name]) lic.push(lib[name]._lic); continue; }
  const info = await getJson(`https://api.polyhaven.com/info/${c.id}`);
  const files = await getJson(`https://api.polyhaven.com/files/${c.id}`);
  const authors = Object.keys(info.authors || {}).join(', ') || 'Poly Haven';
  const entry = { meters: c.meters, source: `polyhaven.com/a/${c.id}`, license: 'CC0' };
  for (const [slot, key] of Object.entries(KEYS)) {
    if (slot === 'ao' && !c.ao) continue;
    const f = files[key]?.['1k']?.jpg;
    if (!f) { if (slot === 'map' || slot === 'normal') throw new Error(`${c.id}: нет ${key}`); continue; }
    const file = path.join(RAW, `${c.id}_${key}_1k.jpg`);
    await download(f.url, file);
    let img = sharp(file);
    const sz = slot === 'rough' ? c.rsize : slot === 'ao' ? Math.min(c.size, 512) : c.size;
    img = img.resize(sz, sz, { fit: 'fill', kernel: 'lanczos3' });
    if (slot === 'map' && c.gray) img = img.greyscale().linear(c.gray, 0);
    if (slot !== 'map' && slot !== 'normal') img = img.greyscale();
    const q = slot === 'normal' ? 86 : slot === 'map' ? 80 : 72;
    const buf = await img.jpeg({ quality: q, mozjpeg: true, chromaSubsampling: slot === 'normal' ? '4:4:4' : '4:2:0' }).toBuffer();
    entry[slot] = 'data:image/jpeg;base64,' + buf.toString('base64');
    total += entry[slot].length;
  }
  entry._lic = `| ${name} | ${c.id} | ${authors} | https://polyhaven.com/a/${c.id} | CC0 |`;
  lib[name] = entry;
  lic.push(entry._lic);
  console.log(name.padEnd(15), c.id.padEnd(24), authors, Object.entries(entry).filter(([k]) => ['map', 'normal', 'rough', 'ao'].includes(k)).map(([k, v]) => k + ':' + (v.length / 1024 | 0) + 'K').join(' '));
}
fs.writeFileSync(libCache, JSON.stringify(lib));
const out = {};
for (const [k, v] of Object.entries(lib)) { const { _lic, ...rest } = v; out[k] = rest; }
const js = `// Сгенерировано tools/fetch_textures.mjs (CC0: Poly Haven). Не править руками.\n// Формат: { name: { map, normal, rough, ao?, meters, source, license } } — data URI (JPEG).\nexport default ${JSON.stringify(out)};\n`;
fs.writeFileSync(OUT, js);
fs.writeFileSync(LIC, `# Лицензии внешних текстур\n\nВсе текстуры — CC0 (public domain), Poly Haven (https://polyhaven.com/license). Атрибуция не требуется, но указана для прозрачности.\nОригиналы 1k JPG скачиваются \`node tools/fetch_textures.mjs\` (кэш \`assets_src/raw/\`, в git не входит); в сборку встроены уменьшенные JPEG.\n\n| Имя в контракте | Poly Haven ID | Автор(ы) | URL | Лицензия |\n|---|---|---|---|---|\n${lic.join('\n')}\n`);
console.log('manifest', (js.length / 1048576).toFixed(2), 'MB');
