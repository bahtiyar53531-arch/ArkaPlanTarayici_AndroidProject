/**
 * Türk Orbit ilerleme kuralları (seviye ve rütbe puanı).
 * Seviye ve rütbe puanı veritabanında SAKLANMAZ; her zaman bu saf fonksiyonlarla hesaplanır.
 * Sunucu otoritelidir: istemci bu fonksiyonları yalnızca ilerleme çubuğu çizmek için kullanır.
 */

export const MAX_LEVEL = 50;

/**
 * n. seviyeye ulaşmak için gereken TOPLAM deneyim.
 * Eğri: 5000 × (n−1)^2.4, 100'e yuvarlanmış (Türk Orbit'e özgü).
 * Örnek: Sv2 = 5.000 · Sv5 ≈ 139.300 · Sv10 ≈ 971.000 · Sv20 ≈ 5,87 milyon · Sv50 ≈ 56,9 milyon
 */
export function xpForLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1) throw new RangeError('Seviye 1 veya daha büyük bir tam sayı olmalı');
  if (level === 1) return 0;
  return Math.round((5000 * Math.pow(level - 1, 2.4)) / 100) * 100;
}

const XP_TABLE: readonly number[] = Array.from({ length: MAX_LEVEL }, (_, i) => xpForLevel(i + 1));

export function levelForXp(experience: number): number {
  if (!Number.isFinite(experience) || experience < 0) return 1;
  let level = 1;
  for (let i = 1; i < XP_TABLE.length; i++) {
    if (experience >= XP_TABLE[i]!) level = i + 1;
    else break;
  }
  return level;
}

export interface LevelProgress {
  level: number;
  experience: number;
  levelStartXp: number;
  /** Maksimum seviyede null. */
  nextLevelXp: number | null;
  /** 0..1 arası; maksimum seviyede 1. */
  progress: number;
}

export function levelProgress(experience: number): LevelProgress {
  const xp = Math.max(0, Math.floor(experience));
  const level = levelForXp(xp);
  const levelStartXp = XP_TABLE[level - 1]!;
  const nextLevelXp = level >= MAX_LEVEL ? null : XP_TABLE[level]!;
  const progress = nextLevelXp === null ? 1 : (xp - levelStartXp) / (nextLevelXp - levelStartXp);
  return { level, experience: xp, levelStartXp, nextLevelXp, progress: Math.min(1, Math.max(0, progress)) };
}

export interface RankInputs {
  experience: number;
  honor: number;
  npcKills: number;
  playerKills: number;
  gatesCompleted: number;
}

/**
 * Rütbe puanı (Türk Orbit formülü):
 *   deneyim/1000 + max(şeref,0)/10 + 2×NPC + 10×pilot yenme + 100×tamamlanan kapı
 * Negatif şeref rütbe puanını düşürmez, ancak Aşama 9'da PvP hasar cezası uygular.
 */
export function rankPoints(i: RankInputs): number {
  return (
    Math.floor(i.experience / 1000) +
    Math.floor(Math.max(0, i.honor) / 10) +
    2 * i.npcKills +
    10 * i.playerKills +
    100 * i.gatesCompleted
  );
}

export interface RankDefinition {
  id: number;
  name: string;
  minPoints: number;
}

/** Rütbe listesi min_points'e göre artan sırada olmalı. */
export function rankFor<T extends RankDefinition>(points: number, ranks: readonly T[]): { current: T; next: T | null } {
  if (ranks.length === 0) throw new Error('Rütbe listesi boş');
  let idx = 0;
  for (let i = 0; i < ranks.length; i++) {
    if (points >= ranks[i]!.minPoints) idx = i;
    else break;
  }
  return { current: ranks[idx]!, next: ranks[idx + 1] ?? null };
}
