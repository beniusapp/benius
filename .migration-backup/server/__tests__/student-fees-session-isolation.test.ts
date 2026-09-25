import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import http from "http";
import { eq, sql } from "drizzle-orm";
import { registerRoutes } from "../routes";
import { db } from "../db";
import {
  academicSessions,
  dunningLog,
  feeRecords,
  paymentRecords,
  schools,
  students,
} from "@shared/schema";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

let schoolAId = 0;
let schoolBId = 0;
let studentAId = 0;
let sessionAOldId = 0;
let sessionANewId = 0;
let sessionBOldId = 0;
let oldFeeId = 0;
let foreignFeeId = 0;
let server: http.Server;
let baseUrl = "";

function headers(sessionId: number) {
  return { "x-view-session-id": String(sessionId) };
}

async function get(path: string, sessionId: number) {
  return fetch(`${baseUrl}${path}`, { headers: headers(sessionId) });
}

beforeAll(async () => {
  const suffix = uid();
  const [schoolA] = await db.insert(schools).values({
    name: `Student Fee Session A ${suffix}`,
    code: `SFSA-${suffix}`,
  }).returning();
  const [schoolB] = await db.insert(schools).values({
    name: `Student Fee Session B ${suffix}`,
    code: `SFSB-${suffix}`,
  }).returning();
  schoolAId = schoolA.id;
  schoolBId = schoolB.id;

  const [aOld, aNew, bOld, bNew] = await Promise.all([
    db.insert(academicSessions).values({
      schoolId: schoolAId, sessionName: "Prior session", startDate: "2026-04-01",
      endDate: "2027-03-31", isActive: false, status: "archived",
    }).returning(),
    db.insert(academicSessions).values({
      schoolId: schoolAId, sessionName: "Empty session", startDate: "2027-04-01",
      endDate: "2028-03-31", isActive: true, status: "active",
    }).returning(),
    db.insert(academicSessions).values({
      schoolId: schoolBId, sessionName: "Foreign prior", startDate: "2026-04-01",
      endDate: "2027-03-31", isActive: true, status: "active",
    }).returning(),
    db.insert(academicSessions).values({
      schoolId: schoolBId, sessionName: "Foreign empty", startDate: "2027-04-01",
      endDate: "2028-03-31", isActive: false, status: "archived",
    }).returning(),
  ]);
  sessionAOldId = aOld[0].id;
  sessionANewId = aNew[0].id;
  sessionBOldId = bOld[0].id;
  expect(bNew[0].schoolId).toBe(schoolBId);

  const [studentA, studentB] = await Promise.all([
    db.insert(students).values({
      schoolId: schoolAId, digitalStudentId: `DSID-A-${suffix}`, name: "Student A",
      class: "10", section: "A", phone: "9000000001", dob: "2010-01-01", passwordHash: "test",
    }).returning(),
    db.insert(students).values({
      schoolId: schoolBId, digitalStudentId: `DSID-B-${suffix}`, name: "Student B",
      class: "10", section: "A", phone: "9000000002", dob: "2010-01-01", passwordHash: "test",
    }).returning(),
  ]);
  studentAId = studentA[0].id;

  const [oldFee, foreignFee] = await Promise.all([
    db.insert(feeRecords).values({
      schoolId: schoolAId, studentId: studentAId, sessionId: sessionAOldId,
      feeType: "Tuition", amount: 2000, dueDate: "2026-06-01", status: "Paid",
      invoiceNumber: `INV-A-${suffix}`, academicYear: "Prior session",
    }).returning(),
    db.insert(feeRecords).values({
      schoolId: schoolBId, studentId: studentB[0].id, sessionId: sessionBOldId,
      feeType: "Tuition", amount: 3000, dueDate: "2026-06-01", status: "Paid",
      invoiceNumber: `INV-B-${suffix}`, academicYear: "Foreign prior",
    }).returning(),
  ]);
  oldFeeId = oldFee[0].id;
  foreignFeeId = foreignFee[0].id;

  await db.insert(paymentRecords).values({
    // Legacy rows can carry a stale payment session. Linked invoice ownership
    // remains authoritative for Student Fees summary attribution.
    schoolId: schoolAId, studentId: studentAId, sessionId: sessionANewId,
    feeRecordId: oldFeeId, paymentMethod: "Cash", receivedDate: "2026-06-01",
    amount: 2000, idempotencyKey: `student-fee-session-${suffix}`,
  });
  await db.execute(sql`
    INSERT INTO payment_attempts (
      school_id, student_id, fee_record_id, session_id, outcome,
      amount_paise, amount_captured_paise, razorpay_payment_id, rzp_captured_at
    ) VALUES (
      ${schoolAId}, ${studentAId}, ${oldFeeId}, ${sessionANewId}, 'captured',
      200000, 200000, ${`pay-session-attempt-${suffix}`}, NOW()
    )
  `);
  await db.insert(dunningLog).values({
    schoolId: schoolAId, feeRecordId: oldFeeId, channel: "sms", stage: "D+0",
    status: "sent", recipient: "9000000001", studentName: "Student A",
  });

  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.session = { studentId: studentAId, userRole: "student" };
    next();
  });
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
}, 30_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const schoolId of [schoolAId, schoolBId]) {
    if (schoolId) await db.delete(schools).where(eq(schools.id, schoolId));
  }
});

