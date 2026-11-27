import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  call,
  createTestContext,
  newClient,
  registerAndLogin,
  resetDatabase,
  STRONG_PASSWORD,
  tokenFromMail,
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

const NEW_PASSWORD = 'Galaksi_Yolcusu_2026';

describe('parola sıfırlama', () => {
  it('kayıtlı ve kayıtsız e-posta için aynı yanıtı verir; yalnızca kayıtlıya e-posta gider', async () => {
    const { email } = await registerAndLogin(ctx, 'SifrePilot');
    ctx.mailer.clear();
    const known = await call(ctx.app, newClient(), 'POST', '/auth/password/forgot', { email });
    const unknown = await call(ctx.app, newClient(), 'POST', '/auth/password/forgot', { email: 'yok@ornek.com' });
    expect(known.statusCode).toBe(202);
    expect(unknown.statusCode).toBe(202);
    expect(known.json()).toEqual(unknown.json());
    expect(ctx.mailer.outbox).toHaveLength(1);
    expect(ctx.mailer.outbox[0]!.to).toBe(email);
  });

  it('sıfırlama bağlantısı parolayı değiştirir, tüm oturumları kapatır ve tek kullanımlıktır', async () => {
    const { client, email } = await registerAndLogin(ctx, 'SifrePilot');
    await call(ctx.app, newClient(), 'POST', '/auth/password/forgot', { email });
    const token = tokenFromMail(ctx.mailer, email);

    const weak = await call(ctx.app, newClient(), 'POST', '/auth/password/reset', { token, newPassword: 'sifrepilot123' });
    expect(weak.statusCode).toBe(400);
    expect(weak.json().error.code).toBe('WEAK_PASSWORD');

    const ok = await call(ctx.app, newClient(), 'POST', '/auth/password/reset', { token, newPassword: NEW_PASSWORD });
    expect(ok.statusCode).toBe(200);
    expect((await call(ctx.app, client, 'GET', '/auth/me')).statusCode).toBe(401);
    expect(ctx.mailer.lastTo(email)?.subject).toContain('Parolan değiştirildi');

    const reuse = await call(ctx.app, newClient(), 'POST', '/auth/password/reset', { token, newPassword: 'Baska-Bir-Parola-99' });
    expect(reuse.json().error.code).toBe('INVALID_TOKEN');

    const oldLogin = await call(ctx.app, newClient(), 'POST', '/auth/login', { identifier: 'SifrePilot', password: STRONG_PASSWORD });
    expect(oldLogin.statusCode).toBe(401);
    const newLogin = await call(ctx.app, newClient(), 'POST', '/auth/login', { identifier: 'SifrePilot', password: NEW_PASSWORD });
    expect(newLogin.statusCode).toBe(200);
  });

  it('süresi dolmuş sıfırlama bağlantısı reddedilir; yeni istek eskisini geçersiz kılar', async () => {
    const { email } = await registerAndLogin(ctx, 'SifrePilot');
    await call(ctx.app, newClient(), 'POST', '/auth/password/forgot', { email });
    const first = tokenFromMail(ctx.mailer, email);
    await call(ctx.app, newClient(), 'POST', '/auth/password/forgot', { email });
    const second = tokenFromMail(ctx.mailer, email);
    expect(
      (await call(ctx.app, newClient(), 'POST', '/auth/password/reset', { token: first, newPassword: NEW_PASSWORD })).json()
        .error.code,
    ).toBe('INVALID_TOKEN');
    await ctx.rt.db.query(`UPDATE password_reset_tokens SET expires_at = now() - interval '1 minute' WHERE used_at IS NULL`);
    expect(
      (await call(ctx.app, newClient(), 'POST', '/auth/password/reset', { token: second, newPassword: NEW_PASSWORD })).json()
        .error.code,
    ).toBe('TOKEN_EXPIRED');
  });

  it('e-posta başına sıfırlama e-postası saatte 3 ile sınırlıdır (yanıt yine aynıdır)', async () => {
    const { email } = await registerAndLogin(ctx, 'SifrePilot');
    ctx.mailer.clear();
    for (let i = 0; i < 5; i++) {
      const r = await call(ctx.app, newClient(), 'POST', '/auth/password/forgot', { email });
      expect(r.statusCode).toBe(202);
    }
    expect(ctx.mailer.outbox).toHaveLength(3);
  });

  it('sıfırlama başarısız giriş kilidini kaldırır', async () => {
    const { email } = await registerAndLogin(ctx, 'KilitAcma');
    for (let i = 0; i < 5; i++) {
      await call(ctx.app, newClient(), 'POST', '/auth/login', { identifier: 'KilitAcma', password: 'yanlis-yanlis-1' });
    }
    await call(ctx.app, newClient(), 'POST', '/auth/password/forgot', { email });
    const token = tokenFromMail(ctx.mailer, email);
    await call(ctx.app, newClient(), 'POST', '/auth/password/reset', { token, newPassword: NEW_PASSWORD });
    const r = await call(ctx.app, newClient(), 'POST', '/auth/login', { identifier: 'KilitAcma', password: NEW_PASSWORD });
    expect(r.statusCode).toBe(200);
  });
});

describe('parola değiştirme', () => {
  it('mevcut parola doğrulanır; diğer oturumlar kapanır, mevcut oturum açık kalır', async () => {
    const { client, email } = await registerAndLogin(ctx, 'DegisimPilot');
    const other = newClient();
    await call(ctx.app, other, 'POST', '/auth/login', { identifier: 'DegisimPilot', password: STRONG_PASSWORD });

    const wrong = await call(ctx.app, client, 'POST', '/auth/password/change', {
      currentPassword: 'yanlis-mevcut',
      newPassword: NEW_PASSWORD,
    });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error.fields.currentPassword).toBeDefined();

    const same = await call(ctx.app, client, 'POST', '/auth/password/change', {
      currentPassword: STRONG_PASSWORD,
      newPassword: STRONG_PASSWORD,
    });
    expect(same.json().error.code).toBe('WEAK_PASSWORD');

    const ok = await call(ctx.app, client, 'POST', '/auth/password/change', {
      currentPassword: STRONG_PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().revokedOtherSessions).toBe(1);
    expect((await call(ctx.app, client, 'GET', '/auth/me')).statusCode).toBe(200);
    expect((await call(ctx.app, other, 'GET', '/auth/me')).statusCode).toBe(401);
    expect(ctx.mailer.lastTo(email)?.subject).toContain('Parolan değiştirildi');
  });

  it('CSRF anahtarı olmadan parola değiştirilemez', async () => {
    const { client } = await registerAndLogin(ctx, 'CsrfParola');
    const r = await call(ctx.app, { ...client, csrf: null }, 'POST', '/auth/password/change', {
      currentPassword: STRONG_PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    expect(r.statusCode).toBe(403);
  });
});
