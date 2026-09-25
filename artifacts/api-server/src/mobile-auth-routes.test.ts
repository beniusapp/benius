import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { getTableName } from "drizzle-orm";
import sharp from "sharp";
import test from "node:test";
import { db, pool } from "./db";
import { hashMobileCredential } from "./mobile-auth-crypto";
import { rejectBearerOutsideMobileAuth, shouldLogJsonResponseBody } from "./mobile-auth-policy";
import { registerMobileAuthRoutes } from "./mobile-auth-routes";
import { storage } from "./storage";

type FixtureUser = {
  id: number;
  email: string;
  role: string;
  schoolId: number;
  passwordHash: string;
  isActive: boolean;
  isInitialized: boolean;
  pinHash: string | null;
};

type FixtureTeacher = {
  id: number;
  userId: number;
  schoolId: number;
  fullName: string;
  isActive: boolean;
  mustChangePassword: boolean;
  phone?: string | null;
  subject?: string | null;
  assignedClass?: string;
  assignedSection?: string;
  designation?: string | null;
  gender?: string | null;
  dateOfBirth?: string | null;
  govtIdType?: string | null;
  govtIdNumber?: string | null;
  address?: string | null;
  joiningDate?: string | null;
  qualifications?: string | null;
  profileImageUrl?: string | null;
  digitalTeacherId?: string | null;
};

type FixtureStudent = {
  id: number;
  schoolId: number;
  digitalStudentId: string;
  name: string;
  class: string;
  section: string;
  photoUrl: string | null;
  passwordHash: string;
  isActive: boolean;
  isActivated: boolean;
  phone?: string | null;
  dob?: string | null;
  enrollmentDate?: string | null;
  gender?: string | null;
  rollNumber?: number | null;
  guardianName?: string | null;
  bloodGroup?: string | null;
  fatherName?: string | null;
  motherName?: string | null;
  address?: string | null;
  aadharNumber?: string | null;
  email?: string | null;
  verifiedProfile?: string | null;
};

type FixtureStaff = {
  id: number;
  schoolId: number;
  email: string;
  fullName: string;
  passwordHash: string;
  isActive: boolean;
  allowedModules: string[];
};

type SessionFixture = {
  id: string;
  principal_id: number;
  principal_entity_id: number | null;
  role: string;
  school_id: number;
  principal_password_version: string;
  access_token_hash: string;
  access_expires_at: Date;
  auth_issued_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
};

type RefreshFixture = {
  sessionId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
};

type ChallengeFixture = {
  challengeHash: string;
  principalId: number;
  schoolId: number;
  purpose: string;
  authIssuedAt: Date;
  principalPasswordVersion: string;
  attemptCount: number;
  expiresAt: Date;
  consumedAt: Date | null;
};

function jsonResponse(response: Response): Promise<unknown> {
  return response.json();
}

