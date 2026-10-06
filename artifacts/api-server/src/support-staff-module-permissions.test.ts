import assert from "node:assert/strict";
import test from "node:test";
import {
  adminModuleAccessAllowed,
  canonicalizeSupportStaffAllowedModules,
  filterSupportStaffAllowedModules,
  hasSupportStaffModuleAccess,
  hasSupportStaffSubmoduleAccess,
  adminModuleSubAccessAllowed,
  supportStaffModuleAccessAllowed,
} from "./support-staff-module-permissions";

test("approval and leave submodules are independently authorized for Support Staff", () => {
  const galleryOnly = ["approval-center", "approval-center:gallery-hub"];
  assert.equal(hasSupportStaffSubmoduleAccess(galleryOnly, "approval-center", "gallery-hub"), true);
  assert.equal(hasSupportStaffSubmoduleAccess(galleryOnly, "approval-center", "ebook"), false);

  const historyOnly = ["leave-requests", "leave-requests:leave-history"];
  assert.equal(hasSupportStaffSubmoduleAccess(historyOnly, "leave-requests", "leave-history"), true);
  assert.equal(hasSupportStaffSubmoduleAccess(historyOnly, "leave-requests", "teacher-leave"), false);
  assert.equal(hasSupportStaffSubmoduleAccess(historyOnly, "leave-requests", "student-leave"), false);
  assert.equal(hasSupportStaffModuleAccess(historyOnly, "leave-requests"), true);
  assert.equal(hasSupportStaffModuleAccess([], "leave-requests"), false);

  assert.equal(adminModuleSubAccessAllowed("admin", [], "approval-center", "ebook"), true);
  assert.equal(adminModuleSubAccessAllowed("teacher", galleryOnly, "approval-center", "gallery-hub"), false);
});

test("legacy Support Staff management grants are removed and never authorize", () => {
  const legacy = ["non-teaching-staff", "non-teaching-staff:permissions"];
  assert.deepEqual(filterSupportStaffAllowedModules(legacy), []);
  assert.deepEqual(canonicalizeSupportStaffAllowedModules(legacy), []);
  assert.equal(hasSupportStaffModuleAccess(legacy, "non-teaching-staff"), false);
  assert.equal(adminModuleAccessAllowed("support_staff", legacy, "non-teaching-staff"), false);
});

test("removes School Setup grants without changing any other Support Staff grants", () => {
  assert.deepEqual(
    filterSupportStaffAllowedModules([
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

test("parent-only modules require their exact parent grant", () => {
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
  for (const moduleId of parentOnlyModules) {
    assert.equal(hasSupportStaffModuleAccess([moduleId], moduleId), true);
    assert.equal(hasSupportStaffModuleAccess([`${moduleId}:legacy-child`], moduleId), false);
    assert.equal(
      supportStaffModuleAccessAllowed("support_staff", [`${moduleId}:legacy-child`], moduleId),
      false,
    );
  }
  assert.equal(
    supportStaffModuleAccessAllowed("support_staff", ["school-calendar"], "school-calendar"),
    true,
  );
  assert.equal(adminModuleAccessAllowed("admin", [], "school-calendar"), true);
  assert.equal(adminModuleAccessAllowed("teacher", [], "school-calendar"), false);
});

test("canonicalizes legacy child grants for parent-only modules without changing other grants", () => {
  assert.deepEqual(
    canonicalizeSupportStaffAllowedModules([
      "school-setup",
      "school-setup:classes",
      "timetable",
      "timetable:schedule",
      "timetable:structure",
      "school-calendar",
      "school-calendar:events",
      "school-calendar:holidays",
      "attendance",
      "attendance:students",
      "exam-controller",
      "exam-controller:ledger",
      "complaint-hub:private",
      "noticeboard",
      "noticeboard:bulk-delete",
      "analytics",
      "analytics:view",
      "audit-logs",
      "audit-logs:view",
      "visitor-log",
      "visitor-log:checkin",
      "id-card-gen",
      "id-card-gen:reissue",
      "assets",
      "assets:edit",
      "fees-manager:fee-structures",
    ]),
    [
      "timetable",
      "school-calendar",
      "attendance",
      "exam-controller",
      "noticeboard",
      "analytics",
      "audit-logs",
      "visitor-log",
      "id-card-gen",
      "assets",
      "fees-manager:fee-structures",
    ],
  );
  assert.deepEqual(
    canonicalizeSupportStaffAllowedModules(["timetable:schedule"]),
    [],
  );
  assert.deepEqual(
    canonicalizeSupportStaffAllowedModules(["school-calendar:events"]),
    [],
  );
  assert.deepEqual(
    canonicalizeSupportStaffAllowedModules([
      "exam-controller:wizard",
      "complaint-hub:private",
      "noticeboard:view",
      "analytics:results",
      "audit-logs:view",
      "visitor-log:active",
      "id-card-gen:search",
      "assets:delete",
    ]),
    [],
  );
});

test("Faculty Mapping, Teacher Registry, and Student Registry require exact parent grants", () => {
  for (const moduleId of ["faculty-mapping", "teacher-registry", "student-registry"]) {
    assert.equal(hasSupportStaffModuleAccess([moduleId], moduleId), true);
    assert.equal(hasSupportStaffModuleAccess([`${moduleId}:legacy-child`], moduleId), false);
    assert.equal(
      canonicalizeSupportStaffAllowedModules([moduleId, `${moduleId}:legacy-child`]).join(","),
      moduleId,
    );
    assert.equal(adminModuleAccessAllowed("admin", [], moduleId), true);
    assert.equal(adminModuleAccessAllowed("teacher", [moduleId], moduleId), false);
  }
});
