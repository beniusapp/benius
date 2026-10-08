import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluatePromotionLedgerReadiness,
  summarizePromotionLedgerReadiness,
  type LockedPromotionDecisionInput,
} from "./promotion-stage1";

type ReadinessInput = LockedPromotionDecisionInput & {
  sessionIsActive: boolean;
  studentIsInSourceRoster: boolean;
  adminExecuted?: boolean;
};

const decision = {
  locked: true,
  decision: "promoted",
  targetClass: "2",
  targetSection: "a",
  autoSuggestion: "promoted",
  manualIntervention: false,
};

const base: ReadinessInput = {
  sessionIsActive: true,
  studentIsInSourceRoster: true,
  resultStatus: "complete",
  promoted: true,
  decision,
  teacherIsValid: true,
  targetPlacementIsConfigured: true,
  sourceClass: "1",
  sourceSection: "a",
};

function readiness(overrides: Partial<ReadinessInput> = {}) {
  return evaluatePromotionLedgerReadiness({ ...base, ...overrides });
}

test("a complete active-roster result with a compatible locked Teacher decision is Ready", () => {
  assert.equal(readiness(), "ready");
});

test("a matching completed retained decision is Ready and remains in its source placement", () => {
  assert.equal(readiness({
    promoted: false,
    decision: {
      ...decision,
      decision: "retained",
      targetClass: "1",
      autoSuggestion: "retained",
    },
  }), "ready");
});

test("an authorized manual Teacher decision remains eligible when its audit flags match", () => {
  assert.equal(readiness({
    decision: {
      ...decision,
      decision: "retained",
      targetClass: "1",
      autoSuggestion: "promoted",
      manualIntervention: true,
    },
  }), "ready");
});

test("an inactive Student's locked current-session decision is Ineligible", () => {
  assert.equal(readiness({ studentIsInSourceRoster: false }), "ineligible");
});

test("a no-mark or incomplete result cannot be Ready", () => {
  assert.equal(readiness({ resultStatus: "incomplete", promoted: null }), "ineligible");
});

test("a stale automatic suggestion requires review", () => {
  assert.equal(readiness({
    decision: { ...decision, autoSuggestion: "retained" },
  }), "ineligible");
});

test("a conflicting manual-intervention flag requires review", () => {
  assert.equal(readiness({
    decision: { ...decision, decision: "retained", targetClass: "1" },
  }), "ineligible");
});

test("a missing, unlocked, or unsupported Teacher decision is not Ready", () => {
  assert.equal(readiness({ decision: undefined }), "pending");
  assert.equal(readiness({ decision: { ...decision, locked: false } }), "pending");
  assert.equal(readiness({
    decision: { ...decision, decision: "unknown" },
  }), "ineligible");
});

test("a Teacher outside the authenticated school cannot make a decision Ready", () => {
  assert.equal(readiness({ teacherIsValid: false }), "ineligible");
});

test("an unconfigured destination or mismatching submitted destination requires review", () => {
  assert.equal(readiness({ targetPlacementIsConfigured: false }), "ineligible");
  assert.equal(readiness({
    requestedTarget: { className: "3", sectionName: "a" },
  }), "ineligible");
});

test("an invalid retention destination requires review", () => {
  assert.equal(readiness({
    promoted: false,
    decision: {
      ...decision,
      decision: "retained",
      targetClass: "2",
      autoSuggestion: "retained",
    },
  }), "ineligible");
});

test("historical locked decisions remain Historical instead of being rejected for current inactivity", () => {
  assert.equal(readiness({
    sessionIsActive: false,
    studentIsInSourceRoster: false,
  }), "historical");
});

test("already executed records remain Executed and are not reclassified as Ready", () => {
  assert.equal(readiness({ adminExecuted: true }), "executed");
  assert.equal(readiness({ sessionIsActive: false, adminExecuted: true }), "historical");
});

test("a mixed cohort counts only eligible decisions as Ready", () => {
  const summary = summarizePromotionLedgerReadiness([
    { studentId: 1, readiness: "ready" },
    { studentId: 2, readiness: "ready" },
    { studentId: 4, readiness: "ineligible" },
    { studentId: 6, readiness: "ineligible" },
    { studentId: 7, readiness: "ineligible" },
  ]);
  assert.deepEqual(summary.counts, {
    ready: 2,
    pending: 0,
    ineligible: 3,
    historical: 0,
    executed: 0,
  });
  assert.deepEqual(summary.studentIds.ready, [1, 2]);
  assert.deepEqual(summary.studentIds.ineligible, [4, 6, 7]);
});
