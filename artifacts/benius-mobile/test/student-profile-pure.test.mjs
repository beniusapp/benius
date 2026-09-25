import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { profileForm, profilePhotoPart } from '../lib/student-profile-pure.mjs';

const source = await readFile(new URL('../lib/date.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { formatSchoolProfileDate, formatSchoolInstant } = await import(`data:text/javascript,${encodeURIComponent(compiled)}`);

const student = {
  name: 'Aarav Sharma', rollNumber: 18, fatherName: 'Rajesh Sharma', motherName: null,
  address: 'Jaipur', aadharNumber: null, gender: 'Boy', phone: '9876543210',
  dob: '2011-08-14', enrollmentDate: null, guardianName: null, bloodGroup: null, email: null,
};
test('draft values take precedence and unsaved fields fall back to live student identity', () => {
  const values = profileForm(student, { fullName: 'Aarav S.', fatherName: null, rollNo: '07' });
  assert.equal(values.fullName, 'Aarav S.');
  assert.equal(values.fatherName, 'Rajesh Sharma');
  assert.equal(values.rollNo, '07');
  assert.equal(values.phone, '9876543210');
  assert.equal(values.motherName, '');
  assert.equal(profileForm(student, null).rollNo, '18');
});
test('profile calendar dates do not drift and instants follow India day at UTC boundary', () => {
  assert.equal(formatSchoolProfileDate('2011-08-14'), '14/08/2011');
  assert.equal(formatSchoolProfileDate('2024-04-30T20:00:00Z'), '01/05/2024');
  assert.equal(formatSchoolProfileDate('2024-04-30 20:00:00'), '01/05/2024');
  assert.equal(formatSchoolProfileDate('2024-04-30T18:29:00Z'), '30/04/2024');
  assert.match(formatSchoolInstant('2024-04-30T20:00:00Z'), /1 May 2024.*IST/);
  assert.equal(formatSchoolProfileDate(null), '—');
  assert.equal(formatSchoolProfileDate('2024-02-30'), '—');
  assert.equal(formatSchoolProfileDate('not-a-date'), '—');
});
test('photo part uses actual edited image format and rejects incompatible or unsupported formats', () => {
  assert.deepEqual(profilePhotoPart({ uri: 'file:///cache/crop.png', mimeType: 'image/png' }), {
    uri: 'file:///cache/crop.png', name: 'profile.png', type: 'image/png',
  });
  assert.deepEqual(profilePhotoPart({ uri: 'file:///cache/edit.jpg', mimeType: 'image/jpeg' }), {
    uri: 'file:///cache/edit.jpg', name: 'profile.jpg', type: 'image/jpeg',
  });
  assert.equal(profilePhotoPart({ uri: 'file:///cache/crop.heic', mimeType: 'image/heic' }), null);
  assert.equal(profilePhotoPart({ uri: 'file:///cache/crop.png', mimeType: 'image/jpeg' }), null);
  assert.equal(profilePhotoPart({ uri: 'file:///cache/crop', mimeType: null }), null);
});