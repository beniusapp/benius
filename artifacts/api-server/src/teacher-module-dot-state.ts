import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type {
  TeacherModuleActivityCursor,
  TeacherModuleDotStateResponse,
  TeacherModuleKey,
} from "@workspace/api-zod";
import {
  complaints,
  notices,
  studentLeaveRequests,
  studentProfiles,
  type Teacher,
} from "@workspace/db";
import { db, pool } from "./db";
import { storage } from "./storage";
import {
  buildTeacherModuleDotStateResponse,
  compareTeacherModuleCursors,
  isTeacherModuleKey,
  latestTeacherModuleCursor,
  TEACHER_MODULE_DOT_KEYS,
} from "./teacher-module-dot-state-core";

export type TeacherModuleDotScope = {
  schoolId: number;
  teacherId: number;
  sessionId: number;
  teacher: Pick<Teacher, "id" | "schoolId" | "assignedClass" | "assignedSection">;
};

type SeenCursorRow = {
  moduleKey: string;
  createdAt: string;
  source: string;
  recordId: number;
};

type RawCursorRow = {
  createdAt: string;
  recordId: number;
};

type ModuleActivityCursors = Record<TeacherModuleKey, TeacherModuleActivityCursor[]>;

function cursorsFromRows(
  rows: readonly RawCursorRow[],
  source: TeacherModuleActivityCursor["source"],
): TeacherModuleActivityCursor[] {
  return rows.map(row => ({
    createdAt: row.createdAt,
    source,
    recordId: row.recordId,
  }));
}

async function getNoticeActivityCursors(
  scope: TeacherModuleDotScope,
): Promise<TeacherModuleActivityCursor[]> {
  const [teacherFeed, studentFeed] = await Promise.all([
    storage.getTeacherScopedNotices(scope.schoolId, scope.teacherId, scope.sessionId),
    storage.getNoticesByTarget(scope.schoolId, "student", undefined, undefined, scope.sessionId),
  ]);
  const visibleNoticeIds = [...new Set(
    [...teacherFeed, ...studentFeed]
      .filter(notice => !(notice.creatorRole === "teacher" && notice.createdById === scope.teacherId))
      .map(notice => notice.id),
  )];
  if (visibleNoticeIds.length === 0) return [];

  const rows = await db
    .select({
      createdAt: sql<string>`${notices.createdAt}::text`.as("created_at"),
      recordId: notices.id,
    })
    .from(notices)
    .where(and(
      eq(notices.schoolId, scope.schoolId),
      eq(notices.sessionId, scope.sessionId),
      inArray(notices.id, visibleNoticeIds),
    ))
    .orderBy(desc(notices.createdAt), desc(notices.id));

  return cursorsFromRows(rows, "notice");
}

async function getComplaintActivityCursors(
  scope: TeacherModuleDotScope,
): Promise<TeacherModuleActivityCursor[]> {
  const mappings = await storage.getFacultyMappingsByTeacher(scope.teacherId);
  const effectiveMappings = mappings.map(({ className, section }) => ({ className, section }));
  if (
    scope.teacher.assignedClass
    && scope.teacher.assignedSection
    && !effectiveMappings.some(mapping =>
      mapping.className === scope.teacher.assignedClass
      && mapping.section === scope.teacher.assignedSection,
    )
  ) {
    effectiveMappings.push({
      className: scope.teacher.assignedClass,
      section: scope.teacher.assignedSection,
    });
  }
  if (effectiveMappings.length === 0) return [];

  const feed = await storage.getClassFeedComplaints(
    scope.schoolId,
    scope.sessionId,
    effectiveMappings,
  );
  const ids = [...new Set(feed.map(complaint => complaint.id))];
  if (ids.length === 0) return [];

  const rows = await db
    .select({
      createdAt: sql<string>`${complaints.createdAt}::text`.as("created_at"),
      recordId: complaints.id,
    })
    .from(complaints)
    .where(and(
      eq(complaints.schoolId, scope.schoolId),
      eq(complaints.sessionId, scope.sessionId),
      eq(complaints.complaintType, "student-peer-report"),
      eq(complaints.isDeleted, false),
      inArray(complaints.id, ids),
    ))
    .orderBy(desc(complaints.createdAt), desc(complaints.id));

  return cursorsFromRows(rows, "peer_report");
}

async function getLeaveActivityCursors(
  scope: TeacherModuleDotScope,
): Promise<TeacherModuleActivityCursor[]> {
  const queue = await storage.getStudentLeavesByTeacher(
    scope.teacherId,
    scope.schoolId,
    scope.sessionId,
  );
  const ids = [...new Set(queue.map(request => request.id))];
  if (ids.length === 0) return [];

  const rows = await db
    .select({
      createdAt: sql<string>`${studentLeaveRequests.createdAt}::text`.as("created_at"),
      recordId: studentLeaveRequests.id,
    })
    .from(studentLeaveRequests)
    .where(and(
      eq(studentLeaveRequests.schoolId, scope.schoolId),
      eq(studentLeaveRequests.sessionId, scope.sessionId),
      eq(studentLeaveRequests.status, "pending_teacher"),
      inArray(studentLeaveRequests.id, ids),
    ))
    .orderBy(desc(studentLeaveRequests.createdAt), desc(studentLeaveRequests.id));

  return cursorsFromRows(rows, "student_leave");
}

