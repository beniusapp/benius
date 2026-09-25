import assert from 'node:assert/strict';
import test from 'node:test';
import { adminTiles, dashboardForRole, permittedSubmodules, visibleAdminTiles, visibleMetrics } from '../lib/admin-dashboard-pure.mjs';

test('admin gets all 19 modules in exact web order', () => {
  assert.equal(adminTiles.length, 19);
  assert.deepEqual(visibleAdminTiles('admin', []).map(t => t.id), [
    'school-setup', 'timetable', 'school-calendar', 'attendance', 'exam-controller',
    'complaint-hub', 'noticeboard', 'approval-center', 'leave-requests', 'teacher-registry',
    'non-teaching-staff', 'faculty-mapping', 'student-registry', 'fees-manager',
    'analytics', 'audit-logs', 'visitor-log', 'id-card-gen', 'assets',
  ]);
});
test('staff receives ONLY exact parent module grants, preserving source order', () => {
  const grants = ['noticeboard', 'attendance:student-leave', 'non-teaching-staff', 'attendance', 'unknown', 'approval-center:gallery', 'teacher-registry:add'];
  assert.deepEqual(visibleAdminTiles('support_staff', grants).map(t => t.id), ['attendance', 'noticeboard', 'non-teaching-staff']);
  assert.deepEqual(visibleAdminTiles('support_staff', ['attendance:student-leave']), []);
  assert.deepEqual(visibleAdminTiles('support_staff', undefined), []);
  assert.deepEqual(permittedSubmodules('attendance', grants), ['student-leave']);
  assert.deepEqual(permittedSubmodules('teacher-registry', grants), []);
});
test('dashboard routing never treats support staff as generic home', () => {
  assert.equal(dashboardForRole('support_staff'), 'admin');
  assert.equal(dashboardForRole('admin'), 'admin');
  assert.equal(dashboardForRole('teacher'), 'teacher');
  assert.equal(dashboardForRole('student'), 'student');
  assert.equal(dashboardForRole('other'), 'unsupported');
});
test('null and absent metrics are omitted; real zero remains visible only when permitted', () => {
  const base = { role: 'admin', studentCount: 0, teacherCount: 34, dailyPresence: null, actionRequiredCount: null };
  assert.deepEqual(visibleMetrics(base).map(m => [m.key, m.value]), [['studentCount', 0], ['teacherCount', 34]]);
  assert.deepEqual(visibleMetrics({ ...base, role: 'support_staff', allowedModuleIds: ['teacher-registry:add', 'student-registry'] }).map(m => m.key), ['studentCount']);
  assert.deepEqual(visibleMetrics({ ...base, role: 'support_staff', allowedModuleIds: [] }), []);
  assert.deepEqual(visibleMetrics(null), []);
});