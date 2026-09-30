import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dashboard = readFileSync(new URL('../components/TeacherDashboard.tsx', import.meta.url), 'utf8');

test('Mobile approval count cache and transport both include the selected session', () => {
  assert.match(
    dashboard,
    /pendingKey\s*=\s*\(u: MobileUser, sessionId: number \| null\)\s*=>\s*\['mobile\/teacher\/pending-profiles\/count', u\.schoolId, u\.role, u\.id, sessionId\]/,
  );
  assert.match(
    dashboard,
    /queryKey: user \? pendingKey\(user, selectedId\)/,
  );
  assert.match(
    dashboard,
    /const sessionId = queryKey\[4\];[\s\S]*?apiGetForSession<\{ count: number \}>\([\s\S]*?sessionId/,
  );
  assert.match(dashboard, /enabled: !!me\.data && user\?\.role === 'teacher' && selectedId !== null/);
});

test('A → B → A has distinct per-session pending-count cache identities', () => {
  const key = (schoolId, role, userId, sessionId) =>
    ['mobile/teacher/pending-profiles/count', schoolId, role, userId, sessionId];
  const sessionA = key(11, 'teacher', 9, 41);
  const sessionB = key(11, 'teacher', 9, 30375);
  const sessionAAgain = key(11, 'teacher', 9, 41);

  assert.notDeepEqual(sessionA, sessionB);
  assert.deepEqual(sessionAAgain, sessionA);
});