import { describe, expect, it } from "vitest";
import { formatPersistedInvoiceDateTimeIST } from "../invoice-date-time";

describe("formatPersistedInvoiceDateTimeIST", () => {
  it("converts a persisted UTC timestamp to the exact IST invoice format", () => {
    expect(formatPersistedInvoiceDateTimeIST("2026-08-19T15:38:34.000Z"))
      .toBe("19 Aug 2026, 09:08:34 PM IST");
  });

  it("preserves the same stored instant across repeated views and Date inputs", () => {
    const createdAt = "2026-08-19T03:38:34.000Z";
    expect(formatPersistedInvoiceDateTimeIST(createdAt)).toBe("19 Aug 2026, 09:08:34 AM IST");
    expect(formatPersistedInvoiceDateTimeIST(new Date(createdAt))).toBe("19 Aug 2026, 09:08:34 AM IST");
  });

  it("uses the correct IST calendar date when the stored UTC instant crosses midnight", () => {
    expect(formatPersistedInvoiceDateTimeIST("2026-08-18T20:00:01.000Z"))
      .toBe("19 Aug 2026, 01:30:01 AM IST");
  });

  it("does not fabricate a timestamp when the persisted value is missing or invalid", () => {
    expect(formatPersistedInvoiceDateTimeIST(null)).toBe("—");
    expect(formatPersistedInvoiceDateTimeIST("not-a-timestamp")).toBe("—");
  });
});