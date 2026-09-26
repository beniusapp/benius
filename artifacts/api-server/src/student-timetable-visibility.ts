import { timetableEntries } from "@workspace/db";
import { and, eq } from "drizzle-orm";

/** Match the selected enrollment without filtering draft timetable entries. */
export function studentTimetableScope(schoolId: number, sessionId: number, cls: string, section: string) {
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0) {
    throw new Error("Student Timetable requires a valid academic session");
  }
  return and(
    eq(timetableEntries.schoolId, schoolId),
    eq(timetableEntries.sessionId, sessionId),
    eq(timetableEntries.class, cls),
    eq(timetableEntries.section, section),
  )!;
}