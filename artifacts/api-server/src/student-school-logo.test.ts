import assert from "node:assert/strict";
import test from "node:test";
import {
  loadStudentMeIdentity,
  studentSchoolLogoForAuthenticatedStudent,
} from "./student-school-logo";

test("Student identity lookup uses the authenticated Student id and returns that school's logo", async () => {
  let lookedUpStudentId: number | null = null;
  const identity = await loadStudentMeIdentity(5001, async studentId => {
    lookedUpStudentId = studentId;
    return {
      student: { schoolId: 41 },
      school: { id: 41, logoUrl: "/uploads/schools/41/logo-100.png" },
    };
  });

  assert.equal(lookedUpStudentId, 5001);
  assert.equal(identity?.logoUrl, "/uploads/schools/41/logo-100.png");
});

test("a mismatched school's logo is rejected instead of returned to the Student", async () => {
  assert.equal(
    studentSchoolLogoForAuthenticatedStudent(
      { schoolId: 41 },
      { id: 42, logoUrl: "/uploads/schools/42/logo-200.png" },
    ),
    null,
  );
});

test("missing authenticated Students return no identity payload", async () => {
  assert.equal(await loadStudentMeIdentity(5001, async () => undefined), null);
});

test("missing, empty, and whitespace logo references become null", () => {
  const student = { schoolId: 41 };

  assert.equal(studentSchoolLogoForAuthenticatedStudent(student, { id: 41, logoUrl: null }), null);
  assert.equal(studentSchoolLogoForAuthenticatedStudent(student, { id: 41, logoUrl: "" }), null);
  assert.equal(studentSchoolLogoForAuthenticatedStudent(student, { id: 41, logoUrl: "  " }), null);
});
