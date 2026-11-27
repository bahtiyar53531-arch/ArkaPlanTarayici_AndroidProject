import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL gerekli'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(200).default(20),
  REDIS_URL: z.string().optional(),

  /** E-postalardaki bağlantıların açılacağı istemci adresi. */
  PUBLIC_WEB_URL: z.string().url().default('http://localhost:5173'),
  /** Virgülle ayrılmış izinli Origin listesi. Mobil uygulamalar: capacitor://localhost, https://localhost */
  ALLOWED_ORIGINS: z.string().optional(),
  /** Ters vekil (nginx) arkasında gerçek istemci IP'si için. ör. "127.0.0.1" veya "loopback" */
  TRUST_PROXY: z.string().optional(),

  SESSION_COOKIE_NAME: z.string().optional(),
  COOKIE_SECURE: bool.optional(),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  SESSION_IDLE_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  CSRF_SECRET: z.string().min(32, 'CSRF_SECRET en az 32 karakter olmalı').optional(),

  ARGON2_MEMORY_KIB: z.coerce.number().int().min(8192).default(65536),
  ARGON2_TIME_COST: z.coerce.number().int().min(2).default(3),
  ARGON2_PARALLELISM: z.coerce.number().int().min(1).max(8).default(1),

  MAIL_TRANSPORT: z.enum(['smtp', 'console', 'memory']).optional(),
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('"Türk Orbit" <no-reply@turkorbit.com>'),
});

export interface AppConfig {
  env: 'development' | 'test' | 'production';
  host: string;
  port: number;
  logLevel: string;
  databaseUrl: string;
  databasePoolMax: number;
  redisUrl: string | undefined;
  publicWebUrl: string;
  allowedOrigins: string[];
  trustProxy: boolean | string;
  session: {
    cookieName: string;
    cookieSecure: boolean;
    ttlSeconds: number;
    idleSeconds: number;
    /** last_seen_at bu süreden eskiyse güncellenir (her istekte yazmayı önler). */
    touchIntervalSeconds: number;
  };
  csrfSecret: string;
  argon2: { memoryCost: number; timeCost: number; parallelism: number };
  mail: { transport: 'smtp' | 'console' | 'memory'; smtpUrl: string | undefined; from: string };
}

const DEV_CSRF_SECRET = 'turkorbit-dev-only-csrf-secret-change-me-0000';

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  // .env dosyasında boş bırakılan değerler (ör. "CSRF_SECRET=") tanımsız sayılır.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v.trim() !== ''));
  const parsed = EnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Geçersiz ortam değişkenleri:\n${lines.join('\n')}`);
  }
  const e = parsed.data;
  const production = e.NODE_ENV === 'production';

  if (production) {
    const missing: string[] = [];
    if (!e.REDIS_URL) missing.push('REDIS_URL');
    if (!e.CSRF_SECRET) missing.push('CSRF_SECRET');
    if (!e.ALLOWED_ORIGINS) missing.push('ALLOWED_ORIGINS');
    if ((e.MAIL_TRANSPORT ?? 'smtp') === 'smtp' && !e.SMTP_URL) missing.push('SMTP_URL');
    if (missing.length) {
      throw new Error(`Üretim ortamında zorunlu değişkenler eksik: ${missing.join(', ')}`);
    }
    if (e.MAIL_TRANSPORT && e.MAIL_TRANSPORT !== 'smtp') {
      throw new Error('Üretim ortamında MAIL_TRANSPORT yalnızca "smtp" olabilir.');
    }
  }

  const cookieSecure = e.COOKIE_SECURE ?? production;
  const allowedOrigins = (e.ALLOWED_ORIGINS ?? e.PUBLIC_WEB_URL)
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);

  let trustProxy: boolean | string = false;
  if (e.TRUST_PROXY === 'true') trustProxy = true;
  else if (e.TRUST_PROXY && e.TRUST_PROXY !== 'false') trustProxy = e.TRUST_PROXY;

  return {
    env: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    logLevel: e.NODE_ENV === 'test' ? 'silent' : e.LOG_LEVEL,
    databaseUrl: e.DATABASE_URL,
    databasePoolMax: e.DATABASE_POOL_MAX,
    redisUrl: e.REDIS_URL || undefined,
    publicWebUrl: e.PUBLIC_WEB_URL.replace(/\/$/, ''),
    allowedOrigins,
    trustProxy,
    session: {
      // __Host- öneki: yalnızca HTTPS, Domain yok, Path=/ — alt alan adlarından çerez enjeksiyonunu engeller.
      cookieName: e.SESSION_COOKIE_NAME ?? (cookieSecure ? '__Host-to_sid' : 'to_sid'),
      cookieSecure,
      ttlSeconds: e.SESSION_TTL_DAYS * 86400,
      idleSeconds: e.SESSION_IDLE_DAYS * 86400,
      touchIntervalSeconds: 300,
    },
    csrfSecret: e.CSRF_SECRET ?? DEV_CSRF_SECRET,
    argon2: {
      memoryCost: e.ARGON2_MEMORY_KIB,
      timeCost: e.ARGON2_TIME_COST,
      parallelism: e.ARGON2_PARALLELISM,
    },
    mail: {
      transport: e.MAIL_TRANSPORT ?? (e.SMTP_URL ? 'smtp' : production ? 'smtp' : 'console'),
      smtpUrl: e.SMTP_URL,
      from: e.MAIL_FROM,
    },
  };
}
