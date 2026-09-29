export type HomeworkSchoolOptions = {
  classes: string[];
  sections: string[];
  subjects: string[];
  classSections: Record<string, string[]>;
  classSubjects: Record<string, string[]>;
};

type SchoolMetadataOptions = {
  classes?: string[] | null;
  sections?: string[] | null;
  subjects?: string[] | null;
};

export function deriveHomeworkSchoolOptions(
  metadata: SchoolMetadataOptions,
  classSections: Record<string, string[]>,
  classSubjects: Record<string, string[]>,
): HomeworkSchoolOptions {
  const sections = metadata.sections?.length
    ? metadata.sections
    : [...new Set(Object.values(classSections).flat())].sort();

  return {
    classes: metadata.classes?.length ? metadata.classes : Object.keys(classSections),
    sections,
    subjects: metadata.subjects ?? [],
    classSections,
    classSubjects,
  };
}

export function isHomeworkClassSectionConfigured(
  options: HomeworkSchoolOptions,
  className: string,
  section: string,
): boolean {
  if (!options.classes.includes(className)) return false;
  const classSections = options.classSections[className];
  const sections = classSections?.length ? classSections : options.sections;
  return sections.includes(section);
}

export function isHomeworkSubjectConfigured(
  options: HomeworkSchoolOptions,
  className: string,
  subject: string,
): boolean {
  const classSubjects = options.classSubjects[className];
  const subjects = classSubjects?.length ? classSubjects : options.subjects;
  return subjects.length === 0 ? subject.trim().length > 0 : subjects.includes(subject);
}

export function countDistinctHomeworkStudents(
  roster: readonly { id: number }[],
): number {
  return new Set(roster.map((student) => student.id)).size;
}