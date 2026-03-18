import { relations } from "drizzle-orm";
import { pgTable, text, varchar, serial, integer, boolean, date, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
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
  isActive: boolean("is_active").notNull().default(true),
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
  photoUrl: text("photo_url"),
  isActivated: boolean("is_activated").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
});

export const teachers = pgTable("teachers", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
  fullName: text("full_name").notNull(),
  phone: varchar("phone", { length: 20 }).notNull(),
  subject: text("subject").notNull(),
  assignedClass: varchar("assigned_class", { length: 20 }).notNull(),
  assignedSection: varchar("assigned_section", { length: 10 }).notNull(),
  mustChangePassword: boolean("must_change_password").notNull().default(true),
  otpCode: varchar("otp_code", { length: 6 }),
  otpExpiresAt: timestamp("otp_expires_at"),
  resetToken: text("reset_token"),
  resetTokenExpiresAt: timestamp("reset_token_expires_at"),
});

export const attendanceRecords = pgTable("attendance_records", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  teacherId: integer("teacher_id").notNull().references(() => teachers.id, { onDelete: "cascade" }),
  schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  status: text("status").notNull().default("present"),
  editCount: integer("edit_count").notNull().default(0),
  markedBy: text("marked_by").notNull(),
  markedAt: timestamp("marked_at").notNull().defaultNow(),
});

