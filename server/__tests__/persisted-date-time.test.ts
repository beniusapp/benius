import { describe, expect, it } from "vitest";
import { formatPersistedDateTimeIST } from "../persisted-date-time";

describe("formatPersistedDateTimeIST", () => {
  it("renders a persisted successful payment timestamp in exact IST format", () => {
    expect(formatPersistedDateTimeIST("2026-08-19T15:45:42.000Z"))
      .toBe("19 Aug 2026, 09:15:42 PM IST");
  });

  it("renders the Student Portal receipt timestamp returned by the captured Razorpay attempt", () => {
    // This is the raw TIMESTAMPTZ shape returned by the Student Receipt query.
    expect(formatPersistedDateTimeIST("2026-08-21 23:14:01+00"))
      .toBe("22 Aug 2026, 04:44:01 AM IST");
  });

  it("uses the IST date when a UTC timestamp crosses midnight", () => {
    expect(formatPersistedDateTimeIST("2026-08-18T20:00:01.000Z"))
      .toBe("19 Aug 2026, 01:30:01 AM IST");
  });

  it("accepts the Date instances returned by persisted fee-record queries", () => {
    expect(formatPersistedDateTimeIST(new Date("2026-08-20T13:02:15.000Z")))
      .toBe("20 Aug 2026, 06:32:15 PM IST");
  });

  it("does not substitute a current timestamp for absent or invalid stored data", () => {
    expect(formatPersistedDateTimeIST(null)).toBe("—");
    expect(formatPersistedDateTimeIST("invalid")).toBe("—");
  });
});