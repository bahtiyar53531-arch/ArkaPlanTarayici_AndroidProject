import { describe, expect, it } from 'vitest';
import { advance, objectiveMatches, pickSeeded, questCycles, questEventSchema, resolveCompanyText, resolveParams } from './quests.js';

describe('görev döngüleri (05:00 TSİ)', () => {
  it('günlük döngü Türkiye saatiyle 05:00\'te değişir', () => {
    // 28.11.2026 04:59 TSİ = 01:59 UTC → hâlâ 27 Kasım döngüsü
    expect(questCycles(new Date('2026-11-28T01:59:59Z')).daily).toBe('2026-11-27');
    // 05:00 TSİ = 02:00 UTC → 28 Kasım
    expect(questCycles(new Date('2026-11-28T02:00:00Z')).daily).toBe('2026-11-28');
    // 23:30 TSİ = 20:30 UTC → aynı gün
    expect(questCycles(new Date('2026-11-28T20:30:00Z')).daily).toBe('2026-11-28');
  });
  it('sonraki sıfırlama anı doğru hesaplanır', () => {
    const c = questCycles(new Date('2026-11-28T10:00:00Z'));
    expect(c.nextDailyReset.toISOString()).toBe('2026-11-29T02:00:00.000Z');
    // 28.11.2026 cumartesi → sonraki pazartesi 30.11 05:00 TSİ
    expect(c.nextWeeklyReset.toISOString()).toBe('2026-11-30T02:00:00.000Z');
  });
  it('haftalık döngü pazartesi 05:00 TSİ\'de değişir (ISO hafta)', () => {
    expect(questCycles(new Date('2026-11-28T10:00:00Z')).weekly).toBe('2026-W48');
    // Pazartesi 04:59 TSİ → hâlâ W48
    expect(questCycles(new Date('2026-11-30T01:59:00Z')).weekly).toBe('2026-W48');
    expect(questCycles(new Date('2026-11-30T02:00:00Z')).weekly).toBe('2026-W49');
    // Yıl dönümü: 01.01.2027 cuma → 2026-W53
    expect(questCycles(new Date('2027-01-01T12:00:00Z')).weekly).toBe('2026-W53');
    expect(questCycles(new Date('2027-01-04T02:00:00Z')).weekly).toBe('2027-W01');
  });
});

describe('hedef eşleme', () => {
  it('NPC, aile, harita ve harita türü koşulları uygulanır; {c} şirket önekiyle çözülür', () => {
    const p = resolveParams({ npc: ['cakal'], maps: ['{c}-1'] }, 'G');
    expect(p.maps).toEqual(['G-1']);
    expect(objectiveMatches('kill_npc', p, { type: 'kill_npc', amount: 1, npc: 'cakal', family: 'cakal', map: 'G-1' })).toBe(true);
    expect(objectiveMatches('kill_npc', p, { type: 'kill_npc', amount: 1, npc: 'cakal', family: 'cakal', map: 'K-1' })).toBe(false);
    expect(objectiveMatches('kill_npc', p, { type: 'kill_npc', amount: 1, npc: 'akrep', family: 'akrep', map: 'G-1' })).toBe(false);
    expect(objectiveMatches('kill_npc', { family: ['akrep'], map_types: ['border'] }, { type: 'kill_npc', amount: 1, npc: 'kara-akrep', family: 'akrep', map: 'S-1', mapType: 'border' })).toBe(true);
    expect(objectiveMatches('kill_npc', { family: ['akrep'], map_types: ['border'] }, { type: 'kill_npc', amount: 1, npc: 'kara-akrep', family: 'akrep', map: 'K-3', mapType: 'company' })).toBe(false);
    expect(objectiveMatches('collect_cargo', {}, { type: 'kill_npc', amount: 1 })).toBe(false);
    expect(resolveCompanyText('Haritaya git: {c}-2', 'A')).toBe('Haritaya git: A-2');
  });
  it('hasar hedefi (NPC/pilot), yükseltme seviyesi, mağaza kategorisi', () => {
    expect(objectiveMatches('deal_damage', { target: 'player' }, { type: 'deal_damage', amount: 500, target: 'npc' })).toBe(false);
    expect(objectiveMatches('deal_damage', { target: 'npc', family: ['yarasa'] }, { type: 'deal_damage', amount: 500, target: 'npc', family: 'yarasa' })).toBe(true);
    expect(objectiveMatches('upgrade_item', { min_level: 3 }, { type: 'upgrade_item', amount: 1, level: 2 })).toBe(false);
    expect(objectiveMatches('upgrade_item', { min_level: 3 }, { type: 'upgrade_item', amount: 1, level: 3 })).toBe(true);
    expect(objectiveMatches('buy_item', { category: ['ammo'] }, { type: 'buy_item', amount: 1, category: 'rocket' })).toBe(false);
  });
  it('ilerleme hedefi aşmaz; seviye hedefi "en yüksek değer" olarak tutulur', () => {
    expect(advance('kill_npc', 28, 30, { type: 'kill_npc', amount: 5 })).toBe(30);
    expect(advance('travel_distance', 100, 30000, { type: 'travel_distance', amount: 250 })).toBe(350);
    expect(advance('reach_level', 3, 5, { type: 'reach_level', amount: 1, level: 4 })).toBe(4);
    expect(advance('reach_level', 4, 5, { type: 'reach_level', amount: 1, level: 2 })).toBe(4);
    expect(advance('reach_level', 4, 5, { type: 'reach_level', amount: 1, level: 9 })).toBe(5);
  });
  it('olay şeması: negatif/sıfır miktar ve bilinmeyen alanlar reddedilir', () => {
    expect(questEventSchema.safeParse({ type: 'kill_npc', amount: 0 }).success).toBe(false);
    expect(questEventSchema.safeParse({ type: 'kill_npc', amount: 1, progress: 99 }).success).toBe(false);
    expect(questEventSchema.safeParse({ type: 'kill_npc', amount: 2, npc: 'cakal' }).success).toBe(true);
  });
});

describe('tohumlu seçim', () => {
  const pool = Array.from({ length: 22 }, (_, i) => `q${i}`);
  it('aynı pilot ve döngü için aynı görevler; farklı döngüde farklı', () => {
    const a = pickSeeded(pool, 3, 'pilot-1:daily:2026-11-28');
    expect(pickSeeded(pool, 3, 'pilot-1:daily:2026-11-28')).toEqual(a);
    expect(new Set(a).size).toBe(3);
    const days = new Set(['2026-11-28', '2026-11-29', '2026-11-30', '2026-12-01'].map((d) => pickSeeded(pool, 3, `pilot-1:daily:${d}`).join()));
    expect(days.size).toBeGreaterThan(1);
    expect(pickSeeded(pool, 50, 'x')).toHaveLength(22);
  });
});
