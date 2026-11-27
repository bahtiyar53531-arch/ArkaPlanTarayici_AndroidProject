// PC gorunumu (pencere olcegi), oyun olcegi (viewport) ve render kalitesi (DPR) testleri.
const { chromium, devices } = require('playwright');
const http = require('http'); const fs = require('fs');
const PROBE = fs.readFileSync(process.argv[2], 'utf8');
const GAME = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"></head>
<body style="margin:0;background:#000;overflow:hidden">
<canvas id="cv" style="position:fixed;left:0;top:0;width:100vw;height:100vh"></canvas>
<div id="hud" style="position:fixed;inset:0;pointer-events:none">
  <div id="toolbar" style="position:absolute;left:20px;top:4px;width:520px;height:40px;background:#123;pointer-events:auto"><button id="tbtn" style="width:40px;height:36px">M</button></div>
  <div id="gemi" style="position:absolute;left:10px;top:32px;width:200px;height:74px;background:#234;pointer-events:auto"><button id="gbtn" style="margin:20px 40px;width:60px;height:30px">G</button></div>
  <div id="pet" style="position:absolute;left:10px;top:110px;width:200px;height:86px;background:#345;pointer-events:auto"></div>
  <div id="gorev" style="position:absolute;right:6px;top:29px;width:200px;height:180px;background:#456;pointer-events:auto"></div>
  <div id="drag" style="position:absolute;left:0;top:0;width:150px;height:80px;background:#567;transform:translate(560px,60px);pointer-events:auto"></div>
  <div id="pilot" style="position:absolute;right:160px;bottom:6px;width:180px;height:150px;background:#678;pointer-events:auto"></div>
  <div id="hotbar" style="position:absolute;left:50%;bottom:4px;width:400px;height:70px;margin-left:-200px;background:#789;pointer-events:auto"></div>
  <div id="joy" style="position:absolute;left:20px;bottom:30px;width:130px;height:130px;border-radius:50%;background:#89a;pointer-events:auto"></div>
  <div id="label" style="position:absolute;left:45%;top:48%;width:120px;height:40px;color:#0f0">[MMO] Pilot</div>
</div>
<input id="chat" style="position:absolute;left:20px;bottom:180px;width:200px;height:24px">
<script>
  const cv = document.getElementById('cv');
  function resize(){ cv.width = Math.round(innerWidth * devicePixelRatio); cv.height = Math.round(innerHeight * devicePixelRatio); window.resizes = (window.resizes||0)+1; }
  addEventListener('resize', resize); resize();
  (function loop(){ requestAnimationFrame(loop); })();
  window.clicked = [];
  document.addEventListener('click', e => window.clicked.push(e.target.id));
