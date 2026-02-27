import { relations } from "drizzle-orm";
import { pgTable, text, varchar, serial, integer, boolean, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const schools = pgTable("schools", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  code: varchar("code", { length: 20 }).notNull().unique(),
});

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("admin"),
  schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
});

export const students = pgTable("students", {
  id: serial("id").primaryKey(),
  schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
  digitalStudentId: varchar("digital_student_id", { length: 50 }).notNull().unique(),
  name: text("name").notNull(),
  class: varchar("class", { length: 20 }).notNull(),
  section: varchar("section", { length: 10 }).notNull(),
  phone: varchar("phone", { length: 20 }).notNull(),
  dob: date("dob").notNull(),
  passwordHash: text("password_hash").notNull(),
  isActivated: boolean("is_activated").notNull().default(false),
});

export const schoolsRelations = relations(schools, ({ many }) => ({
  students: many(students),
  users: many(users),
}));

export const usersRelations = relations(users, ({ one }) => ({
  school: one(schools, {
    fields: [users.schoolId],
    references: [schools.id],
  }),
}));

export const studentsRelations = relations(students, ({ one }) => ({
  school: one(schools, {
    fields: [students.schoolId],
    references: [schools.id],
  }),
}));

export const insertSchoolSchema = createInsertSchema(schools).omit({ id: true });
export type InsertSchool = z.infer<typeof insertSchoolSchema>;
export type School = typeof schools.$inferSelect;

export const insertUserSchema = createInsertSchema(users).omit({ id: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const insertStudentSchema = createInsertSchema(students).omit({ id: true });
export type InsertStudent = z.infer<typeof insertStudentSchema>;
export type Student = typeof students.$inferSelect;
