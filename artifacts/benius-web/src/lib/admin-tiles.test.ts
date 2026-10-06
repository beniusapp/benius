import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeSupportStaffGrants,
  filterSupportStaffGrants,
  hasSupportStaffModuleGrant,
  isSupportStaffParentOnlyModule,
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

test("parent-only modules are single grants in the editor and old child grants are removed on save", () => {
  const parentOnlyModules = [
    "timetable",
    "school-calendar",
    "attendance",
    "exam-controller",
    "complaint-hub",
    "noticeboard",
  ];
  const canonical = canonicalizeSupportStaffGrants([
    "timetable",
    "timetable:schedule",
    "attendance",
    "attendance:students",
    "exam-controller",
    "exam-controller:ledger",
    "complaint-hub",
    "complaint-hub:private",
    "noticeboard",
    "noticeboard:bulk-delete",
    "school-calendar:events",
  ]);
  assert.deepEqual(canonical, [
    "timetable",
    "attendance",
    "exam-controller",
    "complaint-hub",
    "noticeboard",
  ]);
  assert.deepEqual(expandModulesWithSubs(canonical), [
    "timetable",
    "attendance",
    "exam-controller",
    "complaint-hub",
    "noticeboard",
  ]);
  for (const moduleId of parentOnlyModules) {
    assert.equal(isSupportStaffParentOnlyModule(moduleId), true);
    assert.equal(hasSupportStaffModuleGrant([`${moduleId}:legacy-child`], moduleId), false);
    assert.equal(hasSupportStaffModuleGrant([moduleId], moduleId), true);
  }
  assert.equal(isSupportStaffParentOnlyModule("student-registry"), false);
  assert.deepEqual(
    canonicalizeSupportStaffGrants(["student-registry:view"]),
    ["student-registry:view"],
  );
});
