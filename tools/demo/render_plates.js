// Usage: node render_plates.js <outdir> [plate...]  — paints the demo background plates to PNG (with alpha).
const fs = require('fs'), path = require('path');
const { chromium } = require(process.env.PWPATH || 'playwright');
(async () => {
  const out = process.argv[2]; const want = process.argv.slice(3);
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', e => console.error('pageerror:', e.message));
  page.on('console', m => { if (m.type() === 'error') console.error('console:', m.text()); });
  await page.goto('file://' + path.resolve(__dirname, 'render_plates.html'));
  const names = want.length ? want : await page.evaluate(() => Object.keys(PLATES));
  const metaPath = path.join(out, 'plates.json');
  const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : {};
  for (const n of names) {
    const t = Date.now();
    const img = await page.evaluate(n => renderPlate(n), n);
    fs.writeFileSync(path.join(out, n + '.png'), Buffer.from(img.split(',')[1], 'base64'));
    meta[n] = await page.evaluate(n => { const p = PLATES[n]; return { origin: p.origin, size: p.size, scale: p.scale, alpha: p.alpha }; }, n);
    console.log(n, ((Date.now() - t) / 1000).toFixed(1) + 's');
  }
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 1));
  await browser.close();
})();
