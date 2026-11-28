/**
 * Türk Orbit savaş kuralları (Aşama 9). Oyun sunucusu bu fonksiyonlarla KARAR verir;
 * istemci yalnızca göstermek için (ör. mühimmat çubuğu, hedef paneli) aynı tanımları kullanır.
 */

/** Mühimmat çubuğu sırası (1–5 tuşları) */
export const AMMO_CODES = ['ammo.isk1', 'ammo.isk2', 'ammo.isk3', 'ammo.isk4', 'ammo.se50'] as const;
export type AmmoCode = (typeof AMMO_CODES)[number];
/** Roket sırası */
export const ROCKET_CODES = ['rocket.yildirim', 'rocket.simsek', 'rocket.tufan', 'rocket.buz'] as const;
export type RocketCode = (typeof ROCKET_CODES)[number];

export const AMMO_LABELS: Record<AmmoCode, string> = {
  'ammo.isk1': 'IŞK-1',
  'ammo.isk2': 'IŞK-2',
  'ammo.isk3': 'IŞK-3',
  'ammo.isk4': 'IŞK-4',
  'ammo.se50': 'SE-50',
};
export const ROCKET_LABELS: Record<RocketCode, string> = {
  'rocket.yildirim': 'Yıldırım',
  'rocket.simsek': 'Şimşek',
  'rocket.tufan': 'Tufan',
  'rocket.buz': 'Buz-R',
};
/** Lazer ışını renkleri (istemci) */
export const AMMO_COLORS: Record<AmmoCode, number> = {
  'ammo.isk1': 0xff4d4d,
  'ammo.isk2': 0x46e07a,
  'ammo.isk3': 0x4da3ff,
  'ammo.isk4': 0xf2f2ff,
  'ammo.se50': 0x29e0e0,
};

export interface CombatSettings {
  respawn_hp_ratio: number;
  shield_regen_delay_ms: number;
  shield_regen_ratio_per_sec: number;
  repair_delay_ms: number;
  loot_owner_ms: number;
  loot_ttl_ms: number;
  loot_pickup_radius: number;
  pvp_honor: number;
  damage_variance: number;
  out_of_combat_ms: number;
}

export const DEFAULT_COMBAT_SETTINGS: CombatSettings = {
  respawn_hp_ratio: 0.1,
  shield_regen_delay_ms: 4000,
  shield_regen_ratio_per_sec: 0.08,
  repair_delay_ms: 5000,
  loot_owner_ms: 15000,
  loot_ttl_ms: 60000,
  loot_pickup_radius: 90,
  pvp_honor: 100,
  damage_variance: 0.1,
  out_of_combat_ms: 5000,
};

// ------------------------------------------------------------------ hasar
export interface Durability {
  hp: number;
  shield: number;
  /** Gelen hasarın kalkanın üstlendiği oranı (0..1) */
  absorb: number;
}

export interface DamageResult {
  hull: number;
  shield: number;
  /** Hasar sonrası can ve kalkan */
  hp: number;
  shieldLeft: number;
  killed: boolean;
}

/**
 * Hasarın `absorb` oranı kalkana (kalkan bittiyse gövdeye), kalanı gövdeye gider.
 * Değerler tam sayıya yuvarlanır; can 0'ın altına düşmez.
 */
export function applyDamage(d: Durability, amount: number): DamageResult {
  const total = Math.max(0, Math.round(amount));
  const toShield = Math.min(d.shield, Math.round(total * d.absorb));
  const toHull = Math.min(d.hp, total - toShield);
  const hp = d.hp - toHull;
  return { hull: toHull, shield: toShield, hp, shieldLeft: d.shield - toShield, killed: hp <= 0 };
}

/** Taban hasara ±varyans uygular. rng: [0,1) */
export function rollDamage(base: number, variance: number, rng: () => number): number {
  return Math.max(0, Math.round(base * (1 - variance + rng() * variance * 2)));
}

