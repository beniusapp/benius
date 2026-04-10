import {
  schools, students, users, teachers,
  attendanceRecords, homework, homeworkViews, homeworkSubmissions, classwork, notices,
  complaints, complaintNotes, examScores, galleryItems, calendarEvents,
  libraryBooks, bookBorrows, leaveRequests, timetableEntries, schoolMetadata,
  studentLeaveRequests, auditLogs, visitorLogs, studentProfiles, teacherAllocations,
  promotionOverrides, gradingTiers, gradingRules, academicHistory,
  schoolAssets, assetLogs,
  type School, type InsertSchool, type Student, type InsertStudent,
  type User, type InsertUser, type Teacher, type InsertTeacher,
  type AttendanceRecord, type InsertAttendance,
  type Homework, type InsertHomework, type HomeworkView, type Classwork, type InsertClasswork,
  type HomeworkSubmission,
  type Notice, type InsertNotice, type Complaint, type InsertComplaint,
  type ComplaintNote, type InsertComplaintNote,
  type ExamScore, type InsertExamScore, type GalleryItem, type InsertGalleryItem,
  type CalendarEvent, type InsertCalendarEvent, type LibraryBook, type InsertLibraryBook,
  type BookBorrow, type InsertBookBorrow, type LeaveRequest, type InsertLeaveRequest,
  type TimetableEntry, type InsertTimetableEntry,
  type TeacherAllocation, type InsertTeacherAllocation,
  type SchoolMetadata,
  type StudentLeaveRequest, type InsertStudentLeaveRequest,
  type AuditLog, type InsertAuditLog,
  type VisitorLog, type InsertVisitorLog,
  type StudentProfile, type InsertStudentProfile,
  type PromotionOverride,
  type GradingTier, type InsertGradingTier,
  type GradingRule,
  type InsertAcademicHistory,
  type SchoolAsset, type InsertSchoolAsset,
  type InsertAssetLog,
} from "@shared/schema";
import { db } from "./db";
import { pool } from "./db";
import { eq, sql, like, count, and, desc, gte, lte, or, ilike, isNull, inArray, type SQL } from "drizzle-orm";

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

  async activateStudent(studentId: number, passwordHash: string, enrollmentDate?: string): Promise<Student> {
    const setFields: Partial<typeof students.$inferInsert> = { passwordHash, isActivated: true };
    if (enrollmentDate) setFields.enrollmentDate = enrollmentDate;
    const [student] = await db.update(students).set(setFields).where(eq(students.id, studentId)).returning();
    return student;
  }

  async updateStudentLivePhoto(studentId: number, photoUrl: string): Promise<void> {
    await db.update(students).set({ photoUrl }).where(eq(students.id, studentId));
  }

  async updateStudentVerifiedProfile(studentId: number, verifiedProfileJson: string): Promise<void> {
    await db.update(students).set({ verifiedProfile: verifiedProfileJson }).where(eq(students.id, studentId));
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

  async getStudentHomework(schoolId: number, cls: string, section: string, studentId: number, date?: string): Promise<{
    id: number; schoolId: number; teacherId: number; class: string; section: string;
    subject: string; content: string; fileUrl: string | null; dueDate: string | null;
    createdAt: Date; teacherName: string; submission: HomeworkSubmission | null;
  }[]> {
    const conditions: SQL<unknown>[] = [
      eq(homework.schoolId, schoolId),
      eq(homework.class, cls),
      eq(homework.section, section),
    ];
    if (date) {
      conditions.push(or(
        sql`${homework.createdAt}::date = ${date}::date`,
        eq(homework.dueDate, date),
      )!);
    }
    const rows = await db.select({
      id: homework.id,
      schoolId: homework.schoolId,
      teacherId: homework.teacherId,
      class: homework.class,
      section: homework.section,
      subject: homework.subject,
      content: homework.content,
      fileUrl: homework.fileUrl,
      dueDate: homework.dueDate,
      createdAt: homework.createdAt,
      teacherName: teachers.fullName,
    }).from(homework)
      .innerJoin(teachers, eq(homework.teacherId, teachers.id))
      .where(and(...conditions))
      .orderBy(desc(homework.createdAt));

    if (rows.length === 0) return [];
    const hwIds = rows.map(r => r.id);
    const subs = await db.select().from(homeworkSubmissions).where(
      and(eq(homeworkSubmissions.studentId, studentId), inArray(homeworkSubmissions.homeworkId, hwIds))
    );
    const subMap = new Map(subs.map(s => [s.homeworkId, s]));
    return rows.map(r => ({ ...r, submission: subMap.get(r.id) ?? null }));
  }

  async getStudentClasswork(schoolId: number, cls: string, section: string, date?: string): Promise<{
    id: number; schoolId: number; teacherId: number; class: string; section: string;
    subject: string; content: string; fileUrl: string | null; createdAt: Date; teacherName: string;
  }[]> {
    const conditions: SQL<unknown>[] = [
      eq(classwork.schoolId, schoolId),
      eq(classwork.class, cls),
      eq(classwork.section, section),
    ];
    if (date) {
      conditions.push(sql`${classwork.createdAt}::date = ${date}::date`);
    }
    const rows = await db.select({
      id: classwork.id,
      schoolId: classwork.schoolId,
      teacherId: classwork.teacherId,
      class: classwork.class,
      section: classwork.section,
      subject: classwork.subject,
      content: classwork.content,
      fileUrl: classwork.fileUrl,
      createdAt: classwork.createdAt,
      teacherName: teachers.fullName,
    }).from(classwork)
      .innerJoin(teachers, eq(classwork.teacherId, teachers.id))
      .where(and(...conditions))
      .orderBy(desc(classwork.createdAt));
    return rows;
  }

  async getHomeworkSubmission(homeworkId: number, studentId: number): Promise<HomeworkSubmission | undefined> {
    const [sub] = await db.select().from(homeworkSubmissions).where(
      and(eq(homeworkSubmissions.homeworkId, homeworkId), eq(homeworkSubmissions.studentId, studentId))
    );
    return sub;
  }

  async upsertHomeworkSubmission(data: { homeworkId: number; studentId: number; schoolId: number; fileUrl?: string | null }): Promise<HomeworkSubmission> {
    const existing = await this.getHomeworkSubmission(data.homeworkId, data.studentId);
    if (existing) {
      const [updated] = await db.update(homeworkSubmissions)
        .set({ fileUrl: data.fileUrl !== undefined ? data.fileUrl : existing.fileUrl, status: "submitted", submittedAt: new Date() })
        .where(eq(homeworkSubmissions.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await db.insert(homeworkSubmissions).values({
      homeworkId: data.homeworkId,
      studentId: data.studentId,
      schoolId: data.schoolId,
      fileUrl: data.fileUrl ?? null,
      status: "submitted",
    }).returning();
    return created;
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

  async getComplaintByIdForSchool(id: number, schoolId: number): Promise<Complaint | undefined> {
    const [c] = await db.select().from(complaints).where(and(eq(complaints.id, id), eq(complaints.schoolId, schoolId)));
    return c;
  }

  async updateComplaint(id: number, schoolId: number, data: { content?: string; fileUrl?: string | null }): Promise<Complaint> {
    const [c] = await db.update(complaints).set(data).where(and(eq(complaints.id, id), eq(complaints.schoolId, schoolId))).returning();
    return c;
  }

  async softDeleteComplaint(id: number, schoolId: number): Promise<void> {
    await db.update(complaints).set({ isDeleted: true }).where(and(eq(complaints.id, id), eq(complaints.schoolId, schoolId)));
  }

  async updateComplaintStatus(id: number, schoolId: number, status: string): Promise<Complaint> {
    const [c] = await db.update(complaints).set({ status }).where(and(eq(complaints.id, id), eq(complaints.schoolId, schoolId))).returning();
    return c;
  }

  async getComplaintsBySchool(schoolId: number): Promise<(Complaint & { studentName: string | null; teacherName: string | null })[]> {
    const result = await db.select().from(complaints)
      .leftJoin(students, eq(complaints.studentId, students.id))
      .leftJoin(teachers, eq(complaints.teacherId, teachers.id))
      .where(and(eq(complaints.schoolId, schoolId), eq(complaints.isDeleted, false)))
      .orderBy(desc(complaints.createdAt));
    return result.map(r => ({
      ...r.complaints,
      studentName: r.students?.name || null,
      teacherName: r.teachers?.fullName || null,
    }));
  }

  async getComplaintsByTeacher(teacherId: number, assignedClass?: string, assignedSection?: string, schoolId?: number): Promise<(Complaint & { studentName: string | null })[]> {
    const STUDENT_FILED_TYPES = ["student-to-staff", "student-peer-report"];
    const ownWhereConditions = [
      eq(complaints.teacherId, teacherId),
      eq(complaints.isDeleted, false),
      sql`${complaints.complaintType} NOT IN ('student-to-staff', 'student-peer-report')`,
    ] as const;
    const ownComplaints = await db.select().from(complaints)
      .leftJoin(students, eq(complaints.studentId, students.id))
      .where(schoolId
        ? and(...ownWhereConditions, eq(complaints.schoolId, schoolId))
        : and(...ownWhereConditions)
      )
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
      return merged.filter(c => {
        if (STUDENT_FILED_TYPES.includes(c.complaintType)) return false;
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
      });
    }

    return ownResults;
  }

  async getStudentInboxComplaints(studentId: number, schoolId: number): Promise<(Complaint & { teacherName: string })[]> {
    const result = await db.select().from(complaints)
      .innerJoin(teachers, eq(complaints.teacherId, teachers.id))
      .where(and(
        eq(complaints.studentId, studentId),
        eq(complaints.schoolId, schoolId),
        eq(complaints.complaintType, "teacher-to-student"),
        eq(complaints.isDeleted, false),
      ))
      .orderBy(desc(complaints.createdAt));
    return result.map(r => ({ ...r.complaints, teacherName: r.teachers.fullName }));
  }

  async getStudentFiledComplaints(complainantStudentId: number, schoolId: number): Promise<(Complaint & { teacherName: string | null })[]> {
    const result = await db.select().from(complaints)
      .leftJoin(teachers, eq(complaints.teacherId, teachers.id))
      .where(and(
        eq(complaints.complainantStudentId, complainantStudentId),
        eq(complaints.schoolId, schoolId),
        eq(complaints.isDeleted, false),
        sql`${complaints.complaintType} IN ('student-to-staff', 'student-peer-report')`
      ))
      .orderBy(desc(complaints.createdAt));
    return result.map(r => ({ ...r.complaints, teacherName: r.teachers?.fullName || null }));
  }

  async createStudentComplaint(data: InsertComplaint): Promise<Complaint> {
    const [c] = await db.insert(complaints).values(data).returning();
    return c;
  }

  async getClassFeedComplaints(schoolId: number, cls: string, section: string): Promise<(Complaint & { complainantStudentName: string | null })[]> {
    const result = await db.select().from(complaints)
      .leftJoin(students, eq(complaints.complainantStudentId, students.id))
      .where(and(
        eq(complaints.schoolId, schoolId),
        eq(complaints.complaintType, "student-peer-report"),
        eq(complaints.complainantClass, cls),
        eq(complaints.complainantSection, section),
        eq(complaints.isDeleted, false),
      ))
      .orderBy(desc(complaints.createdAt));
    return result.map(r => ({
      ...r.complaints,
      complainantStudentName: r.students?.name || null,
    }));
  }

  async resolveComplaint(id: number, schoolId: number, remarks: string): Promise<Complaint | null> {
    const [c] = await db.update(complaints)
      .set({ status: "Resolved", resolutionRemarks: remarks })
      .where(and(eq(complaints.id, id), eq(complaints.schoolId, schoolId)))
      .returning();
    return c || null;
  }

  async escalateComplaint(id: number, schoolId: number): Promise<Complaint | null> {
    const [c] = await db.update(complaints)
      .set({ escalatedToPrincipal: true, status: "Escalated" })
      .where(and(eq(complaints.id, id), eq(complaints.schoolId, schoolId)))
      .returning();
    return c || null;
  }

  async updateTeacherProfilePicture(teacherId: number, profileImageUrl: string): Promise<void> {
    await db.update(teachers).set({ profileImageUrl }).where(eq(teachers.id, teacherId));
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
      const conditions: SQL<unknown>[] = [
        eq(examScores.studentId, score.studentId),
        eq(examScores.subject, score.subject),
        eq(examScores.examType, score.examType),
      ];
      if (score.class != null) conditions.push(eq(examScores.class, score.class));
      if (score.section != null) conditions.push(eq(examScores.section, score.section));

      const existing = await db.select().from(examScores).where(and(...conditions));
      if (existing.length > 0) {
        const [updated] = await db.update(examScores)
          .set({
            marks: score.marks,
            totalMarks: score.totalMarks,
            passMarks: score.passMarks ?? 33,
            isAbsent: score.isAbsent,
            class: score.class ?? existing[0].class,
            section: score.section ?? existing[0].section,
          })
          .where(eq(examScores.id, existing[0].id)).returning();
        results.push(updated);
      } else {
        const [created] = await db.insert(examScores).values(score).returning();
        results.push(created);
      }
    }
    return results;
  }

  async publishExamScores(schoolId: number, cls: string, section: string, examType: string): Promise<number> {
    const updated = await db.update(examScores)
      .set({ published: true })
      .where(and(
        eq(examScores.schoolId, schoolId),
        eq(examScores.class, cls),
        eq(examScores.section, section),
        eq(examScores.examType, examType),
      ))
      .returning();
    return updated.length;
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

  async getStudentDistinctClasses(schoolId: number, studentId: number): Promise<string[]> {
    const rows = await db.selectDistinct({ class: examScores.class })
      .from(examScores)
      .where(and(
        eq(examScores.schoolId, schoolId),
        eq(examScores.studentId, studentId),
        eq(examScores.published, true),
      ))
      .orderBy(sql`${examScores.class} ASC NULLS LAST`);
    return rows.map(r => r.class).filter((c): c is string => c !== null);
  }

  async getStudentExamTypes(schoolId: number, cls: string, section: string): Promise<string[]> {
    const rows = await db.select({
      examType: examScores.examType,
      minId: sql<number>`MIN(${examScores.id})`,
    })
      .from(examScores)
      .where(and(
        eq(examScores.schoolId, schoolId),
        eq(examScores.class, cls),
        eq(examScores.section, section),
        eq(examScores.published, true),
      ))
      .groupBy(examScores.examType)
      .orderBy(sql`MIN(${examScores.id}) ASC`);
    return rows.map(r => r.examType);
  }

  async getStudentExamScores(schoolId: number, studentId: number, cls: string, examType: string): Promise<ExamScore[]> {
    return await db.select().from(examScores)
      .where(and(
        eq(examScores.schoolId, schoolId),
        eq(examScores.studentId, studentId),
        eq(examScores.class, cls),
        eq(examScores.examType, examType),
        eq(examScores.published, true),
      ))
      .orderBy(examScores.subject);
  }

  async getClassRank(schoolId: number, cls: string, section: string, examType: string, studentId: number): Promise<{ rank: number; total: number }> {
    const allScores = await db.select().from(examScores)
      .where(and(
        eq(examScores.schoolId, schoolId),
        eq(examScores.class, cls),
        eq(examScores.section, section),
        eq(examScores.examType, examType),
        eq(examScores.published, true),
      ));

    const byStudent: Record<number, { obtained: number; total: number }> = {};
    for (const s of allScores) {
      if (!byStudent[s.studentId]) byStudent[s.studentId] = { obtained: 0, total: 0 };
      if (!s.isAbsent) byStudent[s.studentId].obtained += s.marks;
      byStudent[s.studentId].total += s.totalMarks;
    }

    const studentPcts = Object.entries(byStudent).map(([sid, d]) => ({
      studentId: parseInt(sid),
      pct: d.total > 0 ? (d.obtained / d.total) * 100 : 0,
    })).sort((a, b) => b.pct - a.pct);

    const rank = studentPcts.findIndex(s => s.studentId === studentId) + 1;
    return { rank: rank || studentPcts.length, total: studentPcts.length };
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

  async getApprovedGalleryItems(schoolId: number, tag?: string): Promise<GalleryItem[]> {
    const conditions = [eq(galleryItems.schoolId, schoolId), eq(galleryItems.approved, true)];
    if (tag) conditions.push(eq(galleryItems.eventTag, tag));
    return await db.select().from(galleryItems).where(and(...conditions)).orderBy(desc(galleryItems.createdAt));
  }

  async getGalleryTagsBySchool(schoolId: number): Promise<string[]> {
    const rows = await db.selectDistinct({ eventTag: galleryItems.eventTag })
      .from(galleryItems)
      .where(and(eq(galleryItems.schoolId, schoolId), eq(galleryItems.approved, true)));
    return rows.map(r => r.eventTag).filter((t): t is string => t !== null && t !== "");
  }

  async getFacultyBySchool(schoolId: number): Promise<{
    id: number; fullName: string; subject: string; designation: string | null;
    qualifications: string | null; department: string | null; profileImageUrl: string | null;
  }[]> {
    const rows = await db.select({
      id: teachers.id,
      fullName: teachers.fullName,
      subject: teachers.subject,
      designation: teachers.designation,
      qualifications: teachers.qualifications,
      department: teachers.department,
      profileImageUrl: teachers.profileImageUrl,
    }).from(teachers).where(eq(teachers.schoolId, schoolId)).orderBy(teachers.fullName);
    return rows;
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

  async deleteTimetableEntry(id: number, schoolId?: number): Promise<boolean> {
    const conditions = schoolId !== undefined
      ? and(eq(timetableEntries.id, id), eq(timetableEntries.schoolId, schoolId))
      : eq(timetableEntries.id, id);
    const result = await db.delete(timetableEntries).where(conditions).returning();
    return result.length > 0;
  }

  async getTimetableEntryById(id: number, schoolId?: number): Promise<TimetableEntry | null> {
    const conditions = schoolId !== undefined
      ? and(eq(timetableEntries.id, id), eq(timetableEntries.schoolId, schoolId))
      : eq(timetableEntries.id, id);
    const [entry] = await db.select().from(timetableEntries).where(conditions);
    return entry || null;
  }

  async updateTimetableEntry(
    id: number,
    schoolId: number,
    data: Partial<Pick<TimetableEntry, "dayOfWeek" | "period" | "class" | "section" | "subject" | "room" | "startTime" | "endTime" | "status">>
  ): Promise<TimetableEntry | null> {
    const updateData: Record<string, unknown> = { ...data };
    const [entry] = await db.update(timetableEntries)
      .set(updateData)
      .where(and(eq(timetableEntries.id, id), eq(timetableEntries.schoolId, schoolId)))
      .returning();
    return entry || null;
  }

  async updateTimetableEntryStatus(schoolId: number, cls: string, section: string, status: string): Promise<number> {
    // When publishing, only promote draft entries (not already-published ones)
    const whereConditions = and(
      eq(timetableEntries.schoolId, schoolId),
      eq(timetableEntries.class, cls),
      eq(timetableEntries.section, section),
      status === "published" ? eq(timetableEntries.status, "draft") : undefined,
    );
    const result = await db.update(timetableEntries)
      .set({ status })
      .where(whereConditions)
      .returning();
    return result.length;
  }

  async getClassSectionStatus(schoolId: number): Promise<{ class: string; section: string; totalCount: number; draftCount: number; publishedCount: number }[]> {
    const entries = await db.select().from(timetableEntries).where(eq(timetableEntries.schoolId, schoolId));
    const map: Record<string, { class: string; section: string; totalCount: number; draftCount: number; publishedCount: number }> = {};
    for (const e of entries) {
      const key = `${e.class}-${e.section}`;
      if (!map[key]) map[key] = { class: e.class, section: e.section, totalCount: 0, draftCount: 0, publishedCount: 0 };
      map[key].totalCount++;
      if (e.status === "published") map[key].publishedCount++;
      else map[key].draftCount++;
    }
    return Object.values(map).sort((a, b) => a.class.localeCompare(b.class, undefined, { numeric: true }) || a.section.localeCompare(b.section));
  }

  async validateTimetableEntry(opts: {
    schoolId: number;
    teacherId: number;
    dayOfWeek: number;
    period: number;
    class: string;
    section: string;
    subject: string;
    room?: string | null;
    excludeId?: number;
    requireAllocation?: boolean; // When true: teacher must have an allocation for (subject, class, section)
  }): Promise<{ valid: boolean; error?: string }> {
    const { schoolId, teacherId, dayOfWeek, period, excludeId } = opts;

    // 1. Allocation boundary check (for teacher self-management)
    if (opts.requireAllocation) {
      const alloc = await db.select().from(teacherAllocations).where(
        and(
          eq(teacherAllocations.schoolId, schoolId),
          eq(teacherAllocations.teacherId, teacherId),
          eq(teacherAllocations.class, opts.class),
          eq(teacherAllocations.section, opts.section),
          eq(teacherAllocations.subject, opts.subject),
        )
      );
      if (alloc.length === 0) {
        return { valid: false, error: `Not allowed: No allocation found for ${opts.subject} in Class ${opts.class}-${opts.section}. Contact your admin.` };
      }
    }

    const existing = await db.select().from(timetableEntries).where(
      and(
        eq(timetableEntries.schoolId, schoolId),
        eq(timetableEntries.dayOfWeek, dayOfWeek),
        eq(timetableEntries.period, period),
      )
    );

    const others = existing.filter(e => e.id !== (excludeId ?? -1));

    // 2. Teacher conflict (same teacher, same slot)
    const teacherConflict = others.find(e => e.teacherId === teacherId);
    if (teacherConflict) {
      return { valid: false, error: `Conflict: You are already teaching Class ${teacherConflict.class}-${teacherConflict.section} at this time.` };
    }

    // 3. Class conflict (same class+section already has a slot)
    const classConflict = others.find(e => e.class === opts.class && e.section === opts.section);
    if (classConflict) {
      return { valid: false, error: `Conflict: Class ${opts.class}-${opts.section} already has ${classConflict.subject} in this slot.` };
    }

    // 4. Room conflict
    if (opts.room) {
      const roomConflict = others.find(e => e.room && e.room.toLowerCase() === opts.room!.toLowerCase());
      if (roomConflict) {
        return { valid: false, error: `Conflict: Room "${opts.room}" is already occupied by Class ${roomConflict.class}-${roomConflict.section} (${roomConflict.subject}).` };
      }
    }

    // 5. Weekly quota: subject-specific (matches exact allocation row)
    const specificAlloc = await db.select().from(teacherAllocations).where(
      and(
        eq(teacherAllocations.schoolId, schoolId),
        eq(teacherAllocations.teacherId, teacherId),
        eq(teacherAllocations.class, opts.class),
        eq(teacherAllocations.section, opts.section),
        eq(teacherAllocations.subject, opts.subject),
      )
    );

    if (specificAlloc.length > 0) {
      const weeklyQuota = specificAlloc[0].weeklyQuota;
      const weeklyEntries = await db.select().from(timetableEntries).where(
        and(
          eq(timetableEntries.schoolId, schoolId),
          eq(timetableEntries.teacherId, teacherId),
          eq(timetableEntries.class, opts.class),
          eq(timetableEntries.section, opts.section),
          eq(timetableEntries.subject, opts.subject),
        )
      );
      const currentCount = weeklyEntries.filter(e => e.id !== (excludeId ?? -1)).length;
      if (currentCount >= weeklyQuota) {
        return { valid: false, error: `Quota exceeded: You are limited to ${weeklyQuota} ${opts.subject} periods/week for Class ${opts.class}-${opts.section}.` };
      }
    }

    return { valid: true };
  }

  async getTimetableByClassSection(schoolId: number, cls: string, section: string): Promise<(TimetableEntry & { teacherName: string })[]> {
    const result = await db.select().from(timetableEntries)
      .leftJoin(teachers, eq(timetableEntries.teacherId, teachers.id))
      .where(and(
        eq(timetableEntries.schoolId, schoolId),
        eq(timetableEntries.class, cls),
        eq(timetableEntries.section, section),
      ));
    return result.map(r => ({ ...r.timetable_entries, teacherName: r.teachers?.fullName ?? "" }));
  }

  async upsertTimetableSlot(
    schoolId: number,
    opts: { dayOfWeek: number; period: number; class: string; section: string; teacherId: number; subject: string }
  ): Promise<TimetableEntry> {
    const existing = await db.select().from(timetableEntries).where(
      and(
        eq(timetableEntries.schoolId, schoolId),
        eq(timetableEntries.class, opts.class),
        eq(timetableEntries.section, opts.section),
        eq(timetableEntries.dayOfWeek, opts.dayOfWeek),
        eq(timetableEntries.period, opts.period),
      )
    );
    if (existing.length > 0) {
      const [updated] = await db.update(timetableEntries)
        .set({ teacherId: opts.teacherId, subject: opts.subject, status: "draft" })
        .where(and(eq(timetableEntries.id, existing[0].id), eq(timetableEntries.schoolId, schoolId)))
        .returning();
      return updated;
    }
    const [created] = await db.insert(timetableEntries).values({
      schoolId,
      teacherId: opts.teacherId,
      dayOfWeek: opts.dayOfWeek,
      period: opts.period,
      class: opts.class,
      section: opts.section,
      subject: opts.subject,
      status: "draft",
    }).returning();
    return created;
  }

  async deleteTimetableSlot(schoolId: number, cls: string, section: string, dayOfWeek: number, period: number): Promise<boolean> {
    const result = await db.delete(timetableEntries).where(
      and(
        eq(timetableEntries.schoolId, schoolId),
        eq(timetableEntries.class, cls),
        eq(timetableEntries.section, section),
        eq(timetableEntries.dayOfWeek, dayOfWeek),
        eq(timetableEntries.period, period),
      )
    ).returning();
    return result.length > 0;
  }

  async checkSlotOccupancy(schoolId: number, cls: string, section: string, dayOfWeek: number, period: number, excludeTeacherId?: number): Promise<{ occupied: boolean; teacherName: string; teacherId: number; subject: string } | null> {
    const rows = await db.select().from(timetableEntries)
      .innerJoin(teachers, eq(timetableEntries.teacherId, teachers.id))
      .where(and(
        eq(timetableEntries.schoolId, schoolId),
        eq(timetableEntries.class, cls),
        eq(timetableEntries.section, section),
        eq(timetableEntries.dayOfWeek, dayOfWeek),
        eq(timetableEntries.period, period),
      ));
    if (rows.length === 0) return null;
    const row = rows[0];
    if (excludeTeacherId !== undefined && row.timetable_entries.teacherId === excludeTeacherId) return null;
    return {
      occupied: true,
      teacherName: row.teachers.fullName,
      teacherId: row.timetable_entries.teacherId,
      subject: row.timetable_entries.subject,
    };
  }

  async upsertTeacherTimetableSlot(
    schoolId: number,
    teacherId: number,
    opts: { dayOfWeek: number; period: number; class: string; section: string; subject: string }
  ): Promise<TimetableEntry> {
    const existing = await db.select().from(timetableEntries).where(
      and(
        eq(timetableEntries.schoolId, schoolId),
        eq(timetableEntries.teacherId, teacherId),
        eq(timetableEntries.dayOfWeek, opts.dayOfWeek),
        eq(timetableEntries.period, opts.period),
      )
    );
    if (existing.length > 0) {
      const [updated] = await db.update(timetableEntries)
        .set({ class: opts.class, section: opts.section, subject: opts.subject, status: "draft" })
        .where(and(eq(timetableEntries.id, existing[0].id), eq(timetableEntries.schoolId, schoolId)))
        .returning();
      return updated;
    }
    const [created] = await db.insert(timetableEntries).values({
      schoolId,
      teacherId,
      dayOfWeek: opts.dayOfWeek,
      period: opts.period,
      class: opts.class,
      section: opts.section,
      subject: opts.subject,
      status: "draft",
    }).returning();
    return created;
  }

  async deleteTeacherTimetableSlot(schoolId: number, teacherId: number, dayOfWeek: number, period: number): Promise<boolean> {
    const result = await db.delete(timetableEntries).where(
      and(
        eq(timetableEntries.schoolId, schoolId),
        eq(timetableEntries.teacherId, teacherId),
        eq(timetableEntries.dayOfWeek, dayOfWeek),
        eq(timetableEntries.period, period),
      )
    ).returning();
    return result.length > 0;
  }

  // ===== TEACHER ALLOCATION METHODS =====
  async createTeacherAllocation(data: InsertTeacherAllocation): Promise<TeacherAllocation> {
    const [alloc] = await db.insert(teacherAllocations).values(data).returning();
    return alloc;
  }

  async getTeacherAllocationsBySchool(schoolId: number): Promise<(TeacherAllocation & { teacherName: string })[]> {
    const result = await db.select().from(teacherAllocations)
      .innerJoin(teachers, eq(teacherAllocations.teacherId, teachers.id))
      .where(eq(teacherAllocations.schoolId, schoolId));
    return result.map(r => ({ ...r.teacher_allocations, teacherName: r.teachers.fullName }));
  }

  async getTeacherAllocationsByTeacher(teacherId: number, schoolId: number): Promise<TeacherAllocation[]> {
    return await db.select().from(teacherAllocations).where(
      and(eq(teacherAllocations.teacherId, teacherId), eq(teacherAllocations.schoolId, schoolId))
    );
  }

  async deleteTeacherAllocation(id: number, schoolId: number): Promise<boolean> {
    const result = await db.delete(teacherAllocations).where(
      and(eq(teacherAllocations.id, id), eq(teacherAllocations.schoolId, schoolId))
    ).returning();
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

  async updateStudentLeaveStatus(id: number, status: string, reviewedBy: number, reviewerRole: string, rejectionReason?: string): Promise<StudentLeaveRequest> {
    const updateData: Record<string, unknown> = { status, reviewedBy, reviewerRole };
    if (rejectionReason !== undefined) updateData.rejectionReason = rejectionReason;
    const [req] = await db.update(studentLeaveRequests)
      .set(updateData)
      .where(eq(studentLeaveRequests.id, id)).returning();
    return req;
  }

  async getStudentLeavesByStudent(studentId: number): Promise<StudentLeaveRequest[]> {
    return await db.select().from(studentLeaveRequests)
      .where(eq(studentLeaveRequests.studentId, studentId))
      .orderBy(desc(studentLeaveRequests.createdAt));
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
    const conditions = [eq(students.schoolId, schoolId), eq(students.isActive, true)];
    if (cls) conditions.push(eq(students.class, cls));
    if (section) conditions.push(eq(students.section, section));
    if (q) conditions.push(or(ilike(students.name, `%${q}%`), ilike(students.digitalStudentId, `%${q}%`), ilike(students.phone, `%${q}%`))!);
    const [{ total }] = await db.select({ total: count() }).from(students).where(and(...conditions));
    const data = await db.select().from(students).where(and(...conditions)).orderBy(students.digitalStudentId).limit(limit).offset(offset);
    return { data, total: Number(total) };
  }

  async updateStudent(id: number, schoolId: number, data: { name: string; class: string; section: string; phone: string }): Promise<Student | undefined> {
    const [updated] = await db.update(students)
      .set({ name: data.name, class: data.class, section: data.section, phone: data.phone })
      .where(and(eq(students.id, id), eq(students.schoolId, schoolId)))
      .returning();
    return updated;
  }

  // ===== PAGINATED TEACHERS (Big Data) =====
  async updateTeacherAssignment(teacherId: number, schoolId: number, data: { fullName: string; subject: string; assignedClass: string; assignedSection: string }): Promise<Teacher | undefined> {
    const [updated] = await db.update(teachers)
      .set({ fullName: data.fullName, subject: data.subject, assignedClass: data.assignedClass, assignedSection: data.assignedSection })
      .where(and(eq(teachers.id, teacherId), eq(teachers.schoolId, schoolId)))
      .returning();
    return updated;
  }

  async getTeachersPaginated(schoolId: number, opts: { q?: string; page?: number }): Promise<{ data: (Teacher & { email: string })[]; total: number }> {
    const { q, page = 1 } = opts;
    const limit = 20;
    const offset = (page - 1) * limit;
    const baseConditions = [eq(teachers.schoolId, schoolId), eq(users.isActive, true)];
    if (q) {
      baseConditions.push(or(
        ilike(teachers.fullName, `%${q}%`),
        ilike(teachers.subject, `%${q}%`),
        ilike(users.email, `%${q}%`)
      )!);
    }
    const [{ total }] = await db.select({ total: count() }).from(teachers)
      .innerJoin(users, eq(teachers.userId, users.id))
      .where(and(...baseConditions));
    const rows = await db.select().from(teachers)
      .innerJoin(users, eq(teachers.userId, users.id))
      .where(and(...baseConditions)).orderBy(teachers.fullName).limit(limit).offset(offset);
    return { data: rows.map(r => ({ ...r.teachers, email: r.users.email })), total: Number(total) };
  }

  // ===== DEACTIVATION (Soft Delete) =====
  async deactivateStudent(studentId: number): Promise<Student> {
    const [s] = await db.update(students).set({ isActive: false }).where(eq(students.id, studentId)).returning();
    return s;
  }

  async deactivateTeacher(teacherId: number): Promise<void> {
    const teacher = await this.getTeacherById(teacherId);
    if (!teacher) return;
    await db.update(users).set({ isActive: false }).where(eq(users.id, teacher.userId));
  }

  async verifyAdminPassword(userId: number, password: string): Promise<boolean> {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) return false;
    const bcrypt = await import("bcryptjs");
    return bcrypt.compare(password, user.passwordHash);
  }

  async getStudentCountBySchoolActive(schoolId: number): Promise<number> {
    const [result] = await db
      .select({ value: count() })
      .from(students)
      .where(and(eq(students.schoolId, schoolId), eq(students.isActive, true)));
    return result?.value ?? 0;
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

  // ===== STUDENT PROFILES =====
  async getStudentProfile(studentId: number): Promise<StudentProfile | undefined> {
    const [profile] = await db.select().from(studentProfiles).where(eq(studentProfiles.studentId, studentId));
    return profile || undefined;
  }

  async upsertStudentProfile(
    data: Omit<InsertStudentProfile, "status" | "submittedAt" | "verifiedAt" | "verifiedBy" | "rejectionNote">,
    statusOverride?: string,
  ): Promise<StudentProfile> {
    const existing = await this.getStudentProfile(data.studentId);
    if (existing) {
      const setData: Record<string, unknown> = { ...data, updatedAt: new Date() };
      if (statusOverride) setData.status = statusOverride;
      const [updated] = await db
        .update(studentProfiles)
        .set(setData as Partial<InsertStudentProfile>)
        .where(eq(studentProfiles.studentId, data.studentId))
        .returning();
      return updated;
    } else {
      const [created] = await db
        .insert(studentProfiles)
        .values({ ...data, status: "draft", photoStatus: "none" })
        .returning();
      return created;
    }
  }

  async submitStudentProfile(studentId: number): Promise<StudentProfile> {
    const [updated] = await db
      .update(studentProfiles)
      .set({ status: "pending", submittedAt: new Date(), updatedAt: new Date(), rejectionNote: null })
      .where(eq(studentProfiles.studentId, studentId))
      .returning();
    return updated;
  }

  async updateStudentProfilePhoto(studentId: number, photoUrl: string): Promise<StudentProfile> {
    const existing = await this.getStudentProfile(studentId);
    if (!existing) {
      const student = await this.getStudentById(studentId);
      if (!student) throw new Error("Student not found");
      const [created] = await db
        .insert(studentProfiles)
        .values({ studentId, schoolId: student.schoolId, status: "draft", photoUrl, photoStatus: "pending" })
        .returning();
      return created;
    }
    const resetFields: Record<string, unknown> = { photoUrl, photoStatus: "pending", updatedAt: new Date() };
    if (existing && existing.status === "approved") {
      resetFields.status = "draft";
      resetFields.verifiedAt = null;
      resetFields.verifiedBy = null;
    }
    const [updated] = await db
      .update(studentProfiles)
      .set(resetFields as Partial<typeof studentProfiles.$inferInsert>)
      .where(eq(studentProfiles.studentId, studentId))
      .returning();
    return updated;
  }

  async getPendingProfilesForTeacher(schoolId: number, cls: string, section: string): Promise<(StudentProfile & { studentName: string; dsid: string; currentVerifiedProfile: string | null })[]> {
    const profiles = await db
      .select()
      .from(studentProfiles)
      .where(and(eq(studentProfiles.schoolId, schoolId), eq(studentProfiles.status, "pending")))
      .orderBy(desc(studentProfiles.submittedAt));
    const result = [];
    for (const p of profiles) {
      const student = await this.getStudentById(p.studentId);
      if (!student) continue;
      if (student.class !== cls || student.section !== section) continue;
      result.push({ ...p, studentName: student.name, dsid: student.digitalStudentId, currentVerifiedProfile: student.verifiedProfile || null });
    }
    return result;
  }

  async bulkApproveStudentProfiles(studentIds: number[], teacherId: number): Promise<{ approved: number; skipped: number }> {
    const eligible: { studentId: number; snapshot: string }[] = [];
    const photoUpdates: { studentId: number; photoUrl: string }[] = [];

    for (const studentId of studentIds) {
      const existing = await this.getStudentProfile(studentId);
      if (!existing || existing.status !== "pending") continue;
      const snap = JSON.stringify({
        fullName: existing.fullName, class: existing.class, section: existing.section,
        rollNo: existing.rollNo, fatherName: existing.fatherName, motherName: existing.motherName,
        presentAddress: existing.presentAddress, photoUrl: existing.photoUrl, approvedAt: new Date().toISOString(),
      });
      eligible.push({ studentId, snapshot: snap });
      if (existing.photoUrl) photoUpdates.push({ studentId, photoUrl: existing.photoUrl });
    }

    const skipped = studentIds.length - eligible.length;

    if (eligible.length === 0) return { approved: 0, skipped };

    await db.transaction(async (tx) => {
      const now = new Date();
      for (const { studentId, snapshot } of eligible) {
        await tx.update(studentProfiles).set({
          status: "approved",
          verifiedAt: now,
          verifiedBy: teacherId,
          photoStatus: "approved",
          approvedSnapshot: snapshot,
          updatedAt: now,
        }).where(eq(studentProfiles.studentId, studentId));

        const verifiedJson = JSON.stringify({
          ...JSON.parse(snapshot),
          verifiedAt: now.toISOString(),
        });
        await tx.update(students).set({ verifiedProfile: verifiedJson }).where(eq(students.id, studentId));
      }
      for (const { studentId, photoUrl } of photoUpdates) {
        await tx.update(students).set({ photoUrl }).where(eq(students.id, studentId));
      }
    });

    return { approved: eligible.length, skipped };
  }

  async approveStudentProfile(studentId: number, teacherId: number): Promise<StudentProfile> {
    const existing = await this.getStudentProfile(studentId);
    const snapshot = existing
      ? JSON.stringify({
          fullName: existing.fullName,
          class: existing.class,
          section: existing.section,
          rollNo: existing.rollNo,
          fatherName: existing.fatherName,
          motherName: existing.motherName,
          presentAddress: existing.presentAddress,
          photoUrl: existing.photoUrl,
          approvedAt: new Date().toISOString(),
        })
      : null;
    const [updated] = await db
      .update(studentProfiles)
      .set({
        status: "approved",
        verifiedAt: new Date(),
        verifiedBy: teacherId,
        photoStatus: "approved",
        approvedSnapshot: snapshot,
        updatedAt: new Date(),
      })
      .where(eq(studentProfiles.studentId, studentId))
      .returning();
    return updated;
  }

  async rejectStudentProfile(studentId: number, teacherId: number, note: string): Promise<StudentProfile> {
    const [updated] = await db
      .update(studentProfiles)
      .set({ status: "rejected", verifiedAt: new Date(), verifiedBy: teacherId, rejectionNote: note, updatedAt: new Date() })
      .where(eq(studentProfiles.studentId, studentId))
      .returning();
    return updated;
  }

  async updateStudentPassword(studentId: number, passwordHash: string): Promise<void> {
    await db.update(students).set({ passwordHash }).where(eq(students.id, studentId));
  }

  async getPendingProfilesCountForTeacher(schoolId: number, cls: string, section: string): Promise<number> {
    const profiles = await this.getPendingProfilesForTeacher(schoolId, cls, section);
    return profiles.length;
  }

  // ===== STUDENT ATTENDANCE (Student-Facing) =====

  async getStudentMonthlyAttendance(studentId: number, schoolId: number, year: number, month: number): Promise<{
    date: string;
    dayOfWeek: number;
    status: string;
    teacherId: number | null;
    markedBy: string | null;
    isHoliday: boolean;
    holidayName: string | null;
    isApprovedLeave: boolean;
    isSunday: boolean;
    isFuture: boolean;
  }[]> {
    const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    const today = new Date().toISOString().split("T")[0];

    const records = await db.select().from(attendanceRecords).where(
      and(
        eq(attendanceRecords.schoolId, schoolId),
        eq(attendanceRecords.studentId, studentId),
        gte(attendanceRecords.date, startDate),
        lte(attendanceRecords.date, endDate)
      )
    );

    const holidays = await db.select().from(calendarEvents).where(
      and(
        eq(calendarEvents.schoolId, schoolId),
        eq(calendarEvents.eventType, "holiday"),
        gte(calendarEvents.date, startDate),
        lte(calendarEvents.date, endDate)
      )
    );

    const leaves = await db.select().from(studentLeaveRequests).where(
      and(
        eq(studentLeaveRequests.schoolId, schoolId),
        eq(studentLeaveRequests.studentId, studentId),
        eq(studentLeaveRequests.status, "approved"),
        lte(studentLeaveRequests.startDate, endDate),
        gte(studentLeaveRequests.endDate, startDate)
      )
    );

    const result = [];
    for (let day = 1; day <= lastDay; day++) {
      const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const d = new Date(year, month - 1, day);
      const dayOfWeek = d.getDay();
      const isSunday = dayOfWeek === 0;
      const isFuture = dateStr > today;

      const record = records.find(r => r.date === dateStr);
      const holiday = holidays.find(h => h.date === dateStr);
      const isApprovedLeave = leaves.some(l => l.startDate <= dateStr && l.endDate >= dateStr);

      result.push({
        date: dateStr,
        dayOfWeek,
        status: record?.status || "none",
        teacherId: record?.teacherId ?? null,
        markedBy: record?.markedBy || null,
        isHoliday: !!holiday,
        holidayName: holiday?.title || null,
        isApprovedLeave,
        isSunday,
        isFuture,
      });
    }

    return result;
  }

  async getStudentYearlyAttendance(studentId: number, schoolId: number, startDate: string, endDate: string): Promise<{
    month: number;
    year: number;
    present: number;
    absent: number;
    halfDay: number;
    leave: number;
    holiday: number;
    workingDays: number;
    total: number;
  }[]> {
    const records = await db.select().from(attendanceRecords).where(
      and(
        eq(attendanceRecords.schoolId, schoolId),
        eq(attendanceRecords.studentId, studentId),
        gte(attendanceRecords.date, startDate),
        lte(attendanceRecords.date, endDate)
      )
    );

    const holidays = await db.select().from(calendarEvents).where(
      and(
        eq(calendarEvents.schoolId, schoolId),
        eq(calendarEvents.eventType, "holiday"),
        gte(calendarEvents.date, startDate),
        lte(calendarEvents.date, endDate)
      )
    );

    const leaves = await db.select().from(studentLeaveRequests).where(
      and(
        eq(studentLeaveRequests.schoolId, schoolId),
        eq(studentLeaveRequests.studentId, studentId),
        eq(studentLeaveRequests.status, "approved"),
        lte(studentLeaveRequests.startDate, endDate),
        gte(studentLeaveRequests.endDate, startDate)
      )
    );

    const today = new Date().toISOString().split("T")[0];
    const start = new Date(startDate);
    const end = new Date(endDate);
    const monthMap = new Map<string, { month: number; year: number; present: number; absent: number; halfDay: number; leave: number; holiday: number; workingDays: number; total: number }>();

    let cur = new Date(start);
    while (cur <= end) {
      const key = `${cur.getFullYear()}-${cur.getMonth() + 1}`;
      if (!monthMap.has(key)) {
        monthMap.set(key, { month: cur.getMonth() + 1, year: cur.getFullYear(), present: 0, absent: 0, halfDay: 0, leave: 0, holiday: 0, workingDays: 0, total: 0 });
      }
      const dateStr = cur.toISOString().split("T")[0];
      const isSunday = cur.getDay() === 0;
      const isFuture = dateStr > today;
      if (!isSunday && !isFuture) {
        const bucket = monthMap.get(key)!;
        bucket.total++;
        const isHoliday = holidays.some(h => h.date === dateStr);
        if (isHoliday) {
          bucket.holiday++;
        } else {
          const isLeave = leaves.some(l => l.startDate <= dateStr && l.endDate >= dateStr);
          const record = records.find(r => r.date === dateStr);
          bucket.workingDays++;
          if (isLeave && !record) {
            bucket.leave++;
          } else if (record) {
            const s = record.status;
            if (s === "present") bucket.present++;
            else if (s === "absent") bucket.absent++;
            else if (s === "half_day" || s === "late") bucket.halfDay++;
            else if (s === "leave") bucket.leave++;
            else bucket.present++;
          }
        }
      }
      cur.setDate(cur.getDate() + 1);
    }

    return Array.from(monthMap.values());
  }

  async getStudentAttendanceStats(studentId: number, schoolId: number, academicStartDate: string, academicEndDate?: string): Promise<{
    overallPercent: number;
    workingDays: number;
    totalPresent: number;
    totalAbsent: number;
    totalHalfDay: number;
    totalLeave: number;
  }> {
    const today = new Date().toISOString().split("T")[0];
    const upperBound = academicEndDate && academicEndDate < today ? academicEndDate : today;

    const records = await db.select().from(attendanceRecords).where(
      and(
        eq(attendanceRecords.schoolId, schoolId),
        eq(attendanceRecords.studentId, studentId),
        gte(attendanceRecords.date, academicStartDate),
        lte(attendanceRecords.date, upperBound)
      )
    );

    const holidays = await db.select().from(calendarEvents).where(
      and(
        eq(calendarEvents.schoolId, schoolId),
        eq(calendarEvents.eventType, "holiday"),
        gte(calendarEvents.date, academicStartDate),
        lte(calendarEvents.date, upperBound)
      )
    );

    const leaves = await db.select().from(studentLeaveRequests).where(
      and(
        eq(studentLeaveRequests.schoolId, schoolId),
        eq(studentLeaveRequests.studentId, studentId),
        eq(studentLeaveRequests.status, "approved"),
        lte(studentLeaveRequests.startDate, upperBound),
        gte(studentLeaveRequests.endDate, academicStartDate)
      )
    );

    let workingDays = 0, totalPresent = 0, totalAbsent = 0, totalHalfDay = 0, totalLeave = 0;

    const start = new Date(academicStartDate);
    const end = new Date(upperBound);
    let cur = new Date(start);

    while (cur <= end) {
      const dateStr = cur.toISOString().split("T")[0];
      const isSunday = cur.getDay() === 0;
      if (!isSunday) {
        const isHoliday = holidays.some(h => h.date === dateStr);
        if (!isHoliday) {
          workingDays++;
          const isLeave = leaves.some(l => l.startDate <= dateStr && l.endDate >= dateStr);
          const record = records.find(r => r.date === dateStr);
          if (isLeave && !record) {
            totalLeave++;
          } else if (record) {
            const s = record.status;
            if (s === "present") totalPresent++;
            else if (s === "absent") totalAbsent++;
            else if (s === "half_day" || s === "late") totalHalfDay++;
            else if (s === "leave") totalLeave++;
            else totalPresent++;
          }
        }
      }
      cur.setDate(cur.getDate() + 1);
    }

    const effectivePresent = totalPresent + totalHalfDay * 0.5 + totalLeave;
    const overallPercent = workingDays > 0 ? Math.round((effectivePresent / workingDays) * 1000) / 10 : 0;

    return { overallPercent, workingDays, totalPresent, totalAbsent, totalHalfDay, totalLeave };
  }

  // ===== ACADEMIC ADVANCEMENT WIZARD =====

  async getExamAggregated(schoolId: number, cls: string, section: string, examType: string): Promise<{
    studentId: number; dsid: string; name: string;
    totalObtained: number; totalMax: number; percentage: number; subjects: string[];
  }[]> {
    const rows = await db.select().from(examScores)
      .innerJoin(students, and(eq(examScores.studentId, students.id), eq(students.schoolId, schoolId)))
      .where(and(
        eq(examScores.schoolId, schoolId),
        eq(examScores.class, cls),
        eq(examScores.section, section),
        eq(examScores.examType, examType),
      ));

    const byStudent: Record<number, { dsid: string; name: string; obtained: number; total: number; subjects: string[] }> = {};
    for (const r of rows) {
      const sid = r.exam_scores.studentId;
      if (!byStudent[sid]) byStudent[sid] = { dsid: r.students.digitalStudentId, name: r.students.name, obtained: 0, total: 0, subjects: [] };
      if (!r.exam_scores.isAbsent) byStudent[sid].obtained += r.exam_scores.marks;
      byStudent[sid].total += r.exam_scores.totalMarks;
      if (!byStudent[sid].subjects.includes(r.exam_scores.subject)) byStudent[sid].subjects.push(r.exam_scores.subject);
    }

    return Object.entries(byStudent).map(([id, d]) => ({
      studentId: parseInt(id),
      dsid: d.dsid,
      name: d.name,
      totalObtained: d.obtained,
      totalMax: d.total,
      percentage: d.total > 0 ? parseFloat(((d.obtained / d.total) * 100).toFixed(2)) : 0,
      subjects: d.subjects,
    })).sort((a, b) => a.dsid.localeCompare(b.dsid));
  }

  async upsertPromotionOverride(data: {
    schoolId: number; studentId: number; examType: string; class: string; section: string;
    overrideStatus: string; nextClass: string; nextSection: string;
  }): Promise<void> {
    await db.insert(promotionOverrides).values(data)
      .onConflictDoUpdate({
        target: [promotionOverrides.schoolId, promotionOverrides.studentId, promotionOverrides.examType, promotionOverrides.class, promotionOverrides.section],
        set: { overrideStatus: data.overrideStatus, nextClass: data.nextClass, nextSection: data.nextSection, overriddenAt: new Date() },
      });
  }

  async getPromotionOverrides(schoolId: number, cls: string, section: string, examType: string): Promise<PromotionOverride[]> {
    return await db.select().from(promotionOverrides).where(and(
      eq(promotionOverrides.schoolId, schoolId),
      eq(promotionOverrides.class, cls),
      eq(promotionOverrides.section, section),
      eq(promotionOverrides.examType, examType),
    ));
  }

  async bulkPromoteStudents(schoolId: number, items: { studentId: number; nextClass: string; nextSection: string }[]): Promise<number> {
    let promoted = 0;
    await db.transaction(async (tx) => {
      for (const item of items) {
        const updated = await tx.update(students)
          .set({ class: item.nextClass, section: item.nextSection })
          .where(and(eq(students.id, item.studentId), eq(students.schoolId, schoolId)))
          .returning();
        if (updated.length > 0) promoted++;
      }
    });
    return promoted;
  }

  // ===== GRADING TIERS =====

  async getGradingTiers(schoolId: number): Promise<GradingTier[]> {
    return await db.select().from(gradingTiers)
      .where(eq(gradingTiers.schoolId, schoolId))
      .orderBy(gradingTiers.sortOrder);
  }

  async upsertGradingTier(data: InsertGradingTier & { id?: number }): Promise<GradingTier> {
    if (data.id) {
      const { id, ...rest } = data;
      const [updated] = await db.update(gradingTiers)
        .set(rest)
        .where(and(eq(gradingTiers.id, id), eq(gradingTiers.schoolId, data.schoolId)))
        .returning();
      return updated;
    }
    const [inserted] = await db.insert(gradingTiers).values(data).returning();
    return inserted;
  }

  async deleteGradingTier(id: number, schoolId: number): Promise<void> {
    await db.delete(gradingTiers)
      .where(and(eq(gradingTiers.id, id), eq(gradingTiers.schoolId, schoolId)));
  }

  // ===== GRADING RULES =====

  async getGradingRules(schoolId: number, tierId?: number): Promise<GradingRule[]> {
    const conditions = tierId
      ? and(eq(gradingRules.schoolId, schoolId), eq(gradingRules.tierId, tierId))
      : eq(gradingRules.schoolId, schoolId);
    return await db.select().from(gradingRules)
      .where(conditions)
      .orderBy(gradingRules.tierId, gradingRules.sortOrder);
  }

  async replaceGradingRules(tierId: number, schoolId: number, rules: Omit<GradingRule, "id" | "tierId" | "schoolId">[]): Promise<GradingRule[]> {
    await db.delete(gradingRules)
      .where(and(eq(gradingRules.tierId, tierId), eq(gradingRules.schoolId, schoolId)));
    if (rules.length === 0) return [];
    const inserted = await db.insert(gradingRules)
      .values(rules.map((r, i) => ({ ...r, tierId, schoolId, sortOrder: i })))
      .returning();
    return inserted;
  }

  // ===== ACADEMIC HISTORY =====

  async archiveStudentHistory(records: InsertAcademicHistory[]): Promise<void> {
    if (records.length === 0) return;
    await db.insert(academicHistory).values(records);
  }

  async getAcademicHistory(schoolId: number, studentId?: number): Promise<typeof academicHistory.$inferSelect[]> {
    const conditions = studentId
      ? and(eq(academicHistory.schoolId, schoolId), eq(academicHistory.studentId, studentId))
      : eq(academicHistory.schoolId, schoolId);
    return await db.select().from(academicHistory)
      .where(conditions)
      .orderBy(desc(academicHistory.archivedAt));
  }

  // ===== ASSET LIFECYCLE MANAGER =====

  async getAssets(schoolId: number): Promise<SchoolAsset[]> {
    return await db.select().from(schoolAssets)
      .where(eq(schoolAssets.schoolId, schoolId))
      .orderBy(desc(schoolAssets.createdAt));
  }

  async createAsset(data: InsertSchoolAsset): Promise<SchoolAsset> {
    const [asset] = await db.insert(schoolAssets).values(data).returning();
    const code = `AST-${String(asset.id).padStart(4, "0")}`;
    const [updated] = await db.update(schoolAssets).set({ assetCode: code }).where(eq(schoolAssets.id, asset.id)).returning();
    return updated;
  }

  async updateAsset(id: number, schoolId: number, data: { quantity?: number; condition?: string; location?: string }): Promise<SchoolAsset | null> {
    const [updated] = await db.update(schoolAssets)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(schoolAssets.id, id), eq(schoolAssets.schoolId, schoolId)))
      .returning();
    return updated || null;
  }

  async deleteAsset(id: number, schoolId: number): Promise<boolean> {
    const result = await db.delete(schoolAssets)
      .where(and(eq(schoolAssets.id, id), eq(schoolAssets.schoolId, schoolId)))
      .returning();
    return result.length > 0;
  }

  async getAssetById(id: number, schoolId: number): Promise<SchoolAsset | null> {
    const [asset] = await db.select().from(schoolAssets)
      .where(and(eq(schoolAssets.id, id), eq(schoolAssets.schoolId, schoolId)));
    return asset || null;
  }

  async logAssetActivity(entry: InsertAssetLog): Promise<void> {
    await db.insert(assetLogs).values(entry);
  }

  // ===== TIER-AWARE GRADING HELPER =====

  async resolveGrade(schoolId: number, studentClass: string, percentage: number): Promise<{
    passPercentage: number; gradeLabel: string | null; gradePoint: string | null; remarks: string | null;
  }> {
    const tiers = await this.getGradingTiers(schoolId);
    const allRules = await this.getGradingRules(schoolId);
    const matchedTier = tiers.find(t => {
      const allClasses = ["LKG","UKG","1","2","3","4","5","6","7","8","9","10","11","12"];
      const minIdx = allClasses.indexOf(t.minClass);
      const maxIdx = allClasses.indexOf(t.maxClass);
      const curIdx = allClasses.indexOf(studentClass);
      return curIdx !== -1 && curIdx >= minIdx && curIdx <= maxIdx;
    });
    if (!matchedTier) return { passPercentage: 35, gradeLabel: null, gradePoint: null, remarks: null };
    const tierRules = allRules.filter(r => r.tierId === matchedTier.id)
      .sort((a, b) => b.minPercent - a.minPercent);
    const matchedRule = tierRules.find(r => percentage >= r.minPercent && percentage <= r.maxPercent);
    return {
      passPercentage: matchedTier.passPercentage,
      gradeLabel: matchedRule?.gradeLabel ?? null,
      gradePoint: matchedRule?.gradePoint ?? null,
      remarks: matchedRule?.remarks ?? null,
    };
  }
}

export const storage = new DatabaseStorage();
