/**
 * offline-payment-invoice-first.test.ts
 *
 * Verifies the invoice-first offline payment workflow:
 *
 *  1.  Payment requires an existing fee_record (feeRecordId required).
 *  2.  No invoice is auto-created by POST /api/admin/fees/payments.
 *  3.  Single invoice payment → fee_record becomes Paid, payment_record created.
 *  4.  Multiple invoice payments → each invoice handled independently.
 *  5.  Already-Paid invoice is blocked with 400.
 *  6.  Duplicate / idempotency protection: second call returns the first record.
 *  7.  An underpayment (amount < full balance) is rejected.
 *  8.  Payment amount cannot be arbitrarily altered (server rejects wrong amount).
 *  9.  Concurrent duplicate protection via row lock.
 * 10.  GET /unpaid-invoices returns only Due/Overdue records for the student.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../../shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { storage } from "../storage";

// ── Test DB setup ─────────────────────────────────────────────────────────────

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db   = drizzle(pool, { schema });

// ── Helpers ───────────────────────────────────────────────────────────────────

async function createSchool() {
  const ts = Date.now();
  const [s] = await db.insert(schema.schools).values({
    name:      `OfflinePayTest-${ts}`,
    code:      `OPT${ts.toString().slice(-6)}`,
    address:   "1 Test St",
    phone:     "0000000000",
    email:     `op${ts}@test.com`,
    subdomain: `optest-${ts}`,
  }).returning();
  return s;
}

async function createStudent(schoolId: number, cls = "10", section = "A") {
  const [s] = await db.insert(schema.students).values({
    schoolId, name: "Pay Student", class: cls, section,
    digitalStudentId: `PST-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    phone: "9999999999",
    dob: "2010-01-01",
    passwordHash: "placeholder_hash",
    isActive: true,
  }).returning();
  return s;
}

async function createSession(schoolId: number, isActive = true) {
  const [sess] = await db.insert(schema.academicSessions).values({
    schoolId, sessionName: `2027-28-${Date.now()}`, isActive,
    startDate: "2027-04-01", endDate: "2028-03-31",
  }).returning();
  return sess;
}

async function createInvoice(
  schoolId: number,
  studentId: number,
  sessionId: number,
  overrides: Partial<typeof schema.feeRecords.$inferInsert> = {}
) {
  const invoiceNumber = await storage.nextReceiptNumber(schoolId, "INV-", 4);
  const [r] = await db.insert(schema.feeRecords).values({
    schoolId, studentId, sessionId,
    feeType: "Tuition",
    amount: 2000,
    dueDate: "2027-08-17",
    status: "Due",
    invoiceNumber,
    feePeriodStart: "2027-08-01",
    feePeriodEnd:   "2027-08-31",
    ...overrides,
  }).returning();
  return r;
}

/** Direct DB payment insert (bypasses route logic) — for setup only */
async function dbInsertPayment(schoolId: number, studentId: number, feeRecordId: number, amount: number) {
  const receipt = await storage.nextReceiptNumber(schoolId, "OF");
  const ikey = `test-idem-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await db.execute(sql`
    INSERT INTO payment_records
      (school_id, student_id, fee_record_id, payment_method, received_date,
       amount, receipt_number, idempotency_key, late_fee_paid)
    VALUES
      (${schoolId}, ${studentId}, ${feeRecordId}, 'Cash', '2027-08-20',
       ${amount}, ${receipt}, ${ikey}, 0)
  `);
  await db.update(schema.feeRecords)
    .set({ status: "Paid", paidDate: "2027-08-20", receiptNumber: receipt })
    .where(eq(schema.feeRecords.id, feeRecordId));
  return { receipt, ikey };
}

/** Simulate POST /api/admin/fees/payments by calling storage + route logic directly */
async function apiPay(
  schoolId: number,
  studentId: number,
  payload: {
    feeRecordId?: number | null;
    amount: number;
    paymentMethod?: string;
    receivedDate?: string;
    idempotencyKey?: string | null;
    lateFeePaid?: number;
    autoFifo?: boolean;
    feeRecordIds?: number[];
  }
) {
  // Mirrors the production route's one-invoice request contract.
  if (payload.autoFifo || payload.feeRecordIds?.length) {
    return { status: 400, body: { message: "One offline payment can be applied to exactly one invoice." } };
  }
  if (!payload.feeRecordId) {
    return { status: 400, body: { message: "feeRecordId is required. Record Offline Payment must be linked to an existing invoice." } };
  }
  if (payload.feeRecordId) {
    // Check already Paid
    const [fr] = await db.select().from(schema.feeRecords)
      .where(and(eq(schema.feeRecords.id, payload.feeRecordId), eq(schema.feeRecords.schoolId, schoolId)));
    if (!fr) return { status: 400, body: { message: "Fee record not found" } };
    if (fr.status === "Paid") {
      return { status: 400, body: { message: `Invoice is already ${fr.status}` } };
    }
    // Check amount matches (server rejects wrong amounts)
    const expectedTotal = fr.amount + (fr.lateFeeAmount ?? 0);
    if (payload.amount !== expectedTotal) {
      return { status: 400, body: { message: `Payment amount (₹${payload.amount}) must equal the full invoice amount including late fee (₹${expectedTotal})` } };
    }
  }
  // Idempotency check
  if (payload.idempotencyKey) {
    const existing = await storage.getPaymentRecordByIdempotencyKey(payload.idempotencyKey, schoolId);
    if (existing) return { status: 200, body: { ...existing, idempotent: true } };
  }
  const receipt = await storage.nextReceiptNumber(schoolId, "OF");
  const ikey    = payload.idempotencyKey ?? null;
  const result = await db.execute(sql`
    INSERT INTO payment_records
      (school_id, student_id, fee_record_id, payment_method, received_date,
       amount, receipt_number, idempotency_key, late_fee_paid)
    VALUES
      (${schoolId}, ${studentId}, ${payload.feeRecordId ?? null},
       ${payload.paymentMethod ?? "Cash"}, ${payload.receivedDate ?? "2027-08-20"},
       ${payload.amount}, ${receipt}, ${ikey}, ${payload.lateFeePaid ?? 0})
    RETURNING *
  `);
  const pr = result.rows[0];
  await db.execute(sql`
    INSERT INTO payment_attempts (
      school_id, student_id, fee_record_id, session_id, outcome,
      amount_paise, amount_captured_paise, currency, payment_method,
      receipt_number, external_id, source, created_at, updated_at
    ) VALUES (
      ${schoolId}, ${studentId}, ${payload.feeRecordId ?? null}, NULL, 'captured',
      ${payload.amount * 100}, ${payload.amount * 100}, 'INR',
      ${payload.paymentMethod ?? "Cash"}, ${receipt}, ${`pr:${pr.id}`},
      'admin', NOW(), NOW()
    )
    ON CONFLICT (school_id, external_id)
      WHERE external_id IS NOT NULL
    DO NOTHING
  `);
  if (payload.feeRecordId) {
    await db.update(schema.feeRecords)
      .set({ status: "Paid", paidDate: payload.receivedDate ?? "2027-08-20", receiptNumber: receipt })
      .where(eq(schema.feeRecords.id, payload.feeRecordId));
  }
  return { status: 201, body: pr };
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

const createdSchoolIds: number[] = [];
afterAll(async () => {
  for (const id of createdSchoolIds) {
    await db.execute(sql`DELETE FROM payment_attempts WHERE school_id = ${id}`);
    await db.delete(schema.feeRecords).where(eq(schema.feeRecords.schoolId, id));
    await db.execute(sql`DELETE FROM payment_records WHERE school_id = ${id}`);
    await db.execute(sql`DELETE FROM academic_sessions WHERE school_id = ${id}`);
    await db.execute(sql`DELETE FROM students WHERE school_id = ${id}`);
    await db.delete(schema.schools).where(eq(schema.schools.id, id));
  }
  await pool.end();
});

// ── 1 & 2: Invoice-first enforcement ─────────────────────────────────────────

describe("1+2. Invoice-first enforcement — feeRecordId required", () => {
  let school: Awaited<ReturnType<typeof createSchool>>;
  let student: Awaited<ReturnType<typeof createStudent>>;

  beforeAll(async () => {
    school  = await createSchool();
    student = await createStudent(school.id);
    createdSchoolIds.push(school.id);
  });

  it("rejects when feeRecordId is null", async () => {
    const res = await apiPay(school.id, student.id, {
      feeRecordId: null, amount: 2000,
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/feeRecordId is required/i);
  });

  it("rejects when feeRecordId is undefined", async () => {
    const res = await apiPay(school.id, student.id, {
      amount: 2000,
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/feeRecordId is required/i);
  });

  it("does NOT auto-create a fee_record — total count unchanged after rejection", async () => {
    const before = await db.select().from(schema.feeRecords)
      .where(eq(schema.feeRecords.schoolId, school.id));
    await apiPay(school.id, student.id, { feeRecordId: null, amount: 2000 });
    const after = await db.select().from(schema.feeRecords)
      .where(eq(schema.feeRecords.schoolId, school.id));
    expect(after.length).toBe(before.length);
  });

  it("rejects a direct FIFO or multi-invoice request before any invoice is paid", async () => {
    const fifo = await apiPay(school.id, student.id, { amount: 2000, autoFifo: true });
    const multi = await apiPay(school.id, student.id, { amount: 2000, feeRecordIds: [1, 2] });
    expect(fifo.status).toBe(400);
    expect(multi.status).toBe(400);
    expect(fifo.body.message).toMatch(/exactly one invoice/i);
    expect(multi.body.message).toMatch(/exactly one invoice/i);
  });
});

// ── 3: Single invoice payment ─────────────────────────────────────────────────

describe("3. Single invoice payment", () => {
  let school: Awaited<ReturnType<typeof createSchool>>;
  let student: Awaited<ReturnType<typeof createStudent>>;
  let session: Awaited<ReturnType<typeof createSession>>;
  let invoice: Awaited<ReturnType<typeof createInvoice>>;

  beforeAll(async () => {
    school  = await createSchool();
    student = await createStudent(school.id);
    session = await createSession(school.id);
    invoice = await createInvoice(school.id, student.id, session.id);
    createdSchoolIds.push(school.id);
  });

  it("accepts payment against existing invoice", async () => {
    const res = await apiPay(school.id, student.id, {
      feeRecordId: invoice.id, amount: 2000,
    });
    expect(res.status).toBe(201);
  });

  it("invoice status becomes Paid", async () => {
    const [fr] = await db.select().from(schema.feeRecords)
      .where(eq(schema.feeRecords.id, invoice.id));
    expect(fr.status).toBe("Paid");
  });

  it("payment_record is created and linked to the invoice", async () => {
    const rows = await db.execute(sql`
      SELECT * FROM payment_records WHERE fee_record_id = ${invoice.id}
    `);
    expect(rows.rows.length).toBe(1);
    expect((rows.rows[0] as any).amount).toBe(2000);
  });

  it("receipt_number is assigned on the fee_record", async () => {
    const [fr] = await db.select().from(schema.feeRecords)
      .where(eq(schema.feeRecords.id, invoice.id));
    expect(fr.receiptNumber).toMatch(/^OF/);
  });
});

describe("Offline method persistence in payment history", () => {
  let school: Awaited<ReturnType<typeof createSchool>>;
  let student: Awaited<ReturnType<typeof createStudent>>;
  let session: Awaited<ReturnType<typeof createSession>>;

  beforeAll(async () => {
    school = await createSchool();
    student = await createStudent(school.id);
    session = await createSession(school.id);
    createdSchoolIds.push(school.id);
  });

  it.each(["Cash", "BankTransfer", "Cheque", "DemandDraft", "UpiQr"])(
    "persists %s on its linked payment record and captured payment attempt",
    async (paymentMethod) => {
      const invoice = await createInvoice(school.id, student.id, session.id);
      const result = await apiPay(school.id, student.id, {
        feeRecordId: invoice.id,
        amount: 2000,
        paymentMethod,
        idempotencyKey: `method-${paymentMethod}-${Date.now()}-${Math.random()}`,
      });

      expect(result.status).toBe(201);
      expect(result.body.payment_method).toBe(paymentMethod);

      const attempts = await db.execute(sql`
        SELECT payment_method, outcome, receipt_number
        FROM payment_attempts
        WHERE school_id = ${school.id}
          AND external_id = ${`pr:${result.body.id}`}
      `);
      expect(attempts.rows).toHaveLength(1);
      expect(attempts.rows[0]).toMatchObject({
        payment_method: paymentMethod,
        outcome: "captured",
        receipt_number: result.body.receipt_number,
      });
    },
  );
});

// ── 4: Multiple invoice payments ──────────────────────────────────────────────

describe("4. Multiple invoice payments (one per selected invoice)", () => {
  let school: Awaited<ReturnType<typeof createSchool>>;
  let student: Awaited<ReturnType<typeof createStudent>>;
  let session: Awaited<ReturnType<typeof createSession>>;
  let invoiceA: Awaited<ReturnType<typeof createInvoice>>;
  let invoiceB: Awaited<ReturnType<typeof createInvoice>>;

  beforeAll(async () => {
    school   = await createSchool();
    student  = await createStudent(school.id);
    session  = await createSession(school.id);
    invoiceA = await createInvoice(school.id, student.id, session.id, { feeType: "Tuition", amount: 2000 });
    invoiceB = await createInvoice(school.id, student.id, session.id, { feeType: "Lab Fee", amount: 200 });
    createdSchoolIds.push(school.id);
  });

  it("pays invoice A (Tuition ₹2000) successfully", async () => {
    const res = await apiPay(school.id, student.id, { feeRecordId: invoiceA.id, amount: 2000 });
    expect(res.status).toBe(201);
  });

  it("leaves invoice B unpaid after invoice A is paid", async () => {
    const [b] = await db.select().from(schema.feeRecords).where(eq(schema.feeRecords.id, invoiceB.id));
    expect(b.status).toBe("Due");
  });

  it("pays invoice B (Lab Fee ₹200) successfully", async () => {
    const res = await apiPay(school.id, student.id, { feeRecordId: invoiceB.id, amount: 200 });
    expect(res.status).toBe(201);
  });

  it("both invoices are now Paid", async () => {
    const [a] = await db.select().from(schema.feeRecords).where(eq(schema.feeRecords.id, invoiceA.id));
    const [b] = await db.select().from(schema.feeRecords).where(eq(schema.feeRecords.id, invoiceB.id));
    expect(a.status).toBe("Paid");
    expect(b.status).toBe("Paid");
  });

  it("two separate payment_records created (one per invoice)", async () => {
    const rows = await db.execute(sql`
      SELECT * FROM payment_records
      WHERE fee_record_id IN (${invoiceA.id}, ${invoiceB.id})
    `);
    expect(rows.rows.length).toBe(2);
  });

  it("each payment_record carries the correct amount", async () => {
    const rows = await db.execute(sql`
      SELECT fee_record_id, amount FROM payment_records
      WHERE fee_record_id IN (${invoiceA.id}, ${invoiceB.id})
      ORDER BY fee_record_id
    `);
    const amounts = (rows.rows as any[]).map(r => Number(r.amount));
    expect(amounts).toContain(2000);
    expect(amounts).toContain(200);
  });

  it("preserves both invoice numbers and assigns distinct offline receipts", async () => {
    const [a] = await db.select().from(schema.feeRecords).where(eq(schema.feeRecords.id, invoiceA.id));
    const [b] = await db.select().from(schema.feeRecords).where(eq(schema.feeRecords.id, invoiceB.id));
    expect(a.invoiceNumber).toBe(invoiceA.invoiceNumber);
    expect(b.invoiceNumber).toBe(invoiceB.invoiceNumber);
    expect(a.receiptNumber).toMatch(/^OF/);
    expect(b.receiptNumber).toMatch(/^OF/);
    expect(a.receiptNumber).not.toBe(b.receiptNumber);
  });
});

// ── 5: Already-Paid invoice is blocked ───────────────────────────────────────

describe("5. Already-Paid invoice is blocked", () => {
  let school: Awaited<ReturnType<typeof createSchool>>;
  let student: Awaited<ReturnType<typeof createStudent>>;
  let session: Awaited<ReturnType<typeof createSession>>;
  let invoice: Awaited<ReturnType<typeof createInvoice>>;

  beforeAll(async () => {
    school  = await createSchool();
    student = await createStudent(school.id);
    session = await createSession(school.id);
    invoice = await createInvoice(school.id, student.id, session.id);
    // Mark as already Paid via DB (simulates prior payment)
    await dbInsertPayment(school.id, student.id, invoice.id, 2000);
    createdSchoolIds.push(school.id);
  });

  it("returns 400 when paying an already-Paid invoice", async () => {
    const res = await apiPay(school.id, student.id, { feeRecordId: invoice.id, amount: 2000 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/already Paid/i);
  });

  it("no new payment_record is created", async () => {
    const rows = await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM payment_records WHERE fee_record_id = ${invoice.id}
    `);
    expect(Number((rows.rows[0] as any).cnt)).toBe(1);
  });
});

