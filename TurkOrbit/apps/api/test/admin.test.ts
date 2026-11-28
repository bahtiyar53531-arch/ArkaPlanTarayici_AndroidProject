/**
 * Yönetim Merkezi entegrasyon testleri (Aşama 14) — GERÇEK PostgreSQL + Redis.
 * 07 kabul ölçütleri: her uç nokta için yetkisiz → 403; yayınla/geri al; denetim kaydı; iki yetkili onayı.
 */
import { ROLE_PERMISSIONS, type RoleKey } from '@turkorbit/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_ROUTE_SPECS } from '../src/modules/admin/routes.js';
import { call, createTestContext, newClient, registerAndLogin, resetDatabase, type Client, type TestContext } from './helpers.js';

let ctx: TestContext;
let now = new Date();
const PASSWORD = 'Nebula-Kartal-77';

beforeAll(async () => {
  ctx = await createTestContext({}, undefined, { clock: () => now });
});
afterAll(async () => {
  // Bu dosyanın değiştirdiği içerik sonraki test dosyaları için eski haline döner
  await ctx.rt.db.query(`UPDATE npc_types SET hitpoints = 400, shield = 200, name = 'Çakal' WHERE code = 'cakal'`);
  await ctx.rt.db.query(`UPDATE shop_offers SET price = 1000, discount_percent = 0, is_active = true WHERE id = 18`);
  await ctx.rt.db.query(`DELETE FROM quests WHERE code LIKE 'test_%'`);
  await ctx.rt.db.query(`DELETE FROM reward_tables WHERE code LIKE 'quest.admin-test_%'`);
  await ctx.rt.db.query(`UPDATE maps SET pvp_enabled = false, is_closed = false, closed_reason = NULL WHERE code = 'K-1'`);
  await ctx.close();
});
beforeEach(async () => {
  await resetDatabase(ctx.rt);
  now = new Date();
});

let ipSeq = 1;
async function user(username: string, o: { roles?: RoleKey[]; pilot?: boolean } = {}) {
  const { client } = await registerAndLogin(ctx, username, { client: newClient({ ip: `78.160.${ipSeq++ % 250}.9` }) });
  if (o.pilot) {
    const r = await call(ctx.app, client, 'POST', '/players', { serverCode: 'TR1', companyCode: 'KZL' });
    if (r.statusCode !== 201) throw new Error(r.body);
  }
  for (const role of o.roles ?? []) await ctx.rt.db.query(`INSERT INTO user_roles (user_id, role_key) SELECT id, $2 FROM users WHERE username = $1`, [username, role]);
  const id = (await ctx.rt.db.query<{ id: string }>('SELECT id FROM users WHERE username = $1', [username])).rows[0]!.id;
  const pilotId = (await ctx.rt.db.query<{ id: string }>('SELECT id FROM players WHERE user_id = $1', [id])).rows[0]?.id ?? null;
  return { client, id, name: username, pilotId };
}
type U = Awaited<ReturnType<typeof user>>;
const post = (u: U | Client, url: string, body?: unknown) => call(ctx.app, 'client' in u ? u.client : u, 'POST', url, body ?? {});
const get = (u: U | Client, url: string) => call(ctx.app, 'client' in u ? u.client : u, 'GET', url);
const auditActions = async (prefix = '') =>
  (await ctx.rt.db.query<{ action: string; actor_label: string; result: string }>(`SELECT action, actor_label, result FROM admin_audit_log WHERE action LIKE $1 ORDER BY id`, [`${prefix}%`])).rows;
const login = (name: string) => call(ctx.app, newClient({ ip: '31.200.1.1' }), 'POST', '/auth/login', { identifier: name, password: PASSWORD });

// ================================================================== yetki matrisi
describe('yetki: her yönetim ucu sunucuda korunur', () => {
  it('HER UÇ: oturumsuz → 401, oyuncu → 403, yetkisi olmayan personel rolü → 403; yetkili GET uçları 200 döner', async () => {
    const roles: RoleKey[] = ['support_staff', 'content_manager', 'moderator', 'read_only', 'community_admin', 'system_admin', 'game_admin'];
    const staff = new Map<RoleKey, U>();
    const names: Record<string, string> = {
      support_staff: 'RolYardimci', content_manager: 'RolIcerikci', moderator: 'RolDenetci', read_only: 'RolOkuyucu',
      community_admin: 'RolTopluluk', system_admin: 'RolAltyapi', game_admin: 'RolOyunBasi',
    };
    for (const r of roles) staff.set(r, await user(names[r]!, { roles: [r] }));
    const player = await user('SiradanPilot', { pilot: true });
    const top = await user('EnUstYetkili', { roles: ['super_admin'] });
    const fill = (url: string) =>
      url.replace(':userId', player.id).replace(':rid', '1').replace(':id', url.includes('/content/map/') ? 'K-1' : url.includes('/content/setting/') ? 'forum' : url.includes('/clans/') ? '00000000-0000-0000-0000-000000000000' : '1').replace(':role', 'moderator');
    expect(ADMIN_ROUTE_SPECS.length).toBeGreaterThan(55);
    let checked403 = 0;
    for (const s of ADMIN_ROUTE_SPECS) {
      const url = fill(s.url);
      const anon = await call(ctx.app, newClient(), s.method, url, s.method === 'POST' ? {} : undefined);
      expect(anon.statusCode, `${s.method} ${s.url} oturumsuz`).toBe(401);
      const asPlayer = await call(ctx.app, player.client, s.method, url, s.method === 'POST' ? {} : undefined);
      expect(asPlayer.statusCode, `${s.method} ${s.url} oyuncu`).toBe(403);
      // Bu yetkiye sahip OLMAYAN bir personel rolü de reddedilir
      const lacking = roles.find((r) => !ROLE_PERMISSIONS[r].includes(s.permission));
      if (lacking) {
        const res = await call(ctx.app, staff.get(lacking)!.client, s.method, url, s.method === 'POST' ? {} : undefined);
        expect(res.statusCode, `${s.method} ${s.url} → ${lacking} (${s.permission})`).toBe(403);
        expect(res.json().error.code).toBe('FORBIDDEN');
        checked403++;
      }
    }
    expect(checked403).toBeGreaterThan(50);
    // Yetkili: parametresiz GET uçlarının hepsi çalışır
    for (const s of ADMIN_ROUTE_SPECS.filter((x) => x.method === 'GET' && !x.url.includes(':'))) {
      const r = await get(top, s.url);
      expect(r.statusCode, `${s.url} süper yönetici`).toBe(200);
    }
    // Yetki kontrolü tamamen sunucuda: oyuncunun /auth/me yanıtında yetki yok
    expect((await get(player, '/auth/me')).json().permissions).toEqual([]);
  });
});

