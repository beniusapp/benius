import { useQuery } from "@tanstack/react-query";

interface SchoolConfig {
  classes: string[];
  sections: string[];
  subjects: string[];
  examTypes: string[];
  classSections: Record<string, string[]>;
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
    isLoading,
    hasConfig: !!data && (!!data.classes?.length || !!data.subjects?.length || !!data.examTypes?.length),
  };
}

/**
 * Strict variant — returns ONLY school-defined values, never hardcoded fallbacks.
 * classSections: per-class section map derived from student enrolments + faculty mappings.
 * When a class is selected, use classSections[className] for the sections dropdown.
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
  const examTypes = data?.examTypes?.length ? data.examTypes : FALLBACK_EXAM_TYPES;
  const classSections: Record<string, string[]> = data?.classSections ?? {};

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

  return {
    classes,
    sections,
    subjects,
    examTypes,
    classSections,
    getSectionsForClass,
    isLoading,
    hasClasses,
    hasSections,
    hasSubjects,
    isFullyConfigured,
  };
}
