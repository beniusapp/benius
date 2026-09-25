/**
 * Integration tests: session-filtered payment count correctness at session boundaries.
 *
 * Scenarios covered:
 *  1. Session switch — payment inserted after session 1 is closed and session 2 is
 *     opened lands on session 2, not session 1.
 *  2. No active session — payment inserted while no session is active gets a NULL
 *     sessionId, appears in the school-wide count, but is excluded from every
 *     session-filtered count.
 *  3. Arrears — payment linked to a fee record whose sessionId is session 1, recorded
 *     while session 2 is active, inherits session 1 from the fee record rather than
 *     stamping session 2 from the active session.
 *
 * These tests hit the real database; each test creates isolated rows under a
 * randomly-suffixed school code and deletes them in afterEach so they leave no trace.
 */

import { describe, it, expect, afterEach } from "vitest";
import { db, pool } from "../db";
import { AcademicSessionFinancialHistoryError, storage } from "../storage";
import { recalculateLateFees } from "../late-fee-engine";
import {
  schools,
  students,
  academicSessions,
  paymentRecords,
  feeRecords,
} from "@shared/schema";
import { eq, and } from "drizzle-orm";

// ── helpers ──────────────────────────────────────────────────────────────────

/** Generate a random 8-char suffix so parallel test runs don't collide. */
function uid() {
  return Math.random().toString(36).slice(2, 10);
}

interface Fixture {
  schoolId: number;
  studentId: number;
}

async function createFixture(): Promise<Fixture> {
  const code = `TST-${uid()}`;

  const [school] = await db
    .insert(schools)
    .values({ name: "Test School", code })
    .returning();

  const [student] = await db
    .insert(students)
    .values({
      schoolId: school.id,
      digitalStudentId: `DSID-${uid()}`,
      name: "Test Student",
      class: "1",
      section: "A",
      phone: "9999999999",
      dob: "2010-01-01",
      passwordHash: "x",
    })
    .returning();

  return { schoolId: school.id, studentId: student.id };
}

