/**
 * Görev sistemi entegrasyon testleri (Aşama 10) — gerçek PostgreSQL + Redis, gerçek görev içeriği (0006).
 * Zaman taklidi: servis saati test içinden ayarlanır (günlük/haftalık sıfırlama, etkinlik penceresi).
 */
import { xpForLevel, type QuestEvent, type QuestsResponse, type QuestView } from '@turkorbit/shared';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { call, createTestContext, newClient, registerAndLogin, resetDatabase, type Client, type TestContext } from './helpers.js';

let ctx: TestContext;
let now = new Date('2026-11-28T10:00:00Z'); // 28.11.2026 13:00 TSİ (cumartesi)

beforeAll(async () => {
  ctx = await createTestContext({}, undefined, { rng: () => 0, clock: () => now });
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetDatabase(ctx.rt);
  now = new Date('2026-11-28T10:00:00Z');
});

async function pilot(username: string, company = 'GKB') {
  const { client } = await registerAndLogin(ctx, username, { client: newClient({ ip: `78.160.${Math.floor(Math.random() * 200)}.1` }) });
  const r = await call(ctx.app, client, 'POST', '/players', { serverCode: 'TR1', companyCode: company });
  if (r.statusCode !== 201) throw new Error(r.body);
  return { client, playerId: r.json().pilot.id as string };
}
const list = async (client: Client): Promise<QuestsResponse> => {
  const r = await call(ctx.app, client, 'GET', '/quests?server=TR1');
  if (r.statusCode !== 200) throw new Error(r.body);
  return r.json().quests;
};
const act = (client: Client, action: 'accept' | 'abandon' | 'reroll' | 'claim', code: string, extra: Record<string, unknown> = {}) =>
  call(ctx.app, client, 'POST', `/quests/${action}`, { serverCode: 'TR1', code, ...extra });
const find = (q: QuestsResponse, code: string) => q.quests.find((x) => x.code === code);
const byCat = (q: QuestsResponse, cat: QuestView['category']) => q.quests.filter((x) => x.category === cat);
/** Zincir görevlerini "ödülü alınmış" olarak işaretler (testi kısaltmak için doğrudan veritabanına). */
const claimed = (playerId: string, codes: string[]) =>
  ctx.rt.db.query(
    `INSERT INTO player_quests (player_id, quest_id, cycle_key, status, completed_at, claimed_at)
     SELECT $1, id, 'once', 'claimed', now(), now() FROM quests WHERE code = ANY($2)`,
    [playerId, codes],
  );
const chainCodes = (chain: string, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `${chain}-${String(from + i).padStart(2, '0')}`);
const setXp = (playerId: string, xp: number) => ctx.rt.db.query('UPDATE players SET experience = $2 WHERE id = $1', [playerId, xp]);

/** Görevin tüm hedeflerini karşılayan olaylar (hedef parametrelerinden üretilir; Gökbörü öneki "G"). */
async function satisfy(playerId: string, code: string, prefix = 'G') {
  const r = await ctx.rt.db.query<{ objective_type: QuestEvent['type']; params: Record<string, unknown>; target: string }>(
    `SELECT objective_type, params, target FROM quest_objectives WHERE quest_id = (SELECT id FROM quests WHERE code = $1) ORDER BY sort_order`,
    [code],
  );
  const first = (k: string) => (r: Record<string, unknown>) => (Array.isArray(r[k]) ? String((r[k] as string[])[0]) : undefined);
  const events: QuestEvent[] = r.rows.map((o) => {
    const p = o.params;
    const e: QuestEvent = { type: o.objective_type, amount: Number(o.target) };
    const npc = first('npc')(p);
    if (npc) e.npc = npc;
    const family = first('family')(p);
    if (family) e.family = family;
    const map = first('maps')(p);
    if (map) e.map = map.replace('{c}', prefix);
    const mt = first('map_types')(p);
    if (mt) e.mapType = mt;
    if (p.target) e.target = p.target as 'npc' | 'player';
    const cat = first('category')(p);
    if (cat) e.category = cat;
    if (o.objective_type === 'reach_level') e.level = Number(o.target);
    if (o.objective_type === 'upgrade_item') e.level = Number(p.min_level ?? 1);
    return e;
  });
  return ctx.quests.record(playerId, events);
}

