import assert from "node:assert/strict";
import type { AcademicSession } from "@workspace/db";
import express, { type RequestHandler } from "express";
import test from "node:test";
import { db } from "./db";
import { requireMobileAcademicSession } from "./mobile-auth-routes";
import { registerMobileTeacherModuleRoutes } from "./mobile-teacher-module-routes";
import { storage } from "./storage";
import { registerTeacherRoutes } from "./teacher-routes";
import { todayInIST } from "./shared/ist-time";

const teacher = {
  id: 9,
  userId: 90,
  schoolId: 1,
  fullName: "Attendance Teacher",
  assignedClass: "5",
  assignedSection: "A",
  subject: "Mathematics",
  isActive: true,
  mustChangePassword: false,
};
const teacherAccount = {
  teacher,
  school: { id: 1, name: "Test School" },
  user: { id: 90, schoolId: 1, role: "teacher", isActive: true },
};
const sessions = [
  { id: 101, schoolId: 1, isActive: true, startDate: "2000-01-01", endDate: "2099-12-31" },
  { id: 102, schoolId: 1, isActive: false, startDate: "1900-01-01", endDate: "1900-12-31" },
  { id: 201, schoolId: 2, isActive: true, startDate: "2000-01-01", endDate: "2099-12-31" },
] as unknown as AcademicSession[];

const currentStudent = {
  id: 10,
  name: "Arif",
  digitalStudentId: "STU-10",
  attendanceIdentityKey: "identity-10",
  identityKey: "identity-10",
  class: "8",
  section: "B",
  rollNumber: "8",
};
const historicalStudent = {
  ...currentStudent,
  class: "7",
  section: "A",
  rollNumber: "12",
};
const mobileAssignedStudent = {
  id: 50,
  name: "Rina",
  digitalStudentId: "STU-50",
  attendanceIdentityKey: "identity-50",
  identityKey: "identity-50",
  class: "5",
  section: "A",
  rollNumber: "4",
};
const schoolBStudent = { id: 20, schoolId: 2 };

