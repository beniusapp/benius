import assert from "node:assert/strict";
import test from "node:test";
import {
  FEES_AREAS,
  feesAreaGuard,
  feesAreasForRequest,
  feesRequestGuard,
  hasFeesAreaPermission,
} from "./fees-permissions";

test("maps the five Fees routes to their access areas", () => {
  assert.deepEqual(feesAreasForRequest("GET", "/api/fees/analytics"), [FEES_AREAS.FINANCIAL_ANALYTICS]);
  assert.deepEqual(feesAreasForRequest("GET", "/api/admin/fees/structures"), [FEES_AREAS.FEE_STRUCTURES]);
  assert.deepEqual(feesAreasForRequest("POST", "/api/admin/fees/payments"), [FEES_AREAS.LEDGER_TRANSACTIONS]);
  assert.deepEqual(feesAreasForRequest("PUT", "/api/admin/fees/dunning-templates"), [FEES_AREAS.REMINDERS]);
  assert.deepEqual(feesAreasForRequest("GET", "/api/admin/fees/audit-log"), [FEES_AREAS.AUDIT_LOG]);
});

test("the complete legacy Fees grant trio maps to Ledger & Transactions only", () => {
  const legacy = ["fees-manager", "fees-manager:view", "fees-manager:record", "fees-manager:export"];
  assert.equal(hasFeesAreaPermission(legacy, FEES_AREAS.LEDGER_TRANSACTIONS), true);
  assert.equal(hasFeesAreaPermission(legacy, FEES_AREAS.FINANCIAL_ANALYTICS), false);
  assert.equal(hasFeesAreaPermission(legacy, FEES_AREAS.FEE_STRUCTURES), false);
  assert.equal(hasFeesAreaPermission(legacy, FEES_AREAS.REMINDERS), false);
  assert.equal(hasFeesAreaPermission(legacy, FEES_AREAS.AUDIT_LOG), false);
});

test("parent-only legacy access stays Ledger-only and partial legacy grants do not expand", () => {
  assert.equal(hasFeesAreaPermission(["fees-manager"], FEES_AREAS.LEDGER_TRANSACTIONS), true);
  assert.equal(hasFeesAreaPermission(["fees-manager", "fees-manager:view"], FEES_AREAS.LEDGER_TRANSACTIONS), false);
});

test("Support Staff must have a valid session identity and the matching Fees area", () => {
  const makeResponse = () => {
    const result: { statusCode: number; body: unknown } = { statusCode: 200, body: null };
    return {
      result,
      response: {
        status(code: number) {
          result.statusCode = code;
          return this;
        },
        json(body: unknown) {
          result.body = body;
          return this;
        },
      },
    };
  };
  const supportSession = {
    userId: -14,
    staffId: 14,
    schoolId: 8,
    userRole: "support_staff",
    allowedModules: ["fees-manager", "fees-manager:ledger-transactions"],
  };
  const allowedResponse = makeResponse();
  assert.equal(feesRequestGuard({
    method: "GET",
    path: "/api/admin/fees/summary",
    session: supportSession,
  }, allowedResponse.response), true);

  const deniedResponse = makeResponse();
  assert.equal(feesRequestGuard({
    method: "GET",
    path: "/api/admin/fees/dunning-counts",
    session: supportSession,
  }, deniedResponse.response), false);
  assert.equal(deniedResponse.result.statusCode, 403);

  const invalidIdentityResponse = makeResponse();
  assert.equal(feesAreaGuard({
    session: { ...supportSession, userId: -99 },
  }, invalidIdentityResponse.response, FEES_AREAS.LEDGER_TRANSACTIONS), false);
  assert.equal(invalidIdentityResponse.result.statusCode, 403);

  const missingSchoolResponse = makeResponse();
  assert.equal(feesAreaGuard({
    session: { ...supportSession, schoolId: null },
  }, missingSchoolResponse.response, FEES_AREAS.LEDGER_TRANSACTIONS), false);
  assert.equal(missingSchoolResponse.result.statusCode, 403);
});

test("External Portal, refunds, and unknown Fees routes stay outside Support Staff areas", () => {
  assert.equal(feesAreasForRequest("GET", "/api/admin/fees/external-settings"), null);
  assert.equal(feesAreasForRequest("POST", "/api/admin/fees/payments/12/refunds"), null);
  assert.equal(feesAreasForRequest("GET", "/api/admin/fees/payments/12/refund-eligibility"), null);
  assert.equal(feesAreasForRequest("POST", "/api/admin/fees/structures/12/generate-invoices"), null);
  assert.equal(feesAreasForRequest("POST", "/api/admin/fees/bulk-delete"), null);
  assert.equal(feesAreasForRequest("DELETE", "/api/admin/fees/12"), null);
  assert.deepEqual(feesAreasForRequest("PATCH", "/api/admin/fees/12"), [FEES_AREAS.LEDGER_TRANSACTIONS]);
  assert.deepEqual(feesAreasForRequest("GET", "/api/admin/fees/class-options"), [
    FEES_AREAS.FEE_STRUCTURES,
    FEES_AREAS.LEDGER_TRANSACTIONS,
  ]);
  assert.equal(feesAreasForRequest("GET", "/api/admin/fees/unrecognized"), null);
});
