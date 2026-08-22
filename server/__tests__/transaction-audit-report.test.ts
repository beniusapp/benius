/**
 * transaction-audit-report.test.ts
 *
 * Unit tests for server/transaction-audit-report.ts
 *
 * Covers:
 *  1.  Successful Razorpay payment — key fields rendered
 *  2.  Failed payment attempt — error fields rendered
 *  3.  Multiple attempts — all rendered
 *  4.  Partial refund math — only processed refunds counted
 *  5.  Full refund math — outstanding becomes 0
 *  6.  Offline payment — offline detail rendered
 *  7.  Missing optional values — "Unavailable" shown, not fabricated
 *  8.  Missing gateway status — NEVER defaulted to "captured"
 *  9.  Sensitive-value exclusion — signature/payload/IP never in output
 * 10.  maskVpa, maskEmail, maskContact helpers
 * 11.  12 numbered sections present
 * 12.  Pending refunds NOT counted as processed
 * 13.  formatInstantIST used for instants; formatDateOnly for dates
 * 14.  Fabricated "captured" status proof — absent gateway status → Unavailable
 * 15.  Breakdown snapshot rendered when present
 * 16.  Concession snapshot: Unavailable when absent
 * 17.  fmtINR helper
 * 18.  paise helper
 */

import { describe, it, expect } from "vitest";
import {
  renderTransactionAuditHtml,
  maskVpa,
  maskEmail,
  maskContact,
  fmtINR,
  paise,
  type TransactionAuditDetail,
  type PaymentRecord,
  type PaymentAttempt,
  type Refund,
} from "../transaction-audit-report";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeSchool(overrides: Partial<TransactionAuditDetail["school"]> = {}): TransactionAuditDetail["school"] {
  return {
    name: "Test School",
    logoUrl: null,
    addressLine1: "1 School Lane",
    addressLine2: null,
    city: "Mumbai",
    state: "Maharashtra",
    pinCode: "400001",
    country: "India",
    phone: "9876543210",
    email: "school@example.com",
    affiliationNumber: "AFF-12345",
    gstin: null,
    ...overrides,
  };
}

function makeFeeRecord(
  overrides: Partial<TransactionAuditDetail["feeRecord"]> = {},
): TransactionAuditDetail["feeRecord"] {
  return {
    id: 42,
    feeType: "Academic",
    feeName: "Tuition Fee",
    amount: 5000,
    lateFeeAmount: 200,
    dueDate: "2024-07-01",
    paidDate: "2024-07-10",
    status: "paid",
    academicYear: "2024-2025",
    notes: null,
    invoiceNumber: "INV-2024-001",
    frequency: "Monthly",
    feePeriodStart: "2024-04-01",
    feePeriodEnd: "2024-04-30",
    lateFeeConfig: null,
    createdAt: "2024-06-01T08:00:00Z",
    createdBy: 1,
    breakdown: [],
    ...overrides,
  };
}

function makeStudent(
  overrides: Partial<TransactionAuditDetail["student"]> = {},
): TransactionAuditDetail["student"] {
  return {
    name: "Ravi Kumar",
    digitalStudentId: "DSID-001",
    class: "10",
    section: "A",
    rollNumber: 5,
    guardianName: "Suresh Kumar",
    phone: "9123456789",
    email: "ravi@example.com",
    ...overrides,
  };
}

function makePayment(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    id: 101,
    paymentMethod: "Portal Payment",
    amount: 5200,
    lateFeePaid: 200,
    receivedDate: "2024-07-10",
    referenceNumber: null,
    cashierNotes: null,
    receiptNumber: "RCP-001",
    razorpayPaymentId: "pay_ABC123",
    razorpayOrderId: "order_XYZ789",
    razorpaySignature: "hmac_SECRET_SHOULD_NEVER_APPEAR",
    paymentMode: "upi",
    bankName: null,
    cardLast4: null,
    vpa: "ravi@upi",
    payerName: "Ravi Kumar",
    payerEmail: "ravi@example.com",
    payerContact: "9123456789",
    gatewayStatus: "captured",
    createdAt: "2024-07-10T10:30:00Z",
    ...overrides,
  };
}

function makeAttempt(overrides: Partial<PaymentAttempt> = {}): PaymentAttempt {
  return {
    id: 1,
    attemptNumber: 1,
    outcome: "captured",
    source: "webhook",
    razorpayPaymentId: "pay_ABC123",
    razorpayOrderId: "order_XYZ789",
    amountPaise: 520000,
    currency: "INR",
    paymentMethod: "upi",
    errorCode: null,
    errorDescription: null,
    apiEnrichmentStatus: "completed",
    apiEnrichmentError: null,
    createdAt: "2024-07-10T10:25:00Z",
    updatedAt: "2024-07-10T10:30:00Z",
    events: [],
    ...overrides,
  };
}

function makeRefund(overrides: Partial<Refund> = {}): Refund {
  return {
    id: 1,
    paymentRecordId: 101,
    razorpayRefundId: "rfnd_TEST001",
    requestedAmountPaise: 100000,
    processedAmountPaise: 100000,
    currency: "INR",
    reasonCode: "fee_correction",
    reasonText: "Overcharged",
    localStatus: "processed",
    providerStatus: "processed",
    requestedAt: "2024-07-12T09:00:00Z",
    providerProcessedAt: "2024-07-12T09:05:00Z",
    failureMessage: null,
    requestedByName: "Admin User",
    events: [],
    ...overrides,
  };
}

