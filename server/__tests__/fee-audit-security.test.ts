import { afterEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "../db";
import {
  appendFeeAudit,
  safeFeeAuditDescription,
  safeFeeAuditRecordLabel,
  SYSTEM_FEE_AUDIT_ACTOR,
} from "../fee-audit";
import { storage } from "../storage";
import { schools, students } from "@shared/schema";

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

let schoolId: number | null = null;

async function createSchool(): Promise<number> {
  const [school] = await db.insert(schools).values({
    name: "Fee Audit Security School",
    code: `FAS-${uid()}`,
  }).returning();
  schoolId = school.id;
  return school.id;
}

afterEach(async () => {
  if (schoolId == null) return;
  const id = schoolId;
  schoolId = null;
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT set_config('app.fee_audit_cleanup', 'on', true)`);
    await tx.execute(sql`DELETE FROM schools WHERE id = ${id}`);
  });
});

describe("fee audit security contract", () => {
  it("deduplicates provider events by tenant-scoped event key", async () => {
    const id = await createSchool();
    const first = await appendFeeAudit({
      schoolId: id,
      actor: SYSTEM_FEE_AUDIT_ACTOR,
      action: "payment",
      entityType: "fee_record",
      entityId: 44,
      eventKey: `payment-captured:pay_${uid()}`,
      description: "Online payment captured.",
    });
    const keyResult = await db.execute(sql`
      SELECT event_key FROM fee_audit_log WHERE id = ${first}
    `);
    const eventKey = String((keyResult.rows[0] as any).event_key);
    const second = await appendFeeAudit({
      schoolId: id,
      actor: SYSTEM_FEE_AUDIT_ACTOR,
      action: "payment",
      entityType: "fee_record",
      entityId: 44,
      eventKey,
      description: "Duplicate provider delivery.",
    });
    const count = await db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM fee_audit_log
      WHERE school_id = ${id} AND event_key = ${eventKey}
    `);
    expect(second).toBe(first);
    expect(Number((count.rows[0] as any).count)).toBe(1);
  });

  it("redacts legacy technical evidence and returns only whitelisted fields", async () => {
    const id = await createSchool();
    await db.execute(sql`
      INSERT INTO fee_audit_log (
        school_id, action, entity_type, entity_id, actor_name,
        ip_address, razorpay_payment_id, raw_response, description
      ) VALUES (
        ${id}, 'legacy_gateway_notice', 'fee_record', 45, 'Legacy Gateway',
        '203.0.113.9', 'pay_secret123', '{"token":"hidden"}'::jsonb,
        'Failed pay_secret123 for parent@example.com at pupil@okaxis token=abc123'
      )
    `);
    const result = await storage.getFeeAuditLog(id, 20, 0);
    const entry = result.entries[0] as any;
    expect(entry.description).not.toContain("pay_secret123");
    expect(entry.description).not.toContain("parent@example.com");
    expect(entry.description).not.toContain("pupil@okaxis");
    expect(entry.description).not.toContain("abc123");
    expect(entry).not.toHaveProperty("ipAddress");
    expect(entry).not.toHaveProperty("razorpayPaymentId");
    expect(entry).not.toHaveProperty("rawResponse");
  });

  it("uses generic operational wording for technical payment lifecycle actions", () => {
    const safe = safeFeeAuditDescription({
      action: "payment_failed",
      recordLabel: "INV-104",
      description: "Razorpay pay_secret failed with raw gateway response",
    });
    expect(safe).toBe("Online payment failed for INV-104. No payment was recorded.");
  });

  it("does not infer a historical student name from the current student record", async () => {
    const id = await createSchool();
    const [student] = await db.insert(students).values({
      schoolId: id,
      digitalStudentId: `DS-${uid()}`,
      name: "Current Student Name",
      class: "9",
      section: "A",
      phone: "9100000000",
      dob: "2008-03-15",
      passwordHash: "x",
      isActive: true,
    }).returning();
    await db.execute(sql`
      INSERT INTO fee_audit_log (
        school_id, action, entity_type, entity_id, actor_name, student_id, description
      ) VALUES (
        ${id}, 'legacy_notice', 'fee_record', 46, 'Legacy Actor', ${student.id}, 'Legacy activity.'
      )
    `);
    const result = await storage.getFeeAuditLog(id, 20, 0);
    expect(result.entries[0]?.studentName).toBeNull();
  });

  it("redacts phone, payment-address, card, and long technical values", () => {
    const safe = safeFeeAuditDescription({
      action: "legacy_notice",
      description: "Contact +91 9876543210, VPA pupil@okaxis, card 4111 1111 1111 1111, IPv4 203.0.113.9, IPv6 2001:db8::8a2e:370:7334, hash abcdefabcdefabcdefabcdefabcdefabcdef.",
    });
    expect(safe).not.toContain("9876543210");
    expect(safe).not.toContain("pupil@okaxis");
    expect(safe).not.toContain("4111 1111 1111 1111");
    expect(safe).not.toContain("203.0.113.9");
    expect(safe).not.toContain("2001:db8::8a2e:370:7334");
    expect(safe).not.toContain("2001:db8");
    expect(safe).not.toContain("abcdefabcdefabcdefabcdefabcdefabcdef");
    expect(safeFeeAuditRecordLabel("Invoice pay_secret123 from 203.0.113.9")).toBe(
      "Invoice [provider reference hidden] from [IP address hidden]",
    );
    expect(safeFeeAuditRecordLabel("::1")).toBe("[IP address hidden]");
    expect(safeFeeAuditRecordLabel("fe80::1")).toBe("[IP address hidden]");
    expect(safeFeeAuditRecordLabel("[2001:db8::1]")).toBe("[IP address hidden]");
    expect(safeFeeAuditRecordLabel("::ffff:192.0.2.128")).toBe("[IP address hidden]");
  });

  it("blocks ordinary updates and deletes", async () => {
    const id = await createSchool();
    const auditId = await appendFeeAudit({
      schoolId: id,
      actor: SYSTEM_FEE_AUDIT_ACTOR,
      action: "settings_change",
      entityType: "settings",
      description: "Settings updated.",
    });
    await expect(db.execute(sql`
      UPDATE fee_audit_log SET description = 'changed' WHERE id = ${auditId}
    `)).rejects.toThrow(/append-only/i);
    await expect(db.execute(sql`
      DELETE FROM fee_audit_log WHERE id = ${auditId}
    `)).rejects.toThrow(/append-only/i);
    await expect(db.transaction(async tx => {
      await tx.execute(sql`SELECT set_config('app.fee_audit_cleanup', 'on', true)`);
      await tx.execute(sql`DELETE FROM fee_audit_log WHERE id = ${auditId}`);
    })).rejects.toThrow(/append-only/i);
  });
});