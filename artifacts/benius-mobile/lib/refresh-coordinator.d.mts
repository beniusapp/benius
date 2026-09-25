export class RefreshIdentityChangedError extends Error {}

export function createRefreshCoordinator<T extends { accessToken: string }>(
  readCurrent: () => Promise<T | null>,
  refresh: (expected: T) => Promise<T>,
  samePrincipal: (current: T, expected: T) => boolean,
): (expected: T) => Promise<T>;