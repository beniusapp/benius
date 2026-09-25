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

  // ── Bare-UTC convention ──────────────────────────────────────────────────
  // PostgreSQL timestamp-without-time-zone values are serialised as
  // "YYYY-MM-DD HH:MM:SS" with no zone designator. The app treats them as UTC
  // wall-clock instants. A naive `new Date("2026-08-20 18:30:00")` parses that
  // string as HOST-LOCAL time — the exact defect the shared helper prevents.
  // Proving the bare-UTC form equals the explicit-Z form demonstrates the
  // rendering is host/browser-timezone independent by construction.
  it("treats a bare timestamp-without-time-zone value as UTC, not host-local", () => {
    const bareUtc = "2026-08-20 18:30:00";
    const explicitZ = "2026-08-20T18:30:00.000Z";
    expect(formatPersistedInvoiceDateTimeIST(bareUtc))
      .toBe(formatPersistedInvoiceDateTimeIST(explicitZ));
    expect(formatPersistedInvoiceDateTimeIST(bareUtc))
      .toBe("21 Aug 2026, 12:00:00 AM IST");
  });

  // ── IST midnight boundary cases (21 / 22 / 23 Aug) ───────────────────────
  // IST is UTC+05:30, so an IST calendar day starts at 18:30 UTC the prior day.
  // These five cases pin the exact display on both sides of the 21/22/23 Aug
  // IST midnight boundaries so the rendered calendar date never depends on the
  // machine's local zone.
  it("renders the 21/22/23 Aug IST midnight boundaries exactly", () => {
    // 1s before 21 Aug IST midnight → still 20 Aug in IST.
    expect(formatPersistedInvoiceDateTimeIST("2026-08-20T18:29:59.000Z"))
      .toBe("20 Aug 2026, 11:59:59 PM IST");
    // Exactly 21 Aug IST midnight.
    expect(formatPersistedInvoiceDateTimeIST("2026-08-20T18:30:00.000Z"))
      .toBe("21 Aug 2026, 12:00:00 AM IST");
    // 1s before 22 Aug IST midnight → still 21 Aug in IST.
    expect(formatPersistedInvoiceDateTimeIST("2026-08-21T18:29:59.000Z"))
      .toBe("21 Aug 2026, 11:59:59 PM IST");
    // Exactly 22 Aug IST midnight.
    expect(formatPersistedInvoiceDateTimeIST("2026-08-21T18:30:00.000Z"))
      .toBe("22 Aug 2026, 12:00:00 AM IST");
    // Exactly 23 Aug IST midnight.
    expect(formatPersistedInvoiceDateTimeIST("2026-08-22T18:30:00.000Z"))
      .toBe("23 Aug 2026, 12:00:00 AM IST");
  });

  // ── Host-timezone independence proof ─────────────────────────────────────
  // Re-derive the boundary instants as Date objects (which capture a true
  // instant independent of any string zone parsing) and confirm the IST
  // rendering is identical to the string form. Because the output is produced
  // via Intl with an explicit `timeZone: "Asia/Kolkata"`, the result cannot
  // vary with the host/browser default zone.
  it("is host/browser-timezone independent for Date and string inputs at the boundary", () => {
    const boundary = "2026-08-20T18:30:00.000Z"; // 21 Aug IST midnight
    const expected = "21 Aug 2026, 12:00:00 AM IST";
    expect(formatPersistedInvoiceDateTimeIST(boundary)).toBe(expected);
    expect(formatPersistedInvoiceDateTimeIST(new Date(boundary))).toBe(expected);
    expect(formatPersistedInvoiceDateTimeIST(new Date(Date.UTC(2026, 7, 20, 18, 30, 0)))).toBe(expected);
  });
});
