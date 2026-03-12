import {
  schools, students, users, teachers,
  attendanceRecords, homework, homeworkViews, classwork, notices,
  complaints, complaintNotes, examScores, galleryItems, calendarEvents,
  libraryBooks, bookBorrows, leaveRequests, timetableEntries, schoolMetadata,
  studentLeaveRequests, auditLogs, visitorLogs,
  type School, type InsertSchool, type Student, type InsertStudent,
  type User, type InsertUser, type Teacher, type InsertTeacher,
  type AttendanceRecord, type InsertAttendance,
  type Homework, type InsertHomework, type HomeworkView, type Classwork, type InsertClasswork,
  type Notice, type InsertNotice, type Complaint, type InsertComplaint,
  type ComplaintNote, type InsertComplaintNote,
  type ExamScore, type InsertExamScore, type GalleryItem, type InsertGalleryItem,
  type CalendarEvent, type InsertCalendarEvent, type LibraryBook, type InsertLibraryBook,
  type BookBorrow, type InsertBookBorrow, type LeaveRequest, type InsertLeaveRequest,
  type TimetableEntry, type InsertTimetableEntry,
  type SchoolMetadata,
  type StudentLeaveRequest, type InsertStudentLeaveRequest,
  type AuditLog, type InsertAuditLog,
  type VisitorLog, type InsertVisitorLog,
} from "@shared/schema";
import { db } from "./db";
import { pool } from "./db";
import { eq, sql, like, count, and, desc, gte, lte, or, ilike, isNull } from "drizzle-orm";

export class DatabaseStorage {
  async getSchools(): Promise<School[]> {
    return await db.select().from(schools);
  }

  async getSchool(id: number): Promise<School | undefined> {
    const [school] = await db.select().from(schools).where(eq(schools.id, id));
    return school || undefined;
  }

  async getSchoolByCode(code: string): Promise<School | undefined> {
    const [school] = await db.select().from(schools).where(eq(schools.code, code));
    return school || undefined;
  }

  async createSchoolWithPrincipal(insertSchool: InsertSchool, email: string, passwordHash: string): Promise<School> {
    return await db.transaction(async (tx) => {
      const [school] = await tx.insert(schools).values(insertSchool).returning();
      await tx.insert(users).values({
        email,
        passwordHash,
        role: "admin",
        schoolId: school.id,
      });
      return school;
    });
  }

  async deleteSchool(id: number): Promise<boolean> {
    const result = await db.delete(schools).where(eq(schools.id, id)).returning();
    return result.length > 0;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user || undefined;
  }

  async getUserWithSchool(userId: number): Promise<{ user: User; school: School } | undefined> {
    const result = await db
      .select()
      .from(users)
      .innerJoin(schools, eq(users.schoolId, schools.id))
      .where(eq(users.id, userId));
    if (result.length === 0) return undefined;
    return { user: result[0].users, school: result[0].schools };
  }

  async getStudentsBySchool(schoolId: number): Promise<Student[]> {
    return await db.select().from(students).where(eq(students.schoolId, schoolId));
  }

  async getStudentsByClassSection(schoolId: number, cls: string, section: string): Promise<Student[]> {
    return await db.select().from(students).where(
      and(eq(students.schoolId, schoolId), eq(students.class, cls), eq(students.section, section))
    );
  }

  async getStudentCountBySchool(schoolId: number): Promise<number> {
    const [result] = await db
      .select({ value: count() })
      .from(students)
      .where(eq(students.schoolId, schoolId));
    return result?.value ?? 0;
  }

  async getMaxDsidSerialForSchool(schoolCode: string): Promise<number> {
    const prefix = `${schoolCode}-`;
    const rows = await db
      .select({ digitalStudentId: students.digitalStudentId })
      .from(students)
      .where(like(students.digitalStudentId, `${prefix}%`));
    let max = 0;
    for (const row of rows) {
      const suffix = row.digitalStudentId.replace(prefix, "");
      const num = parseInt(suffix, 10);
      if (!isNaN(num) && num > max) max = num;
    }
    return max;
  }

  async bulkCreateStudents(studentRecords: InsertStudent[]): Promise<Student[]> {
    if (studentRecords.length === 0) return [];
    return await db.transaction(async (tx) => {
      return await tx.insert(students).values(studentRecords).returning();
    });
  }

  async createStudent(insertStudent: InsertStudent): Promise<Student> {
    const [student] = await db.insert(students).values(insertStudent).returning();
    return student;
  }

  async getStudentById(id: number): Promise<Student | undefined> {
    const [student] = await db.select().from(students).where(eq(students.id, id));
    return student || undefined;
  }

  async getStudentByDsid(dsid: string): Promise<Student | undefined> {
    const [student] = await db.select().from(students).where(eq(students.digitalStudentId, dsid));
    return student || undefined;
  }

  async getStudentByDsidPhoneDob(dsid: string, phone: string, dob: string): Promise<Student | undefined> {
    const [student] = await db.select().from(students).where(
      and(eq(students.digitalStudentId, dsid), eq(students.phone, phone), eq(students.dob, dob))
    );
    return student || undefined;
  }

  async activateStudent(studentId: number, passwordHash: string): Promise<Student> {
    const [student] = await db.update(students).set({ passwordHash, isActivated: true }).where(eq(students.id, studentId)).returning();
    return student;
  }

