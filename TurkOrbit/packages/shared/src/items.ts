/**
 * Türk Orbit eşya ve hangar kuralları (istemci + API + ileride oyun sunucusu ortak kullanır).
 * - Kategori bazlı istatistik şemaları: veritabanındaki stats jsonb her okunduğunda sunucuda doğrulanır.
 * - Slot uyumluluğu: hangi eşya hangi slota takılabilir.
 * - computeLoadoutStats: bir konfigürasyonun toplam savaş değerleri (tamamen sunucu otoriteli hesap).
 */
import { z } from 'zod';

export const ITEM_CATEGORIES = [
  'laser',
  'ammo',
  'rocket',
  'rocket_launcher',
  'shield_generator',
  'speed_generator',
  'extra',
  'drone',
  'pet',
  'pet_module',
  'ship_design',
  /** Aşama 11: kaynaklar (cevher ve rafineri ürünleri, yığınlanabilir) */
  'resource',
] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

export const ITEM_CATEGORY_LABELS_TR: Record<ItemCategory, string> = {
  laser: 'Lazer topu',
  ammo: 'Lazer mermisi',
  rocket: 'Roket',
  rocket_launcher: 'Roket atar',
  shield_generator: 'Kalkan jeneratörü',
  speed_generator: 'Hız jeneratörü',
  extra: 'Ekstra modül',
  drone: 'Drone',
  pet: 'PET',
  pet_module: 'PET modülü',
  ship_design: 'Gemi tasarımı',
  resource: 'Kaynak',
};

export const SHIP_CLASS_LABELS_TR: Record<string, string> = {
  starter: 'Başlangıç gemisi',
  light: 'Hafif avcı',
  fighter: 'Avcı',
  multirole: 'Çok yönlü',
  scout: 'Keşif',
  heavy: 'Ağır avcı',
  support: 'Destek',
  tank: 'Tank',
  assault: 'Saldırı',
  elite: 'Elit',
};

export const RARITY_LABELS_TR: Record<string, string> = {
  common: 'Sıradan',
  uncommon: 'Nadir olmayan',
  rare: 'Nadir',
  epic: 'Destansı',
  legendary: 'Efsanevi',
};

// ------------------------------------------------------------------ istatistik şemaları
const pos = z.number().int().positive();
const ratio = z.number().min(0).max(1);

export const ITEM_STATS_SCHEMAS = {
  laser: z.strictObject({ damage: pos, rateMs: z.number().int().min(250), range: pos }),
  ammo: z.strictObject({ multiplier: z.number().min(1).max(10), shieldLeech: ratio.optional() }),
  rocket: z.strictObject({
    damage: pos,
    cooldownMs: z.number().int().min(250),
    range: pos,
    aoeRadius: pos.optional(),
    slowMs: pos.optional(),
  }),
  rocket_launcher: z.strictObject({ volley: z.number().int().min(1).max(10), reloadMs: z.number().int().min(500) }),
  shield_generator: z.strictObject({ shield: pos, absorb: ratio }),
  speed_generator: z.strictObject({ speed: pos }),
  extra: z.strictObject({ kind: z.enum(['cargo', 'repair', 'radar']), value: pos }),
  drone: z.strictObject({ gearSlots: z.number().int().min(1).max(3), bonus: z.number().min(0).max(0.5) }),
  pet: z.strictObject({ moduleSlots: z.number().int().min(1).max(8), hitpoints: pos }),
  pet_module: z.strictObject({ kind: z.enum(['collector', 'repair', 'guard', 'follow']), value: pos }),
  ship_design: z.strictObject({ spriteKey: z.string().regex(/^ship-[a-z0-9-]+$/) }),
  resource: z.strictObject({ tier: z.number().int().min(1).max(4) }),
} satisfies Record<ItemCategory, z.ZodType>;

export type ItemStats<C extends ItemCategory> = z.infer<(typeof ITEM_STATS_SCHEMAS)[C]>;

