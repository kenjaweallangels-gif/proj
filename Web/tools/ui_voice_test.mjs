// Проверка речевого синтезатора: OfflineAudioContext-рендер реплик каждого голоса, RMS не нулевой, WAV-дамп для прослушивания/спектрограммы.
// node tools/ui_voice_test.mjs [--file=ui.html] [--wav]   → dist/shots/ui_shots/voice_*.wav
import { chromium } from 'playwright';
import { mkdirSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const file = arg('file', 'ui.html');
const wav = process.argv.includes('--wav');
const out = join(root, 'dist', 'shots', 'ui_shots');
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
await page.waitForFunction(() => window.__rakis && window.__rakis.realTime > 1, null, { timeout: 120000 });

const LINES = [
  ['Kair', 'Aʿūdh bi-l-ramli, yā ṣāḥib, lā tashī fī ṭ-ṭaqṭaq. Ash-ka ru?', 'Не шагай в такт. Песок слушает.', 3.5],
  ['Ilva', 'Rayn, ʾillā sakhatu ḥadhā al-khaṭwa, na-thel imiar.', 'Рэйн. Сбей шаг.', 3.2],
  ['Rayn', 'Kam baqiya? Kam baqiya yā Kair, qul lī!', 'Сколько ещё?', 2.8],
  ['Ossana', 'Man arsalakum? Qul, qabla an tuṣbiḥ ramlan.', 'Кто вас послал?', 3.4],
  ['Harmat', 'Antum min alladhīna bādalū al-ilāh bi-l-mā.', 'Вы пришли от тех, кто променял Бога на воду.', 6],
  ['Guard', 'Shidd al-aqniʿa. Hunā lā yuʿṭā al-mā.', 'Маски подтяни.', 3],
  ['Priestess', 'Ash-ka ru, na-thel imiar… sen-dur kaiala, vesh-ta nomu…', '[Спящий внизу]', 7],
  ['Crowd', '', 'Вода дорожает, а песок нет.', 2.6],
  ['Kair', '', 'Это сказано без родной строки: заглушка по слогам перевода?', 3.5],
];
const res = await page.evaluate(async (lines) => {
  const g = window.__rakis;
  const ro = g.audio.renderOffline;
  const rows = [];
  const wavs = [];
  for (const [speaker, native, text, duration] of lines) {
    const r = await ro({ speaker, native, text, duration });
    const d = r.buffer.getChannelData(0);
    rows.push({ speaker, fallback: r.plan.fallback, native: r.plan.native.slice(0, 40), rms: +r.rms.toFixed(1), speechRms: +r.speechRms.toFixed(1), peak: +r.peak.toFixed(1), dur: +r.plan.dur.toFixed(2), target: duration });
    wavs.push({ sr: r.buffer.sampleRate, data: Array.from(d, (v) => Math.round(Math.max(-1, Math.min(1, v * 0.9)) * 32767)) });
  }
  return { rows, wavs };
}, LINES);
console.table(res.rows);
let bad = 0;
for (const r of res.rows) if (!(r.speechRms > -45) || r.peak > 4) { console.error('FAIL', r); bad++; }
if (wav) {
  res.wavs.forEach((w, i) => {
    const n = w.data.length, buf = Buffer.alloc(44 + n * 2);
    buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
    buf.writeUInt32LE(w.sr, 24); buf.writeUInt32LE(w.sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
    w.data.forEach((v, k) => buf.writeInt16LE(v, 44 + k * 2));
    writeFileSync(join(out, `voice_${i}_${res.rows[i].speaker}.wav`), buf);
  });
}
if (process.argv.includes('--spec')) {
  const names = [0, 4, 6];
  await page.evaluate(({ wavs, names }) => {
    document.body.innerHTML = '';
    const fftMag = (re) => { // наивный DFT по 0..4 кГц (бины 40 Гц) — достаточно для картинки
      return re;
    };
    names.forEach((wi) => {
      const w = wavs[wi]; const sr = w.sr; const data = Float32Array.from(w.data, (v) => v / 32768);
      const cv = document.createElement('canvas'); cv.width = 900; cv.height = 260; cv.style.cssText = 'display:block;background:#000;margin:4px';
      document.body.appendChild(cv); document.body.style.background = '#222';
      const c = cv.getContext('2d'); const hop = Math.floor(sr * 0.006), win = Math.floor(sr * 0.025);
      const cols = Math.min(900, Math.floor((data.length - win) / hop)); const bins = 130; const fmax = 5200;
      for (let x = 0; x < cols; x++) {
        const o = x * hop;
        for (let b = 0; b < bins; b++) {
          const f = (b / bins) * fmax; let re = 0, im = 0;
          for (let k = 0; k < win; k += 2) { const hw = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / win); const v = data[o + k] * hw; const ph = (2 * Math.PI * f * k) / sr; re += v * Math.cos(ph); im -= v * Math.sin(ph); }
          const db = 20 * Math.log10(Math.hypot(re, im) / win + 1e-7);
          const L = Math.max(0, Math.min(1, (db + 95) / 55));
          c.fillStyle = `rgb(${Math.round(255 * L)},${Math.round(180 * L * L)},${Math.round(80 * (1 - L) * L * 2)})`;
          c.fillRect(x, 260 - (b / bins) * 260 - 2, 1, 2.2);
        }
      }
    });
  }, { wavs: res.wavs, names });
  await page.setViewportSize({ width: 920, height: 800 });
  await page.screenshot({ path: join(out, 'voice_spectrogram.png') });
}
console.log(errors.length ? `console errors: ${errors.length}\n${errors.join('\n')}` : 'no console errors');
await browser.close();
process.exit(bad || errors.length ? 1 : 0);
