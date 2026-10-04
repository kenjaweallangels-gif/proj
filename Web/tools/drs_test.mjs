// Тест динамического разрешения (core/quality.js) на синтетических кадрах: сходимость вниз при тяжёлых кадрах, возврат при лёгких,
// устойчивость на границе (нет дребезга), игнорирование выбросов (компиляция шейдеров).
globalThis.location = { search: '' };
globalThis.document = { hidden: false };
const { createDRS } = await import('../src/core/quality.js');

function run(name, frameMs, secs, opts = {}) {
  const game = { realTime: 0, paused: false, setRenderScale() {} };
  const drs = createDRS(game, 1);
  if (opts.level) drs.level = opts.level;
  let changes = 0, last = drs.level, maxLevel = 0;
  const n = Math.round(secs * 1000 / 16);
  for (let i = 0; i < n; i++) {
    const ms = typeof frameMs === 'function' ? frameMs(i, game.realTime) : frameMs;
    game.realTime += Math.min(0.05, ms / 1000);
    drs.update(ms / 1000);
    if (drs.level !== last) { changes++; last = drs.level; }
    maxLevel = Math.max(maxLevel, drs.level);
  }
  console.log(name.padEnd(46), `level=${drs.level} scale=${drs.scale} changes=${changes} avg=${drs.avgMs.toFixed(1)}ms`);
  return { drs, changes, maxLevel };
}
let fail = 0;
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) fail++; };

let r = run('heavy 30 ms frames for 20 s', 30, 20);
ok(r.drs.level >= 4, 'drops resolution under heavy load');
r = run('light 9 ms frames starting at level 5 for 60 s', 9, 60, { level: 5 });
ok(r.drs.level <= 1, 'recovers when frames are cheap');
r = run('steady 16.7 ms for 30 s', 16.7, 30);
ok(r.drs.level === 0 && r.changes === 0, 'holds at vsync-60 without change');
r = run('hitches: 16 ms + 400 ms spike every 2 s', (i) => (i % 125 === 0 ? 400 : 16), 40);
ok(r.drs.level === 0, 'ignores compile hitches (outliers)');
// кадр на границе: чередуем 16/20 мс — не должно «качаться» каждые полсекунды
r = run('borderline 18 ms for 60 s', 18, 60);
ok(r.changes <= 4, `no oscillation at the boundary (changes=${r.changes})`);
process.exit(fail ? 1 : 0);
