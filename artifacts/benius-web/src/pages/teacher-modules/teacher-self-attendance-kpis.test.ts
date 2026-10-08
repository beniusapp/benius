import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { calculateTeacherSelfAttendanceKpis } from "./teacher-self-attendance-kpis";

test("Present counts only stored records in the current IST month, selected Session, through today", () => {
  const records = [
    { attendanceDate: "2026-10-04", status: "Present", totalWorkingMinutes: 0 },
    { attendanceDate: "2026-10-05", status: "Present", totalWorkingMinutes: 480 },
    { attendanceDate: "2026-10-06", status: "Late", totalWorkingMinutes: 290 },
    { attendanceDate: "2026-10-07", status: "Half Day", totalWorkingMinutes: 0 },
    { attendanceDate: "2026-10-08", status: "Present", totalWorkingMinutes: 420 },
    { attendanceDate: "2026-10-09", status: "Present", totalWorkingMinutes: 0 },
    { attendanceDate: "2026-10-10", status: "Absent", totalWorkingMinutes: 0 },
  ];

  const kpis = calculateTeacherSelfAttendanceKpis(
    records,
    "2026-10-08",
    "2026-10-05",
    "2027-10-05",
    () => true,
  );

  assert.equal(kpis.present, 2);
  assert.equal(kpis.late, 1);
  assert.equal(kpis.halfDay, 1);
});

test("Present clips to an Academic Session that ends mid-month", () => {
  const kpis = calculateTeacherSelfAttendanceKpis(
    [
      { attendanceDate: "2026-10-01", status: "Present", totalWorkingMinutes: 0 },
      { attendanceDate: "2026-10-05", status: "Present", totalWorkingMinutes: 0 },
      { attendanceDate: "2026-10-06", status: "Present", totalWorkingMinutes: 0 },
    ],
    "2026-10-08",
    "2026-10-01",
    "2026-10-05",
    () => true,
  );

  assert.equal(kpis.present, 2);
});

test("Present uses the current calendar month across a year boundary", () => {
  const kpis = calculateTeacherSelfAttendanceKpis(
    [
      { attendanceDate: "2026-12-31", status: "Present", totalWorkingMinutes: 0 },
      { attendanceDate: "2027-01-01", status: "Present", totalWorkingMinutes: 0 },
      { attendanceDate: "2027-01-02", status: "Present", totalWorkingMinutes: 0 },
      { attendanceDate: "2027-01-03", status: "Present", totalWorkingMinutes: 0 },
    ],
    "2027-01-02",
    "2026-12-15",
    "2027-02-28",
    () => true,
  );

  assert.equal(kpis.present, 2);
});

test("Late, Half Day, and positive-duration formulas retain their existing Session scope", () => {
  const kpis = calculateTeacherSelfAttendanceKpis(
    [
      { attendanceDate: "2026-09-30", status: "Late", totalWorkingMinutes: 300 },
      { attendanceDate: "2026-10-01", status: "Present", totalWorkingMinutes: 480 },
      { attendanceDate: "2026-10-02", status: "Late", totalWorkingMinutes: 290 },
      { attendanceDate: "2026-10-03", status: "Half Day", totalWorkingMinutes: 240 },
      { attendanceDate: "2026-10-05", status: "Present", totalWorkingMinutes: 0 },
    ],
    "2026-10-08",
    "2026-09-01",
    "2027-03-31",
    date => date !== "2026-10-05",
  );

  assert.deepEqual(kpis, { present: 1, late: 2, halfDay: 1, avgDur: 328 });
});

test("Present is zero when the selected Session does not overlap the current month", () => {
  const kpis = calculateTeacherSelfAttendanceKpis(
    [{ attendanceDate: "2026-09-30", status: "Present", totalWorkingMinutes: 0 }],
    "2026-10-08",
    "2026-04-01",
    "2026-09-30",
    () => true,
  );

  assert.equal(kpis.present, 0);
});

test("My Attendance uses the Dashboard Session and no longer renders an Absent Days card", () => {
  const attendance = readFileSync(
    "artifacts/benius-web/src/pages/teacher-modules/my-attendance.tsx",
    "utf8",
  );
  const dashboard = readFileSync("artifacts/benius-web/src/pages/teacher-dashboard.tsx", "utf8");

  assert.match(attendance, /useTeacherSelectedSession/);
  assert.doesNotMatch(attendance, /setSelectedSessionId|data-testid="select-session"|label:\s*"Absent Days"/);
  assert.match(dashboard, /const selectedSession = viewingSessionId != null \? viewingSession : activeSession;/);
  assert.match(dashboard, /TeacherSelectedSessionContext\.Provider value=\{selectedSession\}/);
  assert.match(attendance, /const isArchiveMode = currentSession \? !currentSession\.isActive : archiveModeContext;/);
});

test("the session-synced controls remain read-only in archived Sessions", () => {
  const attendance = readFileSync(
    "artifacts/benius-web/src/pages/teacher-modules/my-attendance.tsx",
    "utf8",
  );

  assert.match(attendance, /Viewing archive — check-in unavailable/);
  assert.match(attendance, /disabled=\{checkOutMut\.isPending \|\| isArchiveMode\}/);
  assert.match(attendance, /View Only/);
});
