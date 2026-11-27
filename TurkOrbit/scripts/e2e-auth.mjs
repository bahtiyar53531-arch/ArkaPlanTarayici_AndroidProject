#!/usr/bin/env node
/**
 * TÜRK ORBIT — Aşama 1 + 5 + 6 + 7 + 8 uçtan uca (E2E) test
 *
 * Gerçek API sürecini başlatır, e-postaları GERÇEK SMTP üzerinden yakalar ve iki ayrı hesapla
 * (PC web oturumu + Android uygulama oturumu) tüm kayıt/giriş akışlarını HTTP üzerinden dener.
 *
 * Gereksinimler: PostgreSQL (turkorbit_e2e veritabanı), Redis.
 * Kullanım:  npm run test:e2e
 * Ortam:     E2E_DATABASE_URL, E2E_REDIS_URL, E2E_API_PORT, E2E_SMTP_PORT
 */
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';
import { WebSocket } from 'ws';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB_URL = process.env.E2E_DATABASE_URL ?? 'postgres://turkorbit:turkorbit_dev@127.0.0.1:5432/turkorbit_e2e';
const REDIS_URL = process.env.E2E_REDIS_URL ?? 'redis://127.0.0.1:6379/14';
const API_PORT = Number(process.env.E2E_API_PORT ?? 4100);
const SMTP_PORT = Number(process.env.E2E_SMTP_PORT ?? 2525);
const GAME_PORT = Number(process.env.E2E_GAME_PORT ?? 4103);
const API = `http://127.0.0.1:${API_PORT}/api/v1`;
const WEB = 'http://localhost:5173';
const PASSWORD = 'Nebula-Kartal-77';

const UA = {
  pc: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 TurkOrbitApp/0.1.0',
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
};

// ------------------------------------------------------------------ SMTP alıcısı
const inbox = [];
const smtp = new SMTPServer({
  authOptional: true,
  disabledCommands: ['STARTTLS'],
  logger: false,
  onData(stream, session, cb) {
    simpleParser(stream)
      .then((mail) => {
        for (const rcpt of session.envelope.rcptTo) inbox.push({ to: rcpt.address, subject: mail.subject, text: mail.text ?? '' });
        cb();
      })
      .catch(cb);
  },
});

async function waitForMail(to, subjectPart, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const m = [...inbox].reverse().find((x) => x.to === to && x.subject.includes(subjectPart));
    if (m) return m;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`${to} için "${subjectPart}" konulu e-posta gelmedi`);
}
const tokenOf = (mail) => mail.text.match(/token=([A-Za-z0-9_-]+)/)[1];

// ------------------------------------------------------------------ HTTP istemcisi
class Client {
  constructor(name, { ua = UA.pc, ip = '85.105.10.20', platform } = {}) {
    Object.assign(this, { name, ua, ip, platform, cookie: null, csrf: null, bearer: null });
  }
  async req(method, url, body) {
    const headers = { 'user-agent': this.ua, origin: WEB, 'x-forwarded-for': this.ip };
    if (this.platform) headers['x-client-platform'] = this.platform;
    if (this.cookie) headers.cookie = this.cookie;
    if (this.csrf && method !== 'GET') headers['x-csrf-token'] = this.csrf;
    if (this.bearer) headers.authorization = `Bearer ${this.bearer}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(API + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.getSetCookie?.() ?? [];
    for (const c of sc) {
      const [pair] = c.split(';');
      const [k, v] = pair.split('=');
      if (k.includes('to_sid')) this.cookie = v ? `${k}=${v}` : null;
    }
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* JSON değil */
    }
    return { status: res.status, json };
  }
}

// ------------------------------------------------------------------ test çerçevesi
const results = [];
async function step(name, fn) {
  const t = performance.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Math.round(performance.now() - t) });
    console.log(`  ✔ ${name}`);
  } catch (err) {
    results.push({ name, ok: false, ms: Math.round(performance.now() - t), err: err.message });
    console.log(`  ✖ ${name}\n      → ${err.message}`);
  }
}
function expect(cond, msg) {
  if (!cond) throw new Error(msg);
}

// ------------------------------------------------------------------ oyun sunucusu (WebSocket) istemcisi
class GameConn {
  constructor(ws) {
    this.ws = ws;
    this.msgs = [];
    this.closed = new Promise((r) => ws.on('close', (code) => r(code)));
    ws.on('message', (d) => this.msgs.push(JSON.parse(d.toString())));
  }
  static async open(client) {
    const t = await client.req('POST', '/game/ticket', { serverCode: 'TR1' });
    if (t.status !== 200) throw new Error(`bilet alınamadı: ${JSON.stringify(t.json)}`);
    const ws = new WebSocket(`ws://127.0.0.1:${GAME_PORT}/game`, { headers: { origin: WEB } });
    await new Promise((res, rej) => (ws.once('open', res), ws.once('error', rej)));
    const c = new GameConn(ws);
    c.send({ t: 'hello', v: 1, ticket: t.json.ticket });
    c.welcome = await c.wait('welcome');
    return c;
  }
  send(m) {
    this.ws.send(JSON.stringify(m));
  }
  async wait(t, pred = () => true, ms = 6000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const m = this.msgs.find((x) => x.t === t && pred(x));
      if (m) return m;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`"${t}" gelmedi (gelenler: ${[...new Set(this.msgs.map((x) => x.t))].join(',')})`);
  }
  last(t) {
    return [...this.msgs].reverse().find((x) => x.t === t);
  }
  async close() {
    this.ws.close();
    await this.closed;
  }
}