// ------------------------------------------------------------------ testler
describe('görev listesi', () => {
  it('yeni pilot: zincirlerin ilk görevleri, seviye kilidi, 3 günlük + 3 haftalık, açık etkinlik; {c} şirkete göre çözülür', async () => {
    const { client, playerId } = await pilot('ListePilot');
    const q = await list(client);
    expect(q.level).toBe(1);
    expect(q.cycles).toMatchObject({ daily: '2026-11-28', weekly: '2026-W48', nextDailyReset: '2026-11-29T02:00:00.000Z', nextWeeklyReset: '2026-11-30T02:00:00.000Z' });
    expect(find(q, 'buyuk-sicrama-01')).toMatchObject({ status: 'available', chain: { code: 'buyuk-sicrama', order: 1, total: 40 } });
    expect(find(q, 'buyuk-sicrama-02')).toBeUndefined(); // zincirde yalnızca sıradaki görünür
    expect(find(q, 'akrep-zehri-01')).toMatchObject({ status: 'locked', lockedReason: '3. seviyede açılır' });
    const cakal = find(q, 'cakal-avcisi-01')!;
    expect(cakal.objectives[0]).toMatchObject({ label: 'Çakal yok et (G-1)', current: 0, target: 10 });
    expect(cakal.rewards.map((r) => r.code)).toEqual(['XP', 'KREDI']);
    // Günlük ve haftalık: seviyeye uygun havuzdan 3'er tane, etkin
    const daily = byCat(q, 'daily');
    const weekly = byCat(q, 'weekly');
    expect(daily).toHaveLength(3);
    expect(weekly).toHaveLength(3);
    expect(daily.every((d) => d.status === 'active' && d.cycle === '2026-11-28' && d.code.startsWith('gunluk-a'))).toBe(true);
    expect(weekly.every((d) => d.status === 'active' && d.cycle === '2026-W48' && d.code.startsWith('haftalik-a'))).toBe(true);
    // Açılış Şenliği açık; seviye isteyenler kilitli; 3 hafta sonraki etkinlik görünmez
    expect(find(q, 'acilis-senligi-01')?.status).toBe('available');
    expect(find(q, 'acilis-senligi-05')).toMatchObject({ status: 'locked', lockedReason: '5. seviyede açılır' });
    expect(q.quests.some((x) => x.code.startsWith('kis-gundonumu'))).toBe(false);
    expect(q.rerolls).toEqual({ daily: { used: 0, max: 1 }, weekly: { used: 0, max: 1 } });
    // Aynı döngüde tekrar istek aynı görevleri döner, yeni atama yapılmaz
    const again = await list(client);
    expect(byCat(again, 'daily').map((d) => d.code)).toEqual(daily.map((d) => d.code));
    expect((await ctx.rt.db.query('SELECT count(*)::int AS n FROM player_quests WHERE player_id = $1', [playerId])).rows[0].n).toBe(6);
  });
});

