import assert from "node:assert/strict";
import test from "node:test";
import { safeStudentSchoolLogoUrl } from "./student-school-logo";

test("accepts a raster logo only from the authenticated Student's school folder", () => {
  assert.equal(
    safeStudentSchoolLogoUrl("/uploads/schools/41/logo-100.png", 41),
    "/uploads/schools/41/logo-100.png",
  );
});

test("rejects another school's path, external hosts, traversal, and unsupported file types", () => {
  assert.equal(safeStudentSchoolLogoUrl("/uploads/schools/42/logo-200.png", 41), null);
  assert.equal(safeStudentSchoolLogoUrl("https://example.com/logo.png", 41), null);
  assert.equal(safeStudentSchoolLogoUrl("/uploads/schools/41/../42/logo.png", 41), null);
  assert.equal(safeStudentSchoolLogoUrl("/uploads/schools/41/logo.svg", 41), null);
});

test("null, blank, malformed, and school-less values use the icon fallback", () => {
  assert.equal(safeStudentSchoolLogoUrl(null, 41), null);
  assert.equal(safeStudentSchoolLogoUrl("", 41), null);
  assert.equal(safeStudentSchoolLogoUrl("/uploads/schools/41/", 41), null);
  assert.equal(safeStudentSchoolLogoUrl("/uploads/schools/41/logo.png", null), null);
});
