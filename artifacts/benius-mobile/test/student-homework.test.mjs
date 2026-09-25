import { test } from 'node:test';
import assert from 'node:assert/strict';
import { istToday, validDate, addDays, weekDates, monthGrid, shiftMonth, homeworkStatus, safeHomeworkUrl, validHomeworkFile } from '../lib/student-homework-pure.mjs';

test('IST day changes independently of device timezone and UTC', () => {
  assert.equal(istToday(new Date('2026-09-24T18:29:59Z')), '2026-09-24');
  assert.equal(istToday(new Date('2026-09-24T18:30:00Z')), '2026-09-25');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.deepEqual(weekDates('2026-09-27'), ['2026-09-21','2026-09-22','2026-09-23','2026-09-24','2026-09-25','2026-09-26']);
  assert.equal(validDate('2026-02-30'), false);
  assert.equal(validDate('2024-02-29'), true);
});
test('calendar month boundaries and pending state semantics', () => {
  assert.equal(monthGrid('2024-02').filter(Boolean).length, 29);
  assert.equal(shiftMonth('2025-01', -1), '2024-12');
  assert.equal(homeworkStatus(null), 'Pending');
  assert.equal(homeworkStatus({ status: 'rejected' }), 'Pending');
  assert.equal(homeworkStatus({ status: 'approved' }), 'Completed');
  assert.equal(homeworkStatus({ status: 'submitted' }), 'Submitted');
});
test('attachment origin and upload constraints', () => {
  assert.equal(safeHomeworkUrl('/uploads/homework/a.pdf', 'school.example.com'), 'https://school.example.com/uploads/homework/a.pdf');
  assert.equal(safeHomeworkUrl('https://evil.test/uploads/a.pdf', 'school.example.com'), null);
  assert.equal(safeHomeworkUrl('javascript:alert(1)', 'school.example.com'), null);
  assert.equal(safeHomeworkUrl('/admin/a.pdf', 'school.example.com'), null);
  assert.equal(validHomeworkFile({ uri: 'file://a', name: 'page.pdf', mimeType: 'application/pdf', size: 2048 }), true);
  assert.equal(validHomeworkFile({ uri: 'file://a', name: 'page.doc', mimeType: 'application/msword', size: 2048 }), false);
  assert.equal(validHomeworkFile({ uri: 'file://a', name: 'page.pdf', mimeType: 'application/pdf', size: 10485761 }), false);
});