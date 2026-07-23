import { createContext, useContext } from "react";

export interface AcademicSession {
  id: number;
  schoolId: number;
  sessionName: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
  createdAt: string;
}

export interface SessionViewContextValue {
  sessions: AcademicSession[];
  selectedSession: AcademicSession | null;
  setSelectedSession: (s: AcademicSession | null) => void;
  isArchiveMode: boolean;
  isSessionsLoading: boolean;
}

export const SessionViewContext = createContext<SessionViewContextValue>({
  sessions: [],
  selectedSession: null,
  setSelectedSession: () => { /* noop */ },
  isArchiveMode: false,
  isSessionsLoading: true,
});

export function useSessionView() {
  return useContext(SessionViewContext);
}
