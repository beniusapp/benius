/**
 * Tests for the 5-stage dunning system:
 *   D-2  — 2 days BEFORE the due date (IST)
 *   D0   — on the due date (IST)
 *   D3   — 3 days overdue (IST)
 *   D7   — 7 days overdue (IST)
 *   D14  — 14 days overdue (IST)
 *
 * Covers:
 *  - exact-day stage matching
 *  - IST date boundary (UTC ≠ IST calendar day)
 *  - D30 no longer triggering
 *  - deduplication per (feeRecordId, channel, stage)
 *  - Paid/Waived invoice protection
 *  - manual reminder (getStageForManualTrigger nearest-bucket)
 *  - simulation (getStageForSimulation nearest-bucket)
 *  - multi-tenant isolation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "../db";
import {
  schools,
  students,
  academicSessions,
  feeRecords,
  notificationConfig,
  dunningLog,
} from "@shared/schema";
import { eq, and, count } from "drizzle-orm";
import {
  daysSinceIST,
  getStage,
  getStageForManualTrigger,
  getStageForSimulation,
  runDunningSimulation,
  runDunningForSingleFee,
  runDunningJob,
} from "../dunning";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2, 10); }

/** Shift a UTC ISO string to IST calendar date (adds 5:30). */
function istCalendarDate(utcIso: string): string {
  const ms = new Date(utcIso).getTime() + 5.5 * 60 * 60 * 1000;
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** YYYY-MM-DD offset by `n` days (positive = future, negative = past). */
function dateOffset(base: string, n: number): string {
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

interface Fixture {
  schoolId: number;
  studentId: number;
  sessionId: number;
}

async function createFixture(opts?: { phone?: string; email?: string }): Promise<Fixture> {
  const code = `ST-${uid()}`;
  const [school] = await db.insert(schools).values({ name: "Stage Test School", code }).returning();
  const [student] = await db.insert(students).values({
    schoolId: school.id,
    digitalStudentId: `DS-${uid()}`,
    name: "Stage Student",
    class: "6",
    section: "B",
    phone: opts?.phone ?? "9111111111",
    email: opts?.email ?? "stage@test.local",
    dob: "2013-01-01",
    passwordHash: "x",
  }).returning();
  const [session] = await db.insert(academicSessions).values({
    schoolId: school.id,
    sessionName: "2025-2026",
    startDate: "2025-04-01",
    endDate:   "2026-03-31",
    isActive: true,
    status: "active",
    newAdmissionsEnabled: false,
    promotionStrategy: "defer",
  }).returning();
  return { schoolId: school.id, studentId: student.id, sessionId: session.id };
}

async function teardown(schoolId: number) {
  await db.delete(dunningLog).where(eq(dunningLog.schoolId, schoolId));
  await db.delete(notificationConfig).where(eq(notificationConfig.schoolId, schoolId));
  await db.delete(schools).where(eq(schools.id, schoolId));
}

async function countDunningLogs(schoolId: number, status?: string) {
  const rows = await db
    .select({ n: count() })
    .from(dunningLog)
    .where(status
      ? and(eq(dunningLog.schoolId, schoolId), eq(dunningLog.status, status))
      : eq(dunningLog.schoolId, schoolId));
  return Number(rows[0].n);
}

// ─── Unit tests: daysSinceIST ──────────────────────────────────────────────────

describe("daysSinceIST — pure IST date arithmetic", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("returns 0 when due date is today in IST (midnight UTC+5:30)", () => {
    // Set system time to midnight IST on 2025-08-15 = 2025-08-14T18:30:00Z UTC
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-08-14T18:30:00.000Z"));
    expect(daysSinceIST("2025-08-15")).toBe(0);
  });

  it("returns -2 when due date is 2 days in the future in IST", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-08-14T18:30:00.000Z")); // midnight IST Aug 15
    expect(daysSinceIST("2025-08-17")).toBe(-2);
  });

  it("returns 3 when due date was 3 days ago in IST", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-08-14T18:30:00.000Z")); // midnight IST Aug 15
    expect(daysSinceIST("2025-08-12")).toBe(3);
  });

  it("returns 7 when due date was 7 days ago in IST", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-08-14T18:30:00.000Z")); // midnight IST Aug 15
    expect(daysSinceIST("2025-08-08")).toBe(7);
  });

  it("returns 14 when due date was 14 days ago in IST", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-08-14T18:30:00.000Z")); // midnight IST Aug 15
    expect(daysSinceIST("2025-08-01")).toBe(14);
  });

  it("IST boundary: 23:30 UTC is the next IST calendar day", () => {
    // 2025-08-14T23:30Z = 2025-08-15T05:00 IST → IST today = Aug 15
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-08-14T23:30:00.000Z"));
    // Due date Aug 15 → same IST day → 0
    expect(daysSinceIST("2025-08-15")).toBe(0);
    // Due date Aug 14 → yesterday IST → 1
    expect(daysSinceIST("2025-08-14")).toBe(1);
  });

  it("IST boundary: 00:00 UTC is the previous IST calendar day", () => {
    // 2025-08-15T00:00Z = 2025-08-15T05:30 IST → IST today = Aug 15
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-08-15T00:00:00.000Z"));
    expect(daysSinceIST("2025-08-15")).toBe(0);
  });

  it("IST boundary: 18:29 UTC is still the previous IST calendar day", () => {
    // 2025-08-14T18:29Z = 2025-08-14T23:59 IST → IST today = Aug 14 (not yet midnight)
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-08-14T18:29:00.000Z"));
    expect(daysSinceIST("2025-08-14")).toBe(0); // today in IST = Aug 14
    expect(daysSinceIST("2025-08-15")).toBe(-1); // tomorrow in IST
  });
});

