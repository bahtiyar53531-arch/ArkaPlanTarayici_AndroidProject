/**
 * Klan ve sosyal entegrasyon testleri (Aşama 12) — GERÇEK PostgreSQL + Redis + WebSocket.
 *  - REST: klan (yetkiler, eşzamanlı katılım sınırı, hazine, diplomasi, dağıtma), arkadaşlık, engelleme, gizlilik,
 *    şikâyet, bildirim, sohbet geçmişi, NPC ödülünden klan vergisi.
 *  - Oyun sunucusu: sohbet kanalları ve engelleme, küfür filtresi, hız sınırı, grup (konum izni), diplomasiye göre saldırı.
 */
import { PROTOCOL_VERSION, xpForLevel, type ServerMessage } from '@turkorbit/shared';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { GameContent } from '../src/game/content.js';
import { CombatStore } from '../src/game/persistence.js';
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
  await ctx.rt.db.query('UPDATE npc_spawns SET is_enabled = true');
  await ctx.rt.db.query('UPDATE resource_nodes SET is_enabled = true');
  await ctx.close();
});
beforeEach(async () => {
  await resetDatabase(ctx.rt);
  await ctx.rt.db.query('UPDATE npc_spawns SET is_enabled = false');
  await ctx.rt.db.query('UPDATE resource_nodes SET is_enabled = false');
});
afterEach(async () => {
  for (const c of clients) c.ws.terminate();
  clients.length = 0;
  if (server) await server.close();
  if (sub) await sub.quit();
  server = null;
  sub = null;
});

// ------------------------------------------------------------------ yardımcılar
let ipSeq = 1;
async function pilot(username: string, company = 'KZL', level = 1) {
  const { client } = await registerAndLogin(ctx, username, { client: newClient({ ip: `78.160.${ipSeq++ % 250}.${Math.floor(Math.random() * 250)}` }) });
  const r = await call(ctx.app, client, 'POST', '/players', { serverCode: 'TR1', companyCode: company });
  if (r.statusCode !== 201) throw new Error(r.body);
  const playerId = r.json().pilot.id as string;
  if (level > 1) await ctx.rt.db.query('UPDATE players SET experience = $2 WHERE id = $1', [playerId, xpForLevel(level)]);
  return { client, playerId, name: username };
}
type P = Awaited<ReturnType<typeof pilot>>;
const post = (p: P, url: string, body: Record<string, unknown> = {}) => call(ctx.app, p.client, 'POST', url, { serverCode: 'TR1', ...body });
const put = (p: P, url: string, body: Record<string, unknown> = {}) => call(ctx.app, p.client, 'PUT', url, { serverCode: 'TR1', ...body });
const get = (p: P, url: string) => call(ctx.app, p.client, 'GET', url);
const balance = async (playerId: string) =>
  Number((await ctx.rt.db.query(`SELECT balance FROM wallets WHERE player_id = $1 AND currency_code = 'KREDI'`, [playerId])).rows[0]?.balance ?? 0);
const setBalance = (playerId: string, amount: number) => ctx.rt.db.query(`UPDATE wallets SET balance = $2 WHERE player_id = $1 AND currency_code = 'KREDI'`, [playerId, amount]);
const treasury = async (tag: string) =>
  Number((await ctx.rt.db.query(`SELECT COALESCE(w.balance, 0) AS b FROM clans c LEFT JOIN clan_wallets w ON w.clan_id = c.id AND w.currency_code = 'KREDI' WHERE c.tag = $1`, [tag])).rows[0]?.b ?? 0);
const notes = async (playerId: string) => (await ctx.rt.db.query<{ kind: string; title: string; body: string }>('SELECT kind, title, body FROM notifications WHERE player_id = $1 ORDER BY id', [playerId])).rows;

/** Seviye 5 ve yeterli Kredi ile klan kurar. */
async function founder(name: string, tag: string, company = 'KZL') {
  const p = await pilot(name, company, 5);
  await setBalance(p.playerId, 200_000);
  const r = await post(p, '/clan/create', { tag, name: `${tag} Filosu`, requestId: randomUUID() });
  if (r.statusCode !== 200) throw new Error(r.body);
  return p;
}
async function join(clanLeader: P, member: P, tag: string) {
  let r = await post(member, '/clan/apply', { tag });
  if (r.statusCode !== 200) throw new Error(r.body);
  const app = (await get(clanLeader, '/clan?server=TR1')).json().clan.applications.find((a: { pilotName: string }) => a.pilotName === member.name);
  r = await post(clanLeader, '/clan/applications/decide', { id: app.id, accept: true });
  if (r.statusCode !== 200) throw new Error(r.body);
}

// ================================================================== klan
describe('klan kurma', () => {
  it('seviye ve ücret denetlenir; ücret defterli düşer; 4 varsayılan rütbe; etiket benzersiz; uygunsuz ad reddedilir; aynı istek iki kez ücret almaz', async () => {
    const a = await pilot('KurucuPilot', 'KZL', 1);
    let r = await post(a, '/clan/create', { tag: 'akn', name: 'Akıncılar', requestId: randomUUID() });
    expect(r.json().error).toMatchObject({ code: 'LEVEL_TOO_LOW', message: 'Klan kurmak için en az 5. seviye olmalısın.' });
    await ctx.rt.db.query('UPDATE players SET experience = $2 WHERE id = $1', [a.playerId, xpForLevel(5)]);
    await setBalance(a.playerId, 60_000);
    const req = randomUUID();
    r = await post(a, '/clan/create', { tag: 'akn', name: '  Akıncılar   Birliği ', description: 'Öncü filo', requestId: req });
    expect(r.statusCode).toBe(200);
    const clan = r.json().clan;
    expect(clan).toMatchObject({ tag: 'AKN', name: 'Akıncılar Birliği', members: 1, leader: 'KurucuPilot', description: 'Öncü filo', taxPercent: 0 });
    expect(clan.ranks.map((x: { name: string }) => x.name)).toEqual(['Lider', 'Komutan', 'Subay', 'Üye']);
    expect(clan.myRank).toMatchObject({ name: 'Lider', isLeader: true });
    expect(await balance(a.playerId)).toBe(10_000);
    // Aynı istek kimliği: ikinci kez ücret alınmaz
    r = await post(a, '/clan/create', { tag: 'akn', name: 'Akıncılar Birliği', requestId: req });
    expect(r.statusCode).toBe(200);
    expect(await balance(a.playerId)).toBe(10_000);
    const led = await ctx.rt.db.query(`SELECT delta, reason FROM currency_ledger WHERE player_id = $1 AND reason = 'clan_create'`, [a.playerId]);
    expect(led.rows).toEqual([{ delta: '-50000', reason: 'clan_create' }]);
    // Zaten klanda
    r = await post(a, '/clan/create', { tag: 'BSK', name: 'Başka Klan', requestId: randomUUID() });
    expect(r.json().error.code).toBe('ALREADY_IN_CLAN');
    // Etiket/ad benzersiz (büyük/küçük harf duyarsız), uygunsuz kelime ve biçim
    const b = await pilot('IkinciKurucu', 'GKB', 5);
    await setBalance(b.playerId, 60_000);
    r = await post(b, '/clan/create', { tag: 'Akn', name: 'Yepyeni', requestId: randomUUID() });
    expect(r.json().error.code).toBe('CLAN_EXISTS');
    r = await post(b, '/clan/create', { tag: 'KTU', name: 'Siktir Filosu', requestId: randomUUID() });
    expect(r.json().error).toMatchObject({ code: 'VALIDATION_ERROR', message: 'Klan adı veya etiketi uygunsuz bir kelime içeriyor.' });
    r = await post(b, '/clan/create', { tag: 'A', name: 'Kısa Etiket', requestId: randomUUID() });
    expect(r.json().error.code).toBe('VALIDATION_ERROR');
    expect(await balance(b.playerId)).toBe(60_000);
    // Profil ve açık profil klanı gösterir
    const prof = (await get(a, '/players/me')).json();
    expect(JSON.stringify(prof)).toContain('"clan":{"tag":"AKN","name":"Akıncılar Birliği","rank":"Lider"}');
    const pub = (await call(ctx.app, newClient(), 'GET', '/pilots/TR1/KurucuPilot')).json().pilot;
    expect(pub.clan).toEqual({ tag: 'AKN', name: 'Akıncılar Birliği', rank: 'Lider' });
  });
});

