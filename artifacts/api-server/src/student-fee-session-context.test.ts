import assert from "node:assert/strict";
import test from "node:test";
import { storage } from "./storage";
import { requireStudentFeeSession } from "./student-fee-session-context";

function responseMock() {
  const response: any = {
    statusCode: 200,
    body: null,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
  return response;
}

test("Student Fees rejects absent and malformed session headers before lookup", async () => {
  const original = storage.getAcademicSessionById;
  let lookups = 0;
  (storage as any).getAcademicSessionById = async () => { lookups++; return null; };
  try {
    for (const header of [undefined, "41junk", "0"]) {
      const response = responseMock();
      const ok = await requireStudentFeeSession({ headers: { "x-view-session-id": header } } as any, response, 3);
      assert.equal(ok, false);
      assert.equal(response.statusCode, 400);
    }
    assert.equal(lookups, 0);
  } finally {
    (storage as any).getAcademicSessionById = original;
  }
});

test("allows archived school-owned reads and denies another school's session", async () => {
  const original = storage.getAcademicSessionById;
  (storage as any).getAcademicSessionById = async (id: number) => ({
    id, schoolId: id === 41 ? 3 : 9, isActive: false,
  });
  try {
    const archivedReq: any = { headers: { "x-view-session-id": "41" } };
    assert.equal(await requireStudentFeeSession(archivedReq, responseMock(), 3), true);
    assert.equal(archivedReq.viewSessionId, 41);

    const response = responseMock();
    assert.equal(await requireStudentFeeSession(
      { headers: { "x-view-session-id": "42" } } as any, response, 3,
    ), false);
    assert.equal(response.statusCode, 404);
  } finally {
    (storage as any).getAcademicSessionById = original;
  }
});
