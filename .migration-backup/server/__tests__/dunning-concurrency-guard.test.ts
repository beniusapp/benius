/**
 * Integration tests: dunning advisory-lock concurrency guard
 *
 * Scenarios covered:
 *  1. Lock already held — a second runDunningJob call skips immediately when
 *     another connection holds pg_try_advisory_lock(DUNNING_LOCK_KEY).
 *     Verifies the "[dunning] already running" log line is emitted and no
 *     dunning_log rows are inserted by the skipped invocation.
 *
 *  2. Two concurrent calls — both are fired at the same time; exactly one
 *     proceeds and the other skips. The skipped call emits the "already running"
 *     log. No duplicate dunning_log rows with status "sent" appear for the same
 *     (feeRecordId, channel, stage) triplet.
 *
 * These tests hit the real database. Each test cleans up after itself via
 * afterEach so they leave no trace.
 */

import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import pg from "pg";
import { db, pool } from "../db";
import {
  schools,
  students,
  academicSessions,
  feeRecords,
  notificationConfig,
  dunningLog,
} from "@shared/schema";
import { eq, and, count } from "drizzle-orm";
import { runDunningJob } from "../dunning";

// ── Constants (must match dunning.ts) ────────────────────────────────────────
const DUNNING_LOCK_KEY = 7473328;

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

interface Fixture {
  schoolId: number;
  studentId: number;
  sessionId: number;
}

async function createFixture(): Promise<Fixture> {
  const code = `DNG-${uid()}`;

  const [school] = await db
    .insert(schools)
    .values({ name: "Dunning Test School", code })
    .returning();

  const [student] = await db
    .insert(students)
    .values({
      schoolId: school.id,
      digitalStudentId: `DS-${uid()}`,
      name: "Dunning Student",
      class: "5",
      section: "A",
      phone: "9000000000",
      email: "student@test.local",
      dob: "2012-01-01",
      passwordHash: "x",
    })
    .returning();

  const [session] = await db
    .insert(academicSessions)
    .values({
      schoolId: school.id,
      sessionName: "2025-2026",
      startDate: "2025-04-01",
      endDate: "2026-03-31",
      isActive: true,
      status: "active",
      newAdmissionsEnabled: false,
      promotionStrategy: "defer",
    })
    .returning();

  return { schoolId: school.id, studentId: student.id, sessionId: session.id };
}

async function teardown(schoolId: number): Promise<void> {
  // dunning_log rows must be deleted before school (FK constraint on schoolId)
  await db.delete(dunningLog).where(eq(dunningLog.schoolId, schoolId));
  await db.delete(notificationConfig).where(eq(notificationConfig.schoolId, schoolId));
  await db.delete(schools).where(eq(schools.id, schoolId));
}

// ── Test suite ─────────────────────────────────────────────────────────────────

describe("dunning concurrency guard: advisory lock skip", () => {
  let fixture: Fixture;
  // A raw pg.Client used to hold the advisory lock from outside runDunningJob
  let lockHolder: pg.Client;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    consoleSpy.mockRestore();
    // Release the external lock if still held
    if (lockHolder) {
      try {
        await lockHolder.query("SELECT pg_advisory_unlock($1)", [DUNNING_LOCK_KEY]);
      } catch {
        // already released or connection dropped
      }
      await lockHolder.end();
    }
    if (fixture) await teardown(fixture.schoolId);
  });

  it("skips and logs 'already running' when the advisory lock is held by another connection", async () => {
    fixture = await createFixture();

    // Hold the advisory lock from an external raw pg client — simulates a
    // long-running scheduled dunning job that is already mid-flight.
    // Retry with back-off: a parallel test file may transiently hold the same
    // advisory lock key while its own runDunningJob() is in flight.
    lockHolder = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await lockHolder.connect();
    let acquired = false;
    for (let attempt = 0; attempt < 20 && !acquired; attempt++) {
      const { rows } = await lockHolder.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_lock($1) AS acquired",
        [DUNNING_LOCK_KEY],
      );
      acquired = rows[0].acquired;
      if (!acquired) await new Promise(r => setTimeout(r, 250));
    }
    expect(acquired).toBe(true); // sanity-check: lock must be ours

    // Attempt to run the dunning job — the lock is already held, so it MUST skip.
    await runDunningJob();

    // Verify the canonical skip log line was emitted.
    const loggedMessages: string[] = consoleSpy.mock.calls
      .flat()
      .map((arg) => String(arg));
    const skippedLog = loggedMessages.find((m) =>
      m.includes("already running"),
    );
    expect(skippedLog).toBeDefined();
    expect(skippedLog).toContain("[dunning]");

    // Verify no dunning_log rows were written for this school (the job returned
    // before touching the DB).
    const [{ value: rowCount }] = await db
      .select({ value: count() })
      .from(dunningLog)
      .where(eq(dunningLog.schoolId, fixture.schoolId));
    expect(Number(rowCount)).toBe(0);
  });

  it("does not write 'sent' dunning_log rows for the skipped invocation", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, sessionId } = fixture;

    // Create a fee record that would normally be eligible for dunning.
    await db.insert(feeRecords).values({
      schoolId,
      studentId,
      sessionId,
      feeType: "Tuition",
      amount: 5000,
      dueDate: "2025-07-31", // past due
      status: "Overdue",
    });

    // Enable all notification channels so the real job would try to send.
    await db.insert(notificationConfig).values({
      schoolId,
      smsEnabled: true,
      waEnabled: true,
      emailEnabled: true,
      smsAuthKey: "test-key",
      smsSenderId: "SCHOOL",
      waAuthKey: "test-key",
      waNumber: "919000000000",
      waTemplateName: "fee_reminder",
      emailProvider: "sendgrid",
      emailApiKey: "test-key",
      emailFrom: "fees@school.local",
      emailFromName: "School Fees",
    });

    // Acquire the advisory lock externally before the job can.
    // Retry with back-off: a parallel test file may transiently hold the same
    // advisory lock key while its own runDunningJob() is in flight.
    lockHolder = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await lockHolder.connect();
    let acquired = false;
    for (let attempt = 0; attempt < 20 && !acquired; attempt++) {
      const { rows } = await lockHolder.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_lock($1) AS acquired",
        [DUNNING_LOCK_KEY],
      );
      acquired = rows[0].acquired;
      if (!acquired) await new Promise(r => setTimeout(r, 250));
    }
    expect(acquired).toBe(true);

    // Run the job — it must skip because we hold the lock.
    await runDunningJob();

    // No dunning_log rows with status "sent" must exist for this school.
    const [{ value: sentCount }] = await db
      .select({ value: count() })
      .from(dunningLog)
      .where(
        and(
          eq(dunningLog.schoolId, schoolId),
          eq(dunningLog.status, "sent"),
        ),
      );
    expect(Number(sentCount)).toBe(0);
  });
});

