#!/usr/bin/env node
/** `node --check` every module under src/ships (syntax check before reloading the shared dev server). */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let bad = 0, n = 0;
for (const d of ['src/ships', 'src/ships/types']) {
  for (const f of fs.readdirSync(path.join(root, d))) {
    if (!f.endsWith('.js')) continue;
    n++;
    try { execFileSync(process.execPath, ['--check', path.join(root, d, f)], { stdio: 'pipe' }); }
    catch (e) { bad++; console.log('FAIL', `${d}/${f}`, e.stderr.toString().split('\n').slice(0, 6).join('\n')); }
  }
}
console.log(bad ? `${bad} of ${n} failed` : `${n} files ok`);
process.exit(bad ? 1 : 0);
