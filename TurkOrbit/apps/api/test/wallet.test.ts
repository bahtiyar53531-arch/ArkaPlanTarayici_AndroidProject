import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTransaction } from '../src/db/pool.js';
import { applyCurrencyChange } from '../src/modules/economy/wallet.js';
import { call, createTestContext, registerAndLogin, resetDatabase, type TestContext } from './helpers.js';

let ctx: TestContext;
let playerId: string;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => ctx.close());
beforeEach(async () => {
  await resetDatabase(ctx.rt);
  const { client } = await registerAndLogin(ctx, 'CuzdanPilot');
  const r = await call(ctx.app, client, 'POST', '/players', { serverCode: 'TR1', companyCode: 'ALT' });
  playerId = r.json().pilot.id;
  await ctx.rt.db.query(`UPDATE wallets SET balance = 1000 WHERE player_id = $1 AND currency_code = 'KREDI'`, [playerId]);
});

const balance = async () =>
  Number(
    (await ctx.rt.db.query(`SELECT balance FROM wallets WHERE player_id = $1 AND currency_code = 'KREDI'`, [playerId]))
      .rows[0].balance,
  );

describe('cüzdan çekirdeği (gerçek PostgreSQL)', () => {
  it('eşzamanlı 20 harcamadan yalnızca bakiyenin karşıladığı 10 tanesi uygulanır; bakiye asla negatif olmaz', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        withTransaction(ctx.rt.db, (c) =>
          applyCurrencyChange(c, { playerId, currency: 'KREDI', delta: -100, reason: 'shop_purchase' }),
        ),
      ),
    );
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected');
    expect(ok).toBe(10);
    expect(failed).toHaveLength(10);
    for (const f of failed) expect((f as PromiseRejectedResult).reason.code).toBe('INSUFFICIENT_FUNDS');
    expect(await balance()).toBe(0);
    const { rows } = await ctx.rt.db.query(
      `SELECT count(*)::int AS n, sum(delta)::int AS s FROM currency_ledger WHERE player_id = $1 AND reason = 'shop_purchase'`,
      [playerId],
    );
    expect(rows[0]).toEqual({ n: 10, s: -1000 });
  });

  it('aynı idempotency_key ile eşzamanlı 10 istek yalnızca bir kez uygulanır', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        withTransaction(ctx.rt.db, (c) =>
          applyCurrencyChange(c, {
            playerId,
            currency: 'KREDI',
            delta: 500,
            reason: 'quest_reward',
            idempotencyKey: `quest:42:${playerId}`,
          }),
        ),
      ),
    );
    expect(results.filter((r) => r.applied)).toHaveLength(1);
    expect(new Set(results.map((r) => r.ledgerId)).size).toBe(1);
    expect(await balance()).toBe(1500);
  });

  it('aynı anahtar farklı tutarla kullanılamaz', async () => {
    await withTransaction(ctx.rt.db, (c) =>
      applyCurrencyChange(c, { playerId, currency: 'KREDI', delta: 10, reason: 'npc_reward', idempotencyKey: 'k1' }),
    );
    await expect(
      withTransaction(ctx.rt.db, (c) =>
        applyCurrencyChange(c, { playerId, currency: 'KREDI', delta: 99, reason: 'npc_reward', idempotencyKey: 'k1' }),
      ),
    ).rejects.toThrow(/farklı bir işlem/);
  });

  it('transaction geri alınırsa bakiye ve defter değişmez', async () => {
    await expect(
      withTransaction(ctx.rt.db, async (c) => {
        await applyCurrencyChange(c, { playerId, currency: 'KREDI', delta: 300, reason: 'npc_reward' });
        throw new Error('sonraki adım başarısız');
      }),
    ).rejects.toThrow();
    expect(await balance()).toBe(1000);
    const { rows } = await ctx.rt.db.query(`SELECT count(*)::int AS n FROM currency_ledger WHERE reason = 'npc_reward'`);
    expect(rows[0].n).toBe(0);
  });

  it('veritabanı seviyesinde negatif bakiye ve defter değişikliği engellenir', async () => {
    await expect(
      ctx.rt.db.query(`UPDATE wallets SET balance = -1 WHERE player_id = $1 AND currency_code = 'KREDI'`, [playerId]),
    ).rejects.toThrow(/check/i);
    await expect(ctx.rt.db.query(`UPDATE currency_ledger SET delta = 999999`)).rejects.toThrow(/değiştirilemez/);
  });

  it('sıfır veya tam sayı olmayan tutar reddedilir', async () => {
    for (const delta of [0, 1.5, Number.NaN]) {
      await expect(
        withTransaction(ctx.rt.db, (c) => applyCurrencyChange(c, { playerId, currency: 'KREDI', delta, reason: 'x' })),
      ).rejects.toThrow(/Geçersiz/);
    }
  });
});
