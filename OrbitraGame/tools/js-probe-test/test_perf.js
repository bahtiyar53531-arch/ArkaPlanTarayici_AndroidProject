// Hafiflik olcumu: betiksiz / eski betik (v1.1.0) / yeni betik — ayni agir oyun sayfasinda.
// Chromium CDP Performance.getMetrics: betik suresi, stil/yerlesim hesaplari, toplam is suresi.
const { chromium, devices } = require('playwright');
const http = require('http'); const fs = require('fs');
// Kullanim: node test_perf.js <betik.js> [karsilastirilacak_eski_betik.js]
const NEW = fs.readFileSync(process.argv[2], 'utf8');
const OLD = process.argv[3] ? fs.readFileSync(process.argv[3], 'utf8') : null;
// Agir sahte oyun: tam ekran canvas + 6 pencere, her karede ~240 yazi/sayi guncellenir (HP, kredi, gorev sayaclari)
const GAME = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"></head>
<body style="margin:0;background:#000;overflow:hidden;font:12px sans-serif;color:#fff">
<canvas id="cv" style="position:fixed;left:0;top:0;width:100vw;height:100vh"></canvas>
<div id="hud" style="position:fixed;inset:0;pointer-events:none"></div>
<script>
  const hud = document.getElementById('hud');
  const spots = [['left:10px;top:32px',200,74],['left:10px;top:110px',200,86],['right:6px;top:29px',200,180],['right:160px;bottom:6px',180,150],['left:200px;bottom:4px',400,70],['left:20px;top:4px',520,24]];
  const cells = [];
  spots.forEach(([pos,w,h],k) => { const d = document.createElement('div'); d.style.cssText = 'position:absolute;'+pos+';width:'+w+'px;height:'+h+'px;background:#123a;overflow:hidden;pointer-events:auto';
    for (let i=0;i<40;i++){ const s=document.createElement('span'); s.style.cssText='display:inline-block;width:46px'; d.appendChild(s); cells.push(s);} hud.appendChild(d); });
  const cv = document.getElementById('cv'); const ctx = cv.getContext('2d');
  function resize(){ cv.width = innerWidth * devicePixelRatio; cv.height = innerHeight * devicePixelRatio; } addEventListener('resize', resize); resize();
  let n = 0;
  function loop(ts){ n++; ctx.fillStyle = 'hsl('+(n%360)+',50%,20%)'; ctx.fillRect(0,0,cv.width,cv.height);
    for (let i=0;i<cells.length;i++) cells[i].textContent = ((n*7+i*13)%100000).toLocaleString('tr-TR');
    const r = devicePixelRatio; // bazi motorlar her karede okur
    requestAnimationFrame(loop); }
  requestAnimationFrame(loop);
</script></body></html>`;
const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(GAME); });
server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  const browser = await chromium.launch();
  async function run(label, probe, pcView) {
    const ctx = await browser.newContext({ ...devices['Pixel 7 landscape'] });
    const page = await ctx.newPage();
    if (probe) {
      await page.addInitScript(() => { window.OrbitraNative = { onmessage: null, postMessage: () => {} }; });
      await page.addInitScript(probe);
    }
    await page.goto(`http://127.0.0.1:${port}/oyun`);
    await page.waitForTimeout(1500);
    if (probe) await page.evaluate((pc) => {
      window.OrbitraNative.onmessage({ data: JSON.stringify({ cmd: 'stats', on: true, browser: true }) }); // FPS gostergesi acik
      if (pc) window.OrbitraNative.onmessage({ data: JSON.stringify({ cmd: 'cfg', hudTop: 0.6 }) });     // PC gorunumu acik
    }, pcView);
    await page.waitForTimeout(1500);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Performance.enable');
    const get = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
    const a = await get(); const f0 = await page.evaluate(() => performance.now());
    await page.waitForTimeout(6000);
    const b = await get(); const f1 = await page.evaluate(() => performance.now());
    const secs = (f1 - f0) / 1000;
    const r = {
      label,
      scriptMsPerSec: ((b.ScriptDuration - a.ScriptDuration) * 1000 / secs),
      styleMsPerSec: ((b.RecalcStyleDuration - a.RecalcStyleDuration) * 1000 / secs),
      layoutMsPerSec: ((b.LayoutDuration - a.LayoutDuration) * 1000 / secs),
      taskMsPerSec: ((b.TaskDuration - a.TaskDuration) * 1000 / secs),
      heapMB: b.JSHeapUsedSize / 1048576,
    };
    await ctx.close();
    return r;
  }
  const rows = [];
  // Gurultuyu azaltmak icin her yapilandirma 2 kez, sirali
  for (let rep = 0; rep < 3; rep++) {
    rows.push(await run('Betiksiz (Chrome gibi)', null, false));
    if (OLD) rows.push(await run('Eski betik, FPS acik', OLD, false));
    rows.push(await run('Betik, FPS acik', NEW, false));
    if (OLD) rows.push(await run('Eski betik, FPS + PC gorunumu', OLD, true));
    rows.push(await run('Betik, FPS + PC gorunumu', NEW, true));
  }
  const agg = {};
  for (const r of rows) { (agg[r.label] = agg[r.label] || []).push(r); }
  console.log('Yapilandirma                              | betik ms/sn | stil ms/sn | yerlesim ms/sn | toplam is ms/sn');
  const out = {};
  for (const [k, v] of Object.entries(agg)) {
    const m = (f) => v.reduce((s, r) => s + r[f], 0) / v.length;
    out[k] = { script: m('scriptMsPerSec'), task: m('taskMsPerSec') };
    console.log(k.padEnd(42), '|', m('scriptMsPerSec').toFixed(1).padStart(10), '|', m('styleMsPerSec').toFixed(1).padStart(9), '|', m('layoutMsPerSec').toFixed(1).padStart(13), '|', m('taskMsPerSec').toFixed(1).padStart(13));
  }
  fs.writeFileSync('perf_result.json', JSON.stringify(out, null, 1));
  await browser.close(); server.close();
});
