import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHistoricalStudentAttendanceOverview,
  buildLiveStudentAttendanceOverview,
  mapEnrollmentRollNumbers,
  normalizeAttendanceClassSections,
  selectAttendanceRoster,
} from "./student-attendance-overview";

test("active-session overview takes its population and marks from the live summary", () => {
  const payload = buildLiveStudentAttendanceOverview({
    total: 0,
    eligibleTotal: 5,
    notMarked: 5,
    applicableTotal: 0,
    present: 0,
    absent: 0,
    leave: 0,
    late: 0,
    halfDay: 0,
    missing: 0,
    unknown: 0,
    percentage: null,
  });

  assert.equal(payload.enrolledTotal, 5);
  assert.equal(payload.markedTotal, 0);
  assert.equal(payload.percentage, null);
});

test("historical overview keeps its historical population and has no rate when no rows exist", () => {
  const payload = buildHistoricalStudentAttendanceOverview(9, {
    total: 0,
    applicableTotal: 0,
    present: 0,
    absent: 0,
    leave: 0,
    late: 0,
    halfDay: 0,
    missing: 0,
    unknown: 0,
    percentage: 0,
  });

  assert.equal(payload.enrolledTotal, 9);
  assert.equal(payload.markedTotal, 0);
  assert.equal(payload.percentage, null);
});

test("roster selection uses the live roster only for the active session", () => {
  const live = [{ id: 1, isActive: true }];
  const history = [{ id: 2, isActive: false }];

  assert.deepEqual(selectAttendanceRoster(true, live, history), live);
  assert.deepEqual(selectAttendanceRoster(false, live, history), history);
});

test("session detail roll map uses Enrollment values including an intentionally blank roll", () => {
  const rolls = mapEnrollmentRollNumbers([
    { studentId: 3, rollNo: "3" },
    { studentId: 1, rollNo: null },
  ]);

  assert.equal(rolls.get(3), "3");
  assert.equal(rolls.get(1), "");
  assert.equal(rolls.has(2), false);
});

test("session class-section choices contain only unique non-empty pairs", () => {
  assert.deepEqual(
    normalizeAttendanceClassSections([
      { className: "2", sectionName: "B" },
      { className: "1", sectionName: "A" },
      { className: "2", sectionName: "B" },
      { className: null, sectionName: "A" },
      { className: "3", sectionName: " " },
    ]),
    [
      { className: "1", sectionName: "A" },
      { className: "2", sectionName: "B" },
    ],
  );
});