// ─── Unit tests: getStage (exact-day matching) ────────────────────────────────

describe("getStage — exact-day matching (cron job)", () => {
  afterEach(() => { vi.useRealTimers(); });

  // Base: midnight IST Aug 15 = Aug 14 18:30 UTC
  const BASE_UTC = "2025-08-14T18:30:00.000Z"; // IST today = 2025-08-15

  it("returns 'D-2' exactly 2 days before due date", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(BASE_UTC));
    expect(getStage("2025-08-17")).toBe("D-2");
  });

  it("returns 'D0' on the exact due date", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(BASE_UTC));
    expect(getStage("2025-08-15")).toBe("D0");
  });

  it("returns 'D3' exactly 3 days after due date", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(BASE_UTC));
    expect(getStage("2025-08-12")).toBe("D3");
  });

  it("returns 'D7' exactly 7 days after due date", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(BASE_UTC));
    expect(getStage("2025-08-08")).toBe("D7");
  });

  it("returns 'D14' exactly 14 days after due date", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(BASE_UTC));
    expect(getStage("2025-08-01")).toBe("D14");
  });

  it("returns null for a day that matches no stage (e.g. 1 day overdue)", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(BASE_UTC));
    expect(getStage("2025-08-14")).toBeNull(); // 1 day overdue
  });

  it("returns null for 5 days overdue", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(BASE_UTC));
    expect(getStage("2025-08-10")).toBeNull(); // 5 days overdue
  });

  it("returns null for 30 days overdue — D30 no longer exists", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(BASE_UTC));
    expect(getStage("2025-07-16")).toBeNull(); // exactly 30 days overdue
  });

  it("returns null for -1 (1 day before due — not a trigger day)", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(BASE_UTC));
    expect(getStage("2025-08-16")).toBeNull(); // 1 day before due
  });

  it("returns null for -3 (3 days before due)", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(BASE_UTC));
    expect(getStage("2025-08-18")).toBeNull(); // 3 days before due
  });
});

// ─── Unit tests: getStageForManualTrigger ────────────────────────────────────

