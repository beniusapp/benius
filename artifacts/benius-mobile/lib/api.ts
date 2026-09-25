import { clearApprovedSession, readApprovedSession, saveApprovedSession } from '@/lib/secure-session';

export type Role = 'admin' | 'teacher' | 'student' | 'support_staff';
export type MobileUser = {
  id: number;
  name: string;
  role: Role;
  schoolId: number;
  schoolName: string;
  allowedModules?: string[];
};
export type AuthenticatedSession = {
  state: 'authenticated';
  user: MobileUser;
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
};
export type LoginResult =
  | { state: 'pin_required'; challengeToken: string }
  | { state: 'initialize_required'; challengeToken: string }
  | { state: 'password_change_required' }
  | AuthenticatedSession;
export type AcademicSession = { id: number; schoolId: number; sessionName: string; isActive: boolean };
type PersistedSession = AuthenticatedSession;

export class ApiError extends Error {
  constructor(message: string, public code: 'auth_unavailable' | 'unauthorized' | 'network' | 'timeout' | 'server' | 'cancelled', public status?: number) {
    super(message);
    this.name = 'ApiError';
  }
}

const domain = process.env.EXPO_PUBLIC_DOMAIN;
export const API_BASE_URL = domain ? `https://${domain}/api` : '';
let onUnauthorized: (() => void) | undefined;
export function setUnauthorizedHandler(handler: (() => void) | undefined) { onUnauthorized = handler; }

function getMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;
  const details = payload as { message?: unknown; error?: unknown };
  const message = typeof details.message === 'string' ? details.message : details.error;
  if (typeof message !== 'string' || !message.trim()) return fallback;
  return message.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 300) || fallback;
}

async function readPayload(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return null; }
}

async function send<T>(path: string, method: 'GET' | 'POST', body?: unknown, token?: string): Promise<{ response: Response; payload: T | null }> {
  if (!API_BASE_URL) throw new ApiError('Backend address is not configured.', 'network');
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('API path must be local');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { response, payload: await readPayload(response) as T | null };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (controller.signal.aborted) throw new ApiError('Request timed out. Try again.', 'timeout');
    throw new ApiError('Could not reach BENIUS. Check your connection.', 'network');
  } finally {
    clearTimeout(timeout);
  }
}

function throwResponseError(response: Response, payload: unknown): never {
  const fallback = response.status === 401
    ? 'Your session has expired. Sign in again.'
    : `Request failed (${response.status}).`;
  throw new ApiError(getMessage(payload, fallback), response.status === 401 ? 'unauthorized' : 'server', response.status);
}

function isRole(value: unknown): value is Role {
  return value === 'admin' || value === 'teacher' || value === 'student' || value === 'support_staff';
}

function validatedUser(value: unknown): MobileUser {
  if (!value || typeof value !== 'object') throw new ApiError('The server returned an invalid account profile.', 'server');
  const candidate = value as Partial<MobileUser>;
  if (!Number.isInteger(candidate.id) || !Number.isInteger(candidate.schoolId) || typeof candidate.name !== 'string'
    || typeof candidate.schoolName !== 'string' || !isRole(candidate.role)
    || (candidate.allowedModules !== undefined && (!Array.isArray(candidate.allowedModules) || !candidate.allowedModules.every(item => typeof item === 'string')))) {
    throw new ApiError('The server returned an invalid account profile.', 'server');
  }
  return candidate as MobileUser;
}

let sessionCache: PersistedSession | null | undefined;
let refreshFlight: Promise<PersistedSession> | null = null;

async function readSession(): Promise<PersistedSession | null> {
  if (sessionCache !== undefined) return sessionCache;
  const stored = await readApprovedSession();
  if (!stored) {
    sessionCache = null;
    return null;
  }
  try {
    const parsed = JSON.parse(stored) as PersistedSession;
    if (parsed.state !== 'authenticated' || typeof parsed.accessToken !== 'string' || typeof parsed.refreshToken !== 'string'
      || typeof parsed.accessExpiresAt !== 'string' || !Number.isFinite(Date.parse(parsed.accessExpiresAt))) throw new Error('Invalid session');
    const valid = { ...parsed, user: validatedUser(parsed.user) };
    sessionCache = valid;
    return valid;
  } catch {
    await clearApprovedSession();
    sessionCache = null;
    return null;
  }
}

async function saveSession(session: AuthenticatedSession): Promise<PersistedSession> {
  const user = validatedUser(session.user);
  if (typeof session.accessToken !== 'string' || !session.accessToken || typeof session.refreshToken !== 'string' || !session.refreshToken
    || typeof session.accessExpiresAt !== 'string' || !Number.isFinite(Date.parse(session.accessExpiresAt))) {
    throw new ApiError('The sign-in response was incomplete. Please try again.', 'server');
  }
  const validated = { ...session, user };
  try {
    await saveApprovedSession(JSON.stringify(validated));
  } catch {
    throw new ApiError('Secure device storage is unavailable. Mobile sign-in cannot be saved on this device.', 'auth_unavailable');
  }
  sessionCache = validated;
  return validated;
}

