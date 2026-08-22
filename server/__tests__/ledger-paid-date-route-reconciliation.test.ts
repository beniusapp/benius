import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import { eq } from "drizzle-orm";
import {
  academicSessions,
  feeRecords,
  paymentRecords,
  schools,
  students,
} from "@shared/schema";
import { db } from "../db";

const renderLedgerPdf = vi.hoisted(() => vi.fn(async () => Buffer.from("%PDF-ledger-test")));
vi.mock("../ledger-pdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ledger-pdf")>();
  return { ...actual, renderLedgerPdf };
});

import { registerRoutes } from "../routes";

type CapturedLedgerInput = {
  rows: Array<{
    invoice_number: string | null;
    invoice_amount: number;
    paid_date: string | null;
  }>;
};

let server: http.Server;
let baseUrl = "";
let schoolId = 0;
let sessionId = 0;
let otherSchoolId = 0;
const fillerInvoiceNumbers = Array.from(
  { length: 19 },
  (_, index) => `LRR-FILLER-${String(index + 1).padStart(2, "0")}`,
);
const expectedInvoices = ["LRR-MULTI", "LRR-SECOND", ...fillerInvoiceNumbers].sort();
const fillerInvoiceAmount = fillerInvoiceNumbers.reduce((sum, _value, index) => sum + 100 + index, 0);
const expectedInvoiceAmount = 7000 + fillerInvoiceAmount;

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!;
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  values.push(value);
  return values;
}

async function createSession(targetSchoolId: number, name: string, active: boolean) {
  const [session] = await db.insert(academicSessions).values({
    schoolId: targetSchoolId,
    sessionName: name,
    startDate: "2024-04-01",
    endDate: "2025-03-31",
    isActive: active,
    status: "active",
    newAdmissionsEnabled: false,
    promotionStrategy: "defer",
  }).returning();
  return session;
}

async function createStudent(targetSchoolId: number, suffix: string) {
  const [student] = await db.insert(students).values({
    schoolId: targetSchoolId,
    digitalStudentId: `LEDGER-${suffix}-${uid()}`,
    name: `Ledger ${suffix}`,
    class: "8",
    section: "A",
    phone: "9999999999",
    dob: "2012-01-01",
    passwordHash: "not-a-login",
  }).returning();
  return student;
}

async function createInvoice(input: {
  targetSchoolId: number;
  targetSessionId: number;
  studentId: number;
  invoiceNumber: string;
  amount: number;
  paidDate: string;
}) {
  const [invoice] = await db.insert(feeRecords).values({
    schoolId: input.targetSchoolId,
    sessionId: input.targetSessionId,
    studentId: input.studentId,
    invoiceNumber: input.invoiceNumber,
    feeType: "Tuition",
    feeName: "Tuition",
    amount: input.amount,
    dueDate: "2024-06-01",
    paidDate: input.paidDate,
    status: "Paid",
  }).returning();
  return invoice;
}

beforeAll(async () => {
  const marker = uid();
  const [school, otherSchool] = await db.insert(schools).values([
    { name: "Ledger Route Reconciliation", code: `LRR-${marker}`.slice(0, 20) },
    { name: "Ledger Route Foreign", code: `LRF-${marker}`.slice(0, 20) },
  ]).returning();
  schoolId = school.id;
  otherSchoolId = otherSchool.id;

  const session = await createSession(schoolId, "2024-25", true);
  const otherSession = await createSession(schoolId, "2024-25-other", false);
  const foreignSession = await createSession(otherSchoolId, "2024-25", true);
  sessionId = session.id;

  const student = await createStudent(schoolId, "Primary");
  const foreignStudent = await createStudent(otherSchoolId, "Foreign");

  const multiPayment = await createInvoice({
    targetSchoolId: schoolId,
    targetSessionId: session.id,
    studentId: student.id,
    invoiceNumber: "LRR-MULTI",
    amount: 3000,
    paidDate: "2024-06-09",
  });
  const secondMatch = await createInvoice({
    targetSchoolId: schoolId,
    targetSessionId: session.id,
    studentId: student.id,
    invoiceNumber: "LRR-SECOND",
    amount: 4000,
    paidDate: "2024-06-10",
  });
  const projectionOnly = await createInvoice({
    targetSchoolId: schoolId,
    targetSessionId: session.id,
    studentId: student.id,
    invoiceNumber: "LRR-PROJECTION-ONLY",
    amount: 5000,
    paidDate: "2024-06-10",
  });
  const otherSessionInvoice = await createInvoice({
    targetSchoolId: schoolId,
    targetSessionId: otherSession.id,
    studentId: student.id,
    invoiceNumber: "LRR-OTHER-SESSION",
    amount: 6000,
    paidDate: "2024-06-10",
  });
  const foreignInvoice = await createInvoice({
    targetSchoolId: otherSchoolId,
    targetSessionId: foreignSession.id,
    studentId: foreignStudent.id,
    invoiceNumber: "LRR-FOREIGN",
    amount: 7000,
    paidDate: "2024-06-10",
  });

  await db.insert(paymentRecords).values([
    {
      schoolId,
      sessionId: session.id,
      feeRecordId: multiPayment.id,
      studentId: student.id,
      paymentMethod: "Cash",
      receivedDate: "2024-06-10",
      amount: 1000,
      idempotencyKey: `lrr-${marker}-multi-june`,
    },
    {
      schoolId,
      sessionId: session.id,
      feeRecordId: multiPayment.id,
      studentId: student.id,
      paymentMethod: "Cash",
      receivedDate: "2024-07-10",
      amount: 2000,
      idempotencyKey: `lrr-${marker}-multi-july`,
    },
    {
      schoolId,
      sessionId: session.id,
      feeRecordId: secondMatch.id,
      studentId: student.id,
      paymentMethod: "Portal Payment",
      receivedDate: "2024-06-10",
      amount: 4000,
      idempotencyKey: `lrr-${marker}-second`,
    },
    {
      schoolId,
      sessionId: session.id,
      feeRecordId: projectionOnly.id,
      studentId: student.id,
      paymentMethod: "Cash",
      receivedDate: "2024-07-10",
      amount: 5000,
      idempotencyKey: `lrr-${marker}-projection`,
    },
    {
      schoolId,
      sessionId: otherSession.id,
      feeRecordId: otherSessionInvoice.id,
      studentId: student.id,
      paymentMethod: "Cash",
      receivedDate: "2024-06-10",
      amount: 6000,
      idempotencyKey: `lrr-${marker}-session`,
    },
    {
      schoolId: otherSchoolId,
      sessionId: foreignSession.id,
      feeRecordId: foreignInvoice.id,
      studentId: foreignStudent.id,
      paymentMethod: "Cash",
      receivedDate: "2024-06-10",
      amount: 7000,
      idempotencyKey: `lrr-${marker}-foreign`,
    },
  ]);

  for (const [index, invoiceNumber] of fillerInvoiceNumbers.entries()) {
    const amount = 100 + index;
    const invoice = await createInvoice({
      targetSchoolId: schoolId,
      targetSessionId: session.id,
      studentId: student.id,
      invoiceNumber,
      amount,
      paidDate: "2024-06-09",
    });
    await db.insert(paymentRecords).values({
      schoolId,
      sessionId: session.id,
      feeRecordId: invoice.id,
      studentId: student.id,
      paymentMethod: "Cash",
      receivedDate: "2024-06-10",
      amount,
      idempotencyKey: `lrr-${marker}-filler-${index}`,
    });
  }

  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.session = { userId: 1, userRole: "admin", schoolId };
    next();
  });
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
}, 30_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const id of [schoolId, otherSchoolId]) {
    if (id) await db.delete(schools).where(eq(schools.id, id));
  }
});

