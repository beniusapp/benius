import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const serverRoutes = readFileSync(resolve(process.cwd(), "server/routes.ts"), "utf8");
const teacherRoutes = readFileSync(resolve(process.cwd(), "server/teacher-routes.ts"), "utf8");
const adminClient = readFileSync(resolve(process.cwd(), "client/src/pages/admin-modules/attendance-overview.tsx"), "utf8");
const teacherClient = readFileSync(resolve(process.cwd(), "client/src/pages/teacher-modules/attendance.tsx"), "utf8");
const studentAttendanceClient = readFileSync(resolve(process.cwd(), "client/src/pages/student-attendance.tsx"), "utf8");
const studentDashboardClient = readFileSync(resolve(process.cwd(), "client/src/pages/student-dashboard.tsx"), "utf8");
const studentExaminationClient = readFileSync(resolve(process.cwd(), "client/src/pages/student-examination.tsx"), "utf8");
const studentArchivesClient = readFileSync(resolve(process.cwd(), "client/src/pages/student-archives.tsx"), "utf8");
const performanceAnalyticsClient = readFileSync(resolve(process.cwd(), "client/src/pages/admin-modules/performance-analytics.tsx"), "utf8");

function block(source: string, startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(start, `Missing start marker: ${startMarker}`).toBeGreaterThanOrEqual(0);
  expect(end, `Missing end marker: ${endMarker}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("Attendance read Session route contract", () => {
  it("validates Student-selected Sessions before monthly, yearly, and stats reads", () => {
    const monthly = block(
      serverRoutes,
      'app.get("/api/student/attendance/monthly"',
      'app.get("/api/student/attendance/yearly"',
    );
    const yearly = block(
      serverRoutes,
      'app.get("/api/student/attendance/yearly"',
      'app.get("/api/student/attendance/stats"',
    );
    const stats = block(
      serverRoutes,
      'app.get("/api/student/attendance/stats"',
      'app.get("/api/student/attendance-policy"',
    );

    for (const route of [monthly, yearly, stats]) {
      expect(route).toContain("resolveAttendanceReadSession(");
      expect(route).toContain("student.schoolId");
      expect(route).toContain("(req as any).viewSessionId");
      expect(route).toContain("session.id");
      expect(route).toContain("sendAttendanceReadSessionError(res, error)");
    }
  });

  it("always scopes Admin Attendance queries by a validated Session", () => {
    const classDetail = block(
      serverRoutes,
      'app.get("/api/admin/attendance/class-detail"',
      '// ===== ADMIN ATTENDANCE: SCHOOL-WIDE OVERVIEW',
    );
    const overview = block(
      serverRoutes,
      'app.get("/api/admin/attendance/overview"',
      'app.get("/api/admin/attendance/teacher-summary"',
    );
    const teacherSummary = block(
      serverRoutes,
      'app.get("/api/admin/attendance/teacher-summary"',
      '// ===== ACADEMIC SESSIONS API',
    );

    for (const route of [classDetail, teacherSummary]) {
      expect(route).toContain("resolveAttendanceReadSession(");
      expect(route).toContain("eq(attendanceRecords.schoolId, schoolId)");
      expect(route).toContain("eq(attendanceRecords.sessionId, attendanceSession.id)");
      expect(route).toContain("sendAttendanceReadSessionError(res, err)");
    }
    expect(overview).toContain("resolveAttendanceReadSession(");
    expect(overview).toContain("storage.getDailyAttendanceSummary(");
    expect(overview).toContain("schoolId, attendanceSession.id, date");
    expect(overview).toContain("sendAttendanceReadSessionError(res, err)");
  });

  it("fails Teacher daily, history, dashboard summary, and analytics closed without a valid Session", () => {
    const daily = block(
      teacherRoutes,
      'app.get("/api/attendance/:schoolId/:class/:section/:date"',
      'app.post("/api/attendance"',
    );
    const history = block(
      teacherRoutes,
      'app.get("/api/attendance/history/:schoolId/:class/:section/:startDate/:endDate"',
      'app.get("/api/attendance/status/:teacherId"',
    );
    const dailySummary = block(
      teacherRoutes,
      'app.get("/api/attendance/daily-summary/:schoolId/:date"',
      '// ===== COMPLAINTS BY SCHOOL',
    );
    const analytics = block(
      teacherRoutes,
      'app.get("/api/admin/analytics/attendance-summary/:class/:section"',
      '// ===== TEACHER REGISTRY',
    );

    for (const route of [daily, history, dailySummary, analytics]) {
      expect(route).toContain("resolveAttendanceReadSession(");
      expect(route).toContain("attendanceSession.id");
      expect(route).toContain("sendAttendanceReadSessionError(res,");
    }

    expect(dailySummary).toContain('req.session.userRole !== "admin"');
    expect(dailySummary).toContain("req.session.schoolId !== schoolId");
    expect(dailySummary).toContain("requireAttendanceDateInSession(req.params.date, attendanceSession)");
  });
});

describe("Attendance read Session frontend contract", () => {
  it("keys Admin and Teacher Attendance requests by Session and sends the validated-context header", () => {
    expect(adminClient).toContain('queryKey: ["/api/admin/attendance/overview", viewSessionId, date]');
    expect(adminClient).toContain("sessionFetchForViewSession(");
    expect(teacherClient).toContain('queryKey: ["/api/attendance", teacher.schoolId, selectedSession?.id ?? null');
    expect(teacherClient).toContain('queryKey: ["/api/attendance/history", teacher.schoolId, selectedSession?.id ?? null');
    expect(teacherClient).toContain("sessionFetchForViewSession(");
    expect(performanceAnalyticsClient).toContain('queryKey: ["/api/admin/analytics/attendance-summary", resClass, resSection, sessionId]');
    expect(performanceAnalyticsClient).toContain("sessionFetchForViewSession(");
  });

  it("keys every Student Attendance consumer by Session and sends Session context", () => {
    expect(studentAttendanceClient).toContain('queryKey: ["/api/student/attendance/monthly", selectedSession?.id ?? null');
    expect(studentAttendanceClient).toContain('queryKey: ["/api/student/attendance/yearly", selectedSession?.id ?? null');
    expect(studentAttendanceClient).toContain('queryKey: ["/api/student/attendance/stats", selectedSession?.id ?? null');
    expect(studentAttendanceClient).toContain('queryKey: ["/api/student/attendance-policy", selectedSession?.id ?? null]');
    expect(studentDashboardClient).toContain('queryKey: ["/api/student/attendance/stats", selectedSession?.id');
    expect(studentExaminationClient).toContain('queryKey: ["/api/student/attendance/stats", selectedSession?.id ?? null]');
    expect(studentArchivesClient).toContain('queryKey: ["/api/student/archive/attendance", selectedSession?.id]');
    expect(studentArchivesClient).toContain("attendStats.overallPercent");
    expect(studentArchivesClient).not.toContain("attendStats.presentDays / attendStats.totalDays");

    for (const source of [
      studentAttendanceClient,
      studentDashboardClient,
      studentExaminationClient,
      studentArchivesClient,
    ]) {
      expect(source).toContain("sessionFetchForViewSession(");
    }
  });

  it("uses only the shared Student Session authority and waits for it before Attendance reads", () => {
    expect(studentAttendanceClient).toContain("const { isArchiveMode, selectedSession } = useSessionView()");
    expect(studentAttendanceClient).not.toContain("selectedSessionId");
    expect(studentAttendanceClient).not.toContain("setSelectedSessionId");
    expect(studentAttendanceClient).not.toContain("activeSession");
    expect(studentAttendanceClient).not.toContain('queryKey: ["/api/student/academic-sessions"]');

    expect(studentAttendanceClient).toContain('enabled: !!student && !!selectedSession && activeTab === "monthly"');
    expect(studentAttendanceClient).toContain('enabled: !!student && !!selectedSession && activeTab === "yearly" && !!sessionStartDate');
    expect(studentAttendanceClient).toContain("enabled: !!student && !!selectedSession && !!sessionStartDate");
    expect(studentAttendanceClient).toContain("enabled: !!student && !!selectedSession,");

    const attendanceQueries = block(
      studentAttendanceClient,
      "const { data: policyData }",
      "useEffect(() => {\n    if (!studentLoading",
    );
    expect(attendanceQueries.match(/sessionFetchForViewSession/g)).toHaveLength(4);
    expect(attendanceQueries).not.toContain("currentSession");
  });
});