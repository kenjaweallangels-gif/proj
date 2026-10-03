// Проверка озвучки Ред. 2: банк записей (assets/vo.js), декодирование в OfflineAudioContext (RMS/пик/длительность), покрытие реплик,
// синхронность субтитров с аудио, живое воспроизведение через game.audio.voice, отсутствие «вечного» гула (уровень фона в тишине).
// node tools/vo_test.mjs [--file=vo.html] [--wav]   → dist/shots/vo/*.wav (с --wav)
import { chromium } from 'playwright';
import { mkdirSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const file = arg('file', 'vo.html');
const wav = process.argv.includes('--wav');
const out = join(root, 'dist', 'shots', 'vo');
mkdirSync(out, { recursive: true });
const findChromium = () => {
  const base = '/opt/pw-browsers';
  if (!existsSync(base)) return undefined;
  const d = readdirSync(base).find((n) => /^chromium-\d+$/.test(n));
  return d ? join(base, d, 'chrome-linux', 'chrome') : undefined;
};
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const errors = [];
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`file://${join(root, 'dist', file)}?q=low&autotest=1`);
await page.waitForFunction(() => window.__rakis && window.__rakis.realTime > 1, null, { timeout: 240000, polling: 500 });

let bad = 0;
const fail = (m) => { console.error('FAIL:', m); bad++; };

