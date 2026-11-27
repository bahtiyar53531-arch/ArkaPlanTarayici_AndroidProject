import { describe, expect, it } from 'vitest';
import {
  checkPassword,
  isReservedUsername,
  loginSchema,
  registerSchema,
  ROLE_PERMISSIONS,
  PERMISSIONS,
  DEFAULT_ROLE,
} from './index.js';

describe('parola politikası', () => {
  it('kısa parolayı reddeder', () => {
    const r = checkPassword('Ab1!x');
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toContain('en az 10');
  });

  it('yaygın parolayı reddeder (büyük/küçük harf duyarsız)', () => {
    expect(checkPassword('Galatasaray1905').ok).toBe(false);
    expect(checkPassword('QWERTYUIOP').ok).toBe(false);
  });

  it('kullanıcı adını veya e-posta yerel kısmını içeren parolayı reddeder', () => {
    expect(checkPassword('Yildizpilot#2026', { username: 'yildizpilot' }).ok).toBe(false);
    expect(checkPassword('Mehmetcik!99xx', { email: 'mehmetcik@ornek.com' }).ok).toBe(false);
  });

  it('16 karakterden kısa ve tek karakter türlü parolayı reddeder', () => {
    expect(checkPassword('kisaparolaaa').ok).toBe(false);
  });

  it('uzun parola cümlesini kabul eder', () => {
    const r = checkPassword('mavi gezegende yeşil kuyruklu yıldız');
    expect(r.ok).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(3);
  });

  it('güçlü karma parolayı kabul eder', () => {
    expect(checkPassword('Nebula-Kartal-77').ok).toBe(true);
  });
});

describe('kayıt şeması', () => {
  const valid = {
    username: 'KozmikKartal',
    email: '  Pilot@Ornek.COM ',
    password: 'Nebula-Kartal-77',
    acceptTerms: true,
  };

  it('geçerli girdiyi normalize eder', () => {
    const r = registerSchema.parse(valid);
    expect(r.email).toBe('pilot@ornek.com');
    expect(r.locale).toBe('tr');
  });

  it('istemciden gelen rol alanını reddeder (kendini yönetici yapma girişimi)', () => {
    const r = registerSchema.safeParse({ ...valid, role: 'super_admin' });
    expect(r.success).toBe(false);
  });

  it('koşulları kabul etmeden kaydı reddeder', () => {
    expect(registerSchema.safeParse({ ...valid, acceptTerms: false }).success).toBe(false);
  });

  it('rezerve kullanıcı adlarını reddeder', () => {
    expect(isReservedUsername('TurkOrbitDestek')).toBe(true);
    expect(isReservedUsername('Admin_01')).toBe(true);
    expect(isReservedUsername('gm')).toBe(true);
    expect(isReservedUsername('KozmikKartal')).toBe(false);
    expect(registerSchema.safeParse({ ...valid, username: 'SuperAdmin' }).success).toBe(false);
  });

  it('geçersiz kullanıcı adı biçimini reddeder', () => {
    for (const u of ['ab', '1pilot', 'pilot-01', 'çağrı', 'a'.repeat(21)]) {
      expect(registerSchema.safeParse({ ...valid, username: u }).success, u).toBe(false);
    }
  });
});

describe('giriş şeması', () => {
  it('varsayılan transport çerezdir', () => {
    const r = loginSchema.parse({ identifier: 'pilot', password: 'x' });
    expect(r.transport).toBe('cookie');
  });
  it('bilinmeyen alanları reddeder', () => {
    expect(loginSchema.safeParse({ identifier: 'a', password: 'b', admin: true }).success).toBe(false);
  });
});

describe('rol kataloğu', () => {
  it('varsayılan rol oyuncudur ve hiçbir yönetim yetkisi yoktur', () => {
    expect(DEFAULT_ROLE).toBe('player');
    expect(ROLE_PERMISSIONS.player).toHaveLength(0);
  });
  it('süper yönetici tüm yetkilere sahiptir', () => {
    expect([...ROLE_PERMISSIONS.super_admin].sort()).toEqual([...PERMISSIONS].sort());
  });
  it('rol yetkileri katalogda tanımlıdır ve tekrarsızdır', () => {
    for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
      expect(new Set(perms).size, role).toBe(perms.length);
      for (const p of perms) expect(PERMISSIONS).toContain(p);
    }
  });
});
