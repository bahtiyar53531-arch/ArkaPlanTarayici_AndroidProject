import type { Redis } from 'ioredis';
import type { SessionWithUser } from './repository.js';

/**
 * Oturum doğrulama önbelleği (cache-aside). Asıl kaynak PostgreSQL'dir.
 * Oturum iptal edildiğinde ilgili anahtar hemen silinir; TTL kısa tutulur (varsayılan 30 sn).
 */
export interface SessionCache {
  get(tokenHash: Buffer): Promise<SessionWithUser | null>;
  set(tokenHash: Buffer, value: SessionWithUser, ttlSeconds: number): Promise<void>;
  del(tokenHashes: Buffer[]): Promise<void>;
}

const DATE_FIELDS_SESSION = ['created_at', 'last_seen_at', 'expires_at', 'revoked_at'] as const;
const DATE_FIELDS_USER = ['email_verified_at', 'suspended_until', 'locked_until', 'created_at'] as const;

function revive(raw: string): SessionWithUser {
  const v = JSON.parse(raw) as SessionWithUser;
  const s = v.session as unknown as Record<string, unknown>;
  const u = v.user as unknown as Record<string, unknown>;
  for (const f of DATE_FIELDS_SESSION) if (s[f] != null) s[f] = new Date(s[f] as string);
  for (const f of DATE_FIELDS_USER) if (u[f] != null) u[f] = new Date(u[f] as string);
  return v;
}

export class RedisSessionCache implements SessionCache {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'to:sess:',
  ) {}

  async get(tokenHash: Buffer): Promise<SessionWithUser | null> {
    const raw = await this.redis.get(this.prefix + tokenHash.toString('hex'));
    return raw ? revive(raw) : null;
  }

  async set(tokenHash: Buffer, value: SessionWithUser, ttlSeconds: number): Promise<void> {
    // Parola özeti önbelleğe asla yazılmaz.
    const safe = { session: value.session, user: { ...value.user, password_hash: '' } };
    await this.redis.set(this.prefix + tokenHash.toString('hex'), JSON.stringify(safe), 'EX', ttlSeconds);
  }

  async del(tokenHashes: Buffer[]): Promise<void> {
    if (tokenHashes.length === 0) return;
    await this.redis.del(...tokenHashes.map((h) => this.prefix + h.toString('hex')));
  }
}

/** Redis olmadan çalışırken (geliştirme) önbellek devre dışıdır; her istek veritabanına gider. */
export class NoopSessionCache implements SessionCache {
  async get(): Promise<null> {
    return null;
  }
  async set(): Promise<void> {}
  async del(): Promise<void> {}
}
