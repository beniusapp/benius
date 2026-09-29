import assert from "node:assert/strict";
import test from "node:test";
import {
  countDistinctHomeworkStudents,
  deriveHomeworkSchoolOptions,
  isHomeworkClassSectionConfigured,
  isHomeworkSubjectConfigured,
} from "./teacher-homework-policy";

test("school-wide options fall back to configured class maps like the Web selector", () => {
  const options = deriveHomeworkSchoolOptions(
    { classes: [], sections: [], subjects: [] },
    { "Class 1": ["A", "B"], "Class 2": ["C"] },
    { "Class 1": ["Math"] },
  );

  assert.deepEqual(options.classes, ["Class 1", "Class 2"]);
  assert.deepEqual(options.sections, ["A", "B", "C"]);
  assert.equal(isHomeworkClassSectionConfigured(options, "Class 1", "B"), true);
  assert.equal(isHomeworkClassSectionConfigured(options, "Class 1", "C"), false);
  assert.equal(isHomeworkClassSectionConfigured(options, "Unconfigured", "A"), false);
});

test("class-specific section and subject lists take precedence over school-wide lists", () => {
  const options = deriveHomeworkSchoolOptions(
    { classes: ["Class 1"], sections: ["A", "B"], subjects: ["English"] },
    { "Class 1": ["B"] },
    { "Class 1": ["Math"] },
  );

  assert.equal(isHomeworkClassSectionConfigured(options, "Class 1", "B"), true);
  assert.equal(isHomeworkClassSectionConfigured(options, "Class 1", "A"), false);
  assert.equal(isHomeworkSubjectConfigured(options, "Class 1", "Math"), true);
  assert.equal(isHomeworkSubjectConfigured(options, "Class 1", "English"), false);
});

test("an empty subject configuration preserves the Web free-text subject field", () => {
  const options = deriveHomeworkSchoolOptions(
    { classes: ["Class 1"], sections: ["A"], subjects: [] },
    { "Class 1": ["A"] },
    {},
  );

  assert.equal(isHomeworkSubjectConfigured(options, "Class 1", "Environmental Studies"), true);
  assert.equal(isHomeworkSubjectConfigured(options, "Class 1", "   "), false);
});

test("session roster count is based on distinct enrolled student identities", () => {
  assert.equal(countDistinctHomeworkStudents([{ id: 4 }, { id: 4 }, { id: 9 }]), 2);
  assert.equal(countDistinctHomeworkStudents([]), 0);
});