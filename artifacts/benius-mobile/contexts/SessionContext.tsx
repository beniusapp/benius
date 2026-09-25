import React, { createContext, useContext, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AcademicSession, AcademicSessionsResponse, AcademicSessionSelectionResponse, apiGet } from '@/lib/api';
import { academicSessionStorageKey } from '@/lib/session-storage';
import { useAuth } from './AuthContext';

type SessionState = { sessions: AcademicSession[]; selectedId: number | null; loading: boolean; error: Error | null; refresh(): Promise<void>; select(id: number): Promise<void> };
const Context = createContext<SessionState | null>(null);
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [storedId, setStoredId] = useState<number | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const key = user ? academicSessionStorageKey(user) : null;
  useEffect(() => {
    let active = true;
    setStoredId(null);
    setHydrated(false);
    if (!key) { setHydrated(true); return; }
    void AsyncStorage.getItem(key).then(value => {
      if (active) setStoredId(value && /^\d+$/.test(value) ? Number(value) : null);
    }).finally(() => { if (active) setHydrated(true); });
    // A key change or provider unmount is not a logout. Preserve this identity's
    // choice; AuthContext explicitly removes it when the verified account ends.
    return () => { active = false; };
  }, [key]);
  const query = useQuery({
    queryKey: ['sessions', user?.schoolId, user?.role, user?.id],
    queryFn: async ({ signal }) => {
      const result = await apiGet<AcademicSessionsResponse>('/mobile/academic-sessions', { signal });
      if (!result || !Array.isArray(result.sessions)
        || (result.activeSessionId !== null && (!Number.isSafeInteger(result.activeSessionId) || result.activeSessionId <= 0))
        || result.sessions.some(session => !Number.isSafeInteger(session.id) || !Number.isSafeInteger(session.schoolId)
          || typeof session.sessionName !== 'string' || typeof session.isActive !== 'boolean')) {
        throw new Error('The server returned an invalid academic-session list.');
      }
      return result;
    },
    enabled: !!user && user.role !== 'support_staff',
    staleTime: 60_000,
  });
  const sessions = (query.data?.sessions ?? []).filter(s => s.schoolId === user?.schoolId);
  const valid = storedId !== null && sessions.some(s => s.id === storedId);
  const activeSession = sessions.find(s => s.id === query.data?.activeSessionId)
    ?? sessions.find(s => s.isActive);
  const selectedId = !user || !hydrated || !query.isSuccess ? null : valid ? storedId : (activeSession?.id ?? sessions[0]?.id ?? null);
  useEffect(() => {
    if (!key || !hydrated || !query.isSuccess) return;
    if (selectedId !== storedId) {
      setStoredId(selectedId);
      void (selectedId === null ? AsyncStorage.removeItem(key) : AsyncStorage.setItem(key, String(selectedId)));
    }
  }, [key, hydrated, query.isSuccess, selectedId, storedId]);
  const select = async (id: number) => {
    if (!key || !user || !sessions.some(s => s.id === id)) throw new Error('Session is not available to this account.');
    const result = await apiGet<AcademicSessionSelectionResponse>('/mobile/academic-sessions/selection', { sessionId: id });
    if (result?.session?.id !== id || result.session.schoolId !== user.schoolId) {
      throw new Error('The server did not confirm this academic session for your school.');
    }
    await AsyncStorage.setItem(key, String(id));
    setStoredId(id);
    await queryClient.invalidateQueries({ predicate: cached => cached.queryKey[0] !== 'sessions' });
  };
  return <Context.Provider value={{ sessions, selectedId, loading: !!user && user.role !== 'support_staff' && (!hydrated || query.isPending), error: query.error, refresh: async () => { await query.refetch(); }, select }}>{children}</Context.Provider>;
}
export function useAcademicSession() {
  const value = useContext(Context);
  if (!value) throw new Error('SessionProvider required');
  return value;
}