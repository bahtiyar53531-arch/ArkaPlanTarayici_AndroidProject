import { randomInt } from 'node:crypto';
import {
  computeLoadoutStats,
  designSchema,
  equipSchema,
  levelForXp,
  parseItemStats,
  petModuleSchema,
  petRenameSchema,
  purchaseSchema,
  repairSchema,
  sellSchema,
  setLoadoutSchema,
  shipActionSchema,
  slotAccepts,
  slotCount,
  unequipSchema,
  upgradeSchema,
  type HangarResponse,
  type HangarShip,
  type InventoryItem,
  type ItemCategory,
  type LoadoutSlot,
  type ShipTypeInfo,
  type ShopOffer,
  type ShopResponse,
  type SlotType,
} from '@turkorbit/shared';
import type { GameBridge } from '../game/bridge.js';
import { withTransaction, type Db, type DbClient, type Queryable } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';
import { getSetting } from '../auth/repository.js';
import type { Logger } from '../auth/service.js';
import { grantItem, inventoryRowCount, removeItem } from '../economy/inventory.js';
import { applyCurrencyChange, getBalances } from '../economy/wallet.js';
import { ensureStarterKit } from './starter-kit.js';

export interface Owner {
  id: string;
}

/** 0..max-1 arası rastgele tam sayı. Varsayılan: kriptografik RNG (testlerde enjekte edilebilir). */
export type Rng = (max: number) => number;

interface LockedPilot {
  id: string;
  experience: number;
  activeShipId: string | null;
  activeLoadout: 1 | 2;
}

interface ItemTypeRow {
  id: number;
  code: string;
  category: ItemCategory;
  name: string;
  description: string;
  icon_key: string;
  rarity: string;
  stackable: boolean;
  stats: Record<string, unknown>;
  max_upgrade_level: number;
  min_level: number;
  requirements: { ship?: string };
  sell_price: string;
}

interface UpgradeRow {
  category: string;
  level: number;
  stat_bonus: string;
  success_chance: string;
  cost_currency: string;
  cost_amount: string;
}

const err = (code: ConstructorParameters<typeof AppError>[0], status: number, message: string) =>
  new AppError(code, status, message);

export class HangarService {
  constructor(
    private readonly db: Db,
    private readonly log: Logger,
    private readonly rng: Rng = (max) => randomInt(max),
    /** Aşama 8: oyun sunucusu köprüsü (istasyon kuralı + canlı istatistik bildirimi) */
    private readonly bridge: GameBridge | null = null,
  ) {}

  // ================================================================== ortak yardımcılar
  private async lockPilot(c: Queryable, owner: Owner, serverCode: string, forUpdate = true): Promise<LockedPilot> {
    const r = await c.query<{ id: string; experience: string; active_ship_id: string | null; active_loadout: 1 | 2 }>(
      `SELECT p.id, p.experience, p.active_ship_id, p.active_loadout
       FROM players p JOIN game_servers s ON s.id = p.server_id
       WHERE p.user_id = $1 AND s.code = $2 ${forUpdate ? 'FOR UPDATE OF p' : ''}`,
      [owner.id, serverCode],
    );
    const p = r.rows[0];
    if (!p) throw err('PILOT_NOT_FOUND', 404, 'Bu sunucuda henüz bir pilotun yok.');
    return { id: p.id, experience: Number(p.experience), activeShipId: p.active_ship_id, activeLoadout: p.active_loadout };
  }

  /**
   * Oyuncu kilitli bir transaction içinde işlem yapar, ardından güncel hangarı döner.
   * station: oyundaysa yalnızca istasyonda yapılabilir (ekipman/gemi değişimi).
   * notify: başarılıysa oyun sunucusu canlı istatistikleri yeniden yükler.
   */
  private async mutate<T>(
    owner: Owner,
    serverCode: string,
    fn: (c: DbClient, pilot: LockedPilot) => Promise<T>,
    opts: { station?: boolean; notify?: boolean } = {},
  ): Promise<{ result: T; hangar: HangarResponse }> {
    let playerId = '';
    const result = await withTransaction(this.db, async (c) => {
      const pilot = await this.lockPilot(c, owner, serverCode);
      playerId = pilot.id;
      if (opts.station) await this.bridge?.assertCanChangeEquipment(pilot.id);
      return fn(c, pilot);
    });
    if (opts.notify !== false) await this.bridge?.notifyPlayerUpdated(playerId);
    return { result, hangar: await this.hangar(owner, serverCode) };
  }

  private async itemTypes(db: Queryable): Promise<Map<number, ItemTypeRow>> {
    const r = await db.query<ItemTypeRow>(
      `SELECT id, code, category, name, description, icon_key, rarity, stackable, stats, max_upgrade_level, min_level,
              requirements, sell_price FROM item_types`,
    );
    return new Map(r.rows.map((t) => [t.id, t]));
  }

  private async upgradeTable(db: Queryable): Promise<Map<string, UpgradeRow>> {
    const r = await db.query<UpgradeRow>('SELECT * FROM upgrade_levels');
    return new Map(r.rows.map((u) => [`${u.category}:${u.level}`, u]));
  }

  private multiplier(table: Map<string, UpgradeRow>, category: string, level: number): number {
    if (level <= 0) return 1;
    const u = table.get(`${category}:${level}`);
    return u ? 1 + Number(u.stat_bonus) : 1;
  }

