import { defaultSettings, xpForLevel, type GalaxyResponse, type MapResponse } from '@turkorbit/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { call, createTestContext, newClient, registerAndLogin, resetDatabase, type Client, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => ctx.close());
beforeEach(async () => {
  await resetDatabase(ctx.rt);
});

async function pilot(username: string, company = 'KZL') {
  const { client } = await registerAndLogin(ctx, username, { client: newClient({ ip: `85.106.${Math.floor(Math.random() * 200)}.1` }) });
  const r = await call(ctx.app, client, 'POST', '/players', { serverCode: 'TR1', companyCode: company });
  if (r.statusCode !== 201) throw new Error(r.body);
  return { client, playerId: r.json().pilot.id as string };
}
const getMap = async (c: Client): Promise<MapResponse> => (await call(ctx.app, c, 'GET', '/world/map?server=TR1')).json().map;
/** Testte zamanı geri alarak "şu kadar saniye önce buradaydı" durumu kurar. */
const placeAt = (playerId: string, x: number, y: number, secondsAgo = 5, mapCode?: string) =>
  ctx.rt.db.query(
    `UPDATE players SET pos_x = $2, pos_y = $3, pos_updated_at = now() - make_interval(secs => $4)
       ${mapCode ? `, map_id = (SELECT id FROM maps WHERE code = '${mapCode}')` : ''} WHERE id = $1`,
    [playerId, x, y, secondsAgo],
  );
const setLevel = (playerId: string, level: number) =>
  ctx.rt.db.query('UPDATE players SET experience = $2 WHERE id = $1', [playerId, xpForLevel(level)]);

describe('galaksi ve harita verisi', () => {
  it('21 harita, 30 bağlantı; her haritadan diğer tüm haritalara ulaşılabilir', async () => {
    const { client } = await pilot('GalaksiPilot');
    const g: GalaxyResponse = (await call(ctx.app, client, 'GET', '/world/galaxy?server=TR1')).json().galaxy;
    expect(g.maps).toHaveLength(21);
    expect(g.links).toHaveLength(30);
    expect(g.currentMap).toBe('K-1');
    const adj = new Map<string, string[]>();
    for (const [a, b] of g.links) {
      adj.set(a, [...(adj.get(a) ?? []), b]);
      adj.set(b, [...(adj.get(b) ?? []), a]);
    }
    const seen = new Set(['K-1']);
    const queue = ['K-1'];
    while (queue.length) for (const n of adj.get(queue.shift()!) ?? []) if (!seen.has(n)) (seen.add(n), queue.push(n));
    expect(seen.size).toBe(21);
    // Seviye 1 Kızılelma pilotu: kendi K-2 açık, düşman G-1 ve sınır S-1 kilitli
    const access = Object.fromEntries(g.maps.map((m) => [m.code, m.access.ok]));
    expect(access).toMatchObject({ 'K-1': true, 'K-2': true, 'K-3': false, 'G-1': false, 'S-1': false, 'Ç-1': false });
  });

  it('bulunulan harita: boyut, portallar (hedef ve erişim), istasyon/güvenli/kaynak bölgeleri, gemi hızı', async () => {
    const { client } = await pilot('HaritaPilot', 'GKB');
    const m = await getMap(client);
    expect(m.map).toMatchObject({ code: 'G-1', width: 20000, height: 12500, pvpEnabled: false });
    expect(m.position).toEqual({ x: 18200, y: 1800 });
    expect(m.portals.map((p) => p.target.code).sort()).toEqual(['G-2', 'G-4']);
    expect(m.portals.find((p) => p.target.code === 'G-2')!.access.ok).toBe(true);
    expect(m.portals.find((p) => p.target.code === 'G-4')!.access).toMatchObject({ ok: false, code: 'MAP_LOCKED', requiredLevel: 5 });
    expect(m.zones.map((z) => z.zoneType).sort()).toEqual(['resource', 'safe', 'station']);
    expect(m.pilot.ship).toMatchObject({ name: 'Kırlangıç', speed: 320, shield: 1000 });
    expect(m.rules).toMatchObject({ jumpRadius: 450, detection: { radar: 1500, cargo: 600 } });
  });
});

