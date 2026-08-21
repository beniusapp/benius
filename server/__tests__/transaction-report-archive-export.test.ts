import { afterEach, describe, expect, it, vi } from "vitest";
import { checkSessionContext } from "../routes";
import { storage } from "../storage";

function responseMock() {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("archived-session transaction report transport", () => {
  it("allows the read-only transaction-report POST for an archived viewed session", async () => {
    vi.spyOn(storage, "getActiveSession").mockResolvedValue({ id: 200 } as any);
    const req: any = {
      method: "POST",
      path: "/api/admin/fees/payments/report/pdf",
      headers: { "x-view-session-id": "100" },
      session: { schoolId: 7, userId: 9, userRole: "admin" },
    };
    const res = responseMock();
    const next = vi.fn();

    await checkSessionContext(req, res, next);

    expect(req.viewSessionId).toBe(100);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("continues to block ordinary POST mutations in an archived viewed session", async () => {
    vi.spyOn(storage, "getActiveSession").mockResolvedValue({ id: 200 } as any);
    const req: any = {
      method: "POST",
      path: "/api/admin/fees/records",
      headers: { "x-view-session-id": "100" },
      session: { schoolId: 7, userId: 9, userRole: "admin" },
    };
    const res = responseMock();
    const next = vi.fn();

    await checkSessionContext(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "ARCHIVE_READ_ONLY" }),
    );
  });
});