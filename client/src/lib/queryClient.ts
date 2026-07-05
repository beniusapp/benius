import { QueryClient, QueryFunction } from "@tanstack/react-query";

/* ─── Active view-session tracker ────────────────────────────────────────────
 * admin-dashboard.tsx calls setViewSessionId() whenever the navbar session
 * switcher changes.  Every outgoing HTTP request — GET and mutations alike —
 * then automatically carries x-view-session-id so the backend
 * checkSessionContext middleware can:
 *   • Attach req.viewSessionId for route handlers to scope their DB queries.
 *   • Reject mutations against archived (is_active = false) sessions → 403.
 * ─────────────────────────────────────────────────────────────────────────── */
let _viewSessionId: number | null = null;

/** Call this whenever the admin switches the active view session. */
export function setViewSessionId(id: number | null | undefined) {
  _viewSessionId = id ?? null;
}

/* ─── Session-aware fetch ────────────────────────────────────────────────────
 * Drop-in replacement for fetch() that always injects x-view-session-id
 * when a session has been selected.  Used by:
 *   • getQueryFn  → every useQuery() GET request.
 *   • Custom queryFn blocks in dashboard / module components.
 * This ensures the backend checkSessionContext middleware can read the header
 * on ALL requests, not just mutations.
 * ─────────────────────────────────────────────────────────────────────────── */
export function sessionFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const base = (init.headers ?? {}) as Record<string, string>;
  const headers: Record<string, string> = { ...base };
  if (_viewSessionId !== null) {
    headers["x-view-session-id"] = String(_viewSessionId);
  }
  return fetch(url, { credentials: "include", ...init, headers });
}

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    let message = `${res.status}: ${text}`;
    try {
      const json = JSON.parse(text);
      if (json.error)        message = json.error;
      else if (json.message) message = json.message;
    } catch {}
    throw new Error(message);
  }
}

/* ─── apiRequest — used for all mutations (POST / PUT / PATCH / DELETE) ──── */
export async function apiRequest(
  method: string,
  url: string,
  data?: unknown,
): Promise<Response> {
  const headers: Record<string, string> = {};

  if (data) headers["Content-Type"] = "application/json";

  // Always send x-view-session-id on every outgoing request so the backend
  // checkSessionContext middleware can validate the session context regardless
  // of HTTP method.
  if (_viewSessionId !== null) {
    headers["x-view-session-id"] = String(_viewSessionId);
  }

  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";

/* ─── Default query function — underpins every useQuery() call ───────────── */
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    // sessionFetch injects x-view-session-id on every GET so the backend
    // checkSessionContext middleware sets req.viewSessionId, allowing any
    // route handler to scope its database query to the correct academic year.
    const res = await sessionFetch(queryKey.join("/") as string);

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
