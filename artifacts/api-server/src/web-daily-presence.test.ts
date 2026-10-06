import assert from "node:assert/strict";
import test from "node:test";
import { summarizeWebDailyPresence } from "./web-daily-presence";

const schoolId = 2;
const sessionId = 20;

test("two Present and one unmarked Student gives a 2/2 percentage and one Not Marked", () => {
  const summary = summarizeWebDailyPresence({
    schoolId,
    sessionId,
    eligibleStudentIds: [1, 2, 3],
    records: [
      { studentId: 1, status: "present" },
      { studentId: 2, status: "present" },
    ],
  });

  assert.equal(summary.present, 2);
  assert.equal(summary.applicableTotal, 2);
  assert.equal(summary.percentage, 100);
  assert.equal(summary.notMarked, 1);
});

test("two Present and one Absent gives a 2/3 percentage with no Not Marked Students", () => {
  const summary = summarizeWebDailyPresence({
    schoolId,
    sessionId,
    eligibleStudentIds: [1, 2, 3],
    records: [
      { studentId: 1, status: "present" },
      { studentId: 2, status: "present" },
      { studentId: 3, status: "absent" },
    ],
  });

  assert.equal(summary.present, 2);
  assert.equal(summary.applicableTotal, 3);
  assert.equal(summary.percentage, 66.7);
  assert.equal(summary.notMarked, 0);
});

test("three Present Students gives 3/3 and no Not Marked Students", () => {
  const summary = summarizeWebDailyPresence({
    schoolId,
    sessionId,
    eligibleStudentIds: [1, 2, 3],
    records: [
      { studentId: 1, status: "present" },
      { studentId: 2, status: "present" },
      { studentId: 3, status: "present" },
    ],
  });

  assert.equal(summary.present, 3);
  assert.equal(summary.applicableTotal, 3);
  assert.equal(summary.percentage, 100);
  assert.equal(summary.notMarked, 0);
});

test("zero marks produces no percentage and counts all eligible Students as Not Marked", () => {
  const summary = summarizeWebDailyPresence({
    schoolId,
    sessionId,
    eligibleStudentIds: [1, 2, 3],
    records: [],
  });

  assert.equal(summary.total, 0);
  assert.equal(summary.applicableTotal, 0);
  assert.equal(summary.percentage, null);
  assert.equal(summary.notMarked, 3);
});

test("records for ineligible Students do not affect the live summary", () => {
  const summary = summarizeWebDailyPresence({
    schoolId,
    sessionId,
    eligibleStudentIds: [1, 2, 3],
    records: [
      { studentId: 1, status: "present" },
      { studentId: 2, status: "present" },
      { studentId: 4, status: "absent" },
      { studentId: null, status: "present" },
    ],
  });

  assert.equal(summary.total, 2);
  assert.equal(summary.present, 2);
  assert.equal(summary.applicableTotal, 2);
  assert.equal(summary.percentage, 100);
  assert.equal(summary.notMarked, 1);
});