// ------------------------------------------------------------------ hazırlık
async function resetDb() {
  const c = new pg.Client({ connectionString: DB_URL });
  await c.connect();
  await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await c.end();
}

const env = {
  ...process.env,
  NODE_ENV: 'development',
  PORT: String(API_PORT),
  HOST: '127.0.0.1',
  LOG_LEVEL: 'warn',
  DATABASE_URL: DB_URL,
  REDIS_URL,
  PUBLIC_WEB_URL: WEB,
  ALLOWED_ORIGINS: `${WEB},capacitor://localhost`,
  TRUST_PROXY: 'loopback',
  CSRF_SECRET: 'e2e-csrf-secret-at-least-32-characters-long',
  MAIL_TRANSPORT: 'smtp',
  SMTP_URL: `smtp://127.0.0.1:${SMTP_PORT}?ignoreTLS=true`,
  GAME_PORT: String(GAME_PORT),
  GAME_LINGER_SECONDS: '0',
};

let server;
let game;
async function main() {
  console.log('TÜRK ORBIT — Aşama 1 + 5 + 6 + 7 + 8 uçtan uca test\n');
  await new Promise((r) => smtp.listen(SMTP_PORT, '127.0.0.1', r));
  await resetDb();
  const tsx = path.join(ROOT, 'node_modules/.bin/tsx');
  const mig = spawnSync(tsx, ['apps/api/src/scripts/migrate.ts'], { cwd: ROOT, env, encoding: 'utf8' });
  if (mig.status !== 0) throw new Error(`migration başarısız:\n${mig.stdout}\n${mig.stderr}`);
  console.log(mig.stdout.trim());
  const redisFlush = spawnSync('redis-cli', ['-u', REDIS_URL, 'FLUSHDB'], { encoding: 'utf8' });
  if (redisFlush.status !== 0) console.warn('Uyarı: redis-cli bulunamadı, Redis db temizlenemedi.');

  server = spawn(tsx, ['apps/api/src/index.ts'], { cwd: ROOT, env, stdio: ['ignore', 'inherit', 'inherit'] });
  game = spawn(tsx, ['apps/api/src/game/index.ts'], { cwd: ROOT, env, stdio: ['ignore', 'ignore', 'inherit'] });
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${API}/health`);
      if (r.ok) break;
    } catch {
      /* henüz açılmadı */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  console.log(`API çalışıyor: ${API}\n`);

  const pc = new Client('Pilot A (PC web)', { ua: UA.pc, ip: '85.105.10.20' });
  const app = new Client('Pilot B (Android uygulama)', { ua: UA.android, ip: '176.88.40.12', platform: 'android' });
  const aMail = 'pilot.a@ornek.com';
  const bMail = 'pilot.b@ornek.com';

  console.log('Kayıt ve e-posta doğrulama');
  await step('Sağlık kontrolü: veritabanı ve Redis bağlı', async () => {
    const r = await pc.req('GET', '/health');
    expect(r.status === 200 && r.json.database.ok && r.json.redis.ok, JSON.stringify(r.json));
  });
  await step('Kayıt isteğine rol alanı eklemek reddedilir', async () => {
    const r = await pc.req('POST', '/auth/register', { username: 'SahteAdmin1', email: 'x@ornek.com', password: PASSWORD, acceptTerms: true, role: 'super_admin' });
    expect(r.status === 400, `beklenen 400, gelen ${r.status}`);
  });
  await step('Pilot A (PC) kayıt olur, doğrulama e-postası SMTP ile gelir', async () => {
    const r = await pc.req('POST', '/auth/register', { username: 'AnadoluKartali', email: aMail, password: PASSWORD, acceptTerms: true });
    expect(r.status === 201, JSON.stringify(r.json));
    await waitForMail(aMail, 'doğrula');
  });
  await step('Pilot B (Android) kayıt olur', async () => {
    const r = await app.req('POST', '/auth/register', { username: 'GokBoru', email: bMail, password: 'Yildiz_Tozu_Avcisi_9', acceptTerms: true });
    expect(r.status === 201, JSON.stringify(r.json));
  });
  await step('İki hesap da e-posta bağlantısıyla doğrulanır', async () => {
    for (const [c, m] of [[pc, aMail], [app, bMail]]) {
      const token = tokenOf(await waitForMail(m, 'doğrula'));
      const r = await c.req('POST', '/auth/verify-email', { token });
      expect(r.status === 200, JSON.stringify(r.json));
    }
  });

  console.log('\nGiriş, oturum ve platformlar arası hesap');
  await step('Pilot A web girişi: HttpOnly çerez + CSRF anahtarı, rol yalnızca player', async () => {
    const r = await pc.req('POST', '/auth/login', { identifier: 'AnadoluKartali', password: PASSWORD });
    expect(r.status === 200 && pc.cookie && r.json.csrfToken, JSON.stringify(r.json));
    expect(JSON.stringify(r.json.user.roles) === '["player"]', `roller: ${r.json.user.roles}`);
    expect(!('sessionToken' in r.json), 'web yanıtında oturum anahtarı olmamalı');
    pc.csrf = r.json.csrfToken;
  });
  await step('Pilot B Android uygulama girişi: Bearer anahtar', async () => {
    const r = await app.req('POST', '/auth/login', { identifier: bMail, password: 'Yildiz_Tozu_Avcisi_9', transport: 'token', device: { platform: 'android', name: 'Pixel 8' } });
    expect(r.status === 200 && r.json.sessionToken && r.json.session.platform === 'android', JSON.stringify(r.json));
    app.bearer = r.json.sessionToken;
  });
  const aPhone = new Client('Pilot A (Android uygulama)', { ua: UA.android, ip: '85.105.10.77', platform: 'android' });
  await step('Aynı hesap (Pilot A) Android cihazdan da giriş yapar — tek hesap, çok platform', async () => {
    const r = await aPhone.req('POST', '/auth/login', { identifier: 'AnadoluKartali', password: PASSWORD, transport: 'token', device: { platform: 'android', name: 'Galaxy S24' } });
    expect(r.status === 200, JSON.stringify(r.json));
    aPhone.bearer = r.json.sessionToken;
    const meWeb = await pc.req('GET', '/auth/me');
    const meApp = await aPhone.req('GET', '/auth/me');
    expect(meWeb.json.user.id === meApp.json.user.id && meWeb.json.user.playerId === meApp.json.user.playerId, 'aynı kullanıcı olmalı');
  });
  await step('Pilot A aktif oturumlarında PC ve Android görünür; B\'nin oturumları görünmez', async () => {
    const r = await pc.req('GET', '/auth/sessions');
    const platforms = r.json.sessions.map((s) => s.platform).sort();
    expect(JSON.stringify(platforms) === '["android","web"]', `platformlar: ${platforms}`);
  });
  await step('CSRF anahtarı olmadan web çıkış isteği reddedilir', async () => {
    const saved = pc.csrf;
    pc.csrf = null;
    const r = await pc.req('POST', '/auth/logout', {});
    pc.csrf = saved;
    expect(r.status === 403 && r.json.error.code === 'CSRF_FAILED', JSON.stringify(r.json));
  });
  await step('PC\'den Android oturumu kapatılır → telefon anında oturumsuz kalır', async () => {
    const sessions = (await pc.req('GET', '/auth/sessions')).json.sessions;
    const target = sessions.find((s) => s.platform === 'android');
    const r = await pc.req('DELETE', `/auth/sessions/${target.id}`);
    expect(r.status === 200, JSON.stringify(r.json));
    const me = await aPhone.req('GET', '/auth/me');
    expect(me.status === 401, `beklenen 401, gelen ${me.status}`);
  });

  console.log('\nŞüpheli giriş, hız sınırı ve kilit');
  await step('Pilot A yeni cihaz + yeni ağdan (iPhone) giriş → şüpheli, e-posta bildirimi', async () => {
    const iphone = new Client('Pilot A (iPhone)', { ua: UA.iphone, ip: '198.51.100.7' });
    const r = await iphone.req('POST', '/auth/login', { identifier: 'AnadoluKartali', password: PASSWORD });
    expect(r.status === 200 && r.json.suspicious === true, JSON.stringify(r.json));
    await waitForMail(aMail, 'yeni bir cihazdan');
    const h = (await pc.req('GET', '/auth/login-history')).json.events;
    expect(h[0].suspicious && h[0].ipMasked === '198.51.*.*', JSON.stringify(h[0]));
  });
  await step('5 hatalı parola → hesap geçici kilit (429) + e-posta', async () => {
    const attacker = new Client('Saldırgan', { ip: '203.0.113.50' });
    for (let i = 0; i < 5; i++) {
      const r = await attacker.req('POST', '/auth/login', { identifier: 'GokBoru', password: `tahmin-${i}-yanlis` });
      expect(r.status === 401, `deneme ${i + 1}: ${r.status}`);
    }
    const r = await attacker.req('POST', '/auth/login', { identifier: 'GokBoru', password: 'Yildiz_Tozu_Avcisi_9' });
    expect(r.status === 429, `beklenen 429, gelen ${r.status}`);
    await waitForMail(bMail, 'başarısız giriş');
  });

  console.log('\nParola sıfırlama ve değiştirme');
  await step('Pilot B parolasını sıfırlar → eski uygulama oturumu kapanır, kilit kalkar', async () => {
    const f = await app.req('POST', '/auth/password/forgot', { email: bMail });
    expect(f.status === 202, JSON.stringify(f.json));
    const token = tokenOf(await waitForMail(bMail, 'sıfırlama'));
    const r = await app.req('POST', '/auth/password/reset', { token, newPassword: 'Yeni_Gezegen_Rotasi_42' });
    expect(r.status === 200, JSON.stringify(r.json));
    expect((await app.req('GET', '/auth/me')).status === 401, 'eski oturum kapanmalı');
    app.bearer = null;
    const login = await app.req('POST', '/auth/login', { identifier: 'GokBoru', password: 'Yeni_Gezegen_Rotasi_42', transport: 'token', device: { platform: 'android' } });
    expect(login.status === 200, JSON.stringify(login.json));
    app.bearer = login.json.sessionToken;
  });
  await step('Pilot A parolasını değiştirir → diğer oturumlar kapanır, mevcut oturum açık kalır', async () => {
    const r = await pc.req('POST', '/auth/password/change', { currentPassword: PASSWORD, newPassword: 'Kizilelma_Seferi_1071' });
    expect(r.status === 200 && r.json.revokedOtherSessions >= 1, JSON.stringify(r.json));
    expect((await pc.req('GET', '/auth/me')).status === 200, 'mevcut oturum açık kalmalı');
  });

  console.log('\nAşama 5 — pilot profili (iki hesap, iki platform)');
  await step('Pilot A (web) Kızılelma pilotu oluşturur: başlangıç paraları defterli, Kırlangıç aktif, konum K-1', async () => {
    const r = await pc.req('POST', '/players', { serverCode: 'TR1', companyCode: 'KZL' });
    expect(r.status === 201, JSON.stringify(r.json));
    const p = r.json.pilot;
    const bal = Object.fromEntries(p.currencies.map((c) => [c.code, c.balance]));
    expect(p.company.code === 'KZL' && p.map.code === 'K-1' && p.activeShip.code === 'kirlangic', JSON.stringify(p));
    expect(bal.KREDI === 25000 && bal.AKCE === 1000, JSON.stringify(bal));
    const ledger = await pc.req('GET', '/players/me/ledger?server=TR1');
    expect(ledger.json.entries.length === 2 && ledger.json.entries.every((e) => e.reason === 'starter_grant'), JSON.stringify(ledger.json));
  });
  await step('Pilot B (Android uygulama) Gökbörü pilotu oluşturur', async () => {
    const r = await app.req('POST', '/players', { serverCode: 'TR1', companyCode: 'GKB' });
    expect(r.status === 201 && r.json.pilot.map.code === 'G-1', JSON.stringify(r.json));
  });
  await step('Aynı sunucuda ikinci pilot ve istatistik yazma girişimi reddedilir', async () => {
    const dup = await pc.req('POST', '/players', { serverCode: 'TR1', companyCode: 'ALT' });
    expect(dup.status === 409 && dup.json.error.code === 'PILOT_EXISTS', JSON.stringify(dup.json));
    const cheat = await app.req('PATCH', '/players/me', { serverCode: 'TR1', motto: 'x', experience: 99999999 });
    expect(cheat.status === 400, `beklenen 400, gelen ${cheat.status}`);
  });
  await step('Pilot B sloganını uygulamadan yazar → Pilot A herkese açık profilde görür; özel bilgi sızmaz', async () => {
    const u = await app.req('PATCH', '/players/me', { serverCode: 'TR1', motto: 'Bozkırdan yıldızlara' });
    expect(u.status === 200, JSON.stringify(u.json));
    const pub = await pc.req('GET', '/pilots/TR1/GokBoru');
    expect(pub.status === 200 && pub.json.pilot.motto === 'Bozkırdan yıldızlara' && pub.json.pilot.company.code === 'GKB', JSON.stringify(pub.json));
    const text = JSON.stringify(pub.json);
    expect(!text.includes('@ornek.com') && !text.includes('currencies') && !text.includes('"map"'), 'özel bilgi sızdı: ' + text);
  });
  await step('Sunucu listesi iki pilotu sayar; şirket listesi dağılımı gösterir', async () => {
    const s = await app.req('GET', '/game/servers');
    expect(s.json.servers[0].pilotCount === 2 && s.json.servers[0].hasMyPilot === true, JSON.stringify(s.json));
    const c = await app.req('GET', '/game/companies?server=TR1');
    const counts = Object.fromEntries(c.json.companies.map((x) => [x.code, x.pilotCount]));
    expect(counts.KZL === 1 && counts.GKB === 1 && counts.ALT === 0, JSON.stringify(counts));
  });

  console.log('\nAşama 6 — hangar ve mağaza (iki hesap)');
  let aNewLaser = null;
  await step('Pilot A hangarında başlangıç kiti hazır; mağazadan OK-1 alır, aynı requestId tekrarında ücret alınmaz', async () => {
    const h = (await pc.req('GET', '/hangar?server=TR1')).json.hangar;
    expect(h.inventory.length === 5 && h.ships[0].stats[1].damagePerSecond === 40, JSON.stringify(h.ships[0].stats));
    const shop = (await pc.req('GET', '/shop?server=TR1')).json.shop;
    const offer = shop.categories.flatMap((c) => c.offers).find((o) => o.code === 'laser.ok1');
    const requestId = crypto.randomUUID();
    const r1 = await pc.req('POST', '/shop/purchase', { serverCode: 'TR1', offerId: offer.id, requestId });
    const r2 = await pc.req('POST', '/shop/purchase', { serverCode: 'TR1', offerId: offer.id, requestId });
    expect(r1.status === 200 && r2.json.purchase.replay === true, JSON.stringify([r1.json, r2.json]));
    const kredi = r2.json.currencies.find((c) => c.code === 'KREDI').balance;
    expect(kredi === 15000, `kredi ${kredi}`);
    const h2 = (await pc.req('GET', '/hangar?server=TR1')).json.hangar;
    aNewLaser = h2.inventory.find((i) => i.code === 'laser.ok1' && i.equippedIn.length === 0);
    expect(aNewLaser, 'yeni lazer envanterde yok');
  });
  await step('Pilot B, Pilot A\'nın eşyasını kendi gemisine takamaz; A\'nın gemisini yönetemez', async () => {
    const hb = (await app.req('GET', '/hangar?server=TR1')).json.hangar;
    const ha = (await pc.req('GET', '/hangar?server=TR1')).json.hangar;
    const steal = await app.req('POST', '/hangar/equip', { serverCode: 'TR1', shipId: hb.ships[0].id, loadout: 1, slotType: 'laser', slotIndex: 0, itemId: aNewLaser.id });
    expect(steal.status === 404 && steal.json.error.code === 'ITEM_NOT_FOUND', JSON.stringify(steal.json));
    const other = await app.req('POST', `/hangar/ships/${ha.ships[0].id}/activate`, { serverCode: 'TR1' });
    expect(other.status === 404 && other.json.error.code === 'SHIP_NOT_FOUND', JSON.stringify(other.json));
  });
  await step('Pilot A lazeri yükseltir (+1); Pilot B mermi satar; eşya defterleri ayrı ve doğru', async () => {
    const up = await pc.req('POST', `/hangar/items/${aNewLaser.id}/upgrade`, { serverCode: 'TR1', requestId: crypto.randomUUID() });
    expect(up.status === 200 && up.json.result.success === true && up.json.result.toLevel === 1, JSON.stringify(up.json));
    const hb = (await app.req('GET', '/hangar?server=TR1')).json.hangar;
    const ammo = hb.inventory.find((i) => i.code === 'ammo.isk1');
    const sell = await app.req('POST', `/hangar/items/${ammo.id}/sell`, { serverCode: 'TR1', quantity: 500, requestId: crypto.randomUUID() });
    expect(sell.status === 200 && sell.json.result.earned === 500, JSON.stringify(sell.json));
    const la = (await pc.req('GET', '/hangar/ledger?server=TR1')).json.entries;
    const lb = (await app.req('GET', '/hangar/ledger?server=TR1')).json.entries;
    expect(la[0].reason === 'shop_purchase' && la.every((e) => e.reason !== 'item_sell'), JSON.stringify(la.slice(0, 3)));
    expect(lb[0].reason === 'item_sell' && lb[0].delta === -500, JSON.stringify(lb.slice(0, 3)));
  });

  console.log('\nAşama 7-8 — harita ve gerçek zamanlı oyun sunucusu (iki hesap, iki platform)');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${GAME_PORT}/health`)).ok) break;
    } catch {
      /* oyun sunucusu açılıyor */
    }
    await sleep(150);
  }
  const playerOf = async (username) =>
    (await db.query(`SELECT p.id, p.pos_x, p.pos_y, m.code FROM players p JOIN users u ON u.id = p.user_id JOIN maps m ON m.id = p.map_id WHERE u.username = $1`, [username])).rows[0];
  const waitOffline = async (username) => {
    const { id } = await playerOf(username);
    for (let i = 0; i < 60; i++) {
      if (spawnSync('redis-cli', ['-u', REDIS_URL, 'EXISTS', `game:presence:${id}`], { encoding: 'utf8' }).stdout.trim() === '0') return;
      await sleep(100);
    }
    throw new Error('pilot oyundan çıkmadı');
  };
  const place = (username, x, y, mapCode) =>
    db.query(
      `UPDATE players SET pos_x = $2, pos_y = $3 ${mapCode ? `, map_id = (SELECT id FROM maps WHERE code = '${mapCode}')` : ''}
       FROM users u WHERE u.id = players.user_id AND u.username = $1`,
      [username, x, y],
    );
  let aMap = null;
  let ga = null;
  let gb = null;
  await step('Pilot A (web) K-1, Pilot B (Android) G-1 haritasında; düşman şirket haritası seviye 15 ister', async () => {
    aMap = (await pc.req('GET', '/world/map?server=TR1')).json.map;
    const bMap = (await app.req('GET', '/world/map?server=TR1')).json.map;
    expect(aMap.map.code === 'K-1' && bMap.map.code === 'G-1', `${aMap?.map.code} / ${bMap?.map.code}`);
    expect(aMap.zones.some((z) => z.zoneType === 'station') && aMap.portals.length >= 2, 'istasyon/geçit eksik');
    const g = (await pc.req('GET', '/world/galaxy?server=TR1')).json.galaxy;
    const enemy = g.maps.find((m) => m.code === 'G-1');
    expect(g.currentMap === 'K-1' && enemy.access.ok === false && enemy.access.requiredLevel === 15, JSON.stringify(enemy.access));
    expect((await pc.req('POST', '/world/position', { serverCode: 'TR1', x: 1, y: 1 })).status === 404, 'REST konum uç noktası kalkmış olmalı');
  });
  await step('Oyun bileti: A web oturumuyla (çerez+CSRF), B Android oturumuyla (Bearer) bilet alır ve WebSocket ile bağlanır', async () => {
    ga = await GameConn.open(pc);
    gb = await GameConn.open(app);
    expect(ga.welcome.map.map.code === 'K-1' && gb.welcome.map.map.code === 'G-1', 'karşılama haritaları');
    const noCsrf = await fetch(`${API}/game/ticket`, { method: 'POST', headers: { cookie: pc.cookie, origin: WEB, 'content-type': 'application/json' }, body: '{"serverCode":"TR1"}' });
    expect(noCsrf.status === 403, `CSRF olmadan bilet verilmemeli: ${noCsrf.status}`);
  });
  await step('Sunucu otoriteli hareket: A 1 sn sağa gider, hız sınırını aşmaz; konum yazma girişimi yok sayılır', async () => {
    const x0 = ga.welcome.you[0];
    let seq = 0;
    for (let i = 0; i < 20; i++) {
      ga.send({ t: 'in', i: [[++seq, 1, 1, 0]] });
      await sleep(50);
    }
    ga.send({ t: 'pos', x: 19000, y: 1800 });
    await ga.wait('snap', (m) => m.a === 20, 3000);
    await sleep(300);
    const x1 = ga.last('snap').y[0];
    expect(x1 - x0 > 150 && x1 - x0 <= 320 * 1.6, `1 sn'de ${x1 - x0} birim`);
  });
  await step('Farklı haritadaki pilotlar birbirini görmez; B, A\'nın yanına gelince ikisi de birbirini görür', async () => {
    expect(!ga.msgs.some((m) => m.t === 'enter'), 'A, başka haritadaki B\'yi görmemeli');
    await gb.close();
    await waitOffline('GokBoru');
    const a = ga.last('snap').y;
    await place('GokBoru', a[0] + 600, a[1], 'K-1');
    gb = await GameConn.open(app);
    const enterA = await ga.wait('enter', (m) => m.e.some((x) => x.n === 'GokBoru'));
    const enterB = await gb.wait('enter', (m) => m.e.some((x) => x.n === 'AnadoluKartali'));
    expect(enterA.e[0].cc === 'GKB' && enterB.e[0].cc === 'KZL', 'şirket bilgisi');
  });
  await step('Pilot B başka haritanın geçidini kullanamaz; uzaktan atlayamaz (WebSocket hata mesajı)', async () => {
    const g1 = (await db.query(`SELECT id FROM map_portals WHERE map_id = (SELECT id FROM maps WHERE code = 'G-1') LIMIT 1`)).rows[0].id;
    gb.send({ t: 'jump', p: g1 });
    expect((await gb.wait('error')).code === 'PORTAL_NOT_FOUND', 'başka haritanın geçidi');
    const k2 = aMap.portals.find((p) => p.target.code === 'K-2');
    gb.msgs.length = 0;
    gb.send({ t: 'jump', p: k2.id });
    expect((await gb.wait('error')).code === 'TOO_FAR_FROM_PORTAL', 'uzak geçit');
  });
  await step('Pilot A K-2 geçidinin yanından atlar → K-2; B "leave" alır; seviye 5 isteyen K-3 kilitli', async () => {
    const k2 = aMap.portals.find((p) => p.target.code === 'K-2');
    const k3 = aMap.portals.find((p) => p.target.code === 'K-3');
    await ga.close();
    await waitOffline('AnadoluKartali');
    await place('AnadoluKartali', k3.x, k3.y - 200);
    ga = await GameConn.open(pc);
    ga.send({ t: 'jump', p: k3.id });
    const locked = await ga.wait('error');
    expect(locked.code === 'MAP_LOCKED', JSON.stringify(locked));
    await ga.close();
    await waitOffline('AnadoluKartali');
    await place('AnadoluKartali', k2.x - 250, k2.y);
    await gb.close();
    await waitOffline('GokBoru');
    await place('GokBoru', k2.x - 900, k2.y, 'K-1');
    ga = await GameConn.open(pc);
    gb = await GameConn.open(app);
    await gb.wait('enter');
    ga.send({ t: 'jump', p: k2.id });
    const m = await ga.wait('map');
    expect(m.reason === 'portal' && m.map.map.code === 'K-2', JSON.stringify(m).slice(0, 200));
    expect((await gb.wait('leave')).e.includes(ga.welcome.id), 'B, A\'nın ayrıldığını görmeli');
    expect((await playerOf('AnadoluKartali')).code === 'K-2', 'geçiş kalıcı olmalı');
    const t = await db.query(`SELECT reason FROM map_transitions`);
    expect(t.rows.length === 1 && t.rows[0].reason === 'portal', JSON.stringify(t.rows));
  });
  await step('Tek aktif oyun oturumu: A ikinci cihazdan (Android) oyuna girince web bağlantısı "başka cihaz" ile kapanır', async () => {
    const aApp = new Client('Pilot A (Android 2)', { ua: UA.android, ip: '85.105.10.99', platform: 'android' });
    const login = await aApp.req('POST', '/auth/login', { identifier: 'AnadoluKartali', password: 'Kizilelma_Seferi_1071', transport: 'token', device: { platform: 'android' } });
    expect(login.status === 200, JSON.stringify(login.json));
    aApp.bearer = login.json.sessionToken;
    const second = await GameConn.open(aApp);
    const kick = await ga.wait('kick');
    expect(kick.code === 4002 && (await ga.closed) === 4002, `kapanış kodu ${kick.code}`);
    expect(second.welcome.map.map.code === 'K-2', 'gemi aynı yerden devam etmeli');
    await second.close();
    await gb.close();
    await waitOffline('AnadoluKartali');
  });
  await step('Harita bakıma alınınca Pilot A ana haritasına (K-1) taşınır ve Türkçe bildirim alır', async () => {
    await db.query(`UPDATE maps SET is_closed = true WHERE code = 'K-2'`);
    const m = (await pc.req('GET', '/world/map?server=TR1')).json.map;
    await db.query(`UPDATE maps SET is_closed = false WHERE code = 'K-2'`);
    expect(m.map.code === 'K-1' && typeof m.notice === 'string' && m.notice.length > 10, JSON.stringify({ code: m.map.code, notice: m.notice }));
    const t = await db.query(`SELECT reason FROM map_transitions ORDER BY id DESC LIMIT 1`);
    expect(t.rows[0].reason === 'map_closed', JSON.stringify(t.rows));
  });
  await step('Ayarlar cihaz sınıfına göre ayrı saklanır; geçersiz değer reddedilir; B, A\'nın ayarını görmez', async () => {
    const d = (await pc.req('GET', '/settings?deviceClass=desktop')).json.settings;
    d.keys.galaxy = 'KeyG';
    const save = await pc.req('PUT', '/settings', { deviceClass: 'desktop', settings: d });
    expect(save.status === 200, JSON.stringify(save.json));
    const ph = (await pc.req('GET', '/settings?deviceClass=phone')).json.settings;
    expect(ph.keys.galaxy === 'KeyM' && ph.controls.mode === 'joystick', JSON.stringify(ph.keys));
    const bad = await pc.req('PUT', '/settings', { deviceClass: 'desktop', settings: { ...d, hud: { ...d.hud, scale: 9 } } });
    expect(bad.status === 400 && bad.json.error.code === 'VALIDATION_ERROR', JSON.stringify(bad.json));
    const b = (await app.req('GET', '/settings?deviceClass=desktop')).json.settings;
    expect(b.keys.galaxy === 'KeyM', 'ayarlar hesaplar arasında sızdı');
  });
  await db.end();

  console.log('\nYetki (sunucu tarafı)');
  await step('Sunucu tarafı rol aracı Pilot A\'ya moderatör verir; yetki /me\'de görünür, denetim kaydı yazılır', async () => {
    const r = spawnSync(tsx, ['apps/api/src/scripts/role-cli.ts', 'grant', '--user', 'AnadoluKartali', '--role', 'moderator', '--reason', 'E2E test ataması'], { cwd: ROOT, env, encoding: 'utf8' });
    expect(r.status === 0, r.stderr || r.stdout);
    const me = await pc.req('GET', '/auth/me');
    expect(me.json.user.roles.includes('moderator') && me.json.permissions.includes('players.ban'), JSON.stringify(me.json));
    const c = new pg.Client({ connectionString: DB_URL });
    await c.connect();
    const { rows } = await c.query(`SELECT action, reason FROM admin_audit_log`);
    await c.end();
    expect(rows.length === 1 && rows[0].action === 'role.grant', JSON.stringify(rows));
  });
  await step('Pilot B hâlâ yalnızca player (başkasının yetkisi sızmaz)', async () => {
    const me = await app.req('GET', '/auth/me');
    expect(JSON.stringify(me.json.user.roles) === '["player"]' && me.json.permissions.length === 0, JSON.stringify(me.json));
  });
  await step('Çıkış: oturum sunucuda iptal edilir', async () => {
    const r = await pc.req('POST', '/auth/logout', {});
    expect(r.status === 200, JSON.stringify(r.json));
    pc.csrf = null;
    expect((await pc.req('GET', '/auth/me')).status === 401, 'çıkıştan sonra 401 bekleniyordu');
  });
}

try {
  await main();
} catch (err) {
  results.push({ name: 'hazırlık', ok: false, err: err.message });
  console.error(err);
} finally {
  server?.kill('SIGTERM');
  game?.kill('SIGTERM');
  smtp.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\nSonuç: ${results.length - failed.length}/${results.length} adım başarılı, ${inbox.length} e-posta SMTP üzerinden alındı.`);
  process.exitCode = failed.length ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 500).unref();
}
