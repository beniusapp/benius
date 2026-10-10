import assert from "node:assert/strict";
import test from "node:test";
import {
  isAutomaticOverdueFeeProcessingEnabled,
  runAutomaticOverdueFeeWork,
} from "./overdue-fee-safety";

test("automatic overdue processing is opt-in only in Development", () => {
  assert.equal(isAutomaticOverdueFeeProcessingEnabled({ NODE_ENV: "development" }), false);
  assert.equal(isAutomaticOverdueFeeProcessingEnabled({
    NODE_ENV: "development", BENIUS_DEV_OVERDUE_CHECK_DISABLED: "true",
  }), false);
  assert.equal(isAutomaticOverdueFeeProcessingEnabled({
    NODE_ENV: "development", BENIUS_DEV_OVERDUE_CHECK_DISABLED: "false",
  }), true);
  assert.equal(isAutomaticOverdueFeeProcessingEnabled({ NODE_ENV: "production" }), true);
  assert.equal(isAutomaticOverdueFeeProcessingEnabled({
    NODE_ENV: "production", BENIUS_DEV_OVERDUE_CHECK_DISABLED: "true",
  }), true);
});

test("disabled Development startup and scheduled paths never invoke the processor", async () => {
  let calls = 0;
  const work = async () => { calls++; };
  const devUnset = { NODE_ENV: "development" };
  const devTrue = { NODE_ENV: "development", BENIUS_DEV_OVERDUE_CHECK_DISABLED: "true" };

  assert.equal(await runAutomaticOverdueFeeWork(work, devUnset), false);
  assert.equal(await runAutomaticOverdueFeeWork(work, devTrue), false);
  assert.equal(calls, 0);

  assert.equal(await runAutomaticOverdueFeeWork(work, {
    NODE_ENV: "development", BENIUS_DEV_OVERDUE_CHECK_DISABLED: "false",
  }), true);
  assert.equal(calls, 1);
});
