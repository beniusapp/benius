import { describe, expect, it } from "vitest";
import { paymentAttemptEventTime } from "@shared/payment-attempt-event-time";

describe("payment attempt event timestamp selection", () => {
  const createdAt = "2026-08-20T10:00:00.000Z";

  it("uses the timestamp for the lifecycle event being shown", () => {
    expect(paymentAttemptEventTime({
      outcome: "captured", createdAt, rzpCreatedAt: "2026-08-20T10:01:00.000Z",
      rzpCapturedAt: "2026-08-20T10:02:00.000Z",
    })).toBe("2026-08-20T10:02:00.000Z");
    expect(paymentAttemptEventTime({
      outcome: "failed", createdAt, rzpFailedAt: "2026-08-20T10:03:00.000Z",
    })).toBe("2026-08-20T10:03:00.000Z");
    expect(paymentAttemptEventTime({
      outcome: "authorized", createdAt, rzpAuthorizedAt: "2026-08-20T10:04:00.000Z",
    })).toBe("2026-08-20T10:04:00.000Z");
    expect(paymentAttemptEventTime({
      outcome: "refunded", createdAt, refundProcessedAt: "2026-08-20T10:05:00.000Z",
    })).toBe("2026-08-20T10:05:00.000Z");
  });

  it("uses the local cancellation time only when no gateway payment exists", () => {
    expect(paymentAttemptEventTime({ outcome: "cancelled", createdAt })).toBe(createdAt);
  });
});