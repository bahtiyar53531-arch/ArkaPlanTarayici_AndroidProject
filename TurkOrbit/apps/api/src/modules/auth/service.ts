import {
  changePasswordSchema,
  checkPassword,
  forgotPasswordSchema,
  loginSchema,
  PLATFORM_LABELS_TR,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  type ClientPlatform,
  type LoginHistoryEntry,
  type PermissionKey,
  type PublicUser,
  type RoleKey,
  type SessionInfo,
} from '@turkorbit/shared';
import type { AppConfig } from '../../config/env.js';
import { uniqueViolation, withTransaction, type Db } from '../../db/pool.js';
import { maskIp, normalizePlatform, parseUserAgent, safeIp } from '../../lib/client-info.js';
import { hmacBase64Url, randomToken, safeEqual, sha256 } from '../../lib/crypto.js';
import { AppError, Errors } from '../../lib/errors.js';
import type { Mailer, MailMessage } from '../../lib/mailer.js';
import type { PasswordHasher } from '../../lib/password.js';
import type { RateLimiter } from '../../lib/rate-limit.js';
import * as emails from './emails.js';
import * as repo from './repository.js';
import type { SessionCache } from './session-cache.js';

export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
  /** X-Client-Platform başlığından gelen platform ipucu. */
  platformHint: ClientPlatform;
}

export interface AuthenticatedContext {
  session: repo.SessionRow;
  user: repo.UserRow;
}

export interface Logger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

/** Hız sınırları: { limit, pencere(sn) }. Testlerde ve yönetim panelinden (Aşama 14) ayarlanabilir. */
export interface AuthLimits {
  loginPerIp: [number, number];
  loginFailuresPerAccount: [number, number];
  registerPerIp: [number, number];
  forgotPerIp: [number, number];
  forgotPerEmail: [number, number];
  resendVerificationPerUser: [number, number];
  changePasswordPerUser: [number, number];
}

export const DEFAULT_LIMITS: AuthLimits = {
  loginPerIp: [30, 15 * 60],
  loginFailuresPerAccount: [5, 15 * 60],
  registerPerIp: [5, 60 * 60],
  forgotPerIp: [10, 60 * 60],
  forgotPerEmail: [3, 60 * 60],
  resendVerificationPerUser: [3, 60 * 60],
  changePasswordPerUser: [5, 15 * 60],
};

const EMAIL_VERIFICATION_TTL = 24 * 60 * 60;
const PASSWORD_RESET_TTL = 30 * 60;
const SESSION_CACHE_TTL = 30;

export interface AuthServiceDeps {
  db: Db;
  config: AppConfig;
  hasher: PasswordHasher;
  mailer: Mailer;
  limiter: RateLimiter;
  cache: SessionCache;
  log: Logger;
  limits?: Partial<AuthLimits>;
}

export class AuthService {
  private readonly limits: AuthLimits;

  constructor(private readonly d: AuthServiceDeps) {
    this.limits = { ...DEFAULT_LIMITS, ...d.limits };
  }

  // ================================================================== Kayıt
  async register(input: unknown, ctx: RequestContext): Promise<{ status: 'pending_verification' }> {
    await this.enforce(`register:ip:${ctx.ip ?? 'unknown'}`, this.limits.registerPerIp);

    const enabled = await repo.getSetting<boolean>(this.d.db, 'registration.enabled');
    if (enabled === false) {
      throw new AppError('REGISTRATION_CLOSED', 403, 'Yeni kayıtlar şu anda geçici olarak kapalı.');
    }

    const data = registerSchema.parse(input);
    const policy = checkPassword(data.password, { username: data.username, email: data.email });
    if (!policy.ok) {
      throw new AppError('WEAK_PASSWORD', 400, 'Parola güvenlik kurallarını karşılamıyor.', {
        fields: { password: policy.problems },
      });
    }
    if (await repo.usernameExists(this.d.db, data.username)) throw usernameTaken();

    // Özet her iki yolda da hesaplanır: e-postanın kayıtlı olup olmadığı yanıt süresinden anlaşılmasın.
    const passwordHash = await this.d.hasher.hash(data.password);
    const generic = { status: 'pending_verification' as const };

    const existing = await repo.findUserByEmail(this.d.db, data.email);
    if (existing) {
      await this.notifyAlreadyRegistered(data.email);
      return generic;
    }

    const termsVersion = (await repo.getSetting<string>(this.d.db, 'terms.version')) ?? 'bilinmiyor';
    const token = randomToken();
    let user: repo.UserRow;
    try {
      user = await withTransaction(this.d.db, async (c) => {
        const u = await repo.insertUser(c, {
          username: data.username,
          email: data.email,
          passwordHash,
          locale: data.locale,
          termsVersion,
        });
        await repo.insertEmailVerificationToken(c, u.id, u.email, sha256(token), EMAIL_VERIFICATION_TTL);
        return u;
      });
    } catch (err) {
      const constraint = uniqueViolation(err);
      if (constraint === 'users_username_key') throw usernameTaken();
      if (constraint === 'users_email_key') {
        await this.notifyAlreadyRegistered(data.email);
        return generic;
      }
      throw err;
    }

    this.d.log.info({ userId: user.id, platform: ctx.platformHint }, 'yeni hesap oluşturuldu');
    this.sendInBackground(
      emails.verificationEmail(user.email, user.username, this.webUrl('/eposta-dogrula', token)),
    );
    return generic;
  }