describe('klan üyeliği ve yetkiler', () => {
  it('başvuru → bildirim → kabul; rütbe yetkileri sunucuda denetlenir; yalnızca alt rütbe yönetilir; liderlik devri', async () => {
    const lead = await founder('LiderPilot', 'TMR');
    const b = await pilot('BasvuranPilot');
    const c = await pilot('DavetliPilot');
    let r = await post(b, '/clan/apply', { tag: 'tmr', message: 'Merhaba, katılmak isterim.' });
    expect(r.statusCode).toBe(200);
    expect(r.json().applications).toEqual([expect.objectContaining({ tag: 'TMR' })]);
    expect(await notes(lead.playerId)).toEqual([{ kind: 'clan_application', title: 'Yeni klan başvurusu', body: 'BasvuranPilot (Sv 1) klana katılmak istiyor.' }]);
    r = await post(b, '/clan/apply', { tag: 'TMR' });
    expect(r.json().error.code).toBe('APPLICATION_EXISTS');
    const appId = (await get(lead, '/clan?server=TR1')).json().clan.applications[0].id;
    r = await post(lead, '/clan/applications/decide', { id: appId, accept: true });
    expect(r.json().clan.memberList.map((m: { pilotName: string; rankName: string }) => [m.pilotName, m.rankName])).toEqual([
      ['LiderPilot', 'Lider'],
      ['BasvuranPilot', 'Üye'],
    ]);
    expect((await notes(b.playerId)).map((n) => n.title)).toEqual(['Klan başvurun kabul edildi']);
    // Üye rütbesi davet edemez
    r = await post(b, '/clan/invite', { pilotName: 'DavetliPilot' });
    expect(r.json().error).toMatchObject({ code: 'CLAN_PERMISSION', message: 'Bu işlem için klanında "Üye alma ve davet" yetkisi gerekiyor.' });
    // Lider rütbe verir (Subay: davet yetkisi), artık davet edebilir
    const ranks = (await get(lead, '/clan?server=TR1')).json().clan.ranks as Array<{ id: number; name: string }>;
    const subay = ranks.find((x) => x.name === 'Subay')!;
    const komutan = ranks.find((x) => x.name === 'Komutan')!;
    r = await post(lead, '/clan/members/rank', { pilotName: 'BasvuranPilot', rankId: subay.id });
    expect(r.statusCode).toBe(200);
    r = await post(b, '/clan/invite', { pilotName: 'DavetliPilot' });
    expect(r.statusCode).toBe(200);
    expect((await notes(c.playerId))[0]).toMatchObject({ kind: 'clan_invitation', body: 'BasvuranPilot seni [TMR] TMR Filosu klanına davet etti.' });
    const inv = (await get(c, '/clan?server=TR1')).json().invitations[0];
    r = await post(c, '/clan/invitations/respond', { id: inv.id, accept: true });
    expect(r.json().clan.members).toBe(3);
    // Subay: çıkarma yetkisi yok; kendisi rütbe veremez; lideri yönetemez
    r = await post(b, '/clan/kick', { pilotName: 'DavetliPilot' });
    expect(r.json().error.code).toBe('CLAN_PERMISSION');
    r = await post(b, '/clan/members/rank', { pilotName: 'DavetliPilot', rankId: komutan.id });
    expect(r.json().error.code).toBe('CLAN_PERMISSION');
    // Komutan, kendi rütbesindeki veya üstündekini çıkaramaz; alttakini çıkarabilir
    await post(lead, '/clan/members/rank', { pilotName: 'BasvuranPilot', rankId: komutan.id });
    r = await post(b, '/clan/kick', { pilotName: 'LiderPilot' });
    expect(r.json().error).toMatchObject({ code: 'CLAN_PERMISSION', message: 'Yalnızca senden alt rütbedeki üyeleri çıkarabilirsin.' });
    r = await post(b, '/clan/members/rank', { pilotName: 'DavetliPilot', rankId: komutan.id });
    expect(r.json().error.code).toBe('CLAN_PERMISSION'); // kendi rütbesini veremez
    r = await post(b, '/clan/kick', { pilotName: 'DavetliPilot' });
    expect(r.json().clan.members).toBe(2);
    expect((await notes(c.playerId)).at(-1)).toMatchObject({ kind: 'clan_kicked', title: 'Klandan çıkarıldın' });
    // Rütbe yetkilerini yalnızca lider düzenler
    r = await post(b, '/clan/ranks/update', { rankId: subay.id, name: 'Akıncı', permissions: ['invite', 'kick'] });
    expect(r.json().error.message).toBe('Bu işlemi yalnızca klan lideri yapabilir.');
    r = await post(lead, '/clan/ranks/update', { rankId: subay.id, name: 'Akıncı', permissions: ['invite', 'kick', 'invite'] });
    expect(r.json().clan.ranks.find((x: { id: number }) => x.id === subay.id)).toMatchObject({ name: 'Akıncı', permissions: ['invite', 'kick'] });
    // Lider ayrılamaz; liderliği devreder, sonra ayrılabilir
    r = await post(lead, '/clan/leave');
    expect(r.json().error.code).toBe('NOT_ALLOWED');
    r = await post(lead, '/clan/transfer', { pilotName: 'BasvuranPilot' });
    expect(r.json().clan).toMatchObject({ leader: 'BasvuranPilot', myRank: { name: 'Komutan' } });
    r = await post(lead, '/clan/leave');
    expect(r.json().clan).toBeNull();
    const events = (await get(b, '/clan?server=TR1')).json().clan.events.map((e: { text: string }) => e.text);
    expect(events).toContain('LiderPilot liderliği BasvuranPilot adlı pilota devretti.');
    expect(events).toContain('LiderPilot klandan ayrıldı.');
  });

  it('eşzamanlı katılımda üye sınırı aşılamaz; bir pilot aynı anda iki klana giremez', async () => {
    await ctx.rt.db.query(`UPDATE game_settings SET value = jsonb_set(value, '{max_members}', '4') WHERE key = 'clan'`);
    const lead = await founder('SinirLideri', 'SNR');
    const other = await founder('DigerLider', 'DGR', 'GKB');
    const ps: P[] = [];
    for (let i = 0; i < 6; i++) ps.push(await pilot(`Aday${i}`));
    for (const p of ps) await post(lead, '/clan/invite', { pilotName: p.name });
    await post(other, '/clan/invite', { pilotName: 'Aday0' });
    const invs = await Promise.all(ps.map(async (p) => (await get(p, '/clan?server=TR1')).json().invitations as Array<{ id: number; tag: string }>));
    const results = await Promise.all([
      ...ps.map((p, i) => post(p, '/clan/invitations/respond', { id: invs[i]!.find((x) => x.tag === 'SNR')!.id, accept: true })),
      post(ps[0]!, '/clan/invitations/respond', { id: invs[0]!.find((x) => x.tag === 'DGR')!.id, accept: true }),
    ]);
    const ok = results.filter((r) => r.statusCode === 200).length;
    const codes = results.filter((r) => r.statusCode !== 200).map((r) => r.json().error.code);
    const n = Number((await ctx.rt.db.query(`SELECT count(*) AS n FROM clan_members cm JOIN clans c ON c.id = cm.clan_id WHERE c.tag = 'SNR'`)).rows[0].n);
    expect(n).toBe(4); // lider + 3
    expect(codes.every((c) => c === 'CLAN_FULL' || c === 'ALREADY_IN_CLAN' || c === 'INVITATION_NOT_FOUND')).toBe(true);
    const memberships = await ctx.rt.db.query(`SELECT count(*) AS n FROM clan_members WHERE player_id = $1`, [ps[0]!.playerId]);
    expect(Number(memberships.rows[0].n)).toBeLessThanOrEqual(1);
    expect(ok).toBeGreaterThanOrEqual(3);
  });
});

