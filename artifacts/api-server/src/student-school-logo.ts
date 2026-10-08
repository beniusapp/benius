type StudentSchoolIdentity = {
  schoolId: number;
};

type SchoolLogoIdentity = {
  id: number;
  logoUrl: string | null | undefined;
};

export type StudentSchoolJoin = {
  student: StudentSchoolIdentity;
  school: SchoolLogoIdentity;
};

export async function loadStudentMeIdentity<T extends StudentSchoolJoin>(
  authenticatedStudentId: number,
  getStudentWithSchool: (studentId: number) => Promise<T | null | undefined>,
): Promise<{ data: T; logoUrl: string | null } | null> {
  const data = await getStudentWithSchool(authenticatedStudentId);
  if (!data) return null;

  return {
    data,
    logoUrl: studentSchoolLogoForAuthenticatedStudent(data.student, data.school),
  };
}

export function studentSchoolLogoForAuthenticatedStudent(
  student: StudentSchoolIdentity,
  school: SchoolLogoIdentity,
): string | null {
  if (student.schoolId !== school.id || typeof school.logoUrl !== "string") {
    return null;
  }

  const logoUrl = school.logoUrl.trim();
  return logoUrl.length > 0 ? logoUrl : null;
}