/** Veritabanından gelen istatistikleri doğrular; bozuk veri sessizce kullanılmaz. */
export function parseItemStats<C extends ItemCategory>(category: C, stats: unknown): ItemStats<C> {
  const r = ITEM_STATS_SCHEMAS[category].safeParse(stats);
  if (!r.success) {
    throw new Error(`Geçersiz eşya istatistiği (${category}): ${r.error.issues.map((i) => i.message).join(', ')}`);
  }
  return r.data as ItemStats<C>;
}

// ------------------------------------------------------------------ slotlar
export const SLOT_TYPES = ['laser', 'generator', 'extra', 'drone', 'drone_gear'] as const;
export type SlotType = (typeof SLOT_TYPES)[number];

export const SLOT_LABELS_TR: Record<SlotType, string> = {
  laser: 'Lazer',
  generator: 'Jeneratör',
  extra: 'Ekstra',
  drone: 'Drone',
  drone_gear: 'Drone ekipmanı',
};

/** Hangi slota hangi kategori takılabilir. */
export const SLOT_ACCEPTS: Record<SlotType, readonly ItemCategory[]> = {
  laser: ['laser'],
  generator: ['shield_generator', 'speed_generator'],
  extra: ['extra', 'rocket_launcher'],
  drone: ['drone'],
  drone_gear: ['laser', 'shield_generator'],
};

export function slotAccepts(slot: SlotType, category: ItemCategory): boolean {
  return SLOT_ACCEPTS[slot].includes(category);
}

export interface ShipSlots {
  laser: number;
  generator: number;
  extra: number;
  drone: number;
}

/** drone_gear slotlarının sayısı drone slot sayısına eşittir (her drone'a bir ekipman). */
export function slotCount(slots: ShipSlots, slot: SlotType): number {
  return slot === 'drone_gear' ? slots.drone : slots[slot];
}

// ------------------------------------------------------------------ konfigürasyon istatistikleri
export interface EquippedForStats {
  slotType: SlotType;
  slotIndex: number;
  category: ItemCategory;
  stats: unknown;
  /** Sunucunun upgrade_levels tablosundan çözdüğü çarpan (seviye 0 → 1). */
  upgradeMultiplier: number;
}

export interface ShipForStats {
  hitpoints: number;
  baseSpeed: number;
  cargoCapacity: number;
}

export interface LoadoutStats {
  hitpoints: number;
  lasers: number;
  /** Bir atış turundaki toplam lazer hasarı (×1 mermiyle). */
  damagePerVolley: number;
  /** Saniyedeki lazer hasarı (×1 mermiyle). */
  damagePerSecond: number;
  /** En kısa lazer menzili (tüm toplar bu mesafede ateş edebilir). 0 = lazer yok. */
  laserRange: number;
  shield: number;
  /** Kalkanların ağırlıklı ortalama emme oranı (0..1). */
  shieldAbsorb: number;
  speed: number;
  cargo: number;
  rocketVolley: number;
  repairPerSecond: number;
  radarBonus: number;
  drones: number;
}

const round = (n: number) => Math.round(n);

