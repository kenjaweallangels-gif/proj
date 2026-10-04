// Покрытие озвучки: каждая реплика, которую может сыграть игра, должна иметь запись в банке (src/assets/vo.js).
//   node tools/vo_coverage.mjs          — отчёт; код 1, если есть неозвученные реплики или ссылки на несуществующие ID.
// Проверяется:
//   1. Dialogue_S1: все строки, кроме Lore (надписи — только текст), имеют Line_Native и запись VO[id];
//   2. Barks.csv (лай толпы): у каждой строки есть Line_Native и запись VO[BarkID]; у каждого архетипа есть запасное «бормотание» в BARKS;
//   3. цепочки: NextID указывает на существующую строку; все DLG_*/BRK_*/LORE_* в коде и в StoryBeats.csv существуют;
//   4. в коде нет путей к speechSynthesis / SpeechSynthesisUtterance;
//   5. все bus.emit('subtitle', ...) вне story/dialogue.js — только с id (иначе реплика осталась бы без озвучки).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import data from '../src/data/data.js';
import { VO, BARKS } from '../src/assets/vo.js';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', 'src');
const problems = [];
const miss = (kind, id, why) => problems.push(`${kind} ${id}: ${why}`);

// 1. диалоги
let dTotal = 0, dVoiced = 0, lore = 0;
for (const r of Object.values(data.Dialogue)) {
  if (r.speaker === 'Lore') { lore++; continue; }
  dTotal++;
  if (!r.native) miss('DLG', r.id, 'нет Line_Native');
  else if (!VO[r.id]) miss('DLG', r.id, 'нет записи в vo.js');
  else dVoiced++;
  if (r.next && !data.Dialogue[r.next]) miss('DLG', r.id, `NextID ${r.next} не существует`);
}
// 2. лай
let bTotal = 0, bVoiced = 0;
for (const b of data.Barks) {
  bTotal++;
  if (!b.native) miss('BRK', b.id, 'нет Line_Native');
  else if (!VO[b.id]) miss('BRK', b.id, 'нет записи в vo.js');
  else bVoiced++;
}
const archs = new Set(data.Barks.map((b) => b.archetype));
for (const a of archs) if (!(BARKS[a] || []).length) miss('ARCH', a, 'нет запасного бормотания в BARKS');

// 3. ссылки в коде и StoryBeats
const files = [];
(function walk(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) { if (n !== 'assets') walk(p); } else if (n.endsWith('.js')) files.push(p);
  }
})(SRC);
const known = (id) => !!data.Dialogue[id] || data.Barks.some((b) => b.id === id);
const refs = new Map();
for (const f of files) {
  if (f.endsWith('data/data.js')) continue;
  const txt = readFileSync(f, 'utf8');
  for (const m of txt.matchAll(/\b(DLG_[A-Z0-9_]+|LORE_[A-Za-z0-9_]+|BRK_[A-Za-z0-9_]+)\b/g)) if (!refs.has(m[1])) refs.set(m[1], f.replace(SRC, 'src'));
  if (/speechSynthesis|SpeechSynthesisUtterance/.test(txt)) miss('TTS', f.replace(SRC, 'src'), 'путь к TTS браузера (запрещён)');
  if (!f.endsWith(join('story', 'dialogue.js'))) {
    for (const m of txt.matchAll(/emit\('subtitle',\s*\{([^}]*)\}/g)) {
      if (!/\bid\b/.test(m[1])) miss('SUB', f.replace(SRC, 'src'), 'subtitle без id — реплика не будет озвучена');
    }
  }
}
for (const [id, f] of refs) {
  if (id.endsWith('_')) continue;
  if (id.startsWith('LORE_')) { if (!data.Dialogue[id]) miss('REF', id, `нет в CSV (${f})`); continue; }
  if (!known(id)) miss('REF', id, `нет в CSV (${f})`);
  else if (data.Dialogue[id] && !VO[id] && data.Dialogue[id].speaker !== 'Lore') miss('REF', id, `нет озвучки (${f})`);
}
for (const s of data.StoryBeats) {
  if (s.action === 'PlayDialogue' && s.param) {
    const id = s.param.trim();
    if (!data.Dialogue[id]) miss('BEAT', s.id, `PlayDialogue → ${id} не существует`);
  }
}

const tot = dTotal + bTotal, voiced = dVoiced + bVoiced;
console.log(`Диалоги: ${dVoiced} из ${dTotal} озвучены (надписей Lore — только текст: ${lore})`);
console.log(`Лай толпы: ${bVoiced} из ${bTotal} озвучены; архетипов с запасным бормотанием: ${[...archs].filter((a) => (BARKS[a] || []).length).length} из ${archs.size}`);
console.log(`ИТОГО: ${voiced} из ${tot} реплик озвучено (${((100 * voiced) / tot).toFixed(1)} %)`);
if (problems.length) {
  console.log(`\nПроблемы (${problems.length}):`);
  for (const p of problems.slice(0, 80)) console.log('  ' + p);
  process.exit(1);
}
console.log('Проблем нет.');
