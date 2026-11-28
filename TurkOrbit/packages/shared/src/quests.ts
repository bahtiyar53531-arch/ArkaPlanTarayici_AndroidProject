/**
 * Görev sistemi ortak kuralları (Aşama 10). Sunucu (API + oyun sunucusu) ve istemci aynı tanımları kullanır.
 *  - Döngü anahtarı: günlük/haftalık sıfırlama Türkiye saatiyle 05:00'te (UTC+3, yaz saati yok).
 *  - Hedef eşleme: oyun olayının bir görev hedefini ilerletip ilerletmediği.
 *  - Tohumlu seçim: günlük/haftalık görevler pilota ve döngüye özel, tekrarlanabilir biçimde seçilir.
 * İlerleme yalnızca sunucuda hesaplanır ve yazılır.
 */
import { z } from 'zod';

export const QUEST_CATEGORIES = ['main', 'daily', 'weekly', 'event'] as const;
export type QuestCategory = (typeof QUEST_CATEGORIES)[number];

export const QUEST_CATEGORY_LABELS: Record<QuestCategory, string> = {
  main: 'Ana ve zincir',
  daily: 'Günlük',
  weekly: 'Haftalık',
  event: 'Etkinlik',
};

/** Zincir adları (görev panosunda "Büyük Sıçrama 3/40" gibi gösterilir) */
export const QUEST_CHAIN_NAMES: Record<string, string> = {
  'buyuk-sicrama': 'Büyük Sıçrama',
  'cakal-avcisi': 'Çakal Avcısı',
  'akrep-zehri': 'Akrep Zehri',
  'orumcek-agi': 'Örümcek Ağı',
  'gece-kanatlari': 'Gece Kanatları',
  'sinir-devriyesi': 'Sınır Devriyesi',
  'cekirdege-yolculuk': 'Çekirdeğe Yolculuk',
  'usta-nisanci': 'Usta Nişancı',
  'sirket-onuru': 'Şirket Onuru',
  'altayin-mirasi': 'Altay\'ın Mirası',
};

export const OBJECTIVE_TYPES = [
  'kill_npc',
  'kill_player',
  'collect_cargo',
  'visit_map',
  'deal_damage',
  'travel_distance',
  'fire_rockets',
  'jump_portal',
  'upgrade_item',
  'buy_item',
  'reach_level',
  /** Aşama 11: madencilik ve üretim */
  'collect_resource',
  'craft_item',
] as const;
export type ObjectiveType = (typeof OBJECTIVE_TYPES)[number];

/** Hedef koşulları (hepsi isteğe bağlı; verilen her koşul sağlanmalı). */
export interface ObjectiveParams {
  npc?: string[];
  family?: string[];
  boss?: boolean;
  /** Harita kodları; "{c}" pilotun şirket önekiyle değiştirilir (K-2, G-2, A-2) */
  maps?: string[];
  map_types?: string[];
  /** deal_damage: 'npc' | 'player' */
  target?: 'npc' | 'player';
  /** upgrade_item: yükseltme sonrası en az bu seviye */
  min_level?: number;
  /** buy_item: eşya kategorisi */
  category?: string[];
  /** fire_rockets: roket kodu */
  rocket?: string[];
  /** collect_resource: kaynak kodu */
  resource?: string[];
  /** craft_item: üretilen eşya kodu */
  item?: string[];
}

/** Oyun sunucusunun veya hangarın ürettiği olay. amount: kaç birim (öldürme, hasar, mesafe…). */
export interface QuestEvent {
  type: ObjectiveType;
  amount: number;
  npc?: string;
  family?: string;
  boss?: boolean;
  map?: string;
  mapType?: string;
  target?: 'npc' | 'player';
  /** upgrade_item: ulaşılan seviye · reach_level: pilot seviyesi */
  level?: number;
  category?: string;
  rocket?: string;
  resource?: string;
  item?: string;
}

export const questEventSchema = z.strictObject({
  type: z.enum(OBJECTIVE_TYPES),
  amount: z.number().int().positive().max(1_000_000_000),
  npc: z.string().max(40).optional(),
  family: z.string().max(40).optional(),
  boss: z.boolean().optional(),
  map: z.string().max(10).optional(),
  mapType: z.string().max(20).optional(),
  target: z.enum(['npc', 'player']).optional(),
  level: z.number().int().min(0).max(100).optional(),
  category: z.string().max(40).optional(),
  rocket: z.string().max(40).optional(),
  resource: z.string().max(40).optional(),
  item: z.string().max(60).optional(),
});

/** "{c}" yer tutucusunu şirket önekiyle değiştirir. */
export function resolveCompanyText(text: string, companyPrefix: string): string {
  return text.split('{c}').join(companyPrefix);
}

export function resolveParams(p: ObjectiveParams, companyPrefix: string): ObjectiveParams {
  return p.maps ? { ...p, maps: p.maps.map((m) => resolveCompanyText(m, companyPrefix)) } : p;
}

/** reach_level ilerlemesi "en yüksek değer"dir; diğer hedefler birikerek artar. */
export const objectiveMode = (type: ObjectiveType): 'max' | 'add' => (type === 'reach_level' ? 'max' : 'add');