describe('kabul, ilerleme ve ödül', () => {
  it('zincir sırası korunur; ilerleme yalnızca sunucu olaylarıyla; ödül defterli ve bir kez verilir (eşzamanlı iki istek)', async () => {
    const { client, playerId } = await pilot('ZincirPilot');
    let r = await act(client, 'accept', 'buyuk-sicrama-02');
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('QUEST_UNAVAILABLE');
    r = await act(client, 'accept', 'buyuk-sicrama-01');
    expect(r.statusCode).toBe(200);
    expect(find(r.json().quests, 'buyuk-sicrama-01')?.status).toBe('active');

    // (Aynı olay, eşleşen günlük/haftalık görevleri de ilerletebilir; burada zincir görevine bakılır)
    const mine = (u: Awaited<ReturnType<typeof ctx.quests.record>>) => u.find((x) => x.code === 'buyuk-sicrama-01');
    let u = await ctx.quests.record(playerId, [{ type: 'travel_distance', amount: 1000 }]);
    expect(mine(u)).toMatchObject({ status: 'active', objectives: [{ current: 1000, target: 3000 }] });
    r = await act(client, 'claim', 'buyuk-sicrama-01');
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('QUEST_NOT_COMPLETED');
    u = await ctx.quests.record(playerId, [{ type: 'travel_distance', amount: 2500 }]);
    expect(mine(u)).toMatchObject({ status: 'completed', objectives: [{ current: 3000, target: 3000 }] });

    const view = find(await list(client), 'buyuk-sicrama-01')!;
    const xp = view.rewards.find((x) => x.code === 'XP')!.amount;
    const kredi = view.rewards.find((x) => x.code === 'KREDI')!.amount;
    const [a, b] = await Promise.all([act(client, 'claim', 'buyuk-sicrama-01'), act(client, 'claim', 'buyuk-sicrama-01')]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    expect([a.json().replay, b.json().replay].sort()).toEqual([false, true]);
    const first = a.json().replay ? b.json() : a.json();
    expect(first.reward).toMatchObject({ xp, currencies: [{ code: 'KREDI', amount: kredi }] });
    const led = await ctx.rt.db.query(`SELECT currency_code, delta::int AS d, ref_type, ref_id FROM currency_ledger WHERE player_id = $1 AND reason = 'quest_reward'`, [playerId]);
    expect(led.rows).toEqual([{ currency_code: 'KREDI', d: kredi, ref_type: 'quest', ref_id: 'buyuk-sicrama-01' }]);
    expect(Number((await ctx.rt.db.query('SELECT experience FROM players WHERE id = $1', [playerId])).rows[0].experience)).toBe(xp);
    // Sıradaki görev açıldı
    const q = await list(client);
    expect(find(q, 'buyuk-sicrama-01')?.status).toBe('claimed');
    expect(find(q, 'buyuk-sicrama-02')?.status).toBe('available');
  });

  it('şirket haritası eşleşmesi: Gökbörü pilotu için yalnızca G-1\'deki Çakallar sayılır', async () => {
    const { client, playerId } = await pilot('HaritaPilot', 'GKB');
    await claimed(playerId, ['buyuk-sicrama-01']);
    const r = await act(client, 'accept', 'buyuk-sicrama-02');
    expect(find(r.json().quests, 'buyuk-sicrama-02')!.objectives[0]!.label).toBe('Çakal yok et (G-1)');
    const chain = (u: Awaited<ReturnType<typeof ctx.quests.record>>) => u.find((x) => x.code === 'buyuk-sicrama-02');
    expect(chain(await ctx.quests.record(playerId, [{ type: 'kill_npc', amount: 1, npc: 'cakal', family: 'cakal', map: 'K-1' }]))).toBeUndefined();
    expect(chain(await ctx.quests.record(playerId, [{ type: 'kill_npc', amount: 1, npc: 'akrep', family: 'akrep', map: 'G-1' }]))).toBeUndefined();
    const u = await ctx.quests.record(playerId, [{ type: 'kill_npc', amount: 2, npc: 'cakal', family: 'cakal', map: 'G-1' }]);
    expect(u.find((x) => x.code === 'buyuk-sicrama-02')?.objectives[0]).toMatchObject({ current: 2, target: 3 });
  });

  it('seviye hedefi kabulde değerlendirilir; ödülle seviye atlayınca etkin seviye hedefi ve başarım anında güncellenir', async () => {
    const { client, playerId } = await pilot('SeviyePilot');
    await claimed(playerId, chainCodes('buyuk-sicrama', 1, 13));
    await setXp(playerId, xpForLevel(5));
    let r = await act(client, 'accept', 'buyuk-sicrama-14');
    expect(find(r.json().quests, 'buyuk-sicrama-14')?.status).toBe('completed'); // zaten 5. seviye

    // İkinci pilot: 4. seviyede; görev ödülüyle 5'e çıkar
    const b = await pilot('SeviyePilotB');
    await claimed(b.playerId, chainCodes('buyuk-sicrama', 1, 13));
    await setXp(b.playerId, xpForLevel(5) - 50);
    r = await act(b.client, 'accept', 'buyuk-sicrama-14');
    expect(find(r.json().quests, 'buyuk-sicrama-14')).toMatchObject({ status: 'active', objectives: [{ current: 4, target: 5 }] });
    await act(b.client, 'accept', 'cakal-avcisi-01');
    await satisfy(b.playerId, 'cakal-avcisi-01');
    r = await act(b.client, 'claim', 'cakal-avcisi-01');
    expect(r.json().reward).toMatchObject({ level: 5, levelUp: true });
    expect(find(r.json().quests, 'buyuk-sicrama-14')?.status).toBe('completed');
    const ach = await ctx.rt.db.query(`SELECT a.code FROM player_achievements pa JOIN achievements a ON a.id = pa.achievement_id WHERE pa.player_id = $1`, [b.playerId]);
    expect(ach.rows.map((x) => x.code)).toContain('level_5');
  });

  it('aynı anda en fazla N ana/etkinlik görevi; bırakılan görev yeniden alınabilir; günlük görev bırakılamaz', async () => {
    const { client } = await pilot('LimitPilot');
    await ctx.rt.db.query(`UPDATE game_settings SET value = jsonb_set(value, '{max_active}', '2') WHERE key = 'quests'`);
    expect((await act(client, 'accept', 'buyuk-sicrama-01')).statusCode).toBe(200);
    expect((await act(client, 'accept', 'cakal-avcisi-01')).statusCode).toBe(200);
    let r = await act(client, 'accept', 'acilis-senligi-01');
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toMatchObject({ code: 'QUEST_LIMIT', message: 'Aynı anda en fazla 2 ana veya etkinlik görevi alabilirsin.' });
    r = await act(client, 'abandon', 'cakal-avcisi-01');
    expect(find(r.json().quests, 'cakal-avcisi-01')?.status).toBe('available');
    expect((await act(client, 'accept', 'acilis-senligi-01')).statusCode).toBe(200);
    expect((await act(client, 'accept', 'buyuk-sicrama-01')).json().error.code).toBe('QUEST_UNAVAILABLE');
    const daily = byCat(await list(client), 'daily')[0]!;
    r = await act(client, 'abandon', daily.code);
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('QUEST_NOT_ACTIVE');
  });
});

describe('günlük ve haftalık döngüler (zaman taklidi)', () => {
  it('günlük görevler 05:00 TSİ\'de yenilenir; eski döngüde tamamlanan görevin ödülü alınabilir; yeniden çekme hakkı sınırlı', async () => {
    now = new Date('2026-11-28T01:30:00Z'); // 04:30 TSİ → önceki günün döngüsü
    const { client, playerId } = await pilot('DonguPilot');
    let q = await list(client);
    const old = byCat(q, 'daily');
    expect(old.map((d) => d.cycle)).toEqual(['2026-11-27', '2026-11-27', '2026-11-27']);
    await satisfy(playerId, old[0]!.code);
    q = await list(client);
    expect(find(q, old[0]!.code)?.status).toBe('completed');
    // Tamamlanan görev yeniden çekilemez; tamamlanmamış biri çekilir; hak bitince reddedilir
    let r = await act(client, 'reroll', old[0]!.code);
    expect(r.json().error.code).toBe('QUEST_NOT_ACTIVE');
    r = await act(client, 'reroll', old[1]!.code);
    expect(r.statusCode).toBe(200);
    const replacement = r.json().replacedBy as string;
    expect(old.map((d) => d.code)).not.toContain(replacement);
    expect(r.json().quests.rerolls.daily).toEqual({ used: 1, max: 1 });
    expect(find(r.json().quests, old[1]!.code)).toBeUndefined();
    r = await act(client, 'reroll', old[2]!.code);
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('REROLL_LIMIT');

    now = new Date('2026-11-28T02:00:00Z'); // 05:00 TSİ → yeni gün
    q = await list(client);
    const fresh = byCat(q, 'daily').filter((d) => d.cycle === '2026-11-28');
    expect(fresh).toHaveLength(3);
    expect(fresh.every((d) => d.status === 'active')).toBe(true);
    expect(q.rerolls.daily.used).toBe(0);
    // Dünün tamamlanmış görevi hâlâ listede ve ödülü alınabilir; dünün tamamlanmamışları listede yok
    expect(byCat(q, 'daily').filter((d) => d.cycle === '2026-11-27').map((d) => d.code)).toEqual([old[0]!.code]);
    r = await act(client, 'claim', old[0]!.code, { cycle: '2026-11-27' });
    expect(r.statusCode).toBe(200);
    expect(r.json().replay).toBe(false);
    // Dünün eski görevine olay gelse de ilerlemez (yalnızca bugünün görevleri)
    now = new Date('2026-11-28T09:00:00Z');
    expect(byCat(await list(client), 'daily').map((d) => d.code).sort()).toEqual(fresh.map((d) => d.code).sort());
  });

  it('haftalık görevler pazartesi 05:00 TSİ\'de yenilenir', async () => {
    now = new Date('2026-11-29T20:00:00Z'); // pazar 23:00 TSİ
    const { client } = await pilot('HaftaPilot');
    expect(byCat(await list(client), 'weekly').map((w) => w.cycle)).toEqual(['2026-W48', '2026-W48', '2026-W48']);
    now = new Date('2026-11-30T01:59:00Z'); // pazartesi 04:59
    expect(byCat(await list(client), 'weekly').every((w) => w.cycle === '2026-W48')).toBe(true);
    now = new Date('2026-11-30T02:00:00Z'); // pazartesi 05:00
    const q = await list(client);
    expect(byCat(q, 'weekly').map((w) => w.cycle)).toEqual(['2026-W49', '2026-W49', '2026-W49']);
    expect(q.cycles.nextWeeklyReset).toBe('2026-12-07T02:00:00.000Z');
  });

  it('etkinlik görevleri yalnızca tarih penceresinde ilerler; yaklaşan etkinlik kilitli görünür; bitse de tamamlananın ödülü alınır', async () => {
    now = new Date('2026-12-10T10:00:00Z');
    const { client, playerId } = await pilot('EtkinlikPilot');
    let q = await list(client);
    expect(find(q, 'kis-gundonumu-04')).toMatchObject({ status: 'locked', lockedReason: 'Etkinlik henüz başlamadı' });
    expect((await act(client, 'accept', 'kis-gundonumu-04')).json().error.code).toBe('QUEST_UNAVAILABLE');
    await act(client, 'accept', 'acilis-senligi-01');
    await act(client, 'accept', 'acilis-senligi-02');
    await satisfy(playerId, 'acilis-senligi-02');
    now = new Date('2027-01-02T10:00:00Z'); // Açılış Şenliği bitti
    q = await list(client);
    expect(find(q, 'acilis-senligi-01')).toBeUndefined();
    expect(find(q, 'acilis-senligi-02')?.status).toBe('completed');
    expect(await ctx.quests.record(playerId, [{ type: 'kill_npc', amount: 10, npc: 'cakal', family: 'cakal', map: 'G-1' }])).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ code: 'acilis-senligi-01' })]),
    );
    expect((await act(client, 'claim', 'acilis-senligi-02')).statusCode).toBe(200);
  });
});