test("Teacher Attendance uses the authenticated tenant and selected session for reads and writes", async (t) => {
  const calls = {
    selected: [] as Array<[number, number]>,
    activeFallback: [] as number[],
    rosterReads: [] as Array<[number, number, string, string]>,
    reportRosterReads: [] as Array<[number, number, string, string]>,
    historyReads: [] as Array<[number, number, string, string, string, string]>,
    studentOwnershipReads: [] as Array<[number[], number]>,
    upserts: [] as Array<Array<Record<string, unknown>>>,
    selfAttendanceInserts: [] as Array<Record<string, unknown>>,
    correctionInserts: [] as Array<Record<string, unknown>>,
  };

  const originalDbSelect = (db as any).select;
  const originalDbInsert = (db as any).insert;
  (db as any).select = () => ({
    from: () => ({
      where: async () => [],
    }),
  });
  (db as any).insert = (table: unknown) => ({
    values: (values: Record<string, unknown>) => ({
      returning: async () => {
        if (table) {
          if ("attendanceDate" in values && "checkInTime" in values) {
            calls.selfAttendanceInserts.push(values);
          } else if ("requestedCheckIn" in values) {
            calls.correctionInserts.push(values);
          }
        }
        return [{ id: calls.selfAttendanceInserts.length + calls.correctionInserts.length, ...values }];
      },
    }),
  });

  const replacements: Array<{ name: string; hadOwn: boolean; original: unknown }> = [];
  const replaceStorage = (name: string, implementation: (...args: any[]) => any) => {
    const target = storage as any;
    replacements.push({
      name,
      hadOwn: Object.prototype.hasOwnProperty.call(target, name),
      original: target[name],
    });
    target[name] = implementation;
  };

  replaceStorage("getTeacherWithSchool", async (id: number) => id === teacher.id ? teacherAccount : undefined);
  replaceStorage("getAcademicSessionForSchool", async (id: number, schoolId: number) => {
    calls.selected.push([id, schoolId]);
    return sessions.find((session) => session.id === id && session.schoolId === schoolId);
  });
  replaceStorage("getActiveSession", async (schoolId: number) => {
    calls.activeFallback.push(schoolId);
    return schoolId === 1 ? sessions[0] : undefined;
  });
  replaceStorage("getFacultyMappingsByTeacher", async () => []);
  replaceStorage("getAttendanceRosterForSessionClass", async (
    schoolId: number, sessionId: number, className: string, section: string,
  ) => {
    calls.rosterReads.push([schoolId, sessionId, className, section]);
    if (schoolId !== 1) return [];
    if (sessionId === 101 && className === "8" && section === "B") return [currentStudent];
    if (sessionId === 101 && className === "5" && section === "A") return [mobileAssignedStudent];
    return [];
  });
  replaceStorage("getAttendanceReportRosterForSessionClass", async (
    schoolId: number, sessionId: number, className: string, section: string,
  ) => {
    calls.reportRosterReads.push([schoolId, sessionId, className, section]);
    return schoolId === 1 && sessionId === 102 && className === "7" && section === "A"
      ? [historicalStudent]
      : [];
  });
  replaceStorage("getAttendanceForStudentsOnDate", async (
    schoolId: number, sessionId: number, studentIds: number[], className: string, section: string, date: string,
  ) => schoolId === 1 && sessionId === 101 && date === todayInIST()
    && className === "8" && section === "B" && studentIds.includes(10)
    ? [{ studentId: 10, status: "present", editCount: 0, markedBy: 9, markedAt: null }]
    : []);
  replaceStorage("getAttendanceByClassDate", async (
    schoolId: number, sessionId: number, className: string, section: string, date: string,
  ) => schoolId === 1 && sessionId === 102 && className === "7" && section === "A" && date === "1900-01-01"
    ? [{ identityKey: "identity-10", status: "absent", editCount: 1 }]
    : []);
  replaceStorage("getAttendanceHistory", async (
    schoolId: number, sessionId: number, className: string, section: string, startDate: string, endDate: string,
  ) => {
    calls.historyReads.push([schoolId, sessionId, className, section, startDate, endDate]);
    return [];
  });
  replaceStorage("getStudentsByIdsForSchool", async (ids: number[], schoolId: number) => {
    calls.studentOwnershipReads.push([ids, schoolId]);
    const schoolOwnedIds = schoolId === 1 ? [10, 50] : [schoolBStudent.id];
    return ids.filter((id) => schoolOwnedIds.includes(id)).map((id) => ({ id, schoolId }));
  });
  replaceStorage("getHolidayOnDate", async () => null);
  replaceStorage("upsertAttendance", async (records: Array<Record<string, unknown>>) => {
    calls.upserts.push(records);
    return records;
  });
  replaceStorage("hasAttendanceToday", async () => false);
  t.after(() => {
    const target = storage as any;
    for (const { name, hadOwn, original } of replacements.reverse()) {
      if (hadOwn) target[name] = original;
      else delete target[name];
    }
    (db as any).select = originalDbSelect;
    (db as any).insert = originalDbInsert;
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const role = req.get("x-test-role") ?? "teacher";
    (req as any).session = role === "anonymous"
      ? {}
      : { teacherId: 9, userId: 90, schoolId: 1, userRole: "teacher" };
    if (req.path.startsWith("/api/mobile/teacher/") && role !== "anonymous") {
      (req as any).mobileAuth = {
        principal: { id: 9, principalId: 90, entityId: 9, role: "teacher", schoolId: 1 },
      };
    }
    next();
  });
  registerTeacherRoutes(app);
  const pass: RequestHandler = (_req, _res, next) => next();
  registerMobileTeacherModuleRoutes(app, pass, pass, requireMobileAcademicSession);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  t.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  async function request(
    path: string,
    options: { method?: string; body?: unknown; sessionId?: number | string; role?: string } = {},
  ) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
        ...(options.sessionId === undefined ? {} : { "x-view-session-id": String(options.sessionId) }),
        ...(options.role ? { "x-test-role": options.role } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) as any : null };
  }

  const currentPath = `/api/attendance/1/8/B/${todayInIST()}`;
  const firstA = await request(currentPath, { sessionId: 101 });
  assert.equal(firstA.status, 200);
  assert.deepEqual(firstA.body.map((entry: any) => [entry.studentId, entry.status]), [[10, "present"]]);
  assert.deepEqual(calls.rosterReads.at(-1), [1, 101, "8", "B"]);

  assert.equal((await request(currentPath)).status, 400, "session-sensitive reads require an explicit selection");
  assert.equal((await request(currentPath, { sessionId: "101x" })).status, 400);
  assert.equal((await request(currentPath, { sessionId: 201 })).status, 403, "a foreign-school session is rejected");
  assert.equal((await request(`/api/attendance/2/8/B/${todayInIST()}`, { sessionId: 101 })).status, 403);

  const historicalPath = "/api/attendance/1/7/A/1900-01-01";
  const archiveB = await request(historicalPath, { sessionId: 102 });
  assert.equal(archiveB.status, 200);
  assert.deepEqual(archiveB.body.map((entry: any) => [entry.studentId, entry.status]), [[10, "absent"]]);
  assert.deepEqual(calls.reportRosterReads.at(-1), [1, 102, "7", "A"]);
  const secondA = await request(currentPath, { sessionId: 101 });
  assert.deepEqual(secondA.body, firstA.body, "A → B → A returns the selected session's original attendance");

  const history = await request("/api/attendance/history/1/7/A/1900-01-01/1900-01-01", { sessionId: 102 });
  assert.equal(history.status, 200);
  assert.deepEqual(calls.historyReads.at(-1), [1, 102, "7", "A", "1900-01-01", "1900-01-01"]);
  assert.equal((await request("/api/attendance/history/1/7/A/1900-01-01/1900-01-01")).status, 400);
  const historyReadsBeforeForeign = calls.historyReads.length;
  assert.equal(
    (await request("/api/attendance/history/2/7/A/1900-01-01/1900-01-01", { sessionId: 201 })).status,
    403,
    "a foreign-school attendance history request is rejected",
  );
  assert.equal(calls.historyReads.length, historyReadsBeforeForeign, "foreign attendance is never queried");

  const saved = await request("/api/attendance", {
    method: "POST",
    sessionId: 101,
    body: {
      date: todayInIST(),
      class: "8",
      section: "B",
      teacherId: 999,
      schoolId: 2,
      records: [{ studentId: 10, status: "absent" }],
    },
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(calls.upserts.at(-1)?.map(({ teacherId, schoolId, sessionId, class: className, section }) => ({
    teacherId, schoolId, sessionId, className, section,
  })), [{ teacherId: 9, schoolId: 1, sessionId: 101, className: "8", section: "B" }]);

  const upsertCount = calls.upserts.length;
  assert.equal((await request("/api/attendance", {
    method: "POST", sessionId: 102,
    body: { date: todayInIST(), class: "7", section: "A", records: [{ studentId: 10, status: "present" }] },
  })).status, 403, "historical-session Student Attendance writes are rejected");
  assert.equal(calls.upserts.length, upsertCount);
  assert.equal((await request("/api/attendance", {
    method: "POST", sessionId: 101,
    body: {
      date: todayInIST(), class: "8", section: "B", schoolId: schoolBStudent.schoolId,
      records: [{ studentId: schoolBStudent.id, status: "present" }],
    },
  })).status, 403, "a Student outside the authenticated school is rejected");
  assert.deepEqual(calls.studentOwnershipReads.at(-1), [[schoolBStudent.id], 1]);
  assert.equal((await request("/api/attendance/status/10", { sessionId: 101 })).status, 403);
  assert.equal((await request("/api/attendance/status/9")).status, 200);
  assert.equal(calls.activeFallback.at(-1), 1, "the legacy current-day status read keeps its active-session fallback");

  const policy = await request("/api/teacher/attendance-policy");
  assert.equal(policy.status, 200, "school-global policy reads do not require a selected session");
  assert.deepEqual(calls.activeFallback, [1], "global policy reads do not resolve an academic session");

  const historicalRate = await request("/api/teacher/self-attendance/rate", { sessionId: 102 });
  const currentRate = await request("/api/teacher/self-attendance/rate", { sessionId: 101 });
  assert.equal(historicalRate.status, 200);
  assert.equal(currentRate.status, 200);
  assert.ok(
    currentRate.body.applicableDays > historicalRate.body.applicableDays,
    "self-attendance statistics use the selected session's own date range",
  );

  const selfCheckIn = await request("/api/teacher/self-attendance/check-in", {
    method: "POST",
    sessionId: 101,
    body: { latitude: 10, longitude: 20, locationVerified: true },
  });
  assert.equal(selfCheckIn.status, 200);
  const selfCheckInInsert = calls.selfAttendanceInserts.at(-1)!;
  assert.equal(selfCheckInInsert.teacherId, 9);
  assert.equal(selfCheckInInsert.schoolId, 1);
  assert.equal(selfCheckInInsert.attendanceDate, todayInIST());
  assert.equal(selfCheckInInsert.sessionId, 101);
  assert.ok(selfCheckInInsert.checkInTime instanceof Date);
  assert.equal((selfCheckInInsert.checkInTime as Date).toISOString(), selfCheckIn.body.checkInTime);
  assert.equal(selfCheckInInsert.status, selfCheckIn.body.status);
  assert.equal(selfCheckInInsert.locationVerified, true);
  assert.equal(selfCheckInInsert.latitude, "10");
  assert.equal(selfCheckInInsert.longitude, "20");
  const selfInsertCount = calls.selfAttendanceInserts.length;
  assert.equal((await request("/api/teacher/self-attendance/check-in", {
    method: "POST",
    sessionId: 102,
    body: {},
  })).status, 403, "self-attendance writes reject an archived session before touching records");
  assert.equal(calls.selfAttendanceInserts.length, selfInsertCount);

  const webCorrection = await request("/api/teacher/self-attendance/correction", {
    method: "POST",
    sessionId: 101,
    body: {
      date: todayInIST(), requestedCheckIn: "08:00", requestedCheckOut: "16:00", reason: "Missed check-in",
    },
  });
  assert.equal(webCorrection.status, 200);
  assert.equal(calls.selfAttendanceInserts.at(-1)?.sessionId, 101);
  assert.deepEqual(
    ((webCorrection.body.correction as Record<string, unknown>).status),
    "Approved",
    "Web self-correction retains its immediate-approval behavior",
  );
  assert.equal(calls.correctionInserts.at(-1)?.sessionId, 101);

  const mobileSave = await request("/api/mobile/teacher/modules/attendance/submit", {
    method: "POST",
    sessionId: 101,
    body: { date: todayInIST(), className: "5", section: "A", records: [{ studentId: 50, status: "present" }] },
  });
  assert.equal(mobileSave.status, 200);
  const afterMobileSave = calls.upserts.length;
  assert.equal((await request("/api/mobile/teacher/modules/attendance/submit", {
    method: "POST",
    sessionId: 102,
    body: { date: todayInIST(), className: "5", section: "A", records: [{ studentId: 50, status: "present" }] },
  })).status, 403, "Mobile attendance writes also require the active selected session");
  assert.equal(calls.upserts.length, afterMobileSave);
  assert.equal((await request("/api/mobile/teacher/modules/attendance/submit", {
    method: "POST",
    sessionId: 101,
    body: { date: todayInIST(), className: "8", section: "B", records: [{ studentId: 10, status: "present" }] },
  })).status, 403, "Mobile keeps its existing assigned-class permission");

  const mobileCorrection = await request("/api/mobile/teacher/modules/attendance/self-correction", {
    method: "POST",
    sessionId: 101,
    body: {
      date: todayInIST(), requestedCheckIn: "08:00", requestedCheckOut: "16:00", reason: "Missed check-in",
    },
  });
  assert.equal(mobileCorrection.status, 200);
  assert.equal(calls.correctionInserts.at(-1)?.sessionId, 101);
  assert.equal(calls.correctionInserts.at(-1)?.status, "Pending", "Mobile keeps its existing pending-review behavior");
});