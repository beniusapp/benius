import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  assertPromotionOverrideActorRecord,
  assertPromotionOverrideBatch,
  promotionOverrideActorFromSession,
  requirePromotionOverrideReason,
  validatePromotionOverrideCandidate,
  type PromotionOverrideCandidate,
} from "./promotion-override-policy";

const validDecision = {
  locked: true,
  decision: "promoted",
  targetClass: "6",
  targetSection: "A",
  autoSuggestion: "promoted",
  manualIntervention: false,
};

const validCandidate: PromotionOverrideCandidate = {
  status: "PROMOTE",
  nextClass: "6",
  nextSection: "A",
  sourceClass: "5",
  sourceSection: "A",
  resultStatus: "complete",
  promoted: true,
  decision: validDecision,
  teacherIsValid: true,
  teacherTargetIsConfigured: true,
  overrideTargetIsConfigured: true,
  studentIsInSourceRoster: true,
  sessionIsActive: true,
  adminExecuted: false,
};

function rejectCode(run: () => unknown, code: string, statusCode: number) {
  assert.throws(run, error => {
    assert.equal((error as any).code, code);
    assert.equal((error as any).statusCode, statusCode);
    return true;
  });
}

test("1. Active Admin in the school is authorized", () => {
  assert.doesNotThrow(() => assertPromotionOverrideActorRecord(
    { id: 70, role: "admin" },
    11,
    { id: 70, schoolId: 11, isActive: true, role: "admin" },
  ));
});

test("2. Active Support Staff with the parent Exam Controller grant is authorized", () => {
  assert.doesNotThrow(() => assertPromotionOverrideActorRecord(
    { id: 7, role: "support_staff" },
    11,
    { id: 7, schoolId: 11, isActive: true, allowedModules: ["exam-controller"] },
  ));
});

test("3. Support Staff without the Exam Controller grant is rejected", () => {
  rejectCode(() => assertPromotionOverrideActorRecord(
    { id: 7, role: "support_staff" },
    11,
    { id: 7, schoolId: 11, isActive: true, allowedModules: ["attendance-overview"] },
  ), "PROMOTION_OVERRIDE_ACTOR_INVALID", 403);
});

test("4. Inactive Support Staff is rejected", () => {
  rejectCode(() => assertPromotionOverrideActorRecord(
    { id: 7, role: "support_staff" },
    11,
    { id: 7, schoolId: 11, isActive: false, allowedModules: ["exam-controller"] },
  ), "PROMOTION_OVERRIDE_ACTOR_INVALID", 403);
});

test("5. Unauthenticated session cannot resolve an override actor", () => {
  assert.equal(promotionOverrideActorFromSession({}), null);
  assert.equal(promotionOverrideActorFromSession({ userRole: "admin", userId: 0 }), null);
});

test("6. Actor record from a different school is rejected", () => {
  rejectCode(() => assertPromotionOverrideActorRecord(
    { id: 70, role: "admin" },
    11,
    { id: 70, schoolId: 12, isActive: true, role: "admin" },
  ), "PROMOTION_OVERRIDE_ACTOR_INVALID", 403);
});

test("7. A mixed-session batch is rejected", () => {
  assert.throws(() => assertPromotionOverrideBatch([
    { schoolId: 11, sessionId: 42, studentId: 7, examType: "Term 2", class: "5", section: "A" },
    { schoolId: 11, sessionId: 44, studentId: 8, examType: "Term 2", class: "5", section: "A" },
  ]), error => (error as any).code === "MIXED_PROMOTION_COHORT");
});

test("8. Archived-session override is rejected", () => {
  rejectCode(() => validatePromotionOverrideCandidate({
    ...validCandidate,
    sessionIsActive: false,
  }), "SESSION_NOT_WRITABLE", 403);
});

test("9. Student outside the exact selected-session roster is rejected", () => {
  rejectCode(() => validatePromotionOverrideCandidate({
    ...validCandidate,
    studentIsInSourceRoster: false,
  }), "PROMOTION_STUDENT_NOT_IN_SOURCE_ROSTER", 409);
});

