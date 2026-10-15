// Usage: node render.js <outdir> [scene...]
const fs = require('fs'), path = require('path');
const { chromium } = require(process.env.PWPATH || 'playwright');
(async () => {
  const out = process.argv[2]; const want = process.argv.slice(3);
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', e => console.error('pageerror:', e.message));
  page.on('console', m => { if (m.type() === 'error') console.error('console:', m.text()); });
  await page.goto('file://' + path.resolve(__dirname, 'render.html'));
  const names = want.length ? want : await page.evaluate(() => Object.keys(SCENES));
  for (const n of names) {
    const t = Date.now();
    const res = await page.evaluate(n => renderScene(n), n);
    fs.writeFileSync(path.join(out, n + '.png'), Buffer.from(res.img.split(',')[1], 'base64'));
    const uiPath = path.join(out, n + '_ui.png');
    if (res.ui) fs.writeFileSync(uiPath, Buffer.from(res.ui.split(',')[1], 'base64')); else if (fs.existsSync(uiPath)) fs.unlinkSync(uiPath);
    console.log(n, ((Date.now() - t) / 1000).toFixed(1) + 's');
  }
  await browser.close();
})();
