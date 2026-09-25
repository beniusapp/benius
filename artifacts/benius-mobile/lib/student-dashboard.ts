import { ApiError, MobileUser } from '@/lib/api';

export type StudentDashboardResponse = {
  student: {
    id: number; schoolId: number; name: string; digitalStudentId: string;
    class: string; section: string; photoUrl: string | null;
    schoolName: string; schoolCode: string;
  };
  sessionId: number;
  attendancePercent: number | null;
  unreadNoticeCount: number;
  feesOutstanding: boolean;
};

export function validateStudentDashboard(value: unknown, user: MobileUser, selectedId: number): StudentDashboardResponse {
  if (!value || typeof value !== 'object') throw new ApiError('The server returned an invalid student dashboard.', 'server');
  const result = value as Partial<StudentDashboardResponse>;
  const student = result.student;
  if (!student || student.id !== user.id || student.schoolId !== user.schoolId
    || result.sessionId !== selectedId) {
    throw new ApiError('This dashboard does not match your account and selected school year.', 'server');
  }
  if (typeof student.name !== 'string' || !student.name.trim()
    || typeof student.digitalStudentId !== 'string' || typeof student.class !== 'string'
    || typeof student.section !== 'string' || typeof student.schoolName !== 'string'
    || typeof student.schoolCode !== 'string'
    || (student.photoUrl !== null && student.photoUrl !== undefined && typeof student.photoUrl !== 'string')
    || (result.attendancePercent !== null && (typeof result.attendancePercent !== 'number' || !Number.isFinite(result.attendancePercent) || result.attendancePercent < 0 || result.attendancePercent > 100))
    || !Number.isSafeInteger(result.unreadNoticeCount) || result.unreadNoticeCount! < 0
    || typeof result.feesOutstanding !== 'boolean') {
    throw new ApiError('The server returned an invalid student dashboard.', 'server');
  }
  return result as StudentDashboardResponse;
}
