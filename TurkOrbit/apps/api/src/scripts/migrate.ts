/**
 * Veritabanı migration'larını uygular.
 * Kullanım: npm run db:migrate   (DATABASE_URL ortam değişkeni veya TurkOrbit/.env gerekir)
 */
import { loadConfig } from '../config/env.js';
import { runMigrations } from '../db/migrate.js';
import { createPool } from '../db/pool.js';

const config = loadConfig();
const pool = createPool(config.databaseUrl, 2);
try {
  const r = await runMigrations(pool);
  for (const f of r.applied) console.log(`✔ uygulandı: ${f}`);
  console.log(`Migration tamamlandı. Yeni: ${r.applied.length}, zaten uygulanmış: ${r.skipped.length}`);
} catch (err) {
  console.error(`✖ ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
