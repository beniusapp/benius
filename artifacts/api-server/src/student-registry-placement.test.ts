import assert from "node:assert/strict";
import test from "node:test";
import {
  hasActiveStudentPlacementChanged,
  isConfiguredStudentPlacement,
} from "./student-registry-placement";

const configuredPlacement = [
  { metaKey: "classes", metaValue: '["1","2"]' },
  { metaKey: "sections", metaValue: '["a","b"]' },
  { metaKey: "class_sections", metaValue: '{"1":["a","b"],"2":["a"]}' },
];

test("placement validation requires a configured class-section pair", () => {
  assert.equal(isConfiguredStudentPlacement(configuredPlacement, "2", "a"), true);
  assert.equal(isConfiguredStudentPlacement(configuredPlacement, "2", "b"), false);
  assert.equal(isConfiguredStudentPlacement(configuredPlacement, "9", "a"), false);
});

test("flat class and section lists are used when no class-section map exists", () => {
  assert.equal(isConfiguredStudentPlacement(configuredPlacement.slice(0, 2), "1", "b"), true);
  assert.equal(isConfiguredStudentPlacement(configuredPlacement.slice(0, 2), "1", "c"), false);
});

test("only an active Student's changed class, section, or roll triggers enrollment sync", () => {
  const current = { isActive: true, class: "2", section: "b", rollNumber: 1 };

  assert.equal(hasActiveStudentPlacementChanged(current, {
    class: "2", section: "a", rollNumber: 1,
  }), true);
  assert.equal(hasActiveStudentPlacementChanged(current, {
    class: "2", section: "b", rollNumber: 3,
  }), true);
  assert.equal(hasActiveStudentPlacementChanged(current, {
    class: "2", section: "b", rollNumber: 1,
  }), false);
  assert.equal(hasActiveStudentPlacementChanged({ ...current, isActive: false }, {
    class: "2", section: "a", rollNumber: 3,
  }), false);
});
