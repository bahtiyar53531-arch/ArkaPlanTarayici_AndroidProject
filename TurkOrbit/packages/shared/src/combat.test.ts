import { describe, expect, it } from 'vitest';
import { applyDamage, canAttack, rollDamage, rollRewards, splitRewards, volleyIntervalMs, type RewardEntry, type RolledReward } from './combat.js';
import { clientMessageSchema } from './net.js';

describe('hasar ve kalkan', () => {
  it('hasarın emme oranı kalkana, kalanı gövdeye gider', () => {
    expect(applyDamage({ hp: 1000, shield: 500, absorb: 0.5 }, 200)).toMatchObject({ shield: 100, hull: 100, hp: 900, shieldLeft: 400, killed: false });
  });
  it('kalkan bitince tüm hasar gövdeye gider; can 0 altına düşmez ve ölüm bildirilir', () => {
    expect(applyDamage({ hp: 1000, shield: 30, absorb: 0.8 }, 200)).toMatchObject({ shield: 30, hull: 170, hp: 830 });
    expect(applyDamage({ hp: 50, shield: 0, absorb: 0.5 }, 200)).toMatchObject({ hull: 50, hp: 0, killed: true });
  });
  it('varyans ±%10 aralığında kalır', () => {
    expect(rollDamage(100, 0.1, () => 0)).toBe(90);
    expect(rollDamage(100, 0.1, () => 0.999999)).toBe(110);
    expect(rollDamage(100, 0.1, () => 0.5)).toBe(100);
  });
  it('atış aralığı tur hasarı / saniyelik hasardan hesaplanır', () => {
    expect(volleyIntervalMs(40, 40)).toBe(1000);
    expect(volleyIntervalMs(0, 0)).toBe(0);
  });
});

describe('saldırı izni (sunucuda uygulanır)', () => {
  const base = { mapPvp: true, attackerCompany: 'KZL', attackerInSafeZone: false, targetInSafeZone: false } as const;
  it('NPC her haritada vurulabilir; güvenli bölgede vurulamaz', () => {
    expect(canAttack({ ...base, targetKind: 'npc', mapPvp: false }).ok).toBe(true);
    expect(canAttack({ ...base, targetKind: 'npc', attackerInSafeZone: true })).toMatchObject({ ok: false, reason: 'Güvenli bölgede saldırı yapılamaz.' });
  });
  it('pilot yalnızca PvP haritasında ve başka şirketten ise vurulabilir', () => {
    expect(canAttack({ ...base, targetKind: 'pilot', targetCompany: 'GKB' }).ok).toBe(true);
    expect(canAttack({ ...base, targetKind: 'pilot', targetCompany: 'KZL' }).ok).toBe(false);
    expect(canAttack({ ...base, targetKind: 'pilot', targetCompany: 'GKB', mapPvp: false }).ok).toBe(false);
    expect(canAttack({ ...base, targetKind: 'pilot', targetCompany: 'GKB', targetInSafeZone: true }).ok).toBe(false);
    expect(canAttack({ ...base, targetKind: 'cargo' }).ok).toBe(false);
  });
});

describe('ödül zarı', () => {
  const entries: RewardEntry[] = [
    { reward_type: 'currency', ref_code: 'KREDI', min_amount: 400, max_amount: 400, chance: 1, delivery: 'direct' },
    { reward_type: 'currency', ref_code: 'AKCE', min_amount: 2, max_amount: 2, chance: 0.3, delivery: 'direct' },
    { reward_type: 'item', ref_code: 'ammo.isk1', min_amount: 20, max_amount: 60, chance: 0.6, delivery: 'cargo' },
  ];
  it('kesin ödül her zaman, şanslı ödül zar tutarsa verilir; miktar aralıkta', () => {
    const lucky = rollRewards(entries, () => 0);
    expect(lucky.direct).toEqual([{ type: 'currency', code: 'KREDI', amount: 400 }, { type: 'currency', code: 'AKCE', amount: 2 }]);
    expect(lucky.cargo).toEqual([{ type: 'item', code: 'ammo.isk1', amount: 20 }]);
    const unlucky = rollRewards(entries, () => 0.99);
    expect(unlucky.direct).toEqual([{ type: 'currency', code: 'KREDI', amount: 400 }]);
    expect(unlucky.cargo).toEqual([]);
  });
});

