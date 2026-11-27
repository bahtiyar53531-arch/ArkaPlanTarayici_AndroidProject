import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  call,
  createTestContext,
  newClient,
  registerAndLogin,
  resetDatabase,
  STRONG_PASSWORD,
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

describe('oturum ve CSRF', () => {
  it('/auth/me oturumsuz 401, oturumla kullanıcıyı döner', async () => {
    expect((await call(ctx.app, newClient(), 'GET', '/auth/me')).statusCode).toBe(401);
    const { client } = await registerAndLogin(ctx, 'OturumPilot');
    const me = await call(ctx.app, client, 'GET', '/auth/me');
    expect(me.statusCode).toBe(200);
    expect(me.json().user).toMatchObject({ username: 'OturumPilot', emailVerified: true, roles: ['player'] });
    expect(me.json().user.playerId).toBeGreaterThanOrEqual(100001);
  });

  it('çerez oturumunda CSRF anahtarı olmadan durum değiştiren istek reddedilir', async () => {
    const { client } = await registerAndLogin(ctx, 'CsrfPilot');
    const noCsrf = { ...client, csrf: null };
    const r = await call(ctx.app, noCsrf, 'POST', '/auth/logout', {});
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe('CSRF_FAILED');
    const wrong = await call(ctx.app, { ...client, csrf: 'sahte-anahtar' }, 'POST', '/auth/logout', {});
    expect(wrong.statusCode).toBe(403);
    // Oturum hâlâ açık
    expect((await call(ctx.app, client, 'GET', '/auth/me')).statusCode).toBe(200);
  });

  it('çıkış oturumu sunucuda iptal eder; eski çerez tekrar kullanılamaz', async () => {
    const { client } = await registerAndLogin(ctx, 'CikisPilot');
    const oldCookie = client.cookie;
    const out = await call(ctx.app, client, 'POST', '/auth/logout', {});
    expect(out.statusCode).toBe(200);
    const replay = await call(ctx.app, { ...newClient(), cookie: oldCookie }, 'GET', '/auth/me');
    expect(replay.statusCode).toBe(401);
    const { rows } = await ctx.rt.db.query(`SELECT revoked_reason FROM sessions`);
    expect(rows[0].revoked_reason).toBe('logout');
  });

  it('uygulama anahtarı çerez olarak, çerez anahtarı Bearer olarak kullanılamaz', async () => {
    await registerAndLogin(ctx, 'KarisikPilot');
    const app = await call(ctx.app, newClient(), 'POST', '/auth/login', {
      identifier: 'KarisikPilot',
      password: STRONG_PASSWORD,
      transport: 'token',
      device: { platform: 'ios' },
    });
    const token = app.json().sessionToken as string;
    expect((await call(ctx.app, newClient({ cookie: `to_sid=${token}` }), 'GET', '/auth/me')).statusCode).toBe(401);

    const web = newClient();
    await call(ctx.app, web, 'POST', '/auth/login', { identifier: 'KarisikPilot', password: STRONG_PASSWORD });
    const cookieToken = web.cookie!.split('=')[1]!;
    expect((await call(ctx.app, newClient({ bearer: cookieToken }), 'GET', '/auth/me')).statusCode).toBe(401);
  });

  it('süresi dolmuş ve uzun süre kullanılmamış (idle) oturumlar reddedilir', async () => {
    const { client } = await registerAndLogin(ctx, 'SureliPilot');
    await ctx.rt.redis!.flushdb();
    await ctx.rt.db.query(`UPDATE sessions SET last_seen_at = now() - interval '8 days'`);
    expect((await call(ctx.app, client, 'GET', '/auth/me')).statusCode).toBe(401);
    const { rows } = await ctx.rt.db.query(`SELECT revoked_reason FROM sessions`);
    expect(rows[0].revoked_reason).toBe('idle_timeout');

    const second = await registerAndLogin(ctx, 'SureliPilot2');
    await ctx.rt.redis!.flushdb();
    await ctx.rt.db.query(`UPDATE sessions SET expires_at = now() - interval '1 second' WHERE revoked_at IS NULL`);
    expect((await call(ctx.app, second.client, 'GET', '/auth/me')).statusCode).toBe(401);
  });

  it('oturum anahtarı veritabanında yalnızca SHA-256 özeti olarak tutulur ve önbellekte parola özeti yoktur', async () => {
    const { client } = await registerAndLogin(ctx, 'OzetPilot');
    await call(ctx.app, client, 'GET', '/auth/me');
    const token = client.cookie!.split('=')[1]!;
    const { rows } = await ctx.rt.db.query(`SELECT encode(token_hash,'hex') AS h FROM sessions`);
    expect(rows[0].h).toHaveLength(64);
    expect(rows[0].h).not.toContain(Buffer.from(token).toString('hex'));
    const keys = await ctx.rt.redis!.keys('to:sess:*');
    expect(keys.length).toBeGreaterThan(0);
    const cached = await ctx.rt.redis!.get(keys[0]!);
    expect(cached).not.toMatch(/\$argon2id/);
  });
});

