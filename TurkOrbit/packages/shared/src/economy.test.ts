import { describe, expect, it } from 'vitest';
import { auctionPeriod, craftStartSchema, dailyStreak, extendedEnd, minNextBid } from './economy.js';
import { ITEM_STATS_SCHEMAS } from './items.js';
import { objectiveMatches } from './quests.js';

describe('açık artırma dönemleri', () => {
  it('saatlik dönem UTC saat başında başlar ve bir saat sürer', () => {
    expect(auctionPeriod('hourly', new Date('2026-11-28T10:20:00Z'))).toEqual({
      key: '2026-11-28T10',
      startsAt: new Date('2026-11-28T10:00:00Z'),
      endsAt: new Date('2026-11-28T11:00:00Z'),
    });
  });
  it('günlük ve haftalık dönemler 05:00 TSİ sınırlarını kullanır', () => {
    const d = auctionPeriod('daily', new Date('2026-11-28T01:59:00Z')); // 04:59 TSİ → önceki oyun günü
    expect(d).toMatchObject({ key: '2026-11-27', endsAt: new Date('2026-11-28T02:00:00Z') });
    const w = auctionPeriod('weekly', new Date('2026-11-28T10:00:00Z'));
    expect(w).toMatchObject({ key: '2026-W48', startsAt: new Date('2026-11-23T02:00:00Z'), endsAt: new Date('2026-11-30T02:00:00Z') });
  });
});

describe('teklif kuralları', () => {
  it('ilk teklif taban fiyat; sonrakiler en az %5 veya 100 fazla', () => {
    expect(minNextBid(4000, null)).toBe(4000);
    expect(minNextBid(4000, 4000)).toBe(4200);
    expect(minNextBid(1000, 1000)).toBe(1100); // %5 = 50 < 100
    expect(minNextBid(1000, 4410)).toBe(4631); // yukarı yuvarlanır
  });
  it('son 60 sn içinde gelen teklif bitişi tekliften 60 sn sonraya uzatır; erken teklif uzatmaz', () => {
    const end = new Date('2026-11-28T11:00:00Z');
    expect(extendedEnd(end, new Date('2026-11-28T10:58:00Z'))).toEqual(end);
    expect(extendedEnd(end, new Date('2026-11-28T10:59:30Z'))).toEqual(new Date('2026-11-28T11:00:30Z'));
  });
});

describe('günlük giriş serisi', () => {
  it('dün alındıysa seri artar; atlanırsa 1; 7. günden sonra takvim başa döner', () => {
    expect(dailyStreak('2026-11-28', null)).toEqual({ streak: 1, day: 1 });
    expect(dailyStreak('2026-11-29', { date: '2026-11-28', streak: 1 })).toEqual({ streak: 2, day: 2 });
    expect(dailyStreak('2026-12-01', { date: '2026-11-29', streak: 2 })).toEqual({ streak: 1, day: 1 });
    expect(dailyStreak('2026-12-08', { date: '2026-12-07', streak: 7 })).toEqual({ streak: 8, day: 1 });
    // Ay ve yıl geçişi
    expect(dailyStreak('2027-01-01', { date: '2026-12-31', streak: 3 })).toEqual({ streak: 4, day: 4 });
  });
});

describe('kaynak ve üretim şemaları', () => {
  it('kaynak istatistiği kademe 1–4; üretim isteği istemciden fiyat/çıktı kabul etmez', () => {
    expect(ITEM_STATS_SCHEMAS.resource.safeParse({ tier: 2 }).success).toBe(true);
    expect(ITEM_STATS_SCHEMAS.resource.safeParse({ tier: 5 }).success).toBe(false);
    const base = { serverCode: 'TR1', recipe: 'nebulit', batches: 2, requestId: '5b7c3a1e-0d8e-4f3e-9c1a-2b3c4d5e6f70' };
    expect(craftStartSchema.safeParse(base).success).toBe(true);
    expect(craftStartSchema.safeParse({ ...base, batches: 0 }).success).toBe(false);
    expect(craftStartSchema.safeParse({ ...base, price: 1 }).success).toBe(false);
  });
  it('görev hedefleri: kaynak ve üretilen eşya koşulları', () => {
    expect(objectiveMatches('collect_resource', {}, { type: 'collect_resource', amount: 4, resource: 'res.ferrolit' })).toBe(true);
    expect(objectiveMatches('collect_resource', { resource: ['res.kuvarsit'] }, { type: 'collect_resource', amount: 4, resource: 'res.ferrolit' })).toBe(false);
    expect(objectiveMatches('collect_resource', { map_types: ['border'] }, { type: 'collect_resource', amount: 4, resource: 'res.ferrolit', mapType: 'company' })).toBe(false);
    expect(objectiveMatches('craft_item', { item: ['res.nebulit'] }, { type: 'craft_item', amount: 2, item: 'res.nebulit' })).toBe(true);
  });
});
