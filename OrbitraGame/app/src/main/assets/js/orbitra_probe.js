/*
 * ORBITRAGAME.SPACE sayfa betigi (hafif surum).
 *
 * Tasarim ilkesi: oyunun her karesinde neredeyse SIFIR ek is.
 *   - Kare sayaci: requestAnimationFrame cagrisi basina tek karsilastirma, bellek ayirma yok.
 *   - devicePixelRatio: degeri onbellekte tutulur (oyun her karede okusa bile maliyetsiz).
 *   - PC gorunumu: oyunun sayfa agaci SUREKLI izlenmez; tarama yalnizca tarayici bostayken
 *     (requestIdleCallback) ve yalnizca pencere kaplari degistiginde yapilir.
 *   - WebSocket: yalnizca acilis/kapanis olaylari gozlenir; trafige dokunulmaz.
 *
 * Kullanici acarsa:
 *   - Oyun olcegi (tarayicinin kendi sayfa olcegi), render kalitesi (devicePixelRatio siniri),
 *     PC gorunumu (yalnizca arayuz pencereleri kucultulur; canvas/gemi/harita DEGISMEZ).
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
  function num(v, def, min, max) { v = Number(v); return isFinite(v) ? Math.min(max, Math.max(min, v)) : def; }
  function mergeCfg(o) {
    if ('scale' in o) cfg.scale = num(o.scale, 1, 0.2, 3);
    if ('vw' in o) cfg.vw = num(o.vw, 0, 0, 10000);
    if ('dprCap' in o) cfg.dprCap = num(o.dprCap, 0, 0, 8);
    if ('hudTop' in o) cfg.hudTop = num(o.hudTop, 1, 0.3, 1);
    if ('hudBottom' in o) cfg.hudBottom = num(o.hudBottom, 1, 0.3, 1);
  }
  try {
    var embedded = window.__orbitraCfg;
    if (embedded && typeof embedded === 'object') mergeCfg(embedded);
    delete window.__orbitraCfg;
  } catch (e) { }

  function send(o) {
    try { bridge.postMessage(JSON.stringify(o)); } catch (e) { /* yoksay */ }
  }

  // Oyun sayfasinda miyiz? (her cagrida location okumamak icin onbellek; saniyede bir tazelenir)
  var gamePath = false;
  function refreshGamePath() {
    var p = '';
    try { p = window.top.location.pathname; } catch (e) { p = location.pathname; }
    gamePath = p === '/oyun' || p.indexOf('/oyun/') === 0;
  }
  refreshGamePath();

  var now = (window.performance && performance.now) ? function () { return performance.now(); } : Date.now;
  var origRAF = window.requestAnimationFrame;

  // =====================================================================
  // 1) Render kalitesi: devicePixelRatio (onbellekli)
  // =====================================================================
  var dprDesc = null;
  try { dprDesc = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio') || Object.getOwnPropertyDescriptor(Window.prototype, 'devicePixelRatio'); } catch (e) { }
  var origDpr = function () { try { return dprDesc && dprDesc.get ? dprDesc.get.call(window) : 1; } catch (e) { return 1; } };
  var cachedDpr = 1;
  function computeDpr() {
    var o = origDpr();
    if (!gamePath) return o;
    var d = o * cfg.scale;                 // sayfa olcegi: CSS pikseli basina fiziksel piksel
    if (cfg.dprCap > 0) d = Math.min(d, cfg.dprCap);
    d = Math.max(0.5, d);
    return Math.abs(d - o) < 0.01 ? o : Math.round(d * 1000) / 1000;
  }
  function refreshDpr() { var old = cachedDpr; cachedDpr = computeDpr(); return Math.abs(old - cachedDpr) > 0.001; }
  refreshDpr();
  if (dprDesc && dprDesc.get && dprDesc.configurable !== false) {
    try {
      Object.defineProperty(window, 'devicePixelRatio', {
        configurable: true, enumerable: true,
        get: function () { return gamePath ? cachedDpr : origDpr(); },
        set: function (v) { Object.defineProperty(window, 'devicePixelRatio', { value: v, writable: true, configurable: true, enumerable: true }); }
      });
    } catch (e) { }
  }

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
    var meta = document.querySelector('meta[name="viewport"]');
    var s = cfg.scale;
    if (!gamePath || Math.abs(s - 1) < 0.001) {
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
  function onMetaChanged(meta) {
    if (applyingVp) return;
    if (meta.hasAttribute(VP_ATTR) && meta.getAttribute('content') !== viewportContent(cfg.scale)) {
      meta.setAttribute(VP_ATTR, meta.getAttribute('content') || ''); // oyun kendi degerini degistirdi
    }
    applyViewport();
  }
  if (isTop) {
    try {
      // Yalnizca sayfa yuklenirken: viewport etiketi ayristirilinca yakala.
      var vpObserver = new MutationObserver(function (list) {
        if (applyingVp) return;
        for (var i = 0; i < list.length; i++) {
          var m = list[i];
          if (m.type === 'attributes') { if (m.target.getAttribute && m.target.getAttribute('name') === 'viewport') { onMetaChanged(m.target); return; } continue; }
          for (var j = 0; j < m.addedNodes.length; j++) {
            var n = m.addedNodes[j];
            if (n.nodeType === 1 && (n.tagName === 'META' || n.tagName === 'HEAD')) { applyViewport(); return; }
          }
        }
      });
      vpObserver.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['content'] });
      document.addEventListener('DOMContentLoaded', function () {
        applyViewport();
        setTimeout(function () {
          vpObserver.disconnect(); // yukleme bitti: agac izleme biter
          var meta = document.querySelector('meta[name="viewport"]');
          if (meta) try { new MutationObserver(function () { onMetaChanged(meta); }).observe(meta, { attributes: true, attributeFilter: ['content'] }); } catch (e) { }
        }, 0);
      });
    } catch (e) { }
  }

  // =====================================================================
  // 3) PC gorunumu: yalnizca arayuz pencerelerini kucult (canvas'a dokunma)
  // =====================================================================
  var hudScaled = [];          // { el, s, px, py, prevScale, prevOrigin }
  var hudPending = false, hudLastCount = -1;
  var hudContainers = [];      // izlenen pencere kaplari (yalnizca dogrudan cocuk eklenip cikarilmasi)
  var hudObserver = null;
  var idle = window.requestIdleCallback
    ? function (fn) { window.requestIdleCallback(fn, { timeout: 500 }); }
    : function (fn) { setTimeout(fn, 120); };

  function hudEnabled() { return gamePath && (cfg.hudTop < 0.999 || cfg.hudBottom < 0.999); }
  function findHud(el) { for (var i = 0; i < hudScaled.length; i++) if (hudScaled[i].el === el) return hudScaled[i]; return null; }
  function unscale(rec) {
    try { rec.el.style.scale = rec.prevScale; rec.el.style.transformOrigin = rec.prevOrigin; } catch (e) { }
  }
  function stopHudWatch() {
    if (hudObserver) hudObserver.disconnect();
    hudContainers = [];
  }
  function clearHud() {
    for (var i = 0; i < hudScaled.length; i++) unscale(hudScaled[i]);
    hudScaled = [];
    stopHudWatch();
  }
  function watchContainers(list) {
    // Yalnizca kaplarin DOGRUDAN cocuklari izlenir (alt agac degil): pencere icindeki
    // yazi/sayi degisiklikleri hicbir is tetiklemez.
    var same = list.length === hudContainers.length && list.every(function (c, i) { return c === hudContainers[i]; });
    if (same) return;
    if (!hudObserver) {
      try { hudObserver = new MutationObserver(function () { scheduleHud(); }); } catch (e) { return; }
    }
    hudObserver.disconnect();
    hudContainers = list;
    for (var i = 0; i < list.length; i++) try { hudObserver.observe(list[i], { childList: true }); } catch (e) { }
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
    hudPending = false;
    if (!hudEnabled()) { if (hudScaled.length || hudContainers.length) clearHud(); reportHud(0); return; }
    var vw = window.innerWidth, vh = window.innerHeight, area = vw * vh;
    if (!vw || !vh || !document.body) return;
    var keep = [], containers = [document.body];
    var visit = function (parent, depth) {
      var kids = parent.children, hadCandidate = false;
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
        var r = c.getBoundingClientRect();
        var l = r.left, tp = r.top, rr = r.right, bb = r.bottom;
        if (rec) { // olceksiz dikdortgen
          l = rec.px + (l - rec.px) / rec.s; rr = rec.px + (rr - rec.px) / rec.s;
          tp = rec.py + (tp - rec.py) / rec.s; bb = rec.py + (bb - rec.py) / rec.s;
        }
        var cx = (l + rr) / 2 / vw, cy = (tp + bb) / 2 / vh;
        // Ekranin ortasindaki ogeler (gemi/oyuncu adlari, odul yazilari) dokunulmaz.
        if (cx > 0.3 && cx < 0.7 && cy > 0.22 && cy < 0.78) { if (rec) unscale(rec); continue; }
        hadCandidate = true;
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
      if (hadCandidate && parent !== document.body && containers.indexOf(parent) < 0 && containers.length < 24) containers.push(parent);
    };
    visit(document.body, 0);
    for (var k = 0; k < hudScaled.length; k++) if (keep.indexOf(hudScaled[k]) < 0) unscale(hudScaled[k]);
    hudScaled = keep;
    watchContainers(containers);
    reportHud(keep.length);
  }
  function reportHud(n) {
    if (n !== hudLastCount) { hudLastCount = n; send({ t: 'hud', n: n, top: isTop }); }
  }
  function scheduleHud() {
    if (hudPending) return;
    hudPending = true;
    idle(scanHud);
  }
  window.addEventListener('resize', function () {
    if (refreshDpr()) { /* oyun kendi resize isleyicisinde yeni degeri okur */ }
    if (hudEnabled() || hudScaled.length) scheduleHud();
  });

  // =====================================================================
  // 4) Oyun FPS: oyunun kare istedigi farkli karelerin sayisi (bellek ayirmaz)
  // =====================================================================
  var gameFrames = 0, lastFrameTime = -2;
  var timeline = document.timeline || null;
  if (typeof origRAF === 'function') {
    var wrappedRAF = function requestAnimationFrame(cb) {
      var t = timeline ? timeline.currentTime : -1;
      if (t !== lastFrameTime || t === -1) { lastFrameTime = t; gameFrames++; }
      return origRAF.call(window, cb);
    };
    try { Object.defineProperty(wrappedRAF, 'toString', { value: function () { return origRAF.toString(); } }); } catch (e) { }
    window.requestAnimationFrame = wrappedRAF;
  }

  // =====================================================================
  // 5) WebSocket gozlemi (seffaf Proxy; yalnizca acilis/kapanis)
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
      if (m.cmd === 'stats') statsOn = !!m.on;
      else if (m.cmd === 'cfg') {
        mergeCfg(m);
        hudLastCount = -1; // ayar degisti: tarama sonucunu her durumda bildir
        refreshGamePath();
        applyViewport();
        if (refreshDpr()) {
          // Oyun tuvalini yeni cozunurlukle yeniden boyutlandirsin
          setTimeout(function () { try { window.dispatchEvent(new Event('resize')); } catch (e) { } }, 0);
        }
        scheduleHud();
      } else if (m.cmd === 'focus?') reportFocus();
    } catch (e) { }
  };

  // =====================================================================
  // 8) Saniyelik hafif rapor
  // =====================================================================
  var lastTick = now(), lastGame = 0, tick = 0;
  setInterval(function () {
    var t = now(), dt = t - lastTick; lastTick = t; tick++;
    var g = gameFrames - lastGame;
    lastGame = gameFrames;
    if ((tick & 1) === 0) refreshGamePath();
    if (!readySent && g >= 10 && document.querySelector('canvas')) {
      readySent = true;
      send({ t: 'ready', top: isTop });
    }
    if (statsOn || !readySent) send({ t: 'stats', dt: Math.round(dt), g: g, top: isTop });
    if (hudEnabled() && tick % 3 === 0) scheduleHud(); // gizlenip acilan pencereler icin seyrek tazeleme
  }, 1000);

  if (isTop && document.readyState !== 'loading') applyViewport();
  send({ t: 'hello', top: isTop });
})();
