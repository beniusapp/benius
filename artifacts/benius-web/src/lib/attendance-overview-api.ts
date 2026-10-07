export const attendanceOverviewQueryKeys = {
  context: (schoolId: number, sessionId: number | null) =>
    ["/api/admin/attendance/context", schoolId, sessionId] as const,
  overview: (schoolId: number, sessionId: number | null, date: string) =>
    ["/api/admin/attendance/overview", schoolId, sessionId, date] as const,
  teacherSummary: (schoolId: number, sessionId: number | null, date: string) =>
    ["/api/admin/attendance/teacher-summary", schoolId, sessionId, date] as const,
  classDetail: (
    schoolId: number,
    sessionId: number | null,
    className: string,
    sectionName: string,
    date: string,
  ) => ["/api/admin/attendance/class-detail", schoolId, sessionId, className, sectionName, date] as const,
};

export async function requireAttendanceJson<T>(
  response: Response,
  errorMessage: string,
): Promise<T> {
  if (!response.ok) throw new Error(errorMessage);
  return response.json() as Promise<T>;
}