  async getStudentWithSchool(studentId: number): Promise<{ student: Student; school: School } | undefined> {
    const result = await db.select().from(students)
      .innerJoin(schools, eq(students.schoolId, schools.id))
      .where(eq(students.id, studentId));
    if (result.length === 0) return undefined;
    return { student: result[0].students, school: result[0].schools };
  }

  // ===== TEACHER METHODS =====
  async createTeacher(teacherData: Omit<InsertTeacher, 'userId'>, email: string, passwordHash: string): Promise<Teacher> {
    return await db.transaction(async (tx) => {
      const [user] = await tx.insert(users).values({
        email,
        passwordHash,
        role: "teacher",
        schoolId: teacherData.schoolId,
      }).returning();
      const [teacher] = await tx.insert(teachers).values({
        ...teacherData,
        userId: user.id,
      }).returning();
      return teacher;
    });
  }

  async getTeachersBySchool(schoolId: number): Promise<(Teacher & { email: string })[]> {
    const result = await db.select().from(teachers)
      .innerJoin(users, eq(teachers.userId, users.id))
      .where(eq(teachers.schoolId, schoolId));
    return result.map(r => ({ ...r.teachers, email: r.users.email }));
  }

  async getTeacherByUserId(userId: number): Promise<Teacher | undefined> {
    const [teacher] = await db.select().from(teachers).where(eq(teachers.userId, userId));
    return teacher || undefined;
  }

  async getTeacherById(teacherId: number): Promise<Teacher | undefined> {
    const [teacher] = await db.select().from(teachers).where(eq(teachers.id, teacherId));
    return teacher || undefined;
  }

  async getTeacherWithSchool(teacherId: number): Promise<{ teacher: Teacher; school: School; user: User } | undefined> {
    const result = await db.select().from(teachers)
      .innerJoin(schools, eq(teachers.schoolId, schools.id))
      .innerJoin(users, eq(teachers.userId, users.id))
      .where(eq(teachers.id, teacherId));
    if (result.length === 0) return undefined;
    return { teacher: result[0].teachers, school: result[0].schools, user: result[0].users };
  }

  async updateTeacherPassword(userId: number, passwordHash: string, mustChangePassword: boolean = false): Promise<void> {
    await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
    await db.update(teachers).set({ mustChangePassword }).where(eq(teachers.userId, userId));
  }

  async deleteTeacher(teacherId: number): Promise<boolean> {
    const teacher = await this.getTeacherById(teacherId);
    if (!teacher) return false;
    await db.delete(teachers).where(eq(teachers.id, teacherId));
    await db.delete(users).where(eq(users.id, teacher.userId));
    return true;
  }

  // ===== ATTENDANCE METHODS =====
  async getAttendanceByClassDate(schoolId: number, cls: string, section: string, date: string): Promise<AttendanceRecord[]> {
    return await db.select().from(attendanceRecords).where(
      and(eq(attendanceRecords.schoolId, schoolId), eq(attendanceRecords.date, date))
    ).then(records => {
      return records;
    });
  }

  async getAttendanceForStudentsOnDate(studentIds: number[], date: string): Promise<AttendanceRecord[]> {
    if (studentIds.length === 0) return [];
    const allRecords = await db.select().from(attendanceRecords)
      .where(eq(attendanceRecords.date, date));
    return allRecords.filter(r => studentIds.includes(r.studentId));
  }

  async upsertAttendance(records: { studentId: number; teacherId: number; schoolId: number; date: string; status: string; markedBy: string }[]): Promise<AttendanceRecord[]> {
    const results: AttendanceRecord[] = [];
    for (const rec of records) {
      const existing = await db.select().from(attendanceRecords).where(
        and(eq(attendanceRecords.studentId, rec.studentId), eq(attendanceRecords.date, rec.date))
      );
      if (existing.length > 0) {
        const current = existing[0];
        if (current.editCount >= 3) continue;
        const [updated] = await db.update(attendanceRecords).set({
          status: rec.status,
          editCount: current.editCount + 1,
          markedBy: rec.markedBy,
          markedAt: new Date(),
        }).where(eq(attendanceRecords.id, current.id)).returning();
        results.push(updated);
      } else {
        const [created] = await db.insert(attendanceRecords).values({
          studentId: rec.studentId,
          teacherId: rec.teacherId,
          schoolId: rec.schoolId,
          date: rec.date,
          status: rec.status,
          editCount: 0,
          markedBy: rec.markedBy,
          markedAt: new Date(),
        }).returning();
        results.push(created);
      }
    }
    return results;
  }

  async getAttendanceHistory(schoolId: number, cls: string, section: string, startDate: string, endDate: string): Promise<(AttendanceRecord & { studentName: string; dsid: string })[]> {
    const studentList = await this.getStudentsByClassSection(schoolId, cls, section);
    const studentIds = studentList.map(s => s.id);
    if (studentIds.length === 0) return [];
    const allRecords = await db.select().from(attendanceRecords).where(
      and(
        eq(attendanceRecords.schoolId, schoolId),
        gte(attendanceRecords.date, startDate),
        lte(attendanceRecords.date, endDate)
      )
    );
    const filtered = allRecords.filter(r => studentIds.includes(r.studentId));
    const studentMap = new Map(studentList.map(s => [s.id, s]));
    return filtered.map(r => ({
      ...r,
      studentName: studentMap.get(r.studentId)?.name || "Unknown",
      dsid: studentMap.get(r.studentId)?.digitalStudentId || "",
    }));
  }

