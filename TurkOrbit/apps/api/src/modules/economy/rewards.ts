/**
 * Ödül verme çekirdeği (Aşama 9-10): NPC ödülü, kargo kutusu ve görev ödülü aynı yoldan geçer.
 * Para → currency_ledger, eşya → item_ledger (idempotent anahtarla), deneyim/şeref → players.
 * MUTLAKA bir transaction içinde çağrılmalıdır; oyuncu satırını kendisi kilitler.
 */
import { levelForXp, type RolledReward } from '@turkorbit/shared';
import type { Queryable } from '../../db/pool.js';
import { grantItem } from './inventory.js';
import { applyCurrencyChange } from './wallet.js';

export interface GrantResult {
  experience: number;
  levelBefore: number;
  level: number;
  currencies: Array<{ code: string; amount: number }>;
  items: Array<{ code: string; name: string; amount: number }>;
  honor: number;
}

export interface ItemResolver {
  (code: string): { id: number; name: string; stackable: boolean } | undefined;
}

export const lockPlayer = (c: Queryable, playerId: string) =>
  c.query<{ experience: string }>('SELECT experience FROM players WHERE id = $1 FOR UPDATE', [playerId]);

/**
 * key: idempotent anahtar öneki (ör. "npc:<kill>:<pilot>", "quest:<pilot>:<görev>:<döngü>").
 * Her para/eşya kaydı "<key>:<kod>" anahtarıyla yazılır; aynı anahtar ikinci kez uygulanmaz.
 */
export async function grantRewards(
  c: Queryable,
  items: ItemResolver,
  playerId: string,
  rewards: RolledReward[],
  o: { key: string; reason: string; refType: string; refId: string },
): Promise<GrantResult> {
  const locked = await lockPlayer(c, playerId);
  const xpBefore = Number(locked.rows[0]?.experience ?? 0);
  let xp = 0;
  let honor = 0;
  const currencies: GrantResult['currencies'] = [];
  const granted: GrantResult['items'] = [];
  for (const r of rewards) {
    if (r.type === 'experience') xp += r.amount;
    else if (r.type === 'honor') honor += r.amount;
    else if (r.type === 'currency') {
      await applyCurrencyChange(c, { playerId, currency: r.code, delta: r.amount, reason: o.reason, refType: o.refType, refId: o.refId, idempotencyKey: `${o.key}:${r.code}` });
      currencies.push({ code: r.code, amount: r.amount });
    } else if (r.type === 'item') {
      const it = items(r.code);
      if (!it) continue;
      await grantItem(c, playerId, { id: it.id, stackable: it.stackable }, r.amount, { reason: o.reason, refType: o.refType, refId: o.refId, idempotencyKey: `${o.key}:${r.code}` });
      granted.push({ code: r.code, name: it.name, amount: r.amount });
    }
  }
  let xpAfter = xpBefore;
  if (xp > 0 || honor !== 0) {
    const u = await c.query<{ experience: string }>('UPDATE players SET experience = experience + $2, honor = honor + $3 WHERE id = $1 RETURNING experience', [
      playerId,
      xp,
      honor,
    ]);
    xpAfter = Number(u.rows[0]!.experience);
  }
  return { experience: xp, levelBefore: levelForXp(xpBefore), level: levelForXp(xpAfter), currencies, items: granted, honor };
}
