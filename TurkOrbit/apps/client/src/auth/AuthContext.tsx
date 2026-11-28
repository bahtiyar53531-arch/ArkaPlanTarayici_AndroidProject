import type { LoginResponse, MeResponse } from '@turkorbit/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, setCsrfToken } from '../api/client';
import { APP_VERSION, CLIENT_PLATFORM, IS_NATIVE } from '../platform/native';
import { sessionToken } from '../platform/secure-store';
import { needsServerSetup } from '../platform/server';
import { nativeDeviceName } from '../platform/shell';

interface AuthState {
  me: MeResponse | null;
  loading: boolean;
  login(identifier: string, password: string): Promise<LoginResponse>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
  clear(): void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const apply = (value: MeResponse | null) => {
    setMe(value);
    setCsrfToken(value?.csrfToken ?? null);
  };

  const refresh = useCallback(async () => {
    try {
      if (IS_NATIVE) {
        // Mobil: oturum anahtarı güvenli depodan okunur; yoksa sunucuya sormaya gerek yok
        if (needsServerSetup() || !(await sessionToken.load())) {
          apply(null);
          return;
        }
      }
      apply(await api<MeResponse>('GET', '/auth/me'));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // Oturum sunucuda kapatılmış (ör. başka cihazdan "oturumu kapat"): yerel anahtar da silinir
        await sessionToken.clear();
        apply(null);
      } else throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => setLoading(false));
  }, [refresh]);

  const login = useCallback(async (identifier: string, password: string) => {
    const r = await api<LoginResponse>('POST', '/auth/login', {
      identifier,
      password,
      // Mobil uygulama oturum anahtarını yanıtta alır ve güvenli depoya yazar; web HttpOnly çerez kullanır
      transport: IS_NATIVE ? 'token' : 'cookie',
      device: IS_NATIVE
        ? { platform: CLIENT_PLATFORM, name: await nativeDeviceName(), appVersion: APP_VERSION }
        : { platform: CLIENT_PLATFORM },
    });
    if (IS_NATIVE) {
      if (!r.sessionToken) throw new ApiError(500, 'INTERNAL_ERROR', 'Sunucu oturum anahtarı göndermedi.');
      await sessionToken.save(r.sessionToken);
    }
    const { sessionToken: _omit, ...me } = r;
    apply(me);
    return r;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('POST', '/auth/logout');
    } finally {
      await sessionToken.clear();
      apply(null);
    }
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      me,
      loading,
      login,
      logout,
      refresh,
      clear: () => {
        void sessionToken.clear();
        apply(null);
      },
    }),
    [me, loading, login, logout, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth, AuthProvider içinde kullanılmalı');
  return ctx;
}
