import {
  schools, students, users, teachers,
  attendanceRecords, homework, homeworkViews, homeworkSubmissions, classwork, notices, noticeReads,
  complaints, complaintNotes, complaintStudents, examScores, galleryItems, calendarEvents,
  libraryBooks, bookBorrows, leaveRequests, timetableEntries, schoolMetadata,
  studentLeaveRequests, auditLogs, visitorLogs, studentProfiles, teacherAllocations,
  promotionOverrides, gradingTiers, gradingRules, academicHistory,
  schoolAssets, assetLogs, verificationLogs, timetableStructure, securityAudit, leavePolicies,
  nonTeachingStaff, facultyMappings, feeRecords, examPolicyTiers, promotionDecisions,
  academicSessions, enrollments, removedTeachersLog,
  feeStructures, paymentRecords, feeAuditLog, externalPaymentSettings,
  notificationConfig, dunningLog, passwordResetChallenges,
  studentPasswordResetChallenges,
  type FeeStructure, type InsertFeeStructure,
  type PaymentRecord, type InsertPaymentRecord,
  type FeeAuditLog,
  type ExternalPaymentSettings,
  type NotificationConfig, type DunningLog,
  type RemovedTeacherLog,
  type PromotionDecision,
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
  type GradingRule as StoredGradingRule,
  type InsertAcademicHistory,
  type SchoolAsset, type InsertSchoolAsset,
  type InsertAssetLog,
  type TimetableStructure, type InsertTimetableStructure,
  type LeavePolicy, type InsertLeavePolicy,
  type NonTeachingStaff, type InsertNonTeachingStaff,
  type FacultyMapping, type InsertFacultyMapping,
  type FeeRecord, type InsertFeeRecord,
  type ExamPolicyTier, type InsertExamPolicyTier,
  type AcademicSession, type InsertAcademicSession,
  type Enrollment, type InsertEnrollment,
  type PasswordResetChallenge,
  type StudentPasswordResetChallenge,
} from "@shared/schema";
import { addCalendarDays, calendarDayDifference, calendarWeekday, dateOnlyInIST, dateOnlyParts, isValidDateOnly, todayInIST } from "@shared/ist-time";
import { isAttendanceDateInSession } from "@shared/attendance-session-date";
import { db } from "./db";
import { pool } from "./db";
import { eq, sql, like, count, and, desc, gte, gt, lte, lt, or, ilike, isNull, isNotNull, inArray, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import {
  aggregateStudentAttendance,
  type StudentAttendanceAggregation,
} from "./student-attendance-calculation";
import { getStudentAttendanceWorkingDates } from "./student-attendance-working-days";
import {
  CURRENT_FEE_AUDIT_ACTION_OPTIONS,
  feeAuditActionLabel,
  normalizeFeeAuditActorDisplay,
  safeFeeAuditDescription,
  safeFeeAuditRecordLabel,
} from "./fee-audit";
import { evaluatePromotionRules, selectGrade } from "@shared/examination-calculation-engine";
import { percentageToDatabaseValue, percentageToHundredths } from "@shared/grading-percentage";
import {
  SESSION_REVOCATION_TTL_MS,
  studentSessionRevocationSid,
  userSessionRevocationSid,
} from "./session-revocation";
import {
  generatePasswordRecoveryToken,
  hashPasswordRecoverySecret,
  passwordRecoverySecretsEqual,
} from "./password-recovery-crypto";

function isValidStudentRecoveryEmail(email: string | null): email is string {
  return typeof email === "string"
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

type GradingRule = Omit<StoredGradingRule, "minPercent" | "maxPercent"> & {
  minPercent: number;
  maxPercent: number;
};

type GradingRuleWrite = Omit<GradingRule, "id" | "tierId" | "schoolId">;

function normalizeStoredGradingRule(rule: StoredGradingRule): GradingRule {
  const minPercent = Number(rule.minPercent);
  const maxPercent = Number(rule.maxPercent);
  percentageToHundredths(minPercent, "Stored grading rule minimum");
  percentageToHundredths(maxPercent, "Stored grading rule maximum");
  return { ...rule, minPercent, maxPercent };
}

/**
 * Financial history cannot be detached from its original academic session.
 * Sessions with fee/payment evidence must be archived rather than deleted.
 */
export class AcademicSessionFinancialHistoryError extends Error {
  readonly status = 409;
  readonly code = "SESSION_HAS_FINANCIAL_HISTORY";

  constructor() {
    super("This academic session has financial history and cannot be deleted. Archive it instead.");
    this.name = "AcademicSessionFinancialHistoryError";
  }
}

export class AttendanceLeaveMutationError extends Error {
  constructor(message: string, readonly status: number = 409) {
    super(message);
    this.name = "AttendanceLeaveMutationError";
  }
}

export class TeacherEmailConflictError extends Error {
  readonly status = 409;

  constructor() {
    super("Unable to update teacher");
    this.name = "TeacherEmailConflictError";
  }
}

const UNSAFE_FEE_AUDIT_SEARCH_PATTERN = String.raw`(^|[^[:alnum:]])(pay|order|rfnd|disp|evt|plink|inv|cust|card)_[[:alnum:]_-]+|(^|[^[:alnum:]_])(signature|token|secret)[[:space:]]*[:=]|(raw_response|payload|gateway_response|error_code|error_source|error_step|error_reason|payer_contact|payer_email|contact|phone|mobile|vpa|card_last4)[[:space:]]*[:=]|[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}|(^|[^0-9])(\+?91[ -]?)?[6-9][0-9]{9}([^0-9]|$)|([0-9][ -]?){13,19}|([0-9]{1,3}\.){3}[0-9]{1,3}|([[:xdigit:]]{0,4}:){2,}[[:xdigit:].:]{0,}|[[:xdigit:]]{32,}|[[:alnum:]+/_=-]{40,}`;

/**
 * Stored legacy prose can predate the audit redaction contract. Exclude an
 * entire unsafe value from the searchable projection so hidden technical
 * evidence cannot be discovered through result membership.
 */
function searchableFeeAuditText(column: SQL): SQL {
  return sql`CASE
    WHEN COALESCE(${column}, '') ~* ${UNSAFE_FEE_AUDIT_SEARCH_PATTERN} THEN ''
    ELSE COALESCE(${column}, '')
  END`;
}

function buildCalendarAudienceFilter(
  filter?: Array<{ cls: string; sec?: string }>
): SQL | undefined {
  if (!filter || filter.length === 0) return undefined;
  const clauses: SQL[] = [eq(calendarEvents.audienceScope, "All_School")];
  for (const { cls, sec } of filter) {
    clauses.push(
      and(eq(calendarEvents.audienceScope, "Entire_Class"), eq(calendarEvents.targetClass, cls)) as SQL
    );
    if (sec) {
      clauses.push(
        and(
          eq(calendarEvents.audienceScope, "Specific_Section"),
          eq(calendarEvents.targetClass, cls),
          eq(calendarEvents.targetSection, sec)
        ) as SQL
      );
    }
    // Multi_Target: targetClass is a JSON array of classIds; targetSection is a JSON map of classId→sectionIds[]
    // Class matches if classId is in the JSON array.
    // Section matches if sectionIds is empty (= entire class) OR contains the requested section.
    clauses.push(
      sql`CASE WHEN ${calendarEvents.audienceScope} = 'Multi_Target' THEN (
        ${calendarEvents.targetClass}::jsonb @> ${JSON.stringify([cls])}::jsonb
        AND (
          COALESCE(jsonb_array_length(${calendarEvents.targetSection}::jsonb -> ${cls}), 0) = 0
          ${sec ? sql`OR ${calendarEvents.targetSection}::jsonb -> ${cls} @> ${JSON.stringify([sec])}::jsonb` : sql``}
        )
      ) ELSE FALSE END` as unknown as SQL
    );
  }
  return or(...clauses) as SQL;
}

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
        // The creator is the initial explicitly authorised financial admin.
        // Later administrators are not automatically granted refund power.
        canRefund: true,
        schoolId: school.id,
      });
      return school;
    });
  }

  async deleteSchool(id: number): Promise<boolean> {
    return await db.transaction(async (tx) => {
      // The payment-attempt event table is append-only during ordinary
      // application operation. Deleting an entire tenant is the authorized
      // erasure path, so enable the database's transaction-local cascade guard
      // only for this controlled operation.
      await tx.execute(sql`SELECT set_config('app.payment_history_cleanup', 'on', true)`);
      await tx.execute(sql`SELECT set_config('app.fee_audit_cleanup', 'on', true)`);
      const result = await tx.delete(schools).where(eq(schools.id, id)).returning();
      return result.length > 0;
    });
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user || undefined;
  }

  async getUserByRecoveryEmail(recoveryEmail: string, schoolId: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(
      and(eq(users.recoveryEmail, recoveryEmail), eq(users.schoolId, schoolId))
    );
    return user || undefined;
  }

  async createPasswordResetChallenge(
    userId: number,
    schoolId: number,
    otpHash: string,
    otpExpiresAt: Date,
    requestIp: string | null,
  ): Promise<PasswordResetChallenge> {
    return db.transaction(async (tx) => {
      await tx.update(passwordResetChallenges)
        .set({ consumedAt: new Date() })
        .where(and(
          eq(passwordResetChallenges.userId, userId),
          eq(passwordResetChallenges.schoolId, schoolId),
          isNull(passwordResetChallenges.consumedAt),
        ));
      const [challenge] = await tx.insert(passwordResetChallenges).values({
        userId,
        schoolId,
        otpHash,
        otpExpiresAt,
        requestIp,
      }).returning();
      return challenge;
    });
  }

  async createTeacherPasswordResetChallenge(
    userId: number,
    teacherId: number,
    schoolId: number,
    otpHash: string,
    otpExpiresAt: Date,
    resetTokenHash: string,
    resetTokenExpiresAt: Date,
    requestIp: string | null,
    now = new Date(),
  ): Promise<PasswordResetChallenge | null> {
    return db.transaction(async (tx) => {
      const [account] = await tx.select({ userId: users.id, teacherId: teachers.id })
        .from(users)
        .innerJoin(teachers, eq(teachers.userId, users.id))
        .where(and(
          eq(users.id, userId),
          eq(users.schoolId, schoolId),
          eq(users.role, "teacher"),
          eq(users.isActive, true),
          eq(teachers.id, teacherId),
          eq(teachers.schoolId, schoolId),
          eq(teachers.isActive, true),
        ))
        .limit(1)
        .for("update");
      if (!account) return null;

      await tx.update(passwordResetChallenges)
        .set({ consumedAt: now })
        .where(and(
          eq(passwordResetChallenges.userId, userId),
          eq(passwordResetChallenges.schoolId, schoolId),
          isNull(passwordResetChallenges.consumedAt),
        ));
      const [challenge] = await tx.insert(passwordResetChallenges).values({
        userId,
        schoolId,
        otpHash,
        otpExpiresAt,
        resetTokenHash,
        resetTokenExpiresAt,
        attemptCount: 0,
        verifiedAt: null,
        consumedAt: null,
        requestIp,
      }).returning();
      return challenge;
    });
  }

  async getPasswordResetChallenge(id: number): Promise<PasswordResetChallenge | undefined> {
    const [challenge] = await db.select().from(passwordResetChallenges)
      .where(eq(passwordResetChallenges.id, id));
    return challenge || undefined;
  }

  async recordPasswordResetOtpFailure(id: number, now = new Date()): Promise<PasswordResetChallenge | undefined> {
    const [challenge] = await db.update(passwordResetChallenges)
      .set({
        attemptCount: sql`${passwordResetChallenges.attemptCount} + 1`,
        consumedAt: sql`CASE WHEN ${passwordResetChallenges.attemptCount} + 1 >= 5 THEN ${now} ELSE ${passwordResetChallenges.consumedAt} END`,
      })
      .where(and(
        eq(passwordResetChallenges.id, id),
        isNull(passwordResetChallenges.consumedAt),
        isNull(passwordResetChallenges.verifiedAt),
        gt(passwordResetChallenges.otpExpiresAt, now),
        lt(passwordResetChallenges.attemptCount, 5),
      ))
      .returning();
    return challenge || undefined;
  }

  async verifyPasswordResetOtp(
    id: number,
    otpHash: string,
    resetTokenHash: string,
    resetTokenExpiresAt: Date,
    now = new Date(),
  ): Promise<PasswordResetChallenge | undefined> {
    const [challenge] = await db.update(passwordResetChallenges)
      .set({ verifiedAt: now, resetTokenHash, resetTokenExpiresAt })
      .where(and(
        eq(passwordResetChallenges.id, id),
        eq(passwordResetChallenges.otpHash, otpHash),
        isNull(passwordResetChallenges.consumedAt),
        isNull(passwordResetChallenges.verifiedAt),
        gt(passwordResetChallenges.otpExpiresAt, now),
        lt(passwordResetChallenges.attemptCount, 5),
      ))
      .returning();
    return challenge || undefined;
  }

  async resetPasswordForChallenge(
    challengeId: number,
    userId: number,
    schoolId: number,
    resetTokenHash: string,
    passwordHash: string,
    pinHash?: string,
    now = new Date(),
  ): Promise<boolean> {
    return db.transaction(async (tx) => {
      const [user] = await tx.select().from(users).where(and(
        eq(users.id, userId),
        eq(users.schoolId, schoolId),
        eq(users.role, "admin"),
        eq(users.isActive, true),
      ));
      if (!user) return false;
      const [challenge] = await tx.update(passwordResetChallenges)
        .set({ consumedAt: now })
        .where(and(
          eq(passwordResetChallenges.id, challengeId),
          eq(passwordResetChallenges.userId, userId),
          eq(passwordResetChallenges.schoolId, schoolId),
          eq(passwordResetChallenges.resetTokenHash, resetTokenHash),
          isNull(passwordResetChallenges.consumedAt),
          isNotNull(passwordResetChallenges.verifiedAt),
          gt(passwordResetChallenges.resetTokenExpiresAt, now),
        ))
        .returning();
      if (!challenge) return false;

      const updates: Partial<typeof users.$inferInsert> = { passwordHash };
      if (pinHash) updates.pinHash = pinHash;
      await tx.update(users).set(updates).where(and(eq(users.id, userId), eq(users.schoolId, schoolId)));
      await tx.update(passwordResetChallenges)
        .set({ consumedAt: now })
        .where(and(
          eq(passwordResetChallenges.userId, userId),
          eq(passwordResetChallenges.schoolId, schoolId),
          isNull(passwordResetChallenges.consumedAt),
        ));
      return true;
    });
  }

  async resetTeacherPasswordForChallenge(
    challengeId: number,
    userId: number,
    schoolId: number,
    resetTokenHash: string,
    passwordHash: string,
    now = new Date(),
  ): Promise<boolean> {
    return db.transaction(async (tx) => {
      const [account] = await tx.select({ user: users, teacher: teachers })
        .from(users)
        .innerJoin(teachers, eq(teachers.userId, users.id))
        .where(and(
          eq(users.id, userId),
          eq(users.schoolId, schoolId),
          eq(users.role, "teacher"),
          eq(users.isActive, true),
          eq(teachers.schoolId, schoolId),
          eq(teachers.isActive, true),
        ))
        .limit(1)
        .for("update");
      if (!account) return false;

      const [challenge] = await tx.update(passwordResetChallenges)
        .set({ consumedAt: now })
        .where(and(
          eq(passwordResetChallenges.id, challengeId),
          eq(passwordResetChallenges.userId, userId),
          eq(passwordResetChallenges.schoolId, schoolId),
          eq(passwordResetChallenges.resetTokenHash, resetTokenHash),
          isNull(passwordResetChallenges.consumedAt),
          isNotNull(passwordResetChallenges.verifiedAt),
          gte(passwordResetChallenges.resetTokenExpiresAt, now),
        ))
        .returning();
      if (!challenge) return false;

      await tx.update(users)
        .set({ passwordHash })
        .where(and(
          eq(users.id, userId),
          eq(users.schoolId, schoolId),
          eq(users.role, "teacher"),
          eq(users.isActive, true),
        ));
      await tx.update(teachers)
        .set({ mustChangePassword: false })
        .where(and(
          eq(teachers.id, account.teacher.id),
          eq(teachers.userId, userId),
          eq(teachers.schoolId, schoolId),
        ));
      await tx.update(passwordResetChallenges)
        .set({ consumedAt: now })
        .where(and(
          eq(passwordResetChallenges.userId, userId),
          eq(passwordResetChallenges.schoolId, schoolId),
          isNull(passwordResetChallenges.consumedAt),
        ));
      return true;
    });
  }

  async invalidatePasswordResetChallenges(userId: number, schoolId: number): Promise<void> {
    await db.update(passwordResetChallenges).set({ consumedAt: new Date() }).where(and(
      eq(passwordResetChallenges.userId, userId),
      eq(passwordResetChallenges.schoolId, schoolId),
      isNull(passwordResetChallenges.consumedAt),
    ));
  }

  async invalidateUserSessions(userId: number): Promise<void> {
    try {
      await this.invalidateUserSessionsStrict(userId);
    } catch {
      // Session-store cleanup is best effort because deployments may use another store.
    }
  }

  async invalidateUserSessionsStrict(userId: number): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const revokedAt = Date.now();
      await client.query(
        `INSERT INTO "session" (sid, sess, expire)
         VALUES ($1, $2::json, $3)
         ON CONFLICT (sid) DO UPDATE
         SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`,
        [
          userSessionRevocationSid(userId),
          JSON.stringify({ revokedAt }),
          new Date(revokedAt + SESSION_REVOCATION_TTL_MS),
        ],
      );
      await client.query(
        `DELETE FROM "session" WHERE sess->>'userId' = $1`,
        [String(userId)],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async invalidateUserSessionsInTransaction(
    tx: { execute: (query: SQL) => Promise<unknown> },
    userId: number,
    revokedAt = Date.now(),
  ): Promise<void> {
    await tx.execute(sql`
      INSERT INTO "session" (sid, sess, expire)
      VALUES (
        ${userSessionRevocationSid(userId)},
        ${JSON.stringify({ revokedAt })}::json,
        ${new Date(revokedAt + SESSION_REVOCATION_TTL_MS)}
      )
      ON CONFLICT (sid) DO UPDATE
      SET sess = EXCLUDED.sess, expire = EXCLUDED.expire
    `);
    await tx.execute(sql`
      DELETE FROM "session"
      WHERE sess->>'userId' = ${String(userId)}
    `);
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
    return await db.select().from(students).where(
      and(eq(students.schoolId, schoolId), eq(students.isActive, true))
    );
  }

  async getStudentsByClassSection(schoolId: number, cls: string, section: string): Promise<Student[]> {
    return await db.select().from(students).where(
      and(eq(students.schoolId, schoolId), eq(students.class, cls), eq(students.section, section), eq(students.isActive, true))
    );
  }

  async getStudentCountBySchool(schoolId: number): Promise<number> {
    const [result] = await db
      .select({ value: count() })
      .from(students)
      .where(eq(students.schoolId, schoolId));
    return result?.value ?? 0;
  }

  /**
   * Issues the next unique serial for a school's DTID or DSID.
   * Uses an atomic DB-level increment so the counter NEVER decreases,
   * even if teachers/students are deleted. A serial is never reused.
   */
  async issueNextIdSerial(schoolId: number, type: "dtid" | "dsid"): Promise<number> {
    const result = await pool.query<{ last_issued: number }>(
      `INSERT INTO id_sequences (school_id, type, last_issued)
         VALUES ($1, $2, 1)
       ON CONFLICT (school_id, type) DO UPDATE
         SET last_issued = id_sequences.last_issued + 1
       RETURNING last_issued`,
      [schoolId, type],
    );
    return result.rows[0].last_issued;
  }

  /** @deprecated Use issueNextIdSerial instead */
  async getMaxDsidSerialForSchool(_schoolCode: string): Promise<number> {
    throw new Error("getMaxDsidSerialForSchool is deprecated — use issueNextIdSerial");
  }

  /** @deprecated Use issueNextIdSerial instead */
  async getMaxDtidSerialForSchool(_schoolCode: string): Promise<number> {
    throw new Error("getMaxDtidSerialForSchool is deprecated — use issueNextIdSerial");
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

  async getStudentsByIdsForSchool(studentIds: number[], schoolId: number): Promise<Student[]> {
    if (studentIds.length === 0) return [];
    return await db.select().from(students).where(and(
      eq(students.schoolId, schoolId),
      inArray(students.id, studentIds),
    ));
  }

  async getStudentByDsid(dsid: string): Promise<Student | undefined> {
    const [student] = await db.select().from(students).where(eq(students.digitalStudentId, dsid));
    return student || undefined;
  }

  async getStudentByDsidAndSchool(
    dsid: string,
    schoolId: number,
  ): Promise<Student | undefined> {
    const [student] = await db.select().from(students).where(and(
      eq(students.digitalStudentId, dsid),
      eq(students.schoolId, schoolId),
    ));
    return student || undefined;
  }

  async authenticateStudentByDsidForLogin(
    dsid: string,
    password: string,
  ): Promise<
    | { status: "not_found" }
    | { status: "inactive" }
    | { status: "not_activated" }
    | { status: "invalid" }
    | { status: "success"; student: Student; authIssuedAt: number }
  > {
    // This lookup only selects the lock key. Every security decision below is
    // made from the locked, authoritative row.
    const preliminary = await this.getStudentByDsid(dsid);
    if (!preliminary) return { status: "not_found" };
    return db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${preliminary.schoolId}, ${preliminary.id})`);
      const lockClock = await tx.execute<{ now: Date }>(sql`SELECT clock_timestamp() AS now`);
      const authIssuedAt = new Date(lockClock.rows[0].now).getTime();
      const [student] = await tx.select().from(students).where(and(
        eq(students.id, preliminary.id),
        eq(students.schoolId, preliminary.schoolId),
        eq(students.digitalStudentId, dsid),
      )).for("update");
      if (!student) return { status: "not_found" as const };
      if (!student.isActive) return { status: "inactive" as const };
      if (!student.isActivated) return { status: "not_activated" as const };
      if (!await bcrypt.compare(password, student.passwordHash)) {
        return { status: "invalid" as const };
      }
      const marker = await tx.execute<{ revoked_at: string | null }>(sql`
        SELECT sess->>'revokedAt' AS revoked_at
        FROM "session"
        WHERE sid = ${studentSessionRevocationSid(student.id)}
          AND expire > NOW()
        LIMIT 1
      `);
      const revokedAt = marker.rows.length > 0 ? Number(marker.rows[0].revoked_at) : null;
      if (revokedAt !== null && (!Number.isFinite(revokedAt) || authIssuedAt <= revokedAt)) {
        return { status: "invalid" as const };
      }
      return { status: "success" as const, student, authIssuedAt };
    });
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

  async updateStudentLiveFieldsForTeacherApproval(
    studentId: number,
    schoolId: number,
    data: Record<string, unknown>,
  ): Promise<Student | undefined> {
    return db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${schoolId}, ${studentId})`);
      const [before] = await tx.select({ email: students.email })
        .from(students)
        .where(and(eq(students.id, studentId), eq(students.schoolId, schoolId)))
        .for("update");
      if (!before) return undefined;

      const [updated] = await tx.update(students)
        .set(data as Partial<typeof students.$inferInsert>)
        .where(and(eq(students.id, studentId), eq(students.schoolId, schoolId)))
        .returning();

      const emailChanged = Object.prototype.hasOwnProperty.call(data, "email")
        && String(data.email ?? "").trim().toLowerCase() !== (before.email ?? "").trim().toLowerCase();
      if (emailChanged) {
        await tx.update(studentPasswordResetChallenges)
          .set({ consumedAt: new Date() })
          .where(and(
            eq(studentPasswordResetChallenges.studentId, studentId),
            eq(studentPasswordResetChallenges.schoolId, schoolId),
            isNull(studentPasswordResetChallenges.consumedAt),
          ));
      }
      return updated;
    });
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

  async changeTeacherPasswordAtomically(
    userId: number,
    teacherId: number,
    schoolId: number,
    currentPassword: string,
    passwordHash: string,
  ): Promise<boolean> {
    return db.transaction(async (tx) => {
      const [account] = await tx.select({ user: users, teacher: teachers })
        .from(users)
        .innerJoin(teachers, eq(teachers.userId, users.id))
        .where(and(
          eq(users.id, userId),
          eq(users.schoolId, schoolId),
          eq(users.role, "teacher"),
          eq(users.isActive, true),
          eq(teachers.id, teacherId),
          eq(teachers.userId, userId),
          eq(teachers.schoolId, schoolId),
          eq(teachers.isActive, true),
        ))
        .limit(1);
      if (!account) return false;

      const currentPasswordValid = await bcrypt.compare(
        currentPassword,
        account.user.passwordHash,
      );
      if (!currentPasswordValid) return false;

      const [updatedUser] = await tx.update(users)
        .set({ passwordHash })
        .where(and(
          eq(users.id, userId),
          eq(users.schoolId, schoolId),
          eq(users.role, "teacher"),
          eq(users.isActive, true),
          eq(users.passwordHash, account.user.passwordHash),
        ))
        .returning({ id: users.id });
      if (!updatedUser) return false;

      const [updatedTeacher] = await tx.update(teachers)
        .set({ mustChangePassword: false })
        .where(and(
          eq(teachers.id, teacherId),
          eq(teachers.userId, userId),
          eq(teachers.schoolId, schoolId),
          eq(teachers.isActive, true),
        ))
        .returning({ id: teachers.id });
      if (!updatedTeacher) {
        throw new Error("Teacher password state changed during update");
      }

      await tx.update(passwordResetChallenges)
        .set({ consumedAt: new Date() })
        .where(and(
          eq(passwordResetChallenges.userId, userId),
          eq(passwordResetChallenges.schoolId, schoolId),
          isNull(passwordResetChallenges.consumedAt),
        ));
      return true;
    });
  }

  async deleteTeacher(teacherId: number, schoolId: number): Promise<boolean> {
    const teacher = await this.getTeacherById(teacherId);
    if (!teacher || teacher.schoolId !== schoolId) return false;
    await db.delete(teachers).where(and(eq(teachers.id, teacherId), eq(teachers.schoolId, schoolId)));
    await db.delete(users).where(eq(users.id, teacher.userId));
    return true;
  }

  async logRemovedTeacher(entry: {
    schoolId: number;
    digitalTeacherId: string | null;
    fullName: string;
    email: string | null;
    phone: string | null;
    subject: string | null;
    assignedClass: string | null;
    assignedSection: string | null;
    designation: string | null;
    gender: string | null;
    dateOfBirth: string | null;
    govtIdType: string | null;
    govtIdNumber: string | null;
    address: string | null;
    joiningDate: string | null;
    qualifications: string | null;
    removalReason: string;
    removedByEmail: string | null;
  }): Promise<void> {
    await db.insert(removedTeachersLog).values(entry);
  }

  async getRemovedTeachersLog(schoolId: number, opts: { page: number; limit: number; q?: string }): Promise<{ data: RemovedTeacherLog[]; total: number; pages: number }> {
    const offset = (opts.page - 1) * opts.limit;
    const baseWhere = opts.q?.trim()
      ? and(
          eq(removedTeachersLog.schoolId, schoolId),
          or(
            ilike(removedTeachersLog.fullName, `%${opts.q}%`),
            ilike(removedTeachersLog.digitalTeacherId, `%${opts.q}%`),
            ilike(removedTeachersLog.email, `%${opts.q}%`),
          )
        )
      : eq(removedTeachersLog.schoolId, schoolId);

    const [totalRow] = await db.select({ count: count() }).from(removedTeachersLog).where(baseWhere);
    const total = Number(totalRow.count);

    const data = await db.select().from(removedTeachersLog)
      .where(baseWhere)
      .orderBy(desc(removedTeachersLog.removedAt))
      .limit(opts.limit)
      .offset(offset);

    return { data, total, pages: Math.max(1, Math.ceil(total / opts.limit)) };
  }

  async deactivateTeacher(teacherId: number, schoolId: number, reason: string): Promise<Teacher | undefined> {
    const teacher = await this.getTeacherById(teacherId);
    if (!teacher || teacher.schoolId !== schoolId) return undefined;
    // Block the teacher's login account
    await db.update(users).set({ isActive: false }).where(eq(users.id, teacher.userId));
    // Record deactivation metadata on the teacher row
    const [updated] = await db.update(teachers)
      .set({ isActive: false, deactivatedAt: new Date(), deactivationReason: reason })
      .where(eq(teachers.id, teacherId))
      .returning();
    return updated;
  }

  async reactivateTeacher(teacherId: number, schoolId: number): Promise<Teacher | undefined> {
    const teacher = await this.getTeacherById(teacherId);
    if (!teacher || teacher.schoolId !== schoolId) return undefined;
    await db.update(users).set({ isActive: true }).where(eq(users.id, teacher.userId));
    const [updated] = await db.update(teachers)
      .set({ isActive: true, deactivatedAt: null, deactivationReason: null })
      .where(eq(teachers.id, teacherId))
      .returning();
    return updated;
  }

  // ===== ATTENDANCE METHODS =====
  async getAttendanceByClassDate(schoolId: number, sessionId: number, cls: string, section: string, date: string): Promise<AttendanceRecord[]> {
    return await db.select().from(attendanceRecords).where(
      and(
        eq(attendanceRecords.schoolId, schoolId),
        eq(attendanceRecords.sessionId, sessionId),
        eq(attendanceRecords.class, cls),
        eq(attendanceRecords.section, section),
        eq(attendanceRecords.date, date),
      )
    ).then(records => {
      return records;
    });
  }

  async getAttendanceForStudentsOnDate(
    schoolId: number,
    sessionId: number,
    studentIds: number[],
    cls: string,
    section: string,
    date: string,
  ): Promise<AttendanceRecord[]> {
    if (studentIds.length === 0) return [];
    const allRecords = await db.select().from(attendanceRecords).where(and(
      eq(attendanceRecords.schoolId, schoolId),
      eq(attendanceRecords.sessionId, sessionId),
      eq(attendanceRecords.class, cls),
      eq(attendanceRecords.section, section),
      eq(attendanceRecords.date, date),
    ));
    return allRecords.filter(r => r.studentId !== null && studentIds.includes(r.studentId));
  }

  async getAttendanceRosterForSessionClass(
    schoolId: number,
    sessionId: number,
    cls: string,
    section: string,
  ): Promise<Student[]> {
    const [session, enrolledInClass, allSessionEnrollments, attendanceStudents, currentStudents] = await Promise.all([
      this.getAcademicSessionForSchool(sessionId, schoolId),
      this.getStudentsByClassSectionInSession(schoolId, cls, section, sessionId),
      db.select({ studentId: enrollments.studentId, identityKey: students.attendanceIdentityKey })
        .from(enrollments).innerJoin(students, and(
          eq(students.id, enrollments.studentId),
          eq(students.schoolId, enrollments.schoolId),
        )).where(and(
        eq(enrollments.schoolId, schoolId),
        eq(enrollments.sessionId, sessionId),
      )),
      db.select({ student: students }).from(students).innerJoin(attendanceRecords, and(
        eq(attendanceRecords.studentId, students.id),
        eq(attendanceRecords.schoolId, students.schoolId),
      )).where(and(
        eq(students.schoolId, schoolId),
        eq(attendanceRecords.schoolId, schoolId),
        eq(attendanceRecords.sessionId, sessionId),
        eq(attendanceRecords.class, cls),
        eq(attendanceRecords.section, section),
      )),
      this.getStudentsByClassSection(schoolId, cls, section),
    ]);

    const enrolledStudentIds = new Set(allSessionEnrollments.map(row => row.studentId));
    const roster = new Map(enrolledInClass.map(student => [student.id, student]));
    for (const { student } of attendanceStudents) {
      if (!enrolledStudentIds.has(student.id)) roster.set(student.id, student);
    }
    if (session?.isActive) {
      for (const student of currentStudents) {
        if (!enrolledStudentIds.has(student.id)) roster.set(student.id, student);
      }
    }
    return [...roster.values()];
  }

  async getAttendanceReportRosterForSessionClass(
    schoolId: number, sessionId: number, cls: string, section: string,
  ): Promise<Array<Pick<Student, "id" | "name" | "digitalStudentId" | "class" | "section" | "photoUrl" | "schoolId"> & { identityKey: string }>> {
    const live = await this.getAttendanceRosterForSessionClass(schoolId, sessionId, cls, section);
    const records = await db.select().from(attendanceRecords).where(and(
      eq(attendanceRecords.schoolId, schoolId), eq(attendanceRecords.sessionId, sessionId),
      eq(attendanceRecords.class, cls), eq(attendanceRecords.section, section),
    ));
    const liveByIdentity = new Set(live.map(student => student.attendanceIdentityKey));
    const result = new Map<string, any>(live.map(student => [student.attendanceIdentityKey, {
      id: student.id, name: student.name, digitalStudentId: student.digitalStudentId,
      class: student.class, section: student.section, photoUrl: student.photoUrl,
      schoolId, identityKey: student.attendanceIdentityKey,
    }]));
    for (const record of records) {
      if (!liveByIdentity.has(record.identityKey) && !result.has(record.identityKey)) {
        result.set(record.identityKey, {
          // Negative row IDs avoid colliding with a later student reusing the
          // deleted student's numeric primary key.
          id: -record.id, name: record.studentNameSnapshot,
          digitalStudentId: record.studentCodeSnapshot, class: cls, section,
          photoUrl: null, schoolId, identityKey: record.identityKey,
        });
      }
    }
    return [...result.values()];
  }

  async getAttendancePopulationForSession(schoolId: number, sessionId: number): Promise<number> {
    const [session, enrolledRows, attendanceRows, currentActiveRows] = await Promise.all([
      this.getAcademicSessionForSchool(sessionId, schoolId),
      db.select({ studentId: enrollments.studentId, identityKey: students.attendanceIdentityKey })
        .from(enrollments).innerJoin(students, and(
          eq(students.id, enrollments.studentId),
          eq(students.schoolId, enrollments.schoolId),
        )).where(and(
        eq(enrollments.schoolId, schoolId),
        eq(enrollments.sessionId, sessionId),
      )),
      db.selectDistinct({ identityKey: attendanceRecords.identityKey }).from(attendanceRecords).where(and(
        eq(attendanceRecords.schoolId, schoolId),
        eq(attendanceRecords.sessionId, sessionId),
      )),
      db.select({ studentId: students.id, identityKey: students.attendanceIdentityKey }).from(students).where(and(
        eq(students.schoolId, schoolId),
        eq(students.isActive, true),
      )),
    ]);
    const enrolledStudentIds = new Set(enrolledRows.map(row => row.identityKey));
    return new Set([
      ...enrolledRows.map(row => row.identityKey),
      ...attendanceRows.map(row => row.identityKey),
      ...(session?.isActive
        ? currentActiveRows
            .filter(row => !enrolledStudentIds.has(row.identityKey))
            .map(row => row.identityKey)
        : []),
    ]).size;
  }

  async getStudentsByClassSectionForExamSession(
    schoolId: number,
    sessionId: number,
    cls: string,
    section: string,
  ): Promise<Student[]> {
    const [attendanceRoster, allSessionEnrollments, scoreStudents] = await Promise.all([
      this.getAttendanceRosterForSessionClass(schoolId, sessionId, cls, section),
      db.select({ studentId: enrollments.studentId }).from(enrollments).where(and(
        eq(enrollments.schoolId, schoolId),
        eq(enrollments.sessionId, sessionId),
      )),
      db.select({ student: students }).from(students).innerJoin(examScores, and(
        eq(examScores.studentId, students.id),
        eq(examScores.schoolId, students.schoolId),
      )).where(and(
        eq(students.schoolId, schoolId),
        eq(examScores.schoolId, schoolId),
        eq(examScores.sessionId, sessionId),
        eq(examScores.class, cls),
        eq(examScores.section, section),
      )),
    ]);
    const enrolledStudentIds = new Set(allSessionEnrollments.map(row => row.studentId));
    const roster = new Map(attendanceRoster.map(student => [student.id, student]));
    for (const { student } of scoreStudents) {
      if (!enrolledStudentIds.has(student.id)) roster.set(student.id, student);
    }
    return [...roster.values()];
  }

  async resolveAttendanceClassSectionForStudent(
    schoolId: number,
    sessionId: number,
    studentId: number,
  ): Promise<{ class: string; section: string } | null> {
    const enrollment = await this.resolveEnrollmentForStudentSession(schoolId, studentId, sessionId);
    if (enrollment?.className && enrollment.sectionName) {
      return { class: enrollment.className, section: enrollment.sectionName };
    }
    const [snapshot] = await db.select({
      class: attendanceRecords.class,
      section: attendanceRecords.section,
    }).from(attendanceRecords).where(and(
      eq(attendanceRecords.schoolId, schoolId),
      eq(attendanceRecords.sessionId, sessionId),
      eq(attendanceRecords.studentId, studentId),
      isNotNull(attendanceRecords.class),
      isNotNull(attendanceRecords.section),
    )).orderBy(attendanceRecords.date, attendanceRecords.id).limit(1);
    return snapshot?.class && snapshot.section
      ? { class: snapshot.class, section: snapshot.section }
      : null;
  }

  async upsertAttendance(records: { studentId: number; teacherId: number; schoolId: number; sessionId: number; date: string; status: string; markedBy: string; class?: string; section?: string; academicYear?: string }[]): Promise<AttendanceRecord[]> {
    if (records.length === 0) return [];
    return await db.transaction(async (tx) => {
      const results: AttendanceRecord[] = [];
      const studentIds = [...new Set(records.map(record => record.studentId))];
      const teacherIds = [...new Set(records.map(record => record.teacherId))];
      const sessionIds = [...new Set(records.map(record => record.sessionId))];

      if (sessionIds.some(sessionId => !Number.isInteger(sessionId) || sessionId <= 0)) {
        throw new Error("Attendance sessionId is required");
      }

      const [ownedStudents, ownedTeachers, ownedSessions] = await Promise.all([
        tx.select({ id: students.id, schoolId: students.schoolId, isActive: students.isActive, attendanceIdentityKey: students.attendanceIdentityKey, name: students.name, digitalStudentId: students.digitalStudentId }).from(students)
          .where(inArray(students.id, studentIds)),
        tx.select({ id: teachers.id, schoolId: teachers.schoolId }).from(teachers)
          .where(inArray(teachers.id, teacherIds)),
        tx.select({ id: academicSessions.id, schoolId: academicSessions.schoolId }).from(academicSessions)
          .where(inArray(academicSessions.id, sessionIds)),
      ]);
      const studentSchools = new Map(ownedStudents.map(student => [student.id, student.schoolId]));
      const teacherSchools = new Map(ownedTeachers.map(teacher => [teacher.id, teacher.schoolId]));
      const sessionSchools = new Map(ownedSessions.map(session => [session.id, session.schoolId]));

      for (const rec of records) {
        if (
          studentSchools.get(rec.studentId) !== rec.schoolId ||
          teacherSchools.get(rec.teacherId) !== rec.schoolId ||
          sessionSchools.get(rec.sessionId) !== rec.schoolId
        ) {
          throw new Error("Attendance entities do not belong to the same school");
        }
      }

      for (const rec of records) {
      if (!Number.isInteger(rec.sessionId) || rec.sessionId <= 0) {
        throw new Error("Attendance sessionId is required");
      }
      const existing = await tx.select().from(attendanceRecords).where(
        and(
          eq(attendanceRecords.schoolId, rec.schoolId),
          eq(attendanceRecords.sessionId, rec.sessionId),
          eq(attendanceRecords.identityKey, ownedStudents.find(student => student.id === rec.studentId)!.attendanceIdentityKey),
          eq(attendanceRecords.date, rec.date),
        )
      );
      if (existing.length > 0) {
        const current = existing[0];
        if (current.editCount >= 3) continue;
        const [updated] = await tx.update(attendanceRecords).set({
          status: rec.status,
          editCount: current.editCount + 1,
          markedBy: rec.markedBy,
          markedAt: new Date(),
          ...(rec.class && { class: rec.class }),
          ...(rec.section && { section: rec.section }),
          ...(rec.academicYear && { academicYear: rec.academicYear }),
        }).where(eq(attendanceRecords.id, current.id)).returning();
        results.push(updated);
      } else {
        const [created] = await tx.insert(attendanceRecords).values({
          studentId: rec.studentId,
          teacherId: rec.teacherId,
          schoolId: rec.schoolId,
          sessionId: rec.sessionId,
          date: rec.date,
          status: rec.status,
          editCount: 0,
          markedBy: rec.markedBy,
          markedAt: new Date(),
          class: rec.class,
          section: rec.section,
          academicYear: rec.academicYear,
           originalStudentId: rec.studentId,
           identityKey: ownedStudents.find(student => student.id === rec.studentId)!.attendanceIdentityKey,
           studentNameSnapshot: ownedStudents.find(student => student.id === rec.studentId)!.name,
           studentCodeSnapshot: ownedStudents.find(student => student.id === rec.studentId)!.digitalStudentId,
        }).returning();
        results.push(created);
      }
      }
      return results;
    });
  }

  async getAttendanceHistory(schoolId: number, sessionId: number, cls: string, section: string, startDate: string, endDate: string): Promise<(AttendanceRecord & { studentName: string; dsid: string })[]> {
    const studentList = await this.getAttendanceReportRosterForSessionClass(schoolId, sessionId, cls, section);
    const conditions = [
      eq(attendanceRecords.schoolId, schoolId),
      eq(attendanceRecords.sessionId, sessionId),
      eq(attendanceRecords.class, cls),
      eq(attendanceRecords.section, section),
      gte(attendanceRecords.date, startDate),
      lte(attendanceRecords.date, endDate),
    ];
    const allRecords = await db.select().from(attendanceRecords).where(and(...conditions));
    const rosterIdentityKeys = new Set(studentList.map(s => s.identityKey));
    const filtered = allRecords.filter(r => rosterIdentityKeys.has(r.identityKey));
    const studentMap = new Map(studentList.map(s => [s.identityKey, s]));
    return filtered.map(r => ({
      ...r,
      studentName: r.studentNameSnapshot,
      dsid: r.studentCodeSnapshot,
    }));
  }

  async hasAttendanceToday(teacherId: number, cls: string, section: string, schoolId: number, sessionId: number): Promise<boolean> {
    const today = todayInIST();
    const studentList = await this.getAttendanceRosterForSessionClass(schoolId, sessionId, cls, section);
    if (studentList.length === 0) return false;
    const studentIds = studentList.map(s => s.id);
    const records = await db.select().from(attendanceRecords).where(
      and(
        eq(attendanceRecords.schoolId, schoolId),
        eq(attendanceRecords.sessionId, sessionId),
        eq(attendanceRecords.class, cls),
        eq(attendanceRecords.section, section),
        eq(attendanceRecords.date, today),
        eq(attendanceRecords.teacherId, teacherId),
      )
    );
    return records.some(r => r.studentId !== null && studentIds.includes(r.studentId));
  }

  // ===== HOMEWORK METHODS =====
  async createHomework(data: InsertHomework): Promise<Homework> {
    const [hw] = await db.insert(homework).values(data).returning();
    return hw;
  }

  async getHomeworkByClass(schoolId: number, cls: string, section: string, sessionId?: number): Promise<Homework[]> {
    // When sessionId is provided, strictly scope results to that academic year.
    return await db.select().from(homework).where(
      and(
        eq(homework.schoolId, schoolId),
        eq(homework.class, cls),
        eq(homework.section, section),
        ...(sessionId != null ? [eq(homework.sessionId, sessionId)] : []),
      )
    ).orderBy(desc(homework.createdAt));
  }

  /** Returns the student roster for a specific academic session via the enrollments table.
   *  Used by teacher attendance/roster lookups in archive (look-back) mode. */
  async getStudentsByClassSectionInSession(schoolId: number, cls: string, section: string, sessionId: number): Promise<Student[]> {
    const rows = await db
      .select({ student: students })
      .from(students)
      .innerJoin(enrollments, and(
        eq(enrollments.studentId, students.id),
        eq(enrollments.schoolId, schoolId),
        eq(enrollments.sessionId, sessionId),
        eq(enrollments.className, cls),
        eq(enrollments.sectionName, section),
      ))
      .where(eq(students.schoolId, schoolId));
    return rows.map(r => r.student);
  }

  async updateHomework(id: number, schoolId: number, data: { content: string; subject: string; fileUrl: string | null; dueDate?: string | null }): Promise<Homework> {
    const [updated] = await db.update(homework).set(data).where(and(eq(homework.id, id), eq(homework.schoolId, schoolId))).returning();
    return updated;
  }

  async deleteHomework(id: number, schoolId: number): Promise<void> {
    await db.delete(homework).where(and(eq(homework.id, id), eq(homework.schoolId, schoolId)));
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

  async getStudentHomework(schoolId: number, cls: string, section: string, studentId: number, date?: string, sessionId?: number | null): Promise<{
    id: number; schoolId: number; teacherId: number; class: string; section: string;
    subject: string; content: string; fileUrl: string | null; dueDate: string | null;
    createdAt: Date; teacherName: string; submission: HomeworkSubmission | null;
  }[]> {
    const conditions: SQL<unknown>[] = [
      eq(homework.schoolId, schoolId),
      eq(homework.class, cls),
      eq(homework.section, section),
    ];
    if (sessionId) conditions.push(eq(homework.sessionId, sessionId));
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

  async getStudentHomeworkPendingDates(schoolId: number, cls: string, section: string, studentId: number, month: string, sessionId?: number | null): Promise<string[]> {
    // month = "YYYY-MM"
    const [yearStr, monStr] = month.split("-");
    const year = parseInt(yearStr);
    const mon  = parseInt(monStr);
    const startDate = `${month}-01`;
    const lastDay   = new Date(year, mon, 0).getDate();
    const endDate   = `${month}-${String(lastDay).padStart(2, "0")}`;

    const dateConditions: SQL<unknown>[] = [
      eq(homework.schoolId, schoolId),
      eq(homework.class, cls),
      eq(homework.section, section),
      or(
        sql`${homework.createdAt}::date BETWEEN ${startDate}::date AND ${endDate}::date`,
        sql`${homework.dueDate} BETWEEN ${startDate} AND ${endDate}`,
      )!,
    ];
    if (sessionId) dateConditions.push(eq(homework.sessionId, sessionId));

    const rows = await db.select({
      createdAt: homework.createdAt,
      dueDate:   homework.dueDate,
      subStatus: homeworkSubmissions.status,
    }).from(homework)
      .leftJoin(homeworkSubmissions, and(
        eq(homeworkSubmissions.homeworkId, homework.id),
        eq(homeworkSubmissions.studentId, studentId),
      ))
      .where(and(...dateConditions));

    const pendingDates = new Set<string>();
    for (const row of rows) {
      const isPending = !row.subStatus || row.subStatus === "rejected";
      if (isPending) {
        const createdDate = dateOnlyInIST(row.createdAt);
        if (createdDate) pendingDates.add(createdDate);
        if (row.dueDate) pendingDates.add(row.dueDate);
      }
    }
    return Array.from(pendingDates);
  }

  async getStudentClasswork(schoolId: number, cls: string, section: string, date?: string, sessionId?: number | null): Promise<{
    id: number; schoolId: number; teacherId: number; class: string; section: string;
    subject: string; content: string; fileUrl: string | null; createdAt: Date; teacherName: string;
  }[]> {
    const conditions: SQL<unknown>[] = [
      eq(classwork.schoolId, schoolId),
      eq(classwork.class, cls),
      eq(classwork.section, section),
    ];
    if (sessionId) conditions.push(eq(classwork.sessionId, sessionId));
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

  async upsertHomeworkSubmission(data: { homeworkId: number; studentId: number; schoolId: number; fileUrl?: string | null; textAnswer?: string | null }): Promise<HomeworkSubmission> {
    const existing = await this.getHomeworkSubmission(data.homeworkId, data.studentId);
    if (existing) {
      const [updated] = await db.update(homeworkSubmissions)
        .set({
          fileUrl: data.fileUrl !== undefined ? data.fileUrl : existing.fileUrl,
          textAnswer: data.textAnswer !== undefined ? data.textAnswer : existing.textAnswer,
          status: "submitted",
          submittedAt: new Date(),
        })
        .where(eq(homeworkSubmissions.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await db.insert(homeworkSubmissions).values({
      homeworkId: data.homeworkId,
      studentId: data.studentId,
      schoolId: data.schoolId,
      fileUrl: data.fileUrl ?? null,
      textAnswer: data.textAnswer ?? null,
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

  async getClassworkByClass(schoolId: number, cls: string, section: string, sessionId?: number): Promise<Classwork[]> {
    return await db.select().from(classwork).where(
      and(
        eq(classwork.schoolId, schoolId),
        eq(classwork.class, cls),
        eq(classwork.section, section),
        ...(sessionId != null ? [eq(classwork.sessionId, sessionId)] : []),
      )
    ).orderBy(desc(classwork.createdAt));
  }

  async getClassworkById(id: number): Promise<Classwork | undefined> {
    const [cw] = await db.select().from(classwork).where(eq(classwork.id, id));
    return cw;
  }

  async updateClasswork(id: number, schoolId: number, data: { content?: string; subject?: string; fileUrl?: string | null }): Promise<Classwork> {
    const [cw] = await db.update(classwork).set(data).where(and(eq(classwork.id, id), eq(classwork.schoolId, schoolId))).returning();
    return cw;
  }

  async deleteClasswork(id: number, schoolId: number): Promise<void> {
    await db.delete(classwork).where(and(eq(classwork.id, id), eq(classwork.schoolId, schoolId)));
  }

  // ===== NOTICE METHODS =====
  async createNotice(data: InsertNotice): Promise<Notice> {
    const [n] = await db.insert(notices).values(data).returning();
    return n;
  }

  async getAllSchoolNotices(schoolId: number, limit = 500, sessionId?: number | null): Promise<(Notice & { creatorName: string | null })[]> {
    const conditions: SQL[] = [eq(notices.schoolId, schoolId)];
    if (sessionId != null) conditions.push(eq(notices.sessionId, sessionId));
    const rows = await db
      .select({
        id: notices.id,
        schoolId: notices.schoolId,
        sessionId: notices.sessionId,
        createdById: notices.createdById,
        creatorRole: notices.creatorRole,
        targetType: notices.targetType,
        targetClass: notices.targetClass,
        targetSection: notices.targetSection,
        targetTeacherId: notices.targetTeacherId,
        noticeType: notices.noticeType,
        content: notices.content,
        fileUrl: notices.fileUrl,
        createdAt: notices.createdAt,
        creatorName: teachers.fullName,
      })
      .from(notices)
      .leftJoin(teachers, and(eq(notices.createdById, teachers.id), eq(notices.creatorRole, "teacher")))
      .where(and(...conditions))
      .orderBy(desc(notices.createdAt))
      .limit(limit);
    return rows;
  }

  async bulkDeleteNotices(schoolId: number, olderThanDays: number): Promise<number> {
    const conditions: any[] = [eq(notices.schoolId, schoolId)];
    if (olderThanDays > 0) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - olderThanDays);
      conditions.push(lt(notices.createdAt, cutoff));
    }
    const eligible = await db.select({ id: notices.id })
      .from(notices)
      .where(and(...conditions));
    if (eligible.length === 0) return 0;
    await db.delete(notices).where(inArray(notices.id, eligible.map(r => r.id)));
    return eligible.length;
  }

  async getNoticesByTeacher(teacherId: number, limit = 50): Promise<Notice[]> {
    return await db.select().from(notices)
      .where(and(eq(notices.createdById, teacherId), eq(notices.creatorRole, "teacher")))
      .orderBy(desc(notices.createdAt))
      .limit(limit);
  }

  async getNoticeById(id: number): Promise<Notice | null> {
    const [n] = await db.select().from(notices).where(eq(notices.id, id));
    return n ?? null;
  }

  async deleteNotice(id: number, schoolId: number): Promise<void> {
    await db.delete(notices).where(and(eq(notices.id, id), eq(notices.schoolId, schoolId)));
  }

  async updateNotice(id: number, schoolId: number, content: string): Promise<Notice | null> {
    const [n] = await db.update(notices).set({ content }).where(and(eq(notices.id, id), eq(notices.schoolId, schoolId))).returning();
    return n ?? null;
  }

  async getNoticesByTarget(schoolId: number, targetType: string, cls?: string, section?: string, sessionId?: number | null): Promise<Notice[]> {
    const typeFilter = targetType === "student"
      ? or(eq(notices.targetType, "student"), eq(notices.targetType, "whole_school"))!
      : eq(notices.targetType, targetType);
    const conditions: any[] = [eq(notices.schoolId, schoolId), typeFilter];
    if (cls) conditions.push(or(eq(notices.targetClass, cls), isNull(notices.targetClass))!);
    if (sessionId != null) conditions.push(eq(notices.sessionId, sessionId));
    return await db.select().from(notices).where(and(...conditions)).orderBy(desc(notices.createdAt));
  }

  async getTeacherByClassSection(schoolId: number, cls: string, section: string): Promise<Teacher | null> {
    const [teacher] = await db.select().from(teachers)
      .where(and(eq(teachers.schoolId, schoolId), eq(teachers.assignedClass, cls), eq(teachers.assignedSection, section)));
    return teacher || null;
  }

  /** Students can NEVER see these notices — the targetType:"teacher" filter in
   * getStudentNotices only fetches targetType "whole_school" / "student" / "class".
   */
  async getTeacherScopedNotices(schoolId: number, teacherId: number, sessionId?: number | null): Promise<Notice[]> {
    const [teacherRecord, mappings] = await Promise.all([
      this.getTeacherById(teacherId),
      this.getFacultyMappingsByTeacher(teacherId),
    ]);

    // Build the full set of class-section pairs this teacher covers
    const assignments: Array<{ className: string; section: string }> = [];

    // 1. Primary assignment stored directly on the teacher row
    if (teacherRecord?.assignedClass && teacherRecord?.assignedSection) {
      assignments.push({ className: teacherRecord.assignedClass, section: teacherRecord.assignedSection });
    }

    // 2. Faculty mapping rows (may include additional class-sections)
    for (const m of mappings) {
      const alreadyIn = assignments.some(
        a => a.className === m.className && a.section === m.section
      );
      if (!alreadyIn) assignments.push({ className: m.className, section: m.section });
    }

    // Fetch all teacher-type AND whole-school notices for this school in one query
    const noticeConditions: any[] = [
      eq(notices.schoolId, schoolId),
      or(
        eq(notices.targetType, "teacher"),
        eq(notices.targetType, "whole_school"),
      ),
    ];
    if (sessionId != null) noticeConditions.push(eq(notices.sessionId, sessionId));
    const allNotices = await db.select().from(notices)
      .where(and(...noticeConditions))
      .orderBy(desc(notices.createdAt));

    return allNotices.filter(notice => {
      // ── Strict pin: targetTeacherId set → only that exact teacher sees it ──
      if (notice.targetTeacherId !== null && notice.targetTeacherId !== undefined) {
        return notice.targetTeacherId === teacherId;
      }
      // ── Whole-school notices are visible to every teacher ──
      if (notice.targetType === "whole_school") return true;
      // ── Teacher broadcast with no class restriction → all teachers see it ──
      if (!notice.targetClass) return true;
      // ── Class-restricted teacher notice: match assignments ──
      if (assignments.length === 0) return false;
      return assignments.some(
        a => a.className === notice.targetClass &&
          (!notice.targetSection || a.section === notice.targetSection)
      );
    });
  }

  async getStudentNotices(studentId: number, schoolId: number, cls: string, section: string, sessionId?: number | null): Promise<(Notice & { isRead: boolean; creatorName: string | null })[]> {
    const classMatch = or(
      isNull(notices.targetClass),
      eq(notices.targetClass, cls),
      sql`${cls} = ANY(string_to_array(${notices.targetClass}, ','))`
    )!;

    const noticeConditions: SQL<unknown>[] = [
      eq(notices.schoolId, schoolId),
      or(
        eq(notices.targetType, "whole_school"),
        and(eq(notices.targetType, "student"), classMatch)!,
        and(eq(notices.targetType, "class"), classMatch)!
      )! as SQL<unknown>,
    ];
    if (sessionId) noticeConditions.push(eq(notices.sessionId, sessionId) as SQL<unknown>);

    const rows = await db
      .select({
        id: notices.id,
        schoolId: notices.schoolId,
        sessionId: notices.sessionId,
        createdById: notices.createdById,
        creatorRole: notices.creatorRole,
        targetType: notices.targetType,
        targetClass: notices.targetClass,
        targetSection: notices.targetSection,
        targetTeacherId: notices.targetTeacherId,
        noticeType: notices.noticeType,
        content: notices.content,
        fileUrl: notices.fileUrl,
        createdAt: notices.createdAt,
        creatorName: teachers.fullName,
      })
      .from(notices)
      .leftJoin(teachers, and(eq(notices.createdById, teachers.id), eq(notices.creatorRole, "teacher")))
      .where(and(...noticeConditions))
      .orderBy(desc(notices.createdAt));

    if (rows.length === 0) return [];

    // Apply section filtering in application layer.
    const filtered = rows.filter(n => {
      if (n.targetType === "whole_school") return true;
      if (!n.targetClass) return true;
      const targetClasses = n.targetClass.split(",").map(c => c.trim());
      if (!targetClasses.includes(cls)) return false;
      if (!n.targetSection) return true;
      const sections = n.targetSection.split(",").map(s => s.trim());
      return sections.includes(section);
    });

    if (filtered.length === 0) return [];

    const readRows = await db.select({ noticeId: noticeReads.noticeId })
      .from(noticeReads)
      .where(and(
        eq(noticeReads.studentId, studentId),
        inArray(noticeReads.noticeId, filtered.map(r => r.id))
      ));
    const readSet = new Set(readRows.map(r => r.noticeId));
    return filtered.map(n => ({ ...n, isRead: readSet.has(n.id) }));
  }

  async markNoticesRead(studentId: number, noticeIds: number[]): Promise<void> {
    if (noticeIds.length === 0) return;
    await pool.query(
      `INSERT INTO notice_reads (student_id, notice_id) SELECT $1, unnest($2::int[]) ON CONFLICT (student_id, notice_id) DO NOTHING`,
      [studentId, noticeIds]
    );
  }

  async getUnreadNoticeCount(studentId: number, schoolId: number, cls: string, section: string, sessionId?: number | null): Promise<number> {
    const all = await this.getStudentNotices(studentId, schoolId, cls, section, sessionId);
    return all.filter(n => !n.isRead).length;
  }

  // ===== COMPLAINT METHODS =====
  async getNextTicketId(schoolId: number): Promise<string> {
    const now = new Date();
    const datePart = todayInIST(now).replace(/-/g, "");
    const prefix = `CMP-${datePart}-`;
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
    return `${prefix}${String(seq).padStart(6, "0")}`;
  }

  async createComplaint(data: InsertComplaint): Promise<Complaint> {
    const [c] = await db.insert(complaints).values(data).returning();
    return c;
  }

  async createComplaintWithStudents(
    data: InsertComplaint,
    studentIds: number[]
  ): Promise<Complaint & { students: { id: number; name: string; class: string | null; section: string | null }[] }> {
    const [c] = await db.insert(complaints).values(data).returning();
    if (studentIds.length > 0) {
      await db.insert(complaintStudents).values(
        studentIds.map(sid => ({ complaintId: c.id, studentId: sid }))
      );
    }
    const studs = studentIds.length > 0
      ? await db.select({ id: students.id, name: students.name, cls: students.class, sec: students.section })
          .from(complaintStudents)
          .innerJoin(students, eq(complaintStudents.studentId, students.id))
          .where(eq(complaintStudents.complaintId, c.id))
      : [];
    return { ...c, students: studs.map(s => ({ id: s.id, name: s.name, class: s.cls, section: s.sec })) };
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

  async updateComplaintStatus(id: number, schoolId: number, status: string, resolutionRemarks?: string): Promise<Complaint> {
    const updateData: Record<string, unknown> = { status };
    if (resolutionRemarks !== undefined) updateData.resolutionRemarks = resolutionRemarks;
    if (status === "Resolved") updateData.resolvedAt = new Date();
    const [c] = await db.update(complaints).set(updateData).where(and(eq(complaints.id, id), eq(complaints.schoolId, schoolId))).returning();
    return c;
  }

  async bulkDeleteComplaints(
    schoolId: number,
    olderThanDays: number,
    deletedByUserId: number,
    deletedByRole: string,
    deletedByName: string,
    complaintTypes?: string[],
  ): Promise<number> {
    const conditions: ReturnType<typeof eq>[] = [
      eq(complaints.schoolId, schoolId),
      eq(complaints.status, "Resolved"),
      eq(complaints.isDeleted, false),
      isNull(complaints.deletedAt),
    ] as any[];
    if (olderThanDays > 0) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - olderThanDays);
      (conditions as any[]).push(lt(complaints.createdAt, cutoff));
    }
    if (complaintTypes && complaintTypes.length > 0) {
      (conditions as any[]).push(inArray(complaints.complaintType, complaintTypes));
    }
    const eligible = await db.select({ id: complaints.id })
      .from(complaints)
      .where(and(...(conditions as any[])));
    if (eligible.length === 0) return 0;
    const ids = eligible.map(r => r.id);
    await db.update(complaints)
      .set({ isDeleted: true, deletedAt: new Date(), deletedBy: deletedByUserId })
      .where(inArray(complaints.id, ids));
    if (deletedByUserId > 0) {
      const typeDesc = complaintTypes?.length ? ` (types: ${complaintTypes.join(", ")})` : "";
      const ageDesc = olderThanDays === 0 ? "any age" : `older than ${olderThanDays} days`;
      await db.insert(auditLogs).values({
        schoolId, actionType: "bulk_delete", entityType: "complaint", entityId: schoolId,
        actionBy: deletedByUserId, actionByRole: deletedByRole,
        details: `${deletedByName} bulk-deleted ${ids.length} resolved complaint(s)${typeDesc} — ${ageDesc}`,
      });
    }
    return ids.length;
  }

  async getComplaintsBySchool(schoolId: number, sessionId?: number | null): Promise<(Complaint & {
    studentName: string | null;
    teacherName: string | null;
    teacherDtid: string | null;
    complainantName: string | null;
    complainantClass: string | null;
    complainantSection: string | null;
    complainantPhone: string | null;
    students: { id: number; name: string; class: string | null; section: string | null }[];
  })[]> {
    const complainantStudents = alias(students, "complainant_students");
    const result = await db.select({
      complaint: complaints,
      reportedStudent: { name: students.name },
      teacher: { fullName: teachers.fullName, digitalTeacherId: teachers.digitalTeacherId },
      complainant: {
        name: complainantStudents.name,
        class: complainantStudents.class,
        section: complainantStudents.section,
        phone: complainantStudents.phone,
      },
    })
      .from(complaints)
      .leftJoin(students, eq(complaints.studentId, students.id))
      .leftJoin(teachers, eq(complaints.teacherId, teachers.id))
      .leftJoin(complainantStudents, eq(complaints.complainantStudentId, complainantStudents.id))
      .where(and(
        eq(complaints.schoolId, schoolId),
        eq(complaints.isDeleted, false),
        ...(sessionId != null ? [eq(complaints.sessionId, sessionId)] : []),
      ))
      .orderBy(desc(complaints.createdAt));

    const complaintIds = result.map(r => r.complaint.id);
    const studentsByComplaint = new Map<number, { id: number; name: string; class: string | null; section: string | null }[]>();
    if (complaintIds.length > 0) {
      const csRows = await db.select({
        complaintId: complaintStudents.complaintId,
        id: students.id,
        name: students.name,
        cls: students.class,
        sec: students.section,
      })
        .from(complaintStudents)
        .innerJoin(students, eq(complaintStudents.studentId, students.id))
        .where(inArray(complaintStudents.complaintId, complaintIds));
      for (const row of csRows) {
        const list = studentsByComplaint.get(row.complaintId) ?? [];
        list.push({ id: row.id, name: row.name, class: row.cls, section: row.sec });
        studentsByComplaint.set(row.complaintId, list);
      }
    }

    return result.map(r => {
      const csStudents = studentsByComplaint.get(r.complaint.id) ?? [];
      const legacyStudent = r.reportedStudent?.name
        ? [{ id: r.complaint.studentId!, name: r.reportedStudent.name, class: null, section: null }]
        : [];
      return {
        ...r.complaint,
        teacherDtid: r.teacher?.digitalTeacherId ?? null,
        studentName: r.reportedStudent?.name ?? (csStudents[0]?.name ?? null),
        teacherName: r.teacher?.fullName ?? null,
        complainantName: r.complainant?.name ?? null,
        complainantClass: r.complaint.complainantClass ?? r.complainant?.class ?? null,
        complainantSection: r.complaint.complainantSection ?? r.complainant?.section ?? null,
        complainantPhone: r.complaint.contactNumber ?? r.complainant?.phone ?? null,
        students: csStudents.length > 0 ? csStudents : legacyStudent,
      };
    });
  }

  async getComplaintsByTeacher(teacherId: number, assignedClass?: string, assignedSection?: string, schoolId?: number, sessionId?: number | null): Promise<(Complaint & { studentName: string | null; students: { id: number; name: string; class: string | null; section: string | null }[] })[]> {
    const STUDENT_FILED_TYPES = ["student-to-staff", "student-peer-report"];
    const ownWhereConditions: any[] = [
      eq(complaints.teacherId, teacherId),
      eq(complaints.isDeleted, false),
      sql`${complaints.complaintType} NOT IN ('student-to-staff', 'student-peer-report')`,
    ];
    if (schoolId) ownWhereConditions.push(eq(complaints.schoolId, schoolId));
    if (sessionId != null) ownWhereConditions.push(eq(complaints.sessionId, sessionId));
    const ownComplaints = await db.select().from(complaints)
      .leftJoin(students, eq(complaints.studentId, students.id))
      .where(and(...ownWhereConditions))
      .orderBy(desc(complaints.createdAt));

    const ownResults = ownComplaints.map(r => ({
      ...r.complaints,
      studentName: r.students?.name || null,
    }));

    let allResults = ownResults;

    if (assignedClass && assignedSection && schoolId) {
      const s2sConditions: any[] = [
        eq(complaints.isDeleted, false),
        eq(complaints.complaintType, "student-to-student"),
        eq(complaints.schoolId, schoolId),
        sql`${complaints.teacherId} != ${teacherId}`,
        eq(students.class, assignedClass),
        eq(students.section, assignedSection),
      ];
      if (sessionId != null) s2sConditions.push(eq(complaints.sessionId, sessionId));
      const s2sFromOthers = await db.select().from(complaints)
        .leftJoin(students, eq(complaints.studentId, students.id))
        .where(and(...s2sConditions))
        .orderBy(desc(complaints.createdAt));

      const s2sResults = s2sFromOthers.map(r => ({
        ...r.complaints,
        studentName: r.students?.name || null,
      }));

      const merged = [...ownResults, ...s2sResults];
      merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const seen = new Set<number>();
      allResults = merged.filter(c => {
        if (STUDENT_FILED_TYPES.includes(c.complaintType)) return false;
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
      });
    }

    // Fetch all students from junction table for these complaints
    const ids = allResults.map(c => c.id);
    const studentsByComplaint = new Map<number, { id: number; name: string; class: string | null; section: string | null }[]>();
    if (ids.length > 0) {
      const csRows = await db.select({
        complaintId: complaintStudents.complaintId,
        id: students.id,
        name: students.name,
        cls: students.class,
        sec: students.section,
      })
        .from(complaintStudents)
        .innerJoin(students, eq(complaintStudents.studentId, students.id))
        .where(inArray(complaintStudents.complaintId, ids));
      for (const row of csRows) {
        const list = studentsByComplaint.get(row.complaintId) ?? [];
        list.push({ id: row.id, name: row.name, class: row.cls, section: row.sec });
        studentsByComplaint.set(row.complaintId, list);
      }
    }

    return allResults.map(c => {
      const csStudents = studentsByComplaint.get(c.id) ?? [];
      const legacyList = c.studentName ? [{ id: c.studentId ?? 0, name: c.studentName, class: null, section: null }] : [];
      return {
        ...c,
        students: csStudents.length > 0 ? csStudents : legacyList,
      };
    });
  }

  async getStudentInboxComplaints(studentId: number, schoolId: number, sessionId?: number | null): Promise<(Complaint & { teacherName: string; students: { id: number; name: string; class: string | null; section: string | null }[]; batchPeers: { name: string; class: string | null; section: string | null }[] })[]> {
    // Find complaint IDs via junction table (new-style multi-student complaints)
    const junctionRows = await db.select({ complaintId: complaintStudents.complaintId })
      .from(complaintStudents)
      .where(eq(complaintStudents.studentId, studentId));
    const junctionIds = junctionRows.map(r => r.complaintId);

    // Build WHERE: match either legacy complaints.studentId OR junction table
    const baseConditions: SQL<unknown>[] = [
      eq(complaints.schoolId, schoolId),
      eq(complaints.complaintType, "teacher-to-student"),
      eq(complaints.isDeleted, false),
    ];
    if (sessionId) baseConditions.push(eq(complaints.sessionId, sessionId));

    const studentMatch = junctionIds.length > 0
      ? or(eq(complaints.studentId, studentId), inArray(complaints.id, junctionIds))!
      : eq(complaints.studentId, studentId);

    const result = await db.select().from(complaints)
      .innerJoin(teachers, eq(complaints.teacherId, teachers.id))
      .where(and(...baseConditions, studentMatch))
      .orderBy(desc(complaints.createdAt));

    // For each complaint, get all involved students from junction table
    const complaintIds = result.map(r => r.complaints.id);
    const studentsByComplaint = new Map<number, { id: number; name: string; class: string | null; section: string | null }[]>();
    if (complaintIds.length > 0) {
      const csRows = await db.select({
        complaintId: complaintStudents.complaintId,
        id: students.id,
        name: students.name,
        cls: students.class,
        sec: students.section,
      })
        .from(complaintStudents)
        .innerJoin(students, eq(complaintStudents.studentId, students.id))
        .where(inArray(complaintStudents.complaintId, complaintIds));
      for (const row of csRows) {
        const list = studentsByComplaint.get(row.complaintId) ?? [];
        list.push({ id: row.id, name: row.name, class: row.cls, section: row.sec });
        studentsByComplaint.set(row.complaintId, list);
      }
    }

    // For legacy batchId support, fetch sibling students by batchId
    const batchIds = result.map(r => r.complaints.batchId).filter((b): b is string => !!b);
    const batchPeerMap = new Map<string, { name: string; class: string | null; section: string | null }[]>();
    if (batchIds.length > 0) {
      const uniqueBatchIds = [...new Set(batchIds)];
      const siblings = await db.select({
        batchId: complaints.batchId,
        studentId: complaints.studentId,
        name: students.name,
        class: students.class,
        section: students.section,
      })
        .from(complaints)
        .leftJoin(students, eq(complaints.studentId, students.id))
        .where(and(inArray(complaints.batchId, uniqueBatchIds), eq(complaints.isDeleted, false)));
      for (const s of siblings) {
        if (!s.batchId || s.studentId === studentId) continue;
        const list = batchPeerMap.get(s.batchId) ?? [];
        list.push({ name: s.name ?? "Unknown", class: s.class ?? null, section: s.section ?? null });
        batchPeerMap.set(s.batchId, list);
      }
    }

    return result.map(r => {
      const csStudents = studentsByComplaint.get(r.complaints.id) ?? [];
      // For legacy single-student complaints (not in junction table), build from legacy fields
      const legacyStudent = r.complaints.studentId && csStudents.length === 0
        ? [{ id: r.complaints.studentId, name: "Student", class: null, section: null }]
        : [];
      const allStudents = csStudents.length > 0 ? csStudents : legacyStudent;
      const batchPeers = r.complaints.batchId ? (batchPeerMap.get(r.complaints.batchId) ?? []) : [];
      return {
        ...r.complaints,
        teacherName: r.teachers.fullName,
        students: allStudents,
        batchPeers,
      };
    });
  }

  async getStudentFiledComplaints(complainantStudentId: number, schoolId: number, sessionId?: number | null): Promise<(Complaint & { teacherName: string | null })[]> {
    const conditions: SQL<unknown>[] = [
      eq(complaints.complainantStudentId, complainantStudentId),
      eq(complaints.schoolId, schoolId),
      eq(complaints.isDeleted, false),
      sql`${complaints.complaintType} IN ('student-to-staff', 'student-peer-report')`,
    ];
    if (sessionId) conditions.push(eq(complaints.sessionId, sessionId));
    const result = await db.select().from(complaints)
      .leftJoin(teachers, eq(complaints.teacherId, teachers.id))
      .where(and(...conditions))
      .orderBy(desc(complaints.createdAt));
    return result.map(r => ({ ...r.complaints, teacherName: r.teachers?.fullName || null }));
  }

  async createStudentComplaint(data: InsertComplaint): Promise<Complaint> {
    const [c] = await db.insert(complaints).values(data).returning();
    return c;
  }

  async getClassFeedComplaints(
    schoolId: number,
    mappings: { className: string; section: string }[],
    filterClass?: string,
    filterSection?: string,
    sessionId?: number | null,
  ): Promise<(Complaint & { complainantStudentName: string | null })[]> {
    // Narrow mappings to the selected filter (if any)
    const activeMappings = filterClass
      ? mappings.filter(m =>
          m.className === filterClass &&
          (!filterSection || filterSection === "all" || m.section === filterSection)
        )
      : mappings;

    if (activeMappings.length === 0) return [];

    // Step 1: find IDs of TARGET students across all active class-section pairs
    const classSectionConditions = activeMappings.map(m =>
      and(eq(students.class, m.className), eq(students.section, m.section))
    ) as SQL[];

    let targetIds: number[];
    if (sessionId) {
      // Archive mode: resolve student list via session enrollments
      const enrolled = await db.select({ studentId: enrollments.studentId })
        .from(enrollments)
        .innerJoin(students, eq(enrollments.studentId, students.id))
        .where(and(
          eq(enrollments.sessionId, sessionId),
          eq(students.schoolId, schoolId),
          or(...classSectionConditions),
        ));
      targetIds = enrolled.map(e => e.studentId);
    } else {
      const targetStudentRows = await db.select({ id: students.id })
        .from(students)
        .where(and(
          eq(students.schoolId, schoolId),
          eq(students.isActive, true),
          or(...classSectionConditions),
        ));
      targetIds = targetStudentRows.map(s => s.id);
    }
    if (targetIds.length === 0) return [];

    // Step 2: fetch peer-reports where studentId (the TARGET) is in those IDs
    const feedConditions = [
      eq(complaints.schoolId, schoolId),
      eq(complaints.complaintType, "student-peer-report"),
      inArray(complaints.studentId, targetIds),
      eq(complaints.isDeleted, false),
    ] as SQL[];
    if (sessionId) feedConditions.push(eq(complaints.sessionId, sessionId) as SQL);

    const result = await db.select().from(complaints)
      .leftJoin(students, eq(complaints.complainantStudentId, students.id))
      .where(and(...feedConditions))
      .orderBy(desc(complaints.createdAt));
    return result.map(r => ({
      ...r.complaints,
      complainantStudentName: r.students?.name || null,
      complainantPhotoUrl: r.students?.photoUrl ?? null,
    }));
  }

  async resolveComplaint(id: number, schoolId: number, remarks: string | null): Promise<Complaint | null> {
    const [c] = await db.update(complaints)
      .set({ status: "Resolved", ...(remarks != null ? { resolutionRemarks: remarks } : {}) })
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

  async updateSchoolLogo(schoolId: number, logoUrl: string): Promise<void> {
    await db.update(schools).set({ logoUrl, logoUpdatedAt: new Date() }).where(eq(schools.id, schoolId));
  }

  async clearSchoolLogo(schoolId: number): Promise<void> {
    await db.update(schools).set({ logoUrl: null, logoUpdatedAt: new Date() }).where(eq(schools.id, schoolId));
  }

  async updateSchoolInfo(schoolId: number, data: {
    addressLine1?: string | null;
    addressLine2?: string | null;
    city?: string | null;
    state?: string | null;
    pinCode?: string | null;
    country?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    board?: string | null;
    schoolType?: string | null;
    affiliationNumber?: string | null;
    udiseCode?: string | null;
    establishedYear?: number | null;
    registrationNumber?: string | null;
    pan?: string | null;
    gstin?: string | null;
  }): Promise<void> {
    await db.update(schools).set(data).where(eq(schools.id, schoolId));
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
  async upsertExamScores(scores: Array<InsertExamScore & { sessionId: number }>): Promise<ExamScore[]> {
    const results: ExamScore[] = [];
    for (const score of scores) {
      // The authoritative route supplies a required school + session boundary.
      // Both are part of the lookup so another tenant/year can never be updated.
      const conditions: SQL<unknown>[] = [
        eq(examScores.studentId, score.studentId),
        eq(examScores.schoolId, score.schoolId),
        eq(examScores.subject, score.subject),
        eq(examScores.examType, score.examType),
        eq(examScores.sessionId, score.sessionId),
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
            updatedBy: score.updatedBy ?? null,
            updatedAt: new Date(),
            sessionId: score.sessionId,
          })
          .where(eq(examScores.id, existing[0].id)).returning();
        results.push(updated);
      } else {
        const [created] = await db.insert(examScores).values({
          ...score,
          updatedBy: score.updatedBy ?? null,
          updatedAt: new Date(),
        }).returning();
        results.push(created);
      }
    }
    return results;
  }

  async publishExamScores(schoolId: number, cls: string, section: string, examType: string, sessionId?: number): Promise<number> {
    // When a sessionId is supplied, publish only records for that academic year.
    const conditions = [
      eq(examScores.schoolId, schoolId),
      eq(examScores.class, cls),
      eq(examScores.section, section),
      eq(examScores.examType, examType),
      ...(sessionId != null ? [eq(examScores.sessionId, sessionId)] : []),
    ];
    const updated = await db.update(examScores)
      .set({ published: true })
      .where(and(...conditions))
      .returning();
    return updated.length;
  }

  async getExamScores(schoolId: number, subject: string, examType: string, cls: string, section: string, sessionId?: number): Promise<(ExamScore & { studentName: string; dsid: string })[]> {
    const result = await db.select().from(examScores)
      .innerJoin(students, eq(examScores.studentId, students.id))
      .where(and(
        eq(examScores.schoolId, schoolId),
        eq(examScores.subject, subject),
        eq(examScores.examType, examType),
        eq(students.class, cls),
        eq(students.section, section),
        ...(sessionId != null ? [eq(examScores.sessionId, sessionId)] : []),
      ));
    return result.map(r => ({
      ...r.exam_scores,
      studentName: r.students.name,
      dsid: r.students.digitalStudentId,
      photoUrl: r.students.photoUrl ?? null,
    }));
  }

  async getExamScoresByStudent(studentId: number, schoolId: number, sessionId?: number | null): Promise<ExamScore[]> {
    const conditions = [eq(examScores.studentId, studentId), eq(examScores.schoolId, schoolId), ...(sessionId != null ? [eq(examScores.sessionId, sessionId)] : [])];
    return await db.select().from(examScores).where(and(...conditions)).orderBy(examScores.examType);
  }

  async getStudentDistinctClasses(schoolId: number, studentId: number, sessionId?: number | null): Promise<string[]> {
    const conditions: SQL<unknown>[] = [eq(examScores.schoolId, schoolId), eq(examScores.studentId, studentId)];
    if (sessionId) conditions.push(eq(examScores.sessionId, sessionId));
    const rows = await db.selectDistinct({ class: examScores.class })
      .from(examScores)
      .where(and(...conditions))
      .orderBy(sql`${examScores.class} ASC NULLS LAST`);
    return rows.map(r => r.class).filter((c): c is string => c !== null);
  }

  // Student exam types for a specific student+class — no published gate (real-time visibility)
  async getStudentExamTypesForStudent(schoolId: number, studentId: number, cls: string, sessionId?: number | null): Promise<string[]> {
    const conditions: SQL<unknown>[] = [
      eq(examScores.schoolId, schoolId),
      eq(examScores.studentId, studentId),
      eq(examScores.class, cls),
    ];
    if (sessionId) conditions.push(eq(examScores.sessionId, sessionId));
    const rows = await db.select({
      examType: examScores.examType,
      minId: sql<number>`MIN(${examScores.id})`,
    })
      .from(examScores)
      .where(and(...conditions))
      .groupBy(examScores.examType)
      .orderBy(sql`MIN(${examScores.id}) ASC`);
    return rows.map(r => r.examType);
  }

  // Legacy class+section variant kept for non-student uses
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

  // Student score fetch — no published gate (real-time visibility)
  async getStudentExamScores(schoolId: number, studentId: number, cls: string, examType: string, sessionId?: number | null): Promise<ExamScore[]> {
    const conditions: SQL<unknown>[] = [
      eq(examScores.schoolId, schoolId), eq(examScores.studentId, studentId),
      eq(examScores.class, cls), eq(examScores.examType, examType),
    ];
    if (sessionId != null) conditions.push(eq(examScores.sessionId, sessionId));
    return await db.select().from(examScores).where(and(...conditions)).orderBy(examScores.subject);
  }

  // All scores for a student in a class — no published gate (real-time visibility)
  async getStudentAllExamScores(schoolId: number, studentId: number, cls: string, sessionId?: number | null): Promise<ExamScore[]> {
    const conditions: SQL<unknown>[] = [
      eq(examScores.schoolId, schoolId), eq(examScores.studentId, studentId), eq(examScores.class, cls),
    ];
    if (sessionId != null) conditions.push(eq(examScores.sessionId, sessionId));
    return await db.select().from(examScores).where(and(...conditions)).orderBy(examScores.subject, examScores.examType);
  }

  async getClassRank(schoolId: number, cls: string, section: string, examType: string, studentId: number, sessionId: number): Promise<{ rank: number; total: number }> {
    const allScores = await db.select().from(examScores)
      .where(and(
        eq(examScores.schoolId, schoolId),
        eq(examScores.class, cls),
        eq(examScores.section, section),
        eq(examScores.examType, examType),
        eq(examScores.sessionId, sessionId),
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

  async getClassAverages(schoolId: number, cls: string, section: string, subject: string, sessionId?: number | null): Promise<{ examType: string; avgPercentage: number }[]> {
    const studentList = await this.getStudentsByClassSection(schoolId, cls, section);
    const studentIds = studentList.map(s => s.id);
    if (studentIds.length === 0) return [];

    const scoreConditions = [eq(examScores.schoolId, schoolId), eq(examScores.subject, subject), eq(examScores.isAbsent, false)];
    if (sessionId != null) scoreConditions.push(eq(examScores.sessionId, sessionId));
    const allScores = await db.select().from(examScores).where(and(...scoreConditions));

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

  async getGalleryItemById(id: number): Promise<GalleryItem | null> {
    const [item] = await db.select().from(galleryItems).where(eq(galleryItems.id, id));
    return item || null;
  }

  async approveGalleryItem(id: number): Promise<GalleryItem> {
    const [item] = await db.update(galleryItems).set({ approved: true }).where(eq(galleryItems.id, id)).returning();
    return item;
  }

  async getAdminGalleryItems(schoolId: number): Promise<Array<GalleryItem & { teacherName: string | null }>> {
    const rows = await db
      .select({
        id: galleryItems.id,
        schoolId: galleryItems.schoolId,
        uploadedById: galleryItems.uploadedById,
        title: galleryItems.title,
        description: galleryItems.description,
        eventTag: galleryItems.eventTag,
        capturedDate: galleryItems.capturedDate,
        capturedTime: galleryItems.capturedTime,
        location: galleryItems.location,
        imageUrl: galleryItems.imageUrl,
        approved: galleryItems.approved,
        createdAt: galleryItems.createdAt,
        teacherName: teachers.fullName,
      })
      .from(galleryItems)
      .leftJoin(teachers, eq(galleryItems.uploadedById, teachers.id))
      .where(eq(galleryItems.schoolId, schoolId))
      .orderBy(desc(galleryItems.createdAt));
    return rows as Array<GalleryItem & { teacherName: string | null }>;
  }

  async deleteGalleryItem(id: number, schoolId: number): Promise<void> {
    await db.delete(galleryItems).where(and(eq(galleryItems.id, id), eq(galleryItems.schoolId, schoolId)));
  }

  async deleteGalleryItems(ids: number[], schoolId: number): Promise<void> {
    if (ids.length === 0) return;
    await db.delete(galleryItems).where(and(inArray(galleryItems.id, ids), eq(galleryItems.schoolId, schoolId)));
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

  async getFacultyBySchoolWithMappings(schoolId: number): Promise<{
    id: number; fullName: string; subject: string; phone: string;
    assignedClass: string; assignedSection: string;
    designation: string | null; qualifications: string | null;
    department: string | null; profileImageUrl: string | null;
    digitalTeacherId: string | null;
    mappings: { className: string; section: string; subject: string | null }[];
  }[]> {
    const teacherRows = await db.select({
      id: teachers.id,
      fullName: teachers.fullName,
      subject: teachers.subject,
      phone: teachers.phone,
      assignedClass: teachers.assignedClass,
      assignedSection: teachers.assignedSection,
      designation: teachers.designation,
      qualifications: teachers.qualifications,
      department: teachers.department,
      profileImageUrl: teachers.profileImageUrl,
      digitalTeacherId: teachers.digitalTeacherId,
    }).from(teachers).where(eq(teachers.schoolId, schoolId)).orderBy(teachers.fullName);

    const mappingRows = await db.select({
      teacherId: facultyMappings.teacherId,
      className: facultyMappings.className,
      section: facultyMappings.section,
      subject: facultyMappings.subject,
    }).from(facultyMappings)
      .where(eq(facultyMappings.schoolId, schoolId))
      .orderBy(facultyMappings.className, facultyMappings.section);

    const byTeacher = new Map<number, { className: string; section: string; subject: string | null }[]>();
    for (const m of mappingRows) {
      if (!byTeacher.has(m.teacherId)) byTeacher.set(m.teacherId, []);
      byTeacher.get(m.teacherId)!.push({ className: m.className, section: m.section, subject: m.subject });
    }

    return teacherRows.map(t => ({ ...t, mappings: byTeacher.get(t.id) ?? [] }));
  }

  async getFacultyByClassSection(schoolId: number, className: string, section: string): Promise<{
    id: number; fullName: string; subject: string; designation: string | null;
    qualifications: string | null; department: string | null; profileImageUrl: string | null;
    mappedSubject: string | null;
  }[]> {
    const rows = await db.select({
      id: teachers.id,
      fullName: teachers.fullName,
      subject: teachers.subject,
      designation: teachers.designation,
      qualifications: teachers.qualifications,
      department: teachers.department,
      profileImageUrl: teachers.profileImageUrl,
      mappedSubject: facultyMappings.subject,
    }).from(facultyMappings)
      .innerJoin(teachers, eq(facultyMappings.teacherId, teachers.id))
      .where(and(
        eq(facultyMappings.schoolId, schoolId),
        eq(facultyMappings.className, className),
        eq(facultyMappings.section, section),
      ))
      .orderBy(teachers.fullName);
    return rows;
  }

  // ===== CALENDAR METHODS =====
  async createCalendarEvent(data: InsertCalendarEvent): Promise<CalendarEvent> {
    const [event] = await db.insert(calendarEvents).values(data).returning();
    return event;
  }

  async createCalendarEvents(data: InsertCalendarEvent[]): Promise<CalendarEvent[]> {
    if (data.length === 0) return [];
    return await db.insert(calendarEvents).values(data).returning();
  }

  async getCalendarEvents(schoolId: number, filter?: Array<{ cls: string; sec?: string }>): Promise<CalendarEvent[]> {
    const conditions: SQL[] = [eq(calendarEvents.schoolId, schoolId)];
    const audienceFilter = buildCalendarAudienceFilter(filter);
    if (audienceFilter) conditions.push(audienceFilter);
    return await db.select().from(calendarEvents).where(and(...conditions));
  }

  async getCalendarEventsByRange(schoolId: number, startDate: string, endDate: string, filter?: Array<{ cls: string; sec?: string }>): Promise<CalendarEvent[]> {
    const conditions: SQL[] = [
      eq(calendarEvents.schoolId, schoolId),
      gte(calendarEvents.date, startDate),
      lte(calendarEvents.date, endDate),
    ];
    const audienceFilter = buildCalendarAudienceFilter(filter);
    if (audienceFilter) conditions.push(audienceFilter);
    return await db.select().from(calendarEvents).where(and(...conditions));
  }

  async getHolidayOnDate(schoolId: number, date: string): Promise<CalendarEvent | null> {
    const [event] = await db.select().from(calendarEvents).where(
      and(
        eq(calendarEvents.schoolId, schoolId),
        eq(calendarEvents.date, date),
        eq(calendarEvents.eventType, "holiday"),
        eq(calendarEvents.audienceScope, "All_School"),
      )
    );
    return event || null;
  }

  async deleteCalendarEvent(id: number): Promise<boolean> {
    const result = await db.delete(calendarEvents).where(eq(calendarEvents.id, id)).returning();
    return result.length > 0;
  }

  async updateCalendarEvent(id: number, schoolId: number, data: {
    title?: string;
    date?: string;
    eventType?: string;
    venue?: string | null;
    description?: string | null;
    colorCode?: string | null;
    isRecurring?: boolean;
    audienceScope?: string;
    targetClass?: string | null;
    targetSection?: string | null;
  }): Promise<CalendarEvent | null> {
    const [updated] = await db.update(calendarEvents)
      .set(data)
      .where(and(eq(calendarEvents.id, id), eq(calendarEvents.schoolId, schoolId)))
      .returning();
    return updated || null;
  }

  async deleteCalendarEventBySchool(id: number, schoolId: number): Promise<boolean> {
    const result = await db.delete(calendarEvents).where(
      and(eq(calendarEvents.id, id), eq(calendarEvents.schoolId, schoolId))
    ).returning();
    return result.length > 0;
  }

  async deleteGoogleSyncedCalendarEvents(schoolId: number): Promise<number> {
    const result = await db.delete(calendarEvents).where(
      and(eq(calendarEvents.schoolId, schoolId), eq(calendarEvents.venue, "gcal-sync"))
    ).returning();
    return result.length;
  }

  async setSchoolMetadataRaw(schoolId: number, metaKey: string, value: unknown): Promise<void> {
    const metaValue = JSON.stringify(value);
    const existing = await db.select().from(schoolMetadata)
      .where(and(eq(schoolMetadata.schoolId, schoolId), eq(schoolMetadata.metaKey, metaKey)));
    if (existing.length > 0) {
      await db.update(schoolMetadata)
        .set({ metaValue, updatedAt: new Date() })
        .where(eq(schoolMetadata.id, existing[0].id));
    } else {
      await db.insert(schoolMetadata).values({ schoolId, metaKey, metaValue });
    }
  }

  async getSchoolMetadataRaw(schoolId: number, metaKey: string): Promise<unknown> {
    const [row] = await db.select().from(schoolMetadata)
      .where(and(eq(schoolMetadata.schoolId, schoolId), eq(schoolMetadata.metaKey, metaKey)));
    if (!row) return null;
    try { return JSON.parse(row.metaValue); } catch { return null; }
  }

  async getSchoolsWithGoogleAutoSync(): Promise<Array<{ schoolId: number; calendarId: string; apiKey: string }>> {
    const autoSyncRows = await db.select().from(schoolMetadata)
      .where(eq(schoolMetadata.metaKey, "google_calendar_auto_sync"));
    const enabledIds = autoSyncRows
      .filter(r => { try { return JSON.parse(r.metaValue) === true; } catch { return false; } })
      .map(r => r.schoolId);
    if (enabledIds.length === 0) return [];
    const configRows = await db.select().from(schoolMetadata)
      .where(and(eq(schoolMetadata.metaKey, "google_calendar_config"), inArray(schoolMetadata.schoolId, enabledIds)));
    const results: Array<{ schoolId: number; calendarId: string; apiKey: string }> = [];
    for (const row of configRows) {
      try {
        const cfg = JSON.parse(row.metaValue) as any;
        if (cfg?.calendarId && cfg?.apiKey) results.push({ schoolId: row.schoolId, calendarId: cfg.calendarId, apiKey: cfg.apiKey });
      } catch {}
    }
    return results;
  }

  // ===== LIBRARY METHODS =====
  async createLibraryBook(data: InsertLibraryBook): Promise<LibraryBook> {
    const [book] = await db.insert(libraryBooks).values(data).returning();
    return book;
  }

  async getLibraryBooks(schoolId: number): Promise<LibraryBook[]> {
    return await db.select().from(libraryBooks).where(eq(libraryBooks.schoolId, schoolId));
  }

  async getMyUploadedEbooks(teacherId: number, schoolId: number): Promise<(LibraryBook & { uploaderName: string | null })[]> {
    const [books, teacherRow] = await Promise.all([
      db.select().from(libraryBooks).where(and(eq(libraryBooks.schoolId, schoolId), eq(libraryBooks.uploadedById, teacherId))),
      db.select().from(teachers).where(eq(teachers.id, teacherId)),
    ]);
    const uploaderName = teacherRow[0]?.fullName ?? null;
    return books.map(b => ({ ...b, uploaderName }));
  }

  async getLibraryBooksWithUploaderNames(schoolId: number): Promise<(LibraryBook & { uploaderName: string | null })[]> {
    const [books, schoolTeachers] = await Promise.all([
      db.select().from(libraryBooks).where(eq(libraryBooks.schoolId, schoolId)),
      db.select().from(teachers).where(eq(teachers.schoolId, schoolId)),
    ]);
    const teacherMap = new Map(schoolTeachers.map(t => [t.id, t.fullName]));
    return books.map(b => ({ ...b, uploaderName: b.uploadedById ? (teacherMap.get(b.uploadedById) ?? null) : null }));
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

  async getLeaveRequestsByTeacher(teacherId: number, sessionId?: number | null): Promise<LeaveRequest[]> {
    const conditions: any[] = [eq(leaveRequests.teacherId, teacherId)];
    if (sessionId != null) conditions.push(eq(leaveRequests.sessionId, sessionId));
    return await db.select().from(leaveRequests).where(and(...conditions)).orderBy(desc(leaveRequests.createdAt));
  }

  async getLeaveRequestById(id: number): Promise<LeaveRequest | null> {
    const [req] = await db.select().from(leaveRequests).where(eq(leaveRequests.id, id));
    return req || null;
  }

  async getLeaveRequestsBySchool(schoolId: number, sessionId?: number | null): Promise<(LeaveRequest & { teacherName: string; teacherDtid: string | null })[]> {
    const conditions: any[] = [eq(leaveRequests.schoolId, schoolId)];
    if (sessionId != null) conditions.push(eq(leaveRequests.sessionId, sessionId));
    const result = await db.select().from(leaveRequests)
      .innerJoin(teachers, eq(leaveRequests.teacherId, teachers.id))
      .where(and(...conditions))
      .orderBy(desc(leaveRequests.createdAt));
    return result.map(r => ({ ...r.leave_requests, teacherName: r.teachers.fullName, teacherDtid: r.teachers.digitalTeacherId ?? null }));
  }

  async updateLeaveStatus(id: number, status: string): Promise<LeaveRequest> {
    const [req] = await db.update(leaveRequests).set({ status }).where(eq(leaveRequests.id, id)).returning();
    return req;
  }

  // ===== TIMETABLE METHODS =====
  private async requireTimetableSession(schoolId: number, sessionId: number, writable = false): Promise<void> {
    if (!Number.isInteger(schoolId) || schoolId <= 0 || !Number.isInteger(sessionId) || sessionId <= 0) {
      throw new Error("A valid school and academic session are required for Timetable");
    }
    const [session] = await db.select({ isActive: academicSessions.isActive })
      .from(academicSessions)
      .where(and(eq(academicSessions.id, sessionId), eq(academicSessions.schoolId, schoolId)));
    if (!session) throw new Error("Academic session does not belong to this school");
    if (writable && !session.isActive) throw new Error("Archived academic sessions are read-only");
  }

  async createTimetableEntry(data: InsertTimetableEntry): Promise<TimetableEntry> {
    await this.requireTimetableSession(data.schoolId, data.sessionId, true);
    const [teacher] = await db.select({ id: teachers.id }).from(teachers)
      .where(and(eq(teachers.id, data.teacherId), eq(teachers.schoolId, data.schoolId)));
    if (!teacher) throw new Error("Teacher does not belong to this school");
    const [entry] = await db.insert(timetableEntries).values(data).returning();
    return entry;
  }

  async getTimetableByTeacher(schoolId: number, sessionId: number, teacherId: number): Promise<TimetableEntry[]> {
    await this.requireTimetableSession(schoolId, sessionId);
    return await db.select().from(timetableEntries).where(and(
      eq(timetableEntries.schoolId, schoolId), eq(timetableEntries.sessionId, sessionId),
      eq(timetableEntries.teacherId, teacherId),
    ));
  }

  async getTimetableBySchool(schoolId: number, sessionId: number): Promise<(TimetableEntry & { teacherName: string })[]> {
    await this.requireTimetableSession(schoolId, sessionId);
    const result = await db.select().from(timetableEntries)
      .leftJoin(teachers, eq(timetableEntries.teacherId, teachers.id))
      .where(and(eq(timetableEntries.schoolId, schoolId), eq(timetableEntries.sessionId, sessionId)));
    return result.map(r => ({ ...r.timetable_entries, teacherName: r.teachers?.fullName ?? "" }));
  }

  async deleteTimetableEntry(id: number, schoolId: number, sessionId: number): Promise<boolean> {
    await this.requireTimetableSession(schoolId, sessionId, true);
    const result = await db.delete(timetableEntries).where(and(
      eq(timetableEntries.id, id), eq(timetableEntries.schoolId, schoolId), eq(timetableEntries.sessionId, sessionId),
    )).returning();
    return result.length > 0;
  }

  async getTimetableEntryById(id: number, schoolId: number, sessionId: number): Promise<TimetableEntry | null> {
    await this.requireTimetableSession(schoolId, sessionId);
    const [entry] = await db.select().from(timetableEntries).where(and(
      eq(timetableEntries.id, id), eq(timetableEntries.schoolId, schoolId), eq(timetableEntries.sessionId, sessionId),
    ));
    return entry || null;
  }

  async updateTimetableEntry(
    id: number,
    schoolId: number,
    sessionId: number,
    data: Partial<Pick<TimetableEntry, "dayOfWeek" | "period" | "class" | "section" | "subject" | "room" | "startTime" | "endTime" | "status">>
  ): Promise<TimetableEntry | null> {
    await this.requireTimetableSession(schoolId, sessionId, true);
    const updateData: Record<string, unknown> = { ...data };
    const [entry] = await db.update(timetableEntries)
      .set(updateData)
      .where(and(eq(timetableEntries.id, id), eq(timetableEntries.schoolId, schoolId), eq(timetableEntries.sessionId, sessionId)))
      .returning();
    return entry || null;
  }

  async updateTimetableEntryStatus(schoolId: number, sessionId: number, cls: string, section: string, status: string): Promise<number> {
    await this.requireTimetableSession(schoolId, sessionId, true);
    // When publishing, only promote draft entries (not already-published ones)
    const whereConditions = and(
      eq(timetableEntries.schoolId, schoolId),
      eq(timetableEntries.sessionId, sessionId),
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

  async getClassSectionStatus(schoolId: number, sessionId: number): Promise<{ class: string; section: string; totalCount: number; draftCount: number; publishedCount: number }[]> {
    await this.requireTimetableSession(schoolId, sessionId);
    const entries = await db.select().from(timetableEntries).where(and(eq(timetableEntries.schoolId, schoolId), eq(timetableEntries.sessionId, sessionId)));
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
    sessionId: number;
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
    const { schoolId, sessionId, teacherId, dayOfWeek, period, excludeId } = opts;
    await this.requireTimetableSession(schoolId, sessionId, true);
    const [teacher] = await db.select({ id: teachers.id }).from(teachers)
      .where(and(eq(teachers.id, teacherId), eq(teachers.schoolId, schoolId)));
    if (!teacher) return { valid: false, error: "Teacher does not belong to this school" };

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
        eq(timetableEntries.sessionId, sessionId),
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
          eq(timetableEntries.sessionId, sessionId),
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

  async getTimetableByClassSection(schoolId: number, sessionId: number, cls: string, section: string): Promise<(TimetableEntry & { teacherName: string })[]> {
    await this.requireTimetableSession(schoolId, sessionId);
    const conditions: any[] = [
      eq(timetableEntries.schoolId, schoolId),
      eq(timetableEntries.sessionId, sessionId),
      eq(timetableEntries.class, cls),
      eq(timetableEntries.section, section),
    ];
    const result = await db.select().from(timetableEntries)
      .leftJoin(teachers, eq(timetableEntries.teacherId, teachers.id))
      .where(and(...conditions));
    return result.map(r => ({ ...r.timetable_entries, teacherName: r.teachers?.fullName ?? "" }));
  }

  async upsertTimetableSlot(
    schoolId: number,
    sessionId: number,
    opts: { dayOfWeek: number; period: number; class: string; section: string; teacherId: number; subject: string }
  ): Promise<TimetableEntry> {
    await this.requireTimetableSession(schoolId, sessionId, true);
    const [teacher] = await db.select({ id: teachers.id }).from(teachers)
      .where(and(eq(teachers.id, opts.teacherId), eq(teachers.schoolId, schoolId)));
    if (!teacher) throw new Error("Teacher does not belong to this school");
    // Use ON CONFLICT DO UPDATE so the insert is atomic against the unique index
    // timetable_class_slot_unique (school_id, session_id, class, section, day_of_week, period)
    const [result] = await db.insert(timetableEntries).values({
      schoolId,
      sessionId,
      teacherId: opts.teacherId,
      dayOfWeek: opts.dayOfWeek,
      period: opts.period,
      class: opts.class,
      section: opts.section,
      subject: opts.subject,
      status: "draft",
    })
    .onConflictDoUpdate({
      target: [
        timetableEntries.schoolId,
        timetableEntries.sessionId,
        timetableEntries.class,
        timetableEntries.section,
        timetableEntries.dayOfWeek,
        timetableEntries.period,
      ],
      set: {
        teacherId: opts.teacherId,
        subject: opts.subject,
        status: "draft",
      },
    })
    .returning();
    return result;
  }

  async deleteTimetableSlot(schoolId: number, sessionId: number, cls: string, section: string, dayOfWeek: number, period: number): Promise<boolean> {
    await this.requireTimetableSession(schoolId, sessionId, true);
    const result = await db.delete(timetableEntries).where(
      and(
        eq(timetableEntries.schoolId, schoolId),
        eq(timetableEntries.sessionId, sessionId),
        eq(timetableEntries.class, cls),
        eq(timetableEntries.section, section),
        eq(timetableEntries.dayOfWeek, dayOfWeek),
        eq(timetableEntries.period, period),
      )
    ).returning();
    return result.length > 0;
  }

  async checkSlotOccupancy(schoolId: number, sessionId: number, cls: string, section: string, dayOfWeek: number, period: number, excludeTeacherId?: number): Promise<{ occupied: boolean; teacherName: string; teacherId: number; subject: string } | null> {
    await this.requireTimetableSession(schoolId, sessionId);
    const rows = await db.select().from(timetableEntries)
      .innerJoin(teachers, eq(timetableEntries.teacherId, teachers.id))
      .where(and(
        eq(timetableEntries.schoolId, schoolId),
        eq(timetableEntries.sessionId, sessionId),
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
    sessionId: number,
    teacherId: number,
    opts: { dayOfWeek: number; period: number; class: string; section: string; subject: string; room?: string | null },
  ): Promise<TimetableEntry> {
    await this.requireTimetableSession(schoolId, sessionId, true);
    const [teacher] = await db.select({ id: teachers.id }).from(teachers)
      .where(and(eq(teachers.id, teacherId), eq(teachers.schoolId, schoolId)));
    if (!teacher) throw new Error("Teacher does not belong to this school");
    const conditions: any[] = [
      eq(timetableEntries.schoolId, schoolId),
      eq(timetableEntries.sessionId, sessionId),
      eq(timetableEntries.teacherId, teacherId),
      eq(timetableEntries.dayOfWeek, opts.dayOfWeek),
      eq(timetableEntries.period, opts.period),
    ];
    const existing = await db.select().from(timetableEntries).where(and(...conditions));
    if (existing.length > 0) {
      const [updated] = await db.update(timetableEntries)
        .set({ class: opts.class, section: opts.section, subject: opts.subject, room: opts.room ?? null, status: "draft" })
        .where(and(eq(timetableEntries.id, existing[0].id), eq(timetableEntries.schoolId, schoolId), eq(timetableEntries.sessionId, sessionId)))
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
      room: opts.room ?? null,
      status: "draft",
      sessionId,
    }).returning();
    return created;
  }

  async deleteTeacherTimetableSlot(schoolId: number, sessionId: number, teacherId: number, dayOfWeek: number, period: number): Promise<boolean> {
    await this.requireTimetableSession(schoolId, sessionId, true);
    const result = await db.delete(timetableEntries).where(
      and(
        eq(timetableEntries.schoolId, schoolId),
        eq(timetableEntries.sessionId, sessionId),
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

  async getTeacherUserByEmailAndSchool(email: string, schoolId: number): Promise<{ teacher: Teacher; user: User } | null> {
    const result = await db.select().from(users)
      .innerJoin(teachers, eq(users.id, teachers.userId))
      .where(and(
        eq(users.email, email),
        eq(users.schoolId, schoolId),
        eq(users.role, "teacher"),
        eq(users.isActive, true),
        eq(teachers.schoolId, schoolId),
      ))
      .limit(2);
    if (result.length === 0) return null;
    if (result.length > 1) {
      throw new Error("Ambiguous teacher account for school");
    }
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

  /**
   * Returns the admin-configured class → sections map.
   * Source: `class_sections` key in school_metadata (set by admin in School Setup).
   * If not yet configured, returns {} so that all teacher modules fall back to
   * the full flat sections list for every class (no partial derivation from students
   * or faculty mappings that would silently hide sections from teachers).
   */
  async getClassSectionsMap(schoolId: number): Promise<Record<string, string[]>> {
    const [row] = await db.select().from(schoolMetadata)
      .where(and(eq(schoolMetadata.schoolId, schoolId), eq(schoolMetadata.metaKey, "class_sections")));

    if (row) {
      try {
        const parsed = JSON.parse(row.metaValue);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, string[]>;
        }
      } catch {}
    }

    return {};
  }

  async setClassSectionsMetadata(schoolId: number, map: Record<string, string[]>): Promise<void> {
    const value = JSON.stringify(map);
    const [existing] = await db.select().from(schoolMetadata)
      .where(and(eq(schoolMetadata.schoolId, schoolId), eq(schoolMetadata.metaKey, "class_sections")));
    if (existing) {
      await db.update(schoolMetadata).set({ metaValue: value }).where(eq(schoolMetadata.id, existing.id));
    } else {
      await db.insert(schoolMetadata).values({ schoolId, metaKey: "class_sections", metaValue: value });
    }
  }

  async getClassSubjectsMap(schoolId: number): Promise<Record<string, string[]>> {
    const [row] = await db.select().from(schoolMetadata)
      .where(and(eq(schoolMetadata.schoolId, schoolId), eq(schoolMetadata.metaKey, "class_subjects")));
    if (row) {
      try {
        const parsed = JSON.parse(row.metaValue);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, string[]>;
        }
      } catch {}
    }
    return {};
  }

  async getClassExamTypesMap(schoolId: number): Promise<Record<string, string[]>> {
    const [row] = await db.select().from(schoolMetadata)
      .where(and(eq(schoolMetadata.schoolId, schoolId), eq(schoolMetadata.metaKey, "class_exam_types")));
    if (row) {
      try {
        const parsed = JSON.parse(row.metaValue);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, string[]>;
        }
      } catch {}
    }
    return {};
  }

  async setClassSubjectsMetadata(schoolId: number, map: Record<string, string[]>): Promise<void> {
    const value = JSON.stringify(map);
    const [existing] = await db.select().from(schoolMetadata)
      .where(and(eq(schoolMetadata.schoolId, schoolId), eq(schoolMetadata.metaKey, "class_subjects")));
    if (existing) {
      await db.update(schoolMetadata).set({ metaValue: value }).where(eq(schoolMetadata.id, existing.id));
    } else {
      await db.insert(schoolMetadata).values({ schoolId, metaKey: "class_subjects", metaValue: value });
    }
  }

  async setClassExamTypesMetadata(schoolId: number, map: Record<string, string[]>): Promise<void> {
    const value = JSON.stringify(map);
    const [existing] = await db.select().from(schoolMetadata)
      .where(and(eq(schoolMetadata.schoolId, schoolId), eq(schoolMetadata.metaKey, "class_exam_types")));
    if (existing) {
      await db.update(schoolMetadata).set({ metaValue: value }).where(eq(schoolMetadata.id, existing.id));
    } else {
      await db.insert(schoolMetadata).values({ schoolId, metaKey: "class_exam_types", metaValue: value });
    }
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
        eq(students.isActive, true),
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

  async getStudentLeavesByClassSection(schoolId: number, cls: string, section: string, sessionId?: number | null): Promise<(StudentLeaveRequest & { studentName: string; dsid: string })[]> {
    const conditions: any[] = [
      eq(studentLeaveRequests.schoolId, schoolId),
      eq(students.class, cls),
      eq(students.section, section),
      eq(studentLeaveRequests.status, "pending_teacher"),
    ];
    if (sessionId != null) conditions.push(eq(studentLeaveRequests.sessionId, sessionId));
    const result = await db.select().from(studentLeaveRequests)
      .innerJoin(students, eq(studentLeaveRequests.studentId, students.id))
      .where(and(...conditions))
      .orderBy(desc(studentLeaveRequests.createdAt));
    return result.map(r => ({
      ...r.student_leave_requests,
      studentName: r.students.name,
      dsid: r.students.digitalStudentId,
      photoUrl: r.students.photoUrl ?? null,
    }));
  }

  // Returns all pending_teacher leaves from every class-section a teacher is mapped to.
  // Uses faculty_mappings (the admin-configured multi-class assignment) rather than the
  // single assignedClass/assignedSection field, so multi-class teachers see all their students.
  async getStudentLeavesByTeacher(teacherId: number, schoolId: number, sessionId?: number | null): Promise<(StudentLeaveRequest & { studentName: string; dsid: string; class: string; section: string })[]> {
    // 1. Get all class-sections this teacher is mapped to
    const mappings = await db
      .select({ className: facultyMappings.className, section: facultyMappings.section })
      .from(facultyMappings)
      .where(and(eq(facultyMappings.teacherId, teacherId), eq(facultyMappings.schoolId, schoolId)));

    if (mappings.length === 0) return [];

    // 2. Build OR conditions for each class+section pair
    const classConditions = mappings.map(m =>
      and(eq(students.class, m.className), eq(students.section, m.section))
    );

    const whereConditions: any[] = [
      eq(studentLeaveRequests.schoolId, schoolId),
      eq(studentLeaveRequests.status, "pending_teacher"),
      or(...classConditions),
    ];
    if (sessionId != null) whereConditions.push(eq(studentLeaveRequests.sessionId, sessionId));

    const result = await db.select().from(studentLeaveRequests)
      .innerJoin(students, eq(studentLeaveRequests.studentId, students.id))
      .where(and(...whereConditions))
      .orderBy(desc(studentLeaveRequests.createdAt));

    // Deduplicate in case a student appears in multiple mappings for the same teacher
    const seen = new Set<number>();
    return result
      .filter(r => { if (seen.has(r.student_leave_requests.id)) return false; seen.add(r.student_leave_requests.id); return true; })
      .map(r => ({
        ...r.student_leave_requests,
        studentName: r.students.name,
        dsid: r.students.digitalStudentId,
        photoUrl: r.students.photoUrl ?? null,
        class: r.students.class,
        section: r.students.section,
      }));
  }

  async getStudentLeaveHistoryForTeacher(teacherId: number, schoolId: number): Promise<(StudentLeaveRequest & { studentName: string; dsid: string; class: string; section: string })[]> {
    const result = await db.select().from(studentLeaveRequests)
      .innerJoin(students, eq(studentLeaveRequests.studentId, students.id))
      .where(
        and(
          eq(studentLeaveRequests.schoolId, schoolId),
          eq(studentLeaveRequests.reviewedBy, teacherId),
          eq(studentLeaveRequests.reviewerRole, "teacher")
        )
      )
      .orderBy(desc(studentLeaveRequests.createdAt));

    return result.map(r => ({
      ...r.student_leave_requests,
      studentName: r.students.name,
      dsid: r.students.digitalStudentId,
      photoUrl: r.students.photoUrl ?? null,
      class: r.students.class,
      section: r.students.section,
    }));
  }

  async updateStudentLeaveStatus(id: number, schoolId: number, status: string, reviewedBy: number, reviewerRole: string, rejectionReason?: string, adminComment?: string, teacherComment?: string): Promise<StudentLeaveRequest | null> {
    const updateData: Record<string, unknown> = { status, reviewedBy, reviewerRole };
    if (rejectionReason !== undefined) updateData.rejectionReason = rejectionReason;
    if (adminComment !== undefined) updateData.adminComment = adminComment;
    if (teacherComment !== undefined) updateData.teacherComment = teacherComment;
    const [req] = await db.update(studentLeaveRequests)
      .set(updateData)
      .where(and(
        eq(studentLeaveRequests.id, id),
        eq(studentLeaveRequests.schoolId, schoolId),
      )).returning();
    return req ?? null;
  }

  async getStudentLeavesByStudent(studentId: number, sessionId?: number | null): Promise<StudentLeaveRequest[]> {
    const conditions: SQL<unknown>[] = [eq(studentLeaveRequests.studentId, studentId)];
    if (sessionId) conditions.push(eq(studentLeaveRequests.sessionId, sessionId));
    return await db.select().from(studentLeaveRequests)
      .where(and(...conditions))
      .orderBy(desc(studentLeaveRequests.createdAt));
  }

  async getStudentLeaveById(id: number, schoolId: number): Promise<StudentLeaveRequest | null> {
    const [req] = await db.select().from(studentLeaveRequests).where(and(
      eq(studentLeaveRequests.id, id),
      eq(studentLeaveRequests.schoolId, schoolId),
    ));
    return req || null;
  }

  async deleteStudentLeaveRequest(id: number, studentId: number): Promise<{ success: boolean; reason?: string }> {
    const [leave] = await db.select().from(studentLeaveRequests).where(and(
      eq(studentLeaveRequests.id, id),
      eq(studentLeaveRequests.studentId, studentId),
    ));
    if (!leave) return { success: false, reason: "not_found" };
    if (leave.status !== "pending_teacher") return { success: false, reason: "not_pending" };
    await db.delete(studentLeaveRequests).where(and(
      eq(studentLeaveRequests.id, id),
      eq(studentLeaveRequests.studentId, studentId),
    ));
    return { success: true };
  }

  async deleteLeaveRequest(id: number, teacherId: number): Promise<{ success: boolean; reason?: string }> {
    const leave = await this.getLeaveRequestById(id);
    if (!leave) return { success: false, reason: "not_found" };
    if (leave.teacherId !== teacherId) return { success: false, reason: "forbidden" };
    if (leave.status !== "pending") return { success: false, reason: "not_pending" };
    await db.delete(leaveRequests).where(eq(leaveRequests.id, id));
    return { success: true };
  }

  async approveStudentLeaveWithAttendance(input: {
    leaveId: number;
    studentId: number;
    teacherId: number | null;
    schoolId: number;
    sessionId: number;
    expectedStatus: "pending_teacher" | "forwarded_to_admin";
    reviewedBy: number;
    reviewerRole: "teacher" | "admin";
    teacherComment?: string;
    adminComment?: string;
  }): Promise<StudentLeaveRequest | null> {
    const { leaveId, studentId, teacherId, schoolId, sessionId } = input;
    return db.transaction(async tx => {
      // Lock the leave and its Session before validating. Activation must wait
      // until this Attendance write commits, rather than archiving it mid-write.
      const [leave] = await tx.select().from(studentLeaveRequests).where(and(
        eq(studentLeaveRequests.id, leaveId),
        eq(studentLeaveRequests.schoolId, schoolId),
      )).for("update");
      if (!leave || leave.status !== input.expectedStatus) return null;
      if (leave.studentId !== studentId || leave.sessionId !== sessionId) {
        throw new AttendanceLeaveMutationError("Leave request does not belong to this Student and Session", 403);
      }
      const [session] = await tx.select().from(academicSessions).where(and(
        eq(academicSessions.id, sessionId),
        eq(academicSessions.schoolId, schoolId),
      )).for("update");
      const [active] = await tx.select({ id: academicSessions.id }).from(academicSessions)
        .where(and(eq(academicSessions.schoolId, schoolId), eq(academicSessions.isActive, true))).limit(1);
      if (!session || !session.isActive || active?.id !== sessionId) {
        throw new AttendanceLeaveMutationError("Attendance can only be changed in the active academic session");
      }
      if (!isValidDateOnly(session.startDate) || !isValidDateOnly(session.endDate) ||
          session.startDate > session.endDate ||
          !isValidDateOnly(leave.startDate) || !isValidDateOnly(leave.endDate) ||
          leave.startDate > leave.endDate) {
        throw new AttendanceLeaveMutationError("Invalid Attendance date range", 400);
      }
      const [student] = await tx.select().from(students).where(and(
        eq(students.id, studentId), eq(students.schoolId, schoolId),
      ));
      const [teacher] = teacherId === null ? [null] : await tx.select({ id: teachers.id }).from(teachers)
        .where(and(eq(teachers.id, teacherId), eq(teachers.schoolId, schoolId)));
      if (!student || (teacherId !== null && !teacher)) {
        throw new AttendanceLeaveMutationError("Leave Attendance entities do not belong to the same school", 403);
      }

      const today = todayInIST();
      const earliest = addCalendarDays(today, -7);
      const dates: string[] = [];
      for (let date = leave.startDate; date <= leave.endDate; date = addCalendarDays(date, 1)) {
        if (calendarWeekday(date) === 0) continue; // Preserve the existing leave-specific Sunday skip.
        if (date < session.startDate || date > session.endDate) {
          throw new AttendanceLeaveMutationError("Attendance date is outside the active academic session period", 400);
        }
        if (date > today) throw new AttendanceLeaveMutationError("Cannot mark attendance for future dates", 400);
        if (date < earliest) throw new AttendanceLeaveMutationError("Can only edit attendance for the past 7 days", 400);
        dates.push(date);
      }
      const holidays = dates.length ? await tx.select({ date: calendarEvents.date }).from(calendarEvents).where(and(
        eq(calendarEvents.schoolId, schoolId),
        eq(calendarEvents.eventType, "holiday"),
        eq(calendarEvents.audienceScope, "All_School"),
        inArray(calendarEvents.date, dates),
      )) : [];
      const holidayDates = new Set(holidays.map(holiday => holiday.date));

      const [enrollment] = await tx.select({
        class: enrollments.className, section: enrollments.sectionName,
      }).from(enrollments).where(and(
        eq(enrollments.schoolId, schoolId),
        eq(enrollments.sessionId, sessionId),
        eq(enrollments.studentId, studentId),
      )).limit(1);
      const [snapshot] = enrollment ? [null] : await tx.select({
        class: attendanceRecords.class, section: attendanceRecords.section,
      }).from(attendanceRecords).where(and(
        eq(attendanceRecords.schoolId, schoolId),
        eq(attendanceRecords.sessionId, sessionId),
        eq(attendanceRecords.identityKey, student.attendanceIdentityKey),
        isNotNull(attendanceRecords.class),
        isNotNull(attendanceRecords.section),
      )).orderBy(attendanceRecords.date, attendanceRecords.id).limit(1);
      const cls = enrollment?.class || snapshot?.class || (student.isActive ? student.class : null);
      const section = enrollment?.section || snapshot?.section || (student.isActive ? student.section : null);

      // Validate every date before the first update; the transaction also rolls
      // back both Attendance and approval if any database write fails.
      const changes: Array<{ date: string; existing: AttendanceRecord | undefined }> = [];
      for (const date of dates) {
        if (holidayDates.has(date)) continue;
        const [existing] = await tx.select().from(attendanceRecords).where(and(
          eq(attendanceRecords.schoolId, schoolId),
          eq(attendanceRecords.sessionId, sessionId),
          eq(attendanceRecords.identityKey, student.attendanceIdentityKey),
          eq(attendanceRecords.date, date),
        ));
        if ((existing && (!existing.class?.trim() || !existing.section?.trim())) ||
            (!existing && teacherId !== null && (!cls?.trim() || !section?.trim()))) {
          throw new AttendanceLeaveMutationError("Authoritative Student class and section are required for Attendance");
        }
        changes.push({ date, existing });
      }
      for (const { date, existing } of changes) {
        if (existing) {
          await tx.update(attendanceRecords)
            .set({ status: "leave", markedBy: "System (Leave Approved)", markedAt: new Date() })
            .where(and(eq(attendanceRecords.id, existing.id),
              eq(attendanceRecords.schoolId, schoolId), eq(attendanceRecords.sessionId, sessionId)));
        } else if (teacherId !== null) {
          await tx.insert(attendanceRecords).values({
            studentId, originalStudentId: studentId,
            identityKey: student.attendanceIdentityKey,
            studentNameSnapshot: student.name,
            studentCodeSnapshot: student.digitalStudentId,
            teacherId, schoolId, sessionId, date,
            class: cls!, section: section!,
            status: "leave", editCount: 0, markedBy: "System (Leave Approved)", markedAt: new Date(),
          });
        }
        // Preserve admin approval without a class teacher: no new Attendance row.
      }
      const [approved] = await tx.update(studentLeaveRequests).set({
        status: "approved",
        reviewedBy: input.reviewedBy,
        reviewerRole: input.reviewerRole,
        ...(input.teacherComment !== undefined && { teacherComment: input.teacherComment }),
        ...(input.adminComment !== undefined && { adminComment: input.adminComment }),
      }).where(and(
        eq(studentLeaveRequests.id, leaveId),
        eq(studentLeaveRequests.schoolId, schoolId),
        eq(studentLeaveRequests.status, input.expectedStatus),
      )).returning();
      return approved ?? null;
    });
  }

  // ===== AUDIT LOGS =====
  async createAuditLog(data: InsertAuditLog): Promise<AuditLog> {
    let sessionId = data.sessionId;
    if (sessionId === undefined) {
      const active = await this.getActiveSession(data.schoolId);
      sessionId = active?.id ?? null;
    }
    const [log] = await db.insert(auditLogs).values({ ...data, sessionId }).returning();
    return log;
  }

  async getAuditLogs(schoolId: number, limit: number = 100): Promise<AuditLog[]> {
    return await db.select().from(auditLogs)
      .where(eq(auditLogs.schoolId, schoolId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);
  }

  // ===== ENHANCED LIBRARY =====
  async getLibraryBookById(id: number): Promise<LibraryBook | null> {
    const [book] = await db.select().from(libraryBooks).where(eq(libraryBooks.id, id));
    return book || null;
  }

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

  // ===== LEAVE POLICIES =====
  async getLeavePoliciesBySchool(schoolId: number): Promise<LeavePolicy[]> {
    return await db.select().from(leavePolicies)
      .where(eq(leavePolicies.schoolId, schoolId))
      .orderBy(leavePolicies.createdAt);
  }

  async getActiveLeavePoliciesBySchool(schoolId: number, requesterRole?: "teacher" | "non_teaching"): Promise<LeavePolicy[]> {
    const all = await db.select().from(leavePolicies)
      .where(and(eq(leavePolicies.schoolId, schoolId), eq(leavePolicies.isActive, true)))
      .orderBy(leavePolicies.createdAt);
    if (!requesterRole) return all;
    return all.filter(p => p.targetRoles === "all" || p.targetRoles === requesterRole);
  }

  async createLeavePolicy(data: InsertLeavePolicy): Promise<LeavePolicy> {
    const [policy] = await db.insert(leavePolicies).values(data).returning();
    return policy;
  }

  async updateLeavePolicy(id: number, schoolId: number, data: Partial<InsertLeavePolicy>): Promise<LeavePolicy> {
    const [policy] = await db.update(leavePolicies).set(data).where(and(eq(leavePolicies.id, id), eq(leavePolicies.schoolId, schoolId))).returning();
    return policy;
  }

  async deleteLeavePolicy(id: number, schoolId: number): Promise<void> {
    await db.delete(leavePolicies).where(and(eq(leavePolicies.id, id), eq(leavePolicies.schoolId, schoolId)));
  }

  async getLeavePolicyById(id: number): Promise<LeavePolicy | null> {
    const [policy] = await db.select().from(leavePolicies).where(eq(leavePolicies.id, id));
    return policy ?? null;
  }

  // ===== TEACHER LEAVE BALANCE (policy-driven) =====
  async getTeacherLeaveBalance(teacherId: number): Promise<{ sick: number; casual: number; earned: number }> {
    const year = dateOnlyParts(todayInIST())!.year;
    const startOfYear = `${year}-01-01`;
    const endOfYear = `${year}-12-31`;
    const approved = await db.select().from(leaveRequests)
      .where(and(
        eq(leaveRequests.teacherId, teacherId),
        eq(leaveRequests.status, "approved"),
        gte(leaveRequests.startDate, startOfYear),
        lte(leaveRequests.endDate, endOfYear)
      ));
    let sick = 0, casual = 0, earned = 0;
    for (const r of approved) {
      const days = (calendarDayDifference(r.startDate, r.endDate) ?? -1) + 1;
      if (days <= 0) continue;
      const type = r.leaveType.toLowerCase();
      if (type.includes("sick")) sick += days;
      else if (type.includes("casual")) casual += days;
      else earned += days;
    }
    return { sick, casual, earned };
  }

  async getTeacherLeaveBalanceByPolicies(teacherId: number, schoolId: number): Promise<{
    policyId: number;
    name: string;
    annualLimit: number;
    carryForward: number;
    used: number;
    remaining: number;
    validUntil: string;
  }[]> {
    const policies = await this.getActiveLeavePoliciesBySchool(schoolId, "teacher");
    if (policies.length === 0) return [];

    const todayStr = todayInIST();
    const todayParts = dateOnlyParts(todayStr)!;
    const result = [];

    for (const policy of policies) {
      const mm = String(policy.renewalMonth).padStart(2, "0");
      const dd = String(policy.renewalDay).padStart(2, "0");
      const renewalThisYear = `${todayParts.year}-${mm}-${dd}`;
      const renewalNextYear = `${todayParts.year + 1}-${mm}-${dd}`;
      const renewalLastYear = `${todayParts.year - 1}-${mm}-${dd}`;

      let periodStart: string;
      let periodEnd: string;
      if (todayStr >= renewalThisYear) {
        periodStart = renewalThisYear;
        periodEnd = addCalendarDays(renewalNextYear, -1);
      } else {
        periodStart = renewalLastYear;
        periodEnd = addCalendarDays(renewalThisYear, -1);
      }

      const currentApproved = await db.select().from(leaveRequests)
        .where(and(
          eq(leaveRequests.teacherId, teacherId),
          eq(leaveRequests.status, "approved"),
          or(eq(leaveRequests.policyId, policy.id), and(sql`${leaveRequests.policyId} IS NULL`, eq(leaveRequests.leaveType, policy.name))),
          lte(leaveRequests.startDate, periodEnd),
          gte(leaveRequests.endDate, periodStart)
        ));

      let used = 0;
      for (const r of currentApproved) {
        const start = r.startDate > periodStart ? r.startDate : periodStart;
        const end = r.endDate < periodEnd ? r.endDate : periodEnd;
        const overlapDays = calendarDayDifference(start, end);
        if (overlapDays !== null && overlapDays >= 0) used += overlapDays + 1;
      }

      let carryForward = 0;
      if (policy.expiryBehavior === "carry_forward") {
        const prevPeriodStart = `${parseInt(periodStart.slice(0, 4)) - 1}${periodStart.slice(4)}`;
        const prevPeriodEnd = addCalendarDays(periodStart, -1);

        // Only carry forward if the policy existed before the current period started.
        // A policy created within the current period has no real previous-period history,
        // so carry-forward would inflate the balance with phantom days.
        const policyCreatedStr = dateOnlyInIST(policy.createdAt) ?? "";
        if (policyCreatedStr < periodStart) {
          const prevApproved = await db.select().from(leaveRequests)
            .where(and(
              eq(leaveRequests.teacherId, teacherId),
              eq(leaveRequests.status, "approved"),
              or(eq(leaveRequests.policyId, policy.id), and(sql`${leaveRequests.policyId} IS NULL`, eq(leaveRequests.leaveType, policy.name))),
              lte(leaveRequests.startDate, prevPeriodEnd),
              gte(leaveRequests.endDate, prevPeriodStart)
            ));

          let prevUsed = 0;
          for (const r of prevApproved) {
            const start = r.startDate > prevPeriodStart ? r.startDate : prevPeriodStart;
            const end = r.endDate < prevPeriodEnd ? r.endDate : prevPeriodEnd;
            const overlapDays = calendarDayDifference(start, end);
            if (overlapDays !== null && overlapDays >= 0) prevUsed += overlapDays + 1;
          }
          carryForward = Math.max(0, policy.annualLimit - prevUsed);
        }
      }

      const effectiveLimit = policy.annualLimit + carryForward;
      const remaining = Math.max(0, effectiveLimit - used);

      result.push({ policyId: policy.id, name: policy.name, annualLimit: policy.annualLimit, carryForward, used, remaining, periodStart, validUntil: periodEnd });
    }

    return result;
  }

  async updateLeaveStatusWithApprover(id: number, schoolId: number, status: string, approvedBy: number): Promise<LeaveRequest | null> {
    const [req] = await db.update(leaveRequests).set({ status, approvedBy }).where(and(
      eq(leaveRequests.id, id),
      eq(leaveRequests.schoolId, schoolId),
    )).returning();
    return req ?? null;
  }

  // ===== PAGINATED STUDENTS (Big Data) =====
  async getStudentsPaginated(schoolId: number, opts: { q?: string; cls?: string; section?: string; page?: number; pendingReissue?: boolean; sessionId?: number | null }): Promise<{ data: Student[]; total: number }> {
    const { q, cls, section, page = 1, pendingReissue, sessionId } = opts;
    const limit = 50;
    const offset = (page - 1) * limit;

    // When a sessionId is provided, scope results to students enrolled in that
    // session via the enrollments table.  The student's class / section on the
    // returned objects is overridden with the enrollment's className / sectionName
    // so that ID cards printed for a past session show the correct cohort year.
    if (sessionId != null) {
      const joinConds = [
        eq(enrollments.studentId, students.id),
        eq(enrollments.schoolId,  schoolId),
        eq(enrollments.sessionId, sessionId),
        ...(cls     ? [eq(enrollments.className,   cls)]     : []),
        ...(section ? [eq(enrollments.sectionName, section)] : []),
      ] as any[];

      const whereConds = [
        eq(students.schoolId, schoolId),
        eq(students.isActive, true),
        ...(pendingReissue ? [eq(students.idCardPendingReissue, true)] : []),
        ...(q ? [or(
          ilike(students.name, `%${q}%`),
          ilike(students.digitalStudentId, `%${q}%`),
          ilike(students.phone, `%${q}%`),
        )!] : []),
      ] as any[];

      const [{ total }] = await db
        .select({ total: count() })
        .from(students)
        .innerJoin(enrollments, and(...joinConds))
        .where(and(...whereConds));

      const rows = await db
        .select({
          student:         students,
          enrolledClass:   enrollments.className,
          enrolledSection: enrollments.sectionName,
        })
        .from(students)
        .innerJoin(enrollments, and(...joinConds))
        .where(and(...whereConds))
        .orderBy(students.digitalStudentId)
        .limit(limit)
        .offset(offset);

      // Override class / section with session-specific enrollment values.
      const data = rows.map(r => ({
        ...r.student,
        class:   r.enrolledClass,
        section: r.enrolledSection,
      })) as Student[];

      return { data, total: Number(total) };
    }

    const conditions = [eq(students.schoolId, schoolId), eq(students.isActive, true)] as any[];
    if (cls) conditions.push(eq(students.class, cls));
    if (section) conditions.push(eq(students.section, section));
    if (pendingReissue) conditions.push(eq(students.idCardPendingReissue, true));
    if (q) conditions.push(or(ilike(students.name, `%${q}%`), ilike(students.digitalStudentId, `%${q}%`), ilike(students.phone, `%${q}%`))!);
    const [{ total }] = await db.select({ total: count() }).from(students).where(and(...conditions));
    const data = await db.select().from(students).where(and(...conditions)).orderBy(students.digitalStudentId).limit(limit).offset(offset);
    return { data, total: Number(total) };
  }

  async getStudentsForExport(schoolId: number, opts: { q?: string; cls?: string; section?: string }): Promise<Array<{
    digitalStudentId: string; name: string; class: string; section: string;
    rollNo: string | null; rollNumber: number | null; phone: string;
    gender: string | null; guardianName: string | null;
    isActivated: boolean; isActive: boolean; enrollmentDate: string | null;
    dob: string | null; bloodGroup: string | null;
  }>> {
    const { q, cls, section } = opts;
    const conditions = [eq(students.schoolId, schoolId), eq(students.isActive, true)];
    if (cls) conditions.push(eq(students.class, cls));
    if (section) conditions.push(eq(students.section, section));
    if (q) conditions.push(or(ilike(students.name, `%${q}%`), ilike(students.digitalStudentId, `%${q}%`), ilike(students.phone, `%${q}%`))!);
    const rows = await db
      .select({
        digitalStudentId: students.digitalStudentId,
        name: students.name,
        class: students.class,
        section: students.section,
        phone: students.phone,
        email: students.email,
        gender: students.gender,
        rollNumber: students.rollNumber,
        guardianName: students.guardianName,
        isActivated: students.isActivated,
        isActive: students.isActive,
        enrollmentDate: students.enrollmentDate,
        dob: students.dob,
        bloodGroup: students.bloodGroup,
        rollNo: studentProfiles.rollNo,
      })
      .from(students)
      .leftJoin(studentProfiles, eq(studentProfiles.studentId, students.id))
      .where(and(...conditions))
      .orderBy(students.class, students.section, students.digitalStudentId);
    return rows;
  }

  async updateStudent(id: number, schoolId: number, data: {
    name: string; class: string; section: string; phone: string;
    gender?: string | null; rollNumber?: number | null; guardianName?: string | null;
    dob?: string; enrollmentDate?: string; bloodGroup?: string | null;
    fatherName?: string | null; motherName?: string | null;
    address?: string | null; aadharNumber?: string | null;
    email?: string | null;
  }): Promise<Student | undefined> {
    const setData: Record<string, unknown> = {
      name: data.name, class: data.class, section: data.section, phone: data.phone,
    };
    if (data.gender !== undefined) setData.gender = data.gender;
    if (data.rollNumber !== undefined) setData.rollNumber = data.rollNumber;
    if (data.guardianName !== undefined) setData.guardianName = data.guardianName;
    if (data.dob) setData.dob = data.dob;
    if (data.enrollmentDate) setData.enrollmentDate = data.enrollmentDate;
    if (data.bloodGroup !== undefined) setData.bloodGroup = data.bloodGroup;
    if (data.fatherName !== undefined) setData.fatherName = data.fatherName;
    if (data.motherName !== undefined) setData.motherName = data.motherName;
    if (data.address !== undefined) setData.address = data.address;
    if (data.aadharNumber !== undefined) setData.aadharNumber = data.aadharNumber;
    if (data.email !== undefined) setData.email = data.email;
    return db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${schoolId}, ${id})`);
      const [before] = await tx.select({ email: students.email }).from(students)
        .where(and(eq(students.id, id), eq(students.schoolId, schoolId))).for("update");
      if (!before) return undefined;
      const [updated] = await tx.update(students)
        .set(setData as Partial<typeof students.$inferInsert>)
        .where(and(eq(students.id, id), eq(students.schoolId, schoolId)))
        .returning();
      if (data.email !== undefined && (data.email ?? "").trim().toLowerCase() !== (before.email ?? "").trim().toLowerCase()) {
        const now = new Date();
        await tx.update(studentPasswordResetChallenges).set({ consumedAt: now }).where(and(
          eq(studentPasswordResetChallenges.studentId, id),
          eq(studentPasswordResetChallenges.schoolId, schoolId),
          isNull(studentPasswordResetChallenges.consumedAt),
        ));
      }
      return updated;
    });
  }

  async createStudentPasswordResetChallenge(
    studentId: number,
    schoolId: number,
    expectedEmail: string,
    otpHash: string,
    otpExpiresAt: Date,
    requestIp: string | null,
    now = new Date(),
  ): Promise<StudentPasswordResetChallenge | null> {
    return db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${schoolId}, ${studentId})`);
      const [student] = await tx.select({
        id: students.id,
        schoolId: students.schoolId,
        email: students.email,
        isActive: students.isActive,
        isActivated: students.isActivated,
      }).from(students).where(and(
        eq(students.id, studentId),
        eq(students.schoolId, schoolId),
      )).for("update");
      if (
        !student
        || !student.isActive
        || !student.isActivated
        || !isValidStudentRecoveryEmail(student.email)
        || student.email.trim().toLowerCase() !== expectedEmail.trim().toLowerCase()
      ) return null;
      const [verifiedRecovery] = await tx.select({ id: studentPasswordResetChallenges.id })
        .from(studentPasswordResetChallenges)
        .where(and(
          eq(studentPasswordResetChallenges.studentId, studentId),
          eq(studentPasswordResetChallenges.schoolId, schoolId),
          eq(studentPasswordResetChallenges.purpose, "student_password_recovery"),
          isNull(studentPasswordResetChallenges.consumedAt),
          isNotNull(studentPasswordResetChallenges.verifiedAt),
          gt(studentPasswordResetChallenges.resetTokenExpiresAt, now),
        ))
        .limit(1)
        .for("update");
      if (verifiedRecovery) return null;
      await tx.update(studentPasswordResetChallenges).set({ consumedAt: now }).where(and(
        eq(studentPasswordResetChallenges.studentId, studentId),
        eq(studentPasswordResetChallenges.schoolId, schoolId),
        isNull(studentPasswordResetChallenges.consumedAt),
      ));
      const [challenge] = await tx.insert(studentPasswordResetChallenges).values({
        schoolId,
        studentId,
        purpose: "student_password_recovery",
        otpHash,
        otpExpiresAt,
        attemptCount: 0,
        requestIp,
        createdAt: now,
      }).returning();
      return challenge;
    });
  }

  async getStudentPasswordResetChallenge(
    challengeId: number,
    studentId: number,
    schoolId: number,
  ): Promise<StudentPasswordResetChallenge | undefined> {
    const [challenge] = await db.select().from(studentPasswordResetChallenges).where(and(
      eq(studentPasswordResetChallenges.id, challengeId),
      eq(studentPasswordResetChallenges.studentId, studentId),
      eq(studentPasswordResetChallenges.schoolId, schoolId),
    )).limit(1);
    return challenge;
  }

  async invalidateStudentPasswordResetChallenge(
    challengeId: number,
    studentId: number,
    schoolId: number,
    now = new Date(),
  ): Promise<void> {
    await db.update(studentPasswordResetChallenges).set({ consumedAt: now }).where(and(
      eq(studentPasswordResetChallenges.id, challengeId),
      eq(studentPasswordResetChallenges.studentId, studentId),
      eq(studentPasswordResetChallenges.schoolId, schoolId),
      isNull(studentPasswordResetChallenges.consumedAt),
    ));
  }

  async verifyStudentPasswordResetOtp(
    challengeId: number,
    studentId: number,
    schoolId: number,
    otp: string,
    now = new Date(),
  ): Promise<string | null> {
    return db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${schoolId}, ${studentId})`);
      const [challenge] = await tx.select().from(studentPasswordResetChallenges).where(and(
        eq(studentPasswordResetChallenges.id, challengeId),
        eq(studentPasswordResetChallenges.studentId, studentId),
        eq(studentPasswordResetChallenges.schoolId, schoolId),
        eq(studentPasswordResetChallenges.purpose, "student_password_recovery"),
      )).for("update");
      if (
        !challenge
        || challenge.consumedAt
        || challenge.verifiedAt
        || challenge.otpExpiresAt <= now
        || challenge.attemptCount >= 5
      ) return null;
      const [student] = await tx.select({
        email: students.email,
        isActive: students.isActive,
        isActivated: students.isActivated,
      }).from(students).where(and(
        eq(students.id, studentId),
        eq(students.schoolId, schoolId),
      )).for("update");
      if (!student || !student.isActive || !student.isActivated || !isValidStudentRecoveryEmail(student.email)) return null;
      const suppliedHash = hashPasswordRecoverySecret(otp);
      if (!passwordRecoverySecretsEqual(challenge.otpHash, suppliedHash)) {
        await tx.update(studentPasswordResetChallenges).set({
          attemptCount: sql`LEAST(${studentPasswordResetChallenges.attemptCount} + 1, 5)`,
        }).where(and(
          eq(studentPasswordResetChallenges.id, challenge.id),
          lt(studentPasswordResetChallenges.attemptCount, 5),
        ));
        return null;
      }
      const resetToken = generatePasswordRecoveryToken();
      const [updated] = await tx.update(studentPasswordResetChallenges).set({
        verifiedAt: now,
        resetTokenHash: hashPasswordRecoverySecret(resetToken),
        resetTokenExpiresAt: new Date(now.getTime() + 15 * 60 * 1000),
      }).where(and(
        eq(studentPasswordResetChallenges.id, challenge.id),
        isNull(studentPasswordResetChallenges.verifiedAt),
        isNull(studentPasswordResetChallenges.consumedAt),
      )).returning({ id: studentPasswordResetChallenges.id });
      return updated ? resetToken : null;
    });
  }

  async resetStudentPasswordAtomically(
    challengeId: number,
    studentId: number,
    schoolId: number,
    resetToken: string,
    passwordHash: string,
  ): Promise<boolean> {
    return db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${schoolId}, ${studentId})`);
      const lockClock = await tx.execute<{ now: Date }>(sql`SELECT clock_timestamp() AS now`);
      const transactionNow = new Date(lockClock.rows[0].now);
      const [challenge] = await tx.select().from(studentPasswordResetChallenges).where(and(
        eq(studentPasswordResetChallenges.id, challengeId),
        eq(studentPasswordResetChallenges.studentId, studentId),
        eq(studentPasswordResetChallenges.schoolId, schoolId),
        eq(studentPasswordResetChallenges.purpose, "student_password_recovery"),
        isNull(studentPasswordResetChallenges.consumedAt),
        isNotNull(studentPasswordResetChallenges.verifiedAt),
        gt(studentPasswordResetChallenges.resetTokenExpiresAt, transactionNow),
      )).for("update");
      if (
        !challenge?.resetTokenHash
        || !challenge.resetTokenExpiresAt
        || !passwordRecoverySecretsEqual(
          challenge.resetTokenHash,
          hashPasswordRecoverySecret(resetToken),
        )
      ) return false;
      const [student] = await tx.select({ id: students.id, email: students.email }).from(students).where(and(
        eq(students.id, studentId),
        eq(students.schoolId, schoolId),
        eq(students.isActive, true),
        eq(students.isActivated, true),
      )).for("update");
      if (!student || !isValidStudentRecoveryEmail(student.email)) return false;
      await tx.update(students).set({ passwordHash }).where(and(
        eq(students.id, studentId),
        eq(students.schoolId, schoolId),
      ));
      await tx.update(studentPasswordResetChallenges).set({ consumedAt: transactionNow }).where(and(
        eq(studentPasswordResetChallenges.studentId, studentId),
        eq(studentPasswordResetChallenges.schoolId, schoolId),
        isNull(studentPasswordResetChallenges.consumedAt),
      ));
      const revokedAt = transactionNow.getTime();
      await tx.execute(sql`
        INSERT INTO "session" (sid, sess, expire)
        VALUES (
          ${studentSessionRevocationSid(studentId)},
          ${JSON.stringify({ revokedAt })}::json,
          ${new Date(revokedAt + SESSION_REVOCATION_TTL_MS)}
        )
        ON CONFLICT (sid) DO UPDATE
        SET sess = EXCLUDED.sess, expire = EXCLUDED.expire
      `);
      await tx.execute(sql`
        DELETE FROM "session"
        WHERE sess->>'studentId' = ${String(studentId)}
      `);
      return true;
    });
  }

  async getStudentStats(schoolId: number, cls?: string, section?: string): Promise<{ total: number; boys: number; girls: number }> {
    const conditions = [eq(students.schoolId, schoolId), eq(students.isActive, true)];
    if (cls) conditions.push(eq(students.class, cls));
    if (section) conditions.push(eq(students.section, section));
    const rows = await db
      .select({ gender: students.gender, cnt: count() })
      .from(students)
      .where(and(...conditions))
      .groupBy(students.gender);
    let total = 0, boys = 0, girls = 0;
    for (const r of rows) {
      const n = Number(r.cnt);
      total += n;
      if (r.gender === "Boy") boys = n;
      else if (r.gender === "Girl") girls = n;
    }
    return { total, boys, girls };
  }

  async autoAssignRollNumbers(schoolId: number, cls: string, section: string): Promise<number> {
    const list = await db
      .select({ id: students.id })
      .from(students)
      .where(and(eq(students.schoolId, schoolId), eq(students.class, cls), eq(students.section, section), eq(students.isActive, true)))
      .orderBy(students.name);
    let rollNo = 1;
    for (const s of list) {
      await db.update(students).set({ rollNumber: rollNo }).where(eq(students.id, s.id));
      rollNo++;
    }
    return list.length;
  }

  async bulkDeactivateStudents(
    ids: number[],
    schoolId: number,
  ): Promise<{ id: number; name: string; digitalStudentId: string }[]> {
    if (ids.length === 0) return [];
    const updated = await db.update(students)
      .set({ isActive: false })
      .where(and(inArray(students.id, ids), eq(students.schoolId, schoolId)))
      .returning({ id: students.id, name: students.name, digitalStudentId: students.digitalStudentId });
    return updated;
  }

  // ===== PAGINATED TEACHERS (Big Data) =====
  async updateTeacherAssignment(teacherId: number, schoolId: number, data: { fullName: string; subject: string; assignedClass: string; assignedSection: string; phone?: string; designation?: string; department?: string; gender?: string; dateOfBirth?: string; govtIdType?: string; govtIdNumber?: string; address?: string; joiningDate?: string; qualifications?: string; email?: string }): Promise<Teacher | undefined> {
    const setData: Partial<typeof teachers.$inferInsert> = {
      fullName: data.fullName,
      subject: data.subject,
      assignedClass: data.assignedClass,
      assignedSection: data.assignedSection,
    };
    if (data.phone !== undefined) setData.phone = data.phone;
    if (data.designation !== undefined) setData.designation = data.designation;
    if (data.department !== undefined) setData.department = data.department;
    if (data.gender !== undefined) setData.gender = data.gender;
    if (data.dateOfBirth !== undefined) setData.dateOfBirth = data.dateOfBirth;
    if (data.govtIdType !== undefined) setData.govtIdType = data.govtIdType;
    if (data.govtIdNumber !== undefined) setData.govtIdNumber = data.govtIdNumber;
    if (data.address !== undefined) setData.address = data.address;
    if (data.joiningDate !== undefined) setData.joiningDate = data.joiningDate;
    if (data.qualifications !== undefined) setData.qualifications = data.qualifications;
    return db.transaction(async tx => {
      const [identity] = await tx.select({ teacher: teachers, user: users })
        .from(teachers)
        .innerJoin(users, eq(teachers.userId, users.id))
        .where(and(
          eq(teachers.id, teacherId),
          eq(teachers.schoolId, schoolId),
          eq(users.schoolId, schoolId),
          eq(users.role, "teacher"),
        ))
        .for("update");
      if (!identity || identity.teacher.userId !== identity.user.id) return undefined;

      if (data.email !== undefined) {
        if (data.email !== identity.user.email) {
          const [owner] = await tx.select({ id: users.id })
            .from(users)
            .where(eq(users.email, data.email))
            .for("update");
          if (owner && owner.id !== identity.user.id) {
            throw new TeacherEmailConflictError();
          }
          await tx.update(users)
            .set({ email: data.email })
            .where(and(
              eq(users.id, identity.user.id),
              eq(users.schoolId, schoolId),
              eq(users.role, "teacher"),
            ));
          await tx.update(passwordResetChallenges)
            .set({ consumedAt: new Date() })
            .where(and(
              eq(passwordResetChallenges.userId, identity.user.id),
              eq(passwordResetChallenges.schoolId, schoolId),
              isNull(passwordResetChallenges.consumedAt),
            ));
          await this.invalidateUserSessionsInTransaction(tx, identity.user.id);
        }
      }

      const [updated] = await tx.update(teachers)
        .set(setData)
        .where(and(eq(teachers.id, teacherId), eq(teachers.schoolId, schoolId)))
        .returning();
      return updated;
    });
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

  // ===== DEACTIVATED STUDENT HISTORY =====
  async getDeactivatedStudents(schoolId: number): Promise<Array<{
    id: number; digitalStudentId: string; name: string; class: string; section: string;
    phone: string; email: string | null; gender: string | null; guardianName: string | null;
    dob: string | null; enrollmentDate: string | null; bloodGroup: string | null;
    rollNumber: number | null;
    deactivatedAt: Date | null; deactivationReason: string | null;
    batchYear: string | null; comments: string | null;
    fatherName: string | null; motherName: string | null;
    address: string | null; aadharNumber: string | null;
  }>> {
    const result = await pool.query<{
      id: number; digital_student_id: string; name: string; class: string; section: string;
      phone: string; email: string | null; gender: string | null; guardian_name: string | null;
      dob: string | null; enrollment_date: string | null; blood_group: string | null;
      roll_number: number | null; deactivated_at: Date | null; deactivation_reason: string | null;
      father_name: string | null; mother_name: string | null;
      address: string | null; aadhar_number: string | null;
    }>(
      `WITH best_log AS (
         SELECT DISTINCT ON (s.id)
           s.id AS student_id,
           a.created_at,
           a.details,
           -- prefer individual 'deactivate' logs over bulk ones
           (a.action_type = 'deactivate') AS is_individual
         FROM students s
         LEFT JOIN audit_logs a ON (
           a.school_id = $1
           AND a.entity_type = 'student'
           AND (
             (a.action_type = 'deactivate' AND a.entity_id = s.id)
             OR
             (a.action_type = 'bulk_deactivate'
              AND SUBSTRING(a.details FROM 'IDs:[[:space:]]*(([[:digit:]]|,)+)')
                  ~ (E'(^|,)' || s.id::text || E'(,|$)'))
           )
         )
         WHERE s.school_id = $1 AND s.is_active = false
         ORDER BY s.id,
                  (a.id IS NOT NULL) DESC,
                  (a.action_type = 'deactivate') DESC,
                  a.created_at DESC NULLS LAST
       )
       SELECT s.id, s.digital_student_id, s.name, s.class, s.section, s.phone, s.email,
              s.gender, s.guardian_name, s.dob, s.enrollment_date, s.blood_group, s.roll_number,
              s.father_name, s.mother_name, s.address, s.aadhar_number,
              bl.created_at AS deactivated_at, bl.details AS deactivation_reason
       FROM students s
       LEFT JOIN best_log bl ON bl.student_id = s.id
       WHERE s.school_id = $1 AND s.is_active = false
       ORDER BY bl.created_at DESC NULLS LAST`,
      [schoolId]
    );
    return result.rows.map(r => {
      const details = r.deactivation_reason ?? "";
      const batchMatch = details.match(/Batch:\s*(\d{4}-\d{4})/);
      // Extract comments; strip trailing ". IDs: ..." that appears in bulk logs
      const rawComments = details.match(/Comments:\s*(.+)/)?.[1] ?? null;
      const comments = rawComments ? rawComments.replace(/\.\s*IDs:.*$/i, "").trim() : null;
      return {
        id: r.id,
        digitalStudentId: r.digital_student_id,
        name: r.name,
        class: r.class,
        section: r.section,
        phone: r.phone,
        email: r.email ?? null,
        gender: r.gender,
        guardianName: r.guardian_name,
        dob: r.dob,
        enrollmentDate: r.enrollment_date,
        bloodGroup: r.blood_group,
        rollNumber: r.roll_number,
        deactivatedAt: r.deactivated_at,
        deactivationReason: r.deactivation_reason,
        batchYear: batchMatch ? batchMatch[1] : null,
        comments,
        fatherName:   r.father_name   ?? null,
        motherName:   r.mother_name   ?? null,
        address:      r.address       ?? null,
        aadharNumber: r.aadhar_number ?? null,
      };
    });
  }

  // ===== DEACTIVATION (Soft Delete) =====
  async deactivateStudent(studentId: number, schoolId: number): Promise<Student> {
    const [s] = await db.update(students).set({ isActive: false }).where(and(eq(students.id, studentId), eq(students.schoolId, schoolId))).returning();
    return s;
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

  async getActiveStudentCountsBySchools(): Promise<Record<number, number>> {
    const rows = await db
      .select({ schoolId: students.schoolId, value: count() })
      .from(students)
      .where(eq(students.isActive, true))
      .groupBy(students.schoolId);
    return Object.fromEntries(rows.map(r => [r.schoolId, Number(r.value)]));
  }

  // ===== DAILY ATTENDANCE SUMMARY =====
  async getDailyAttendanceSummary(schoolId: number, sessionId: number, date: string): Promise<{
    total: number;
    applicableTotal: number;
    present: number;
    absent: number;
    leave: number;
    late: number;
    halfDay: number;
    missing: number;
    unknown: number;
    percentage: number;
  }> {
    const records = await db.select().from(attendanceRecords).where(and(
      eq(attendanceRecords.schoolId, schoolId),
      eq(attendanceRecords.sessionId, sessionId),
      eq(attendanceRecords.date, date),
    ));
    const classSections = new Map<string, { class: string; section: string }>();
    for (const record of records) {
      if (record.class && record.section) {
        classSections.set(`${record.class}\u0000${record.section}`, {
          class: record.class,
          section: record.section,
        });
      }
    }

    const statuses: Array<string | null> = [];
    // A Student can have a session roster placement in one class and a
    // historical mark in another. Count the dated mark once, in its saved
    // class, rather than adding a second "missing" entry from the roster.
    const markedIdentityKeys = new Set(records.map(record => record.identityKey));
    for (const context of classSections.values()) {
      const workingDates = await getStudentAttendanceWorkingDates({
        schoolId,
        sessionId,
        class: context.class,
        section: context.section,
        startDate: date,
        endDate: date,
      });
      if (workingDates.length === 0) continue;

      const roster = await this.getAttendanceReportRosterForSessionClass(
        schoolId, sessionId, context.class, context.section,
      );
      const statusByIdentity = new Map(
        records
          .filter(record =>
            record.class === context.class && record.section === context.section
          )
          .map(record => [record.identityKey, record.status]),
      );
      statuses.push(...roster
        .filter(student => statusByIdentity.has(student.identityKey) || !markedIdentityKeys.has(student.identityKey))
        .map(student => statusByIdentity.get(student.identityKey) ?? null));
    }

    const aggregation = aggregateStudentAttendance({
      schoolId,
      sessionId,
      statuses,
    });
    return {
      total: records.length,
      applicableTotal: aggregation.applicableWorkingDays,
      present: aggregation.present,
      absent: aggregation.absent,
      leave: aggregation.leave,
      late: aggregation.late,
      halfDay: aggregation.halfDay,
      missing: aggregation.missing,
      unknown: aggregation.unknown,
      percentage: aggregation.percentage,
    };
  }

  // ===== AUDIT LOGS READER =====
  async getAuditLogsBySchool(schoolId: number, limit = 100, sessionId?: number | null): Promise<AuditLog[]> {
    const conditions: any[] = [eq(auditLogs.schoolId, schoolId)];
    if (sessionId != null) conditions.push(eq(auditLogs.sessionId, sessionId));
    return db.select().from(auditLogs).where(and(...conditions)).orderBy(desc(auditLogs.createdAt)).limit(limit);
  }

  // ===== STUDENT LEAVES FOR ADMIN (forwarded_to_admin only — teacher tier stays hidden) =====
  async getStudentLeavesForAdmin(schoolId: number, sessionId?: number | null): Promise<(StudentLeaveRequest & { studentName: string; dsid: string; class: string; section: string; forwardedByTeacherName: string | null })[]> {
    const conditions: any[] = [eq(studentLeaveRequests.schoolId, schoolId), eq(studentLeaveRequests.status, "forwarded_to_admin")];
    if (sessionId != null) conditions.push(eq(studentLeaveRequests.sessionId, sessionId));
    const leaves = await db.select().from(studentLeaveRequests).where(
      and(...conditions)
    ).orderBy(desc(studentLeaveRequests.createdAt));
    const result = [];
    for (const l of leaves) {
      const s = await this.getStudentById(l.studentId);
      let forwardedByTeacherName: string | null = null;
      if (l.reviewedBy && l.reviewerRole === "teacher") {
        const t = await this.getTeacherById(l.reviewedBy);
        forwardedByTeacherName = t?.fullName ?? null;
      }
      result.push({ ...l, studentName: s?.name ?? "Unknown", dsid: s?.digitalStudentId ?? "", class: s?.class ?? "", section: s?.section ?? "", forwardedByTeacherName });
    }
    return result;
  }

  // ===== APPROVAL HISTORY =====
  async getApprovalHistory(schoolId: number, sessionId?: number | null) {
    // 1. Teacher Leave history — scoped to the viewed session when provided
    const tLeaveConditions = [eq(leaveRequests.schoolId, schoolId), inArray(leaveRequests.status, ["approved", "rejected"])] as any[];
    if (sessionId != null) tLeaveConditions.push(eq(leaveRequests.sessionId, sessionId));
    const tLeaves = await db.select().from(leaveRequests)
      .where(and(...tLeaveConditions))
      .orderBy(desc(leaveRequests.createdAt)).limit(100);
    const teacherLeaveHistory = await Promise.all(tLeaves.map(async l => {
      const t = await this.getTeacherById(l.teacherId);
      return { ...l, teacherName: t?.fullName ?? "Unknown" };
    }));

    // 2. Student Leave history (admin-actioned only) — scoped to session when provided
    const sLeaveConditions = [
      eq(studentLeaveRequests.schoolId, schoolId),
      eq(studentLeaveRequests.reviewerRole, "admin"),
      inArray(studentLeaveRequests.status, ["approved", "rejected"]),
    ] as any[];
    if (sessionId != null) sLeaveConditions.push(eq(studentLeaveRequests.sessionId, sessionId));
    const sLeaves = await db.select().from(studentLeaveRequests)
      .where(and(...sLeaveConditions))
      .orderBy(desc(studentLeaveRequests.createdAt)).limit(100);
    const studentLeaveHistory = await Promise.all(sLeaves.map(async l => {
      const s = await this.getStudentById(l.studentId);
      return { ...l, studentName: s?.name ?? "Unknown", dsid: s?.digitalStudentId ?? "", class: s?.class ?? "", section: s?.section ?? "" };
    }));

    // 3. Gallery history (approved items only — no rejected state in schema)
    const gallery = await db.select().from(galleryItems)
      .where(and(eq(galleryItems.schoolId, schoolId), eq(galleryItems.approved, true)))
      .orderBy(desc(galleryItems.createdAt)).limit(100);
    const galleryHistory = await Promise.all(gallery.map(async g => {
      const t = await this.getTeacherById(g.uploadedById);
      return { ...g, uploaderName: t?.fullName ?? "Unknown" };
    }));

    // 4. Ebook history (approved or rejected)
    const ebooks = await db.select().from(libraryBooks)
      .where(and(eq(libraryBooks.schoolId, schoolId), inArray(libraryBooks.verificationStatus, ["approved", "rejected"])))
      .orderBy(desc(libraryBooks.id)).limit(100);
    const ebookHistory = await Promise.all(ebooks.map(async b => {
      const t = b.uploadedById ? await this.getTeacherById(b.uploadedById) : null;
      return { ...b, uploaderName: t?.fullName ?? "Unknown" };
    }));

    return { teacherLeaves: teacherLeaveHistory, studentLeaves: studentLeaveHistory, gallery: galleryHistory, ebooks: ebookHistory };
  }

  // ===== VISITOR LOGS =====
  async createVisitorLog(data: InsertVisitorLog): Promise<VisitorLog> {
    const [v] = await db.insert(visitorLogs).values(data).returning();
    return v;
  }

  async getVisitorLogsBySchool(schoolId: number, sessionId?: number | null): Promise<VisitorLog[]> {
    const conditions = [eq(visitorLogs.schoolId, schoolId)];
    if (sessionId != null) conditions.push(eq(visitorLogs.sessionId, sessionId));
    return db.select().from(visitorLogs).where(and(...conditions)).orderBy(desc(visitorLogs.createdAt)).limit(200);
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
  async getExamScoresBySchool(schoolId: number, sessionId?: number | null): Promise<ExamScore[]> {
    const conditions: any[] = [eq(examScores.schoolId, schoolId)];
    if (sessionId != null) conditions.push(eq(examScores.sessionId, sessionId));
    return db.select().from(examScores).where(and(...conditions)).orderBy(desc(examScores.createdAt)).limit(500);
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

  async getPendingProfilesForTeacher(
    schoolId: number,
    teacherIdOrPrimaryClass: string | number,
    primarySection?: string,
    sessionId?: number | null,
  ): Promise<(StudentProfile & { studentName: string; dsid: string; currentVerifiedProfile: string | null })[]> {
    // Build the full set of class-sections this teacher covers.
    // Accepts either (schoolId, teacherId) or legacy (schoolId, cls, section).
    const assignments: Array<{ cls: string; sec: string }> = [];

    if (typeof teacherIdOrPrimaryClass === "number") {
      // New path: resolve via teacher record + faculty_mappings
      const [teacherRecord, mappings] = await Promise.all([
        this.getTeacherById(teacherIdOrPrimaryClass),
        this.getFacultyMappingsByTeacher(teacherIdOrPrimaryClass),
      ]);
      if (teacherRecord?.assignedClass && teacherRecord?.assignedSection) {
        assignments.push({ cls: teacherRecord.assignedClass, sec: teacherRecord.assignedSection });
      }
      for (const m of mappings) {
        if (!assignments.some(a => a.cls === m.className && a.sec === m.section)) {
          assignments.push({ cls: m.className, sec: m.section });
        }
      }
    } else {
      // Legacy path: caller passes cls+section strings directly
      const cls = teacherIdOrPrimaryClass;
      const sec = primarySection ?? "";
      if (cls) assignments.push({ cls, sec });
    }

    if (assignments.length === 0) return [];

    // Pre-fetch all students for the assignments — session-scoped if sessionId provided
    const allowedStudentIds = new Set<number>();
    for (const { cls, sec } of assignments) {
      const list = sessionId
        ? await this.getStudentsByClassSectionInSession(schoolId, cls, sec, sessionId)
        : await this.getStudentsByClassSection(schoolId, cls, sec);
      list.forEach(s => allowedStudentIds.add(s.id));
    }
    if (allowedStudentIds.size === 0) return [];

    const allPending = await db
      .select()
      .from(studentProfiles)
      .where(and(
        eq(studentProfiles.schoolId, schoolId),
        or(
          eq(studentProfiles.status, "pending"),        // full profile submitted
          eq(studentProfiles.photoStatus, "pending"),   // photo-only upload awaiting review
        ),
      ))
      .orderBy(desc(studentProfiles.updatedAt));

    const result = [];
    for (const p of allPending) {
      if (!allowedStudentIds.has(p.studentId)) continue;
      const student = await this.getStudentById(p.studentId);
      if (!student) continue;
      result.push({
        ...p,
        studentName: student.name,
        dsid: student.digitalStudentId,
        currentVerifiedProfile: student.verifiedProfile || null,
      });
    }
    return result;
  }

  async bulkApproveStudentProfiles(studentIds: number[], teacherId: number): Promise<{ approved: number; skipped: number }> {
    const teacherRecord = await this.getTeacherById(teacherId);
    const approverName = teacherRecord?.fullName ?? "Teacher";
    const eligible: { studentId: number; snapshot: string; profile: StudentProfile }[] = [];
    const photoUpdates: { studentId: number; photoUrl: string }[] = [];

    for (const studentId of studentIds) {
      const existing = await this.getStudentProfile(studentId);
      // Accept full-profile pending OR photo-only pending
      if (!existing || (existing.status !== "pending" && existing.photoStatus !== "pending")) continue;
      const snap = JSON.stringify({
        fullName: existing.fullName, class: existing.class, section: existing.section,
        rollNo: existing.rollNo, fatherName: existing.fatherName, motherName: existing.motherName,
        presentAddress: existing.presentAddress, aadharNumber: existing.aadharNumber,
        gender: existing.gender, phone: existing.phone, dob: existing.dob,
        enrollmentDate: existing.enrollmentDate, guardianName: existing.guardianName,
        bloodGroup: existing.bloodGroup, photoUrl: existing.photoUrl, approvedAt: new Date().toISOString(),
      });
      eligible.push({ studentId, snapshot: snap, profile: existing });
      if (existing.photoUrl) photoUpdates.push({ studentId, photoUrl: existing.photoUrl });
    }

    const skipped = studentIds.length - eligible.length;

    if (eligible.length === 0) return { approved: 0, skipped };

    await db.transaction(async (tx) => {
      const now = new Date();
      for (const { studentId, snapshot, profile } of eligible) {
        // For photo-only pending (status = draft), only approve the photo — do not flip overall status
        const isPhotoOnly = profile.status !== "pending" && profile.photoStatus === "pending";
        await tx.update(studentProfiles).set({
          ...(isPhotoOnly ? {} : { status: "approved", approvedSnapshot: snapshot }),
          verifiedAt: now,
          verifiedBy: teacherId,
          photoStatus: "approved",
          updatedAt: now,
        }).where(eq(studentProfiles.studentId, studentId));

        // Only write a new verifiedProfile snapshot for full-profile approvals
        if (!isPhotoOnly) {
          const verifiedJson = JSON.stringify({
            ...JSON.parse(snapshot),
            verifiedAt: now.toISOString(),
            approvedByName: approverName,
          });
          await tx.update(students).set({ verifiedProfile: verifiedJson }).where(eq(students.id, studentId));
        }
      }
      for (const { studentId, photoUrl } of photoUpdates) {
        await tx.update(students).set({ photoUrl }).where(eq(students.id, studentId));
      }
    });

    return { approved: eligible.length, skipped };
  }

  async approveStudentProfile(studentId: number, teacherId: number): Promise<StudentProfile> {
    const existing = await this.getStudentProfile(studentId);
    if (!existing) throw new Error("Profile not found");

    // Photo-only approval: profile is still draft/rejected but a new photo is pending
    if (existing.status !== "pending" && existing.photoStatus === "pending") {
      const [updated] = await db
        .update(studentProfiles)
        .set({ photoStatus: "approved", verifiedBy: teacherId, updatedAt: new Date() })
        .where(eq(studentProfiles.studentId, studentId))
        .returning();
      // Propagate the approved photo to the live students record immediately
      if (existing.photoUrl) {
        await db.update(students).set({ photoUrl: existing.photoUrl }).where(eq(students.id, studentId));
      }
      return updated;
    }

    // Full profile approval
    const snapshot = existing
      ? JSON.stringify({
          fullName:       existing.fullName,
          class:          existing.class,
          section:        existing.section,
          rollNo:         existing.rollNo,
          fatherName:     existing.fatherName,
          motherName:     existing.motherName,
          presentAddress: existing.presentAddress,
          aadharNumber:   existing.aadharNumber,
          gender:         existing.gender,
          phone:          existing.phone,
          dob:            existing.dob,
          enrollmentDate: existing.enrollmentDate,
          guardianName:   existing.guardianName,
          bloodGroup:     existing.bloodGroup,
          photoUrl:       existing.photoUrl,
          approvedAt:     new Date().toISOString(),
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

  async getTeacherApprovalHistory(
    teacherId: number,
    schoolId: number,
    sessionId?: number | null,
  ): Promise<(StudentProfile & { studentName: string; dsid: string; class: string; section: string })[]> {
    // When sessionId provided, restrict to the session's date window
    let startDate: Date | null = null;
    let endDate: Date | null = null;
    if (sessionId) {
      const [sess] = await db.select().from(academicSessions).where(eq(academicSessions.id, sessionId));
      if (sess) {
        startDate = new Date(sess.startDate + "T00:00:00");
        endDate   = new Date(sess.endDate   + "T23:59:59");
      }
    }

    const conditions = [
      eq(studentProfiles.schoolId, schoolId),
      eq(studentProfiles.verifiedBy, teacherId),
      eq(studentProfiles.status, "approved"),
    ] as SQL[];
    if (startDate && endDate) {
      conditions.push(gte(studentProfiles.verifiedAt, startDate) as SQL);
      conditions.push(lte(studentProfiles.verifiedAt, endDate) as SQL);
    }

    const approved = await db
      .select()
      .from(studentProfiles)
      .where(and(...conditions))
      .orderBy(desc(studentProfiles.verifiedAt));

    const result = [];
    for (const p of approved) {
      const student = await this.getStudentById(p.studentId);
      if (!student) continue;
      result.push({
        ...p,
        studentName: student.name,
        dsid: student.digitalStudentId,
        class: student.class,
        section: student.section,
      });
    }
    return result;
  }

  async updateStudentPassword(studentId: number, passwordHash: string): Promise<void> {
    await db.update(students).set({ passwordHash }).where(eq(students.id, studentId));
  }

  async getPendingProfilesCountForTeacher(schoolId: number, cls: string, section: string): Promise<number> {
    const profiles = await this.getPendingProfilesForTeacher(schoolId, cls, section);
    return profiles.length;
  }

  // ===== STUDENT ATTENDANCE (Student-Facing) =====

  async getStudentMonthlyAttendance(studentId: number, schoolId: number, sessionId: number, year: number, month: number): Promise<{
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
    isInSession: boolean;
  }[]> {
    const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    const today = todayInIST();
    const session = await this.getAcademicSessionById(sessionId);
    if (!session || session.schoolId !== schoolId) {
      throw new Error("Invalid Academic Session for Student monthly Attendance");
    }
    const studentClassSection = await this.resolveAttendanceClassSectionForStudent(schoolId, sessionId, studentId);
    const holidayAudience = studentClassSection
      ? buildCalendarAudienceFilter([{ cls: studentClassSection.class, sec: studentClassSection.section }])!
      : eq(calendarEvents.audienceScope, "All_School");

    const records = await db.select().from(attendanceRecords).where(
      and(
        eq(attendanceRecords.schoolId, schoolId),
        eq(attendanceRecords.sessionId, sessionId),
        eq(attendanceRecords.studentId, studentId),
        gte(attendanceRecords.date, startDate),
        lte(attendanceRecords.date, endDate)
      )
    );

    const holidays = await db.select().from(calendarEvents).where(
      and(
        eq(calendarEvents.schoolId, schoolId),
        eq(calendarEvents.eventType, "holiday"),
        holidayAudience,
        gte(calendarEvents.date, startDate),
        lte(calendarEvents.date, endDate)
      )
    );

    const leaves = await db.select().from(studentLeaveRequests).where(
      and(
        eq(studentLeaveRequests.schoolId, schoolId),
        eq(studentLeaveRequests.sessionId, sessionId),
        eq(studentLeaveRequests.studentId, studentId),
        eq(studentLeaveRequests.status, "approved"),
        lte(studentLeaveRequests.startDate, endDate),
        gte(studentLeaveRequests.endDate, startDate)
      )
    );

    const result = [];
    for (let day = 1; day <= lastDay; day++) {
      const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const isInSession = isAttendanceDateInSession(dateStr, session);
      const dayOfWeek = calendarWeekday(dateStr)!;
      const isSunday = dayOfWeek === 0;
      const isFuture = dateStr > today;

      const record = isInSession ? records.find(r => r.date === dateStr) : undefined;
      const holiday = isInSession ? holidays.find(h => h.date === dateStr) : undefined;
      const isApprovedLeave = isInSession && leaves.some(l => l.startDate <= dateStr && l.endDate >= dateStr);

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
        isInSession,
      });
    }

    return result;
  }

  async getStudentYearlyAttendance(studentId: number, schoolId: number, sessionId: number, cls: string | null, section: string | null, startDate: string, endDate: string): Promise<{
    month: number;
    year: number;
    present: number;
    absent: number;
    halfDay: number;
    late: number;
    leave: number;
    workingDays: number;
    total: number;
  }[]> {
    const myRecordConditions = [
      eq(attendanceRecords.schoolId, schoolId),
      eq(attendanceRecords.sessionId, sessionId),
      eq(attendanceRecords.studentId, studentId),
      gte(attendanceRecords.date, startDate),
      lte(attendanceRecords.date, endDate),
    ];
    if (cls && section) {
      myRecordConditions.push(
        eq(attendanceRecords.class, cls),
        eq(attendanceRecords.section, section),
      );
    }
    const myRecords = await db.select().from(attendanceRecords).where(
      and(...myRecordConditions),
    );

    // Applicable dates require selected-Session historical class/section context.
    // Raw legacy rows remain readable, but cannot define a class-specific denominator.
    const workingDates = cls && section
      ? await getStudentAttendanceWorkingDates({
          schoolId, sessionId, class: cls, section, startDate, endDate,
        })
      : [];
    const recordMap = new Map(myRecords.map(r => [r.date, r]));

    const monthMap = new Map<string, { month: number; year: number; present: number; absent: number; halfDay: number; late: number; leave: number; workingDays: number; total: number }>();

    for (const dateStr of workingDates) {
      const parts = dateOnlyParts(dateStr);
      if (!parts) continue;
      const { year, month } = parts;
      const key = `${year}-${month}`;
      if (!monthMap.has(key)) {
        monthMap.set(key, { month, year, present: 0, absent: 0, halfDay: 0, late: 0, leave: 0, workingDays: 0, total: 0 });
      }
      const bucket = monthMap.get(key)!;
      bucket.workingDays++;
      bucket.total++;
      const aggregation = aggregateStudentAttendance({
        schoolId,
        sessionId,
        statuses: [recordMap.get(dateStr)?.status ?? null],
      });
      bucket.present += aggregation.present;
      bucket.absent += aggregation.absent;
      bucket.halfDay += aggregation.halfDay;
      bucket.late += aggregation.late;
      bucket.leave += aggregation.leave;
    }

    return Array.from(monthMap.values()).sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);
  }

  async getStudentAttendanceStats(studentId: number, schoolId: number, sessionId: number, cls: string | null, section: string | null, academicStartDate: string, academicEndDate?: string): Promise<{
    overallPercent: number;
    workingDays: number;
    daysPresent: number;
    totalPresent: number;
    totalAbsent: number;
    totalHalfDay: number;
    totalLate: number;
    totalLeave: number;
  }> {
    const today = todayInIST();
    const upperBound = academicEndDate && academicEndDate < today ? academicEndDate : today;

    const myRecordConditions = [
      eq(attendanceRecords.schoolId, schoolId),
      eq(attendanceRecords.sessionId, sessionId),
      eq(attendanceRecords.studentId, studentId),
      gte(attendanceRecords.date, academicStartDate),
      lte(attendanceRecords.date, upperBound),
    ];
    if (cls && section) {
      myRecordConditions.push(
        eq(attendanceRecords.class, cls),
        eq(attendanceRecords.section, section),
      );
    }
    const myRecords = await db.select().from(attendanceRecords).where(
      and(...myRecordConditions),
    );

    // Applicable dates require selected-Session historical class/section context.
    // Raw legacy rows remain readable, but cannot define a class-specific denominator.
    const workingDates = cls && section
      ? await getStudentAttendanceWorkingDates({
          schoolId,
          sessionId,
          class: cls,
          section,
          startDate: academicStartDate,
          endDate: upperBound,
        })
      : [];
    const recordByDate = new Map(myRecords.map(record => [record.date, record]));
    const aggregation = aggregateStudentAttendance({
      schoolId,
      sessionId,
      statuses: workingDates.map(date => recordByDate.get(date)?.status ?? null),
    });

    return {
      overallPercent: aggregation.percentage,
      workingDays: aggregation.applicableWorkingDays,
      daysPresent: aggregation.weightedAttendance,
      totalPresent: aggregation.present,
      totalAbsent: aggregation.absent,
      totalHalfDay: aggregation.halfDay,
      totalLate: aggregation.late,
      totalLeave: aggregation.leave,
    };
  }

  async getStudentAttendanceAggregatesForSessionClass(
    schoolId: number,
    sessionId: number,
    cls: string,
    section: string,
    startDate: string,
    endDate: string,
  ): Promise<Array<{ student: Student; aggregation: StudentAttendanceAggregation }>> {
    const roster = await this.getAttendanceReportRosterForSessionClass(
      schoolId, sessionId, cls, section,
    );
    const [records, workingDates] = await Promise.all([
      this.getAttendanceHistory(
        schoolId, sessionId, cls, section, startDate, endDate,
      ),
      getStudentAttendanceWorkingDates({
        schoolId, sessionId, class: cls, section, startDate, endDate,
      }),
    ]);
    const recordByStudentDate = new Map(
      records.map(record => [`${record.identityKey}:${record.date}`, record]),
    );
    return roster.map(student => ({
      student: student as unknown as Student,
      aggregation: aggregateStudentAttendance({
        schoolId,
        sessionId,
        statuses: workingDates.map(date =>
          recordByStudentDate.get(`${(student as any).identityKey}:${date}`)?.status ?? null
        ),
      }),
    }));
  }

  // ===== ACADEMIC ADVANCEMENT WIZARD =====

  async getExamAggregated(schoolId: number, cls: string, section: string, examType: string, sessionId?: number): Promise<{
    studentId: number; dsid: string; name: string;
    totalObtained: number; totalMax: number; percentage: number; subjects: string[];
  }[]> {
    // When a sessionId is provided, only aggregate scores from that academic year.
    const rows = await db.select().from(examScores)
      .innerJoin(students, and(eq(examScores.studentId, students.id), eq(students.schoolId, schoolId)))
      .where(and(
        eq(examScores.schoolId, schoolId),
        eq(examScores.class, cls),
        eq(examScores.section, section),
        eq(examScores.examType, examType),
        ...(sessionId != null ? [eq(examScores.sessionId, sessionId)] : []),
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

  async bulkUpsertPromotionOverrides(items: Array<{
    schoolId: number; studentId: number; examType: string; class: string; section: string;
    overrideStatus: string; nextClass: string; nextSection: string;
  }>): Promise<void> {
    for (const item of items) {
      await this.upsertPromotionOverride(item);
    }
  }

  async deleteAllPromotionOverrides(data: {
    schoolId: number; class: string; section: string; examType: string;
  }): Promise<void> {
    await db.delete(promotionOverrides).where(and(
      eq(promotionOverrides.schoolId, data.schoolId),
      eq(promotionOverrides.class, data.class),
      eq(promotionOverrides.section, data.section),
      eq(promotionOverrides.examType, data.examType),
    ));
  }

  async deletePromotionOverride(data: {
    schoolId: number; studentId: number; examType: string; class: string; section: string;
  }): Promise<void> {
    await db.delete(promotionOverrides).where(and(
      eq(promotionOverrides.schoolId, data.schoolId),
      eq(promotionOverrides.studentId, data.studentId),
      eq(promotionOverrides.examType, data.examType),
      eq(promotionOverrides.class, data.class),
      eq(promotionOverrides.section, data.section),
    ));
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

  /**
   * Resolves the examination pass policy from the authenticated tenant's
   * class-scoped grading tier. Callers must treat an absent result as a
   * configuration error; there is deliberately no universal fallback.
   */
  async resolveClassPassPolicy(schoolId: number, studentClass: string): Promise<GradingTier | undefined> {
    const normalizedClass = String(studentClass).trim();
    const tiers = await this.getGradingTiers(schoolId);
    return tiers.find(tier =>
      (tier.classes || []).map(value => String(value).trim()).includes(normalizedClass)
    );
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
    const rows = await db.select().from(gradingRules)
      .where(conditions)
      .orderBy(gradingRules.tierId, gradingRules.sortOrder);
    return rows.map(normalizeStoredGradingRule);
  }

  async replaceGradingRules(tierId: number, schoolId: number, rules: GradingRuleWrite[]): Promise<GradingRule[]> {
    await db.delete(gradingRules)
      .where(and(eq(gradingRules.tierId, tierId), eq(gradingRules.schoolId, schoolId)));
    if (rules.length === 0) return [];
    const inserted = await db.insert(gradingRules)
      .values(rules.map((r, i) => ({
        ...r,
        minPercent: percentageToDatabaseValue(r.minPercent),
        maxPercent: percentageToDatabaseValue(r.maxPercent),
        tierId,
        schoolId,
        sortOrder: i,
      })))
      .returning();
    return inserted.map(normalizeStoredGradingRule);
  }

  // ===== ACADEMIC HISTORY =====

  async archiveStudentHistory(records: InsertAcademicHistory[]): Promise<void> {
    if (records.length === 0) return;
    await db.insert(academicHistory).values(records);
  }

  /**
   * Atomic promotion transaction — wraps all three critical writes in a single
   * DB transaction. If any step fails the entire operation rolls back automatically:
   *  1. Insert academic history snapshot records
   *  2. Update each student's class/section + flag id_card_pending_reissue = true
   *  3. Mark the promotion ledger as admin-executed
   */
  async executePromotionTransaction(
    schoolId: number,
    items: Array<{ studentId: number; nextClass: string; nextSection: string; fromClass: string; fromSection: string }>,
    historyRecords: InsertAcademicHistory[],
    term?: string,
  ): Promise<number> {
    let promoted = 0;
    const now = new Date();
    await db.transaction(async (tx) => {
      if (historyRecords.length > 0) {
        await tx.insert(academicHistory).values(historyRecords);
      }
      for (const item of items) {
        const updated = await tx.update(students)
          .set({ class: item.nextClass, section: item.nextSection, idCardPendingReissue: true })
          .where(and(eq(students.id, item.studentId), eq(students.schoolId, schoolId)))
          .returning();
        if (updated.length > 0) promoted++;
      }
      if (term && items.length > 0) {
        const { fromClass, fromSection } = items[0];
        await tx.update(promotionDecisions)
          .set({ adminExecuted: true, adminExecutedAt: now })
          .where(and(
            eq(promotionDecisions.schoolId, schoolId),
            eq(promotionDecisions.class, fromClass),
            eq(promotionDecisions.section, fromSection),
            eq(promotionDecisions.term, term),
          ));
      }
    });
    return promoted;
  }

  async clearIdCardReissueFlag(schoolId: number, studentIds: number[]): Promise<void> {
    if (studentIds.length === 0) return;
    await db.update(students)
      .set({ idCardPendingReissue: false })
      .where(and(eq(students.schoolId, schoolId), inArray(students.id, studentIds)));
  }

  async getExamScoresForStudents(
    schoolId: number, studentIds: number[],
  ): Promise<Array<{ studentId: number; subject: string; examType: string; marks: number; totalMarks: number; isAbsent: boolean }>> {
    if (studentIds.length === 0) return [];
    return db
      .select({
        studentId: examScores.studentId,
        subject:   examScores.subject,
        examType:  examScores.examType,
        marks:     examScores.marks,
        totalMarks: examScores.totalMarks,
        isAbsent:  examScores.isAbsent,
      })
      .from(examScores)
      .where(and(eq(examScores.schoolId, schoolId), inArray(examScores.studentId, studentIds)));
  }

  async getAcademicHistory(schoolId: number, studentId?: number, sessionId?: number | null): Promise<typeof academicHistory.$inferSelect[]> {
    const conditions: any[] = [eq(academicHistory.schoolId, schoolId)];
    if (studentId) conditions.push(eq(academicHistory.studentId, studentId));
    if (sessionId != null) conditions.push(eq(academicHistory.sessionId, sessionId));
    return await db.select().from(academicHistory)
      .where(and(...conditions))
      .orderBy(desc(academicHistory.archivedAt));
  }

  // ===== ASSET LIFECYCLE MANAGER =====

  async getAssets(schoolId: number, filters?: { condition?: string; location?: string; search?: string }): Promise<SchoolAsset[]> {
    const conditions: SQL<unknown>[] = [eq(schoolAssets.schoolId, schoolId)];
    if (filters?.condition) conditions.push(eq(schoolAssets.condition, filters.condition));
    if (filters?.location) conditions.push(eq(schoolAssets.location, filters.location));
    if (filters?.search) conditions.push(or(ilike(schoolAssets.name, `%${filters.search}%`), ilike(schoolAssets.category, `%${filters.search}%`))!);
    return await db.select().from(schoolAssets)
      .where(and(...conditions))
      .orderBy(desc(schoolAssets.createdAt));
  }

  async createAsset(data: InsertSchoolAsset & { purchasedDate?: string | null; warrantyExpiry?: string | null }): Promise<SchoolAsset> {
    const [asset] = await db.insert(schoolAssets).values({
      schoolId: data.schoolId,
      name: data.name,
      category: data.category,
      quantity: data.quantity ?? 0,
      condition: data.condition ?? "Good",
      location: data.location ?? "",
      assetCode: data.assetCode ?? "",
      purchasedDate: data.purchasedDate ?? null,
      warrantyExpiry: data.warrantyExpiry ?? null,
    }).returning();
    if (!data.assetCode) {
      const code = `AST-${String(asset.id).padStart(4, "0")}`;
      const [updated] = await db.update(schoolAssets).set({ assetCode: code }).where(eq(schoolAssets.id, asset.id)).returning();
      return updated;
    }
    return asset;
  }

  async updateAsset(id: number, schoolId: number, data: { quantity?: number; condition?: string; location?: string; purchasedDate?: string | null; warrantyExpiry?: string | null }): Promise<SchoolAsset | null> {
    const setFields: Record<string, unknown> = { updatedAt: new Date() };
    if (data.quantity !== undefined)       setFields.quantity       = data.quantity;
    if (data.condition !== undefined)      setFields.condition      = data.condition;
    if (data.location  !== undefined)      setFields.location       = data.location;
    if ("purchasedDate" in data)           setFields.purchasedDate  = data.purchasedDate ?? null;
    if ("warrantyExpiry" in data)          setFields.warrantyExpiry = data.warrantyExpiry ?? null;
    const [updated] = await db.update(schoolAssets)
      .set(setFields as any)
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

  // ===== ANALYTICS DATA HELPERS =====

  async getDistinctSectionsByClass(schoolId: number, cls: string): Promise<string[]> {
    const rows = await db.selectDistinct({ section: examScores.section })
      .from(examScores)
      .where(and(
        eq(examScores.schoolId, schoolId),
        eq(examScores.class, cls),
      ));
    return rows.map(r => r.section).filter(Boolean).sort() as string[];
  }

  async getDistinctExamTypesByClass(schoolId: number, cls: string, section?: string): Promise<string[]> {
    const conditions: SQL<unknown>[] = [
      eq(examScores.schoolId, schoolId),
      eq(examScores.class, cls),
    ];
    if (section) conditions.push(eq(examScores.section, section));
    const rows = await db.selectDistinct({ examType: examScores.examType })
      .from(examScores)
      .where(and(...conditions));
    return rows.map(r => r.examType).filter(Boolean).sort() as string[];
  }

  async getAnalyticsData(
    schoolId: number,
    cls: string,
    opts: { section?: string; examType?: string; subject?: string; search?: string; sessionId?: number }
  ): Promise<{
    students: Array<{
      studentId: number; dsid: string; name: string;
      subjectScores: Record<string, { marks: number; totalMarks: number; isAbsent: boolean }>;
      totalObtained: number; totalMax: number; percentage: number;
      gradeLabel: string | null; gradePoint: string | null; gradeRemarks: string | null;
      tierPassThreshold: number; passStatus: "PASS" | "FAIL" | "GRACE_PASS";
      overrideStatus: string | null;
    }>;
    subjectAverages: Array<{ subject: string; average: number }>;
    subjectList: string[];
    passThreshold: number;
  }> {
    const passPolicy = await this.resolveClassPassPolicy(schoolId, cls);
    if (!passPolicy) throw new Error(`No grading tier configured for class ${cls}.`);
    // Admin analytics shows ALL scores regardless of published status —
    // the published flag gates student-facing views only, not principal oversight.
    const conditions: SQL<unknown>[] = [
      eq(examScores.schoolId, schoolId),
      eq(examScores.class, cls),
    ];
    if (opts.section) conditions.push(eq(examScores.section, opts.section));
    if (opts.examType) conditions.push(eq(examScores.examType, opts.examType));
    if (opts.sessionId != null) conditions.push(eq(examScores.sessionId, opts.sessionId));

    const rows = await db.select().from(examScores)
      .innerJoin(students, and(eq(examScores.studentId, students.id), eq(students.schoolId, schoolId)))
      .where(and(...conditions));

    const byStudent: Record<number, {
      dsid: string; name: string;
      subjectScores: Record<string, { marks: number; totalMarks: number; isAbsent: boolean }>;
      obtained: number; total: number;
    }> = {};

    for (const r of rows) {
      const sid = r.exam_scores.studentId;
      if (!byStudent[sid]) {
        byStudent[sid] = { dsid: r.students.digitalStudentId, name: r.students.name, subjectScores: {}, obtained: 0, total: 0 };
      }
      const subj = r.exam_scores.subject;
      if (!(subj in byStudent[sid].subjectScores)) {
        byStudent[sid].subjectScores[subj] = { marks: 0, totalMarks: 0, isAbsent: false };
      }
      if (!r.exam_scores.isAbsent) {
        byStudent[sid].subjectScores[subj].marks += r.exam_scores.marks;
        byStudent[sid].obtained += r.exam_scores.marks;
      }
      byStudent[sid].subjectScores[subj].totalMarks += r.exam_scores.totalMarks;
      byStudent[sid].total += r.exam_scores.totalMarks;
    }

    let overrideMap: Record<number, string> = {};
    if (opts.section && opts.examType) {
      const overrides = await this.getPromotionOverrides(schoolId, cls, opts.section, opts.examType);
      for (const o of overrides) overrideMap[o.studentId] = o.overrideStatus;
    }

    let studentList = await Promise.all(Object.entries(byStudent).map(async ([id, d]) => {
      const studentId = parseInt(id);
      const percentage = d.total > 0 ? parseFloat(((d.obtained / d.total) * 100).toFixed(2)) : 0;
      const grade = await this.resolveGrade(schoolId, cls, percentage);
      const overrideStatus = overrideMap[studentId] || null;
      let passStatus: "PASS" | "FAIL" | "GRACE_PASS";
      if (overrideStatus === "GRACE_PASS") passStatus = "GRACE_PASS";
      else if (overrideStatus === "PASS") passStatus = "PASS";
      else if (overrideStatus === "FAIL" || overrideStatus === "REPEAT") passStatus = "FAIL";
      else if (percentage >= grade.passPercentage) passStatus = "PASS";
      else if (percentage >= grade.passPercentage - 5) passStatus = "GRACE_PASS";
      else passStatus = "FAIL";
      return {
        studentId, dsid: d.dsid, name: d.name, subjectScores: d.subjectScores,
        totalObtained: d.obtained, totalMax: d.total, percentage,
        gradeLabel: grade.gradeLabel, gradePoint: grade.gradePoint, gradeRemarks: grade.remarks,
        tierPassThreshold: grade.passPercentage, passStatus, overrideStatus,
      };
    }));

    if (opts.subject) studentList = studentList.filter(s => opts.subject! in s.subjectScores);
    if (opts.search) {
      const q = opts.search.toLowerCase();
      studentList = studentList.filter(s => s.name.toLowerCase().includes(q) || s.dsid.toLowerCase().includes(q));
    }
    studentList.sort((a, b) => a.dsid.localeCompare(b.dsid));

    const subjectSums: Record<string, { sum: number; cnt: number }> = {};
    for (const s of studentList) {
      for (const [subj, score] of Object.entries(s.subjectScores)) {
        if (!score.isAbsent && score.totalMarks > 0) {
          if (!subjectSums[subj]) subjectSums[subj] = { sum: 0, cnt: 0 };
          subjectSums[subj].sum += (score.marks / score.totalMarks) * 100;
          subjectSums[subj].cnt++;
        }
      }
    }
    const subjectAverages = Object.entries(subjectSums)
      .map(([subject, { sum, cnt }]) => ({ subject, average: parseFloat((sum / cnt).toFixed(1)) }))
      .sort((a, b) => b.average - a.average);

    const subjectSet = new Set<string>();
    for (const d of Object.values(byStudent)) for (const s of Object.keys(d.subjectScores)) subjectSet.add(s);
    const subjectList = Array.from(subjectSet);
    const passThreshold = passPolicy.passPercentage;

    return { students: studentList, subjectAverages, subjectList, passThreshold };
  }

  async getStudentJourneyData(studentId: number, schoolId: number): Promise<{
    examTypes: string[];
    subjectRows: { subject: string; scores: (number | null)[] }[];
    totals: number[];
  }> {
    const scores = await db.select().from(examScores)
      .where(and(
        eq(examScores.studentId, studentId),
        eq(examScores.schoolId, schoolId),
      ))
      .orderBy(examScores.id);

    const examTypeOrder: string[] = [];
    const byExamType: Record<string, Record<string, { marks: number; totalMarks: number }>> = {};

    for (const score of scores) {
      if (!examTypeOrder.includes(score.examType)) examTypeOrder.push(score.examType);
      if (!byExamType[score.examType]) byExamType[score.examType] = {};
      if (!score.isAbsent) {
        byExamType[score.examType][score.subject] = { marks: score.marks, totalMarks: score.totalMarks };
      }
    }

    const subjectSet = new Set<string>();
    for (const examSubjects of Object.values(byExamType)) for (const s of Object.keys(examSubjects)) subjectSet.add(s);
    const subjectList = Array.from(subjectSet);

    const subjectRows = subjectList.map(subject => ({
      subject,
      scores: examTypeOrder.map(et => {
        const s = byExamType[et]?.[subject];
        return s ? Math.round((s.marks / s.totalMarks) * 100) : null;
      }),
    }));

    const totals = examTypeOrder.map(et => {
      const subjects = byExamType[et];
      if (!subjects || Object.keys(subjects).length === 0) return 0;
      let obtained = 0, total = 0;
      for (const { marks, totalMarks } of Object.values(subjects)) { obtained += marks; total += totalMarks; }
      return total > 0 ? parseFloat(((obtained / total) * 100).toFixed(1)) : 0;
    });

    return { examTypes: examTypeOrder, subjectRows, totals };
  }

  // ===== TIER-AWARE GRADING HELPER =====

  async resolveGrade(schoolId: number, studentClass: string, percentage: number): Promise<{
    passPercentage: number; gradeLabel: string | null; gradePoint: string | null; remarks: string | null;
  }> {
    const tiers = await this.getGradingTiers(schoolId);
    const allRules = await this.getGradingRules(schoolId);
    const matchedTier = tiers.find(t => Array.isArray(t.classes) && t.classes.includes(studentClass));
    if (!matchedTier) throw new Error(`No grading tier configured for class ${studentClass}.`);
    const tierRules = allRules.filter(r => r.tierId === matchedTier.id);
    const matchedGrade = selectGrade(percentage, tierRules);
    const matchedRule = tierRules.find(r =>
      r.gradeLabel === matchedGrade.label && r.remarks === matchedGrade.remarks &&
      percentage >= r.minPercent && percentage <= r.maxPercent
    );
    return {
      passPercentage: matchedTier.passPercentage,
      gradeLabel: matchedGrade.label,
      gradePoint: matchedRule?.gradePoint ?? null,
      remarks: matchedGrade.remarks,
    };
  }

  async logVerificationRequest(schoolId: number, studentId: number): Promise<void> {
    await db.insert(verificationLogs).values({ schoolId, studentId });
  }

  async countMonthlyVerifications(schoolId: number, studentId: number): Promise<number> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    const rows = await db
      .select({ id: verificationLogs.id })
      .from(verificationLogs)
      .where(
        and(
          eq(verificationLogs.schoolId, schoolId),
          eq(verificationLogs.studentId, studentId),
          gte(verificationLogs.submittedAt, startOfMonth),
          lte(verificationLogs.submittedAt, endOfMonth),
        ),
      );
    return rows.length;
  }

  // ===== TIMETABLE STRUCTURE METHODS =====
  async getTimetableStructure(schoolId: number, sessionId: number, cls: string): Promise<TimetableStructure[]> {
    await this.requireTimetableSession(schoolId, sessionId);
    return await db
      .select()
      .from(timetableStructure)
      .where(and(eq(timetableStructure.schoolId, schoolId), eq(timetableStructure.sessionId, sessionId), eq(timetableStructure.class, cls)))
      .orderBy(timetableStructure.sortOrder, timetableStructure.periodNumber);
  }

  async saveTimetableStructure(schoolId: number, sessionId: number, cls: string, rows: Omit<InsertTimetableStructure, "schoolId" | "sessionId" | "class">[]): Promise<TimetableStructure[]> {
    await this.requireTimetableSession(schoolId, sessionId, true);
    const toInsert = rows.map((r, idx) => ({
      ...r,
      schoolId,
      sessionId,
      class: cls,
      sortOrder: r.sortOrder ?? idx,
    }));
    return await db.transaction(async (tx) => {
      await tx.delete(timetableStructure).where(
        and(eq(timetableStructure.schoolId, schoolId), eq(timetableStructure.sessionId, sessionId), eq(timetableStructure.class, cls))
      );
      if (toInsert.length === 0) return [];
      return await tx.insert(timetableStructure).values(toInsert).returning();
    });
  }

  async deleteTimetableStructureById(id: number, schoolId: number, sessionId: number): Promise<boolean> {
    await this.requireTimetableSession(schoolId, sessionId, true);
    const result = await db.delete(timetableStructure)
      .where(and(eq(timetableStructure.id, id), eq(timetableStructure.schoolId, schoolId), eq(timetableStructure.sessionId, sessionId)))
      .returning();
    return result.length > 0;
  }

  // ===== ADMIN AUTH & PROFILE =====
  async getUserById(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async initializeAdmin(userId: number, pinHash: string, recoveryEmail: string | null, recoveryPhone: string | null): Promise<void> {
    await db.update(users).set({
      pinHash,
      recoveryEmail,
      recoveryPhone,
      isInitialized: true,
      otpCode: null,
      otpExpiresAt: null,
    }).where(eq(users.id, userId));
  }

  async verifyAdminPin(userId: number, pin: string): Promise<boolean> {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user || !user.pinHash) return false;
    const bcryptLib = await import("bcryptjs");
    return bcryptLib.compare(pin, user.pinHash);
  }

  async updateAdminPin(userId: number, pinHash: string): Promise<void> {
    await db.update(users).set({ pinHash }).where(eq(users.id, userId));
  }

  async updateAdminPassword(userId: number, passwordHash: string): Promise<void> {
    await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
  }

  async updateAdminProfile(userId: number, data: { recoveryEmail?: string | null; recoveryPhone?: string | null }): Promise<void> {
    await db.update(users).set(data).where(eq(users.id, userId));
  }

  // Signature is stored scoped to the user. schoolId is passed so the caller
  // can enforce tenant isolation before updating — never trust a client-supplied ID.
  async updateAdminSignature(userId: number, schoolId: number, signatureUrl: string): Promise<void> {
    await db.update(users)
      .set({ signatureUrl })
      .where(and(eq(users.id, userId), eq(users.schoolId, schoolId)));
  }

  async clearAdminSignature(userId: number, schoolId: number): Promise<void> {
    await db.update(users)
      .set({ signatureUrl: null })
      .where(and(eq(users.id, userId), eq(users.schoolId, schoolId)));
  }

  async logSecurityEvent(userId: number | null, schoolId: number | null, action: string, success: boolean, ipAddress: string | null, userAgent: string | null): Promise<void> {
    await db.insert(securityAudit).values({ userId: userId ?? undefined, schoolId: schoolId ?? undefined, action, success, ipAddress, userAgent });
  }

  async getSecurityAuditLog(userId: number, limit = 20): Promise<import("@shared/schema").SecurityAudit[]> {
    return await db.select().from(securityAudit)
      .where(eq(securityAudit.userId, userId))
      .orderBy(desc(securityAudit.createdAt))
      .limit(limit);
  }

  // ===== NON-TEACHING STAFF =====
  async getNonTeachingStaffBySchool(schoolId: number): Promise<NonTeachingStaff[]> {
    return await db.select().from(nonTeachingStaff)
      .where(and(eq(nonTeachingStaff.schoolId, schoolId), eq(nonTeachingStaff.isActive, true)))
      .orderBy(nonTeachingStaff.fullName);
  }

  async createNonTeachingStaff(data: InsertNonTeachingStaff): Promise<NonTeachingStaff> {
    const [record] = await db.insert(nonTeachingStaff).values(data).returning();
    return record;
  }

  async updateNonTeachingStaff(id: number, schoolId: number, data: Partial<InsertNonTeachingStaff>): Promise<NonTeachingStaff | undefined> {
    const [record] = await db.update(nonTeachingStaff)
      .set(data)
      .where(and(eq(nonTeachingStaff.id, id), eq(nonTeachingStaff.schoolId, schoolId)))
      .returning();
    return record;
  }

  async deleteNonTeachingStaff(id: number, schoolId: number): Promise<boolean> {
    const result = await db.update(nonTeachingStaff)
      .set({ isActive: false })
      .where(and(eq(nonTeachingStaff.id, id), eq(nonTeachingStaff.schoolId, schoolId)))
      .returning();
    return result.length > 0;
  }

  async getNonTeachingStaffById(id: number): Promise<NonTeachingStaff | undefined> {
    const [record] = await db.select().from(nonTeachingStaff).where(eq(nonTeachingStaff.id, id));
    return record;
  }

  async getNonTeachingStaffByEmail(email: string): Promise<NonTeachingStaff | undefined> {
    const [record] = await db.select().from(nonTeachingStaff)
      .where(and(eq(nonTeachingStaff.email, email), eq(nonTeachingStaff.isActive, true)));
    return record;
  }

  // ===== FACULTY MAPPINGS =====
  async getFacultyMappingsBySchool(schoolId: number): Promise<(FacultyMapping & { teacherName: string; email: string })[]> {
    const rows = await db.select({
      id: facultyMappings.id,
      teacherId: facultyMappings.teacherId,
      schoolId: facultyMappings.schoolId,
      className: facultyMappings.className,
      section: facultyMappings.section,
      subject: facultyMappings.subject,
      teacherName: teachers.fullName,
      email: users.email,
    }).from(facultyMappings)
      .innerJoin(teachers, eq(facultyMappings.teacherId, teachers.id))
      .innerJoin(users, eq(teachers.userId, users.id))
      .where(eq(facultyMappings.schoolId, schoolId))
      .orderBy(teachers.fullName, facultyMappings.className, facultyMappings.section);
    return rows;
  }

  async replaceFacultyMappings(teacherId: number, schoolId: number, mappings: { className: string; section: string; subject?: string | null }[]): Promise<FacultyMapping[]> {
    return await db.transaction(async (tx) => {
      await tx.delete(facultyMappings).where(
        and(eq(facultyMappings.teacherId, teacherId), eq(facultyMappings.schoolId, schoolId))
      );
      if (mappings.length === 0) return [];
      const rows = await tx.insert(facultyMappings).values(
        mappings.map(m => ({ teacherId, schoolId, className: m.className, section: m.section, subject: m.subject ?? null }))
      ).returning();
      return rows;
    });
  }

  async deleteFacultyMappingsByTeacher(teacherId: number, schoolId: number): Promise<void> {
    await db.delete(facultyMappings).where(
      and(eq(facultyMappings.teacherId, teacherId), eq(facultyMappings.schoolId, schoolId))
    );
  }

  async getFacultyMappingsByTeacher(teacherId: number): Promise<{ className: string; section: string; subject: string | null }[]> {
    return db.select({
      className: facultyMappings.className,
      section: facultyMappings.section,
      subject: facultyMappings.subject,
    }).from(facultyMappings)
      .where(eq(facultyMappings.teacherId, teacherId))
      .orderBy(facultyMappings.className, facultyMappings.section);
  }

  async getTeachersBySchoolPaginated(schoolId: number, q: string, page: number, pageSize: number, filterClass?: string, filterSection?: string): Promise<{ data: (Teacher & { email: string; mappings: { className: string; section: string; subject: string | null }[] })[]; total: number }> {
    const baseWhere = eq(teachers.schoolId, schoolId);
    const searchCondition = q
      ? and(baseWhere, or(
          ilike(teachers.fullName, `%${q}%`),
          ilike(users.email, `%${q}%`),
        ))
      : baseWhere;

    // Build class/section filter: match primary assignment OR any facultyMapping row
    let classFilterCondition: SQL | undefined;
    if (filterClass || filterSection) {
      const mappingConds: SQL[] = [eq(facultyMappings.schoolId, schoolId)];
      if (filterClass) mappingConds.push(eq(facultyMappings.className, filterClass));
      if (filterSection) mappingConds.push(eq(facultyMappings.section, filterSection));

      const mappedRows = await db.select({ teacherId: facultyMappings.teacherId })
        .from(facultyMappings)
        .where(and(...mappingConds));
      const mappedTeacherIds = mappedRows.map(r => r.teacherId);

      const primaryConds: SQL[] = [];
      if (filterClass) primaryConds.push(eq(teachers.assignedClass, filterClass));
      if (filterSection) primaryConds.push(eq(teachers.assignedSection, filterSection));
      const primaryMatch = primaryConds.length > 0 ? and(...primaryConds) : undefined;

      if (mappedTeacherIds.length > 0 && primaryMatch) {
        classFilterCondition = or(primaryMatch, inArray(teachers.id, mappedTeacherIds));
      } else if (mappedTeacherIds.length > 0) {
        classFilterCondition = inArray(teachers.id, mappedTeacherIds);
      } else if (primaryMatch) {
        classFilterCondition = primaryMatch;
      } else {
        classFilterCondition = sql`FALSE`;
      }
    }

    const finalWhere = classFilterCondition
      ? and(searchCondition ?? baseWhere, classFilterCondition)
      : (searchCondition ?? baseWhere);

    const [{ total }] = await db.select({ total: count() }).from(teachers)
      .innerJoin(users, eq(teachers.userId, users.id))
      .where(finalWhere);

    const data = await db.select().from(teachers)
      .innerJoin(users, eq(teachers.userId, users.id))
      .where(finalWhere)
      .orderBy(teachers.fullName)
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const teacherIds = data.map(r => r.teachers.id);
    let mappingsByTeacher: Record<number, { className: string; section: string; subject: string | null }[]> = {};

    if (teacherIds.length > 0) {
      const allMappings = await db.select({
        teacherId: facultyMappings.teacherId,
        className: facultyMappings.className,
        section: facultyMappings.section,
        subject: facultyMappings.subject,
      }).from(facultyMappings)
        .where(and(
          eq(facultyMappings.schoolId, schoolId),
          inArray(facultyMappings.teacherId, teacherIds),
        ));

      for (const m of allMappings) {
        if (!mappingsByTeacher[m.teacherId]) mappingsByTeacher[m.teacherId] = [];
        mappingsByTeacher[m.teacherId].push({ className: m.className, section: m.section, subject: m.subject });
      }
    }

    return {
      total,
      data: data.map(r => ({
        ...r.teachers,
        email: r.users.email,
        mappings: mappingsByTeacher[r.teachers.id] ?? [],
      })),
    };
  }

  async createFeeRecord(data: InsertFeeRecord): Promise<FeeRecord> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [rec] = await db.insert(feeRecords).values(data as any).returning();
    return rec;
  }

  /**
   * Atomically creates one invoice for a student/type/period.
   * The transaction-scoped advisory lock protects both manual and
   * structure-backed callers from concurrent duplicate creation. Legacy
   * period-less records remain duplicates for the same student/type within the
   * active session.
   */
  async createInvoiceFeeRecordIfAbsent(input: {
    data: Omit<InsertFeeRecord, "invoiceNumber">;
    periodStart: string;
    afterCreate?: (tx: any, record: FeeRecord) => Promise<void>;
  }): Promise<{ created: boolean; record: FeeRecord }> {
    const data = input.data;
    if (!data.sessionId) throw new Error("Invoices require an active session");
    const normalizedType = data.feeType.trim().toLowerCase();
    const lockKey = [
      "fee-invoice",
      data.schoolId,
      data.sessionId,
      data.studentId,
      normalizedType,
      input.periodStart,
    ].join(":");

    return db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);

      const [existing] = await tx.select().from(feeRecords).where(and(
        eq(feeRecords.schoolId, data.schoolId),
        eq(feeRecords.sessionId, data.sessionId!),
        eq(feeRecords.studentId, data.studentId),
        sql`lower(btrim(${feeRecords.feeType})) = ${normalizedType}`,
        or(
          eq(feeRecords.feePeriodStart, input.periodStart),
          isNull(feeRecords.feePeriodStart),
        ),
      )).limit(1);
      if (existing) return { created: false, record: existing };

      const sequenceResult = await tx.execute(
        sql`INSERT INTO receipt_sequences (school_id, prefix, current_number)
            VALUES (${data.schoolId}, ${"INV-"}, 1)
            ON CONFLICT (school_id, prefix) DO UPDATE
              SET current_number = receipt_sequences.current_number + 1
            RETURNING current_number`,
      );
      const sequence = Number((sequenceResult.rows[0] as any).current_number);
      const invoiceNumber = `INV-${String(sequence).padStart(4, "0")}`;
      const [record] = await tx.insert(feeRecords)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .values({ ...data, invoiceNumber } as any)
        .returning();
      if (input.afterCreate) await input.afterCreate(tx, record);
      return { created: true, record };
    });
  }

  async getFeeRecordsByStudent(studentId: number, schoolId: number, sessionId?: number | null): Promise<FeeRecord[]> {
    const conditions: SQL<unknown>[] = [eq(feeRecords.studentId, studentId), eq(feeRecords.schoolId, schoolId)];
    if (sessionId) conditions.push(eq(feeRecords.sessionId, sessionId));
    return await db.select().from(feeRecords)
      .where(and(...conditions))
      .orderBy(desc(feeRecords.dueDate));
  }

  async getFeeRecordsBySchool(schoolId: number, opts?: { studentId?: number; status?: string; sessionId?: number | null }): Promise<FeeRecord[]> {
    const conditions: any[] = [eq(feeRecords.schoolId, schoolId)];
    if (opts?.studentId) conditions.push(eq(feeRecords.studentId, opts.studentId));
    if (opts?.status) conditions.push(eq(feeRecords.status, opts.status));
    if (opts?.sessionId != null) conditions.push(eq(feeRecords.sessionId, opts.sessionId!));
    return await db.select().from(feeRecords)
      .where(and(...conditions))
      .orderBy(desc(feeRecords.createdAt));
  }

  // invoiceNumber is intentionally excluded: it is assigned once at creation and must never be overwritten.
  async updateFeeRecord(id: number, schoolId: number, data: Omit<Partial<InsertFeeRecord>, "invoiceNumber">, executor: any = db): Promise<FeeRecord | undefined> {
    const [rec] = await executor.update(feeRecords)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .set(data as any)
      .where(and(eq(feeRecords.id, id), eq(feeRecords.schoolId, schoolId)))
      .returning();
    return rec || undefined;
  }

  async deleteFeeRecord(id: number, schoolId: number, executor: any = db): Promise<boolean> {
    // Explicitly remove all dunning_log rows for this fee record before deleting
    // it.  The FK already has ON DELETE CASCADE so the DB would handle this
    // automatically, but we do it explicitly here so the deletion is logged at
    // the application level and so the intent is unambiguous if the FK
    // constraint is ever altered in the future.
    const dunningDeleted = await executor.delete(dunningLog)
      .where(and(eq(dunningLog.feeRecordId, id), eq(dunningLog.schoolId, schoolId)))
      .returning({ id: dunningLog.id });
    if (dunningDeleted.length > 0) {
      console.log(`[fees] deleted ${dunningDeleted.length} dunning_log row(s) for fee_record #${id} (school ${schoolId})`);
    }

    const result = await executor.delete(feeRecords)
      .where(and(eq(feeRecords.id, id), eq(feeRecords.schoolId, schoolId)))
      .returning();
    return result.length > 0;
  }

  /**
   * Finds all "Due" fee records for a school whose due_date has already passed
   * and marks them "Overdue". Returns the updated records so callers can audit-log them.
   */
  async bulkUpdateOverdueFeeRecords(
    schoolId: number,
    afterUpdate?: (tx: any, records: FeeRecord[]) => Promise<void>,
  ): Promise<FeeRecord[]> {
    return db.transaction(async tx => {
      const records = await tx.update(feeRecords)
        .set({ status: "Overdue" })
        .where(
          and(
            eq(feeRecords.schoolId, schoolId),
            eq(feeRecords.status, "Due"),
            lt(feeRecords.dueDate, sql`CURRENT_DATE`),
            sql`EXISTS (
              SELECT 1
              FROM academic_sessions session_scope
              WHERE session_scope.id = ${feeRecords.sessionId}
                AND session_scope.school_id = ${schoolId}
                AND session_scope.is_active = true
            )`,
          )
        )
        .returning();
      if (afterUpdate && records.length > 0) await afterUpdate(tx, records);
      return records;
    });
  }

  // ===== FEE STRUCTURES =====

  async createFeeStructure(data: InsertFeeStructure, executor: any = db): Promise<FeeStructure> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [rec] = await executor.insert(feeStructures).values(data as any).returning();
    return rec;
  }

  async getFeeStructuresBySchool(schoolId: number): Promise<FeeStructure[]> {
    return db.select().from(feeStructures)
      .where(eq(feeStructures.schoolId, schoolId))
      .orderBy(feeStructures.name);
  }

  async updateFeeStructure(id: number, schoolId: number, data: Partial<InsertFeeStructure>, executor: any = db): Promise<FeeStructure | undefined> {
    const [rec] = await executor.update(feeStructures)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .set(data as any)
      .where(and(eq(feeStructures.id, id), eq(feeStructures.schoolId, schoolId)))
      .returning();
    return rec || undefined;
  }

  async deleteFeeStructure(id: number, schoolId: number, executor: any = db): Promise<boolean> {
    const result = await executor.delete(feeStructures)
      .where(and(eq(feeStructures.id, id), eq(feeStructures.schoolId, schoolId)))
      .returning();
    return result.length > 0;
  }

  async getFeeStructureById(id: number, schoolId: number): Promise<FeeStructure | null> {
    const [rec] = await db.select().from(feeStructures)
      .where(and(eq(feeStructures.id, id), eq(feeStructures.schoolId, schoolId)));
    return rec || null;
  }

  /**
   * Bulk-mark all "Due" fee records whose due_date is strictly before today
   * as "Overdue". Only records in each school's active session are eligible:
   * archived and legacy NULL-session financial history must remain immutable.
   * Returns the number of records updated.
   */
  async markOverdueFeeRecords(): Promise<number> {
    const today = todayInIST(); // YYYY-MM-DD
    const result = await db.update(feeRecords)
      .set({ status: "Overdue" })
      .where(and(
        eq(feeRecords.status, "Due"),
        lt(feeRecords.dueDate, today),
        sql`EXISTS (
          SELECT 1
          FROM academic_sessions session_scope
          WHERE session_scope.id = ${feeRecords.sessionId}
            AND session_scope.school_id = ${feeRecords.schoolId}
            AND session_scope.is_active = true
        )`,
      ))
      .returning({ id: feeRecords.id });
    return result.length;
  }

  // ===== PAYMENT RECORDS =====

  async createPaymentRecord(data: InsertPaymentRecord): Promise<PaymentRecord> {
    // A linked invoice is authoritative for school, student, and session.
    // An arrears payment remains in the original invoice year; no client field
    // may move it to another academic session.
    let resolvedSessionId: number | null;
    if (data.feeRecordId != null) {
      const [linked] = await db
        .select({
          studentId: feeRecords.studentId,
          sessionId: feeRecords.sessionId,
        })
        .from(feeRecords)
        .where(and(eq(feeRecords.id, data.feeRecordId), eq(feeRecords.schoolId, data.schoolId)));
      if (!linked) throw new Error("Fee record not found for this school.");
      if (linked.studentId !== data.studentId) {
        throw new Error("Fee record does not belong to the specified student.");
      }
      if (data.sessionId != null && data.sessionId !== linked.sessionId) {
        throw new Error("Payment session must match the linked invoice session.");
      }
      resolvedSessionId = linked.sessionId ?? null;
    } else if (data.sessionId != null) {
      const [session] = await db
        .select({ id: academicSessions.id })
        .from(academicSessions)
        .where(and(eq(academicSessions.id, data.sessionId), eq(academicSessions.schoolId, data.schoolId)));
      if (!session) throw new Error("Academic session does not belong to this school.");
      resolvedSessionId = session.id;
    } else {
      const active = await this.getActiveSession(data.schoolId);
      resolvedSessionId = active?.id ?? null;
    }
    const [rec] = await db.insert(paymentRecords).values({ ...data, sessionId: resolvedSessionId }).returning();
    return rec;
  }

  async getPaymentRecordsBySchool(schoolId: number, opts?: { studentId?: number; feeRecordId?: number; sessionId?: number | null }) {
    const conditions: any[] = [eq(paymentRecords.schoolId, schoolId)];
    if (opts?.studentId) conditions.push(eq(paymentRecords.studentId, opts.studentId));
    if (opts?.feeRecordId !== undefined) conditions.push(eq(paymentRecords.feeRecordId, opts.feeRecordId));
    if (opts?.sessionId != null) conditions.push(eq(paymentRecords.sessionId, opts.sessionId!));
    // LEFT JOIN fee_records to resolve invoice_number without adding a column to payment_records.
    // Orphan records (fee_record_id = NULL) or historical records (invoice_number = NULL) → invoiceNumber: null → shown as "—" in UI.
    const rows = await db
      .select()
      .from(paymentRecords)
      .leftJoin(feeRecords, eq(paymentRecords.feeRecordId, feeRecords.id))
      .where(and(...conditions))
      .orderBy(desc(paymentRecords.createdAt));
    return rows.map(r => ({ ...r.payment_records, invoiceNumber: r.fee_records?.invoiceNumber ?? null }));
  }

  async getPaymentRecordByIdempotencyKey(key: string, schoolId?: number): Promise<PaymentRecord | null> {
    const conditions: any[] = [eq(paymentRecords.idempotencyKey, key)];
    if (schoolId !== undefined) conditions.push(eq(paymentRecords.schoolId, schoolId));
    const [rec] = await db.select().from(paymentRecords).where(and(...conditions));
    return rec || null;
  }

  // ===== RECEIPT SEQUENCES =====

  // Read-only peek — returns what the NEXT number would be without incrementing.
  // Safe to call as many times as needed (modal open previews, no DB writes).
  // padLength controls zero-padding width (default 2 for ON/OF, use 4 for INV-).
  async peekReceiptNumber(schoolId: number, prefix: string, padLength = 2): Promise<string> {
    const result = await db.execute(
      sql`SELECT current_number FROM receipt_sequences WHERE school_id = ${schoolId} AND prefix = ${prefix}`,
    );
    const current = Number((result.rows[0] as any)?.current_number ?? 0);
    return `${prefix}${String(current + 1).padStart(padLength, "0")}`;
  }

  // ===== RECEIPT SEQUENCES =====
  // Atomically increments the counter for `prefix` (e.g. "OF", "INV-") and
  // returns the formatted number (e.g. "OF01", "INV-0001").
  // Uses INSERT … ON CONFLICT DO UPDATE so it self-seeds on first use.
  // Scoped per (school_id, prefix) — each school has its own counter.
  // Deleting ledger rows NEVER touches this table — numbers are permanent.
  //
  // padLength controls zero-padding width:
  //   Default 2 → "ON01", "OF07"
  //   Pass  4  → "INV-0001", "INV-0042"
  //
  // IMPORTANT — INTENTIONAL GAP BEHAVIOUR:
  //   This function is called BEFORE the surrounding DB transaction in the
  //   regular payment flow (POST /api/admin/fees/payments).  If the
  //   transaction rolls back after this call (server crash, overpayment
  //   guard, network failure, etc.) the incremented counter is NOT rolled
  //   back — the number is permanently consumed but never stored.  The
  //   resulting gap in the sequence is deliberate: it guarantees that
  //   no two payments ever share a receipt number, even under concurrent
  //   requests or partial failures.  Gaps do NOT represent missing or
  //   duplicated payments.
  async nextReceiptNumber(schoolId: number, prefix: string, padLength = 2): Promise<string> {
    const result = await db.execute(
      sql`INSERT INTO receipt_sequences (school_id, prefix, current_number)
          VALUES (${schoolId}, ${prefix}, 1)
          ON CONFLICT (school_id, prefix) DO UPDATE
            SET current_number = receipt_sequences.current_number + 1
          RETURNING current_number`,
    );
    const n = Number((result.rows[0] as any).current_number);
    return `${prefix}${String(n).padStart(padLength, "0")}`;
  }

  // ===== FEE AUDIT LOG =====

  async appendFeeAuditLog(entry: {
    schoolId: number; actorId?: number | null; actorName?: string | null;
    ipAddress?: string | null; action: string; entityType?: string | null;
    entityId?: number | null; studentId?: number | null; studentName?: string | null;
    studentIdentifier?: string | null;
    sessionId?: number | null; recordLabel?: string | null; amount?: number | null;
    eventKey?: string | null;
    actorTeacherId?: number | null; actorStaffId?: number | null; actorType?: string;
    actorRole?: string; actorIdentifier?: string; description?: string | null;
  }): Promise<FeeAuditLog> {
    if (entry.sessionId != null) {
      const [session] = await db.select({ id: academicSessions.id })
        .from(academicSessions)
        .where(and(
          eq(academicSessions.id, entry.sessionId),
          eq(academicSessions.schoolId, entry.schoolId),
        ));
      if (!session) throw new Error("Fee audit session does not belong to this school.");
    }
    const [rec] = await db.insert(feeAuditLog).values(entry as any).returning();
    return rec;
  }

  async getFeeAuditLog(
    schoolId: number,
    limit = 50,
    offset = 0,
    from?: string | null,
    to?: string | null,
    action?: string | null,
    search?: string | null,
    sessionId?: number | null,
  ): Promise<{
    entries: Array<{
      id: number;
      actorName: string;
      actorRole: string;
      actorIdentifier: string;
      actorType: string;
      action: string;
      actionLabel: string;
      entityType: string | null;
      entityId: number | null;
      studentId: number | null;
      studentName: string | null;
      studentIdentifier: string | null;
      recordLabel: string | null;
      amount: number | null;
      currency: string;
      sessionId: number | null;
      description: string;
      createdAt: Date | string;
    }>;
    total: number;
    actionOptions: Array<{ value: string; label: string }>;
  }> {
    const searchTrimmed = search?.trim() || null;
    const searchPat = searchTrimmed
      ? `%${searchTrimmed.replace(/[\\%_]/g, "\\$&")}%`
      : null;
    const fromClause = from
      ? sql`AND (fal.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date >= ${from}::date`
      : sql``;
    const toClause = to
      ? sql`AND (fal.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date <= ${to}::date`
      : sql``;
    const actionClause = action ? sql`AND fal.action = ${action}` : sql``;
    const sessionClause = sessionId ? sql`AND fal.session_id = ${sessionId}` : sql``;
    const searchableActorName = searchableFeeAuditText(sql`fal.actor_name`);
    const searchableRecordLabel = searchableFeeAuditText(sql`fal.record_label`);
    const searchableDescription = searchableFeeAuditText(sql`fal.description`);
    const searchClause = searchPat
      ? sql`AND (
          ${searchableActorName} ILIKE ${searchPat}
          OR COALESCE(fal.actor_identifier, '') ILIKE ${searchPat}
          OR COALESCE(fal.student_name, '') ILIKE ${searchPat}
          OR COALESCE(fal.student_identifier, '') ILIKE ${searchPat}
          OR COALESCE(fal.student_id::text, '') ILIKE ${searchPat}
          OR COALESCE(fal.entity_id::text, '') ILIKE ${searchPat}
          OR ${searchableRecordLabel} ILIKE ${searchPat}
          OR ${searchableDescription} ILIKE ${searchPat}
        )`
      : sql``;

    const [countResult, rowsResult] = await Promise.all([
      db.execute(sql`
        SELECT COUNT(*)::int AS cnt
        FROM fee_audit_log fal
        WHERE fal.school_id = ${schoolId}
          ${fromClause} ${toClause} ${actionClause} ${sessionClause} ${searchClause}
      `),
      db.execute(sql`
        SELECT
          fal.id,
          fal.actor_type,
          fal.actor_name,
          fal.actor_role,
          fal.actor_identifier,
          fal.action,
          fal.entity_type,
          fal.entity_id,
          fal.student_id,
          NULLIF(fal.student_name, '') AS student_name,
          NULLIF(fal.student_identifier, '') AS student_identifier,
          fal.record_label,
          fal.amount,
          COALESCE(fal.currency, 'INR') AS currency,
          fal.session_id,
          COALESCE(NULLIF(fal.description, ''), 'Activity recorded.') AS description,
          fal.created_at
        FROM fee_audit_log fal
        WHERE fal.school_id = ${schoolId}
          ${fromClause} ${toClause} ${actionClause} ${sessionClause} ${searchClause}
        ORDER BY fal.created_at DESC, fal.id DESC
        LIMIT ${limit} OFFSET ${offset}
      `),
    ]);

    const entries = (rowsResult.rows as any[]).map((row) => {
      const recordLabel = safeFeeAuditRecordLabel(row.record_label);
      const actor = normalizeFeeAuditActorDisplay({
        actorType: row.actor_type,
        actorName: row.actor_name,
        actorRole: row.actor_role,
        actorIdentifier: row.actor_identifier,
        action: row.action,
        studentId: row.student_id,
        studentName: row.student_name,
        studentIdentifier: row.student_identifier,
      });
      return {
        id: Number(row.id),
        actorName: actor.actorName,
        actorRole: actor.actorRole,
        actorIdentifier: actor.actorIdentifier,
        actorType: actor.actorType,
        action: String(row.action),
        actionLabel: feeAuditActionLabel(String(row.action), row.entity_type, row.entity_id),
        entityType: row.entity_type ?? null,
        entityId: row.entity_id == null ? null : Number(row.entity_id),
        studentId: row.student_id == null ? null : Number(row.student_id),
        studentName: row.student_name ?? null,
        studentIdentifier: row.student_identifier ?? null,
        recordLabel,
        amount: row.amount == null ? null : Number(row.amount),
        currency: String(row.currency ?? "INR"),
        sessionId: row.session_id == null ? null : Number(row.session_id),
        description: safeFeeAuditDescription({
          action: String(row.action),
          description: row.description,
          recordLabel,
        }),
        createdAt: row.created_at,
      };
    });
    return {
      entries,
      total: Number((countResult.rows[0] as any)?.cnt ?? 0),
      actionOptions: CURRENT_FEE_AUDIT_ACTION_OPTIONS.map(option => ({ ...option })),
    };
  }

  // ===== EXTERNAL PAYMENT SETTINGS =====

  async getExternalPaymentSettings(schoolId: number): Promise<ExternalPaymentSettings | null> {
    const [rec] = await db.select().from(externalPaymentSettings)
      .where(eq(externalPaymentSettings.schoolId, schoolId));
    return rec || null;
  }

  async upsertExternalPaymentSettings(schoolId: number, data: {
    isEnabled: boolean; gatewayUrl?: string | null; bannerMessage?: string | null; lastUpdatedBy?: number | null;
    razorpayEnabled?: boolean; razorpayKeyId?: string | null; razorpayKeySecret?: string | null; razorpayWebhookSecret?: string | null; razorpayMode?: string;
  }, executor: any = db): Promise<ExternalPaymentSettings> {
    const [rec] = await executor.insert(externalPaymentSettings)
      .values({ schoolId, ...data, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: externalPaymentSettings.schoolId,
        set: { ...data, updatedAt: new Date() },
      })
      .returning();
    return rec;
  }

  // ===== NOTIFICATION CONFIG =====

  async getNotificationConfig(schoolId: number): Promise<NotificationConfig | null> {
    const [rec] = await db.select().from(notificationConfig).where(eq(notificationConfig.schoolId, schoolId));
    return rec || null;
  }

  async upsertNotificationConfig(schoolId: number, data: Partial<Omit<NotificationConfig, "id" | "schoolId" | "updatedAt">>, executor: any = db): Promise<NotificationConfig> {
    const [rec] = await executor.insert(notificationConfig)
      .values({ schoolId, ...data, updatedAt: new Date() } as any)
      .onConflictDoUpdate({
        target: notificationConfig.schoolId,
        set: { ...data, updatedAt: new Date() },
      })
      .returning();
    return rec;
  }

  async getDunningLog(schoolId: number, limit = 50): Promise<DunningLog[]> {
    return db.select().from(dunningLog)
      .where(eq(dunningLog.schoolId, schoolId))
      .orderBy(desc(dunningLog.sentAt))
      .limit(limit);
  }

  async getDunningLogByStudent(studentId: number, schoolId: number, sessionId?: number | null): Promise<{ id: number; feeRecordId: number | null; channel: string; stage: string; sentAt: Date | null; status: string; recipient: string | null; studentName: string | null; feeRecordDeleted: boolean }[]> {
    // Filter by student via a sub-select rather than an INNER JOIN so the query
    // does not silently drop dunning_log rows whose fee record was deleted.
    // LEFT JOIN fee_records is kept so we can expose a feeRecordDeleted flag to
    // callers; with ON DELETE CASCADE in place those rows should never exist, but
    // the LEFT JOIN makes the view defensive against manual DB changes.
    const sessionCondition = sessionId != null
      ? sql`AND session_id = ${sessionId}`
      : sql``;
    const result = await db.execute(
      sql`SELECT dl.id, dl.fee_record_id, dl.channel, dl.stage, dl.sent_at, dl.status,
                 dl.recipient, dl.student_name,
                 (fr.id IS NULL) AS fee_record_deleted
          FROM dunning_log dl
          LEFT JOIN fee_records fr ON fr.id = dl.fee_record_id AND fr.school_id = dl.school_id
          WHERE dl.school_id = ${schoolId}
            AND dl.fee_record_id IN (
              SELECT id
              FROM fee_records
              WHERE student_id = ${studentId}
                AND school_id = ${schoolId}
                ${sessionCondition}
            )
          ORDER BY dl.sent_at DESC
          LIMIT 200`
    );
    return (result.rows as any[]).map((row) => ({
      id: Number(row.id),
      feeRecordId: row.fee_record_id == null ? null : Number(row.fee_record_id),
      channel: row.channel,
      stage: row.stage,
      sentAt: row.sent_at ?? null,
      status: row.status,
      recipient: row.recipient ?? null,
      studentName: row.student_name ?? null,
      feeRecordDeleted: Boolean(row.fee_record_deleted),
    }));
  }

  // ===== FEE SUMMARY =====

  async getFeeSummary(schoolId: number, sessionId?: number | null): Promise<{
    totalRevenue: number; outstanding: number; collectionRate: number; offlinePaymentsCount: number;
  }> {
    // Total revenue = actual money received (sum of all payment_records), not invoice amounts.
    const sessionJoin = sessionId != null
      ? sql`AND (pr.session_id = ${sessionId} OR (pr.session_id IS NULL AND fr2.session_id = ${sessionId}))`
      : sql``;
    const revenueRow = await db.execute(sql`
      SELECT COALESCE(SUM(pr.amount), 0)::int AS total_revenue
      FROM payment_records pr
      LEFT JOIN fee_records fr2 ON fr2.id = pr.fee_record_id
      WHERE pr.school_id = ${schoolId}
      ${sessionJoin}
    `);
    const totalRevenue = Number((revenueRow.rows[0] as any)?.total_revenue) || 0;

    // Outstanding = the remaining amount on unpaid invoices.
    const sessionCond = sessionId != null ? sql`AND fr.session_id = ${sessionId}` : sql``;
    const outstandingRow = await db.execute(sql`
      SELECT COALESCE(SUM(GREATEST(fr.amount - COALESCE(p.total_paid, 0), 0)), 0)::int AS outstanding
      FROM fee_records fr
      LEFT JOIN (
        SELECT fee_record_id, SUM(amount)::int AS total_paid
        FROM payment_records
        WHERE school_id = ${schoolId} AND fee_record_id IS NOT NULL
        GROUP BY fee_record_id
      ) p ON p.fee_record_id = fr.id
      WHERE fr.school_id = ${schoolId}
        AND fr.status IN ('Due', 'Overdue')
      ${sessionCond}
    `);
    const outstanding = Number((outstandingRow.rows[0] as any)?.outstanding) || 0;

    const total = totalRevenue + outstanding;
    const collectionRate = total > 0 ? Math.round((totalRevenue / total) * 100) : 0;
    let offlineCount: number;
    if (sessionId != null) {
      // Count payments that belong to this session via either path:
      //   a) payment_records.session_id = sessionId  (new rows + backfilled rows)
      //   b) session_id IS NULL but linked fee_record.session_id = sessionId  (legacy fallback)
      const [{ cnt }] = await db
        .select({ cnt: sql<string>`COUNT(DISTINCT ${paymentRecords.id})` })
        .from(paymentRecords)
        .leftJoin(feeRecords, eq(paymentRecords.feeRecordId, feeRecords.id))
        .where(
          and(
            eq(paymentRecords.schoolId, schoolId),
            or(
              eq(paymentRecords.sessionId, sessionId),
              and(isNull(paymentRecords.sessionId), eq(feeRecords.sessionId, sessionId)),
            ),
          ),
        );
      offlineCount = Number(cnt);
    } else {
      const [{ cnt }] = await db.select({ cnt: count() }).from(paymentRecords)
        .where(eq(paymentRecords.schoolId, schoolId));
      offlineCount = Number(cnt);
    }
    return { totalRevenue, outstanding, collectionRate, offlinePaymentsCount: offlineCount };
  }

  // ===== EXAM POLICY TIERS =====

  async getExamPolicyTiers(schoolId: number): Promise<ExamPolicyTier[]> {
    return await db.select().from(examPolicyTiers)
      .where(eq(examPolicyTiers.schoolId, schoolId))
      .orderBy(examPolicyTiers.createdAt);
  }

  async createExamPolicyTier(data: InsertExamPolicyTier): Promise<ExamPolicyTier> {
    const [inserted] = await db.insert(examPolicyTiers).values(data).returning();
    return inserted;
  }

  async updateExamPolicyTier(id: number, schoolId: number, data: Partial<InsertExamPolicyTier>): Promise<ExamPolicyTier | undefined> {
    const [updated] = await db.update(examPolicyTiers)
      .set(data)
      .where(and(eq(examPolicyTiers.id, id), eq(examPolicyTiers.schoolId, schoolId)))
      .returning();
    return updated ?? undefined;
  }

  async deleteExamPolicyTier(id: number, schoolId: number): Promise<boolean> {
    const result = await db.delete(examPolicyTiers)
      .where(and(eq(examPolicyTiers.id, id), eq(examPolicyTiers.schoolId, schoolId)))
      .returning();
    return result.length > 0;
  }

  // ── Promotion Ledger ──────────────────────────────────────────────────────

  /** Fetch all saved promotion decisions for a class/section/term within a school.
   *  When sessionId is provided, results are strictly scoped to that academic year. */
  async getPromotionDecisions(schoolId: number, cls: string, section: string, term: string, sessionId?: number): Promise<PromotionDecision[]> {
    return db.select().from(promotionDecisions).where(
      and(
        eq(promotionDecisions.schoolId, schoolId),
        eq(promotionDecisions.class, cls),
        eq(promotionDecisions.section, section),
        eq(promotionDecisions.term, term),
        ...(sessionId != null ? [eq(promotionDecisions.sessionId, sessionId)] : []),
      )
    );
  }

  /** Bulk upsert promotion decisions; optionally lock the ledger for this class/section/term.
   *  sessionId tags every record to the correct academic year for session-scoped isolation. */
  async savePromotionDecisions(
    schoolId: number, cls: string, section: string, term: string,
    teacherId: number, lock: boolean,
    entries: Array<{ studentId: number; decision: string; targetClass: string; targetSection: string; editCount: number; autoSuggestion?: string }>,
    sessionId?: number,
  ): Promise<void> {
    const now = new Date();

    // When unlocking: bulk-clear ALL locked flags for this cohort first.
    // This handles stale locked rows for students who were already promoted
    // (their class is now different, so they are absent from `entries` but
    // their old promotionDecision row still has locked=true and would
    // re-trigger the UI lock on the next refetch).
    if (!lock) {
      await db.update(promotionDecisions)
        .set({ locked: false, lockedAt: null, updatedAt: now })
        .where(and(
          eq(promotionDecisions.schoolId, schoolId),
          eq(promotionDecisions.class, cls),
          eq(promotionDecisions.section, section),
          eq(promotionDecisions.term, term),
        ));
    }

    for (const e of entries) {
      const isManual = !!e.autoSuggestion && e.autoSuggestion !== e.decision;
      await db.insert(promotionDecisions).values({
        schoolId, class: cls, section, term,
        studentId: e.studentId,
        decision: e.decision,
        targetClass: e.targetClass,
        targetSection: e.targetSection,
        editCount: e.editCount,
        processedByTeacherId: teacherId,
        locked: lock,
        lockedAt: lock ? now : null,
        autoSuggestion: e.autoSuggestion ?? null,
        manualIntervention: isManual,
        updatedAt: now,
        // Tag the record with the academic session so future GET queries can
        // apply strict session-scoped WHERE session_id = ? filtering.
        sessionId: sessionId ?? null,
      }).onConflictDoUpdate({
        target: [promotionDecisions.schoolId, promotionDecisions.class, promotionDecisions.section, promotionDecisions.term, promotionDecisions.studentId],
        set: {
          decision: e.decision,
          targetClass: e.targetClass,
          targetSection: e.targetSection,
          editCount: e.editCount,
          processedByTeacherId: teacherId,
          locked: lock,
          lockedAt: lock ? now : null,
          autoSuggestion: e.autoSuggestion ?? null,
          manualIntervention: isManual,
          updatedAt: now,
          sessionId: sessionId ?? null,
        },
      });
    }
  }

  async getLedgerStatus(schoolId: number, term: string, sessionId?: number): Promise<Array<{
    class: string; section: string; term: string;
    status: "none" | "draft" | "locked";
    totalStudents: number; lockedCount: number; manualInterventionCount: number;
    teacherName: string | null; teacherId: number | null; lockedAt: Date | null;
    adminExecuted: boolean;
  }>> {
    // ── 1. School-configured class-sections + ordered class list ─────────────
    const [csRows, classesRows] = await Promise.all([
      db.select().from(schoolMetadata)
        .where(and(eq(schoolMetadata.schoolId, schoolId), eq(schoolMetadata.metaKey, "class_sections")))
        .limit(1),
      db.select().from(schoolMetadata)
        .where(and(eq(schoolMetadata.schoolId, schoolId), eq(schoolMetadata.metaKey, "classes")))
        .limit(1),
    ]);
    let classSectionsMap: Record<string, string[]> = {};
    let orderedClasses: string[] = [];
    try {
      const p = JSON.parse(csRows[0]?.metaValue ?? "{}");
      if (p && typeof p === "object" && !Array.isArray(p)) classSectionsMap = p;
    } catch {}
    try { orderedClasses = JSON.parse(classesRows[0]?.metaValue ?? "[]"); } catch {}

    // ── 2. Promotion decisions for this term ──────────────────────────────────
    const rows = await db
      .select({
        class: promotionDecisions.class,
        section: promotionDecisions.section,
        term: promotionDecisions.term,
        locked: promotionDecisions.locked,
        lockedAt: promotionDecisions.lockedAt,
        manualIntervention: promotionDecisions.manualIntervention,
        teacherId: promotionDecisions.processedByTeacherId,
        teacherName: teachers.fullName,
        adminExecuted: promotionDecisions.adminExecuted,
      })
      .from(promotionDecisions)
      .leftJoin(teachers, eq(promotionDecisions.processedByTeacherId, teachers.id))
      .where(and(
        eq(promotionDecisions.schoolId, schoolId),
        eq(promotionDecisions.term, term),
        // When sessionId is supplied, restrict to that academic year's decisions only.
        ...(sessionId != null ? [eq(promotionDecisions.sessionId, sessionId)] : []),
      ));

    // ── 3. Faculty mappings → assigned teacher per class-section ─────────────
    const mappingRows = await db
      .select({
        className: facultyMappings.className,
        section: facultyMappings.section,
        teacherName: teachers.fullName,
        teacherId: teachers.id,
      })
      .from(facultyMappings)
      .innerJoin(teachers, eq(facultyMappings.teacherId, teachers.id))
      .where(eq(facultyMappings.schoolId, schoolId));

    const mappedTeacher: Record<string, { name: string; id: number }> = {};
    for (const m of mappingRows) {
      const key = `${m.className}|${m.section}`;
      if (!mappedTeacher[key]) mappedTeacher[key] = { name: m.teacherName, id: m.teacherId };
    }

    // ── 4. Aggregate promotion_decisions into per-class-section buckets ───────
    //   Three student-level state buckets per section:
    //   executedCount  — admin has run the wizard for this student (adminExecuted=true)
    //   readyCount     — teacher locked this student, admin has NOT yet executed
    //   pendingCount   — no lock at all (draft or untouched)
    type AggBucket = {
      cls: string; sec: string;
      total: number; interventionCount: number;
      teacherName: string | null; teacherId: number | null; lockedAt: Date | null;
      executedCount: number;
      readyCount: number;
      pendingCount: number;
    };
    const buckets: Record<string, AggBucket> = {};
    for (const r of rows) {
      const key = `${r.class}|${r.section}`;
      if (!buckets[key]) {
        buckets[key] = {
          cls: r.class, sec: r.section, total: 0, interventionCount: 0,
          teacherName: r.teacherName ?? null, teacherId: r.teacherId ?? null,
          lockedAt: r.lockedAt ?? null,
          executedCount: 0, readyCount: 0, pendingCount: 0,
        };
      }
      const b = buckets[key];
      b.total++;
      if (r.manualIntervention) b.interventionCount++;
      if (r.lockedAt && (!b.lockedAt || r.lockedAt > b.lockedAt)) b.lockedAt = r.lockedAt;
      if (r.teacherName) b.teacherName = r.teacherName;
      if (r.teacherId)   b.teacherId   = r.teacherId;
      if (r.adminExecuted) {
        b.executedCount++;
      } else if (r.locked) {
        b.readyCount++;    // locked by teacher, awaiting admin action
      } else {
        b.pendingCount++;  // not locked — teacher hasn't finalised yet
      }
    }

    // Helper: derive the section-level status from the three counts
    function deriveStatus(b: AggBucket): "none" | "draft" | "locked" {
      if (b.total === 0) return "none";
      // "locked" = every recorded student is either executed or ready (none pending)
      if (b.pendingCount === 0) return "locked";
      return "draft";
    }

    // ── 5. Merge: all configured class-sections + any extras from DB ──────────
    type ResultRow = {
      class: string; section: string; term: string;
      status: "none" | "draft" | "locked";
      totalStudents: number; lockedCount: number; manualInterventionCount: number;
      teacherName: string | null; teacherId: number | null; lockedAt: Date | null;
      // adminExecuted = true ONLY when ALL students in the cohort have been executed
      adminExecuted: boolean;
      executedCount: number;
      readyCount: number;
      pendingCount: number;
    };
    const result: ResultRow[] = [];
    const seen = new Set<string>();

    for (const [cls, sections] of Object.entries(classSectionsMap)) {
      for (const sec of (sections as string[])) {
        const key = `${cls}|${sec}`;
        seen.add(key);
        const b = buckets[key];
        const mapped = mappedTeacher[key];
        result.push(b ? {
          class: cls, section: sec, term,
          status: deriveStatus(b),
          totalStudents: b.total,
          lockedCount: b.readyCount + b.executedCount,   // all processed rows
          manualInterventionCount: b.interventionCount,
          teacherName: b.teacherName || mapped?.name || null,
          teacherId:   b.teacherId   || mapped?.id   || null,
          lockedAt:    b.lockedAt,
          adminExecuted: b.executedCount > 0 && b.readyCount === 0 && b.pendingCount === 0,
          executedCount: b.executedCount,
          readyCount:    b.readyCount,
          pendingCount:  b.pendingCount,
        } : {
          class: cls, section: sec, term,
          status: "none",
          totalStudents: 0, lockedCount: 0, manualInterventionCount: 0,
          teacherName: mapped?.name || null, teacherId: mapped?.id || null,
          lockedAt: null, adminExecuted: false,
          executedCount: 0, readyCount: 0, pendingCount: 0,
        });
      }
    }

    // Include any class-sections from promotion_decisions not in the config map
    for (const [key, b] of Object.entries(buckets)) {
      if (!seen.has(key)) {
        result.push({
          class: b.cls, section: b.sec, term,
          status: deriveStatus(b),
          totalStudents: b.total,
          lockedCount: b.readyCount + b.executedCount,
          manualInterventionCount: b.interventionCount,
          teacherName: b.teacherName, teacherId: b.teacherId,
          lockedAt: b.lockedAt,
          adminExecuted: b.executedCount > 0 && b.readyCount === 0 && b.pendingCount === 0,
          executedCount: b.executedCount,
          readyCount:    b.readyCount,
          pendingCount:  b.pendingCount,
        });
      }
    }

    return result.sort((a, b) => {
      const ia = orderedClasses.indexOf(a.class);
      const ib = orderedClasses.indexOf(b.class);
      const ca = (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      return ca !== 0 ? ca : a.section.localeCompare(b.section);
    });
  }

  // ── Fetch DSID + name map for a set of student IDs (for audit logging) ────
  async getStudentDsidMap(schoolId: number, studentIds: number[]): Promise<Record<number, { dsid: string; name: string }>> {
    if (studentIds.length === 0) return {};
    const rows = await db
      .select({ id: students.id, dsid: students.digitalStudentId, name: students.name })
      .from(students)
      .where(and(eq(students.schoolId, schoolId), inArray(students.id, studentIds)));
    const map: Record<number, { dsid: string; name: string }> = {};
    for (const r of rows) map[r.id] = { dsid: r.dsid, name: r.name };
    return map;
  }

  // ── Delete promotion overrides for a specific set of student IDs ──────────
  async deletePromotionOverridesByStudentIds(schoolId: number, studentIds: number[], examType: string): Promise<void> {
    if (studentIds.length === 0) return;
    await db.delete(promotionOverrides).where(and(
      eq(promotionOverrides.schoolId, schoolId),
      eq(promotionOverrides.examType, examType),
      inArray(promotionOverrides.studentId, studentIds),
    ));
  }

  async markLedgerExecuted(schoolId: number, cls: string, section: string, term: string): Promise<void> {
    await db.update(promotionDecisions)
      .set({ adminExecuted: true, adminExecutedAt: new Date() })
      .where(and(
        eq(promotionDecisions.schoolId, schoolId),
        eq(promotionDecisions.class, cls),
        eq(promotionDecisions.section, section),
        eq(promotionDecisions.term, term),
      ));
  }

  async getDistinctLedgerTerms(schoolId: number): Promise<string[]> {
    const rows = await db
      .selectDistinct({ term: promotionDecisions.term })
      .from(promotionDecisions)
      .where(eq(promotionDecisions.schoolId, schoolId))
      .orderBy(promotionDecisions.term);
    return rows.map(r => r.term);
  }

  async getPromotionGatedTerms(schoolId: number): Promise<string[]> {
    // Source of truth: exam policy tier config, not stale promotion_decisions rows.
    // Collect every term that has promotionGate: true across all tiers for this school.
    const tiers = await db.select().from(examPolicyTiers)
      .where(eq(examPolicyTiers.schoolId, schoolId));

    const gatedTerms = new Set<string>();
    for (const tier of tiers) {
      let rc: Record<string, any> = {};
      try { rc = JSON.parse(tier.resultsConfig ?? "{}"); } catch {}
      const termConfigs: Record<string, any> = rc.termConfigs ?? {};
      for (const [term, cfg] of Object.entries(termConfigs)) {
        if ((cfg as any).promotionGate === true) gatedTerms.add(term);
      }
    }

    if (gatedTerms.size === 0) return [];

    // Preserve the school's configured exam-type order from school_metadata.
    const metaRow = await db.select({ metaValue: schoolMetadata.metaValue })
      .from(schoolMetadata)
      .where(and(eq(schoolMetadata.schoolId, schoolId), eq(schoolMetadata.metaKey, "exam_types")))
      .limit(1);

    let orderedTypes: string[] = [];
    try { orderedTypes = JSON.parse(metaRow[0]?.metaValue ?? "[]"); } catch {}

    // Only show terms that are both promotion-gated AND still exist in the school's exam_types list.
    // This ensures deleted exam types don't linger in the dropdown.
    const ordered = orderedTypes.filter(t => gatedTerms.has(t));
    return ordered;
  }

  async deletePromotionDecisionsByTerm(schoolId: number, term: string): Promise<number> {
    const deleted = await db.delete(promotionDecisions)
      .where(and(
        eq(promotionDecisions.schoolId, schoolId),
        eq(promotionDecisions.term, term),
      ))
      .returning();
    return deleted.length;
  }

  // ── ACADEMIC SESSIONS ───────────────────────────────────────────────────────
  // All methods are tenant-scoped by schoolId to enforce multi-tenant isolation.

  /** Return a single session by its primary key. */
  async getAcademicSessionById(id: number): Promise<AcademicSession | undefined> {
    const [sess] = await db.select().from(academicSessions).where(eq(academicSessions.id, id));
    return sess;
  }

  /** Resolve a session inside its tenant boundary without exposing other tenants' rows. */
  async getAcademicSessionForSchool(id: number, schoolId: number): Promise<AcademicSession | undefined> {
    const [sess] = await db.select().from(academicSessions).where(and(
      eq(academicSessions.id, id),
      eq(academicSessions.schoolId, schoolId),
    ));
    return sess;
  }

  /** Return all sessions for a school, newest first. */
  async getAcademicSessions(schoolId: number): Promise<AcademicSession[]> {
    return await db
      .select()
      .from(academicSessions)
      .where(eq(academicSessions.schoolId, schoolId))
      .orderBy(desc(academicSessions.createdAt));
  }

  /** Return the single active session for a school (or undefined if none set). */
  async getActiveSession(schoolId: number): Promise<AcademicSession | undefined> {
    const [session] = await db
      .select()
      .from(academicSessions)
      .where(and(eq(academicSessions.schoolId, schoolId), eq(academicSessions.isActive, true)));
    return session;
  }

  /** Insert a new academic session. isActive defaults to false from schema. */
  async createAcademicSession(data: InsertAcademicSession): Promise<AcademicSession> {
    const [session] = await db.insert(academicSessions).values(data).returning();
    return session;
  }

  /**
   * Hard-delete only a session with no financial history. Fee and payment
   * foreign keys use SET NULL for legacy compatibility, so the service must
   * prevent a delete from detaching immutable financial evidence.
   */
  async deleteAcademicSession(id: number, schoolId: number): Promise<boolean> {
    return await db.transaction(async (tx) => {
      // Lock the target before checking history to close delete/write races.
      const locked = await tx.execute(sql`
        SELECT id, is_active
        FROM academic_sessions
        WHERE id = ${id} AND school_id = ${schoolId}
        FOR UPDATE
      `);
      const target = locked.rows[0] as { id: number; is_active: boolean } | undefined;
      if (!target) return false;

      // Direct session records and all rows that inherit session via a linked
      // invoice/payment count as financial history. Every predicate is tenant
      // scoped so another school can never block or expose this session.
      const evidence = await tx.execute(sql`
        SELECT EXISTS (
          SELECT 1 FROM fee_records
           WHERE school_id = ${schoolId} AND session_id = ${id}
          UNION ALL
          SELECT 1 FROM payment_records pr
           WHERE pr.school_id = ${schoolId}
             AND (pr.session_id = ${id} OR pr.fee_record_id IN (
               SELECT fr.id FROM fee_records fr
                WHERE fr.school_id = ${schoolId} AND fr.session_id = ${id}
             ))
          UNION ALL
          SELECT 1 FROM payment_attempts pa
           WHERE pa.school_id = ${schoolId}
             AND (pa.session_id = ${id} OR pa.fee_record_id IN (
               SELECT fr.id FROM fee_records fr
                WHERE fr.school_id = ${schoolId} AND fr.session_id = ${id}
             ))
          UNION ALL
          SELECT 1 FROM payment_attempt_events pae
           WHERE pae.school_id = ${schoolId}
             AND (pae.session_id = ${id} OR pae.fee_record_id IN (
               SELECT fr.id FROM fee_records fr
                WHERE fr.school_id = ${schoolId} AND fr.session_id = ${id}
             ))
          UNION ALL
          SELECT 1 FROM refunds r
           WHERE r.school_id = ${schoolId}
             AND (r.session_id = ${id} OR r.fee_record_id IN (
               SELECT fr.id FROM fee_records fr
                WHERE fr.school_id = ${schoolId} AND fr.session_id = ${id}
             ))
          UNION ALL
          SELECT 1 FROM refund_events re
          JOIN refunds r ON r.id = re.refund_id AND r.school_id = re.school_id
           WHERE re.school_id = ${schoolId}
             AND (r.session_id = ${id} OR re.fee_record_id IN (
               SELECT fr.id FROM fee_records fr
                WHERE fr.school_id = ${schoolId} AND fr.session_id = ${id}
             ))
          UNION ALL
          SELECT 1 FROM fee_audit_log
           WHERE school_id = ${schoolId}
             AND (
               session_id = ${id}
               OR (
                 entity_type = 'fee_record'
                 AND entity_id IN (
                   SELECT fr.id FROM fee_records fr
                    WHERE fr.school_id = ${schoolId} AND fr.session_id = ${id}
                 )
               )
             )
          UNION ALL
          SELECT 1 FROM payment_webhook_events pwe
           WHERE pwe.school_id = ${schoolId}
             AND pwe.fee_record_id IN (
               SELECT fr.id FROM fee_records fr
                WHERE fr.school_id = ${schoolId} AND fr.session_id = ${id}
             )
        ) AS has_financial_history
      `);
      if ((evidence.rows[0] as { has_financial_history?: boolean } | undefined)?.has_financial_history) {
        throw new AcademicSessionFinancialHistoryError();
      }

      await tx
        .delete(academicSessions)
        .where(and(eq(academicSessions.id, id), eq(academicSessions.schoolId, schoolId)));

      // If the deleted session was active, promote the most recent remaining session
      if (target.is_active) {
        const remaining = await tx
          .select({ id: academicSessions.id })
          .from(academicSessions)
          .where(eq(academicSessions.schoolId, schoolId))
          .orderBy(desc(academicSessions.id))
          .limit(1);

        if (remaining.length > 0) {
          await tx
            .update(academicSessions)
            .set({ isActive: true, status: "active" })
            .where(and(eq(academicSessions.id, remaining[0].id), eq(academicSessions.schoolId, schoolId)));
        }
      }
      return true;
    });
  }

  /**
   * Atomically activate one session for a school.
   * CRITICAL MULTI-TENANT LOGIC:
   *   Step 1 — set isActive = false for ALL sessions of this schoolId.
   *   Step 2 — set isActive = true for the target id (same schoolId guard).
   * Both steps run inside a single DB transaction so there is never a window
   * where two sessions are active or no session is active mid-request.
   */
  async activateAcademicSession(id: number, schoolId: number): Promise<AcademicSession> {
    return await db.transaction(async (tx) => {
      await tx
        .update(academicSessions)
        .set({ isActive: false })
        .where(eq(academicSessions.schoolId, schoolId));

      const [updated] = await tx
        .update(academicSessions)
        .set({ isActive: true })
        .where(and(eq(academicSessions.id, id), eq(academicSessions.schoolId, schoolId)))
        .returning();

      if (!updated) throw new Error("Session not found or access denied");
      return updated;
    });
  }

  // ── ENROLLMENTS ─────────────────────────────────────────────────────────────

  /**
   * Create a single enrollment record.
   * Called automatically from the student-creation route using the active session.
   * If no active session exists the call is skipped gracefully (non-blocking).
   */
  async createEnrollment(data: InsertEnrollment): Promise<Enrollment> {
    const [enrollment] = await db.insert(enrollments).values(data).returning();
    return enrollment;
  }

  /** List all enrollments for a given session in a school. */
  async getEnrollmentsBySession(schoolId: number, sessionId: number): Promise<Enrollment[]> {
    return await db
      .select()
      .from(enrollments)
      .where(and(eq(enrollments.schoolId, schoolId), eq(enrollments.sessionId, sessionId)));
  }

  /**
   * Resolve a student's authoritative placement for one school-owned session.
   * Enrollment status is intentionally not interpreted here.
   */
  async resolveEnrollmentForStudentSession(
    schoolId: number,
    studentId: number,
    sessionId: number,
  ): Promise<Enrollment | undefined> {
    const [row] = await db
      .select({ enrollment: enrollments })
      .from(enrollments)
      .innerJoin(students, and(
        eq(students.id, enrollments.studentId),
        eq(students.schoolId, enrollments.schoolId),
      ))
      .innerJoin(academicSessions, and(
        eq(academicSessions.id, enrollments.sessionId),
        eq(academicSessions.schoolId, enrollments.schoolId),
      ))
      .where(and(
        eq(enrollments.schoolId, schoolId),
        eq(enrollments.studentId, studentId),
        eq(enrollments.sessionId, sessionId),
      ))
      .limit(1);
    return row?.enrollment;
  }

  /** Get full enrollment history for a single student across all sessions. */
  async getStudentEnrollmentHistory(schoolId: number, studentId: number): Promise<Enrollment[]> {
    return await db.select().from(enrollments)
      .where(and(eq(enrollments.schoolId, schoolId), eq(enrollments.studentId, studentId)))
      .orderBy(desc(enrollments.sessionId));
  }

  /**
   * Insert or update a student enrollment record.
   * Conflict target: (schoolId, studentId, sessionId) — one enrollment per session per student.
   * On conflict: refreshes className/sectionName/status to reflect any class transfer.
   */
  async upsertStudentEnrollment(data: InsertEnrollment): Promise<Enrollment> {
    const [row] = await db.insert(enrollments).values(data)
      .onConflictDoUpdate({
        target: [enrollments.schoolId, enrollments.studentId, enrollments.sessionId],
        set: {
          className: data.className,
          sectionName: data.sectionName,
          status: data.status,
        },
      })
      .returning();
    return row;
  }
}

export const storage = new DatabaseStorage();

// ===== PROMOTION ENGINE =====

interface StudentScoreForEngine {
  subject: string;
  examType: string;
  marks: number;
  totalMarks: number;
  isAbsent: boolean;
}

export interface SubjectAggregate {
  subject: string;
  termResults: Record<string, { percentage: number; status: "pass" | "fail" | "absent" | "incomplete" }>;
}

export interface PromotionResult {
  promoted: boolean;
  reason: string;
  violations: string[];
  subjectAggregates: SubjectAggregate[];
  termFailCounts: Record<string, number>;
}

export function evaluatePromotion(
  scores: StudentScoreForEngine[],
  tier: ExamPolicyTier,
  passPercentage: number,
  termAttendance?: Record<string, number>,
  contextSchoolId: number = tier.schoolId,
  currentTerm?: string,
): PromotionResult {
  if (tier.schoolId !== contextSchoolId) {
    throw new Error(`Promotion policy school ${tier.schoolId} does not match calculation school ${contextSchoolId}.`);
  }
  let weights: Record<string, { source_exam: string; weight: number }[]> = {};
  let rules: {
    max_failed_subjects_final?: number;
    rule1?: {
      enabled?: boolean;
      term?: string;
      max_fails?: number;
      rules?: { term: string; fail_count: number }[];
    };
    rule_attendance?: {
      enabled?: boolean;
      rules?: { term: string; min_pct: number }[];
    };
    composite_fail_rules?: {
      half_yearly_fails_threshold?: number;
      final_fails_allowance_if_half_yearly_tripped?: number;
    };
    rule_term_avg?: {
      enabled?: boolean;
      minPct?: number;
    };
  } = {};

  try { weights = JSON.parse(tier.examWeights || "{}"); } catch { /* use empty */ }
  try { rules = JSON.parse(tier.promotionFailRules || "{}"); } catch { /* use defaults */ }

  const termNames = Object.keys(weights);

  const bySubject: Record<string, StudentScoreForEngine[]> = {};
  for (const s of scores) {
    if (!bySubject[s.subject]) bySubject[s.subject] = [];
    bySubject[s.subject].push(s);
  }

  const subjectAggregates: SubjectAggregate[] = [];

  for (const subject of Object.keys(bySubject)) {
    const subjectScores = bySubject[subject];
    const termResults: SubjectAggregate["termResults"] = {};

    for (const [termName, components] of Object.entries(weights)) {
      let weightedSum = 0;
      let totalWeight = 0;
      let hasAbsent = false;
      let hasData = false;

      for (const comp of components) {
        const record = subjectScores.find(s => s.examType === comp.source_exam);
        if (!record) continue;
        hasData = true;
        if (record.isAbsent) { hasAbsent = true; continue; }
        if (record.totalMarks === 0) continue;
        const pct = (record.marks / record.totalMarks) * 100;
        weightedSum += pct * (comp.weight / 100);
        totalWeight += comp.weight;
      }

      if (!hasData) {
        termResults[termName] = { percentage: 0, status: "incomplete" };
      } else if (hasAbsent) {
        termResults[termName] = { percentage: 0, status: "absent" };
      } else {
        const effectivePct = totalWeight > 0 ? (weightedSum * 100) / totalWeight : 0;
        termResults[termName] = {
          percentage: Math.round(effectivePct * 10) / 10,
          status: effectivePct >= passPercentage ? "pass" : "fail",
        };
      }
    }
    subjectAggregates.push({ subject, termResults });
  }

  const termFailCounts: Record<string, number> = {};
  for (const termName of termNames) {
    termFailCounts[termName] = subjectAggregates.filter(s => {
      const r = s.termResults[termName];
      return r?.status === "fail" || r?.status === "absent";
    }).length;
  }

  const rule1 = rules.rule1;
  const maxFailedSubjectRules = rule1?.enabled === false ? undefined
    : Array.isArray(rule1?.rules) && rule1.rules.length > 0
      ? rule1.rules.map(rule => ({ term: String(rule.term).trim(), failCount: Number(rule.fail_count) }))
      : rule1?.term && rule1.max_fails !== undefined
        ? [{ term: String(rule1.term).trim(), failCount: Number(rule1.max_fails) }]
        : rules.max_failed_subjects_final !== undefined && termNames.length
          ? [{ term: termNames[termNames.length - 1], failCount: Number(rules.max_failed_subjects_final) }]
          : undefined;
  const attendanceRules = rules.rule_attendance?.enabled === true
    ? (rules.rule_attendance.rules ?? []).map(rule => ({ term: String(rule.term).trim(), minPercent: Number(rule.min_pct) }))
    : undefined;
  const termAverages = Object.fromEntries(termNames.map(term => {
    const scored = subjectAggregates.map(subject => subject.termResults[term])
      .filter(result => result?.status === "pass" || result?.status === "fail");
    return [term, scored.length ? Math.round((scored.reduce((sum, result) => sum + result.percentage, 0) / scored.length) * 10) / 10 : null];
  }));
  const promotion = evaluatePromotionRules({
    context: { schoolId: contextSchoolId, sessionId: null },
    policySchoolId: tier.schoolId,
    maxFailedSubjectRules,
    attendanceRules,
    termAverageRule: rules.rule_term_avg?.enabled === true
      ? { enabled: true, minPct: Number(rules.rule_term_avg.minPct) }
      : undefined,
    termFailCounts,
    termAverages,
    attendancePct: null,
    attendanceByTerm: termAttendance,
    currentTerm,
    cumulativePercentage: null,
  });
  return {
    promoted: promotion.promoted,
    reason: promotion.promotionReason,
    violations: promotion.violations,
    subjectAggregates,
    termFailCounts,
  };
}
