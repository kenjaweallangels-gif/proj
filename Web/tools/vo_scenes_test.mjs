// Проверка сцен-разговоров Ред. 2: в зонах запускаются подслушанные сцены/бантер, реплики идут цепочкой без наложений, у каждой есть запись,
// голос позиционирован (спутник / житель сиетча / запасная точка), после зала игра не заканчивается (нет EndDemo, управление не блокируется).
// node tools/vo_scenes_test.mjs [--file=vo.html] [--zone=market] [--secs=220] [--min=6]   (secs — игровое время, шаг 0.5 с)
import { chromium } from 'playwright';
import { readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const findChromium = () => {
  const base = '/opt/pw-browsers';
  if (!existsSync(base)) return undefined;
  const d = readdirSync(base).find((n) => /^chromium-\d+$/.test(n));
  return d ? join(base, d, 'chrome-linux', 'chrome') : undefined;
};
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const errors = [];
const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`file://${join(root, 'dist', arg('file', 'vo.html'))}?q=low&autotest=1&lang=RU`);
await page.waitForFunction(() => window.__rakis && window.__rakis.realTime > 1, null, { timeout: 240000, polling: 500 });
let bad = 0;
const fail = (m) => { console.error('FAIL:', m); bad++; };

const zone = arg('zone', 'market'), secs = Number(arg('secs', 220));
const r = await page.evaluate(async ({ zone, secs }) => {
  const g = window.__rakis;
  g.settings.voiceForce = true; g.settings.voiceMode = 'auto'; g.settings.voice = true;
  g.audio.resume();
  const log = [], posKinds = {};
  g.bus.on('subtitle', (e) => {
    if (e.kind !== 'line') return;
    const v = g.audio.voice, p = v?.current?.pos;
    log.push({ t: +g.time.toFixed(1), id: e.id, chain: e.chain, sp: e.speaker, dur: +e.duration.toFixed(2), audio: e.audio });
  });
  const overlap = [];
  let active = 0;
  g.bus.on('subtitle', (e) => { if (e.kind === 'line') { active++; if (active > 1) overlap.push(e.id); } });
  g.bus.on('line:end', () => { active = Math.max(0, active - 1); });
  g.debug?.goto?.(zone);
  g.dialogue.stopAll?.();
  // Headless-рендер медленный (игровое время ползёт), поэтому время сценария двигаем вручную: story.update/dialogue.update с dt = 0.5 с.
  const clips = new Set();
  const steps = Math.round(secs / 0.5);
  for (let i = 0; i < steps; i++) {
    g.time += 0.5; g.story.update(0.5); g.dialogue.update(0.5);
    if (i % 4 === 0) await new Promise((r) => setTimeout(r, 30));
    const c = g.audio.voice.current;
    if (c?.id) clips.add(c.id + '@' + (c.pos ? 'pos' : 'nopos'));
  }
  const chains = [...new Set(log.map((l) => l.chain))];
  return { zone: g.zone, space: g.space, chains, lines: log.length, withAudio: log.filter((l) => l.audio).length, speakers: [...new Set(log.map((l) => l.sp))], overlap, clips: [...clips].length, noPos: [...clips].filter((c) => c.endsWith('nopos')).length,
    beats: g.story.beats.filter((b) => b.fired).map((b) => b.id).filter((id) => /B5|C1/.test(id)), endActions: g.story.beats.filter((b) => /^(FadeOut|EndDemo)$/.test(b.action)).length, music: g.audio.musicState,
    ended: !!g.story?.ended, uiBlocking: !!g.ui?.blocking, locked: !!g.player?.inputLocked, blackout: !!g.ui?.isFaded };
}, { zone, secs });
console.log(JSON.stringify(r, null, 1));
if (r.chains.length < Number(arg('min', 6))) fail(`сцен-цепочек за прогон ${r.chains.length} < ${arg('min', 6)} — сцены не запускаются`);
if (r.withAudio !== r.lines) fail(`у ${r.lines - r.withAudio} реплик нет записи`);
if (r.overlap.length) fail(`реплики наложились: ${r.overlap.join(',')}`);
if (r.endActions) fail('в StoryBeats остались FadeOut/EndDemo');
if (r.ended || r.uiBlocking || r.locked || r.blackout) fail('управление заблокировано / экран чёрный (концовка?)');
if (r.noPos > 0 && zone !== 'start') console.log(`внимание: ${r.noPos} реплик без позиции (будут моно/2D)`);
await browser.close();
if (errors.length) { console.error(`ОШИБКИ (${errors.length}):\n` + [...new Set(errors)].slice(0, 20).join('\n')); bad++; }
console.log(bad ? `VO SCENES: FAIL (${bad})` : 'VO SCENES: PASS');
process.exit(bad ? 1 : 0);
