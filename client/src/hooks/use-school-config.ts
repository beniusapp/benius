import { useQuery } from "@tanstack/react-query";

interface SchoolConfig {
  classes: string[];
  sections: string[];
  subjects: string[];
  examTypes: string[];
  classSections: Record<string, string[]>;
  classSubjects: Record<string, string[]>;
  classExamTypes: Record<string, string[]>;
}

const FALLBACK_CLASSES = ["L.K.G", "U.K.G", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];
const FALLBACK_SECTIONS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const FALLBACK_EXAM_TYPES = ["UT1", "UT2", "Mid-term", "UT3", "Pre-Final", "Annual"];

export function useSchoolConfig(schoolId: number) {
  const { data, isLoading } = useQuery<SchoolConfig>({
    queryKey: ["/api/school-config", schoolId],
    queryFn: async () => {
      const res = await fetch(`/api/school-config/${schoolId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load school config");
      return res.json();
    },
    enabled: !!schoolId,
  });

  return {
    classes: data?.classes?.length ? data.classes : FALLBACK_CLASSES,
    sections: data?.sections?.length ? data.sections : FALLBACK_SECTIONS,
    subjects: data?.subjects || [],
    examTypes: data?.examTypes?.length ? data.examTypes : FALLBACK_EXAM_TYPES,
    classSections: data?.classSections ?? {},
    classSubjects: data?.classSubjects ?? {},
    classExamTypes: data?.classExamTypes ?? {},
    isLoading,
    hasConfig: !!data && (!!data.classes?.length || !!data.subjects?.length || !!data.examTypes?.length),
  };
}

/**
 * Strict variant — returns ONLY school-defined values, never hardcoded fallbacks.
 * Per-class maps let modules filter sections/subjects/examTypes by the selected class.
 */
export function useSchoolConfigStrict(schoolId: number) {
  const { data, isLoading } = useQuery<SchoolConfig>({
    queryKey: ["/api/school-config", schoolId],
    queryFn: async () => {
      const res = await fetch(`/api/school-config/${schoolId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load school config");
      return res.json();
    },
    enabled: !!schoolId,
    staleTime: 30_000,
  });

  const classes = data?.classes ?? [];
  const sections = data?.sections ?? [];
  const subjects = data?.subjects ?? [];
  // Never substitute hardcoded fallbacks in the strict variant.
  // An empty array means the school cleared their exam types; show nothing rather than wrong options.
  const examTypes = data?.examTypes ?? [];
  const classSections: Record<string, string[]> = data?.classSections ?? {};
  const classSubjects: Record<string, string[]> = data?.classSubjects ?? {};
  const classExamTypes: Record<string, string[]> = data?.classExamTypes ?? {};

  const hasClasses = classes.length > 0;
  const hasSections = sections.length > 0;
  const hasSubjects = subjects.length > 0;
  const isFullyConfigured = hasClasses && hasSections && hasSubjects;

  /** Get sections for a given className — from classSections map if available, else all school sections */
  function getSectionsForClass(className: string): string[] {
    if (className && classSections[className]?.length) {
      return classSections[className];
    }
    return sections;
  }

  /** Get subjects for a given className — from classSubjects map if available, else all school subjects */
  function getSubjectsForClass(className: string): string[] {
    if (className && classSubjects[className]?.length) {
      return classSubjects[className];
    }
    return subjects;
  }

  /** Get exam types for a given className — from classExamTypes map if available, else all school exam types.
   *  Per-class entries are filtered against the global list so stale values removed from school setup
   *  don't bleed through into teacher dropdowns. */
  function getExamTypesForClass(className: string): string[] {
    if (className && classExamTypes[className]?.length) {
      // Only keep per-class exam types that still exist in the current global list.
      const valid = examTypes.length
        ? classExamTypes[className].filter(et => examTypes.includes(et))
        : classExamTypes[className];
      return valid.length ? valid : examTypes;
    }
    return examTypes;
  }

  return {
    classes,
    sections,
    subjects,
    examTypes,
    classSections,
    classSubjects,
    classExamTypes,
    getSectionsForClass,
    getSubjectsForClass,
    getExamTypesForClass,
    isLoading,
    hasClasses,
    hasSections,
    hasSubjects,
    isFullyConfigured,
  };
}
