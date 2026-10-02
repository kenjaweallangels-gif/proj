// Тест игрока/камеры/спутников: node tools/build.mjs --out=player.html && node tools/player_test.mjs
import { chromium } from 'playwright';
import { mkdirSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const outDir = join(root, 'dist', 'shots', 'player');
mkdirSync(outDir, { recursive: true });

function findChromium() {
  const base = '/opt/pw-browsers';
  if (!existsSync(base)) return undefined;
  const d = readdirSync(base).find((n) => /^chromium-\d+$/.test(n));
  return d ? join(base, d, 'chrome-linux', 'chrome') : undefined;
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || findChromium(),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`file://${join(root, 'dist', arg('file', 'player.html'))}?autotest=1&q=low&lang=RU&skip=1`);
await page.waitForFunction(() => window.__rakis && window.__rakis.realTime > 1.5, null, { timeout: 120000 });

let fails = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${info}`); if (!ok) fails++; };
// Ждать N секунд игрового времени.
const wait = (sec) => page.evaluate((s) => new Promise((res) => { const g = window.__rakis; const t0 = g.time; const id = setInterval(() => { if (g.time - t0 >= s) { clearInterval(id); res(); } }, 30); }), sec);
const ev = (fn, a) => page.evaluate(fn, a);

await ev(() => {
  const g = window.__rakis; g.__ev = { noise: [], foot: 0, stutter: 0, thump: 0, sand: [], interact: [] };
  g.bus.on('noise', (e) => g.__ev.noise.push(e)); g.bus.on('footstep', (e) => { if (e.actor === 'player') g.__ev.foot++; });
  g.bus.on('stutter', () => g.__ev.stutter++); g.bus.on('thumper', () => g.__ev.thump++);
  g.bus.on('sandwalk', (e) => g.__ev.sand.push(e.on)); g.bus.on('interact', (e) => g.__ev.interact.push(e.tag));
});
check('player registered', await ev(() => !!window.__rakis.player && !!window.__rakis.companions?.list.length));
const p0 = await ev(() => ({ ...window.__rakis.player.position, yaw: window.__rakis.player.yaw }));
await page.screenshot({ path: join(outDir, '1_tp_start.png') });

// 1. Ходьба
await page.keyboard.down('KeyW'); await wait(3);
let s = await ev(() => { const p = window.__rakis.player; return { x: p.position.x, z: p.position.z, speed: p.speed, noise: p.noise, reg: p.regularity, foot: window.__rakis.__ev.foot, gait: p.gait }; });
const moved = Math.hypot(s.x - p0.x, s.z - p0.z);
check('player moved', moved > 4, `moved=${moved.toFixed(1)} speed=${s.speed.toFixed(2)} gait=${s.gait}`);
check('walk speed ~3', Math.abs(s.speed - 3) < 0.5);
check('noise rose', s.noise > 0.25, `noise=${s.noise.toFixed(2)} reg=${s.reg.toFixed(2)} steps=${s.foot}`);
check('walk is regular', s.reg > 0.6, `reg=${s.reg.toFixed(2)}`);
await page.screenshot({ path: join(outDir, '2_tp_walk.png') });

// бег
await page.keyboard.down('ShiftLeft'); await wait(2);
s = await ev(() => { const p = window.__rakis.player; return { speed: p.speed, noise: p.noise, fov: window.__rakis.camera.fov, gait: p.gait }; });
check('run speed ~6, loud', s.speed > 5 && s.noise > 0.7, `speed=${s.speed.toFixed(2)} noise=${s.noise.toFixed(2)} fov=${s.fov.toFixed(1)}`);
await page.screenshot({ path: join(outDir, '3_tp_run.png') });
await page.keyboard.up('ShiftLeft');

// 2. Походка по песку: ровно vs с Stutter
await page.keyboard.down('KeyC'); await wait(5);
const regSteady = await ev(() => ({ reg: window.__rakis.player.regularity, speed: window.__rakis.player.speed, sw: window.__rakis.player.sandWalking, last: window.__rakis.player.lastStepLoudness }));
check('sandwalk on, speed ~2', regSteady.sw && Math.abs(regSteady.speed - 2) < 0.4, JSON.stringify(regSteady));
check('sandwalk quiet', regSteady.last < 0.25, `last=${regSteady.last.toFixed(3)}`);
const regs = [];
for (let i = 0; i < 9; i++) { await page.keyboard.press('Space'); await wait(0.5 + (i % 3) * 0.2); regs.push(await ev(() => window.__rakis.player.regularity)); }
const regStut = Math.min(...regs);
const info = await ev(() => ({ iv: window.__rakis.player.intervals.map((v) => +v.toFixed(2)), st: window.__rakis.__ev.stutter }));
check('stutter lowers regularity', regStut < regSteady.reg - 0.15 || regStut < 0.5, `steady=${regSteady.reg.toFixed(2)} stutter_min=${regStut.toFixed(2)} ${JSON.stringify(info)}`);
check('stutter events', info.st >= 3);
await page.keyboard.up('KeyC'); await page.keyboard.up('KeyW'); await wait(0.3);
check('sandwalk events', await ev(() => window.__rakis.__ev.sand.join()) === 'true,false');
await wait(3);
s = await ev(() => ({ speed: window.__rakis.player.speed, noise: window.__rakis.player.noise }));
check('standing is silent', s.speed < 0.1 && s.noise < 0.05, `noise=${s.noise.toFixed(2)}`);

// 3. Companions chain
await page.keyboard.down('KeyW'); await wait(6); await page.keyboard.up('KeyW'); await wait(3);
const comp = await ev(() => { const g = window.__rakis; const p = g.player.position; return g.companions.list.map((c) => ({ id: c.id, d: Math.hypot(c.position.x - p.x, c.position.z - p.z) })); });
check('companions follow ~3.5 m apart', comp.length >= 2 && Math.abs(comp[0].d - 3.5) < 1.2 && Math.abs(comp[1].d - 7) < 1.5, JSON.stringify(comp));
await page.screenshot({ path: join(outDir, '4_tp_companions.png') });

// 4. Thumper
await page.keyboard.press('KeyT'); await wait(2.4);
const th = await ev(() => { const g = window.__rakis; return { ch: g.player.thumperCharges, thump: g.__ev.thump, n: g.__ev.noise.filter((e) => e.source === 'Thumper').length, items: g.interactables.length, focus: g.player.focus }; });
check('thumper deployed', th.ch === 1 && th.thump >= 1 && th.n >= 1 && th.items === 1, JSON.stringify(th));
// подойти к тамперу: он стоит перед игроком (1.8 м) — подбираем через Interact
await wait(0.3);
const foc = await ev(() => window.__rakis.player.focus);
check('thumper focus', !!foc && foc.tag === 'Thumper', JSON.stringify(foc && { label: foc.label, tag: foc.tag }));
await page.screenshot({ path: join(outDir, '5_tp_thumper.png') });
await page.keyboard.press('KeyE'); await wait(0.3);
const th2 = await ev(() => ({ ch: window.__rakis.player.thumperCharges, items: window.__rakis.interactables.length, it: window.__rakis.__ev.interact.join() }));
check('thumper picked up', th2.ch === 2 && th2.items === 0 && th2.it === 'Thumper', JSON.stringify(th2));

// 5. Mask + hydration
const h0 = await ev(() => { const p = window.__rakis.player; return { m: p.moisture, sealed: p.maskSealed, shade: p.inShade }; });
await page.keyboard.press('KeyM'); await wait(0.2);
check('mask toggles', (await ev(() => window.__rakis.player.maskSealed)) === !h0.sealed, JSON.stringify(h0));
const mA = await ev(() => window.__rakis.player.moisture); await wait(3); const mB = await ev(() => window.__rakis.player.moisture);
check('moisture drains in sun', mB < mA, `${mA.toFixed(4)} -> ${mB.toFixed(4)}`);

// 6. Камера: FP/TP
await page.keyboard.press('KeyV'); await wait(1.5);
check('first person', await ev(() => window.__rakis.player.firstPerson && !window.__rakis.player.figure.group.visible));
await page.screenshot({ path: join(outDir, '6_fp.png') });
await page.keyboard.down('KeyW'); await wait(1.5);
await page.screenshot({ path: join(outDir, '7_fp_walk.png') });
await page.keyboard.up('KeyW');
await page.keyboard.press('KeyV'); await wait(1.5);
check('back to third person', await ev(() => !window.__rakis.player.firstPerson && window.__rakis.player.figure.group.visible));

// 7. Кат-сцена: камеру не трогаем
const camBefore = await ev(() => window.__rakis.camera.position.toArray());
await ev(() => { const g = window.__rakis; g.cinematic.active = true; g.camera.position.set(0, 100, 0); });
await page.keyboard.down('KeyW'); await wait(1);
const camCin = await ev(() => ({ c: window.__rakis.camera.position.toArray(), sp: window.__rakis.player.speed }));
check('cinematic: camera untouched, input frozen', camCin.c[1] === 100 && camCin.sp < 0.2, JSON.stringify(camCin));
await page.keyboard.up('KeyW');
await ev(() => { window.__rakis.cinematic.active = false; window.__rakis.bus.emit('cinematic', { active: false, id: 'WormReveal' }); });
await wait(0.3);
const midY = await ev(() => window.__rakis.camera.position.y);
await wait(2);
const endY = await ev(() => window.__rakis.camera.position.y);
check('camera resyncs smoothly', midY > 5 && endY < 10, `mid=${midY.toFixed(1)} end=${endY.toFixed(1)}`);
check('Ossana joins after WormReveal', await ev(() => window.__rakis.companions.list.some((c) => c.id === 'Ossana')));
await wait(4);
await page.screenshot({ path: join(outDir, '8_tp_ossana.png') });
await ev(() => { const r = window.__rakis.player.cam; r.yaw += Math.PI; r.pitch = 0.05; });
await wait(0.8);
await page.screenshot({ path: join(outDir, '9_tp_look_back.png') });

// 8. Телепорт
await ev(() => window.__rakis.player.teleport(279, undefined, 95, 0.4));
await wait(0.5);
const tp = await ev(() => { const g = window.__rakis; return { p: [g.player.position.x, g.player.position.z], c: g.companions.list.map((c) => Math.hypot(c.position.x - 279, c.position.z - 95)), sp: g.companions.speakerPos('Ilva')?.toArray() }; });
check('teleport + companions behind', Math.abs(tp.p[0] - 279) < 0.01 && tp.c[0] < 5 && !!tp.sp, JSON.stringify(tp));

await browser.close();
const uniq = [...new Set(errors)];
if (uniq.length) { console.error(`ОШИБКИ (${uniq.length}):\n` + uniq.slice(0, 20).join('\n')); fails++; }
console.log(fails ? `FAILED: ${fails}` : 'ALL OK');
process.exit(fails ? 1 : 0);
