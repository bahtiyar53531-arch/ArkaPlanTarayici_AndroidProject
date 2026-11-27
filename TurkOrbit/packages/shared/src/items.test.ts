import { describe, expect, it } from 'vitest';
import { computeLoadoutStats, parseItemStats, purchaseSchema, slotAccepts, equipSchema, type EquippedForStats } from './items.js';

const ship = { hitpoints: 64000, baseSpeed: 340, cargoCapacity: 600 };
const laser = (i: number, mult = 1, slotType: EquippedForStats['slotType'] = 'laser'): EquippedForStats => ({
  slotType, slotIndex: i, category: 'laser', stats: { damage: 100, rateMs: 1000, range: 640 }, upgradeMultiplier: mult,
});

describe('slot uyumluluğu', () => {
  it('kategoriler doğru slotlara takılır', () => {
    expect(slotAccepts('laser', 'laser')).toBe(true);
    expect(slotAccepts('laser', 'shield_generator')).toBe(false);
    expect(slotAccepts('generator', 'speed_generator')).toBe(true);
    expect(slotAccepts('extra', 'rocket_launcher')).toBe(true);
    expect(slotAccepts('drone_gear', 'laser')).toBe(true);
    expect(slotAccepts('drone_gear', 'speed_generator')).toBe(false);
    expect(slotAccepts('generator', 'ammo')).toBe(false);
  });
});

describe('istatistik doğrulama', () => {
  it('bozuk istatistiği reddeder', () => {
    expect(() => parseItemStats('laser', { damage: -5, rateMs: 1000, range: 600 })).toThrow();
    expect(() => parseItemStats('laser', { damage: 5, rateMs: 1000, range: 600, hack: 1 })).toThrow();
    expect(parseItemStats('shield_generator', { shield: 1000, absorb: 0.5 }).shield).toBe(1000);
  });
});

describe('konfigürasyon istatistikleri', () => {
  it('lazer, kalkan, hız ve kargo toplanır; yükseltme çarpanı uygulanır', () => {
    const s = computeLoadoutStats(ship, [
      laser(0),
      laser(1, 1.1),
      { slotType: 'generator', slotIndex: 0, category: 'shield_generator', stats: { shield: 4000, absorb: 0.7 }, upgradeMultiplier: 1 },
      { slotType: 'generator', slotIndex: 1, category: 'shield_generator', stats: { shield: 1000, absorb: 0.5 }, upgradeMultiplier: 1 },
      { slotType: 'generator', slotIndex: 2, category: 'speed_generator', stats: { speed: 10 }, upgradeMultiplier: 1.2 },
      { slotType: 'extra', slotIndex: 0, category: 'extra', stats: { kind: 'cargo', value: 200 }, upgradeMultiplier: 1 },
      { slotType: 'extra', slotIndex: 1, category: 'rocket_launcher', stats: { volley: 5, reloadMs: 6000 }, upgradeMultiplier: 1 },
    ]);
    expect(s.lasers).toBe(2);
    expect(s.damagePerVolley).toBe(210);
    expect(s.damagePerSecond).toBe(210);
    expect(s.laserRange).toBe(640);
    expect(s.shield).toBe(5000);
    expect(s.shieldAbsorb).toBeCloseTo((4000 * 0.7 + 1000 * 0.5) / 5000, 3);
    expect(s.speed).toBe(352);
    expect(s.cargo).toBe(800);
    expect(s.rocketVolley).toBe(5);
  });

  it('drone ekipmanı drone yoksa etkisiz; varsa drone bonusu uygulanır', () => {
    const noDrone = computeLoadoutStats(ship, [laser(0, 1, 'drone_gear')]);
    expect(noDrone.lasers).toBe(0);
    const withDrone = computeLoadoutStats(ship, [
      { slotType: 'drone', slotIndex: 0, category: 'drone', stats: { gearSlots: 1, bonus: 0.1 }, upgradeMultiplier: 1 },
      laser(0, 1, 'drone_gear'),
    ]);
    expect(withDrone.drones).toBe(1);
    expect(withDrone.damagePerVolley).toBe(110);
  });

  it('boş konfigürasyon', () => {
    const s = computeLoadoutStats(ship, []);
    expect(s).toMatchObject({ lasers: 0, damagePerSecond: 0, laserRange: 0, shield: 0, shieldAbsorb: 0, speed: 340, cargo: 600 });
  });
});

describe('istek şemaları', () => {
  it('satın almada requestId zorunlu, fiyat gönderilemez', () => {
    expect(purchaseSchema.safeParse({ serverCode: 'TR1', offerId: 1 }).success).toBe(false);
    expect(purchaseSchema.safeParse({ serverCode: 'TR1', offerId: 1, requestId: crypto.randomUUID(), price: 0 }).success).toBe(false);
    expect(purchaseSchema.parse({ serverCode: 'tr1', offerId: 1, requestId: crypto.randomUUID() }).packs).toBe(1);
  });
  it('takma isteğinde konfigürasyon yalnızca 1 veya 2', () => {
    const base = { serverCode: 'TR1', shipId: crypto.randomUUID(), slotType: 'laser', slotIndex: 0, itemId: crypto.randomUUID() };
    expect(equipSchema.safeParse({ ...base, loadout: 1 }).success).toBe(true);
    expect(equipSchema.safeParse({ ...base, loadout: 3 }).success).toBe(false);
  });
});