/** Olay bu hedefi ilerletir mi? (parametreler şirket önekiyle çözülmüş olmalı) */
export function objectiveMatches(type: ObjectiveType, p: ObjectiveParams, e: QuestEvent): boolean {
  if (e.type !== type || e.amount <= 0) return false;
  if (p.npc && (!e.npc || !p.npc.includes(e.npc))) return false;
  if (p.family && (!e.family || !p.family.includes(e.family))) return false;
  if (p.boss !== undefined && Boolean(e.boss) !== p.boss) return false;
  if (p.maps && (!e.map || !p.maps.includes(e.map))) return false;
  if (p.map_types && (!e.mapType || !p.map_types.includes(e.mapType))) return false;
  if (p.target && e.target !== p.target) return false;
  if (p.min_level !== undefined && (e.level ?? 0) < p.min_level) return false;
  if (p.category && (!e.category || !p.category.includes(e.category))) return false;
  if (p.rocket && (!e.rocket || !p.rocket.includes(e.rocket))) return false;
  if (p.resource && (!e.resource || !p.resource.includes(e.resource))) return false;
  if (p.item && (!e.item || !p.item.includes(e.item))) return false;
  return true;
}

/** Yeni ilerleme: hedefi aşmaz. */
export function advance(type: ObjectiveType, current: number, target: number, e: QuestEvent): number {
  const next = objectiveMode(type) === 'max' ? Math.max(current, e.level ?? 0) : current + e.amount;
  return Math.min(target, next);
}

// ------------------------------------------------------------------ döngüler (05:00 TSİ)
export const TR_UTC_OFFSET_HOURS = 3;

export interface QuestCycles {
  daily: string;
  weekly: string;
  /** Sonraki günlük/haftalık sıfırlama anı */
  nextDailyReset: Date;
  nextWeeklyReset: Date;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO 8601 hafta numarası (pazartesi başlangıçlı) — UTC alanları üzerinden. */
function isoWeek(d: Date): { year: number; week: number } {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  return { year: t.getUTCFullYear(), week: Math.ceil(((t.getTime() - yearStart) / 86_400_000 + 1) / 7) };
}

/**
 * Günlük döngü 05:00 TSİ'de başlar: anahtar, (şimdi + 3 sa − 5 sa) anının UTC tarihi.
 * Haftalık döngü pazartesi 05:00 TSİ'de başlar: aynı kaydırılmış anın ISO haftası.
 */
export function questCycles(now: Date, resetHourTr = 5): QuestCycles {
  const shiftMs = (TR_UTC_OFFSET_HOURS - resetHourTr) * 3_600_000;
  const s = new Date(now.getTime() + shiftMs);
  const daily = `${s.getUTCFullYear()}-${pad(s.getUTCMonth() + 1)}-${pad(s.getUTCDate())}`;
  const w = isoWeek(s);
  const weekly = `${w.year}-W${pad(w.week)}`;
  const dayStart = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate());
  const nextDailyReset = new Date(dayStart + 86_400_000 - shiftMs);
  const dow = s.getUTCDay() || 7; // 1 = pazartesi
  const nextWeeklyReset = new Date(dayStart + (8 - dow) * 86_400_000 - shiftMs);
  return { daily, weekly, nextDailyReset, nextWeeklyReset };
}

// ------------------------------------------------------------------ tohumlu seçim
/** 32 bit FNV-1a özeti */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 sözde rastgele üreteci */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Havuzdan n öğeyi tohuma göre seçer (aynı tohum → aynı seçim; sıra korunmaz). */
export function pickSeeded<T>(pool: readonly T[], n: number, seed: string): T[] {
  const rnd = mulberry32(fnv1a(seed));
  const a = [...pool];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a.slice(0, Math.max(0, n));
}

// ------------------------------------------------------------------ API tipleri
export type QuestStatus = 'available' | 'locked' | 'active' | 'completed' | 'claimed' | 'expired';

export interface QuestObjectiveView {
  id: number;
  type: ObjectiveType;
  label: string;
  current: number;
  target: number;
}

export interface QuestRewardView {
  type: 'currency' | 'item' | 'experience' | 'honor' | 'resource';
  code: string;
  name: string;
  amount: number;
}

export interface QuestView {
  code: string;
  category: QuestCategory;
  title: string;
  description: string;
  status: QuestStatus;
  /** 'once' veya döngü anahtarı ('2026-11-28', '2026-W48') */
  cycle: string;
  minLevel: number;
  /** locked: neden açılmadığı */
  lockedReason: string | null;
  chain: { code: string; order: number; total: number } | null;
  objectives: QuestObjectiveView[];
  rewards: QuestRewardView[];
  /** Etkinlik penceresi */
  startsAt: string | null;
  endsAt: string | null;
  completedAt: string | null;
  claimedAt: string | null;
}

export interface QuestsResponse {
  serverTime: string;
  level: number;
  cycles: { daily: string; weekly: string; nextDailyReset: string; nextWeeklyReset: string };
  rerolls: { daily: { used: number; max: number }; weekly: { used: number; max: number } };
  maxActive: number;
  activeCount: number;
  quests: QuestView[];
}

export interface QuestClaimResponse {
  quest: QuestView;
  reward: {
    xp: number;
    honor: number;
    currencies: Array<{ code: string; amount: number }>;
    items: Array<{ code: string; name: string; amount: number }>;
    level: number;
    levelUp: boolean;
  };
  replay: boolean;
}

/** Oyun içi canlı ilerleme (WebSocket 'qp' mesajı) */
export interface QuestProgressUpdate {
  code: string;
  title: string;
  category: QuestCategory;
  cycle: string;
  status: 'active' | 'completed';
  objectives: Array<{ id: number; current: number; target: number }>;
}

export const questActionSchema = z.strictObject({
  serverCode: z.string().trim().min(2).max(10),
  code: z.string().trim().min(1).max(60),
});
export const questClaimSchema = questActionSchema.extend({
  cycle: z.string().trim().min(1).max(20).optional(),
});
