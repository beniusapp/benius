import assert from "node:assert/strict";
import test from "node:test";
import {
  removeStudentProfilePlacementInput,
  STUDENT_PROFILE_PLACEMENT_ERROR,
} from "./student-profile-placement-input";

test("ordinary profile fields pass through unchanged", () => {
  const body = { fullName: "Student Name", phone: "1234567890" };
  assert.deepEqual(removeStudentProfilePlacementInput(body), { ok: true, body });
});

test("Student-supplied class is rejected", () => {
  assert.deepEqual(
    removeStudentProfilePlacementInput({ fullName: "Student Name", class: "9" }),
    { ok: false, message: STUDENT_PROFILE_PLACEMENT_ERROR },
  );
});

test("Student-supplied section is rejected", () => {
  assert.deepEqual(
    removeStudentProfilePlacementInput({ section: "B" }),
    { ok: false, message: STUDENT_PROFILE_PLACEMENT_ERROR },
  );
});

test("Student-supplied roll number is rejected unless it is an unchanged Mobile echo", () => {
  assert.deepEqual(
    removeStudentProfilePlacementInput({ rollNo: "10" }),
    { ok: false, message: STUDENT_PROFILE_PLACEMENT_ERROR },
  );
  assert.deepEqual(
    removeStudentProfilePlacementInput(
      { fullName: "Student Name", rollNo: "15" },
      { allowUnchangedRollNo: "15" },
    ),
    { ok: true, body: { fullName: "Student Name" } },
  );
  assert.deepEqual(
    removeStudentProfilePlacementInput(
      { rollNo: "10" },
      { allowUnchangedRollNo: "15" },
    ),
    { ok: false, message: STUDENT_PROFILE_PLACEMENT_ERROR },
  );
});

test("combined crafted placement fields are rejected", () => {
  assert.deepEqual(
    removeStudentProfilePlacementInput({
      class: "9",
      section: "B",
      rollNo: "10",
    }),
    { ok: false, message: STUDENT_PROFILE_PLACEMENT_ERROR },
  );
});

test("Mobile unchanged roll echoes are stripped, while class and section remain forbidden", () => {
  assert.deepEqual(
    removeStudentProfilePlacementInput(
      { rollNo: "15" },
      { allowUnchangedRollNo: "15" },
    ),
    { ok: true, body: {} },
  );
  for (const field of ["class", "section"] as const) {
    assert.equal(
      removeStudentProfilePlacementInput(
        { [field]: "unchanged", rollNo: "15" },
        { allowUnchangedRollNo: "15" },
      ).ok,
      false,
    );
  }
});
