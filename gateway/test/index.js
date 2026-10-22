// Entry point for `node --test gateway/test/`: Node 22 treats a directory argument as a module path and
// loads this index, which imports every *.test.ts suite in this directory (run in one process; each suite
// uses its own loopback port range 18700–18799). `node --test gateway/test/*.test.ts` also works.

import { readdirSync } from 'node:fs';

const dir = new URL('./', import.meta.url);
for (const file of readdirSync(dir).filter((f) => f.endsWith('.test.ts')).sort()) {
  await import(new URL(file, dir).href);
}
