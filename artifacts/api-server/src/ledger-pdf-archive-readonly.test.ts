import assert from "node:assert/strict";
import express from "express";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { db } from "./db";
import { registerFeesRoutes } from "./fees-routes";
import { checkSessionContext } from "./routes/routes";
import { storage } from "./storage";

test("archived Ledger PDF access stays read-only and the archive exception is exact", async (t) => {
  const dialect = new PgDialect();
  const replacements: Array<{ target: any; name: string; hadOwn: boolean; original: unknown }> = [];
  const replace = (target: any, name: string, implementation: (...args: any[]) => any) => {
    replacements.push({
      target,
      name,
      hadOwn: Object.prototype.hasOwnProperty.call(target, name),
      original: target[name],
    });
    target[name] = implementation;
  };
  const databaseQueries: Array<{ sql: string; params: unknown[] }> = [];

  replace(storage, "getAcademicSessionById", async (id: number) => {
    if (id === 41) return { id: 41, schoolId: 11, isActive: false };
    if (id === 88) return { id: 88, schoolId: 12, isActive: true };
    return undefined;
  });
  replace(db as any, "execute", async (statement: any) => {
    const query = dialect.sqlToQuery(statement);
    databaseQueries.push(query);
    if (query.sql.includes("FROM schools")) {
      return { rows: [{ name: "Synthetic School", logo_url: null }] };
    }
    if (query.sql.includes("FROM academic_sessions")) {
      return { rows: [{ session_name: "Archived 2026-2027" }] };
    }
    if (query.sql.includes("FROM fee_records fr")) {
      const ledgerRow = {
        invoice_number: "INV-101",
        receipt_number: "REC-101",
        student_name: "Synthetic Student",
        student_id: "S-101",
        class: "5",
        section: "A",
        fee_name: "Tuition",
        fee_type: "Tuition",
        frequency: "Monthly",
        invoice_amount: 1000,
        amount_paid: 200,
        outstanding: 800,
        status: "Partial",
        due_date: "2026-10-31",
        paid_date: "2026-10-10",
        academic_year: "2026-2027",
        payment_method: "Cash",
        reference_number: "REF-101",
        notes: null,
        fee_period_start: "2026-10-01",
        fee_period_end: "2026-10-31",
      };
      return {
        rows: [
          query.sql.includes("ledger_selection_id")
            ? { ledger_selection_id: 101, ...ledgerRow }
            : ledgerRow,
        ],
      };
    }
    throw new Error(`Unexpected read query in the mocked route test: ${query.sql}`);
  });

  t.after(() => {
    for (const replacement of replacements.reverse()) {
      if (replacement.hadOwn) replacement.target[replacement.name] = replacement.original;
      else delete replacement.target[replacement.name];
    }
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const role = req.get("x-test-role") ?? "admin";
    (req as any).session = role === "anonymous"
      ? {}
      : { userId: 70, userRole: role, schoolId: 11 };
    next();
  });
  app.use(checkSessionContext);
  registerFeesRoutes(app);

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  t.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  });

  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  async function request(
    path: string,
    options: { method?: string; viewSessionId?: number; role?: string; body?: unknown } = {},
  ) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        ...(options.viewSessionId === undefined
          ? {}
          : { "x-view-session-id": String(options.viewSessionId) }),
        ...(options.role ? { "x-test-role": options.role } : {}),
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const text = await response.text();
    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      text,
      body: response.headers.get("content-type")?.includes("application/json") && text
        ? JSON.parse(text) as any
        : null,
    };
  }

  const archivedPost = await request("/api/admin/fees/ledger/pdf", {
    method: "POST",
    viewSessionId: 41,
    body: { selectedIds: [] },
  });
  assert.equal(archivedPost.status, 400, "the actual route validates the request after the archive guard");
  assert.match(archivedPost.body.message, /at least one selected invoice/i);

  const validArchivedPost = await request("/api/admin/fees/ledger/pdf", {
    method: "POST",
    viewSessionId: 41,
    body: { selectedIds: [101], excludedIds: [] },
  });
  assert.equal(validArchivedPost.status, 200);
  assert.equal(validArchivedPost.contentType, "application/pdf");
  assert.ok(validArchivedPost.text.startsWith("%PDF-"));
  const ledgerQuery = databaseQueries.find(query => query.sql.includes("ledger_selection_id"));
  assert.ok(ledgerQuery, "the valid selection must query the existing Ledger PDF population");
  assert.match(ledgerQuery.sql.replace(/\s+/g, " "), /fr\.school_id = \$\d+ AND fr\.session_id = \$\d+/);
  assert.ok(ledgerQuery.params.includes(11));
  assert.ok(ledgerQuery.params.includes(41));
  assert.ok(
    ledgerQuery.params.some(value => Array.isArray(value) && value.length === 1 && value[0] === 101),
    "the requested invoice remains part of the scoped selection",
  );

  const archivedGet = await request("/api/admin/fees/ledger/pdf", { viewSessionId: 41 });
  assert.equal(archivedGet.status, 200, "the actual archived-session GET handler remains permitted");
  assert.equal(archivedGet.contentType, "application/pdf");
  assert.ok(archivedGet.text.startsWith("%PDF-"));

  const foreignSchool = await request("/api/admin/fees/ledger/pdf", {
    method: "POST",
    viewSessionId: 88,
    body: { selectedIds: [] },
  });
  assert.equal(foreignSchool.status, 404, "the route's authenticated-school check still rejects a foreign session");

  const unauthenticated = await request("/api/admin/fees/ledger/pdf", {
    method: "POST",
    viewSessionId: 41,
    role: "anonymous",
    body: { selectedIds: [] },
  });
  assert.equal(unauthenticated.status, 403, "the endpoint's authorization guard remains in place");
  assert.match(unauthenticated.body.message, /Fees & Payments access required/);

  const unauthorizedStaff = await request("/api/admin/fees/ledger/pdf", {
    method: "POST",
    viewSessionId: 41,
    role: "support_staff",
    body: { selectedIds: [101] },
  });
  assert.equal(unauthorizedStaff.status, 403, "staff without a ledger grant cannot use the exception");

  for (const [method, path] of [
    ["POST", "/api/admin/fees/structures/3/generate-invoices"],
    ["POST", "/api/admin/fees/payments"],
    ["POST", "/api/admin/fees/payments/7/refunds"],
    ["POST", "/api/admin/fees/ledger/pdf-extra"],
    ["POST", "/api/admin/fees/ledger/pdf/"],
    ["PUT", "/api/admin/fees/ledger/pdf"],
  ]) {
    const denied = await request(path, { method, viewSessionId: 41, body: {} });
    assert.equal(denied.status, 403, `${method} ${path} remains blocked for an archived session`);
    assert.equal(denied.body.code, "ARCHIVE_READ_ONLY");
  }

  assert.ok(databaseQueries.every(query => query.sql.trimStart().startsWith("SELECT")));
  assert.equal(databaseQueries.length, 6, "both PDF methods use only their three expected read queries");
});
