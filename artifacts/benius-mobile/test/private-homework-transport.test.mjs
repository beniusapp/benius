import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as download from '../lib/private-homework-download.mjs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const apiFile = resolve(fileURLToPath(new URL('../lib/api.ts', import.meta.url)));
const uuid = 'a2345678-abcd-4def-8abc-0123456789ab';
const session = JSON.stringify({
  state: 'authenticated',
  user: { id: 71, name: 'Student', role: 'student', schoolId: 12, schoolName: 'School' },
  accessToken: 'secret-test-token', refreshToken: 'refresh-test-token',
  accessExpiresAt: '2099-01-01T00:00:00.000Z',
});

// Execute the actual lib/api.ts function with only its secure-store and refresh
// dependencies isolated; this catches regressions in the real transport guard.
function loadApi() {
  process.env.EXPO_PUBLIC_DOMAIN = 'school.example.com';
  const source = readFileSync(apiFile, 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = new Module(apiFile);
  mod.filename = apiFile;
  mod.paths = Module._nodeModulePaths(resolve(apiFile, '..'));
  const originalRequire = mod.require.bind(mod);
  mod.require = name => {
    if (name === '@/lib/secure-session') return {
      readApprovedSession: async () => session,
      saveApprovedSession: async () => {},
      clearApprovedSession: async () => {},
    };
    if (name === '@/lib/refresh-coordinator.mjs') return {
      createRefreshCoordinator: (_read, refresh) => refresh,
      RefreshIdentityChangedError: class extends Error {},
    };
    if (name === '@/lib/private-homework-download.mjs') return download;
    return originalRequire(name);
  };
  mod._compile(js, apiFile);
  return mod.exports;
}

test('actual authenticated binary transport accepts complete UUID and GETs without URL tokens', async () => {
  const api = loadApi();
  const path = download.classifyHomeworkFile(`/api/mobile/homework-submission-files/${uuid}.pdf`, 'school.example.com').path;
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(Uint8Array.from([37, 80, 68, 70, 45, 10]), { status: 200, headers: { 'content-type': 'application/pdf' } });
  };
  try {
    const result = await api.apiGetPrivateHomeworkFile(path, 42);
    assert.deepEqual(Array.from(result.bytes), [37, 80, 68, 70, 45, 10]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `https://school.example.com/api/mobile/homework-submission-files/${uuid}.pdf`);
    assert.equal(calls[0].options.method, 'GET');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer secret-test-token');
    assert.equal(calls[0].options.headers['x-view-session-id'], '42');
    assert.equal(calls[0].url.includes('secret-test-token'), false);
  } finally { globalThis.fetch = originalFetch; }
});

test('actual transport rejects incomplete UUID, spoofed host and query before any request', async () => {
  const api = loadApi();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw Error('must not fetch'); };
  try {
    for (const path of [
      '/mobile/homework-submission-files/a2345678-abcd-4def-8abc.pdf',
      `https://evil.example.com/api/mobile/homework-submission-files/${uuid}.pdf`,
      `/mobile/homework-submission-files/${uuid}.pdf?token=secret`,
      `/mobile/homework-submission-files/${uuid}.svg`,
    ]) {
      await assert.rejects(api.apiGetPrivateHomeworkFile(path, 42), /Invalid private homework file address/);
    }
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; }
});