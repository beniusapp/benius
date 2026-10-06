import assert from "node:assert/strict";
import test from "node:test";
import {
  adminModuleAccessAllowed,
  canonicalizeSupportStaffAllowedModules,
  filterSupportStaffAllowedModules,
  hasSupportStaffModuleAccess,
  supportStaffModuleAccessAllowed,
} from "./support-staff-module-permissions";

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
