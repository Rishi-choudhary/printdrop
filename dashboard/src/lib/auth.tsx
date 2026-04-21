'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import Cookies from 'js-cookie';
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
  token: string | null;
  loading: boolean;
  login: (phone: string, pin: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  loading: true,
  login: async () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const savedToken = Cookies.get('token');
    if (savedToken) {
      setToken(savedToken);
      apiFetch('/auth/me', {
        headers: { Authorization: `Bearer ${savedToken}` },
      })
        .then((data) => setUser(data.user || data))
        .catch(() => {
          Cookies.remove('token');
          setToken(null);
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (phone: string, pin: string) => {
    const data = await apiFetch<{ token: string; user: User }>('/auth/shopkeeper-login', {
      method: 'POST',
      body: JSON.stringify({ phone, pin }),
    });
    Cookies.set('token', data.token, { expires: 30 });
    setToken(data.token);
    setUser(data.user);
  };

  const logout = () => {
    Cookies.remove('token');
    setToken(null);
    setUser(null);
    window.location.href = '/login';
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