async function teardown(schoolId: number) {
  // Cascade delete: sessions → paymentRecords (set null) handled by FK;
  // schools cascade to students, sessions, etc.
  await db.delete(schools).where(eq(schools.id, schoolId));
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("payment session boundary: session switch", () => {
  let fixture: Fixture;

  afterEach(async () => {
    if (fixture) await teardown(fixture.schoolId);
  });

  it("payment inserted after session switch is counted only under session 2", async () => {
    fixture = await createFixture();
    const { schoolId, studentId } = fixture;

    // Create two sessions (both inactive initially)
    const session1 = await storage.createAcademicSession({
      schoolId,
      sessionName: "2024-2025",
      startDate: "2024-04-01",
      endDate: "2025-03-31",
      isActive: false,
      status: "active",
      newAdmissionsEnabled: false,
      promotionStrategy: "defer",
    });

    const session2 = await storage.createAcademicSession({
      schoolId,
      sessionName: "2025-2026",
      startDate: "2025-04-01",
      endDate: "2026-03-31",
      isActive: false,
      status: "active",
      newAdmissionsEnabled: false,
      promotionStrategy: "defer",
    });

    // Activate session 1, confirm it is the active session
    await storage.activateAcademicSession(session1.id, schoolId);
    const activeAfterS1 = await storage.getActiveSession(schoolId);
    expect(activeAfterS1?.id).toBe(session1.id);

    // Now switch to session 2 (closes session 1 atomically)
    await storage.activateAcademicSession(session2.id, schoolId);
    const activeAfterS2 = await storage.getActiveSession(schoolId);
    expect(activeAfterS2?.id).toBe(session2.id);

    // Insert a payment — no explicit sessionId, so storage must stamp session 2
    const payment = await storage.createPaymentRecord({
      schoolId,
      studentId,
      paymentMethod: "Cash",
      receivedDate: "2025-05-01",
      amount: 5000,
      feeRecordId: null,
      sessionId: undefined,
    });

    // The stored sessionId must be session 2
    expect(payment.sessionId).toBe(session2.id);

    // getFeeSummary filtered to session 2 must include this payment
    // (offlinePaymentsCount is the relevant field)
    // We can verify by querying the record directly — sessionId is the source of truth
    const [row] = await db
      .select()
      .from(paymentRecords)
      .where(eq(paymentRecords.id, payment.id));

    expect(row.sessionId).toBe(session2.id);
    expect(row.sessionId).not.toBe(session1.id);
  });

  it("getFeeSummary offlinePaymentsCount reflects the correct session after a switch", async () => {
    fixture = await createFixture();
    const { schoolId, studentId } = fixture;

    const session1 = await storage.createAcademicSession({
      schoolId,
      sessionName: "2024-2025",
      startDate: "2024-04-01",
      endDate: "2025-03-31",
      isActive: false,
      status: "active",
      newAdmissionsEnabled: false,
      promotionStrategy: "defer",
    });

    const session2 = await storage.createAcademicSession({
      schoolId,
      sessionName: "2025-2026",
      startDate: "2025-04-01",
      endDate: "2026-03-31",
      isActive: false,
      status: "active",
      newAdmissionsEnabled: false,
      promotionStrategy: "defer",
    });

    // Activate session 1, record a payment under it
    await storage.activateAcademicSession(session1.id, schoolId);
    await storage.createPaymentRecord({
      schoolId,
      studentId,
      paymentMethod: "Cash",
      receivedDate: "2024-06-01",
      amount: 3000,
      feeRecordId: null,
    });

    // Switch to session 2, record another payment
    await storage.activateAcademicSession(session2.id, schoolId);
    await storage.createPaymentRecord({
      schoolId,
      studentId,
      paymentMethod: "Cash",
      receivedDate: "2025-06-01",
      amount: 4000,
      feeRecordId: null,
    });

    // Session 1 filter must see only its own payment (count = 1)
    const s1Summary = await storage.getFeeSummary(schoolId, session1.id);
    expect(s1Summary.offlinePaymentsCount).toBe(1);

    // Session 2 filter must see only its own payment (count = 1)
    const s2Summary = await storage.getFeeSummary(schoolId, session2.id);
    expect(s2Summary.offlinePaymentsCount).toBe(1);

    // School-wide (no filter) must see both payments (count = 2)
    const allSummary = await storage.getFeeSummary(schoolId);
    expect(allSummary.offlinePaymentsCount).toBe(2);
  });
});

describe("payment session boundary: no active session", () => {
  let fixture: Fixture;

  afterEach(async () => {
    if (fixture) await teardown(fixture.schoolId);
  });

  it("payment inserted with no active session gets NULL sessionId", async () => {
    fixture = await createFixture();
    const { schoolId, studentId } = fixture;

    // Confirm there is no active session for this school
    const active = await storage.getActiveSession(schoolId);
    expect(active).toBeUndefined();

    const payment = await storage.createPaymentRecord({
      schoolId,
      studentId,
      paymentMethod: "Cash",
      receivedDate: "2025-01-15",
      amount: 2000,
      feeRecordId: null,
    });

    expect(payment.sessionId).toBeNull();
  });

  it("no-session payment appears in school-wide count but not in any session-filtered count", async () => {
    fixture = await createFixture();
    const { schoolId, studentId } = fixture;

    // Create a session but do NOT activate it — school has no active session
    const session = await storage.createAcademicSession({
      schoolId,
      sessionName: "2025-2026",
      startDate: "2025-04-01",
      endDate: "2026-03-31",
      isActive: false,
      status: "draft",
      newAdmissionsEnabled: false,
      promotionStrategy: "defer",
    });

    // Insert payment with no active session → sessionId = NULL
    await storage.createPaymentRecord({
      schoolId,
      studentId,
      paymentMethod: "BankTransfer",
      receivedDate: "2025-02-20",
      amount: 1500,
      feeRecordId: null,
    });

    // School-wide summary must include this payment
    const allSummary = await storage.getFeeSummary(schoolId);
    expect(allSummary.offlinePaymentsCount).toBe(1);

    // Session-filtered summary must NOT include a NULL-session payment
    const sessionSummary = await storage.getFeeSummary(schoolId, session.id);
    expect(sessionSummary.offlinePaymentsCount).toBe(0);
  });
});

describe("payment session boundary: arrears (fee record in session 1, payment in session 2)", () => {
  let fixture: Fixture;

  afterEach(async () => {
    if (fixture) await teardown(fixture.schoolId);
  });

  it("payment linked to a session-1 fee record inherits session 1, not the active session 2", async () => {
    fixture = await createFixture();
    const { schoolId, studentId } = fixture;

    // Create and activate session 1
    const session1 = await storage.createAcademicSession({
      schoolId,
      sessionName: "2024-2025",
      startDate: "2024-04-01",
      endDate: "2025-03-31",
      isActive: false,
      status: "active",
      newAdmissionsEnabled: false,
      promotionStrategy: "defer",
    });
    await storage.activateAcademicSession(session1.id, schoolId);

    // Insert a fee record while session 1 is active — it belongs to session 1
    const [feeRecord] = await db
      .insert(feeRecords)
      .values({
        schoolId,
        studentId,
        sessionId: session1.id,
        feeType: "Tuition",
        amount: 8000,
        dueDate: "2024-09-30",
        status: "Due",
      })
      .returning();

    expect(feeRecord.sessionId).toBe(session1.id);

    // Switch to session 2 — session 2 is now the active session
    const session2 = await storage.createAcademicSession({
      schoolId,
      sessionName: "2025-2026",
      startDate: "2025-04-01",
      endDate: "2026-03-31",
      isActive: false,
      status: "active",
      newAdmissionsEnabled: false,
      promotionStrategy: "defer",
    });
    await storage.activateAcademicSession(session2.id, schoolId);
    const activeSession = await storage.getActiveSession(schoolId);
    expect(activeSession?.id).toBe(session2.id);

    // Record a payment linked to the session-1 fee record (arrears scenario).
    // No explicit sessionId is passed — storage must resolve it from the fee record.
    const payment = await storage.createPaymentRecord({
      schoolId,
      studentId,
      paymentMethod: "Cash",
      receivedDate: "2025-05-15",
      amount: 8000,
      feeRecordId: feeRecord.id,
    });

    // The payment must inherit session 1 from the linked fee record, not session 2
    expect(payment.sessionId).toBe(session1.id);
    expect(payment.sessionId).not.toBe(session2.id);
  });

  it("getFeeSummary counts the arrears payment under session 1 via feeRecords.sessionId join", async () => {
    fixture = await createFixture();
    const { schoolId, studentId } = fixture;

    // Create sessions
    const session1 = await storage.createAcademicSession({
      schoolId,
      sessionName: "2024-2025",
      startDate: "2024-04-01",
      endDate: "2025-03-31",
      isActive: false,
      status: "active",
      newAdmissionsEnabled: false,
      promotionStrategy: "defer",
    });
    const session2 = await storage.createAcademicSession({
      schoolId,
      sessionName: "2025-2026",
      startDate: "2025-04-01",
      endDate: "2026-03-31",
      isActive: false,
      status: "active",
      newAdmissionsEnabled: false,
      promotionStrategy: "defer",
    });

    // Activate session 1 and create a fee record under it
    await storage.activateAcademicSession(session1.id, schoolId);
    const [feeRecord] = await db
      .insert(feeRecords)
      .values({
        schoolId,
        studentId,
        sessionId: session1.id,
        feeType: "Tuition",
        amount: 6000,
        dueDate: "2024-09-30",
        status: "Due",
      })
      .returning();

    // Switch to session 2, then record the arrears payment for the session-1 fee record
    await storage.activateAcademicSession(session2.id, schoolId);
    await storage.createPaymentRecord({
      schoolId,
      studentId,
      paymentMethod: "Cash",
      receivedDate: "2025-06-01",
      amount: 6000,
      feeRecordId: feeRecord.id,
    });

    // Also record an unlinked payment for session 2 (regular, non-arrears)
    await storage.createPaymentRecord({
      schoolId,
      studentId,
      paymentMethod: "Cash",
      receivedDate: "2025-06-15",
      amount: 3000,
      feeRecordId: null,
    });

    // Session 1 filter must count the arrears payment (payment_records.session_id = session1.id)
    const s1Summary = await storage.getFeeSummary(schoolId, session1.id);
    expect(s1Summary.offlinePaymentsCount).toBe(1);

    // Session 2 filter must count only the regular session-2 payment
    const s2Summary = await storage.getFeeSummary(schoolId, session2.id);
    expect(s2Summary.offlinePaymentsCount).toBe(1);

    // School-wide count must see both payments
    const allSummary = await storage.getFeeSummary(schoolId);
    expect(allSummary.offlinePaymentsCount).toBe(2);
  });

  it("rejects a caller-provided session that conflicts with the linked invoice", async () => {
    fixture = await createFixture();
    const { schoolId, studentId } = fixture;
    const session1 = await storage.createAcademicSession({
      schoolId, sessionName: "2024-2025", startDate: "2024-04-01", endDate: "2025-03-31",
      isActive: false, status: "active", newAdmissionsEnabled: false, promotionStrategy: "defer",
    });
    const session2 = await storage.createAcademicSession({
      schoolId, sessionName: "2025-2026", startDate: "2025-04-01", endDate: "2026-03-31",
      isActive: false, status: "active", newAdmissionsEnabled: false, promotionStrategy: "defer",
    });
    const [invoice] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId: session1.id, feeType: "Tuition",
      amount: 5000, dueDate: "2024-09-30", status: "Due",
    }).returning();

    await expect(storage.createPaymentRecord({
      schoolId, studentId, feeRecordId: invoice.id, sessionId: session2.id,
      paymentMethod: "Cash", receivedDate: "2025-05-01", amount: 5000,
    })).rejects.toThrow("Payment session must match the linked invoice session.");
  });

  it("keeps a session with invoice history from being hard-deleted", async () => {
    fixture = await createFixture();
    const { schoolId, studentId } = fixture;
    const session = await storage.createAcademicSession({
      schoolId, sessionName: "2024-2025", startDate: "2024-04-01", endDate: "2025-03-31",
      isActive: false, status: "active", newAdmissionsEnabled: false, promotionStrategy: "defer",
    });
    await db.insert(feeRecords).values({
      schoolId, studentId, sessionId: session.id, feeType: "Tuition",
      amount: 5000, dueDate: "2024-09-30", status: "Due",
    });

    await expect(storage.deleteAcademicSession(session.id, schoolId))
      .rejects.toBeInstanceOf(AcademicSessionFinancialHistoryError);
    expect(await storage.getAcademicSessionById(session.id, schoolId)).not.toBeNull();
  });
});