  async hasAttendanceToday(teacherId: number, cls: string, section: string, schoolId: number): Promise<boolean> {
    const today = new Date().toISOString().split("T")[0];
    const studentList = await this.getStudentsByClassSection(schoolId, cls, section);
    if (studentList.length === 0) return false;
    const studentIds = studentList.map(s => s.id);
    const records = await db.select().from(attendanceRecords).where(
      and(eq(attendanceRecords.date, today), eq(attendanceRecords.teacherId, teacherId))
    );
    return records.some(r => studentIds.includes(r.studentId));
  }

  // ===== HOMEWORK METHODS =====
  async createHomework(data: InsertHomework): Promise<Homework> {
    const [hw] = await db.insert(homework).values(data).returning();
    return hw;
  }

  async getHomeworkByClass(schoolId: number, cls: string, section: string): Promise<Homework[]> {
    return await db.select().from(homework).where(
      and(eq(homework.schoolId, schoolId), eq(homework.class, cls), eq(homework.section, section))
    ).orderBy(desc(homework.createdAt));
  }

  async updateHomework(id: number, data: { content: string; subject: string; fileUrl: string | null; dueDate?: string | null }): Promise<Homework> {
    const [updated] = await db.update(homework).set(data).where(eq(homework.id, id)).returning();
    return updated;
  }

  async deleteHomework(id: number): Promise<void> {
    await db.delete(homework).where(eq(homework.id, id));
  }

  async getHomeworkById(id: number): Promise<Homework | undefined> {
    const [hw] = await db.select().from(homework).where(eq(homework.id, id));
    return hw;
  }

  async recordHomeworkView(homeworkId: number, studentId: number): Promise<void> {
    const existing = await db.select().from(homeworkViews).where(
      and(eq(homeworkViews.homeworkId, homeworkId), eq(homeworkViews.studentId, studentId))
    );
    if (existing.length === 0) {
      await db.insert(homeworkViews).values({ homeworkId, studentId });
    }
  }

  async getHomeworkViewCount(homeworkId: number): Promise<number> {
    const result = await db.select({ count: count() }).from(homeworkViews).where(eq(homeworkViews.homeworkId, homeworkId));
    return result[0]?.count || 0;
  }

  async getStudentCountByClassSection(schoolId: number, cls: string, section: string): Promise<number> {
    const result = await db.select({ count: count() }).from(students).where(
      and(eq(students.schoolId, schoolId), eq(students.class, cls), eq(students.section, section))
    );
    return result[0]?.count || 0;
  }

  // ===== CLASSWORK METHODS =====
  async createClasswork(data: InsertClasswork): Promise<Classwork> {
    const [cw] = await db.insert(classwork).values(data).returning();
    return cw;
  }

  async getClassworkByClass(schoolId: number, cls: string, section: string): Promise<Classwork[]> {
    return await db.select().from(classwork).where(
      and(eq(classwork.schoolId, schoolId), eq(classwork.class, cls), eq(classwork.section, section))
    ).orderBy(desc(classwork.createdAt));
  }

  async getClassworkById(id: number): Promise<Classwork | undefined> {
    const [cw] = await db.select().from(classwork).where(eq(classwork.id, id));
    return cw;
  }

  async updateClasswork(id: number, data: { content?: string; subject?: string; fileUrl?: string | null }): Promise<Classwork> {
    const [cw] = await db.update(classwork).set(data).where(eq(classwork.id, id)).returning();
    return cw;
  }

  async deleteClasswork(id: number): Promise<void> {
    await db.delete(classwork).where(eq(classwork.id, id));
  }

  // ===== NOTICE METHODS =====
  async createNotice(data: InsertNotice): Promise<Notice> {
    const [n] = await db.insert(notices).values(data).returning();
    return n;
  }

  async getNoticesByTarget(schoolId: number, targetType: string, cls?: string, section?: string): Promise<Notice[]> {
    const typeFilter = targetType === "student"
      ? or(eq(notices.targetType, "student"), eq(notices.targetType, "whole_school"))!
      : eq(notices.targetType, targetType);
    const conditions = [eq(notices.schoolId, schoolId), typeFilter];
    if (cls) conditions.push(or(eq(notices.targetClass, cls), isNull(notices.targetClass))!);
    return await db.select().from(notices).where(and(...conditions)).orderBy(desc(notices.createdAt));
  }