export function computeLoadoutStats(ship: ShipForStats, equipped: readonly EquippedForStats[]): LoadoutStats {
  const droneBonus = new Map<number, number>();
  for (const e of equipped) {
    if (e.slotType === 'drone' && e.category === 'drone') {
      const s = parseItemStats('drone', e.stats);
      // Drone yükseltmesi taşıdığı ekipmanın bonusunu artırır.
      droneBonus.set(e.slotIndex, s.bonus * e.upgradeMultiplier + (e.upgradeMultiplier - 1));
    }
  }

  let lasers = 0;
  let damagePerVolley = 0;
  let dps = 0;
  let range = Number.POSITIVE_INFINITY;
  let shield = 0;
  let absorbWeighted = 0;
  let speedBonus = 0;
  let cargoBonus = 0;
  let rocketVolley = 1;
  let repair = 0;
  let radar = 0;

  for (const e of equipped) {
    let mult = e.upgradeMultiplier;
    if (e.slotType === 'drone_gear') {
      if (!droneBonus.has(e.slotIndex)) continue; // drone'u olmayan ekipman etkisizdir
      mult *= 1 + droneBonus.get(e.slotIndex)!;
    }
    switch (e.category) {
      case 'laser': {
        const s = parseItemStats('laser', e.stats);
        lasers++;
        damagePerVolley += s.damage * mult;
        dps += (s.damage * mult * 1000) / s.rateMs;
        range = Math.min(range, s.range);
        break;
      }
      case 'shield_generator': {
        const s = parseItemStats('shield_generator', e.stats);
        const value = s.shield * mult;
        shield += value;
        absorbWeighted += value * s.absorb;
        break;
      }
      case 'speed_generator': {
        const s = parseItemStats('speed_generator', e.stats);
        speedBonus += s.speed * mult;
        break;
      }
      case 'rocket_launcher': {
        const s = parseItemStats('rocket_launcher', e.stats);
        rocketVolley = Math.max(rocketVolley, s.volley);
        break;
      }
      case 'extra': {
        const s = parseItemStats('extra', e.stats);
        if (s.kind === 'cargo') cargoBonus += s.value;
        if (s.kind === 'repair') repair += s.value;
        if (s.kind === 'radar') radar += s.value;
        break;
      }
      default:
        break;
    }
  }

  return {
    hitpoints: ship.hitpoints,
    lasers,
    damagePerVolley: round(damagePerVolley),
    damagePerSecond: round(dps),
    laserRange: lasers > 0 ? range : 0,
    shield: round(shield),
    shieldAbsorb: shield > 0 ? Math.round((absorbWeighted / shield) * 1000) / 1000 : 0,
    speed: round(ship.baseSpeed + speedBonus),
    cargo: ship.cargoCapacity + cargoBonus,
    rocketVolley,
    repairPerSecond: repair,
    radarBonus: radar,
    drones: droneBonus.size,
  };
}

// ------------------------------------------------------------------ istek şemaları
const server = z.string().trim().regex(/^[A-Za-z0-9-]{1,16}$/).transform((v) => v.toUpperCase());
const uuid = z.uuid({ message: 'Geçersiz kimlik.' });
/** İstemcinin her işlem için ürettiği benzersiz kimlik: çift tıklama / ağ tekrarında işlem iki kez uygulanmaz. */
const requestId = z.uuid({ message: 'requestId bir UUID olmalı.' });
const loadout = z.union([z.literal(1), z.literal(2)]);

export const equipSchema = z.strictObject({
  serverCode: server,
  shipId: uuid,
  loadout,
  slotType: z.enum(SLOT_TYPES),
  slotIndex: z.number().int().min(0).max(31),
  itemId: uuid,
});
export const unequipSchema = equipSchema.omit({ itemId: true });
export const setLoadoutSchema = z.strictObject({ serverCode: server, loadout });
export const shipActionSchema = z.strictObject({ serverCode: server });
export const repairSchema = z.strictObject({ serverCode: server, requestId });
export const designSchema = z.strictObject({ serverCode: server, itemId: uuid.nullable() });
export const purchaseSchema = z.strictObject({
  serverCode: server,
  offerId: z.number().int().positive(),
  packs: z.number().int().min(1).max(1000).default(1),
  requestId,
});
export const sellSchema = z.strictObject({
  serverCode: server,
  quantity: z.number().int().min(1).max(1_000_000_000).default(1),
  requestId,
});
export const upgradeSchema = z.strictObject({ serverCode: server, requestId });
export const petRenameSchema = z.strictObject({
  serverCode: server,
  name: z.string().trim().min(2, { message: 'PET adı en az 2 karakter olmalı.' }).max(20).regex(/^[\p{L}\p{N} _-]+$/u, {
    message: 'PET adı yalnızca harf, rakam, boşluk, - ve _ içerebilir.',
  }),
});
export const petModuleSchema = z.strictObject({
  serverCode: server,
  slotIndex: z.number().int().min(0).max(7),
  itemId: uuid.nullable(),
});

