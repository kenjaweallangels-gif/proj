// Копирует пакеты операций, GLB, листы КД и текстуры меток из общего репозитория в public/.
// Источник истины — ../data/examples (тот же пакет читают ядро, Godot и очки). Запускается перед dev/build.
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const src = resolve(root, '../data/examples');
const dst = join(root, 'public/data');
mkdirSync(dst, { recursive: true });

let n = 0;
for (const f of readdirSync(src)) {
  if (f.endsWith('.json')) { cpSync(join(src, f), join(dst, f)); n++; }
}
for (const d of ['models', 'kd']) {
  if (existsSync(join(src, d))) { cpSync(join(src, d), join(dst, d), { recursive: true }); n++; }
  else console.warn(`[sync-data] нет ${d}/ — выполните в pkg1-sim-vm: make godot-assets (заглушки GLB и листов КД)`);
}
const markers = resolve(root, '../pkg1-sim-vm/godot/textures/markers');
if (existsSync(markers)) {
  mkdirSync(join(root, 'public/markers'), { recursive: true });
  for (const f of readdirSync(markers)) if (f.endsWith('.png')) cpSync(join(markers, f), join(root, 'public/markers', f));
  n++;
} else console.warn('[sync-data] нет текстур меток — make godot-assets; метки будут серыми');
console.log(`[sync-data] скопировано групп: ${n} → public/`);
