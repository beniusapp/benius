import { test } from 'node:test';
import assert from 'node:assert/strict';
import { binaryWithRefresh, classifyHomeworkFile, validDownload } from '../lib/private-homework-download.mjs';
const uuid = 'a2345678-abcd-4def-8abc-0123456789ab';
const file = `/api/mobile/homework-submission-files/${uuid}.pdf`;
test('only first-party private GET paths or legacy upload URLs are accepted', () => {
  assert.deepEqual(classifyHomeworkFile(file, 'school.example.com'), { kind: 'private', url: `https://school.example.com${file}`, path: file.slice(4), extension: 'pdf' });
  assert.equal(classifyHomeworkFile(`/uploads/homework-submissions/${uuid}.png`, 'school.example.com')?.kind, 'legacy');
  for (const unsafe of [`https://elsewhere.test${file}`, `//elsewhere.test${file}`, `${file}?token=abc`, `${file}#a`, '/api/mobile/homework-submission-files/not-a-uuid.pdf', '/api/mobile/auth/me', '/uploads/../api/mobile/auth/me', 'javascript:alert(1)', `https://school.example.com.evil.test${file}`]) {
    assert.equal(classifyHomeworkFile(unsafe, 'school.example.com'), null, unsafe);
  }
});
test('binary request refreshes exactly once after 401; preserves errors and identity changes', async () => {
  const calls = [];
  const result = await binaryWithRefresh('old', async token => { calls.push(token); return { status: token === 'old' ? 401 : 200 }; }, async token => {
    assert.equal(token, 'old'); return 'new';
  }, () => true);
  assert.equal(result.status, 200);
  assert.deepEqual(calls, ['old', 'new']);
  assert.equal((await binaryWithRefresh('old', async () => ({ status: 403 }), () => { throw Error('must not refresh'); }, () => true)).status, 403);
  await assert.rejects(binaryWithRefresh('old', async () => ({ status: 401 }), async () => { throw Error('refresh denied'); }, () => true), /refresh denied/);
  let current = true;
  await assert.rejects(binaryWithRefresh('old', async () => { current = false; return { status: 200 }; }, async () => 'new', () => current), /Account changed/);
});
test('download size, MIME and magic bytes must agree', () => {
  assert.equal(validDownload(new Uint8Array([37,80,68,70,45,65]), 'pdf', 'application/pdf'), true);
  assert.equal(validDownload(new Uint8Array([37,80,68,70,45,65]), 'pdf', 'text/html'), false);
  assert.equal(validDownload(new Uint8Array([60,104,116,109,108]), 'pdf', 'application/pdf'), false);
  assert.equal(validDownload(new Uint8Array(12 * 1024 * 1024 + 1), 'pdf', 'application/pdf'), false);
});