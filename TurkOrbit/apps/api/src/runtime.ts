import { Redis } from 'ioredis';
import type { AppConfig } from './config/env.js';
import { createPool, type Db } from './db/pool.js';
import { ConsoleMailer, MemoryMailer, SmtpMailer, type Mailer } from './lib/mailer.js';
import { PasswordHasher } from './lib/password.js';
import { MemoryRateLimiter, RedisRateLimiter, type RateLimiter } from './lib/rate-limit.js';
import { NoopSessionCache, RedisSessionCache, type SessionCache } from './modules/auth/session-cache.js';

/** Sunucunun dış bağımlılıkları. Testler aynı yapıyı gerçek PostgreSQL/Redis ile kurar. */
export interface Runtime {
  config: AppConfig;
  db: Db;
  redis: Redis | null;
  limiter: RateLimiter;
  cache: SessionCache;
  mailer: Mailer;
  hasher: PasswordHasher;
  close(): Promise<void>;
}

export function createRuntime(config: AppConfig, overrides: Partial<Pick<Runtime, 'mailer'>> = {}): Runtime {
  const db = createPool(config.databaseUrl, config.databasePoolMax);
  const redis = config.redisUrl
    ? new Redis(config.redisUrl, { maxRetriesPerRequest: 2, enableOfflineQueue: true, lazyConnect: false })
    : null;
  if (!redis && config.env !== 'test') {
    console.warn('[runtime] REDIS_URL tanımlı değil: hız sınırlama bellek içi, oturum önbelleği kapalı (yalnızca geliştirme).');
  }

  let mailer: Mailer;
  if (overrides.mailer) mailer = overrides.mailer;
  else if (config.mail.transport === 'smtp') mailer = new SmtpMailer(config.mail.smtpUrl!, config.mail.from);
  else if (config.mail.transport === 'memory') mailer = new MemoryMailer();
  else mailer = new ConsoleMailer();

  return {
    config,
    db,
    redis,
    limiter: redis ? new RedisRateLimiter(redis) : new MemoryRateLimiter(),
    cache: redis ? new RedisSessionCache(redis) : new NoopSessionCache(),
    mailer,
    hasher: new PasswordHasher(config.argon2),
    async close() {
      await mailer.close?.();
      await db.end();
      if (redis) await redis.quit().catch(() => redis.disconnect());
    },
  };
}
