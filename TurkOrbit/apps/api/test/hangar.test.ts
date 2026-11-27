import { xpForLevel, type HangarResponse, type InventoryItem, type ShopResponse } from '@turkorbit/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { call, createTestContext, newClient, registerAndLogin, resetDatabase, type Client, type TestContext } from './helpers.js';

let ctx: TestContext;
let nextRoll = 0;
beforeAll(async () => {
  ctx = await createTestContext({}, undefined, { rng: () => nextRoll });
});
afterAll(async () => ctx.close());
beforeEach(async () => {
  await resetDatabase(ctx.rt);
  nextRoll = 0;
});

const rid = () => crypto.randomUUID();

async function pilot(username: string, company = 'KZL') {
  const { client } = await registerAndLogin(ctx, username, { client: newClient({ ip: `85.105.${Math.floor(Math.random() * 200)}.1` }) });
  const r = await call(ctx.app, client, 'POST', '/players', { serverCode: 'TR1', companyCode: company });
  if (r.statusCode !== 201) throw new Error(r.body);
  return { client, playerId: r.json().pilot.id as string };
}

async function hangar(client: Client): Promise<HangarResponse> {
  const r = await call(ctx.app, client, 'GET', '/hangar?server=TR1');
  if (r.statusCode !== 200) throw new Error(r.body);
  return r.json().hangar;
}

async function shop(client: Client): Promise<ShopResponse> {
  return (await call(ctx.app, client, 'GET', '/shop?server=TR1')).json().shop;
}

const item = (h: HangarResponse, code: string): InventoryItem => {
  const i = h.inventory.find((x) => x.code === code);
  if (!i) throw new Error(`${code} envanterde yok`);
  return i;
};
const offerId = async (client: Client, code: string) => {
  const s = await shop(client);
  const o = s.categories.flatMap((c) => c.offers).find((x) => x.code === code);
  if (!o) throw new Error(`${code} mağazada yok`);
  return o.id;
};
const setBalance = (playerId: string, currency: string, amount: number) =>
  ctx.rt.db.query('UPDATE wallets SET balance = $3 WHERE player_id = $1 AND currency_code = $2', [playerId, currency, amount]);
const setLevel = (playerId: string, level: number) =>
  ctx.rt.db.query('UPDATE players SET experience = $2 WHERE id = $1', [playerId, xpForLevel(level)]);
const buy = (client: Client, offer: number, packs = 1, requestId = rid()) =>
  call(ctx.app, client, 'POST', '/shop/purchase', { serverCode: 'TR1', offerId: offer, packs, requestId });
const balance = (h: HangarResponse | ShopResponse, code: string) => h.currencies.find((c) => c.code === code)!.balance;

