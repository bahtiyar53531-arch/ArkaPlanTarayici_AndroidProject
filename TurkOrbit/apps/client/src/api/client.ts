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

export async function api<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  opts: { keepalive?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = { 'X-Client-Platform': CLIENT_PLATFORM };
  // Fastify boş JSON gövdesini reddeder; gövdesiz POST'larda {} gönderilir.
  const payload = method === 'POST' || method === 'PUT' || method === 'PATCH' ? JSON.stringify(body ?? {}) : undefined;
  if (payload !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;

  let res: Response;
  try {
    // keepalive: sayfa kapanırken gönderilen son istek (ör. son konum) tarayıcı tarafından tamamlanır.
    res = await fetch(API_BASE + path, { method, headers, body: payload, credentials: 'include', keepalive: opts.keepalive });
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

/** Ek dosya yükleme (Aşama 13): ham gövde, dosya adı başlıkta. Türü sunucu içerikten belirler. */
export async function uploadFile<T>(path: string, file: File): Promise<T> {
  const headers: Record<string, string> = {
    'X-Client-Platform': CLIENT_PLATFORM,
    'Content-Type': 'application/octet-stream',
    'X-File-Name': encodeURIComponent(file.name),
  };
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
  let res: Response;
  try {
    res = await fetch(API_BASE + path, { method: 'POST', headers, body: file, credentials: 'include' });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Sunucuya ulaşılamıyor. İnternet bağlantını kontrol et.');
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* JSON değil */
  }
  if (!res.ok) {
    const err = (json as ApiErrorBody | null)?.error;
    throw new ApiError(res.status, err?.code ?? 'INTERNAL_ERROR', err?.message ?? (res.status === 413 ? 'Dosya çok büyük.' : 'Dosya yüklenemedi.'));
  }
  return json as T;
}

/** Ek dosyanın indirme adresi (çerezli oturumla aynı kökten; dosya her zaman "indirme" olarak gelir). */
export const attachmentUrl = (id: number) => `${API_BASE}/support/attachments/${id}`;
