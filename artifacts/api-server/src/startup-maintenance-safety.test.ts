import assert from "node:assert/strict";
import test from "node:test";
import {
  DEV_STARTUP_MAINTENANCE_ENABLED_ENV,
  isStartupMaintenanceEnabled,
  runStartupMaintenance,
} from "./startup-maintenance-safety";

test("Development startup maintenance defaults to disabled", () => {
  assert.equal(isStartupMaintenanceEnabled({ NODE_ENV: "development" }), false);
  assert.equal(isStartupMaintenanceEnabled({
    NODE_ENV: "development",
    [DEV_STARTUP_MAINTENANCE_ENABLED_ENV]: "false",
  }), false);
  assert.equal(isStartupMaintenanceEnabled({
    NODE_ENV: "development",
    [DEV_STARTUP_MAINTENANCE_ENABLED_ENV]: "TRUE",
  }), false);
});

test("disabled Development maintenance executes no guarded SQL writes", async () => {
  const attemptedSql: string[] = [];
  const guardedOperations = [
    "DROP TABLE legacy_data",
    "DROP INDEX legacy_index",
    "ALTER TABLE existing_data ADD COLUMN new_column TEXT",
    "INSERT INTO existing_data SELECT * FROM legacy_data",
    "UPDATE existing_data SET value = repaired_value",
    "DELETE FROM duplicate_rows",
    "TRUNCATE TABLE obsolete_data",
    "reconcile existing financial records",
  ];

  const ran = await runStartupMaintenance(async () => {
    for (const sql of guardedOperations) attemptedSql.push(sql);
  }, { NODE_ENV: "development" });

  assert.equal(ran, false);
  assert.deepEqual(attemptedSql, []);
});

test("Development maintenance requires an exact explicit opt-in", async () => {
  let calls = 0;
  const ran = await runStartupMaintenance(() => { calls += 1; }, {
    NODE_ENV: "development",
    [DEV_STARTUP_MAINTENANCE_ENABLED_ENV]: "true",
  });
  assert.equal(ran, true);
  assert.equal(calls, 1);
});

test("Production startup maintenance behavior is unchanged by the Development flag", async () => {
  assert.equal(isStartupMaintenanceEnabled({
    NODE_ENV: "production",
    [DEV_STARTUP_MAINTENANCE_ENABLED_ENV]: "false",
  }), true);

  let calls = 0;
  const ran = await runStartupMaintenance(() => { calls += 1; }, {
    NODE_ENV: "production",
    [DEV_STARTUP_MAINTENANCE_ENABLED_ENV]: "false",
  });
  assert.equal(ran, true);
  assert.equal(calls, 1);
});
