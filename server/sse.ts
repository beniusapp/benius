import type { Response } from "express";

// ── SSE broadcaster ──────────────────────────────────────────────────────────
// Maintains a map of schoolId → Set<Response> for all connected SSE clients.
// When admin activates a session, broadcastSessionActivated() pushes the event
// to every teacher and student connected for that school — no polling needed.

const clients = new Map<number, Set<Response>>();

/** Register an SSE response for a school. Cleans itself up on disconnect. */
export function addSSEClient(schoolId: number, res: Response): void {
  if (!clients.has(schoolId)) clients.set(schoolId, new Set());
  const schoolClients = clients.get(schoolId)!;
  schoolClients.add(res);
  res.on("close", () => {
    schoolClients.delete(res);
    if (schoolClients.size === 0) clients.delete(schoolId);
  });
}

/** Push a session-activated event to all connected clients for a school. */
export function broadcastSessionActivated(
  schoolId: number,
  payload: { sessionId: number; sessionName: string }
): void {
  const schoolClients = clients.get(schoolId);
  if (!schoolClients || schoolClients.size === 0) return;
  const data = JSON.stringify({ type: "session-activated", ...payload });
  for (const res of [...schoolClients]) {
    try {
      res.write(`data: ${data}\n\n`);
    } catch {
      schoolClients.delete(res);
    }
  }
}
