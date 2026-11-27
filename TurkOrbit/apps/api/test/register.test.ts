import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { call, createTestContext, newClient, resetDatabase, STRONG_PASSWORD, tokenFromMail, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => ctx.close());
beforeEach(async () => {
  await resetDatabase(ctx.rt);
  ctx.mailer.clear();
});

const body = (over: Record<string, unknown> = {}) => ({
  username: 'KozmikKartal',
  email: 'kozmik@ornek.com',
  password: STRONG_PASSWORD,
  acceptTerms: true,
  ...over,
});

describe('POST /auth/register', () => {
  it('hesabı oluşturur, parolayı Argon2id ile saklar ve doğrulama e-postası gönderir', async () => {
    const res = await call(ctx.app, newClient(), 'POST', '/auth/register', body());
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe('pending_verification');

    const { rows } = await ctx.rt.db.query(
      `SELECT username::text, email::text, password_hash, email_verified_at, terms_version, public_id FROM users`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].password_hash).toMatch(/^\$argon2id\$v=19\$/);
    expect(rows[0].password_hash).not.toContain(STRONG_PASSWORD);
    expect(rows[0].email_verified_at).toBeNull();
    expect(rows[0].terms_version).toBe('2026-11');
    expect(Number(rows[0].public_id)).toBeGreaterThanOrEqual(100001);

    const mail = ctx.mailer.lastTo('kozmik@ornek.com');
    expect(mail?.subject).toContain('doğrula');
    expect(mail?.text).toContain('http://localhost:5173/eposta-dogrula?token=');
  });

  it('yeni hesaba yalnızca "player" rolü verilir', async () => {
    await call(ctx.app, newClient(), 'POST', '/auth/register', body());
    const { rows } = await ctx.rt.db.query(`SELECT role_key FROM user_roles`);
    expect(rows.map((r) => r.role_key)).toEqual(['player']);
  });

  it('istemci rol/yetki alanı göndererek kendini yönetici yapamaz', async () => {
    for (const extra of [{ role: 'super_admin' }, { roles: ['super_admin'] }, { isAdmin: true }]) {
      const res = await call(ctx.app, newClient(), 'POST', '/auth/register', body(extra));
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    }
    const { rows } = await ctx.rt.db.query('SELECT count(*)::int AS n FROM users');
    expect(rows[0].n).toBe(0);
  });

  it('zayıf parolayı alan bazlı Türkçe hatayla reddeder', async () => {
    const res = await call(ctx.app, newClient(), 'POST', '/auth/register', body({ password: 'galatasaray' }));
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('WEAK_PASSWORD');
    expect(res.json().error.fields.password.join(' ')).toMatch(/yaygın/);
  });

  it('alınmış kullanıcı adını (büyük/küçük harf duyarsız) reddeder', async () => {
    await call(ctx.app, newClient(), 'POST', '/auth/register', body());
    const res = await call(ctx.app, newClient(), 'POST', '/auth/register', body({
      username: 'kozmikkartal',
      email: 'baska@ornek.com',
    }));
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('USERNAME_TAKEN');
  });

  it('kayıtlı e-posta ile kayıtta aynı yanıtı döner (hesap varlığı sızdırmaz) ve sahibine bilgi verir', async () => {
    await call(ctx.app, newClient(), 'POST', '/auth/register', body());
    ctx.mailer.clear();
    const res = await call(ctx.app, newClient(), 'POST', '/auth/register', body({
      username: 'BaskaPilot',
      email: 'KOZMIK@ornek.com',
    }));
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe('pending_verification');
    const { rows } = await ctx.rt.db.query('SELECT count(*)::int AS n FROM users');
    expect(rows[0].n).toBe(1);
    expect(ctx.mailer.lastTo('kozmik@ornek.com')?.subject).toContain('zaten bir hesabın var');
  });

  it('rezerve/taklit kullanıcı adlarını reddeder', async () => {
    const res = await call(ctx.app, newClient(), 'POST', '/auth/register', body({ username: 'TurkOrbitAdmin' }));
    expect(res.statusCode).toBe(400);
    expect(res.json().error.fields.username).toBeDefined();
  });

  it('koşullar kabul edilmeden kayıt yapılamaz', async () => {
    const res = await call(ctx.app, newClient(), 'POST', '/auth/register', body({ acceptTerms: false }));
    expect(res.statusCode).toBe(400);
  });

  it('kayıtlar yönetici ayarıyla kapatılabilir', async () => {
    await ctx.rt.db.query(`UPDATE game_settings SET value = 'false'::jsonb WHERE key = 'registration.enabled'`);
    const res = await call(ctx.app, newClient(), 'POST', '/auth/register', body());
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('REGISTRATION_CLOSED');
  });
});