describe('klan hazinesi', () => {
  it('yatırma iki defterde; tekrar edilen istek bir kez uygulanır; ödeme yetkisi denetlenir; hazine yetersizse hiçbir şey değişmez; 20 eşzamanlı yatırma tutarlı', async () => {
    const lead = await founder('HazineLideri', 'HZN');
    const m = await pilot('HazineUyesi');
    await join(lead, m, 'HZN');
    await setBalance(m.playerId, 30_000);
    const req = randomUUID();
    let r = await post(m, '/clan/treasury/deposit', { amount: 5000, requestId: req });
    expect(r.json().clan.treasury.balance).toBe(5000);
    r = await post(m, '/clan/treasury/deposit', { amount: 5000, requestId: req });
    expect(r.json().clan.treasury.balance).toBe(5000);
    expect(await balance(m.playerId)).toBe(25_000);
    // Yetkisiz ödeme
    r = await post(m, '/clan/treasury/withdraw', { pilotName: 'HazineUyesi', amount: 100, requestId: randomUUID() });
    expect(r.json().error.code).toBe('CLAN_PERMISSION');
    // Lider üyeye öder
    r = await post(lead, '/clan/treasury/withdraw', { pilotName: 'HazineUyesi', amount: 2000, requestId: randomUUID() });
    expect(r.json().clan.treasury.balance).toBe(3000);
    expect(await balance(m.playerId)).toBe(27_000);
    expect((await notes(m.playerId)).at(-1)).toMatchObject({ kind: 'clan_payout', body: '+2.000 Kredi (HazineLideri)' });
    // Yetersiz hazine: oyuncuya da ödeme yapılmaz
    r = await post(lead, '/clan/treasury/withdraw', { pilotName: 'HazineUyesi', amount: 3001, requestId: randomUUID() });
    expect(r.json().error.code).toBe('INSUFFICIENT_FUNDS');
    expect(await balance(m.playerId)).toBe(27_000);
    expect(await treasury('HZN')).toBe(3000);
    // Klan dışına ödeme yapılamaz
    await pilot('YabanciPilot');
    r = await post(lead, '/clan/treasury/withdraw', { pilotName: 'YabanciPilot', amount: 10, requestId: randomUUID() });
    expect(r.json().error.code).toBe('NOT_IN_CLAN');
    // 20 eşzamanlı yatırma
    await Promise.all(Array.from({ length: 20 }, () => post(m, '/clan/treasury/deposit', { amount: 100, requestId: randomUUID() })));
    expect(await treasury('HZN')).toBe(5000);
    expect(await balance(m.playerId)).toBe(25_000);
    const sum = await ctx.rt.db.query(`SELECT sum(delta) AS s, count(*) AS n FROM clan_treasury_ledger l JOIN clans c ON c.id = l.clan_id WHERE c.tag = 'HZN'`);
    expect(sum.rows[0]).toEqual({ s: '5000', n: '22' });
    // Defter değiştirilemez
    await expect(ctx.rt.db.query(`UPDATE clan_treasury_ledger SET delta = 1`)).rejects.toThrow(/değiştirilemez/);
  });

  it('NPC Kredi ödülünden klan vergisi hazineye aktarılır (defterli, idempotent); vergisiz klanda kesinti yok', async () => {
    const lead = await founder('VergiLideri', 'VRG');
    let r = await post(lead, '/clan/update', { taxPercent: 5 });
    expect(r.json().clan.taxPercent).toBe(5);
    const m = await pilot('VergiUyesi');
    await join(lead, m, 'VRG');
    r = await post(m, '/clan/update', { taxPercent: 0 });
    expect(r.json().error.message).toBe('Bu işlemi yalnızca klan lideri yapabilir.');
    const free = await pilot('VergisizPilot');
    const content = new GameContent();
    await content.load(ctx.rt.db);
    const store = new CombatStore(ctx.rt.db, content);
    const npcType = (await ctx.rt.db.query(`SELECT id FROM npc_types LIMIT 1`)).rows[0].id;
    const before = { m: await balance(m.playerId), f: await balance(free.playerId) };
    const killId = randomUUID();
    const res = await store.npcKill(killId, m.playerId, npcType, 'K-1', [
      { playerId: m.playerId, rewards: [{ type: 'currency', code: 'KREDI', amount: 1000 }] },
      { playerId: free.playerId, rewards: [{ type: 'currency', code: 'KREDI', amount: 1000 }] },
    ]);
    expect(res!.get(m.playerId)!.clanTax).toBe(50);
    expect(res!.get(free.playerId)!.clanTax).toBeUndefined();
    expect(await balance(m.playerId)).toBe(before.m + 950);
    expect(await balance(free.playerId)).toBe(before.f + 1000);
    expect(await treasury('VRG')).toBe(50);
    expect(await store.npcKill(killId, m.playerId, npcType, 'K-1', [{ playerId: m.playerId, rewards: [{ type: 'currency', code: 'KREDI', amount: 1000 }] }])).toBeNull();
    expect(await treasury('VRG')).toBe(50);
  });
});

