export const STUDENT_PROFILE_PLACEMENT_ERROR =
  "Class, section, and roll number are school-assigned and cannot be changed through profile verification.";

export type StudentProfilePlacementInputOptions = {
  /**
   * Mobile clients currently echo the visible current roll number when saving
   * other profile fields. Permit that unchanged value, then strip it so it
   * cannot be persisted as a profile-submitted placement value.
   */
  allowUnchangedRollNo?: string;
};

export type StudentProfilePlacementInputResult =
  | { ok: true; body: unknown }
  | { ok: false; message: string };

export function removeStudentProfilePlacementInput(
  body: unknown,
  options: StudentProfilePlacementInputOptions = {},
): StudentProfilePlacementInputResult {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: true, body };
  }

  const input = body as Record<string, unknown>;
  const hasClass = Object.hasOwn(input, "class");
  const hasSection = Object.hasOwn(input, "section");
  const hasRollNo = Object.hasOwn(input, "rollNo");
  const unchangedMobileRollNo = options.allowUnchangedRollNo !== undefined
    && input.rollNo === options.allowUnchangedRollNo;

  if (hasClass || hasSection || (hasRollNo && !unchangedMobileRollNo)) {
    return { ok: false, message: STUDENT_PROFILE_PLACEMENT_ERROR };
  }

  const safeBody = { ...input };
  delete safeBody.class;
  delete safeBody.section;
  delete safeBody.rollNo;
  return { ok: true, body: safeBody };
}
