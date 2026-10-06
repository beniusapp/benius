import assert from "node:assert/strict";
import test from "node:test";
import {
  filterSupportStaffGrants,
  hasSupportStaffModuleGrant,
  SUPPORT_STAFF_PERMISSION_MODULES,
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
