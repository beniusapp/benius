import { relations } from "drizzle-orm";
import { pgTable, text, varchar, serial, integer, boolean, date, timestamp, uniqueIndex, jsonb } from "drizzle-orm/pg-core";
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
  pinHash: text("pin_hash"),
  recoveryEmail: text("recovery_email"),
  recoveryPhone: varchar("recovery_phone", { length: 20 }),
  isInitialized: boolean("is_initialized").notNull().default(false),
  otpCode: varchar("otp_code", { length: 10 }),
  otpExpiresAt: timestamp("otp_expires_at"),
  resetToken: text("reset_token"),
  resetTokenExpiresAt: timestamp("reset_token_expires_at"),
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
  enrollmentDate: date("enrollment_date"),
  verifiedProfile: text("verified_profile"),
  gender: varchar("gender", { length: 10 }),
  rollNumber: integer("roll_number"),
  guardianName: text("guardian_name"),
  idCardPendingReissue: boolean("id_card_pending_reissue").notNull().default(false),
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
  profileImageUrl: text("profile_image_url"),
  designation: text("designation"),
  qualifications: text("qualifications"),
  department: text("department"),
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
  class: varchar("class", { length: 20 }),
  section: varchar("section", { length: 10 }),
  academicYear: varchar("academic_year", { length: 20 }),
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
  sessionId: integer("session_id").references(() => academicSessions.id),
});