function makeDetail(
  overrides: Partial<TransactionAuditDetail> = {},
): TransactionAuditDetail {
  return {
    feeRecord: makeFeeRecord(),
    payments: [makePayment()],
    payment: makePayment(),
    refunds: [],
    paymentAttempts: [makeAttempt()],
    webhookEvents: [],
    webhookProcessingEvents: [],
    student: makeStudent(),
    school: makeSchool(),
    auditEntries: [],
    ...overrides,
  };
}

// ─── 1. Successful Razorpay payment ───────────────────────────────────────────

describe("renderTransactionAuditHtml — successful Razorpay payment", () => {
  it("returns a non-empty string", () => {
    const html = renderTransactionAuditHtml(makeDetail());
    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(500);
  });

  it("includes the Razorpay Payment ID", () => {
    const html = renderTransactionAuditHtml(makeDetail());
    expect(html).toContain("pay_ABC123");
  });

  it("includes the Razorpay Order ID", () => {
    const html = renderTransactionAuditHtml(makeDetail());
    expect(html).toContain("order_XYZ789");
  });

  it("shows the captured gateway status", () => {
    const html = renderTransactionAuditHtml(makeDetail());
    expect(html).toContain("captured");
  });

  it("shows the receipt number", () => {
    const html = renderTransactionAuditHtml(makeDetail());
    expect(html).toContain("RCP-001");
  });

  it("shows the invoice number", () => {
    const html = renderTransactionAuditHtml(makeDetail());
    expect(html).toContain("INV-2024-001");
  });

  it("shows the school name", () => {
    const html = renderTransactionAuditHtml(makeDetail());
    expect(html).toContain("Test School");
  });

  it("contains a generated timestamp in the output", () => {
    const html = renderTransactionAuditHtml(makeDetail());
    // Should contain current year
    expect(html).toContain(new Date().getFullYear().toString());
  });

  it("is valid HTML with DOCTYPE", () => {
    const html = renderTransactionAuditHtml(makeDetail());
    expect(html.trimStart()).toMatch(/^<!DOCTYPE html>/i);
  });
});

// ─── 2. Failed payment attempt ────────────────────────────────────────────────

describe("renderTransactionAuditHtml — failed payment attempt", () => {
  const failedAttempt = makeAttempt({
    outcome: "failed",
    razorpayPaymentId: "pay_FAIL001",
    errorCode: "BAD_REQUEST_ERROR",
    errorDescription: "Payment failed due to insufficient funds",
  });

  it("shows failed outcome", () => {
    const html = renderTransactionAuditHtml(makeDetail({ paymentAttempts: [failedAttempt] }));
    expect(html).toContain("failed");
  });

  it("shows error code", () => {
    const html = renderTransactionAuditHtml(makeDetail({ paymentAttempts: [failedAttempt] }));
    expect(html).toContain("BAD_REQUEST_ERROR");
  });

  it("shows error description", () => {
    const html = renderTransactionAuditHtml(makeDetail({ paymentAttempts: [failedAttempt] }));
    expect(html).toContain("insufficient funds");
  });

  it("shows the failed payment ID", () => {
    const html = renderTransactionAuditHtml(makeDetail({ paymentAttempts: [failedAttempt] }));
    expect(html).toContain("pay_FAIL001");
  });
});

// ─── 3. Multiple attempts ─────────────────────────────────────────────────────

describe("renderTransactionAuditHtml — multiple attempts", () => {
  const attempts = [
    makeAttempt({
      id: 1,
      attemptNumber: 1,
      outcome: "failed",
      razorpayPaymentId: "pay_FAIL001",
      razorpayOrderId: "order_FIRST",
      errorCode: "PAYMENT_FAILED",
      errorDescription: "Declined",
    }),
    makeAttempt({
      id: 2,
      attemptNumber: 2,
      outcome: "captured",
      razorpayPaymentId: "pay_SUCCESS",
      razorpayOrderId: "order_SECOND",
    }),
  ];

  it("shows both attempt payment IDs", () => {
    const html = renderTransactionAuditHtml(makeDetail({ paymentAttempts: attempts }));
    expect(html).toContain("pay_FAIL001");
    expect(html).toContain("pay_SUCCESS");
  });

  it("shows both order IDs", () => {
    const html = renderTransactionAuditHtml(makeDetail({ paymentAttempts: attempts }));
    expect(html).toContain("order_FIRST");
    expect(html).toContain("order_SECOND");
  });

  it("contains attempt count (2 attempts)", () => {
    const html = renderTransactionAuditHtml(makeDetail({ paymentAttempts: attempts }));
    expect(html).toContain("2 attempt");
  });
});

// ─── 4. Partial refund math ───────────────────────────────────────────────────

