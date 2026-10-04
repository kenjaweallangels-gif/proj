// Отладка маршрута: где game.collide() срабатывает вдоль прямых от группы (какие препятствия сдвигают путь червя).
import { openGame } from './lib/harness.mjs';
const { browser, page } = await openGame({ file: 'worm.html', q: 'low', w: 320, h: 180, at: [270, 180], yaw: -1.9 });
const r = await page.evaluate(() => {
  const g = window.__rakis, V = g.THREE.Vector3, t = new V(), out = [];
  for (const hd of [0.69, 0.69 + Math.PI]) {
    const hits = [];
    for (let l = -1500; l <= 300; l += 10) {
      const x = 270 + Math.cos(hd) * l - Math.sin(hd) * -140, z = 180 + Math.sin(hd) * l + Math.cos(hd) * -140;
      t.set(x, g.heightAt(x, z), z);
      if (g.collide(t, 58, { ignore: 'worm', height: 3 })) hits.push([Math.round(x), Math.round(z)]);
    }
    out.push({ hd, n: hits.length, first: hits.slice(0, 6), last: hits.slice(-3) });
  }
  return out;
});
console.log(JSON.stringify(r));
await browser.close();
