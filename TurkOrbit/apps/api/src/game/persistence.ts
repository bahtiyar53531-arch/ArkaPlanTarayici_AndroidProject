/**
 * Savaşın kalıcı sonuçları (Aşama 9). Anlık durum (can, kalkan, konum) bellekte tutulur; kalıcı sonuçlar
 * transaction içinde ve idempotency anahtarıyla yazılır: ağ tekrarı veya çift işleme ÇİFT ÖDÜL üretmez.
 */
import type { RolledReward } from '@turkorbit/shared';
import { withTransaction, type Db } from '../db/pool.js';
import { grantRewards, lockPlayer, type GrantResult } from '../modules/economy/rewards.js';
import { removeItem } from '../modules/economy/inventory.js';
import type { GameContent } from './content.js';

export type { GrantResult } from '../modules/economy/rewards.js';

export class CombatStore {
  constructor(
    private readonly db: Db,
    private readonly content: GameContent,
  ) {}

  private readonly items = (code: string) => this.content.items.get(code);

  /**
   * NPC öldürme: kayıt (kill_id benzersiz) + katkıya göre bölünmüş doğrudan ödüller + istatistik, tek transaction.
   * Öldürme kaydı ve `npc_kills` en çok hasar verene yazılır. Aynı kill_id ikinci kez işlenmez (null döner).
   * Kilit sırası oyuncu kimliğine göre sabittir (eşzamanlı işlemlerle kilitlenme olmaz).
   */
  async npcKill(killId: string, killerId: string, npcTypeId: number, mapCode: string, grants: Array<{ playerId: string; rewards: RolledReward[] }>): Promise<Map<string, GrantResult> | null> {
    return withTransaction(this.db, async (c) => {
      const ins = await c.query(
        `INSERT INTO npc_kill_log (kill_id, player_id, npc_type_id, map_id) VALUES ($1, $2, $3, $4) ON CONFLICT (kill_id) DO NOTHING`,
        [killId, killerId, npcTypeId, this.content.mapIds.get(mapCode)],
      );
      if ((ins.rowCount ?? 0) === 0) return null;
      const out = new Map<string, GrantResult>();
      for (const g of [...grants].sort((a, b) => (a.playerId < b.playerId ? -1 : 1))) {
        out.set(g.playerId, await grantRewards(c, this.items, g.playerId, g.rewards, { key: `npc:${killId}:${g.playerId}`, reason: 'npc_reward', refType: 'npc_kill', refId: killId }));
      }
      await c.query(
        `INSERT INTO player_stats (player_id, npc_kills) VALUES ($1, 1)
         ON CONFLICT (player_id) DO UPDATE SET npc_kills = player_stats.npc_kills + 1, updated_at = now()`,
        [killerId],
      );
      return out;
    });
  }

  /** Kargo kutusu toplama: eşyalar envantere (defterli). Aynı kutu ikinci kez verilemez. */
  async collectCargo(cargoId: string, playerId: string, rewards: RolledReward[]): Promise<GrantResult> {
    return withTransaction(this.db, async (c) => {
      const res = await grantRewards(c, this.items, playerId, rewards, { key: `cargo:${cargoId}`, reason: 'cargo_loot', refType: 'cargo', refId: cargoId });
      await c.query(
        `INSERT INTO player_stats (player_id, cargo_collected) VALUES ($1, 1)
         ON CONFLICT (player_id) DO UPDATE SET cargo_collected = player_stats.cargo_collected + 1, updated_at = now()`,
        [playerId],
      );
      return res;
    });
  }

  /** PvP: düşman pilotu yenen şeref kazanır (defterli değil, oyuncu satırında). */
  async pilotKill(killerId: string, honor: number) {
    await withTransaction(this.db, async (c) => {
      await lockPlayer(c, killerId);
      if (honor) await c.query('UPDATE players SET honor = honor + $2 WHERE id = $1', [killerId, honor]);
      await c.query(
        `INSERT INTO player_stats (player_id, player_kills) VALUES ($1, 1)
         ON CONFLICT (player_id) DO UPDATE SET player_kills = player_stats.player_kills + 1, updated_at = now()`,
        [killerId],
      );
    });
  }

