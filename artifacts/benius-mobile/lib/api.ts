export type Role = 'student' | 'teacher' | 'admin';
export type MobileUser = { id: number; schoolId: number; role: Role; name: string };
export type AcademicSession = { id: number; schoolId: number; sessionName: string; isActive: boolean };
export type AuthTransport = {
  restore(): Promise<{ user: MobileUser; token: string } | null>;
  login(credentials: { identifier: string; password: string; role: Role }): Promise<{ user: MobileUser; token: string }>;
  currentUser(): Promise<MobileUser>;
  logout(): Promise<void>;
  token(): Promise<string | null>;
};

// No native authorization contract has been approved. Never infer a role from local input.
export const authTransport: AuthTransport = {
  restore: async () => null,
  login: async () => { throw new ApiError('Mobile sign-in is not available yet. Use the BENIUS web app.', 'auth_unavailable'); },
  currentUser: async () => { throw new ApiError('No approved mobile current-user endpoint is available.', 'auth_unavailable'); },
  logout: async () => {},
  token: async () => null,
};

export class ApiError extends Error {
  constructor(message: string, public code: 'auth_unavailable' | 'unauthorized' | 'network' | 'timeout' | 'server' | 'cancelled', public status?: number) {
    super(message);
  }
}

const domain = process.env.EXPO_PUBLIC_DOMAIN;
export const API_BASE_URL = domain ? `https://${domain}/api` : '';
let onUnauthorized: (() => void) | undefined;
export function setUnauthorizedHandler(handler: (() => void) | undefined) { onUnauthorized = handler; }

export async function apiGet<T>(path: string, options: { signal?: AbortSignal; sessionId?: number } = {}): Promise<T> {
  if (!API_BASE_URL) throw new ApiError('Backend address is not configured.', 'network');
  const token = await authTransport.token();
  if (!token) throw new ApiError('A verified mobile session is required.', 'auth_unavailable');
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('API path must be local');
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const cancel = () => controller.abort();
    options.signal?.addEventListener('abort', cancel, { once: true });
    try {
      const response = await fetch(`${API_BASE_URL}${path}`, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          ...(options.sessionId === undefined ? {} : { 'X-Academic-Session-Id': String(options.sessionId) }),
        },
      });
      if (response.status === 401) {
        onUnauthorized?.();
        throw new ApiError('Your session has expired. Sign in again.', 'unauthorized', 401);
      }
      if (!response.ok) {
        if (response.status >= 500 && attempt === 0) continue;
        throw new ApiError(`Request failed (${response.status}).`, 'server', response.status);
      }
      return await response.json() as T;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (options.signal?.aborted) throw new ApiError('Request cancelled.', 'cancelled');
      if (controller.signal.aborted) throw new ApiError('Request timed out. Try again.', 'timeout');
      if (attempt === 0) continue;
      throw new ApiError('Could not reach BENIUS. Check your connection.', 'network');
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', cancel);
    }
  }
  throw new ApiError('Request failed.', 'server');
}

export const sessionsPath: Record<Role, string> = {
  student: '/student/academic-sessions',
  teacher: '/teacher/academic-sessions',
  admin: '/admin/academic-sessions',
};