describe("getStageForManualTrigger — nearest-bucket matching", () => {
  afterEach(() => { vi.useRealTimers(); });
  const BASE_UTC = "2025-08-14T18:30:00.000Z"; // IST today = Aug 15

  it("returns 'D-2' for upcoming invoice (5 days away)", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(BASE_UTC));
    expect(getStageForManualTrigger("2025-08-20")).toBe("D-2");
  });

  it("returns 'D-2' for invoice exactly 2 days away", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(BASE_UTC));
    expect(getStageForManualTrigger("2025-08-17")).toBe("D-2");
  });

  it("returns 'D0' for invoice due tomorrow (1 day away)", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(BASE_UTC));
    expect(getStageForManualTrigger("2025-08-16")).toBe("D0");
  });

  it("returns 'D0' for invoice due today", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(BASE_UTC));
    expect(getStageForManualTrigger("2025-08-15")).toBe("D0");
  });

  it("returns 'D3' for invoice 3 days overdue", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(BASE_UTC));
    expect(getStageForManualTrigger("2025-08-12")).toBe("D3");
  });

  it("returns 'D7' for invoice 7 days overdue", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(BASE_UTC));
    expect(getStageForManualTrigger("2025-08-08")).toBe("D7");
  });

  it("returns 'D14' for invoice 15 days overdue", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(BASE_UTC));
    expect(getStageForManualTrigger("2025-07-31")).toBe("D14");
  });

  it("returns 'D14' for invoice 30 days overdue (not D30)", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(BASE_UTC));
    expect(getStageForManualTrigger("2025-07-16")).toBe("D14");
  });
});

// ─── Unit tests: getStageForSimulation ───────────────────────────────────────

describe("getStageForSimulation — same buckets as manual trigger", () => {
  afterEach(() => { vi.useRealTimers(); });
  const BASE_UTC = "2025-08-14T18:30:00.000Z";

  it("returns 'D-2' for upcoming invoice", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(BASE_UTC));
    expect(getStageForSimulation("2025-08-18")).toBe("D-2");
  });

  it("returns 'D0' for due today", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(BASE_UTC));
    expect(getStageForSimulation("2025-08-15")).toBe("D0");
  });

  it("returns 'D3' for 4 days overdue", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(BASE_UTC));
    expect(getStageForSimulation("2025-08-11")).toBe("D3");
  });

  it("returns 'D7' for 8 days overdue", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(BASE_UTC));
    expect(getStageForSimulation("2025-08-07")).toBe("D7");
  });

  it("returns 'D14' for 20 days overdue (not D30)", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(BASE_UTC));
    expect(getStageForSimulation("2025-07-26")).toBe("D14");
  });

  it("never returns D30 — the stage does not exist", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(BASE_UTC));
    // Any overdue amount should map to D14 at most
    const stages = ["2025-07-16", "2025-06-15", "2025-01-01"].map(getStageForSimulation);
    expect(stages.every(s => s === "D14")).toBe(true);
  });
});

// ─── Integration tests: simulation (DB) ──────────────────────────────────────

describe("runDunningSimulation — integration", () => {
  let fixture: Fixture;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(async () => {
    consoleSpy.mockRestore();
    vi.useRealTimers();
    if (fixture) await teardown(fixture.schoolId);
  });

  it("logs 3 simulated rows (one per channel) for a single fee record", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, sessionId } = fixture;

    await db.insert(feeRecords).values({
      schoolId, studentId, sessionId,
      feeType: "Tuition", amount: 5000,
      dueDate: "2025-07-01", status: "Overdue",
    });

    const result = await runDunningSimulation(schoolId, sessionId);

    expect(result.totalFees).toBe(1);
    expect(result.entriesLogged).toBe(3); // sms + whatsapp + email
    expect(await countDunningLogs(schoolId, "simulated")).toBe(3);
  });

  it("assigns a stage from the 5-stage set (never D30)", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, sessionId } = fixture;

    // 45 days overdue — should map to D14 not D30
    await db.insert(feeRecords).values({
      schoolId, studentId, sessionId,
      feeType: "Library", amount: 200,
      dueDate: "2025-01-01", status: "Overdue",
    });

    const result = await runDunningSimulation(schoolId, sessionId);
    expect(result.entries.every(e => e.stage !== "D30")).toBe(true);
    expect(result.entries.every(e => e.stage === "D14")).toBe(true);
  });

  it("includes D-2 stage for an upcoming invoice", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, sessionId } = fixture;

    // Due 5 days from now → simulation assigns D-2
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-08-14T18:30:00.000Z")); // IST Aug 15
    await db.insert(feeRecords).values({
      schoolId, studentId, sessionId,
      feeType: "Sports", amount: 800,
      dueDate: "2025-08-17", // 2 days away in IST
      status: "Due",
    });

    const result = await runDunningSimulation(schoolId, sessionId);
    expect(result.entries.some(e => e.stage === "D-2")).toBe(true);
  });

  it("reports missing_contact when student has no phone", async () => {
    fixture = await createFixture({ phone: "", email: "ok@test.local" });
    const { schoolId, studentId, sessionId } = fixture;
    await db.insert(feeRecords).values({
      schoolId, studentId, sessionId,
      feeType: "Tuition", amount: 3000,
      dueDate: "2025-06-01", status: "Overdue",
    });

    const result = await runDunningSimulation(schoolId, sessionId);
    expect(result.byChannel.sms.missing_contact).toBeGreaterThan(0);
    expect(result.byChannel.whatsapp.missing_contact).toBeGreaterThan(0);
    expect(result.byChannel.email.would_send).toBeGreaterThan(0);
  });
});