  private async notifyAlreadyRegistered(email: string) {
    const rl = await this.d.limiter.hit(`register:dup-mail:${email}`, 1, 60 * 60);
    if (!rl.allowed) return;
    this.sendInBackground(
      emails.alreadyRegisteredEmail(email, this.webUrl('/giris'), this.webUrl('/sifremi-unuttum')),
    );
  }

  // ================================================================== E-posta doğrulama
  async verifyEmail(input: unknown): Promise<{ username: string }> {
    const { token } = verifyEmailSchema.parse(input);
    return withTransaction(this.d.db, async (c) => {
      const row = await repo.findEmailVerificationToken(c, sha256(token));
      if (!row || row.used_at) throw Errors.invalidToken();
      if (row.expires_at.getTime() <= Date.now()) throw Errors.tokenExpired();
      const user = await repo.findUserById(c, row.user_id);
      // Bağlantı gönderildikten sonra e-posta değiştiyse eski bağlantı geçersizdir.
      if (!user || user.status === 'deleted' || user.email.toLowerCase() !== row.email?.toLowerCase()) {
        throw Errors.invalidToken();
      }
      await repo.markEmailVerificationTokenUsed(c, row.id);
      await repo.markEmailVerified(c, user.id);
      return { username: user.username };
    });
  }

  async resendVerification(auth: AuthenticatedContext): Promise<{ alreadyVerified: boolean }> {
    if (auth.user.email_verified_at) return { alreadyVerified: true };
    await this.enforce(`verify-resend:user:${auth.user.id}`, this.limits.resendVerificationPerUser);
    const token = randomToken();
    await withTransaction(this.d.db, (c) =>
      repo.insertEmailVerificationToken(c, auth.user.id, auth.user.email, sha256(token), EMAIL_VERIFICATION_TTL),
    );
    await this.safeSend(
      emails.verificationEmail(auth.user.email, auth.user.username, this.webUrl('/eposta-dogrula', token)),
    );
    return { alreadyVerified: false };
  }

