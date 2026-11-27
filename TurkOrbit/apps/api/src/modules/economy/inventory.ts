/**
 * Envanter çekirdeği — TÜM eşya hareketleri bu fonksiyonlardan geçer ve item_ledger'a yazılır.
 * MUTLAKA bir transaction içinde, oyuncu satırı kilitliyken çağrılmalıdır.
 */
import type { Queryable } from '../../db/pool.js';

export interface ItemTypeRef {
  id: number;
  stackable: boolean;
}

export interface GrantOptions {
  reason: string;
  idempotencyKey?: string;
  refType?: string;
  refId?: string;
  source?: string;
  actorUserId?: string | null;
}

/** Eşya verir. Yığınlanabilirse mevcut yığına ekler, değilse adet kadar ayrı örnek oluşturur. */
export async function grantItem(
  tx: Queryable,
  playerId: string,
  type: ItemTypeRef,
  quantity: number,
  o: GrantOptions,
): Promise<string[]> {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error(`Geçersiz eşya miktarı: ${quantity}`);
  if (o.idempotencyKey) {
    const prev = await tx.query('SELECT 1 FROM item_ledger WHERE idempotency_key = $1 OR idempotency_key = $2', [
      o.idempotencyKey,
      `${o.idempotencyKey}:0`,
    ]);
    if ((prev.rowCount ?? 0) > 0) return [];
  }
  const source = o.source ?? o.reason;
  const ledger = (itemId: string, delta: number, key: string | null) =>
    tx.query(
      `INSERT INTO item_ledger (player_id, item_type_id, player_item_id, delta, reason, ref_type, ref_id, idempotency_key, actor_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [playerId, type.id, itemId, delta, o.reason, o.refType ?? null, o.refId ?? null, key, o.actorUserId ?? null],
    );

  if (type.stackable) {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO player_items (player_id, item_type_id, is_stack, quantity, source) VALUES ($1, $2, true, $3, $4)
       ON CONFLICT (player_id, item_type_id) WHERE is_stack
       DO UPDATE SET quantity = player_items.quantity + EXCLUDED.quantity
       RETURNING id`,
      [playerId, type.id, quantity, source],
    );
    await ledger(r.rows[0]!.id, quantity, o.idempotencyKey ?? null);
    return [r.rows[0]!.id];
  }
  const ids: string[] = [];
  for (let i = 0; i < quantity; i++) {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO player_items (player_id, item_type_id, is_stack, quantity, source) VALUES ($1, $2, false, 1, $3) RETURNING id`,
      [playerId, type.id, source],
    );
    ids.push(r.rows[0]!.id);
    await ledger(r.rows[0]!.id, 1, o.idempotencyKey ? `${o.idempotencyKey}:${i}` : null);
  }
  return ids;
}

/** Eşya düşer (satış vb.). Yığında miktar azalır; sıfırlanırsa satır silinir. */
export async function removeItem(
  tx: Queryable,
  playerId: string,
  item: { id: string; itemTypeId: number; quantity: number; isStack: boolean },
  quantity: number,
  o: GrantOptions,
): Promise<void> {
  if (quantity <= 0 || quantity > item.quantity) throw new Error('Geçersiz düşülecek miktar');
  if (item.isStack && quantity < item.quantity) {
    await tx.query('UPDATE player_items SET quantity = quantity - $2 WHERE id = $1', [item.id, quantity]);
  } else {
    await tx.query('DELETE FROM player_items WHERE id = $1', [item.id]);
  }
  await tx.query(
    `INSERT INTO item_ledger (player_id, item_type_id, player_item_id, delta, reason, ref_type, ref_id, idempotency_key, actor_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [playerId, item.itemTypeId, item.id, -quantity, o.reason, o.refType ?? null, o.refId ?? null, o.idempotencyKey ?? null, o.actorUserId ?? null],
  );
}

export async function inventoryRowCount(tx: Queryable, playerId: string): Promise<number> {
  const r = await tx.query<{ n: string }>('SELECT count(*) AS n FROM player_items WHERE player_id = $1', [playerId]);
  return Number(r.rows[0]!.n);
}
