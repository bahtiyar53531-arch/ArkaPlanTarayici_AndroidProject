import { computeLoadoutStats, slotCount, type ItemCategory, type LoadoutStats, type SlotType } from '@turkorbit/shared';
import type { Queryable } from '../../db/pool.js';

export interface ActiveShipStats {
  name: string;
  spriteKey: string;
  hitpoints: number;
  maxHitpoints: number;
  stats: LoadoutStats;
}

/**
 * Pilotun aktif gemisi + kullanımdaki konfigürasyonuna göre sunucu otoriteli değerler.
 * Konum doğrulaması (hız) ve oyun sunucusu (Aşama 8) bu değerleri kullanır.
 */
export async function activeShipStats(db: Queryable, playerId: string): Promise<ActiveShipStats | null> {
  const ship = await db.query<{
    id: string;
    hitpoints: number;
    max_hp: number;
    base_speed: number;
    cargo_capacity: number;
    laser_slots: number;
    generator_slots: number;
    extra_slots: number;
    drone_slots: number;
    name: string;
    sprite: string;
    loadout: 1 | 2;
  }>(
    `SELECT ps.id, ps.hitpoints, st.hitpoints AS max_hp, st.base_speed, st.cargo_capacity, st.laser_slots,
            st.generator_slots, st.extra_slots, st.drone_slots, st.name,
            COALESCE(dt.stats->>'spriteKey', st.sprite_key) AS sprite, p.active_loadout AS loadout
     FROM players p JOIN player_ships ps ON ps.id = p.active_ship_id JOIN ship_types st ON st.id = ps.ship_type_id
     LEFT JOIN player_items di ON di.id = ps.design_item_id LEFT JOIN item_types dt ON dt.id = di.item_type_id
     WHERE p.id = $1`,
    [playerId],
  );
  const s = ship.rows[0];
  if (!s) return null;
  const slots = await db.query<{
    slot_type: SlotType;
    slot_index: number;
    category: ItemCategory;
    stats: unknown;
    upgrade_level: number;
    stat_bonus: string | null;
  }>(
    `SELECT ls.slot_type, ls.slot_index, it.category, it.stats, pi.upgrade_level, ul.stat_bonus
     FROM loadout_slots ls JOIN player_items pi ON pi.id = ls.player_item_id JOIN item_types it ON it.id = pi.item_type_id
     LEFT JOIN upgrade_levels ul ON ul.category = it.category AND ul.level = pi.upgrade_level
     WHERE ls.player_ship_id = $1 AND ls.loadout = $2`,
    [s.id, s.loadout],
  );
  const counts = { laser: s.laser_slots, generator: s.generator_slots, extra: s.extra_slots, drone: s.drone_slots };
  const stats = computeLoadoutStats(
    { hitpoints: s.max_hp, baseSpeed: s.base_speed, cargoCapacity: s.cargo_capacity },
    slots.rows
      .filter((r) => r.slot_index < slotCount(counts, r.slot_type))
      .map((r) => ({
        slotType: r.slot_type,
        slotIndex: r.slot_index,
        category: r.category,
        stats: r.stats,
        upgradeMultiplier: r.upgrade_level > 0 && r.stat_bonus ? 1 + Number(r.stat_bonus) : 1,
      })),
  );
  return { name: s.name, spriteKey: s.sprite, hitpoints: Math.min(s.hitpoints, s.max_hp), maxHitpoints: s.max_hp, stats };
}
