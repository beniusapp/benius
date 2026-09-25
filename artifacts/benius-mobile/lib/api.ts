import { clearApprovedSession, readApprovedSession, saveApprovedSession } from '@/lib/secure-session';
import { createRefreshCoordinator, RefreshIdentityChangedError } from '@/lib/refresh-coordinator.mjs';
import { binaryWithRefresh, MAX_HOMEWORK_DOWNLOAD_BYTES, validDownload, validPrivateHomeworkApiPath } from '@/lib/private-homework-download.mjs';

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
  | { state: 'password_change_required'; challengeToken: string }
  | AuthenticatedSession;
export type AcademicSession = { id: number; schoolId: number; sessionName: string; isActive: boolean; startDate?: string; endDate?: string };
export type AcademicSessionsResponse = { sessions: AcademicSession[]; activeSessionId: number | null };
export type AcademicSessionSelectionResponse = { session: AcademicSession };
type PersistedSession = AuthenticatedSession;
type RequestOptions = { signal?: AbortSignal; sessionId?: number };

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

async function send<T>(path: string, method: 'GET' | 'POST', body?: unknown, token?: string, options: RequestOptions = {}): Promise<{ response: Response; payload: T | null }> {
  if (!API_BASE_URL) throw new ApiError('Backend address is not configured.', 'network');
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('API path must be local');
  if (options.sessionId !== undefined && (!Number.isSafeInteger(options.sessionId) || options.sessionId <= 0)) {
    throw new Error('Academic session id must be a positive integer.');
  }
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  if (options.signal?.aborted) abortFromCaller();
  else options.signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(body === undefined || body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.sessionId === undefined ? {} : { 'x-view-session-id': String(options.sessionId) }),
      },
      ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
    });
    return { response, payload: await readPayload(response) as T | null };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (options.signal?.aborted) throw new ApiError('Request was cancelled.', 'cancelled');
    if (controller.signal.aborted) throw new ApiError('Request timed out. Try again.', 'timeout');
    throw new ApiError('Could not reach BENIUS. Check your connection.', 'network');
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abortFromCaller);
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
let authGeneration = 0;
export function isCurrentAuthGeneration(value: number): boolean { return value === authGeneration; }

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

async function saveSession(session: AuthenticatedSession, isRefresh = false): Promise<PersistedSession> {
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
  if (!isRefresh) authGeneration++;
  return validated;
}

function samePrincipal(left: PersistedSession, right: PersistedSession): boolean {
  return left.user.id === right.user.id
    && left.user.schoolId === right.user.schoolId
    && left.user.role === right.user.role;
}

const coordinatedRefresh = createRefreshCoordinator<PersistedSession>(
  readSession,
  async (expected) => {
    const previous = await readSession();
    if (!previous?.refreshToken) {
      sessionCache = null;
      await clearApprovedSession();
      onUnauthorized?.();
      throw new ApiError('Your session has expired. Sign in again.', 'unauthorized', 401);
    }
    if (!samePrincipal(previous, expected)) {
      throw new ApiError('The authenticated account changed; this request was not retried.', 'cancelled');
    }
    if (previous.accessToken !== expected.accessToken || previous.refreshToken !== expected.refreshToken) {
      return previous;
    }
    const { response, payload } = await send<AuthenticatedSession>('/mobile/auth/refresh', 'POST', { refreshToken: previous.refreshToken });
    if (!response.ok) {
      if (response.status === 401) {
        const current = await readSession();
        if (current && !samePrincipal(current, previous)) {
          throw new ApiError('The authenticated account changed; this request was not retried.', 'cancelled');
        }
        if (current && samePrincipal(current, previous)
          && (current.accessToken !== previous.accessToken || current.refreshToken !== previous.refreshToken)) {
          return current;
        }
        sessionCache = null;
        authGeneration++;
        await clearApprovedSession();
        onUnauthorized?.();
      }
      throwResponseError(response, payload);
    }
    if (!payload || payload.state !== 'authenticated') throw new ApiError('The server returned an invalid refresh response.', 'server');
    const refreshedUser = validatedUser(payload.user);
    const current = await readSession();
    if (!current || !samePrincipal(current, previous)) {
      throw new ApiError('The authenticated account changed; this request was not retried.', 'cancelled');
    }
    if (current.accessToken !== previous.accessToken || current.refreshToken !== previous.refreshToken) {
      return current;
    }
    if (refreshedUser.id !== previous.user.id || refreshedUser.schoolId !== previous.user.schoolId || refreshedUser.role !== previous.user.role) {
      sessionCache = null;
      await clearApprovedSession();
      onUnauthorized?.();
      throw new ApiError('The refreshed account did not match this mobile session.', 'unauthorized', 401);
    }
    return saveSession({ ...payload, user: refreshedUser }, true);
  },
  samePrincipal,
);

