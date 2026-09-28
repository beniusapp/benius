import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const webAttendance = readFileSync("src/pages/teacher-modules/attendance.tsx", "utf8");
const mobileTeacherModule = readFileSync("../benius-mobile/app/teacher/[module].tsx", "utf8");

test("Web Attendance cache identity and request transport both include the selected session", () => {
  assert.match(
    webAttendance,
    /queryKey:\s*\["\/api\/attendance",\s*teacher\.schoolId,\s*selectedSession\?\.id\s*\?\?\s*null,\s*selectedClass,\s*selectedSection,\s*selectedDate\]/,
  );
  assert.match(
    webAttendance,
    /const sessionId = queryKey\[2\] as number \| null;[\s\S]*?sessionFetchForViewSession\([\s\S]*?sessionId/,
  );
  assert.match(webAttendance, /enabled:\s*view === "mark"\s*&&\s*!!selectedDate\s*&&\s*!!selectedSession/);
});

test("Mobile Attendance cache identity and bearer request transport both include the selected session", () => {
  assert.match(
    mobileTeacherModule,
    /const queryKey = \['mobile', 'teacher', user\.schoolId, user\.id, selectedId, module, selectedScopeKey,[\s\S]*?\] as const;/,
  );
  assert.match(mobileTeacherModule, /apiGetForSession<TeacherModuleData>\([\s\S]*?selectedId!/);
  assert.match(mobileTeacherModule, /apiPostForSession\([\s\S]*?selectedId/);
});

test("A → B → A uses distinct selected-session cache identities", () => {
  const requestIdentity = (sessionId: number, className: string, section: string, date: string) =>
    ["/api/attendance", 1, sessionId, className, section, date] as const;
  const sessionA = requestIdentity(101, "8", "B", "2026-09-28");
  const sessionB = requestIdentity(102, "7", "A", "1900-01-01");
  const cache = new Map<string, string>([
    [JSON.stringify(sessionA), "attendance-A"],
    [JSON.stringify(sessionB), "attendance-B"],
  ]);

  assert.notEqual(JSON.stringify(sessionA), JSON.stringify(sessionB));
  assert.equal(cache.get(JSON.stringify(requestIdentity(101, "8", "B", "2026-09-28"))), "attendance-A");
  assert.equal(cache.get(JSON.stringify(requestIdentity(102, "7", "A", "1900-01-01"))), "attendance-B");
  assert.equal(cache.get(JSON.stringify(requestIdentity(101, "8", "B", "2026-09-28"))), "attendance-A");
});