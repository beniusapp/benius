import React, { createContext, useContext, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { authTransport, MobileUser, setUnauthorizedHandler } from '@/lib/api';
import { clearApprovedSession } from '@/lib/secure-session';

type AuthState = { user: MobileUser | null; loading: boolean; logout(): Promise<void> };
const Context = createContext<AuthState | null>(null);
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<MobileUser | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();
  const clear = async () => {
    setUser(null);
    queryClient.clear();
    await clearApprovedSession();
  };
  useEffect(() => {
    let active = true;
    setUnauthorizedHandler(() => { void clear(); });
    void authTransport.restore().then(async result => {
      if (!result) return;
      // Never trust a cached identity. Verify against the backend before role navigation.
      const verified = await authTransport.currentUser();
      if (verified.id !== result.user.id || verified.schoolId !== result.user.schoolId || verified.role !== result.user.role) {
        throw new Error('Restored identity did not match the backend.');
      }
      if (active) setUser(verified);
    }).catch(() => {
      if (active) void clear();
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; setUnauthorizedHandler(undefined); };
  }, []);
  const logout = async () => {
    try { await authTransport.logout(); } finally { await clear(); }
  };
  return <Context.Provider value={{ user, loading, logout }}>{children}</Context.Provider>;
}
export function useAuth() {
  const context = useContext(Context);
  if (!context) throw new Error('AuthProvider required');
  return context;
}