import { compareVersions } from '@turkorbit/shared';
import type { FastifyInstance } from 'fastify';
import type { Queryable } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';
import { getSetting } from '../auth/repository.js';

/** game_settings 'client' (migration 0011). */
export interface ClientSettings {
  min_version: { android: string; ios: string };
  store_url: { android: string | null; ios: string | null };
  message: string;
}

const DEFAULTS: ClientSettings = {
  min_version: { android: '0.0.0', ios: '0.0.0' },
  store_url: { android: null, ios: null },
  message: 'Oynamaya devam etmek için uygulamayı güncelle.',
};

export interface OutdatedInfo {
  minVersion: string;
  storeUrl: string | null;
  message: string;
}

/**
 * Mobil istemci sürüm kapısı (Aşama 15). Ayar her istekte veritabanından okunmaz: 10 sn önbellek.
 * Yönetim Merkezi'nden yayın yapan süreçte önbellek anında boşaltılır (invalidate); diğer API süreçlerinde
 * en geç 10 sn içinde geçerli olur.
 *
 * Not: Bu bir uyumluluk kapısıdır, güvenlik denetimi değildir — başlıkları istemci gönderir.
 * Asıl güvenlik (yetki, oturum, oyun kuralları) her zaman sunucudadır.
 */
export class ClientGate {
  private cache: { at: number; value: ClientSettings } | null = null;

  constructor(
    private readonly db: Queryable,
    private readonly ttlMs = 10_000,
    private readonly now: () => number = Date.now,
  ) {}

  invalidate() {
    this.cache = null;
  }

  async settings(): Promise<ClientSettings> {
    if (this.cache && this.now() - this.cache.at < this.ttlMs) return this.cache.value;
    const s = await getSetting<Partial<ClientSettings>>(this.db, 'client');
    const value: ClientSettings = {
      min_version: { ...DEFAULTS.min_version, ...(s?.min_version ?? {}) },
      store_url: { ...DEFAULTS.store_url, ...(s?.store_url ?? {}) },
      message: s?.message || DEFAULTS.message,
    };
    this.cache = { at: this.now(), value };
    return value;
  }

  /** android/ios dışındaki platformlar (web, masaüstü) için her zaman null. */
  async check(platform: unknown, version: unknown): Promise<OutdatedInfo | null> {
    if (platform !== 'android' && platform !== 'ios') return null;
    const s = await this.settings();
    const min = s.min_version[platform];
    const v = typeof version === 'string' ? version.trim() : '';
    if (compareVersions(v, min) >= 0) return null;
    return { minVersion: min, storeUrl: s.store_url[platform], message: s.message };
  }
}

/** /api/v1 altındaki tüm uçlara uygulanır; durum ucu (/health) hariç (yük dengeleyici başlık göndermez). */
export function registerClientGate(app: FastifyInstance, gate: ClientGate) {
  app.addHook('onRequest', async (request) => {
    if (request.method === 'OPTIONS') return;
    const url = request.url;
    if (!url.startsWith('/api/v1/') || url.startsWith('/api/v1/health')) return;
    const r = await gate.check(request.headers['x-client-platform'], request.headers['x-client-version']);
    if (r) throw new AppError('CLIENT_OUTDATED', 426, r.message, { minVersion: r.minVersion, storeUrl: r.storeUrl });
  });
}
