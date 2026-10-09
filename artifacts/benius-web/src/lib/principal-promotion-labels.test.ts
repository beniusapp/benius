import assert from "node:assert/strict";
import test from "node:test";
import { getPrincipalPromotionLabels } from "./principal-promotion-labels";

test("a saved Teacher recommendation remains pending until Principal execution", () => {
  const labels = getPrincipalPromotionLabels({ decision: "promoted", adminExecuted: false });

  assert.equal(labels.isFinal, false);
  assert.equal(labels.recommendationPrefix, "Teacher Recommended");
  assert.equal(labels.principalPrefix, null);
  assert.equal(labels.principalStatus, "Pending Principal Decision");
  assert.equal(labels.reportPrefix, "Teacher Recommended");
  assert.equal(labels.badgePrefix, "RECOMMEND");
});

test("only an executed Principal record is labeled as final", () => {
  const labels = getPrincipalPromotionLabels({ decision: "retained", adminExecuted: true });

  assert.equal(labels.isFinal, true);
  assert.equal(labels.recommendationPrefix, "Teacher Recommended");
  assert.equal(labels.principalPrefix, "Principal Final");
  assert.equal(labels.principalStatus, "Principal Final Decision");
  assert.equal(labels.reportPrefix, "Principal Final");
  assert.equal(labels.badgePrefix, "FINAL");
});

test("a missing ledger entry remains pending for both recommendation and Principal decision", () => {
  const labels = getPrincipalPromotionLabels();

  assert.equal(labels.isFinal, false);
  assert.equal(labels.recommendationPrefix, "Pending Teacher Recommendation");
  assert.equal(labels.principalPrefix, null);
  assert.equal(labels.principalStatus, "Pending Principal Decision");
  assert.equal(labels.badgePrefix, null);
});