describe('çoklu cihaz ve aktif oturum yönetimi', () => {
  it('birden fazla cihazdan giriş yapılabilir; oturumlar listelenir ve tek tek kapatılabilir', async () => {
    const { client: pc } = await registerAndLogin(ctx, 'CokluPilot');
    const phone = newClient({ ip: '85.105.10.30' });
    const p = await call(ctx.app, phone, 'POST', '/auth/login', {
      identifier: 'CokluPilot',
      password: STRONG_PASSWORD,
      transport: 'token',
      device: { platform: 'android', name: 'Galaxy Tab S9' },
    });
    phone.bearer = p.json().sessionToken;

    const list = await call(ctx.app, pc, 'GET', '/auth/sessions');
    const sessions = list.json().sessions;
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    const androidSession = sessions.find((s: { platform: string }) => s.platform === 'android');
    expect(androidSession.deviceName).toBe('Galaxy Tab S9');
    expect(androidSession.ipMasked).toBe('85.105.*.*');

    // PC'den telefon oturumunu kapat → telefon anında düşer
    const del = await call(ctx.app, pc, 'DELETE', `/auth/sessions/${androidSession.id}`);
    expect(del.statusCode).toBe(200);
    expect(del.json().current).toBe(false);
    expect((await call(ctx.app, phone, 'GET', '/auth/me')).statusCode).toBe(401);
    expect((await call(ctx.app, pc, 'GET', '/auth/me')).statusCode).toBe(200);
  });

  it('başka kullanıcının oturumu kapatılamaz', async () => {
    const a = await registerAndLogin(ctx, 'PilotAlfa');
    const b = await registerAndLogin(ctx, 'PilotBeta', { client: newClient({ ip: '85.105.11.1' }) });
    const bSessions = (await call(ctx.app, b.client, 'GET', '/auth/sessions')).json().sessions;
    const r = await call(ctx.app, a.client, 'DELETE', `/auth/sessions/${bSessions[0].id}`);
    expect(r.statusCode).toBe(404);
    expect((await call(ctx.app, b.client, 'GET', '/auth/me')).statusCode).toBe(200);
  });

  it('"diğer tüm oturumları kapat" mevcut oturum hariç hepsini kapatır', async () => {
    const { client } = await registerAndLogin(ctx, 'TemizlikPilot');
    const others = [newClient(), newClient()];
    for (const o of others) {
      await call(ctx.app, o, 'POST', '/auth/login', { identifier: 'TemizlikPilot', password: STRONG_PASSWORD });
    }
    const r = await call(ctx.app, client, 'POST', '/auth/sessions/revoke-others', {});
    expect(r.json().revoked).toBe(2);
    for (const o of others) expect((await call(ctx.app, o, 'GET', '/auth/me')).statusCode).toBe(401);
    expect((await call(ctx.app, client, 'GET', '/auth/me')).statusCode).toBe(200);
  });
});
