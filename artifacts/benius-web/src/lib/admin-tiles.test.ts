import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeSupportStaffGrants,
  filterSupportStaffGrants,
  hasSupportStaffModuleGrant,
  SUPPORT_STAFF_PERMISSION_MODULES,
  expandModulesWithSubs,
} from "./admin-tiles";

test("Support Staff grant filtering removes School Setup roots and submodules only", () => {
  assert.deepEqual(
    filterSupportStaffGrants([
      "school-setup",
      "school-setup:academic-sessions",
      "school-setup:classes",
      "fees-manager",
      "fees-manager:fee-structures",
      "attendance",
    ]),
    ["fees-manager", "fees-manager:fee-structures", "attendance"],
  );
});

test("legacy School Setup grants never authorize Support Staff module access", () => {
  assert.equal(
    hasSupportStaffModuleGrant(
      ["school-setup", "school-setup:classes"],
      "school-setup",
    ),
    false,
  );
  assert.equal(
    hasSupportStaffModuleGrant(
      ["school-setup", "attendance"],
      "attendance",
    ),
    true,
  );
});

test("the Support Staff permission editor excludes School Setup", () => {
  assert.equal(
    SUPPORT_STAFF_PERMISSION_MODULES.some(module => module.id === "school-setup"),
    false,
  );
});

test("Timetable and School Calendar are parent-only grants in the editor", () => {
  const canonical = canonicalizeSupportStaffGrants([
    "timetable",
    "timetable:schedule",
    "school-calendar:events",
    "attendance:students",
  ]);
  assert.deepEqual(canonical, ["timetable", "attendance:students"]);
  assert.deepEqual(expandModulesWithSubs(canonical), [
    "timetable",
    "attendance:students",
  ]);
  assert.equal(
    hasSupportStaffModuleGrant(["school-calendar:holidays"], "school-calendar"),
    false,
  );
  assert.equal(
    hasSupportStaffModuleGrant(["school-calendar"], "school-calendar"),
    true,
  );
});
