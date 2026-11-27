// ORBITRAGAME.SPACE olcum betigi testi (Chromium / Playwright)
const { chromium, devices } = require('playwright');
const http = require('http');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const PROBE = fs.readFileSync(process.argv[2], 'utf8');

const GAME = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no"></head>
<body style="margin:0;background:#000"><canvas id="c" width="300" height="300"></canvas><script>
const c = document.getElementById('c'); const gl = c.getContext('webgl2') || c.getContext('webgl');
window.gameFrames = 0; window.echoes = 0; window.wsOk = null; window.errors = [];
let t0 = performance.now();
function loop(ts){ window.gameFrames++; gl.clearColor((Math.sin(ts/300)+1)/2, 0.2, 0.5, 1); gl.clear(gl.COLOR_BUFFER_BIT); requestAnimationFrame(loop); }
const id = requestAnimationFrame(loop);
// cancelAnimationFrame uyumlulugu
const tmp = requestAnimationFrame(()=>{ window.cancelFailed = true; }); cancelAnimationFrame(tmp);
window.rafIdType = typeof id;
const ws = new WebSocket('ws://' + location.host + '/ws');
window.wsInstance = ws instanceof WebSocket; window.wsConst = WebSocket.OPEN;
class MyWS extends WebSocket {}; window.subclassOk = (new MyWS('ws://' + location.host + '/ws2')) instanceof MyWS;
ws.onopen = () => { window.wsOk = true; setInterval(()=> ws.readyState === 1 && ws.send('ping:' + Date.now()), 200); };
ws.onmessage = (e) => { if (String(e.data).startsWith('ping:')) window.echoes++; };
ws.onclose = (e) => { window.closedCode = e.code; };
</script></body></html>`;

const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(GAME); });
const wss = new WebSocketServer({ server });
let sockets = [];
wss.on('connection', (s) => { sockets.push(s); s.on('message', (m) => s.send(m.toString())); });

server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const results = {};
  async function run(withProbe) {
    const ctx = await browser.newContext({ ...devices['Pixel 7'] });
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    if (withProbe) {
      await page.addInitScript(() => {
        window.__msgs = [];
        window.OrbitraNative = { onmessage: null, postMessage: (s) => window.__msgs.push(JSON.parse(s)) };
      });
      await page.addInitScript(PROBE);
    }
    await page.goto(`http://127.0.0.1:${port}/oyun`);
    await page.waitForTimeout(3200);
    if (withProbe) await page.evaluate(() => window.OrbitraNative.onmessage({ data: JSON.stringify({ cmd: 'stats', on: true }) }));
    const f0 = await page.evaluate(() => window.gameFrames); const t0 = Date.now();
    await page.waitForTimeout(3000);
    const f1 = await page.evaluate(() => window.gameFrames); const t1 = Date.now();
    // sunucu soketleri kapatir -> close olayi bekleniyor
    sockets.forEach(s => s.close(4001, 'test')); sockets = [];
    await page.waitForTimeout(800);
    const state = await page.evaluate(() => ({ echoes: window.echoes, wsOk: window.wsOk, wsInstance: window.wsInstance, wsConst: window.wsConst,
      subclassOk: window.subclassOk, rafIdType: window.rafIdType, cancelFailed: !!window.cancelFailed, closedCode: window.closedCode, msgs: window.__msgs || [] }));
    state.realGameFps = (f1 - f0) * 1000 / (t1 - t0);
    state.pageErrors = pageErrors;
    await ctx.close();
    return state;
  }
  const base = await run(false);
  const probed = await run(true);
  const msgs = probed.msgs;
  const stats = msgs.filter(m => m.t === 'stats');
  const statsAfterOn = stats.filter(m => m.b !== undefined);
  const last = statsAfterOn.slice(-2);
  const probeGameFps = last.length ? last.reduce((a, m) => a + m.g * 1000 / m.dt, 0) / last.length : null;
  const probeBrowserFps = last.length ? last.reduce((a, m) => a + m.b * 1000 / m.dt, 0) / last.length : null;
  const ws = msgs.filter(m => m.t === 'ws');
  const checks = {
    'oyun davranisi degismedi (WS yanki sayisi > 0)': probed.echoes > 0 && base.echoes > 0,
    'oyun FPS (proba olmadan / ile) yakin': Math.abs(base.realGameFps - probed.realGameFps) / base.realGameFps < 0.15,
    'proba Oyun FPS dogru (±10%)': probeGameFps !== null && Math.abs(probeGameFps - probed.realGameFps) / probed.realGameFps < 0.10,
    'Tarayici FPS raporlaniyor': probeBrowserFps !== null && probeBrowserFps > 0,
    'hello mesaji': msgs.some(m => m.t === 'hello' && m.top === true),
    'ready mesaji (canvas + kareler)': msgs.some(m => m.t === 'ready'),
    'WS create/open/close bildirildi': ['create', 'open', 'close'].every(e => ws.some(m => m.e === e)),
    'WS host/port dogru': ws.some(m => m.e === 'create' && m.host === '127.0.0.1' && m.port === port),
    'WS close kodu iletildi (4001)': ws.some(m => m.e === 'close' && m.code === 4001),
    'instanceof WebSocket korunuyor': probed.wsInstance === true,
    'WebSocket.OPEN sabiti korunuyor': probed.wsConst === 1,
    'WebSocket alt sinifi calisiyor': probed.subclassOk === true,
    'rAF id sayi donuyor': probed.rafIdType === 'number',
    'cancelAnimationFrame calisiyor': probed.cancelFailed === false,
    'sayfa hatasi yok': probed.pageErrors.length === 0,
  };
  console.log(JSON.stringify({ baseFps: base.realGameFps.toFixed(1), probedFps: probed.realGameFps.toFixed(1), probeGameFps: probeGameFps && probeGameFps.toFixed(1), probeBrowserFps: probeBrowserFps && probeBrowserFps.toFixed(1), echoes: [base.echoes, probed.echoes], wsEvents: ws.length, errors: probed.pageErrors }, null, 0));
  let fail = 0;
  for (const [k, v] of Object.entries(checks)) { console.log((v ? 'GECTI ' : 'KALDI ') + k); if (!v) fail++; }
  console.log(fail === 0 ? 'SONUC: TUM TESTLER GECTI' : `SONUC: ${fail} TEST KALDI`);
  await browser.close(); server.close(); process.exit(fail ? 1 : 0);
});
