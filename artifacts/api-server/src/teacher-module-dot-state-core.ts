import type {
  TeacherModuleActivityCursor,
  TeacherModuleActivityCursorSource,
  TeacherModuleDotStateResponse,
  TeacherModuleKey,
} from "@workspace/api-zod";

export const TEACHER_MODULE_DOT_KEYS = [
  "noticeboard",
  "complaints",
  "leave",
  "approval_center",
] as const satisfies readonly TeacherModuleKey[];

export const TEACHER_MODULE_ACTIVITY_SOURCES = [
  "notice",
  "peer_report",
  "student_leave",
  "student_profile_submission",
  "student_profile_photo",
] as const satisfies readonly TeacherModuleActivityCursorSource[];

export type TeacherModuleLatestCursors = Record<
  TeacherModuleKey,
  TeacherModuleActivityCursor | null
>;

export function isTeacherModuleKey(value: string): value is TeacherModuleKey {
  return (TEACHER_MODULE_DOT_KEYS as readonly string[]).includes(value);
}

export function hasOnlyTeacherModuleDotKeys(value: unknown, allowedKeys: readonly string[]): boolean {
  return (
    value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).every(key => allowedKeys.includes(key))
  );
}

function normalizedCursorTime(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) throw new RangeError("Invalid activity cursor timestamp");
  return `${match[1]}.${(match[2] ?? "").padEnd(6, "0")}`;
}

export function compareTeacherModuleCursors(
  left: TeacherModuleActivityCursor,
  right: TeacherModuleActivityCursor,
): number {
  const leftTime = normalizedCursorTime(left.createdAt);
  const rightTime = normalizedCursorTime(right.createdAt);
  if (leftTime < rightTime) return -1;
  if (leftTime > rightTime) return 1;
  if (left.source < right.source) return -1;
  if (left.source > right.source) return 1;
  return Math.sign(left.recordId - right.recordId);
}

export function latestTeacherModuleCursor(
  cursors: readonly TeacherModuleActivityCursor[],
): TeacherModuleActivityCursor | null {
  let latest: TeacherModuleActivityCursor | null = null;
  for (const cursor of cursors) {
    if (latest === null || compareTeacherModuleCursors(cursor, latest) > 0) latest = cursor;
  }
  return latest;
}

export function teacherModuleHasNewActivity(
  latest: TeacherModuleActivityCursor | null,
  seen: TeacherModuleActivityCursor | null,
): boolean {
  return latest !== null && (seen === null || compareTeacherModuleCursors(latest, seen) > 0);
}

export function buildTeacherModuleDotStateResponse(
  latest: TeacherModuleLatestCursors,
  seen: ReadonlyMap<TeacherModuleKey, TeacherModuleActivityCursor>,
): TeacherModuleDotStateResponse {
  return {
    noticeboard: {
      hasNewActivity: teacherModuleHasNewActivity(latest.noticeboard, seen.get("noticeboard") ?? null),
      latestActivityCursor: latest.noticeboard,
    },
    complaints: {
      hasNewActivity: teacherModuleHasNewActivity(latest.complaints, seen.get("complaints") ?? null),
      latestActivityCursor: latest.complaints,
    },
    leave: {
      hasNewActivity: teacherModuleHasNewActivity(latest.leave, seen.get("leave") ?? null),
      latestActivityCursor: latest.leave,
    },
    approval_center: {
      hasNewActivity: teacherModuleHasNewActivity(latest.approval_center, seen.get("approval_center") ?? null),
      latestActivityCursor: latest.approval_center,
    },
  };
}
