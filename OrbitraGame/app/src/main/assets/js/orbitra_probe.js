/*
 * ORBITRAGAME.SPACE olcum betigi (yalnizca GOZLEM).
 * - Oyunun kodunu, menulerini, dokunmatik kontrollerini veya ag trafigini DEGISTIRMEZ.
 * - requestAnimationFrame ve WebSocket'i seffaf (pass-through) sarmalar:
 *     * oyunun cizdigi kare sayisini sayar (Oyun FPS),
 *     * oyun soketlerinin acildi/kapandi durumunu bildirir (baglanti durumu, ping hedefi).
 * - Yalnizca orbitragame.space kaynaklarinda calisir (Android tarafinda kaynak kisitlamasi).
 * - Veriler yalnizca uygulamanin kendisine (OrbitraNative) gonderilir, disari gonderilmez.
 */
(function () {
  'use strict';
  try {
    if (window.__orbitraProbeInstalled) return;
    Object.defineProperty(window, '__orbitraProbeInstalled', { value: true, enumerable: false });
  } catch (e) { return; }

  var bridge = window.OrbitraNative;
  if (!bridge || typeof bridge.postMessage !== 'function') return;

  var isTop = false;
  try { isTop = window === window.top; } catch (e) { isTop = false; }
  var frameTag = Math.random().toString(36).slice(2, 7);

  function send(o) {
    try { bridge.postMessage(JSON.stringify(o)); } catch (e) { /* yoksay */ }
  }

  var now = (window.performance && performance.now) ? function () { return performance.now(); } : Date.now;
  var origRAF = window.requestAnimationFrame;

  // ---- 1) Oyun FPS: oyunun rAF geri cagrilarinin calistigi farkli kare sayisi ----
  var gameFrames = 0, lastGameTs = -1;
  if (typeof origRAF === 'function') {
    var wrappedRAF = function requestAnimationFrame(cb) {
      if (typeof cb !== 'function') return origRAF.call(window, cb);
      return origRAF.call(window, function (ts) {
        if (ts !== lastGameTs) { lastGameTs = ts; gameFrames++; }
        return cb(ts);
      });
    };
    try {
      Object.defineProperty(wrappedRAF, 'toString', { value: function () { return origRAF.toString(); } });
    } catch (e) { }
    window.requestAnimationFrame = wrappedRAF;
  }

  // ---- 2) Tarayici FPS: yalnizca panel acikken calisan kendi rAF dongumuz ----
  var browserFrames = 0, browserLoopOn = false;
  function browserLoop() {
    if (!browserLoopOn) return;
    browserFrames++;
    origRAF.call(window, browserLoop);
  }
  function setBrowserLoop(on) {
    if (on === browserLoopOn || typeof origRAF !== 'function') return;
    browserLoopOn = on;
    if (on) origRAF.call(window, browserLoop);
  }

  // ---- 3) WebSocket gozlemi (seffaf Proxy) ----
  var OWS = window.WebSocket;
  if (typeof OWS === 'function' && typeof Proxy === 'function' && typeof Reflect === 'object') {
    var seq = 0;
    try {
      window.WebSocket = new Proxy(OWS, {
        construct: function (target, args, newTarget) {
          var ws = Reflect.construct(target, args, newTarget);
          try {
            var id = frameTag + '-' + (++seq);
            var u = new URL(ws.url, location.href);
            var port = u.port ? parseInt(u.port, 10) : (u.protocol === 'wss:' ? 443 : 80);
            send({ t: 'ws', e: 'create', id: id, host: u.hostname, port: port });
            ws.addEventListener('open', function () { send({ t: 'ws', e: 'open', id: id }); });
            ws.addEventListener('close', function (ev) { send({ t: 'ws', e: 'close', id: id, code: ev.code }); });
          } catch (e) { }
          return ws;
        }
      });
    } catch (e) { }
  }

  // ---- 4) Uygulamadan gelen komutlar ----
  var statsOn = false, readySent = false;
  bridge.onmessage = function (ev) {
    try {
      var m = JSON.parse(ev.data);
      if (m.cmd === 'stats') { statsOn = !!m.on; setBrowserLoop(statsOn && isTop); }
    } catch (e) { }
  };

  // ---- 5) Saniyelik rapor ----
  var lastTick = now(), lastGame = 0, lastBrowser = 0, tick = 0;
  setInterval(function () {
    var t = now(), dt = t - lastTick; lastTick = t; tick++;
    var g = gameFrames - lastGame, b = browserFrames - lastBrowser;
    lastGame = gameFrames; lastBrowser = browserFrames;

    // "Oyun hazir" sinyali: bir tuval var ve oyun art arda kare ciziyor.
    if (!readySent && g >= 10 && document.querySelector('canvas')) {
      readySent = true;
      send({ t: 'ready', top: isTop });
    }
    if (statsOn || !readySent) {
      var msg = { t: 'stats', dt: Math.round(dt), g: g, top: isTop, vis: document.visibilityState };
      if (isTop && browserLoopOn) msg.b = b;
      if (isTop && tick % 5 === 0 && window.performance && performance.memory) {
        msg.heap = Math.round(performance.memory.usedJSHeapSize / 1048576);
      }
      send(msg);
    }
  }, 1000);

  send({ t: 'hello', top: isTop });
})();
