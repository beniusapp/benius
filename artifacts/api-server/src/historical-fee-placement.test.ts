import assert from "node:assert/strict";
import test from "node:test";
import {
  feePlacementForDisplay,
  HISTORICAL_PLACEMENT_UNAVAILABLE,
  paymentFeeSessionNotice,
  paymentSideSessionNotice,
  resolveHistoricalFeePlacement,
  type FeePlacementCandidate,
} from "./historical-fee-placement";

const scope = { schoolId: 4, studentId: 22, sessionId: 202 };
const candidate = (
  sessionId: number,
  overrides: Partial<FeePlacementCandidate> = {},
): FeePlacementCandidate => ({
  schoolId: scope.schoolId,
  studentId: scope.studentId,
  sessionId,
  className: "1",
  sectionName: "A",
  rollNumber: 7,
  ...overrides,
});

test("uses the requested historical session rather than another session's placement", () => {
  const placement = resolveHistoricalFeePlacement(scope, [
    candidate(101, { className: "2", sectionName: "B", rollNumber: 8 }),
    candidate(202, { className: "1", sectionName: "A", rollNumber: 7 }),
  ]);

  assert.equal(placement.available, true);
  assert.equal(placement.className, "1");
  assert.equal(placement.sectionName, "A");
  assert.equal(placement.rollNumber, 7);
});

test("historical/current-session fixtures ignore the newer Student Registry placement", () => {
  const enrollments = [
    candidate(2026, { className: "1", sectionName: "A" }),
    candidate(2027, { className: "2", sectionName: "A" }),
  ];
  const currentRegistryPlacement = { className: "2", sectionName: "A" };
  const historical = resolveHistoricalFeePlacement(
    { ...scope, sessionId: 2026 },
    enrollments,
  );
  const current = resolveHistoricalFeePlacement(
    { ...scope, sessionId: 2027 },
    enrollments,
  );

  assert.deepEqual(
    feePlacementForDisplay(historical),
    { className: "1", sectionName: "A", rollNumber: 7 },
  );
  assert.equal(historical.className, "1");
  assert.notEqual(historical.className, currentRegistryPlacement.className);
  assert.equal(current.className, currentRegistryPlacement.className);
  assert.equal(current.sectionName, currentRegistryPlacement.sectionName);
});

test("rejects a candidate from another school or Student", () => {
  const placement = resolveHistoricalFeePlacement(scope, [
    candidate(202, { schoolId: 5 }),
    candidate(202, { studentId: 23 }),
  ]);

  assert.equal(placement.available, false);
  assert.equal(placement.reason, "not_found");
});

test("NULL session and a missing enrollment remain unavailable", () => {
  assert.equal(
    resolveHistoricalFeePlacement({ ...scope, sessionId: null }, []).reason,
    "session_unassigned",
  );
  assert.equal(
    resolveHistoricalFeePlacement(scope, []).reason,
    "not_found",
  );
});

test("duplicate exact enrollments fail closed instead of choosing one", () => {
  const placement = resolveHistoricalFeePlacement(scope, [
    candidate(202, { className: "1" }),
    candidate(202, { className: "2" }),
  ]);

  assert.equal(placement.available, false);
  assert.equal(placement.reason, "ambiguous");
});

test("blank historical class or section is reported as unavailable", () => {
  const placement = resolveHistoricalFeePlacement(scope, [
    candidate(202, { sectionName: " " }),
  ]);

  assert.equal(placement.available, false);
  assert.equal(placement.reason, "incomplete");
});

test("unavailable placement is explicit and never supplies Registry values", () => {
  const display = feePlacementForDisplay(
    resolveHistoricalFeePlacement(scope, []),
  );

  assert.equal(display.className, HISTORICAL_PLACEMENT_UNAVAILABLE);
  assert.equal(display.sectionName, "—");
  assert.equal(display.rollNumber, null);
});

test("matching payment and invoice sessions have no warning", () => {
  assert.equal(paymentFeeSessionNotice("202", 202), null);
  assert.equal(paymentFeeSessionNotice(null, null), null);
});

test("payment and invoice session mismatches are reported without repair", () => {
  const warning = paymentFeeSessionNotice(201, 202);

  assert.match(warning ?? "", /payment record session ID 201 differs from invoice session ID 202/);
  assert.match(warning ?? "", /no records were changed/);
  assert.match(paymentFeeSessionNotice(null, 202) ?? "", /unassigned \(NULL\)/);
});

test("transaction payment-attempt and payment-record session mismatches are labeled", () => {
  assert.equal(paymentSideSessionNotice("payment attempt", 202, "202"), null);
  assert.match(
    paymentSideSessionNotice("payment attempt", 201, 202) ?? "",
    /payment attempt session ID 201 differs from invoice session ID 202/,
  );
  assert.match(
    paymentSideSessionNotice("payment record", null, 202) ?? "",
    /payment record session unassigned \(NULL\).*no records were changed/,
  );
});

test("invalid payment-to-invoice links are reported as unresolved", () => {
  assert.match(
    paymentFeeSessionNotice(202, 202, false) ?? "",
    /No valid linked invoice.*Historical placement is unavailable/,
  );
});
