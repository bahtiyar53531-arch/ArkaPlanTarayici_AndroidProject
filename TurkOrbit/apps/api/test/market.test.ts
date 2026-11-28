/**
 * Ekonomi entegrasyon testleri (Aşama 11) — gerçek PostgreSQL + Redis, gerçek içerik (0007).
 * Zaman taklidi: servis saati test içinden ayarlanır (üretim süresi, günlük ödül, açık artırma dönemleri).
 */
import { xpForLevel } from '@turkorbit/shared';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTransaction } from '../src/db/pool.js';
import { grantItem } from '../src/modules/economy/inventory.js';
import { call, createTestContext, newClient, registerAndLogin, resetDatabase, type Client, type TestContext } from './helpers.js';

let ctx: TestContext;
let now = new Date('2026-11-28T10:20:00Z');

beforeAll(async () => {
  ctx = await createTestContext({}, undefined, { clock: () => now });
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetDatabase(ctx.rt);
  await ctx.rt.db.query('DELETE FROM auctions');
  now = new Date('2026-11-28T10:20:00Z');
});

async function pilot(username: string, company = 'ALT') {
  const { client } = await registerAndLogin(ctx, username, { client: newClient({ ip: `88.230.${Math.floor(Math.random() * 200)}.1` }) });
  const r = await call(ctx.app, client, 'POST', '/players', { serverCode: 'TR1', companyCode: company });
  if (r.statusCode !== 201) throw new Error(r.body);
  return { client, playerId: r.json().pilot.id as string };
}
/** Test için envantere eşya ekler (defterli, gerçek çekirdek fonksiyonla). */
async function give(playerId: string, code: string, qty: number) {
  const it = (await ctx.rt.db.query<{ id: number; stackable: boolean }>('SELECT id, stackable FROM item_types WHERE code = $1', [code])).rows[0]!;
  await withTransaction(ctx.rt.db, (c) => grantItem(c, playerId, it, qty, { reason: 'admin_grant' }));
}
const qty = async (playerId: string, code: string) =>
  Number(
    (await ctx.rt.db.query(`SELECT COALESCE(sum(pi.quantity), 0) AS n FROM player_items pi JOIN item_types it ON it.id = pi.item_type_id WHERE pi.player_id = $1 AND it.code = $2`, [playerId, code]))
      .rows[0].n,
  );
const balance = async (playerId: string, cur = 'KREDI') =>
  Number((await ctx.rt.db.query('SELECT balance FROM wallets WHERE player_id = $1 AND currency_code = $2', [playerId, cur])).rows[0]?.balance ?? 0);
const setBalance = (playerId: string, amount: number, cur = 'KREDI') =>
  ctx.rt.db.query('UPDATE wallets SET balance = $3 WHERE player_id = $1 AND currency_code = $2', [playerId, cur, amount]);
const setLevel = (playerId: string, level: number) => ctx.rt.db.query('UPDATE players SET experience = $2 WHERE id = $1', [playerId, xpForLevel(level)]);
const post = (client: Client, url: string, body: Record<string, unknown>) => call(ctx.app, client, 'POST', url, { serverCode: 'TR1', ...body });
const get = (client: Client, url: string) => call(ctx.app, client, 'GET', url);

// ------------------------------------------------------------------ kaynak satışı
describe('kaynaklar', () => {
  it('kaynak hangar satış ucuyla Kredi karşılığı satılır (defterli); Yıldız Özü satılamaz; ambar listesi doğru', async () => {
    const { client, playerId } = await pilot('MadenciSatici');
    await give(playerId, 'res.ferrolit', 40);
    await give(playerId, 'res.yildiz-ozu', 1);
    const c = (await get(client, '/market/crafting?server=TR1')).json().crafting;
    expect(c.cargo).toEqual({ used: 41, capacity: 100 }); // Kırlangıç ambarı 100
    const fer = c.resources.find((r: { code: string }) => r.code === 'res.ferrolit');
    expect(fer).toMatchObject({ name: 'Ferrolit', tier: 1, quantity: 40, sellPrice: 10 });
    const before = await balance(playerId);
    let r = await post(client, `/hangar/items/${fer.itemId}/sell`, { quantity: 30, requestId: randomUUID() });
    expect(r.statusCode).toBe(200);
    expect(await balance(playerId)).toBe(before + 300);
    expect(await qty(playerId, 'res.ferrolit')).toBe(10);
    const oz = c.resources.find((x: { code: string }) => x.code === 'res.yildiz-ozu');
    r = await post(client, `/hangar/items/${oz.itemId}/sell`, { quantity: 1, requestId: randomUUID() });
    expect(r.json().error.code).toBe('NOT_SELLABLE');
  });
});