// ================================================================== yaptırımlar
describe('oyuncu yönetimi ve yaptırımlar', () => {
  it('uyarı bildirim düşer; susturma forumda da geçerli; askı oturumu anında düşürür ve girişte gerekçe görünür; kaldırma; denetim kaydı', async () => {
    const mod = await user('NobetciPilot', { roles: ['moderator'] });
    const cadmin = await user('ToplulukBas', { roles: ['community_admin'] });
    const p = await user('KuralDisi', { pilot: true });
    // Arama: kullanıcı adı, e-posta, oyuncu ID, pilot ID
    expect((await get(mod, '/admin/players?q=kuraldi')).json().players.map((x: { username: string }) => x.username)).toEqual(['KuralDisi']);
    const publicId = (await ctx.rt.db.query<{ public_id: string }>('SELECT public_id::text FROM users WHERE id = $1', [p.id])).rows[0]!.public_id;
    expect((await get(mod, `/admin/players?q=${publicId}`)).json().players).toHaveLength(1);
    expect((await get(mod, `/admin/players?q=${p.pilotId}`)).json().players).toHaveLength(1);

    // Uyarı
    let r = await post(mod, `/admin/players/${p.id}/warn`, { reason: 'Sohbette hakaret', publicReason: 'Lütfen saygılı ol.' });
    expect(r.json()).toEqual({ status: 'applied' });
    const n = (await ctx.rt.db.query<{ kind: string; title: string; body: string }>('SELECT kind, title, body FROM notifications WHERE player_id = $1', [p.pilotId])).rows;
    expect(n).toEqual([{ kind: 'sanction', title: 'Uyarı aldın', body: 'Lütfen saygılı ol.' }]);

    // Susturma: süre zorunlu; forumda yazamaz; kaldırınca yazar
    expect((await post(mod, `/admin/players/${p.id}/mute`, { reason: 'Spam' })).json().error.fields.hours).toBeDefined();
    r = await post(mod, `/admin/players/${p.id}/mute`, { reason: 'Spam', hours: 2 });
    expect(r.statusCode).toBe(200);
    r = await post(p, '/forum/threads', { category: 'genel', title: 'Susturulmuş deneme', body: 'Yazabilir miyim?' });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe('MUTED');
    expect((await get(mod, `/admin/players/${p.id}`)).json().player.mutedUntil).not.toBeNull();
    // Moderatör susturmayı kaldırabilir ama askıyı kaldıramaz (players.unban yok)
    expect((await post(mod, `/admin/players/${p.id}/unmute`, { reason: 'Hata' })).json()).toEqual({ revoked: 1 });
    expect((await post(p, '/forum/threads', { category: 'genel', title: 'Artık yazabiliyorum', body: 'Teşekkürler.' })).statusCode).toBe(201);

    // Askı (24 saat): açık oturum anında geçersiz; girişte gerekçe
    r = await post(mod, `/admin/players/${p.id}/suspend`, { reason: 'Hile şüphesi', publicReason: 'Hız hilesi tespit edildi.', hours: 24 });
    expect(r.json()).toEqual({ status: 'applied' });
    expect((await get(p, '/auth/me')).statusCode).toBe(401);
    const lg = await login('KuralDisi');
    expect(lg.statusCode).toBe(403);
    expect(lg.json().error.code).toBe('ACCOUNT_SUSPENDED');
    expect(lg.json().error.message).toContain('Hız hilesi tespit edildi.');
    expect((await post(mod, `/admin/players/${p.id}/unban`, { reason: 'İtiraz' })).statusCode).toBe(403);
    expect((await post(cadmin, `/admin/players/${p.id}/unban`, { reason: 'İtiraz haklı çıktı' })).json()).toEqual({ revoked: 1 });
    expect((await login('KuralDisi')).statusCode).toBe(200);

    const d = (await get(mod, `/admin/players/${p.id}`)).json().player;
    expect(d.sanctions.map((s: { kind: string; active: boolean }) => [s.kind, s.active])).toEqual([
      ['suspension', false],
      ['mute', false],
      ['warning', false],
    ]);
    expect(d.pilotDetails[0]).toMatchObject({ company: 'KZL', level: 1, online: false });
    expect((await auditActions('player.')).map((a) => `${a.action}:${a.actor_label}`)).toEqual([
      'player.warning:NobetciPilot',
      'player.mute:NobetciPilot',
      'player.unmute:NobetciPilot',
      'player.suspension:NobetciPilot',
      'player.unban:ToplulukBas',
    ]);
  });

  it('rütbe kuralı: personel kendine veya üst/eşit rütbeye yaptırım uygulayamaz; kilit ve oturum sonlandırma', async () => {
    const mod = await user('NobetciIki', { roles: ['moderator'] });
    const mod2 = await user('NobetciUc', { roles: ['moderator'] });
    const gadmin = await user('OyunBasi', { roles: ['game_admin'] });
    const p = await user('KilitliPilot', { pilot: true });
    expect((await post(mod, `/admin/players/${mod.id}/warn`, { reason: 'deneme' })).json().error.code).toBe('ROLE_RANK');
    expect((await post(mod, `/admin/players/${mod2.id}/warn`, { reason: 'deneme' })).json().error.code).toBe('ROLE_RANK');
    expect((await post(mod, `/admin/players/${gadmin.id}/suspend`, { reason: 'deneme', hours: 1 })).json().error.code).toBe('ROLE_RANK');
    // Kilit: yalnızca players.lock (oyun yöneticisi)
    expect((await post(mod, `/admin/players/${p.id}/lock`, { reason: 'Güvenlik', hours: 6 })).statusCode).toBe(403);
    expect((await post(gadmin, `/admin/players/${p.id}/lock`, { reason: 'Hesap ele geçirilmiş olabilir', hours: 6 })).json()).toEqual({ status: 'applied' });
    expect((await login('KilitliPilot')).json().error.code).toBe('ACCOUNT_LOCKED');
    expect((await post(gadmin, `/admin/players/${p.id}/unlock`, { reason: 'Sahibi doğrulandı' })).json()).toEqual({ revoked: 1 });
    const again = await login('KilitliPilot');
    expect(again.statusCode).toBe(200);
    // Oturum sonlandırma
    const r = await post(gadmin, `/admin/players/${p.id}/sessions/revoke`, { reason: 'Şüpheli oturumlar' });
    expect(r.json().revoked).toBeGreaterThanOrEqual(1);
    expect((await get(p, '/auth/me')).statusCode).toBe(401);
  });

  it('KALICI BAN İKİ YETKİLİ ONAYI İSTER: talep eden onaylayamaz; ikinci yetkili onaylayınca hesap yasaklanır; veritabanı da talep edenin onayını reddeder', async () => {
    const mod = await user('BanIsteyen', { roles: ['moderator'] });
    const mod2 = await user('BanOnaylayan', { roles: ['moderator'] });
    const support = await user('YardimMasa', { roles: ['support_staff'] });
    const p = await user('HileciPilot', { pilot: true });
    const r = await post(mod, `/admin/players/${p.id}/ban`, { reason: 'Hız hilesi kanıtlandı', publicReason: 'Hile kullanımı.' });
    expect(r.json()).toMatchObject({ status: 'pending_approval', approval: { action: 'player.ban.permanent', status: 'pending', mine: true, canReview: false } });
    const id = r.json().approval.id as number;
    // Hesap henüz yasaklı değil; aynı hesap için ikinci talep açılamaz
    expect((await login('HileciPilot')).statusCode).toBe(200);
    expect((await post(mod, `/admin/players/${p.id}/ban`, { reason: 'tekrar' })).statusCode).toBe(409);
    // Talep eden onaylayamaz
    let rv = await post(mod, `/admin/approvals/${id}/review`, { approve: true });
    expect(rv.statusCode).toBe(403);
    expect(rv.json().error.code).toBe('APPROVAL_SELF');
    // Yetkisi olmayan (destek) onaylayamaz ve listede görmez
    expect((await post(support, `/admin/approvals/${id}/review`, { approve: true })).statusCode).toBe(403);
    expect((await get(support, '/admin/approvals')).json().approvals).toEqual([]);
    // İkinci moderatör görür ve onaylar
    expect((await get(mod2, '/admin/approvals')).json().approvals[0]).toMatchObject({ id, canReview: true, mine: false, summary: 'HileciPilot → kalıcı ban' });
    rv = await post(mod2, `/admin/approvals/${id}/review`, { approve: true, note: 'Kayıtları inceledim' });
    expect(rv.json().approval).toMatchObject({ status: 'executed', reviewedBy: 'BanOnaylayan' });
    const lg = await login('HileciPilot');
    expect(lg.json().error.code).toBe('ACCOUNT_BANNED');
    expect(lg.json().error.message).toContain('Hile kullanımı.');
    // Sonuçlanmış talep tekrar incelenemez
    expect((await post(mod2, `/admin/approvals/${id}/review`, { approve: false })).json().error.code).toBe('APPROVAL_CLOSED');
    // Veritabanı CHECK: talep eden kendi talebini onaylayamaz (kod atlatılsa bile)
    const r2 = await post(mod2, `/admin/players/${mod.id}/warn`, { reason: 'Eşit rütbe denemesi' });
    expect(r2.json().error.code).toBe('ROLE_RANK');
    const other = await user('BaskaPilot', { pilot: true });
    const id2 = (await post(mod, `/admin/players/${other.id}/ban`, { reason: 'deneme talebi' })).json().approval.id as number;
    await expect(ctx.rt.db.query('UPDATE approval_requests SET reviewed_by = requested_by, status = $2 WHERE id = $1', [id2, 'executed'])).rejects.toThrow(/approval_two_person/);
    expect((await auditActions('approval.')).map((a) => `${a.action}:${a.actor_label}:${a.result}`)).toEqual([
      'approval.request:BanIsteyen:pending_approval',
      'approval.approve:BanOnaylayan:success',
      'approval.request:BanIsteyen:pending_approval',
    ]);
    expect((await auditActions('player.ban')).map((a) => a.actor_label)).toEqual(['BanOnaylayan']);
  });
});