  // ================================================================== Giriş
  async login(input: unknown, ctx: RequestContext) {
    const data = loginSchema.parse(input);
    const identifier = data.identifier.toLowerCase();
    const ua = parseUserAgent(ctx.userAgent);
    const platform: ClientPlatform =
      data.device?.platform && data.device.platform !== 'unknown'
        ? data.device.platform
        : ctx.platformHint !== 'unknown'
          ? ctx.platformHint
          : data.transport === 'cookie'
            ? 'web'
            : 'unknown';
    const baseEvent = {
      identifier,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      platform,
      browser: ua.browser,
      os: ua.os,
    };

    await this.enforce(`login:ip:${ctx.ip ?? 'unknown'}`, this.limits.loginPerIp);

    const user = await repo.findUserByIdentifier(this.d.db, identifier);
    // Var olan ve olmayan hesaplar aynı şekilde sınırlandırılır (hesap varlığı sızmasın).
    const failKey = user ? `login:fail:user:${user.id}` : `login:fail:id:${identifier}`;
    const [failLimit, failWindow] = this.limits.loginFailuresPerAccount;
    const lock = await this.d.limiter.peek(failKey, failLimit);
    if (!lock.allowed) {
      await repo.insertLoginEvent(this.d.db, {
        ...baseEvent,
        userId: user?.id ?? null,
        success: false,
        failureReason: 'locked_out',
      });
      throw lockedOut(lock.retryAfterSeconds);
    }

    const passwordOk = user
      ? await this.d.hasher.verify(user.password_hash, data.password)
      : await this.d.hasher.verifyDummy(data.password);

    if (!user || !passwordOk || user.status === 'deleted') {
      const f = await this.d.limiter.hit(failKey, failLimit, failWindow);
      await repo.insertLoginEvent(this.d.db, {
        ...baseEvent,
        userId: user?.id ?? null,
        success: false,
        failureReason: !user ? 'unknown_account' : user.status === 'deleted' ? 'account_deleted' : 'wrong_password',
      });
      if (user && user.status !== 'deleted' && f.count === failLimit) {
        this.sendInBackground(
          emails.lockoutEmail(user.email, user.username, Math.ceil(failWindow / 60), this.webUrl('/sifremi-unuttum')),
        );
      }
      throw Errors.invalidCredentials();
    }

    // Parola doğru: hesap durumu kontrolleri (bu bilgiler yalnızca parolayı bilen kişiye gösterilir).
    const statusError = this.statusError(user);
    if (statusError === 'reactivate') {
      await repo.reactivateExpiredSuspension(this.d.db, user.id);
      user.status = 'active';
    } else if (statusError) {
      await repo.insertLoginEvent(this.d.db, {
        ...baseEvent,
        userId: user.id,
        success: false,
        failureReason: statusError.code.toLowerCase(),
      });
      throw statusError;
    }

    if (this.d.hasher.needsRehash(user.password_hash)) {
      await repo.updatePasswordHash(this.d.db, user.id, await this.d.hasher.hash(data.password), false);
    }

    // Şüpheli giriş tespiti
    const fingerprint = sha256(`${platform}|${ua.browser ?? '-'}|${ua.os ?? '-'}`);
    const signals = await repo.getLoginSignals(this.d.db, user.id, fingerprint, ctx.ip);
    const reasons: string[] = [];
    if (!signals.knownDevice) reasons.push('new_device');
    if (!signals.knownNetwork) reasons.push('new_network');
    if (signals.recentFailures >= 3) reasons.push('recent_failed_attempts');
    const suspicious =
      signals.priorSuccessCount > 0 &&
      ((reasons.includes('new_device') && reasons.includes('new_network')) ||
        reasons.includes('recent_failed_attempts'));

    const token = randomToken(32);
    const session = await withTransaction(this.d.db, async (c) => {
      const s = await repo.insertSession(c, {
        userId: user.id,
        tokenHash: sha256(token),
        transport: data.transport,
        platform,
        deviceName: data.device?.name ?? null,
        appVersion: data.device?.appVersion ?? null,
        userAgent: ctx.userAgent,
        browser: ua.browser,
        os: ua.os,
        ip: ctx.ip,
        ttlSeconds: this.d.config.session.ttlSeconds,
      });
      await repo.upsertKnownDevice(c, user.id, fingerprint, deviceLabel(platform, ua.browser, ua.os), ctx.ip);
      await repo.insertLoginEvent(c, {
        ...baseEvent,
        userId: user.id,
        success: true,
        failureReason: null,
        suspicious,
        suspiciousReasons: suspicious ? reasons : [],
        sessionId: s.id,
      });
      return s;
    });
    await this.d.limiter.reset(failKey);

    if (suspicious) {
      this.d.log.warn({ userId: user.id, reasons }, 'şüpheli giriş');
      this.sendInBackground(
        emails.suspiciousLoginEmail(
          user.email,
          user.username,
          { when: new Date(), device: deviceLabel(platform, ua.browser, ua.os), ipMasked: maskIp(ctx.ip), reasons },
          this.webUrl('/hesap/guvenlik'),
        ),
      );
    }

    const me = await this.me({ session, user });
    return { ...me, sessionToken: token, transport: data.transport, suspicious };
  }

