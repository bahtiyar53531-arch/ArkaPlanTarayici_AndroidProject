#!/usr/bin/env node
/**
 * TÜRK ORBIT — Aşama 1 + 5 + 6 + 7 + 8 + 9 uçtan uca (E2E) test
 *
 * Gerçek API sürecini başlatır, e-postaları GERÇEK SMTP üzerinden yakalar ve iki ayrı hesapla
 * (PC web oturumu + Android uygulama oturumu) tüm kayıt/giriş akışlarını HTTP üzerinden dener.
 *
 * Gereksinimler: PostgreSQL (turkorbit_e2e veritabanı), Redis.
 * Kullanım:  npm run test:e2e
 * Ortam:     E2E_DATABASE_URL, E2E_REDIS_URL, E2E_API_PORT, E2E_SMTP_PORT
 */
import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
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

/** Aşama 13: ham gövdeyle ek dosya yükleme (Bearer veya çerez + CSRF) */
async function rawUpload(client, url, name, bytes) {
  const headers = { 'user-agent': client.ua, origin: WEB, 'x-forwarded-for': client.ip, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(name) };
  if (client.platform) headers['x-client-platform'] = client.platform;
  if (client.cookie) headers.cookie = client.cookie;
  if (client.csrf) headers['x-csrf-token'] = client.csrf;
  if (client.bearer) headers.authorization = `Bearer ${client.bearer}`;
  const res = await fetch(API + url, { method: 'POST', headers, body: bytes });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300, 9)]);

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
    c.send({ t: 'hello', v: 2, ticket: t.json.ticket });
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
  UPLOAD_DIR: path.join(os.tmpdir(), 'turkorbit-e2e-uploads'),
};