describe('konum doğrulaması (sunucu tarafı hız denetimi)', () => {
  it('gemi hızına uygun hareket kabul edilir', async () => {
    const { client, playerId } = await pilot('HizliPilot');
    await placeAt(playerId, 5000, 5000, 2);
    const r = await call(ctx.app, client, 'POST', '/world/position', { serverCode: 'TR1', x: 5600, y: 5000 });
    expect(r.json()).toEqual({ accepted: true, x: 5600, y: 5000, reason: null });
  });

  it('ışınlanma (hız hilesi) reddedilir, sunucu konumu döner ve kaydedilir', async () => {
    const { client, playerId } = await pilot('IsinlananPilot');
    await placeAt(playerId, 5000, 5000, 2);
    const r = await call(ctx.app, client, 'POST', '/world/position', { serverCode: 'TR1', x: 15000, y: 9000 });
    expect(r.json()).toEqual({ accepted: false, x: 5000, y: 5000, reason: 'too_fast' });
    const { rows } = await ctx.rt.db.query('SELECT count(*)::int AS n FROM position_rejections WHERE player_id = $1', [playerId]);
    expect(rows[0].n).toBe(1);
  });

  it('hız jeneratörü (aktif konfigürasyon) izin verilen mesafeyi artırır', async () => {
    const { client, playerId } = await pilot('ItkiPilot');
    // Süre 1 sn ile sınırlanır, pay ve tolerans yok → izin verilen mesafe tam olarak gemi hızıdır (istek gecikmesinden bağımsız).
    await ctx.rt.db.query(`UPDATE game_settings SET value = '{"tolerance": 1, "slack": 0, "max_elapsed_seconds": 1}' WHERE key = 'movement'`);
    await placeAt(playerId, 5000, 5000, 5);
    // K1 (Siper-1): hız 320
    expect((await call(ctx.app, client, 'POST', '/world/position', { serverCode: 'TR1', x: 5321, y: 5000 })).json().accepted).toBe(false);
    // K2 (İtki-1): hız 322
    await call(ctx.app, client, 'POST', '/hangar/loadout', { serverCode: 'TR1', loadout: 2 });
    await placeAt(playerId, 5000, 5000, 5);
    expect((await call(ctx.app, client, 'POST', '/world/position', { serverCode: 'TR1', x: 5321, y: 5000 })).json().accepted).toBe(true);
  });

  it('harita dışı konum ve çok sık güncelleme reddedilir; istemci alan ekleyemez', async () => {
    const { client, playerId } = await pilot('SinirPilot');
    await placeAt(playerId, 100, 100, 2);
    expect((await call(ctx.app, client, 'POST', '/world/position', { serverCode: 'TR1', x: -50, y: 100 })).json().reason).toBe('out_of_bounds');
    await placeAt(playerId, 100, 100, 0);
    expect((await call(ctx.app, client, 'POST', '/world/position', { serverCode: 'TR1', x: 110, y: 100 })).statusCode).toBe(429);
    expect((await call(ctx.app, client, 'POST', '/world/position', { serverCode: 'TR1', x: 1, y: 1, speed: 99999 })).statusCode).toBe(400);
  });
});