  private async ownedItem(c: Queryable, playerId: string, itemId: string) {
    const r = await c.query<{
      id: string;
      item_type_id: number;
      quantity: string;
      is_stack: boolean;
      upgrade_level: number;
      bound: boolean;
      category: ItemCategory;
      min_level: number;
      max_upgrade_level: number;
      sell_price: string;
      requirements: { ship?: string };
      stats: Record<string, unknown>;
      name: string;
    }>(
      `SELECT pi.id, pi.item_type_id, pi.quantity, pi.is_stack, pi.upgrade_level, pi.bound, it.category, it.min_level,
              it.max_upgrade_level, it.sell_price, it.requirements, it.stats, it.name
       FROM player_items pi JOIN item_types it ON it.id = pi.item_type_id
       WHERE pi.id = $1 AND pi.player_id = $2`,
      [itemId, playerId],
    );
    const i = r.rows[0];
    if (!i) throw err('ITEM_NOT_FOUND', 404, 'Eşya envanterinde bulunamadı.');
    return i;
  }

  private async ownedShip(c: Queryable, playerId: string, shipId: string) {
    const r = await c.query<{
      id: string;
      hitpoints: number;
      max_hp: number;
      code: string;
      laser_slots: number;
      generator_slots: number;
      extra_slots: number;
      drone_slots: number;
    }>(
      `SELECT ps.id, ps.hitpoints, st.hitpoints AS max_hp, st.code, st.laser_slots, st.generator_slots, st.extra_slots, st.drone_slots
       FROM player_ships ps JOIN ship_types st ON st.id = ps.ship_type_id
       WHERE ps.id = $1 AND ps.player_id = $2`,
      [shipId, playerId],
    );
    const s = r.rows[0];
    if (!s) throw err('SHIP_NOT_FOUND', 404, 'Gemi hangarında bulunamadı.');
    return s;
  }

