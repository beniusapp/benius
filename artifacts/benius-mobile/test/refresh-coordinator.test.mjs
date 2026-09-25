import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRefreshCoordinator,
  RefreshIdentityChangedError,
} from '../lib/refresh-coordinator.mjs';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function session(accessToken, userId = 41) {
  return {
    accessToken,
    user: { id: userId, schoolId: 7, role: 'teacher' },
  };
}

function samePrincipal(left, right) {
  return left.user.id === right.user.id
    && left.user.schoolId === right.user.schoolId
    && left.user.role === right.user.role;
}

test('overlapping and delayed 401s share one refresh generation', async () => {
  let current = session('access-old');
  let refreshCalls = 0;
  const started = deferred();
  const result = deferred();
  const refreshFor = createRefreshCoordinator(
    async () => current,
    async () => {
      refreshCalls += 1;
      started.resolve();
      current = await result.promise;
      return current;
    },
    samePrincipal,
  );

  const requestA = refreshFor(session('access-old'));
  const requestB = refreshFor(session('access-old'));
  await started.promise;
  assert.equal(refreshCalls, 1);

  result.resolve(session('access-new'));
  const [a, b] = await Promise.all([requestA, requestB]);
  assert.equal(a.accessToken, 'access-new');
  assert.equal(b.accessToken, 'access-new');

  // A request sent with the old token can return 401 after the flight settled.
  const lateRequest = await refreshFor(session('access-old'));
  assert.equal(lateRequest.accessToken, 'access-new');
  assert.equal(refreshCalls, 1);
});

test('does not share an in-flight refresh across authenticated principals', async () => {
  let current = session('access-old');
  const started = deferred();
  const result = deferred();
  const refreshFor = createRefreshCoordinator(
    async () => current,
    async () => {
      started.resolve();
      current = await result.promise;
      return current;
    },
    samePrincipal,
  );

  const first = refreshFor(session('access-old', 41));
  await started.promise;
  await assert.rejects(
    refreshFor(session('access-other', 42)),
    RefreshIdentityChangedError,
  );
  result.resolve(session('access-new', 41));
  assert.equal((await first).accessToken, 'access-new');
});

test('releases the flight after a failed refresh so a later attempt can retry', async () => {
  let current = session('access-old');
  let refreshCalls = 0;
  const refreshFor = createRefreshCoordinator(
    async () => current,
    async () => {
      refreshCalls += 1;
      if (refreshCalls === 1) throw new Error('temporary refresh failure');
      current = session('access-new');
      return current;
    },
    samePrincipal,
  );

  await assert.rejects(refreshFor(session('access-old')), /temporary refresh failure/);
  assert.equal((await refreshFor(session('access-old'))).accessToken, 'access-new');
  assert.equal(refreshCalls, 2);
});