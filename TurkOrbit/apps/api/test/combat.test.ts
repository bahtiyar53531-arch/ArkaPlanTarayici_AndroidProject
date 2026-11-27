/**
 * Savaş entegrasyon testleri (Aşama 9): GERÇEK WebSocket + PostgreSQL + Redis.
 * Her test kendi NPC türünü/doğma noktasını ekler; tik elle ilerletilir; rastgelelik sabittir (rng = 0.5).
 */
import { PROTOCOL_VERSION, type ServerMessage } from '@turkorbit/shared';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { GameServer } from '../src/game/server.js';
import { call, createTestContext, newClient, registerAndLogin, resetDatabase, WEB_ORIGIN, type Client, type TestContext } from './helpers.js';

let ctx: TestContext;
let server: GameServer | null = null;
let sub: Redis | null = null;
let port = 0;
const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await cleanupContent();
  await ctx.rt.db.query('UPDATE npc_spawns SET is_enabled = true');
  await ctx.close();
});
beforeEach(async () => {
  await resetDatabase(ctx.rt);
  await cleanupContent();
  await ctx.rt.db.query('UPDATE npc_spawns SET is_enabled = false');
});
afterEach(async () => {
  for (const c of clients) c.ws.terminate();
  clients.length = 0;
  if (server) await server.close();
  if (sub) await sub.quit();
  server = null;
  sub = null;
});

async function cleanupContent() {
  await ctx.rt.db.query(`DELETE FROM npc_spawns WHERE npc_type_id IN (SELECT id FROM npc_types WHERE code LIKE 'test-%')`);
  await ctx.rt.db.query(`DELETE FROM npc_kill_log WHERE npc_type_id IN (SELECT id FROM npc_types WHERE code LIKE 'test-%')`);
  await ctx.rt.db.query(`DELETE FROM combat_deaths WHERE killer_npc_type_id IN (SELECT id FROM npc_types WHERE code LIKE 'test-%')`);
  await ctx.rt.db.query(`DELETE FROM npc_types WHERE code LIKE 'test-%'`);
  await ctx.rt.db.query(`DELETE FROM reward_tables WHERE code LIKE 'npc.test-%'`);
}

interface NpcSpec {
  code: string;
  map: string;
  x: number;
  y: number;
  hp?: number;
  shield?: number;
  absorb?: number;
  damage?: number;
  range?: number;
  speed?: number;
  ai?: Record<string, unknown>;
  xp?: number;
  rewards?: Array<{ type: string; ref: string; min: number; max: number; chance?: number; delivery?: 'direct' | 'cargo' }>;
  count?: number;
  respawn?: number;
}