describe('portal geçişi', () => {
  it('geçide yakınken atlar; yeni haritada varış noktasında başlar ve geçiş kaydedilir', async () => {
    const { client, playerId } = await pilot('GecitPilot');
    const m = await getMap(client);
    const portal = m.portals.find((p) => p.target.code === 'K-2')!;
    await placeAt(playerId, portal.x - 200, portal.y, 3);
    const r = await call(ctx.app, client, 'POST', '/world/jump', { serverCode: 'TR1', portalId: portal.id, x: portal.x - 100, y: portal.y });
    expect(r.statusCode).toBe(200);
    const nm: MapResponse = r.json().map;
    expect(nm.map.code).toBe('K-2');
    const back = nm.portals.find((p) => p.target.code === 'K-1')!;
    expect(Math.hypot(nm.position.x - back.x, nm.position.y - back.y)).toBeCloseTo(700, -1); // geçidin hemen yanında
    expect((await getMap(client)).map.code).toBe('K-2');
    const profile = (await call(ctx.app, client, 'GET', '/players/me')).json().pilots[0];
    expect(profile.map.code).toBe('K-2');
    const { rows } = await ctx.rt.db.query(`SELECT reason FROM map_transitions WHERE player_id = $1`, [playerId]);
    expect(rows).toEqual([{ reason: 'portal' }]);
  });

  it('uzaktan atlama, başka haritanın geçidi ve doğrulanamayan konum reddedilir', async () => {
    const { client, playerId } = await pilot('UzakPilot');
    const m = await getMap(client);
    const portal = m.portals.find((p) => p.target.code === 'K-2')!;
    await placeAt(playerId, portal.x - 1000, portal.y, 3);
    let r = await call(ctx.app, client, 'POST', '/world/jump', { serverCode: 'TR1', portalId: portal.id, x: portal.x - 1000, y: portal.y });
    expect(r.json().error.code).toBe('TOO_FAR_FROM_PORTAL');
    // Konumunu geçidin yanı gibi göstermeye çalışan istemci (hız hilesi) de reddedilir
    await placeAt(playerId, 3000, 3000, 1);
    r = await call(ctx.app, client, 'POST', '/world/jump', { serverCode: 'TR1', portalId: portal.id, x: portal.x, y: portal.y });
    expect(r.json().error.code).toBe('TOO_FAR_FROM_PORTAL');
    const other = (await ctx.rt.db.query(`SELECT id FROM map_portals WHERE map_id = (SELECT id FROM maps WHERE code = 'G-1') LIMIT 1`)).rows[0].id;
    r = await call(ctx.app, client, 'POST', '/world/jump', { serverCode: 'TR1', portalId: other, x: 1, y: 1 });
    expect(r.json().error.code).toBe('PORTAL_NOT_FOUND');
  });

  it('seviye ve düşman şirket kuralları sunucuda uygulanır', async () => {
    const { client, playerId } = await pilot('KuralPilot');
    let m = await getMap(client);
    const toK3 = m.portals.find((p) => p.target.code === 'K-3')!;
    await placeAt(playerId, toK3.x, toK3.y, 3);
    let r = await call(ctx.app, client, 'POST', '/world/jump', { serverCode: 'TR1', portalId: toK3.id, x: toK3.x, y: toK3.y });
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toMatchObject({ code: 'MAP_LOCKED', message: 'Bu haritaya girmek için en az seviye 5 olmalısın.' });
    await setLevel(playerId, 5);
    r = await call(ctx.app, client, 'POST', '/world/jump', { serverCode: 'TR1', portalId: toK3.id, x: toK3.x, y: toK3.y });
    expect(r.json().map.map.code).toBe('K-3');

    // Kızılelma pilotu, Gökbörü bölgesi G-4'e seviye 14'te giremez, 15'te girer
    await setLevel(playerId, 14);
    await placeAt(playerId, 10000, 6250, 3, 'S-2');
    m = await getMap(client);
    const toG4 = m.portals.find((p) => p.target.code === 'G-4')!;
    await placeAt(playerId, toG4.x, toG4.y, 3);
    r = await call(ctx.app, client, 'POST', '/world/jump', { serverCode: 'TR1', portalId: toG4.id, x: toG4.x, y: toG4.y });
    expect(r.json().error.message).toContain('Düşman şirket bölgesine');
    await setLevel(playerId, 15);
    r = await call(ctx.app, client, 'POST', '/world/jump', { serverCode: 'TR1', portalId: toG4.id, x: toG4.x, y: toG4.y });
    expect(r.json().map.map.code).toBe('G-4');
  });
});