test("mobile auth endpoints authenticate each role and enforce credential lifecycle contracts", async (t) => {
  assert.notEqual(process.env.NODE_ENV, "production", "route tests must never run in production mode");

  const school = { id: 1, name: "Isolated Test School", code: "AUTH-TEST" };
  const foreignSchool = { id: 2, name: "Foreign Test School", code: "FOREIGN" };
  const schoolsById = new Map([[school.id, school], [foreignSchool.id, foreignSchool]]);
  const userRows = new Map<number, FixtureUser>();
  const teacherRows = new Map<number, FixtureTeacher>();
  const studentRows = new Map<number, FixtureStudent>();
  const staffRows = new Map<number, FixtureStaff>();
  const sessions = new Map<string, SessionFixture>();
  const refreshTokens = new Map<string, RefreshFixture>();
  const challenges = new Map<string, ChallengeFixture>();
  const attemptCounts = new Map<string, number>();
  const profiles = new Map<number, Record<string, any>>();
  const verificationCounts = new Map<number, number>();
  const profileMetrics: Record<string, unknown> = {};
  const teacherMetrics: Record<string, unknown> = {};
  const attendanceMetrics: Record<string, unknown> = {};
  const attendancePolicyRows = [
    {
      id: 1, schoolId: school.id, targetRole: "STUDENT", policyName: "Student Test Policy",
      applicableClasses: ["Current 9"], expectedArrivalTime: "08:45", gracePeriodMinutes: 5,
      halfDayCutoffTime: "12:15", schoolEndTime: "16:30", attendanceTarget: 90, isActive: true,
    },
    {
      id: 2, schoolId: foreignSchool.id, targetRole: "STUDENT", policyName: "Foreign Policy",
      applicableClasses: [], expectedArrivalTime: "08:00", gracePeriodMinutes: 0,
      halfDayCutoffTime: "12:00", schoolEndTime: "17:00", attendanceTarget: 80, isActive: true,
    },
  ];
  const academicSessionRows = [
    { id: 501, schoolId: school.id, sessionName: "2025-2026", startDate: "2025-04-01", endDate: "2026-03-31", isActive: true },
    { id: 502, schoolId: school.id, sessionName: "2024-2025", startDate: "2024-04-01", endDate: "2025-03-31", isActive: false },
    { id: 601, schoolId: 2, sessionName: "2025-2026", startDate: "2025-04-01", endDate: "2026-03-31", isActive: true },
  ];

  const hashedPassword = await bcrypt.hash("Correct-Horse-77", 4);
  const hashedPin = await bcrypt.hash("123456", 4);
  const admin: FixtureUser = {
    id: 101, email: "admin-auth-test@example.test", role: "admin", schoolId: school.id,
    passwordHash: hashedPassword, isActive: true, isInitialized: true, pinHash: hashedPin,
  };
  const teacherUser: FixtureUser = {
    id: 102, email: "teacher-auth-test@example.test", role: "teacher", schoolId: school.id,
    passwordHash: hashedPassword, isActive: true, isInitialized: true, pinHash: null,
  };
  const nonOwnerTeacherUser: FixtureUser = {
    id: 104, email: "teacher-non-owner-auth-test@example.test", role: "teacher", schoolId: school.id,
    passwordHash: hashedPassword, isActive: true, isInitialized: true, pinHash: null,
  };
  const initAdmin: FixtureUser = {
    id: 103, email: "init-auth-test@example.test", role: "admin", schoolId: school.id,
    passwordHash: hashedPassword, isActive: true, isInitialized: false, pinHash: null,
  };
  userRows.set(admin.id, admin);
  userRows.set(teacherUser.id, teacherUser);
  userRows.set(nonOwnerTeacherUser.id, nonOwnerTeacherUser);
  userRows.set(initAdmin.id, initAdmin);
  const teacher: FixtureTeacher = {
    id: 201, userId: teacherUser.id, schoolId: school.id, fullName: "Test Teacher",
    isActive: true, mustChangePassword: false,
    phone: "1234567890",
    subject: "Math",
    assignedClass: "Current 9",
    assignedSection: "A",
    designation: "Teacher",
    gender: "Other",
    dateOfBirth: "1990-01-02",
    govtIdType: "National ID",
    govtIdNumber: "TEST-123",
    address: "Teacher Address",
    joiningDate: "2020-05-01",
    qualifications: "B.Ed",
    profileImageUrl: null,
    digitalTeacherId: "AUTH-TEACHER-201",
  };
  teacherRows.set(teacher.id, teacher);
  const nonOwnerTeacher: FixtureTeacher = {
    ...teacher,
    id: 202,
    userId: nonOwnerTeacherUser.id,
    fullName: "Same School Non-Owner Teacher",
    digitalTeacherId: "AUTH-TEACHER-202",
  };
  teacherRows.set(nonOwnerTeacher.id, nonOwnerTeacher);
  const student: FixtureStudent = {
    id: 301, schoolId: school.id, digitalStudentId: "AUTH-STUDENT-301",
    name: "Test Student", class: "Current 9", section: "A", photoUrl: "/student-301.jpg",
    passwordHash: hashedPassword, isActive: true, isActivated: true,
    phone: "1234567890", dob: "2010-01-02", enrollmentDate: "2020-05-01", gender: "Boy",
    rollNumber: 7, guardianName: "Guardian", bloodGroup: "O+", fatherName: "Father",
    motherName: "Mother", address: "Address", aadharNumber: "123456789012",
    email: "student@example.test", verifiedProfile: null,
  };
  studentRows.set(student.id, student);
  const otherStudent: FixtureStudent = {
    id: 302, schoolId: school.id, digitalStudentId: "AUTH-STUDENT-302",
    name: "Other Student", class: "Current 8", section: "B", photoUrl: null,
    passwordHash: hashedPassword, isActive: true, isActivated: true,
  };
  studentRows.set(otherStudent.id, otherStudent);
  const foreignStudent: FixtureStudent = {
    id: 303, schoolId: foreignSchool.id, digitalStudentId: "AUTH-STUDENT-303",
    name: "Foreign Student", class: "Current 7", section: "C", photoUrl: null,
    passwordHash: hashedPassword, isActive: true, isActivated: true,
  };
  studentRows.set(foreignStudent.id, foreignStudent);
  const staff: FixtureStaff = {
    id: 401, schoolId: school.id, email: "staff-auth-test@example.test",
    fullName: "Test Support Staff", passwordHash: hashedPassword, isActive: true,
    allowedModules: ["attendance"],
  };
  staffRows.set(staff.id, staff);

  const originalDbSelect = (db as any).select;
  const originalDbInsert = (db as any).insert;
  const originalPoolQuery = (pool as any).query;
  const originalPoolConnect = (pool as any).connect;
  const storageMethods = [
    "getUserByEmail",
    "getTeacherByUserId",
    "getTeacherWithSchool",
    "getFacultyMappingsByTeacher",
    "getPendingProfilesForTeacher",
    "hasAttendanceToday",
    "getAcademicSessionById",
    "changeTeacherPasswordAtomically",
    "invalidateUserSessionsStrict",
    "updateTeacherProfilePicture",
    "getNonTeachingStaffByEmail",
    "getNonTeachingStaffById",
    "getSchool",
    "getStudentCountBySchoolActive",
    "getTeacherCountBySchool",
    "getUserById",
    "authenticateStudentByDsidForLogin",
    "getAcademicSessions",
    "getActiveSession",
    "getAcademicSessionForSchool",
    "getStudentWithSchool",
    "resolveAttendanceClassSectionForStudent",
    "resolveEnrollmentForStudentSession",
    "getStudentMonthlyAttendance",
    "getStudentYearlyAttendance",
    "getStudentAttendanceStats",
    "getUnreadNoticeCount",
    "getFeeRecordsByStudent",
    "getStudentProfile",
    "getStudentHomework",
    "getStudentHomeworkPendingDates",
    "getStudentClasswork",
    "getHomeworkById",
    "getHomeworkSubmission",
    "getHomeworkSubmissionByFileUrl",
    "upsertMobileHomeworkSubmission",
    "upsertHomeworkSubmission",
    "upsertStudentProfile",
    "submitStudentProfile",
    "updateStudentProfilePhoto",
    "updateStudentPassword",
    "countMonthlyVerifications",
    "logVerificationRequest",
  ] as const;
  const originalStorageMethods = new Map<string, unknown>();
  for (const method of storageMethods) originalStorageMethods.set(method, (storage as any)[method]);
  const dashboardMetrics: Record<string, unknown> = {};
  const homeworkMetrics: Record<string, unknown> = {};
  const homeworkRows = new Map<number, Record<string, any>>([
    [701, {
      id: 701, schoolId: school.id, teacherId: 201, class: student.class, section: student.section,
      subject: "Math", content: "Homework", fileUrl: null, dueDate: "2025-05-01",
      createdAt: new Date("2025-04-25T12:00:00Z"), sessionId: 501,
    }],
    [702, {
      id: 702, schoolId: school.id, teacherId: 201, class: otherStudent.class, section: otherStudent.section,
      subject: "Math", content: "Different cohort", fileUrl: null, dueDate: null,
      createdAt: new Date("2025-04-25T12:00:00Z"), sessionId: 501,
    }],
    [703, {
      id: 703, schoolId: school.id, teacherId: 201, class: "Historical 8", section: "C",
      subject: "Math", content: "Archived assignment", fileUrl: null, dueDate: null,
      createdAt: new Date("2025-04-25T12:00:00Z"), sessionId: 502,
    }],
    [704, {
      id: 704, schoolId: school.id, teacherId: 201, class: student.class, section: student.section,
      subject: "Math", content: "Wrong historical cohort", fileUrl: null, dueDate: null,
      createdAt: new Date("2025-04-25T12:00:00Z"), sessionId: 502,
    }],
  ]);
  const submissionRows = new Map<string, Record<string, any>>();
  const feeRowsByStudent = new Map<number, Array<{ status: string; amount: number }>>([
    [student.id, [{ status: "Outstanding", amount: 75 }, { status: "Paid", amount: 500 }]],
    [otherStudent.id, [{ status: "Unpaid", amount: 0 }]],
  ]);

  const storageFakes = {
    async getSchool(id: number) {
      return schoolsById.get(id);
    },
    async getStudentCountBySchoolActive(schoolId: number) {
      return schoolId === school.id ? 2 : 1;
    },
    async getTeacherCountBySchool(schoolId: number) {
      return schoolId === school.id ? 1 : 0;
    },
    async getUserById(id: number) {
      return userRows.get(id);
    },
    async getUserByEmail(email: string) {
      return [...userRows.values()].find((user) => user.email === email);
    },
    async getTeacherByUserId(userId: number) {
      return [...teacherRows.values()].find((row) => row.userId === userId);
    },
    async getTeacherWithSchool(teacherId: number) {
      const row = teacherRows.get(teacherId);
      const user = row && userRows.get(row.userId);
      if (!row || !user) return undefined;
      if (teacherMetrics.crossSchoolContext) {
        return { teacher: { ...row, schoolId: foreignSchool.id }, user, school: foreignSchool };
      }
      const rowSchool = schoolsById.get(row.schoolId);
      if (!rowSchool) return undefined;
      return { teacher: row, user, school: rowSchool };
    },
    async getFacultyMappingsByTeacher(teacherId: number) {
      teacherMetrics.mappingTeacherId = teacherId;
      return [{ className: "Current 9", section: "A", subject: "Math" }];
    },
    async getPendingProfilesForTeacher(schoolId: number, teacherId: number, _unused?: unknown, sessionId?: number | null) {
      teacherMetrics.pendingCountArguments = [schoolId, teacherId, sessionId];
      return [{ id: 1 }, { id: 2 }];
    },
    async hasAttendanceToday(teacherId: number, cls: string, section: string, schoolId: number, sessionId: number) {
      teacherMetrics.attendanceArguments = [teacherId, cls, section, schoolId, sessionId];
      return true;
    },
    async getAcademicSessionById(id: number) {
      return academicSessionRows.find((session) => session.id === id);
    },
    async changeTeacherPasswordAtomically(
      userId: number, teacherId: number, schoolId: number, currentPassword: string, passwordHash: string,
    ) {
      teacherMetrics.passwordChangeArguments = [userId, teacherId, schoolId];
      const user = userRows.get(userId);
      if (!user || user.role !== "teacher" || user.schoolId !== schoolId
        || teacherRows.get(teacherId)?.userId !== userId
        || !await bcrypt.compare(currentPassword, user.passwordHash)) return false;
      user.passwordHash = passwordHash;
      return true;
    },
    async invalidateUserSessionsStrict(userId: number) {
      teacherMetrics.invalidatedUserId = userId;
    },
    async updateTeacherProfilePicture(teacherId: number, profileImageUrl: string) {
      const row = teacherRows.get(teacherId)!;
      row.profileImageUrl = profileImageUrl;
      teacherMetrics.profileImageUrl = profileImageUrl;
    },
    async getNonTeachingStaffByEmail(email: string) {
      return [...staffRows.values()].find((row) => row.email === email);
    },
    async getNonTeachingStaffById(id: number) {
      return staffRows.get(id);
    },
    async authenticateStudentByDsidForLogin(identifier: string, password: string) {
      const row = [...studentRows.values()].find((candidate) => candidate.digitalStudentId === identifier);
      if (!row) return { status: "not_found" as const };
      if (!row.isActive) return { status: "inactive" as const };
      if (!row.isActivated) return { status: "not_activated" as const };
      if (!await bcrypt.compare(password, row.passwordHash)) return { status: "invalid" as const };
      return { status: "success" as const, student: row, authIssuedAt: Date.now() };
    },
    async getAcademicSessions(schoolId: number) {
      return academicSessionRows.filter((session) => session.schoolId === schoolId);
    },
    async getActiveSession(schoolId: number) {
      return academicSessionRows.find((session) => session.schoolId === schoolId && session.isActive);
    },
    async getAcademicSessionForSchool(id: number, schoolId: number) {
      return academicSessionRows.find((session) => session.id === id && session.schoolId === schoolId);
    },
    async getStudentWithSchool(studentId: number) {
      const row = studentRows.get(studentId);
      const studentSchool = row && schoolsById.get(row.schoolId);
      if (row && attendanceMetrics.invalidStudentContext === studentId) {
        return {
          student: { ...row, schoolId: foreignSchool.id },
          school: foreignSchool,
        };
      }
      if (attendanceMetrics.missingStudentContext === studentId) return undefined;
      return row && studentSchool ? { student: row, school: studentSchool } : undefined;
    },
    async getStudentHomework(schoolId: number, cls: string, section: string, studentId: number, date?: string, sessionId?: number | null) {
      homeworkMetrics.listArguments = [schoolId, cls, section, studentId, date, sessionId];
      return [{ id: 701, subject: "Math", submission: null }];
    },
    async getStudentHomeworkPendingDates(schoolId: number, cls: string, section: string, studentId: number, month: string, sessionId?: number | null) {
      homeworkMetrics.pendingArguments = [schoolId, cls, section, studentId, month, sessionId];
      return ["2025-04-25"];
    },
    async getStudentClasswork(schoolId: number, cls: string, section: string, date?: string, sessionId?: number | null) {
      homeworkMetrics.classworkArguments = [schoolId, cls, section, date, sessionId];
      return [{ id: 801, subject: "Science" }];
    },
    async getHomeworkById(id: number) {
      return homeworkRows.get(id);
    },
    async getHomeworkSubmission(homeworkId: number, studentId: number) {
      return submissionRows.get(`${homeworkId}:${studentId}`);
    },
    async getHomeworkSubmissionByFileUrl(fileUrl: string) {
      const submission = [...submissionRows.values()].find((row) => row.fileUrl === fileUrl);
      const homework = submission && homeworkRows.get(submission.homeworkId);
      return submission && homework ? { submission, homework } : undefined;
    },
    async upsertMobileHomeworkSubmission(data: Record<string, any>) {
      if (homeworkMetrics.failMobileSubmission) throw new Error("Injected private submission persistence failure");
      homeworkMetrics.submitArguments = data;
      const key = `${data.homeworkId}:${data.studentId}`;
      const existing = submissionRows.get(key);
      if (existing?.status === "approved") throw new Error("HOMEWORK_SUBMISSION_APPROVED");
      const submission = { id: existing?.id ?? 901, ...existing, ...data, status: "submitted" };
      submissionRows.set(key, submission);
      return { submission, replacedFileUrl: existing?.fileUrl ?? null };
    },
    async upsertHomeworkSubmission(data: Record<string, any>) {
      homeworkMetrics.submitArguments = data;
      const submission = { id: 901, ...data, status: "submitted" };
      submissionRows.set(`${data.homeworkId}:${data.studentId}`, submission);
      return submission;
    },
    async resolveAttendanceClassSectionForStudent(schoolId: number, sessionId: number, studentId: number) {
      dashboardMetrics.historicalContext = [schoolId, sessionId, studentId];
      if (studentId === student.id && sessionId === 501) {
        return { class: student.class, section: student.section };
      }
      if (studentId === student.id && sessionId === 502) {
        return { class: "Historical 8", section: "C" };
      }
      return null;
    },
    async resolveEnrollmentForStudentSession(schoolId: number, studentId: number, sessionId: number) {
      if (schoolId === school.id && sessionId === 501 && studentId === otherStudent.id) {
        return { className: otherStudent.class, sectionName: otherStudent.section };
      }
      if (schoolId === foreignSchool.id && sessionId === 601 && studentId === foreignStudent.id) {
        return { className: foreignStudent.class, sectionName: foreignStudent.section };
      }
      return undefined;
    },
    async getStudentMonthlyAttendance(studentId: number, schoolId: number, sessionId: number, year: number, month: number) {
      attendanceMetrics.monthlyArguments = [studentId, schoolId, sessionId, year, month];
      return [{ date: `${year}-${String(month).padStart(2, "0")}-01`, status: "PRESENT" }];
    },
    async getStudentYearlyAttendance(
      studentId: number, schoolId: number, sessionId: number, cls: string | null, section: string | null,
      startDate: string, endDate: string,
    ) {
      attendanceMetrics.yearlyArguments = [studentId, schoolId, sessionId, cls, section, startDate, endDate];
      return [{ month: "April", present: 9, absent: 1, percentage: 90 }];
    },
    async getStudentAttendanceStats(
      studentId: number, schoolId: number, sessionId: number, cls: string | null, section: string | null,
      startDate: string, endDate: string,
    ) {
      dashboardMetrics.attendanceArguments = [studentId, schoolId, sessionId, cls, section, startDate, endDate];
      attendanceMetrics.statsArguments = [studentId, schoolId, sessionId, cls, section, startDate, endDate];
      return { overallPercent: 91.5, workingDays: 10, daysPresent: 9 };
    },
    async getUnreadNoticeCount(studentId: number, schoolId: number, cls: string, section: string, sessionId: number) {
      dashboardMetrics.noticeArguments = [studentId, schoolId, cls, section, sessionId];
      return studentId === student.id ? 3 : 7;
    },
    async getFeeRecordsByStudent(studentId: number, schoolId: number, sessionId: number) {
      dashboardMetrics.feeArguments = [studentId, schoolId, sessionId];
      return feeRowsByStudent.get(studentId) ?? [];
    },
    async getStudentProfile(studentId: number) {
      return profiles.get(studentId);
    },
    async upsertStudentProfile(data: Record<string, any>, statusOverride?: string) {
      const existing = profiles.get(data.studentId);
      const profile = {
        id: existing?.id ?? data.studentId + 1000,
        ...existing,
        ...data,
        status: statusOverride ?? existing?.status ?? "draft",
      };
      profiles.set(data.studentId, profile);
      profileMetrics.lastProfileSave = { ...profile };
      return profile;
    },
    async submitStudentProfile(studentId: number) {
      const profile = { ...profiles.get(studentId)!, status: "pending" };
      profiles.set(studentId, profile);
      return profile;
    },
    async updateStudentProfilePhoto(studentId: number, photoUrl: string) {
      if (profileMetrics.failPhotoSave) throw new Error("Injected profile photo storage failure");
      const profile = { ...(profiles.get(studentId) ?? {}), studentId, photoUrl, photoStatus: "pending" };
      profiles.set(studentId, profile);
      profileMetrics.photoUrl = photoUrl;
      return profile;
    },
    async updateStudentPassword(studentId: number, passwordHash: string) {
      const row = studentRows.get(studentId)!;
      row.passwordHash = passwordHash;
    },
    async countMonthlyVerifications(schoolId: number, studentId: number) {
      profileMetrics.limitArguments = [schoolId, studentId];
      return verificationCounts.get(studentId) ?? 0;
    },
    async logVerificationRequest(schoolId: number, studentId: number) {
      profileMetrics.verificationLogArguments = [schoolId, studentId];
      verificationCounts.set(studentId, (verificationCounts.get(studentId) ?? 0) + 1);
    },
  };
  Object.assign(storage, storageFakes);

  const sqlNumberParams = (value: unknown, output: number[] = []): number[] => {
    if (Array.isArray(value)) {
      for (const item of value) sqlNumberParams(item, output);
    } else if (value && typeof value === "object") {
      const object = value as { queryChunks?: unknown[]; value?: unknown; constructor?: { name?: string } };
      if (object.constructor?.name === "Param" && typeof object.value === "number") {
        output.push(object.value);
      } else if (object.queryChunks) {
        sqlNumberParams(object.queryChunks, output);
      }
    }
    return output;
  };
  const returnSelectRows = (tableName: string, joins: string[], whereClause: unknown) => {
    if (tableName === "schools") {
      const schoolId = sqlNumberParams(whereClause)[0];
      const match = schoolsById.get(schoolId);
      return match ? [match] : [];
    }
    if (tableName === "users" && joins.length === 0) {
      const id = sqlNumberParams(whereClause)[0];
      return userRows.has(id) ? [userRows.get(id)] : [];
    }
    if (tableName === "users") {
      if (joins.includes("teachers")) {
        const joinedTeacher = [...teacherRows.values()][0];
        const joinedUser = joinedTeacher && userRows.get(joinedTeacher.userId);
        if (!joinedTeacher || !joinedUser || joinedTeacher.schoolId !== school.id || joinedUser.schoolId !== school.id
          || joinedUser.role !== "teacher") return [];
        return [{ users: joinedUser, teachers: joinedTeacher, schools: school }];
      }
      const principalId = sqlNumberParams(whereClause)[0];
      const joinedAdmin = userRows.get(principalId);
      if (!joinedAdmin || joinedAdmin.schoolId !== school.id || joinedAdmin.role !== "admin") return [];
      return [{ users: joinedAdmin, schools: school }];
    }
    if (tableName === "teachers") {
      const row = [...teacherRows.values()][0];
      const user = row && userRows.get(row.userId);
      if (!row || !user || !row.isActive || !user.isActive || row.mustChangePassword
        || row.schoolId !== school.id || user.schoolId !== school.id || user.role !== "teacher") return [];
      return [{ teachers: row, users: user, schools: school }];
    }
    if (tableName === "students") {
      const params = sqlNumberParams(whereClause);
      const row = [...studentRows.values()].find((candidate) =>
        candidate.id === params[0] && candidate.schoolId === params[1]);
      const studentSchool = row && schoolsById.get(row.schoolId);
      if (!row || !studentSchool || !row.isActive || !row.isActivated) return [];
      return [{ students: row, schools: studentSchool }];
    }
    if (tableName === "attendance_policies") {
      if (attendanceMetrics.failPolicyQuery) throw new Error("Injected attendance policy query failure");
      const schoolId = sqlNumberParams(whereClause)[0];
      return attendancePolicyRows.filter((row) => row.schoolId === schoolId);
    }
    return [];
  };

  (db as any).select = () => {
    let tableName = "";
    const joins: string[] = [];
    let whereClause: unknown;
    const builder = {
      from(table: unknown) {
        tableName = getTableName(table as never);
        return this;
      },
      innerJoin(table: unknown) {
        joins.push(getTableName(table as never));
        return this;
      },
      where(clause: unknown) {
        whereClause = clause;
        return Promise.resolve(returnSelectRows(tableName, joins, whereClause));
      },
    };
    return builder;
  };
  (db as any).insert = (table: unknown) => ({
    values(values: Record<string, unknown>) {
      if (getTableName(table as never) !== "mobile_auth_challenges") {
        throw new Error(`Unexpected insert target in auth route test: ${getTableName(table as never)}`);
      }
      const challenge = values as unknown as ChallengeFixture;
      challenges.set(challenge.challengeHash, { ...challenge, attemptCount: 0, consumedAt: null });
      return Promise.resolve();
    },
  });

  const result = <T>(rows: T[], rowCount = rows.length) => ({ rows, rowCount });
  const fakeClientQuery = async (rawSql: string, values: unknown[] = []) => {
    const sqlText = rawSql.replace(/\s+/g, " ").trim().toLowerCase();
    if (sqlText === "begin" || sqlText === "commit" || sqlText === "rollback") return result([]);
    if (sqlText.includes("pg_advisory_xact_lock")) return result([{}]);
    if (sqlText.includes("select count(*)::integer as attempt_count")) {
      return result([{ attempt_count: attemptCounts.get(String(values[0])) ?? 0 }]);
    }
    if (sqlText.startsWith("insert into security_audit")) {
      const ipAddress = String(values[0]);
      attemptCounts.set(ipAddress, (attemptCounts.get(ipAddress) ?? 0) + 1);
      return result([], 1);
    }
    if (sqlText.startsWith("insert into mobile_auth_sessions")) {
      const session: SessionFixture = {
        id: String(values[0]),
        principal_id: Number(values[2]),
        principal_entity_id: values[3] === null ? null : Number(values[3]),
        role: String(values[4]),
        school_id: Number(values[5]),
        principal_password_version: String(values[6]),
        access_token_hash: String(values[7]),
        access_expires_at: new Date(values[8] as Date),
        auth_issued_at: new Date(values[9] as Date),
        expires_at: new Date(values[10] as Date),
        revoked_at: null,
      };
      sessions.set(session.id, session);
      return result([], 1);
    }
    if (sqlText.startsWith("select s.id, s.principal_id, s.principal_entity_id, s.role, s.school_id")) {
      const refresh = refreshTokens.get(String(values[0]));
      const session = refresh && sessions.get(refresh.sessionId);
      if (!refresh || !session) return result([]);
      return result([{
        ...session,
        refresh_used_at: refresh.usedAt,
        refresh_revoked_at: refresh.revokedAt,
        refresh_expires_at: refresh.expiresAt,
      }]);
    }
    if (sqlText.startsWith("insert into mobile_auth_refresh_tokens") && sqlText.includes(" select ")) {
      const [sessionId, tokenHash, oldTokenHash] = values;
      const oldToken = refreshTokens.get(String(oldTokenHash));
      if (!oldToken) return result([], 0);
      refreshTokens.set(String(tokenHash), {
        sessionId: String(sessionId), familyId: oldToken.familyId, tokenHash: String(tokenHash),
        expiresAt: oldToken.expiresAt, usedAt: null, revokedAt: null,
      });
      return result([], 1);
    }
    if (sqlText.startsWith("insert into mobile_auth_refresh_tokens (session_id, family_id, token_hash")) {
      const [sessionId, tokenHash, expiresAt] = values;
      refreshTokens.set(String(tokenHash), {
        sessionId: String(sessionId), familyId: String(sessionId), tokenHash: String(tokenHash),
        expiresAt: new Date(expiresAt as Date), usedAt: null, revokedAt: null,
      });
      return result([], 1);
    }
    if (sqlText.startsWith("select principal_id, school_id, attempt_count")) {
      const challenge = challenges.get(String(values[0]));
      if (!challenge || challenge.purpose !== "admin_pin" || challenge.consumedAt
        || challenge.expiresAt.getTime() <= Date.now()) return result([]);
      return result([{
        principal_id: challenge.principalId,
        school_id: challenge.schoolId,
        attempt_count: challenge.attemptCount,
        auth_issued_at: challenge.authIssuedAt,
        principal_password_version: challenge.principalPasswordVersion,
      }]);
    }
    if (sqlText.startsWith("select principal_id, school_id, auth_issued_at, principal_password_version")) {
      const challenge = challenges.get(String(values[0]));
      if (!challenge || challenge.purpose !== "admin_initialize" || challenge.consumedAt
        || challenge.expiresAt.getTime() <= Date.now()) return result([]);
      return result([{
        principal_id: challenge.principalId,
        school_id: challenge.schoolId,
        auth_issued_at: challenge.authIssuedAt,
        principal_password_version: challenge.principalPasswordVersion,
      }]);
    }
    if (sqlText.startsWith("select password_hash, is_active, is_initialized from users")) {
      const user = userRows.get(Number(values[0]));
      if (!user || user.schoolId !== Number(values[1]) || user.role !== "admin") return result([]);
      return result([{
        password_hash: user.passwordHash,
        is_active: user.isActive,
        is_initialized: user.isInitialized,
      }]);
    }
    if (sqlText.startsWith("update users set password_hash")) {
      const user = userRows.get(Number(values[4]));
      if (!user || user.schoolId !== Number(values[5]) || user.role !== "admin"
        || !user.isActive || user.isInitialized || user.passwordHash !== values[6]) return result([], 0);
      user.passwordHash = String(values[0]);
      user.pinHash = String(values[1]);
      user.isInitialized = true;
      return result([{ id: user.id }], 1);
    }
    if (sqlText.startsWith("update mobile_auth_challenges set attempt_count")) {
      const challenge = challenges.get(String(values[0]));
      if (challenge) {
        challenge.attemptCount += 1;
        if (sqlText.includes("consumed_at = now()")) challenge.consumedAt = new Date();
      }
      return result([], challenge ? 1 : 0);
    }
    if (sqlText.startsWith("update mobile_auth_challenges set consumed_at")) {
      const challenge = challenges.get(String(values[0]));
      if (challenge) challenge.consumedAt = new Date();
      return result([], challenge ? 1 : 0);
    }
    if (sqlText.startsWith("update mobile_auth_sessions set revoked_at")) {
      const session = sessions.get(String(values[0]));
      if (session) session.revoked_at ||= new Date();
      return result([], session ? 1 : 0);
    }
    if (sqlText.startsWith("update mobile_auth_refresh_tokens set revoked_at")) {
      const sessionId = String(values[0]);
      let affected = 0;
      for (const refresh of refreshTokens.values()) {
        if (refresh.sessionId === sessionId && !refresh.revokedAt) {
          refresh.revokedAt = new Date();
          affected += 1;
        }
      }
      return result([], affected);
    }
    if (sqlText.startsWith("update mobile_auth_refresh_tokens set used_at")) {
      const refresh = refreshTokens.get(String(values[0]));
      if (!refresh || refresh.usedAt || refresh.revokedAt || refresh.expiresAt.getTime() <= Date.now()) {
        return result([], 0);
      }
      refresh.usedAt = new Date();
      return result([{ id: "refresh" }], 1);
    }
    if (sqlText.startsWith("update mobile_auth_sessions set access_token_hash")) {
      const session = sessions.get(String(values[2]));
      if (session && !session.revoked_at) {
        session.access_token_hash = String(values[0]);
        session.access_expires_at = new Date(values[1] as Date);
      }
      return result([], session && !session.revoked_at ? 1 : 0);
    }
    console.error("Unexpected fake SQL:", rawSql);
    throw new Error(`Unexpected SQL in mobile-auth route contract test: ${rawSql}`);
  };

  (pool as any).connect = async () => ({
    query: fakeClientQuery,
    release() {},
  });
  (pool as any).query = async (rawSql: string, values: unknown[] = []) => {
    const sqlText = rawSql.replace(/\s+/g, " ").trim().toLowerCase();
    if (sqlText.includes('from "session"')) return result([]);
    if (sqlText.startsWith("select id, principal_id, principal_entity_id, role, school_id")) {
      const session = [...sessions.values()].find((candidate) =>
        candidate.access_token_hash === String(values[0])
        && !candidate.revoked_at
        && candidate.access_expires_at.getTime() > Date.now()
        && candidate.expires_at.getTime() > Date.now());
      return result(session ? [session] : []);
    }
    if (sqlText.startsWith("select s.id, s.principal_id, s.principal_entity_id, s.role, s.school_id")) {
      const token = refreshTokens.get(String(values[0]));
      const session = token && sessions.get(token.sessionId);
      if (!token || !session) return result([]);
      return result([{
        ...session,
        refresh_used_at: token.usedAt,
        refresh_revoked_at: token.revokedAt,
        refresh_expires_at: token.expiresAt,
      }]);
    }
    if (sqlText.startsWith("update mobile_auth_sessions set last_used_at")) return result([], 1);
    if (sqlText.startsWith("update mobile_auth_sessions set revoked_at")) {
      return fakeClientQuery(rawSql, values);
    }
    if (sqlText.startsWith("update mobile_auth_refresh_tokens set revoked_at")) {
      return fakeClientQuery(rawSql, values);
    }
    console.error("Unexpected fake pool SQL:", rawSql);
    throw new Error(`Unexpected pool SQL in mobile-auth route contract test: ${rawSql}`);
  };

  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use(rejectBearerOutsideMobileAuth);
  app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));
  app.use((req, _res, next) => {
    const cookie = req.get("cookie") || "";
    if (cookie === "test-session=student") {
      (req as any).session = { studentId: student.id };
    } else if (cookie === "test-session=other-student") {
      (req as any).session = { studentId: otherStudent.id };
    } else if (cookie === "test-session=teacher") {
      (req as any).session = {
        teacherId: teacher.id, userId: teacherUser.id, userRole: "teacher",
      };
    } else if (cookie === "test-session=non-owner-teacher") {
      (req as any).session = {
        teacherId: nonOwnerTeacher.id, userId: nonOwnerTeacherUser.id, userRole: "teacher",
      };
    } else if (cookie === "test-session=foreign-teacher") {
      (req as any).session = {
        teacherId: teacher.id, userId: teacherUser.id, userRole: "teacher",
      };
      teacherMetrics.crossSchoolContext = true;
    }
    next();
  });
  registerMobileAuthRoutes(app);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const privateUploadDirectory = path.join(process.cwd(), "private-data", "homework-submissions");
  const preexistingPrivateFiles = new Set(await fs.readdir(privateUploadDirectory).catch(() => [] as string[]));
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    for (const filename of await fs.readdir(privateUploadDirectory).catch(() => [] as string[])) {
      if (!preexistingPrivateFiles.has(filename)) {
        await fs.unlink(path.join(privateUploadDirectory, filename)).catch(() => undefined);
      }
    }
    await fs.rmdir(privateUploadDirectory).catch(() => undefined);
    await fs.rmdir(path.dirname(privateUploadDirectory)).catch(() => undefined);
    (db as any).select = originalDbSelect;
    (db as any).insert = originalDbInsert;
    (pool as any).query = originalPoolQuery;
    (pool as any).connect = originalPoolConnect;
    for (const [method, original] of originalStorageMethods) (storage as any)[method] = original;
  });

  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  let ipSerial = 0;
  async function request(path: string, body?: unknown, accessToken?: string) {
    ipSerial += 1;
    const response = await fetch(`${baseUrl}/api/mobile/auth/${path}`, {
      method: path === "me" ? "GET" : "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-proto": "https",
        "x-forwarded-for": `198.51.100.${ipSerial}`,
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.headers.get("content-type")?.includes("application/json")) {
      throw new Error(`Unexpected non-JSON response for ${path}: ${response.status} ${await response.text()}`);
    }
    return { response, body: await jsonResponse(response) as Record<string, any> };
  }
  async function requestAcademicSessions(path: string, accessToken?: string, sessionId?: number | string) {
    ipSerial += 1;
    const response = await fetch(`${baseUrl}/api/mobile/academic-sessions${path}`, {
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-for": `198.51.100.${ipSerial}`,
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        ...(sessionId === undefined ? {} : { "x-view-session-id": String(sessionId) }),
      },
    });
    return { response, body: await jsonResponse(response) as Record<string, any> };
  }
  async function requestStudentDashboard(
    accessToken?: string,
    sessionId?: number | string,
    query = "",
    authorization?: string,
  ) {
    ipSerial += 1;
    const response = await fetch(`${baseUrl}/api/mobile/student/dashboard${query}`, {
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-for": `198.51.100.${ipSerial}`,
        ...(authorization ? { authorization } : accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        ...(sessionId === undefined ? {} : { "x-view-session-id": String(sessionId) }),
      },
    });
    return { response, body: await jsonResponse(response) as Record<string, any> };
  }
  async function requestAdminApi(
    path: string,
    accessToken?: string,
    method = "GET",
    authorization?: string,
  ) {
    ipSerial += 1;
    const response = await fetch(`${baseUrl}/api/mobile/admin/${path}`, {
      method,
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-for": `198.51.100.${ipSerial}`,
        ...(authorization ? { authorization } : accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
    });
    return { response, body: await jsonResponse(response) as Record<string, any> };
  }
  async function requestStudentAttendance(
    path: string,
    accessToken?: string,
    sessionId?: number | string,
    query = "",
    method = "GET",
    extraHeaders: Record<string, string> = {},
  ) {
    ipSerial += 1;
    const response = await fetch(`${baseUrl}/api/mobile/student/attendance/${path}${query}`, {
      method,
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-for": `198.51.100.${ipSerial}`,
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        ...(sessionId === undefined ? {} : { "x-view-session-id": String(sessionId) }),
        ...extraHeaders,
      },
    });
    return { response, body: await jsonResponse(response) as Record<string, any> };
  }
  async function requestStudentProfile(
    path: string,
    method: string,
    accessToken?: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    ipSerial += 1;
    const response = await fetch(`${baseUrl}/api/mobile/student/profile${path}`, {
      method,
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-for": `198.51.100.${ipSerial}`,
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        ...(body !== undefined && !(body instanceof FormData) ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : {
        body: body instanceof FormData ? body : JSON.stringify(body),
      }),
    });
    return { response, body: await jsonResponse(response) as Record<string, any> };
  }
  async function requestTeacherRoute(
    route: string,
    method: "GET" | "POST" = "GET",
    accessToken?: string,
    body?: unknown,
    options: { https?: boolean; authorization?: string } = {},
  ) {
    ipSerial += 1;
    const response = await fetch(`${baseUrl}/api/mobile/teacher/${route}`, {
      method,
      headers: {
        ...(options.https === false ? {} : { "x-forwarded-proto": "https" }),
        "x-forwarded-for": `198.51.100.${ipSerial}`,
        ...(options.authorization ? { authorization: options.authorization }
          : accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        ...(body !== undefined && !(body instanceof FormData) ? { "content-type": "application/json" } : {}),
      },
      ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
    });
    return { response, body: await jsonResponse(response) as Record<string, any> };
  }
  async function requestStudentHomeDestination(
    route: string,
    method: "GET" | "POST",
    accessToken?: string,
    sessionId?: number | string,
    query = "",
    body?: unknown,
  ) {
    ipSerial += 1;
    const response = await fetch(`${baseUrl}/api/mobile/student/${route}${query}`, {
      method,
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-for": `198.51.100.${ipSerial}`,
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        ...(sessionId === undefined ? {} : { "x-view-session-id": String(sessionId) }),
        ...(body !== undefined && !(body instanceof FormData) ? { "content-type": "application/json" } : {}),
      },
      ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
    });
    return { response, body: await jsonResponse(response) as Record<string, any> };
  }
  async function requestPrivateHomeworkFile(
    fileUrl: string,
    options: { accessToken?: string; cookie?: string; https?: boolean } = {},
  ) {
    ipSerial += 1;
    const response = await fetch(`${baseUrl}${fileUrl}`, {
      headers: {
        ...(options.https === false ? {} : { "x-forwarded-proto": "https" }),
        "x-forwarded-for": `198.51.100.${ipSerial}`,
        ...(options.accessToken ? { authorization: `Bearer ${options.accessToken}` } : {}),
        ...(options.cookie ? { cookie: options.cookie } : {}),
      },
    });
    return { response, text: await response.text() };
  }

  const adminLogin = await request("login", {
    role: "admin", identifier: admin.email, password: "Correct-Horse-77",
  });
  assert.equal(adminLogin.response.status, 200);
  assert.equal(adminLogin.body.state, "pin_required");
  const adminSession = await request("verify-pin", {
    challengeToken: adminLogin.body.challengeToken, pin: "123456",
  });
  assert.equal(adminSession.response.status, 200);
  assert.equal(adminSession.body.state, "authenticated");
  assert.equal(adminSession.body.user.role, "admin");
  assert.equal(adminSession.body.user.schoolId, school.id);
  assert.ok(adminSession.body.accessToken);
  const adminMe = await request("me", undefined, adminSession.body.accessToken);
  assert.equal(adminMe.response.status, 200);
  assert.equal(adminMe.body.role, "admin");

  const teacherLogin = await request("login", {
    role: "teacher", identifier: teacherUser.email, password: "Correct-Horse-77",
  });
  assert.equal(teacherLogin.response.status, 200);
  assert.equal(teacherLogin.body.user.role, "teacher");
  assert.equal(teacherLogin.body.user.id, teacher.id);
  assert.equal((await requestTeacherRoute(
    "me", "GET", undefined, undefined, { authorization: `Bearer ${adminSession.body.accessToken}` },
  )).response.status, 403);
  const teacherProfile = await requestTeacherRoute("me", "GET", teacherLogin.body.accessToken);
  assert.equal(teacherProfile.response.status, 200);
  assert.deepEqual(teacherProfile.body, {
    id: teacher.id,
    userId: teacherUser.id,
    fullName: teacher.fullName,
    email: teacherUser.email,
    phone: teacher.phone,
    subject: teacher.subject,
    assignedClass: teacher.assignedClass,
    assignedSection: teacher.assignedSection,
    designation: teacher.designation,
    gender: teacher.gender,
    dateOfBirth: teacher.dateOfBirth,
    govtIdType: teacher.govtIdType,
    govtIdNumber: teacher.govtIdNumber,
    address: teacher.address,
    joiningDate: teacher.joiningDate,
    qualifications: teacher.qualifications,
    mustChangePassword: teacher.mustChangePassword,
    schoolId: school.id,
    schoolName: school.name,
    schoolCode: school.code,
    attendanceDoneToday: true,
    profileImageUrl: null,
    digitalTeacherId: teacher.digitalTeacherId,
    mappings: [{ className: "Current 9", section: "A", subject: "Math" }],
  });
  assert.deepEqual(teacherMetrics.attendanceArguments, [
    teacher.id, teacher.assignedClass, teacher.assignedSection, school.id, 501,
  ]);
  const teacherPendingCount = await requestTeacherRoute(
    "pending-profiles/count", "GET", teacherLogin.body.accessToken,
  );
  assert.deepEqual(teacherPendingCount.body, { count: 2 });
  assert.deepEqual(teacherMetrics.pendingCountArguments, [school.id, teacher.id, null]);
  teacherMetrics.crossSchoolContext = true;
  assert.equal((await requestTeacherRoute("me", "GET", teacherLogin.body.accessToken)).response.status, 401);
  teacherMetrics.crossSchoolContext = false;
  const teacherHttpsTestEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    assert.equal((await requestTeacherRoute(
      "me", "GET", teacherLogin.body.accessToken, undefined, { https: false },
    )).response.status, 426);
  } finally {
    if (teacherHttpsTestEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = teacherHttpsTestEnv;
  }
  assert.equal((await requestTeacherRoute("me", "GET", undefined, undefined, {
    authorization: `Bearer ${teacherLogin.body.accessToken}`,
  })).response.status, 200);
  assert.equal((await requestTeacherRoute("me")).response.status, 401);
  assert.equal((await requestTeacherRoute(
    "change-password", "POST", teacherLogin.body.accessToken,
    { currentPassword: "wrong-password", newPassword: "New-password-88" },
  )).response.status, 400);
  const rejectedPhoto = new FormData();
  rejectedPhoto.append("file", new Blob(["not an image"], { type: "image/png" }), "spoof.png");
  assert.equal((await requestTeacherRoute(
    "profile-photo", "POST", teacherLogin.body.accessToken, rejectedPhoto,
  )).response.status, 400);
  const wrongPhotoMime = new FormData();
  wrongPhotoMime.append("file", new Blob(["not an image"], { type: "application/pdf" }), "teacher.pdf");
  assert.equal((await requestTeacherRoute(
    "profile-photo", "POST", teacherLogin.body.accessToken, wrongPhotoMime,
  )).response.status, 400);
  const oversizedTeacherPhoto = new FormData();
  oversizedTeacherPhoto.append(
    "file", new Blob([new Uint8Array(1024 * 1024 + 1)], { type: "image/png" }), "teacher.png",
  );
  assert.equal((await requestTeacherRoute(
    "profile-photo", "POST", teacherLogin.body.accessToken, oversizedTeacherPhoto,
  )).response.status, 400);
  const validTeacherPhoto = new FormData();
  const teacherPhotoBytes = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "#22aa66" },
  }).png().toBuffer();
  validTeacherPhoto.append(
    "file", new Blob([new Uint8Array(teacherPhotoBytes)], { type: "image/png" }), "teacher.png",
  );
  const uploadedTeacherPhoto = await requestTeacherRoute(
    "profile-photo", "POST", teacherLogin.body.accessToken, validTeacherPhoto,
  );
  assert.equal(uploadedTeacherPhoto.response.status, 200);
  assert.match(uploadedTeacherPhoto.body.profileImageUrl, /^\/uploads\/schools\/1\/teachers\/201\/profile-/);
  await fs.unlink(path.join(process.cwd(), uploadedTeacherPhoto.body.profileImageUrl.replace(/^\//, "")));
  const listedSessions = await requestAcademicSessions("", teacherLogin.body.accessToken);
  assert.equal(listedSessions.response.status, 200);
  assert.deepEqual(listedSessions.body.sessions.map((session: { id: number }) => session.id), [501, 502]);
  assert.equal(listedSessions.body.activeSessionId, 501);
  const selectedSession = await requestAcademicSessions("/selection", teacherLogin.body.accessToken, 502);
  assert.equal(selectedSession.response.status, 200);
  assert.equal(selectedSession.body.session.id, 502);
  assert.equal(selectedSession.body.session.schoolId, school.id);
  assert.equal((await requestAcademicSessions("/selection", teacherLogin.body.accessToken)).response.status, 400);
  assert.equal((await requestAcademicSessions("/selection", teacherLogin.body.accessToken, "1e3")).response.status, 400);
  assert.equal((await requestAcademicSessions("/selection", teacherLogin.body.accessToken, 601)).response.status, 403);
  const firstTeacherAccess = teacherLogin.body.accessToken as string;
  const firstTeacherRefresh = teacherLogin.body.refreshToken as string;
  const teacherRefresh = await request("refresh", { refreshToken: firstTeacherRefresh });
  assert.equal(teacherRefresh.response.status, 200);
  assert.notEqual(teacherRefresh.body.accessToken, firstTeacherAccess);
  assert.notEqual(teacherRefresh.body.refreshToken, firstTeacherRefresh);
  const teacherMe = await request("me", undefined, teacherRefresh.body.accessToken);
  assert.equal(teacherMe.response.status, 200);
  assert.equal(teacherMe.body.role, "teacher");
  assert.equal(teacherRefresh.body.user.id, teacher.id);
  assert.equal(teacherMe.body.id, teacher.id);
  const reusedRefresh = await request("refresh", { refreshToken: firstTeacherRefresh });
  assert.equal(reusedRefresh.response.status, 401);
  const reusedSession = await request("me", undefined, teacherRefresh.body.accessToken);
  assert.equal(reusedSession.response.status, 401);

  const studentLogin = await request("login", {
    role: "student", identifier: student.digitalStudentId, password: "Correct-Horse-77",
  });
  assert.equal(studentLogin.response.status, 200);
  assert.equal(studentLogin.body.user.role, "student");
  assert.equal(studentLogin.body.user.id, student.id);
  const studentMe = await request("me", undefined, studentLogin.body.accessToken);
  assert.equal(studentMe.response.status, 200);
  assert.equal(studentMe.body.schoolId, school.id);
  assert.equal((await requestTeacherRoute("me", "GET", studentLogin.body.accessToken)).response.status, 403);

  const homeworkList = await requestStudentHomeDestination(
    "homework", "GET", studentLogin.body.accessToken, 501, "?date=2025-04-25&studentId=302&schoolId=2",
  );
  assert.equal(homeworkList.response.status, 200);
  assert.deepEqual(homeworkMetrics.listArguments, [
    school.id, student.class, student.section, student.id, "2025-04-25", 501,
  ]);
  const archivedHomeworkList = await requestStudentHomeDestination(
    "homework", "GET", studentLogin.body.accessToken, 502,
  );
  assert.equal(archivedHomeworkList.response.status, 200);
  assert.deepEqual(homeworkMetrics.listArguments, [
    school.id, "Historical 8", "C", student.id, undefined, 502,
  ]);
  assert.equal((await requestStudentHomeDestination(
    "homework/pending-dates", "GET", studentLogin.body.accessToken, 502, "?month=2025-04",
  )).response.status, 200);
  assert.deepEqual(homeworkMetrics.pendingArguments, [
    school.id, "Historical 8", "C", student.id, "2025-04", 502,
  ]);
  assert.equal((await requestStudentHomeDestination(
    "classwork", "GET", studentLogin.body.accessToken, 502, "?date=2025-04-25",
  )).response.status, 200);
  assert.deepEqual(homeworkMetrics.classworkArguments, [
    school.id, "Historical 8", "C", "2025-04-25", 502,
  ]);
  assert.equal((await requestStudentHomeDestination(
    "homework", "GET", studentLogin.body.accessToken, 501, "?date=2025-02-30",
  )).response.status, 400);
  assert.equal((await requestStudentHomeDestination(
    "homework", "GET", studentLogin.body.accessToken, 601,
  )).response.status, 403);
  assert.equal((await requestStudentHomeDestination(
    "homework/701", "GET", studentLogin.body.accessToken, undefined,
  )).response.status, 400);
  assert.equal((await requestStudentHomeDestination(
    "homework/702", "GET", studentLogin.body.accessToken, 501,
  )).response.status, 403);
  assert.equal((await requestStudentHomeDestination(
    "homework/703", "GET", studentLogin.body.accessToken, 502,
  )).response.status, 200);
  assert.equal((await requestStudentHomeDestination(
    "homework/704", "GET", studentLogin.body.accessToken, 502,
  )).response.status, 403);
  const textSubmission = await requestStudentHomeDestination(
    "homework/701/submit", "POST", studentLogin.body.accessToken, 501, "", { textAnswer: "Answer" },
  );
  assert.equal(textSubmission.response.status, 200);
  assert.deepEqual(homeworkMetrics.submitArguments, {
    homeworkId: 701, studentId: student.id, schoolId: student.schoolId,
    fileUrl: undefined, textAnswer: "Answer",
  });
  const pdfForm = new FormData();
  pdfForm.append("file", new Blob(["%PDF-1.4\nsubmission\n%%EOF"], { type: "application/pdf" }), "answer.pdf");
  pdfForm.append("textAnswer", "Attached work");
  const fileSubmission = await requestStudentHomeDestination(
    "homework/701/submit", "POST", studentLogin.body.accessToken, 501, "", pdfForm,
  );
  assert.equal(fileSubmission.response.status, 200);
  const firstPrivateUrl = fileSubmission.body.submission.fileUrl as string;
  assert.match(firstPrivateUrl, /^\/api\/mobile\/homework-submission-files\/[0-9a-f-]+\.pdf$/);
  const firstPrivatePath = path.join(process.cwd(), "private-data", "homework-submissions", path.basename(firstPrivateUrl));
  assert.equal((await fs.stat(firstPrivatePath)).isFile(), true);
  await assert.rejects(fs.stat(path.join(process.cwd(), "uploads", "homework-submissions", path.basename(firstPrivateUrl))));
  assert.equal((await requestPrivateHomeworkFile(firstPrivateUrl)).response.status, 401);
  const mobilePrivateDownload = await requestPrivateHomeworkFile(firstPrivateUrl, {
    accessToken: studentLogin.body.accessToken,
  });
  assert.equal(mobilePrivateDownload.response.status, 200);
  assert.equal(mobilePrivateDownload.response.headers.get("content-type"), "application/pdf");
  assert.equal(mobilePrivateDownload.response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(mobilePrivateDownload.response.headers.get("cache-control"), "private, no-store");
  assert.equal(mobilePrivateDownload.response.headers.get("content-disposition"), "inline");
  assert.equal(mobilePrivateDownload.text.startsWith("%PDF-"), true);
  assert.equal((await requestPrivateHomeworkFile(firstPrivateUrl, { cookie: "test-session=student" })).response.status, 200);
  assert.equal((await requestPrivateHomeworkFile(firstPrivateUrl, { cookie: "test-session=teacher" })).response.status, 200);
  assert.equal((await requestPrivateHomeworkFile(firstPrivateUrl, {
    cookie: "test-session=non-owner-teacher",
  })).response.status, 403);
  const invalidBearerCookie = await requestPrivateHomeworkFile(firstPrivateUrl, {
    accessToken: "invalid-access-token-12345678901234567890",
    cookie: "test-session=student",
  });
  assert.equal(invalidBearerCookie.response.status, 401);
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    assert.equal((await requestPrivateHomeworkFile(firstPrivateUrl, {
      cookie: "test-session=student", https: false,
    })).response.status, 426);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
  assert.equal((await requestPrivateHomeworkFile(
    "/api/mobile/homework-submission-files/123-456.pdf", { cookie: "test-session=student" },
  )).response.status, 404);
  assert.equal((await requestPrivateHomeworkFile(
    "/uploads/homework-submissions/123-456.pdf", { cookie: "test-session=student" },
  )).response.status, 404);
  const legacyUploadDirectory = path.join(process.cwd(), "uploads", "homework-submissions");
  const legacyFilename = `legacy-${randomUUID()}.pdf`;
  const legacyFixturePath = path.join(legacyUploadDirectory, legacyFilename);
  await fs.mkdir(legacyUploadDirectory, { recursive: true });
  await fs.writeFile(legacyFixturePath, "%PDF-1.4\nlegacy web attachment\n%%EOF");
  try {
    const legacyDownload = await fetch(`${baseUrl}/uploads/homework-submissions/${legacyFilename}`);
    assert.equal(legacyDownload.status, 200);
    assert.equal(await legacyDownload.text(), "%PDF-1.4\nlegacy web attachment\n%%EOF");
  } finally {
    await fs.unlink(legacyFixturePath).catch(() => undefined);
    await fs.rmdir(legacyUploadDirectory).catch(() => undefined);
    await fs.rmdir(path.dirname(legacyUploadDirectory)).catch(() => undefined);
  }

  const secondPdfForm = new FormData();
  secondPdfForm.append("file", new Blob(["%PDF-1.4\nreplacement\n%%EOF"], { type: "application/pdf" }), "replacement.pdf");
  const replacementSubmission = await requestStudentHomeDestination(
    "homework/701/submit", "POST", studentLogin.body.accessToken, 501, "", secondPdfForm,
  );
  assert.equal(replacementSubmission.response.status, 200);
  const replacementUrl = replacementSubmission.body.submission.fileUrl as string;
  assert.notEqual(replacementUrl, firstPrivateUrl);
  await assert.rejects(fs.stat(firstPrivatePath));
  assert.equal((await requestPrivateHomeworkFile(replacementUrl, { accessToken: studentLogin.body.accessToken })).response.status, 200);

  const failedPdfForm = new FormData();
  failedPdfForm.append("file", new Blob(["%PDF-1.4\nfailed save\n%%EOF"], { type: "application/pdf" }), "failed.pdf");
  const privateFilesBeforeFailedSave = (await fs.readdir(privateUploadDirectory)).sort();
  homeworkMetrics.failMobileSubmission = true;
  const failedPrivateReplacement = await requestStudentHomeDestination(
    "homework/701/submit", "POST", studentLogin.body.accessToken, 501, "", failedPdfForm,
  );
  homeworkMetrics.failMobileSubmission = false;
  assert.equal(failedPrivateReplacement.response.status, 503);
  assert.deepEqual((await fs.readdir(privateUploadDirectory)).sort(), privateFilesBeforeFailedSave);
  assert.equal((await requestPrivateHomeworkFile(replacementUrl, { accessToken: studentLogin.body.accessToken })).response.status, 200);
  const spoofedForm = new FormData();
  spoofedForm.append("file", new Blob(["not a PDF"], { type: "application/pdf" }), "spoof.pdf");
  const spoofedSubmission = await requestStudentHomeDestination(
    "homework/701/submit", "POST", studentLogin.body.accessToken, 501, "", spoofedForm,
  );
  assert.equal(spoofedSubmission.response.status, 400);
  const archivedPdfForm = new FormData();
  archivedPdfForm.append("file", new Blob(["%PDF-1.4\narchived\n%%EOF"], { type: "application/pdf" }), "archived.pdf");
  const privateFilesBeforeArchivedUpload = (await fs.readdir(privateUploadDirectory)).sort();
  assert.equal((await requestStudentHomeDestination(
    "homework/703/submit", "POST", studentLogin.body.accessToken, 502, "", archivedPdfForm,
  )).response.status, 403);
  assert.deepEqual((await fs.readdir(privateUploadDirectory)).sort(), privateFilesBeforeArchivedUpload);
  assert.equal((await requestStudentHomeDestination(
    "homework/703/submit", "POST", studentLogin.body.accessToken, 502, "", { textAnswer: "Archived" },
  )).response.status, 403);
  assert.equal((await requestStudentHomeDestination(
    "homework/701", "GET", adminSession.body.accessToken, 501,
  )).response.status, 403);

  const monthlyAttendance = await requestStudentAttendance(
    "monthly", studentLogin.body.accessToken, 502, "?year=2025&month=4&studentId=302&schoolId=2",
  );
  assert.equal(monthlyAttendance.response.status, 200);
  assert.deepEqual(monthlyAttendance.body, {
    schoolId: school.id,
    studentId: student.id,
    sessionId: 502,
    year: 2025,
    month: 4,
    days: [{ date: "2025-04-01", status: "PRESENT" }],
  });
  assert.deepEqual(attendanceMetrics.monthlyArguments, [student.id, school.id, 502, 2025, 4]);
  assert.equal((await requestStudentAttendance(
    "monthly", studentLogin.body.accessToken, 502, "?year=2025&month=13",
  )).response.status, 400);
  assert.equal((await requestStudentAttendance(
    "monthly", studentLogin.body.accessToken, 502, "?year=20x5&month=4",
  )).response.status, 400);
  assert.equal((await requestStudentAttendance(
    "monthly", studentLogin.body.accessToken, undefined, "?year=2025&month=4",
  )).response.status, 400);
  assert.equal((await requestStudentAttendance(
    "monthly", studentLogin.body.accessToken, 601, "?year=2025&month=4",
  )).response.status, 403);

  const yearlyAttendance = await requestStudentAttendance(
    "yearly", studentLogin.body.accessToken, 502,
    "?startDate=1999-01-01&endDate=1999-12-31&sessionName=client-value",
  );
  assert.equal(yearlyAttendance.response.status, 200);
  assert.deepEqual(yearlyAttendance.body, {
    schoolId: school.id,
    studentId: student.id,
    sessionId: 502,
    sessionName: "2024-2025",
    months: [{ month: "April", present: 9, absent: 1, percentage: 90 }],
  });
  assert.deepEqual(attendanceMetrics.yearlyArguments, [
    student.id, school.id, 502, "Historical 8", "C",
    academicSessionRows[1].startDate, academicSessionRows[1].endDate,
  ]);
  const attendanceStats = await requestStudentAttendance(
    "stats", studentLogin.body.accessToken, 502,
    "?startDate=1999-01-01&endDate=1999-12-31&academicYear=1999-2000",
  );
  assert.equal(attendanceStats.response.status, 200);
  assert.deepEqual(attendanceStats.body, {
    schoolId: school.id,
    studentId: student.id,
    sessionId: 502,
    startDate: academicSessionRows[1].startDate,
    overallPercent: 91.5,
    workingDays: 10,
    daysPresent: 9,
  });
  assert.deepEqual(attendanceMetrics.statsArguments, [
    student.id, school.id, 502, "Historical 8", "C",
    academicSessionRows[1].startDate, academicSessionRows[1].endDate,
  ]);
  assert.equal((await requestStudentAttendance(
    "stats", studentLogin.body.accessToken,
  )).response.status, 400);
  assert.equal((await requestStudentAttendance(
    "yearly", studentLogin.body.accessToken, 601,
  )).response.status, 403);

  const attendancePolicy = await requestStudentAttendance(
    "policy", studentLogin.body.accessToken, undefined, "?schoolId=2&studentId=302",
  );
  assert.equal(attendancePolicy.response.status, 200);
  assert.deepEqual(attendancePolicy.body, {
    policyName: "Student Test Policy",
    expectedArrivalTime: "08:45",
    gracePeriodMinutes: 5,
    halfDayCutoffTime: "12:15",
    schoolEndTime: "16:30",
    attendanceTarget: 90,
  });
  attendanceMetrics.failPolicyQuery = true;
  const policyQueryFailure = await requestStudentAttendance(
    "policy", studentLogin.body.accessToken,
  );
  assert.equal(policyQueryFailure.response.status, 503);
  assert.deepEqual(policyQueryFailure.body, { message: "Unable to load attendance policy" });
  attendanceMetrics.failPolicyQuery = false;
  assert.equal((await requestStudentAttendance("policy")).response.status, 401);
  assert.equal((await requestStudentAttendance("monthly", adminSession.body.accessToken, 501, "?year=2025&month=4"))
    .response.status, 403);
  assert.equal((await requestStudentAttendance(
    "monthly", studentLogin.body.accessToken, 501, "?year=2025&month=4", "POST",
  )).response.status, 401);
  assert.equal((await requestStudentAttendance(
    "monthly/extra", studentLogin.body.accessToken, 501, "?year=2025&month=4",
  )).response.status, 401);
  attendanceMetrics.invalidStudentContext = student.id;
  assert.equal((await requestStudentAttendance(
    "monthly", studentLogin.body.accessToken, 501, "?year=2025&month=4",
  )).response.status, 401);
  delete attendanceMetrics.invalidStudentContext;
  attendanceMetrics.missingStudentContext = student.id;
  assert.equal((await requestStudentAttendance(
    "yearly", studentLogin.body.accessToken, 501,
  )).response.status, 401);
  delete attendanceMetrics.missingStudentContext;

  const profileRead = await requestStudentProfile(
    "?studentId=302&schoolId=2", "GET", studentLogin.body.accessToken,
  );
  assert.equal(profileRead.response.status, 200);
  assert.equal(profileRead.body.student.id, student.id);
  assert.equal(profileRead.body.student.schoolId, school.id);
  assert.equal(profileRead.body.student.schoolName, school.name);
  assert.equal(profileRead.body.student.schoolCode, school.code);
  assert.equal(profileRead.body.student.rollNumber, 7);
  assert.equal(profileRead.body.profile, null);
  assert.deepEqual(profileRead.body.verificationLimit, { used: 0, remaining: 3, allowed: 3 });
  assert.deepEqual(profileMetrics.limitArguments, [school.id, student.id]);
  assert.equal((await requestStudentProfile("", "GET")).response.status, 401);
  assert.equal((await requestStudentProfile("", "GET", adminSession.body.accessToken)).response.status, 403);
  const invalidProfile = await requestStudentProfile("", "POST", studentLogin.body.accessToken, {
    aadharNumber: "bad",
  });
  assert.equal(invalidProfile.response.status, 400);
  const incompleteProfile = await requestStudentProfile("", "POST", studentLogin.body.accessToken, {
    fullName: "Verified Name",
  });
  assert.equal(incompleteProfile.response.status, 200);
  const emptyRequired = await requestStudentProfile(
    "/submit", "POST", studentLogin.body.accessToken,
  );
  assert.equal(emptyRequired.response.status, 400);
  assert.match(emptyRequired.body.message, /fill in all required fields/i);
  const savedProfile = await requestStudentProfile("", "POST", studentLogin.body.accessToken, {
    fullName: "Verified Name",
    class: "Client Class",
    section: "Client Section",
    studentId: 302,
    schoolId: 2,
    fatherName: "Father",
    motherName: "Mother",
    presentAddress: "Present Address",
    email: "",
  });
  assert.equal(savedProfile.response.status, 200);
  assert.equal(savedProfile.body.class, student.class);
  assert.equal(savedProfile.body.section, student.section);
  assert.equal(savedProfile.body.studentId, student.id);
  assert.equal(savedProfile.body.schoolId, school.id);
  const firstSubmission = await requestStudentProfile(
    "/submit", "POST", studentLogin.body.accessToken,
  );
  assert.equal(firstSubmission.response.status, 200);
  assert.equal(firstSubmission.body.status, "pending");
  assert.deepEqual(profileMetrics.verificationLogArguments, [school.id, student.id]);
  assert.equal((await requestStudentProfile(
    "/submit", "POST", studentLogin.body.accessToken,
  )).response.status, 409);
  profiles.set(student.id, { ...profiles.get(student.id)!, status: "approved" });
  assert.equal((await requestStudentProfile(
    "/submit", "POST", studentLogin.body.accessToken,
  )).response.status, 409);
  for (let submission = 1; submission < 3; submission += 1) {
    profiles.set(student.id, { ...profiles.get(student.id)!, status: "draft" });
    assert.equal((await requestStudentProfile(
      "/submit", "POST", studentLogin.body.accessToken,
    )).response.status, 200);
  }
  profiles.set(student.id, { ...profiles.get(student.id)!, status: "draft" });
  assert.equal((await requestStudentProfile(
    "/submit", "POST", studentLogin.body.accessToken,
  )).response.status, 429);
  const profileAfterSubmissions = await requestStudentProfile(
    "", "GET", studentLogin.body.accessToken,
  );
  assert.deepEqual(profileAfterSubmissions.body.verificationLimit, { used: 3, remaining: 0, allowed: 3 });
  const wrongMime = new FormData();
  wrongMime.append("photo", new Blob(["not image"], { type: "text/plain" }), "not-image.txt");
  assert.equal((await requestStudentProfile(
    "/photo", "POST", studentLogin.body.accessToken, wrongMime,
  )).response.status, 400);
  const oversizedPhoto = new FormData();
  oversizedPhoto.append("photo", new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], {
    type: "image/jpeg",
  }), "too-large.jpg");
  assert.equal((await requestStudentProfile(
    "/photo", "POST", studentLogin.body.accessToken, oversizedPhoto,
  )).response.status, 413);
  assert.equal(profileMetrics.photoUrl, undefined);
  const inputJpeg = await sharp({
    create: { width: 4, height: 3, channels: 3, background: "#336699" },
  }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const spoofedMime = new FormData();
  spoofedMime.append("photo", new Blob([inputJpeg], { type: "image/png" }), "spoofed.png");
  assert.equal((await requestStudentProfile(
    "/photo", "POST", studentLogin.body.accessToken, spoofedMime,
  )).response.status, 400);
  const excessParts = new FormData();
  excessParts.append("photo", new Blob([inputJpeg], { type: "image/jpeg" }), "photo.jpg");
  for (let index = 0; index < 5; index += 1) excessParts.append(`extra-${index}`, "x");
  assert.equal((await requestStudentProfile(
    "/photo", "POST", studentLogin.body.accessToken, excessParts,
  )).response.status, 400);
  const validPhoto = new FormData();
  validPhoto.append("photo", new Blob([inputJpeg], { type: "image/jpeg" }), "photo.jpg");
  const uploadedPhoto = await requestStudentProfile(
    "/photo", "POST", studentLogin.body.accessToken, validPhoto,
  );
  assert.equal(uploadedPhoto.response.status, 200);
  assert.match(uploadedPhoto.body.photoUrl, /^\/uploads\/student-photos\/[0-9a-f-]+\.jpg$/i);
  assert.equal(profileMetrics.photoUrl, uploadedPhoto.body.photoUrl);
  const photoDirectory = "uploads/student-photos";
  const uploadedPath = `${photoDirectory}/${uploadedPhoto.body.photoUrl.split("/").at(-1)}`;
  try {
    const sanitizedMetadata = await sharp(await fs.readFile(uploadedPath)).metadata();
    assert.equal(sanitizedMetadata.format, "jpeg");
    assert.equal(sanitizedMetadata.orientation, undefined);
  } finally {
    await fs.unlink(uploadedPath);
  }
  const photosBeforeFailure = (await fs.readdir(photoDirectory)).sort();
  profileMetrics.failPhotoSave = true;
  const failedPhoto = new FormData();
  failedPhoto.append("photo", new Blob([inputJpeg], { type: "image/jpeg" }), "photo.jpg");
  assert.equal((await requestStudentProfile(
    "/photo", "POST", studentLogin.body.accessToken, failedPhoto,
  )).response.status, 503);
  profileMetrics.failPhotoSave = false;
  assert.deepEqual((await fs.readdir(photoDirectory)).sort(), photosBeforeFailure);
  assert.equal((await requestStudentProfile(
    "/change-password", "POST", studentLogin.body.accessToken,
    { currentPassword: "", newPassword: "short" },
  )).response.status, 400);
  assert.equal((await requestStudentProfile(
    "/change-password", "POST", studentLogin.body.accessToken,
    { currentPassword: "wrong-password", newPassword: "New-Password-45" },
  )).response.status, 400);
  assert.equal((await request("me", undefined, studentLogin.body.accessToken)).response.status, 200);
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    ipSerial += 1;
    const nonHttpsDashboard = await fetch(`${baseUrl}/api/mobile/student/dashboard`, {
      headers: {
        authorization: "Bearer malformed",
        "x-forwarded-for": `198.51.100.${ipSerial}`,
        "x-forwarded-proto": "http",
      },
    });
    assert.equal(nonHttpsDashboard.status, 426);
    const nonHttpsProfile = await fetch(`${baseUrl}/api/mobile/student/profile`, {
      headers: {
        authorization: "Bearer malformed",
        "x-forwarded-for": `198.51.100.${ipSerial}`,
        "x-forwarded-proto": "http",
      },
    });
    assert.equal(nonHttpsProfile.status, 426);
    const nonHttpsAttendance = await fetch(`${baseUrl}/api/mobile/student/attendance/monthly?year=2025&month=4`, {
      headers: {
        authorization: "Bearer malformed",
        "x-forwarded-for": `198.51.100.${ipSerial}`,
        "x-forwarded-proto": "http",
      },
    });
    assert.equal(nonHttpsAttendance.status, 426);
  } finally {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  }
  ipSerial += 1;
  const unrelatedBearerPath = await fetch(`${baseUrl}/api/student/dashboard`, {
    headers: {
      authorization: `Bearer ${studentLogin.body.accessToken}`,
      "x-forwarded-for": `198.51.100.${ipSerial}`,
      "x-forwarded-proto": "https",
    },
  });
  assert.equal(unrelatedBearerPath.status, 401);
  ipSerial += 1;
  const webTeacherBearer = await fetch(`${baseUrl}/api/teacher-me`, {
    headers: {
      authorization: `Bearer ${teacherLogin.body.accessToken}`,
      "x-forwarded-for": `198.51.100.${ipSerial}`,
      "x-forwarded-proto": "https",
    },
  });
  assert.equal(webTeacherBearer.status, 401);

  assert.equal((await requestStudentDashboard()).response.status, 401);
  assert.equal((await requestStudentDashboard(undefined, 501, "", "Bearer malformed")).response.status, 401);
  assert.equal((await requestStudentDashboard(studentLogin.body.accessToken)).response.status, 400);
  assert.equal((await requestStudentDashboard(studentLogin.body.accessToken, "1e3")).response.status, 400);
  assert.equal((await requestStudentDashboard(studentLogin.body.accessToken, 601)).response.status, 403);

  const studentDashboard = await requestStudentDashboard(
    studentLogin.body.accessToken, 502, "?studentId=302&schoolId=2",
  );
  assert.equal(studentDashboard.response.status, 200);
  assert.deepEqual(studentDashboard.body, {
    student: {
      id: student.id,
      schoolId: school.id,
      name: student.name,
      digitalStudentId: student.digitalStudentId,
      class: student.class,
      section: student.section,
      photoUrl: student.photoUrl,
      schoolName: school.name,
      schoolCode: school.code,
    },
    sessionId: 502,
    attendancePercent: 91.5,
    unreadNoticeCount: 3,
    feesOutstanding: true,
  });
  assert.deepEqual(dashboardMetrics.historicalContext, [school.id, 502, student.id]);
  assert.deepEqual(dashboardMetrics.attendanceArguments, [
    student.id, school.id, 502, "Historical 8", "C",
    academicSessionRows[1].startDate, academicSessionRows[1].endDate,
  ]);
  assert.deepEqual(dashboardMetrics.noticeArguments, [
    student.id, school.id, student.class, student.section, 502,
  ]);
  assert.deepEqual(dashboardMetrics.feeArguments, [student.id, school.id, 502]);
  const malformedDashboardOverrides = await requestStudentDashboard(
    studentLogin.body.accessToken, 502, "?studentId=not-a-number&schoolId=bogus",
  );
  assert.equal(malformedDashboardOverrides.response.status, 200);
  assert.equal(malformedDashboardOverrides.body.student.id, student.id);
  assert.equal(malformedDashboardOverrides.body.student.schoolId, school.id);

  const otherStudentLogin = await request("login", {
    role: "student", identifier: otherStudent.digitalStudentId, password: "Correct-Horse-77",
  });
  assert.equal(otherStudentLogin.response.status, 200);
  const isolatedOtherStudent = await requestStudentDashboard(
    otherStudentLogin.body.accessToken, 501, "?studentId=301&schoolId=2",
  );
  assert.equal(isolatedOtherStudent.response.status, 200);
  assert.equal(isolatedOtherStudent.body.student.id, otherStudent.id);
  assert.equal(isolatedOtherStudent.body.student.schoolId, school.id);
  assert.equal(isolatedOtherStudent.body.unreadNoticeCount, 7);
  assert.equal(isolatedOtherStudent.body.feesOutstanding, false);
  const activeEnrollmentHomework = await requestStudentHomeDestination(
    "homework", "GET", otherStudentLogin.body.accessToken, 501,
  );
  assert.equal(activeEnrollmentHomework.response.status, 200);
  assert.deepEqual(homeworkMetrics.listArguments, [
    school.id, otherStudent.class, otherStudent.section, otherStudent.id, undefined, 501,
  ]);
  assert.equal((await requestStudentHomeDestination(
    "homework", "GET", otherStudentLogin.body.accessToken, 502,
  )).response.status, 403);
  assert.equal((await requestPrivateHomeworkFile(replacementUrl, {
    accessToken: otherStudentLogin.body.accessToken,
  })).response.status, 403);
  assert.equal((await requestPrivateHomeworkFile(replacementUrl, {
    cookie: "test-session=other-student",
  })).response.status, 403);

  const foreignStudentLogin = await request("login", {
    role: "student", identifier: foreignStudent.digitalStudentId, password: "Correct-Horse-77",
  });
  assert.equal(foreignStudentLogin.response.status, 200);
  const foreignProfile = await requestStudentProfile(
    "?studentId=301&schoolId=1", "GET", foreignStudentLogin.body.accessToken,
  );
  assert.equal(foreignProfile.response.status, 200);
  assert.equal(foreignProfile.body.student.id, foreignStudent.id);
  assert.equal(foreignProfile.body.student.schoolId, foreignSchool.id);
  assert.equal(foreignProfile.body.student.schoolName, foreignSchool.name);
  const foreignStudentDashboard = await requestStudentDashboard(
    foreignStudentLogin.body.accessToken, 601,
  );
  assert.equal(foreignStudentDashboard.response.status, 200);
  assert.equal(foreignStudentDashboard.body.student.id, foreignStudent.id);
  assert.equal(foreignStudentDashboard.body.student.schoolId, foreignSchool.id);
  assert.equal(foreignStudentDashboard.body.student.schoolName, foreignSchool.name);
  assert.equal((await requestPrivateHomeworkFile(replacementUrl, {
    accessToken: foreignStudentLogin.body.accessToken,
  })).response.status, 403);
  const foreignHomeworkRead = await requestStudentHomeDestination(
    "homework/701", "GET", foreignStudentLogin.body.accessToken, 601,
  );
  assert.equal(foreignHomeworkRead.response.status, 403);
  const foreignHomeworkWrite = await requestStudentHomeDestination(
    "homework/701/submit", "POST", foreignStudentLogin.body.accessToken, 601, "", { textAnswer: "foreign" },
  );
  assert.equal(foreignHomeworkWrite.response.status, 403);
  teacherMetrics.crossSchoolContext = true;
  const foreignTeacherDownload = await requestPrivateHomeworkFile(replacementUrl, {
    cookie: "test-session=foreign-teacher",
  });
  assert.equal(foreignTeacherDownload.response.status, 403);
  teacherMetrics.crossSchoolContext = false;
  assert.equal((await requestPrivateHomeworkFile(replacementUrl, {
    cookie: "test-session=teacher",
  })).response.status, 200);
  await fs.unlink(path.join(process.cwd(), "private-data", "homework-submissions", path.basename(replacementUrl)));

  const expiredAccessToken = "expired-dashboard-access-token-1234567890";
  const expiredSessionId = "expired-dashboard-session";
  sessions.set(expiredSessionId, {
    id: expiredSessionId,
    principal_id: student.id,
    principal_entity_id: student.id,
    role: "student",
    school_id: school.id,
    principal_password_version: hashMobileCredential(student.passwordHash),
    access_token_hash: hashMobileCredential(expiredAccessToken),
    access_expires_at: new Date(Date.now() - 1000),
    auth_issued_at: new Date(),
    expires_at: new Date(Date.now() + 60_000),
    revoked_at: null,
  });
  assert.equal((await requestStudentDashboard(expiredAccessToken, 501)).response.status, 401);
  assert.equal((await requestStudentProfile("", "GET", expiredAccessToken)).response.status, 401);
  assert.equal((await requestStudentAttendance(
    "stats", expiredAccessToken, 501,
  )).response.status, 401);
  sessions.delete(expiredSessionId);
  const revokedAccessToken = "revoked-profile-access-token-123456789";
  const revokedSessionId = "revoked-profile-session";
  sessions.set(revokedSessionId, {
    id: revokedSessionId,
    principal_id: student.id,
    principal_entity_id: student.id,
    role: "student",
    school_id: school.id,
    principal_password_version: hashMobileCredential(student.passwordHash),
    access_token_hash: hashMobileCredential(revokedAccessToken),
    access_expires_at: new Date(Date.now() + 60_000),
    auth_issued_at: new Date(),
    expires_at: new Date(Date.now() + 60_000),
    revoked_at: new Date(),
  });
  assert.equal((await requestStudentProfile("", "GET", revokedAccessToken)).response.status, 401);
  sessions.delete(revokedSessionId);

  assert.equal((await requestStudentDashboard(adminSession.body.accessToken, 501)).response.status, 403);
  feeRowsByStudent.set(student.id, [{ status: "Unpaid", amount: 0 }, { status: "Paid", amount: 100 }]);
  const noPositiveOutstanding = await requestStudentDashboard(studentLogin.body.accessToken, 501);
  assert.equal(noPositiveOutstanding.response.status, 200);
  assert.equal(noPositiveOutstanding.body.feesOutstanding, false);
  const passwordChanged = await requestStudentProfile(
    "/change-password", "POST", studentLogin.body.accessToken,
    { currentPassword: "Correct-Horse-77", newPassword: "New-Password-45" },
  );
  assert.equal(passwordChanged.response.status, 200);
  assert.equal((await requestStudentProfile(
    "", "GET", studentLogin.body.accessToken,
  )).response.status, 401);
  assert.equal(await bcrypt.compare("New-Password-45", student.passwordHash), true);

  const supportLogin = await request("login", {
    role: "support_staff", identifier: staff.email, password: "Correct-Horse-77",
  });
  assert.equal(supportLogin.response.status, 200);
  assert.equal(supportLogin.body.user.role, "support_staff");
  assert.deepEqual(supportLogin.body.user.allowedModules, ["attendance"]);
  assert.equal((await requestStudentDashboard(supportLogin.body.accessToken, 501)).response.status, 403);
  assert.equal((await requestAcademicSessions("", supportLogin.body.accessToken)).response.status, 403);
  assert.equal((await requestAcademicSessions("/selection", supportLogin.body.accessToken, 501)).response.status, 403);
  const supportOverview = await requestAdminApi("overview?schoolId=2", supportLogin.body.accessToken);
  assert.equal(supportOverview.response.status, 200);
  assert.equal(supportOverview.body.schoolName, school.name);
  assert.equal(supportOverview.body.schoolCode, school.code);
  assert.deepEqual(supportOverview.body.allowedModuleIds, ["attendance"]);
  assert.equal(supportOverview.body.studentCount, null);
  assert.equal(supportOverview.body.teacherCount, null);
  assert.equal(supportOverview.body.dailyPresence, null);
  assert.equal(supportOverview.body.actionRequiredCount, null);
  assert.equal((await requestAdminApi("profile", supportLogin.body.accessToken)).response.status, 403);
  assert.equal((await requestAdminApi("overview", "invalid-mobile-access-token")).response.status, 401);

  const adminOverview = await requestAdminApi("overview", adminSession.body.accessToken, "GET");
  assert.equal(adminOverview.response.status, 200);
  assert.equal(adminOverview.body.studentCount, 2);
  assert.equal(adminOverview.body.teacherCount, 1);
  assert.deepEqual(adminOverview.body.allowedModuleIds, [
    "school-setup", "timetable", "school-calendar", "attendance", "exam-controller",
    "complaint-hub", "noticeboard", "approval-center", "leave-requests",
    "teacher-registry", "non-teaching-staff", "faculty-mapping", "student-registry",
    "fees-manager", "analytics", "audit-logs", "visitor-log", "id-card-gen", "assets",
  ]);
  const adminProfile = await requestAdminApi("profile", adminSession.body.accessToken);
  assert.equal(adminProfile.response.status, 200);
  assert.equal(adminProfile.body.id, admin.id);
  assert.equal(adminProfile.body.email, admin.email);
  assert.equal(adminProfile.body.isInitialized, true);

  staff.allowedModules = ["attendance", "attendance:student-leave", "approval-center"];
  const freshStaffModules = await requestAdminApi("overview", supportLogin.body.accessToken);
  assert.deepEqual(freshStaffModules.body.allowedModuleIds, staff.allowedModules);
  assert.equal(freshStaffModules.body.studentCount, null);
  staff.isActive = false;
  assert.equal((await requestAdminApi("overview", supportLogin.body.accessToken)).response.status, 401);
  staff.isActive = true;
  const movedStaffLogin = await request("login", {
    role: "support_staff", identifier: staff.email, password: "Correct-Horse-77",
  });
  staff.schoolId = foreignSchool.id;
  assert.equal((await requestAdminApi("overview", movedStaffLogin.body.accessToken)).response.status, 401);
  staff.schoolId = school.id;

  const currentTeacherLogin = await request("login", {
    role: "teacher", identifier: teacherUser.email, password: "Correct-Horse-77",
  });
  assert.equal(currentTeacherLogin.response.status, 200);
  assert.equal((await requestAdminApi("overview", currentTeacherLogin.body.accessToken)).response.status, 403);

  staffRows.set(staff.id, { ...staff, email: teacherUser.email });
  const supportCollision = await request("login", {
    role: "support_staff", identifier: teacherUser.email, password: "Correct-Horse-77",
  });
  assert.equal(supportCollision.response.status, 401);
  staffRows.set(staff.id, staff);

  const staleInitLogin = await request("login", {
    role: "admin", identifier: initAdmin.email, password: "Correct-Horse-77",
  });
  assert.equal(staleInitLogin.body.state, "initialize_required");
  initAdmin.passwordHash = await bcrypt.hash("Changed-Password-88", 4);
  const staleInit = await request("initialize", {
    challengeToken: staleInitLogin.body.challengeToken,
    newPassword: "New-Password-99", confirmPassword: "New-Password-99",
    pin: "654321", confirmPin: "654321",
    recoveryEmail: "admin-recovery@example.test", recoveryPhone: "5551234567",
  });
  assert.equal(staleInit.response.status, 403);
  assert.equal(initAdmin.isInitialized, false);
  const freshInitLogin = await request("login", {
    role: "admin", identifier: initAdmin.email, password: "Changed-Password-88",
  });
  assert.equal(freshInitLogin.body.state, "initialize_required");
  const initialized = await request("initialize", {
    challengeToken: freshInitLogin.body.challengeToken,
    newPassword: "New-Password-99", confirmPassword: "New-Password-99",
    pin: "654321", confirmPin: "654321",
    recoveryEmail: "admin-recovery@example.test", recoveryPhone: "5551234567",
  });
  assert.equal(initialized.response.status, 200);
  assert.equal(initialized.body.user.role, "admin");
  assert.equal(initAdmin.isInitialized, true);

  const tenantBoundLogin = await request("login", {
    role: "teacher", identifier: teacherUser.email, password: "Correct-Horse-77",
  });
  assert.equal(tenantBoundLogin.response.status, 200);
  teacher.schoolId = 2;
  const movedTenant = await request("me", undefined, tenantBoundLogin.body.accessToken);
  assert.equal(movedTenant.response.status, 401);
  teacher.schoolId = school.id;

  const roleBoundLogin = await request("login", {
    role: "teacher", identifier: teacherUser.email, password: "Correct-Horse-77",
  });
  assert.equal(roleBoundLogin.response.status, 200);
  teacherUser.role = "admin";
  const changedRole = await request("me", undefined, roleBoundLogin.body.accessToken);
  assert.equal(changedRole.response.status, 401);
  teacherUser.role = "teacher";

  const logoutLogin = await request("login", {
    role: "support_staff", identifier: staff.email, password: "Correct-Horse-77",
  });
  const logout = await request("logout", undefined, logoutLogin.body.accessToken);
  assert.equal(logout.response.status, 200);
  const afterLogout = await request("me", undefined, logoutLogin.body.accessToken);
  assert.equal(afterLogout.response.status, 401);

  const finalTeacherLogin = await request("login", {
    role: "teacher", identifier: teacherUser.email, password: "Correct-Horse-77",
  });
  assert.equal(finalTeacherLogin.response.status, 200);
  const changedTeacherPassword = await requestTeacherRoute(
    "change-password", "POST", finalTeacherLogin.body.accessToken,
    { currentPassword: "Correct-Horse-77", newPassword: "New-Teacher-Password-98" },
  );
  assert.equal(changedTeacherPassword.response.status, 200);
  assert.deepEqual(changedTeacherPassword.body, {
    message: "Password changed successfully. Please log in again.",
  });
  assert.equal(teacherMetrics.invalidatedUserId, teacherUser.id);
  assert.equal((await requestTeacherRoute("me", "GET", finalTeacherLogin.body.accessToken)).response.status, 401);

  const throttledIp = "198.51.100.250";
  for (let index = 0; index < 20; index += 1) {
    const response = await fetch(`${baseUrl}/api/mobile/auth/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-proto": "https",
        "x-forwarded-for": throttledIp,
      },
      body: JSON.stringify({
        role: "teacher", identifier: "unknown-throttle@example.test", password: "invalid",
      }),
    });
    assert.equal(response.status, 401);
  }
  const rateLimited = await fetch(`${baseUrl}/api/mobile/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-proto": "https",
      "x-forwarded-for": throttledIp,
    },
    body: JSON.stringify({
      role: "teacher", identifier: "unknown-throttle@example.test", password: "invalid",
    }),
  });
  assert.equal(rateLimited.status, 429);
  assert.equal(rateLimited.headers.get("retry-after"), "900");
});