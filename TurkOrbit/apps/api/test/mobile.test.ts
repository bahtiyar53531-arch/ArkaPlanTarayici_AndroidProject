/**
 * Mobil uygulama (Aşama 15) entegrasyon testleri — GERÇEK PostgreSQL + Redis.
 * Uygulamanın sunucuyla konuştuğu yol: kök https://localhost (Android) / capacitor://localhost (iOS),
 * oturum anahtarı Authorization: Bearer, X-Client-Platform + X-Client-Version başlıkları.
 * (Bearer oturumu, oturum listesi ve uzaktan kapatma Aşama 1 testlerinde: sessions.test.ts)
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { call, createTestContext, newClient, registerAndLogin, resetDatabase, WEB_ORIGIN, type Client, type TestContext } from './helpers.js';

let ctx: TestContext;
const PASSWORD = 'Nebula-Kartal-77';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 16; Pixel 8 Build/BP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0 Mobile Safari/537.36';

beforeAll(async () => {
  ctx = await createTestContext({}, undefined);
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetDatabase(ctx.rt);
  ctx.clientGate.invalidate();
});

const app = (platform: 'android' | 'ios', version: string | null = '0.15.0', origin = platform === 'android' ? 'https://localhost' : 'capacitor://localhost') => ({
  origin,
  'x-client-platform': platform,
  ...(version ? { 'x-client-version': version } : {}),
});

let ipSeq = 1;
/** Web'de kayıt olup doğrulanmış hesap + aynı hesabın Android uygulamasından açılmış oturumu. */
async function mobileUser(username: string, o: { role?: string } = {}) {
  const { client: web } = await registerAndLogin(ctx, username, { client: newClient({ ip: `176.40.${ipSeq++ % 250}.3` }) });
  if (o.role) await ctx.rt.db.query(`INSERT INTO user_roles (user_id, role_key) SELECT id, $2 FROM users WHERE username = $1`, [username, o.role]);
  const phone = newClient({ ip: `176.41.${ipSeq++ % 250}.4`, userAgent: ANDROID_UA });
  const r = await call(ctx.app, phone, 'POST', '/auth/login', {
    identifier: username,
    password: PASSWORD,
    transport: 'token',
    device: { platform: 'android', name: 'Google Pixel 8', appVersion: '0.15.0' },
  }, app('android'));
  expect(r.statusCode, r.body).toBe(200);
  phone.bearer = r.json().sessionToken;
  return { web, phone, name: username };
}
const aget = (c: Client, url: string, h: Record<string, string> = app('android')) => call(ctx.app, c, 'GET', url, undefined, h);
const apost = (c: Client, url: string, body: unknown = {}, h: Record<string, string> = app('android')) => call(ctx.app, c, 'POST', url, body, h);

