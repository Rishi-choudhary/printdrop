'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { apiFetch } from './api';

interface User {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  role: string;
  shop?: { id: string; name: string; autoPrint?: boolean; agentLastSeen?: string | null } | null;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (phone: string, pin: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  login: async () => {},
  logout: () => {},
});

function clearLegacyTokenCookie() {
  if (typeof document === 'undefined') return;
  document.cookie = 'token=; Max-Age=0; Path=/; SameSite=Lax';
  document.cookie = 'token=; Max-Age=0; Path=/; SameSite=Lax; Secure';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    clearLegacyTokenCookie();
    apiFetch<{ user: User }>('/auth/me')
      .then((data) => setUser(data.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = async (phone: string, pin: string) => {
    const data = await apiFetch<{ user: User }>('/auth/shopkeeper-login', {
      method: 'POST',
      body: JSON.stringify({ phone, pin }),
    });
    setUser(data.user);
  };

  const logout = () => {
    apiFetch('/auth/logout', { method: 'POST' }).catch(() => {}).finally(() => {
      clearLegacyTokenCookie();
      setUser(null);
      window.location.href = '/login';
    });
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