// 1. банк + декодирование
const SAMPLE = ['DLG_A1_001', 'DLG_A1_002', 'DLG_A2_RIDER_01', 'DLG_B5_P01', 'DLG_B5_021', 'DLG_B2_M32', 'DLG_B2_K10', 'DLG_C1_G01'];
const res = await page.evaluate(async (sample) => {
  const g = window.__rakis;
  g.settings.voiceForce = true; g.settings.voiceMode = 'auto'; g.settings.voice = true;
  g.audio.resume();
  await new Promise((r) => setTimeout(r, 600));
  const v = g.audio.voice;
  if (!v?.bank) return { error: 'нет g.audio.voice.bank (аудио-граф не собран)' };
  const bank = v.bank;
  const OAC = window.OfflineAudioContext;
  const octx = new OAC(1, 24000, 24000);
  const rows = [], wavs = [];
  for (const id of sample) {
    const buf = await bank.decode(octx, id);
    if (!buf) { rows.push({ id, error: 'не декодируется / нет записи' }); continue; }
    const d = buf.getChannelData(0);
    let sum = 0, pk = 0;
    for (let i = 0; i < d.length; i++) { sum += d[i] * d[i]; pk = Math.max(pk, Math.abs(d[i])); }
    const db = (x) => (x > 1e-9 ? 20 * Math.log10(x) : -180);
    rows.push({ id, dur: +buf.duration.toFixed(2), tableDur: bank.duration(id), rms: +db(Math.sqrt(sum / d.length)).toFixed(1), peak: +db(pk).toFixed(1) });
    wavs.push({ id, sr: buf.sampleRate, data: Array.from(d, (x) => Math.round(Math.max(-1, Math.min(1, x)) * 32767)) });
  }
  // покрытие: каждая озвучиваемая реплика таблицы имеет запись
  const missing = [];
  let voiced = 0;
  for (const r of Object.values(g.data.Dialogue)) {
    if (r.speaker === 'Lore' || !r.nativeScript) continue;
    voiced++;
    if (!bank.has(r.id)) missing.push(r.id);
  }
  const barks = ['Trader', 'Artisan', 'WaterCarrier', 'Child', 'Guard', 'Pilgrim', 'Elder', 'Weaver'].map((a) => [a, bank.barkCount(a)]);
  return { rows, wavs, missing, voiced, count: bank.count(), barks };
}, SAMPLE);
if (res.error) { console.error(res.error); await browser.close(); process.exit(1); }
console.table(res.rows);
console.log(`банк: ${res.count} записей, озвучиваемых реплик в таблице ${res.voiced}, без записи: ${res.missing.length} ${res.missing.slice(0, 8).join(',')}`);
console.log('лай (клипов на архетип):', JSON.stringify(res.barks));
for (const r of res.rows) {
  if (r.error) { fail(`${r.id}: ${r.error}`); continue; }
  if (r.rms < -34 || r.rms > -10) fail(`${r.id}: странный RMS ${r.rms} dBFS`);
  if (r.peak > -0.5) fail(`${r.id}: клиппинг, пик ${r.peak}`);
  if (Math.abs(r.dur - r.tableDur) > 0.35) fail(`${r.id}: длительность файла ${r.dur} ≠ таблица ${r.tableDur}`);
}
if (res.missing.length) fail(`нет записей для ${res.missing.length} реплик`);
for (const [a, n] of res.barks) if (n < 3) fail(`мало лая для ${a}: ${n}`);
if (wav) for (const w of res.wavs) {
  const n = w.data.length, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(w.sr, 24); buf.writeUInt32LE(w.sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  w.data.forEach((v, k) => buf.writeInt16LE(v, 44 + k * 2));
  writeFileSync(join(out, `${w.id}.wav`), buf);
}

// 2. живое воспроизведение: субтитр синхронен записи, голос идёт из банка, уровень на выходе не нулевой
const live = await page.evaluate(async () => {
  const g = window.__rakis;
  const events = [];
  g.bus.on('subtitle', (e) => { if (e.kind === 'line') events.push({ id: e.id, duration: e.duration, audio: e.audio, chain: e.chain }); });
  g.dialogue.stopAll?.();
  g.dialogue.play('DLG_A1_001');
  const t0 = performance.now();
  let maxRms = -120, usedClip = false, speaker = null;
  while (performance.now() - t0 < 2800) {
    await new Promise((r) => setTimeout(r, 100));
    const v = g.audio.voice;
    if (v.usingRecording && v.current?.clip) usedClip = true;
    speaker = v.speaker || speaker;
    maxRms = Math.max(maxRms, g.audio.level().rms);
  }
  return { events, maxRms, usedClip, speaker, bank: g.audio.voice.bank.duration('DLG_A1_001') };
});
console.log('живое воспроизведение:', JSON.stringify(live));
if (!live.events.length) fail('субтитр не вышел');
else {
  const e = live.events[0];
  if (!e.audio) fail('субтитр без признака аудио');
  if (Math.abs(e.duration - (live.bank + 0.4)) > 0.05) fail(`длительность субтитра ${e.duration} ≠ аудио ${live.bank}+0.4`);
}
if (!live.usedClip) fail('реплика не воспроизводится из банка (ушла на синтезатор?)');
if (live.maxRms < -55) fail(`на выходе тишина (${live.maxRms} dBFS) — голос не слышен`);

// 3. фон без «вечного» гула: без музыки (она тональная) на старте, в эрге и в сиетче нет подкладки 20–90 Гц,
//    а sfx (рокот червя, харвестер) в тишине — практически ноль; рядом с настоящим червём рокот есть.
const bed = await page.evaluate(async () => {
  const g = window.__rakis;
  g.settings.voiceMode = 'off';
  g.dialogue.stopAll?.();
  const an = g.audio.engine, ctx = an.ctx;
  const hz = ctx.sampleRate / 2 / 8192;
  const measure = async () => {
    const saved = { ...g.settings.volume };
    for (const k of ['music', 'vo']) an.setVolume(k, 0);
    const a = ctx.createAnalyser(); a.fftSize = 16384; a.smoothingTimeConstant = 0.9; an.out.connect(a);
    await new Promise((r) => setTimeout(r, 1500));
    const f = new Float32Array(a.frequencyBinCount); a.getFloatFrequencyData(f);
    const band = (lo, hi) => { let s = 0; for (let i = Math.floor(lo / hz); i <= Math.ceil(hi / hz); i++) s += Math.pow(10, f[i] / 10); return +(10 * Math.log10(s)).toFixed(1); };
    const t = new Float32Array(2048); a.getFloatTimeDomainData(t); let q = 0; for (const v of t) q += v * v;
    an.out.disconnect(a);
    for (const k of Object.keys(saved)) an.setVolume(k, saved[k]);
    return { sub: band(20, 90), low: band(90, 200), mid: band(300, 3000), rms: +(10 * Math.log10(q / t.length + 1e-12)).toFixed(1) };
  };
  const res = {};
  for (const pt of ['start', 'erg', 'sietch']) {
    g.debug?.goto?.(pt);
    await new Promise((r) => setTimeout(r, 3500));
    res[pt] = { ...(await measure()), worm: g.worm?.state, space: g.space };
  }
  g.debug?.goto?.('worm');
  await new Promise((r) => setTimeout(r, 4000));
  res.nearWorm = { ...(await measure()), worm: g.worm?.state };
  return res;
});
console.log('фон без музыки:', JSON.stringify(bed));
for (const pt of ['start', 'erg', 'sietch']) {
  const b = bed[pt];
  if (b.sub > b.mid + 6 && b.sub > -80) fail(`${pt}: подкладка 20–90 Гц (${b.sub} дБ) выше средних (${b.mid} дБ) — гул`);
  if (b.rms > -24) fail(`${pt}: фон слишком громкий без музыки (${b.rms} dB)`);
}
if (bed.erg.worm === 'Dormant' && bed.erg.rms > -34) fail(`erg: червь спит, а фон ${bed.erg.rms} dB — гул не должен звучать`);

await browser.close();
if (errors.length) { console.error(`ОШИБКИ (${errors.length}):\n` + [...new Set(errors)].slice(0, 20).join('\n')); bad++; }
console.log(bad ? `VO TEST: FAIL (${bad})` : 'VO TEST: PASS');
process.exit(bad ? 1 : 0);
