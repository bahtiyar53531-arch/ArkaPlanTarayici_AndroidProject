import type { ApiErrorBody, ErrorCode } from '@turkorbit/shared';

const API_BASE: string = import.meta.env.VITE_API_BASE ?? '/api/v1';

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
  ) {
    super(message);
  }
}

/** Yönetim Merkezi istemcisi: oyun istemcisiyle aynı oturum çerezi ve CSRF koruması. Yetki her istekte SUNUCUDA denetlenir. */
export async function api<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'X-Client-Platform': 'web' };
  const payload = method === 'POST' ? JSON.stringify(body ?? {}) : undefined;
  if (payload !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  let res: Response;
  try {
    res = await fetch(API_BASE + path, { method, headers, body: payload, credentials: 'include' });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Sunucuya ulaşılamıyor.');
  }
  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const err = (json as ApiErrorBody | null)?.error;
    throw new ApiError(res.status, err?.code ?? 'INTERNAL_ERROR', err?.message ?? 'Beklenmeyen bir hata oluştu.', err?.fields ?? {});
  }
  return json as T;
}

export const errorText = (e: unknown) => {
  if (e instanceof ApiError) {
    const fields = Object.entries(e.fields)
      .filter(([k]) => k !== '_')
      .map(([, v]) => v.join(' '));
    const extra = e.fields._?.join(' ');
    return [e.message, extra, ...fields].filter(Boolean).join(' · ');
  }
  return 'Beklenmeyen bir hata oluştu.';
};