// ------------------------------------------------------------------ üretim
describe('rafineri ve üretim', () => {
  it('girdiler hemen düşülür; süre dolmadan teslim alınamaz; süre dolunca çıktı bir kez verilir; üretim görevi ilerler', async () => {
    const { client, playerId } = await pilot('Rafineri');
    await setLevel(playerId, 5);
    await ctx.rt.db.query(
      `INSERT INTO player_quests (player_id, quest_id, cycle_key, status, completed_at, claimed_at)
       SELECT $1, id, 'once', 'claimed', now(), now() FROM quests WHERE code = ANY($2)`,
      [playerId, ['altayin-mirasi-01', 'altayin-mirasi-02', 'altayin-mirasi-03', 'altayin-mirasi-04']],
    );
    expect((await post(client, '/quests/accept', { code: 'altayin-mirasi-05' })).statusCode).toBe(200); // 2 Nebulit üret
    await give(playerId, 'res.kuvarsit', 20);
    await give(playerId, 'res.ferrolit', 25);
    const k0 = await balance(playerId);
    let r = await post(client, '/market/crafting/start', { recipe: 'nebulit', batches: 2, requestId: randomUUID() });
    expect(r.statusCode).toBe(200);
    const job = r.json().crafting.jobs[0];
    expect(job).toMatchObject({ recipe: 'nebulit', batches: 2, output: { code: 'res.nebulit', quantity: 2 }, ready: false });
    expect(Date.parse(job.readyAt) - now.getTime()).toBe(60_000); // 2 × 30 sn
    expect([await qty(playerId, 'res.kuvarsit'), await qty(playerId, 'res.ferrolit'), await balance(playerId)]).toEqual([0, 5, k0 - 100]);
    r = await post(client, '/market/crafting/claim', { jobId: job.id });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toMatchObject({ code: 'CRAFT_NOT_READY', message: 'Üretim henüz bitmedi (60 sn kaldı).' });
    now = new Date(now.getTime() + 60_000);
    r = await post(client, '/market/crafting/claim', { jobId: job.id });
    expect(r.json()).toMatchObject({ replay: false, claimed: { code: 'res.nebulit', quantity: 2 } });
    expect((await post(client, '/market/crafting/claim', { jobId: job.id })).json().replay).toBe(true);
    expect(await qty(playerId, 'res.nebulit')).toBe(2);
    const led = await ctx.rt.db.query(
      `SELECT it.code, l.reason, sum(l.delta)::int AS d FROM item_ledger l JOIN item_types it ON it.id = l.item_type_id
       WHERE l.player_id = $1 AND l.reason LIKE 'crafting%' GROUP BY 1, 2 ORDER BY 1, 2`,
      [playerId],
    );
    expect(led.rows).toEqual([
      { code: 'res.ferrolit', reason: 'crafting_input', d: -20 },
      { code: 'res.kuvarsit', reason: 'crafting_input', d: -20 },
      { code: 'res.nebulit', reason: 'crafting_output', d: 2 },
    ]);
    const q = (await get(client, '/quests?server=TR1')).json().quests.quests.find((x: { code: string }) => x.code === 'altayin-mirasi-05');
    expect(q.status).toBe('completed');
  });

  it('yetersiz kaynakta hiçbir şey düşülmez; seviye kilidi; en fazla 3 eşzamanlı üretim; aynı istek kimliği bir kez uygulanır', async () => {
    const { client, playerId } = await pilot('Atolye');
    await give(playerId, 'res.ferrolit', 70);
    const k0 = await balance(playerId);
    let r = await post(client, '/market/crafting/start', { recipe: 'nebulit', batches: 1, requestId: randomUUID() });
    expect(r.json().error).toMatchObject({ code: 'INSUFFICIENT_RESOURCES', message: 'Yetersiz kaynak: 10 Kuvarsit gerekiyor (elinde 0).' });
    expect([await qty(playerId, 'res.ferrolit'), await balance(playerId)]).toEqual([70, k0]);
    r = await post(client, '/market/crafting/start', { recipe: 'kozmit', batches: 1, requestId: randomUUID() });
    expect(r.json().error.code).toBe('LEVEL_TOO_LOW');
    const rid = randomUUID();
    expect((await post(client, '/market/crafting/start', { recipe: 'yildirim', batches: 1, requestId: rid })).json().replay).toBe(false);
    expect((await post(client, '/market/crafting/start', { recipe: 'yildirim', batches: 1, requestId: rid })).json().replay).toBe(true);
    expect(await qty(playerId, 'res.ferrolit')).toBe(50); // tekrar istek ikinci kez düşmedi
    await post(client, '/market/crafting/start', { recipe: 'yildirim', batches: 1, requestId: randomUUID() });
    await post(client, '/market/crafting/start', { recipe: 'yildirim', batches: 1, requestId: randomUUID() });
    r = await post(client, '/market/crafting/start', { recipe: 'yildirim', batches: 1, requestId: randomUUID() });
    expect(r.json().error.code).toBe('CRAFT_SLOTS_FULL');
    expect(await qty(playerId, 'res.ferrolit')).toBe(10);
    // Kurcalanmış istek: bilinmeyen alan reddedilir (fiyat/çıktı istemciden gelmez)
    r = await post(client, '/market/crafting/start', { recipe: 'yildirim', batches: 1, requestId: randomUUID(), output: 999 });
    expect(r.json().error.code).toBe('VALIDATION_ERROR');
  });
});

