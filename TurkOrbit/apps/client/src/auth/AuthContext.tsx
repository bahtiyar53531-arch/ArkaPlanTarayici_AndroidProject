import type { LoginResponse, MeResponse } from '@turkorbit/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, CLIENT_PLATFORM, setCsrfToken } from '../api/client';

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
      apply(await api<MeResponse>('GET', '/auth/me'));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) apply(null);
      else throw err;
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
      transport: 'cookie',
      device: { platform: CLIENT_PLATFORM },
    });
    apply(r);
    return r;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('POST', '/auth/logout');
    } finally {
      apply(null);
    }
  }, []);

  const value = useMemo<AuthState>(
    () => ({ me, loading, login, logout, refresh, clear: () => apply(null) }),
    [me, loading, login, logout, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth, AuthProvider içinde kullanılmalı');
  return ctx;
}
