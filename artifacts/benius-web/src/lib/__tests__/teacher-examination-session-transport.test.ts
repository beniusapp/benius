import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequestForViewSession, sessionFetchForViewSession } from "@/lib/queryClient";
import { computeAllStudentResults } from "@shared/examination-calculation-engine";

const examinationSource = readFileSync(
  resolve(process.cwd(), "src/pages/teacher-modules/examination.tsx"),
  "utf8",
);
const dashboardSource = readFileSync(
  resolve(process.cwd(), "src/pages/teacher-dashboard.tsx"),
  "utf8",
);
const approvalSource = readFileSync(
  resolve(process.cwd(), "src/pages/teacher-modules/student-profiles.tsx"),
  "utf8",
);

describe("Teacher Examination selected-session transport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("keeps Session A → B → A cache identities and request headers isolated", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("[]"));
    vi.stubGlobal("fetch", fetchMock);
    const sessionIds = [41, 30375, 41];
    const keys = sessionIds.map(sessionId => ["/api/teacher/class-scores", 11, sessionId, "6", "B"]);

    for (const sessionId of sessionIds) {
      await sessionFetchForViewSession("/api/teacher/class-scores/6/B", sessionId);
    }

    expect(keys[0]).not.toEqual(keys[1]);
    expect(keys[0]).toEqual(keys[2]);
    expect(fetchMock.mock.calls.map(([, init]) =>
      new Headers(init.headers).get("x-view-session-id"),
    )).toEqual(["41", "30375", "41"]);
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

  it("keys Dashboard approval and Noticeboard badges by the selected session and pins each request", async () => {
    expect(dashboardSource).toContain(
      'queryKey: ["/api/teacher/pending-profiles/count", teacher?.schoolId ?? null, teacher?.id ?? null, selectedSessionId]',
    );
    expect(dashboardSource).toContain(
      'queryKey: ["/api/notices", teacher?.schoolId ?? null, teacher?.id ?? null, selectedSessionId, "teacher"]',
    );
    expect(dashboardSource).toMatch(/sessionFetchForViewSession\(\s*String\(queryKey\[0\]\),\s*sessionId/);
    expect(dashboardSource).toMatch(/const sessionId = queryKey\[3\]/);

    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    const sessionIds = [41, 30375, 41];
    const keys = sessionIds.map(sessionId => ["/api/teacher/pending-profiles/count", 11, 9, sessionId]);
    for (const sessionId of sessionIds) {
      await sessionFetchForViewSession("/api/teacher/pending-profiles/count", sessionId);
    }

    expect(keys[0]).not.toEqual(keys[1]);
    expect(keys[0]).toEqual(keys[2]);
    expect(fetchMock.mock.calls.map(([, init]) =>
      new Headers(init.headers).get("x-view-session-id"),
    )).toEqual(["41", "30375", "41"]);
  });

  it("keys Approval Center reads by the selected session and pins approval writes to that session", async () => {
    expect(approvalSource).toContain(
      'const pendingQueryKey = ["/api/teacher/pending-profiles", teacher.schoolId, teacher.id, selectedSessionId]',
    );
    expect(approvalSource).toContain(
      'const historyQueryKey = ["/api/teacher/profiles/approval-history", teacher.schoolId, teacher.id, selectedSessionId]',
    );
    expect(approvalSource).toMatch(
      /sessionFetchForViewSession\(\s*String\(queryKey\[0\]\),\s*queryKey\[3\]/,
    );
    expect(approvalSource).toContain("apiRequestForViewSession(");
    expect(approvalSource).toContain(
      "}, [teacher.schoolId, teacher.id, selectedSessionId]);",
    );

    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    for (const sessionId of [41, 30375, 41]) {
      await sessionFetchForViewSession("/api/teacher/pending-profiles", sessionId);
      await apiRequestForViewSession(
        "POST", "/api/teacher/profiles/bulk-approve", { studentIds: [10] }, sessionId,
      );
    }

    expect(fetchMock.mock.calls.map(([, init]) =>
      new Headers(init.headers).get("x-view-session-id"),
    )).toEqual(["41", "41", "30375", "30375", "41", "41"]);
  });

  it("wires the Examination Attendance widget to the selected Session and waits for one", () => {
    expect(examinationSource).toContain(
      'queryKey: ["/api/teacher/attendance-summary", teacher.schoolId, selectedSessionId, resClass, resSection]',
    );
    expect(examinationSource).toContain(
      "sessionFetchForViewSession(`/api/teacher/attendance-summary/${encodeURIComponent(resClass)}/${encodeURIComponent(resSection)}`, selectedSessionId)",
    );
    expect(examinationSource).toContain(
      "enabled: !!selectedSessionId && !!resClass && !!resSection",
    );
  });

  it("pins the Add Marks Attendance roster request and cache to the selected session", () => {
    expect(examinationSource).toContain(
      'queryKey: ["/api/attendance", teacher.schoolId, selectedSessionId, selectedClass, selectedSection, attendanceRosterDate]',
    );
    expect(examinationSource).toMatch(
      /sessionFetchForViewSession\(\s*`\/api\/attendance\/[^`]*\$\{attendanceRosterDate\}`,\s*selectedSessionId,\s*\)/,
    );
    expect(examinationSource).toContain(
      "enabled: !!selectedSessionId && !!attendanceRosterDate && !!selectedClass && !!selectedSection",
    );
    expect(examinationSource).toContain("today < selectedSession.startDate");
    expect(examinationSource).toContain("today > selectedSession.endDate");
  });

  it("keys class and student result caches by school and the full selected cohort", () => {
    expect(examinationSource).toContain(
      'queryKey: ["/api/teacher/class-scores", teacher.schoolId, selectedSessionId, resClass, resSection]',
    );
    expect(examinationSource).toContain(
      'queryKey: ["/api/exam-scores/student", schoolId, sessionId, viewClass, viewSection, studentId]',
    );
    expect(examinationSource).toContain(
      'queryKey: ["/api/exam-scores/class-average", schoolId, sessionId, viewClass, viewSection, subject]',
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