export const homeworkViews = pgTable("homework_views", {
  id: serial("id").primaryKey(),
  homeworkId: integer("homework_id").notNull().references(() => homework.id, { onDelete: "cascade" }),
  studentId: integer("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  viewedAt: timestamp("viewed_at").notNull().defaultNow(),
});

export const homeworkSubmissions = pgTable("homework_submissions", {
  id: serial("id").primaryKey(),
  homeworkId: integer("homework_id").notNull().references(() => homework.id, { onDelete: "cascade" }),
  studentId: integer("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
  fileUrl: text("file_url"),
  textAnswer: text("text_answer"),
  status: text("status").notNull().default("submitted"),
  submittedAt: timestamp("submitted_at").notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at"),
  reviewedBy: integer("reviewed_by"),
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
  sessionId: integer("session_id").references(() => academicSessions.id),
});

export const notices = pgTable("notices", {
  id: serial("id").primaryKey(),
  schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
  createdById: integer("created_by_id").notNull(),
  creatorRole: text("creator_role").notNull(),
  targetType: text("target_type").notNull(),
  targetClass: varchar("target_class", { length: 50 }),
  targetSection: varchar("target_section", { length: 100 }),
  targetTeacherId: integer("target_teacher_id").references(() => teachers.id, { onDelete: "set null" }),
  noticeType: varchar("notice_type", { length: 30 }).default("Routine"),
  content: text("content").notNull(),
  fileUrl: text("file_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const noticeReads = pgTable("notice_reads", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  noticeId: integer("notice_id").notNull().references(() => notices.id, { onDelete: "cascade" }),
  readAt: timestamp("read_at").notNull().defaultNow(),
});

export const insertNoticeReadSchema = createInsertSchema(noticeReads).omit({ id: true, readAt: true });
export type InsertNoticeRead = z.infer<typeof insertNoticeReadSchema>;
export type NoticeRead = typeof noticeReads.$inferSelect;

export const complaints = pgTable("complaints", {
  id: serial("id").primaryKey(),
  ticketId: varchar("ticket_id", { length: 30 }).notNull(),
  teacherId: integer("teacher_id").references(() => teachers.id, { onDelete: "cascade" }),
  studentId: integer("student_id").references(() => students.id, { onDelete: "cascade" }),
  schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
  complaintType: varchar("complaint_type", { length: 30 }).notNull().default("teacher-to-student"),
  status: varchar("status", { length: 20 }).notNull().default("Pending"),
  content: text("content").notNull(),
  reportedStudentName: varchar("reported_student_name", { length: 100 }),
  fileUrl: text("file_url"),
  isDeleted: boolean("is_deleted").notNull().default(false),
  complainantStudentId: integer("complainant_student_id").references(() => students.id, { onDelete: "cascade" }),
  contactNumber: text("contact_number"),
  suggestions: text("suggestions"),
  incidentDate: timestamp("incident_date"),
  complainantClass: varchar("complainant_class", { length: 20 }),
  complainantSection: varchar("complainant_section", { length: 10 }),
  resolutionRemarks: text("resolution_remarks"),
  escalatedToPrincipal: boolean("escalated_to_principal").notNull().default(false),
  notifyAdmin: boolean("notify_admin").notNull().default(false),
  batchId: varchar("batch_id", { length: 50 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
  deletedAt: timestamp("deleted_at"),
  deletedBy: integer("deleted_by"),
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

export const complaintStudents = pgTable("complaint_students", {
  id: serial("id").primaryKey(),
  complaintId: integer("complaint_id").notNull().references(() => complaints.id, { onDelete: "cascade" }),
  studentId: integer("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
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
  passMarks: integer("pass_marks").notNull().default(33),
  isAbsent: boolean("is_absent").notNull().default(false),
  class: text("class"),
  section: text("section"),
  published: boolean("published").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at"),
  sessionId: integer("session_id").references(() => academicSessions.id),
});

export const promotionDecisions = pgTable("promotion_decisions", {
  id: serial("id").primaryKey(),
  schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
  class: text("class").notNull(),
  section: text("section").notNull(),
  term: text("term").notNull(),
  studentId: integer("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  decision: text("decision").notNull().default("promoted"),
  targetClass: text("target_class").notNull(),
  targetSection: text("target_section").notNull(),
  editCount: integer("edit_count").notNull().default(0),
  processedByTeacherId: integer("processed_by_teacher_id").references(() => teachers.id),
  locked: boolean("locked").notNull().default(false),
  lockedAt: timestamp("locked_at"),
  autoSuggestion: text("auto_suggestion"),
  manualIntervention: boolean("manual_intervention").notNull().default(false),
  adminExecuted: boolean("admin_executed").notNull().default(false),
  adminExecutedAt: timestamp("admin_executed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at"),
  sessionId: integer("session_id").references(() => academicSessions.id),
});
export type PromotionDecision = typeof promotionDecisions.$inferSelect;

export const galleryItems = pgTable("gallery_items", {
  id: serial("id").primaryKey(),
  schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
  uploadedById: integer("uploaded_by_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  eventTag: text("event_tag"),
  capturedDate: text("captured_date"),
  capturedTime: text("captured_time"),
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
  venue: text("venue"),
  description: text("description"),
  colorCode: text("color_code"),
  isRecurring: boolean("is_recurring").notNull().default(false),
  audienceScope: varchar("audience_scope", { length: 30 }).notNull().default("All_School"),
  targetClass: text("target_class"),
  targetSection: text("target_section"),
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
  policyId: integer("policy_id").references(() => leavePolicies.id, { onDelete: "set null" }),
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
  startTime: text("start_time"),
  endTime: text("end_time"),
  status: text("status").notNull().default("draft"),
  room: text("room"),
}, (table) => [
  uniqueIndex("timetable_class_slot_unique").on(table.schoolId, table.class, table.section, table.dayOfWeek, table.period),
]);

export const teacherAllocations = pgTable("teacher_allocations", {
  id: serial("id").primaryKey(),
  schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
  teacherId: integer("teacher_id").notNull().references(() => teachers.id, { onDelete: "cascade" }),
  subject: text("subject").notNull(),
  class: varchar("class", { length: 20 }).notNull(),
  section: varchar("section", { length: 10 }).notNull(),
  weeklyQuota: integer("weekly_quota").notNull().default(6),
});

export const studentLeaveRequests = pgTable("student_leave_requests", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("pending_teacher"),
  reviewedBy: integer("reviewed_by"),
  reviewerRole: text("reviewer_role"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  category: text("category"),
  attachmentUrl: text("attachment_url"),
  rejectionReason: text("rejection_reason"),
  adminComment: text("admin_comment"),
  teacherComment: text("teacher_comment"),
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

export const studentProfiles = pgTable("student_profiles", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").notNull().references(() => students.id, { onDelete: "cascade" }).unique(),
  schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
  status: varchar("status", { length: 20 }).notNull().default("draft"),
  fullName: text("full_name"),
  class: varchar("class", { length: 20 }),
  section: varchar("section", { length: 10 }),
  rollNo: varchar("roll_no", { length: 20 }),
  fatherName: text("father_name"),
  motherName: text("mother_name"),
  presentAddress: text("present_address"),
  photoUrl: text("photo_url"),
  photoStatus: varchar("photo_status", { length: 20 }).notNull().default("none"),
  rejectionNote: text("rejection_note"),
  approvedSnapshot: text("approved_snapshot"),
  submittedAt: timestamp("submitted_at"),
  verifiedAt: timestamp("verified_at"),
  verifiedBy: integer("verified_by"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
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

export const securityAudit = pgTable("security_audit", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
  schoolId: integer("school_id"),
  action: varchar("action", { length: 50 }).notNull(),
  success: boolean("success").notNull().default(true),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertSecurityAuditSchema = createInsertSchema(securityAudit).omit({ id: true, createdAt: true });
export type InsertSecurityAudit = z.infer<typeof insertSecurityAuditSchema>;
export type SecurityAudit = typeof securityAudit.$inferSelect;

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

export const insertComplaintStudentSchema = createInsertSchema(complaintStudents).omit({ id: true });
export type InsertComplaintStudent = z.infer<typeof insertComplaintStudentSchema>;
export type ComplaintStudent = typeof complaintStudents.$inferSelect;

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

export const insertTeacherAllocationSchema = createInsertSchema(teacherAllocations).omit({ id: true });
export type InsertTeacherAllocation = z.infer<typeof insertTeacherAllocationSchema>;
export type TeacherAllocation = typeof teacherAllocations.$inferSelect;

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

export const insertStudentProfileSchema = createInsertSchema(studentProfiles).omit({ id: true, updatedAt: true });
export type InsertStudentProfile = z.infer<typeof insertStudentProfileSchema>;
export type StudentProfile = typeof studentProfiles.$inferSelect;

export const feeRecords = pgTable("fee_records", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
  feeType: varchar("fee_type", { length: 100 }).notNull(),
  amount: integer("amount").notNull(),
  dueDate: date("due_date").notNull(),
  paidDate: date("paid_date"),
  status: varchar("status", { length: 20 }).notNull().default("Due"),
  receiptNumber: varchar("receipt_number", { length: 50 }),
  notes: text("notes"),
  academicYear: varchar("academic_year", { length: 20 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
});

export const insertFeeRecordSchema = createInsertSchema(feeRecords).omit({ id: true, createdAt: true });
export type InsertFeeRecord = z.infer<typeof insertFeeRecordSchema>;
export type FeeRecord = typeof feeRecords.$inferSelect;

export const insertHomeworkSubmissionSchema = createInsertSchema(homeworkSubmissions).omit({ id: true, submittedAt: true });
export type InsertHomeworkSubmission = z.infer<typeof insertHomeworkSubmissionSchema>;
export type HomeworkSubmission = typeof homeworkSubmissions.$inferSelect;

export const promotionOverrides = pgTable("promotion_overrides", {
  id: serial("id").primaryKey(),
  schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
  studentId: integer("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  examType: text("exam_type").notNull(),
  class: text("class").notNull(),
  section: text("section").notNull(),
  overrideStatus: text("override_status").notNull(),
  nextClass: text("next_class").notNull(),
  nextSection: text("next_section").notNull(),
  overriddenAt: timestamp("overridden_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("promotion_override_unique").on(table.schoolId, table.studentId, table.examType, table.class, table.section),
]);

export const insertPromotionOverrideSchema = createInsertSchema(promotionOverrides).omit({ id: true, overriddenAt: true });
export type InsertPromotionOverride = z.infer<typeof insertPromotionOverrideSchema>;
export type PromotionOverride = typeof promotionOverrides.$inferSelect;

export const gradingTiers = pgTable("grading_tiers", {
  id: serial("id").primaryKey(),
  schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  classes: text("classes").array().notNull().default([]),
  passPercentage: integer("pass_percentage").notNull().default(35),
  gradingSystem: text("grading_system").notNull().default("percentage"),
  passingGrades: text("passing_grades").array().notNull().default([]),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const insertGradingTierSchema = createInsertSchema(gradingTiers).omit({ id: true });
export type InsertGradingTier = z.infer<typeof insertGradingTierSchema>;
export type GradingTier = typeof gradingTiers.$inferSelect;

export const gradingRules = pgTable("grading_rules", {
  id: serial("id").primaryKey(),
  tierId: integer("tier_id").notNull().references(() => gradingTiers.id, { onDelete: "cascade" }),
  schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
  gradeLabel: text("grade_label").notNull(),
  minPercent: integer("min_percent").notNull(),
  maxPercent: integer("max_percent").notNull(),
  gradePoint: text("grade_point").notNull().default(""),
  remarks: text("remarks").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const insertGradingRuleSchema = createInsertSchema(gradingRules).omit({ id: true });
export type InsertGradingRule = z.infer<typeof insertGradingRuleSchema>;
export type GradingRule = typeof gradingRules.$inferSelect;

export const schoolAssets = pgTable("school_assets", {
  id: serial("id").primaryKey(),
  schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
  assetCode: varchar("asset_code", { length: 20 }).notNull().default(""),
  name: text("name").notNull(),
  category: text("category").notNull(),
  quantity: integer("quantity").notNull().default(0),
  condition: text("condition").notNull().default("Good"),
  location: text("location").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertSchoolAssetSchema = createInsertSchema(schoolAssets).omit({ id: true, assetCode: true, createdAt: true, updatedAt: true });
export type InsertSchoolAsset = z.infer<typeof insertSchoolAssetSchema>;
export type SchoolAsset = typeof schoolAssets.$inferSelect;

export const assetLogs = pgTable("asset_logs", {
  id: serial("id").primaryKey(),
  schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
  assetId: integer("asset_id").notNull(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  snapshot: text("snapshot"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertAssetLogSchema = createInsertSchema(assetLogs).omit({ id: true, createdAt: true });
export type InsertAssetLog = z.infer<typeof insertAssetLogSchema>;
export type AssetLog = typeof assetLogs.$inferSelect;

export const academicHistory = pgTable("academic_history", {
  id: serial("id").primaryKey(),
  schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
  studentId: integer("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  fromClass: text("from_class").notNull(),
  fromSection: text("from_section").notNull(),
  toClass: text("to_class").notNull(),
  toSection: text("to_section").notNull(),
  examType: text("exam_type").notNull(),
  totalObtained: integer("total_obtained").notNull(),
  totalMax: integer("total_max").notNull(),
  percentage: integer("percentage").notNull(),
  gradeLabel: text("grade_label"),
  gradePoint: text("grade_point"),
  remarks: text("remarks"),
  snapshotJson: jsonb("snapshot_json"),
  archivedAt: timestamp("archived_at").notNull().defaultNow(),
});

export const insertAcademicHistorySchema = createInsertSchema(academicHistory).omit({ id: true, archivedAt: true });
export type InsertAcademicHistory = z.infer<typeof insertAcademicHistorySchema>;
export type AcademicHistory = typeof academicHistory.$inferSelect;

export const verificationLogs = pgTable("verification_logs", {
  id: serial("id").primaryKey(),
  schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
  studentId: integer("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  submittedAt: timestamp("submitted_at").notNull().defaultNow(),
});

export const insertVerificationLogSchema = createInsertSchema(verificationLogs).omit({ id: true, submittedAt: true });
export type InsertVerificationLog = z.infer<typeof insertVerificationLogSchema>;
export type VerificationLog = typeof verificationLogs.$inferSelect;

export const timetableStructure = pgTable("timetable_structure", {
  id: serial("id").primaryKey(),
  schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
  class: varchar("class", { length: 20 }).notNull(),
  periodNumber: integer("period_number").notNull(),
  label: text("label").notNull().default(""),
  startTime: text("start_time").notNull().default(""),
  endTime: text("end_time").notNull().default(""),
  isBreak: boolean("is_break").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const insertTimetableStructureSchema = createInsertSchema(timetableStructure).omit({ id: true });
export type InsertTimetableStructure = z.infer<typeof insertTimetableStructureSchema>;
export type TimetableStructure = typeof timetableStructure.$inferSelect;

export const nonTeachingStaff = pgTable("non_teaching_staff", {
  id: serial("id").primaryKey(),
  schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
  fullName: text("full_name").notNull(),
  email: text("email").notNull().default(""),
  phone: varchar("phone", { length: 20 }).notNull().default(""),
  designation: text("designation").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertNonTeachingStaffSchema = createInsertSchema(nonTeachingStaff).omit({ id: true, createdAt: true });
export type InsertNonTeachingStaff = z.infer<typeof insertNonTeachingStaffSchema>;
export type NonTeachingStaff = typeof nonTeachingStaff.$inferSelect;

export const facultyMappings = pgTable("faculty_mappings", {
  id: serial("id").primaryKey(),
  teacherId: integer("teacher_id").notNull().references(() => teachers.id, { onDelete: "cascade" }),
  schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
  className: varchar("class_name", { length: 20 }).notNull(),
  section: varchar("section", { length: 10 }).notNull(),
  subject: text("subject"),
});

export const insertFacultyMappingSchema = createInsertSchema(facultyMappings).omit({ id: true });
export type InsertFacultyMapping = z.infer<typeof insertFacultyMappingSchema>;
export type FacultyMapping = typeof facultyMappings.$inferSelect;

export const leavePolicies = pgTable("leave_policies", {
  id: serial("id").primaryKey(),
  schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  annualLimit: integer("annual_limit").notNull().default(12),
  targetRoles: text("target_roles").notNull().default("all"),
  renewalMonth: integer("renewal_month").notNull().default(1),
  renewalDay: integer("renewal_day").notNull().default(1),
  expiryBehavior: text("expiry_behavior").notNull().default("expire"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertLeavePolicySchema = createInsertSchema(leavePolicies).omit({ id: true, createdAt: true });
export type InsertLeavePolicy = z.infer<typeof insertLeavePolicySchema>;
export type LeavePolicy = typeof leavePolicies.$inferSelect;

export const examPolicyTiers = pgTable("exam_policy_tiers", {
  id: serial("id").primaryKey(),
  schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
  tierName: text("tier_name").notNull(),
  applicableClasses: text("applicable_classes").array().notNull().default([]),
  examWeights: text("exam_weights").notNull().default("{}"),
  promotionFailRules: text("promotion_fail_rules").notNull().default("{}"),
  resultsConfig: text("results_config").notNull().default("{}"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertExamPolicyTierSchema = createInsertSchema(examPolicyTiers).omit({ id: true, createdAt: true });
export type InsertExamPolicyTier = z.infer<typeof insertExamPolicyTierSchema>;
export type ExamPolicyTier = typeof examPolicyTiers.$inferSelect;

// ── TEACHER SELF ATTENDANCE ──────────────────────────────────────────────────
export const teacherSelfAttendance = pgTable("teacher_self_attendance", {
  id: serial("id").primaryKey(),
  teacherId: integer("teacher_id").notNull().references(() => teachers.id, { onDelete: "cascade" }),
  schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
  attendanceDate: text("attendance_date").notNull(),
  checkInTime: timestamp("check_in_time"),
  checkOutTime: timestamp("check_out_time"),
  status: text("status").notNull().default("Not Marked"),
  totalWorkingMinutes: integer("total_working_minutes").notNull().default(0),
  locationVerified: boolean("location_verified").notNull().default(false),
  latitude: text("latitude"),
  longitude: text("longitude"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("uq_teacher_self_attendance").on(t.teacherId, t.attendanceDate)]);

export const insertTeacherSelfAttendanceSchema = createInsertSchema(teacherSelfAttendance).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTeacherSelfAttendance = z.infer<typeof insertTeacherSelfAttendanceSchema>;
export type TeacherSelfAttendance = typeof teacherSelfAttendance.$inferSelect;

// ── ATTENDANCE CORRECTION REQUESTS ───────────────────────────────────────────
export const attendanceCorrectionRequests = pgTable("attendance_correction_requests", {
  id: serial("id").primaryKey(),
  teacherId: integer("teacher_id").notNull().references(() => teachers.id, { onDelete: "cascade" }),
  schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
  attendanceDate: text("attendance_date").notNull(),
  requestedCheckIn: text("requested_check_in").notNull(),
  requestedCheckOut: text("requested_check_out").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("Pending"),
  reviewedBy: integer("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertAttendanceCorrectionSchema = createInsertSchema(attendanceCorrectionRequests).omit({ id: true, createdAt: true, reviewedAt: true, reviewedBy: true });
export type InsertAttendanceCorrection = z.infer<typeof insertAttendanceCorrectionSchema>;
export type AttendanceCorrectionRequest = typeof attendanceCorrectionRequests.$inferSelect;

// ── ATTENDANCE POLICY ENGINE ──────────────────────────────────────────────────
export const attendancePolicies = pgTable("attendance_policies", {
  id: serial("id").primaryKey(),
  schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
  targetRole: varchar("target_role", { length: 20 }).notNull(), // "TEACHER" | "STUDENT"
  policyName: text("policy_name").notNull(),
  applicableClasses: text("applicable_classes").array().notNull().default([]),
  expectedArrivalTime: varchar("expected_arrival_time", { length: 5 }).notNull().default("09:00"),
  gracePeriodMinutes: integer("grace_period_minutes").notNull().default(0),
  halfDayCutoffTime: varchar("half_day_cutoff_time", { length: 5 }).notNull().default("12:00"),
  schoolEndTime: varchar("school_end_time", { length: 5 }).notNull().default("17:00"),
  attendanceTarget: integer("attendance_target").notNull().default(85),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertAttendancePolicySchema = createInsertSchema(attendancePolicies).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAttendancePolicy = z.infer<typeof insertAttendancePolicySchema>;
export type AttendancePolicy = typeof attendancePolicies.$inferSelect;

// ── ACADEMIC SESSIONS ─────────────────────────────────────────────────────────
// One school (tenant) can have many sessions (e.g. 2025-2026, 2026-2027).
// Only one session per school may have isActive = true at any time;
// the activation route enforces this via a DB transaction.
export const academicSessions = pgTable("academic_sessions", {
  id: serial("id").primaryKey(),
  schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
  sessionName: varchar("session_name", { length: 50 }).notNull(), // e.g. "2026-2027"
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  isActive: boolean("is_active").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAcademicSessionSchema = createInsertSchema(academicSessions).omit({ id: true, createdAt: true });
export type InsertAcademicSession = z.infer<typeof insertAcademicSessionSchema>;
export type AcademicSession = typeof academicSessions.$inferSelect;

// ── ENROLLMENTS ───────────────────────────────────────────────────────────────
// Links a student to an academic session with their class/section for that year.
// Unique constraint on (schoolId, studentId, sessionId) prevents double-enrollment
// in the same session. Created automatically on student add (active session is used).
export const enrollments = pgTable("enrollments", {
  id: serial("id").primaryKey(),
  schoolId: integer("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
  studentId: integer("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  sessionId: integer("session_id").notNull().references(() => academicSessions.id, { onDelete: "cascade" }),
  className: varchar("class_name", { length: 20 }).notNull(),
  sectionName: varchar("section_name", { length: 10 }).notNull(),
  rollNo: integer("roll_no"),
  status: varchar("status", { length: 20 }).notNull().default("Active"),
}, (table) => ({
  uniqueStudentSession: uniqueIndex("enrollments_student_session_uidx").on(
    table.schoolId, table.studentId, table.sessionId,
  ),
}));

export const insertEnrollmentSchema = createInsertSchema(enrollments).omit({ id: true });
export type InsertEnrollment = z.infer<typeof insertEnrollmentSchema>;
export type Enrollment = typeof enrollments.$inferSelect;