async function refreshSession(expected: PersistedSession): Promise<PersistedSession> {
  try {
    return await coordinatedRefresh(expected);
  } catch (error) {
    if (error instanceof RefreshIdentityChangedError) {
      throw new ApiError('The authenticated account changed; this request was not retried.', 'cancelled');
    }
    throw error;
  }
}

async function accessSession(): Promise<PersistedSession | null> {
  const session = await readSession();
  if (!session) return null;
  const expires = Date.parse(session.accessExpiresAt);
  if (!Number.isFinite(expires) || expires <= Date.now() + 30000) {
    return refreshSession(session);
  }
  return session;
}

async function accessToken(): Promise<string | null> {
  return (await accessSession())?.accessToken ?? null;
}

async function clearRejectedSession(expected: PersistedSession): Promise<void> {
  const current = await readSession();
  if (!current || current.accessToken !== expected.accessToken || !samePrincipal(current, expected)) return;
  sessionCache = null;
  authGeneration++;
  await clearApprovedSession();
  onUnauthorized?.();
}

async function authorized<T>(path: string, method: 'GET' | 'POST', body?: unknown, options: RequestOptions = {}): Promise<T> {
  const session = await accessSession();
  if (!session) throw new ApiError('A verified mobile session is required.', 'auth_unavailable');
  let { response, payload } = await send<T>(path, method, body, session.accessToken, options);
  if (response.status === 401) {
    const refreshed = await refreshSession(session);
    ({ response, payload } = await send<T>(path, method, body, refreshed.accessToken, options));
    if (response.status === 401) {
      await clearRejectedSession(refreshed);
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
    } else if (payload.state === 'password_change_required') {
      if (typeof payload.challengeToken !== 'string' || !payload.challengeToken) throw new ApiError('The server returned an invalid password-change challenge.', 'server');
    } else throw new ApiError('The server returned an unsupported sign-in state.', 'server');
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
  async changeTeacherFirstLoginPassword(input: { challengeToken: string; currentPassword: string; newPassword: string; confirmPassword: string }): Promise<void> {
    const { response, payload } = await send<{ state?: string }>('/mobile/auth/teacher/change-password', 'POST', input);
    if (!response.ok) throwResponseError(response, payload);
    if (!payload || payload.state !== 'password_changed') throw new ApiError('The server returned an invalid password-change response.', 'server');
  },
  async currentUser(): Promise<MobileUser> {
    return validatedUser(await authorized<MobileUser>('/mobile/auth/me', 'GET'));
  },
  async logout(): Promise<'revoked' | 'invalid'> {
    let session: PersistedSession | null;
    try {
      session = await accessSession();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'unauthorized') return 'invalid';
      throw error;
    }
    if (!session) return 'invalid';

    let { response, payload } = await send<{ message?: string }>('/mobile/auth/logout', 'POST', {}, session.accessToken);
    if (response.status === 401) {
      let refreshed: PersistedSession;
      try {
        refreshed = await refreshSession(session);
      } catch (error) {
        if (error instanceof ApiError && error.code === 'unauthorized') return 'invalid';
        throw error;
      }
      ({ response, payload } = await send<{ message?: string }>('/mobile/auth/logout', 'POST', {}, refreshed.accessToken));
    }
    if (!response.ok) throwResponseError(response, payload);
    sessionCache = null;
    authGeneration++;
    await clearApprovedSession();
    return 'revoked';
  },
  async token(): Promise<string | null> {
    return accessToken();
  },
  async clear(): Promise<void> {
    sessionCache = null;
    authGeneration++;
    await clearApprovedSession();
  },
};

export async function apiGet<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return authorized<T>(path, 'GET', undefined, options);
}

