import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAcademicSessionActivationPlan,
  canManageAcademicSession,
} from "./academic-session-activation";

const placementMetadata = [
  { metaKey: "classes", metaValue: '["5","6"]' },
  { metaKey: "sections", metaValue: '["A","B"]' },
  { metaKey: "class_sections", metaValue: '{"5":["A"],"6":["B"]}' },
];

test("activation takes current placement from one valid target-session Active enrollment", () => {
  const plan = buildAcademicSessionActivationPlan({
    sessionId: 10,
    sessionName: "Target",
    activeStudents: [{
      id: 1, isActive: true, class: "5", section: "A", rollNumber: 12,
    }],
    targetEnrollments: [{
      studentId: 1, className: "6", sectionName: "B", rollNo: null, status: "Active",
    }],
    sameSchoolStudentStates: [{ id: 1, isActive: true }],
    placementMetadata,
  });

  assert.equal(plan.preview.canActivate, true);
  assert.equal(plan.preview.studentsNeedingRegistryUpdate, 1);
  assert.deepEqual(plan.placements, [{
    studentId: 1,
    className: "6",
    sectionName: "B",
    rollNo: null,
    placementChanged: true,
  }]);
});

test("missing enrollments, duplicate rows, foreign Students, and invalid placement block activation", () => {
  const plan = buildAcademicSessionActivationPlan({
    sessionId: 10,
    sessionName: "Target",
    activeStudents: [
      { id: 1, isActive: true, class: "5", section: "A", rollNumber: 1 },
      { id: 2, isActive: true, class: "5", section: "A", rollNumber: 2 },
      { id: 3, isActive: true, class: "5", section: "A", rollNumber: 3 },
    ],
    targetEnrollments: [
      { studentId: 1, className: "6", sectionName: "B", rollNo: 10, status: "Active" },
      { studentId: 1, className: "6", sectionName: "B", rollNo: 11, status: "Active" },
      { studentId: 2, className: "99", sectionName: "A", rollNo: 20, status: "Active" },
      { studentId: 99, className: "6", sectionName: "B", rollNo: 30, status: "Active" },
    ],
    sameSchoolStudentStates: [
      { id: 1, isActive: true },
      { id: 2, isActive: true },
    ],
    placementMetadata,
  });

  assert.equal(plan.preview.canActivate, false);
  assert.equal(plan.preview.activeStudentsMissingTargetEnrollment, 1);
  assert.equal(plan.preview.duplicateActiveEnrollmentConflicts, 1);
  assert.equal(plan.preview.foreignOrMissingStudentEnrollments, 1);
  assert.equal(plan.preview.invalidTargetPlacements, 1);
});

test("inactive Students are counted as skipped and never enter the synchronization plan", () => {
  const plan = buildAcademicSessionActivationPlan({
    sessionId: 10,
    sessionName: "Target",
    activeStudents: [],
    targetEnrollments: [{
      studentId: 7, className: "6", sectionName: "B", rollNo: 44, status: "Active",
    }],
    sameSchoolStudentStates: [{ id: 7, isActive: false }],
    placementMetadata,
  });

  assert.equal(plan.preview.canActivate, true);
  assert.equal(plan.preview.inactiveStudentsSkipped, 1);
  assert.deepEqual(plan.placements, []);
});

test("only an Admin may manage session activation", () => {
  assert.equal(canManageAcademicSession("admin"), true);
  assert.equal(canManageAcademicSession("support_staff"), false);
  assert.equal(canManageAcademicSession("teacher"), false);
  assert.equal(canManageAcademicSession(null), false);
});
