import type {
  StudentModuleActivityCursor,
  StudentModuleDotStateResponse,
  StudentModuleKey,
} from "@workspace/api-zod";

export const STUDENT_MODULE_DOT_KEYS = [
  "homework",
  "classwork",
  "noticeboard",
  "complaints",
] as const satisfies readonly StudentModuleKey[];

export const STUDENT_COMPLAINT_NOTIFICATION_ROLES = ["teacher", "admin"] as const;

export type StudentModuleLatestCursors = Record<
  StudentModuleKey,
  StudentModuleActivityCursor | null
>;

function normalizedCursorTime(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) throw new RangeError("Invalid activity cursor timestamp");
  return `${match[1]}.${(match[2] ?? "").padEnd(6, "0")}`;
}

export function compareStudentModuleCursors(
  left: StudentModuleActivityCursor,
  right: StudentModuleActivityCursor,
): number {
  const leftTime = normalizedCursorTime(left.createdAt);
  const rightTime = normalizedCursorTime(right.createdAt);
  if (leftTime < rightTime) return -1;
  if (leftTime > rightTime) return 1;
  return Math.sign(left.recordId - right.recordId);
}

export function studentModuleHasNewActivity(
  latest: StudentModuleActivityCursor | null,
  seen: StudentModuleActivityCursor | null,
): boolean {
  return latest !== null && (seen === null || compareStudentModuleCursors(latest, seen) > 0);
}

export function isStudentModuleKey(value: string): value is StudentModuleKey {
  return (STUDENT_MODULE_DOT_KEYS as readonly string[]).includes(value);
}

export function hasOnlyOwnKeys(value: unknown, allowedKeys: readonly string[]): boolean {
  return (
    value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).every(key => allowedKeys.includes(key))
  );
}

export function buildStudentModuleDotStateResponse(
  latest: StudentModuleLatestCursors,
  seen: ReadonlyMap<StudentModuleKey, StudentModuleActivityCursor>,
): StudentModuleDotStateResponse {
  return {
    homework: {
      hasNewActivity: studentModuleHasNewActivity(latest.homework, seen.get("homework") ?? null),
      latestActivityCursor: latest.homework,
    },
    classwork: {
      hasNewActivity: studentModuleHasNewActivity(latest.classwork, seen.get("classwork") ?? null),
      latestActivityCursor: latest.classwork,
    },
    noticeboard: {
      hasNewActivity: studentModuleHasNewActivity(latest.noticeboard, seen.get("noticeboard") ?? null),
      latestActivityCursor: latest.noticeboard,
    },
    complaints: {
      hasNewActivity: studentModuleHasNewActivity(latest.complaints, seen.get("complaints") ?? null),
      latestActivityCursor: latest.complaints,
    },
  };
}
