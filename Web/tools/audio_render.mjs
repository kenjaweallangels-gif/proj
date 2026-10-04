// Запись звука сцен из настоящей игры (headless Chromium, AudioContext без устройства вывода) в float32-WAV для анализа.
// node tools/audio_render.mjs [--file=index.html] [--out=DIR] [--scenes=desert,sietch,...] [--sec=14]
// Затем: python3 ../Tools/sfx/sfx_analyze.py DIR/*.wav  — RMS/peak, доля энергии ниже 60 Гц, тональность НЧ, щелчки.
// Снимает выход шины out (после лимитера) через ScriptProcessor. Музыка/голос отключены (Silence), меряется SFX + ambience.
import { chromium } from 'playwright';
import { readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d);
const findChromium = () => {
  const base = '/opt/pw-browsers';
  if (!existsSync(base)) return undefined;
  const d = readdirSync(base).find((n) => /^chromium-\d+$/.test(n));
  return d ? join(base, d, 'chrome-linux', 'chrome') : undefined;
};
const outDir = arg('out', join(root, 'dist', 'audio_render'));
mkdirSync(outDir, { recursive: true });
const want = (arg('scenes', '') || '').split(',').filter(Boolean);
const file = arg('file', 'index.html');
const sec = Number(arg('sec', 14));

// Сцены: setup выполняется в странице (g = game, a = game.audio), tl — события по времени (сек от начала записи).
const FOOT = (surface, gait, speed, sw) => `(()=>{window.__gait=${JSON.stringify(gait)};window.__spd=${speed};window.__sw=${sw};g.bus.emit('footstep',{x:g.player.position.x,z:g.player.position.z,yaw:0,surface:'${surface}',actor:'player'});})()`;
const steps = (surface, gait, speed, sw, t0, dt, n) => Array.from({ length: n }, (_, i) => [t0 + i * dt, FOOT(surface, gait, speed, sw)]);
const SCENES = {
  desert: { setup: "g.space='desert';g.zone='A2_Erg';g.weather.windSpeed=5;g.weather.storm=0", sec: 17,
    tl: [...steps('sand', 'sandwalk', 2, true, 1, 0.62, 6), ...steps('sand', 'walk', 3.2, false, 5, 0.5, 6), ...steps('sand', 'run', 6, false, 8.2, 0.32, 8),
      [11.5, "g.bus.emit('desert:gust',{strength:0.8,speed:7})"], [13, "g.bus.emit('desert:sandslide',{x:g.player.position.x+20,z:g.player.position.z+10,intensity:0.7})"],
      [14.2, "g.bus.emit('desert:distantthump',{x:g.player.position.x+1500,z:g.player.position.z,dist:1500})"], [11, "g.bus.emit('jump',{x:g.player.position.x,z:g.player.position.z})"], [11.8, "g.bus.emit('land',{x:g.player.position.x,y:0,z:g.player.position.z,impact:6,surface:'sand'})"]] },
  desert_windy: { setup: "g.space='desert';g.zone='A5_Trail';g.weather.windSpeed=10;g.weather.storm=0.1", sec: 12,
    tl: [...steps('rock', 'walk', 3.2, false, 2, 0.5, 6), ...steps('packed', 'walk', 3.2, false, 6, 0.5, 4)] },
  sietch: { setup: "g.space='sietch';g.zone='B2_Gallery';g.sietch&&(g.sietch.openings=[{x:1e5,y:0,z:1e5,kind:'desert'}])", sec: 16,
    tl: [...steps('stone', 'walk', 3.2, false, 2, 0.5, 6), [6, "a.event('Door.SealHiss',{x:g.player.position.x+4,y:g.player.position.y+1,z:g.player.position.z})"], [9, "a.event('Water.Drip',{x:g.player.position.x+3,y:0,z:g.player.position.z})"], [10, "a.event('Loom.Clack',{x:g.player.position.x+5,y:0,z:g.player.position.z})"]] },
  cistern: { setup: "g.space='sietch';g.zone='B4_Cistern';g.sietch&&(g.sietch.openings=[{x:1e5,y:0,z:1e5,kind:'desert'}])", sec: 14, tl: [] },
  garden: { setup: "g.space='desert';g.zone='C1_Garden';g.bus.emit('garden:enter',{});g.weather.windSpeed=2;g.weather.storm=0;g.weather.hours!==undefined&&(g.weather.hours=12)", sec: 16, tl: steps('sand', 'walk', 3, false, 3, 0.5, 6) },
  harvester: { setup: "g.space='desert';g.zone='A2_Erg';g.weather.windSpeed=3;(()=>{const H=g.harvester.H;g.player.teleport(H.x+45,g.heightAt(H.x+45,H.z),H.z,0);g.harvester.debugSet('running');})()", sec: 20, skip: 6, tl: [] },
  harvester_in: { setup: "g.space='desert';g.zone='A2_Erg';g.weather.windSpeed=3;(()=>{const H=g.harvester.H;g.player.teleport(H.x+10,g.heightAt(H.x+10,H.z),H.z,0);g.harvester.debugSet('running');H.occupied=true;})()", sec: 20, skip: 6, tl: [] },
  worm_approach: { setup: "g.space='desert';g.zone='A2_Erg';g.weather.windSpeed=4;(()=>{const w=g.worm;w.resting=false;w.state='Approach';w.threat=0.8;const h=w.headPos;g.player.teleport(h.x+60,g.heightAt(h.x+60,h.z),h.z,0);})()", sec: 16, skip: 3, tl: [] },
  worm_breach: { setup: "g.space='desert';g.zone='A2_Erg';g.weather.windSpeed=4;g.worm.state='Dormant';g.worm.threat=0", sec: 16, tl: [[1, "g.bus.emit('worm:breach',{x:g.player.position.x+45,z:g.player.position.z+20})"]] },
  devour: { setup: "g.space='desert';g.zone='A2_Erg';g.weather.windSpeed=4;(()=>{const H=g.harvester.H;g.player.teleport(H.x+80,g.heightAt(H.x+80,H.z),H.z,0);})()", sec: 24,
    tl: [[1, "g.bus.emit('worm:devour',{phase:'wormsign',duration:7})"], [8.5, "g.bus.emit('worm:devour',{phase:'klaxon'})"], [9, "g.bus.emit('worm:devour',{phase:'carryall',duration:6})"], [15.5, "g.bus.emit('worm:devour',{phase:'swallow'})"], [19, "g.bus.emit('worm:devour',{phase:'debris',duration:4})"]] },
  thumper_ui: { setup: "g.space='desert';g.zone='A2_Erg';g.weather.windSpeed=3", sec: 8,
    tl: [[1, "g.bus.emit('thumper',{x:g.player.position.x+8,z:g.player.position.z})"], [3, "a.event('UI.Hint')"], [4, "a.event('UI.Tick')"], [4.6, "a.event('UI.Interact')"], [5.2, "a.event('UI.PhotoShutter')"], [6, "a.event('UI.Pause')"]] },
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || (m.type() === 'warning' && /audio|аудио|non-finite|NaN/i.test(m.text()))) errors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e}`));
await page.goto(`file://${file.startsWith("/") ? file : join(root, "dist", file)}?autotest=1&q=low&lang=RU`, { timeout: 300000 });
await page.waitForFunction(() => window.__rakis?.audio && window.__rakis.realTime > 1, null, { timeout: 600000 });
await page.evaluate(async () => {
  const g = window.__rakis, a = g.audio;
  a.resume(); a.setMusic('Silence');
  // игровые флаги шагов подменяем аксессорами (модуль игрока перезаписывает их каждый кадр)
  // зону и пространство закрепляем: игра пересчитывает их каждый кадр по позиции игрока; запись разрешена только из setup сцены
  for (const k of ['zone', 'space']) { let v = g[k]; Object.defineProperty(g, k, { get: () => v, set(x) { if (window.__allow) v = x; }, configurable: true }); }
  for (const [k, f] of [['gait', () => window.__gait ?? 'walk'], ['speed', () => window.__spd ?? 3], ['sandWalking', () => !!window.__sw]]) Object.defineProperty(g.player, k, { get: f, set() {}, configurable: true });
  for (let i = 0; i < 100 && !(a.engine?.samplesReady || !a.engine?.loadSamples); i++) await new Promise((r) => setTimeout(r, 100));
});
console.log('samplesReady', await page.evaluate(() => window.__rakis.audio.engine?.samplesReady));