describe("overdue sweep session boundary", () => {
  let fixture: Fixture;

  afterEach(async () => {
    if (fixture) await teardown(fixture.schoolId);
  });

  it("marks only active-session invoices overdue and leaves archived history unchanged", async () => {
    fixture = await createFixture();
    const { schoolId, studentId } = fixture;
    const archivedSession = await storage.createAcademicSession({
      schoolId,
      sessionName: "2024-2025",
      startDate: "2024-04-01",
      endDate: "2025-03-31",
      isActive: false,
      status: "archived",
      newAdmissionsEnabled: false,
      promotionStrategy: "defer",
    });
    const activeSession = await storage.createAcademicSession({
      schoolId,
      sessionName: "2025-2026",
      startDate: "2025-04-01",
      endDate: "2026-03-31",
      isActive: false,
      status: "active",
      newAdmissionsEnabled: false,
      promotionStrategy: "defer",
    });
    await storage.activateAcademicSession(activeSession.id, schoolId);

    const [archivedFee] = await db.insert(feeRecords).values({
      schoolId,
      studentId,
      sessionId: archivedSession.id,
      feeType: "Tuition",
      amount: 1000,
      dueDate: "2025-01-01",
      status: "Due",
    }).returning();
    const [activeFee] = await db.insert(feeRecords).values({
      schoolId,
      studentId,
      sessionId: activeSession.id,
      feeType: "Tuition",
      amount: 1000,
      dueDate: "2025-01-01",
      status: "Due",
    }).returning();

    await storage.bulkUpdateOverdueFeeRecords(schoolId);

    const [archivedAfter] = await db.select({ status: feeRecords.status })
      .from(feeRecords).where(eq(feeRecords.id, archivedFee.id));
    const [activeAfter] = await db.select({ status: feeRecords.status })
      .from(feeRecords).where(eq(feeRecords.id, activeFee.id));
    expect(archivedAfter.status).toBe("Due");
    expect(activeAfter.status).toBe("Overdue");
  });
});

