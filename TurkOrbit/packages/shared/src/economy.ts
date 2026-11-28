/**
 * Ekonomi ortak kuralları (Aşama 11): açık artırma dönemleri ve teklif artışı, günlük giriş serisi,
 * üretim girdileri, istek şemaları ve API tipleri. Hesaplar sunucuda yapılır; istemci yalnızca gösterir.
 */
import { z } from 'zod';
import { questCycles } from './quests.js';

// ------------------------------------------------------------------ açık artırma
export const AUCTION_TYPES = ['hourly', 'daily', 'weekly'] as const;
export type AuctionType = (typeof AUCTION_TYPES)[number];
export const AUCTION_TYPE_LABELS: Record<AuctionType, string> = { hourly: 'Saatlik', daily: 'Günlük', weekly: 'Haftalık' };

export interface AuctionSettings {
  min_increment_pct: number;
  min_increment: number;
  snipe_window_seconds: number;
  extend_seconds: number;
}
export const DEFAULT_AUCTION_SETTINGS: AuctionSettings = { min_increment_pct: 5, min_increment: 100, snipe_window_seconds: 60, extend_seconds: 60 };

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Açık artırma dönemi. Saatlik: UTC saat başı (TSİ saat başıyla aynı).
 * Günlük ve haftalık: görevlerle aynı 05:00 TSİ sınırları.
 */
export function auctionPeriod(type: AuctionType, now: Date): { key: string; startsAt: Date; endsAt: Date } {
  if (type === 'hourly') {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours()));
    return { key: `${start.getUTCFullYear()}-${pad(start.getUTCMonth() + 1)}-${pad(start.getUTCDate())}T${pad(start.getUTCHours())}`, startsAt: start, endsAt: new Date(start.getTime() + 3_600_000) };
  }
  const c = questCycles(now);
  if (type === 'daily') return { key: c.daily, startsAt: new Date(c.nextDailyReset.getTime() - 86_400_000), endsAt: c.nextDailyReset };
  return { key: c.weekly, startsAt: new Date(c.nextWeeklyReset.getTime() - 7 * 86_400_000), endsAt: c.nextWeeklyReset };
}

/** Kabul edilecek en düşük teklif: ilk teklifte taban fiyat, sonrasında mevcut teklif + max(%artış, sabit artış). */
export function minNextBid(minBid: number, currentBid: number | null, s: AuctionSettings = DEFAULT_AUCTION_SETTINGS): number {
  if (currentBid === null) return minBid;
  return currentBid + Math.max(s.min_increment, Math.ceil((currentBid * s.min_increment_pct) / 100));
}

/** Son saniye teklifi (anti-sniping): bitişe "pencere"den az kaldıysa bitiş, tekliften "uzatma" kadar sonraya alınır. */
export function extendedEnd(endsAt: Date, now: Date, s: AuctionSettings = DEFAULT_AUCTION_SETTINGS): Date {
  if (endsAt.getTime() - now.getTime() < s.snipe_window_seconds * 1000) {
    return new Date(Math.max(endsAt.getTime(), now.getTime() + s.extend_seconds * 1000));
  }
  return endsAt;
}

// ------------------------------------------------------------------ günlük giriş ödülü
export const DAILY_REWARD_DAYS = 7;

/**
 * Seri: dün de alındıysa seri bir artar, alınmadıysa 1'den başlar. Takvim günü seriden (1..7, sonra başa döner).
 * Tarihler 05:00 TSİ'de başlayan oyun günüdür ('YYYY-MM-DD').
 */
export function dailyStreak(today: string, last: { date: string; streak: number } | null): { streak: number; day: number } {
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const streak = last && last.date === yesterday ? last.streak + 1 : 1;
  return { streak, day: ((streak - 1) % DAILY_REWARD_DAYS) + 1 };
}

// ------------------------------------------------------------------ üretim
export const recipeInputSchema = z.union([
  z.strictObject({ item: z.string().min(1).max(60), qty: z.number().int().positive() }),
  z.strictObject({ currency: z.string().min(1).max(10), qty: z.number().int().positive() }),
]);
export type RecipeInput = z.infer<typeof recipeInputSchema>;
export const RECIPE_CATEGORY_LABELS: Record<'refine' | 'craft', string> = { refine: 'Rafineri', craft: 'Atölye' };

// ------------------------------------------------------------------ istek şemaları
const serverCode = z.string().trim().min(2).max(10);
const requestId = z.string().uuid();

export const craftStartSchema = z.strictObject({
  serverCode,
  recipe: z.string().trim().min(1).max(40),
  batches: z.number().int().min(1).max(100),
  requestId,
});
export const craftClaimSchema = z.strictObject({ serverCode, jobId: z.number().int().positive() });
export const auctionBidSchema = z.strictObject({
  serverCode,
  auctionId: z.number().int().positive(),
  amount: z.number().int().positive().max(1_000_000_000_000),
  requestId,
});
export const dailyClaimSchema = z.strictObject({ serverCode });

// ------------------------------------------------------------------ API tipleri
export interface RecipeView {
  code: string;
  name: string;
  category: 'refine' | 'craft';
  output: { code: string; name: string; quantity: number };
  inputs: Array<{ kind: 'item' | 'currency'; code: string; name: string; qty: number; have: number }>;
  durationSeconds: number;
  minLevel: number;
  /** Elindekilerle en fazla kaç adet başlatılabilir (0 = yetersiz) */
  maxBatches: number;
  locked: boolean;
}

export interface CraftingJobView {
  id: number;
  recipe: string;
  name: string;
  batches: number;
  output: { code: string; name: string; quantity: number };
  startedAt: string;
  readyAt: string;
  ready: boolean;
}

export interface CraftingResponse {
  serverTime: string;
  level: number;
  slots: number;
  maxBatches: number;
  recipes: RecipeView[];
  jobs: CraftingJobView[];
  resources: Array<{ code: string; name: string; tier: number; quantity: number; sellPrice: number; itemId: string | null }>;
  cargo: { used: number; capacity: number };
}

export interface AuctionView {
  id: number;
  type: AuctionType;
  item: { code: string; name: string; category: string; rarity: string; quantity: number };
  currency: string;
  minBid: number;
  currentBid: number | null;
  /** Bir sonraki geçerli en düşük teklif */
  nextMinBid: number;
  bidCount: number;
  leading: boolean;
  /** Oyuncunun bu açık artırmadaki emanette bekleyen teklifi */
  myBid: number | null;
  endsAt: string;
  status: 'open' | 'settled' | 'cancelled';
  won: boolean;
}

export interface AuctionsResponse {
  serverTime: string;
  balances: Array<{ code: string; balance: number }>;
  open: AuctionView[];
  /** Oyuncunun katıldığı, sonuçlanmış son açık artırmalar */
  history: AuctionView[];
}

export interface DailyRewardView {
  day: number;
  rewards: Array<{ type: string; code: string; name: string; amount: number }>;
}

export interface DailyRewardResponse {
  serverTime: string;
  today: string;
  claimedToday: boolean;
  /** Bugün alınacak (veya alınmış) takvim günü */
  day: number;
  streak: number;
  nextReset: string;
  calendar: DailyRewardView[];
}