for (const [name, sc] of Object.entries(SCENES)) {
  if (want.length && !want.includes(name)) continue;
  const total = sc.sec ?? sec;
  const res = await page.evaluate(async ([setup, tl, total]) => {
    const g = window.__rakis, a = g.audio, eng = a.engine, ctx = eng.ctx;
    // сброс состояния
    g.worm.state = 'Dormant'; g.worm.threat = 0; g.harvester.debugSet('off'); a.setMusic('Silence');
    g.harvester.H.occupied = false;
    // eslint-disable-next-line no-new-func
    window.__allow = true;
    try { new Function('g', 'a', setup)(g, a); } finally { window.__allow = false; }
    await new Promise((r) => setTimeout(r, 2500));   // прогрев: плавное смешение зон
    const L = [], Rr = [];
    const sp = ctx.createScriptProcessor(4096, 2, 2);
    sp.onaudioprocess = (e) => { L.push(new Float32Array(e.inputBuffer.getChannelData(0))); Rr.push(new Float32Array(e.inputBuffer.getChannelData(1))); };
    eng.out.connect(sp); sp.connect(ctx.destination);
    const t0 = performance.now();
    for (const [at, code] of tl) setTimeout(() => { try { new Function('g', 'a', code)(g, a); } catch (e) { console.error('scene event', e); } }, at * 1000);
    await new Promise((r) => setTimeout(r, total * 1000));
    eng.out.disconnect(sp); sp.disconnect();
    const n = L.reduce((s, c) => s + c.length, 0), buf = new Float32Array(n * 2);
    let o = 0; for (let i = 0; i < L.length; i++) for (let j = 0; j < L[i].length; j++) { buf[o++] = L[i][j]; buf[o++] = Rr[i][j]; }
    const u8 = new Uint8Array(buf.buffer); let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return { b64: btoa(s), sr: ctx.sampleRate, wall: (performance.now() - t0) / 1000, space: g.space, zone: g.zone };
  }, [sc.setup, sc.tl, total]);
  const pcm = Buffer.from(res.b64, 'base64');
  const hdr = Buffer.alloc(44);
  hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + pcm.length, 4); hdr.write('WAVEfmt ', 8); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(3, 20); hdr.writeUInt16LE(2, 22);
  hdr.writeUInt32LE(res.sr, 24); hdr.writeUInt32LE(res.sr * 8, 28); hdr.writeUInt16LE(8, 32); hdr.writeUInt16LE(32, 34); hdr.write('data', 36); hdr.writeUInt32LE(pcm.length, 40);
  writeFileSync(join(outDir, `${name}.wav`), Buffer.concat([hdr, pcm]));
  console.log(`${name}: ${(pcm.length / 8 / res.sr).toFixed(1)} с аудио за ${res.wall.toFixed(1)} с реального времени (space=${res.space} zone=${res.zone})`);
}
console.log('ошибки консоли:', errors.length ? `\n${errors.slice(0, 20).join('\n')}` : 'нет');
await browser.close();
