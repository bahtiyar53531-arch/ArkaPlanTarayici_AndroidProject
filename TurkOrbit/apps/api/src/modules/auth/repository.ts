import type { PermissionKey, RoleKey } from '@turkorbit/shared';
import type { Queryable } from '../../db/pool.js';

export interface UserRow {
  id: string;
  public_id: string; // bigint → pg string döner
  username: string;
  email: string;
  email_verified_at: Date | null;
  password_hash: string;
  status: 'active' | 'suspended' | 'banned' | 'deleted';
  suspended_until: Date | null;
  status_reason: string | null;
  locked_until: Date | null;
  locale: string;
  created_at: Date;
}

export interface SessionRow {
  id: string;
  user_id: string;
  transport: 'cookie' | 'token';
  platform: string;
  device_name: string | null;
  browser: string | null;
  os: string | null;
  ip: string | null;
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
}

const USER_COLUMNS = `id, public_id, username::text AS username, email::text AS email, email_verified_at,
  password_hash, status, suspended_until, status_reason, locked_until, locale, created_at`;

const SESSION_COLUMNS = `id, user_id, transport, platform, device_name, browser, os, host(ip) AS ip,
  created_at, last_seen_at, expires_at, revoked_at`;

// ------------------------------------------------------------------ users
export async function findUserById(db: Queryable, id: string): Promise<UserRow | null> {
  const { rows } = await db.query<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function findUserByIdentifier(db: Queryable, identifier: string): Promise<UserRow | null> {
  const { rows } = await db.query<UserRow>(
    `SELECT ${USER_COLUMNS} FROM users WHERE username = $1 OR email = $1 LIMIT 1`,
    [identifier],
  );
  return rows[0] ?? null;
}

export async function findUserByEmail(db: Queryable, email: string): Promise<UserRow | null> {
  const { rows } = await db.query<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE email = $1`, [email]);
  return rows[0] ?? null;
}

export async function usernameExists(db: Queryable, username: string): Promise<boolean> {
  const { rowCount } = await db.query('SELECT 1 FROM users WHERE username = $1', [username]);
  return (rowCount ?? 0) > 0;
}

export async function insertUser(
  db: Queryable,
  u: { username: string; email: string; passwordHash: string; locale: string; termsVersion: string },
): Promise<UserRow> {
  const { rows } = await db.query<UserRow>(
    `INSERT INTO users (username, email, password_hash, locale, terms_accepted_at, terms_version)
     VALUES ($1, $2, $3, $4, now(), $5)
     RETURNING ${USER_COLUMNS}`,
    [u.username, u.email, u.passwordHash, u.locale, u.termsVersion],
  );
  return rows[0]!;
}

export async function updatePasswordHash(db: Queryable, userId: string, hash: string, changed: boolean) {
  await db.query(
    `UPDATE users SET password_hash = $2,
       password_changed_at = CASE WHEN $3 THEN now() ELSE password_changed_at END
     WHERE id = $1`,
    [userId, hash, changed],
  );
}

export async function markEmailVerified(db: Queryable, userId: string) {
  await db.query('UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1', [
    userId,
  ]);
}

export async function reactivateExpiredSuspension(db: Queryable, userId: string) {
  await db.query(
    `UPDATE users SET status = 'active', suspended_until = NULL, status_reason = NULL
     WHERE id = $1 AND status = 'suspended' AND suspended_until <= now()`,
    [userId],
  );
}

// ------------------------------------------------------------------ roles / permissions
export async function getUserRoles(db: Queryable, userId: string): Promise<RoleKey[]> {
  const { rows } = await db.query<{ role_key: RoleKey }>(
    `SELECT ur.role_key FROM user_roles ur JOIN roles r ON r.key = ur.role_key
     WHERE ur.user_id = $1 ORDER BY r.rank DESC`,
    [userId],
  );
  return rows.map((r) => r.role_key);
}

export async function getUserPermissions(db: Queryable, userId: string): Promise<PermissionKey[]> {
  const { rows } = await db.query<{ permission_key: PermissionKey }>(
    `SELECT DISTINCT rp.permission_key FROM user_roles ur
     JOIN role_permissions rp ON rp.role_key = ur.role_key
     WHERE ur.user_id = $1 ORDER BY 1`,
    [userId],
  );
  return rows.map((r) => r.permission_key);
}

export async function userHasPermission(db: Queryable, userId: string, permission: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `SELECT 1 FROM user_roles ur JOIN role_permissions rp ON rp.role_key = ur.role_key
     WHERE ur.user_id = $1 AND rp.permission_key = $2 LIMIT 1`,
    [userId, permission],
  );
  return (rowCount ?? 0) > 0;
}

// ------------------------------------------------------------------ settings
export async function getSetting<T>(db: Queryable, key: string): Promise<T | undefined> {
  const { rows } = await db.query<{ value: T }>('SELECT value FROM game_settings WHERE key = $1', [key]);
  return rows[0]?.value;
}

// ------------------------------------------------------------------ sessions
export async function insertSession(
  db: Queryable,
  s: {
    userId: string;
    tokenHash: Buffer;
    transport: 'cookie' | 'token';
    platform: string;
    deviceName: string | null;
    appVersion: string | null;
    userAgent: string | null;
    browser: string | null;
    os: string | null;
    ip: string | null;
    ttlSeconds: number;
  },
): Promise<SessionRow> {
  const { rows } = await db.query<SessionRow>(
    `INSERT INTO sessions (user_id, token_hash, transport, platform, device_name, app_version, user_agent,
       browser, os, ip, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now() + make_interval(secs => $11))
     RETURNING ${SESSION_COLUMNS}`,
    [
      s.userId,
      s.tokenHash,
      s.transport,
      s.platform,
      s.deviceName,
      s.appVersion,
      s.userAgent?.slice(0, 512) ?? null,
      s.browser,
      s.os,
      s.ip,
      s.ttlSeconds,
    ],
  );
  return rows[0]!;
}

export interface SessionWithUser {
  session: SessionRow;
  user: UserRow;
}

export async function findSessionByTokenHash(db: Queryable, tokenHash: Buffer): Promise<SessionWithUser | null> {
  const { rows } = await db.query<SessionRow & { u: UserRow }>(
    `SELECT s.id, s.user_id, s.transport, s.platform, s.device_name, s.browser, s.os, host(s.ip) AS ip,
            s.created_at, s.last_seen_at, s.expires_at, s.revoked_at,
            json_build_object(
              'id', u.id, 'public_id', u.public_id::text, 'username', u.username::text, 'email', u.email::text,
              'email_verified_at', u.email_verified_at, 'password_hash', '', 'status', u.status,
              'suspended_until', u.suspended_until, 'status_reason', u.status_reason,
              'locked_until', u.locked_until, 'locale', u.locale, 'created_at', u.created_at
            ) AS u
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1`,
    [tokenHash],
  );
  const row = rows[0];
  if (!row) return null;
  const { u, ...session } = row;
  return { session, user: reviveUserDates(u) };
}

function reviveUserDates(u: UserRow): UserRow {
  const d = (v: Date | string | null) => (v == null ? null : new Date(v));
  return {
    ...u,
    email_verified_at: d(u.email_verified_at),
    suspended_until: d(u.suspended_until),
    locked_until: d(u.locked_until),
    created_at: new Date(u.created_at),
  };
}

export async function touchSession(db: Queryable, sessionId: string) {
  await db.query('UPDATE sessions SET last_seen_at = now() WHERE id = $1 AND revoked_at IS NULL', [sessionId]);
}

/** İptal edilen oturumların token_hash değerlerini döner (önbellekten silmek için). */
export async function revokeSessions(
  db: Queryable,
  where: { userId: string; sessionId?: string; exceptSessionId?: string },
  reason: string,
): Promise<Buffer[]> {
  const params: unknown[] = [where.userId, reason];
  let cond = 'user_id = $1 AND revoked_at IS NULL';
  if (where.sessionId) {
    params.push(where.sessionId);
    cond += ` AND id = $${params.length}`;
  }
  if (where.exceptSessionId) {
    params.push(where.exceptSessionId);
    cond += ` AND id <> $${params.length}`;
  }
  const { rows } = await db.query<{ token_hash: Buffer }>(
    `UPDATE sessions SET revoked_at = now(), revoked_reason = $2 WHERE ${cond} RETURNING token_hash`,
    params,
  );
  return rows.map((r) => r.token_hash);
}

export async function listActiveSessions(db: Queryable, userId: string): Promise<SessionRow[]> {
  const { rows } = await db.query<SessionRow>(
    `SELECT ${SESSION_COLUMNS} FROM sessions
     WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
     ORDER BY last_seen_at DESC LIMIT 100`,
    [userId],
  );
  return rows;
}

// ------------------------------------------------------------------ one-time tokens
export async function insertEmailVerificationToken(
  db: Queryable,
  userId: string,
  email: string,
  tokenHash: Buffer,
  ttlSeconds: number,
) {
  // Önceki kullanılmamış bağlantılar geçersiz olur: her zaman yalnızca son gönderilen bağlantı çalışır.
  await db.query(
    'UPDATE email_verification_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL',
    [userId],
  );
  await db.query(
    `INSERT INTO email_verification_tokens (user_id, email, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(secs => $4))`,
    [userId, email, tokenHash, ttlSeconds],
  );
}

export interface OneTimeTokenRow {
  id: string;
  user_id: string;
  email?: string;
  expires_at: Date;
  used_at: Date | null;
}

/** Satırı kilitleyerek okur (aynı bağlantının iki kez kullanılmasını önler). */
export async function findEmailVerificationToken(db: Queryable, tokenHash: Buffer) {
  const { rows } = await db.query<OneTimeTokenRow>(
    `SELECT id, user_id, email::text AS email, expires_at, used_at FROM email_verification_tokens
     WHERE token_hash = $1 FOR UPDATE`,
    [tokenHash],
  );
  return rows[0] ?? null;
}

export async function markEmailVerificationTokenUsed(db: Queryable, id: string) {
  await db.query('UPDATE email_verification_tokens SET used_at = now() WHERE id = $1', [id]);
}

export async function insertPasswordResetToken(
  db: Queryable,
  userId: string,
  tokenHash: Buffer,
  ttlSeconds: number,
  ip: string | null,
) {
  await db.query('UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [
    userId,
  ]);
  await db.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, requested_ip)
     VALUES ($1, $2, now() + make_interval(secs => $3), $4)`,
    [userId, tokenHash, ttlSeconds, ip],
  );
}

