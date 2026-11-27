/**
 * Cüzdan çekirdeği — TÜM para hareketleri bu fonksiyondan geçer (Aşama 11 ekonomi de bunu kullanacak).
 *
 * Garantiler:
 *  1. Satır kilidi (SELECT … FOR UPDATE): aynı cüzdana eşzamanlı işlemler sıraya girer.
 *  2. Negatif bakiye imkânsız: hem kod kontrolü hem veritabanı CHECK (balance >= 0).
 *  3. Her değişiklik aynı transaction'da yalnızca eklenebilir deftere (currency_ledger) yazılır.
 *  4. idempotency_key: aynı işlem (ör. ağ tekrarı, çift tıklama) ikinci kez UYGULANMAZ.
 */
import type { Queryable } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';

export interface CurrencyChange {
  playerId: string;
  currency: string;
  /** Pozitif: ekleme, negatif: harcama. Sıfır olamaz. */
  delta: number;
  reason: string;
  refType?: string;
  refId?: string;
  idempotencyKey?: string;
  actorUserId?: string | null;
}

export interface CurrencyChangeResult {
  /** false: aynı idempotency_key ile daha önce uygulanmış, bu çağrı hiçbir şey değiştirmedi. */
  applied: boolean;
  balance: number;
  ledgerId: string;
}

const formatTr = (n: number) => n.toLocaleString('tr-TR');

/** MUTLAKA bir transaction içindeki istemciyle çağrılmalıdır. */
export async function applyCurrencyChange(tx: Queryable, c: CurrencyChange): Promise<CurrencyChangeResult> {
  if (!Number.isSafeInteger(c.delta) || c.delta === 0) {
    throw new Error(`Geçersiz para değişimi: ${c.delta}`);
  }
  await tx.query(
    `INSERT INTO wallets (player_id, currency_code) VALUES ($1, $2) ON CONFLICT (player_id, currency_code) DO NOTHING`,
    [c.playerId, c.currency],
  );
  const locked = await tx.query<{ balance: string }>(
    `SELECT balance FROM wallets WHERE player_id = $1 AND currency_code = $2 FOR UPDATE`,
    [c.playerId, c.currency],
  );
  const balance = Number(locked.rows[0]!.balance);

  // Kilit alındıktan sonra kontrol edilir: aynı anahtarla gelen eşzamanlı istek burada bekler ve tekrarı görür.
  if (c.idempotencyKey) {
    const prev = await tx.query<{ id: string; player_id: string; currency_code: string; delta: string }>(
      `SELECT id::text, player_id, currency_code, delta FROM currency_ledger WHERE idempotency_key = $1`,
      [c.idempotencyKey],
    );
    const p = prev.rows[0];
    if (p) {
      if (p.player_id !== c.playerId || p.currency_code !== c.currency || Number(p.delta) !== c.delta) {
        throw new Error(`idempotency_key farklı bir işlem için kullanılmış: ${c.idempotencyKey}`);
      }
      return { applied: false, balance, ledgerId: p.id };
    }
  }

  const next = balance + c.delta;
  if (next < 0) {
    const currencyName = (
      await tx.query<{ name: string }>('SELECT name FROM currencies WHERE code = $1', [c.currency])
    ).rows[0]?.name ?? c.currency;
    throw new AppError(
      'INSUFFICIENT_FUNDS',
      400,
      `Yeterli ${currencyName} yok. Gerekli: ${formatTr(-c.delta)}, bakiyen: ${formatTr(balance)}.`,
    );
  }
  await tx.query(
    `UPDATE wallets SET balance = $3, updated_at = now() WHERE player_id = $1 AND currency_code = $2`,
    [c.playerId, c.currency, next],
  );
  const ins = await tx.query<{ id: string }>(
    `INSERT INTO currency_ledger (player_id, currency_code, delta, balance_after, reason, ref_type, ref_id,
       idempotency_key, actor_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id::text`,
    [
      c.playerId,
      c.currency,
      c.delta,
      next,
      c.reason,
      c.refType ?? null,
      c.refId ?? null,
      c.idempotencyKey ?? null,
      c.actorUserId ?? null,
    ],
  );
  return { applied: true, balance: next, ledgerId: ins.rows[0]!.id };
}

export async function getBalances(db: Queryable, playerId: string) {
  const { rows } = await db.query<{ code: string; name: string; is_premium: boolean; balance: string }>(
    `SELECT c.code, c.name, c.is_premium, COALESCE(w.balance, 0) AS balance
     FROM currencies c LEFT JOIN wallets w ON w.currency_code = c.code AND w.player_id = $1
     ORDER BY c.sort_order`,
    [playerId],
  );
  return rows.map((r) => ({ code: r.code, name: r.name, isPremium: r.is_premium, balance: Number(r.balance) }));
}

export async function listLedger(db: Queryable, playerId: string, limit = 50) {
  const { rows } = await db.query<{
    id: string;
    currency_code: string;
    delta: string;
    balance_after: string;
    reason: string;
    created_at: Date;
  }>(
    `SELECT id::text, currency_code, delta, balance_after, reason, created_at FROM currency_ledger
     WHERE player_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`,
    [playerId, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    currency: r.currency_code,
    delta: Number(r.delta),
    balanceAfter: Number(r.balance_after),
    reason: r.reason,
    createdAt: r.created_at.toISOString(),
  }));
}
