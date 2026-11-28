import { z } from 'zod';
import type { LevelProgress } from './progression.js';

// ------------------------------------------------------------------ doğrulama şemaları

const codeSchema = (label: string) =>
  z
    .string({ message: `${label} gerekli.` })
    .trim()
    .min(1, { message: `${label} gerekli.` })
    .max(16)
    .regex(/^[A-Za-z0-9-]+$/, { message: `${label} geçersiz.` })
    .transform((v) => v.toUpperCase());

/** Pilot oluşturma: pilot adı hesabın kullanıcı adıdır; istemci seviye/para/gemi gibi alan gönderemez. */
export const createPilotSchema = z.strictObject({
  serverCode: codeSchema('Sunucu'),
  companyCode: codeSchema('Şirket'),
});

// Kontrol karakterleri ve görünmez yön karakterleri sloganda kabul edilmez.
const FORBIDDEN_CHARS = /[\u0000-\u001F\u007F​-‏‪-‮⁦-⁩]/;

/** Oyuncunun düzenleyebileceği TEK profil alanları. İstatistikler bu şemada yoktur. */
export const updatePilotSchema = z.strictObject({
  serverCode: codeSchema('Sunucu'),
  motto: z
    .string()
    .trim()
    .max(80, { message: 'Slogan en fazla 80 karakter olabilir.' })
    .refine((v) => !FORBIDDEN_CHARS.test(v), { message: 'Slogan geçersiz karakter içeriyor.' })
    .transform((v) => (v === '' ? null : v))
    .nullable(),
});

export const changeCompanySchema = z.strictObject({
  serverCode: codeSchema('Sunucu'),
  companyCode: codeSchema('Şirket'),
});

// ------------------------------------------------------------------ API tipleri

export interface GameServerInfo {
  code: string;
  name: string;
  region: string;
  isOpen: boolean;
  isMaintenance: boolean;
  pilotCount: number;
  hasMyPilot: boolean;
}

export interface CompanyInfo {
  code: string;
  name: string;
  motto: string;
  description: string;
  focus: string;
  colorHex: string;
  homeMap: { code: string; name: string };
  pilotCount: number;
}

export interface CurrencyBalance {
  code: string;
  name: string;
  isPremium: boolean;
  balance: number;
}

export interface PilotStats {
  npcKills: number;
  playerKills: number;
  deaths: number;
  gatesCompleted: number;
  cargoCollected: number;
  damageDealt: number;
  damageTaken: number;
}

export interface AchievementProgress {
  code: string;
  name: string;
  description: string;
  category: string;
  target: number;
  progress: number;
  completedAt: string | null;
}

export interface RankInfo {
  id: number;
  name: string;
  points: number;
  minPoints: number;
  next: { name: string; minPoints: number } | null;
}

/** Pilotun sahibine gösterilen tam profil. */
export interface PilotProfile {
  id: string;
  /** Hesabın Oyuncu ID'si (users.public_id). */
  playerId: number;
  pilotName: string;
  server: { code: string; name: string };
  company: { code: string; name: string; colorHex: string };
  level: LevelProgress;
  honor: number;
  rank: RankInfo;
  currencies: CurrencyBalance[];
  activeShip: {
    code: string;
    name: string;
    shipClass: string;
    spriteKey: string;
    hitpoints: number;
    maxHitpoints: number;
    speed: number;
    cargoCapacity: number;
    slots: { laser: number; generator: number; extra: number; drone: number };
  } | null;
  map: { code: string; name: string; mapType: string; pvpEnabled: boolean; x: number; y: number };
  playtimeSeconds: number;
  stats: PilotStats;
  achievements: { earned: number; total: number; items: AchievementProgress[] };
  motto: string | null;
  companyChange: { availableAt: string | null; cost: { currency: string; amount: number }; cooldownDays: number };
  /** Klan sistemi Aşama 12'de gelir; o zamana kadar her zaman null. */
  clan: null;
  createdAt: string;
  lastOnlineAt: string | null;
}

/** Herkese açık profil: e-posta, para, konum ve oynama süresi gibi özel bilgiler İÇERMEZ. */
export interface PublicPilotProfile {
  playerId: number;
  pilotName: string;
  server: { code: string; name: string };
  company: { code: string; name: string; colorHex: string };
  level: number;
  honor: number;
  rank: { id: number; name: string };
  motto: string | null;
  stats: Pick<PilotStats, 'npcKills' | 'playerKills' | 'gatesCompleted'>;
  achievements: { earned: number; total: number; items: Array<Pick<AchievementProgress, 'code' | 'name' | 'completedAt'>> };
  activeShip: { name: string; spriteKey: string } | null;
  createdAt: string;
}

export interface LedgerEntry {
  id: string;
  currency: string;
  delta: number;
  balanceAfter: number;
  reason: string;
  createdAt: string;
}

export const LEDGER_REASON_LABELS_TR: Record<string, string> = {
  starter_grant: 'Başlangıç desteği',
  company_change: 'Şirket değiştirme ücreti',
  item_sell: 'Eşya satışı',
  item_upgrade: 'Ekipman yükseltme',
  ship_repair: 'Gemi tamiri',
  admin_grant: 'Yönetici işlemi',
  npc_reward: 'NPC ödülü',
  quest_reward: 'Görev ödülü',
  shop_purchase: 'Mağaza alışverişi',
  auction_bid: 'Açık artırma teklifi',
  auction_refund: 'Açık artırma iadesi',
  cargo_loot: 'Kargo kutusu',
  crafting_input: 'Üretim ücreti',
  daily_login: 'Günlük giriş ödülü',
};
