// Kullanim: node render.js <w> <h> <mode> <outDir> <fps> <loopSec> [onlyTimesCSV]
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const [w, h, mode, out, fps, loop, only] = process.argv.slice(2);
const ROOT = __dirname;
const types = { '.html': 'text/html', '.js': 'text/javascript' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
});
server.listen(0, '127.0.0.1', async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.log('PAGEERR', e.message));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('CONSOLE', m.text().slice(0, 300)); });
  await page.goto(`http://127.0.0.1:${server.address().port}/scene.html?w=${w}&h=${h}&mode=${mode}&loop=${loop}`);
  await page.waitForFunction(() => window.sceneReady === true, null, { timeout: 120000 });
  const total = Math.round(+fps * +loop);
  const frames = only ? only.split(',').map(Number) : [...Array(total).keys()];
  const t0 = Date.now();
  for (const f of frames) {
    const t = f / +fps;
    const data = await page.evaluate((t) => { window.renderAt(t); return document.querySelector('canvas').toDataURL(window.location.search.includes('mode=logo') ? 'image/png' : 'image/jpeg', 0.95); }, t);
    const ext = data.startsWith('data:image/png') ? 'png' : 'jpg';
    fs.writeFileSync(path.join(out, `f${String(f).padStart(4, '0')}.${ext}`), Buffer.from(data.split(',')[1], 'base64'));
    if (f % 20 === 0) console.log(`kare ${f}/${total} (${((Date.now() - t0) / 1000).toFixed(0)} sn)`);
  }
  await browser.close(); server.close();
});
