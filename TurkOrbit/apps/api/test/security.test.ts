import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { call, createTestContext, newClient, registerAndLogin, resetDatabase, STRONG_PASSWORD, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => ctx.close());
beforeEach(async () => {
  await resetDatabase(ctx.rt);
});

describe('HTTP güvenlik katmanları', () => {
  it('text/plain ve form gövdeleri reddedilir (form tabanlı CSRF engeli)', async () => {
    for (const type of ['text/plain', 'application/x-www-form-urlencoded']) {
      const r = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { 'content-type': type, origin: 'http://localhost:5173' },
        payload: 'identifier=a&password=b',
      });
      expect(r.statusCode, type).toBe(415);
      expect(r.json().error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    }
  });

  it('izin listesinde olmayan Origin ile durum değiştiren istek reddedilir', async () => {
    const r = await call(ctx.app, newClient(), 'POST', '/auth/login', { identifier: 'a', password: 'b' }, {
      origin: 'https://kotu-site.example',
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe('ORIGIN_NOT_ALLOWED');
  });

  it('mobil uygulama Origin değeri (capacitor://localhost) kabul edilir', async () => {
    await registerAndLogin(ctx, 'KapasitorPilot');
    const r = await call(ctx.app, newClient(), 'POST', '/auth/login', {
      identifier: 'KapasitorPilot',
      password: STRONG_PASSWORD,
      transport: 'token',
      device: { platform: 'ios' },
    }, { origin: 'capacitor://localhost' });
    expect(r.statusCode).toBe(200);
  });

  it('CORS: izinli kaynağa kimlik bilgili erişim izni verilir, diğerlerine verilmez', async () => {
    const ok = await ctx.app.inject({
      method: 'OPTIONS',
      url: '/api/v1/auth/login',
      headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'POST' },
    });
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    const bad = await ctx.app.inject({
      method: 'OPTIONS',
      url: '/api/v1/auth/login',
      headers: { origin: 'https://kotu-site.example', 'access-control-request-method': 'POST' },
    });
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('güvenlik başlıkları ayarlanır', async () => {
    const r = await ctx.app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['content-security-policy']).toContain("default-src 'none'");
    expect(r.headers['referrer-policy']).toBe('no-referrer');
    expect(r.headers['strict-transport-security']).toBeDefined();
  });

  it('bozuk JSON ve çok büyük gövde Türkçe hata ile reddedilir', async () => {
    const bad = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{"identifier": ',
    });
    expect(bad.statusCode).toBe(400);
    const huge = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ identifier: 'x'.repeat(20_000), password: 'y' }),
    });
    expect(huge.statusCode).toBe(413);
  });

  it('sağlık uç noktası veritabanı ve Redis durumunu raporlar', async () => {
    const r = await ctx.app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ status: 'ok', database: { ok: true }, redis: { ok: true } });
  });

  it('bilinmeyen adres Türkçe 404 döner', async () => {
    const r = await ctx.app.inject({ method: 'GET', url: '/api/v1/yok-boyle-bir-yer' });
    expect(r.statusCode).toBe(404);
    expect(r.json().error.code).toBe('NOT_FOUND');
  });
});
