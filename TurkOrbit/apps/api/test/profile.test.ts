import { xpForLevel } from '@turkorbit/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  call,
  createTestContext,
  newClient,
  registerAndLogin,
  resetDatabase,
  STRONG_PASSWORD,
  type Client,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => ctx.close());
beforeEach(async () => {
  await resetDatabase(ctx.rt);
  ctx.mailer.clear();
});

async function pilot(username: string, company = 'GKB', client?: Client) {
  const r = await registerAndLogin(ctx, username, client ? { client } : {});
  const res = await call(ctx.app, r.client, 'POST', '/players', { serverCode: 'TR1', companyCode: company });
  if (res.statusCode !== 201) throw new Error(`pilot oluşturulamadı: ${res.body}`);
  return { ...r, pilot: res.json().pilot };
}

describe('sunucu ve şirket listeleri', () => {
  it('sunucular ve şirketler herkese açık listelenir', async () => {
    const s = await call(ctx.app, newClient(), 'GET', '/game/servers');
    expect(s.statusCode).toBe(200);
    expect(s.json().servers).toEqual([
      expect.objectContaining({ code: 'TR1', name: 'Anadolu-1', isOpen: true, hasMyPilot: false, pilotCount: 0 }),
    ]);
    const c = await call(ctx.app, newClient(), 'GET', '/game/companies?server=TR1');
    expect(c.json().companies.map((x: { code: string }) => x.code)).toEqual(['KZL', 'GKB', 'ALT']);
    expect(c.json().companies[0].homeMap).toEqual({ code: 'K-1', name: 'Kızılelma Limanı' });
  });

  it('oturum açmış oyuncu kendi pilotunun hangi sunucuda olduğunu görür', async () => {
    const { client } = await pilot('SunucuPilot');
    const s = await call(ctx.app, client, 'GET', '/game/servers');
    expect(s.json().servers[0]).toMatchObject({ hasMyPilot: true, pilotCount: 1 });
  });
});

