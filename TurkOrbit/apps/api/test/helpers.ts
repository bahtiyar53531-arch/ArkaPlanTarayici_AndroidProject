/**
 * Test yardımcıları: GERÇEK PostgreSQL (turkorbit_test) ve GERÇEK Redis (db 15) kullanır.
 * Bağlantılar TEST_DATABASE_URL / TEST_REDIS_URL ile değiştirilebilir.
 */
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { buildApp, type BuiltApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { runMigrations } from '../src/db/migrate.js';
import { MemoryMailer } from '../src/lib/mailer.js';
import type { AuthLimits } from '../src/modules/auth/service.js';
import { createRuntime, type Runtime } from '../src/runtime.js';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://turkorbit:turkorbit_dev@127.0.0.1:5432/turkorbit_test';
export const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379/15';
export const WEB_ORIGIN = 'http://localhost:5173';

export interface TestContext extends BuiltApp {
  rt: Runtime;
  mailer: MemoryMailer;
  close(): Promise<void>;
}

export async function createTestContext(
  limits: Partial<AuthLimits> = {},
  /** app.ready() öncesi ek (yalnızca test) rotaları kaydetmek için. */
  setup?: (built: BuiltApp) => void,
  /** Yükseltme zarı gibi rastgeleliği testte belirlemek için. */
  extra: { rng?: (max: number) => number } = {},
): Promise<TestContext> {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    REDIS_URL: TEST_REDIS_URL,
    PUBLIC_WEB_URL: WEB_ORIGIN,
    ALLOWED_ORIGINS: `${WEB_ORIGIN},capacitor://localhost`,
    CSRF_SECRET: 'test-csrf-secret-that-is-at-least-32-chars',
    // Testlerde Argon2id aynı algoritma, daha düşük bellek maliyetiyle (hız için).
    ARGON2_MEMORY_KIB: '8192',
    ARGON2_TIME_COST: '2',
    MAIL_TRANSPORT: 'memory',
  });
  const mailer = new MemoryMailer();
  const rt = createRuntime(config, { mailer });
  await resetDatabase(rt);
  const built = await buildApp(rt, {
    limits: { registerPerIp: [1000, 3600], loginPerIp: [1000, 900], forgotPerIp: [1000, 3600], ...limits },
    ...(extra.rng ? { rng: extra.rng } : {}),
  });
  setup?.(built);
  await built.app.ready();
  return {
    ...built,
    rt,
    mailer,
    async close() {
      await built.app.close();
      await rt.close();
    },
  };
}

let schemaReady = false;