// ------------------------------------------------------------------ günlük ödül
describe('günlük giriş ödülü', () => {
  it('günde bir kez alınır; art arda günlerde seri artar, kaçırılınca 1. güne döner; 7. günden sonra başa döner; eşzamanlı istek tek ödül verir', async () => {
    const { client, playerId } = await pilot('GunlukPilot');
    const k0 = await balance(playerId);
    let d = (await get(client, '/market/daily?server=TR1')).json().daily;
    expect(d).toMatchObject({ today: '2026-11-28', claimedToday: false, day: 1, streak: 1, nextReset: '2026-11-29T02:00:00.000Z' });
    expect(d.calendar).toHaveLength(7);
    let r = await post(client, '/market/daily/claim', {});
    expect(r.json()).toMatchObject({ replay: false, reward: { day: 1, streak: 1, currencies: [{ code: 'KREDI', amount: 2000 }] } });
    expect((await post(client, '/market/daily/claim', {})).json().replay).toBe(true);
    expect(await balance(playerId)).toBe(k0 + 2000);
    // Ertesi gün (05:00 TSİ sonrası): eşzamanlı iki istek
    now = new Date('2026-11-29T03:00:00Z');
    const [a, b] = await Promise.all([post(client, '/market/daily/claim', {}), post(client, '/market/daily/claim', {})]);
    expect([a.json().replay, b.json().replay].sort()).toEqual([false, true]);
    expect((a.json().replay ? b : a).json().reward).toMatchObject({ day: 2, streak: 2, items: [{ code: 'ammo.isk1', amount: 500 }] });
    // Bir gün atlanırsa seri 1'e döner
    now = new Date('2026-12-01T03:00:00Z');
    r = await post(client, '/market/daily/claim', {});
    expect(r.json().reward).toMatchObject({ day: 1, streak: 1 });
    const n = await ctx.rt.db.query(`SELECT count(*)::int AS n FROM currency_ledger WHERE player_id = $1 AND reason = 'daily_login'`, [playerId]);
    expect(n.rows[0].n).toBe(2); // 1. gün iki kez Kredi (28.11 ve 01.12); 2. gün eşya
    // 7. günden sonra başa döner
    await ctx.rt.db.query(`INSERT INTO player_daily_logins (player_id, cycle_date, streak, day_number) VALUES ($1, '2026-12-01'::date + 1, 7, 7)`, [playerId]);
    now = new Date('2026-12-03T03:00:00Z');
    d = (await get(client, '/market/daily?server=TR1')).json().daily;
    expect(d).toMatchObject({ claimedToday: false, day: 1, streak: 8 });
  });
});

