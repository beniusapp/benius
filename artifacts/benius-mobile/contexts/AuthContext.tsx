import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, authTransport, AuthenticatedSession, LoginResult, MobileUser, Role, setUnauthorizedHandler } from '@/lib/api';

type AuthState = {
  user: MobileUser | null;
  loading: boolean;
  restoreError: string | null;
  login(credentials: { identifier: string; password: string; role: Role }): Promise<LoginResult>;
  verifyPin(challengeToken: string, pin: string): Promise<void>;
  initialize(input: { challengeToken: string; newPassword: string; confirmPassword: string; pin: string; confirmPin: string; recoveryEmail: string; recoveryPhone: string }): Promise<void>;
  logout(): Promise<void>;
};
const Context = createContext<AuthState | null>(null);
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<MobileUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const clear = useCallback(async () => {
    setUser(null);
    setRestoreError(null);
    queryClient.clear();
    await authTransport.clear();
  }, [queryClient]);
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
    }).catch(error => {
      if (!active) return;
      if (error instanceof ApiError && (error.code === 'network' || error.code === 'timeout')) {
        setRestoreError(error.message);
        return;
      }
      void clear();
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; setUnauthorizedHandler(undefined); };
  }, [clear]);
  const accept = (session: AuthenticatedSession) => {
    queryClient.clear();
    setUser(session.user);
  };
  const login = async (credentials: { identifier: string; password: string; role: Role }) => {
    setRestoreError(null);
    const result = await authTransport.login(credentials);
    if (result.state === 'authenticated') accept(result);
    return result;
  };
  const verifyPin = async (challengeToken: string, pin: string) => {
    accept(await authTransport.verifyPin(challengeToken, pin));
  };
  const initialize = async (input: { challengeToken: string; newPassword: string; confirmPassword: string; pin: string; confirmPin: string; recoveryEmail: string; recoveryPhone: string }) => {
    accept(await authTransport.initialize(input));
  };
  const logout = async () => {
    await authTransport.logout();
    await clear();
  };
  return <Context.Provider value={{ user, loading, restoreError, login, verifyPin, initialize, logout }}>{children}</Context.Provider>;
}
export function useAuth() {
  const context = useContext(Context);
  if (!context) throw new Error('AuthProvider required');
  return context;
}