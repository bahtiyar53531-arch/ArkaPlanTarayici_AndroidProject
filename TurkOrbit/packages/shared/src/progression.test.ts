import { describe, expect, it } from 'vitest';
import { levelForXp, levelProgress, MAX_LEVEL, rankFor, rankPoints, xpForLevel } from './progression.js';
import { createPilotSchema, updatePilotSchema } from './player.js';

describe('seviye eğrisi', () => {
  it('başlangıç değerleri', () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(5000);
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(4999)).toBe(1);
    expect(levelForXp(5000)).toBe(2);
  });

  it('kesin artan ve en fazla MAX_LEVEL', () => {
    for (let l = 2; l <= MAX_LEVEL; l++) expect(xpForLevel(l)).toBeGreaterThan(xpForLevel(l - 1));
    expect(levelForXp(Number.MAX_SAFE_INTEGER)).toBe(MAX_LEVEL);
  });

  it('her seviye sınırında doğru seviyeyi döner', () => {
    for (let l = 2; l <= MAX_LEVEL; l++) {
      expect(levelForXp(xpForLevel(l))).toBe(l);
      expect(levelForXp(xpForLevel(l) - 1)).toBe(l - 1);
    }
  });

  it('ilerleme oranı 0..1 arasında; maksimum seviyede 1', () => {
    const p = levelProgress(xpForLevel(10) + (xpForLevel(11) - xpForLevel(10)) / 2);
    expect(p.level).toBe(10);
    expect(p.progress).toBeCloseTo(0.5, 2);
    const max = levelProgress(xpForLevel(MAX_LEVEL) + 1);
    expect(max.nextLevelXp).toBeNull();
    expect(max.progress).toBe(1);
    expect(levelProgress(-50).level).toBe(1);
  });
});

describe('rütbe', () => {
  const ranks = [
    { id: 1, name: 'A', minPoints: 0 },
    { id: 2, name: 'B', minPoints: 100 },
    { id: 3, name: 'C', minPoints: 400 },
  ];
  it('rütbe puanı formülü; negatif şeref düşürmez', () => {
    expect(rankPoints({ experience: 25_500, honor: 95, npcKills: 3, playerKills: 1, gatesCompleted: 1 })).toBe(25 + 9 + 6 + 10 + 100);
    expect(rankPoints({ experience: 0, honor: -5000, npcKills: 0, playerKills: 0, gatesCompleted: 0 })).toBe(0);
  });
  it('puana göre mevcut ve sonraki rütbe', () => {
    expect(rankFor(0, ranks).current.name).toBe('A');
    expect(rankFor(99, ranks).next?.name).toBe('B');
    expect(rankFor(100, ranks).current.name).toBe('B');
    expect(rankFor(10_000, ranks)).toEqual({ current: ranks[2], next: null });
  });
});

describe('profil şemaları', () => {
  it('pilot oluşturmada seviye/para gibi alanlar reddedilir', () => {
    expect(createPilotSchema.safeParse({ serverCode: 'tr1', companyCode: 'kzl' }).data).toEqual({ serverCode: 'TR1', companyCode: 'KZL' });
    expect(createPilotSchema.safeParse({ serverCode: 'TR1', companyCode: 'KZL', experience: 999999 }).success).toBe(false);
  });
  it('profil güncellemede yalnızca slogan değişebilir', () => {
    expect(updatePilotSchema.safeParse({ serverCode: 'TR1', motto: '  Gökyüzü sınır değil  ' }).data?.motto).toBe('Gökyüzü sınır değil');
    expect(updatePilotSchema.safeParse({ serverCode: 'TR1', motto: '' }).data?.motto).toBeNull();
    expect(updatePilotSchema.safeParse({ serverCode: 'TR1', motto: 'x', honor: 5 }).success).toBe(false);
    expect(updatePilotSchema.safeParse({ serverCode: 'TR1', motto: 'a'.repeat(81) }).success).toBe(false);
    expect(updatePilotSchema.safeParse({ serverCode: 'TR1', motto: 'gizli‮metin' }).success).toBe(false);
  });
});
