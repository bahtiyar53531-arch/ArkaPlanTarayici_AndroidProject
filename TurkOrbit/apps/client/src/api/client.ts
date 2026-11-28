import type { ApiErrorBody, ErrorCode } from '@turkorbit/shared';
import { APP_VERSION, CLIENT_PLATFORM, IS_NATIVE } from '../platform/native';
import { sessionToken } from '../platform/secure-store';
import { apiBase } from '../platform/server';

export { CLIENT_PLATFORM };

/**
 * Oturum taşıma:
 * - Web/PWA: HttpOnly çerez (JavaScript erişemez) + durum değiştiren isteklerde X-CSRF-Token.
 * - Android/iOS (Capacitor, Aşama 15): oturum anahtarı cihazın güvenli deposunda (Keystore/Keychain) tutulur ve
 *   "Authorization: Bearer" olarak gönderilir; çerez gönderilmez, CSRF gerekmez (tarayıcı Bearer'ı kendiliğinden eklemez).
 */
let csrfToken: string | null = null;
export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

/** Sunucu istemci sürümünü desteklemiyorsa (426) uygulama "güncelleme gerekli" ekranını açar. */
export interface UpdateRequiredInfo {
  message: string;
  storeUrl: string | null;
  minVersion: string | null;
}
type UpdateListener = (info: UpdateRequiredInfo) => void;
const updateListeners = new Set<UpdateListener>();
let updateRequired: UpdateRequiredInfo | null = null;
export function onUpdateRequired(fn: UpdateListener): () => void {
  updateListeners.add(fn);
  if (updateRequired) fn(updateRequired);
  return () => updateListeners.delete(fn);
}

function baseHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'X-Client-Platform': CLIENT_PLATFORM, 'X-Client-Version': APP_VERSION };
  if (IS_NATIVE) {
    const token = sessionToken.current();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

/** Mobilde çerez gönderilmez (oturum Bearer ile taşınır); web'de oturum çerezi her istekte gider. */
const CREDENTIALS: RequestCredentials = IS_NATIVE ? 'omit' : 'include';

function toApiError(status: number, json: unknown, fallback: string): ApiError {
  const err = (json as ApiErrorBody | null)?.error;
  const e = new ApiError(status, err?.code ?? 'INTERNAL_ERROR', err?.message ?? fallback, err?.fields ?? {}, err?.retryAfterSeconds);
  if (status === 426 && err?.code === 'CLIENT_OUTDATED') {
    const extra = err as unknown as { storeUrl?: string | null; minVersion?: string | null };
    updateRequired = { message: e.message, storeUrl: extra.storeUrl ?? null, minVersion: extra.minVersion ?? null };
    for (const fn of updateListeners) fn(updateRequired);
  }
  return e;
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
  const headers = baseHeaders();
  // Fastify boş JSON gövdesini reddeder; gövdesiz POST'larda {} gönderilir.
  const payload = method === 'POST' || method === 'PUT' || method === 'PATCH' ? JSON.stringify(body ?? {}) : undefined;
  if (payload !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken && !IS_NATIVE) headers['X-CSRF-Token'] = csrfToken;

  let res: Response;
  try {
    // keepalive: sayfa kapanırken gönderilen son istek (ör. son konum) tarayıcı tarafından tamamlanır.
    res = await fetch(apiBase() + path, { method, headers, body: payload, credentials: CREDENTIALS, keepalive: opts.keepalive });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Sunucuya ulaşılamıyor. İnternet bağlantını kontrol et.');
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    // JSON olmayan yanıt (ör. yanlış sunucu adresi, vekil sunucu hata sayfası)
    if (res.ok) throw new ApiError(res.status, 'INTERNAL_ERROR', 'Sunucudan beklenmeyen bir yanıt geldi. Sunucu adresini kontrol et.');
  }
  if (!res.ok) throw toApiError(res.status, json, 'Beklenmeyen bir hata oluştu.');
  return json as T;
}

/** Ek dosya yükleme (Aşama 13): ham gövde, dosya adı başlıkta. Türü sunucu içerikten belirler. */
export async function uploadFile<T>(path: string, file: File): Promise<T> {
  const headers = baseHeaders();
  headers['Content-Type'] = 'application/octet-stream';
  headers['X-File-Name'] = encodeURIComponent(file.name);
  if (csrfToken && !IS_NATIVE) headers['X-CSRF-Token'] = csrfToken;
  let res: Response;
  try {
    res = await fetch(apiBase() + path, { method: 'POST', headers, body: file, credentials: CREDENTIALS });
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
  if (!res.ok) throw toApiError(res.status, json, res.status === 413 ? 'Dosya çok büyük.' : 'Dosya yüklenemedi.');
  return json as T;
}

/** Ek dosyanın indirme adresi (web: çerezli oturumla aynı kökten; dosya her zaman "indirme" olarak gelir). */
export const attachmentUrl = (id: number) => `${apiBase()}/support/attachments/${id}`;

/**
 * Mobilde ek indirme: WebView bağlantıya Bearer ekleyemez. Sunucudan 60 saniyelik tek kullanımlık bağlantı alınır ve
 * cihazın tarayıcısında açılır (Capacitor, uygulama dışı adresleri sistem tarayıcısına yönlendirir).
 */
export async function openAttachmentNative(id: number): Promise<void> {
  const r = await api<{ path: string }>('POST', `/support/attachments/${id}/link`);
  window.location.href = `${apiBase()}${r.path}`;
}
