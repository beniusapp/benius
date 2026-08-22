import { afterEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "../db";
import {
  CURRENT_FEE_AUDIT_ACTION_OPTIONS,
  isCurrentFeeAuditAction,
  validateFeeAuditDateRange,
} from "../fee-audit";
import { storage } from "../storage";
import { schools, students } from "@shared/schema";

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

const schoolIds: number[] = [];

async function createSchool(name = "Fee Audit Filter School"): Promise<number> {
  const [school] = await db.insert(schools).values({
    name,
    code: `FAF-${uid()}`,
  }).returning();
  schoolIds.push(school.id);
  return school.id;
}

async function createStudent(schoolId: number, name: string, digitalStudentId: string) {
  const [student] = await db.insert(students).values({
    schoolId,
    digitalStudentId,
    name,
    class: "9",
    section: "A",
    phone: "9100000000",
    dob: "2008-03-15",
    passwordHash: "x",
    isActive: true,
  }).returning();
  return student;
}

async function insertAudit(input: {
  schoolId: number;
  action: string;
  entityId: number;
  actorName?: string;
  actorIdentifier?: string;
  studentId?: number | null;
  studentName?: string | null;
  studentIdentifier?: string | null;
  recordLabel?: string | null;
  description?: string;
  createdAt?: string;
}): Promise<number> {
  const createdAt = input.createdAt
    ? sql`${input.createdAt}::timestamp`
    : sql`NOW()`;
  const result = await db.execute(sql`
    INSERT INTO fee_audit_log (
      school_id, actor_type, actor_name, actor_role, actor_identifier,
      action, entity_type, entity_id, student_id, student_name,
      student_identifier, record_label, description, created_at
    ) VALUES (
      ${input.schoolId}, 'principal', ${input.actorName ?? "Principal One"},
      'Principal', ${input.actorIdentifier ?? "USR-0001"},
      ${input.action}, 'fee_record', ${input.entityId}, ${input.studentId ?? null},
      ${input.studentName ?? null}, ${input.studentIdentifier ?? null},
      ${input.recordLabel ?? null}, ${input.description ?? "Activity recorded."},
      ${createdAt}
    )
    RETURNING id
  `);
  return Number((result.rows[0] as any).id);
}

afterEach(async () => {
  while (schoolIds.length > 0) {
    const schoolId = schoolIds.pop()!;
    await db.transaction(async tx => {
      await tx.execute(sql`SELECT set_config('app.fee_audit_cleanup', 'on', true)`);
      await tx.execute(sql`DELETE FROM schools WHERE id = ${schoolId}`);
    });
  }
});

describe("fee audit filter contract", () => {
  it("searches safe human-readable fields partially and case-insensitively", async () => {
    const schoolId = await createSchool();
    const otherSchoolId = await createSchool("Other Tenant");
    const student = await createStudent(schoolId, "Student Three Mis", "DSID-3007");
    const searchableId = await insertAudit({
      schoolId,
      action: "update",
      entityId: 730123,
      actorName: "Maya Rao",
      actorIdentifier: "USR-0731",
      studentId: student.id,
      studentName: student.name,
      studentIdentifier: student.digitalStudentId,
      recordLabel: "INV-SPACE-204",
      description: "Scholarship correction approved at 100%_complete.",
    });
    await insertAudit({
      schoolId: otherSchoolId,
      action: "update",
      entityId: 730124,
      actorName: "Maya Rao",
      actorIdentifier: "USR-0731",
      studentName: "Student Three Mis",
      studentIdentifier: "DSID-3007",
      recordLabel: "INV-SPACE-204",
      description: "Scholarship correction approved.",
    });

    const searches = [
      "DENT THREE",
      "Three Mis",
      "DSID-3007",
      String(student.id),
      "730123",
      "maya rao",
      "USR-0731",
      "INV-SPACE",
      "scholarship correction",
      "100%_complete",
    ];
    for (const search of searches) {
      const result = await storage.getFeeAuditLog(schoolId, 20, 0, null, null, null, search);
      expect(result.total, search).toBe(1);
      expect(result.entries.map(entry => entry.id), search).toEqual([searchableId]);
    }
  });

  it("does not make hidden technical values searchable", async () => {
    const schoolId = await createSchool();
    await insertAudit({
      schoolId,
      action: "legacy_gateway_notice",
      entityId: 740123,
      actorName: "principal@example.com",
      recordLabel: "Invoice pay_secret123",
      description: "Failed pay_secret123 at 203.0.113.9 for parent@example.com token=abc123.",
    });

    for (const search of [
      "pay_secret123",
      "secret123",
      "203.0.113.9",
      "parent@example.com",
      "abc123",
      "principal@example.com",
    ]) {
      const result = await storage.getFeeAuditLog(schoolId, 20, 0, null, null, null, search);
      expect(result.total, search).toBe(0);
      expect(result.entries, search).toEqual([]);
    }
  });

  it("uses inclusive IST calendar days for both one-sided and two-sided dates", async () => {
    const schoolId = await createSchool();
    const before = await insertAudit({
      schoolId, action: "settings_change", entityId: 1, createdAt: "2026-08-19 18:29:59.999",
    });
    const start = await insertAudit({
      schoolId, action: "settings_change", entityId: 2, createdAt: "2026-08-19 18:30:00.000",
    });
    const end = await insertAudit({
      schoolId, action: "settings_change", entityId: 3, createdAt: "2026-08-20 18:29:59.999",
    });
    const after = await insertAudit({
      schoolId, action: "settings_change", entityId: 4, createdAt: "2026-08-20 18:30:00.000",
    });

    const oneDay = await storage.getFeeAuditLog(
      schoolId, 20, 0, "2026-08-20", "2026-08-20",
    );
    expect(oneDay.total).toBe(2);
    expect(oneDay.entries.map(entry => entry.id)).toEqual([end, start]);

    const fromOnly = await storage.getFeeAuditLog(
      schoolId, 20, 0, "2026-08-20", null,
    );
    expect(fromOnly.entries.map(entry => entry.id)).toEqual([after, end, start]);

    const toOnly = await storage.getFeeAuditLog(
      schoolId, 20, 0, null, "2026-08-20",
    );
    expect(toOnly.entries.map(entry => entry.id)).toEqual([end, start, before]);
  });

  it("applies search, action, dates, and tenant scope together with an exact count", async () => {
    const schoolId = await createSchool();
    const otherSchoolId = await createSchool("Combined Filter Other Tenant");
    const base = {
      actorName: "Principal Combined",
      studentName: "student3mis",
      recordLabel: "INV-COMBINED",
      description: "Payment attempt reviewed.",
    };
    const matching = await insertAudit({
      schoolId, ...base, action: "payment_failed", entityId: 8101, createdAt: "2026-08-21 10:00:00",
    });
    await insertAudit({
      schoolId, ...base, action: "payment_cancelled", entityId: 8102, createdAt: "2026-08-21 10:01:00",
    });
    await insertAudit({
      schoolId, ...base, studentName: "Different Student", action: "payment_failed", entityId: 8103, createdAt: "2026-08-21 10:02:00",
    });
    await insertAudit({
      schoolId, ...base, action: "payment_failed", entityId: 8104, createdAt: "2026-08-23 10:00:00",
    });
    await insertAudit({
      schoolId: otherSchoolId, ...base, action: "payment_failed", entityId: 8105, createdAt: "2026-08-21 10:00:00",
    });

    const result = await storage.getFeeAuditLog(
      schoolId, 20, 0, "2026-08-20", "2026-08-22", "payment_failed", "student3mis",
    );
    expect(result.total).toBe(1);
    expect(result.entries.map(entry => entry.id)).toEqual([matching]);
  });

  it("paginates filtered rows without skips or duplicates using stable ordering", async () => {
    const schoolId = await createSchool();
    const inserted: number[] = [];
    for (let index = 0; index < 25; index += 1) {
      inserted.push(await insertAudit({
        schoolId,
        action: "reminder_sent",
        entityId: 9000 + index,
        recordLabel: `INV-PAGE-${index}`,
        description: "Filtered reminder batch.",
        createdAt: "2026-08-22 08:00:00",
      }));
    }

    const page1 = await storage.getFeeAuditLog(schoolId, 10, 0, null, null, "reminder_sent");
    const page2 = await storage.getFeeAuditLog(schoolId, 10, 10, null, null, "reminder_sent");
    const page3 = await storage.getFeeAuditLog(schoolId, 10, 20, null, null, "reminder_sent");
    expect(page1.total).toBe(25);
    expect(page2.total).toBe(25);
    expect(page3.total).toBe(25);
    const paged = [...page1.entries, ...page2.entries, ...page3.entries].map(entry => entry.id);
    expect(new Set(paged).size).toBe(25);
    expect(paged).toEqual([...inserted].reverse());
  });

  it("offers only current production actions and validates dates clearly", async () => {
    const schoolId = await createSchool();
    await insertAudit({
      schoolId,
      action: "legacy_stale_action",
      entityId: 9901,
    });
    const result = await storage.getFeeAuditLog(schoolId, 20, 0);
    expect(result.actionOptions).toEqual(
      CURRENT_FEE_AUDIT_ACTION_OPTIONS.map(option => ({ ...option })),
    );
    expect(result.actionOptions.some(option => option.value === "legacy_stale_action")).toBe(false);
    expect(isCurrentFeeAuditAction("payment_failed")).toBe(true);
    expect(isCurrentFeeAuditAction("payment_captured")).toBe(false);
    expect(isCurrentFeeAuditAction("legacy_stale_action")).toBe(false);

    expect(validateFeeAuditDateRange("2026-08-20", "2026-08-20")).toBeNull();
    expect(validateFeeAuditDateRange("2026-08-20", null)).toBeNull();
    expect(validateFeeAuditDateRange(null, "2026-08-20")).toBeNull();
    expect(validateFeeAuditDateRange("2026-08-22", "2026-08-20")).toBe(
      "From date must be on or before To date.",
    );
    expect(validateFeeAuditDateRange("2026-02-30", null)).toBe(
      "From date must be a valid calendar date.",
    );
    expect(validateFeeAuditDateRange(null, "2026-13-01")).toBe(
      "To date must be a valid calendar date.",
    );
  });
});