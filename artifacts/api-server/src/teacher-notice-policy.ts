export type TeacherNoticeMutationScope = {
  schoolId: number;
  sessionId: number;
  teacherId: number;
};

export type TeacherNoticeMutationRecord = {
  schoolId: number;
  sessionId: number | null;
  createdById: number;
  creatorRole: string;
};

export type TeacherNoticeSchoolOptions = {
  classes: string[];
  sections: string[];
  classSections: Record<string, string[]>;
};

export type TeacherNoticeAudience = {
  targetType: string;
  targetClass?: string | null;
  targetSection?: string | null;
};

function splitTargets(value: string | null | undefined): string[] {
  return (value ?? "").split(",").map((part) => part.trim()).filter(Boolean);
}

export function isTeacherNoticeOwnedByTeacherInSession(
  notice: TeacherNoticeMutationRecord,
  scope: TeacherNoticeMutationScope,
): boolean {
  return notice.schoolId === scope.schoolId
    && notice.sessionId === scope.sessionId
    && notice.createdById === scope.teacherId
    && notice.creatorRole === "teacher";
}

/** Teacher audiences are interpreted only inside the authenticated school's configuration. */
export function isTeacherNoticeAudienceWithinSchool(
  audience: TeacherNoticeAudience,
  school: TeacherNoticeSchoolOptions,
): boolean {
  if (audience.targetType === "whole_school") {
    return splitTargets(audience.targetClass).length === 0
      && splitTargets(audience.targetSection).length === 0;
  }
  if (audience.targetType !== "student") return false;

  const classes = splitTargets(audience.targetClass);
  const sections = splitTargets(audience.targetSection);
  if (sections.length > 0 && classes.length === 0) return false;

  if (school.classes.length > 0 && classes.some((className) => !school.classes.includes(className))) {
    return false;
  }

  for (const className of classes) {
    const classSections = school.classSections[className];
    const configuredSections = classSections?.length ? classSections : school.sections;
    if (configuredSections.length > 0 && sections.some((section) => !configuredSections.includes(section))) {
      return false;
    }
  }

  return true;
}