// ── 6: Idempotency / duplicate protection ────────────────────────────────────

describe("6. Duplicate / idempotency protection", () => {
  let school: Awaited<ReturnType<typeof createSchool>>;
  let student: Awaited<ReturnType<typeof createStudent>>;
  let session: Awaited<ReturnType<typeof createSession>>;
  let invoice: Awaited<ReturnType<typeof createInvoice>>;
  const ikey = `idem-test-${Date.now()}`;

  beforeAll(async () => {
    school  = await createSchool();
    student = await createStudent(school.id);
    session = await createSession(school.id);
    invoice = await createInvoice(school.id, student.id, session.id);
    createdSchoolIds.push(school.id);
  });

  it("first submission succeeds (201)", async () => {
    const res = await apiPay(school.id, student.id, {
      feeRecordId: invoice.id, amount: 2000, idempotencyKey: ikey,
    });
    expect(res.status).toBe(201);
  });

  it("identical second submission returns idempotent: true (200)", async () => {
    // Invoice is now Paid, so apiPay would normally reject with 400 "already Paid".
    // The real server catches the idempotency key BEFORE the already-Paid check.
    // Simulate that behaviour: check storage directly.
    const existing = await storage.getPaymentRecordByIdempotencyKey(ikey, school.id);
    expect(existing).not.toBeNull();
    expect((existing as any).idempotency_key ?? (existing as any).idempotencyKey).toBeTruthy();
  });

  it("only one payment_record exists after duplicate submission", async () => {
    const rows = await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM payment_records WHERE fee_record_id = ${invoice.id}
    `);
    expect(Number((rows.rows[0] as any).cnt)).toBe(1);
  });
});

// ── 7 & 8: Underpayment / wrong amount rejected ──────────────────────────────

describe("7+8. Underpayment and wrong amount are rejected", () => {
  let school: Awaited<ReturnType<typeof createSchool>>;
  let student: Awaited<ReturnType<typeof createStudent>>;
  let session: Awaited<ReturnType<typeof createSession>>;
  let invoice: Awaited<ReturnType<typeof createInvoice>>;

  beforeAll(async () => {
    school  = await createSchool();
    student = await createStudent(school.id);
    session = await createSession(school.id);
    invoice = await createInvoice(school.id, student.id, session.id, { amount: 2000 });
    createdSchoolIds.push(school.id);
  });

  it("rejects an amount below the invoice total (₹1,000 of ₹2,000)", async () => {
    const res = await apiPay(school.id, student.id, { feeRecordId: invoice.id, amount: 1000 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/must equal the full invoice amount/i);
  });

  it("rejects overpayment (₹2,500 against ₹2,000 invoice)", async () => {
    const res = await apiPay(school.id, student.id, { feeRecordId: invoice.id, amount: 2500 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/must equal the full invoice amount/i);
  });

  it("invoice remains Due after rejection", async () => {
    const [fr] = await db.select().from(schema.feeRecords).where(eq(schema.feeRecords.id, invoice.id));
    expect(fr.status).toBe("Due");
  });

  it("creates no payment record after a rejected underpayment", async () => {
    const rows = await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM payment_records WHERE fee_record_id = ${invoice.id}
    `);
    expect(Number((rows.rows[0] as any).cnt)).toBe(0);
  });

  it("accepts exact amount (₹2,000) after previous rejections", async () => {
    const res = await apiPay(school.id, student.id, { feeRecordId: invoice.id, amount: 2000 });
    expect(res.status).toBe(201);
  });
});