describe('başlangıç ekipmanı', () => {
  it('yeni pilot kitini alır ve iki konfigürasyona otomatik takılır', async () => {
    const { client } = await pilot('KitPilot');
    const h = await hangar(client);
    expect(h.ships).toHaveLength(1);
    const ship = h.ships[0]!;
    expect(ship).toMatchObject({ isActive: true, hitpoints: 4000, maxHitpoints: 4000 });
    expect(h.activeLoadout).toBe(1);
    expect(item(h, 'ammo.isk1').quantity).toBe(2000);
    expect(item(h, 'rocket.yildirim').quantity).toBe(50);
    const ok1 = item(h, 'laser.ok1');
    const siper = item(h, 'shield.siper1');
    const itki = item(h, 'speed.itki1');
    expect(ship.loadouts[1]).toEqual(expect.arrayContaining([
      { slotType: 'laser', slotIndex: 0, itemId: ok1.id },
      { slotType: 'generator', slotIndex: 0, itemId: siper.id },
    ]));
    expect(ship.loadouts[2]).toEqual(expect.arrayContaining([
      { slotType: 'laser', slotIndex: 0, itemId: ok1.id },
      { slotType: 'generator', slotIndex: 0, itemId: itki.id },
    ]));
    expect(ship.stats[1]).toMatchObject({ lasers: 1, damagePerVolley: 40, damagePerSecond: 40, laserRange: 600, shield: 1000, shieldAbsorb: 0.5, speed: 320 });
    expect(ship.stats[2]).toMatchObject({ lasers: 1, shield: 0, speed: 322 });
    const ledger = (await call(ctx.app, client, 'GET', '/hangar/ledger?server=TR1')).json().entries;
    expect(ledger.filter((e: { reason: string }) => e.reason === 'starter_kit')).toHaveLength(5);
  });

  it('Aşama 5\'te oluşturulmuş (kitsiz) pilot hangarı ilk açınca kitini bir kez alır', async () => {
    const { client, playerId } = await pilot('EskiPilot');
    await ctx.rt.db.query('DELETE FROM player_items WHERE player_id = $1', [playerId]);
    await ctx.rt.db.query('DELETE FROM item_ledger WHERE player_id = $1', [playerId]);
    await hangar(client);
    const h = await hangar(client);
    expect(h.inventory).toHaveLength(5);
    const { rows } = await ctx.rt.db.query(`SELECT count(*)::int AS n FROM item_ledger WHERE player_id = $1`, [playerId]);
    expect(rows[0].n).toBe(5);
  });
});