// ================================================================== içerik: yayınla / geri al
describe('içerik sürümleme', () => {
  it('NPC: taslak → fark → yayın (veritabanı + denetim) → geri alma; içerik yöneticisi geri alamaz; doğrulama', async () => {
    const cm = await user('IcerikUstasi', { roles: ['content_manager'] });
    const ga = await user('OyunYoneten', { roles: ['game_admin'] });
    const list = (await get(cm, '/admin/content/npc_type')).json();
    const cakal = list.items.find((i: { columns: { code: string } }) => i.columns.code === 'cakal');
    expect(cakal).toMatchObject({ columns: { hitpoints: 400 }, draftId: null, version: null });
    // Doğrulama
    let r = await post(cm, `/admin/content/npc_type/${cakal.id}/drafts`, { changes: { hitpoints: -5, bilinmeyen: 1 } });
    expect(r.statusCode).toBe(400);
    expect(Object.keys(r.json().error.fields).sort()).toEqual(['bilinmeyen', 'hitpoints']);
    expect((await post(cm, `/admin/content/npc_type/${cakal.id}/drafts`, { changes: { hitpoints: 400 } })).json().error.code).toBe('NO_CHANGES');
    // Taslak: veritabanı değişmez, fark görünür
    r = await post(cm, `/admin/content/npc_type/${cakal.id}/drafts`, { changes: { hitpoints: 1000, shield: 300 }, note: 'Çakal çok kolaydı' });
    const c1 = r.json().content;
    expect(c1.draft.diff).toEqual([
      { key: 'hitpoints', label: 'Can', before: 400, after: 1000 },
      { key: 'shield', label: 'Kalkan', before: 200, after: 300 },
    ]);
    expect(c1.revisions.map((v: { version: number; status: string }) => [v.version, v.status])).toEqual([[1, 'published']]);
    expect(c1.impact[0]).toContain('K-1');
    expect((await ctx.rt.db.query(`SELECT hitpoints FROM npc_types WHERE code = 'cakal'`)).rows[0].hitpoints).toBe(400);
    // Yayın
    r = await post(cm, `/admin/content/npc_type/revisions/${c1.draft.id}/publish`);
    expect(r.statusCode).toBe(200);
    expect((await ctx.rt.db.query(`SELECT hitpoints, shield FROM npc_types WHERE code = 'cakal'`)).rows[0]).toEqual({ hitpoints: 1000, shield: 300 });
    const c2 = r.json().content;
    expect(c2.revisions.map((v: { version: number; status: string }) => [v.version, v.status])).toEqual([[2, 'published'], [1, 'superseded']]);
    const pub = (await ctx.rt.db.query(`SELECT actor_label, before_value, after_value, reason FROM admin_audit_log WHERE action = 'content.publish'`)).rows[0];
    expect(pub).toMatchObject({ actor_label: 'IcerikUstasi', reason: 'Çakal çok kolaydı', before_value: { version: 1 }, after_value: { version: 2 } });
    expect(pub.before_value.values.hitpoints).toBe(400);
    expect(pub.after_value.values.hitpoints).toBe(1000);
    // İçerik yöneticisinin geri alma yetkisi yok; oyun yöneticisi sürüm 1'e geri döner
    const v1 = c2.revisions.find((v: { version: number }) => v.version === 1).id as number;
    expect((await post(cm, `/admin/content/npc_type/revisions/${v1}/rollback`)).statusCode).toBe(403);
    r = await post(ga, `/admin/content/npc_type/revisions/${v1}/rollback`, { reason: 'Oyuncular zorlandı' });
    expect(r.statusCode).toBe(200);
    expect((await ctx.rt.db.query(`SELECT hitpoints, shield FROM npc_types WHERE code = 'cakal'`)).rows[0]).toEqual({ hitpoints: 400, shield: 200 });
    expect(r.json().content.revisions.map((v: { version: number; status: string }) => [v.version, v.status])).toEqual([
      [3, 'published'],
      [2, 'rolled_back'],
      [1, 'superseded'],
    ]);
    expect((await auditActions('content.')).map((a) => `${a.action}:${a.actor_label}`)).toEqual([
      'content.draft:IcerikUstasi',
      'content.publish:IcerikUstasi',
      'content.rollback:OyunYoneten',
    ]);
  });

  it('iyimser kilit: araya giren değişiklikte yayın 409; yeni taslak eskisini geçersiz kılar', async () => {
    const a = await user('IcerikBir', { roles: ['content_manager'] });
    const b = await user('IcerikIki', { roles: ['content_manager'] });
    const id = (await ctx.rt.db.query<{ id: number }>(`SELECT id FROM npc_types WHERE code = 'cakal'`)).rows[0]!.id;
    const d1 = (await post(a, `/admin/content/npc_type/${id}/drafts`, { changes: { hitpoints: 500 } })).json().content.draft.id;
    // Veritabanında doğrudan değişiklik → yayın reddedilir, değer korunur
    await ctx.rt.db.query(`UPDATE npc_types SET hitpoints = 450 WHERE id = $1`, [id]);
    let r = await post(a, `/admin/content/npc_type/revisions/${d1}/publish`);
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('REVISION_CONFLICT');
    expect((await ctx.rt.db.query('SELECT hitpoints FROM npc_types WHERE id = $1', [id])).rows[0].hitpoints).toBe(450);
    // Yeni taslak: doğrudan değişiklik "sürüm" olarak kaydedilir, üzerine kurulur
    const d2 = (await post(a, `/admin/content/npc_type/${id}/drafts`, { changes: { hitpoints: 600 } })).json().content;
    expect(d2.revisions[0].note).toBe('Veritabanında doğrudan yapılan değişiklik');
    // B yeni taslak açınca A'nın taslağı geçersiz olur
    const d3 = (await post(b, `/admin/content/npc_type/${id}/drafts`, { changes: { hitpoints: 700 } })).json().content.draft.id;
    r = await post(a, `/admin/content/npc_type/revisions/${d2.draft.id}/publish`);
    expect(r.statusCode).toBe(409);
    expect((await post(b, `/admin/content/npc_type/revisions/${d3}/publish`)).statusCode).toBe(200);
    expect((await ctx.rt.db.query('SELECT hitpoints FROM npc_types WHERE id = $1', [id])).rows[0].hitpoints).toBe(700);
    await ctx.rt.db.query(`UPDATE npc_types SET hitpoints = 400 WHERE id = $1`, [id]);
  });

  it('MAĞAZA: fiyat yayınlanınca oyuncunun mağazasında ve satın almada yeni fiyat geçerli; geri alınca eski fiyat', async () => {
    // Mağaza fiyatı ekonomi yazma yetkisi ister (economy.write: oyun yöneticisi); içerik yöneticisi yalnızca okur
    const cmOnly = await user('FiyatOkur', { roles: ['content_manager'] });
    const cm = await user('FiyatUstasi', { roles: ['game_admin'] });
    const ga = await user('FiyatOnayci', { roles: ['game_admin'] });
    const p = await user('AlisverisPilot', { pilot: true });
    const offer = async () => (await get(p, '/shop?server=TR1')).json().shop.categories.flatMap((c: { offers: Array<{ id: number }> }) => c.offers).find((o: { id: number }) => o.id === 18);
    expect(await offer()).toMatchObject({ price: 1000, finalPrice: 1000 });
    expect((await get(cmOnly, '/admin/content/shop_offer/18')).statusCode).toBe(200);
    expect((await post(cmOnly, '/admin/content/shop_offer/18/drafts', { changes: { price: 1 } })).statusCode).toBe(403);
    const d = (await post(cm, '/admin/content/shop_offer/18/drafts', { changes: { price: 1500, discount_percent: 20 } })).json().content;
    expect(d.draft.diff.map((x: { key: string }) => x.key)).toEqual(['price', 'discount_percent']);
    await post(cm, `/admin/content/shop_offer/revisions/${d.draft.id}/publish`);
    expect(await offer()).toMatchObject({ price: 1500, finalPrice: 1200 });
    const before = Number((await ctx.rt.db.query(`SELECT balance FROM wallets WHERE player_id = $1 AND currency_code = 'KREDI'`, [p.pilotId])).rows[0].balance);
    const buy = await post(p, '/shop/purchase', { serverCode: 'TR1', offerId: 18, packs: 1, requestId: crypto.randomUUID() });
    expect(buy.statusCode).toBe(200);
    const after = Number((await ctx.rt.db.query(`SELECT balance FROM wallets WHERE player_id = $1 AND currency_code = 'KREDI'`, [p.pilotId])).rows[0].balance);
    expect(before - after).toBe(1200);
    const v1 = (await get(cm, '/admin/content/shop_offer/18')).json().content.revisions.find((v: { version: number }) => v.version === 1).id;
    await post(ga, `/admin/content/shop_offer/revisions/${v1}/rollback`);
    expect(await offer()).toMatchObject({ price: 1000, finalPrice: 1000 });
  });

  it('GÖREV: yeni etkinlik görevi yayımlanmadan oyuncu görmez; yayımlanınca görev listesinde görünür', async () => {
    const cm = await user('GorevUstasi', { roles: ['content_manager'] });
    const p = await user('GorevPilotu', { pilot: true });
    const start = new Date(Date.now() - 3600_000).toISOString();
    const end = new Date(Date.now() + 7 * 86400_000).toISOString();
    let r = await post(cm, '/admin/quests', {
      code: 'test_cakal_avi',
      category: 'event',
      title: 'Çakal Avı Haftası',
      description: 'Bu hafta Kızılelma çevresindeki çakalları temizle.',
      minLevel: 1,
      startsAt: start,
      endsAt: end,
      objective: { type: 'kill_npc', target: 5, label: '5 Çakal yok et', params: { npc: ['cakal'] } },
      reward: { credits: 5000, experience: 2000, honor: 0 },
    });
    expect(r.statusCode).toBe(200);
    const id = r.json().id as number;
    const codes = async () => ((await get(p, '/quests?server=TR1')).json().quests.quests as Array<{ code: string }>).map((q) => q.code);
    expect(await codes()).not.toContain('test_cakal_avi');
    expect((await post(cm, '/admin/quests', { code: 'test_cakal_avi', category: 'main', title: 'x'.repeat(5), description: 'yyyyy', minLevel: 1, objective: { type: 'visit_map', target: 1, label: 'Ziyaret et', params: {} }, reward: { credits: 1 } })).json().error.code).toBe('QUEST_CODE_TAKEN');
    const d = (await post(cm, `/admin/content/quest/${id}/drafts`, { changes: { is_published: true } })).json().content;
    await post(cm, `/admin/content/quest/revisions/${d.draft.id}/publish`);
    const list = (await get(p, '/quests?server=TR1')).json().quests.quests as Array<{ code: string; title: string; status: string; objectives: Array<{ label: string }> }>;
    const q = list.find((x) => x.code === 'test_cakal_avi');
    expect(q).toMatchObject({ title: 'Çakal Avı Haftası', objectives: [{ label: '5 Çakal yok et' }] });
    expect(['available', 'active']).toContain(q!.status);
    // Etkinlik görevinde tarih silinemez (çapraz doğrulama)
    expect((await post(cm, `/admin/content/quest/${id}/drafts`, { changes: { ends_at: null } })).json().error.message).toContain('başlangıç ve bitiş zorunlu');
  });

  it('AYAR: kayıt kapatılınca yeni kayıt reddedilir; geri alınca açılır; içerik yöneticisi ayarlara dokunamaz; harita kapatma sebep ister', async () => {
    const sys = await user('SunucuBakan', { roles: ['system_admin'] });
    const cm = await user('IcerikDort', { roles: ['content_manager'] });
    expect((await post(cm, '/admin/content/setting/registration.enabled/drafts', { changes: { value: false } })).statusCode).toBe(403);
    const d = (await post(sys, '/admin/content/setting/registration.enabled/drafts', { changes: { value: false } })).json().content;
    await post(sys, `/admin/content/setting/revisions/${d.draft.id}/publish`);
    const reg = await call(ctx.app, newClient({ ip: '5.5.5.5' }), 'POST', '/auth/register', { username: 'GecKalan', email: 'gec@ornek.com', password: PASSWORD, acceptTerms: true });
    expect(reg.json().error.code).toBe('REGISTRATION_CLOSED');
    const v1 = (await get(sys, '/admin/content/setting/registration.enabled')).json().content.revisions.find((v: { version: number }) => v.version === 1).id;
    await post(sys, `/admin/content/setting/revisions/${v1}/rollback`);
    expect((await call(ctx.app, newClient({ ip: '5.5.5.6' }), 'POST', '/auth/register', { username: 'GecKalan', email: 'gec@ornek.com', password: PASSWORD, acceptTerms: true })).statusCode).toBe(201);
    // İç içe ayar: yalnızca düzenlenen anahtar değişir, diğerleri korunur
    const f = (await post(sys, '/admin/content/setting/forum/drafts', { changes: { 'value.edit_window_minutes': 60 } })).json().content;
    await post(sys, `/admin/content/setting/revisions/${f.draft.id}/publish`);
    expect((await ctx.rt.db.query(`SELECT value FROM game_settings WHERE key = 'forum'`)).rows[0].value).toEqual({ threads_per_page: 20, posts_per_page: 20, edit_window_minutes: 60, max_body: 20000 });
    // Harita: içerik yöneticisi; kapatırken sebep zorunlu
    expect((await post(cm, '/admin/content/map/K-1/drafts', { changes: { is_closed: true } })).json().error.message).toContain('kapanış sebebi');
  });
});

