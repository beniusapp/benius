import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import type {
  StudentModuleActivityCursor,
  StudentModuleDotStateResponse,
  StudentModuleKey,
} from "@workspace/api-zod";
import {
  classwork,
  complaintNotes,
  complaintStudents,
  complaints,
  homework,
  notices,
  studentModuleSeenState,
  teachers,
} from "@workspace/db";
import { db, pool } from "./db";
import {
  buildStudentModuleDotStateResponse,
  isStudentModuleKey,
  STUDENT_COMPLAINT_NOTIFICATION_ROLES,
  type StudentModuleLatestCursors,
} from "./student-module-dot-state-core";
import { studentComplaintSessionScope } from "./student-complaint-scope";
import {
  studentNoticeMatchesAudience,
  studentNoticeSessionScope,
} from "./student-notice-visibility";

export type StudentModuleDotScope = {
  schoolId: number;
  studentId: number;
  sessionId: number;
  enrollment: { className: string; sectionName: string } | null;
};

type SeenCursorRow = {
  moduleKey: string;
  createdAt: string;
  recordId: number;
};

async function getVisibleActivityCursor(
  scope: StudentModuleDotScope,
  module: StudentModuleKey,
  recordId?: number,
): Promise<StudentModuleActivityCursor | null> {
  switch (module) {
    case "homework": {
      if (!scope.enrollment) return null;
      const conditions = [
        eq(homework.schoolId, scope.schoolId),
        eq(homework.sessionId, scope.sessionId),
        eq(homework.class, scope.enrollment.className),
        eq(homework.section, scope.enrollment.sectionName),
      ];
      if (recordId !== undefined) conditions.push(eq(homework.id, recordId));
      const [row] = await db
        .select({
          createdAt: sql<string>`${homework.createdAt}::text`.as("created_at"),
          recordId: homework.id,
        })
        .from(homework)
        .innerJoin(teachers, eq(homework.teacherId, teachers.id))
        .where(and(...conditions))
        .orderBy(desc(homework.createdAt), desc(homework.id))
        .limit(1);
      return row ? { createdAt: row.createdAt, recordId: row.recordId } : null;
    }
    case "classwork": {
      if (!scope.enrollment) return null;
      const conditions = [
        eq(classwork.schoolId, scope.schoolId),
        eq(classwork.sessionId, scope.sessionId),
        eq(classwork.class, scope.enrollment.className),
        eq(classwork.section, scope.enrollment.sectionName),
      ];
      if (recordId !== undefined) conditions.push(eq(classwork.id, recordId));
      const [row] = await db
        .select({
          createdAt: sql<string>`${classwork.createdAt}::text`.as("created_at"),
          recordId: classwork.id,
        })
        .from(classwork)
        .innerJoin(teachers, eq(classwork.teacherId, teachers.id))
        .where(and(...conditions))
        .orderBy(desc(classwork.createdAt), desc(classwork.id))
        .limit(1);
      return row ? { createdAt: row.createdAt, recordId: row.recordId } : null;
    }
    case "noticeboard": {
      if (!scope.enrollment) return null;
      const classMatch = or(
        isNull(notices.targetClass),
        eq(notices.targetClass, scope.enrollment.className),
        sql`${scope.enrollment.className} = ANY(string_to_array(${notices.targetClass}, ','))`,
      )!;
      const noticeAudience = or(
        eq(notices.targetType, "whole_school"),
        and(eq(notices.targetType, "student"), classMatch)!,
        and(eq(notices.targetType, "class"), classMatch)!,
      )!;
      const conditions = [
        studentNoticeSessionScope(scope.schoolId, scope.sessionId),
        noticeAudience,
      ];
      if (recordId !== undefined) conditions.push(eq(notices.id, recordId));
      const rows = await db
        .select({
          createdAt: sql<string>`${notices.createdAt}::text`.as("created_at"),
          recordId: notices.id,
          targetType: notices.targetType,
          targetClass: notices.targetClass,
          targetSection: notices.targetSection,
        })
        .from(notices)
        .where(and(...conditions))
        .orderBy(desc(notices.createdAt), desc(notices.id));
      const visible = rows.find(row => studentNoticeMatchesAudience(
        row,
        scope.enrollment!.className,
        scope.enrollment!.sectionName,
      ));
      return visible ? { createdAt: visible.createdAt, recordId: visible.recordId } : null;
    }
    case "complaints": {
      const studentIsLinked = sql<boolean>`EXISTS (
        SELECT 1
        FROM ${complaintStudents}
        WHERE ${complaintStudents.complaintId} = ${complaints.id}
          AND ${complaintStudents.studentId} = ${scope.studentId}
      )`;
      const inboxComplaint = and(
        eq(complaints.complaintType, "teacher-to-student"),
        or(eq(complaints.studentId, scope.studentId), studentIsLinked)!,
        isNotNull(teachers.id),
      )!;
      const filedComplaint = and(
        eq(complaints.complainantStudentId, scope.studentId),
        sql`${complaints.complaintType} IN ('student-to-staff', 'student-peer-report')`,
      )!;
      const conditions = [
        studentComplaintSessionScope(scope.schoolId, scope.sessionId),
        eq(complaints.isDeleted, false),
        or(inboxComplaint, filedComplaint)!,
        inArray(complaintNotes.authorRole, [...STUDENT_COMPLAINT_NOTIFICATION_ROLES]),
      ];
      if (recordId !== undefined) conditions.push(eq(complaintNotes.id, recordId));
      const [row] = await db
        .select({
          createdAt: sql<string>`${complaintNotes.createdAt}::text`.as("created_at"),
          recordId: complaintNotes.id,
        })
        .from(complaintNotes)
        .innerJoin(complaints, eq(complaintNotes.complaintId, complaints.id))
        .leftJoin(teachers, and(
          eq(complaints.teacherId, teachers.id),
          eq(teachers.schoolId, scope.schoolId),
        ))
        .where(and(...conditions))
        .orderBy(desc(complaintNotes.createdAt), desc(complaintNotes.id))
        .limit(1);
      return row ? { createdAt: row.createdAt, recordId: row.recordId } : null;
    }
  }
}

