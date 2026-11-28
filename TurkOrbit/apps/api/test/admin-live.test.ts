/**
 * Yönetim Merkezi → oyun sunucusu canlı yansıma (Aşama 14) — GERÇEK PostgreSQL + Redis + WebSocket.
 * 07 kabul ölçütü (Aşama 9'dan): "Yönetim Merkezi'nden can değişikliği canlı NPC'ye yansır".
 * Yönetici API'den yayımlar → Redis "game:admin" kanalı → oyun sunucusu → oyuncunun istemcisi.
 */
import { CLOSE_CODES, PROTOCOL_VERSION, type EntityInfo, type ServerMessage } from '@turkorbit/shared';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { GameServer } from '../src/game/server.js';
import { call, createTestContext, newClient, registerAndLogin, resetDatabase, WEB_ORIGIN, type Client, type TestContext } from './helpers.js';

let ctx: TestContext;
let server: GameServer;
let port: number;
let sub: Redis;
const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };
const clients: GameClient[] = [];

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.rt.db.query(`UPDATE npc_types SET hitpoints = 400, shield = 200, name = 'Çakal' WHERE code = 'cakal'`);
  await ctx.rt.db.query('UPDATE npc_spawns SET is_enabled = true');
  await ctx.close();
});
beforeEach(async () => {
  await resetDatabase(ctx.rt);
  await ctx.rt.db.query(`UPDATE npc_types SET hitpoints = 400, shield = 200, name = 'Çakal' WHERE code = 'cakal'`);
  // Yalnızca K-1'deki çakal alanları etkin (oda kurulunca NPC'ler hemen doğar)
  await ctx.rt.db.query(`UPDATE npc_spawns SET is_enabled = (map_id = (SELECT id FROM maps WHERE code = 'K-1') AND npc_type_id = (SELECT id FROM npc_types WHERE code = 'cakal'))`);
  sub = ctx.rt.redis!.duplicate();
  server = new GameServer({ db: ctx.rt.db, redis: ctx.rt.redis!, sub, log: silent, allowedOrigins: [WEB_ORIGIN], lingerSeconds: 0, autoTick: false, helloTimeoutMs: 2000 });
  port = await server.listen(0, '127.0.0.1');
});
afterEach(async () => {
  for (const c of clients) c.ws.terminate();
  clients.length = 0;
  await server.close();
  await sub.quit();
});

class GameClient {
  messages: ServerMessage[] = [];
  closed: Promise<{ code: number; reason: string }>;
  constructor(readonly ws: WebSocket) {
    ws.on('message', (d) => this.messages.push(JSON.parse(d.toString()) as ServerMessage));
    this.closed = new Promise((resolve) => ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() })));
  }
  send(msg: unknown) {
    this.ws.send(JSON.stringify(msg));
  }
  async waitFor<T extends ServerMessage['t']>(t: T, pred: (m: Extract<ServerMessage, { t: T }>) => boolean = () => true, timeout = 3000) {
    const deadline = Date.now() + timeout;
    for (;;) {
      const found = this.messages.find((m) => m.t === t && pred(m as Extract<ServerMessage, { t: T }>));
      if (found) return found as Extract<ServerMessage, { t: T }>;
      if (Date.now() > deadline) throw new Error(`"${t}" mesajı gelmedi. Gelenler: ${this.messages.map((m) => m.t).join(',')}`);
      await new Promise((r) => setTimeout(r, 25));
    }
  }
}

let ipSeq = 1;
async function user(username: string, roles: string[] = []) {
  const { client } = await registerAndLogin(ctx, username, { client: newClient({ ip: `95.10.${ipSeq++}.4` }) });
  const r = await call(ctx.app, client, 'POST', '/players', { serverCode: 'TR1', companyCode: 'KZL' });
  if (r.statusCode !== 201) throw new Error(r.body);
  for (const role of roles) await ctx.rt.db.query(`INSERT INTO user_roles (user_id, role_key) SELECT id, $2 FROM users WHERE username = $1`, [username, role]);
  const ids = (await ctx.rt.db.query<{ id: string; pid: string }>('SELECT u.id, p.id AS pid FROM users u JOIN players p ON p.user_id = u.id WHERE u.username = $1', [username])).rows[0]!;
  return { client, id: ids.id, pilotId: ids.pid, name: username };
}
type U = Awaited<ReturnType<typeof user>>;
const post = (u: U | Client, url: string, body?: unknown) => call(ctx.app, 'client' in u ? u.client : u, 'POST', url, body ?? {});