describe('Yönetim Merkezi harita ayarları canlı etkili', () => {
  it('kapatılan haritaya geçilemez; içindeki pilot başlangıç haritasına taşınır', async () => {
    const { client, playerId } = await pilot('BakimPilot');
    const m = await getMap(client);
    const toK2 = m.portals.find((p) => p.target.code === 'K-2')!;
    await ctx.rt.db.query(`UPDATE maps SET is_closed = true WHERE code = 'K-2'`);
    await placeAt(playerId, toK2.x, toK2.y, 3);
    const r = await call(ctx.app, client, 'POST', '/world/jump', { serverCode: 'TR1', portalId: toK2.id, x: toK2.x, y: toK2.y });
    expect(r.json().error.code).toBe('MAP_CLOSED');

    await ctx.rt.db.query(`UPDATE maps SET is_closed = false WHERE code = 'K-2'`);
    await call(ctx.app, client, 'POST', '/world/jump', { serverCode: 'TR1', portalId: toK2.id, x: toK2.x, y: toK2.y });
    await ctx.rt.db.query(`UPDATE maps SET is_closed = true WHERE code = 'K-2'`);
    const moved = await getMap(client);
    expect(moved.map.code).toBe('K-1');
    expect(moved.notice).toContain('bakım nedeniyle kapatıldı');
    const { rows } = await ctx.rt.db.query(`SELECT reason FROM map_transitions WHERE player_id = $1 ORDER BY id`, [playerId]);
    expect(rows.map((x) => x.reason)).toEqual(['portal', 'map_closed']);
  });

  it('devre dışı bırakılan geçit listelenmez ve kullanılamaz', async () => {
    const { client, playerId } = await pilot('KapaliGecit');
    const m = await getMap(client);
    const toK2 = m.portals.find((p) => p.target.code === 'K-2')!;
    await ctx.rt.db.query('UPDATE map_portals SET is_enabled = false WHERE id = $1', [toK2.id]);
    expect((await getMap(client)).portals.find((p) => p.id === toK2.id)).toBeUndefined();
    await placeAt(playerId, toK2.x, toK2.y, 3);
    const r = await call(ctx.app, client, 'POST', '/world/jump', { serverCode: 'TR1', portalId: toK2.id, x: toK2.x, y: toK2.y });
    expect(r.json().error.code).toBe('PORTAL_NOT_FOUND');
    await ctx.rt.db.query('UPDATE map_portals SET is_enabled = true WHERE id = $1', [toK2.id]);
  });
});

describe('oyuncu ayarları (cihaz sınıfına göre senkron)', () => {
  it('varsayılanlar döner; kaydedilen ayar aynı sınıftaki diğer cihazda görünür, diğer sınıfı etkilemez', async () => {
    const { client } = await pilot('AyarPilot');
    let r = await call(ctx.app, client, 'GET', '/settings?deviceClass=phone');
    expect(r.json()).toMatchObject({ deviceClass: 'phone', saved: false });
    const s = defaultSettings('phone');
    s.controls.joystickSide = 'right';
    s.controls.joystickSize = 1.3;
    s.graphics.quality = 'low';
    r = await call(ctx.app, client, 'PUT', '/settings', { deviceClass: 'phone', settings: s });
    expect(r.statusCode).toBe(200);
    const other = newClient({ bearer: undefined });
    const login = await call(ctx.app, other, 'POST', '/auth/login', { identifier: 'AyarPilot', password: 'Nebula-Kartal-77', transport: 'token', device: { platform: 'android' } });
    const phone = newClient({ bearer: login.json().sessionToken });
    const got = (await call(ctx.app, phone, 'GET', '/settings?deviceClass=phone')).json();
    expect(got.settings.controls).toMatchObject({ joystickSide: 'right', joystickSize: 1.3 });
    expect(got.saved).toBe(true);
    expect((await call(ctx.app, phone, 'GET', '/settings?deviceClass=desktop')).json().settings.graphics.quality).toBe('high');
  });

  it('geçersiz ayar reddedilir; PUT CSRF ister', async () => {
    const { client } = await pilot('AyarHata');
    const s = defaultSettings('desktop');
    expect((await call(ctx.app, client, 'PUT', '/settings', { deviceClass: 'desktop', settings: { ...s, hud: { ...s.hud, scale: 9 } } })).statusCode).toBe(400);
    expect((await call(ctx.app, { ...client, csrf: null }, 'PUT', '/settings', { deviceClass: 'desktop', settings: s })).statusCode).toBe(403);
  });
});