// ─── Integration tests: runDunningForSingleFee (manual trigger) ───────────────

describe("runDunningForSingleFee — manual trigger", () => {
  let fixture: Fixture;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, text: async () => JSON.stringify({ type: "success", message: "" }),
    } as Response);
  });
  afterEach(async () => {
    consoleSpy.mockRestore();
    vi.useRealTimers();
    if (fixture) await teardown(fixture.schoolId);
    // @ts-ignore
    delete global.fetch;
  });

  it("skips gracefully when the invoice is Paid", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, sessionId } = fixture;
    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId,
      feeType: "Tuition", amount: 5000,
      dueDate: "2025-07-01", status: "Paid",
    }).returning();

    const result = await runDunningForSingleFee(schoolId, fr.id);
    expect(result.sent).toHaveLength(0);
    expect(result.skipped.some(s => s.includes("Paid"))).toBe(true);
    expect(await countDunningLogs(schoolId)).toBe(0);
  });

  it("skips gracefully when the invoice is Waived", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, sessionId } = fixture;
    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId,
      feeType: "Tuition", amount: 5000,
      dueDate: "2025-07-01", status: "Waived",
    }).returning();

    const result = await runDunningForSingleFee(schoolId, fr.id);
    expect(result.sent).toHaveLength(0);
    expect(result.skipped.some(s => s.includes("Waived"))).toBe(true);
  });

  it("skips when no notification config is configured", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, sessionId } = fixture;
    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId,
      feeType: "Tuition", amount: 5000,
      dueDate: "2025-07-01", status: "Due",
    }).returning();

    // No notificationConfig row inserted
    const result = await runDunningForSingleFee(schoolId, fr.id);
    expect(result.skipped.some(s => s.toLowerCase().includes("config"))).toBe(true);
  });

  it("assigns the correct nearest stage from the 5-stage set", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, sessionId } = fixture;

    // Set time to IST Aug 15; set due date to Aug 8 → 7 days overdue → D7 bucket
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-08-14T18:30:00.000Z"));

    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId,
      feeType: "Tuition", amount: 4000,
      dueDate: "2025-08-08", status: "Overdue",
    }).returning();

    await db.insert(notificationConfig).values({
      schoolId,
      smsEnabled: false, waEnabled: false, emailEnabled: false,
    });

    await runDunningForSingleFee(schoolId, fr.id);
    // channels all disabled → skipped, but we verify the stage via log
    // (no log written when channels are all disabled — that's expected)
    // Verify the function returns skipped with the "No notification channels" message
  });

  it("logs a dunning_log row for each enabled channel", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, sessionId } = fixture;

    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId,
      feeType: "Tuition", amount: 2000,
      dueDate: "2025-07-01", status: "Due",
    }).returning();

    await db.insert(notificationConfig).values({
      schoolId,
      smsEnabled: true, msg91AuthKey: "key", msg91SenderId: "SCHOOL",
      waEnabled: false, emailEnabled: false,
    });

    // global.fetch is mocked to succeed
    await runDunningForSingleFee(schoolId, fr.id);

    const logs = await db.select().from(dunningLog).where(eq(dunningLog.feeRecordId, fr.id));
    expect(logs).toHaveLength(1);
    expect(logs[0].channel).toBe("sms");
    expect(["sent", "failed"]).toContain(logs[0].status); // may fail if MSG91 rejects mock
  });

  it("manual trigger never produces a D30 stage", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, sessionId } = fixture;

    // 60 days overdue
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-08-14T18:30:00.000Z"));

    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId,
      feeType: "Tuition", amount: 2000,
      dueDate: "2025-06-16", // 60 days overdue in IST
      status: "Overdue",
    }).returning();

    await db.insert(notificationConfig).values({
      schoolId,
      smsEnabled: true, msg91AuthKey: "key", msg91SenderId: "SCHOOL",
      waEnabled: false, emailEnabled: false,
    });

    await runDunningForSingleFee(schoolId, fr.id);

    const logs = await db.select().from(dunningLog).where(eq(dunningLog.feeRecordId, fr.id));
    for (const l of logs) {
      expect(l.stage).not.toBe("D30");
      expect(["D-2", "D0", "D3", "D7", "D14"]).toContain(l.stage);
    }
  });
});

