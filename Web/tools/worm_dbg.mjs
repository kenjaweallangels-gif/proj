// Отладка без снимков: ставит стадию и печатает состояние наездников/тела (для быстрых проверок). node tools/worm_dbg.mjs --stage=arrive --sec=3 --code="..."
import { openGame, arg } from './lib/harness.mjs';

const { browser, page, errors } = await openGame({ file: arg('file', 'worm.html'), q: arg('q', 'low'), w: 480, h: 270, gl: arg('gl', 'swiftshader'), hideSubs: true });
await page.evaluate(([stage, sec]) => { const w = window.__rakis.worm; w.debugEncounter({ stage }); if (sec > 0) window.__step(sec, 1 / 30); }, [arg('stage', 'arrive'), Number(arg('sec', 3))]);
const out = await page.evaluate(() => {
  const g = window.__rakis, w = g.worm, rd = w.riders;
  const proj = (x, y, z) => { const v = new g.THREE.Vector3(x, y, z).project(g.camera); return [+v.x.toFixed(2), +v.y.toFixed(2)]; };
  return {
    exposed: w.exposed, groupVis: rd.group.visible, gearVis: w.gear.group.visible, phase: w.encounterPhase(), head: w.headPos.toArray().map((v) => +v.toFixed(0)),
    riders: rd.items.map((it) => { const e = it.root.matrix.elements; return { n: it.name, vis: it.root.visible, mode: it.mode, free: it.free, hidden: it.hidden, sNow: it.sNow, pos: [e[12], e[13], e[14]].map((v) => +v.toFixed(1)), gy: +g.heightAt(e[12], e[14]).toFixed(1), scr: proj(e[12], e[13], e[14]), hook: it.hookPole.visible }; }),
    cam: g.camera.position.toArray().map((v) => +v.toFixed(0)),
  };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
const uniq = [...new Set(errors)];
if (uniq.length) console.error(uniq.join('\n'));