// ------------------------------------------------------------------ saldırı izni
export interface AttackContext {
  targetKind: 'npc' | 'pilot' | 'cargo';
  mapPvp: boolean;
  attackerCompany: string;
  targetCompany?: string;
  attackerInSafeZone: boolean;
  targetInSafeZone: boolean;
  /** Aşama 12: pilotlar arası ilişki (grup, klan, klanlar arası diplomasi) */
  relation?: import('./social.js').PilotRelation | null;
}

export type AttackVerdict = { ok: true } | { ok: false; reason: string };

/** Sunucu her atışta bu kuralı uygular. */
export function canAttack(c: AttackContext): AttackVerdict {
  if (c.targetKind === 'cargo') return { ok: false, reason: 'Kargo kutusuna saldırılamaz.' };
  if (c.attackerInSafeZone) return { ok: false, reason: 'Güvenli bölgede saldırı yapılamaz.' };
  if (c.targetInSafeZone) return { ok: false, reason: 'Hedef güvenli bölgede.' };
  if (c.targetKind === 'pilot') {
    if (!c.mapPvp) return { ok: false, reason: 'Bu haritada pilotlara saldırılamaz.' };
    switch (c.relation) {
      case 'party':
        return { ok: false, reason: 'Grup arkadaşına saldıramazsın.' };
      case 'clan':
        return { ok: false, reason: 'Kendi klanından pilota saldıramazsın.' };
      case 'alliance':
        return { ok: false, reason: 'Müttefik klandan pilota saldıramazsın.' };
      case 'non_aggression':
        return { ok: false, reason: 'Saldırmazlık anlaşması olan klandan pilota saldıramazsın.' };
      case 'war':
        // Savaştaki klanlar aynı şirketten olsa da birbirine saldırabilir (PvP haritası ve güvenli bölge kuralları geçerli)
        return { ok: true };
      default:
        break;
    }
    if (c.targetCompany === c.attackerCompany) return { ok: false, reason: 'Kendi şirketinden pilota saldıramazsın.' };
  }
  return { ok: true };
}

// ------------------------------------------------------------------ ödüller
export interface RewardEntry {
  reward_type: 'currency' | 'item' | 'experience' | 'honor' | 'resource';
  ref_code: string;
  min_amount: number;
  max_amount: number;
  chance: number;
  delivery: 'direct' | 'cargo';
}

export interface RolledReward {
  type: RewardEntry['reward_type'];
  code: string;
  amount: number;
}

/** Her kayıt için şans zarı atılır; geçerse [min,max] aralığında miktar seçilir. */
export function rollRewards(entries: readonly RewardEntry[], rng: () => number): { direct: RolledReward[]; cargo: RolledReward[] } {
  const direct: RolledReward[] = [];
  const cargo: RolledReward[] = [];
  for (const e of entries) {
    if (e.chance < 1 && rng() >= e.chance) continue;
    const amount = e.min_amount + Math.floor(rng() * (e.max_amount - e.min_amount + 1));
    if (amount <= 0) continue;
    (e.delivery === 'cargo' ? cargo : direct).push({ type: e.reward_type, code: e.ref_code, amount });
  }
  return { direct, cargo };
}

export interface Contributor {
  id: string;
  /** NPC'ye verdiği toplam hasar (kalkan + gövde) */
  damage: number;
  /** Ödül anında hâlâ aynı haritada mı (ayrılanın payı kimseye verilmez) */
  present: boolean;
}

export interface RewardShare {
  id: string;
  /** Toplam hasar içindeki payı (0–1) */
  share: number;
  /** En çok hasar veren mi (öldürme kaydı, eşya ve kargo kutusu onundur) */
  top: boolean;
  rewards: RolledReward[];
}

const SPLIT_TYPES: ReadonlySet<RolledReward['type']> = new Set(['currency', 'experience', 'honor']);

