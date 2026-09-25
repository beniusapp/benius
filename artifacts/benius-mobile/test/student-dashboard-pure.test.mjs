import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveStudentPhotoUrl, studentGreetingAt, studentYearAt } from '../lib/student-dashboard-pure.mjs';

test('IST greeting switches exactly at noon, 17:00 and midnight', () => {
  assert.equal(studentGreetingAt(new Date('2025-08-02T06:29:00Z')), 'Good Morning');
  assert.equal(studentGreetingAt(new Date('2025-08-02T06:30:00Z')), 'Good Afternoon');
  assert.equal(studentGreetingAt(new Date('2025-08-02T11:29:00Z')), 'Good Afternoon');
  assert.equal(studentGreetingAt(new Date('2025-08-02T11:30:00Z')), 'Good Evening');
  assert.equal(studentGreetingAt(new Date('2025-08-02T18:29:00Z')), 'Good Evening');
  assert.equal(studentGreetingAt(new Date('2025-08-02T18:30:00Z')), 'Good Morning');
});

test('footer year follows Asia/Kolkata rather than the device clock', () => {
  assert.equal(studentYearAt(new Date('2025-12-31T18:29:00Z')), '2025');
  assert.equal(studentYearAt(new Date('2025-12-31T18:30:00Z')), '2026');
});

test('photo URLs use configured HTTPS origin for uploads and reject unsafe sources', () => {
  assert.equal(resolveStudentPhotoUrl('/uploads/students/ava.jpg', 'school.example'), 'https://school.example/uploads/students/ava.jpg');
  assert.equal(resolveStudentPhotoUrl('https://images.example/ava.jpg', 'school.example'), 'https://images.example/ava.jpg');
  for (const value of ['//evil.example/a.jpg', 'http://images.example/a.jpg', 'file:///secret', 'data:image/png;base64,abc', '/elsewhere/a.jpg', '/uploads/../secret', '/uploads\\evil/a.jpg', 'https://user:pass@images.example/a.jpg', ' https://images.example/a.jpg']) {
    assert.equal(resolveStudentPhotoUrl(value, 'school.example'), null, value);
  }
  assert.equal(resolveStudentPhotoUrl('/uploads/a.jpg', undefined), null);
  assert.equal(resolveStudentPhotoUrl('/uploads/a.jpg', 'school.example/elsewhere'), null);
  assert.equal(resolveStudentPhotoUrl(null, 'school.example'), null);
});