describe('diplomasi', () => {
  it('ittifak önerisi → onay → etkin; ittifak varken savaş ilan edilemez; bitiş; savaş ilanı tüm üyelere bildirilir; barış iki tarafın onayıyla', async () => {
    const a = await founder('DiploA', 'DPA');
    const b = await founder('DiploB', 'DPB', 'GKB');
    const bm = await pilot('DiploBUye', 'GKB');
    await join(b, bm, 'DPB');
    let r = await post(a, '/clan/diplomacy/propose', { tag: 'DPB', relation: 'alliance' });
    expect(r.json().clan.relations).toEqual([expect.objectContaining({ tag: 'DPB', relation: 'alliance', status: 'proposed', ours: true })]);
    expect((await notes(b.playerId)).at(-1)).toMatchObject({ kind: 'clan_diplomacy', body: '[DPA] DPA Filosu klanı ittifak öneriyor.' });
    expect((await notes(bm.playerId)).filter((n) => n.kind === 'clan_diplomacy')).toEqual([]); // yetkisi olmayan üyeye gitmez
    r = await post(bm, '/clan/diplomacy/respond', { tag: 'DPA', accept: true });
    expect(r.json().error.code).toBe('CLAN_PERMISSION');
    r = await post(b, '/clan/diplomacy/respond', { tag: 'DPA', accept: true });
    expect(r.json().clan.relations[0]).toMatchObject({ tag: 'DPA', relation: 'alliance', status: 'active' });
    r = await post(a, '/clan/diplomacy/war', { tag: 'DPB' });
    expect(r.json().error.code).toBe('DIPLOMACY_EXISTS');
    r = await post(a, '/clan/diplomacy/end', { tag: 'DPB' });
    expect(r.json().clan.relations).toEqual([]);
    r = await post(a, '/clan/diplomacy/war', { tag: 'DPB' });
    expect(r.json().clan.relations[0]).toMatchObject({ relation: 'war', status: 'active', ours: true, peace: null });
    expect((await notes(bm.playerId)).at(-1)).toMatchObject({ kind: 'clan_war', title: 'Klanına savaş ilan edildi' });
    // Açık klan sayfası etkin ilişkileri gösterir
    const pub = (await call(ctx.app, newClient(), 'GET', '/clans/TR1/DPB')).json().clan;
    expect(pub.relations).toEqual([expect.objectContaining({ tag: 'DPA', relation: 'war', status: 'active' })]);
    // Barış: önce A önerir, B de önerince biter
    r = await post(a, '/clan/diplomacy/end', { tag: 'DPB' });
    expect(r.json().clan.relations[0].peace).toBe('ours');
    r = await post(a, '/clan/diplomacy/end', { tag: 'DPB' });
    expect(r.json().error.code).toBe('DIPLOMACY_EXISTS');
    r = await post(b, '/clan/diplomacy/end', { tag: 'DPA' });
    expect(r.json().clan.relations).toEqual([]);
  });

  it('klan dağıtılınca hazine lidere iade edilir (defterli), üyeler bildirim alır, klan ve ilişkileri silinir', async () => {
    const a = await founder('DagitanLider', 'DGT');
    const m = await pilot('DagitilanUye');
    await join(a, m, 'DGT');
    const other = await founder('KomsuLider', 'KMS', 'GKB');
    await post(other, '/clan/diplomacy/war', { tag: 'DGT' });
    await post(m, '/clan/treasury/deposit', { amount: 4000, requestId: randomUUID() });
    const before = await balance(a.playerId);
    const r = await post(a, '/clan/disband');
    expect(r.json().clan).toBeNull();
    expect(await balance(a.playerId)).toBe(before + 4000);
    expect((await notes(m.playerId)).at(-1)).toMatchObject({ kind: 'clan_disbanded' });
    expect((await ctx.rt.db.query(`SELECT 1 FROM clans WHERE tag = 'DGT'`)).rowCount).toBe(0);
    expect((await get(other, '/clan?server=TR1')).json().clan.relations).toEqual([]);
    const led = await ctx.rt.db.query(`SELECT delta, reason FROM currency_ledger WHERE player_id = $1 AND reason = 'clan_disband'`, [a.playerId]);
    expect(led.rows).toEqual([{ delta: '4000', reason: 'clan_disband' }]);
  });
});

