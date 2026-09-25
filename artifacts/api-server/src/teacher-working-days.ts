import { and, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { schoolMetadata } from "@workspace/db";

export const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
export type WorkingDays = Record<(typeof WEEKDAYS)[number], boolean>;
export const DEFAULT_WORKING_DAYS: WorkingDays = {
  sunday: false, monday: true, tuesday: true, wednesday: true,
  thursday: true, friday: true, saturday: false,
};
const KEY = "teacher_self_working_days";

export function parseWorkingDays(value: unknown): WorkingDays {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== 7 ||
      !WEEKDAYS.every(day => Object.prototype.hasOwnProperty.call(value, day) &&
        typeof (value as Record<string, unknown>)[day] === "boolean") ||
      !WEEKDAYS.some(day => (value as Record<string, boolean>)[day])) {
    throw new Error("Working days must contain exactly seven boolean weekdays, with at least one enabled");
  }
  return value as WorkingDays;
}

export async function getWorkingDays(schoolId: number): Promise<WorkingDays> {
  const [row] = await db.select({ metaValue: schoolMetadata.metaValue }).from(schoolMetadata)
    .where(and(eq(schoolMetadata.schoolId, schoolId), eq(schoolMetadata.metaKey, KEY)));
  if (!row) return { ...DEFAULT_WORKING_DAYS };
  // An existing corrupt setting is not the same as an absent setting: fail visibly.
  return parseWorkingDays(JSON.parse(row.metaValue));
}

export async function saveWorkingDays(schoolId: number, value: unknown): Promise<WorkingDays> {
  const days = parseWorkingDays(value);
  await db.insert(schoolMetadata).values({ schoolId, metaKey: KEY, metaValue: JSON.stringify(days) })
    .onConflictDoUpdate({
      target: [schoolMetadata.schoolId, schoolMetadata.metaKey],
      set: { metaValue: sql`excluded.meta_value`, updatedAt: new Date() },
    });
  return days;
}