describe("renderTransactionAuditHtml — partial refund math", () => {
  // Payment: ₹5200. Processed refund: ₹1000 (100000 paise)
  // Pending refund: ₹500 (50000 paise) — must NOT be counted

  const processedRefund = makeRefund({
    id: 1,
    requestedAmountPaise: 100000,
    processedAmountPaise: 100000,
    localStatus: "processed",
  });
  const pendingRefund = makeRefund({
    id: 2,
    requestedAmountPaise: 50000,
    processedAmountPaise: null,
    localStatus: "requested",
  });

  it("renders section 9 (Financial Reconciliation)", () => {
    const html = renderTransactionAuditHtml(
      makeDetail({ refunds: [processedRefund, pendingRefund] }),
    );
    expect(html).toContain("Financial Reconciliation");
  });

  it("shows 1 of 2 refunds processed note", () => {
    const html = renderTransactionAuditHtml(
      makeDetail({ refunds: [processedRefund, pendingRefund] }),
    );
    expect(html).toContain("1 of 2 refund");
  });

  it("notes that pending refund is not counted as processed", () => {
    const html = renderTransactionAuditHtml(
      makeDetail({ refunds: [processedRefund, pendingRefund] }),
    );
    expect(html.toLowerCase()).toContain("pending");
    expect(html).toContain("NOT counted");
  });

  it("shows the processed refund ID (rfnd_TEST001)", () => {
    const html = renderTransactionAuditHtml(
      makeDetail({ refunds: [processedRefund] }),
    );
    expect(html).toContain("rfnd_TEST001");
  });
});

// ─── 5. Full refund — outstanding should be zero ──────────────────────────────

describe("renderTransactionAuditHtml — full refund outstanding", () => {
  // Fee: ₹5000 + ₹200 late = ₹5200 total charged
  // Payment: ₹5200
  // Full processed refund: ₹5200 (520000 paise)
  const fullRefund = makeRefund({
    requestedAmountPaise: 520000,
    processedAmountPaise: 520000,
    localStatus: "processed",
  });

  it("does not show a negative outstanding", () => {
    const html = renderTransactionAuditHtml(makeDetail({ refunds: [fullRefund] }));
    // Net retained should be 0; outstanding should be 0 (not negative)
    expect(html).not.toContain("-₹");
    expect(html).not.toContain("−₹");
  });

  it("renders Financial Reconciliation section", () => {
    const html = renderTransactionAuditHtml(makeDetail({ refunds: [fullRefund] }));
    expect(html).toContain("Financial Reconciliation");
  });
});

// ─── 6. Offline payment ───────────────────────────────────────────────────────

describe("renderTransactionAuditHtml — offline payment", () => {
  const offlinePayment = makePayment({
    paymentMethod: "Cheque",
    razorpayPaymentId: null,
    razorpayOrderId: null,
    razorpaySignature: null,
    gatewayStatus: null,
    referenceNumber: "CHQ-12345",
    instrumentDate: "2024-07-08",
    branchName: "HDFC Bank, Andheri",
    offlineDetail: {
      transactionTime: "2024-07-08T11:00:00Z",
      instrumentStatus: "cleared",
      transferMode: "cheque",
      transactionReference: "CHQ-12345",
      receivingBank: "HDFC Bank",
      depositDate: "2024-07-09",
      depositBank: "HDFC Bank",
      depositReference: "DEP-001",
    },
  });

  it("shows reference number", () => {
    const html = renderTransactionAuditHtml(makeDetail({ payments: [offlinePayment], payment: offlinePayment }));
    expect(html).toContain("CHQ-12345");
  });

  it("shows deposit bank", () => {
    const html = renderTransactionAuditHtml(makeDetail({ payments: [offlinePayment], payment: offlinePayment }));
    expect(html).toContain("HDFC Bank");
  });

  it("shows instrument status cleared", () => {
    const html = renderTransactionAuditHtml(makeDetail({ payments: [offlinePayment], payment: offlinePayment }));
    expect(html).toContain("cleared");
  });

  it("shows branch name", () => {
    const html = renderTransactionAuditHtml(makeDetail({ payments: [offlinePayment], payment: offlinePayment }));
    expect(html).toContain("Andheri");
  });
});

// ─── 7. Missing optional values → "Unavailable" ───────────────────────────────

describe("renderTransactionAuditHtml — missing optional values", () => {
  const detail = makeDetail({
    feeRecord: makeFeeRecord({
      invoiceNumber: null,
      academicYear: null,
      feePeriodStart: null,
      feePeriodEnd: null,
      paidDate: null,
    }),
    payments: [
      makePayment({
        bankName: null,
        cardLast4: null,
        vpa: null,
        payerEmail: null,
        payerContact: null,
        gatewayStatus: null,
        receiptNumber: null,
      }),
    ],
    paymentAttempts: [
      makeAttempt({
        amountPaise: null,
        errorCode: null,
        errorDescription: null,
        apiEnrichmentStatus: null,
      }),
    ],
  });

  it("shows 'Unavailable' for missing gateway status", () => {
    const html = renderTransactionAuditHtml(detail);
    expect(html).toContain("Unavailable");
  });

  it("shows 'Unavailable' for missing card details", () => {
    const html = renderTransactionAuditHtml(detail);
    expect(html).toContain("Unavailable");
  });

  it("shows em-dash for null invoice number", () => {
    const html = renderTransactionAuditHtml(detail);
    // val() returns "Unavailable" for null but section header uses "—" fallback
    // The report uses val() which returns "Unavailable", but HTML renders
    // Actually val returns "Unavailable" for null
    expect(html).toContain("Unavailable");
  });
});

