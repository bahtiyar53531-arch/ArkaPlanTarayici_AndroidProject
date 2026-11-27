import type { ApiErrorBody, ClientPlatform, ErrorCode } from '@turkorbit/shared';

const API_BASE: string = import.meta.env.VITE_API_BASE ?? '/api/v1';

/**
 * Bu istemci şu an web/PWA olarak çalışır ve HttpOnly çerez kullanır.
 * Aşama 15'te Capacitor (Android/iOS) paketinde platform 'android'/'ios' olacak ve oturum anahtarı
 * transport=token ile alınıp cihazın güvenli deposunda (Keychain/Keystore) saklanacak.
 */
export const CLIENT_PLATFORM: ClientPlatform = 'web';

let csrfToken: string | null = null;
export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode | 'NETWORK_ERROR',
    message: string,
    public readonly fields: Record<string, string[]> = {},
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

export async function api<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'X-Client-Platform': CLIENT_PLATFORM };
  // Fastify boş JSON gövdesini reddeder; gövdesiz POST'larda {} gönderilir.
  const payload = method === 'POST' ? JSON.stringify(body ?? {}) : undefined;
  if (payload !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;

  let res: Response;
  try {
    res = await fetch(API_BASE + path, { method, headers, body: payload, credentials: 'include' });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Sunucuya ulaşılamıyor. İnternet bağlantını kontrol et.');
  }
  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const err = (json as ApiErrorBody | null)?.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'INTERNAL_ERROR',
      err?.message ?? 'Beklenmeyen bir hata oluştu.',
      err?.fields ?? {},
      err?.retryAfterSeconds,
    );
  }
  return json as T;
}