describe('POST /auth/verify-email', () => {
  it('bağlantıyla e-postayı doğrular; bağlantı ikinci kez kullanılamaz', async () => {
    const client = newClient();
    await call(ctx.app, client, 'POST', '/auth/register', body());
    const token = tokenFromMail(ctx.mailer, 'kozmik@ornek.com');

    const ok = await call(ctx.app, client, 'POST', '/auth/verify-email', { token });
    expect(ok.statusCode).toBe(200);
    const { rows } = await ctx.rt.db.query('SELECT email_verified_at FROM users');
    expect(rows[0].email_verified_at).not.toBeNull();

    const again = await call(ctx.app, client, 'POST', '/auth/verify-email', { token });
    expect(again.statusCode).toBe(400);
    expect(again.json().error.code).toBe('INVALID_TOKEN');
  });

  it('süresi dolmuş bağlantıyı reddeder', async () => {
    await call(ctx.app, newClient(), 'POST', '/auth/register', body());
    const token = tokenFromMail(ctx.mailer, 'kozmik@ornek.com');
    await ctx.rt.db.query(`UPDATE email_verification_tokens SET expires_at = now() - interval '1 minute'`);
    const res = await call(ctx.app, newClient(), 'POST', '/auth/verify-email', { token });
    expect(res.json().error.code).toBe('TOKEN_EXPIRED');
  });

  it('anahtar veritabanında düz metin değil SHA-256 özeti olarak saklanır', async () => {
    await call(ctx.app, newClient(), 'POST', '/auth/register', body());
    const token = tokenFromMail(ctx.mailer, 'kozmik@ornek.com');
    const { rows } = await ctx.rt.db.query(`SELECT encode(token_hash, 'escape') AS raw FROM email_verification_tokens`);
    expect(rows[0].raw).not.toContain(token);
  });

  it('yeniden gönderim eski bağlantıyı geçersiz kılar', async () => {
    const client = newClient();
    await call(ctx.app, client, 'POST', '/auth/register', body());
    const first = tokenFromMail(ctx.mailer, 'kozmik@ornek.com');
    const login = await call(ctx.app, client, 'POST', '/auth/login', {
      identifier: 'kozmik@ornek.com',
      password: STRONG_PASSWORD,
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().user.emailVerified).toBe(false);
    client.csrf = login.json().csrfToken;

    const resend = await call(ctx.app, client, 'POST', '/auth/resend-verification', {});
    expect(resend.json().status).toBe('sent');
    const second = tokenFromMail(ctx.mailer, 'kozmik@ornek.com');
    expect(second).not.toBe(first);

    expect((await call(ctx.app, client, 'POST', '/auth/verify-email', { token: first })).statusCode).toBe(400);
    expect((await call(ctx.app, client, 'POST', '/auth/verify-email', { token: second })).statusCode).toBe(200);
  });
});

describe('kayıt hız sınırı', () => {
  it('aynı IP saatte 5 kayıttan fazlasını yapamaz', async () => {
    const limited = await createTestContext({ registerPerIp: [5, 3600] });
    try {
      const client = newClient({ ip: '10.9.8.7' });
      for (let i = 0; i < 5; i++) {
        const r = await call(limited.app, client, 'POST', '/auth/register', body({
          username: `Pilot${i}x`,
          email: `p${i}@ornek.com`,
        }));
        expect(r.statusCode).toBe(201);
      }
      const r = await call(limited.app, client, 'POST', '/auth/register', body({ username: 'PilotSon', email: 's@ornek.com' }));
      expect(r.statusCode).toBe(429);
      expect(r.json().error.code).toBe('RATE_LIMITED');
      expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
    } finally {
      await limited.close();
    }
  });
});
