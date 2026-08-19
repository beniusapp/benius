import { describe, expect, it } from "vitest";
import { formatPersistedDateTimeIST } from "../persisted-date-time";

describe("formatPersistedDateTimeIST", () => {
  it("renders a persisted successful payment timestamp in exact IST format", () => {
    expect(formatPersistedDateTimeIST("2026-08-19T15:45:42.000Z"))
      .toBe("19 Aug 2026, 09:15:42 PM IST");
  });

  it("uses the IST date when a UTC timestamp crosses midnight", () => {
    expect(formatPersistedDateTimeIST("2026-08-18T20:00:01.000Z"))
      .toBe("19 Aug 2026, 01:30:01 AM IST");
  });

  it("does not substitute a current timestamp for absent or invalid stored data", () => {
    expect(formatPersistedDateTimeIST(null)).toBe("—");
    expect(formatPersistedDateTimeIST("invalid")).toBe("—");
  });
});