async function refreshSession(): Promise<PersistedSession> {
  if (refreshFlight) return refreshFlight;
  refreshFlight = (async () => {
    const previous = await readSession();
    if (!previous?.refreshToken) {
      sessionCache = null;
      await clearApprovedSession();
      onUnauthorized?.();
      throw new ApiError('Your session has expired. Sign in again.', 'unauthorized', 401);
    }
    const { response, payload } = await send<AuthenticatedSession>('/mobile/auth/refresh', 'POST', { refreshToken: previous.refreshToken });
    if (!response.ok) {
      if (response.status === 401) {
        sessionCache = null;
        await clearApprovedSession();
        onUnauthorized?.();
      }
      throwResponseError(response, payload);
    }
    if (!payload || payload.state !== 'authenticated') throw new ApiError('The server returned an invalid refresh response.', 'server');
    const refreshedUser = validatedUser(payload.user);
    if (refreshedUser.id !== previous.user.id || refreshedUser.schoolId !== previous.user.schoolId || refreshedUser.role !== previous.user.role) {
      sessionCache = null;
      await clearApprovedSession();
      onUnauthorized?.();
      throw new ApiError('The refreshed account did not match this mobile session.', 'unauthorized', 401);
    }
    return saveSession({ ...payload, user: refreshedUser });
  })().finally(() => { refreshFlight = null; });
  return refreshFlight;
}

async function accessToken(): Promise<string | null> {
  const session = await readSession();
  if (!session) return null;
  const expires = Date.parse(session.accessExpiresAt);
  if (!Number.isFinite(expires) || expires <= Date.now() + 30000) {
    return (await refreshSession()).accessToken;
  }
  return session.accessToken;
}

async function authorized<T>(path: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
  const token = await accessToken();
  if (!token) throw new ApiError('A verified mobile session is required.', 'auth_unavailable');
  let { response, payload } = await send<T>(path, method, body, token);
  if (response.status === 401) {
    try {
      const refreshed = await refreshSession();
      ({ response, payload } = await send<T>(path, method, body, refreshed.accessToken));
    } catch (error) {
      if (error instanceof ApiError && error.code === 'unauthorized') onUnauthorized?.();
      throw error;
    }
  }
  if (!response.ok) throwResponseError(response, payload);
  return payload as T;
}

export const authTransport = {
  async restore(): Promise<{ user: MobileUser } | null> {
    const current = await readSession();
    return current ? { user: current.user } : null;
  },
  async login(credentials: { identifier: string; password: string; role: Role }): Promise<LoginResult> {
    const { response, payload } = await send<LoginResult>('/mobile/auth/login', 'POST', credentials);
    if (!response.ok) throwResponseError(response, payload);
    if (!payload || !('state' in payload)) throw new ApiError('The server returned an invalid sign-in response.', 'server');
    if (payload.state === 'authenticated') await saveSession(payload);
    else if (payload.state === 'pin_required' || payload.state === 'initialize_required') {
      if (typeof payload.challengeToken !== 'string' || !payload.challengeToken) throw new ApiError('The server returned an invalid sign-in challenge.', 'server');
    } else if (payload.state !== 'password_change_required') throw new ApiError('The server returned an unsupported sign-in state.', 'server');
    return payload;
  },
  async verifyPin(challengeToken: string, pin: string): Promise<AuthenticatedSession> {
    const { response, payload } = await send<AuthenticatedSession>('/mobile/auth/verify-pin', 'POST', { challengeToken, pin });
    if (!response.ok) throwResponseError(response, payload);
    if (!payload || payload.state !== 'authenticated') throw new ApiError('The server returned an invalid PIN verification response.', 'server');
    return saveSession(payload);
  },
  async initialize(input: { challengeToken: string; newPassword: string; confirmPassword: string; pin: string; confirmPin: string; recoveryEmail: string; recoveryPhone: string }): Promise<AuthenticatedSession> {
    const { response, payload } = await send<AuthenticatedSession>('/mobile/auth/initialize', 'POST', input);
    if (!response.ok) throwResponseError(response, payload);
    if (!payload || payload.state !== 'authenticated') throw new ApiError('The server returned an invalid initialization response.', 'server');
    return saveSession(payload);
  },
  async currentUser(): Promise<MobileUser> {
    return validatedUser(await authorized<MobileUser>('/mobile/auth/me', 'GET'));
  },
  async logout(): Promise<'revoked' | 'invalid'> {
    let token: string | null;
    try {
      token = await accessToken();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'unauthorized') return 'invalid';
      throw error;
    }
    if (!token) return 'invalid';

    let { response, payload } = await send<{ message?: string }>('/mobile/auth/logout', 'POST', {}, token);
    if (response.status === 401) {
      let refreshed: PersistedSession;
      try {
        refreshed = await refreshSession();
      } catch (error) {
        if (error instanceof ApiError && error.code === 'unauthorized') return 'invalid';
        throw error;
      }
      ({ response, payload } = await send<{ message?: string }>('/mobile/auth/logout', 'POST', {}, refreshed.accessToken));
    }
    if (!response.ok) throwResponseError(response, payload);
    sessionCache = null;
    await clearApprovedSession();
    return 'revoked';
  },
  async token(): Promise<string | null> {
    return accessToken();
  },
  async clear(): Promise<void> {
    sessionCache = null;
    await clearApprovedSession();
  },
};

export async function apiGet<T>(path: string, options: { signal?: AbortSignal; sessionId?: number } = {}): Promise<T> {
  // Session selection is deliberately not sent: existing Academic Session APIs are cookie-only.
  void options;
  return authorized<T>(path, 'GET');
}

export const sessionsPath: Record<Exclude<Role, 'support_staff'>, string> = {
  student: '/student/academic-sessions',
  teacher: '/teacher/academic-sessions',
  admin: '/admin/academic-sessions',
};