describe('güvenlik', () => {
  it('ilerleme yazan uç yoktur; başkasının görevi alınamaz; geçersiz istekler reddedilir', async () => {
    const a = await pilot('GuvenA');
    const b = await pilot('GuvenB');
    expect((await call(ctx.app, a.client, 'POST', '/quests/progress', { serverCode: 'TR1', code: 'buyuk-sicrama-01', amount: 999 })).statusCode).toBe(404);
    expect((await act(a.client, 'accept', 'olmayan-gorev')).json().error.code).toBe('QUEST_NOT_FOUND');
    expect((await act(a.client, 'accept', 'buyuk-sicrama-01', { progress: 3000 })).json().error.code).toBe('VALIDATION_ERROR');
    expect((await call(ctx.app, newClient(), 'GET', '/quests?server=TR1')).statusCode).toBe(401);
    await act(a.client, 'accept', 'buyuk-sicrama-01');
    await satisfy(a.playerId, 'buyuk-sicrama-01');
    const r = await act(b.client, 'claim', 'buyuk-sicrama-01');
    expect(r.statusCode).toBe(409);
    expect((await ctx.rt.db.query(`SELECT count(*)::int AS n FROM currency_ledger WHERE reason = 'quest_reward'`)).rows[0].n).toBe(0);
    const { client: noPilot } = await registerAndLogin(ctx, 'PilotsuzOyuncu');
    expect((await call(ctx.app, noPilot, 'GET', '/quests?server=TR1')).json().error.code).toBe('PILOT_NOT_FOUND');
  });
});