describe('ekipman takma kuralları (sunucu otoriteli)', () => {
  it('uyumsuz slot, olmayan slot ve yığın eşya reddedilir', async () => {
    const { client } = await pilot('SlotPilot');
    const h = await hangar(client);
    const ship = h.ships[0]!;
    const base = { serverCode: 'TR1', shipId: ship.id, loadout: 1 };
    let r = await call(ctx.app, client, 'POST', '/hangar/equip', { ...base, slotType: 'generator', slotIndex: 0, itemId: item(h, 'laser.ok1').id });
    expect(r.json().error.code).toBe('SLOT_INCOMPATIBLE');
    r = await call(ctx.app, client, 'POST', '/hangar/equip', { ...base, slotType: 'laser', slotIndex: 1, itemId: item(h, 'laser.ok1').id });
    expect(r.json().error.code).toBe('SLOT_UNAVAILABLE'); // Kırlangıç'ta tek lazer slotu var
    r = await call(ctx.app, client, 'POST', '/hangar/equip', { ...base, slotType: 'laser', slotIndex: 0, itemId: item(h, 'ammo.isk1').id });
    expect(r.json().error.code).toBe('SLOT_INCOMPATIBLE');
    r = await call(ctx.app, client, 'POST', '/hangar/equip', { ...base, slotType: 'drone_gear', slotIndex: 0, itemId: item(h, 'laser.ok1').id });
    expect(r.json().error.code).toBe('SLOT_UNAVAILABLE');
  });

  it('başka oyuncunun eşyası/gemisi kullanılamaz; seviye şartı uygulanır', async () => {
    const a = await pilot('PilotA1');
    const b = await pilot('PilotB1');
    const ha = await hangar(a.client);
    const hb = await hangar(b.client);
    let r = await call(ctx.app, a.client, 'POST', '/hangar/equip', {
      serverCode: 'TR1', shipId: ha.ships[0]!.id, loadout: 1, slotType: 'laser', slotIndex: 0, itemId: item(hb, 'laser.ok1').id,
    });
    expect(r.statusCode).toBe(404);
    r = await call(ctx.app, a.client, 'POST', '/hangar/equip', {
      serverCode: 'TR1', shipId: hb.ships[0]!.id, loadout: 1, slotType: 'laser', slotIndex: 0, itemId: item(ha, 'laser.ok1').id,
    });
    expect(r.json().error.code).toBe('SHIP_NOT_FOUND');
    // Seviye 12 isteyen OK-4'ü doğrudan envantere koy (ör. etkinlik ödülü) ve takmayı dene
    await ctx.rt.db.query(
      `INSERT INTO player_items (player_id, item_type_id, is_stack, source) SELECT $1, id, false, 'test' FROM item_types WHERE code = 'laser.ok4'`,
      [a.playerId],
    );
    const ok4 = item(await hangar(a.client), 'laser.ok4');
    r = await call(ctx.app, a.client, 'POST', '/hangar/equip', {
      serverCode: 'TR1', shipId: ha.ships[0]!.id, loadout: 1, slotType: 'laser', slotIndex: 0, itemId: ok4.id,
    });
    expect(r.json().error.code).toBe('LEVEL_TOO_LOW');
  });

  it('istemci gövdesine istatistik/fiyat ekleyemez; CSRF zorunlu; oturumsuz 401', async () => {
    const { client } = await pilot('GuvenliPilot');
    const h = await hangar(client);
    const body = { serverCode: 'TR1', shipId: h.ships[0]!.id, loadout: 1, slotType: 'laser', slotIndex: 0, itemId: item(h, 'laser.ok1').id };
    expect((await call(ctx.app, client, 'POST', '/hangar/equip', { ...body, damage: 99999 })).statusCode).toBe(400);
    expect((await call(ctx.app, { ...client, csrf: null }, 'POST', '/hangar/equip', body)).statusCode).toBe(403);
    expect((await call(ctx.app, newClient(), 'GET', '/hangar?server=TR1')).statusCode).toBe(401);
  });

  it('gemi değiştirme, konfigürasyon geçişi, iki gemide aynı eşya yasağı ve drone ekipmanı', async () => {
    const { client, playerId } = await pilot('FiloPilot');
    await setLevel(playerId, 6);
    await setBalance(playerId, 'KREDI', 1_000_000);
    expect((await buy(client, await offerId(client, 'atmaca'))).statusCode).toBe(200);
    expect((await buy(client, await offerId(client, 'drone.ari'), 2)).statusCode).toBe(200);
    let h = await hangar(client);
    const atmaca = h.ships.find((s) => s.type.code === 'atmaca')!;
    expect(atmaca).toMatchObject({ isActive: false, hitpoints: 64000, maxHitpoints: 64000 });

    // OK-1 Kırlangıç'ta takılı: Atmaca'ya takılamaz
    let r = await call(ctx.app, client, 'POST', '/hangar/equip', {
      serverCode: 'TR1', shipId: atmaca.id, loadout: 1, slotType: 'laser', slotIndex: 0, itemId: item(h, 'laser.ok1').id,
    });
    expect(r.json().error.code).toBe('ITEM_ON_OTHER_SHIP');

    // Atmaca'yı aktif yap, konfigürasyon 2'ye geç
    h = (await call(ctx.app, client, 'POST', `/hangar/ships/${atmaca.id}/activate`, { serverCode: 'TR1' })).json().hangar;
    expect(h.activeShipId).toBe(atmaca.id);
    h = (await call(ctx.app, client, 'POST', '/hangar/loadout', { serverCode: 'TR1', loadout: 2 })).json().hangar;
    expect(h.activeLoadout).toBe(2);
    const profile = (await call(ctx.app, client, 'GET', '/players/me')).json().pilots[0];
    expect(profile.activeShip.name).toBe('Atmaca');

    // Drone tak → OK-1'i Kırlangıç'tan çıkar → drone ekipmanı olarak tak
    const drones = h.inventory.filter((i) => i.code === 'drone.ari');
    h = (await call(ctx.app, client, 'POST', '/hangar/equip', { serverCode: 'TR1', shipId: atmaca.id, loadout: 1, slotType: 'drone', slotIndex: 0, itemId: drones[0]!.id })).json().hangar;
    const kirlangic = h.ships.find((s) => s.type.code === 'kirlangic')!;
    for (const lo of [1, 2]) {
      await call(ctx.app, client, 'POST', '/hangar/unequip', { serverCode: 'TR1', shipId: kirlangic.id, loadout: lo, slotType: 'laser', slotIndex: 0 });
    }
    r = await call(ctx.app, client, 'POST', '/hangar/equip', { serverCode: 'TR1', shipId: atmaca.id, loadout: 1, slotType: 'drone_gear', slotIndex: 0, itemId: item(h, 'laser.ok1').id });
    expect(r.statusCode).toBe(200);
    h = r.json().hangar;
    expect(h.ships.find((s) => s.id === atmaca.id)!.stats[1]).toMatchObject({ drones: 1, lasers: 1, damagePerVolley: 40 });
    // Drone çıkarılınca ekipmanı da düşer
    h = (await call(ctx.app, client, 'POST', '/hangar/unequip', { serverCode: 'TR1', shipId: atmaca.id, loadout: 1, slotType: 'drone', slotIndex: 0 })).json().hangar;
    expect(h.ships.find((s) => s.id === atmaca.id)!.loadouts[1]).toEqual([]);
  });

  it('aynı eşya aynı konfigürasyonda başka slota takılırsa taşınır (iki slotta olmaz)', async () => {
    const { client, playerId } = await pilot('TasimaPilot');
    await setLevel(playerId, 3);
    await setBalance(playerId, 'KREDI', 100_000);
    await buy(client, await offerId(client, 'dogan'));
    let h = await hangar(client);
    const dogan = h.ships.find((s) => s.type.code === 'dogan')!;
    await buy(client, await offerId(client, 'shield.siper1'));
    h = await hangar(client);
    const extraShield = h.inventory.find((i) => i.code === 'shield.siper1' && i.equippedIn.length === 0)!;
    const eq = (slotIndex: number) =>
      call(ctx.app, client, 'POST', '/hangar/equip', { serverCode: 'TR1', shipId: dogan.id, loadout: 1, slotType: 'generator', slotIndex, itemId: extraShield.id });
    await eq(0);
    h = (await eq(2)).json().hangar;
    const slots = h.ships.find((s) => s.id === dogan.id)!.loadouts[1];
    expect(slots).toEqual([{ slotType: 'generator', slotIndex: 2, itemId: extraShield.id }]);
  });
});

