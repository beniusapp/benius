import { sql } from "drizzle-orm";
import {
  check,
  integer,
  pgTable,
  primaryKey,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { academicSessions, schools, teachers } from "./schema";

export const teacherModuleSeenState = pgTable("teacher_module_seen_state", {
  schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
  teacherId: integer("teacher_id").notNull().references(() => teachers.id, { onDelete: "cascade" }),
  sessionId: integer("session_id").notNull().references(() => academicSessions.id, { onDelete: "cascade" }),
  moduleKey: varchar("module_key", { length: 24 }).notNull(),
  seenActivityAt: timestamp("seen_activity_at").notNull(),
  seenActivitySource: varchar("seen_activity_source", { length: 40 }).notNull(),
  seenActivityRecordId: integer("seen_activity_record_id").notNull(),
}, (table) => [
  primaryKey({
    name: "teacher_module_seen_state_pk",
    columns: [table.schoolId, table.teacherId, table.sessionId, table.moduleKey],
  }),
  check(
    "teacher_module_seen_state_module_chk",
    sql`${table.moduleKey} IN ('noticeboard', 'complaints', 'leave', 'approval_center')`,
  ),
  check(
    "teacher_module_seen_state_source_chk",
    sql`${table.seenActivitySource} IN ('notice', 'peer_report', 'student_leave', 'student_profile_submission', 'student_profile_photo')`,
  ),
  check("teacher_module_seen_state_record_id_chk", sql`${table.seenActivityRecordId} > 0`),
]);

export const insertTeacherModuleSeenStateSchema = createInsertSchema(teacherModuleSeenState);
export type InsertTeacherModuleSeenState = z.infer<typeof insertTeacherModuleSeenStateSchema>;
export type TeacherModuleSeenState = typeof teacherModuleSeenState.$inferSelect;