async function join(u: U, at?: { x: number; y: number }) {
  if (at) await ctx.rt.db.query(`UPDATE players SET pos_x = $2, pos_y = $3, map_id = (SELECT id FROM maps WHERE code = 'K-1') WHERE id = $1`, [u.pilotId, at.x, at.y]);
  const t = await post(u, '/game/ticket', { serverCode: 'TR1' });
  if (t.statusCode !== 200) throw new Error(t.body);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/game`, { headers: { origin: WEB_ORIGIN } });
  await new Promise<void>((res, rej) => {
    ws.once('open', () => res());
    ws.once('error', rej);
  });
  const c = new GameClient(ws);
  clients.push(c);
  c.send({ t: 'hello', v: PROTOCOL_VERSION, ticket: t.json().ticket });
  await c.waitFor('welcome');
  return c;
}

const until = async (cond: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('koşul zamanında sağlanmadı');
    await new Promise((r) => setTimeout(r, 25));
  }
};
type Room = { npcs: Map<number, { entityId: number; hp: number; maxHp: number; shield: number; maxShield: number; info: EntityInfo; type: { code: string } }> };
const room = () => (server as unknown as { rooms: Map<string, Room> }).rooms.get('K-1')!;
const tick = (n = 1) => {
  for (let i = 0; i < n; i++) server.tick();
};

describe('Yönetim Merkezi → oyun sunucusu canlı yansıma', () => {
  it('NPC CANI DEĞİŞİNCE OYUNDA DEĞİŞİR: yaşayan NPC oranı korunarak ölçeklenir, oyuncu yeni azami canı görür; geri alınca eski değer', async () => {
    const cm = await user('CanliIcerik', ['content_manager']);
    const ga = await user('CanliGeriAl', ['game_admin']);
    const p = await user('CanliPilot');
    const c = await join(p, { x: 2804, y: 7054 });
    tick(3);
    const npcs = [...room().npcs.values()].filter((n) => n.type.code === 'cakal');
    expect(npcs.length).toBeGreaterThan(5);
    expect(npcs.every((n) => n.maxHp === 400 && n.info.mh === 400)).toBe(true);
    // Oyuncu çevresindeki çakalları 400 azami canla görür
    await c.waitFor('enter', (m) => m.e.some((e) => e.n === 'Çakal' && e.mh === 400));
    // Bir çakal yarı canlı
    const hurt = npcs[0]!;
    hurt.hp = 200;
    const cakalId = (await ctx.rt.db.query<{ id: number }>(`SELECT id FROM npc_types WHERE code = 'cakal'`)).rows[0]!.id;
    const d = (await post(cm, `/admin/content/npc_type/${cakalId}/drafts`, { changes: { hitpoints: 1000, name: 'Çakal Reisi' } })).json().content;
    c.messages.length = 0;
    expect((await post(cm, `/admin/content/npc_type/revisions/${d.draft.id}/publish`)).statusCode).toBe(200);
    // Redis üzerinden oyun sunucusuna ulaşır
    await until(() => hurt.maxHp === 1000);
    expect(hurt.hp).toBe(500); // oran korunur (%50)
    expect([...room().npcs.values()].filter((n) => n.type.code === 'cakal').every((n) => n.maxHp === 1000 && n.info.n === 'Çakal Reisi')).toBe(true);
    tick(2);
    // Oyuncu bir sonraki anlık görüntüde güncel adı ve azami canı alır
    const enter = await c.waitFor('enter', (m) => m.e.some((e) => e.n === 'Çakal Reisi'));
    expect(enter.e.find((e) => e.n === 'Çakal Reisi')!.mh).toBe(1000);
    // Geri alma da canlı uygulanır
    const v1 = (await call(ctx.app, ga.client, 'GET', `/admin/content/npc_type/${cakalId}`)).json().content.revisions.find((v: { version: number }) => v.version === 1).id;
    expect((await post(ga, `/admin/content/npc_type/revisions/${v1}/rollback`)).statusCode).toBe(200);
    await until(() => hurt.maxHp === 400);
    expect(hurt.info.n).toBe('Çakal');
  });

  it('askı: oyundaki pilot gerekçeli mesajla anında atılır; susturma sohbeti keser; duyuru herkese ulaşır', async () => {
    const mod = await user('CanliNobet', ['moderator']);
    const p = await user('CanliSuclu');
    const other = await user('CanliTanik');
    const c = await join(p);
    const o = await join(other);
    // Susturma: sohbet mesajı reddedilir
    await post(mod, `/admin/players/${p.id}/mute`, { reason: 'Küfür', hours: 1 });
    await new Promise((r) => setTimeout(r, 150));
    c.send({ t: 'chat', ch: 'global', b: 'merhaba' });
    await c.waitFor('notice', (m) => m.text.startsWith('Susturuldun'));
    // Duyuru
    const sys = await user('CanliBakim', ['system_admin']);
    await post(sys, '/admin/system/broadcast', { text: 'Sunucu 10 dk sonra yeniden başlayacak.', reason: 'Bakım duyurusu' });
    await o.waitFor('notice', (m) => m.text === '📢 Sunucu 10 dk sonra yeniden başlayacak.');
    await c.waitFor('notice', (m) => m.text.includes('10 dk sonra'));
    // Askı: bağlantı gerekçeyle kapanır
    await post(mod, `/admin/players/${p.id}/suspend`, { reason: 'Hile', publicReason: 'Otomatik ateş programı', hours: 24 });
    const kick = await c.waitFor('kick');
    expect(kick.code).toBe(CLOSE_CODES.SESSION_ENDED);
    expect(kick.message).toContain('askıya alındı');
    expect(kick.message).toContain('Otomatik ateş programı');
    expect((await c.closed).code).toBe(CLOSE_CODES.SESSION_ENDED);
    // Diğer pilot etkilenmez
    expect(o.ws.readyState).toBe(WebSocket.OPEN);
  });

  it('bakım modu: oyundaki oyuncu atılır, personel kalır; bakımdayken bilet alınamaz; pano oyun sunucusu nabzını gösterir', async () => {
    const sys = await user('CanliAltyapi', ['system_admin']);
    const staff = await user('CanliPersonel', ['moderator']);
    const p = await user('CanliOyuncu');
    const sc = await join(staff);
    const c = await join(p);
    await server.writeHeartbeat();
    const dash = (await call(ctx.app, sys.client, 'GET', '/admin/system')).json();
    expect(dash.nodes).toHaveLength(1);
    expect(dash.nodes[0]).toMatchObject({ players: 2, rooms: 1, maps: { 'K-1': 2 } });
    expect(dash.online).toBe(2);
    await post(sys, '/admin/system/maintenance', { enabled: true, message: 'Planlı bakım: 30 dakika.', reason: 'Veritabanı bakımı' });
    const kick = await c.waitFor('kick');
    expect(kick).toMatchObject({ code: CLOSE_CODES.MAINTENANCE, message: 'Planlı bakım: 30 dakika.' });
    expect((await c.closed).code).toBe(CLOSE_CODES.MAINTENANCE);
    expect(sc.ws.readyState).toBe(WebSocket.OPEN);
    expect((await post(p, '/game/ticket', { serverCode: 'TR1' })).json().error.code).toBe('MAINTENANCE');
    await post(sys, '/admin/system/maintenance', { enabled: false, message: 'Bakım bitti.', reason: 'Tamamlandı' });
    await new Promise((r) => setTimeout(r, 150));
    const again = await join(p);
    expect(again.ws.readyState).toBe(WebSocket.OPEN);
  });
});