describe('hangar olayları', () => {
  const offerId = async (client: Client, code: string) => {
    const s = (await call(ctx.app, client, 'GET', '/shop?server=TR1')).json().shop;
    return s.categories.flatMap((c: { offers: Array<{ code: string; id: number }> }) => c.offers).find((x: { code: string }) => x.code === code).id as number;
  };
  it('mağazadan mühimmat alma ve başarılı yükseltme görevi aynı transaction\'da ilerletir; aynı istek iki kez sayılmaz', async () => {
    const { client, playerId } = await pilot('HangarGorevPilot');
    await setXp(playerId, xpForLevel(2));
    await ctx.rt.db.query(`UPDATE wallets SET balance = 1000000 WHERE player_id = $1 AND currency_code = 'KREDI'`, [playerId]);
    await claimed(playerId, chainCodes('usta-nisanci', 1, 6));
    await act(client, 'accept', 'usta-nisanci-07'); // 5 kez mühimmat al
    const ammo = await offerId(client, 'ammo.isk1');
    const rocket = await offerId(client, 'rocket.yildirim');
    const requestId = randomUUID();
    const buy = (rid: string, offer = ammo) => call(ctx.app, client, 'POST', '/shop/purchase', { serverCode: 'TR1', offerId: offer, packs: 1, requestId: rid });
    expect((await buy(requestId)).statusCode).toBe(200);
    expect((await buy(requestId)).statusCode).toBe(200); // tekrar: ikinci kez uygulanmaz
    expect((await buy(randomUUID())).statusCode).toBe(200);
    expect(find(await list(client), 'usta-nisanci-07')?.objectives[0]).toMatchObject({ current: 2, target: 5 });
    // Roket alımı mühimmat görevini ilerletmez
    expect((await buy(randomUUID(), rocket)).statusCode).toBe(200);
    expect(find(await list(client), 'usta-nisanci-07')?.objectives[0]?.current).toBe(2);
    expect((await buy(randomUUID())).statusCode).toBe(200);
    expect(find(await list(client), 'usta-nisanci-07')?.objectives[0]?.current).toBe(3);

    await claimed(playerId, chainCodes('buyuk-sicrama', 1, 10));
    await act(client, 'accept', 'buyuk-sicrama-11'); // başarılı yükseltme
    const h = (await call(ctx.app, client, 'GET', '/hangar?server=TR1')).json().hangar;
    const laser = h.inventory.find((x: { code: string }) => x.code === 'laser.ok1');
    const r = await call(ctx.app, client, 'POST', `/hangar/items/${laser.id}/upgrade`, { serverCode: 'TR1', requestId: randomUUID() });
    expect(r.json().result).toMatchObject({ success: true, toLevel: 1 });
    expect(find(await list(client), 'buyuk-sicrama-11')?.status).toBe('completed');
  });
});