describe('POST /players — pilot oluşturma', () => {
  it('oturumsuz 401, e-postası doğrulanmamış hesap 403', async () => {
    expect((await call(ctx.app, newClient(), 'POST', '/players', { serverCode: 'TR1', companyCode: 'KZL' })).statusCode).toBe(401);
    const { client } = await registerAndLogin(ctx, 'DogrulanmamisP', { verify: false });
    const r = await call(ctx.app, client, 'POST', '/players', { serverCode: 'TR1', companyCode: 'KZL' });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('e-posta doğrulandıktan hemen sonra (önbellek beklemeden) pilot oluşturulabilir', async () => {
    const { client, email } = await registerAndLogin(ctx, 'HemenPilot', { verify: false });
    await call(ctx.app, client, 'GET', '/auth/me'); // oturum önbelleğe alınır (doğrulanmamış)
    const token = ctx.mailer.lastTo(email)!.text.match(/token=([A-Za-z0-9_-]+)/)![1];
    await call(ctx.app, newClient(), 'POST', '/auth/verify-email', { token });
    const r = await call(ctx.app, client, 'POST', '/players', { serverCode: 'TR1', companyCode: 'ALT' });
    expect(r.statusCode).toBe(201);
  });

  it('pilotu başlangıç değerleriyle oluşturur: şirket, ana harita, Kırlangıç, paralar, başarım', async () => {
    const { pilot: p } = await pilot('KozmikKartal', 'KZL');
    expect(p.pilotName).toBe('KozmikKartal');
    expect(p.playerId).toBeGreaterThanOrEqual(100001);
    expect(p.server).toEqual({ code: 'TR1', name: 'Anadolu-1' });
    expect(p.company).toEqual({ code: 'KZL', name: 'Kızılelma Konsorsiyumu', colorHex: '#E30A17' });
    expect(p.map).toMatchObject({ code: 'K-1', name: 'Kızılelma Limanı', pvpEnabled: false, x: 1800, y: 1800 });
    expect(p.level).toMatchObject({ level: 1, experience: 0, nextLevelXp: 5000, progress: 0 });
    expect(p.rank).toMatchObject({ name: 'Pilot Adayı', points: 0, next: { name: 'Uzay Pilotu', minPoints: 100 } });
    expect(p.activeShip).toMatchObject({ code: 'kirlangic', name: 'Kırlangıç', hitpoints: 4000, maxHitpoints: 4000 });
    expect(p.currencies).toEqual([
      { code: 'KREDI', name: 'Kredi', isPremium: false, balance: 25000 },
      { code: 'AKCE', name: 'Akçe', isPremium: true, balance: 1000 },
    ]);
    expect(p.stats).toEqual({ npcKills: 0, playerKills: 0, deaths: 0, gatesCompleted: 0, cargoCollected: 0, damageDealt: 0, damageTaken: 0 });
    expect(p.achievements.earned).toBe(1);
    expect(p.achievements.items.find((a: { code: string }) => a.code === 'pilot_created').completedAt).not.toBeNull();
    expect(p.clan).toBeNull();
    expect(p.companyChange.availableAt).not.toBeNull(); // 30 gün dolmadan değiştirilemez
  });

  it('başlangıç paraları defterde (ledger) kayıtlı', async () => {
    const { client } = await pilot('DefterPilot');
    const r = await call(ctx.app, client, 'GET', '/players/me/ledger?server=TR1');
    const entries = r.json().entries;
    expect(entries).toHaveLength(2);
    expect(entries.map((e: { reason: string }) => e.reason)).toEqual(['starter_grant', 'starter_grant']);
    expect(entries.map((e: { currency: string; delta: number }) => `${e.currency}:${e.delta}`).sort()).toEqual(['AKCE:1000', 'KREDI:25000']);
  });

  it('Yönetim Merkezi başlangıç ayarı değişince yeni pilotlar yeni değeri alır', async () => {
    await ctx.rt.db.query(`UPDATE game_settings SET value = '{"KREDI": 50000, "AKCE": 0}'::jsonb WHERE key = 'starter.currencies'`);
    const { pilot: p } = await pilot('YeniAyarPilot');
    expect(p.currencies.find((c: { code: string }) => c.code === 'KREDI').balance).toBe(50000);
    expect(p.currencies.find((c: { code: string }) => c.code === 'AKCE').balance).toBe(0);
  });

  it('sunucu başına tek pilot', async () => {
    const { client } = await pilot('TekPilot');
    const r = await call(ctx.app, client, 'POST', '/players', { serverCode: 'TR1', companyCode: 'KZL' });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('PILOT_EXISTS');
    const { rows } = await ctx.rt.db.query('SELECT count(*)::int AS n FROM players');
    expect(rows[0].n).toBe(1);
  });

  it('istemci seviye/para/gemi gibi alan gönderemez', async () => {
    const { client } = await registerAndLogin(ctx, 'HileciPilot');
    for (const extra of [{ experience: 999999 }, { level: 50 }, { currencies: { AKCE: 1e9 } }, { pilotName: 'Admin' }]) {
      const r = await call(ctx.app, client, 'POST', '/players', { serverCode: 'TR1', companyCode: 'KZL', ...extra });
      expect(r.statusCode).toBe(400);
    }
  });

  it('bilinmeyen sunucu/şirket 404, kapalı sunucu 403', async () => {
    const { client } = await registerAndLogin(ctx, 'HataliPilot');
    expect((await call(ctx.app, client, 'POST', '/players', { serverCode: 'TR9', companyCode: 'KZL' })).statusCode).toBe(404);
    expect((await call(ctx.app, client, 'POST', '/players', { serverCode: 'TR1', companyCode: 'XYZ' })).statusCode).toBe(404);
    await ctx.rt.db.query(`UPDATE game_servers SET is_maintenance = true`);
    const r = await call(ctx.app, client, 'POST', '/players', { serverCode: 'TR1', companyCode: 'KZL' });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe('SERVER_CLOSED');
  });
});

describe('profil okuma ve sunucu otoriteli ilerleme', () => {
  it('pilotu yoksa boş liste döner', async () => {
    const { client } = await registerAndLogin(ctx, 'PilotsuzHesap');
    const r = await call(ctx.app, client, 'GET', '/players/me');
    expect(r.json().pilots).toEqual([]);
  });

  it('seviye ve rütbe sunucudaki deneyim/istatistiklerden hesaplanır; başarımlar otomatik verilir', async () => {
    const { client, pilot: p } = await pilot('IlerlemePilot');
    await ctx.rt.db.query('UPDATE players SET experience = $2, honor = 950 WHERE id = $1', [p.id, xpForLevel(10) + 10]);
    await ctx.rt.db.query('UPDATE player_stats SET npc_kills = 150, player_kills = 3 WHERE player_id = $1', [p.id]);
    const me = (await call(ctx.app, client, 'GET', '/players/me')).json().pilots[0];
    expect(me.level.level).toBe(10);
    // rütbe puanı = 971 + 95 + 300 + 30 = 1396 → Onbaşı (1000+)
    expect(me.rank.points).toBe(Math.floor((xpForLevel(10) + 10) / 1000) + 95 + 300 + 30);
    expect(me.rank.name).toBe('Onbaşı');
    const done = me.achievements.items.filter((a: { completedAt: string | null }) => a.completedAt).map((a: { code: string }) => a.code);
    expect(done).toEqual(expect.arrayContaining(['pilot_created', 'level_5', 'level_10', 'npc_100']));
    expect(done).not.toContain('npc_1000');
    const npc1000 = me.achievements.items.find((a: { code: string }) => a.code === 'npc_1000');
    expect(npc1000).toMatchObject({ progress: 150, target: 1000, completedAt: null });
    const { rows } = await ctx.rt.db.query('SELECT count(*)::int AS n FROM player_achievements WHERE player_id = $1', [p.id]);
    expect(rows[0].n).toBe(4);
  });

  it('istatistikler istemciden yazılamaz: güncelleme yalnızca slogan kabul eder', async () => {
    const { client, pilot: p } = await pilot('YazmaPilot');
    for (const body of [
      { serverCode: 'TR1', motto: 'x', experience: 1e9 },
      { serverCode: 'TR1', motto: 'x', honor: 1e6 },
      { serverCode: 'TR1', motto: 'x', stats: { npcKills: 1e6 } },
      { serverCode: 'TR1', npcKills: 5 },
    ]) {
      const r = await call(ctx.app, client, 'PATCH', '/players/me', body);
      expect(r.statusCode).toBe(400);
    }
    for (const path of ['/players/me/stats', '/players/me/experience', '/players/me/wallet']) {
      expect([404, 405]).toContain((await call(ctx.app, client, 'POST', path, { value: 1 })).statusCode);
    }
    const { rows } = await ctx.rt.db.query('SELECT experience, honor FROM players WHERE id = $1', [p.id]);
    expect(rows[0]).toEqual({ experience: '0', honor: '0' });
  });

  it('slogan güncellenir, temizlenir ve geçersiz içerik reddedilir', async () => {
    const { client } = await pilot('SloganPilot');
    let r = await call(ctx.app, client, 'PATCH', '/players/me', { serverCode: 'TR1', motto: '  Gökbörü asla geri adım atmaz  ' });
    expect(r.statusCode).toBe(200);
    expect(r.json().pilot.motto).toBe('Gökbörü asla geri adım atmaz');
    r = await call(ctx.app, client, 'PATCH', '/players/me', { serverCode: 'TR1', motto: 'a'.repeat(81) });
    expect(r.statusCode).toBe(400);
    r = await call(ctx.app, client, 'PATCH', '/players/me', { serverCode: 'TR1', motto: '' });
    expect(r.json().pilot.motto).toBeNull();
  });

  it('PATCH için CSRF zorunlu (web oturumu)', async () => {
    const { client } = await pilot('CsrfSlogan');
    const r = await call(ctx.app, { ...client, csrf: null }, 'PATCH', '/players/me', { serverCode: 'TR1', motto: 'deneme' });
    expect(r.statusCode).toBe(403);
  });

  it('cihazlar arası senkron: Android uygulamasında yapılan değişiklik web\'de anında görünür', async () => {
    const { client: web } = await pilot('SenkronPilot');
    const login = await call(ctx.app, newClient(), 'POST', '/auth/login', {
      identifier: 'SenkronPilot',
      password: STRONG_PASSWORD,
      transport: 'token',
      device: { platform: 'android' },
    });
    const phone = newClient({ bearer: login.json().sessionToken, userAgent: 'TurkOrbitApp/0.1 Android' });
    const upd = await call(ctx.app, phone, 'PATCH', '/players/me', { serverCode: 'TR1', motto: 'Telefondan yazıldı' });
    expect(upd.statusCode).toBe(200);
    const fromWeb = (await call(ctx.app, web, 'GET', '/players/me')).json().pilots[0];
    const fromPhone = (await call(ctx.app, phone, 'GET', '/players/me')).json().pilots[0];
    expect(fromWeb.motto).toBe('Telefondan yazıldı');
    expect(fromWeb).toEqual(fromPhone);
  });
});

describe('şirket değiştirme', () => {
  it('30 gün dolmadan değiştirilemez', async () => {
    const { client } = await pilot('BekleyenPilot', 'GKB');
    const r = await call(ctx.app, client, 'POST', '/players/me/company', { serverCode: 'TR1', companyCode: 'KZL' });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('COMPANY_CHANGE_COOLDOWN');
  });

  it('aynı şirkete geçilemez; yetersiz bakiyede para düşülmez', async () => {
    const { client, pilot: p } = await pilot('FakirPilot', 'GKB');
    await ctx.rt.db.query(`UPDATE players SET created_at = now() - interval '31 days' WHERE id = $1`, [p.id]);
    expect((await call(ctx.app, client, 'POST', '/players/me/company', { serverCode: 'TR1', companyCode: 'GKB' })).json().error.code).toBe('SAME_COMPANY');
    const r = await call(ctx.app, client, 'POST', '/players/me/company', { serverCode: 'TR1', companyCode: 'ALT' });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('INSUFFICIENT_FUNDS');
    expect(r.json().error.message).toContain('Akçe');
    const me = (await call(ctx.app, client, 'GET', '/players/me')).json().pilots[0];
    expect(me.company.code).toBe('GKB');
    expect(me.currencies.find((c: { code: string }) => c.code === 'AKCE').balance).toBe(1000);
  });

  it('başarılı değişim: ücret defterden düşer, yeni şirketin ana haritasına taşınır, bekleme yeniden başlar', async () => {
    const { client, pilot: p } = await pilot('GocmenPilot', 'GKB');
    await ctx.rt.db.query(`UPDATE players SET created_at = now() - interval '31 days' WHERE id = $1`, [p.id]);
    await ctx.rt.db.query(`UPDATE wallets SET balance = 5000 WHERE player_id = $1 AND currency_code = 'AKCE'`, [p.id]);
    const r = await call(ctx.app, client, 'POST', '/players/me/company', { serverCode: 'TR1', companyCode: 'ALT' });
    expect(r.statusCode).toBe(200);
    const after = r.json().pilot;
    expect(after.company.code).toBe('ALT');
    expect(after.map.code).toBe('A-1');
    expect(after.currencies.find((c: { code: string }) => c.code === 'AKCE').balance).toBe(3000);
    expect(after.companyChange.availableAt).not.toBeNull();
    const ledger = (await call(ctx.app, client, 'GET', '/players/me/ledger?server=TR1')).json().entries;
    expect(ledger[0]).toMatchObject({ currency: 'AKCE', delta: -2000, balanceAfter: 3000, reason: 'company_change' });
    // Hemen ikinci değişim bekleme süresine takılır (çift tıklama iki kez ücret almaz)
    const again = await call(ctx.app, client, 'POST', '/players/me/company', { serverCode: 'TR1', companyCode: 'KZL' });
    expect(again.json().error.code).toBe('COMPANY_CHANGE_COOLDOWN');
  });

  it('aynı anda gönderilen iki değişim isteğinden yalnızca biri uygulanır', async () => {
    const { client, pilot: p } = await pilot('YarisPilot', 'GKB');
    await ctx.rt.db.query(`UPDATE players SET created_at = now() - interval '31 days' WHERE id = $1`, [p.id]);
    await ctx.rt.db.query(`UPDATE wallets SET balance = 10000 WHERE player_id = $1 AND currency_code = 'AKCE'`, [p.id]);
    const [a, b] = await Promise.all([
      call(ctx.app, client, 'POST', '/players/me/company', { serverCode: 'TR1', companyCode: 'KZL' }),
      call(ctx.app, client, 'POST', '/players/me/company', { serverCode: 'TR1', companyCode: 'ALT' }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    const { rows } = await ctx.rt.db.query(
      `SELECT count(*)::int AS n FROM currency_ledger WHERE player_id = $1 AND reason = 'company_change'`,
      [p.id],
    );
    expect(rows[0].n).toBe(1);
  });
});

describe('herkese açık pilot profili', () => {
  it('oturumsuz görüntülenebilir; e-posta, para, konum ve oynama süresi içermez', async () => {
    await pilot('AcikPilot', 'ALT');
    const r = await call(ctx.app, newClient(), 'GET', '/pilots/tr1/acikpilot');
    expect(r.statusCode).toBe(200);
    const pub = r.json().pilot;
    expect(pub).toMatchObject({ pilotName: 'AcikPilot', level: 1, company: { code: 'ALT' }, rank: { name: 'Pilot Adayı' } });
    const text = JSON.stringify(pub);
    for (const secret of ['@ornek.com', 'currencies', 'balance', 'playtime', '"map"', 'pos_x', 'experience', 'damageTaken']) {
      expect(text).not.toContain(secret);
    }
  });

  it('olmayan pilot 404; silinmiş hesap görünmez', async () => {
    expect((await call(ctx.app, newClient(), 'GET', '/pilots/TR1/YokBoyle')).statusCode).toBe(404);
    expect((await call(ctx.app, newClient(), 'GET', '/pilots/TR1/..%2F..%2Fetc')).statusCode).toBe(404);
    await pilot('SilinenPilot');
    await ctx.rt.db.query(`UPDATE users SET status = 'deleted' WHERE username = 'SilinenPilot'`);
    expect((await call(ctx.app, newClient(), 'GET', '/pilots/TR1/SilinenPilot')).statusCode).toBe(404);
  });
});