// ================================================================== arkadaşlık, engel, gizlilik, şikâyet, bildirim
describe('arkadaşlık ve engelleme', () => {
  it('istek → bildirim → kabul; karşılıklı istek otomatik kabul; çevrimiçi durum arkadaşın iznine göre; engelleme arkadaşlığı siler ve istekleri durdurur', async () => {
    const a = await pilot('ArkadasA');
    const b = await pilot('ArkadasB');
    const c = await pilot('ArkadasC');
    let r = await post(a, '/social/friends/request', { pilotName: 'arkadasb' });
    expect(r.json().outgoing).toEqual([expect.objectContaining({ pilotName: 'ArkadasB' })]);
    expect((await notes(b.playerId))[0]).toMatchObject({ kind: 'friend_request', body: 'ArkadasA (Sv 1) seni arkadaş olarak eklemek istiyor.' });
    r = await post(a, '/social/friends/request', { pilotName: 'ArkadasB' });
    expect(r.json().error.code).toBe('FRIEND_EXISTS');
    r = await post(b, '/social/friends/respond', { pilotName: 'ArkadasA', accept: true });
    expect(r.json().friends).toEqual([expect.objectContaining({ pilotName: 'ArkadasA', online: false, map: null })]);
    // Karşılıklı istek
    await post(a, '/social/friends/request', { pilotName: 'ArkadasC' });
    r = await post(c, '/social/friends/request', { pilotName: 'ArkadasA' });
    expect(r.json().friends.map((f: { pilotName: string }) => f.pilotName)).toEqual(['ArkadasA']);
    // Çevrimiçi durum: B oyunda (G-1 değil, K-2) ve görünür; C gizler
    await ctx.rt.redis!.set(`game:presence:${b.playerId}`, JSON.stringify({ map: 'K-2', station: false, instance: 'x', at: Date.now() }), 'EX', 30);
    await ctx.rt.redis!.set(`game:presence:${c.playerId}`, JSON.stringify({ map: 'K-1', station: true, instance: 'x', at: Date.now() }), 'EX', 30);
    await put(c, '/social/settings', { locationSharing: 'group', friendsSeeOnline: false, dmPolicy: 'everyone', groupInvites: 'everyone', friendRequests: true });
    const list = (await get(a, '/social/friends?server=TR1')).json().friends as Array<{ pilotName: string; online: boolean | null; map: { code: string } | null }>;
    expect(list.find((f) => f.pilotName === 'ArkadasB')).toMatchObject({ online: true, map: { code: 'K-2', name: 'Kızıl Kuşak' } });
    expect(list.find((f) => f.pilotName === 'ArkadasC')).toMatchObject({ online: null, map: null });
    // Engelleme: arkadaşlık silinir; engellenen istek gönderemez (kapalı istekle aynı mesaj)
    r = await post(b, '/social/block', { pilotName: 'ArkadasA' });
    expect(r.json().blocked).toEqual([expect.objectContaining({ pilotName: 'ArkadasA' })]);
    expect(r.json().friends).toEqual([]);
    r = await post(a, '/social/friends/request', { pilotName: 'ArkadasB' });
    expect(r.json().error).toMatchObject({ code: 'NOT_ALLOWED', message: 'ArkadasB şu an arkadaşlık isteği kabul etmiyor.' });
    r = await post(b, '/social/friends/request', { pilotName: 'ArkadasA' });
    expect(r.json().error.code).toBe('BLOCKED');
    // İsteğe kapalı pilot
    await put(c, '/social/settings', { locationSharing: 'group', friendsSeeOnline: true, dmPolicy: 'everyone', groupInvites: 'everyone', friendRequests: false });
    const d = await pilot('ArkadasD');
    r = await post(d, '/social/friends/request', { pilotName: 'ArkadasC' });
    expect(r.json().error.message).toBe('ArkadasC şu an arkadaşlık isteği kabul etmiyor.');
    // Profil ilişkisi
    expect((await get(a, '/social/relation?server=TR1&name=ArkadasC')).json()).toEqual({ friend: 'friends', blocked: false, self: false });
    expect((await get(b, '/social/relation?server=TR1&name=ArkadasA')).json()).toEqual({ friend: 'none', blocked: true, self: false });
    r = await post(b, '/social/unblock', { pilotName: 'ArkadasA' });
    expect(r.json().blocked).toEqual([]);
  });
});

