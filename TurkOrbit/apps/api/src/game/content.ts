/**
 * Oyun sunucusunun veritabanından okuduğu içerik (Aşama 9): NPC türleri, ödül tabloları, mühimmat/roket
 * değerleri, harita kimlikleri ve savaş ayarları. Yönetim Merkezi (Aşama 14) bu tabloları düzenleyecek.
 */
import {
  DEFAULT_COMBAT_SETTINGS,
  parseItemStats,
  type CombatSettings,
  type RewardEntry,
} from '@turkorbit/shared';
import type { Queryable } from '../db/pool.js';
import { getSetting } from '../modules/auth/repository.js';

export interface NpcAi {
  behavior: 'passive' | 'aggressive' | 'kite';
  pack?: boolean;
  aggro_range?: number;
  patrol_radius?: number;
  leash?: number;
  poison?: { ratio: number; ms: number };
  slow?: { factor: number; ms: number };
}

export interface NpcType {
  id: number;
  code: string;
  name: string;
  family: string;
  level: number;
  spriteKey: string;
  scale: number;
  color: string;
  hitpoints: number;
  shield: number;
  absorb: number;
  damage: number;
  attackRateMs: number;
  attackRange: number;
  speed: number;
  ai: NpcAi;
  isBoss: boolean;
  experience: number;
  honor: number;
  rewards: RewardEntry[];
}

export interface ResourceNodeGroup {
  id: number;
  /** kaynak eşya kodu (res.kuvarsit …) */
  code: string;
  name: string;
  area: { x: number; y: number; r: number };
  maxCount: number;
  respawnMs: number;
  yieldMin: number;
  yieldMax: number;
}

export interface NpcSpawn {
  id: number;
  typeId: number;
  area: { x: number; y: number; r: number };
  maxAlive: number;
  respawnMs: number;
  overrides: { hitpoints_mult?: number; damage_mult?: number };
}

export interface ItemRef {
  id: number;
  code: string;
  name: string;
  category: string;
  stackable: boolean;
}

export interface AmmoStats {
  multiplier: number;
  shieldLeech: number;
}
export interface RocketStats {
  damage: number;
  cooldownMs: number;
  range: number;
  aoeRadius: number;
  slowMs: number;
}

export class GameContent {
  npcTypes = new Map<number, NpcType>();
  items = new Map<string, ItemRef>();
  /** Aşama 11: maden noktası toplama yarıçapı (game_settings.mining) */
  miningRadius = 90;
  ammo = new Map<string, AmmoStats>();
  rockets = new Map<string, RocketStats>();
  mapIds = new Map<string, number>();
  combat: CombatSettings = DEFAULT_COMBAT_SETTINGS;