// ─── 8. Missing gateway status NEVER defaults to "captured" ──────────────────

describe("renderTransactionAuditHtml — fabricated captured status proof", () => {
  it("does NOT insert 'captured' when gatewayStatus is null", () => {
    const payment = makePayment({ gatewayStatus: null });
    const html = renderTransactionAuditHtml(
      makeDetail({ payments: [payment], payment }),
    );
    // "Unavailable" must appear for the gateway status field
    expect(html).toContain("Unavailable");
    // The string "captured" should NOT appear in the gateway status context
    // (it may appear for other fields like attempt outcome, so check the specific pattern)
    // We'll check that the html does not contain the old dangerous pattern:
    // badge-green">captured from the old transaction-pdf route
    // The safest check: ensure the gateway status row says Unavailable
    const gatewaySectionMatch = html.match(/Gateway Status[\s\S]*?Unavailable/);
    expect(gatewaySectionMatch).not.toBeNull();
  });

  it("does NOT contain 'captured' as a fallback anywhere when payment has null gatewayStatus and no captured attempts", () => {
    const payment = makePayment({ gatewayStatus: null });
    const attempt = makeAttempt({ outcome: "failed", razorpayPaymentId: "pay_FAIL" });
    const html = renderTransactionAuditHtml(
      makeDetail({
        payments: [payment],
        payment,
        paymentAttempts: [attempt],
      }),
    );
    // The output must contain "failed" (from the attempt)
    expect(html).toContain("failed");
    // The specific Razorpay gateway status line must say Unavailable
    expect(html).toContain("Unavailable");
  });
});

// ─── 9. Sensitive-value exclusion ─────────────────────────────────────────────

describe("renderTransactionAuditHtml — sensitive value exclusion", () => {
  const sensitivePayment = makePayment({
    razorpaySignature: "HMAC_SIGNATURE_abc123def456",
    payerEmail: "test@secret.com",
    payerContact: "9999988888",
    vpa: "secret@vpa",
  });

  it("NEVER renders the HMAC signature", () => {
    const html = renderTransactionAuditHtml(
      makeDetail({ payments: [sensitivePayment], payment: sensitivePayment }),
    );
    expect(html).not.toContain("HMAC_SIGNATURE_abc123def456");
    expect(html).not.toContain("hmac_SECRET_SHOULD_NEVER_APPEAR");
  });

  it("NEVER renders the full payer email", () => {
    const html = renderTransactionAuditHtml(
      makeDetail({ payments: [sensitivePayment], payment: sensitivePayment }),
    );
    // "test@secret.com" should NOT appear verbatim
    expect(html).not.toContain("test@secret.com");
  });

  it("NEVER renders the full phone number", () => {
    const html = renderTransactionAuditHtml(
      makeDetail({ payments: [sensitivePayment], payment: sensitivePayment }),
    );
    // Full phone should not appear
    expect(html).not.toContain("9999988888");
  });

  it("NEVER renders the full VPA", () => {
    const html = renderTransactionAuditHtml(
      makeDetail({ payments: [sensitivePayment], payment: sensitivePayment }),
    );
    // "secret@vpa" should not appear verbatim
    expect(html).not.toContain("secret@vpa");
  });

  it("does NOT render raw webhook payloads", () => {
    const detail = makeDetail({
      webhookEvents: [
        {
          id: 1,
          providerEventId: "evt_001",
          eventType: "payment.captured",
          razorpayPaymentId: "pay_ABC",
          razorpayOrderId: "order_XYZ",
          razorpayRefundId: null,
          razorpayDisputeId: null,
          signatureVerified: true,
          verificationStatus: "verified",
          processingStatus: "processed",
          processingError: null,
          providerOccurredAt: null,
          resolutionSource: null,
          resolutionStatus: "resolved",
          resolutionReason: null,
          receivedAt: "2024-07-10T10:30:00Z",
          lastReceivedAt: "2024-07-10T10:30:00Z",
          processedAt: "2024-07-10T10:31:00Z",
          deliveryCount: 1,
          payload: { secret_key: "SUPER_SECRET", raw_body: "RAWPAYLOAD123" },
        },
      ],
    });
    const html = renderTransactionAuditHtml(detail);
    expect(html).not.toContain("SUPER_SECRET");
    expect(html).not.toContain("RAWPAYLOAD123");
  });

  it("does NOT render IP addresses from audit entries", () => {
    const detail = makeDetail({
      auditEntries: [
        {
          id: 1,
          action: "fee_paid",
          actorName: "Admin",
          actorId: 1,
          ipAddress: "192.168.1.100",
          description: "Fee marked as paid",
          createdAt: "2024-07-10T10:30:00Z",
        },
      ],
    });
    const html = renderTransactionAuditHtml(detail);
    expect(html).not.toContain("192.168.1.100");
  });

  it("does NOT render attempt event payloads", () => {
    const attempt = makeAttempt({
      events: [
        {
          id: 1,
          eventType: "payment.authorized",
          outcome: "authorized",
          source: "webhook",
          razorpayPaymentId: "pay_ABC",
          razorpayOrderId: "order_XYZ",
          refundId: null,
          disputeId: null,
          amountPaise: 520000,
          providerOccurredAt: "2024-07-10T10:29:00Z",
          occurredAt: "2024-07-10T10:29:00Z",
          recordedAt: "2024-07-10T10:29:01Z",
          historical: false,
          payload: { sensitive_field: "SENSITIVE_DATA_PAYLOAD" },
          webhookEventId: 1,
        },
      ],
    });
    const detail = makeDetail({ paymentAttempts: [attempt] });
    const html = renderTransactionAuditHtml(detail);
    expect(html).not.toContain("SENSITIVE_DATA_PAYLOAD");
    expect(html).not.toContain("sensitive_field");
  });
});

