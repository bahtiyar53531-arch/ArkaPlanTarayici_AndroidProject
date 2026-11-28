/**
 * Klan hazinesi çekirdeği (Aşama 12): oyuncu cüzdanıyla (economy/wallet.ts) aynı garantiler.
 *  1. Satır kilidi: aynı hazineye eşzamanlı işlemler sıraya girer.
 *  2. Negatif bakiye imkânsız: kod kontrolü + veritabanı CHECK (balance >= 0).
 *  3. Her değişiklik aynı transaction'da yalnızca eklenebilir deftere yazılır.
 *  4. idempotency_key: aynı işlem ikinci kez uygulanmaz.
 *
 * KİLİT SIRASI: önce oyuncu satırı/cüzdanı, EN SON klan cüzdanı (kilitlenme/deadlock olmaz).
 */
import type { Queryable } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';
import { applyCurrencyChange } from '../economy/wallet.js';

export interface ClanCurrencyChange {
  clanId: string;
  currency: string;
  delta: number;
  reason: string;
  playerId?: string | null;
  actorPlayerId?: string | null;
  refType?: string;
  refId?: string;
  idempotencyKey?: string;
}

const fmt = (n: number) => n.toLocaleString('tr-TR');

/** MUTLAKA transaction içinde çağrılmalıdır. */
export async function applyClanCurrencyChange(tx: Queryable, c: ClanCurrencyChange): Promise<{ applied: boolean; balance: number }> {
  if (!Number.isSafeInteger(c.delta) || c.delta === 0) throw new Error(`Geçersiz hazine değişimi: ${c.delta}`);
  await tx.query(`INSERT INTO clan_wallets (clan_id, currency_code) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [c.clanId, c.currency]);
  const locked = await tx.query<{ balance: string }>(`SELECT balance FROM clan_wallets WHERE clan_id = $1 AND currency_code = $2 FOR UPDATE`, [
    c.clanId,
    c.currency,
  ]);
  const balance = Number(locked.rows[0]!.balance);
  if (c.idempotencyKey) {
    const prev = await tx.query<{ clan_id: string; delta: string }>(`SELECT clan_id, delta FROM clan_treasury_ledger WHERE idempotency_key = $1`, [c.idempotencyKey]);
    const p = prev.rows[0];
    if (p) {
      if (p.clan_id !== c.clanId || Number(p.delta) !== c.delta) throw new Error(`idempotency_key farklı bir hazine işlemi için kullanılmış: ${c.idempotencyKey}`);
      return { applied: false, balance };
    }
  }
  const next = balance + c.delta;
  if (next < 0) throw new AppError('INSUFFICIENT_FUNDS', 400, `Klan hazinesinde yeterli Kredi yok. Gerekli: ${fmt(-c.delta)}, hazine: ${fmt(balance)}.`);
  await tx.query(`UPDATE clan_wallets SET balance = $3, updated_at = now() WHERE clan_id = $1 AND currency_code = $2`, [c.clanId, c.currency, next]);
  await tx.query(
    `INSERT INTO clan_treasury_ledger (clan_id, currency_code, delta, balance_after, reason, player_id, actor_player_id, ref_type, ref_id, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [c.clanId, c.currency, c.delta, next, c.reason, c.playerId ?? null, c.actorPlayerId ?? null, c.refType ?? null, c.refId ?? null, c.idempotencyKey ?? null],
  );
  return { applied: true, balance: next };
}

/**
 * NPC ödülünden klan vergisi (Aşama 12): pilotun klanı vergi alıyorsa kazandığı Kredi'nin yüzdesi hazineye aktarılır.
 * Oyuncu cüzdanından düşülür (clan_tax) ve hazineye eklenir; iki kayıt da aynı anahtarla idempotent.
 * Birden çok pilot için çağrılırken klan kimliğine göre SIRALI çağrılmalıdır (klan cüzdanı kilit sırası).
 * Dönüş: aktarılan vergi (yoksa 0).
 */
export async function applyClanTax(
  tx: Queryable,
  o: { playerId: string; clanId: string; taxPercent: number; credits: number; key: string; refType: string; refId: string },
): Promise<number> {
  if (o.credits <= 0 || o.taxPercent <= 0) return 0;
  const tax = Math.floor((o.credits * o.taxPercent) / 100);
  if (tax <= 0) return 0;
  const w = await applyCurrencyChange(tx, { playerId: o.playerId, currency: 'KREDI', delta: -tax, reason: 'clan_tax', refType: o.refType, refId: o.refId, idempotencyKey: `${o.key}:tax` });
  if (!w.applied) return tax;
  await applyClanCurrencyChange(tx, {
    clanId: o.clanId,
    currency: 'KREDI',
    delta: tax,
    reason: 'clan_tax',
    playerId: o.playerId,
    refType: o.refType,
    refId: o.refId,
    idempotencyKey: `${o.key}:tax`,
  });
  return tax;
}

/** Pilotların klan ve vergi oranları (vergisi olmayanlar dönmez), klan kimliğine göre sıralı. */
export async function clanTaxes(tx: Queryable, playerIds: string[]): Promise<Array<{ playerId: string; clanId: string; taxPercent: number }>> {
  if (playerIds.length === 0) return [];
  const r = await tx.query<{ player_id: string; clan_id: string; tax_percent: number }>(
    `SELECT cm.player_id, c.id AS clan_id, c.tax_percent FROM clan_members cm JOIN clans c ON c.id = cm.clan_id
     WHERE cm.player_id = ANY($1::uuid[]) AND c.tax_percent > 0 ORDER BY c.id, cm.player_id`,
    [playerIds],
  );
  return r.rows.map((x) => ({ playerId: x.player_id, clanId: x.clan_id, taxPercent: x.tax_percent }));
}
