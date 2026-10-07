import assert from "node:assert/strict";
import test from "node:test";
import { officialRollNumberDisplayValue } from "./official-roll-number-display";

test("an unassigned current Student roll displays as a dash", () => {
  assert.equal(officialRollNumberDisplayValue(null), "—");
});

test("the current official Student roll displays as assigned", () => {
  assert.equal(officialRollNumberDisplayValue(15), "15");
});