export const homework = pgTable("homework", {
  id: serial("id").primaryKey(),
  teacherId: integer("teacher_id").notNull().references(() => teachers.id, { onDelete: "cascade" }),
  schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
  class: varchar("class", { length: 20 }).notNull(),
  section: varchar("section", { length: 10 }).notNull(),
  subject: varchar("subject", { length: 100 }).notNull().default("General"),
  content: text("content").notNull(),
  fileUrl: text("file_url"),
  dueDate: date("due_date"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const homeworkViews = pgTable("homework_views", {
  id: serial("id").primaryKey(),
  homeworkId: integer("homework_id").notNull().references(() => homework.id, { onDelete: "cascade" }),
  studentId: integer("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  viewedAt: timestamp("viewed_at").notNull().defaultNow(),
});

export const classwork = pgTable("classwork", {
  id: serial("id").primaryKey(),
  teacherId: integer("teacher_id").notNull().references(() => teachers.id, { onDelete: "cascade" }),
  schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
  class: varchar("class", { length: 20 }).notNull(),
  section: varchar("section", { length: 10 }).notNull(),
  subject: varchar("subject", { length: 100 }).notNull().default("General"),
  content: text("content").notNull(),
  fileUrl: text("file_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const notices = pgTable("notices", {
  id: serial("id").primaryKey(),
  schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
  createdById: integer("created_by_id").notNull(),
  creatorRole: text("creator_role").notNull(),
  targetType: text("target_type").notNull(),
  targetClass: varchar("target_class", { length: 50 }),
  targetSection: varchar("target_section", { length: 100 }),
  noticeType: varchar("notice_type", { length: 30 }).default("Routine"),
  content: text("content").notNull(),
  fileUrl: text("file_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const complaints = pgTable("complaints", {
  id: serial("id").primaryKey(),
  ticketId: varchar("ticket_id", { length: 30 }).notNull(),
  teacherId: integer("teacher_id").notNull().references(() => teachers.id, { onDelete: "cascade" }),
  studentId: integer("student_id").references(() => students.id, { onDelete: "cascade" }),
  schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
  complaintType: varchar("complaint_type", { length: 30 }).notNull().default("teacher-to-student"),
  status: varchar("status", { length: 20 }).notNull().default("Pending"),
  content: text("content").notNull(),
  reportedStudentName: varchar("reported_student_name", { length: 100 }),
  fileUrl: text("file_url"),
  isDeleted: boolean("is_deleted").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const complaintNotes = pgTable("complaint_notes", {
  id: serial("id").primaryKey(),
  complaintId: integer("complaint_id").notNull().references(() => complaints.id, { onDelete: "cascade" }),
  authorId: integer("author_id").notNull(),
  authorRole: varchar("author_role", { length: 20 }).notNull(),
  authorName: varchar("author_name", { length: 100 }).notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const examScores = pgTable("exam_scores", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  teacherId: integer("teacher_id").notNull().references(() => teachers.id, { onDelete: "cascade" }),
  schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
  subject: text("subject").notNull(),
  examType: text("exam_type").notNull(),
  marks: integer("marks").notNull(),
  totalMarks: integer("total_marks").notNull().default(100),
  isAbsent: boolean("is_absent").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const galleryItems = pgTable("gallery_items", {
  id: serial("id").primaryKey(),
  schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
  uploadedById: integer("uploaded_by_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  eventTag: text("event_tag"),
  imageUrl: text("image_url").notNull(),
  approved: boolean("approved").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const calendarEvents = pgTable("calendar_events", {
  id: serial("id").primaryKey(),
  schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  date: date("date").notNull(),
  eventType: text("event_type").notNull(),
});

export const libraryBooks = pgTable("library_books", {
  id: serial("id").primaryKey(),
  schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  author: text("author").notNull(),
  isbn: varchar("isbn", { length: 20 }),
  targetClass: text("target_class"),
  category: text("category"),
  fileUrl: text("file_url"),
  fileType: text("file_type"),
  uploadedById: integer("uploaded_by_id"),
  verificationStatus: text("verification_status").notNull().default("approved"),
  totalCopies: integer("total_copies").notNull().default(1),
  availableCopies: integer("available_copies").notNull().default(1),
});

export const bookBorrows = pgTable("book_borrows", {
  id: serial("id").primaryKey(),
  bookId: integer("book_id").notNull().references(() => libraryBooks.id, { onDelete: "cascade" }),
  borrowerId: integer("borrower_id").notNull(),
  borrowerType: text("borrower_type").notNull(),
  schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
  borrowedAt: timestamp("borrowed_at").notNull().defaultNow(),
  returnedAt: timestamp("returned_at"),
});

export const leaveRequests = pgTable("leave_requests", {
  id: serial("id").primaryKey(),
  teacherId: integer("teacher_id").notNull().references(() => teachers.id, { onDelete: "cascade" }),
  schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
  leaveType: text("leave_type").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("pending"),
  approvedBy: integer("approved_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const schoolMetadata = pgTable("school_metadata", {
  id: serial("id").primaryKey(),
  schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
  metaKey: varchar("meta_key", { length: 50 }).notNull(),
  metaValue: text("meta_value").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("school_metadata_unique").on(table.schoolId, table.metaKey),
]);

export const timetableEntries = pgTable("timetable_entries", {
  id: serial("id").primaryKey(),
  teacherId: integer("teacher_id").notNull().references(() => teachers.id, { onDelete: "cascade" }),
  schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
  dayOfWeek: integer("day_of_week").notNull(),
  period: integer("period").notNull(),
  class: varchar("class", { length: 20 }).notNull(),
  section: varchar("section", { length: 10 }).notNull(),
  subject: text("subject").notNull(),
});

export const studentLeaveRequests = pgTable("student_leave_requests", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("pending"),
  reviewedBy: integer("reviewed_by"),
  reviewerRole: text("reviewer_role"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  schoolId: integer("school_id").notNull(),
  actionType: text("action_type").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  actionBy: integer("action_by").notNull(),
  actionByRole: text("action_by_role").notNull(),
  details: text("details"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const visitorLogs = pgTable("visitor_logs", {
  id: serial("id").primaryKey(),
  schoolId: integer("school_id").notNull(),
  visitorName: text("visitor_name").notNull(),
  purpose: text("purpose").notNull(),
  hostName: text("host_name").notNull(),
  phone: text("phone"),
  checkIn: timestamp("check_in").notNull().defaultNow(),
  checkOut: timestamp("check_out"),
  badge: text("badge"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const schoolsRelations = relations(schools, ({ many }) => ({
  students: many(students),
  users: many(users),
  teachers: many(teachers),
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

export const teachersRelations = relations(teachers, ({ one, many }) => ({
  user: one(users, { fields: [teachers.userId], references: [users.id] }),
  school: one(schools, { fields: [teachers.schoolId], references: [schools.id] }),
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

export const insertTeacherSchema = createInsertSchema(teachers).omit({ id: true });
export type InsertTeacher = z.infer<typeof insertTeacherSchema>;
export type Teacher = typeof teachers.$inferSelect;

export const insertAttendanceSchema = createInsertSchema(attendanceRecords).omit({ id: true });
export type InsertAttendance = z.infer<typeof insertAttendanceSchema>;
export type AttendanceRecord = typeof attendanceRecords.$inferSelect;

export const insertHomeworkSchema = createInsertSchema(homework).omit({ id: true, createdAt: true });
export type InsertHomework = z.infer<typeof insertHomeworkSchema>;
export type Homework = typeof homework.$inferSelect;

export const insertHomeworkViewSchema = createInsertSchema(homeworkViews).omit({ id: true, viewedAt: true });
export type InsertHomeworkView = z.infer<typeof insertHomeworkViewSchema>;
export type HomeworkView = typeof homeworkViews.$inferSelect;

export const insertClassworkSchema = createInsertSchema(classwork).omit({ id: true, createdAt: true });
export type InsertClasswork = z.infer<typeof insertClassworkSchema>;
export type Classwork = typeof classwork.$inferSelect;

export const insertNoticeSchema = createInsertSchema(notices).omit({ id: true, createdAt: true });
export type InsertNotice = z.infer<typeof insertNoticeSchema>;
export type Notice = typeof notices.$inferSelect;

export const insertComplaintSchema = createInsertSchema(complaints).omit({ id: true, createdAt: true });
export type InsertComplaint = z.infer<typeof insertComplaintSchema>;
export type Complaint = typeof complaints.$inferSelect;

export const insertComplaintNoteSchema = createInsertSchema(complaintNotes).omit({ id: true, createdAt: true });
export type InsertComplaintNote = z.infer<typeof insertComplaintNoteSchema>;
export type ComplaintNote = typeof complaintNotes.$inferSelect;

export const insertExamScoreSchema = createInsertSchema(examScores).omit({ id: true, createdAt: true });
export type InsertExamScore = z.infer<typeof insertExamScoreSchema>;
export type ExamScore = typeof examScores.$inferSelect;

export const insertGalleryItemSchema = createInsertSchema(galleryItems).omit({ id: true, createdAt: true });
export type InsertGalleryItem = z.infer<typeof insertGalleryItemSchema>;
export type GalleryItem = typeof galleryItems.$inferSelect;

export const insertCalendarEventSchema = createInsertSchema(calendarEvents).omit({ id: true });
export type InsertCalendarEvent = z.infer<typeof insertCalendarEventSchema>;
export type CalendarEvent = typeof calendarEvents.$inferSelect;

export const insertLibraryBookSchema = createInsertSchema(libraryBooks).omit({ id: true });
export type InsertLibraryBook = z.infer<typeof insertLibraryBookSchema>;
export type LibraryBook = typeof libraryBooks.$inferSelect;

export const insertBookBorrowSchema = createInsertSchema(bookBorrows).omit({ id: true });
export type InsertBookBorrow = z.infer<typeof insertBookBorrowSchema>;
export type BookBorrow = typeof bookBorrows.$inferSelect;

export const insertLeaveRequestSchema = createInsertSchema(leaveRequests).omit({ id: true, createdAt: true });
export type InsertLeaveRequest = z.infer<typeof insertLeaveRequestSchema>;
export type LeaveRequest = typeof leaveRequests.$inferSelect;

export const insertTimetableEntrySchema = createInsertSchema(timetableEntries).omit({ id: true });
export type InsertTimetableEntry = z.infer<typeof insertTimetableEntrySchema>;
export type TimetableEntry = typeof timetableEntries.$inferSelect;

export const insertSchoolMetadataSchema = createInsertSchema(schoolMetadata).omit({ id: true, updatedAt: true });
export type InsertSchoolMetadata = z.infer<typeof insertSchoolMetadataSchema>;
export type SchoolMetadata = typeof schoolMetadata.$inferSelect;

export const insertStudentLeaveRequestSchema = createInsertSchema(studentLeaveRequests).omit({ id: true, createdAt: true });
export type InsertStudentLeaveRequest = z.infer<typeof insertStudentLeaveRequestSchema>;
export type StudentLeaveRequest = typeof studentLeaveRequests.$inferSelect;

export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({ id: true, createdAt: true });
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;

export const insertVisitorLogSchema = createInsertSchema(visitorLogs).omit({ id: true, createdAt: true, checkIn: true });
export type InsertVisitorLog = z.infer<typeof insertVisitorLogSchema>;
export type VisitorLog = typeof visitorLogs.$inferSelect;