describe("late-fee recalculation session boundary", () => {
  let fixture: Fixture;

  afterEach(async () => {
    if (fixture) await teardown(fixture.schoolId);
  });

  it("updates only active-session invoices and preserves archived invoice late fees", async () => {
    fixture = await createFixture();
    const { schoolId, studentId } = fixture;
    const archivedSession = await storage.createAcademicSession({
      schoolId, sessionName: "2024-2025", startDate: "2024-04-01", endDate: "2025-03-31",
      isActive: false, status: "archived", newAdmissionsEnabled: false, promotionStrategy: "defer",
    });
    const activeSession = await storage.createAcademicSession({
      schoolId, sessionName: "2025-2026", startDate: "2025-04-01", endDate: "2026-03-31",
      isActive: false, status: "active", newAdmissionsEnabled: false, promotionStrategy: "defer",
    });
    await storage.activateAcademicSession(activeSession.id, schoolId);
    const lateFeeConfig = {
      enabled: true, type: "FLAT", grace_period_days: 0, flat_amount: 75,
      daily_rate: 0, max_cap: 0, tiered_slabs: [],
    };
    const [archivedFee] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId: archivedSession.id, feeType: "Tuition",
      amount: 1000, dueDate: "2025-01-01", status: "Due", lateFeeAmount: 11, lateFeeConfig,
    }).returning();
    const [activeFee] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId: activeSession.id, feeType: "Tuition",
      amount: 1000, dueDate: "2025-01-01", status: "Due", lateFeeAmount: 0, lateFeeConfig,
    }).returning();

    await recalculateLateFees(schoolId);

    const [archivedAfter] = await db.select({ lateFeeAmount: feeRecords.lateFeeAmount })
      .from(feeRecords).where(eq(feeRecords.id, archivedFee.id));
    const [activeAfter] = await db.select({ lateFeeAmount: feeRecords.lateFeeAmount })
      .from(feeRecords).where(eq(feeRecords.id, activeFee.id));
    expect(archivedAfter.lateFeeAmount).toBe(11);
    expect(activeAfter.lateFeeAmount).toBe(75);
  });
});