// ================================================================== ekonomi ve iki yetkili onayı
describe('para/eşya verme ve iki yetkili onayı', () => {
  it('eşik altı anında, eşik üstü onaylı: talep eden ve yetkisiz onaylayamaz; onayda defter + bildirim; süresi dolan onaylanamaz; kendine veremez', async () => {
    const ga = await user('HazineBir', { roles: ['game_admin'] });
    const ga2 = await user('HazineIki', { roles: ['game_admin'] });
    const cm = await user('IcerikBes', { roles: ['content_manager'] });
    const p = await user('SansliPilot', { pilot: true });
    const bal = async (code = 'KREDI') => Number((await ctx.rt.db.query(`SELECT balance FROM wallets WHERE player_id = $1 AND currency_code = $2`, [p.pilotId, code])).rows[0]?.balance ?? 0);
    const start = await bal();
    // Eşik altı: anında
    let r = await post(ga, '/admin/economy/grant', { playerId: p.pilotId, kind: 'currency', code: 'KREDI', amount: 5000, reason: 'Hata telafisi #1234' });
    expect(r.json()).toMatchObject({ status: 'executed', balance: start + 5000 });
    const led = (await ctx.rt.db.query(`SELECT reason, delta::int, actor_user_id FROM currency_ledger WHERE player_id = $1 AND reason = 'admin_grant'`, [p.pilotId])).rows;
    expect(led).toEqual([{ reason: 'admin_grant', delta: 5000, actor_user_id: ga.id }]);
    expect((await ctx.rt.db.query(`SELECT title FROM notifications WHERE player_id = $1 AND kind = 'admin_grant'`, [p.pilotId])).rows[0].title).toBe('Hesabına 5.000 Kredi eklendi');
    // Eşya
    r = await post(ga, '/admin/economy/grant', { playerId: p.pilotId, kind: 'item', code: 'laser.ok1', amount: 2, reason: 'Etkinlik ödülü' });
    expect(r.json().status).toBe('executed');
    expect((await ctx.rt.db.query(`SELECT count(*)::int AS n FROM item_ledger WHERE player_id = $1 AND reason = 'admin_grant'`, [p.pilotId])).rows[0].n).toBe(2);
    // Bilinmeyen kod, kendine verme
    expect((await post(ga, '/admin/economy/grant', { playerId: p.pilotId, kind: 'currency', code: 'ALTIN', amount: 1, reason: 'deneme' })).json().error.fields.code).toBeDefined();
    const gaPilot = await call(ctx.app, ga.client, 'POST', '/players', { serverCode: 'TR1', companyCode: 'GKB' });
    expect((await post(ga, '/admin/economy/grant', { playerId: gaPilot.json().pilot.id, kind: 'currency', code: 'KREDI', amount: 1, reason: 'kendime' })).json().error.code).toBe('ROLE_RANK');
    // Eşik üstü: onay talebi; bakiye değişmez
    r = await post(ga, '/admin/economy/grant', { playerId: p.pilotId, kind: 'currency', code: 'KREDI', amount: 2_000_000, reason: 'Turnuva birincisi' });
    expect(r.json()).toMatchObject({ status: 'pending_approval', approval: { summary: 'SansliPilot → 2.000.000 Kredi' } });
    const id = r.json().approval.id as number;
    expect(await bal()).toBe(start + 5000);
    expect((await post(ga, `/admin/approvals/${id}/review`, { approve: true })).json().error.code).toBe('APPROVAL_SELF');
    expect((await post(cm, `/admin/approvals/${id}/review`, { approve: true })).statusCode).toBe(403);
    // Çıkar çatışması: pilotun sahibi (oyun yöneticisi olsa bile) kendi pilotuna yapılan işlemi onaylayamaz
    const owner = await user('SansliSahip', { roles: ['game_admin'], pilot: true });
    const own = (await post(ga, '/admin/economy/grant', { playerId: owner.pilotId, kind: 'currency', code: 'KREDI', amount: 1_500_000, reason: 'Ödül' })).json().approval.id;
    expect((await post(owner, `/admin/approvals/${own}/review`, { approve: true })).json().error.code).toBe('APPROVAL_SELF');
    expect((await get(ga2, '/admin/approvals')).json().approvals.find((a: { id: number }) => a.id === own).status).toBe('pending');
    r = await post(ga2, `/admin/approvals/${id}/review`, { approve: true, note: 'Turnuva sonuçları doğrulandı' });
    expect(r.json().approval).toMatchObject({ status: 'executed', reviewedBy: 'HazineIki' });
    expect(await bal()).toBe(start + 5000 + 2_000_000);
    // Defterde işlemi başlatan kişi, denetimde onaylayan görünür
    expect((await ctx.rt.db.query(`SELECT actor_user_id FROM currency_ledger WHERE player_id = $1 AND delta = 2000000`, [p.pilotId])).rows[0].actor_user_id).toBe(ga.id);
    expect((await ctx.rt.db.query(`SELECT actor_label FROM admin_audit_log WHERE action = 'economy.grant' ORDER BY id DESC LIMIT 1`)).rows[0].actor_label).toBe('HazineIki');
    // Red ve süre dolması
    const rej = (await post(ga, '/admin/economy/grant', { playerId: p.pilotId, kind: 'currency', code: 'AKCE', amount: 10_000, reason: 'Fazla talep' })).json().approval.id;
    expect((await post(ga2, `/admin/approvals/${rej}/review`, { approve: false, note: 'Gerekçe yetersiz' })).json().approval.status).toBe('rejected');
    const exp = (await post(ga, '/admin/economy/grant', { playerId: p.pilotId, kind: 'currency', code: 'AKCE', amount: 9000, reason: 'Geç kalan talep' })).json().approval.id;
    now = new Date(Date.now() + 73 * 3600_000);
    r = await post(ga2, `/admin/approvals/${exp}/review`, { approve: true });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('APPROVAL_CLOSED');
    expect(await bal('AKCE')).toBe(1000);
  });

  it('onay anında yürütme başarısız olursa (pilot silinmiş) talep "başarısız" kapanır ve hiçbir şey uygulanmaz', async () => {
    const ga = await user('HazineUc', { roles: ['game_admin'] });
    const ga2 = await user('HazineDort', { roles: ['game_admin'] });
    const p = await user('SilinenPilot', { pilot: true });
    const id = (await post(ga, '/admin/economy/grant', { playerId: p.pilotId, kind: 'currency', code: 'KREDI', amount: 3_000_000, reason: 'Ödül' })).json().approval.id;
    await ctx.rt.db.query('DELETE FROM players WHERE id = $1', [p.pilotId]);
    const r = await post(ga2, `/admin/approvals/${id}/review`, { approve: true });
    expect(r.json().approval.status).toBe('failed');
    expect((await auditActions('approval.approve')).map((a) => a.result)).toEqual(['failure']);
  });
});