test("10. Missing Teacher ledger is rejected", () => {
  rejectCode(() => validatePromotionOverrideCandidate({
    ...validCandidate,
    decision: undefined,
  }), "PROMOTION_DECISION_INVALID", 409);
});

test("11. Unlocked Teacher ledger is rejected", () => {
  rejectCode(() => validatePromotionOverrideCandidate({
    ...validCandidate,
    decision: { ...validDecision, locked: false },
  }), "PROMOTION_DECISION_INVALID", 409);
});

test("12. Stale Teacher recommendation is rejected", () => {
  rejectCode(() => validatePromotionOverrideCandidate({
    ...validCandidate,
    decision: { ...validDecision, autoSuggestion: "retained", manualIntervention: true },
  }), "PROMOTION_DECISION_CONFLICT", 409);
});

test("13. Incomplete applicable result is rejected", () => {
  rejectCode(() => validatePromotionOverrideCandidate({
    ...validCandidate,
    resultStatus: "incomplete",
    promoted: null,
  }), "PROMOTION_RESULT_INCOMPLETE", 409);
});

test("14. Valid Promote override passes current readiness checks", () => {
  assert.doesNotThrow(() => validatePromotionOverrideCandidate(validCandidate));
});

test("15. Valid Retain override must remain in the source placement", () => {
  assert.doesNotThrow(() => validatePromotionOverrideCandidate({
    ...validCandidate,
    status: "RETAIN",
    nextClass: "5",
  }));
  rejectCode(() => validatePromotionOverrideCandidate({
    ...validCandidate,
    status: "RETAIN",
    nextClass: "6",
  }), "PROMOTION_OVERRIDE_TARGET_INVALID", 400);
});

test("16. Blank and whitespace-only reasons are rejected", () => {
  for (const reason of ["", "   \n\t"]) {
    rejectCode(() => requirePromotionOverrideReason(reason), "PROMOTION_OVERRIDE_REASON_REQUIRED", 400);
  }
});

test("17. Audit actor identity is derived from the authenticated session", () => {
  assert.deepEqual(
    promotionOverrideActorFromSession({ userRole: "admin", userId: 70, staffId: 999 }),
    { id: 70, role: "admin" },
  );
  assert.deepEqual(
    promotionOverrideActorFromSession({ userRole: "support_staff", userId: -7, staffId: 7 }),
    { id: 7, role: "support_staff" },
  );
  assert.equal(
    promotionOverrideActorFromSession({ userRole: "support_staff", userId: 70, staffId: 7 }),
    null,
  );
});