describe('ödül paylaşımı (hasar katkısına göre)', () => {
  const loot: RolledReward[] = [
    { type: 'currency', code: 'KREDI', amount: 1000 },
    { type: 'experience', code: 'XP', amount: 401 },
    { type: 'honor', code: 'HONOR', amount: 10 },
    { type: 'item', code: 'ammo.isk2', amount: 50 },
  ];
  it('tek pilot her şeyi alır', () => {
    expect(splitRewards(loot, [{ id: 'a', damage: 500, present: true }])).toEqual([{ id: 'a', share: 1, top: true, rewards: loot }]);
  });
  it('Kredi, deneyim ve şeref paya göre bölünür; yuvarlama artığı ve bölünemeyen eşya en çok hasar verene', () => {
    const r = splitRewards(loot, [
      { id: 'a', damage: 300, present: true },
      { id: 'b', damage: 700, present: true },
    ]);
    expect(r.map((x) => [x.id, x.share, x.top])).toEqual([['a', 0.3, false], ['b', 0.7, true]]);
    expect(r[0]!.rewards).toEqual([
      { type: 'currency', code: 'KREDI', amount: 300 },
      { type: 'experience', code: 'XP', amount: 120 },
      { type: 'honor', code: 'HONOR', amount: 3 },
    ]);
    expect(r[1]!.rewards).toEqual([
      { type: 'currency', code: 'KREDI', amount: 700 },
      { type: 'experience', code: 'XP', amount: 281 },
      { type: 'honor', code: 'HONOR', amount: 7 },
      { type: 'item', code: 'ammo.isk2', amount: 50 },
    ]);
    // Toplam asla aşılmaz
    const sum = (code: string) => r.flatMap((x) => x.rewards).filter((x) => x.code === code).reduce((a, x) => a + x.amount, 0);
    expect([sum('KREDI'), sum('XP'), sum('HONOR')]).toEqual([1000, 401, 10]);
  });
  it('haritadan ayrılan pilotun payı kimseye verilmez; payı hiçbir ödüle yetmeyen pilot listede yer almaz', () => {
    const r = splitRewards(loot, [
      { id: 'a', damage: 500, present: false },
      { id: 'b', damage: 499, present: true },
      { id: 'c', damage: 1, present: true },
    ]);
    expect(r.map((x) => x.id)).toEqual(['b', 'c']);
    expect(r[0]!.rewards.find((x) => x.code === 'KREDI')!.amount + r[1]!.rewards.find((x) => x.code === 'KREDI')!.amount).toBe(500);
    expect(r[1]!.rewards).toEqual([{ type: 'currency', code: 'KREDI', amount: 1 }]);
    expect(splitRewards(loot, [{ id: 'a', damage: 10, present: false }])).toEqual([]);
    const tiny = splitRewards([{ type: 'currency', code: 'KREDI', amount: 10 }], [
      { id: 'a', damage: 990, present: true },
      { id: 'b', damage: 10, present: true },
    ]);
    expect(tiny.map((x) => x.id)).toEqual(['a']);
  });
});

describe('savaş mesajları', () => {
  it('niyet mesajları kabul edilir; hasar/menzil gönderme girişimi reddedilir', () => {
    expect(clientMessageSchema.safeParse({ t: 'target', id: 5 }).success).toBe(true);
    expect(clientMessageSchema.safeParse({ t: 'target', id: null }).success).toBe(true);
    expect(clientMessageSchema.safeParse({ t: 'attack', on: true }).success).toBe(true);
    expect(clientMessageSchema.safeParse({ t: 'ammo', c: 'ammo.isk3' }).success).toBe(true);
    expect(clientMessageSchema.safeParse({ t: 'rocket' }).success).toBe(true);
    expect(clientMessageSchema.safeParse({ t: 'attack', on: true, damage: 99999 }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ t: 'ammo', c: 'ammo.hile' }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ t: 'hit', id: 5, amount: 100 }).success).toBe(false);
  });
});
