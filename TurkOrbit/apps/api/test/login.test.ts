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

describe('POST /auth/login', () => {
  it('kullanıcı adı veya e-posta ile giriş yapar; HttpOnly + SameSite=Strict çerez ayarlar', async () => {
    const { login } = await registerAndLogin(ctx, 'YildizAvcisi');
    expect(login.user.username).toBe('YildizAvcisi');
    expect(login.user.roles).toEqual(['player']);
    expect(login.permissions).toEqual([]);
    expect(login.csrfToken).toBeTypeOf('string');
    expect(login.sessionToken).toBeUndefined(); // web istemcisinde anahtar gövdede dönmez

    const client = newClient();
    const res = await call(ctx.app, client, 'POST', '/auth/login', {
      identifier: 'YILDIZAVCISI@ornek.com',
      password: STRONG_PASSWORD,
    });
    expect(res.statusCode).toBe(200);
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toMatch(/to_sid=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);
  });

  it('hatalı parola ve olmayan hesap için aynı hatayı döner', async () => {
    await registerAndLogin(ctx, 'YildizAvcisi');
    const wrong = await call(ctx.app, newClient(), 'POST', '/auth/login', {
      identifier: 'YildizAvcisi',
      password: 'yanlis-parola-123',
    });
    const missing = await call(ctx.app, newClient(), 'POST', '/auth/login', {
      identifier: 'BoylesiYok',
      password: 'yanlis-parola-123',
    });
    expect(wrong.statusCode).toBe(401);
    expect(missing.statusCode).toBe(401);
    expect(wrong.json()).toEqual(missing.json());
  });

  it('mobil uygulama (transport=token) oturum anahtarını gövdede alır, çerez almaz', async () => {
    await registerAndLogin(ctx, 'MobilPilot');
    const res = await call(ctx.app, newClient({ userAgent: 'Mozilla/5.0 (Linux; Android 14) TurkOrbitApp/0.1.0' }), 'POST', '/auth/login', {
      identifier: 'MobilPilot',
      password: STRONG_PASSWORD,
      transport: 'token',
      device: { platform: 'android', name: 'Pixel 8' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['set-cookie']).toBeUndefined();
    const json = res.json();
    expect(json.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(json.csrfToken).toBeNull();
    expect(json.session.platform).toBe('android');

    const me = await call(ctx.app, newClient({ bearer: json.sessionToken }), 'GET', '/auth/me');
    expect(me.statusCode).toBe(200);
    expect(me.json().user.username).toBe('MobilPilot');
  });

  it('5 hatalı denemeden sonra hesap 15 dakika kilitlenir ve sahibine e-posta gider', async () => {
    const { email } = await registerAndLogin(ctx, 'KilitTest');
    ctx.mailer.clear();
    for (let i = 0; i < 5; i++) {
      const r = await call(ctx.app, newClient(), 'POST', '/auth/login', { identifier: 'KilitTest', password: 'yanlis-parola-xx' });
      expect(r.statusCode).toBe(401);
    }
    // Doğru parola bile kilit süresince kabul edilmez.
    const locked = await call(ctx.app, newClient(), 'POST', '/auth/login', { identifier: 'KilitTest', password: STRONG_PASSWORD });
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error.message).toMatch(/dakika sonra/);
    expect(ctx.mailer.lastTo(email)?.subject).toContain('başarısız giriş');

    // Kullanıcı adı yerine e-posta ile denemek kilidi aşmaz.
    const viaEmail = await call(ctx.app, newClient(), 'POST', '/auth/login', { identifier: email, password: STRONG_PASSWORD });
    expect(viaEmail.statusCode).toBe(429);
  });

  it('olmayan hesaplar için de aynı kilit davranışı uygulanır (hesap varlığı sızmaz)', async () => {
    for (let i = 0; i < 5; i++) {
      await call(ctx.app, newClient(), 'POST', '/auth/login', { identifier: 'hayalet', password: 'yanlis-parola-xx' });
    }
    const r = await call(ctx.app, newClient(), 'POST', '/auth/login', { identifier: 'hayalet', password: 'yanlis-parola-xx' });
    expect(r.statusCode).toBe(429);
  });

  it('IP başına giriş hız sınırı uygulanır', async () => {
    const limited = await createTestContext({ loginPerIp: [3, 900] });
    try {
      const client = newClient({ ip: '203.0.113.9' });
      for (let i = 0; i < 3; i++) {
        const r = await call(limited.app, client, 'POST', '/auth/login', { identifier: `x${i}`, password: 'p' });
        expect(r.statusCode).toBe(401);
      }
      const r = await call(limited.app, client, 'POST', '/auth/login', { identifier: 'x9', password: 'p' });
      expect(r.statusCode).toBe(429);
    } finally {
      await limited.close();
    }
  });

  it('yasaklı, askıya alınmış ve kilitli hesapları doğru mesajla engeller', async () => {
    await registerAndLogin(ctx, 'KuralDisi');
    const attempt = () =>
      call(ctx.app, newClient(), 'POST', '/auth/login', { identifier: 'KuralDisi', password: STRONG_PASSWORD });

    await ctx.rt.db.query(`UPDATE users SET status = 'banned', status_reason = 'Hile kullanımı'`);
    let r = await attempt();
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe('ACCOUNT_BANNED');
    expect(r.json().error.message).toContain('Hile kullanımı');

    await ctx.rt.db.query(`UPDATE users SET status = 'suspended', suspended_until = now() + interval '2 days'`);
    r = await attempt();
    expect(r.json().error.code).toBe('ACCOUNT_SUSPENDED');

    // Süresi dolan askı otomatik kalkar.
    await ctx.rt.db.query(`UPDATE users SET suspended_until = now() - interval '1 minute'`);
    r = await attempt();
    expect(r.statusCode).toBe(200);
    const { rows } = await ctx.rt.db.query('SELECT status FROM users');
    expect(rows[0].status).toBe('active');

    await ctx.rt.db.query(`UPDATE users SET locked_until = now() + interval '1 hour'`);
    r = await attempt();
    expect(r.json().error.code).toBe('ACCOUNT_LOCKED');
  });

  it('yasaklanan hesabın açık oturumları anında geçersiz olur', async () => {
    const { client } = await registerAndLogin(ctx, 'OturumYasak');
    expect((await call(ctx.app, client, 'GET', '/auth/me')).statusCode).toBe(200);
    await ctx.rt.db.query(`UPDATE users SET status = 'banned'`);
    await ctx.rt.redis!.flushdb(); // Aşama 14'te yasaklama işlemi önbelleği kendisi temizleyecek
    expect((await call(ctx.app, client, 'GET', '/auth/me')).statusCode).toBe(401);
  });
});

describe('şüpheli giriş tespiti ve giriş geçmişi', () => {
  it('ilk giriş şüpheli sayılmaz; yeni cihaz + yeni ağdan giriş işaretlenir ve e-posta gönderilir', async () => {
    const { client, email, login } = await registerAndLogin(ctx, 'GuvenlikPilot');
    expect(login.suspicious).toBe(false);
    ctx.mailer.clear();

    // Aynı cihaz, aynı ağ (/24) → şüpheli değil
    const same = await call(ctx.app, newClient({ ip: '85.105.10.99' }), 'POST', '/auth/login', {
      identifier: 'GuvenlikPilot',
      password: STRONG_PASSWORD,
    });
    expect(same.json().suspicious).toBe(false);

    // Farklı cihaz (iPhone Safari) + farklı ağ → şüpheli
    const foreign = newClient({
      ip: '198.51.100.7',
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    });
    const sus = await call(ctx.app, foreign, 'POST', '/auth/login', { identifier: 'GuvenlikPilot', password: STRONG_PASSWORD });
    expect(sus.statusCode).toBe(200);
    expect(sus.json().suspicious).toBe(true);
    const mail = ctx.mailer.lastTo(email);
    expect(mail?.subject).toContain('yeni bir cihazdan');
    expect(mail?.text).toContain('198.51.*.*');

    const history = await call(ctx.app, client, 'GET', '/auth/login-history');
    expect(history.statusCode).toBe(200);
    const events = history.json().events;
    expect(events[0].suspicious).toBe(true);
    expect(events[0].suspiciousReasons).toEqual(expect.arrayContaining(['new_device', 'new_network']));
    expect(events[0].browser).toBe('Safari');
    expect(events[0].os).toBe('iOS');
    expect(events[0].ipMasked).toBe('198.51.*.*');
  });

  it('başarısız denemeler geçmişe yazılır; parola hiçbir zaman kaydedilmez', async () => {
    const { client } = await registerAndLogin(ctx, 'GecmisPilot');
    await call(ctx.app, newClient(), 'POST', '/auth/login', { identifier: 'GecmisPilot', password: 'cok-gizli-yanlis' });
    const h = (await call(ctx.app, client, 'GET', '/auth/login-history')).json().events;
    expect(h[0]).toMatchObject({ success: false, failureReason: 'wrong_password' });
    const { rows } = await ctx.rt.db.query(`SELECT row_to_json(l)::text AS j FROM login_events l`);
    for (const r of rows) expect(r.j).not.toContain('cok-gizli-yanlis');
  });
});