async function getApprovalActivityCursors(
  scope: TeacherModuleDotScope,
): Promise<TeacherModuleActivityCursor[]> {
  const pending = await storage.getPendingProfilesForTeacher(
    scope.schoolId,
    scope.teacherId,
    undefined,
    scope.sessionId,
  );
  const fullProfileIds = [...new Set(
    pending
      .filter(profile => profile.status === "pending" && profile.submittedAt != null)
      .map(profile => profile.id),
  )];
  const photoOnlyIds = [...new Set(
    pending
      .filter(profile => profile.status !== "pending" && profile.photoStatus === "pending")
      .map(profile => profile.id),
  )];

  const [profileRows, photoRows] = await Promise.all([
    fullProfileIds.length === 0
      ? Promise.resolve([] as RawCursorRow[])
      : db
        .select({
          createdAt: sql<string>`${studentProfiles.submittedAt}::text`.as("created_at"),
          recordId: studentProfiles.id,
        })
        .from(studentProfiles)
        .where(and(
          eq(studentProfiles.schoolId, scope.schoolId),
          eq(studentProfiles.status, "pending"),
          inArray(studentProfiles.id, fullProfileIds),
          sql`${studentProfiles.submittedAt} IS NOT NULL`,
        )),
    photoOnlyIds.length === 0
      ? Promise.resolve([] as RawCursorRow[])
      : db
        .select({
          createdAt: sql<string>`${studentProfiles.updatedAt}::text`.as("created_at"),
          recordId: studentProfiles.id,
        })
        .from(studentProfiles)
        .where(and(
          eq(studentProfiles.schoolId, scope.schoolId),
          eq(studentProfiles.photoStatus, "pending"),
          ne(studentProfiles.status, "pending"),
          inArray(studentProfiles.id, photoOnlyIds),
        )),
  ]);

  return [
    ...cursorsFromRows(profileRows, "student_profile_submission"),
    ...cursorsFromRows(photoRows, "student_profile_photo"),
  ];
}

async function getModuleActivityCursors(
  scope: TeacherModuleDotScope,
): Promise<ModuleActivityCursors> {
  const [noticeboard, complaints, leave, approvalCenter] = await Promise.all([
    getNoticeActivityCursors(scope),
    getComplaintActivityCursors(scope),
    getLeaveActivityCursors(scope),
    getApprovalActivityCursors(scope),
  ]);
  return {
    noticeboard,
    complaints,
    leave,
    approval_center: approvalCenter,
  };
}

export async function getTeacherModuleDotState(
  scope: TeacherModuleDotScope,
): Promise<TeacherModuleDotStateResponse> {
  const [activity, seenResult] = await Promise.all([
    getModuleActivityCursors(scope),
    pool.query<SeenCursorRow>(
      `SELECT
         module_key AS "moduleKey",
         seen_activity_at::text AS "createdAt",
         seen_activity_source AS "source",
         seen_activity_record_id AS "recordId"
       FROM teacher_module_seen_state
       WHERE school_id = $1 AND teacher_id = $2 AND session_id = $3`,
      [scope.schoolId, scope.teacherId, scope.sessionId],
    ),
  ]);

  const latest = Object.fromEntries(
    TEACHER_MODULE_DOT_KEYS.map(module => [module, latestTeacherModuleCursor(activity[module])]),
  ) as Record<TeacherModuleKey, TeacherModuleActivityCursor | null>;
  const seen = new Map<TeacherModuleKey, TeacherModuleActivityCursor>();
  for (const row of seenResult.rows) {
    if (isTeacherModuleKey(row.moduleKey)) {
      seen.set(row.moduleKey, {
        createdAt: row.createdAt,
        source: row.source as TeacherModuleActivityCursor["source"],
        recordId: row.recordId,
      });
    }
  }
  return buildTeacherModuleDotStateResponse(latest, seen);
}

export async function persistTeacherModuleSeenCursor(
  scope: TeacherModuleDotScope,
  module: TeacherModuleKey,
  cursor: TeacherModuleActivityCursor,
): Promise<boolean> {
  const events = await getModuleActivityCursorsForModule(scope, module);
  const isVisible = events.some(event => compareTeacherModuleCursors(event, cursor) === 0);
  if (!isVisible) return false;

  await pool.query(
    `INSERT INTO teacher_module_seen_state
      (school_id, teacher_id, session_id, module_key, seen_activity_at, seen_activity_source, seen_activity_record_id)
     VALUES ($1, $2, $3, $4, $5::timestamp without time zone, $6, $7)
     ON CONFLICT (school_id, teacher_id, session_id, module_key) DO UPDATE
       SET seen_activity_at = EXCLUDED.seen_activity_at,
           seen_activity_source = EXCLUDED.seen_activity_source,
           seen_activity_record_id = EXCLUDED.seen_activity_record_id
       WHERE (
         teacher_module_seen_state.seen_activity_at,
         teacher_module_seen_state.seen_activity_source COLLATE "C",
         teacher_module_seen_state.seen_activity_record_id
       ) < (
         EXCLUDED.seen_activity_at,
         EXCLUDED.seen_activity_source COLLATE "C",
         EXCLUDED.seen_activity_record_id
       )`,
    [
      scope.schoolId,
      scope.teacherId,
      scope.sessionId,
      module,
      cursor.createdAt,
      cursor.source,
      cursor.recordId,
    ],
  );
  return true;
}

async function getModuleActivityCursorsForModule(
  scope: TeacherModuleDotScope,
  module: TeacherModuleKey,
): Promise<TeacherModuleActivityCursor[]> {
  switch (module) {
    case "noticeboard":
      return getNoticeActivityCursors(scope);
    case "complaints":
      return getComplaintActivityCursors(scope);
    case "leave":
      return getLeaveActivityCursors(scope);
    case "approval_center":
      return getApprovalActivityCursors(scope);
  }
}
