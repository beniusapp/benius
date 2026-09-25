export class RefreshIdentityChangedError extends Error {
  constructor() {
    super('The authenticated account changed while refreshing.');
    this.name = 'RefreshIdentityChangedError';
  }
}

/**
 * Coordinates refresh attempts for one authenticated principal. A request that
 * receives a late 401 after rotation reuses the newer access credential instead
 * of rotating the refresh credential a second time.
 */
export function createRefreshCoordinator(readCurrent, refresh, samePrincipal) {
  let flight = null;

  async function useExistingFlight(expected, existing) {
    if (!samePrincipal(existing.expected, expected)) {
      throw new RefreshIdentityChangedError();
    }

    const current = await readCurrent();
    if (!current || !samePrincipal(current, expected)) {
      throw new RefreshIdentityChangedError();
    }
    if (current.accessToken !== expected.accessToken) return current;
    return existing.promise;
  }

  return async function refreshFor(expected) {
    if (flight) return useExistingFlight(expected, flight);

    const current = await readCurrent();
    if (current) {
      if (!samePrincipal(current, expected)) throw new RefreshIdentityChangedError();
      if (current.accessToken !== expected.accessToken) return current;
    }

    // Another caller may have started a refresh while readCurrent was pending.
    if (flight) return useExistingFlight(expected, flight);

    const record = {
      expected,
      promise: Promise.resolve().then(() => refresh(expected)),
    };
    flight = record;

    try {
      return await record.promise;
    } finally {
      if (flight === record) flight = null;
    }
  };
}