  /** Hesap durumu nedeniyle giriş/oturum engelleniyorsa ilgili hatayı döner. */
  private statusError(user: repo.UserRow): AppError | 'reactivate' | null {
    const now = Date.now();
    if (user.status === 'banned') {
      return new AppError(
        'ACCOUNT_BANNED',
        403,
        `Hesabın kalıcı olarak yasaklandı.${user.status_reason ? ` Gerekçe: ${user.status_reason}` : ''} İtiraz için destek ekibine yazabilirsin.`,
      );
    }
    if (user.status === 'suspended') {
      if (user.suspended_until && user.suspended_until.getTime() > now) {
        const until = user.suspended_until.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
        return new AppError(
          'ACCOUNT_SUSPENDED',
          403,
          `Hesabın ${until} (TSİ) tarihine kadar askıya alındı.${user.status_reason ? ` Gerekçe: ${user.status_reason}` : ''}`,
        );
      }
      return 'reactivate';
    }
    if (user.locked_until && user.locked_until.getTime() > now) {
      return new AppError(
        'ACCOUNT_LOCKED',
        403,
        'Hesabın güvenlik nedeniyle geçici olarak kilitlendi. Destek ekibiyle iletişime geç.',
      );
    }
    return null;
  }

  // ================================================================== Oturum doğrulama
  async authenticate(token: string, transport: 'cookie' | 'token'): Promise<AuthenticatedContext | null> {
    if (!token || token.length > 128) return null;
    const hash = sha256(token);
    let found = await this.d.cache.get(hash).catch(() => null);
    if (!found) {
      found = await repo.findSessionByTokenHash(this.d.db, hash);
      if (found && !found.session.revoked_at) {
        await this.d.cache.set(hash, found, SESSION_CACHE_TTL).catch(() => undefined);
      }
    }
    if (!found) return null;
    const { session, user } = found;
    const now = Date.now();

    if (session.revoked_at) return null;
    // Çerezle gelen anahtar yalnızca çerez oturumunda, Bearer ile gelen yalnızca uygulama oturumunda geçerlidir.
    if (session.transport !== transport) return null;
    if (session.expires_at.getTime() <= now) return null;
    if (session.last_seen_at.getTime() + this.d.config.session.idleSeconds * 1000 <= now) {
      await this.revokeByHash(user.id, session.id, 'idle_timeout');
      return null;
    }
    if (user.status === 'banned' || user.status === 'deleted') {
      await this.revokeByHash(user.id, session.id, `account_${user.status}`);
      return null;
    }
    const st = this.statusError(user);
    if (st && st !== 'reactivate') return null;

    if (now - session.last_seen_at.getTime() > this.d.config.session.touchIntervalSeconds * 1000) {
      await repo.touchSession(this.d.db, session.id);
      session.last_seen_at = new Date(now);
      await this.d.cache.del([hash]).catch(() => undefined);
    }
    return { session, user };
  }

  csrfTokenFor(session: repo.SessionRow): string | null {
    if (session.transport !== 'cookie') return null;
    return hmacBase64Url(this.d.config.csrfSecret, `csrf:${session.id}`);
  }

  verifyCsrf(session: repo.SessionRow, provided: string | undefined): boolean {
    const expected = this.csrfTokenFor(session);
    return !!expected && typeof provided === 'string' && safeEqual(expected, provided);
  }

  async me(auth: AuthenticatedContext) {
    const [roles, permissions] = await Promise.all([
      repo.getUserRoles(this.d.db, auth.user.id),
      repo.getUserPermissions(this.d.db, auth.user.id),
    ]);
    return {
      user: toPublicUser(auth.user, roles),
      permissions,
      csrfToken: this.csrfTokenFor(auth.session),
      session: {
        id: auth.session.id,
        platform: normalizePlatform(auth.session.platform),
        expiresAt: auth.session.expires_at.toISOString(),
      },
    };
  }

  async hasPermission(auth: AuthenticatedContext, permission: PermissionKey): Promise<boolean> {
    return repo.userHasPermission(this.d.db, auth.user.id, permission);
  }

  async logout(auth: AuthenticatedContext): Promise<void> {
    await this.revokeByHash(auth.user.id, auth.session.id, 'logout');
  }

  private async revokeByHash(userId: string, sessionId: string, reason: string) {
    const hashes = await repo.revokeSessions(this.d.db, { userId, sessionId }, reason);
    await this.d.cache.del(hashes).catch(() => undefined);
  }