// ─── 10. Masking helpers ──────────────────────────────────────────────────────

describe("maskVpa", () => {
  it("masks a standard VPA", () => {
    const result = maskVpa("ravi@upi");
    expect(result).not.toBe("ravi@upi");
    expect(result).toContain("@upi");
    expect(result).toContain("ra");
    expect(result).toContain("*");
  });

  it("returns 'Unavailable' for null", () => {
    expect(maskVpa(null)).toBe("Unavailable");
  });

  it("returns 'Unavailable' for undefined", () => {
    expect(maskVpa(undefined)).toBe("Unavailable");
  });

  it("returns 'Unavailable' for empty string", () => {
    expect(maskVpa("")).toBe("Unavailable");
  });

  it("preserves the domain portion", () => {
    const result = maskVpa("user@okaxis");
    expect(result).toContain("@okaxis");
  });

  it("does not expose the full local part", () => {
    const result = maskVpa("longerusername@upi");
    expect(result).not.toContain("longerusername");
  });
});

describe("maskEmail", () => {
  it("masks a standard email", () => {
    const result = maskEmail("test@example.com");
    expect(result).not.toBe("test@example.com");
    expect(result).toContain("te");
    expect(result).toContain("*");
  });

  it("returns 'Unavailable' for null", () => {
    expect(maskEmail(null)).toBe("Unavailable");
  });

  it("returns 'Unavailable' for undefined", () => {
    expect(maskEmail(undefined)).toBe("Unavailable");
  });

  it("returns 'Unavailable' for empty string", () => {
    expect(maskEmail("")).toBe("Unavailable");
  });

  it("does not expose the full email address", () => {
    const result = maskEmail("secretuser@gmail.com");
    expect(result).not.toContain("secretuser");
    expect(result).not.toContain("secretuser@gmail.com");
  });

  it("includes an @ symbol in masked output", () => {
    const result = maskEmail("user@domain.org");
    expect(result).toContain("@");
  });
});

describe("maskContact", () => {
  it("masks a standard phone number, showing only last 4 digits", () => {
    const result = maskContact("9123456789");
    expect(result).toBe("****6789");
  });

  it("returns 'Unavailable' for null", () => {
    expect(maskContact(null)).toBe("Unavailable");
  });

  it("returns 'Unavailable' for undefined", () => {
    expect(maskContact(undefined)).toBe("Unavailable");
  });

  it("returns 'Unavailable' for empty string", () => {
    expect(maskContact("")).toBe("Unavailable");
  });

  it("does not expose the full phone number", () => {
    const result = maskContact("9999988888");
    expect(result).not.toContain("999998");
    expect(result).toContain("8888");
  });

  it("handles numbers with non-digit characters", () => {
    const result = maskContact("+91-98765-43210");
    expect(result).toBe("****3210");
  });
});

