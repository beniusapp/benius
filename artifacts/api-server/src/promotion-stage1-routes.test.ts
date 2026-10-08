import assert from "node:assert/strict";
import express from "express";
import test from "node:test";
import { checkSessionContext } from "./routes/routes";
import { storage } from "./storage";
import { registerTeacherRoutes } from "./teacher-routes";

test("Web Promotion routes require and preserve the selected school session", async (t) => {
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

  const sessions = new Map<number, { id: number; schoolId: number; isActive: boolean }>([
    [41, { id: 41, schoolId: 11, isActive: false }],
    [42, { id: 42, schoolId: 11, isActive: true }],
    [88, { id: 88, schoolId: 12, isActive: true }],
  ]);
  const ledgerReads: Array<[number, string, number | undefined]> = [];
  const ledgerReadinessReads: Array<[number, string, number | undefined]> = [];
  const decisionReads: Array<[number, string, string, string, number | undefined]> = [];
  const aggregateReads: Array<[number, string, string, string, number | undefined]> = [];
  const deletionCalls: Array<[number, number, string]> = [];
  const executions: Array<{
    schoolId: number;
    sessionId: number;
    targetSessionId: number;
    actor: { id: number; role: "admin" | "support_staff" };
  }> = [];
  const auditRows: any[] = [];
  const overrideReads: unknown[][] = [];
  const overrideWrites: Array<{ kind: string; data: any }> = [];
  let resolveAudit!: () => void;
  const auditComplete = new Promise<void>(resolve => { resolveAudit = resolve; });

  replace(storage, "getAcademicSessionById", async (id: number) => sessions.get(id));
  replace(storage, "getAcademicSessionForSchool", async (id: number, schoolId: number) => {
    const session = sessions.get(id);
    return session?.schoolId === schoolId ? session : undefined;
  });
  replace(storage, "getLedgerStatus", async (schoolId: number, term: string, sessionId?: number) => {
    ledgerReads.push([schoolId, term, sessionId]);
    return [];
  });
  replace(storage, "getPromotionLedgerReadinessStatus", async (
    schoolId: number,
    term: string,
    sessionId: number,
  ) => {
    ledgerReadinessReads.push([schoolId, term, sessionId]);
    return [];
  });
  replace(storage, "deletePromotionDecisionsByTerm", async (
    schoolId: number,
    sessionId: number,
    term: string,
  ) => {
    deletionCalls.push([schoolId, sessionId, term]);
    return 1;
  });
  replace(storage, "getPromotionDecisions", async (
    schoolId: number,
    cls: string,
    section: string,
    term: string,
    sessionId?: number,
  ) => {
    decisionReads.push([schoolId, cls, section, term, sessionId]);
    return [];
  });
  replace(storage, "getExamAggregated", async (
    schoolId: number,
    cls: string,
    section: string,
    examType: string,
    sessionId?: number,
  ) => {
    aggregateReads.push([schoolId, cls, section, examType, sessionId]);
    return [];
  });
  replace(storage, "getPromotionCohortEvaluation", async (
    schoolId: number,
    sessionId: number,
    cls: string,
    section: string,
    term: string,
  ) => {
    aggregateReads.push([schoolId, cls, section, term, sessionId]);
    return {
      components: [{ sourceExam: term }],
      scoreRows: [],
      gradingRules: [],
      gradingTier: { passPercentage: 35 },
      rosterRows: [],
      resultsByStudent: new Map(),
    } as any;
  });
  replace(storage, "getPromotionOverrides", async (...args: any[]) => {
    overrideReads.push(args);
    return [];
  });
  replace(storage, "getAllSchoolMetadata", async () => ({
    classes: ["5", "6"],
    sections: ["A"],
    subjects: ["Mathematics"],
    exam_types: ["Term 2"],
  }));
  replace(storage, "getClassSubjectsMap", async () => ({ "5": ["Mathematics"] }));
  replace(storage, "resolveClassPassPolicy", async () => ({ passPercentage: 35 }));
  replace(storage, "executePromotionTransaction", async (
    schoolId: number,
    sessionId: number,
    targetSessionId: number,
    _items: unknown[],
    _term: string,
    actor: { id: number; role: "admin" | "support_staff" },
  ) => {
    executions.push({ schoolId, sessionId, targetSessionId, actor });
    return {
      prepared: 1,
      targetEnrollmentsCreated: 1,
      targetSessionId,
      targetSessionName: "2027–2028",
      students: [{
        studentId: 7,
        dsid: "B-007",
        name: "Student One",
        fromClass: "5",
        fromSection: "A",
      }],
    };
  });
  replace(storage, "createAuditLog", async (data: unknown) => {
    auditRows.push(data);
    resolveAudit();
  });
  replace(storage, "upsertPromotionOverride", async (data: any) => {
    overrideWrites.push({ kind: "single-save", data });
  });
  replace(storage, "bulkUpsertPromotionOverrides", async (data: any) => {
    overrideWrites.push({ kind: "bulk-save", data });
  });
  replace(storage, "deletePromotionOverride", async (data: any) => {
    overrideWrites.push({ kind: "single-delete", data });
  });
  replace(storage, "deleteAllPromotionOverrides", async (data: any) => {
    overrideWrites.push({ kind: "cohort-delete", data });
  });

  t.after(() => {
    for (const { target, name, hadOwn, original } of replacements.reverse()) {
      if (hadOwn) target[name] = original;
      else delete target[name];
    }
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const role = req.get("x-test-role") ?? "support_staff";
    const schoolId = Number(req.get("x-test-school") ?? 11);
    const allowedModules = (req.get("x-test-grants") ?? "").split(",").filter(Boolean);
    (req as any).session = role === "admin"
      ? { userId: 70, userRole: "admin", schoolId, allowedModules }
      : { userId: -7, staffId: 7, userRole: "support_staff", schoolId, allowedModules };
    next();
  });
  app.use(checkSessionContext);
  registerTeacherRoutes(app);

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
    options: {
      method?: string;
      body?: unknown;
      viewSessionId?: number | string;
      grants?: string[];
      role?: "admin" | "support_staff";
      schoolId?: number;
    } = {},
  ) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
        ...(options.viewSessionId === undefined
          ? {}
          : { "x-view-session-id": String(options.viewSessionId) }),
        ...(options.grants ? { "x-test-grants": options.grants.join(",") } : {}),
        ...(options.role ? { "x-test-role": options.role } : {}),
        ...(options.schoolId ? { "x-test-school": String(options.schoolId) } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) as any : null };
  }

  const examGrant = ["exam-controller"];
  const missingSession = await request("/api/admin/ledger-status?term=Term%202", {
    grants: examGrant,
  });
  assert.equal(missingSession.status, 400);
  assert.equal(missingSession.body.code, "SESSION_REQUIRED");

  const malformedSession = await request("/api/admin/ledger-status?term=Term%202", {
    grants: examGrant,
    viewSessionId: "42abc",
  });
  assert.equal(malformedSession.status, 400);
  assert.equal(malformedSession.body.code, "SESSION_REQUIRED");

  const foreignSession = await request("/api/admin/ledger-status?term=Term%202", {
    grants: examGrant,
    viewSessionId: 88,
  });
  assert.equal(foreignSession.status, 403);
  assert.equal(foreignSession.body.code, "SESSION_NOT_ACCESSIBLE");

  assert.equal((await request("/api/admin/ledger-status?term=Term%202", {
    grants: examGrant,
    viewSessionId: 41,
  })).status, 200, "archived-session reads remain available");
  assert.deepEqual(ledgerReadinessReads, [[11, "Term 2", 41]]);

  const archivedAggregate = await request(
    "/api/admin/exam/aggregated?class=5&section=A&examType=Term%202&term=Term%202",
    { grants: examGrant, viewSessionId: 41 },
  );
  assert.equal(archivedAggregate.status, 200);
  assert.deepEqual(aggregateReads, [[11, "5", "A", "Term 2", 41]]);
  assert.deepEqual(decisionReads.at(-1), [11, "5", "A", "Term 2", 41]);
  assert.deepEqual(archivedAggregate.body.overrides, []);
  assert.equal(archivedAggregate.body.overrideSessionIsolation, "SESSION_AWARE");
  assert.deepEqual(overrideReads, [[11, 41, "5", "A", "Term 2"]]);

  const analyticsWithoutSession = await request(
    "/api/admin/analytics/promotion-decisions/5/A/Term%202",
    { grants: ["analytics"] },
  );
  assert.equal(analyticsWithoutSession.status, 400);
  const analyticsRead = await request(
    "/api/admin/analytics/promotion-decisions/5/A/Term%202",
    { grants: ["analytics"], viewSessionId: 41 },
  );
  assert.equal(analyticsRead.status, 200);
  assert.deepEqual(decisionReads.at(-1), [11, "5", "A", "Term 2", 41]);

  assert.equal((await request("/api/admin/ledger-term/Term%202", {
    method: "DELETE",
    grants: examGrant,
  })).status, 400, "ledger deletion requires an explicit source session");
  const archivedDelete = await request("/api/admin/ledger-term/Term%202", {
    method: "DELETE",
    grants: examGrant,
    viewSessionId: 41,
  });
  assert.equal(archivedDelete.status, 403);
  assert.equal(archivedDelete.body.code, "ARCHIVE_READ_ONLY");
  assert.deepEqual(deletionCalls, []);

  const promotionItem = {
    studentId: 7,
    fromClass: "5",
    fromSection: "A",
    nextClass: "6",
    nextSection: "A",
    examType: "Term 2",
    totalObtained: 480,
    totalMax: 600,
    percentage: 80,
  };
  const missingPromotionSession = await request("/api/admin/promote", {
    method: "POST",
    grants: examGrant,
    body: { term: "Term 2", items: [promotionItem] },
  });
  assert.equal(missingPromotionSession.status, 400);
  assert.equal(missingPromotionSession.body.code, "SESSION_REQUIRED");
  assert.equal(executions.length, 0);

  const archivedPromotion = await request("/api/admin/promote", {
    method: "POST",
    grants: examGrant,
    viewSessionId: 41,
    body: { term: "Term 2", items: [promotionItem] },
  });
  assert.equal(archivedPromotion.status, 403);
  assert.equal(archivedPromotion.body.code, "ARCHIVE_READ_ONLY");
  assert.equal(executions.length, 0);

  const foreignPromotion = await request("/api/admin/promote", {
    method: "POST",
    grants: examGrant,
    viewSessionId: 88,
    body: { term: "Term 2", items: [promotionItem] },
  });
  assert.equal(foreignPromotion.status, 403);
  assert.equal(executions.length, 0);

  const missingTargetPromotion = await request("/api/admin/promote", {
    method: "POST",
    grants: examGrant,
    viewSessionId: 42,
    body: { term: "Term 2", items: [promotionItem] },
  });
  assert.equal(missingTargetPromotion.status, 400);
  assert.equal(missingTargetPromotion.body.code, "TARGET_SESSION_REQUIRED");
  assert.equal(executions.length, 0);

  const invalidTargetPromotion = await request("/api/admin/promote", {
    method: "POST",
    grants: examGrant,
    viewSessionId: 42,
    body: { term: "Term 2", targetSessionId: "44", items: [promotionItem] },
  });
  assert.equal(invalidTargetPromotion.status, 400);
  assert.equal(invalidTargetPromotion.body.code, "TARGET_SESSION_INVALID");
  assert.equal(executions.length, 0);

  const duplicatePromotion = await request("/api/admin/promote", {
    method: "POST",
    grants: examGrant,
    viewSessionId: 42,
    body: { term: "Term 2", targetSessionId: 44, items: [promotionItem, promotionItem] },
  });
  assert.equal(duplicatePromotion.status, 400);
  assert.equal(duplicatePromotion.body.code, "DUPLICATE_STUDENT");
  assert.equal(executions.length, 0);

  const promoted = await request("/api/admin/promote", {
    method: "POST",
    grants: examGrant,
    viewSessionId: 42,
    body: { term: "Term 2", targetSessionId: 44, items: [promotionItem] },
  });
  assert.equal(promoted.status, 200);
  assert.equal(promoted.body.prepared, 1);
  assert.equal(promoted.body.targetSessionId, 44);
  assert.equal(promoted.body.targetSessionName, "2027–2028");
  assert.deepEqual(executions, [{
    schoolId: 11,
    sessionId: 42,
    targetSessionId: 44,
    actor: { id: 7, role: "support_staff" },
  }]);
  await auditComplete;
  assert.equal(auditRows[0].sessionId, 42);
  assert.equal(auditRows[0].actionBy, 7);
  assert.equal(auditRows[0].actionByRole, "support_staff");
  assert.match(auditRows[0].details, /Support Staff 7/);
  assert.match(auditRows[0].details, /Academic Session 2027–2028 \(ID 44\)/);
  assert.match(auditRows[0].details, /Student Registry and source enrollment were not changed/);

  const overrideRequests = [
    ["POST", "/api/admin/exam/override", {
      studentId: 7, examType: "Term 2", class: "5", section: "A",
      overrideStatus: "PASS", nextClass: "6", nextSection: "A",
    }, "single-save"],
    ["POST", "/api/admin/exam/override/bulk", {
      items: [
        { studentId: 7, examType: "Term 2", class: "5", section: "A", overrideStatus: "PASS", nextClass: "6", nextSection: "A" },
        { studentId: 8, examType: "Term 2", class: "5", section: "A", overrideStatus: "REPEAT", nextClass: "5", nextSection: "A" },
      ],
    }, "bulk-save"],
    ["DELETE", "/api/admin/exam/override", {
      studentId: 7, examType: "Term 2", class: "5", section: "A",
    }, "single-delete"],
    ["DELETE", "/api/admin/exam/override/cohort", {
      class: "5", section: "A", examType: "Term 2",
    }, "cohort-delete"],
  ] as const;
  for (const [method, path, body] of overrideRequests) {
    const missing = await request(path, { method, body, grants: examGrant });
    assert.equal(missing.status, 400);
    assert.equal(missing.body.code, "SESSION_REQUIRED");

    const archived = await request(path, {
      method,
      body,
      grants: examGrant,
      viewSessionId: 41,
    });
    assert.equal(archived.status, 403);
    assert.equal(archived.body.code, "ARCHIVE_READ_ONLY");

    const foreign = await request(path, {
      method,
      body,
      grants: examGrant,
      viewSessionId: 88,
    });
    assert.equal(foreign.status, 403);

    const saved = await request(path, {
      method,
      body,
      grants: examGrant,
      viewSessionId: 42,
    });
    assert.equal(saved.status, 200);
  }
  assert.deepEqual(overrideWrites.map(write => write.kind), [
    "single-save",
    "bulk-save",
    "single-delete",
    "cohort-delete",
  ]);
  assert.equal(overrideWrites[0].data.sessionId, 42);
  assert.equal(overrideWrites[0].data.schoolId, 11);
  assert.equal(overrideWrites[1].data.length, 2);
  assert.ok(overrideWrites[1].data.every((item: any) => item.sessionId === 42 && item.schoolId === 11));
  assert.equal(overrideWrites[2].data.sessionId, 42);
  assert.equal(overrideWrites[3].data.sessionId, 42);

  const scopedDelete = await request("/api/admin/ledger-term/Term%202", {
    method: "DELETE",
    grants: examGrant,
    viewSessionId: 42,
  });
  assert.equal(scopedDelete.status, 200);
  assert.deepEqual(deletionCalls, [[11, 42, "Term 2"]]);
});