// ================================================================== roller, bakım, pano, şikâyet, denetim
describe('roller, bakım modu, pano, şikâyet ve denetim kaydı', () => {
  it('rol atama rütbe kuralına uyar; Süper Yönetici ataması onay ister; son Süper Yönetici kaldırılamaz', async () => {
    const ga = await user('RolVeren', { roles: ['game_admin'] });
    const s1 = await user('UstKomuta', { roles: ['super_admin'] });
    const s2 = await user('UstKomutaIki', { roles: ['super_admin'] });
    const p = await user('TerfiPilot');
    // game_admin'in roles.assign yetkisi yok
    expect((await post(ga, `/admin/players/${p.id}/roles`, { role: 'moderator', grant: true, reason: 'Terfi' })).statusCode).toBe(403);
    let r = await post(s1, `/admin/players/${p.id}/roles`, { role: 'moderator', grant: true, reason: 'Gönüllü moderatör' });
    expect(r.json()).toEqual({ status: 'applied', roles: ['moderator', 'player'] });
    expect((await get(p, '/auth/me')).json().permissions).toContain('forum.moderate');
    expect((await post(s1, `/admin/players/${p.id}/roles`, { role: 'moderator', grant: true, reason: 'tekrar' })).json().error.code).toBe('NO_CHANGES');
    expect((await post(s1, `/admin/players/${s1.id}/roles`, { role: 'game_admin', grant: true, reason: 'kendime' })).json().error.code).toBe('ROLE_RANK');
    // Süper Yönetici: onay talebi → diğer süper yönetici onaylar
    r = await post(s1, `/admin/players/${p.id}/roles`, { role: 'super_admin', grant: true, reason: 'Kurucu ekip' });
    expect(r.json().status).toBe('pending_approval');
    const id = r.json().approval.id;
    expect((await post(s1, `/admin/approvals/${id}/review`, { approve: true })).json().error.code).toBe('APPROVAL_SELF');
    expect((await post(s2, `/admin/approvals/${id}/review`, { approve: true })).json().approval.status).toBe('executed');
    expect((await ctx.rt.db.query(`SELECT count(*)::int AS n FROM user_roles WHERE role_key = 'super_admin'`)).rows[0].n).toBe(3);
    // Kaldırma; son süper yönetici kuralı
    await post(s1, `/admin/players/${p.id}/roles`, { role: 'super_admin', grant: false, reason: 'Görev değişimi' });
    await post(s1, `/admin/players/${s2.id}/roles`, { role: 'super_admin', grant: false, reason: 'Görev değişimi' });
    const s3 = await user('UstKomutaUc', { roles: ['game_admin'] });
    expect((await post(s1, `/admin/players/${s3.id}/roles`, { role: 'game_admin', grant: false, reason: 'Görev değişimi' })).json().roles).toEqual(['player']);
    const roles = (await get(s1, '/admin/roles')).json().roles as Array<{ key: string; members: number; permissions: string[] }>;
    expect(roles.find((x) => x.key === 'super_admin')).toMatchObject({ members: 1 });
    expect(roles.find((x) => x.key === 'moderator')!.permissions).toContain('players.ban');
    expect((await auditActions('role.')).map((a) => a.action)).toEqual(['role.grant', 'role.grant', 'role.revoke', 'role.revoke', 'role.revoke']);
  });

  it('bakım modu: oyuncu oyuna giremez (bilet 503), personel girer; kapatınca açılır; duyuru denetime yazılır', async () => {
    const sys = await user('BakimSorumlusu', { roles: ['system_admin'] });
    const p = await user('BekleyenPilot', { pilot: true });
    const staffPilot = await user('NobetPilot', { roles: ['moderator'], pilot: true });
    expect((await post(p, '/game/ticket', { serverCode: 'TR1' })).statusCode).toBe(200);
    let r = await post(sys, '/admin/system/maintenance', { enabled: true, message: 'Güncelleme kuruluyor, 20 dk sonra dönüyoruz.', reason: 'Sürüm 1.4' });
    expect(r.json().maintenance.enabled).toBe(true);
    r = await post(p, '/game/ticket', { serverCode: 'TR1' });
    expect(r.statusCode).toBe(503);
    expect(r.json().error).toEqual({ code: 'MAINTENANCE', message: 'Güncelleme kuruluyor, 20 dk sonra dönüyoruz.' });
    expect((await post(staffPilot, '/game/ticket', { serverCode: 'TR1' })).statusCode).toBe(200);
    // Site açık: forum okunur
    expect((await get(p, '/forum/categories')).statusCode).toBe(200);
    await post(sys, '/admin/system/maintenance', { enabled: false, message: 'Bakım bitti.', reason: 'Tamamlandı' });
    expect((await post(p, '/game/ticket', { serverCode: 'TR1' })).statusCode).toBe(200);
    expect((await post(sys, '/admin/system/broadcast', { text: 'Hafta sonu çift deneyim!', reason: 'Etkinlik' })).json()).toMatchObject({ sent: true });
    expect((await auditActions('system.')).map((a) => a.action)).toEqual(['system.maintenance.on', 'system.maintenance.off', 'system.broadcast']);
    const sysState = (await get(sys, '/admin/system')).json();
    expect(sysState).toMatchObject({ maintenance: { enabled: false } });
    expect(sysState.api.dbMs).toBeGreaterThanOrEqual(0);
  });

  it('pano sayıları gerçek veriden; şikâyet kuyruğundan yaptırım ve karar; denetim kaydı süzülür', async () => {
    const mod = await user('KuyrukBakan', { roles: ['moderator'] });
    const reporter = await user('SikayetEden', { pilot: true });
    const target = await user('SikayetEdilen', { pilot: true });
    await ctx.rt.db.query(
      `INSERT INTO reports (reporter_user_id, reporter_player_id, target_type, target_id, target_player_id, reason, snapshot)
       VALUES ($1, $2, 'player', $3, $4, 'insult', '{"name":"SikayetEdilen"}')`,
      [reporter.id, reporter.pilotId, target.pilotId, target.pilotId],
    );
    const dash = (await get(mod, '/admin/dashboard')).json();
    expect(dash.players).toMatchObject({ total: 3, pilots: 2, registeredToday: 3 });
    expect(dash.queues).toMatchObject({ openReports: 1, openTickets: 0, pendingApprovals: 0 });
    expect(dash.recentAudit).toBeNull(); // moderatörün audit.read yetkisi yok
    expect(dash.maps.find((m: { code: string }) => m.code === 'K-1')).toMatchObject({ online: 0 });
    const reports = (await get(mod, '/admin/reports')).json().reports;
    expect(reports[0]).toMatchObject({ targetType: 'player', reason: 'insult', reporter: 'SikayetEden', target: { username: 'SikayetEdilen', pilot: 'SikayetEdilen' } });
    // Şikâyetten uyarı → şikâyet "işlem yapıldı"
    await post(mod, `/admin/players/${target.id}/warn`, { reason: 'Hakaret şikâyeti', reportId: reports[0].id });
    expect((await get(mod, '/admin/reports?status=actioned')).json().reports[0]).toMatchObject({ id: reports[0].id, handledBy: 'KuyrukBakan' });
    expect((await post(mod, `/admin/reports/${reports[0].id}/resolve`, { status: 'dismissed' })).statusCode).toBe(409);
    // Denetim: yalnızca audit.read
    const top = await user('DenetimOkur', { roles: ['read_only'] });
    const a = (await get(top, '/admin/audit?action=player.')).json();
    expect(a.entries.map((e: { action: string; actor: string; targetId: string }) => [e.action, e.actor, e.targetId])).toEqual([['player.warning', 'KuyrukBakan', target.id]]);
    expect((await get(top, `/admin/audit?targetId=${target.id}&actor=kuyruk`)).json().entries).toHaveLength(1);
    // Salt okunur rol hiçbir değişiklik yapamaz
    expect((await post(top, `/admin/players/${target.id}/warn`, { reason: 'deneme' })).statusCode).toBe(403);
  });
});