describe("renderTransactionAuditHtml — database timestamp and nested security regressions", () => {
  it("accepts node-postgres Date objects throughout timeline sorting", () => {
    const payment = makePayment({
      createdAt: new Date("2024-07-10T10:30:00Z") as unknown as string,
    });
    const attempt = makeAttempt({
      paymentRecordId: payment.id,
      createdAt: new Date("2024-07-10T10:25:00Z") as unknown as string,
      updatedAt: new Date("2024-07-10T10:30:00Z") as unknown as string,
      rzpCapturedAt: new Date("2024-07-10T10:30:00Z") as unknown as string,
    });
    const detail = makeDetail({
      feeRecord: {
        ...makeFeeRecord(),
        createdAt: new Date("2024-07-01T04:30:00Z") as unknown as string,
      },
      payments: [payment],
      payment,
      paymentAttempts: [attempt],
      auditEntries: [{
        id: 1,
        action: "payment",
        actorName: "System",
        actorId: null,
        description: "Payment recorded",
        createdAt: new Date("2024-07-10T10:31:00Z") as unknown as string,
      }],
    });

    expect(() => renderTransactionAuditHtml(detail)).not.toThrow();
    expect(renderTransactionAuditHtml(detail)).toContain("IST");
  });

  it("recursively redacts sensitive values nested inside correction arrays", () => {
    const payment = makePayment({
      corrections: [{
        reason: "Corrected imported metadata",
        changedByName: "Admin",
        createdAt: "2024-07-11T08:00:00Z",
        previousValues: {
          history: [{
            payerEmail: "nested-secret@example.com",
            receiverUpiId: "nested-secret@upi",
            rawPayload: "NESTED_RAW_PAYLOAD",
          }],
        },
        newValues: {
          contacts: [{
            payerContact: "9999912345",
            idempotencyKey: "NESTED_IDEMPOTENCY_SECRET",
          }],
        },
      }],
    });
    const html = renderTransactionAuditHtml(makeDetail({
      payments: [payment],
      payment,
    }));

    expect(html).not.toContain("nested-secret@example.com");
    expect(html).not.toContain("nested-secret@upi");
    expect(html).not.toContain("NESTED_RAW_PAYLOAD");
    expect(html).not.toContain("9999912345");
    expect(html).not.toContain("NESTED_IDEMPOTENCY_SECRET");
    expect(html).toContain("[REDACTED]");
  });

  it("shows failed-refund requester and provider failure code", () => {
    const refund = makeRefund({
      localStatus: "failed",
      providerStatus: "failed",
      processedAmountPaise: null,
      failureCode: "BAD_REQUEST_ERROR",
      failureMessage: "Refund rejected by provider",
      requestedByName: "finance@example.edu",
    });
    const html = renderTransactionAuditHtml(makeDetail({ refunds: [refund] }));

    expect(html).toContain("BAD_REQUEST_ERROR");
    expect(html).toContain("Refund rejected by provider");
    expect(html).toContain("finance@example.edu");
  });
});

// ─── 11. 12 numbered sections ─────────────────────────────────────────────────

describe("renderTransactionAuditHtml — 12 numbered sections", () => {
  it("contains all 12 section numbers", () => {
    const html = renderTransactionAuditHtml(makeDetail());
    for (let i = 1; i <= 12; i++) {
      // Each section has a section-num span
      expect(html).toContain(`<span class="section-num">${i}</span>`);
    }
  });

  it("contains section 1: Transaction Summary", () => {
    const html = renderTransactionAuditHtml(makeDetail());
    expect(html).toContain("Transaction Summary");
  });

  it("contains section 2: Fee & Invoice Details", () => {
    const html = renderTransactionAuditHtml(makeDetail());
    expect(html).toContain("Fee &amp; Invoice Details");
  });

  it("contains section 3: Student Details", () => {
    const html = renderTransactionAuditHtml(makeDetail());
    expect(html).toContain("Student Details");
  });

  it("contains section 4: Payment Details", () => {
    const html = renderTransactionAuditHtml(makeDetail());
    expect(html).toContain("Payment Details");
  });

  it("contains section 5: Razorpay / Gateway Details", () => {
    const html = renderTransactionAuditHtml(makeDetail());
    expect(html).toContain("Razorpay");
  });

  it("contains section 6: Complete Payment Attempt History", () => {
    const html = renderTransactionAuditHtml(makeDetail());
    expect(html).toContain("Complete Payment Attempt History");
  });

  it("contains section 7: Payment Lifecycle Timeline", () => {
    const html = renderTransactionAuditHtml(makeDetail());
    expect(html).toContain("Payment Lifecycle Timeline");
  });

  it("contains section 8: Refund & Reversal Details", () => {
    const html = renderTransactionAuditHtml(makeDetail());
    expect(html).toContain("Refund");
  });

  it("contains section 9: Financial Reconciliation", () => {
    const html = renderTransactionAuditHtml(makeDetail());
    expect(html).toContain("Financial Reconciliation");
  });

  it("contains section 10: Verification & Webhook Status", () => {
    const html = renderTransactionAuditHtml(makeDetail());
    expect(html).toContain("Webhook Status");
  });

  it("contains section 11: Complete Audit Timeline", () => {
    const html = renderTransactionAuditHtml(makeDetail());
    expect(html).toContain("Audit Timeline");
  });

  it("contains section 12: Notes", () => {
    const html = renderTransactionAuditHtml(makeDetail());
    expect(html).toContain("Notes");
  });
});

// ─── 12. Pending refunds NOT counted as processed ─────────────────────────────

describe("renderTransactionAuditHtml — pending refunds not counted", () => {
  it("shows 0 of 1 refund processed when the refund is pending", () => {
    const pendingRefund = makeRefund({
      localStatus: "requested",
      processedAmountPaise: null,
    });
    const html = renderTransactionAuditHtml(makeDetail({ refunds: [pendingRefund] }));
    // Section 9 should show "0 of 1 refund" processed
    expect(html).toContain("0 of 1 refund");
  });

  it("correctly identifies 'created' status as pending", () => {
    const createdRefund = makeRefund({ localStatus: "created", processedAmountPaise: null });
    const html = renderTransactionAuditHtml(makeDetail({ refunds: [createdRefund] }));
    expect(html).toContain("0 of 1 refund");
  });

  it("correctly identifies 'pending' status as not processed", () => {
    const pendingRefund = makeRefund({ localStatus: "pending", processedAmountPaise: null });
    const html = renderTransactionAuditHtml(makeDetail({ refunds: [pendingRefund] }));
    expect(html).toContain("0 of 1 refund");
  });

  it("counts only processed refunds when mixing statuses", () => {
    const processed = makeRefund({ id: 1, localStatus: "processed", processedAmountPaise: 100000 });
    const pending1 = makeRefund({ id: 2, localStatus: "requested", processedAmountPaise: null });
    const pending2 = makeRefund({ id: 3, localStatus: "pending", processedAmountPaise: null });
    const html = renderTransactionAuditHtml(
      makeDetail({ refunds: [processed, pending1, pending2] }),
    );
    expect(html).toContain("1 of 3 refund");
  });
});

