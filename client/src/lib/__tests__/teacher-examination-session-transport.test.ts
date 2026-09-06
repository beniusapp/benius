import { afterEach, describe, expect, it, vi } from "vitest";
import { sessionFetchForViewSession } from "@/lib/queryClient";
import { computeAllStudentResults } from "@shared/examination-calculation-engine";

describe("Teacher Examination selected-session transport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("pins distinct selected sessions into distinct cache identities and request headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("[]"));
    vi.stubGlobal("fetch", fetchMock);
    const firstSessionId = 41;
    const secondSessionId = 30375;
    const firstKey = ["/api/teacher/class-scores", firstSessionId, "6", "B"];
    const secondKey = ["/api/teacher/class-scores", secondSessionId, "6", "B"];

    await sessionFetchForViewSession(String(firstKey[0]), firstSessionId);
    await sessionFetchForViewSession(String(secondKey[0]), secondSessionId);

    expect(firstKey).not.toEqual(secondKey);
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get("x-view-session-id")).toBe("41");
    expect(new Headers(fetchMock.mock.calls[1][1].headers).get("x-view-session-id")).toBe("30375");
  });

  it("keeps the actual selected session in the Fix 1 calculation context", () => {
    const [result] = computeAllStudentResults({
      context: { schoolId: 11, sessionId: 30375 },
      students: [{ studentId: 1, name: "A", digitalStudentId: "DS1", rollNumber: null, scores: [] }],
      policy: { schoolId: 11, examWeights: "{}", promotionFailRules: "{}" },
      attendance: [],
      passPercentage: 35,
      gradingPolicy: { schoolId: 11 },
      gradingRules: [{ id: 1, tierId: 1, gradeLabel: "Pass", minPercent: 0, maxPercent: 100, remarks: null, sortOrder: 1 }],
    });
    expect(result.sessionId).toBe(30375);
  });
});