describe('şikâyet, bildirim ve sohbet geçmişi', () => {
  it('mesaj şikâyeti anlık kopyayla kuyruğa düşer; aynı içerik tekrar şikâyet edilemez; özel mesajı yalnızca taraflar şikâyet eder', async () => {
    const a = await pilot('SikayetEden');
    const b = await pilot('SikayetEdilen');
    const c = await pilot('Ucuncu');
    const ins = (sender: string, channel: string, body: string, recipient: string | null = null) =>
      ctx.rt.db.query<{ id: string }>(`INSERT INTO chat_messages (server_id, channel, sender_id, recipient_id, body) VALUES (1, $1, $2, $3, $4) RETURNING id::text`, [channel, sender, recipient, body]);
    const m1 = (await ins(b.playerId, 'global', 'kaba bir mesaj')).rows[0]!.id;
    let r = await post(a, '/reports', { targetType: 'chat_message', target: m1, reason: 'insult', details: 'Genel kanalda hakaret' });
    expect(r.statusCode).toBe(201);
    const rep = (await ctx.rt.db.query(`SELECT target_type, target_player_id, reason, status, snapshot FROM reports WHERE id = $1`, [r.json().report.id])).rows[0];
    expect(rep).toMatchObject({ target_type: 'chat_message', target_player_id: b.playerId, reason: 'insult', status: 'open' });
    expect(rep.snapshot).toMatchObject({ body: 'kaba bir mesaj', sender: 'SikayetEdilen', channel: 'global' });
    r = await post(a, '/reports', { targetType: 'chat_message', target: m1, reason: 'spam' });
    expect(r.json().error.code).toBe('REPORT_EXISTS');
    r = await post(b, '/reports', { targetType: 'chat_message', target: m1, reason: 'spam' });
    expect(r.json().error.code).toBe('VALIDATION_ERROR');
    const dm = (await ins(b.playerId, `dm:${[a.playerId, b.playerId].sort().join(':')}`, 'özel', a.playerId)).rows[0]!.id;
    r = await post(c, '/reports', { targetType: 'chat_message', target: dm, reason: 'spam' });
    expect(r.json().error.code).toBe('NOT_FOUND');
    r = await post(a, '/reports', { targetType: 'player', target: 'sikayetedilen', reason: 'inappropriate_name' });
    expect(r.statusCode).toBe(201);
    r = await post(a, '/reports', { targetType: 'player', target: 'SikayetEden', reason: 'other' });
    expect(r.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('bildirimler listelenir, okunmamış sayısı düşer; geçmişte engellenen pilotun mesajı görünmez; klan kanalı yalnızca üyelere açık', async () => {
    const a = await founder('GecmisLider', 'GCM');
    const b = await pilot('GecmisB');
    const c = await pilot('GecmisC');
    await post(b, '/social/friends/request', { pilotName: 'GecmisLider' });
    await post(c, '/social/friends/request', { pilotName: 'GecmisLider' });
    let n = (await get(a, '/notifications?server=TR1')).json();
    expect(n.unread).toBe(2);
    expect(n.items.map((x: { kind: string }) => x.kind)).toEqual(['friend_request', 'friend_request']);
    n = (await post(a, '/notifications/read', { ids: [n.items[0].id] })).json();
    expect(n.unread).toBe(1);
    expect((await get(a, '/notifications/unread?server=TR1')).json()).toEqual({ unread: 1 });
    await post(a, '/notifications/read');
    expect((await get(a, '/notifications/unread?server=TR1')).json()).toEqual({ unread: 0 });
    // Sohbet geçmişi
    const clanId = (await ctx.rt.db.query(`SELECT id FROM clans WHERE tag = 'GCM'`)).rows[0].id;
    for (const [who, body] of [
      [b.playerId, 'B merhaba'],
      [c.playerId, 'C merhaba'],
    ] as const) {
      await ctx.rt.db.query(`INSERT INTO chat_messages (server_id, channel, sender_id, body) VALUES (1, 'global', $1, $2)`, [who, body]);
    }
    await ctx.rt.db.query(`INSERT INTO chat_messages (server_id, channel, sender_id, body) VALUES (1, $1, $2, 'klan içi')`, [`clan:${clanId}`, a.playerId]);
    await post(a, '/social/block', { pilotName: 'GecmisC' });
    const h = (await get(a, '/chat/history?server=TR1&channel=global')).json().messages;
    expect(h.map((m: { b: string }) => m.b)).toEqual(['B merhaba']);
    expect(h[0]).toMatchObject({ ch: 'global', from: { name: 'GecmisB', company: 'KZL', clanTag: null, level: 1 } });
    expect((await get(a, '/chat/history?server=TR1&channel=clan')).json().messages[0]).toMatchObject({ b: 'klan içi', from: { clanTag: 'GCM' } });
    expect((await get(b, '/chat/history?server=TR1&channel=clan')).json().error.code).toBe('NOT_IN_CLAN');
  });

  it('açık artırmada teklifi geçilen pilot bildirim alır', async () => {
    const now = new Date();
    const a = await pilot('TeklifA');
    const b = await pilot('TeklifB');
    await ctx.market.ensureAuctions(now);
    const list = (await get(a, '/market/auctions?server=TR1')).json().auctions;
    const lot = list.open.find((x: { type: string }) => x.type === 'hourly');
    await post(a, '/market/auctions/bid', { auctionId: lot.id, amount: lot.nextMinBid, requestId: randomUUID() });
    await post(b, '/market/auctions/bid', { auctionId: lot.id, amount: lot.nextMinBid + 1000, requestId: randomUUID() });
    const n = await notes(a.playerId);
    expect(n.at(-1)).toMatchObject({ kind: 'auction_outbid', title: 'Açık artırmada teklifin geçildi' });
    expect(n.at(-1)!.body).toContain('iade edildi');
  });
});

// ================================================================== oyun sunucusu: sohbet, grup, diplomasi
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
  constructor(readonly ws: WebSocket) {
    ws.on('message', (d) => this.messages.push(JSON.parse(d.toString()) as ServerMessage));
  }
  send(m: unknown) {
    this.ws.send(JSON.stringify(m));
  }
  async waitFor<T extends ServerMessage['t']>(t: T, pred: (m: Extract<ServerMessage, { t: T }>) => boolean = () => true, ms = 3000) {
    const end = Date.now() + ms;
    for (;;) {
      const m = this.messages.find((x) => x.t === t && pred(x as Extract<ServerMessage, { t: T }>));
      if (m) return m as Extract<ServerMessage, { t: T }>;
      if (Date.now() > end) throw new Error(`"${t}" gelmedi: ${JSON.stringify(this.messages.filter((x) => x.t === t || x.t === 'notice').slice(-5))}`);
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  all<T extends ServerMessage['t']>(t: T) {
    return this.messages.filter((m) => m.t === t) as Array<Extract<ServerMessage, { t: T }>>;
  }
  chats() {
    return this.all('chat').map((m) => m.m.b);
  }
  async flush() {
    const c = Math.random();
    this.send({ t: 'ping', c });
    await this.waitFor('pong', (m) => m.c === c);
  }
}
const clients: GameClient[] = [];

async function enter(p: P, map = 'K-1', x = 5000, y = 5000) {
  await ctx.rt.db.query(`UPDATE players SET pos_x = $2, pos_y = $3, map_id = (SELECT id FROM maps WHERE code = $4) WHERE id = $1`, [p.playerId, x, y, map]);
  const t = (await call(ctx.app, p.client, 'POST', '/game/ticket', { serverCode: 'TR1' })).json().ticket;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/game`, { headers: { origin: WEB_ORIGIN } });
  await new Promise<void>((res, rej) => (ws.once('open', () => res()), ws.once('error', rej)));
  const c = new GameClient(ws);
  clients.push(c);
  c.send({ t: 'hello', v: PROTOCOL_VERSION, ticket: t });
  const welcome = await c.waitFor('welcome');
  return { c, welcome };
}
/** Tüm sunucu işleri (Redis yayınları dahil) bitene kadar bekler. */
async function settle(...cs: GameClient[]) {
  for (const c of cs) await c.flush();
  await server!.idle();
  await new Promise((r) => setTimeout(r, 60));
  await server!.idle();
  for (const c of cs) await c.flush();
}

describe('sohbet kanalları (oyun sunucusu)', () => {
  it('genel/şirket/harita/klan/özel kanallar doğru pilotlara gider; engellenen pilotun mesajı iletilmez; küfür maskelenir; kayıt veritabanında', async () => {
    const lead = await founder('SohbetLider', 'SHB'); // KZL
    const mate = await pilot('KlanArkadasi', 'KZL');
    await join(lead, mate, 'SHB');
    const comp = await pilot('SirketArkadasi', 'KZL');
    const enemy = await pilot('YabanciSirket', 'GKB');
    await start();
    const A = await enter(lead, 'K-1');
    const B = await enter(mate, 'K-2');
    const C = await enter(comp, 'K-1');
    const D = await enter(enemy, 'G-1');
    const all = [A.c, B.c, C.c, D.c];
    A.c.send({ t: 'chat', ch: 'global', b: 'Herkese  selam​!' });
    await settle(...all);
    for (const c of all) expect(c.chats()).toEqual(['Herkese selam!']);
    expect(A.c.all('chat')[0]!.m).toMatchObject({ ch: 'global', from: { name: 'SohbetLider', company: 'KZL', clanTag: 'SHB', level: 5 } });
    A.c.send({ t: 'chat', ch: 'company', b: 'şirket' });
    A.c.send({ t: 'chat', ch: 'map', b: 'harita' });
    A.c.send({ t: 'chat', ch: 'clan', b: 'klan' });
    await settle(...all);
    expect(B.c.chats()).toEqual(['Herkese selam!', 'şirket', 'klan']); // K-2'de: harita mesajını almaz
    expect(C.c.chats()).toEqual(['Herkese selam!', 'şirket', 'harita']); // klanda değil
    expect(D.c.chats()).toEqual(['Herkese selam!']); // başka şirket, başka harita
    // Klan kanalı klansız pilota kapalı
    C.c.send({ t: 'chat', ch: 'clan', b: 'deneme' });
    await settle(C.c);
    expect((await C.c.waitFor('notice', (n) => n.text.startsWith('Bir klanda değilsin'))).kind).toBe('error');
    // Özel mesaj yalnızca iki tarafa
    D.c.send({ t: 'chat', ch: 'dm', to: 'sohbetlider', b: 'Sana özel' });
    await settle(...all);
    expect(A.c.all('chat').at(-1)!.m).toMatchObject({ ch: 'dm', to: 'SohbetLider', b: 'Sana özel', from: { name: 'YabanciSirket' } });
    expect(D.c.chats().at(-1)).toBe('Sana özel');
    expect(B.c.chats()).not.toContain('Sana özel');
    // Küfür filtresi
    C.c.send({ t: 'chat', ch: 'global', b: 'Bu ne SİİİKTİR be' });
    await settle(...all);
    expect(A.c.chats().at(-1)).toBe('Bu ne ******** be');
    // Engelleme (API üzerinden) → oyun sunucusu canlı olarak öğrenir; engelleyen artık bu pilotun mesajlarını almaz
    await post(lead, '/social/block', { pilotName: 'SirketArkadasi' });
    await settle(...all);
    expect(server!.socialOf(lead.playerId)!.blocked).toEqual([comp.playerId]);
    C.c.send({ t: 'chat', ch: 'global', b: 'engellendikten sonra' });
    await settle(...all);
    expect(B.c.chats().at(-1)).toBe('engellendikten sonra');
    expect(A.c.chats()).not.toContain('engellendikten sonra');
    // Engellenen pilot özel mesaj gönderemez (kapalı DM ile aynı mesaj)
    C.c.send({ t: 'chat', ch: 'dm', to: 'SohbetLider', b: 'cevap ver' });
    await settle(...all);
    expect((await C.c.waitFor('notice', (n) => n.text.includes('özel mesaj kabul etmiyor'))).text).toBe('SohbetLider şu an senden özel mesaj kabul etmiyor.');
    expect(A.c.chats()).not.toContain('cevap ver');
    const rows = await ctx.rt.db.query(`SELECT channel, body, filtered FROM chat_messages ORDER BY id`);
    expect(rows.rows.map((r) => r.channel.split(':')[0])).toEqual(['global', 'company', 'map', 'clan', 'dm', 'global', 'global']);
    expect(rows.rows.find((r) => r.filtered)).toMatchObject({ body: 'Bu ne ******** be' });
  });

  it('hız sınırı: 10 sn içinde 5 mesajdan fazlası gönderilemez, pilot kısa süre susturulur', async () => {
    const a = await pilot('SelSohbet');
    await start();
    const A = await enter(a);
    for (let i = 0; i < 8; i++) A.c.send({ t: 'chat', ch: 'global', b: `mesaj ${i}` });
    await settle(A.c);
    expect(A.c.chats()).toEqual(['mesaj 0', 'mesaj 1', 'mesaj 2', 'mesaj 3', 'mesaj 4']);
    expect(A.c.all('notice').map((n) => n.text)).toContain('Çok hızlı mesaj gönderdin; 60 sn boyunca yazamazsın.');
    expect(Number((await ctx.rt.db.query('SELECT count(*) AS n FROM chat_messages')).rows[0].n)).toBe(5);
  });
});

describe('grup (oyun sunucusu, Redis)', () => {
  it('davet → kabul; üyenin farklı haritadaki konumu ÜYENİN iznine göre görünür; grup kanalı; grup içi saldırı yok; ayrılınca grup dağılır', async () => {
    const a = await pilot('GrupLideri', 'KZL');
    const b = await pilot('GrupUyesi', 'GKB');
    const x = await pilot('GrupDisi', 'KZL');
    await start();
    const A = await enter(a, 'K-2', 5000, 5000);
    const B = await enter(b, 'G-1', 7000, 6000);
    const X = await enter(x, 'K-2', 5200, 5000);
    A.c.send({ t: 'party', a: 'invite', n: 'GrupUyesi' });
    await settle(A.c, B.c);
    expect(await B.c.waitFor('pinv')).toMatchObject({ from: 'GrupLideri', company: 'KZL', expiresIn: 60 });
    B.c.send({ t: 'party', a: 'accept', n: 'GrupLideri' });
    await settle(A.c, B.c);
    await server!.partyTick();
    await settle(A.c, B.c);
    const view = () => A.c.all('party').at(-1)!.p!;
    expect(view().members.map((m) => [m.name, m.leader, m.you])).toEqual([
      ['GrupLideri', true, true],
      ['GrupUyesi', false, false],
    ]);
    // Varsayılan izin "harita ve konum": farklı haritadaki üyenin haritası ve koordinatı görünür
    expect(view().members[1]).toMatchObject({ online: true, map: { code: 'G-1' }, x: 7000, y: 6000, entityId: null, hp: 100 });
    // Üye izni "yalnızca harita"ya çevirir → koordinat gizlenir
    await put(b, '/social/settings', { locationSharing: 'map', friendsSeeOnline: true, dmPolicy: 'everyone', groupInvites: 'everyone', friendRequests: true });
    await settle(A.c, B.c);
    await server!.partyTick();
    await settle(A.c);
    expect(view().members[1]).toMatchObject({ map: { code: 'G-1', name: expect.any(String) }, x: null, y: null });
    // "Gizli" → harita da gizlenir
    await put(b, '/social/settings', { locationSharing: 'none', friendsSeeOnline: true, dmPolicy: 'everyone', groupInvites: 'everyone', friendRequests: true });
    await settle(A.c, B.c);
    await server!.partyTick();
    await settle(A.c);
    expect(view().members[1]).toMatchObject({ map: null, x: null, y: null });
    // Grup kanalı yalnızca üyelere
    B.c.send({ t: 'chat', ch: 'group', b: 'grup mesajı' });
    await settle(A.c, B.c, X.c);
    expect(A.c.chats()).toEqual(['grup mesajı']);
    expect(X.c.chats()).toEqual([]);
    // Lider olmayan davet gönderemez
    B.c.send({ t: 'party', a: 'invite', n: 'GrupDisi' });
    await settle(B.c);
    expect((await B.c.waitFor('notice', (n) => n.text.includes('lider'))).text).toBe('Yalnızca grup lideri davet gönderebilir.');
    // Grup üyesine saldırı yok (farklı şirket, PvP haritası): A'nın yanındaki GKB pilotu gruba katılır
    const e = await pilot('GrupKomsu', 'GKB');
    const E = await enter(e, 'K-2', 5300, 5000);
    A.c.send({ t: 'party', a: 'invite', n: 'GrupKomsu' });
    await settle(A.c, E.c);
    E.c.send({ t: 'party', a: 'accept', n: 'GrupLideri' });
    await settle(A.c, E.c);
    await server!.partyTick();
    for (let i = 0; i < 2; i++) server!.tick();
    await settle(A.c, E.c);
    expect(view().members.map((m) => m.name)).toEqual(['GrupLideri', 'GrupUyesi', 'GrupKomsu']);
    // Aynı haritadaki üye için varlık kimliği verilir (mini harita)
    expect(view().members[2]).toMatchObject({ entityId: E.welcome.id, map: { code: 'K-2' } });
    A.c.send({ t: 'target', id: E.welcome.id });
    A.c.send({ t: 'attack', on: true });
    await A.c.flush();
    for (let i = 0; i < 10; i++) server!.tick();
    await settle(A.c);
    expect((await A.c.waitFor('notice', (n) => n.text === 'Grup arkadaşına saldıramazsın.')).kind).toBe('error');
    expect(E.c.all('snap').at(-1)!.st.slice(0, 3)).toEqual([4000, 4000, 1000]);
    // Lider ayrılınca en eski üye lider olur; sonra iki kişilik grup, biri ayrılınca dağılır
    A.c.send({ t: 'party', a: 'leave' });
    await settle(A.c, B.c, E.c);
    await server!.partyTick();
    await settle(A.c, B.c, E.c);
    expect(A.c.all('party').at(-1)!.p).toBeNull();
    expect(B.c.all('party').at(-1)!.p!.members.map((m) => [m.name, m.leader])).toEqual([
      ['GrupUyesi', true],
      ['GrupKomsu', false],
    ]);
    B.c.send({ t: 'party', a: 'leave' });
    await settle(B.c, E.c);
    await server!.partyTick();
    await settle(B.c, E.c);
    expect(E.c.all('party').at(-1)!.p).toBeNull();
    expect(E.c.all('notice').map((n) => n.text)).toContain('Grupta başka pilot kalmadığı için grup dağıldı.');
    expect(await ctx.rt.redis!.keys('party:*')).toEqual([]);
  });

  it('eşzamanlı kabullerde grup sınırı (8) aşılamaz', async () => {
    const lead = await pilot('KalabalikLider');
    const ps: P[] = [];
    for (let i = 0; i < 10; i++) ps.push(await pilot(`Kalabalik${i}`));
    await start();
    const L = await enter(lead);
    const cs: GameClient[] = [];
    for (const p of ps) cs.push((await enter(p)).c);
    for (const p of ps) L.c.send({ t: 'party', a: 'invite', n: p.name });
    await settle(L.c, ...cs);
    for (const c of cs) c.send({ t: 'party', a: 'accept', n: 'KalabalikLider' });
    await settle(L.c, ...cs);
    const pid = await ctx.rt.redis!.get(`party:of:${lead.playerId}`);
    expect(await ctx.rt.redis!.zcard(`party:${pid}:m`)).toBe(8);
    const full = cs.flatMap((c) => c.all('notice').map((n) => n.text)).filter((t) => t === 'Grup dolu (en fazla 8 pilot).');
    expect(full.length).toBe(3);
  });
});

describe('diplomasi ve saldırı kuralı (oyun sunucusu)', () => {
  it('savaştaki klanlar aynı şirketten olsa da PvP haritasında birbirine saldırabilir; ittifakta farklı şirket de saldıramaz', async () => {
    const a = await founder('SavasciA', 'SVA', 'KZL');
    const b = await founder('SavasciB', 'SVB', 'KZL');
    const c = await founder('MuttefikC', 'MTC', 'GKB');
    await start();
    const A = await enter(a, 'K-2', 5000, 5000);
    const B = await enter(b, 'K-2', 5300, 5000);
    const C = await enter(c, 'K-2', 5000, 5300);
    for (let i = 0; i < 2; i++) server!.tick();
    await settle(A.c, B.c, C.c);
    // Klan etiketi pilot bilgisinde
    expect(A.c.all('enter').flatMap((m) => m.e).find((e) => e.id === B.welcome.id)).toMatchObject({ n: 'SavasciB', ct: 'SVB' });
    // Savaş yokken aynı şirket saldıramaz
    A.c.send({ t: 'target', id: B.welcome.id });
    A.c.send({ t: 'attack', on: true });
    await A.c.flush();
    for (let i = 0; i < 6; i++) server!.tick();
    await settle(A.c);
    expect((await A.c.waitFor('notice')).text).toBe('Kendi şirketinden pilota saldıramazsın.');
    // Savaş ilanı (API) → oyun sunucusu ilişkiyi canlı öğrenir → saldırı serbest
    await post(a, '/clan/diplomacy/war', { tag: 'SVB' });
    await settle(A.c, B.c);
    expect(A.c.all('social').length).toBeGreaterThan(0);
    A.c.send({ t: 'target', id: B.welcome.id });
    A.c.send({ t: 'attack', on: true });
    await A.c.flush();
    for (let i = 0; i < 30; i++) server!.tick();
    await settle(A.c, B.c);
    const st = B.c.all('snap').at(-1)!.st;
    expect(st[0] + st[2]).toBeLessThan(4000 + 1000); // can + kalkan azaldı
    // İttifak: farklı şirket de saldıramaz
    await post(a, '/clan/diplomacy/propose', { tag: 'MTC', relation: 'alliance' });
    await post(c, '/clan/diplomacy/respond', { tag: 'SVA', accept: true });
    await settle(A.c, C.c);
    A.c.messages.length = 0;
    A.c.send({ t: 'target', id: C.welcome.id });
    A.c.send({ t: 'attack', on: true });
    await A.c.flush();
    for (let i = 0; i < 30; i++) server!.tick(); // önceki atıştan sonraki lazer bekleme süresi
    await settle(A.c);
    expect((await A.c.waitFor('notice', (n) => n.text.includes('klandan'))).text).toBe('Müttefik klandan pilota saldıramazsın.');
  });
});
