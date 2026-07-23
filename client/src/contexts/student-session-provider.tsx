import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SessionViewContext, AcademicSession } from "./session-view-context";

async function fetchSessions(): Promise<AcademicSession[]> {
  const res = await fetch("/api/student/academic-sessions", { credentials: "include" });
  if (res.status === 401) return [];
  if (!res.ok) throw new Error("Failed to load sessions");
  return res.json();
}

export function StudentSessionProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  const { data: sessions = [], isLoading } = useQuery<AcademicSession[]>({
    queryKey: ["/api/student/academic-sessions"],
    queryFn: fetchSessions,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const [selectedSession, setSelectedSession] = useState<AcademicSession | null>(null);

  useEffect(() => {
    if (sessions.length > 0 && !selectedSession) {
      const active = sessions.find((s) => s.isActive) ?? sessions[0];
      setSelectedSession(active);
    }
  }, [sessions, selectedSession]);

  // ── Real-time session activation listener ────────────────────────────────
  // When admin activates a new session, snap the student back to the new
  // active session instantly without a page refresh.
  useEffect(() => {
    const es = new EventSource("/api/events/session-change");
    es.onmessage = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data as string);
        if (data.type === "session-activated") {
          // Reset selection — the useEffect above will pick the new active session
          setSelectedSession(null);
          queryClient.invalidateQueries({ queryKey: ["/api/student/academic-sessions"] });
        }
      } catch { /* malformed event — ignore */ }
    };
    return () => es.close();
  }, [queryClient]);

  const isArchiveMode = selectedSession !== null && selectedSession.isActive === false;

  return (
    <SessionViewContext.Provider
      value={{
        sessions,
        selectedSession,
        setSelectedSession,
        isArchiveMode,
        isSessionsLoading: isLoading,
      }}
    >
      {children}
    </SessionViewContext.Provider>
  );
}