describe('mağaza', () => {
  it('kategoriler ve teklifler listelenir; fiyatlar sunucudan gelir', async () => {
    const { client } = await pilot('VitrinPilot');
    const s = await shop(client);
    expect(s.categories.map((c) => c.code)).toEqual(['gemiler', 'lazerler', 'mermiler', 'roketler', 'jeneratorler', 'ekstralar', 'droneler', 'pet', 'tasarimlar']);
    const ships = s.categories[0]!.offers;
    expect(ships).toHaveLength(9);
    expect(ships[0]).toMatchObject({ code: 'dogan', currency: 'KREDI', finalPrice: 40000, minLevel: 3, owned: false });
    expect(ships[0]!.ship).toMatchObject({ hitpoints: 16000, slots: { laser: 3, generator: 3, extra: 1, drone: 1 } });
  });

  it('satın alma: para defterden düşer, eşya deftere girer; aynı requestId ikinci kez uygulanmaz', async () => {
    const { client, playerId } = await pilot('AlisverisPilot');
    const id = await offerId(client, 'laser.ok1');
    const requestId = rid();
    const r1 = await buy(client, id, 1, requestId);
    expect(r1.statusCode).toBe(200);
    expect(r1.json().purchase).toMatchObject({ total: 10000, currency: 'KREDI', replay: false });
    const r2 = await buy(client, id, 1, requestId);
    expect(r2.json().purchase.replay).toBe(true);
    const h = await hangar(client);
    expect(balance(h, 'KREDI')).toBe(15000);
    expect(h.inventory.filter((i) => i.code === 'laser.ok1')).toHaveLength(2);
    const { rows } = await ctx.rt.db.query(`SELECT count(*)::int AS n FROM shop_purchases WHERE player_id = $1`, [playerId]);
    expect(rows[0].n).toBe(1);
  });

  it('yığın eşya paketleri tek satırda birikir; yetersiz bakiyede hiçbir şey verilmez', async () => {
    const { client } = await pilot('MermiPilot');
    expect((await buy(client, await offerId(client, 'ammo.isk1'), 2)).statusCode).toBe(200);
    let h = await hangar(client);
    expect(h.inventory.filter((i) => i.code === 'ammo.isk1')).toHaveLength(1);
    expect(item(h, 'ammo.isk1').quantity).toBe(4000);
    expect(balance(h, 'KREDI')).toBe(5000);
    const r = await buy(client, await offerId(client, 'laser.ok1'));
    expect(r.json().error.code).toBe('INSUFFICIENT_FUNDS');
    h = await hangar(client);
    expect(h.inventory.filter((i) => i.code === 'laser.ok1')).toHaveLength(1);
  });

  it('gemi: seviye şartı, satın alma ve ikinci kez alınamaması', async () => {
    const { client, playerId } = await pilot('GemiciPilot');
    await setBalance(playerId, 'KREDI', 500_000);
    const id = await offerId(client, 'dogan');
    expect((await buy(client, id)).json().error.code).toBe('LEVEL_TOO_LOW');
    await setLevel(playerId, 3);
    expect((await buy(client, id)).statusCode).toBe(200);
    expect((await buy(client, id)).json().error.code).toBe('SHIP_OWNED');
    const s = await shop(client);
    expect(s.categories[0]!.offers.find((o) => o.code === 'dogan')!.owned).toBe(true);
  });

  it('eşzamanlı 5 satın almadan yalnızca bakiyenin karşıladığı 2 tanesi gerçekleşir', async () => {
    const { client, playerId } = await pilot('YarisAlici');
    await setBalance(playerId, 'KREDI', 20_000);
    const id = await offerId(client, 'laser.ok1');
    const res = await Promise.all(Array.from({ length: 5 }, () => buy(client, id)));
    expect(res.filter((r) => r.statusCode === 200)).toHaveLength(2);
    expect(res.filter((r) => r.statusCode === 400 && r.json().error.code === 'INSUFFICIENT_FUNDS')).toHaveLength(3);
    const h = await hangar(client);
    expect(balance(h, 'KREDI')).toBe(0);
    expect(h.inventory.filter((i) => i.code === 'laser.ok1')).toHaveLength(3);
  });

  it('PET: satın alınca PET oluşur, ikincisi alınamaz; modül ve isim yönetimi', async () => {
    const { client, playerId } = await pilot('PetPilot');
    await setLevel(playerId, 5);
    await setBalance(playerId, 'AKCE', 30_000);
    let r = await call(ctx.app, client, 'POST', '/hangar/pet/modules', { serverCode: 'TR1', slotIndex: 0, itemId: null });
    expect(r.json().error.code).toBe('PET_REQUIRED');
    expect((await buy(client, await offerId(client, 'pet.yoldas'))).statusCode).toBe(200);
    expect((await buy(client, await offerId(client, 'pet.yoldas'))).statusCode).toBe(409);
    expect((await buy(client, await offerId(client, 'petmod.toplayici'))).statusCode).toBe(200);
    let h = await hangar(client);
    expect(h.pet).toMatchObject({ name: 'Yoldaş', moduleSlots: 2, modules: [] });
    const mod = item(h, 'petmod.toplayici');
    r = await call(ctx.app, client, 'POST', '/hangar/pet/modules', { serverCode: 'TR1', slotIndex: 2, itemId: mod.id });
    expect(r.json().error.code).toBe('SLOT_UNAVAILABLE');
    r = await call(ctx.app, client, 'POST', '/hangar/pet/modules', { serverCode: 'TR1', slotIndex: 0, itemId: item(h, 'laser.ok1').id });
    expect(r.json().error.code).toBe('SLOT_INCOMPATIBLE');
    h = (await call(ctx.app, client, 'POST', '/hangar/pet/modules', { serverCode: 'TR1', slotIndex: 1, itemId: mod.id })).json().hangar;
    expect(h.pet!.modules).toEqual([{ slotIndex: 1, itemId: mod.id }]);
    h = (await call(ctx.app, client, 'POST', '/hangar/pet/name', { serverCode: 'TR1', name: 'Karabaş' })).json().hangar;
    expect(h.pet!.name).toBe('Karabaş');
    expect((await call(ctx.app, client, 'POST', '/hangar/pet/name', { serverCode: 'TR1', name: '<script>' })).statusCode).toBe(400);
  });

  it('envanter sınırı ve indirim uygulanır', async () => {
    const { client } = await pilot('SinirPilot');
    await ctx.rt.db.query(`UPDATE game_settings SET value = '{"max_items": 5}' WHERE key = 'inventory'`);
    expect((await buy(client, await offerId(client, 'speed.itki1'))).json().error.code).toBe('INVENTORY_FULL');
    await ctx.rt.db.query(`UPDATE game_settings SET value = '{"max_items": 300}' WHERE key = 'inventory'`);
    await ctx.rt.db.query(`UPDATE shop_offers SET discount_percent = 50 WHERE item_type_id = (SELECT id FROM item_types WHERE code = 'speed.itki1')`);
    const s = await shop(client);
    const offer = s.categories.flatMap((c) => c.offers).find((o) => o.code === 'speed.itki1')!;
    expect(offer).toMatchObject({ price: 5000, finalPrice: 2500, discountPercent: 50 });
    const r = await buy(client, offer.id);
    expect(r.json().purchase.total).toBe(2500);
  });
});