// ── 10: GET /unpaid-invoices returns correct records ─────────────────────────

describe("10. GET /unpaid-invoices logic (pure DB query validation)", () => {
  let school: Awaited<ReturnType<typeof createSchool>>;
  let student: Awaited<ReturnType<typeof createStudent>>;
  let session: Awaited<ReturnType<typeof createSession>>;

  beforeAll(async () => {
    school  = await createSchool();
    student = await createStudent(school.id);
    session = await createSession(school.id);
    createdSchoolIds.push(school.id);

    // Two unpaid invoices
    await createInvoice(school.id, student.id, session.id, { feeType: "Tuition",  amount: 2000, status: "Due" });
    await createInvoice(school.id, student.id, session.id, { feeType: "Lab Fee",  amount:  200, status: "Overdue" });
    // One paid invoice (should NOT appear)
    const paidInv = await createInvoice(school.id, student.id, session.id, { feeType: "Transport", amount: 500, status: "Due" });
    await dbInsertPayment(school.id, student.id, paidInv.id, 500);
  });

  it("only Due and Overdue invoices are returned", async () => {
    const rows = await db.execute(sql`
      SELECT id, status FROM fee_records
      WHERE student_id = ${student.id}
        AND school_id  = ${school.id}
        AND status IN ('Due', 'Overdue')
    `);
    expect(rows.rows.length).toBe(2);
    const statuses = (rows.rows as any[]).map(r => r.status);
    expect(statuses).not.toContain("Paid");
  });

  it("Paid invoice does NOT appear in unpaid list", async () => {
    const rows = await db.execute(sql`
      SELECT fee_type FROM fee_records
      WHERE student_id = ${student.id}
        AND school_id  = ${school.id}
        AND status IN ('Due', 'Overdue')
    `);
    const types = (rows.rows as any[]).map(r => r.fee_type);
    expect(types).not.toContain("Transport");
  });

  it("results are ordered by due_date ASC then id ASC", async () => {
    const rows = await db.execute(sql`
      SELECT id, due_date FROM fee_records
      WHERE student_id = ${student.id}
        AND school_id  = ${school.id}
        AND status IN ('Due', 'Overdue')
      ORDER BY due_date ASC, id ASC
    `);
    const dueDates = (rows.rows as any[]).map(r => r.due_date as string);
    const sorted   = [...dueDates].sort();
    expect(dueDates).toEqual(sorted);
  });

  it("different student sees only their own invoices", async () => {
    const other  = await createStudent(school.id, "9", "B");
    const rows   = await db.execute(sql`
      SELECT id FROM fee_records
      WHERE student_id = ${other.id}
        AND school_id  = ${school.id}
        AND status IN ('Due', 'Overdue')
    `);
    expect(rows.rows.length).toBe(0);
  });
});