/** Identity-scoped mobile mutations; no academic-session header. */
export async function apiPost<T>(path: string, body?: unknown, options: Pick<RequestOptions, 'signal'> = {}): Promise<T> {
  return authorized<T>(path, 'POST', body, options);
}

type SessionRequestOptions = Pick<RequestOptions, 'signal'>;

export async function apiGetForSession<T>(
  path: string,
  sessionId: number,
  options: SessionRequestOptions = {},
): Promise<T> {
  return authorized<T>(path, 'GET', undefined, { ...options, sessionId });
}

export async function apiPostForSession<T>(
  path: string,
  sessionId: number,
  body: unknown,
  options: SessionRequestOptions = {},
): Promise<T> {
  return authorized<T>(path, 'POST', body, { ...options, sessionId });
}

async function readBoundedHomeworkBytes(response: Response, signal?: AbortSignal): Promise<Uint8Array> {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_HOMEWORK_DOWNLOAD_BYTES)
    throw new ApiError('The file is too large to open on this device.', 'server');
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > MAX_HOMEWORK_DOWNLOAD_BYTES) throw new ApiError('The file is too large to open on this device.', 'server');
    return bytes;
  }
  let timedOut = false;
  const abort = () => { void reader.cancel(); };
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => { timedOut = true; abort(); }, 20_000);
  try {
    let total = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (signal?.aborted) throw new ApiError('Download cancelled.', 'cancelled');
      if (timedOut) throw new ApiError('Download timed out. Try again.', 'timeout');
      if (done) break;
      total += value.byteLength;
      if (total > MAX_HOMEWORK_DOWNLOAD_BYTES) throw new ApiError('The file is too large to open on this device.', 'server');
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
    try { await reader.cancel(); } catch { /* Reader may already be closed. */ }
  }
}

/** GET-only, bounded binary download. Tokens stay exclusively in the Authorization header. */
export async function apiGetPrivateHomeworkFile(
  path: string,
  sessionId: number,
  options: { signal?: AbortSignal } = {},
): Promise<{ bytes: Uint8Array; generation: number }> {
  if (!validPrivateHomeworkApiPath(path))
    throw new ApiError('Invalid private homework file address.', 'server');
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0) throw new ApiError('Academic session required.', 'auth_unavailable');
  const initial = await accessSession();
  if (!initial) throw new ApiError('A verified mobile session is required.', 'auth_unavailable');
  const generation = authGeneration;
  const current = () => isCurrentAuthGeneration(generation) && !options.signal?.aborted;
  const sendBinary = async (session: PersistedSession): Promise<Response> => {
    if (!current() || !samePrincipal(initial, session)) throw new ApiError('Account changed during download.', 'cancelled');
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, 20_000);
    try {
      if (!API_BASE_URL) throw new ApiError('Backend address is not configured.', 'network');
      return await fetch(`${API_BASE_URL}${path}`, {
        method: 'GET', signal: controller.signal,
        headers: { Accept: 'image/jpeg, image/png, image/webp, application/pdf',
          Authorization: `Bearer ${session.accessToken}`, 'x-view-session-id': String(sessionId) },
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (options.signal?.aborted || !current()) throw new ApiError('Download cancelled.', 'cancelled');
      if (controller.signal.aborted) throw new ApiError('Download timed out. Try again.', 'timeout');
      throw new ApiError('Could not download the file. Check your connection.', 'network');
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abort);
    }
  };
  let response: Response;
  try {
    response = await binaryWithRefresh(initial, sendBinary, refreshSession, current);
  } catch (error) {
    if (!current()) throw new ApiError('Download cancelled after account change.', 'cancelled');
    throw error;
  }
  if (response.status === 401) await clearRejectedSession((await readSession()) ?? initial);
  if (!response.ok) throwResponseError(response, await readPayload(response));
  const liveSession = await readSession();
  if (!current() || !liveSession || !samePrincipal(initial, liveSession))
    throw new ApiError('Account changed during download.', 'cancelled');
  const bytes = await readBoundedHomeworkBytes(response, options.signal);
  const extension = path.split('.').pop()!.toLowerCase();
  if (!current()) throw new ApiError('Download cancelled after account change.', 'cancelled');
  if (!validDownload(bytes, extension, response.headers.get('content-type')))
    throw new ApiError('The server returned an unsupported or invalid file.', 'server');
  return { bytes, generation };
}