/**
 * Oyun sunucusu süreci: `npm run dev:game` (geliştirme) / `npm run start:game` (üretim).
 * API ile aynı veritabanını, Redis'i ve .env dosyasını kullanır; ayrı bir süreç ve port (GAME_PORT, varsayılan 4001).
 */
import { Redis } from 'ioredis';
import { loadConfig } from '../config/env.js';
import { createPool } from '../db/pool.js';
import { createLogger } from './logger.js';
import { GameServer } from './server.js';

const config = loadConfig();
const log = createLogger(config.logLevel);

if (!config.redisUrl) {
  log.error({}, 'REDIS_URL gerekli: oyun bileti, tek aktif oturum ve canlı güncellemeler Redis kullanır.');
  process.exit(1);
}

const db = createPool(config.databaseUrl, 10);
const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 2 });
const sub = redis.duplicate();

const server = new GameServer({
  db,
  redis,
  sub,
  log,
  allowedOrigins: config.allowedOrigins,
  lingerSeconds: config.game.lingerSeconds,
});

const port = await server.listen(config.game.port, config.host);
log.info({ port, instance: server.instanceId }, `Türk Orbit oyun sunucusu ws://${config.host}:${port}/game adresinde çalışıyor`);

async function shutdown(signal: string) {
  log.info({ signal }, 'oyun sunucusu kapatılıyor');
  await server.close();
  await db.end();
  await Promise.all([redis.quit().catch(() => undefined), sub.quit().catch(() => undefined)]);
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
