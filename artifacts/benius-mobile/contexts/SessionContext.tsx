import React, { createContext, useContext, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AcademicSession, apiGet, sessionsPath } from '@/lib/api';
import { useAuth } from './AuthContext';

type SessionState = { sessions: AcademicSession[]; selectedId: number | null; loading: boolean; error: Error | null; refresh(): Promise<void>; select(id: number): Promise<void> };
const Context = createContext<SessionState | null>(null);
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const currentRole = user?.role;
  const [storedId, setStoredId] = useState<number | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const key = user ? `benius.session.${user.schoolId}.${user.role}.${user.id}` : null;
  useEffect(() => {
    let active = true;
    setStoredId(null);
    setHydrated(false);
    if (!key) { setHydrated(true); return; }
    void AsyncStorage.getItem(key).then(value => {
      if (active) setStoredId(value && /^\d+$/.test(value) ? Number(value) : null);
    }).finally(() => { if (active) setHydrated(true); });
    return () => { active = false; void AsyncStorage.removeItem(key); };
  }, [key]);
  const query = useQuery({
    queryKey: ['sessions', user?.schoolId, user?.role, user?.id],
    queryFn: ({ signal }) => {
      if (!currentRole || currentRole === 'support_staff') throw new Error('Academic sessions are not available in mobile authentication.');
      return apiGet<AcademicSession[]>(sessionsPath[currentRole], { signal });
    },
    // These legacy endpoints are cookie-only. Keep mobile authentication separate
    // until native academic-session endpoints are explicitly approved.
    enabled: false,
    staleTime: 60_000,
  });
  const sessions = (query.data ?? []).filter(s => s.schoolId === user?.schoolId);
  const valid = storedId !== null && sessions.some(s => s.id === storedId);
  const selectedId = !user || !hydrated || !query.isSuccess ? null : valid ? storedId : (sessions.find(s => s.isActive)?.id ?? sessions[0]?.id ?? null);
  useEffect(() => {
    if (!key || !hydrated || !query.isSuccess) return;
    if (selectedId !== storedId) {
      setStoredId(selectedId);
      void (selectedId === null ? AsyncStorage.removeItem(key) : AsyncStorage.setItem(key, String(selectedId)));
    }
  }, [key, hydrated, query.isSuccess, selectedId, storedId]);
  const select = async (id: number) => {
    if (!key || !sessions.some(s => s.id === id)) throw new Error('Session is not available to this account.');
    setStoredId(id);
    await AsyncStorage.setItem(key, String(id));
  };
  return <Context.Provider value={{ sessions, selectedId, loading: !!user && (!hydrated || query.isPending), error: query.error, refresh: async () => { await query.refetch(); }, select }}>{children}</Context.Provider>;
}
export function useAcademicSession() {
  const value = useContext(Context);
  if (!value) throw new Error('SessionProvider required');
  return value;
}