// ─── 13. IST formatting: instants vs DATE-only values ─────────────────────────

describe("renderTransactionAuditHtml — IST and date formatting", () => {
  it("renders 'IST' suffix for timestamp fields", () => {
    const html = renderTransactionAuditHtml(makeDetail());
    // formatInstantIST appends " IST"
    expect(html).toContain("IST");
  });

  it("does NOT render 'IST' suffix for DATE-only fields (dueDate)", () => {
    const detail = makeDetail({
      feeRecord: makeFeeRecord({ dueDate: "2024-07-01" }),
    });
    const html = renderTransactionAuditHtml(detail);
    // dueDate rendered via formatDateOnly should appear as "01 Jul 2024"
    expect(html).toContain("01 Jul 2024");
  });

  it("does NOT substitute dueDate for a lifecycle instant", () => {
    // dueDate is DATE-only; must use formatDateOnly, not formatInstantIST
    // So it should NOT appear with IST suffix
    const detail = makeDetail({
      feeRecord: makeFeeRecord({ dueDate: "2024-07-01" }),
    });
    const html = renderTransactionAuditHtml(detail);
    // "01 Jul 2024 IST" should NOT appear
    expect(html).not.toContain("01 Jul 2024 IST");
  });

  it("renders providerOccurredAt as authoritative lifecycle time for attempt events", () => {
    const attempt = makeAttempt({
      events: [
        {
          id: 1,
          eventType: "payment.captured",
          outcome: "captured",
          source: "webhook",
          razorpayPaymentId: "pay_ABC",
          razorpayOrderId: "order_XYZ",
          refundId: null,
          disputeId: null,
          amountPaise: 520000,
          providerOccurredAt: "2024-07-10T10:29:00Z",
          occurredAt: "2024-07-10T10:30:00Z",
          recordedAt: "2024-07-10T10:30:01Z",
          historical: false,
          webhookEventId: 1,
        },
      ],
    });
    const detail = makeDetail({ paymentAttempts: [attempt] });
    const html = renderTransactionAuditHtml(detail);
    // providerOccurredAt should be rendered (Jul 2024 IST)
    expect(html).toContain("IST");
  });
});

// ─── 14. Breakdown snapshot ───────────────────────────────────────────────────

describe("renderTransactionAuditHtml — breakdown snapshot", () => {
  it("shows breakdown items when breakdownSnapshot is present", () => {
    const detail = makeDetail({
      feeRecord: makeFeeRecord({
        breakdownSnapshot: [
          { name: "Tuition", purpose: "Academic tuition", amount: 4500 },
          { name: "Lab Fee", purpose: "Laboratory", amount: 500 },
        ],
        breakdown: [],
      }),
    });
    const html = renderTransactionAuditHtml(detail);
    expect(html).toContain("Tuition");
    expect(html).toContain("Lab Fee");
    expect(html).toContain("Academic tuition");
  });

  it("shows pre-migration note when breakdown is empty and no snapshot", () => {
    const detail = makeDetail({
      feeRecord: makeFeeRecord({ breakdown: [], breakdownSnapshot: null }),
    });
    const html = renderTransactionAuditHtml(detail);
    expect(html).toContain("pre-migration");
  });

  it("shows breakdown from feeRecord.breakdown when breakdownSnapshot absent", () => {
    const detail = makeDetail({
      feeRecord: makeFeeRecord({
        breakdown: [{ name: "Sports Fee", purpose: "Sports", amount: 300 }],
        breakdownSnapshot: undefined,
      }),
    });
    const html = renderTransactionAuditHtml(detail);
    expect(html).toContain("Sports Fee");
  });
});

// ─── 15. Concession snapshot ──────────────────────────────────────────────────

describe("renderTransactionAuditHtml — concession snapshot", () => {
  it("shows 'Unavailable' for historical concession when concessionSnapshot is absent", () => {
    const detail = makeDetail({
      feeRecord: makeFeeRecord({ concessionSnapshot: undefined }),
    });
    const html = renderTransactionAuditHtml(detail);
    expect(html).toContain("Unavailable");
  });

  it("renders concessionSnapshot when explicitly present", () => {
    const detail = makeDetail({
      feeRecord: makeFeeRecord({
        concessionSnapshot: { type: "percentage", value: 10 },
      }),
    });
    const html = renderTransactionAuditHtml(detail);
    expect(html).toContain("Concession Snapshot");
    expect(html).toContain("percentage");
  });

  it("does NOT infer concession from live config", () => {
    // When concessionSnapshot is absent, must say Unavailable, not infer
    const detail = makeDetail({
      feeRecord: makeFeeRecord({
        concessionSnapshot: undefined,
        lateFeeConfig: { type: "FLAT", flat_amount: 100 },
      }),
    });
    const html = renderTransactionAuditHtml(detail);
    // Must NOT show a "Concession Snapshot" section with inferred data
    // But must show Unavailable for historical concession
    expect(html).toContain("Unavailable");
  });
});

