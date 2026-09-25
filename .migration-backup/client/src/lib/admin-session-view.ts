export interface ViewSession {
  id: number;
  isActive: boolean;
}

export function updateAdminSessionList<T extends ViewSession & { status?: string }>(
  current: T[] | undefined,
  activated: T,
): T[] | undefined {
  if (!Array.isArray(current)) return current;

  return current.map((item) => (
    item.id === activated.id
      ? { ...item, ...activated }
      : { ...item, isActive: false, ...(item.status !== undefined ? { status: "archived" } : {}) }
  ));
}

const SESSION_SCOPED_QUERY_PREFIXES = [
  "/api/attendance",
  "/api/leave",
  "/api/student-leaves",
  "/api/complaints",
  "/api/visitor-logs",
  "/api/notices",
  "/api/timetable",
  "/api/exams",
  "/api/exam",
  "/api/classwork",
  "/api/homework",
  "/api/admin/calendar",
  "/api/admin/audit-logs",
];

/**
 * Legacy Admin Portal module queries obtain their scope from the view-session
 * header rather than an explicit session ID in their query key. Only these
 * endpoints are reset when the selector changes; school-global caches remain.
 */
export function isLegacyAdminSessionQueryKey(queryKey: readonly unknown[]): boolean {
  const endpoint = queryKey[0];
  return typeof endpoint === "string"
    && SESSION_SCOPED_QUERY_PREFIXES.some((prefix) => endpoint.startsWith(prefix));
}

/**
 * Reconcile the selected session against the latest tenant-scoped session list.
 * A valid manual archive selection is retained; missing/deleted selections fall
 * back to the active session, then the newest returned session.
 */
export function resolveAdminViewSession<T extends ViewSession>(
  sessions: readonly T[],
  selected: T | null,
): T | null {
  if (sessions.length === 0) return null;

  const refreshedSelection = selected
    ? sessions.find((session) => session.id === selected.id)
    : undefined;

  return refreshedSelection
    ?? sessions.find((session) => session.isActive)
    ?? sessions[0];
}

export interface SessionDropdownPlacement {
  direction: "up" | "down";
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
}

export function getSessionDropdownPlacement(
  trigger: Pick<DOMRect, "top" | "bottom" | "right">,
  viewport: { width: number; height: number },
  preferredWidth = 256,
  preferredHeight = 360,
): SessionDropdownPlacement {
  const edge = 8;
  const gap = 8;
  const width = Math.max(160, Math.min(preferredWidth, viewport.width - edge * 2));
  const left = Math.min(
    Math.max(edge, trigger.right - width),
    Math.max(edge, viewport.width - width - edge),
  );
  const below = Math.max(0, viewport.height - trigger.bottom - gap - edge);
  const above = Math.max(0, trigger.top - gap - edge);
  const opensUp = below < preferredHeight && above > below;

  if (opensUp) {
    return {
      direction: "up",
      left,
      width,
      bottom: Math.max(edge, viewport.height - trigger.top + gap),
      maxHeight: above,
    };
  }

  return {
    direction: "down",
    left,
    width,
    top: Math.min(viewport.height - edge, trigger.bottom + gap),
    maxHeight: below,
  };
}