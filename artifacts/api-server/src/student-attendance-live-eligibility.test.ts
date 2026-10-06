import assert from "node:assert/strict";
import test from "node:test";
import {
  isEligibleForLiveStudentAttendance,
  type LiveAttendanceEnrollment,
  type LiveAttendanceScope,
  type LiveAttendanceStudent,
} from "./student-attendance-live-eligibility";

const scope: LiveAttendanceScope = {
  schoolId: 2,
  sessionId: 20,
  className: "1",
  sectionName: "A",
};

const student: LiveAttendanceStudent = {
  id: 101,
  schoolId: 2,
  isActive: true,
};

const enrollment: LiveAttendanceEnrollment = {
  studentId: 101,
  schoolId: 2,
  sessionId: 20,
  className: "1",
  sectionName: "A",
  status: "Active",
};

test("active Student with an exact active enrollment is eligible", () => {
  assert.equal(isEligibleForLiveStudentAttendance(student, enrollment, scope), true);
});

test("inactive Student is ineligible even when the enrollment remains Active", () => {
  assert.equal(
    isEligibleForLiveStudentAttendance({ ...student, isActive: false }, enrollment, scope),
    false,
  );
});

test("active Student with an inactive enrollment is ineligible", () => {
  assert.equal(
    isEligibleForLiveStudentAttendance(
      student,
      { ...enrollment, status: "Inactive" },
      scope,
    ),
    false,
  );
});

test("session, school, class, section, and Student/enrollment identity must all match", () => {
  const invalidRows: Array<[LiveAttendanceStudent, LiveAttendanceEnrollment]> = [
    [student, { ...enrollment, sessionId: 21 }],
    [student, { ...enrollment, schoolId: 3 }],
    [{ ...student, schoolId: 3 }, enrollment],
    [student, { ...enrollment, className: "2" }],
    [student, { ...enrollment, sectionName: "B" }],
    [student, { ...enrollment, studentId: 102 }],
  ];

  for (const [candidateStudent, candidateEnrollment] of invalidRows) {
    assert.equal(
      isEligibleForLiveStudentAttendance(candidateStudent, candidateEnrollment, scope),
      false,
    );
  }
});
