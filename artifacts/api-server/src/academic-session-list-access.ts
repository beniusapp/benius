export interface AcademicSessionListSession {
  userId?: number | null;
  userRole?: string | null;
  schoolId?: number | null;
  staffId?: number | null;
}

export type AcademicSessionListAccess =
  | { authorized: false }
  | { authorized: true; schoolId: number | null };

/**
 * Resolve read access and tenant scope only from the authenticated server session.
 * Academic-session management endpoints keep their separate Admin-only guards.
 */
export function resolveAcademicSessionListAccess(
  session: AcademicSessionListSession,
): AcademicSessionListAccess {
  const { userId, userRole, schoolId, staffId } = session;
  const validSchoolId =
    Number.isSafeInteger(schoolId) && (schoolId ?? 0) > 0
      ? schoolId!
      : null;

  if (!Number.isSafeInteger(userId) || !userId) {
    return { authorized: false };
  }

  if (userRole === "admin" && userId > 0) {
    return { authorized: true, schoolId: validSchoolId };
  }

  const validSupportStaff =
    userRole === "support_staff"
    && Number.isSafeInteger(staffId)
    && (staffId ?? 0) > 0
    && userId === -staffId!;

  if (validSupportStaff) {
    return { authorized: true, schoolId: validSchoolId };
  }

  return { authorized: false };
}