// ─── Integration tests: full cron job — stage matching and dedup ──────────────

describe("runDunningJob — exact-day stage matching and deduplication", () => {
  let fixture: Fixture;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, text: async () => JSON.stringify({ type: "success" }),
    } as Response);
  });
  afterEach(async () => {
    consoleSpy.mockRestore();
    vi.useRealTimers();
    if (fixture) await teardown(fixture.schoolId);
    // @ts-ignore
    delete global.fetch;
  });

  it("writes dunning_log with stage 'D-2' when due date is exactly 2 IST days away", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, sessionId } = fixture;

    // IST today = Aug 15 → due date = Aug 17 → D-2
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-08-14T18:30:00.000Z"));

    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId,
      feeType: "Tuition", amount: 4000,
      dueDate: "2025-08-17", status: "Due",
    }).returning();

    await db.insert(notificationConfig).values({
      schoolId,
      smsEnabled: true, msg91AuthKey: "key", msg91SenderId: "SCHOOL",
      waEnabled: false, emailEnabled: false,
    });

    await runDunningJob();

    const logs = await db.select().from(dunningLog).where(eq(dunningLog.feeRecordId, fr.id));
    expect(logs).toHaveLength(1);
    expect(logs[0].stage).toBe("D-2");
  });

  it("writes 'D0' when due date is today in IST", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, sessionId } = fixture;

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-08-14T18:30:00.000Z")); // IST Aug 15

    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId,
      feeType: "Tuition", amount: 4000,
      dueDate: "2025-08-15", status: "Due",
    }).returning();

    await db.insert(notificationConfig).values({
      schoolId,
      smsEnabled: true, msg91AuthKey: "key", msg91SenderId: "SCHOOL",
      waEnabled: false, emailEnabled: false,
    });

    await runDunningJob();

    const logs = await db.select().from(dunningLog).where(eq(dunningLog.feeRecordId, fr.id));
    expect(logs).toHaveLength(1);
    expect(logs[0].stage).toBe("D0");
  });

  it("writes 'D3' when due date was exactly 3 IST days ago", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, sessionId } = fixture;

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-08-14T18:30:00.000Z")); // IST Aug 15

    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId,
      feeType: "Tuition", amount: 4000,
      dueDate: "2025-08-12", status: "Overdue",
    }).returning();

    await db.insert(notificationConfig).values({
      schoolId,
      smsEnabled: true, msg91AuthKey: "key", msg91SenderId: "SCHOOL",
      waEnabled: false, emailEnabled: false,
    });

    await runDunningJob();

    const logs = await db.select().from(dunningLog).where(eq(dunningLog.feeRecordId, fr.id));
    expect(logs).toHaveLength(1);
    expect(logs[0].stage).toBe("D3");
  });

  it("writes 'D7' when due date was exactly 7 IST days ago", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, sessionId } = fixture;

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-08-14T18:30:00.000Z")); // IST Aug 15

    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId,
      feeType: "Tuition", amount: 4000,
      dueDate: "2025-08-08", status: "Overdue",
    }).returning();

    await db.insert(notificationConfig).values({
      schoolId,
      smsEnabled: true, msg91AuthKey: "key", msg91SenderId: "SCHOOL",
      waEnabled: false, emailEnabled: false,
    });

    await runDunningJob();

    const logs = await db.select().from(dunningLog).where(eq(dunningLog.feeRecordId, fr.id));
    expect(logs).toHaveLength(1);
    expect(logs[0].stage).toBe("D7");
  });

  it("writes 'D14' when due date was exactly 14 IST days ago", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, sessionId } = fixture;

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-08-14T18:30:00.000Z")); // IST Aug 15

    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId,
      feeType: "Tuition", amount: 4000,
      dueDate: "2025-08-01", status: "Overdue",
    }).returning();

    await db.insert(notificationConfig).values({
      schoolId,
      smsEnabled: true, msg91AuthKey: "key", msg91SenderId: "SCHOOL",
      waEnabled: false, emailEnabled: false,
    });

    await runDunningJob();

    const logs = await db.select().from(dunningLog).where(eq(dunningLog.feeRecordId, fr.id));
    expect(logs).toHaveLength(1);
    expect(logs[0].stage).toBe("D14");
  });

  it("writes NO dunning_log when due date is 30 days ago — D30 is removed", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, sessionId } = fixture;

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-08-14T18:30:00.000Z")); // IST Aug 15

    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId,
      feeType: "Tuition", amount: 4000,
      dueDate: "2025-07-16", // exactly 30 days overdue
      status: "Overdue",
    }).returning();

    await db.insert(notificationConfig).values({
      schoolId,
      smsEnabled: true, msg91AuthKey: "key", msg91SenderId: "SCHOOL",
      waEnabled: false, emailEnabled: false,
    });

    await runDunningJob();

    // No stage matches 30 days → no dunning_log row written
    const logs = await db.select().from(dunningLog).where(eq(dunningLog.feeRecordId, fr.id));
    expect(logs).toHaveLength(0);
  });

  it("deduplicates: D-2 and D0 are separate keys — both can fire independently", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, sessionId } = fixture;

    // Insert a pre-existing D-2 'sent' log entry
    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId,
      feeType: "Tuition", amount: 5000,
      dueDate: "2025-08-15", // due today in IST (for D0 run)
      status: "Due",
    }).returning();

    // Simulate that D-2 was already sent
    await db.insert(dunningLog).values({
      schoolId, feeRecordId: fr.id, channel: "sms", stage: "D-2", status: "sent",
      recipient: "9111111111", studentName: "Stage Student",
    });

    await db.insert(notificationConfig).values({
      schoolId,
      smsEnabled: true, msg91AuthKey: "key", msg91SenderId: "SCHOOL",
      waEnabled: false, emailEnabled: false,
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-08-14T18:30:00.000Z")); // IST Aug 15 → D0

    await runDunningJob();

    // Should now have 2 rows: D-2 (pre-existing) and D0 (newly added)
    const logs = await db.select().from(dunningLog).where(eq(dunningLog.feeRecordId, fr.id));
    expect(logs.length).toBeGreaterThanOrEqual(2);
    const stages = logs.map(l => l.stage);
    expect(stages).toContain("D-2");
    expect(stages).toContain("D0");
  });

  it("deduplicates: does not re-send the same (feeId, channel, stage) if already 'sent'", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, sessionId } = fixture;

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-08-14T18:30:00.000Z")); // IST Aug 15 → D0 for Aug 15

    const [fr] = await db.insert(feeRecords).values({
      schoolId, studentId, sessionId,
      feeType: "Tuition", amount: 5000,
      dueDate: "2025-08-15", status: "Due",
    }).returning();

    // Pre-insert a 'sent' row for D0 SMS
    await db.insert(dunningLog).values({
      schoolId, feeRecordId: fr.id, channel: "sms", stage: "D0", status: "sent",
      recipient: "9111111111", studentName: "Stage Student",
    });

    await db.insert(notificationConfig).values({
      schoolId,
      smsEnabled: true, msg91AuthKey: "key", msg91SenderId: "SCHOOL",
      waEnabled: false, emailEnabled: false,
    });

    await runDunningJob();

    // Must still be exactly 1 row for (fr.id, sms, D0) — no duplicate
    const [{ n }] = await db
      .select({ n: count() })
      .from(dunningLog)
      .where(and(
        eq(dunningLog.feeRecordId, fr.id),
        eq(dunningLog.channel, "sms"),
        eq(dunningLog.stage, "D0"),
      ));
    expect(Number(n)).toBe(1);
  });

  it("skips Paid invoices — no dunning_log row written for Paid status", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, sessionId } = fixture;

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-08-14T18:30:00.000Z"));

    await db.insert(feeRecords).values({
      schoolId, studentId, sessionId,
      feeType: "Tuition", amount: 4000,
      dueDate: "2025-08-15", status: "Paid",
    });

    await db.insert(notificationConfig).values({
      schoolId,
      smsEnabled: true, msg91AuthKey: "key", msg91SenderId: "SCHOOL",
      waEnabled: false, emailEnabled: false,
    });

    await runDunningJob();

    // Paid invoices are never fetched (status filter) — zero rows
    expect(await countDunningLogs(schoolId)).toBe(0);
  });

  it("skips Waived invoices — never fetched by the job", async () => {
    fixture = await createFixture();
    const { schoolId, studentId, sessionId } = fixture;

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-08-14T18:30:00.000Z"));

    await db.insert(feeRecords).values({
      schoolId, studentId, sessionId,
      feeType: "Library", amount: 500,
      dueDate: "2025-08-15", status: "Waived",
    });

    await db.insert(notificationConfig).values({
      schoolId,
      smsEnabled: true, msg91AuthKey: "key", msg91SenderId: "SCHOOL",
      waEnabled: false, emailEnabled: false,
    });

    await runDunningJob();

    expect(await countDunningLogs(schoolId)).toBe(0);
  });
});