describe("Student Fees academic-session isolation", () => {
  it("shows a completely empty financial state in a new session", async () => {
    const [feesResponse, summaryResponse, remindersResponse, attemptsResponse] = await Promise.all([
      get("/api/student/fees", sessionANewId),
      get("/api/student/fees/summary", sessionANewId),
      get("/api/student/fees/notification-history", sessionANewId),
      get("/api/student/fees/payment-attempts", sessionANewId),
    ]);

    expect(feesResponse.status).toBe(200);
    expect(await feesResponse.json()).toEqual([]);
    expect(await summaryResponse.json()).toMatchObject({
      totalPaid: 0,
      totalOutstanding: 0,
      previousArrears: 0,
      currentMonthCharges: 0,
    });
    expect(await remindersResponse.json()).toEqual([]);
    expect(await attemptsResponse.json()).toEqual([]);
  });

  it("restores only the prior session's financial history when switched back", async () => {
    const [feesResponse, summaryResponse, remindersResponse, attemptsResponse] = await Promise.all([
      get("/api/student/fees", sessionAOldId),
      get("/api/student/fees/summary", sessionAOldId),
      get("/api/student/fees/notification-history", sessionAOldId),
      get("/api/student/fees/payment-attempts", sessionAOldId),
    ]);
    const fees: any[] = await feesResponse.json();
    const summary: any = await summaryResponse.json();
    const reminders: any[] = await remindersResponse.json();
    const attempts: any[] = await attemptsResponse.json();

    expect(fees.map((fee) => fee.id)).toEqual([oldFeeId]);
    expect(summary.totalPaid).toBe(2000);
    expect(reminders).toHaveLength(1);
    expect(reminders[0].feeRecordId).toBe(oldFeeId);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].feeRecordId).toBe(oldFeeId);
  });

  it("does not mix cached/session responses during repeated rapid A → B switches", async () => {
    const responses = await Promise.all([
      get("/api/student/fees/summary", sessionAOldId),
      get("/api/student/fees/summary", sessionANewId),
      get("/api/student/fees/summary", sessionAOldId),
      get("/api/student/fees/summary", sessionANewId),
    ]);
    const summaries = await Promise.all(responses.map((response) => response.json()));

    expect(summaries.map((summary: any) => summary.totalPaid)).toEqual([2000, 0, 2000, 0]);
  });

  it("rejects a selected session belonging to another school on every Student Fees read", async () => {
    for (const path of [
      "/api/student/fees",
      "/api/student/fees/summary",
      "/api/student/fees/payment-attempts",
      "/api/student/fees/notification-history",
      "/api/student/fees/portal-info",
    ]) {
      const response = await get(path, sessionBOldId);
      expect(response.status, path).toBe(404);
    }
  });

  it("does not reveal foreign invoice or receipt identifiers", async () => {
    const [invoice, receipt] = await Promise.all([
      get(`/api/student/fees/${foreignFeeId}/invoice`, sessionAOldId),
      get(`/api/student/fees/${foreignFeeId}/receipt`, sessionAOldId),
    ]);
    expect(invoice.status).toBe(404);
    expect(receipt.status).toBe(404);
  });

  it("rejects a foreign selected session before student payment mutations run", async () => {
    const createOrder = await fetch(`${baseUrl}/api/payments/create-order`, {
      method: "POST",
      headers: { ...headers(sessionBOldId), "content-type": "application/json" },
      body: JSON.stringify({ feeRecordId: oldFeeId }),
    });
    const clearFailedOrder = await fetch(`${baseUrl}/api/payments/clear-failed-order`, {
      method: "POST",
      headers: { ...headers(sessionBOldId), "content-type": "application/json" },
      body: JSON.stringify({ feeRecordId: oldFeeId, razorpayOrderId: "order_test" }),
    });
    const verify = await fetch(`${baseUrl}/api/payments/verify`, {
      method: "POST",
      headers: { ...headers(sessionBOldId), "content-type": "application/json" },
      body: JSON.stringify({
        feeRecordId: oldFeeId,
        razorpay_payment_id: "pay_test",
        razorpay_order_id: "order_test",
        razorpay_signature: "signature_test",
      }),
    });

    expect(createOrder.status).toBe(404);
    expect(clearFailedOrder.status).toBe(404);
    expect(verify.status).toBe(404);
  });

  it("does not let a student clear an order for another session in the same school", async () => {
    const response = await fetch(`${baseUrl}/api/payments/clear-failed-order`, {
      method: "POST",
      headers: { ...headers(sessionANewId), "content-type": "application/json" },
      body: JSON.stringify({ feeRecordId: oldFeeId, razorpayOrderId: "order_test" }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "INVOICE_SESSION_MISMATCH",
    });
  });
});