// ================================================================== oturum ve kök
describe('mobil oturum: Bearer anahtarı, uygulama kökleri, CSRF', () => {
  it('uygulama girişinde çerez verilmez, anahtar yanıtta döner; oturum Android/cihaz adı/sürümüyle kaydedilir', async () => {
    const { web, phone } = await mobileUser('MobilPilot');
    expect(phone.cookie).toBeNull();
    expect(phone.bearer).toMatch(/^[A-Za-z0-9_-]{30,}$/);
    const me = await aget(phone, '/auth/me');
    expect(me.statusCode).toBe(200);
    expect(me.json().session.platform).toBe('android');
    const sessions = (await call(ctx.app, web, 'GET', '/auth/sessions')).json().sessions as Array<{ platform: string; deviceName: string; appVersion: string | null }>;
    const android = sessions.find((s) => s.platform === 'android')!;
    expect(android.deviceName).toBe('Google Pixel 8');
    const row = (await ctx.rt.db.query(`SELECT transport, app_version FROM sessions WHERE platform = 'android'`)).rows[0];
    expect(row).toEqual({ transport: 'token', app_version: '0.15.0' });
  });

  it('Bearer ile durum değiştiren istek CSRF anahtarı istemez; yabancı kökten gelen istek reddedilir', async () => {
    const { phone } = await mobileUser('CsrfsizPilot');
    const created = await apost(phone, '/players', { serverCode: 'TR1', companyCode: 'KZL' });
    expect(created.statusCode, created.body).toBe(201);
    const evil = await apost(phone, '/auth/logout', {}, { ...app('android'), origin: 'https://kotu-site.example' });
    expect(evil.statusCode).toBe(403);
    expect(evil.json().error.code).toBe('ORIGIN_NOT_ALLOWED');
    expect((await aget(phone, '/auth/me')).statusCode).toBe(200);
  });

  it('CORS ön kontrolü: https://localhost ve capacitor://localhost izinli (Authorization başlığıyla), yabancı kök izinsiz', async () => {
    const pre = (origin: string) =>
      ctx.app.inject({
        method: 'OPTIONS',
        url: '/api/v1/auth/me',
        headers: { origin, 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization,x-client-platform,x-client-version' },
      });
    for (const origin of ['https://localhost', 'capacitor://localhost']) {
      const r = await pre(origin);
      expect(r.statusCode).toBe(204);
      expect(r.headers['access-control-allow-origin']).toBe(origin);
      expect(String(r.headers['access-control-allow-headers']).toLowerCase()).toContain('authorization');
      expect(String(r.headers['access-control-allow-headers']).toLowerCase()).toContain('x-client-version');
    }
    expect((await pre('https://kotu-site.example')).headers['access-control-allow-origin']).toBeUndefined();
  });

  it('oyun bileti Bearer ile alınır (uygulama aynı oyun sunucusuna bağlanır)', async () => {
    const { phone } = await mobileUser('BiletPilot');
    await apost(phone, '/players', { serverCode: 'TR1', companyCode: 'KZL' });
    const t = await apost(phone, '/game/ticket', { serverCode: 'TR1' });
    expect(t.statusCode, t.body).toBe(200);
    expect(t.json().ticket).toBeTruthy();
  });

  it('başka cihazdan (web) kapatılan uygulama oturumu anında geçersiz olur', async () => {
    const { web, phone } = await mobileUser('UzaktanPilot');
    const sessions = (await call(ctx.app, web, 'GET', '/auth/sessions')).json().sessions as Array<{ id: string; platform: string }>;
    const id = sessions.find((s) => s.platform === 'android')!.id;
    expect((await call(ctx.app, web, 'DELETE', `/auth/sessions/${id}`)).statusCode).toBe(200);
    const me = await aget(phone, '/auth/me');
    expect(me.statusCode).toBe(401);
  });
});

// ================================================================== sürüm kapısı
describe('istemci sürüm kapısı (426 CLIENT_OUTDATED)', () => {
  it('eski Android sürümü 426 alır (mağaza bilgisiyle, CORS başlığıyla); güncel/yeni sürüm, web ve durum ucu etkilenmez', async () => {
    const anon = newClient({ userAgent: ANDROID_UA });
    const old = await aget(anon, '/auth/me', app('android', '0.14.9'));
    expect(old.statusCode).toBe(426);
    expect(old.json().error).toMatchObject({ code: 'CLIENT_OUTDATED', minVersion: '0.15.0', storeUrl: null });
    expect(old.json().error.message).toContain('güncelle');
    expect(old.headers['access-control-allow-origin']).toBe('https://localhost');
    // Sürüm başlığı olmayan uygulama isteği de eski kabul edilir
    expect((await aget(anon, '/auth/me', app('android', null))).statusCode).toBe(426);
    // Güncel ve daha yeni sürüm kapıdan geçer (oturum yok → 401)
    expect((await aget(anon, '/auth/me', app('android', '0.15.0'))).statusCode).toBe(401);
    expect((await aget(anon, '/auth/me', app('ios', '1.2.0'))).statusCode).toBe(401);
    expect((await aget(anon, '/auth/me', app('android', '0.15.10'))).statusCode).toBe(401);
    // Web ve masaüstü sürüm kapısına tabi değil
    expect((await aget(anon, '/auth/me', { origin: WEB_ORIGIN, 'x-client-platform': 'web', 'x-client-version': '0.0.1' })).statusCode).toBe(401);
    expect((await aget(anon, '/auth/me', { origin: WEB_ORIGIN })).statusCode).toBe(401);
    // Yük dengeleyicinin durum ucu kapının dışında
    expect((await aget(anon, '/health', app('android', '0.0.1'))).statusCode).toBe(200);
  });

  it('Yönetim Merkezi\'nden en düşük sürüm yayımlanınca anında geçerli olur; geri alınca eski haline döner; biçim denetlenir', async () => {
    const { client: sys } = await registerAndLogin(ctx, 'SurumBakici', { client: newClient({ ip: '31.1.1.1' }) });
    await ctx.rt.db.query(`INSERT INTO user_roles (user_id, role_key) SELECT id, 'system_admin' FROM users WHERE username = 'SurumBakici'`);
    const { phone } = await mobileUser('GuncelPilot');
    expect((await aget(phone, '/auth/me')).statusCode).toBe(200);

    // Biçim: sürüm "1.2.3", mağaza bağlantısı https
    let r = await call(ctx.app, sys, 'POST', '/admin/content/setting/client/drafts', { changes: { 'value.min_version.android': '0.16' } });
    expect(r.statusCode).toBe(400);
    expect(JSON.stringify(r.json().error.fields)).toContain('1.2.3');
    r = await call(ctx.app, sys, 'POST', '/admin/content/setting/client/drafts', { changes: { 'value.store_url.android': 'http://play.example/app' } });
    expect(r.statusCode).toBe(400);

    r = await call(ctx.app, sys, 'POST', '/admin/content/setting/client/drafts', {
      changes: { 'value.min_version.android': '0.16.0', 'value.store_url.android': 'https://play.google.com/store/apps/details?id=com.turkorbit.oyun' },
      note: 'Protokol değişti',
    });
    expect(r.statusCode, r.body).toBe(200);
    const draftId = r.json().content.draft.id;
    // Taslak henüz uygulanmaz
    expect((await aget(phone, '/auth/me')).statusCode).toBe(200);
    expect((await call(ctx.app, sys, 'POST', `/admin/content/setting/revisions/${draftId}/publish`)).statusCode).toBe(200);

    const blocked = await aget(phone, '/auth/me');
    expect(blocked.statusCode).toBe(426);
    expect(blocked.json().error).toMatchObject({ minVersion: '0.16.0', storeUrl: 'https://play.google.com/store/apps/details?id=com.turkorbit.oyun' });
    // iOS ayrı ayarlanır: değişmedi
    expect((await aget(phone, '/auth/me', app('ios', '0.15.0'))).statusCode).toBe(200);
    // Web oturumu etkilenmez
    expect((await call(ctx.app, sys, 'GET', '/auth/me')).statusCode).toBe(200);

    const v1 = (await call(ctx.app, sys, 'GET', '/admin/content/setting/client')).json().content.revisions.find((v: { version: number }) => v.version === 1).id;
    expect((await call(ctx.app, sys, 'POST', `/admin/content/setting/revisions/${v1}/rollback`, { reason: 'Geri al' })).statusCode).toBe(200);
    expect((await aget(phone, '/auth/me')).statusCode).toBe(200);
    const audit = (await ctx.rt.db.query(`SELECT action FROM admin_audit_log WHERE target_id = 'client' ORDER BY id`)).rows.map((x) => x.action);
    expect(audit).toEqual(['content.draft', 'content.publish', 'content.rollback']);
  });
});

// ================================================================== tek kullanımlık ek bağlantısı
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(120, 3)]);