  async death(o: { playerId: string; shipId: string | null; mapCode: string; x: number; y: number; killer: { kind: 'npc' | 'player' | 'other'; npcTypeId?: number; playerId?: string } }) {
    await withTransaction(this.db, async (c) => {
      if (o.shipId) await c.query('UPDATE player_ships SET hitpoints = 0 WHERE id = $1', [o.shipId]);
      await c.query(
        `INSERT INTO combat_deaths (player_id, map_id, x, y, killer_kind, killer_npc_type_id, killer_player_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [o.playerId, this.content.mapIds.get(o.mapCode), o.x, o.y, o.killer.kind, o.killer.npcTypeId ?? null, o.killer.playerId ?? null],
      );
      await c.query(
        `INSERT INTO player_stats (player_id, deaths) VALUES ($1, 1)
         ON CONFLICT (player_id) DO UPDATE SET deaths = player_stats.deaths + 1, updated_at = now()`,
        [o.playerId],
      );
    });
  }

  /** Harcanan mühimmat toplu düşülür (defter: ammo_used). Envanterde kalandan fazlası düşülmez. */
  async useAmmo(playerId: string, used: Map<string, number>, key: string): Promise<Map<string, number>> {
    const left = new Map<string, number>();
    if (used.size === 0) return left;
    await withTransaction(this.db, async (c) => {
      await lockPlayer(c, playerId);
      for (const [code, qty] of used) {
        const it = this.content.items.get(code);
        if (!it || qty <= 0) continue;
        const r = await c.query<{ id: string; quantity: number }>(
          'SELECT id, quantity FROM player_items WHERE player_id = $1 AND item_type_id = $2 AND is_stack FOR UPDATE',
          [playerId, it.id],
        );
        const row = r.rows[0] ? { id: r.rows[0].id, quantity: Number(r.rows[0].quantity) } : undefined;
        if (!row) {
          left.set(code, 0);
          continue;
        }
        const take = Math.min(qty, row.quantity);
        if (take > 0) {
          await removeItem(c, playerId, { id: row.id, itemTypeId: it.id, quantity: row.quantity, isStack: true }, take, {
            reason: 'ammo_used',
            idempotencyKey: `${key}:${code}`,
          });
        }
        left.set(code, row.quantity - take);
      }
    });
    return left;
  }

  async ammoCounts(playerId: string): Promise<Map<string, number>> {
    const r = await this.db.query<{ code: string; quantity: number }>(
      `SELECT it.code, pi.quantity FROM player_items pi JOIN item_types it ON it.id = pi.item_type_id
       WHERE pi.player_id = $1 AND pi.is_stack AND it.category IN ('ammo', 'rocket')`,
      [playerId],
    );
    return new Map(r.rows.map((x) => [x.code, Number(x.quantity)]));
  }

  /** Can (gövde) ve hasar istatistikleri toplu yazılır. */
  async saveCombatState(rows: Array<{ playerId: string; shipId: string | null; hp: number; dealt: number; taken: number }>) {
    if (rows.length === 0) return;
    await withTransaction(this.db, async (c) => {
      for (const r of rows) {
        if (r.shipId) await c.query('UPDATE player_ships SET hitpoints = $2 WHERE id = $1', [r.shipId, Math.max(0, Math.round(r.hp))]);
        if (r.dealt || r.taken) {
          await c.query(
            `INSERT INTO player_stats (player_id, damage_dealt, damage_taken) VALUES ($1, $2, $3)
             ON CONFLICT (player_id) DO UPDATE SET damage_dealt = player_stats.damage_dealt + $2,
               damage_taken = player_stats.damage_taken + $3, updated_at = now()`,
            [r.playerId, Math.round(r.dealt), Math.round(r.taken)],
          );
        }
      }
    });
  }
}