export async function getStudentModuleDotState(
  scope: StudentModuleDotScope,
): Promise<StudentModuleDotStateResponse> {
  const [homeworkCursor, classworkCursor, noticeboardCursor, complaintsCursor, seenRows] =
    await Promise.all([
      getVisibleActivityCursor(scope, "homework"),
      getVisibleActivityCursor(scope, "classwork"),
      getVisibleActivityCursor(scope, "noticeboard"),
      getVisibleActivityCursor(scope, "complaints"),
      db
        .select({
          moduleKey: studentModuleSeenState.moduleKey,
          createdAt: sql<string>`${studentModuleSeenState.seenActivityAt}::text`.as("created_at"),
          recordId: studentModuleSeenState.seenActivityRecordId,
        })
        .from(studentModuleSeenState)
        .where(and(
          eq(studentModuleSeenState.schoolId, scope.schoolId),
          eq(studentModuleSeenState.studentId, scope.studentId),
          eq(studentModuleSeenState.sessionId, scope.sessionId),
        )),
    ]);

  const latest: StudentModuleLatestCursors = {
    homework: homeworkCursor,
    classwork: classworkCursor,
    noticeboard: noticeboardCursor,
    complaints: complaintsCursor,
  };
  const seen = new Map<StudentModuleKey, StudentModuleActivityCursor>();
  for (const row of seenRows as SeenCursorRow[]) {
    if (isStudentModuleKey(row.moduleKey)) {
      seen.set(row.moduleKey, { createdAt: row.createdAt, recordId: row.recordId });
    }
  }

  return buildStudentModuleDotStateResponse(latest, seen);
}

export async function persistStudentModuleSeenCursor(
  scope: StudentModuleDotScope,
  module: StudentModuleKey,
  cursor: StudentModuleActivityCursor,
): Promise<boolean> {
  const visibleCursor = await getVisibleActivityCursor(scope, module, cursor.recordId);
  if (!visibleCursor || visibleCursor.createdAt !== cursor.createdAt) return false;

  await pool.query(
    `INSERT INTO student_module_seen_state
      (school_id, student_id, session_id, module_key, seen_activity_at, seen_activity_record_id)
     VALUES ($1, $2, $3, $4, $5::timestamp, $6)
     ON CONFLICT (school_id, student_id, session_id, module_key) DO UPDATE
       SET seen_activity_at = EXCLUDED.seen_activity_at,
           seen_activity_record_id = EXCLUDED.seen_activity_record_id
       WHERE (student_module_seen_state.seen_activity_at, student_module_seen_state.seen_activity_record_id)
         < (EXCLUDED.seen_activity_at, EXCLUDED.seen_activity_record_id)`,
    [scope.schoolId, scope.studentId, scope.sessionId, module, cursor.createdAt, cursor.recordId],
  );
  return true;
}
