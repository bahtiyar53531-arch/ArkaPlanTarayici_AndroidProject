/*
 * ORBITRAGAME.SPACE sayfa betigi.
 *
 * Varsayilan olarak yalnizca GOZLEM yapar:
 *   - requestAnimationFrame ve WebSocket seffaf sarmalanir (Oyun FPS, soket durumu).
 *   - Odaklanan yazi alaninin konumu bildirilir (klavye acilinca ekrani kaydirmak icin).
 *
 * Kullanici acikca isterse (uygulama menusunden):
 *   - Oyun olcegi: tarayicinin kendi sayfa olcegi (viewport) ile yakinlastirma/uzaklastirma.
 *   - Render kalitesi: oyunun gordugu devicePixelRatio sinirlanir (daha az piksel = daha yuksek FPS).
 *   - PC gorunumu: yalnizca arayuz pencereleri (HTML kutular) kose/kenarlarina dogru kucultulur;
 *     oyunun cizim alani (canvas: gemi, harita) DEGISMEZ.
 *
 * Yalnizca orbitragame.space kaynaklarinda calisir. Veriler yalnizca uygulamaya gider.
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

  // ---- Yapilandirma (uygulama belge basinda gomer, sonra canli gunceller) ----
  var cfg = { scale: 1, vw: 0, dprCap: 0, hudTop: 1, hudBottom: 1 };
  try {
    var embedded = window.__orbitraCfg;
    if (embedded && typeof embedded === 'object') mergeCfg(embedded);
    delete window.__orbitraCfg;
  } catch (e) { }

  function num(v, def, min, max) { v = Number(v); return isFinite(v) ? Math.min(max, Math.max(min, v)) : def; }
  function mergeCfg(o) {
    if ('scale' in o) cfg.scale = num(o.scale, 1, 0.2, 3);
    if ('vw' in o) cfg.vw = num(o.vw, 0, 0, 10000);
    if ('dprCap' in o) cfg.dprCap = num(o.dprCap, 0, 0, 8);
    if ('hudTop' in o) cfg.hudTop = num(o.hudTop, 1, 0.3, 1);
    if ('hudBottom' in o) cfg.hudBottom = num(o.hudBottom, 1, 0.3, 1);
  }

  function send(o) {
    try { bridge.postMessage(JSON.stringify(o)); } catch (e) { /* yoksay */ }
  }

  function isGamePath() {
    var p = '';
    try { p = window.top.location.pathname; } catch (e) { p = location.pathname; }
    return p === '/oyun' || p.indexOf('/oyun/') === 0;
  }

  var now = (window.performance && performance.now) ? function () { return performance.now(); } : Date.now;
  var origRAF = window.requestAnimationFrame;

  // =====================================================================
  // 1) Render kalitesi: devicePixelRatio
  // =====================================================================
  var dprDesc = null;
  try { dprDesc = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio') || Object.getOwnPropertyDescriptor(Window.prototype, 'devicePixelRatio'); } catch (e) { }
  var origDpr = function () { try { return dprDesc && dprDesc.get ? dprDesc.get.call(window) : 1; } catch (e) { return 1; } };
  function effectiveDpr() {
    var o = origDpr();
    if (!isGamePath()) return o;
    var d = o * cfg.scale;                 // sayfa olcegi: CSS pikseli basina fiziksel piksel
    if (cfg.dprCap > 0) d = Math.min(d, cfg.dprCap);
    d = Math.max(0.5, d);
    return Math.abs(d - o) < 0.01 ? o : Math.round(d * 1000) / 1000;
  }
  if (dprDesc && dprDesc.get && dprDesc.configurable !== false) {
    try {
      Object.defineProperty(window, 'devicePixelRatio', {
        configurable: true, enumerable: true,
        get: function () { return effectiveDpr(); },
        set: function (v) { /* [Replaceable] davranisi korunur */ Object.defineProperty(window, 'devicePixelRatio', { value: v, writable: true, configurable: true, enumerable: true }); }
      });
    } catch (e) { }
  }
  var lastDpr = effectiveDpr();

  // =====================================================================
  // 2) Oyun olcegi: tarayicinin kendi sayfa olcegi (yalnizca ust cerceve)
  // =====================================================================
  var VP_ATTR = 'data-orbitra-orig';
  var applyingVp = false;
  function viewportContent(s) {
    var r = function (x) { return Math.round(x * 1000) / 1000; };
    var lim = 'initial-scale=' + r(s) + ', minimum-scale=' + r(s) + ', maximum-scale=' + r(s) + ', user-scalable=no, viewport-fit=cover';
    if (s <= 1) return 'width=device-width, ' + lim;
    var vw = cfg.vw > 0 ? cfg.vw : (screen.width || 400);
    return 'width=' + Math.max(100, Math.round(vw / s)) + ', ' + lim;
  }
  function applyViewport() {
    if (!isTop || !document.documentElement) return;
    var game = isGamePath();
    var meta = document.querySelector('meta[name="viewport"]');
    var s = cfg.scale;
    var neutral = !game || Math.abs(s - 1) < 0.001;
    if (neutral) {
      if (meta && meta.hasAttribute(VP_ATTR)) {
        applyingVp = true;
        meta.setAttribute('content', meta.getAttribute(VP_ATTR));
        meta.removeAttribute(VP_ATTR);
        applyingVp = false;
      }
      return;
    }
    if (!meta) {
      if (!document.head) return;
      meta = document.createElement('meta');
      meta.setAttribute('name', 'viewport');
      meta.setAttribute(VP_ATTR, '');
      document.head.appendChild(meta);
    }
    if (!meta.hasAttribute(VP_ATTR)) meta.setAttribute(VP_ATTR, meta.getAttribute('content') || '');
    var c = viewportContent(s);
    if (meta.getAttribute('content') !== c) {
      applyingVp = true;
      meta.setAttribute('content', c);
      applyingVp = false;
    }
  }
  if (isTop) {
    // Sayfanin viewport etiketi ayristirilinca veya oyun degistirince tekrar uygula.
    try {
      var vpObserver = new MutationObserver(function (list) {
        if (applyingVp) return;
        for (var i = 0; i < list.length; i++) {
          var m = list[i];
          if (m.type === 'attributes' && m.target.getAttribute && m.target.getAttribute('name') === 'viewport') {
            // Oyun kendi viewport'unu degistirdi: yeni degeri "orijinal" kabul et.
            if (m.target.hasAttribute(VP_ATTR) && m.target.getAttribute('content') !== viewportContent(cfg.scale)) {
              m.target.setAttribute(VP_ATTR, m.target.getAttribute('content') || '');
            }
            applyViewport(); return;
          }
          if (m.type === 'childList') {
            for (var j = 0; j < m.addedNodes.length; j++) {
              var n = m.addedNodes[j];
              if (n.nodeType === 1 && (n.tagName === 'META' || n.tagName === 'HEAD')) { applyViewport(); return; }
            }
          }
        }
      });
      vpObserver.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['content'] });
      document.addEventListener('DOMContentLoaded', function () { applyViewport(); setTimeout(function () { vpObserver.disconnect(); watchMetaOnly(); }, 0); });
    } catch (e) { }
  }
  function watchMetaOnly() {
    // Yukleme bittikten sonra yalnizca viewport etiketini izle (performans).
    var meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return;
    try {
      new MutationObserver(function () {
        if (applyingVp) return;
        if (meta.hasAttribute(VP_ATTR) && meta.getAttribute('content') !== viewportContent(cfg.scale)) meta.setAttribute(VP_ATTR, meta.getAttribute('content') || '');
        applyViewport();
      }).observe(meta, { attributes: true, attributeFilter: ['content'] });
    } catch (e) { }
  }

  // =====================================================================
  // 3) PC gorunumu: yalnizca arayuz pencerelerini kucult (canvas'a dokunma)
  // =====================================================================
  var hudScaled = [];          // { el, s, px, py, prevScale, prevOrigin }
  var hudTimer = 0, hudLastCount = -1;
  function hudEnabled() { return isGamePath() && (cfg.hudTop < 0.999 || cfg.hudBottom < 0.999); }
  function findHud(el) { for (var i = 0; i < hudScaled.length; i++) if (hudScaled[i].el === el) return hudScaled[i]; return null; }
  function unscale(rec) {
    try { rec.el.style.scale = rec.prevScale; rec.el.style.transformOrigin = rec.prevOrigin; } catch (e) { }
  }
  function clearHud() {
    for (var i = 0; i < hudScaled.length; i++) unscale(hudScaled[i]);
    hudScaled = [];
  }
  function gameTranslate(cs) {
    // Oyunun kendi transform'u yalnizca oteleme ise (pencere surukleme) degerini dondur; degilse null.
    var t = cs.transform;
    if (!t || t === 'none') return [0, 0];
    var m = t.match(/^matrix\(([^)]+)\)$/);
    if (!m) return null;
    var v = m[1].split(',').map(Number);
    if (Math.abs(v[0] - 1) > 0.001 || Math.abs(v[3] - 1) > 0.001 || Math.abs(v[1]) > 0.001 || Math.abs(v[2]) > 0.001) return null;
    return [v[4], v[5]];
  }
  function scanHud() {
    hudTimer = 0;
    if (!hudEnabled()) { if (hudScaled.length) clearHud(); reportHud(0); return; }
    var vw = window.innerWidth, vh = window.innerHeight, area = vw * vh;
    if (!vw || !vh || !document.body) return;
    var keep = [];
    var visit = function (parent, depth) {
      var kids = parent.children;
      for (var i = 0; i < kids.length; i++) {
        var c = kids[i], tag = c.tagName;
        if (tag === 'CANVAS' || tag === 'VIDEO' || tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK' || tag === 'META' || tag === 'IFRAME' || tag === 'NOSCRIPT') continue;
        var w = c.offsetWidth, h = c.offsetHeight;
        if (w === undefined) continue; // SVG vb.
        if (!w || !h) { if (depth < 12 && c.children.length) visit(c, depth + 1); continue; }
        var big = (w * h > area * 0.4) || (w > vw * 0.92 && h > vh * 0.5);
        if (big || (c.querySelector && c.querySelector('canvas,iframe,video'))) { if (depth < 12) visit(c, depth + 1); continue; }
        if (w < 40 || h < 28) continue;
        var cs = getComputedStyle(c);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'sticky') continue;
        var rec = findHud(c);
        if (!rec && cs.scale && cs.scale !== 'none') continue;   // oyun kendi olcegini kullaniyor
        var t = gameTranslate(cs);
        if (!t) { if (rec) unscale(rec); continue; }
        // Olceksiz gorunur dikdortgen
        var r = c.getBoundingClientRect();
        var l = r.left, tp = r.top, rr = r.right, bb = r.bottom;
        if (rec) {
          l = rec.px + (l - rec.px) / rec.s; rr = rec.px + (rr - rec.px) / rec.s;
          tp = rec.py + (tp - rec.py) / rec.s; bb = rec.py + (bb - rec.py) / rec.s;
        }
        var cx = (l + rr) / 2 / vw, cy = (tp + bb) / 2 / vh;
        // Ekranin ortasindaki ogeler (gemi/oyuncu adlari, odul yazilari) dokunulmaz.
        if (cx > 0.3 && cx < 0.7 && cy > 0.22 && cy < 0.78) { if (rec) unscale(rec); continue; }
        // Ekranin ust ceyreginde baslayan pencere ust gruptadir (uzun yan paneller dahil).
        var top = tp < vh * 0.25 || cy < 0.5;
        var s = top ? cfg.hudTop : cfg.hudBottom;
        if (s >= 0.999) { if (rec) unscale(rec); continue; }
        var nearL = l < vw * 0.12, nearR = rr > vw * 0.88;
        var px = (nearL && nearR) ? vw / 2 : nearL ? 0 : nearR ? vw : (cx < 0.35 ? 0 : cx > 0.65 ? vw : vw / 2);
        var py = top ? 0 : vh;
        // transform-origin (oge yerel koordinati) = P - U + t  (U: olceksiz sol-ust, t: oyunun otelemesi)
        var ox = px - l + t[0], oy = py - tp + t[1];
        if (!rec) rec = { el: c, prevScale: c.style.scale || '', prevOrigin: c.style.transformOrigin || '' };
        rec.s = s; rec.px = px; rec.py = py;
        var origin = Math.round(ox) + 'px ' + Math.round(oy) + 'px';
        if (c.style.scale !== String(s)) c.style.scale = String(s);
        if (c.style.transformOrigin !== origin) c.style.transformOrigin = origin;
        keep.push(rec);
      }
    };
    visit(document.body, 0);
    for (var k = 0; k < hudScaled.length; k++) if (keep.indexOf(hudScaled[k]) < 0) unscale(hudScaled[k]);
    hudScaled = keep;
    reportHud(keep.length);
  }
  function reportHud(n) {
    if (n !== hudLastCount) { hudLastCount = n; send({ t: 'hud', n: n, top: isTop }); }
  }
  function scheduleHud(delay) {
    if (hudTimer) return;
    hudTimer = setTimeout(scanHud, delay || 300);
  }
  try {
    var hudObserver = new MutationObserver(function () { if (hudEnabled() || hudScaled.length) scheduleHud(400); });
    var startHudObserver = function () { if (document.body) hudObserver.observe(document.body, { childList: true, subtree: true }); };
    if (document.body) startHudObserver(); else document.addEventListener('DOMContentLoaded', startHudObserver);
  } catch (e) { }
  window.addEventListener('resize', function () { if (hudEnabled() || hudScaled.length) { clearTimeout(hudTimer); hudTimer = 0; scheduleHud(150); } });

  // =====================================================================
  // 4) Oyun FPS: oyunun rAF geri cagrilarinin calistigi farkli kare sayisi
  // =====================================================================
  var gameFrames = 0, lastGameTs = -1;
  if (typeof origRAF === 'function') {
    var wrappedRAF = function requestAnimationFrame(cb) {
      if (typeof cb !== 'function') return origRAF.call(window, cb);
      return origRAF.call(window, function (ts) {
        if (ts !== lastGameTs) { lastGameTs = ts; gameFrames++; }
        return cb(ts);
      });
    };
    try { Object.defineProperty(wrappedRAF, 'toString', { value: function () { return origRAF.toString(); } }); } catch (e) { }
    window.requestAnimationFrame = wrappedRAF;
  }

  // Tarayici FPS: yalnizca panel acikken calisan kendi rAF dongumuz
  var browserFrames = 0, browserLoopOn = false;
  function browserLoop() { if (!browserLoopOn) return; browserFrames++; origRAF.call(window, browserLoop); }
  function setBrowserLoop(on) {
    if (on === browserLoopOn || typeof origRAF !== 'function') return;
    browserLoopOn = on;
    if (on) origRAF.call(window, browserLoop);
  }

  // =====================================================================
  // 5) WebSocket gozlemi (seffaf Proxy)
  // =====================================================================
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

  // =====================================================================
  // 6) Klavye: odaklanan yazi alaninin konumu (ust cerceve koordinatinda, CSS px)
  // =====================================================================
  function isEditable(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    var t = el.tagName;
    if (t === 'TEXTAREA') return true;
    if (t !== 'INPUT') return false;
    var ty = (el.type || 'text').toLowerCase();
    return ['button', 'checkbox', 'radio', 'range', 'color', 'file', 'image', 'submit', 'reset', 'hidden'].indexOf(ty) < 0;
  }
  function reportFocus() {
    var el = document.activeElement;
    if (!isEditable(el)) return;
    try {
      var r = el.getBoundingClientRect(), y0 = r.top, y1 = r.bottom, w = window;
      while (w !== w.top && w.frameElement) { var fr = w.frameElement.getBoundingClientRect(); y0 += fr.top; y1 += fr.top; w = w.parent; }
      send({ t: 'focus', top: Math.round(y0), bottom: Math.round(y1) });
    } catch (e) { }
  }
  document.addEventListener('focusin', function () { setTimeout(reportFocus, 50); }, true);
  document.addEventListener('focusout', function () {
    setTimeout(function () { if (!isEditable(document.activeElement)) send({ t: 'blur' }); }, 80);
  }, true);

  // =====================================================================
  // 7) Uygulamadan gelen komutlar
  // =====================================================================
  var statsOn = false, readySent = false;
  bridge.onmessage = function (ev) {
    try {
      var m = JSON.parse(ev.data);
      if (m.cmd === 'stats') { statsOn = !!m.on; setBrowserLoop(!!m.browser && isTop); }
      else if (m.cmd === 'cfg') {
        mergeCfg(m);
        applyViewport();
        var d = effectiveDpr();
        if (Math.abs(d - lastDpr) > 0.001) {
          lastDpr = d;
          // Oyun tuvalini yeni cozunurlukle yeniden boyutlandirsin
          setTimeout(function () { try { window.dispatchEvent(new Event('resize')); } catch (e) { } }, 0);
        }
        clearTimeout(hudTimer); hudTimer = 0; scheduleHud(30);
      } else if (m.cmd === 'focus?') reportFocus();
    } catch (e) { }
  };

  // =====================================================================
  // 8) Saniyelik rapor
  // =====================================================================
  var lastTick = now(), lastGame = 0, lastBrowser = 0, tick = 0;
  setInterval(function () {
    var t = now(), dt = t - lastTick; lastTick = t; tick++;
    var g = gameFrames - lastGame, b = browserFrames - lastBrowser;
    lastGame = gameFrames; lastBrowser = browserFrames;
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
    if (hudEnabled() && tick % 2 === 0) scheduleHud(10); // pencere tasima/acma sonrasi capa noktalarini tazele
  }, 1000);

  if (isTop) {
    if (document.readyState !== 'loading') applyViewport();
  }
  send({ t: 'hello', top: isTop });
})();
