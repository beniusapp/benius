import { QueryClient, QueryFunction } from "@tanstack/react-query";

/* ─── Archive-mode session tracker ───────────────────────────────────────────
 * admin-dashboard.tsx calls setViewSessionId() whenever the navbar session
 * switcher changes.  apiRequest() then automatically attaches
 * x-view-session-id to every non-GET request so the backend archiveGuard
 * middleware can reject mutations against archived sessions.
 * ─────────────────────────────────────────────────────────────────────────── */
let _viewSessionId: number | null = null;

export function setViewSessionId(id: number | null | undefined) {
  _viewSessionId = id ?? null;
}

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    let message = `${res.status}: ${text}`;
    try {
      const json = JSON.parse(text);
      if (json.error)   message = json.error;
      else if (json.message) message = json.message;
    } catch {}
    throw new Error(message);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const headers: Record<string, string> = {};

  if (data) headers["Content-Type"] = "application/json";

  if (_viewSessionId !== null && MUTATION_METHODS.has(method.toUpperCase())) {
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
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

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