// ------------------------------------------------------------------ açık artırma
describe('açık artırma', () => {
  const nebulitAuction = async (client: Client) => {
    const a = (await get(client, '/market/auctions?server=TR1')).json().auctions;
    return { list: a, lot: a.open.find((x: { item: { code: string }; type: string }) => x.item.code === 'res.nebulit' && x.type === 'hourly') };
  };

  it('dönem açık artırmaları oluşur; teklif emanete alınır, geçilen teklif iade edilir; en düşük artış; son saniye uzatması; kapanışta kazanan eşyayı alır', async () => {
    const A = await pilot('TeklifciA');
    const B = await pilot('TeklifciB');
    const { list, lot } = await nebulitAuction(A.client);
    expect(list.open).toHaveLength(9);
    expect(lot).toMatchObject({ minBid: 4000, currentBid: null, nextMinBid: 4000, endsAt: '2026-11-28T11:00:00.000Z', item: { quantity: 10 } });
    expect(list.open.find((x: { type: string }) => x.type === 'daily').endsAt).toBe('2026-11-29T02:00:00.000Z');
    expect(list.open.find((x: { type: string }) => x.type === 'weekly').endsAt).toBe('2026-11-30T02:00:00.000Z');
    const a0 = await balance(A.playerId);
    const b0 = await balance(B.playerId);
    const bid = (who: { client: Client }, amount: number) => post(who.client, '/market/auctions/bid', { auctionId: lot.id, amount, requestId: randomUUID() });
    expect((await bid(A, 3000)).json().error).toMatchObject({ code: 'BID_TOO_LOW', message: 'En az 4.000 Kredi teklif etmelisin.' });
    let r = await bid(A, 4000);
    expect(r.json().auctions.open.find((x: { id: number }) => x.id === lot.id)).toMatchObject({ currentBid: 4000, leading: true, myBid: 4000, nextMinBid: 4200 });
    expect(await balance(A.playerId)).toBe(a0 - 4000);
    expect((await bid(B, 4100)).json().error.code).toBe('BID_TOO_LOW');
    r = await bid(B, 4200);
    expect(r.statusCode).toBe(200);
    expect([await balance(A.playerId), await balance(B.playerId)]).toEqual([a0, b0 - 4200]); // A'ya iade edildi
    // Son 60 sn'de gelen teklif süreyi uzatır
    now = new Date('2026-11-28T10:59:30Z');
    r = await bid(A, 4410);
    expect(r.json().auctions.open.find((x: { id: number }) => x.id === lot.id).endsAt).toBe('2026-11-28T11:00:30.000Z');
    expect(await balance(B.playerId)).toBe(b0);
    now = new Date('2026-11-28T11:00:10Z');
    expect((await nebulitAuction(B.client)).list.open.some((x: { id: number }) => x.id === lot.id)).toBe(true); // hâlâ açık
    now = new Date('2026-11-28T11:01:00Z');
    const after = (await nebulitAuction(A.client)).list;
    expect(after.history.find((x: { id: number }) => x.id === lot.id)).toMatchObject({ status: 'settled', won: true, currentBid: 4410 });
    expect(await qty(A.playerId, 'res.nebulit')).toBe(10);
    expect(await balance(A.playerId)).toBe(a0 - 4410);
    expect(await ctx.market.settleDue(new Date('2026-11-28T11:02:00Z'))).toBe(0); // tekrar sonuçlandırılmaz
    // Yeni saatin açık artırması oluştu; teklifsiz olanlar kazanansız kapandı
    expect(after.open.find((x: { item: { code: string }; type: string }) => x.item.code === 'res.nebulit' && x.type === 'hourly').endsAt).toBe('2026-11-28T12:00:00.000Z');
    const noBid = await ctx.rt.db.query(`SELECT count(*)::int AS n FROM auctions WHERE status = 'settled' AND winner_id IS NULL`);
    expect(noBid.rows[0].n).toBe(2);
    const led = await ctx.rt.db.query(
      `SELECT player_id, reason, delta::int AS d FROM currency_ledger WHERE reason LIKE 'auction%' ORDER BY id`,
    );
    expect(led.rows.map((x) => [x.player_id === A.playerId ? 'A' : 'B', x.reason, x.d])).toEqual([
      ['A', 'auction_bid', -4000],
      ['A', 'auction_refund', 4000],
      ['B', 'auction_bid', -4200],
      ['B', 'auction_refund', 4200],
      ['A', 'auction_bid', -4410],
    ]);
  });

  it('eşzamanlı teklifler: tek lider, kaybedenlerin tüm teklifleri iade edilir, negatif bakiye yok', async () => {
    const players = await Promise.all(Array.from({ length: 8 }, (_, i) => pilot(`Yaris${i}`)));
    const { lot } = await nebulitAuction(players[0]!.client);
    const start = await Promise.all(players.map((p) => balance(p.playerId)));
    // Herkes aynı anda artan tutarlarla teklif verir (bazıları en düşük artışın altında kalabilir)
    const res = await Promise.all(players.map((p, i) => post(p.client, '/market/auctions/bid', { auctionId: lot.id, amount: 4000 + i * 500, requestId: randomUUID() })));
    expect(res.every((r) => r.statusCode === 200 || r.json().error.code === 'BID_TOO_LOW')).toBe(true);
    const a = (await ctx.rt.db.query('SELECT current_bid, current_bidder FROM auctions WHERE id = $1', [lot.id])).rows[0];
    const ends = await Promise.all(players.map((p) => balance(p.playerId)));
    for (const [i, p] of players.entries()) {
      expect(ends[i]).toBeGreaterThanOrEqual(0);
      expect(ends[i]).toBe(p.playerId === a.current_bidder ? start[i]! - Number(a.current_bid) : start[i]);
    }
  });
});

