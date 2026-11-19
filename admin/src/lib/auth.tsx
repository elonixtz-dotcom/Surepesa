import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, Permission, setToken, setUnauthorizedHandler, Staff } from './api';

interface AuthValue {
  staff: Staff | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
  can: (p: Permission) => boolean;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [staff, setStaff] = useState<Staff | null>(null);
  const [loading, setLoading] = useState(Boolean(getToken()));

  const signOut = useCallback(() => {
    setToken(null);
    setStaff(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(signOut);
    if (!getToken()) return;
    api<Staff>('/me')
      .then(setStaff)
      .catch(signOut)
      .finally(() => setLoading(false));
  }, [signOut]);

  const signIn = useCallback(async (email: string, password: string) => {
    const res = await api<{ token: string; admin: Staff }>('/auth/login', { method: 'POST', body: { email, password } });
    setToken(res.token);
    setStaff(res.admin);
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ staff, loading, signIn, signOut, can: (p) => Boolean(staff?.permissions.includes(p)) }),
    [staff, loading, signIn, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