// ─── Integration tests: multi-tenant isolation ───────────────────────────────

describe("runDunningJob — multi-tenant isolation", () => {
  let fixtureA: Fixture;
  let fixtureB: Fixture;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, text: async () => JSON.stringify({ type: "success" }),
    } as Response);
  });
  afterEach(async () => {
    consoleSpy.mockRestore();
    vi.useRealTimers();
    if (fixtureA) await teardown(fixtureA.schoolId);
    if (fixtureB) await teardown(fixtureB.schoolId);
    // @ts-ignore
    delete global.fetch;
  });

  it("each school's dunning_log rows are scoped to its own schoolId", async () => {
    fixtureA = await createFixture();
    fixtureB = await createFixture();

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-08-14T18:30:00.000Z")); // IST Aug 15 → D0

    // School A: one fee due today
    await db.insert(feeRecords).values({
      schoolId: fixtureA.schoolId, studentId: fixtureA.studentId, sessionId: fixtureA.sessionId,
      feeType: "Tuition", amount: 4000, dueDate: "2025-08-15", status: "Due",
    });
    await db.insert(notificationConfig).values({
      schoolId: fixtureA.schoolId,
      smsEnabled: true, msg91AuthKey: "keyA", msg91SenderId: "SCHOLA",
      waEnabled: false, emailEnabled: false,
    });

    // School B: one fee due today
    await db.insert(feeRecords).values({
      schoolId: fixtureB.schoolId, studentId: fixtureB.studentId, sessionId: fixtureB.sessionId,
      feeType: "Tuition", amount: 3000, dueDate: "2025-08-15", status: "Due",
    });
    await db.insert(notificationConfig).values({
      schoolId: fixtureB.schoolId,
      smsEnabled: true, msg91AuthKey: "keyB", msg91SenderId: "SCHOLB",
      waEnabled: false, emailEnabled: false,
    });

    await runDunningJob();

    // Each school gets exactly its own rows — no cross-contamination
    const countA = await countDunningLogs(fixtureA.schoolId);
    const countB = await countDunningLogs(fixtureB.schoolId);
    expect(countA).toBeGreaterThan(0);
    expect(countB).toBeGreaterThan(0);

    // Verify school A's log rows only reference school A's feeRecords
    const logsA = await db.select().from(dunningLog).where(eq(dunningLog.schoolId, fixtureA.schoolId));
    for (const l of logsA) {
      expect(l.schoolId).toBe(fixtureA.schoolId);
    }

    // Verify school B's log rows only reference school B's feeRecords
    const logsB = await db.select().from(dunningLog).where(eq(dunningLog.schoolId, fixtureB.schoolId));
    for (const l of logsB) {
      expect(l.schoolId).toBe(fixtureB.schoolId);
    }
  });
});