// ------------------------------------------------------------------ mağaza: 07 kabul ölçütü
describe('mağaza eşzamanlılık ve paketler', () => {
  const offerId = async (client: Client, code: string) => {
    const s = (await get(client, '/shop?server=TR1')).json().shop;
    return s.categories.flatMap((c: { offers: Array<{ code: string; id: number; name: string }> }) => c.offers).find((x: { code: string; name: string }) => x.code === code || x.name === code).id as number;
  };

  it('50 eşzamanlı satın alma isteğinde bakiye eksiye düşmez; aynı idempotency anahtarı yalnızca bir kez uygulanır', async () => {
    const { client, playerId } = await pilot('YarisAlici');
    const offer = await offerId(client, 'ammo.isk1'); // 1.000 adet = 10.000 Kredi
    await setBalance(playerId, 35_000);
    const res = await Promise.all(Array.from({ length: 50 }, () => post(client, '/shop/purchase', { offerId: offer, packs: 1, requestId: randomUUID() })));
    const ok = res.filter((r) => r.statusCode === 200).length;
    expect(ok).toBe(3);
    expect(res.filter((r) => r.statusCode !== 200).every((r) => r.json().error.code === 'INSUFFICIENT_FUNDS')).toBe(true);
    expect(await balance(playerId)).toBe(5_000);
    const led = await ctx.rt.db.query(`SELECT count(*)::int AS n, sum(delta)::int AS s FROM currency_ledger WHERE player_id = $1 AND reason = 'shop_purchase'`, [playerId]);
    expect(led.rows[0]).toEqual({ n: 3, s: -30_000 });
    // Aynı istek kimliğiyle 50 eşzamanlı istek: tek satın alma
    await setBalance(playerId, 100_000);
    const rid = randomUUID();
    const same = await Promise.all(Array.from({ length: 50 }, () => post(client, '/shop/purchase', { offerId: offer, packs: 1, requestId: rid })));
    expect(same.every((r) => r.statusCode === 200)).toBe(true);
    expect(same.filter((r) => r.json().purchase.replay === false)).toHaveLength(1);
    expect(await balance(playerId)).toBe(90_000);
    expect((await ctx.rt.db.query('SELECT count(*)::int AS n FROM shop_purchases WHERE player_id = $1', [playerId])).rows[0].n).toBe(4);
  });

  it('paket: indirimli fiyat, içerikteki tüm eşyalar tek işlemde; hesap başına sınır; içerikteki en yüksek seviye şartı', async () => {
    const { client, playerId } = await pilot('PaketAlici');
    const s = (await get(client, '/shop?server=TR1')).json().shop;
    const paketler = s.categories.find((c: { code: string }) => c.code === 'paketler').offers;
    const acemi = paketler.find((o: { name: string }) => o.name === 'Acemi Pilot Paketi');
    expect(acemi).toMatchObject({ type: 'bundle', currency: 'AKCE', price: 500, finalPrice: 300, discountPercent: 40, minLevel: 1 });
    expect(acemi.bundle.map((b: { code: string; quantity: number }) => [b.code, b.quantity])).toEqual([['ammo.isk1', 3000], ['ammo.isk2', 500], ['rocket.yildirim', 50], ['extra.kargo', 1]]);
    const isk1 = await qty(playerId, 'ammo.isk1');
    let r = await post(client, '/shop/purchase', { offerId: acemi.id, packs: 1, requestId: randomUUID() });
    expect(r.statusCode).toBe(200);
    expect(await balance(playerId, 'AKCE')).toBe(1000 - 300);
    expect([await qty(playerId, 'ammo.isk1'), await qty(playerId, 'ammo.isk2'), await qty(playerId, 'extra.kargo')]).toEqual([isk1 + 3000, 500, 1]);
    r = await post(client, '/shop/purchase', { offerId: acemi.id, packs: 1, requestId: randomUUID() });
    expect(r.json().error.code).toBe('PURCHASE_LIMIT');
    const avci = paketler.find((o: { name: string }) => o.name === 'Avcı Paketi');
    expect(avci.minLevel).toBe(6);
    expect((await post(client, '/shop/purchase', { offerId: avci.id, packs: 1, requestId: randomUUID() })).json().error.code).toBe('LEVEL_TOO_LOW');
  });
});