export async function findPasswordResetToken(db: Queryable, tokenHash: Buffer) {
  const { rows } = await db.query<OneTimeTokenRow>(
    `SELECT id, user_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = $1 FOR UPDATE`,
    [tokenHash],
  );
  return rows[0] ?? null;
}

export async function consumeAllPasswordResetTokens(db: Queryable, userId: string) {
  await db.query('UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [
    userId,
  ]);
}

// ------------------------------------------------------------------ login history & devices
export async function insertLoginEvent(
  db: Queryable,
  e: {
    userId: string | null;
    identifier: string;
    success: boolean;
    failureReason: string | null;
    ip: string | null;
    userAgent: string | null;
    platform: string;
    browser: string | null;
    os: string | null;
    suspicious?: boolean;
    suspiciousReasons?: string[];
    sessionId?: string | null;
  },
) {
  await db.query(
    `INSERT INTO login_events (user_id, identifier, success, failure_reason, ip, user_agent, platform,
       browser, os, suspicious, suspicious_reasons, session_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      e.userId,
      e.identifier.slice(0, 254),
      e.success,
      e.failureReason,
      e.ip,
      e.userAgent?.slice(0, 512) ?? null,
      e.platform,
      e.browser,
      e.os,
      e.suspicious ?? false,
      e.suspiciousReasons ?? [],
      e.sessionId ?? null,
    ],
  );
}

export interface LoginEventRow {
  id: string;
  success: boolean;
  failure_reason: string | null;
  platform: string;
  browser: string | null;
  os: string | null;
  ip: string | null;
  suspicious: boolean;
  suspicious_reasons: string[];
  created_at: Date;
}

export async function listLoginEvents(db: Queryable, userId: string, limit = 50): Promise<LoginEventRow[]> {
  const { rows } = await db.query<LoginEventRow>(
    `SELECT id::text, success, failure_reason, platform, browser, os, host(ip) AS ip, suspicious,
            suspicious_reasons, created_at
     FROM login_events WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`,
    [userId, limit],
  );
  return rows;
}

export interface LoginSignals {
  priorSuccessCount: number;
  knownDevice: boolean;
  knownNetwork: boolean;
  recentFailures: number;
}

/** Şüpheli giriş tespiti için geçmiş sinyalleri tek sorguda toplar. */
export async function getLoginSignals(
  db: Queryable,
  userId: string,
  fingerprint: Buffer,
  ip: string | null,
): Promise<LoginSignals> {
  const { rows } = await db.query<{
    prior: string;
    known_device: boolean;
    known_network: boolean;
    recent_failures: string;
  }>(
    `SELECT
       (SELECT count(*) FROM login_events WHERE user_id = $1 AND success) AS prior,
       EXISTS (SELECT 1 FROM user_known_devices WHERE user_id = $1 AND fingerprint = $2) AS known_device,
       CASE WHEN $3::inet IS NULL THEN true ELSE EXISTS (
         SELECT 1 FROM login_events
         WHERE user_id = $1 AND success AND ip IS NOT NULL AND family(ip) = family($3::inet)
           AND network(set_masklen(ip, CASE WHEN family(ip) = 4 THEN 24 ELSE 48 END))
             = network(set_masklen($3::inet, CASE WHEN family($3::inet) = 4 THEN 24 ELSE 48 END))
       ) END AS known_network,
       (SELECT count(*) FROM login_events
         WHERE user_id = $1 AND NOT success AND created_at > now() - interval '1 hour') AS recent_failures`,
    [userId, fingerprint, ip],
  );
  const r = rows[0]!;
  return {
    priorSuccessCount: Number(r.prior),
    knownDevice: r.known_device,
    knownNetwork: r.known_network,
    recentFailures: Number(r.recent_failures),
  };
}

export async function upsertKnownDevice(
  db: Queryable,
  userId: string,
  fingerprint: Buffer,
  label: string,
  ip: string | null,
) {
  await db.query(
    `INSERT INTO user_known_devices (user_id, fingerprint, label, last_ip)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, fingerprint)
     DO UPDATE SET last_seen_at = now(), last_ip = EXCLUDED.last_ip, label = EXCLUDED.label`,
    [userId, fingerprint, label, ip],
  );
}

// ------------------------------------------------------------------ bakım
/** Süresi geçmiş tek kullanımlık anahtarları ve 90 günden eski kapanmış oturumları temizler. */
export async function purgeExpired(db: Queryable) {
  await db.query(`DELETE FROM email_verification_tokens WHERE expires_at < now() - interval '7 days'`);
  await db.query(`DELETE FROM password_reset_tokens WHERE expires_at < now() - interval '7 days'`);
  await db.query(
    `DELETE FROM sessions WHERE (revoked_at IS NOT NULL OR expires_at < now())
       AND COALESCE(revoked_at, expires_at) < now() - interval '90 days'`,
  );
}