/** Test NPC türü + doğma noktası (sunucu başlamadan önce eklenmeli: içerik açılışta okunur). */
async function addNpc(s: NpcSpec) {
  const rt = (await ctx.rt.db.query(`INSERT INTO reward_tables (code, name) VALUES ($1, 'Test') RETURNING id`, [`npc.${s.code}`])).rows[0].id;
  const t = (
    await ctx.rt.db.query(
      `INSERT INTO npc_types (code, name, family, level, sprite_key, hitpoints, shield, shield_absorb, damage, attack_rate_ms, attack_range, speed, ai, experience, reward_table_id)
       VALUES ($1, $2, 'cakal', 1, 'npc-cakal', $3, $4, $5, $6, 1000, $7, $8, $9, $10, $11) RETURNING id`,
      [s.code, `Test ${s.code}`, s.hp ?? 120, s.shield ?? 0, s.absorb ?? 0, s.damage ?? 0, s.range ?? 500, s.speed ?? 1, JSON.stringify(s.ai ?? { behavior: 'passive' }), s.xp ?? 0, rt],
    )
  ).rows[0].id;
  for (const r of s.rewards ?? []) {
    await ctx.rt.db.query(
      `INSERT INTO reward_entries (reward_table_id, reward_type, ref_code, min_amount, max_amount, chance, delivery) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [rt, r.type, r.ref, r.min, r.max, r.chance ?? 1, r.delivery ?? 'direct'],
    );
  }
  await ctx.rt.db.query(
    `INSERT INTO npc_spawns (map_id, npc_type_id, area, max_alive, respawn_seconds) VALUES ((SELECT id FROM maps WHERE code = $1), $2, $3, $4, $5)`,
    [s.map, t, JSON.stringify({ type: 'circle', x: s.x, y: s.y, r: 1 }), s.count ?? 1, s.respawn ?? 1],
  );
}

async function start() {
  sub = ctx.rt.redis!.duplicate();
  server = new GameServer({
    db: ctx.rt.db,
    redis: ctx.rt.redis!,
    sub,
    log: silent,
    allowedOrigins: [WEB_ORIGIN],
    lingerSeconds: 0,
    autoTick: false,
    rng: () => 0.5,
  });
  port = await server.listen(0, '127.0.0.1');
}

class GameClient {
  messages: ServerMessage[] = [];
  closed: Promise<number>;
  constructor(readonly ws: WebSocket) {
    ws.on('message', (d) => this.messages.push(JSON.parse(d.toString()) as ServerMessage));
    this.closed = new Promise((r) => ws.on('close', (code) => r(code)));
  }
  send(m: unknown) {
    this.ws.send(JSON.stringify(m));
  }
  async waitFor<T extends ServerMessage['t']>(t: T, pred: (m: Extract<ServerMessage, { t: T }>) => boolean = () => true, ms = 3000) {
    const end = Date.now() + ms;
    for (;;) {
      const m = this.messages.find((x) => x.t === t && pred(x as Extract<ServerMessage, { t: T }>));
      if (m) return m as Extract<ServerMessage, { t: T }>;
      if (Date.now() > end) throw new Error(`"${t}" gelmedi: ${[...new Set(this.messages.map((x) => x.t))].join(',')}`);
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  last<T extends ServerMessage['t']>(t: T) {
    return [...this.messages].reverse().find((m) => m.t === t) as Extract<ServerMessage, { t: T }> | undefined;
  }
  all<T extends ServerMessage['t']>(t: T) {
    return this.messages.filter((m) => m.t === t) as Array<Extract<ServerMessage, { t: T }>>;
  }
  async flush() {
    const c = Math.random();
    this.send({ t: 'ping', c });
    await this.waitFor('pong', (m) => m.c === c);
  }
}
const clients: GameClient[] = [];

async function pilot(username: string, company = 'KZL') {
  const { client } = await registerAndLogin(ctx, username, { client: newClient({ ip: `85.108.${Math.floor(Math.random() * 200)}.1` }) });
  const r = await call(ctx.app, client, 'POST', '/players', { serverCode: 'TR1', companyCode: company });
  if (r.statusCode !== 201) throw new Error(r.body);
  return { client, playerId: r.json().pilot.id as string };
}

async function join(client: Client) {
  const t = (await call(ctx.app, client, 'POST', '/game/ticket', { serverCode: 'TR1' })).json().ticket;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/game`, { headers: { origin: WEB_ORIGIN } });
  await new Promise<void>((res, rej) => (ws.once('open', () => res()), ws.once('error', rej)));
  const c = new GameClient(ws);
  clients.push(c);
  c.send({ t: 'hello', v: PROTOCOL_VERSION, ticket: t });
  const welcome = await c.waitFor('welcome');
  return { c, welcome };
}

const place = (playerId: string, x: number, y: number, map = 'K-1') =>
  ctx.rt.db.query(`UPDATE players SET pos_x = $2, pos_y = $3, map_id = (SELECT id FROM maps WHERE code = $4) WHERE id = $1`, [playerId, x, y, map]);

/** Tik ilerletir ve istemcinin o ana kadarki mesajları almasını bekler. */
async function run(c: GameClient, n: number) {
  await c.flush(); // önce gönderilen niyetler sunucuda işlensin
  for (let i = 0; i < n; i++) server!.tick();
  await c.flush();
}

const npcEntity = async (c: GameClient, name?: string) => {
  await run(c, 2);
  const e = c.all('enter').flatMap((m) => m.e).find((x) => x.k === 'n' && (!name || x.n === name));
  if (!e) throw new Error('NPC görünmedi');
  return e;
};

// ------------------------------------------------------------------ testler
describe('hedef ve lazer ateşi', () => {
  it('seçilen NPC lazerin atış hızıyla vurulur; hasar = lazer × mühimmat çarpanı; her atış bir mühimmat harcar', async () => {
    await addNpc({ code: 'test-hedef', map: 'K-1', x: 5300, y: 5000, hp: 1000 });
    await start();
    const { playerId, client } = await pilot('NisanciPilot');
    await place(playerId, 5000, 5000);
    const { c } = await join(client);
    const npc = await npcEntity(c);
    expect(npc).toMatchObject({ k: 'n', n: 'Test test-hedef' });
    c.send({ t: 'target', id: npc.id });
    c.send({ t: 'attack', on: true });
    await c.flush();
    await run(c, 42); // ~2 sn → 3 atış (0, 1000, 2000 ms) + anlık görüntü
    const n = server!.npcsOn('K-1')[0]!;
    expect(1000 - n.hp).toBe(3 * 40);
    const cs = c.last('cs')!;
    expect(cs).toMatchObject({ target: npc.id, attacking: true, ammo: 'ammo.isk1', laserRange: 600 });
    expect(cs.counts['ammo.isk1']).toBe(2000 - 3);
    // Efektler: lazer + hasar sayısı
    const fx = c.all('snap').flatMap((s) => s.fx ?? []);
    expect(fx.filter((f) => f[0] === 'l').length).toBe(3);
    expect(fx.find((f) => f[0] === 'd')).toEqual(['d', npc.id, 40, 0]);
  });

  it('menzil dışındaki hedefe ateş edilmez; radar dışındaki varlık hedeflenemez', async () => {
    await addNpc({ code: 'test-uzak', map: 'K-1', x: 6000, y: 5000, hp: 1000 });
    await start();
    const { playerId, client } = await pilot('MenzilPilot');
    await place(playerId, 5000, 5000);
    const { c } = await join(client);
    const npc = await npcEntity(c);
    c.send({ t: 'target', id: npc.id });
    c.send({ t: 'attack', on: true });
    await run(c, 40);
    expect(server!.npcsOn('K-1')[0]!.hp).toBe(1000); // 1000 birim > 600 menzil
    c.send({ t: 'target', id: 999999 });
    await run(c, 2);
    expect(c.last('cs')!.target).toBeNull();
  });

  it('istemci atış hızını hızlandıramaz: saniyede onlarca ateş/hedef mesajı tek atış aralığını değiştirmez', async () => {
    await addNpc({ code: 'test-hiz', map: 'K-1', x: 5300, y: 5000, hp: 5000 });
    await start();
    const { playerId, client } = await pilot('SpamPilot');
    await place(playerId, 5000, 5000);
    const { c } = await join(client);
    const npc = await npcEntity(c);
    for (let i = 0; i < 20; i++) {
      c.send({ t: 'target', id: npc.id });
      c.send({ t: 'attack', on: true });
      server!.tick();
    }
    await run(c, 1);
    expect(5000 - server!.npcsOn('K-1')[0]!.hp).toBeLessThanOrEqual(2 * 40);
  });
});

describe('NPC ölümü, ödül ve kargo', () => {
  it('ödül defterli verilir (Kredi + deneyim + seviye atlama + istatistik); kargo kutusu toplanınca envantere eklenir; mühimmat defterden düşer', async () => {
    await addNpc({
      code: 'test-odul', map: 'K-1', x: 5300, y: 5000, hp: 120, xp: 6000,
      rewards: [
        { type: 'currency', ref: 'KREDI', min: 500, max: 500 },
        { type: 'currency', ref: 'AKCE', min: 3, max: 3, chance: 0.3 }, // rng 0.5 ≥ 0.3 → verilmez
        { type: 'item', ref: 'ammo.isk1', min: 30, max: 30, delivery: 'cargo' },
      ],
    });
    await start();
    const { playerId, client } = await pilot('AvciPilot');
    await place(playerId, 5000, 5000);
    const { c } = await join(client);
    const npc = await npcEntity(c);
    c.send({ t: 'target', id: npc.id });
    c.send({ t: 'attack', on: true });
    await run(c, 50); // 3 atış (120 can)
    await server!.idle();
    await c.flush();
    const reward = await c.waitFor('reward');
    expect(reward).toMatchObject({ source: 'Test test-odul yok edildi', xp: 6000, currencies: [{ code: 'KREDI', amount: 500 }], level: 2, levelUp: true });
    expect(c.all('snap').flatMap((s) => s.fx ?? []).some((f) => f[0] === 'x' && f[1] === npc.id)).toBe(true);
    expect(c.last('cs')).toMatchObject({ target: null, attacking: false });
    const ledger = await ctx.rt.db.query(`SELECT currency_code, delta, reason, ref_type FROM currency_ledger WHERE player_id = $1 AND reason = 'npc_reward'`, [playerId]);
    expect(ledger.rows).toEqual([{ currency_code: 'KREDI', delta: '500', reason: 'npc_reward', ref_type: 'npc_kill' }]);
    const p = await ctx.rt.db.query(`SELECT p.experience, s.npc_kills FROM players p JOIN player_stats s ON s.player_id = p.id WHERE p.id = $1`, [playerId]);
    expect(p.rows[0]).toEqual({ experience: '6000', npc_kills: '1' });
    expect((await ctx.rt.db.query('SELECT count(*)::int AS n FROM npc_kill_log WHERE player_id = $1', [playerId])).rows[0].n).toBe(1);

    // Kargo kutusu (kargo algılama menzilinde görünür) → üzerine uçup topla
    const box = c.all('enter').flatMap((m) => m.e).find((x) => x.k === 'c')!;
    expect(box).toBeTruthy();
    const pos = c.last('snap')!.e.find((e) => e[0] === box.id)!;
    c.send({ t: 'in', i: [[1, 2, pos[1], pos[2]]] });
    await c.flush();
    for (let i = 0; i < 60 && !c.messages.some((m) => m.t === 'reward' && m.source === 'Kargo kutusu toplandı'); i++) {
      c.send({ t: 'in', i: [[i + 2, 2, pos[1], pos[2]]] });
      await run(c, 1);
      await server!.idle();
    }
    const loot = await c.waitFor('reward', (m) => m.source === 'Kargo kutusu toplandı');
    expect(loot.items).toEqual([{ code: 'ammo.isk1', name: 'IŞK-1 Batarya', amount: 30 }]);
    await run(c, 2);
    expect(c.last('cs')!.counts['ammo.isk1']).toBe(2000 - 3 + 30);
    // Harcanan mühimmat toplu olarak defterden düşülür
    await server!.saveAll();
    const items = await ctx.rt.db.query(
      `SELECT l.reason, sum(l.delta)::int AS d FROM item_ledger l JOIN item_types t ON t.id = l.item_type_id
       WHERE l.player_id = $1 AND t.code = 'ammo.isk1' GROUP BY l.reason ORDER BY l.reason`,
      [playerId],
    );
    expect(items.rows).toEqual([{ reason: 'ammo_used', d: -3 }, { reason: 'cargo_loot', d: 30 }, { reason: 'starter_kit', d: 2000 }]);
    const q = await ctx.rt.db.query(`SELECT pi.quantity FROM player_items pi JOIN item_types t ON t.id = pi.item_type_id WHERE pi.player_id = $1 AND t.code = 'ammo.isk1'`, [playerId]);
    expect(Number(q.rows[0].quantity)).toBe(2027);
  });

  it('birden çok pilot vurursa ödül hasar katkısına göre bölünür; eşya ve öldürme kaydı en çok hasar verene; haritadan ayrılanın payı kimseye verilmez', async () => {
    await addNpc({
      code: 'test-ortak', map: 'K-1', x: 5300, y: 5000, hp: 400, xp: 1000,
      rewards: [
        { type: 'currency', ref: 'KREDI', min: 1000, max: 1000 },
        { type: 'item', ref: 'ammo.isk2', min: 50, max: 50 },
      ],
    });
    await start();
    const a = await pilot('OrtakA');
    const b = await pilot('OrtakB');
    const cc = await pilot('OrtakC');
    await place(a.playerId, 5000, 5000);
    await place(b.playerId, 5000, 5050);
    await place(cc.playerId, 5000, 4950);
    const ca = (await join(a.client)).c;
    const cb = (await join(b.client)).c;
    const ccl = (await join(cc.client)).c;
    const npc = await npcEntity(ca);
    // C bir atış yapar (40 = %10) ve oyundan çıkar → payı kimseye verilmez
    ccl.send({ t: 'target', id: npc.id });
    ccl.send({ t: 'attack', on: true });
    await run(ccl, 2);
    ccl.ws.close();
    await ccl.closed;
    // A üç atış (120), sonra B de katılır
    ca.send({ t: 'target', id: npc.id });
    ca.send({ t: 'attack', on: true });
    await run(ca, 42);
    expect(server!.npcsOn('K-1')[0]!.hp).toBe(400 - 40 - 120);
    cb.send({ t: 'target', id: npc.id });
    cb.send({ t: 'attack', on: true });
    for (let i = 0; i < 20 && server!.npcsOn('K-1').length > 0; i++) await run(cb, 10);
    expect(server!.npcsOn('K-1')).toHaveLength(0);
    await server!.idle();
    await ca.flush();
    await cb.flush();
    const ra = await ca.waitFor('reward');
    const rb = await cb.waitFor('reward');
    expect(ra.share! + rb.share!).toBeCloseTo(0.9, 3);
    expect(ra.share!).toBeGreaterThan(rb.share!);
    expect(rb.share!).toBeGreaterThan(0.1);
    expect(ra.source).toBe(`Test test-ortak yok edildi (katkın %${Math.round(ra.share! * 100)})`);
    const kredi = (r: typeof ra) => r.currencies.find((x) => x.code === 'KREDI')!.amount;
    expect(kredi(rb)).toBe(Math.floor(1000 * rb.share! + 1e-9));
    expect(kredi(ra) + kredi(rb)).toBe(900);
    expect(ra.xp + rb.xp).toBe(900);
    expect(ra.items).toEqual([{ code: 'ammo.isk2', name: expect.any(String), amount: 50 }]);
    expect(rb.items).toEqual([]);
    // Defter ve kayıtlar
    const led = await ctx.rt.db.query(
      `SELECT player_id, sum(delta)::int AS d, count(*)::int AS n FROM currency_ledger WHERE reason = 'npc_reward' GROUP BY player_id`,
    );
    expect(Object.fromEntries(led.rows.map((r) => [r.player_id, r.d]))).toEqual({ [a.playerId]: kredi(ra), [b.playerId]: kredi(rb) });
    const kills = await ctx.rt.db.query('SELECT player_id FROM npc_kill_log WHERE npc_type_id = (SELECT id FROM npc_types WHERE code = $1)', ['test-ortak']);
    expect(kills.rows).toEqual([{ player_id: a.playerId }]);
    const stats = await ctx.rt.db.query('SELECT player_id, npc_kills FROM player_stats WHERE npc_kills > 0');
    expect(stats.rows).toEqual([{ player_id: a.playerId, npc_kills: '1' }]);
    const xp = await ctx.rt.db.query('SELECT id, experience::int AS xp FROM players WHERE id = ANY($1)', [[a.playerId, b.playerId, cc.playerId]]);
    expect(Object.fromEntries(xp.rows.map((r) => [r.id, r.xp]))).toEqual({ [a.playerId]: ra.xp, [b.playerId]: rb.xp, [cc.playerId]: 0 });
  });

  it('kargo kutusu kısa süre kazanana aittir; süre dolunca başkası alabilir; NPC süre sonunda yeniden doğar', async () => {
    await addNpc({ code: 'test-kutu', map: 'K-1', x: 5300, y: 5000, hp: 40, rewards: [{ type: 'item', ref: 'ammo.isk1', min: 10, max: 10, delivery: 'cargo' }], respawn: 2 });
    await start();
    const a = await pilot('KazananPilot');
    const b = await pilot('BekleyenPilot');
    await place(a.playerId, 5000, 5000);
    await place(b.playerId, 5300, 5000); // NPC'nin (ve kutunun) üstünde
    const ca = await join(a.client);
    const cb = await join(b.client);
    const npc = await npcEntity(ca.c);
    ca.c.send({ t: 'target', id: npc.id });
    ca.c.send({ t: 'attack', on: true });
    await run(ca.c, 4);
    await run(cb.c, 20);
    expect(cb.c.messages.some((m) => m.t === 'reward')).toBe(false); // kutu A'ya ait
    expect(server!.npcsOn('K-1')).toHaveLength(0);
    await run(cb.c, 20); // 2 sn → NPC yeniden doğar
    expect(server!.npcsOn('K-1')).toHaveLength(1);
    await run(cb.c, 300); // 15 sn sahiplik süresi doldu
    await server!.idle();
    await cb.c.flush();
    expect((await cb.c.waitFor('reward')).items[0]).toMatchObject({ code: 'ammo.isk1', amount: 10 });
  });
});

describe('NPC yapay zekâsı ve pilotun ölümü', () => {
  it('saldırgan NPC yaklaşan pilota saldırır; zehir zamanla hasar verir, yavaşlatma hızı düşürür', async () => {
    await addNpc({
      code: 'test-akrep', map: 'K-1', x: 5400, y: 5000, damage: 200, range: 600, speed: 300,
      ai: { behavior: 'aggressive', aggro_range: 700, poison: { ratio: 0.5, ms: 1000 }, slow: { factor: 0.5, ms: 3000 } },
      hp: 50000,
    });
    await start();
    const { playerId, client } = await pilot('KurbanPilot');
    await place(playerId, 5000, 5000);
    const { c } = await join(client);
    await run(c, 2);
    const st1 = c.last('snap')!.st;
    // İlk tikte 200 hasar: %50 kalkana (100), %50 gövdeye (100); ardından zehir tik başına 5 (200×0,5 / 20 tik)
    expect(st1[2]).toBe(900);
    expect(st1[0]).toBe(3895);
    expect(st1[4]).toBe(160); // 320 × 0.5 yavaşlatma
    await run(c, 20);
    expect(c.last('snap')!.st[0]).toBeLessThan(3895 - 50); // zehir + ikinci vuruş
    expect(c.all('snap').flatMap((s) => s.fx ?? []).some((f) => f[0] === 'l' && f[3] === 9)).toBe(true); // NPC ışını
  });

  it('NPC güvenli bölgedeki pilota saldırmaz ve güvenli bölgeye giremez', async () => {
    // K-1 güvenli bölge: (1800,1800) r=2200 → x=4100'de sınır dışı
    await addNpc({ code: 'test-sinir', map: 'K-1', x: 4300, y: 1800, damage: 500, range: 600, speed: 400, ai: { behavior: 'aggressive', aggro_range: 1500 }, hp: 50000 });
    await start();
    const { playerId, client } = await pilot('SiginanPilot');
    await place(playerId, 3700, 1800); // güvenli bölge içinde, NPC'ye 600 uzaklıkta
    const { c } = await join(client);
    await run(c, 60);
    expect(c.last('snap')!.st.slice(0, 3)).toEqual([4000, 4000, 1000]);
    const n = server!.npcsOn('K-1')[0]!;
    expect(Math.hypot(n.x - 1800, n.y - 1800)).toBeGreaterThan(2200);
  });

  it('pilot ölür (ölüm kaydı, gemi canı 0); "yeniden doğ" ile ana haritadaki istasyonda %10 canla başlar', async () => {
    await addNpc({ code: 'test-dev', map: 'K-2', x: 5300, y: 5000, damage: 9000, range: 600, ai: { behavior: 'aggressive', aggro_range: 700 }, hp: 99999 });
    await start();
    const { playerId, client } = await pilot('OlenPilot');
    await place(playerId, 5000, 5000, 'K-2');
    const { c } = await join(client);
    await run(c, 4);
    const dead = await c.waitFor('dead');
    expect(dead).toMatchObject({ by: 'Test test-dev', kind: 'npc' });
    await server!.idle();
    const d = await ctx.rt.db.query(`SELECT killer_kind FROM combat_deaths WHERE player_id = $1`, [playerId]);
    expect(d.rows).toEqual([{ killer_kind: 'npc' }]);
    const hp0 = await ctx.rt.db.query(`SELECT ps.hitpoints, s.deaths FROM players p JOIN player_ships ps ON ps.id = p.active_ship_id JOIN player_stats s ON s.player_id = p.id WHERE p.id = $1`, [playerId]);
    expect(hp0.rows[0]).toEqual({ hitpoints: 0, deaths: '1' });
    // Ölüyken hareket ve geçit yok
    c.send({ t: 'in', i: [[1, 1, 1, 0]] });
    await run(c, 10);
    expect(c.last('snap')!.y.slice(0, 2)).toEqual([5000, 5000]);
    c.send({ t: 'respawn' });
    const m = await c.waitFor('map', (x) => x.reason === 'respawn');
    expect(m.map.map.code).toBe('K-1');
    await run(c, 2);
    expect(c.last('snap')!.st[0]).toBe(400);
    const hp1 = await ctx.rt.db.query(`SELECT ps.hitpoints FROM players p JOIN player_ships ps ON ps.id = p.active_ship_id WHERE p.id = $1`, [playerId]);
    expect(hp1.rows[0].hitpoints).toBe(400);
  });

  it('gemisi yok edilmiş pilot (ör. bağlantı kopukken) tekrar bağlanınca istasyonda doğar ve bildirim alır', async () => {
    await start();
    const { playerId, client } = await pilot('KopukPilot');
    await place(playerId, 5000, 5000, 'K-3');
    await ctx.rt.db.query(`UPDATE player_ships SET hitpoints = 0 WHERE player_id = $1`, [playerId]);
    const { c, welcome } = await join(client);
    expect(welcome.map.map.code).toBe('K-1');
    expect(welcome.map.pilot.ship.hitpoints).toBe(400);
    expect((await c.waitFor('notice')).text).toContain('yeniden doğdun');
  });
});

describe('PvP kuralları', () => {
  it('aynı şirket ve PvP kapalı harita engellenir; düşman şirket PvP haritasında vurulur; yenen şeref kazanır', async () => {
    await start();
    const a = await pilot('SaldiranPilot', 'KZL');
    const b = await pilot('DusmanPilot', 'GKB');
    const c2 = await pilot('DostPilot', 'KZL');
    await place(a.playerId, 5000, 5000, 'K-2');
    await place(b.playerId, 5300, 5000, 'K-2');
    await place(c2.playerId, 5000, 5300, 'K-2');
    await ctx.rt.db.query(`UPDATE player_ships SET hitpoints = 50 WHERE player_id = $1`, [b.playerId]);
    const ca = await join(a.client);
    const cb = await join(b.client);
    const cc = await join(c2.client);
    await run(ca.c, 2);
    // Aynı şirket
    ca.c.send({ t: 'target', id: cc.welcome.id });
    ca.c.send({ t: 'attack', on: true });
    await run(ca.c, 4);
    expect((await ca.c.waitFor('notice')).text).toBe('Kendi şirketinden pilota saldıramazsın.');
    expect(cc.c.last('snap') ?? null).not.toBeNull();
    // Düşman şirket
    ca.c.send({ t: 'target', id: cb.welcome.id });
    ca.c.send({ t: 'attack', on: true });
    await run(ca.c, 60);
    await run(cb.c, 1);
    expect(await cb.c.waitFor('dead')).toMatchObject({ by: 'SaldiranPilot', kind: 'player' });
    await server!.idle();
    await ca.c.flush();
    expect(await ca.c.waitFor('reward')).toMatchObject({ source: 'DusmanPilot yenildi', honor: 100 });
    const r = await ctx.rt.db.query(`SELECT p.honor, s.player_kills FROM players p JOIN player_stats s ON s.player_id = p.id WHERE p.id = $1`, [a.playerId]);
    expect(r.rows[0]).toEqual({ honor: '100', player_kills: '1' });
    const d = await ctx.rt.db.query(`SELECT killer_kind, killer_player_id FROM combat_deaths WHERE player_id = $1`, [b.playerId]);
    expect(d.rows).toEqual([{ killer_kind: 'player', killer_player_id: a.playerId }]);
  });

  it('PvP kapalı haritada (K-1) düşman şirketten pilota saldırılamaz', async () => {
    await start();
    const a = await pilot('BarisciPilot', 'KZL');
    const b = await pilot('ZiyaretciPilot', 'GKB');
    await place(a.playerId, 9000, 5000, 'K-1');
    await place(b.playerId, 9300, 5000, 'K-1');
    const ca = await join(a.client);
    const cb = await join(b.client);
    await run(ca.c, 2);
    ca.c.send({ t: 'target', id: cb.welcome.id });
    ca.c.send({ t: 'attack', on: true });
    await run(ca.c, 20);
    await run(cb.c, 1);
    expect((await ca.c.waitFor('notice')).text).toBe('Bu haritada pilotlara saldırılamaz.');
    expect(cb.c.last('snap')!.st.slice(0, 3)).toEqual([4000, 4000, 1000]);
  });
});

describe('roketler ve canlı envanter', () => {
  it('roket hasar verir, bekleme süresi uygulanır, bir roket harcanır; mağazadan alınan mühimmat oyunda canlı artar', async () => {
    await addNpc({ code: 'test-roket', map: 'K-1', x: 5300, y: 5000, hp: 50000 });
    await start();
    const { playerId, client } = await pilot('RoketciPilot');
    await place(playerId, 5000, 5000);
    const { c } = await join(client);
    const npc = await npcEntity(c);
    c.send({ t: 'target', id: npc.id });
    c.send({ t: 'rocket' });
    c.send({ t: 'rocket' }); // bekleme süresinde: yok sayılır
    await run(c, 2);
    expect(50000 - server!.npcsOn('K-1')[0]!.hp).toBe(1000);
    expect(c.last('cs')!.counts['rocket.yildirim']).toBe(49);
    expect(c.all('snap').flatMap((s) => s.fx ?? []).filter((f) => f[0] === 'r')).toHaveLength(1);
    await run(c, 40); // 2 sn bekleme
    c.send({ t: 'rocket' });
    await run(c, 2);
    expect(50000 - server!.npcsOn('K-1')[0]!.hp).toBe(2000);

    const shop = (await call(ctx.app, client, 'GET', '/shop?server=TR1')).json().shop;
    const offer = shop.categories.flatMap((x: { offers: Array<{ id: number; code: string }> }) => x.offers).find((o: { code: string }) => o.code === 'ammo.isk1');
    const buy = await call(ctx.app, client, 'POST', '/shop/purchase', { serverCode: 'TR1', offerId: offer.id, requestId: crypto.randomUUID() });
    expect(buy.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 300));
    await run(c, 2);
    expect(c.last('cs')!.counts['ammo.isk1']).toBe(3000);
  });

  it('oyundayken tamir yalnızca istasyonda; istasyonda tamir edilen can oyuna canlı yansır', async () => {
    await start();
    const { playerId, client } = await pilot('TamirciPilot');
    await place(playerId, 9000, 6000);
    await ctx.rt.db.query(`UPDATE player_ships SET hitpoints = 1000 WHERE player_id = $1`, [playerId]);
    const { c } = await join(client);
    const ship = (await call(ctx.app, client, 'GET', '/hangar?server=TR1')).json().hangar.ships[0];
    const far = await call(ctx.app, client, 'POST', `/hangar/ships/${ship.id}/repair`, { serverCode: 'TR1', requestId: crypto.randomUUID() });
    expect(far.json().error.code).toBe('NOT_IN_STATION');
    c.ws.close();
    await c.closed;
    await new Promise((r) => setTimeout(r, 200));
    await place(playerId, 1900, 1800);
    const again = await join(client);
    const ok = await call(ctx.app, client, 'POST', `/hangar/ships/${ship.id}/repair`, { serverCode: 'TR1', requestId: crypto.randomUUID() });
    expect(ok.statusCode).toBe(200);
    const upd = await again.c.waitFor('pilot');
    expect(upd.ship.hitpoints).toBe(4000);
    await run(again.c, 2);
    expect(again.c.last('snap')!.st[0]).toBe(4000);
  });
});
