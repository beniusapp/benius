import { afterEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "../db";
import {
  appendFeeAudit,
  RAZORPAY_FEE_AUDIT_ACTOR,
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

  it("shows authoritative actors and student records for the required fee scenarios", async () => {
    const id = await createSchool();
    const [student] = await db.insert(students).values({
      schoolId: id,
      digitalStudentId: `MIS-${uid()}`,
      name: "Student Three",
      class: "9",
      section: "A",
      phone: "9200000000",
      dob: "2008-03-15",
      passwordHash: "x",
      isActive: true,
    }).returning();
    const principal = {
      actorId: null,
      actorTeacherId: null,
      actorStaffId: null,
      actorType: "principal" as const,
      actorName: "Principal One",
      actorRole: "Principal",
      actorIdentifier: "ADM-001",
    };
    const teacher = {
      actorId: null,
      actorTeacherId: null,
      actorStaffId: null,
      actorType: "teacher" as const,
      actorName: "Rahul Das",
      actorRole: "Teacher",
      actorIdentifier: "TCH-014",
    };
    const staff = {
      actorId: null,
      actorTeacherId: null,
      actorStaffId: null,
      actorType: "non_teaching_staff" as const,
      actorName: "Finance Staff",
      actorRole: "Non-Teaching Staff",
      actorIdentifier: "NTS-008",
    };
    const studentActor = {
      actorId: null,
      actorTeacherId: null,
      actorStaffId: null,
      actorType: "student" as const,
      actorName: student.name,
      actorRole: "Student",
      actorIdentifier: student.digitalStudentId,
    };
    const invoice = "INV-0093";
    const scenarios = [
      { actor: principal, action: "invoice_generation", label: "25 invoices", description: "Generated 25 invoices." },
      { actor: teacher, action: "update", label: invoice, description: "Updated invoice." },
      { actor: staff, action: "delete", label: invoice, description: "Deleted invoice." },
      { actor: principal, action: "create", label: "Annual Fee", description: "Added fee structure." },
      { actor: principal, action: "delete", label: "Annual Fee", description: "Deleted fee structure." },
      { actor: staff, action: "payment", label: invoice, description: "Recorded offline payment." },
      { actor: studentActor, action: "payment_cancelled", label: invoice, description: "Cancelled checkout." },
      { actor: studentActor, action: "payment_failed", label: invoice, description: "Payment failed." },
      { actor: RAZORPAY_FEE_AUDIT_ACTOR, action: "payment_captured", label: invoice, description: "Payment received." },
      { actor: SYSTEM_FEE_AUDIT_ACTOR, action: "overdue_sweep", label: invoice, description: "Marked invoice overdue." },
    ];
    for (const scenario of scenarios) {
      const invoiceRelated = scenario.label === invoice;
      await appendFeeAudit({
        schoolId: id,
        actor: scenario.actor,
        action: scenario.action,
        entityType: invoiceRelated ? "fee_record" : "fee_structure",
        entityId: invoiceRelated ? 93 : null,
        studentId: invoiceRelated ? student.id : null,
        recordLabel: scenario.label,
        description: scenario.description,
      });
    }

    const result = await storage.getFeeAuditLog(id, 20, 0);
    expect(result.entries).toHaveLength(10);
    expect(result.entries.every(entry =>
      !/unknown/i.test(`${entry.actorName} ${entry.actorRole} ${entry.actorIdentifier}`),
    )).toBe(true);
    expect(result.entries.find(entry => entry.action === "payment_cancelled")).toMatchObject({
      actorName: student.name,
      actorRole: "Student",
      actorIdentifier: student.digitalStudentId,
      studentName: student.name,
      studentIdentifier: student.digitalStudentId,
      recordLabel: invoice,
    });
    expect(result.entries.find(entry => entry.action === "payment_captured")).toMatchObject({
      actorName: "Razorpay",
      actorRole: "Payment Gateway",
      actorIdentifier: "RAZORPAY",
    });
    expect(result.entries.find(entry => entry.action === "overdue_sweep")).toMatchObject({
      actorName: "System",
      actorRole: "System",
      actorIdentifier: "SYSTEM",
    });
    expect(result.entries.find(entry => entry.actorIdentifier === "TCH-014")?.actorName).toBe("Rahul Das");
    expect(result.entries.find(entry => entry.actorIdentifier === "NTS-008")?.actorRole).toBe("Non-Teaching Staff");
  });

  it("repairs reliable legacy client/provider classifications without guessing a person", async () => {
    const id = await createSchool();
    await db.execute(sql`
      INSERT INTO fee_audit_log (
        school_id, actor_type, actor_name, actor_role, actor_identifier,
        action, entity_type, entity_id, student_id, student_name, student_identifier, description
      ) VALUES
        (${id}, 'student', 'Razorpay (client)', 'Unknown', 'UNKNOWN',
         'payment_failed', 'fee_record', 91, NULL, 'Student Snapshot', 'DS-077', 'Payment failed.'),
        (${id}, 'legacy', 'Razorpay (client)', 'Unknown', 'UNKNOWN',
         'refund_failed', 'refund', 92, NULL, NULL, NULL, 'Refund failed.'),
        (${id}, 'legacy', 'Finance Office', 'Unknown', 'UNKNOWN',
         'payment', 'payment_record', 93, NULL, NULL, NULL, 'Manual payment imported.'),
        (${id}, 'student', 'Student Portal', 'Student', 'UNKNOWN',
         'payment_cancelled', 'fee_record', 94, NULL, NULL, NULL, 'Legacy student checkout.')
    `);
    const result = await storage.getFeeAuditLog(id, 20, 0);
    const studentEvent = result.entries.find(entry => entry.action === "payment_failed");
    const providerEvent = result.entries.find(entry => entry.action === "refund_failed");
    const manualPayment = result.entries.find(entry => entry.entityId === 93);
    const incompleteStudent = result.entries.find(entry => entry.entityId === 94);
    expect(studentEvent).toMatchObject({
      actorName: "Student Snapshot",
      actorRole: "Student",
      actorIdentifier: "DS-077",
    });
    expect(providerEvent).toMatchObject({
      actorName: "Razorpay",
      actorRole: "Payment Gateway",
      actorIdentifier: "RAZORPAY",
    });
    expect(manualPayment).toMatchObject({
      actorName: "Historical record",
      actorRole: "Source not recorded",
      actorIdentifier: "NOT_RECORDED",
    });
    expect(incompleteStudent).toMatchObject({
      actorName: "Historical record",
      actorRole: "Source not recorded",
      actorIdentifier: "NOT_RECORDED",
    });
  });
});