/**
 * Ödülü hasar katkısına göre böler (sunucuda uygulanır).
 * - Kredi/Akçe, deneyim ve şeref: her pilota `aşağı yuvarla(miktar × pay)`; yuvarlama artığı en çok hasar verene.
 * - Eşya ve kaynak (bölünemez): en çok hasar verene.
 * - Haritadan ayrılan pilotun payı kimseye dağıtılmaz (ödül çiftlenemez, ayrılan pilot ödül alamaz).
 * - Payı hiçbir ödüle yetmeyen pilot listede yer almaz.
 */
export function splitRewards(rewards: readonly RolledReward[], contributors: readonly Contributor[]): RewardShare[] {
  const total = contributors.reduce((a, c) => a + Math.max(0, c.damage), 0);
  const present = contributors.filter((c) => c.present && c.damage > 0);
  if (total <= 0 || present.length === 0) return [];
  // Eşitlikte ilk vuran (listede önce gelen) en çok hasar veren sayılır
  const top = present.reduce((a, b) => (b.damage > a.damage ? b : a));
  const presentShare = present.reduce((a, c) => a + c.damage, 0) / total;
  const out = present.map((c) => ({ id: c.id, share: c.damage / total, top: c === top, rewards: [] as RolledReward[] }));
  const topOut = out.find((o) => o.top)!;
  for (const r of rewards) {
    if (!SPLIT_TYPES.has(r.type)) {
      topOut.rewards.push({ ...r });
      continue;
    }
    const pool = Math.floor(r.amount * presentShare + 1e-9);
    let given = 0;
    for (const o of out) {
      if (o.top) continue;
      const a = Math.floor(r.amount * o.share + 1e-9);
      if (a > 0) o.rewards.push({ ...r, amount: a });
      given += a;
    }
    if (pool - given > 0) topOut.rewards.push({ ...r, amount: pool - given });
  }
  return out.filter((o) => o.top || o.rewards.length > 0);
}

/** Laser atış aralığı (ms): tur hasarı / saniyelik hasar. */
export function volleyIntervalMs(damagePerVolley: number, damagePerSecond: number): number {
  if (damagePerVolley <= 0 || damagePerSecond <= 0) return 0;
  return Math.max(250, Math.round((damagePerVolley / damagePerSecond) * 1000));
}

// ------------------------------------------------------------------ protokol (Aşama 9 ekleri)
/** Görsel efektler (anlık görüntüyle birlikte gönderilir):
 *  ['l', atanId, hedefId, mühimmatSırası]  lazer
 *  ['r', atanId, hedefId, roketSırası]     roket
 *  ['d', hedefId, miktar, 1=kalkan/0=gövde] hasar sayısı
 *  ['x', varlıkId, x, y, boyut]             patlama */
export type Fx =
  | ['l', number, number, number]
  | ['r', number, number, number]
  | ['d', number, number, number]
  | ['x', number, number, number, number];

export interface CombatState {
  target: number | null;
  attacking: boolean;
  ammo: AmmoCode;
  rocket: RocketCode;
  counts: Record<string, number>;
  /** Roketin yeniden hazır olmasına kalan süre (ms) */
  rocketCooldownMs: number;
  laserRange: number;
  /** Aşama 11: gemi ambarındaki kaynak / kapasite */
  cargo: [number, number];
}

export interface RewardMessage {
  t: 'reward';
  /** ör. "Çakal yok edildi" */
  source: string;
  xp: number;
  honor: number;
  currencies: Array<{ code: string; amount: number }>;
  items: Array<{ code: string; name: string; amount: number }>;
  level: number;
  levelUp: boolean;
  /** Birden çok pilot vurduysa bu pilotun hasar payı (0–1); tek başına öldürdüyse yok */
  share?: number;
  /** Aşama 12: Kredi ödülünden klan hazinesine giden vergi */
  clanTax?: number;
}
