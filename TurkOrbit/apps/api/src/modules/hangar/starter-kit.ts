import type { Queryable } from '../../db/pool.js';
import { getSetting } from '../auth/repository.js';
import { grantItem } from '../economy/inventory.js';

interface StarterKitSetting {
  items: Array<{ code: string; quantity: number }>;
}

/**
 * Başlangıç ekipmanını verir ve aktif gemiye otomatik takar (her iki konfigürasyona).
 * Konfigürasyon 1 kalkan, konfigürasyon 2 hız jeneratörünü önceliklendirir.
 * İdempotenttir: daha önce verildiyse hiçbir şey yapmaz. Aşama 5'te oluşturulmuş pilotlar
 * hangarı ilk açtıklarında kitlerini bu fonksiyonla alır.
 */
export async function ensureStarterKit(tx: Queryable, playerId: string): Promise<boolean> {
  const done = await tx.query(`SELECT 1 FROM item_ledger WHERE player_id = $1 AND reason = 'starter_kit' LIMIT 1`, [playerId]);
  if ((done.rowCount ?? 0) > 0) return false;
  const kit = (await getSetting<StarterKitSetting>(tx, 'starter.kit'))?.items ?? [];
  if (kit.length === 0) return false;

  const types = await tx.query<{ id: number; code: string; category: string; stackable: boolean }>(
    `SELECT id, code, category, stackable FROM item_types WHERE code = ANY($1::text[])`,
    [kit.map((k) => k.code)],
  );
  const byCode = new Map(types.rows.map((t) => [t.code, t]));
  const granted: Array<{ id: string; category: string }> = [];
  for (const k of kit) {
    const t = byCode.get(k.code);
    if (!t || !Number.isSafeInteger(k.quantity) || k.quantity <= 0) continue;
    const ids = await grantItem(tx, playerId, t, k.quantity, {
      reason: 'starter_kit',
      source: 'starter_kit',
      idempotencyKey: `starter_kit:${playerId}:${k.code}`,
    });
    if (!t.stackable) for (const id of ids) granted.push({ id, category: t.category });
  }

  const ship = await tx.query<{ id: string; laser_slots: number; generator_slots: number }>(
    `SELECT ps.id, st.laser_slots, st.generator_slots FROM players p
     JOIN player_ships ps ON ps.id = p.active_ship_id JOIN ship_types st ON st.id = ps.ship_type_id
     WHERE p.id = $1`,
    [playerId],
  );
  const s = ship.rows[0];
  if (!s) return true;
  const lasers = granted.filter((g) => g.category === 'laser');
  const shields = granted.filter((g) => g.category === 'shield_generator');
  const speeds = granted.filter((g) => g.category === 'speed_generator');
  for (const loadout of [1, 2] as const) {
    const gens = loadout === 1 ? [...shields, ...speeds] : [...speeds, ...shields];
    const place = async (slotType: string, items: typeof granted, max: number) => {
      for (let i = 0; i < Math.min(max, items.length); i++) {
        await tx.query(
          `INSERT INTO loadout_slots (player_ship_id, loadout, slot_type, slot_index, player_item_id)
           VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
          [s.id, loadout, slotType, i, items[i]!.id],
        );
      }
    };
    await place('laser', lasers, s.laser_slots);
    await place('generator', gens, s.generator_slots);
  }
  return true;
}
