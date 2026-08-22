/**
 * End-to-end reconciliation of Financial Analytics against controlled,
 * development-only database records.
 *
 * This is intentionally broader than the focused data-service tests:
 *   raw database rows -> independent ledger calculation -> canonical service
 *   -> HTTP JSON -> rendered PDF text.
 *
 * Every fixture is tenant/session isolated and the owning schools are deleted
 * in afterAll, even when an assertion fails.
 *
 * This suite intentionally writes controlled financial rows. It is skipped
 * unless explicitly enabled with a fingerprint pinned to an approved
 * development database:
 *   FINANCIAL_ANALYTICS_RECONCILIATION_WRITE_TEST=development-only \
 *     npx vitest run server/__tests__/financial-analytics-reconciliation.test.ts
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import { createHash } from "node:crypto";
import http from "node:http";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { eq, sql } from "drizzle-orm";
import {
  academicSessions,
  feeRecords,
  paymentRecords,
  schools,
  students,
} from "@shared/schema";
import { db } from "../db";
import {
  buildFinancialAnalytics,
  type FinancialAnalyticsResult,
  type FinancialPreset,
  type SessionInfo,
} from "../financial-analytics-data";
import { registerFeesRoutes } from "../fees-routes";
import { checkSessionContext } from "../routes";

const execFileAsync = promisify(execFile);
const fixtureSchoolIds = new Set<number>();
const RECONCILIATION_WRITE_OPT_IN =
  process.env.FINANCIAL_ANALYTICS_RECONCILIATION_WRITE_TEST === "development-only";
const APPROVED_DEVELOPMENT_DATABASE_FINGERPRINT =
  "c262408486c14dbc4005f667bfe2a69338438afd587157ea599b6a2069c05ef4";

function configuredDatabaseFingerprint(): string | null {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;
  try {
    const url = new URL(connectionString);
    const identity = [
      url.protocol.toLowerCase(),
      url.hostname.toLowerCase(),
      url.port || "5432",
      url.pathname.replace(/^\/+/, ""),
    ].join("|");
    return createHash("sha256").update(identity).digest("hex");
  } catch {
    return null;
  }
}

function assertSafeFixtureRuntime(): void {
  const actualFingerprint = configuredDatabaseFingerprint();
  if (
    !RECONCILIATION_WRITE_OPT_IN ||
    process.env.NODE_ENV === "production" ||
    Boolean(process.env.REPLIT_DEPLOYMENT) ||
    process.env.VITEST !== "true" ||
    !actualFingerprint ||
    APPROVED_DEVELOPMENT_DATABASE_FINGERPRINT !== actualFingerprint
  ) {
    throw new Error(
      "Financial Analytics reconciliation writes require an explicit development-only Vitest opt-in on the approved database",
    );
  }
}

interface Fixture {
  schoolId: number;
  foreignSchoolId: number;
  sessionId: number;
  session: SessionInfo;
}

interface RangeCase {
  name: string;
  preset: FinancialPreset;
  customStart?: string;
  customEnd?: string;
}

type RawInvoice = {
  id: number;
  fee_type: string;
  student_class: string;
  amount: number;
  late_fee_amount: number;
  due_date: string;
  lifetime_paid: number;
  lifetime_refunds: number;
};

type RawPayment = {
  id: number;
  invoice_number: string;
  fee_type: string;
  student_class: string;
  amount: number;
  late_fee_paid: number;
  payment_method: string;
  razorpay_payment_id: string | null;
  payment_mode: string | null;
  received_date: string;
  created_at: string;
  denomination_breakdown: Record<string, unknown> | null;
};

type RawRefund = {
  fee_type: string;
  student_class: string;
  amount: number;
  effective_date: string;
  effective_hour_ist: number;
  razorpay_payment_id: string;
  payment_method: string | null;
  payment_razorpay_id: string | null;
};

type IndependentLedger = {
  summary: FinancialAnalyticsResult["summary"];
  online: Pick<FinancialAnalyticsResult["online"], "grossCollected" | "refunds" | "netCollected" | "transactionCount" | "averageTransaction">;
  offline: Pick<FinancialAnalyticsResult["offline"], "grossCollected" | "refunds" | "netCollected" | "transactionCount" | "averageTransaction">;
  classWise: FinancialAnalyticsResult["classWise"];
  feeCategories: FinancialAnalyticsResult["feeCategories"];
  aging: FinancialAnalyticsResult["aging"];
  cashDenominations: FinancialAnalyticsResult["cashDenominations"];
  trendByKey: Map<string, { billed: number; grossCollected: number; refunds: number; netCollected: number }>;
  sourceCounts: { invoices: number; payments: number; refunds: number };
  paymentInvoiceNumbers: string[];
};

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function istInstant(date: string, time = "12:00:00"): string {
  return new Date(`${date}T${time}+05:30`).toISOString();
}

function auditTodayIST(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function auditAddDays(date: string, count: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + count);
  return value.toISOString().slice(0, 10);
}

function auditDaysBetween(start: string, end: string): number {
  return Math.round(
    (new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) /
      86_400_000,
  );
}

function auditIsOnline(method: string | null | undefined, razorpayPaymentId: string | null | undefined): boolean {
  if (razorpayPaymentId) return true;
  const normalized = String(method ?? "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  return normalized === "portal payment" ||
    normalized === "online" ||
    normalized === "online payment" ||
    normalized === "razorpay";
}

function auditPeriod(range: RangeCase, session: SessionInfo): { startDate: string; endDate: string } {
  const today = auditTodayIST();
  if (range.preset === "today") return { startDate: today, endDate: today };
  if (range.preset === "this_week") {
    const startDate = startOfWeek(today);
    return { startDate, endDate: auditAddDays(startDate, 6) };
  }
  if (range.preset === "this_month") {
    return { startDate: monthStart(today), endDate: monthEnd(today) };
  }
  if (range.preset === "academic_year") {
    return { startDate: session.startDate, endDate: session.endDate };
  }
  if (!range.customStart || !range.customEnd) throw new Error("Audit custom range is incomplete");
  return { startDate: range.customStart, endDate: range.customEnd };
}

function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function monthEnd(date: string): string {
  const [year, month] = date.slice(0, 7).split("-").map(Number);
  const day = new Date(Date.UTC(year!, month!, 0)).getUTCDate();
  return `${date.slice(0, 7)}-${String(day).padStart(2, "0")}`;
}

function academicBounds(date: string): { start: string; end: string; name: string } {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const startYear = month >= 4 ? year : year - 1;
  return {
    start: `${startYear}-04-01`,
    end: `${startYear + 1}-03-31`,
    name: `${startYear}-${String(startYear + 1).slice(-2)}`,
  };
}

function startOfWeek(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const isoDay = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  return auditAddDays(date, -(isoDay - 1));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function pct(value: number, billed: number): number {
  return billed > 0 ? Math.round((value / billed) * 1000) / 10 : 0;
}

function pdfAmount(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 0,
  }).format(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertPdfSequence(text: string, label: string, values: Array<string | number>): void {
  const pattern = values
    .map((value) => escapeRegExp(String(value)))
    .join(".*?");
  expect(text, label).toMatch(new RegExp(pattern, "i"));
}

function makeApp(schoolId: number): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.session = { userId: 1, userRole: "admin", schoolId };
    next();
  });
  app.use(checkSessionContext);
  registerFeesRoutes(app);
  return app;
}

function listen(app: express.Express): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function close(server: http.Server | null): Promise<void> {
  if (!server) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function createFixture(): Promise<Fixture> {
  assertSafeFixtureRuntime();
  const today = auditTodayIST();
  const bounds = academicBounds(today);
  const weekStart = startOfWeek(today);
  const weekEnd = auditAddDays(weekStart, 6);
  const currentMonthStart = monthStart(today);
  const currentMonthEnd = monthEnd(today);
  const marker = uid();

  const [school] = await db.insert(schools).values({
    name: "Financial Analytics Reconciliation School",
    code: `FAR-${marker}`.slice(0, 20),
    city: "Test City",
    state: "Test State",
  }).returning();
  fixtureSchoolIds.add(school.id);

  const [session] = await db.insert(academicSessions).values({
    schoolId: school.id,
    sessionName: bounds.name,
    startDate: bounds.start,
    endDate: bounds.end,
    isActive: true,
    status: "active",
    newAdmissionsEnabled: false,
    promotionStrategy: "defer",
  }).returning();

  const [studentA, studentB] = await db.insert(students).values([
    {
      schoolId: school.id,
      digitalStudentId: `FAR-A-${marker}`,
      name: "Reconciliation Alpha",
      class: "5",
      section: "A",
      phone: "9000000001",
      dob: "2014-01-01",
      passwordHash: "not-a-login",
    },
    {
      schoolId: school.id,
      digitalStudentId: `FAR-B-${marker}`,
      name: "Reconciliation Beta",
      class: "8",
      section: "B",
      phone: "9000000002",
      dob: "2011-01-01",
      passwordHash: "not-a-login",
    },
  ]).returning();

  const invoiceSpecs = [
    { key: "session-start", studentId: studentA.id, feeType: "Admission", amount: 10_000, late: 0, due: bounds.start },
    { key: "month-start", studentId: studentA.id, feeType: "Tuition", amount: 20_000, late: 500, due: currentMonthStart },
    { key: "week-start", studentId: studentB.id, feeType: "Transport", amount: 30_000, late: 1_000, due: weekStart },
    { key: "today", studentId: studentB.id, feeType: "Tuition", amount: 40_000, late: 1_500, due: today },
    { key: "week-end", studentId: studentA.id, feeType: "Exam", amount: 50_000, late: 0, due: weekEnd },
    { key: "month-end", studentId: studentB.id, feeType: "Annual", amount: 60_000, late: 2_000, due: currentMonthEnd },
    { key: "session-end", studentId: studentA.id, feeType: "Graduation", amount: 70_000, late: 0, due: bounds.end },
  ] as const;

  const invoiceRows = await db.insert(feeRecords).values(invoiceSpecs.map((item, index) => ({
    studentId: item.studentId,
    schoolId: school.id,
    sessionId: session.id,
    feeType: item.feeType,
    feeName: item.feeType,
    amount: item.amount,
    dueDate: item.due,
    status: "Due",
    lateFeeAmount: item.late,
    academicYear: bounds.name,
    invoiceNumber: `FAR-${marker}-${index + 1}`,
  }))).returning();
  const invoice = Object.fromEntries(invoiceSpecs.map((item, index) => [item.key, invoiceRows[index]!]));

  async function payment(input: {
    key: string;
    invoiceKey: keyof typeof invoice;
    studentId: number;
    date: string;
    amount: number;
    method: string;
    rzp?: string;
    mode?: string;
    denomination?: Record<string, number>;
    hour?: string;
  }) {
    const [row] = await db.insert(paymentRecords).values({
      schoolId: school.id,
      sessionId: session.id,
      feeRecordId: invoice[input.invoiceKey].id,
      studentId: input.studentId,
      paymentMethod: input.method,
      receivedDate: input.date,
      amount: input.amount,
      idempotencyKey: `far-${marker}-${input.key}`.slice(0, 64),
      receiptNumber: `FAR-${input.key}`.slice(0, 20),
      razorpayPaymentId: input.rzp,
      paymentMode: input.mode,
      gatewayStatus: input.rzp ? "captured" : undefined,
      denominationBreakdown: input.denomination,
      createdAt: new Date(istInstant(input.date, input.hour ?? "12:00:00")),
    }).returning();
    return row;
  }

  const sessionStartPayment = await payment({
    key: "session-start", invoiceKey: "session-start", studentId: studentA.id,
    date: bounds.start, amount: 8_000, method: "Portal Payment",
    rzp: `pay_far_${marker}_session`, mode: "upi",
  });
  const monthStartPayment = await payment({
    key: "month-start", invoiceKey: "month-start", studentId: studentA.id,
    date: currentMonthStart, amount: 7_000, method: "Bank Transfer",
  });
  const weekStartPayment = await payment({
    key: "week-start", invoiceKey: "week-start", studentId: studentB.id,
    date: weekStart, amount: 3_000, method: "Cheque",
  });
  const todayCashPayment = await payment({
    key: "today-cash", invoiceKey: "today", studentId: studentB.id,
    date: today, amount: 5_000, method: "Cash", denomination: { "500": 8, "200": 5 }, hour: "09:15:00",
  });
  const todayOnlinePayment = await payment({
    key: "today-online", invoiceKey: "today", studentId: studentB.id,
    date: today, amount: 12_000, method: "Portal Payment",
    rzp: `pay_far_${marker}_today`, mode: "card", hour: "11:45:00",
  });
  await payment({
    key: "today-cash-no-denom", invoiceKey: "today", studentId: studentB.id,
    date: today, amount: 1_100, method: "Cash", hour: "15:30:00",
  });
  const weekEndPayment = await payment({
    key: "week-end", invoiceKey: "week-end", studentId: studentA.id,
    date: weekEnd, amount: 9_000, method: "Online",
    rzp: `pay_far_${marker}_week_end`, mode: "upi",
  });
  await payment({
    key: "month-end", invoiceKey: "month-end", studentId: studentB.id,
    date: currentMonthEnd, amount: 4_000, method: "Demand Draft",
  });
  const sessionEndPayment = await payment({
    key: "session-end", invoiceKey: "session-end", studentId: studentA.id,
    date: bounds.end, amount: 10_000, method: "Portal Payment",
    rzp: `pay_far_${marker}_session_end`, mode: "netbanking",
  });
  await payment({
    key: "lifetime-before-month", invoiceKey: "today", studentId: studentB.id,
    date: auditAddDays(currentMonthStart, -1), amount: 5_000, method: "Cash",
  });

  async function refund(input: {
    key: string;
    invoiceId: number;
    paymentId: number;
    rzp: string;
    amount: number;
    status: "processed" | "requested" | "failed";
    at: string;
  }) {
    await db.execute(sql`
      INSERT INTO refunds (
        school_id, session_id, student_id, fee_record_id, payment_record_id,
        razorpay_payment_id, requested_amount_paise, processed_amount_paise,
        local_status, provider_processed_at, idempotency_key, origin, currency,
        created_at, updated_at
      ) VALUES (
        ${school.id}, ${session.id}, NULL, ${input.invoiceId}, ${input.paymentId},
        ${input.rzp}, ${input.amount * 100},
        ${input.status === "processed" ? input.amount * 100 : null},
        ${input.status}, ${input.at}::timestamptz,
        ${`far-refund-${marker}-${input.key}`}, 'admin', 'INR',
        ${input.at}::timestamptz, ${input.at}::timestamptz
      )
    `);
  }

  await refund({
    key: "month-start", invoiceId: invoice["month-start"].id, paymentId: monthStartPayment.id,
    rzp: `rf_far_${marker}_month`, amount: 250, status: "processed",
    at: istInstant(currentMonthStart, "10:00:00"),
  });
  await refund({
    key: "week-start", invoiceId: invoice["week-start"].id, paymentId: weekStartPayment.id,
    rzp: `rf_far_${marker}_week`, amount: 500, status: "processed",
    at: istInstant(weekStart, "10:00:00"),
  });
  await refund({
    key: "today-midnight", invoiceId: invoice.today.id, paymentId: todayOnlinePayment.id,
    rzp: `rf_far_${marker}_today`, amount: 2_000, status: "processed",
    at: istInstant(today, "00:00:00"),
  });
  await refund({
    key: "today-requested", invoiceId: invoice.today.id, paymentId: todayOnlinePayment.id,
    rzp: `rf_far_${marker}_requested`, amount: 999, status: "requested",
    at: istInstant(today, "13:00:00"),
  });
  await refund({
    key: "week-end", invoiceId: invoice["week-end"].id, paymentId: weekEndPayment.id,
    rzp: `rf_far_${marker}_week_end`, amount: 1_000, status: "processed",
    at: istInstant(weekEnd, "17:00:00"),
  });
  await refund({
    key: "session-end", invoiceId: invoice["session-end"].id, paymentId: sessionEndPayment.id,
    rzp: `rf_far_${marker}_session_end`, amount: 1_500, status: "processed",
    at: istInstant(bounds.end, "09:00:00"),
  });
  const todayStart = new Date(istInstant(today, "00:00:00"));
  await refund({
    key: "one-second-before-today", invoiceId: invoice.today.id, paymentId: todayCashPayment.id,
    rzp: `rf_far_${marker}_pre_today`, amount: 300, status: "processed",
    at: new Date(todayStart.getTime() - 1_000).toISOString(),
  });

  async function attempt(
    outcome: string,
    key: string,
    rzp: string | null,
    amount: number,
    lifecycleAt: string,
    createdAt = lifecycleAt,
  ) {
    await db.execute(sql`
      INSERT INTO payment_attempts (
        school_id, student_id, fee_record_id, session_id, outcome,
        amount_paise, amount_captured_paise, razorpay_payment_id,
        rzp_captured_at, rzp_authorized_at, rzp_failed_at,
        created_at, updated_at
      ) VALUES (
        ${school.id}, ${studentB.id}, ${invoice.today.id}, ${session.id}, ${outcome},
        ${amount * 100}, ${outcome === "captured" ? amount * 100 : null}, ${rzp},
        ${outcome === "captured" ? sql`${lifecycleAt}::timestamptz` : null},
        ${outcome === "authorized" ? sql`${lifecycleAt}::timestamptz` : null},
        ${outcome === "failed" ? sql`${lifecycleAt}::timestamptz` : null},
        ${createdAt}::timestamptz, ${lifecycleAt}::timestamptz
      )
    `);
  }
  await attempt("captured", "captured", todayOnlinePayment.razorpayPaymentId, 12_000, istInstant(today, "11:45:00"));
  await attempt("failed", "failed", `pay_far_${marker}_failed`, 6_000, istInstant(today, "12:10:00"));
  await attempt("cancelled", "cancelled", `pay_far_${marker}_cancelled`, 7_000, istInstant(today, "12:20:00"));
  await attempt("pending", "pending", null, 8_000, istInstant(today, "12:30:00"));
  await attempt("authorized", "authorized", `pay_far_${marker}_authorized`, 9_000, istInstant(today, "12:40:00"));
  await attempt(
    "failed",
    "failed-outside-today",
    `pay_far_${marker}_failed_outside`,
    99_000,
    istInstant(auditAddDays(today, -1), "23:59:59"),
    istInstant(today, "12:50:00"),
  );

  // Same school, different session: large values must never leak into the selected session.
  const [otherSession] = await db.insert(academicSessions).values({
    schoolId: school.id,
    sessionName: `${bounds.name}-isolation`,
    startDate: bounds.start,
    endDate: bounds.end,
    isActive: false,
    status: "draft",
    newAdmissionsEnabled: false,
    promotionStrategy: "defer",
  }).returning();
  const [otherInvoice] = await db.insert(feeRecords).values({
    studentId: studentA.id,
    schoolId: school.id,
    sessionId: otherSession.id,
    feeType: "Session Isolation",
    amount: 888_888,
    dueDate: today,
    status: "Due",
    invoiceNumber: `FAR-OTHER-${marker}`,
  }).returning();
  await db.insert(paymentRecords).values({
    schoolId: school.id,
    sessionId: otherSession.id,
    feeRecordId: otherInvoice.id,
    studentId: studentA.id,
    paymentMethod: "Cash",
    receivedDate: today,
    amount: 888_888,
    idempotencyKey: `far-other-${marker}`.slice(0, 64),
  });

  // Different tenant: large values must never leak through school joins.
  const [foreignSchool] = await db.insert(schools).values({
    name: "Financial Analytics Foreign Isolation School",
    code: `FAF-${marker}`.slice(0, 20),
  }).returning();
  fixtureSchoolIds.add(foreignSchool.id);
  const [foreignSession] = await db.insert(academicSessions).values({
    schoolId: foreignSchool.id,
    sessionName: bounds.name,
    startDate: bounds.start,
    endDate: bounds.end,
    isActive: true,
    status: "active",
    newAdmissionsEnabled: false,
    promotionStrategy: "defer",
  }).returning();
  const [foreignStudent] = await db.insert(students).values({
    schoolId: foreignSchool.id,
    digitalStudentId: `FAF-${marker}`,
    name: "Foreign Reconciliation Student",
    class: "12",
    section: "Z",
    phone: "9000000099",
    dob: "2009-01-01",
    passwordHash: "not-a-login",
  }).returning();
  const [foreignInvoice] = await db.insert(feeRecords).values({
    studentId: foreignStudent.id,
    schoolId: foreignSchool.id,
    sessionId: foreignSession.id,
    feeType: "Tenant Isolation",
    amount: 999_999,
    dueDate: today,
    status: "Due",
    invoiceNumber: `FAF-${marker}`,
  }).returning();
  await db.insert(paymentRecords).values({
    schoolId: foreignSchool.id,
    sessionId: foreignSession.id,
    feeRecordId: foreignInvoice.id,
    studentId: foreignStudent.id,
    paymentMethod: "Portal Payment",
    receivedDate: today,
    amount: 999_999,
    razorpayPaymentId: `pay_foreign_${marker}`,
    idempotencyKey: `far-foreign-${marker}`.slice(0, 64),
  });

  return {
    schoolId: school.id,
    foreignSchoolId: foreignSchool.id,
    sessionId: session.id,
    session: {
      id: session.id,
      sessionName: session.sessionName,
      startDate: bounds.start,
      endDate: bounds.end,
    },
  };
}

function groupedRows(
  invoices: RawInvoice[],
  payments: RawPayment[],
  refunds: RawRefund[],
  groupKey: "student_class" | "fee_type",
) {
  const map = new Map<string, { billed: number; grossCollected: number; refunds: number; outstanding: number }>();
  const get = (key: string) => {
    const existing = map.get(key) ?? { billed: 0, grossCollected: 0, refunds: 0, outstanding: 0 };
    map.set(key, existing);
    return existing;
  };
  for (const row of invoices) {
    const item = get(String(row[groupKey]));
    item.billed += row.amount + row.late_fee_amount;
    item.outstanding += Math.max(0, row.amount + row.late_fee_amount - row.lifetime_paid + row.lifetime_refunds);
  }
  for (const row of payments) get(String(row[groupKey])).grossCollected += row.amount;
  for (const row of refunds) get(String(row[groupKey])).refunds += row.amount;
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => ({
    [groupKey === "student_class" ? "class" : "feeType"]: key,
    billed: value.billed,
    grossCollected: value.grossCollected,
    refunds: value.refunds,
    netCollected: value.grossCollected - value.refunds,
    outstanding: value.outstanding,
  }));
}

function trendKey(preset: FinancialPreset, startDate: string, endDate: string, date: string, createdAt?: string): string {
  if (preset === "today") {
    if (!createdAt) return "00";
    const instant = new Date(createdAt);
    return String(new Date(instant.getTime() + 330 * 60_000).getUTCHours()).padStart(2, "0");
  }
  if (preset === "academic_year" || auditDaysBetween(startDate, endDate) + 1 > 62) return date.slice(0, 7);
  return date;
}

async function independentLedger(
  fixture: Fixture,
  preset: FinancialPreset,
  startDate: string,
  endDate: string,
): Promise<IndependentLedger> {
  const invoiceResult = await db.execute(sql`
    SELECT
      fr.id,
      fr.fee_type,
      s.class AS student_class,
      fr.amount,
      fr.late_fee_amount,
      to_char(fr.due_date, 'YYYY-MM-DD') AS due_date,
      COALESCE((
        SELECT SUM(pr.amount)
        FROM payment_records pr
        WHERE pr.school_id = ${fixture.schoolId}
          AND pr.fee_record_id = fr.id
      ), 0) AS lifetime_paid,
      COALESCE((
        SELECT SUM(COALESCE(rf.processed_amount_paise, rf.requested_amount_paise)) / 100.0
        FROM refunds rf
        WHERE rf.school_id = ${fixture.schoolId}
          AND rf.fee_record_id = fr.id
          AND rf.local_status = 'processed'
      ), 0) AS lifetime_refunds
    FROM fee_records fr
    JOIN students s ON s.id = fr.student_id AND s.school_id = ${fixture.schoolId}
    WHERE fr.school_id = ${fixture.schoolId}
      AND fr.session_id = ${fixture.sessionId}
      AND fr.due_date BETWEEN ${startDate}::date AND ${endDate}::date
    ORDER BY fr.id
  `);
  const invoices = invoiceResult.rows.map((row: any): RawInvoice => ({
    ...row,
    id: Number(row.id),
    amount: Number(row.amount),
    late_fee_amount: Number(row.late_fee_amount),
    lifetime_paid: Number(row.lifetime_paid),
    lifetime_refunds: Number(row.lifetime_refunds),
  }));

  const paymentResult = await db.execute(sql`
    SELECT
      pr.id,
      fr.invoice_number,
      fr.fee_type,
      s.class AS student_class,
      pr.amount,
      pr.late_fee_paid,
      pr.payment_method,
      pr.razorpay_payment_id,
      pr.payment_mode,
      to_char(pr.received_date, 'YYYY-MM-DD') AS received_date,
      pr.created_at,
      pr.denomination_breakdown
    FROM payment_records pr
    JOIN fee_records fr ON fr.id = pr.fee_record_id
                       AND fr.school_id = ${fixture.schoolId}
                       AND fr.session_id = ${fixture.sessionId}
    JOIN students s ON s.id = pr.student_id AND s.school_id = ${fixture.schoolId}
    WHERE pr.school_id = ${fixture.schoolId}
      AND pr.received_date BETWEEN ${startDate}::date AND ${endDate}::date
    ORDER BY pr.id
  `);
  const payments = paymentResult.rows.map((row: any): RawPayment => ({
    ...row,
    id: Number(row.id),
    amount: Number(row.amount),
    late_fee_paid: Number(row.late_fee_paid),
    created_at: new Date(row.created_at).toISOString(),
  }));

  const refundResult = await db.execute(sql`
    SELECT
      fr.fee_type,
      s.class AS student_class,
      COALESCE(rf.processed_amount_paise, rf.requested_amount_paise) / 100.0 AS amount,
      to_char(
        COALESCE(rf.provider_processed_at, rf.updated_at) AT TIME ZONE 'Asia/Kolkata',
        'YYYY-MM-DD'
      ) AS effective_date,
      EXTRACT(HOUR FROM
        COALESCE(rf.provider_processed_at, rf.updated_at) AT TIME ZONE 'Asia/Kolkata'
      )::int AS effective_hour_ist,
      rf.razorpay_payment_id,
      pr.payment_method,
      pr.razorpay_payment_id AS payment_razorpay_id
    FROM refunds rf
    JOIN fee_records fr ON fr.id = rf.fee_record_id
                       AND fr.school_id = ${fixture.schoolId}
                       AND fr.session_id = ${fixture.sessionId}
    JOIN students s ON s.id = fr.student_id AND s.school_id = ${fixture.schoolId}
    LEFT JOIN payment_records pr ON pr.id = rf.payment_record_id
                                AND pr.school_id = ${fixture.schoolId}
    WHERE rf.school_id = ${fixture.schoolId}
      AND rf.local_status = 'processed'
      AND (
        COALESCE(rf.provider_processed_at, rf.updated_at) AT TIME ZONE 'Asia/Kolkata'
      )::date BETWEEN ${startDate}::date AND ${endDate}::date
    ORDER BY rf.id
  `);
  const refunds = refundResult.rows.map((row: any): RawRefund => ({
    ...row,
    amount: Number(row.amount),
    effective_hour_ist: Number(row.effective_hour_ist),
  }));

  const billed = invoices.reduce((sum, row) => sum + row.amount + row.late_fee_amount, 0);
  const grossCollected = payments.reduce((sum, row) => sum + row.amount, 0);
  const totalRefunds = refunds.reduce((sum, row) => sum + row.amount, 0);
  const outstanding = invoices.reduce(
    (sum, row) => sum + Math.max(0, row.amount + row.late_fee_amount - row.lifetime_paid + row.lifetime_refunds),
    0,
  );
  const overdueAmount = invoices
    .filter((row) => row.due_date < auditTodayIST())
    .reduce(
      (sum, row) => sum + Math.max(0, row.amount + row.late_fee_amount - row.lifetime_paid + row.lifetime_refunds),
      0,
    );
  const onlinePayments = payments.filter((row) => auditIsOnline(row.payment_method, row.razorpay_payment_id));
  const offlinePayments = payments.filter((row) => !auditIsOnline(row.payment_method, row.razorpay_payment_id));
  const onlineRefunds = refunds.filter((row) =>
    Boolean(row.razorpay_payment_id) || auditIsOnline(row.payment_method, row.payment_razorpay_id),
  );
  const offlineRefunds = refunds.filter((row) => !onlineRefunds.includes(row));

  const channel = (rows: RawPayment[], refundRows: RawRefund[]) => {
    const gross = rows.reduce((sum, row) => sum + row.amount, 0);
    const refunded = refundRows.reduce((sum, row) => sum + row.amount, 0);
    return {
      grossCollected: gross,
      refunds: refunded,
      netCollected: gross - refunded,
      transactionCount: rows.length,
      averageTransaction: rows.length ? round2(gross / rows.length) : 0,
    };
  };

  const cashRows = payments.filter((row) => row.payment_method.trim().toLowerCase() === "cash");
  const denominationMap = new Map<number, number>();
  let withBreakdownCount = 0;
  let documentedAmount = 0;
  for (const row of cashRows) {
    let validForPayment = false;
    for (const [key, rawQuantity] of Object.entries(row.denomination_breakdown ?? {})) {
      if (!/^\d+$/.test(key)) continue;
      const denomination = Number(key);
      const quantity = Number(rawQuantity);
      if (!Number.isInteger(denomination) || denomination <= 0 || !Number.isInteger(quantity) || quantity <= 0) continue;
      validForPayment = true;
      denominationMap.set(denomination, (denominationMap.get(denomination) ?? 0) + quantity);
      documentedAmount += denomination * quantity;
    }
    if (validForPayment) withBreakdownCount += 1;
  }

  const agingMap = new Map<string, { count: number; amount: number }>([
    ["1-30", { count: 0, amount: 0 }],
    ["31-60", { count: 0, amount: 0 }],
    ["61-90", { count: 0, amount: 0 }],
    ["90+", { count: 0, amount: 0 }],
  ]);
  for (const row of invoices) {
    const amount = Math.max(0, row.amount + row.late_fee_amount - row.lifetime_paid + row.lifetime_refunds);
    const overdueDays = auditDaysBetween(row.due_date, auditTodayIST());
    if (amount <= 0 || overdueDays <= 0) continue;
    const bucket = overdueDays <= 30 ? "1-30" : overdueDays <= 60 ? "31-60" : overdueDays <= 90 ? "61-90" : "90+";
    const value = agingMap.get(bucket)!;
    value.count += 1;
    value.amount += amount;
  }

  const trendByKey = new Map<string, { billed: number; grossCollected: number; refunds: number; netCollected: number }>();
  const trend = (key: string) => {
    const value = trendByKey.get(key) ?? { billed: 0, grossCollected: 0, refunds: 0, netCollected: 0 };
    trendByKey.set(key, value);
    return value;
  };
  for (const row of invoices) {
    const key = trendKey(preset, startDate, endDate, row.due_date);
    trend(key).billed += row.amount + row.late_fee_amount;
  }
  for (const row of payments) {
    const key = trendKey(preset, startDate, endDate, row.received_date, row.created_at);
    trend(key).grossCollected += row.amount;
  }
  for (const row of refunds) {
    const key = preset === "today"
      ? String(row.effective_hour_ist).padStart(2, "0")
      : trendKey(preset, startDate, endDate, row.effective_date);
    trend(key).refunds += row.amount;
  }
  for (const value of trendByKey.values()) value.netCollected = value.grossCollected - value.refunds;

  return {
    summary: {
      billed,
      grossCollected,
      refunds: totalRefunds,
      netCollected: grossCollected - totalRefunds,
      outstanding,
      collectionEfficiency: pct(grossCollected - totalRefunds, billed),
      onlineCollected: onlinePayments.reduce((sum, row) => sum + row.amount, 0),
      offlineCollected: offlinePayments.reduce((sum, row) => sum + row.amount, 0),
      overdueAmount,
      transactionCount: payments.length,
      totalLatePenalties: payments.reduce((sum, row) => sum + row.late_fee_paid, 0),
    },
    online: channel(onlinePayments, onlineRefunds),
    offline: channel(offlinePayments, offlineRefunds),
    classWise: groupedRows(invoices, payments, refunds, "student_class") as FinancialAnalyticsResult["classWise"],
    feeCategories: groupedRows(invoices, payments, refunds, "fee_type") as FinancialAnalyticsResult["feeCategories"],
    aging: ["1-30", "31-60", "61-90", "90+"].map((bucket) => ({ bucket, ...agingMap.get(bucket)! })) as FinancialAnalyticsResult["aging"],
    cashDenominations: {
      cashCollected: cashRows.reduce((sum, row) => sum + row.amount, 0),
      cashPaymentCount: cashRows.length,
      withBreakdownCount,
      withoutBreakdownCount: cashRows.length - withBreakdownCount,
      documentedAmount,
      denominations: [...denominationMap.entries()]
        .map(([denomination, quantity]) => ({ denomination, quantity, total: denomination * quantity }))
        .sort((a, b) => b.denomination - a.denomination),
    },
    trendByKey,
    sourceCounts: { invoices: invoices.length, payments: payments.length, refunds: refunds.length },
    paymentInvoiceNumbers: [...new Set(payments.map((row) => row.invoice_number))].sort(),
  };
}

const describeReconciliation = RECONCILIATION_WRITE_OPT_IN ? describe.sequential : describe.skip;

describeReconciliation("Financial Analytics all-range reconciliation", () => {
  let fixture: Fixture;
  let server: http.Server | null = null;
  let baseUrl = "";
  let ranges: RangeCase[] = [];

  beforeAll(async () => {
    assertSafeFixtureRuntime();
    await execFileAsync("pdftotext", ["-v"]);
    fixture = await createFixture();
    server = await listen(makeApp(fixture.schoolId));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Could not determine audit server port");
    baseUrl = `http://127.0.0.1:${address.port}`;

    const today = auditTodayIST();
    const weekStart = startOfWeek(today);
    const weekEnd = auditAddDays(weekStart, 6);
    ranges = [
      { name: "Today", preset: "today" },
      { name: "This Week", preset: "this_week" },
      { name: "This Month", preset: "this_month" },
      { name: "Academic Year", preset: "academic_year" },
      { name: "Custom: month start through week start", preset: "custom", customStart: monthStart(today), customEnd: weekStart },
      { name: "Custom: week end through month end", preset: "custom", customStart: weekEnd, customEnd: monthEnd(today) },
    ];
  }, 30_000);

  afterAll(async () => {
    const cleanupErrors: unknown[] = [];
    try {
      await close(server);
    } catch (error) {
      cleanupErrors.push(error);
    }
    for (const schoolId of fixtureSchoolIds) {
      try {
        await db.transaction(async (tx) => {
          await tx.execute(sql`SELECT set_config('app.payment_history_cleanup', 'on', true)`);
          await tx.execute(sql`SELECT set_config('app.fee_audit_cleanup', 'on', true)`);
          await tx.delete(schools).where(eq(schools.id, schoolId));
        });
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    fixtureSchoolIds.clear();
    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, "Financial Analytics fixture cleanup failed");
    }
  }, 30_000);

  it("keeps every DB -> service -> API -> PDF range exactly reconciled", async () => {
    const auditRows: Array<Record<string, string | number>> = [];

    for (const range of ranges) {
      const period = auditPeriod(range, fixture.session);
      const expected = await independentLedger(
        fixture,
        range.preset,
        period.startDate,
        period.endDate,
      );
      const service = await buildFinancialAnalytics({
        schoolId: fixture.schoolId,
        sessionId: fixture.sessionId,
        preset: range.preset,
        customStart: range.customStart,
        customEnd: range.customEnd,
      });
      expect(service.filter.startDate, `${range.name}: independently resolved start`).toBe(period.startDate);
      expect(service.filter.endDate, `${range.name}: independently resolved end`).toBe(period.endDate);

      expect(service.summary, `${range.name}: DB -> service summary`).toEqual(expected.summary);
      expect(
        {
          grossCollected: service.online.grossCollected,
          refunds: service.online.refunds,
          netCollected: service.online.netCollected,
          transactionCount: service.online.transactionCount,
          averageTransaction: service.online.averageTransaction,
        },
        `${range.name}: online channel`,
      ).toEqual(expected.online);
      expect(
        {
          grossCollected: service.offline.grossCollected,
          refunds: service.offline.refunds,
          netCollected: service.offline.netCollected,
          transactionCount: service.offline.transactionCount,
          averageTransaction: service.offline.averageTransaction,
        },
        `${range.name}: offline channel`,
      ).toEqual(expected.offline);
      expect(service.classWise, `${range.name}: class attribution`).toEqual(expected.classWise);
      expect(service.feeCategories, `${range.name}: category attribution`).toEqual(expected.feeCategories);
      expect(service.aging, `${range.name}: aging`).toEqual(expected.aging);
      expect(service.cashDenominations, `${range.name}: denominations`).toEqual(expected.cashDenominations);

      for (const point of service.trend) {
        expect(
          {
            billed: point.billed,
            grossCollected: point.grossCollected,
            refunds: point.refunds,
            netCollected: point.netCollected,
          },
          `${range.name}: trend bucket ${point.key}`,
        ).toEqual(expected.trendByKey.get(point.key) ?? {
          billed: 0,
          grossCollected: 0,
          refunds: 0,
          netCollected: 0,
        });
      }
      expect(service.trend.reduce((sum, point) => sum + point.billed, 0)).toBe(expected.summary.billed);
      expect(service.trend.reduce((sum, point) => sum + point.grossCollected, 0)).toBe(expected.summary.grossCollected);
      expect(service.trend.reduce((sum, point) => sum + point.refunds, 0)).toBe(expected.summary.refunds);

      const query = new URLSearchParams({ preset: range.preset });
      if (range.customStart) query.set("startDate", range.customStart);
      if (range.customEnd) query.set("endDate", range.customEnd);
      const jsonResponse = await fetch(`${baseUrl}/api/fees/analytics?${query.toString()}`, {
        headers: { "x-view-session-id": String(fixture.sessionId) },
      });
      expect(jsonResponse.status, `${range.name}: API status`).toBe(200);
      const api = await jsonResponse.json() as FinancialAnalyticsResult;
      expect({ ...api, generatedAt: "" }, `${range.name}: service -> API`).toEqual({
        ...service,
        generatedAt: "",
      });

      const ledgerQuery = new URLSearchParams({
        paidDateFrom: period.startDate,
        paidDateTo: period.endDate,
      });
      const ledgerResponse = await fetch(
        `${baseUrl}/api/admin/fees/export-ledger?${ledgerQuery.toString()}`,
        { headers: { "x-view-session-id": String(fixture.sessionId) } },
      );
      expect(ledgerResponse.status, `${range.name}: Ledger CSV status`).toBe(200);
      const ledgerCsv = (await ledgerResponse.text()).replace(/^\uFEFF/, "");
      const ledgerLines = ledgerCsv.split(/\r?\n/).filter(Boolean);
      expect(ledgerLines[0], `${range.name}: Ledger CSV authority labels`).toContain(
        '"Invoice Amount (₹)"',
      );
      expect(ledgerLines[0], `${range.name}: Ledger CSV payment-date label`).toContain(
        '"Latest Payment On"',
      );
      const ledgerInvoiceNumbers = ledgerLines.slice(1).map((line) => {
        const firstCell = /^"((?:[^"]|"")*)",/.exec(line)?.[1];
        if (firstCell == null) throw new Error(`Could not parse Ledger CSV row: ${line}`);
        return firstCell.replace(/""/g, '"');
      }).sort();
      expect(
        ledgerInvoiceNumbers,
        `${range.name}: Analytics payment range -> Ledger invoice population`,
      ).toEqual(expected.paymentInvoiceNumbers);

      const tempDir = await mkdtemp(join(tmpdir(), "financial-analytics-reconcile-"));
      try {
        const sections = ["summary", "trend", "channels", "classes", "categories", "aging", "cash", "complete"] as const;
        for (const section of sections) {
          query.set("section", section);
          const pdfResponse = await fetch(`${baseUrl}/api/fees/analytics/pdf?${query.toString()}`, {
            headers: { "x-view-session-id": String(fixture.sessionId) },
          });
          expect(pdfResponse.status, `${range.name}/${section}: PDF status`).toBe(200);
          expect(pdfResponse.headers.get("content-type")).toContain("application/pdf");
          const pdfPath = join(tempDir, `${section}.pdf`);
          const textPath = join(tempDir, `${section}.txt`);
          await writeFile(pdfPath, Buffer.from(await pdfResponse.arrayBuffer()));
          await execFileAsync("pdftotext", ["-layout", pdfPath, textPath]);
          const pdfText = (await readFile(textPath, "utf8")).replace(/\s+/g, " ");
          expect(pdfText, `${range.name}/${section}: PDF identity`).toContain("Financial Analytics Reconciliation School");
          expect(pdfText, `${range.name}/${section}: PDF session`).toContain(fixture.session.sessionName);

          if (section === "summary" || section === "complete") {
            expect(pdfText).toMatch(/Executive Summary/i);
            assertPdfSequence(pdfText, `${range.name}/${section}: billed and gross`, [
              "Gross Billed", "Gross Collected", "₹", pdfAmount(expected.summary.billed), "₹", pdfAmount(expected.summary.grossCollected),
            ]);
            assertPdfSequence(pdfText, `${range.name}/${section}: net and refunds`, [
              "Net Collected (after refunds)", "Refunds", "₹", pdfAmount(expected.summary.netCollected), "₹", pdfAmount(expected.summary.refunds),
            ]);
            assertPdfSequence(pdfText, `${range.name}/${section}: outstanding and efficiency`, [
              "Outstanding", "Collection Efficiency", "₹", pdfAmount(expected.summary.outstanding), `${expected.summary.collectionEfficiency.toFixed(1)}%`,
            ]);
            assertPdfSequence(pdfText, `${range.name}/${section}: online and offline`, [
              "Online Collected", "Offline Collected", "₹", pdfAmount(expected.summary.onlineCollected), "₹", pdfAmount(expected.summary.offlineCollected),
            ]);
            assertPdfSequence(pdfText, `${range.name}/${section}: overdue and transactions`, [
              "Overdue Amount", "Transactions", "₹", pdfAmount(expected.summary.overdueAmount), expected.summary.transactionCount,
            ]);
          }

          if (section === "trend" || section === "complete") {
            expect(pdfText).toMatch(/Collection Trend/i);
            for (const point of service.trend.filter((row) =>
              row.billed !== 0 || row.grossCollected !== 0 || row.refunds !== 0 || row.netCollected !== 0
            )) {
              assertPdfSequence(pdfText, `${range.name}/${section}: trend ${point.key}`, [
                point.label, "₹", pdfAmount(point.billed), "₹", pdfAmount(point.grossCollected), "₹", pdfAmount(point.netCollected),
              ]);
            }
          }

          if (section === "channels" || section === "complete") {
            expect(pdfText).toMatch(/Online Channel/i);
            expect(pdfText).toMatch(/Offline Channel/i);
            assertPdfSequence(pdfText, `${range.name}/${section}: online channel values`, [
              "Online Channel", "Gross Collected", "Transactions", "₹", pdfAmount(service.online.grossCollected),
              service.online.transactionCount, "Refunds", "Net Collected", "₹", pdfAmount(service.online.refunds),
              "₹", pdfAmount(service.online.netCollected),
            ]);
            assertPdfSequence(pdfText, `${range.name}/${section}: offline channel values`, [
              "Offline Channel", "Gross Collected", "Transactions", "₹", pdfAmount(service.offline.grossCollected),
              service.offline.transactionCount, "Refunds", "Net Collected", "₹", pdfAmount(service.offline.refunds),
              "₹", pdfAmount(service.offline.netCollected),
            ]);
          }

          if (section === "classes" || section === "complete") {
            expect(pdfText).toMatch(/Class-Wise Breakdown/i);
            for (const row of expected.classWise) {
              assertPdfSequence(pdfText, `${range.name}/${section}: class ${row.class}`, [
                row.class, "₹", pdfAmount(row.billed), "₹", pdfAmount(row.grossCollected),
                "₹", pdfAmount(row.outstanding),
              ]);
            }
          }

          if (section === "categories" || section === "complete") {
            assertPdfSequence(pdfText, `${range.name}/${section}: category table headers`, [
              "Fee Type", "Billed", "Collected", "Refunds",
            ]);
            for (const row of expected.feeCategories) {
              assertPdfSequence(pdfText, `${range.name}/${section}: category ${row.feeType}`, [
                row.feeType, "₹", pdfAmount(row.billed), "₹", pdfAmount(row.grossCollected),
                "₹", pdfAmount(row.refunds),
              ]);
            }
          }

          if (section === "aging" || section === "complete") {
            assertPdfSequence(pdfText, `${range.name}/${section}: aging table headers`, [
              "Aging Bucket", "Invoices", "Outstanding",
            ]);
            const agingLabels: Record<string, string> = {
              "1-30": "1–30 Days",
              "31-60": "31–60 Days",
              "61-90": "61–90 Days",
              "90+": "90+ Days",
            };
            for (const row of expected.aging) {
              assertPdfSequence(pdfText, `${range.name}/${section}: aging ${row.bucket}`, [
                agingLabels[row.bucket], row.count, "₹", pdfAmount(row.amount),
              ]);
            }
          }

          if (section === "cash" || section === "complete") {
            assertPdfSequence(pdfText, `${range.name}/${section}: cash totals`, [
              "Cash Collected", "Cash Payments", "₹", pdfAmount(expected.cashDenominations.cashCollected),
              expected.cashDenominations.cashPaymentCount,
            ]);
            assertPdfSequence(pdfText, `${range.name}/${section}: cash coverage counts`, [
              "With Denomination Breakdown", "Without Breakdown",
              expected.cashDenominations.withBreakdownCount, expected.cashDenominations.withoutBreakdownCount,
            ]);
            for (const row of expected.cashDenominations.denominations) {
              assertPdfSequence(pdfText, `${range.name}/${section}: denomination ${row.denomination}`, [
                `₹${row.denomination}`, row.quantity, "₹", pdfAmount(row.total),
              ]);
            }
          }
        }
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }

      auditRows.push({
        range: range.name,
        dates: `${period.startDate}..${period.endDate}`,
        invoices: expected.sourceCounts.invoices,
        payments: expected.sourceCounts.payments,
        refunds: expected.sourceCounts.refunds,
        billed: expected.summary.billed,
        gross: expected.summary.grossCollected,
        refunded: expected.summary.refunds,
        net: expected.summary.netCollected,
        outstanding: expected.summary.outstanding,
      });
    }

    // Lifecycle attempts are visible as status information but must never change
    // the independently-derived payment_records revenue.
    const today = await buildFinancialAnalytics({
      schoolId: fixture.schoolId,
      sessionId: fixture.sessionId,
      preset: "today",
    });
    expect(Object.fromEntries(today.online.statuses.map((row) => [row.status, {
      count: row.count,
      amount: row.amount,
    }]))).toEqual({
      captured: { count: 1, amount: 12_000 },
      failed: { count: 1, amount: 6_000 },
      cancelled: { count: 1, amount: 7_000 },
      pending: { count: 1, amount: 8_000 },
      authorized: { count: 1, amount: 9_000 },
    });

    console.table(auditRows);
  }, 60_000);
});