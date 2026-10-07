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
import { academicSessions, schools, students } from "./schema";

export const studentModuleSeenState = pgTable("student_module_seen_state", {
  schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
  studentId: integer("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  sessionId: integer("session_id").notNull().references(() => academicSessions.id, { onDelete: "cascade" }),
  moduleKey: varchar("module_key", { length: 20 }).notNull(),
  seenActivityAt: timestamp("seen_activity_at").notNull(),
  seenActivityRecordId: integer("seen_activity_record_id").notNull(),
}, (table) => [
  primaryKey({
    name: "student_module_seen_state_pk",
    columns: [table.schoolId, table.studentId, table.sessionId, table.moduleKey],
  }),
  check(
    "student_module_seen_state_module_chk",
    sql`${table.moduleKey} IN ('homework', 'classwork', 'noticeboard', 'complaints')`,
  ),
  check("student_module_seen_state_record_id_chk", sql`${table.seenActivityRecordId} > 0`),
]);

export const insertStudentModuleSeenStateSchema = createInsertSchema(studentModuleSeenState);
export type InsertStudentModuleSeenState = z.infer<typeof insertStudentModuleSeenStateSchema>;
export type StudentModuleSeenState = typeof studentModuleSeenState.$inferSelect;
