import type { Redis } from 'ioredis';

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Sabit pencereli sayaç. Anahtarlar "işlem:kapsam:değer" biçimindedir (ör. login:ip:1.2.3.4).
 * hit(): sayacı artırır ve sınır aşıldıysa allowed=false döner.
 * peek(): sayacı artırmadan mevcut durumu okur.
 */
export interface RateLimiter {
  hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult>;
  peek(key: string, limit: number): Promise<RateLimitResult>;
  reset(key: string): Promise<void>;
}

// INCR + ilk artışta PEXPIRE, atomik olarak (Lua). Dönüş: {sayaç, kalan_ms}
const HIT_SCRIPT = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end
return {c, ttl}
`;

function toResult(count: number, limit: number, ttlMs: number): RateLimitResult {
  return {
    allowed: count <= limit,
    count,
    remaining: Math.max(0, limit - count),
    retryAfterSeconds: count >= limit ? Math.max(1, Math.ceil(ttlMs / 1000)) : 0,
  };
}

export class RedisRateLimiter implements RateLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'to:rl:',
  ) {}

  async hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const [count, ttl] = (await this.redis.eval(
      HIT_SCRIPT,
      1,
      this.prefix + key,
      String(windowSeconds * 1000),
    )) as [number, number];
    return toResult(count, limit, ttl);
  }

  async peek(key: string, limit: number): Promise<RateLimitResult> {
    const [raw, ttl] = await Promise.all([
      this.redis.get(this.prefix + key),
      this.redis.pttl(this.prefix + key),
    ]);
    const count = raw ? Number(raw) : 0;
    return { ...toResult(count, limit, ttl > 0 ? ttl : 0), allowed: count < limit };
  }

  async reset(key: string): Promise<void> {
    await this.redis.del(this.prefix + key);
  }
}

/** Redis yoksa (yalnızca geliştirme) tek süreçli bellek içi sayaç. */
export class MemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  async hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const now = Date.now();
    let b = this.buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowSeconds * 1000 };
      this.buckets.set(key, b);
    }
    b.count++;
    return toResult(b.count, limit, b.resetAt - now);
  }

  async peek(key: string, limit: number): Promise<RateLimitResult> {
    const now = Date.now();
    const b = this.buckets.get(key);
    const count = b && b.resetAt > now ? b.count : 0;
    const ttl = b && b.resetAt > now ? b.resetAt - now : 0;
    return { ...toResult(count, limit, ttl), allowed: count < limit };
  }

  async reset(key: string): Promise<void> {
    this.buckets.delete(key);
  }
}
