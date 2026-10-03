// Итоговая проверка интеграции: точки маршрута, меню погоды с реальным модулем, ночь, буря, харвестер.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const out = new URL('../dist/shots/final_check/', import.meta.url).pathname; mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 960, height: 540 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e))); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto(`file://${new URL('../dist/rakis_demo.html', import.meta.url).pathname}?autotest=1&q=low&lang=RU`);
await p.waitForFunction(() => window.__rakis?.realTime > 1.5, null, { timeout: 240000 });
const shot = async (name, fn, wait = 2500) => { await p.evaluate(fn); await p.waitForTimeout(wait); await p.screenshot({ path: out + name + '.png' }); console.log(name, JSON.stringify(await p.evaluate(() => ({ h: window.__rakis.weather?.hours?.toFixed?.(1), w: window.__rakis.weather?.current, zone: window.__rakis.zone })))); };
await shot('start_dawn', () => {});
await shot('p2_harvester_run', () => { const g = window.__rakis; g.debug.goto('P2'); const h = g.harvester; const it = g.interactables.find((i) => i.tag === 'Rakis.Harvester'); it?.onInteract?.(); }, 6000);
await shot('panel', () => { const g = window.__rakis; g.ui?.openWeather?.() ?? g.ui?.weatherPanel?.open?.() ?? window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F2' })); });
await shot('night', () => { const g = window.__rakis; window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F2' })); g.weather.setHours(22.5); g.weather.snap?.(); }, 3000);
await shot('storm', () => { const g = window.__rakis; g.weather.setHours(13); g.weather.setOverride({ storm: 1, wind: 25, dust: 1 }, 0.1); g.weather.snap?.(); }, 3000);
console.log('errors', errs.length ? errs.slice(0, 8) : 'none');
await b.close();