/** İlk çağrıda şemayı sıfırdan kurar; sonraki çağrılarda yalnızca verileri temizler. */
export async function resetDatabase(rt: Runtime) {
  if (!schemaReady) {
    await rt.db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await runMigrations(rt.db);
    schemaReady = true;
  } else {
    await rt.db.query(
      `TRUNCATE users, sessions, email_verification_tokens, password_reset_tokens, login_events,
         user_known_devices, user_roles, admin_audit_log RESTART IDENTITY CASCADE`,
    );
    // game_settings.updated_by → users FK'si nedeniyle TRUNCATE CASCADE ayarları da siler; varsayılanları geri yaz.
    await rt.db.query(
      `INSERT INTO game_settings (key, value) VALUES
         ('registration.enabled', 'true'::jsonb),
         ('terms.version', '"2026-11"'::jsonb),
         ('starter.currencies', '{"KREDI": 25000, "AKCE": 1000}'::jsonb),
         ('company.change', '{"cooldown_days": 30, "cost": {"currency": "AKCE", "amount": 2000}}'::jsonb),
         ('starter.kit', '{"items": [{"code": "laser.ok1", "quantity": 1}, {"code": "shield.siper1", "quantity": 1}, {"code": "speed.itki1", "quantity": 1}, {"code": "ammo.isk1", "quantity": 2000}, {"code": "rocket.yildirim", "quantity": 50}]}'::jsonb),
         ('repair', '{"currency": "KREDI", "per_1000_hp": 250}'::jsonb),
         ('inventory', '{"max_items": 300}'::jsonb),
         ('movement', '{"tolerance": 1.25, "slack": 300, "max_elapsed_seconds": 10}'::jsonb),
         ('portal', '{"jump_radius": 450}'::jsonb),
         ('combat', '{"respawn_hp_ratio": 0.1, "shield_regen_delay_ms": 4000, "shield_regen_ratio_per_sec": 0.08, "repair_delay_ms": 5000, "loot_owner_ms": 15000, "loot_ttl_ms": 60000, "loot_pickup_radius": 90, "pvp_honor": 100, "damage_variance": 0.1, "out_of_combat_ms": 5000}'::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    );
    await rt.db.query(`UPDATE game_servers SET is_open = true, is_maintenance = false`);
    await rt.db.query(`UPDATE maps SET is_closed = false`);
  }
  await rt.redis?.flushdb();
}

// ------------------------------------------------------------------ HTTP yardımcıları

export interface Client {
  cookie: string | null;
  csrf: string | null;
  bearer: string | null;
  ip: string;
  userAgent: string;
}

export function newClient(overrides: Partial<Client> = {}): Client {
  return {
    cookie: null,
    csrf: null,
    bearer: null,
    ip: '85.105.10.20',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
    ...overrides,
  };
}

export async function call(
  app: FastifyInstance,
  client: Client,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<LightMyRequestResponse> {
  const headers: Record<string, string> = {
    'user-agent': client.userAgent,
    origin: WEB_ORIGIN,
    ...extraHeaders,
  };
  if (client.cookie) headers.cookie = client.cookie;
  if (client.csrf && method !== 'GET') headers['x-csrf-token'] = client.csrf;
  if (client.bearer) headers.authorization = `Bearer ${client.bearer}`;
  const opts: InjectOptions = { method, url: `/api/v1${url}`, headers, remoteAddress: client.ip };
  if (body !== undefined) {
    opts.payload = JSON.stringify(body);
    headers['content-type'] = 'application/json';
  }
  const res = await app.inject(opts);
  const setCookie = res.headers['set-cookie'];
  for (const c of Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []) {
    const [pair] = c.split(';');
    if (!pair) continue;
    const [name, value] = pair.split('=');
    if (name === 'to_sid') client.cookie = value ? `to_sid=${value}` : null;
  }
  return res;
}

export const STRONG_PASSWORD = 'Nebula-Kartal-77';

export function tokenFromMail(mailer: MemoryMailer, to: string): string {
  const m = mailer.lastTo(to);
  if (!m) throw new Error(`${to} adresine e-posta gönderilmemiş`);
  const match = m.text.match(/token=([A-Za-z0-9_-]+)/);
  if (!match?.[1]) throw new Error('E-postada token bulunamadı');
  return match[1];
}

/** Kayıt + e-posta doğrulama + giriş yapılmış bir çerez istemcisi döner. */
export async function registerAndLogin(
  ctx: TestContext,
  username: string,
  opts: { verify?: boolean; client?: Client; password?: string } = {},
) {
  const client = opts.client ?? newClient();
  const email = `${username.toLowerCase()}@ornek.com`;
  const password = opts.password ?? STRONG_PASSWORD;
  const reg = await call(ctx.app, client, 'POST', '/auth/register', {
    username,
    email,
    password,
    acceptTerms: true,
  });
  if (reg.statusCode !== 201) throw new Error(`kayıt başarısız: ${reg.body}`);
  if (opts.verify !== false) {
    const token = tokenFromMail(ctx.mailer, email);
    const v = await call(ctx.app, client, 'POST', '/auth/verify-email', { token });
    if (v.statusCode !== 200) throw new Error(`doğrulama başarısız: ${v.body}`);
  }
  const login = await call(ctx.app, client, 'POST', '/auth/login', { identifier: username, password });
  if (login.statusCode !== 200) throw new Error(`giriş başarısız: ${login.body}`);
  client.csrf = login.json().csrfToken;
  return { client, email, password, login: login.json() };
}
