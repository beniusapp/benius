import assert from "node:assert/strict";
import test from "node:test";
import {
  getPromotionPreview,
  reportCardAverage,
  reportCardFailureCount,
  summarizePromotionPreviews,
  type PromotionPreview,
} from "./examination-promotion-preview";

const promotedLedger = {
  decision: "promoted",
  targetClass: "2",
  targetSection: "a",
};

test("incomplete Report Cards hide averages and evaluated failure counts", () => {
  assert.equal(reportCardAverage("incomplete", 41), null);
  assert.equal(reportCardFailureCount("incomplete", 0), null);
  assert.equal(reportCardFailureCount("incomplete", 2), null);
});

test("completed zero-mark and absent results retain their evaluated failure counts", () => {
  assert.equal(reportCardAverage("complete", 0), 0);
  assert.equal(reportCardFailureCount("complete", 1), 1);
  assert.equal(reportCardFailureCount("complete", 0), 0);
});

test("partial results keep their calculation upstream while incomplete presentation is not evaluated", () => {
  assert.equal(reportCardAverage("incomplete", 63), null);
  assert.equal(reportCardFailureCount("incomplete", 1), null);
});

test("an incomplete Admin preview is Pending with no destination, even when old decisions exist", () => {
  assert.deepEqual(getPromotionPreview({
    resultStatus: "incomplete",
    readiness: "ineligible",
    override: { status: "promote", nextClass: "2", nextSection: "a" },
    ledgerDecision: promotedLedger,
    sourceClass: "1",
    sourceSection: "a",
  }), { outcome: "pending", destination: null });
});

test("a complete but ineligible locked decision is Requires Review with no destination", () => {
  assert.deepEqual(getPromotionPreview({
    resultStatus: "complete",
    readiness: "ineligible",
    override: { status: "promote", nextClass: "2", nextSection: "a" },
    ledgerDecision: promotedLedger,
    sourceClass: "1",
    sourceSection: "a",
  }), { outcome: "review", destination: null });
});

test("a historical decision stays visible as read-only and has no executable destination", () => {
  assert.deepEqual(getPromotionPreview({
    resultStatus: "complete",
    readiness: "historical",
    ledgerDecision: promotedLedger,
    sourceClass: "1",
    sourceSection: "a",
  }), { outcome: "historical", destination: null });
});

test("a complete eligible Teacher decision retains its promotion destination", () => {
  assert.deepEqual(getPromotionPreview({
    resultStatus: "complete",
    readiness: "ready",
    ledgerDecision: promotedLedger,
    sourceClass: "1",
    sourceSection: "a",
  }), {
    outcome: "promoted",
    destination: { className: "2", sectionName: "a" },
  });
});

test("a complete eligible Admin override remains authoritative in the preview", () => {
  assert.deepEqual(getPromotionPreview({
    resultStatus: "complete",
    readiness: "ready",
    override: { status: "grace_pass", nextClass: "3", nextSection: "b" },
    ledgerDecision: promotedLedger,
    sourceClass: "1",
    sourceSection: "a",
  }), {
    outcome: "grace_pass",
    destination: { className: "3", sectionName: "b" },
  });
});

test("a complete retained Teacher decision stays in the source placement", () => {
  assert.deepEqual(getPromotionPreview({
    resultStatus: "complete",
    readiness: "ready",
    ledgerDecision: { decision: "retained", targetClass: "1", targetSection: "a" },
    sourceClass: "1",
    sourceSection: "a",
  }), {
    outcome: "retained",
    destination: { className: "1", sectionName: "a" },
  });
});

test("promotion summary counts Pending and Review separately from promoted and retained", () => {
  const previews: PromotionPreview[] = [
    { outcome: "promoted", destination: { className: "2", sectionName: "a" } },
    { outcome: "retained", destination: { className: "1", sectionName: "a" } },
    { outcome: "pending", destination: null },
    { outcome: "review", destination: null },
  ];
  assert.deepEqual(summarizePromotionPreviews(previews), {
    promoted: 1,
    retained: 1,
    grace_pass: 0,
    pending: 1,
    review: 1,
    historical: 0,
  });
});
