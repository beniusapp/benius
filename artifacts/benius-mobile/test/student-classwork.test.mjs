import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classworkResource, safeClassworkUrl, classworkDateAllowed } from '../lib/student-classwork-pure.mjs';
import { istToday, weekDates, monthGrid } from '../lib/student-homework-pure.mjs';

test('IST rollover, Monday to Saturday strip, leap-day and future guard', () => {
  assert.equal(istToday(new Date('2026-09-24T18:30:00Z')), '2026-09-25');
  assert.deepEqual(weekDates('2026-09-27'), ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26']);
  assert.equal(monthGrid('2024-02').filter(Boolean).length, 29);
  assert.equal(classworkDateAllowed('2024-02-29', '2024-02-29'), true);
  assert.equal(classworkDateAllowed('2024-02-30', '2024-03-01'), false);
  assert.equal(classworkDateAllowed('2026-09-26', '2026-09-25'), false);
});

test('resource classification strips query and fragment and ignores URL casing', () => {
  assert.equal(classworkResource('/uploads/notes.PDF?download=1'), 'pdf');
  assert.equal(classworkResource('/uploads/video.MP4#player'), 'video');
  assert.equal(classworkResource('/uploads/photo.JPEG?size=2'), 'image');
  assert.equal(classworkResource('/uploads/resource.docx'), 'file');
  assert.equal(classworkResource(null), null);
});

test('file URLs stay within the configured first-party upload area', () => {
  assert.equal(safeClassworkUrl('/uploads/classwork/a.pdf', 'school.example.com'), 'https://school.example.com/uploads/classwork/a.pdf');
  assert.equal(safeClassworkUrl('https://evil.example/uploads/a.pdf', 'school.example.com'), null);
  assert.equal(safeClassworkUrl('javascript:alert(1)', 'school.example.com'), null);
  assert.equal(safeClassworkUrl('/uploads/%2e%2e/private.pdf', 'school.example.com'), null);
  assert.equal(safeClassworkUrl('/admin/a.pdf', 'school.example.com'), null);
});