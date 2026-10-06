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

test("Timetable and School Calendar require their exact parent grant", () => {
  assert.equal(hasSupportStaffModuleAccess(["timetable"], "timetable"), true);
  assert.equal(hasSupportStaffModuleAccess(["school-calendar"], "school-calendar"), true);
  assert.equal(
    hasSupportStaffModuleAccess(["timetable:schedule"], "timetable"),
    false,
  );
  assert.equal(
    hasSupportStaffModuleAccess(["school-calendar:events"], "school-calendar"),
    false,
  );
  assert.equal(
    supportStaffModuleAccessAllowed("support_staff", ["timetable:publish"], "timetable"),
    false,
  );
  assert.equal(
    supportStaffModuleAccessAllowed("support_staff", ["school-calendar"], "school-calendar"),
    true,
  );
  assert.equal(adminModuleAccessAllowed("admin", [], "school-calendar"), true);
  assert.equal(adminModuleAccessAllowed("teacher", [], "school-calendar"), false);
});

test("canonicalizes legacy child grants only for Timetable and School Calendar", () => {
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
      "fees-manager:fee-structures",
    ]),
    [
      "timetable",
      "school-calendar",
      "attendance",
      "attendance:students",
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
});
