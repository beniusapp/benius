import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sessionFetchForViewSession } from "@/lib/queryClient";
import { computeAllStudentResults } from "@shared/examination-calculation-engine";

const examinationSource = readFileSync(
  resolve(process.cwd(), "client/src/pages/teacher-modules/examination.tsx"),
  "utf8",
);

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

  it("sends the selected Session for the Examination Attendance summary and updates it when switched", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("[]"));
    vi.stubGlobal("fetch", fetchMock);

    await sessionFetchForViewSession("/api/teacher/attendance-summary/6/B", 41);
    await sessionFetchForViewSession("/api/teacher/attendance-summary/6/B", 30375);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/teacher/attendance-summary/6/B",
      "/api/teacher/attendance-summary/6/B",
    ]);
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get("x-view-session-id")).toBe("41");
    expect(new Headers(fetchMock.mock.calls[1][1].headers).get("x-view-session-id")).toBe("30375");
  });

  it("removes the Session header when Examination has no selected Session instead of falling back", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("[]"));
    vi.stubGlobal("fetch", fetchMock);

    await sessionFetchForViewSession("/api/teacher/attendance-summary/6/B", null);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get("x-view-session-id")).toBeNull();
  });

  it("wires the Examination Attendance widget to the selected Session and waits for one", () => {
    expect(examinationSource).toContain(
      'queryKey: ["/api/teacher/attendance-summary", selectedSessionId, resClass, resSection]',
    );
    expect(examinationSource).toContain(
      "sessionFetchForViewSession(`/api/teacher/attendance-summary/${encodeURIComponent(resClass)}/${encodeURIComponent(resSection)}`, selectedSessionId)",
    );
    expect(examinationSource).toContain(
      "enabled: !!selectedSessionId && !!resClass && !!resSection",
    );
  });

  it("keeps the actual selected session in the Fix 1 calculation context", () => {
    const [result] = computeAllStudentResults({
      context: { schoolId: 11, sessionId: 30375 },
      students: [{ studentId: 1, name: "A", digitalStudentId: "DS1", rollNumber: null, scores: [] }],
      policy: { schoolId: 11, examWeights: "{}", promotionFailRules: JSON.stringify({ rule1: { enabled: true, rules: [{ term: "Term", fail_count: 99 }] } }) },
      attendance: [],
      passPercentage: 35,
      gradingPolicy: { schoolId: 11 },
      gradingRules: [{ id: 1, tierId: 1, gradeLabel: "Pass", minPercent: 0, maxPercent: 100, remarks: null, sortOrder: 1 }],
    });
    expect(result.sessionId).toBe(30375);
  });
});