// ------------------------------------------------------------------ API tipleri
export interface ShipTypeInfo {
  code: string;
  name: string;
  description: string | null;
  shipClass: string;
  spriteKey: string;
  hitpoints: number;
  baseSpeed: number;
  cargoCapacity: number;
  slots: ShipSlots;
  minLevel: number;
}

export interface LoadoutSlot {
  slotType: SlotType;
  slotIndex: number;
  itemId: string;
}

export interface HangarShip {
  id: string;
  type: ShipTypeInfo;
  /** Uygulanmış tasarım varsa onun sprite anahtarı. */
  spriteKey: string;
  design: { itemId: string; name: string } | null;
  hitpoints: number;
  maxHitpoints: number;
  isActive: boolean;
  loadouts: { 1: LoadoutSlot[]; 2: LoadoutSlot[] };
  stats: { 1: LoadoutStats; 2: LoadoutStats };
  repairCost: { currency: string; amount: number } | null;
}

export interface InventoryItem {
  id: string;
  code: string;
  name: string;
  description: string;
  category: ItemCategory;
  rarity: string;
  iconKey: string;
  quantity: number;
  upgradeLevel: number;
  maxUpgradeLevel: number;
  minLevel: number;
  stats: Record<string, unknown>;
  sellPrice: number;
  bound: boolean;
  equippedIn: Array<{ shipId: string; loadout: 1 | 2; slotType: SlotType; slotIndex: number }>;
  /** PET eşyası mı, PET modülü olarak takılı mı, hangi gemiye tasarım olarak uygulanmış? */
  usage: { pet: boolean; petModuleSlot: number | null; designShipId: string | null };
  nextUpgrade: { level: number; chance: number; currency: string; amount: number } | null;
  requiresShip: string | null;
}

export interface HangarResponse {
  serverCode: string;
  playerLevel: number;
  activeShipId: string | null;
  activeLoadout: 1 | 2;
  ships: HangarShip[];
  inventory: InventoryItem[];
  inventoryLimit: number;
  pet: {
    name: string;
    itemId: string;
    level: number;
    moduleSlots: number;
    modules: Array<{ slotIndex: number; itemId: string }>;
  } | null;
  currencies: Array<{ code: string; name: string; balance: number }>;
}

export interface ShopOffer {
  id: number;
  type: 'item' | 'ship' | 'bundle';
  code: string;
  name: string;
  description: string;
  category: ItemCategory | 'ship' | 'bundle';
  rarity: string;
  iconKey: string;
  stats: Record<string, unknown>;
  ship: ShipTypeInfo | null;
  quantity: number;
  currency: string;
  price: number;
  finalPrice: number;
  discountPercent: number;
  maxPerPurchase: number;
  minLevel: number;
  owned: boolean;
  limitReached: boolean;
  requiresShip: string | null;
  /** Aşama 11: paket içeriği (type = 'bundle') */
  bundle: Array<{ code: string; name: string; category: ItemCategory; quantity: number }> | null;
}

export interface ShopResponse {
  playerLevel: number;
  currencies: Array<{ code: string; name: string; balance: number }>;
  categories: Array<{ code: string; name: string; offers: ShopOffer[] }>;
}

export const ITEM_LEDGER_REASON_LABELS_TR: Record<string, string> = {
  starter_kit: 'Başlangıç ekipmanı',
  shop_purchase: 'Mağazadan alındı',
  item_sell: 'Satıldı',
  admin_grant: 'Yönetici işlemi',
  npc_reward: 'NPC ödülü',
  cargo_loot: 'Kargo kutusu',
  ammo_used: 'Savaşta harcandı',
  quest_reward: 'Görev ödülü',
  mining: 'Madencilik',
  crafting_input: 'Üretimde kullanıldı',
  crafting_output: 'Üretildi',
  auction_win: 'Açık artırma kazancı',
  daily_login: 'Günlük giriş ödülü',
};