describe('satış, yükseltme, tamir ve tasarım', () => {
  it('takılı eşya satılamaz; çıkarınca satılır; yığından kısmi satış; satılamaz eşya', async () => {
    const { client } = await pilot('SaticiPilot');
    let h = await hangar(client);
    const ok1 = item(h, 'laser.ok1');
    let r = await call(ctx.app, client, 'POST', `/hangar/items/${ok1.id}/sell`, { serverCode: 'TR1', requestId: rid() });
    expect(r.json().error.code).toBe('ITEM_IN_USE');
    for (const lo of [1, 2]) {
      await call(ctx.app, client, 'POST', '/hangar/unequip', { serverCode: 'TR1', shipId: h.ships[0]!.id, loadout: lo, slotType: 'laser', slotIndex: 0 });
    }
    const requestId = rid();
    r = await call(ctx.app, client, 'POST', `/hangar/items/${ok1.id}/sell`, { serverCode: 'TR1', requestId });
    expect(r.json().result).toMatchObject({ sold: 1, earned: 2500 });
    expect(balance(r.json().hangar, 'KREDI')).toBe(27500);
    // aynı istek tekrarı ikinci kez para vermez
    r = await call(ctx.app, client, 'POST', `/hangar/items/${ok1.id}/sell`, { serverCode: 'TR1', requestId });
    expect(r.json().result.replay).toBe(true);
    expect(balance(r.json().hangar, 'KREDI')).toBe(27500);

    h = r.json().hangar;
    const ammo = item(h, 'ammo.isk1');
    r = await call(ctx.app, client, 'POST', `/hangar/items/${ammo.id}/sell`, { serverCode: 'TR1', quantity: 500, requestId: rid() });
    expect(item(r.json().hangar, 'ammo.isk1').quantity).toBe(1500);
    r = await call(ctx.app, client, 'POST', `/hangar/items/${ammo.id}/sell`, { serverCode: 'TR1', quantity: 99999, requestId: rid() });
    expect(r.statusCode).toBe(400);

    await ctx.rt.db.query(`UPDATE item_types SET sell_price = 0 WHERE code = 'rocket.yildirim'`);
    const rockets = item(r.json().hangar ?? h, 'rocket.yildirim');
    r = await call(ctx.app, client, 'POST', `/hangar/items/${rockets.id}/sell`, { serverCode: 'TR1', requestId: rid() });
    expect(r.json().error.code).toBe('NOT_SELLABLE');
  });

  it('yükseltme: sunucu zarına göre başarı/başarısızlık, ücret, çarpanın istatistiğe yansıması, üst sınır', async () => {
    const { client, playerId } = await pilot('UstaPilot');
    await setBalance(playerId, 'KREDI', 1_000_000);
    let h = await hangar(client);
    const ok1 = item(h, 'laser.ok1');
    expect(ok1.nextUpgrade).toEqual({ level: 1, chance: 1, currency: 'KREDI', amount: 2000 });

    nextRoll = 0;
    let r = await call(ctx.app, client, 'POST', `/hangar/items/${ok1.id}/upgrade`, { serverCode: 'TR1', requestId: rid() });
    expect(r.json().result).toMatchObject({ success: true, fromLevel: 0, toLevel: 1 });
    h = r.json().hangar;
    expect(item(h, 'laser.ok1').upgradeLevel).toBe(1);
    expect(h.ships[0]!.stats[1].damagePerVolley).toBe(41); // 40 × 1.02

    nextRoll = 999_999; // seviye 2 şansı %95 → bu zarla başarısız
    const failReq = rid();
    r = await call(ctx.app, client, 'POST', `/hangar/items/${ok1.id}/upgrade`, { serverCode: 'TR1', requestId: failReq });
    expect(r.json().result).toMatchObject({ success: false, fromLevel: 1, toLevel: 1, chance: 0.95 });
    expect(balance(r.json().hangar, 'KREDI')).toBe(1_000_000 - 2000 - 5000);
    // aynı istek tekrarlanırsa yeniden zar atılmaz, ücret alınmaz
    nextRoll = 0;
    r = await call(ctx.app, client, 'POST', `/hangar/items/${ok1.id}/upgrade`, { serverCode: 'TR1', requestId: failReq });
    expect(r.json().result).toMatchObject({ success: false, replay: true });
    expect(balance(r.json().hangar, 'KREDI')).toBe(1_000_000 - 7000);

    const { rows } = await ctx.rt.db.query('SELECT success, roll FROM item_upgrade_log WHERE player_id = $1 ORDER BY id', [playerId]);
    expect(rows).toEqual([{ success: true, roll: 0 }, { success: false, roll: 999999 }]);

    await ctx.rt.db.query(`UPDATE player_items SET upgrade_level = 10 WHERE id = $1`, [ok1.id]);
    r = await call(ctx.app, client, 'POST', `/hangar/items/${ok1.id}/upgrade`, { serverCode: 'TR1', requestId: rid() });
    expect(r.json().error.code).toBe('MAX_UPGRADE');
    const ammo = item(h, 'ammo.isk1');
    r = await call(ctx.app, client, 'POST', `/hangar/items/${ammo.id}/upgrade`, { serverCode: 'TR1', requestId: rid() });
    expect(r.json().error.code).toBe('NOT_UPGRADABLE');
  });

  it('tamir: hasar maliyeti, onarım ve hasarsız gemi', async () => {
    const { client } = await pilot('TamirPilot');
    let h = await hangar(client);
    await ctx.rt.db.query('UPDATE player_ships SET hitpoints = 1000 WHERE id = $1', [h.ships[0]!.id]);
    h = await hangar(client);
    expect(h.ships[0]!.repairCost).toEqual({ currency: 'KREDI', amount: 750 }); // 3000 HP × 250/1000
    const r = await call(ctx.app, client, 'POST', `/hangar/ships/${h.ships[0]!.id}/repair`, { serverCode: 'TR1', requestId: rid() });
    expect(r.json().result).toEqual({ repaired: 3000, cost: 750 });
    expect(r.json().hangar.ships[0].hitpoints).toBe(4000);
    expect(balance(r.json().hangar, 'KREDI')).toBe(24250);
    const again = await call(ctx.app, client, 'POST', `/hangar/ships/${h.ships[0]!.id}/repair`, { serverCode: 'TR1', requestId: rid() });
    expect(again.json().error.code).toBe('SHIP_NOT_DAMAGED');
  });

  it('tasarım yalnızca uygun gemiye uygulanır; profil ve hangar görünümü değişir', async () => {
    const { client } = await pilot('TasarimPilot');
    expect((await buy(client, await offerId(client, 'design.kirlangic-gece'))).statusCode).toBe(200);
    let h = await hangar(client);
    const design = item(h, 'design.kirlangic-gece');
    h = (await call(ctx.app, client, 'POST', `/hangar/ships/${h.ships[0]!.id}/design`, { serverCode: 'TR1', itemId: design.id })).json().hangar;
    expect(h.ships[0]).toMatchObject({ spriteKey: 'ship-kirlangic-gece', design: { name: 'Gece Kırlangıcı' } });
    const profile = (await call(ctx.app, client, 'GET', '/players/me')).json().pilots[0];
    expect(profile.activeShip.spriteKey).toBe('ship-kirlangic-gece');
    const r = await call(ctx.app, client, 'POST', `/hangar/items/${design.id}/sell`, { serverCode: 'TR1', requestId: rid() });
    expect(r.json().error.code).toBe('NOT_SELLABLE');
  });
});

