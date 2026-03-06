import { useQuery } from "@tanstack/react-query";

interface SchoolConfig {
  classes: string[];
  sections: string[];
  subjects: string[];
  examTypes: string[];
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
    isLoading,
    hasConfig: !!data && (!!data.classes?.length || !!data.subjects?.length || !!data.examTypes?.length),
  };
}