let server;
let game;
async function main() {
  console.log('TÜRK ORBIT — Aşama 1 + 5–13 uçtan uca test\n');
  await new Promise((r) => smtp.listen(SMTP_PORT, '127.0.0.1', r));
  await resetDb();
  const tsx = path.join(ROOT, 'node_modules/.bin/tsx');
  const mig = spawnSync(tsx, ['apps/api/src/scripts/migrate.ts'], { cwd: ROOT, env, encoding: 'utf8' });
  if (mig.status !== 0) throw new Error(`migration başarısız:\n${mig.stdout}\n${mig.stderr}`);
  console.log(mig.stdout.trim());
  {
    // Hareket adımları NPC'siz; savaş adımı için K-1'e tek bir zayıf test NPC'si
    const c = new pg.Client({ connectionString: DB_URL });
    await c.connect();
    await c.query(`UPDATE npc_spawns SET is_enabled = false`);
    await c.query(`UPDATE resource_nodes SET is_enabled = false`); // madencilik adımları kendi test noktalarını ekler
    await c.query(`INSERT INTO reward_tables (code, name) VALUES ('npc.test-e2e', 'E2E')`);
    await c.query(
      `INSERT INTO npc_types (code, name, family, level, sprite_key, hitpoints, shield, shield_absorb, damage, attack_rate_ms, attack_range, speed, ai, experience, reward_table_id)
       VALUES ('test-e2e', 'Deneme Çakalı', 'cakal', 1, 'npc-cakal', 80, 0, 0, 0, 1000, 450, 1, '{"behavior":"passive","patrol_radius":1}', 1000, (SELECT id FROM reward_tables WHERE code = 'npc.test-e2e'))`,
    );
    await c.query(`INSERT INTO reward_entries (reward_table_id, reward_type, ref_code, min_amount, max_amount, chance, delivery)
                   VALUES ((SELECT id FROM reward_tables WHERE code = 'npc.test-e2e'), 'currency', 'KREDI', 300, 300, 1, 'direct')`);
    await c.query(`INSERT INTO npc_spawns (map_id, npc_type_id, area, max_alive, respawn_seconds)
                   VALUES ((SELECT id FROM maps WHERE code = 'K-1'), (SELECT id FROM npc_types WHERE code = 'test-e2e'), '{"type":"circle","x":8000,"y":8000,"r":1}', 1, 600)`);
    // Aşama 10: savaş adımında tamamlanacak bir görev (Çakal ailesi, şirketin 1. haritası)
    await c.query(`INSERT INTO reward_tables (code, name) VALUES ('quest.test-e2e-av', 'Görev: E2E')`);
    await c.query(`INSERT INTO reward_entries (reward_table_id, reward_type, ref_code, min_amount, max_amount, chance) VALUES
                   ((SELECT id FROM reward_tables WHERE code = 'quest.test-e2e-av'), 'experience', 'XP', 200, 200, 1),
                   ((SELECT id FROM reward_tables WHERE code = 'quest.test-e2e-av'), 'currency', 'KREDI', 400, 400, 1)`);
    await c.query(`INSERT INTO quests (code, category, title, description, reward_table_id) VALUES
                   ('test-e2e-av', 'main', 'Deneme Avı', 'E2E görevi', (SELECT id FROM reward_tables WHERE code = 'quest.test-e2e-av'))`);
    await c.query(`INSERT INTO quest_objectives (quest_id, sort_order, objective_type, params, target, label) VALUES
                   ((SELECT id FROM quests WHERE code = 'test-e2e-av'), 1, 'kill_npc', '{"family":["cakal"],"maps":["{c}-1"]}', 1, 'Çakal ailesinden NPC yok et ({c}-1)')`);
    // Aşama 11: K-1'de uzak bir test maden noktası ve 1 sn'lik test tarifi
    await c.query(`INSERT INTO resource_nodes (map_id, item_type_id, area, max_count, respawn_seconds, yield_min, yield_max)
                   VALUES ((SELECT id FROM maps WHERE code = 'K-1'), (SELECT id FROM item_types WHERE code = 'res.ferrolit'), '{"type":"circle","x":3000,"y":3000,"r":1}', 1, 600, 12, 12)`);
    await c.query(`INSERT INTO crafting_recipes (code, name, category, output_item_type_id, output_quantity, inputs, duration_seconds, sort_order)
                   VALUES ('test-e2e-roket', 'Deneme Roketi', 'craft', (SELECT id FROM item_types WHERE code = 'rocket.yildirim'), 5, '[{"item":"res.ferrolit","qty":2},{"currency":"KREDI","qty":10}]', 1, 99)`);
    await c.end();
  }
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
  await step('Görevler (Aşama 10): A (web) ve B (Android) kendi görev listelerini alır; günlük/haftalık atanır; A görevi kabul eder', async () => {
    const qa = (await pc.req('GET', '/quests?server=TR1')).json.quests;
    const qb = (await app.req('GET', '/quests?server=TR1')).json.quests;
    // Günlük görevler pilota özel tohumla seçilir; seçilen bir görev (ör. "haritaya git") pilotun mevcut
    // hareketleriyle hemen tamamlanabilir — bu geçerli bir oyun davranışıdır. Atanan görev sayısı sayılır.
    const count = (q, cat) => q.quests.filter((x) => x.category === cat && (x.status === 'active' || x.status === 'completed')).length;
    expect(count(qa, 'daily') === 3 && count(qa, 'weekly') === 3 && count(qb, 'daily') === 3, JSON.stringify({ a: count(qa, 'daily'), b: count(qb, 'daily') }));
    expect(qa.quests.find((x) => x.code === 'cakal-avcisi-01')?.objectives[0]?.label === 'Çakal yok et (K-1)', 'Kızılelma için {c} → K');
    expect(qb.quests.find((x) => x.code === 'cakal-avcisi-01')?.objectives[0]?.label === 'Çakal yok et (G-1)', 'Gökbörü için {c} → G');
    const r = await pc.req('POST', '/quests/accept', { serverCode: 'TR1', code: 'test-e2e-av' });
    expect(r.status === 200 && r.json.quests.quests.find((x) => x.code === 'test-e2e-av')?.status === 'active', JSON.stringify(r.json));
    const bad = await pc.req('POST', '/quests/progress', { serverCode: 'TR1', code: 'test-e2e-av', amount: 1 });
    expect(bad.status === 404, 'ilerleme yazan uç olmamalı');
  });
  await step('Savaş: A (web) WebSocket ile NPC\'yi hedefler ve vurur; sunucu NPC\'yi yok eder, ödül defterli verilir (Aşama 9)', async () => {
    await place('AnadoluKartali', 7700, 8000, 'K-1');
    const g = await GameConn.open(pc);
    const npc = (await g.wait('enter', (m) => m.e.some((x) => x.k === 'n'))).e.find((x) => x.k === 'n');
    expect(npc.n === 'Deneme Çakalı', JSON.stringify(npc));
    g.send({ t: 'target', id: npc.id });
    g.send({ t: 'attack', on: true });
    const reward = await g.wait('reward', () => true, 8000);
    expect(reward.xp === 1000 && reward.currencies[0]?.amount === 300, JSON.stringify(reward));
    const l = await db.query(`SELECT l.delta, l.ref_type FROM currency_ledger l JOIN players p ON p.id = l.player_id JOIN users u ON u.id = p.user_id WHERE u.username = 'AnadoluKartali' AND l.reason = 'npc_reward'`);
    expect(l.rows.length === 1 && Number(l.rows[0].delta) === 300 && l.rows[0].ref_type === 'npc_kill', JSON.stringify(l.rows));
    // Ödül veritabanına yazılınca gelir; patlama efekti bir sonraki anlık görüntüde (sırası değişebilir)
    await g.wait('snap', (m) => (m.fx ?? []).some((f) => f[0] === 'x' && f[1] === npc.id), 3000);
    const fx = g.msgs.filter((m) => m.t === 'snap').flatMap((m) => m.fx ?? []);
    expect(fx.some((f) => f[0] === 'l' && f[2] === npc.id), 'lazer efekti gelmeli');
    // Aşama 10: görev ilerlemesi oyun sunucusundan canlı gelir
    const qp = await g.wait('qp', (m) => m.u.some((x) => x.code === 'test-e2e-av' && x.status === 'completed'), 5000);
    expect(qp.u.find((x) => x.code === 'test-e2e-av').objectives[0].current === 1, JSON.stringify(qp));
    await g.close();
    await waitOffline('AnadoluKartali');
  });
  await step('Görev ödülü: A tamamlanan görevin ödülünü alır (defterli); ikinci istek yeniden ödül vermez; B alamaz', async () => {
    const r1 = await pc.req('POST', '/quests/claim', { serverCode: 'TR1', code: 'test-e2e-av' });
    expect(r1.status === 200 && r1.json.replay === false && r1.json.reward.xp === 200, JSON.stringify(r1.json));
    const r2 = await pc.req('POST', '/quests/claim', { serverCode: 'TR1', code: 'test-e2e-av' });
    expect(r2.status === 200 && r2.json.replay === true, JSON.stringify(r2.json));
    const rb = await app.req('POST', '/quests/claim', { serverCode: 'TR1', code: 'test-e2e-av' });
    expect(rb.status === 409, `B: ${rb.status}`);
    const l = await db.query(`SELECT l.delta FROM currency_ledger l JOIN players p ON p.id = l.player_id JOIN users u ON u.id = p.user_id WHERE u.username = 'AnadoluKartali' AND l.reason = 'quest_reward'`);
    expect(l.rows.length === 1 && Number(l.rows[0].delta) === 400, JSON.stringify(l.rows));
  });
  // ---------------------------------------------------------------- Aşama 11: ekonomi
  await step('Günlük ödül (Aşama 11): A (web) ve B (Android) kendi ödülünü alır; tekrar isteği ödül vermez', async () => {
    const a1 = await pc.req('POST', '/market/daily/claim', { serverCode: 'TR1' });
    expect(a1.status === 200 && a1.json.replay === false && a1.json.reward.day === 1, JSON.stringify(a1.json));
    const a2 = await pc.req('POST', '/market/daily/claim', { serverCode: 'TR1' });
    expect(a2.json.replay === true, 'ikinci istek ödül vermemeli');
    const b1 = await app.req('POST', '/market/daily/claim', { serverCode: 'TR1' });
    expect(b1.status === 200 && b1.json.replay === false, JSON.stringify(b1.json));
    const n = await db.query(`SELECT count(*)::int AS n FROM player_daily_logins`);
    expect(n.rows[0].n === 2, `kayıt sayısı ${n.rows[0].n}`);
  });
  await step('Madencilik: A oyunda maden noktasına gelince kaynak ambara girer (WebSocket); Pazar\'da satar', async () => {
    await place('AnadoluKartali', 3000, 3000, 'K-1');
    const g = await GameConn.open(pc);
    const r = await g.wait('reward', (m) => m.source === 'Kaynak toplandı', 5000);
    expect(r.items[0]?.code === 'res.ferrolit' && r.items[0]?.amount === 12, JSON.stringify(r));
    const cs = await g.wait('cs', (m) => m.cargo?.[0] === 12, 3000);
    expect(cs.cargo[1] > 0, JSON.stringify(cs.cargo));
    await g.close();
    await waitOffline('AnadoluKartali');
    const c = (await pc.req('GET', '/market/crafting?server=TR1')).json.crafting;
    const fer = c.resources.find((x) => x.code === 'res.ferrolit');
    expect(fer.quantity === 12 && c.cargo.used === 12, JSON.stringify({ fer, cargo: c.cargo }));
    const before = (await pc.req('GET', '/hangar?server=TR1')).json.hangar.currencies.find((x) => x.code === 'KREDI').balance;
    const sell = await pc.req('POST', `/hangar/items/${fer.itemId}/sell`, { serverCode: 'TR1', quantity: 4, requestId: crypto.randomUUID() });
    expect(sell.status === 200, JSON.stringify(sell.json));
    const after = (await pc.req('GET', '/hangar?server=TR1')).json.hangar.currencies.find((x) => x.code === 'KREDI').balance;
    expect(after === before + 40, `${before} → ${after}`);
  });
  await step('Üretim: A tarifi başlatır (girdiler hemen düşer); süre dolmadan teslim alamaz; dolunca roketler envantere girer', async () => {
    const start = await pc.req('POST', '/market/crafting/start', { serverCode: 'TR1', recipe: 'test-e2e-roket', batches: 2, requestId: crypto.randomUUID() });
    expect(start.status === 200 && start.json.crafting.jobs.length === 1, JSON.stringify(start.json));
    const job = start.json.crafting.jobs[0];
    expect(start.json.crafting.resources.find((x) => x.code === 'res.ferrolit').quantity === 4, 'girdiler düşülmeli (8 - 4)');
    const early = await pc.req('POST', '/market/crafting/claim', { serverCode: 'TR1', jobId: job.id });
    expect(early.status === 409 && early.json.error.code === 'CRAFT_NOT_READY', JSON.stringify(early.json));
    await new Promise((r) => setTimeout(r, 2200));
    const claim = await pc.req('POST', '/market/crafting/claim', { serverCode: 'TR1', jobId: job.id });
    expect(claim.status === 200 && claim.json.claimed.quantity === 10, JSON.stringify(claim.json));
    const again = await pc.req('POST', '/market/crafting/claim', { serverCode: 'TR1', jobId: job.id });
    expect(again.json.replay === true, 'ikinci teslim alma yeniden vermemeli');
  });
  await step('Açık artırma: A teklif verir (emanet), B geçer; A\'ya iade edilir; teklif fiyatı istemciden değil sunucu kuralından', async () => {
    const list = (await pc.req('GET', '/market/auctions?server=TR1')).json.auctions;
    const lot = list.open.find((x) => x.item.code === 'res.nebulit' && x.type === 'hourly');
    expect(lot && lot.nextMinBid === 4000, JSON.stringify(lot));
    const a = await pc.req('POST', '/market/auctions/bid', { serverCode: 'TR1', auctionId: lot.id, amount: 4000, requestId: crypto.randomUUID() });
    expect(a.status === 200, JSON.stringify(a.json));
    const low = await app.req('POST', '/market/auctions/bid', { serverCode: 'TR1', auctionId: lot.id, amount: 4100, requestId: crypto.randomUUID() });
    expect(low.status === 409 && low.json.error.code === 'BID_TOO_LOW', JSON.stringify(low.json));
    const b = await app.req('POST', '/market/auctions/bid', { serverCode: 'TR1', auctionId: lot.id, amount: 4200, requestId: crypto.randomUUID() });
    expect(b.status === 200 && b.json.auctions.open.find((x) => x.id === lot.id).leading === true, JSON.stringify(b.json));
    const led = await db.query(
      `SELECT u.username, l.reason, l.delta::int AS d FROM currency_ledger l JOIN players p ON p.id = l.player_id JOIN users u ON u.id = p.user_id
       WHERE l.reason LIKE 'auction%' ORDER BY l.id`,
    );
    expect(JSON.stringify(led.rows.map((x) => [x.username, x.reason, x.d])) === JSON.stringify([['AnadoluKartali', 'auction_bid', -4000], ['AnadoluKartali', 'auction_refund', 4000], ['GokBoru', 'auction_bid', -4200]]), JSON.stringify(led.rows));
  });
  await step('Mağaza paketi: B (Android) indirimli Acemi Pilot Paketi\'ni alır; tüm içerik envantere girer; ikinci kez alamaz', async () => {
    const shop = (await app.req('GET', '/shop?server=TR1')).json.shop;
    const pkt = shop.categories.find((c) => c.code === 'paketler').offers.find((o) => o.name === 'Acemi Pilot Paketi');
    expect(pkt && pkt.finalPrice === 300 && pkt.bundle.length === 4, JSON.stringify(pkt));
    const r1 = await app.req('POST', '/shop/purchase', { serverCode: 'TR1', offerId: pkt.id, packs: 1, requestId: crypto.randomUUID() });
    expect(r1.status === 200, JSON.stringify(r1.json));
    const r2 = await app.req('POST', '/shop/purchase', { serverCode: 'TR1', offerId: pkt.id, packs: 1, requestId: crypto.randomUUID() });
    expect(r2.status === 409 && r2.json.error.code === 'PURCHASE_LIMIT', JSON.stringify(r2.json));
    const inv = (await app.req('GET', '/hangar?server=TR1')).json.hangar.inventory;
    expect(inv.some((i) => i.code === 'extra.kargo'), 'kargo genişletici envanterde olmalı');
  });
  // ------------------------------------------------------------------ Aşama 12: klan ve sosyal
  const unread = async (cl) => (await cl.req('GET', '/notifications/unread?server=TR1')).json.unread;
  await step('Klan (Aşama 12): A seviye 5 olunca klan kurar (ücret defterli); B (Android) başvurur → A bildirim alır → kabul; B davet edemez', async () => {
    await db.query(`UPDATE players SET experience = 139300 FROM users u WHERE u.id = players.user_id AND u.username = 'AnadoluKartali'`);
    await db.query(`UPDATE wallets SET balance = 80000 FROM players p JOIN users u ON u.id = p.user_id WHERE wallets.player_id = p.id AND u.username = 'AnadoluKartali' AND wallets.currency_code = 'KREDI'`);
    const c1 = await pc.req('POST', '/clan/create', { serverCode: 'TR1', tag: 'akn', name: 'Akıncılar', requestId: crypto.randomUUID() });
    expect(c1.status === 200 && c1.json.clan.tag === 'AKN' && c1.json.clan.myRank.isLeader, JSON.stringify(c1.json));
    const led = await db.query(`SELECT delta::int AS d FROM currency_ledger WHERE reason = 'clan_create'`);
    expect(led.rows.length === 1 && led.rows[0].d === -50000, JSON.stringify(led.rows));
    const before = await unread(pc);
    const ap = await app.req('POST', '/clan/apply', { serverCode: 'TR1', tag: 'AKN', message: 'Katılabilir miyim?' });
    expect(ap.status === 200, JSON.stringify(ap.json));
    expect((await unread(pc)) === before + 1, 'A başvuru bildirimi almalı');
    const appId = (await pc.req('GET', '/clan?server=TR1')).json.clan.applications[0].id;
    const ok = await pc.req('POST', '/clan/applications/decide', { serverCode: 'TR1', id: appId, accept: true });
    expect(ok.json.clan.members === 2, JSON.stringify(ok.json));
    const inv = await app.req('POST', '/clan/invite', { serverCode: 'TR1', pilotName: 'AnadoluKartali' });
    expect(inv.status === 403 && inv.json.error.code === 'CLAN_PERMISSION', JSON.stringify(inv.json));
    const pub = (await pc.req('GET', '/pilots/TR1/GokBoru')).json.pilot;
    expect(pub.clan?.tag === 'AKN' && pub.clan.rank === 'Üye', JSON.stringify(pub.clan));
  });
  await step('Arkadaşlık: A, B\'ye istek gönderir → B (Android) bildirim alır ve kabul eder; A arkadaş listesinde B\'yi görür', async () => {
    const r = await pc.req('POST', '/social/friends/request', { serverCode: 'TR1', pilotName: 'GokBoru' });
    expect(r.status === 200 && r.json.outgoing.length === 1, JSON.stringify(r.json));
    const n = (await app.req('GET', '/notifications?server=TR1')).json;
    expect(n.items.some((x) => x.kind === 'friend_request'), JSON.stringify(n.items.map((x) => x.kind)));
    const acc = await app.req('POST', '/social/friends/respond', { serverCode: 'TR1', pilotName: 'AnadoluKartali', accept: true });
    expect(acc.json.friends[0]?.pilotName === 'AnadoluKartali', JSON.stringify(acc.json));
    expect((await pc.req('GET', '/social/friends?server=TR1')).json.friends[0].pilotName === 'GokBoru', 'A listede B\'yi görmeli');
  });
  let sa = null;
  let sb = null;
  await step('Sohbet (WebSocket): A (web, K-1) genel ve klan kanalına yazar → B (Android, G-1) alır; B özel mesaj atar; küfür maskelenir', async () => {
    await place('AnadoluKartali', 9000, 6000, 'K-1');
    await place('GokBoru', 9000, 6000, 'G-1');
    sa = await GameConn.open(pc);
    sb = await GameConn.open(app);
    sa.send({ t: 'chat', ch: 'global', b: 'Selam galaksi!' });
    const g = await sb.wait('chat', (m) => m.m.b === 'Selam galaksi!');
    expect(g.m.ch === 'global' && g.m.from.name === 'AnadoluKartali' && g.m.from.clanTag === 'AKN', JSON.stringify(g.m));
    sa.send({ t: 'chat', ch: 'clan', b: 'Klan toplantısı' });
    await sb.wait('chat', (m) => m.m.ch === 'clan' && m.m.b === 'Klan toplantısı');
    sb.send({ t: 'chat', ch: 'dm', to: 'AnadoluKartali', b: 'Sana özel: siktir aq' });
    const dm = await sa.wait('chat', (m) => m.m.ch === 'dm');
    expect(dm.m.b === 'Sana özel: ****** **' && dm.m.to === 'AnadoluKartali', JSON.stringify(dm.m));
    const h = (await app.req('GET', '/chat/history?server=TR1&channel=dm&with=AnadoluKartali')).json.messages;
    expect(h.length === 1 && h[0].b === 'Sana özel: ****** **', JSON.stringify(h));
  });
  await step('Grup: A, B\'yi davet eder → B kabul eder; farklı haritadaki üyenin konumu ÜYENİN iznine göre (B "yalnızca harita" seçince koordinat gizlenir)', async () => {
    sa.send({ t: 'party', a: 'invite', n: 'GokBoru' });
    await sb.wait('pinv', (m) => m.from === 'AnadoluKartali');
    sb.send({ t: 'party', a: 'accept', n: 'AnadoluKartali' });
    const v = await sa.wait('party', (m) => m.p?.members.length === 2 && m.p.members[1].map !== null, 8000);
    const bm = v.p.members.find((x) => x.name === 'GokBoru');
    expect(bm.map.code === 'G-1' && bm.x === 9000 && bm.y === 6000 && bm.online, JSON.stringify(bm));
    const s = await app.req('PUT', '/social/settings', { serverCode: 'TR1', locationSharing: 'map', friendsSeeOnline: true, dmPolicy: 'everyone', groupInvites: 'everyone', friendRequests: true });
    expect(s.status === 200, JSON.stringify(s.json));
    const v2 = await sa.wait('party', (m) => m.p?.members.find((x) => x.name === 'GokBoru')?.x === null && m.p.members.find((x) => x.name === 'GokBoru')?.map?.code === 'G-1', 8000);
    expect(v2.p.members[0].leader && v2.p.members[0].name === 'AnadoluKartali', JSON.stringify(v2.p.members));
    sb.send({ t: 'chat', ch: 'group', b: 'grup kanalından selam' });
    await sa.wait('chat', (m) => m.m.ch === 'group' && m.m.b === 'grup kanalından selam');
  });
  await step('Engelleme: B, A\'yı engeller → A\'nın genel mesajı B\'ye iletilmez; A özel mesaj gönderemez; şikâyet kuyruğa düşer', async () => {
    const blk = await app.req('POST', '/social/block', { serverCode: 'TR1', pilotName: 'AnadoluKartali' });
    expect(blk.status === 200 && blk.json.blocked.length === 1 && blk.json.friends.length === 0, JSON.stringify(blk.json));
    await sleep(300);
    sa.send({ t: 'chat', ch: 'global', b: 'engellendikten sonra' });
    await sa.wait('chat', (m) => m.m.b === 'engellendikten sonra');
    await sleep(400);
    expect(!sb.msgs.some((m) => m.t === 'chat' && m.m.b === 'engellendikten sonra'), 'engellenen pilotun mesajı iletildi');
    sa.send({ t: 'chat', ch: 'dm', to: 'GokBoru', b: 'cevap ver' });
    const nt = await sa.wait('notice', (m) => m.text.includes('özel mesaj kabul etmiyor'));
    expect(nt.text === 'GokBoru şu an senden özel mesaj kabul etmiyor.', nt.text);
    const msg = sb.msgs.find((m) => m.t === 'chat' && m.m.b === 'Selam galaksi!');
    const rep = await app.req('POST', '/reports', { serverCode: 'TR1', targetType: 'chat_message', target: String(msg.m.id), reason: 'spam' });
    expect(rep.status === 201, JSON.stringify(rep.json));
    const q = await db.query(`SELECT status, snapshot->>'body' AS body FROM reports`);
    expect(q.rows.length === 1 && q.rows[0].status === 'open' && q.rows[0].body === 'Selam galaksi!', JSON.stringify(q.rows));
    await sa.close();
    await sb.close();
    await waitOffline('AnadoluKartali');
    await waitOffline('GokBoru');
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
  // ------------------------------------------------------------------ Aşama 13: forum ve destek
  let forumThread = 0;
  let ticketNo = '';
  await step('Forum (Aşama 13): A (web) rehber konusu açar; B (Android) yanıtlar ve beğenir; oturumsuz okuyucu görür; arama "gemi" ile "gemileri" bulur', async () => {
    const dn = await pc.req('POST', '/forum/threads', { category: 'duyurular', title: 'Sahte duyuru denemesi', body: 'x' });
    expect(dn.status === 403, JSON.stringify(dn.json));
    const t = await pc.req('POST', '/forum/threads', { category: 'rehberler', title: 'Yeni pilotlar için madencilik rehberi', body: 'Kaynak bölgelerinde gemileri ambar dolana kadar gezdir.' });
    expect(t.status === 201, JSON.stringify(t.json));
    forumThread = t.json.id;
    const r = await app.req('POST', `/forum/t/${forumThread}/replies`, { body: 'Çok işime yaradı, teşekkürler!' });
    expect(r.status === 201, JSON.stringify(r.json));
    const anon = new Client('Okuyucu (oturumsuz)', { ip: '198.51.100.30' });
    const view = await anon.req('GET', `/forum/t/${forumThread}`);
    expect(view.status === 200 && view.json.thread.posts.length === 2 && view.json.thread.canReply === false, JSON.stringify(view.json));
    const first = view.json.thread.posts[0].id;
    const like = await app.req('POST', `/forum/posts/${first}/like`, { on: true });
    expect(like.json.likes === 1, JSON.stringify(like.json));
    const s = await anon.req('GET', `/forum/search?q=${encodeURIComponent('gemi')}`);
    expect(s.json.results[0]?.threadId === forumThread && s.json.results[0].snippet.includes('[[gemileri]]'), JSON.stringify(s.json));
    const n = await pc.req('GET', '/notifications?server=TR1');
    expect(n.json.items.some((x) => x.kind === 'forum_reply'), 'A takip ettiği konuya yanıt bildirimi almalı');
  });
  await step('Destek: B (Android) talep açar → numara TO-YYYY-NNNNNN, platform android; PNG ek kabul, uzantısı .png olan EXE reddedilir; A talebi göremez', async () => {
    const t = await app.req('POST', '/support/tickets', { category: 'gameplay', subject: 'Görev ödülü gelmedi', body: 'Dünkü görevin ödülü envanterime düşmedi, ekran görüntüsü ekledim.' });
    expect(t.status === 201 && /^TO-\d{4}-\d{6}$/.test(t.json.ticket.ticketNo) && t.json.ticket.platform === 'android', JSON.stringify(t.json));
    ticketNo = t.json.ticket.ticketNo;
    const ok = await rawUpload(app, `/support/tickets/${ticketNo}/messages/${t.json.messageId}/attachments`, 'ekran.png', PNG);
    expect(ok.status === 201 && ok.json.attachment.mimeType === 'image/png', JSON.stringify(ok.json));
    const bad = await rawUpload(app, `/support/tickets/${ticketNo}/messages/${t.json.messageId}/attachments`, 'resim.png', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100)]));
    expect(bad.status === 415 && bad.json.error.code === 'ATTACHMENT_TYPE', JSON.stringify(bad.json));
    const other = await pc.req('GET', `/support/tickets/${ticketNo}`);
    expect(other.status === 404, 'başka oyuncunun talebi görünmemeli');
    const staff = await pc.req('GET', '/support/staff/tickets');
    expect(staff.status === 403, 'oyuncu destek masasına giremez');
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
  await step('Moderatör A (rol aracıyla verildi) konuyu kilitler → B\'nin yanıtı THREAD_LOCKED; işlem denetim kaydında', async () => {
    const lock = await pc.req('POST', `/forum/t/${forumThread}/moderate`, { action: 'lock', reason: 'Rehber tamamlandı' });
    expect(lock.status === 200, JSON.stringify(lock.json));
    const r = await app.req('POST', `/forum/t/${forumThread}/replies`, { body: 'kilitten sonra yanıt' });
    expect(r.status === 409 && r.json.error.code === 'THREAD_LOCKED', JSON.stringify(r.json));
    const c = new pg.Client({ connectionString: DB_URL });
    await c.connect();
    const { rows } = await c.query(`SELECT action, actor_label FROM admin_audit_log WHERE target_type = 'forum_thread'`);
    await c.end();
    expect(rows.length === 1 && rows[0].action === 'forum.thread.lock' && rows[0].actor_label === 'AnadoluKartali', JSON.stringify(rows));
  });
  await step('Rol aracıyla A\'ya destek personeli rolü; A, B\'nin talebine yanıt verir → B\'ye gerçek SMTP ile e-posta; iç not B\'ye görünmez', async () => {
    const g = spawnSync(tsx, ['apps/api/src/scripts/role-cli.ts', 'grant', '--user', 'AnadoluKartali', '--role', 'support_staff', '--reason', 'E2E destek'], { cwd: ROOT, env, encoding: 'utf8' });
    expect(g.status === 0, g.stderr || g.stdout);
    const q = await pc.req('GET', '/support/staff/tickets');
    expect(q.status === 200 && q.json.tickets.some((t) => t.ticketNo === ticketNo), JSON.stringify(q.json));
    await pc.req('POST', `/support/staff/tickets/${ticketNo}/replies`, { body: 'Ödül kayıtlarını inceliyorum.', internal: true });
    const r = await pc.req('POST', `/support/staff/tickets/${ticketNo}/replies`, { body: 'Ödülün hesabına eklendi, iyi oyunlar!' });
    expect(r.status === 201 && r.json.ticket.status === 'waiting_player', JSON.stringify(r.json));
    const mail = await waitForMail(bMail, ticketNo);
    expect(mail.text.includes(`/destek/${ticketNo}`) && !mail.text.includes('Ödülün hesabına'), mail.text);
    const v = await app.req('GET', `/support/tickets/${ticketNo}`);
    expect(v.json.ticket.messages.length === 2 && v.json.ticket.messages[1].author === 'Türk Orbit Destek', JSON.stringify(v.json.ticket.messages));
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
