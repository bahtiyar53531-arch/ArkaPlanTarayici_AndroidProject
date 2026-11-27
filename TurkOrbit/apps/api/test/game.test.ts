/**
 * Oyun sunucusu entegrasyon testleri: GERÇEK WebSocket bağlantıları + GERÇEK PostgreSQL + GERÇEK Redis.
 * Tik döngüsü elle ilerletilir (server.tick()), böylece sonuçlar zamanlamadan bağımsızdır.
 */
import { CLOSE_CODES, PROTOCOL_VERSION, TICK_MS, type ServerMessage } from '@turkorbit/shared';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { GameServer } from '../src/game/server.js';
import { call, createTestContext, newClient, registerAndLogin, resetDatabase, WEB_ORIGIN, type Client, type TestContext } from './helpers.js';

let ctx: TestContext;
let server: GameServer;
let port: number;
let sub: Redis;
const extraServers: Array<{ s: GameServer; sub: Redis }> = [];

const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };

async function startServer(opts: { lingerSeconds?: number; helloTimeoutMs?: number } = {}) {
  const subConn = ctx.rt.redis!.duplicate();
  const s = new GameServer({
    db: ctx.rt.db,
    redis: ctx.rt.redis!,
    sub: subConn,
    log: silent,
    allowedOrigins: [WEB_ORIGIN, 'capacitor://localhost'],
    lingerSeconds: opts.lingerSeconds ?? 0,
    autoTick: false,
    helloTimeoutMs: opts.helloTimeoutMs ?? 2000,
  });
  const p = await s.listen(0, '127.0.0.1');
  return { s, sub: subConn, port: p };
}

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => ctx.close());
beforeEach(async () => {
  await resetDatabase(ctx.rt);
  const started = await startServer();
  server = started.s;
  sub = started.sub;
  port = started.port;
});
afterEach(async () => {
  for (const c of clients) c.ws.terminate();
  clients.length = 0;
  await server.close();
  await sub.quit();
  for (const e of extraServers.splice(0)) {
    await e.s.close();
    await e.sub.quit();
  }
});

// ------------------------------------------------------------------ yardımcılar
class GameClient {
  messages: ServerMessage[] = [];
  bytes = 0;
  closed: Promise<{ code: number; reason: string }>;
  private waiters: Array<() => void> = [];
  constructor(readonly ws: WebSocket) {
    ws.on('message', (d) => {
      const text = d.toString();
      this.bytes += Buffer.byteLength(text);
      this.messages.push(JSON.parse(text) as ServerMessage);
      for (const w of this.waiters.splice(0)) w();
    });
    this.closed = new Promise((resolve) => ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() })));
  }
  send(msg: unknown) {
    this.ws.send(JSON.stringify(msg));
  }
  /** Koşulu sağlayan ilk (veya after'dan sonraki) mesajı bekler. */
  async waitFor<T extends ServerMessage['t']>(t: T, pred: (m: Extract<ServerMessage, { t: T }>) => boolean = () => true, timeout = 3000) {
    const deadline = Date.now() + timeout;
    for (;;) {
      const found = this.messages.find((m) => m.t === t && pred(m as Extract<ServerMessage, { t: T }>));
      if (found) return found as Extract<ServerMessage, { t: T }>;
      if (Date.now() > deadline) throw new Error(`"${t}" mesajı gelmedi. Gelenler: ${this.messages.map((m) => m.t).join(',')}`);
      await new Promise<void>((r) => {
        this.waiters.push(r);
        setTimeout(r, 50);
      });
    }
  }
  last<T extends ServerMessage['t']>(t: T) {
    return [...this.messages].reverse().find((m) => m.t === t) as Extract<ServerMessage, { t: T }> | undefined;
  }
  /** Sunucu önceki tüm mesajları işledi: ping → pong sırası garanti eder. */
  async flush() {
    const c = Math.random();
    this.send({ t: 'ping', c });
    await this.waitFor('pong', (m) => m.c === c);
  }
}
const clients: GameClient[] = [];