describe('Yönetim Merkezi değişiklikleri gerçek sisteme yansır', () => {
  it('eşya istatistiği, gemi canı ve mağaza fiyatı değişince hangar/mağaza/profil anında güncellenir', async () => {
    const { client } = await pilot('YansimaPilot');
    await ctx.rt.db.query(`UPDATE item_types SET stats = '{"damage": 80, "rateMs": 500, "range": 600}' WHERE code = 'laser.ok1'`);
    await ctx.rt.db.query(`UPDATE ship_types SET hitpoints = 5000 WHERE code = 'kirlangic'`);
    await ctx.rt.db.query(`UPDATE shop_offers SET price = 7777 WHERE item_type_id = (SELECT id FROM item_types WHERE code = 'laser.ok1')`);
    const h = await hangar(client);
    expect(h.ships[0]!.stats[1]).toMatchObject({ damagePerVolley: 80, damagePerSecond: 160, hitpoints: 5000 });
    expect(h.ships[0]!.maxHitpoints).toBe(5000);
    const offer = (await shop(client)).categories.flatMap((c) => c.offers).find((o) => o.code === 'laser.ok1')!;
    expect(offer.finalPrice).toBe(7777);
    expect((await buy(client, offer.id)).json().purchase.total).toBe(7777);
    const profile = (await call(ctx.app, client, 'GET', '/players/me')).json().pilots[0];
    expect(profile.activeShip.maxHitpoints).toBe(5000);
  });

  it('satıştan kaldırılan ürün alınamaz; bozuk istatistik sessizce kullanılmaz', async () => {
    const { client } = await pilot('KapaliPilot');
    const id = await offerId(client, 'laser.ok1');
    await ctx.rt.db.query('UPDATE shop_offers SET is_active = false WHERE id = $1', [id]);
    expect((await buy(client, id)).json().error.code).toBe('OFFER_UNAVAILABLE');
    await ctx.rt.db.query(`UPDATE item_types SET stats = '{"damage": -1}' WHERE code = 'laser.ok1'`);
    const r = await call(ctx.app, client, 'GET', '/hangar?server=TR1');
    expect(r.statusCode).toBe(500);
  });
});
