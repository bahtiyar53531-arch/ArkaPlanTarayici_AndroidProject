#!/usr/bin/env node
/**
 * Türk Orbit — tek port sunucusu (nginx olmayan ortamlar için: GitHub Codespaces, Termux, basit VPS).
 *
 *   /            → apps/client/dist      (oyun sitesi; SPA: bilinmeyen yollar index.html)
 *   /yonetim/    → apps/admin/dist       (Yönetim Merkezi)
 *   /api/...     → API (varsayılan 127.0.0.1:4000)
 *   /game        → oyun sunucusu WebSocket (varsayılan 127.0.0.1:4001)
 *
 * nginx örneğiyle (infra/nginx/turkorbit.conf.example) aynı yerleşim; yalnızca Node çekirdek modülleri kullanılır.
 * Ortam: PORT (8080), HOST (0.0.0.0), API_TARGET (127.0.0.1:4000), GAME_TARGET (127.0.0.1:4001)
 * Kullanım: npm run build && node scripts/tek-port-sunucu.mjs
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';
const [API_HOST, API_PORT] = (process.env.API_TARGET ?? '127.0.0.1:4000').split(':');
const [GAME_HOST, GAME_PORT] = (process.env.GAME_TARGET ?? '127.0.0.1:4001').split(':');
const SITES = [
  { prefix: '/yonetim/', dir: path.join(ROOT, 'apps/admin/dist') },
  { prefix: '/', dir: path.join(ROOT, 'apps/client/dist') },
];
for (const s of SITES) {
  if (!existsSync(path.join(s.dir, 'index.html'))) {
    console.error(`✖ ${path.relative(ROOT, s.dir)}/index.html yok. Önce "npm run build" çalıştır.`);
    process.exit(1);
  }
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

/** İstemcinin gerçek adresi: önündeki vekil (ör. Codespaces) X-Forwarded-For eklediyse ona eklenir. */
function forwardedHeaders(req) {
  const prior = req.headers['x-forwarded-for'];
  const ip = req.socket.remoteAddress ?? '';
  return {
    'x-forwarded-for': prior ? `${prior}, ${ip}` : ip,
    'x-forwarded-proto': req.headers['x-forwarded-proto'] ?? (req.socket.encrypted ? 'https' : 'http'),
    'x-forwarded-host': req.headers['x-forwarded-host'] ?? req.headers.host ?? '',
  };
}

function proxyHttp(req, res) {
  const upstream = http.request(
    { host: API_HOST, port: Number(API_PORT), method: req.method, path: req.url, headers: { ...req.headers, ...forwardedHeaders(req) } },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'API sunucusuna ulaşılamadı. Biraz sonra tekrar dene.' } }));
  });
  req.pipe(upstream);
}

function serveStatic(req, res) {
  const url = new URL(req.url ?? '/', 'http://x');
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  // /yonetim (eğik çizgisiz) → /yonetim/
  if (pathname === '/yonetim') {
    res.writeHead(301, { Location: '/yonetim/' }).end();
    return;
  }
  const site = SITES.find((s) => pathname.startsWith(s.prefix));
  const rel = pathname.slice(site.prefix.length);
  const file = path.resolve(site.dir, '.' + path.sep + rel);
  // Klasör dışına çıkma (../) engeli
  if (file !== site.dir && !file.startsWith(site.dir + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  let target = file;
  let isFile = false;
  try {
    isFile = statSync(target).isFile();
  } catch {
    /* yok */
  }
  const ext = path.extname(target).toLowerCase();
  if (!isFile) {
    // SPA: uzantısız yollar (ör. /oyna, /yonetim/oyuncular) index.html'e düşer; eksik dosya 404
    if (ext && ext !== '.html') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS }).end('Bulunamadı');
      return;
    }
    target = path.join(site.dir, 'index.html');
  }
  const type = TYPES[path.extname(target).toLowerCase()] ?? 'application/octet-stream';
  const immutable = rel.startsWith('assets/');
  res.writeHead(200, {
    'Content-Type': type,
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    ...SECURITY_HEADERS,
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(target).pipe(res);
}

const server = http.createServer((req, res) => {
  if (req.url?.startsWith('/api/')) return proxyHttp(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  serveStatic(req, res);
});

// Oyun sunucusu: WebSocket yükseltmesi ham TCP olarak aktarılır
server.on('upgrade', (req, socket, head) => {
  const pathname = (req.url ?? '').split('?')[0];
  if (pathname !== '/game') {
    socket.destroy();
    return;
  }
  const upstream = net.connect(Number(GAME_PORT), GAME_HOST, () => {
    const headers = { ...req.headers, ...forwardedHeaders(req) };
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (const [k, v] of Object.entries(headers)) {
      if (v === undefined) continue;
      for (const one of Array.isArray(v) ? v : [v]) lines.push(`${k}: ${one}`);
    }
    upstream.write(lines.join('\r\n') + '\r\n\r\n');
    if (head?.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  const close = () => {
    socket.destroy();
    upstream.destroy();
  };
  upstream.on('error', close);
  socket.on('error', close);
});

server.listen(PORT, HOST, () => {
  console.log(`✔ Türk Orbit tek port sunucusu: http://${HOST}:${PORT} (API → ${API_HOST}:${API_PORT}, oyun → ${GAME_HOST}:${GAME_PORT})`);
});