async function pilot(username: string, company = 'KZL') {
  const { client } = await registerAndLogin(ctx, username, { client: newClient({ ip: `85.107.${Math.floor(Math.random() * 200)}.1` }) });
  const r = await call(ctx.app, client, 'POST', '/players', { serverCode: 'TR1', companyCode: company });
  if (r.statusCode !== 201) throw new Error(r.body);
  return { client, playerId: r.json().pilot.id as string };
}

async function ticket(client: Client): Promise<string> {
  const r = await call(ctx.app, client, 'POST', '/game/ticket', { serverCode: 'TR1' });
  if (r.statusCode !== 200) throw new Error(r.body);
  return r.json().ticket as string;
}

async function open(opts: { origin?: string; port?: number } = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${opts.port ?? port}/game`, { headers: { origin: opts.origin ?? WEB_ORIGIN } });
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  const c = new GameClient(ws);
  clients.push(c);
  return c;
}

async function join(client: Client, opts: { port?: number } = {}) {
  const c = await open(opts);
  c.send({ t: 'hello', v: PROTOCOL_VERSION, ticket: await ticket(client) });
  const welcome = await c.waitFor('welcome');
  return { c, welcome };
}

const placeAt = (playerId: string, x: number, y: number, mapCode?: string) =>
  ctx.rt.db.query(
    `UPDATE players SET pos_x = $2, pos_y = $3 ${mapCode ? `, map_id = (SELECT id FROM maps WHERE code = '${mapCode}')` : ''} WHERE id = $1`,
    [playerId, x, y],
  );

let seq = 0;
const dir = (x: number, y: number, n = 1) => Array.from({ length: n }, () => [++seq, 1, x, y]);

function ticks(n: number, s = server) {
  for (let i = 0; i < n; i++) s.tick();
}

// ------------------------------------------------------------------ testler
describe('oyun bileti ve bağlantı', () => {
  it('bilet oturum + doğrulanmış e-posta + pilot ister; tek kullanımlıktır', async () => {
    expect((await call(ctx.app, newClient(), 'POST', '/game/ticket', { serverCode: 'TR1' })).statusCode).toBe(401);
    const { client: unverified } = await registerAndLogin(ctx, 'Dogrulanmamis', { verify: false });
    expect((await call(ctx.app, unverified, 'POST', '/game/ticket', { serverCode: 'TR1' })).json().error.code).toBe('EMAIL_NOT_VERIFIED');
    const { client: noPilot } = await registerAndLogin(ctx, 'PilotsuzOyuncu');
    expect((await call(ctx.app, noPilot, 'POST', '/game/ticket', { serverCode: 'TR1' })).json().error.code).toBe('PILOT_NOT_FOUND');

    const { client } = await pilot('BiletPilot');
    const t = await ticket(client);
    const a = await open();
    a.send({ t: 'hello', v: PROTOCOL_VERSION, ticket: t });
    await a.waitFor('welcome');
    // Aynı bilet ikinci kez kullanılamaz
    const b = await open();
    b.send({ t: 'hello', v: PROTOCOL_VERSION, ticket: t });
    expect((await b.closed).code).toBe(CLOSE_CODES.AUTH_FAILED);
  });

  it('sahte bilet, eski protokol sürümü, izinsiz kaynak ve hello göndermeyen bağlantı kapatılır', async () => {
    const { client } = await pilot('KapiPilot');
    const fake = await open();
    fake.send({ t: 'hello', v: PROTOCOL_VERSION, ticket: 'x'.repeat(43) });
    expect((await fake.closed).code).toBe(CLOSE_CODES.AUTH_FAILED);

    const old = await open();
    old.send({ t: 'hello', v: PROTOCOL_VERSION - 1, ticket: await ticket(client) });
    expect((await old.closed).code).toBe(CLOSE_CODES.VERSION);

    const evil = await open({ origin: 'https://kotu-site.example' });
    expect((await evil.closed).code).toBe(CLOSE_CODES.AUTH_FAILED);

    const first = await open();
    first.send({ t: 'in', i: [[1, 1, 1, 0]] });
    expect((await first.closed).code).toBe(CLOSE_CODES.PROTOCOL);

    const extra = await startServer({ helloTimeoutMs: 150 });
    extraServers.push(extra);
    const idle = await open({ port: extra.port });
    expect((await idle.closed).code).toBe(CLOSE_CODES.HELLO_TIMEOUT);
  });

  it('karşılama mesajı veritabanındaki konumu, haritayı ve gemi hızını taşır; çevrimiçi durumu Redis\'e yazılır', async () => {
    const { client, playerId } = await pilot('KarsilamaPilot');
    await placeAt(playerId, 4321, 2345);
    const { welcome } = await join(client);
    expect(welcome.map.map.code).toBe('K-1');
    expect(welcome.you.slice(0, 2)).toEqual([4321, 2345]);
    expect(welcome.map.pilot.ship.speed).toBe(320);
    expect(welcome.tickMs).toBe(TICK_MS);
    const presence = JSON.parse((await ctx.rt.redis!.get(`game:presence:${playerId}`))!);
    expect(presence).toMatchObject({ map: 'K-1', station: false });
    const { rows } = await ctx.rt.db.query('SELECT last_online_at FROM players WHERE id = $1', [playerId]);
    expect(rows[0].last_online_at).not.toBeNull();
  });
});

describe('mesaj sırası', () => {
  it('giriş sırasında tik işlese bile ilk mesaj her zaman welcome olur (yeni giriş ve başka cihazdan devralma)', async () => {
    const a = await pilot('SiraPilot');
    const b = await pilot('KomsuPilot');
    await placeAt(a.playerId, 5000, 5000);
    await placeAt(b.playerId, 5300, 5000);
    // Giriş adımlarındaki veritabanı/Redis beklemeleri sırasında sürekli tik at
    const timer = setInterval(() => server.tick(), 1);
    try {
      const cb = await join(b.client);
      const first = await join(a.client);
      const phone = newClient({ ip: '176.88.2.2' });
      const login = await call(ctx.app, phone, 'POST', '/auth/login', { identifier: 'SiraPilot', password: 'Nebula-Kartal-77' });
      phone.csrf = login.json().csrfToken;
      const second = await join(phone);
      await new Promise((r) => setTimeout(r, 50));
      for (const c of [cb.c, first.c, second.c]) expect(c.messages[0]!.t).toBe('welcome');
      // Devralan bağlantı komşuyu yeniden "enter" ile öğrenir
      expect(second.c.messages.some((m) => m.t === 'enter')).toBe(true);
    } finally {
      clearInterval(timer);
    }
  });
});

describe('sunucu otoriteli hareket', () => {
  it('yön girdisiyle sunucu gemiyi gemi hızında ilerletir; anlık görüntü son işlenen girdiyi onaylar', async () => {
    const { client, playerId } = await pilot('HareketPilot');
    await placeAt(playerId, 5000, 5000);
    const { c } = await join(client);
    seq = 0;
    c.send({ t: 'in', i: dir(1, 0, 10) });
    c.send({ t: 'in', i: dir(1, 0, 10) });
    await c.flush();
    ticks(20); // 1 sn
    const snap = await c.waitFor('snap', (m) => m.a === 20);
    const moved = snap.y[0] - 5000;
    expect(moved).toBeGreaterThan(200);
    expect(moved).toBeLessThanOrEqual(320); // 1 sn'de gemi hızından fazla gidemez
    expect(snap.y[1]).toBe(5000);
  });

  it('hız hilesi işe yaramaz: aşırı büyük yön değeri kırpılır, gerçek zamandan hızlı girdi akışı fazla adım attırmaz', async () => {
    const { client, playerId } = await pilot('HileciPilot');
    await placeAt(playerId, 5000, 5000);
    const { c } = await join(client);
    seq = 0;
    // 1 saniyede 100 girdi (gerçekte 20 olmalı), üstelik yön 50× büyütülmüş
    for (let k = 0; k < 10; k++) c.send({ t: 'in', i: dir(50, 0, 10) });
    // Konum yazmaya çalışan sahte mesajlar yok sayılır
    c.send({ t: 'pos', x: 19000, y: 5000 });
    c.send({ t: 'in', i: [[++seq, 1, 1, 0]], x: 19000 });
    await c.flush();
    ticks(20);
    await c.flush();
    ticks(2);
    await c.flush();
    const snap = c.last('snap')!;
    expect(snap.y[0] - 5000).toBeLessThanOrEqual(320 * (22 * TICK_MS) / 1000 + 1);
    expect(snap.y[0]).toBeLessThan(6000);
  });

  it('girdi kesilirse (sekme arka planda) yön girdisiyle giden gemi durur; hedef noktaya giden gemi devam eder', async () => {
    const { client, playerId } = await pilot('DuranPilot');
    await placeAt(playerId, 5000, 5000);
    const { c } = await join(client);
    seq = 0;
    c.send({ t: 'in', i: dir(1, 0, 4) });
    await c.flush();
    ticks(60);
    await c.flush();
    const stopped = c.last('snap')!;
    expect(stopped.y[2]).toBe(0); // vx = 0
    expect(stopped.y[0] - 5000).toBeLessThan(400);
    c.send({ t: 'in', i: [[++seq, 2, 5600, 5000]] });
    await c.flush();
    ticks(80);
    await c.flush();
    expect(c.last('snap')!.y[0]).toBeGreaterThan(5550);
  });

  it('konum toplu kaydedilir; çıkışta son konum veritabanına yazılır', async () => {
    const { client, playerId } = await pilot('KayitPilot');
    await placeAt(playerId, 5000, 5000);
    const { c } = await join(client);
    seq = 0;
    c.send({ t: 'in', i: dir(0, 1, 10) });
    await c.flush();
    ticks(10);
    await server.saveAll();
    let { rows } = await ctx.rt.db.query('SELECT pos_x, pos_y FROM players WHERE id = $1', [playerId]);
    expect(rows[0].pos_y).toBeGreaterThan(5050);
    ticks(10);
    const final = (await c.waitFor('snap', (m) => m.k === 20)).y;
    c.ws.close();
    await new Promise((r) => setTimeout(r, 200));
    ({ rows } = await ctx.rt.db.query('SELECT pos_x, pos_y FROM players WHERE id = $1', [playerId]));
    expect(rows[0].pos_y).toBeCloseTo(final[1], 0);
    expect(await ctx.rt.redis!.get(`game:presence:${playerId}`)).toBeNull();
  });
});

describe('ilgi alanı (AOI) ve çok oyunculu görünürlük', () => {
  it('radar menzilindeki pilot görünür (ad, şirket, gemi); menzil dışı ve başka haritadaki görünmez', async () => {
    const a = await pilot('AlfaPilot');
    const b = await pilot('BetaPilot');
    const far = await pilot('UzakPilot');
    const other = await pilot('GokboruPilot', 'GKB');
    await placeAt(a.playerId, 5000, 5000);
    await placeAt(b.playerId, 5800, 5300); // ~854 uzakta
    await placeAt(far.playerId, 9000, 5000); // 4000 uzakta
    const ca = await join(a.client);
    const cb = await join(b.client);
    await join(far.client);
    await join(other.client);
    ticks(2);
    const enter = await ca.c.waitFor('enter');
    expect(enter.e).toHaveLength(1);
    expect(enter.e[0]).toMatchObject({ id: cb.welcome.id, n: 'BetaPilot', cc: 'KZL', s: 'ship-kirlangic', l: 1 });
    const snap = ca.c.last('snap')!;
    expect(snap.e.map((e) => e[0])).toEqual([cb.welcome.id]);
    expect(snap.e[0]!.slice(1, 3)).toEqual([5800, 5300]);
    // B, A'yı da görür
    expect((await cb.c.waitFor('enter')).e.map((e) => e.n)).toEqual(['AlfaPilot']);
  });

  it('pilot uzaklaşınca "leave", yaklaşınca "enter" gönderilir; hareket diğer oyuncuya anlık görüntüyle yansır', async () => {
    const a = await pilot('IzleyenPilot');
    const b = await pilot('GezenPilot');
    await placeAt(a.playerId, 5000, 5000);
    await placeAt(b.playerId, 6200, 5000);
    const ca = await join(a.client);
    const cb = await join(b.client);
    ticks(2);
    await ca.c.waitFor('enter');
    seq = 0;
    // B sağa doğru uzaklaşır (≥ 400 birim/ 1500 menzili aşar)
    for (let k = 0; k < 8; k++) {
      cb.c.send({ t: 'in', i: dir(1, 0, 5) });
      await cb.c.flush();
      ticks(5);
    }
    const leave = await ca.c.waitFor('leave');
    expect(leave.e).toEqual([cb.welcome.id]);
    // Geri döner
    for (let k = 0; k < 10; k++) {
      cb.c.send({ t: 'in', i: dir(-1, 0, 5) });
      await cb.c.flush();
      ticks(5);
    }
    const enters = ca.c.messages.filter((m) => m.t === 'enter');
    expect(enters.length).toBe(2);
    const xs = ca.c.messages.filter((m): m is Extract<ServerMessage, { t: 'snap' }> => m.t === 'snap' && m.e.length > 0).map((m) => m.e[0]![1]);
    expect(Math.max(...xs)).toBeGreaterThan(6300);
  });
});

describe('geçit (WebSocket)', () => {
  it('geçidin yanındaki pilot atlar; yeni harita gönderilir, eski haritadakiler "leave" alır', async () => {
    const a = await pilot('AtlayanPilot');
    const b = await pilot('KalanPilot');
    const { rows } = await ctx.rt.db.query(
      `SELECT mp.id, mp.x, mp.y FROM map_portals mp JOIN maps m ON m.id = mp.map_id JOIN maps t ON t.id = mp.target_map_id
       WHERE m.code = 'K-1' AND t.code = 'K-2'`,
    );
    const portal = rows[0];
    await placeAt(a.playerId, portal.x - 200, portal.y);
    await placeAt(b.playerId, portal.x - 900, portal.y);
    const ca = await join(a.client);
    const cb = await join(b.client);
    ticks(2);
    await cb.c.waitFor('enter');
    ca.c.send({ t: 'jump', p: portal.id });
    const m = await ca.c.waitFor('map');
    expect(m.reason).toBe('portal');
    expect(m.map.map.code).toBe('K-2');
    ticks(2);
    expect((await cb.c.waitFor('leave')).e).toEqual([ca.welcome.id]);
    const presence = JSON.parse((await ctx.rt.redis!.get(`game:presence:${a.playerId}`))!);
    expect(presence.map).toBe('K-2');
  });

  it('uzaktaki geçit ve kilitli harita hata mesajı döner; pilot yerinde kalır', async () => {
    const a = await pilot('UzaktakiPilot');
    const { rows } = await ctx.rt.db.query(
      `SELECT mp.id, mp.x, mp.y, t.code FROM map_portals mp JOIN maps m ON m.id = mp.map_id JOIN maps t ON t.id = mp.target_map_id
       WHERE m.code = 'K-1' ORDER BY t.code`,
    );
    const toK2 = rows.find((r) => r.code === 'K-2');
    const toK3 = rows.find((r) => r.code === 'K-3');
    await placeAt(a.playerId, toK2.x - 2000, toK2.y);
    const { c } = await join(a.client);
    c.send({ t: 'jump', p: toK2.id });
    expect((await c.waitFor('error')).code).toBe('TOO_FAR_FROM_PORTAL');
    c.ws.close();
    await new Promise((r) => setTimeout(r, 150));
    await placeAt(a.playerId, toK3.x, toK3.y - 100);
    const again = await join(a.client);
    again.c.send({ t: 'jump', p: toK3.id });
    const e = await again.c.waitFor('error');
    expect(e).toMatchObject({ code: 'MAP_LOCKED', message: 'Bu haritaya girmek için en az seviye 5 olmalısın.' });
  });
});

describe('tek aktif oyun oturumu ve oturum güvenliği', () => {
  it('aynı hesap ikinci cihazdan girince ilk bağlantı "başka cihaz" mesajıyla kapanır; gemi devralınır', async () => {
    const { client, playerId } = await pilot('IkiCihazPilot');
    await placeAt(playerId, 5000, 5000);
    const first = await join(client);
    const phoneClient = (await registerAndLoginAgain(client)) ?? client;
    const second = await join(phoneClient);
    const kick = await first.c.waitFor('kick');
    expect(kick.code).toBe(CLOSE_CODES.REPLACED);
    expect(kick.message).toContain('başka bir cihazdan');
    expect((await first.c.closed).code).toBe(CLOSE_CODES.REPLACED);
    expect(second.welcome.id).toBe(first.welcome.id);
    expect(server.stats.players).toBe(1);
  });

  it('başka bir oyun sunucusu sürecinde açılan bağlantı da eskisini kapatır (Redis yayını)', async () => {
    const { client } = await pilot('SurecPilot');
    const first = await join(client);
    const extra = await startServer();
    extraServers.push(extra);
    await join(client, { port: extra.port });
    expect((await first.c.closed).code).toBe(CLOSE_CODES.REPLACED);
    await new Promise((r) => setTimeout(r, 100));
    expect(server.stats.players).toBe(0);
  });

  it('çıkış yapılan oturumun oyun bağlantısı kapatılır', async () => {
    const { client } = await pilot('CikanPilot');
    const { c } = await join(client);
    await call(ctx.app, client, 'POST', '/auth/logout', {});
    await server.checkSessions();
    expect((await c.closed).code).toBe(CLOSE_CODES.SESSION_ENDED);
  });

  it('saniyede çok fazla mesaj gönderen bağlantı kapatılır', async () => {
    const { client } = await pilot('SelPilot');
    const { c } = await join(client);
    for (let k = 0; k < 200; k++) c.send({ t: 'ping', c: k });
    expect((await c.closed).code).toBe(CLOSE_CODES.RATE_LIMITED);
  });
});

describe('bağlantı kopması: gemi bir süre haritada kalır', () => {
  it('kopan geminin haritada kalma süresinde geri dönülürse aynı gemi devam eder; süre bitince diğerleri "leave" alır', async () => {
    const extra = await startServer({ lingerSeconds: 1 });
    extraServers.push(extra);
    const a = await pilot('KopanPilot');
    const b = await pilot('GorenPilot');
    await placeAt(a.playerId, 5000, 5000);
    await placeAt(b.playerId, 5500, 5000);
    const ca = await join(a.client, { port: extra.port });
    const cb = await join(b.client, { port: extra.port });
    ticks(2, extra.s);
    await cb.c.waitFor('enter');
    ca.c.ws.close();
    await ca.c.closed;
    await new Promise((r) => setTimeout(r, 100));
    ticks(2, extra.s);
    expect(cb.c.messages.some((m) => m.t === 'leave')).toBe(false); // hâlâ görünüyor
    const back = await join(a.client, { port: extra.port });
    expect(back.welcome.id).toBe(ca.welcome.id);
    back.c.ws.close();
    await back.c.closed;
    await new Promise((r) => setTimeout(r, 1100));
    ticks(2, extra.s);
    expect((await cb.c.waitFor('leave')).e).toEqual([ca.welcome.id]);
  });
});

describe('yönetim ve hangar değişiklikleri canlı yansır', () => {
  it('oyundayken ekipman yalnızca istasyonda değişir; oyun dışında serbest; konfigürasyon her yerde değişir ve hız canlı güncellenir', async () => {
    const { client, playerId } = await pilot('IstasyonPilot');
    const hangar = (await call(ctx.app, client, 'GET', '/hangar?server=TR1')).json().hangar;
    const ship = hangar.ships[0];
    const laserSlot = { serverCode: 'TR1', shipId: ship.id, loadout: 1, slotType: 'laser', slotIndex: 0 };
    // Oyun dışında: serbest
    expect((await call(ctx.app, client, 'POST', '/hangar/unequip', laserSlot)).statusCode).toBe(200);

    await placeAt(playerId, 9000, 6000); // istasyon dışı
    const { c } = await join(client);
    const laser = (await call(ctx.app, client, 'GET', '/hangar?server=TR1')).json().hangar.inventory.find((i: { code: string }) => i.code === 'laser.ok1');
    const blocked = await call(ctx.app, client, 'POST', '/hangar/equip', { ...laserSlot, itemId: laser.id });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error).toMatchObject({ code: 'NOT_IN_STATION' });

    // Konfigürasyon değişimi uzayda serbest; hız 320 → 322 (İtki-1) canlı yansır
    expect((await call(ctx.app, client, 'POST', '/hangar/loadout', { serverCode: 'TR1', loadout: 2 })).statusCode).toBe(200);
    const update = await c.waitFor('pilot');
    expect(update.ship.speed).toBe(322);

    // İstasyona dönünce (K-1 istasyonu 1800,1800 r=700) ekipman değişir
    c.ws.close();
    await c.closed;
    await new Promise((r) => setTimeout(r, 150));
    await placeAt(playerId, 1900, 1800);
    await join(client);
    expect(JSON.parse((await ctx.rt.redis!.get(`game:presence:${playerId}`))!).station).toBe(true);
    expect((await call(ctx.app, client, 'POST', '/hangar/equip', { ...laserSlot, itemId: laser.id })).statusCode).toBe(200);
  });

  it('pilotun bulunduğu harita bakıma alınınca oyundaki pilot şirket haritasına taşınır ve bildirim alır', async () => {
    const { client, playerId } = await pilot('BakimdaPilot');
    await placeAt(playerId, 5000, 5000, 'K-2');
    const { c, welcome } = await join(client);
    expect(welcome.map.map.code).toBe('K-2');
    await ctx.rt.db.query(`UPDATE maps SET is_closed = true WHERE code = 'K-2'`);
    await server.checkMaps();
    const m = await c.waitFor('map');
    expect(m).toMatchObject({ reason: 'map_closed', map: { map: { code: 'K-1' } } });
    expect((await c.waitFor('notice')).text).toContain('bakım nedeniyle kapatıldı');
  });
});

describe('ağ bütçesi', () => {
  it('yoğun bölgede (10 pilot birbirini görürken) oyuncu başına indirme ≤ 15 KB/s (tasarım hedefi)', async () => {
    const list = [];
    for (let k = 0; k < 10; k++) list.push(await pilot(`Kalabalik${k}`));
    for (const [k, p] of list.entries()) await placeAt(p.playerId, 5000 + (k % 5) * 150, 5000 + Math.floor(k / 5) * 150);
    const conns = [];
    for (const p of list) conns.push((await join(p.client)).c);
    seq = 0;
    ticks(4); // giriş/görünürlük mesajları
    for (const c of conns) await c.flush();
    const start = conns.map((c) => c.bytes);
    // 1 sn: herkes hareket ederken 20 tik (10 anlık görüntü)
    for (let t = 0; t < 20; t++) {
      for (const c of conns) c.send({ t: 'in', i: [[++seq + 1000 * t, 1, Math.cos(t), Math.sin(t)]] });
      for (const c of conns) await c.flush();
      ticks(1);
    }
    for (const c of conns) await c.flush();
    const perSecond = conns.map((c, k) => c.bytes - start[k]! - 20 * 40); // flush'ın pong mesajları (~40 bayt) düşülür
    const max = Math.max(...perSecond);
    console.log(`[ağ bütçesi] 10 pilot görünürken oyuncu başına indirme: en fazla ${(max / 1024).toFixed(2)} KB/s`);
    expect(conns[0]!.last('snap')!.e).toHaveLength(9);
    expect(max).toBeLessThan(15 * 1024);
  });
});

/** Aynı hesaba ikinci bir cihazdan (ayrı oturum) giriş. */
async function registerAndLoginAgain(_c: Client): Promise<Client | null> {
  const phone = newClient({ ip: '176.88.1.1', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148 Safari/604.1' });
  const r = await call(ctx.app, phone, 'POST', '/auth/login', { identifier: 'IkiCihazPilot', password: 'Nebula-Kartal-77' });
  if (r.statusCode !== 200) return null;
  phone.csrf = r.json().csrfToken;
  return phone;
}