</script></body></html>`;
const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(GAME); });
server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  const browser = await chromium.launch();
  const checks = {};
  const dev = devices['Pixel 7 landscape'];
  async function open(path, embedded) {
    const ctx = await browser.newContext({ ...dev });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.addInitScript((cfg) => {
      window.__msgs = [];
      window.OrbitraNative = { onmessage: null, postMessage: (s) => window.__msgs.push(JSON.parse(s)) };
      if (cfg) window.__orbitraCfg = cfg;
    }, embedded || null);
    await page.addInitScript(PROBE);
    await page.goto(`http://127.0.0.1:${port}${path}`);
    await page.waitForTimeout(400);
    return { ctx, page, errs };
  }
  const rect = (page, id) => page.evaluate((id) => { const r = document.getElementById(id).getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }; }, id);
  const cmd = (page, o) => page.evaluate((o) => window.OrbitraNative.onmessage({ data: JSON.stringify(Object.assign({ cmd: 'cfg' }, o)) }), o);

  // ---- A) PC gorunumu: ust pencereler %60 ----
  {
    const { ctx, page, errs } = await open('/oyun');
    const vw = await page.evaluate(() => innerWidth), vh = await page.evaluate(() => innerHeight);
    const before = {}; for (const id of ['toolbar', 'gemi', 'pet', 'gorev', 'drag', 'pilot', 'hotbar', 'joy', 'label', 'cv']) before[id] = await rect(page, id);
    await cmd(page, { hudTop: 0.6, hudBottom: 1 });
    await page.waitForTimeout(500);
    const after = {}; for (const id in before) after[id] = await rect(page, id);
    const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;
    checks['gemi %60 kuculdu ve sol-ust koseye yaklasti'] = near(after.gemi.w, 120) && near(after.gemi.l, 6) && near(after.gemi.t, 19);
    checks['P.E.T. gemi penceresinin altinda kaldi (ust uste dizilim korundu)'] = after.pet.t >= after.gemi.b - 1 && near(after.pet.t, 66);
    checks['gorev takibi sag-ust koseye dogru kuculdu'] = near(after.gorev.w, 120) && near(after.gorev.r, vw - 4) && near(after.gorev.t, 17);
    checks['ust arac cubugu kuculdu'] = near(after.toolbar.w, 312);
    // translate(560,60) ile tasinmis pencere sagda: sag-ust koseye (vw,0) dogru kuculmeli
    checks['surukleme (translate) kullanan pencere de dogru kuculdu'] = near(after.drag.w, 90) && near(after.drag.l, vw + (560 - vw) * 0.6, 3) && near(after.drag.t, 36, 2);
    checks['alt kontroller degismedi (hotbar, joystick, pilot)'] = ['hotbar', 'joy', 'pilot'].every(id => JSON.stringify(after[id]) === JSON.stringify(before[id]));
    checks['ortadaki oyuncu etiketi degismedi'] = JSON.stringify(after.label) === JSON.stringify(before.label);
    checks['canvas (gemi/harita) degismedi'] = JSON.stringify(after.cv) === JSON.stringify(before.cv);
    // Kuculmus penceredeki dugmeye dokunma dogru ogeye gidiyor mu?
    const g = await rect(page, 'gbtn');
    await page.mouse.click((g.l + g.r) / 2, (g.t + g.b) / 2);
    await page.waitForTimeout(100);
    checks['kucultulmus penceredeki dugmeye dokunma calisiyor'] = (await page.evaluate(() => window.clicked)).includes('gbtn');
    const hud = (await page.evaluate(() => window.__msgs)).filter(m => m.t === 'hud').pop();
    checks['uygulanan pencere sayisi bildirildi'] = hud && hud.n >= 5;
    // Alt kontroller de %80
    await cmd(page, { hudBottom: 0.8 });
    await page.waitForTimeout(400);
    const hb = await rect(page, 'hotbar');
    checks['alt kontroller ayri olcekle kuculdu (hotbar alta ortali)'] = near(hb.w, 320) && near((hb.l + hb.r) / 2, vw / 2, 3) && near(hb.b, vh - 3, 2);
    // Kapatinca eski haline doner
    await cmd(page, { hudTop: 1, hudBottom: 1 });
    await page.waitForTimeout(400);
    const reset = {}; for (const id in before) reset[id] = await rect(page, id);
    checks['kapatinca her sey eski haline dondu'] = Object.keys(before).every(id => JSON.stringify(reset[id]) === JSON.stringify(before[id]));
    checks['A: sayfa hatasi yok'] = errs.length === 0;
    console.log('Pencereler once/sonra:', JSON.stringify({ gemi: [before.gemi, after.gemi], gorev: [before.gorev, after.gorev] }));
    await ctx.close();
  }

  // ---- B) Oyun olcegi (viewport) + render kalitesi (DPR) ----
  {
    const { ctx, page, errs } = await open('/oyun', { scale: 0.5, dprCap: 0 });
    const s = await page.evaluate(() => ({ iw: innerWidth, sc: visualViewport.scale, dpr: devicePixelRatio, cw: document.getElementById('cv').width, meta: document.querySelector('meta[name=viewport]').content }));
    const base = dev.viewport.width;
    checks['belge basinda %50 olcek: yerlesim genisligi 2 kat'] = Math.abs(s.iw - base * 2) <= 2 && Math.abs(s.sc - 0.5) < 0.01;
    checks['%50 olcekte DPR yarilandi (tuval fiziksel cozunurlukte)'] = Math.abs(s.dpr - dev.deviceScaleFactor * 0.5) < 0.01 && Math.abs(s.cw - Math.round(s.iw * s.dpr)) <= 1;
    await cmd(page, { scale: 0.3 });
    await page.waitForTimeout(400);
    const s2 = await page.evaluate(() => ({ iw: innerWidth, sc: visualViewport.scale, dpr: devicePixelRatio, cw: document.getElementById('cv').width }));
    checks['canli %30 olcek (yeni alt sinir)'] = Math.abs(s2.sc - 0.3) < 0.01 && Math.abs(s2.iw - base / 0.3) <= 3;
    checks['olcek degisince oyun tuvali yeniden boyutlandi'] = Math.abs(s2.cw - Math.round(s2.iw * s2.dpr)) <= 1;
    await cmd(page, { scale: 1, dprCap: 1.5 });
    await page.waitForTimeout(400);
    const s3 = await page.evaluate(() => ({ iw: innerWidth, dpr: devicePixelRatio, cw: document.getElementById('cv').width, meta: document.querySelector('meta[name=viewport]').content }));
    checks['%100 olcekte orijinal viewport geri yuklendi'] = s3.iw === base && s3.meta.startsWith('width=device-width, initial-scale=1, maximum-scale=1');
    checks['render kalitesi sinirlamasi (DPR 1.5) uygulandi'] = s3.dpr === 1.5 && s3.cw === Math.round(base * 1.5);
    await cmd(page, { scale: 1.4, vw: base });
    await page.waitForTimeout(400);
    const s4 = await page.evaluate(() => ({ iw: innerWidth, sc: visualViewport.scale }));
    checks['yakinlastirma %140 calisiyor'] = Math.abs(s4.sc - 1.4) < 0.02 && Math.abs(s4.iw - base / 1.4) <= 2;
    // Klavye icin odak bildirimi
    await cmd(page, { scale: 1, dprCap: 0 });
    await page.focus('#chat');
    await page.waitForTimeout(200);
    const f = (await page.evaluate(() => window.__msgs)).filter(m => m.t === 'focus').pop();
    const cr = await rect(page, 'chat');
    checks['odaklanan yazi alaninin konumu bildirildi'] = f && Math.abs(f.bottom - cr.b) <= 1;
    checks['B: sayfa hatasi yok'] = errs.length === 0;
    await ctx.close();
  }

  // ---- C) Oyun disi sayfada hicbir sey degismez ----
  {
    const { ctx, page, errs } = await open('/login', { scale: 0.5, dprCap: 1.0, hudTop: 0.5 });
    await page.waitForTimeout(400);
    const s = await page.evaluate(() => ({ iw: innerWidth, dpr: devicePixelRatio, gemiW: document.getElementById('gemi').getBoundingClientRect().width }));
    checks['giris sayfasinda olcek/DPR/pencere degismedi'] = s.iw === dev.viewport.width && s.dpr === dev.deviceScaleFactor && Math.round(s.gemiW) === 200;
    checks['C: sayfa hatasi yok'] = errs.length === 0;
    await ctx.close();
  }

  let fail = 0;
  for (const [k, v] of Object.entries(checks)) { console.log((v ? 'GECTI ' : 'KALDI ') + k); if (!v) fail++; }
  console.log(fail === 0 ? `SONUC: TUM TESTLER GECTI (${Object.keys(checks).length})` : `SONUC: ${fail} TEST KALDI`);
  await browser.close(); server.close(); process.exit(fail ? 1 : 0);
});
