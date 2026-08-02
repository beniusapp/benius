/**
 * Integration tests: session-filtered payment count correctness at session boundaries.
 *
 * Scenarios covered:
 *  1. Session switch — payment inserted after session 1 is closed and session 2 is
 *     opened lands on session 2, not session 1.
 *  2. No active session — payment inserted while no session is active gets a NULL
 *     sessionId, appears in the school-wide count, but is excluded from every
 *     session-filtered count.
 *
 * These tests hit the real database; each test creates isolated rows under a
 * randomly-suffixed school code and deletes them in afterEach so they leave no trace.
 */

import { describe, it, expect, afterEach } from "vitest";
import { db, pool } from "../db";
import { storage } from "../storage";
import {
  schools,
  students,
  academicSessions,
  paymentRecords,
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
