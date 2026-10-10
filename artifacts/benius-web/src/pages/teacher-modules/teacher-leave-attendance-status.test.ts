import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  scopeTeacherLeaveApplications,
  teacherLeaveApplicationsForDate,
  teacherLeaveStatusLabel,
  upcomingTeacherLeaveApplications,
  type TeacherLeaveApplication,
} from "./teacher-leave-attendance-status";

const baseApplication = (overrides: Partial<TeacherLeaveApplication> = {}): TeacherLeaveApplication => ({
  id: 1,
  teacherId: 7,
  schoolId: 3,
  sessionId: 50,
  leaveType: "Casual",
  startDate: "2026-10-10",
  endDate: "2026-10-10",
  status: "pending",
  ...overrides,
});

const scope = (applications: TeacherLeaveApplication[]) =>
  scopeTeacherLeaveApplications(applications, 7, 3, 50, "2026-04-01", "2027-03-31");

test("exposes pending, approved, and rejected as separate labeled application statuses", () => {
  const applications = scope([
    baseApplication({ status: "pending" }),
    baseApplication({ id: 2, status: "approved" }),
    baseApplication({ id: 3, status: "rejected" }),
  ]);
  assert.deepEqual(applications.map((application) => teacherLeaveStatusLabel(application.status)), [
    "Pending Leave", "Approved Leave", "Rejected Leave",
  ]);
});

test("covers every date of single-day and multi-day applications inclusively", () => {
  const applications = scope([
    baseApplication({ startDate: "2026-10-10", endDate: "2026-10-10" }),
    baseApplication({ id: 2, startDate: "2026-10-11", endDate: "2026-10-13", status: "approved" }),
  ]);
  assert.equal(teacherLeaveApplicationsForDate(applications, "2026-10-10").length, 1);
  assert.equal(teacherLeaveApplicationsForDate(applications, "2026-10-12").length, 1);
  assert.equal(teacherLeaveApplicationsForDate(applications, "2026-10-13").length, 1);
  assert.equal(teacherLeaveApplicationsForDate(applications, "2026-10-14").length, 0);
});

test("retains every status when applications overlap the same date", () => {
  const applications = scope([
    baseApplication({ status: "pending" }),
    baseApplication({ id: 2, status: "approved" }),
    baseApplication({ id: 3, status: "rejected" }),
  ]);
  assert.deepEqual(
    teacherLeaveApplicationsForDate(applications, "2026-10-10").map((application) => application.status),
    ["pending", "approved", "rejected"],
  );
});

test("rejects applications from another Teacher, School, or Academic Session", () => {
  const applications = scope([
    baseApplication(),
    baseApplication({ id: 2, teacherId: 8 }),
    baseApplication({ id: 3, schoolId: 4 }),
    baseApplication({ id: 4, sessionId: 51 }),
    baseApplication({ id: 5, sessionId: null }),
  ]);
  assert.deepEqual(applications.map((application) => application.id), [1]);
  assert.deepEqual(scope([baseApplication({ sessionId: 51 })]), []);
});

test("keeps future applications visible without manufacturing attendance records", () => {
  const applications = scope([
    baseApplication({ startDate: "2026-10-12", endDate: "2026-10-14", status: "approved" }),
    baseApplication({ id: 2, startDate: "2026-10-09", endDate: "2026-10-11", status: "pending" }),
  ]);
  const upcoming = upcomingTeacherLeaveApplications(applications, "2026-10-11");
  assert.deepEqual(upcoming.map(({ application, startDate }) => [application.id, startDate]), [
    [2, "2026-10-11"], [1, "2026-10-12"],
  ]);
  assert.equal(applications.length, 2);
  assert.equal(teacherLeaveApplicationsForDate(applications, "2026-10-12").length, 1);
});

test("session clipping and switching do not mix out-of-session requests", () => {
  const clipped = scopeTeacherLeaveApplications(
    [baseApplication({ startDate: "2026-03-30", endDate: "2026-04-02" })],
    7, 3, 50, "2026-04-01", "2027-03-31",
  );
  assert.deepEqual([clipped[0].startDate, clipped[0].endDate], ["2026-04-01", "2026-04-02"]);
  assert.deepEqual(
    scopeTeacherLeaveApplications(clipped, 7, 3, 51, "2027-04-01", "2028-03-31"),
    [],
  );
});

test("My Attendance reads the authenticated Teacher's selected Session and keeps applications outside attendance calculations", () => {
  const source = readFileSync("artifacts/benius-web/src/pages/teacher-modules/my-attendance.tsx", "utf8");
  assert.match(source, /queryKey: \["\/api\/leave\/teacher", teacher\.id, teacher\.schoolId, selectedSessionId\]/);
  assert.match(source, /sessionFetchForViewSession\(\s*`\/api\/leave\/teacher\/\$\{teacher\.id\}`,\s*selectedSessionId/);
  assert.match(source, /enabled: selectedSessionId !== null/);
  assert.match(source, /calculateTeacherSelfAttendanceKpis\(\s*history,/);
  assert.match(source, /recentSessionAttendanceDates\(today, sessionStartDate, sessionEndDate\)/);
  assert.match(source, /upcomingTeacherLeaveApplications\(leaveApplications, addCalendarDays\(today, 1\)\)/);
  assert.doesNotMatch(source, /leaveApplications.*(?:denominator|attendanceRate)|(?:denominator|attendanceRate).*leaveApplications/);
});