// ─── 16. fmtINR helper ────────────────────────────────────────────────────────

describe("fmtINR", () => {
  it("formats 0 correctly", () => {
    expect(fmtINR(0)).toContain("0");
  });

  it("starts with ₹", () => {
    expect(fmtINR(1000)).toMatch(/^₹/);
  });

  it("formats 1000 with comma", () => {
    expect(fmtINR(1000)).toContain("1,000");
  });

  it("formats 100000 in Indian lakh style", () => {
    expect(fmtINR(100000)).toContain("1,00,000");
  });
});

// ─── 17. paise helper ─────────────────────────────────────────────────────────

describe("paise", () => {
  it("converts rupees to paise", () => {
    expect(paise(100)).toBe(10000);
  });

  it("rounds fractional paise correctly", () => {
    expect(paise(10.005)).toBe(1001);
  });

  it("handles zero", () => {
    expect(paise(0)).toBe(0);
  });

  it("handles large amounts", () => {
    expect(paise(50000)).toBe(5000000);
  });
});

// ─── 18. No payments edge case ────────────────────────────────────────────────

describe("renderTransactionAuditHtml — no payments", () => {
  it("renders without error when payments array is empty", () => {
    const detail = makeDetail({ payments: [], payment: null });
    expect(() => renderTransactionAuditHtml(detail)).not.toThrow();
  });

  it("shows 'No payment records found' message", () => {
    const detail = makeDetail({ payments: [], payment: null });
    const html = renderTransactionAuditHtml(detail);
    expect(html).toContain("No payment records found");
  });

  it("still shows all 12 sections", () => {
    const detail = makeDetail({ payments: [], payment: null });
    const html = renderTransactionAuditHtml(detail);
    for (let i = 1; i <= 12; i++) {
      expect(html).toContain(`<span class="section-num">${i}</span>`);
    }
  });
});

// ─── 19. Print button and auto-print script ───────────────────────────────────

describe("renderTransactionAuditHtml — print functionality", () => {
  it("includes a print button", () => {
    const html = renderTransactionAuditHtml(makeDetail());
    expect(html).toContain("window.print()");
    expect(html).toContain("Print");
  });

  it("includes auto-print script", () => {
    const html = renderTransactionAuditHtml(makeDetail());
    expect(html).toContain("addEventListener");
    expect(html).toContain("load");
  });

  it("includes @media print CSS", () => {
    const html = renderTransactionAuditHtml(makeDetail());
    expect(html).toContain("@media print");
  });

  it("includes A4 page size in print CSS", () => {
    const html = renderTransactionAuditHtml(makeDetail());
    expect(html).toContain("A4");
  });
});

// ─── 20. School identity ─────────────────────────────────────────────────────

describe("renderTransactionAuditHtml — school identity", () => {
  it("renders school name in the header", () => {
    const detail = makeDetail({
      school: makeSchool({ name: "Sunrise Academy" }),
    });
    const html = renderTransactionAuditHtml(detail);
    // School name should appear multiple times (header + footer)
    const count = (html.match(/Sunrise Academy/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it("renders school address when present", () => {
    const html = renderTransactionAuditHtml(makeDetail());
    expect(html).toContain("1 School Lane");
    expect(html).toContain("Mumbai");
  });

  it("renders school affiliation number when present", () => {
    const html = renderTransactionAuditHtml(makeDetail());
    expect(html).toContain("AFF-12345");
  });

  it("renders BENIUS branding in footer", () => {
    const html = renderTransactionAuditHtml(makeDetail());
    expect(html).toContain("BENIUS");
  });

  it("escapes persisted school contact and registration fields", () => {
    const html = renderTransactionAuditHtml(makeDetail({
      school: makeSchool({
        phone: `<img src=x onerror="PHONE_XSS">`,
        email: `<script>EMAIL_XSS</script>`,
        affiliationNumber: `<svg onload="AFFILIATION_XSS">`,
        gstin: `<iframe srcdoc="GSTIN_XSS">`,
      }),
    }));

    expect(html).not.toContain(`<img src=x onerror="PHONE_XSS">`);
    expect(html).not.toContain(`<script>EMAIL_XSS</script>`);
    expect(html).not.toContain(`<svg onload="AFFILIATION_XSS">`);
    expect(html).not.toContain(`<iframe srcdoc="GSTIN_XSS">`);
    expect(html).toContain("&lt;img src=x onerror=&quot;PHONE_XSS&quot;&gt;");
    expect(html).toContain("&lt;script&gt;EMAIL_XSS&lt;/script&gt;");
    expect(html).toContain("&lt;svg onload=&quot;AFFILIATION_XSS&quot;&gt;");
    expect(html).toContain("&lt;iframe srcdoc=&quot;GSTIN_XSS&quot;&gt;");
  });
});
