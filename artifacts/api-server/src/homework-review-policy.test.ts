import assert from "node:assert/strict";
import test from "node:test";
import {
  homeworkReviewStatusForAction,
  isHomeworkReviewRosterEligible,
  teacherMayReviewHomework,
  teacherMayReviewStudentHomework,
  type HomeworkReviewAssignment,
  type HomeworkStudentReviewScope,
} from "./homework-review-policy";

const assignments: HomeworkReviewAssignment[] = [
  { className: "Class 4", section: "B" },
  { className: "Class 5", section: "A" },
];

const scope: HomeworkStudentReviewScope = {
  authenticatedSchoolId: 12,
  teacherSchoolId: 12,
  homeworkSchoolId: 12,
  selectedSessionId: 34,
  homeworkSessionId: 34,
  homeworkClass: "Class 4",
  homeworkSection: "B",
  studentSchoolId: 12,
  enrollmentSchoolId: 12,
  enrollmentSessionId: 34,
  enrollmentClass: "Class 4",
  enrollmentSection: "B",
};

test("assigned Teacher can review a Student in the Homework's selected-session Enrollment", () => {
  assert.equal(teacherMayReviewHomework(assignments, scope), true);
  assert.equal(teacherMayReviewStudentHomework(assignments, scope), true);
});

test("same-school assignment permission does not authorize an unmapped class or section", () => {
  assert.equal(
    teacherMayReviewHomework(assignments, {
      ...scope,
      homeworkClass: "Class 8",
      homeworkSection: "C",
    }),
    false,
  );
});

test("review policy rejects cross-school Homework, Teacher, Student, and Enrollment scopes", () => {
  assert.equal(teacherMayReviewHomework(assignments, { ...scope, homeworkSchoolId: 99 }), false);
  assert.equal(teacherMayReviewHomework(assignments, { ...scope, teacherSchoolId: 99 }), false);
  assert.equal(teacherMayReviewStudentHomework(assignments, { ...scope, studentSchoolId: 99 }), false);
  assert.equal(teacherMayReviewStudentHomework(assignments, { ...scope, enrollmentSchoolId: 99 }), false);
});

test("review policy rejects a different selected session or a mismatched Homework placement", () => {
  assert.equal(teacherMayReviewStudentHomework(assignments, { ...scope, selectedSessionId: 35 }), false);
  assert.equal(teacherMayReviewStudentHomework(assignments, { ...scope, homeworkSessionId: 35 }), false);
  assert.equal(teacherMayReviewStudentHomework(assignments, { ...scope, enrollmentSessionId: 35 }), false);
  assert.equal(teacherMayReviewStudentHomework(assignments, { ...scope, enrollmentClass: "Class 5" }), false);
  assert.equal(teacherMayReviewStudentHomework(assignments, { ...scope, enrollmentSection: "A" }), false);
});

test("active-session roster requires both an active Student and Active Enrollment", () => {
  assert.equal(isHomeworkReviewRosterEligible(true, "Active", true), true);
  assert.equal(isHomeworkReviewRosterEligible(false, "Active", true), false);
  assert.equal(isHomeworkReviewRosterEligible(true, "Inactive", true), false);
});

test("historical roster eligibility does not reinterpret current Student or Enrollment status", () => {
  assert.equal(isHomeworkReviewRosterEligible(false, "Inactive", false), true);
});

test("review actions map to the existing submission statuses", () => {
  assert.equal(homeworkReviewStatusForAction("approve"), "approved");
  assert.equal(homeworkReviewStatusForAction("request_resubmission"), "rejected");
});
