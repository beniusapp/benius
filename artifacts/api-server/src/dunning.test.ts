import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateDunningOutstanding,
  dunningAttemptKey,
  getStageForSimulation,
  isAutomaticDunningDuplicate,
  isDunningTestChannel,
  isDunningRecordInScope,
  needsManualResendConfirmation,
  shouldRetryDunningFailure,
  runDunningJob,
  runDunningSimulation,
  runDunningForSingleFee,
} from "./dunning";
import { assertReminderDeliveryEnabled, isReminderDeliveryEnabled } from "./reminder-safety";

function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

test("outstanding calculation includes unpaid amount, late fee, payments and processed refunds", () => {
  assert.equal(calculateDunningOutstanding(1000, 50, 0, 0), 1050);
  assert.equal(calculateDunningOutstanding(1000, 50, 700, 0), 350);
  assert.equal(calculateDunningOutstanding(1000, 50, 1000, 200), 250);
  assert.equal(calculateDunningOutstanding(1000, 50, 1100, 0), 0);
});

test("manual resend requires explicit confirmation only when a prior successful send exists", () => {
  assert.equal(needsManualResendConfirmation(false, false), false);
  assert.equal(needsManualResendConfirmation(true, false), true);
  assert.equal(needsManualResendConfirmation(true, true), false);
});

test("automatic dedup key is isolated to invoice, channel and stage", () => {
  const sent = new Set([dunningAttemptKey(12, "email", "D+7")]);
  assert.equal(isAutomaticDunningDuplicate(sent, 12, "email", "D+7"), true);
  assert.equal(isAutomaticDunningDuplicate(sent, 12, "sms", "D+7"), false);
  assert.equal(isAutomaticDunningDuplicate(sent, 12, "email", "D+14"), false);
  assert.equal(isAutomaticDunningDuplicate(sent, 13, "email", "D+7"), false);
});

test("outstanding-balance scope requires both the same school and academic session", () => {
  assert.equal(isDunningRecordInScope({ schoolId: 3, sessionId: 50 }, 3, 50), true);
  assert.equal(isDunningRecordInScope({ schoolId: 4, sessionId: 50 }, 3, 50), false);
  assert.equal(isDunningRecordInScope({ schoolId: 3, sessionId: 51 }, 3, 50), false);
});

test("webhook is not an enabled notification test channel", () => {
  assert.equal(isDunningTestChannel("sms"), true);
  assert.equal(isDunningTestChannel("email"), true);
  assert.equal(isDunningTestChannel("webhook"), false);
});

test("Development safety mode blocks provider actions, automatic work, simulation, and manual sends", async () => {
  const oldNodeEnv = process.env.NODE_ENV;
  const oldDisabledFlag = process.env.BENIUS_DEV_REMINDERS_DISABLED;
  let providerCalls = 0;
  process.env.NODE_ENV = "development";
  delete process.env.BENIUS_DEV_REMINDERS_DISABLED;
  try {
    await assert.rejects(
      (async () => {
        assertReminderDeliveryEnabled();
        providerCalls++;
      })(),
      /Development safety mode/,
    );
    await runDunningJob();
    await assert.rejects(runDunningSimulation(3, 50), /Development safety mode/);
    await assert.rejects(runDunningForSingleFee(3, 1, 50), /Development safety mode/);
    assert.equal(providerCalls, 0);
  } finally {
    if (oldNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldNodeEnv;
    if (oldDisabledFlag === undefined) delete process.env.BENIUS_DEV_REMINDERS_DISABLED;
    else process.env.BENIUS_DEV_REMINDERS_DISABLED = oldDisabledFlag;
  }
});

test("reminder safety setting defaults off in Development and leaves Production unchanged", () => {
  assert.equal(isReminderDeliveryEnabled({ NODE_ENV: "development" }), false);
  assert.equal(isReminderDeliveryEnabled({ NODE_ENV: "development", BENIUS_DEV_REMINDERS_DISABLED: "true" }), false);
  assert.equal(isReminderDeliveryEnabled({ NODE_ENV: "development", BENIUS_DEV_REMINDERS_DISABLED: "false" }), true);
  assert.equal(isReminderDeliveryEnabled({ NODE_ENV: "production" }), true);
  assert.equal(isReminderDeliveryEnabled({ NODE_ENV: "production", BENIUS_DEV_REMINDERS_DISABLED: "true" }), true);
});

test("retry classification retries transient/429 failures but not ordinary 4xx", () => {
  assert.equal(shouldRetryDunningFailure("network timeout", 1), true);
  assert.equal(shouldRetryDunningFailure("HTTP 429", 1), true);
  assert.equal(shouldRetryDunningFailure("HTTP 400", 1), false);
  assert.equal(shouldRetryDunningFailure("HTTP 503", 3), false);
});

test("simulation stage buckets use calendar dates for D-2, D+0, D+3, D+7 and D+14", () => {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  assert.equal(getStageForSimulation(shiftDate(today, 2)), "D-2");
  assert.equal(getStageForSimulation(today), "D+0");
  assert.equal(getStageForSimulation(shiftDate(today, -3)), "D+3");
  assert.equal(getStageForSimulation(shiftDate(today, -7)), "D+7");
  assert.equal(getStageForSimulation(shiftDate(today, -14)), "D+14");
});
