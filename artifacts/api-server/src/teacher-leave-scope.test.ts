import assert from "node:assert/strict";
import test from "node:test";
import { isTeacherLeaveDateRangeWithinSession } from "./teacher-leave-scope";

const session = {
  startDate: "2026-04-01",
  endDate: "2027-03-31",
};

test("allows a Teacher Leave range contained in the selected session", () => {
  assert.equal(
    isTeacherLeaveDateRangeWithinSession(
      "2026-04-01",
      "2027-03-31",
      session.startDate,
      session.endDate,
    ),
    true,
  );
  assert.equal(
    isTeacherLeaveDateRangeWithinSession(
      "2026-07-10",
      "2026-07-12",
      session.startDate,
      session.endDate,
    ),
    true,
  );
});

test("rejects Teacher Leave dates before or after the selected session", () => {
  assert.equal(
    isTeacherLeaveDateRangeWithinSession(
      "2026-03-31",
      "2026-04-02",
      session.startDate,
      session.endDate,
    ),
    false,
  );
  assert.equal(
    isTeacherLeaveDateRangeWithinSession(
      "2027-03-30",
      "2027-04-01",
      session.startDate,
      session.endDate,
    ),
    false,
  );
});

test("rejects reversed and non-date-only leave ranges", () => {
  assert.equal(
    isTeacherLeaveDateRangeWithinSession(
      "2026-09-02",
      "2026-09-01",
      session.startDate,
      session.endDate,
    ),
    false,
  );
  assert.equal(
    isTeacherLeaveDateRangeWithinSession(
      "2026-09-01T00:00:00Z",
      "2026-09-02",
      session.startDate,
      session.endDate,
    ),
    false,
  );
});