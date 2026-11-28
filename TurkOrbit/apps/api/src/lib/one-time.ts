import { createHash, randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';

/**
 * Kısa ömürlü, tek kullanımlık bağlantı anahtarları (Aşama 15: mobil uygulamada destek eki indirme).
 * - Anahtar 32 rastgele bayttır; depoda yalnızca SHA-256 özeti tutulur.
 * - Redis'te SET EX ile yazılır, GETDEL ile atomik tüketilir: aynı anahtar ikinci kez kullanılamaz,
 *   birden fazla API süreci arasında da tek kullanımlıktır.
 * - Redis yoksa (yalnızca tek süreçli geliştirme/test) bellekte tutulur.
 */
export class OneTimeLinks<T> {
  private readonly memory = new Map<string, { value: string; expiresAt: number }>();

  constructor(
    private readonly redis: Redis | null,
    private readonly prefix: string,
    private readonly ttlSeconds: number,
    private readonly now: () => number = Date.now,
  ) {}

  private key(token: string) {
    return `${this.prefix}:${createHash('sha256').update(token).digest('hex')}`;
  }

  async create(data: T): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const value = JSON.stringify(data);
    if (this.redis) await this.redis.set(this.key(token), value, 'EX', this.ttlSeconds);
    else {
      this.prune();
      this.memory.set(this.key(token), { value, expiresAt: this.now() + this.ttlSeconds * 1000 });
    }
    return token;
  }

  /** Anahtarı tüketir. Bilinmeyen, süresi dolmuş veya daha önce kullanılmış anahtar için null. */
  async consume(token: string): Promise<T | null> {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
    const k = this.key(token);
    let raw: string | null;
    if (this.redis) raw = await this.redis.getdel(k);
    else {
      const m = this.memory.get(k);
      this.memory.delete(k);
      raw = m && m.expiresAt > this.now() ? m.value : null;
    }
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  private prune() {
    const t = this.now();
    for (const [k, v] of this.memory) if (v.expiresAt <= t) this.memory.delete(k);
  }
}
