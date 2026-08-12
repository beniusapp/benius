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

export interface PaymentUpdatePayload {
  feeRecordId: number;
  receiptNumber: string;
}

export interface SessionViewContextValue {
  sessions: AcademicSession[];
  selectedSession: AcademicSession | null;
  setSelectedSession: (s: AcademicSession | null) => void;
  isArchiveMode: boolean;
  isSessionsLoading: boolean;
  /** Set when admin activates a new session; cleared once the student confirms. */
  pendingActivation: AcademicSession | null;
  /** Call this when the student taps "Confirm & Continue" in the activation modal. */
  confirmActivation: () => void;
  /**
   * Subscribe to payment-update events from the shared SSE connection.
   * Returns an unsubscribe function — call it in a useEffect cleanup.
   * Using this avoids opening a second EventSource for the same endpoint.
   */
  subscribeToPaymentUpdate: (cb: (payload: PaymentUpdatePayload) => void) => () => void;
}

export const SessionViewContext = createContext<SessionViewContextValue>({
  sessions: [],
  selectedSession: null,
  setSelectedSession: () => { /* noop */ },
  isArchiveMode: false,
  isSessionsLoading: true,
  pendingActivation: null,
  confirmActivation: () => { /* noop */ },
  subscribeToPaymentUpdate: () => () => { /* noop */ },
});

export function useSessionView() {
  return useContext(SessionViewContext);
}
