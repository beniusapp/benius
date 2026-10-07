import assert from "node:assert/strict";
import { test } from "node:test";
import { dateOnlyInIST } from "../shared/ist-time";
import { advanceAutomaticDateSelection } from "./ist-date-selection-state";

test("advances the automatic selection when the IST date rolls over", () => {
  assert.deepEqual(
    advanceAutomaticDateSelection("2026-10-06", "2026-10-06", "2026-10-07"),
    { selectedDate: "2026-10-07", automaticDate: "2026-10-07" },
  );
});

test("preserves a manually selected historical date across rollover", () => {
  assert.deepEqual(
    advanceAutomaticDateSelection("2026-10-05", null, "2026-10-07"),
    { selectedDate: "2026-10-05", automaticDate: null },
  );
});

test("keeps the automatic selection when the IST date has not changed", () => {
  assert.deepEqual(
    advanceAutomaticDateSelection("2026-10-07", "2026-10-07", "2026-10-07"),
    { selectedDate: "2026-10-07", automaticDate: "2026-10-07" },
  );
});

test("formats an early-IST creation timestamp as its IST business date", () => {
  assert.equal(dateOnlyInIST("2026-10-06T19:38:00.000Z"), "2026-10-07");
});
