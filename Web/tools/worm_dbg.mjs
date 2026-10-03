// Отладка без снимков: ставит стадию встречи (--stage=arrive --sec=3) или сценарий пожирания (--devour=33 — шагнуть до t секунд) и печатает результат --eval="выражение".
// node tools/worm_dbg.mjs --devour=33 --eval="window.__rakis.worm.devourDirector.vortex.mesh.visible"
import { openGame, arg } from './lib/harness.mjs';

const { browser, page, errors } = await openGame({ file: arg('file', 'worm.html'), q: arg('q', 'low'), w: 480, h: 270, gl: arg('gl', 'swiftshader'), hideSubs: true, at: [270, 180], yaw: -1.9 });
if (arg('devour', '')) {
  await page.evaluate((t) => { window.__rakis.worm.playDevour(); window.__step(t, 1 / 30); }, Number(arg('devour', 33)));
} else {
  await page.evaluate(([stage, sec]) => { const w = window.__rakis.worm; w.debugEncounter({ stage }); if (sec > 0) window.__step(sec, 1 / 30); }, [arg('stage', 'arrive'), Number(arg('sec', 3))]);
}
const out = await page.evaluate((code) => { try { return JSON.stringify(eval(code), null, 1); } catch (e) { return 'ERR ' + e.message; } }, arg('eval', '1'));
console.log(out);
await browser.close();
const uniq = [...new Set(errors)];
if (uniq.length) console.error(uniq.join('\n'));
