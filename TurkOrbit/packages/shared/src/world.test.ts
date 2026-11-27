import { describe, expect, it } from 'vitest';
import { canEnterMap, checkMove, defaultSettings, settingsSchema, updateSettingsSchema } from './world.js';

const map = (o: Partial<Parameters<typeof canEnterMap>[0]['map']> = {}) => ({
  minLevel: 1, companyCode: 'KZL', isClosed: false, entryRules: { enemy_company_min_level: 15 }, ...o,
});

describe('harita giriş koşulları', () => {
  it('kendi şirket haritası serbest, düşman şirket haritası seviye 15 ister', () => {
    expect(canEnterMap({ playerLevel: 1, playerCompanyCode: 'KZL', map: map() }).ok).toBe(true);
    const r = canEnterMap({ playerLevel: 14, playerCompanyCode: 'GKB', map: map() });
    expect(r).toMatchObject({ ok: false, code: 'MAP_LOCKED', requiredLevel: 15 });
    expect(canEnterMap({ playerLevel: 15, playerCompanyCode: 'GKB', map: map() }).ok).toBe(true);
  });
  it('genel seviye şartı, portal şartı ve kapalı harita', () => {
    expect(canEnterMap({ playerLevel: 7, playerCompanyCode: 'KZL', map: map({ minLevel: 8, companyCode: null, entryRules: {} }) })).toMatchObject({ ok: false, requiredLevel: 8 });
    expect(canEnterMap({ playerLevel: 9, playerCompanyCode: 'KZL', map: map({ minLevel: 8, companyCode: null, entryRules: {} }), portalRules: { min_level: 10 } })).toMatchObject({ ok: false, requiredLevel: 10 });
    expect(canEnterMap({ playerLevel: 50, playerCompanyCode: 'KZL', map: map({ isClosed: true }) })).toMatchObject({ ok: false, code: 'MAP_CLOSED' });
  });
});

describe('konum doğrulaması (hız denetimi)', () => {
  const b = { width: 20000, height: 12500 };
  it('hızın izin verdiği mesafe kabul edilir, fazlası reddedilir', () => {
    // 320 birim/sn × 2 sn × 1.25 + 300 = 1100
    expect(checkMove({ x: 0, y: 0 }, { x: 1000, y: 0 }, 320, 2000, b).ok).toBe(true);
    const r = checkMove({ x: 0, y: 0 }, { x: 1200, y: 0 }, 320, 2000, b);
    expect(r).toMatchObject({ ok: false, reason: 'too_fast', allowed: 1100 });
  });
  it('uzun beklemeden sonra ışınlanma yok (süre üst sınırı)', () => {
    expect(checkMove({ x: 0, y: 0 }, { x: 9000, y: 0 }, 320, 600_000, b).ok).toBe(false);
  });
  it('harita dışı reddedilir', () => {
    expect(checkMove({ x: 100, y: 100 }, { x: -10, y: 100 }, 320, 1000, b).reason).toBe('out_of_bounds');
  });
});

describe('oyuncu ayarları', () => {
  it('varsayılanlar şemaya uyar; cihaz sınıfına göre farklıdır', () => {
    for (const d of ['desktop', 'phone', 'tablet'] as const) expect(settingsSchema.safeParse(defaultSettings(d)).success).toBe(true);
    expect(defaultSettings('phone').hud.minimapSize).toBe('small');
    expect(defaultSettings('desktop').graphics.quality).toBe('high');
  });
  it('geçersiz değer ve bilinmeyen alan reddedilir', () => {
    const s = defaultSettings('phone');
    expect(updateSettingsSchema.safeParse({ deviceClass: 'phone', settings: { ...s, hud: { ...s.hud, scale: 3 } } }).success).toBe(false);
    expect(updateSettingsSchema.safeParse({ deviceClass: 'tv', settings: s }).success).toBe(false);
    expect(updateSettingsSchema.safeParse({ deviceClass: 'phone', settings: { ...s, cheat: true } }).success).toBe(false);
  });
});