  // ================================================================== Oturum yönetimi
  async listSessions(auth: AuthenticatedContext): Promise<SessionInfo[]> {
    const rows = await repo.listActiveSessions(this.d.db, auth.user.id);
    return rows.map((s) => ({
      id: s.id,
      platform: normalizePlatform(s.platform),
      deviceName: s.device_name,
      browser: s.browser,
      os: s.os,
      ipMasked: maskIp(s.ip),
      createdAt: s.created_at.toISOString(),
      lastSeenAt: s.last_seen_at.toISOString(),
      expiresAt: s.expires_at.toISOString(),
      current: s.id === auth.session.id,
    }));
  }

  async revokeSession(auth: AuthenticatedContext, sessionId: string): Promise<{ current: boolean }> {
    if (!/^[0-9a-f-]{36}$/i.test(sessionId)) throw Errors.notFound('Oturum');
    const hashes = await repo.revokeSessions(this.d.db, { userId: auth.user.id, sessionId }, 'user_revoked');
    if (hashes.length === 0) throw Errors.notFound('Oturum');
    await this.d.cache.del(hashes).catch(() => undefined);
    return { current: sessionId === auth.session.id };
  }

  async revokeOtherSessions(auth: AuthenticatedContext): Promise<{ revoked: number }> {
    const hashes = await repo.revokeSessions(
      this.d.db,
      { userId: auth.user.id, exceptSessionId: auth.session.id },
      'user_revoked_others',
    );
    await this.d.cache.del(hashes).catch(() => undefined);
    return { revoked: hashes.length };
  }

  async loginHistory(auth: AuthenticatedContext): Promise<LoginHistoryEntry[]> {
    const rows = await repo.listLoginEvents(this.d.db, auth.user.id, 50);
    return rows.map((r) => ({
      id: r.id,
      success: r.success,
      failureReason: r.failure_reason,
      platform: normalizePlatform(r.platform),
      browser: r.browser,
      os: r.os,
      ipMasked: maskIp(r.ip),
      suspicious: r.suspicious,
      suspiciousReasons: r.suspicious_reasons,
      createdAt: r.created_at.toISOString(),
    }));
  }

  // ================================================================== Parola
  async forgotPassword(input: unknown, ctx: RequestContext): Promise<void> {
    await this.enforce(`forgot:ip:${ctx.ip ?? 'unknown'}`, this.limits.forgotPerIp);
    const { email } = forgotPasswordSchema.parse(input);
    const [limit, window] = this.limits.forgotPerEmail;
    const rl = await this.d.limiter.hit(`forgot:email:${email}`, limit, window);
    if (!rl.allowed) return; // Sessizce yok sayılır; yanıt her durumda aynıdır.

    const user = await repo.findUserByEmail(this.d.db, email);
    if (!user || user.status === 'deleted') return;
    const token = randomToken();
    await withTransaction(this.d.db, (c) =>
      repo.insertPasswordResetToken(c, user.id, sha256(token), PASSWORD_RESET_TTL, safeIp(ctx.ip)),
    );
    this.sendInBackground(emails.passwordResetEmail(user.email, user.username, this.webUrl('/sifre-sifirla', token)));
  }

  async resetPassword(input: unknown): Promise<void> {
    const data = resetPasswordSchema.parse(input);
    const { user, revoked } = await withTransaction(this.d.db, async (c) => {
      const row = await repo.findPasswordResetToken(c, sha256(data.token));
      if (!row || row.used_at) throw Errors.invalidToken();
      if (row.expires_at.getTime() <= Date.now()) throw Errors.tokenExpired();
      const u = await repo.findUserById(c, row.user_id);
      if (!u || u.status === 'deleted') throw Errors.invalidToken();
      this.assertStrong(data.newPassword, u, 'newPassword');
      await repo.updatePasswordHash(c, u.id, await this.d.hasher.hash(data.newPassword), true);
      await repo.consumeAllPasswordResetTokens(c, u.id);
      // Sıfırlama bağlantısını açabilmek e-posta sahipliğini kanıtlar.
      await repo.markEmailVerified(c, u.id);
      const hashes = await repo.revokeSessions(c, { userId: u.id }, 'password_reset');
      return { user: u, revoked: hashes };
    });
    await this.d.cache.del(revoked).catch(() => undefined);
    await this.d.limiter.reset(`login:fail:user:${user.id}`);
    this.sendInBackground(
      emails.passwordChangedEmail(user.email, user.username, new Date(), this.webUrl('/sifremi-unuttum')),
    );
  }

