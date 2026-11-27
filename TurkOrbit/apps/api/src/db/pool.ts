import pg from 'pg';

export type Db = pg.Pool;
export type DbClient = pg.PoolClient;
/** Hem havuz hem transaction istemcisi ile çalışabilen sorgu arayüzü. */
export type Queryable = Pick<pg.Pool, 'query'> | Pick<pg.PoolClient, 'query'>;

export function createPool(connectionString: string, max = 20): Db {
  const pool = new pg.Pool({
    connectionString,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'turkorbit-api',
  });
  // Boşta bekleyen bağlantı hatası süreci çökertmesin; bir sonraki sorguda yeniden bağlanılır.
  pool.on('error', (err) => {
    console.error('[db] boşta bekleyen bağlantı hatası:', err.message);
  });
  return pool;
}

/** fn içinde atılan her hata transaction'ı geri alır. */
export async function withTransaction<T>(pool: Db, fn: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** PostgreSQL benzersizlik ihlali (23505) ve ihlal edilen kısıt adı. */
export function uniqueViolation(err: unknown): string | null {
  if (typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505') {
    return (err as { constraint?: string }).constraint ?? 'unknown';
  }
  return null;
}
