import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SessionViewContext, AcademicSession, PaymentUpdatePayload } from "./session-view-context";
import { setViewSessionId } from "@/lib/queryClient";

const STUDENT_SELECTED_SESSION_KEY = "student-selected-session-id";

async function fetchSessions(): Promise<AcademicSession[]> {
  const res = await fetch("/api/student/academic-sessions", { credentials: "include" });
  if (res.status === 401) return [];
  if (!res.ok) throw new Error("Failed to load sessions");
  return res.json();
}

export function StudentSessionProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  // ── Payment-update pub/sub ───────────────────────────────────────────────
  // Pages that need payment-update events (e.g. student-fees) subscribe here
  // instead of opening a second EventSource to the same endpoint.
  const paymentUpdateSubscribers = useRef<Set<(payload: PaymentUpdatePayload) => void>>(new Set());

  const subscribeToPaymentUpdate = useCallback(
    (cb: (payload: PaymentUpdatePayload) => void) => {
      paymentUpdateSubscribers.current.add(cb);
      return () => { paymentUpdateSubscribers.current.delete(cb); };
    },
    [],
  );

  const { data: sessions = [], isLoading } = useQuery<AcademicSession[]>({
    queryKey: ["/api/student/academic-sessions"],
    queryFn: fetchSessions,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const [selectedSession, setSelectedSession] = useState<AcademicSession | null>(null);
  // Keep the request transport synchronized before React exposes the new
  // cache identity to children. A passive effect here would allow a
  // session-keyed query to render with the previous request header.
  const handleSetSelectedSession = useCallback((session: AcademicSession | null) => {
    if (typeof window !== "undefined") {
      if (session) {
        window.sessionStorage.setItem(STUDENT_SELECTED_SESSION_KEY, String(session.id));
      } else {
        window.sessionStorage.removeItem(STUDENT_SELECTED_SESSION_KEY);
      }
    }
    setViewSessionId(session?.id ?? null);
    setSelectedSession(session);
  }, []);

  // Restore the student's deliberate selection after navigation/provider
  // remounts. It is accepted only when it belongs to the freshly loaded
  // school session list; otherwise the active session is the safe fallback.
  useEffect(() => {
    if (sessions.length > 0 && !selectedSession) {
      const persistedId = typeof window === "undefined"
        ? null
        : Number(window.sessionStorage.getItem(STUDENT_SELECTED_SESSION_KEY));
      const persistedSession = Number.isInteger(persistedId)
        ? sessions.find((session) => session.id === persistedId)
        : undefined;
      const nextSession = persistedSession ?? sessions.find((session) => session.isActive) ?? sessions[0];
      handleSetSelectedSession(nextSession);
    }
  }, [sessions, selectedSession, handleSetSelectedSession]);

  // ── Pending activation — shown as a blocking modal before switching ──────
  const [pendingActivation, setPendingActivation] = useState<AcademicSession | null>(null);

  // Called when the student taps "Confirm & Continue"
  const confirmActivation = useCallback(() => {
    setPendingActivation(null);
    handleSetSelectedSession(null); // session-list effect will pick the new active session
    queryClient.invalidateQueries({ queryKey: ["/api/student/academic-sessions"] });
    // Also bust all session-scoped module caches so they refetch for the new session
    queryClient.invalidateQueries({ queryKey: ["/api/student/attendance"] });
    queryClient.invalidateQueries({ queryKey: ["/api/student/homework"] });
    queryClient.invalidateQueries({ queryKey: ["/api/student/notices"] });
    queryClient.invalidateQueries({ queryKey: ["/api/student/fees"] });
    queryClient.invalidateQueries({ queryKey: ["/api/student/exam"] });
    queryClient.invalidateQueries({ queryKey: ["/api/student/complaints"] });
    queryClient.invalidateQueries({ queryKey: ["/api/student/leave"] });
    queryClient.invalidateQueries({ queryKey: ["/api/student/timetable"] });
    queryClient.invalidateQueries({ queryKey: ["/api/student/classwork"] });
  }, [queryClient, handleSetSelectedSession]);

  // ── Real-time session activation listener ────────────────────────────────
  // Single shared EventSource for the browser tab.  All SSE event types are
  // handled here; pages subscribe via context rather than opening extra sockets.
  useEffect(() => {
    const es = new EventSource("/api/events/session-change");
    es.onmessage = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data as string);
        if (data.type === "session-activated") {
          // Fetch the new session list so we can show the session name in the modal
          fetchSessions().then((freshSessions) => {
            const newActive = freshSessions.find((s) => s.id === data.sessionId) ??
              freshSessions.find((s) => s.isActive) ??
              null;
            queryClient.setQueryData(["/api/student/academic-sessions"], freshSessions);
            if (newActive) {
              setPendingActivation(newActive);
            } else {
              // Fallback: auto-switch without modal
              handleSetSelectedSession(null);
              queryClient.invalidateQueries({ queryKey: ["/api/student/academic-sessions"] });
            }
          });
        } else if (data.type === "session-deleted") {
          // Session deleted — silently refresh and snap to active
          handleSetSelectedSession(null);
          queryClient.invalidateQueries({ queryKey: ["/api/student/academic-sessions"] });
        } else if (data.type === "payment-update") {
          // Fan out to any subscribed pages (e.g. student-fees) so they can
          // invalidate their caches without opening a second EventSource.
          const payload: PaymentUpdatePayload = {
            feeRecordId: data.feeRecordId,
            receiptNumber: data.receiptNumber,
          };
          paymentUpdateSubscribers.current.forEach((cb) => cb(payload));
        }
      } catch { /* malformed event — ignore */ }
    };
    return () => es.close();
  }, [queryClient, handleSetSelectedSession]);

  const isArchiveMode = selectedSession !== null && selectedSession.isActive === false;

  return (
    <SessionViewContext.Provider
      value={{
        sessions,
        selectedSession,
        setSelectedSession: handleSetSelectedSession,
        isArchiveMode,
        isSessionsLoading: isLoading,
        pendingActivation,
        confirmActivation,
        subscribeToPaymentUpdate,
      }}
    >
      {children}
    </SessionViewContext.Provider>
  );
}