  async changePassword(auth: AuthenticatedContext, input: unknown): Promise<{ revokedOtherSessions: number }> {
    await this.enforce(`pwchange:user:${auth.user.id}`, this.limits.changePasswordPerUser);
    const data = changePasswordSchema.parse(input);
    const user = await repo.findUserById(this.d.db, auth.user.id);
    if (!user) throw Errors.unauthenticated();
    if (!(await this.d.hasher.verify(user.password_hash, data.currentPassword))) {
      throw new AppError('INVALID_CREDENTIALS', 400, 'Mevcut parolan hatalı.', {
        fields: { currentPassword: ['Mevcut parolan hatalı.'] },
      });
    }
    this.assertStrong(data.newPassword, user, 'newPassword');
    if (await this.d.hasher.verify(user.password_hash, data.newPassword)) {
      throw new AppError('WEAK_PASSWORD', 400, 'Yeni parola mevcut parolanla aynı olamaz.', {
        fields: { newPassword: ['Yeni parola mevcut parolanla aynı olamaz.'] },
      });
    }
    const newHash = await this.d.hasher.hash(data.newPassword);
    const revoked = await withTransaction(this.d.db, async (c) => {
      await repo.updatePasswordHash(c, user.id, newHash, true);
      await repo.consumeAllPasswordResetTokens(c, user.id);
      return repo.revokeSessions(c, { userId: user.id, exceptSessionId: auth.session.id }, 'password_changed');
    });
    await this.d.cache.del(revoked).catch(() => undefined);
    this.sendInBackground(
      emails.passwordChangedEmail(user.email, user.username, new Date(), this.webUrl('/sifremi-unuttum')),
    );
    return { revokedOtherSessions: revoked.length };
  }

  private assertStrong(password: string, user: repo.UserRow, field: string) {
    const policy = checkPassword(password, { username: user.username, email: user.email });
    if (!policy.ok) {
      throw new AppError('WEAK_PASSWORD', 400, 'Parola güvenlik kurallarını karşılamıyor.', {
        fields: { [field]: policy.problems },
      });
    }
  }

  // ================================================================== Yardımcılar
  private async enforce(key: string, [limit, window]: [number, number]) {
    const r = await this.d.limiter.hit(key, limit, window);
    if (!r.allowed) throw Errors.rateLimited(r.retryAfterSeconds);
  }

  private webUrl(path: string, token?: string): string {
    const url = new URL(path, this.d.config.publicWebUrl + '/');
    if (token) url.searchParams.set('token', token);
    return url.toString();
  }

  private async safeSend(message: MailMessage): Promise<void> {
    try {
      await this.d.mailer.send(message);
    } catch (err) {
      this.d.log.error({ err, subject: message.subject }, 'e-posta gönderilemedi');
    }
  }

  /** Yanıt süresi e-posta gönderimine bağlı olmasın (hesap varlığı zamanlamadan sızmasın). */
  private sendInBackground(message: MailMessage): void {
    void this.safeSend(message);
  }
}

function usernameTaken() {
  return new AppError('USERNAME_TAKEN', 409, 'Bu kullanıcı adı zaten alınmış.', {
    fields: { username: ['Bu kullanıcı adı zaten alınmış.'] },
  });
}

function lockedOut(retryAfterSeconds: number) {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return Errors.rateLimited(
    retryAfterSeconds,
    `Çok fazla başarısız giriş denemesi. Güvenliğin için ${minutes} dakika sonra tekrar dene.`,
  );
}

function deviceLabel(platform: ClientPlatform, browser: string | null, os: string | null): string {
  return [PLATFORM_LABELS_TR[platform], browser, os].filter(Boolean).join(' · ');
}

export function toPublicUser(u: repo.UserRow, roles: RoleKey[]): PublicUser {
  return {
    id: u.id,
    playerId: Number(u.public_id),
    username: u.username,
    email: u.email,
    emailVerified: !!u.email_verified_at,
    status: u.status,
    roles,
    createdAt: u.created_at.toISOString(),
  };
}