  async load(db: Queryable) {
    const types = await db.query<{
      id: number; code: string; name: string; family: string; level: number; sprite_key: string; scale: number; color_hex: string;
      hitpoints: number; shield: number; shield_absorb: string; damage: number; attack_rate_ms: number; attack_range: number;
      speed: number; ai: NpcAi; is_boss: boolean; experience: number; honor: number; reward_table_id: number | null;
    }>('SELECT * FROM npc_types WHERE NOT is_archived');
    const entries = await db.query<RewardEntry & { reward_table_id: number; min_amount: string; max_amount: string; chance: string }>(
      'SELECT reward_table_id, reward_type, ref_code, min_amount, max_amount, chance, delivery FROM reward_entries ORDER BY id',
    );
    const byTable = new Map<number, RewardEntry[]>();
    for (const e of entries.rows) {
      const list = byTable.get(e.reward_table_id) ?? [];
      list.push({ ...e, min_amount: Number(e.min_amount), max_amount: Number(e.max_amount), chance: Number(e.chance) });
      byTable.set(e.reward_table_id, list);
    }
    this.npcTypes.clear();
    for (const t of types.rows) {
      this.npcTypes.set(t.id, {
        id: t.id,
        code: t.code,
        name: t.name,
        family: t.family,
        level: t.level,
        spriteKey: t.sprite_key,
        scale: Number(t.scale),
        color: t.color_hex,
        hitpoints: t.hitpoints,
        shield: t.shield,
        absorb: Number(t.shield_absorb),
        damage: t.damage,
        attackRateMs: t.attack_rate_ms,
        attackRange: t.attack_range,
        speed: t.speed,
        ai: t.ai,
        isBoss: t.is_boss,
        experience: t.experience,
        honor: t.honor,
        rewards: t.reward_table_id ? (byTable.get(t.reward_table_id) ?? []) : [],
      });
    }
    const items = await db.query<{ id: number; code: string; name: string; category: string; stackable: boolean; stats: unknown }>(
      `SELECT id, code, name, category, stackable, stats FROM item_types`,
    );
    this.items.clear();
    this.ammo.clear();
    this.rockets.clear();
    for (const i of items.rows) {
      this.items.set(i.code, { id: i.id, code: i.code, name: i.name, category: i.category, stackable: i.stackable });
      try {
        if (i.category === 'ammo') {
          const s = parseItemStats('ammo', i.stats);
          this.ammo.set(i.code, { multiplier: s.multiplier, shieldLeech: s.shieldLeech ?? 0 });
        } else if (i.category === 'rocket') {
          const s = parseItemStats('rocket', i.stats);
          this.rockets.set(i.code, { damage: s.damage, cooldownMs: s.cooldownMs, range: s.range, aoeRadius: s.aoeRadius ?? 0, slowMs: s.slowMs ?? 0 });
        }
      } catch {
        /* şemaya uymayan eşya değeri savaşta kullanılmaz (Yönetim Merkezi doğrulayacak) */
      }
    }
    const maps = await db.query<{ id: number; code: string }>('SELECT id, code FROM maps');
    this.mapIds = new Map(maps.rows.map((m) => [m.code, m.id]));
    const combat = await getSetting<Partial<CombatSettings>>(db, 'combat');
    this.combat = { ...DEFAULT_COMBAT_SETTINGS, ...(combat ?? {}) };
    this.miningRadius = (await getSetting<{ pickup_radius?: number }>(db, 'mining'))?.pickup_radius ?? 90;
  }

  /** Aşama 11: haritanın maden noktası grupları (oda açılırken okunur). */
  async resourceNodesFor(db: Queryable, mapCode: string): Promise<ResourceNodeGroup[]> {
    const r = await db.query<{ id: number; code: string; name: string; area: { x: number; y: number; r: number }; max_count: number; respawn_seconds: number; yield_min: number; yield_max: number }>(
      `SELECT n.id, it.code, it.name, n.area, n.max_count, n.respawn_seconds, n.yield_min, n.yield_max
       FROM resource_nodes n JOIN maps m ON m.id = n.map_id JOIN item_types it ON it.id = n.item_type_id
       WHERE m.code = $1 AND n.is_enabled ORDER BY n.id`,
      [mapCode],
    );
    return r.rows.map((x) => ({ id: x.id, code: x.code, name: x.name, area: x.area, maxCount: x.max_count, respawnMs: x.respawn_seconds * 1000, yieldMin: x.yield_min, yieldMax: x.yield_max }));
  }

  async spawnsFor(db: Queryable, mapCode: string): Promise<NpcSpawn[]> {
    const r = await db.query<{ id: number; npc_type_id: number; area: { x: number; y: number; r: number }; max_alive: number; respawn_seconds: number; overrides: NpcSpawn['overrides'] }>(
      `SELECT s.id, s.npc_type_id, s.area, s.max_alive, s.respawn_seconds, s.overrides
       FROM npc_spawns s JOIN maps m ON m.id = s.map_id WHERE m.code = $1 AND s.is_enabled ORDER BY s.id`,
      [mapCode],
    );
    return r.rows
      .filter((s) => this.npcTypes.has(s.npc_type_id))
      .map((s) => ({ id: s.id, typeId: s.npc_type_id, area: s.area, maxAlive: s.max_alive, respawnMs: s.respawn_seconds * 1000, overrides: s.overrides ?? {} }));
  }
}