  // ===== COMPLAINT METHODS =====
  async getNextTicketId(schoolId: number): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `#DISC-${year}-`;
    const result = await db.select({ ticketId: complaints.ticketId })
      .from(complaints)
      .where(and(eq(complaints.schoolId, schoolId), like(complaints.ticketId, `${prefix}%`)))
      .orderBy(desc(complaints.id))
      .limit(1);
    let seq = 1;
    if (result.length > 0) {
      const last = result[0].ticketId;
      const num = parseInt(last.split("-").pop() || "0");
      if (!isNaN(num)) seq = num + 1;
    }
    return `${prefix}${String(seq).padStart(3, "0")}`;
  }

  async createComplaint(data: InsertComplaint): Promise<Complaint> {
    const [c] = await db.insert(complaints).values(data).returning();
    return c;
  }

  async getComplaintById(id: number): Promise<Complaint | undefined> {
    const [c] = await db.select().from(complaints).where(eq(complaints.id, id));
    return c;
  }

  async updateComplaint(id: number, data: { content?: string; fileUrl?: string | null }): Promise<Complaint> {
    const [c] = await db.update(complaints).set(data).where(eq(complaints.id, id)).returning();
    return c;
  }

  async softDeleteComplaint(id: number): Promise<void> {
    await db.update(complaints).set({ isDeleted: true }).where(eq(complaints.id, id));
  }

  async updateComplaintStatus(id: number, status: string): Promise<Complaint> {
    const [c] = await db.update(complaints).set({ status }).where(eq(complaints.id, id)).returning();
    return c;
  }

  async getComplaintsBySchool(schoolId: number): Promise<(Complaint & { studentName: string | null; teacherName: string })[]> {
    const result = await db.select().from(complaints)
      .leftJoin(students, eq(complaints.studentId, students.id))
      .innerJoin(teachers, eq(complaints.teacherId, teachers.id))
      .where(and(eq(complaints.schoolId, schoolId), eq(complaints.isDeleted, false)))
      .orderBy(desc(complaints.createdAt));
    return result.map(r => ({
      ...r.complaints,
      studentName: r.students?.name || null,
      teacherName: r.teachers.fullName,
    }));
  }

  async getComplaintsByTeacher(teacherId: number, assignedClass?: string, assignedSection?: string, schoolId?: number): Promise<(Complaint & { studentName: string | null })[]> {
    const ownComplaints = await db.select().from(complaints)
      .leftJoin(students, eq(complaints.studentId, students.id))
      .where(and(eq(complaints.teacherId, teacherId), eq(complaints.isDeleted, false)))
      .orderBy(desc(complaints.createdAt));

    const ownResults = ownComplaints.map(r => ({
      ...r.complaints,
      studentName: r.students?.name || null,
    }));

    if (assignedClass && assignedSection && schoolId) {
      const s2sFromOthers = await db.select().from(complaints)
        .leftJoin(students, eq(complaints.studentId, students.id))
        .where(
          and(
            eq(complaints.isDeleted, false),
            eq(complaints.complaintType, "student-to-student"),
            eq(complaints.schoolId, schoolId),
            sql`${complaints.teacherId} != ${teacherId}`,
            eq(students.class, assignedClass),
            eq(students.section, assignedSection)
          )
        )
        .orderBy(desc(complaints.createdAt));

      const s2sResults = s2sFromOthers.map(r => ({
        ...r.complaints,
        studentName: r.students?.name || null,
      }));

      const merged = [...ownResults, ...s2sResults];
      merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const seen = new Set<number>();
      return merged.filter(c => { if (seen.has(c.id)) return false; seen.add(c.id); return true; });
    }

    return ownResults;
  }

  async addComplaintNote(data: InsertComplaintNote): Promise<ComplaintNote> {
    const [n] = await db.insert(complaintNotes).values(data).returning();
    return n;
  }

  async getComplaintNotes(complaintId: number): Promise<ComplaintNote[]> {
    return await db.select().from(complaintNotes)
      .where(eq(complaintNotes.complaintId, complaintId))
      .orderBy(complaintNotes.createdAt);
  }

  // ===== EXAM SCORE METHODS =====
  async upsertExamScores(scores: InsertExamScore[]): Promise<ExamScore[]> {
    const results: ExamScore[] = [];
    for (const score of scores) {
      const existing = await db.select().from(examScores).where(
        and(
          eq(examScores.studentId, score.studentId),
          eq(examScores.subject, score.subject),
          eq(examScores.examType, score.examType)
        )
      );
      if (existing.length > 0) {
        const [updated] = await db.update(examScores)
          .set({ marks: score.marks, totalMarks: score.totalMarks, isAbsent: score.isAbsent })
          .where(eq(examScores.id, existing[0].id)).returning();
        results.push(updated);
      } else {
        const [created] = await db.insert(examScores).values(score).returning();
        results.push(created);
      }
    }
    return results;
  }

  async getExamScores(schoolId: number, subject: string, examType: string, cls: string, section: string): Promise<(ExamScore & { studentName: string; dsid: string })[]> {
    const result = await db.select().from(examScores)
      .innerJoin(students, eq(examScores.studentId, students.id))
      .where(
        and(
          eq(examScores.schoolId, schoolId),
          eq(examScores.subject, subject),
          eq(examScores.examType, examType),
          eq(students.class, cls),
          eq(students.section, section)
        )
      );
    return result.map(r => ({
      ...r.exam_scores,
      studentName: r.students.name,
      dsid: r.students.digitalStudentId,
    }));
  }

  async getExamScoresByStudent(studentId: number, schoolId: number): Promise<ExamScore[]> {
    return await db.select().from(examScores)
      .where(and(eq(examScores.studentId, studentId), eq(examScores.schoolId, schoolId)))
      .orderBy(examScores.examType);
  }

  async getClassAverages(schoolId: number, cls: string, section: string, subject: string): Promise<{ examType: string; avgPercentage: number }[]> {
    const studentList = await this.getStudentsByClassSection(schoolId, cls, section);
    const studentIds = studentList.map(s => s.id);
    if (studentIds.length === 0) return [];

    const allScores = await db.select().from(examScores).where(
      and(
        eq(examScores.schoolId, schoolId),
        eq(examScores.subject, subject),
        eq(examScores.isAbsent, false)
      )
    );

    const filtered = allScores.filter(s => studentIds.includes(s.studentId));
    const grouped: Record<string, { total: number; count: number }> = {};
    for (const s of filtered) {
      if (!grouped[s.examType]) grouped[s.examType] = { total: 0, count: 0 };
      grouped[s.examType].total += Math.round((s.marks / s.totalMarks) * 100);
      grouped[s.examType].count++;
    }

    return Object.entries(grouped).map(([examType, data]) => ({
      examType,
      avgPercentage: Math.round(data.total / data.count),
    }));
  }

  // ===== GALLERY METHODS =====
  async createGalleryItem(data: InsertGalleryItem): Promise<GalleryItem> {
    const [item] = await db.insert(galleryItems).values(data).returning();
    return item;
  }

  async getGalleryItems(schoolId: number, approvedOnly: boolean = true): Promise<GalleryItem[]> {
    const conditions = [eq(galleryItems.schoolId, schoolId)];
    if (approvedOnly) conditions.push(eq(galleryItems.approved, true));
    return await db.select().from(galleryItems).where(and(...conditions)).orderBy(desc(galleryItems.createdAt));
  }

  async approveGalleryItem(id: number): Promise<GalleryItem> {
    const [item] = await db.update(galleryItems).set({ approved: true }).where(eq(galleryItems.id, id)).returning();
    return item;
  }

  // ===== CALENDAR METHODS =====
  async createCalendarEvent(data: InsertCalendarEvent): Promise<CalendarEvent> {
    const [event] = await db.insert(calendarEvents).values(data).returning();
    return event;
  }

  async getCalendarEvents(schoolId: number): Promise<CalendarEvent[]> {
    return await db.select().from(calendarEvents).where(eq(calendarEvents.schoolId, schoolId));
  }

  async deleteCalendarEvent(id: number): Promise<boolean> {
    const result = await db.delete(calendarEvents).where(eq(calendarEvents.id, id)).returning();
    return result.length > 0;
  }

  // ===== LIBRARY METHODS =====
  async createLibraryBook(data: InsertLibraryBook): Promise<LibraryBook> {
    const [book] = await db.insert(libraryBooks).values(data).returning();
    return book;
  }

  async getLibraryBooks(schoolId: number): Promise<LibraryBook[]> {
    return await db.select().from(libraryBooks).where(eq(libraryBooks.schoolId, schoolId));
  }

  async searchLibraryBooks(schoolId: number, query: string): Promise<LibraryBook[]> {
    return await db.select().from(libraryBooks).where(
      and(eq(libraryBooks.schoolId, schoolId), or(ilike(libraryBooks.title, `%${query}%`), ilike(libraryBooks.author, `%${query}%`)))
    );
  }

  async borrowBook(bookId: number, borrowerId: number, borrowerType: string, schoolId: number): Promise<BookBorrow | null> {
    const [book] = await db.select().from(libraryBooks).where(eq(libraryBooks.id, bookId));
    if (!book || book.availableCopies <= 0) return null;
    await db.update(libraryBooks).set({ availableCopies: book.availableCopies - 1 }).where(eq(libraryBooks.id, bookId));
    const [borrow] = await db.insert(bookBorrows).values({ bookId, borrowerId, borrowerType, schoolId }).returning();
    return borrow;
  }

  async returnBook(borrowId: number): Promise<void> {
    const [borrow] = await db.select().from(bookBorrows).where(eq(bookBorrows.id, borrowId));
    if (!borrow || borrow.returnedAt) return;
    await db.update(bookBorrows).set({ returnedAt: new Date() }).where(eq(bookBorrows.id, borrowId));
    const [book] = await db.select().from(libraryBooks).where(eq(libraryBooks.id, borrow.bookId));
    if (book) {
      await db.update(libraryBooks).set({ availableCopies: book.availableCopies + 1 }).where(eq(libraryBooks.id, book.id));
    }
  }

  async getMyBorrowedBooks(borrowerId: number, borrowerType: string): Promise<(BookBorrow & { bookTitle: string; bookAuthor: string })[]> {
    const result = await db.select().from(bookBorrows)
      .innerJoin(libraryBooks, eq(bookBorrows.bookId, libraryBooks.id))
      .where(and(eq(bookBorrows.borrowerId, borrowerId), eq(bookBorrows.borrowerType, borrowerType), isNull(bookBorrows.returnedAt)));
    return result.map(r => ({
      ...r.book_borrows,
      bookTitle: r.library_books.title,
      bookAuthor: r.library_books.author,
    }));
  }

  // ===== LEAVE METHODS =====
  async createLeaveRequest(data: InsertLeaveRequest): Promise<LeaveRequest> {
    const [req] = await db.insert(leaveRequests).values(data).returning();
    return req;
  }

  async getLeaveRequestsByTeacher(teacherId: number): Promise<LeaveRequest[]> {
    return await db.select().from(leaveRequests).where(eq(leaveRequests.teacherId, teacherId)).orderBy(desc(leaveRequests.createdAt));
  }

  async getLeaveRequestsBySchool(schoolId: number): Promise<(LeaveRequest & { teacherName: string })[]> {
    const result = await db.select().from(leaveRequests)
      .innerJoin(teachers, eq(leaveRequests.teacherId, teachers.id))
      .where(eq(leaveRequests.schoolId, schoolId))
      .orderBy(desc(leaveRequests.createdAt));
    return result.map(r => ({ ...r.leave_requests, teacherName: r.teachers.fullName }));
  }

  async updateLeaveStatus(id: number, status: string): Promise<LeaveRequest> {
    const [req] = await db.update(leaveRequests).set({ status }).where(eq(leaveRequests.id, id)).returning();
    return req;
  }

  // ===== TIMETABLE METHODS =====
  async createTimetableEntry(data: InsertTimetableEntry): Promise<TimetableEntry> {
    const [entry] = await db.insert(timetableEntries).values(data).returning();
    return entry;
  }

  async getTimetableByTeacher(teacherId: number): Promise<TimetableEntry[]> {
    return await db.select().from(timetableEntries).where(eq(timetableEntries.teacherId, teacherId));
  }

  async getTimetableBySchool(schoolId: number): Promise<(TimetableEntry & { teacherName: string })[]> {
    const result = await db.select().from(timetableEntries)
      .innerJoin(teachers, eq(timetableEntries.teacherId, teachers.id))
      .where(eq(timetableEntries.schoolId, schoolId));
    return result.map(r => ({ ...r.timetable_entries, teacherName: r.teachers.fullName }));
  }

  async deleteTimetableEntry(id: number): Promise<boolean> {
    const result = await db.delete(timetableEntries).where(eq(timetableEntries.id, id)).returning();
    return result.length > 0;
  }

  async deleteLibraryBook(id: number): Promise<boolean> {
    const result = await db.delete(libraryBooks).where(eq(libraryBooks.id, id)).returning();
    return result.length > 0;
  }

  async findTeacherByEmailAndPhone(email: string, phone: string): Promise<{ teacher: Teacher; user: User } | null> {
    const result = await db.select().from(users)
      .innerJoin(teachers, eq(users.id, teachers.userId))
      .where(and(eq(users.email, email), eq(teachers.phone, phone), eq(users.role, "teacher")));
    if (result.length === 0) return null;
    return { teacher: result[0].teachers, user: result[0].users };
  }

  async setTeacherOtp(teacherId: number, otpCode: string, expiresAt: Date): Promise<void> {
    await db.update(teachers).set({ otpCode, otpExpiresAt: expiresAt }).where(eq(teachers.id, teacherId));
  }

  async verifyTeacherOtp(teacherId: number, otpCode: string): Promise<{ teacher: Teacher; user: User } | null> {
    const result = await db.select().from(teachers)
      .innerJoin(users, eq(teachers.userId, users.id))
      .where(and(eq(teachers.id, teacherId), eq(teachers.otpCode, otpCode)));
    if (result.length === 0) return null;
    const teacher = result[0].teachers;
    if (!teacher.otpExpiresAt || new Date() > teacher.otpExpiresAt) return null;
    return { teacher, user: result[0].users };
  }

  async clearTeacherOtp(teacherId: number): Promise<void> {
    await db.update(teachers).set({ otpCode: null, otpExpiresAt: null }).where(eq(teachers.id, teacherId));
  }

  async setTeacherResetToken(teacherId: number, resetToken: string): Promise<void> {
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await db.update(teachers).set({ resetToken, resetTokenExpiresAt: expiresAt }).where(eq(teachers.id, teacherId));
  }

  async verifyTeacherResetToken(teacherId: number, resetToken: string): Promise<{ teacher: Teacher; user: User } | null> {
    const result = await db.select().from(teachers)
      .innerJoin(users, eq(teachers.userId, users.id))
      .where(and(eq(teachers.id, teacherId), eq(teachers.resetToken, resetToken)));
    if (result.length === 0) return null;
    const teacher = result[0].teachers;
    if (!teacher.resetTokenExpiresAt || new Date() > teacher.resetTokenExpiresAt) return null;
    return { teacher, user: result[0].users };
  }

  async clearTeacherResetToken(teacherId: number): Promise<void> {
    await db.update(teachers).set({ resetToken: null, resetTokenExpiresAt: null }).where(eq(teachers.id, teacherId));
  }

  // ===== SCHOOL METADATA METHODS =====
  async getSchoolMetadata(schoolId: number, metaKey: string): Promise<string[]> {
    const [row] = await db.select().from(schoolMetadata)
      .where(and(eq(schoolMetadata.schoolId, schoolId), eq(schoolMetadata.metaKey, metaKey)));
    if (!row) return [];
    try { return JSON.parse(row.metaValue); } catch { return []; }
  }

  async setSchoolMetadata(schoolId: number, metaKey: string, values: string[]): Promise<SchoolMetadata> {
    const metaValue = JSON.stringify(values);
    const existing = await db.select().from(schoolMetadata)
      .where(and(eq(schoolMetadata.schoolId, schoolId), eq(schoolMetadata.metaKey, metaKey)));
    if (existing.length > 0) {
      const [updated] = await db.update(schoolMetadata)
        .set({ metaValue, updatedAt: new Date() })
        .where(eq(schoolMetadata.id, existing[0].id)).returning();
      return updated;
    }
    const [created] = await db.insert(schoolMetadata)
      .values({ schoolId, metaKey, metaValue }).returning();
    return created;
  }

  async getAllSchoolMetadata(schoolId: number): Promise<Record<string, string[]>> {
    const rows = await db.select().from(schoolMetadata)
      .where(eq(schoolMetadata.schoolId, schoolId));
    const result: Record<string, string[]> = {};
    for (const row of rows) {
      try { result[row.metaKey] = JSON.parse(row.metaValue); } catch { result[row.metaKey] = []; }
    }
    return result;
  }

  // ===== STUDENT SEARCH =====
  async searchStudents(schoolId: number, query: string): Promise<Pick<Student, 'id' | 'name' | 'digitalStudentId' | 'class' | 'section' | 'photoUrl'>[]> {
    const results = await db.select({
      id: students.id,
      name: students.name,
      digitalStudentId: students.digitalStudentId,
      class: students.class,
      section: students.section,
      photoUrl: students.photoUrl,
    }).from(students).where(
      and(
        eq(students.schoolId, schoolId),
        or(ilike(students.name, `%${query}%`), ilike(students.digitalStudentId, `%${query}%`))
      )
    ).limit(15);
    return results;
  }

  // ===== STUDENT LEAVE REQUESTS =====
  async createStudentLeaveRequest(data: InsertStudentLeaveRequest): Promise<StudentLeaveRequest> {
    const [req] = await db.insert(studentLeaveRequests).values(data).returning();
    return req;
  }

  async getStudentLeavesByClassSection(schoolId: number, cls: string, section: string): Promise<(StudentLeaveRequest & { studentName: string; dsid: string })[]> {
    const result = await db.select().from(studentLeaveRequests)
      .innerJoin(students, eq(studentLeaveRequests.studentId, students.id))
      .where(
        and(
          eq(studentLeaveRequests.schoolId, schoolId),
          eq(students.class, cls),
          eq(students.section, section)
        )
      )
      .orderBy(desc(studentLeaveRequests.createdAt));
    return result.map(r => ({
      ...r.student_leave_requests,
      studentName: r.students.name,
      dsid: r.students.digitalStudentId,
    }));
  }

  async updateStudentLeaveStatus(id: number, status: string, reviewedBy: number, reviewerRole: string): Promise<StudentLeaveRequest> {
    const [req] = await db.update(studentLeaveRequests)
      .set({ status, reviewedBy, reviewerRole })
      .where(eq(studentLeaveRequests.id, id)).returning();
    return req;
  }

  async getStudentLeaveById(id: number): Promise<StudentLeaveRequest | null> {
    const [req] = await db.select().from(studentLeaveRequests).where(eq(studentLeaveRequests.id, id));
    return req || null;
  }

  async markAttendanceAsLeave(studentId: number, teacherId: number, schoolId: number, startDate: string, endDate: string): Promise<void> {
    const start = new Date(startDate);
    const end = new Date(endDate);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      if (d.getDay() === 0) continue;
      const dateStr = d.toISOString().split("T")[0];
      const existing = await db.select().from(attendanceRecords)
        .where(and(eq(attendanceRecords.studentId, studentId), eq(attendanceRecords.date, dateStr), eq(attendanceRecords.schoolId, schoolId)));
      if (existing.length > 0) {
        await db.update(attendanceRecords)
          .set({ status: "leave", markedBy: "System (Leave Approved)", markedAt: new Date() })
          .where(eq(attendanceRecords.id, existing[0].id));
      } else {
        await db.insert(attendanceRecords).values({
          studentId, teacherId, schoolId, date: dateStr,
          status: "leave", editCount: 0, markedBy: "System (Leave Approved)", markedAt: new Date(),
        });
      }
    }
  }

  // ===== AUDIT LOGS =====
  async createAuditLog(data: InsertAuditLog): Promise<AuditLog> {
    const [log] = await db.insert(auditLogs).values(data).returning();
    return log;
  }

  async getAuditLogs(schoolId: number, limit: number = 100): Promise<AuditLog[]> {
    return await db.select().from(auditLogs)
      .where(eq(auditLogs.schoolId, schoolId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);
  }

  // ===== ENHANCED LIBRARY =====
  async updateBookVerificationStatus(id: number, status: string): Promise<LibraryBook> {
    const [book] = await db.update(libraryBooks)
      .set({ verificationStatus: status })
      .where(eq(libraryBooks.id, id)).returning();
    return book;
  }

  async searchLibraryBooksAdvanced(schoolId: number, query: string): Promise<LibraryBook[]> {
    return await db.select().from(libraryBooks).where(
      and(
        eq(libraryBooks.schoolId, schoolId),
        or(
          ilike(libraryBooks.title, `%${query}%`),
          ilike(libraryBooks.author, `%${query}%`),
          ilike(libraryBooks.targetClass, `%${query}%`)
        )
      )
    );
  }

  // ===== TEACHER LEAVE BALANCE =====
  async getTeacherLeaveBalance(teacherId: number): Promise<{ sick: number; casual: number; earned: number }> {
    const year = new Date().getFullYear();
    const startOfYear = `${year}-01-01`;
    const endOfYear = `${year}-12-31`;
    const approved = await db.select().from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.teacherId, teacherId),
          eq(leaveRequests.status, "approved"),
          gte(leaveRequests.startDate, startOfYear),
          lte(leaveRequests.endDate, endOfYear)
        )
      );
    let sick = 0, casual = 0, earned = 0;
    for (const r of approved) {
      const start = new Date(r.startDate);
      const end = new Date(r.endDate);
      const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      const type = r.leaveType.toLowerCase();
      if (type.includes("sick")) sick += days;
      else if (type.includes("casual")) casual += days;
      else earned += days;
    }
    return { sick, casual, earned };
  }

  async updateLeaveStatusWithApprover(id: number, status: string, approvedBy: number): Promise<LeaveRequest> {
    const [req] = await db.update(leaveRequests).set({ status, approvedBy }).where(eq(leaveRequests.id, id)).returning();
    return req;
  }

  // ===== PAGINATED STUDENTS (Big Data) =====
  async getStudentsPaginated(schoolId: number, opts: { q?: string; cls?: string; section?: string; page?: number }): Promise<{ data: Student[]; total: number }> {
    const { q, cls, section, page = 1 } = opts;
    const limit = 50;
    const offset = (page - 1) * limit;
    const conditions = [eq(students.schoolId, schoolId)];
    if (cls) conditions.push(eq(students.class, cls));
    if (section) conditions.push(eq(students.section, section));
    if (q) conditions.push(or(ilike(students.name, `%${q}%`), ilike(students.digitalStudentId, `%${q}%`))!);
    const [{ total }] = await db.select({ total: count() }).from(students).where(and(...conditions));
    const data = await db.select().from(students).where(and(...conditions)).orderBy(students.name).limit(limit).offset(offset);
    return { data, total: Number(total) };
  }

  // ===== PAGINATED TEACHERS (Big Data) =====
  async getTeachersPaginated(schoolId: number, opts: { q?: string; page?: number }): Promise<{ data: Teacher[]; total: number }> {
    const { q, page = 1 } = opts;
    const limit = 50;
    const offset = (page - 1) * limit;
    const conditions = [eq(teachers.schoolId, schoolId)];
    if (q) conditions.push(or(ilike(teachers.fullName, `%${q}%`), ilike(teachers.subject, `%${q}%`), ilike(teachers.email, `%${q}%`))!);
    const [{ total }] = await db.select({ total: count() }).from(teachers).where(and(...conditions));
    const data = await db.select().from(teachers).where(and(...conditions)).orderBy(teachers.fullName).limit(limit).offset(offset);
    return { data, total: Number(total) };
  }

  // ===== DAILY ATTENDANCE SUMMARY =====
  async getDailyAttendanceSummary(schoolId: number, date: string): Promise<{ total: number; present: number; absent: number; leave: number; percentage: number }> {
    const records = await db.select().from(attendanceRecords).where(and(eq(attendanceRecords.schoolId, schoolId), eq(attendanceRecords.date, date)));
    const total = records.length;
    const present = records.filter(r => r.status === "present").length;
    const absent = records.filter(r => r.status === "absent").length;
    const leave = records.filter(r => r.status === "leave").length;
    const percentage = total > 0 ? Math.round((present / total) * 100) : 0;
    return { total, present, absent, leave, percentage };
  }

  // ===== COMPLAINTS BY SCHOOL (Admin) =====
  async getComplaintsBySchool(schoolId: number): Promise<Complaint[]> {
    return db.select().from(complaints).where(eq(complaints.schoolId, schoolId)).orderBy(desc(complaints.createdAt));
  }

  // ===== AUDIT LOGS READER =====
  async getAuditLogsBySchool(schoolId: number, limit = 100): Promise<AuditLog[]> {
    return db.select().from(auditLogs).where(eq(auditLogs.schoolId, schoolId)).orderBy(desc(auditLogs.createdAt)).limit(limit);
  }

  // ===== STUDENT LEAVES FOR ADMIN (forwarded to principal) =====
  async getStudentLeavesForAdmin(schoolId: number): Promise<(StudentLeaveRequest & { studentName: string; dsid: string; class: string; section: string })[]> {
    const leaves = await db.select().from(studentLeaveRequests).where(eq(studentLeaveRequests.schoolId, schoolId)).orderBy(desc(studentLeaveRequests.createdAt));
    const result = [];
    for (const l of leaves) {
      const s = await this.getStudentById(l.studentId);
      result.push({ ...l, studentName: s?.name ?? "Unknown", dsid: s?.digitalStudentId ?? "", class: s?.class ?? "", section: s?.section ?? "" });
    }
    return result;
  }

  // ===== VISITOR LOGS =====
  async createVisitorLog(data: InsertVisitorLog): Promise<VisitorLog> {
    const [v] = await db.insert(visitorLogs).values(data).returning();
    return v;
  }

  async getVisitorLogsBySchool(schoolId: number): Promise<VisitorLog[]> {
    return db.select().from(visitorLogs).where(eq(visitorLogs.schoolId, schoolId)).orderBy(desc(visitorLogs.createdAt)).limit(200);
  }

  async checkoutVisitor(id: number): Promise<VisitorLog> {
    const [v] = await db.update(visitorLogs).set({ checkOut: new Date() }).where(eq(visitorLogs.id, id)).returning();
    return v;
  }

  // ===== PENDING EBOOKS FOR APPROVAL =====
  async getPendingEbooks(schoolId: number): Promise<LibraryBook[]> {
    return db.select().from(libraryBooks).where(and(eq(libraryBooks.schoolId, schoolId), eq(libraryBooks.verificationStatus, "pending")));
  }

  // ===== EXAM SCORES AGGREGATION FOR ANALYTICS =====
  async getExamScoresBySchool(schoolId: number): Promise<ExamScore[]> {
    return db.select().from(examScores).where(eq(examScores.schoolId, schoolId)).orderBy(desc(examScores.createdAt)).limit(500);
  }
}

export const storage = new DatabaseStorage();
