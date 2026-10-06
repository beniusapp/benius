import assert from "node:assert/strict";
import test from "node:test";
import {
  MODULE_SUB_MODULES,
  canonicalizeSupportStaffGrants,
  filterSupportStaffGrants,
  hasSupportStaffModuleGrant,
  isSupportStaffParentOnlyModule,
  SUPPORT_STAFF_PERMISSION_MODULES,
  expandModulesWithSubs,
} from "./admin-tiles";

test("Support Staff grant filtering removes School Setup and Support Staff management roots and children", () => {
  assert.deepEqual(
    filterSupportStaffGrants([
      "school-setup",
      "school-setup:academic-sessions",
      "school-setup:classes",
      "non-teaching-staff",
      "non-teaching-staff:view",
      "non-teaching-staff:permissions",
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
  assert.equal(
    SUPPORT_STAFF_PERMISSION_MODULES.some(module => module.id === "non-teaching-staff"),
    false,
  );
});

test("Approval Center and Leave Requests are visible only when at least one real submodule is granted", () => {
  assert.equal(hasSupportStaffModuleGrant([], "approval-center"), false);
  assert.equal(hasSupportStaffModuleGrant(["approval-center:gallery-hub"], "approval-center"), true);
  assert.equal(hasSupportStaffModuleGrant(["leave-requests:leave-history"], "leave-requests"), true);
  assert.equal(hasSupportStaffModuleGrant(["approval-center"], "approval-center"), true);
});

test("the Support Staff tree exposes only the named Approval Center and Leave Requests submodules", () => {
  assert.deepEqual(
    MODULE_SUB_MODULES["approval-center"],
    [
      { id: "gallery-hub", label: "Gallery Hub" },
      { id: "ebook", label: "E-Book Library" },
    ],
  );
  assert.deepEqual(
    MODULE_SUB_MODULES["leave-requests"],
    [
      { id: "teacher-leave", label: "Teacher Leave" },
      { id: "student-leave", label: "Student Leave" },
      { id: "leave-history", label: "Leave Approval History" },
    ],
  );
});

test("Support Staff management is permanently unavailable even with a legacy grant", () => {
  assert.equal(hasSupportStaffModuleGrant(["non-teaching-staff"], "non-teaching-staff"), false);
  assert.equal(hasSupportStaffModuleGrant(["non-teaching-staff:permissions"], "non-teaching-staff"), false);
  assert.deepEqual(
    canonicalizeSupportStaffGrants(["non-teaching-staff", "non-teaching-staff:permissions"]),
    [],
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
    "analytics",
    "audit-logs",
    "visitor-log",
    "id-card-gen",
    "assets",
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
    "analytics",
    "analytics:view",
    "audit-logs",
    "audit-logs:view",
    "visitor-log",
    "visitor-log:history",
    "id-card-gen",
    "id-card-gen:search",
    "assets",
    "assets:add",
  ]);
  assert.deepEqual(canonical, [
    "timetable",
    "attendance",
    "exam-controller",
    "complaint-hub",
    "noticeboard",
    "analytics",
    "audit-logs",
    "visitor-log",
    "id-card-gen",
    "assets",
  ]);
  assert.deepEqual(expandModulesWithSubs(canonical), [
    "timetable",
    "attendance",
    "exam-controller",
    "complaint-hub",
    "noticeboard",
    "analytics",
    "audit-logs",
    "visitor-log",
    "id-card-gen",
    "assets",
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
