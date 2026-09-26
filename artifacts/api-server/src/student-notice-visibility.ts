import { notices } from "@workspace/db";
import { and, eq } from "drizzle-orm";

/** A null notice session is unassigned legacy data, not a global notice. */
export function studentNoticeSessionScope(schoolId: number, sessionId: number) {
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0) {
    throw new Error("Student notices require a valid academic session");
  }
  return and(eq(notices.schoolId, schoolId), eq(notices.sessionId, sessionId))!;
}

export function studentNoticeMatchesAudience(
  notice: { targetType: string; targetClass: string | null; targetSection: string | null },
  cls: string,
  section: string,
): boolean {
  if (notice.targetType === "whole_school") return true;
  if (!notice.targetClass) return true;
  const classes = notice.targetClass.split(",").map(value => value.trim());
  if (!classes.includes(cls)) return false;
  if (!notice.targetSection) return true;
  return notice.targetSection.split(",").map(value => value.trim()).includes(section);
}

export function studentCanMarkNoticeIds(
  requestedIds: number[],
  visible: readonly { id: number }[],
): boolean {
  const allowed = new Set(visible.map(notice => notice.id));
  return requestedIds.every(id => allowed.has(id));
}

export function countUnreadStudentNotices(notices: readonly { isRead: boolean }[]): number {
  return notices.filter(notice => !notice.isRead).length;
}