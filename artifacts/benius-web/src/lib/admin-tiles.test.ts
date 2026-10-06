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
  shouldAutoGrantSubmodulePermissions,
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
    [],
  );
});

test("Faculty Mapping remains parent-only", () => {
  const moduleId = "faculty-mapping";
  assert.equal(isSupportStaffParentOnlyModule(moduleId), true);
  assert.equal(hasSupportStaffModuleGrant([moduleId], moduleId), true);
  assert.equal(hasSupportStaffModuleGrant([`${moduleId}:legacy-child`], moduleId), false);
  assert.deepEqual(
    canonicalizeSupportStaffGrants([moduleId, `${moduleId}:legacy-child`]),
    [moduleId],
  );
  assert.deepEqual(
    expandModulesWithSubs([moduleId]).filter(grant => grant.startsWith(`${moduleId}:`)),
    [],
  );
});

test("Teacher and Student Registry expose only explicit Add/Edit/Delete children", () => {
  const expected = [
    { id: "add", label: "Add Teacher" },
    { id: "edit", label: "Edit Teacher" },
    { id: "delete", label: "Delete Teacher" },
  ];
  assert.deepEqual(MODULE_SUB_MODULES["teacher-registry"], expected);
  assert.deepEqual(MODULE_SUB_MODULES["student-registry"], [
    { id: "add", label: "Add Student" },
    { id: "edit", label: "Edit Student" },
    { id: "delete", label: "Delete Student" },
  ]);

  for (const moduleId of ["teacher-registry", "student-registry"]) {
    assert.equal(isSupportStaffParentOnlyModule(moduleId), false);
    assert.equal(hasSupportStaffModuleGrant([moduleId], moduleId), true);
    assert.equal(hasSupportStaffModuleGrant([`${moduleId}:add`], moduleId), false);
    assert.equal(shouldAutoGrantSubmodulePermissions(moduleId), false);
    assert.deepEqual(expandModulesWithSubs([moduleId]), [moduleId]);
    assert.deepEqual(
      expandModulesWithSubs([moduleId, `${moduleId}:add`]),
      [moduleId, `${moduleId}:add`],
    );
  }
  assert.equal(shouldAutoGrantSubmodulePermissions("approval-center"), true);
});

test("legacy registry permissions keep explicit actions and never expand a parent into mutations", () => {
  assert.deepEqual(
    canonicalizeSupportStaffGrants([
      "teacher-registry",
      "teacher-registry:view",
      "teacher-registry:deactivate",
      "student-registry",
      "student-registry:export",
    ]),
    ["teacher-registry", "teacher-registry:delete", "student-registry"],
  );
  assert.deepEqual(canonicalizeSupportStaffGrants(["teacher-registry:add"]), []);
  assert.deepEqual(expandModulesWithSubs(["student-registry"]), ["student-registry"]);
  assert.deepEqual(
    expandModulesWithSubs(["student-registry", "student-registry:deactivate"]),
    ["student-registry", "student-registry:delete"],
  );
});
