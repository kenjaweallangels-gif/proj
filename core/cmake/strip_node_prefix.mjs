// Rewrites Node built-in specifiers "node:x" -> "x" in the Emscripten ES module (byte-exact: the SINGLE_FILE
// module embeds the WASM as a raw byte string, so the file is read and written as latin1).
// Node resolves both forms; the unprefixed ones match the externals of web/build.mjs (esbuild, platform browser),
// whose browser bundle never executes the Node branch.
import fs from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node strip_node_prefix.mjs <echo_core.mjs>');
  process.exit(2);
}
let text = fs.readFileSync(file, 'latin1');
let count = 0;
for (const mod of ['module', 'fs', 'path', 'url', 'crypto', 'worker_threads']) {
  const from = `"node:${mod}"`;
  const parts = text.split(from);
  count += parts.length - 1;
  text = parts.join(`"${mod}"`);
}
fs.writeFileSync(file, text, 'latin1');
console.log(`echo_core.mjs: ${count} node:* specifiers rewritten`);