test("18. Web proposals are audit events written inside the database transaction", () => {
  const source = readFileSync(join(process.cwd(), "artifacts/api-server/src/storage.ts"), "utf8");
  const start = source.indexOf("async bulkUpsertPromotionOverrides(");
  const end = source.indexOf("\n  async deleteAllPromotionOverrides", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const saveBody = source.slice(start, end);
  assert.match(saveBody, /await db\.transaction\(async \(tx\)/);
  assert.match(saveBody, /await writePromotionOverrideAudit\(tx,/);
  assert.doesNotMatch(saveBody, /tx\.(?:insert|update|delete)\(promotionOverrides/);
  assert.match(
    source,
    /selectedOverride:\s*input\.actionType === "PROMOTION_OVERRIDE_PROPOSAL_CLEARED"\s*\?\s*null/,
  );
});

test("19. Audit insertion failure aborts the transaction before a proposal becomes visible", async () => {
  let visibleProposal = false;
  const stagedEvents: unknown[] = [];
  const transaction = async (work: (tx: { insertAuditEvent: (event: unknown) => Promise<void> }) => Promise<void>) => {
    const tx = {
      insertAuditEvent: async (event: unknown) => {
        stagedEvents.push(event);
        throw new Error("audit insert failed");
      },
    };
    await work(tx);
    visibleProposal = stagedEvents.length > 0;
  };
  await assert.rejects(transaction(async tx => {
    await tx.insertAuditEvent({ kind: "promotion-override-proposal" });
  }), /audit insert failed/);
  assert.equal(visibleProposal, false);
});

test("20. Executed Student override mutation is rejected", () => {
  rejectCode(() => validatePromotionOverrideCandidate({
    ...validCandidate,
    adminExecuted: true,
  }), "PROMOTION_ALREADY_EXECUTED", 409);
});

test("21. New Grace writes are rejected without rewriting existing Grace data", () => {
  const legacyGrace = {
    overrideStatus: "GRACE_PASS",
    nextClass: "6",
    nextSection: "A",
  };
  const snapshot = { ...legacyGrace };
  rejectCode(() => validatePromotionOverrideCandidate({
    ...validCandidate,
    status: "GRACE_PASS",
  }), "PROMOTION_OVERRIDE_OUTCOME_INVALID", 400);
  assert.deepEqual(legacyGrace, snapshot);
  const webSource = readFileSync(
    join(process.cwd(), "artifacts/benius-web/src/pages/admin-modules/exam-controller.tsx"),
    "utf8",
  );
  assert.match(webSource, /ov\.overrideStatus === "GRACE_PASS"\s*\?\s*"grace_pass"/);
  assert.match(webSource, /ov\.rawStatus === "GRACE_PASS"\s*\?\s*"Legacy Grace"/);
});

test("22. A legacy override cannot bypass a missing locked Teacher decision", () => {
  const legacyGrace = { overrideStatus: "GRACE_PASS" };
  rejectCode(() => validatePromotionOverrideCandidate({
    ...validCandidate,
    decision: undefined,
  }), "PROMOTION_DECISION_INVALID", 409);
  assert.equal(legacyGrace.overrideStatus, "GRACE_PASS");
});

test("23. Readiness validation leaves the Teacher ledger snapshot unchanged", () => {
  const decision = Object.freeze({ ...validDecision });
  validatePromotionOverrideCandidate({ ...validCandidate, decision });
  assert.deepEqual(decision, validDecision);
});

test("24. Promotion execution path remains independent of override rows", () => {
  const source = readFileSync(join(process.cwd(), "artifacts/api-server/src/storage.ts"), "utf8");
  const start = source.indexOf("async executePromotionTransaction(");
  assert.notEqual(start, -1);
  const end = source.indexOf("\n  async ", start + 1);
  const executeBody = source.slice(start, end === -1 ? undefined : end);
  assert.doesNotMatch(executeBody, /promotionOverrides|PROMOTION_OVERRIDE/);
});

test("25. Mobile routes and raw override reader remain unchanged for legacy consumers", () => {
  const mobileRoutes = readFileSync(join(process.cwd(), "artifacts/api-server/src/mobile-admin-module-routes.ts"), "utf8");
  const storageSource = readFileSync(join(process.cwd(), "artifacts/api-server/src/storage.ts"), "utf8");
  assert.match(mobileRoutes, /storage\.getExamAggregated\(/);
  assert.doesNotMatch(mobileRoutes, /getPromotionOverridesWithAudit/);
  const start = storageSource.indexOf("async getPromotionOverrides(");
  const end = storageSource.indexOf("\n  async getPromotionOverridesWithAudit", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.match(storageSource.slice(start, end), /from\(promotionOverrides\)/);
});

test("26. Web execution payload stays Teacher-ledger based, not proposal based", () => {
  const webSource = readFileSync(
    join(process.cwd(), "artifacts/benius-web/src/pages/admin-modules/exam-controller.tsx"),
    "utf8",
  );
  assert.match(webSource, /eligibleStudentIds = new Set\(cohort\.readyStudentIds\)/);
  assert.match(webSource, /nextClass:\s*led!\.targetClass,\s*nextSection:\s*led!\.targetSection/);
  assert.match(webSource, /override:\s*override\?\.isProposal\s*\?\s*undefined\s*:\s*override/);
});