  private async itemInUse(c: Queryable, playerId: string, itemId: string): Promise<boolean> {
    const r = await c.query(
      `SELECT 1 FROM loadout_slots WHERE player_item_id = $1
       UNION ALL SELECT 1 FROM player_pets WHERE player_item_id = $1 AND player_id = $2
       UNION ALL SELECT 1 FROM player_pet_modules WHERE player_item_id = $1
       UNION ALL SELECT 1 FROM player_ships WHERE design_item_id = $1 LIMIT 1`,
      [itemId, playerId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  // ================================================================== hangar okuma
  async hangar(owner: Owner, serverCodeRaw: string): Promise<HangarResponse> {
    const serverCode = serverCodeRaw.toUpperCase();
    // Aşama 5'te oluşturulmuş pilotlar başlangıç ekipmanını ilk açılışta alır (idempotent).
    const pilot = await withTransaction(this.db, async (c) => {
      const p = await this.lockPilot(c, owner, serverCode);
      await ensureStarterKit(c, p.id);
      return p;
    });
    const db = this.db;
    const [types, upgrades, ships, slots, items, pet, petModules, currencies, inv] = await Promise.all([
      this.itemTypes(db),
      this.upgradeTable(db),
      db.query<{
        id: string; hitpoints: number; design_item_id: string | null; code: string; name: string; description: string | null;
        ship_class: string; sprite_key: string; max_hp: number; base_speed: number; cargo_capacity: number;
        laser_slots: number; generator_slots: number; extra_slots: number; drone_slots: number; min_level: number;
        design_name: string | null; design_stats: Record<string, unknown> | null;
      }>(
        `SELECT ps.id, ps.hitpoints, ps.design_item_id, st.code, st.name, st.description, st.ship_class, st.sprite_key,
                st.hitpoints AS max_hp, st.base_speed, st.cargo_capacity, st.laser_slots, st.generator_slots,
                st.extra_slots, st.drone_slots, st.min_level, dt.name AS design_name, dt.stats AS design_stats
         FROM player_ships ps JOIN ship_types st ON st.id = ps.ship_type_id
         LEFT JOIN player_items di ON di.id = ps.design_item_id LEFT JOIN item_types dt ON dt.id = di.item_type_id
         WHERE ps.player_id = $1 ORDER BY st.min_level, st.id`,
        [pilot.id],
      ),
      db.query<{ player_ship_id: string; loadout: 1 | 2; slot_type: SlotType; slot_index: number; player_item_id: string }>(
        `SELECT ls.* FROM loadout_slots ls JOIN player_ships ps ON ps.id = ls.player_ship_id WHERE ps.player_id = $1
         ORDER BY ls.slot_type, ls.slot_index`,
        [pilot.id],
      ),
      db.query<{ id: string; item_type_id: number; quantity: string; upgrade_level: number; bound: boolean }>(
        `SELECT id, item_type_id, quantity, upgrade_level, bound FROM player_items WHERE player_id = $1 ORDER BY acquired_at, id`,
        [pilot.id],
      ),
      db.query<{ name: string; player_item_id: string; level: number }>(
        'SELECT name, player_item_id, level FROM player_pets WHERE player_id = $1',
        [pilot.id],
      ),
      db.query<{ slot_index: number; player_item_id: string }>(
        'SELECT slot_index, player_item_id FROM player_pet_modules WHERE player_id = $1 ORDER BY slot_index',
        [pilot.id],
      ),
      getBalances(db, pilot.id),
      getSetting<{ max_items: number }>(db, 'inventory'),
    ]);
    const repair = (await getSetting<{ currency: string; per_1000_hp: number }>(db, 'repair')) ?? {
      currency: 'KREDI',
      per_1000_hp: 250,
    };

    const itemById = new Map(items.rows.map((i) => [i.id, i]));
    const petRow = pet.rows[0];
    const designOf = new Map(ships.rows.filter((s) => s.design_item_id).map((s) => [s.design_item_id!, s.id]));
    const petModuleOf = new Map(petModules.rows.map((m) => [m.player_item_id, m.slot_index]));

    const shipList: HangarShip[] = ships.rows.map((s) => {
      const type: ShipTypeInfo = {
        code: s.code,
        name: s.name,
        description: s.description,
        shipClass: s.ship_class,
        spriteKey: s.sprite_key,
        hitpoints: s.max_hp,
        baseSpeed: s.base_speed,
        cargoCapacity: s.cargo_capacity,
        slots: { laser: s.laser_slots, generator: s.generator_slots, extra: s.extra_slots, drone: s.drone_slots },
        minLevel: s.min_level,
      };
      const shipSlots = slots.rows.filter((l) => l.player_ship_id === s.id);
      const loadout = (n: 1 | 2): LoadoutSlot[] =>
        shipSlots
          .filter((l) => l.loadout === n)
          .map((l) => ({ slotType: l.slot_type, slotIndex: l.slot_index, itemId: l.player_item_id }));
      const statsFor = (n: 1 | 2) =>
        computeLoadoutStats(
          { hitpoints: s.max_hp, baseSpeed: s.base_speed, cargoCapacity: s.cargo_capacity },
          loadout(n).flatMap((l) => {
            const it = itemById.get(l.itemId);
            const t = it ? types.get(it.item_type_id) : undefined;
            if (!it || !t) return [];
            // Gemi slot sayısı sonradan azaltıldıysa (Yönetim Merkezi) taşan slotlar hesaba katılmaz.
            if (l.slotIndex >= slotCount(type.slots, l.slotType)) return [];
            return [{
              slotType: l.slotType,
              slotIndex: l.slotIndex,
              category: t.category,
              stats: t.stats,
              upgradeMultiplier: this.multiplier(upgrades, t.category, it.upgrade_level),
            }];
          }),
        );
      const hp = Math.min(s.hitpoints, s.max_hp);
      const missing = s.max_hp - hp;
      const designSprite = s.design_stats ? String(s.design_stats.spriteKey ?? '') : '';
      return {
        id: s.id,
        type,
        spriteKey: designSprite || s.sprite_key,
        design: s.design_item_id && s.design_name ? { itemId: s.design_item_id, name: s.design_name } : null,
        hitpoints: hp,
        maxHitpoints: s.max_hp,
        isActive: s.id === pilot.activeShipId,
        loadouts: { 1: loadout(1), 2: loadout(2) },
        stats: { 1: statsFor(1), 2: statsFor(2) },
        repairCost: missing > 0 ? { currency: repair.currency, amount: Math.max(1, Math.ceil((missing * repair.per_1000_hp) / 1000)) } : null,
      };
    });

    const equippedIn = new Map<string, InventoryItem['equippedIn']>();
    for (const l of slots.rows) {
      const list = equippedIn.get(l.player_item_id) ?? [];
      list.push({ shipId: l.player_ship_id, loadout: l.loadout, slotType: l.slot_type, slotIndex: l.slot_index });
      equippedIn.set(l.player_item_id, list);
    }

    const inventory: InventoryItem[] = items.rows.flatMap((i) => {
      const t = types.get(i.item_type_id);
      if (!t) return [];
      const next = upgrades.get(`${t.category}:${i.upgrade_level + 1}`);
      return [{
        id: i.id,
        code: t.code,
        name: t.name,
        description: t.description,
        category: t.category,
        rarity: t.rarity,
        iconKey: t.icon_key,
        quantity: Number(i.quantity),
        upgradeLevel: i.upgrade_level,
        maxUpgradeLevel: t.max_upgrade_level,
        minLevel: t.min_level,
        stats: parseItemStats(t.category, t.stats) as Record<string, unknown>,
        sellPrice: Number(t.sell_price),
        bound: i.bound,
        equippedIn: equippedIn.get(i.id) ?? [],
        usage: {
          pet: petRow?.player_item_id === i.id,
          petModuleSlot: petModuleOf.get(i.id) ?? null,
          designShipId: designOf.get(i.id) ?? null,
        },
        nextUpgrade:
          next && i.upgrade_level < t.max_upgrade_level
            ? { level: next.level, chance: Number(next.success_chance), currency: next.cost_currency, amount: Number(next.cost_amount) }
            : null,
        requiresShip: t.requirements.ship ?? null,
      }];
    });

    let petInfo: HangarResponse['pet'] = null;
    if (petRow) {
      const petType = types.get(itemById.get(petRow.player_item_id)?.item_type_id ?? -1);
      const moduleSlots = petType ? parseItemStats('pet', petType.stats).moduleSlots : 0;
      petInfo = {
        name: petRow.name,
        itemId: petRow.player_item_id,
        level: petRow.level,
        moduleSlots,
        modules: petModules.rows.map((m) => ({ slotIndex: m.slot_index, itemId: m.player_item_id })),
      };
    }

    return {
      serverCode,
      playerLevel: levelForXp(pilot.experience),
      activeShipId: pilot.activeShipId,
      activeLoadout: pilot.activeLoadout,
      ships: shipList,
      inventory,
      inventoryLimit: inv?.max_items ?? 300,
      pet: petInfo,
      currencies: currencies.map((c) => ({ code: c.code, name: c.name, balance: c.balance })),
    };
  }

  // ================================================================== ekipman takma / çıkarma
  async equip(owner: Owner, input: unknown) {
    const d = equipSchema.parse(input);
    return this.mutate(owner, d.serverCode, async (c, pilot) => {
      const ship = await this.ownedShip(c, pilot.id, d.shipId);
      const item = await this.ownedItem(c, pilot.id, d.itemId);
      const slots = { laser: ship.laser_slots, generator: ship.generator_slots, extra: ship.extra_slots, drone: ship.drone_slots };
      if (item.is_stack || !slotAccepts(d.slotType, item.category)) {
        throw err('SLOT_INCOMPATIBLE', 400, `${item.name} bu slota takılamaz.`);
      }
      if (d.slotIndex >= slotCount(slots, d.slotType)) {
        throw err('SLOT_UNAVAILABLE', 400, 'Bu gemide böyle bir slot yok.');
      }
      if (levelForXp(pilot.experience) < item.min_level) {
        throw err('LEVEL_TOO_LOW', 403, `${item.name} için en az seviye ${item.min_level} olmalısın.`);
      }
      if (d.slotType === 'drone_gear') {
        const drone = await c.query(
          `SELECT 1 FROM loadout_slots WHERE player_ship_id = $1 AND loadout = $2 AND slot_type = 'drone' AND slot_index = $3`,
          [ship.id, d.loadout, d.slotIndex],
        );
        if ((drone.rowCount ?? 0) === 0) throw err('SLOT_UNAVAILABLE', 400, 'Önce bu drone slotuna bir drone tak.');
      }
      const elsewhere = await c.query(
        'SELECT 1 FROM loadout_slots WHERE player_item_id = $1 AND player_ship_id <> $2 LIMIT 1',
        [item.id, ship.id],
      );
      if ((elsewhere.rowCount ?? 0) > 0) {
        throw err('ITEM_ON_OTHER_SHIP', 409, `${item.name} başka bir gemide takılı. Önce oradan çıkar.`);
      }
      if (item.category === 'rocket_launcher') {
        const other = await c.query(
          `SELECT 1 FROM loadout_slots ls JOIN player_items pi ON pi.id = ls.player_item_id
           JOIN item_types it ON it.id = pi.item_type_id
           WHERE ls.player_ship_id = $1 AND ls.loadout = $2 AND it.category = 'rocket_launcher'
             AND ls.player_item_id <> $3 AND NOT (ls.slot_type = $4 AND ls.slot_index = $5)`,
          [ship.id, d.loadout, item.id, d.slotType, d.slotIndex],
        );
        if ((other.rowCount ?? 0) > 0) throw err('SLOT_INCOMPATIBLE', 400, 'Bir konfigürasyona yalnızca bir roket atar takılabilir.');
      }
      // Eşya bu konfigürasyonda başka slottaysa oradan taşınır; hedef slottaki eşya çıkarılır.
      await c.query(
        `DELETE FROM loadout_slots WHERE player_ship_id = $1 AND loadout = $2
           AND (player_item_id = $3 OR (slot_type = $4 AND slot_index = $5))`,
        [ship.id, d.loadout, item.id, d.slotType, d.slotIndex],
      );
      await c.query(
        `INSERT INTO loadout_slots (player_ship_id, loadout, slot_type, slot_index, player_item_id) VALUES ($1, $2, $3, $4, $5)`,
        [ship.id, d.loadout, d.slotType, d.slotIndex, item.id],
      );
      // Drone başka slota taşındıysa eski slottaki drone ekipmanı sahipsiz kalır → çıkarılır.
      await this.removeOrphanDroneGear(c, ship.id, d.loadout);
    }, { station: true });
  }

  private async removeOrphanDroneGear(c: Queryable, shipId: string, loadout: number) {
    await c.query(
      `DELETE FROM loadout_slots g WHERE g.player_ship_id = $1 AND g.loadout = $2 AND g.slot_type = 'drone_gear'
         AND NOT EXISTS (SELECT 1 FROM loadout_slots d WHERE d.player_ship_id = g.player_ship_id AND d.loadout = g.loadout
                           AND d.slot_type = 'drone' AND d.slot_index = g.slot_index)`,
      [shipId, loadout],
    );
  }

  async unequip(owner: Owner, input: unknown) {
    const d = unequipSchema.parse(input);
    return this.mutate(owner, d.serverCode, async (c, pilot) => {
      const ship = await this.ownedShip(c, pilot.id, d.shipId);
      await c.query(
        'DELETE FROM loadout_slots WHERE player_ship_id = $1 AND loadout = $2 AND slot_type = $3 AND slot_index = $4',
        [ship.id, d.loadout, d.slotType, d.slotIndex],
      );
      await this.removeOrphanDroneGear(c, ship.id, d.loadout);
    }, { station: true });
  }

  async setActiveLoadout(owner: Owner, input: unknown) {
    const d = setLoadoutSchema.parse(input);
    return this.mutate(owner, d.serverCode, async (c, pilot) => {
      await c.query('UPDATE players SET active_loadout = $2 WHERE id = $1', [pilot.id, d.loadout]);
    });
  }

  async activateShip(owner: Owner, shipId: string, input: unknown) {
    const d = shipActionSchema.parse(input);
    return this.mutate(owner, d.serverCode, async (c, pilot) => {
      const ship = await this.ownedShip(c, pilot.id, uuidOr404(shipId));
      await c.query('UPDATE players SET active_ship_id = $2 WHERE id = $1', [pilot.id, ship.id]);
    }, { station: true });
  }

  async setDesign(owner: Owner, shipId: string, input: unknown) {
    const d = designSchema.parse(input);
    return this.mutate(owner, d.serverCode, async (c, pilot) => {
      const ship = await this.ownedShip(c, pilot.id, uuidOr404(shipId));
      if (d.itemId) {
        const item = await this.ownedItem(c, pilot.id, d.itemId);
        if (item.category !== 'ship_design' || item.requirements.ship !== ship.code) {
          throw err('SLOT_INCOMPATIBLE', 400, `${item.name} bu gemiye uygun değil.`);
        }
        await c.query('UPDATE player_ships SET design_item_id = NULL WHERE design_item_id = $1', [item.id]);
      }
      await c.query('UPDATE player_ships SET design_item_id = $2 WHERE id = $1', [ship.id, d.itemId]);
    }, { station: true });
  }

  // ================================================================== tamir
  async repair(owner: Owner, shipId: string, input: unknown) {
    const d = repairSchema.parse(input);
    return this.mutate(owner, d.serverCode, async (c, pilot) => {
      const ship = await this.ownedShip(c, pilot.id, uuidOr404(shipId));
      const missing = ship.max_hp - Math.min(ship.hitpoints, ship.max_hp);
      const key = `repair:${pilot.id}:${d.requestId}`;
      if (missing <= 0) {
        const replay = await c.query('SELECT 1 FROM currency_ledger WHERE idempotency_key = $1', [key]);
        if ((replay.rowCount ?? 0) > 0) return { repaired: 0, cost: 0 };
        throw err('SHIP_NOT_DAMAGED', 400, 'Gemi zaten tam sağlam.');
      }
      const setting = (await getSetting<{ currency: string; per_1000_hp: number }>(c, 'repair')) ?? { currency: 'KREDI', per_1000_hp: 250 };
      const cost = Math.max(1, Math.ceil((missing * setting.per_1000_hp) / 1000));
      const r = await applyCurrencyChange(c, {
        playerId: pilot.id,
        currency: setting.currency,
        delta: -cost,
        reason: 'ship_repair',
        refType: 'player_ship',
        refId: ship.id,
        idempotencyKey: key,
      });
      if (r.applied) await c.query('UPDATE player_ships SET hitpoints = $2 WHERE id = $1', [ship.id, ship.max_hp]);
      return { repaired: r.applied ? missing : 0, cost };
    });
  }

  // ================================================================== satış
  async sell(owner: Owner, itemId: string, input: unknown) {
    const d = sellSchema.parse(input);
    return this.mutate(owner, d.serverCode, async (c, pilot) => {
      const key = `sell:${pilot.id}:${d.requestId}`;
      const replay = await c.query('SELECT 1 FROM currency_ledger WHERE idempotency_key = $1', [key]);
      if ((replay.rowCount ?? 0) > 0) return { sold: 0, earned: 0, replay: true };
      const item = await this.ownedItem(c, pilot.id, uuidOr404(itemId, 'ITEM_NOT_FOUND'));
      const price = Number(item.sell_price);
      if (price <= 0 || item.bound) throw err('NOT_SELLABLE', 400, `${item.name} satılamaz.`);
      if (await this.itemInUse(c, pilot.id, item.id)) {
        throw err('ITEM_IN_USE', 409, `${item.name} kullanımda (takılı, PET veya tasarım). Önce çıkar.`);
      }
      const qty = d.quantity;
      if (qty > Number(item.quantity)) throw err('VALIDATION_ERROR', 400, 'Elindeki miktardan fazlasını satamazsın.');
      const earned = price * qty;
      if (!Number.isSafeInteger(earned)) throw err('VALIDATION_ERROR', 400, 'Geçersiz miktar.');
      await applyCurrencyChange(c, {
        playerId: pilot.id,
        currency: 'KREDI',
        delta: earned,
        reason: 'item_sell',
        refType: 'player_item',
        refId: item.id,
        idempotencyKey: key,
      });
      await removeItem(
        c,
        pilot.id,
        { id: item.id, itemTypeId: item.item_type_id, quantity: Number(item.quantity), isStack: item.is_stack },
        qty,
        { reason: 'item_sell', idempotencyKey: key },
      );
      return { sold: qty, earned, replay: false };
    }, { notify: false });
  }

  // ================================================================== yükseltme
  async upgrade(owner: Owner, itemId: string, input: unknown) {
    const d = upgradeSchema.parse(input);
    return this.mutate(owner, d.serverCode, async (c, pilot) => {
      const key = `upgrade:${pilot.id}:${d.requestId}`;
      const prev = await c.query<{ success: boolean; from_level: number; to_level: number; chance: string; roll: number }>(
        'SELECT success, from_level, to_level, chance, roll FROM item_upgrade_log WHERE idempotency_key = $1',
        [key],
      );
      if (prev.rows[0]) {
        const p = prev.rows[0];
        return { success: p.success, fromLevel: p.from_level, toLevel: p.to_level, chance: Number(p.chance), replay: true };
      }
      const item = await this.ownedItem(c, pilot.id, uuidOr404(itemId, 'ITEM_NOT_FOUND'));
      if (item.max_upgrade_level <= 0) throw err('NOT_UPGRADABLE', 400, `${item.name} yükseltilemez.`);
      if (item.upgrade_level >= item.max_upgrade_level) throw err('MAX_UPGRADE', 400, `${item.name} en yüksek seviyede.`);
      const nextLevel = item.upgrade_level + 1;
      const row = (await c.query<UpgradeRow>('SELECT * FROM upgrade_levels WHERE category = $1 AND level = $2', [item.category, nextLevel])).rows[0];
      if (!row) throw err('NOT_UPGRADABLE', 400, `${item.name} için yükseltme tanımlı değil.`);
      const chance = Number(row.success_chance);
      const cost = Number(row.cost_amount);
      await applyCurrencyChange(c, {
        playerId: pilot.id,
        currency: row.cost_currency,
        delta: -cost,
        reason: 'item_upgrade',
        refType: 'player_item',
        refId: item.id,
        idempotencyKey: key,
      });
      const roll = this.rng(1_000_000);
      const success = roll < Math.round(chance * 1_000_000);
      const toLevel = success ? nextLevel : item.upgrade_level;
      if (success) await c.query('UPDATE player_items SET upgrade_level = $2 WHERE id = $1', [item.id, toLevel]);
      await c.query(
        `INSERT INTO item_upgrade_log (player_id, player_item_id, item_type_id, from_level, to_level, success, chance, roll,
           cost_currency, cost_amount, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [pilot.id, item.id, item.item_type_id, item.upgrade_level, toLevel, success, chance, roll, row.cost_currency, cost, key],
      );
      this.log.info({ playerId: pilot.id, item: item.id, success, toLevel }, 'ekipman yükseltme');
      return { success, fromLevel: item.upgrade_level, toLevel, chance, replay: false };
    });
  }

  // ================================================================== PET
  async renamePet(owner: Owner, input: unknown) {
    const d = petRenameSchema.parse(input);
    return this.mutate(owner, d.serverCode, async (c, pilot) => {
      const r = await c.query('UPDATE player_pets SET name = $2 WHERE player_id = $1', [pilot.id, d.name]);
      if ((r.rowCount ?? 0) === 0) throw err('PET_REQUIRED', 400, 'Henüz bir PET\'in yok. Mağazadan Yoldaş PET alabilirsin.');
    }, { notify: false });
  }

  async setPetModule(owner: Owner, input: unknown) {
    const d = petModuleSchema.parse(input);
    return this.mutate(owner, d.serverCode, async (c, pilot) => {
      const pet = await c.query<{ stats: Record<string, unknown> }>(
        `SELECT it.stats FROM player_pets pp JOIN player_items pi ON pi.id = pp.player_item_id
         JOIN item_types it ON it.id = pi.item_type_id WHERE pp.player_id = $1`,
        [pilot.id],
      );
      if (!pet.rows[0]) throw err('PET_REQUIRED', 400, 'Henüz bir PET\'in yok. Mağazadan Yoldaş PET alabilirsin.');
      const moduleSlots = parseItemStats('pet', pet.rows[0].stats).moduleSlots;
      if (d.slotIndex >= moduleSlots) throw err('SLOT_UNAVAILABLE', 400, `PET'inin ${moduleSlots} modül slotu var.`);
      if (d.itemId) {
        const item = await this.ownedItem(c, pilot.id, d.itemId);
        if (item.category !== 'pet_module') throw err('SLOT_INCOMPATIBLE', 400, `${item.name} bir PET modülü değil.`);
        await c.query('DELETE FROM player_pet_modules WHERE player_id = $1 AND (player_item_id = $2 OR slot_index = $3)', [
          pilot.id,
          item.id,
          d.slotIndex,
        ]);
        await c.query('INSERT INTO player_pet_modules (player_id, slot_index, player_item_id) VALUES ($1, $2, $3)', [
          pilot.id,
          d.slotIndex,
          item.id,
        ]);
      } else {
        await c.query('DELETE FROM player_pet_modules WHERE player_id = $1 AND slot_index = $2', [pilot.id, d.slotIndex]);
      }
    }, { station: true });
  }

  async itemLedger(owner: Owner, serverCode: string) {
    const pilot = await this.lockPilot(this.db, owner, serverCode.toUpperCase(), false);
    const r = await this.db.query<{ id: string; delta: string; reason: string; created_at: Date; name: string; code: string }>(
      `SELECT l.id::text, l.delta, l.reason, l.created_at, it.name, it.code FROM item_ledger l
       JOIN item_types it ON it.id = l.item_type_id WHERE l.player_id = $1 ORDER BY l.created_at DESC, l.id DESC LIMIT 50`,
      [pilot.id],
    );
    return r.rows.map((x) => ({
      id: x.id,
      itemCode: x.code,
      itemName: x.name,
      delta: Number(x.delta),
      reason: x.reason,
      createdAt: x.created_at.toISOString(),
    }));
  }

  // ================================================================== mağaza
  async shop(owner: Owner, serverCodeRaw: string): Promise<ShopResponse> {
    const serverCode = serverCodeRaw.toUpperCase();
    const pilot = await this.lockPilot(this.db, owner, serverCode, false);
    const level = levelForXp(pilot.experience);
    const [cats, offers, ownedShips, purchases, petRow, currencies] = await Promise.all([
      this.db.query<{ id: number; code: string; name: string }>(
        'SELECT id, code, name FROM shop_categories WHERE is_visible ORDER BY sort_order, id',
      ),
      this.db.query<OfferRow>(`${OFFER_SELECT} WHERE ${OFFER_ACTIVE} ORDER BY o.sort_order, o.id`),
      this.db.query<{ ship_type_id: number }>('SELECT ship_type_id FROM player_ships WHERE player_id = $1', [pilot.id]),
      this.db.query<{ offer_id: number; packs: string }>(
        'SELECT offer_id, sum(packs) AS packs FROM shop_purchases WHERE player_id = $1 GROUP BY offer_id',
        [pilot.id],
      ),
      this.db.query('SELECT 1 FROM player_pets WHERE player_id = $1', [pilot.id]),
      getBalances(this.db, pilot.id),
    ]);
    const owned = new Set(ownedShips.rows.map((r) => r.ship_type_id));
    const bought = new Map(purchases.rows.map((p) => [p.offer_id, Number(p.packs)]));
    const hasPet = (petRow.rowCount ?? 0) > 0;
    const list = offers.rows.map((o) => toShopOffer(o, { owned, bought, hasPet }));
    return {
      playerLevel: level,
      currencies: currencies.map((c) => ({ code: c.code, name: c.name, balance: c.balance })),
      categories: cats.rows
        .map((c) => ({ code: c.code, name: c.name, offers: list.filter((o) => o.categoryId === c.id).map(stripCategoryId) }))
        .filter((c) => c.offers.length > 0),
    };
  }

  async purchase(owner: Owner, input: unknown) {
    const d = purchaseSchema.parse(input);
    const result = await withTransaction(this.db, async (c) => {
      const pilot = await this.lockPilot(c, owner, d.serverCode);
      const key = `shop:${pilot.id}:${d.requestId}`;
      const prev = await c.query<{ offer_id: number; packs: number; total_price: string; currency_code: string }>(
        'SELECT offer_id, packs, total_price, currency_code FROM shop_purchases WHERE idempotency_key = $1',
        [key],
      );
      if (prev.rows[0]) {
        const p = prev.rows[0];
        return { offerId: p.offer_id, packs: p.packs, total: Number(p.total_price), currency: p.currency_code, replay: true };
      }
      const o = (await c.query<OfferRow>(`${OFFER_SELECT} WHERE o.id = $1 AND ${OFFER_ACTIVE}`, [d.offerId])).rows[0];
      if (!o) throw err('OFFER_UNAVAILABLE', 404, 'Bu ürün şu anda satışta değil.');
      const name = o.ship_name ?? o.item_name!;
      if (d.packs > o.max_per_purchase || (o.offer_type === 'ship' && d.packs !== 1)) {
        throw err('PURCHASE_LIMIT', 400, `Tek seferde en fazla ${o.max_per_purchase} paket alabilirsin.`);
      }
      const minLevel = o.ship_min_level ?? o.item_min_level ?? 1;
      if (levelForXp(pilot.experience) < minLevel) {
        throw err('LEVEL_TOO_LOW', 403, `${name} için en az seviye ${minLevel} olmalısın.`);
      }
      if (o.offer_type === 'ship') {
        const has = await c.query('SELECT 1 FROM player_ships WHERE player_id = $1 AND ship_type_id = $2', [pilot.id, o.ship_type_id]);
        if ((has.rowCount ?? 0) > 0) throw err('SHIP_OWNED', 409, `${name} zaten hangarında.`);
      }
      if (o.item_category === 'pet') {
        const has = await c.query('SELECT 1 FROM player_pets WHERE player_id = $1', [pilot.id]);
        if ((has.rowCount ?? 0) > 0) throw err('PURCHASE_LIMIT', 409, 'Zaten bir PET\'in var.');
      }
      if (o.per_player_limit) {
        const b = await c.query<{ n: string }>(
          'SELECT COALESCE(sum(packs), 0) AS n FROM shop_purchases WHERE player_id = $1 AND offer_id = $2',
          [pilot.id, o.id],
        );
        if (Number(b.rows[0]!.n) + d.packs > o.per_player_limit) {
          throw err('PURCHASE_LIMIT', 409, `${name} için satın alma sınırına ulaştın.`);
        }
      }
      const units = Number(o.quantity) * d.packs;
      if (o.offer_type === 'item') {
        const max = (await getSetting<{ max_items: number }>(c, 'inventory'))?.max_items ?? 300;
        let newRows = units;
        if (o.item_stackable) {
          const stack = await c.query('SELECT 1 FROM player_items WHERE player_id = $1 AND item_type_id = $2 AND is_stack', [
            pilot.id,
            o.item_type_id,
          ]);
          newRows = (stack.rowCount ?? 0) > 0 ? 0 : 1;
        }
        if ((await inventoryRowCount(c, pilot.id)) + newRows > max) {
          throw err('INVENTORY_FULL', 409, `Envanterin dolu (en fazla ${max} eşya). Bir şeyler sat veya kullan.`);
        }
      }
      const unit = finalPrice(o);
      const total = unit * d.packs;
      if (!Number.isSafeInteger(total)) throw err('VALIDATION_ERROR', 400, 'Geçersiz miktar.');
      if (total > 0) {
        await applyCurrencyChange(c, {
          playerId: pilot.id,
          currency: o.currency_code,
          delta: -total,
          reason: 'shop_purchase',
          refType: 'shop_offer',
          refId: String(o.id),
          idempotencyKey: key,
        });
      }
      if (o.offer_type === 'ship') {
        await c.query(
          `INSERT INTO player_ships (player_id, ship_type_id, hitpoints, source) VALUES ($1, $2, $3, 'shop')`,
          [pilot.id, o.ship_type_id, o.ship_hitpoints],
        );
      } else {
        const ids = await grantItem(c, pilot.id, { id: o.item_type_id!, stackable: o.item_stackable! }, units, {
          reason: 'shop_purchase',
          source: 'shop',
          refType: 'shop_offer',
          refId: String(o.id),
          idempotencyKey: key,
        });
        if (o.item_category === 'pet') {
          await c.query(`INSERT INTO player_pets (player_id, player_item_id, name) VALUES ($1, $2, 'Yoldaş')`, [pilot.id, ids[0]]);
        }
      }
      await c.query(
        `INSERT INTO shop_purchases (player_id, offer_id, packs, unit_price, total_price, currency_code, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [pilot.id, o.id, d.packs, unit, total, o.currency_code, key],
      );
      this.log.info({ playerId: pilot.id, offer: o.id, packs: d.packs, total }, 'mağaza satın alma');
      return { offerId: o.id, packs: d.packs, total, currency: o.currency_code, replay: false };
    });
    const currencies = (await this.hangar(owner, d.serverCode)).currencies;
    return { purchase: result, currencies };
  }
}

// ------------------------------------------------------------------ mağaza yardımcıları
interface OfferRow {
  id: number;
  category_id: number;
  offer_type: 'item' | 'ship';
  item_type_id: number | null;
  ship_type_id: number | null;
  quantity: string;
  currency_code: string;
  price: string;
  discount_percent: number;
  discount_ends_at: Date | null;
  max_per_purchase: number;
  per_player_limit: number | null;
  item_code: string | null;
  item_name: string | null;
  item_description: string | null;
  item_category: ItemCategory | null;
  item_rarity: string | null;
  item_icon: string | null;
  item_stats: Record<string, unknown> | null;
  item_min_level: number | null;
  item_stackable: boolean | null;
  item_requirements: { ship?: string } | null;
  ship_code: string | null;
  ship_name: string | null;
  ship_description: string | null;
  ship_class: string | null;
  ship_sprite: string | null;
  ship_hitpoints: number | null;
  ship_speed: number | null;
  ship_cargo: number | null;
  laser_slots: number | null;
  generator_slots: number | null;
  extra_slots: number | null;
  drone_slots: number | null;
  ship_min_level: number | null;
}

const OFFER_SELECT = `
  SELECT o.id, o.category_id, o.offer_type, o.item_type_id, o.ship_type_id, o.quantity, o.currency_code, o.price,
         o.discount_percent, o.discount_ends_at, o.max_per_purchase, o.per_player_limit,
         it.code AS item_code, it.name AS item_name, it.description AS item_description, it.category AS item_category,
         it.rarity AS item_rarity, it.icon_key AS item_icon, it.stats AS item_stats, it.min_level AS item_min_level,
         it.stackable AS item_stackable, it.requirements AS item_requirements,
         st.code AS ship_code, st.name AS ship_name, st.description AS ship_description, st.ship_class,
         st.sprite_key AS ship_sprite, st.hitpoints AS ship_hitpoints, st.base_speed AS ship_speed,
         st.cargo_capacity AS ship_cargo, st.laser_slots, st.generator_slots, st.extra_slots, st.drone_slots,
         st.min_level AS ship_min_level
  FROM shop_offers o
  JOIN shop_categories sc ON sc.id = o.category_id
  LEFT JOIN item_types it ON it.id = o.item_type_id
  LEFT JOIN ship_types st ON st.id = o.ship_type_id`;

const OFFER_ACTIVE = `o.is_active AND sc.is_visible
  AND (o.starts_at IS NULL OR o.starts_at <= now()) AND (o.ends_at IS NULL OR o.ends_at > now())
  AND (o.item_type_id IS NULL OR NOT it.is_archived) AND (o.ship_type_id IS NULL OR (NOT st.is_archived AND st.is_for_sale))`;

function finalPrice(o: OfferRow): number {
  const price = Number(o.price);
  const discountActive = o.discount_percent > 0 && (!o.discount_ends_at || o.discount_ends_at.getTime() > Date.now());
  return discountActive ? Math.round((price * (100 - o.discount_percent)) / 100) : price;
}

function toShopOffer(
  o: OfferRow,
  ctx: { owned: Set<number>; bought: Map<number, number>; hasPet: boolean },
): ShopOffer & { categoryId: number } {
  const isShip = o.offer_type === 'ship';
  const fp = finalPrice(o);
  const bought = ctx.bought.get(o.id) ?? 0;
  return {
    categoryId: o.category_id,
    id: o.id,
    type: o.offer_type,
    code: (isShip ? o.ship_code : o.item_code)!,
    name: (isShip ? o.ship_name : o.item_name)!,
    description: (isShip ? o.ship_description : o.item_description) ?? '',
    category: isShip ? 'ship' : o.item_category!,
    rarity: isShip ? 'rare' : o.item_rarity!,
    iconKey: isShip ? o.ship_sprite! : o.item_icon!,
    stats: isShip ? {} : (parseItemStats(o.item_category!, o.item_stats) as Record<string, unknown>),
    ship: isShip
      ? {
          code: o.ship_code!,
          name: o.ship_name!,
          description: o.ship_description,
          shipClass: o.ship_class!,
          spriteKey: o.ship_sprite!,
          hitpoints: o.ship_hitpoints!,
          baseSpeed: o.ship_speed!,
          cargoCapacity: o.ship_cargo!,
          slots: { laser: o.laser_slots!, generator: o.generator_slots!, extra: o.extra_slots!, drone: o.drone_slots! },
          minLevel: o.ship_min_level!,
        }
      : null,
    quantity: Number(o.quantity),
    currency: o.currency_code,
    price: Number(o.price),
    finalPrice: fp,
    discountPercent: fp !== Number(o.price) ? o.discount_percent : 0,
    maxPerPurchase: o.max_per_purchase,
    minLevel: (isShip ? o.ship_min_level : o.item_min_level) ?? 1,
    owned: isShip ? ctx.owned.has(o.ship_type_id!) : o.item_category === 'pet' && ctx.hasPet,
    limitReached: o.per_player_limit !== null && bought >= o.per_player_limit,
    requiresShip: o.item_requirements?.ship ?? null,
  };
}

function stripCategoryId(o: ShopOffer & { categoryId: number }): ShopOffer {
  const { categoryId: _c, ...rest } = o;
  return rest;
}

function uuidOr404(id: string, code: 'SHIP_NOT_FOUND' | 'ITEM_NOT_FOUND' = 'SHIP_NOT_FOUND'): string {
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    throw err(code, 404, code === 'SHIP_NOT_FOUND' ? 'Gemi hangarında bulunamadı.' : 'Eşya envanterinde bulunamadı.');
  }
  return id;
}
