import type { PermissionKey, RoleKey } from '@turkorbit/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, setCsrfToken } from './api';

interface Me {
  user: { id: string; username: string; roles: RoleKey[] };
  permissions: PermissionKey[];
  csrfToken: string | null;
}

interface AuthState {
  me: Me | null;
  loading: boolean;
  can: (p: PermissionKey) => boolean;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const apply = (m: Me | null) => {
    setMe(m);
    setCsrfToken(m?.csrfToken ?? null);
  };
  useEffect(() => {
    api<Me>('GET', '/auth/me')
      .then(apply)
      .catch(() => apply(null))
      .finally(() => setLoading(false));
  }, []);
  const login = useCallback(async (identifier: string, password: string) => {
    await api('POST', '/auth/login', { identifier, password, transport: 'cookie' });
    apply(await api<Me>('GET', '/auth/me'));
  }, []);
  const logout = useCallback(async () => {
    await api('POST', '/auth/logout').catch((e: unknown) => {
      if (!(e instanceof ApiError) || e.status !== 401) throw e;
    });
    apply(null);
  }, []);
  const value = useMemo<AuthState>(() => {
    const set = new Set(me?.permissions ?? []);
    return { me, loading, can: (p) => set.has(p), login, logout };
  }, [me, loading, login, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('AuthProvider eksik');
  return v;
}