describe("Ledger paid-date route reconciliation", () => {
  const query = "paidDateFrom=2024-06-10&paidDateTo=2024-06-10";
  const headers = () => ({ "x-view-session-id": String(sessionId) });

  it("keeps list count, pagination, latest date, tenant, and session scope authoritative", async () => {
    const firstPageResponse = await fetch(
      `${baseUrl}/api/admin/fees?${query}&page=1&pageSize=20`,
      { headers: headers() },
    );
    expect(firstPageResponse.status).toBe(200);
    const firstPage: any = await firstPageResponse.json();
    expect(firstPage.total).toBe(21);
    expect(firstPage.totalPages).toBe(2);
    expect(firstPage.records).toHaveLength(20);

    const secondPageResponse = await fetch(
      `${baseUrl}/api/admin/fees?${query}&page=2&pageSize=20`,
      { headers: headers() },
    );
    expect(secondPageResponse.status).toBe(200);
    const secondPage: any = await secondPageResponse.json();
    expect(secondPage.records).toHaveLength(1);

    const records = [...firstPage.records, ...secondPage.records];
    expect(records.map((row: any) => row.invoiceNumber).sort()).toEqual(expectedInvoices);
    expect(records.reduce((sum: number, row: any) => sum + Number(row.amount), 0))
      .toBe(expectedInvoiceAmount);
    expect(records.find((row: any) => row.invoiceNumber === "LRR-MULTI").paidDate)
      .toBe("2024-07-10");
  });

  it("returns the identical invoice population in CSV", async () => {
    const response = await fetch(
      `${baseUrl}/api/admin/fees/export-ledger?${query}`,
      { headers: headers() },
    );
    expect(response.status).toBe(200);
    const text = (await response.text()).replace(/^\uFEFF/, "");
    const lines = text.split(/\r?\n/).filter(Boolean).map(parseCsvLine);
    expect(lines[0]![10]).toBe("Invoice Amount (₹)");
    expect(lines[0]![13]).toBe("Latest Payment On");
    expect(lines.slice(1).map((row) => row[0]).sort()).toEqual(expectedInvoices);
    expect(lines.slice(1).reduce((sum, row) => sum + Number(row[10]), 0))
      .toBe(expectedInvoiceAmount);
  });

  it("passes the identical authoritative rows to Ledger PDF GET and POST", async () => {
    renderLedgerPdf.mockClear();
    const getResponse = await fetch(
      `${baseUrl}/api/admin/fees/ledger/pdf?${query}`,
      { headers: headers() },
    );
    expect(getResponse.status).toBe(200);
    const getInput = renderLedgerPdf.mock.calls[0]![0] as CapturedLedgerInput;
    expect(getInput.rows.map((row) => row.invoice_number).sort()).toEqual(expectedInvoices);
    expect(getInput.rows.find((row) => row.invoice_number === "LRR-MULTI")?.paid_date)
      .toBe("2024-07-10");

    const postResponse = await fetch(`${baseUrl}/api/admin/fees/ledger/pdf`, {
      method: "POST",
      headers: { ...headers(), "content-type": "application/json" },
      body: JSON.stringify({
        paidDateFrom: "2024-06-10",
        paidDateTo: "2024-06-10",
        selectAllMatching: true,
      }),
    });
    expect(postResponse.status).toBe(200);
    const postInput = renderLedgerPdf.mock.calls[1]![0] as CapturedLedgerInput;
    expect(postInput.rows.map((row) => row.invoice_number).sort()).toEqual(expectedInvoices);
    expect(postInput.rows.reduce((sum, row) => sum + Number(row.invoice_amount), 0))
      .toBe(expectedInvoiceAmount);
  });
});