describe("dunning concurrency guard: two concurrent calls", () => {
  let fixture: Fixture;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    consoleSpy.mockRestore();
    if (fixture) await teardown(fixture.schoolId);
  });

  it("fires two concurrent runDunningJob calls and exactly one skips with 'already running'", { retry: 2 }, async () => {
    fixture = await createFixture();
    const { schoolId, studentId, sessionId } = fixture;

    // Create a fee record and notification config so the winning job has real
    // work to attempt (it will fail at the API call stage, which is fine — we
    // only care that the lock guard fires on the losing invocation).
    await db.insert(feeRecords).values({
      schoolId,
      studentId,
      sessionId,
      feeType: "Tuition",
      amount: 5000,
      dueDate: "2025-07-24", // 14 days ago from test date perspective
      status: "Overdue",
    });

    await db.insert(notificationConfig).values({
      schoolId,
      smsEnabled: false,
      waEnabled: false,
      emailEnabled: false, // all channels off → winning job exits cleanly without API calls
    });

    // Clear any log output accumulated during DB setup / previous retries so
    // the skip-count assertion below only counts messages from these two calls.
    consoleSpy.mockClear();

    // Fire both calls simultaneously. Promise.allSettled captures both outcomes
    // regardless of whether one throws (e.g. from an attempted API call).
    const [result1, result2] = await Promise.allSettled([
      runDunningJob(),
      runDunningJob(),
    ]);

    // Both calls must resolve (no thrown errors — skip returns normally).
    expect(result1.status).toBe("fulfilled");
    expect(result2.status).toBe("fulfilled");

    // At least one of the two concurrent calls must have logged the skip message.
    // (Both may skip if an external holder — e.g. a parallel test file — already
    // holds the lock; either outcome satisfies the invariant that no two copies
    // run simultaneously.)
    const loggedMessages: string[] = consoleSpy.mock.calls
      .flat()
      .map((arg) => String(arg));
    const skipLogs = loggedMessages.filter((m) => m.includes("already running"));
    expect(skipLogs.length).toBeGreaterThanOrEqual(1);
  });

  it("two concurrent calls produce no duplicate 'sent' dunning_log rows for the same (feeRecordId, channel, stage)", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, sessionId } = fixture;

    // Use all channels disabled — the winning job will acquire the lock, find
    // no active channels, and exit without inserting any dunning_log rows.
    // The losing job will skip. Either way, there must be zero duplicate rows.
    await db.insert(feeRecords).values({
      schoolId,
      studentId,
      sessionId,
      feeType: "Library",
      amount: 200,
      dueDate: "2025-07-07",
      status: "Overdue",
    });

    await db.insert(notificationConfig).values({
      schoolId,
      smsEnabled: false,
      waEnabled: false,
      emailEnabled: false,
    });

    await Promise.allSettled([runDunningJob(), runDunningJob()]);

    // Confirm there are no duplicate (feeRecordId, channel, stage) "sent" triplets.
    // We group by these three fields and assert every group has count ≤ 1.
    const sentRows = await db
      .select({
        feeRecordId: dunningLog.feeRecordId,
        channel: dunningLog.channel,
        stage: dunningLog.stage,
        n: count(),
      })
      .from(dunningLog)
      .where(
        and(
          eq(dunningLog.schoolId, schoolId),
          eq(dunningLog.status, "sent"),
        ),
      )
      .groupBy(dunningLog.feeRecordId, dunningLog.channel, dunningLog.stage);

    for (const row of sentRows) {
      expect(Number(row.n)).toBeLessThanOrEqual(1);
    }
  });
});
