const SCHOOL_LOGO_FILENAME = /^[A-Za-z0-9_-]+\.(?:jpe?g|png|webp)$/i;

export function safeStudentSchoolLogoUrl(
  logoUrl: unknown,
  authenticatedSchoolId: number | null | undefined,
): string | null {
  if (
    typeof logoUrl !== "string"
    || !Number.isSafeInteger(authenticatedSchoolId)
    || (authenticatedSchoolId ?? 0) <= 0
  ) {
    return null;
  }

  const prefix = `/uploads/schools/${authenticatedSchoolId}/`;
  if (!logoUrl.startsWith(prefix)) return null;

  const filename = logoUrl.slice(prefix.length);
  return SCHOOL_LOGO_FILENAME.test(filename) ? logoUrl : null;
}