async function ticketWithAttachment(phone: Client) {
  const t = await apost(phone, '/support/tickets', { category: 'account', subject: 'Uygulamadan yazıyorum', body: 'Telefondan ekran görüntüsü ekledim, bakar mısınız?' });
  expect(t.statusCode, t.body).toBe(201);
  const no = t.json().ticket.ticketNo as string;
  const mid = t.json().ticket.messages[0].id as number;
  const up = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/support/tickets/${no}/messages/${mid}/attachments`,
    headers: { ...app('android'), authorization: `Bearer ${phone.bearer}`, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent('ekran görüntüsü.png'), 'user-agent': ANDROID_UA },
    payload: PNG,
  });
  expect(up.statusCode, up.body).toBe(201);
  const att = (await aget(phone, `/support/tickets/${no}`)).json().ticket.messages[0].attachments[0] as { id: number };
  return { no, attachmentId: att.id };
}
const fetchPath = (path: string) => ctx.app.inject({ method: 'GET', url: `/api/v1${path}`, headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 16) Chrome/141.0 Mobile' } });

describe('destek eki: mobilde tek kullanımlık indirme bağlantısı', () => {
  it('sahibi bağlantı alır; bağlantı oturumsuz bir kez çalışır, ikinci kullanımda 410; başkası bağlantı alamaz; personel alabilir', async () => {
    const { phone } = await mobileUser('EkSahibi');
    const { phone: other } = await mobileUser('MeplakPilot');
    const { phone: staff } = await mobileUser('MasaCalisani', { role: 'support_staff' });
    const { attachmentId } = await ticketWithAttachment(phone);

    const link = await apost(phone, `/support/attachments/${attachmentId}/link`);
    expect(link.statusCode, link.body).toBe(200);
    expect(link.json().expiresInSeconds).toBe(60);
    const path = link.json().path as string;
    expect(path).toMatch(new RegExp(`^/support/attachments/${attachmentId}\\?dl=[A-Za-z0-9_-]{40,}$`));

    const first = await fetchPath(path);
    expect(first.statusCode).toBe(200);
    expect(first.rawPayload.equals(PNG)).toBe(true);
    expect(first.headers['content-disposition']).toContain('attachment;');
    expect(first.headers['cache-control']).toBe('private, no-store');
    const second = await fetchPath(path);
    expect(second.statusCode).toBe(410);
    expect(second.json().error.code).toBe('LINK_INVALID');

    // Başkasının eki: bağlantı üretilemez (var olduğu bile söylenmez)
    expect((await apost(other, `/support/attachments/${attachmentId}/link`)).statusCode).toBe(404);
    // Destek personeli üretebilir
    expect((await apost(staff, `/support/attachments/${attachmentId}/link`)).statusCode).toBe(200);
    // Bağlantısız ve oturumsuz indirme yok
    expect((await fetchPath(`/support/attachments/${attachmentId}`)).statusCode).toBe(401);
    // Uydurma anahtar
    expect((await fetchPath(`/support/attachments/${attachmentId}?dl=${'A'.repeat(43)}`)).statusCode).toBe(410);
  });

  it('bağlantı yalnızca üretildiği eke geçerlidir', async () => {
    const { phone } = await mobileUser('IkiEkliPilot');
    const a = await ticketWithAttachment(phone);
    const link = (await apost(phone, `/support/attachments/${a.attachmentId}/link`)).json().path as string;
    const token = link.split('dl=')[1]!;
    const otherId = a.attachmentId + 1000;
    expect((await fetchPath(`/support/attachments/${otherId}?dl=${token}`)).statusCode).toBe(410);
    // Yanlış eke denenen anahtar tüketildi: doğru ekte de artık çalışmaz
    expect((await fetchPath(link)).statusCode).toBe(410);
  });
});

describe('destek eki bağlantısı: süre dolumu', () => {
  it('60 sn (testte 1 sn) sonra bağlantı geçersiz', async () => {
    const short = await createTestContext({}, undefined, { attachmentLinkTtlSeconds: 1 });
    try {
      const { client: web } = await registerAndLogin(short, 'SureliPilot', { client: newClient({ ip: '176.50.1.1' }) });
      const t = await call(short.app, web, 'POST', '/support/tickets', { category: 'account', subject: 'Süre testi', body: 'Bağlantının süresi dolunca çalışmamalı.' });
      const no = t.json().ticket.ticketNo as string;
      const mid = t.json().ticket.messages[0].id as number;
      await short.app.inject({
        method: 'POST',
        url: `/api/v1/support/tickets/${no}/messages/${mid}/attachments`,
        headers: { origin: WEB_ORIGIN, cookie: web.cookie!, 'x-csrf-token': web.csrf!, 'content-type': 'application/octet-stream', 'x-file-name': 'a.png' },
        payload: PNG,
      });
      const id = (await call(short.app, web, 'GET', `/support/tickets/${no}`)).json().ticket.messages[0].attachments[0].id as number;
      const path = (await call(short.app, web, 'POST', `/support/attachments/${id}/link`)).json().path as string;
      await new Promise((r) => setTimeout(r, 1300));
      expect((await short.app.inject({ method: 'GET', url: `/api/v1${path}` })).statusCode).toBe(410);
    } finally {
      await short.close();
    }
  });
});
